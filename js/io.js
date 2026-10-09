// js/io.js
// Importación/exportación de MiColección.
// Extraído de app.js en Modularización 3 sin cambios funcionales deliberados.

function handleImportExcel(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      // ✅ Multi-hoja: acumulamos ítems de TODAS las hojas
      const imported = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
  
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
        if (!raw || raw.length < 2) continue; // hoja vacía o solo cabecera
  
        const headers = raw[0].map(h => String(h ?? '').trim());
        const rows = raw.slice(1);
  
        // Requisito mínimo: "Título". "Categoría" puede venir o no (si no viene, usamos nombre de hoja)
        if (!headers.includes("Título")) continue;
  
        const index = headers.reduce((acc, h, i) => (acc[h] = i, acc), {});
        const hasCategoryCol = headers.includes("Categoría");
  
        const cell = (row, colName) => {
          const i = index[colName];
          return (i === undefined) ? '' : row[i];
        };
  
        for (const row of rows) {
          const title = String(cell(row, "Título") || '').trim();
          if (!title) continue;
    
          const rawType = hasCategoryCol ?
            String(cell(row, "Categoría") || '').trim() :
            String(sheetName).trim();
    
          const type = canonicalizeType(rawType || sheetName);
          if (!categories.includes(type)) continue;
    
          const obj = {
            id: generateItemId(),
            schemaVersion: AppConfig.schemaVersion,
            legacyId: null,
            legacyKey: '',
            images: [],
            title,
            author: String(cell(row, "Autor") || '').trim(),
            format: String(cell(row, "Formato") || '').trim(),
            genre: String(cell(row, "Género") || '').trim(),
            year: String(cell(row, "Año") || '').trim(),
            notes: String(cell(row, "Notas") || '').trim(),
            moreInfo: safeUrl(String(cell(row, "Más info") || '').trim()),
            type,
            subcategory: (type === 'Otros') ? String(cell(row, "Subcategoría") || '').trim() : '',
            coverImage: null
          };
    
          obj.legacyKey = stableKeyForItem(obj);
          imported.push(obj);
        }
      }

      // Si no importamos nada de ninguna hoja, avisamos
      if (imported.length === 0) {
        toast('No se importaron ítems. Revisa que haya columna "Título" y categorías válidas (o nombre de hoja = categoría).', 'error', 3000);
        return;
      }
      
 
      // Pre-scan: calcular qué pasaría sin modificar items aún
      const existingLegacyKeys = new Set(items.map(it => String(it.legacyKey || stableKeyForItem(it))));
      let wouldAdd = 0;
      let wouldUpdate = 0;

      for (const it of imported) {
        if (existingLegacyKeys.has(String(it.legacyKey))) wouldUpdate++;
        else wouldAdd++;
      }
      
      // Import real. En D1 la operación se persiste en el servidor de forma masiva;
      // en modo local se conserva el comportamiento histórico.
      const applyImport = async () => {
        if (AppConfig.backendMode === 'd1' && typeof backend().importMany === 'function') {
          const result = await backend().importMany(imported);
          if (currentCategory) showCategory(currentCategory);
          toast(`Importación D1: ${result.added} añadidos, ${result.updated} actualizados`, 'success', 2600);
          return;
        }

        const byId = new Map(items.map(it => [String(it.id), it]));
        const idByLegacyKey = new Map(items.map(it => [String(it.legacyKey || stableKeyForItem(it)), String(it.id)]));
        let added = 0;
        let updated = 0;

        for (const it of imported) {
          const matchingId = idByLegacyKey.get(String(it.legacyKey));
          if (matchingId && byId.has(matchingId)) {
            const prev = byId.get(matchingId);
            const merged = {
              ...prev,
              ...it,
              id: prev.id,
              schemaVersion: AppConfig.schemaVersion,
              legacyId: prev.legacyId || null,
              legacyKey: it.legacyKey,
              images: Array.isArray(prev.images) ? prev.images : [],
              coverImage: prev.coverImage || it.coverImage || null
            };
            byId.set(matchingId, merged);
            updated++;
          } else {
            byId.set(String(it.id), it);
            idByLegacyKey.set(String(it.legacyKey), String(it.id));
            added++;
          }
        }

        const finalItems = Array.from(byId.values());
        backend().saveAll(finalItems);
        if (currentCategory) showCategory(currentCategory);
        toast(`Importación: ${added} añadidos, ${updated} actualizados`, 'success', 2200);
      };
      
      // Mostrar modal de confirmación (en vez de confirm())
      const m = document.getElementById('importConfirmModal');
      const txt = document.getElementById('importConfirmText');
      const okBtn = document.getElementById('importConfirmOkBtn');

      if (!m || !txt || !okBtn) {
        // Fallback por si falta algo
        const ok = confirm(
          `Importar Excel:\n\n` +
          `• Añadir: ${wouldAdd}\n` +
          `• Actualizar: ${wouldUpdate}\n\n` +
           `¿Continuar?`
        );
        if (!ok) return;
        
        applyImport().catch(err => {
          console.error('[handleImportExcel applyImport]', err);
          toast('Error al importar en D1', 'error', 2800);
        });
      } else {
        txt.textContent =
        `Vas a importar este Excel:\n\n` +
        `• Añadir: ${wouldAdd}\n` +
        `• Actualizar: ${wouldUpdate}\n\n` +
        `¿Continuar?`;
        txt.style.whiteSpace = 'pre-line';
        m.style.display = 'block';
  
        // Evitar listeners duplicados: reemplazamos el botón por un clon
        const freshOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(freshOk, okBtn);

        // Cada importación debe empezar con un botón limpio. cloneNode() también
        // copia el estado disabled y el texto de la importación anterior.
        freshOk.disabled = false;
        freshOk.textContent = 'Continuar';
  
        freshOk.addEventListener('click', async () => {
          freshOk.disabled = true;
          freshOk.textContent = 'Importando…';
          try {
            await applyImport();
            closeImportConfirmModal();
          } catch (err) {
            console.error('[handleImportExcel applyImport]', err);
            toast(`Error al importar en D1: ${err.message || err}`, 'error', 3200);
            freshOk.disabled = false;
            freshOk.textContent = 'Continuar';
          }
        });
   
        return; // 👈 clave: para no continuar sin confirmación
      }
      
      
    } catch (err) {
      console.error('[handleImportExcel]', err);
      toast('Error al importar el Excel', 'error', 2400);
    } finally {
      // ✅ iOS: permitir reimportar el mismo archivo consecutivamente
      const input = document.getElementById('importExcelInput');
      if (input) input.value = '';
    }
  };
  
  reader.readAsArrayBuffer(file);
}



// ===== v2.5.0 · Restauración segura desde backup JSON =====
function validateJsonBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('El archivo no contiene un backup válido');
  }
  if (payload.app !== AppConfig.appName) {
    throw new Error('El archivo no pertenece a Mi Colección');
  }
  if (Number(payload.schemaVersion) !== AppConfig.schemaVersion) {
    throw new Error(`Versión de datos incompatible (se esperaba esquema ${AppConfig.schemaVersion})`);
  }
  if (!Array.isArray(payload.items)) {
    throw new Error('El backup no contiene una lista de elementos válida');
  }

  const ids = new Set();
  let covers = 0;
  for (let i = 0; i < payload.items.length; i++) {
    const it = payload.items[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      throw new Error(`Elemento ${i + 1}: formato no válido`);
    }
    if (!isUlid(it.id)) throw new Error(`Elemento ${i + 1}: ULID no válido`);
    const id = String(it.id).toUpperCase();
    if (ids.has(id)) throw new Error(`Elemento ${i + 1}: ULID duplicado`);
    ids.add(id);
    if (Number(it.schemaVersion) !== AppConfig.schemaVersion) {
      throw new Error(`Elemento ${i + 1}: versión de esquema incorrecta`);
    }
    if (!Array.isArray(it.images)) throw new Error(`Elemento ${i + 1}: images no es un array`);
    if (typeof it.title !== 'string' || !it.title.trim()) throw new Error(`Elemento ${i + 1}: falta el título`);
    if (typeof it.type !== 'string' || !categories.includes(canonicalizeType(it.type))) {
      throw new Error(`Elemento ${i + 1}: categoría no válida`);
    }
    if (it.legacyKey != null && typeof it.legacyKey !== 'string') {
      throw new Error(`Elemento ${i + 1}: legacyKey no válido`);
    }
    if (it.coverImage) covers++;
  }

  return { count: payload.items.length, covers };
}

function handleImportJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  // En D1 una restauración JSON sin los binarios de R2 no puede reconstruir
  // de forma segura una copia completa. Evitamos el antiguo falso positivo
  // de saveAll(), que en modo D1 solo actualizaba la caché local.
  if (AppConfig.backendMode === 'd1') {
    toast('Con D1 utiliza “Restaurar copia completa (ZIP)”', 'error', 4200);
    const input = document.getElementById('importJsonInput');
    if (input) input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const payload = JSON.parse(String(e.target.result || ''));
      const summary = validateJsonBackup(payload);
      const currentCount = Array.isArray(items) ? items.length : 0;
      const exportedAt = payload.exportedAt ? new Date(payload.exportedAt) : null;
      const exportedLabel = exportedAt && !Number.isNaN(exportedAt.getTime())
        ? exportedAt.toLocaleString('es-ES')
        : 'fecha no disponible';

      const ok = confirm(
        `RESTAURAR BACKUP JSON\n\n` +
        `Backup: ${summary.count} elementos (${summary.covers} con carátula)\n` +
        `Exportado: ${exportedLabel}\n` +
        `Colección actual: ${currentCount} elementos\n\n` +
        `La restauración sustituirá por completo la colección actual por el contenido de este backup.\n` +
        `No se mezclará con los datos existentes.\n\n` +
        `¿Continuar?`
      );
      if (!ok) return;

      // Copia profunda: preserva exactamente IDs, metadatos e imágenes del backup.
      const restoredItems = JSON.parse(JSON.stringify(payload.items));
      SchemaManager.verify(restoredItems);
      backend().saveAll(restoredItems);

      // Verificación posterior: si el guardado no quedó íntegro, se considera fallo.
      const persisted = backend().loadAll();
      SchemaManager.verify(persisted);
      if (persisted.length !== restoredItems.length) {
        throw new Error('La comprobación posterior al guardado no coincide');
      }

      toast(`Backup restaurado: ${restoredItems.length} elementos`, 'success', 2800);
      showScreen('homeScreen');
    } catch (err) {
      console.error('[handleImportJSON]', err);
      toast(`No se restauró el JSON: ${err.message || 'archivo no válido'}`, 'error', 4200);
    } finally {
      const input = document.getElementById('importJsonInput');
      if (input) input.value = '';
    }
  };
  reader.onerror = function() {
    toast('No se pudo leer el archivo JSON', 'error', 3000);
    const input = document.getElementById('importJsonInput');
    if (input) input.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

function openExportMenu() {
  const modal = document.getElementById('exportModal');
  const options = document.getElementById('exportOptions');
  if (!modal || !options) return;
  
  options.innerHTML = '';
  
  const makeOpt = (label, categoryOrNull) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button';
    btn.textContent = label;
    btn.onclick = async () => {
      closeExportModal();
      await exportExcelAll(categoryOrNull);
    };
    return btn;
  };
  
  // Exportar TODO (Excel)
options.appendChild(makeOpt('Exportar TODO (Excel)', null));

// Exportar JSON (todo)
{
  const btnJson = document.createElement('button');
  btnJson.type = 'button';
  btnJson.className = 'button';
  btnJson.textContent = 'Exportar TODO (JSON)';
  btnJson.onclick = async () => {
    closeExportModal();
    await exportJSON();
  };
  options.appendChild(btnJson);
}

// Copia de seguridad completa (JSON + carátulas R2)
{
  const btnBackup = document.createElement('button');
  btnBackup.type = 'button';
  btnBackup.className = 'button';
  btnBackup.textContent = 'Copia completa (ZIP)';
  btnBackup.onclick = async () => {
    closeExportModal();
    await exportFullBackupZip();
  };
  options.appendChild(btnBackup);
}

// Botones por categoría (Excel)
categories.forEach(cat => {
  options.appendChild(makeOpt(`Exportar ${cat} (Excel)`, cat));
});
  
  modal.style.display = 'block';
}

function closeExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.style.display = 'none';
}


function pickItemsForExport(categoryOrNull) {
  if (!categoryOrNull) return items;
  const canon = canonicalizeType(categoryOrNull);
  return items.filter(it => canonicalizeType(it.type) === canon);
}

async function exportExcelAll(categoryOrNull) {
  if (typeof XLSX === 'undefined') {
    toast('Exportar a Excel no disponible (XLSX no cargada)', 'error', 2600);
    return;
  }
  
  const HEADERS = ['Título', 'Categoría', 'Subcategoría', 'Autor', 'Formato', 'Género', 'Año', 'Más info', 'Notas'];
  
  const toRow = (it) => ({
    'Título': String(it.title ?? '').trim(),
    'Categoría': String(it.type ?? '').trim(),
    'Subcategoría': String(it.subcategory ?? '').trim(),
    'Autor': String(it.author ?? '').trim(),
    'Formato': String(it.format ?? '').trim(),
    'Género': String(it.genre ?? '').trim(),
    'Año': String(it.year ?? '').trim(),
    'Más info': String(it.moreInfo ?? '').trim(),
    'Notas': String(it.notes ?? '').trim()
  });
  
  const wb = XLSX.utils.book_new();
  
  // ✅ Caso 1: Exportar TODO -> multi-hoja (una hoja por categoría)
  if (!categoryOrNull) {
    for (const cat of categories) {
      const src = pickItemsForExport(cat);
      const rows = src.map(toRow);
      
      // Nombre de hoja compatible Excel (máx 31 chars, sin caracteres raros)
      const sheetName = String(cat).replace(/[:\\/?*\[\]]/g, '-').slice(0, 31);
      
      const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  } else {
    // ✅ Caso 2: Exportar una categoría -> 1 hoja
    const src = pickItemsForExport(categoryOrNull);
    const rows = src.map(toRow);
    
    const sheetName = String(canonicalizeType(categoryOrNull))
      .replace(/[:\\/?*\[\]]/g, '-')
      .slice(0, 31) || 'MiColeccion';
    
    const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  
  // Bytes XLSX
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  
  const tag = categoryOrNull ? `-${canonicalizeType(categoryOrNull)}` : '-TODO';
  const filename = `mi-coleccion${tag}-${new Date().toISOString().slice(0,10)}.xlsx`;
  
  // 1) Share Sheet (mejor en iPhone)
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({
        title: 'Exportar colección (Excel)',
        text: 'Excel de Mi Colección',
        files: [file]
      });
      return;
    }
  } catch (e) {
    console.warn('[exportExcelAll] share falló, uso fallback', e);
  }
  
  // 2) Fallback: abrir blob en pestaña
  try {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      toast('No se pudo abrir pestaña (popups bloqueados). Prueba en Safari', 'error', 2600);
    }
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.error('[exportExcelAll] fallback falló', e);
    toast('Exportación a Excel fallida', 'error', 2600);
  }
}

async function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: AppConfig.appName,
    schemaVersion: AppConfig.schemaVersion,
    items
  };
  
  const jsonText = JSON.stringify(payload, null, 2);
  const filename = `mi-coleccion-${new Date().toISOString().slice(0,10)}.json`;
  
  // 1) Intento "pro": Share Sheet (iOS/Android modernos)
  try {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const file = new File([blob], filename, { type: 'application/json' });
    
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({
        title: 'Exportar colección',
        text: 'Backup JSON de Mi Colección',
        files: [file]
      });
      return; // éxito: ya lo compartiste/guardaste
    }
  } catch (e) {
    // seguimos al fallback
    console.warn('[exportJSON] share falló, uso fallback', e);
  }
  
  // 2) Fallback: abrir el JSON en una pestaña (desde ahí: Compartir -> Guardar en Archivos)
  try {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // iOS suele responder mejor a window.open que a <a download>
    const w = window.open(url, '_blank');
    if (!w) {
      // Popup bloqueado: intentamos portapapeles y avisamos con toast
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonText);
        toast('Popup bloqueado: JSON copiado al portapapeles', 'success', 2600);
      } else {
        toast('Popup bloqueado: prueba en Safari o permite popups', 'error', 2600);
      }
    }
    
    
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.error('[exportJSON] fallback falló', e);
    toast('Exportación JSON fallida', 'error', 2600);
  }
}


// ===== v2.14.0 · Copia de seguridad completa (ZIP sin compresión) =====
// Formato portable: coleccion.json + images/<ULID>_01.jpg
// El ZIP se genera en el navegador/PWA para que la copia sea independiente de Cloudflare.

function _zipCrc32(bytes) {
  if (!_zipCrc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    _zipCrc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  const table = _zipCrc32.table;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _zipU16(value) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, value, true);
  return b;
}

function _zipU32(value) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return b;
}

function _zipConcat(parts) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function _zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31);
  const day = date.getDate() & 31;
  const month = (date.getMonth() + 1) & 15;
  const dosDate = (((year - 1980) & 127) << 9) | (month << 5) | day;
  return { time, date: dosDate };
}

function buildStoredZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = _zipDosDateTime();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = _zipCrc32(data);

    const localHeader = _zipConcat([
      _zipU32(0x04034b50), _zipU16(20), _zipU16(0x0800), _zipU16(0),
      _zipU16(stamp.time), _zipU16(stamp.date), _zipU32(crc),
      _zipU32(data.length), _zipU32(data.length), _zipU16(name.length), _zipU16(0), name
    ]);
    localParts.push(localHeader, data);

    const centralHeader = _zipConcat([
      _zipU32(0x02014b50), _zipU16(20), _zipU16(20), _zipU16(0x0800), _zipU16(0),
      _zipU16(stamp.time), _zipU16(stamp.date), _zipU32(crc),
      _zipU32(data.length), _zipU32(data.length), _zipU16(name.length), _zipU16(0),
      _zipU16(0), _zipU16(0), _zipU16(0), _zipU32(0), _zipU32(offset), name
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = _zipConcat(centralParts);
  const local = _zipConcat(localParts);
  const end = _zipConcat([
    _zipU32(0x06054b50), _zipU16(0), _zipU16(0),
    _zipU16(entries.length), _zipU16(entries.length),
    _zipU32(central.length), _zipU32(local.length), _zipU16(0)
  ]);
  return _zipConcat([local, central, end]);
}

async function exportFullBackupZip() {
  if (!Array.isArray(items)) {
    toast('No hay colección disponible para copiar', 'error', 3000);
    return;
  }

  toast(`Preparando copia completa (${items.length} elementos)…`, 'success', 2200);

  try {
    const imageManifest = [];
    const zipEntries = [];
    const missingImages = [];

    for (const item of items) {
      const cover = Array.isArray(item.images)
        ? item.images.find(img => img && img.role === 'cover' && img.key)
        : null;
      if (!cover) continue;

      const id = String(item.id || '').trim().toUpperCase();
      if (!id) continue;
      const filename = `images/${id}_01.jpg`;
      const response = await fetch(`/api/images/${encodeURIComponent(id)}/cover`, { cache: 'no-store' });
      if (!response.ok) {
        missingImages.push(`${id} · ${item.title || '(sin título)'}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      zipEntries.push({ name: filename, data: bytes });
      imageManifest.push({
        id,
        role: 'cover',
        filename,
        r2Key: cover.key || `covers/${id}/01.jpg`,
        contentType: response.headers.get('Content-Type') || cover.contentType || 'image/jpeg'
      });
    }

    if (missingImages.length) {
      console.error('[exportFullBackupZip] Imágenes referenciadas no encontradas:', missingImages);
      toast(`Copia cancelada: faltan ${missingImages.length} carátula(s) en R2`, 'error', 5000);
      return;
    }

    const payload = {
      backupFormatVersion: 1,
      backupType: 'MiColeccion-full',
      exportedAt: new Date().toISOString(),
      app: AppConfig.appName,
      schemaVersion: AppConfig.schemaVersion,
      appVersion: '2.14.0',
      itemCount: items.length,
      imageCount: imageManifest.length,
      images: imageManifest,
      items
    };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    zipEntries.unshift({ name: 'coleccion.json', data: jsonBytes });

    const zipBytes = buildStoredZip(zipEntries);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const filename = `MiColeccion-backup-${new Date().toISOString().slice(0,10)}.zip`;

    try {
      const file = new File([blob], filename, { type: 'application/zip' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: 'Copia completa de Mi Colección',
          text: `${items.length} elementos · ${imageManifest.length} carátulas`,
          files: [file]
        });
        toast(`Copia completa: ${items.length} elementos, ${imageManifest.length} carátulas`, 'success', 3200);
        return;
      }
    } catch (shareError) {
      console.warn('[exportFullBackupZip] share falló, uso descarga', shareError);
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Copia completa: ${items.length} elementos, ${imageManifest.length} carátulas`, 'success', 3200);
  } catch (err) {
    console.error('[exportFullBackupZip]', err);
    toast(`No se pudo crear la copia completa: ${err.message || 'error desconocido'}`, 'error', 5000);
  }
}


// ===== v2.15.0 · Restauración completa desde ZIP =====
// Restaura D1 + R2 conservando los ULID originales. El proceso usa una zona
// temporal de R2 y solo sustituye D1 cuando todas las imágenes están disponibles.

function parseStoredZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('ZIP no compatible o dañado');
    if (offset + 30 > bytes.length) throw new Error('Cabecera ZIP incompleta');

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    if (flags & 0x0008) throw new Error('ZIP con descriptor de datos no compatible');
    if (method !== 0) throw new Error('Este backup ZIP usa una compresión no compatible');
    if (compressedSize !== uncompressedSize) throw new Error('Tamaño ZIP inconsistente');

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('Entrada ZIP incompleta');

    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (!name || name.startsWith('/') || name.includes('..\\') || name.split('/').includes('..')) {
      throw new Error('Nombre de archivo no válido dentro del ZIP');
    }
    if (entries.has(name)) throw new Error(`Archivo duplicado en ZIP: ${name}`);
    entries.set(name, bytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }

  if (!entries.size) throw new Error('El ZIP está vacío');
  return entries;
}

function validateFullBackupZip(entries) {
  const jsonBytes = entries.get('coleccion.json');
  if (!jsonBytes) throw new Error('Falta coleccion.json');

  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes)); }
  catch { throw new Error('coleccion.json no es válido'); }

  if (payload.backupType !== 'MiColeccion-full') throw new Error('No es una copia completa de Mi Colección');
  if (Number(payload.backupFormatVersion) !== 1) throw new Error('Versión de backup no compatible');
  const base = validateJsonBackup(payload);
  if (Number(payload.itemCount) !== base.count) throw new Error('El número de elementos declarado no coincide');
  if (!Array.isArray(payload.images)) throw new Error('El manifiesto de imágenes no es válido');
  if (Number(payload.imageCount) !== payload.images.length) throw new Error('El número de imágenes declarado no coincide');

  const itemIds = new Set(payload.items.map(it => String(it.id).toUpperCase()));
  const manifestById = new Map();
  const manifestFiles = new Set();

  for (let i = 0; i < payload.images.length; i++) {
    const img = payload.images[i];
    if (!img || typeof img !== 'object') throw new Error(`Imagen ${i + 1}: manifiesto no válido`);
    const id = String(img.id || '').trim().toUpperCase();
    if (!isUlid(id)) throw new Error(`Imagen ${i + 1}: ULID no válido`);
    if (!itemIds.has(id)) throw new Error(`Imagen ${i + 1}: no existe su elemento`);
    if (img.role !== 'cover') throw new Error(`Imagen ${i + 1}: rol no compatible`);
    if (manifestById.has(id)) throw new Error(`Más de una carátula para ${id}`);

    const expected = `images/${id}_01.jpg`;
    if (String(img.filename || '') !== expected) throw new Error(`Imagen ${i + 1}: nombre no válido`);
    const fileBytes = entries.get(expected);
    if (!fileBytes || !fileBytes.length) throw new Error(`Falta la carátula ${expected}`);
    if (fileBytes.length > 1_000_000) throw new Error(`La carátula ${expected} supera 1 MB`);

    manifestById.set(id, img);
    manifestFiles.add(expected);
  }

  const extraImages = [...entries.keys()].filter(name => name.startsWith('images/') && !manifestFiles.has(name));
  if (extraImages.length) throw new Error(`El ZIP contiene ${extraImages.length} imagen(es) no declarada(s)`);

  // La relación items[].images <-> manifiesto debe ser exacta.
  let referencedCovers = 0;
  for (const item of payload.items) {
    const id = String(item.id).toUpperCase();
    const cover = Array.isArray(item.images) ? item.images.find(img => img && img.role === 'cover' && img.key) : null;
    if (cover) {
      referencedCovers++;
      if (!manifestById.has(id)) throw new Error(`El elemento ${id} referencia una carátula ausente`);
    } else if (manifestById.has(id)) {
      throw new Error(`El manifiesto contiene una carátula no referenciada por ${id}`);
    }
  }
  if (referencedCovers !== payload.images.length) throw new Error('Las referencias de carátula no coinciden con el manifiesto');

  return { payload, entries, count: base.count, imageCount: payload.images.length };
}

async function restoreApiJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function cleanupRestoreSession(sessionId) {
  try { await fetch(`/api/restore/${encodeURIComponent(sessionId)}`, { method: 'DELETE', cache: 'no-store' }); }
  catch (e) { console.warn('[cleanupRestoreSession]', e); }
}

async function handleImportFullBackupZip(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  let sessionId = null;
  try {
    if (AppConfig.backendMode !== 'd1') throw new Error('La restauración ZIP requiere backend D1');
    if (file.size > 120 * 1024 * 1024) throw new Error('El backup supera el límite de 120 MB');

    toast('Validando copia completa…', 'success', 1800);
    const entries = parseStoredZip(await file.arrayBuffer());
    const summary = validateFullBackupZip(entries);
    const exportedAt = summary.payload.exportedAt ? new Date(summary.payload.exportedAt) : null;
    const exportedLabel = exportedAt && !Number.isNaN(exportedAt.getTime())
      ? exportedAt.toLocaleString('es-ES')
      : 'fecha no disponible';
    const currentCount = Array.isArray(items) ? items.length : 0;

    const ok = confirm(
      `RESTAURAR COPIA COMPLETA\n\n` +
      `Backup: ${summary.count} elementos · ${summary.imageCount} carátulas\n` +
      `Exportado: ${exportedLabel}\n` +
      `Colección actual: ${currentCount} elementos\n\n` +
      `Se sustituirán D1 y las carátulas de R2 por el contenido de este ZIP.\n` +
      `Se conservarán los ULID originales.\n\n` +
      `¿Continuar?`
    );
    if (!ok) return;

    sessionId = crypto.randomUUID();
    await restoreApiJson(`/api/restore/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      body: JSON.stringify({ imageCount: summary.imageCount })
    });

    // Subimos primero todas las imágenes a una zona temporal de R2.
    let uploaded = 0;
    for (const img of summary.payload.images) {
      const id = String(img.id).toUpperCase();
      const bytes = summary.entries.get(img.filename);
      const response = await fetch(`/api/restore/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': img.contentType || 'image/jpeg' },
        body: bytes,
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `No se pudo subir la carátula ${id}`);
      uploaded++;
      if (uploaded === 1 || uploaded % 10 === 0 || uploaded === summary.imageCount) {
        toast(`Preparando restauración: ${uploaded}/${summary.imageCount} carátulas`, 'success', 1200);
      }
    }

    const result = await restoreApiJson(`/api/restore/${encodeURIComponent(sessionId)}/commit`, {
      method: 'POST',
      body: JSON.stringify({
        backupFormatVersion: summary.payload.backupFormatVersion,
        backupType: summary.payload.backupType,
        exportedAt: summary.payload.exportedAt || null,
        items: summary.payload.items,
        images: summary.payload.images.map(img => ({
          id: String(img.id).toUpperCase(),
          role: 'cover',
          contentType: img.contentType || 'image/jpeg'
        }))
      })
    });

    sessionId = null; // commit limpia la zona temporal
    await backend().refresh();
    currentCategory = null;
    currentPage = 1;
    showScreen('homeScreen');
    renderCategoryButtons();
    toast(`Copia restaurada: ${result.count} elementos, ${result.imageCount} carátulas`, 'success', 5000);
  } catch (err) {
    console.error('[handleImportFullBackupZip]', err);
    if (sessionId) await cleanupRestoreSession(sessionId);
    toast(`Restauración cancelada: ${err.message || 'error desconocido'}`, 'error', 6000);
  } finally {
    const input = document.getElementById('importFullBackupInput');
    if (input) input.value = '';
  }
}

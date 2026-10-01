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

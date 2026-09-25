  const screens = {
    homeScreen: document.getElementById('homeScreen'),
    addScreen: document.getElementById('addScreen'),
    categoryScreen: document.getElementById('categoryScreen')
  };

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const coverImage = document.getElementById('coverImage');
  const coverPreview = document.getElementById('coverPreview');
  
  // ==== DataStore (capa de persistencia) ====
  // Ahora guarda por colección: miColeccion.items.<collectionId>
  // Migra automáticamente desde el legacy: miColeccionItems
  const DataStore = {
    LEGACY_KEY: 'miColeccionItems',
    KEY_PREFIX: 'miColeccion.items.',
  
    _key(collectionId) {
      return this.KEY_PREFIX + String(collectionId || 'default');
    },
  
    load(collectionId) {
      const k = this._key(collectionId);
      try {
        const raw = localStorage.getItem(k);
        if (raw) return JSON.parse(raw);
      
        // --- Migración suave: si no hay datos en la key nueva, intenta legacy ---
        const legacyRaw = localStorage.getItem(this.LEGACY_KEY);
        if (legacyRaw) {
          const legacyArr = JSON.parse(legacyRaw) || [];
          // Copia al formato nuevo para esta colección
          localStorage.setItem(k, JSON.stringify(legacyArr));
          return legacyArr;
        }
      
        return [];
      } catch (e) {
        console.error('[DataStore.load]', e);
        return [];
      }
    },
  
    save(collectionId, arr) {
      const k = this._key(collectionId);
      try {
        localStorage.setItem(k, JSON.stringify(arr));
      
        // (Opcional) mantener legacy actualizado para poder volver atrás:
        // localStorage.setItem(this.LEGACY_KEY, JSON.stringify(arr));
      } catch (e) {
        const msg = 'No se han podido guardar (almacenamiento lleno)';
        if (typeof toast === 'function') toast(msg, 'error', 2600);
        else alert(msg);
        console.error('[DataStore.save] almacenamiento lleno o fallo al guardar', e);
        throw e;
      }
    }
  };
  
  
// ==== InventoryRepo (único punto de acceso a datos) ====
// Hoy: localStorage (vía DataStore). Mañana: Firestore + listeners realtime.
const InventoryRepo = (() => {
  
  // listeners por collectionId
  const listenersByCollection = new Map(); // collectionId -> Set<fn>
  
  function getListeners(collectionId) {
    if (!listenersByCollection.has(collectionId)) {
      listenersByCollection.set(collectionId, new Set());
    }
    return listenersByCollection.get(collectionId);
  }
  
  function notify(collectionId, items) {
    const set = listenersByCollection.get(collectionId);
    if (!set) return;
    set.forEach(fn => fn(items));
  }
  
  return {
    
    loadAll(collectionId) {
      return DataStore.load(collectionId);
    },
    
    saveAll(collectionId, arr) {
      DataStore.save(collectionId, arr);
      notify(collectionId, arr);
    },
    
    subscribe(collectionId, callback) {
      const set = getListeners(collectionId);
      set.add(callback);
      callback(DataStore.load(collectionId)); // primera carga
      
      return () => {
        set.delete(callback);
        // limpieza opcional
        if (set.size === 0) listenersByCollection.delete(collectionId);
      };
    },
    
    upsert(collectionId, item) {
      const items = DataStore.load(collectionId);
      const idx = items.findIndex(x => x.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      
      DataStore.save(collectionId, items);
      notify(collectionId, items);
    },
    
    remove(collectionId, itemId) {
      const items = DataStore.load(collectionId).filter(x => x.id !== itemId);
      DataStore.save(collectionId, items);
      notify(collectionId, items);
    }
    
  };
  
})();


// ===== Configuración global de la app =====
const AppConfig = {
  appName: 'Mi Colección',
  backendMode: 'local', // hoy: local | mañana: firebase
  defaultCollectionId: 'default',
  sessionStorageKey: 'miColeccion.session',
  collectionStorageKey: 'miColeccion.collectionId',
  schemaVersion: 2,
  
  firebase: {
    enabled: false,
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  }
};


  
// ===== Collection context (hoy local, mañana householdId en Firebase) =====
const CollectionContext = {
  key: AppConfig.collectionStorageKey,
  
  get() {
    return localStorage.getItem(this.key) || AppConfig.defaultCollectionId;
  },
  
  set(id) {
    localStorage.setItem(this.key, id);
  }
};


// ===== Session context (hoy local/mock, mañana Firebase Auth) =====
const SessionContext = {
  KEY: AppConfig.sessionStorageKey,
  
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || 'null');
    } catch {
      return null;
    }
  },
  
  setUser(user) {
    localStorage.setItem(this.KEY, JSON.stringify(user || null));
  },
  
  clear() {
    localStorage.removeItem(this.KEY);
  },
  
  isLoggedIn() {
    return !!this.getUser();
  }
};





  let items = [];
  let unsubscribeItems = null;
  let categories = ['CDs', 'Libros', 'Películas', 'Videojuegos', 'Vinilos', 'Otros'];
  let currentItemId = null;
  let currentView = 'cover'; // por defecto 'miniaturas'
  let currentCategory = null;
  let currentPage = 1;
  const itemsPerPage = 6;
  let currentFilters = { text: '', author: '', format: '', genre: '', year: '', subcategory: '' };


  // IDs canónicos: ULID permanente e independiente de los campos editables.
  const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function encodeUlidTime(time, length = 10) {
    let value = Math.floor(Number(time));
    let out = '';
    for (let i = 0; i < length; i++) {
      out = ULID_ALPHABET[value % 32] + out;
      value = Math.floor(value / 32);
    }
    return out;
  }

  function randomUlidPart(length = 16) {
    const bytes = new Uint8Array(length);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, b => ULID_ALPHABET[b & 31]).join('');
  }

  function generateUlid() {
    return encodeUlidTime(Date.now(), 10) + randomUlidPart(16);
  }

  function isUlid(value) {
    return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(value || '').toUpperCase());
  }

  function generateId() {
    return generateUlid();
  }

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeText(s){
  return (s ?? '').toString().normalize('NFKC').trim().toLowerCase();
}

function currentCollectionId() {
  return CollectionContext.get();
}


function canonicalizeType(s){
  const t = normalizeText(s);
  if (t === 'vinilo' || t === 'vinilos') return 'Vinilos';
  if (t === 'cd' || t === 'cds') return 'CDs';
  if (t === 'pelicula' || t === 'películas' || t === 'peliculas') return 'Películas';
  if (t === 'videojuego' || t === 'videojuegos') return 'Videojuegos';
  if (t === 'libro' || t === 'libros') return 'Libros';
  if (t === 'otros') return 'Otros';
  const known = ['CDs','Libros','Películas','Videojuegos','Vinilos','Otros'];
  const found = known.find(k => normalizeText(k) === t);
  return found ?? s;
}

function stableKeyForItem(it) {
  return [
    canonicalizeType(it.type),
    normalizeText(it.title),
    normalizeText(it.author),
    String(it.year ?? '').trim(),
    normalizeText(it.format),
    normalizeText(it.subcategory),
    normalizeText(it.genre)
  ].join('|');
}

// Hash rápido y estable (FNV-1a 32-bit) -> id corto
function stableIdFromKey(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // prefijo para distinguir de ids aleatorios antiguos
  return 'i_' + (h >>> 0).toString(36);
}

// Compatibilidad: la clave histórica sigue sirviendo para detectar coincidencias,
// pero nunca vuelve a ser la identidad primaria de un ítem.
function generateItemId() {
  return generateUlid();
}

const SchemaManager = {
  VERSION_KEY_PREFIX: 'miColeccion.schemaVersion.',
  BACKUP_KEY_PREFIX: 'miColeccion.backup.preSchema2.',

  versionKey(collectionId) {
    return this.VERSION_KEY_PREFIX + String(collectionId || AppConfig.defaultCollectionId);
  },

  backupKey(collectionId) {
    return this.BACKUP_KEY_PREFIX + String(collectionId || AppConfig.defaultCollectionId);
  },

  normalizeV2Item(item) {
    const source = (item && typeof item === 'object') ? item : {};
    const oldId = String(source.id || '').trim();
    const canonicalId = isUlid(oldId) ? oldId.toUpperCase() : generateUlid();
    const legacyId = String(source.legacyId || (!isUlid(oldId) ? oldId : '') || '').trim();
    const images = Array.isArray(source.images) ? source.images : [];

    return {
      ...source,
      id: canonicalId,
      schemaVersion: AppConfig.schemaVersion,
      legacyId: legacyId || null,
      legacyKey: stableKeyForItem(source),
      images,
      coverImage: source.coverImage || null
    };
  },

  verify(itemsToVerify) {
    if (!Array.isArray(itemsToVerify)) throw new Error('La colección migrada no es un array');
    const ids = itemsToVerify.map(it => String(it?.id || ''));
    if (ids.some(id => !isUlid(id))) throw new Error('Hay IDs no válidos tras la migración');
    if (new Set(ids).size !== ids.length) throw new Error('Hay IDs duplicados tras la migración');
    if (itemsToVerify.some(it => it.schemaVersion !== AppConfig.schemaVersion)) {
      throw new Error('Hay registros con versión de esquema incorrecta');
    }
  },

  migrateCollection(collectionId) {
    const cid = String(collectionId || AppConfig.defaultCollectionId);
    const current = DataStore.load(cid);
    if (!Array.isArray(current)) throw new Error('Los datos actuales no tienen un formato válido');

    const alreadyV2 = current.every(it => isUlid(it?.id) && it?.schemaVersion === AppConfig.schemaVersion && Array.isArray(it?.images));
    if (alreadyV2) {
      localStorage.setItem(this.versionKey(cid), String(AppConfig.schemaVersion));
      return { migrated: false, count: current.length };
    }

    // Una única copia previa por colección. No se sobrescribe en aperturas posteriores.
    const backupKey = this.backupKey(cid);
    if (!localStorage.getItem(backupKey)) {
      localStorage.setItem(backupKey, JSON.stringify({
        createdAt: new Date().toISOString(),
        fromSchemaVersion: 1,
        collectionId: cid,
        items: current
      }));
    }

    const migrated = current.map(item => this.normalizeV2Item(item));
    this.verify(migrated);
    DataStore.save(cid, migrated);

    const persisted = DataStore.load(cid);
    this.verify(persisted);
    if (persisted.length !== current.length) {
      throw new Error('La cantidad de registros cambió durante la migración');
    }

    localStorage.setItem(this.versionKey(cid), String(AppConfig.schemaVersion));
    return { migrated: true, count: migrated.length };
  }
};

function safeUrl(v){
  if (!v) return '';
  try { return new URL(v).href; } catch { return ''; }
}

// ===== Toast (feedback no intrusivo) =====
let toastTimer = null;

function toast(message, type = 'success', ms = 1600) {
  const el = document.getElementById('toast');
  if (!el) return;
  
  el.textContent = String(message || '');
  el.classList.remove('success', 'error');
  el.classList.add(type === 'error' ? 'error' : 'success');
  
  // Reiniciar animación si se llama varias veces rápido
  el.classList.remove('show');
  // Forzar reflow para que la transición vuelva a disparar
  void el.offsetWidth;
  el.classList.add('show');
  
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, ms);
}

function flashSuccess(message = 'Acción completada') {
  toast(message, 'success', 1800);
}

  function renderCategoryButtons() {
  const container = document.getElementById('categoryButtons');
  container.innerHTML = '';

  // Rejilla 2 columnas con baldosas cuadradas
  const sorted = [...categories].sort();
  sorted.forEach(cat => {
    const tile = document.createElement('button');
    tile.className = 'cat-tile';
    tile.textContent = cat;
    tile.onclick = () => showCategory(cat);
    container.appendChild(tile);
  });

  // Contenedor de acciones pequeñas (Añadir / Importar) bajo la rejilla
  let actions = document.getElementById('homeActions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'homeActions';
    // insertarlo justo debajo del grid
    container.parentNode.insertBefore(actions, container.nextSibling);
  }
  actions.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'action-btn';
  addBtn.textContent = '+ Añadir';
  addBtn.onclick = () => showScreen('addScreen');

  const importBtn = document.createElement('button');
  importBtn.className = 'action-btn';
  importBtn.textContent = '+ Importar';
  importBtn.onclick = () => {
    // si tienes un input oculto para Excel, úsalo
    const hidden = document.getElementById('importExcelInput');
    if (hidden) {
      hidden.click();
    } else {
      // fallback: crear uno temporal y usar tu handleImportExcel
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls';
      input.style.display = 'none';
      input.addEventListener('change', handleImportExcel);
      document.body.appendChild(input);
      input.click();
    }
  };

  const exportBtn = document.createElement('button');
  exportBtn.className = 'action-btn';
  exportBtn.textContent = '⬇️ Exportar';
  exportBtn.onclick = () => openExportMenu();

  actions.appendChild(addBtn);
  actions.appendChild(importBtn);
  actions.appendChild(exportBtn);
  }
  

function renderCategorySelect() {
  const select = document.getElementById('type');
  if (!select) return;
  
  select.innerHTML = '<option value="" disabled selected>Selecciona una categoría</option>';
  const sorted = [...categories].sort();
  sorted.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
}
    
    
  function startAppData() {
    if (unsubscribeItems) unsubscribeItems();
  
  
    unsubscribeItems = backend().subscribe((newItems) => {
      items = Array.isArray(newItems) ? newItems : [];
    
      // Solo repintar lo necesario
      if (currentCategory) {
        renderItems(currentCategory);
        populateFilterOptions(currentCategory);
      }
    });
  }
  
  
  function switchCollection(collectionId) {
    const nextId = String(collectionId || '').trim();
    if (!nextId) return;
    
    CollectionContext.set(nextId);

    try {
      SchemaManager.migrateCollection(nextId);
    } catch (error) {
      console.error('[switchCollection] Migración fallida', error);
      toast('No se pudo abrir la colección seleccionada', 'error', 2600);
      return;
    }
    
    currentCategory = null;
    currentPage = 1;
    currentFilters = { text: '', author: '', format: '', genre: '', year: '', subcategory: '' };
    currentItemId = null;
    items = [];
    
    startAppData();
    renderCategoryButtons();
    showScreen('homeScreen');
  }
  
  
  function setActiveSession(user) {
    SessionContext.setUser(user || null);
    
    if (user && user.collectionId) {
      switchCollection(user.collectionId);
    } else {
      if (unsubscribeItems) {
        unsubscribeItems();
        unsubscribeItems = null;
      }
      
      currentCategory = null;
      currentPage = 1;
      currentFilters = { text: '', author: '', format: '', genre: '', year: '', subcategory: '' };
      currentItemId = null;
      items = [];
      
      renderCategoryButtons();
      showScreen('homeScreen');
    }
  }
  
  
  const AppBackend = {
    getCollectionId() {
      return currentCollectionId();
    },
    
    switchCollection(collectionId) {
      switchCollection(collectionId);
    },
    
    loadAll() {
      return InventoryRepo.loadAll(currentCollectionId());
    },
    
    saveAll(arr) {
      return InventoryRepo.saveAll(currentCollectionId(), arr);
    },
    
    upsert(item) {
      return InventoryRepo.upsert(currentCollectionId(), item);
    },
    
    remove(itemId) {
      return InventoryRepo.remove(currentCollectionId(), itemId);
    },
    
    subscribe(callback) {
      return InventoryRepo.subscribe(currentCollectionId(), callback);
    }
  };
  
  
  // ===== Backend Firebase (placeholder para futura implementación) =====
  const FirebaseBackend = {
    
    loadAll() {
      throw new Error("FirebaseBackend.loadAll() no implementado todavía");
    },
    
    saveAll(arr) {
      throw new Error("FirebaseBackend.saveAll() no implementado todavía");
    },
    
    upsert(item) {
      throw new Error("FirebaseBackend.upsert() no implementado todavía");
    },
    
    remove(itemId) {
      throw new Error("FirebaseBackend.remove() no implementado todavía");
    },
    
    subscribe(callback) {
      throw new Error("FirebaseBackend.subscribe() no implementado todavía");
    }
    
  };
  
  
  
  const BackendProvider = {
    current: AppBackend,
    
    get() {
      return this.current;
    },
    
    set(backend) {
      if (!backend || typeof backend.subscribe !== 'function') {
        throw new Error('Backend inválido');
      }
      this.current = backend;
    }
  };
  
  
  if (AppConfig.backendMode === 'firebase') {
    BackendProvider.set(FirebaseBackend);
  } else {
    BackendProvider.set(AppBackend);
  }
  
  function backend() {
    return BackendProvider.get();
  }

 
  function showScreen(id) {
      // Activar solo la pantalla actual
      Object.values(screens).forEach(screen => screen.classList.remove('active'));
      screens[id].classList.add('active');
  
      // Ocultar paginación si no estamos en la pantalla de categoría
      const pagination = document.getElementById('paginationControls');
      if (pagination && id !== 'categoryScreen') {
        pagination.innerHTML = '';
      }
  
      // Mostrar/ocultar botón de cambio de vista (👁)
      const viewBtn = document.querySelector('.toggle-view-btn');
      if (viewBtn) {
        viewBtn.style.display = (id === 'categoryScreen') ? 'block' : 'none';
      }
    }
  
  
  function showCategory(category){
  const canon = canonicalizeType(category);
  showScreen('categoryScreen');
  document.getElementById('categoryTitle').innerText = canon;
  currentCategory = canon;

  // 🔹 Reset filtros al entrar (si tienes esta función)
  if (typeof resetFiltersUIAndState === 'function') {
    resetFiltersUIAndState();
  }

  currentPage = 1;
  renderItems(canon);
}
  
// Muestra/oculta la barra de filtros y engancha los botones
function toggleSearch(){
  const bar = document.getElementById('filtersBar');
  if (!bar) return;

  // Alternar visibilidad
  const show = bar.style.display === 'none' || bar.style.display === '';
  bar.style.display = show ? 'grid' : 'none';
  bar.setAttribute('aria-hidden', show ? 'false' : 'true');

  if (!show) return; // si se oculta, no hay nada más que hacer

  // Rellenar selects según la categoría actual
  populateFilterOptions(currentCategory);

  // Subcategoría solo visible si la categoría es "Otros"
  const subWrap = document.getElementById('filterSubcatWrap');
  if (subWrap) subWrap.style.display = (currentCategory === 'Otros') ? 'block' : 'none';

  // Evitar listeners duplicados: clonar botones
  const applyOld = document.getElementById('applyFiltersBtn');
  const clearOld = document.getElementById('clearFiltersBtn');
  if (!applyOld || !clearOld) return;

  const applyBtn = applyOld.cloneNode(true);
  const clearBtn = clearOld.cloneNode(true);
  applyOld.parentNode.replaceChild(applyBtn, applyOld);
  clearOld.parentNode.replaceChild(clearBtn, clearOld);

  // Aplicar filtros (incluye GÉNERO)
  applyBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    currentFilters.text   = (document.getElementById('filterText')?.value   || '').toLowerCase().trim();
    currentFilters.author = (document.getElementById('filterAuthor')?.value || '').toLowerCase().trim();
    currentFilters.format = (document.getElementById('filterFormat')?.value || '').trim();
    currentFilters.genre  = (document.getElementById('filterGenre')?.value  || '').trim(); // ← NUEVO
    currentFilters.year   = (document.getElementById('filterYear')?.value   || '').trim();

    const subEl = document.getElementById('filterSubcategory');
    currentFilters.subcategory = (subEl && currentCategory === 'Otros') ? (subEl.value || '').trim() : '';

    currentPage = 1;
    renderItems(currentCategory);
    
    // ✅ Cerrar panel de filtros tras aplicar
    bar.style.display = 'none';
    bar.setAttribute('aria-hidden', 'true');
  });
  
  

  // Limpiar filtros (usa tu helper global)
  clearBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    if (typeof resetFiltersUIAndState === 'function') {
      resetFiltersUIAndState(); // ahora también limpia genre
    } else {
      // Fallback si no existe el helper
      currentFilters = { text:'', author:'', format:'', genre:'', year:'', subcategory:'' };
      ['filterText','filterAuthor','filterFormat','filterGenre','filterYear','filterSubcategory'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    }
    currentPage = 1;
    renderItems(currentCategory);
    // ✅ Cerrar panel de filtros tras limpiar
    bar.style.display = 'none';
    bar.setAttribute('aria-hidden', 'true');
  });

  // Foco inicial en el texto
  document.getElementById('filterText')?.focus();
}
  
 function toggleView() {
  currentView = currentView === 'list' ? 'cover' : 'list';
  localStorage.setItem('viewMode', currentView);
  renderItems(currentCategory);
}
  
function showItemDetails(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  
  currentItemId = id;
  const modalBody = document.getElementById('modalBody');
  
  const coverHtml = item.coverImage ?
    `<img src="${item.coverImage}" alt="${escapeHtml(item.title || '')}" class="image-preview" style="display:block; margin:0 auto;" />` :
    `<img src="${getPlaceholderForType(item.type)}" alt="placeholder" class="image-preview" style="display:block; margin:0 auto;" />`;
  
  const moreInfoHtml = item.moreInfo ?
    `<p><strong>Más info:</strong> <a href="${item.moreInfo}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.moreInfo)}</a></p>` :
    '';
  
  const subcatHtml = (canonicalizeType(item.type) === 'Otros' && item.subcategory) ?
    `<p><strong>Subcategoría:</strong> ${escapeHtml(item.subcategory || '')}</p>` :
    '';
  
  const genreHtml = item.genre ?
    `<p><strong>Género:</strong> ${escapeHtml(item.genre || '')}</p>` :
    '';
  
  modalBody.innerHTML = `
    <h3>${escapeHtml(item.title || '(Sin título)')}</h3>
    <div style="text-align:center; margin-bottom:16px;">
      ${coverHtml}
    </div>
    <div style="text-align:left;">
      <p><strong>Categoría:</strong> ${escapeHtml(item.type || '')}</p>
      ${subcatHtml}
      <p><strong>Autor / Artista:</strong> ${escapeHtml(item.author || '')}</p>
      <p><strong>Formato:</strong> ${escapeHtml(item.format || '')}</p>
      ${genreHtml}
      <p><strong>Año:</strong> ${escapeHtml(item.year || '')}</p>
      ${moreInfoHtml}
      <p><strong>Notas:</strong> ${escapeHtml(item.notes || '')}</p>
    </div>

    <div class="modal-buttons" style="display:flex; gap:10px; margin-top:12px; justify-content:center;">
      <button type="button" class="button" id="editItemBtn">Editar</button>
      <button type="button" class="button danger" id="deleteItemBtn">Eliminar</button>
      <button type="button" class="button secondary" id="closeDetailsBtn">Cerrar</button>
    </div>
  `;
  
  document.getElementById('editItemBtn')?.addEventListener('click', () => enableEditMode());
  document.getElementById('deleteItemBtn')?.addEventListener('click', () => openConfirmDeleteModal());
  document.getElementById('closeDetailsBtn')?.addEventListener('click', () => closeModal());
  
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'block';
}
  
  function enableEditMode() {
    const item = items.find(i => i.id === currentItemId);
    if (!item) return;
  
    const modalBody = document.getElementById('modalBody');
    const itemTypeCanon = canonicalizeType(item.type);
  
    modalBody.innerHTML = `
      <h3>Editar Ítem</h3>

      <form id="editItemForm" novalidate>
        <input
          type="text"
          id="edit-title"
          value="${escapeHtml(item.title || '')}"
          placeholder="Título"
          required
        />

        <select id="edit-type" required>
          ${categories.map(cat => {
            const safeCat = escapeHtml(cat);
            const selected = (canonicalizeType(cat) === itemTypeCanon) ? 'selected' : '';
            return `<option value="${safeCat}" ${selected}>${safeCat}</option>`;
          }).join('')}
        </select>

        <select id="edit-subcategory" style="display:none;">
          <option value="" ${!item.subcategory ? 'selected' : ''}>Selecciona una subcategoría</option>
          <option value="Funkos" ${item.subcategory==='Funkos' ? 'selected' : ''}>Funkos</option>
          <option value="Lego" ${item.subcategory==='Lego' ? 'selected' : ''}>Lego</option>
          <option value="Otros" ${item.subcategory==='Otros' ? 'selected' : ''}>Otros</option>
        </select>

        <input
          type="text"
          id="edit-author"
          value="${escapeHtml(item.author || '')}"
          placeholder="Autor / Director / Artista"
        />

        <input
          type="text"
          id="edit-format"
          value="${escapeHtml(item.format || '')}"
          placeholder="Formato"
        />

        <input
          type="text"
          id="edit-genre"
          value="${escapeHtml(item.genre || '')}"
          placeholder="Género"
        />

        <input
          type="text"
          id="edit-year"
          value="${escapeHtml(item.year || '')}"
          placeholder="Año"
          inputmode="numeric"
        />

        <textarea
          id="edit-notes"
          placeholder="Notas (opcional)"
        >${escapeHtml(item.notes || '')}</textarea>

        <input
          type="text"
          id="edit-moreInfo"
          value="${escapeHtml(item.moreInfo || '')}"
          placeholder="Más info (URL)"
        />

        <label for="edit-coverImage" style="width:100%; text-align:left; display:block; margin-top:8px;">
          Cambiar imagen de portada (opcional):
        </label>

        <input type="file" id="edit-coverImage" accept="image/*" />

        <div style="text-align:center; margin:12px 0;">
          ${
            item.coverImage
              ? `<img src="${escapeHtml(item.coverImage)}" id="edit-coverPreview" class="image-preview" style="display:block; margin:0 auto;" />`
              : `<img id="edit-coverPreview" class="image-preview" style="display:none; margin:0 auto;" />`
          }
        </div>

        <div class="modal-buttons" style="display:flex; gap:10px; justify-content:center; margin-top:12px;">
          <button type="submit" class="button save-btn">Guardar</button>
          <button type="button" class="button danger" onclick="openConfirmDeleteModal()">Eliminar</button>
        </div>
      </form>
    `;
  
    // --- lógica de subcategoría ---
    const editTypeSelect = document.getElementById('edit-type');
    const editSub = document.getElementById('edit-subcategory');
  
    const refreshSubcategoryVisibility = () => {
      if (canonicalizeType(editTypeSelect.value) === 'Otros') {
        editSub.style.display = 'block';
      } else {
        editSub.style.display = 'none';
        editSub.value = '';
      }
    };
  
    refreshSubcategoryVisibility();
    editTypeSelect.addEventListener('change',   refreshSubcategoryVisibility);
   
    // --- handler de imagen (ya tienes compresión + límite) ---
    const coverInput = document.getElementById('edit-coverImage');
    const previewImg = document.getElementById('edit-coverPreview');
  
    coverInput?.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
    
      try {
        const dataUrl = await compressImageToJpegDataURL(file, 512, 0.75);
      
        if (isCoverTooLarge(dataUrl)) {
          previewImg.style.display = 'none';
          previewImg.src = '';
          toast('Imagen demasiado grande. Prueba otra o recórtala.', 'error', 2600);
          return;
        }
      
        previewImg.src = dataUrl;
        previewImg.style.display = 'block';
        previewImg.style.margin = '0 auto';
      } catch (err) {
        console.error('[edit-coverImage]', err);
        toast('No se pudo procesar la imagen', 'error', 2600);
      }
    });
  
  
  document.getElementById('editItemForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const index = items.findIndex(i => i.id === currentItemId);
    if (index === -1) return;
    
    const newTypeRaw = document.getElementById('edit-type').value;
    const newType = canonicalizeType(newTypeRaw);
    const newSub = (newType === 'Otros') ? (document.getElementById('edit-subcategory').value || '') : '';
    
    const updated = {
      ...items[index],
      title: document.getElementById('edit-title').value.trim(),
      author: document.getElementById('edit-author').value.trim(),
      format: document.getElementById('edit-format').value.trim(),
      genre: document.getElementById('edit-genre').value.trim(),
      year: document.getElementById('edit-year').value.trim(),
      notes: document.getElementById('edit-notes').value.trim(),
      moreInfo: safeUrl(document.getElementById('edit-moreInfo').value.trim()),
      type: newType,
      subcategory: newSub
    };
    
    if (previewImg && previewImg.style.display === 'block') {
      updated.coverImage = previewImg.src;
    }
    
    const prev = items[index];

    // El ULID es permanente. Solo se actualiza la clave auxiliar de coincidencia.
    updated.id = prev.id;
    updated.schemaVersion = AppConfig.schemaVersion;
    updated.legacyId = prev.legacyId || null;
    updated.legacyKey = stableKeyForItem(updated);
    updated.images = Array.isArray(prev.images) ? prev.images : [];

    backend().upsert({
      ...prev,
      ...updated,
      coverImage: (updated.coverImage || prev.coverImage || null)
    });
    
    closeModal();
    showCategory(updated.type);
    flashSuccess('Guardado correctamente');
  });
 }
  
   function saveEdit() {
      throw new Error('saveEdit() es legacy y está deshabilitada. La edición actual se gestiona con enableEditMode().');
   }
  
  
   function deleteItem() {
      // Compatibilidad: si algún botón viejo llama a deleteItem(), usa el modal nuevo
      openConfirmDeleteModal();
   }
   
   // ===== Imagen: convertir a JPEG comprimido (para ahorrar localStorage) =====
function compressImageToJpegDataURL(file, maxW = 512, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas no soportado'));
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===== P4: límite preventivo de imagen (evita llenar localStorage) =====
const MAX_COVER_DATAURL_CHARS = 480000; // ~350KB aprox en base64 (no exacto)
function isCoverTooLarge(dataUrl) {
  return typeof dataUrl === 'string' && dataUrl.length > MAX_COVER_DATAURL_CHARS;
}

  function closeModal() {
    modal.style.display = 'none';
  }
  

  coverImage.addEventListener('change', async function(event) {
      const file = event.target.files?.[0];
      if (!file) {
        coverPreview.style.display = 'none';
        return;
      }
  
      try {
        const dataUrl = await compressImageToJpegDataURL(file, 512, 0.75);
  
        if (isCoverTooLarge(dataUrl)) {
          coverPreview.style.display = 'none';
          coverPreview.src = '';
          toast('Imagen demasiado grande. Prueba otra o recórtala.', 'error', 2600);
          return;
        }
  
        coverPreview.src = dataUrl;
        coverPreview.style.display = 'block';
        } catch (err) {
        console.error('[coverImage]', err);
        if (typeof toast === 'function') toast('No se pudo procesar la imagen', 'error', 2200);
        coverPreview.style.display = 'none';
      }
  });
  
  // --- Guardar un nuevo ítem desde el formulario de alta ---
  document.getElementById('addItemForm').addEventListener('submit', (e)=>{
    e.preventDefault();

    const finalTypeRaw = document.getElementById('type').value;
    const finalType = canonicalizeType(finalTypeRaw);
    if (!finalType) {
      toast('Selecciona una categoría', 'error', 2000);
      return;
    }
    
    const sub = (finalType === 'Otros') ? (document.getElementById('subcategory').value || '') : '';

    const newItem = {
      id: generateItemId(),
      schemaVersion: AppConfig.schemaVersion,
      legacyId: null,
      legacyKey: '',
      images: [],
      title: String(document.getElementById('title').value).trim(),
      type: finalType,
      author: String(document.getElementById('author').value).trim(),
      format: String(document.getElementById('format').value).trim(),
      genre:  String(document.getElementById('genre').value).trim(),   // ← nuevo campo
      year:   String(document.getElementById('year').value).trim(),
      notes:  String(document.getElementById('notes').value).trim(),
      coverImage: (coverPreview.style.display === 'block') ? coverPreview.src : null,
      moreInfo: safeUrl(document.getElementById('moreInfo').value.trim()),
      subcategory: sub
    };

    newItem.legacyKey = stableKeyForItem(newItem);
    backend().upsert(newItem);

        e.target.reset();
    coverPreview.style.display = 'none';
    showCategory(finalType);

    flashSuccess('Guardado correctamente');
  });
  
  function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');

  // Guardar preferencia
  localStorage.setItem('theme', isDark ? 'dark' : 'light');

  // Cambiar icono según tema
  const themeBtn = document.getElementById('themeBtn');
  themeBtn.textContent = isDark ? '☀️' : '🌙';
}


function openConfirmDeleteModal() {
  document.getElementById('confirmDeleteModal').style.display = 'block';
}

function closeConfirmDeleteModal() {
  document.getElementById('confirmDeleteModal').style.display = 'none';
}

function confirmDelete() {
  const idToDelete = currentItemId;
  
  // Si por lo que sea no hay id, salimos limpio
  if (!idToDelete) {
    closeConfirmDeleteModal();
    closeModal();
    return;
  }
  
  backend().remove(idToDelete);
  
  // Limpia selección para evitar acciones sobre un id ya eliminado
  currentItemId = null;
  
  closeConfirmDeleteModal();
  closeModal();
  
  // Refresca usando el estado, no el DOM
  if (currentCategory) showCategory(currentCategory);
  else showScreen('homeScreen');
  
    // Feedback (unificado)
  flashSuccess('Eliminado correctamente');
}

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
      
      // ✅ Import real (se usa tanto en modal como en fallback)
      const applyImport = () => {
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
        
        applyImport();
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
  
        freshOk.addEventListener('click', () => {
          closeImportConfirmModal();
          applyImport(); // ✅
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

 

function populateFilterOptions(category) {
  const canon = canonicalizeType(category);
  const inCat = items.filter(i => canonicalizeType(i.type) === canon);
  
  const formats = [...new Set(inCat.map(i => String(i.format ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  
  const years = [...new Set(inCat.map(i => String(i.year ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  
  const genres = [...new Set(inCat.map(i => String(i.genre ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  
  // Helper: repoblar un <select> de forma segura (sin innerHTML con datos)
  function fillSelect(sel, defaultLabel, values) {
    if (!sel) return;
    const prev = String(sel.value || '');
    
    // Limpia
    sel.textContent = '';
    
    // Default
    const def = document.createElement('option');
    def.value = '';
    def.textContent = defaultLabel;
    sel.appendChild(def);
    
    // Options seguras
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v; // value NO ejecuta HTML
      opt.textContent = v; // textContent => seguro
      sel.appendChild(opt);
    }
    
    // Intenta mantener selección previa si sigue existiendo
    const prevNorm = String(prev || '').trim();
    if (prevNorm) {
      const match = values.find(v => String(v).trim() === prevNorm);
      if (match) sel.value = match;
    }
  }
  
  fillSelect(document.getElementById('filterFormat'), 'Todos los formatos', formats);
  fillSelect(document.getElementById('filterYear'), 'Todos los años', years);
  fillSelect(document.getElementById('filterGenre'), 'Todos los géneros', genres);
}


// --- Placeholders embebidos (sin red) ---
function svgPlaceholder(label, emoji) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
       <rect width='100%' height='100%' rx='12' fill='#2f2f45'/>
       <text x='50%' y='46%' dominant-baseline='middle' text-anchor='middle' font-size='52'>${emoji}</text>
       <text x='50%' y='88%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='#cfd8dc'>${label}</text>
     </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function getPlaceholderForType(type) {
  switch (type) {
    case 'Libros':       return svgPlaceholder('Libro',     '📘');
    case 'Películas':    return svgPlaceholder('Película',  '🎬');
    case 'Videojuegos':  return svgPlaceholder('Juego',     '🎮');
    case 'CDs':          return svgPlaceholder('CD',        '💿');
    case 'Vinilos':      return svgPlaceholder('Vinilo',    '📀');
    case 'Otros':        return svgPlaceholder('Otros',     '📦');
    default:             return svgPlaceholder('Ítem',      '🗂️');
  }
}

function renderItems(category){
  const list = document.getElementById('itemList');
  const pagination = document.getElementById('paginationControls');
  const countEl = document.getElementById('categoryItemCount');

  // Normaliza la categoría actual
  const canonCat = canonicalizeType(category);

  // Filtrado robusto (forzando strings)
  const filtered = items
    .filter(item => {
      if (canonicalizeType(item.type) !== canonCat) return false;

      const titleOk  = normalizeText(item.title).includes(currentFilters.text || '');
      const authorOk = normalizeText(item.author).includes(currentFilters.author || '');
      const formatOk = !currentFilters.format || String(item.format ?? '') === currentFilters.format;
      const genreOk  = !currentFilters.genre  || String(item.genre  ?? '') === currentFilters.genre;
      const yearOk   = !currentFilters.year   || String(item.year   ?? '') === currentFilters.year;
      const subOk    = (canonCat !== 'Otros')
        ? true
        : (!currentFilters.subcategory || String(item.subcategory ?? '') === currentFilters.subcategory);

      return titleOk && authorOk && formatOk && genreOk && yearOk && subOk;
    })
    .sort((a,b)=>
      String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es', { sensitivity:'base', numeric:true })
    );

  // Paginación
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = filtered.slice(startIndex, startIndex + itemsPerPage);

  // Reset UI
  countEl.textContent = `Total: ${filtered.length} ítem${filtered.length!==1?'s':''}`;
  list.innerHTML = '';
  pagination.innerHTML = '';

  // Vacío
  if (filtered.length === 0){
    list.innerHTML = '<p style="text-align:center;">No hay ítems en esta categoría con los filtros actuales.</p>';
    return;
  }

  // Render: lista o cuadrícula
  if (currentView === 'list') {
    currentItems.forEach(item => {
      const div = document.createElement('div');
      div.className = 'item';

      // ✅ Construcción segura: sin innerHTML
      const titleEl = document.createElement('strong');
      titleEl.textContent = String(item.title || '(Sin título)');
      div.appendChild(titleEl);

      div.appendChild(document.createElement('br'));
      div.appendChild(document.createTextNode(String(item.author || '')));

      // Subcategoría solo en "Otros"
      const sub = String(item.subcategory || '').trim();
      if (canonCat === 'Otros' && sub) {
        div.appendChild(document.createElement('br'));
        const small = document.createElement('small');
        small.className = 'subcat-inline';
        small.textContent = `Subcategoría: ${sub}`;
        div.appendChild(small);
      }

      div.onclick = () => showItemDetails(item.id);
      list.appendChild(div);
    });
  } else {
    const grid = document.createElement('div');
    grid.className = 'cover-grid';
    currentItems.forEach(item => {
      const img = document.createElement('img');
      img.src = item.coverImage ? item.coverImage : getPlaceholderForType(item.type);
      img.alt = String(item.title || 'placeholder');
      img.loading = 'lazy';
      img.onclick = () => showItemDetails(item.id);
      grid.appendChild(img);
    });
    list.appendChild(grid);
  }

  // Controles de paginación (select + primera/prev/sig/última)
  if (totalPages > 1){

    const makeBtn = (label, onClick, {disabled=false, title=''} = {}) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title || label;
      b.className = 'page-btn'; // ✅ estilos por clase (tema-aware)
      if (disabled) b.disabled = true;
      else b.onclick = onClick;
      return b;
    };

    // « Primera
    pagination.appendChild(
      makeBtn('«', () => { currentPage = 1; renderItems(canonCat); }, { disabled: currentPage === 1, title: 'Primera página' })
    );

    // ‹ Anterior
    pagination.appendChild(
      makeBtn('‹', () => { currentPage -= 1; renderItems(canonCat); }, { disabled: currentPage === 1, title: 'Página anterior' })
    );

    // Select de páginas
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Seleccionar página');
    select.className = 'page-select'; // ✅ estilos por clase (tema-aware)

    for (let i = 1; i <= totalPages; i++){
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Página ${i}`;
      if (i === currentPage) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      const val = Number(select.value) || 1;
      currentPage = Math.min(Math.max(1, val), totalPages);
      renderItems(canonCat);
    });
    pagination.appendChild(select);

    // › Siguiente
    pagination.appendChild(
      makeBtn('›', () => { currentPage += 1; renderItems(canonCat); }, { disabled: currentPage === totalPages, title: 'Página siguiente' })
    );

    // » Última
    pagination.appendChild(
      makeBtn('»', () => { currentPage = totalPages; renderItems(canonCat); }, { disabled: currentPage === totalPages, title: 'Última página' })
    );
  }
}

// Mostrar/ocultar subcategoría en "Añadir Ítem"
const typeSelect = document.getElementById('type');
const subcategorySelect = document.getElementById('subcategory');


if (typeSelect && subcategorySelect) {
  const syncSubcategory = () => {
    const canon = canonicalizeType(typeSelect.value);
    if (canon === 'Otros') {
      subcategorySelect.style.display = 'block';
    } else {
      subcategorySelect.style.display = 'none';
      subcategorySelect.value = ''; // resetear si no aplica
    }
  };
  
  typeSelect.addEventListener('change', syncSubcategory);
  syncSubcategory(); // aplica al cargar por si hubiera valor preseleccionado
}


function fixStoredTitles() {
  try {
    const arr = backend().loadAll();
    if (!Array.isArray(arr)) return;

    let changed = false;

    const fixed = arr.map(it => {
      const out = { ...it };

      const newTitle = String(out.title ?? '').trim();
      const newAuthor = String(out.author ?? '').trim();
      const newType = canonicalizeType(out.type);

      if (newTitle !== String(it.title ?? '')) { out.title = newTitle; changed = true; }
      if (newAuthor !== String(it.author ?? '')) { out.author = newAuthor; changed = true; }
      if (newType !== it.type) { out.type = newType; changed = true; }

      return out;
    });

    if (changed) {
      backend().saveAll(fixed);
      console.log('[fixStoredTitles] Datos normalizados en localStorage.');
    }
  } catch (e) {
    console.warn('[fixStoredTitles] Error corrigiendo datos:', e);
  }
}


// ==== INIT al cargar ==== 
document.addEventListener('DOMContentLoaded', () => {
  // 0) Cargar preferencia de vista (lista/portadas)
  const savedView = localStorage.getItem('viewMode');
  if (savedView === 'list' || savedView === 'cover') {
    currentView = savedView;
  }
  
  
  // 1) Pintar grilla de categorías y el <select> del formulario
  renderCategoryButtons();
  renderCategorySelect();
  
  // 2) Migrar de forma segura al esquema actual antes de cargar la interfaz
  try {
    const migration = SchemaManager.migrateCollection(currentCollectionId());
    if (migration.migrated) {
      console.log(`[SchemaManager] Migrados ${migration.count} ítems al esquema ${AppConfig.schemaVersion}.`);
      toast(`Datos actualizados correctamente (${migration.count} ítems)`, 'success', 2400);
    }
  } catch (error) {
    console.error('[SchemaManager] Migración fallida', error);
    alert('No se pudo actualizar la estructura de datos. La copia anterior se conserva. No continúes usando esta versión hasta revisar el error.');
    return;
  }

  fixStoredTitles();
  startAppData();
 
  
  // 3) Enlazar importador Excel
  const importInput = document.getElementById('importExcelInput');
  if (importInput) {
    importInput.addEventListener('change', handleImportExcel);
  }
  
 
  
  // 4) Aplicar tema guardado y ajustar icono
  const savedTheme = localStorage.getItem('theme');
  const themeBtn = document.getElementById('themeBtn');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    if (themeBtn) themeBtn.textContent = '☀️';
  } else {
    if (themeBtn) themeBtn.textContent = '🌙';
  }
  
  wireCloseOnBackdrop();
});



function resetFiltersUIAndState(){
  currentFilters = { text:'', author:'', format:'', genre:'', year:'', subcategory:'' };
  ['filterText','filterAuthor','filterFormat','filterGenre','filterYear','filterSubcategory'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function closeImportConfirmModal() {
  const m = document.getElementById('importConfirmModal');
  if (m) m.style.display = 'none';
}

// ===== UX iPhone: cerrar modales al tocar fuera (backdrop) =====
function wireCloseOnBackdrop() {
  const handler = (e) => {
    // En iOS/touch, target puede ser un Text node; subimos a su parentElement si hace falta
    const raw = e.target;
    const el = (raw && raw.nodeType === 3) ? raw.parentElement : raw; // 3 = Text
    if (!el || typeof el.closest !== 'function') return;
    
    // Solo cerrar si el tap/click fue sobre el backdrop (.modal), no dentro de .modal-content
    const modalEl = el.closest('.modal');
    if (!modalEl) return;
    if (el.closest('.modal-content')) return;
    
    switch (modalEl.id) {
      case 'modal':
        closeModal();
        break;
      case 'confirmDeleteModal':
        closeConfirmDeleteModal();
        break;
      case 'exportModal':
        closeExportModal();
        break;
      case 'importConfirmModal':
        closeImportConfirmModal();
        break;
      default:
        modalEl.style.display = 'none';
    }
  };
  
  // click + touchstart para iPhone (tap rápido)
  document.addEventListener('click', handler);
  document.addEventListener('touchstart', handler, { passive: true });
}

 

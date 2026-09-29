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
// v2.10.0: D1 pasa a ser la fuente remota para las pruebas desde la interfaz.
// El localStorage histórico NO se toca: usamos una caché separada para D1.
const InventoryRepo = (() => {
  const D1_CACHE_PREFIX = 'miColeccion.d1cache.';
  const listenersByCollection = new Map();
  const remoteIdsByCollection = new Map();

  function cacheKey(collectionId) {
    return D1_CACHE_PREFIX + String(collectionId || 'default');
  }

  function loadCache(collectionId) {
    try {
      return JSON.parse(localStorage.getItem(cacheKey(collectionId)) || '[]');
    } catch (e) {
      console.warn('[InventoryRepo.loadCache]', e);
      return [];
    }
  }

  function saveCache(collectionId, arr) {
    localStorage.setItem(cacheKey(collectionId), JSON.stringify(Array.isArray(arr) ? arr : []));
  }

  function getListeners(collectionId) {
    if (!listenersByCollection.has(collectionId)) listenersByCollection.set(collectionId, new Set());
    return listenersByCollection.get(collectionId);
  }

  function notify(collectionId, items) {
    const set = listenersByCollection.get(collectionId);
    if (!set) return;
    set.forEach(fn => fn(items));
  }

  function isD1() {
    return typeof AppConfig !== 'undefined' && AppConfig.backendMode === 'd1';
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function refreshFromD1(collectionId) {
    const data = await request('/api/items');
    const remote = Array.isArray(data.items) ? data.items : [];
    remoteIdsByCollection.set(collectionId, new Set(remote.map(x => x.id)));
    saveCache(collectionId, remote);
    notify(collectionId, remote);
    return remote;
  }

  function reportSyncError(collectionId, error) {
    console.error('[InventoryRepo D1]', error);
    if (typeof toast === 'function') toast('No se pudo sincronizar con D1', 'error', 2800);
    refreshFromD1(collectionId).catch(err => console.error('[InventoryRepo refresh]', err));
  }

  return {
    loadAll(collectionId) {
      return isD1() ? loadCache(collectionId) : DataStore.load(collectionId);
    },

    saveAll(collectionId, arr) {
      // Se mantiene para compatibilidad. En modo D1 no hacemos reemplazos masivos
      // durante esta fase de prueba para no convertir una restauración en una migración accidental.
      if (isD1()) {
        saveCache(collectionId, arr);
        notify(collectionId, arr);
        return;
      }
      DataStore.save(collectionId, arr);
      notify(collectionId, arr);
    },

    subscribe(collectionId, callback) {
      const set = getListeners(collectionId);
      set.add(callback);

      if (isD1()) {
        callback(loadCache(collectionId));
        refreshFromD1(collectionId).catch(error => reportSyncError(collectionId, error));
      } else {
        callback(DataStore.load(collectionId));
      }

      return () => {
        set.delete(callback);
        if (set.size === 0) listenersByCollection.delete(collectionId);
      };
    },

    upsert(collectionId, item) {
      if (!isD1()) {
        const items = DataStore.load(collectionId);
        const idx = items.findIndex(x => x.id === item.id);
        if (idx >= 0) items[idx] = item; else items.push(item);
        DataStore.save(collectionId, items);
        notify(collectionId, items);
        return;
      }

      // Actualización optimista de la interfaz/caché D1, sin tocar el localStorage histórico.
      const items = loadCache(collectionId);
      const idx = items.findIndex(x => x.id === item.id);
      if (idx >= 0) items[idx] = item; else items.push(item);
      saveCache(collectionId, items);
      notify(collectionId, items);

      const knownRemote = remoteIdsByCollection.get(collectionId)?.has(item.id) || false;
      const method = knownRemote ? 'PUT' : 'POST';
      const path = knownRemote ? `/api/items/${encodeURIComponent(item.id)}` : '/api/items';
      request(path, { method, body: JSON.stringify(item) })
        .then(() => refreshFromD1(collectionId))
        .catch(error => reportSyncError(collectionId, error));
    },

    remove(collectionId, itemId) {
      if (!isD1()) {
        const items = DataStore.load(collectionId).filter(x => x.id !== itemId);
        DataStore.save(collectionId, items);
        notify(collectionId, items);
        return;
      }

      const items = loadCache(collectionId).filter(x => x.id !== itemId);
      saveCache(collectionId, items);
      notify(collectionId, items);

      request(`/api/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
        .then(() => refreshFromD1(collectionId))
        .catch(error => reportSyncError(collectionId, error));
    }
  };
})();


// ===== Configuración global de la app =====
const AppConfig = {
  appName: 'Mi Colección',
  backendMode: 'd1', // v2.10.0: pruebas reales de interfaz contra Cloudflare D1
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


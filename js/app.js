  const screens = {
    homeScreen: document.getElementById('homeScreen'),
    addScreen: document.getElementById('addScreen'),
    categoryScreen: document.getElementById('categoryScreen')
  };

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const coverImage = document.getElementById('coverImage');
  const coverPreview = document.getElementById('coverPreview');

// Estado de interfaz y sesión activa
  let items = [];
  let unsubscribeItems = null;
  let categories = ['CDs', 'Libros', 'Películas', 'Videojuegos', 'Vinilos', 'Otros'];
  let currentItemId = null;
  let currentView = 'cover'; // por defecto 'miniaturas'
  let currentCategory = null;
  let currentPage = 1;
  const LIST_ITEMS_PER_PAGE = 6;
  const COVER_ITEMS_PER_PAGE = 4;
  let currentFilters = { format: '', genre: '', year: '', subcategory: '' };
  let currentSearch = '';

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

  const categoryIcons = {
    'CDs': '♪',
    'Libros': '▤',
    'Otros': '◇',
    'Películas': '▶',
    'Videojuegos': '✦',
    'Vinilos': '●'
  };

  const sorted = [...categories].sort();
  sorted.forEach(cat => {
    const tile = document.createElement('button');
    tile.className = 'cat-tile';
    tile.type = 'button';
    tile.innerHTML = `<span class="cat-icon" aria-hidden="true">${categoryIcons[cat] || '•'}</span><span class="cat-label">${cat}</span>`;
    tile.onclick = () => showCategory(cat);
    container.appendChild(tile);
  });

  // La acción cotidiana permanece accesible en Home; las tareas administrativas van al menú.
  let actions = document.getElementById('homeActions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'homeActions';
    container.parentNode.insertBefore(actions, container.nextSibling);
  }
  actions.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'primary-add-btn';
  addBtn.type = 'button';
  addBtn.innerHTML = '<span aria-hidden="true">＋</span><span>Añadir elemento</span>';
  addBtn.onclick = () => showScreen('addScreen');
  actions.appendChild(addBtn);
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
    currentFilters = { format: '', genre: '', year: '', subcategory: '' };
    currentSearch = '';
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
      currentFilters = { format: '', genre: '', year: '', subcategory: '' };
    currentSearch = '';
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

      // El menú global pertenece únicamente a Home.
      const menuBtn = document.getElementById('menuBtn');
      if (menuBtn) menuBtn.style.display = (id === 'homeScreen') ? 'grid' : 'none';
      document.body.classList.toggle('interior-screen', id !== 'homeScreen');
      if (id !== 'homeScreen') toggleAppMenu(false);
      if (id !== 'categoryScreen') {
        const searchBar = document.getElementById('searchBar');
        const filtersBar = document.getElementById('filtersBar');
        if (searchBar) searchBar.style.display = 'none';
        if (filtersBar) filtersBar.style.display = 'none';
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

  currentSearch = '';
  const searchInput = document.getElementById('searchText');
  if (searchInput) searchInput.value = '';
  currentPage = 1;
  updateFilterBadge();
  renderItems(canon);
}
  
// Búsqueda textual independiente: título + autor/director/artista, en tiempo real.
function toggleSearch(){
  const bar = document.getElementById('searchBar');
  const filters = document.getElementById('filtersBar');
  if (!bar) return;
  const show = bar.style.display === 'none' || bar.style.display === '';
  bar.style.display = show ? 'flex' : 'none';
  if (filters) filters.style.display = 'none';
  if (!show) return;
  const input = document.getElementById('searchText');
  const clear = document.getElementById('clearSearchBtn');
  if (input && !input.dataset.wired) {
    input.dataset.wired = '1';
    input.addEventListener('input', () => {
      currentSearch = normalizeText(input.value || '').trim();
      currentPage = 1;
      renderItems(currentCategory);
    });
  }
  if (clear && !clear.dataset.wired) {
    clear.dataset.wired = '1';
    clear.addEventListener('click', () => {
      if (input) input.value = '';
      currentSearch = '';
      currentPage = 1;
      renderItems(currentCategory);
      input?.focus();
    });
  }
  requestAnimationFrame(() => input?.focus());
}

// Filtros estructurados, separados de la búsqueda textual.
function toggleFilters(){
  const bar = document.getElementById('filtersBar');
  const searchBar = document.getElementById('searchBar');
  if (!bar) return;
  if (searchBar) searchBar.style.display = 'none';

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
    currentFilters.format = (document.getElementById('filterFormat')?.value || '').trim();
    currentFilters.genre  = (document.getElementById('filterGenre')?.value  || '').trim(); // ← NUEVO
    currentFilters.year   = (document.getElementById('filterYear')?.value   || '').trim();

    const subEl = document.getElementById('filterSubcategory');
    currentFilters.subcategory = (subEl && currentCategory === 'Otros') ? (subEl.value || '').trim() : '';

    currentPage = 1;
    updateFilterBadge();
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
      currentFilters = { format:'', genre:'', year:'', subcategory:'' };
      ['filterFormat','filterGenre','filterYear','filterSubcategory'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    }
    currentPage = 1;
    updateFilterBadge();
    renderItems(currentCategory);
    // ✅ Cerrar panel de filtros tras limpiar
    bar.style.display = 'none';
    bar.setAttribute('aria-hidden', 'true');
  });

}

function updateFilterBadge(){
  const badge = document.getElementById('filterBadge');
  if (!badge) return;
  const count = ['format','genre','year','subcategory'].filter(k => currentFilters[k]).length;
  badge.hidden = count === 0;
  badge.textContent = count ? String(count) : '';
}
  
 function toggleView() {
  // Conserva la posición aproximada del usuario al cambiar entre Lista (6) y Carátulas (4).
  const previousPageSize = currentView === 'list' ? LIST_ITEMS_PER_PAGE : COVER_ITEMS_PER_PAGE;
  const firstVisibleIndex = Math.max(0, (currentPage - 1) * previousPageSize);

  currentView = currentView === 'list' ? 'cover' : 'list';
  const nextPageSize = currentView === 'list' ? LIST_ITEMS_PER_PAGE : COVER_ITEMS_PER_PAGE;
  currentPage = Math.floor(firstVisibleIndex / nextPageSize) + 1;

  localStorage.setItem('viewMode', currentView);
  renderItems(currentCategory);
}
  
function showItemDetails(id) {
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
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
  const viewBtn = document.querySelector('.toggle-view-btn');
  if (viewBtn) viewBtn.style.display = 'none';
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
    const viewBtn = document.querySelector('.toggle-view-btn');
    if (viewBtn && screens.categoryScreen?.classList.contains('active')) viewBtn.style.display = 'grid';
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
  
  function resolveAppearanceTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyAppearanceSettings() {
  const mode = localStorage.getItem('appearanceMode') || localStorage.getItem('theme') || 'auto';
  const storedAccent = localStorage.getItem('accentColor') || 'blue';
  const legacyAccentMap = { violet: 'indigo', green: 'forest', amber: 'burgundy', coral: 'burgundy' };
  const accent = legacyAccentMap[storedAccent] || storedAccent;
  if (accent !== storedAccent) localStorage.setItem('accentColor', accent);
  const resolved = resolveAppearanceTheme(mode);
  document.body.classList.toggle('dark-theme', resolved === 'dark');
  document.documentElement.dataset.accent = accent;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b1016' : '#f4f6f8');
  document.querySelectorAll('[data-appearance]').forEach(btn => btn.classList.toggle('is-selected', btn.dataset.appearance === mode));
  document.querySelectorAll('[data-accent]').forEach(btn => btn.classList.toggle('is-selected', btn.dataset.accent === accent));
}

function setAppearanceMode(mode) {
  if (!['auto','light','dark'].includes(mode)) return;
  localStorage.setItem('appearanceMode', mode);
  localStorage.removeItem('theme');
  applyAppearanceSettings();
}

function setAccentColor(accent) {
  if (!['blue','indigo','forest','burgundy','graphite'].includes(accent)) return;
  localStorage.setItem('accentColor', accent);
  applyAppearanceSettings();
}

function toggleTheme() {
  const current = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
  setAppearanceMode(current === 'dark' ? 'light' : 'dark');
}

function toggleAppMenu(force) {
  const menu = document.getElementById('appMenu');
  const backdrop = document.getElementById('menuBackdrop');
  if (!menu || !backdrop) return;
  const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  backdrop.classList.toggle('open', open);
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openSettingsPanel(panelId) {
  toggleAppMenu(false);
  const el = document.getElementById(panelId);
  if (el) el.style.display = 'block';
  if (panelId === 'appearanceModal') applyAppearanceSettings();
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

// Importación/exportación: ver js/io.js

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

      const searchable = `${normalizeText(item.title)} ${normalizeText(item.author)}`;
      const searchOk = !currentSearch || searchable.includes(currentSearch);
      const formatOk = !currentFilters.format || String(item.format ?? '') === currentFilters.format;
      const genreOk  = !currentFilters.genre  || String(item.genre  ?? '') === currentFilters.genre;
      const yearOk   = !currentFilters.year   || String(item.year   ?? '') === currentFilters.year;
      const subOk    = (canonCat !== 'Otros')
        ? true
        : (!currentFilters.subcategory || String(item.subcategory ?? '') === currentFilters.subcategory);

      return searchOk && formatOk && genreOk && yearOk && subOk;
    })
    .sort((a,b)=>
      String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es', { sensitivity:'base', numeric:true })
    );

  // Paginación adaptativa: Lista = 6; Carátulas = 4.
  // El total de páginas depende siempre de la vista y del conjunto filtrado actual.
  const itemsPerPage = currentView === 'list' ? LIST_ITEMS_PER_PAGE : COVER_ITEMS_PER_PAGE;
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
    list.innerHTML = '<p style="text-align:center;">No hay resultados con la búsqueda o filtros actuales.</p>';
    return;
  }

  // Render: Lista o Carátulas
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
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cover-card';
      card.setAttribute('aria-label', `Abrir ${String(item.title || 'elemento')}`);

      const media = document.createElement('span');
      media.className = 'cover-card-media';
      const img = document.createElement('img');
      const hasCover = Boolean(item.coverImage);
      img.src = hasCover ? item.coverImage : getPlaceholderForType(item.type);
      if (!hasCover) img.classList.add('is-placeholder');
      img.alt = '';
      img.loading = 'lazy';
      media.appendChild(img);

      const text = document.createElement('span');
      text.className = 'cover-card-text';
      const title = document.createElement('strong');
      title.textContent = String(item.title || '(Sin título)');
      text.appendChild(title);
      const author = String(item.author || '').trim();
      if (author) {
        const meta = document.createElement('span');
        meta.className = 'cover-card-meta';
        meta.textContent = author;
        text.appendChild(meta);
      }

      card.append(media, text);
      card.onclick = () => showItemDetails(item.id);
      grid.appendChild(card);
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

  // v2.5.0: restauración de backups JSON completos
  const importJsonInput = document.getElementById('importJsonInput');
  if (importJsonInput) {
    importJsonInput.addEventListener('change', handleImportJSON);
  }
  
 
  
  // 4) Aplicar apariencia guardada (Automático / Claro / Oscuro + color de acento)
  applyAppearanceSettings();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const syncAutoTheme = () => {
      if ((localStorage.getItem('appearanceMode') || localStorage.getItem('theme') || 'auto') === 'auto') applyAppearanceSettings();
    };
    if (mq.addEventListener) mq.addEventListener('change', syncAutoTheme);
    else if (mq.addListener) mq.addListener(syncAutoTheme);
  }
  
  wireCloseOnBackdrop();
});



function resetFiltersUIAndState(){
  currentFilters = { format:'', genre:'', year:'', subcategory:'' };
  ['filterFormat','filterGenre','filterYear','filterSubcategory'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  updateFilterBadge();
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

 

  const screens = {
    homeScreen: document.getElementById('homeScreen'),
    addScreen: document.getElementById('addScreen'),
    categoryScreen: document.getElementById('categoryScreen'),
    statsScreen: document.getElementById('statsScreen')
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
  let currentFilters = { format: '', genre: '', year: '', author: '', location: '', subcategory: '' };
  let currentSearch = '';
  let currentStatsScope = 'all';
  let statsReturnContext = null;

  // v2.16.0: sincronización ligera entre dispositivos.
  // D1 sigue siendo la fuente de verdad; refrescamos al volver a la app
  // y periódicamente mientras la PWA está visible.
  const AUTO_REFRESH_INTERVAL_MS = 30000;
  const AUTO_REFRESH_MIN_GAP_MS = 5000;
  let autoRefreshTimer = null;
  let autoRefreshInFlight = false;
  let lastAutoRefreshAt = 0;

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

      // Mantener la categoría visible actualizada sin cambiar página, búsqueda ni filtros.
      if (currentCategory) {
        renderItems(currentCategory);
        populateFilterOptions(currentCategory);
      }

      // La pantalla de Estadísticas siempre se recalcula con la copia más reciente de D1.
      if (screens.statsScreen?.classList.contains('active')) {
        renderStatistics();
      }

      // Si el detalle está abierto (pero no se está editando), reflejar también
      // cambios remotos en ese mismo elemento. Nunca pisamos un formulario de edición.
      const detailsModal = document.getElementById('modal');
      const editing = Boolean(document.getElementById('editItemForm'));
      const detailIsOpen = detailsModal && detailsModal.style.display !== 'none';
      if (currentItemId && detailIsOpen && !editing) {
        if (items.some(item => item.id === currentItemId)) {
          showItemDetails(currentItemId);
        } else {
          closeModal();
          toast('El elemento ya no existe en la colección', 'success', 2200);
        }
      }
    });
  }

  async function refreshSharedCollection(reason = 'auto') {
    if (AppConfig.backendMode !== 'd1') return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (autoRefreshInFlight) return;

    const now = Date.now();
    if (now - lastAutoRefreshAt < AUTO_REFRESH_MIN_GAP_MS) return;

    autoRefreshInFlight = true;
    lastAutoRefreshAt = now;
    try {
      await backend().refresh();
    } catch (error) {
      // Un fallo puntual de red no debe bloquear la PWA.
      // La siguiente reanudación/intervalo volverá a intentarlo.
      console.warn(`[AutoRefresh:${reason}]`, error);
    } finally {
      autoRefreshInFlight = false;
    }
  }

  function setupSharedCollectionAutoRefresh() {
    if (AppConfig.backendMode !== 'd1') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshSharedCollection('visibility');
      }
    });

    window.addEventListener('focus', () => refreshSharedCollection('focus'));
    window.addEventListener('pageshow', () => refreshSharedCollection('pageshow'));

    if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshSharedCollection('interval');
      }
    }, AUTO_REFRESH_INTERVAL_MS);
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
    currentFilters = { format: '', genre: '', year: '', author: '', location: '', subcategory: '' };
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
      currentFilters = { format: '', genre: '', year: '', author: '', location: '', subcategory: '' };
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
    
    upsert(item, operation = 'auto') {
      return InventoryRepo.upsert(currentCollectionId(), item, operation);
    },
    
    importMany(importedItems) {
      return InventoryRepo.importMany(currentCollectionId(), importedItems);
    },

    reconcileImport(importedItems, mode = 'preview') {
      return InventoryRepo.reconcileImport(currentCollectionId(), importedItems, mode);
    },

    refresh() {
      return InventoryRepo.refresh(currentCollectionId());
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
  
  
  function showCategory(category, options = {}){
  const canon = canonicalizeType(category);
  if (!options.preserveStatsReturn) statsReturnContext = null;
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
  updateSearchBadge();
  renderItems(canon);
}

function goBackFromCategory() {
  if (statsReturnContext) {
    const context = statsReturnContext;
    statsReturnContext = null;
    currentCategory = null;
    currentPage = 1;
    currentStatsScope = context.scope || 'all';
    showScreen('statsScreen');
    renderStatistics();
    requestAnimationFrame(() => {
      window.scrollTo({ top: Number(context.scrollY) || 0, behavior: 'auto' });
    });
    return;
  }

  showScreen('homeScreen');
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
      updateSearchBadge();
      renderItems(currentCategory);
    });
  }
  if (clear && !clear.dataset.wired) {
    clear.dataset.wired = '1';
    clear.addEventListener('click', () => {
      if (input) input.value = '';
      currentSearch = '';
      currentPage = 1;
      updateSearchBadge();
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

  // Rellenar selects según la categoría actual y correlacionarlos entre sí.
  populateFilterOptions(currentCategory, currentFilters);

  // Mientras el panel está abierto, cambiar una faceta recalcula las demás
  // inmediatamente, sin necesidad de pulsar Aplicar.
  ['filterFormat','filterGenre','filterYear','filterAuthor','filterLocation','filterSubcategory'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.correlatedWired) {
      el.dataset.correlatedWired = '1';
      el.addEventListener('change', refreshCorrelatedFilterOptions);
    }
  });

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
    currentFilters.author = (document.getElementById('filterAuthor')?.value || '').trim();
    currentFilters.location = (document.getElementById('filterLocation')?.value || '').trim();

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
      currentFilters = { format:'', genre:'', year:'', author:'', location:'', subcategory:'' };
      ['filterFormat','filterGenre','filterYear','filterAuthor','filterLocation','filterSubcategory'].forEach(id=>{
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
  const count = ['format','genre','year','author','location','subcategory'].filter(k => currentFilters[k]).length;
  badge.hidden = count === 0;
  badge.textContent = count ? String(count) : '';
}

function updateSearchBadge(){
  const badge = document.getElementById('searchBadge');
  if (!badge) return;
  const active = Boolean(String(currentSearch || '').trim());
  badge.hidden = !active;
  badge.textContent = active ? '1' : '';
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

  const itemType = canonicalizeType(item.type);
  const publisherLabel = itemType === 'Libros' ? 'Editorial' : ((itemType === 'CDs' || itemType === 'Vinilos') ? 'Discográfica' : 'Editorial / Discográfica');
  const publisherHtml = ((itemType === 'Libros' || itemType === 'CDs' || itemType === 'Vinilos') && item.publisher) ? `<p><strong>${publisherLabel}:</strong> ${escapeHtml(item.publisher)}</p>` : '';
  const isbnHtml = (itemType === 'Libros' && item.isbn) ? `<p><strong>ISBN:</strong> ${escapeHtml(item.isbn)}</p>` : '';
  const locationHtml = item.location ? `<p><strong>Ubicación:</strong> ${escapeHtml(item.location)}</p>` : '';
  
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
      ${publisherHtml}
      ${isbnHtml}
      ${locationHtml}
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
          placeholder="Autor / Director / Artista · varios con ;"
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

        <input type="text" id="edit-publisher" value="${escapeHtml(item.publisher || '')}" placeholder="Editorial / Discográfica" />
        <input type="text" id="edit-isbn" value="${escapeHtml(item.isbn || '')}" placeholder="ISBN" />
        <input type="text" id="edit-location" value="${escapeHtml(item.location || '')}" placeholder="Ubicación / BOX" />

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
          ${item.coverImage ? `<button type="button" class="button secondary" id="removeCoverBtn" style="margin-top:10px;">Eliminar carátula</button>` : ''}
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
      const canonType = canonicalizeType(editTypeSelect.value);
      if (canonType === 'Otros') {
        editSub.style.display = 'block';
      } else {
        editSub.style.display = 'none';
        editSub.value = '';
      }

      const publisherInput = document.getElementById('edit-publisher');
      const isbnInput = document.getElementById('edit-isbn');
      if (publisherInput) {
        const showPublisher = canonType === 'Libros' || canonType === 'CDs' || canonType === 'Vinilos';
        publisherInput.style.display = showPublisher ? 'block' : 'none';
        publisherInput.placeholder = canonType === 'Libros' ? 'Editorial' : 'Discográfica';
      }
      if (isbnInput) isbnInput.style.display = canonType === 'Libros' ? 'block' : 'none';
    };
  
    refreshSubcategoryVisibility();
    editTypeSelect.addEventListener('change',   refreshSubcategoryVisibility);
   
    // --- handler de imagen (ya tienes compresión + límite) ---
    const coverInput = document.getElementById('edit-coverImage');
    const previewImg = document.getElementById('edit-coverPreview');
    const removeCoverBtn = document.getElementById('removeCoverBtn');
    let removeCoverRequested = false;

    removeCoverBtn?.addEventListener('click', () => {
      removeCoverRequested = true;
      if (previewImg) {
        previewImg.src = '';
        previewImg.style.display = 'none';
      }
      if (coverInput) coverInput.value = '';
      removeCoverBtn.style.display = 'none';
      toast('La carátula se eliminará al guardar', 'success', 2200);
    });
  
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
      
        removeCoverRequested = false;
        previewImg.src = dataUrl;
        previewImg.style.display = 'block';
        previewImg.style.margin = '0 auto';
      } catch (err) {
        console.error('[edit-coverImage]', err);
        toast('No se pudo procesar la imagen', 'error', 2600);
      }
    });
  
  
  document.getElementById('editItemForm').addEventListener('submit', async (e) => {
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
      publisher: document.getElementById('edit-publisher')?.value.trim() || '',
      isbn: document.getElementById('edit-isbn')?.value.trim() || '',
      location: document.getElementById('edit-location')?.value.trim() || '',
      notes: document.getElementById('edit-notes').value.trim(),
      moreInfo: safeUrl(document.getElementById('edit-moreInfo').value.trim()),
      type: newType,
      subcategory: newSub
    };
    
    const pendingCoverDataUrl = (previewImg && previewImg.style.display === 'block' && String(previewImg.src || '').startsWith('data:image/'))
      ? previewImg.src
      : null;
    
    const prev = items[index];

    // v2.21.2: si el usuario modifica manualmente el autor, no intentamos adivinar
    // nombre/apellidos. Se conserva el campo visible y se limpia la estructura interna
    // para evitar que una exportación futura saque apellidos antiguos incorrectos.
    if (String(updated.author || '').trim() !== String(prev.author || '').trim()) {
      updated.authorGivenName = '';
      updated.authorSurname1 = '';
      updated.authorSurname2 = '';
      updated.authorSort = '';
    }

    // El ULID es permanente. Solo se actualiza la clave auxiliar de coincidencia.
    updated.id = prev.id;
    updated.schemaVersion = AppConfig.schemaVersion;
    updated.legacyId = prev.legacyId || null;
    updated.legacyKey = stableKeyForItem(updated);
    updated.images = Array.isArray(prev.images) ? prev.images : [];

    // Conserva el contexto de navegación si el elemento sigue en la misma categoría.
    // Entrar de nuevo desde Home seguirá usando showCategory() y, por tanto, página 1.
    const originCategory = currentCategory;
    const originPage = currentPage;

    try {
      await backend().upsert({
        ...prev,
        ...updated,
        coverImage: prev.coverImage || null
      }, 'update');

      if (pendingCoverDataUrl) {
        await uploadCoverToR2(updated.id, pendingCoverDataUrl);
        await backend().refresh();
      } else if (removeCoverRequested) {
        await deleteCoverFromR2(updated.id);
        await backend().refresh();
      }

      closeModal();

      if (canonicalizeType(updated.type) === canonicalizeType(originCategory)) {
        currentPage = originPage;
        renderItems(originCategory);
        populateFilterOptions(originCategory);
      } else {
        // Si cambia de categoría, el elemento ya no pertenece a la pantalla de origen.
        showCategory(updated.type, { preserveStatsReturn: Boolean(statsReturnContext) });
      }

      flashSuccess('Guardado correctamente');
    } catch (err) {
      console.error('[editItemForm D1/R2]', err);
      toast(`No se pudo guardar completamente: ${err.message || err}`, 'error', 4200);
    }
  });
 }
  
   function saveEdit() {
      throw new Error('saveEdit() es legacy y está deshabilitada. La edición actual se gestiona con enableEditMode().');
   }
  
  
   function deleteItem() {
      // Compatibilidad: si algún botón viejo llama a deleteItem(), usa el modal nuevo
      openConfirmDeleteModal();
   }
   
   async function imageApiRequest(itemId, method, body = null) {
      const options = { method, cache: 'no-store' };
      if (body) {
        options.body = body;
        options.headers = { 'Content-Type': 'image/jpeg' };
      }
      const response = await fetch(`/api/images/${encodeURIComponent(itemId)}/cover`, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
   }

   async function uploadCoverToR2(itemId, dataUrl) {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return await imageApiRequest(itemId, 'PUT', blob);
   }

   async function deleteCoverFromR2(itemId) {
      return await imageApiRequest(itemId, 'DELETE');
   }

   // ===== Imagen: convertir a JPEG comprimido antes de enviarla a R2 =====
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

// ===== Límite preventivo antes de subir la carátula a R2 =====
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
  document.getElementById('addItemForm').addEventListener('submit', async (e)=>{
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
      authorGivenName: '',
      authorSurname1: '',
      authorSurname2: '',
      authorSort: '',
      format: String(document.getElementById('format').value).trim(),
      genre:  String(document.getElementById('genre').value).trim(),   // ← nuevo campo
      year:   String(document.getElementById('year').value).trim(),
      publisher: String(document.getElementById('publisher')?.value || '').trim(),
      isbn: String(document.getElementById('isbn')?.value || '').trim(),
      location: String(document.getElementById('location')?.value || '').trim(),
      notes:  String(document.getElementById('notes').value).trim(),
      coverImage: null,
      moreInfo: safeUrl(document.getElementById('moreInfo').value.trim()),
      subcategory: sub
    };

    newItem.legacyKey = stableKeyForItem(newItem);
    const pendingCoverDataUrl = (coverPreview.style.display === 'block' && String(coverPreview.src || '').startsWith('data:image/'))
      ? coverPreview.src
      : null;

    try {
      await backend().upsert(newItem, 'create');
    } catch (err) {
      console.error('[addItemForm D1]', err);
      toast(`No se pudo guardar en D1: ${err.message || err}`, 'error', 4200);
      return;
    }

    if (pendingCoverDataUrl) {
      try {
        await uploadCoverToR2(newItem.id, pendingCoverDataUrl);
        await backend().refresh();
      } catch (err) {
        console.error('[addItemForm R2]', err);
        toast(`Elemento guardado, pero la carátula no pudo subirse: ${err.message || err}`, 'error', 4200);
      }
    }

    e.target.reset();
    coverPreview.src = '';
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


// ===== v2.20.1 · Estadísticas de la colección =====
function openStatistics() {
  statsReturnContext = null;
  toggleAppMenu(false);
  currentCategory = null;
  currentPage = 1;
  showScreen('statsScreen');
  renderStatistics();
}

function setStatisticsScope(scope) {
  const requested = String(scope || 'all');
  const validCategories = new Set(categories.map(canonicalizeType));
  currentStatsScope = requested === 'all' || validCategories.has(canonicalizeType(requested))
    ? (requested === 'all' ? 'all' : canonicalizeType(requested))
    : 'all';
  renderStatistics();
}

function populateStatisticsScope() {
  const select = document.getElementById('statsScope');
  if (!select) return;

  const activeCategories = [...new Set(items.map(item => canonicalizeType(item.type)).filter(Boolean))]
    .filter(cat => categories.map(canonicalizeType).includes(cat))
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  select.innerHTML = '<option value="all">Toda la colección</option>' + activeCategories
    .map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
    .join('');

  if (currentStatsScope !== 'all' && !activeCategories.includes(currentStatsScope)) {
    currentStatsScope = 'all';
  }
  select.value = currentStatsScope;
}

function countStatsValues(source, field) {
  const counts = new Map();
  const labels = new Map();

  source.forEach(item => {
    const values = field === 'genre'
      ? getGenreTokens(item?.genre)
      : field === 'author'
        ? getAuthorTokens(item?.author).filter(value => !isGenericMultipleAuthor(value))
        : [String(item?.[field] ?? '').trim()].filter(Boolean);

    values.forEach(value => {
      const key = String(value).toLocaleLowerCase('es');
      if (!labels.has(key)) labels.set(key, String(value));
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .map(([key, count]) => ({ label: labels.get(key) || key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
}

function countStatsDecades(source) {
  const counts = new Map();
  source.forEach(item => {
    const raw = String(item?.year ?? '');
    const match = raw.match(/\b(18|19|20)\d{2}\b/);
    if (!match) return;
    const year = Number(match[0]);
    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([decade, count]) => ({ label: `${decade}–${decade + 9}`, count }));
}

function statsRowsHtml(rows, navigationKind = '') {
  if (!rows.length) return '<p class="stats-empty">No hay datos suficientes.</p>';
  const max = Math.max(...rows.map(row => row.count), 1);
  return `<div class="stats-bars">${rows.map(row => {
    const width = Math.max(5, Math.round((row.count / max) * 100));
    const clickable = Boolean(navigationKind);
    const tag = clickable ? 'button' : 'div';
    const attrs = clickable
      ? ` type="button" class="stats-row is-clickable" data-stats-kind="${navigationKind}" data-stats-value="${encodeURIComponent(row.label)}"`
      : ' class="stats-row"';
    return `<${tag}${attrs}>
      <div class="stats-row-top"><span>${escapeHtml(row.label)}</span><strong>${row.count}</strong></div>
      <div class="stats-bar-track"><span style="width:${width}%"></span></div>
    </${tag}>`;
  }).join('')}</div>`;
}

function statsSectionHtml(title, rows, navigationKind = '', subtitle = '') {
  if (!rows.length) return '';
  return `<section class="stats-card">
    <div class="stats-card-heading">
      <h3>${escapeHtml(title)}</h3>
      ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}
    </div>
    ${statsRowsHtml(rows, navigationKind)}
  </section>`;
}


// v2.28.0: en el ámbito global no se comparan géneros de dominios distintos.
// Se muestran los géneros principales dentro de cada categoría para conservar contexto.
function statsGenresByCategoryHtml(source) {
  const categoriesWithGenres = categories
    .map(category => {
      const canon = canonicalizeType(category);
      const categoryItems = source.filter(item => canonicalizeType(item.type) === canon);
      const genres = countStatsValues(categoryItems, 'genre').slice(0, 3);
      return { category: canon, genres };
    })
    .filter(group => group.category && group.genres.length);

  if (!categoriesWithGenres.length) return '';

  return `<section class="stats-card stats-genres-by-category">
    <div class="stats-card-heading">
      <h3>Géneros destacados por categoría</h3>
      <span>Top 3 por categoría</span>
    </div>
    <div class="stats-genre-groups">
      ${categoriesWithGenres.map(group => `
        <div class="stats-genre-group">
          <h4>${escapeHtml(group.category)}</h4>
          ${statsRowsHtml(group.genres)}
        </div>`).join('')}
    </div>
  </section>`;
}

function wireStatisticsNavigation() {
  document.querySelectorAll('[data-stats-kind]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.dataset.statsKind || '';
      let value = '';
      try { value = decodeURIComponent(button.dataset.statsValue || ''); } catch { value = button.dataset.statsValue || ''; }
      openStatisticsResult(kind, value);
    });
  });
}

function openStatisticsResult(kind, value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return;

  statsReturnContext = {
    scope: currentStatsScope,
    scrollY: window.scrollY || document.documentElement.scrollTop || 0
  };

  if (kind === 'category') {
    showCategory(cleanValue, { preserveStatsReturn: true });
    return;
  }

  if (currentStatsScope === 'all') {
    statsReturnContext = null;
    return;
  }
  const category = currentStatsScope;
  showCategory(category, { preserveStatsReturn: true });
  populateFilterOptions(category);

  if (kind === 'author') {
    currentFilters.author = cleanValue;
    const select = document.getElementById('filterAuthor');
    if (select) select.value = cleanValue;
    updateFilterBadge();
  } else if (kind === 'format' || kind === 'genre') {
    currentFilters[kind] = cleanValue;
    const selectId = kind === 'format' ? 'filterFormat' : 'filterGenre';
    const select = document.getElementById(selectId);
    if (select) select.value = cleanValue;
    updateFilterBadge();
  } else if (kind === 'subcategory' && category === 'Otros') {
    currentFilters.subcategory = cleanValue;
    const select = document.getElementById('filterSubcategory');
    if (select) select.value = cleanValue;
    updateFilterBadge();
  }

  currentPage = 1;
  renderItems(category);
}

function renderStatistics() {
  const content = document.getElementById('statsContent');
  const totalEl = document.getElementById('statsTotal');
  const labelEl = document.getElementById('statsTotalLabel');
  const contextEl = document.getElementById('statsContext');
  if (!content || !totalEl || !labelEl || !contextEl) return;

  populateStatisticsScope();

  const source = currentStatsScope === 'all'
    ? items
    : items.filter(item => canonicalizeType(item.type) === currentStatsScope);

  totalEl.textContent = String(source.length);
  labelEl.textContent = source.length === 1 ? 'elemento' : 'elementos';

  const activeCategoryCount = new Set(items.map(item => canonicalizeType(item.type)).filter(Boolean)).size;
  contextEl.textContent = currentStatsScope === 'all'
    ? `en ${activeCategoryCount} categor${activeCategoryCount === 1 ? 'ía' : 'ías'}`
    : currentStatsScope;

  if (!source.length) {
    content.innerHTML = '<section class="stats-card"><p class="stats-empty">Todavía no hay elementos en este ámbito.</p></section>';
    return;
  }

  let html = '';

  if (currentStatsScope === 'all') {
    const byCategory = categories
      .map(cat => ({
        label: canonicalizeType(cat),
        count: items.filter(item => canonicalizeType(item.type) === canonicalizeType(cat)).length
      }))
      .filter(row => row.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    html += statsSectionHtml('Distribución de la colección', byCategory, 'category');
  } else {
    const subcategories = countStatsValues(source, 'subcategory');
    if (subcategories.length) {
      html += statsSectionHtml(
        'Subcategorías',
        subcategories,
        currentStatsScope === 'Otros' ? 'subcategory' : ''
      );
    }
  }

  const authors = countStatsValues(source, 'author').slice(0, 5);
  html += statsSectionHtml('Autores / artistas más presentes', authors, currentStatsScope === 'all' ? '' : 'author', 'Top 5');

  if (currentStatsScope === 'all') {
    html += statsGenresByCategoryHtml(source);
  } else {
    const genres = countStatsValues(source, 'genre').slice(0, 5);
    html += statsSectionHtml('Géneros más presentes', genres, 'genre', 'Top 5');
  }

  const formats = countStatsValues(source, 'format').slice(0, 8);
  html += statsSectionHtml('Formatos', formats, currentStatsScope === 'all' ? '' : 'format');

  // v2.28.0: Épocas cierra la pantalla de estadísticas, después de Formatos.
  html += statsSectionHtml('Épocas', countStatsDecades(source), '', 'Distribución por décadas');

  content.innerHTML = html || '<section class="stats-card"><p class="stats-empty">No hay datos estadísticos disponibles.</p></section>';
  wireStatisticsNavigation();
}

function setAppMenuPanel(panel = 'main') {
  const main = document.getElementById('appMenuMain');
  const transfer = document.getElementById('appMenuTransfer');
  if (!main || !transfer) return;
  const showTransfer = panel === 'transfer';
  main.hidden = showTransfer;
  transfer.hidden = !showTransfer;
}

function openTransferMenu() {
  setAppMenuPanel('transfer');
}

function toggleAppMenu(force) {
  const menu = document.getElementById('appMenu');
  const backdrop = document.getElementById('menuBackdrop');
  if (!menu || !backdrop) return;
  const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
  if (open) setAppMenuPanel('main');
  menu.classList.toggle('open', open);
  backdrop.classList.toggle('open', open);
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) setAppMenuPanel('main');
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

async function confirmDelete() {
  const idToDelete = currentItemId;
  
  // Si por lo que sea no hay id, salimos limpio
  if (!idToDelete) {
    closeConfirmDeleteModal();
    closeModal();
    return;
  }
  
  try {
    await backend().remove(idToDelete);

    // Limpia selección para evitar acciones sobre un id ya eliminado
    currentItemId = null;

    closeConfirmDeleteModal();
    closeModal();

    // Refresca usando el estado, no el DOM
    if (currentCategory) showCategory(currentCategory, { preserveStatsReturn: Boolean(statsReturnContext) });
    else showScreen('homeScreen');

    flashSuccess('Eliminado correctamente');
  } catch (err) {
    console.error('[confirmDelete D1]', err);
    closeConfirmDeleteModal();
    toast(`No se pudo eliminar de D1: ${err.message || err}`, 'error', 4200);
  }
}

// Importación/exportación: ver js/io.js

// v2.22.0: Género es un campo multivalor separado por comas.
// No existe una lista cerrada: los géneros se descubren dinámicamente desde los datos.
function getGenreTokens(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => {
      const key = part.toLocaleLowerCase('es');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function genreContains(value, selectedGenre) {
  const target = String(selectedGenre ?? '').trim().toLocaleLowerCase('es');
  if (!target) return true;
  return getGenreTokens(value).some(genre => genre.toLocaleLowerCase('es') === target);
}

// v2.28.0: el punto y coma es el separador explícito de autores/artistas múltiples.
// No se dividen comas, '&' ni 'y' para no romper nombres artísticos válidos.
function getAuthorTokens(value) {
  return String(value ?? '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);
}

function isGenericMultipleAuthor(value) {
  const compact = normalizeText(value).replace(/[^a-z0-9]/g, '');
  return compact === 'vvaa';
}

function authorContains(value, selectedAuthor) {
  const target = String(selectedAuthor ?? '').trim().toLocaleLowerCase('es');
  if (!target) return true;
  return getAuthorTokens(value).some(author => author.toLocaleLowerCase('es') === target);
}

function itemMatchesFacetContext(item, canonCat, filters, ignoreFacet = '') {
  if (canonicalizeType(item.type) !== canonCat) return false;

  const searchable = `${normalizeText(item.title)} ${normalizeText(item.author)}`;
  if (currentSearch && !searchable.includes(currentSearch)) return false;

  if (ignoreFacet !== 'format' && filters.format && String(item.format ?? '') !== filters.format) return false;
  if (ignoreFacet !== 'genre' && filters.genre && !genreContains(item.genre, filters.genre)) return false;
  if (ignoreFacet !== 'year' && filters.year && String(item.year ?? '') !== filters.year) return false;
  if (ignoreFacet !== 'author' && filters.author && !authorContains(item.author, filters.author)) return false;
  if (ignoreFacet !== 'location' && filters.location && String(item.location ?? '') !== filters.location) return false;
  if (canonCat === 'Otros' && ignoreFacet !== 'subcategory' && filters.subcategory && String(item.subcategory ?? '') !== filters.subcategory) return false;

  return true;
}

function getFilterValuesFromUI() {
  const canon = canonicalizeType(currentCategory);
  return {
    format: (document.getElementById('filterFormat')?.value || '').trim(),
    genre: (document.getElementById('filterGenre')?.value || '').trim(),
    year: (document.getElementById('filterYear')?.value || '').trim(),
    author: (document.getElementById('filterAuthor')?.value || '').trim(),
    location: (document.getElementById('filterLocation')?.value || '').trim(),
    subcategory: canon === 'Otros'
      ? (document.getElementById('filterSubcategory')?.value || '').trim()
      : ''
  };
}

function populateFilterOptions(category, filters = currentFilters) {
  const canon = canonicalizeType(category);
  const active = {
    format: String(filters?.format || '').trim(),
    genre: String(filters?.genre || '').trim(),
    year: String(filters?.year || '').trim(),
    author: String(filters?.author || '').trim(),
    location: String(filters?.location || '').trim(),
    subcategory: canon === 'Otros' ? String(filters?.subcategory || '').trim() : ''
  };

  const facetItems = facet => items.filter(item => itemMatchesFacetContext(item, canon, active, facet));

  const formats = [...new Set(facetItems('format').map(i => String(i.format ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const years = [...new Set(facetItems('year').map(i => String(i.year ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));

  const authorMap = new Map();
  facetItems('author').forEach(item => {
    getAuthorTokens(item.author).forEach(author => {
      const key = author.toLocaleLowerCase('es');
      if (!authorMap.has(key)) authorMap.set(key, author);
    });
  });
  const authors = [...authorMap.values()]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const locations = [...new Set(facetItems('location').map(i => String(i.location ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }));

  const genreMap = new Map();
  facetItems('genre').forEach(item => {
    getGenreTokens(item.genre).forEach(genre => {
      const key = genre.toLocaleLowerCase('es');
      if (!genreMap.has(key)) genreMap.set(key, genre);
    });
  });
  const genres = [...genreMap.values()]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const subcategories = [...new Set(facetItems('subcategory').map(i => String(i.subcategory ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  // Helper: repoblar un <select> de forma segura (sin innerHTML con datos)
  function fillSelect(sel, defaultLabel, values, selectedValue) {
    if (!sel) return '';
    const wanted = String(selectedValue || '').trim();

    sel.textContent = '';

    const def = document.createElement('option');
    def.value = '';
    def.textContent = defaultLabel;
    sel.appendChild(def);

    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }

    if (wanted && values.some(v => String(v).trim() === wanted)) {
      sel.value = wanted;
      return wanted;
    }
    sel.value = '';
    return '';
  }

  const formatEl = document.getElementById('filterFormat');
  const yearEl = document.getElementById('filterYear');
  const genreEl = document.getElementById('filterGenre');
  const authorEl = document.getElementById('filterAuthor');
  const locationEl = document.getElementById('filterLocation');
  const subEl = document.getElementById('filterSubcategory');

  const resolved = {
    format: fillSelect(formatEl, 'Todos los formatos', formats, active.format),
    year: fillSelect(yearEl, 'Todos los años', years, active.year),
    genre: fillSelect(genreEl, 'Todos los géneros', genres, active.genre),
    author: fillSelect(authorEl, 'Todos los autores', authors, active.author),
    location: fillSelect(locationEl, 'Todas las ubicaciones', locations, active.location),
    subcategory: fillSelect(subEl, 'Todas las subcategorías', subcategories, active.subcategory)
  };

  // Cada categoría muestra únicamente filtros con datos disponibles.
  // Subcategoría continúa siendo específica de "Otros".
  if (formatEl) formatEl.style.display = formats.length ? '' : 'none';
  if (genreEl) genreEl.style.display = genres.length ? '' : 'none';
  if (yearEl) yearEl.style.display = years.length ? '' : 'none';
  if (authorEl) authorEl.style.display = authors.length ? '' : 'none';
  // v2.27.0: Ubicación es un campo global de la colección. El selector permanece
  // disponible en todas las categorías aunque en alguna aún no haya valores cargados.
  if (locationEl) locationEl.style.display = '';

  const subWrap = document.getElementById('filterSubcatWrap');
  if (subWrap) {
    subWrap.style.display = (canon === 'Otros' && subcategories.length) ? 'block' : 'none';
  }

  return resolved;
}

function refreshCorrelatedFilterOptions() {
  // Primera pasada con lo que el usuario tiene seleccionado en pantalla.
  const before = getFilterValuesFromUI();
  const resolved = populateFilterOptions(currentCategory, before);

  // Si una combinación anterior quedó invalidada y algún select se limpió,
  // una segunda pasada recalcula las demás facetas con el nuevo contexto.
  const changed = ['format','genre','year','author','location','subcategory'].some(key => (before[key] || '') !== (resolved[key] || ''));
  if (changed) populateFilterOptions(currentCategory, resolved);
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
      const genreOk  = !currentFilters.genre || genreContains(item.genre, currentFilters.genre);
      const yearOk   = !currentFilters.year   || String(item.year   ?? '') === currentFilters.year;
      const authorOk = !currentFilters.author || authorContains(item.author, currentFilters.author);
      const locationOk = !currentFilters.location || String(item.location ?? '') === currentFilters.location;
      const subOk    = (canonCat !== 'Otros')
        ? true
        : (!currentFilters.subcategory || String(item.subcategory ?? '') === currentFilters.subcategory);

      return searchOk && formatOk && genreOk && yearOk && authorOk && locationOk && subOk;
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
      // v2.19.0: CDs, Vinilos y Otros suelen usar carátulas cuadradas.
      // Las centramos en el marco vertical sin deformarlas ni recortarlas.
      if (['CDs', 'Vinilos', 'Otros'].includes(String(item.type || '').trim())) {
        media.classList.add('is-square-media');
      }
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
      const coverTitleText = String(item.title || '(Sin título)');
      title.textContent = coverTitleText;
      // v2.23.0: los títulos largos adaptan tipografía y líneas dentro del
      // mismo alto fijo de tarjeta. Así no empujan la paginación ni alteran
      // el tamaño de las carátulas.
      const coverTitleLength = Array.from(coverTitleText.trim()).length;
      if (coverTitleLength > 46) {
        title.classList.add('is-very-long-title');
      } else if (coverTitleLength > 28) {
        title.classList.add('is-long-title');
      }
      text.appendChild(title);
      const author = String(item.author || '').trim();
      const meta = document.createElement('span');
      meta.className = 'cover-card-meta';
      meta.textContent = author || '\u00a0';
      if (!author) meta.setAttribute('aria-hidden', 'true');
      text.appendChild(meta);

      card.append(media, text);
      card.onclick = () => showItemDetails(item.id);
      grid.appendChild(card);
    });

    // v2.17.0: reserva siempre cuatro huecos en vista carátulas.
    // Así la altura de la cuadrícula y la paginación no cambian entre páginas,
    // incluida la última cuando contiene menos de cuatro elementos.
    for (let i = currentItems.length; i < COVER_ITEMS_PER_PAGE; i++) {
      const spacer = document.createElement('span');
      spacer.className = 'cover-card cover-card-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      grid.appendChild(spacer);
    }

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
  const syncCategorySpecificFields = () => {
    const canon = canonicalizeType(typeSelect.value);
    if (canon === 'Otros') {
      subcategorySelect.style.display = 'block';
    } else {
      subcategorySelect.style.display = 'none';
      subcategorySelect.value = ''; // resetear si no aplica
    }

    const publisherInput = document.getElementById('publisher');
    const isbnInput = document.getElementById('isbn');
    if (publisherInput) {
      const showPublisher = canon === 'Libros' || canon === 'CDs' || canon === 'Vinilos';
      publisherInput.style.display = showPublisher ? 'block' : 'none';
      publisherInput.placeholder = canon === 'Libros' ? 'Editorial' : 'Discográfica';
      if (!showPublisher) publisherInput.value = '';
    }
    if (isbnInput) {
      isbnInput.style.display = canon === 'Libros' ? 'block' : 'none';
      if (canon !== 'Libros') isbnInput.value = '';
    }
  };
  
  typeSelect.addEventListener('change', syncCategorySpecificFields);
  syncCategorySpecificFields();
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
  setupSharedCollectionAutoRefresh();
 
  
  // 3) Enlazar importador Excel
  const importInput = document.getElementById('importExcelInput');
  if (importInput) {
    importInput.addEventListener('change', handleImportExcel);
  }

  const repairInput = document.getElementById('repairExcelInput');
  if (repairInput) {
    repairInput.addEventListener('change', handleRepairExcel);
  }

  // v2.5.0: restauración de backups JSON completos
  const importJsonInput = document.getElementById('importJsonInput');
  if (importJsonInput) {
    importJsonInput.addEventListener('change', handleImportJSON);
  }

  // v2.15.0: restauración completa D1 + R2 desde ZIP
  const importFullBackupInput = document.getElementById('importFullBackupInput');
  if (importFullBackupInput) {
    importFullBackupInput.addEventListener('change', handleImportFullBackupZip);
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
  currentFilters = { format:'', genre:'', year:'', author:'', location:'', subcategory:'' };
  ['filterFormat','filterGenre','filterYear','filterAuthor','filterLocation','filterSubcategory'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  updateFilterBadge();
}

function closeImportConfirmModal() {
  const m = document.getElementById('importConfirmModal');
  if (m) m.style.display = 'none';

  // Dejar siempre limpio el estado visual para la siguiente importación.
  const okBtn = document.getElementById('importConfirmOkBtn');
  if (okBtn) {
    okBtn.disabled = false;
    okBtn.textContent = 'Continuar';
  }
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

 

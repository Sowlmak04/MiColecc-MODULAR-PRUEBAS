  (function() {
    if (!('serviceWorker' in navigator)) return;
    
    let refreshing = false;
    
    function promptUpdate(reg) {
      const doUpdate = () => {
        try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      };
      
      // Si tienes toast(), lo usamos. Si no, fallback a confirm().
      if (typeof toast === 'function') {
        toast('Nueva versión disponible. Toca aquí para actualizar.', 'success', 9000);
        
        // Hacemos el toast "clicable" SOLO para esta acción.
        const el = document.getElementById('toast');
        if (el) {
          const prevOnClick = el.onclick;
          el.style.cursor = 'pointer';
          el.onclick = () => {
            el.onclick = prevOnClick || null;
            el.style.cursor = '';
            doUpdate();
          };
        }
      } else {
        if (confirm('Nueva versión disponible. ¿Actualizar ahora?')) doUpdate();
      }
    }
    
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js?v=2026-09-25-modular1-update-test');
        
        // Si ya hay una versión esperando y ya hay controller, avisar
        if (reg.waiting && navigator.serviceWorker.controller) {
          promptUpdate(reg);
        }
        
        // Detectar updates futuros
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdate(reg);
            }
          });
        });
      } catch (e) {
        console.warn('[SW] Registro fallido', e);
      }
    });
  })();

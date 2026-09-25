(function() {
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  let updateRegistration = null;

  function removeUpdateBanner() {
    const old = document.getElementById('swUpdateBanner');
    if (old) old.remove();
  }

  function showUpdateBanner(reg) {
    if (!reg || !reg.waiting || !navigator.serviceWorker.controller) return;
    updateRegistration = reg;

    let banner = document.getElementById('swUpdateBanner');
    if (!banner) {
      banner = document.createElement('button');
      banner.id = 'swUpdateBanner';
      banner.type = 'button';
      banner.textContent = 'Nueva versión disponible · Actualizar';
      Object.assign(banner.style, {
        position: 'fixed',
        left: '50%',
        bottom: '22px',
        transform: 'translateX(-50%)',
        zIndex: '10000',
        maxWidth: 'calc(100% - 32px)',
        padding: '12px 16px',
        borderRadius: '14px',
        border: '1px solid #27ae60',
        background: '#777',
        color: '#fff',
        fontSize: '16px',
        lineHeight: '1.2',
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,.25)'
      });
      banner.addEventListener('click', () => {
        const waiting = updateRegistration && updateRegistration.waiting;
        if (!waiting) return;
        banner.disabled = true;
        banner.textContent = 'Actualizando…';
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
      document.body.appendChild(banner);
    }
  }

  function inspectRegistration(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner(reg);
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    removeUpdateBanner();
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js?v=2026-09-25-modular1-swfix');
      inspectRegistration(reg);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') inspectRegistration(reg);
        });
      });

      // Fuerza una comprobación al arrancar y vuelve a inspeccionar el estado.
      try { await reg.update(); } catch (_) {}
      inspectRegistration(reg);

      // En iOS una PWA puede reanudarse sin un nuevo evento load.
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        try { await reg.update(); } catch (_) {}
        inspectRegistration(reg);
      });

      window.addEventListener('pageshow', () => inspectRegistration(reg));
    } catch (e) {
      console.warn('[SW] Registro fallido', e);
    }
  });
})();

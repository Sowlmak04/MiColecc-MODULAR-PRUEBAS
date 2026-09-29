export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Endpoint mínimo para comprobar que el Worker está activo.
    // No lee ni modifica la colección local.
    if (url.pathname === '/api/health') {
      return Response.json({
        ok: true,
        app: 'Mi Colección',
        version: '2.7.0',
        backend: 'local',
        cloudflare: true
      }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return json({
          ok: true,
          app: 'Mi Colección',
          version: '2.8.0',
          backend: 'local',
          cloudflare: true,
          d1: row?.ok === 1 ? 'connected' : 'unexpected-response'
        });
      } catch (error) {
        return json({
          ok: false,
          app: 'Mi Colección',
          version: '2.8.0',
          backend: 'local',
          cloudflare: true,
          d1: 'error',
          error: String(error?.message || error)
        }, 500);
      }
    }

    // Prueba controlada de escritura + lectura en D1.
    // Solo crea/usa una tabla técnica; NO toca la colección real.
    if (url.pathname === '/api/d1-test') {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS _system_probe (
            id TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();

        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO _system_probe (id, value, updated_at)
          VALUES ('worker-d1-test', 'ok', ?)
          ON CONFLICT(id) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `).bind(now).run();

        const row = await env.DB.prepare(`
          SELECT id, value, updated_at
          FROM _system_probe
          WHERE id = 'worker-d1-test'
        `).first();

        return json({
          ok: row?.value === 'ok',
          app: 'Mi Colección',
          version: '2.8.0',
          test: 'd1-read-write',
          database: 'mi-coleccion-db',
          result: row
        });
      } catch (error) {
        return json({
          ok: false,
          app: 'Mi Colección',
          version: '2.8.0',
          test: 'd1-read-write',
          database: 'mi-coleccion-db',
          error: String(error?.message || error)
        }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

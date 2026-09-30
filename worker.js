const APP = 'Mi Colección';
const VERSION = '2.10.2';
const DB_NAME = 'mi-coleccion-db';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function cleanText(value, max = 10000) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max);
}

function normalizeItem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('El elemento debe ser un objeto JSON');
  }
  const id = cleanText(body.id, 26).trim().toUpperCase();
  if (!ULID_RE.test(id)) throw new Error('ULID no válido');
  if (Number(body.schemaVersion) !== 2) throw new Error('schemaVersion debe ser 2');

  const images = Array.isArray(body.images) ? body.images : [];
  return {
    id,
    schemaVersion: 2,
    legacyId: body.legacyId == null ? null : cleanText(body.legacyId, 500),
    legacyKey: body.legacyKey == null ? null : cleanText(body.legacyKey, 4000),
    title: cleanText(body.title, 2000),
    type: cleanText(body.type, 200),
    subcategory: cleanText(body.subcategory, 1000),
    author: cleanText(body.author, 2000),
    format: cleanText(body.format, 1000),
    genre: cleanText(body.genre, 1000),
    year: cleanText(body.year, 200),
    notes: cleanText(body.notes, 20000),
    moreInfo: cleanText(body.moreInfo, 20000),
    images
  };
}

function rowToItem(row) {
  let images = [];
  try { images = JSON.parse(row.images_json || '[]'); } catch {}
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    legacyId: row.legacy_id,
    legacyKey: row.legacy_key,
    title: row.title || '',
    type: row.type || '',
    subcategory: row.subcategory || '',
    author: row.author || '',
    format: row.format || '',
    genre: row.genre || '',
    year: row.year || '',
    notes: row.notes || '',
    moreInfo: row.more_info || '',
    images,
    coverImage: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureItemsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 2 CHECK(schema_version = 2),
      legacy_id TEXT,
      legacy_key TEXT,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      more_info TEXT NOT NULL DEFAULT '',
      images_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_items_legacy_key ON items(legacy_key)`).run();
}

async function itemsApi(request, env, url) {
  await ensureItemsTable(env.DB);
  const prefix = '/api/items';
  const suffix = url.pathname.slice(prefix.length);
  const id = suffix.startsWith('/') ? decodeURIComponent(suffix.slice(1)).trim().toUpperCase() : '';

  if (request.method === 'GET' && !id) {
    const { results } = await env.DB.prepare(`
      SELECT * FROM items ORDER BY type COLLATE NOCASE, title COLLATE NOCASE, id
    `).all();
    return json({ ok: true, count: results.length, items: results.map(rowToItem) });
  }

  if (request.method === 'GET' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    if (!row) return error('Elemento no encontrado', 404);
    return json({ ok: true, item: rowToItem(row) });
  }

  if (request.method === 'POST' && !id) {
    let item;
    try { item = normalizeItem(await request.json()); }
    catch (e) { return error(e.message, 400); }
    const exists = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(item.id).first();
    if (exists) return error('Ya existe un elemento con ese ULID', 409);

    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO items (
        id, schema_version, legacy_id, legacy_key, title, type, subcategory,
        author, format, genre, year, notes, more_info, images_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
      item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
      item.moreInfo, JSON.stringify(item.images), now, now
    ).run();
    return json({ ok: true, created: true, item: { ...item, coverImage: null, createdAt: now, updatedAt: now } }, 201);
  }

  if (request.method === 'PUT' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    let item;
    try { item = normalizeItem(await request.json()); }
    catch (e) { return error(e.message, 400); }
    if (item.id !== id) return error('El ULID de la URL y del elemento deben coincidir', 400);
    const exists = await env.DB.prepare(`SELECT created_at FROM items WHERE id = ?`).bind(id).first();
    if (!exists) return error('Elemento no encontrado', 404);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE items SET
        schema_version=?, legacy_id=?, legacy_key=?, title=?, type=?, subcategory=?,
        author=?, format=?, genre=?, year=?, notes=?, more_info=?, images_json=?, updated_at=?
      WHERE id=?
    `).bind(
      item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
      item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
      item.moreInfo, JSON.stringify(item.images), now, id
    ).run();
    return json({ ok: true, updated: true, item: { ...item, coverImage: null, createdAt: exists.created_at, updatedAt: now } });
  }

  if (request.method === 'DELETE' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    const exists = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(id).first();
    if (!exists) return error('Elemento no encontrado', 404);
    await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(id).run();
    return json({ ok: true, deleted: true, id });
  }

  return error('Método no permitido', 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return json({
          ok: true, app: APP, version: VERSION, backend: 'd1',
          cloudflare: true, d1: row?.ok === 1 ? 'connected' : 'unexpected-response'
        });
      } catch (e) {
        return json({ ok: false, app: APP, version: VERSION, backend: 'd1',
          cloudflare: true, d1: 'error', error: String(e?.message || e) }, 500);
      }
    }

    if (url.pathname === '/api/d1-test') {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS _system_probe (
            id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
          )
        `).run();
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO _system_probe (id, value, updated_at)
          VALUES ('worker-d1-test', 'ok', ?)
          ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        `).bind(now).run();
        const row = await env.DB.prepare(`
          SELECT id, value, updated_at FROM _system_probe WHERE id='worker-d1-test'
        `).first();
        return json({ ok: row?.value === 'ok', app: APP, version: VERSION,
          test: 'd1-read-write', database: DB_NAME, result: row });
      } catch (e) {
        return json({ ok: false, app: APP, version: VERSION, test: 'd1-read-write',
          database: DB_NAME, error: String(e?.message || e) }, 500);
      }
    }

    if (url.pathname === '/api/crud-test' && request.method === 'GET') {
      const testId = '01K6D1TEST0000000000000000';
      const steps = [];
      try {
        await ensureItemsTable(env.DB);

        // Deja la prueba repetible aunque una ejecución anterior se interrumpiera.
        await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(testId).run();

        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO items (
            id, schema_version, legacy_id, legacy_key, title, type, subcategory,
            author, format, genre, year, notes, more_info, images_json, created_at, updated_at
          ) VALUES (?, 2, NULL, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, '[]', ?, ?)
        `).bind(
          testId,
          'Películas|prueba crud d1|chatgpt|2026|Blu-ray||Prueba',
          'Prueba CRUD D1',
          'Películas',
          'ChatGPT',
          'Blu-ray',
          'Prueba',
          '2026',
          'Registro técnico temporal',
          '',
          now,
          now
        ).run();
        steps.push('create');

        let row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(testId).first();
        if (!row || row.title !== 'Prueba CRUD D1') throw new Error('Falló la lectura tras crear');
        steps.push('read');

        const updatedAt = new Date().toISOString();
        await env.DB.prepare(`
          UPDATE items SET title = ?, notes = ?, updated_at = ? WHERE id = ?
        `).bind('Prueba CRUD D1 EDITADA', 'Registro técnico temporal editado', updatedAt, testId).run();

        row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(testId).first();
        if (!row || row.title !== 'Prueba CRUD D1 EDITADA') throw new Error('Falló la verificación tras editar');
        steps.push('update');

        await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(testId).run();
        const gone = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(testId).first();
        if (gone) throw new Error('Falló la verificación tras borrar');
        steps.push('delete');

        const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM items`).first();
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          test: 'items-crud',
          database: DB_NAME,
          steps,
          testItemRemoved: true,
          itemsCountAfterTest: countRow?.count ?? 0
        });
      } catch (e) {
        // Limpieza de seguridad del registro técnico si algo falla a mitad.
        try { await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(testId).run(); } catch {}
        return json({
          ok: false,
          app: APP,
          version: VERSION,
          test: 'items-crud',
          database: DB_NAME,
          steps,
          error: String(e?.message || e)
        }, 500);
      }
    }

    if (url.pathname === '/api/items/init' && request.method === 'POST') {
      try {
        await ensureItemsTable(env.DB);
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM items`).first();
        return json({ ok: true, app: APP, version: VERSION, table: 'items', count: row?.count ?? 0 });
      } catch (e) {
        return error(String(e?.message || e), 500);
      }
    }

    if (url.pathname === '/api/items' || url.pathname.startsWith('/api/items/')) {
      try { return await itemsApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    return env.ASSETS.fetch(request);
  }
};

const APP = 'Mi Colección';
const VERSION = '2.15.0';
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
    coverImage: coverUrlFromImages(row.id, images, row.updated_at),
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

function coverObjectKey(id) {
  return `covers/${id}/01.jpg`;
}

function coverUrlFromImages(id, images, fallbackVersion = '') {
  const cover = Array.isArray(images) ? images.find(img => img && img.role === 'cover' && img.key) : null;
  if (!cover) return null;
  const version = cover.updatedAt || fallbackVersion || '';
  return `/api/images/${encodeURIComponent(id)}/cover${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

async function imageApi(request, env, url) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500, { r2: 'missing-binding' });
  await ensureItemsTable(env.DB);

  const match = url.pathname.match(/^\/api\/images\/([^/]+)\/cover$/);
  if (!match) return error('Ruta de imagen no válida', 404);

  const id = decodeURIComponent(match[1]).trim().toUpperCase();
  if (!ULID_RE.test(id)) return error('ULID no válido', 400);
  const key = coverObjectKey(id);

  if (request.method === 'GET') {
    const object = await env.IMAGES.get(key);
    if (!object) return error('Carátula no encontrada', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', headers.get('Content-Type') || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=86400');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  }

  const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
  if (!row) return error('Elemento no encontrado', 404);

  if (request.method === 'PUT') {
    const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return error('El archivo debe ser una imagen', 415);

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return error('La imagen está vacía', 400);
    if (bytes.byteLength > 1_000_000) return error('La imagen supera el límite de 1 MB', 413);

    const now = new Date().toISOString();
    await env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { itemId: id, role: 'cover' }
    });

    let images = [];
    try { images = JSON.parse(row.images_json || '[]'); } catch {}
    images = (Array.isArray(images) ? images : []).filter(img => !(img && img.role === 'cover'));
    images.push({ key, role: 'cover', contentType: 'image/jpeg', updatedAt: now });

    await env.DB.prepare(`UPDATE items SET images_json = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), now, id).run();
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, uploaded: true, item: rowToItem(updatedRow) });
  }

  if (request.method === 'DELETE') {
    await env.IMAGES.delete(key);
    let images = [];
    try { images = JSON.parse(row.images_json || '[]'); } catch {}
    images = (Array.isArray(images) ? images : []).filter(img => !(img && img.role === 'cover'));
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE items SET images_json = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), now, id).run();
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, deleted: true, item: rowToItem(updatedRow) });
  }

  return error('Método no permitido', 405);
}

async function r2SmokeTest(env) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500, { r2: 'missing-binding' });

  const key = `_healthcheck/mi-coleccion-${crypto.randomUUID()}.txt`;
  const payload = `Mi Colección R2 smoke test ${new Date().toISOString()}`;
  let wrote = false;
  let read = false;
  let deleted = false;

  try {
    await env.IMAGES.put(key, payload, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' }
    });
    wrote = true;

    const object = await env.IMAGES.get(key);
    if (!object) throw new Error('R2 no devolvió el objeto recién escrito');
    const stored = await object.text();
    if (stored !== payload) throw new Error('El contenido leído de R2 no coincide con el escrito');
    read = true;

    await env.IMAGES.delete(key);
    deleted = true;

    return json({
      ok: true,
      app: APP,
      version: VERSION,
      r2: 'connected',
      bucket: 'mi-coleccion-images',
      write: wrote,
      read,
      delete: deleted,
      persistentTestObject: false
    });
  } catch (e) {
    if (wrote && !deleted) {
      try { await env.IMAGES.delete(key); deleted = true; } catch {}
    }
    return json({
      ok: false,
      app: APP,
      version: VERSION,
      r2: 'error',
      write: wrote,
      read,
      delete: deleted,
      error: String(e?.message || e)
    }, 500);
  }
}



const RESTORE_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restoreTempKey(sessionId, id) {
  return `_restore/${sessionId}/${id}.jpg`;
}

function validIsoOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

async function listAllR2Keys(bucket, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects || []) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteR2Keys(bucket, keys) {
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    if (chunk.length) await bucket.delete(chunk);
  }
}

async function restoreApi(request, env, url) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500);
  await ensureItemsTable(env.DB);

  const parts = url.pathname.split('/').filter(Boolean); // api, restore, session, ...
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'restore') return error('Ruta de restauración no válida', 404);
  const sessionId = decodeURIComponent(parts[2] || '').trim();
  if (!RESTORE_SESSION_RE.test(sessionId)) return error('Sesión de restauración no válida', 400);

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'start') {
    let payload = {};
    try { payload = await request.json(); } catch {}
    const imageCount = Number(payload.imageCount || 0);
    if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > 1000) return error('Número de imágenes no válido', 400);
    // Limpiamos restos de una sesión con el mismo UUID, si existieran.
    const old = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
    if (old.length) await deleteR2Keys(env.IMAGES, old);
    return json({ ok: true, sessionId, imageCount });
  }

  if (request.method === 'PUT' && parts.length === 5 && parts[3] === 'images') {
    const id = decodeURIComponent(parts[4] || '').trim().toUpperCase();
    if (!ULID_RE.test(id)) return error('ULID de imagen no válido', 400);
    const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return error('El archivo debe ser una imagen', 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return error('La imagen está vacía', 400);
    if (bytes.byteLength > 1_000_000) return error('La imagen supera el límite de 1 MB', 413);
    await env.IMAGES.put(restoreTempKey(sessionId, id), bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { restoreSession: sessionId, itemId: id, role: 'cover' }
    });
    return json({ ok: true, staged: true, id });
  }

  if (request.method === 'DELETE' && parts.length === 3) {
    const temp = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
    if (temp.length) await deleteR2Keys(env.IMAGES, temp);
    return json({ ok: true, cleaned: temp.length });
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'commit') {
    let payload;
    try { payload = await request.json(); }
    catch { return error('JSON de restauración no válido', 400); }
    if (!payload || payload.backupType !== 'MiColeccion-full' || Number(payload.backupFormatVersion) !== 1) {
      return error('Formato de copia completa no compatible', 400);
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 1000) {
      return error('Lista de elementos no válida', 400);
    }
    if (!Array.isArray(payload.images) || payload.images.length > 1000) return error('Manifiesto de imágenes no válido', 400);

    let incoming;
    try { incoming = payload.items.map(normalizeItem); }
    catch (e) { return error(e.message, 400); }
    const ids = incoming.map(x => x.id);
    if (new Set(ids).size !== ids.length) return error('El backup contiene ULID duplicados', 409);
    const idSet = new Set(ids);

    const imageById = new Map();
    for (const img of payload.images) {
      const id = cleanText(img?.id, 26).trim().toUpperCase();
      if (!ULID_RE.test(id) || !idSet.has(id)) return error('El manifiesto contiene una carátula inválida', 400);
      if (img?.role !== 'cover' || imageById.has(id)) return error('Manifiesto de carátulas no válido', 400);
      imageById.set(id, { contentType: 'image/jpeg' });
    }

    // Verificar que todos los objetos temporales existen ANTES de tocar D1.
    for (const id of imageById.keys()) {
      const staged = await env.IMAGES.head(restoreTempKey(sessionId, id));
      if (!staged) return error(`Falta la carátula temporal de ${id}`, 409);
    }

    // Copiar las imágenes temporales a sus claves definitivas antes del commit D1.
    // Si algo falla aquí, D1 permanece intacto.
    const imageIds = [...imageById.keys()];
    for (let i = 0; i < imageIds.length; i += 10) {
      const chunk = imageIds.slice(i, i + 10);
      await Promise.all(chunk.map(async id => {
        const staged = await env.IMAGES.get(restoreTempKey(sessionId, id));
        if (!staged) throw new Error(`Carátula temporal desaparecida: ${id}`);
        const bytes = await staged.arrayBuffer();
        await env.IMAGES.put(coverObjectKey(id), bytes, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { itemId: id, role: 'cover' }
        });
      }));
    }

    const now = new Date().toISOString();
    const originalsById = new Map(payload.items.map(it => [String(it.id || '').trim().toUpperCase(), it]));
    const statements = [env.DB.prepare('DELETE FROM items')];

    for (const item of incoming) {
      const original = originalsById.get(item.id) || {};
      const hasCover = imageById.has(item.id);
      let images = Array.isArray(item.images) ? item.images.filter(img => !(img && img.role === 'cover')) : [];
      if (hasCover) {
        const originalCover = Array.isArray(original.images) ? original.images.find(img => img && img.role === 'cover') : null;
        images.push({
          key: coverObjectKey(item.id),
          role: 'cover',
          contentType: 'image/jpeg',
          updatedAt: validIsoOr(originalCover?.updatedAt, validIsoOr(original.updatedAt, now))
        });
      }
      const createdAt = validIsoOr(original.createdAt, now);
      const updatedAt = validIsoOr(original.updatedAt, now);

      statements.push(env.DB.prepare(`
        INSERT INTO items (
          id, schema_version, legacy_id, legacy_key, title, type, subcategory,
          author, format, genre, year, notes, more_info, images_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.id, item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
        item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
        item.moreInfo, JSON.stringify(images), createdAt, updatedAt
      ));
    }

    // D1 batch es la unidad transaccional: si una sentencia falla, no queda una
    // colección parcialmente sustituida.
    await env.DB.batch(statements);

    // Limpiar carátulas antiguas que no pertenecen al backup restaurado.
    let imageCleanup = true;
    try {
      const wanted = new Set(imageIds.map(coverObjectKey));
      const currentCoverKeys = await listAllR2Keys(env.IMAGES, 'covers/');
      const stale = currentCoverKeys.filter(key => !wanted.has(key));
      if (stale.length) await deleteR2Keys(env.IMAGES, stale);
    } catch (e) {
      imageCleanup = false;
      console.error('[restore stale R2 cleanup]', e);
    }

    // Limpiar siempre la zona temporal de esta restauración.
    try {
      const temp = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
      if (temp.length) await deleteR2Keys(env.IMAGES, temp);
    } catch (e) {
      console.error('[restore temp cleanup]', e);
    }

    const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY type COLLATE NOCASE, title COLLATE NOCASE, id').all();
    return json({
      ok: true,
      restored: true,
      count: results.length,
      imageCount: imageIds.length,
      imageCleanup
    });
  }

  return error('Método de restauración no permitido', 405);
}

async function itemsApi(request, env, url) {
  await ensureItemsTable(env.DB);
  const prefix = '/api/items';
  const suffix = url.pathname.slice(prefix.length);
  const id = suffix.startsWith('/') ? decodeURIComponent(suffix.slice(1)).trim().toUpperCase() : '';

  if (request.method === 'POST' && suffix === '/import') {
    let payload;
    try { payload = await request.json(); }
    catch { return error('JSON de importación no válido', 400); }

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      return error('La importación no contiene elementos', 400);
    }
    if (payload.items.length > 1000) return error('Demasiados elementos en una sola importación', 400);

    let incoming;
    try { incoming = payload.items.map(normalizeItem); }
    catch (e) { return error(e.message, 400); }

    const keys = incoming.map(item => String(item.legacyKey || '').trim());
    if (keys.some(key => !key)) return error('Todos los elementos importados deben tener legacyKey', 400);
    if (new Set(keys).size !== keys.length) return error('El Excel contiene elementos duplicados según su clave de coincidencia', 409);

    const { results: existingRows } = await env.DB.prepare(
      'SELECT id, legacy_key, created_at FROM items WHERE legacy_key IS NOT NULL'
    ).all();
    const existingByKey = new Map(existingRows.map(row => [String(row.legacy_key), row]));

    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;
    const statements = [];

    incoming.forEach((item, index) => {
      const existing = existingByKey.get(String(item.legacyKey)) || null;
      if (existing) {
        updated++;
        statements.push(env.DB.prepare(`
          UPDATE items SET
            schema_version=?, legacy_id=?, legacy_key=?, title=?, type=?, subcategory=?,
            author=?, format=?, genre=?, year=?, notes=?, more_info=?, images_json=?, updated_at=?
          WHERE id=?
        `).bind(
          item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
          item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
          item.moreInfo, JSON.stringify(item.images), now, existing.id
        ));
      } else {
        added++;
        statements.push(env.DB.prepare(`
          INSERT INTO items (
            id, schema_version, legacy_id, legacy_key, title, type, subcategory,
            author, format, genre, year, notes, more_info, images_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id, item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
          item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
          item.moreInfo, JSON.stringify(item.images), now, now
        ));
      }
    });

    // Lotes moderados para mantener la importación estable también con colecciones mayores.
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50));
    }
    return json({ ok: true, imported: incoming.length, added, updated });
  }

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
    const createdRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(item.id).first();
    return json({ ok: true, created: true, item: rowToItem(createdRow) }, 201);
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
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, updated: true, item: rowToItem(updatedRow) });
  }

  if (request.method === 'DELETE' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    const exists = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(id).first();
    if (!exists) return error('Elemento no encontrado', 404);
    await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(id).run();
    let imageCleanup = true;
    if (env.IMAGES) {
      try {
        const listed = await env.IMAGES.list({ prefix: `covers/${id}/` });
        if (listed.objects.length) await env.IMAGES.delete(listed.objects.map(obj => obj.key));
      } catch (e) {
        imageCleanup = false;
        console.error('[R2 cleanup after item delete]', e);
      }
    }
    return json({ ok: true, deleted: true, id, imageCleanup });
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
          cloudflare: true,
          d1: row?.ok === 1 ? 'connected' : 'unexpected-response',
          r2: env.IMAGES ? 'bound' : 'missing-binding'
        });
      } catch (e) {
        return json({ ok: false, app: APP, version: VERSION, backend: 'd1',
          cloudflare: true, d1: 'error', error: String(e?.message || e) }, 500);
      }
    }


    if (url.pathname === '/api/images/health' && request.method === 'GET') {
      return await r2SmokeTest(env);
    }

    if (url.pathname.startsWith('/api/images/')) {
      try { return await imageApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    if (url.pathname.startsWith('/api/restore/')) {
      try { return await restoreApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    // Los endpoints técnicos de prueba usados durante la validación inicial de D1
    // se retiraron en v2.10.4. El CRUD normal queda exclusivamente en /api/items.

    if (url.pathname === '/api/items' || url.pathname.startsWith('/api/items/')) {
      try { return await itemsApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    return env.ASSETS.fetch(request);
  }
};

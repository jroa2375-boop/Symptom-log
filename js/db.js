// Tiny IndexedDB wrapper. Everything stays on this device.
//
// Stores
//   symptoms  { id, start, durationMin, intensity, painTypes[], location, radiates[],
//               activity[], modifiers[], redFlags[], notes, createdAt, updatedAt }
//   metrics   { key: "type|ts", type, ts, value, value2?, unit?, source?, ...extra }
//   meta      { key, value }  settings and bookkeeping

const DB_NAME = 'symptom-log';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('symptoms')) {
        const s = db.createObjectStore('symptoms', { keyPath: 'id' });
        s.createIndex('start', 'start');
      }
      if (!db.objectStoreNames.contains('metrics')) {
        const m = db.createObjectStore('metrics', { keyPath: 'key' });
        m.createIndex('type_ts', ['type', 'ts']);
        m.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab. Close it and try again.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function clear(store) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

export async function count(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).count());
}

/**
 * Write many records in one transaction. Returns { added, updated } so imports
 * can report how many were new versus re-imported duplicates.
 */
export async function bulkPut(store, records, keyField) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  let added = 0;
  let updated = 0;
  for (const r of records) {
    const existsReq = os.getKey(r[keyField]);
    existsReq.onsuccess = () => {
      if (existsReq.result === undefined) added++;
      else updated++;
      os.put(r);
    };
  }
  await done(tx);
  return { added, updated };
}

/** Metrics of one type within [from, to). */
export async function metricsByType(type, from = 0, to = Number.MAX_SAFE_INTEGER) {
  const db = await open();
  const idx = db.transaction('metrics').objectStore('metrics').index('type_ts');
  return reqP(idx.getAll(IDBKeyRange.bound([type, from], [type, to], false, true)));
}

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch (_) {
    /* not supported */
  }
}

export async function exportAll() {
  const [symptoms, metrics, meta] = await Promise.all([getAll('symptoms'), getAll('metrics'), getAll('meta')]);
  return {
    format: 'symptom-log-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    symptoms,
    metrics,
    meta: meta.filter((m) => !m.key.startsWith('migrated:')),
  };
}

/** Merge a backup into the database (never deletes existing records). */
export async function importAll(backup) {
  if (!backup || backup.format !== 'symptom-log-backup') throw new Error('That file is not a Symptom Log backup.');
  const s = await bulkPut('symptoms', backup.symptoms || [], 'id');
  const m = await bulkPut('metrics', backup.metrics || [], 'key');
  for (const item of backup.meta || []) {
    if (item.key === 'settings') {
      const current = await getMeta('settings', {});
      await setMeta('settings', { ...item.value, ...current });
    }
  }
  return { symptoms: s, metrics: m };
}

/** Delete all entries and health data. Migration flags are kept so old entries don't come back. */
export async function wipeAll() {
  const meta = await getAll('meta');
  await Promise.all([clear('symptoms'), clear('metrics'), clear('meta')]);
  for (const m of meta.filter((x) => x.key.startsWith('migrated:'))) await put('meta', m);
}

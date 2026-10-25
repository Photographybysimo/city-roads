/**
 * Local cache of Overpass responses, keyed by the exact query string.
 *
 * The second load of the same venue or city comes from this browser's
 * IndexedDB instead of the public Overpass servers, so it is near-instant.
 * Any failure here is swallowed: the cache only ever makes things faster,
 * never breaks a load.
 */
const DB_NAME = 'city-roads-cache';
const STORE = 'overpass';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // road networks change slowly

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

export function getCached(key) {
  return openDB().then(db => new Promise(resolve => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry || Date.now() - entry.savedAt > MAX_AGE_MS) return resolve(null);
      resolve(entry.data);
    };
    req.onerror = () => resolve(null);
  })).catch(() => null);
}

export function setCached(key, data) {
  return openDB().then(db => new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({savedAt: Date.now(), data}, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  })).catch(() => false);
}

export function clearCache() {
  return openDB().then(db => new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  })).catch(() => false);
}

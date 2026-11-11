const mem = new Map();
let dbp = null;

function hasIDB() {
  return typeof indexedDB !== 'undefined';
}

async function db() {
  if (!hasIDB()) return null;
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mrs-media', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export async function idbPut(key, blob) {
  if (!hasIDB()) { mem.set(key, blob); return; }
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet(key) {
  if (!hasIDB()) return mem.get(key) ?? null;
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readonly');
    const rq = tx.objectStore('files').get(key);
    rq.onsuccess = () => resolve(rq.result ?? null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function idbDelete(key) {
  if (!hasIDB()) { mem.delete(key); return; }
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear() {
  if (!hasIDB()) { mem.clear(); return; }
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

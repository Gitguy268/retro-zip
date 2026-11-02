// Local library. Game bytes live in the browser's private file system (OPFS), or
// IndexedDB where that isn't available. Nothing here ever leaves the browser.
const DB = 'retro-zip';
let dbPromise;

function db() {
  dbPromise ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('games', { keyPath: 'id' });
      req.result.createObjectStore('lists', { keyPath: 'id' });
      req.result.createObjectStore('blobs');
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  });
}

export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));

async function opfs() {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('blobs', { create: true });
  } catch {
    return null;
  }
}

export async function putBytes(key, bytes) {
  const dir = await opfs();
  if (dir) {
    try {
      const file = await dir.getFileHandle(key, { create: true });
      const w = await file.createWritable();
      await w.write(bytes);
      await w.close();
      return;
    } catch { /* falls through to IndexedDB, e.g. where createWritable is missing */ }
  }
  await put('blobs', new Blob([bytes]), key);
}

export async function getBytes(key) {
  const dir = await opfs();
  if (dir) {
    try {
      const file = await (await dir.getFileHandle(key)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch { /* not in OPFS */ }
  }
  const blob = await get('blobs', key);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function delBytes(key) {
  const dir = await opfs();
  if (dir) { try { await dir.removeEntry(key); } catch { /* not in OPFS */ } }
  await del('blobs', key);
}

export async function persist() {
  try { await navigator.storage.persist(); } catch { /* best effort */ }
}

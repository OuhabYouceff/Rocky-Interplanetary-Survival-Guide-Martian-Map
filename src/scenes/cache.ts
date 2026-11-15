// Keep the result of a slow computation between page loads (IndexedDB), so each scene does not redo it.
// Typed arrays are stored as they are. If the store is unavailable the computation simply runs again.
const DB = 'rocky-computed', STORE = 'v1';
const open = () => new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

export async function memo<T>(key: string, compute: () => T | Promise<T>): Promise<T> {
  let db: IDBDatabase | null = null;
  try {
    db = await open();
    const hit = await new Promise<T | undefined>((ok, no) => { const r = db!.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => ok(r.result as T | undefined); r.onerror = () => no(r.error); });
    if (hit !== undefined) return hit;
  } catch { db = null; }
  const value = await compute();
  if (db) try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); } catch { /* storing is optional */ }
  return value;
}
/** A short fingerprint of a height grid, so a cached result is never used with different terrain. */
export function gridKey(z: Float32Array) { let h = 0; for (let i = 0; i < z.length; i += 997) { const v = z[i]; if (v === v) h = (h * 31 + Math.round(v * 100)) | 0; } return `${z.length}:${h}`; }

// This browser's own storage (IndexedDB): exported clips, episode videos, and saved work in demo mode.
const DB = 'hookcut';
export const EPISODES = 'episodes';
export const LIBRARY = 'library';
export const VIDEOS = 'videos';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EPISODES)) db.createObjectStore(EPISODES);
      if (!db.objectStoreNames.contains(LIBRARY)) db.createObjectStore(LIBRARY, { keyPath: 'id' }).createIndex('user', 'user');
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Space left before the browser gets tight, in bytes (Infinity when the browser doesn't say). */
export async function roomLeft(): Promise<number> {
  const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.().catch(() => undefined)) ?? {};
  // Leave plenty for the browser's other needs (and the speech models).
  return quota ? quota * 0.7 - usage : Infinity;
}

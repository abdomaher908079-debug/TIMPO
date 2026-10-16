// Keeps the last episode's work (transcript, clips and edits, and the video itself when there's
// room) in this browser, so a refresh or closed tab doesn't lose it. Nothing is uploaded.
import type { Clip } from './clips';
import type { EpisodeInfo } from './format';
import type { Segment } from './speech';

export interface SavedEpisode {
  fingerprint: string;
  fileName: string;
  info: EpisodeInfo;
  segments: Segment[];
  clips: Clip[];
  savedAt: number;
  // Being listened to in the cloud: reopening continues that instead.
  cloud?: boolean;
}

const DB = 'hookcut';
const STORE = 'episodes';
// Exported clips (library.ts).
export const LIBRARY = 'library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(LIBRARY)) db.createObjectStore(LIBRARY, { keyPath: 'id' }).createIndex('user', 'user');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
  storeName = STORE,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = work(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// One saved episode per account on this browser.
const dataKey = (user: string) => `last:${user}`;
const fileKey = (user: string) => `file:${user}`;

export async function loadEpisode(user: string): Promise<{ episode: SavedEpisode; file: File | null } | null> {
  try {
    const episode = await run<SavedEpisode | undefined>('readonly', (s) => s.get(dataKey(user)));
    if (!episode) return null;
    const stored = await run<{ fingerprint: string; file: File } | undefined>('readonly', (s) => s.get(fileKey(user))).catch(() => undefined);
    return { episode, file: stored?.fingerprint === episode.fingerprint ? stored.file : null };
  } catch (err) {
    console.warn('Saved episode unavailable', err);
    return null;
  }
}

export async function saveEpisode(user: string, episode: SavedEpisode): Promise<void> {
  try {
    await run('readwrite', (s) => void s.put(episode, dataKey(user)));
  } catch (err) {
    console.warn('Episode not saved', err);
  }
}

/** Keeps a copy of the video so the clips can be reopened without choosing it again, if there's room. */
export async function saveVideo(user: string, fingerprint: string, file: File): Promise<boolean> {
  try {
    const current = await run<{ fingerprint: string } | undefined>('readonly', (s) => s.get(fileKey(user)));
    if (current?.fingerprint === fingerprint) return true;
    const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    // Leave plenty of room for the browser's other needs (and the speech models).
    if (quota && usage + file.size > quota * 0.6) return false;
    await navigator.storage?.persist?.().catch(() => false);
    // Drop the previous video first, so two never take up space at once.
    await run('readwrite', (s) => void s.delete(fileKey(user)));
    await run('readwrite', (s) => void s.put({ fingerprint, file }, fileKey(user)));
    return true;
  } catch (err) {
    console.warn('Video not kept', err);
    return false;
  }
}

export async function forgetEpisode(user: string): Promise<void> {
  try {
    await run('readwrite', (s) => {
      s.delete(dataKey(user));
      s.delete(fileKey(user));
    });
  } catch (err) {
    console.warn(err);
  }
}

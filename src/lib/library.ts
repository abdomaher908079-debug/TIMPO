// Exported clips, kept in this browser for a while, then deleted automatically. They never take
// space on our servers. Free keeps them 1 day, paid plans 30 (like saved episodes).
import { LIBRARY, roomLeft, run } from './db';

export interface LibraryClip {
  id: string;
  user: string;
  title: string;
  episode: string;
  fileName: string;
  blob: Blob;
  quality: string;
  seconds: number;
  createdAt: number;
  expiresAt: number;
}

export const KEEP_DAYS = { free: 1, paid: 30 } as const;
const DAY = 86_400_000;

export async function listClips(user: string): Promise<LibraryClip[]> {
  try {
    await purgeExpired();
    const all = (await run<LibraryClip[]>(LIBRARY, 'readonly', (s) => s.index('user').getAll(user))) ?? [];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('Library unavailable', err);
    return [];
  }
}

/** Keeps an exported clip. Makes room by dropping the oldest clips if the browser is short of space. */
export async function addClip(clip: Omit<LibraryClip, 'id' | 'createdAt' | 'expiresAt'>, keepDays: number): Promise<boolean> {
  try {
    await purgeExpired();
    let need = clip.blob.size - (await roomLeft());
    if (need > 0) {
      const oldest = ((await run<LibraryClip[]>(LIBRARY, 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => a.createdAt - b.createdAt);
      for (const old of oldest) {
        if (need <= 0) break;
        await deleteClip(old.id);
        need -= old.blob.size;
      }
      if (need > 0) return false;
    }
    const now = Date.now();
    await run(LIBRARY, 'readwrite', (s) => void s.put({ ...clip, id: crypto.randomUUID(), createdAt: now, expiresAt: now + keepDays * DAY }));
    return true;
  } catch (err) {
    console.warn('Clip not kept in the library', err);
    return false;
  }
}

export async function deleteClip(id: string) {
  await run(LIBRARY, 'readwrite', (s) => void s.delete(id));
}

export async function deleteAll(user: string) {
  const ids = ((await run<IDBValidKey[]>(LIBRARY, 'readonly', (s) => s.index('user').getAllKeys(user))) ?? []) as string[];
  await run(LIBRARY, 'readwrite', (s) => ids.forEach((id) => s.delete(id)));
}

async function purgeExpired() {
  const all = (await run<LibraryClip[]>(LIBRARY, 'readonly', (s) => s.getAll())) ?? [];
  const old = all.filter((c) => c.expiresAt <= Date.now());
  if (old.length) await run(LIBRARY, 'readwrite', (s) => old.forEach((c) => s.delete(c.id)));
}

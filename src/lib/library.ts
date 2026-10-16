// "My clips": exported clips kept in this browser for a while, then deleted automatically. They
// never take space on our servers. Free keeps them 7 days, paid plans 30.
import { LIBRARY, run } from './saved';

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

export const KEEP_DAYS = { free: 7, paid: 30 } as const;
const DAY = 86_400_000;

export async function listClips(user: string): Promise<LibraryClip[]> {
  try {
    await purgeExpired();
    const all = (await run<LibraryClip[]>('readonly', (s) => s.index('user').getAll(user), LIBRARY)) ?? [];
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
    const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    if (quota) {
      let need = usage + clip.blob.size - quota * 0.7;
      if (need > 0) {
        const oldest = ((await run<LibraryClip[]>('readonly', (s) => s.getAll(), LIBRARY)) ?? []).sort((a, b) => a.createdAt - b.createdAt);
        for (const old of oldest) {
          if (need <= 0) break;
          await deleteClip(old.id);
          need -= old.blob.size;
        }
        if (need > 0) return false;
      }
    }
    const now = Date.now();
    await run('readwrite', (s) => void s.put({ ...clip, id: crypto.randomUUID(), createdAt: now, expiresAt: now + keepDays * DAY }), LIBRARY);
    return true;
  } catch (err) {
    console.warn('Clip not kept in the library', err);
    return false;
  }
}

export async function deleteClip(id: string) {
  await run('readwrite', (s) => void s.delete(id), LIBRARY);
}

export async function deleteAll(user: string) {
  const ids = ((await run<IDBValidKey[]>('readonly', (s) => s.index('user').getAllKeys(user), LIBRARY)) ?? []) as string[];
  await run('readwrite', (s) => ids.forEach((id) => s.delete(id)), LIBRARY);
}

async function purgeExpired() {
  const all = (await run<LibraryClip[]>('readonly', (s) => s.getAll(), LIBRARY)) ?? [];
  const old = all.filter((c) => c.expiresAt <= Date.now());
  if (old.length) await run('readwrite', (s) => old.forEach((c) => s.delete(c.id)), LIBRARY);
}

// Saved work ("Episodes" in the Library): each episode's transcript, clips and edits.
// Signed in, it lives on our server (tiny, about 0.1 MB), so it opens on any device; kept 1 day
// after the last change on Free, 30 days on paid plans (enforced by the server). The video itself
// never goes to our server: this browser keeps its own copy for as long, when there's room, so
// reopening usually doesn't need the video chosen again. In demo mode everything stays here.
import type { Clip } from './clips';
import { EPISODES, roomLeft, run, VIDEOS } from './db';
import type { EpisodeInfo } from './format';
import type { Segment } from './speech';
import { supabase } from './supabase';

export interface Project {
  fingerprint: string;
  fileName: string;
  fileSize: number;
  info: EpisodeInfo;
  segments: Segment[];
  clips: Clip[];
  // Being listened to in the cloud and not finished yet.
  listening: boolean;
  touchedAt: number;
  expiresAt: number;
}

export type ProjectSummary = Omit<Project, 'segments' | 'clips'> & { clipCount: number; videoHere: boolean };

const DAY = 86_400_000;
export const KEEP_DAYS = { free: 1, paid: 30 } as const;

interface Row {
  fingerprint: string;
  file_name: string;
  file_size: number;
  info: EpisodeInfo;
  segments?: Segment[];
  clips?: Clip[];
  clip_count?: number;
  listening: boolean;
  touched_at: string;
  expires_at: string;
}

const fromRow = (r: Row): Project => ({
  fingerprint: r.fingerprint,
  fileName: r.file_name,
  fileSize: Number(r.file_size),
  info: r.info,
  segments: r.segments ?? [],
  clips: r.clips ?? [],
  listening: r.listening,
  touchedAt: Date.parse(r.touched_at),
  expiresAt: Date.parse(r.expires_at),
});

const localKey = (user: string, fingerprint: string) => `${user}:${fingerprint}`;

export async function listProjects(user: string): Promise<ProjectSummary[]> {
  let list: (Project & { clipCount: number })[];
  if (supabase) {
    const { data, error } = await supabase.rpc('my_projects');
    if (error) throw error;
    list = (data as Row[]).map((r) => ({ ...fromRow(r), clipCount: r.clip_count ?? 0 }));
  } else {
    const all = ((await run<Project[]>(EPISODES, 'readonly', (s) => s.getAll())) ?? []).filter((p) => p.fingerprint && p.expiresAt > Date.now());
    list = all.map((p) => ({ ...p, clipCount: p.clips.length })).sort((a, b) => b.touchedAt - a.touchedAt);
  }
  const videos = await videoKeys();
  await forgetVideos(user, list.map((p) => p.fingerprint), videos);
  return list.map(({ segments: _s, clips: _c, ...p }) => ({ ...p, videoHere: videos.has(localKey(user, p.fingerprint)) }));
}

export async function getProject(user: string, fingerprint: string): Promise<Project | null> {
  if (supabase) {
    const { data, error } = await supabase.rpc('my_project', { p_fingerprint: fingerprint }).maybeSingle<Row>();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }
  const p = await run<Project>(EPISODES, 'readonly', (s) => s.get(localKey(user, fingerprint)));
  return p && p.expiresAt > Date.now() ? p : null;
}

/**
 * Saves an episode's work. `full` also sends the transcript (once per episode); otherwise only
 * the clips and status, which change with every edit.
 */
export async function saveProject(user: string, p: Omit<Project, 'touchedAt' | 'expiresAt'>, full: boolean, keepDays: number): Promise<void> {
  if (supabase) {
    const row = {
      user_id: user,
      fingerprint: p.fingerprint,
      file_name: p.fileName,
      file_size: p.fileSize,
      info: p.info,
      clips: p.clips,
      listening: p.listening,
      ...(full ? { segments: p.segments } : {}),
    };
    const { error } = full
      ? await supabase.from('projects').upsert(row, { onConflict: 'user_id,fingerprint' })
      : await supabase.from('projects').update(row).eq('user_id', user).eq('fingerprint', p.fingerprint);
    if (error) throw error;
    return;
  }
  const now = Date.now();
  await run(EPISODES, 'readwrite', (s) => void s.put({ ...p, touchedAt: now, expiresAt: now + keepDays * DAY }, localKey(user, p.fingerprint)));
}

export async function deleteProject(user: string, fingerprint: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('projects').delete().eq('user_id', user).eq('fingerprint', fingerprint);
    if (error) throw error;
  } else await run(EPISODES, 'readwrite', (s) => void s.delete(localKey(user, fingerprint)));
  await run(VIDEOS, 'readwrite', (s) => void s.delete(localKey(user, fingerprint))).catch(() => {});
}

// --- The episode's video, kept in this browser only ---

interface StoredVideo {
  file: File;
  savedAt: number;
}

async function videoKeys(): Promise<Set<string>> {
  try {
    return new Set(((await run<IDBValidKey[]>(VIDEOS, 'readonly', (s) => s.getAllKeys())) ?? []) as string[]);
  } catch {
    return new Set();
  }
}

/** Drops this user's videos whose saved episode is gone (deleted, or past its keep time). */
async function forgetVideos(user: string, keep: string[], videos: Set<string>) {
  const wanted = new Set(keep.map((fp) => localKey(user, fp)));
  const old = [...videos].filter((k) => k.startsWith(`${user}:`) && !wanted.has(k));
  if (old.length) await run(VIDEOS, 'readwrite', (s) => old.forEach((k) => s.delete(k))).catch(() => {});
}

export async function getVideo(user: string, fingerprint: string): Promise<File | null> {
  try {
    return (await run<StoredVideo>(VIDEOS, 'readonly', (s) => s.get(localKey(user, fingerprint))))?.file ?? null;
  } catch {
    return null;
  }
}

/**
 * Keeps a copy of the episode's video in this browser, if there's room. Makes room by dropping
 * the copies of the episodes worked on longest ago.
 */
export async function keepVideo(user: string, fingerprint: string, file: File): Promise<boolean> {
  try {
    const key = localKey(user, fingerprint);
    if ((await videoKeys()).has(key)) return true;
    await navigator.storage?.persist?.().catch(() => false);
    let need = file.size - (await roomLeft());
    if (need > 0) {
      const all = ((await run<StoredVideo[]>(VIDEOS, 'readonly', (s) => s.getAll())) ?? []).map((v, i) => ({ v, i }));
      const keys = [...(await videoKeys())];
      const oldest = all.map(({ v, i }) => ({ key: keys[i]!, v })).sort((a, b) => a.v.savedAt - b.v.savedAt);
      for (const o of oldest) {
        if (need <= 0) break;
        await run(VIDEOS, 'readwrite', (s) => void s.delete(o.key));
        need -= o.v.file.size;
      }
      if (need > 0) return false;
    }
    await run(VIDEOS, 'readwrite', (s) => void s.put({ file, savedAt: Date.now() } satisfies StoredVideo, key));
    return true;
  } catch (err) {
    console.warn('Video not kept on this device', err);
    return false;
  }
}

/** Whether `file` is the video of a saved episode, even renamed or copied to another device. */
export function isSameVideo(p: Pick<Project, 'fingerprint' | 'fileSize' | 'info'>, file: File, fingerprint: string, seconds: number): boolean {
  return fingerprint === p.fingerprint || (file.size === p.fileSize && Math.abs(seconds - p.info.durationSeconds) < 1);
}

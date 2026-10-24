import type { CaptionStyleId } from './clips';
import type { PlanId } from './plans';
import { supabase } from './supabase';

/** A show's look for its clips: caption font, colors, style and position, plus its logo. */
export interface BrandKit {
  id: string;
  workspace_id: string;
  name: string;
  font: string;
  style: Exclude<CaptionStyleId, 'none'>;
  text_color: string;
  // The highlighted word (Highlight style) or the box (Boxed style).
  accent_color: string;
  // Top of the captions, as a fraction of the video's height.
  position: number;
  // A small image as a data URL, or null.
  logo: string | null;
  logo_corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export type NewBrandKit = Omit<BrandKit, 'id' | 'workspace_id'>;

export const KIT_LIMITS: Record<PlanId, number> = { free: 0, pro: 1, studio: 5 };

// Free Google Fonts that read well as bold captions. `weight` is the boldest the font has.
export const FONTS: { name: string; weight: number }[] = [
  { name: 'Inter', weight: 900 },
  { name: 'Montserrat', weight: 900 },
  { name: 'Poppins', weight: 800 },
  { name: 'Bebas Neue', weight: 400 },
  { name: 'Anton', weight: 400 },
  { name: 'Oswald', weight: 700 },
  { name: 'Archivo Black', weight: 400 },
  { name: 'Permanent Marker', weight: 400 },
];

export const fontWeight = (name: string) => FONTS.find((f) => f.name === name)?.weight ?? 900;

const loaded = new Map<string, Promise<void>>();

/** Loads a caption font from Google Fonts once, so both the preview and the canvas can use it. */
export function ensureFont(name: string): Promise<void> {
  const font = FONTS.find((f) => f.name === name);
  if (!font || name === 'Inter') return Promise.resolve();
  let p = loaded.get(name);
  if (!p) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // crossorigin: the app is cross-origin isolated, which requires CORS for stylesheets.
    link.crossOrigin = 'anonymous';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@${font.weight}&display=swap`;
    p = new Promise<void>((resolve) => {
      link.onload = () => void document.fonts.load(`${font.weight} 40px "${name}"`).then(() => resolve(), () => resolve());
      // Fall back to the default font rather than block an export.
      link.onerror = () => resolve();
    });
    document.head.appendChild(link);
    loaded.set(name, p);
  }
  return p;
}

export const DEFAULT_KIT: NewBrandKit = {
  name: 'My show',
  font: 'Montserrat',
  style: 'highlight',
  text_color: '#ffffff',
  accent_color: '#ffd400',
  position: 0.66,
  logo: null,
  logo_corner: 'top-right',
};

// Demo mode keeps kits in this browser.
const DEMO_KEY = 'hookcut_demo_kits';
function readDemo(): BrandKit[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]') as BrandKit[];
  } catch {
    return [];
  }
}
function writeDemo(kits: BrandKit[]) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(kits));
  } catch {
    throw new Error('Your browser blocked saving. Try a smaller logo.');
  }
}

export async function listKits(workspaceId: string): Promise<BrandKit[]> {
  if (!supabase) return readDemo().filter((k) => k.workspace_id === workspaceId);
  const { data, error } = await supabase.from('brand_kits').select('*').eq('workspace_id', workspaceId).order('created_at');
  if (error) throw new Error('We couldn’t load your brand kits.');
  return data as BrandKit[];
}

/** Creates a kit (no id) or saves changes to one. The database enforces the plan's kit limit. */
export async function saveKit(workspaceId: string, plan: PlanId, kit: NewBrandKit & { id?: string }): Promise<BrandKit> {
  const fields = { ...kit, text_color: kit.text_color.toLowerCase(), accent_color: kit.accent_color.toLowerCase() };
  if (!supabase) {
    const kits = readDemo();
    if (kit.id) {
      const updated = { ...(kits.find((k) => k.id === kit.id) as BrandKit), ...fields };
      writeDemo(kits.map((k) => (k.id === kit.id ? updated : k)));
      return updated;
    }
    if (kits.filter((k) => k.workspace_id === workspaceId).length >= KIT_LIMITS[plan]) throw new Error(limitMessage(plan));
    const created = { ...fields, id: crypto.randomUUID(), workspace_id: workspaceId };
    writeDemo([...kits, created]);
    return created;
  }
  const { id, ...rest } = fields;
  const query = id
    ? supabase.from('brand_kits').update(rest).eq('id', id)
    : supabase.from('brand_kits').insert({ ...rest, workspace_id: workspaceId });
  const { data, error } = await query.select().single();
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'We couldn’t save this brand kit. Please try again.');
  return data as BrandKit;
}

export async function deleteKit(id: string): Promise<void> {
  if (!supabase) return writeDemo(readDemo().filter((k) => k.id !== id));
  const { error } = await supabase.from('brand_kits').delete().eq('id', id);
  if (error) throw new Error('We couldn’t delete this brand kit.');
}

function limitMessage(plan: PlanId) {
  return plan === 'free'
    ? 'Brand kits are part of Pro and Studio.'
    : plan === 'pro'
      ? 'Pro includes 1 brand kit. Studio has up to 5, one per show.'
      : 'Studio includes up to 5 brand kits.';
}

/** Shrinks an uploaded logo to at most 400 px, keeping transparency, small enough to store with the kit. */
export async function prepareLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG with a transparent background works best).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('We couldn’t read this image.');
  }
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let url = canvas.toDataURL('image/png');
  if (url.length > 280_000) url = canvas.toDataURL('image/webp', 0.85);
  if (url.length > 280_000) throw new Error('This logo is too detailed. Try a simpler or smaller image.');
  return url;
}

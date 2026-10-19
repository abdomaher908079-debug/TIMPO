// Where people heard about Isla: the link they first arrived from (?ref=tiktok, or utm_source=…), kept in this
// browser until they sign up, and their own answer to "How did you hear about Isla?" (components/SourceQuestion).
// Both go to signup_sources; the owner page counts them.
const KEY = 'isla_ref';

/** Keeps the first ?ref= / utm_source= this browser arrived with. */
export function captureRef() {
  const params = new URLSearchParams(window.location.search);
  const ref = (params.get('ref') ?? params.get('utm_source') ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  if (!ref) return;
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, ref);
  } catch {
    // Private mode: we just won't know.
  }
}

export function storedRef(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const SOURCES: [string, string][] = [
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['reddit', 'Reddit'],
  ['product_hunt', 'Product Hunt'],
  ['google', 'Google search'],
  ['friend', 'A friend'],
  ['creator', 'A creator or podcaster'],
  ['other', 'Other'],
];

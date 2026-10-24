import { useEffect } from 'react';

type Sentinel = { release(): Promise<void> };

/**
 * Keeps the screen on while `active`, so the phone doesn't lock itself (which pauses the page)
 * during long work. Taken again when the page comes back into view.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
    if (!active || !wakeLock) return;
    let sentinel: Sentinel | null = null;
    let live = true;
    const take = () => {
      if (document.visibilityState !== 'visible') return;
      wakeLock
        .request('screen')
        .then((s) => (live ? (sentinel = s) : void s.release()))
        .catch(() => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', take);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

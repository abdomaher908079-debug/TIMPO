// Phones have fewer fast cores and must keep some free for the screen, so heavy work holds back there.
// Works on the page and in workers (workers can't see the screen, so the speech worker is also told by the page).
export const isPhone: boolean = (() => {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return true;
  // "Desktop site" mode on a phone or tablet says it's a computer, so look at the device itself. Workers can't.
  if (typeof matchMedia !== 'function' || !(nav.maxTouchPoints > 0)) return false;
  // iPads say they're Macs, but Macs have no touch screen.
  if (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1) return true;
  // A touch screen with no mouse. (Touch-screen laptops have a mouse or touchpad, so they stay computers.)
  if (matchMedia('(pointer: coarse) and (hover: none)').matches) return true;
  // A phone-sized touch screen: no computer screen is this small.
  if (Math.min(screen.width, screen.height) < 600) return true;
  // A phone's graphics chip, which desktop mode doesn't hide.
  return /Adreno|Mali|PowerVR|Immortalis|Xclipse/i.test(graphicsChip());
})();

/** The graphics chip's name, as WebGL tells it ("" if it won't). */
function graphicsChip(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

interface GpuAdapter {
  features: { has(name: string): boolean };
  info?: { vendor?: string };
}

/**
 * The graphics chip for speech recognition, or null: none, or a phone's (Qualcomm, ARM, Imagination, Samsung),
 * whose heavy work can hang the phone. Works on the page and in workers.
 */
export async function speechGpu(): Promise<GpuAdapter | null> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
    const adapter = (await gpu?.requestAdapter()) ?? null;
    return adapter && /qualcomm|^arm$|imagination|img-tec|samsung/i.test(adapter.info?.vendor ?? '') ? null : adapter;
  } catch {
    return null;
  }
}

/** Lets the browser handle taps and draw the screen before heavy work continues. */
export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

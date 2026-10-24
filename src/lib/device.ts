// Phones have fewer fast cores and must keep some free for the screen, so heavy work holds back there.
// Works on the page and in workers (workers can't see the screen, so the speech worker is also told by the page).
export const isPhone: boolean = (() => {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return true;
  // "Desktop site" mode on a phone or tablet says it's a computer; a touch screen with no mouse still gives it away.
  // Touch-screen laptops have a mouse or touchpad, so they stay computers.
  return typeof matchMedia === 'function' && nav.maxTouchPoints > 0 && matchMedia('(pointer: coarse) and (hover: none)').matches;
})();

/** Lets the browser handle taps and draw the screen before heavy work continues. */
export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

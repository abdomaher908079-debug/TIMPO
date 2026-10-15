// Phones have fewer fast cores and must keep some free for the screen, so heavy work holds back there.
// Works on the page and in workers.
export const isPhone: boolean = (() => {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
})();

/** Lets the browser handle taps and draw the screen before heavy work continues. */
export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

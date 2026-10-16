export const BRAND = { first: 'Hook', second: 'cut' } as const;
export const BRAND_NAME = `${BRAND.first}${BRAND.second}`;

// The logo mark: audio-meter bars (heights as a fraction of the tallest) with the peak in orange,
// the moment Hookcut cuts out. Shared by the header, the favicon and the video watermark.
export const LOGO_BARS = [0.42, 0.68, 1, 0.56, 0.32];
export const LOGO_PEAK = 2;
export const LOGO_GREEN = '#9dff3c';
export const LOGO_ORANGE = '#ff6a13';

// Shown on the legal pages and footer. Set these before launch (see LAUNCH.md).
export const LEGAL = {
  // The person or company that runs Hookcut.
  owner: (import.meta.env.VITE_LEGAL_NAME as string | undefined) || BRAND_NAME,
  email: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'hookcutofficial@gmail.com',
  updated: 'October 15, 2026',
};

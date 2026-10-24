export const BRAND_NAME = 'Isla';

// Isla's colors: the orb (components/IslaOrb.tsx), the favicon and the video watermark (lib/draw.ts).
export const ORB = { green: '#9dff3c', yellow: '#e0b51e', orange: '#ff6a13', visor: '#10151b' } as const;

// Shown on the legal pages and footer. Set these before launch (see LAUNCH.md).
export const LEGAL = {
  // The person or company that runs Isla.
  owner: (import.meta.env.VITE_LEGAL_NAME as string | undefined) || 'Abdullah Mohamed Maher Hassan Elewa',
  email: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'support@islaclips.com',
  // The founder's name as shown on the site (About page, footer); the legal pages use `owner`.
  founder: 'Abdullah Elewa',
  updated: 'October 19, 2026',
};

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Each public page's title and description for search engines and link previews; app pages (signed in)
// are kept out of search results. index.html holds the home page's version for crawlers that don't run JS.
const SITE = 'https://islaclips.com';
const HOME = {
  title: 'Isla: AI podcast clips for TikTok, Reels and Shorts',
  description:
    'Isla finds the best moments in your podcast episode and turns them into vertical clips with captions for TikTok, Reels and Shorts. Free to start; your video stays on your device.',
};

const PAGES: Record<string, { title: string; description: string }> = {
  '/': HOME,
  '/pricing': {
    title: 'Pricing · Isla podcast clips',
    description: 'Start free. Pro and Studio add our best AI, every clip, no watermark and your own brand kit.',
  },
  '/signup': { title: 'Sign up · Isla', description: 'Create your free Isla account and turn your next podcast episode into clips.' },
  '/login': { title: 'Log in · Isla', description: 'Log in to Isla.' },
  '/privacy': { title: 'Privacy · Isla', description: 'What happens to your data on Isla, in plain words.' },
  '/terms': { title: 'Terms of service · Isla', description: 'The terms for using Isla.' },
  '/refunds': { title: 'Refund policy · Isla', description: "Isla's 14-day refund policy." },
  '/status': { title: 'Status · Isla', description: "Is Isla working right now? Live checks of Isla's sign-in, database and AI." },
};

function meta(selector: string, create: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create());
}

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  meta(`meta[${attr}="${name}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, name);
    return m;
  }).setAttribute('content', content);
}

/** Keeps the page's title, description, canonical address and robots rule in step with the route. */
export function usePageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = PAGES[pathname];
    const { title, description } = page ?? HOME;
    document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:url', `${SITE}${page ? pathname : '/'}`, 'property');
    // Signed-in app pages and one-off pages stay out of search results.
    setMeta('robots', page ? 'index, follow' : 'noindex, follow');
    const link = meta('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.rel = 'canonical';
      return l;
    }) as HTMLLinkElement;
    link.href = `${SITE}${page ? pathname : '/'}`;
  }, [pathname]);
}

export type PlanId = 'free' | 'pro' | 'studio';

export interface Plan {
  id: PlanId;
  name: string;
  monthly: number;
  yearlyPerMonth: number;
  // Episode hours allowed per period; the free plan resets weekly, paid plans monthly.
  hours: number;
  period: 'week' | 'month';
  // Longest single episode allowed, or null for any length.
  maxEpisodeHours: number | null;
  clipsFound: number;
  clipsExportable: number;
  features: string[];
}

// Keep in sync with PLAN.md.
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearlyPerMonth: 0,
    hours: 1,
    period: 'week',
    maxEpisodeHours: 1,
    clipsFound: 10,
    clipsExportable: 3,
    features: [
      '1 hour of episodes every week',
      'Episodes up to 1 hour long',
      'See all 10 best clips, export 3',
      'Full editor, 1080p export',
      'Small "Made with PeakClip" watermark',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 15,
    yearlyPerMonth: 12,
    hours: 10,
    period: 'month',
    maxEpisodeHours: null,
    clipsFound: 20,
    clipsExportable: 20,
    features: [
      '10 hours of episodes per month',
      'Episodes of any length',
      'Export all clips, up to 20 per episode',
      'No watermark, up to 4K export',
      'All caption styles + your brand',
      'Priority cloud processing (3 h)',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    monthly: 29,
    yearlyPerMonth: 24,
    hours: 20,
    period: 'month',
    maxEpisodeHours: null,
    clipsFound: 30,
    clipsExportable: 30,
    features: [
      '20 hours of episodes per month',
      'Episodes of any length',
      'Export all clips, up to 30 per episode',
      'No watermark, up to 4K export',
      'Brand styles for several shows',
      'Priority cloud processing (10 h)',
      'Up to 3 team members',
    ],
  },
];

export type PlanId = 'free' | 'pro' | 'studio';

export interface Plan {
  id: PlanId;
  name: string;
  monthly: number;
  yearlyPerMonth: number;
  hoursPerMonth: number;
  clipsPerEpisode: number;
  features: string[];
}

// Keep in sync with PLAN.md.
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearlyPerMonth: 0,
    hoursPerMonth: 1,
    clipsPerEpisode: 10,
    features: [
      '1 hour of episodes per month',
      'Up to 10 clips per episode',
      'Full editor, 1080p export',
      '3 caption styles',
      'Small "Made with PeakClip" watermark',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 15,
    yearlyPerMonth: 12,
    hoursPerMonth: 10,
    clipsPerEpisode: 20,
    features: [
      '10 hours of episodes per month',
      'Up to 20 clips per episode',
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
    hoursPerMonth: 20,
    clipsPerEpisode: 30,
    features: [
      '20 hours of episodes per month',
      'Up to 30 clips per episode',
      'No watermark, up to 4K export',
      'Brand styles for several shows',
      'Priority cloud processing (10 h)',
      'Up to 3 team members',
    ],
  },
];

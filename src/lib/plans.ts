import { LIMITS, type PlanId, type PlanLimits } from '../../supabase/functions/_shared/plans';

export type { PlanId };
export { LIMITS };

export interface Plan extends PlanLimits {
  name: string;
  monthly: number;
  yearlyPerMonth: number;
  features: string[];
}

// Keep in sync with PLAN.md.
export const PLANS: Plan[] = [
  {
    ...LIMITS.free,
    name: 'Free',
    monthly: 0,
    yearlyPerMonth: 0,
    features: [
      '1 episode every week (4 a month)',
      'Episodes up to 30 minutes long',
      'Quick AI: good clips, fast',
      'See all 10 best clips, export 3',
      'Full editor, 1080p export',
      'Cloud processing for slow devices: 1 a week',
      'Small "Made with Hookcut" watermark',
    ],
  },
  {
    ...LIMITS.pro,
    name: 'Pro',
    monthly: 15,
    yearlyPerMonth: 12,
    features: [
      '20 hours of episodes per month',
      'Episodes of any length',
      'Best AI: sharpest transcripts and smartest picks',
      'Export all clips, up to 20 per episode',
      'No watermark, up to 4K export',
      'Your brand kit: your font, colors and logo',
      'Priority cloud processing (3 h)',
    ],
  },
  {
    ...LIMITS.studio,
    name: 'Studio',
    monthly: 29,
    yearlyPerMonth: 24,
    features: [
      '60 hours of episodes per month',
      'Episodes of any length',
      'Best AI: sharpest transcripts and smartest picks',
      'Export all clips, up to 30 per episode',
      'No watermark, up to 4K export',
      '5 brand kits, one for each show',
      'Priority cloud processing (10 h)',
      'Team of 3: invite 2 people to share it',
    ],
  },
];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

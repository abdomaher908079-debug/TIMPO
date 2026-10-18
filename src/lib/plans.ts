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
      'Full editor, 1080p export, auto framing',
      'Cloud listening for phones and slow devices: 1 a week',
      'Small "Made with Isla" watermark',
    ],
  },
  {
    ...LIMITS.pro,
    name: 'Pro',
    monthly: 15,
    yearlyPerMonth: 12,
    features: [
      '20 hours of episodes per month (up to 40 episodes)',
      'Episodes of any length',
      'Best AI: sharpest transcripts and smartest picks',
      'Pro edit: AI headline, zoom-ins, highlighted words, follows the speaker',
      'Export all clips, up to 20 per episode',
      'No watermark, up to 4K export',
      'Your brand kit: your font, colors and logo',
      'Cloud listening (3 h)',
    ],
  },
  {
    ...LIMITS.studio,
    name: 'Studio',
    monthly: 29,
    yearlyPerMonth: 24,
    features: [
      '40 hours of episodes per month (up to 100 episodes)',
      'Episodes of any length',
      'Best AI: sharpest transcripts and smartest picks',
      'Pro edit: AI headline, zoom-ins, highlighted words, follows the speaker',
      'Export all clips, up to 30 per episode',
      'No watermark, up to 4K export',
      '5 brand kits, one for each show',
      'Cloud listening (10 h)',
      'Team of 3 included; add people for $8 a month each',
    ],
  },
];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

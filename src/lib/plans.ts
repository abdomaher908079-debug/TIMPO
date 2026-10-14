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
      'See all 10 best clips, export 3',
      'Full editor, 1080p export',
      'Small "Made with Hookcut" watermark',
    ],
  },
  {
    ...LIMITS.pro,
    name: 'Pro',
    monthly: 15,
    yearlyPerMonth: 12,
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
    ...LIMITS.studio,
    name: 'Studio',
    monthly: 29,
    yearlyPerMonth: 24,
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

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

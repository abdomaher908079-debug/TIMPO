import { paymentsOpen } from '../lib/billing';
import { Link } from 'react-router-dom';
import Pricing from '../components/Pricing';
import { useAuth } from '../lib/auth';
import { LIMITS, PACK, PICKS_PER_EPISODE } from '../../supabase/functions/_shared/plans';

// The plans on their own page, with the questions people ask before paying.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'What counts as an episode?',
    a: `Each video you turn into clips. It counts once a month, however many times you open it. If you'd like new picks, the AI can pick the same episode again up to ${PICKS_PER_EPISODE - 1} more times that month for free.`,
  },
  {
    q: 'Why do plans count hours and episodes?',
    a: `Hours keep long episodes fair; the episode count keeps lots of tiny files fair, since our AI does the same work for a 5-minute file as for a 2-hour one. Pro's ${LIMITS.pro.episodesPerPeriod} and Studio's ${LIMITS.studio.episodesPerPeriod} episodes a month are far more than a weekly or even daily show needs.`,
  },
  {
    q: 'What if I run out before the month ends?',
    a: `Get +${PACK.hours} hours and +${PACK.episodes} episodes for $${PACK.price}, one time, from Plan & settings. They're used only after your monthly hours or episodes run out, and last ${PACK.days} days.`,
  },
  {
    q: 'When do my hours reset?',
    a: 'Every month, on the day your plan started. Yearly plans get their hours every month too. Unused hours don’t carry over.',
  },
  {
    q: 'How do I pay? Does it renew?',
    a: 'You pay upfront for a month or a year, with crypto (USDT, BTC, ETH and more), through our payment partner NOWPayments. Plans don’t renew on their own, so there’s nothing to cancel: we email you before yours ends, and you can add more time whenever you like.',
  },
  {
    q: 'Can I switch plans?',
    a: 'Yes. Buying more of your plan adds the time to the end of it. Buying the other plan starts it as soon as your payment arrives, and the days left on your old plan are added to it, valued at the two plans’ prices.',
  },
  {
    q: 'Is there a refund?',
    a: 'Yes: a full refund within 14 days of your first payment, no questions asked, sent in USDT to a wallet you choose. See our refund policy for the details.',
  },
  {
    q: 'Is my video uploaded?',
    a: 'No. Your video stays on your computer; Isla listens and makes the clips right in your browser. Only the transcript text goes to our AI. On phones, only the audio is sent, a few minutes at a time, and deleted right after.',
  },
  {
    q: 'Where are paid plans available?',
    a: 'Everywhere we can take payments except the Russian Federation, where paid subscriptions are unavailable. The Free plan works everywhere.',
  },
];

export default function PricingPage() {
  const { user } = useAuth();
  return (
    <main className="pricing-page">
      <section className="hero pricing-hero">
        <p className="eyebrow">Plans</p>
        <h1 className="hero-title">Start free. Upgrade when your show grows.</h1>
        <p className="hero-sub">
          Every plan has the full editor and auto framing. Pro and Studio add our best AI, every clip, no watermark and your own
          look.
        </p>
        {!paymentsOpen && <p className="notice">Pro and Studio are coming soon. The Free plan is open now; tap Notify me and we'll email you when they open.</p>}
      </section>

      <Pricing />

      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="section-heading">Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="faq-item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      {!user && (
        <section className="final-cta">
          <h2 className="section-heading">Try it on your next episode.</h2>
          <Link to="/signup" className="btn btn-primary">
            Start free
          </Link>
        </section>
      )}
    </main>
  );
}

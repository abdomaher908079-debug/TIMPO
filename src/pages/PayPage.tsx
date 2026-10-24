import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { checkoutPath, openOtherCoins, paymentsReady, paymentStatus, startPayment, type PayOrder, type Purchase } from '../lib/billing';
import { NOT_SOLD_HERE, useCanPay } from '../lib/country';
import { planById } from '../lib/plans';
import { CRYPTO_MIN_USD, MAX_EXTRA_SEATS, PACK, PRICE_USD, SEAT_USD, seatsForRest, TEAM_INCLUDED } from '../../supabase/functions/_shared/plans';
import type { ProfileRow } from '../../supabase/functions/_shared/plans';

// Our checkout: one small step per screen, so paying with crypto feels as simple as it can.
//   1 Your order → 2 How to pay → 3 Before you send (a short guide) → 4 Send → 5 Done
// plus a separate "New to crypto?" guide. The payment itself is NOWPayments' (supabase/functions/create-invoice);
// /pay?order=… opens an order again at the right step, so the page can be left and come back to.

interface Coin {
  id: string;
  name: string;
  network: string;
  networkShort: string;
  note: string;
  minutes: string;
  // For the QR code: what wallet apps understand.
  uri: (address: string, amount: number) => string;
}

const COINS: Coin[] = [
  {
    id: 'usdttrc20',
    name: 'USDT',
    network: 'Tron (TRC20)',
    networkShort: 'TRC20',
    note: 'Recommended: lowest fees. In Binance, Bybit, OKX and Trust Wallet.',
    minutes: 'usually 1–5 minutes',
    uri: (address) => address,
  },
  {
    id: 'usdtbsc',
    name: 'USDT',
    network: 'BNB Smart Chain (BEP20)',
    networkShort: 'BEP20',
    note: 'Low fees. Common in Binance and Trust Wallet.',
    minutes: 'usually 1–5 minutes',
    uri: (address) => address,
  },
  {
    id: 'btc',
    name: 'Bitcoin',
    network: 'Bitcoin',
    networkShort: 'BTC',
    note: 'Higher fees and slower.',
    minutes: 'usually 10–60 minutes',
    uri: (address, amount) => `bitcoin:${address}?amount=${amount}`,
  },
];

const coinById = (id: string | null) => COINS.find((c) => c.id === id) ?? null;

type Step = 'order' | 'coin' | 'learn' | 'ready' | 'send' | 'wait' | 'done' | 'problem';
// The numbered steps, for the progress bar; 'learn' and 'problem' sit outside them.
const NUMBERED: Step[] = ['order', 'coin', 'ready', 'send', 'wait'];
// NOWPayments statuses that need the buyer (or us) to do something.
const FAILED = ['failed', 'refunded', 'expired', 'partially_paid'];

/** What's being bought, from the address: ?plan=pro&billing=monthly or ?pack=1. */
function purchaseFrom(params: URLSearchParams): Purchase | null {
  if (params.get('pack') === '1') return { kind: 'pack' };
  const add = Number(params.get('seats'));
  if (!params.get('plan') && add >= 1 && add <= MAX_EXTRA_SEATS) return { kind: 'seats', seats: Math.round(add) };
  const plan = params.get('plan');
  const billing = params.get('billing');
  if ((plan === 'pro' || plan === 'studio') && (billing === 'monthly' || billing === 'yearly')) {
    return { kind: 'plan', plan, billing, seats: plan === 'studio' && add >= 0 && add <= MAX_EXTRA_SEATS ? Math.round(add) || 0 : 0 };
  }
  return null;
}

/** A running Studio plan, if there is one: its team and the plan's end, for pricing seats. */
function runningStudio(profile: ProfileRow | null): { seats: number; billing: ProfileRow['billing']; end: Date } | null {
  if (!profile || profile.plan !== 'studio' || profile.subscription_status !== 'active' || !profile.current_period_end) return null;
  const end = new Date(profile.current_period_end);
  return end > new Date() ? { seats: profile.extra_seats ?? 0, billing: profile.billing, end } : null;
}

/** $29, or $13.47 when there are cents. */
const money = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// full: what the same time costs paid month by month, shown crossed out next to a yearly price.
function describe(p: Purchase, profile: ProfileRow | null): { title: string; price: number; full?: number; lines: string[] } {
  const studio = runningStudio(profile);
  if (p.kind === 'seats') {
    const people = `${p.seats} more ${p.seats === 1 ? 'person' : 'people'}`;
    return {
      title: `Studio team: ${people}`,
      price: studio ? seatsForRest(p.seats, studio.billing, studio.end) : 0,
      lines: [
        studio ? `Your team grows to ${TEAM_INCLUDED + studio.seats + p.seats} people` : 'For a running Studio plan',
        studio ? `Paid only for the days left, until ${DAY_FORMAT.format(studio.end)}` : '',
        'They share your plan’s hours and brand kits',
      ].filter(Boolean),
    };
  }
  if (p.kind === 'pack') {
    return {
      title: `Extra hours: +${PACK.hours} hours and +${PACK.episodes} episodes`,
      price: PACK.price,
      lines: [`Usable for ${PACK.days} days`, 'Used after your plan’s own hours or episodes run out', 'Paid once'],
    };
  }
  const plan = planById(p.plan);
  // Adding time to a running Studio keeps its team (and pays for it); a new Studio uses the chosen size.
  const seats = p.plan === 'studio' ? (studio ? studio.seats : (p.seats ?? 0)) : 0;
  return {
    title: `Isla ${plan.name}, 1 ${p.billing === 'yearly' ? 'year' : 'month'}`,
    price: PRICE_USD[p.plan][p.billing] + seats * SEAT_USD[p.billing],
    full: p.billing === 'yearly' ? (PRICE_USD[p.plan].monthly + seats * SEAT_USD.monthly) * 12 : undefined,
    lines: [
      plan.features[0]!,
      plan.features[2]!,
      plan.features[5]!,
      ...(p.plan === 'studio' ? [`A team of ${TEAM_INCLUDED + seats} people`] : []),
      'Paid once: it doesn’t renew on its own',
    ],
  };
}

// Which orders this browser said it has paid, so coming back opens "Waiting", not the address again.
const SENT_KEY = 'isla_pay_sent';
function sentBefore(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}
function remember(id: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]).filter((x) => x !== id).slice(-9);
    localStorage.setItem(SENT_KEY, JSON.stringify([...list, id]));
  } catch {
    // Private mode: they'll just see the address again.
  }
}

const orderPurchase = (o: PayOrder): Purchase =>
  o.kind === 'pack' ? { kind: 'pack' } : o.kind === 'seats' ? { kind: 'seats', seats: o.seats } : { kind: 'plan', plan: o.plan!, billing: o.billing!, seats: o.seats };

/** The step an order belongs on, from its status. */
function stepFor(o: PayOrder): Step {
  if (o.applied) return 'done';
  if (FAILED.includes(o.status)) return 'problem';
  if (o.status === 'waiting' && o.address && !sentBefore(o.id)) return 'send';
  return 'wait';
}

export default function PayPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { demo } = useAuth();
  const account = useAccount();
  const canPay = useCanPay();
  const orderId = params.get('order');
  const [purchase, setPurchase] = useState<Purchase | null>(() => purchaseFrom(params));
  const [step, setStep] = useState<Step>(orderId ? 'wait' : 'order');
  const [coin, setCoin] = useState<Coin | null>(null);
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!orderId);

  // Opened with ?order=…: pick up where it was left.
  useEffect(() => {
    if (!orderId || order) return;
    paymentStatus(orderId)
      .then((o) => {
        setOrder(o);
        setPurchase(orderPurchase(o));
        setCoin(coinById(o.coin));
        setStep(stepFor(o));
      })
      .catch((e: Error) => {
        setError(e.message);
        setStep('problem');
      })
      .finally(() => setLoading(false));
  }, [orderId, order]);

  const orderKey = order?.id ?? null;
  const refreshAccount = account.refresh;
  const refreshOrder = useCallback(async () => {
    if (!orderKey) return;
    const o = await paymentStatus(orderKey);
    setOrder(o);
    if (o.applied) {
      void refreshAccount();
      setStep('done');
    } else if (FAILED.includes(o.status)) setStep('problem');
  }, [orderKey, refreshAccount]);

  // While waiting: ask every 10 seconds for 5 minutes, then every 30. Keyed on the order's id (not the order
  // object, which every answer replaces), so the timer isn't restarted by its own answers.
  useEffect(() => {
    if (step !== 'wait' || !orderKey) return;
    const started = Date.now();
    let timer = 0;
    let live = true;
    const tick = async () => {
      await refreshOrder().catch(() => undefined);
      if (live) timer = window.setTimeout(() => void tick(), Date.now() - started < 5 * 60_000 ? 10_000 : 30_000);
    };
    timer = window.setTimeout(() => void tick(), 5000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [step, orderKey, refreshOrder]);

  if (demo || !paymentsReady) {
    return (
      <Shell>
        <h1 className="page-title">Payments aren't open here</h1>
        <p className="muted">Paid plans can be bought on islaclips.com with a real account.</p>
        <Link className="btn btn-outline" to="/pricing">Back to plans</Link>
      </Shell>
    );
  }
  if (canPay === false) {
    return (
      <Shell>
        <h1 className="page-title">Not available here</h1>
        <p>{NOT_SOLD_HERE}</p>
        <p className="muted">The Free plan stays open for you.</p>
        <Link className="btn btn-outline" to="/">Back to Isla</Link>
      </Shell>
    );
  }
  if (loading) return <Shell><p className="loading">Loading your payment…</p></Shell>;
  // An order that couldn't be opened (not yours, or the server refused): say why.
  if (step === 'problem' && !order) {
    return (
      <Shell>
        <h1 className="page-title">We couldn't open this payment</h1>
        <p>{error ?? 'Something went wrong.'}</p>
        <Link className="btn btn-primary" to="/pricing">Back to plans</Link>
      </Shell>
    );
  }
  if (!purchase) {
    return (
      <Shell>
        <h1 className="page-title">Choose a plan first</h1>
        <Link className="btn btn-primary" to="/pricing">See plans</Link>
      </Shell>
    );
  }

  const item = describe(purchase, account.profile);
  const current = account.plan.id;
  const studio = runningStudio(account.profile);
  // A new Studio chooses its team size here; a running one keeps its team (more people are added on their own).
  const chooseTeam = purchase.kind === 'plan' && purchase.plan === 'studio' && !studio;
  const teamSeats = purchase.kind === 'plan' ? (purchase.seats ?? 0) : 0;
  // Adding people needs a running Studio, and enough days left to reach the crypto minimum.
  const seatsProblem =
    purchase.kind !== 'seats'
      ? null
      : !studio
        ? 'Extra people are for a running Studio plan.'
        : studio.seats + purchase.seats > MAX_EXTRA_SEATS
          ? `A Studio team can have up to ${TEAM_INCLUDED + MAX_EXTRA_SEATS} people.`
          : item.price < CRYPTO_MIN_USD
            ? `That's $${item.price.toFixed(2)}, below the $${CRYPTO_MIN_USD} minimum for crypto payments. Add more people at once, or choose your team size when you renew.`
            : null;
  const setTeam = (seats: number) => {
    if (purchase.kind !== 'plan') return;
    const next = { ...purchase, seats };
    setPurchase(next);
    const path = checkoutPath(next);
    setParams(new URLSearchParams(path.slice(path.indexOf('?') + 1)), { replace: true });
  };
  const switching = purchase.kind === 'plan' && current !== 'free' && current !== purchase.plan;
  const adding = purchase.kind === 'plan' && current === purchase.plan;

  async function begin() {
    if (!coin || !purchase) return;
    setBusy(true);
    setError(null);
    try {
      const o = await startPayment(purchase, coin.id);
      setOrder(o);
      // The order's own address, so leaving and coming back opens it again.
      setParams({ order: o.id }, { replace: true });
      setStep('send');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function otherCoins() {
    if (!purchase) return;
    setBusy(true);
    setError(null);
    openOtherCoins(purchase).catch((e: Error) => {
      setError(e.message);
      setBusy(false);
    });
  }

  function startOver() {
    setOrder(null);
    setError(null);
    if (purchase) {
      const path = checkoutPath(purchase);
      setParams(new URLSearchParams(path.slice(path.indexOf('?') + 1)), { replace: true });
    }
    setStep('coin');
  }

  return (
    <Shell step={step}>
      {step === 'order' && (
        <>
          <h1 className="page-title">Your order</h1>
          <div className="card pay-summary">
            <p className="pay-item">{item.title}</p>
            <p className="pay-price">
              {item.full && item.full > item.price && <s className="pay-full">{money(item.full)}</s>} {money(item.price)}
            </p>
            <ul className="pay-lines">
              {item.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          {chooseTeam && (
            <div className="card pay-team">
              <p className="pay-item">How many people in your team?</p>
              <p className="muted small">
                {TEAM_INCLUDED} included (you and 2 others). Each extra person is{' '}
                {purchase.kind === 'plan' && purchase.billing === 'yearly' ? (
                  <>
                    <s>${SEAT_USD.monthly * 12}</s> ${SEAT_USD.yearly} a year
                  </>
                ) : (
                  `$${SEAT_USD.monthly} a month`
                )}
                .
              </p>
              <div className="pay-stepper">
                <button type="button" className="btn btn-outline" aria-label="Fewer people" disabled={teamSeats <= 0} onClick={() => setTeam(teamSeats - 1)}>
                  −
                </button>
                <span>
                  <b>{TEAM_INCLUDED + teamSeats}</b> people
                </span>
                <button type="button" className="btn btn-outline" aria-label="More people" disabled={teamSeats >= MAX_EXTRA_SEATS} onClick={() => setTeam(teamSeats + 1)}>
                  +
                </button>
              </div>
            </div>
          )}
          {adding && <p className="notice">You already have {account.plan.name}. This adds the time to the end of your current plan.</p>}
          {seatsProblem && <p className="notice notice-error">{seatsProblem}</p>}
          {switching && (
            <p className="notice">
              You're on {account.plan.name} now. {planById(purchase.kind === 'plan' ? purchase.plan : 'pro').name} starts as soon as your
              payment arrives
              {account.profile?.paid_with
                ? `, and the paid days left on ${account.plan.name} are added to it.`
                : `. Your ${account.plan.name} was a gift from us, so its days left end then and aren't carried over.`}
            </p>
          )}
          <p className="muted small">
            You'll pay with crypto, step by step. It takes about 5 minutes. By paying you agree to our{' '}
            <Link to="/terms">terms</Link> and <Link to="/refunds">refund policy</Link>.
          </p>
          <button type="button" className="btn btn-primary pay-next" disabled={!!seatsProblem} onClick={() => setStep('coin')}>
            Continue
          </button>
          <BackLink onClick={() => (purchase.kind === 'plan' ? navigate('/pricing') : navigate('/account'))} />
        </>
      )}

      {step === 'coin' && (
        <>
          <h1 className="page-title">How will you pay?</h1>
          <p className="muted">Choose the coin you have. Not sure? Pick the first one.</p>
          <div className="pay-coins" role="radiogroup" aria-label="Coin">
            {COINS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={coin?.id === c.id}
                className={`pay-coin ${coin?.id === c.id ? 'on' : ''}`}
                onClick={() => setCoin(c)}
              >
                <span className="pay-coin-name">
                  {c.name} <span className="pay-chip">{c.network}</span>
                </span>
                <span className="muted small">{c.note}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary pay-next" disabled={!coin} onClick={() => setStep('ready')}>
            Continue
          </button>
          <p className="pay-aside">
            <button type="button" className="link-button" onClick={() => setStep('learn')}>
              New to crypto? How to get USDT
            </button>
          </p>
          <p className="pay-aside">
            <button type="button" className="link-button" disabled={busy} onClick={() => void otherCoins()}>
              Pay with another coin
            </button>
          </p>
          {error && <p className="error">{error}</p>}
          <BackLink onClick={() => setStep('order')} />
        </>
      )}

      {step === 'learn' && (
        <>
          <h1 className="page-title">New to crypto?</h1>
          <p className="muted">USDT is a digital dollar: 1 USDT is worth about $1. Here's the easiest way to get some.</p>
          <ol className="pay-guide">
            <li>
              <b>Open a crypto app.</b> For example Binance or Bybit (whichever works in your country). Sign up and verify
              your identity; the app guides you.
            </li>
            <li>
              <b>Buy USDT with your card.</b> In the app, tap Buy, choose USDT, and buy a little more than ${item.price} (about $
              {Math.ceil(item.price + 2)}), to cover the app's small sending fee.
            </li>
            <li>
              <b>Come back here.</b> Choose "USDT · Tron (TRC20)" and follow the steps. We'll show you exactly what to send and
              where.
            </li>
          </ol>
          <button type="button" className="btn btn-primary pay-next" onClick={() => setStep('coin')}>
            I have USDT now
          </button>
          <BackLink onClick={() => setStep('coin')} />
        </>
      )}

      {step === 'ready' && coin && (
        <Ready coin={coin} price={item.price} busy={busy} error={error} onBack={() => setStep('coin')} onGo={() => void begin()} />
      )}

      {step === 'send' && order && coin && (
        <Send
          coin={coin}
          order={order}
          onSent={() => {
            remember(order.id);
            setStep('wait');
          }}
          onRestart={() => setStep('ready')}
        />
      )}

      {step === 'wait' && order && (
        <Wait coin={coin} order={order} onCheck={() => refreshOrder().catch((e: Error) => setError(e.message))} onBack={() => setStep('send')} error={error} />
      )}

      {step === 'done' && order && (
        <>
          <div className="pay-done-mark" aria-hidden="true">
            ✓
          </div>
          <h1 className="page-title">Payment received</h1>
          <p>
            {order.problem === 'studio-ended'
              ? "Your Studio plan ended before the payment arrived, so we couldn't add the people. We'll refund you: we've emailed you about it."
              : `${
                  order.kind === 'pack'
                    ? `Your extra ${PACK.hours} hours and ${PACK.episodes} episodes are ready.`
                    : order.kind === 'seats'
                      ? `Your team now has room for ${order.seats} more ${order.seats === 1 ? 'person' : 'people'}. Invite them in Plan & settings.`
                      : `Isla ${planById(order.plan!).name} is on${account.profile?.current_period_end ? ` until ${new Date(account.profile.current_period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.`
                } We've emailed you a receipt.`}
          </p>
          <button type="button" className="btn btn-primary pay-next" onClick={() => navigate('/new')}>
            Make clips
          </button>
          <p className="pay-aside">
            <Link to="/account">See my plan</Link>
          </p>
        </>
      )}

      {step === 'problem' && (
        <Problem order={order} error={error} onRestart={startOver} />
      )}
    </Shell>
  );
}

function Shell({ step, children }: { step?: Step; children: ReactNode }) {
  const n = step ? NUMBERED.indexOf(step) : -1;
  return (
    <main className="pay-page">
      {n >= 0 && (
        <div className="pay-progress" aria-label={`Step ${n + 1} of ${NUMBERED.length}`}>
          <span className="muted small">
            Step {n + 1} of {NUMBERED.length}
          </span>
          <div className="pay-bar">
            <i style={{ width: `${((n + 1) / NUMBERED.length) * 100}%` }} />
          </div>
        </div>
      )}
      {children}
    </main>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="pay-aside">
      <button type="button" className="link-button pay-back" onClick={onClick}>
        ← Back
      </button>
    </p>
  );
}

/** Step 3: what's about to happen, for the chosen coin. */
function Ready({ coin, price, busy, error, onBack, onGo }: { coin: Coin; price: number; busy: boolean; error: string | null; onBack: () => void; onGo: () => void }) {
  const [sure, setSure] = useState(false);
  const usdt = coin.name === 'USDT';
  return (
    <>
      <h1 className="page-title">Before you send</h1>
      <p className="muted">Three things to know. Next, we'll show you the exact amount and address.</p>
      <ol className="pay-guide">
        <li>
          <b>Open the app that holds your {coin.name}</b>, like Binance, Bybit or Trust Wallet, and find <b>Send</b> or{' '}
          <b>Withdraw</b>, then choose {coin.name}.
        </li>
        <li>
          <b>Choose the network {coin.network}.</b> This matters: sent on another network, the money can't arrive.
          {usdt && ` In some apps it's called "${coin.networkShort === 'TRC20' ? 'TRX' : 'BSC'}".`}
        </li>
        <li>
          <b>Watch the fee.</b> Most apps take their sending fee from the amount. Make sure the amount that <i>arrives</i>{' '}
          ("you will receive") is at least what we show, about {usdt ? `${price} USDT` : `$${price}`}. A little more is fine.
        </li>
      </ol>
      <label className="pay-check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I'll send {coin.name} on {coin.network}
      </label>
      <button type="button" className="btn btn-primary pay-next" disabled={!sure || busy} onClick={onGo}>
        {busy ? 'Getting your address…' : 'Show me where to send'}
      </button>
      {error && <p className="error">{error}</p>}
      <BackLink onClick={onBack} />
    </>
  );
}

/** Copies `text`, falling back to selecting it where the clipboard isn't allowed. */
function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [id] = useState(() => `copy-${Math.random().toString(36).slice(2)}`);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="pay-copy">
      <span className="muted small">{label}</span>
      <div className="pay-copy-row">
        <input id={id} readOnly value={value} className={mono ? 'mono' : ''} onFocus={(e) => e.target.select()} aria-label={label} />
        <button type="button" className="btn btn-outline btn-inline" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function minutesLeft(until: string | null): number | null {
  if (!until) return null;
  return Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));
}

/** Step 4: exactly what to send, and where. */
function Send({ coin, order, onSent, onRestart }: { coin: Coin; order: PayOrder; onSent: () => void; onRestart: () => void }) {
  const [showQr, setShowQr] = useState(false);
  const [left, setLeft] = useState(() => minutesLeft(order.priceUntil));
  useEffect(() => {
    const t = setInterval(() => setLeft(minutesLeft(order.priceUntil)), 15_000);
    return () => clearInterval(t);
  }, [order.priceUntil]);
  const amount = String(order.amount ?? '');
  const address = order.address ?? '';
  const qr = showQr ? qrImage(coin.uri(address, order.amount ?? 0)) : null;
  const expired = left === 0;
  return (
    <>
      <h1 className="page-title">Send your payment</h1>
      {expired ? (
        <div className="notice">
          <p>The price was held for 20 minutes and that time is up, because crypto prices move.</p>
          <p>
            <b>Already sent it?</b> Tap "I've sent it" below and we'll check it. <b>Not yet?</b> Get a fresh amount:
          </p>
          <button type="button" className="btn btn-outline btn-inline" onClick={onRestart}>
            Get a new amount
          </button>
        </div>
      ) : (
        <p className="muted">
          In your app, send exactly this. {left !== null && <>The price is held for <b>{left} more minute{left === 1 ? '' : 's'}</b>.</>}
        </p>
      )}
      <div className="card pay-send">
        <div className="pay-send-row">
          <span className="pay-num">1</span>
          <CopyRow label={`Amount (${coin.name}) — make sure at least this arrives`} value={amount} />
        </div>
        <div className="pay-send-row">
          <span className="pay-num">2</span>
          <div className="pay-copy">
            <span className="muted small">Network</span>
            <p className="pay-network">{coin.network}</p>
          </div>
        </div>
        <div className="pay-send-row">
          <span className="pay-num">3</span>
          <CopyRow label="Address to send to" value={address} mono />
        </div>
        {order.memo && (
          <div className="pay-send-row">
            <span className="pay-num">4</span>
            <CopyRow label="Memo / tag (required)" value={order.memo} mono />
          </div>
        )}
        <button type="button" className="link-button" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR code' : 'Paying from another phone? Show a QR code'}
        </button>
        {qr && <img className="pay-qr" src={qr} alt={`QR code of the address ${address}`} />}
      </div>
      <p className="muted small">After pasting the address, check its first and last 4 characters match: {address.slice(0, 4)}…{address.slice(-4)}.</p>
      <button type="button" className="btn btn-primary pay-next" onClick={onSent}>
        I've sent it
      </button>
    </>
  );
}

function qrImage(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 2);
}

/** Step 5: watching for the payment, in plain words. */
function Wait({ coin, order, onCheck, onBack, error }: { coin: Coin | null; order: PayOrder; onCheck: () => void; onBack: () => void; error: string | null }) {
  const seen = ['confirming', 'confirmed', 'sending', 'finished'].includes(order.status);
  const steps: [string, boolean][] = [
    ['You sent it', true],
    ['Seen on the blockchain', seen],
    [
      'Confirmed, ' + (order.kind === 'pack' ? 'adding your extra hours' : order.kind === 'seats' ? 'adding the people to your team' : 'turning on your plan'),
      ['confirmed', 'sending', 'finished'].includes(order.status),
    ],
  ];
  return (
    <>
      <h1 className="page-title">Waiting for your payment</h1>
      <p className="muted">
        This takes {coin ? coin.minutes : 'a few minutes'}. You can leave this page:{' '}
        {order.kind === 'pack' ? 'your extra hours are added' : order.kind === 'seats' ? 'the people are added to your team' : 'your plan turns on'} by
        itself and we'll email you. This page updates on its own.
      </p>
      <ol className="pay-timeline">
        {steps.map(([label, done], i) => (
          <li key={label} className={done ? 'done' : i === steps.findIndex(([, d]) => !d) ? 'now' : ''}>
            {label}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-outline pay-next" onClick={onCheck}>
        Check now
      </button>
      {error && <p className="error">{error}</p>}
      {order.status === 'waiting' && order.address && (
        <p className="pay-aside">
          <button type="button" className="link-button" onClick={onBack}>
            Haven't sent it yet? Back to the address
          </button>
        </p>
      )}
      <p className="muted small">Order {order.id.slice(0, 8)}. Something wrong after an hour? Email support@islaclips.com with this number.</p>
    </>
  );
}

function Problem({ order, error, onRestart }: { order: PayOrder | null; error: string | null; onRestart: () => void }) {
  const coin = coinById(order?.coin ?? null);
  if (order?.status === 'partially_paid') {
    const missing = order.amount != null ? Math.max(0, order.amount - order.received) : null;
    return (
      <>
        <h1 className="page-title">Part of the payment arrived</h1>
        <p>
          We received {order.received} {coin?.name ?? ''} of {order.amount} {coin?.name ?? ''}
          {missing ? `, so ${Number(missing.toFixed(6))} ${coin?.name ?? ''} is missing` : ''}. This usually happens when the app's
          sending fee was taken from the amount.
        </p>
        <p>
          Email <a href={`mailto:support@islaclips.com?subject=Order ${order.id}`}>support@islaclips.com</a> with your order number{' '}
          <b>{order.id.slice(0, 8)}</b> and we'll sort it out. Please don't send more before we reply.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="page-title">This payment didn't go through</h1>
      <p>{error ?? 'Nothing was taken for this order.'}</p>
      {order && (
        <p className="muted small">
          If you sent money for it, email support@islaclips.com with your order number <b>{order.id.slice(0, 8)}</b>.
        </p>
      )}
      <button type="button" className="btn btn-primary pay-next" onClick={onRestart}>
        Start again
      </button>
      <p className="pay-aside">
        <Link to="/pricing">Back to plans</Link>
      </p>
    </>
  );
}

// The owners' dashboard (owner.html): sign in, then see how many people use Isla. Only the owners' emails
// get in; the server checks it again before sending any numbers (owner_stats in the database).
import { supabase } from './lib/supabase';

const OWNERS = ['abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com'];

// Sections of "name: number" (or a plain list), worded on the server (owner_stats).
type Section = { title: string; rows?: [string, number][]; list?: string[] };

const app = document.getElementById('app')!;
const WHEN = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function esc(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function main() {
  if (!supabase) {
    app.innerHTML = '<p class="error">Supabase isn’t set up in this build.</p>';
    return;
  }
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email?.toLowerCase();
  if (!email) return showSignIn();
  if (!OWNERS.includes(email)) {
    await supabase.auth.signOut();
    return showSignIn('This page is private.');
  }
  showPage(email);
}

function showSignIn(message?: string) {
  app.innerHTML = `
    <div class="card signin">
      <h1>Isla owner</h1>
      <p class="muted">Private. Sign in with an owner account.</p>
      <button class="wide" id="google">Continue with Google</button>
      <p class="or">or</p>
      <form id="form">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required />
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required />
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p class="error" id="error">${esc(message ?? '')}</p>
    </div>`;
  const error = document.getElementById('error')!;
  document.getElementById('google')!.addEventListener('click', () => {
    void supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/owner` } });
  });
  document.getElementById('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const email = (document.getElementById('email') as HTMLInputElement).value.trim().toLowerCase();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    if (!OWNERS.includes(email)) {
      error.textContent = 'This page is private.';
      return;
    }
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password });
    if (signInError) {
      error.textContent = signInError.message;
      return;
    }
    void main();
  });
}

type Tab = 'numbers' | 'accounts' | 'history';

/** The signed-in page: a bar with tabs, then the chosen tab. */
function showPage(email: string, tab: Tab = 'numbers') {
  const tabs: [Tab, string][] = [
    ['numbers', 'Numbers'],
    ['accounts', 'Accounts'],
    ['history', 'History'],
  ];
  app.innerHTML = `
    <div class="bar">
      <div><h1>Isla owner</h1><p class="muted">Signed in as ${esc(email)}</p></div>
      <div><button id="out">Sign out</button></div>
    </div>
    <nav class="tabs">${tabs.map(([id, name]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${name}</button>`).join('')}</nav>
    <div id="content"><p class="muted">Loading…</p></div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => showPage(email, b.dataset.tab as Tab)));
  document.getElementById('out')!.addEventListener('click', async () => {
    await supabase!.auth.signOut();
    showSignIn();
  });
  const content = document.getElementById('content')!;
  if (tab === 'numbers') void showStats(content);
  else if (tab === 'accounts') showAccounts(content);
  else void showHistory(content);
}

async function showStats(content: HTMLElement) {
  const { data, error } = await supabase!.rpc('owner_stats');
  if (error) {
    content.innerHTML = `<p class="error">Couldn’t load the numbers: ${esc(error.message)}</p>`;
    return;
  }
  const sections = data as Section[];
  content.innerHTML = `
    <p class="muted">Updated ${esc(WHEN.format(new Date()))} <button id="refresh" class="small-btn">Refresh</button></p>
    ${sections
      .map(
        (sec) => `
      <h2>${esc(sec.title)}</h2>
      <div class="card rows">${
        sec.rows
          ? sec.rows.map(([name, value]) => `<div class="row"><span>${esc(name)}</span><b>${esc(value)}</b></div>`).join('')
          : sec.list?.length
            ? sec.list.map((item) => `<div class="row"><span class="email">${esc(item)}</span></div>`).join('')
            : '<div class="row"><span class="muted">None yet</span></div>'
      }</div>`,
      )
      .join('')}`;
  document.getElementById('refresh')!.addEventListener('click', () => void showStats(content));
}

// --- Accounts ---

interface Account {
  id: string;
  email: string;
  joined: string;
  last_seen: string | null;
  via: string;
  blocked: boolean;
  plan: 'free' | 'pro' | 'studio';
  billing: string | null;
  plan_until: string | null;
  paying: boolean;
  gifted: boolean;
  episodes: number;
  episodes_30d: number;
  team_of: string | null;
  wants: string | null;
}

const DAY = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const FILTERS: [string, string][] = [
  ['all', 'All'],
  ['free', 'Free'],
  ['pro', 'Pro'],
  ['studio', 'Studio'],
  ['gifted', 'Given for free'],
  ['paying', 'Paying'],
  ['blocked', 'Blocked'],
];

/** Calls the owner-admin function with this owner's session. */
async function adminCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase!.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/owner-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong.');
  return out;
}

function showAccounts(content: HTMLElement) {
  let filter = 'all';
  content.innerHTML = `
    <input id="search" type="search" placeholder="Search by email" autocomplete="off" />
    <div class="chips">${FILTERS.map(([id, name]) => `<button data-filter="${id}" class="${id === filter ? 'on' : ''}">${name}</button>`).join('')}</div>
    <p class="muted" id="count"></p>
    <div id="list"></div>`;
  const input = document.getElementById('search') as HTMLInputElement;
  const list = document.getElementById('list')!;
  const count = document.getElementById('count')!;
  let timer = 0;
  let asked = 0;
  const load = async () => {
    const mine = ++asked;
    try {
      const { accounts } = await adminCall<{ accounts: Account[] }>({ action: 'search', q: input.value, filter });
      if (mine !== asked) return;
      count.textContent = `${accounts.length}${accounts.length === 100 ? '+' : ''} account${accounts.length === 1 ? '' : 's'}`;
      list.innerHTML = accounts.length ? accounts.map(accountCard).join('') : '<p class="muted">No accounts match.</p>';
      wire(list, accounts, load);
    } catch (err) {
      list.innerHTML = `<p class="error">${esc((err as Error).message)}</p>`;
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void load(), 300);
  });
  content.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter!;
      content.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      void load();
    }),
  );
  void load();
}

function planText(a: Account): string {
  if (a.plan === 'free') return 'Free';
  const name = a.plan === 'pro' ? 'Pro' : 'Studio';
  const kind = a.paying ? 'paying' : a.gifted ? 'given for free' : '';
  return `${name}${kind ? ` (${kind})` : ''}${a.plan_until ? ` · until ${DAY.format(new Date(a.plan_until))}` : ''}`;
}

function accountCard(a: Account): string {
  const owner = OWNERS.includes(a.email.toLowerCase());
  const facts = [
    `Joined ${DAY.format(new Date(a.joined))} with ${a.via === 'google' ? 'Google' : 'email'}`,
    a.last_seen ? `last active ${WHEN.format(new Date(a.last_seen))}` : 'never signed in',
    `${a.episodes} episode${a.episodes === 1 ? '' : 's'} (${a.episodes_30d} in 30 days)`,
    a.team_of ? `on ${a.team_of}'s team` : '',
    a.wants ? `wants ${a.wants === 'pro' ? 'Pro' : 'Studio'}` : '',
  ].filter(Boolean);
  return `
    <div class="card account" data-id="${a.id}">
      <div class="account-head">
        <b class="email">${esc(a.email)}</b>
        ${owner ? '<span class="badge">Owner</span>' : ''}
        ${a.blocked ? '<span class="badge badge-red">Blocked</span>' : ''}
      </div>
      <p class="account-plan">${esc(planText(a))}</p>
      <p class="muted small">${esc(facts.join(' · '))}</p>
      <div class="actions">
        <button data-do="give">Give or extend a plan</button>
        ${a.plan !== 'free' && !a.paying ? '<button data-do="free">Move to Free</button>' : ''}
        <button data-do="reset-usage">Reset usage</button>
        <button data-do="reset-password">Send password reset</button>
        ${owner ? '' : a.blocked ? '<button data-do="unblock">Unblock</button>' : '<button data-do="block">Block</button>'}
        ${owner ? '' : '<button data-do="delete" class="danger">Delete</button>'}
      </div>
      <form class="give" hidden>
        <div class="chips">
          <label><input type="radio" name="plan-${a.id}" value="pro" ${a.plan === 'pro' ? 'checked' : ''} /> Pro</label>
          <label><input type="radio" name="plan-${a.id}" value="studio" ${a.plan !== 'pro' ? 'checked' : ''} /> Studio</label>
        </div>
        <div class="chips">
          <button type="button" data-months="1">1 month</button>
          <button type="button" data-months="3">3 months</button>
          <button type="button" data-months="12">1 year</button>
        </div>
        <label class="small">Or until <input type="date" name="until" /></label>
        <button type="submit" class="primary">Save</button>
      </form>
      <p class="error small" data-msg></p>
    </div>`;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

function wire(list: HTMLElement, accounts: Account[], reload: () => Promise<void>) {
  list.querySelectorAll<HTMLElement>('.account').forEach((card) => {
    const a = accounts.find((x) => x.id === card.dataset.id)!;
    const msg = card.querySelector<HTMLElement>('[data-msg]')!;
    const form = card.querySelector<HTMLFormElement>('form.give')!;
    const run = async (body: Record<string, unknown>, done: string) => {
      msg.textContent = '';
      msg.classList.remove('ok');
      try {
        await adminCall({ id: a.id, ...body });
        await reload();
        // The list was redrawn; say it on the fresh card.
        const fresh = list.querySelector<HTMLElement>(`.account[data-id="${a.id}"] [data-msg]`);
        if (fresh) {
          fresh.textContent = done;
          fresh.classList.add('ok');
        }
      } catch (err) {
        msg.textContent = (err as Error).message;
      }
    };
    // Extending starts from the current end date if the plan is still running.
    const base = a.plan !== 'free' && a.plan_until && new Date(a.plan_until) > new Date() ? new Date(a.plan_until) : new Date();
    const chosenPlan = () => (form.querySelector<HTMLInputElement>(`input[name="plan-${a.id}"]:checked`)?.value ?? 'studio');
    form.querySelectorAll<HTMLButtonElement>('[data-months]').forEach((b) =>
      b.addEventListener('click', () => {
        const until = addMonths(chosenPlan() === a.plan ? base : new Date(), Number(b.dataset.months));
        if (confirm(`Give ${a.email} ${chosenPlan() === 'pro' ? 'Pro' : 'Studio'} until ${DAY.format(until)}?`)) {
          void run({ action: 'set-plan', plan: chosenPlan(), until: until.toISOString() }, 'Plan saved.');
        }
      }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = (form.elements.namedItem('until') as HTMLInputElement).value;
      if (!value) {
        msg.textContent = 'Choose a duration or a date.';
        return;
      }
      void run({ action: 'set-plan', plan: chosenPlan(), until: new Date(`${value}T23:59:00`).toISOString() }, 'Plan saved.');
    });
    card.querySelectorAll<HTMLButtonElement>('[data-do]').forEach((b) =>
      b.addEventListener('click', () => {
        const what = b.dataset.do!;
        if (what === 'give') form.hidden = !form.hidden;
        else if (what === 'free' && confirm(`Move ${a.email} to Free now?`)) void run({ action: 'set-plan', plan: 'free' }, 'Moved to Free.');
        else if (what === 'reset-usage' && confirm(`Reset ${a.email}'s usage for this period? Their episodes count starts again from 0.`))
          void run({ action: 'reset-usage' }, 'Usage reset.');
        else if (what === 'reset-password' && confirm(`Email ${a.email} a link to choose a new password?`))
          void run({ action: 'reset-password' }, 'Password reset email sent.');
        else if (what === 'block' && confirm(`Block ${a.email}? They won't be able to sign in until you unblock them.`))
          void run({ action: 'block' }, 'Blocked.');
        else if (what === 'unblock') void run({ action: 'unblock' }, 'Unblocked.');
        else if (what === 'delete') {
          const typed = prompt(`This deletes ${a.email} and all their saved work, for good.\n\nType their email to confirm:`);
          if (typed !== null) void run({ action: 'delete', confirm: typed.trim() }, 'Deleted.');
        }
      }),
    );
  });
}

// --- History ---

async function showHistory(content: HTMLElement) {
  try {
    const { log } = await adminCall<{ log: { at: string; owner_email: string; target_email: string | null; action: string; details: Record<string, string> | null }[] }>({
      action: 'log',
    });
    const words: Record<string, string> = {
      'set-plan': 'changed the plan of',
      'reset-usage': 'reset the usage of',
      'reset-password': 'sent a password reset to',
      block: 'blocked',
      unblock: 'unblocked',
      delete: 'deleted',
    };
    content.innerHTML = log.length
      ? `<div class="card rows">${log
          .map((l) => {
            const extra = l.details?.plan ? ` → ${l.details.plan}${l.details.until ? ` until ${DAY.format(new Date(l.details.until))}` : ''}` : '';
            return `<div class="row"><span>${esc(l.owner_email.split('@')[0])} ${esc(words[l.action] ?? l.action)} <b class="email">${esc(l.target_email ?? '')}</b>${esc(extra)}</span><span class="muted small">${esc(WHEN.format(new Date(l.at)))}</span></div>`;
          })
          .join('')}</div>`
      : '<p class="muted">Nothing changed yet.</p>';
  } catch (err) {
    content.innerHTML = `<p class="error">${esc((err as Error).message)}</p>`;
  }
}

void main();

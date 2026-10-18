// The owners' dashboard (owner.html): sign in, then see how many people use Isla. Only the owners' emails
// get in; the server checks it again before sending any numbers (owner_stats in the database).
import { supabase } from './lib/supabase';

const OWNERS = ['abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com'];

interface Stats {
  users: { total: number; today: number; week: number; google: number };
  active: { today: number; week: number };
  episodes: { total: number; today: number; week: number; cloud_today: number; in_line: number };
  ai_today: number;
  waitlist: { pro: number; studio: number; emails: { email: string; plan: string; at: string }[] };
  recent: { email: string; at: string; via: string | null; episodes: number }[];
}

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
  await showStats(email);
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

async function showStats(email: string) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await supabase!.rpc('owner_stats');
  if (error) {
    app.innerHTML = `<p class="error">Couldn’t load the numbers: ${esc(error.message)}</p>`;
    return;
  }
  const s = data as Stats;
  const tile = (value: number, label: string, warn = false) => `<div class="tile${warn ? ' warn' : ''}"><b>${value}</b><span>${esc(label)}</span></div>`;
  app.innerHTML = `
    <div class="bar">
      <div><h1>Isla owner</h1><p class="muted">Signed in as ${esc(email)} · updated ${esc(WHEN.format(new Date()))}</p></div>
      <div><button id="refresh">Refresh</button> <button id="out">Sign out</button></div>
    </div>

    <h2>People</h2>
    <div class="tiles">
      ${tile(s.users.total, 'accounts in total')}
      ${tile(s.users.today, 'new today')}
      ${tile(s.users.week, 'new in the last 7 days')}
      ${tile(s.active.week, 'made an episode, last 7 days')}
    </div>

    <h2>Episodes</h2>
    <div class="tiles">
      ${tile(s.episodes.today, 'today')}
      ${tile(s.episodes.week, 'last 7 days')}
      ${tile(s.episodes.total, 'in total')}
      ${tile(s.episodes.cloud_today, 'phone (cloud) today')}
      ${tile(s.episodes.in_line, 'waiting in line now', s.episodes.in_line > 0)}
      ${tile(s.ai_today, 'AI requests today')}
    </div>

    <h2>Notify me (paid plans)</h2>
    <div class="tiles">
      ${tile(s.waitlist.pro + s.waitlist.studio, 'people waiting')}
      ${tile(s.waitlist.pro, 'want Pro')}
      ${tile(s.waitlist.studio, 'want Studio')}
    </div>
    ${
      s.waitlist.emails.length
        ? `<div class="card table" style="margin-top:10px"><table><tr><th>Email</th><th>Plan</th><th>When</th></tr>${s.waitlist.emails
            .map((w) => `<tr><td class="email">${esc(w.email)}</td><td>${esc(w.plan)}</td><td>${esc(WHEN.format(new Date(w.at)))}</td></tr>`)
            .join('')}</table></div>`
        : ''
    }

    <h2>Newest accounts</h2>
    <div class="card table"><table>
      <tr><th>Email</th><th>Joined</th><th>With</th><th>Episodes</th></tr>
      ${s.recent
        .map((u) => `<tr><td class="email">${esc(u.email)}</td><td>${esc(WHEN.format(new Date(u.at)))}</td><td>${esc(u.via ?? '')}</td><td>${u.episodes}</td></tr>`)
        .join('')}
    </table></div>`;
  document.getElementById('refresh')!.addEventListener('click', () => void showStats(email));
  document.getElementById('out')!.addEventListener('click', async () => {
    await supabase!.auth.signOut();
    showSignIn();
  });
}

void main();

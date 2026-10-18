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
  const sections = data as Section[];
  app.innerHTML = `
    <div class="bar">
      <div><h1>Isla owner</h1><p class="muted">Updated ${esc(WHEN.format(new Date()))}</p></div>
      <div><button id="refresh">Refresh</button> <button id="out">Sign out</button></div>
    </div>
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
      .join('')}
    <p class="muted">Signed in as ${esc(email)}</p>`;
  document.getElementById('refresh')!.addEventListener('click', () => void showStats(email));
  document.getElementById('out')!.addEventListener('click', async () => {
    await supabase!.auth.signOut();
    showSignIn();
  });
}

void main();

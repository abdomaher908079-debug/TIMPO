import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import IslaOrb from '../components/IslaOrb';
import { useAuth } from '../lib/auth';
import { LIMITS } from '../lib/plans';
import { INVITE_REWARD, pendingInvite } from '../lib/invite';

const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { googleEnabled, signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  // Invite links bring the invited email (?email=…).
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  // Expired password links send people here with ?forgot=1.
  const [forgot, setForgot] = useState(() => mode === 'login' && new URLSearchParams(window.location.search).has('forgot'));
  const [resetSent, setResetSent] = useState(false);
  const isSignup = mode === 'signup';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (forgot) {
      void run(async () => {
        await sendPasswordReset(email.trim());
        setResetSent(true);
      });
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    if (isSignup && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    void run(async () => {
      if (isSignup) {
        const { needsConfirmation } = await signUpWithEmail(email.trim(), password);
        if (needsConfirmation) {
          setCheckEmail(true);
          return;
        }
      } else {
        await signInWithEmail(email.trim(), password);
      }
      navigate('/');
    });
  }

  if (checkEmail) {
    return (
      <main className="auth">
        <h1 className="page-title">Check your email</h1>
        <p className="muted">
          We sent a confirmation link to <strong>{email}</strong>. Click it to finish creating your account.
        </p>
      </main>
    );
  }

  if (resetSent) {
    return (
      <main className="auth">
        <h1 className="page-title">Check your email</h1>
        <p className="muted">
          If <strong>{email}</strong> has an account, we've sent it a link to choose a new password. It can take a minute;
          check your spam folder too.
        </p>
        <button type="button" className="link-button" onClick={() => { setResetSent(false); setForgot(false); }}>
          Back to log in
        </button>
      </main>
    );
  }

  if (forgot) {
    return (
      <main className="auth">
        <h1 className="page-title">Forgot your password?</h1>
        <p className="muted">Enter your email and we'll send you a link to choose a new one.</p>
        <form onSubmit={submit} noValidate>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Send me a link'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
        <button type="button" className="link-button" onClick={() => { setForgot(false); setError(null); }}>
          Back to log in
        </button>
      </main>
    );
  }

  return (
    <main className="auth auth-card card">
      <div className="auth-isla" aria-hidden="true">
        <IslaOrb size={64} still />
      </div>
      <h1 className="page-title">{isSignup ? 'Create your free account' : 'Welcome back'}</h1>
      <p className="muted">
        {isSignup ? 'Your episodes and clips, saved in one place.' : 'Log in to make clips from your episodes.'}
      </p>
      {isSignup && pendingInvite() && (
        <p className="notice">
          You were invited! Make your first episode and you and your friend both get +{INVITE_REWARD.hours} free hours.
        </p>
      )}

      {/* Shown once the Google provider is turned on in Supabase (Authentication → Providers). */}
      {googleEnabled && (
        <>
          <button className="btn btn-light btn-google" disabled={busy} onClick={() => void run(signInWithGoogle)}>
            <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </button>

          <div className="divider">or</div>
        </>
      )}

      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {!isSignup && (
          <button type="button" className="link-button forgot-link" onClick={() => { setForgot(true); setError(null); }}>
            Forgot password?
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      <p className="muted small">
        {isSignup ? (
          <>
            Already have an account? <Link to="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link to="/signup">Create a free account</Link>
          </>
        )}
      </p>
      {isSignup && (
        <p className="muted small">Free plan: {freeSummary()}. By continuing you agree to the Terms and Privacy Policy.</p>
      )}
    </main>
  );
}

/** "3 episodes every week, up to 2 hours each", from the Free plan's limits. */
function freeSummary(): string {
  const { episodesPerPeriod: n, maxEpisodeSeconds: max } = LIMITS.free;
  const episodes = n === 1 ? '1 episode' : `${n} episodes`;
  const length = max ? (max >= 3600 ? `${max / 3600} hour${max === 3600 ? '' : 's'}` : `${max / 60} minutes`) : 'any length';
  return `${episodes} every week, up to ${length} each`;
}

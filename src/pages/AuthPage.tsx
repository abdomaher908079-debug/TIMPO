import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

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
    <main className="auth">
      <h1 className="page-title">{isSignup ? 'Create your free account' : 'Welcome back'}</h1>
      <p className="muted">
        {isSignup ? 'Your episodes and clips, saved in one place.' : 'Log in to make clips from your episodes.'}
      </p>

      {/* Shown once the Google provider is turned on in Supabase (Authentication → Providers). */}
      {googleEnabled && (
        <>
          <button className="btn btn-light" disabled={busy} onClick={() => void run(signInWithGoogle)}>
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
        <p className="muted small">Free plan: 1 episode every week, up to 30 minutes. By continuing you agree to the Terms and Privacy Policy.</p>
      )}
    </main>
  );
}

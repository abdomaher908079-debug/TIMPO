import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const MIN_PASSWORD = 8;

/**
 * Where the "forgot password" email lands (?token_hash=…). The code is only used when they tap Continue:
 * email apps and link scanners often open links before the person does, and would otherwise use it up.
 */
export default function ResetPassword() {
  const { user, loading, redeemRecoveryCode, setNewPassword } = useAuth();
  const navigate = useNavigate();
  const [tokenHash] = useState(() => new URLSearchParams(window.location.search).get('token_hash'));
  const [failed, setFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <main className="auth" />;

  if (failed || (!user && !tokenHash)) {
    return (
      <main className="auth">
        <h1 className="page-title">This link no longer works</h1>
        <p className="muted">
          Each link works once, for one hour. Ask for a new one: it arrives in a minute, and you can ask again right away if
          it doesn't.
        </p>
        <Link className="btn btn-primary" to="/login?forgot=1">
          Send me a new link
        </Link>
      </main>
    );
  }

  async function verify() {
    setBusy(true);
    try {
      await redeemRecoveryCode(tokenHash!);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <main className="auth">
        <h1 className="page-title">Reset your password</h1>
        <p className="muted">Tap continue to choose a new password.</p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void verify()}>
          {busy ? 'Please wait…' : 'Continue'}
        </button>
      </main>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setNewPassword(password);
      navigate('/');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === 'same_password'
          ? "That's your current password. If your browser filled it in, clear the box and type a new one."
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1 className="page-title">Choose a new password</h1>
      <p className="muted">For {user.email}</p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="field-label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="show-password">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : 'Save password'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

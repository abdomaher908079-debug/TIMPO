import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const MIN_PASSWORD = 8;

/** Where the "forgot password" email lands: the link signs them in, then they choose a new password. */
export default function ResetPassword() {
  const { user, loading, setNewPassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <main className="auth" />;

  if (!user) {
    return (
      <main className="auth">
        <h1 className="page-title">This link has expired</h1>
        <p className="muted">Password links work once, for one hour. Ask for a new one and use the latest email.</p>
        <Link className="btn btn-primary" to="/login">
          Back to log in
        </Link>
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
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
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

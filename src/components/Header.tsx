import { Link, useLocation } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { BRAND_NAME } from '../lib/brand';
import LogoMark from './LogoMark';

export default function Header() {
  const { user } = useAuth();
  const { plan, loading } = useAccount();
  const here = useLocation().pathname;

  return (
    <header className="header">
      <Link to="/" className="logo" aria-label={`${BRAND_NAME} home`}>
        <LogoMark size={34} />
        <span className="logo-word">{BRAND_NAME.toLowerCase()}</span>
        {/* The plan you work under (yours, or your Studio team's). Nothing on Free. */}
        {user && !loading && plan.id !== 'free' && <span className="plan-badge">{plan.name}</span>}
      </Link>
      {/* Signed in, the sidebar (computers) or the tabs (phones) are the menu: just the logo here. */}
      {!user && (
        <nav className="nav">
          {/* Never a link to the page you're on: Pricing from home, Home from everywhere else. */}
          {here === '/' ? (
            <Link to="/pricing" className="nav-link">
              Pricing
            </Link>
          ) : (
            <Link to="/" className="nav-link">
              Home
            </Link>
          )}
          {here !== '/login' && here !== '/signup' && (
            <Link to="/login" className="nav-link">
              Log in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}

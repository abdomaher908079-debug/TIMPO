import { Link, useLocation } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { BRAND_NAME } from '../lib/brand';
import LogoMark from './LogoMark';

// Navigation once signed in: a sidebar on computers, a tab bar at the bottom on phones (styles.css
// shows one or the other). The page you're on is marked, never a link to itself.

type Icon = 'home' | 'library' | 'new' | 'kits' | 'pricing' | 'settings';

const SIDEBAR: [string, string, Icon][] = [
  ['/', 'Home', 'home'],
  ['/library', 'Library', 'library'],
  ['/brand-kits', 'Brand kits', 'kits'],
  ['/pricing', 'Pricing', 'pricing'],
  ['/account', 'Plan & settings', 'settings'],
];

const TABS: [string, string, Icon][] = [
  ['/', 'Home', 'home'],
  ['/library', 'Library', 'library'],
  ['/new', 'New', 'new'],
  ['/brand-kits', 'Brand kits', 'kits'],
  ['/account', 'Account', 'settings'],
];

const PATHS: Record<Icon, string> = {
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
  library: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
  new: 'M12 5v14M5 12h14',
  kits: 'M12 4a8 8 0 1 0 0 16c1 0 1.5-.7 1.5-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.7 1.7-1.7H17a3 3 0 0 0 3-3C20 7 16.4 4 12 4zM7.5 12.5h.01M9.5 8.5h.01M14.5 8.5h.01',
  pricing: 'M4 12V5h7l9 9-7 7-9-9zM8 8.5h.01',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
};

function NavIcon({ name }: { name: Icon }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function initialsOf(name: string | null, email: string) {
  return (name ?? email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function Sidebar() {
  const { user, signOut } = useAuth();
  const { plan, loading } = useAccount();
  const here = useLocation().pathname;
  if (!user) return null;
  return (
    <aside className="sidebar" aria-label="Main menu">
      <Link to="/" className="logo sidebar-logo" aria-label={`${BRAND_NAME} home`}>
        <LogoMark size={32} />
        <span className="logo-word">{BRAND_NAME.toLowerCase()}</span>
        {!loading && plan.id !== 'free' && <span className="plan-badge">{plan.name}</span>}
      </Link>
      {here === '/new' ? (
        <span className="btn btn-primary sidebar-new sidebar-new-here">New episode</span>
      ) : (
        <Link to="/new" className="btn btn-primary sidebar-new">
          New episode
        </Link>
      )}
      <nav className="sidebar-nav">
        {SIDEBAR.map(([to, label, icon]) =>
          here === to ? (
            <span key={to} className="sidebar-item sidebar-item-here" aria-current="page">
              <NavIcon name={icon} />
              {label}
            </span>
          ) : (
            <Link key={to} to={to} className="sidebar-item">
              <NavIcon name={icon} />
              {label}
            </Link>
          ),
        )}
      </nav>
      <div className="sidebar-account">
        <Link to="/account" className="sidebar-me" title="Plan & settings">
          <span className="avatar avatar-static">{initialsOf(user.name, user.email)}</span>
          <span className="sidebar-me-text">
            <b>{user.name ?? user.email.split('@')[0]}</b>
            <span>{user.email}</span>
          </span>
        </Link>
        <button type="button" className="link-button sidebar-out" onClick={() => void signOut()}>
          Log out
        </button>
      </div>
    </aside>
  );
}

export function TabBar() {
  const { user } = useAuth();
  const here = useLocation().pathname;
  if (!user) return null;
  return (
    <nav className="tabbar" aria-label="Main menu">
      {TABS.map(([to, label, icon]) => {
        const content = (
          <>
            {icon === 'settings' ? <span className="avatar avatar-static tab-avatar">{initialsOf(user.name, user.email)}</span> : <NavIcon name={icon} />}
            <span>{label}</span>
          </>
        );
        const cls = `tab ${icon === 'new' ? 'tab-new' : ''}`;
        return here === to ? (
          <span key={to} className={`${cls} tab-here`} aria-current="page">
            {content}
          </span>
        ) : (
          <Link key={to} to={to} className={cls}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

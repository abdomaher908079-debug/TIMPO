import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BRAND, BRAND_NAME } from '../lib/brand';
import LogoMark from './LogoMark';

export default function Header() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close the account menu on navigation and on clicks outside it.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  return (
    <header className="header">
      <Link to="/" className="logo" aria-label={`${BRAND_NAME} home`}>
        <LogoMark />
        <span>
          {BRAND.first}
          <b>{BRAND.second}</b>
        </span>
      </Link>
      <nav className="nav">
        <a href="/#pricing" className="nav-link">
          Pricing
        </a>
        {user ? (
          <div className="account" ref={menuRef}>
            <button className="avatar" aria-label="Account menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              {initials}
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <p className="menu-email">{user.email}</p>
                <Link role="menuitem" to="/new">
                  New episode
                </Link>
                <Link role="menuitem" to="/account">
                  Account & plan
                </Link>
                <button role="menuitem" onClick={() => void signOut()}>
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/login" className="nav-link">
            Log in
          </Link>
        )}
      </nav>
    </header>
  );
}

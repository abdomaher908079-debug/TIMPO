import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Header() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  return (
    <header className="header">
      <Link to="/" className="logo" aria-label="FixMyCode home">
        Fix<b>My</b>Code<span className="logo-dot">.</span>
      </Link>
      {user ? (
        <div className="account">
          <button className="avatar" aria-label="Account menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {initials}
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <p className="menu-email">{user.email}</p>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
              >
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
    </header>
  );
}

import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/Header';
import BackButton from './components/BackButton';
import { useAuth } from './lib/auth';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import NewEpisode from './pages/NewEpisode';
import Account from './pages/Account';
import Footer from './components/Footer';
import { Privacy, Refunds, Terms } from './pages/Legal';
import Diagnose from './pages/Diagnose';
import Library from './pages/Library';
import PricingPage from './pages/PricingPage';
import BrandKitsPage from './pages/BrandKitsPage';
import ResetPassword from './pages/ResetPassword';

export default function App() {
  const { demo } = useAuth();
  return (
    <div className="page">
      {demo && <div className="demo-banner">Demo mode: logins are fake and only saved in this browser.</div>}
      <ScrollOnNavigate />
      <Header />
      <BackButton />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<GuestOnly><AuthPage key="login" mode="login" /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><AuthPage key="signup" mode="signup" /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/new" element={<RequireAuth><NewEpisode /></RequireAuth>} />
        <Route path="/library" element={<RequireAuth><Library /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/brand-kits" element={<RequireAuth><BrandKitsPage /></RequireAuth>} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/refunds" element={<Refunds />} />
        <Route path="/diagnose" element={<Diagnose />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </div>
  );
}

// New pages start at the top; links like /#section scroll to that section.
function ScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    // Not `return window.scrollTo(...)`: some browsers (e.g. Brave) return a Promise from it, and React
    // would then try to call that as the effect's cleanup and crash.
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    // The section may render a moment later (e.g. after the account loads).
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, [pathname, hash]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="loading">Loading…</p>;
  if (!user) return <Navigate to="/signup" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="loading">Loading…</p>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

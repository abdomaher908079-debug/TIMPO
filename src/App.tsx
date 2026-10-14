import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import { useAuth } from './lib/auth';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import NewEpisode from './pages/NewEpisode';

export default function App() {
  const { demo } = useAuth();
  return (
    <div className="page">
      {demo && <div className="demo-banner">Demo mode: logins are fake and only saved in this browser.</div>}
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<GuestOnly><AuthPage key="login" mode="login" /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><AuthPage key="signup" mode="signup" /></GuestOnly>} />
        <Route path="/new" element={<RequireAuth><NewEpisode /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
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
  if (user) return <Navigate to="/new" replace />;
  return <>{children}</>;
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export interface User {
  id: string;
  email: string;
  name: string | null;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // True when Supabase keys aren't set: logins are faked in this browser only.
  demo: boolean;
  // Whether "Continue with Google" can work: the Google provider is turned on in Supabase.
  googleEnabled: boolean;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  // Emails a link to /reset-password, which signs them in so they can choose a new password.
  sendPasswordReset(email: string): Promise<void>;
  setNewPassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

const DEMO_KEY = 'hookcut_demo_user';

const AuthContext = createContext<AuthContextValue | null>(null);

function toUser(u: { id: string; email?: string; user_metadata?: Record<string, unknown> }): User {
  const name = u.user_metadata?.full_name ?? u.user_metadata?.name;
  return { id: u.id, email: u.email ?? '', name: typeof name === 'string' ? name : null };
}

function readDemoUser(): User | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeDemoUser(user: User | null) {
  try {
    if (user) localStorage.setItem(DEMO_KEY, JSON.stringify(user));
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    // Private mode or blocked storage: demo login just won't persist.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((res) => (res.ok ? res.json() : null))
      .then((settings: { external?: { google?: boolean } } | null) => setGoogleEnabled(!!settings?.external?.google))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!supabase) {
      setUser(readDemoUser());
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session ? toUser(data.session.user) : null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session ? toUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const demoLogin = (email: string, name: string | null) => {
      const u = { id: `demo-${email}`, email, name };
      writeDemoUser(u);
      setUser(u);
    };

    return {
      user,
      loading,
      demo: !supabase,
      googleEnabled,
      async signInWithGoogle() {
        if (!supabase) return demoLogin('demo.user@gmail.com', 'Demo User');
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
      },
      async signInWithEmail(email, password) {
        if (!supabase) return demoLogin(email, null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUpWithEmail(email, password) {
        if (!supabase) {
          demoLogin(email, null);
          return { needsConfirmation: false };
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        // With email confirmation on (Supabase's default), there's no session until they click the link.
        return { needsConfirmation: !data.session };
      },
      async sendPasswordReset(email) {
        if (!supabase) return;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
      },
      async setNewPassword(password) {
        if (!supabase) return;
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      },
      async signOut() {
        if (!supabase) {
          writeDemoUser(null);
          setUser(null);
          return;
        }
        await supabase.auth.signOut();
      },
    };
  }, [user, loading, googleEnabled]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

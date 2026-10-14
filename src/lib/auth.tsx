import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

const DEMO_KEY = 'hookcut_demo_user';

// The current session's token, sent to our API so it can check who's asking.
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
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
      async signInWithGoogle() {
        if (!supabase) return demoLogin('demo.user@gmail.com', 'Demo User');
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/new` },
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
          options: { emailRedirectTo: `${window.location.origin}/new` },
        });
        if (error) throw error;
        // With email confirmation on (Supabase's default), there's no session until they click the link.
        return { needsConfirmation: !data.session };
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
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

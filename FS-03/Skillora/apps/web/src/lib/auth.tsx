import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, clearSession, restoreSession, setSession, type AuthData, type AuthUser } from './api';

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  sessionError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { name: string; email: string; password: string; role: 'student' | 'instructor' }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((session) => {
        if (active) setUser(session?.user ?? null);
      })
      .catch((error: unknown) => {
        if (active) {
          setUser(null);
          setSessionError(error instanceof Error ? error.message : 'Unable to restore your session.');
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const acceptSession = useCallback((session: AuthData) => {
    setUser(setSession(session).user);
    setSessionError('');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await api<AuthData>(
        '/auth/login',
        { method: 'POST', body: { email, password }, auth: false },
      );
      acceptSession(session);
    },
    [acceptSession],
  );

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string; role: 'student' | 'instructor' }) => {
      const session = await api<AuthData>('/auth/register', {
        method: 'POST',
        body: input,
        auth: false,
      });
      acceptSession(session);
    },
    [acceptSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, sessionError, signIn, signUp, signOut }),
    [user, ready, sessionError, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

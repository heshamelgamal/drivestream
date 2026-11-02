import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, loadSession, login as apiLogin, logout as apiLogout, setSignedOutHandler, type User } from './api';

type Auth = {
  user: User | null;
  ready: boolean;
  signIn: (server: string, username: string, password: string) => Promise<void>;
  adopt: (user: User) => void; // signed in another way (a code approved on another device)
  updateUser: (user: User) => void; // the server returned a changed user (e.g. PATCH /api/me)
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth>(null as unknown as Auth);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    (async () => {
      const { token } = await loadSession();
      if (token) {
        try {
          setUser((await api<{ user: User }>('/api/me')).user);
        } catch {}
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (server: string, username: string, password: string) => {
    setUser(await apiLogin(server, username, password));
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, signIn, adopt: setUser, updateUser: setUser, signOut }}>{children}</AuthContext.Provider>;
}

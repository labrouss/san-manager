// =============================================================================
// context/AuthContext.tsx
// JWT token stored in memory + sessionStorage.
// Provides login(), logout(), current user, and token for API calls.
// =============================================================================

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
const TOKEN_KEY = "san-auth-token";
const USER_KEY  = "san-auth-user";

export interface AuthUser {
  id:       string;
  username: string;
  email:    string;
  role:     "ADMIN" | "OPERATOR" | "VIEWER";
}

interface AuthContextValue {
  user:       AuthUser | null;
  token:      string | null;
  isLoading:  boolean;
  login:      (username: string, password: string) => Promise<void>;
  logout:     () => void;
  isAdmin:    boolean;
  isOperator: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null, token: null, isLoading: true,
  login: async () => {}, logout: () => {},
  isAdmin: false, isOperator: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [token,     setToken]     = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    try {
      const storedToken = sessionStorage.getItem(TOKEN_KEY);
      const storedUser  = sessionStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        // Verify token is not expired by checking exp field
        const payload = JSON.parse(atob(storedToken.split(".")[1]));
        if (payload.exp * 1000 > Date.now()) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        } else {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(USER_KEY);
        }
      }
    } catch { /* corrupt storage */ }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");

    const { token: newToken, user: newUser } = data as { token: string; user: AuthUser };
    setToken(newToken);
    setUser(newUser);
    sessionStorage.setItem(TOKEN_KEY, newToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, login, logout,
      isAdmin:    user?.role === "ADMIN",
      isOperator: user?.role === "ADMIN" || user?.role === "OPERATOR",
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Hook: returns fetch headers with Authorization
export function useAuthHeaders(): Record<string, string> {
  const { token } = useAuth();
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

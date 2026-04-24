// =============================================================================
// components/auth/LoginPage.tsx
// Login form + first-run registration when no users exist yet
// =============================================================================

import { useState, FormEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

export function LoginPage() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mode, setMode]         = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError("Username and password required"); return; }
    setBusy(true); setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) { setError("All fields are required"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role: "ADMIN" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      // Auto-login after registration
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Theme toggle top-right */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13.5 8.5A5.5 5.5 0 0 1 7.5 2.5a5.5 5.5 0 1 0 6 6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-xl bg-blue-500 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="6" width="20" height="12" rx="2" stroke="white" strokeWidth="1.5"/>
                <circle cx="6"  cy="12" r="1.5" fill="white"/>
                <circle cx="12" cy="12" r="1.5" fill="white"/>
                <circle cx="18" cy="12" r="1.5" fill="white"/>
              </svg>
            </div>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">SAN Manager</h1>
            <p className="text-sm text-muted-foreground">Cisco MDS 9000 Management Platform</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border bg-card p-6 space-y-5 shadow-sm">
          {/* Mode tabs */}
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              onClick={() => { setMode("login"); setError(null); }}
              className={cn("flex-1 py-2 transition-colors",
                mode === "login" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-muted-foreground"
              )}
            >Sign in</button>
            <button
              onClick={() => { setMode("register"); setError(null); }}
              className={cn("flex-1 py-2 transition-colors",
                mode === "register" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-muted-foreground"
              )}
            >First-time setup</button>
          </div>

          <form onSubmit={mode === "login" ? handleLogin : handleRegister} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Username</label>
              <input
                value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }}
                placeholder="admin"
                autoComplete="username"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {mode === "register" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder="admin@example.com"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {mode === "register" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError(null); }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            {mode === "register" && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                First registered user becomes the admin. Use the "First-time setup" tab only once.
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {busy && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create admin account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Default credentials: <span className="font-mono">admin</span> / <span className="font-mono">Admin1234!</span>
          <br/>Change after first login via User Management.
        </p>
      </div>
    </div>
  );
}

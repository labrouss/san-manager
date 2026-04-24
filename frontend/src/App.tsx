// src/App.tsx
import { useAuth }      from "./context/AuthContext";
import { Dashboard }    from "./pages/Dashboard";
import { LoginPage }    from "./components/auth/LoginPage";

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  return user ? <Dashboard /> : <LoginPage />;
}

// =============================================================================
// context/ThemeContext.tsx
// Dark / light theme with localStorage persistence and system preference fallback
// =============================================================================

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme:     Theme;
  setTheme:  (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme:       "light",
  setTheme:    () => {},
  toggleTheme: () => {},
});

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("san-theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("san-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  // Apply on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

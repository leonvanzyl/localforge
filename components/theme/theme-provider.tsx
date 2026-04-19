"use client";

import * as React from "react";

/**
 * Theme provider for LocalForge.
 *
 * Persists the selected theme ("dark" | "light") in localStorage under the
 * key `localforge-theme` so the preference survives page reloads. On the
 * client, applies the theme by toggling the `dark` class (plus a
 * `data-theme` attribute for anything that wants to style off of it) on
 * the `<html>` element.
 *
 * The *initial* theme on first paint is set by a tiny inline script in
 * `app/layout.tsx` that reads localStorage before React hydrates — this
 * avoids a flash of the wrong theme. See THEME_INIT_SCRIPT below.
 */

export const THEME_STORAGE_KEY = "localforge-theme";
export type Theme = "dark" | "light";
export const DEFAULT_THEME: Theme = "dark";

/**
 * Inline script injected into <head> in app/layout.tsx. Reads the saved
 * theme from localStorage and applies the class before React paints, so
 * the very first render already has the correct theme.
 *
 * NOTE: This is a plain string (not JSX) because it must run before any
 * React code. Keep it small and dependency-free.
 */
export const THEME_INIT_SCRIPT = `(() => {
  try {
    var saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = saved === "light" || saved === "dark" ? saved : ${JSON.stringify(DEFAULT_THEME)};
    var el = document.documentElement;
    if (theme === "dark") {
      el.classList.add("dark");
    } else {
      el.classList.remove("dark");
    }
    el.setAttribute("data-theme", theme);
    el.style.colorScheme = theme;
  } catch (e) {
    /* ignore */
  }
})();`;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (theme === "dark") {
    el.classList.add("dark");
  } else {
    el.classList.remove("dark");
  }
  el.setAttribute("data-theme", theme);
  el.style.colorScheme = theme;
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // During SSR we always render the default so the first HTML matches
  // the `<html class="dark">` emitted by the inline init script.
  // After hydration, the effect below syncs React state with whatever
  // is actually active on <html>.
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);

  // On mount, sync state with whatever the inline init script already
  // applied (or fall back to localStorage).
  React.useEffect(() => {
    const initial = readInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* quota / private mode — theme still applies in-memory */
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

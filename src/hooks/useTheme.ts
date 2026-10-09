import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { ThemeMode } from '../types';

const THEME_KEY = 'homehub.theme';

/**
 * Apply theme to <html>: 'light' → remove .dark, 'dark' → add .dark,
 * 'system' → follow the OS preference via matchMedia.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const wantDark = mode === 'dark' || (mode === 'system' && prefersDark);
  root.classList.toggle('dark', wantDark);
  // Smooth color transition handled in CSS via `transition-colors duration-300`.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_KEY, mode);
    }
  } catch {
    /* ignore quota */
  }
}

export function useTheme() {
  const { settings } = useStore();
  const theme: ThemeMode = settings.theme;

  // Apply on mount + whenever theme or system pref changes.
  useEffect(() => {
    applyTheme(theme);
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    // Modern + Safari < 14 fallback
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  return theme;
}
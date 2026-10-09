import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';

/** Tracks the OS preference; needed because 'system' resolves through it. */
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return prefersDark;
}

/**
 * One-tap light/dark switch.
 *
 * The setting itself is three-way (Light / Dark / System) and lives in
 * Settings → Appearance. This is the shortcut: it flips between light and
 * dark based on what is *currently on screen*, so it always does the obvious
 * thing — if the app looks dark, tapping makes it light.
 *
 * `isDark` is DERIVED from the stored mode plus the OS preference rather than
 * read back from `<html class="dark">`. Reading the class looked tempting but
 * is subtly wrong: React runs child effects before parent effects, so this
 * component would read the class BEFORE the parent's useTheme had applied the
 * new one — freezing the label on the first flip and never toggling again.
 */
export function ThemeToggle({
  className, variant = 'default',
}: {
  className?: string;
  /** 'onGradient' sits on a coloured hero where the sage/ink chrome is invisible. */
  variant?: 'default' | 'onGradient';
}) {
  const { settings, updateSettings } = useStore();
  const prefersDark = usePrefersDark();
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);

  return (
    <button
      onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={clsx(
        variant === 'onGradient'
          ? 'shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/15 backdrop-blur ring-1 ring-white/25 text-white hover:bg-white/25 active:scale-95 transition'
          : 'btn-icon bg-sage-50 dark:bg-ink-700 text-sage-700 dark:text-cream-100 hover:bg-sage-100 dark:hover:bg-ink-600',
        className,
      )}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
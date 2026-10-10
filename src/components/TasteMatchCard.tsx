import { useNavigate } from 'react-router-dom';
import { Sparkles, Info, Utensils } from 'lucide-react';
import clsx from 'clsx';

export interface TasteMatch {
  /** 0..1 mean similarity of the suggested dishes to the taste profile. */
  score: number;
  /** How many dishes the score covers. */
  dishes: number;
}

/**
 * A small read-out of how close this week's suggestions are to the user's
 * taste profile.
 *
 * This is a REAL measurement, not a vibe: the mean cosine similarity between
 * each suggested recipe's embedding and the taste vector built from the user's
 * logged meals. It is a similarity score, not a promise — we have no ground
 * truth about what someone will enjoy until they cook it, and saying
 * "87% accurate" would be inventing a number we cannot back.
 *
 * When there is no taste profile yet (no logged meals with a recipe) there is
 * nothing to measure against, so it says so instead of showing a fake figure.
 */
export function TasteMatchCard({
  match, hasTasteProfile, loading, isDark,
}: {
  match: TasteMatch | null;
  hasTasteProfile: boolean;
  /** The embedding model is still downloading. */
  loading?: boolean;
  isDark?: boolean;
}) {
  const navigate = useNavigate();
  const pct = match ? Math.round(match.score * 100) : null;

  // The card tells the user it needs logged meals — so it should also offer
  // the button that fixes that, rather than leaving a dead end. Navigate first,
  // then fire the event on the next tick so the Dashboard listener exists.
  const logAMeal = () => {
    navigate('/');
    setTimeout(() => window.dispatchEvent(new CustomEvent('homehub:open-log-meal')), 120);
  };

  // Colour tracks the score, but the thresholds are about how close the dishes
  // are — not about how "good" they are.
  const tone =
    pct === null ? null
    : pct >= 70 ? { ring: 'text-sage-600 dark:text-sage-300', bar: 'bg-sage-500' }
    : pct >= 45 ? { ring: 'text-butter-700 dark:text-butter-300', bar: 'bg-butter-500' }
    : { ring: 'text-tomato-600 dark:text-tomato-300', bar: 'bg-tomato-500' };

  return (
    <div
      aria-label="Taste match"
      className={clsx(
        'rounded-2xl border p-3.5',
        isDark
          ? 'border-ink-700 bg-ink-800/70'
          : 'border-sage-200 bg-sage-50/60',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400">
        <Sparkles size={11} />
        Taste match
      </div>

      {pct === null ? (
        <>
          <p
            className={clsx(
              'mt-1.5 text-sm font-semibold',
              isDark ? 'text-cream-50' : 'text-sage-900',
            )}
          >
            {loading
              ? 'Learning your taste…'
              : hasTasteProfile
                ? 'Fill your week to find out'
                : 'Log meals to unlock'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-sage-500 dark:text-ink-400">
            {loading
              ? 'Downloading the taste model — it only happens once.'
              : hasTasteProfile
                ? "We'll measure how close those dishes are to what you normally cook."
                : 'HomeHub needs a few logged meals with a recipe before it can learn what you like.'}
          </p>
          {/* Only offer the shortcut where it actually helps — while loading,
              or once the week is filled, there's nothing to nudge. */}
          {!loading && !hasTasteProfile && (
            <button
              onClick={logAMeal}
              className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-sage-700 hover:bg-sage-800 text-white text-xs font-bold py-2 transition active:scale-[.98]"
            >
              <Utensils size={13} />
              Log a meal
            </button>
          )}
        </>
      ) : (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={clsx(
                'font-display text-3xl font-extrabold leading-none',
                tone?.ring,
              )}
            >
              {pct}%
            </span>
            <span className="text-[11px] text-sage-500 dark:text-ink-400">
              of {match!.dishes} dish{match!.dishes === 1 ? '' : 'es'}
            </span>
          </div>

          {/* Bar is a plain proportion, not a judgement. */}
          <div
            className={clsx(
              'mt-2 h-1.5 rounded-full overflow-hidden',
              isDark ? 'bg-ink-700' : 'bg-sage-100',
            )}
          >
            <div
              className={clsx('h-full rounded-full transition-all', tone?.bar)}
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>

          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-sage-500 dark:text-ink-400">
            <Info size={10} className="mt-0.5 shrink-0" />
            <span>How close these dishes are to what you usually cook — not a promise you'll
            love them all.</span>
          </p>
        </>
      )}
    </div>
  );
}
import { useNavigate } from 'react-router-dom';
import { Sparkles, Utensils } from 'lucide-react';
import clsx from 'clsx';

export interface TasteMatch {
  /** 0..1 — how good a bet the whole list is. Always computable. */
  score: number;
  /** How many dishes the score covers. */
  dishes: number;
  /** True once a meal log contributes to the number. */
  fromTasteProfile: boolean;
}

/**
 * The single accuracy read-out for the week "Fill my week" just built.
 *
 * ONE box, ONE percentage — how good a bet the list is as a whole. It is
 * computed from real facts (how much of each dish you already have, whether
 * the dish suits the meal it's planned into, whether the recipe is complete,
 * and — once meals are logged — how close it is to your taste profile), so it
 * shows a number even on a brand-new install with no history at all.
 *
 * It is a confidence score, not a probability of enjoyment. We cannot know
 * whether you'll love a dish until you cook it.
 */
export function TasteMatchCard({
  match, hasTasteProfile, loading, isDark,
}: {
  match: TasteMatch | null;
  hasTasteProfile: boolean;
  loading?: boolean;
  isDark?: boolean;
}) {
  const navigate = useNavigate();
  const pct = match ? Math.round(match.score * 100) : null;

  const tone =
    pct === null ? null
    : pct >= 70 ? { ring: 'text-sage-600 dark:text-sage-300', bar: 'bg-sage-500' }
    : pct >= 45 ? { ring: 'text-butter-700 dark:text-butter-300', bar: 'bg-butter-500' }
    : { ring: 'text-tomato-600 dark:text-tomato-300', bar: 'bg-tomato-500' };

  // Nudge toward logging meals, but only while it would actually change the
  // number — after that it's just noise.
  const wantsLogMeals = !loading && !hasTasteProfile;

  return (
    <div
      aria-label="Taste match"
      className={clsx(
        'rounded-2xl border p-4 text-center',
        isDark ? 'border-ink-700 bg-ink-800/70' : 'border-sage-200 bg-sage-50/60',
      )}
    >
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400">
        <Sparkles size={11} />
        Accuracy
      </div>

      {pct === null ? (
        <>
          <p className="mt-2 text-sm font-semibold text-sage-900 dark:text-cream-50">
            {loading ? 'Working it out…' : 'Fill your week to see'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-sage-500 dark:text-ink-400">
            {loading
              ? 'Downloading the taste model — it only happens once.'
              : 'We will score every dish in the plan and give you one number.'}
          </p>
        </>
      ) : (
        <>
          <div
            className={clsx(
              'font-display text-5xl font-extrabold leading-none mt-2 tabular-nums',
              tone?.ring,
            )}
          >
            {pct}%
          </div>
          <p className="mt-1 text-[11px] text-sage-500 dark:text-ink-400">
            {match!.fromTasteProfile ? 'based on your logged tastes' : 'based on your kitchen'}
          </p>

          <div
            className={clsx(
              'mt-2.5 h-2 rounded-full overflow-hidden',
              isDark ? 'bg-ink-700' : 'bg-sage-100',
            )}
          >
            <div
              className={clsx('h-full rounded-full transition-all', tone?.bar)}
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-sage-500 dark:text-ink-400">
            How good a bet this week&rsquo;s list is — not a promise you&rsquo;ll love
            every dish.
          </p>
        </>
      )}

      {wantsLogMeals && (
        <button
          onClick={() => {
            navigate('/');
            setTimeout(() => window.dispatchEvent(new CustomEvent('homehub:open-log-meal')), 120);
          }}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-sage-700 hover:bg-sage-800 text-white text-xs font-bold py-2 transition active:scale-[.98]"
        >
          <Utensils size={13} />
          Log a meal
        </button>
      )}
    </div>
  );
}
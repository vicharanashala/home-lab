import { useNavigate } from 'react-router-dom';
import { Sparkles, Info, Utensils, TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';

export interface DishConfidence {
  name: string;
  /** 0..1 similarity to the taste profile, or null when unscorable. */
  score: number | null;
}

export interface TasteMatch {
  /** 0..1 mean similarity, or null when no dish could be scored at all. */
  score: number | null;
  /** How many dishes carried a real score. */
  dishes: number;
  /** Every dish Fill my week chose, strongest first. */
  breakdown: DishConfidence[];
}

/**
 * Per-dish confidence for the week that "Fill my week" just built.
 *
 * The headline number is the mean cosine similarity between each suggested
 * dish's embedding and the taste vector built from the user's logged meals.
 * The list underneath breaks that down dish by dish so it's clear WHICH dishes
 * drove the score — the week average on its own hides a lot.
 *
 * This is a similarity measurement, not a prediction: we have no ground truth
 * about what someone will enjoy until they cook it. So the wording is "match to
 * your logged tastes", never "you will like this".
 *
 * With no logged meals there is nothing to compare against, so the dishes are
 * listed with a dash rather than given an invented number.
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
  // A match with nothing scored is NOT a 0% — it's an absence of data. Showing
  // "0%" there would be a fabricated claim about the user's tastes.
  const pct = match && match.score !== null ? Math.round(match.score * 100) : null;

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

  // Strongest and weakest scored dishes. Only meaningful once there ARE scores;
  // with fewer than two dishes there is no spread to describe.
  const scored = (match?.breakdown || []).filter((d) => d.score !== null);
  const top = scored.length >= 2 ? scored.slice(0, 2) : scored;
  const bottom = scored.length >= 4 ? scored.slice(-2).reverse() : [];
  const wantsLogMeals = !loading && !hasTasteProfile;

  const Row = ({ d, strong }: { d: DishConfidence; strong?: boolean }) => (
    <li className="flex items-center gap-2 py-[3px]">
      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-[11px]',
          d.score === null ? 'text-sage-400 dark:text-ink-500' : 'text-sage-800 dark:text-cream-100',
        )}
      >
        {d.name}
      </span>
      {d.score === null ? (
        <span className="shrink-0 text-[10px] text-sage-400 dark:text-ink-500">—</span>
      ) : (
        <>
          <span
            className={clsx(
              'shrink-0 text-[10px] font-bold tabular-nums',
              strong ? 'text-sage-600 dark:text-sage-300' : 'text-sage-500 dark:text-ink-400',
            )}
          >
            {Math.round(d.score * 100)}%
          </span>
          <span
            className={clsx(
              'h-1 w-8 shrink-0 rounded-full overflow-hidden',
              isDark ? 'bg-ink-700' : 'bg-sage-100',
            )}
          >
            <span
              className={clsx('block h-full rounded-full', strong ? 'bg-sage-500' : 'bg-butter-400')}
              style={{ width: `${Math.max(4, Math.round((d.score ?? 0) * 100))}%` }}
            />
          </span>
        </>
      )}
    </li>
  );

  return (
    <div
      aria-label="Taste match"
      className={clsx(
        'rounded-2xl border p-3.5',
        isDark ? 'border-ink-700 bg-ink-800/70' : 'border-sage-200 bg-sage-50/60',
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
                : 'Not enough data yet'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-sage-500 dark:text-ink-400">
            {loading
              ? 'Downloading the taste model — it only happens once.'
              : hasTasteProfile
                ? "We'll measure how close those dishes are to what you normally cook."
                : 'Log a few meals and every dish below gets a real match score.'}
          </p>
          {wantsLogMeals && (
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
              className={clsx('font-display text-3xl font-extrabold leading-none', tone?.ring)}
            >
              {pct}%
            </span>
            <span className="text-[11px] text-sage-500 dark:text-ink-400">
              of {match!.dishes} dish{match!.dishes === 1 ? '' : 'es'}
            </span>
          </div>

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
        </>
      )}

      {/* Per-dish breakdown. Shown even with no scores so the user can still see
          what Fill my week picked — just without invented numbers next to it. */}
      {match && match.breakdown.length > 0 && (
        <div className="mt-3 border-t border-sage-200/70 pt-2 dark:border-ink-700/70">
          {top.length > 0 && (
            <>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400">
                <TrendingUp size={10} />
                Strongest matches
              </p>
              <ul className="mt-1">
                {top.map((d) => (
                  <Row key={d.name} d={d} strong />
                ))}
              </ul>
            </>
          )}

          {bottom.length > 0 && (
            <>
              <p className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400">
                <TrendingDown size={10} />
                Least sure
              </p>
              <ul className="mt-1">
                {bottom.map((d) => (
                  <Row key={d.name} d={d} />
                ))}
              </ul>
            </>
          )}

          {/* With no profile at all, show the rest of the week unscored rather
              than silently hiding dishes the user just got. */}
          {!hasTasteProfile && (
            <>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400">
                This week&rsquo;s dishes
              </p>
              <ul className="mt-1">
                {match.breakdown.slice(0, 6).map((d) => (
                  <Row key={d.name} d={d} />
                ))}
              </ul>
              {match.breakdown.length > 6 && (
                <p className="mt-1 text-[10px] text-sage-400 dark:text-ink-500">
                  +{match.breakdown.length - 6} more
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-2.5 flex items-start gap-1 text-[10px] leading-relaxed text-sage-500 dark:text-ink-400">
        <Info size={10} className="mt-0.5 shrink-0" />
        <span>
          {pct === null
            ? 'No scores until meals are logged — nothing here is guessed.'
            : 'Match to your logged tastes, not a promise you’ll like every dish.'}
        </span>
      </p>
    </div>
  );
}
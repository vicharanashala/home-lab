import { X, Sparkles, RefreshCw, ChefHat, Clock, Package } from 'lucide-react';
import clsx from 'clsx';
import { DishIcon } from './icons/DishIcons';
import type { MealSuggestion, SuggestReason } from '../utils/mealSuggest';
import type { MealSlot } from '../types';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
};

const REASON_STYLE: Record<SuggestReason, { chip: string; icon: typeof Sparkles }> = {
  expiring: {
    chip: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/40 dark:text-tomato-300',
    icon: Clock,
  },
  taste: {
    chip: 'bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-300',
    icon: Sparkles,
  },
  stock: {
    chip: 'bg-cream-100 text-sage-600 dark:bg-ink-900 dark:text-ink-300',
    icon: Package,
  },
  adventurous: {
    chip: 'bg-butter-100 text-butter-800 dark:bg-butter-900/30 dark:text-butter-300',
    icon: Sparkles,
  },
};

/**
 * Candidate dishes for one meal slot.
 *
 * Presents, never commits: tapping a card hands the recipe back to the page,
 * which fills the normal slot editor so the user can see it and change the
 * portion before saving. Matches the app's existing "propose, user executes"
 * rule — a bad suggestion costs one tap, never a silent edit to their week.
 */
export function SuggestSheet({
  slot, dayLabel, suggestions, hasTasteProfile, servings,
  onPick, onShuffle, onClose, busy,
}: {
  slot: MealSlot;
  dayLabel: string;
  suggestions: MealSuggestion[];
  hasTasteProfile: boolean;
  servings?: number;
  onPick: (s: MealSuggestion) => void;
  onShuffle: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Suggestions for ${dayLabel} ${SLOT_LABELS[slot]}`}
        className="relative w-full sm:max-w-lg max-h-[85vh] overflow-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 shadow-pop p-5 pb-[calc(var(--hh-nav-space,0rem)+0.5rem)] sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-xl font-bold text-sage-900 dark:text-cream-50">
              {dayLabel} {SLOT_LABELS[slot]}
            </h2>
            <p className="text-sm text-sage-600 dark:text-ink-300 mt-0.5">
              {hasTasteProfile
                ? 'Based on what you cook and what needs using up.'
                : 'Based on what you have. Log a few meals and these get sharper.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-sage-400 hover:text-sage-700 p-1">
            <X size={18} />
          </button>
        </div>

        {busy && (
          <p className="py-8 text-center text-sm text-sage-500 dark:text-ink-300">
            Thinking it over…
          </p>
        )}

        {!busy && suggestions.length === 0 && (
          <div className="py-8 text-center">
            <ChefHat size={28} className="mx-auto text-sage-300 dark:text-ink-600" />
            <p className="mt-2 text-sm text-sage-600 dark:text-ink-300">
              Nothing fits this slot right now — your filters and stock leave no obvious
              candidate. Try clearing an allergy filter or adding a few staples.
            </p>
          </div>
        )}

        {!busy && suggestions.length > 0 && (
          <>
            <ul className="space-y-1.5">
              {suggestions.map((s) => {
                const style = REASON_STYLE[s.reason];
                const ReasonIcon = style.icon;
                return (
                  <li key={s.recipe.id}>
                    <button
                      onClick={() => onPick(s)}
                      className="w-full flex items-center gap-2.5 rounded-xl bg-cream-50 dark:bg-ink-900 px-3 py-2.5 text-left hover:bg-sage-50 dark:hover:bg-sage-900/30 transition"
                    >
                      <DishIcon
                        recipe={s.recipe}
                        size={20}
                        className="shrink-0 text-sage-600 dark:text-sage-300"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-sage-900 dark:text-cream-50 text-sm truncate">
                          {s.recipe.name}
                        </span>
                        <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                              style.chip,
                            )}
                          >
                            <ReasonIcon size={10} />
                            {s.why}
                          </span>
                          <span className="text-[11px] text-sage-500 dark:text-ink-400">
                            {s.have}/{s.total} in stock
                            {servings ? ` · ${servings}pax` : ''}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              onClick={onShuffle}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-sage-200 dark:border-ink-700 py-2.5 text-sm font-bold text-sage-700 dark:text-sage-300 hover:bg-sage-50 dark:hover:bg-sage-900/30"
            >
              <RefreshCw size={15} />
              Show me different ones
            </button>

            <p className="mt-2 text-[11px] text-center text-sage-400 dark:text-ink-500">
              Tap a dish to add it — you can change the portion before saving.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
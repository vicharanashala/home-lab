import { useState } from 'react';
import { Users, Minus, Plus, ArrowRight, Check } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { adultEquivalents, headCount, suggestedServings, PORTION_LEVELS } from '../utils/portions';
import { HouseholdMemberIcon } from './icons/AppIcons';
import type { HouseholdProfile } from '../types';

const ROWS: {
  key: keyof Omit<HouseholdProfile, 'completed'>;
  label: string;
  blurb: string;
  emoji: string;
  max: number;
}[] = [
  { key: 'adults', label: 'Adults', blurb: 'full portions', emoji: '🧑', max: 10 },
  { key: 'teens', label: 'Teens', blurb: '12–17 yrs, ~most of an adult portion', emoji: '🧒', max: 8 },
  { key: 'children', label: 'Children', blurb: '4–11 yrs, about ⅔ of an adult portion', emoji: '🧑‍🍼', max: 8 },
  { key: 'toddlers', label: 'Toddlers', blurb: '1–3 yrs, about ⅓ of an adult portion', emoji: '👶', max: 6 },
];

/**
 * One-time household survey. The answers size the default portion on every
 * planned recipe, so the shopping list buys the right amount rather than
 * "whatever a recipe happens to be written for". Editable later in Settings.
 */
export function HouseholdSurveyModal({ onDone }: { onDone?: () => void }) {
  const { completeHouseholdSurvey, settings } = useStore();
  // Prefill from whatever is already saved. Hardcoding the defaults here meant
  // that anyone whose household was already set (but whose `completed` flag was
  // missing) opened the survey pre-filled with "2 adults, no kids" and wiped
  // their real household the moment they tapped Save.
  const [profile, setProfile] = useState<Omit<HouseholdProfile, 'completed'>>(() => ({
    adults: settings.household?.adults ?? 2,
    teens: settings.household?.teens ?? 0,
    children: settings.household?.children ?? 0,
    toddlers: settings.household?.toddlers ?? 0,
  }));

  const set = (key: keyof Omit<HouseholdProfile, 'completed'>, v: number) =>
    setProfile((p) => ({ ...p, [key]: Math.max(0, Math.min(20, v)) }));

  const eq = adultEquivalents(profile);
  const heads = headCount(profile);
  const servings = suggestedServings(profile);
  const suggested = PORTION_LEVELS.find((p) => p.servings === servings);
  const valid = eq > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 shadow-pop p-5 max-h-[90vh] overflow-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 grid place-items-center">
            <Users size={18} className="text-sage-700 dark:text-sage-300" />
          </span>
          <h2 className="font-display text-xl font-bold text-sage-900 dark:text-cream-50">
            Who's at home?
          </h2>
        </div>
        <p className="text-sm text-sage-600 dark:text-ink-300 mb-4">
          This sets how much food the meal planner shops for. You can change it any time in
          Settings.
        </p>

        <div className="space-y-2.5">
          {ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-xl border border-sage-200 dark:border-ink-700 px-3 py-2.5"
            >
              <HouseholdMemberIcon kind={row.key} size={22} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-sage-900 dark:text-cream-50">{row.label}</p>
                <p className="text-[11px] text-sage-500 dark:text-ink-400 truncate">{row.blurb}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => set(row.key, profile[row.key] - 1)}
                  aria-label={`Fewer ${row.label}`}
                  className="w-8 h-8 rounded-lg bg-sage-100 dark:bg-ink-700 grid place-items-center text-sage-700 dark:text-cream-100 active:scale-95"
                >
                  <Minus size={15} />
                </button>
                <span className="w-7 text-center font-bold text-sage-900 dark:text-cream-50 tabular-nums">
                  {profile[row.key]}
                </span>
                <button
                  onClick={() => set(row.key, profile[row.key] + 1)}
                  aria-label={`More ${row.label}`}
                  className="w-8 h-8 rounded-lg bg-sage-100 dark:bg-ink-700 grid place-items-center text-sage-700 dark:text-cream-100 active:scale-95"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Live consequence, so the question isn't abstract. */}
        <div
          className={clsx(
            'mt-4 rounded-xl px-3.5 py-3 border',
            valid
              ? 'bg-sage-50 dark:bg-sage-900/25 border-sage-200 dark:border-sage-800'
              : 'bg-tomato-50 dark:bg-tomato-900/20 border-tomato-200 dark:border-tomato-800',
          )}
        >
          {valid ? (
            <>
              <p className="text-sm font-semibold text-sage-900 dark:text-cream-50">
                Cooking for {heads} {heads === 1 ? 'person' : 'people'}
              </p>
              <p className="text-xs text-sage-600 dark:text-ink-300 mt-0.5">
                Portions will default to <strong>{suggested?.label} ({servings})</strong> —{' '}
                {suggested?.blurb}.
              </p>
            </>
          ) : (
            <p className="text-sm font-semibold text-tomato-700 dark:text-tomato-300">
              Add at least one person to continue.
            </p>
          )}
        </div>

        <button
          onClick={() => {
            completeHouseholdSurvey(profile);
            onDone?.();
          }}
          disabled={!valid}
          className={clsx(
            'mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl font-bold py-3 transition',
            valid
              ? 'bg-sage-700 hover:bg-sage-800 text-white'
              : 'bg-sage-200 dark:bg-ink-700 text-sage-400 dark:text-ink-500 cursor-not-allowed',
          )}
        >
          {valid ? <Check size={17} /> : <ArrowRight size={17} />}
          {valid ? 'Save and start planning' : 'Add someone first'}
        </button>
      </div>
    </div>
  );
}
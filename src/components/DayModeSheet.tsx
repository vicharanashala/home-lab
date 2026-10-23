import { Check, X } from 'lucide-react';
import clsx from 'clsx';
import { DAY_MODES } from '../utils/dayModes';
import type { DayModeId } from '../types';

/**
 * Picks how one day of the week is eaten.
 *
 * Deliberately separate from the household diet: a vrat day or a day with
 * guests over is about that day, not about how the family eats. The sheet
 * spells out exactly what each mode rules out, because "vrat" means
 * different things to different people and a wrong guess here would put dal
 * on a fasting table.
 */
export function DayModeSheet({
  dayLabel,
  current,
  onPick,
  onClose,
}: {
  dayLabel: string;
  current?: DayModeId;
  onPick: (mode: DayModeId) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        onClick={onClose}
        aria-label="Cancel"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`How ${dayLabel} is eaten`}
        className="relative w-full sm:max-w-md max-h-[85vh] overflow-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 shadow-pop p-5 pb-[calc(var(--hh-nav-space,0rem)+0.5rem)] sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-sage-900 dark:text-cream-50">
              How is {dayLabel} eaten?
            </h2>
            <p className="text-xs text-sage-500 dark:text-ink-400 mt-0.5">
              Only this day changes — your household diet stays as it is.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-sage-400 hover:text-sage-700 p-1">
            <X size={18} />
          </button>
        </div>

        <ul className="space-y-1.5">
          {DAY_MODES.map((m) => {
            const active = m.id === (current ?? 'normal');
            return (
              <li key={m.id}>
                <button
                  onClick={() => onPick(m.id)}
                  aria-current={active ? 'true' : undefined}
                  className={clsx(
                    'w-full text-left rounded-xl border px-3 py-2.5 transition',
                    active
                      ? 'border-sage-500 bg-sage-50 dark:bg-sage-900/40 ring-1 ring-sage-300 dark:ring-sage-800'
                      : 'border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <span className="text-lg leading-none pt-0.5 shrink-0">{m.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-sage-900 dark:text-cream-50">
                        {m.label}
                      </span>
                      <span className="block text-[11px] text-sage-600 dark:text-ink-300 mt-0.5">
                        {m.blurb}
                      </span>
                      <span className="block text-[10px] text-sage-400 dark:text-ink-500 mt-1">
                        Rules out: {m.excludes}
                      </span>
                    </span>
                    {active && (
                      <Check size={16} className="shrink-0 mt-0.5 text-sage-600 dark:text-sage-300" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl py-2.5 text-xs font-bold text-sage-600 hover:bg-sage-50 dark:text-ink-300 dark:hover:bg-ink-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

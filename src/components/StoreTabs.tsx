import { Plus, X } from 'lucide-react';
import clsx from 'clsx';

/** One open store, with the page it is showing. */
export interface ViewerTab {
  id: string;
  /** Which store this tab is showing. */
  storeId: string;
  /** The store's name, until the page says otherwise. */
  label: string;
  /** The emoji shown in place of a favicon. */
  emoji: string;
}

interface Props {
  tabs: ViewerTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

/**
 * A Chrome-style tab strip for the store viewer.
 *
 * WHY TABS AND NOT ONE STORE AT A TIME: shopping is comparing. You have
 * Jio Mart open for the vegetables and you want to check the price of the
 * same paneer on Amazon Fresh before you put it in the basket. Opening the
 * second store in a new tab of the app — rather than a new browser tab, or
 * worse, a new browser window — keeps both, keeps your place in each, and
 * keeps the shopping list in sight the whole time.
 *
 * WHY IT IS BUILT FOR A PHONE FIRST: the strip is a row of tabs on a narrow
 * screen, so it scrolls sideways, each tab is wide enough to read and tall
 * enough to tap with a thumb, and the title is truncated rather than the
 * tab growing. The "+" sits at the end of the row rather than in a corner,
 * because the end of a scrolling row is where the thumb already is.
 */
export function StoreTabs({ tabs, activeId, onSelect, onClose, onAdd }: Props) {
  return (
    <div
      className="relative z-10 -mx-4 sm:mx-0 mb-2"
      role="tablist"
      aria-label="Open stores"
    >
      <div className="flex items-end gap-1 overflow-x-auto px-4 sm:px-0 pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={clsx(
                'relative flex shrink-0 items-center gap-1.5 rounded-t-xl px-2.5 h-9 max-w-[46vw] sm:max-w-[190px]',
                'border transition-colors',
                active
                  ? 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700 shadow-soft'
                  : 'bg-transparent border-transparent hover:bg-sage-50 dark:hover:bg-ink-700/60',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(tab.id)}
                className="flex items-center gap-1.5 min-w-0 flex-1 h-full"
              >
                <span className="text-sm leading-none shrink-0" aria-hidden="true">
                  {tab.emoji}
                </span>
                <span
                  className={clsx(
                    'text-[12px] font-semibold truncate',
                    active
                      ? 'text-sage-900 dark:text-cream-50'
                      : 'text-sage-500 dark:text-ink-400',
                  )}
                >
                  {tab.label}
                </span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={() => onClose(tab.id)}
                  className={clsx(
                    'shrink-0 grid place-items-center w-5 h-5 rounded-md',
                    'text-sage-400 dark:text-ink-500 hover:bg-sage-100 dark:hover:bg-ink-600 hover:text-sage-700 dark:hover:text-cream-100',
                    !active && 'hidden sm:grid',
                  )}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAdd}
          aria-label="Open another store in a new tab"
          className="shrink-0 grid place-items-center w-9 h-9 rounded-t-xl text-sage-500 dark:text-ink-400 hover:bg-sage-50 dark:hover:bg-ink-700/60 hover:text-sage-800 dark:hover:text-cream-50 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

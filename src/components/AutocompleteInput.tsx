import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, History, Package, ChefHat, ShoppingCart } from 'lucide-react';
import { DishIcon } from './icons/DishIcons';
import clsx from 'clsx';

export type Suggestion =
  | { kind: 'recipe'; id: string; label: string; emoji?: string }
  | { kind: 'recent'; label: string }
  | { kind: 'quick'; label: string }
  | { kind: 'stock'; label: string; emoji?: string }
  | { kind: 'grocery'; label: string; emoji?: string };

interface Props {
  value: string;
  onChange: (v: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Limit number of suggestions shown. Default 6. */
  maxSuggestions?: number;
  /** Called when user picks a suggestion (Enter on highlighted, or tap). */
  onPick?: (s: Suggestion) => void;
  /** id for the input (so external labels can target it). */
  id?: string;
}

const ICON_FOR: Record<Suggestion['kind'], typeof Sparkles> = {
  recipe: ChefHat,
  recent: History,
  quick: Sparkles,
  stock: Package,
  grocery: ShoppingCart,
};

const COLOR_FOR: Record<Suggestion['kind'], string> = {
  recipe: 'text-sage-600 dark:text-sage-400',
  recent: 'text-sage-500 dark:text-ink-300',
  quick: 'text-butter-700 dark:text-butter-400',
  stock: 'text-tomato-600 dark:text-tomato-300',
  grocery: 'text-sage-600 dark:text-sage-400',
};

const LABEL_FOR: Record<Suggestion['kind'], string> = {
  recipe: 'Recipe',
  recent: 'Recent',
  quick: 'Quick',
  stock: 'In fridge',
  grocery: 'On list',
};

/**
 * Lowercased label + pre-split words, cached across renders and keystrokes.
 *
 * rankSuggestions runs over the whole pool on every keystroke. With the full
 * 5,894-recipe catalogue that is ~6k toLowerCase + split calls per character,
 * which measured ~13ms on a mid-range phone — right at the edge of dropping a
 * frame. Recipes are immutable while the page is open, so caching by label
 * turns that into a single map lookup after the first keystroke.
 */
const labelCache = new Map<string, { lower: string; words: string[] }>();
function labelInfo(label: string) {
  let v = labelCache.get(label);
  if (!v) {
    const lower = label.toLowerCase();
    v = { lower, words: lower.split(/\s+/) };
    // Bound the cache so a very long session can't grow it without limit.
    if (labelCache.size >= 20000) labelCache.clear();
    labelCache.set(label, v);
  }
  return v;
}

/**
 * Filter suggestions based on user query. Case-insensitive substring match;
 * ranked by: prefix match > word-boundary match > substring match; ties broken
 * by source priority (recipe > recent > quick > stock > grocery).
 */
function rankSuggestions(query: string, pool: Suggestion[]): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const priority: Record<Suggestion['kind'], number> = {
    recipe: 0,
    recent: 1,
    quick: 2,
    stock: 3,
    grocery: 4,
  };
  const scored: { s: Suggestion; score: number }[] = [];
  for (const s of pool) {
    const { lower, words } = labelInfo(s.label);
    let score = -1;
    if (lower.startsWith(q)) score = 0;
    else if (words.some((w) => w.startsWith(q))) score = 1;
    else if (lower.includes(q)) score = 2;
    if (score >= 0) {
      // Lower score = better. Add tiny priority tiebreaker.
      score = score * 100 + priority[s.kind];
      scored.push({ s, score });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((x) => x.s);
}

/** Split a label around the matched query so it can be emphasised, the way
 *  YouTube bolds the part of a title you typed. */
function highlightMatch(label: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return label;
  const at = label.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="bg-transparent font-extrabold text-sage-900 dark:text-cream-50">
        {label.slice(at, at + q.length)}
      </mark>
      {label.slice(at + q.length)}
    </>
  );
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  inputRef,
  maxSuggestions = 6,
  onPick,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const internalRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(
    () => rankSuggestions(value, suggestions).slice(0, maxSuggestions),
    [value, suggestions, maxSuggestions],
  );

  // Reset highlight whenever results change.
  useEffect(() => {
    setActiveIndex(0);
  }, [value, filtered.length]);

  const commit = (s: Suggestion) => {
    onChange(s.label);
    onPick?.(s);
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && filtered.length > 0) {
      e.preventDefault();
      const pick = filtered[activeIndex] ?? filtered[0];
      if (pick) commit(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(0);
    }
  };

  // Show suggestions when:
  //  - dropdown is open (clicked/focused)
  //  - there are matches
  //  - the user has typed something
  const showDropdown = open && value.trim().length > 0 && filtered.length > 0;

  return (
    <div className="relative">
      <input
        id={id}
        ref={(el) => {
          internalRef.current = el;
          if (typeof inputRef === 'function') inputRef(el);
          else if (inputRef && 'current' in (inputRef as any)) {
            (inputRef as any).current = el;
          }
        }}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so a tap on a suggestion still registers.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls={`${id ?? 'ac'}-listbox`}
      />
      {showDropdown && (
        <ul
          id={`${id ?? 'ac'}-listbox`}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1.5 max-h-72 overflow-auto rounded-xl bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 shadow-pop py-1"
        >
          {filtered.map((s, idx) => {
            const Icon = ICON_FOR[s.kind];
            const color = COLOR_FOR[s.kind];
            const active = idx === activeIndex;
            return (
              <li
                key={`${s.kind}-${s.label}-${idx}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // Use mousedown so blur doesn't fire first.
                  e.preventDefault();
                  commit(s);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors',
                  active
                    ? 'bg-sage-50 dark:bg-ink-700'
                    : 'hover:bg-sage-50 dark:hover:bg-ink-700',
                )}
              >
                {s.kind === 'recipe' ? (
                  <DishIcon recipe={s.emoji} size={15} className="shrink-0 text-sage-600 dark:text-sage-400" />
                ) : (
                  <Icon size={14} className={clsx('shrink-0', color)} />
                )}
                <span className="flex-1 truncate text-sage-800 dark:text-cream-50 font-semibold">
                  {highlightMatch(s.label, value)}
                </span>
                <span
                  className={clsx(
                    'text-[10px] uppercase tracking-wider font-bold',
                    color,
                  )}
                >
                  {LABEL_FOR[s.kind]}
                </span>
              </li>
            );
          })}
          <li className="px-3 py-1.5 text-[10px] text-sage-400 dark:text-ink-400 border-t border-sage-100 dark:border-ink-700 mt-1 flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-cream-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200 font-mono text-[10px]">↑↓</kbd>
            navigate
            <kbd className="px-1.5 py-0.5 rounded bg-cream-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200 font-mono text-[10px]">↵</kbd>
            select
            <kbd className="px-1.5 py-0.5 rounded bg-cream-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200 font-mono text-[10px]">Esc</kbd>
            close
          </li>
        </ul>
      )}
    </div>
  );
}

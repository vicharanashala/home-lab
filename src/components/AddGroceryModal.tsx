import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { CATEGORY_LIST, getCategory } from '../utils/categories';
import { ShoppingCart, Plus, Check, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { CategoryIcon } from './icons/AppIcons';
import type { CategoryId, GroceryItem } from '../types';
import clsx from 'clsx';
import { suggestCategory } from '../utils/categorySuggest';
import { AutocompleteInput, type Suggestion } from './AutocompleteInput';
import { COMMON_ITEMS } from '../utils/commonItems';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill category (e.g. when launching from "Add low-stock" on Alerts page) */
  defaultCategory?: CategoryId;
  /** Pre-fill the name (e.g. when adding "Tomatoes" from alerts) */
  defaultName?: string;
  /** Pre-fill quantity */
  defaultQuantity?: string;
  /** Called with the freshly created grocery item id */
  onCreated?: (id: string) => void;
}

export function AddGroceryModal({
  open,
  onClose,
  defaultCategory = 'other',
  defaultName = '',
  defaultQuantity = '',
  onCreated,
}: Props) {
  const { addGrocery, toast, grocery } = useStore();
  const [name, setName] = useState(defaultName);
  const [quantity, setQuantity] = useState(defaultQuantity);
  const [category, setCategory] = useState<CategoryId>(defaultCategory);
  const [touched, setTouched] = useState(false);
  /** When set, the modal shows a success confirmation view instead of the form. */
  const [justAdded, setJustAdded] = useState<GroceryItem | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;
  const guess = suggestCategory(trimmed);

  // Suggestions: common items for this category + existing items on the list.
  // Deduplicated by name so the dropdown stays clean. Grocery doesn't
  // distinguish fridge vs pantry — both kinds of items go on the same list.
  const grocerySuggestions: Suggestion[] = useMemo(() => {
    const commonList =
      category === 'other'
        ? []
        : (COMMON_ITEMS[category] ?? []).map((it) => ({
            kind: 'quick' as const,
            label: it.name,
          }));
    const existingList =
      category === 'other'
        ? grocery
        : grocery.filter((g) => g.category === category);
    const existing = existingList.map((g) => ({
      kind: 'grocery' as const,
      label: g.name,
      emoji: getCategory(g.category).emoji,
    }));
    const merged = [...commonList, ...existing];
    const seen = new Set<string>();
    return merged.filter((s) => {
      const k = s.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [grocery, category]);

  const handlePickSuggestion = (s: Suggestion) => {
    if (s.kind !== 'grocery') return;
    // If a matching item exists on the list, pre-fill the last-used quantity.
    const existing = grocery.find(
      (g) => g.name.toLowerCase() === s.label.toLowerCase(),
    );
    if (existing?.quantity) setQuantity(existing.quantity);
  };

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setQuantity(defaultQuantity);
      const initialCategory =
        defaultCategory && defaultCategory !== 'other'
          ? defaultCategory
          : suggestCategory(defaultName || '');
      setCategory(initialCategory);
      setTouched(false);
      setJustAdded(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName, defaultQuantity, defaultCategory]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) {
      setTouched(true);
      return;
    }
    const item = addGrocery({ name: trimmed, quantity, category });
    toast(`Added “${item.name}” to grocery list`, 'success');
    onCreated?.(item.id);
    setJustAdded(item);
  };

  const resetForm = () => {
    setName('');
    setQuantity('');
    setCategory(category); // keep the user's last category for rapid re-entry
    setTouched(false);
  };

  const footer = justAdded ? null : (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onClose} className="btn-secondary flex-1">
        Cancel
      </button>
      <button
        type="submit"
        form="add-grocery-form"
        disabled={!canSubmit}
        className="btn-primary flex-1 disabled:opacity-50"
      >
        <ShoppingCart size={18} />
        Add to list
        <Plus size={16} />
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={justAdded ? 'Item added' : 'Add to grocery list'}
      fullBleed
      footer={footer}
    >
      {justAdded ? (
        <SuccessView
          item={justAdded}
          onDone={onClose}
          onAddAnother={() => {
            resetForm();
            setJustAdded(null);
          }}
        />
      ) : (
        <form id="add-grocery-form" onSubmit={submit} className="space-y-4 pt-2">
          <div>
            <label className="label" htmlFor="grocery-name">
              Item name
            </label>
            <AutocompleteInput
              id="grocery-name"
              value={name}
              onChange={(v) => {
                setName(v);
                if (category === 'other' || category === guess) {
                  const guess2 = suggestCategory(v);
                  if (guess2 !== category) setCategory(guess2);
                }
              }}
              suggestions={grocerySuggestions}
              onPick={handlePickSuggestion}
              placeholder={
                category === 'other'
                  ? 'e.g. Tomatoes'
                  : `Add another ${getCategory(category).label.toLowerCase()} item`
              }
              className="input"
            />
            {touched && !canSubmit && (
              <p className="mt-1 text-xs text-tomato-600">Please enter an item name.</p>
            )}
            {category !== 'other' && grocerySuggestions.length > 0 && (
              <p className="mt-1 text-[11px] text-sage-500 dark:text-ink-300">
                {grocerySuggestions.length} {getCategory(category).label.toLowerCase()} item{grocerySuggestions.length === 1 ? '' : 's'} on your list — start typing to reuse one.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="grocery-qty">
              Quantity
            </label>
            <input
              id="grocery-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 2 packets, 1 kg"
              className="input"
              inputMode="text"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label">Category</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {CATEGORY_LIST.map((c) => {
                const active = c.id === category;
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={clsx(
                      'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold border transition-all active:scale-95',
                      active
                        ? `${c.color} border-transparent ring-2 ring-offset-1 ${c.ring}`
                        : 'bg-white dark:bg-ink-800 text-sage-600 dark:text-sage-300 border-sage-100 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                    )}
                  >
                    <CategoryIcon id={c.id} size={18} />
                    <span className="truncate w-full text-center">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SuccessView({
  item,
  onDone,
  onAddAnother,
}: {
  item: GroceryItem;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  const cat = getCategory(item.category);
  return (
    <div className="py-2 animate-scale-in">
      <div className="flex flex-col items-center text-center pt-3 pb-5">
        <div className="relative mb-4">
          <div className="absolute inset-0 rounded-full bg-sage-200 animate-ping opacity-40" />
          <div className="relative w-20 h-20 rounded-full bg-sage-100 grid place-items-center shadow-soft">
            <Check size={42} className="text-sage-700" strokeWidth={3} />
          </div>
        </div>
        <h3 className="font-display text-2xl font-extrabold text-sage-900 dark:text-cream-50">
          Item added!
        </h3>
        <p className="text-sage-600 mt-1 text-sm">
          <span className="font-semibold text-sage-800 dark:text-cream-100">{item.name}</span> is on your grocery list.
        </p>
      </div>

      <div className="card p-4 mb-4 flex items-center gap-3">
        <span
          className={clsx(
            'inline-flex items-center justify-center w-12 h-12 rounded-xl text-2xl shrink-0',
            cat.color,
          )}
        >
          <CategoryIcon id={cat.id} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sage-900 dark:text-cream-50 truncate">{item.name}</div>
          <div className="text-xs text-sage-500 mt-0.5 truncate">
            {item.quantity && (
              <>
                <span className="font-semibold text-sage-700">{item.quantity}</span>
                {' · '}
              </>
            )}
            {cat.label}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onDone} className="btn-secondary flex-1">
          Done
        </button>
        <button onClick={onAddAnother} className="btn-primary flex-1">
          <Sparkles size={16} />
          Add another
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Minus, Plus, Pencil, Trash2, AlertTriangle, Calendar, Archive, Refrigerator, ShoppingCart } from 'lucide-react';
import clsx from 'clsx';
import type { StockItem } from '../types';
import { getCategory } from '../utils/categories';
import { CategoryIcon } from './icons/AppIcons';
import { useStore } from '../store/useStore';
import { daysUntil, expiryBucket, formatExpiry, formatQuantity } from '../utils/date';
import { groceryQuantityForStock } from '../utils/groceryQuantity';
import { conflictsDiet, detectAllergensInName } from '../utils/diet';
import { ConfirmModal } from './ConfirmModal';
import { hapticSelect, hapticDanger } from '../utils/haptics';

interface Props {
  item: StockItem;
  /** Compact view used in dashboards */
  compact?: boolean;
  showActions?: boolean;
  onEdit?: (item: StockItem) => void;
}

export function StockRow({ item, compact, showActions = true, onEdit }: Props) {
  const { incrementStock, removeStock, toast, settings, grocery, addGrocery } = useStore();
  const [bumpKey, setBumpKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cat = getCategory(item.category);

  const days = daysUntil(item.expiryDate);
  // WHY THE HOUSEHOLD'S WINDOW: the row is drawn by the Stock screen and the
  // Dashboard, and both of them decide what is expiring with
  // `settings.expiringSoonDays`. This asked for the bucket with no window at
  // all, so it got the default of three days while every screen around it
  // used the household's — a household that widened the window to a week saw
  // "5 items expiring within 7 days" on the Alerts screen and a row beside it
  // reading "Nov 2, 2026", the plain date, because three days was what this
  // row asked about. One question, one window.
  const bucket = expiryBucket(item.expiryDate, settings.expiringSoonDays);
  const isLow = item.quantity <= item.lowStockThreshold;

  const dietConflict = conflictsDiet(item, settings.dietaryPreference);
  const allergenHits = detectAllergensInName(item.name, settings.allergies);
  const showDietWarn = settings.dietaryPreference !== 'no-preference' && dietConflict;
  const showAllergenWarn = allergenHits.length > 0;

  /** Already on the open list? Then the button has nothing to add. */
  const onGrocery = grocery.some(
    (g) => !g.purchased && g.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
  );

  /**
   * Put this item on the shopping list without hunting for it. Seeds a
   * sensible quantity — roughly what you'd buy to replace what's on hand, so
   * the list says "2 kg" rather than a bare name.
   *
   * WHY THE QUANTITY COMES FROM THE SHARED RULE: the Alerts screen seeds the
   * same grocery line for the same item, and the shopping list is one list.
   * Two screens writing the same kind of line must write it the same way, and
   * this one used not to: it spelled the unit into a template of its own,
   * which said "1 pcs" where the Alerts screen said "1 pc" — and which left a
   * trailing space where the unit should have been for an item that has no
   * unit at all. "pcs" is the default unit for a new item and a threshold of
   * zero is the default threshold, so "1 pcs" was what the list usually said.
   * The rule that decides the amount now lives in one place:
   * `groceryQuantityForStock`.
   */
  const addToGrocery = () => {
    addGrocery({
      name: item.name,
      // WHY THE SHARED RULE AND NOT A ROUNDING OF ITS OWN: the Alerts
      // screen writes the same line for the same item, and the shopping list
      // is one list. This used to round the threshold up — so a household
      // that set "low at 2.5 kg" got "3 kg" from this row and "2.5 kg" from
      // the Alerts screen, for the same item on the same list. The rule
      // that decides the amount is now one rule, in one place.
      quantity: groceryQuantityForStock(item),
      category: item.category,
    });
    toast(`Added ${item.name} to your list`, 'success');
  };

  const expiryChip = (() => {
    if (bucket === 'expired') {
      return (
        <span className="chip bg-tomato-100 text-tomato-700">
          <AlertTriangle size={12} /> Expired
        </span>
      );
    }
    if (bucket === 'soon') {
      return (
        <span className="chip bg-butter-100 text-butter-800">
          <Calendar size={12} />
          {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
        </span>
      );
    }
    if (bucket === 'ok') {
      return (
        <span className="chip bg-sage-100 text-sage-700">
          <Calendar size={12} />
          {formatExpiry(item.expiryDate)}
        </span>
      );
    }
    return null;
  })();

  return (
    <div
      className={clsx(
        'flex items-center gap-3 py-3 px-1',
        isLow && 'bg-tomato-50/40 -mx-1 px-2 rounded-xl',
      )}
    >
      <span
        className={clsx(
          'inline-flex items-center justify-center rounded-lg shrink-0',
          cat.color,
          compact ? 'w-9 h-9 text-lg' : 'w-11 h-11 text-xl',
        )}
      >
        <CategoryIcon id={cat.id} size={compact ? 16 : 18} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sage-900 dark:text-cream-50 truncate">{item.name}</span>
          {(item.location ?? 'fridge') === 'pantry' && (
            <span
              className="chip bg-butter-100 dark:bg-butter-900/30 text-butter-800 dark:text-butter-200"
              title="Stored in pantry"
            >
              <Archive size={11} />
              Pantry
            </span>
          )}
          {(item.location ?? 'fridge') === 'fridge' && !compact && (
            <span
              className="chip bg-sage-50 dark:bg-sage-900/30 text-sage-700 dark:text-sage-300"
              title="Stored in fridge"
            >
              <Refrigerator size={11} />
              Fridge
            </span>
          )}
          {isLow && (
            <span className="chip bg-tomato-100 text-tomato-700">
              <AlertTriangle size={12} />
              Low
            </span>
          )}
          {expiryChip}
          {showDietWarn && (
            <span className="chip bg-tomato-50 text-tomato-700" title="Doesn't match your dietary preference">
              <AlertTriangle size={11} />
              Diet
            </span>
          )}
          {showAllergenWarn && (
            <span
              className="chip bg-tomato-100 text-tomato-700"
              title={`May contain: ${allergenHits.join(', ')}`}
            >
              <AlertTriangle size={11} />
              {allergenHits[0]}{allergenHits.length > 1 ? ` +${allergenHits.length - 1}` : ''}
            </span>
          )}
        </div>
        <div className="text-xs text-sage-500 mt-1 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sage-700">
            {formatQuantity(item.quantity, item.unit)}
          </span>
          <span className="text-sage-300">·</span>
          <span>{cat.label}</span>
          {!compact && item.notes && (
            <>
              <span className="text-sage-300">·</span>
              <span className="truncate">{item.notes}</span>
            </>
          )}
        </div>
      </div>

      {showActions && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              hapticSelect();
              incrementStock(item.id, -1);
              setBumpKey((k) => k + 1);
              toast(`Used ${formatQuantity(1, item.unit)} of ${item.name}`, 'info');
            }}
            disabled={item.quantity <= 0}
            aria-label="Decrease quantity"
            className="btn-icon bg-sage-50 text-sage-700 hover:bg-sage-100 disabled:opacity-40"
          >
            <Minus size={16} />
          </button>
          <span
            key={bumpKey}
            className="min-w-[28px] text-center font-bold text-sage-900 dark:text-cream-50 tabular-nums animate-wiggle-once"
          >
            {item.quantity}
          </span>
          <button
            onClick={() => {
              hapticSelect();
              incrementStock(item.id, 1);
              setBumpKey((k) => k + 1);
              // WHY THE QUANTITY IS WRITTEN BY THE APP'S OWN RULE: this toast
              // and the quantity printed beside these buttons are two answers
              // to one question, and the rule that answers it — `formatQuantity`
              // — already exists. The toast used to build its own phrase with
              // the unit spliced into a template, so an item with NO unit left
              // a hole where the unit should have been:
              //
              //     the quantity beside the buttons says   "2"
              //     the toast after tapping "+" says       "Added 1  of Milk"
              //
              // Two spaces where a word should be, in the one line the person
              // reads back as proof the tap did what they meant. The unit
              // field is free text and nothing checks it, so an item with no
              // unit is one field-clearing away.
              toast(`Added ${formatQuantity(1, item.unit)} of ${item.name}`, 'success');
            }}
            aria-label="Increase quantity"
            className="btn-icon bg-sage-50 text-sage-700 hover:bg-sage-100"
          >
            <Plus size={16} />
          </button>
          {/* Most useful when something is low or about to expire — that's
              exactly when you want it on the list rather than in the fridge. */}
          {!compact && !onGrocery && (
            <button
              onClick={addToGrocery}
              aria-label={`Add ${item.name} to grocery list`}
              title="Add to grocery list"
              className="btn-icon bg-sage-50 text-sage-700 hover:bg-sage-100"
            >
              <ShoppingCart size={16} />
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              aria-label={`Edit ${item.name}`}
              className="btn-icon text-sage-400 hover:text-sage-700 hover:bg-sage-50"
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            onClick={() => {
              hapticSelect();
              setConfirmDelete(true);
            }}
            aria-label={`Remove ${item.name}`}
            className="btn-icon text-sage-300 hover:text-tomato-600 hover:bg-tomato-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          hapticDanger();
          // The store raises its own toast with an Undo action — don't
          // raise a second one here or the user sees the message twice.
          removeStock(item.id);
        }}
        title="Remove from kitchen?"
        message={`This will permanently remove “${item.name}” from your kitchen stock.`}
        confirmLabel="Remove"
      />
    </div>
  );
}

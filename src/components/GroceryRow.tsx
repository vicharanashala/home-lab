import { useState } from 'react';
import { Check, Trash2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { GroceryItem } from '../types';
import { getCategory } from '../utils/categories';
import { CategoryIcon } from './icons/AppIcons';
import { useStore } from '../store/useStore';
import { conflictsDiet, detectAllergensInName } from '../utils/diet';
import { hapticSelect, hapticDanger } from '../utils/haptics';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  item: GroceryItem;
}

export function GroceryRow({ item }: Props) {
  const { toggleGroceryPurchased, removeGrocery, toast, settings } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cat = getCategory(item.category);
  const dietConflict = conflictsDiet(item, settings.dietaryPreference);
  const allergenHits = detectAllergensInName(item.name, settings.allergies);
  const showDietWarn = settings.dietaryPreference !== 'no-preference' && dietConflict;
  const showAllergenWarn = allergenHits.length > 0;

  return (
    <div
      className={clsx(
        'flex items-center gap-3 py-3 px-1 transition-all',
        item.purchased && 'opacity-60',
      )}
    >
      <button
        onClick={() => {
          toggleGroceryPurchased(item.id);
          toast(
            item.purchased ? `Restored “${item.name}”` : `Marked “${item.name}” as bought`,
            'success',
          );
        }}
        aria-label={item.purchased ? 'Mark as not purchased' : 'Mark as purchased'}
        className={clsx(
          'shrink-0 w-7 h-7 rounded-full border-2 grid place-items-center transition-all active:scale-90',
          item.purchased
            ? 'bg-sage-600 border-sage-600 text-white'
            : 'border-sage-300 hover:border-sage-500 bg-white dark:bg-ink-700',
        )}
      >
        {item.purchased && <Check size={16} strokeWidth={3} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={clsx(
              'inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm shrink-0',
              cat.color,
            )}
          >
            <CategoryIcon id={cat.id} size={16} />
          </span>
          <span
            className={clsx(
              'font-semibold text-sage-900 dark:text-cream-50 truncate',
              item.purchased && 'line-through text-sage-500',
            )}
          >
            {item.name}
          </span>
          {showDietWarn && (
            <span
              className="chip bg-tomato-50 text-tomato-700"
              title="Doesn't match your dietary preference"
              aria-label="Doesn't match your dietary preference"
            >
              <AlertTriangle size={11} />
              Diet
            </span>
          )}
          {showAllergenWarn && (
            <span
              className="chip bg-tomato-100 text-tomato-700"
              title={`May contain: ${allergenHits.join(', ')}`}
              aria-label={`May contain: ${allergenHits.join(', ')}`}
            >
              <AlertTriangle size={11} />
              {allergenHits[0]}{allergenHits.length > 1 ? ` +${allergenHits.length - 1}` : ''}
            </span>
          )}
        </div>
        {item.quantity && (
          <div className="text-xs text-sage-500 mt-0.5 ml-9 truncate">
            {item.quantity} · <span className="text-sage-400">{cat.label}</span>
          </div>
        )}
      </div>

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

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          hapticDanger();
          // The store raises its own toast with an Undo action — don't
          // raise a second one here or the user sees the message twice.
          removeGrocery(item.id);
        }}
        title="Remove from grocery list?"
        message={`This will permanently remove “${item.name}” from your grocery list.`}
        confirmLabel="Remove"
      />
    </div>
  );
}

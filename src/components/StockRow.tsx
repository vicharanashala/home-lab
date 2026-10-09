import { useState } from 'react';
import { Minus, Plus, Pencil, Trash2, AlertTriangle, Calendar, Archive, Refrigerator } from 'lucide-react';
import clsx from 'clsx';
import type { StockItem } from '../types';
import { getCategory } from '../utils/categories';
import { CategoryIcon } from './icons/AppIcons';
import { useStore } from '../store/useStore';
import { daysUntil, expiryBucket, formatExpiry, formatQuantity } from '../utils/date';
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
  const { incrementStock, removeStock, toast, settings } = useStore();
  const [bumpKey, setBumpKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cat = getCategory(item.category);

  const days = daysUntil(item.expiryDate);
  const bucket = expiryBucket(item.expiryDate);
  const isLow = item.quantity <= item.lowStockThreshold;

  const dietConflict = conflictsDiet(item, settings.dietaryPreference);
  const allergenHits = detectAllergensInName(item.name, settings.allergies);
  const showDietWarn = settings.dietaryPreference !== 'no-preference' && dietConflict;
  const showAllergenWarn = allergenHits.length > 0;

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
              toast(`Used 1 ${item.unit.replace(/s$/, '') || ''} of ${item.name}`.trim(), 'info');
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
              toast(`Added 1 ${item.unit.replace(/s$/, '') || ''} of ${item.name}`.trim(), 'success');
            }}
            aria-label="Increase quantity"
            className="btn-icon bg-sage-50 text-sage-700 hover:bg-sage-100"
          >
            <Plus size={16} />
          </button>
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

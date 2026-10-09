import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { CATEGORY_LIST } from '../utils/categories';
import { Refrigerator, Plus, Calendar, FileText, Archive } from 'lucide-react';
import { useStore } from '../store/useStore';
import { CategoryIcon } from './icons/AppIcons';
import type { CategoryId, StockItem, StockLocation } from '../types';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
  item: StockItem;
}

const COMMON_UNITS = ['pcs', 'packets', 'kg', 'g', 'L', 'ml', 'dozen', 'bunch', 'bottles'];

export function EditStockModal({ open, onClose, item }: Props) {
  const { updateStock, toast } = useStore();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unit, setUnit] = useState(item.unit);
  const [category, setCategory] = useState<CategoryId>(item.category);
  const [location, setLocation] = useState<StockLocation>(item.location ?? 'fridge');
  const [expiryDate, setExpiryDate] = useState(item.expiryDate ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [threshold, setThreshold] = useState(item.lowStockThreshold);

  useEffect(() => {
    if (open) {
      setName(item.name);
      setQuantity(item.quantity);
      setUnit(item.unit);
      setCategory(item.category);
      setLocation(item.location ?? 'fridge');
      setExpiryDate(item.expiryDate ?? '');
      setNotes(item.notes ?? '');
      setThreshold(item.lowStockThreshold);
    }
  }, [open, item]);

  const canSubmit = name.trim().length > 0;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    updateStock(item.id, {
      name: name.trim(),
      quantity,
      unit,
      category,
      location,
      expiryDate: expiryDate || undefined,
      notes: notes.trim() || undefined,
      lowStockThreshold: threshold,
    });
    toast(`Updated “${name.trim()}”`, 'success');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit stock item" fullBleed>
      <form onSubmit={submit} className="space-y-4 pt-2">
        <div>
          <label className="label" htmlFor="edit-stock-name">Item name</label>
          <input
            id="edit-stock-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="edit-stock-qty">Quantity</label>
            <input
              id="edit-stock-qty"
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-stock-unit">Unit</label>
            <input
              id="edit-stock-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              list="unit-suggestions-edit"
              className="input"
            />
            <datalist id="unit-suggestions-edit">
              {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>
          </div>
        </div>

        {/* Location: fridge or pantry */}
        <div>
          <label className="label">Where do you keep it?</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLocation('fridge')}
              className={clsx(
                'flex items-center gap-2.5 rounded-2xl p-3.5 text-left border-2 transition-all active:scale-[.98]',
                location === 'fridge'
                  ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-cream-50 border-sage-300 dark:border-sage-700 ring-2 ring-sage-300 dark:ring-sage-700 ring-offset-1 dark:ring-offset-ink-800'
                  : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600',
              )}
            >
              <Refrigerator size={20} className="shrink-0" />
              <div>
                <div className="font-display font-bold text-sm leading-tight">Fridge</div>
                <div className="text-[11px] opacity-75 mt-0.5">Perishable, expires</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setLocation('pantry')}
              className={clsx(
                'flex items-center gap-2.5 rounded-2xl p-3.5 text-left border-2 transition-all active:scale-[.98]',
                location === 'pantry'
                  ? 'bg-butter-100 dark:bg-butter-900/40 text-butter-800 dark:text-butter-200 border-butter-300 dark:border-butter-700 ring-2 ring-butter-300 dark:ring-butter-700 ring-offset-1 dark:ring-offset-ink-800'
                  : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600',
              )}
            >
              <Archive size={20} className="shrink-0" />
              <div>
                <div className="font-display font-bold text-sm leading-tight">Pantry</div>
                <div className="text-[11px] opacity-75 mt-0.5">Dry storage, longer shelf life</div>
              </div>
            </button>
          </div>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="edit-stock-expiry">
              <Calendar size={14} className="inline mr-1" /> Expiry date
            </label>
            <input
              id="edit-stock-expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-stock-threshold">Low at</label>
            <input
              id="edit-stock-threshold"
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="edit-stock-notes">
            <FileText size={14} className="inline mr-1" /> Notes (optional)
          </label>
          <textarea
            id="edit-stock-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input min-h-[64px] resize-y"
          />
        </div>

        <div className="pt-2 flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1">
            <Refrigerator size={18} />
            Save
            <Plus size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

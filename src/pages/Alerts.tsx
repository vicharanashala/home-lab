import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { TopBar } from '../components/TopBar';
import { EmptyState } from '../components/EmptyState';
import {
  AlertTriangle,
  Calendar,
  Plus,
  ShoppingCart,
  Sparkles,
  CircleCheck,
  Snowflake,
} from 'lucide-react';
import clsx from 'clsx';
import { daysUntil, expiryBucket, formatQuantity } from '../utils/date';
import type { StockItem } from '../types';

export function AlertsPage() {
  const { stock, settings, updateSettings, addGrocery, toast } = useStore();

  const [soonDays, setSoonDays] = useState(settings.expiringSoonDays);

  const lowStock = useMemo(() => {
    return [...stock]
      .filter((it) => it.quantity <= it.lowStockThreshold)
      .sort((a, b) => a.quantity / Math.max(1, a.lowStockThreshold) - b.quantity / Math.max(1, b.lowStockThreshold));
  }, [stock]);

  const expiring = useMemo(() => {
    return [...stock]
      .filter((it) => {
        const b = expiryBucket(it.expiryDate, settings.expiringSoonDays);
        return b === 'expired' || b === 'soon';
      })
      .sort((a, b) => {
        const ad = daysUntil(a.expiryDate) ?? 999;
        const bd = daysUntil(b.expiryDate) ?? 999;
        return ad - bd;
      });
  }, [stock, settings.expiringSoonDays]);

  const expired = expiring.filter((it) => (daysUntil(it.expiryDate) ?? 0) < 0);
  const soon = expiring.filter((it) => (daysUntil(it.expiryDate) ?? 0) >= 0);

  const addToGrocery = (it: StockItem) => {
    const item = addGrocery({
      name: it.name,
      quantity: formatQuantity(Math.max(1, it.lowStockThreshold), it.unit) || '1',
      category: it.category,
    });
    toast(`Added “${it.name}” to grocery list`, 'success');
    return item;
  };

  const addAllLow = () => {
    let n = 0;
    for (const it of lowStock) {
      addGrocery({
        name: it.name,
        quantity: formatQuantity(Math.max(1, it.lowStockThreshold), it.unit) || '1',
        category: it.category,
      });
      n += 1;
    }
    toast(`Added ${n} item${n === 1 ? '' : 's'} to grocery list`, 'success');
  };

  const totalAlerts = lowStock.length + expiring.length;

  return (
    <>
      <TopBar
        title="Alerts"
        subtitle={
          totalAlerts === 0
            ? 'All clear — nothing needs attention'
            : `${totalAlerts} item${totalAlerts === 1 ? '' : 's'} need attention`
        }
      />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-4 space-y-5">
        {/* Settings card */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <Calendar size={16} />
            </span>
            <div className="flex-1">
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                Expiry alert window
              </h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                How many days before expiry an item should be flagged.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={14}
              value={soonDays}
              onChange={(e) => setSoonDays(Number(e.target.value))}
              onMouseUp={() => updateSettings({ expiringSoonDays: soonDays })}
              onTouchEnd={() => updateSettings({ expiringSoonDays: soonDays })}
              onKeyUp={() => updateSettings({ expiringSoonDays: soonDays })}
              onBlur={() => updateSettings({ expiringSoonDays: soonDays })}
              className="flex-1 accent-sage-600"
            />
            <div className="rounded-xl bg-sage-100 dark:bg-ink-700 text-sage-800 dark:text-cream-50 font-bold px-3 py-1.5 min-w-[64px] text-center">
              {soonDays} days
            </div>
          </div>
        </section>

        {/* Low stock */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-tomato-50 text-tomato-600 grid place-items-center">
                <AlertTriangle size={16} />
              </span>
              <div>
                <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Running low</h3>
                <p className="text-xs text-sage-500 dark:text-ink-300">
                  {lowStock.length === 0
                    ? 'All items are well stocked'
                    : `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} below your threshold`}
                </p>
              </div>
            </div>
            {lowStock.length > 1 && (
              <button
                onClick={addAllLow}
                className="text-xs font-semibold text-white bg-sage-700 hover:bg-sage-800 rounded-full px-3 py-2 inline-flex items-center gap-1.5 shadow-soft"
              >
                <Sparkles size={14} />
                Add all to grocery
              </button>
            )}
          </div>

          {lowStock.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              title="Nothing running low"
              hint="Items appear here when their quantity drops to or below the threshold you set."
            />
          ) : (
            <div className="card p-2 px-4">
              <ul className="divide-y divide-sage-100">
                {lowStock.map((it) => {
                  const ratio = it.lowStockThreshold === 0 ? 0 : it.quantity / it.lowStockThreshold;
                  return (
                    <li key={it.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 w-10 h-10 rounded-xl bg-tomato-50 dark:bg-tomato-900/40 text-tomato-700 dark:text-tomato-300 grid place-items-center font-bold">
                          {it.quantity}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sage-900 dark:text-cream-50 truncate">
                            {it.name}
                          </div>
                          <div className="text-xs text-sage-500 mt-0.5">
                            Threshold {it.lowStockThreshold} ·{' '}
                            <span className="text-tomato-700 font-semibold">
                              {ratio <= 0 ? 'Out of stock' : `${Math.round(ratio * 100)}% remaining`}
                            </span>
                          </div>
                          {/* progress bar */}
                          <div className="mt-2 h-1.5 rounded-full bg-sage-100 overflow-hidden">
                            <div
                              className={clsx(
                                'h-full rounded-full transition-all',
                                ratio <= 0.25 ? 'bg-tomato-500' : ratio <= 0.6 ? 'bg-butter-500' : 'bg-sage-500',
                              )}
                              style={{ width: `${Math.min(100, Math.max(4, ratio * 100))}%` }}
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => addToGrocery(it)}
                          className="btn-secondary !py-2 !px-3 text-xs shrink-0"
                          aria-label={`Add ${it.name} to grocery list`}
                        >
                          <ShoppingCart size={14} />
                          <span className="hidden sm:inline">Add to list</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Expiring soon */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <span className="w-8 h-8 rounded-xl bg-butter-100 text-butter-700 grid place-items-center">
              <Calendar size={16} />
            </span>
            <div>
              <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Expiring soon</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                {expiring.length === 0
                  ? `Nothing expiring in the next ${settings.expiringSoonDays} days`
                  : `${expiring.length} item${expiring.length === 1 ? '' : 's'} need attention`}
              </p>
            </div>
          </div>

          {expiring.length === 0 ? (
            <EmptyState
              icon={Snowflake}
              title="Nothing expiring soon"
              hint="Set expiry dates on stock items to get timely alerts here."
            />
          ) : (
            <div className="space-y-3">
              {expired.length > 0 && (
                <div className="card p-2 px-4 border border-tomato-200/60">
                  <div className="flex items-center gap-2 py-2">
                    <span className="w-7 h-7 rounded-lg bg-tomato-100 text-tomato-700 grid place-items-center">
                      <AlertTriangle size={14} />
                    </span>
                    <h4 className="font-display font-bold text-sm text-tomato-700">
                      Expired ({expired.length})
                    </h4>
                  </div>
                  <ul className="divide-y divide-sage-100">
                    {expired.map((it) => {
                      const days = daysUntil(it.expiryDate) ?? 0;
                      return (
                        <li key={it.id}>
                          <ExpiryRow
                            item={it}
                            label={days === 0 ? 'Today' : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`}
                            tone="expired"
                            onAdd={() => addToGrocery(it)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {soon.length > 0 && (
                <div className="card p-2 px-4 border border-butter-200/60">
                  <div className="flex items-center gap-2 py-2">
                    <span className="w-7 h-7 rounded-lg bg-butter-100 text-butter-800 grid place-items-center">
                      <Calendar size={14} />
                    </span>
                    <h4 className="font-display font-bold text-sm text-butter-800">
                      Within {settings.expiringSoonDays} days ({soon.length})
                    </h4>
                  </div>
                  <ul className="divide-y divide-sage-100">
                    {soon.map((it) => {
                      const days = daysUntil(it.expiryDate) ?? 0;
                      return (
                        <li key={it.id}>
                          <ExpiryRow
                            item={it}
                            label={days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`}
                            tone="soon"
                            onAdd={() => addToGrocery(it)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Helpful tips */}
        <section className="card p-5 bg-gradient-to-br from-sage-50 to-butter-50 border-sage-200/50">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-white grid place-items-center text-sage-700 shrink-0 shadow-card">
              <Sparkles size={16} />
            </span>
            <div>
              <h4 className="font-display font-bold text-sm text-sage-900">Tip</h4>
              <p className="text-sm text-sage-700 mt-1 leading-relaxed">
                Use “Add to list” to quickly top up low or expiring items. Adjust each
                item's low-stock threshold in <strong>Stock</strong> to fine-tune when
                you get reminded.
              </p>
            </div>
          </div>
        </section>

        <div className="h-4" />
      </div>
    </>
  );
}

function ExpiryRow({
  item,
  label,
  tone,
  onAdd,
}: {
  item: StockItem;
  label: string;
  tone: 'expired' | 'soon';
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sage-900 dark:text-cream-50 truncate">{item.name}</div>
        <div className="text-xs text-sage-500 mt-0.5">
          {formatQuantity(item.quantity, item.unit)} · Expires {label}
        </div>
      </div>
      <span
        className={clsx(
          'chip shrink-0',
          tone === 'expired' ? 'bg-tomato-100 text-tomato-700' : 'bg-butter-100 text-butter-800',
        )}
      >
        {tone === 'expired' ? <AlertTriangle size={12} /> : <Calendar size={12} />}
        {tone === 'expired' ? 'Expired' : 'Soon'}
      </span>
      <button
        onClick={onAdd}
        className="btn-secondary !py-2 !px-3 text-xs shrink-0"
        aria-label={`Add ${item.name} to grocery list`}
      >
        <ShoppingCart size={14} />
        <Plus size={12} />
      </button>
    </div>
  );
}

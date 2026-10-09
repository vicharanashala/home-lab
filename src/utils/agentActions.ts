/**
 * HouseBot agent actions.
 *
 * The bridge cannot write to the app's data — the kitchen lives in this
 * browser's localStorage. So the model proposes actions, the bridge
 * validates them, and this module applies them to the local store.
 *
 * Everything is re-validated here even though the bridge already checked it:
 * this is the last gate before someone's fridge, so an unrecognised action
 * or a bad field is dropped rather than guessed at. Unknown actions are
 * ignored, and nothing destructive is supported by design — an LLM misparse
 * should be able to add a wrong onion, never delete the shopping list.
 */

import type { CategoryId, StockItem } from '../types';
import type { UseStore } from '../store/useStore';

const CATEGORIES = new Set<string>([
  'vegetables', 'fruits', 'dairy', 'meat', 'seafood', 'bakery', 'grains',
  'beverages', 'snacks', 'frozen', 'condiments', 'household', 'other',
]);
const UNITS = new Set<string>(['pcs', 'kg', 'g', 'ml', 'l', 'packets', 'dozen']);
const FRIDGE_CATEGORIES = new Set([
  'vegetables', 'fruits', 'dairy', 'meat', 'seafood', 'frozen',
]);

// Defence in depth. The bridge already caps a batch at 12, but this is the
// last gate before the store, so it enforces its own limit — a runaway batch
// should not be able to write an unbounded number of items.
const MAX_ACTIONS_PER_BATCH = 12;

/** Loose match on an existing item name — the model rarely repeats our exact casing. */
function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    items.find((i) => i.name.trim().toLowerCase() === needle) ||
    items.find((i) => i.name.trim().toLowerCase().includes(needle)) ||
    items.find((i) => needle.includes(i.name.trim().toLowerCase()))
  );
}

const clean = (v: unknown, max = 60): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const asCategory = (v: unknown): CategoryId =>
  typeof v === 'string' && CATEGORIES.has(v) ? (v as CategoryId) : 'other';

const asQuantity = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : 0;
};

export interface AgentActionResult {
  applied: number;
  skipped: number;
  summary: string;
  /** Ids of stock items to flash/highlight so the user can see what changed. */
  touchedStockIds: string[];
  touchedGroceryIds: string[];
}

/**
 * Apply a batch of validated actions to the store.
 * Safe to call with an empty array — it just reports 0/0.
 */
export function applyAgentActions(
  actions: unknown,
  store: UseStore,
): AgentActionResult {
  const result: AgentActionResult = {
    applied: 0,
    skipped: 0,
    summary: '',
    touchedStockIds: [],
    touchedGroceryIds: [],
  };
  if (!Array.isArray(actions) || actions.length === 0) return result;

  // Anything past the cap is counted as skipped so the user still sees that
  // something was dropped rather than silently losing part of the request.
  const batch = actions.slice(0, MAX_ACTIONS_PER_BATCH);
  result.skipped += actions.length - batch.length;

  const done: string[] = [];

  for (const raw of batch) {
    if (!raw || typeof raw !== 'object') {
      result.skipped += 1;
      continue;
    }
    const a = raw as Record<string, unknown>;
    const type = typeof a.type === 'string' ? a.type : '';
    const name = clean(a.name);
    if (!name) {
      result.skipped += 1;
      continue;
    }

    try {
      switch (type) {
        case 'add_stock': {
          const quantity = asQuantity(a.quantity);
          if (!quantity) {
            result.skipped += 1;
            break;
          }
          const category = asCategory(a.category);
          const unitRaw = String(a.unit ?? '').toLowerCase();
          const unit = UNITS.has(unitRaw) ? unitRaw : 'pcs';
          const expiryDate =
            typeof a.expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.expiryDate)
              ? a.expiryDate
              : undefined;

          const created = store.addStock({
            name,
            quantity,
            unit,
            category,
            location:
              a.location === 'fridge' || a.location === 'pantry'
                ? a.location
                : FRIDGE_CATEGORIES.has(category)
                ? 'fridge'
                : 'pantry',
            ...(expiryDate ? { expiryDate } : {}),
            ...(a.notes ? { notes: clean(a.notes, 120) } : {}),
            lowStockThreshold: 0,
          } as Omit<StockItem, 'id' | 'createdAt' | 'updatedAt'>);

          result.touchedStockIds.push(created.id);
          result.applied += 1;
          done.push(`${quantity}${unit} ${name}`);
          break;
        }

        case 'add_grocery': {
          const item = store.addGrocery({
            name,
            quantity: clean(a.quantity, 40) || '1',
            category: asCategory(a.category),
          });
          result.touchedGroceryIds.push(item.id);
          result.applied += 1;
          done.push(`${name} → grocery`);
          break;
        }

        case 'check_grocery': {
          const target = findByName(store.grocery.filter((g) => !g.purchased), name);
          if (!target) {
            result.skipped += 1;
            break;
          }
          store.toggleGroceryPurchased(target.id);
          result.touchedGroceryIds.push(target.id);
          result.applied += 1;
          done.push(`${target.name} ✓ bought`);
          break;
        }

        case 'set_stock_quantity': {
          const target = findByName(store.stock, name);
          const quantity = Number(a.quantity);
          if (!target || !Number.isFinite(quantity) || quantity < 0) {
            result.skipped += 1;
            break;
          }
          store.updateStock(target.id, { quantity: Math.min(quantity, 10000) });
          result.touchedStockIds.push(target.id);
          result.applied += 1;
          done.push(`${target.name} → ${quantity}${target.unit}`);
          break;
        }

        default:
          // Unknown or destructive action — ignore it entirely.
          result.skipped += 1;
      }
    } catch {
      // A single bad action must never abort the rest of the batch.
      result.skipped += 1;
    }
  }

  result.summary = done.join(' · ');
  return result;
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  buildShoppingList, missingItems, countPlanned, countPlannedDays,
  TOTAL_SLOTS, TOTAL_DAYS, plannedDayLabels,
} from '../utils/portions';
import type { Recipe, ShoppingNeed } from '../types';

/** Lazily load the big parsed catalogue. Same pattern as Discover / MealPlan. */
export function useCsvRecipes(): Recipe[] | null {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/csvRecipes.json')
      .then((mod) => {
        if (!cancelled) setRecipes((mod.default || mod) as unknown as Recipe[]);
      })
      .catch(() => {
        /* catalogue is optional — built-in recipes still work without it */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return recipes;
}

export interface AutoGroceryResult {
  added: number;
  alreadyOnList: number;
  /** Nothing left to buy because the fridge already covers the plan. */
  coveredByStock: number;
}

/**
 * Generates the grocery list from the weekly meal plan: totals every ingredient
 * the planned recipes need (scaled by each dish's portion), subtracts what the
 * fridge already has, and adds only the shortfall to the list.
 *
 * Adding is additive and de-duplicated by name, so pressing it twice — or
 * after shopping a bit — tops the list up instead of duplicating it. Items
 * already ticked off as purchased are left alone.
 */
export function useAutoGrocery() {
  const { grocery, stock, recipes: builtIn, mealPlan, addGrocery } = useStore();
  const csvRecipes = useCsvRecipes();

  // The plan can reference any of the ~6k catalogue recipes, so the lookup set
  // has to include the lazily-loaded CSV catalogue, not just the built-ins.
  const catalogue = useMemo(() => {
    const byId = new Map<string, Recipe>();
    for (const r of builtIn) byId.set(r.id, r);
    for (const r of csvRecipes || []) if (!byId.has(r.id)) byId.set(r.id, r);
    return [...byId.values()];
  }, [builtIn, csvRecipes]);

  const needs = useMemo<ShoppingNeed[]>(
    () => buildShoppingList(mealPlan, catalogue, stock),
    [mealPlan, catalogue, stock],
  );
  const toBuy = useMemo(() => missingItems(needs), [needs]);

  const plannedCount = countPlanned(mealPlan);
  const plannedDays = countPlannedDays(mealPlan);
  const dayLabels = useMemo(() => plannedDayLabels(mealPlan), [mealPlan]);
  const hasPlan = plannedCount > 0;
  /** True once the plan has something worth shopping for. */
  const ready = hasPlan && toBuy.length > 0;

  const generate = useCallback((): AutoGroceryResult => {
    // Only consider still-open items — something already ticked off is done.
    const existing = new Set(
      grocery.filter((g) => !g.purchased).map((g) => g.name.trim().toLowerCase()),
    );
    let added = 0;
    let alreadyOnList = 0;
    for (const item of toBuy) {
      const key = item.name.trim().toLowerCase();
      if (existing.has(key)) {
        alreadyOnList += 1;
        continue;
      }
      addGrocery({
        name: item.name,
        quantity: `${item.needed}${item.unit}`,
        category: item.category,
      });
      existing.add(key);
      added += 1;
    }
    return { added, alreadyOnList, coveredByStock: needs.length - toBuy.length };
  }, [grocery, toBuy, needs, addGrocery]);

  return {
    needs,
    toBuy,
    generate,
    hasPlan,
    ready,
    plannedCount,
    plannedDays,
    dayLabels,
    totalSlots: TOTAL_SLOTS,
    totalDays: TOTAL_DAYS,
  };
}
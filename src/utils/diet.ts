import type { GroceryItem, StockItem } from '../types';
import { isCompatibleWithDiet } from './categories';
import type { DietaryPreference } from '../types';

/** Lightweight keyword map for common allergen detection. */
const ALLERGEN_KEYWORDS: Record<string, string[]> = {
  Gluten: ['bread', 'roti', 'naan', 'pasta', 'wheat', 'flour', 'biscuit', 'cookie', 'cake', 'toast', 'bun', 'semolina', 'rava', 'maida'],
  Dairy: ['milk', 'butter', 'cheese', 'yogurt', 'yoghurt', 'curd', 'paneer', 'cream', 'ghee', 'lassi', 'kefir'],
  Eggs: ['egg', 'omelette', 'omelet', 'mayo', 'mayonnaise'],
  Peanuts: ['peanut', 'groundnut', 'moongphali'],
  'Tree nuts': ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan'],
  Soy: ['soy', 'soya', 'tofu', 'edamame', 'soya sauce'],
  Shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'crayfish'],
  Sesame: ['sesame', 'til', 'tahini'],
  Fish: ['fish', 'salmon', 'tuna', 'cod', 'sardine', 'mackerel', 'rohu', 'pomfret'],
};

export const detectAllergensInName = (
  name: string,
  allergies: string[],
): string[] => {
  if (!name || allergies.length === 0) return [];
  const lower = name.toLowerCase();
  const hits: string[] = [];
  for (const allergy of allergies) {
    const keys = ALLERGEN_KEYWORDS[allergy];
    if (keys && keys.some((k) => lower.includes(k))) {
      hits.push(allergy);
      continue;
    }
    if (lower.includes(allergy.toLowerCase())) {
      hits.push(allergy);
    }
  }
  return Array.from(new Set(hits));
};

export const conflictsDiet = (
  item: { category: import('../types').CategoryId } | GroceryItem | StockItem,
  diet: DietaryPreference,
): boolean => !isCompatibleWithDiet(item.category, diet);

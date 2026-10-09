import type { Category, CategoryId } from '../types';

const ALL_DIETS = ['vegetarian', 'non-vegetarian', 'vegan', 'no-preference'] as const;
const VEG_NV = ['vegetarian', 'non-vegetarian', 'vegan', 'no-preference'] as const;
const VEG_VEGAN = ['vegetarian', 'vegan', 'no-preference'] as const;
const NV_ONLY = ['non-vegetarian', 'no-preference'] as const;

export const CATEGORIES: Record<CategoryId, Category> = {
  vegetables: {
    id: 'vegetables',
    label: 'Vegetables',
    emoji: '🥦',
    color: 'bg-sage-100 text-sage-800',
    ring: 'ring-sage-200',
    compatibleDiets: [...VEG_VEGAN],
  },
  fruits: {
    id: 'fruits',
    label: 'Fruits',
    emoji: '🍎',
    color: 'bg-tomato-100 text-tomato-700',
    ring: 'ring-tomato-200',
    compatibleDiets: [...VEG_VEGAN],
  },
  dairy: {
    id: 'dairy',
    label: 'Dairy',
    emoji: '🥛',
    color: 'bg-butter-50 text-butter-800',
    ring: 'ring-butter-200',
    compatibleDiets: ['vegetarian', 'no-preference'],
  },
  meat: {
    id: 'meat',
    label: 'Meat',
    emoji: '🍗',
    color: 'bg-tomato-100 text-tomato-800',
    ring: 'ring-tomato-200',
    compatibleDiets: [...NV_ONLY],
  },
  seafood: {
    id: 'seafood',
    label: 'Seafood',
    emoji: '🐟',
    color: 'bg-sage-100 text-sage-700',
    ring: 'ring-sage-200',
    compatibleDiets: [...NV_ONLY],
  },
  bakery: {
    id: 'bakery',
    label: 'Bakery',
    emoji: '🍞',
    color: 'bg-butter-100 text-butter-800',
    ring: 'ring-butter-200',
    compatibleDiets: [...VEG_NV],
  },
  grains: {
    id: 'grains',
    label: 'Grains',
    emoji: '🌾',
    color: 'bg-cream-100 text-butter-800',
    ring: 'ring-cream-200',
    compatibleDiets: [...VEG_VEGAN],
  },
  beverages: {
    id: 'beverages',
    label: 'Beverages',
    emoji: '🧃',
    color: 'bg-sage-100 text-sage-700',
    ring: 'ring-sage-200',
    compatibleDiets: [...VEG_VEGAN],
  },
  snacks: {
    id: 'snacks',
    label: 'Snacks',
    emoji: '🍪',
    color: 'bg-butter-50 text-butter-700',
    ring: 'ring-butter-200',
    compatibleDiets: [...VEG_NV],
  },
  frozen: {
    id: 'frozen',
    label: 'Frozen',
    emoji: '🧊',
    color: 'bg-sage-50 text-sage-700',
    ring: 'ring-sage-200',
    compatibleDiets: [...VEG_NV],
  },
  condiments: {
    id: 'condiments',
    label: 'Condiments',
    emoji: '🧴',
    color: 'bg-cream-100 text-butter-800',
    ring: 'ring-cream-200',
    compatibleDiets: [...VEG_VEGAN],
  },
  household: {
    id: 'household',
    label: 'Household',
    emoji: '🧺',
    color: 'bg-sage-50 text-sage-700',
    ring: 'ring-sage-200',
    compatibleDiets: [...ALL_DIETS],
  },
  other: {
    id: 'other',
    label: 'Other',
    emoji: '📦',
    color: 'bg-sage-50 text-sage-700',
    ring: 'ring-sage-200',
    compatibleDiets: [...ALL_DIETS],
  },
};

export const CATEGORY_LIST: Category[] = Object.values(CATEGORIES);

export const getCategory = (id: CategoryId): Category =>
  CATEGORIES[id] ?? CATEGORIES.other;

/** True when an item in this category is compatible with the given diet. */
export const isCompatibleWithDiet = (
  categoryId: CategoryId,
  diet: import('../types').DietaryPreference,
): boolean => {
  if (diet === 'no-preference') return true;
  return getCategory(categoryId).compatibleDiets.includes(diet);
};

/** Human-readable label for a dietary preference. */
export const dietLabel = (d: import('../types').DietaryPreference): string => {
  switch (d) {
    case 'vegetarian':
      return 'Vegetarian';
    case 'non-vegetarian':
      return 'Non-vegetarian';
    case 'vegan':
      return 'Vegan';
    case 'no-preference':
      return 'No preference';
  }
};

export const dietEmoji = (d: import('../types').DietaryPreference): string => {
  switch (d) {
    case 'vegetarian':
      return '🥗';
    case 'non-vegetarian':
      return '🍖';
    case 'vegan':
      return '🌿';
    case 'no-preference':
      return '🍽️';
  }
};

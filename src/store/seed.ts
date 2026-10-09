import type { AppState } from '../types';
import { STARTER_RECIPES } from '../data/recipes';

/**
 * Fresh-install state. Both the fridge and the grocery list start empty —
 * the user adds items themselves. Built-in recipes are seeded so the Log
 * a meal modal has something to pick from on day one.
 */
export const seedState = (): AppState => ({
  grocery: [],
  stock: [],
  mealLogs: [],
  recipes: STARTER_RECIPES,
  settings: {
    expiringSoonDays: 3,
    hasSeenWelcome: false,
    userName: '',
    dietaryPreference: 'no-preference',
    allergies: [],
    theme: 'system',
  },
});

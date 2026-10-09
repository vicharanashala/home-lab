/**
 * Indian recipe catalog — ~120 common dishes with rough ingredients for 2 people.
 *
 * This is a starter set, not exhaustive. The user can search by name (Hindi
 * or English) and the End-of-Day modal shows matches. Quantities are
 * household estimates — accurate enough for tracking fridge usage, not for
 * nutrition labelling. Add more recipes over time in `src/data/indianRecipes.ts`
 * or via the in-app recipe editor.
 *
 * Categories: breakfast | lunch | dinner | snack | sweet
 */

import type { Recipe } from '../types';

type IndianRecipe = Omit<Recipe, 'builtIn'>;

const r = (
  id: string,
  name: string,
  emoji: string,
  mealType: Recipe['mealType'],
  ingredients: Array<[string, number, string]>,
): IndianRecipe => ({
  id,
  name,
  emoji,
  mealType,
  baseServings: 2,
  ingredients: ingredients.map(([name, quantity, unit]) => ({
    name,
    quantity,
    unit,
    category: 'other' as const,
  })),
});

export const INDIAN_RECIPES: IndianRecipe[] = [
  // ───────────────────────── North Indian mains ─────────────────────────
  r('in-dal-makhani', 'Dal makhani', '🍛', 'dinner', [
    ['Black dal (urad)', 150, 'g'], ['Rajma', 50, 'g'], ['Butter', 40, 'g'],
    ['Cream', 60, 'ml'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Garlic', 5, 'pcs'], ['Ginger', 1, 'pcs'], ['Ghee', 15, 'g'],
  ]),
  r('in-dal-tadka', 'Dal tadka', '🍛', 'lunch', [
    ['Toor dal', 150, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Ginger', 1, 'pcs'], ['Ghee', 15, 'g'],
    ['Cumin seeds', 1, 'tsp'], ['Green chili', 2, 'pcs'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-chole', 'Chole (chickpea curry)', '🍛', 'lunch', [
    ['Chickpeas', 200, 'g'], ['Onion', 2, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 4, 'pcs'], ['Ghee', 20, 'g'],
    ['Chole masala', 1, 'tbsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-rajma', 'Rajma', '🫘', 'lunch', [
    ['Kidney beans (rajma)', 200, 'g'], ['Onion', 2, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 4, 'pcs'], ['Ghee', 20, 'g'],
    ['Rajma masala', 1, 'tbsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-palak-paneer', 'Palak paneer', '🥬', 'dinner', [
    ['Spinach', 250, 'g'], ['Paneer', 200, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Garlic', 4, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Butter', 30, 'g'], ['Cream', 50, 'ml'],
  ]),
  r('in-paneer-butter-masala', 'Paneer butter masala', '🧀', 'dinner', [
    ['Paneer', 250, 'g'], ['Butter', 40, 'g'], ['Cream', 60, 'ml'],
    ['Onion', 1, 'pcs'], ['Tomato', 3, 'pcs'], ['Cashew', 20, 'g'],
    ['Garlic', 3, 'pcs'], ['Ginger', 1, 'pcs'], ['Kashmiri chili', 1, 'tsp'],
  ]),
  r('in-kadhai-paneer', 'Kadhai paneer', '🫑', 'dinner', [
    ['Paneer', 200, 'g'], ['Capsicum', 2, 'pcs'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Kadhai masala', 1, 'tbsp'], ['Cream', 30, 'ml'],
    ['Ghee', 15, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-matar-paneer', 'Matar paneer', '🌱', 'dinner', [
    ['Paneer', 200, 'g'], ['Green peas', 150, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Garam masala', 1, 'tsp'], ['Ghee', 15, 'g'],
    ['Cream', 30, 'ml'],
  ]),
  r('in-shahi-paneer', 'Shahi paneer', '👑', 'dinner', [
    ['Paneer', 200, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Cashew', 25, 'g'], ['Cream', 80, 'ml'], ['Butter', 30, 'g'],
    ['Saffron', 1, 'tsp'], ['Cardamom', 1, 'tsp'],
  ]),
  r('in-butter-chicken', 'Butter chicken (murgh makhani)', '🍗', 'dinner', [
    ['Chicken', 400, 'g'], ['Butter', 40, 'g'], ['Cream', 60, 'ml'],
    ['Onion', 1, 'pcs'], ['Tomato', 3, 'pcs'], ['Cashew', 20, 'g'],
    ['Garlic', 4, 'pcs'], ['Ginger', 1, 'pcs'], ['Garam masala', 1, 'tbsp'],
  ]),
  r('in-chicken-tikka-masala', 'Chicken tikka masala', '🍢', 'dinner', [
    ['Chicken', 400, 'g'], ['Yogurt', 80, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Cream', 60, 'ml'], ['Tikka masala', 1, 'tbsp'],
    ['Ginger', 1, 'pcs'], ['Garlic', 4, 'pcs'], ['Ghee', 15, 'g'],
  ]),
  r('in-rogan-josh', 'Rogan josh', '🌶️', 'dinner', [
    ['Mutton', 400, 'g'], ['Onion', 2, 'pcs'], ['Yogurt', 100, 'g'],
    ['Tomato', 2, 'pcs'], ['Kashmiri chili', 2, 'tsp'], ['Rogan josh masala', 1, 'tbsp'],
    ['Ghee', 20, 'g'],
  ]),
  r('in-keema-matar', 'Keema matar', '🥩', 'dinner', [
    ['Minced mutton', 300, 'g'], ['Green peas', 100, 'g'], ['Onion', 2, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Ginger', 1, 'pcs'], ['Garlic', 3, 'pcs'],
    ['Garam masala', 1, 'tbsp'], ['Ghee', 15, 'g'],
  ]),
  r('in-aloo-gobi', 'Aloo gobi', '🥔', 'lunch', [
    ['Potato', 3, 'pcs'], ['Cauliflower', 300, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Turmeric', 1, 'tsp'], ['Cumin seeds', 1, 'tsp'],
    ['Ginger', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Oil', 30, 'ml'],
  ]),
  r('in-baingan-bharta', 'Baingan bharta', '🍆', 'dinner', [
    ['Brinjal (big)', 2, 'pcs'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Garlic', 5, 'pcs'], ['Ginger', 1, 'pcs'], ['Green chili', 2, 'pcs'],
    ['Mustard oil', 30, 'ml'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-bhindi-masala', 'Bhindi masala (okra)', '🌶️', 'lunch', [
    ['Okra (bhindi)', 250, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Turmeric', 1, 'tsp'], ['Cumin seeds', 1, 'tsp'], ['Amchur', 1, 'tsp'],
    ['Oil', 30, 'ml'], ['Green chili', 2, 'pcs'],
  ]),
  r('in-jeera-aloo', 'Jeera aloo', '🥔', 'lunch', [
    ['Potato', 4, 'pcs'], ['Cumin seeds', 2, 'tsp'], ['Turmeric', 1, 'tsp'],
    ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'], ['Oil', 30, 'ml'],
    ['Coriander leaves', 5, 'g'], ['Lemon', 0.5, 'pcs'],
  ]),
  r('in-mixed-veg', 'Mixed vegetable curry', '🥗', 'lunch', [
    ['Carrot', 1, 'pcs'], ['Beans', 100, 'g'], ['Cauliflower', 100, 'g'],
    ['Potato', 1, 'pcs'], ['Green peas', 80, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Garam masala', 1, 'tsp'], ['Oil', 30, 'ml'],
  ]),
  r('in-dum-aloo', 'Dum aloo', '🥔', 'dinner', [
    ['Baby potatoes', 400, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Yogurt', 60, 'g'], ['Kashmiri chili', 1, 'tsp'], ['Garam masala', 1, 'tsp'],
    ['Ginger powder', 1, 'tsp'], ['Oil', 40, 'ml'],
  ]),
  r('in-malai-kofta', 'Malai kofta', '🧆', 'dinner', [
    ['Paneer', 200, 'g'], ['Potato', 1, 'pcs'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Cashew', 25, 'g'], ['Cream', 80, 'ml'],
    ['Cardamom', 1, 'tsp'], ['Garam masala', 1, 'tsp'], ['Oil', 40, 'ml'],
  ]),
  r('in-veg-biryani', 'Veg biryani', '🍚', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Carrot', 1, 'pcs'], ['Beans', 50, 'g'],
    ['Cauliflower', 100, 'g'], ['Potato', 1, 'pcs'], ['Onion', 2, 'pcs'],
    ['Yogurt', 80, 'g'], ['Biryani masala', 1, 'tbsp'], ['Ghee', 30, 'g'],
    ['Saffron', 1, 'tsp'], ['Mint leaves', 5, 'g'],
  ]),
  r('in-chicken-biryani', 'Chicken biryani', '🍗', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Chicken', 400, 'g'], ['Onion', 2, 'pcs'],
    ['Yogurt', 100, 'g'], ['Biryani masala', 1, 'tbsp'], ['Ghee', 30, 'g'],
    ['Saffron', 1, 'tsp'], ['Mint leaves', 5, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-mutton-biryani', 'Mutton biryani', '🍖', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Mutton', 400, 'g'], ['Onion', 2, 'pcs'],
    ['Yogurt', 120, 'g'], ['Biryani masala', 1, 'tbsp'], ['Ghee', 30, 'g'],
    ['Saffron', 1, 'tsp'], ['Mint leaves', 5, 'g'],
  ]),
  r('in-veg-pulao', 'Veg pulao', '🍚', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Carrot', 1, 'pcs'], ['Beans', 50, 'g'],
    ['Green peas', 50, 'g'], ['Onion', 1, 'pcs'], ['Ghee', 25, 'g'],
    ['Biryani masala', 1, 'tsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-jeera-rice', 'Jeera rice', '🍚', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Cumin seeds', 2, 'tsp'], ['Ghee', 20, 'g'],
    ['Bay leaf', 1, 'pcs'], ['Salt', 1, 'tsp'],
  ]),
  r('in-khichdi', 'Khichdi', '🍲', 'dinner', [
    ['Basmati rice', 150, 'g'], ['Moong dal', 100, 'g'], ['Turmeric', 1, 'tsp'],
    ['Cumin seeds', 1, 'tsp'], ['Ghee', 25, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Ginger', 1, 'pcs'],
  ]),
  r('in-curd-rice', 'Curd rice (dahi chawal)', '🍚', 'lunch', [
    ['Cooked rice', 300, 'g'], ['Yogurt', 200, 'g'], ['Mustard seeds', 1, 'tsp'],
    ['Curry leaves', 5, 'pcs'], ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Pomegranate', 50, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-lemon-rice', 'Lemon rice (chitranna)', '🍋', 'lunch', [
    ['Cooked rice', 300, 'g'], ['Lemon', 1, 'pcs'], ['Peanuts', 30, 'g'],
    ['Mustard seeds', 1, 'tsp'], ['Turmeric', 1, 'tsp'], ['Curry leaves', 5, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Oil', 20, 'ml'],
  ]),
  r('in-tamarind-rice', 'Tamarind rice (puliyodarai)', '🌴', 'lunch', [
    ['Cooked rice', 300, 'g'], ['Tamarind', 50, 'g'], ['Peanuts', 30, 'g'],
    ['Mustard seeds', 1, 'tsp'], ['Sesame oil', 30, 'ml'], ['Curry leaves', 5, 'pcs'],
    ['Jaggery', 20, 'g'], ['Turmeric', 1, 'tsp'],
  ]),
  r('in-coconut-rice', 'Coconut rice', '🥥', 'lunch', [
    ['Cooked rice', 300, 'g'], ['Grated coconut', 100, 'g'], ['Mustard seeds', 1, 'tsp'],
    ['Cashew', 20, 'g'], ['Curry leaves', 5, 'pcs'], ['Green chili', 2, 'pcs'],
    ['Oil', 20, 'ml'],
  ]),

  // ───────────────────────── South Indian ─────────────────────────
  r('in-idli', 'Idli', '⚪', 'breakfast', [
    ['Idli rice', 200, 'g'], ['Urad dal', 80, 'g'], ['Salt', 1, 'tsp'],
  ]),
  r('in-dosa', 'Plain dosa', '🥞', 'breakfast', [
    ['Dosa rice', 200, 'g'], ['Urad dal', 80, 'g'], ['Salt', 1, 'tsp'],
    ['Oil', 30, 'ml'],
  ]),
  r('in-masala-dosa', 'Masala dosa', '🥞', 'breakfast', [
    ['Dosa rice', 200, 'g'], ['Urad dal', 80, 'g'], ['Potato', 2, 'pcs'],
    ['Onion', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Mustard seeds', 1, 'tsp'],
    ['Curry leaves', 5, 'pcs'], ['Ginger', 1, 'pcs'], ['Oil', 40, 'ml'],
  ]),
  r('in-rava-dosa', 'Rava dosa', '🥞', 'breakfast', [
    ['Rava (semolina)', 200, 'g'], ['Rice flour', 50, 'g'], ['Yogurt', 100, 'g'],
    ['Onion', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Cumin seeds', 1, 'tsp'],
    ['Curry leaves', 5, 'pcs'], ['Oil', 30, 'ml'],
  ]),
  r('in-uttapam', 'Uttapam', '🥞', 'breakfast', [
    ['Dosa rice', 150, 'g'], ['Urad dal', 50, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Coriander leaves', 5, 'g'],
    ['Oil', 30, 'ml'],
  ]),
  r('in-poondu-dosa', 'Poondu dosa (garlic)', '🧄', 'breakfast', [
    ['Dosa rice', 200, 'g'], ['Urad dal', 80, 'g'], ['Garlic', 20, 'pcs'],
    ['Green chili', 3, 'pcs'], ['Coriander leaves', 5, 'g'], ['Oil', 30, 'ml'],
  ]),
  r('in-medu-vada', 'Medu vada', '🍩', 'breakfast', [
    ['Urad dal', 200, 'g'], ['Green chili', 3, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Curry leaves', 5, 'pcs'], ['Black pepper', 1, 'tsp'], ['Oil', 100, 'ml'],
  ]),
  r('in-sambar', 'Sambar', '🍛', 'lunch', [
    ['Toor dal', 100, 'g'], ['Tamarind', 30, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Carrot', 1, 'pcs'], ['Drumstick', 2, 'pcs'],
    ['Brinjal', 1, 'pcs'], ['Sambar powder', 1, 'tbsp'], ['Curry leaves', 5, 'pcs'],
    ['Mustard seeds', 1, 'tsp'], ['Oil', 30, 'ml'],
  ]),
  r('in-rasam', 'Rasam', '🥣', 'dinner', [
    ['Tamarind', 30, 'g'], ['Tomato', 2, 'pcs'], ['Garlic', 5, 'pcs'],
    ['Rasam powder', 1, 'tbsp'], ['Curry leaves', 5, 'pcs'], ['Cumin seeds', 1, 'tsp'],
    ['Coriander leaves', 5, 'g'], ['Black pepper', 1, 'tsp'],
  ]),
  r('in-upma', 'Upma (rava upma)', '🌾', 'breakfast', [
    ['Rava (semolina)', 200, 'g'], ['Onion', 1, 'pcs'], ['Green chili', 2, 'pcs'],
    ['Mustard seeds', 1, 'tsp'], ['Curry leaves', 5, 'pcs'], ['Cashew', 20, 'g'],
    ['Ginger', 5, 'g'], ['Oil', 30, 'ml'], ['Lemon', 0.5, 'pcs'],
  ]),
  r('in-poha', 'Poha', '🍚', 'breakfast', [
    ['Poha (flattened rice)', 200, 'g'], ['Onion', 1, 'pcs'], ['Peanuts', 30, 'g'],
    ['Mustard seeds', 1, 'tsp'], ['Turmeric', 1, 'tsp'], ['Curry leaves', 5, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Lemon', 0.5, 'pcs'], ['Oil', 20, 'ml'],
  ]),
  r('in-ven-pongal', 'Ven pongal', '🍲', 'breakfast', [
    ['Rice', 200, 'g'], ['Moong dal', 100, 'g'], ['Ghee', 50, 'g'],
    ['Black pepper', 1, 'tsp'], ['Cumin seeds', 1, 'tsp'], ['Curry leaves', 5, 'pcs'],
    ['Cashew', 20, 'g'], ['Ginger', 1, 'pcs'],
  ]),
  r('in-bisi-bele-bath', 'Bisi bele bath', '🌶️', 'lunch', [
    ['Rice', 200, 'g'], ['Toor dal', 100, 'g'], ['Tamarind', 30, 'g'],
    ['Mixed vegetables', 200, 'g'], ['Bisi bele bath powder', 2, 'tbsp'],
    ['Ghee', 30, 'g'], ['Curry leaves', 5, 'pcs'],
  ]),
  r('in-bonda', 'Bonda', '🍩', 'snack', [
    ['Potato', 3, 'pcs'], ['Besan (gram flour)', 100, 'g'], ['Onion', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'], ['Curry leaves', 5, 'pcs'],
    ['Mustard seeds', 1, 'tsp'], ['Oil', 100, 'ml'],
  ]),
  r('in-vada-pav', 'Vada pav', '🍔', 'snack', [
    ['Pav (bread rolls)', 4, 'pcs'], ['Potato', 3, 'pcs'], ['Besan (gram flour)', 80, 'g'],
    ['Mustard seeds', 1, 'tsp'], ['Curry leaves', 5, 'pcs'], ['Garlic', 4, 'pcs'],
    ['Green chili', 3, 'pcs'], ['Oil', 100, 'ml'],
  ]),

  // ───────────────────────── Breads & breakfast ─────────────────────────
  r('in-roti', 'Roti (chapati)', '🫓', 'lunch', [
    ['Whole wheat flour', 150, 'g'], ['Ghee', 10, 'g'], ['Salt', 0.5, 'tsp'],
  ]),
  r('in-naan', 'Naan', '🍞', 'dinner', [
    ['All-purpose flour (maida)', 200, 'g'], ['Yogurt', 50, 'g'], ['Yeast', 1, 'tsp'],
    ['Sugar', 1, 'tsp'], ['Butter', 20, 'g'], ['Salt', 1, 'tsp'],
  ]),
  r('in-garlic-naan', 'Garlic naan', '🧄', 'dinner', [
    ['All-purpose flour (maida)', 200, 'g'], ['Yogurt', 50, 'g'], ['Yeast', 1, 'tsp'],
    ['Garlic', 8, 'pcs'], ['Butter', 30, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-butter-naan', 'Butter naan', '🍞', 'dinner', [
    ['All-purpose flour (maida)', 200, 'g'], ['Yogurt', 50, 'g'], ['Yeast', 1, 'tsp'],
    ['Butter', 40, 'g'],
  ]),
  r('in-aloo-paratha', 'Aloo paratha', '🥔', 'breakfast', [
    ['Whole wheat flour', 150, 'g'], ['Potato', 3, 'pcs'], ['Onion', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'], ['Coriander leaves', 5, 'g'],
    ['Ghee', 30, 'g'], ['Cumin seeds', 1, 'tsp'],
  ]),
  r('in-gobi-paratha', 'Gobi paratha', '🥬', 'breakfast', [
    ['Whole wheat flour', 150, 'g'], ['Cauliflower', 200, 'g'], ['Green chili', 2, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Coriander leaves', 5, 'g'], ['Ghee', 30, 'g'],
  ]),
  r('in-paneer-paratha', 'Paneer paratha', '🧀', 'breakfast', [
    ['Whole wheat flour', 150, 'g'], ['Paneer', 150, 'g'], ['Onion', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Coriander leaves', 5, 'g'], ['Ghee', 30, 'g'],
  ]),
  r('in-puri-bhaji', 'Puri bhaji', '🍩', 'breakfast', [
    ['Whole wheat flour', 200, 'g'], ['Potato', 3, 'pcs'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Green chili', 2, 'pcs'], ['Ghee', 50, 'g'],
    ['Oil', 100, 'ml'], ['Mustard seeds', 1, 'tsp'], ['Curry leaves', 5, 'pcs'],
  ]),
  r('in-thepla', 'Thepla', '🌿', 'breakfast', [
    ['Whole wheat flour', 150, 'g'], ['Fenugreek leaves', 50, 'g'], ['Yogurt', 30, 'g'],
    ['Ginger', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Cumin seeds', 1, 'tsp'],
    ['Oil', 20, 'ml'],
  ]),
  r('in-bhakri', 'Bhakri', '🌾', 'dinner', [
    ['Jowar flour', 150, 'g'], ['Whole wheat flour', 50, 'g'], ['Oil', 20, 'ml'],
  ]),
  r('in-bread-pakora', 'Bread pakora', '🍞', 'snack', [
    ['Bread', 6, 'slices'], ['Besan (gram flour)', 100, 'g'], ['Onion', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Potato', 1, 'pcs'], ['Oil', 100, 'ml'],
    ['Turmeric', 1, 'tsp'], ['Red chili powder', 1, 'tsp'],
  ]),

  // ───────────────────────── Snacks & chaats ─────────────────────────
  r('in-samosa', 'Samosa', '🔺', 'snack', [
    ['All-purpose flour (maida)', 100, 'g'], ['Potato', 2, 'pcs'], ['Peas', 16, 'g'],
    ['Onion', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Cumin seeds', 1, 'tsp'], ['Garam masala', 1, 'tsp'], ['Oil', 200, 'ml'],
  ]),
  r('in-pakora', 'Onion pakora', '🧅', 'snack', [
    ['Besan (gram flour)', 100, 'g'], ['Onion', 2, 'pcs'], ['Green chili', 2, 'pcs'],
    ['Coriander leaves', 5, 'g'], ['Cumin seeds', 1, 'tsp'], ['Oil', 200, 'ml'],
    ['Red chili powder', 1, 'tsp'], ['Turmeric', 0.5, 'tsp'],
  ]),
  r('in-pav-bhaji', 'Pav bhaji', '🍛', 'snack', [
    ['Pav (bread rolls)', 6, 'pcs'], ['Mixed vegetables', 400, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Butter', 50, 'g'], ['Pav bhaji masala', 2, 'tbsp'],
    ['Lemon', 1, 'pcs'], ['Coriander leaves', 5, 'g'], ['Oil', 30, 'ml'],
  ]),
  r('in-chole-bhature', 'Chole bhature', '🫓', 'snack', [
    ['All-purpose flour (maida)', 200, 'g'], ['Chickpeas', 200, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Yogurt', 50, 'g'], ['Oil', 50, 'ml'],
    ['Garam masala', 1, 'tbsp'], ['Chole masala', 1, 'tbsp'],
  ]),
  r('in-dahi-vada', 'Dahi vada', '🥣', 'snack', [
    ['Urad dal', 150, 'g'], ['Yogurt', 300, 'g'], ['Sugar', 50, 'g'],
    ['Roasted cumin powder', 1, 'tsp'], ['Black salt', 0.5, 'tsp'], ['Oil', 100, 'ml'],
    ['Green chili', 2, 'pcs'],
  ]),
  r('in-pani-puri', 'Pani puri / gol gappa', '💧', 'snack', [
    ['Semolina', 100, 'g'], ['All-purpose flour (maida)', 100, 'g'], ['Tamarind', 50, 'g'],
    ['Mint leaves', 30, 'g'], ['Coriander leaves', 20, 'g'], ['Green chili', 3, 'pcs'],
    ['Potato', 2, 'pcs'], ['Chickpeas', 100, 'g'], ['Black salt', 1, 'tsp'],
    ['Cumin powder', 1, 'tsp'],
  ]),
  r('in-bhel-puri', 'Bhel puri', '🥗', 'snack', [
    ['Puffed rice', 200, 'g'], ['Sev', 50, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Potato', 1, 'pcs'], ['Tamarind chutney', 50, 'g'],
    ['Green chutney', 50, 'g'], ['Coriander leaves', 5, 'g'], ['Lemon', 1, 'pcs'],
  ]),
  r('in-sev-puri', 'Sev puri', '🌶️', 'snack', [
    ['Puri (fried)', 12, 'pcs'], ['Sev', 80, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Potato', 1, 'pcs'], ['Tamarind chutney', 50, 'g'],
    ['Green chutney', 50, 'g'], ['Yogurt', 50, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-alo-tikki', 'Aloo tikki (chaat)', '🥔', 'snack', [
    ['Potato', 4, 'pcs'], ['Peas', 50, 'g'], ['Bread crumbs', 30, 'g'],
    ['Ginger', 1, 'pcs'], ['Green chili', 2, 'pcs'], ['Cumin seeds', 1, 'tsp'],
    ['Tamarind chutney', 50, 'g'], ['Yogurt', 100, 'g'], ['Oil', 50, 'ml'],
  ]),
  r('in-dahi-bhalla', 'Dahi bhalla chaat', '🥣', 'snack', [
        ['Urad dal', 100, 'g'], ['Yogurt', 200, 'g'], ['Tamarind chutney', 50, 'g'],
        ['Cumin powder', 1, 'tsp'], ['Red chili powder', 0.5, 'tsp'], ['Oil', 50, 'ml'],
      ]),

  // ───────────────────────── Sweets ─────────────────────────
  r('in-gulab-jamun', 'Gulab jamun', '🟤', 'sweet', [
    ['Milk powder', 100, 'g'], ['All-purpose flour (maida)', 30, 'g'], ['Ghee', 30, 'g'],
    ['Sugar', 200, 'g'], ['Cardamom', 1, 'tsp'], ['Milk', 100, 'ml'],
  ]),
  r('in-jalebi', 'Jalebi', '🌀', 'sweet', [
    ['All-purpose flour (maida)', 100, 'g'], ['Yogurt', 20, 'g'], ['Sugar', 200, 'g'],
    ['Saffron', 1, 'tsp'], ['Cardamom', 1, 'tsp'], ['Oil', 200, 'ml'],
  ]),
  r('in-rasgulla', 'Rasgulla', '⚪', 'sweet', [
    ['Paneer (chenna)', 200, 'g'], ['Sugar', 200, 'g'], ['Cardamom', 1, 'tsp'],
    ['Water', 500, 'ml'],
  ]),
  r('in-ladoo', 'Besan laddu', '🟡', 'sweet', [
    ['Besan (gram flour)', 150, 'g'], ['Ghee', 80, 'g'], ['Sugar', 100, 'g'],
    ['Cardamom', 1, 'tsp'], ['Cashew', 20, 'g'], ['Almonds', 10, 'g'],
  ]),
  r('in-motichoor-ladoo', 'Motichoor ladoo', '🟠', 'sweet', [
    ['Besan (gram flour)', 100, 'g'], ['Ghee', 50, 'g'], ['Sugar', 80, 'g'],
    ['Saffron', 1, 'tsp'], ['Cardamom', 1, 'tsp'],
  ]),
  r('in-gajar-halwa', 'Gajar halwa (carrot halwa)', '🥕', 'sweet', [
    ['Carrot', 6, 'pcs'], ['Milk', 500, 'ml'], ['Sugar', 100, 'g'],
    ['Ghee', 50, 'g'], ['Cardamom', 1, 'tsp'], ['Cashew', 20, 'g'],
  ]),
  r('in-sooji-halwa', 'Sooji halwa', '🌾', 'sweet', [
    ['Rava (semolina)', 150, 'g'], ['Ghee', 80, 'g'], ['Sugar', 100, 'g'],
    ['Milk', 250, 'ml'], ['Cardamom', 1, 'tsp'], ['Cashew', 20, 'g'],
  ]),
  r('in-barfi', 'Coconut barfi', '🥥', 'sweet', [
    ['Grated coconut', 200, 'g'], ['Milk', 100, 'ml'], ['Sugar', 100, 'g'],
    ['Ghee', 30, 'g'], ['Cardamom', 1, 'tsp'],
  ]),
  r('in-kaju-katli', 'Kaju katli', '🥜', 'sweet', [
    ['Cashew', 200, 'g'], ['Sugar', 100, 'g'], ['Ghee', 15, 'g'],
    ['Cardamom', 1, 'tsp'], ['Milk', 30, 'ml'],
  ]),
  r('in-mysore-pak', 'Mysore pak', '🟨', 'sweet', [
    ['Besan (gram flour)', 150, 'g'], ['Ghee', 150, 'g'], ['Sugar', 200, 'g'],
    ['Milk', 60, 'ml'], ['Cardamom', 1, 'tsp'],
  ]),
  r('in-shahi-tukda', 'Shahi tukda', '🍞', 'sweet', [
    ['Bread', 4, 'slices'], ['Milk', 500, 'ml'], ['Sugar', 100, 'g'],
    ['Ghee', 50, 'g'], ['Saffron', 1, 'tsp'], ['Cardamom', 1, 'tsp'],
    ['Pistachio', 10, 'g'], ['Almonds', 10, 'g'],
  ]),
  r('in-rasmalai', 'Rasmalai', '🍶', 'sweet', [
    ['Milk', 1, 'l'], ['Paneer (chenna)', 200, 'g'], ['Sugar', 80, 'g'],
    ['Saffron', 1, 'tsp'], ['Cardamom', 1, 'tsp'], ['Pistachio', 10, 'g'],
  ]),
  r('in-peda', 'Peda', '⚪', 'sweet', [
    ['Milk powder', 150, 'g'], ['Sugar', 100, 'g'], ['Ghee', 50, 'g'],
    ['Cardamom', 1, 'tsp'], ['Saffron', 1, 'tsp'],
  ]),

  // ───────────────────────── Drinks & accompaniments ─────────────────────────
  r('in-masala-chai', 'Masala chai', '☕', 'breakfast', [
    ['Milk', 250, 'ml'], ['Water', 250, 'ml'], ['Tea leaves', 2, 'tsp'],
    ['Sugar', 2, 'tsp'], ['Cardamom', 1, 'tsp'], ['Ginger', 1, 'pcs'],
    ['Cinnamon', 1, 'pcs'], ['Clove', 1, 'pcs'],
  ]),
  r('in-lassi', 'Sweet lassi', '🥛', 'snack', [
    ['Yogurt', 200, 'g'], ['Milk', 100, 'ml'], ['Sugar', 30, 'g'],
    ['Cardamom', 0.5, 'tsp'],
  ]),
  r('in-mango-lassi', 'Mango lassi', '🥭', 'snack', [
    ['Yogurt', 200, 'g'], ['Mango', 1, 'pcs'], ['Milk', 100, 'ml'],
    ['Sugar', 20, 'g'], ['Cardamom', 0.5, 'tsp'],
  ]),
  r('in-masala-buttermilk', 'Masala chaas (buttermilk)', '🥛', 'snack', [
    ['Yogurt', 200, 'g'], ['Water', 400, 'ml'], ['Cumin powder', 1, 'tsp'],
    ['Black salt', 0.5, 'tsp'], ['Mint leaves', 5, 'g'], ['Green chili', 1, 'pcs'],
    ['Coriander leaves', 5, 'g'],
  ]),

  // ───────────────────────── More mains & one-pot dishes ─────────────────────────
  r('in-chicken-curry', 'Chicken curry', '🍗', 'dinner', [
    ['Chicken', 500, 'g'], ['Onion', 2, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 5, 'pcs'], ['Garam masala', 1, 'tbsp'],
    ['Coriander powder', 1, 'tsp'], ['Turmeric', 1, 'tsp'], ['Oil', 40, 'ml'],
  ]),
  r('in-mutton-curry', 'Mutton curry', '🍖', 'dinner', [
    ['Mutton', 500, 'g'], ['Onion', 2, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Yogurt', 100, 'g'], ['Ginger', 1, 'pcs'], ['Garlic', 5, 'pcs'],
    ['Garam masala', 1, 'tbsp'], ['Ghee', 30, 'g'],
  ]),
  r('in-fish-curry', 'Fish curry', '🐟', 'dinner', [
    ['Fish', 400, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Coconut milk', 200, 'ml'], ['Tamarind', 20, 'g'], ['Curry leaves', 5, 'pcs'],
    ['Mustard seeds', 1, 'tsp'], ['Coconut oil', 30, 'ml'],
  ]),
  r('in-prawnsavvcurry', 'Prawn curry', '🦐', 'dinner', [
    ['Prawns', 400, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Coconut milk', 200, 'ml'], ['Curry leaves', 5, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Coconut oil', 30, 'ml'],
  ]),
  r('in-egg-curry', 'Egg curry', '🥚', 'dinner', [
    ['Eggs', 4, 'pcs'], ['Onion', 2, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 3, 'pcs'], ['Garam masala', 1, 'tsp'],
    ['Turmeric', 1, 'tsp'], ['Oil', 30, 'ml'],
  ]),
  r('in-omelette', 'Omelette', '🍳', 'breakfast', [
    ['Eggs', 3, 'pcs'], ['Onion', 1, 'pcs'], ['Green chili', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Coriander leaves', 5, 'g'], ['Oil', 15, 'ml'],
  ]),
  r('in-egg-bhurji', 'Egg bhurji (scrambled)', '🍳', 'breakfast', [
    ['Eggs', 4, 'pcs'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Turmeric', 0.5, 'tsp'], ['Coriander leaves', 5, 'g'],
    ['Oil', 15, 'ml'], ['Ginger', 1, 'pcs'],
  ]),
  r('in-dal-palak', 'Dal palak', '🥬', 'lunch', [
    ['Toor dal', 100, 'g'], ['Spinach', 150, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Garlic', 3, 'pcs'], ['Ghee', 15, 'g'],
    ['Cumin seeds', 1, 'tsp'],
  ]),
  r('in-kadhi', 'Kadhi (yogurt curry)', '🥣', 'lunch', [
    ['Yogurt', 200, 'g'], ['Besan (gram flour)', 30, 'g'], ['Onion', 1, 'pcs'],
    ['Green chili', 2, 'pcs'], ['Cumin seeds', 1, 'tsp'], ['Curry leaves', 5, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Turmeric', 1, 'tsp'],
  ]),
  r('in-vegetable-pulao', 'Vegetable pulao', '🍚', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Carrot', 1, 'pcs'], ['Beans', 50, 'g'],
    ['Green peas', 50, 'g'], ['Onion', 1, 'pcs'], ['Ghee', 25, 'g'],
    ['Bay leaf', 1, 'pcs'], ['Cinnamon', 1, 'pcs'], ['Cardamom', 1, 'pcs'],
  ]),
  r('in-mushroom-pulao', 'Mushroom pulao', '🍄', 'lunch', [
    ['Basmati rice', 300, 'g'], ['Mushroom', 200, 'g'], ['Onion', 1, 'pcs'],
    ['Ghee', 25, 'g'], ['Cumin seeds', 1, 'tsp'], ['Bay leaf', 1, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 3, 'pcs'],
  ]),
  r('in-mushroom-masala', 'Mushroom masala', '🍄', 'dinner', [
    ['Mushroom', 300, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Cashew', 20, 'g'], ['Cream', 30, 'ml'], ['Garam masala', 1, 'tsp'],
    ['Ginger', 1, 'pcs'], ['Garlic', 3, 'pcs'], ['Butter', 20, 'g'],
  ]),
  r('in-paneer-tikka', 'Paneer tikka', '🍢', 'snack', [
    ['Paneer', 250, 'g'], ['Yogurt', 80, 'g'], ['Capsicum', 1, 'pcs'],
    ['Onion', 1, 'pcs'], ['Tikka masala', 1, 'tbsp'], ['Lemon', 1, 'pcs'],
    ['Oil', 20, 'ml'],
  ]),
  r('in-hara-bhara-kebab', 'Hara bhara kebab', '🥬', 'snack', [
    ['Spinach', 150, 'g'], ['Green peas', 100, 'g'], ['Potato', 1, 'pcs'],
    ['Besan (gram flour)', 50, 'g'], ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Coriander leaves', 5, 'g'], ['Oil', 50, 'ml'],
  ]),
  r('in-paneer-tikka-masala', 'Paneer tikka masala', '🧀', 'dinner', [
    ['Paneer', 250, 'g'], ['Capsicum', 1, 'pcs'], ['Onion', 1, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Cream', 40, 'ml'], ['Tikka masala', 1, 'tbsp'],
    ['Butter', 20, 'g'],
  ]),
  r('in-veg-kolhapuri', 'Veg Kolhapuri', '🌶️', 'dinner', [
    ['Mixed vegetables', 300, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Coconut', 30, 'g'], ['Kolhapuri masala', 2, 'tbsp'], ['Ghee', 20, 'g'],
    ['Coriander leaves', 5, 'g'],
  ]),
  r('in-veg-handi', 'Veg handi', '🥘', 'dinner', [
    ['Mixed vegetables', 300, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Capsicum', 1, 'pcs'], ['Cream', 60, 'ml'], ['Cashew', 20, 'g'],
    ['Handi masala', 1, 'tbsp'], ['Butter', 20, 'g'],
  ]),
  r('in-veg-makhanwala', 'Veg makhanwala', '🧈', 'dinner', [
    ['Mixed vegetables', 300, 'g'], ['Butter', 40, 'g'], ['Cream', 60, 'ml'],
    ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'], ['Cashew', 20, 'g'],
    ['Garam masala', 1, 'tsp'], ['Ginger', 1, 'pcs'],
  ]),
  r('in-dal-fry', 'Dal fry', '🍛', 'lunch', [
    ['Toor dal', 150, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Cumin seeds', 1, 'tsp'], ['Ghee', 15, 'g'],
    ['Coriander leaves', 5, 'g'],
  ]),
  r('in-masoor-dal', 'Masoor dal', '🍛', 'lunch', [
    ['Masoor dal', 150, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Ginger', 1, 'pcs'], ['Turmeric', 1, 'tsp'],
    ['Cumin seeds', 1, 'tsp'], ['Ghee', 15, 'g'],
  ]),
  r('in-chana-dal', 'Chana dal', '🍛', 'lunch', [
    ['Chana dal', 150, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Ginger', 1, 'pcs'], ['Garlic', 3, 'pcs'], ['Garam masala', 1, 'tsp'],
    ['Ghee', 15, 'g'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-moong-dal', 'Moong dal', '🍛', 'lunch', [
    ['Moong dal', 150, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Turmeric', 1, 'tsp'], ['Cumin seeds', 1, 'tsp'], ['Ghee', 15, 'g'],
    ['Green chili', 2, 'pcs'],
  ]),

  // ───────────────────────── Chinese-Indian favorites ─────────────────────────
  r('in-veg-manchurian', 'Veg manchurian', '🥡', 'snack', [
    ['Mixed vegetables', 200, 'g'], ['All-purpose flour (maida)', 50, 'g'],
    ['Corn flour', 30, 'g'], ['Soy sauce', 1, 'tbsp'], ['Ginger', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Green chili', 2, 'pcs'], ['Oil', 100, 'ml'],
  ]),
  r('in-chilli-paneer', 'Chilli paneer', '🌶️', 'snack', [
    ['Paneer', 200, 'g'], ['Capsicum', 2, 'pcs'], ['Onion', 1, 'pcs'],
    ['Soy sauce', 1, 'tbsp'], ['Corn flour', 30, 'g'], ['Ginger', 1, 'pcs'],
    ['Garlic', 3, 'pcs'], ['Green chili', 2, 'pcs'], ['Oil', 50, 'ml'],
  ]),
  r('in-veg-noodles', 'Veg hakka noodles', '🍜', 'dinner', [
    ['Hakka noodles', 200, 'g'], ['Carrot', 1, 'pcs'], ['Capsicum', 1, 'pcs'],
    ['Cabbage', 100, 'g'], ['Onion', 1, 'pcs'], ['Soy sauce', 1, 'tbsp'],
    ['Vinegar', 1, 'tsp'], ['Garlic', 3, 'pcs'], ['Oil', 30, 'ml'],
  ]),
  r('in-veg-fried-rice', 'Veg fried rice', '🍚', 'dinner', [
    ['Cooked rice', 300, 'g'], ['Carrot', 1, 'pcs'], ['Capsicum', 1, 'pcs'],
    ['Cabbage', 100, 'g'], ['Soy sauce', 1, 'tbsp'], ['Green peas', 50, 'g'],
    ['Garlic', 3, 'pcs'], ['Oil', 30, 'ml'],
  ]),
  r('in-veg-spring-roll', 'Veg spring roll', '🥬', 'snack', [
    ['Spring roll wrappers', 8, 'pcs'], ['Cabbage', 100, 'g'], ['Carrot', 1, 'pcs'],
    ['Capsicum', 1, 'pcs'], ['Soy sauce', 1, 'tbsp'], ['Corn flour', 30, 'g'],
    ['Oil', 200, 'ml'],
  ]),

  // ───────────────────────── Salads & raitas ─────────────────────────
  r('in-raita', 'Boondi raita', '🥣', 'lunch', [
    ['Yogurt', 200, 'g'], ['Boondi', 50, 'g'], ['Cumin powder', 1, 'tsp'],
    ['Black salt', 0.5, 'tsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-mixed-veg-raita', 'Mixed veg raita', '🥣', 'lunch', [
    ['Yogurt', 200, 'g'], ['Cucumber', 1, 'pcs'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Cumin powder', 1, 'tsp'], ['Black salt', 0.5, 'tsp'],
    ['Coriander leaves', 5, 'g'],
  ]),
  r('in-cucumber-raita', 'Cucumber raita', '🥒', 'lunch', [
    ['Yogurt', 200, 'g'], ['Cucumber', 2, 'pcs'], ['Cumin powder', 1, 'tsp'],
    ['Black salt', 0.5, 'tsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-onion-salad', 'Onion salad (laccha pyaaz)', '🧅', 'lunch', [
    ['Onion', 2, 'pcs'], ['Lemon', 1, 'pcs'], ['Green chili', 2, 'pcs'],
    ['Coriander leaves', 5, 'g'], ['Black salt', 0.5, 'tsp'],
  ]),
  r('in-green-salad', 'Green salad', '🥗', 'lunch', [
    ['Cucumber', 1, 'pcs'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Lemon', 1, 'pcs'], ['Coriander leaves', 5, 'g'], ['Black salt', 0.5, 'tsp'],
  ]),

  // ───────────────────────── Achaar & chutney ─────────────────────────
  r('in-mango-achaar', 'Aam ka achaar (mango pickle)', '🥭', 'snack', [
    ['Raw mango', 300, 'g'], ['Mustard oil', 50, 'ml'], ['Fennel seeds', 1, 'tbsp'],
    ['Nigella seeds', 1, 'tsp'], ['Red chili powder', 1, 'tbsp'], ['Salt', 1, 'tbsp'],
  ]),
  r('in-mango-chutney', 'Aam ki chutney', '🥭', 'snack', [
    ['Raw mango', 200, 'g'], ['Sugar', 100, 'g'], ['Cumin powder', 1, 'tsp'],
    ['Red chili powder', 0.5, 'tsp'], ['Salt', 0.5, 'tsp'],
  ]),
  r('in-tamarind-chutney', 'Imli chutney', '🌴', 'snack', [
    ['Tamarind', 100, 'g'], ['Jaggery', 80, 'g'], ['Cumin powder', 1, 'tsp'],
    ['Black salt', 0.5, 'tsp'], ['Red chili powder', 0.5, 'tsp'],
  ]),
  r('in-green-chutney', 'Green chutney', '🌿', 'snack', [
    ['Coriander leaves', 50, 'g'], ['Mint leaves', 30, 'g'], ['Green chili', 2, 'pcs'],
    ['Lemon', 1, 'pcs'], ['Salt', 0.5, 'tsp'], ['Cumin powder', 0.5, 'tsp'],
  ]),
  r('in-coconut-chutney', 'Coconut chutney', '🥥', 'snack', [
    ['Grated coconut', 100, 'g'], ['Green chili', 2, 'pcs'], ['Ginger', 1, 'pcs'],
    ['Curd (yogurt)', 30, 'g'], ['Salt', 0.5, 'tsp'], ['Curry leaves', 3, 'pcs'],
  ]),
  r('in-peanut-chutney', 'Peanut chutney', '🥜', 'snack', [
    ['Peanuts', 100, 'g'], ['Green chili', 2, 'pcs'], ['Garlic', 3, 'pcs'],
    ['Lemon', 1, 'pcs'], ['Salt', 0.5, 'tsp'], ['Cumin powder', 0.5, 'tsp'],
  ]),

  // ───────────────────────── Misc light dishes ─────────────────────────
  r('in-ragda', 'Ragda (white pea curry)', '🍛', 'snack', [
    ['White peas', 200, 'g'], ['Onion', 1, 'pcs'], ['Tomato', 2, 'pcs'],
    ['Garam masala', 1, 'tsp'], ['Ginger', 1, 'pcs'], ['Oil', 20, 'ml'],
  ]),
  r('in-masala-papad', 'Masala papad', '🥞', 'snack', [
    ['Papad', 4, 'pcs'], ['Onion', 1, 'pcs'], ['Tomato', 1, 'pcs'],
    ['Lemon', 1, 'pcs'], ['Red chili powder', 0.5, 'tsp'], ['Coriander leaves', 5, 'g'],
  ]),
  r('in-french-fries', 'French fries (aloo fries)', '🍟', 'snack', [
    ['Potato', 4, 'pcs'], ['Oil', 200, 'ml'], ['Salt', 1, 'tsp'],
  ]),
  r('in-pulao-with-rajma', 'Rajma chawal (rajma + rice)', '🍛', 'lunch', [
    ['Kidney beans', 200, 'g'], ['Basmati rice', 300, 'g'], ['Onion', 2, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Rajma masala', 1, 'tbsp'], ['Ghee', 30, 'g'],
    ['Ginger', 1, 'pcs'], ['Garlic', 4, 'pcs'],
  ]),
  r('in-chole-rice', 'Chole chawal (chole + rice)', '🍛', 'lunch', [
    ['Chickpeas', 200, 'g'], ['Basmati rice', 300, 'g'], ['Onion', 2, 'pcs'],
    ['Tomato', 2, 'pcs'], ['Chole masala', 1, 'tbsp'], ['Ghee', 20, 'g'],
  ]),
  r('in-dal-chawal', 'Dal chawal (dal + rice)', '🍛', 'lunch', [
    ['Toor dal', 150, 'g'], ['Basmati rice', 300, 'g'], ['Onion', 1, 'pcs'],
    ['Tomato', 1, 'pcs'], ['Ghee', 20, 'g'], ['Cumin seeds', 1, 'tsp'],
    ['Garlic', 3, 'pcs'], ['Coriander leaves', 5, 'g'],
  ]),
];
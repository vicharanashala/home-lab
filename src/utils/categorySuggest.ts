import type { CategoryId } from '../types';

/**
 * Keyword → category map for smart category auto-detection. First match wins
 * (more specific categories listed first so e.g. "tomato" hits vegetables
 * before "fruit" would).
 */
const KEYWORDS: { category: CategoryId; words: string[] }[] = [
  // Vegetables — Indian + global staples
  { category: 'vegetables', words: [
    'tomato', 'potato', 'onion', 'carrot', 'spinach', 'broccoli', 'cucumber',
    'lettuce', 'cabbage', 'cauliflower', 'gobi', 'capsicum',
    'pumpkin', 'zucchini', 'eggplant', 'brinjal', 'okra',
    'bhindi', 'ladyfinger', 'beetroot', 'radish', 'mooli', 'turnip',
    'leek', 'celery', 'coriander', 'mint', 'kale', 'arugula', 'methi',
    'drumstick', 'mushroom', 'ginger', 'garlic', 'green bean', 'peas',
    'corn', 'mushroom', 'snow pea', 'asparagus', 'artichoke',
  ]},
  // Fruits
  { category: 'fruits', words: [
    'apple', 'banana', 'mango', 'orange', 'grape', 'berry', 'strawberry',
    'blueberry', 'raspberry', 'watermelon', 'pineapple', 'pear', 'peach',
    'plum', 'cherry', 'kiwi', 'papaya', 'guava', 'pomegranate', 'lemon',
    'lime', 'coconut', 'fig', 'date', 'apricot', 'avocado',
  ]},
  // Dairy
  { category: 'dairy', words: [
    'milk', 'butter', 'cheese', 'yogurt', 'yoghurt', 'curd', 'ghee',
    'cream', 'paneer', 'paneer cube', 'lassi', 'kefir', 'condensed milk', 'khoya',
    'ricotta', 'mozzarella', 'cheddar', 'parmesan', 'pepper cheese',
  ]},
  // Meat
  { category: 'meat', words: [
    'chicken', 'mutton', 'beef', 'pork', 'lamb', 'turkey', 'duck',
    'bacon', 'sausage', 'ham', 'kebab', 'tikka', 'keema', 'kheema',
  ]},
  // Seafood
  { category: 'seafood', words: [
    'fish', 'salmon', 'tuna', 'cod', 'sardine', 'mackerel', 'shrimp',
    'prawn', 'crab', 'lobster', 'squid', 'octopus', 'rohu', 'pomfret',
    'surmai', 'bangda', 'hilsa',
  ]},
  // Bakery
  { category: 'bakery', words: [
    'bread', 'roti', 'naan', 'bun', 'cake', 'pastry', 'croissant',
    'bagel', 'muffin', 'pita', 'paratha', 'chapati', 'kulcha',
  ]},
  // Grains
  { category: 'grains', words: [
    'rice', 'wheat', 'flour', 'maida', 'atta', 'dal', 'lentil', 'bean',
    'oats', 'pasta', 'noodle', 'maggi', 'vermicelli', 'sevaiya',
    'semolina', 'rava', 'sooji', 'quinoa', 'barley', 'millet', 'bajra',
    'jowar', 'ragi', 'cornmeal', 'polenta',
  ]},
  // Beverages
  { category: 'beverages', words: [
    'juice', 'tea', 'coffee', 'water', 'soda', 'cola', 'pepsi',
    'lemonade', 'smoothie', 'shake', 'drink', 'beer', 'wine',
  ]},
  // Snacks
  { category: 'snacks', words: [
    'chips', 'crisps', 'biscuit', 'cookie', 'cracker', 'namkeen',
    'muruku', 'murukku', 'popcorn', 'pretzel', 'nuts', 'trail mix',
    'chocolate', 'candy', 'toffee',
  ]},
  // Frozen
  { category: 'frozen', words: [
    'ice cream', 'frozen', 'icecream', 'gelato', 'sorbet', 'popsicle',
    'frozen peas', 'frozen corn', 'frozen veggie',
  ]},
  // Condiments
  { category: 'condiments', words: [
    'ketchup', 'mayo', 'mayonnaise', 'mustard', 'sauce', 'vinegar',
    'soy sauce', 'oil', 'olive oil', 'salt', 'pepper', 'spice',
    'masala', 'turmeric', 'chili powder', 'paprika', 'cinnamon',
    'honey', 'syrup', 'jam', 'jelly', 'peanut butter', 'tahini',
  ]},
];

/**
 * Best-effort category guess from a free-text item name. Falls back to the
 * supplied `fallback` (defaults to `'other'`) when nothing matches.
 *
 * Matching is case-insensitive and uses whole-word boundaries so "rice"
 * matches "rice" but not "price". Multi-word keywords (e.g. "olive oil")
 * are checked as substrings.
 */
export function suggestCategory(name: string, fallback: CategoryId = 'other'): CategoryId {
  const lower = name.toLowerCase().trim();
  if (!lower) return fallback;

  for (const { category, words } of KEYWORDS) {
    for (const w of words) {
      if (w.includes(' ')) {
        // Multi-word keywords use substring match (e.g. "olive oil" inside "extra virgin olive oil")
        if (lower.includes(w)) return category;
      } else {
        // Single-word keywords use word-boundary match
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (re.test(lower)) return category;
      }
    }
  }
  return fallback;
}

/**
 * The online grocery stores you can order from.
 *
 * The Stores page finds the shops you can walk into. This is the other
 * half: the ones that come to the door.
 *
 * WHY A LIST AND NOT A SEARCH
 * These are not places to be found — they are places to be chosen, and the
 * choice is a habit rather than a location. So there is nothing to search
 * for, and a search box would be pretending there is. What the list has to
 * get right is being complete enough to be useful and short enough to be
 * readable, and saying what each one is FOR, because "which one should I
 * use" is the question someone actually has.
 *
 * WHY THE NOTES ARE DELIBERATELY UNSPECIFIC
 * Delivery times, minimum order values and membership passes change
 * constantly, and a list that quotes last quarter's numbers is worse than no
 * list. So each store is described by the KIND of shopping it is good at —
 * which does not go out of date — and the store's own website is right
 * there for the details that do.
 */

/** The kind of shopping a store is good at. */
export type DigitalStoreKind = 'quick' | 'weekly' | 'staples' | 'premium' | 'marketplace';

export interface DigitalStore {
  id: string;
  name: string;
  /** What this store is for, in a few words. */
  note: string;
  kind: DigitalStoreKind;
  /** The store's own website. */
  url: string;
  emoji: string;
}

export const DIGITAL_STORE_KINDS: {
  id: DigitalStoreKind | 'all';
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'quick', label: '⚡ Quick' },
  { id: 'weekly', label: '🧺 Weekly' },
  { id: 'staples', label: '🏷️ Staples' },
  { id: 'premium', label: '🥬 Premium' },
  { id: 'marketplace', label: '🛒 Everything' },
];

export const DIGITAL_STORES: DigitalStore[] = [
  {
    id: 'blinkit',
    name: 'Blinkit',
    note: 'Quick delivery from nearby dark stores',
    kind: 'quick',
    url: 'https://blinkit.com',
    emoji: '⚡',
  },
  {
    id: 'zepto',
    name: 'Zepto',
    note: 'Quick delivery, order as you shop',
    kind: 'quick',
    url: 'https://www.zepto.com',
    emoji: '⚡',
  },
  {
    id: 'swiggy-instamart',
    name: 'Swiggy Instamart',
    note: 'Quick delivery, also inside the Swiggy app',
    kind: 'quick',
    url: 'https://www.swiggy.com/instamart',
    emoji: '⚡',
  },
  {
    id: 'tata-instamart',
    name: 'Tata Instamart',
    note: 'Tata’s quick delivery, and its weekly shop',
    kind: 'quick',
    url: 'https://www.instamart.com',
    emoji: '⚡',
  },
  {
    id: 'bigbasket',
    name: 'BigBasket',
    note: 'The full weekly shop, with a monthly pass',
    kind: 'weekly',
    url: 'https://www.bigbasket.com',
    emoji: '🧺',
  },
  {
    id: 'amazon-fresh',
    name: 'Amazon Fresh',
    note: 'Groceries beside everything else on Amazon',
    kind: 'marketplace',
    url: 'https://www.amazon.in/fresh',
    emoji: '🛒',
  },
  {
    id: 'jiomart',
    name: 'Jio Mart',
    note: 'Reliance’s online grocery and general store',
    kind: 'weekly',
    url: 'https://www.jiomart.com',
    emoji: '🧺',
  },
  {
    id: 'dmart-ready',
    name: 'DMart Ready',
    note: 'Everyday staples at DMart prices',
    kind: 'staples',
    url: 'https://www.dmart.in',
    emoji: '🏷️',
  },
  {
    id: 'mtr-foods',
    name: 'MTR Foods',
    note: 'Authentic Indian food, ready to eat',
    kind: 'premium',
    url: 'https://www.mtrfoods.com',
    emoji: '🥬',
  },
  {
    id: 'spencers',
    name: 'Spencer’s',
    note: 'Gourmet, imported and fresh produce',
    kind: 'premium',
    url: 'https://www.spencers.in',
    emoji: '🥬',
  },
  {
    id: 'freshtohome',
    name: 'FreshToHome',
    note: 'Fish, chicken and mutton, cut and cleaned',
    kind: 'marketplace',
    url: 'https://www.freshtohome.com',
    emoji: '🛒',
  },
];

/** The stores of one kind, or all of them. */
export function digitalStoresOfKind(kind: DigitalStoreKind | 'all'): DigitalStore[] {
  return kind === 'all'
    ? DIGITAL_STORES
    : DIGITAL_STORES.filter((s) => s.kind === kind);
}

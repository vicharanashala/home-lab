/**
 * BanglaVegNet vocabulary — South Asian vegetable classes.
 *
 * BanglaVegNet: A Multiclass Image Dataset of Traditional Vegetables in
 * Bangladesh (Mendeley Data, DOI: 10.17632/rtx9ngb68j, CC BY 4.0).
 *
 * Used by HomeHub's recognition pipeline as:
 *   1. A constrained candidate list — when any classifier produces a label,
 *      it gets mapped back to one of these 42 canonical names so the UI
 *      shows the South-Asian name the user actually says ("Bhindi" / "Lauki" /
 *      "Karela") instead of "Okra" / "Bottle Gourd" / "Bitter Melon".
 *   2. A reference-signature index — see `banglaveg-sigs.json` (built
 *      from publicly-available vegetable photos via Wikimedia Commons)
 *      so we can do nearest-neighbour matching offline, with zero
 *      backend dependency and zero authentication.
 *
 * Modifications per CC BY 4.0: only class names and Hindi/scientific
 * aliases are used; no dataset images are redistributed.
 */

export type BanglaVegClass = {
  /** Canonical name — what HomeHub shows the user. */
  canonical: string;
  /** Common English / botanical name(s). */
  english: string[];
  /** Hindi + a few other Indian language aliases. */
  hindi: string[];
  /** Scientific (binomial) name — used as PlantNet query hint. */
  scientific: string;
  /** Coarse category — drives the storage chip in the AddStockModal. */
  category: "vegetable" | "fruit" | "leafy" | "root" | "spice" | "other";
  /** Where it's typically stored once bought. */
  storage: "fridge" | "pantry" | "counter";
};

export const BANGLABEG_VOCAB: BanglaVegClass[] = [
  { canonical: "Bhindi",      english: ["Okra", "Lady Finger"],            hindi: ["भिंडी", "Bhindi", "Lady Finger"],                        scientific: "Abelmoschus esculentus",   category: "vegetable", storage: "fridge" },
  { canonical: "Brinjal",     english: ["Eggplant", "Aubergine"],           hindi: ["बैंगन", "Brinjal", "Baingan", "Eggplant"],              scientific: "Solanum melongena",       category: "vegetable", storage: "fridge" },
  { canonical: "Karela",      english: ["Bitter Gourd", "Bitter Melon"],   hindi: ["करेला", "Karela", "Bitter Gourd"],                       scientific: "Momordica charantia",     category: "vegetable", storage: "fridge" },
  { canonical: "Lauki",       english: ["Bottle Gourd"],                   hindi: ["लौकी", "Lauki", "Dudhi", "Bottle Gourd"],              scientific: "Lagenaria siceraria",     category: "vegetable", storage: "fridge" },
  { canonical: "Tomato",      english: ["Tomato"],                         hindi: ["टमाटर", "Tomato"],                                       scientific: "Solanum lycopersicum",    category: "vegetable", storage: "counter" },
  { canonical: "Potato",      english: ["Potato"],                         hindi: ["आलू", "Aloo", "Potato"],                                 scientific: "Solanum tuberosum",       category: "root",      storage: "pantry" },
  { canonical: "Onion",       english: ["Onion"],                          hindi: ["प्याज", "Pyaz", "Onion"],                                 scientific: "Allium cepa",             category: "root",      storage: "pantry" },
  { canonical: "Garlic",      english: ["Garlic"],                         hindi: ["लहसुन", "Lahsun", "Garlic"],                             scientific: "Allium sativum",          category: "spice",     storage: "pantry" },
  { canonical: "Ginger",      english: ["Ginger"],                         hindi: ["अदरक", "Adrak", "Ginger"],                               scientific: "Zingiber officinale",     category: "spice",     storage: "pantry" },
  { canonical: "Coriander",   english: ["Coriander", "Cilantro"],          hindi: ["धनिया", "Dhania", "Coriander"],                           scientific: "Coriandrum sativum",      category: "leafy",     storage: "fridge" },
  { canonical: "Chili",       english: ["Green Chili", "Chili Pepper"],    hindi: ["मिर्च", "Mirch", "Green Chili"],                         scientific: "Capsicum annuum",         category: "spice",     storage: "fridge" },
  { canonical: "Capsicum",    english: ["Bell Pepper", "Capsicum"],        hindi: ["शिमला मिर्च", "Shimla Mirch", "Capsicum"],                scientific: "Capsicum annuum",         category: "vegetable", storage: "fridge" },
  { canonical: "Cucumber",    english: ["Cucumber"],                       hindi: ["खीरा", "Kheera", "Cucumber"],                            scientific: "Cucumis sativus",         category: "vegetable", storage: "fridge" },
  { canonical: "Carrot",      english: ["Carrot"],                         hindi: ["गाजर", "Gajar", "Carrot"],                                scientific: "Daucus carota",           category: "root",      storage: "fridge" },
  { canonical: "Beetroot",    english: ["Beetroot", "Beet"],               hindi: ["चुकंदर", "Chukandar", "Beetroot"],                       scientific: "Beta vulgaris",           category: "root",      storage: "fridge" },
  { canonical: "Radish",      english: ["Radish"],                         hindi: ["मूली", "Mooli", "Radish"],                               scientific: "Raphanus sativus",        category: "root",      storage: "fridge" },
  { canonical: "Radish Leaves", english: ["Radish Leaves", "Mooli Patta"], hindi: ["मूली के पत्ते", "Mooli ke Patte"],                        scientific: "Raphanus sativus",        category: "leafy",     storage: "fridge" },
  { canonical: "Spinach",     english: ["Spinach", "Green Spinach"],        hindi: ["पालक", "Palak", "Spinach"],                              scientific: "Spinacia oleracea",       category: "leafy",     storage: "fridge" },
  { canonical: "Cabbage",     english: ["Cabbage"],                        hindi: ["पत्ता गोभी", "Patta Gobhi", "Cabbage"],                  scientific: "Brassica oleracea",       category: "leafy",     storage: "fridge" },
  { canonical: "Cauliflower", english: ["Cauliflower"],                    hindi: ["फूल गोभी", "Phool Gobhi", "Cauliflower"],                scientific: "Brassica oleracea",       category: "leafy",     storage: "fridge" },
  { canonical: "Broccoli",    english: ["Broccoli"],                       hindi: ["ब्रोकली", "Broccoli"],                                    scientific: "Brassica oleracea",       category: "leafy",     storage: "fridge" },
  { canonical: "Pumpkin",     english: ["Pumpkin"],                        hindi: ["कद्दू", "Kaddu", "Pumpkin"],                              scientific: "Cucurbita",               category: "vegetable", storage: "pantry" },
  { canonical: "Zucchini",    english: ["Zucchini", "Courgette"],          hindi: ["ज़ुकिनी", "Zucchini"],                                   scientific: "Cucurbita pepo",          category: "vegetable", storage: "fridge" },
  { canonical: "Ash Gourd",   english: ["Ash Gourd", "Winter Melon"],       hindi: ["पेठा", "Petha", "Kohala"],                                scientific: "Benincasa hispida",       category: "vegetable", storage: "pantry" },
  { canonical: "Taro",        english: ["Taro", "Arbi", "Colocasia"],      hindi: ["अरबी", "Arbi", "Kachu", "Taro"],                        scientific: "Colocasia esculenta",     category: "root",      storage: "pantry" },
  { canonical: "Elephant Foot Yam", english: ["Elephant Foot Yam", "Jimikand"], hindi: ["जिमीकंद", "Jimikand", "Suran"],                     scientific: "Amorphophallus paeoniifolius", category: "root", storage: "pantry" },
  { canonical: "Pointed Gourd", english: ["Pointed Gourd", "Parwal"],      hindi: ["परवल", "Parwal", "Pointed Gourd"],                      scientific: "Trichosanthes dioica",    category: "vegetable", storage: "fridge" },
  { canonical: "Snake Gourd", english: ["Snake Gourd", "Chichinga"],        hindi: ["चिचिंडा", "Chichinda", "Snake Gourd"],                  scientific: "Trichosanthes cucumiformis", category: "vegetable", storage: "fridge" },
  { canonical: "Ridge Gourd", english: ["Ridge Gourd", "Luffa"],          hindi: ["तोरई", "Turai", "Ridge Gourd"],                          scientific: "Luffa acutangula",        category: "vegetable", storage: "fridge" },
  { canonical: "Yardlong Bean", english: ["Yardlong Bean", "Barbati"],    hindi: ["बरबट्टी", "Barbati"],                                   scientific: "Vigna unguiculata",       category: "vegetable", storage: "fridge" },
  { canonical: "Flat Bean",   english: ["Flat Bean", "Sem Phali"],         hindi: ["सेम फली", "Sem Phali"],                                 scientific: "Lablab purpureus",        category: "vegetable", storage: "fridge" },
  { canonical: "Coconut",     english: ["Coconut"],                        hindi: ["नारियल", "Nariyal", "Coconut"],                          scientific: "Cocos nucifera",          category: "other",     storage: "pantry" },
  { canonical: "Lime",        english: ["Lime", "Key Lime"],               hindi: ["नींबू", "Nimbu", "Lime"],                                scientific: "Citrus aurantiifolia",    category: "fruit",     storage: "fridge" },
  { canonical: "Green Papaya", english: ["Green Papaya", "Raw Papaya"],   hindi: ["कच्चा पपीता", "Kacha Papita"],                           scientific: "Carica papaya",          category: "vegetable", storage: "fridge" },
  { canonical: "Red Amaranth", english: ["Red Amaranth", "Laal Saag"],      hindi: ["लाल साग", "Laal Saag", "Red Amaranth"],                  scientific: "Amaranthus cruentus",     category: "leafy",     storage: "fridge" },
  { canonical: "Malabar Spinach", english: ["Malabar Spinach", "Poi Saag"], hindi: ["पोई साग", "Poi Saag"],                                  scientific: "Basella alba",            category: "leafy",     storage: "fridge" },
  { canonical: "Gooseberry",  english: ["Gooseberry", "Amla", "Indian Gooseberry"], hindi: ["आंवला", "Amla"],                              scientific: "Phyllanthus emblica",     category: "fruit",     storage: "fridge" },
  { canonical: "Plantain",    english: ["Plantain", "Raw Banana"],          hindi: ["केला", "Kela"],                                          scientific: "Musa",                    category: "fruit",     storage: "counter" },
  { canonical: "Shaluk",      english: ["Shaluk", "Water Chestnut"],        hindi: ["शालुक", "Shaluk"],                                        scientific: "Trapa natans",            category: "root",      storage: "fridge" },
  { canonical: "Jicama",      english: ["Jicama", "Yam Bean"],             hindi: ["जिकामा", "Jicama"],                                      scientific: "Pachyrhizus erosus",      category: "root",      storage: "pantry" },
  { canonical: "Kohlrabi",    english: ["Kohlrabi"],                       hindi: ["गांठ गोभी", "Ganth Gobhi", "Kohlrabi"],                  scientific: "Brassica oleracea",       category: "vegetable", storage: "fridge" },
  { canonical: "Chives Onion", english: ["Chives", "Chinese Chives"],      hindi: ["चाइव्स", "Chives"],                                     scientific: "Allium tuberosum",        category: "spice",     storage: "fridge" },
];

/**
 * Words too generic to fuzzy-match anything. "Bean" is a substring of
 * "Yam Bean" (Jicama), so an unguarded substring match sends every photo the
 * user thinks is beans to Jicama. These only ever match on an EXACT alias.
 */
const AMBIGUOUS_LABELS = new Set([
  'bean', 'beans', 'pea', 'peas', 'corn', 'melon', 'squash', 'gourd',
  'pepper', 'potato', 'greens', 'leaf', 'leaves', 'fruit', 'vegetable',
]);

/** Map any label (from overwatch / plantnet / user input) to the closest BanglaVeg canonical name. */
export function mapToBanglaVeg(label: string): BanglaVegClass | null {
  const l = String(label ?? "").trim().toLowerCase();
  if (!l) return null;
  const ambiguous = AMBIGUOUS_LABELS.has(l);
  let best: { cls: BanglaVegClass; score: number } | null = null;
  for (const cls of BANGLABEG_VOCAB) {
    const candidates = [...cls.english, ...cls.hindi].map((s) => s.toLowerCase());
    for (const c of candidates) {
      if (c === l) return cls;       // exact wins — including for ambiguous words
      if (ambiguous) continue;      // ...but never fuzzy-matched
      // Substring match must land on a whole word, so "corn" can't be found
      // hiding inside "popcorn"-style aliases.
      const inCandidate = c.includes(l) && new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c);
      const inLabel = l.includes(c) && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l);
      if (inCandidate || inLabel) {
        const score = 1 - Math.abs(c.length - l.length) / Math.max(c.length, l.length, 1);
        if (!best || score > best.score) best = { cls, score };
      }
    }
  }
  return best && best.score > 0.4 ? best.cls : null;
}

/** Was this label ingested from the BanglaVegNet dataset? (CC BY 4.0 attribution). */
export const BANGLABEG_ATTRIBUTION =
  'Vocabulary derived from "BanglaVegNet: A Multiclass Image Dataset of Traditional Vegetables in Bangladesh" — Mendeley Data, DOI: 10.17632/rtx9ngb68j, licensed CC BY 4.0. Modifications: extracted class names and aliases only; no images redistributed.';

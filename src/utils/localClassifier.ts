/**
 * Local on-device classifier — TensorFlow.js MobileNet (v2, alpha 1.0).
 *
 * Runs entirely in the browser, no network call, no auth, no API key.
 * The model (~16 MB) downloads once from the Google TF.js CDN and is then
 * cached locally. After the first scan, recognition is instant.
 *
 * MobileNet was trained on ImageNet 1K, which covers ~10 of the ~40 common
 * Indian-kitchen vegetables (broccoli, cauliflower, cucumber, bell pepper,
 * corn, mushroom, lemon, orange, banana, butternut/acorn squash). PlantNet
 * (next tier in the chain) covers the rest.
 *
 * We map MobileNet's verbose ImageNet labels (e.g. "cucumber, cuke") to
 * friendly names and then to BanglaVegNet canonical names where possible.
 */

// Lazy-load tf + mobilenet so the main bundle stays light.
let modelPromise: Promise<any> | null = null;
let modelRef: any = null;

async function getModel() {
  if (modelRef) return modelRef;
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      // Wait for backend to init before loading the model.
      await tf.ready();
      const mobilenet = await import('@tensorflow-models/mobilenet');
      const m = await mobilenet.load({ version: 2, alpha: 1.0 });
      modelRef = m;
      return m;
    })();
  }
  return modelPromise;
}

export type LocalPrediction = {
  label: string;
  confidence: number;
  categoryHint?: 'vegetable' | 'fruit' | 'leafy' | 'root' | 'spice' | 'other';
  storage?: 'fridge' | 'pantry' | 'freezer' | 'counter';
  source: 'mobilenet';
  notes?: string;
};

/** Mapping of ImageNet labels (lowercased, comma-separated) → BanglaVegNet class lookup. */
const IMAGENET_TO_BANGLABEG: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /^broccoli$/,                                      canonical: 'Broccoli' },
  { pattern: /^cauliflower$/,                                  canonical: 'Cauliflower' },
  { pattern: /^cucumber[,\s]/,                                 canonical: 'Cucumber' },
  { pattern: /^bell pepper$/,                                   canonical: 'Capsicum' },
  { pattern: /^mushroom/,                                       canonical: 'Mushroom' },
  { pattern: /^lemon$/,                                         canonical: 'Lemon' },
  { pattern: /^orange$/,                                        canonical: 'Orange' },
  { pattern: /^banana$/,                                        canonical: 'Banana' },
  { pattern: /^corn/,                                           canonical: 'Corn' },
  { pattern: /^butternut squash$/,                              canonical: 'Pumpkin' },
  { pattern: /^acorn squash$/,                                  canonical: 'Pumpkin' },
  { pattern: /^spaghetti squash$/,                              canonical: 'Pumpkin' },
  { pattern: /^zucchini/,                                       canonical: 'Zucchini' },
  { pattern: /^pumpkin$/,                                       canonical: 'Pumpkin' },
];

/** Pick a clean friendly name from MobileNet's className. */
function pickFriendlyLabel(raw: string): string {
  const cleaned = raw.split(',')[0].trim();
  // Capitalise first letter.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Map a MobileNet top prediction to BanglaVegNet canonical where possible. */
function toBanglaVegCanonical(rawClassName: string): { canonical: string; matched: boolean } {
  const norm = rawClassName.toLowerCase().trim();
  for (const { pattern, canonical } of IMAGENET_TO_BANGLABEG) {
    if (pattern.test(norm)) return { canonical, matched: true };
  }
  return { canonical: pickFriendlyLabel(rawClassName), matched: false };
}

const FRUIT_HINTS = ['lemon', 'orange', 'banana', 'apple', 'mango', 'guava'];
const VEG_HINTS = ['broccoli', 'cauliflower', 'cucumber', 'pepper', 'corn', 'zucchini', 'squash', 'pumpkin'];
const LEAFY_HINTS = ['broccoli', 'cauliflower', 'cabbage', 'lettuce', 'spinach'];
const SPICE_HINTS = ['cinnamon', 'pepper', 'ginger'];

function categoryFor(rawClassName: string): LocalPrediction['categoryHint'] {
  const norm = rawClassName.toLowerCase();
  if (FRUIT_HINTS.some((h) => norm.includes(h))) return 'fruit';
  if (SPICE_HINTS.some((h) => norm.includes(h))) return 'spice';
  if (LEAFY_HINTS.some((h) => norm.includes(h))) return 'leafy';
  if (VEG_HINTS.some((h) => norm.includes(h))) return 'vegetable';
  return 'vegetable';
}

/** Run MobileNet on an image Blob. Returns at most 5 predictions. */
export async function classifyWithMobileNet(image: Blob): Promise<LocalPrediction[]> {
  const model = await getModel();

  // Decode the Blob to an HTMLImageElement (MobileNet accepts that natively).
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0);

  let raw: Array<{ className: string; probability: number }>;
  try {
    raw = await model.classify(canvas, 5);
  } catch (err) {
    console.warn('[mobilenet] classify failed:', err);
    return [];
  }

  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((r) => {
    const { canonical } = toBanglaVegCanonical(r.className);
    return {
      label: canonical,
      confidence: r.probability,
      categoryHint: categoryFor(r.className),
      storage: 'fridge' as const,
      source: 'mobilenet' as const,
      notes: `MobileNet (ImageNet) · ${r.className}`,
    };
  });
}

/** Indicate whether the model is ready (modelRef loaded) — for UI hints. */
export function isLocalClassifierReady(): boolean {
  return modelRef !== null;
}

/** Kick off the model load early (call after mount to warm cache). */
export function warmLocalClassifier(): void {
  void getModel().catch(() => {});
}

import { bridgeHeaders } from './bridgeToken';

/**
 * Read a meal off a photo.
 *
 * Two jobs, one endpoint: name the dishes in a photo of the food, or
 * transcribe a handwritten recipe card.
 *
 * The important design rule here is that nothing this returns is ever saved
 * automatically. Vision models are confidently wrong in ways that are hard to
 * spot — "Palak paneer" comes back as "Palak panner", a quantity becomes a
 * guess. A wrong dish name silently written into the meal log would then feed
 * the taste model and drag the taste-match score with nothing to show where it
 * went wrong. So the reading always goes back to the user for confirmation
 * first, and it arrives as editable text rather than a locked-in answer.
 */

export type ReadMode = 'dish' | 'handwritten';

export interface RecipeReading {
  /** One short line naming the dish or recipe. */
  summary: string;
  /** Each dish or ingredient, one per line. */
  items: string[];
  /** Instructions, in order. */
  steps: string[];
  /** The model's own confidence, when it reports one. */
  confidence: number | null;
  /** Anything it flagged as not clearly legible. */
  uncertain: string[];
  mode: ReadMode;
}

export type ReadResult =
  | { ok: true; reading: RecipeReading }
  | { ok: false; error: string; message?: string };

/** Bridge base, preferring the configured one and falling back to our origin. */
function bridgeBase(): string {
  const configured = (import.meta as any).env?.VITE_API_BASE_URL || '';
  if (configured) return configured.replace('localhost', '127.0.0.1');
  if (typeof window !== 'undefined') return window.location.origin.replace('localhost', '127.0.0.1');
  return '';
}

/** Plain-language reason, so the UI never shows a bare error code. */
function explain(error: string, message?: string): string {
  switch (error) {
    case 'no_image':
      return 'That file did not contain a readable image. Try a different photo.';
    case 'unreachable':
      return 'Could not reach the app server. Check that HomeHub is running.';
    case 'image_too_small':
      return message ?? 'That photo is too small to read. Try a closer, brighter photo.';
    case 'nothing_recognised':
      return "I couldn't tell what was in that photo. Try a clearer shot, or just type what you cooked.";
    case 'unreadable_response':
      return 'The photo was read but not in a usable form. Try again.';
    case 'minimax_not_configured':
      return 'Photo reading is not set up on this machine.';
    case 'minimax_unreachable':
      return 'The vision service did not answer. Try again in a moment.';
    default:
      return message || 'Could not read that photo. You can always type what you cooked instead.';
  }
}

export async function readMealPhoto(
  image: Blob,
  mode: ReadMode,
): Promise<ReadResult> {
  if (!image || image.size === 0) {
    return { ok: false, error: 'no_image' };
  }

  const form = new FormData();
  form.append('image', image, 'meal.jpg');
  form.append('mode', mode);

  // Vision calls are slow — a busy first pass can take 30s+ — so the client
  // budget sits above the bridge's own timeout rather than below it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);

  try {
    const res = await fetch(`${bridgeBase()}/api/minimax/read-recipe`, {
      method: 'POST',
      headers: bridgeHeaders(),
      body: form,
      signal: ctrl.signal,
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      return { ok: false, error: 'bad_json' };
    }

    if (!res.ok || !json.ok) {
      return { ok: false, error: json?.error ?? 'http_error', message: explain(json?.error ?? 'http_error', json?.message) };
    }

    return {
      ok: true,
      reading: {
        summary: String(json.summary ?? '').trim(),
        items: Array.isArray(json.items) ? json.items.map(String) : [],
        steps: Array.isArray(json.steps) ? json.steps.map(String) : [],
        confidence: typeof json.confidence === 'number' ? json.confidence : null,
        uncertain: Array.isArray(json.uncertain) ? json.uncertain.map(String) : [],
        mode: (json.mode === 'handwritten' ? 'handwritten' : 'dish') as ReadMode,
      },
    };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, error: 'timeout', message: 'That took too long. Try a smaller photo.' };
    }
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flatten a reading into the one-liner the quick-log field wants.
 *
 * Transcription keeps the page structure it found — bullets, and headings
 * like "Breakfast:" or "Lunch:" from a recipe card or a day's plan. Those are
 * useful to show but wrong inside a one-line description, so bullets are
 * stripped and pure headings dropped. The result is still handed to the user
 * to edit, so this tidies the reading rather than deciding it.
 */
export function readingToLine(reading: RecipeReading): string {
  const cleaned: string[] = [];

  for (const raw of reading.items) {
    const item = raw.replace(/^[\s\-*•·]+/, '').trim();
    if (!item) continue;

    // A bare heading carries no dish information: "Breakfast:", "Lunch:",
    // "Ingredients", "For the dough".
    const isHeading = /[:：]\s*$/.test(item) || /^(ingredients?|method|directions?|steps?|serves?|for the .+)$/i.test(item);
    if (isHeading) continue;

    cleaned.push(item);
  }

  const body = cleaned.length ? cleaned.join(', ') : '';
  if (reading.summary && body) return `${reading.summary} — ${body}`;
  return body || reading.summary;
}
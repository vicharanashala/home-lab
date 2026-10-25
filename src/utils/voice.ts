/**
 * Which voice House Bot speaks with, and where that choice is kept.
 *
 * WHY IT IS ITS OWN MODULE: the voice is read in two places that MUST agree —
 * the Settings card that shows the choice, and the hook that speaks the reply.
 * When those two each had a default of their own, the card showed one voice
 * and House Bot spoke with another, and the user had no way to tell which was
 * true. One module, one answer: the card and the voice now ask the same
 * question and get the same reply.
 */

/** The key the chosen voice is stored under. */
export const VOICE_STORAGE_KEY = 'homehub.voice';

/**
 * The voice the app speaks with when the household has not chosen one.
 *
 * WHY IT IS MIXED AND NOT A SINGLE INDIAN VOICE: the commit that added the
 * Mixed voice (c89a17a) made Mixed the default on purpose — Indian dish names
 * in an Indian voice, the English around them in an English one. The Settings
 * card kept a default of its own and still said "Aditi", so the card showed
 * Aditi checked while the app spoke with Mixed.
 */
export const DEFAULT_VOICE_ID = 'mixed';

/** The name each voice is shown under. */
export const VOICE_LABELS: Record<string, string> = {
  mixed: 'Indian dishes, English words',
  hf_alpha: 'Aditi', hf_beta: 'Priya',
  hm_omega: 'Arjun', hm_psi: 'Kabir',
  af_heart: 'Ava', af_bella: 'Bella', af_nicole: 'Nina', af_sarah: 'Sarah', af_sky: 'Skye',
  am_michael: 'Michael', am_fenrir: 'Fenrir', am_puck: 'Puck', am_echo: 'Echo',
  bf_emma: 'Emma', bf_isabella: 'Isabella', bf_lily: 'Lily',
  bm_daniel: 'Daniel', bm_george: 'George',
};

/**
 * What the user is told when the browser refused to store the chosen voice.
 *
 * WHY IT SAYS WHICH VOICE IS IN USE: a refused write leaves the old voice in
 * the storage, and the old voice is the one that will speak. "Not saved" on
 * its own would leave the user guessing whether the chip they just tapped is
 * the voice House Bot will use.
 */
export const VOICE_NOT_SAVED_MESSAGE =
  'Voice not saved — your browser refused to store it, so House Bot is still using the old voice.';

/**
 * The browser's storage, or null when there is none to use.
 *
 * WHY THIS IS NOT `window.localStorage` DIRECTLY: a browser that refuses
 * storage throws a SecurityError when the app READS `window.localStorage`,
 * not only when it writes to it — Safari with cookies blocked, a private
 * window. Reading the bare `localStorage` global throws for the same reason,
 * so even `typeof localStorage === 'undefined'` throws there: that check
 * cannot tell "there is no storage" from "the browser will not answer".
 *
 * WHY IT IS THE PATTERN `foodTrainer` AND `endOfDayReminder` ALREADY USE:
 * those modules store their preferences the same way, and it is the house
 * answer for a storage that may refuse.
 */
function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The voice the app speaks with, and the voice the Settings card shows.
 *
 * WHY IT IS ONE FUNCTION AND NOT A CONSTANT READ IN TWO PLACES: the card and
 * the hook have to agree, and two reads of the same key can disagree if one
 * of them falls back differently. They call this instead.
 *
 * @returns the stored voice, or the default when nothing is stored
 */
export function storedVoiceId(): string {
  const s = safeStorage();
  if (!s) return DEFAULT_VOICE_ID;
  try {
    return s.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE_ID;
  } catch {
    return DEFAULT_VOICE_ID;
  }
}

/**
 * Keep the chosen voice, and say whether the browser kept it.
 *
 * WHY IT REPORTS INSTEAD OF SWALLOWING: the write used to be swallowed inside
 * the picker, so the chip moved to a voice the browser had refused to store
 * — the card would then show a voice House Bot does not speak with, and the
 * chip would jump back on the next reload. A refused write has to be said
 * out loud, or it is a lie on the screen.
 *
 * @returns whether the browser stored the voice
 */
export function saveVoiceId(id: string): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    s.setItem(VOICE_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

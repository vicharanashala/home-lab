/**
 * Deciding whether a piece of transcribed text is worth keeping.
 *
 * Whisper is extremely good at speech and extremely good at inventing text
 * when there is no speech. Given a few seconds of a room, a fan or a stray
 * "hmm", it will happily produce a fluent sentence — and it will do that
 * with total confidence, because a hallucination is exactly as confident as a
 * real transcription.
 *
 * In a meal plan a hallucination is worse than silence: a slot holding
 * "Thank you. Thank you." is a slot holding a dish that does not exist.
 *
 * These are pure functions, kept out of the hook, so they can be tested
 * without a microphone.
 */

/** Whisper's classic inventions on quiet audio. Dropping them is not optional. */
export const HALLUCINATIONS = new Set([
  'you', 'thank you.', 'thank you', 'thanks for watching!', 'thanks for watching',
  'bye.', 'bye', '.', '...', 'the', 'so', 'um', 'uh',
  '字幕由amara.org社群提供', '字幕志愿者', '請不吝點贊訂閱轉發打賞支持明鏡與點點欄目',
]);

/**
 * How loud the audio has to be before a short phrase is taken seriously.
 *
 * Below SILENCE_RMS nobody is talking; below 2.5x that, only a filler can
 * have been heard. It lives here, with the rules that use it, so the tests
 * and the app cannot drift apart — the tests used to carry their own copy
 * of this number, which meant they could pass while the app behaved
 * differently.
 */
export const SILENCE_RMS = 0.006;

/**
 * The punctuation Whisper puts on the ends of words.
 *
 * It matters because the sets above hold BARE words: "um", "okay", "bye".
 * Whisper writes "um." and "Okay.", so a word has to lose its punctuation
 * before it can be looked up. Without that, the lookup missed almost every
 * word the model actually produced — a filler said on quiet audio was not
 * found in the set of fillers, and reached the meal plan as a dish.
 *
 * Only the ENDS are stripped, so "don't" keeps its apostrophe and stays
 * one word.
 */
const EDGE_PUNCTUATION_RE = /^[.,!?;:"'`…’“”]+|[.,!?;:"'`…’“”]+$/g;

/** A word with the punctuation on its ends taken off. */
export function bareWord(word: string): string {
  return word.replace(EDGE_PUNCTUATION_RE, '');
}

/**
 * Filler sounds. These are never a dish, so a quiet recording that produced
 * only one of them is noise and not an utterance.
 *
 * The list is deliberately short and free of anything that could be a dish.
 * An earlier version dropped EVERY short quiet phrase, which threw away real
 * one-word dishes — "idli", "dal", "upma" — because they are short and were
 * spoken quietly.
 */
export const FILLERS = new Set([
  'um', 'uh', 'ah', 'oh', 'mm', 'hmm', 'mm-hmm', 'okay', 'yep', 'yeah',
  'nah', 'nope', 'huh', 'right', 'yes', 'no', 'bye', 'hi', 'hello',
]);

/**
 * True when the same words repeat back to back.
 *
 * Whisper's signature loop is a repeated PHRASE: "I'm sorry. I'm sorry.
 * I'm sorry." That has plenty of distinct words, so a check for repeated
 * words alone never caught it — and a loop that slips through puts a whole
 * sentence of rubbish into the plan.
 */
export function hasRepeatedPhrase(words: string[]): boolean {
  for (let n = 1; n * 2 <= words.length; n++) {
    // A single word needs more repeats before it counts: "dal dal" is
    // someone saying dal twice, but "dal dal dal dal" is a loop.
    const needed = n === 1 ? 4 : 3;
    // EVERY starting point, not only the beginning. A loop that starts
    // after a word or two is still a loop — Whisper says something and
    // THEN falls into the repetition — and looking only at the front
    // missed exactly that case, so the loop went straight into the plan.
    for (let start = 0; start + n * needed <= words.length; start++) {
      const gram = words.slice(start, start + n).join(' ');
      let repeats = 1;
      for (let i = start + n; i + n <= words.length; i += n) {
        if (words.slice(i, i + n).join(' ') !== gram) break;
        repeats++;
      }
      if (repeats >= needed) return true;
    }
  }
  return false;
}

/**
 * Fold a newly transcribed block into the transcript.
 *
 * Returns the transcript to show, or null when the block has to be thrown
 * away — in which case the caller starts again from empty.
 *
 * A LOOP CAN SPAN BLOCKS.
 *
 * Each five-second block of a hum produces the same sentence, so no single
 * block looks wrong and the block-level check never fires — but joined
 * together they read "I'm sorry. I'm sorry. I'm sorry." six times over, and
 * that is what reached the plan. So the joined transcript is checked too.
 *
 * When it loops, the whole thing is the model repeating itself, so it is
 * dropped rather than kept in part. Leaving nothing is the honest answer:
 * the user is told nothing was picked up, instead of being handed six
 * sentences of rubbish.
 */
export function foldTranscript(current: string, text: string): string | null {
  const joined = current ? `${current} ${text}` : text;
  const words = joined.toLowerCase().split(/\s+/).map(bareWord);
  if (hasRepeatedPhrase(words)) return null;
  return joined;
}

/**
 * Is this transcript rubbish?
 *
 * @param text   what Whisper produced
 * @param level  how loud the audio was, as RMS
 */
export function looksLikeArtifact(text: string, level: number, silenceRms: number): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.length < 2) return true;
  if (HALLUCINATIONS.has(t)) return true;

  // The same words with the punctuation taken off. Whisper punctuates what
  // it hears, and the sets above hold bare words, so the lookup has to be
  // done on the bare form too — otherwise "um." was not "um", and a filler
  // said on quiet audio reached the plan as if it were a dish.
  const words = t.split(/\s+/).map(bareWord);
  const bareText = words.join(' ').trim();
  if (!bareText) return true;
  if (HALLUCINATIONS.has(bareText)) return true;

  // Whisper loops when handed thin audio.
  if (words.length >= 6 && new Set(words).size <= 2) return true;
  // ...and it loops on a phrase as readily as on a word.
  if (hasRepeatedPhrase(words)) return true;

  // A short, quiet fragment is usually a filler — but only if it IS one.
  // "idli" is two syllables of a real dish, and dropping every short quiet
  // phrase meant a single-word dish was silently thrown away.
  if (
    level < silenceRms * 2.5 &&
    words.length <= 2 &&
    words.every((w) => FILLERS.has(w))
  ) {
    return true;
  }
  return false;
}

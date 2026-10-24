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
 * Where a loop starts and ends in a list of words.
 *
 * The END matters as much as the start. A loop is a span of words, and the
 * span is what has to be removed — cutting from the start of the loop to the
 * end of the text removes the user's speech along with it.
 */
interface LoopSpan {
  start: number;
  end: number;
}

/**
 * The first loop in a list of words, or null when there is none.
 *
 * Whisper's signature loop is a repeated PHRASE: "I'm sorry. I'm sorry.
 * I'm sorry." That has plenty of distinct words, so a check for repeated
 * words alone never caught it — and a loop that slips through puts a whole
 * sentence of rubbish into the plan.
 *
 * WHY THE SPAN AND NOT ONLY THE FACT: the model only starts repeating at
 * some word, and everything BEFORE that word is the user's own speech. So
 * the place the loop begins is what decides how much of the transcript has
 * to go — and where it ends is what decides how much has to be KEPT.
 */
function findLoop(words: string[]): LoopSpan | null {
  let best: LoopSpan | null = null;
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
      if (repeats < needed) continue;
      const end = start + n * repeats;
      // The EARLIEST start wins. A longer phrase can begin before the
      // shorter one that happened to be found first, and the shorter one
      // would then be read as part of the user's speech.
      //
      // At the SAME start the LONGEST span wins. A two-word loop also
      // contains a one-word loop, so the short one is found first and
      // cutting it would leave the rest of the loop behind: "I'm sorry"
      // four times over would become "sorry sorry sorry sorry", which is
      // still rubbish and would still reach the plan.
      if (
        !best ||
        start < best.start ||
        (start === best.start && end > best.end)
      ) {
        best = { start, end };
      }
    }
  }
  return best;
}

/** Where a repeated phrase starts in a list of words, or -1 when there is none. */
export function repeatedPhraseStart(words: string[]): number {
  return findLoop(words)?.start ?? -1;
}

/** True when the same words repeat back to back. */
export function hasRepeatedPhrase(words: string[]): boolean {
  return findLoop(words) !== null;
}

/**
 * Cut the repeated phrases out of a piece of text.
 *
 * Returns the text with the loops removed, or null when the whole thing WAS
 * a loop and nothing is left.
 *
 * WHY THE LOOP IS CUT OUT AND NOT EVERYTHING FROM IT ONWARDS: the model only
 * starts repeating at some word, and the words around that word are the
 * user's own speech. Dropping those too meant that saying "breakfast masala
 * dosa" and then having a hum set off Whisper's "I'm sorry. I'm sorry." left
 * the user with NOTHING — the app said "nothing was picked up" when it had
 * picked up exactly what they said.
 *
 * AND WHY THE END OF THE LOOP MATTERS AS MUCH AS ITS START: Whisper opens
 * its hallucinations with the one it likes best — "Thank you.", "I'm sorry."
 * — and only then transcribes the speech that follows, so the loop is
 * usually at the FRONT of a block and the dish the user said is BEHIND it.
 * Cutting from the start of the loop to the end of the block took the dish
 * with it, and the app said "nothing was picked up" when the dish had been
 * heard perfectly well.
 */
export function trimLoop(text: string): string | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const rawWords = raw.split(/\s+/);
  // The loop is found on the bare, lower-cased words, but the text that is
  // handed back is the ORIGINAL — the user's own spelling and punctuation
  // are not the model's to change.
  const comparable = rawWords.map((w) => bareWord(w.toLowerCase()));

  const kept: string[] = [];
  let at = 0;
  while (at < rawWords.length) {
    const loop = findLoop(comparable.slice(at));
    if (!loop) {
      kept.push(...rawWords.slice(at));
      break;
    }
    // The speech before the loop is the user's, so it is kept.
    kept.push(...rawWords.slice(at, at + loop.start));
    // The loop itself goes, and the scan carries on after it: two loops in
    // one block ("Thank you" four times, then "I'm sorry" four times) have
    // to leave nothing behind, and one loop's removal can expose another.
    at += loop.end;
  }
  const out = kept.join(' ').trim();
  return out || null;
}

/**
 * Fold a newly transcribed block into the transcript.
 *
 * Returns the transcript to show, or null when there is nothing left to
 * show — in which case the caller starts again from empty.
 *
 * A LOOP CAN SPAN BLOCKS.
 *
 * Each five-second block of a hum produces the same sentence, so no single
 * block looks wrong and the block-level check never fires — but joined
 * together they read "I'm sorry. I'm sorry. I'm sorry." six times over, and
 * that is what reached the plan. So the joined transcript is checked too.
 *
 * WHAT IS DROPPED IS THE LOOP, NOT EVERYTHING IN FRONT OF IT: the words
 * before the model starts repeating are the user's own speech. Throwing
 * those away as well meant that a hum arriving after the user had said
 * their breakfast left them with an empty transcript — "nothing was picked
 * up" — when their breakfast had been picked up perfectly well.
 */
export function foldTranscript(current: string, text: string): string | null {
  const joined = current ? `${current} ${text}` : text;
  return trimLoop(joined);
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

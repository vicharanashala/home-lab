import { useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, Check, X, Sparkles } from 'lucide-react';
import { useWhisperSTT, WHISPER_MODELS, STT_LANGUAGES, AUTO_MODEL } from '../hooks/useWhisperSTT';
import { parseSpokenPlanResult } from '../utils/spokenPlan';
import type { SpokenPlan } from '../utils/spokenPlan';
import {
  resolveSpokenPlan,
  retypeDish,
  pickDish,
  isDishName,
} from '../utils/spokenRecipeMatch';
import { spokenPlanClears, spokenPlanEditSlot, spokenPlanError, spokenPlanOutcome } from '../utils/spokenPlanEntries';
import type { SpokenDraft, SpokenPlanOutcome } from '../utils/spokenPlanEntries';
import { sheetNoteFor } from '../utils/spokenPlanSheet';
import type { DishResolution } from '../utils/spokenRecipeMatch';
import type { MealPlanDayPlan, MealSlot, Recipe } from '../types';

interface Props {
  /**
   * Apply the parsed slots. Only the slots present in the plan are touched.
   * The second argument says what each slot was heard as and what it was
   * matched to, so the caller can link the dish to its recipe. The third says
   * which meals a refusal empties — those are removed, not written.
   */
  onApply: (
    plan: SpokenPlan,
    resolutions: Record<string, DishResolution>,
    cleared: MealSlot[],
  ) => void;
  /** Every recipe the app knows, so a spoken dish can be matched to a real one. */
  catalogue: Recipe[];
  /** Ids of the app's curated recipes, which win ties against scraped ones. */
  preferredIds?: Set<string>;
  /**
   * The day as it stands, so a refusal can be matched against the dish the
   * day is actually holding.
   */
  dayPlan?: MealPlanDayPlan;
}

/**
 * What the sheet is holding: the dishes that were heard, and the meals a
 * refusal empties.
 *
 * WHY THE CLEARED MEALS ARE KEPT APART FROM THE PLAN: a refused meal holds
 * no dish, so it cannot be a slot with an empty dish — it is the ABSENCE of
 * one, and the absence of a slot in the plan means "the user did not mention
 * this meal", which is a different thing entirely. The user said "no dal for
 * dinner": the dinner is not left alone, and it is not filled with something
 * else. It is emptied.
 */
/**
 * Say the day's meals out loud instead of typing them.
 *
 * Uses the on-device Whisper engine: the audio never leaves this browser, it
 * works with no internet, and it handles Indian languages — all of which the
 * browser's own recogniser cannot promise.
 *
 * Whisper only knows what it heard, not what was meant, so the transcript is
 * always shown with the slots it parsed out, each editable, and nothing is
 * written to the plan until "Yes, add these" is pressed. Meals the user did
 * not mention are left exactly as they were.
 *
 * What was heard is then matched against the recipe catalogue, because
 * Whisper hears "masala dosaa" and "painter tikka" and the catalogue knows
 * "Masala dosa" and "Paneer tikka". A correction is only applied when the
 * match is certain; otherwise the heard words are kept and the candidates
 * are offered, because a wrong dish in the plan is worse than a rough one.
 */
export function SpeakYourPlan({ onApply, catalogue, preferredIds, dayPlan }: Props) {
  const [model, setModel] = useState(AUTO_MODEL);
  const [language, setLanguage] = useState('en-IN');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SpokenDraft | null>(null);
  /** What was heard, and what it was matched to, for each slot. */
  const [resolutions, setResolutions] = useState<Record<string, DishResolution>>({});
  const [showSetup, setShowSetup] = useState(false);
  const [typed, setTyped] = useState('');
  /** True while the transcription queue is being flushed. */
  const [flushing, setFlushing] = useState(false);
  /** Guards against a second tap starting a second flush. */
  const flushingRef = useRef(false);

  const whisper = useWhisperSTT(model, language);

  /**
   * Whether a phrase names a dish the app knows.
   *
   * WHY THE PARSER IS GIVEN THIS: "no" and "without" are refusal words, and
   * they are ALSO parts of 85 recipe names — "No Onion No Garlic Lobia
   * Masala", "Red Lentil Curry Without Coconut". The words alone cannot say
   * which is which, so the parser asks the catalogue.
   *
   * WHY THE CATALOGUE IS ASKED WHETHER THE PHRASE IS THE NAME AND NOT
   * WHETHER IT MATCHES ONE: the parser uses the answer to decide that a
   * refusal word inside the phrase is part of a dish's own NAME. A phrase
   * that merely MATCHES a dish is not that dish's name, and answering the
   * looser question lost refusals — "rice, no dal" matches "Dal-rice", so
   * the dal the user had refused was read as part of a dish's name and the
   * refusal was swallowed. `isDishName` is the one rule for it, and the test
   * that proves this hands the parser the same rule the app does.
   */
  const knownDish = useMemo(
    () => (phrase: string): boolean => isDishName(phrase, catalogue),
    [catalogue],
  );

  /**
   * Parse the transcript and then try to match each dish to a real recipe.
   *
   * Both the spoken and the typed path go through here: a typo is the same
   * problem as a mis-heard word.
   *
   * WHY A REFUSAL IS PART OF THE DRAFT AND NOT A SEPARATE SCREEN: the parser
   * takes a refused dish out of the plan, so a plan of nothing is what a
   * refusal looks like — and a plan of nothing used to read as "the user did
   * not say anything about any meal", which is not what they said at all.
   */
  const buildDraft = (
    text: string,
  ): { draft: SpokenDraft | null; outcome: SpokenPlanOutcome } => {
    const { plan: parsed, refusals } = parseSpokenPlanResult(text, knownDish);
    // What the utterance did: a plan to fill, a refusal with nothing to
    // remove, or nothing understood. The three are told apart here so that
    // the message the user reads is the one that is true.
    //
    // WHY THE REFUSAL WITH NOTHING TO REMOVE IS ITS OWN OUTCOME: the app
    // understood that utterance perfectly — the meal and the dish were both
    // named — and there was simply no dal to remove. Telling the user the
    // app "could not tell which meal it was for" was the app claiming not to
    // understand when it did, and it sent the user off to repeat themselves.
    const outcome = spokenPlanOutcome(parsed, refusals, dayPlan);
    if (outcome.kind !== 'plan') return { draft: null, outcome };
    const { plan, resolutions: found } = resolveSpokenPlan(parsed, catalogue, preferredIds);
    setResolutions(found);
    return { draft: { plan, refusals }, outcome };
  };

  /**
   * The meals a refusal empties, as they stand RIGHT NOW.
   *
   * WHY THIS IS WORKED OUT AGAIN INSTEAD OF BEING KEPT IN THE DRAFT: the
   * refusals are what the user said, and they do not change because a field
   * was edited — but the meals they empty do, because a meal the plan fills
   * is not emptied by a refusal beside it. Working it out from the refusals
   * and the plan as it is now means the sheet says exactly what the page
   * will do, and it says it again when the field is emptied and the refusal
   * is standing once more.
   */
  const cleared = draft ? spokenPlanClears(draft.refusals, draft.plan, dayPlan) : [];

  const toggle = async () => {
    setError(null);
    if (whisper.listening) {
      whisper.stop();
      return;
    }
    setDraft(null);
    setResolutions({});
    const res = await whisper.start(() => {});
    if (!res.ok && res.error !== 'Cancelled.') setError(res.error ?? 'Could not start the microphone.');
  };

  /**
   * Stop listening and show whatever was understood, ready to be edited.
   *
   * The transcription queue is drained ASYNCHRONOUSLY: `stop()` hands the
   * tail of the utterance to the queue and returns at once. Reading the
   * transcript in the same tick therefore missed whatever was still in
   * flight — in practice the last dish spoken, usually dinner — and an
   * utterance shorter than five seconds produced nothing at all, because
   * only a full block is transcribed on its own. So the text is read AFTER
   * the flush completes.
   */
  const review = async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      whisper.stop();
      const text = await whisper.flush();
      const { draft, outcome } = buildDraft(text);
      if (!draft) {
        // The message is the one that is true: an utterance the app
        // understood but had nothing to do with says so, rather than
        // claiming the app could not tell which meal it was for.
        setError(spokenPlanError(text, outcome));
        return;
      }
      setError(null);
      setDraft(draft);
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  };

  /* ---- confirmation ---- */
  if (draft) {
    return (
      <div className="rounded-xl border border-sage-300 dark:border-sage-800 bg-sage-50/70 dark:bg-sage-900/25 p-2.5 mt-2">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={13} className="text-sage-600 dark:text-sage-300" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-sage-700 dark:text-sage-300">
            I heard — is this right?
          </span>
        </div>

        {(['breakfast', 'lunch', 'dinner'] as const).map((slot) => {
          const res = resolutions[slot];
          const current = draft.plan[slot] ?? '';
          // A meal the user refused: it is going to be REMOVED, which is not
          // what an empty slot means everywhere else in this sheet.
          const isCleared = cleared.includes(slot);
          // What the slot says about itself, and which dishes are offered
          // beside it.
          //
          // WHY IT IS ASKED IN ONE PLACE: the writer decides which recipe the
          // shopping list buys, and it asks `decideDish` too — so the note
          // under this slot says what the plan is about to do rather than the
          // two screens answering the same question differently.
          //
          // They DID answer it differently. The sheet asked "is the match
          // confident?" and the writer asked "is it confident OR did the user
          // pick it?", so a user who tapped a dish the matcher had been
          // unsure of was told "did you mean" and asked to choose again,
          // while the plan had already written that dish and linked its
          // recipe.
          const note = sheetNoteFor(res, current);
          return (
            <label key={slot} className="block mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sage-600 dark:text-sage-300">
                {slot}
              </span>
              <input
                value={current}
                placeholder={
                  isCleared
                    ? 'removed — type a dish to keep it instead'
                    : "leave empty to keep what's planned"
                }
                aria-label={`${slot} from speech`}
                onChange={(e) => {
                  const text = e.target.value;
                  // Only the DISH changes here. A refusal the user made by
                  // voice is not undone by editing a field: an empty field is
                  // the absence of a dish, not the user's dish, and dropping
                  // the refusal on the first keystroke put the refused dish
                  // back on the shopping list.
                  setDraft((d) =>
                    d ? spokenPlanEditSlot(d, slot, text) : d,
                  );
                  // The slot and the resolution have to move together.
                  //
                  // WHY: the slot says what the dish IS; the resolution says
                  // which RECIPE it is, and the shopping list is built from
                  // the recipe, not from the name. Moving the slot alone
                  // leaves the plan holding one dish and buying another — so
                  // a slot the user typed over is matched again, and a
                  // correction that names a real recipe links to it.
                  setResolutions((r) => {
                    if (!text.trim()) {
                      // The slot is empty again, so there is no dish to
                      // describe.
                      const next = { ...r };
                      delete next[slot];
                      return next;
                    }
                    return { ...r, [slot]: retypeDish(text, catalogue, preferredIds) };
                  });
                }}
                className="input w-full text-xs py-1.5 mt-0.5"
              />

              {isCleared && (
                <span className="block text-[10px] text-tomato-600 dark:text-tomato-300 mt-0.5">
                  you refused this dish — this meal will be removed
                </span>
              )}

              {note.kind === 'matched' && res && (
                <span className="block text-[10px] text-sage-600 dark:text-sage-300 mt-0.5">
                  heard “{res.heard}” → matched{' '}
                  <span className="font-semibold text-sage-800 dark:text-cream-100">
                    {note.matchedName}
                  </span>
                </span>
              )}

              {note.kind === 'suggest' && res && (
                <span className="block text-[10px] text-sage-600 dark:text-sage-300 mt-0.5">
                  heard “{res.heard}” — did you mean
                </span>
              )}

              {note.chips.length > 0 && (
                <span className="flex flex-wrap gap-1 mt-1">
                  {note.chips.slice(0, 5).map((m) => (
                    <button
                      key={m.recipe.id}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        // The dish the user tapped is now the meal's dish, so the
                        // meal is filled and a refusal beside it no longer
                        // empties it. The refusal itself is left standing —
                        // emptying the field again brings it back.
                        setDraft((d) => (d ? spokenPlanEditSlot(d, slot, m.name) : d));
                        // The resolution follows the slot. The dish the user
                        // tapped IS the dish the plan now holds, so it is the
                        // dish whose recipe has to be linked — otherwise the
                        // plan says "Paneer Tikka Masala" and the shopping
                        // list buys paneer tikka's ingredients.
                        //
                        // The match is taken at the user's word even when the
                        // matcher scored it low: they have already said which
                        // dish they meant.
                        setResolutions((r) => {
                          const current = r[slot];
                          if (!current) return r;
                          return { ...r, [slot]: pickDish(current, m) };
                        });
                      }}
                      className="rounded-md border border-sage-300 dark:border-sage-700 bg-white dark:bg-ink-800 px-1.5 py-0.5 text-[10px] text-sage-700 dark:text-ink-200 hover:bg-sage-50 dark:hover:bg-sage-900/40"
                    >
                      {m.name}
                    </button>
                  ))}
                </span>
              )}
            </label>
          );
        })}

        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => {
              onApply(draft.plan, resolutions, cleared);
              setDraft(null);
              setResolutions({});
              whisper.reset();
            }}
            className="btn-primary flex-1 !py-1.5 text-xs"
          >
            <Check size={13} />
            Yes, add these
          </button>
          <button
            type="button"
            onClick={() => { setDraft(null); setResolutions({}); whisper.reset(); }}
            className="btn-secondary !py-1.5 text-xs"
          >
            <X size={13} />
            Discard
          </button>
        </div>
      </div>
    );
  }

  /* ---- listening ---- */
  if (whisper.listening || flushing) {
    return (
      <div className="rounded-xl border border-tomato-200 dark:border-tomato-900 bg-tomato-50/60 dark:bg-tomato-900/20 p-2.5 mt-2">
        <div className="flex items-center gap-2 text-xs text-tomato-700 dark:text-tomato-300">
          <span className="w-2 h-2 rounded-full bg-tomato-500 animate-pulse" />
          {flushing
            ? 'Finishing the last words…'
            : whisper.status.text || 'Listening — say the meals for this day…'}
        </div>

        {whisper.status.progress !== null && (
          <div className="mt-2 h-1 rounded-full bg-tomato-200/60 overflow-hidden">
            <div
              className="h-full bg-tomato-500 transition-[width] duration-300"
              style={{ width: `${whisper.status.progress}%` }}
            />
          </div>
        )}

        {/* The engine's own errors. Without this the panel said "Listening"
            while every transcription was failing, which looks exactly like a
            microphone that works and does not. */}
        {whisper.status.error && (
          <p className="mt-2 text-[11px] leading-snug text-tomato-600 dark:text-tomato-300 break-words">
            {whisper.status.error}
          </p>
        )}

        {whisper.transcript && (
          <p className="mt-2 text-xs italic text-sage-700 dark:text-cream-100 break-words">
            “{whisper.transcript}”
          </p>
        )}

        <div className="flex gap-1.5 mt-2">
          {/* Never disabled for want of a transcript. The transcript only
              appears once a FULL five-second block has been transcribed, so
              a button that waits for one can never finish an utterance
              shorter than that. The flush is what produces the rest. */}
          <button
            type="button"
            onClick={review}
            className="btn-primary flex-1 !py-1.5 text-xs"
          >
            {flushing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {flushing ? 'Finishing…' : 'Done — check it'}
          </button>
          <button
            type="button"
            onClick={() => whisper.stop()}
            className="btn-secondary !py-1.5 text-xs"
          >
            <MicOff size={13} />
            Stop
          </button>
        </div>
      </div>
    );
  }

  /* ---- idle ---- */
  return (
    <div className="mt-2">
      {error && (
        <p className="text-[11px] text-tomato-600 dark:text-tomato-300 mb-1.5">{error}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={toggle} className="btn-secondary !px-2.5 !py-1.5 text-xs">
          <Mic size={13} />
          Speak your plan
        </button>
        <button
          type="button"
          onClick={() => setShowSetup((s) => !s)}
          aria-expanded={showSetup}
          className="btn-ghost !px-2 !py-1.5 text-[11px]"
        >
          {whisper.status.ready ? 'Change model' : 'Which model?'}
        </button>
        {whisper.listening && <Loader2 size={12} className="animate-spin self-center" />}
      </div>

      {whisper.status.ready && (
        <p className="text-[10px] text-sage-500 dark:text-ink-400 mt-1">
          {whisper.status.text}
        </p>
      )}

      {/* A model that failed to load is the difference between a microphone
          that is switched off and one that cannot work, and the user has to
          be told which one it is. */}
      {whisper.status.error && !whisper.listening && (
        <p className="text-[11px] leading-snug text-tomato-600 dark:text-tomato-300 mt-1">
          {whisper.status.error}
        </p>
      )}

      {showSetup && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Whisper model"
            className="input text-[11px] py-1 flex-1 min-w-[9rem]"
          >
            {WHISPER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Spoken language"
            className="input text-[11px] py-1 flex-1 min-w-[8rem]"
          >
            {STT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Typing or dictating the day, for when the browser's microphone is
          unusable. macOS dictation (press the dictation key twice) types into
          this box like any other field, so the whole feature keeps working
          even where Chrome refuses to hand a page the microphone. */}
      <details className="mt-2">
        <summary className="text-[11px] font-semibold text-sage-600 dark:text-sage-300 cursor-pointer">
          Type or dictate the day instead
        </summary>
        <div className="mt-1.5">
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={2}
            aria-label="Type or dictate the meals for this day"
            placeholder="breakfast oats with milk, lunch vegetable rice, dinner chicken curry"
            className="input w-full text-xs resize-none"
          />
          <div className="flex gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={() => {
                const { draft, outcome } = buildDraft(typed);
                if (!draft) {
                  setError(spokenPlanError(typed, outcome, 'typed'));
                  return;
                }
                setError(null);
                setDraft(draft);
              }}
              disabled={!typed.trim()}
              className="btn-primary flex-1 !py-1.5 text-xs disabled:opacity-50"
            >
              Fill the day
            </button>
            <button
              type="button"
              onClick={() => setTyped('')}
              className="btn-secondary !py-1.5 text-xs"
            >
              Clear
            </button>
          </div>
          <p className="mt-1 text-[10px] text-sage-500 dark:text-ink-400">
            Works with dictation too — press the dictation key twice and speak.
          </p>
        </div>
      </details>
    </div>
  );
}
import { useState } from 'react';
import { Mic, MicOff, Loader2, Check, X, Sparkles } from 'lucide-react';
import { useWhisperSTT, WHISPER_MODELS, STT_LANGUAGES } from '../hooks/useWhisperSTT';
import { parseSpokenPlan } from '../utils/spokenPlan';
import type { SpokenPlan } from '../utils/spokenPlan';

interface Props {
  /** Apply the parsed slots. Only the slots present in the plan are touched. */
  onApply: (plan: SpokenPlan) => void;
}

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
 */
export function SpeakYourPlan({ onApply }: Props) {
  const [model, setModel] = useState('onnx-community/whisper-base');
  const [language, setLanguage] = useState('en-IN');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SpokenPlan | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [typed, setTyped] = useState('');

  const whisper = useWhisperSTT(model, language);

  const toggle = async () => {
    setError(null);
    if (whisper.listening) {
      whisper.stop();
      return;
    }
    setDraft(null);
    const res = await whisper.start(() => {});
    if (!res.ok && res.error !== 'Cancelled.') setError(res.error ?? 'Could not start the microphone.');
  };

  /** Stop listening and show whatever was understood, ready to be edited. */
  const review = () => {
    whisper.stop();
    const parsed = parseSpokenPlan(whisper.transcript);
    if (!parsed.breakfast && !parsed.lunch && !parsed.dinner) {
      setError(
        whisper.transcript.trim()
          ? `Heard "${whisper.transcript.trim()}" but could not tell which meal it was for. Try saying "breakfast …, lunch …, dinner …".`
          : 'Nothing was picked up. Hold the phone closer and speak a little louder.',
      );
      return;
    }
    setDraft(parsed);
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

        {(['breakfast', 'lunch', 'dinner'] as const).map((slot) => (
          <label key={slot} className="block mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sage-600 dark:text-sage-300">
              {slot}
            </span>
            <input
              value={draft[slot] ?? ''}
              placeholder="leave empty to keep what's planned"
              aria-label={`${slot} from speech`}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, [slot]: e.target.value || undefined }))
              }
              className="input w-full text-xs py-1.5 mt-0.5"
            />
          </label>
        ))}

        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => { onApply(draft); setDraft(null); whisper.reset(); }}
            className="btn-primary flex-1 !py-1.5 text-xs"
          >
            <Check size={13} />
            Yes, add these
          </button>
          <button
            type="button"
            onClick={() => { setDraft(null); whisper.reset(); }}
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
  if (whisper.listening) {
    return (
      <div className="rounded-xl border border-tomato-200 dark:border-tomato-900 bg-tomato-50/60 dark:bg-tomato-900/20 p-2.5 mt-2">
        <div className="flex items-center gap-2 text-xs text-tomato-700 dark:text-tomato-300">
          <span className="w-2 h-2 rounded-full bg-tomato-500 animate-pulse" />
          {whisper.status.text || 'Listening — say the meals for this day…'}
        </div>

        {whisper.status.progress !== null && (
          <div className="mt-2 h-1 rounded-full bg-tomato-200/60 overflow-hidden">
            <div
              className="h-full bg-tomato-500 transition-[width] duration-300"
              style={{ width: `${whisper.status.progress}%` }}
            />
          </div>
        )}

        {whisper.transcript && (
          <p className="mt-2 text-xs italic text-sage-700 dark:text-cream-100 break-words">
            “{whisper.transcript}”
          </p>
        )}

        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={review}
            disabled={!whisper.transcript}
            className="btn-primary flex-1 !py-1.5 text-xs disabled:opacity-50"
          >
            <Check size={13} />
            Done — check it
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
                const parsed = parseSpokenPlan(typed);
                if (!parsed.breakfast && !parsed.lunch && !parsed.dinner) {
                  setError(
                    typed.trim()
                      ? 'Could not tell which meal that was for. Include "breakfast", "lunch" or "dinner".'
                      : 'Type the day first, or dictate into this box.',
                  );
                  return;
                }
                setError(null);
                setDraft(parsed);
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
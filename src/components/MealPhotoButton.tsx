import { useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Loader2, Check, X, PenLine } from 'lucide-react';
import { readMealPhoto, readingToLine } from '../utils/recipePhoto';
import type { ReadMode, RecipeReading } from '../utils/recipePhoto';

interface Props {
  /** Called only after the user confirms what the model read. */
  onConfirm: (text: string) => void;
}

/**
 * Photograph a meal and check what the app understood.
 *
 * The flow is deliberately confirm-before-save. A photo is read by a model
 * that can be confidently wrong, so its answer comes back as editable text
 * with an explicit "yes, that's right" step. Nothing reaches the meal log
 * until the user says so, and they can fix a misread in place first.
 *
 * The file input is mounted for the whole time a source has been chosen — not
 * just on the last screen. Keeping it inside one branch meant that after an
 * error the "try again" button had no input to open.
 */
export function MealPhotoButton({ onConfirm }: Props) {
  const [mode, setMode] = useState<ReadMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState<RecipeReading | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = (next: ReadMode) => {
    // Deliberately NOT busy here. Choosing a source is not work in progress —
    // setting busy at this point showed "Reading your photo…" immediately and
    // never rendered the capture button, so the user had no way to take the
    // photo in the first place.
    setMode(next);
    setError(null);
    setReading(null);
    setDraft('');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !mode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readMealPhoto(file, mode);
      if (!res.ok) {
        setError(res.message ?? 'Could not read that photo.');
        return;
      }
      setReading(res.reading);
      setDraft(readingToLine(res.reading));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const cancel = () => {
    setMode(null);
    setReading(null);
    setDraft('');
    setError(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirm = () => {
    const text = draft.trim();
    if (!text) return;
    onConfirm(text);
    cancel();
  };

  const capture = (label: string) => (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      className="w-full btn-primary !py-2 text-sm"
    >
      <Camera size={14} />
      {label}
    </button>
  );

  /* ---- confirmation step ---- */
  const confirmation = reading && (
    <div className="rounded-2xl border border-sage-300 dark:border-sage-800 bg-sage-50/70 dark:bg-sage-900/25 p-3 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg bg-sage-100 dark:bg-sage-900/50 text-sage-700 dark:text-sage-300 grid place-items-center">
          <PenLine size={14} />
        </span>
        <div className="text-xs font-bold uppercase tracking-wider text-sage-700 dark:text-sage-300">
          Is this right?
        </div>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        aria-label="What the app read from your photo — edit if needed"
        className="input w-full text-sm resize-none"
      />

      {reading.steps.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] font-semibold text-sage-600 dark:text-sage-300 cursor-pointer">
            {reading.steps.length} step{reading.steps.length === 1 ? '' : 's'} read
          </summary>
          <ol className="mt-1 space-y-0.5 text-[11px] text-sage-600 dark:text-ink-300 list-decimal list-inside">
            {reading.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}

      {(reading.uncertain.length > 0 || (reading.confidence !== null && reading.confidence < 0.6)) && (
        <p className="mt-2 text-[11px] leading-snug text-tomato-600 dark:text-tomato-300">
          Not fully clear on: {reading.uncertain.join(', ') || 'part of the photo'}. Check it over.
        </p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={confirm}
          disabled={!draft.trim()}
          className="btn-primary flex-1 !py-2 text-sm"
        >
          <Check size={14} />
          Yes, that's right
        </button>
        <button type="button" onClick={cancel} className="btn-secondary !py-2 text-sm">
          <X size={14} />
          Discard
        </button>
      </div>
    </div>
  );

  const working = busy && (
    <div className="rounded-2xl border border-sage-200 dark:border-sage-800 bg-white dark:bg-ink-800 p-3 mt-2">
      <div className="flex items-center gap-2 text-sm text-sage-600 dark:text-sage-300">
        <Loader2 size={15} className="animate-spin" />
        {mode === 'handwritten' ? 'Reading your recipe card…' : 'Looking at your photo…'}
      </div>
    </div>
  );

  const failure = !busy && error && (
    <div className="rounded-2xl border border-sage-200 dark:border-sage-800 bg-white dark:bg-ink-800 p-3 mt-2">
      <p className="text-sm text-tomato-600 dark:text-tomato-300">{error}</p>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-primary flex-1 !py-1.5 text-xs"
        >
          <Camera size={13} />
          Try another photo
        </button>
        <button type="button" onClick={cancel} className="btn-secondary !py-1.5 text-xs">
          Close
        </button>
      </div>
    </div>
  );

  const picker = mode && !reading && !busy && !error && (
    <>
      {capture(mode === 'handwritten' ? 'Take a photo of the recipe' : 'Take a photo of the dish')}
      <button type="button" onClick={cancel} className="mt-1 w-full text-[11px] text-sage-500 dark:text-ink-400">
        Cancel
      </button>
    </>
  );

  const choices = !mode && (
    <div className="flex flex-wrap gap-2 mt-2">
      <button type="button" onClick={() => start('dish')} className="btn-secondary !px-3 !py-1.5 text-xs">
        <Camera size={13} />
        Photo of what I cooked
      </button>
      <button type="button" onClick={() => start('handwritten')} className="btn-secondary !px-3 !py-1.5 text-xs">
        <ImageIcon size={13} />
        Photo of my written recipe
      </button>
    </div>
  );

  return (
    <>
      {/* Mounted whenever a source is chosen, so every screen below can open
          the picker — including the error state. */}
      {mode && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      )}
      {confirmation || working || failure || picker || choices}
    </>
  );
}
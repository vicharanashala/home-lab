import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Camera, ImagePlus, Trash2, Loader2, Sparkles, Save, X, FolderOpen } from 'lucide-react';
import clsx from 'clsx';
import {
  loadTrainingExamples,
  saveTrainingExample,
  clearTrainingExamples,
  countByLabel,
  type TrainingExample,
} from '../utils/foodTrainer';
import { extractImageEmbedding } from '../utils/foodClassifier';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Bulk trainer UI — let the user take multiple photos of the same
 * vegetable and add them as training examples in one go.
 *
 * Flow:
 *   1. Type a label (e.g. "Tomato").
 *   2. Take / upload photos — each one is auto-extracted for embedding
 *      and queued for saving.
 *   3. Tap "Save N examples" to commit them all.
 *   4. Each example is stored as (embedding, label) in localStorage.
 *      Future photos with similar embeddings will be classified as
 *      that label.
 */
export function FoodTrainerModal({ open, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState<PendingExample[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setPending([]);
      setExtractError(null);
      setCounts(countByLabel());
    }
  }, [open]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!arr.length) return;
    setExtractError(null);
    if (!label.trim()) {
      // Prompt user to label first
      const l = window.prompt(`Found ${arr.length} photo(s). What's the item name?`);
      if (!l) return;
      setLabel(l);
      // Defer until next tick so state updates
      await new Promise((r) => setTimeout(r, 50));
    }
    setIsExtracting(true);
    let added = 0;
    for (const f of arr) {
      try {
        const blob = f;
        const url = URL.createObjectURL(blob);
        const embedding = await extractImageEmbedding(blob);
        if (!embedding) {
          URL.revokeObjectURL(url);
          continue;
        }
        setPending((p) => [
          ...p,
          { id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, embedding },
        ]);
        added++;
      } catch {
        // skip
      }
    }
    setIsExtracting(false);
    if (added === 0) {
      setExtractError(
        "Couldn't extract features from these photos. Make sure they're valid image files (JPG/PNG) and try again.",
      );
    }
  };

  const removePending = (id: string) => {
    setPending((p) => {
      const found = p.find((q) => q.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return p.filter((q) => q.id !== id);
    });
  };

  const saveAll = () => {
    if (!label.trim() || !pending.length) return;
    setSaving(true);
    let saved = 0;
    for (const ex of pending) {
      const r = saveTrainingExample(ex.embedding, label.trim(), 'manual');
      if (r) saved++;
    }
    setSaving(false);
    setCounts(countByLabel());
    for (const ex of pending) URL.revokeObjectURL(ex.url);
    setPending([]);
  };

  const clearAll = () => {
    if (window.confirm('Delete all training data? The model will fall back to MobileNet only.')) {
      clearTrainingExamples();
      setCounts({});
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Train HomeHub" fullBleed>
      <div className="space-y-4 pt-2">
        <p className="text-sm text-sage-700 dark:text-cream-100 leading-relaxed">
          The default photo recognizer is OK for bananas and oranges but can't tell a
          tomato from a pomegranate. Teach it: take a few photos of each item and
          type its name. Next time you snap that item, HomeHub will recognize it.
        </p>

        {/* Label input */}
        <div>
          <label className="label" htmlFor="trainer-label">
            Item name
          </label>
          <input
            id="trainer-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Tomato"
            className="input"
          />
        </div>

        {/* Drag-and-drop zone + capture buttons */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const items = Array.from(e.dataTransfer.items);
            // Try to expand directories via DataTransferItem.webkitGetAsEntry()
            const files: File[] = [];
            let pending = items.length;
            if (pending === 0) return;
            items.forEach((it) => {
              const entry = (it as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
              if (entry?.isDirectory) {
                const reader = (entry as unknown as { createReader: () => FileSystemDirectoryReader }).createReader();
                const readBatch = () => {
                  reader.readEntries(async (entries: FileSystemEntry[]) => {
                    if (entries.length === 0) {
                      pending--;
                      if (pending === 0) void handleFiles(files);
                      return;
                    }
                    for (const ent of entries) {
                      if (ent.isFile) {
                        const f = await new Promise<File>((resolve, reject) => {
                          (ent as unknown as { file: (cb: (f: File) => void, err: (e: unknown) => void) => void }).file(resolve, reject);
                        });
                        if (f.type.startsWith('image/')) files.push(f);
                      }
                    }
                    readBatch();
                  });
                };
                readBatch();
              } else {
                const f = it.getAsFile();
                if (f) files.push(f);
                pending--;
                if (pending === 0) void handleFiles(files);
              }
            });
          }}
          className={clsx(
            'rounded-2xl border-2 border-dashed p-4 transition-all',
            isDragging
              ? 'border-sage-500 bg-sage-100 dark:bg-sage-900/40 scale-[1.01]'
              : 'border-sage-200 dark:border-ink-700 bg-sage-50/40 dark:bg-ink-800/40',
          )}
        >
          <div className="text-center mb-3">
            <FolderOpen
              size={22}
              className={clsx(
                'mx-auto mb-1 transition-colors',
                isDragging ? 'text-sage-700 dark:text-sage-200' : 'text-sage-400',
              )}
            />
            <div className="text-[12px] font-semibold text-sage-700 dark:text-sage-200">
              {isDragging ? 'Drop to add photos' : 'Drag a folder or photos here'}
            </div>
            <div className="text-[10px] text-sage-500 dark:text-ink-300">
              Or use the buttons below
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isExtracting}
              className="flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-ink-700 text-sage-800 dark:text-cream-50 border-2 border-sage-200 dark:border-ink-600 py-3 text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              <Camera size={18} />
              Take photo
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-ink-700 text-sage-800 dark:text-cream-50 border-2 border-sage-200 dark:border-ink-600 py-3 text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              <ImagePlus size={18} />
              Choose files
            </button>
          </div>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Error message */}
        {extractError && (
          <div className="rounded-lg bg-tomato-50 dark:bg-tomato-900/20 border border-tomato-200/60 p-2.5 text-[12px] text-tomato-700 dark:text-tomato-300 leading-snug">
            {extractError}
          </div>
        )}

        {/* Loading state */}
        {isExtracting && (
          <div className="flex items-center justify-center gap-2 text-[12px] text-sage-700 dark:text-sage-200 bg-sage-50 dark:bg-ink-700 rounded-lg p-3">
            <Loader2 size={14} className="animate-spin" />
            Extracting features from photos… (~1 s each)
          </div>
        )}

        {/* Pending thumbnails */}
        {pending.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
                {pending.length} photo{pending.length === 1 ? '' : 's'} ready
              </div>
              <button
                type="button"
                onClick={() => {
                  for (const ex of pending) URL.revokeObjectURL(ex.url);
                  setPending([]);
                }}
                className="text-[11px] text-tomato-700 dark:text-tomato-300 hover:underline"
              >
                Discard all
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-square rounded-xl overflow-hidden bg-ink-100 dark:bg-ink-900 group"
                >
                  <img
                    src={p.url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removePending(p.id)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white grid place-items-center"
                    aria-label="Remove photo"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={saveAll}
              disabled={saving}
              className="btn-primary w-full mt-3"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save {pending.length} example{pending.length === 1 ? '' : 's'}
            </button>
          </div>
        )}

        {/* Existing training data */}
        <div className="border-t border-sage-100 dark:border-ink-700 pt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
              Your trained items
            </div>
            {Object.keys(counts).length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-[11px] text-tomato-700 dark:text-tomato-300 hover:underline"
              >
                <Trash2 size={12} />
                Reset
              </button>
            )}
          </div>
          {Object.keys(counts).length === 0 ? (
            <p className="text-[12px] text-sage-500 dark:text-ink-300 italic">
              No training data yet. Add a few photos above to get started.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-sage-100 px-2.5 py-1 text-[11px] font-semibold"
                  >
                    {name}
                    <span className="text-[10px] opacity-70 font-normal">{n}</span>
                  </span>
                ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn-secondary w-full mt-2"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

interface PendingExample {
  id: string;
  url: string;
  embedding: number[];
}
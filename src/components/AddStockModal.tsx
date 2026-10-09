import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { CATEGORY_LIST, getCategory } from '../utils/categories';
import { Refrigerator, Plus, Calendar, FileText, Check, Sparkles, Archive, Camera, ImagePlus, X, Loader2, RotateCcw, Sparkle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { CategoryIcon } from './icons/AppIcons';
import { bridgeHeaders } from '../utils/bridgeToken';
import type { CategoryId, StockItem, StockLocation } from '../types';
import clsx from 'clsx';
import { suggestCategory } from '../utils/categorySuggest';
import { AutocompleteInput, type Suggestion } from './AutocompleteInput';
import { COMMON_ITEMS } from '../utils/commonItems';
import { classifyFoodImageDetailed, extractImageEmbedding, readOverwatchUrl, type Prediction } from '../utils/foodClassifier';
import { uid } from '../utils/uid';
import { saveTrainingExample } from '../utils/foodTrainer';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCategory?: CategoryId;
  defaultName?: string;
  defaultLocation?: StockLocation;
}

const COMMON_UNITS = ['pcs', 'packets', 'kg', 'g', 'L', 'ml', 'dozen', 'bunch', 'bottles'];

/** Map a recognizer's categoryHint to one of our app categories. */
function categoryFromHint(hint: Prediction['categoryHint']): CategoryId | null {
  switch (hint) {
    case 'fruit': return 'fruits';
    case 'leafy':
    case 'root':
    case 'vegetable': return 'vegetables';
    case 'spice': return 'condiments';
    default: return null;
  }
}

// ── Bulk item editor row ───────────────────────────────────────────────
// Compact by default (label + qty + confidence dot), tap to expand for
// full editing (unit, location, notes). Shows a ⚠️ for low-confidence
// detections and offers common "Did you mean X?" autofix chips for
// items the model frequently mislabels.
type BulkLocation = StockLocation;

function BulkItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: {
    id: string;
    label: string;
    quantity: number;
    unit: string;
    location: BulkLocation;
    confidence: number;
    notes?: string;
    selected: boolean;
  };
  onChange: (patch: Partial<{
    label: string;
    quantity: number;
    unit: string;
    location: BulkLocation;
    selected: boolean;
    notes: string;
  }>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLow = item.confidence < 0.65;
  // Autofix suggestions for known confusion items.
  const suggestions: string[] = [];
  if (item.label === 'broccoli') suggestions.push('cauliflower');
  else if (item.label === 'capsicum') suggestions.push('tomato', 'cucumber');
  else if (item.label === 'guava') suggestions.push('lemon', 'lime');
  else if (item.label === 'cucumber') suggestions.push('green-chili');
  else if (item.label === 'coriander' || item.label === 'mint') suggestions.push('curry-leaves');
  else if (item.label === 'cabbage') suggestions.push('cauliflower');

  return (
    <div
      className={clsx(
        'rounded-lg border transition-colors',
        item.selected
          ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-300 dark:border-sage-700'
          : 'bg-white dark:bg-ink-800 border-sage-100 dark:border-ink-700 opacity-60',
        isLow && 'ring-1 ring-amber-300/60',
      )}
    >
      {/* Collapsed row — checkbox, name, qty, expand toggle, conf, delete */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <input
          type="checkbox"
          checked={item.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          aria-label={`Select ${item.label}`}
          className="accent-sage-600 shrink-0"
        />
        {isLow && (
          <AlertTriangle
            size={14}
            className="shrink-0 text-amber-500"
            aria-label="Low confidence — please verify"
          />
        )}
        <input
          value={item.label}
          onChange={(e) => onChange({ label: e.target.value })}
          onFocus={() => setExpanded(true)}
          placeholder="Item name"
          aria-label="Item name"
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-sage-400"
        />
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={item.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) || 1 })}
          aria-label="Quantity"
          className="w-14 bg-transparent text-sm text-center outline-none border-b border-transparent focus:border-sage-400 shrink-0"
        />
        <span
          className={clsx(
            'text-[10px] font-mono w-9 text-right shrink-0',
            isLow ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-sage-500 dark:text-sage-300',
          )}
          title={`AI confidence: ${Math.round(item.confidence * 100)}%`}
        >
          {Math.round(item.confidence * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          className="p-1 text-sage-500 hover:text-sage-800 dark:text-sage-300 dark:hover:text-sage-100 shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove item"
          className="p-1 text-rose-400 hover:text-rose-600 shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Expanded editor — autofix suggestions, unit, location, notes */}
      {expanded && (
        <div className="px-2.5 pt-0 pb-2 space-y-2 border-t border-sage-200/40 dark:border-ink-700/40">
          {isLow && (
            <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5 flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>AI wasn't sure about this one — please verify or pick a correction below.</span>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] uppercase tracking-wide text-sage-500 dark:text-sage-400 font-semibold self-center">
                Did you mean:
              </span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ label: s })}
                  className="text-[11px] font-bold rounded-full bg-sage-100 dark:bg-sage-800 hover:bg-sage-600 hover:text-white dark:text-sage-100 dark:hover:bg-sage-600 px-2.5 py-1 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-sage-600 dark:text-sage-300 w-16 shrink-0">
              Unit
            </label>
            <select
              value={item.unit}
              onChange={(e) => onChange({ unit: e.target.value })}
              className="flex-1 bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 rounded-md px-2 py-1 text-sm outline-none focus:border-sage-400"
            >
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <label className="text-[11px] font-semibold text-sage-600 dark:text-sage-300 w-20 shrink-0 text-right">
              Where
            </label>
            <select
              value={item.location}
              onChange={(e) => onChange({ location: e.target.value as BulkLocation })}
              className="flex-1 bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 rounded-md px-2 py-1 text-sm outline-none focus:border-sage-400"
            >
              <option value="fridge">Fridge</option>
              <option value="pantry">Pantry</option>
              <option value="freezer">Freezer</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export function AddStockModal({
  open,
  onClose,
  defaultCategory = 'other',
  defaultName = '',
  defaultLocation = 'fridge',
}: Props) {
  const { addStock, toast, stock } = useStore();
  const [name, setName] = useState(defaultName);
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('pcs');
  const [category, setCategory] = useState<CategoryId>(defaultCategory);
  const [location, setLocation] = useState<StockLocation>(defaultLocation);
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [threshold, setThreshold] = useState(1);
  const [touched, setTouched] = useState(false);
  const [justAdded, setJustAdded] = useState<StockItem | null>(null);

  // Photo capture state
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recogErr, setRecogErr] = useState<string | null>(null);
  const [photoStep, setPhotoStep] = useState<'capture' | 'preview' | 'manual'>('capture');
  /** Image embedding for active-learning training. */
  const [photoEmbedding, setPhotoEmbedding] = useState<number[] | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Bulk scan state ──────────────────────────────────────────────────
  type BulkMode = 'single' | 'bulk';
  type BulkCategory = 'vegetable' | 'fruit' | 'dairy' | 'grain' | 'spice' | 'protein' | 'snack' | 'other';
  interface BulkItem {
    id: string;
    label: string;
    quantity: number;
    unit: string;
    category: BulkCategory;
    location: BulkLocation;
    confidence: number;
    selected: boolean;
    notes?: string;
  }
  const [bulkMode, setBulkMode] = useState<BulkMode>('single');
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkRecognizing, setBulkRecognizing] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkLastFile, setBulkLastFile] = useState<File | null>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);


  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && quantity >= 0 && threshold >= 0;
  const guess = suggestCategory(trimmed);

  // Suggestions: common items for this category (filtered by location) +
  // existing items in fridge that share the same category.
  const stockSuggestions: Suggestion[] = useMemo(() => {
    const allCommon = COMMON_ITEMS[category] ?? [];
    const filteredCommon =
      location === 'fridge'
        ? allCommon
        : allCommon.filter((it) => it.storage !== 'fridge');
    const commonList = filteredCommon.map((it) => ({
      kind: 'quick' as const,
      label: it.name,
    }));
    const existingList =
      category === 'other'
        ? stock
        : stock.filter((it) => it.category === category);
    const existing = existingList.map((it) => ({
      kind: 'stock' as const,
      label: it.name,
      emoji: getCategory(it.category).emoji,
    }));
    const merged = [...commonList, ...existing];
    const seen = new Set<string>();
    return merged.filter((s) => {
      const k = s.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [stock, category, location]);

  const handlePickSuggestion = (s: Suggestion) => {
    if (s.kind !== 'stock') return;
    const existing = stock.find(
      (it) => it.name.toLowerCase() === s.label.toLowerCase(),
    );
    if (existing) setUnit(existing.unit);
  };

  const resetForm = () => {
    setName('');
    setQuantity(1);
    setUnit('pcs');
    setCategory(category);
    setExpiryDate('');
    setNotes('');
    setThreshold(1);
    setTouched(false);
  };

  const resetPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setPredictions([]);
    setRecogErr(null);
    setPhotoStep('capture');
  };

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setQuantity(1);
      setUnit('pcs');
      const initialCategory =
        defaultCategory && defaultCategory !== 'other'
          ? defaultCategory
          : suggestCategory(defaultName || '');
      setCategory(initialCategory);
      setLocation(defaultLocation);
      setExpiryDate('');
      setNotes('');
      setThreshold(1);
      setTouched(false);
      setJustAdded(null);
      resetPhoto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName, defaultCategory]);

  // Cleanup object URLs on unmount
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  /** Capture a photo from the camera/file input. */
  const onPhotoSelected = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPhotoUrl(url);
    setPhotoBlob(file);
    setPhotoStep('preview');
    setRecogErr(null);
    setPredictions([]);
    setBulkItems([]);
    setBulkErr(null);
    setPhotoEmbedding(null);
    // Always extract the fingerprint first so we can save it on submit
    // even when classification fails entirely.
    try {
      const fp = await extractImageEmbedding(file);
      setPhotoEmbedding(fp);
    } catch {
      // fall through to runRecognition which will retry
    }
    if (bulkMode === 'bulk') {
      await runBulkScan(file);
    } else {
      await runRecognition(file);
    }
  };

/** Run bulk multi-item scan via MiniMax. */
  const runBulkScan = async (file: File) => {
    const base = readOverwatchUrl();
    if (!base) {
      setBulkErr('Backend not configured (VITE_OVERWATCH_URL missing). The developer needs to set this in .env.production.');
      return;
    }
    setBulkLastFile(file);
    setBulkRecognizing(true);
    setBulkErr(null);
    try {
      const fd = new FormData();
      fd.append('image', file, 'haul.jpg');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let r: Response;
      try {
        r = await fetch(`${base}/api/minimax/scan-bulk`, {
          method: 'POST',
          headers: bridgeHeaders(),
          body: fd,
          signal: ctrl.signal,
        });
      } catch (netErr: any) {
        clearTimeout(timer);
        // Fetch failed entirely — usually network, DNS, tunnel offline, or HTTPS→HTTP blocked.
        if (netErr?.name === 'AbortError') {
          setBulkErr('Scan timed out after 60 s. The vision server may be slow or the photo is very large.');
        } else {
          setBulkErr(
            `Couldn't reach the vision server (${base}). ` +
            `Check your internet connection — if the tunnel is down, the dev needs to restart it.`
          );
        }
        return;
      }
      clearTimeout(timer);
      let j: any;
      try { j = await r.json(); }
      catch {
        setBulkErr(`Server returned a non-JSON response (HTTP ${r.status}). The bridge is probably unreachable.`);
        return;
      }
      if (!r.ok || !j.ok) {
        const reason = j.message || j.error || `HTTP ${r.status}`;
        if (j.error === 'minimax_unreachable' || j.error === 'minimax_error' || j.error === 'minimax_not_configured') {
          setBulkErr(`Vision backend problem: ${reason}. The LLM service may be temporarily down.`);
        } else if (j.error === 'no_image') {
          setBulkErr('No image received. Try uploading the photo again.');
        } else {
          setBulkErr(reason);
        }
        return;
      }
      // Map raw items to editable rows; default location by category.
      const items: BulkItem[] = (j.items ?? []).map((it: any) => ({
        id: uid('bulk'),
        label: String(it.label || '').toLowerCase().trim(),
        quantity: Number(it.quantity) || 1,
        unit: String(it.unit || 'pcs'),
        category: String(it.category || 'other'),
        notes: String(it.notes || ''),
        confidence: Number(it.confidence) || 0.7,
        location:
          it.category === 'spice' || it.category === 'staple'
            ? 'pantry'
            : 'fridge',
        selected: true,
      }));
      setBulkItems(items);
    } catch (err: any) {
      // Belt-and-braces fallback. The inner try/catch already handled fetch errors.
      setBulkErr(`Unexpected error: ${err?.message ?? String(err)}. Try again or restart the app.`);
    } finally {
      setBulkRecognizing(false);
    }
  };

  /** Retry the last bulk scan with the same photo (no need to re-pick). */
  const retryBulkScan = () => {
    if (bulkLastFile) runBulkScan(bulkLastFile);
  };

  /** Add all selected bulk items to the kitchen stock. */
  const addAllBulk = () => {
    const picked = bulkItems.filter((it) => it.selected && it.label);
    if (picked.length === 0) {
      toast('Nothing selected to add', 'info');
      return;
    }
    let added = 0;
    for (const it of picked) {
      const cat = categoryFromHint(it.category as any) || 'other';
      addStock({
        name: it.label,
        quantity: it.quantity,
        unit: it.unit,
        category: cat,
        location: it.location,
        notes: it.notes || undefined,
        lowStockThreshold: 1,
      });
      added += 1;
    }
    toast(`Added ${added} item${added === 1 ? '' : 's'} to your kitchen`, 'success');
    setBulkItems([]);
    setPhotoBlob(null);
    setPhotoUrl(null);
    setPhotoStep('capture');
    onClose();
  };

  /** Run photo recognition — overwatch agent first, in-browser fallback. */
  const runRecognition = async (blob: Blob) => {
    setIsRecognizing(true);
    setRecogErr(null);
    try {
      const out = await classifyFoodImageDetailed(blob);
      setPredictions(out.predictions);
      if (out.fingerprint) setPhotoEmbedding(out.fingerprint);
      // Auto-fill if there's a confident prediction and the user hasn't typed yet.
      if (out.predictions.length > 0 && out.predictions[0].confidence >= 0.5 && !name.trim()) {
        applyPrediction(out.predictions[0]);
      }
    } catch (err) {
      setRecogErr((err as Error).message || 'Could not recognize');
    } finally {
      setIsRecognizing(false);
    }
  };

  /** Apply a prediction: name → form, category hint → category, location from store name. */
  const applyPrediction = (p: Prediction) => {
    setName(p.label);
    const c = categoryFromHint(p.categoryHint);
    if (c) setCategory(c);
    // Light heuristic: leafy/vegetable/fruit → fridge; spice → pantry.
    if (p.categoryHint === 'spice') setLocation('pantry');
    else if (p.categoryHint === 'fruit' || p.categoryHint === 'vegetable' || p.categoryHint === 'leafy') setLocation('fridge');
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) {
      setTouched(true);
      return;
    }
    // If a photo was used, the user-confirmed name is the ground truth.
    // Save the embedding as a training example so next time the model
    // recognises this item from this kind of photo automatically.
    if (photoEmbedding) {
      saveTrainingExample(photoEmbedding, trimmed, 'corrected-prediction');
    }
    const item = addStock({
      name: trimmed,
      quantity,
      unit,
      category,
      location,
      expiryDate: expiryDate || undefined,
      notes: notes.trim() || undefined,
      lowStockThreshold: threshold,
    });
    toast(`Added "${trimmed}" to your kitchen`, 'success');
    setJustAdded(item);
  };

  const footer = justAdded ? null : (
    // In bulk mode the bulk-list UI has its own "Add N items to kitchen" button;
    // showing the single-item footer here would silently submit an empty form.
    bulkMode === 'bulk' ? (
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Close
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Cancel
        </button>
        <button
          type="submit"
          form="add-stock-form"
          disabled={!canSubmit}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          <Refrigerator size={18} />
          Add to kitchen
          <Plus size={16} />
        </button>
      </div>
    )
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        justAdded
          ? 'Item added'
          : bulkMode === 'bulk'
            ? 'Snap multiple groceries'
            : 'Add to kitchen stock'
      }
      fullBleed
      footer={footer}
    >
      {justAdded ? (
        <SuccessView
          item={justAdded}
          onDone={onClose}
          onAddAnother={() => {
            resetForm();
            setJustAdded(null);
          }}
        />
      ) : (
        <form id="add-stock-form" onSubmit={submit} className="space-y-4 pt-2">
          {/* SCAN MODE TOGGLE: single vs multiple items */}
          <div className="flex items-center justify-between gap-2 rounded-xl bg-sage-50 dark:bg-ink-800 border border-sage-200 dark:border-ink-700 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider font-bold text-sage-600 dark:text-sage-300">
              Scan mode
            </div>
            <div className="flex rounded-lg bg-white dark:bg-ink-900 p-0.5 border border-sage-200 dark:border-ink-700">
              <button
                type="button"
                onClick={() => { setBulkMode('single'); setBulkItems([]); setBulkErr(null); }}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5',
                  bulkMode === 'single'
                    ? 'bg-sage-600 text-white shadow-sm'
                    : 'text-sage-600 dark:text-sage-300 hover:bg-sage-50 dark:hover:bg-ink-800'
                )}
              >
                <Camera size={13} /> Single item
              </button>
              <button
                type="button"
                onClick={() => { setBulkMode('bulk'); setPredictions([]); setRecogErr(null); }}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5',
                  bulkMode === 'bulk'
                    ? 'bg-sage-600 text-white shadow-sm'
                    : 'text-sage-600 dark:text-sage-300 hover:bg-sage-50 dark:hover:bg-ink-800'
                )}
              >
                <Sparkles size={13} /> Multiple items
              </button>
            </div>
          </div>

          {/* PHOTO CAPTURE — the new primary flow */}
          {bulkMode === 'single' && (
          <PhotoCaptureBlock
            photoUrl={photoUrl}
            photoStep={photoStep}
            predictions={predictions}
            isRecognizing={isRecognizing}
            recogErr={recogErr}
            cameraInputRef={cameraInputRef}
            fileInputRef={fileInputRef}
            onPhotoSelected={onPhotoSelected}
            onApplyPrediction={(p) => applyPrediction(p)}
            onResetPhoto={resetPhoto}
            onSwitchToManual={() => setPhotoStep('manual')}
            onSkipToManual={() => setPhotoStep('manual')}
            hasName={Boolean(trimmed)}
          />
          )}

          {/* BULK MODE — multi-item scan preview */}
          {bulkMode === 'bulk' && (
            <section className="rounded-2xl border border-sage-200 dark:border-ink-700 bg-gradient-to-br from-sage-50 to-butter-50 dark:from-ink-800 dark:to-ink-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-200 grid place-items-center">
                  <Sparkles size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-sm text-sage-900 dark:text-cream-50">
                    Snap the whole haul
                  </div>
                  <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-0.5">
                    One photo of groceries → MiniMax finds everything
                  </div>
                </div>
              </div>

              {!photoUrl && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 rounded-xl bg-white dark:bg-ink-700 border-2 border-sage-200 dark:border-ink-600 py-4 active:scale-95 transition-transform hover:border-sage-400 dark:hover:border-sage-500"
                  >
                    <Camera size={22} className="text-sage-700 dark:text-sage-200" />
                    <span className="text-xs font-semibold text-sage-800 dark:text-cream-50">Take photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 rounded-xl bg-white dark:bg-ink-700 border-2 border-sage-200 dark:border-ink-600 py-4 active:scale-95 transition-transform hover:border-sage-400 dark:hover:border-sage-500"
                  >
                    <ImagePlus size={22} className="text-sage-700 dark:text-sage-200" />
                    <span className="text-xs font-semibold text-sage-800 dark:text-cream-50">Upload</span>
                  </button>
                </div>
              )}

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhotoSelected(f);
                  e.target.value = '';
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhotoSelected(f);
                  e.target.value = '';
                }}
              />

              {photoUrl && (
                <div className="space-y-2.5">
                  <div className="relative rounded-xl overflow-hidden bg-ink-100 dark:bg-ink-900 aspect-video">
                    <img
                      src={photoUrl}
                      alt="Haul"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {bulkRecognizing && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-white">
                          <Loader2 size={20} className="animate-spin" />
                          <span className="text-sm font-semibold">Scanning entire haul…</span>
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={resetPhoto}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80"
                      aria-label="Retake photo"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>

                  {bulkErr && (
                    <div className="rounded-lg bg-tomato-50 dark:bg-tomato-900/30 border border-tomato-200 dark:border-tomato-800 px-3 py-2 text-xs text-tomato-700 dark:text-tomato-200 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="font-semibold shrink-0">⚠️</span>
                        <span className="flex-1 leading-snug">{bulkErr}</span>
                      </div>
                      {bulkLastFile && !bulkRecognizing && (
                        <button
                          type="button"
                          onClick={retryBulkScan}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-tomato-600 hover:bg-tomato-700 text-white font-semibold text-xs py-1.5 transition-colors"
                        >
                          <RotateCcw size={12} />
                          Retry with same photo
                        </button>
                      )}
                    </div>
                  )}

                  {bulkItems.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
                          {bulkItems.length} item{bulkItems.length === 1 ? '' : 's'} detected
                          {bulkItems.some((it) => it.confidence < 0.65) && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 normal-case tracking-normal font-medium">
                              <AlertTriangle size={10} /> some need review
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setBulkItems((prev) =>
                              prev.map((it) => ({ ...it, selected: !prev.every((p) => p.selected) }))
                            )
                          }
                          className="text-[11px] font-bold text-sage-600 dark:text-sage-300 hover:underline"
                        >
                          {bulkItems.every((it) => it.selected) ? 'Deselect all' : 'Select all'}
                        </button>
                      </div>
                      <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                        {bulkItems.map((it, idx) => (
                          <BulkItemRow
                            key={it.id}
                            item={it}
                            onChange={(patch) =>
                              setBulkItems((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, ...patch } : p))
                              )
                            }
                            onRemove={() =>
                              setBulkItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setBulkItems((prev) => [
                            ...prev,
                            {
                              id: uid('bulk'),
                              label: '',
                              quantity: 1,
                              unit: 'pcs',
                              category: 'other',
                              notes: 'Manually added',
                              confidence: 1,
                              location: 'fridge',
                              selected: true,
                            },
                          ])
                        }
                        className="w-full rounded-xl border-2 border-dashed border-sage-300 dark:border-ink-600 hover:border-sage-500 dark:hover:border-sage-400 text-sage-600 dark:text-sage-300 hover:text-sage-800 dark:hover:text-sage-100 font-semibold text-sm py-2 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Plus size={16} />
                        Add item the AI missed
                      </button>
                      <button
                        type="button"
                        onClick={addAllBulk}
                        className="w-full rounded-xl bg-sage-600 hover:bg-sage-700 active:scale-[.98] text-white font-bold text-sm py-2.5 flex items-center justify-center gap-2 transition-all"
                      >
                        <Sparkles size={16} />
                        Add {bulkItems.filter((i) => i.selected).length} item
                        {bulkItems.filter((i) => i.selected).length === 1 ? '' : 's'} to kitchen
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* In bulk mode the bulk-list UI replaces the single-item form below. */}
          {bulkMode === 'single' && (
          <>
          <div>
            <label className="label" htmlFor="stock-name">
              Item name
            </label>
            <AutocompleteInput
              id="stock-name"
              value={name}
              onChange={(v) => {
                setName(v);
                if (category === 'other' || category === guess) {
                  const guess2 = suggestCategory(v);
                  if (guess2 !== category) setCategory(guess2);
                }
              }}
              suggestions={stockSuggestions}
              onPick={handlePickSuggestion}
              placeholder={
                category === 'other'
                  ? 'e.g. Milk'
                  : `Add another ${getCategory(category).label.toLowerCase()} item`
              }
              className="input"
            />
            {touched && !canSubmit && (
              <p className="mt-1 text-xs text-tomato-600">Please enter an item name.</p>
            )}
            {category !== 'other' && stockSuggestions.length > 0 && (
              <p className="mt-1 text-[11px] text-sage-500 dark:text-ink-300">
                {stockSuggestions.length} {getCategory(category).label.toLowerCase()} item{stockSuggestions.length === 1 ? '' : 's'} for {location === 'fridge' ? 'the fridge' : 'the pantry'} — start typing to pick one.
              </p>
            )}
            {category !== 'other' && stockSuggestions.length === 0 && location === 'pantry' && (
              <button
                type="button"
                onClick={() => setLocation('fridge')}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-butter-50 dark:bg-butter-900/30 px-2.5 py-1.5 text-[11px] font-semibold text-butter-800 dark:text-butter-200 hover:bg-butter-100 dark:hover:bg-butter-900/50 transition-colors"
              >
                Most {getCategory(category).label.toLowerCase()} need refrigeration — tap to switch to Fridge.
              </button>
            )}
          </div>

          {/* Location: fridge or pantry */}
          <div>
            <label className="label">Where do you keep it?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLocation('fridge')}
                className={clsx(
                  'flex items-center gap-2.5 rounded-2xl p-3.5 text-left border-2 transition-all active:scale-[.98]',
                  location === 'fridge'
                    ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-cream-50 border-sage-300 dark:border-sage-700 ring-2 ring-sage-300 dark:ring-sage-700 ring-offset-1 dark:ring-offset-ink-800'
                    : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600',
                )}
              >
                <Refrigerator size={20} className="shrink-0" />
                <div>
                  <div className="font-display font-bold text-sm leading-tight">Fridge</div>
                  <div className="text-[11px] opacity-75 mt-0.5">Perishable, expires</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setLocation('pantry')}
                className={clsx(
                  'flex items-center gap-2.5 rounded-2xl p-3.5 text-left border-2 transition-all active:scale-[.98]',
                  location === 'pantry'
                    ? 'bg-butter-100 dark:bg-butter-900/40 text-butter-800 dark:text-butter-200 border-butter-300 dark:border-butter-700 ring-2 ring-butter-300 dark:ring-butter-700 ring-offset-1 dark:ring-offset-ink-800'
                    : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600',
                )}
              >
                <Archive size={20} className="shrink-0" />
                <div>
                  <div className="font-display font-bold text-sm leading-tight">Pantry</div>
                  <div className="text-[11px] opacity-75 mt-0.5">Dry storage, longer shelf life</div>
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="stock-qty">
                Quantity
              </label>
              <input
                id="stock-qty"
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="stock-unit">
                Unit
              </label>
              <input
                id="stock-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                list="unit-suggestions"
                placeholder="pcs"
                className="input"
              />
              <datalist id="unit-suggestions">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="label">Category</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {CATEGORY_LIST.map((c) => {
                const active = c.id === category;
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={clsx(
                      'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold border transition-all active:scale-95',
                      active
                        ? `${c.color} border-transparent ring-2 ring-offset-1 ${c.ring}`
                        : 'bg-white dark:bg-ink-800 text-sage-600 dark:text-sage-300 border-sage-100 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                    )}
                  >
                    <CategoryIcon id={c.id} size={18} />
                    <span className="truncate w-full text-center">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="stock-expiry">
                <Calendar size={14} className="inline mr-1" /> Expiry date
              </label>
              <input
                id="stock-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="stock-threshold">
                Low at
              </label>
              <input
                id="stock-threshold"
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
                className="input"
              />
              <p className="mt-1 text-[11px] text-sage-500">
                Alert when quantity ≤ this.
              </p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="stock-notes">
              <FileText size={14} className="inline mr-1" /> Notes (optional)
            </label>
            <textarea
              id="stock-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Store in the back of the fridge"
              className="input min-h-[64px] resize-y"
            />
          </div>
          </>
          )}
        </form>
      )}
    </Modal>
  );
}

// ─── Photo capture subcomponent ──────────────────────────────────────

interface PhotoCaptureBlockProps {
  photoUrl: string | null;
  photoStep: 'capture' | 'preview' | 'manual';
  predictions: Prediction[];
  isRecognizing: boolean;
  recogErr: string | null;
  cameraInputRef: React.RefObject<HTMLInputElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onPhotoSelected: (file: File) => void;
  onApplyPrediction: (p: Prediction) => void;
  onResetPhoto: () => void;
  onSwitchToManual: () => void;
  onSkipToManual: () => void;
  hasName: boolean;
}

function PhotoCaptureBlock({
  photoUrl,
  photoStep,
  predictions,
  isRecognizing,
  recogErr,
  cameraInputRef,
  fileInputRef,
  onPhotoSelected,
  onApplyPrediction,
  onResetPhoto,
  onSwitchToManual,
  onSkipToManual,
  hasName,
}: PhotoCaptureBlockProps) {
  return (
    <section className="rounded-2xl border border-sage-200 dark:border-ink-700 bg-gradient-to-br from-sage-50 to-butter-50 dark:from-ink-800 dark:to-ink-800 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-200 grid place-items-center">
          <Sparkle size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm text-sage-900 dark:text-cream-50">
            Snap & auto-fill
          </div>
          <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-0.5">
            Take a photo and we'll recognise the item
          </div>
        </div>
      </div>

      {photoStep === 'manual' || photoUrl ? null : null}

      {photoStep !== 'manual' && !photoUrl && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 rounded-xl bg-white dark:bg-ink-700 border-2 border-sage-200 dark:border-ink-600 py-4 active:scale-95 transition-transform hover:border-sage-400 dark:hover:border-sage-500"
          >
            <Camera size={22} className="text-sage-700 dark:text-sage-200" />
            <span className="text-xs font-semibold text-sage-800 dark:text-cream-50">
              Take photo
            </span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 rounded-xl bg-white dark:bg-ink-700 border-2 border-sage-200 dark:border-ink-600 py-4 active:scale-95 transition-transform hover:border-sage-400 dark:hover:border-sage-500"
          >
            <ImagePlus size={22} className="text-sage-700 dark:text-sage-200" />
            <span className="text-xs font-semibold text-sage-800 dark:text-cream-50">
              Upload
            </span>
          </button>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhotoSelected(f);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhotoSelected(f);
          e.target.value = '';
        }}
      />

      {/* Preview + recognition */}
      {photoUrl && (
        <div className="space-y-2.5">
          <div className="relative rounded-xl overflow-hidden bg-ink-100 dark:bg-ink-900 aspect-video">
            <img
              src={photoUrl}
              alt="Captured item"
              className="w-full h-full object-cover"
              onError={(e) => {
                // Blob URLs get revoked when the modal closes; if we re-open
                // with a stale URL, hide the broken image instead of showing
                // the browser's "broken image" glyph.
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            {isRecognizing && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="flex items-center gap-2 text-white">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm font-semibold">Recognising…</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onResetPhoto}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80"
              aria-label="Retake photo"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Predictions */}
          {!isRecognizing && predictions.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-1.5">
                Tap to apply
              </div>
              <div className="flex flex-wrap gap-1.5">
                {predictions.slice(0, 5).map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => onApplyPrediction(p)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 dark:bg-sage-900/40 hover:bg-sage-200 dark:hover:bg-sage-900/70 text-sage-800 dark:text-sage-100 px-3 py-1.5 text-xs font-semibold active:scale-95 transition-all"
                  >
                    <span>{p.label}</span>
                    <span className="text-[10px] opacity-70 font-normal">
                      {Math.round(p.confidence * 100)}%
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-sage-500 dark:text-ink-300">
                Recognised with {predictions[0]?.source === 'overwatch'
                  ? '🛰️ overwatch agent'
                  : predictions[0]?.source === 'plantnet'
                  ? '🌿 PlantNet'
                  : predictions[0]?.source === 'mobilenet'
                  ? '🧠 MobileNet'
                  : predictions[0]?.source === 'dataset'
                  ? '🌿 21k vegetable dataset'
                  : 'on-device fingerprint'}
                {hasName ? ' — name already filled.' : ' — top match auto-filled above.'}
              </p>
            </div>
          )}

          {!isRecognizing && predictions.length === 0 && (
            <div className="rounded-lg bg-butter-50 dark:bg-butter-900/20 border border-butter-200/60 dark:border-butter-800/40 p-2.5 space-y-1.5">
              <div className="flex items-start gap-2 text-[12px] text-butter-800 dark:text-butter-200">
                <span>⚠️</span>
                <span className="leading-snug">
                  {recogErr
                    ? `Recognition failed: ${recogErr}.`
                    : "Couldn't recognise this item."}{' '}
                  Type the name below — HomeHub will learn from this and get it
                  right next time.
                </span>
              </div>
            </div>
          )}

          {/* Even when recognition returns wrong guesses, make it clear the
              user can correct + we'll auto-train on save. */}
          {!isRecognizing && predictions.length > 0 && predictions[0].source !== 'user-trained' && predictions[0].source !== 'overwatch' && predictions[0].source !== 'plantnet' && predictions[0].source !== 'mobilenet' && predictions[0].source !== 'dataset' && (
            <div className="text-[10px] text-sage-500 dark:text-ink-300 leading-snug">
              💡 These are guesses. Tap the correct one — or type the real name
              below. We'll save it as a training example automatically.
            </div>
          )}
        </div>
      )}

      {/* Skip link (always available) */}
      {photoStep !== 'manual' && !photoUrl && (
        <button
          type="button"
          onClick={onSkipToManual}
          className="mt-2 w-full text-[11px] text-sage-500 dark:text-ink-300 hover:text-sage-700 dark:hover:text-cream-50"
        >
          Or type the name manually below →
        </button>
      )}
    </section>
  );
}

function SuccessView({
  item,
  onDone,
  onAddAnother,
}: {
  item: StockItem;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  const cat = getCategory(item.category);
  return (
    <div className="py-2 animate-scale-in">
      <div className="flex flex-col items-center text-center pt-3 pb-5">
        <div className="relative mb-4">
          <div className="absolute inset-0 rounded-full bg-sage-200 animate-ping opacity-40" />
          <div className="relative w-20 h-20 rounded-full bg-sage-100 grid place-items-center shadow-soft">
            <Check size={42} className="text-sage-700" strokeWidth={3} />
          </div>
        </div>
        <h3 className="font-display text-2xl font-extrabold text-sage-900 dark:text-cream-50">
          Item added!
        </h3>
        <p className="text-sage-600 mt-1 text-sm">
          <span className="font-semibold text-sage-800 dark:text-cream-100">{item.name}</span> is now in your kitchen.
        </p>
      </div>

      <div className="card p-4 mb-4 flex items-center gap-3">
        <span
          className={clsx(
            'inline-flex items-center justify-center w-12 h-12 rounded-xl text-2xl shrink-0',
            cat.color,
          )}
        >
          <CategoryIcon id={cat.id} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sage-900 dark:text-cream-50 truncate">{item.name}</div>
          <div className="text-xs text-sage-500 mt-0.5 truncate">
            <span className="font-semibold text-sage-700">
              {item.quantity} {item.unit}
            </span>
            {' · '}
            {cat.label}
            {item.expiryDate && (
              <>
                {' · '}
                <span className="text-sage-500">Expires {item.expiryDate}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onDone} className="btn-secondary flex-1">
          Done
        </button>
        <button onClick={onAddAnother} className="btn-primary flex-1">
          <Sparkles size={16} />
          Add another
        </button>
      </div>
    </div>
  );
}
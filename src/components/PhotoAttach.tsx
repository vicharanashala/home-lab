import { useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

export interface AttachedImage {
  /** Base64 WITHOUT the data: prefix. */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Object URL for the preview and the chat bubble. */
  url: string;
  name: string;
  /** Original pixel size, before downscaling. */
  bytesBefore: number;
}

/**
 * Phone photos are 3-12 MB. Base64 inflates by a third on top of that, and the
 * bridge rejects bodies over 4 MB — so every image is downscaled to fit
 * MAX_EDGE before it is ever sent. This happens on-device; nothing is uploaded
 * until the user actually sends the message.
 */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;
/** Refuse absurdly large originals rather than hanging the browser on decode. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

async function fileToImage(file: File): Promise<AttachedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That photo is too large — try a smaller one.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that photo.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return {
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mediaType: 'image/jpeg',
    url: dataUrl,
    name: file.name || 'photo.jpg',
    bytesBefore: file.size,
  };
}

export function usePhotoAttach() {
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      setImage(await fileToImage(file));
      setPickerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (libraryRef.current) libraryRef.current.value = '';
    }
  };

  const clear = () => {
    setImage(null);
    setError(null);
  };

  return {
    image,
    error,
    busy,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    takePhoto: () => cameraRef.current?.click(),
    chooseFromLibrary: () => libraryRef.current?.click(),
    accept,
    clear,
    cameraRef,
    libraryRef,
  };
}

/** The "+" button and its two-option sheet. */
export function PhotoAttachButton({
  attach,
  disabled,
}: {
  attach: ReturnType<typeof usePhotoAttach>;
  disabled?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={attach.openPicker}
        disabled={disabled}
        aria-label="Attach a photo"
        className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-white/10 text-cream-200 hover:bg-white/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition"
      >
        <ImagePlus size={18} />
      </button>

      {/* Hidden inputs. `capture` opens the camera directly on iOS/Android. */}
      <input
        ref={attach.cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void attach.accept(e.target.files?.[0])}
      />
      <input
        ref={attach.libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void attach.accept(e.target.files?.[0])}
      />

      {attach.pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <button
            aria-label="Close"
            onClick={attach.closePicker}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative w-full sm:max-w-xs rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 p-4 shadow-pop">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold text-sage-900 dark:text-cream-50">
                Show House Bot
              </h3>
              <button
                onClick={attach.closePicker}
                aria-label="Close"
                className="text-sage-400 hover:text-sage-700 p-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={attach.takePhoto}
                disabled={attach.busy}
                className="w-full flex items-center gap-3 rounded-xl bg-sage-50 dark:bg-ink-700 px-4 py-3 text-left hover:bg-sage-100 dark:hover:bg-ink-600 active:scale-[.99] disabled:opacity-50"
              >
                <span className="w-9 h-9 rounded-lg bg-sage-700 text-white grid place-items-center">
                  <Camera size={17} />
                </span>
                <span>
                  <span className="block font-semibold text-sm text-sage-900 dark:text-cream-50">
                    Take a photo
                  </span>
                  <span className="block text-xs text-sage-500 dark:text-ink-400">
                    Use your camera now
                  </span>
                </span>
              </button>
              <button
                onClick={attach.chooseFromLibrary}
                disabled={attach.busy}
                className="w-full flex items-center gap-3 rounded-xl bg-sage-50 dark:bg-ink-700 px-4 py-3 text-left hover:bg-sage-100 dark:hover:bg-ink-600 active:scale-[.99] disabled:opacity-50"
              >
                <span className="w-9 h-9 rounded-lg bg-sage-200 dark:bg-ink-600 text-sage-800 dark:text-cream-50 grid place-items-center">
                  <ImagePlus size={17} />
                </span>
                <span>
                  <span className="block font-semibold text-sm text-sage-900 dark:text-cream-50">
                    Add from library
                  </span>
                  <span className="block text-xs text-sage-500 dark:text-ink-400">
                    Pick an existing picture
                  </span>
                </span>
              </button>
            </div>
            <p className="mt-3 text-[11px] text-center text-sage-400 dark:text-ink-500">
              {attach.busy ? 'Preparing photo…' : 'Photos stay on your device until you send.'}
            </p>
            {attach.error && (
              <p className="mt-2 text-[11px] text-center text-tomato-600 dark:text-tomato-300">
                {attach.error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Thumbnail shown above the composer while an image is attached. */
export function AttachedImageChip({
  image,
  onClear,
}: {
  image: AttachedImage;
  onClear: () => void;
}) {
  const kb = Math.max(1, Math.round((image.data.length * 3) / 4 / 1024));
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/10 border border-white/10 p-2 mb-2">
      <img
        src={image.url}
        alt="Attached photo"
        className="w-12 h-12 rounded-lg object-cover shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-cream-100 truncate">{image.name}</p>
        <p className="text-[10px] text-ink-300">
          {kb} KB · ready to send
        </p>
      </div>
      <button
        onClick={onClear}
        aria-label="Remove attached photo"
        className="shrink-0 text-ink-300 hover:text-cream-50 p-1"
      >
        <X size={15} />
      </button>
    </div>
  );
}
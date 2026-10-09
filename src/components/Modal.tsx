import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** When true, the modal renders full-bleed on mobile (bottom-sheet), centered on desktop. */
  fullBleed?: boolean;
  footer?: ReactNode;
  /** Hide the drag handle (e.g. for desktop-only fullBleed modals). */
  hideHandle?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  fullBleed,
  footer,
  hideHandle,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Save the element that opened the modal so we can restore focus when
    // it closes (a11y expectation).
    previouslyFocused.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Simple focus trap: cycle Tab through the modal's focusable
      // elements so keyboard users can't escape into the page below.
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Move focus into the modal so screen readers announce it.
    // Defer a tick so children (e.g. inputs) that mount in this pass get
    // a chance to register their DOM nodes first.
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelector<HTMLElement>(
        'button:not([disabled]), [autofocus]',
      );
      (focusable ?? root).focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      window.clearTimeout(t);
      // Return focus to the opener if it still exists.
      const prev = previouslyFocused.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Bottom sheet on mobile when fullBleed is true; centered modal otherwise.
  const sheetClasses = fullBleed
    ? 'items-end sm:items-center justify-center'
    : 'items-end sm:items-center justify-center';
  const panelClasses = fullBleed
    ? 'relative bg-cream-50 dark:bg-ink-800 w-full sm:max-w-md sm:mx-4 rounded-t-3xl sm:rounded-3xl shadow-pop flex flex-col overflow-hidden max-h-[94dvh] sm:max-h-[88vh] sheet-enter pb-bar'
    : 'relative bg-cream-50 dark:bg-ink-800 w-full sm:max-w-md sm:mx-4 rounded-3xl shadow-pop flex flex-col overflow-hidden max-h-[94dvh] sm:max-h-[88vh] animate-slide-up';

  return (
    <div
      ref={dialogRef}
      className={`fixed inset-0 z-50 flex ${sheetClasses}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabIndex={-1}
    >
      <div
        className="absolute inset-0 bg-sage-900/40 dark:bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className={panelClasses}>
        {fullBleed && !hideHandle && <div className="sheet-handle sm:hidden" />}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0 sm:pt-5">
          <h2
            id="modal-title"
            className="font-display text-xl font-bold text-sage-900 dark:text-cream-50"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-icon bg-sage-100 dark:bg-ink-700 text-sage-700 dark:text-cream-100 hover:bg-sage-200 dark:hover:bg-ink-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 px-5 pb-5 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer && (
          <div className="px-5 pb-5 pt-3 border-t border-sage-100 dark:border-ink-700 bg-cream-50 dark:bg-ink-800 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
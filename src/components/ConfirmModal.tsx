import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual emphasis for the destructive primary action. Default = tomato. */
  destructive?: boolean;
}

/**
 * In-app confirmation dialog that replaces `window.confirm()` so it works
 * reliably on iOS Safari (where native confirm dialogs sometimes don't
 * render) and in PWA contexts (where they can be silently suppressed).
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="pt-2">
        <div className="flex items-start gap-3 mb-5">
          <span
            className={
              destructive
                ? 'w-10 h-10 shrink-0 rounded-full bg-tomato-50 text-tomato-600 grid place-items-center'
                : 'w-10 h-10 shrink-0 rounded-full bg-sage-100 text-sage-700 grid place-items-center'
            }
          >
            <AlertTriangle size={20} />
          </span>
          <p className="text-sage-700 dark:text-ink-200 leading-relaxed pt-1">{message}</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={
              destructive
                ? 'flex-1 inline-flex items-center justify-center gap-2 rounded-xl font-semibold bg-tomato-600 text-white hover:bg-tomato-700 px-5 py-3 active:scale-[.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-tomato-400'
                : 'btn-primary flex-1'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

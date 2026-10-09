import { useStore } from '../store/useStore';
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import clsx from 'clsx';

const iconFor = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
};

const colorFor = {
  success: 'bg-sage-600 text-white',
  info: 'bg-sage-700 text-white',
  warning: 'bg-butter-500 text-white',
};

export function Toaster() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-3 pt-safe left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(420px,calc(100vw-1.5rem))] pointer-events-none">
      {toasts.map((t) => {
        const Icon = iconFor[t.kind];
        return (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex items-center gap-3 rounded-2xl shadow-pop px-4 py-3 animate-slide-up',
              colorFor[t.kind],
            )}
            role="status"
          >
            <Icon size={20} className="shrink-0" />
            <span className="flex-1 text-sm font-medium">{t.message}</span>
            {t.undo && (
              <button
                onClick={() => {
                  t.undo?.();
                  dismissToast(t.id);
                }}
                className="shrink-0 text-xs font-bold uppercase tracking-wide underline underline-offset-2 hover:opacity-80"
              >
                Undo
              </button>
            )}
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="opacity-80 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

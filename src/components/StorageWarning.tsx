import { AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STORAGE_FAILURE_MESSAGE } from '../utils/appStorage';

/**
 * The banner that says the app is not saving.
 *
 * WHY A BANNER AND NOT A TOAST: the condition lasts as long as the browser
 * refuses to store the change, and a toast is gone in three seconds. Somebody
 * who adds onions while looking away from the screen has to be able to find
 * out that the onions were not kept — and a toast that has already gone is
 * no way to find that out.
 *
 * WHY IT IS AT THE TOP OF EVERY PAGE: the failure is not about the page the
 * user happens to be on — every screen writes to the same storage, so every
 * screen is affected by it.
 *
 * WHY IT SAYS WHAT WILL HAPPEN AND NOT ONLY THAT SOMETHING WENT WRONG: the
 * change is still in the app, and it is gone when the app closes. A user who
 * is told that can go and write the list down somewhere else; a user who is
 * told only that "something went wrong" cannot.
 */
export function StorageWarning() {
  const { storageFailed } = useStore();
  if (!storageFailed) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-30 flex items-start gap-2 border-b border-butter-200/60 dark:border-butter-800/40 bg-butter-50 dark:bg-butter-900/30 px-4 py-2.5 text-[12px] font-medium text-butter-800 dark:text-butter-200"
    >
      <AlertTriangle size={16} className="mt-px shrink-0" />
      <span className="flex-1 leading-snug">{STORAGE_FAILURE_MESSAGE}</span>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Database, RotateCcw, Trash2, Save } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { listBackups, runBackup, restoreBackup, deleteBackup, SNAPSHOT_NOT_SAVED_MESSAGE, type BackupInfo } from '../utils/backup';

/**
 * Backup list, restore and manual snapshot.
 *
 * Restore backs up what it is about to overwrite first, so choosing the wrong
 * snapshot is itself reversible rather than a one-way mistake.
 */
export function BackupPanel() {
  const { toast } = useStore();
  const [info, setInfo] = useState<BackupInfo>({ available: false, stamps: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInfo(listBackups());
  }, []);

  const refresh = () => setInfo(listBackups());

  const snapshotNow = () => {
    setBusy(true);
    // A manual snapshot should always write, so pass force.
    const outcome = runBackup(true);
    setBusy(false);
    refresh();
    // WHY THE REFUSAL IS ITS OWN MESSAGE: "Nothing to save yet" is a
    // statement about the household's data, and it is FALSE when the browser
    // refused the write — the household has plenty to save and the copy was
    // refused. One message cannot be both, so the refusal is said in the
    // words the user can act on: the browser would not store it.
    if (outcome.saved) {
      toast('Snapshot saved', 'success');
    } else if (outcome.reason === 'storage-refused') {
      toast(SNAPSHOT_NOT_SAVED_MESSAGE, 'warning');
    } else {
      toast('Nothing to save yet — add some stock first', 'info');
    }
  };

  const restore = (stamp: string) => {
    const r = restoreBackup(stamp);
    refresh();
    if (r.ok) {
      // Re-read so every screen reflects the restored state immediately.
      window.location.reload();
    } else {
      toast(r.message, 'warning');
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={snapshotNow}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sage-100 dark:bg-ink-700 text-sage-800 dark:text-cream-50 font-semibold text-sm px-3 py-2 hover:bg-sage-200 dark:hover:bg-ink-600 active:scale-[.98] disabled:opacity-50 transition"
        >
          <Save size={14} /> Save a snapshot now
        </button>
        {info.stamps.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-sage-600 dark:text-ink-300"
          >
            <Database size={14} />
            {info.available ? `${info.stamps.length} saved` : 'None yet'}
          </button>
        )}
      </div>

      {!info.available && (
        <p className="text-xs text-sage-500 dark:text-ink-400 mt-2.5">
          No snapshot yet. One is taken automatically once you have stock or groceries, and
          again whenever you return after a while.
        </p>
      )}

      {open && info.stamps.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {info.stamps.map((stamp) => (
            <li
              key={stamp}
              className="flex items-center gap-2 rounded-xl border border-sage-200 dark:border-ink-700 px-3 py-2"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-sage-800 dark:text-cream-100 truncate">
                  {stamp}
                </span>
                {stamp === info.stamps[0] && (
                  <span className="block text-[10px] text-sage-500 dark:text-ink-400">
                    Most recent
                  </span>
                )}
              </span>
              <button
                onClick={() => restore(stamp)}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-sage-700 hover:bg-sage-800 text-white text-xs font-bold px-2.5 py-1.5"
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                onClick={() => {
                  deleteBackup(stamp);
                  refresh();
                  toast('Backup deleted', 'info');
                }}
                aria-label={`Delete backup from ${stamp}`}
                className={clsx(
                  'shrink-0 p-1 text-sage-400 hover:text-tomato-600 dark:text-ink-500',
                )}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
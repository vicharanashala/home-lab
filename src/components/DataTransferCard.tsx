import { useRef, useState } from 'react';
import { Download, Upload, FileJson, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore';
import { exportAppData, BACKUP_VERSION } from '../store/useStore';

/**
 * Download and upload the whole kitchen as one JSON file.
 *
 * WHY THIS IS NOT A NICETY: everything lives in this browser's localStorage,
 * and storage is scoped to the exact address you opened the app from. The
 * same app on a Tailscale hostname and on localhost holds two completely
 * separate copies that cannot see each other. Clearing site data, switching
 * browsers, or switching address all look like losing your groceries, and
 * until this existed there was no way to move the data at all — or to keep a
 * copy anywhere.
 *
 * The file is plain JSON on the user's disk. Nothing is uploaded.
 */
export function DataTransferCard() {
  const { importAppData, toast } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = () => {
    try {
      const json = exportAppData();
      const blob = new Blob([json], { type: 'application/json' });
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homehub-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Backup downloaded', 'success');
    } catch {
      toast('Could not create the backup file', 'warning');
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const res = importAppData(text);
      if (!res.ok) {
        toast(res.error, 'warning');
        return;
      }
      const c = res.counts;
      toast(
        `Restored ${c.grocery} grocery, ${c.stock} in the fridge, ${c.mealLogs} meal log${c.mealLogs === 1 ? '' : 's'}`,
        'success',
      );
    } catch {
      toast('Could not read that file', 'warning');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={download}
          className="btn-primary !px-4 !py-2.5 text-sm"
        >
          <Download size={14} />
          Download my data
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn-secondary !px-4 !py-2.5 text-sm disabled:opacity-60"
        >
          <Upload size={14} />
          {busy ? 'Restoring…' : 'Restore from a file'}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>

      <p className="text-[11px] leading-snug text-sage-500 dark:text-ink-300 flex items-start gap-1.5">
        <FileJson size={12} className="mt-0.5 shrink-0" />
        Saves your grocery list, fridge, meal logs, meal plan and recipes as one
        readable JSON file. This is the only copy outside your browser, so keep
        it somewhere safe.
      </p>

      <p className="text-[11px] leading-snug text-sage-500 dark:text-ink-300 flex items-start gap-1.5">
        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
        Restoring replaces what is here now. Your onboarding choices and
        permissions stay as they are on this device. Backup format v{BACKUP_VERSION}.
      </p>
    </div>
  );
}
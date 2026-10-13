import { useCallback, useEffect, useState } from 'react';
import { Volume2, Check } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';

const VOICE_KEY = 'homehub.voice';

export interface VoiceGroup {
  label: string;
  voices: string[];
}

const FALLBACK_GROUPS: VoiceGroup[] = [
  { label: 'Mixed (recommended)', voices: ['mixed'] },
  { label: 'Indian / Hindi (female)', voices: ['hf_alpha', 'hf_beta'] },
  { label: 'Indian / Hindi (male)', voices: ['hm_omega', 'hm_psi'] },
  { label: 'American (female)', voices: ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky'] },
  { label: 'American (male)', voices: ['am_michael', 'am_fenrir', 'am_puck', 'am_echo'] },
  { label: 'British (female)', voices: ['bf_emma', 'bf_isabella', 'bf_lily'] },
  { label: 'British (male)', voices: ['bm_daniel', 'bm_george'] },
];

const PRETTY: Record<string, string> = {
  mixed: 'Indian dishes, English words',
  hf_alpha: 'Aditi', hf_beta: 'Priya',
  hm_omega: 'Arjun', hm_psi: 'Kabir',
  af_heart: 'Ava', af_bella: 'Bella', af_nicole: 'Nina', af_sarah: 'Sarah', af_sky: 'Skye',
  am_michael: 'Michael', am_fenrir: 'Fenrir', am_puck: 'Puck', am_echo: 'Echo',
  bf_emma: 'Emma', bf_isabella: 'Isabella', bf_lily: 'Lily',
  bm_daniel: 'Daniel', bm_george: 'George',
};

/** Previews a voice by synthesising one short line through the local engine. */
function useVoicePreview() {
  const { toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  const preview = useCallback(async (voice: string) => {
    setBusy(voice);
    try {
      const base = (import.meta as any).env?.VITE_API_BASE_URL || window.location.origin;
      const { bridgeHeaders } = await import('../utils/bridgeToken');
      const res = await fetch(`${base}/api/voice/speak`, {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          text: 'Palak paneer, dal makhani, and two samosa with masala chai.',
          voice,
        }),
      });
      if (!res.ok) throw new Error('preview failed');
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      el.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      el.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      await el.play();
    } catch {
      toast('Could not play a preview — is the local voice engine running?', 'warning');
    } finally {
      setBusy(null);
    }
  }, [toast]);

  return { busy, preview };
}

export function VoicePickerCard() {
  const [groups, setGroups] = useState<VoiceGroup[]>(FALLBACK_GROUPS);
  const [voice, setVoice] = useState<string>(() => {
    try { return localStorage.getItem(VOICE_KEY) || 'hf_alpha'; } catch { return 'hf_alpha'; }
  });
  const { busy, preview } = useVoicePreview();

  // Ask the local engine what it actually supports, so the list never offers
  // a voice that would silently fall back.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const base = (import.meta as any).env?.VITE_API_BASE_URL || window.location.origin;
        const { bridgeHeaders } = await import('../utils/bridgeToken');
        const res = await fetch(`${base}/api/voice/health`, { headers: bridgeHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data?.groups && Object.keys(data.groups).length) {
          setGroups(Object.entries(data.groups).map(([label, voices]) => ({ label, voices: voices as string[] })));
        }
      } catch { /* keep the built-in list */ }
    })();
    return () => { alive = false; };
  }, []);

  const choose = (v: string) => {
    setVoice(v);
    try { localStorage.setItem(VOICE_KEY, v); } catch { /* ignore */ }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 grid place-items-center">
          <Volume2 size={18} />
        </span>
        <div>
          <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Voice</h3>
          <p className="text-xs text-sage-500 dark:text-ink-300">
            Who House Bot sounds like. Tap any name to hear it.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400 mb-1.5">
              {g.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.voices.map((v) => {
                const on = voice === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { choose(v); void preview(v); }}
                    disabled={busy === v}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50',
                      on
                        ? 'bg-sage-600 text-white border-sage-600 shadow-soft'
                        : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-100 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                    )}
                  >
                    {busy === v ? '…' : PRETTY[v] || v}
                    {on && <Check size={11} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-sage-500 dark:text-ink-400">
        <strong className="text-sage-700 dark:text-cream-100">Mixed</strong> says
        Indian dish names with an Indian voice (&ldquo;dal makhani&rdquo;) and the
        surrounding English with an English one. Pick a single voice instead if
        you&rsquo;d rather hear one consistent tone throughout.
      </p>
    </section>
  );
}
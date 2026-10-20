import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, CheckCircle2, XCircle, AlertTriangle, Terminal } from 'lucide-react';
import clsx from 'clsx';

/**
 * Microphone diagnostics.
 *
 * This exists because "the mic does not work" is not a bug report — it is an
 * excuse for four completely different faults, and guessing between them
 * wastes more time than the fix does. A browser can only refuse a microphone
 * for these reasons:
 *
 *   - the page is not a secure context (file://, plain http on a real host)
 *   - the browser has no microphone API at all
 *   - the SITE permission says no
 *   - the OS says no — and on macOS that is a permission for the BROWSER
 *     APPLICATION, not for the web page, which no page-level "Allow" can fix
 *
 * Only the first three show up in the page. The fourth is invisible from here,
 * which is exactly why every earlier attempt ended in a guess. So this page
 * reports what the page can see, honestly labels what it cannot, and then
 * asks the user to actually press the button — the one step only they can do.
 */

type Level = 'ok' | 'bad' | 'warn';

interface Check {
  label: string;
  value: string;
  level: Level;
  meaning: string;
}

interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
  cause: string;
  fix: string[];
}

/**
 * Error names are stable; messages are not. Every rejection is translated
 * here so the UI never shows a raw browser string.
 */
function explainError(err: unknown): ProbeResult {
  const name = (err as { name?: string })?.name || 'UnknownError';
  const message = (err as { message?: string })?.message || '';

  switch (name) {
    case 'NotAllowedError':
      return {
        name, ok: false,
        detail: message || 'Permission denied',
        cause:
          'The browser or the operating system refused the microphone. The page cannot ' +
          'distinguish between a blocked site permission and a block at the OS level.',
        fix: [
          'Check the "Permissions-Policy" row above: if it says the microphone is DISABLED, ' +
            'the server is blocking it and no browser setting will help.',
          'Address-bar icon (left of the URL) → Site settings → Microphone → Allow.',
          'Still blocked? System Settings → Privacy & Security → Microphone, and check ' +
            'that Google Chrome is switched ON. On macOS this permission belongs to the ' +
            'browser application itself — a web page can never override it.',
          'Quit Chrome completely with Cmd+Q and reopen it, so it re-asks macOS.',
        ],
      };
    case 'SecurityError':
      return {
        name, ok: false, detail: message,
        cause: 'The page is not a secure context, so the browser will not expose a microphone.',
        fix: ['Serve the app over https:// or http://localhost — never file://.'],
      };
    case 'NotFoundError':
      return {
        name, ok: false, detail: message,
        cause: 'No microphone exists, or it is switched off in the operating system.',
        fix: ['System Settings → Sound → Input, and check a microphone is selected and live.'],
      };
    case 'NotReadableError':
      return {
        name, ok: false, detail: message,
        cause: 'The microphone exists but another application is holding it exclusively.',
        fix: [
          'Quit anything that might hold the mic — Zoom, Teams, OBS, a DAW, GarageBand, ' +
            'RØDE / Steam streaming tools.',
          'Then try again.',
        ],
      };
    case 'OverconstrainedError':
      return {
        name, ok: false, detail: message,
        cause: 'The microphone exists but cannot provide the settings that were requested.',
        fix: ['Retry with a plain request instead of the tuned audio constraints.'],
      };
    case 'AbortError':
      return {
        name, ok: false, detail: message,
        cause: 'The device was lost, or the page moved away before the request finished.',
        fix: ['Usually recoverable — just try again.'],
      };
    default:
      return {
        name, ok: false, detail: message,
        cause: 'The browser refused the microphone for a reason it did not explain.',
        fix: ['Check the address-bar site permission and the macOS Microphone setting.'],
      };
  }
}

export function MicDiagnostics() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const levelRef = useRef<number>(0);
  const [level, setLevel] = useState(0);

  /* ---- everything the page can see without asking for anything ---- */
  const runStaticChecks = useCallback(() => {
    const isFile = location.protocol === 'file:';
    const secure = !!window.isSecureContext;
    const hasMediaDevices = !!navigator.mediaDevices;
    const hasGum = !!navigator.mediaDevices?.getUserMedia;

    // Whether the SERVER's Permissions-Policy header allows the microphone.
    // This is the check that matters most and used to be missing: an empty
    // allowlist ("microphone=()") disables the microphone outright, and
    // nothing in the browser's permission settings shows it. The browser
    // even reports the permission as "granted" while refusing every request.
    const policy = (document as Document & {
      permissionsPolicy?: { allowsFeature?: (f: string) => boolean };
      featurePolicy?: { allowsFeature?: (f: string) => boolean };
    }).permissionsPolicy || (document as Document & {
      featurePolicy?: { allowsFeature?: (f: string) => boolean };
    }).featurePolicy;
    const policyAllows =
      policy && typeof policy.allowsFeature === 'function'
        ? policy.allowsFeature('microphone')
        : null;

    const out: Check[] = [
      {
        label: 'Origin',
        value: location.origin,
        level: isFile ? 'bad' : 'ok',
        meaning: isFile
          ? 'Opened as a local file. A file:// page has no microphone, no AudioWorklet and no import maps. This alone would explain everything.'
          : 'The address the browser treats as this app.',
      },
      {
        label: 'Secure context',
        value: String(secure),
        level: secure ? 'ok' : 'bad',
        meaning: secure
          ? 'The browser is allowed to offer a microphone here.'
          : 'Without a secure context the microphone is never offered, whatever the permissions say.',
      },
      {
        label: 'navigator.mediaDevices',
        value: String(hasMediaDevices),
        level: hasMediaDevices ? 'ok' : 'bad',
        meaning: hasMediaDevices
          ? 'The microphone API exists in this browser.'
          : 'Absent means an insecure context or a browser too old to support it.',
      },
      {
        label: 'getUserMedia',
        value: String(hasGum),
        level: hasGum ? 'ok' : 'bad',
        meaning: hasGum
          ? 'The browser can be asked for audio here.'
          : 'Without this the microphone cannot be requested at all.',
      },
      {
        label: 'Permissions-Policy',
        value:
          policyAllows === null
            ? 'not reported'
            : policyAllows
              ? 'microphone allowed'
              : 'microphone DISABLED',
        level: policyAllows === false ? 'bad' : 'ok',
        meaning:
          policyAllows === false
            ? 'The server sent a Permissions-Policy header that disables the microphone. This is a fault in the server, not in your browser settings — no padlock or permission reset can undo it.'
            : policyAllows === null
              ? 'This browser does not report the policy, so it cannot be checked from here.'
              : 'The server has not disabled the microphone.',
      },
    ];
    setChecks(out);
  }, []);

  useEffect(() => {
    runStaticChecks();
  }, [runStaticChecks]);

  /* ---- the real test: ask for the microphone, report the exact error ---- */
  const tryMic = async () => {
    setRunning(true);
    setResult(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setResult(explainError(new Error('getUserMedia is not available here')));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      setResult({
        name: 'OK',
        ok: true,
        detail: `${track.label || 'microphone'} · ${settings.sampleRate || '?'} Hz`,
        cause: 'The microphone is live and the browser handed it over.',
        fix: [],
      });
      setLive(true);

      // A visible level meter, so "live" is demonstrated rather than asserted.
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const data = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          levelRef.current = avg;
          setLevel(avg);
          if (streamRef.current) requestAnimationFrame(tick);
        };
        tick();
        (window as any).__micCtx = ctx;
      } catch { /* the meter is a nicety, never a blocker */ }
    } catch (err) {
      setResult(explainError(err));
      setLive(false);
    } finally {
      setRunning(false);
    }
  };

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void (window as any).__micCtx?.close?.();
    setLive(false);
    setLevel(0);
  };

  // Never leave the recording indicator on.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="font-display text-xl font-bold text-sage-900 dark:text-cream-50">
          Microphone check
        </h1>
        <p className="text-sm text-sage-600 dark:text-ink-300 mt-1">
          Everything this page can see, then the one test only you can perform.
        </p>
      </header>

      {/* ---- static checks ---- */}
      <section className="card p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-3">
          What the page can see
        </h2>
        <div className="space-y-2">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5">
              {c.level === 'ok'
                ? <CheckCircle2 size={15} className="text-sage-600 dark:text-sage-400 mt-0.5 shrink-0" />
                : <XCircle size={15} className="text-tomato-500 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <div className="text-sm text-sage-900 dark:text-cream-50">
                  {c.label}: <span className="font-semibold">{c.value}</span>
                </div>
                <div className="text-[11px] leading-snug text-sage-500 dark:text-ink-300">
                  {c.meaning}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- file:// rescue ---- */}
      {location.protocol === 'file:' && (
        <section className="card p-4 border-tomato-300">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-tomato-500" />
            <h2 className="font-bold text-sm text-tomato-700 dark:text-tomato-300">
              This page was opened as a file
            </h2>
          </div>
          <p className="text-sm text-sage-700 dark:text-ink-200 mb-2">
            Browsers block the microphone, AudioWorklet modules and import maps on{' '}
            <code className="font-mono">file://</code> addresses. Start a local server
            and open the app through it instead:
          </p>
          <pre className="bg-ink-900 text-cream-100 text-[11px] rounded-lg p-2.5 overflow-x-auto flex items-start gap-1.5">
            <Terminal size={13} className="mt-0.5 shrink-0 opacity-70" />
            <span>python3 -m http.server 8000</span>
          </pre>
          <p className="text-[11px] text-sage-500 dark:text-ink-300 mt-2">
            Then open <span className="font-mono">http://localhost:8000</span>
          </p>
        </section>
      )}

      {/* ---- the live test ---- */}
      <section className="card p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-3">
          The test only you can run
        </h2>

        <div className="flex flex-wrap gap-2">
          {!live ? (
            <button onClick={tryMic} disabled={running} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-60">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
              {running ? 'Asking…' : 'Try the microphone'}
            </button>
          ) : (
            <button onClick={stopMic} className="btn-secondary !px-4 !py-2 text-sm">
              <MicOff size={14} />
              Stop
            </button>
          )}
          <button onClick={runStaticChecks} className="btn-ghost !px-3 !py-2 text-xs">
            Re-check
          </button>
        </div>

        {live && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-tomato-600 dark:text-tomato-300">
              <span className="w-2 h-2 rounded-full bg-tomato-500 animate-pulse" />
              Microphone is live
            </div>
            <div className="mt-2 h-2 rounded-full bg-sage-100 dark:bg-ink-700 overflow-hidden">
              <div
                className="h-full bg-sage-500 transition-[width] duration-75"
                style={{ width: `${Math.min(100, level * 1.6)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-sage-500 dark:text-ink-300">
              Speak — the bar should move. Silence means the stream is open but hears nothing.
            </p>
          </div>
        )}

        {result && (
          <div
            className={clsx(
              'mt-3 rounded-xl border p-3',
              result.ok
                ? 'border-sage-300 dark:border-sage-800 bg-sage-50/70 dark:bg-sage-900/25'
                : 'border-tomato-300 dark:border-tomato-900 bg-tomato-50/60 dark:bg-tomato-900/20',
            )}
          >
            <div className={clsx('font-semibold text-sm', result.ok ? 'text-sage-800 dark:text-sage-200' : 'text-tomato-700 dark:text-tomato-300')}>
              {result.ok ? 'Working' : `Refused — ${result.name}`}
            </div>
            <div className="text-[11px] text-sage-600 dark:text-ink-300 mt-0.5 break-words">
              {result.detail}
            </div>
            <p className="text-sm text-sage-700 dark:text-ink-200 mt-2">{result.cause}</p>
            {result.fix.length > 0 && (
              <ol className="mt-2 space-y-1 text-[12px] text-sage-700 dark:text-ink-200 list-decimal list-inside">
                {result.fix.map((f, i) => <li key={i}>{f}</li>)}
              </ol>
            )}
          </div>
        )}
      </section>

      <p className="text-[11px] leading-snug text-sage-500 dark:text-ink-400">
        If every check above is green and the button still says "Refused", the block is
        at the operating system rather than in this page. On macOS that lives in
        System Settings → Privacy & Security → Microphone, and it applies to the
        browser application itself — which is why no setting inside the web page can
        undo it.
      </p>
    </div>
  );
}
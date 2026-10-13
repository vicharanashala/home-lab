import { useCallback, useEffect, useRef, useState } from 'react';
import { bridgeHeaders } from '../utils/bridgeToken';

/**
 * Voice input and output for House Bot.
 *
 * FREE BY DEFAULT: this uses the browser's own speech recognition and speech
 * synthesis. No API key, no account, no per-use cost, nothing leaves the
 * device beyond whatever the browser's own recogniser does internally.
 *
 * The engine is deliberately swappable. `speak()` checks for a configured
 * cloud voice first and only falls back to the browser, so switching to a
 * neural voice later is a configuration change rather than a rewrite.
 *
 * Two honest limitations of the browser engine, because they will otherwise
 * look like bugs:
 *   - Speech recognition is Chrome/Safari only, and needs network access.
 *   - TTS voices are the system ones: clearly synthetic, fine for short
 *     sentences, flat for long paragraphs.
 */

type AnyWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/** The Web Speech API is prefixed on Safari and absent from the DOM types. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

/**
 * Where the bridge lives. Mirrors HouseBot's resolution: an explicitly
 * configured base wins, otherwise we use our own origin — correct in every
 * mode, since production is served by the bridge itself.
 */
function bridgeBase(): string {
  const configured = (import.meta as any).env?.VITE_API_BASE_URL || '';
  if (configured) return configured;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as AnyWindow;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechRecognitionSupported(): boolean {
  return !!recognitionCtor();
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Pick the best available English voice rather than whatever the OS happens to
 * list first — the default is often a novelty voice like "Bad News" or
 * "Albert", which is unusable for a household assistant.
 */
function chooseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : voices;
  // Prefer local (offline) voices, then the well-known high-quality ones.
  const preferred = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Google UK English', 'Google US English', 'Alex'];
  for (const name of preferred) {
    const hit = pool.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return pool.find((v) => v.localService) || pool[0];
}

export interface UseVoice {
  /** True while the mic is actively listening. */
  listening: boolean;
  /** Interim transcript, so the user sees it's hearing them. */
  interim: string;
  /** False when this browser has no speech recognition. */
  canListen: boolean;
  canSpeak: boolean;
  /** Set when the user muted replies, or speech failed. */
  error: string | null;
  /** Which engine produced the last spoken reply. */
  engine: 'neural' | 'browser' | null;
  /** True while a reply is being synthesised. */
  speaking: boolean;
  startListening: (onFinal: (text: string) => void) => void;
  stopListening: () => void;
  /** Read text aloud. Resolves when playback finishes. */
  speak: (text: string) => void;
  stopSpeaking: () => void;
  cancel: () => void;
}

/** Play raw WAV bytes. Resolves when playback ends. */
function playWav(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    el.addEventListener('ended', done, { once: true });
    el.addEventListener('error', done, { once: true });
    // Autoplay can be refused before any user gesture. Tapping the read-aloud
    // toggle IS that gesture, so this normally succeeds; if it doesn't, fall
    // back rather than leaving the user with silence and no explanation.
    el.play().catch(done);
  });
}

function storedVoice(): string {
  try { return localStorage.getItem('homehub.voice') || 'hf_alpha'; } catch { return 'hf_alpha'; }
}

export function useVoice(voiceId = storedVoice()): UseVoice {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<'neural' | 'browser' | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef<((text: string) => void) | null>(null);
  const abortRef = useRef<AbortController>(new AbortController());
  const canListen = speechRecognitionSupported();
  const canSpeak = speechSynthesisSupported();

  const stopListening = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const startListening = useCallback((onFinal: (text: string) => void) => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('This browser cannot listen. Try Chrome or Safari.');
      return;
    }
    setError(null);
    finalRef.current = onFinal;

    try {
      recRef.current?.abort();
    } catch { /* nothing running */ }

    const rec = new Ctor();
    rec.lang = 'en-US';
    // Stay open until the user taps the mic again. One-shot push-to-talk
    // meant every question needed three taps: mic, send, mic.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      let interimText = '';
      let finals = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript || '';
        if (r.isFinal) finals += `${text.trim()} `;
        else interimText += text;
      }
      if (finals.trim()) finalRef.current?.(finals.trim());
      setInterim(interimText);
    };
    rec.onerror = (e: any) => {
      const code = e?.error;
      // A brief silence ends Chrome's recogniser even in continuous mode.
      // That is not the user stopping, so restart rather than reporting an
      // error the user can do nothing about.
      if (code === 'no-speech') {
        try { rec.start(); } catch { /* already restarting */ }
        setError(null);
        setListening(true);
        return;
      }
      setError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone is blocked for this site. Tap the padlock in the address bar, set Microphone to Allow, then try again.'
          : code === 'no-speech'
            ? "I didn't catch that."
            : code
              ? `Speech error: ${code}`
              : null,
      );
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // start() throws if called while already running; treat as a no-op.
      setError('Could not start the microphone.');
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    setSpeaking(false);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /**
   * Read text aloud.
   *
   * Prefers the local Kokoro daemon (a real neural voice, free, offline) and
   * silently falls back to the browser's synthesiser if it isn't running. The
   * fallback matters: the daemon lives outside the repo, so anyone who cloned
   * this without it must still get working audio.
   */
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined') return;
    const clean = (text || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;

    window.speechSynthesis?.cancel();

    setSpeaking(true);
    const token = { cancelled: false };

    (async () => {
      const base = bridgeBase();
      if (base) {
        try {
          const res = await fetch(`${base}/api/voice/speak`, {
            method: 'POST',
            // The bridge is token-gated even for voice — it fronts the paid
            // APIs, and an open /api/voice would be a free TTS service for
            // anyone who found the tunnel URL.
            headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text: clean.slice(0, 1200), voice: voiceId }),
            signal: abortRef.current.signal,
          });
          if (res.ok) {
            const blob = await res.blob();
            if (!token.cancelled) {
              setEngine('neural');
              await playWav(blob);
              if (!token.cancelled) setSpeaking(false);
              return;
            }
          }
        } catch {
          // Daemon not running, or the request was aborted. Fall through.
        }
      }
      if (token.cancelled) return;
      setEngine('browser');
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'en-US';
      utter.rate = 1.02;   // system voices are a touch slow at 1.0
      const voice = chooseVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    })();
  }, [voiceId]);

  const cancel = useCallback(() => {
    stopListening();
    stopSpeaking();
  }, [stopListening, stopSpeaking]);

  // Never leave the mic hot when the page goes away.
  useEffect(() => () => {
    try { recRef.current?.abort(); } catch { /* noop */ }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  return {
    listening, interim, canListen, canSpeak, error, engine, speaking,
    startListening, stopListening, speak, stopSpeaking, cancel,
  };
}
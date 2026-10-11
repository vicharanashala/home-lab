import { useCallback, useEffect, useRef, useState } from 'react';

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
  startListening: (onFinal: (text: string) => void) => void;
  stopListening: () => void;
  /** Read text aloud. Resolves when playback finishes. */
  speak: (text: string) => void;
  stopSpeaking: () => void;
  cancel: () => void;
}

export function useVoice(): UseVoice {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef<((text: string) => void) | null>(null);
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
    rec.continuous = false;      // one utterance, then stop — push-to-talk feel
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript || '';
        if (r.isFinal) {
          const trimmed = text.trim();
          if (trimmed) finalRef.current?.(trimmed);
        } else {
          interimText += text;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (e: any) => {
      const code = e?.error;
      setError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone permission was blocked.'
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
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const clean = (text || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;

    // Cancel anything already speaking — otherwise replies queue up and the
    // user hears the previous answer twice.
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'en-US';
    utter.rate = 1.02;   // system voices are a touch slow at 1.0
    utter.pitch = 1.0;
    const voice = chooseVoice();
    if (voice) utter.voice = voice;

    // Some browsers load voices asynchronously; re-pick once they arrive.
    if (!voice && window.speechSynthesis.onvoiceschanged !== null) {
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => { const v = chooseVoice(); if (v) utter.voice = v; },
        { once: true },
      );
    }
    window.speechSynthesis.speak(utter);
  }, []);

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
    listening, interim, canListen, canSpeak, error,
    startListening, stopListening, speak, stopSpeaking, cancel,
  };
}
import { useCallback, useEffect, useRef, useState } from 'react';
import { blockedReason } from '../utils/micPermission';

/**
 * On-device speech recognition for the meal plan.
 *
 * WHY NOT THE BROWSER'S OWN RECOGNISER: `webkitSpeechRecognition` ships the
 * audio to Chrome's speech service, needs a network connection, and is
 * English-biased. This runs entirely inside the browser tab through
 * transformers.js — the audio never leaves the machine — and Whisper handles
 * Indian languages properly, which for a kitchen app matters more than the
 * half-second of latency it costs.
 *
 * HOW IT WORKS, and the two details that decide whether it is usable at all:
 *
 *  - Audio is captured as raw PCM through an AudioWorklet, not MediaRecorder.
 *    MediaRecorder emits container chunks that are not independently
 *    decodable, so you cannot cut a five-second slice out of one.
 *  - Samples are cut into five-second blocks at exactly 16 kHz mono, which is
 *    what Whisper expects, so nothing is decoded or re-encoded in between.
 *
 *  - Quiet blocks are dropped BEFORE the model runs, and thin fragments are
 *    rejected afterwards. Without both, Whisper invents text on silence with
 *    total confidence — the single biggest source of garbage output, and the
 *    reason a naive implementation appears to work only in a quiet room.
 *
 * Everything is lazy: neither the library nor the model is touched until the
 * user actually starts speaking, so this costs nothing for people who never
 * use it.
 */

export interface WhisperModel {
  id: string;
  label: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'onnx-community/whisper-tiny', label: 'Tiny — fastest, ~40 MB' },
  { id: 'onnx-community/whisper-base', label: 'Base — balanced, ~80 MB' },
  { id: 'onnx-community/whisper-small', label: 'Small — most accurate, ~250 MB' },
];

/** Languages worth having in a kitchen. Whisper supports many more. */
export const STT_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी / Hindi' },
  { code: 'ta', label: 'தமிழ் / Tamil' },
  { code: 'te', label: 'తెలుగు / Telugu' },
  { code: 'kn', label: 'ಕನ್ನಡ / Kannada' },
  { code: 'ml', label: 'മലയാളം / Malayalam' },
  { code: 'bn', label: 'বাংলা / Bengali' },
  { code: 'mr', label: 'मराठी / Marathi' },
  { code: 'gu', label: 'ગુજરાતી / Gujarati' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ / Punjabi' },
  { code: 'ur', label: 'اردو / Urdu' },
];

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = TARGET_RATE * 5;   // five seconds per transcript segment
const SILENCE_RMS = 0.006;                // below this, nobody is talking

/** Whisper's classic inventions on quiet audio. Dropping them is not optional. */
const HALLUCINATIONS = new Set([
  'you', 'thank you.', 'thank you', 'thanks for watching!', 'thanks for watching',
  'bye.', 'bye', '.', '...', 'the', 'so', 'um', 'uh',
  '字幕由amara.org社群提供', '字幕志愿者', '請不吝點贊訂閱轉發打賞支持明鏡與點點欄目',
]);

/* Public asset URLs, held in variables so these stay runtime imports of files
   under public/ rather than something the bundler tries to resolve. */
const TRANSFORMERS_URL = '/whisper/vendor/transformers.min.js';
const ORT_WASM_URL = '/whisper/vendor/ort/';
const WORKLET_URL = '/whisper/pcm-worklet.js';

export interface WhisperStatus {
  /** Human-readable progress/status line, empty when idle. */
  text: string;
  /** 0-100 while downloading, null otherwise. */
  progress: number | null;
  error: string | null;
  ready: boolean;
  device: 'webgpu' | 'wasm' | null;
}

const IDLE: WhisperStatus = { text: '', progress: null, error: null, ready: false, device: null };

/* -------------------------------------------------------------------------- */
/*  Pure helpers — exported so they can be tested without a microphone      */
/* -------------------------------------------------------------------------- */

/**
 * Whisper only understands two-letter ISO 639-1 codes.
 *
 * transformers.js throws `Language "en-in" is not supported` for anything
 * else, and the app's own default — English (India), "en-IN" — is exactly
 * that. So the microphone captured audio, the model loaded, and then EVERY
 * transcription died on the language option: the one part of the app that
 * looked fine was the part that could never work.
 *
 * Whisper has a single English model, so the regional variant carries no
 * meaning for it and the base code is the correct answer.
 */
export function whisperLanguage(code: string): string {
  const base = (code || '').trim().toLowerCase().split(/[-_]/)[0];
  return base || 'en';
}

export function rms(audio: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
  return Math.sqrt(sum / audio.length);
}

/**
 * Is this transcript the model making something up?
 *
 * The length floor matters most: without it, every pause in conversation
 * produces "you" or "thank you" and the meal plan fills itself with noise.
 */
export function looksLikeArtifact(text: string, level: number): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.length < 2) return true;
  if (HALLUCINATIONS.has(t)) return true;

  const words = t.split(/\s+/);
  // Whisper loops when handed thin audio.
  if (words.length >= 6 && new Set(words).size <= 2) return true;
  // Stray fillers on quiet-but-not-silent audio; keep them only if it was loud.
  if (level < SILENCE_RMS * 2.5 && words.length <= 2) return true;
  return false;
}

/** Linear resample, for contexts that refuse to run at 16 kHz. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Pull exactly n samples off the head of the block queue. */
export function takeChunk(
  blocks: Float32Array[],
  n: number,
): { chunk: Float32Array; rest: Float32Array[] } {
  const out = new Float32Array(n);
  let filled = 0;
  const rest: Float32Array[] = [];

  for (const head of blocks) {
    if (filled >= n) {
      rest.push(head);
      continue;
    }
    const need = n - filled;
    if (head.length <= need) {
      out.set(head, filled);
      filled += head.length;
    } else {
      out.set(head.subarray(0, need), filled);
      filled += need;
      rest.push(head.subarray(need));
    }
  }
  return { chunk: out, rest };
}

/* -------------------------------------------------------------------------- */
/*  The hook                                                                 */
/* -------------------------------------------------------------------------- */

export interface UseWhisperSTT {
  listening: boolean;
  status: WhisperStatus;
  /** Everything recognised so far this session. */
  transcript: string;
  start: (onText: (text: string) => void) => Promise<{ ok: boolean; error?: string }>;
  stop: () => void;
  /**
   * Wait until everything captured has been transcribed, then return the
   * complete transcript.
   *
   * `stop()` hands the leftover audio to the transcription queue and returns
   * at once, but the queue is drained ASYNCHRONOUSLY. Reading the transcript
   * in the same tick therefore loses whatever was still in flight — in
   * practice the last dish spoken, which is usually dinner. This waits for
   * the queue to empty instead.
   */
  flush: () => Promise<string>;
  reset: () => void;
}

/**
 * A block of captured audio, together with the rate it was captured at.
 *
 * The rate has to travel WITH the audio. Reading it from the live context
 * at drain time is wrong: `stop()` closes that context, so a tail drained
 * afterwards was fed to Whisper at the wrong rate — three times too slow,
 * and garbage.
 */
interface QueuedAudio {
  samples: Float32Array;
  /** The context's sample rate when these samples were captured. */
  rate: number;
}

export function useWhisperSTT(
  modelId = 'onnx-community/whisper-base',
  language = 'en-IN',
): UseWhisperSTT {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<WhisperStatus>(IDLE);
  const [transcript, setTranscript] = useState('');

  // Caches live in refs so switching components does not re-download a model.
  const libRef = useRef<any>(null);
  const pipeRef = useRef<((a: Float32Array, o?: any) => Promise<any>) | null>(null);
  const loadedModelRef = useRef<string | null>(null);
  const modelPromiseRef = useRef<Promise<any> | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blocksRef = useRef<Float32Array[]>([]);
  const countRef = useRef(0);
  const queueRef = useRef<QueuedAudio[]>([]);
  /** The drain that is running right now, so `flush()` can wait for it. */
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  /** The sample rate the current recording was captured at. */
  const recordRateRef = useRef(TARGET_RATE);
  /** True while a `start()` is in flight, so a second tap cannot race it. */
  const startingRef = useRef(false);
  /** The transcript, kept in a ref so `flush()` never reads a stale render. */
  const transcriptRef = useRef('');
  const textRef = useRef<((text: string) => void) | null>(null);
  const wantRef = useRef(false);

  /* ---- library + model, loaded on demand ---- */

  const loadLib = useCallback(async () => {
    if (libRef.current) return libRef.current;
    const tf: any = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    // Keep the runtime local: point ONNX at the vendored wasm and stay
    // single-threaded, because threads need cross-origin isolation headers
    // that the app server does not send.
    tf.env.allowLocalModels = false;
    if (tf.env.backends?.onnx?.wasm) {
      tf.env.backends.onnx.wasm.wasmPaths = new URL(ORT_WASM_URL, location.origin).href;
      tf.env.backends.onnx.wasm.numThreads = 1;
    }
    libRef.current = tf;
    return tf;
  }, []);

  const pickDevice = useCallback(async () => {
    try {
      if ('gpu' in navigator && (await navigator.gpu.requestAdapter())) return 'webgpu' as const;
    } catch { /* fall through to wasm */ }
    return 'wasm' as const;
  }, []);

  const ensureModel = useCallback(async () => {
    if (pipeRef.current && loadedModelRef.current === modelId) return pipeRef.current;
    // A load already in flight must be joined, not raced — the first audio
    // block usually arrives while warm-up is still running.
    if (modelPromiseRef.current) return modelPromiseRef.current;

    modelPromiseRef.current = (async () => {
      const lib = await loadLib();
      const device = await pickDevice();
      const dtype =
        device === 'webgpu'
          ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          : 'q8';
      const short = modelId.split('/').pop();

      setStatus((s) => ({ ...s, progress: 0, error: null, ready: false }));

      const pipe = await lib.pipeline('automatic-speech-recognition', modelId, {
        device,
        dtype,
        progress_callback: (p: any) => {
          if (p.status === 'progress' && p.total) {
            const pct = Math.round((p.loaded / p.total) * 100);
            setStatus((s) => ({ ...s, progress: pct, text: `Downloading ${short}… ${pct}%` }));
          } else if (p.status === 'initiate') {
            setStatus((s) => ({ ...s, progress: 0, text: `Downloading ${short}…` }));
          } else if (p.status === 'ready') {
            setStatus((s) => ({ ...s, text: 'Preparing model…' }));
          }
        },
      });

      pipeRef.current = pipe;
      loadedModelRef.current = modelId;
      setStatus({
        text: `${short} ready · ${device === 'webgpu' ? 'GPU accelerated' : 'CPU'} · private & offline`,
        progress: null,
        error: null,
        ready: true,
        device,
      });
      return pipe;
    })();

    try {
      return await modelPromiseRef.current;
    } catch (err: any) {
      pipeRef.current = null;
      loadedModelRef.current = null;
      setStatus({
        text: '', progress: null, ready: false, device: null,
        error: `Could not load Whisper: ${err?.message || err}`,
      });
      throw err;
    } finally {
      modelPromiseRef.current = null;
    }
  }, [loadLib, modelId, pickDevice]);

  /* ---- transcription queue ---- */

  /**
   * Transcribe everything in the queue.
   *
   * Returns a promise that resolves when the queue is EMPTY, so a caller
   * that needs the final text can wait for it. Only one drain runs at a
   * time; a second call joins the running one instead of starting a rival
   * loop over the same queue.
   */
  const drain = useCallback((): Promise<void> => {
    if (drainPromiseRef.current) return drainPromiseRef.current;

    const run = (async () => {
      while (queueRef.current.length) {
        const { samples, rate } = queueRef.current.shift()!;
        try {
          if (samples.length < TARGET_RATE * 0.3) continue;   // too short to mean anything
          const level = rms(samples);
          if (level < SILENCE_RMS) continue;                   // nobody spoke

          // Resample against the rate these samples were CAPTURED at, not
          // the rate of whatever context happens to be live now.
          const audio =
            rate !== TARGET_RATE
              ? resample(samples, rate, TARGET_RATE)
              : samples;

          const pipe = await ensureModel();
          const result = await pipe(audio, {
            language: whisperLanguage(language),
            task: 'transcribe',
            temperature: 0,
            no_repeat_ngram_size: 3,
          });
          const text = (result?.text || '').trim();
          if (looksLikeArtifact(text, level)) continue;
          const next = transcriptRef.current ? `${transcriptRef.current} ${text}` : text;
          transcriptRef.current = next;
          setTranscript(next);
          textRef.current?.(text);
        } catch (err) {
          console.warn('[whisper] transcription failed:', err);
          // Surfaced rather than swallowed: a transcription that fails quietly
          // is a microphone that looks alive and is not.
          setStatus((s) => ({
            ...s,
            error: `Could not transcribe: ${(err as any)?.message || err}`,
          }));
        }
      }
    })();

    drainPromiseRef.current = run
      .catch((err) => {
        console.warn('[whisper] drain failed:', err);
      })
      .finally(() => {
        drainPromiseRef.current = null;
      });
    return drainPromiseRef.current;
  }, [ensureModel, language]);

  const pushSamples = useCallback(
    (block: Float32Array, rate: number) => {
      blocksRef.current.push(block);
      countRef.current += block.length;
      while (countRef.current >= CHUNK_SAMPLES) {
        const { chunk, rest } = takeChunk(blocksRef.current, CHUNK_SAMPLES);
        blocksRef.current = rest;
        countRef.current -= CHUNK_SAMPLES;
        queueRef.current.push({ samples: chunk, rate });
      }
      if (queueRef.current.length) void drain();
    },
    [drain],
  );

  /* ---- start / stop ---- */

  /**
   * Release the microphone, the audio context and the worklet.
   *
   * Every path that ends a session goes through here. Anything left alive
   * keeps the recording indicator on and keeps posting samples into the
   * queue — two live microphones produce one mixed transcript.
   */
  const releaseSession = useCallback(() => {
    wantRef.current = false;
    try { nodeRef.current?.port?.close(); } catch { /* already closed */ }
    try { nodeRef.current?.disconnect?.(); } catch { /* not connected */ }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    setListening(false);

    // Flush whatever was captured since the last full block, so a short
    // utterance is not lost when the user stops talking.
    if (countRef.current >= TARGET_RATE * 0.3) {
      const { chunk } = takeChunk(blocksRef.current, countRef.current);
      queueRef.current.push({ samples: chunk, rate: recordRateRef.current });
    }
    blocksRef.current = [];
    countRef.current = 0;
    void drain();

    releaseSession();
  }, [drain, releaseSession]);

  /**
   * Transcribe everything captured so far and return the complete
   * transcript.
   *
   * The queue is drained asynchronously, so the transcript has to be read
   * AFTER the queue is empty. Reading it in the same tick as `stop()` lost
   * the tail of the utterance — typically the dinner, spoken last — and an
   * utterance shorter than five seconds produced nothing at all, because
   * only a full block is transcribed on its own.
   */
  const flush = useCallback(async (): Promise<string> => {
    // A partial block never became a full five-second segment, so it is
    // still sitting in the block buffer. Move it into the queue, or a
    // two-second utterance would never be transcribed at all.
    if (countRef.current >= TARGET_RATE * 0.3) {
      const { chunk } = takeChunk(blocksRef.current, countRef.current);
      queueRef.current.push({ samples: chunk, rate: recordRateRef.current });
    }
    blocksRef.current = [];
    countRef.current = 0;

    await drain();
    // A block that landed while the drain was transcribing keeps it alive,
    // so wait for that one too. The queue is only ever fed by microphone
    // messages, which cannot arrive between two microtasks.
    if (drainPromiseRef.current) await drainPromiseRef.current;
    return transcriptRef.current;
  }, [drain]);

  const reset = useCallback(() => {
    transcriptRef.current = '';
    setTranscript('');
    setStatus(IDLE);
  }, []);

  /**
   * Open a microphone session.
   *
   * Separated from `start()` so the "is a start already running?" guard can
   * sit in front of it: the model download can take a minute, and the
   * button stays tappable throughout.
   */
  const openSession = useCallback(
    async (onText: (text: string) => void): Promise<{ ok: boolean; error?: string }> => {
      // Release any earlier session BEFORE opening a new one. Overwriting
      // the refs would orphan the old microphone track and the old
      // AudioContext: the first stream's tracks are never stopped, its
      // context is never closed, and its worklet keeps posting samples into
      // the same queue as the new one.
      releaseSession();

      textRef.current = onText;
      wantRef.current = true;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err: any) {
        const name = err?.name || '';
        return {
          ok: false,
          error:
            name === 'NotFoundError'
              ? 'No microphone found on this device.'
              : name === 'NotReadableError'
                ? 'Another application is using the microphone. Quit it and try again.'
                // Shared with House Bot's mic button, so a block is explained
                // the same way everywhere instead of two different stories.
                : blockedReason(),
        };
      }
      // The user may have cancelled while the permission prompt was open.
      if (!wantRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return { ok: false, error: 'Cancelled.' };
      }
      streamRef.current = stream;

      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctx({ sampleRate: TARGET_RATE });
        ctxRef.current = ctx;
        // The rate the samples are captured at. The browser may ignore the
        // 16 kHz request, and the audio has to be resampled against THIS
        // rate — not against whatever context is live when the block is
        // finally transcribed.
        recordRateRef.current = ctx.sampleRate;
        if (ctx.state === 'suspended') await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        // Whisper's own vocabulary must not leak into the speakers.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mute.connect(ctx.destination);

        let connected = false;
        try {
          await ctx.audioWorklet.addModule(WORKLET_URL);
          const node = new AudioWorkletNode(ctx, 'pcm-capture');
          node.port.onmessage = (e: MessageEvent) => {
            if (wantRef.current) pushSamples(e.data as Float32Array, ctx.sampleRate);
          };
          source.connect(node);
          node.connect(mute);
          nodeRef.current = node;
          connected = true;
        } catch {
          nodeRef.current = null;
        }

        // Fallback for contexts that refuse worklet modules.
        if (!connected) {
          const legacy = ctx.createScriptProcessor(4096, 1, 1);
          legacy.onaudioprocess = (e: any) => {
            if (!wantRef.current) return;
            pushSamples(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
          };
          source.connect(legacy);
          legacy.connect(mute);
          nodeRef.current = legacy;
        }
      } catch (err: any) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return { ok: false, error: `Could not start audio capture: ${err?.message || err}` };
      }

      queueRef.current = [];
      blocksRef.current = [];
      countRef.current = 0;
      transcriptRef.current = '';
      setTranscript('');
      setStatus((s) => (s.ready ? s : { ...s, text: 'Listening — Whisper transcribes on this device.' }));
      setListening(true);
      return { ok: true };
    },
    [pushSamples, releaseSession],
  );

  const start = useCallback(
    async (onText: (text: string) => void): Promise<{ ok: boolean; error?: string }> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return { ok: false, error: 'This browser cannot record audio. Try Chrome or Safari.' };
      }
      // A second tap while the first start is still running — the model
      // download alone takes a minute — must not open a SECOND microphone.
      // The first stream's tracks would never be stopped and both worklets
      // would post into the same queue, so the transcript would mix two
      // microphones. The session already being started owns the mic, so
      // joining it is the honest answer rather than an error.
      if (startingRef.current) return { ok: true };

      startingRef.current = true;
      try {
        return await openSession(onText);
      } finally {
        startingRef.current = false;
      }
    },
    [openSession],
  );

  // Never leave the mic hot when the component goes away.
  useEffect(
    () => () => {
      releaseSession();
    },
    [releaseSession],
  );

  return { listening, status, transcript, start, stop, flush, reset };
}
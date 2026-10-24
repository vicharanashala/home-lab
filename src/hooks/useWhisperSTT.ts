import { useCallback, useEffect, useRef, useState } from 'react';
import { blockedReason } from '../utils/micPermission';
import { looksLikeArtifact, foldTranscript, trimLoop, SILENCE_RMS } from '../utils/whisperText';
import { AUTO_MODEL, WHISPER_MODELS, modelForDevice, rememberedDevice } from '../utils/whisperModel';
import type { WhisperModel } from '../utils/whisperModel';

export { AUTO_MODEL, WHISPER_MODELS, modelForDevice };
export type { WhisperModel };

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
 * The rules live in utils/whisperText, where they can be tested without a
 * microphone. The silence threshold is passed in because it belongs to the
 * capture side of the app.
 */
export function isArtifact(text: string, level: number): boolean {
  return looksLikeArtifact(text, level, SILENCE_RMS);
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
  modelId = AUTO_MODEL,
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
  /** Whether this device has a GPU, decided once and then kept. */
  const deviceRef = useRef<(() => Promise<'webgpu' | 'wasm'>) | null>(null);

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

  /**
   * Whether this device can use the GPU, decided ONCE per session.
   *
   * The answer picks the model, and the model has to be the same one the
   * whole session through — so it is asked once and kept. See
   * `rememberedDevice` for what went wrong when it was asked every block.
   */
  const pickDevice = useCallback(async (): Promise<'webgpu' | 'wasm'> => {
    if (!deviceRef.current) {
      deviceRef.current = rememberedDevice(async () => {
        if (!('gpu' in navigator)) return false;
        return !!(await navigator.gpu.requestAdapter());
      });
    }
    return deviceRef.current();
  }, []);

  const ensureModel = useCallback(async () => {
    // The device decides which model "auto" means, so it has to be known
    // before the model is chosen — not after.
    const device = await pickDevice();
    const resolvedId = modelForDevice(modelId, device);
    if (pipeRef.current && loadedModelRef.current === resolvedId) return pipeRef.current;
    // A load already in flight must be joined, not raced — the first audio
    // block usually arrives while warm-up is still running.
    if (modelPromiseRef.current) return modelPromiseRef.current;

    modelPromiseRef.current = (async () => {
      const lib = await loadLib();
      const dtype =
        device === 'webgpu'
          ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          : 'q8';
      const short = resolvedId.split('/').pop();

      setStatus((s) => ({ ...s, progress: 0, error: null, ready: false }));

      const pipe = await lib.pipeline('automatic-speech-recognition', resolvedId, {
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
      loadedModelRef.current = resolvedId;
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
            // BEAM SEARCH instead of greedy decoding.
            //
            // Greedy decoding takes the single most likely token at each
            // step, which is fine for ordinary English and poor for names
            // that are not English words at all. "Dosa", "paneer", "chole"
            // and "biryani" have no strong language-model prior, so greedy
            // decoding settles on the first plausible spelling — "dosaa",
            // "painter" — while beam search keeps the likeliest one. It costs
            // a few times the compute of greedy decoding, which on a
            // five-second block is a small price for the dish names being
            // right the first time.
            num_beams: 5,
            // Whisper falls into a loop on thin audio, and a loop used to be
            // caught only AFTERWARDS, by throwing the whole sentence away.
            // Penalising repetition stops the loop at the source, so the
            // sentence survives instead of being discarded.
            repetition_penalty: 1.1,
            no_repeat_ngram_size: 3,
          });
          const text = (result?.text || '').trim();
          // A block can be the user's own speech with a loop welded onto the
          // end of it, so the loop is cut off FIRST and what is left is
          // judged on its own. Asking "is this rubbish?" about the joined
          // text threw the speech away along with the loop, and the user was
          // told nothing had been picked up when it had.
          const kept = trimLoop(text);
          if (kept === null) continue;             // nothing but a loop
          if (isArtifact(kept, level)) continue;   // what is left is rubbish

          // A LOOP CAN SPAN BLOCKS, so the joined transcript is checked, not
          // only the block. See foldTranscript for why the loop is cut off
          // where it starts rather than the whole transcript being dropped.
          const next = foldTranscript(transcriptRef.current, kept);
          if (next === null) {
            transcriptRef.current = '';
            setTranscript('');
            continue;
          }

          transcriptRef.current = next;
          setTranscript(next);
          textRef.current?.(kept);
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
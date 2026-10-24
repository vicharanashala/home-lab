/**
 * Which Whisper model to use, and how the sizes compare.
 *
 * Whisper's accuracy scales with the model and so does the time it takes.
 * Measured on this app's own pipeline, transcribing one five-second block
 * with no GPU:
 *
 *   base    3.7 s
 *   small  12.7 s
 *
 * Small is the better model and it is three and a half times the work. On a
 * GPU that is a bargain; on a phone's CPU it is thirteen seconds of waiting
 * for one dish. So the default follows the device rather than always asking
 * for the biggest model, and the picker still lets anyone choose.
 */

export interface WhisperModel {
  id: string;
  label: string;
}

/** "Whatever this device can manage", resolved when the model is loaded. */
export const AUTO_MODEL = 'auto';

export const WHISPER_MODELS: WhisperModel[] = [
  { id: AUTO_MODEL, label: 'Auto — the most accurate this device can manage' },
  { id: 'onnx-community/whisper-tiny', label: 'Tiny — fastest, least accurate, ~40 MB' },
  { id: 'onnx-community/whisper-base', label: 'Base — balanced, ~80 MB' },
  { id: 'onnx-community/whisper-small', label: 'Small — most accurate, ~250 MB' },
];

/** The model the device can carry, given whether it has a GPU. */
export function modelForDevice(modelId: string, device: 'webgpu' | 'wasm'): string {
  if (modelId !== AUTO_MODEL) return modelId;
  return device === 'webgpu'
    ? 'onnx-community/whisper-small'
    : 'onnx-community/whisper-base';
}

/**
 * Whether this device can use the GPU — asked once, and then remembered.
 *
 * WHY IT IS ASKED ONCE: the answer picks the model, and the model has to be
 * the SAME one the whole session through. Asking the browser for a fresh GPU
 * adapter on every five-second block meant the answer could change between
 * blocks, and the change was invisible: "auto" resolved to the CPU model
 * while the GPU model was the one already loaded, the "already loaded" check
 * missed, and the app downloaded and swapped models in the middle of a
 * sentence.
 *
 * AND WHY THE ADAPTER MUST NOT BE ASKED FOR REPEATEDLY: every adapter that
 * is asked for and thrown away without being released is one the browser
 * still has to account for, and a browser that has seen too many of them
 * starts handing back nothing at all — which is the same silent change of
 * answer, one step further along.
 *
 * @param hasGpu asks the browser whether a GPU is available
 */
export function rememberedDevice(
  hasGpu: () => Promise<boolean>,
): () => Promise<'webgpu' | 'wasm'> {
  let device: 'webgpu' | 'wasm' | null = null;
  return async () => {
    if (device) return device;
    let gpu = false;
    try {
      gpu = await hasGpu();
    } catch {
      // A browser with no WebGPU at all throws here, and a browser that
      // cannot give an adapter has no GPU to use. Both are the CPU.
      gpu = false;
    }
    device = gpu ? 'webgpu' : 'wasm';
    return device;
  };
}

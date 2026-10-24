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

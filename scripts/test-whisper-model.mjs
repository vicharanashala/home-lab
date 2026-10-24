/**
 * Tests for which Whisper model a device gets.
 *
 * The model sizes are very different in cost: measured on this app's own
 * pipeline, one five-second block takes 3.7 s on base and 12.7 s on small
 * with no GPU. So "auto" has to mean different things on a phone and on a
 * desktop.
 *
 * Run with:  node scripts/test-whisper-model.mjs
 */
import { modelForDevice, AUTO_MODEL } from '../src/utils/whisperModel.ts';

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('\nauto follows the device');
ok(modelForDevice(AUTO_MODEL, 'webgpu') === 'onnx-community/whisper-small',
  'a GPU gets the accurate model', modelForDevice(AUTO_MODEL, 'webgpu'));
ok(modelForDevice(AUTO_MODEL, 'wasm') === 'onnx-community/whisper-base',
  'a CPU gets the fast one', modelForDevice(AUTO_MODEL, 'wasm'));

console.log('\nan explicit choice is never overridden');
ok(modelForDevice('onnx-community/whisper-small', 'wasm') === 'onnx-community/whisper-small',
  'small stays small on a CPU');
ok(modelForDevice('onnx-community/whisper-tiny', 'webgpu') === 'onnx-community/whisper-tiny',
  'tiny stays tiny on a GPU');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

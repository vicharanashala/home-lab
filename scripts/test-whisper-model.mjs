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
import { modelForDevice, rememberedDevice, AUTO_MODEL } from '../src/utils/whisperModel.ts';

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

console.log('\nthe device is asked about ONCE, and the answer never changes');
// The device decides the model, and the model has to be the same one the
// whole session through. The hook asks the browser for a GPU adapter once
// per five-second block, so a block that came back empty turned "auto"
// into the CPU model while the GPU model was the one already loaded — the
// "already loaded" check missed, and the app downloaded and swapped models
// in the middle of a sentence.
{
  let asked = 0;
  const device = rememberedDevice(async () => { asked += 1; return true; });
  const first = await device();
  const second = await device();
  const third = await device();
  ok(asked === 1, 'the browser is asked once, not once per block', `asked ${asked} times`);
  ok(first === 'webgpu' && second === 'webgpu' && third === 'webgpu',
    'the answer is the same every time', `${first}, ${second}, ${third}`);
}
{
  // The answer must not change even when the browser starts failing: that
  // is exactly the case that swapped the model mid-sentence.
  let asked = 0;
  let answer = true;
  const device = rememberedDevice(async () => { asked += 1; return answer; });
  await device();
  answer = false;
  const later = await device();
  ok(later === 'webgpu', 'a later failure does not change the device', later);
  ok(asked === 1, 'and the browser is not asked again', `asked ${asked} times`);
}
{
  // A browser with no WebGPU throws when the adapter is asked for.
  const device = rememberedDevice(async () => { throw new Error('no WebGPU'); });
  const d = await device();
  ok(d === 'wasm', 'a browser that cannot answer falls back to the CPU', d);
}
{
  let asked = 0;
  const device = rememberedDevice(async () => { asked += 1; return false; });
  await device();
  await device();
  ok(asked === 1, 'a CPU is asked about once too', `asked ${asked} times`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Tests for deciding whether a transcript is worth keeping.
 *
 * A hallucination in a meal plan is worse than silence: a slot holding
 * "Thank you. Thank you." is a slot holding a dish that does not exist, and
 * the taste model then learns from it forever.
 *
 * Run with:  node scripts/test-whisper-text.mjs
 */
import { looksLikeArtifact, hasRepeatedPhrase, SILENCE_RMS } from '../src/utils/whisperText.ts';

/** Loud enough to be someone actually talking. */
const LOUD = 0.08;
/** Quiet, but not silence. */
const QUIET = 0.008;

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

const artifact = (text, level = LOUD) => looksLikeArtifact(text, level, SILENCE_RMS);

console.log('\nnothing at all is rubbish');
ok(artifact(''), 'empty');
ok(artifact('   '), 'only spaces');
ok(artifact('a'), 'one character');
ok(artifact('.'), 'a full stop');

console.log('\nWhisper’s classic inventions');
ok(artifact('You'), 'a bare "you"');
ok(artifact('Thank you.'), 'a bare "thank you."');
ok(artifact('Bye.'), 'a bare "bye."');
ok(artifact('um'), 'a bare "um"');
ok(artifact('字幕由amara.org社群提供'), 'a subtitle artefact');

console.log('\nthe repeated PHRASE loop, which is Whisper’s signature');
// This is the loop it falls into on thin audio. It has plenty of distinct
// words, so counting distinct words never caught it — and a loop that slips
// through puts a whole sentence of rubbish in the plan.
ok(artifact("I'm sorry. I'm sorry. I'm sorry. I'm sorry."), 'a phrase repeated four times');
ok(artifact('Thank you. Thank you. Thank you.'), '"thank you" three times');
ok(artifact('dal dal dal dal'), 'one word four times');
ok(
  hasRepeatedPhrase('i am sorry i am sorry i am sorry'.split(' ')),
  'the repeated phrase is found by the helper',
);

console.log('\nbut a dish said twice is not a loop');
ok(!artifact('dal dal'), '"dal dal" is kept');
ok(!artifact('rice rice'), '"rice rice" is kept');

console.log('\nreal speech is kept, however short');
ok(!artifact('idli', QUIET), '"idli" spoken quietly is kept');
ok(!artifact('dal', QUIET), '"dal" spoken quietly is kept');
ok(!artifact('upma', QUIET), '"upma" spoken quietly is kept');
ok(!artifact('masala dosa', QUIET), 'a two-word dish spoken quietly is kept');
ok(!artifact('breakfast masala dosa', LOUD), 'a whole meal is kept');
ok(!artifact('chole bhature', LOUD), 'a real dish is kept');

console.log('\nfiller sounds on quiet audio are rubbish');
ok(artifact('um', QUIET), '"um" on quiet audio');
ok(artifact('okay', QUIET), '"okay" on quiet audio');
ok(artifact('hmm', QUIET), '"hmm" on quiet audio');

console.log('\nWhisper punctuates what it hears, and the punctuation has to come off');
// Whisper writes "um." and "Okay.", never "um" and "okay" — the bare word
// was looked up in the set of fillers WITH its full stop still on it, so it
// was not found. A filler said on quiet audio therefore reached the plan as
// if it were a dish. The same word with and without its stop has to behave
// the same way.
ok(artifact('um.', QUIET), '"um." on quiet audio');
ok(artifact('okay.', QUIET), '"okay." on quiet audio');
ok(artifact('yeah.', QUIET), '"yeah." on quiet audio');
ok(artifact('right,', QUIET), '"right," on quiet audio');
ok(artifact('hmm!', QUIET), '"hmm!" on quiet audio');
ok(artifact('um.', LOUD), '"um." on loud audio');
ok(!artifact('idli.', QUIET), '"idli." spoken quietly is still a dish');

console.log('\na loop that starts part way through the transcript is still a loop');
// The check looked for the repeated phrase starting at the FIRST word, so a
// loop that began after a couple of words was not seen at all. Whisper does
// this: it says something, then falls into the repetition.
ok(
  hasRepeatedPhrase('so the dal rice dal rice dal rice dal rice'.split(' ')),
  'a phrase loop after a few words is found',
);
ok(
  artifact('so the chole bhature chole bhature chole bhature chole bhature'),
  'the loop is caught in a full transcript',
);
ok(
  artifact('okay the dal and rice dal rice dal rice dal rice dal rice'),
  'a two-word loop after a few words is caught',
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

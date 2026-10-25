/**
 * Tests that the voice the Settings card shows is the voice House Bot speaks with.
 *
 * WHY THIS MATTERS
 * The chosen voice is kept in the browser's storage, and it is read in two
 * places that have to agree:
 *
 *   the Settings card   which chip is ticked — "Mixed" or "Aditi"
 *   the spoken reply    the voice sent to the engine with the words
 *
 * When those two fell back differently, the card showed one voice and the app
 * spoke with another. The commit that added the Mixed voice (c89a17a) made
 * Mixed the default and changed the hook's fallback to match — but the card
 * kept a fallback of its own:
 *
 *     the card:  localStorage.getItem('homehub.voice') || 'hf_alpha'
 *     the hook:  localStorage.getItem('homehub.voice') || 'mixed'
 *
 * So on a browser that had never chosen a voice — a new phone, a cleared
 * browser, a household that had never opened Settings — the card ticked
 * "Aditi" and House Bot spoke with Mixed. Nothing said otherwise, and the
 * card's tick is the only thing that tells the user which voice they have.
 *
 * WHAT IS TESTED HERE
 * The rule that reads the voice, the rule that stores it, and the card itself:
 * the chip it ticks when nothing is stored must be the chip of the voice the
 * app will actually speak with — and the chip it leaves ticked when the
 * browser refuses to store the voice must not move, and the refusal must be
 * said out loud.
 *
 * Run with:  node scripts/test-voice-default.mjs
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./lib/ts-resolve.mjs', import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(REPO, 'node_modules'))) {
  console.error('node_modules is missing — run npm install first');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* A browser that holds the voice choice                                        */
/* -------------------------------------------------------------------------- */

/** What the browser actually holds. */
const held = {};
/** Whether the next write is refused, the way a blocked or full one is. */
let refuseWrites = false;

/**
 * The browser, as the app sees it.
 *
 * WHY THE ACCESS TO `localStorage` IS NOT ITSELF THROWN: a browser with
 * storage blocked throws when the app READS `window.localStorage`, not only
 * when it writes. The getter that throws is exercised by
 * scripts/test-storage-blocked.mjs; here the storage answers and simply
 * refuses the writes the test asks it to refuse.
 */
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in held ? held[k] : null),
    setItem: (k, v) => {
      if (refuseWrites) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      held[k] = v;
    },
    removeItem: (k) => { delete held[k]; },
  },
};

const require = createRequire(path.join(REPO, 'package.json'));
const { build } = require('esbuild');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const {
  DEFAULT_VOICE_ID,
  VOICE_LABELS,
  VOICE_STORAGE_KEY,
  VOICE_NOT_SAVED_MESSAGE,
  storedVoiceId,
  saveVoiceId,
} = await import('../src/utils/voice.ts');

/**
 * The Settings card, built from the real component.
 *
 * WHY IT IS BUILT AND NOT IMPORTED: the card is a `.tsx`, and node cannot
 * load one. It is bundled with esbuild, rendered, and read.
 *
 * WHY THE STORE AND THE VOICE MODULE ARE PULLED OUT OF THE BUNDLE: a bundle
 * that carried its own copy of either would answer about its own copy, not
 * about the one this test drives. They are pointed at the very modules this
 * test drives instead — the same URL, so node loads one instance and both see
 * the same answer.
 */
const cardBundle = await build({
  entryPoints: [path.join(REPO, 'src/components/VoicePickerCard.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'lucide-react', 'clsx'],
  plugins: [
    {
      name: 'share-the-store-and-the-voice',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/(store\/useStore|utils\/voice)$/ }, (args) => {
          const target = path.resolve(args.resolveDir, `${args.path}.ts`);
          return { path: pathToFileURL(target).href, external: true };
        });
      },
    },
  ],
});
const cardDir = await mkdtemp(path.join(tmpdir(), 'hh-voice-card-'));
// The bundle lives outside the checkout, so it cannot find the packages the
// card imports on its own.
await symlink(path.join(REPO, 'node_modules'), path.join(cardDir, 'node_modules'));
const cardFile = path.join(cardDir, 'VoicePickerCard.mjs');
await writeFile(cardFile, cardBundle.outputFiles[0].text);
const { VoicePickerCard } = await import(pathToFileURL(cardFile).href);

let passed = 0;
let failed = 0;

function check(label, got, expected) {
  const have = JSON.stringify(got);
  const want = JSON.stringify(expected);
  if (have === want) {
    passed += 1;
    console.log(`  ok   ${label} -> ${have}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label} -> ${have}, expected ${want}`);
  }
}

/**
 * The name on the chip the card has ticked.
 *
 * WHY THE TICK IS FOUND BY ITS MARKED-ON STYLE: the chip that is on is the
 * one the card renders in the selected colour, and the check mark beside it.
 * Reading the name off the DOM is what the user reads, so it is the thing
 * that has to be right.
 *
 * @returns the name on the ticked chip, or null when none is ticked
 */
function tickedChip() {
  const html = renderToString(createElement(VoicePickerCard));
  const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  const on = buttons.filter((b) => b.includes('bg-sage-600'));
  if (on.length !== 1) return null;
  return on[0]
    .replace(/^[^>]*>/, '')
    .replace(/<\/button>$/, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nthe voice the app speaks with');
{
  check('a browser that has never chosen one falls back to the default', storedVoiceId(), DEFAULT_VOICE_ID);
  check('and the default is Mixed — Indian dishes in an Indian voice', DEFAULT_VOICE_ID, 'mixed');

  held[VOICE_STORAGE_KEY] = 'hf_alpha';
  check('a chosen voice is the voice that is used', storedVoiceId(), 'hf_alpha');
  delete held[VOICE_STORAGE_KEY];
}

console.log('\nand keeping the chosen voice');
{
  check('a browser that stores it says it kept it', saveVoiceId('af_heart'), true);
  check('and the voice is there', storedVoiceId(), 'af_heart');

  refuseWrites = true;
  check('a browser that refuses says it did not', saveVoiceId('bm_daniel'), false);
  check('and the old voice is still the one in use', storedVoiceId(), 'af_heart');
  refuseWrites = false;

  delete held[VOICE_STORAGE_KEY];
}

/* -------------------------------------------------------------------------- */
/* The card                                                                    */
/* -------------------------------------------------------------------------- */

console.log('\nand the card ticks the voice the app will actually speak with');
{
  // The browser has never chosen a voice. The card must tick Mixed, because
  // Mixed is what the app speaks with — not Aditi, which is what the card
  // used to tick while the app said something else entirely.
  check(
    'with nothing stored the card ticks the default voice',
    tickedChip(),
    VOICE_LABELS[DEFAULT_VOICE_ID],
  );

  // A household that DID choose a voice must still see its own choice ticked.
  held[VOICE_STORAGE_KEY] = 'hf_alpha';
  check(
    'a chosen voice is ticked on the card',
    tickedChip(),
    VOICE_LABELS.hf_alpha,
  );
  check(
    'and it is the voice the app will speak with',
    storedVoiceId(),
    'hf_alpha',
  );

  delete held[VOICE_STORAGE_KEY];
}

/* -------------------------------------------------------------------------- */
/* The card, when the browser refuses the write                                */
/* -------------------------------------------------------------------------- */

/**
 * WHY THIS BLOCK IS HERE AND NOT IN THE ONE ABOVE
 * The card used to move its chip to the chosen voice and swallow the error
 * when the browser refused the write:
 *
 *     const choose = (v: string) => {
 *       setVoice(v);
 *       try { localStorage.setItem(VOICE_KEY, v); } catch { /* ignore *\/ }
 *     };
 *
 * so the card ticked a voice the browser had never taken — the chip and
 * House Bot disagreed, and the chip jumped back on the next reload. The card
 * now moves the chip only when the browser kept the voice, and says so when
 * it did not.
 *
 * WHY NOTHING MEASURED IT: the block above renders the card and reads the
 * chip it ticks, which is the chip it ticks on the way IN. The chip on the
 * way OUT — the one that moves when the write is refused — is a different
 * thing, and it was in no committed test. So the rule could stop working with
 * every check in this repository still green.
 */
console.log('\nand a voice the browser refused to store');
{
  // WHY A SECOND BUNDLE: the first one leaves the store outside, so the card
  // and the test share one store. That is right for reading the chip, and
  // wrong for this: the store's server snapshot is frozen and empty, so the
  // toast the card raises cannot be read from it. This bundle has the store
  // INSIDE, with the snapshot pointed at the live state, so the toast the
  // card raises is the one the test reads.
  const refusingDir = await mkdtemp(path.join(tmpdir(), 'hh-voice-refused-'));
  await symlink(path.join(REPO, 'node_modules'), path.join(refusingDir, 'node_modules'));

  // WHY THE ENTRY IS A FILE OF ITS OWN: the test needs the store as well as
  // the card, and it has to be the SAME store the card uses — the card
  // reaches it by a relative path and the entry by an absolute one, and
  // esbuild would otherwise keep two of them and the toast would go to a
  // store nobody is reading.
  const entry = path.join(refusingDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export { VoicePickerCard } from ${JSON.stringify(path.join(REPO, 'src/components/VoicePickerCard.tsx'))};`,
      `export { useStore } from ${JSON.stringify(path.join(REPO, 'src/store/useStore.ts'))};`,
      '',
    ].join('\n'),
  );

  const refusingBundle = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom/server', 'lucide-react', 'clsx'],
    plugins: [
      {
        name: 'one-store-one-voice-module',
        setup(b) {
          // The store goes inside this bundle, and the card and the entry
          // must get the same one.
          b.onResolve({ filter: /^\.\.\/store\/useStore$/ }, () => ({
            path: path.join(REPO, 'src/store/useStore.ts'),
          }));
          // The voice module stays outside, so the card and the test share
          // the one instance the test drives — the browser that refuses.
          b.onResolve({ filter: /^\.\.\/utils\/voice$/ }, () => ({
            path: pathToFileURL(path.join(REPO, 'src/utils/voice.ts')).href,
            external: true,
          }));
        },
      },
    ],
  });

  // The server renderer always reads the frozen SSR snapshot, which is built
  // from seedState() once and never changes — so the card would raise its
  // toast into a store the test cannot see. Point it at the live state.
  const source = refusingBundle.outputFiles[0].text;
  const patched = source.replace('return SERVER_SNAPSHOT;', 'return getState();');
  if (patched === source) {
    console.error(
      "harness: the store's server snapshot hook moved — this test needs updating",
    );
    process.exit(1);
  }
  const refusingFile = path.join(refusingDir, 'refusing.mjs');
  await writeFile(refusingFile, patched);
  const { VoicePickerCard, useStore } = await import(pathToFileURL(refusingFile).href);

  /** Every element in the tree that has a click handler. */
  function clickables(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const child of node) clickables(child, out);
      return out;
    }
    if (node.props?.onClick) out.push(node);
    clickables(node.props?.children, out);
    return out;
  }

  /** The visible text of a tree of elements. */
  function textOf(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (node.props) return textOf(node.props.children);
    return '';
  }

  // The household is on Mixed, and the browser is about to refuse.
  held[VOICE_STORAGE_KEY] = DEFAULT_VOICE_ID;

  let tree = null;
  function Capture() {
    tree = VoicePickerCard();
    return null;
  }
  renderToString(createElement(Capture));

  const aditi = clickables(tree).find((el) => textOf(el.props.children).trim() === 'Aditi');
  if (!aditi) {
    check('the card offers a voice to tap', false, true);
  } else {
    check('the card offers a voice to tap', true, true);

    // The tap. The browser refuses the write, the way a blocked or a full
    // storage refuses it.
    refuseWrites = true;
    aditi.props.onClick();
    refuseWrites = false;

    // The card also previews the voice it was tapped, and that preview fails
    // here — there is no engine to play it. Let it settle, so the toast the
    // test reads is the whole story and not half of it.
    await new Promise((r) => setTimeout(r, 20));

    let toasts = [];
    function CaptureToasts() {
      toasts = useStore().toasts;
      return null;
    }
    renderToString(createElement(CaptureToasts));

    const refusal = toasts.find((t) => t.message === VOICE_NOT_SAVED_MESSAGE);
    check('a refused write says the voice was not saved', Boolean(refusal), true);
    check('and it is a warning, not a success', refusal ? refusal.kind : null, 'warning');
    check(
      'and the browser still holds the voice the app was speaking with',
      storedVoiceId(),
      DEFAULT_VOICE_ID,
    );
  }

  delete held[VOICE_STORAGE_KEY];
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

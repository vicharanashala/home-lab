/**
 * Tests for the digital store directory.
 *
 * The list is the whole feature, so what matters is that every entry is a
 * real store with a real address, that nothing is listed twice, and that the
 * kinds the filters offer are the kinds the stores actually use.
 *
 * Run with:  node scripts/test-digital-stores.mjs
 */
import {
  DIGITAL_STORES,
  DIGITAL_STORE_KINDS,
  digitalStoresOfKind,
} from '../src/utils/digitalStores.ts';

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

console.log('\nevery store is usable');
for (const s of DIGITAL_STORES) {
  const problems = [];
  if (!s.id) problems.push('no id');
  if (!s.name) problems.push('no name');
  if (!s.note) problems.push('no note');
  if (!s.emoji) problems.push('no emoji');
  if (!/^https:\/\//.test(s.url)) problems.push('not an https address');
  // A store's address has to be its own site, not a search for it.
  if (/google|search|youtube|amazon\.in\/s\?/i.test(s.url)) problems.push('a search address, not a store');
  ok(problems.length === 0, s.name || s.id, problems.join(', ') || s.url);
}

console.log('\nnothing is listed twice');
const names = DIGITAL_STORES.map((s) => s.name.toLowerCase());
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
ok(dupes.length === 0, 'no duplicate names', dupes.join(', '));
const ids = DIGITAL_STORES.map((s) => s.id);
ok(new Set(ids).size === ids.length, 'no duplicate ids');

console.log('\nthe filters cover every store');
for (const kind of DIGITAL_STORE_KINDS) {
  if (kind.id === 'all') continue;
  const inKind = digitalStoresOfKind(kind.id);
  ok(inKind.length > 0, `the "${kind.label}" filter has stores in it`, `${inKind.length}`);
}
ok(
  DIGITAL_STORE_KINDS.filter((k) => k.id !== 'all').length ===
    new Set(DIGITAL_STORES.map((s) => s.kind)).size,
  'the filters and the stores agree about the kinds',
);
ok(digitalStoresOfKind('all').length === DIGITAL_STORES.length, '"all" returns every store');

console.log('\nthe kinds the filters offer are the kinds the stores use');
const knownKinds = new Set(DIGITAL_STORE_KINDS.map((k) => k.id));
const unknown = DIGITAL_STORES.filter((s) => !knownKinds.has(s.kind)).map((s) => s.name);
ok(unknown.length === 0, 'every store has a kind the filter offers', unknown.join(', '));

console.log('\nevery address is one that was opened and seen to work');
// WHY THIS LIST IS HERE AND NOT A NETWORK CHECK: the addresses are checked
// by hand, in a real browser, because most of these sites refuse curl and a
// 403 from curl says nothing about whether the address is right. This list
// is the record of that check.
//
// A store was REMOVED rather than kept with a hopeful address:
//   dmartonline.com   the domain is parked and for sale
//   naturesbasket.com the domain now redirects to a parked page
//   reliancesmart.in  no domain of that name answers at all
//   flipkart.com/grocery  the page has been taken down
//
// A store whose domain is bought by a squatter is worse than no store at
// all: the person trusts the list and ends up somewhere else.
const VERIFIED = [
  'https://blinkit.com',
  'https://www.zepto.com',
  'https://www.swiggy.com/instamart',
  'https://www.instamart.com',
  'https://www.bigbasket.com',
  'https://www.amazon.in/fresh',
  'https://www.jiomart.com',
  'https://www.dmart.in',
  'https://www.mtrfoods.com',
  'https://www.spencers.in',
  'https://www.freshtohome.com',
];
for (const url of VERIFIED) {
  ok(
    DIGITAL_STORES.some((s) => s.url === url),
    `${url} is in the list`,
  );
}
ok(
  DIGITAL_STORES.length === VERIFIED.length,
  'the list and the checked addresses are the same length',
  `${DIGITAL_STORES.length} vs ${VERIFIED.length}`,
);

console.log('\nnothing that is known to be dead is in the list');
for (const dead of [
  'https://www.dmartonline.com',
  'https://www.naturesbasket.com',
  'https://www.reliancesmart.in',
  'https://www.flipkart.com/grocery',
]) {
  ok(
    !DIGITAL_STORES.some((s) => s.url === dead),
    `${dead} is not in the list`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

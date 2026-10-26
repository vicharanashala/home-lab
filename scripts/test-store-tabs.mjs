/**
 * Tests for the store viewer's tabs.
 *
 * The rules that matter: a store that is already open is brought forward
 * rather than opened twice, a tab can be opened twice on purpose, and the
 * tab to the LEFT of a closed one takes over — which is what a browser
 * does, and what a thumb expects.
 *
 * Run with:  node scripts/test-store-tabs.mjs
 */
import { openTab, closeTab, syncRouteToTab } from '../src/utils/storeTabs.ts';

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

const JIO = { id: 'jiomart', name: 'Jio Mart', emoji: '🧺' };
const AMAZON = { id: 'amazon-fresh', name: 'Amazon Fresh', emoji: '🛒' };
const BIG = { id: 'bigbasket', name: 'BigBasket', emoji: '🧺' };
const empty = { tabs: [], activeId: '', seq: 0 };

console.log('\nopening a store');
{
  const s = openTab(empty, JIO);
  ok(s.tabs.length === 1, 'one tab is open', s.tabs.map((t) => t.label).join(', '));
  ok(s.activeId === s.tabs[0].id, 'the new tab is the one showing');
  ok(s.tabs[0].label === 'Jio Mart', 'the tab carries the store’s name');
  ok(s.tabs[0].emoji === '🧺', 'the tab carries the store’s mark');
  ok(s.seq === 1, 'the counter moved on');
}

console.log('\nopening a store that is already open');
{
  let s = openTab(empty, JIO);
  s = openTab(s, AMAZON);
  s = openTab(s, JIO);
  ok(s.tabs.length === 2, 'it is brought forward, not opened twice', `${s.tabs.length} tabs`);
  ok(s.activeId === s.tabs[0].id, 'the existing tab is the one showing');
}

console.log('\nopening the same store twice on purpose');
{
  let s = openTab(empty, JIO);
  s = openTab(s, JIO, { alwaysNew: true });
  ok(s.tabs.length === 2, 'a second tab is opened', `${s.tabs.length} tabs`);
  ok(s.tabs[0].id !== s.tabs[1].id, 'the two tabs have different ids');
  ok(s.activeId === s.tabs[1].id, 'the new tab is the one showing');
}

console.log('\nthe route catching up with the tab strip');
{
  // The case that broke: the owner opens the same store twice, so the strip
  // holds two Amazon tabs, and the address can only name the STORE.
  let s = openTab(empty, AMAZON);
  s = openTab(s, AMAZON, { alwaysNew: true });
  s = openTab(s, JIO, { alwaysNew: true });
  const secondAmazon = s.tabs[1].id;

  // The owner taps the second Amazon tab.
  s = { ...s, activeId: secondAmazon };
  // The address follows the tab it just showed.
  const routeStore = s.tabs.find((t) => t.id === s.activeId).storeId;
  ok(routeStore === 'amazon-fresh', 'the address names the store of the tab picked');

  // The address reaches the component, which brings the strip in line.
  const after = syncRouteToTab(s, AMAZON);
  ok(
    after.activeId === secondAmazon,
    'the tab the owner tapped is still the one showing',
    after.tabs.find((t) => t.id === after.activeId)?.id,
  );
  ok(after.tabs.length === 3, 'and no tab was opened or thrown away', `${after.tabs.length} tabs`);
}

console.log('\nthe route naming a store the strip is not showing');
{
  // The owner followed a link to a store, so that store's tab has to open.
  let s = openTab(empty, JIO);
  const after = syncRouteToTab(s, AMAZON);
  ok(after.tabs.length === 2, 'the store the route named is opened', `${after.tabs.length} tabs`);
  ok(after.activeId === after.tabs[1].id, 'and it is the tab on screen');
}

console.log('\nthe route naming a store that is already open but behind another');
{
  let s = openTab(empty, AMAZON);
  s = openTab(s, JIO);
  const after = syncRouteToTab(s, AMAZON);
  ok(after.tabs.length === 2, 'no tab was opened twice', `${after.tabs.length} tabs`);
  ok(after.activeId === after.tabs[0].id, 'the open tab of that store comes forward');
}

console.log('\nclosing a tab');
{
  let s = openTab(empty, JIO);
  s = openTab(s, AMAZON);
  const amazonTab = s.tabs[1].id;
  s = closeTab(s, amazonTab);
  ok(s.tabs.length === 1, 'the tab is gone', `${s.tabs.length} tabs`);
  ok(s.activeId === s.tabs[0].id, 'the tab to its left takes over');
}

console.log('\nclosing a tab that is not showing');
{
  let s = openTab(empty, JIO);
  s = openTab(s, AMAZON);
  s = openTab(s, BIG);
  const jioTab = s.tabs[0].id;
  s = closeTab(s, jioTab);
  ok(s.tabs.length === 2, 'the tab is gone', `${s.tabs.length} tabs`);
  ok(s.activeId === s.tabs[1].id, 'the tab that was showing is still showing');
}

console.log('\nthe last tab cannot be closed');
{
  let s = openTab(empty, JIO);
  s = closeTab(s, s.tabs[0].id);
  ok(s.tabs.length === 1, 'the tab is still there', `${s.tabs.length} tabs`);
  ok(s.activeId === s.tabs[0].id, 'and it is still showing');
}

console.log('\nclosing a tab that is not open');
{
  let s = openTab(empty, JIO);
  s = closeTab(s, 'nothing-like-this');
  ok(s.tabs.length === 1, 'nothing changed', `${s.tabs.length} tabs`);
}

console.log('\nevery tab keeps its own store');
{
  let s = openTab(empty, JIO);
  s = openTab(s, AMAZON);
  s = openTab(s, BIG);
  ok(
    s.tabs.map((t) => t.storeId).join(',') === 'jiomart,amazon-fresh,bigbasket',
    'the tabs are in the order they were opened',
    s.tabs.map((t) => t.storeId).join(','),
  );
  ok(new Set(s.tabs.map((t) => t.id)).size === 3, 'every tab has its own id');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

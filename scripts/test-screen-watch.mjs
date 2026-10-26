/**
 * Tests for the screen-watch relay.
 *
 * The rules that matter: a frame is base64 WITHOUT a data: prefix, because
 * the image payload House Bot sends carries the media type beside the
 * base64 and a prefix on top of that is a third of the bytes for nothing.
 *
 * And the frames never leave the device: they go from one tab of this app
 * to another over a BroadcastChannel, never to a server and never into a
 * log. A frame of someone's screen is the most private thing this app could
 * hold.
 *
 * Run with:  node scripts/test-screen-watch.mjs
 */
import {
  SCREEN_WATCH_CHANNEL,
  WATCH_FRAME_WIDTH,
  WATCH_FRAME_INTERVAL_MS,
  WATCH_STALE_MS,
  frameFromDataUrl,
  reduceWatch,
  sharerReply,
  watchHasEnded,
} from '../src/utils/screenWatch.ts';

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

console.log('\na frame is base64 without the prefix');
{
  const frame = frameFromDataUrl('data:image/jpeg;base64,QUJDRA==', 900, 506);
  ok(frame !== null, 'the frame is made');
  ok(frame?.data === 'QUJDRA==', 'the prefix is gone', frame?.data);
  ok(
    !frame?.data.startsWith('data:'),
    'and it does not start with data:',
    frame?.data.slice(0, 12),
  );
  ok(frame?.mediaType === 'image/jpeg', 'the media type is carried beside it');
  ok(frame?.width === 900 && frame?.height === 506, 'the size is recorded');
  ok(typeof frame?.at === 'number' && frame.at > 0, 'and when it was taken');
}

console.log('\nsomething that is not a data URL is not a frame');
{
  ok(frameFromDataUrl('not-a-data-url', 900, 506) === null, 'no comma, no frame');
  ok(frameFromDataUrl('', 900, 506) === null, 'an empty string, no frame');
}

console.log('\nthe frame is small enough to send');
{
  ok(WATCH_FRAME_WIDTH <= 1024, 'a frame is at most 1024 pixels wide', String(WATCH_FRAME_WIDTH));
  ok(
    WATCH_FRAME_INTERVAL_MS >= 1000,
    'frames are not taken faster than once a second',
    String(WATCH_FRAME_INTERVAL_MS),
  );
}

console.log('\nthe frames stay on the device');
{
  ok(
    SCREEN_WATCH_CHANNEL.startsWith('homehub.'),
    'the relay is a channel of this app, not a service',
    SCREEN_WATCH_CHANNEL,
  );
  ok(
    !/https?:\/\//.test(SCREEN_WATCH_CHANNEL),
    'and it names no server to send anything to',
    SCREEN_WATCH_CHANNEL,
  );
}

console.log('\na sharer that has stopped says nothing');
{
  ok(
    sharerReply({ kind: 'hello' }, false, 'Amazon Fresh').length === 0,
    'a sharer whose share is over answers a hello with nothing',
  );
  ok(
    sharerReply({ kind: 'hello' }, true, 'Amazon Fresh').length === 1,
    'a running sharer answers a hello',
  );
  ok(
    sharerReply({ kind: 'hello' }, true, 'Amazon Fresh')[0]?.kind === 'status',
    'and the answer is the status',
  );
  ok(
    sharerReply({ kind: 'frame' }, true, 'Amazon Fresh').length === 0,
    'a frame is not answered at all',
  );
}

console.log('\na watch that has gone quiet ends');
{
  const start = 1000;
  const alive = { watching: true, label: 'Amazon Fresh', frame: null, lastSeenAt: start };
  ok(!watchHasEnded(alive, start), 'a watch that just heard something is alive');
  ok(
    !watchHasEnded(alive, start + WATCH_STALE_MS),
    'and it stays alive for the whole window',
  );
  ok(
    watchHasEnded(alive, start + WATCH_STALE_MS + 1),
    'and it ends when the window has passed',
  );
  ok(
    !watchHasEnded({ watching: false, label: null, frame: null, lastSeenAt: null }, start),
    'a watch that was never running does not end',
  );
}

console.log('\nthe watcher forgets a share that stopped');
{
  const now = 1000;
  const frame = frameFromDataUrl('data:image/jpeg;base64,QUJDRA==', 900, 506);
  const idle = { watching: false, label: null, frame: null, lastSeenAt: null };

  let state = reduceWatch(idle, { kind: 'status', watching: true, label: 'Amazon Fresh' }, now);
  ok(state.watching, 'the share is seen');
  ok(state.label === 'Amazon Fresh', 'and it is named');

  state = reduceWatch(state, { kind: 'frame', frame }, now);
  ok(state.frame === frame, 'the frame arrives');

  state = reduceWatch(state, { kind: 'status', watching: false, label: null }, now);
  ok(!state.watching, 'a share that stopped is not seen');
  ok(state.frame === null, 'and its frame is forgotten');
}

console.log('\na sharer that goes away without a word');
{
  const now = 1000;
  const frame = frameFromDataUrl('data:image/jpeg;base64,QUJDRA==', 900, 506);
  const idle = { watching: false, label: null, frame: null, lastSeenAt: null };

  let state = reduceWatch(idle, { kind: 'frame', frame }, now);
  ok(state.watching, 'the frame arrives');

  // The tab holding the share is closed. The browser throws the message
  // away with the tab, so nothing is said and nothing is heard.
  state = reduceWatch(state, null, now + WATCH_STALE_MS + 1);
  ok(!state.watching, 'the watch ends by itself');
  ok(state.frame === null, 'and the frozen picture is forgotten');
}

console.log('\nHouse Bot stops believing a page that has gone away');
{
  const now = 1000;
  const idle = { watching: false, label: null, frame: null, lastSeenAt: null };

  // The page that held the share is gone, and a stale status arrives saying
  // a share is running. It is believed for now.
  let state = reduceWatch(idle, { kind: 'status', watching: true, label: 'Amazon Fresh' }, now);
  ok(state.watching, 'the status is taken at its word');

  // But no frame ever follows it, so the promise cannot last.
  state = reduceWatch(state, null, now + WATCH_STALE_MS + 1);
  ok(!state.watching, 'and it stops being believed when the frames stop');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

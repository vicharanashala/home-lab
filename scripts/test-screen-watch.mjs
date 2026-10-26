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
  frameFromDataUrl,
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Watching a window, and telling House Bot what is on it.
 *
 * WHAT THIS IS FOR
 * The Digital stores page opens the real store — amazon.in, jiomart.com —
 * in a new tab. House Bot should be able to talk about what is on that
 * tab, the way it can already talk about a photo you attach to a message.
 *
 * The two live in DIFFERENT TABS, and that is the whole difficulty. The
 * browser's screen share is given to the page that asks for it, and that
 * page keeps the video. House Bot, in another tab, cannot reach into it.
 *
 * So the tab that holds the share captures a frame every couple of seconds
 * and hands it to the others over a BroadcastChannel — which is the one
 * channel the browser gives to tabs of the same site, and is exactly what
 * this is for.
 *
 * WHY A CHANNEL AND NOT A SERVER: the frames never leave the device, and
 * they never sit in a log. A frame of someone's screen is the most private
 * thing this app could hold, and it is held for as long as the share lasts
 * and not a moment longer.
 */

/** The channel the tabs of this app talk to each other on. */
export const SCREEN_WATCH_CHANNEL = 'homehub.screen-watch';

/** A frame of the shared screen. */
export interface WatchFrame {
  /** Base64 WITHOUT the data: prefix, so it can go straight into an image. */
  data: string;
  mediaType: 'image/jpeg';
  /** When it was taken. */
  at: number;
  /** How wide it is, in pixels. */
  width: number;
  height: number;
}

/**
 * What goes over the channel.
 *
 * WHY A FRAME NAMES ITS STORE: the name of a store and the picture of it
 * are two facts, and if they travel apart they can be told apart. A frame
 * says which store it is a picture of, so the watcher can never hold one
 * shop's page under another shop's name.
 */
export type WatchMessage =
  | { kind: 'frame'; frame: WatchFrame; label: string | null }
  | { kind: 'status'; watching: boolean; label: string | null }
  | { kind: 'hello' };

/**
 * How wide a captured frame is.
 *
 * WHY NOT THE FULL SIZE: a shared window is 1200-2000 pixels wide, and a
 * screenshot of that is far more than the model needs to say what is on the
 * screen. 900 pixels wide is plenty to read a product name and a price, and
 * it is a fraction of the bytes to send.
 */
export const WATCH_FRAME_WIDTH = 900;

/**
 * How often a frame is taken.
 *
 * Two seconds is often enough to notice that something changed and rarely
 * enough that the tab is not working for itself.
 */
export const WATCH_FRAME_INTERVAL_MS = 2000;

/**
 * The quality a captured frame is saved at.
 *
 * Lower than a photograph would use: this is a screen, which is mostly flat
 * colour, and it goes over a channel and into a request body.
 */
export const WATCH_FRAME_QUALITY = 0.55;

/**
 * How long a watch may go without a frame before it is treated as over.
 *
 * WHY THERE IS A DEADLINE AT ALL: the two tabs cannot tell each other that
 * one of them has gone away. The tab holding the share announces when the
 * share stops, but a tab that is CLOSED never announces anything — the
 * browser simply throws the message away with the tab. So the only evidence
 * that survives a closed tab is the frames themselves, and a watch that has
 * stopped receiving frames has stopped, whatever the last message said.
 *
 * WHY IT IS FOUR FRAMES AND NOT ONE: the sharer posts a frame every
 * WATCH_FRAME_INTERVAL_MS, and a browser in the background can be slow to
 * run its timers. One missed frame is a hiccup; four in a row is a share
 * that has ended.
 */
export const WATCH_STALE_MS = WATCH_FRAME_INTERVAL_MS * 4;

/**
 * Turn a canvas's data URL into the shape the app sends images in.
 *
 * WHY THE PREFIX IS STRIPPED: the image payload House Bot already sends
 * carries base64 on its own, with the media type beside it. A data: prefix
 * on top of that is a third of the bytes for nothing.
 */
export function frameFromDataUrl(
  dataUrl: string,
  width: number,
  height: number,
): WatchFrame | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  return {
    data: dataUrl.slice(comma + 1),
    mediaType: 'image/jpeg',
    at: Date.now(),
    width,
    height,
  };
}

/**
 * Take a frame from a video and return it as base64, without the prefix.
 */
export function grabFrame(
  video: HTMLVideoElement,
  width = WATCH_FRAME_WIDTH,
  quality = WATCH_FRAME_QUALITY,
): WatchFrame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, width / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);

  return frameFromDataUrl(canvas.toDataURL('image/jpeg', quality), w, h);
}

/**
 * The store's page is a different site, so the share has to be asked for
 * against the BROWSER's picker, and the person picks the window.
 *
 * WHY THE PICKER IS THE ONLY WAY IN: the browser decides what can be
 * shared. A page cannot ask for "the Amazon Fresh tab" by name — it asks
 * for a surface and the person chooses. That is the browser's privacy
 * promise, and this app does not get to pick around it.
 *
 * So the flow is: open the store in a tab, then ask. The person picks the
 * window the store opened in, and the app never learns which window that
 * was.
 */
export const SHARE_PICKER_HINT =
  'Chrome will ask whether you want to share your entire window. Say yes, and House Bot can see it.';

/**
 * The surface the app asks the browser for: a WINDOW.
 *
 * WHY THE WHOLE WINDOW AND NOT ONE TAB: the person sharing wants House Bot
 * to see what is on the screen, and the screen is more than the store's
 * page. It is the store's page AND the app's own tab, side by side — so
 * the question can be asked while the thing being asked about is still in
 * view, rather than the person having to keep switching back and forth
 * between a tab they are reading and a tab they are talking in.
 *
 * WHY IT IS NAMED EXPLICITLY: Chrome opens its picker on "Entire screen"
 * unless the page says otherwise. Asking for a window by name means
 * Chrome's own question — "would you like to share your entire window?" —
 * is about the thing that is actually wanted, and the person is told what
 * they are agreeing to before they agree to it.
 *
 * WHAT IT DOES NOT DO: it does not take the other screens away. This is a
 * PREFERENCE, not a limit — MDN is plain that the constraint "has no effect
 * on what the user can choose to share", so the browser may use it to put
 * the window section in front of the person and the screens stay in the
 * picker either way. The option that actually removes them is below.
 */
export const SHARE_SURFACE = 'window';

/**
 * Whether the browser offers WHOLE SCREAMS in the picker at all.
 *
 * WHY IT IS 'exclude': the whole screen holds the person's bank, their
 * messages and everything else they have open, and the model would be sent
 * all of it. What is wanted is the browser window — the store and the app
 * side by side — so the other screens are not offered at all.
 *
 * WHY IT IS NEEDED AND NOT ONLY `SHARE_SURFACE`: `SHARE_SURFACE` says which
 * kind of surface the app WANTS; this is the one that decides which kinds
 * the person is OFFERED. Chrome 119 and later honour it; a browser that has
 * never heard of it ignores the option, which is why it is safe to send
 * everywhere.
 *
 * WHY IT IS A SEPARATE NAME AND NOT A PART OF SHARE_SURFACE: they are two
 * different questions to two different parts of the browser, and they go in
 * two different places. `SHARE_SURFACE` goes in the video constraints, where
 * the browser looks for it. This goes at the TOP LEVEL of the options,
 * beside `video` and `audio`, like `SHARE_SELF_BROWSER_SURFACE` below.
 */
export const SHARE_MONITOR_SURFACES = 'exclude';

/**
 * Whether the browser may offer the page that is asking, in the picker's list.
 *
 * WHY IT IS 'include': the person is told the app is sharing a window, and
 * the picker can show them which one they are on. Hiding the page that is
 * asking makes the picker look like it is offering a choice the app never
 * made.
 *
 * WHY IT IS A SEPARATE NAME AND NOT A PART OF SHARE_SURFACE: they are two
 * different questions to two different parts of the browser. `SHARE_SURFACE`
 * says WHICH KIND of thing to capture — a window, not a screen — and goes in the
 * video constraints, where the browser looks for it. This says whether the
 * page doing the asking may appear in the list at all, and goes at the TOP
 * LEVEL of the options, because that is where the browser looks for it.
 */
export const SHARE_SELF_BROWSER_SURFACE = 'include';

/**
 * What the person reads while the browser's picker is open.
 *
 * WHY IT IS ONE SENTENCE AND NOT TWO: the hint used to be half a sentence,
 * with the screen supplying the other half — and the two halves disagreed.
 * The hint said "your entire window" and the screen finished the sentence
 * with "on that tab". The sentence that says what is about to happen to the
 * person is written once, here, where the surface it names is decided.
 */
export const SHARE_ASKING_TEXT =
  `Chrome is asking whether you want to share your window — look for the ` +
  `prompt at the top of the browser. Say yes, and HomeHub can answer ` +
  `questions about what is on that window.`;

/**
 * What the stores screen says while the share is running.
 *
 * WHY THE WINDOW AND NOT THE TAB: the share is of the WINDOW — the store's
 * page and HomeHub's own tab, side by side. Calling it a tab was a promise
 * the app did not keep: the person was told one tab was being shared, and
 * the browser then asked them for a window, which holds every tab in it.
 *
 * WHY THE STORE'S NAME IS STILL HERE: the name says WHICH store the person
 * is looking at. The window is not named — the store's tab is in it.
 *
 * @param store the store the person pressed, if there is one
 * @returns {string} the line to show
 */
export function shareRunningText(store: string | null): string {
  return store ? `Sharing the window with ${store}` : 'Sharing the window';
}

/**
 * Whether the browser will let this page open a pop-up right now.
 *
 * WHY THIS IS ASKED ABOUT AT ALL: a pop-up is only allowed while the page
 * still holds the person's gesture, and the gesture is short-lived — about
 * five seconds in Chrome, about one in Safari. The store's tab is opened
 * AFTER the browser has answered the capture request, and the person has to
 * pick a window in a picker before that answer comes, so the tab is opened
 * long after the gesture is gone:
 *
 *     the person pressed the store    the gesture starts
 *     the person picks a window       ... five seconds, or ten, or a minute
 *     the browser answers             the gesture is gone
 *     the store's tab opens           the browser stops it
 *
 * So the tab the person asked for is the tab the browser takes away, and
 * nothing on the screen says so.
 *
 * WHY THE ACTIVATION AND NOT A TRY: `window.open` cannot say whether it was
 * blocked. This app passes `noopener` — so the store's site cannot reach back
 * into this one — and the browser then returns null whether the tab opened or
 * not. The one thing that does say is the activation itself.
 *
 * WHY A MISSING API MEANS "ALLOWED": a browser without the API is an older
 * one, and the app's behaviour there is what it always was. Claiming a tab
 * was blocked when it opened would be worse than the silence this replaces.
 *
 * @returns true when a pop-up opened right now would be allowed
 */
export function popUpAllowedNow(): boolean {
  if (typeof navigator === 'undefined') return true;
  const activation: UserActivation | undefined = navigator.userActivation;
  if (!activation || typeof activation.isActive !== 'boolean') return true;
  return activation.isActive;
}

/**
 * Open the store's tab, and say whether the browser allowed it.
 *
 * WHY THE GESTURE IS ASKED ABOUT BEFORE THE TAB IS OPENED AND NOT AFTER:
 * `window.open` CONSUMES the transient activation, so a page that asked
 * afterwards would always be told "blocked" — including on the runs where the
 * tab opened perfectly well.
 *
 * WHY THE TAB IS OPENED ANYWAY: the browser may still allow it (some do not
 * block at all), and a tab that opens is what the person asked for. The
 * answer is about what to SAY, not about whether to try.
 *
 * WHY A POP-UP THE BROWSER THREW ON COUNTS AS REFUSED: a browser does not
 * always refuse a pop-up by blocking it — a sandboxed frame, a policy — and
 * then it throws. The tab did not open, and the app has no other way to open
 * it, so the answer is "the tab did not open".
 *
 * The exception used to escape this function and be swallowed by the share
 * hook, whose own comment says "the popup was blocked". Nothing was recorded,
 * so the stores screen fell back to the other sentence and told the
 * household what had not happened:
 *
 *     window.open   threw
 *     the tab       did not open
 *     the screen    "The store opened in a new tab."
 *
 * A live gesture does not make that true — the opener asked the browser, and
 * the browser said no.
 *
 * @param url the store's address
 * @returns true when the browser allowed the tab to open
 */
export function openStoreTab(url: string): boolean {
  const allowed = popUpAllowedNow();
  if (typeof window === 'undefined') {
    // There is no browser here, so there is no tab. Saying it opened would
    // be the same false claim in the other direction.
    return false;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    return false;
  }
  return allowed;
}

/**
 * What the stores screen says when the store's tab opened.
 *
 * WHY IT IS SAID ONLY WHEN THE TAB REALLY OPENED: the screen used to say
 * "The store still opened." after every failed share, whatever the browser
 * had actually done with the tab. The browser may well have taken the tab
 * away — see `popUpAllowedNow` — and a sentence the app cannot stand behind
 * is worse than no sentence at all.
 */
export const STORE_TAB_OPENED_TEXT = 'The store opened in a new tab.';

/**
 * What the stores screen says when the browser blocked the store's tab.
 *
 * WHY IT IS NAMED AND NOT JUST "blocked": the person has to know WHICH tab
 * did not open, because there are several stores on the screen and the share
 * they are watching is of a window they cannot see into.
 */
export const STORE_TAB_BLOCKED_TEXT = 'Your browser blocked the store tab.';

/**
 * What House Bot says when it can see the shared window.
 *
 * WHY IT IS HERE AND NOT IN THE PAGE: it is a promise about what the bot
 * can see, and the browser's own answer to that promise is `SHARE_SURFACE`
 * above. Written in two places, the two drifted apart — the chip said
 * "tab" while the app had been asking for a window for hours.
 *
 * @param store the store the share was started for, if there is one
 * @returns {string} the chip to show
 */
export function shareVisibleText(store: string | null): string {
  return store
    ? `I can see the window with ${store}`
    : 'I can see your shared window';
}

/**
 * What the stores screen says before anything has been shared.
 *
 * WHY IT IS A CONSTANT AND NOT MARKUP IN THE PAGE: this is the sentence
 * that says what is about to be shared, and it has to say the same thing the
 * browser is about to be asked for. It said "the tab" while the app asked
 * for a window — which understated what the person was agreeing to, on the
 * one screen where the agreement is made.
 */
export const SHARE_CONSENT_TEXT =
  'Pressing a store opens that store’s own site and asks whether HomeHub may share this window, so House Bot can talk about what is on it. Nothing is shared until you say yes, and the browser’s “Stop sharing” always works.';

/**
 * What the watching tab knows.
 *
 * WHY IT LIVES HERE AND NOT IN THE HOOK: the rules for when a watch has
 * ended are rules about the protocol, not about React, and a rule that
 * cannot be tested without a browser is a rule that will not be.
 */
export interface WatchState {
  /** Is a share running somewhere in this app. */
  watching: boolean;
  /** Which store it is. */
  label: string | null;
  /** The most recent frame. */
  frame: WatchFrame | null;
  /** When the watcher last heard from the sharer, in milliseconds. */
  lastSeenAt: number | null;
}

/**
 * Fold a message from the other tabs into what the watcher knows.
 *
 * WHY A STATUS MESSAGE THAT SAYS "STILL SHARING" DOES NOT RESET THE CLOCK:
 * the frames are the evidence that the share is alive. If a status message
 * could refresh the clock on its own, a sharer that had gone quiet could
 * keep a watch alive by talking — and the silence is exactly the thing the
 * clock is there to notice.
 */
export function applyWatchMessage(
  state: WatchState,
  msg: WatchMessage,
  now: number,
): WatchState {
  if (msg.kind === 'frame') {
    // WHICH STORE THE PICTURE BELONGS TO
    //
    // WHY THE PICTURE SAYS WHICH STORE IT IS: a frame is a picture of ONE
    // store, and the name shown beside it has to be that store's name. The
    // name and the picture arrive as two separate messages — a status names
    // the store, a frame carries the picture — and two tabs of this app can
    // share at the same time: the stores page opened twice, one tab sharing
    // Amazon Fresh and the other Big Bazaar. Their pictures cross on the
    // channel, and the name the watcher is holding can be one store's while
    // the picture in its hand is another's.
    //
    // WHY A PICTURE OF ANOTHER STORE IS DROPPED RATHER THAN SWAPPED IN: the
    // watcher is watching one store. Putting another shop's page under this
    // shop's name is the answer to the wrong question — "how much is this?"
    // answered with a different shop's price — and a picture with no name
    // beside it is better than a wrongly named one. The next picture from
    // the store being watched replaces it a second later.
    //
    // WHY A WATCHER THAT IS WATCHING NOTHING ADOPTS THE PICTURE'S STORE: it
    // has no store to be wrong about, and the picture is the only evidence
    // there is.
    //
    // WHY A PICTURE THAT SAYS NOTHING IS TAKEN AS IT WAS: a tab that was
    // open before this was updated posts a frame without a store on it, and
    // it is still a real frame. A picture that does not name a store cannot
    // be wrong about one.
    const frameLabel = typeof msg.label === 'string' ? msg.label : null;
    const sameStore =
      frameLabel === null || state.label === null || frameLabel === state.label;
    return {
      ...state,
      watching: true,
      label: state.label === null ? frameLabel : state.label,
      frame: sameStore ? msg.frame : state.frame,
      // WHY ONLY THE STORE BEING WATCHED MAY TICK THE CLOCK: the clock is
      // the answer to "is the share I am watching still running", and a
      // frame from ANOTHER store says nothing about that share — it says
      // some other share is running.
      //
      // So when the frame above is dropped, the clock must not move
      // either. It used to, and the effect was a share that had ended
      // staying alive for as long as another store kept sharing:
      //
      //   the Big Bazaar tab is closed abruptly — the browser gives no
      //   status message, so the watcher never hears that the share ended
      //   the Amazon Fresh tab is still sharing, and its picture arrives
      //     every two seconds
      //   the clock is refreshed by Amazon's pictures, so the watch of Big
      //     Bazaar never goes quiet
      //
      // The watcher then held a frozen picture of a share that had ended,
      // and said it could see Big Bazaar, for as long as the other store
      // carried on. A picture that was dropped is a picture that said
      // nothing about this watch, so it cannot be the evidence that keeps
      // this watch alive.
      lastSeenAt: sameStore ? now : state.lastSeenAt,
    };
  }
  if (msg.kind === 'status') {
    // WHY A FRAME IS DROPPED WHEN THE STORE CHANGES: a frame belongs to the
    // store it was taken from. When the share moves to another store, the
    // frame still held is a picture of the OLD one, and keeping it under the
    // NEW name would let House Bot answer a question about the new store
    // with a picture of the old one — the person's "how much is this?"
    // answered with another shop's price, which is worse than saying nothing.
    //
    // WHY THE GAP IS REAL AND NOT THEORETICAL: the first frame of the new
    // store arrives on the next tick of the frame timer, up to two seconds
    // later, and a freshly-opened video may not have a picture yet at all.
    //
    // WHY THE LABEL IS WHAT IS COMPARED: the sharer names the store in every
    // status, and the frame arrives after the status that names the store it
    // was taken from — so the label the watcher holds is the store the held
    // frame came from.
    const sameStore = msg.label === state.label;
    return {
      watching: msg.watching,
      label: msg.label,
      // A share that has stopped leaves no frame to send.
      frame: msg.watching && sameStore ? state.frame : null,
      lastSeenAt: msg.watching ? (state.watching ? state.lastSeenAt : now) : null,
    };
  }
  return state;
}

/**
 * Whether a watch has gone quiet for long enough to call it over.
 *
 * WHY A WATCH THAT NEVER HEARD ANYTHING IS ALREADY OVER: a watch that says
 * it can see a screen, but has no frame and has heard nothing from the
 * sharer, is the false promise this whole rule exists to end.
 */
export function watchHasEnded(state: WatchState, now: number): boolean {
  if (!state.watching) return false;
  if (state.lastSeenAt === null) return true;
  return now - state.lastSeenAt > WATCH_STALE_MS;
}

/**
 * Fold a message in and end a watch that has gone quiet, in one step.
 *
 * WHY ONE FUNCTION AND NOT TWO: the two things have to happen together. A
 * message that says the share is over clears the frame, and a silence that
 * lasts too long has to clear it too — and a watcher that applied the
 * message first and the deadline second would, for one tick, still be
 * holding a frame it had just been told to forget.
 */
export function reduceWatch(
  state: WatchState,
  msg: WatchMessage | null,
  now: number,
): WatchState {
  const next = msg ? applyWatchMessage(state, msg, now) : state;
  if (!watchHasEnded(next, now)) return next;
  // WHY THE NAME SURVIVES THE ENDING: the name of the store is not part of
  // the promise. The FRAME is the promise, and the frame is what goes. A
  // watch that has gone quiet has not necessarily been abandoned — a browser
  // that throttles a background tab's timers, or a frame that was merely
  // late, both look the same from here. So the name is kept, and a watch
  // that comes back to life knows which store it is watching again instead
  // of saying it can see "a shared window".
  //
  // WHY IT IS NOT LEAKED TO THE OTHER TABS: nothing here leaves the device,
  // and the name is only ever shown while a frame is on screen beside it.
  return { watching: false, label: next.label, frame: null, lastSeenAt: null };
}

/**
 * What a sharer answers when another tab asks whether anyone is sharing.
 *
 * WHY A SHARER THAT HAS STOPPED SAYS NOTHING: the share can end without the
 * tab going away — the person taps another page, and the page unmounts with
 * the share already over. If that sharer kept answering "yes, someone is
 * sharing", the new page would put a frozen picture on the screen and a
 * false promise in House Bot's message box, for a share that ended minutes
 * ago.
 *
 * WHY THE ANSWER IS A LIST RATHER THAN ONE MESSAGE: the status and the
 * frame are two separate messages, and the frame is only sent when there is
 * one to send.
 */
export function sharerReply(
  msg: WatchMessage,
  active: boolean,
  label: string | null,
): WatchMessage[] {
  if (msg.kind !== 'hello') return [];
  if (!active) return [];
  return [{ kind: 'status', watching: true, label }];
}

/**
 * What kind of picture the app is sending.
 *
 * WHY THE KIND TRAVELS WITH THE PICTURE: the app sends two different
 * pictures to House Bot — a photo of food the person took, and a frame of
 * the window they are shopping in. The bridge has to answer them
 * differently, and it cannot tell them apart on its own: both arrive in the
 * same field, as base64 with a media type. So the app says which it is.
 *
 * WHY IT MATTERS: the bridge's instruction for a picture is what tells the
 * model how to read it. A screenshot of a price list read as a photograph of
 * food is not a slightly worse answer — it is the answer to a different
 * question, and the person asked about the screen in front of them.
 *
 * WHY 'screen' AND NOT 'store': the frame is whatever window was shared, and
 * the name says where the picture came from, not what it shows. Which store
 * it is is named separately, and only for the person's benefit.
 */
export const IMAGE_KIND_PHOTO = 'photo';
export const IMAGE_KIND_SCREEN = 'screen';

/** A picture on its way to House Bot. */
export interface ImagePayload {
  /** The media type of the bytes. */
  mediaType: string;
  /** Base64 WITHOUT the data: prefix. */
  data: string;
  /** Which kind of picture this is. */
  kind: typeof IMAGE_KIND_PHOTO | typeof IMAGE_KIND_SCREEN;
}

/**
 * The picture to send with a message, and what it is.
 *
 * WHY THE PHOTO WINS: a photo the person deliberately attached is what they
 * meant to show. The screen is what happened to be in front of them.
 *
 * WHY THE RULE LIVES HERE AND NOT IN THE PAGE: it is a rule about the
 * protocol between the app and the bridge, and a rule that cannot be tested
 * without a browser is a rule that will not be.
 */
export function imagePayloadFor(
  sentImage: { mediaType: string; data: string } | null | undefined,
  watched: { mediaType: string; data: string } | null | undefined,
): ImagePayload | null {
  if (sentImage) {
    return {
      mediaType: sentImage.mediaType,
      data: sentImage.data,
      kind: IMAGE_KIND_PHOTO,
    };
  }
  if (watched) {
    return {
      mediaType: watched.mediaType,
      data: watched.data,
      kind: IMAGE_KIND_SCREEN,
    };
  }
  return null;
}

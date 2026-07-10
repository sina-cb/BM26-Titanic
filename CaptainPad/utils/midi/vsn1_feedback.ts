// VSN1 MIDI feedback — PURE. Builds the outbound MIDI frames that report live
// global-effect SLOT STATE (active / value / mode) plus the current effects
// PAGE back to the Intech VSN1, so the device's on-device Lua (`eventrx_cb`,
// authored by the device/tools track) can render the key LEDs, the encoder ring,
// and the LCD without any flash write. This is the CaptainPad end of the
// runtime-feedback contract: layout changes deploy Lua from the engine; live
// VALUE changes (intensity/mode/active/page) ride this MIDI feedback stream.
//
// The device is the SOURCE of the keys (notes 32..39), the jog (CC 40), and the
// side buttons (notes 41..44). Feedback echoes state on a set of DEDICATED
// feedback channels so it never collides with the inbound control addresses:
//
//   FB_ACTIVE_CH  (1)  Note On note=32+i  velocity = active ? 127 : 0
//                      → per PAGE slot i (0..7): the key LED on/off.
//   FB_VALUE_CH   (1)  CC cc=32+i         value = round(intensity * 127)
//                      → per PAGE slot i: the encoder ring / value bar target.
//   FB_MODE_CH    (2)  CC cc=32+i         value = mode index in modeValues (0..)
//                      → per PAGE slot i: which discrete mode is selected.
//   FB_PAGE_CH    (1)  CC cc=40           value = page (0..3)
//                      Note On note=41+p  velocity = (p === page) ? 127 : 0
//                      → the current page index + the four side-button LEDs.
//
// "Per PAGE slot i" = the 8 flat slots the active page views: slot id 8*page+i+1.
// A slot the engine hasn't threaded (no intensity/mode) reports 0 / index 0 so
// the device shows a defined rest state, never a fabricated value that would lie
// about live state. Everything is DIFFED by the caller (manager.projectAndSend)
// against the last feedback frame, so only changed state is re-sent.

const SLOTS_PER_PAGE = 8;

// ── VSN1 WELCOME / hello ─────────────────────────────────────────────────────
// A dedicated one-shot "hello" the CaptainPad sends the VSN1 the moment the
// effects panel first loads AND on every MIDI (re)connect, RIDING WITH the full
// feedback re-sync (the diff-reset full frame). The device-side Lua watches for
// it to show its logo/greeting screen (that render is another track's job — our
// contract ends at emitting the message). Pinned address (see the feedback
// protocol table): CC channel 2 (0-based), controller 41, value 1. It is a
// one-shot: emitted once per full re-sync, never diffed into the steady stream,
// so it can't collide with the side-button page LEDs (Note On ch1 note 41) — a
// different status byte + channel.
export const WELCOME_CH = 2;
export const WELCOME_CC = 41;
export const WELCOME_VALUE = 1;

/** The 3-byte VSN1 WELCOME/hello frame: `[0xB2, 41, 1]`. */
export function vsn1WelcomeMessage(): number[] {
  return [(STATUS_CC | (WELCOME_CH & 0x0f)) & 0xff, WELCOME_CC & 0x7f, WELCOME_VALUE & 0x7f];
}

// ── VSN1 SELECT CUE ──────────────────────────────────────────────────────────
// The two-step toggle contract needs an on-device signal for "this slot is
// SELECTED (press again to toggle)" that is DISTINCT from the active-LED (which
// means "toggled ON"). CaptainPad emits this cue the moment a toggle key is
// selected (the first press), so the operator can see the target before
// committing — matching the two-step model on the hardware, not just the LCD.
// Pinned to CC channel 2 (0-based) controller 42, value = the SELECTED key index
// 0..7 on the current page (or 127 = "no selection on this page" clear). This
// address collides with nothing inbound or outbound: WELCOME is ch2 cc41, the
// mode feedback is ch2 cc32..39, the page index is ch1 cc40 — cc42 on ch2 is
// free. It is NOT diffed into the steady feedback stream; it is a one-shot fired
// from the select path, so a re-select of the same key always re-asserts it.
export const SELECT_CUE_CH = 2;
export const SELECT_CUE_CC = 42;
/** Value the cue carries when NO slot on the current page is selected — a
 *  sentinel above the 0..7 key range so the device can clear its cue LED. */
export const SELECT_CUE_NONE = 127;

/** The 3-byte VSN1 SELECT-CUE frame for `keyIndex` (0..7 on the current page),
 *  or the `SELECT_CUE_NONE` clear when the selection is off-page / absent. */
export function vsn1SelectCueMessage(keyIndex: number): number[] {
  const v = keyIndex >= 0 && keyIndex <= 7 ? keyIndex : SELECT_CUE_NONE;
  return [(STATUS_CC | (SELECT_CUE_CH & 0x0f)) & 0xff, SELECT_CUE_CC & 0x7f, v & 0x7f];
}

// ── VSN1 VIEW MODE echo ──────────────────────────────────────────────────────
// The sb_0 small button toggles the device's VIEW MODE: single click = DRUM,
// double click = EFFECT (host-side click/double-click detection — the device
// does no timing across its VM restarts). The HOST owns the current mode and
// echoes it here so the device can render DRUM (name/value/mode only) vs EFFECT
// (the color-rectangle grid + selected effect) and — crucially — so the mode
// SURVIVES a page change: the device wipes its Lua VM on every page load, so the
// manager re-pushes this echo after the page-load feedback (like active/value/
// mode). Pinned to CC channel 2 (0-based) controller 43, value 0 = DRUM /
// 1 = EFFECT. Free on ch2: mode feedback is cc32..39, WELCOME cc41, SELECT CUE
// cc42 — cc43 collides with nothing.
export const VIEW_MODE_CH = 2;
export const VIEW_MODE_CC = 43;

/** The 3-byte VSN1 VIEW-MODE echo frame: `[0xB2, 43, 0|1]` (0 DRUM, 1 EFFECT). */
export function vsn1ViewModeMessage(ccValue: 0 | 1): number[] {
  return [(STATUS_CC | (VIEW_MODE_CH & 0x0f)) & 0xff, VIEW_MODE_CC & 0x7f, ccValue & 0x7f];
}

// Dedicated feedback channels (see the header table). Kept distinct from the
// inbound control channel (0) so a feedback frame is never mistaken for a
// control press by anything that echoes.
export const FB_ACTIVE_CH = 1;
export const FB_VALUE_CH = 1;
export const FB_MODE_CH = 2;
export const FB_PAGE_CH = 1;

const STATUS_NOTE_ON = 0x90;
const STATUS_CC = 0xb0;

/** The base note/CC for the 8 per-page key addresses (matches the inbound keys
 *  32..39 so the device can map feedback to the same physical keys). */
const KEY_BASE = 32;
/** The jog CC (page index feedback rides here — same address the jog turns on). */
const PAGE_CC = 40;
/** The four side-button notes (page-select LEDs). */
const SIDE_BASE = 41;

// ── VSN1 DEVICE → APP page follow (item 5, 2026-07-10) ───────────────────────
// The PHYSICAL side button is the firmware-native page switcher — it changes the
// device page (and restarts the Lua VM) with NO involvement from the four small
// panel buttons. On that change the device emits the page CC (controller 40) so
// CaptainPad can FOLLOW it: the app + engine move to the same page in lockstep
// (device → app; the app → device direction is the outbound page-index feedback
// above, CC ch1 40 = page). The device rides its outgoing MIDI on channel = page
// (a moving firmware detail), so this is matched by CONTROLLER number regardless
// of channel — mirroring the keys' `anyChannel`. The CC VALUE carries the new
// page 0..3 (page index, same payload the host-side feedback sends back).
/** The controller number the device's native page-change CC rides (== PAGE_CC).
 *  Exported so the manager's inbound intercept and its tests name one constant. */
export const DEVICE_PAGE_CC = PAGE_CC;

/** Decode an inbound device MIDI message into the NEW effects page (0..3) when it
 *  is the device's native page-change CC (controller `DEVICE_PAGE_CC`), else null.
 *  Pure: `status` is the raw status byte, `cc` the controller, `value` the data
 *  byte. Only a Control Change (0xB0..0xBF) on controller 40 with a value in
 *  0..3 is a page follow; anything else (a different CC, a note, an out-of-range
 *  value) returns null so the caller ignores it (never a fabricated page). */
export function decodeDevicePageCc(status: number, cc: number, value: number): number | null {
  if ((status & 0xf0) !== STATUS_CC) return null;
  if (cc !== DEVICE_PAGE_CC) return null;
  if (!Number.isInteger(value) || value < 0 || value > 3) return null;
  return value;
}

// ── VSN1 DEVICE → APP hello / "VM ready, re-push me" (item 2, 2026-07-10) ─────
// The device restarts its Lua VM on EVERY VM (re)start — power-on, page load, and
// every layout re-flash. The moment its receiver re-registers, the device emits a
// hello CC (controller DEVICE_HELLO_CC, value 1). It is the RACE-FREE trigger for
// re-pushing full device state: because the DEVICE asks only once its receiver is
// live, a state re-echo answering the hello can never be dropped by a restart
// still in flight (the failure mode of a timed re-echo). CaptainPad answers every
// hello with a full feedback re-sync + view-mode re-echo; the FIRST hello of a
// fresh host connection ALSO arms the welcome logo, every subsequent one does not.
// Shares the controller number with the host→device welcome-arm (helloCc): the two
// travel in OPPOSITE directions with no on-wire collision (a device never receives
// its own sends; the host only receives device→host).
/** The controller the device's readiness hello rides (== the helloCc, 41). */
export const DEVICE_HELLO_CC = 41;

/** True when an inbound device message is the device's readiness hello (a Control
 *  Change on controller `DEVICE_HELLO_CC` with value ≥ 1). Pure. A value of 0 (or
 *  a different CC / a note) is not a hello — the device only ever sends value 1. */
export function isDeviceHello(status: number, cc: number, value: number): boolean {
  return (status & 0xf0) === STATUS_CC && cc === DEVICE_HELLO_CC && value >= 1;
}

/** One live slot's feedback-relevant state (a subset of the snapshot slot). */
export interface Vsn1FeedbackSlot {
  slot: number;
  active: boolean;
  intensity?: number;
  mode?: string | number | boolean | null;
  modeValues?: (string | number | boolean)[];
}

/** Everything the feedback builder needs from live state. */
export interface Vsn1FeedbackState {
  /** The active effects page (0..3). */
  page: number;
  /** All live global-effect slots (1-based ids), from the snapshot. */
  slots: Vsn1FeedbackSlot[];
}

/** A single feedback target: its diff key ("status:number") and value byte, plus
 *  a lazy `build` that assembles the 3-byte frame only when the diff says it
 *  changed (mirrors the LED projector's LedTarget shape). */
export interface Vsn1FeedbackTarget {
  key: string;
  value: number;
  build(): number[];
}

/** Diff state: feedback key → last value byte sent (as a string), so only
 *  changed feedback re-sends (same shape + semantics as led_projector LedState). */
export type Vsn1FeedbackDiff = Record<string, string>;

export interface Vsn1FeedbackProjection {
  messages: number[][];
  next: Vsn1FeedbackDiff;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(127, Math.round(n)));
}

/** The index of `mode` within `modeValues` (0 when absent / not found) — the
 *  discrete value the device highlights. Never guesses: an unthreaded mode or a
 *  value not in the list reports index 0 (the defined rest state). */
export function modeIndex(slot: Vsn1FeedbackSlot): number {
  const { mode, modeValues } = slot;
  if (mode === undefined || mode === null || !Array.isArray(modeValues)) return 0;
  const i = modeValues.findIndex((v) => v === mode);
  return i < 0 ? 0 : i;
}

function noteTarget(channel: number, note: number, velocity: number): Vsn1FeedbackTarget {
  const status = (STATUS_NOTE_ON | (channel & 0x0f)) & 0xff;
  return { key: `${status}:${note}`, value: clampByte(velocity), build: () => [status, note & 0x7f, clampByte(velocity)] };
}

function ccTarget(channel: number, cc: number, value: number): Vsn1FeedbackTarget {
  const status = (STATUS_CC | (channel & 0x0f)) & 0xff;
  return { key: `${status}:${cc}`, value: clampByte(value), build: () => [status, cc & 0x7f, clampByte(value)] };
}

/** Yield every feedback target for the current page + slot state. Ordering:
 *  page index + side-button LEDs first (so the device knows which page the
 *  following 8 slots belong to), then the 8 per-page slots' active/value/mode. */
export function* vsn1FeedbackTargets(state: Vsn1FeedbackState): Generator<Vsn1FeedbackTarget> {
  const page = Math.max(0, Math.min(3, Math.trunc(state.page)));
  // Page index (on the jog CC) + the four side-button page LEDs.
  yield ccTarget(FB_PAGE_CH, PAGE_CC, page);
  for (let p = 0; p < 4; p += 1) {
    yield noteTarget(FB_PAGE_CH, SIDE_BASE + p, p === page ? 127 : 0);
  }
  // The 8 slots THIS page views: flat slot id 8*page + i + 1.
  const byId = new Map<number, Vsn1FeedbackSlot>();
  for (const s of state.slots) byId.set(s.slot, s);
  for (let i = 0; i < SLOTS_PER_PAGE; i += 1) {
    const slotId = page * SLOTS_PER_PAGE + i + 1;
    const rec = byId.get(slotId);
    const active = !!rec?.active;
    const intensity = typeof rec?.intensity === 'number' ? rec.intensity : 0;
    yield noteTarget(FB_ACTIVE_CH, KEY_BASE + i, active ? 127 : 0);
    yield ccTarget(FB_VALUE_CH, KEY_BASE + i, intensity * 127);
    yield ccTarget(FB_MODE_CH, KEY_BASE + i, rec ? modeIndex(rec) : 0);
  }
}

/** Project the VSN1 feedback: build every target, diff against `prev`, and
 *  construct the 3-byte frame ONLY for changed values. Returns the frames to
 *  send + the next diff state (a full frame = projection against `{}`). */
export function projectVsn1Feedback(
  state: Vsn1FeedbackState,
  prev: Vsn1FeedbackDiff,
): Vsn1FeedbackProjection {
  const next: Vsn1FeedbackDiff = {};
  const messages: number[][] = [];
  for (const t of vsn1FeedbackTargets(state)) {
    const cur = String(t.value);
    next[t.key] = cur;
    if (prev[t.key] !== cur) messages.push(t.build());
  }
  return { messages, next };
}

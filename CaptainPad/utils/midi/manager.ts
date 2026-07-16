// MidiManager — the unified, multi-controller core. It owns N controller
// runtimes, one per profile, and runs them CONCURRENTLY: the APC mini mk2 is
// driver #1; a MIDI Fighter Twister (protocol per Sina's `pymft`,
// https://github.com/sina-cb/pymft) is the planned driver #2 and arrives as
// another profile + (for its relative encoders) a resolver extension — no
// rewrite. Everything here is framework-free and dependency-injected
// (transport factory, api, snapshot getter, timers) so it is unit-testable
// with synthetic events and fake transports.
//
// Per controller it wires:
//   inbound:  transport 'midiMessage' → decode → resolveEvent →
//             (continuous? coalesce ~30 Hz : dispatch now) → utils/api.ts
//   outbound: engine snapshot → projectLeds (diff) → transport.send
//   hotplug:  transport 'endpointsChanged' → re-resolve (grey on unplug,
//             reconnect + LED repaint on replug)
//
// Codex P0 surfaces here as visible status, never silent no-ops:
//   - device absent           → 'disconnected' (grey; FoH still works touch-only)
//   - endpoint match ambiguous / out of range → 'error' (red, names found)
//   - invalid profile param keys → 'error' (red, names the key)

import { MidiTransport } from './transport';
import { ControllerProfile, validateProfileParams, ParamKeyError } from './profile';
import { decodeMidi, DecodedMidi } from './midi_message';
import { resolveEvent, ResolvedAction, profileClaims, UnknownContextError } from './resolver';
import { resolveEndpoints, EndpointResolutionError } from './endpoints';
import { ControlCoalescer, CoalescerTimers } from './coalescer';
import {
  createDispatcher, MidiDispatchApi, MidiDispatcher, MidiApiResult, GlobalEffectSlotBehavior,
} from './dispatch';
import { projectLeds, LedState, MidiProjectionState } from './led_projector';
import { projectVsn1Feedback, Vsn1FeedbackDiff, vsn1WelcomeMessage, vsn1SelectCueMessage, vsn1ViewModeMessage, isDeviceHello, FB_ACTIVE_CH } from './vsn1_feedback';
import { Vsn1ViewMode, viewModeCcValue } from './vsn1_view_mode';
import { clampUnit } from './unit_clamp';
import {
  LearnController, LearnResult, LearnRejectReason, MidiControlRef, bindingMatches,
  controlRefFromEvent, scaleMidiToRange, pickup, freshPickup, PickupState,
} from './learn';
import { decodeBankChange, isClassicRelativeCode } from './mft/messages';
import { ColorValues, Encoders, MidiChannels } from './mft/constants';
// Multi-bank effects UX SHELVED 2026-07-14 (operator) — a single feature flag,
// OFF. Gates the VSN1 sb_2 bank-cycle dispatch below. Pure/RN-free logic module,
// so this relative import is safe in the framework-free midi layer + vitest.
import { BANKS_UI_ENABLED } from '../../components/global_effect_macros_logic';
import { recenterWindowStart } from './window_slot';
import { buildConnectConfig } from './mft/config';
import { TickAccelerator, MAX_WINDOW_STEP } from './accel';

/** A stable LAYOUT signature for the 8 slots the given VSN1 page views. Keys on
 *  the LAYOUT identity — effect id + behavior + label — of each on-page slot, so
 *  a swap/clear (from any surface) changes it while a runtime value/mode/active
 *  twist does NOT. `sendVsn1Feedback` compares it frame-to-frame to force a full
 *  re-send on a layout edit (the device re-flashes + restarts its VM on a layout
 *  change; a diff would leave the rest of the frame dark after the restart). Uses
 *  a delimiter no field can contain so distinct layouts never alias. */
function vsn1PageLayoutSig(
  page: number,
  slots: { slot: number; effectId?: string; behavior?: string; label?: string }[],
): string {
  const byId = new Map<number, { effectId?: string; behavior?: string; label?: string }>();
  for (const s of slots) byId.set(s.slot, s);
  const parts: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const rec = byId.get(page * 8 + i + 1);
    // effectId '' or undefined = empty slot; the tuple still positionally encodes
    // "slot i is empty" so a clear flips the signature.
    parts.push(`${rec?.effectId ?? ''}␟${rec?.behavior ?? ''}␟${rec?.label ?? ''}`);
  }
  return parts.join('␞');
}

/** MFT identity colour for the focused channel's knob rings: deck = blue,
 *  overlay layers 1/2/3 = green/yellow/pink (docs/34 knob-layout table). The
 *  knobs' colour TELLS the operator which channel is focused. null → no colour. */
function focusedIdentityColor(focused: FocusedChannel | null): number | null {
  if (!focused) return null;
  if (focused.role === 'deck') return ColorValues.BLUE;
  switch (focused.layer) {
    case 0: return ColorValues.GREEN;
    case 1: return ColorValues.YELLOW;
    case 2: return ColorValues.PINK;
    default: return ColorValues.GREEN;
  }
}

/** Fold two relative-delta payloads within a coalescer window by SUMMING their
 *  deltas — every detent tick counts (accumulate, never last-write-wins). Both
 *  payloads target the same control id, so index/key match by construction. */
export function combineDelta(existing: ResolvedAction, incoming: ResolvedAction): ResolvedAction {
  if (existing.kind === 'focusedParamDelta' && incoming.kind === 'focusedParamDelta') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  if (existing.kind === 'paramCenterDelta' && incoming.kind === 'paramCenterDelta') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  if (existing.kind === 'hueDelta' && incoming.kind === 'hueDelta') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  // Both payloads target the SAME control id, so their kinds match by
  // construction — a mismatch is a wiring bug. Fail loud (codex P0: no silent
  // fallback), mirroring the sibling exhaustiveness guard in dispatch.ts.
  throw new Error(
    `combineDelta: mismatched kinds for one control id ('${existing.kind}' vs '${incoming.kind}')`,
  );
}

/** The MFT connect-time sysex config frames. `buildConnectConfig()` takes zero
 *  inputs and is fully deterministic (all 64 encoders forced into relative
 *  mode), so build it ONCE at module load instead of on every connect() —
 *  a genuine plug fires connect() multiple times and this is multi-KB. The
 *  BYTES + ordering are unchanged; only WHEN they're computed moved. */
const MFT_CONNECT_CONFIG_FRAMES: readonly number[][] = buildConnectConfig();

export type ControllerStatusKind = 'disconnected' | 'connected' | 'error';

export interface ControllerStatus {
  deviceId: string;
  label: string;
  kind: ControllerStatusKind;
  error?: string;
  sourceName?: string;
  destinationName?: string;
  /** Aggregate param-key validation errors (other controls keep working). */
  paramErrors?: ParamKeyError[];
  /** Last decoded inbound event — a poor-man's MIDI monitor for the Config tab. */
  lastEvent?: string;
  /** A NON-STICKY visible warning (dispatch/LED sends failing in a run). Unlike
   *  `error` (which is sticky and freezes LED projection while `kind==='error'`)
   *  this leaves `kind` at `connected` — the controller keeps running — but
   *  surfaces "N of your writes just failed" so a dead engine / dead LED strip
   *  isn't silent. Auto-clears on the next successful send. */
  warning?: string;
}

/** Everything the dispatcher + LED projector need from live engine state. */
export interface MidiEngineSnapshot {
  blackout: boolean;
  activePattern: string | null;
  patterns: string[];
  globalEffects: Record<string, boolean>;
  /** Mixer "layers" = channels in order (0-based). Empty layers don't exist. */
  layers: {
    id: string;
    fader: number;
    /** The layer's playlist (entries + active), for the pad window browser. */
    playlist?: { entries: { id: string }[]; activeEntryId: string | null };
  }[];
  /** The deck channel, surfaced as "layer 0" on the Deck tab (single channel,
   *  its own API). null when there's no deck channel. */
  deckLayer: { id: string; fader: number; playlist?: { entries: { id: string }[]; activeEntryId: string | null } } | null;
  /** Active CaptainPad tab — selects whether layers target the deck channel
   *  (Deck) or the overlay channels (Mixer). The layout is unified; only the
   *  channel TARGETS differ per tab. */
  activeContext: string;
  /** Global-effect slots (1-based slot number + active state + press behavior).
   *  `behavior` mirrors the engine's per-slot field ('toggle' | 'trigger' |
   *  'hold') and makes the pad dispatch BEHAVIOR-AWARE: a 'trigger' slot must
   *  fire 'trigger', not 'toggle'. Optional for staleness safety — a snapshot
   *  that predates the field leaves it undefined and the dispatcher fails safe
   *  to 'toggle'. */
  globalEffectSlots: {
    slot: number;
    active: boolean;
    behavior?: GlobalEffectSlotBehavior;
    /** Effects v2: the slot's LAYOUT identity — the bound effect id + its display
     *  label. Threaded so the VSN1 feedback path can detect a layout change (a
     *  swap/clear from any surface) and force a full device re-send. Optional for
     *  staleness safety — a pre-field engine leaves them undefined (the layout
     *  signature then falls back to behavior/mode structure, still catching most
     *  swaps). `effectId` empty/undefined = the slot is empty. */
    effectId?: string;
    label?: string;
    /** Driver #3 (VSN1): the slot's live `intensity` (0..1) + its `intensityDefault`
     *  (the jog-press reset target). Threaded so the VSN1 jog's soft-takeover
     *  pickup guard seeds the SELECTED slot's current value on a selection change.
     *  Optional for staleness safety — a pre-field engine leaves them undefined and
     *  the jog stays inert with a note (never anchors on a fabricated 0). */
    intensity?: number;
    intensityDefault?: number;
    /** Effects v2: the slot's discrete `primaryMode` — current value, display
     *  label, and the ordered value list. Threaded so the VSN1 encoder-press
     *  mode cycle + the MIDI feedback path can render it. Optional for staleness
     *  safety (a pre-field engine leaves them undefined). */
    mode?: string | number | boolean | null;
    modeLabel?: string;
    modeValues?: (string | number | boolean)[];
  }[];
  /** Effects v2: the active effects PAGE (0..3), the engine's single source of
   *  truth. Every surface (CaptainPad page switcher, VSN1 side buttons) follows
   *  it. Threaded so the MIDI feedback path can report the current page index to
   *  the device Lua. Optional/undefined = page 0 until the engine threads it. */
  effectsPage?: number;
  /** The ACTIVE named effect bank id, the engine's single source of truth
   *  (GET /global-effects/banks, WS-broadcast `effectBanks`). The VSN1 sb_2 button
   *  reads it here only to (a) refuse when unseeded and (b) record the pre-cycle id
   *  for echo convergence — the engine computes the next bank (no optimistic
   *  switch). Optional/undefined/null = not seeded yet. */
  activeBankId?: string | null;
  /** Curated colour palette pairs (hues 0..1), for the colour-pair pads. */
  colorPalettes: { c1: number; c2: number }[];
  /** The FOCUSED channel — whose active pattern's MIDI-learned bindings the
   *  param faders (4-8) drive. On the Deck tab it is the single deck channel
   *  (auto-focused); on the Mixer tab the operator selects it with a track
   *  button. null when nothing is focused (no channel / no active entry). */
  focused: FocusedChannel | null;
  /** Curated CPC global param VALUES (0..1) keyed by param key, for the MFT
   *  `paramCenterRelative` knobs (and their ring feedback). A relative knob
   *  applies its delta to the value here. Absent key → knob is inert. */
  globalParamValues?: Record<string, number>;
  /** True when the engine's BPM→Speed sync owns the `speed` param (CPC
   *  `bpmSpeedSync` on). Undefined = off. Kept as the raw fact the hook derives
   *  `syncOwnedKeys` from; the gate itself reads `syncOwnedKeys`, not this. */
  bpmSpeedSyncOn?: boolean;
  /** Global-param keys the engine is CURRENTLY driving itself (e.g. `speed`
   *  while BPM→Speed sync is on). A manual write to one of these — via ANY
   *  surface (an MFT relative knob OR an absolute APC fader) — is INERT and gets
   *  a status note, because the engine would clobber it on its next tick. The
   *  ONE shared home of this rule at the flush/dispatch layer, so the MFT delta
   *  path and the APC absolute path can't drift (contract I4). D2 populates it
   *  from `bpmSpeedSyncOn`; defaults to an empty set. */
  syncOwnedKeys: ReadonlySet<string>;
  /** COMBINED autopilot state for the APC clip_stop button LED: true only when
   *  BOTH the pattern autopilot AND the deck colour autopilot are active. The
   *  clip_stop toggle drives the two together, so this mirrors the state a press
   *  would turn off; the hook threads it from the engine's `autopilot` /
   *  `colorAutopilot` WS broadcasts. Optional/undefined = off (a pre-field
   *  snapshot leaves the LED dark rather than lit from a half-truth). */
  combinedAutopilotActive?: boolean;
  /** PERFORMANCE MODE (live-show structural lock) active? Drives the APC solo
   *  button's LED (lit while a show is live). The hook threads it from the
   *  engine's `performanceMode` WS broadcast. Optional/undefined = inactive
   *  (a pre-field snapshot leaves the LED dark). */
  performanceModeActive?: boolean;
}

/** Empty default for the `syncOwnedKeys` snapshot fact — used wherever the
 *  manager reads a snapshot that predates the field (keeps tsc green and the
 *  gate inert until the hook populates it). */
const EMPTY_SYNC_OWNED_KEYS: ReadonlySet<string> = new Set<string>();

/** The focused channel's live exports + its active entry's MIDI bindings — the
 *  two things the runtime needs to apply a learned fader to a STATIC param. */
export interface FocusedChannel {
  role: 'deck' | 'mixer';
  /** Layer index (0-based) the focus came from — for the focus LED. */
  layer: number;
  id: string;
  /** Active entry id (part of the pickup re-lock identity — a fader must
   *  re-pick-up after the focused entry changes even if the mapping id is
   *  reused across entries). null when the channel has no active entry. */
  entryId: string | null;
  /** Stable identity of this focus for pickup re-locking, built ONCE in the
   *  hook: `role:id:entryId:mappingIds`. The runtime compares it as a single
   *  string (no per-event allocation). */
  key: string;
  /** Live local exports of the active pattern (id ↔ name ↔ current value). The
   *  MFT bank-1 knobs drive these BY ORDER: knob i → exports[i].
   *  - `defaultValue` (when the entry carries one) is the encoder-push reset target.
   *  - `base` is the MODULATION ANCHOR: for an audio-modulated param `v0` is the
   *    moving modulated value, so a knob delta must apply to `base` (the operator's
   *    set value) instead — the engine keeps layering the modulator on top. When a
   *    param is not modulated `base` equals `v0` (or is omitted → the runtime uses `v0`).
   *  - `modulated` = an active modulation drives this param (for the ring pulse). */
  exports: { id: number; name: string; v0: number; defaultValue?: number; base?: number; modulated?: boolean }[];
  /** Active entry's stored bindings (the engine's per-entry midiMappings). */
  midiMappings: FocusedBinding[];
  /** THIS channel's per-channel hue rotation in degrees [0,360) (engine F-hue,
   *  serialized on every mixer/deck channel — the hook threads it through).
   *  The hue knob accumulates onto this in BOTH contexts (hue is per-channel
   *  only — the global shifter was removed 2026-07) and its ring/colour
   *  track it. Optional only for staleness safety: undefined means the value
   *  hasn't been threaded (a pre-field snapshot) → the hue knob is
   *  INERT with a visible note, never anchored on a fabricated 0. */
  hue?: number;
}

export interface FocusedBinding {
  id: string;
  enabled: boolean;
  control: MidiControlRef;
  target: { parameter: string };
  range: [number, number];
}

export interface MidiManagerOptions {
  profiles: ControllerProfile[];
  transportFactory: () => MidiTransport;
  api: MidiDispatchApi;
  getSnapshot: () => MidiEngineSnapshot;
  /** Live CPC schema keys getter; paramCenter keys are validated against it.
   *  Returns an empty set until the engine schema has loaded — validation is
   *  skipped while empty (avoids a false "unknown key" flash on cold boot) and
   *  re-runs via revalidate() once the schema arrives. */
  getSchemaKeys?: () => ReadonlySet<string>;
  coalesceMs?: number;
  coalescerTimers?: CoalescerTimers;
  /** Debounce window (ms) for hotplug `endpointsChanged` bursts. Web MIDI fires
   *  `statechange` once per PORT (input AND output → ≥2 events per physical
   *  plug), all fanned to every transport; without this each event would run a
   *  full reconnect pass. Default 50 ms collapses one physical plug to one pass. */
  reconnectDebounceMs?: number;
  /** Injectable timers for the reconnect debounce (deterministic tests). Defaults
   *  to real setTimeout/clearTimeout. Separate from `coalescerTimers` so a test
   *  can drive the two independently. */
  reconnectTimers?: CoalescerTimers;
  /** Pads-per-bank for patternBank order binding (default 8 = one APC row). */
  patternBankPageSize?: number;
  /** Initial active context (CaptainPad tab). Default 'deck'. */
  defaultContext?: string;
  /** Fired on every inbound MIDI message (used to disable autopilot/transitions
   *  on activity and re-enable after idle). */
  onActivity?: () => void;
  /** Fired when a layer's playlist browse window moves (for the mixer-UI
   *  rectangular border). channelId is the layer's mixer channel id. */
  onWindowChange?: (channelId: string, start: number, size: number) => void;
  /** Fired when a track button requests a focus-channel change (Mixer tab).
   *  The hook updates focus state + rebuilds the snapshot's `focused`. */
  onFocusChange?: (layer: number) => void;
  onStatusChange?: (statuses: ControllerStatus[]) => void;
  /** Monotonic clock (ms) for the VSN1 sb_2 anti-spurious-flip guards (stale
   *  event / debounce / in-flight / self-echo). Web MIDI event timestamps share
   *  performance.now()'s clock, so the default reads that; injectable so tests
   *  drive the guards deterministically. */
  now?: () => number;
}

/** Default monotonic clock for the sb_2 guards — performance.now() when present
 *  (the SAME DOMHighResTimeStamp clock Web MIDI event timestamps ride), else
 *  Date.now() (node/test fallback). */
function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ── VSN1 sb_2 (controller-profile flip) anti-spurious-flip guards ────────────
// The ONLY writer of the controller profile in CaptainPad is sb_2. A live bug
// flips edit↔play with no operator action; these constants bound the four guard
// windows that reject the spurious sources (stale queued Web MIDI replays, a
// too-fast repeat, a still-in-flight PATCH, and a MIDI loopback of our own
// page-2 side-LED feedback frame). See handleVsn1SmallButton.
/** Base note of the four small panel buttons sb_0..sb_3 (notes 41..44). */
const VSN1_SB_NOTE_BASE = 41;
/** Drop an sb_2 event whose timestamp is older than this vs the current clock —
 *  a stale queued Web MIDI event (Chrome buffers input for a backgrounded tab
 *  and replays it on refocus). A missing/zero timestamp is treated as FRESH. */
const SB2_STALE_MS = 2000;
/** Minimum time between two ACCEPTED sb_2 presses — swallows a mechanical
 *  double-tap / contact bounce after the in-flight PATCH has already settled. */
const SB2_DEBOUNCE_MS = 400;
/** Safety cap on the in-flight guard: if the WS `effectBanks` echo never
 *  lands (engine wedged), the in-flight lock self-clears after this so sb_2 is
 *  never permanently dead. Normal clears come from the echo or a failed POST. */
const SB2_INFLIGHT_TIMEOUT_MS = 3000;
/** Self-echo window: an inbound sb_2 note (43) within this long of our OWN
 *  outbound page-2 side-LED feedback frame (also Note On note 43) is a MIDI
 *  loopback of our feedback, not a press — drop it. Local MIDI loops back in
 *  ~single-digit ms, so this is generous without shadowing a real press. */
const SB2_SELF_ECHO_MS = 50;

/** Playlist browse-window size (pads), per Sina's spec. */
export const WINDOW_SIZE = 6;

const DEFAULT_COALESCE_MS = 33; // ~30 Hz

/** Default hotplug-reconnect debounce window. One physical plug emits ≥2
 *  `statechange` events (input + output port); 50 ms is long enough to collapse
 *  that burst yet short enough that a replug feels instant. */
const DEFAULT_RECONNECT_DEBOUNCE_MS = 50;

/** Consecutive-failure threshold before a dispatch / LED-send run escalates
 *  from a per-event `lastEvent` note to a NON-STICKY visible `warning` (P2-5,
 *  LED-send). One transient 404 shouldn't nag; a dead engine / dead strip
 *  should. Non-sticky: the next success clears it. */
const FAILURE_WARN_THRESHOLD = 3;

// Page-follow retirement (2026-07, party wave) — COMPLETED. CaptainPad used to
// FOLLOW the VSN1's firmware-native side-button page changes: it intercepted the
// device page CC (controller 40) and PATCHed the engine's `effectsPage` so
// app + engine converged. That device→app follow path is now DELETED: deploys
// are page-0-only, the device no longer pages natively, and the CaptainPad
// effects strip renders page 0 ONLY (`SHOW_EFFECT_PAGES=false` in
// global_effect_macros_logic.ts). The engine keeps `effectsPage` as a LOGICAL
// page, and CaptainPad KEEPS its effectsPage subscription + feedback plumbing —
// only the device→app PATCH path is gone. The DEVICE HELLO handler (a VM-restart
// re-sync ping) is independent and stays live. The pure `decodeDevicePageCc`
// decoder that used to filter the inbound page CC has been deleted along with
// this path — there is no inbound page CC to consume any more.

/** Real-timer implementation for the reconnect debounce (used when the caller
 *  injects none). */
const REAL_RECONNECT_TIMERS: CoalescerTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

/** Re-seed threshold for the optimistic relative-delta anchor (#3). A snapshot
 *  that moves more than this BETWEEN coalescer windows is treated as an external
 *  change (reset / other surface / modulator step) and adopted; a smaller move
 *  is the throttled engine echo merely catching up to our own writes and is
 *  ignored so a fast sweep keeps accumulating locally. The real hazard isn't one
 *  detent (a slow tick is 0.0025 effective at precision gain) but the echo
 *  catching up on a WHOLE coalescer window's worth of accumulated gained ticks
 *  at once; 0.15 sits above the normal per-window echo creep, and the span
 *  classification below absorbs the flick case (where a window can legitimately
 *  advance more than this). */
const OPTIMISTIC_RESEED_EPSILON = 0.15;

/** Margin around the [prevSnap, optimistic] span when classifying a LARGE
 *  snapshot move as our own echo vs an external jump. Host-side acceleration
 *  (accel.ts) on top of the firmware's fast ±17 counts lets one coalescer
 *  window write far more than the epsilon, so the echo of a fast sweep also
 *  moves more than the epsilon — but it always lands WITHIN the span we
 *  ourselves wrote. A small margin absorbs rounding / interleaved-window
 *  noise. */
const OPTIMISTIC_ECHO_SPAN_MARGIN = 0.02;

/** Re-seed threshold for the HUE knob's optimistic anchor, in degrees —
 *  the unit-space epsilon scaled onto the 360° wheel, compared with circular
 *  distance (359° → 1° is a 2° move, not 358°). */
const HUE_RESEED_EPSILON_DEG = OPTIMISTIC_RESEED_EPSILON * 360;

/** "Echo landed" tolerance for the RING's optimistic display overlay. The ring
 *  prefers the runtime's just-written optimistic value while the engine echo
 *  lags (~100-200 ms), but once the snapshot has CAUGHT UP to (within this of)
 *  the optimistic value, the entry has served its purpose and is forgotten —
 *  so a later EXTERNAL move (another surface / touch) is followed immediately
 *  instead of being masked by a frozen stale optimistic value. Kept well below
 *  one precision-gained detent (0.005 × ACCEL_GAIN_MIN = 0.0025) so a live
 *  turn can never be mistaken for a landed echo. */
const OPTIMISTIC_SETTLE_EPSILON = 0.001;

/** Circular twin of the settle tolerance for hue angles, in degrees. */
const HUE_SETTLE_EPSILON_DEG = OPTIMISTIC_SETTLE_EPSILON * 360;

/** Classify a snapshot move against an optimistic entry: `true` = a genuine
 *  EXTERNAL jump (another surface / reset / modulator step) that must be
 *  adopted; `false` = our own throttled echo merely creeping/catching up.
 *  A move within the epsilon is always echo creep; a LARGER move is still our
 *  own echo when it lands inside the [prevSnap, optimistic] span we ourselves
 *  wrote (host-side acceleration lets one window write more than the epsilon),
 *  with a small margin for rounding. ONE shared home of the rule, so the flush
 *  anchor (optimisticAnchor) and the ring display overlay
 *  (optimisticDisplayValue) can never drift. */
function isExternalSnapshotJump(prevSnap: number, optimistic: number, snapValue: number): boolean {
  if (Math.abs(snapValue - prevSnap) <= OPTIMISTIC_RESEED_EPSILON) return false;
  const lo = Math.min(prevSnap, optimistic) - OPTIMISTIC_ECHO_SPAN_MARGIN;
  const hi = Math.max(prevSnap, optimistic) + OPTIMISTIC_ECHO_SPAN_MARGIN;
  return snapValue < lo || snapValue > hi;
}

/** Normalise degrees into [0, 360) — same wrap the engine applies. */
function wrapDegrees(d: number): number {
  return ((d % 360) + 360) % 360;
}


/** Circular distance between two hue angles, in degrees (0..180). */
function circularDegreesDistance(a: number, b: number): number {
  const d = Math.abs(wrapDegrees(a) - wrapDegrees(b));
  return Math.min(d, 360 - d);
}

/** CHANNEL identity of a focus, for the hue knob's mid-window
 *  focus guard + per-channel optimistic anchors. Deliberately `role:id` — NOT
 *  `focused.key` — because a channel's hue is channel-level state: an active
 *  ENTRY change mid-turn must not drop the window (the hue target didn't
 *  move), only a channel change must. null = nothing focused. */
function channelIdentity(focused: FocusedChannel | null): string | null {
  return focused ? `${focused.role}:${focused.id}` : null;
}

interface ResolvedLayer {
  id: string;
  role: 'deck' | 'mixer';
  playlist?: { entries: { id: string }[]; activeEntryId: string | null };
}

/** Resolve the Nth "layer" for the active tab — the single unified layout
 *  targets the deck channel on the Deck tab (layer 0 only) and the overlay
 *  channels on the Mixer tab. null when that layer doesn't exist. */
function layerInfo(snap: MidiEngineSnapshot, layer: number): ResolvedLayer | null {
  if (snap.activeContext === 'deck') {
    if (layer === 0 && snap.deckLayer) {
      return { id: snap.deckLayer.id, role: 'deck', playlist: snap.deckLayer.playlist };
    }
    return null;
  }
  const l = snap.layers[layer];
  return l ? { id: l.id, role: 'mixer', playlist: l.playlist } : null;
}

/** Monitor line for a coalesced continuous payload at flush cadence (12b) —
 *  the raw decoded event isn't in scope at flush, so describe the resolved
 *  action instead. */
function describeFlush(payload: ResolvedAction): string {
  switch (payload.kind) {
    case 'paramCenter': return `${payload.key} = ${payload.value.toFixed(2)}`;
    case 'master': return `master = ${payload.value.toFixed(2)}`;
    case 'sectionBrightness': return `section ${payload.sectionId} = ${payload.value.toFixed(2)}`;
    case 'mixerLayerFader': return `layer ${payload.layer} fader = ${payload.value.toFixed(2)}`;
    case 'localParam': return `param #${payload.exportId} = ${payload.value.toFixed(2)}`;
    // VSN1 keyed value (self-addressed slot intensity, coalesced per slot).
    case 'effectIntensitySlot': return `VSN1 slot ${payload.slotId} intensity = ${payload.value.toFixed(2)}`;
    default: return payload.kind;
  }
}

function describeEvent(ev: DecodedMidi, controlId: string | null): string {
  const tail = controlId ? ` → ${controlId}` : ' (unmapped)';
  switch (ev.type) {
    case 'cc': return `CC ch${ev.channel} #${ev.cc} = ${ev.value}${tail}`;
    case 'noteOn': return `Note On ch${ev.channel} #${ev.note} v${ev.velocity}${tail}`;
    case 'noteOff': return `Note Off ch${ev.channel} #${ev.note}${tail}`;
    default: return `raw [${ev.data.join(',')}]`;
  }
}

class ControllerRuntime {
  readonly profile: ControllerProfile;
  private readonly transport: MidiTransport;
  private readonly dispatcher: MidiDispatcher;
  private readonly coalescer: ControlCoalescer<ResolvedAction>;
  private readonly opts: MidiManagerOptions;
  private readonly notify: () => void;

  private ledState: LedState = {};
  /** Effects v2: last VSN1 slot-state/page feedback frame sent, so only changed
   *  feedback re-sends (diffed like ledState). Only used for the VSN1 profile;
   *  inert for every other driver. Reset (→ full re-send) on a (re)connect. */
  private vsn1FeedbackState: Vsn1FeedbackDiff = {};
  /** The effects page the LAST VSN1 feedback frame was projected for. The
   *  firmware RESTARTS its Lua VM on every page load (2026-07-11 redeploy),
   *  wiping all device-side state — so ANY page change must re-send the FULL
   *  feedback frame, not a diff against state the device no longer holds.
   *  null until the first frame. */
  private lastVsn1FeedbackPage: number | null = null;
  /** The LAYOUT signature (effect id + behavior + label per on-page slot) the last
   *  VSN1 feedback frame was projected for. A slot swap/clear from ANY surface
   *  (CaptainPad UI, another client) changes this — a LAYOUT change, which on the
   *  device triggers a Lua re-flash + VM restart (the deploy is a separate wave;
   *  here we only guarantee the runtime feedback stays whole). So a layout change
   *  forces a FULL feedback re-send exactly like a page change, rather than a diff
   *  that could leave the swapped slot's active/value/mode dark. null until the
   *  first frame. */
  private lastVsn1LayoutSig: string | null = null;
  /** Set to force the NEXT VSN1 feedback frame to be FULL (diff reset), regardless
   *  of what changed. Decouples "the device needs a whole frame" from the diff
   *  comparison so an unrelated onEngineUpdate landing between the trigger and the
   *  emit can't repopulate the diff and swallow the resync (the page-flakiness
   *  root cause). Set by: a page difference (engine-origin change), a VSN1
   *  side-button press (device-origin, incl. re-selecting the SAME page — the VM
   *  still restarts), and the welcome/reconnect path. Consumed exactly once by
   *  sendVsn1Feedback. */
  private vsn1ForceFullResync = false;
  /** Effects v2 WELCOME: a one-shot "hello" (`vsn1WelcomeMessage()`) sent to the
   *  VSN1 ALONGSIDE the next full feedback re-sync — armed on a genuine
   *  (re)connect and when the effects panel first loads (`requestVsn1Welcome()`),
   *  consumed exactly once by `sendVsn1Feedback`. Never diffed into the steady
   *  stream (a distinct address from the page LEDs), so it fires once per arm. */
  private vsn1WelcomePending = false;
  /** Item 2 (device-hello-driven welcome): armed on a genuine host (re)connect —
   *  the NEXT device hello (the device's "VM ready" ping, sent on its first VM
   *  start after we connect) arms the welcome logo. Consumed by the FIRST device
   *  hello of the connection (`handleDeviceHello`), which sets vsn1WelcomePending
   *  and clears this; every SUBSEQUENT hello (page load / post-flash VM restart)
   *  only re-pushes state and does NOT re-arm the welcome. This makes the welcome
   *  a per-connection greeting driven by the device's own readiness signal — never
   *  a page-change flash (item 1) and never lost to a restart race (item 2). */
  private vsn1WelcomeArmNextHello = false;
  /** KEEPALIVE full-frame resync (review D3, 2026-07-10): the device renders
   *  ONLY from inbound host MIDI, and every VM-wipe repair path hinges on the
   *  device hello reaching a healthy, singular host. A hello missed during a
   *  tab reload / manager reconnect / stale-twin window leaves the host's diff
   *  map suppressing every frame — a permanently frozen LCD with no repair
   *  path. This low-rate interval (≈25 MIDI messages per fire) makes ALL such
   *  failures self-heal within one period. VSN1 profile only; armed on a
   *  successful connect, cleared on dispose. */
  private vsn1KeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly VSN1_KEEPALIVE_MS = 15000;
  /** VSN1 LCD render selector (Sina, 2026-07-10 evening): 'effect' = the 2×4
   *  color-only GRID + compact detail (device `vm = 1`, the DEFAULT), 'drum' =
   *  the full-screen readout (`vm = 0`). Toggled by sb_1, one press per flip —
   *  PRESENTATION ONLY: key behavior is DRUM (fire immediately) in both views;
   *  nothing behavioral reads this field. Echoed to the device on every full
   *  re-sync so it survives the VM wipe. */
  private vsn1ViewMode: Vsn1ViewMode = 'effect';
  /** VSN1 sb_2 (bank-cycle) anti-spurious-flip state. sb_2 is the ONLY bank cycler
   *  in CaptainPad; a live bug fired it with no operator touch. These fields back
   *  the four guards in handleVsn1BankButton (stale / debounce / in-flight /
   *  self-echo). VSN1 sb_2 only; inert for every other driver + button. */
  /** Clock (ms) of the last ACCEPTED sb_2 press (0 = none yet) — debounce base. */
  private sb2LastAcceptedMs = 0;
  /** True while an sb_2 bank-cycle POST is in flight / awaiting the WS echo. Set on
   *  accept, cleared when the snapshot's activeBankId CHANGES off the pre-cycle id
   *  (echo landed, in projectAndSend), on a failed POST, or after the timeout. */
  private sb2PatchInFlight = false;
  /** Clock (ms) the in-flight lock was armed — bounds it by SB2_INFLIGHT_TIMEOUT_MS. */
  private sb2InFlightSince = 0;
  /** The active bank id captured just BEFORE the in-flight cycle — the echo-clear
   *  releases when the snapshot's activeBankId differs from THIS (any change = the
   *  cycle landed). null when no cycle is pending. */
  private sb2PrevBankId: string | null = null;
  /** note → clock (ms) of the last OUTBOUND Note On (velocity > 0) we sent the
   *  device. The self-echo guard checks the sb_2 note (43) against this to reject
   *  a MIDI loopback of our own page-2 side-LED feedback frame. Bounded (keyed by
   *  the ~128 note numbers). */
  private readonly recentOutboundNotes = new Map<number, number>();
  private unsubs: (() => void)[] = [];
  private context: string;
  /** Per-layer playlist browse-window top index (controller-local state). */
  private readonly windowCursor = new Map<number, number>();
  /** Per-layer last-seen ACTIVE entry ID — drives the browse-window auto-follow.
   *  When a layer's active entry changes to a DIFFERENT entry (a UI tap,
   *  autopilot, or a cross-tab switch), the window re-centres around it so the
   *  pads (and the published blue UI highlight) always map around what's
   *  playing. Keyed by entry ID — NOT index — deliberately: a playlist refresh
   *  that swaps the entries array (or a momentary null between selections) makes
   *  the active INDEX flicker while the active ID is unchanged, and an
   *  index-keyed baseline would read that flicker as a "change" and yank a manual
   *  pad-scroll browse back onto what's playing (the 2026-07 desync). An
   *  unresolved active (null / not-in-list) is NEVER recorded as the baseline —
   *  the window holds and the last known id is kept — so its return to the same
   *  entry is a no-op, and only a genuine switch to a different entry re-centres.
   *  `handleScroll` seeds this to the current active entry so a projection tick
   *  landing mid-browse can't mistake the standing active entry for a change. */
  private readonly lastActiveIdByLayer = new Map<number, string | null>();
  /** Per-CHANNEL entry id whose activation should recenter the browse window —
   *  set ONLY by a CaptainPad list UI tap (`noteUiPatternSelect`, wired from
   *  PlaylistPanel.handleEntryTap). Operator policy (2026-07): the window
   *  auto-follow recenters ONLY for a mouse/touch list tap; EVERY other active-entry
   *  source — APC pad-select, autopilot advance, engine/cross-tab echo — leaves the
   *  window exactly where it is (baseline advanced so no later catch-up jump).
   *  syncWindowsToActiveEntries recenters when the tapped entry's echo lands, then
   *  clears the marker. Keyed by channel id (L.id) so it needs no layer-index map. */
  private readonly uiTapRecenterByChannel = new Map<string, string>();
  /** The layer the operator just requested focus on (set SYNCHRONOUSLY in the
   *  focusChannel handler). The onFocusChange → React → async snapshot swap is
   *  authoritative-but-late; until `snapshot.focused.layer` catches up we (a)
   *  paint LEDs from this and (b) treat mixer bindings as locked so a fader
   *  can't write to the OLD channel. -1 = no explicit request yet (fall back to
   *  the snapshot's focused layer). */
  private requestedFocusLayer = -1;
  /** Optimistic applied value per relative-delta target (#3 fast-turn
   *  undershoot). The engine's modulationState echo lags a fast sweep by ~150 ms
   *  (and is itself throttled), so anchoring each window on the snapshot loses
   *  most of the sweep. Instead we keep a LOCAL running value per target, seeded
   *  from the snapshot, accumulating deltas across windows, and re-seeded ONLY
   *  when the snapshot diverges beyond what a throttled echo lag can explain.
   *  Keyed by a target identity string (channel-identity + key/index). */
  private readonly optimisticValues = new Map<string, number>();
  /** The snapshot anchor last OBSERVED per relative-delta control id, recorded
   *  alongside the optimistic value. A fresh window compares the current
   *  snapshot against this: an unchanged (or lagging-toward-us) snapshot means
   *  our optimistic value still holds; a snapshot that JUMPED (an external write
   *  / reset / modulator step, beyond the echo epsilon) means re-seed. */
  private readonly lastSnapAnchor = new Map<string, number>();
  /** Focus identity (focused.key) a `focusedParamDelta` optimistic entry was
   *  written under, keyed like `optimisticValues`. The RING display overlay
   *  only trusts an optimistic entry recorded for the CURRENT focus — a focus
   *  or entry switch must repaint from the new focus's own snapshot values,
   *  never show the previous focus's optimistic value. (Hue needs no such
   *  guard: its entries are already keyed per channel.) */
  private readonly optimisticFocusKey = new Map<string, string>();
  /** Per-relative-control continuous velocity tracker (accel.ts round 4). Each
   *  tick's raw step (linear in the firmware count) is gained HERE, at arrival
   *  time, from a smoothed turn-rate estimate — a MODEST gain (GAIN_MAX 3.0) on
   *  top of the firmware's own 1→17 velocity multiply, the combination the
   *  operator hardware-confirmed. Bucket-phase independent (the coalescer just
   *  SUMS pre-gained deltas). Keyed by control id (same as the coalescer slots). */
  private readonly tickAccels = new Map<string, TickAccelerator>();
  /** Focus identity captured at ACCUMULATE time per relative-delta control id
   *  (N3). `focusedParamDelta`/`Reset` resolve `focused.exports[index]` at FLUSH
   *  time; a focus change inside the coalescer window would otherwise write the
   *  accumulated delta into the NEW channel's same-index param. We record the
   *  focus key when the first tick lands and DROP the payload at flush if focus
   *  moved. */
  private readonly deltaFocusKey = new Map<string, string | null>();
  /** Soft-takeover state per binding id (locks a fader until it crosses the
   *  param's current value, so focus/pattern switches don't jump the value). */
  private readonly pickupStates = new Map<string, PickupState>();
  /** Driver #3 (VSN1): the SELECTED global-effect slot — the 1-based slot of the
   *  LAST key pressed on THIS device. null until any key is pressed; while null the
   *  jog wheel is IGNORED (defined behavior, logged once at debug). The jog's
   *  absolute intensity write + its reset both target this selection. */
  private selectedSlot: number | null = null;
  /** Soft-takeover ("pickup") state for the VSN1 jog wheel against the SELECTED
   *  slot's intensity: a stale wheel position must not yank the value after a
   *  selection change — the wheel re-picks-up (crosses the slot's live intensity)
   *  before it writes. Re-locked whenever the selection changes. */
  private intensityPickup: PickupState = freshPickup();
  /** Debounce the "jog before any selection" debug log to once per idle stretch
   *  (a jog spin fires ~30 CCs/turn); reset when a selection lands. */
  private loggedJogWithoutSelection = false;
  /** Identity of the focus the pickup map was built for; a change re-locks. */
  private lastFocusKey: string | null = null;
  /** Active MFT virtual bank (0-3), tracked from the device's ch3 bank-change
   *  reports. Bank switching is hardware-local; we only track it for status +
   *  ring feedback (the device latches ring state per bank). */
  private activeBank = 0;
  /** Was THIS runtime's device present + successfully configured on the last
   *  connect pass? Drives the connect-time sysex config push (#11): the config
   *  is pushed ONLY on a genuine disconnected→connected transition for this
   *  device, never when some OTHER device hotplugs (which fans an
   *  `endpointsChanged` to every transport). A real power-cycle flips this back
   *  to false (via the absent / error paths), so a replug re-pushes. */
  private deviceConfigured = false;
  /** Reentrancy guard: connect() runs are serialized so overlapping hotplug
   *  passes can't interleave. When a pass is in flight and another is requested,
   *  we set `reconnectQueued` and run exactly one more pass on completion (the
   *  endpoint set may have changed during the run). */
  private connecting = false;
  private reconnectQueued = false;
  /** Pending debounce timer handle for `endpointsChanged` (null = idle). The ≥2
   *  statechange events one physical plug emits collapse into a single reconnect
   *  pass fired at the end of this window. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectTimers: CoalescerTimers;
  private readonly reconnectDebounceMs: number;
  private readonly learn: LearnController;
  /** Consecutive failed `api.*()` dispatches (P2-5). Reset on any success. Once
   *  it crosses FAILURE_WARN_THRESHOLD a non-sticky `warning` surfaces so an
   *  engine that died mid-set (knobs 404-ing) isn't silent. */
  private dispatchFailStreak = 0;
  /** Consecutive failed LED `transport.send` calls (LED-send silence). Same
   *  escalation shape as dispatch; a dead LED strip becomes visible instead of
   *  vanishing into a bare catch. */
  private ledFailStreak = 0;
  /** CPC keys that a relative knob referenced but that are MISSING from the
   *  now-LOADED globalParamValues map (P2-1). Aggregated + surfaced non-fatally
   *  (the controller stays `connected`); cleared per key the moment it appears.
   *  Distinct from a boot race where the map itself is undefined (that's inert,
   *  not an error). */
  private readonly runtimeParamErrors = new Set<string>();
  /** Connect-time param-key errors from validateProfileParams (a key in the
   *  profile YAML that isn't in the CPC schema). Kept as a field — not just
   *  pushed into status — so the runtime "vanished from schema" set (P2-1) can be
   *  merged with it into one surfaced aggregate. */
  private profileParamErrors: ParamKeyError[] = [];
  status: ControllerStatus;

  constructor(
    profile: ControllerProfile,
    opts: MidiManagerOptions,
    dispatcher: MidiDispatcher,
    learn: LearnController,
    notify: () => void,
  ) {
    this.profile = profile;
    this.opts = opts;
    this.dispatcher = dispatcher;
    this.learn = learn;
    this.notify = notify;
    this.context = opts.defaultContext ?? 'deck';
    this.reconnectTimers = opts.reconnectTimers ?? REAL_RECONNECT_TIMERS;
    this.reconnectDebounceMs = opts.reconnectDebounceMs ?? DEFAULT_RECONNECT_DEBOUNCE_MS;
    this.transport = opts.transportFactory();
    this.coalescer = new ControlCoalescer<ResolvedAction>(
      opts.coalesceMs ?? DEFAULT_COALESCE_MS,
      (controlId, payload) => { void this.flushResolved(controlId, payload); },
      opts.coalescerTimers,
    );
    this.status = { deviceId: profile.device.id, label: profile.device.label, kind: 'disconnected' };
  }

  private setStatus(patch: Partial<ControllerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.notify();
  }

  /** Dispatch a resolved action and SURFACE the result (P2-5). The dispatcher
   *  returns the engine call's MidiApiResult; the old code awaited it and threw
   *  it away, so an engine restart / deleted-entry 404 mid-set left knobs doing
   *  nothing while the chip stayed green — the exact fail-loud violation. On
   *  `ok:false` we set a visible `lastEvent` (`✕ <kind> failed: <error>`) and,
   *  after FAILURE_WARN_THRESHOLD consecutive failures, a NON-STICKY `warning`
   *  (the controller keeps running; it does not go sticky-red). Any success
   *  clears the streak + warning. Returns the result for callers that branch. */
  private async runDispatch(resolved: ResolvedAction): Promise<MidiApiResult> {
    const result = await this.dispatcher(resolved);
    this.surfaceApiResult(resolved.kind, result);
    return result;
  }

  /** Surface a MidiApiResult from ANY engine call the runtime makes — the
   *  dispatcher path AND the direct api calls (playlist-entry select). On
   *  success it clears the fail streak + warning; on failure it sets a visible
   *  `lastEvent` and escalates to a NON-STICKY `warning` after
   *  FAILURE_WARN_THRESHOLD consecutive failures (P2-5). */
  private surfaceApiResult(kind: string, result: MidiApiResult): void {
    if (result.ok) {
      if (this.dispatchFailStreak !== 0) {
        this.dispatchFailStreak = 0;
        this.setStatus({ warning: undefined });
      }
      return;
    }
    // PERFORMANCE MODE: a 409 PERFORMANCE_MODE is not a failure — it's the
    // engine deliberately declining a structural change while a show is live.
    // Surface it QUIETLY (soft status, no alert) and DON'T bump the fail streak,
    // so a pad bound to a locked action (pattern swap, view select) doesn't
    // drive the controller chip red mid-show. A live control (fader/param)
    // isn't gated, so it never lands here.
    if (result.code === 'PERFORMANCE_MODE') {
      this.setStatus({ lastEvent: `🔒 ${kind} locked (performance mode)` });
      return;
    }
    this.dispatchFailStreak += 1;
    const reason = result.error ?? 'unknown error';
    const patch: Partial<ControllerStatus> = { lastEvent: `✕ ${kind} failed: ${reason}` };
    if (this.dispatchFailStreak >= FAILURE_WARN_THRESHOLD) {
      patch.warning = `${this.dispatchFailStreak} MIDI writes failed (${kind}: ${reason}) — is the engine up?`;
    }
    this.setStatus(patch);
  }

  /** Serializing wrapper around `runConnect` (#11). A single physical plug fires
   *  ≥2 `statechange` events and `endpointsChanged` collapses them, but a genuine
   *  reconnect and an initial `start()` can still overlap; a reentrant run would
   *  interleave teardown/rebind. If a run is already in flight, mark one more pass
   *  queued (the endpoint set may have moved during the run) and return — the
   *  in-flight run drains the queue on completion. */
  async connect(): Promise<void> {
    if (this.connecting) {
      this.reconnectQueued = true;
      return;
    }
    this.connecting = true;
    try {
      await this.runConnect();
      while (this.reconnectQueued) {
        this.reconnectQueued = false;
        await this.runConnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  private async runConnect(): Promise<void> {
    try {
      const endpoints = await this.transport.listEndpoints();
      // Device absent (no endpoint carries the name) → grey, not an error. A
      // real power-cycle passes through here, so clear `deviceConfigured` so the
      // eventual replug re-pushes the sysex config (survives an unplug).
      const present = endpoints.some(
        (e) => e.name.includes(this.profile.device.nameContains),
      );
      if (!present) {
        this.deviceConfigured = false;
        this.teardownBindings();
        this.ledState = {};
        this.vsn1FeedbackState = {}; // replug re-sends a full feedback frame
        this.lastVsn1FeedbackPage = null; // forget the page so a replug forces a full frame
        this.lastVsn1LayoutSig = null; // and the layout, so a replug can't diff-suppress it
        this.setStatus({ kind: 'disconnected', error: undefined, sourceName: undefined, destinationName: undefined });
        // Still listen for hotplug so a later plug-in connects us.
        this.bindHotplugOnly();
        return;
      }

      const resolved = resolveEndpoints(this.profile.device, endpoints); // throws → error
      await this.transport.openSource(resolved.sourceId);
      await this.transport.openDestination(resolved.destinationId);

      // Connect-time sysex config push (MFT): force the encoders into the
      // relative-mode layout this driver assumes. Pushed ONLY on a genuine
      // disconnected→connected transition for THIS device (`!deviceConfigured`):
      // when some OTHER controller hotplugs, Web MIDI fans an `endpointsChanged`
      // to every transport, and an already-connected MFT must NOT be re-blasted
      // with the multi-KB config burst mid-set (#11). A power-cycle clears the
      // flag (absent/error paths) so a replug re-pushes. The frames are the
      // module-level `MFT_CONNECT_CONFIG_FRAMES` — same bytes + ordering as
      // before, just built once. Requires a transport that can send sysex; if
      // send() throws (Web MIDI without `sysex:true`) we go RED with the reason
      // rather than run against unknown encoder modes (docs/34 §5.3 fail-loud).
      if (this.profile.device.configureOnConnect && !this.deviceConfigured) {
        try {
          for (const frame of MFT_CONNECT_CONFIG_FRAMES) this.transport.send(frame);
        } catch (cfgErr) {
          const reason = cfgErr instanceof Error ? cfgErr.message : String(cfgErr);
          this.deviceConfigured = false;
          this.teardownBindings();
          // Operator-friendly copy first, raw reason parenthesised last (never a
          // bare DOMException as the whole message).
          this.setStatus({
            kind: 'error',
            error: `${this.profile.device.label}: MIDI sysex denied — reload and allow sysex (Web MIDI needs sysex:true), or flash the .mfs preset via MF Utility. (${reason})`,
          });
          this.bindHotplugOnly();
          return;
        }
      }
      // Mark configured AFTER a clean open + (possible) config push, so any throw
      // above leaves the flag false and the next pass re-pushes.
      const wasConfigured = this.deviceConfigured;
      this.deviceConfigured = true;

      // Param-key validation: aggregate, non-fatal (other controls keep working).
      // Skipped while the schema is empty (not loaded yet); revalidate() re-runs
      // it once the engine CPC schema lands. Stored on the field so it merges
      // with the runtime "vanished from schema" set (P2-1).
      const keys = this.opts.getSchemaKeys?.();
      this.profileParamErrors = keys && keys.size > 0 ? validateProfileParams(this.profile, keys) : [];

      this.teardownBindings();
      this.unsubs.push(this.transport.addListener('midiMessage', (e) => this.onMessage(e.data, e.timestampMs)));
      this.unsubs.push(this.transport.addListener('endpointsChanged', () => this.onEndpointsChanged()));

      this.setStatus({
        kind: 'connected',
        error: undefined,
        sourceName: resolved.sourceName,
        destinationName: resolved.destinationName,
        paramErrors: this.mergedParamErrors(),
      });
      // Force a FULL LED repaint only on a genuine (re)connect transition. When
      // the device was already configured and merely stayed connected across a
      // foreign hotplug, keep `ledState` so the diff sends nothing unchanged (#11
      // — don't blast a full repaint on every other device's plug).
      // A genuine (re)connect resets the feedback diff (→ full re-send) AND arms
      // the VSN1 WELCOME so the hello rides with that full re-sync (task: hello +
      // full state on reconnect). A foreign hotplug that kept us connected does
      // neither — no re-blast, no spurious hello.
      // A genuine (re)connect forces a FULL feedback frame (flag + diff reset +
      // forget the last page) carrying the CURRENT on/off truth for every key,
      // and arms the WELCOME. So the device's LEDs/screen show the real live
      // state the instant it reconnects — never stale or dark.
      if (!wasConfigured) {
        this.ledState = {};
        this.vsn1FeedbackState = {};
        this.lastVsn1FeedbackPage = null;
        this.lastVsn1LayoutSig = null;
        this.vsn1ForceFullResync = true;
        // Item 2: the welcome is now DEVICE-HELLO-DRIVEN. Arm the NEXT device
        // hello (the device pings "VM ready" on its first VM start after we
        // connect) to raise the logo — never a blind on-connect send that could
        // race the device's restart. The immediate re-sync below still paints the
        // live state; the logo rides the device's own readiness signal.
        this.vsn1WelcomeArmNextHello = true;
      }
      this.projectAndSend();
      // Arm the VSN1 keepalive resync (review D3). Idempotent across hotplug
      // reconnects (one timer per runtime); the tick self-guards on live
      // connection state so a greyed-out device costs nothing.
      if (this.profile.device.id === 'vsn1' && this.vsn1KeepaliveTimer === null) {
        this.vsn1KeepaliveTimer = setInterval(() => {
          if (this.status.kind !== 'connected') return;
          this.vsn1ForceFullResync = true;
          this.projectAndSend();
        }, ControllerRuntime.VSN1_KEEPALIVE_MS);
      }
    } catch (err) {
      const message = err instanceof EndpointResolutionError
        ? err.message
        : (err instanceof Error ? err.message : String(err));
      this.deviceConfigured = false;
      this.teardownBindings();
      this.setStatus({ kind: 'error', error: message });
      this.bindHotplugOnly();
    }
  }

  private bindHotplugOnly(): void {
    this.unsubs.push(this.transport.addListener('endpointsChanged', () => this.onEndpointsChanged()));
  }

  /** Hotplug `endpointsChanged` handler (#11). Debounces the ≥2 statechange
   *  events one physical plug emits into a single reconnect pass: each event
   *  restarts a short timer, and only when it fires do we re-run connect() (which
   *  re-resolves endpoints — grey on unplug, reconnect + repaint on replug).
   *  connect() itself serializes, so even a debounce firing while a pass is still
   *  in flight can't interleave. */
  private onEndpointsChanged(): void {
    if (this.reconnectTimer !== null) this.reconnectTimers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.reconnectTimers.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDebounceMs);
  }

  /** Re-run param-key validation against the now-loaded CPC schema and update
   *  the status (the schema arrives async, after connect). */
  revalidateParams(): void {
    if (this.status.kind !== 'connected') return;
    const keys = this.opts.getSchemaKeys?.();
    this.profileParamErrors = keys && keys.size > 0 ? validateProfileParams(this.profile, keys) : [];
    this.setStatus({ paramErrors: this.mergedParamErrors() });
  }

  /** Switch the active context (CaptainPad tab) — repaints LEDs for the new
   *  control set. No-op if unchanged. */
  setContext(name: string): void {
    if (name === this.context) return;
    this.context = name;
    // The hue knob targets the FOCUSED CHANNEL, and a tab switch changes
    // which channel that is (deck channel vs the focused overlay) AT FLUSH
    // TIME — a turn accumulated on the old tab must not flush into the new
    // tab's channel. Cancel any pending hue-turn window (sub-33 ms of travel,
    // dropped loudly-by-design) and forget its anchors so the next turn
    // re-seeds from the new channel's own hue.
    const hueId = this.hueTurnControlId();
    if (hueId !== null) {
      this.coalescer.cancel(hueId);
      this.deltaFocusKey.delete(hueId);
      this.forgetOptimistic(hueId);
    }
    this.ledState = {};
    this.projectAndSend();
  }

  private onMessage(data: number[], timestampMs: number): void {
    this.opts.onActivity?.();
    const decoded = decodeMidi(data);

    // 0) MFT bank-change report (ch3 CC 0-3 = 127) — hardware-local bank switch.
    //    Track it for status/ring feedback; it is not a mapped control, so it
    //    never falls through to learn/binding/resolve. decodeBankChange returns
    //    null for every non-MFT message, so this is inert for the APC.
    const bank = decodeBankChange(decoded);
    if (bank !== null) {
      if (bank !== this.activeBank) {
        this.activeBank = bank;
        this.setStatus({ lastEvent: `MFT bank ${bank + 1}` });
        // FULL repaint (empty diff base), not a diff: the device latches LED
        // state per bank and can redraw on a bank switch, so a diff against
        // what we last SENT can silently disagree with what the hardware now
        // SHOWS (the stale-LED bug Sina hit). ~40 CCs per bank switch is cheap.
        this.ledState = {};
        this.projectAndSend();
      }
      return;
    }

    // 0.5) VSN1 DEVICE → APP page follow (item 5). The PHYSICAL side button is
    //    the firmware-native page switcher: it changes the device page (and
    //    restarts the Lua VM) and emits the page CC (controller 40, value = the
    //    new page 0..3). CaptainPad must FOLLOW it so the app + engine converge on
    //    the SAME page (the app → device direction already rides the outbound
    //    page-index feedback). We intercept it HERE — before resolve — because the
    //    profile leaves inbound CC 40 UNBOUND (its value stream moved to the keyed
    //    per-slot CCs 32..39), so it would otherwise be loud silence. Matched by
    //    controller number regardless of channel (the device rides channel = page,
    //    like the keys' anyChannel). PATCHing the engine page makes the engine's
    //    `effectsPage` broadcast converge every surface; the resulting VM-restart
    //    full re-sync (a page difference arms vsn1ForceFullResync in
    //    sendVsn1Feedback) repaints the device — WITHOUT re-arming the welcome
    //    (item 1: only a genuine connect / panel load ever arms the hello).
    if (this.profile.device.id === 'vsn1' && decoded.type === 'cc') {
      // 0.4) DEVICE HELLO (item 2): the device pings "VM ready" (CC controller
      //    DEVICE_HELLO_CC = 1) on EVERY VM restart — power-on, page load, and
      //    every layout re-flash — the moment its receiver re-registers. Answer it
      //    with a full state re-push so the device restores its view mode + all
      //    active/value/mode/page feedback. Because the DEVICE asks only once its
      //    receiver is live, this re-push can't be lost to a restart still in
      //    flight (the race a timed re-echo would hit). The FIRST hello of a
      //    connection arms the welcome logo; subsequent ones only re-push.
      if (isDeviceHello(0xb0 | (decoded.channel & 0x0f), decoded.cc, decoded.value)) {
        this.handleDeviceHello();
        return;
      }
      // DEVICE → APP PAGE FOLLOW — DELETED (page-follow retirement complete).
      // Deploys are page-0-only and the device no longer pages natively, so
      // CaptainPad no longer follows a device page CC into an engine effectsPage
      // PATCH. A stray page CC simply falls through to resolve (unmapped = loud
      // silence); the engine's own effectsPage broadcast is the single source of
      // truth CaptainPad renders.
    }

    // 1) MIDI-learn capture — while armed, the next learnable control BINDS
    //    (the popover supplied the callback) and is swallowed, never dispatched.
    //    BUT: a control that already resolves to a STATIC profile action (global
    //    speed, master, a pad, …) must NOT be learnable — capturing it would
    //    permanently shadow that action. Run resolveEvent FIRST; if it claims
    //    the control, reject with a named conflict instead of capturing.
    if (this.learn.isArmed()) {
      const cap = controlRefFromEvent(decoded);
      if (cap) {
        // P1-3: an MFT endless encoder / CC-hold push is learnable-LOOKING but a
        // footgun (codex P0). Its CC "value" is a relative-delta code, not an
        // absolute position, so learning it and feeding it through absolute
        // scaleMidiToRange would pin the param to ~0.5 jitter. Reject when EITHER
        // the value looks like a CLASSIC relative code (the narrow 61-67 band a
        // slow/moderate encoder turn emits — isClassicRelativeCode, NOT the
        // full-range decodeRelativeDelta, which since the fast-twist decode fix
        // covers every value 0..127 and would misclassify any absolute fader
        // position as a relative turn) OR the event is on a configureOnConnect
        // device's rotary/switch channel (bank-2/3/4 turns + pushes never reach
        // a static profile action, so profileClaims wouldn't catch them; this
        // branch also catches an MFT turn arriving as a fast out-of-band code).
        // The reason is STRUCTURED (LearnRejectReason): bank-1 encoders are
        // `order-mapped-encoder` (they drive params by order, by design);
        // encoder numbers ≥ 16 are `reserved-bank` — the future custom-mapping
        // UI relaxes ONLY that branch.
        const isRelativeCode = decoded.type === 'cc' && isClassicRelativeCode(decoded.value);
        const onRotaryOrSwitch = this.profile.device.configureOnConnect
          && (decoded.type === 'cc' || decoded.type === 'noteOn' || decoded.type === 'noteOff')
          && (decoded.channel === MidiChannels.ROTARY_ENCODER || decoded.channel === MidiChannels.SWITCH_AND_COLOR);
        if (isRelativeCode || onRotaryOrSwitch) {
          const encoderNumber = decoded.type === 'cc'
            ? decoded.cc
            : (decoded.type === 'noteOn' || decoded.type === 'noteOff' ? decoded.note : 0);
          const reason: LearnRejectReason = onRotaryOrSwitch && encoderNumber >= Encoders.DEVICE_KNOB_PER_BANK
            ? { kind: 'reserved-bank' }
            : { kind: 'order-mapped-encoder' };
          if (this.learn.reject(reason)) {
            const tag = reason.kind === 'reserved-bank' ? 'reserved bank' : 'order-mapped encoder';
            this.setStatus({ lastEvent: `learn ✕ ${describeEvent(decoded, null)} (${tag})` });
            return;
          }
        }
        // P2-2: reject a SECOND learned binding on a control the focused pattern
        // already has an enabled binding for. applyBinding's `.find()` picks by
        // array order while the UI names a different one, so two bindings on one
        // physical fader silently fight. Reject at capture (the runtime side; a
        // sibling agent handles the save-time UI re-check). Upsert-by-control is
        // the save-side concern; here we simply refuse the duplicate capture.
        const focused = this.opts.getSnapshot().focused;
        const dup = focused?.midiMappings.find((b) => b.enabled && bindingMatches(b.control, decoded));
        if (dup) {
          if (this.learn.reject({ kind: 'already-bound', parameter: dup.target.parameter })) {
            this.setStatus({ lastEvent: `learn ✕ ${describeEvent(decoded, dup.id)} (already bound)` });
            return;
          }
        }
        const claimed = profileClaims(this.profile, cap.ref, this.context);
        if (claimed !== null) {
          if (this.learn.reject({ kind: 'profile-claimed', controlId: claimed })) {
            this.setStatus({ lastEvent: `learn ✕ ${describeEvent(decoded, claimed)} (mapped)` });
            return;
          }
        } else if (this.learn.capture(cap.ref)) {
          this.setStatus({ lastEvent: `learn ← ${describeEvent(decoded, null)}` });
          return;
        }
      }
    }

    // 2) MIDI-learned binding application — a learned control drives the focused
    //    pattern's STATIC param value. Binding-first: a learned control wins
    //    over any static profile action on the same control (faders 4-8 are
    //    unmapped in the profile, so normal use never collides).
    if (this.applyBinding(decoded)) return;

    // 3) Profile-mapped action. An unknown active context is a wiring bug (a tab
    //    published a context the profile never declared) — surface it as a red
    //    chip rather than letting the throw crash the transport's message
    //    callback. Other errors keep propagating unchanged.
    let ev: ReturnType<typeof resolveEvent>;
    try {
      ev = resolveEvent(this.profile, decoded, this.context);
    } catch (err) {
      if (err instanceof UnknownContextError) {
        this.setStatus({ kind: 'error', error: err.message });
        return;
      }
      throw err;
    }
    // 12b: don't update the monitor line for CONTINUOUS controls at raw MIDI
    // rate (>100/s) — the coalescer flush records those at ~30 Hz instead, so
    // React consumers don't re-render on every fader tick. Unmapped + discrete
    // events are rare, so they still record immediately here.
    if (!ev || !ev.continuous) {
      this.setStatus({ lastEvent: describeEvent(decoded, ev ? ev.controlId : null) });
    }
    if (!ev) return;
    // Focus + the playlist window browser need controller-local state, so they
    // are handled here rather than in the pure dispatcher.
    if (ev.resolved.kind === 'focusChannel') { this.handleFocus(ev.resolved.layer); return; }
    if (ev.resolved.kind === 'playlistScroll') { this.handleScroll(ev.resolved.layer, ev.resolved.dir); return; }
    if (ev.resolved.kind === 'playlistWindowSelect') { this.handleWindowSelect(ev.resolved.layer, ev.resolved.slot); return; }
    // ── MFT relative-encoder + side-button actions (runtime-handled) ──
    if (ev.resolved.kind === 'focusStep') { this.handleFocusStep(ev.resolved.dir); return; }
    if (ev.resolved.kind === 'focusedParamReset') { this.handleParamReset(ev.resolved.index); return; }
    if (ev.resolved.kind === 'hueReset') { this.handleHueReset(); return; }
    // ── Driver #3 (VSN1) — selected-slot model (runtime-handled) ──
    // A slot KEY press records the selection for THIS device (the jog then targets
    // it). The VSN1 uses Sina's TWO-STEP contract (handleVsn1SlotKey); every OTHER
    // device keeps the historical direct behavior (select + dispatch on every
    // press). The jog's absolute intensity + its reset resolve against
    // `selectedSlot` here.
    if (ev.resolved.kind === 'globalEffectSlot') {
      if (this.profile.device.id === 'vsn1') { this.handleVsn1SlotKey(ev.resolved); return; }
      this.selectSlot(ev.resolved.slot); void this.runDispatch(ev.resolved); return;
    }
    // VSN1 SMALL BUTTONS (sb_0..sb_3). The small panel buttons never change
    // pages (the physical side button does that); the host owns the policy.
    if (ev.resolved.kind === 'vsn1SmallButton') {
      this.handleVsn1SmallButton(ev.resolved.button, timestampMs);
      return;
    }
    if (ev.resolved.kind === 'effectIntensityReset') { this.handleIntensityReset(); return; }
    if (ev.resolved.kind === 'effectIntensityAbs') { this.handleIntensityAbs(ev.controlId, ev.resolved.value); return; }
    // Effects v2: encoder press → cycle the SELECTED slot's mode (runtime-resolved
    // against the selection, like the intensity reset it replaced).
    if (ev.resolved.kind === 'effectModeCycle') { this.handleModeCycle(); return; }
    // (Page-follow retirement, 2026-07 — COMPLETE.) The VSN1 device→app
    // page-select path is gone: no VSN1 profile control produces
    // `effectsPageSelect`, so the former VM-restart-resync special-case for it was
    // deleted. A non-VSN1 `effectsPageSelect` (should any profile bind one) still
    // dispatches normally through the discrete-action path below.
    if (ev.resolved.kind === 'focusedParamDelta' || ev.resolved.kind === 'paramCenterDelta'
      || ev.resolved.kind === 'hueDelta') {
      // Relative deltas ACCUMULATE across the coalescer window (no tick dropped),
      // then flush as a single write against the optimistic value in
      // flushResolved. For a focused delta, capture the focus identity NOW (N3)
      // so the flush can drop the payload if focus moved during the window
      // rather than writing into the new channel's same-index param.
      if (ev.resolved.kind === 'focusedParamDelta' && !this.deltaFocusKey.has(ev.controlId)) {
        this.deltaFocusKey.set(ev.controlId, this.opts.getSnapshot().focused?.key ?? null);
      }
      // Hue turn: same mid-window guard, but keyed on the CHANNEL identity
      // (role:id) — the hue is channel-level, so an entry change mid-turn is
      // harmless while a focus (channel) change must drop the window rather
      // than recolor the new channel. Applies in BOTH contexts (the deck
      // tab's single channel can't refocus, so the guard is trivially
      // satisfied there).
      if (ev.resolved.kind === 'hueDelta' && !this.deltaFocusKey.has(ev.controlId)) {
        this.deltaFocusKey.set(ev.controlId, channelIdentity(this.opts.getSnapshot().focused));
      }
      // Velocity gain is applied PER TICK, at arrival time, from this control's
      // continuous rate estimate (accel.ts round 4) — a MODEST gain on top of
      // the firmware's own 1→17 velocity multiply (the operator-confirmed feel).
      // The coalescer then just SUMS pre-gained deltas, so the feel cannot
      // depend on how ticks land in 33 ms buckets. The tick's transport
      // timestamp drives the estimate.
      let accel = this.tickAccels.get(ev.controlId);
      if (!accel) {
        accel = new TickAccelerator();
        this.tickAccels.set(ev.controlId, accel);
      }
      const gained = { ...ev.resolved, delta: accel.applyTick(ev.resolved.delta, timestampMs) };
      this.coalescer.accumulate(ev.controlId, gained, combineDelta);
      return;
    }
    if (ev.continuous) {
      // VSN1 keyed values: one profile control covers 8 CCs × 4 page-channels,
      // each addressing a DIFFERENT slot — coalesce PER SLOT (suffix the key) so
      // two keys turned inside one window can't last-write-wins each other's
      // value. Every other continuous control keeps its plain control-id key.
      const key = ev.resolved.kind === 'effectIntensitySlot'
        ? `${ev.controlId}#s${ev.resolved.slotId}`
        : ev.controlId;
      this.coalescer.push(key, ev.resolved);
    } else {
      void this.runDispatch(ev.resolved);
    }
  }

  /** Move focus by a side-button step: prev/next within the existing layers, or
   *  the deck (layer 0). Clamped to the valid layer range; a step past either
   *  end is inert (no wrap). Routes through the same setFocusIntent path (the
   *  single focus-intent writer) as the APC track buttons. */
  private handleFocusStep(dir: 'prev' | 'next' | 'deck'): void {
    const snap = this.opts.getSnapshot();
    if (dir === 'deck') { this.handleFocus(0); return; }
    // Current focus base: the derived effective focus (request when live, else
    // the snapshot) so a step is relative to where focus ACTUALLY is.
    const eff = this.effectiveFocusLayer(snap);
    const cur = eff !== -1 ? eff : 0;
    const target = dir === 'prev' ? cur - 1 : cur + 1;
    if (target < 0) return; // clamp low — no wrap
    if (!layerInfo(snap, target)) return; // clamp high / absent → inert
    this.handleFocus(target);
  }

  /** THE single focus-intent writer (contract I2). Every focus intent — an APC
   *  track button, an MFT side button, OR a touch tap routed from the hook —
   *  overwrites the focus request through here. Inert when the requested layer
   *  doesn't exist (deck-tab track buttons for layers > 0, or a deleted
   *  overlay). Sets `requestedFocusLayer` SYNCHRONOUSLY so LED paint + the
   *  applyBinding staleness gate don't wait for the async snapshot swap, then
   *  fires onFocusChange + repaints. Public so the hook can call it for touch. */
  setFocusIntent(layer: number): void {
    const snap = this.opts.getSnapshot();
    if (!layerInfo(snap, layer)) return; // absent layer → inert
    this.requestedFocusLayer = layer;
    this.opts.onFocusChange?.(layer);
    this.projectAndSend(); // repaint the focus LED from requestedFocusLayer now
  }

  /** Encoder push → reset the focused param at ordered `index` to the entry's
   *  saved default. When the focused export carries a `defaultValue` we write it;
   *  otherwise this is a documented no-op (the entry didn't ship a default —
   *  reset is deferred, not faked). */
  private handleParamReset(index: number): void {
    const focused = this.opts.getSnapshot().focused;
    if (!focused) return;
    const exp = focused.exports[index];
    if (!exp) return; // no param behind this knob — inert (loud silence)
    // Reset/turn race (#7): a push right after a spin must NOT be clobbered by
    // the same encoder's pending accumulated turn flushing a beat later. Cancel
    // that pending turn slot (its control id is the profile's focusedParamKnob
    // control for THIS index). Do NOT merge key namespaces (that breaks
    // combineDelta's same-kind invariant).
    const turnControlId = this.turnControlIdForIndex(index);
    if (turnControlId !== null) {
      this.coalescer.cancel(turnControlId);
      this.deltaFocusKey.delete(turnControlId);
    }
    if (typeof exp.defaultValue !== 'number') {
      // This entry genuinely shipped no saved default for this param (the hook
      // threads `defaultValue` from the entry when present) — a documented no-op,
      // not faked to some invented value. No reset value to seed, so forget the
      // turn anchor (it re-seeds from the snapshot on the next spin).
      if (turnControlId !== null) this.forgetOptimistic(turnControlId);
      this.setStatus({ lastEvent: `reset ${exp.name} (no saved default — deferred)` });
      return;
    }
    const value = clampUnit(exp.defaultValue);
    // P2-3 reset-then-turn: SEED the turn slot's optimistic anchor with the reset
    // value (not forget it). The old code cleared it, so an immediate follow-up
    // turn re-seeded from the STALE snapshot base and the reset "didn't take"
    // under continued turning. The snap-anchor is seeded with the snapshot we
    // ACTUALLY observe now (the pre-reset base), not the reset value: the echo
    // then travels inside the [observed, reset] span, so neither the flush
    // anchor nor the ring display can misread the reset's own echo as an
    // external jump anywhere along its path.
    if (turnControlId !== null) {
      this.optimisticValues.set(turnControlId, value);
      this.lastSnapAnchor.set(turnControlId, exp.base ?? exp.v0);
      this.optimisticFocusKey.set(turnControlId, focused.key);
    }
    // Reset unlocks the pickup slot for any binding on this param (a deliberate
    // jump), mirroring a note-press write.
    this.setStatus({ lastEvent: `reset ${exp.name} = ${value.toFixed(2)}` });
    this.coalescer.push(`knob:${index}`, {
      kind: 'localParam', role: focused.role, channelId: focused.id, exportId: exp.id, value,
    });
    this.projectAndSend(); // ring shows the reset value immediately
  }

  /** The profile control id whose focusedParamKnob drives the focused export at
   *  `index` — the slot a spin accumulates under, so an encoder-push reset can
   *  cancel it (#7). null when the profile has no turn control for this index. */
  private turnControlIdForIndex(index: number): string | null {
    for (const control of this.profile.controls) {
      const a = control.action;
      if (a.kind === 'focusedParamKnob' && a.index === index) return control.id;
    }
    return null;
  }

  /** The profile control id whose paramCenterRelative turn drives the CPC key —
   *  the slot its optimistic value lives under, so the ring display can read
   *  it. null when no relative knob maps this key (e.g. the APC's absolute
   *  fader path, which has no optimistic entries). */
  private paramCenterControlIdForKey(key: string): string | null {
    for (const control of this.profile.controls) {
      const a = control.action;
      if (a.kind === 'paramCenterRelative' && a.key === key) return control.id;
    }
    return null;
  }

  /** The profile control id of the hue knob's turn (hueKnob) —
   *  the slot a hue spin accumulates under, so the hue push-reset can cancel a
   *  pending turn (same reset/turn race as #7). null when the profile maps no
   *  hue knob. */
  private hueTurnControlId(): string | null {
    for (const control of this.profile.controls) {
      if (control.action.kind === 'hueKnob') return control.id;
    }
    return null;
  }

  /** Encoder push on the hue knob → reset the FOCUSED CHANNEL's hue to 0°
   *  (deck tab = the DECK CHANNEL, auto-focused; mixer tab = the focused
   *  overlay). Hue is PER-CHANNEL ONLY (the global shifter — and its
   *  auto-rotate — was removed 2026-07), so there is nothing to preserve:
   *  a `{ hue: 0 }` PATCH clobbers nothing else. Mirrors handleParamReset's
   *  reset/turn hygiene: cancel the pending accumulated turn and seed the
   *  per-CHANNEL optimistic anchor with 0 so an immediate follow-up spin
   *  accumulates from the reset value (P2-3 shape). */
  private handleHueReset(): void {
    const focused = this.opts.getSnapshot().focused;
    const turnControlId = this.hueTurnControlId();
    if (turnControlId !== null) {
      this.coalescer.cancel(turnControlId);
      this.deltaFocusKey.delete(turnControlId);
    }
    if (!focused) {
      // Nothing focused (no channels on the mixer) — inert with a visible
      // note, never a guessed target.
      this.setStatus({ lastEvent: 'hue reset (no focused channel — inert)' });
      return;
    }
    if (turnControlId !== null) {
      const anchorKey = `${turnControlId}@${channelIdentity(focused)}`;
      this.optimisticValues.set(anchorKey, 0);
      // Snap-anchor = the channel hue we actually observe (P2-3 shape). When the
      // snapshot hasn't threaded it, the write target (0) IS the best observed
      // fact — the echo confirms it at distance 0.
      this.lastSnapAnchor.set(anchorKey, typeof focused.hue === 'number' ? focused.hue : 0);
    }
    this.setStatus({
      lastEvent: `hue ${focused.role === 'deck' ? 'deck' : `ch ${focused.layer + 1}`} reset → 0°`,
    });
    this.projectAndSend(); // ring + colour show the reset immediately
    void this.runDispatch({ kind: 'channelHue', role: focused.role, channelId: focused.id, degrees: 0 });
  }

  /** Flush a hue-turn window onto the FOCUSED CHANNEL's hue (BOTH contexts —
   *  hue is per-channel only). CLAMPED like every other param (Sina,
   *  2026-07-10: "not rotating around"): the knob sweeps 0°..360° with HARD
   *  STOPS at both ends — no circular wrap-around past the top or bottom. The
   *  top stop is held a hair under 360 so the engine's own wheel-wrap can't
   *  fold it back to 0 (360 ≡ 0 on the wheel). Optimistic-anchor semantics,
   *  anchored on `focused.hue` and keyed PER CHANNEL (`controlId@role:id`) so
   *  a focus switch lands on the new channel's own anchor slot — ring +
   *  accumulation re-sync to that channel's hue instead of dragging the old
   *  channel's value along. */
  private async flushChannelHueDelta(
    controlId: string,
    delta: number,
    capturedChannel: string | null | undefined,
  ): Promise<void> {
    const focused = this.opts.getSnapshot().focused;
    if (!focused) {
      this.forgetOptimistic(controlId);
      this.setStatus({ lastEvent: 'hue (no focused channel — knob inert)' });
      return;
    }
    const identity = channelIdentity(focused);
    // Mid-window focus guard (N3 shape): if focus moved to ANOTHER CHANNEL
    // between accumulate and flush, DROP the window rather than recolor the
    // newly focused channel.
    if (capturedChannel !== undefined && capturedChannel !== identity) {
      this.setStatus({ lastEvent: 'hue delta dropped (focus changed mid-turn)' });
      return;
    }
    if (typeof focused.hue !== 'number') {
      // The snapshot didn't thread this channel's hue — never anchor a write
      // on a fabricated 0 (it could yank an operator-set hue). Inert + visible.
      this.setStatus({ lastEvent: 'hue (channel hue not loaded yet — knob inert)' });
      return;
    }
    const anchorKey = `${controlId}@${identity}`;
    const anchor = this.circularOptimisticAnchor(anchorKey, focused.hue);
    // The window delta arrives PRE-CAPPED by the shared MAX_WINDOW_STEP in
    // flushResolved (identical speed contract to every other knob — Sina
    // 2026-07-10); hue is simply that unit value × 360.
    // Hard stops, no wrap: clamp to [0, ~360). 359.99 (not 360) at the top so
    // the engine's wheel-wrap can't fold the top stop back to 0.
    const degrees = Math.min(359.99, Math.max(0, anchor + delta * 360));
    this.optimisticValues.set(anchorKey, degrees);
    this.setStatus({
      lastEvent: `hue ${focused.role === 'deck' ? 'deck' : `ch ${focused.layer + 1}`} = ${Math.round(degrees)}°`,
    });
    this.projectAndSend(); // ring + colour track the optimistic per-channel hue now
    await this.runDispatch({ kind: 'channelHue', role: focused.role, channelId: focused.id, degrees });
  }

  // ── Driver #3 (VSN1) — selected-slot global-effects surface ─────────────────

  /** The live global-effect slot record for the SELECTED slot, or null when
   *  nothing is selected / the slot vanished from the snapshot. */
  private selectedSlotRecord():
    { slot: number; intensity?: number; intensityDefault?: number; mode?: string | number | boolean | null } | null {
    if (this.selectedSlot === null) return null;
    return this.opts.getSnapshot().globalEffectSlots.find((s) => s.slot === this.selectedSlot) ?? null;
  }

  /** Record the SELECTED slot (the last key pressed on THIS device). A change of
   *  selection re-LOCKS the jog's soft-takeover so the wheel must re-cross the new
   *  slot's live intensity before it writes — a stale wheel position never yanks
   *  the value on selection change. Re-arms the jog-without-selection debug log. */
  private selectSlot(slot: number): void {
    this.loggedJogWithoutSelection = false;
    if (slot === this.selectedSlot) return;
    this.selectedSlot = slot;
    this.intensityPickup = freshPickup(); // re-lock for the new slot's value
    this.setStatus({ lastEvent: `VSN1 slot ${slot} selected` });
  }

  /** VSN1 slot-key press — DRUM contract, the only behavior (Sina, 2026-07-10
   *  evening): pressing ANY key immediately fires that slot's behavior-aware
   *  action (toggle flips, trigger fires) AND snaps the LCD detail to it. No
   *  two-step select-then-commit anywhere — the two-view system is retired to
   *  ONE view (grid visual + drum behavior). Applies to the VSN1 path ONLY;
   *  UI taps in CaptainPad keep their own direct dispatch. */
  private handleVsn1SlotKey(resolved: ResolvedAction & { kind: 'globalEffectSlot' }): void {
    // PAGE-AWARE key → slot mapping (the "keys hit the wrong slot on page 2-4"
    // fix). The VSN1 profile pins each key to slot 1..8 (its key index k+1 on
    // page 0). The 32 flat slots are viewed 8 at a time, so a key on page p must
    // address flat slot 8*p + k + 1, following the ENGINE's effectsPage (the
    // single source of truth — the same value the outbound feedback projects).
    // We derive the page from the engine snapshot, NOT the note's MIDI channel:
    // the channel is a moving firmware detail (and the note match is anyChannel),
    // whereas effectsPage is authoritative and always present. On page 0 this is
    // the identity (slot 1..8), so nothing regresses there.
    const keyIndex = resolved.slot - 1;               // 0..7 (the physical key)
    const page = this.opts.getSnapshot().effectsPage ?? 0;
    const slot = page * 8 + keyIndex + 1;             // flat slot id 1..32
    // Dispatch the flat slot, not the raw page-0 slot.
    const flatResolved: ResolvedAction & { kind: 'globalEffectSlot' } = { ...resolved, slot };
    const behavior = this.opts.getSnapshot().globalEffectSlots.find((s) => s.slot === slot)?.behavior;
    // DRUM contract: pressing ANY key (even one that isn't the slot the LCD
    // currently details) IMMEDIATELY fires that slot AND snaps the LCD to it.
    // The select-cue moves the device's `sel` (grid border + detail line) so
    // the display follows the finger; the dispatch fires the slot's behavior
    // (toggle flips, trigger/hold fire) and we echo the new active state so
    // the ON marker + key LED update without waiting on the engine
    // round-trip. A trigger slot's momentary active is engine-owned — the
    // broadcast corrects it — but echoing the toggle flip keeps it snappy.
    this.selectSlot(slot);
    this.emitVsn1SelectCue(slot); // snap the LCD grid border + detail to the pressed slot
    const wasActive = !!this.opts.getSnapshot().globalEffectSlots.find((s) => s.slot === slot)?.active;
    this.setStatus({ lastEvent: `VSN1 slot ${slot} triggered` });
    void this.runDispatch(flatResolved).then((r) => {
      if (r.ok && behavior !== 'trigger') this.emitVsn1ActiveEcho(slot, !wasActive);
    });
  }

  /** Immediately send the VSN1 the active-LED feedback for one slot (the prompt
   *  toggle echo). Skipped when the slot isn't on the current page (its key
   *  isn't visible) or when the diff says that exact value was ALREADY sent
   *  (the engine broadcast beat us to it — no duplicate frame). Recorded into
   *  `vsn1FeedbackState` so the trailing broadcast's matching value is
   *  diff-suppressed; a disagreeing engine value still re-sends (engine wins). */
  private emitVsn1ActiveEcho(slot: number, active: boolean): void {
    const page = this.opts.getSnapshot().effectsPage ?? 0;
    const idx = slot - (page * 8 + 1);
    if (idx < 0 || idx > 7) return; // slot not on the visible page — no key to light
    const status = 0x90 | FB_ACTIVE_CH;
    const note = 32 + idx;
    const value = active ? 127 : 0;
    const key = `${status}:${note}`;
    if (this.vsn1FeedbackState[key] === String(value)) return; // already painted
    this.vsn1FeedbackState = { ...this.vsn1FeedbackState, [key]: String(value) };
    try {
      this.transport.send([status, note, value]);
    } catch {
      this.ledFailStreak += 1; // same fail-loud accounting as the feedback stream
    }
  }

  /** Emit the VSN1 SELECT CUE for the just-selected slot (the two-step "you're
   *  about to toggle THIS slot" signal). Sends the SELECTED key's index (0..7)
   *  on the current page, or the "none" sentinel when the selection is off the
   *  visible page (so the device clears its cue LED rather than pointing at a key
   *  that isn't showing). One-shot, NOT diffed into the steady feedback stream:
   *  a re-select of the same key must re-assert the cue, and it never means a
   *  slot went active (so it can't be mistaken for the active-LED echo). */
  private emitVsn1SelectCue(slot: number): void {
    const page = this.opts.getSnapshot().effectsPage ?? 0;
    const idx = slot - (page * 8 + 1); // 0..7 on-page, else off-page → cleared
    try {
      this.transport.send(vsn1SelectCueMessage(idx));
    } catch {
      this.ledFailStreak += 1; // same fail-loud accounting as the feedback stream
    }
  }

  /** VSN1 SMALL BUTTON (sb_0..sb_3) — the four small panel buttons. They NEVER
   *  change pages (the physical side button does, firmware-native); the host
   *  owns every action. Sina's layout (2026-07-10 evening):
   *    sb_0 → MODE:  cycle the SELECTED effect's discrete mode (same action as
   *                  the encoder press — a second, easier-to-hit mode button).
   *    sb_1 → VIEW:  toggle the LCD visual — grid (colors) ↔ full readout.
   *                  KEY BEHAVIOR IS DRUM IN BOTH (fire immediately); the view
   *                  is presentation only.
   *    sb_2 → DISABLED (banks shelved 2026-07-14): the multi-bank effects UX is
   *                  off (BANKS_UI_ENABLED=false), so sb_2 does NOTHING — see
   *                  handleVsn1BankButton, which early-returns behind the flag.
   *                  The bank-cycle path is preserved as a TODO.
   *    sb_3 → LOGO:  show the MarsinLED wordmark on the LCD (the welcome
   *                  screen; any next key press / feedback dismisses it).
   *  NOTE (highest priority, Sina 2026-07-10): the layout AUTO-DEPLOY must be
   *  made bulletproof (an effect swap in the UI failed to re-flash the device)
   *  and every re-flash must land back in this drum/grid state. */
  private handleVsn1SmallButton(button: number, timestampMs: number): void {
    if (button === 0) {
      this.setStatus({ lastEvent: 'VSN1 sb_0 → cycle mode' });
      this.handleModeCycle(); // same runtime path as the encoder press
      return;
    }
    if (button === 1) {
      // Simple per-press toggle — no click/double-click gesture (that
      // complexity died with the two-view behavior split; this is visual only).
      this.vsn1ViewMode = this.vsn1ViewMode === 'effect' ? 'drum' : 'effect';
      this.setStatus({ lastEvent: `VSN1 sb_1 → view: ${this.vsn1ViewMode === 'effect' ? 'GRID' : 'READOUT'}` });
      this.emitVsn1ViewMode();
      return;
    }
    if (button === 2) {
      this.handleVsn1BankButton(timestampMs);
      return;
    }
    // button === 3 — show the MarsinLED logo: the device's welcome screen is
    // driven by the hello CC (hi = 1 in the receiver); it holds until the next
    // key press / feedback frame dismisses it. A party flourish, not state.
    this.setStatus({ lastEvent: 'VSN1 sb_3 → MarsinLED logo' });
    try {
      this.transport.send(vsn1WelcomeMessage());
    } catch {
      this.ledFailStreak += 1; // same fail-loud accounting as the feedback stream
    }
  }

  /** Monotonic clock (ms) for the sb_2 guards — the injected `now` (deterministic
   *  tests) or performance.now() (the SAME clock Web MIDI event timestamps ride). */
  private nowMs(): number {
    return this.opts.now ? this.opts.now() : defaultNow();
  }

  /** Release the sb_2 in-flight lock (echo landed / POST failed / timed out). */
  private clearSb2InFlight(): void {
    this.sb2PatchInFlight = false;
    this.sb2PrevBankId = null;
  }

  /** VSN1 sb_2 → CYCLE to the next named effect bank, the ONLY bank cycler in
   *  CaptainPad — and the source of a live spurious-flip bug. Four guards reject
   *  every non-operator press before it POSTs, and EVERY accepted / dropped press
   *  is logged (with its drop reason) via the lastEvent status idiom so the next
   *  cycle is fully attributable. Guard order runs cheapest-and-most-diagnostic
   *  first: a stale replay and a self-echo are misfires that shouldn't even count
   *  as a press; in-flight + debounce collapse rapid repeats; the unseeded refusal
   *  is last (it needs the snapshot). No client-computed target, no optimistic
   *  switch: the engine cycles + broadcasts `effectBanks` and every surface
   *  converges on the echo. */
  private handleVsn1BankButton(timestampMs: number): void {
    // SHELVED 2026-07-14 (BANKS_UI_ENABLED=false): the multi-bank effects UX is
    // off, so sb_2 does NOTHING — it neither cycles a bank nor POSTs. The four
    // anti-spurious-flip guards + the accept/dispatch path below are KEPT intact
    // as a TODO (they document + protect the shelved feature). To restore bank
    // cycling: flip BANKS_UI_ENABLED (components/global_effect_macros_logic.ts)
    // AND re-enable sb_2 in midi_profiles/vsn1.yaml. The status line still names
    // the press so the operator sees the button is deliberately inert.
    if (!BANKS_UI_ENABLED) {
      this.setStatus({ lastEvent: 'VSN1 sb_2 disabled — banks shelved' });
      return;
    }
    const now = this.nowMs();

    // 1) STALE-EVENT GUARD. Web MIDI event timestamps ride performance.now()'s
    //    clock; Chrome QUEUES input for a backgrounded tab and replays it on
    //    refocus — an old queued sb_2 must not cycle the bank. A missing/zero
    //    timestamp (FakeTransport, transports that don't stamp) is treated as
    //    FRESH (never dropped) — we only reject a timestamp we can trust is old.
    if (timestampMs && timestampMs > 0 && now - timestampMs > SB2_STALE_MS) {
      this.setStatus({ lastEvent: `VSN1 sb_2 DROPPED — stale event (${Math.round(now - timestampMs)}ms old)` });
      return;
    }

    // 4) SELF-ECHO GUARD. Our OWN outbound page-2 side-LED feedback is a Note On
    //    on note 43 (SIDE_BASE + 2) — identical to the device's sb_2 note. A MIDI
    //    loopback echoes it straight back as an inbound "sb_2 press". If we sent
    //    that exact note within the loopback window, this inbound note is our echo,
    //    not a press. (Channel-tightening the binding is NOT viable: the firmware
    //    TXes small-button notes on channel = the current page — see
    //    side_button.lua — so there is no fixed device channel to pin to.)
    const echoTs = this.recentOutboundNotes.get(VSN1_SB_NOTE_BASE + 2);
    if (echoTs !== undefined && now - echoTs <= SB2_SELF_ECHO_MS) {
      this.setStatus({ lastEvent: `VSN1 sb_2 DROPPED — self-echo (own LED feedback, ${Math.round(now - echoTs)}ms)` });
      return;
    }

    // 2a) IN-FLIGHT GUARD. A bank-cycle POST is already round-tripping (awaiting the
    //     WS `effectBanks` echo); a second press here would cycle again off a stale
    //     snapshot. Held until the echo lands / the POST fails, with a safety
    //     timeout so a lost echo can never wedge sb_2 dead.
    if (this.sb2PatchInFlight && now - this.sb2InFlightSince < SB2_INFLIGHT_TIMEOUT_MS) {
      this.setStatus({ lastEvent: 'VSN1 sb_2 DROPPED — bank cycle in flight (awaiting echo)' });
      return;
    }
    if (this.sb2PatchInFlight) this.clearSb2InFlight(); // in-flight lock timed out

    // 2b) DEBOUNCE. A mechanical double-tap / contact bounce AFTER the echo cleared
    //     the in-flight lock still lands within a few hundred ms — swallow it.
    if (this.sb2LastAcceptedMs !== 0 && now - this.sb2LastAcceptedMs < SB2_DEBOUNCE_MS) {
      this.setStatus({ lastEvent: `VSN1 sb_2 DROPPED — debounce (${Math.round(now - this.sb2LastAcceptedMs)}ms since last)` });
      return;
    }

    // 3) REFUSE-UNSEEDED. Without a seeded active bank there is no known pre-cycle
    //    id to converge against — cycling blind is a fallback, which is forbidden.
    //    Refuse loudly and wait for the engine to thread the banks.
    const current = this.opts.getSnapshot().activeBankId;
    if (typeof current !== 'string' || current === '') {
      this.setStatus({ lastEvent: 'VSN1 sb_2 IGNORED — banks unseeded/empty (engine not seeded)' });
      return;
    }

    // ACCEPT. Arm the debounce + in-flight guards, record the pre-cycle bank id for
    // echo convergence, then POST the atomic next-bank cycle with the 'vsn1_sb2'
    // provenance tag. A failed POST releases the in-flight lock at once (fail-loud,
    // retry allowed); a success holds it until the echo (a changed activeBankId)
    // converges.
    this.sb2LastAcceptedMs = now;
    this.sb2PatchInFlight = true;
    this.sb2InFlightSince = now;
    this.sb2PrevBankId = current;
    this.setStatus({ lastEvent: 'VSN1 sb_2 ACCEPTED → bank cycle (next)' });
    void this.runDispatch({ kind: 'effectBankNext' }).then((result) => {
      if (!result.ok) this.clearSb2InFlight();
    });
  }

  /** Send the VSN1 the VIEW render-selector CC (1 = grid visual, 0 = full
   *  readout; toggled by sb_1, default grid). One-shot, NOT diffed into the
   *  steady feedback stream; the full re-sync re-emits it so the device
   *  rebuilds `vm` after its VM is wiped on a page change. Key behavior is
   *  DRUM regardless of this — the view is presentation only. */
  private emitVsn1ViewMode(): void {
    if (this.profile.device.id !== 'vsn1') return;
    try {
      this.transport.send(vsn1ViewModeMessage(viewModeCcValue(this.vsn1ViewMode)));
    } catch {
      this.ledFailStreak += 1; // same fail-loud accounting as the feedback stream
    }
  }

  /** VSN1 jog turn (absolute) → coalesce onto the SELECTED slot's intensity. Ignored
   *  (with a once-logged debug note) until a slot key has been pressed — before any
   *  selection there is no target (defined behavior, never a guessed slot). */
  private handleIntensityAbs(controlId: string, value: number): void {
    if (this.selectedSlot === null) {
      if (!this.loggedJogWithoutSelection) {
        this.loggedJogWithoutSelection = true;
        // eslint-disable-next-line no-console
        console.debug('[MIDI] VSN1 jog ignored — no slot selected yet (press a key first)');
      }
      return;
    }
    // Coalesced last-write-wins (absolute position), flushed at ~30 Hz.
    this.coalescer.push(controlId, { kind: 'effectIntensityAbs', value });
  }

  /** Flush the coalesced VSN1 jog value onto the SELECTED slot's intensity through
   *  the soft-takeover pickup guard. The wheel stays LOCKED (swallowed) until its
   *  position crosses the slot's live intensity, then tracks — so a selection
   *  change (which re-locks in selectSlot) can't jump the value from a stale wheel
   *  position. Seeds the pickup crossing from the slot's snapshot `intensity`;
   *  inert (never a fabricated anchor) while that hasn't threaded through. */
  private async flushEffectIntensity(value: number): Promise<void> {
    const rec = this.selectedSlotRecord();
    if (this.selectedSlot === null || !rec) {
      // Selection cleared / slot vanished between accumulate and flush — drop it.
      this.setStatus({ lastEvent: 'VSN1 jog (no selected slot — inert)' });
      return;
    }
    if (typeof rec.intensity !== 'number') {
      // The snapshot hasn't threaded this slot's intensity — never anchor the
      // pickup crossing on a fabricated value. Inert + visible until it loads.
      this.setStatus({ lastEvent: `VSN1 slot ${rec.slot} intensity not loaded yet — jog inert` });
      return;
    }
    const { write, next } = pickup(this.intensityPickup, rec.intensity, value);
    this.intensityPickup = next;
    if (!write) {
      this.setStatus({ lastEvent: `VSN1 slot ${rec.slot} intensity = ${value.toFixed(2)} (locked)` });
      return; // locked — swallow until the wheel picks up the slot's value
    }
    this.setStatus({ lastEvent: `VSN1 slot ${rec.slot} intensity = ${value.toFixed(2)}` });
    await this.runDispatch({ kind: 'effectIntensitySlot', slotId: rec.slot, value });
  }

  /** VSN1 jog PRESS → reset the SELECTED slot's intensity to its default. Inert
   *  (visible note) when nothing is selected. Unlocks the jog's pickup (a reset is
   *  a deliberate jump) so the next turn tracks from the reset value rather than
   *  staying locked. */
  private handleIntensityReset(): void {
    const rec = this.selectedSlotRecord();
    if (this.selectedSlot === null || !rec) {
      this.setStatus({ lastEvent: 'VSN1 jog reset (no selected slot — inert)' });
      return;
    }
    // A reset is an intentional jump: unlock the pickup, anchored on the default
    // (the value the wheel now conceptually sits at) so a follow-up turn tracks.
    this.intensityPickup = { locked: false, last: rec.intensityDefault ?? null };
    this.setStatus({ lastEvent: `VSN1 slot ${rec.slot} intensity reset` });
    void this.runDispatch({ kind: 'effectIntensitySlotReset', slotId: rec.slot });
  }

  /** VSN1 encoder PRESS → cycle the SELECTED slot's discrete `primaryMode` to its
   *  next value (Effects v2 — replaces the old press=intensity-reset). Inert (with
   *  a visible note) when nothing is selected: before any key press there is no
   *  target, so the press is IGNORED — never a guessed slot. The engine owns the
   *  value ring and broadcasts the new mode; the runtime just fires the cycle. */
  private handleModeCycle(): void {
    const rec = this.selectedSlotRecord();
    if (this.selectedSlot === null || !rec) {
      this.setStatus({ lastEvent: 'VSN1 mode cycle (no selected slot — inert)' });
      return;
    }
    this.setStatus({ lastEvent: `VSN1 slot ${rec.slot} mode cycle` });
    void this.runDispatch({ kind: 'effectModeCycleSlot', slotId: rec.slot });
  }

  /** Coalescer flush for a resolved payload. Most payloads dispatch directly; the
   *  MFT relative-delta payloads are resolved HERE against the live focused/CPC
   *  value (they can't be dispatched — they carry a delta, not a value) into a
   *  concrete localParam / paramCenter write. Applying at flush time (not at
   *  accumulate time) means the delta lands on the value as it is NOW, even if a
   *  modulator or another surface moved it during the window. */
  private async flushResolved(controlId: string, payload: ResolvedAction): Promise<void> {
    // lastEvent status updates move to FLUSH cadence (12b): the coalescer feeds
    // us ~30 Hz, so recording the monitor line here — instead of at raw MIDI
    // rate — keeps React consumers from re-rendering >100/s. Error/inert-note
    // status still fires immediately inside the branches below.
    //
    // THE shared speed ceiling (Sina 2026-07-10): every relative knob controls
    // a 0..1 parameter, so every window sum is capped at the SAME
    // MAX_WINDOW_STEP — identical top speed for locals, the speed knob, AND
    // hue (hue is just unit × 360 downstream). Applied ONCE here so the three
    // branches below cannot drift apart.
    if (
      (payload.kind === 'focusedParamDelta' || payload.kind === 'paramCenterDelta'
        || payload.kind === 'hueDelta')
      && Number.isFinite(payload.delta)
    ) {
      payload = {
        ...payload,
        delta: Math.max(-MAX_WINDOW_STEP, Math.min(MAX_WINDOW_STEP, payload.delta)),
      };
    }
    if (payload.kind === 'focusedParamDelta') {
      const capturedKey = this.deltaFocusKey.get(controlId);
      this.deltaFocusKey.delete(controlId);
      const focused = this.opts.getSnapshot().focused;
      if (!focused) { this.forgetOptimistic(controlId); return; } // nothing focused — dropped
      // N3: if focus moved between accumulate and flush, DROP the payload rather
      // than write the delta into the new channel's same-index param.
      if (capturedKey !== undefined && capturedKey !== focused.key) {
        this.forgetOptimistic(controlId);
        this.setStatus({ lastEvent: 'delta dropped (focus changed mid-turn)' });
        return;
      }
      const exp = focused.exports[payload.index];
      if (!exp) { this.forgetOptimistic(controlId); return; } // no param behind this knob
      // Anchor on the modulation BASE, not the moving modulated value (`v0` is
      // post-modulation; anchoring there fights the modulation). `base` is the
      // operator's set value; unmodulated params omit it (base === v0).
      const snapAnchor = exp.base ?? exp.v0;
      const anchor = this.optimisticAnchor(controlId, snapAnchor);
      // The delta was already velocity-gained PER TICK at accumulate time
      // (accel.ts); the window sum applies as-is.
      const value = clampUnit(anchor + payload.delta);
      this.optimisticValues.set(controlId, value); // seed the next window's anchor
      this.optimisticFocusKey.set(controlId, focused.key); // ring overlay is per-focus
      this.setStatus({ lastEvent: `knob ${exp.name} = ${value.toFixed(2)}` });
      // Repaint NOW so the ring tracks the optimistic value during the sweep
      // instead of lagging the engine echo round-trip and catching up after.
      this.projectAndSend();
      await this.runDispatch({
        kind: 'localParam', role: focused.role, channelId: focused.id, exportId: exp.id, value,
      });
      return;
    }
    if (payload.kind === 'paramCenterDelta') {
      const snap = this.opts.getSnapshot();
      // Sync gate at shared depth (#4): while the engine drives this key itself
      // (e.g. `speed` under BPM→Speed sync) it is INERT — a write would be
      // clobbered on the next tick. syncOwnedKeys is the ONE home of this rule
      // (contract I4), shared with the absolute paramCenter path below.
      if ((snap.syncOwnedKeys ?? EMPTY_SYNC_OWNED_KEYS).has(payload.key)) {
        this.forgetOptimistic(controlId);
        this.setStatus({ lastEvent: `${payload.key} (engine sync owns it — knob inert)` });
        return;
      }
      // P2-1: the values map is UNDEFINED until the first engine sharedParams
      // frame. Twisting a bank-2 knob during the WS handshake must NOT sticky-red
      // (which would freeze projectAndSend + every LED for the rest of the set,
      // recoverable only by a physical replug). A not-yet-loaded map is a benign
      // boot race → inert with a note, stay `connected`; the value will arrive.
      if (snap.globalParamValues === undefined) {
        this.forgetOptimistic(controlId);
        this.setStatus({ lastEvent: `${payload.key} (param values not loaded yet — knob inert)` });
        return;
      }
      const cur = snap.globalParamValues[payload.key];
      if (typeof cur !== 'number') {
        // The map IS loaded but this key is missing from the live schema — a real
        // (non-fatal) config error, aggregated + surfaced like validateProfileParams
        // so OTHER controls keep working and the controller stays `connected`
        // (never sticky-error → never freezes LEDs). Auto-clears if the key
        // later appears (the schema can change mid-set).
        this.forgetOptimistic(controlId);
        this.noteRuntimeParamError(payload.key);
        return;
      }
      this.clearRuntimeParamError(payload.key); // key present now → drop any stale flag
      const anchor = this.optimisticAnchor(controlId, cur);
      // Same per-tick velocity gain as the local-param knobs (already applied
      // at accumulate time — global speed sweeps must feel identical).
      const value = clampUnit(anchor + payload.delta);
      this.optimisticValues.set(controlId, value);
      this.setStatus({ lastEvent: `${payload.key} = ${value.toFixed(2)}` });
      this.projectAndSend(); // ring tracks the optimistic value, not the echo
      await this.runDispatch({ kind: 'paramCenter', key: payload.key, value });
      return;
    }
    if (payload.kind === 'hueDelta') {
      // Sina's ruling (2026-07): the hue knob targets the FOCUSED CHANNEL's
      // per-channel hue in BOTH contexts — the DECK CHANNEL on the deck tab,
      // the focused overlay on the mixer tab. There is NO global hue shifter
      // any more. The captured mid-window channel guard is consumed here.
      const capturedChannel = this.deltaFocusKey.get(controlId);
      this.deltaFocusKey.delete(controlId);
      await this.flushChannelHueDelta(controlId, payload.delta, capturedChannel);
      return;
    }
    if (payload.kind === 'effectIntensityAbs') {
      // Driver #3 (VSN1): flush the coalesced absolute jog value onto the SELECTED
      // slot's intensity, gated by soft-takeover so a stale wheel position can't
      // yank the value after a selection change. Applying at FLUSH time (not on
      // every raw CC) means the write lands on the slot's value as it is NOW.
      await this.flushEffectIntensity(payload.value);
      return;
    }
    // Absolute paramCenter (e.g. the APC's fader 7) shares the sync gate (#4):
    // syncOwnedKeys is the ONE home of the rule, so an absolute fader on a
    // sync-owned key is inert too (it was UNGATED before — the engine clobbered
    // it every BPM tick). setStatus an inert note so the operator sees why.
    if (payload.kind === 'paramCenter' && (this.opts.getSnapshot().syncOwnedKeys ?? EMPTY_SYNC_OWNED_KEYS).has(payload.key)) {
      this.setStatus({ lastEvent: `${payload.key} (engine sync owns it — fader inert)` });
      return;
    }
    // 12b: record the monitor line for a coalesced continuous control at FLUSH
    // cadence (not raw MIDI rate).
    this.setStatus({ lastEvent: describeFlush(payload) });
    await this.runDispatch(payload);
  }

  /** Record a runtime "key missing from the LOADED schema" error (P2-1). Merges
   *  into the surfaced set (non-fatal, stays `connected`) only when NEW, so a
   *  knob spam doesn't renotify. The Config-tab banner reads status.paramErrors,
   *  so we surface through the SAME shape (controlId = the key). */
  private noteRuntimeParamError(key: string): void {
    if (this.runtimeParamErrors.has(key)) return;
    this.runtimeParamErrors.add(key);
    this.setStatus({
      lastEvent: `${key} (not in engine schema — knob inert)`,
      paramErrors: this.mergedParamErrors(),
    });
  }

  /** Drop a key from the runtime error set once it appears in the schema (P2-1
   *  auto-clear). Refreshes the surfaced set only when it actually changes. */
  private clearRuntimeParamError(key: string): void {
    if (!this.runtimeParamErrors.delete(key)) return;
    this.setStatus({ paramErrors: this.mergedParamErrors() });
  }

  /** Combine the connect-time profile param errors (validateProfileParams) with
   *  the runtime "vanished from schema" keys into one aggregate for the status.
   *  undefined when empty (keeps the Config-tab banner hidden). */
  private mergedParamErrors(): ParamKeyError[] | undefined {
    const runtime = [...this.runtimeParamErrors].map((key) => ({ controlId: key, key }));
    const all = [...(this.profileParamErrors ?? []), ...runtime];
    return all.length ? all : undefined;
  }

  /** Forget the optimistic anchor for a control (on inert/dropped flush, so the
   *  next window re-seeds from the snapshot). */
  private forgetOptimistic(controlId: string): void {
    this.optimisticValues.delete(controlId);
    this.lastSnapAnchor.delete(controlId);
    this.optimisticFocusKey.delete(controlId);
  }

  /** Resolve the anchor for a relative-delta window (#3 fast-turn undershoot).
   *  Returns the LOCAL optimistic value while the snapshot is merely lagging our
   *  own writes (the throttled modulationState echo), and re-seeds from the
   *  snapshot only when it JUMPED on its own — an external write / reset /
   *  modulator step.
   *
   *  The discriminator is the snapshot's own MOVEMENT since we last saw it, NOT
   *  the gap to our optimistic value: during a fast sweep the echo lag makes
   *  that gap large yet the snapshot is only creeping toward us, so re-seeding on
   *  the gap would reintroduce the undershoot. A snapshot that moved more than
   *  epsilon between windows is an external change we must adopt. */
  /** CIRCULAR twin of optimisticAnchor for hue angles (per-channel-keyed
   *  entries — one wrap/reseed rule): keep the local
   *  optimistic value while the snapshot merely creeps toward it (throttled
   *  echo), re-seed when it JUMPED beyond the circular epsilon (an external
   *  write / reset). Distances are circular (359°→1° is a 2° creep, not 358°). */
  private circularOptimisticAnchor(key: string, snapDegrees: number): number {
    const optimistic = this.optimisticValues.get(key);
    const prevSnap = this.lastSnapAnchor.get(key);
    this.lastSnapAnchor.set(key, snapDegrees);
    return optimistic === undefined || prevSnap === undefined
      || circularDegreesDistance(snapDegrees, prevSnap) > HUE_RESEED_EPSILON_DEG
      ? snapDegrees
      : optimistic;
  }

  private optimisticAnchor(controlId: string, snapValue: number): number {
    const optimistic = this.optimisticValues.get(controlId);
    const prevSnap = this.lastSnapAnchor.get(controlId);
    this.lastSnapAnchor.set(controlId, snapValue);
    if (optimistic === undefined || prevSnap === undefined) return snapValue;
    // Echo creep / in-span echo → keep accumulating locally; a genuine external
    // jump (shared classifier `isExternalSnapshotJump`) → adopt the snapshot.
    return isExternalSnapshotJump(prevSnap, optimistic, snapValue) ? snapValue : optimistic;
  }

  /** RING-DISPLAY twin of optimisticAnchor: the value the ring should show for
   *  a relative-knob target — the LOCAL optimistic value while the engine echo
   *  is still catching up to our own writes (so a fast sweep's ring tracks the
   *  knob, not the ~150 ms-lagging snapshot), the SNAPSHOT otherwise. Unlike
   *  the flush anchor it never records a new snap-anchor (observation cadence
   *  stays at flush cadence — observing at repaint rate would make every
   *  external move look like sub-epsilon creep and freeze the ring). Two ways
   *  the optimistic entry dies here (both mirror what the next flush would
   *  decide anyway, so display and flush can never disagree):
   *    - the echo LANDED (snapshot within the settle tolerance of the
   *      optimistic value) → the entry has served its purpose, forget it so a
   *      later external move is followed immediately;
   *    - the snapshot JUMPED externally (shared classifier) → trust the
   *      snapshot and forget the entry. */
  private optimisticDisplayValue(key: string, snapValue: number): number {
    const optimistic = this.optimisticValues.get(key);
    const prevSnap = this.lastSnapAnchor.get(key);
    if (optimistic === undefined || prevSnap === undefined) return snapValue;
    if (Math.abs(snapValue - optimistic) <= OPTIMISTIC_SETTLE_EPSILON
      || isExternalSnapshotJump(prevSnap, optimistic, snapValue)) {
      this.forgetOptimistic(key);
      return snapValue;
    }
    return optimistic;
  }

  /** CIRCULAR twin of optimisticDisplayValue for hue rings (per-channel
   *  keys). Consistent with circularOptimisticAnchor: distances are
   *  circular and there is no span classification — a snapshot move beyond the
   *  circular epsilon re-seeds (here: forgets), a smaller move is echo creep
   *  and the optimistic degrees keep showing. Settle rule as in the linear
   *  twin: once the echo lands on the optimistic value, forget the entry. */
  private circularOptimisticDisplayDegrees(key: string, snapDegrees: number): number {
    const optimistic = this.optimisticValues.get(key);
    const prevSnap = this.lastSnapAnchor.get(key);
    if (optimistic === undefined || prevSnap === undefined) return snapDegrees;
    if (circularDegreesDistance(snapDegrees, optimistic) <= HUE_SETTLE_EPSILON_DEG
      || circularDegreesDistance(snapDegrees, prevSnap) > HUE_RESEED_EPSILON_DEG) {
      this.forgetOptimistic(key);
      return snapDegrees;
    }
    return optimistic;
  }

  /** Handle a focusChannel track-button press — a MIDI focus intent. Routes
   *  through the single focus-intent writer (I2) so touch + MIDI share one
   *  source of truth. */
  private handleFocus(layer: number): void {
    this.setFocusIntent(layer);
  }

  /** THE one derived reader of the effective focus layer. Returns the layer LED
   *  paint + the binding gate should treat as focused, and — critically —
   *  CLEARS a stale `requestedFocusLayer` as a side effect when the request is
   *  no longer meaningful: the snapshot already matches it (settle done) OR the
   *  requested layer no longer exists (an overlay was deleted). Without this the
   *  request only ever cleared inside applyBinding, so a touch/side-button focus
   *  that no bound fader follows stayed PERMANENTLY stale and swallowed every
   *  later mixer binding (#2). All three readers go through here. */
  private effectiveFocusLayer(snap: MidiEngineSnapshot): number {
    const snapLayer = snap.focused?.layer ?? -1;
    if (this.requestedFocusLayer !== -1) {
      if (this.requestedFocusLayer === snapLayer || !layerInfo(snap, this.requestedFocusLayer)) {
        this.requestedFocusLayer = -1; // settled or gone → drop the request
      }
    }
    return this.requestedFocusLayer !== -1 ? this.requestedFocusLayer : snapLayer;
  }

  /** Apply a MIDI-learned binding for the focused channel. Returns true when
   *  the event matched an enabled binding (consumed it), false otherwise.
   *  Soft-takeover ("pickup") keeps the param from jumping after a focus /
   *  pattern switch — the fader must cross the current value before it writes. */
  private applyBinding(decoded: DecodedMidi): boolean {
    const focused = this.opts.getSnapshot().focused;
    if (!focused) return false;
    const binding = focused.midiMappings.find(
      (b) => b.enabled && bindingMatches(b.control, decoded),
    );
    if (!binding) return false;

    // Focus/snapshot staleness gate (mixer only): a focus intent sets
    // `requestedFocusLayer` synchronously, but the snapshot's focused layer
    // swaps in async (onFocusChange → React → refetch). Until it catches up a
    // fader would write to the OLD channel — so swallow (locked) while they
    // disagree. effectiveFocusLayer clears the request once it settles/goes
    // (the single source of truth, #2). On the deck the single channel is
    // always focused, so the request is either -1 or 0 and never diverges.
    if (focused.role === 'mixer') {
      const eff = this.effectiveFocusLayer(this.opts.getSnapshot());
      if (eff !== -1 && focused.layer !== eff) {
        this.setStatus({ lastEvent: `bind (focus settling → ch ${eff})` });
        return true; // consumed; no write until the snapshot catches up
      }
    }

    // Re-lock every binding when the focus identity changes — focus channel OR
    // active entry OR its mapping set. The identity `key` is built ONCE in the
    // hook (role:id:entryId:mappingIds); a single string compare here, no
    // per-event allocation.
    if (focused.key !== this.lastFocusKey) {
      this.pickupStates.clear();
      this.lastFocusKey = focused.key;
    }

    // Resolve the bound param to a live export on the focused pattern. If the
    // pattern doesn't declare it, the fader is inert here — loud silence.
    const exp = focused.exports.find((e) => e.name === binding.target.parameter);
    const cap = controlRefFromEvent(decoded);
    // P3-3: clamp the learned write to the unit interval like the delta/reset
    // paths do. `binding.range` can exceed [0, 1] (the engine allows ±4), and a
    // localParam export is a unit value — writing an unclamped scaled value was
    // the one write path that skipped clampUnit.
    const value = clampUnit(scaleMidiToRange(cap ? cap.value : 0, binding.range));
    if (!exp) {
      // The binding matched but its param isn't on the focused pattern —
      // LOUD SILENCE: the fader does nothing (no write) but is still owned by
      // the binding. Returning true is safe now that learn-capture rejects any
      // control that resolves to a profile action (see onMessage §1.1): a bound
      // control can never also be a profile action, so swallowing it here can't
      // mask one. It only ever affects a genuinely-learned fader whose current
      // pattern lacks the param.
      this.setStatus({ lastEvent: `bind ${binding.target.parameter} (not on pattern)` });
      return true;
    }

    // Discrete NOTE bindings (a learned pad) are an INTENTIONAL jump — bypass
    // pickup so they write immediately (a pad press can never "cross" a value,
    // so pickup would leave it permanently dead). Keep soft-takeover for CC.
    if (cap && !cap.continuous) {
      // A note press unlocks its pickup slot too, so a following CC (if the
      // same binding were ever a CC) starts tracking, not locked.
      this.pickupStates.set(binding.id, { locked: false, last: value });
      this.setStatus({ lastEvent: `bind ${binding.target.parameter} = ${value.toFixed(2)}` });
      this.coalescer.push(`bind:${binding.id}`, {
        kind: 'localParam', role: focused.role, channelId: focused.id, exportId: exp.id, value,
      });
      return true;
    }

    const state = this.pickupStates.get(binding.id) ?? freshPickup();
    const wasLocked = state.locked;
    // Compare against the modulation BASE, not the moving modulated value:
    // for an audio-modulated param `v0` oscillates so the fader can never
    // reliably "cross" it and pickup never unlocks. `base` is the operator's
    // set value; unmodulated params omit it (base === v0). Consistent with the
    // delta path's anchor (#5).
    const { write, next } = pickup(state, exp.base ?? exp.v0, value);
    this.pickupStates.set(binding.id, next);
    this.setStatus({
      lastEvent: `bind ${binding.target.parameter} = ${value.toFixed(2)}${next.locked ? ' (locked)' : ''}`,
    });
    if (wasLocked !== next.locked) this.projectAndSend(); // repaint lock/focus LEDs
    if (!write) return true; // locked — swallow until the fader picks up

    this.coalescer.push(`bind:${binding.id}`, {
      kind: 'localParam', role: focused.role, channelId: focused.id, exportId: exp.id, value,
    });
    return true;
  }

  /** Is the focused channel currently pickup-LOCKED? True when any binding on
   *  the current focus has a locked pickup slot (drives the focus LED blink).
   *  Also true while the mixer focus snapshot is still settling (a fader would
   *  be swallowed), so the operator sees "not ready" rather than a dark button. */
  private isFocusLocked(): boolean {
    const snap = this.opts.getSnapshot();
    const focused = snap.focused;
    if (!focused) return false;
    if (focused.role === 'mixer') {
      const eff = this.effectiveFocusLayer(snap);
      if (eff !== -1 && focused.layer !== eff) return true;
    }
    // Only the current focus's pickup slots are meaningful (they were cleared
    // on the last focus-identity change).
    if (focused.key !== this.lastFocusKey) return false;
    for (const b of focused.midiMappings) {
      if (this.pickupStates.get(b.id)?.locked) return true;
    }
    return false;
  }

  /** The layer LED paint should treat as focused — the single derived reader
   *  (also clears a settled/gone request as a side effect, #2). */
  private getRequestedFocusLayer(): number {
    return this.effectiveFocusLayer(this.opts.getSnapshot());
  }

  private handleScroll(layer: number, dir: 'up' | 'down'): void {
    const snap = this.opts.getSnapshot();
    const L = layerInfo(snap, layer);
    if (!L) return; // layer absent → column is dark, no-op
    const len = L.playlist?.entries.length ?? 0;
    const max = Math.max(0, len - WINDOW_SIZE);
    const cur = this.windowCursor.get(layer) ?? 0;
    const next = dir === 'up' ? Math.max(0, cur - 1) : Math.min(max, cur + 1);
    if (next === cur) return;
    // Claim the auto-follow baseline for the CURRENT active entry: the operator
    // is now browsing, so a projection tick that lands between this scroll and
    // the next GENUINE active-entry change must read "no change" and leave the
    // browse put — never re-centre it back onto what's playing. (Only seed a
    // RESOLVABLE active entry; an unresolved one leaves the baseline alone so it
    // isn't fabricated.) Only a later switch to a DIFFERENT entry re-centres.
    const activeId = L.playlist?.activeEntryId ?? null;
    if (activeId !== null && L.playlist!.entries.some((e) => e.id === activeId)) {
      this.lastActiveIdByLayer.set(layer, activeId);
    }
    this.windowCursor.set(layer, next);
    this.opts.onWindowChange?.(L.id, next, WINDOW_SIZE);
    this.projectAndSend(); // repaint the window
  }

  /** Advance each layer's browse-window follow baseline on an active-entry change,
   *  and recenter the window around the new entry ONLY when that change came from a
   *  CaptainPad list UI tap (operator policy 2026-07). Runs at the top of
   *  projectAndSend (every engine repaint). Every NON-UI-tap source — APC
   *  pad-select, autopilot advance, engine/cross-tab echo — advances the baseline
   *  (so a later tick can't catch up and jump) but leaves the window EXACTLY where
   *  the operator has it; it never even republishes (a same-start republish mints a
   *  fresh window object that retriggers the list auto-scroll — the observed
   *  "jump"). The one exception is the FIRST resolvable active entry per layer,
   *  which establishes the window once (at the current cursor, no recenter) so the
   *  UI shows a browse rectangle and the pads map. A manual pad-scroll (handleScroll)
   *  moves + sticks on its own path.
   *
   *  Change detection is by entry ID and TOLERATES a transient unresolved active
   *  entry (a playlist refresh swapping the entries array, or a null between
   *  selections): an unresolved active holds the window and is NOT recorded as
   *  the baseline, so its return to the SAME entry is a no-op rather than a
   *  spurious "change" that stomps the operator's browse (the 2026-07 desync
   *  root cause — an index-keyed baseline flickered to -1 and back). */
  private syncWindowsToActiveEntries(snap: MidiEngineSnapshot): void {
    // Only the active context's layers own a window (layerInfo returns null for
    // the rest): deck context = layer 0, mixer = the overlay layers.
    const layerCount = snap.activeContext === 'deck' ? 1 : snap.layers.length;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const L = layerInfo(snap, layer);
      if (!L?.playlist) continue;
      const entries = L.playlist.entries;
      const activeId = L.playlist.activeEntryId;
      // Unresolved active (null, or not in the current entries array mid-refresh)
      // → hold the window, DON'T touch the baseline. The last known id stays, so
      // when the same entry resolves again it reads as unchanged.
      const activeIndex = activeId == null ? -1 : entries.findIndex((e) => e.id === activeId);
      if (activeIndex < 0) continue;
      // Was this activation requested by a CaptainPad list UI TAP? That is the
      // ONLY source allowed to recenter the window (operator policy 2026-07).
      // Consume the marker whenever its entry becomes current (changed or not) so a
      // stale request can't later hijack an autopilot/echo change to the same id.
      const uiTap = this.uiTapRecenterByChannel.get(L.id) === activeId;
      if (uiTap) this.uiTapRecenterByChannel.delete(L.id);
      const known = this.lastActiveIdByLayer.has(layer);
      if (activeId === this.lastActiveIdByLayer.get(layer)) continue; // unchanged → leave the browse put
      this.lastActiveIdByLayer.set(layer, activeId);
      if (uiTap) {
        // UI list tap on a (possibly out-of-window) pattern → recenter the window
        // around it, exactly as before. This is the sole recentering path.
        const cur = this.windowCursor.get(layer) ?? 0;
        const next = recenterWindowStart({
          activeIndex, currentStart: cur, size: WINDOW_SIZE, length: entries.length,
        });
        this.windowCursor.set(layer, next);
        this.opts.onWindowChange?.(L.id, next, WINDOW_SIZE);
        continue;
      }
      // Any OTHER source (APC pad-select, autopilot advance, engine/cross-tab
      // echo): advance the follow baseline (done above) so a later tick can't
      // catch up and jump, but DON'T move OR republish the window — the operator's
      // browse stays exactly where it is. A same-start republish is NOT harmless
      // here: onWindowChange mints a fresh window object that retriggers the
      // PlaylistPanel list auto-scroll (the observed "jump"). EXCEPTION: the FIRST
      // time this layer sees a resolvable active entry, establish the window once
      // (at the current cursor, no recenter) so the UI shows a browse rectangle and
      // the pads map.
      if (!known) {
        this.opts.onWindowChange?.(L.id, this.windowCursor.get(layer) ?? 0, WINDOW_SIZE);
      } else {
        // A DIFFERENT entry took over from a non-UI source — drop any stale UI-tap
        // marker for this channel so it can't recenter on a future coincidental
        // activation of that id.
        this.uiTapRecenterByChannel.delete(L.id);
      }
    }
  }

  /** Called by the CaptainPad list UI (PlaylistPanel.handleEntryTap, via the
   *  `noteMidiPatternSelect` bridge in useMidiControl) when the OPERATOR taps a
   *  pattern row with mouse/touch. This is the ONLY source that may recenter the
   *  browse window around the newly-active entry; every other active-entry change
   *  leaves the window put (operator policy 2026-07). Records the tapped entry per
   *  channel; syncWindowsToActiveEntries recenters when that entry's echo lands. */
  noteUiPatternSelect(channelId: string, entryId: string): void {
    this.uiTapRecenterByChannel.set(channelId, entryId);
  }

  private handleWindowSelect(layer: number, slot: number): void {
    const snap = this.opts.getSnapshot();
    const L = layerInfo(snap, layer);
    if (!L?.playlist) return;
    const entry = L.playlist.entries[(this.windowCursor.get(layer) ?? 0) + slot];
    if (!entry) return; // pad past the end of the playlist — no-op
    // NB: a pad-select does NOT recenter the window (it targets an in-window entry
    // already). It sets NO uiTapRecenterByChannel marker, so syncWindows advances
    // the follow baseline on its echo but leaves the window put — the default for
    // every non-UI-tap source (operator policy 2026-07).
    // Direct api call (not a ResolvedAction), but its result is surfaced through
    // the same fail-loud path (P2-5) so a failed entry select isn't silent.
    void this.opts.api.setChannelPlaylistEntry(L.role, L.id, entry.id)
      .then((r) => this.surfaceApiResult('playlistWindowSelect', r));
  }

  /** Recompute LED diffs against the current snapshot and send them. */
  projectAndSend(): void {
    if (this.status.kind !== 'connected') return;
    const snap = this.opts.getSnapshot();
    // sb_2 in-flight release: this runs on every engine update (onEngineUpdate →
    // projectAndSend), so the WS `effectBanks` echo lands here. When the snapshot's
    // activeBankId has CHANGED off the pre-cycle id we recorded, the cycle has
    // converged (any change = the echo) — release the in-flight lock so the next
    // legitimate press is accepted (the debounce still guards a too-fast repeat).
    if (this.sb2PatchInFlight && this.sb2PrevBankId !== null
        && snap.activeBankId !== this.sb2PrevBankId) {
      this.clearSb2InFlight();
    }
    // Keep the browse window centred on what's playing BEFORE we read the cursor
    // for the LED projection below, so the pads and the published UI highlight
    // both reflect the follow in the same frame.
    this.syncWindowsToActiveEntries(snap);
    const pageSize = this.opts.patternBankPageSize ?? 8;
    const projState: MidiProjectionState = {
      blackout: snap.blackout,
      activePattern: snap.activePattern,
      getCombinedAutopilotActive: () => snap.combinedAutopilotActive === true,
      getPerformanceModeActive: () => snap.performanceModeActive === true,
      getGlobalEffectState: (effect) => !!snap.globalEffects[effect],
      resolvePatternForBank: (bank, index) => snap.patterns[bank * pageSize + index] ?? null,
      layerExists: (layer) => !!layerInfo(snap, layer),
      getFocusedLayer: () => this.getRequestedFocusLayer(),
      isFocusLocked: () => this.isFocusLocked(),
      getGlobalEffectSlotActive: (slot) => snap.globalEffectSlots.find((s) => s.slot === slot)?.active ?? false,
      globalEffectSlotCount: snap.globalEffectSlots.length,
      getLayerPlaylistLength: (layer) => layerInfo(snap, layer)?.playlist?.entries.length ?? 0,
      getLayerActiveEntryIndex: (layer) => {
        const pl = layerInfo(snap, layer)?.playlist;
        if (!pl) return -1;
        return pl.entries.findIndex((e) => e.id === pl.activeEntryId);
      },
      getWindowCursor: (layer) => this.windowCursor.get(layer) ?? 0,
      windowSize: WINDOW_SIZE,
      getColorPaletteHue: (index) => snap.colorPalettes[index] ?? null,
      // ── MFT ring feedback (best-effort) ──
      // Show the value the KNOB edits: the modulation base (`base ?? v0`), not
      // the moving modulated `v0` (#6, decision D-2), OVERLAID with the
      // runtime's optimistic value while a turn's engine echo is still in
      // flight (optimisticDisplayValue) — so a fast sweep's ring tracks the
      // knob, not the ~150 ms-lagging snapshot. The overlay is only trusted
      // for the focus it was written under (optimisticFocusKey): a focus or
      // entry switch repaints from the NEW focus's own snapshot values.
      getFocusedExportValue: (index) => {
        const exp = snap.focused?.exports[index];
        if (!exp) return null;
        const base = exp.base ?? exp.v0;
        const controlId = this.turnControlIdForIndex(index);
        if (controlId === null) return base;
        if (this.optimisticFocusKey.get(controlId) !== snap.focused?.key) return base;
        return this.optimisticDisplayValue(controlId, base);
      },
      getGlobalParamValue: (key) => {
        const cur = snap.globalParamValues?.[key];
        if (typeof cur !== 'number') return null;
        const controlId = this.paramCenterControlIdForKey(key);
        return controlId === null ? cur : this.optimisticDisplayValue(controlId, cur);
      },
      // Live hue for the hue knob's ring + colour tracking — the FOCUSED
      // CHANNEL's per-channel hue in BOTH contexts (deck tab = the deck
      // channel, mixer tab = the focused overlay; hue is per-channel only —
      // the global shifter was removed 2026-07). null until the channel's
      // hue loads / nothing is focused (ring 0 + rest colour, never a
      // fabricated hue). The optimistic overlay is keyed per channel
      // (`controlId@role:id`, the same anchor slots the flush path writes),
      // so a focus switch reads the NEW channel's own entry — ring + colour
      // re-sync to that channel's hue, never dragging the previous channel's
      // optimistic value along.
      getHueKnobDegrees: () => {
        const hueId = this.hueTurnControlId();
        const hue = typeof snap.focused?.hue === 'number' ? snap.focused.hue : null;
        if (hue === null || hueId === null) return hue;
        return this.circularOptimisticDisplayDegrees(`${hueId}@${channelIdentity(snap.focused)}`, hue);
      },
      getFocusedIdentityColor: () => focusedIdentityColor(snap.focused),
      getFocusedExportModulated: (index) => !!snap.focused?.exports[index]?.modulated,
      // The projector STROBES a paramCenterRelative ring whose key is engine-owned
      // — the SAME shared syncOwnedKeys fact the dispatch gate consults (I4), so
      // the display can never disagree with the gate.
      syncOwnedKeys: snap.syncOwnedKeys ?? EMPTY_SYNC_OWNED_KEYS,
    };
    let messages: number[][];
    let next: LedState;
    try {
      ({ messages, next } = projectLeds(this.profile, projState, this.ledState, this.context));
    } catch (err) {
      // Same wiring-bug guard as onMessage: an unknown context must fail loud as
      // a red chip, not crash the LED projection loop. Other errors propagate.
      if (err instanceof UnknownContextError) {
        this.setStatus({ kind: 'error', error: err.message });
        return;
      }
      throw err;
    }
    this.ledState = next;
    // A failed LED write must never break the dispatch path (so we still swallow
    // the throw), but it must not be SILENT either (LED-send fail-loud): count
    // failures and surface a NON-STICKY warning after FAILURE_WARN_THRESHOLD so a
    // dead LED strip / lost destination endpoint is visible. Any clean batch
    // clears it. Only the FIRST throw of a batch is captured for the reason.
    let ledFailures = 0;
    let firstReason = '';
    for (const msg of messages) {
      try {
        this.transport.send(msg);
      } catch (err) {
        ledFailures += 1;
        if (firstReason === '') firstReason = err instanceof Error ? err.message : String(err);
      }
    }
    if (ledFailures > 0) {
      // Count FAILED MESSAGES, not calls — LED diffing means only the first full
      // repaint of a dead strip carries messages (later identical repaints send
      // nothing), so a per-call counter would never escalate. A dead strip's
      // first repaint fails many messages at once → crosses the threshold.
      this.ledFailStreak += ledFailures;
      if (this.ledFailStreak >= FAILURE_WARN_THRESHOLD) {
        this.setStatus({ warning: `LED feedback failing (${firstReason}) — the controller's lights may be dark.` });
      }
    } else if (messages.length > 0 && this.ledFailStreak !== 0) {
      // A clean repaint (messages that all sent) after a failing run clears it.
      this.ledFailStreak = 0;
      this.setStatus({ warning: undefined });
    }

    // Effects v2: VSN1 slot-state + page MIDI feedback. Emitted ONLY for the VSN1
    // profile (the device whose on-device Lua renders key LEDs / ring / LCD from
    // incoming MIDI). Diffed against the last frame so only changed state re-sends.
    this.sendVsn1Feedback(snap);
  }

  /** Emit the VSN1 slot-state/page feedback frames (Effects v2). No-op for every
   *  other driver. Uses the live snapshot's effectsPage + globalEffectSlots and
   *  diffs against `vsn1FeedbackState` so a knob twist that changes one slot's
   *  value sends one CC, not a full repaint. The device Lua reads these
   *  (`eventrx_cb`) to render active/value/mode per key + the current page. */
  private sendVsn1Feedback(snap: MidiEngineSnapshot): void {
    if (this.profile.device.id !== 'vsn1') return;
    const page = snap.effectsPage ?? 0;
    // FULL re-send on EVERY page change (firmware 2026-07-11): the device
    // restarts its Lua VM on each page load, wiping all rendered state — a diff
    // against what we last sent would leave the new page's LEDs/screen dark for
    // any value that happens to be byte-identical across the page switch. So the
    // whole frame (actives/values/modes/page/side-button LEDs) must repaint.
    //
    // The trigger is a one-shot FLAG (vsn1ForceFullResync), not just a page
    // compare: onEngineUpdate fires on EVERY engine change (patterns, colours,
    // slots, …), and any of those landing between the page-change and this emit
    // would otherwise repopulate the diff and swallow the resync — the reported
    // page flakiness. The flag is set by every page-change origin (engine-origin
    // page difference here; a device side-button press, which also restarts the
    // VM even when re-selecting the CURRENT page; welcome/reconnect) and consumed
    // exactly once. A page DIFFERENCE also arms it (covers a change we didn't
    // originate), so engine-origin changes are always caught even if no other
    // path set the flag.
    if (this.lastVsn1FeedbackPage !== null && this.lastVsn1FeedbackPage !== page) {
      this.vsn1ForceFullResync = true;
    }
    // LAYOUT change (slot swap/clear from the CaptainPad UI or any surface) also
    // forces a FULL re-send. A layout edit re-flashes the device Lua + restarts
    // its VM (the deploy is a separate wave; the runtime feedback must still be
    // whole), so a diff that only touched the changed slot's bytes could leave
    // the rest dark after the restart. The signature keys on the LAYOUT identity
    // (effectId + behavior + label) of the ON-PAGE slots — NOT the runtime
    // active/value/mode, which stay diffed (a knob twist must not re-blast the
    // frame). Computed against the SAME page window the frame projects.
    const layoutSig = vsn1PageLayoutSig(page, snap.globalEffectSlots);
    if (this.lastVsn1LayoutSig !== null && this.lastVsn1LayoutSig !== layoutSig) {
      this.vsn1ForceFullResync = true;
    }
    if (this.vsn1ForceFullResync) {
      this.vsn1ForceFullResync = false;
      this.vsn1FeedbackState = {}; // full frame — device VM was (or will be) wiped
    }
    this.lastVsn1FeedbackPage = page;
    this.lastVsn1LayoutSig = layoutSig;
    const { messages, next } = projectVsn1Feedback(
      { page, slots: snap.globalEffectSlots },
      this.vsn1FeedbackState,
    );
    this.vsn1FeedbackState = next;
    // WELCOME: when armed (a genuine (re)connect or the effects-panel load), emit
    // the one-shot hello FIRST so the device greets before the state paints, then
    // disarm. Consumed here (not diffed) so it fires exactly once per arm.
    if (this.vsn1WelcomePending) {
      this.vsn1WelcomePending = false;
      messages.unshift(vsn1WelcomeMessage());
    }
    for (const msg of messages) {
      try {
        this.transport.send(msg);
        this.recordOutboundNote(msg);
      } catch {
        // A failed feedback send shares the LED-send fail-loud accounting: bump
        // the same streak so a dead destination surfaces once, without breaking
        // the dispatch path. (Feedback and LED sends go to the same endpoint.)
        this.ledFailStreak += 1;
      }
    }
  }

  /** Record an outbound Note On (velocity > 0) for the sb_2 self-echo guard. The
   *  side-button page LEDs ride Note On note 41+p — the SAME notes the device's
   *  small buttons emit — so a MIDI loopback of our page-2 LED (note 43) aliases
   *  an sb_2 press. Stamping every outbound Note On lets handleVsn1ProfileButton
   *  reject an inbound note 43 that is really our own echo. Velocity-0 frames
   *  (LED "off") decode inbound as Note Off and are swallowed by the resolver, so
   *  they can't alias — we don't record them. No-op for non-note frames. */
  private recordOutboundNote(msg: number[]): void {
    if (msg.length < 3) return;
    if ((msg[0] & 0xf0) !== 0x90) return; // not a Note On
    if (msg[2] <= 0) return; // velocity 0 = a Note Off alias; can't be a press
    this.recentOutboundNotes.set(msg[1], this.nowMs());
  }

  /** Effects v2 WELCOME: arm the one-shot VSN1 hello and immediately emit it
   *  ALONGSIDE a full feedback re-sync. Called when the effects panel first
   *  loads (the panel + the hook route here). No-op for non-VSN1 profiles and
   *  while disconnected (projectAndSend early-returns; the flag stays armed and
   *  the next connect's re-sync carries it). */
  requestVsn1Welcome(): void {
    if (this.profile.device.id !== 'vsn1') return;
    // Re-echo the host-owned VIEW MODE FIRST — symmetric with
    // resyncAfterLayoutDeploy() and handleDeviceHello(). The device resets `vm`
    // to its INIT default (0 = DRUM) on every Lua-VM restart; a panel remount
    // (navigate away + back, or a reset) routes here, so without this the grid
    // silently drops to DRUM regardless of the operator's chosen mode. (Fixes
    // the "mode reverts to DRUM after reset" regression — the three re-sync
    // entry points must all restore `vm`.)
    this.emitVsn1ViewMode();
    this.vsn1WelcomePending = true;
    // Re-send the FULL feedback frame with the hello: ARM the resync flag so the
    // panel load re-paints the whole slot/page state (matching "full re-sync +
    // hello") even if an unrelated onEngineUpdate races in first.
    this.vsn1ForceFullResync = true;
    this.projectAndSend();
  }

  /** Item 2: an engine layout AUTO-DEPLOY completed — the device was RE-FLASHED,
   *  which restarts its Lua VM and resets EVERY device global to its INIT default
   *  (vm = 0 DRUM, hi = 0, empty vals/mods/acts). Re-echo the host-owned VIEW MODE
   *  and force a FULL feedback re-sync so the device restores its prior mode +
   *  active/value/mode/page state after the flash.
   *
   *  Crucially this must NOT re-arm the WELCOME (item 1): a re-flash is not a fresh
   *  device connect, so `vsn1WelcomePending` is left untouched — the logo stays
   *  hidden and the live layout paints immediately, exactly like a page change.
   *  No-op for non-VSN1 profiles / while disconnected (projectAndSend
   *  early-returns; the flag stays armed for the next paint). */
  resyncAfterLayoutDeploy(): void {
    if (this.profile.device.id !== 'vsn1') return;
    // Re-echo the view mode FIRST (its own one-shot CC) so `vm` is restored before
    // the feedback frame paints the grid-vs-drum layout.
    this.emitVsn1ViewMode();
    // Full frame — the device VM was wiped by the flash. This does NOT set
    // vsn1WelcomePending, so no hello rides along (no logo on a re-flash).
    this.vsn1ForceFullResync = true;
    this.projectAndSend();
  }

  /** Item 2 (device-hello-driven resync — the PRIMARY, race-free guarantee): the
   *  device pinged "VM ready" (it restarts its Lua VM on every power-on / page
   *  load / layout re-flash and emits the hello the moment its receiver is live).
   *  Re-push the FULL device state so it restores after the restart:
   *    1. re-echo the host-owned VIEW MODE (its one-shot CC) so `vm` is right
   *       BEFORE the feedback frame paints the grid-vs-drum layout, and
   *    2. force a full feedback re-sync (active/value/mode/page/side-button LEDs).
   *  Because the DEVICE asks only once its receiver is registered, neither can be
   *  lost to a restart still in flight (the failure mode of a blind timed re-echo
   *  after a deploy). The FIRST hello of a fresh host connection ALSO arms the
   *  welcome logo (vsn1WelcomeArmNextHello, set on connect); every SUBSEQUENT hello
   *  (page load / post-flash) only re-pushes state — so the logo is a per-connection
   *  greeting, never a page-change / re-flash flash (item 1). */
  private handleDeviceHello(): void {
    if (this.vsn1WelcomeArmNextHello) {
      // First hello of this connection → greet with the logo (rides the re-sync).
      this.vsn1WelcomeArmNextHello = false;
      this.vsn1WelcomePending = true;
      this.setStatus({ lastEvent: 'VSN1 device hello → welcome + state re-sync' });
    } else {
      this.setStatus({ lastEvent: 'VSN1 device hello → state re-sync' });
    }
    // Re-echo the view mode, then full re-sync (same as a post-flash restore).
    this.emitVsn1ViewMode();
    // Re-emit the SELECT CUE too (audit 2026-07-10 #3): the cue is a one-shot
    // that is NOT part of the diffed feedback frame, so a cue that landed in
    // the VM-restart window was silently lost — the device forgot which slot
    // the encoder targets until the next key press. The hello is the "receiver
    // is live again" signal, so re-asserting the current selection here makes
    // it restart-proof. No selection yet → nothing to re-assert.
    if (this.selectedSlot !== null) this.emitVsn1SelectCue(this.selectedSlot);
    this.vsn1ForceFullResync = true;
    this.projectAndSend();
  }

  private teardownBindings(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  dispose(): void {
    if (this.vsn1KeepaliveTimer !== null) {
      clearInterval(this.vsn1KeepaliveTimer);
      this.vsn1KeepaliveTimer = null;
    }
    this.coalescer.dispose();
    this.teardownBindings();
    this.transport.close();
  }
}

export class MidiManager {
  private readonly opts: MidiManagerOptions;
  private readonly runtimes: ControllerRuntime[] = [];
  /** Shared MIDI-learn capture state — armed by the learn popover, consumed by
   *  whichever controller the operator moves a fader on. */
  private readonly learn = new LearnController();

  constructor(opts: MidiManagerOptions) {
    this.opts = opts;
    const pageSize = opts.patternBankPageSize ?? 8;
    const dispatcher = createDispatcher(opts.api, {
      getBlackout: () => opts.getSnapshot().blackout,
      getGlobalEffectState: (effect) => !!opts.getSnapshot().globalEffects[effect],
      resolvePatternForBank: (bank, index) => opts.getSnapshot().patterns[bank * pageSize + index] ?? null,
      getLayer: (layer) => {
        const L = layerInfo(opts.getSnapshot(), layer);
        return L ? { id: L.id, role: L.role } : null;
      },
      getColorPalette: (index) => opts.getSnapshot().colorPalettes[index] ?? null,
      // For the MFT (0,0) push (bpmSyncToggle): the engine's live BPM→Speed
      // sync flag. The dispatcher layers its own lagging-echo protection on top.
      getBpmSpeedSyncOn: () => opts.getSnapshot().bpmSpeedSyncOn === true,
      // The slot's behavior from the live snapshot — makes the pad dispatch
      // behavior-aware (a 'trigger' slot fires 'trigger', not 'toggle'). null
      // when the slot isn't in the snapshot yet (boot/refresh race); the
      // dispatcher then fails safe to 'toggle'.
      getGlobalEffectSlotBehavior: (slot) =>
        opts.getSnapshot().globalEffectSlots.find((s) => s.slot === slot)?.behavior ?? null,
    });
    for (const profile of opts.profiles) {
      this.runtimes.push(new ControllerRuntime(profile, opts, dispatcher, this.learn, () => this.emitStatus()));
    }
  }

  /** Arm MIDI-learn: the next fader/pad the operator moves on ANY connected
   *  controller is delivered to `cb` (and swallowed — it binds, it does not
   *  also act). Delivers `{ ref }` on a clean capture or `{ conflict }` when
   *  the control already resolves to a static profile action. Returns a cancel
   *  fn scoped to THIS arm (a stale cancel can't kill a newer arm). Auto-disarms
   *  on capture / conflict. */
  armLearn(cb: (result: LearnResult) => void): () => void {
    const token = this.learn.arm(cb);
    return () => this.learn.cancel(token);
  }

  isLearning(): boolean {
    return this.learn.isArmed();
  }

  private emitStatus(): void {
    this.opts.onStatusChange?.(this.getStatuses());
  }

  /** Connect every controller (concurrently). */
  async start(): Promise<void> {
    await Promise.all(this.runtimes.map((r) => r.connect()));
  }

  /** Engine state changed — repaint LEDs across all connected controllers. */
  onEngineUpdate(): void {
    for (const r of this.runtimes) r.projectAndSend();
  }

  /** Effects v2 WELCOME: the effects panel loaded — send the one-shot VSN1 hello
   *  + a full feedback re-sync. Fans out to every runtime (only the VSN1 acts). */
  requestVsn1Welcome(): void {
    for (const r of this.runtimes) r.requestVsn1Welcome();
  }

  /** Item 2: a VSN1 layout auto-deploy completed (the device was re-flashed → VM
   *  restart). Re-echo the view mode + full feedback re-sync so the device
   *  restores its prior state — WITHOUT re-arming the welcome. Fans out to every
   *  runtime (only the VSN1 acts). */
  resyncVsn1AfterLayoutDeploy(): void {
    for (const r of this.runtimes) r.resyncAfterLayoutDeploy();
  }

  /** Active CaptainPad tab changed — switch every controller's mapping context
   *  (Deck vs Mixer map the same hardware to different actions). */
  setContext(name: string): void {
    for (const r of this.runtimes) r.setContext(name);
  }

  /** A CaptainPad list UI tap (PlaylistPanel.handleEntryTap) — the ONLY active-entry
   *  source allowed to recenter the browse window (operator policy 2026-07). Fans
   *  out to every runtime; each recenters that channel's window when the tapped
   *  entry's engine echo lands. */
  noteUiPatternSelect(channelId: string, entryId: string): void {
    for (const r of this.runtimes) r.noteUiPatternSelect(channelId, entryId);
  }

  /** Set the focus intent from ANY source (contract I2). Touch focus (the hook)
   *  calls this so touch + MIDI share ONE source of truth for `requestedFocusLayer`
   *  — the same synchronous request every controller's LED paint + binding gate
   *  reads. Fans out to every runtime; each is inert if the layer is absent.
   *  Does NOT re-fire onFocusChange when the intent originated from the hook —
   *  but since the hook is the onFocusChange sink, a touch call here would loop.
   *  Guarded: pass through the runtime's setFocusIntent which calls onFocusChange;
   *  the hook's setMidiFocus is idempotent on an unchanged layer, so the loop
   *  terminates after one hop. */
  setFocusIntent(layer: number): void {
    for (const r of this.runtimes) r.setFocusIntent(layer);
  }

  /** Re-validate param keys across controllers once the CPC schema has loaded. */
  revalidate(): void {
    for (const r of this.runtimes) r.revalidateParams();
  }

  getStatuses(): ControllerStatus[] {
    return this.runtimes.map((r) => r.status);
  }

  dispose(): void {
    for (const r of this.runtimes) r.dispose();
  }
}

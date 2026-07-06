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
import { createDispatcher, MidiDispatchApi, MidiDispatcher, MidiApiResult } from './dispatch';
import { projectLeds, LedState, MidiProjectionState } from './led_projector';
import { clampUnit } from './unit_clamp';
import {
  LearnController, LearnResult, MidiControlRef, bindingMatches, controlRefFromEvent,
  scaleMidiToRange, pickup, freshPickup, PickupState,
} from './learn';
import { decodeBankChange, decodeRelativeDelta } from './mft/messages';
import { ColorValues, MidiChannels } from './mft/constants';
import { buildConnectConfig } from './mft/config';

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
  /** Global-effect slots (1-based slot number + active state). */
  globalEffectSlots: { slot: number; active: boolean }[];
  /** Curated colour palette pairs (hues 0..1), for the colour-pair pads. */
  colorPalettes: { c1: number; c2: number }[];
  /** The FOCUSED channel — whose active pattern's MIDI-learned bindings the
   *  param faders (4-6) drive. On the Deck tab it is the single deck channel
   *  (auto-focused); on the Mixer tab the operator selects it with a track
   *  button. null when nothing is focused (no channel / no active entry). */
  focused: FocusedChannel | null;
  /** Curated CPC global param VALUES (0..1) keyed by param key, for the MFT
   *  bank-2 `paramCenterRelative` knobs (and their ring feedback). A relative
   *  knob applies its delta to the value here. Absent key → knob is inert. */
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
}

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
 *  detent (the largest shipped very-fast step is 0.06, DEFAULT_RELATIVE_STEPS[2])
 *  but the echo catching up on a WHOLE coalescer window's worth of accumulated
 *  ticks at once; 0.15 sits above that per-window echo creep yet well below a
 *  deliberate reset jump. */
const OPTIMISTIC_RESEED_EPSILON = 0.15;

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
  private unsubs: (() => void)[] = [];
  private context: string;
  /** Per-layer playlist browse-window top index (controller-local state). */
  private readonly windowCursor = new Map<number, number>();
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
      this.unsubs.push(this.transport.addListener('midiMessage', (e) => this.onMessage(e.data)));
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
      if (!wasConfigured) this.ledState = {};
      this.projectAndSend();
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
    this.ledState = {};
    this.projectAndSend();
  }

  private onMessage(data: number[]): void {
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
        this.projectAndSend();
      }
      return;
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
        // footgun (codex P0). Its CC "value" is a relative-delta code (61-67), not
        // an absolute position, so learning it and feeding it through absolute
        // scaleMidiToRange would pin the param to ~0.5 jitter. Reject when EITHER
        // the value decodes as a relative delta OR the event is on a
        // configureOnConnect device's rotary/switch channel (bank-3/4 turns +
        // pushes never reach a static profile action, so profileClaims wouldn't
        // catch them). Named error so the popover can explain.
        const isRelativeCode = decoded.type === 'cc' && decodeRelativeDelta(decoded.value) !== null;
        const onRotaryOrSwitch = this.profile.device.configureOnConnect
          && (decoded.type === 'cc' || decoded.type === 'noteOn' || decoded.type === 'noteOff')
          && (decoded.channel === MidiChannels.ROTARY_ENCODER || decoded.channel === MidiChannels.SWITCH_AND_COLOR);
        if (isRelativeCode || onRotaryOrSwitch) {
          if (this.learn.reportReject("that's an endless encoder — knobs map by order, not by learn")) {
            this.setStatus({ lastEvent: `learn ✕ ${describeEvent(decoded, null)} (endless encoder)` });
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
          if (this.learn.reportReject(`that control is already learned to '${dup.target.parameter}'`)) {
            this.setStatus({ lastEvent: `learn ✕ ${describeEvent(decoded, dup.id)} (already bound)` });
            return;
          }
        }
        const claimed = profileClaims(this.profile, cap.ref, this.context);
        if (claimed !== null) {
          if (this.learn.reportConflict(claimed)) {
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
    //    over any static profile action on the same control (faders 4-6 are
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
    if (ev.resolved.kind === 'focusedParamDelta' || ev.resolved.kind === 'paramCenterDelta') {
      // Relative deltas ACCUMULATE across the coalescer window (no tick dropped),
      // then flush as a single write against the optimistic value in
      // flushResolved. For a focused delta, capture the focus identity NOW (N3)
      // so the flush can drop the payload if focus moved during the window
      // rather than writing into the new channel's same-index param.
      if (ev.resolved.kind === 'focusedParamDelta' && !this.deltaFocusKey.has(ev.controlId)) {
        this.deltaFocusKey.set(ev.controlId, this.opts.getSnapshot().focused?.key ?? null);
      }
      this.coalescer.accumulate(ev.controlId, ev.resolved, combineDelta);
      return;
    }
    if (ev.continuous) {
      this.coalescer.push(ev.controlId, ev.resolved);
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
    // under continued turning. Seeding both the optimistic value and its
    // snap-anchor makes the next window accumulate from the reset value, and a
    // lagging snapshot echo can't trip a re-seed back to the old base.
    if (turnControlId !== null) {
      this.optimisticValues.set(turnControlId, value);
      this.lastSnapAnchor.set(turnControlId, value);
    }
    // Reset unlocks the pickup slot for any binding on this param (a deliberate
    // jump), mirroring a note-press write.
    this.setStatus({ lastEvent: `reset ${exp.name} = ${value.toFixed(2)}` });
    this.coalescer.push(`knob:${index}`, {
      kind: 'localParam', role: focused.role, channelId: focused.id, exportId: exp.id, value,
    });
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
      const value = clampUnit(anchor + payload.delta);
      this.optimisticValues.set(controlId, value); // seed the next window's anchor
      this.setStatus({ lastEvent: `knob ${exp.name} = ${value.toFixed(2)}` });
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
      const value = clampUnit(anchor + payload.delta);
      this.optimisticValues.set(controlId, value);
      this.setStatus({ lastEvent: `${payload.key} = ${value.toFixed(2)}` });
      await this.runDispatch({ kind: 'paramCenter', key: payload.key, value });
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
  private optimisticAnchor(controlId: string, snapValue: number): number {
    const optimistic = this.optimisticValues.get(controlId);
    const prevSnap = this.lastSnapAnchor.get(controlId);
    this.lastSnapAnchor.set(controlId, snapValue);
    if (optimistic === undefined || prevSnap === undefined) return snapValue;
    if (Math.abs(snapValue - prevSnap) > OPTIMISTIC_RESEED_EPSILON) return snapValue; // external jump
    return optimistic; // snapshot only lagging → keep accumulating locally
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
    this.windowCursor.set(layer, next);
    this.opts.onWindowChange?.(L.id, next, WINDOW_SIZE);
    this.projectAndSend(); // repaint the window
  }

  private handleWindowSelect(layer: number, slot: number): void {
    const snap = this.opts.getSnapshot();
    const L = layerInfo(snap, layer);
    if (!L?.playlist) return;
    const entry = L.playlist.entries[(this.windowCursor.get(layer) ?? 0) + slot];
    if (!entry) return; // pad past the end of the playlist — no-op
    // Direct api call (not a ResolvedAction), but its result is surfaced through
    // the same fail-loud path (P2-5) so a failed entry select isn't silent.
    void this.opts.api.setChannelPlaylistEntry(L.role, L.id, entry.id)
      .then((r) => this.surfaceApiResult('playlistWindowSelect', r));
  }

  /** Recompute LED diffs against the current snapshot and send them. */
  projectAndSend(): void {
    if (this.status.kind !== 'connected') return;
    const snap = this.opts.getSnapshot();
    const pageSize = this.opts.patternBankPageSize ?? 8;
    const projState: MidiProjectionState = {
      blackout: snap.blackout,
      activePattern: snap.activePattern,
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
      // the moving modulated `v0` (#6, decision D-2). The ring pulse still flags
      // that the param is modulated; the ring position tracks the operator's set
      // value, consistent with the delta + pickup anchors.
      getFocusedExportValue: (index) => {
        const exp = snap.focused?.exports[index];
        if (!exp) return null;
        return exp.base ?? exp.v0;
      },
      getGlobalParamValue: (key) => snap.globalParamValues?.[key] ?? null,
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
  }

  private teardownBindings(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  dispose(): void {
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

  /** Active CaptainPad tab changed — switch every controller's mapping context
   *  (Deck vs Mixer map the same hardware to different actions). */
  setContext(name: string): void {
    for (const r of this.runtimes) r.setContext(name);
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

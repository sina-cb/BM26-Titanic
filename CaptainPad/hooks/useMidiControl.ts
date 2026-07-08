// useMidiControl — lifecycle owner for direct MIDI control. Mounted ONCE in
// RootShell (app/_layout.tsx), at the same altitude as the engine buses.
//
// Responsibilities:
//   - pick a transport (native → web → unavailable; visible state, not error)
//   - load + validate the bundled controller profile(s) (throws → red chip)
//   - build a MidiManager, start it (resolve endpoints, open ports, subscribe)
//   - project live engine state (useEngineState) onto controller LEDs
//   - expose connection state to the header chip + Config tab via a module
//     store (same pattern as useEngineState)
//
// MIDI is entirely CaptainPad-side: dispatch rides existing utils/api.ts REST
// functions, ZERO engine changes. The mapping/LED/dispatch stack is identical
// on desktop Web MIDI and (later) the iPad CoreMIDI native module — that's the
// frozen MidiTransport interface doing its job.

import { useEffect, useState } from 'react';

import { useEngineState, MixerChannel } from '@/hooks/useEngineState';
import { engineEvents } from '@/utils/engineEvents';
import { engineParamsEvents } from '@/utils/engineParamsEvents';
import {
  fetchGlobals,
  fetchPatterns,
  updateParamCenter,
  updateMixerMaster,
  setActivePattern,
  setGlobalBlackout,
  setGlobalEffect,
  setSectionBrightness,
  setGroupFixedColor,
  updateMixerChannel,
  updateDeckChannel,
  dispatchGlobalEffectSlotAction,
  setGlobalEffectBlackout,
  getAutopilot,
  setAutopilot,
  fetchDeckTransitionConfig,
  setDeckTransitionConfig,
  fetchGlobalEffectSlotsStatus,
  setChannelPlaylistEntry,
  setDeckChannelControl,
  setMixerChannelControl,
  fetchPlaylist,
  invalidatePlaylistCache,
  getCachedColorPalettes,
  warmColorPalettesCache,
  type PlaylistAssignment,
} from '@/utils/api';
import { setChannelHue } from '@/utils/channelExtrasApi';
import {
  MidiManager,
  ControllerStatus,
  MidiEngineSnapshot,
  FocusedBinding,
  MidiControlRef,
  LearnResult,
  learnRejectMessage,
  selectTransportFactory,
  setSysexRequested,
  getMidiTransportKind,
  MidiTransportKind,
  validateProfile,
  profileClaims,
  describeControlRef,
  ControllerProfile,
  GlobalEffectSlotBehavior,
} from '@/utils/midi';
import { deriveKnobOrder, type Export } from '@/utils/midi/knob_order';
import apcProfileRaw from '@/midi_profiles/apc_mini_mk2.yaml';
import mftProfileRaw from '@/midi_profiles/mft.yaml';

export interface MidiControlState {
  /** A transport exists on this platform (desktop Chromium / native module). */
  available: boolean;
  transportKind: MidiTransportKind;
  /** Profile load/validate failure (fatal for that profile). */
  profileError: string | null;
  statuses: ControllerStatus[];
  /** Last operator-facing notice from the MIDI runtime that isn't a hard error
   *  or a per-controller status — e.g. "autopilot disable failed; it may keep
   *  fighting the faders" or "focus reset to channel 0". Surfaced in the header
   *  chip's message (codex: fail LOUD — never swallow a runtime failure the
   *  operator is fighting). Optional so every `_set` literal stays valid. */
  notice?: string | null;
}

const EMPTY: MidiControlState = {
  available: false,
  transportKind: 'none',
  profileError: null,
  statuses: [],
  notice: null,
};

// ── Module store (mirrors useEngineState's cache + listener set) ───────────
let _state: MidiControlState = EMPTY;
const _listeners = new Set<(s: MidiControlState) => void>();

function _set(next: MidiControlState): void {
  // Preserve the last runtime notice across status-only updates (onStatusChange
  // fires often and doesn't carry a notice) — a notice is cleared explicitly via
  // _setNotice(null), never implicitly by an unrelated status refresh.
  _state = 'notice' in next ? next : { ...next, notice: _state.notice ?? null };
  _listeners.forEach((cb) => {
    try { cb(_state); } catch { /* a buggy subscriber must not break the others */ }
  });
}

/** Set (or clear, with null) the operator-facing runtime notice, preserving the
 *  rest of the state. Loud-fail surface for a runtime failure the operator is
 *  actively fighting (e.g. autopilot that won't disable). */
function _setNotice(notice: string | null): void {
  if ((_state.notice ?? null) === notice) return; // no churn on repeats
  _set({ ..._state, notice });
}

/** Narrow the engine's bare-string slot `behavior` to the known union. An
 *  unexpected value becomes undefined so the dispatcher's fail-safe ('toggle')
 *  owns the odd case rather than a bad literal leaking into the snapshot. */
function narrowSlotBehavior(behavior: string): GlobalEffectSlotBehavior | undefined {
  return behavior === 'toggle' || behavior === 'trigger' || behavior === 'hold'
    ? behavior
    : undefined;
}

// Live snapshot the manager reads on every dispatch + LED projection. Kept in
// a module ref so the manager's closures always see the latest engine state.
let _snapshot: MidiEngineSnapshot = {
  blackout: false,
  activePattern: null,
  patterns: [],
  globalEffects: {},
  layers: [],
  deckLayer: null,
  activeContext: 'deck',
  globalEffectSlots: [],
  colorPalettes: [],
  focused: null,
  // syncOwnedKeys (contract I4): the global-param keys the engine currently
  // drives itself (e.g. 'speed' while BPM→Speed sync is on). Empty at boot;
  // populated from `bpmSpeedSyncOn` in the snapshot rebuild + the in-place patch.
  syncOwnedKeys: new Set<string>(),
};

/** Derive `syncOwnedKeys` (contract I4) from the BPM→Speed sync flag: when the
 *  engine's BPM→Speed sync owns `speed`, a manual write to it (via ANY surface)
 *  is inert. This is the ONE place the 'speed' literal lives on the hook side;
 *  D1's flush gate + D4's projector read the SET, never the literal. */
function _deriveSyncOwnedKeys(bpmSpeedSyncOn: boolean): ReadonlySet<string> {
  return bpmSpeedSyncOn ? new Set<string>(['speed']) : new Set<string>();
}

/** Extract the CPC global param VALUES (0..1) from a shared-params `params` map,
 *  keeping only finite numbers (HSV palettes and other non-scalars are skipped,
 *  never coerced). The single derivation used by BOTH the full snapshot rebuild
 *  and the in-place shared-params patch (#10). */
function _deriveGlobalParamValues(
  paramsSrc: Record<string, { value?: unknown }> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (paramsSrc) {
    for (const key of Object.keys(paramsSrc)) {
      const v = paramsSrc[key]?.value;
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

// NOTE (2026-07): the GLOBAL hue-shift snapshot patch (`_patchHueShift`, fed
// by the `globalHueShift` WS broadcast + the GET /globals seed) was REMOVED
// with the global hue shifter. The MFT hue knob now drives the FOCUSED
// CHANNEL's per-channel hue in both contexts; the channel's `hue` is threaded
// through `_snapshot.focused.hue` by the snapshot rebuild below.

/** #10: in-place patch of `_snapshot` from a live `sharedParams` frame, WITHOUT
 *  the heavy async rebuild. Recomputes globalParamValues + bpmSpeedSyncOn +
 *  syncOwnedKeys (so the MFT bank-2 rings + the sync gate track live CPC values)
 *  and preserves every other snapshot field. Nudges an LED repaint. */
function _patchSharedParams(paramsSrc: Record<string, { value?: unknown }> | undefined): void {
  const globalParamValues = _deriveGlobalParamValues(paramsSrc);
  const bpmSpeedSyncOn = Number(globalParamValues['bpmSpeedSync']) > 0.5;
  _snapshot = {
    ..._snapshot,
    globalParamValues,
    bpmSpeedSyncOn,
    syncOwnedKeys: _deriveSyncOwnedKeys(bpmSpeedSyncOn),
  };
  _nudge?.();
}

// ── Modulation anchor cache (the MODULATION ANCHOR for focused params) ─────
// modulation live-state rides engineParamsEvents as
//   { type:'modulationState', parameters: { [name]: { base, modulated, … } } }
// — EXACTLY the bus components/Modulation.tsx `useModulationState()` reads.
// We keep a module-level mirror updated by ONE module-level subscription (set
// up in the boot effect, torn down in its cleanup) and read it at snapshot-
// rebuild cadence: `base` (the operator's stable set value) moves slowly, so a
// one-rebuild lag is fine, and we must NOT rebuild the snapshot on every frame
// (this bus ticks at audio rate). Whole-state replacement per frame, like
// Modulation.tsx — the engine emits a final empty-parameters frame on delete,
// so replacement is enough to clear a stale anchor.
let _modState: Record<string, { base: number; modulated: number }> = {};

// ── Focused channel (for the MIDI-learn param faders 4-8) ──────────────────
// On the Deck tab the focus is always the single deck channel. On the Mixer tab
// the operator picks the focused overlay with a track button (focusChannel
// action). The manager applies the focused pattern's bindings to the param
// faders. `_rev` bumps re-run the snapshot effect so a focus switch or a
// `playlistSaved` (a freshly-learned binding) updates `_snapshot.focused`.
let _focusedLayer = 0;
const _focusListeners = new Set<() => void>();
// The live manager's focus-intent writer (contract I2), published by the boot
// effect. `setMidiFocus` routes touch focus through this so the manager is the
// SINGLE source of truth for `requestedFocusLayer` (fixes #2 focus reconcile).
let _setFocusIntent: ((layer: number) => void) | null = null;

function _bumpFocus(): void {
  _focusListeners.forEach((cb) => {
    try { cb(); } catch (err) {
      // A buggy focus listener must not break the others — but don't swallow
      // it silently (codex: fail loud, at least in the log).
      console.warn('[midi] focus listener threw:', err);
    }
  });
}

/** Playlist names currently in play (deck + overlays + focused channel). A
 *  `playlistSaved` for a playlist NOT in this set can't change any binding the
 *  manager applies, so we skip the snapshot rebuild it would otherwise trigger. */
function _activePlaylistNames(): Set<string> {
  const names = new Set<string>();
  const add = (p: unknown) => {
    const name = (p as { name?: string } | null | undefined)?.name;
    if (typeof name === 'string' && name) names.add(name);
  };
  for (const c of _lastEngineChannels) add((c as { playlist?: unknown }).playlist);
  add((_lastEngineDeck as { playlist?: unknown } | null)?.playlist);
  return names;
}
// Last engine channel/deck refs, kept so the playlistSaved filter can tell
// whether a saved playlist is one the manager actually applies.
let _lastEngineChannels: unknown[] = [];
let _lastEngineDeck: unknown = null;

/** Set the focused mixer layer (Mixer tab). Two callers:
 *  - the manager's onFocusChange (a MIDI/APC focus intent already routed through
 *    `manager.setFocusIntent`), and
 *  - the on-screen mixer (a TOUCH focus intent).
 *
 *  #2 focus single-source-of-truth: a touch intent must ALSO drive the manager's
 *  `requestedFocusLayer` (contract I2), else an APC-then-touch swap leaves the
 *  manager's stale request swallowing bound faders forever. We therefore route
 *  the manager's `setFocusIntent`. Per I2's note we set `_focusedLayer` FIRST so
 *  the resulting onFocusChange → setMidiFocus hop is idempotent (unchanged layer
 *  → early return) and does NOT loop. */
export function setMidiFocus(layer: number): void {
  if (layer === _focusedLayer) return;
  _focusedLayer = layer;
  // Make the manager the single home of the focus request. Idempotent hop: the
  // manager fans out → onFocusChange → setMidiFocus(layer), which early-returns
  // because `_focusedLayer` already equals `layer`.
  _setFocusIntent?.(layer);
  _bumpFocus();
}

/** The focused mixer layer index (re-renders on change). Deck tab ignores it
 *  (its single channel is always focused). */
export function useMidiFocus(): number {
  const [f, setF] = useState(_focusedLayer);
  useEffect(() => {
    const cb = () => setF(_focusedLayer);
    _focusListeners.add(cb);
    cb();
    return () => { _focusListeners.delete(cb); };
  }, []);
  return f;
}

/** Boolean focus selector (contract I3): is `layerIndex` the focused mixer
 *  layer? A per-strip component subscribes to THIS instead of `useMidiFocus()`
 *  so `React.memo` only re-renders the two strips whose focus actually flips on
 *  a focus change — not every strip on every change (12a render churn). */
export function useIsMidiFocused(layerIndex: number): boolean {
  const [focused, setFocused] = useState(_focusedLayer === layerIndex);
  useEffect(() => {
    const cb = () => setFocused(_focusedLayer === layerIndex);
    _focusListeners.add(cb);
    cb();
    return () => { _focusListeners.delete(cb); };
  }, [layerIndex]);
  return focused;
}

// ── MIDI-learn arming (consumed by the per-param MIDI map popover) ──────────
let _armLearn: ((cb: (result: LearnResult) => void) => () => void) | null = null;

/**
 * Arm MIDI-learn: the next fader/pad the operator moves binds to the param the
 * popover is editing. `cb` fires ONCE with `{ ref }` on a clean capture, or
 * `{ error }` when the control is already mapped to a profile action or MIDI is
 * unavailable / not started on this platform (codex P0: fail LOUD, never
 * silently resolve null — the popover surfaces the error inline). Returns a
 * cancel fn; the popover owns cancellation (CANCEL chip / unmount / re-arm), so
 * there is no timeout. The cancel is scoped to THIS arm (a stale popover can't
 * cancel a newer one).
 */
export function armMidiLearn(cb: (r: { ref: MidiControlRef } | { error: string }) => void): () => void {
  if (!_armLearn) {
    cb({ error: 'MIDI unavailable on this platform (or not started)' });
    return () => {};
  }
  return _armLearn((result) => {
    if ('ref' in result) cb({ ref: result.ref });
    // The runtime delivers a STRUCTURED LearnRejectReason; format it here (the
    // one copy home is learnRejectMessage) so the toast reads as one clean
    // sentence — never a reason nested inside another template.
    else cb({ error: learnRejectMessage(result.conflict) });
  });
}

// Loaded profiles + current context, published by the boot effect so the
// save-time conflict re-check (below) can run profileClaims without plumbing
// the whole profile object through the popover.
let _loadedProfiles: ControllerProfile[] = [];

/** Belt-and-braces: does `ref` already resolve to a static profile action on
 *  ANY loaded profile in the current context? Returns a human-readable conflict
 *  message (for the popover's inline red error) or null when the control is free
 *  to bind. The runtime rejects at capture time (fail loud there); this is the
 *  save-time re-check per plan §1.1 so a stale captured ref can't be persisted. */
export function midiControlConflict(ref: MidiControlRef): string | null {
  for (const p of _loadedProfiles) {
    const claimed = profileClaims(p, ref, _activeContext);
    if (claimed !== null) return learnRejectMessage({ kind: 'profile-claimed', controlId: claimed });
  }
  return null;
}

/** Same physical control? (type + channel + number.) The one-per-control rule
 *  keys on the physical identity, not the id. Pure. */
function _sameControl(a: MidiControlRef, b: MidiControlRef): boolean {
  return a.type === b.type && a.channel === b.channel && a.number === b.number;
}

/** One-per-control learned-binding check (P2-2, save side). Given the control
 *  the operator is about to save and the param it targets, find an EXISTING
 *  ENABLED learned binding sitting on the SAME physical control but bound to a
 *  DIFFERENT param — that would let one fader silently drive two params at once.
 *  Returns the colliding binding's target parameter, or null when the control is
 *  free. Re-learning the SAME param (same target) is a legitimate replace, not a
 *  conflict, so it is excluded. A disabled binding doesn't reserve the control.
 *  Pure + exported for unit testing without the module snapshot. */
export function findLearnedControlConflict(
  ref: MidiControlRef,
  targetParameter: string,
  existing: readonly FocusedBinding[],
): string | null {
  for (const b of existing) {
    if (!b.enabled) continue;
    if (b.target?.parameter === targetParameter) continue; // same param → replace
    if (_sameControl(b.control, ref)) return b.target?.parameter ?? '(unknown)';
  }
  return null;
}

/** Belt-and-braces one-per-control re-check (P2-2). Reads the FOCUSED channel's
 *  active-entry bindings (the ones the manager actually applies) and rejects a
 *  save that would put this control on top of another enabled learned binding.
 *  Returns an operator-facing message (for the popover's inline red error) or
 *  null when the control is free. The sibling runtime capture side enforces the
 *  same rule at learn time; this is the save-time guard so a stale captured ref
 *  can't be persisted into a double-binding. */
export function midiControlLearnedConflict(ref: MidiControlRef, targetParameter: string): string | null {
  const bindings = _snapshot.focused?.midiMappings ?? [];
  const collidingParam = findLearnedControlConflict(ref, targetParameter, bindings);
  if (collidingParam === null) return null;
  return `${describeControlRef(ref)} is already learned to '${collidingParam}' — free it first or pick another control`;
}

// Conflict copy lives in utils/midi/learn.ts `learnRejectMessage` — the ONE
// formatter for every learn-rejection surface (capture toast + popover inline
// error). Fader 7's old GLOBAL SPEED reservation is gone (speed lives on the
// MFT (0,0) knob), so the learn-fader hint there reads 4–8.

// ── Playlist browse-window state (for the mixer-UI rectangular border) ─────
// Keyed by mixer channel id → { start, size }. The MIDI manager publishes
// window moves here; the Mixer tab's PlaylistPanel reads it via useMidiWindow.
export interface MidiWindow { start: number; size: number }
const _windows = new Map<string, MidiWindow>();
const _windowListeners = new Set<() => void>();

function _setWindow(channelId: string, start: number, size: number): void {
  _windows.set(channelId, { start, size });
  _windowListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}

/** Read the active MIDI browse window for a mixer channel (null if none). */
export function useMidiWindow(channelId: string | undefined): MidiWindow | null {
  const [w, setW] = useState<MidiWindow | null>(channelId ? _windows.get(channelId) ?? null : null);
  useEffect(() => {
    const update = () => setW(channelId ? _windows.get(channelId) ?? null : null);
    _windowListeners.add(update);
    update();
    return () => { _windowListeners.delete(update); };
  }, [channelId]);
  return w;
}

// ── Activity-based auto-disable of autopilot + deck transitions ────────────
// Per Sina: on inbound MIDI activity, disable autopilot + transitions so the
// physical faders are authoritative; if MIDI goes idle for >1 min, restore the
// state we captured when activity began.
const MIDI_IDLE_MS = 60_000;
let _midiActive = false;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
let _priorAutopilot: boolean | null = null;
let _priorTransitions: boolean | null = null;

/** Idle-restore guard (P3-5). We only re-enable a subsystem on idle when TWO
 *  things hold: it was ON when activity began (`prior === true`), AND the
 *  operator has NOT touched it since — i.e. it is STILL sitting at the `false`
 *  our disable wrote (`current === false`). If the operator deliberately turned
 *  autopilot OFF on-screen during the active window, `current` is already false
 *  because THEY set it — but `prior` was true, so the naive "restore if prior"
 *  would clobber their choice. We therefore restore ONLY when current is still
 *  the disabled value we wrote; if `current` couldn't be read (null), we do NOT
 *  restore (fail safe: never fight a state we can't confirm). Pure + exported
 *  for unit testing without reaching into the runtime. */
export function shouldRestoreOnIdle(prior: boolean | null, current: boolean | null): boolean {
  return prior === true && current === false;
}

async function _onMidiActivity(): Promise<void> {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { void _onMidiIdle(); }, MIDI_IDLE_MS);
  if (_midiActive) return;
  _midiActive = true;
  // Capture current state BEFORE disabling, so idle can restore it.
  try {
    const ap = await getAutopilot();
    _priorAutopilot = ap.ok && ap.data ? !!ap.data.active : null;
  } catch { _priorAutopilot = null; }
  try {
    const tx = await fetchDeckTransitionConfig();
    _priorTransitions = tx.ok && tx.data ? !!tx.data.enabled : null;
  } catch { _priorTransitions = null; }
  // Disable. These ApiResults capture transport errors as { ok: false } (they
  // don't throw), so a swallowed .catch would HIDE a real disable failure and
  // leave autopilot fighting the operator's faders with no indication. Surface
  // it as a header-chip notice instead (codex P0: fail LOUD).
  setAutopilot(false).then((r) => {
    if (!r.ok) _setNotice('autopilot disable FAILED — it may keep fighting the faders');
    else _setNotice(null);
  }).catch(() => _setNotice('autopilot disable FAILED — it may keep fighting the faders'));
  setDeckTransitionConfig({ enabled: false }).then((r) => {
    if (!r.ok) _setNotice('deck-transition disable FAILED — transitions may still fire');
  }).catch(() => _setNotice('deck-transition disable FAILED — transitions may still fire'));
}

async function _onMidiIdle(): Promise<void> {
  _idleTimer = null;
  _midiActive = false;
  const priorAutopilot = _priorAutopilot;
  const priorTransitions = _priorTransitions;
  _priorAutopilot = null;
  _priorTransitions = null;
  // P3-5: don't blindly re-enable what we disabled — re-read the LIVE state and
  // restore ONLY if it is still the `false` our disable wrote. If the operator
  // deliberately changed it on-screen during the active window, leave it alone.
  if (priorAutopilot === true) {
    let current: boolean | null = null;
    try {
      const ap = await getAutopilot();
      current = ap.ok && ap.data ? !!ap.data.active : null;
    } catch { current = null; }
    if (shouldRestoreOnIdle(priorAutopilot, current)) {
      setAutopilot(true).catch(() => undefined);
    }
  }
  if (priorTransitions === true) {
    let current: boolean | null = null;
    try {
      const tx = await fetchDeckTransitionConfig();
      current = tx.ok && tx.data ? !!tx.data.enabled : null;
    } catch { current = null; }
    if (shouldRestoreOnIdle(priorTransitions, current)) {
      setDeckTransitionConfig({ enabled: true }).catch(() => undefined);
    }
  }
}

// The boot effect publishes its manager's repaint here so the engine-state
// effect can trigger an LED refresh without holding a React ref to the
// manager across renders.
let _nudge: (() => void) | null = null;

// Active mapping context = the focused CaptainPad tab ('deck' / 'mixer' / …).
// Tabs publish their context on focus via setMidiActiveContext(); the boot
// effect forwards changes to the live MidiManager.
let _activeContext = 'deck';
let _applyContext: ((name: string) => void) | null = null;

/** Called by a tab on focus to switch the controller's mapping context. The
 *  layout is unified; the context only decides whether the channel controls
 *  target the deck channel (deck) or the overlay layers (mixer). */
export function setMidiActiveContext(name: string): void {
  _activeContext = name;
  _snapshot = { ..._snapshot, activeContext: name };
  _applyContext?.(name);
  // Deck ↔ Mixer changes which channel is focused (deck channel vs the selected
  // overlay), so recompute `_snapshot.focused` for the new context.
  _bumpFocus();
}

// Live CPC schema keys (for paramCenter validation). The engine schema loads
// async AFTER the manager connects, so we read it through a getter and re-run
// validation when it changes — otherwise every key flashes "unknown" on boot.
let _schemaKeys: ReadonlySet<string> = new Set();
let _revalidate: (() => void) | null = null;

/** Read-only connection state for the header chip + Config tab. */
export function useMidiStatus(): MidiControlState {
  const [s, setS] = useState<MidiControlState>(_state);
  useEffect(() => {
    _listeners.add(setS);
    setS(_state);
    return () => { _listeners.delete(setS); };
  }, []);
  return s;
}

/** Aggregate the per-controller statuses into one chip state. */
export type MidiChipKind = 'unavailable' | 'disconnected' | 'connected' | 'error';

export function midiChipState(s: MidiControlState): { kind: MidiChipKind; message?: string } {
  // A live runtime notice (e.g. autopilot-disable failure) rides ALONGSIDE the
  // resolved kind: it appends to whatever message the state produces, so it is
  // visible in the chip's accessibility label / detail without masking the
  // controller's real connected/error status.
  const withNotice = (r: { kind: MidiChipKind; message?: string }): { kind: MidiChipKind; message?: string } => {
    if (!s.notice) return r;
    return { kind: r.kind, message: r.message ? `${r.message} — ${s.notice}` : s.notice };
  };
  if (!s.available) return withNotice({ kind: 'unavailable', message: 'MIDI not available on this platform' });
  if (s.profileError) return withNotice({ kind: 'error', message: s.profileError });
  const err = s.statuses.find((c) => c.kind === 'error');
  if (err) return withNotice({ kind: 'error', message: err.error });
  if (s.statuses.some((c) => c.kind === 'connected')) return withNotice({ kind: 'connected' });
  return withNotice({ kind: 'disconnected', message: 'No controller detected' });
}

function loadProfiles(): { profiles: ControllerProfile[]; error: string | null } {
  // Load ALL bundled controller profiles — the manager runs them concurrently,
  // and an absent controller simply shows disconnected. A validation failure on
  // ANY profile is fatal (fail loud): the offending YAML path is in the message.
  const specs: { name: string; raw: unknown }[] = [
    { name: 'apc_mini_mk2.yaml', raw: (apcProfileRaw as { default?: unknown }).default ?? apcProfileRaw },
    { name: 'mft.yaml', raw: (mftProfileRaw as { default?: unknown }).default ?? mftProfileRaw },
  ];
  try {
    const profiles = specs.map((s) => validateProfile(s.raw, s.name));
    return { profiles, error: null };
  } catch (err) {
    return { profiles: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Drive the MIDI control lifecycle. Call EXACTLY ONCE (RootShell). Returns the
 * live state for convenience, but most consumers should use useMidiStatus().
 */
export function useMidiControl(): MidiControlState {
  const engine = useEngineState();
  const [s, setS] = useState<MidiControlState>(_state);
  // Bumps that force the snapshot effect to rebuild `_snapshot.focused`: a focus
  // switch (track button / tab change) and a `playlistSaved` (a freshly-learned
  // binding must start applying without a reconnect).
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    _focusListeners.add(bump);
    const unsub = engineEvents.subscribe((m: { type?: string; name?: string }) => {
      // LED re-sync on pattern switch: the engine broadcasts { type:'pattern' }
      // on every pattern change (entry select / autopilot swap). fetchPlaylist's
      // 5 s TTL cache can otherwise serve STALE entry defaults/bindings to the
      // snapshot rebuild that follows, leaving rings/colours on the old values
      // (the hardware staleness Sina saw). Bust the ACTIVE playlists' cache
      // entries (deck + overlays + focused — the only ones the rebuild reads)
      // and force a rebuild so projectAndSend repaints from fresh data.
      if (m?.type === 'pattern') {
        for (const name of _activePlaylistNames()) invalidatePlaylistCache(name);
        bump();
        return;
      }
      // Only rebuild for a playlistSaved whose playlist is actually in the
      // deck / overlays / focused channel — an unrelated save can't change any
      // binding the manager applies, so skip the rebuild it would trigger.
      if (m?.type !== 'playlistSaved') return;
      if (typeof m.name === 'string' && !_activePlaylistNames().has(m.name)) return;
      bump();
    });
    return () => { _focusListeners.delete(bump); unsub(); };
  }, []);

  // ── Keep the module snapshot in sync with live engine state ──────────────
  // Mixer "layers" = overlay channels in order (the deck channel is separate).
  // Each layer's playlist entries are fetched (cached) so the pad window
  // browser can select entries + light the active one.
  useEffect(() => {
    let cancelled = false;
    const channels = engine.mixerChannels;
    const deck = engine.deckChannel as
      { id?: string; fader?: number; pattern?: string; playlist?: PlaylistAssignment | null } | null;
    // Publish the live channel/deck refs so the playlistSaved filter (above)
    // can tell whether a saved playlist is one the manager applies.
    _lastEngineChannels = channels;
    _lastEngineDeck = deck;
    // Current CPC global values (0..1) for the MFT bank-2 relative knobs — the
    // same derivation the live in-place patch uses (#10). Note: sharedParams is
    // no longer an effect dep; this reads the value at rebuild time and the
    // engineParamsEvents patch keeps it live between rebuilds.
    const globalParamValues = _deriveGlobalParamValues(engine.sharedParams?.params);
    // BPM→Speed sync engaged when the CPC `bpmSpeedSync` key is > 0.5.
    const bpmSpeedSyncOn = Number(globalParamValues['bpmSpeedSync']) > 0.5;
    // Fetch a channel's playlist entries (cached) for the pad window browser.
    const playlistFor = async (pl?: PlaylistAssignment | null) => {
      if (!pl?.name) return undefined;
      const r = await fetchPlaylist(pl.name);
      if (!r.ok || !r.data) return undefined;
      return { entries: r.data.entries.map((e) => ({ id: e.id })), activeEntryId: pl.activeEntryId ?? null };
    };
    void (async () => {
      const layers = await Promise.all(channels.map(async (c) => {
        const ch = c as { id: string; fader?: number; playlist?: PlaylistAssignment | null };
        return {
          id: ch.id,
          fader: typeof ch.fader === 'number' ? ch.fader : 1,
          playlist: await playlistFor(ch.playlist),
        };
      }));
      const deckLayer = deck?.id
        ? { id: deck.id, fader: typeof deck.fader === 'number' ? deck.fader : 1, playlist: await playlistFor(deck.playlist) }
        : null;

      // ── Focused channel — the param faders (4-8) drive its active pattern's
      //    learned bindings. Deck tab: the single deck channel. Mixer tab: the
      //    track-button-selected overlay. We carry its live exports (id ↔ name ↔
      //    current value, for name→id + soft-takeover) and its active entry's
      //    stored midiMappings (the bindings the manager applies). ──────────
      const ctx = _activeContext;
      // On the Mixer tab, a focus that points past the current channel list
      // (a deleted overlay, or a track button for a layer that never existed)
      // would build focused=null → dead faders with no recovery. Reset to
      // channel 0 and log it (codex: never silently swallow) before building.
      if (ctx !== 'deck' && _focusedLayer !== 0 && !channels[_focusedLayer]) {
        console.warn(`[midi] focused layer ${_focusedLayer} no longer exists (only ${channels.length} channel(s)); resetting focus to 0`);
        _setNotice(`MIDI focus reset to channel 1 (layer ${_focusedLayer + 1} no longer exists)`);
        _focusedLayer = 0;
        _bumpFocus();
      }
      const focusLayer = ctx === 'deck' ? 0 : _focusedLayer;
      const focusChan: MixerChannel | null = ctx === 'deck'
        ? (engine.deckChannel as MixerChannel | null)
        : (channels[focusLayer] as MixerChannel | undefined) ?? null;
      let focused: MidiEngineSnapshot['focused'] = null;
      if (focusChan?.id) {
        const pl = focusChan.playlist as PlaylistAssignment | null | undefined;
        const entryId = pl?.activeEntryId ?? null;
        // The active entry carries both the learned midiMappings AND the saved
        // per-param `defaults` (the encoder-push reset target). Fetch it ONCE
        // (cached, 5 s TTL — the same playlist `playlistFor()` fetched above, so
        // this hits the cache) and read both off it.
        let midiMappings: FocusedBinding[] = [];
        let entryDefaults: Record<string, unknown> = {};
        if (pl?.name && entryId) {
          const r = await fetchPlaylist(pl.name);
          if (r.ok && r.data) {
            const entry = (r.data.entries as { id: string; midiMappings?: unknown[]; defaults?: Record<string, unknown> }[])
              .find((e) => e.id === entryId);
            const raw = Array.isArray(entry?.midiMappings) ? entry!.midiMappings! : [];
            midiMappings = raw.flatMap((m) => {
              const b = m as FocusedBinding;
              if (b && b.control && b.target && Array.isArray(b.range)) return [b];
              console.warn('[midi] dropping malformed stored midiMapping on focused entry:', m);
              return [];
            });
            if (entry?.defaults && typeof entry.defaults === 'object') entryDefaults = entry.defaults;
          }
        }
        // #1 THE single knob order: knob i drives knobMapped[i]. deriveKnobOrder
        // is the ONE derivation of the learnable slider list (kind===1, not
        // cpcOwned, numeric v0); the same fn feeds the screens' knob badges, so
        // on-screen order ≡ physical knob order by construction, not coincidence.
        // (Replaces the old hand-filter that could drift from the screens'.)
        const { knobMapped } = deriveKnobOrder(focusChan.exports as Export[] | undefined);
        // N1 deck-scoped modulation: modulationState is DECK-only (the engine
        // broadcasts it with deckId 'main', modulation_controller.js:176). Apply
        // the `_modState` base/modulated anchor ONLY when the focused channel IS
        // the deck; a mixer channel with a name-colliding export must NOT inherit
        // the deck's base or a false "modulated" ring pulse — it anchors on v0.
        const isDeckFocus = ctx === 'deck';
        const exportsList = knobMapped.map((e) => {
          const v0 = e.v0 as number; // deriveKnobOrder guarantees a numeric v0
          // defaultValue: the entry's saved default for this param — only when
          // it's a finite number (never fabricate one; the consumer treats an
          // absent default as "reset deferred").
          const rawDefault = entryDefaults[e.name];
          const defaultValue = typeof rawDefault === 'number' && Number.isFinite(rawDefault)
            ? rawDefault
            : undefined;
          // base + modulated: the modulation anchor. For a modulated (deck) param
          // v0 is the moving modulated value, so `base` (the operator's stable set
          // value from modulationState) is the correct target for a knob delta.
          // Mixer focus → no deck modulation applies: base=v0, modulated=false.
          const mod = isDeckFocus ? _modState[e.name] : undefined;
          const modulated = !!mod;
          const base = mod?.base ?? v0;
          return { id: e.id, name: e.name, v0, defaultValue, base, modulated };
        });
        const role = ctx === 'deck' ? 'deck' : 'mixer';
        // Build the pickup re-lock identity ONCE (role:id:entryId:mappingIds);
        // the runtime compares it as a single string. Including entryId means a
        // fader re-picks-up after the active entry changes even when the
        // popover-derived mapping id (`midi_<param>`) is reused across entries.
        const key = `${role}:${focusChan.id}:${entryId ?? ''}:${midiMappings.map((m) => m.id).join(',')}`;
        // Per-channel hue (engine F-hue): serialized on EVERY mixer/deck
        // channel broadcast (a pre-field engine serializes 0 — the documented
        // schema default, same shape the strip's HUE trim reads). Threaded so
        // the MFT hue knob (which drives the FOCUSED channel's hue in BOTH
        // contexts — hue is per-channel only) can anchor on / re-sync to the
        // focused channel's live hue. Only a finite number passes; anything
        // else stays undefined → the knob is inert with a visible note
        // (never a fabricated anchor).
        const hueRaw = (focusChan as { hue?: unknown }).hue;
        const hue = typeof hueRaw === 'number' && Number.isFinite(hueRaw) ? hueRaw : undefined;
        focused = {
          role,
          layer: focusLayer,
          id: focusChan.id,
          entryId,
          key,
          exports: exportsList,
          midiMappings,
          hue,
        };
      }

      if (cancelled) return;
      _snapshot = {
        ..._snapshot,
        blackout: engine.blackout,
        activePattern: (deck?.pattern as string | undefined) ?? null,
        layers,
        deckLayer,
        activeContext: _activeContext,
        focused,
        globalParamValues,
        bpmSpeedSyncOn,
        // I4: the ONE home of the sync-owned-keys fact (D1's gate + D4's
        // projector read this, not a 'speed' literal). Derived from the flag.
        syncOwnedKeys: _deriveSyncOwnedKeys(bpmSpeedSyncOn),
      };
      _nudge?.();
    })();
    return () => { cancelled = true; };
    // #10: engine.sharedParams is NOT a dep — the full async rebuild is heavy
    // (fetches + LED projection) and CPC knobs tick at 10-30 Hz. Instead a
    // module-level engineParamsEvents subscription (boot effect) mirrors live
    // shared values into an IN-PLACE _snapshot patch + _nudge(), recomputing
    // globalParamValues / bpmSpeedSyncOn / syncOwnedKeys without the rebuild.
  }, [engine.blackout, engine.deckChannel, engine.mixerChannels, rev]);

  // ── Re-validate param keys when the engine CPC schema lands (async) ───────
  useEffect(() => {
    _schemaKeys = new Set(Object.keys(engine.paramSchema));
    _revalidate?.();
  }, [engine.paramSchema]);

  // ── Boot the manager once ────────────────────────────────────────────────
  useEffect(() => {
    _listeners.add(setS);

    // Mirror the engine's live modulationState onto _modState (the anchor cache
    // the snapshot reads for focused-export base/modulated). ONE subscription,
    // set up here and torn down in every return path — whole-state replacement
    // per frame, exactly like components/Modulation.tsx `useModulationState()`.
    // Also mirror live `sharedParams` frames into an IN-PLACE _snapshot patch
    // (#10) so the MFT bank-2 rings + the BPM-sync gate track live CPC values
    // without dropping sharedParams into the heavy async-rebuild effect's deps.
    const unsubMod = engineParamsEvents.subscribe(
      (m: { type?: string; parameters?: unknown; params?: unknown }) => {
        if (m?.type === 'modulationState' && m.parameters && typeof m.parameters === 'object') {
          _modState = m.parameters as Record<string, { base: number; modulated: number }>;
        } else if (m?.type === 'sharedParams') {
          _patchSharedParams(m.params as Record<string, { value?: unknown }> | undefined);
        }
      },
    );

    const transportKind = getMidiTransportKind();
    const factory = selectTransportFactory();
    if (!factory) {
      _set({ available: false, transportKind, profileError: null, statuses: [] });
      return () => { _listeners.delete(setS); unsubMod(); _modState = {}; };
    }

    const { profiles, error } = loadProfiles();
    if (error) {
      _set({ available: true, transportKind, profileError: error, statuses: [] });
      return () => { _listeners.delete(setS); unsubMod(); _modState = {}; };
    }
    // Publish the loaded profiles for the save-time conflict re-check.
    _loadedProfiles = profiles;
    // A driver that pushes a SysEx config on connect (the MFT's encoder-mode
    // setup, device.configureOnConnect) needs the SysEx capability on the shared
    // MIDIAccess — request it now, before the manager connects.
    //
    // N6 reality: both profiles are ALWAYS bundled and mft.yaml sets
    // configureOnConnect: true, so this predicate is true in EVERY deployment —
    // every operator gets Chrome's SysEx permission prompt (decision D-3: live
    // with it). There is no "APC-only rig" that skips the scope; the request is
    // unconditional in practice. Behavior is intentionally unchanged.
    if (profiles.some((p) => p.device.configureOnConnect)) setSysexRequested(true);

    _schemaKeys = new Set(Object.keys(engine.paramSchema));
    const manager = new MidiManager({
      profiles,
      transportFactory: factory,
      api: {
        updateParamCenter,
        updateMixerMaster,
        setActivePattern,
        setGlobalBlackout,
        setGlobalEffect,
        setSectionBrightness,
        setGroupFixedColor,
        updateMixerChannel,
        updateDeckChannel,
        dispatchGlobalEffectSlotAction,
        setGlobalEffectBlackout,
        setChannelPlaylistEntry,
        setDeckChannelControl,
        setMixerChannelControl,
        setChannelHue,
      },
      getSnapshot: () => _snapshot,
      getSchemaKeys: () => _schemaKeys,
      defaultContext: _activeContext,
      onActivity: () => { void _onMidiActivity(); },
      onWindowChange: (channelId, start, size) => _setWindow(channelId, start, size),
      onFocusChange: (layer) => setMidiFocus(layer),
      onStatusChange: (statuses) => {
        _set({ available: true, transportKind, profileError: null, statuses });
      },
    });

    let disposed = false;
    // Expose this manager's LED repaint so the engine-state effect below can
    // refresh feedback without holding a React ref across renders.
    _nudge = () => manager.onEngineUpdate();
    // Publish the manager's focus-intent writer (I2) so touch focus (setMidiFocus)
    // routes through the SAME requestedFocusLayer the APC uses — one source of
    // truth (#2). Cleared in cleanup so a stale closure never runs post-dispose.
    _setFocusIntent = (layer) => manager.setFocusIntent(layer);
    // Forward active-tab changes (Deck/Mixer) to the manager's mapping context.
    _applyContext = (name) => manager.setContext(name);
    // Expose MIDI-learn arming for the per-param map popover.
    _armLearn = (cb) => manager.armLearn(cb);
    // Forward CPC-schema arrival so param-key validation re-runs.
    _revalidate = () => manager.revalidate();
    // Seed the pattern list for pattern-bank dispatch + LED highlight. Named so
    // the engine-connected transition (P2-6) can re-run it — if CaptainPad
    // booted BEFORE the engine, the initial fetch fails silently and the 16
    // pattern pads would stay dark for the night; re-running on connect lights
    // them the moment the engine appears.
    const refreshPatterns = () => {
      fetchPatterns().then((r) => {
        if (r.ok && r.data) {
          _snapshot = { ..._snapshot, patterns: r.data };
          if (!disposed) manager.onEngineUpdate();
        }
      }).catch(() => undefined);
    };
    refreshPatterns();

    // Global-effect slots: count (for "off when out of slots") + active state
    // (for scene-button LEDs). Re-fetched on global-effect WS broadcasts.
    const refreshSlots = () => {
      fetchGlobalEffectSlotsStatus().then((r) => {
        if (!r.ok || !r.data?.slots) return;
        _snapshot = {
          ..._snapshot,
          globalEffectSlots: r.data.slots.map((s) => ({
            slot: s.slotId,
            active: !!s.active,
            // Thread the engine's per-slot behavior ('toggle' | 'trigger' |
            // 'hold') so the pad dispatch is BEHAVIOR-AWARE — a 'trigger' slot
            // (Iceberg Flash / White Drop) must fire 'trigger', not 'toggle'.
            // The REST field is a bare string; narrow to the known union and
            // drop anything unexpected to undefined so the dispatcher's
            // fail-safe ('toggle') owns the odd case rather than a bad literal.
            behavior: narrowSlotBehavior(s.behavior),
          })),
        };
        if (!disposed) manager.onEngineUpdate();
      }).catch(() => undefined);
    };
    refreshSlots();
    const unsubSlots = engineEvents.subscribe((m: { type?: string }) => {
      if (typeof m?.type === 'string' && m.type.toLowerCase().includes('globaleffect')) refreshSlots();
    });

    // Legacy global-effect toggle state (P3-4). The `globalEffect` action kind
    // toggles `!getGlobalEffectState(effect)`, so with globalEffects never
    // populated it could only ever flip from false→true (can't turn one off) and
    // the pad LED stayed dark. GET /globals returns globalsState.effects (a
    // Record<string,boolean>); mirror it. Re-fetched on global-effect WS
    // broadcasts (same trigger as the slots) AND on the engine-connected
    // transition. Note: the engine does NOT broadcast the legacy toggle map, so
    // the connect-transition refresh is the authoritative catch-up path.
    const refreshGlobalEffects = () => {
      fetchGlobals().then((r) => {
        if (!r.ok || !r.data) return;
        const raw = (r.data as { effects?: unknown }).effects;
        if (!raw || typeof raw !== 'object') return;
        const effects: Record<string, boolean> = {};
        for (const key of Object.keys(raw as Record<string, unknown>)) {
          effects[key] = !!(raw as Record<string, unknown>)[key];
        }
        _snapshot = { ..._snapshot, globalEffects: effects };
        if (!disposed) manager.onEngineUpdate();
      }).catch(() => undefined);
    };
    refreshGlobalEffects();
    // (The `globalHueShift` WS subscription was removed 2026-07 with the
    // global hue shifter — the hue knob's ring now tracks the FOCUSED
    // channel's hue, which rides the mixer/deck broadcasts into
    // `_snapshot.focused.hue` via the snapshot rebuild.)
    // The slots subscription above already fires on every `*globaleffect*` WS
    // message; piggy-back the legacy toggle refresh on the SAME filter so a
    // legacy effect toggled from another surface repaints its pad LED too.
    const unsubEffects = engineEvents.subscribe((m: { type?: string }) => {
      if (typeof m?.type === 'string' && m.type.toLowerCase().includes('globaleffect')) refreshGlobalEffects();
    });

    // Curated colour palette pairs for the colour-pair pads (warmed at boot).
    // Named so the engine-connected transition (P2-6) can re-warm it — if the
    // cache warm failed because the engine wasn't up yet, the 16 colour-pair
    // pads would stay dark; re-warming on connect fills them.
    const refreshColorPalettes = () => {
      warmColorPalettesCache().then(() => {
        const pals = getCachedColorPalettes();
        if (pals.length) {
          _snapshot = { ..._snapshot, colorPalettes: pals.map((p) => ({ c1: p.c1, c2: p.c2 })) };
          if (!disposed) manager.onEngineUpdate();
        }
      }).catch(() => undefined);
    };
    refreshColorPalettes();

    // P2-6: engine-connected transition catch-up. The boot seeds above run once;
    // if CaptainPad boots before the engine they all fail silently and the pads
    // stay dark forever (the "unlit pad = nothing behind it" loud-silence rule
    // would then LIE). subscribeStatus fires immediately with the current status
    // AND on every open/close, so we re-run the one-shot seeds on each FALSE→TRUE
    // transition (a real (re)connect) — NOT on the initial immediate fire (the
    // boot seeds already cover that), avoiding a duplicate fetch storm.
    let _wasConnected = engineEvents.getStatus().connected;
    const unsubConn = engineEvents.subscribeStatus((st) => {
      if (st.connected && !_wasConnected) {
        refreshPatterns();
        refreshColorPalettes();
        refreshSlots();
        refreshGlobalEffects();
      }
      _wasConnected = st.connected;
    });

    manager.start().then(() => {
      if (!disposed) manager.onEngineUpdate();
    }).catch(() => undefined);

    return () => {
      disposed = true;
      _nudge = null;
      _setFocusIntent = null;
      _applyContext = null;
      _armLearn = null;
      _revalidate = null;
      _loadedProfiles = [];
      unsubSlots();
      unsubEffects();
      unsubConn();
      unsubMod();
      _modState = {};
      manager.dispose();
      _listeners.delete(setS);
    };
    // Boot once — engine.paramSchema is read for the initial validation; later
    // schema arrivals are rare (engine restart) and don't need a re-boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Push LED updates whenever engine state changes ───────────────────────
  // (handled by the manager via the snapshot; nudge a repaint on key changes)
  useEffect(() => {
    // The manager instance lives inside the boot effect; we re-derive LED
    // state through the module snapshot, so a lightweight global nudge is
    // enough. We expose it via a module function set by the boot effect.
    _nudge?.();
  }, [engine.blackout, engine.deckChannel]);

  return s;
}

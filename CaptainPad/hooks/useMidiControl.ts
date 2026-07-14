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
import { router } from 'expo-router';

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
  setGlobalEffectSlotIntensity,
  resetGlobalEffectSlotIntensity,
  setEffectsPage,
  cycleGlobalEffectSlotMode,
  resetAllGlobalEffects,
  disableAllGlobalEffects,
  fetchEffectsPage,
  fetchControllerProfile,
  patchControllerProfile,
  getAutopilot,
  setAutopilot,
  fetchDeckColorAutopilot,
  setDeckColorAutopilot,
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
import { summonPerformanceDialog } from '@/hooks/usePerformanceMode';
import { fadeMaster } from '@/utils/masterApi';
import { getSelectedFadeSeconds } from '@/components/MasterFadeGroup';
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
import {
  combinedAutopilotTarget,
  combinedAutopilotLedOn,
  colorAutopilotWritable,
  masterFadeTarget,
  createAutopilotToggleExemption,
  deckMixerToggleTarget,
} from '@/utils/midi/apc_button_logic';
import apcProfileRaw from '@/midi_profiles/apc_mini_mk2.yaml';
import mftProfileRaw from '@/midi_profiles/mft.yaml';
import vsn1ProfileRaw from '@/midi_profiles/vsn1.yaml';

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
function narrowSlotBehavior(behavior: unknown): GlobalEffectSlotBehavior | undefined {
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
  // VSN1 controller profile — 'edit' (full authoring UI) until the engine threads
  // it via GET/WS. The sb_2 toggle reads this to PATCH the opposite; the engine
  // broadcast keeps it live.
  controllerProfile: 'edit',
  // syncOwnedKeys (contract I4): the global-param keys the engine currently
  // drives itself (e.g. 'speed' while BPM→Speed sync is on). Empty at boot;
  // populated from `bpmSpeedSyncOn` in the snapshot rebuild + the in-place patch.
  syncOwnedKeys: new Set<string>(),
  // combinedAutopilotActive: drives the APC clip_stop LED (lit when BOTH the
  // pattern autopilot AND the deck colour autopilot are on). Off at boot;
  // patched live from the engine's `autopilot` / `colorAutopilot` WS broadcasts
  // (below) so the LED tracks the state a clip_stop press would turn off.
  combinedAutopilotActive: false,
  // performanceModeActive: drives the APC solo LED (lit while performance mode
  // is active). Off at boot; patched live from the engine's `performanceMode`
  // WS broadcast (below — replayed on connect).
  performanceModeActive: false,
};

// ── APC clip_stop LED: combined (pattern + colour) autopilot state ─────────
// The engine broadcasts pattern autopilot on `{ type:'autopilot', active }` and
// deck colour autopilot on `{ type:'colorAutopilot', active }` (separate WS
// events). We mirror each `active` flag into a module cache and recompute the
// COMBINED state (both-on) into the snapshot on any change, then nudge an LED
// repaint. Seeded false; the connect replay of both events fills them in on the
// first frame (a pre-field engine simply never flips them → LED stays dark).
let _patternAutopilotOn = false;
let _colorAutopilotOn = false;
// Whether the deck COLOUR autopilot is WRITABLE (a non-empty palette set is
// configured). The engine rejects EVERY color-autopilot write when palettes are
// empty (codex P0 strict validation) — for both directions — so an unconfigured
// colour autopilot can never be on, and the clip_stop toggle must degrade to a
// pattern-only toggle. Mirrored from the `colorAutopilot` WS broadcast's
// `palettes` (which colorAutopilotState() always serializes). Seeded false: a
// pre-field engine that never broadcasts palettes reads as not-writable, so the
// LED tracks the pattern autopilot alone rather than a permanently-dark combined.
let _colorAutopilotWritable = false;

/** Recompute the APC clip_stop LED state into `combinedAutopilotActive` and nudge
 *  a repaint. The field feeds manager.ts's getCombinedAutopilotActive → the
 *  clip_stop LED. Its MEANING is "the autopilot is on" as the operator reads it
 *  (the state a press turns OFF): BOTH autopilots on when the colour side is
 *  writable, else PATTERN autopilot alone (an unconfigured colour autopilot can
 *  never be on, so requiring both-on would leave the LED permanently dark even
 *  though a press turns pattern autopilot on). Called on either autopilot's
 *  `active`/palettes change (WS) or after a clip_stop toggle writes. */
function _patchCombinedAutopilot(): void {
  const ledOn = combinedAutopilotLedOn(_patternAutopilotOn, _colorAutopilotOn, _colorAutopilotWritable);
  if (_snapshot.combinedAutopilotActive === ledOn) return; // no churn on repeats
  _snapshot = { ..._snapshot, combinedAutopilotActive: ledOn };
  _nudge?.();
}

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

// ── clip_stop / combined-autopilot exemption from the activity auto-disable ──
// The APC clip_stop press (autopilotToggle → toggleCombinedAutopilot) is the ONE
// inbound action whose whole point is to turn PATTERN autopilot ON. But the
// auto-disable above turns PATTERN autopilot OFF on the first inbound MIDI after
// a long idle — so a clip_stop that is that first activity would have its own
// "turn ON" write stomped by the idle auto-disable's `setAutopilot(false)`.
//
// The exemption is a one-shot claim/consume pair (pure factory in
// apc_button_logic — the ordering rationale lives on it): the toggle CLAIMS the
// current activity window synchronously (before any await); the auto-disable
// then asks shouldRunPatternDisable(), which returns false exactly once per
// claim. Only the pattern-autopilot disable is skipped for a clip_stop window
// (the deck-transition disable is untouched — that side never fights clip_stop);
// every OTHER inbound MIDI is unclaimed and its auto-disable is unchanged.
const _autopilotToggleExemption = createAutopilotToggleExemption();

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
  // clip_stop exemption: if THIS activity is a combined-autopilot toggle, its
  // synchronous prefix has already run (see the flag's note) and it OWNS the
  // pattern-autopilot direction. Skip our pattern `setAutopilot(false)` so we
  // don't stomp its intended turn-on; consume the one-shot flag so the NEXT
  // (non-toggle) activity disables normally. The deck-transition disable is
  // unaffected either way. NOTE: we also leave `_priorAutopilot` as captured —
  // the idle-restore guard (shouldRestoreOnIdle) already only re-enables when
  // the live state is still the `false` we wrote, and we wrote nothing here, so
  // it won't fight the toggle's result on idle.
  // Disable. These ApiResults capture transport errors as { ok: false } (they
  // don't throw), so a swallowed .catch would HIDE a real disable failure and
  // leave autopilot fighting the operator's faders with no indication. Surface
  // it as a header-chip notice instead (codex P0: fail LOUD). The pattern
  // disable is skipped exactly for a clip_stop-claimed window (consumes the
  // claim); every other activity runs it as before.
  if (_autopilotToggleExemption.shouldRunPatternDisable()) {
    setAutopilot(false).then((r) => {
      if (!r.ok) _setNotice('autopilot disable FAILED — it may keep fighting the faders');
      else _setNotice(null);
    }).catch(() => _setNotice('autopilot disable FAILED — it may keep fighting the faders'));
  }
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

// PlaylistPanel publishes a UI list TAP here so the MIDI manager can recenter the
// APC browse window around the tapped entry — the ONLY active-entry source allowed
// to recenter (operator policy 2026-07; APC pad-select / autopilot / echoes never
// move the window). Bound to the live manager in the boot effect, nulled on dispose.
let _noteUiPatternSelect: ((channelId: string, entryId: string) => void) | null = null;

/** Called by the CaptainPad list UI (PlaylistPanel.handleEntryTap) when the
 *  operator taps a pattern row with mouse/touch. Forwards to the live MidiManager
 *  so the browse window recenters around the tapped entry. No-op until the manager
 *  boots (a tap before boot simply doesn't recenter — the window isn't live yet). */
export function noteMidiPatternSelect(channelId: string, entryId: string): void {
  _noteUiPatternSelect?.(channelId, entryId);
}

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

// ── APC operator re-layout (2026-07): live state the three new buttons read ──
// The grand-master value (0..1), mirrored from the engine so the APC master-fade
// toggle (stop_all_clips) can decide TO BLACK vs UP without a React hook. Updated
// by the LED-nudge effect (which already depends on `engine`). Seeded to the
// engine's cold-boot default (1 = full up).
let _liveMaster = 1;

/** Toggle the active CaptainPad tab Deck ↔ Mixer (APC Shift). Reads the current
 *  tab from `_activeContext` (the same signal the tabs publish on focus) and
 *  navigates the OTHER. From a non-Deck/Mixer tab (e.g. Config) the operator's
 *  Shift lands them on the Deck — a sensible, documented home. Returns a
 *  MidiApiResult so a navigation throw surfaces through the fail-loud path. */
export async function toggleDeckMixerView(): Promise<{ ok: boolean; error?: string }> {
  try {
    // From Mixer → Deck; from Deck (or any other tab) → Mixer. `_activeContext`
    // is 'mixer' only while the Mixer tab is focused; every other tab (deck +
    // the utility tabs) reads as non-mixer, so Shift always reaches Deck/Mixer.
    // Derive the route AND the MIDI context from the SAME current context, so
    // navigation and the published mapping context can never diverge.
    const { route, context } = deckMixerToggleTarget(_activeContext);
    // `route` is one of the two static tab routes ('/(tabs)' | '/(tabs)/mixer')
    // — both valid expo-router hrefs. The helper types it as the wider `string`
    // (it is transport-agnostic), so assert the href type at the navigate call.
    router.navigate(route as Parameters<typeof router.navigate>[0]);
    // Publish the MIDI context HERE, alongside the navigation. The destination
    // screen's useFocusEffect ALSO calls setMidiActiveContext, but on the
    // APC-Shift router.navigate path that effect can be skipped/slow — leaving
    // the knobs in 'deck' context while the operator stares at the mixer (the
    // mixer-locals-do-nothing bug). setMidiActiveContext is idempotent, so the
    // redundant effect call is a no-op; the point is that context is set NO
    // MATTER how the mixer is reached. `setMixerView` (the engine output
    // switch) stays owned by the screen effects — we only move the MIDI mapping
    // context here.
    setMidiActiveContext(context);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Combined pattern+color autopilot toggle (APC clip_stop). Reads BOTH current
 *  states; if AT LEAST ONE is on the press turns BOTH on, if BOTH are on it turns
 *  BOTH off. A failed READ surfaces as a fail-loud result (we never guess a state
 *  and then fight the engine).
 *
 *  THE 4TH-FADER-CLASS BUG (why this "already correct on paper" toggle didn't
 *  toggle on hardware): the engine validates EVERY `/deck/color-autopilot` write
 *  strictly — the merged config must carry a NON-EMPTY palette set or the POST
 *  400s, in BOTH directions. Out of the box no palettes are configured, so the
 *  old unconditional `setDeckColorAutopilot({ active: next })` ALWAYS 400'd:
 *  `setAutopilot(next)` (pattern) had already landed, so the press half-applied
 *  and returned {ok:false}. Worse, with the colour side unwritable "both on" is
 *  unreachable, so the both-aware direction could never reach its "turn OFF"
 *  branch — the toggle looked dead. Fix: when the colour autopilot is NOT
 *  writable, this becomes a PURE PATTERN toggle — we write only the pattern
 *  autopilot and skip the guaranteed-400 colour write. When palettes ARE
 *  configured, both flip together as before. */
export async function toggleCombinedAutopilot(): Promise<{ ok: boolean; error?: string }> {
  // Claim this activity window SYNCHRONOUSLY (before any await) so the
  // activity-based auto-disable — which fired first this turn but only reaches
  // its pattern `setAutopilot(false)` after two awaited round-trips — skips the
  // pattern-autopilot disable and lets our intended direction below win.
  _autopilotToggleExemption.claim();
  const patternRes = await getAutopilot();
  const colorRes = await fetchDeckColorAutopilot();
  if (!patternRes.ok || !patternRes.data) {
    return { ok: false, error: `pattern autopilot read failed: ${patternRes.error ?? 'no data'}` };
  }
  if (!colorRes.ok || !colorRes.data) {
    return { ok: false, error: `color autopilot read failed: ${colorRes.error ?? 'no data'}` };
  }
  const patternOn = !!patternRes.data.active;
  const colorOn = !!colorRes.data.active;
  // Is the colour autopilot writable this instant? (Non-empty palette set — the
  // engine rejects an empty-palette write in either direction.) Read from the
  // SAME config we just fetched, so the decision matches the engine's own view.
  const colorToggleable = colorAutopilotWritable(colorRes.data.palettes);
  // Direction (pure): with colour toggleable → both on → off, else on. Without it
  // → pure pattern toggle (!patternOn), and we write ONLY the pattern autopilot.
  const next = combinedAutopilotTarget(patternOn, colorOn, colorToggleable);
  const wPattern = await setAutopilot(next);
  if (!wPattern.ok) return { ok: false, error: `pattern autopilot write failed: ${wPattern.error ?? 'unknown'}` };
  // Keep the LED cache honest immediately (the WS `autopilot` broadcast will also
  // arrive, but this makes the light follow the press without waiting on it).
  _patternAutopilotOn = next;
  if (colorToggleable) {
    const wColor = await setDeckColorAutopilot({ active: next });
    if (!wColor.ok) return { ok: false, error: `color autopilot write failed: ${wColor.error ?? 'unknown'}` };
    _colorAutopilotOn = next;
    _colorAutopilotWritable = true;
  } else {
    // Unconfigured colour autopilot: it's definitionally off and we sent no write.
    _colorAutopilotOn = false;
    _colorAutopilotWritable = false;
  }
  _patchCombinedAutopilot();
  return { ok: true };
}

/** Master FADE toggle (APC stop_all_clips). If the master is NOT already black,
 *  fade TO BLACK (target 0); if it IS black, fade UP (target 1). Duration comes
 *  from the MasterFadeGroup store (`getSelectedFadeSeconds`) — the same pill the
 *  operator picks on-screen, never hardcoded. 0 s = INSTANT snap (the timed-fade
 *  route rejects durationMs<=0), matching the UI's runFade(). */
export async function toggleMasterFade(): Promise<{ ok: boolean; error?: string }> {
  // Direction (pure): not-black → fade to black (0); already black → fade up (1).
  const target = masterFadeTarget(_liveMaster);
  const seconds = getSelectedFadeSeconds();
  const res = seconds > 0
    ? await fadeMaster(target, seconds * 1000)
    : await updateMixerMaster(target);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

// Effects v2 WELCOME: the effects panel calls this on mount so CaptainPad sends
// the VSN1 a one-shot hello + a full feedback re-sync (task: "hello + full state
// on effects load"). Routed to the live MidiManager (only the VSN1 profile acts;
// a no-op while no manager is mounted / disconnected — the reconnect path then
// carries the hello). Cleared in the boot-effect cleanup.
let _requestVsn1Welcome: (() => void) | null = null;

/** Called by the effects panel when it first loads: emit the VSN1 WELCOME (hello
 *  + full feedback re-sync). Safe before the manager mounts (no-op). */
export function notifyEffectsPanelLoaded(): void {
  _requestVsn1Welcome?.();
}

// Item 2: the live manager's post-deploy re-sync, published by the boot effect.
// The `vsn1LayoutDeploy` WS subscription routes here on a completed flash so the
// device restores its view mode + feedback WITHOUT re-arming the welcome.
let _resyncVsn1AfterDeploy: (() => void) | null = null;

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

// ── Performance-dialog controller affordance ───────────────────────────────
// The physical button name of a CONNECTED controller that binds the
// `performanceDialog` action ("SOLO" on the APC mini mk2). The enter-confirm
// sheet renders a "PRESS SOLO AGAIN TO GO LIVE" row only when this is non-null;
// with no such controller connected the sheets render exactly as before.
// Names are per-device (the physical print on the button), with a generic
// fallback for a future profile that binds the action under another key.
const PERFORMANCE_DIALOG_BUTTON_BY_DEVICE: Record<string, string> = {
  apc_mini_mk2: 'SOLO',
};

/** True iff this profile binds a performanceDialog control in any context. */
function profileHasPerformanceDialog(p: ControllerProfile): boolean {
  return Object.values(p.contexts).some(
    (controls) => controls.some((c) => c.action.kind === 'performanceDialog'),
  );
}

/** The performanceDialog button name of the first CONNECTED controller that
 *  binds it, or null (no controller / none connected binds the action). */
export function usePerformanceDialogButton(): string | null {
  const s = useMidiStatus();
  for (const st of s.statuses) {
    if (st.kind !== 'connected') continue;
    const profile = _loadedProfiles.find((p) => p.device.id === st.deviceId);
    if (profile && profileHasPerformanceDialog(profile)) {
      return PERFORMANCE_DIALOG_BUTTON_BY_DEVICE[st.deviceId] ?? 'THE MODE BUTTON';
    }
  }
  return null;
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
    { name: 'vsn1.yaml', raw: (vsn1ProfileRaw as { default?: unknown }).default ?? vsn1ProfileRaw },
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
        setGlobalEffectSlotIntensity,
        resetGlobalEffectSlotIntensity,
        setEffectsPage,
        cycleGlobalEffectSlotMode,
        resetAllGlobalEffects,
        disableAllGlobalEffects,
        // VSN1 sb_2 profile switch: the manager computes the target ('edit'/'play')
        // from the snapshot and PATCHes it here. utils/api exposes it as
        // `patchControllerProfile`; the dispatch API key is `setControllerProfile`.
        setControllerProfile: patchControllerProfile,
        setChannelPlaylistEntry,
        setDeckChannelControl,
        setMixerChannelControl,
        setChannelHue,
        // APC operator re-layout (2026-07): the three buttons that read live app
        // state (current tab / autopilot states / master + selected duration)
        // are implemented HERE (the hook owns the router + engine reads) and
        // injected as api methods so the manager/dispatcher stay pure + DI'd.
        toggleDeckMixerView,
        toggleCombinedAutopilot,
        toggleMasterFade,
        // APC solo (2026-07-13): summon the performance-mode dialog in the UI.
        // Never a blind engine toggle — the header control opens the guarded
        // enter-confirm / KEEP-RESTORE sheet and the operator answers on the
        // iPad. Fail loud when no dialog UI is mounted to receive the summon.
        summonPerformanceDialog: async () => {
          const handled = summonPerformanceDialog();
          return handled
            ? { ok: true }
            : { ok: false, error: 'performance-mode dialog UI not mounted' };
        },
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
    // Forward CaptainPad list UI taps so the manager recenters the browse window
    // around the tapped entry (the sole recentering source — operator policy).
    _noteUiPatternSelect = (channelId, entryId) => manager.noteUiPatternSelect(channelId, entryId);
    // Expose MIDI-learn arming for the per-param map popover.
    _armLearn = (cb) => manager.armLearn(cb);
    // Forward CPC-schema arrival so param-key validation re-runs.
    _revalidate = () => manager.revalidate();
    // Effects v2 WELCOME: the effects panel's mount routes here → VSN1 hello + full re-sync.
    _requestVsn1Welcome = () => manager.requestVsn1Welcome();
    // Item 2: a completed VSN1 layout auto-deploy routes here → re-echo view mode
    // + full feedback re-sync (device VM was re-flashed), never the welcome.
    _resyncVsn1AfterDeploy = () => manager.resyncVsn1AfterLayoutDeploy();
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

    // Map one engine status-slot (REST GET or the inline WS broadcast payload —
    // SAME shape, `globalEffectSlotManager.getStatus()`) to the manager snapshot
    // slot. Shared so the GET path and the inline-broadcast path can never drift.
    const mapStatusSlot = (s: {
      slotId: number; active?: unknown; behavior?: unknown;
      effectId?: unknown; label?: unknown; enabled?: unknown;
      intensity?: unknown; intensityDefault?: unknown;
      mode?: unknown; modeLabel?: unknown; modeValues?: unknown;
    }) => ({
      slot: s.slotId,
      active: !!s.active,
      // Effects v2 LAYOUT identity for the VSN1 feedback path: the bound effect
      // id + display label, so a swap/clear (from any surface) is detected and a
      // full device re-send forced. A DISABLED slot reports empty effectId — the
      // engine's clear only flips `enabled` and keeps the stale effectId, so the
      // layout identity must reflect the disabled state, mirroring the UI's
      // enabled+effectId "bound" predicate. Only carried when present.
      effectId: (s.enabled === false)
        ? ''
        : (typeof s.effectId === 'string' ? s.effectId : undefined),
      label: typeof s.label === 'string' ? s.label : undefined,
      // Thread the engine's per-slot behavior ('toggle' | 'trigger' | 'hold') so
      // the pad dispatch is BEHAVIOR-AWARE — a 'trigger' slot (Iceberg Flash /
      // White Drop) must fire 'trigger', not 'toggle'. The REST field is a bare
      // string; narrow to the known union and drop anything unexpected to
      // undefined so the dispatcher's fail-safe ('toggle') owns the odd case.
      behavior: narrowSlotBehavior(s.behavior),
      // Driver #3 (VSN1): the slot's live intensity + its default. Only carried
      // when numeric — a pre-field engine leaves them undefined (jog stays inert,
      // never a fabricated 0).
      intensity: typeof s.intensity === 'number' ? s.intensity : undefined,
      intensityDefault: typeof s.intensityDefault === 'number' ? s.intensityDefault : undefined,
      // Effects v2: the slot's discrete `primaryMode` (current value, label, list).
      mode: (s.mode as string | number | boolean | null | undefined) ?? undefined,
      modeLabel: typeof s.modeLabel === 'string' ? s.modeLabel : undefined,
      modeValues: Array.isArray(s.modeValues) ? (s.modeValues as (string | number | boolean)[]) : undefined,
    });

    const applySlots = (slots: { slotId: number }[]) => {
      _snapshot = { ..._snapshot, globalEffectSlots: slots.map(mapStatusSlot) };
      if (!disposed) manager.onEngineUpdate();
    };

    // Global-effect slots: count (for "off when out of slots") + active state
    // (for scene-button LEDs) + intensity/mode (VSN1 feedback). A WS broadcast
    // that CARRIES `slots` inline (globalEffectMacroStatus / globalEffectSlots)
    // is consumed DIRECTLY — no GET round-trip, no race between the broadcast and
    // a re-fetch that could read a pre-change status. Only a payload-less trigger
    // (or the boot/reconnect seed) falls back to the REST GET. This is the
    // low-latency UI→device path: a UI tap's broadcast repaints the device on the
    // very next frame instead of after an HTTP round-trip.
    const refreshSlots = (inlineSlots?: { slotId: number }[]) => {
      if (inlineSlots && inlineSlots.length) { applySlots(inlineSlots); return; }
      fetchGlobalEffectSlotsStatus().then((r) => {
        if (!r.ok || !r.data?.slots) return;
        applySlots(r.data.slots);
      }).catch(() => undefined);
    };
    refreshSlots();

    // Effects v2: the active effects PAGE (0..3) — the engine's single source of
    // truth. Seed it once and re-fetch on any global-effect WS broadcast (the
    // engine broadcasts `effectsPage` on a page change). Threading it into the
    // snapshot lets the VSN1 side-button LEDs + the MIDI feedback report the
    // current page, and keeps the manager's page-select dispatch converging.
    const refreshEffectsPage = () => {
      fetchEffectsPage().then((r) => {
        if (!r.ok || !r.data || typeof r.data.effectsPage !== 'number') return;
        _snapshot = { ..._snapshot, effectsPage: r.data.effectsPage };
        if (!disposed) manager.onEngineUpdate();
      }).catch(() => undefined);
    };
    refreshEffectsPage();
    const unsubPage = engineEvents.subscribe((m: { type?: string; effectsPage?: unknown }) => {
      // The engine broadcasts `{ type:'effectsPage', effectsPage }` (canonical key).
      // Consume the inline page when present (no extra GET); otherwise a
      // global-effect broadcast re-fetches. Kept inert for unrelated messages.
      if (m?.type === 'effectsPage') {
        if (typeof m.effectsPage === 'number') {
          _snapshot = { ..._snapshot, effectsPage: m.effectsPage };
          if (!disposed) manager.onEngineUpdate();
        } else {
          refreshEffectsPage();
        }
      }
    });
    // VSN1 CONTROLLER PROFILE ('edit' | 'play') — the engine's single source of
    // truth (GET/PATCH /global-effects/profile, WS-broadcast `controllerProfile`,
    // replayed on connect). Thread it into the MIDI snapshot so the sb_2 toggle
    // reads the current profile to PATCH the opposite, and so the VSN1 feedback
    // path reflects the active profile. The UI grid presentation follows the SAME
    // broadcast via the separate useControllerProfile hook — this is the MIDI-side
    // mirror. NO optimistic flip (the sb_2 press awaits this echo). On a profile
    // change the engine also runs a page-0 device redeploy → the `vsn1LayoutDeploy`
    // ok path already fires the full feedback resync; we ALSO resync here so the
    // device repaints even if the profile broadcast lands without/before a deploy
    // frame (the resync flag is idempotent — it consumes exactly once).
    const refreshControllerProfile = () => {
      fetchControllerProfile().then((r) => {
        if (!r.ok || !r.data || (r.data.profile !== 'edit' && r.data.profile !== 'play')) return;
        if (_snapshot.controllerProfile === r.data.profile) return;
        _snapshot = { ..._snapshot, controllerProfile: r.data.profile };
        if (!disposed) manager.onEngineUpdate();
      }).catch(() => undefined);
    };
    refreshControllerProfile();
    const unsubProfile = engineEvents.subscribe((m: { type?: string; profile?: unknown }) => {
      if (m?.type !== 'controllerProfile') return;
      if (m.profile !== 'edit' && m.profile !== 'play') return;
      if (_snapshot.controllerProfile === m.profile) return;
      _snapshot = { ..._snapshot, controllerProfile: m.profile };
      if (disposed) return;
      manager.onEngineUpdate();
      // Full feedback resync (the device VM was re-flashed by the page-0 redeploy
      // the profile change triggered). Idempotent with the deploy-ok path.
      _resyncVsn1AfterDeploy?.();
    });
    const unsubSlots = engineEvents.subscribe((m: { type?: string; slots?: unknown }) => {
      if (typeof m?.type !== 'string' || !m.type.toLowerCase().includes('globaleffect')) return;
      // Consume the inline slots payload when the broadcast carries it
      // (globalEffectMacroStatus / globalEffectSlots both do) — no GET, no race;
      // a blackout-only status (no `slots`) falls back to the REST GET.
      const inline = Array.isArray(m.slots) ? (m.slots as { slotId: number }[]) : undefined;
      refreshSlots(inline);
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

    // Item 2: VSN1 layout auto-deploy → device VM restart. When a CaptainPad
    // effect change triggers the engine's layout auto-deploy, the engine
    // broadcasts `{ type:'vsn1LayoutDeploy', deploying, lastResult, ... }`
    // (lib/vsn1_layout_deploy.js). A deploy re-flashes the device, restarting its
    // Lua VM and resetting every device global to its INIT default (view mode →
    // DRUM, active/value/mode → empty). On a COMPLETED, SUCCESSFUL deploy
    // (deploying === false && lastResult === 'ok') we re-echo the host-owned view
    // mode + force a full feedback re-sync so the device returns to its prior
    // mode + live state. This must NOT re-arm the welcome (item 1) — a re-flash is
    // not a fresh connect — so it routes to resyncVsn1AfterLayoutDeploy, which
    // never sets vsn1WelcomePending. In-flight (`deploying === true`) and
    // failed/disabled results are ignored: nothing to restore until a good flash
    // lands (fail-loud is the engine's job; a dark device on a failed flash is
    // truthful).
    const unsubDeploy = engineEvents.subscribe(
      (m: { type?: string; deploying?: unknown; lastResult?: unknown }) => {
        if (m?.type !== 'vsn1LayoutDeploy') return;
        if (m.deploying === false && m.lastResult === 'ok') _resyncVsn1AfterDeploy?.();
      },
    );

    // ── APC clip_stop LED: track combined (pattern + colour) autopilot ───────
    // The engine broadcasts pattern autopilot as `{ type:'autopilot', active }`
    // and deck colour autopilot as `{ type:'colorAutopilot', active }`. Both are
    // replayed on WS connect, so the LED shows the true state on (re)connect and
    // updates on every subsequent change (from ANY surface — a screen toggle, the
    // clip_stop press, the activity auto-disable). Mirror each flag + recompute.
    const unsubAutopilot = engineEvents.subscribe((m: { type?: string; active?: unknown; palettes?: unknown }) => {
      if (m?.type === 'autopilot') {
        _patternAutopilotOn = !!m.active;
        _patchCombinedAutopilot();
      } else if (m?.type === 'colorAutopilot') {
        _colorAutopilotOn = !!m.active;
        // Track writability from the broadcast's palette set: an empty set means
        // the colour autopilot can't be toggled (engine 400s), so the clip_stop
        // LED + toggle degrade to pattern-only. colorAutopilotState() always
        // serializes `palettes`, so a real engine populates this every broadcast.
        _colorAutopilotWritable = colorAutopilotWritable(m.palettes);
        _patchCombinedAutopilot();
      } else if (m?.type === 'performanceMode') {
        // APC solo LED: lit while PERFORMANCE MODE is active. Broadcast on
        // enter/exit + replayed on WS connect (same posture as the autopilot
        // events above), so the LED is truthful on (re)connect.
        const active = m.active === true;
        if (_snapshot.performanceModeActive !== active) {
          _snapshot = { ..._snapshot, performanceModeActive: active };
          _nudge?.();
        }
      }
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
        refreshEffectsPage();
        refreshControllerProfile();
      }
      _wasConnected = st.connected;
    });

    // ── Single-instance guard (review D4, 2026-07-10) ────────────────────────
    // Web MIDI delivers device input to EVERY open tab; each tab's MidiManager
    // then independently dispatches (a toggle key pressed once → two toggle
    // POSTs → net no-op = "buttons dead") and paints device feedback from its
    // own diff map (stale tab's paint can land after the fresh one's). Newest
    // boot wins: every booting instance posts its nonce; any OLDER instance
    // that hears a foreign nonce disposes its manager and banners itself.
    // BroadcastChannel never delivers to its own poster, so a tab cannot yield
    // to itself; native (Expo) has no BroadcastChannel and exactly one
    // instance, so the guard is web-only by the typeof check.
    const instanceNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let instanceChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      instanceChannel = new BroadcastChannel('captainpad-midi-single-instance');
      instanceChannel.onmessage = (ev: MessageEvent) => {
        if (disposed || !ev?.data?.boot || ev.data.boot === instanceNonce) return;
        // A newer CaptainPad instance booted — this tab yields MIDI, loudly.
        manager.dispose();
        _set({
          available: true,
          transportKind,
          profileError:
            'MIDI yielded to a newer CaptainPad tab. Reload this tab to reclaim control.',
          statuses: [],
        });
      };
      instanceChannel.postMessage({ boot: instanceNonce });
    }

    manager.start().then(() => {
      if (!disposed) manager.onEngineUpdate();
    }).catch((e) => {
      // A start() crash means NO controller works while the app looks alive —
      // never swallow it silently (the 2026-07-10 freeze hunt learned this the
      // hard way; the old `.catch(() => undefined)` hid every boot failure).
      // eslint-disable-next-line no-console
      console.error('[MIDI] manager.start() failed — all controllers dead:', e);
    });

    return () => {
      disposed = true;
      if (instanceChannel) {
        instanceChannel.close();
      }
      _nudge = null;
      _setFocusIntent = null;
      _applyContext = null;
      _noteUiPatternSelect = null;
      _armLearn = null;
      _revalidate = null;
      _requestVsn1Welcome = null;
      _resyncVsn1AfterDeploy = null;
      _loadedProfiles = [];
      unsubSlots();
      unsubEffects();
      unsubDeploy();
      unsubAutopilot();
      unsubPage();
      unsubProfile();
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

  // Mirror the live grand-master (0..1) into the module ref the APC master-fade
  // toggle reads to decide TO BLACK vs UP. Kept in sync here (not in the async
  // snapshot rebuild) so it tracks the engine's mixer/deck broadcasts directly.
  useEffect(() => {
    if (typeof engine.master === 'number' && Number.isFinite(engine.master)) {
      _liveMaster = engine.master;
    }
  }, [engine.master]);

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

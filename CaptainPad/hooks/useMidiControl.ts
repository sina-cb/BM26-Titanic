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
import {
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
  getCachedColorPalettes,
  warmColorPalettesCache,
  type PlaylistAssignment,
} from '@/utils/api';
import {
  MidiManager,
  ControllerStatus,
  MidiEngineSnapshot,
  FocusedBinding,
  MidiControlRef,
  LearnResult,
  selectTransportFactory,
  setSysexRequested,
  getMidiTransportKind,
  MidiTransportKind,
  validateProfile,
  profileClaims,
  ControllerProfile,
} from '@/utils/midi';
import apcProfileRaw from '@/midi_profiles/apc_mini_mk2.yaml';
import mftProfileRaw from '@/midi_profiles/mft.yaml';

export interface MidiControlState {
  /** A transport exists on this platform (desktop Chromium / native module). */
  available: boolean;
  transportKind: MidiTransportKind;
  /** Profile load/validate failure (fatal for that profile). */
  profileError: string | null;
  statuses: ControllerStatus[];
}

const EMPTY: MidiControlState = {
  available: false,
  transportKind: 'none',
  profileError: null,
  statuses: [],
};

// ── Module store (mirrors useEngineState's cache + listener set) ───────────
let _state: MidiControlState = EMPTY;
const _listeners = new Set<(s: MidiControlState) => void>();

function _set(next: MidiControlState): void {
  _state = next;
  _listeners.forEach((cb) => {
    try { cb(next); } catch { /* a buggy subscriber must not break the others */ }
  });
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
};

// ── Focused channel (for the MIDI-learn param faders 4-6) ──────────────────
// On the Deck tab the focus is always the single deck channel. On the Mixer tab
// the operator picks the focused overlay with a track button (focusChannel
// action). The manager applies the focused pattern's bindings to the param
// faders. `_rev` bumps re-run the snapshot effect so a focus switch or a
// `playlistSaved` (a freshly-learned binding) updates `_snapshot.focused`.
let _focusedLayer = 0;
const _focusListeners = new Set<() => void>();

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

/** Set the focused mixer layer (Mixer tab). The manager's onFocusChange routes
 *  here; the on-screen mixer can also call it so touch + MIDI agree. */
export function setMidiFocus(layer: number): void {
  if (layer === _focusedLayer) return;
  _focusedLayer = layer;
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
    else cb({ error: conflictMessage(result.conflict) });
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
    if (claimed !== null) return conflictMessage(claimed);
  }
  return null;
}

/** Human-readable conflict message naming the profile control the operator
 *  moved (e.g. "CC 54 is GLOBAL SPEED — use fader 4/5/6/8"). The controlId is
 *  the profile control's id; map the well-known reserved controls to friendly
 *  copy, else fall back to the id. */
function conflictMessage(controlId: string): string {
  const known: Record<string, string> = {
    fader_7_speed: 'that fader is GLOBAL SPEED',
    fader_9_master: 'that fader is MASTER',
  };
  const named = known[controlId];
  const hint = ' — use a MIDI-learn fader (4/5/6/8) or a free pad';
  return named
    ? `${named}${hint}`
    : `that control is already mapped ('${controlId}')${hint}`;
}

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

async function _onMidiActivity(): Promise<void> {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(_onMidiIdle, MIDI_IDLE_MS);
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
  setAutopilot(false).catch(() => undefined);
  setDeckTransitionConfig({ enabled: false }).catch(() => undefined);
}

function _onMidiIdle(): void {
  _idleTimer = null;
  _midiActive = false;
  if (_priorAutopilot) setAutopilot(true).catch(() => undefined);
  if (_priorTransitions) setDeckTransitionConfig({ enabled: true }).catch(() => undefined);
  _priorAutopilot = null;
  _priorTransitions = null;
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
  if (!s.available) return { kind: 'unavailable', message: 'MIDI not available on this platform' };
  if (s.profileError) return { kind: 'error', message: s.profileError };
  const err = s.statuses.find((c) => c.kind === 'error');
  if (err) return { kind: 'error', message: err.error };
  if (s.statuses.some((c) => c.kind === 'connected')) return { kind: 'connected' };
  return { kind: 'disconnected', message: 'No controller detected' };
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

      // ── Focused channel — the param faders (4-6) drive its active pattern's
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
        _focusedLayer = 0;
        _bumpFocus();
      }
      const focusLayer = ctx === 'deck' ? 0 : _focusedLayer;
      const focusChan: MixerChannel | null = ctx === 'deck'
        ? (engine.deckChannel as MixerChannel | null)
        : (channels[focusLayer] as MixerChannel | undefined) ?? null;
      let focused: MidiEngineSnapshot['focused'] = null;
      if (focusChan?.id) {
        const exportsList = (focusChan.exports ?? [])
          // kind 1 = sliders (the learnable local params). CPC-matched exports
          // can't take a static write (the CPC clobbers it), so drop them.
          // EXCLUDE (with a warn) an export missing v0 rather than fabricating
          // 0.5 — a fabricated base corrupts soft-takeover pickup math.
          .filter((e) => e.kind === 1 && !(e as { cpcOwned?: boolean }).cpcOwned)
          .flatMap((e) => {
            if (typeof e.v0 !== 'number') {
              console.warn(`[midi] focused export '${e.name}' (id ${e.id}) has no numeric v0; excluding it from MIDI-learn (a fabricated base would corrupt pickup)`);
              return [];
            }
            return [{ id: e.id, name: e.name, v0: e.v0 }];
          });
        const pl = focusChan.playlist as PlaylistAssignment | null | undefined;
        const entryId = pl?.activeEntryId ?? null;
        let midiMappings: FocusedBinding[] = [];
        if (pl?.name && entryId) {
          // Cached fetch (5 s TTL, deduped) — this is the same playlist
          // `playlistFor()` fetched above for the window browser, so it hits
          // the cache rather than re-hitting the engine.
          const r = await fetchPlaylist(pl.name);
          if (r.ok && r.data) {
            const entry = (r.data.entries as { id: string; midiMappings?: unknown[] }[])
              .find((e) => e.id === entryId);
            const raw = Array.isArray(entry?.midiMappings) ? entry!.midiMappings! : [];
            midiMappings = raw.flatMap((m) => {
              const b = m as FocusedBinding;
              if (b && b.control && b.target && Array.isArray(b.range)) return [b];
              console.warn('[midi] dropping malformed stored midiMapping on focused entry:', m);
              return [];
            });
          }
        }
        const role = ctx === 'deck' ? 'deck' : 'mixer';
        // Build the pickup re-lock identity ONCE (role:id:entryId:mappingIds);
        // the runtime compares it as a single string. Including entryId means a
        // fader re-picks-up after the active entry changes even when the
        // popover-derived mapping id (`midi_<param>`) is reused across entries.
        const key = `${role}:${focusChan.id}:${entryId ?? ''}:${midiMappings.map((m) => m.id).join(',')}`;
        focused = {
          role,
          layer: focusLayer,
          id: focusChan.id,
          entryId,
          key,
          exports: exportsList,
          midiMappings,
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
      };
      _nudge?.();
    })();
    return () => { cancelled = true; };
  }, [engine.blackout, engine.deckChannel, engine.mixerChannels, rev]);

  // ── Re-validate param keys when the engine CPC schema lands (async) ───────
  useEffect(() => {
    _schemaKeys = new Set(Object.keys(engine.paramSchema));
    _revalidate?.();
  }, [engine.paramSchema]);

  // ── Boot the manager once ────────────────────────────────────────────────
  useEffect(() => {
    _listeners.add(setS);

    const transportKind = getMidiTransportKind();
    const factory = selectTransportFactory();
    if (!factory) {
      _set({ available: false, transportKind, profileError: null, statuses: [] });
      return () => { _listeners.delete(setS); };
    }

    const { profiles, error } = loadProfiles();
    if (error) {
      _set({ available: true, transportKind, profileError: error, statuses: [] });
      return () => { _listeners.delete(setS); };
    }
    // Publish the loaded profiles for the save-time conflict re-check.
    _loadedProfiles = profiles;
    // A driver that pushes a SysEx config on connect (the MFT's encoder-mode
    // setup, device.configureOnConnect) needs the SysEx capability on the
    // shared MIDIAccess — request it now, before the manager connects. APC-only
    // rigs skip the extra permission scope.
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
    // Forward active-tab changes (Deck/Mixer) to the manager's mapping context.
    _applyContext = (name) => manager.setContext(name);
    // Expose MIDI-learn arming for the per-param map popover.
    _armLearn = (cb) => manager.armLearn(cb);
    // Forward CPC-schema arrival so param-key validation re-runs.
    _revalidate = () => manager.revalidate();
    // Seed the pattern list for pattern-bank dispatch + LED highlight.
    fetchPatterns().then((r) => {
      if (r.ok && r.data) {
        _snapshot = { ..._snapshot, patterns: r.data };
        if (!disposed) manager.onEngineUpdate();
      }
    }).catch(() => undefined);

    // Global-effect slots: count (for "off when out of slots") + active state
    // (for scene-button LEDs). Re-fetched on global-effect WS broadcasts.
    const refreshSlots = () => {
      fetchGlobalEffectSlotsStatus().then((r) => {
        if (!r.ok || !r.data?.slots) return;
        _snapshot = {
          ..._snapshot,
          globalEffectSlots: r.data.slots.map((s) => ({ slot: s.slotId, active: !!s.active })),
        };
        if (!disposed) manager.onEngineUpdate();
      }).catch(() => undefined);
    };
    refreshSlots();
    const unsubSlots = engineEvents.subscribe((m: { type?: string }) => {
      if (typeof m?.type === 'string' && m.type.toLowerCase().includes('globaleffect')) refreshSlots();
    });

    // Curated colour palette pairs for the colour-pair pads (warmed at boot).
    warmColorPalettesCache().then(() => {
      const pals = getCachedColorPalettes();
      if (pals.length) {
        _snapshot = { ..._snapshot, colorPalettes: pals.map((p) => ({ c1: p.c1, c2: p.c2 })) };
        if (!disposed) manager.onEngineUpdate();
      }
    }).catch(() => undefined);

    manager.start().then(() => {
      if (!disposed) manager.onEngineUpdate();
    }).catch(() => undefined);

    return () => {
      disposed = true;
      _nudge = null;
      _applyContext = null;
      _armLearn = null;
      _revalidate = null;
      _loadedProfiles = [];
      unsubSlots();
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

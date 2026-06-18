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

import { useEngineState } from '@/hooks/useEngineState';
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
  fetchPlaylist,
  getCachedColorPalettes,
  warmColorPalettesCache,
  type PlaylistAssignment,
} from '@/utils/api';
import {
  MidiManager,
  ControllerStatus,
  MidiEngineSnapshot,
  selectTransportFactory,
  getMidiTransportKind,
  MidiTransportKind,
  validateProfile,
  ControllerProfile,
} from '@/utils/midi';
import apcProfileRaw from '@/midi_profiles/apc_mini_mk2.yaml';

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
};

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
  try {
    // yaml-transformer may expose the doc on `.default` (ESM) or directly.
    const raw = (apcProfileRaw as { default?: unknown }).default ?? apcProfileRaw;
    return { profiles: [validateProfile(raw, 'apc_mini_mk2.yaml')], error: null };
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

  // ── Keep the module snapshot in sync with live engine state ──────────────
  // Mixer "layers" = overlay channels in order (the deck channel is separate).
  // Each layer's playlist entries are fetched (cached) so the pad window
  // browser can select entries + light the active one.
  useEffect(() => {
    let cancelled = false;
    const channels = engine.mixerChannels;
    const deck = engine.deckChannel as
      { id?: string; fader?: number; pattern?: string; playlist?: PlaylistAssignment | null } | null;
    // Fetch a channel's playlist entries (cached) for the pad window browser.
    const playlistFor = async (pl?: PlaylistAssignment | null) => {
      if (!pl?.name) return undefined;
      const r = await fetchPlaylist(pl.name);
      if (!r.ok || !r.data) return undefined;
      return { entries: r.data.entries.map((e) => ({ id: e.id })), activeEntryId: pl.activeEntryId ?? null };
    };
    void (async () => {
      const layers = await Promise.all(channels.map(async (c) => {
        const ch = c as { id: string; fader?: number; solo?: boolean; playlist?: PlaylistAssignment | null };
        return {
          id: ch.id,
          fader: typeof ch.fader === 'number' ? ch.fader : 1,
          solo: ch.solo === true,
          playlist: await playlistFor(ch.playlist),
        };
      }));
      const deckLayer = deck?.id
        ? { id: deck.id, fader: typeof deck.fader === 'number' ? deck.fader : 1, playlist: await playlistFor(deck.playlist) }
        : null;
      if (cancelled) return;
      _snapshot = {
        ..._snapshot,
        blackout: engine.blackout,
        activePattern: (deck?.pattern as string | undefined) ?? null,
        layers,
        deckLayer,
        activeContext: _activeContext,
      };
      _nudge?.();
    })();
    return () => { cancelled = true; };
  }, [engine.blackout, engine.deckChannel, engine.mixerChannels]);

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
      },
      getSnapshot: () => _snapshot,
      getSchemaKeys: () => _schemaKeys,
      defaultContext: _activeContext,
      onActivity: () => { void _onMidiActivity(); },
      onWindowChange: (channelId, start, size) => _setWindow(channelId, start, size),
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
      _revalidate = null;
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

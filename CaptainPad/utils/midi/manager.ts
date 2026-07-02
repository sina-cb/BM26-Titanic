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
import { resolveEvent, ResolvedAction, profileClaims } from './resolver';
import { resolveEndpoints, EndpointResolutionError } from './endpoints';
import { ControlCoalescer, CoalescerTimers } from './coalescer';
import { createDispatcher, MidiDispatchApi, MidiDispatcher } from './dispatch';
import { projectLeds, LedState, MidiProjectionState } from './led_projector';
import {
  LearnController, LearnResult, MidiControlRef, bindingMatches, controlRefFromEvent,
  scaleMidiToRange, pickup, freshPickup, PickupState,
} from './learn';

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
}

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
  /** Live local exports of the active pattern (id ↔ name ↔ current value). */
  exports: { id: number; name: string; v0: number }[];
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
  /** Soft-takeover state per binding id (locks a fader until it crosses the
   *  param's current value, so focus/pattern switches don't jump the value). */
  private readonly pickupStates = new Map<string, PickupState>();
  /** Identity of the focus the pickup map was built for; a change re-locks. */
  private lastFocusKey: string | null = null;
  private readonly learn: LearnController;
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
    this.transport = opts.transportFactory();
    this.coalescer = new ControlCoalescer<ResolvedAction>(
      opts.coalesceMs ?? DEFAULT_COALESCE_MS,
      (_controlId, payload) => { void this.dispatcher(payload); },
      opts.coalescerTimers,
    );
    this.status = { deviceId: profile.device.id, label: profile.device.label, kind: 'disconnected' };
  }

  private setStatus(patch: Partial<ControllerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.notify();
  }

  async connect(): Promise<void> {
    try {
      const endpoints = await this.transport.listEndpoints();
      // Device absent (no endpoint carries the name) → grey, not an error.
      const present = endpoints.some(
        (e) => e.name.includes(this.profile.device.nameContains),
      );
      if (!present) {
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

      // Param-key validation: aggregate, non-fatal (other controls keep working).
      // Skipped while the schema is empty (not loaded yet); revalidate() re-runs
      // it once the engine CPC schema lands.
      const keys = this.opts.getSchemaKeys?.();
      const paramErrors = keys && keys.size > 0 ? validateProfileParams(this.profile, keys) : [];

      this.teardownBindings();
      this.unsubs.push(this.transport.addListener('midiMessage', (e) => this.onMessage(e.data)));
      this.unsubs.push(this.transport.addListener('endpointsChanged', () => { void this.onEndpointsChanged(); }));

      this.setStatus({
        kind: 'connected',
        error: undefined,
        sourceName: resolved.sourceName,
        destinationName: resolved.destinationName,
        paramErrors: paramErrors.length ? paramErrors : undefined,
      });
      // Full LED repaint on (re)connect.
      this.ledState = {};
      this.projectAndSend();
    } catch (err) {
      const message = err instanceof EndpointResolutionError
        ? err.message
        : (err instanceof Error ? err.message : String(err));
      this.teardownBindings();
      this.setStatus({ kind: 'error', error: message });
      this.bindHotplugOnly();
    }
  }

  private bindHotplugOnly(): void {
    this.unsubs.push(this.transport.addListener('endpointsChanged', () => { void this.onEndpointsChanged(); }));
  }

  private async onEndpointsChanged(): Promise<void> {
    // Simplest correct behaviour: re-run connect(), which re-resolves the
    // endpoints (grey on unplug, reconnect + repaint on replug).
    await this.connect();
  }

  /** Re-run param-key validation against the now-loaded CPC schema and update
   *  the status (the schema arrives async, after connect). */
  revalidateParams(): void {
    if (this.status.kind !== 'connected') return;
    const keys = this.opts.getSchemaKeys?.();
    const paramErrors = keys && keys.size > 0 ? validateProfileParams(this.profile, keys) : [];
    this.setStatus({ paramErrors: paramErrors.length ? paramErrors : undefined });
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

    // 1) MIDI-learn capture — while armed, the next learnable control BINDS
    //    (the popover supplied the callback) and is swallowed, never dispatched.
    //    BUT: a control that already resolves to a STATIC profile action (global
    //    speed, master, a pad, …) must NOT be learnable — capturing it would
    //    permanently shadow that action. Run resolveEvent FIRST; if it claims
    //    the control, reject with a named conflict instead of capturing.
    if (this.learn.isArmed()) {
      const cap = controlRefFromEvent(decoded);
      if (cap) {
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

    // 3) Profile-mapped action.
    const ev = resolveEvent(this.profile, decoded, this.context);
    this.setStatus({ lastEvent: describeEvent(decoded, ev ? ev.controlId : null) });
    if (!ev) return;
    // Focus + the playlist window browser need controller-local state, so they
    // are handled here rather than in the pure dispatcher.
    if (ev.resolved.kind === 'focusChannel') { this.handleFocus(ev.resolved.layer); return; }
    if (ev.resolved.kind === 'playlistScroll') { this.handleScroll(ev.resolved.layer, ev.resolved.dir); return; }
    if (ev.resolved.kind === 'playlistWindowSelect') { this.handleWindowSelect(ev.resolved.layer, ev.resolved.slot); return; }
    if (ev.continuous) {
      this.coalescer.push(ev.controlId, ev.resolved);
    } else {
      void this.dispatcher(ev.resolved);
    }
  }

  /** Handle a focusChannel track-button press. Inert when the requested layer
   *  doesn't exist (deck-tab track buttons for layers > 0, or a deleted
   *  overlay) — like the old solo buttons: no focus change, no LED churn. Sets
   *  `requestedFocusLayer` SYNCHRONOUSLY so LED paint + the applyBinding
   *  staleness gate don't wait for the async snapshot swap. */
  private handleFocus(layer: number): void {
    const snap = this.opts.getSnapshot();
    if (!layerInfo(snap, layer)) return; // absent layer → inert
    this.requestedFocusLayer = layer;
    this.opts.onFocusChange?.(layer);
    this.projectAndSend(); // repaint the focus LED from requestedFocusLayer now
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

    // Focus/snapshot staleness gate (mixer only): the focusChannel press sets
    // `requestedFocusLayer` synchronously, but the snapshot's focused layer
    // swaps in async (onFocusChange → React → refetch). Until it catches up a
    // fader would write to the OLD channel — so swallow (locked) while they
    // disagree. On the deck the single channel is always focused, so
    // requestedFocusLayer is either -1 (untouched) or 0 and never diverges.
    if (focused.role === 'mixer' && this.requestedFocusLayer !== -1) {
      this.reconcileRequestedFocus(focused.layer);
      if (this.requestedFocusLayer !== -1 && focused.layer !== this.requestedFocusLayer) {
        this.setStatus({ lastEvent: `bind (focus settling → ch ${this.requestedFocusLayer})` });
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
    const value = scaleMidiToRange(cap ? cap.value : 0, binding.range);
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
    const { write, next } = pickup(state, exp.v0, value);
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
    const focused = this.opts.getSnapshot().focused;
    if (!focused) return false;
    if (
      focused.role === 'mixer'
      && this.requestedFocusLayer !== -1
      && focused.layer !== this.requestedFocusLayer
    ) return true;
    // Only the current focus's pickup slots are meaningful (they were cleared
    // on the last focus-identity change).
    if (focused.key !== this.lastFocusKey) return false;
    for (const b of focused.midiMappings) {
      if (this.pickupStates.get(b.id)?.locked) return true;
    }
    return false;
  }

  /** The layer LED paint should treat as focused: the synchronous request when
   *  set, else the snapshot's focused layer (projector fallback per §1.2). */
  private getRequestedFocusLayer(): number {
    if (this.requestedFocusLayer !== -1) return this.requestedFocusLayer;
    return this.opts.getSnapshot().focused?.layer ?? -1;
  }

  /** Clear the synchronous focus request once it's no longer meaningful: either
   *  the snapshot's focused layer caught up (settle done) OR the requested layer
   *  no longer exists (e.g. an overlay was deleted and the hook fell focus back
   *  to 0). Prevents a stale request from permanently gating mixer bindings. */
  private reconcileRequestedFocus(snapshotLayer: number): void {
    if (this.requestedFocusLayer === -1) return;
    const snap = this.opts.getSnapshot();
    if (snapshotLayer === this.requestedFocusLayer || !layerInfo(snap, this.requestedFocusLayer)) {
      this.requestedFocusLayer = -1;
    }
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
    void this.opts.api.setChannelPlaylistEntry(L.role, L.id, entry.id);
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
    };
    const { messages, next } = projectLeds(this.profile, projState, this.ledState, this.context);
    this.ledState = next;
    for (const msg of messages) {
      try {
        this.transport.send(msg);
      } catch {
        // A failed LED write must never break the dispatch path.
      }
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

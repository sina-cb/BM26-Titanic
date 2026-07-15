// window_sync_regression — the APC pad-window scroll ↔ UI-highlight invariant.
//
// Operator bug (2026-07): scroll the highlighted pattern window with the APC,
// press a blue pad, and the SELECTED pattern doesn't match the highlighted six.
// The auto-follow feature (syncWindowsToActiveEntries) that landed 2026-07 to
// stop a UI scroll-jump must not STOMP a manual pad-scroll browse.
//
// INVARIANT: at any instant, pressing pad slot s selects the entry the UI paints
// at window[s] — i.e. the manager's live windowCursor (which handleWindowSelect
// reads) always equals the LAST window start published via onWindowChange (which
// drives the UI blue highlight). A manual scroll must STICK: an unrelated
// projection tick (a fader move, a playlist refresh, a momentary unresolved
// active entry) must not re-centre the window back onto the active entry.

import { describe, it, expect, vi } from 'vitest';
import { MidiManager, MidiEngineSnapshot } from './manager';
import { MidiTransport, MidiEndpoint, MidiMessageEvent } from './transport';
import { validateProfile } from './profile';
import { MidiDispatchApi } from './dispatch';

const fullEndpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
  { id: 'out-0', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
];

// Column 0: row 0 = scroll-down pad, rows 1..6 = the six window-select pads.
// (Matches the existing manager.test.ts browse profile; reverse defaults off so
// row1→slot0 … row6→slot5. Note number = row*8 + column.)
const browseProfile = validateProfile({
  device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  contexts: {
    mixer: [
      { id: 'up', match: { type: 'column', channel: 0, column: 1, fromRow: 0, toRow: 0 }, action: { kind: 'playlistScroll', layer: 0, dir: 'up' }, led: { on: 1, off: 0 } },
      { id: 'down', match: { type: 'column', channel: 0, column: 0, fromRow: 0, toRow: 0 }, action: { kind: 'playlistScroll', layer: 0, dir: 'down' }, led: { on: 1, off: 0 } },
      { id: 'win', match: { type: 'column', channel: 0, column: 0, fromRow: 1, toRow: 6 }, action: { kind: 'playlistWindowSelect', layer: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    ],
  },
});

class FakeTransport implements MidiTransport {
  sent: number[][] = [];
  private endpoints: MidiEndpoint[];
  private msgCbs = new Set<(e: MidiMessageEvent) => void>();
  private epCbs = new Set<() => void>();
  private openedSource: string | null = null;
  constructor(endpoints: MidiEndpoint[]) { this.endpoints = endpoints; }
  async listEndpoints() { return this.endpoints; }
  async openSource(id: string) { this.openedSource = id; }
  async openDestination() { /* no-op */ }
  send(bytes: number[]) { this.sent.push(bytes); }
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): () => void;
  addListener(event: 'endpointsChanged', cb: () => void): () => void;
  addListener(event: 'midiMessage' | 'endpointsChanged', cb: ((e: MidiMessageEvent) => void) | (() => void)) {
    if (event === 'midiMessage') { this.msgCbs.add(cb as (e: MidiMessageEvent) => void); return () => this.msgCbs.delete(cb as (e: MidiMessageEvent) => void); }
    this.epCbs.add(cb as () => void); return () => this.epCbs.delete(cb as () => void);
  }
  close() { this.msgCbs.clear(); this.epCbs.clear(); }
  emit(data: number[], timestampMs = 0) { for (const cb of this.msgCbs) cb({ sourceId: this.openedSource ?? '', data, timestampMs }); }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setGlobalEffectSlotIntensity: vi.fn(ok), resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok), cycleGlobalEffectSlotMode: vi.fn(ok), nextEffectBank: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok), disableAllGlobalEffects: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok), setMixerChannelControl: vi.fn(ok),
    setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok), toggleCombinedAutopilot: vi.fn(ok), toggleMasterFade: vi.fn(ok), summonPerformanceDialog: vi.fn(ok),
  };
}

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: [], globalEffects: {},
  layers: [], deckLayer: null, activeContext: 'mixer', globalEffectSlots: [], colorPalettes: [],
  focused: null, syncOwnedKeys: new Set<string>(),
};

/** The last window START published to the UI — this is what drives the blue
 *  highlight (useMidiWindow → windowPadNumber). */
function lastPublishedStart(calls: [string, number, number][]): number | null {
  return calls.length ? calls[calls.length - 1][1] : null;
}

/** Harness: 20-entry playlist on mixer layer 0. Snapshot is a `let` box so a
 *  test can mutate the active entry (engine echo) and re-drive projection. */
function harness(activeEntryId = 'e0') {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}` }));
  let snap: MidiEngineSnapshot = {
    ...baseSnap,
    layers: [{ id: 'ch_a', fader: 1, playlist: { entries, activeEntryId } }],
  };
  const windowCalls: [string, number, number][] = [];
  const transport = new FakeTransport(fullEndpoints);
  const api = makeApi();
  const manager = new MidiManager({
    profiles: [browseProfile], transportFactory: () => transport, api,
    getSnapshot: () => snap, defaultContext: 'mixer',
    onWindowChange: (id, start, size) => windowCalls.push([id, start, size]),
  });
  return {
    entries, transport, api, manager, windowCalls,
    setActive: (id: string) => { snap = { ...snap, layers: [{ id: 'ch_a', fader: 1, playlist: { entries, activeEntryId: id } }] }; },
    setPlaylist: (es: { id: string }[], id: string | null) => { snap = { ...snap, layers: [{ id: 'ch_a', fader: 1, playlist: { entries: es, activeEntryId: id } }] }; },
  };
}

const SCROLL_DOWN = [0x90, 0, 127];   // column0 row0
const scrollDownN = (t: FakeTransport, n: number) => { for (let i = 0; i < n; i += 1) t.emit(SCROLL_DOWN); };
// Press window pad for slot s (0..5): column0 row (s+1) → note (s+1)*8.
const pressSlot = (t: FakeTransport, s: number) => t.emit([0x90, (s + 1) * 8, 127]);

describe('APC pad-window scroll ↔ UI-highlight invariant', () => {
  it('INVARIANT: pressing pad slot s selects the entry the UI highlights at window[s]', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 7); // browse down to window start 7
    const uiStart = lastPublishedStart(h.windowCalls);
    expect(uiStart).toBe(7); // UI highlights e7..e12
    pressSlot(h.transport, 2); // press pad 3 (slot 2) → UI shows e9 there
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', `e${uiStart! + 2}`);
  });

  it('a projection tick with NO active-entry change does not stomp the browse', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 9); // window start 9, active e0 now OUTSIDE it
    expect(lastPublishedStart(h.windowCalls)).toBe(9);
    // Unrelated engine update (e.g. a fader moved) — active entry unchanged.
    h.manager.onEngineUpdate();
    expect(lastPublishedStart(h.windowCalls)).toBe(9); // window stuck, not re-centred
    pressSlot(h.transport, 0);
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e9');
  });

  it('a transient unresolved active entry (playlist refresh) does not stomp the browse', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 9); // window start 9, active e0 outside
    expect(lastPublishedStart(h.windowCalls)).toBe(9);
    // Refresh flicker: entries momentarily present but activeEntryId unresolved…
    h.setPlaylist(h.entries, null);
    h.manager.onEngineUpdate();
    // …then it resolves back to the SAME active entry e0.
    h.setActive('e0');
    h.manager.onEngineUpdate();
    expect(lastPublishedStart(h.windowCalls)).toBe(9); // still stuck on the browse
    pressSlot(h.transport, 0);
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e9');
  });

  it('the FIRST manual scroll sticks even when the layer had no window at connect', async () => {
    // Connect with an EMPTY playlist so syncWindows never initialises the layer's
    // last-active-index; the playlist then loads, and the operator scrolls before
    // any engine tick establishes the baseline.
    const entries = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}` }));
    let snap: MidiEngineSnapshot = {
      ...baseSnap,
      layers: [{ id: 'ch_a', fader: 1, playlist: { entries: [], activeEntryId: null } }],
    };
    const windowCalls: [string, number, number][] = [];
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [browseProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
      onWindowChange: (id, start, size) => windowCalls.push([id, start, size]),
    });
    await manager.start();
    // Playlist loads (active e0) but NO engine tick fires before the scroll.
    snap = { ...snap, layers: [{ id: 'ch_a', fader: 1, playlist: { entries, activeEntryId: 'e0' } }] };
    scrollDownN(transport, 3); // operator browses to window start 3
    expect(lastPublishedStart(windowCalls)).toBe(3); // must stick, not snap back to 0
    pressSlot(transport, 0);
    expect(api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e3');
  });

  it('a browse to the clamped bottom end sticks and maps correctly', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 50); // over-scroll — clamps to max start = 20 - 6 = 14
    expect(lastPublishedStart(h.windowCalls)).toBe(14); // window [14..19]
    h.manager.onEngineUpdate(); // a projection tick must not move it
    expect(lastPublishedStart(h.windowCalls)).toBe(14);
    pressSlot(h.transport, 5); // bottom pad → last entry e19
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e19');
  });

  it('a UI LIST TAP re-centres the window around an out-of-window selection (sole recenter source)', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 2); // window start 2 → [2..7]
    h.windowCalls.length = 0;
    // The operator TAPS pattern e15 in the CaptainPad list (mouse/touch). The panel
    // notes the tap on the manager (noteUiPatternSelect); the engine echo then
    // recenters around it: 15 - 3 = 12. This is the ONLY source that recenters.
    h.manager.noteUiPatternSelect('ch_a', 'e15');
    h.setActive('e15');
    h.manager.onEngineUpdate();
    expect(lastPublishedStart(h.windowCalls)).toBe(12); // window [12..17] surrounds e15
    pressSlot(h.transport, 0); // top pad now selects e12, the UI's top-highlighted row
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e12');
  });
});

// ── Only a UI list tap recenters the window (operator policy 2026-07) ─────────
// The window auto-follow recenters ONLY when the selection came from a mouse/touch
// tap in the CaptainPad list. EVERY other active-entry source — APC pad-select,
// autopilot advance, engine/cross-tab echo — leaves the window EXACTLY where the
// operator has it (baseline advanced so no later catch-up jump). Because _setWindow
// mints a NEW window object on every publish (retriggering the list auto-scroll),
// a non-UI source emits NO onWindowChange at all — not even a same-start republish.

describe('only a UI list tap recenters the browse window', () => {
  it('an APC pad-select of an in-window entry emits NO window republish (no jump)', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 8); // browse to window start 8 → [8..13]; active e0 outside
    expect(lastPublishedStart(h.windowCalls)).toBe(8);
    h.windowCalls.length = 0;
    // Operator presses pad slot 2 → selects e10 (inside [8..13]). No noteUiPatternSelect.
    pressSlot(h.transport, 2);
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e10');
    // Engine echoes the new active entry.
    h.setActive('e10');
    h.manager.onEngineUpdate();
    // The window is UNTOUCHED: no recenter, no republish. (Pre-fix this published
    // a fresh window object that slid the list — the operator-visible jump.)
    expect(h.windowCalls).toEqual([]);
  });

  it('a pad-select advances the follow baseline so a later tick does not catch up and jump', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 8);
    h.windowCalls.length = 0;
    pressSlot(h.transport, 2); // select e10 (in-window)
    h.setActive('e10');
    h.manager.onEngineUpdate();
    expect(h.windowCalls).toEqual([]); // no recenter
    // An unrelated tick with the SAME active entry must also leave the window put
    // (the baseline is now e10, so no "change" is detected — no late catch-up).
    h.manager.onEngineUpdate();
    expect(h.windowCalls).toEqual([]);
    // The pad still maps correctly against the unchanged window.
    pressSlot(h.transport, 0);
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e8');
  });

  it('an AUTOPILOT / external active-entry change does NOT recenter (window stays put)', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 8); // [8..13]
    h.windowCalls.length = 0;
    // Autopilot advances the active entry to e18 (outside [8..13]) — NOT a UI tap,
    // so the window must NOT move. (Old brief recentred here; operator now rules it out.)
    h.setActive('e18');
    h.manager.onEngineUpdate();
    expect(h.windowCalls).toEqual([]); // no recenter, no republish
    // The window is still [8..13]: top pad selects e8.
    pressSlot(h.transport, 0);
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e8');
  });

  it('a UI tap AFTER a pad-select still recenters — the tap is the source that counts', async () => {
    const h = harness('e0');
    await h.manager.start();
    scrollDownN(h.transport, 8); // [8..13]
    h.windowCalls.length = 0;
    pressSlot(h.transport, 2); // pad-select e10 (no recenter)
    h.setActive('e10');
    h.manager.onEngineUpdate();
    expect(h.windowCalls).toEqual([]);
    // Now the operator TAPS e2 in the list (outside [8..13]) → recenter: 2 - 3 → 0.
    h.manager.noteUiPatternSelect('ch_a', 'e2');
    h.setActive('e2');
    h.manager.onEngineUpdate();
    expect(lastPublishedStart(h.windowCalls)).toBe(0); // window [0..5] surrounds e2
    pressSlot(h.transport, 2); // slot 2 → e2, the UI's highlighted row
    expect(h.api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e2');
  });
});

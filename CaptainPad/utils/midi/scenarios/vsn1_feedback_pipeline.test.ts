// VSN1 feedback pipeline — the outbound (host → device) MIDI feedback stream for
// the 32 paged global-effect slots + the page/side-button/welcome/select-cue
// framing the device Lua renders from. This is the DOWNWARD (feedback) home;
// the INBOUND slot-key / jog / small-button runtime lives in vsn1_runtime.test.ts.
// Proves the CONNECTIONS Sina asked for:
//   - engine broadcast (snapshot change) → the MIDI feedback pipeline emits the
//     right slot active/value/mode + page frames the device Lua renders from
//   - a page change from any source converges the feedback everywhere
//   - full re-send on page change / layout edit / reconnect (Lua VM restart),
//     the welcome hello (connect only), and the select cue that snaps the LCD
//
// The shipped midi_profiles/vsn1.yaml is parsed with js-yaml (mirroring the
// metro yaml-transformer) so the tests bind to the REAL profile, not a fixture.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile, ProfileValidationError } from '../profile';
import { resolveEvent } from '../resolver';
import { decodeMidi } from '../midi_message';
import { createDispatcher, MidiDispatchContext } from '../dispatch';
import { MidiManager, MidiEngineSnapshot } from '../manager';
import { MidiEndpoint } from '../transport';
import { FakeTransport, makeApi } from '../test_support/fake_transport';
import {
  projectVsn1Feedback, vsn1FeedbackTargets, modeIndex,
  FB_ACTIVE_CH, FB_VALUE_CH, FB_MODE_CH, FB_PAGE_CH,
  vsn1WelcomeMessage, WELCOME_CH, WELCOME_CC, WELCOME_VALUE,
  vsn1SelectCueMessage, SELECT_CUE_CH, SELECT_CUE_CC, SELECT_CUE_NONE,
  VIEW_MODE_CH, VIEW_MODE_CC,
  isDeviceHello, DEVICE_HELLO_CC,
} from '../vsn1_feedback';
import {
  projectVsn1Layout,
  VSN1_LAYOUT_ACK_CC,
  VSN1_LAYOUT_COLOR_CH,
  VSN1_LAYOUT_COMMIT_CC,
  VSN1_LAYOUT_NAME_CH,
} from '../vsn1_layout_feedback';

const rawVsn1 = yaml.load(readFileSync(join(__dirname, '../../../midi_profiles/vsn1.yaml'), 'utf8'));

// ── Profile + resolver: the two new action kinds ────────────────────────────

describe('effects v2 — vsn1.yaml side buttons + encoder-press mode', () => {
  it('validates the shipped profile with the new kinds', () => {
    expect(() => validateProfile(rawVsn1, 'vsn1.yaml')).not.toThrow(ProfileValidationError);
  });

  it('note 40 press → effectModeCycle', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    expect(resolveEvent(p, decodeMidi([0x90, 40, 127]))?.resolved).toEqual({ kind: 'effectModeCycle' });
  });

  // Small panel buttons no longer page (the physical side button does, via
  // pageCc 40). Notes 41..44 → the host-owned vsn1SmallButton 0..3.
  it('notes 41..44 press → vsn1SmallButton 0..3', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (let i = 0; i < 4; i += 1) {
      expect(resolveEvent(p, decodeMidi([0x90, 41 + i, 127]))?.resolved)
        .toEqual({ kind: 'vsn1SmallButton', button: i });
    }
  });

  it('the shipped key/jog/small-button notes carry anyChannel (page-riding firmware)', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    const byId = new Map(p.controls.map((c) => [c.id, c]));
    for (const id of ['key_1_slot1', 'key_8_slot8', 'jog_press_mode', 'sb0_mode', 'sb3_logo']) {
      const m = byId.get(id)?.match;
      expect(m?.type, `${id} match type`).toBe('note');
      expect((m as { anyChannel?: boolean })?.anyChannel, `${id} anyChannel`).toBe(true);
    }
  });

  it('a key note resolves REGARDLESS of channel (anyChannel), yielding the page-0 slot index', () => {
    // The resolver still yields the raw page-0 slot (1..8); the manager derives
    // the page-aware flat slot. What matters here: the note MATCHES on channel 2
    // (a page-2 press) instead of being silently dropped.
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    // note 32 on channel 2 → still globalEffectSlot slot 1 (key index 0).
    expect(resolveEvent(p, decodeMidi([0x92, 32, 127]))?.resolved)
      .toEqual({ kind: 'globalEffectSlot', slot: 1 });
    // A small button on its page channel still resolves (anyChannel).
    expect(resolveEvent(p, decodeMidi([0x93, 44, 127]))?.resolved)
      .toEqual({ kind: 'vsn1SmallButton', button: 3 });
  });
});

describe('effects v2 — profile validation of the new kinds', () => {
  const base = { device: { id: 'x', label: 'X', nameContains: 'X', sourcePort: 0, destinationPort: 0 } };

  it('rejects an out-of-range effectsPageSelect page', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'c', match: { type: 'note', channel: 0, notes: [41] }, action: { kind: 'effectsPageSelect', page: 4 } }],
    }, 'p')).toThrow(/effectsPageSelect requires an integer 'page' 0-3/);
  });

  it('accepts a valid effectsPageSelect + effectModeCycle', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'pg', match: { type: 'note', channel: 0, notes: [41] }, action: { kind: 'effectsPageSelect', page: 2 } },
        { id: 'md', match: { type: 'note', channel: 0, notes: [40] }, action: { kind: 'effectModeCycle' } },
      ],
    }, 'p');
    expect(p.controls).toHaveLength(2);
  });

  it('accepts + carries a note-match anyChannel flag (page-riding keys)', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'k', match: { type: 'note', channel: 0, notes: [32], anyChannel: true }, action: { kind: 'globalEffectSlot', slot: 1 } },
      ],
    }, 'p');
    expect((p.controls[0].match as { anyChannel?: boolean }).anyChannel).toBe(true);
  });

  it('rejects a non-boolean note-match anyChannel', () => {
    expect(() => validateProfile({
      ...base,
      controls: [
        { id: 'k', match: { type: 'note', channel: 0, notes: [32], anyChannel: 'yes' }, action: { kind: 'globalEffectSlot', slot: 1 } },
      ],
    }, 'p')).toThrow(/anyChannel must be a boolean/);
  });
});

// ── Dispatcher: the page-select + runtime-built mode-cycle kinds ─────────────

const baseCtx: MidiDispatchContext = {
  getBlackout: () => false,
  getGlobalEffectState: () => false,
  resolvePatternForBank: () => null,
  getLayer: () => null,
  getColorPalette: () => null,
  getBpmSpeedSyncOn: () => false,
  getGlobalEffectSlotBehavior: () => null,
};

describe('dispatcher — effects v2 kinds', () => {
  it('effectsPageSelect → setEffectsPage(page)', async () => {
    const api = makeApi();
    const r = await createDispatcher(api, baseCtx)({ kind: 'effectsPageSelect', page: 2 });
    expect(api.setEffectsPage).toHaveBeenCalledWith(2);
    expect(r).toEqual({ ok: true });
  });

  it('effectModeCycleSlot → cycleGlobalEffectSlotMode(slotId)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'effectModeCycleSlot', slotId: 9 });
    expect(api.cycleGlobalEffectSlotMode).toHaveBeenCalledWith(9);
  });

  it('the RAW slotless effectModeCycle THROWS (runtime must resolve it)', async () => {
    const api = makeApi();
    await expect(createDispatcher(api, baseCtx)({ kind: 'effectModeCycle' }))
      .rejects.toThrow(/controller runtime/);
  });

  it('effectBankNext → nextEffectBank("vsn1_sb2")', async () => {
    // The dispatcher tags the cycle with the 'vsn1_sb2' provenance source (the only
    // producer of effectBankNext) so the engine can log + echo who cycled the bank.
    // NO client-computed target — the engine picks the next bank (atomic cycle+wrap).
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'effectBankNext' });
    expect(api.nextEffectBank).toHaveBeenCalledWith('vsn1_sb2');
  });

  it('threads a failed nextEffectBank result back (fail-loud)', async () => {
    const api = makeApi();
    (api.nextEffectBank as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'engine 400' });
    const r = await createDispatcher(api, baseCtx)({ kind: 'effectBankNext' });
    expect(r).toEqual({ ok: false, error: 'engine 400' });
  });

  it('threads a failed setEffectsPage result back (fail-loud)', async () => {
    const api = makeApi();
    (api.setEffectsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'engine 400' });
    const r = await createDispatcher(api, baseCtx)({ kind: 'effectsPageSelect', page: 1 });
    expect(r).toEqual({ ok: false, error: 'engine 400' });
  });
});

// ── Manager runtime: side-button page select + encoder-press mode cycle ──────

const vsn1Endpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'Intech Grid MIDI device', portIndex: 0, kind: 'source' },
  { id: 'out-0', name: 'Intech Grid MIDI device', portIndex: 0, kind: 'destination' },
];

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: [], globalEffects: {},
  layers: [], deckLayer: null, activeContext: 'deck',
  globalEffectSlots: [
    { slot: 1, active: true, behavior: 'toggle', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    { slot: 2, active: false, behavior: 'toggle', intensity: 0.25, mode: 'down', modeValues: ['up', 'down'] },
  ],
  effectsPage: 0,
  colorPalettes: [], focused: null, syncOwnedKeys: new Set<string>(),
};

function setup(
  snap: () => MidiEngineSnapshot = () => baseSnap,
  now?: () => number,
) {
  const transport = new FakeTransport(vsn1Endpoints);
  const api = makeApi();
  const profile = validateProfile(rawVsn1, 'vsn1.yaml');
  const manager = new MidiManager({
    profiles: [profile], transportFactory: () => transport, api,
    getSnapshot: snap, defaultContext: 'deck', coalesceMs: 0, reconnectDebounceMs: 0,
    ...(now ? { now } : {}),
  });
  return { transport, api, manager };
}

// Drain the microtask/timer queue (dispatch .then chains, coalescer flushes).
const drain = () => new Promise((r) => setTimeout(r, 0));

// DRUM-ALWAYS (Sina 2026-07-10): the two-view system is retired. The manager is
// pinned to DRUM (sb_0 only re-asserts DRUM; EFFECT view is unreachable), where
// EVERY key press fires immediately. The old `enterEffectView(transport)` helper
// (double-click sb_0 → EFFECT) is gone; there is no gesture that reaches EFFECT.

describe('manager — effects v2 runtime (VSN1)', () => {
  // Page-follow retirement (2026-07) COMPLETE: device-native paging is gone
  // (page-0-only deploys), so the PHYSICAL side-button page CC (controller 40) no
  // longer does anything in CaptainPad. (The four SMALL buttons sb_0..sb_3 also
  // never page — see the sb reset/disable/view tests.)
  it('a device page CC is IGNORED — page-follow deleted (no device→app PATCH)', async () => {
    // The device→app follow path was DELETED, so CaptainPad no longer follows the
    // device page CC into an engine effectsPage PATCH. The decoder that used to
    // filter it (decodeDevicePageCc) is gone too — the device page CC is inert.
    const { manager, api, transport } = setup(); // baseSnap.effectsPage = 0
    await manager.start();
    transport.emit([0xb1, 40, 2]); // device → page 2 (feedback channel, CC 40)
    expect(api.setEffectsPage).not.toHaveBeenCalled();
  });

  it('a device page CC for the CURRENT page is also a NO-OP (nothing follows the device page)', async () => {
    const { manager, api, transport } = setup(); // already on page 0
    await manager.start();
    transport.emit([0xb1, 40, 0]); // page-follow retired → no PATCH either way
    expect(api.setEffectsPage).not.toHaveBeenCalled();
  });

  it('the four SMALL buttons do NOT page — sb_2 is DISABLED (banks shelved), sb_3 shows the logo', async () => {
    // Sina's map: sb_0 MODE / sb_1 VIEW / sb_2 DISABLED (banks shelved 2026-07-14) /
    // sb_3 LOGO. Reset-all + disable-all moved off the small buttons (they stay
    // reachable in the CaptainPad UI); no small button changes the effects page.
    const { manager, api, transport } = setup();
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 43, 127]); // sb_2 (note 43) → DISABLED, NOT page
    expect(api.resetAllGlobalEffects).not.toHaveBeenCalled();
    expect(api.setEffectsPage).not.toHaveBeenCalled();
    transport.emit([0x90, 44, 127]); // sb_3 (note 44) → MarsinLED logo CC
    expect(api.disableAllGlobalEffects).not.toHaveBeenCalled();
    expect(transport.sent).toContainEqual([0xb2, 41, 1]); // welcome/logo one-shot
  });

  it('sb_2 is DISABLED (banks shelved) — NOTHING dispatches even with a seeded bank', async () => {
    // Multi-bank effects UX SHELVED 2026-07-14 (BANKS_UI_ENABLED=false): sb_2 does
    // NOTHING. Even with a SEEDED active bank (which pre-shelf would have cycled),
    // no bank POST fires — handleVsn1BankButton early-returns behind the flag. The
    // status line names the press so the operator sees the button is inert.
    // (The pre-shelf cycle/refuse-unseeded assertions live in the SKIPPED
    // "anti-spurious-flip guards" block below, preserved as the shelved-feature doc.)
    const { manager, api, transport } = setup(() => ({ ...baseSnap, activeBankId: 'bank_a' }));
    await manager.start();
    transport.emit([0x90, 43, 127]); // sb_2
    await drain();
    expect(api.nextEffectBank).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/disabled|shelved/i);
  });

  // The encoder-press mode cycle (with + without a selection) is proven in the
  // VSN1 selected-slot runtime home (vsn1_intensity → scenarios/vsn1_runtime):
  // "the jog press cycles the SELECTED slot mode" + "…with NO selection is inert".
});

// ── sb_2 bank-cycle — anti-spurious-flip guards (SHELVED, describe.skip) ──────
// SHELVED 2026-07-14: the multi-bank effects UX is OFF (BANKS_UI_ENABLED=false),
// so sb_2 does NOTHING and these guard tests are SKIPPED — they exercise the
// bank-CYCLE path (they assert nextEffectBank fires / is dropped), which the
// disabled early-return short-circuits before any guard runs. They are KEPT, not
// deleted: the guard machinery (stale / self-echo / in-flight / debounce) is
// preserved in handleVsn1BankButton as a TODO, and these tests document + protect
// it. UN-SKIP this block when BANKS_UI_ENABLED is flipped back to true.
//
// The guards reject every non-operator source: a stale queued Web MIDI replay, a
// MIDI loopback of our own page-2 side-LED feedback (Note On note 43 — same note
// the device's sb_2 emits), a still-in-flight POST, and a mechanical double-tap.
// The monotonic clock is INJECTED so every window is deterministic.
describe.skip('manager — VSN1 sb_2 anti-spurious-flip guards (SHELVED — banks off)', () => {
  // A mutable injected clock ({ t } advanced by the test) + a mutable snapshot
  // (so a test can simulate the WS effectBanks echo, then onEngineUpdate to converge).
  function guardSetup(getSnap: () => MidiEngineSnapshot, clock: { t: number }) {
    const transport = new FakeTransport(vsn1Endpoints);
    const api = makeApi();
    const profile = validateProfile(rawVsn1, 'vsn1.yaml');
    const manager = new MidiManager({
      profiles: [profile], transportFactory: () => transport, api,
      getSnapshot: getSnap, defaultContext: 'deck', coalesceMs: 0, reconnectDebounceMs: 0,
      now: () => clock.t,
    });
    return { transport, api, manager };
  }

  it('STALE: an sb_2 event older than ~2s vs the clock is DROPPED (no POST)', async () => {
    const clock = { t: 10000 };
    const { manager, api, transport } = guardSetup(() => ({ ...baseSnap, activeBankId: 'bank_a' }), clock);
    await manager.start();
    transport.emit([0x90, 43, 127], 5000); // stamped 5s ago on the shared clock
    await drain();
    expect(api.nextEffectBank).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/stale/i);
  });

  it('MISSING TIMESTAMP: a zero/absent stamp is treated FRESH and cycles', async () => {
    const clock = { t: 10000 };
    const { manager, api, transport } = guardSetup(() => ({ ...baseSnap, activeBankId: 'bank_a' }), clock);
    await manager.start();
    transport.emit([0x90, 43, 127]); // FakeTransport default stamp 0 → fresh
    await drain();
    expect(api.nextEffectBank).toHaveBeenCalledWith('vsn1_sb2');
  });

  it('IN-FLIGHT: a second press while the POST is round-tripping is ignored', async () => {
    const clock = { t: 1000 };
    const { manager, api, transport } = guardSetup(() => ({ ...baseSnap, activeBankId: 'bank_a' }), clock);
    await manager.start();
    transport.emit([0x90, 43, 127]); // accept → POST cycle, in-flight (no echo yet)
    await drain();
    clock.t = 1050; // 50ms later, echo has NOT landed
    transport.emit([0x90, 43, 127]); // dropped: in flight
    await drain();
    expect(api.nextEffectBank).toHaveBeenCalledTimes(1);
    expect(manager.getStatuses()[0].lastEvent).toMatch(/in flight/i);
  });

  it('DEBOUNCE: a repeat within ~400ms AFTER the echo cleared in-flight → one dispatch', async () => {
    const clock = { t: 1000 };
    const snap = { ...baseSnap, activeBankId: 'bank_a' as string };
    const { manager, api, transport } = guardSetup(() => snap, clock);
    await manager.start();
    transport.emit([0x90, 43, 127]); // accept → POST cycle, in-flight (pre-cycle id 'bank_a')
    await drain();
    // Simulate the WS effectBanks echo landing on a DIFFERENT bank → onEngineUpdate
    // sees activeBankId changed off the pre-cycle id and clears in-flight.
    snap.activeBankId = 'bank_b';
    manager.onEngineUpdate();
    clock.t = 1150; // 150ms after the accept — inside the 400ms debounce window
    transport.emit([0x90, 43, 127]); // dropped: debounce
    await drain();
    expect(api.nextEffectBank).toHaveBeenCalledTimes(1);
    expect(manager.getStatuses()[0].lastEvent).toMatch(/debounce/i);
    // Past the debounce window → the next press is accepted (cycles again).
    clock.t = 1500;
    transport.emit([0x90, 43, 127]);
    await drain();
    expect(api.nextEffectBank).toHaveBeenCalledTimes(2);
    expect(api.nextEffectBank).toHaveBeenLastCalledWith('vsn1_sb2');
  });

  it('SELF-ECHO: a loopback of our own page-2 side-LED (note 43) is DROPPED', async () => {
    // On page 2 the feedback stream sends Note On note 43 vel 127 (the page-2 LED).
    // A MIDI loopback echoes that exact note straight back — it must NOT read as an
    // sb_2 press. Seeded bank so refuse-unseeded can't be what stops it.
    const clock = { t: 2000 };
    const { manager, api, transport } = guardSetup(
      () => ({ ...baseSnap, effectsPage: 2, activeBankId: 'bank_a' }), clock);
    await manager.start(); // projectAndSend records outbound note 43 (vel 127) at t=2000
    transport.emit([0x90, 43, 127]); // handled at t=2000 → 0ms after our send → self-echo
    await drain();
    expect(api.nextEffectBank).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/self-echo/i);
  });

  it('SELF-ECHO does NOT shadow a real press outside the ~50ms window', async () => {
    const clock = { t: 2000 };
    const { manager, api, transport } = guardSetup(
      () => ({ ...baseSnap, effectsPage: 2, activeBankId: 'bank_a' }), clock);
    await manager.start(); // outbound note 43 recorded at t=2000
    clock.t = 2100; // 100ms later — well past the 50ms self-echo window
    transport.emit([0x90, 43, 127]); // a genuine press now
    await drain();
    expect(api.nextEffectBank).toHaveBeenCalledWith('vsn1_sb2');
  });
});

// ── Full feedback re-send on EVERY page change (firmware 2026-07-11) ─────────
// The device restarts its Lua VM on each page load, wiping all rendered state —
// a diff against what CaptainPad last sent would leave the new page's LEDs and
// screen dark for any byte-identical value. Any page change (engine broadcast)
// AND any VSN1 side-button press (even re-selecting the CURRENT page — the VM
// still restarts) must re-emit the WHOLE frame.

describe('manager — full feedback re-send on page change (Lua VM restart)', () => {
  it('re-sends the FULL frame on an engine page change, even byte-identical slot state', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Page 0 → 1, where slot 9's bytes are IDENTICAL to slot 1's (active, same
    // intensity, same mode index). A pure diff would suppress the key-0
    // active/value/mode frames; the VM-restart resync re-sends them anyway.
    snap = { ...baseSnap, effectsPage: 1, globalEffectSlots: [
      { slot: 9, active: true, behavior: 'toggle', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]);                    // active re-sent
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, Math.round(0.5 * 127)]);   // value re-sent
    expect(transport.sent).toContainEqual([0xb0 | FB_MODE_CH, 32, 0]);                        // mode re-sent
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);                        // new page index
    expect(transport.sent).toContainEqual([0x90 | FB_PAGE_CH, 42, 127]);                      // sb1 lit
  });

  it('page-follow retired: a device page CC does NOT PATCH, but an ENGINE page change still full-resyncs', async () => {
    // Page-follow is retired, so the device page CC is ignored (no PATCH). But a
    // page change from the engine's own logical page (any surface) must STILL
    // full-resync — the page DIFFERENCE arms the re-sync so the new page's whole
    // frame repaints (a pure diff could leave byte-identical slots dark after the
    // device VM wipe).
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, api, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0xb1, 40, 1]); // device side button → page 1 (now IGNORED)
    await drain();
    expect(api.setEffectsPage).not.toHaveBeenCalled();
    // The engine changes its logical page and broadcasts effectsPage=1 (slot 9
    // identical bytes to the old slot 1) → the page DIFFERENCE arms the resync.
    snap = { ...baseSnap, effectsPage: 1, globalEffectSlots: [
      { slot: 9, active: true, behavior: 'toggle', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 9 active repainted on key 0
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);     // new page index
  });

  it('a steady-state engine update (same page) stays DIFFED — no full re-blast', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Same page, one slot's intensity moves → exactly the changed CC, not a frame.
    snap = { ...baseSnap, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', intensity: 1.0, mode: 'up', modeValues: ['up', 'down'] },
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 127]);
    expect(transport.sent).not.toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]); // page not re-sent
  });
});

// ── Prompt toggle LED echo (firmware 2026-07-11: stateless device keys) ──────
// The device no longer self-lights toggle keys — a sticky key LED comes ONLY
// from slot-active feedback. So the moment a toggle dispatch is ACKed, the host
// echoes the slot's new active state (optimistic, from the pre-dispatch
// snapshot) instead of waiting for the engine broadcast round-trip. Under
// DRUM-always every key press fires the toggle immediately, so the echo rides
// the FIRST press (no two-step). A REJECTED dispatch must send no echo.

describe('manager — prompt toggle LED echo (VSN1)', () => {
  it('echoes the key active LED immediately when the toggle dispatch lands', async () => {
    const { manager, api, transport } = setup(); // slot 2 active:false in baseSnap
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 33, 127]); // DRUM: one press fires the toggle
    await drain();
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
    // Slot 2 = key index 1 on page 0 → active note 33, echoed ON without any
    // engine broadcast having updated the snapshot.
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 33, 127]);
  });

  it('sends NO echo when the engine rejects the toggle (fail-loud, not fake-lit)', async () => {
    const { manager, api, transport } = setup();
    (api.dispatchGlobalEffectSlotAction as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ok: false, error: 'engine 500' });
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 33, 127]); // fire → engine rejects
    await drain();
    expect(transport.sent.filter((m) => m[0] === (0x90 | FB_ACTIVE_CH))).toHaveLength(0);
  });

  it('the trailing engine broadcast that AGREES with the echo is diff-suppressed', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, globalEffectSlots: [
      baseSnap.globalEffectSlots[0],
      { slot: 2, active: false, behavior: 'toggle', intensity: 0.25, mode: 'down', modeValues: ['up', 'down'] },
    ] };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.emit([0x90, 33, 127]); // DRUM: fire → echo note 33 = 127
    await drain();
    transport.sent.length = 0;
    // Engine confirms the same state → nothing re-sends (the echo was recorded
    // into the feedback diff, so the matching broadcast is suppressed).
    snap = { ...snap, globalEffectSlots: [
      snap.globalEffectSlots[0],
      { ...snap.globalEffectSlots[1], active: true },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toHaveLength(0);
  });
});

// ── DOWNWARD PATH: any state change (UI / engine / device) → device feedback ──
// The manager mirrors the engine snapshot to the VSN1. This proves the CaptainPad
// → device direction is solid: a change from ANY origin, once it lands in the
// snapshot + fires onEngineUpdate, produces the correct device feedback — and the
// page resync is robust against races with unrelated onEngineUpdate churn.

describe('manager — downward propagation (UI/engine/device → device)', () => {
  it('a UI-origin toggle (snapshot flip → onEngineUpdate) sends the active note', async () => {
    // A UI tap round-trips through the engine; the hook rebuilds the snapshot and
    // calls onEngineUpdate. Slot 2 (key idx 1, note 33) flips active.
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    snap = { ...baseSnap, globalEffectSlots: [
      baseSnap.globalEffectSlots[0],
      { ...baseSnap.globalEffectSlots[1], active: true }, // UI turned slot 2 ON
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 33, 127]);
  });

  it('a UI-origin intensity + mode edit sends the value + mode CCs', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    snap = { ...baseSnap, globalEffectSlots: [
      { ...baseSnap.globalEffectSlots[0], intensity: 1, mode: 'down' }, // slot 1 edited in UI
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 127]);       // value → 1.0
    expect(transport.sent).toContainEqual([0xb0 | FB_MODE_CH, 32, 1]);          // mode 'down' idx 1
  });

  it('does not echo a stale engine intensity backward during a VSN1 turn', async () => {
    let clock = 1000;
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap, () => clock);
    await manager.start();
    transport.sent.length = 0;

    // Grid predicts slot 1 at 100/127 and sends that absolute value.
    transport.emit([0xb0, 32, 100], clock);
    await drain();
    // A lagging WS frame still carries 0.5. Feedback must preserve Grid's
    // optimistic 100 rather than pulling its accumulator backward to 64.
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 100]);

    transport.sent.length = 0;
    snap = { ...baseSnap, globalEffectSlots: [
      { ...baseSnap.globalEffectSlots[0], intensity: 100 / 127 },
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toHaveLength(0);

    // The guard is bounded: if the engine never agrees, its authority resumes.
    clock += 751;
    snap = { ...baseSnap, globalEffectSlots: [
      { ...baseSnap.globalEffectSlots[0], intensity: 0.25 },
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 32]);
  });

  it('a UI-origin PAGE change re-sends the FULL frame with the new page window', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // UI switched to page 1 (engine effectsPage broadcast → hook → snapshot).
    snap = { ...baseSnap, effectsPage: 1, globalEffectSlots: [
      { slot: 9, active: true, behavior: 'toggle', intensity: 0.75, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);   // page index
    expect(transport.sent).toContainEqual([0x90 | FB_PAGE_CH, 42, 127]); // sb1 lit
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 9 active on key 0
  });

  it('page resync survives an UNRELATED onEngineUpdate racing in (the flakiness fix)', async () => {
    // The root cause of "works and doesn't work": onEngineUpdate fires for many
    // unrelated changes. If one lands between the page change and the device VM
    // restart, a diff-only trigger would repopulate the diff and swallow the
    // resync. The force-resync FLAG must still deliver a full frame.
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    // Page changes to 1 in the snapshot…
    snap = { ...baseSnap, effectsPage: 1, globalEffectSlots: [
      { slot: 9, active: true, behavior: 'toggle', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    // …but an UNRELATED update (e.g. a pattern-list refresh) fires the FIRST
    // onEngineUpdate for this page — it must already carry the full page-1 frame.
    manager.onEngineUpdate();
    const afterFirst = [...transport.sent];
    expect(afterFirst).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);
    expect(afterFirst).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 9 painted
    // A subsequent identical update is a plain diff (no re-blast).
    transport.sent.length = 0;
    manager.onEngineUpdate();
    expect(transport.sent).toHaveLength(0);
  });

  it('the device is authoritative for NOTHING re: page — a device page CC is ignored (page-follow retired)', async () => {
    // Page-follow retired: a device page CC no longer even PATCHes. The device is
    // authoritative for nothing re: page — the engine snapshot (page 0) is the
    // only source of truth, and the ignored CC never yields a page-3 feedback
    // frame.
    const snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, api, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0xb1, 40, 3]); // device side button → request page 3 (IGNORED)
    await drain();
    expect(api.setEffectsPage).not.toHaveBeenCalled();               // no follow PATCH
    expect(transport.sent).not.toContainEqual([0xb0 | FB_PAGE_CH, 40, 3]); // never page 3
  });
});

// ── LED truth on (re)connect: the device wakes to the real live on/off state ──

describe('manager — active-LED truth on (re)connect + page (VSN1)', () => {
  it('on the initial connect, every on-page key carries its CURRENT active truth', async () => {
    // baseSnap: slot 1 active, slot 2 inactive → note 32 = 127, note 33 = 0.
    const { manager, transport } = setup();
    await manager.start();
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 1 ON
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 33, 0]);   // slot 2 OFF
  });

  it('on a genuine reconnect (unplug→replug) the FULL active truth re-sends', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    // Toggle slot 2 ON while connected (engine-origin), device shows it.
    snap = { ...baseSnap, globalEffectSlots: [
      baseSnap.globalEffectSlots[0],
      { ...baseSnap.globalEffectSlots[1], active: true },
    ] };
    manager.onEngineUpdate();
    // Unplug → replug. The device VM is wiped; the reconnect must re-send the
    // WHOLE truth (both keys), not a diff against pre-unplug state.
    transport.setEndpoints([]);
    await new Promise((r) => setTimeout(r, 1));
    transport.setEndpoints(vsn1Endpoints);
    await new Promise((r) => setTimeout(r, 1));
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 1 ON
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 33, 127]); // slot 2 now ON
  });
});

// ── MIDI feedback: the pipeline emits slot state + page for the device Lua ───

describe('VSN1 feedback projector (pure)', () => {
  it('modeIndex finds the value in the list, else 0', () => {
    expect(modeIndex({ slot: 1, active: false, mode: 'down', modeValues: ['up', 'down'] })).toBe(1);
    expect(modeIndex({ slot: 1, active: false, mode: 'x', modeValues: ['up', 'down'] })).toBe(0);
    expect(modeIndex({ slot: 1, active: false })).toBe(0);
  });

  it('emits page CC + side-button LEDs + per-page active/value/mode', () => {
    const targets = [...vsn1FeedbackTargets({
      page: 0,
      slots: [
        { slot: 1, active: true, intensity: 1, mode: 'down', modeValues: ['up', 'down'] },
      ],
    })];
    // Page index on the jog CC.
    const pageStatus = 0xb0 | FB_PAGE_CH;
    expect(targets.find((t) => t.key === `${pageStatus}:40`)?.value).toBe(0);
    // Side-button 0 (note 41) lit for the active page, 1..3 dark.
    const noteStatus = 0x90 | FB_PAGE_CH;
    expect(targets.find((t) => t.key === `${noteStatus}:41`)?.value).toBe(127);
    expect(targets.find((t) => t.key === `${noteStatus}:42`)?.value).toBe(0);
    // Slot 1 (page 0, index 0 → key note 32): active + full intensity + mode idx 1.
    expect(targets.find((t) => t.key === `${0x90 | FB_ACTIVE_CH}:32`)?.value).toBe(127);
    expect(targets.find((t) => t.key === `${0xb0 | FB_VALUE_CH}:32`)?.value).toBe(127);
    expect(targets.find((t) => t.key === `${0xb0 | FB_MODE_CH}:32`)?.value).toBe(1);
  });

  it('page p views flat slots 8p+1..8p+8', () => {
    // Page 1 slot index 0 = flat slot id 9.
    const targets = [...vsn1FeedbackTargets({
      page: 1,
      slots: [{ slot: 9, active: true, intensity: 0.5, mode: 'down', modeValues: ['up', 'down'] }],
    })];
    expect(targets.find((t) => t.key === `${0x90 | FB_ACTIVE_CH}:32`)?.value).toBe(127); // key note 32 = slot 9 on page 1
    expect(targets.find((t) => t.key === `${0xb0 | FB_VALUE_CH}:32`)?.value).toBe(Math.round(0.5 * 127));
    // The page index reports 1, and side-button 1 (note 42) is lit.
    expect(targets.find((t) => t.key === `${0xb0 | FB_PAGE_CH}:40`)?.value).toBe(1);
    expect(targets.find((t) => t.key === `${0x90 | FB_PAGE_CH}:42`)?.value).toBe(127);
  });

  it('diffs — only changed feedback re-sends', () => {
    const s1 = { page: 0, slots: [{ slot: 1, active: false, intensity: 0.2, mode: 'up', modeValues: ['up', 'down'] }] };
    const first = projectVsn1Feedback(s1, {});
    expect(first.messages.length).toBeGreaterThan(0);
    // Identical state → no messages.
    const second = projectVsn1Feedback(s1, first.next);
    expect(second.messages).toHaveLength(0);
    // Flip slot 1 active → exactly ONE changed frame (the active note).
    const s2 = { page: 0, slots: [{ slot: 1, active: true, intensity: 0.2, mode: 'up', modeValues: ['up', 'down'] }] };
    const third = projectVsn1Feedback(s2, second.next);
    expect(third.messages).toHaveLength(1);
    expect(third.messages[0]).toEqual([0x90 | FB_ACTIVE_CH, 32, 127]);
  });
});

// ── Connection test: engine snapshot → the manager emits MIDI feedback ───────

describe('manager — VSN1 MIDI feedback pipeline (connection)', () => {
  it('emits slot active/value/mode + page feedback on connect and on engine update', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    // On connect the manager projects a full feedback frame. Slot 1 is active +
    // intensity 0.5 + mode 'up' (index 0), page 0.
    const activeNote = [0x90 | FB_ACTIVE_CH, 32, 127];
    const valueCc = [0xb0 | FB_VALUE_CH, 32, Math.round(0.5 * 127)];
    const pageCc = [0xb0 | FB_PAGE_CH, 40, 0];
    expect(transport.sent).toEqual(expect.arrayContaining([activeNote, valueCc, pageCc]));

    // Engine broadcast: slot 1 intensity moves to 1.0 → the pipeline emits the
    // ONE changed value CC (diffed), proving live value changes ride feedback.
    transport.sent.length = 0;
    snap = { ...baseSnap, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', intensity: 1.0, mode: 'up', modeValues: ['up', 'down'] },
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 127]);
  });

  it('a page change (any source) converges the feedback everywhere', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Engine reports page 1 (whether the change came from the UI switcher, a
    // side button, or another surface — the snapshot is the single home). The
    // feedback now reports page 1 + side-button 1 lit + slots 9..16 on the keys.
    snap = { ...baseSnap, effectsPage: 1, globalEffectSlots: [
      { slot: 9, active: true, behavior: 'toggle', intensity: 0.75, mode: 'down', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);   // page index → 1
    expect(transport.sent).toContainEqual([0x90 | FB_PAGE_CH, 42, 127]); // sb1 lit
    expect(transport.sent).toContainEqual([0x90 | FB_PAGE_CH, 41, 0]);   // sb0 cleared
    // Key 0 now shows slot 9's VALUE (0.75) — the page's slot window shifted to
    // 9..16, so the value CC changes even though the active flag stayed 127.
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, Math.round(0.75 * 127)]);
  });
});

// ── WELCOME / hello: sent on effects-panel load + on MIDI (re)connect ────────

const WELCOME = [0xb0 | WELCOME_CH, WELCOME_CC, WELCOME_VALUE]; // [0xB2, 41, 1]

describe('VSN1 WELCOME (hello)', () => {
  it('vsn1WelcomeMessage() is CC ch2 controller 41 value 1', () => {
    expect(vsn1WelcomeMessage()).toEqual([0xb2, 41, 1]);
    expect(WELCOME_CH).toBe(2);
    expect(WELCOME_CC).toBe(41);
    expect(WELCOME_VALUE).toBe(1);
  });

  // The welcome is now DEVICE-HELLO-DRIVEN (item 2, 2026-07-10): the device pings
  // "VM ready" (CC controller 41 = 1) on its first VM start after we connect; the
  // FIRST such hello of a connection arms the welcome + a full re-sync. A blind
  // on-connect send is gone (it could race the device's restart).
  const DEVICE_HELLO = [0xb1, 41, 1]; // device → host CC 41 (any channel; page 1 here)

  it('the FIRST device hello of a connection emits the welcome + a full feedback re-sync', async () => {
    const { manager, transport } = setup();
    await manager.start();
    transport.sent.length = 0;
    transport.emit(DEVICE_HELLO); // device announces its VM is ready
    // The hello rides with the re-sync. It leads the FEEDBACK frame (device greets
    // before the state paints); the view-mode re-echo CC may precede it (it is a
    // separate one-shot sent first so `vm` is right before the frame renders).
    expect(transport.sent).toContainEqual(WELCOME);
    const wi = transport.sent.findIndex((m) => m[0] === WELCOME[0] && m[1] === WELCOME[1] && m[2] === WELCOME[2]);
    const ai = transport.sent.findIndex((m) => m[0] === (0x90 | FB_ACTIVE_CH) && m[1] === 32);
    expect(wi).toBeGreaterThanOrEqual(0);
    expect(wi).toBeLessThan(ai); // welcome leads the state frame
    // …ALONGSIDE the full state (slot 1 active + page 0), proving "hello + full re-sync".
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]);
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]);
  });

  it('a SUBSEQUENT device hello (page load / re-flash) re-echoes the view mode + state but NOT the welcome', async () => {
    const { manager, transport } = setup();
    await manager.start(); // the single drum/grid view: render selector pinned 1
    transport.emit(DEVICE_HELLO); // first hello → welcome armed + consumed
    transport.sent.length = 0;
    transport.emit(DEVICE_HELLO); // second hello (a VM restart) → state only
    // The render selector is re-echoed (survives the VM wipe) — pinned grid (1) …
    expect(transport.sent).toContainEqual([0xb0 | VIEW_MODE_CH, VIEW_MODE_CC, 1]);
    // … the full state re-pushes (page index repainted) …
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]);
    // … but the logo does NOT (a re-flash / page load is not a fresh connect).
    expect(transport.sent).not.toContainEqual(WELCOME);
  });

  it('is a ONE-SHOT — not re-sent on a plain engine update', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.emit([0xb1, 41, 1]); // first device hello → welcome
    expect(transport.sent).toContainEqual(WELCOME);
    transport.sent.length = 0;
    // A steady-state slot change re-sends the changed feedback but NOT the hello.
    snap = { ...baseSnap, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', intensity: 1.0, mode: 'up', modeValues: ['up', 'down'] },
      baseSnap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 127]); // the value changed…
    expect(transport.sent).not.toContainEqual(WELCOME);                   // …but no second hello.
  });

  it('requestVsn1Welcome() (effects panel load) re-echoes the view mode + hello + a full re-sync', async () => {
    const { manager, transport } = setup();
    await manager.start();
    transport.sent.length = 0;
    // The effects panel just mounted. It must re-echo the VIEW MODE first (H2
    // fix, 2026-07-10) — symmetric with the device-hello + layout-deploy resync
    // paths — so the device's `vm` is restored instead of silently dropping to
    // DRUM on a panel remount. Then the hello + a fresh full frame.
    manager.requestVsn1Welcome();
    // View-mode CC leads (the pinned drum/grid render selector → value 1).
    expect(transport.sent[0]).toEqual([0xb0 | VIEW_MODE_CH, VIEW_MODE_CC, 1]);
    // The welcome still rides along and leads the state frame.
    expect(transport.sent).toContainEqual(WELCOME);
    const wi = transport.sent.findIndex((m) => m[0] === WELCOME[0] && m[1] === WELCOME[1] && m[2] === WELCOME[2]);
    const ai = transport.sent.findIndex((m) => m[0] === (0x90 | FB_ACTIVE_CH) && m[1] === 32);
    expect(wi).toBeGreaterThanOrEqual(0);
    expect(wi).toBeLessThan(ai); // welcome leads the state frame
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // full state re-painted
  });

  it('re-arms the hello on a genuine MIDI reconnect (unplug → replug), driven by the next device hello', async () => {
    const { manager, transport } = setup();
    await manager.start();
    transport.emit([0xb1, 41, 1]); // first hello of this connection → welcome
    expect(transport.sent).toContainEqual(WELCOME);
    transport.sent.length = 0;
    // Unplug (endpoints vanish) then replug — the debounced reconnect runs a
    // genuine disconnected→connected transition, which RE-ARMS the next-hello.
    transport.setEndpoints([]);
    await new Promise((r) => setTimeout(r, 1));
    transport.setEndpoints(vsn1Endpoints);
    await new Promise((r) => setTimeout(r, 1));
    // No blind welcome on the replug itself…
    expect(transport.sent).not.toContainEqual(WELCOME);
    // …the device's post-reconnect hello raises it again (fresh connection).
    transport.emit([0xb1, 41, 1]);
    expect(transport.sent).toContainEqual(WELCOME);
  });
});

// ── Bug #2: PAGE-AWARE key → slot mapping ────────────────────────────────────
// The VSN1 keys were pinned to flat slots 1-8 / channel 0, so on pages 2-4 a key
// press addressed the wrong (page-0) slot. A key on page p must address flat slot
// 8*p + k + 1, following the ENGINE's effectsPage. Under DRUM-always every press
// fires immediately (toggle or trigger); the page-aware mapping must still land
// on the right flat slot on every page.

// A page-2 snapshot: slots 17..24 are what the device DISPLAYS on page 2.
const page2Snap: MidiEngineSnapshot = {
  ...baseSnap,
  effectsPage: 2,
  globalEffectSlots: [
    { slot: 17, active: false, behavior: 'toggle', effectId: 'strobe', label: 'P3S1', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
    { slot: 18, active: false, behavior: 'trigger', effectId: 'dropHit', label: 'P3S2', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
  ],
};

describe('manager — page-aware VSN1 key → slot (bug #2)', () => {
  it('a key on page 2 fires the page-2 flat slot (8*2 + k + 1), not slot 1-8', async () => {
    const { manager, api, transport } = setup(() => page2Snap);
    await manager.start();
    // Key note 32 (k=0). Slot 17 is a TOGGLE → DRUM: fires immediately on slot 17
    // (page 2), NOT slot 1.
    transport.emit([0x90, 32, 127]);
    await drain();
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(17, 'toggle');
    expect(api.dispatchGlobalEffectSlotAction).not.toHaveBeenCalledWith(1, 'toggle');
  });

  it('a TRIGGER key on page 2 fires immediately on the page-2 slot, every press', async () => {
    const { manager, api, transport } = setup(() => page2Snap);
    await manager.start();
    // Key note 33 (k=1) → slot 18, a trigger. Fires on the first press (no two-step).
    transport.emit([0x90, 33, 127]);
    await drain();
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(18, 'trigger');
    // …and again on every subsequent press (hand-drummed).
    transport.emit([0x90, 33, 127]);
    await drain();
    expect((api.dispatchGlobalEffectSlotAction as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === 18 && c[1] === 'trigger')).toHaveLength(2);
  });

  it('the key press MATCHES even when the note rides channel = page (anyChannel)', async () => {
    // The firmware rides key notes on channel = page. A page-2 key note arrives on
    // channel 2; the anyChannel note match must still resolve it (else the key is
    // dead off page 0 — the exact bug). Slot 17 toggle → fires immediately in DRUM.
    const { manager, api, transport } = setup(() => page2Snap);
    await manager.start();
    transport.emit([0x92, 32, 127]); // note 32 on channel 2 (page 2)
    await drain();
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(17, 'toggle');
  });

  it('on page 0 the mapping is the identity (no regression): key note 33 → slot 2', async () => {
    const { manager, api, transport } = setup(); // baseSnap, page 0
    await manager.start();
    transport.emit([0x90, 33, 127]); // DRUM: fires slot 2 immediately
    await drain();
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });
});

// ── Select-cue: pressing a key snaps the device LCD to its slot ───────────────
// The select cue is a dedicated CC (ch2 cc42 = the pressed key index) that snaps
// the device's `sel` (and its LCD detail) to the pressed slot. Under DRUM-always
// EVERY key press emits it (the LCD follows the finger) alongside the immediate
// dispatch — for TOGGLE and TRIGGER slots alike.

describe('manager — VSN1 select cue (LCD follows the pressed key)', () => {
  it('vsn1SelectCueMessage encodes the key index on ch2 cc42; clamps off-page to NONE', () => {
    expect(vsn1SelectCueMessage(0)).toEqual([0xb0 | SELECT_CUE_CH, SELECT_CUE_CC, 0]);
    expect(vsn1SelectCueMessage(7)).toEqual([0xb0 | SELECT_CUE_CH, SELECT_CUE_CC, 7]);
    expect(vsn1SelectCueMessage(9)).toEqual([0xb0 | SELECT_CUE_CH, SELECT_CUE_CC, SELECT_CUE_NONE]);
  });

  it('pressing a toggle key emits the select cue for that key index (page-aware)', async () => {
    const { manager, transport } = setup(() => page2Snap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 32, 127]); // press slot 17 (page 2, key index 0)
    expect(transport.sent).toContainEqual([0xb0 | SELECT_CUE_CH, SELECT_CUE_CC, 0]);
  });

  it('a TRIGGER key ALSO emits the select cue in DRUM (the LCD follows every press)', async () => {
    // Under DRUM-always every key snaps the LCD detail to the pressed slot (a cue)
    // AND fires immediately — including trigger slots. (The old EFFECT-view "no cue
    // for a trigger" rule is retired with EFFECT view.)
    const { manager, transport } = setup(() => page2Snap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 33, 127]); // slot 18 trigger → fire + snap LCD (key idx 1)
    await drain();
    expect(transport.sent).toContainEqual([0xb0 | SELECT_CUE_CH, SELECT_CUE_CC, 1]);
  });
});

// ── Bug #3: a LAYOUT edit (swap/clear) forces a full VSN1 feedback re-send ────
// A slot swap/clear from CaptainPad changes the layout — the device re-flashes +
// restarts its Lua VM (deploy is a separate wave; the runtime feedback must stay
// whole). So a layout change must re-send the FULL frame, not a diff that could
// leave the swapped slot's active/value/mode dark. A pure runtime value change
// (intensity/mode/active) must NOT trigger the full re-blast.

describe('manager — layout edit → full feedback re-send (bug #3)', () => {
  it('reports success only after the VSN1 ACKs the matching layout revision', async () => {
    const { manager, transport } = setup();
    await manager.start();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/awaiting controller/);

    const revision = projectVsn1Layout(
      baseSnap.effectsPage ?? 0,
      baseSnap.globalEffectSlots,
    ).revision;
    transport.emit([0xb0, VSN1_LAYOUT_ACK_CC, revision]);

    expect(manager.getStatuses()[0].lastEvent).toBe('VSN1 layout applied from iPad');
  });

  it('a slot SWAP (effectId change) re-sends the full frame', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', effectId: 'strobe', label: 'A', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
      { slot: 2, active: false, behavior: 'toggle', effectId: 'colorWash', label: 'B', intensity: 0.25, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Swap slot 2 to a different effect (label + effectId change) — a LAYOUT edit.
    // Slot 1's bytes are unchanged; a pure diff would send nothing for it, but the
    // full re-send re-emits slot 1's active/value/mode too.
    snap = { ...snap, globalEffectSlots: [
      snap.globalEffectSlots[0],
      { slot: 2, active: false, behavior: 'trigger', effectId: 'dropHit', label: 'C', intensity: 0.25, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    // Full frame: slot 1 (unchanged) is re-sent, proving a diff-reset happened.
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]);       // slot 1 active re-sent
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, Math.round(0.5 * 127)]);
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]);           // page re-sent
    // The new slot name itself is streamed to the directly attached VSN1, then
    // committed atomically. Slot 2 starts at name controller 10.
    expect(transport.sent).toContainEqual([0xb0 | VSN1_LAYOUT_NAME_CH, 10, 'C'.charCodeAt(0)]);
    expect(transport.sent.some((message) => (
      message[0] === (0xb0 | VSN1_LAYOUT_COLOR_CH)
      && message[1] === VSN1_LAYOUT_COMMIT_CC
    ))).toBe(true);
  });

  it('a slot CLEAR (enabled:false → empty effectId in the snapshot) re-sends the full frame', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', effectId: 'strobe', label: 'A', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
      { slot: 2, active: false, behavior: 'toggle', effectId: 'colorWash', label: 'B', intensity: 0.25, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Clear slot 2: the hook maps a disabled slot to effectId '' (see mapStatusSlot).
    snap = { ...snap, globalEffectSlots: [
      snap.globalEffectSlots[0],
      { slot: 2, active: false, behavior: 'toggle', effectId: '', label: 'Slot 2', intensity: 0.25, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]); // slot 1 re-sent (full frame)
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]);
  });

  it('a pure runtime change (intensity only, same layout) stays DIFFED — no full re-blast', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0, globalEffectSlots: [
      { slot: 1, active: true, behavior: 'toggle', effectId: 'strobe', label: 'A', intensity: 0.5, mode: 'up', modeValues: ['up', 'down'] },
      { slot: 2, active: false, behavior: 'toggle', effectId: 'colorWash', label: 'B', intensity: 0.25, mode: 'up', modeValues: ['up', 'down'] },
    ] };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    transport.sent.length = 0;
    // Same effectId/behavior/label — only slot 1's intensity moves. Exactly the
    // one changed value CC, NOT a full frame (the page CC must not re-send).
    snap = { ...snap, globalEffectSlots: [
      { ...snap.globalEffectSlots[0], intensity: 1.0 },
      snap.globalEffectSlots[1],
    ] };
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0 | FB_VALUE_CH, 32, 127]);
    expect(transport.sent).not.toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]); // page NOT re-sent → diffed
  });
});

// ── Item 2: view mode + feedback re-sync after a layout auto-deploy ──────────
// A CaptainPad effect change triggers the engine's layout auto-deploy → the
// device is RE-FLASHED (VM restart), resetting view mode to DRUM + wiping state.
// The host must re-echo the current view mode + full feedback so the device
// restores — WITHOUT re-arming the welcome (a re-flash is not a fresh connect).

describe('manager — resyncVsn1AfterLayoutDeploy (item 2)', () => {
  it('re-echoes the pinned view-mode CC + a full feedback frame, NO welcome', async () => {
    const snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, transport } = setup(() => snap);
    await manager.start(); // the single drum/grid view: render selector pinned 1
    transport.sent.length = 0;
    manager.resyncVsn1AfterLayoutDeploy();
    // Render selector re-echoed as the grid visual (ch2 cc43 = 1) — pinned.
    expect(transport.sent).toContainEqual([0xb0 | VIEW_MODE_CH, VIEW_MODE_CC, 1]);
    // Full feedback frame repainted (page index + slot 1 active).
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 0]);
    expect(transport.sent).toContainEqual([0x90 | FB_ACTIVE_CH, 32, 127]);
    // The WELCOME hello (ch2 cc41 = 1) must NOT ride along — a re-flash is not a
    // fresh device connect (item 1: the logo only shows on connect / panel load).
    expect(transport.sent).not.toContainEqual([
      0xb0 | WELCOME_CH, WELCOME_CC, WELCOME_VALUE,
    ]);
  });
});

// The DRUM-always any-key contract (item 3b) — a TOGGLE key fires on the first
// press, pressing a DIFFERENT slot fires that slot, and sb_0 is the MODE button
// (no view change) — lives in the VSN1 selected-slot runtime home
// (vsn1_intensity → scenarios/vsn1_runtime): the "VSN1 drum-always slot key" and
// "VSN1 small buttons" blocks. The select-cue that rides each press is proven in
// the "VSN1 select cue" block above. Only the feedback/page/resync contracts
// stay in this file.

// ── Item 1: the WELCOME logo only on connect — NEVER on a page change ────────
// The device shows the wordmark only on the host's one-shot hello (armed on a
// genuine (re)connect / effects-panel load). A page change (device side button →
// pageCc 40) must NOT emit the hello, so the logo never flashes on a page swap.

describe('manager — welcome hello only on connect, not on page change (item 1)', () => {
  it('a device page CC forces a full re-sync but sends NO welcome hello', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, effectsPage: 0 };
    const { manager, transport } = setup(() => snap);
    await manager.start();
    // Consume the connect welcome (start() paints it once); clear the buffer.
    transport.sent.length = 0;
    // Physical side button → page 1.
    transport.emit([0xb1, 40, 1]);
    await drain();
    snap = { ...baseSnap, effectsPage: 1 };
    manager.onEngineUpdate();
    // The page frame repaints (new page index) but the hello never rides along.
    expect(transport.sent).toContainEqual([0xb0 | FB_PAGE_CH, 40, 1]);
    expect(transport.sent).not.toContainEqual([
      0xb0 | WELCOME_CH, WELCOME_CC, WELCOME_VALUE,
    ]);
  });
});

// ── isDeviceHello (pure device→host readiness ping) ─────────────────────────
describe('isDeviceHello (pure)', () => {
  it('accepts a CC on DEVICE_HELLO_CC with value >= 1 on ANY channel', () => {
    for (let ch = 0; ch < 4; ch += 1) {
      expect(isDeviceHello(0xb0 | ch, DEVICE_HELLO_CC, 1)).toBe(true);
      expect(isDeviceHello(0xb0 | ch, DEVICE_HELLO_CC, 127)).toBe(true);
    }
  });
  it('rejects value 0, a different CC, and a note', () => {
    expect(isDeviceHello(0xb0, DEVICE_HELLO_CC, 0)).toBe(false); // value 0
    expect(isDeviceHello(0xb0, 40, 1)).toBe(false);              // page CC, not hello
    expect(isDeviceHello(0x90, DEVICE_HELLO_CC, 1)).toBe(false); // note 41 = sb_0
  });
});

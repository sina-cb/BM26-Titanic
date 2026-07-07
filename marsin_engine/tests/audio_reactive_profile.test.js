// Unit tests for the AUDIO_REACTIVE autopilot profile (E2).
//
// These exercise the profile's pure/near-pure logic against a FAKE ctx (a stub
// paramCenter + spy hooks), with no engine boot:
//   - attach arms bpmSpeedSync + window; detach restores them read-modify-style.
//   - a switchPattern pulse (level-triggered) requests an advance, re-guarded by
//     minInterval, and SUPPRESSED under silence / non-party.
//   - ENERGY ARC: the speed ceiling sags on a sustained calm, recovers on a rise.
//   - ENERGY PICKUP: a fast rise after a calm dip requests an advance (gated).
//   - COLOUR on a STABLE descriptor change held past the dwell — a bare pulse
//     does NOT recolour.
//   - pick bias: loud → shuffle, slow zone → group-locality.
//
// Run:  cd marsin_engine && node --test tests/audio_reactive_profile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioReactiveProfile } from '../lib/autopilot_profiles/audio_reactive_profile.js';

// ── Fake CPC + ctx ─────────────────────────────────────────────────────────
function fakeParamCenter(initial = {}) {
  const store = { ...initial };
  const subs = [];
  return {
    store,
    subs,
    get(key) {
      if (!(key in store)) throw new Error(`unknown key ${key}`);
      return store[key];
    },
    set(key, value) { store[key] = value; },
    subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    // Helper for tests: mutate a key and fire a change event carrying it.
    fire(key, value) {
      store[key] = value;
      const params = {};
      for (const k in store) params[k] = { value: store[k] };
      const ev = { changedKeys: [key], state: { params } };
      for (const fn of subs) fn(ev);
    },
  };
}

function fakeCtx(pc, palettes = []) {
  const calls = { advances: 0, palettesApplied: [] };
  return {
    ctx: {
      paramCenter: pc,
      requestAdvance: () => { calls.advances++; },
      state: () => ({}),
      applyColorPalette: (id) => { calls.palettesApplied.push(id); },
      colorPalettes: () => palettes,
    },
    calls,
  };
}

// ── attach / detach: bpmSpeedSync read-modify-restore ──────────────────────
test('attach arms bpmSpeedSync + window; detach restores prior values', () => {
  const pc = fakeParamCenter({ bpmSpeedSync: 0, bpmSpeedMin: 33, bpmSpeedMax: 77 });
  const { ctx } = fakeCtx(pc);
  const p = new AudioReactiveProfile();

  p.attach(ctx);
  assert.equal(pc.store.bpmSpeedSync, 1, 'attach should enable bpmSpeedSync');
  assert.equal(pc.store.bpmSpeedMin, 60);
  assert.equal(pc.store.bpmSpeedMax, 160);
  assert.equal(pc.subs.length, 1, 'attach should subscribe to the CPC');

  p.detach();
  assert.equal(pc.store.bpmSpeedSync, 0, 'detach should restore bpmSpeedSync');
  assert.equal(pc.store.bpmSpeedMin, 33, 'detach should restore bpmSpeedMin');
  assert.equal(pc.store.bpmSpeedMax, 77, 'detach should restore bpmSpeedMax');
  assert.equal(pc.subs.length, 0, 'detach should unsubscribe');
});

// ── nextDelayMs is null (event-driven, no host timer) ──────────────────────
test('nextDelayMs is null (event-driven)', () => {
  assert.equal(new AudioReactiveProfile().nextDelayMs({ delay_s: 10 }), null);
});

// ── switchPattern pulse requests an advance (level-triggered) ──────────────
test('a switchPattern pulse requests an advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSwitchPattern: 0, audioSilence: 0, audioParty: 1,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  // Force the re-guard window open (attach set _lastAdvanceMs = now).
  p._lastAdvanceMs = Date.now() - 999999;

  pc.fire('audioSwitchPattern', 1);
  assert.equal(calls.advances, 1, 'a >0 switchPattern should advance');
  p.detach();
});

// ── minInterval re-guard blocks a too-soon second advance ──────────────────
test('minInterval re-guard blocks a too-soon second advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSwitchPattern: 0, audioSilence: 0, audioParty: 1,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  p._lastAdvanceMs = Date.now() - 999999;

  pc.fire('audioSwitchPattern', 1);   // advances, resets _lastAdvanceMs = now
  pc.fire('audioSwitchPattern', 1);   // within minIntervalMs → blocked
  assert.equal(calls.advances, 1, 'second pulse inside minInterval must be blocked');
  p.detach();
});

// ── silence / non-party suppress the advance ───────────────────────────────
test('silence suppresses the advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSwitchPattern: 0, audioSilence: 1, audioParty: 1,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  p._lastAdvanceMs = Date.now() - 999999;
  pc.fire('audioSwitchPattern', 1);
  assert.equal(calls.advances, 0, 'silence must suppress advances');
  p.detach();
});

test('non-party suppresses the advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSwitchPattern: 0, audioSilence: 0, audioParty: 0.2,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  p._lastAdvanceMs = Date.now() - 999999;
  pc.fire('audioSwitchPattern', 1);
  assert.equal(calls.advances, 0, 'audioParty<0.5 must suppress advances');
  p.detach();
});

// ── maxDwell safety advance forces a pick after the dwell window (via _tick) ─
test('maxDwell safety advances once the dwell window elapses', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.4,
  });
  const { ctx, calls } = fakeCtx(pc);
  // Tiny maxDwell so the test doesn't wait 5 minutes.
  const p = new AudioReactiveProfile({ maxDwellS: 0.05 });
  p.attach(ctx);
  // Not yet elapsed → no advance.
  p._tick();
  assert.equal(calls.advances, 0, 'tick should not force-advance before maxDwell');
  // Backdate the last advance past the dwell window → safety fires.
  p._lastAdvanceMs = Date.now() - 100;
  p._tick();
  assert.equal(calls.advances, 1, 'tick should advance after maxDwell elapses');
  p.detach();
});

test('maxDwell safety is suppressed during silence', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 1, audioParty: 1, audioEnergyRatio: 0.4,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ maxDwellS: 0.05 });
  p.attach(ctx);
  p._lastAdvanceMs = Date.now() - 100;
  p._tick();
  assert.equal(calls.advances, 0, 'never force-advance into silence');
  p.detach();
});

// ── COLOUR on a STABLE descriptor change (not a bare transient) ─────────────
// Full envelope keys so the descriptor computes. Note: colour is NO LONGER
// applied on a raw switchColor pulse — it must be a settled, held descriptor.
function colorCtx(noteHue = 0.33, palettes = [
  { id: 'cold', c1: 0.60 }, { id: 'warm', c1: 0.05 }, { id: 'mid', c1: 0.35 },
]) {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1,
    audioEnergyRatio: 0.4, audioSlowZone: 0.1, audioStructure: 1, audioNote: 4,
    audioSwitchColor: 0, audioNoteHue: noteHue,
  });
  return { ...fakeCtx(pc, palettes), pc };
}

test('a bare switchColor transient does NOT recolour (must hold)', () => {
  const { ctx, calls, pc } = colorCtx();
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  // Seed the envelope with a couple of ticks so a descriptor exists.
  p._tick(); p._tick();
  // A raw switchColor pulse with no sustained descriptor change → no recolour.
  pc.fire('audioSwitchColor', 1);
  assert.deepEqual(calls.palettesApplied, [], 'a raw pulse must not recolour');
  p.detach();
});

test('a descriptor change held past the dwell DOES recolour to nearest palette', () => {
  const { ctx, calls, pc } = colorCtx(0.33);
  // Small hold so the test is fast; keep minInterval below hold.
  const p = new AudioReactiveProfile({ colorHoldMs: 30, colorMinIntervalMs: 10 });
  p.attach(ctx);
  p._tick();   // seeds envelope + descriptor baseline (no colour yet)
  // Change the SLOW situation: push energy high so energySlow rises into a new
  // band, and hold it across several ticks past colorHoldMs.
  pc.store.audioEnergyRatio = 0.95;
  const start = Date.now();
  // Drive ticks until the hold elapses (busy-wait a tiny bit of wall time).
  while (Date.now() - start < 45) { p._tick(); }
  assert.deepEqual(calls.palettesApplied, ['mid'],
    'a held descriptor change should recolour to nearest c1 (0.33→mid 0.35)');
  p.detach();
});

test('descriptor-driven colour uses circular hue distance (wrap)', () => {
  const palettes = [{ id: 'a', c1: 0.02 }, { id: 'b', c1: 0.5 }];
  const { ctx, calls } = colorCtx(0.98, palettes);  // 0.98 wraps near 0.02
  const p = new AudioReactiveProfile({ colorHoldMs: 30, colorMinIntervalMs: 10 });
  p.attach(ctx);
  p._tick();
  p._ctx.paramCenter.store.audioEnergyRatio = 0.95;
  const start = Date.now();
  while (Date.now() - start < 45) { p._tick(); }
  assert.deepEqual(calls.palettesApplied, ['a'], 'hue 0.98 is closest to c1 0.02 (wrap)');
  p.detach();
});

// ── ENERGY ARC: pattern speed ceiling sags on decline, recovers on rise ─────
test('speed ceiling SAGS as energy declines and RECOVERS as it rises', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.9,
  });
  const { ctx } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ energyFastTau: 0.1, speedArcRatePerS: 100 });
  p.attach(ctx);
  // High energy for a while → ceiling near the armed max (160).
  const t0 = Date.now();
  while (Date.now() - t0 < 60) p._tick();
  const ceilHigh = pc.store.bpmSpeedMax;
  // Now a sustained calm → ceiling should SAG toward the floor (80).
  pc.store.audioEnergyRatio = 0.05;
  const t1 = Date.now();
  while (Date.now() - t1 < 80) p._tick();
  const ceilLow = pc.store.bpmSpeedMax;
  assert.ok(ceilLow < ceilHigh - 10,
    `ceiling should sag on a calm (high=${ceilHigh} low=${ceilLow})`);
  // Recovery: energy stably back up → ceiling climbs again.
  pc.store.audioEnergyRatio = 0.95;
  const t2 = Date.now();
  while (Date.now() - t2 < 80) p._tick();
  const ceilBack = pc.store.bpmSpeedMax;
  assert.ok(ceilBack > ceilLow + 10,
    `ceiling should recover on a rise (low=${ceilLow} back=${ceilBack})`);
  p.detach();
});

// ── ENERGY PICKUP: a fast rise after a calm dip requests an advance ─────────
test('a fast energy pickup after a calm dip requests an advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  // Fast envelope + generous minInterval override so the pickup can fire.
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 0 });
  p.attach(ctx);
  // Hold a calm to ARM the pickup (energyFast dips below pickupArmBelow).
  const t0 = Date.now();
  while (Date.now() - t0 < 40) p._tick();
  const armedAdvances = calls.advances;
  // Sudden jump to high energy → fast positive slope → pickup advance.
  pc.store.audioEnergyRatio = 0.95;
  p._tick();
  assert.ok(calls.advances > armedAdvances,
    `a pickup after a calm should advance (was ${armedAdvances}, now ${calls.advances})`);
  p.detach();
});

test('energy pickup still honours minIntervalMs (no double-fire with a pulse)', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  // Real minInterval; after a pickup advance, an immediate pulse must be blocked.
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 6000 });
  p.attach(ctx);
  const t0 = Date.now();
  while (Date.now() - t0 < 40) p._tick();   // arm
  pc.store.audioEnergyRatio = 0.95;
  p._tick();                                 // pickup advance (1)
  const afterPickup = calls.advances;
  pc.fire('audioSwitchPattern', 1);          // immediate pulse → blocked by guard
  assert.equal(calls.advances, afterPickup,
    'a pulse inside minInterval after a pickup must not double-fire');
  p.detach();
});

// ── pick bias: loud → shuffle, slow → group-locality ───────────────────────
function pl(n) {
  const entries = [];
  for (let i = 1; i <= n; i++) entries.push({ id: `e${i}`, pattern: `p${i}` });
  return { name: 'pl', entries };
}

test('pick bias: high energy forces shuffle (picks a non-current entry)', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioEnergyRatio: 0.9, audioSlowZone: 0,
  });
  const { ctx } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  // Sequential base autopilot; energy bias flips it to shuffle. Over many picks
  // from a 6-entry list a shuffle must eventually pick something != e2 (the
  // sequential successor of e1), proving the bias applied.
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const e = p.pickNextEntry(pl(6), { active: true, shuffle: false }, 'e1', {});
    if (e) seen.add(e.id);
  }
  assert.ok(seen.size > 1, 'shuffle bias should visit more than one target from e1');
  p.detach();
});

test('pick bias: slow zone forces group-locality mode', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioEnergyRatio: 0, audioSlowZone: 0.9,
  });
  const { ctx } = fakeCtx(pc);
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  // With group-locality armed on a large list, picks stay within a small window.
  const gr = {};
  const picks = [];
  let cur = 'e1';
  for (let i = 0; i < 12; i++) {
    const e = p.pickNextEntry(pl(20), { active: true, groupSize: 3, groupDwell: 6 }, cur, gr);
    if (!e) break;
    picks.push(e.id); cur = e.id;
  }
  const uniq = new Set(picks);
  assert.ok(uniq.size <= 6, `group-locality should dwell in a small window, saw ${uniq.size} unique`);
  p.detach();
});

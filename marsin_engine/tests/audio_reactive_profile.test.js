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

function fakeCtx(pc, palettes = [], stateObj = {}) {
  // `speedScale` captures the multiplicative energy scale the profile layers on
  // the bpm-sync mapping (the F1-fix replacement for the old ceiling sag). The
  // fake also derives the FINAL speed the way the live BpmSpeedSync would, so a
  // test can assert on `speed` DIRECTION (not the internal scale): with the
  // profile's armed window [60,160] and a fixed tempo, speed = base * scale.
  const calls = { advances: 0, palettesApplied: [], speedScale: 1, speedScaleHistory: [] };
  return {
    ctx: {
      paramCenter: pc,
      requestAdvance: () => { calls.advances++; },
      state: () => stateObj,
      applyColorPalette: (id) => { calls.palettesApplied.push(id); },
      colorPalettes: () => palettes,
      setSpeedScale: (s) => { calls.speedScale = s; calls.speedScaleHistory.push(s); return true; },
    },
    calls,
  };
}

// Drive N profile ticks across a synthetic elapsed window so time-based logic
// (envelope τ, confirmation/hold windows) advances deterministically without
// wall-clock busy-waits. Backdates the profile's internal clocks by `stepMs`
// each tick and stubs Date.now() so `now`-based gates see the same timeline.
function driveTicks(p, n, stepMs) {
  const realNow = Date.now;
  let clock = realNow();
  try {
    global.Date.now = () => clock;
    // Anchor the profile's per-tick clock to the synthetic timeline so the
    // FIRST tick has a well-defined dt (== stepMs), not a real-wall-time jump.
    p._lastTickMs = clock;
    for (let i = 0; i < n; i++) {
      clock += stepMs;
      p._tick();
    }
  } finally {
    global.Date.now = realNow;
  }
  return clock;
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
  // Fast envelope + tiny hold so a synthetic-clock drive settles the band and
  // the hold quickly; keep minInterval below the hold.
  const p = new AudioReactiveProfile({ energySlowTau: 0.05, colorHoldMs: 30, colorMinIntervalMs: 10 });
  p.attach(ctx);
  driveTicks(p, 3, 60);   // seeds envelope + SEEDS the descriptor (no colour yet)
  assert.deepEqual(calls.palettesApplied, [], 'arming/seed must not recolour (F3)');
  // Change the SLOW situation: push energy high so energySlow rises into a new
  // band, and hold it across several ticks past colorHoldMs.
  pc.store.audioEnergyRatio = 0.95;
  driveTicks(p, 6, 40);
  assert.deepEqual(calls.palettesApplied, ['mid'],
    'a held descriptor change should recolour to nearest c1 (0.33→mid 0.35)');
  p.detach();
});

test('descriptor-driven colour uses circular hue distance (wrap)', () => {
  const palettes = [{ id: 'a', c1: 0.02 }, { id: 'b', c1: 0.5 }];
  const { ctx, calls } = colorCtx(0.98, palettes);  // 0.98 wraps near 0.02
  const p = new AudioReactiveProfile({ energySlowTau: 0.05, colorHoldMs: 30, colorMinIntervalMs: 10 });
  p.attach(ctx);
  driveTicks(p, 3, 60);   // seed
  p._ctx.paramCenter.store.audioEnergyRatio = 0.95;
  driveTicks(p, 6, 40);
  assert.deepEqual(calls.palettesApplied, ['a'], 'hue 0.98 is closest to c1 0.02 (wrap)');
  p.detach();
});

// ── ENERGY ARC (F1 fix): speed goes DOWN on a calm, UP on a rise ────────────
// Asserts on the SPEED SCALE the profile hands to bpm-sync (the multiplicative
// factor that layers on the tempo mapping) — NOT the window ceiling. A lower
// scale means a lower final `speed` at a fixed tempo → calm makes patterns run
// SLOWER (the operator's intent), reversing the pre-fix inversion.
test('F1: energy→speed-scale goes DOWN on a sustained calm, UP on a rise', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.9,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ energySlowTau: 0.1, speedArcRatePerS: 100 });
  p.attach(ctx);
  // High energy for a while → scale near 1 (no attenuation, full tempo speed).
  driveTicks(p, 8, 60);
  const scaleHigh = calls.speedScale;
  // Sustained calm → scale should SAG toward the floor → SLOWER.
  pc.store.audioEnergyRatio = 0.05;
  driveTicks(p, 10, 80);
  const scaleLow = calls.speedScale;
  assert.ok(scaleLow < scaleHigh - 0.1,
    `calm must LOWER the speed scale, i.e. slow down (high=${scaleHigh} low=${scaleLow})`);
  // Recovery: energy stably back up → scale climbs → FASTER.
  pc.store.audioEnergyRatio = 0.95;
  driveTicks(p, 10, 80);
  const scaleBack = calls.speedScale;
  assert.ok(scaleBack > scaleLow + 0.1,
    `a stable rise must RAISE the speed scale, i.e. speed up (low=${scaleLow} back=${scaleBack})`);
  p.detach();
});

// End-to-end direction via a REAL BpmSpeedSync: prove the scale actually makes
// the final `speed` value DECREASE on a calm at a fixed tempo (guards against a
// future scale-sign regression at the integration boundary the unit ctx fakes).
test('F1 e2e: with a real BpmSpeedSync, a calm LOWERS the mapped speed', async () => {
  const { BpmSpeedSync } = await import('../lib/bpm_speed_sync.js');
  // Minimal CPC stub the sync needs: subscribe + set + getCanonicalState.
  const store = { bpmSpeedSync: { value: 1 }, bpmSpeedMin: { value: 60 }, bpmSpeedMax: { value: 160 }, speed: { value: 0.5 } };
  const pcSync = {
    subscribe() { return () => {}; },
    set(k, v) { store[k] = { value: v }; },
    getCanonicalState() { return { params: store }; },
  };
  const sync = new BpmSpeedSync(pcSync, { getTempoBpm: () => 128 });
  sync.attach();
  sync.setSpeedScale(1); sync.recompute();
  const speedFull = store.speed.value;   // 128 in [60,160] = 0.68 * 1
  sync.setSpeedScale(0.35); sync.recompute();
  const speedCalm = store.speed.value;   // 0.68 * 0.35
  assert.ok(speedCalm < speedFull,
    `a lower scale must LOWER the final speed (full=${speedFull} calm=${speedCalm})`);
});

// ── ENERGY PICKUP: a SUSTAINED rise after a calm dip requests an advance ─────
// The pickup now requires the rise to HOLD past switchConfirmMs — the core
// art-car rejection. This test holds high energy across the confirm window.
test('a SUSTAINED energy pickup after a calm dip requests an advance', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 0, switchConfirmMs: 300 });
  p.attach(ctx);
  driveTicks(p, 8, 60);   // hold a calm → ARM the pickup
  const armedAdvances = calls.advances;
  // Sudden jump to high energy, then HOLD it past switchConfirmMs.
  pc.store.audioEnergyRatio = 0.95;
  driveTicks(p, 8, 100);  // 800ms > 300ms confirm, energy stays high the whole time
  assert.ok(calls.advances > armedAdvances,
    `a sustained pickup should advance (was ${armedAdvances}, now ${calls.advances})`);
  p.detach();
});

// ART-CAR REJECTION at the unit level: a rise that FADES inside the confirm
// window must NOT switch (a passing car's swell).
test('art-car: a swell that fades inside the confirm window does NOT switch', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 0, switchConfirmMs: 800 });
  p.attach(ctx);
  driveTicks(p, 8, 60);   // arm on a calm
  const before = calls.advances;
  // Swell up briefly, then fade back down BEFORE the 800ms confirm elapses.
  pc.store.audioEnergyRatio = 0.95;
  driveTicks(p, 3, 100);  // 300ms elevated (< 800ms confirm)
  pc.store.audioEnergyRatio = 0.08;
  driveTicks(p, 6, 100);  // faded back to calm
  assert.equal(calls.advances, before,
    'a swell that fades inside the confirm window must NOT switch (art-car rejection)');
  p.detach();
});

// F6: a raw drop pulse during a sustained calm with NO positive slope must not
// switch — the drop confirms a rise, it is not a trigger on its own.
test('F6: a bare drop pulse during a flat calm does NOT switch', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 0, switchConfirmMs: 300 });
  p.attach(ctx);
  driveTicks(p, 8, 60);   // arm on a flat calm
  const before = calls.advances;
  pc.store.audioDropPulse = 1;   // a drop, but energy stays flat/low (no rise)
  driveTicks(p, 6, 100);
  assert.equal(calls.advances, before,
    'a drop pulse with no positive energy slope must not switch (F6)');
  p.detach();
});

// F2: a PAUSED autopilot must not couple audio to speed / colour / advance.
test('F2: a paused autopilot does not advance, recolour, or drive speed', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.9, audioDropPulse: 1,
    audioSlowZone: 0.1, audioStructure: 1, audioNote: 4, audioNoteHue: 0.33,
    audioSwitchPattern: 0,
  }, );
  // state().active === false → paused.
  const { ctx, calls } = fakeCtx(pc, [{ id: 'mid', c1: 0.35 }], { active: false });
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, energySlowTau: 0.05, minIntervalMs: 0, switchConfirmMs: 100, colorHoldMs: 30, colorMinIntervalMs: 10 });
  p.attach(ctx);
  const scaleAtArm = calls.speedScale;   // attach applies scale 1 once
  // Drive lots of ticks with hot audio + a switchPattern pulse: nothing should fire.
  driveTicks(p, 20, 100);
  pc.fire('audioSwitchPattern', 1);
  assert.equal(calls.advances, 0, 'paused → no advance');
  assert.deepEqual(calls.palettesApplied, [], 'paused → no recolour');
  assert.equal(calls.speedScale, scaleAtArm, 'paused → speed scale unchanged (no arc)');
  p.detach();
});

test('energy pickup still honours minIntervalMs (no double-fire with a pulse)', () => {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioSilence: 0, audioParty: 1, audioEnergyRatio: 0.1, audioDropPulse: 0,
  });
  const { ctx, calls } = fakeCtx(pc);
  // Real minInterval; after a pickup advance, an immediate pulse must be blocked.
  const p = new AudioReactiveProfile({ energyFastTau: 0.05, minIntervalMs: 12000, switchConfirmMs: 300 });
  p.attach(ctx);
  p._lastAdvanceMs = Date.now() - 999999;   // clear the guard so the FIRST advance is allowed
  driveTicks(p, 8, 60);   // arm
  pc.store.audioEnergyRatio = 0.95;
  driveTicks(p, 8, 100);  // sustained pickup → advance (1), which re-sets _lastAdvanceMs
  const afterPickup = calls.advances;
  assert.ok(afterPickup >= 1, 'sanity: the sustained pickup advanced once');
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

// ── ART-CAR ROBUSTNESS + energy-arc discrimination (BM tuning, 2026-07-06) ───
// The shared driveTicks re-anchors its clock per call, so it can't span phases.
// This monotonic-clock driver runs MULTI-PHASE scenarios on one timeline.
// Phases: { e:energyRatio, s:seconds, note?, hue? }.
function runPhases(p, pc, phases) {
  const realNow = Date.now;
  let clock = 5_000_000;
  try {
    global.Date.now = () => clock;
    p._lastTickMs = clock; p._lastAdvanceMs = clock; p._lastColorMs = clock;
    for (const ph of phases) {
      if (typeof ph.e === 'number') pc.store.audioEnergyRatio = ph.e;
      if (typeof ph.note === 'number') pc.store.audioNote = ph.note;
      if (typeof ph.hue === 'number') pc.store.audioNoteHue = ph.hue;
      const steps = Math.round(ph.s / 0.25);
      for (let i = 0; i < steps; i++) { clock += 250; p._tick(); }
    }
  } finally { global.Date.now = realNow; }
}

const PALETTES = [
  { id: 'sunset_coral', c1: 0.03 }, { id: 'gold', c1: 0.13 },
  { id: 'ocean', c1: 0.55 }, { id: 'violet', c1: 0.78 },
];

function armedProfile(extra = {}) {
  const pc = fakeParamCenter({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 160,
    audioEnergyRatio: 0.05, audioSilence: 0, audioParty: 1,
    audioSlowZone: 0.1, audioNote: 4, audioNoteHue: 0.5, ...extra,
  });
  const { ctx, calls } = fakeCtx(pc, PALETTES, { active: true });
  const p = new AudioReactiveProfile();
  p.attach(ctx);
  clearInterval(p._tickTimer); p._tickTimer = null;   // drive _tick manually
  return { p, pc, calls };
}

test('energy arc: a sustained calm SAGS the speed scale below a sustained loud (calm → slower)', () => {
  const { p, pc, calls } = armedProfile();
  runPhases(p, pc, [{ e: 0.95, s: 30 }]);
  const hot = calls.speedScale;
  runPhases(p, pc, [{ e: 0.05, s: 60 }]);
  const calm = calls.speedScale;
  assert.ok(calm < hot - 0.2, `calm scale (${calm.toFixed(3)}) must be well below hot (${hot.toFixed(3)})`);
  p.detach();
});

test('sustained build (our music holding elevated) advances the pattern', () => {
  const { p, pc, calls } = armedProfile();
  runPhases(p, pc, [{ e: 0.05, s: 20 }, { e: 0.92, s: 22 }]);   // >15s confirm
  assert.equal(calls.advances, 1, 'a sustained elevation should switch once');
  p.detach();
});

test('ART-CAR flyby: a brief loud swell (shorter than switchConfirmMs) does NOT switch', () => {
  const { p, pc, calls } = armedProfile();
  // calm → 8s loud (< 15s confirm) with a FOREIGN note/hue for the pass → calm.
  runPhases(p, pc, [{ e: 0.05, s: 20 }, { e: 0.92, s: 8, note: 9, hue: 0.03 }, { e: 0.05, s: 12, note: 4, hue: 0.5 }]);
  assert.equal(calls.advances, 0, 'a passing car (brief swell) must NOT switch the pattern');
  assert.equal(calls.palettesApplied.length, 0, 'a passing car (transient note/energy) must NOT recolor');
  p.detach();
});

test('sustained MOOD shift (energy band held) recolors, picking the nearest-hue palette', () => {
  const { p, pc, calls } = armedProfile({ audioEnergyRatio: 0.1 });
  runPhases(p, pc, [{ e: 0.1, s: 20 }, { e: 0.9, s: 45, hue: 0.55 }]);
  assert.ok(calls.palettesApplied.length >= 1, 'a sustained mood shift should recolor');
  assert.equal(calls.palettesApplied.at(-1), 'ocean', 'recolor should pick the palette nearest audioNoteHue');
  p.detach();
});

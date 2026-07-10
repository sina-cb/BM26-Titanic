// Pure decision logic for the APC operator-re-layout buttons (2026-07):
//   - combined pattern+color autopilot direction (any-on → both-on; both-on → both-off)
//   - master fade direction (not-black → to black; already black → up)
//   - the clip_stop exemption from the activity-based pattern-autopilot auto-disable

import { describe, it, expect, vi } from 'vitest';
import {
  combinedAutopilotTarget,
  combinedAutopilotLedOn,
  colorAutopilotWritable,
  masterFadeTarget,
  MASTER_BLACK_EPSILON,
  createAutopilotToggleExemption,
} from './apc_button_logic';

describe('combinedAutopilotTarget (APC clip_stop) — colour writable', () => {
  it('both OFF → turn both ON', () => {
    expect(combinedAutopilotTarget(false, false)).toBe(true);
  });

  it('only pattern ON (at least one on) → turn both ON', () => {
    expect(combinedAutopilotTarget(true, false)).toBe(true);
  });

  it('only color ON (at least one on) → turn both ON', () => {
    expect(combinedAutopilotTarget(false, true)).toBe(true);
  });

  it('both ON → turn both OFF', () => {
    expect(combinedAutopilotTarget(true, true)).toBe(false);
  });

  it('defaults colorToggleable to true (unchanged legacy 2-arg contract)', () => {
    expect(combinedAutopilotTarget(true, true)).toBe(false);
    expect(combinedAutopilotTarget(false, false)).toBe(true);
  });
});

describe('combinedAutopilotTarget — colour NOT writable (no palettes) → pure pattern toggle', () => {
  // With the colour autopilot unwritable it can never be on, so the press is a
  // PLAIN pattern toggle and the colour arg is IRRELEVANT to the direction.
  it('pattern OFF → ON (colour arg ignored)', () => {
    expect(combinedAutopilotTarget(false, false, false)).toBe(true);
    expect(combinedAutopilotTarget(false, true, false)).toBe(true);
  });
  it('pattern ON → OFF (colour arg ignored)', () => {
    expect(combinedAutopilotTarget(true, false, false)).toBe(false);
    expect(combinedAutopilotTarget(true, true, false)).toBe(false);
  });
});

describe('colorAutopilotWritable', () => {
  it('non-empty palette array → writable', () => {
    expect(colorAutopilotWritable(['a'])).toBe(true);
    expect(colorAutopilotWritable(['a', 'b'])).toBe(true);
  });
  it('empty array → NOT writable (engine 400s an empty-palette write)', () => {
    expect(colorAutopilotWritable([])).toBe(false);
  });
  it('undefined / non-array → NOT writable (never fabricate a set)', () => {
    expect(colorAutopilotWritable(undefined)).toBe(false);
    expect(colorAutopilotWritable(null)).toBe(false);
    expect(colorAutopilotWritable('a')).toBe(false);
    expect(colorAutopilotWritable(3)).toBe(false);
  });
});

describe('combinedAutopilotLedOn (APC clip_stop LED)', () => {
  it('colour writable: lit ONLY when BOTH autopilots on', () => {
    expect(combinedAutopilotLedOn(true, true, true)).toBe(true);
    expect(combinedAutopilotLedOn(true, false, true)).toBe(false);
    expect(combinedAutopilotLedOn(false, true, true)).toBe(false);
    expect(combinedAutopilotLedOn(false, false, true)).toBe(false);
  });
  it('colour NOT writable: lit tracks the PATTERN autopilot alone', () => {
    expect(combinedAutopilotLedOn(true, false, false)).toBe(true);
    expect(combinedAutopilotLedOn(false, false, false)).toBe(false);
    // colour "on" is impossible when unwritable, but even if a stale flag says so
    // the LED must not require it.
    expect(combinedAutopilotLedOn(true, true, false)).toBe(true);
  });
  it('defaults colorToggleable to true (both-on rule)', () => {
    expect(combinedAutopilotLedOn(true, true)).toBe(true);
    expect(combinedAutopilotLedOn(true, false)).toBe(false);
  });
});

describe('masterFadeTarget (APC stop_all_clips)', () => {
  it('master up (1) → fade TO BLACK (0)', () => {
    expect(masterFadeTarget(1)).toBe(0);
  });

  it('master mid (0.5) is NOT black → fade TO BLACK (0)', () => {
    expect(masterFadeTarget(0.5)).toBe(0);
  });

  it('master exactly 0 (black) → fade UP (1)', () => {
    expect(masterFadeTarget(0)).toBe(1);
  });

  it('master within the black epsilon counts as black → fade UP (1)', () => {
    expect(masterFadeTarget(MASTER_BLACK_EPSILON)).toBe(1);
    expect(masterFadeTarget(MASTER_BLACK_EPSILON / 2)).toBe(1);
  });

  it('master just ABOVE the black epsilon is not black → fade TO BLACK (0)', () => {
    expect(masterFadeTarget(MASTER_BLACK_EPSILON + 0.001)).toBe(0);
  });
});

describe('createAutopilotToggleExemption (clip_stop vs activity auto-disable)', () => {
  it('with NO claim, the pattern-autopilot auto-disable RUNS', () => {
    const ex = createAutopilotToggleExemption();
    // A normal fader/other MIDI never claims → the disable proceeds.
    expect(ex.shouldRunPatternDisable()).toBe(true);
  });

  it('a claim (clip_stop press) SKIPS the pattern disable exactly once', () => {
    const ex = createAutopilotToggleExemption();
    ex.claim();
    expect(ex.shouldRunPatternDisable()).toBe(false); // this window: skipped
    // The claim is one-shot — the NEXT activity is not exempt.
    expect(ex.shouldRunPatternDisable()).toBe(true);
  });

  it('is one claim per window: a second claim re-arms the skip', () => {
    const ex = createAutopilotToggleExemption();
    ex.claim();
    expect(ex.shouldRunPatternDisable()).toBe(false);
    expect(ex.shouldRunPatternDisable()).toBe(true);
    ex.claim();
    expect(ex.shouldRunPatternDisable()).toBe(false);
  });
});

// End-to-end wiring proof: reconstruct the EXACT two-caller interaction from
// useMidiControl — the activity auto-disable (which only reaches its pattern
// `setAutopilot(false)` after two awaited engine round-trips) racing the
// clip_stop toggle (which CLAIMS synchronously, before its own first await, then
// writes `setAutopilot(true)`). Uses the same exemption factory the hook uses,
// so it locks the behavior the task requires: after a simulated >60s idle, a
// clip_stop press leaves pattern autopilot ON (no `setAutopilot(false)` from the
// auto-disable), while a normal fader after idle still triggers the disable.
describe('clip_stop exemption — end-to-end auto-disable interaction', () => {
  // Minimal models of the two hook fns, sharing ONE exemption (as in the hook).
  // `setAutopilot` is a spy so we can assert the exact writes and their order.
  function harness() {
    const ex = createAutopilotToggleExemption();
    const setAutopilot = vi.fn(async (_v: boolean) => ({ ok: true }));
    // getAutopilot resolves async, modelling the two awaited round-trips before
    // the auto-disable reaches its pattern write.
    const getAutopilot = vi.fn(async () => ({ ok: true, data: { active: true } }));

    // The activity-based auto-disable (pattern side only, as under test).
    async function onMidiActivity(): Promise<void> {
      await getAutopilot();          // round-trip 1 (prior-state capture)
      await getAutopilot();          // round-trip 2 (transitions capture, modelled)
      if (ex.shouldRunPatternDisable()) {
        await setAutopilot(false);
      }
    }

    // The clip_stop combined-autopilot toggle: CLAIM synchronously (prefix),
    // then read + write the intended direction (here: turn ON).
    async function toggleCombinedAutopilot(): Promise<void> {
      ex.claim();                    // synchronous prefix — before any await
      await getAutopilot();          // read current state
      await setAutopilot(true);      // intended direction: pattern autopilot ON
    }

    return { ex, setAutopilot, onMidiActivity, toggleCombinedAutopilot };
  }

  it('clip_stop as the first activity after idle: autopilot stays ON (disable skipped)', async () => {
    const h = harness();
    // onMessage order: activity FIRST (suspends on its first await), THEN the
    // dispatch runs the toggle (its sync claim() lands before any await resolves).
    const activity = h.onMidiActivity();
    const toggle = h.toggleCombinedAutopilot();
    await Promise.all([activity, toggle]);

    // The ONLY setAutopilot write is the toggle's turn-ON; the auto-disable's
    // `setAutopilot(false)` was skipped, so nothing stomps the turn-on.
    expect(h.setAutopilot).toHaveBeenCalledTimes(1);
    expect(h.setAutopilot).toHaveBeenCalledWith(true);
    expect(h.setAutopilot).not.toHaveBeenCalledWith(false);
  });

  it('a normal fader/other MIDI after idle: auto-disable still turns autopilot OFF', async () => {
    const h = harness();
    // No toggle this window (a plain fader) → nothing claims → disable runs.
    await h.onMidiActivity();
    expect(h.setAutopilot).toHaveBeenCalledTimes(1);
    expect(h.setAutopilot).toHaveBeenCalledWith(false);
  });

  it('the exemption is one-shot: a fader AFTER a clip_stop window disables normally', async () => {
    const h = harness();
    // Window 1: clip_stop — disable skipped.
    await Promise.all([h.onMidiActivity(), h.toggleCombinedAutopilot()]);
    h.setAutopilot.mockClear();
    // Window 2: a plain fader — the claim was consumed, so the disable runs.
    await h.onMidiActivity();
    expect(h.setAutopilot).toHaveBeenCalledTimes(1);
    expect(h.setAutopilot).toHaveBeenCalledWith(false);
  });
});

// ── toggleCombinedAutopilot — full read/decide/write orchestration ─────────────
// The ROOT-CAUSE regression lock. This reconstructs the EXACT read/decide/write
// body of useMidiControl.toggleCombinedAutopilot (which lives in a hook module
// that pulls RN/expo-router, so it can't be imported in this node suite — the
// same reason the exemption end-to-end test above reconstructs its two callers),
// wiring the REAL pure helpers (combinedAutopilotTarget / colorAutopilotWritable /
// combinedAutopilotLedOn) to a SPIED api that returns the REAL engine response
// SHAPES — crucially including the engine's 400 on an empty-palette colour write
// (color_autopilot.js validate: palettes must be non-empty, for BOTH directions).
//
// THE BUG this locks: out of the box the deck has no colour palettes configured,
// so the OLD handler's unconditional `setDeckColorAutopilot({ active })` ALWAYS
// 400'd — the pattern write had already landed, so the press half-applied and the
// whole toggle returned {ok:false}; and with the colour side unwritable, "both on"
// was unreachable so the both-aware direction could never turn anything OFF. The
// FIX: when colour is unwritable it's a pure pattern toggle (write pattern only,
// skip the guaranteed-400 colour write); when palettes exist, both flip together.
describe('toggleCombinedAutopilot — read/decide/write with a spied api', () => {
  // A faithful model of the hook's toggle body + its LED cache. `palettes` seeds
  // the colour-autopilot config the GET returns; the colour WRITE spy MIRRORS the
  // engine — it 400s whenever the live palette set is empty (the exact invariant
  // that broke the toggle on hardware).
  function harness(init: { patternOn: boolean; colorOn: boolean; palettes: string[] }) {
    let patternActive = init.patternOn;
    let colorActive = init.colorOn;
    const palettes = init.palettes;

    const getAutopilot = vi.fn(async () => ({ ok: true, data: { active: patternActive } }));
    const fetchDeckColorAutopilot = vi.fn(async () => ({
      ok: true,
      data: { active: colorActive, palettes: [...palettes], delay_s: 30, shuffle: false, transitionMs: 0 },
    }));
    const setAutopilot = vi.fn(async (v: boolean) => { patternActive = v; return { ok: true as const }; });
    // Engine-accurate: an empty palette set → 400 (in EITHER direction). A
    // non-empty set → the write lands and flips `active`.
    const setDeckColorAutopilot = vi.fn(async (patch: { active: boolean }) => {
      if (palettes.length === 0) {
        return { ok: false as const, error: 'colorAutopilot.palettes must be a non-empty array of palette ids' };
      }
      colorActive = patch.active;
      return { ok: true as const, data: { active: colorActive, palettes } };
    });

    // Mirror of the hook's module LED cache + _patchCombinedAutopilot.
    let ledOn = combinedAutopilotLedOn(patternActive, colorActive, colorAutopilotWritable(palettes));

    // The REAL body of useMidiControl.toggleCombinedAutopilot (helpers are the
    // production imports; the writes go to the spies above).
    async function toggleCombinedAutopilot(): Promise<{ ok: boolean; error?: string }> {
      const patternRes = await getAutopilot();
      const colorRes = await fetchDeckColorAutopilot();
      if (!patternRes.ok || !patternRes.data) return { ok: false, error: 'pattern read failed' };
      if (!colorRes.ok || !colorRes.data) return { ok: false, error: 'color read failed' };
      const patternOn = !!patternRes.data.active;
      const colorOn = !!colorRes.data.active;
      const colorToggleable = colorAutopilotWritable(colorRes.data.palettes);
      const next = combinedAutopilotTarget(patternOn, colorOn, colorToggleable);
      const wPattern = await setAutopilot(next);
      if (!wPattern.ok) return { ok: false, error: 'pattern write failed' };
      let patternCacheOn = next;
      let colorCacheOn: boolean;
      if (colorToggleable) {
        const wColor = await setDeckColorAutopilot({ active: next });
        if (!wColor.ok) return { ok: false, error: `color autopilot write failed: ${wColor.error}` };
        colorCacheOn = next;
      } else {
        colorCacheOn = false;
      }
      ledOn = combinedAutopilotLedOn(patternCacheOn, colorCacheOn, colorToggleable);
      return { ok: true };
    }

    return {
      getAutopilot, fetchDeckColorAutopilot, setAutopilot, setDeckColorAutopilot,
      toggleCombinedAutopilot, getLed: () => ledOn,
    };
  }

  // ── Colour CONFIGURED (palettes present) → both flip together ──────────────
  it('both OFF → both ON; LED lights', async () => {
    const h = harness({ patternOn: false, colorOn: false, palettes: ['p1', 'p2'] });
    const r = await h.toggleCombinedAutopilot();
    expect(r.ok).toBe(true);
    expect(h.setAutopilot).toHaveBeenCalledWith(true);
    expect(h.setDeckColorAutopilot).toHaveBeenCalledWith({ active: true });
    expect(h.getLed()).toBe(true); // both on → lit
  });

  it('both ON → both OFF; LED goes dark', async () => {
    const h = harness({ patternOn: true, colorOn: true, palettes: ['p1'] });
    const r = await h.toggleCombinedAutopilot();
    expect(r.ok).toBe(true);
    expect(h.setAutopilot).toHaveBeenCalledWith(false);
    expect(h.setDeckColorAutopilot).toHaveBeenCalledWith({ active: false });
    expect(h.getLed()).toBe(false);
  });

  it('one ON (pattern only) → both ON; LED lights', async () => {
    const h = harness({ patternOn: true, colorOn: false, palettes: ['p1'] });
    const r = await h.toggleCombinedAutopilot();
    expect(r.ok).toBe(true);
    expect(h.setAutopilot).toHaveBeenCalledWith(true);
    expect(h.setDeckColorAutopilot).toHaveBeenCalledWith({ active: true });
    expect(h.getLed()).toBe(true);
  });

  // ── Colour UNCONFIGURED (empty palettes) → pattern-only, NO 400 ────────────
  // The exact hardware failure: the OLD code 400'd here and returned {ok:false},
  // half-applying. Now it must succeed as a pattern-only toggle and NEVER post a
  // colour write.
  it('both OFF, no palettes → pattern ON only, colour write SKIPPED, ok:true, LED tracks pattern', async () => {
    const h = harness({ patternOn: false, colorOn: false, palettes: [] });
    const r = await h.toggleCombinedAutopilot();
    expect(r.ok).toBe(true);                       // no half-apply, no 400 bubbling up
    expect(h.setAutopilot).toHaveBeenCalledWith(true);
    expect(h.setDeckColorAutopilot).not.toHaveBeenCalled(); // skip the guaranteed-400 write
    expect(h.getLed()).toBe(true);                 // pattern on → lit (not stuck dark)
  });

  it('pattern ON, no palettes → pattern OFF only, colour write SKIPPED, LED dark', async () => {
    const h = harness({ patternOn: true, colorOn: false, palettes: [] });
    const r = await h.toggleCombinedAutopilot();
    expect(r.ok).toBe(true);
    expect(h.setAutopilot).toHaveBeenCalledWith(false);
    expect(h.setDeckColorAutopilot).not.toHaveBeenCalled();
    expect(h.getLed()).toBe(false);
  });

  it('REGRESSION: the OLD unconditional colour write would 400 on empty palettes', async () => {
    // Direct proof of the engine invariant the fix routes around: an empty-palette
    // colour write is rejected (in either direction), so an unconditional write is
    // the defect.
    const h = harness({ patternOn: false, colorOn: false, palettes: [] });
    const rejected = await h.setDeckColorAutopilot({ active: true });
    expect(rejected.ok).toBe(false);
    const rejectedOff = await h.setDeckColorAutopilot({ active: false });
    expect(rejectedOff.ok).toBe(false); // even turning OFF 400s with no palettes
  });
});

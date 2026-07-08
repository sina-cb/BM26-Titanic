// Pins the data-driven correspondence between the APC mini mk2 Scene Launch
// column and the CaptainPad GLOBAL EFFECTS UI strip (global-effects parity
// campaign, 2026-07):
//
//   MIDI button read TOP → BOTTOM  ==  UI slot read LEFT-MOST → RIGHT-MOST
//
// The APC Scene Launch buttons are a vertical column of 8, notes 112..119,
// where note 112 = Scene 1 = the PHYSICAL TOP and note 119 = Scene 8 = the
// PHYSICAL BOTTOM (apc_mini_mk2_reference.md). GlobalEffectMacros renders slot
// 1 as the left-most chip and slot 8 as the right-most, so the topmost button
// (112) must bind slot 1, and each step DOWN the column is one step RIGHT in
// the UI — i.e. ascending notes 112..119 bind ascending slots 1..8.
//
// This is loaded from the REAL shipped midi_profiles/apc_mini_mk2.yaml (not a
// synthetic fixture) so a future edit that scrambles the order, drops a slot,
// or re-collides BLACKOUT onto the Scene column fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile, ControlDef } from './profile';
import { projectLeds, MidiProjectionState } from './led_projector';

const apcRaw = yaml.load(
  readFileSync(join(__dirname, '../../midi_profiles/apc_mini_mk2.yaml'), 'utf8'),
);
const apc = validateProfile(apcRaw, 'apc_mini_mk2.yaml');

// The visible UI slot count (GlobalEffectMacros.VISIBLE_SLOT_COUNT). The Scene
// column has exactly 8 physical buttons, so this is both the UI contract and
// the hardware ceiling for this mapping.
const VISIBLE_SLOT_COUNT = 8;

// APC Scene Launch note numbers, ordered PHYSICAL TOP → BOTTOM (112 = top).
const SCENE_NOTES_TOP_TO_BOTTOM = [112, 113, 114, 115, 116, 117, 118, 119];
const TRACK_8_NOTE = 107;

function singleNote(c: ControlDef): number | null {
  return c.match.type === 'note' && c.match.notes.length === 1 ? c.match.notes[0] : null;
}

/** slotId → the single note that dispatches globalEffectSlot for it, per context. */
function slotNoteMap(controls: ControlDef[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of controls) {
    if (c.action.kind !== 'globalEffectSlot') continue;
    const note = singleNote(c);
    expect(note, `globalEffectSlot control '${c.id}' must match a single note`).not.toBeNull();
    m.set(c.action.slot, note as number);
  }
  return m;
}

describe('apc_mini_mk2 global-effect slot ↔ Scene button mapping', () => {
  for (const ctxName of ['deck', 'mixer']) {
    describe(`context '${ctxName}'`, () => {
      const controls = apc.contexts[ctxName];

      it('is defined (deck and mixer share the unified layout)', () => {
        expect(controls, `context '${ctxName}' must exist`).toBeDefined();
      });

      it(`binds exactly ${VISIBLE_SLOT_COUNT} global-effect slots, one per Scene button`, () => {
        const map = slotNoteMap(controls);
        // Every UI slot 1..8 is mapped.
        for (let slot = 1; slot <= VISIBLE_SLOT_COUNT; slot++) {
          expect(map.has(slot), `slot ${slot} must be mapped`).toBe(true);
        }
        // No slot beyond the visible 8 sneaks onto the column.
        expect(map.size).toBe(VISIBLE_SLOT_COUNT);
      });

      it('maps MIDI TOP→BOTTOM to UI slots LEFT→RIGHT (button 112→slot1 … 119→slot8)', () => {
        const map = slotNoteMap(controls);
        // Walking the physical column top→bottom must walk the UI slots 1..8
        // left→right in lockstep: the i-th button from the top drives slot i+1.
        SCENE_NOTES_TOP_TO_BOTTOM.forEach((note, i) => {
          const slot = i + 1;
          expect(map.get(slot), `slot ${slot} must be on Scene note ${note}`).toBe(note);
        });
      });

      it('BLACKOUT is off the Scene column (moved to Track button 8, note 107)', () => {
        const blackout = controls.filter((c) => c.action.kind === 'blackoutToggle');
        expect(blackout).toHaveLength(1);
        expect(singleNote(blackout[0])).toBe(TRACK_8_NOTE);
        // And no Scene note is claimed by blackout — the column is pure slots.
        for (const note of SCENE_NOTES_TOP_TO_BOTTOM) {
          expect(singleNote(blackout[0])).not.toBe(note);
        }
      });

      // ── LED feedback: the pads still track slot state after the reorder ──
      it('lights each slot pad from its own slot-active state (all 8 slots)', () => {
        // Active slots 2, 5, 8 → their Scene pads (notes 113, 116, 119) lit;
        // the rest of the column dark. Slot count high enough that all 8 are
        // "present" (mirrors the engine's 13 default bindings).
        const active = new Set([2, 5, 8]);
        const s = projState({
          getGlobalEffectSlotActive: (slot) => active.has(slot),
          globalEffectSlotCount: 13,
        });
        const { messages } = projectLeds(apc, s, {}, ctxName);
        SCENE_NOTES_TOP_TO_BOTTOM.forEach((note, i) => {
          const slot = i + 1;
          // Scene buttons are single-colour → status 0x90, velocity on=1 / off=0.
          expect(messages).toContainEqual([0x90, note, active.has(slot) ? 1 : 0]);
        });
      });

      it('keeps a slot pad dark when its slotId exceeds the engine slot count', () => {
        // Only 3 slots exist engine-side → slots 4..8 stay dark regardless of
        // any (stale) active flag.
        const s = projState({
          getGlobalEffectSlotActive: () => true,
          globalEffectSlotCount: 3,
        });
        const { messages } = projectLeds(apc, s, {}, ctxName);
        // Notes 115..119 (slots 4..8) forced dark.
        for (const note of [115, 116, 117, 118, 119]) {
          expect(messages).toContainEqual([0x90, note, 0]);
        }
      });

      it('the relocated BLACKOUT pad (note 107) tracks blackout state', () => {
        const on = projectLeds(apc, projState({ blackout: true }), {}, ctxName).messages;
        // led: { on: 2 } → blink velocity when engaged.
        expect(on).toContainEqual([0x90, TRACK_8_NOTE, 2]);
        const off = projectLeds(apc, projState({ blackout: false }), {}, ctxName).messages;
        expect(off).toContainEqual([0x90, TRACK_8_NOTE, 0]);
      });
    });
  }
});

// Minimal MidiProjectionState with every getter defaulting to "nothing lit",
// so a test only overrides the fields it cares about.
function projState(over: Partial<MidiProjectionState> = {}): MidiProjectionState {
  return {
    blackout: false,
    activePattern: null,
    getGlobalEffectState: () => false,
    resolvePatternForBank: () => null,
    layerExists: () => false,
    getFocusedLayer: () => -1,
    isFocusLocked: () => false,
    getGlobalEffectSlotActive: () => false,
    globalEffectSlotCount: 0,
    getLayerPlaylistLength: () => 0,
    getLayerActiveEntryIndex: () => -1,
    getWindowCursor: () => 0,
    windowSize: 6,
    getColorPaletteHue: () => null,
    syncOwnedKeys: new Set<string>(),
    ...over,
  };
}

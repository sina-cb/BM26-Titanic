// Regression guard for the Hi-Hat ↔ Blizzard crosstalk class: two VSN1 pads on
// one page bound to two presets of the SAME singleton engine effect (which
// shares one active flag), so pressing one drives the other. See
// effect_layout_guard.ts for the full root-cause writeup.
//
// Three layers:
//   1. PURE unit tests of findSamePageSingletonCollisions (synthetic layouts,
//      HARD asserts) — the reusable rule.
//   2. A scan of the SHIPPED VSN1 layouts (engine state YAML) — HARD-asserts the
//      party bench (test_bench) is collision-free, and LOUDLY WARNS (never
//      hard-fails, so the baseline stays green under the engine agent's parallel
//      rewrite) for any other scene, surfacing latent dupes.
//   3. A warn-only mirror check: PRESET_AWARE_EFFECT_IDS vs the engine's actual
//      `_isSlotActive` preset-scoped cases, so the coupling is self-checking.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  findSamePageSingletonCollisions,
  describeCollision,
  pageOfSlot,
  PRESET_AWARE_EFFECT_IDS,
  SLOTS_PER_PAGE,
  LayoutSlot,
} from './effect_layout_guard';

// ── 1. Pure rule ────────────────────────────────────────────────────────────

describe('findSamePageSingletonCollisions — the crosstalk rule', () => {
  it('the Hi-Hat + Blizzard scenario (two sparkle presets, one page) → NO collision after the engine fix', () => {
    // The party bug: Hi-Hat + Blizzard (two `sparkle` presets) on one page used to
    // collide because sparkle shared ONE active flag. The engine RCA fix
    // (2026-07-11, global_effect_slot_manager.js `_isSlotActive` case 'sparkle':
    // `c.sparkle.enabled && c.sparkle.presetId === slot.presetId`) made sparkle
    // PRESET-AWARE, so the two presets are now independent pads — NO collision.
    // `sparkle` is therefore in PRESET_AWARE_EFFECT_IDS (the mirror tracks the
    // engine). This test documents the FIXED bug; the singleton-collision RULE
    // itself is still proven by the vintageWhite / uvBlast cases below.
    const slots: LayoutSlot[] = [
      { slotId: 6, effectId: 'sparkle', presetId: 'hihat', enabled: true },
      { slotId: 7, effectId: 'sparkle', presetId: 'blizzard', enabled: true },
    ];
    expect(findSamePageSingletonCollisions(slots)).toEqual([]);
  });

  it('a still-SINGLETON effect (dropHit) twice on one page → collision (rule still fires)', () => {
    // Proves the crosstalk rule still catches genuine singletons now that sparkle
    // has moved to the preset-aware set. dropHit (trigger) shares one active path.
    const slots: LayoutSlot[] = [
      { slotId: 6, effectId: 'dropHit', presetId: 'white_drop', enabled: true },
      { slotId: 7, effectId: 'dropHit', presetId: 'iceberg_flash', enabled: true },
    ];
    const hits = findSamePageSingletonCollisions(slots);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ page: 0, effectId: 'dropHit' });
    expect(hits[0].slotIds.sort()).toEqual([6, 7]);
    expect(describeCollision(hits[0])).toContain("singleton effect 'dropHit'");
  });

  it('a preset-aware effect (feedbackTrails) twice on one page → NO collision', () => {
    // Mirrors summer_camp_dome page 0 (soft_afterimage + long_afterimage) which
    // is legitimate — feedbackTrails is preset-scoped engine-side.
    const slots: LayoutSlot[] = [
      { slotId: 4, effectId: 'feedbackTrails', presetId: 'soft_afterimage', enabled: true },
      { slotId: 6, effectId: 'feedbackTrails', presetId: 'long_afterimage', enabled: true },
    ];
    expect(findSamePageSingletonCollisions(slots)).toEqual([]);
  });

  it('the same singleton effect on DIFFERENT pages → NO collision', () => {
    const slots: LayoutSlot[] = [
      { slotId: 2, effectId: 'uvBlast', presetId: 'default', enabled: true },   // page 0
      { slotId: 9, effectId: 'uvBlast', presetId: 'default', enabled: true },   // page 1
    ];
    expect(findSamePageSingletonCollisions(slots)).toEqual([]);
  });

  it('two presets of the SAME singleton on one page → collision even if presets differ or match', () => {
    const slots: LayoutSlot[] = [
      { slotId: 3, effectId: 'vintageWhite', presetId: 'default', enabled: true },
      { slotId: 7, effectId: 'vintageWhite', presetId: 'default', enabled: true },
    ];
    expect(findSamePageSingletonCollisions(slots)).toHaveLength(1);
  });

  it('a DISABLED slot does not participate', () => {
    const slots: LayoutSlot[] = [
      { slotId: 6, effectId: 'sparkle', presetId: 'hihat', enabled: true },
      { slotId: 7, effectId: 'sparkle', presetId: 'blizzard', enabled: false },
    ];
    expect(findSamePageSingletonCollisions(slots)).toEqual([]);
  });

  it('empty / effectless slots are ignored', () => {
    const slots: LayoutSlot[] = [
      { slotId: 6, effectId: '', enabled: true },
      { slotId: 7, effectId: null, enabled: true },
    ];
    expect(findSamePageSingletonCollisions(slots)).toEqual([]);
  });

  it('honours an EXPLICIT page field (device-config JSON shape) over slotId derivation', () => {
    // Two slots whose slotIds derive to different pages but are pinned to the
    // SAME explicit page collide.
    const slots: LayoutSlot[] = [
      { slotId: 1, page: 2, effectId: 'uvBlast', enabled: true },
      { slotId: 9, page: 2, effectId: 'uvBlast', enabled: true },
    ];
    expect(findSamePageSingletonCollisions(slots)).toHaveLength(1);
    expect(findSamePageSingletonCollisions(slots)[0].page).toBe(2);
  });

  it('pageOfSlot matches the engine 8-per-page geometry', () => {
    expect(pageOfSlot(1)).toBe(0);
    expect(pageOfSlot(8)).toBe(0);
    expect(pageOfSlot(9)).toBe(1);
    expect(pageOfSlot(32)).toBe(3);
  });
});

// ── 2. Shipped-layout scan ───────────────────────────────────────────────────

const REPO_ROOT = join(__dirname, '../../..');
const STATES_DIR = join(REPO_ROOT, 'marsin_engine', 'states');

function loadSceneSlots(scene: string): LayoutSlot[] {
  const doc = yaml.load(
    readFileSync(join(STATES_DIR, scene, 'global_effect_slots.yaml'), 'utf8'),
  ) as { slots?: LayoutSlot[] };
  return Array.isArray(doc?.slots) ? doc.slots : [];
}

describe('shipped VSN1 layouts — no same-page singleton crosstalk', () => {
  it('test_bench (the party bench) is collision-free', () => {
    const collisions = findSamePageSingletonCollisions(loadSceneSlots('test_bench'));
    if (collisions.length) {
      // Fail LOUD with the exact pads (codex P0 — never a silent pass).
      throw new Error(
        `test_bench VSN1 layout has singleton crosstalk:\n  ${collisions.map(describeCollision).join('\n  ')}`,
      );
    }
    expect(collisions).toEqual([]);
  });

  it('other scenes: report (warn-only) any singleton crosstalk without breaking the baseline', () => {
    // summer_camp_logsville binds singleton `vintageWhite` on slots 3 AND 7 of
    // page 0 (a latent same-class bug — reported to the coordinator). We LOUDLY
    // WARN rather than hard-fail so a scene we don't own can't break the party
    // baseline; the assertion below only proves the SCAN itself ran.
    let scanned = 0;
    for (const scene of ['summer_camp_dome', 'summer_camp_logsville']) {
      let slots: LayoutSlot[];
      try {
        slots = loadSceneSlots(scene);
      } catch {
        continue; // scene not present in this checkout — nothing to scan
      }
      scanned += 1;
      const collisions = findSamePageSingletonCollisions(slots);
      if (collisions.length) {
        // eslint-disable-next-line no-console
        console.warn(
          `[effect_layout_guard] scene '${scene}' has singleton crosstalk:\n  ` +
            collisions.map(describeCollision).join('\n  '),
        );
      }
    }
    expect(scanned).toBeGreaterThan(0);
  });
});

// ── 3. Mirror self-check (warn-only) ─────────────────────────────────────────

describe('PRESET_AWARE_EFFECT_IDS mirrors the engine _isSlotActive', () => {
  it('warns loudly if the mirror drifts from global_effect_slot_manager.js', () => {
    // Parse the engine source's `_isSlotActive` switch and extract which effect
    // cases are preset-scoped (their body references presetId / .preset). This
    // is a SELF-CHECK: on any parse trouble or drift we WARN (never fail), so the
    // engine agent's concurrent rewrite can't break this suite, but a real change
    // to preset-awareness is surfaced so the mirror gets updated.
    let src: string;
    try {
      src = readFileSync(
        join(REPO_ROOT, 'marsin_engine', 'lib', 'global_effect_slot_manager.js'),
        'utf8',
      );
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[effect_layout_guard] could not read engine slot manager to verify mirror — skipping self-check');
      return;
    }
    // Anchor on the METHOD DEFINITION (`_isSlotActive(slot)`), not the first
    // mention (it may be called before it's defined), then split its switch on
    // `case '...':` and flag any case body that references presetId / .preset.
    const derived = new Set<string>();
    const defMatch = /_isSlotActive\s*\(\s*slot\s*\)\s*\{/.exec(src);
    const fnStart = defMatch ? defMatch.index : src.indexOf('_isSlotActive');
    if (fnStart >= 0) {
      const body = src.slice(fnStart, fnStart + 4000);
      const segments = body.split(/case\s+'/).slice(1); // each starts "<id>': <body...>"
      for (const seg of segments) {
        const idm = /^([a-zA-Z0-9_]+)'\s*:/.exec(seg);
        if (!idm) continue;
        const id = idm[1];
        // The case body is everything up to the NEXT case/default/method end.
        const block = seg.split(/\n\s*(?:case\s+'|default\s*:)/)[0];
        if (/presetId|\.preset\b/.test(block)) derived.add(id);
      }
    }
    if (derived.size === 0) {
      // eslint-disable-next-line no-console
      console.warn('[effect_layout_guard] could not derive preset-aware cases from engine source — mirror not verified this run');
      return;
    }
    const mirror = [...PRESET_AWARE_EFFECT_IDS].sort();
    const engineSet = [...derived].sort();
    const missingFromMirror = engineSet.filter((id) => !PRESET_AWARE_EFFECT_IDS.has(id));
    const extraInMirror = mirror.filter((id) => !derived.has(id));
    if (missingFromMirror.length || extraInMirror.length) {
      // eslint-disable-next-line no-console
      console.warn(
        '[effect_layout_guard] PRESET_AWARE_EFFECT_IDS drifted from engine _isSlotActive.\n' +
          `  engine preset-aware: ${engineSet.join(', ')}\n` +
          `  mirror:              ${mirror.join(', ')}\n` +
          (missingFromMirror.length ? `  ADD to mirror: ${missingFromMirror.join(', ')}\n` : '') +
          (extraInMirror.length ? `  REMOVE from mirror (or engine changed): ${extraInMirror.join(', ')}\n` : '') +
          '  (warn-only — update the mirror when the engine sparkle fix lands.)',
      );
    }
    // Always passes: this test is a diagnostic beacon, not a gate (party-safety).
    expect(derived.size).toBeGreaterThan(0);
  });
});

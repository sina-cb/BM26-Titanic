import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import * as esmCore from '../../shared/color_control_core.js';

type ColorCore = typeof esmCore;

function loadClassicCore() {
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../shared/color_control_core_browser.js',
    ),
    'utf8',
  );
  const window: { ColorControlCore?: ColorCore } = {};
  vm.runInNewContext(source, { window }, { filename: 'color_control_core_browser.js' });
  if (!window.ColorControlCore) throw new Error('classic core did not install synchronously');
  return { core: window.ColorControlCore, source, window };
}

function behaviorTranscript(core: ColorCore) {
  const bases = [0, 0.17, 0.72, 0.99];
  const schemes = Object.fromEntries(
    bases.map(base => [base, Object.fromEntries(
      core.SCHEME_IDS.map(scheme => [scheme, core.generateScheme(scheme, base)]),
    )]),
  );
  const ring = core.generateScheme('golden', 0.31);
  const previous = {
    active: true,
    mode: 'followNote' as const,
    palettes: [],
    currentScheme: 'triadic',
    notePc: 4,
    noteHue: 0.25,
    nextMethodAtMs: 9000,
    followNote: { schemes: ['triadic'] },
  };
  return JSON.stringify({
    apiVersion: core.CORE_API_VERSION,
    keys: Object.keys(core).sort(),
    schemes,
    orbit: core.orbitPairs(ring, [1, 4]),
    // docs/75 §4 — the stepped queue. [0,1] is the ADJACENT/default pick
    // (d = 1 on a 5-ring), which now steps by 2; [1, 3] is a SPACED pick
    // (d = 2), which stays at step 1 — both must agree byte-for-byte between
    // the ESM core and this classic mirror, or the two builds would post
    // different wires to the SAME daemon.
    orbitAdjacent: core.orbitPairs(ring, [0, 1]),
    orbitSpaced: core.orbitPairs(ring, [1, 3]),
    orbitStepTable: [1, 2, 3, 4].map(d => core.orbitStep(d, 5)),
    orbitStepCrossfade: core.orbitStep(1, 2),
    turns: core.turnsAutopilotPatch(ring, 5, 1.5, [1, 3]),
    crossfade: core.crossfadeAutopilotPatch(0.1, 0.6, 2, 0.8),
    follow: core.followNoteAutopilotPatch({
      schemes: ['complement', 'triadic', 'golden'],
      methodHoldS: 60,
      methodFadeS: 3,
      noteFadeMs: 400,
      sel: [1, 4],
      shuffle: true,
    }),
    palette: core.paletteWritePayload(0.2, 0.7),
    reduced: core.reduceColorControlState(previous, {
      active: true,
      mode: 'palettes',
      palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }],
      delay_s: 2,
      transitionMs: 800,
      shuffle: false,
      nextSwapAtMs: 12000,
    }),
  });
}

function checksum(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('classic-browser color control core', () => {
  it('installs synchronously as one frozen window global with the exact ESM API', () => {
    const { core, source, window } = loadClassicCore();
    expect(source).not.toMatch(/\bimport\s|\bexport\s/);
    expect(Object.isFrozen(core)).toBe(true);
    expect(Object.keys(core).sort()).toEqual(Object.keys(esmCore).sort());
    expect(core.CORE_API_VERSION).toBe(esmCore.CORE_API_VERSION);
    expect(() => vm.runInNewContext(source, { window })).toThrow(/already installed/);
  });

  it('has a byte-identical canonical behavior transcript and checksum', () => {
    const { core } = loadClassicCore();
    const esmTranscript = behaviorTranscript(esmCore);
    const classicTranscript = behaviorTranscript(core);
    expect(classicTranscript).toBe(esmTranscript);
    expect(checksum(classicTranscript)).toBe(checksum(esmTranscript));
  });

  it('docs/75 §4: both mirrors agree on the stepped orbit table and its byte-identity pins', () => {
    const { core } = loadClassicCore();
    for (const [d, expectedStep] of [[1, 2], [2, 1], [3, 1], [4, 2]] as const) {
      expect(core.orbitStep(d, 5)).toBe(expectedStep);
      expect(esmCore.orbitStep(d, 5)).toBe(expectedStep);
    }
    // n = 2 (the crossfade's ring): no disjoint step exists — s = 1 always.
    expect(core.orbitStep(1, 2)).toBe(1);
    expect(esmCore.orbitStep(1, 2)).toBe(1);

    const ring = core.generateScheme('triadic', 0.4);
    // SPACED pick (d = 2): step 1, byte-identical to the pre-orbit wire in
    // BOTH cores.
    expect(core.orbitPairs(ring, [1, 3])).toEqual(esmCore.orbitPairs(ring, [1, 3]));
    // ADJACENT/default pick (d = 1): step 2, the new queue, ALSO
    // byte-identical between the two mirrors.
    expect(core.orbitPairs(ring, [0, 1])).toEqual(esmCore.orbitPairs(ring, [0, 1]));
    // The crossfade wire (n = 2) is untouched by either mirror.
    expect(core.crossfadeAutopilotPatch(0.2, 0.8, 5, 1))
      .toEqual(esmCore.crossfadeAutopilotPatch(0.2, 0.8, 5, 1));
  });
});

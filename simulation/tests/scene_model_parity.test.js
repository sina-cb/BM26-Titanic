/**
 * scene_model_parity.test.js — the scene ↔ engine-model parity gate
 * (lib/scene_model_parity.cjs, plan 20260725_33 §4).
 *
 * Two layers:
 *
 *  1. SYNTHETIC — a hand-built scene that is parity-clean, then one mutation
 *     per check family. The plan requires every check to be falsified at
 *     least once: a gate nobody has watched go red is a gate nobody can
 *     trust. Each mutation asserts the SPECIFIC code, not just "something
 *     failed".
 *
 *  2. REAL SCENES — test_bench and titanic as committed. These assert the
 *     SHAPE of the verdict (which check families are clean, which codes may
 *     appear), never an exact defect count, so the suite survives the
 *     mapping campaign landing its fixes scene by scene.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkSceneModelParity, CHECKS } = require('../lib/scene_model_parity.cjs');
const { loadScene, loadFixtureDefs, loadYaml, SIM_CONFIG } =
  require('../tools/scene_model_parity.cjs');

// ── A parity-clean synthetic scene ──────────────────────────────────────
// Two 4-channel pars on U2 (@1 and @5) plus a 3-pixel RGBW strand on U10.
// Small enough to read, complete enough to exercise every check.

const FIXTURE_DEFS = {
  TestPar: {
    fixtureType: 'TestPar',
    footprint: 4,
    bus: 'dmx',
    pixels: [{ id: 'p1', channels: { red: 1, green: 2, blue: 3 } }],
  },
  TestFogMachine: { fixtureType: 'TestFogMachine', footprint: 1, bus: 'dmx', pixels: [] },
};

const PINS = { TestFogMachine: { universe: 1, address: 500 } };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function goodInput(overrides = {}) {
  const input = {
    scene: 'synthetic',
    fixtureDefs: FIXTURE_DEFS,
    pins: PINS,
    sceneConfig: {
      parLights: {
        fixtures: [
          { name: 'Par A', group: 'Pars', fixtureType: 'TestPar' },
          { name: 'Par B', group: 'Pars', fixtureType: 'TestPar' },
        ],
      },
      ledStrands: {
        strands: [
          { name: 'S0', group: '', ledCount: 3, sectionId: 2, fixtureId: 3, viewMask: 0 },
        ],
      },
    },
    controllers: {
      controllers: [
        {
          id: 1,
          name: 'DMX 1',
          ip: '10.0.0.1',
          type: 'DMX',
          protocol: 'sACN',
          ports: [{
            port: 1,
            universe: 2,
            chain: [{ fixture: 'Par A', at: 1 }, { fixture: 'Par B', at: 5 }],
          }],
        },
        {
          id: 2,
          name: 'LED 1',
          ip: '10.0.0.2',
          type: 'LED',
          protocol: 'sACN',
          ports: [{ port: 1, universe: 10, startAddress: 1, chain: ['S0'] }],
          led: { baseUniverse: 0, startAddr: 1, order: 'RGBW', stride: 4, whiteMode: 'native' },
        },
      ],
    },
    patches: {
      patches: {
        'Par A': {
          controllerIp: '10.0.0.1', dmxUniverse: 2, dmxAddress: 1,
          controllerId: 1, sectionId: 1, fixtureId: 1, viewMask: 0,
        },
        'Par B': {
          controllerIp: '10.0.0.1', dmxUniverse: 2, dmxAddress: 5,
          controllerId: 1, sectionId: 1, fixtureId: 2, viewMask: 0,
        },
        S0: {
          controllerIp: '10.0.0.2', controllerId: 2, dmxUniverse: 10, dmxAddress: 1,
          pixelCount: 3, outputIndex: 0, endUniverse: 10, endChannel: 12,
          segments: [{ universe: 10, startChannel: 1, endChannel: 12, pixelCount: 3 }],
        },
      },
    },
    views: { views: { groupBits: { Pars: 1, S0: 2 }, custom: [] } },
    viewmasks: { groupBits: { Pars: 1, S0: 2 }, viewMasks: [] },
    effects: { specialEffects: [] },
    model: {
      pixelCount: 5,
      pixels: [
        {
          i: 0, type: 'dmx', fixtureType: 'TestPar', name: 'Par A - p1', group: 'Pars',
          cId: 1, sId: 1, fId: 1, localIndex: 0, vMask: 0,
          patch: { universe: 2, addr: 1, footprint: 4 }, channels: { r: 1, g: 2, b: 3 },
        },
        {
          i: 1, type: 'dmx', fixtureType: 'TestPar', name: 'Par B - p1', group: 'Pars',
          cId: 1, sId: 1, fId: 2, localIndex: 0, vMask: 0,
          patch: { universe: 2, addr: 5, footprint: 4 }, channels: { r: 1, g: 2, b: 3 },
        },
        ...[0, 1, 2].map((j) => ({
          i: 2 + j, type: 'led', fixtureType: '', name: 'S0', group: 'S0',
          cId: 2, sId: 2, fId: 3, localIndex: j, vMask: 0,
          patch: { universe: 10, addr: 1 + j * 4, footprint: 4, led: true },
          channels: { r: 1, g: 2, b: 3, w: 4 }, whiteMode: 'native',
        })),
      ],
    },
  };
  return { ...input, ...overrides };
}

/** Run the checker and return the set of error codes it raised. */
function errorCodes(input) {
  const { findings } = checkSceneModelParity(input);
  return findings.filter((f) => f.severity === 'error').map((f) => f.code);
}

function mutate(fn) {
  const input = goodInput();
  // Deep-clone the mutable artifacts so tests never leak into each other.
  input.sceneConfig = clone(input.sceneConfig);
  input.controllers = clone(input.controllers);
  input.patches = clone(input.patches);
  input.views = clone(input.views);
  input.viewmasks = clone(input.viewmasks);
  input.model = clone(input.model);
  fn(input);
  return input;
}

// ── The clean baseline ──────────────────────────────────────────────────

test('a parity-clean scene passes with no errors and no warnings', () => {
  const result = checkSceneModelParity(goodInput());
  assert.deepEqual(
    result.findings.filter((f) => f.severity !== 'info'), [],
    'the synthetic scene must be clean — every mutation test below depends on it');
  assert.equal(result.ok, true);
  assert.equal(result.stats.expectedPixels, 5);
  assert.equal(result.stats.modelPixels, 5);
});

test('a clean scene stays clean under --strict (no placeholders, all patched)', () => {
  const result = checkSceneModelParity(goodInput({ strict: true }));
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

// ── Check 1: coverage ───────────────────────────────────────────────────

test('coverage: a renamed model pixel is caught field-by-field', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixels[0].name = 'Par Z - p1'; }));
  assert.ok(codes.includes('pixel_field_mismatch'));
});

test('coverage: a fixture added to the scene but missing from the model is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.sceneConfig.parLights.fixtures.push({ name: 'Par C', group: 'Pars', fixtureType: 'TestPar' });
    i.patches.patches['Par C'] = {
      controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0,
      sectionId: 0, fixtureId: 0, viewMask: 0,
    };
  }));
  assert.ok(codes.includes('pixel_roster_size'));
  assert.ok(codes.includes('pixel_missing_from_model'));
});

test('coverage: a model pixel with no scene fixture behind it is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.model.pixels.push({
      i: 5, type: 'dmx', fixtureType: 'TestPar', name: 'Ghost - p1', group: 'Pars',
      cId: 1, sId: 1, fId: 9, localIndex: 0, vMask: 0, patch: null, channels: null,
    });
    i.model.pixelCount = 6;
  }));
  assert.ok(codes.includes('pixel_absent_from_scene'));
});

test('coverage: an unknown fixtureType fails loudly instead of exporting nothing', () => {
  const codes = errorCodes(mutate((i) => {
    i.sceneConfig.parLights.fixtures[1].fixtureType = 'NoSuchFixture';
  }));
  assert.ok(codes.includes('missing_fixture_def'));
});

test('coverage: duplicate fixture names are rejected — names are the join key', () => {
  const codes = errorCodes(mutate((i) => { i.sceneConfig.parLights.fixtures[1].name = 'Par A'; }));
  assert.ok(codes.includes('duplicate_scene_name'));
});

// ── Check 2: patch truth ────────────────────────────────────────────────

test('patch truth: a model DMX address that disagrees with patches.yaml is caught', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixels[1].patch.addr = 9; }));
  assert.ok(codes.includes('dmx_patch_mismatch'));
});

test('patch truth: a wrong DMX footprint is caught against the fixture definition', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixels[0].patch.footprint = 6; }));
  assert.ok(codes.includes('dmx_patch_mismatch'));
});

test('patch truth: a break in the LED no-straddle walk is caught', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixels[3].patch.addr = 6; }));
  assert.ok(codes.includes('strand_walk_mismatch'));
});

test('patch truth: the walk wraps whole pixels at ch 512 rather than straddling', () => {
  // 3 px × 4 B from U10 ch 509 ⇒ 509, then 512 will not fit (509+4-1 = 512 is
  // the LAST legal byte, so pixel 1 fits; pixel 2 must roll to U11 ch 1).
  const input = mutate((i) => {
    i.patches.patches.S0.dmxAddress = 509;
    i.patches.patches.S0.endUniverse = 11;
    i.patches.patches.S0.endChannel = 8;
    i.patches.patches.S0.segments = [
      { universe: 10, startChannel: 509, endChannel: 512, pixelCount: 1 },
      { universe: 11, startChannel: 1, endChannel: 8, pixelCount: 2 },
    ];
    i.model.pixels[2].patch = { universe: 10, addr: 509, footprint: 4, led: true };
    i.model.pixels[3].patch = { universe: 11, addr: 1, footprint: 4, led: true };
    i.model.pixels[4].patch = { universe: 11, addr: 5, footprint: 4, led: true };
  });
  assert.deepEqual(errorCodes(input), []);
});

test('patch truth: a segment record that disagrees with the model pixels is caught', () => {
  const codes = errorCodes(mutate((i) => { i.patches.patches.S0.segments[0].endChannel = 16; }));
  assert.ok(codes.includes('strand_segment_mismatch'));
});

test('patch truth: an end-channel record that disagrees with the walk is caught', () => {
  const codes = errorCodes(mutate((i) => { i.patches.patches.S0.endChannel = 99; }));
  assert.ok(codes.includes('strand_end_channel_mismatch'));
});

test('patch truth: a patched strand exported unpatched is caught (stale model)', () => {
  const codes = errorCodes(mutate((i) => {
    for (const px of i.model.pixels) {
      if (px.type === 'led') { px.patch = null; px.channels = null; px.unpatched = true; }
    }
  }));
  assert.ok(codes.includes('strand_record_without_model_patch'));
});

test('patch truth: an unpatched strand missing its loud marker is caught (codex P0)', () => {
  const codes = errorCodes(mutate((i) => {
    delete i.patches.patches.S0;
    i.controllers.controllers[1].ports[0].chain = [];
    for (const px of i.model.pixels) {
      if (px.type === 'led') { px.patch = null; px.channels = null; }
    }
  }));
  assert.ok(codes.includes('strand_missing_unpatched_marker'));
});

test('patch truth: a channel order that disagrees with the controller is caught', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[1].led.order = 'GRBW'; }));
  assert.ok(codes.includes('strand_channel_map_mismatch'));
});

// ── Check 3: address hygiene ────────────────────────────────────────────

test('address hygiene: two fixtures overlapping on one controller is a duplicate address', () => {
  const codes = errorCodes(mutate((i) => {
    i.controllers.controllers[0].ports[0].chain[1].at = 3;
    i.patches.patches['Par B'].dmxAddress = 3;
    i.model.pixels[1].patch.addr = 3;
  }));
  assert.ok(codes.includes('duplicate_address'));
});

test('address hygiene: an overlap across DIFFERENT controllers warns, and --strict fails', () => {
  const build = () => mutate((i) => {
    i.controllers.controllers.push({
      id: 3, name: 'DMX 2', ip: '10.0.0.3', type: 'DMX', protocol: 'sACN',
      ports: [{ port: 1, universe: 2, chain: [{ fixture: 'Par C', at: 1 }] }],
    });
    i.sceneConfig.parLights.fixtures.push({ name: 'Par C', group: 'Pars', fixtureType: 'TestPar' });
    i.patches.patches['Par C'] = {
      controllerIp: '10.0.0.3', dmxUniverse: 2, dmxAddress: 1,
      controllerId: 3, sectionId: 1, fixtureId: 4, viewMask: 0,
    };
    i.model.pixels.push({
      i: 5, type: 'dmx', fixtureType: 'TestPar', name: 'Par C - p1', group: 'Pars',
      cId: 3, sId: 1, fId: 4, localIndex: 0, vMask: 0,
      patch: { universe: 2, addr: 1, footprint: 4 }, channels: { r: 1, g: 2, b: 3 },
    });
    i.model.pixelCount = 6;
  });
  const loose = checkSceneModelParity(build());
  assert.ok(loose.findings.some((f) => f.code === 'shared_universe_overlap' && f.severity === 'warn'));
  const strict = checkSceneModelParity({ ...build(), strict: true });
  assert.ok(strict.findings.some((f) => f.code === 'shared_universe_overlap' && f.severity === 'error'));
});

test('address hygiene: an unmapped fixture is an error — it can never be driven', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[0].ports[0].chain.pop(); }));
  assert.ok(codes.includes('unmapped_fixture'));
});

test('address hygiene: an unmapped LED strand is an error', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[1].ports[0].chain = []; }));
  assert.ok(codes.includes('unmapped_strand'));
});

test('address hygiene: a footprint running past ch 512 is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.controllers.controllers[0].ports[0].chain[1].at = 510;
    i.patches.patches['Par B'].dmxAddress = 510;
    i.model.pixels[1].patch.addr = 510;
  }));
  assert.ok(codes.includes('address_out_of_universe'));
});

test('address hygiene: a chain entry naming nothing in the scene is an orphan', () => {
  const codes = errorCodes(mutate((i) => {
    i.controllers.controllers[0].ports[0].chain.push({ fixture: 'Nobody', at: 100 });
  }));
  assert.ok(codes.includes('orphan_chain_entry'));
});

test('address hygiene: a malformed controller IP unpatches its whole chain', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[0].ip = '10.0.0'; }));
  assert.ok(codes.includes('controller_bad_ip'));
});

test('address hygiene: two controllers sharing an IP is caught', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[1].ip = '10.0.0.1'; }));
  assert.ok(codes.includes('controller_duplicate_ip'));
});

test('address hygiene: a strand chained on a DMX controller is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.controllers.controllers[0].ports[0].chain.push({ fixture: 'S0', at: 100 });
    i.controllers.controllers[1].ports[0].chain = [];
  }));
  assert.ok(codes.includes('strand_on_dmx_controller'));
});

// ── Check 4: metadata ───────────────────────────────────────────────────

test('metadata: a DMX/LED fixtureId collision is caught (the 20260725_4 bug)', () => {
  const codes = errorCodes(mutate((i) => {
    i.sceneConfig.ledStrands.strands[0].fixtureId = 1;
    for (const px of i.model.pixels) if (px.type === 'led') px.fId = 1;
  }));
  assert.ok(codes.includes('fixture_id_collision'));
  assert.ok(codes.includes('fixture_id_dmx_led_collision'));
});

test('metadata: a DMX/LED sectionId collision is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.sceneConfig.ledStrands.strands[0].sectionId = 1;
    for (const px of i.model.pixels) if (px.type === 'led') px.sId = 1;
  }));
  assert.ok(codes.includes('section_id_dmx_led_collision'));
  assert.ok(codes.includes('section_id_spans_groups'));
});

test('metadata: one group carrying two section ids breaks the bijection', () => {
  const codes = errorCodes(mutate((i) => {
    i.model.pixels[1].sId = 7;
    i.patches.patches['Par B'].sectionId = 7;
  }));
  assert.ok(codes.includes('group_spans_section_ids'));
});

test('metadata: a patched pixel with zeroed ids is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.model.pixels[0].sId = 0;
    i.patches.patches['Par A'].sectionId = 0;
  }));
  assert.ok(codes.includes('patched_pixel_without_section_id'));
});

// ── Check 5: views ──────────────────────────────────────────────────────

test('views: a model group with no bit is caught (the engine refuses to load it)', () => {
  const codes = errorCodes(mutate((i) => { delete i.views.views.groupBits.S0; }));
  assert.ok(codes.includes('group_without_bit'));
});

test('views: a groupBits entry with no pixels behind it is caught', () => {
  const codes = errorCodes(mutate((i) => { i.views.views.groupBits.Ghosts = 4; }));
  assert.ok(codes.includes('stale_group_bit'));
});

test('views: a non-power-of-two bit is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.views.views.groupBits.S0 = 3;
    i.viewmasks.groupBits.S0 = 3;
  }));
  assert.ok(codes.includes('bad_group_bit'));
});

test('views: two groups on one bit are caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.views.views.groupBits.S0 = 1;
    i.viewmasks.groupBits.S0 = 1;
  }));
  assert.ok(codes.includes('duplicate_view_bit'));
});

test('views: a custom view referencing an unknown group is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.views.views.custom.push({ name: 'ghosts', bit: 8, word: 0, groups: ['Nope'] });
    i.viewmasks.viewMasks.push({ name: 'ghosts', bit: 8, groups: ['Nope'] });
  }));
  assert.ok(codes.includes('custom_view_unknown_group'));
});

// ── Check 6: bench parity ───────────────────────────────────────────────

function withBenchBlock(input) {
  input.sceneConfig.parLights.fixtures.push({
    name: 'TB Par 1', group: 'TB Pars', fixtureType: 'TestPar',
  });
  input.patches.patches['TB Par 1'] = {
    controllerIp: '10.0.0.9', dmxUniverse: 3, dmxAddress: 1,
    controllerId: 3, sectionId: 4, fixtureId: 4, viewMask: 0,
  };
  input.controllers.controllers.push({
    id: 3, name: 'TB Bench DMX', ip: '10.0.0.9', type: 'DMX', protocol: 'sACN',
    ports: [{ port: 1, universe: 3, chain: [{ fixture: 'TB Par 1', at: 1 }] }],
  });
  input.model.pixels.push({
    i: 5, type: 'dmx', fixtureType: 'TestPar', name: 'TB Par 1 - p1', group: 'TB Pars',
    cId: 3, sId: 4, fId: 4, localIndex: 0, vMask: 0,
    patch: { universe: 3, addr: 1, footprint: 4 }, channels: { r: 1, g: 2, b: 3 },
  });
  input.model.pixelCount = 6;
  input.views.views.groupBits['TB Pars'] = 4;
  input.viewmasks.groupBits['TB Pars'] = 4;
  return input;
}

const BENCH_SOURCE = {
  scene: 'bench_src',
  sceneConfig: {
    parLights: { fixtures: [{ name: 'Par 1', group: 'Pars', fixtureType: 'TestPar' }] },
    ledStrands: { strands: [] },
  },
  controllers: {
    controllers: [{
      id: 1, name: 'Bench DMX', ip: '10.0.0.9', type: 'DMX', protocol: 'sACN',
      ports: [{ port: 1, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] }],
    }],
  },
};

test('bench parity: a scene with no TB block reports it as not applicable', () => {
  const { findings } = checkSceneModelParity(goodInput());
  assert.ok(findings.some((f) => f.code === 'no_bench_block' && f.severity === 'info'));
});

test('bench parity: a TB block with no source scene supplied cannot be proven in sync', () => {
  const codes = errorCodes(mutate(withBenchBlock));
  assert.ok(codes.includes('bench_source_not_supplied'));
});

test('bench parity: a TB block matching the source scene passes', () => {
  const input = mutate(withBenchBlock);
  input.benchScene = BENCH_SOURCE;
  const codes = errorCodes(input);
  assert.deepEqual(codes.filter((c) => c.startsWith('bench_')), []);
});

test('bench parity: a hand-edited TB block diverging from the source is caught', () => {
  const input = mutate(withBenchBlock);
  input.benchScene = BENCH_SOURCE;
  input.controllers.controllers[2].ports[0].chain[0].at = 40;
  input.patches.patches['TB Par 1'].dmxAddress = 40;
  input.model.pixels[5].patch.addr = 40;
  assert.ok(errorCodes(input).includes('bench_controller_drift'));
});

// ── Check 7: placeholder policy ─────────────────────────────────────────

function withPlaceholderController(input, { marked = true } = {}) {
  input.controllers.controllers[0].ip = '0.0.0.0';
  input.controllers.controllers[0].name = marked ? 'DMX 1 PLACEHOLDER' : 'DMX 1';
  // A placeholder controller is unsendable, so its fixtures project unpatched.
  for (const name of ['Par A', 'Par B']) {
    Object.assign(input.patches.patches[name], {
      controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0,
    });
  }
  for (const px of input.model.pixels) if (px.type === 'dmx') { px.patch = null; px.cId = 0; }
  return input;
}

test('placeholder: a 0.0.0.0 sentinel is INFO by default and ERROR under --strict', () => {
  const loose = checkSceneModelParity(mutate(withPlaceholderController));
  const info = loose.findings.find((f) => f.code === 'placeholder_controller');
  assert.ok(info, 'the sentinel must be listed loudly even in default mode');
  assert.equal(info.severity, 'info');

  const strict = checkSceneModelParity({ ...mutate(withPlaceholderController), strict: true });
  const err = strict.findings.find((f) => f.code === 'placeholder_controller');
  assert.equal(err.severity, 'error', '--strict IS the hardware gate — a sentinel IP must fail it');
  assert.equal(strict.ok, false);
});

test('placeholder: a sentinel IP without the PLACEHOLDER name marker is always an error', () => {
  const codes = errorCodes(mutate((i) => withPlaceholderController(i, { marked: false })));
  assert.ok(codes.includes('sentinel_without_marker'));
});

test('placeholder: a PLACEHOLDER-marked controller with a REAL ip is always an error', () => {
  const codes = errorCodes(mutate((i) => { i.controllers.controllers[0].name = 'DMX 1 PLACEHOLDER'; }));
  assert.ok(codes.includes('marker_with_real_ip'),
    'a controller that claims to be a placeholder but would really transmit is the dangerous case');
});

test('placeholder: unpatched strand pixels are INFO by default and ERROR under --strict', () => {
  const build = () => mutate((i) => {
    delete i.patches.patches.S0;
    i.controllers.controllers[1].ports[0].chain = [];
    for (const px of i.model.pixels) {
      if (px.type === 'led') { px.patch = null; px.channels = null; px.unpatched = true; }
    }
  });
  const loose = checkSceneModelParity(build());
  assert.equal(loose.findings.find((f) => f.code === 'unpatched_marker').severity, 'info');
  const strict = checkSceneModelParity({ ...build(), strict: true });
  assert.equal(strict.findings.find((f) => f.code === 'unpatched_marker').severity, 'error');
});

// ── Check 8: drift (scene YAML ↔ generated model) ───────────────────────

test('drift: an exported pixelCount that disagrees with the pixel array is caught', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixelCount = 4; }));
  assert.ok(codes.includes('pixel_count_export_mismatch'));
});

test('drift: patches.yaml disagreeing with the controllers.yaml chains is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.patches.patches['Par B'].dmxAddress = 200;
    i.model.pixels[1].patch.addr = 200;
  }));
  assert.ok(codes.includes('patch_record_disagrees_with_chains'),
    'controllers.yaml is the authoring surface — a hand-edited patches.yaml must not survive');
});

test('drift: model metadata that disagrees with patches.yaml is caught', () => {
  const codes = errorCodes(mutate((i) => { i.model.pixels[0].fId = 42; }));
  assert.ok(codes.includes('metadata_drift'));
});

test('drift: a viewmasks sidecar bit that disagrees with views.yaml is caught', () => {
  const codes = errorCodes(mutate((i) => { i.viewmasks.groupBits.S0 = 8; }));
  assert.ok(codes.includes('sidecar_bit_mismatch'));
});

test('drift: a missing viewmasks sidecar is caught', () => {
  const input = mutate(() => {});
  input.viewmasks = null;
  assert.ok(errorCodes(input).includes('missing_viewmasks_sidecar'));
});

test('drift: a patch record for a deleted fixture is caught', () => {
  const codes = errorCodes(mutate((i) => {
    i.patches.patches['Par Gone'] = {
      controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0,
      sectionId: 0, fixtureId: 0, viewMask: 0,
    };
  }));
  assert.ok(codes.includes('orphan_patch_record'));
});

// ── Check 9: generator chain splits (design 20260725_41 §5) ─────────────
//
// A DMX trace generator's `chainSplits` declare the physical daisy-chain walk
// over its 1..count path positions. The validator re-states the exact-cover
// rule independently of src/, so a scene whose splits went stale (hand edit,
// a count change forced through) is caught offline / in CI — not only by the
// sim refusing to regenerate.

/** The synthetic scene plus a trace, so splits have something to live on. */
function withTrace(chainSplits, count = 5) {
  return mutate((i) => {
    const trace = {
      name: 'Left Front Wall Generator',
      shape: 'line',
      count,
      groupName: 'Left Front Wall Generator',
      generated: true,
    };
    if (chainSplits !== undefined) trace.chainSplits = chainSplits;
    i.sceneConfig.traces = [trace];
  });
}

test('a trace with NO chainSplits raises nothing (absent = plain path order)', () => {
  const result = checkSceneModelParity(withTrace(undefined));
  assert.deepEqual(result.findings.filter((f) => f.check === 'generator_splits'), []);
  assert.equal(result.ok, true);
});

test("the operator's example (4→5 / 3→2 / 1→1) is accepted", () => {
  const result = checkSceneModelParity(withTrace(
    [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }]));
  assert.deepEqual(result.findings.filter((f) => f.check === 'generator_splits'), []);
  assert.equal(result.ok, true);
});

test('a full-reverse split (the ⇄ Swap shape) is accepted', () => {
  const result = checkSceneModelParity(withTrace([{ from: 5, to: 1 }]));
  assert.deepEqual(result.findings.filter((f) => f.check === 'generator_splits'), []);
});

test('splits that OVERLAP are an error', () => {
  const codes = errorCodes(withTrace([{ from: 1, to: 3 }, { from: 3, to: 5 }]));
  assert.ok(codes.includes('invalid_cover'));
});

test('splits with a GAP are an error', () => {
  const result = checkSceneModelParity(withTrace([{ from: 3, to: 5 }]));
  const f = result.findings.find((x) => x.check === 'generator_splits');
  assert.equal(f.code, 'invalid_cover');
  assert.equal(f.severity, 'error');
  assert.match(f.message, /\{1, 2\}/);
});

test('an out-of-RANGE endpoint is an error', () => {
  const result = checkSceneModelParity(withTrace([{ from: 1, to: 7 }]));
  const f = result.findings.find((x) => x.check === 'generator_splits');
  assert.equal(f.code, 'invalid_cover');
  assert.match(f.message, /outside the trace's 1\.\.5 path positions/);
});

test('an EMPTY chainSplits list is an error, not "same as absent"', () => {
  const result = checkSceneModelParity(withTrace([]));
  const f = result.findings.find((x) => x.check === 'generator_splits');
  assert.equal(f.code, 'invalid_cover');
  assert.match(f.message, /EMPTY list/);
});

test('a non-integer endpoint is an error (no rounding)', () => {
  const codes = errorCodes(withTrace([{ from: 1, to: 5.5 }]));
  assert.ok(codes.includes('invalid_cover'));
});

test('a malformed split entry is an error', () => {
  assert.ok(errorCodes(withTrace(['1-5'])).includes('invalid_cover'));
  assert.ok(errorCodes(withTrace('4-5')).includes('invalid_cover'));
});

test('chainSplits on a trace with no usable count is an error', () => {
  const input = withTrace([{ from: 1, to: 5 }]);
  delete input.sceneConfig.traces[0].count;   // splits with nothing to cover
  const result = checkSceneModelParity(input);
  const f = result.findings.find((x) => x.check === 'generator_splits');
  assert.equal(f.code, 'invalid_cover');
  assert.match(f.message, /count is undefined/);
});

test('the finding names the offending trace', () => {
  const result = checkSceneModelParity(withTrace([{ from: 3, to: 5 }]));
  const f = result.findings.find((x) => x.check === 'generator_splits');
  assert.match(f.where, /trace 'Left Front Wall Generator'/);
});

test('generator_splits errors are errors in DEFAULT mode too, not just --strict', () => {
  const result = checkSceneModelParity(withTrace([{ from: 3, to: 5 }]));
  assert.equal(result.ok, false);
});

// ── Real scenes, as committed ───────────────────────────────────────────
//
// Shape assertions only. The mapping campaign will fix these scenes one at a
// time; the suite must stay green through that, while still failing if the
// model ever drifts from the scene.

const REAL_SCENE_SETUP = (() => {
  const fixtureDefs = loadFixtureDefs();
  const pins = (loadYaml(SIM_CONFIG, { required: false }) || {}).global_effects || {};
  return { fixtureDefs, pins };
})();

/** Codes that the mapping campaign is expected to still be carrying. */
const KNOWN_OPEN_CODES = new Set([
  'unmapped_fixture',              // fixtures not yet authored onto a controller
  'unmapped_strand',               // strands not yet bound to an LED controller
  'unmapped_effect',
  'fixture_id_collision',          // projectOntoConfigs DMX-only-max bug (20260725_4)
  'fixture_id_dmx_led_collision',
  'section_id_dmx_led_collision',
  'section_id_spans_groups',
  'group_spans_section_ids',
]);

/** Checks that must be spotless: these prove the MODEL matches the SCENE. */
const MUST_BE_CLEAN = [CHECKS.COVERAGE, CHECKS.PATCH_TRUTH, CHECKS.VIEWS, CHECKS.DRIFT];

async function runRealScene(scene) {
  const loaded = await loadScene(scene);
  return checkSceneModelParity({ ...loaded, ...REAL_SCENE_SETUP });
}

test('real scene test_bench: the model is a faithful export of the scene', async () => {
  const result = await runRealScene('test_bench');
  const dirty = result.findings.filter(
    (f) => f.severity === 'error' && MUST_BE_CLEAN.includes(f.check));
  assert.deepEqual(dirty, [],
    'test_bench coverage/patch-truth/views/drift must be clean — a failure here means the ' +
    'committed model no longer matches the committed scene, or the validator drifted from ' +
    'the exporter contract');
});

test('real scene test_bench: every remaining error is a known open mapping defect', async () => {
  const result = await runRealScene('test_bench');
  const unexpected = result.findings
    .filter((f) => f.severity === 'error' && !KNOWN_OPEN_CODES.has(f.code))
    .map((f) => `${f.code} @ ${f.where}`);
  assert.deepEqual(unexpected, []);
});

test('real scene titanic: the model is fresh and complete; only the LED signs await mapping', async () => {
  const result = await runRealScene('titanic');
  const dirty = result.findings.filter(
    (f) => f.severity === 'error' && MUST_BE_CLEAN.includes(f.check));
  assert.deepEqual(dirty, [],
    'the titanic model is a current, complete export — coverage/patch-truth/views/drift clean');

  // Every DMX fixture and every strand is authored onto a controller. The FOUR
  // TE-sign halves are deliberately NOT: the operator removed the DMX
  // placeholder they were parked on (2026-07-31 — *"the TE signs must be
  // associated with MarsinLED controllers … I saw DMX ones, that's wrong!"*)
  // and will attach them to a MarsinLED output himself. They are LED PIXEL
  // FIXTURES now, present and attachable in the LED half of the unmapped tray.
  // The gate stays RED until he does — an unmapped fixture is an error by
  // design, and softening that would hide a genuinely dark fixture.
  const unmapped = result.findings.filter((f) => f.code === 'unmapped_fixture')
    .map((f) => f.where).sort();
  assert.deepEqual(unmapped, [
    "fixture 'TE Sign 2 V3 A' (group 'TE Sign 2')",
    "fixture 'TE Sign 2 V3 B' (group 'TE Sign 2')",
    "fixture 'TE Sign V3 A' (group 'TE Sign')",
    "fixture 'TE Sign V3 B' (group 'TE Sign')",
  ]);
  assert.deepEqual(result.findings.filter((f) => f.code === 'unmapped_strand'), []);
  assert.equal(result.stats.errors, 4,
    'the ONLY open errors are the four unmapped TE-sign halves');

  // What is left is HONEST, recorded state: the four unmapped LED signs and the
  // six strands on the three unbound rope controllers. All INFO here, all
  // errors under --strict (the hardware gate).
  const policy = result.findings.filter((f) => f.strictOnly).map((f) => f.code).sort();
  assert.deepEqual(policy, new Array(10).fill('unpatched_marker'));
  // No `0.0.0.0` placeholder controller survives — the DMX one is gone.
  assert.deepEqual(result.findings.filter((f) => f.code === 'placeholder_controller'), []);
});

test('real scene titanic: the TE signs are LED, not DMX, everywhere the model can say so', async () => {
  const loaded = await loadScene('titanic');
  const signPixels = loaded.model.pixels.filter((p) => /^TeSignV3/.test(p.fixtureType || ''));
  assert.equal(signPixels.length, 148, 'two signs × (40 + 34) px');
  // The reclassification, mechanically: LED transport, no DMX footprint, and
  // the loud unpatched marker while no MarsinLED output owns them.
  assert.ok(signPixels.every((p) => p.type === 'led'), 'every sign pixel is type led');
  assert.ok(signPixels.every((p) => p.patch === null), 'no address until mapped');
  assert.ok(signPixels.every((p) => p.unpatched === true), 'loud unpatched marker');
  // The fixtureType strings are UNCHANGED, so every selector that names them
  // (pixel_map_view_defaults TE_SIGN_TYPES, the scene pixel_map_views panels)
  // still resolves — report 20260725_48 addendum 2 stays intact.
  const types = new Set(signPixels.map((p) => p.fixtureType));
  assert.deepEqual([...types].sort(), ['TeSignV3A40', 'TeSignV3B34']);
  // And no sign record survives in patches.yaml: an LED thing gets a record
  // only once it is patched (the strand contract).
  const records = Object.keys(loaded.patches.patches || {});
  assert.deepEqual(records.filter((n) => /TE Sign/.test(n)), []);
});

test('real scene titanic: --strict is stricter than the default gate', async () => {
  const loaded = await loadScene('titanic');
  const loose = checkSceneModelParity({ ...loaded, ...REAL_SCENE_SETUP });
  const strict = checkSceneModelParity({ ...loaded, ...REAL_SCENE_SETUP, strict: true });
  assert.ok(strict.stats.errors > loose.stats.errors,
    'every unpatched strand must be promoted to an error by the hardware gate');
});

// ── The TE sign pucks are RGBW — the SAME LEDs as the rope strands ───────
//
// Operator, 2026-07-31: *"sign is also RGBW, same lights as the ropes."* The
// definitions shipped as RGB (3 bytes/px) from their DMX-era authoring. At run
// time the owning MarsinLED output's `led.order` is what the exporter and
// patches.yaml actually read — for a sign exactly as for a strand — so a wrong
// declaration here never reached the wire, but it is the number a human reads
// when sizing a universe, and it is what `channel_mode` reports. Pinned so the
// generator can never quietly regress to 3 bytes.
test('TE sign definitions declare RGBW, 4 bytes per pixel, like every rope output', () => {
  const defs = loadFixtureDefs();
  const expected = { TeSignV3A40: 40, TeSignV3B34: 34 };
  for (const [type, pixelCount] of Object.entries(expected)) {
    const def = defs[type];
    assert.ok(def, `${type} must be registered`);
    assert.equal(def.bus, 'led', `${type} rides the LED bus`);
    assert.equal(def.pixels.length, pixelCount);
    assert.equal(def.footprint, pixelCount * 4,
      `${type} is ${pixelCount} px × 4 bytes (RGBW), not × 3`);
    def.pixels.forEach((px, i) => {
      assert.deepEqual(px.channels, {
        red: 4 * i + 1, green: 4 * i + 2, blue: 4 * i + 3, white: 4 * i + 4,
      }, `${type} pixel_${i + 1} is an RGBW quad`);
    });
  }
  // One whole sign (both halves on one MarsinLED output) is 296 ch — still
  // inside a single 512-channel universe.
  assert.equal(defs.TeSignV3A40.footprint + defs.TeSignV3B34.footprint, 296);
  assert.ok(296 <= 512);
});

test('the sign stride equals the stride every titanic LED controller runs', async () => {
  const defs = loadFixtureDefs();
  const { controllers } = await loadScene('titanic');
  const ledControllers = (controllers.controllers || [])
    .filter((c) => String(c.type).toUpperCase() === 'LED');
  assert.ok(ledControllers.length > 0, 'titanic has LED controllers');
  // Every rope output is RGBW/stride 4; the signs hang off the same kind of
  // output, so their per-pixel byte count must match — that is the whole
  // content of "same lights as the ropes".
  for (const c of ledControllers) {
    assert.equal((c.led || {}).order, 'RGBW', `${c.name} runs RGBW`);
    assert.equal((c.led || {}).stride, 4, `${c.name} strides 4 bytes/px`);
  }
  assert.equal(defs.TeSignV3A40.footprint / defs.TeSignV3A40.pixels.length, 4);
  assert.equal(defs.TeSignV3B34.footprint / defs.TeSignV3B34.pixels.length, 4);
});

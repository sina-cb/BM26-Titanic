/**
 * smokestack_mode_model.test.js — the PURE model behind the controller pane's
 * smokestack DMX ⇄ swarm section (src/dmx/smokestack_mode.js).
 *
 * The promises pinned here are the section's honesty contract:
 *   - a sweep nobody performed renders MODE ?, never a confident DMX/SWARM;
 *   - `safeToKillNetwork` is true ONLY for a to-swarm APPLY that exited 0 AND
 *     printed the exact `VERDICT: SAFE TO KILL NETWORK` line — a timeout, a
 *     truncated log, a missing verdict, or any other verdict is DO NOT KILL;
 *   - the APPLY gate demands a clean, same-action dry-run plus the exact
 *     typed phrase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../vendor/js-yaml/js-yaml.mjs';

import {
  SMOKESTACK_CONTROLLER_IDS,
  SMOKESTACK_LEADER_CONTROLLER_ID,
  SMOKESTACK_COORDINATE_FRAME,
  SMOKESTACK_SWARM_MODELS,
  MODE_DMX,
  MODE_SWARM,
  MODE_INVALID,
  MODE_UNKNOWN,
  MODE_UNREACHABLE,
  smokestackTargets,
  smokestackSwarmModel,
  smokestackBoardModel,
  smokestackFleetModel,
  smokestackFleetToggleModel,
  smokestackRepairModel,
  smokestackForceRecoveryModel,
  smokestackControllerTransitionModel,
  smokestackJobPhase,
  extractVerdictLine,
  extractJobErrorLine,
  jobOutcomeModel,
  applyGateModel,
  ACTION_TO_DMX,
  ACTION_TO_SWARM,
  ACTION_REPAIR_TO_DMX,
  ACTION_FORCE_TO_DMX,
  ACTION_FORCE_TO_SWARM,
  FORCE_DRY_RUN_FRESH_MS,
  FORCE_READBACK_MAX_AGE_MS,
  forceConfirmPhrase,
  forceFleetVerdict,
  preflightDigest,
  REPAIR_READBACK_MAX_AGE_MS,
  CONFIRM_PHRASES,
  VERDICT_SAFE_TO_KILL,
  VERDICT_DMX_OK,
  VERDICT_DRY_RUN,
} from '../src/dmx/smokestack_mode.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TITANIC_SCENE_DIR = path.join(TEST_DIR, '..', 'scenes', 'titanic');
const SMOKESTACK_PANEL_PATH = path.join(TEST_DIR, '..', 'src', 'gui', 'smokestack_panel.js');
const CONTROLLER_PANEL_PATH = path.join(TEST_DIR, '..', 'src', 'gui',
  'controller_map_editor.js');
const LED_DISCOVERY_PATH = path.join(TEST_DIR, '..', 'src', 'gui',
  'led_discovery_panel.js');
const STYLE_PATH = path.join(TEST_DIR, '..', 'style.css');

function ropePorts(frontUniverse, backUniverse, frontStrand, backStrand) {
  return [
    { port: 1, universe: frontUniverse, startAddress: 1, output: 1, chain: [frontStrand] },
    { port: 2, universe: backUniverse, startAddress: 1, output: 2, chain: [backStrand] },
  ];
}

// TEST-NET-1 addresses only (RFC 5737) — no test may name a routable host.
function ropeRegistry() {
  return {
    controllers: [
      { id: 3, name: 'LeftFrontWall', ip: '192.0.2.10', type: 'DMX', ports: [] },
      { id: 13, name: 'LeftLeftRopes', ip: '192.0.2.61', type: 'LED',
        ports: ropePorts(30, 31, 'Left_Front_Left', 'Left_Back_Left'),
        device: { vendor: 'marsinled', controllerId: 'ss_left_left' } },
      { id: 15, name: 'LeftRightRopes', ip: '192.0.2.62', type: 'LED',
        ports: ropePorts(32, 33, 'Left_Front_Right', 'Left_Back_Right'),
        device: { vendor: 'marsinled', controllerId: 'ss_left_right' } },
      { id: 22, name: 'RightTESign', ip: '192.0.2.63', type: 'LED', ports: [],
        device: { vendor: 'marsinled', provisional: true } },
      { id: 24, name: 'RightRightRopes', ip: '192.0.2.65', type: 'LED',
        ports: ropePorts(36, 37, 'Right_Front_Right', 'Right_Back_Right'),
        device: { vendor: 'marsinled', controllerId: 'ss_right_right' } },
      { id: 25, name: 'RightLeftRopes', ip: '192.0.2.66', type: 'LED',
        ports: ropePorts(34, 35, 'Right_Front_Left', 'Right_Back_Left'),
        device: { vendor: 'marsinled', controllerId: 'ss_right_left' } },
    ],
  };
}

function healthySwarmStatus(overrides = {}) {
  const status = {
    id: 13,
    reachable: true,
    detail: 'MarsinLED ss_left_left (angio4-new)',
    controllerId: 'ss_left_left',
    firmwareTag: '1.2.5',
    fps: 40,
    dmxEnabled: false,
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 900 },
    health: { configSource: 'primary', stagedPending: false, uptimeMs: 123456 },
    capabilities: { perOutputDmx: true },
    ...overrides,
  };
  if (overrides.dmxEnabled === true && overrides.swarm === undefined) {
    status.swarm = { ...status.swarm, enabled: false };
  }
  return status;
}

// ── Target selection ─────────────────────────────────────────────────────────

test('targets: four ropes use semantic order, never registry row/id/IP order', () => {
  const targets = smokestackTargets(ropeRegistry());
  assert.deepEqual(targets.map((t) => t.controllerId), [
    'ss_left_left', 'ss_left_right', 'ss_right_right', 'ss_right_left',
  ]);
  assert.deepEqual(targets.map((t) => t.id), [13, 15, 24, 25]);
  // DMX cards, unbound LED cards (TE sign) and non-rope ids never match.
  assert.equal(targets.some((t) => t.name === 'RightTESign'), false);

  const shuffled = ropeRegistry();
  shuffled.controllers = shuffled.controllers.reverse().map((controller, index) => ({
    ...controller,
    id: 900 + index,
  }));
  assert.deepEqual(smokestackTargets(shuffled).map((t) => t.controllerId),
    SMOKESTACK_CONTROLLER_IDS);
});

test('targets: the leader flag rides the recorded leader controllerId only', () => {
  const targets = smokestackTargets(ropeRegistry());
  const leaders = targets.filter((t) => t.expectedLeader);
  assert.equal(leaders.length, 1);
  assert.equal(leaders[0].controllerId, SMOKESTACK_LEADER_CONTROLLER_ID);
  assert.ok(SMOKESTACK_CONTROLLER_IDS.includes(SMOKESTACK_LEADER_CONTROLLER_ID));
});

test('targets: four explicit SWARM operator labels and filter tags never rename identity', () => {
  const targets = smokestackTargets(ropeRegistry());
  assert.deepEqual(targets.map((target) => target.operatorLabel), [
    'SWARM LeftLeft (.61)',
    'SWARM LeftRight (.62)',
    'SWARM RightRight (.65)',
    'SWARM RightLeft (.66)',
  ]);
  assert.deepEqual(targets.map((target) => target.filterTag),
    ['swarm', 'swarm', 'swarm', 'swarm']);
  assert.deepEqual(targets.map((target) => target.name),
    ['LeftLeftRopes', 'LeftRightRopes', 'RightRightRopes', 'RightLeftRopes']);
});

test('targets: a scene without ropes yields [] and renders no section', () => {
  assert.deepEqual(smokestackTargets({ controllers: [
    { id: 1, name: 'Bench', ip: '192.0.2.9', type: 'LED',
      device: { vendor: 'marsinled', controllerId: 'testbench' } },
  ] }), []);
  assert.deepEqual(smokestackTargets(null), []);
  assert.deepEqual(smokestackTargets({}), []);
});

test('targets: partial, duplicate, renamed, or misrouted semantic mappings fail loudly', () => {
  const cases = [];

  const partial = ropeRegistry();
  partial.controllers = partial.controllers.filter((controller) =>
    controller.device?.controllerId !== 'ss_right_left');
  cases.push([partial, /missing semantic controllerId.*ss_right_left/]);

  const duplicate = ropeRegistry();
  duplicate.controllers.push({ ...duplicate.controllers[1], id: 999 });
  cases.push([duplicate, /appears on more than one controller card/]);

  const renamed = ropeRegistry();
  renamed.controllers.find((controller) =>
    controller.device?.controllerId === 'ss_left_left').name = 'WrongRopes';
  cases.push([renamed, /expected semantic card 'LeftLeftRopes'/]);

  const misrouted = ropeRegistry();
  const output = misrouted.controllers.find((controller) =>
    controller.device?.controllerId === 'ss_right_right').ports[0];
  output.chain = ['Right_Front_Left'];
  cases.push([misrouted, /Output 1 must map only 'Right_Front_Right'/]);

  for (const [registry, message] of cases) {
    assert.throws(() => smokestackTargets(registry), message);
  }
});

test('targets: Titanic rope cards with zero recognized bindings fail instead of hiding', () => {
  for (const replacement of [undefined, 'wrong_semantic_id']) {
    const registry = ropeRegistry();
    for (const controller of registry.controllers.filter((candidate) =>
      candidate.name.endsWith('Ropes'))) {
      if (replacement === undefined) delete controller.device.controllerId;
      else controller.device.controllerId = replacement;
    }
    assert.throws(() => smokestackTargets(registry),
      /Titanic smokestack cards are present.*none has a recognized semantic controllerId/);
  }

  assert.deepEqual(smokestackTargets({ controllers: [
    { id: 1, name: 'Unrelated LEDs', ip: '192.0.2.20', type: 'LED',
      ports: [{ port: 1, output: 1, startAddress: 1, chain: ['Bench_Strand'] }],
      device: { vendor: 'marsinled', controllerId: 'unrelated' } },
  ] }), [], 'an unrelated scene must still hide the section');
});

// ── Controller-local SWARM geometry ─────────────────────────────────────────

test('swarm models: exact semantic placements and rope ranges are immutable BM facts', () => {
  assert.deepEqual(Object.fromEntries(SMOKESTACK_CONTROLLER_IDS.map((controllerId) => {
    const spec = SMOKESTACK_SWARM_MODELS[controllerId];
    return [controllerId, {
      placement: spec.placement,
      operatorSide: spec.operatorSide,
      outputs: spec.outputs.map((output) => [
        output.output,
        output.strand,
        output.modelRange,
        output.outputLocalRange,
      ]),
    }];
  })), {
    ss_left_left: {
      placement: 'LeftLeft', operatorSide: 'RIGHT',
      outputs: [
        [1, 'Left_Front_Left', [0, 39], [0, 39]],
        [2, 'Left_Back_Left', [40, 79], [0, 39]],
      ],
    },
    ss_left_right: {
      placement: 'LeftRight', operatorSide: 'RIGHT',
      outputs: [
        [1, 'Left_Front_Right', [0, 39], [0, 39]],
        [2, 'Left_Back_Right', [40, 79], [0, 39]],
      ],
    },
    ss_right_right: {
      placement: 'RightRight', operatorSide: 'LEFT',
      outputs: [
        [1, 'Right_Front_Right', [0, 39], [0, 39]],
        [2, 'Right_Back_Right', [40, 79], [0, 39]],
      ],
    },
    ss_right_left: {
      placement: 'RightLeft', operatorSide: 'LEFT',
      outputs: [
        [1, 'Right_Front_Left', [0, 39], [0, 39]],
        [2, 'Right_Back_Left', [40, 79], [0, 39]],
      ],
    },
  });
});

test('swarm models: 80 pixels preserve output-local reset and exact authored endpoints', () => {
  for (const controllerId of SMOKESTACK_CONTROLLER_IDS) {
    const model = smokestackSwarmModel(controllerId);
    assert.equal(model.modeScope, 'swarm_only');
    assert.equal(model.mappingPushChangesMode, false);
    assert.equal(model.coordinateFrame, SMOKESTACK_COORDINATE_FRAME);
    assert.equal(model.coordinateFrame.perControllerNormalization, false);
    assert.equal(model.pixelCount, 80);
    assert.equal(model.pixels.length, 80);
    assert.deepEqual(model.pixels.map((pixel) => pixel.modelIndex),
      Array.from({ length: 80 }, (_, index) => index));
    assert.deepEqual(model.pixels.filter((pixel) => pixel.output === 1)
      .map((pixel) => pixel.outputLocalIndex), Array.from({ length: 40 }, (_, index) => index));
    assert.deepEqual(model.pixels.filter((pixel) => pixel.output === 2)
      .map((pixel) => pixel.outputLocalIndex), Array.from({ length: 40 }, (_, index) => index));

    for (const output of model.outputs) {
      const first = model.pixels[output.modelRange[0]];
      const last = model.pixels[output.modelRange[1]];
      assert.deepEqual({ x: first.x, y: first.y, z: first.z }, output.start);
      assert.deepEqual({ x: last.x, y: last.y, z: last.z }, output.end);
      assert.equal(output.physicalDirectionVerified, false);
    }
  }
});

test('swarm models: normalized coordinates use one Titanic-global frame', () => {
  const left = smokestackSwarmModel('ss_left_left').pixels[0];
  const right = smokestackSwarmModel('ss_right_right').pixels[0];
  const xRule = SMOKESTACK_COORDINATE_FRAME.normalization.x;
  assert.equal(left.nx, (left.x - xRule.min) / xRule.span);
  assert.equal(right.nx, (right.x - xRule.min) / xRule.span);
  assert.notEqual(left.nx, 0, 'left controller must not normalize its own minimum to zero');
  assert.notEqual(right.nx, 1, 'right controller must not normalize its own maximum to one');
  assert.throws(() => smokestackSwarmModel('not_a_rope'), /Unknown controllerId/);
});

test('shipped Titanic scene matches the semantic models, exact IPs, ports, and geometry', () => {
  const controllers = yaml.load(fs.readFileSync(
    path.join(TITANIC_SCENE_DIR, 'controllers.yaml'), 'utf8'));
  const scene = yaml.load(fs.readFileSync(
    path.join(TITANIC_SCENE_DIR, 'scene_config.yaml'), 'utf8'));
  const targets = smokestackTargets(controllers);

  assert.deepEqual(targets.map((target) => [target.controllerId, target.ip]), [
    ['ss_left_left', '10.1.1.61'],
    ['ss_left_right', '10.1.1.62'],
    ['ss_right_right', '10.1.1.65'],
    ['ss_right_left', '10.1.1.66'],
  ]);

  const strands = new Map(scene.ledStrands.strands.map((strand) => [strand.name, strand]));
  for (const target of targets) {
    for (const output of target.swarmModel.outputs) {
      const strand = strands.get(output.strand);
      assert.ok(strand, `${output.strand} must exist in scene_config.yaml`);
      assert.equal(strand.ledCount, 40);
      assert.deepEqual(
        { x: strand.startX, y: strand.startY, z: strand.startZ },
        output.start,
        `${output.strand} pixel 0 endpoint drifted`,
      );
      assert.deepEqual(
        { x: strand.endX, y: strand.endY, z: strand.endZ },
        output.end,
        `${output.strand} pixel 39 endpoint drifted`,
      );
    }
  }
});

// ── Board glance model ───────────────────────────────────────────────────────

const follower = { id: 13, name: 'LeftLeftRopes', controllerId: 'ss_left_left',
  expectedLeader: false };
const leader = { id: 15, name: 'LeftRightRopes', controllerId: 'ss_left_right',
  expectedLeader: true };

test('board: no sweep answered yet renders MODE ? — never a confident mode', () => {
  const m = smokestackBoardModel(follower, null);
  assert.equal(m.mode, MODE_UNKNOWN);
  assert.match(m.detail, /no status sweep/);
});

test('board: unreachable is its own loud state', () => {
  const m = smokestackBoardModel(follower, { id: 13, reachable: false, detail: 'ETIMEDOUT' });
  assert.equal(m.mode, MODE_UNREACHABLE);
  assert.equal(m.modeLabel, 'UNREACHABLE');
});

test('board: dmx.enabled true = DMX, false = SWARM', () => {
  assert.equal(smokestackBoardModel(follower, healthySwarmStatus({ dmxEnabled: true })).mode,
    MODE_DMX);
  assert.equal(smokestackBoardModel(follower, healthySwarmStatus({ dmxEnabled: false })).mode,
    MODE_SWARM);
});

test('board: dual-enabled or dual-disabled is red MIXED/INVALID, never DMX/SWARM', () => {
  const dual = smokestackBoardModel(follower, healthySwarmStatus({
    dmxEnabled: true,
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 100 },
  }));
  assert.equal(dual.mode, MODE_INVALID);
  assert.equal(dual.modeLabel, 'MIXED/INVALID');
  assert.equal(dual.modeCls, 'smk-mode-invalid');
  assert.ok(dual.warnings.some((warning) => /DMX and SWARM are both enabled/.test(warning)));
  assert.ok(dual.switchBlockers.length > 0);

  const neither = smokestackBoardModel(follower, healthySwarmStatus({
    dmxEnabled: false,
    swarm: { enabled: false, isLeader: false, followState: 'OFF', lastBeaconMsAgo: null },
  }));
  assert.equal(neither.mode, MODE_INVALID);
  assert.ok(neither.warnings.some((warning) => /both disabled/.test(warning)));
});

test('board: reachable but unreadable config = MODE ? with a warning, never a guess', () => {
  const m = smokestackBoardModel(follower, healthySwarmStatus({ dmxEnabled: null }));
  assert.equal(m.mode, MODE_UNKNOWN);
  assert.ok(m.warnings.some((w) => /mode is unknown/.test(w)));
});

test('board: identity mismatch is a warning naming both ids', () => {
  const m = smokestackBoardModel(follower,
    healthySwarmStatus({ controllerId: 'ss_right_right' }));
  assert.ok(m.warnings.some((w) => /identity mismatch/.test(w)
    && w.includes('ss_right_right') && w.includes('ss_left_left')));
});

test('board: follower coherence needs FOLLOWING plus a fresh beacon', () => {
  const ok = smokestackBoardModel(follower, healthySwarmStatus());
  assert.equal(ok.roleOk, true);
  assert.match(ok.role, /FOLLOWING/);

  const stale = smokestackBoardModel(follower, healthySwarmStatus({
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 60000 },
  }));
  assert.equal(stale.roleOk, false);

  const off = smokestackBoardModel(follower, healthySwarmStatus({
    swarm: { enabled: true, isLeader: false, followState: 'OFF', lastBeaconMsAgo: null },
  }));
  assert.equal(off.roleOk, false);
  assert.match(off.role, /OFF/);
});

test('board: DMX role mismatch is readiness-only, never a live topology claim', () => {
  const dmxFollower = smokestackBoardModel(follower, healthySwarmStatus({
    dmxEnabled: true,
    swarm: { enabled: false, isLeader: true, followState: 'OFF', lastBeaconMsAgo: 60000 },
  }));
  assert.equal(dmxFollower.mode, MODE_DMX);
  assert.equal(dmxFollower.roleOk, false);
  assert.equal(dmxFollower.switchBlockers.length, 0);
  assert.ok(dmxFollower.warnings.some((warning) => /SWARM readiness warning/.test(warning)));
  assert.ok(dmxFollower.warnings.some((warning) => /not a live split-brain/.test(warning)));
  assert.equal(dmxFollower.warnings.some((warning) =>
    /LIVE SWARM TOPOLOGY FAILURE/.test(warning)), false);
});

test('board: an expected follower claiming leader is explicit split-brain risk', () => {
  const duplicateLeader = smokestackBoardModel(follower, healthySwarmStatus({
    swarm: { enabled: true, isLeader: true, followState: 'FOLLOWING', lastBeaconMsAgo: 500 },
  }));
  assert.equal(duplicateLeader.roleOk, false);
  assert.match(duplicateLeader.role, /CLAIMS LEADER/);
  assert.ok(duplicateLeader.warnings.some((warning) =>
    /LIVE SWARM TOPOLOGY FAILURE.*duplicate leader.*isLeader=true/.test(warning)));
});

test('board: stale live SWARM follower is an explicit topology failure', () => {
  const staleFollower = smokestackBoardModel(follower, healthySwarmStatus({
    dmxEnabled: false,
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 60000 },
  }));
  assert.equal(staleFollower.roleOk, false);
  assert.ok(staleFollower.warnings.some((warning) =>
    /LIVE SWARM TOPOLOGY FAILURE.*stale or missing follower coherence/.test(warning)));
});

test('board: the expected leader is judged on swarm.isLeader', () => {
  const active = smokestackBoardModel(leader, healthySwarmStatus({
    controllerId: 'ss_left_right',
    swarm: { enabled: true, isLeader: true, followState: null, lastBeaconMsAgo: null },
  }));
  assert.equal(active.roleOk, true);
  assert.match(active.role, /LEADER/);

  const inactive = smokestackBoardModel(leader, healthySwarmStatus({
    controllerId: 'ss_left_right',
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 500 },
  }));
  assert.equal(inactive.roleOk, false);
  assert.match(inactive.role, /not active/);
});

test('board: staged/degraded config and a missing perOutputDmx capability all warn', () => {
  const m = smokestackBoardModel(follower, healthySwarmStatus({
    health: { configSource: 'staged', stagedPending: true, uptimeMs: 5 },
    capabilities: { perOutputDmx: false },
  }));
  assert.ok(m.warnings.some((w) => /STAGED config is pending/.test(w)));
  assert.ok(m.warnings.some((w) => /configSource 'staged'/.test(w)));
  assert.ok(m.warnings.some((w) => /perOutputDmx/.test(w)));
});

// ── Fleet headline ───────────────────────────────────────────────────────────

test('fleet: uniform DMX and uniform SWARM read as uniform; anything else does not', () => {
  const mk = (mode, warnings = []) => ({ mode, warnings });
  assert.equal(smokestackFleetModel([mk(MODE_DMX), mk(MODE_DMX)]).text, 'ALL DMX');
  assert.equal(smokestackFleetModel([mk(MODE_DMX), mk(MODE_DMX)]).uniform, true);
  assert.equal(smokestackFleetModel([mk(MODE_SWARM), mk(MODE_SWARM)]).text, 'ALL SWARM');

  const mixed = smokestackFleetModel([mk(MODE_DMX), mk(MODE_SWARM)]);
  assert.match(mixed.text, /MIXED/);
  assert.equal(mixed.uniform, false);

  const partial = smokestackFleetModel([mk(MODE_DMX), mk(MODE_UNREACHABLE)]);
  assert.match(partial.text, /1 DMX/);
  assert.match(partial.text, /1 unreachable/);
  assert.equal(partial.uniform, false);

  const invalid = smokestackFleetModel([mk(MODE_DMX), mk(MODE_INVALID)]);
  assert.match(invalid.text, /MIXED\/INVALID/);
  assert.equal(invalid.cls, 'smk-fleet-bad');

  assert.match(smokestackFleetModel([mk(MODE_UNREACHABLE), mk(MODE_UNREACHABLE)]).text,
    /all 2 unreachable/);
});

test('fleet: a uniform fleet with warnings says so instead of a clean green', () => {
  const fleet = smokestackFleetModel([
    { mode: MODE_SWARM, warnings: ['staged config pending'] },
    { mode: MODE_SWARM, warnings: [] },
  ]);
  assert.match(fleet.text, /ALL SWARM \(1 warning/);
  assert.notEqual(fleet.cls, 'smk-fleet-ok');
});

test('fleet: a uniform mode with any failed role is non-green and non-uniform', () => {
  const fleet = smokestackFleetModel([
    { mode: MODE_SWARM, roleOk: true, warnings: [] },
    { mode: MODE_SWARM, roleOk: false, warnings: [] },
  ]);
  assert.match(fleet.text, /ALL SWARM.*1 role\/coherence failure/);
  assert.notEqual(fleet.cls, 'smk-fleet-ok');
  assert.equal(fleet.uniform, false);
});

// ── The one-button fleet direction ──────────────────────────────────────────

function toggleBoards(mode, { roleOk = true, switchBlockers = [] } = {}) {
  return SMOKESTACK_CONTROLLER_IDS.map(() => ({ mode, roleOk, switchBlockers, warnings: [] }));
}

test('fleet toggle: verified DMX selects one guarded switch-to-SWARM action', () => {
  const toggle = smokestackFleetToggleModel(toggleBoards(MODE_DMX));
  assert.deepEqual(toggle, {
    action: ACTION_TO_SWARM,
    label: 'Switch all to SWARM',
    enabled: true,
    reason: '',
  });

  const readinessOnly = toggleBoards(MODE_DMX, { roleOk: false });
  const warnedToggle = smokestackFleetToggleModel(readinessOnly);
  assert.equal(warnedToggle.action, ACTION_TO_SWARM,
    'saved DMX-mode role mismatch must not make direction ambiguous');
  assert.equal(warnedToggle.enabled, true);
  const fleet = smokestackFleetModel(readinessOnly);
  assert.equal(fleet.uniform, false);
  assert.notEqual(fleet.cls, 'smk-fleet-ok');
});

test('fleet toggle: healthy SWARM switches to DMX; unhealthy canonical SWARM recovers only to DMX',
  () => {
    const healthy = smokestackFleetToggleModel(toggleBoards(MODE_SWARM));
    assert.deepEqual(healthy, {
      action: ACTION_TO_DMX,
      label: 'Switch all to DMX',
      enabled: true,
      reason: '',
    });

    const unhealthy = smokestackFleetToggleModel(toggleBoards(MODE_SWARM, { roleOk: false }));
    assert.equal(unhealthy.action, ACTION_TO_DMX);
    assert.equal(unhealthy.enabled, true);
    assert.equal(unhealthy.label, 'Recover all to DMX');
    assert.match(unhealthy.reason, /guarded exact-four DMX recovery only/);
    // Honest about what is still enforced downstream: the toggle unblocks the
    // DIRECTION, it does not promise the CLI will accept the fleet plan.
    assert.match(unhealthy.reason, /asset\/identity contract still applies/);
  });

test('fleet toggle: split-brain, absent leader, stale and DETACHED followers offer DMX only',
  () => {
    const targets = smokestackTargets(ropeRegistry());
    const healthyStatuses = new Map(targets.map((target) => {
      const expectedLeader = target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID;
      return [target.id, healthySwarmStatus({
        id: target.id,
        controllerId: target.controllerId,
        swarm: {
          enabled: true,
          isLeader: expectedLeader,
          followState: expectedLeader ? 'OFF' : 'FOLLOWING',
          lastBeaconMsAgo: expectedLeader ? null : 500,
        },
      })];
    }));
    const cases = [
      ['split-brain', targets[0], {
        enabled: true, isLeader: true, followState: 'FOLLOWING', lastBeaconMsAgo: 500,
      }],
      ['absent leader', targets.find((target) => target.expectedLeader), {
        enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 500,
      }],
      ['stale follower', targets[2], {
        enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 60000,
      }],
      // The live playa failure: a fresh beacon but a sticky DETACHED follower.
      ['DETACHED follower', targets[0], {
        enabled: true, isLeader: false, followState: 'DETACHED', lastBeaconMsAgo: 800,
      }],
    ];
    for (const [name, failedTarget, swarm] of cases) {
      const statuses = new Map(healthyStatuses);
      statuses.set(failedTarget.id, { ...statuses.get(failedTarget.id), swarm });
      const boards = targets.map((target) => smokestackBoardModel(target, statuses.get(target.id)));
      const fleet = smokestackFleetModel(boards);
      const toggle = smokestackFleetToggleModel(boards);
      assert.notEqual(fleet.cls, 'smk-fleet-ok', `${name} cannot be green`);
      assert.equal(fleet.uniform, false, `${name} cannot be uniform healthy`);
      assert.equal(toggle.action, ACTION_TO_DMX, `${name} recovery direction`);
      assert.notEqual(toggle.action, ACTION_TO_SWARM, `${name} must never offer TO SWARM`);
      assert.equal(toggle.enabled, true, `${name} guarded recovery enabled`);
      assert.equal(toggle.label, 'Recover all to DMX');
    }
  });

test('fleet toggle: unhealthy SWARM recovery remains blocked by identity/config/capability blockers',
  () => {
    const boards = toggleBoards(MODE_SWARM, { roleOk: false });
    boards[2] = { ...boards[2], switchBlockers: ['identity mismatch'] };
    const toggle = smokestackFleetToggleModel(boards);
    assert.equal(toggle.action, null);
    assert.equal(toggle.enabled, false);
    assert.match(toggle.label, /verification failed/);
    assert.match(toggle.reason, /identity mismatch/);
  });

test('fleet toggle: a readable mixed fleet has exactly one safe recovery to DMX', () => {
  const toggle = smokestackFleetToggleModel([
    ...toggleBoards(MODE_DMX).slice(0, 2),
    ...toggleBoards(MODE_SWARM).slice(0, 2),
  ]);
  assert.deepEqual(toggle, {
    action: ACTION_TO_DMX,
    label: 'Recover all to DMX',
    enabled: true,
    reason: '2 DMX · 2 SWARM — guarded full-fleet DMX recovery',
  });
});

test('fleet toggle: mixed recovery stays blocked when any board verification fails', () => {
  const boards = [
    ...toggleBoards(MODE_DMX).slice(0, 2),
    ...toggleBoards(MODE_SWARM).slice(0, 2),
  ];
  boards[1] = { ...boards[1], switchBlockers: ['identity mismatch'] };
  const toggle = smokestackFleetToggleModel(boards);
  assert.equal(toggle.action, null);
  assert.equal(toggle.enabled, false);
  assert.match(toggle.label, /verification failed/);
  assert.match(toggle.reason, /identity mismatch/);
});

test('fleet toggle: invalid, unknown, unreachable, incomplete and blocked never guess', () => {
  const cases = [
    [[...toggleBoards(MODE_DMX).slice(0, 3),
      { mode: MODE_INVALID, roleOk: false, switchBlockers: ['dual enabled'] }],
    /MIXED\/INVALID fleet/],
    [[...toggleBoards(MODE_DMX).slice(0, 3),
      { mode: MODE_UNKNOWN, roleOk: false, switchBlockers: [] }], /state unknown/],
    [[...toggleBoards(MODE_SWARM).slice(0, 3),
      { mode: MODE_UNREACHABLE, roleOk: false, switchBlockers: [] }], /state unknown/],
    [toggleBoards(MODE_DMX).slice(0, 3), /state invalid/],
    [toggleBoards(MODE_DMX, { switchBlockers: ['identity mismatch'] }),
      /verification failed/],
  ];
  for (const [boards, label] of cases) {
    const toggle = smokestackFleetToggleModel(boards);
    assert.equal(toggle.action, null);
    assert.equal(toggle.enabled, false);
    assert.match(toggle.label, label);
    assert.ok(toggle.reason.length > 0);
  }
});

function matrixStatuses(targets, mode, overrides = new Map()) {
  const dmxMappings = {
    ss_left_left: [[30, 1], [31, 1]],
    ss_left_right: [[32, 1], [33, 1]],
    ss_right_right: [[36, 1], [37, 1]],
    ss_right_left: [[34, 1], [35, 1]],
  };
  return new Map(targets.map((target) => {
    const expectedLeader = target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID;
    const override = overrides.get(target.controllerId) || {};
    const status = healthySwarmStatus({
      id: target.id,
      controllerId: target.controllerId,
      firmwareTag: '1.2.5',
      dmxEnabled: mode === MODE_DMX,
      swarm: mode === MODE_DMX ? {
        enabled: false,
        isLeader: expectedLeader,
        followState: expectedLeader ? 'OFF' : 'DISABLED',
        lastBeaconMsAgo: null,
      } : {
        enabled: true,
        isLeader: expectedLeader,
        followState: expectedLeader ? 'OFF' : 'FOLLOWING',
        lastBeaconMsAgo: expectedLeader ? null : 500,
      },
      activePattern: '/patterns/titanic_swarm_pattern.js',
      activeMap: `/models/${target.controllerId}_rope.json`,
      outputs: dmxMappings[target.controllerId].map(([universe, startAddress], index) => ({
        output: index + 1,
        universe,
        startAddress,
        pixelCount: 40,
        colorOrder: 'RGBW',
      })),
      ...override,
    });
    return [target.id, status];
  }));
}

function matrixBoards(targets, statuses) {
  return targets.map((target) => smokestackBoardModel(target, statuses.get(target.id)));
}

test('workflow matrix: five DMX→SWARM→DMX cycles preserve exact 1.2.5 identities and maps', () => {
  const targets = smokestackTargets(ropeRegistry());
  for (let cycle = 1; cycle <= 5; cycle++) {
    const dmxStatuses = matrixStatuses(targets, MODE_DMX);
    assert.deepEqual(smokestackFleetToggleModel(matrixBoards(targets, dmxStatuses)), {
      action: ACTION_TO_SWARM,
      label: 'Switch all to SWARM',
      enabled: true,
      reason: '',
    }, `cycle ${cycle} DMX baseline`);

    const swarmStatuses = matrixStatuses(targets, MODE_SWARM);
    const swarmBoards = matrixBoards(targets, swarmStatuses);
    assert.equal(smokestackFleetModel(swarmBoards).text, 'ALL SWARM', `cycle ${cycle}`);
    assert.equal(swarmBoards.filter((board) => /LEADER \(beaconing\)/.test(board.role)).length,
      1, `cycle ${cycle} sole leader`);
    assert.equal(swarmBoards.filter((board) => /FOLLOWING/.test(board.role)).length,
      3, `cycle ${cycle} followers`);
    assert.equal(smokestackFleetToggleModel(swarmBoards).action, ACTION_TO_DMX);

    for (const target of targets) {
      const status = swarmStatuses.get(target.id);
      assert.equal(status.firmwareTag, '1.2.5');
      assert.equal(status.controllerId, target.controllerId);
      assert.deepEqual(status.outputs.map((output) => [output.universe, output.startAddress]),
        {
          ss_left_left: [[30, 1], [31, 1]],
          ss_left_right: [[32, 1], [33, 1]],
          ss_right_right: [[36, 1], [37, 1]],
          ss_right_left: [[34, 1], [35, 1]],
        }[target.controllerId]);
    }

    const finalDmx = matrixBoards(targets, matrixStatuses(targets, MODE_DMX));
    assert.equal(smokestackFleetModel(finalDmx).text, 'ALL DMX', `cycle ${cycle} final DMX`);
  }
});

test('workflow healing: follower drift and leader dual-mode recover through exact DMX baseline', () => {
  const targets = smokestackTargets(ropeRegistry());
  const followerDrift = matrixStatuses(targets, MODE_SWARM, new Map([
    ['ss_right_right', {
      dmxEnabled: true,
      swarm: { enabled: false, isLeader: false, followState: 'DISABLED', lastBeaconMsAgo: null },
    }],
  ]));
  const followerRecovery = smokestackFleetToggleModel(matrixBoards(targets, followerDrift));
  assert.equal(followerRecovery.action, ACTION_TO_DMX);
  assert.equal(followerRecovery.label, 'Recover all to DMX');

  const allDmx = matrixStatuses(targets, MODE_DMX);
  assert.equal(smokestackFleetToggleModel(matrixBoards(targets, allDmx)).action, ACTION_TO_SWARM);
  const healedSwarm = matrixBoards(targets, matrixStatuses(targets, MODE_SWARM));
  assert.equal(smokestackFleetModel(healedSwarm).text, 'ALL SWARM');
  assert.equal(healedSwarm.filter((board) => /LEADER \(beaconing\)/.test(board.role)).length, 1);

  const leaderInvalid = matrixStatuses(targets, MODE_SWARM, new Map([
    [SMOKESTACK_LEADER_CONTROLLER_ID, {
      dmxEnabled: true,
      swarm: { enabled: true, isLeader: true, followState: 'OFF', lastBeaconMsAgo: null },
    }],
  ]));
  const readback = {
    sweptAt: 1000,
    resultIds: new Set(targets.map((target) => target.id)),
  };
  const repair = smokestackRepairModel(targets, leaderInvalid, readback, 1000);
  assert.equal(repair.enabled, true);
  assert.deepEqual(repair.targetIds, [SMOKESTACK_LEADER_CONTROLLER_ID]);
  assert.equal(repair.action, ACTION_REPAIR_TO_DMX);

  const leaderToDmx = matrixStatuses(targets, MODE_SWARM, new Map([
    [SMOKESTACK_LEADER_CONTROLLER_ID, {
      dmxEnabled: true,
      swarm: { enabled: false, isLeader: true, followState: 'OFF', lastBeaconMsAgo: null },
    }],
  ]));
  assert.equal(smokestackFleetToggleModel(matrixBoards(targets, leaderToDmx)).action,
    ACTION_TO_DMX);
  const finalSwarm = matrixBoards(targets, matrixStatuses(targets, MODE_SWARM));
  assert.equal(finalSwarm.filter((board) => /LEADER \(beaconing\)/.test(board.role)).length, 1);
  assert.equal(finalSwarm.filter((board) => /FOLLOWING/.test(board.role)).length, 3);
});

// ── Contextual exact-controller repair ──────────────────────────────────────

function repairFixture(invalidControllerIds = []) {
  const targets = smokestackTargets(ropeRegistry());
  const statuses = new Map(targets.map((target) => {
    const invalid = invalidControllerIds.includes(target.controllerId);
    return [target.id, healthySwarmStatus({
      id: target.id,
      controllerId: target.controllerId,
      dmxEnabled: true,
      swarm: {
        enabled: invalid,
        isLeader: false,
        followState: invalid ? 'FOLLOWING' : 'DISABLED',
        lastBeaconMsAgo: invalid ? 100 : null,
      },
    })];
  }));
  return { targets, statuses };
}

test('repair model: freezes only invalid semantic IDs and excludes healthy rows', () => {
  const { targets, statuses } = repairFixture(['ss_right_left', 'ss_left_right']);
  const now = 50000;
  const model = smokestackRepairModel(targets, statuses, {
    sweptAt: now - 100,
    resultIds: new Set(targets.map((target) => target.id)),
  }, now);
  assert.equal(model.visible, true);
  assert.equal(model.enabled, true);
  assert.equal(model.action, ACTION_REPAIR_TO_DMX);
  assert.equal(model.label, 'Repair 2 controller(s) to DMX');
  assert.deepEqual(model.targetIds, ['ss_left_right', 'ss_right_left']);
  assert.equal(model.rows.get('ss_left_right').label, 'repair target · DMX');
  assert.equal(model.rows.get('ss_left_left').label, 'excluded · healthy');

  const healthy = repairFixture([]);
  assert.equal(smokestackRepairModel(healthy.targets, healthy.statuses, {
    sweptAt: now,
    resultIds: new Set(healthy.targets.map((target) => target.id)),
  }, now).visible, false);
});

test('repair model: stale, sweeping, missing, unreachable, and bad identity readbacks block', () => {
  const { targets, statuses } = repairFixture(['ss_left_right']);
  const allIds = new Set(targets.map((target) => target.id));
  const now = 100000;
  const cases = [
    [{ sweptAt: now - REPAIR_READBACK_MAX_AGE_MS - 1, resultIds: allIds }, /stale/],
    [{ sweptAt: now, resultIds: allIds, sweeping: true }, /still running/],
    [{ sweptAt: now, resultIds: new Set([...allIds].slice(1)) }, /missing from readback/],
  ];
  for (const [readback, reason] of cases) {
    const model = smokestackRepairModel(targets, statuses, readback, now);
    assert.equal(model.visible, true);
    assert.equal(model.enabled, false);
    assert.match(model.reason, reason);
  }

  const brokenTarget = targets.find((target) => target.controllerId === 'ss_left_right');
  statuses.set(brokenTarget.id, { id: brokenTarget.id, reachable: false });
  assert.match(smokestackRepairModel(targets, statuses, {
    sweptAt: now, resultIds: allIds,
  }, now).reason, /unreachable/);
  statuses.set(brokenTarget.id, healthySwarmStatus({
    id: brokenTarget.id,
    controllerId: 'wrong_identity',
    dmxEnabled: true,
    swarm: { enabled: true },
  }));
  assert.match(smokestackRepairModel(targets, statuses, {
    sweptAt: now, resultIds: allIds,
  }, now).reason, /identity unknown or mismatched/);
});

// ── Verdict line extraction ──────────────────────────────────────────────────

test('verdict extraction: line-anchored, last one wins, absent is null', () => {
  assert.equal(extractVerdictLine('no verdict here'), null);
  assert.equal(extractVerdictLine(null), null);
  assert.equal(extractVerdictLine('table…\nVERDICT: OK\n'), 'VERDICT: OK');
  // A body echo containing the words mid-line must not count.
  assert.equal(extractVerdictLine('note: VERDICT: SAFE TO KILL NETWORK appears mid-line'), null);
  assert.equal(
    extractVerdictLine('VERDICT: DRY RUN - no changes made\nlater…\nVERDICT: SAFE TO KILL NETWORK'),
    VERDICT_SAFE_TO_KILL);
});

test('job errors: a named CLI refusal outranks a bare non-zero exit', () => {
  const output = 'REFUSED: fleet preflight found invalid deployment identities\nfix the registry\n';
  assert.equal(extractJobErrorLine(output),
    'REFUSED: fleet preflight found invalid deployment identities');
  const outcome = jobOutcomeModel(doneJob({
    apply: false, exitCode: 1, verdictLine: null, output,
  }));
  assert.match(outcome.headline, /fleet preflight found invalid deployment identities/);
  assert.doesNotMatch(outcome.headline, /exited with code/);
});

// ── Job outcome — the DO-NOT-KILL contract ───────────────────────────────────

function doneJob(overrides = {}) {
  return {
    action: ACTION_TO_SWARM, apply: true, state: 'done', exitCode: 0,
    timedOut: false, outputTruncated: false, verdictLine: VERDICT_SAFE_TO_KILL,
    planFingerprint: 'c'.repeat(64),
    ...overrides,
  };
}

test('outcome: to-swarm apply is SAFE only on exit 0 + the exact verdict line', () => {
  const safe = jobOutcomeModel(doneJob());
  assert.equal(safe.kind, 'safe_to_kill');
  assert.equal(safe.safeToKillNetwork, true);
});

test('outcome: every degraded to-swarm apply is DO NOT KILL with the reason named', () => {
  const cases = [
    [doneJob({ exitCode: 1, verdictLine: 'VERDICT: NOT SAFE - 1 board(s) failed' }), /NOT SAFE/],
    [doneJob({ verdictLine: null }), /no verdict line/],
    [doneJob({ verdictLine: 'VERDICT: OK' }), /VERDICT: OK/],
    [doneJob({ timedOut: true }), /TIMED OUT/],
    [doneJob({ outputTruncated: true }), /truncated/],
    [doneJob({ exitCode: 1 }), /exited with code 1/],
  ];
  for (const [job, reasonRe] of cases) {
    const outcome = jobOutcomeModel(job);
    assert.equal(outcome.kind, 'do_not_kill', JSON.stringify(job));
    assert.equal(outcome.safeToKillNetwork, false);
    assert.match(outcome.headline, /DO NOT KILL THE NETWORK/);
    assert.match(outcome.headline, reasonRe);
  }
});

test('outcome: a running job is never safe', () => {
  assert.equal(jobOutcomeModel({ ...doneJob(), state: 'running' }).safeToKillNetwork, false);
  assert.equal(jobOutcomeModel(null).safeToKillNetwork, false);
});

test('outcome: to-dmx apply verifies on VERDICT: OK, fails loudly otherwise', () => {
  const ok = jobOutcomeModel(doneJob({ action: ACTION_TO_DMX, verdictLine: VERDICT_DMX_OK }));
  assert.equal(ok.kind, 'dmx_ok');
  assert.equal(ok.safeToKillNetwork, false);

  const failed = jobOutcomeModel(doneJob({
    action: ACTION_TO_DMX, exitCode: 1, verdictLine: 'VERDICT: FAILED - 2 board(s) failed' }));
  assert.equal(failed.kind, 'apply_failed');
  assert.match(failed.headline, /NOT verified/);
});

test('repair outcome and transitions trust only the frozen targeted set', () => {
  const targets = smokestackTargets(ropeRegistry());
  const target = targets[1];
  const excluded = targets[0];
  const job = doneJob({
    id: 'repair-1',
    action: ACTION_REPAIR_TO_DMX,
    targetIds: [target.controllerId],
    verdictLine: VERDICT_DMX_OK,
  });
  assert.equal(jobOutcomeModel(job).kind, 'repair_ok');
  assert.equal(smokestackJobPhase(job), 'COMPLETE');
  const readback = { jobId: job.id, state: 'done', resultIds: new Set([target.id, excluded.id]) };
  const dmx = healthySwarmStatus({
    id: target.id, controllerId: target.controllerId, dmxEnabled: true,
  });
  assert.match(smokestackControllerTransitionModel(target, job, dmx, readback).label,
    /^verified · readback DMX/);
  assert.match(smokestackControllerTransitionModel(excluded, job,
    healthySwarmStatus({ id: excluded.id, controllerId: excluded.controllerId,
      dmxEnabled: true }), readback).label, /^excluded · healthy/);
  assert.equal(smokestackControllerTransitionModel(target,
    { ...job, targetIds: undefined }, dmx, readback).cls, 'smk-transition-danger');
  assert.equal(jobOutcomeModel({ ...job, verdictLine: null }).kind, 'repair_failed');
});

test('outcome: dry-runs report plan-passed / refused, never a kill verdict', () => {
  const ok = jobOutcomeModel(doneJob({ apply: false,
    verdictLine: VERDICT_DRY_RUN }));
  assert.equal(ok.kind, 'dry_run_ok');
  assert.equal(ok.safeToKillNetwork, false);

  const refused = jobOutcomeModel(doneJob({ apply: false, exitCode: 1,
    verdictLine: 'VERDICT: REFUSED PRE-FLIGHT - 1 board(s)' }));
  assert.equal(refused.kind, 'dry_run_refused');
  assert.match(refused.headline, /Nothing was written/);
});

test('outcome: exit-zero dry-run still refuses a missing or wrong trusted verdict', () => {
  for (const verdictLine of [null, VERDICT_DMX_OK, VERDICT_SAFE_TO_KILL]) {
    const outcome = jobOutcomeModel(doneJob({ apply: false, verdictLine }));
    assert.equal(outcome.kind, 'dry_run_refused');
    assert.equal(outcome.safeToKillNetwork, false);
    assert.match(outcome.headline, /Dry-run REFUSED/);
  }
});

test('controller transition: refused dry-run shows no writes plus exact final readback', () => {
  const targets = smokestackTargets(ropeRegistry());
  const left = targets[0];
  const offline = targets[1];
  const job = doneJob({
    id: 'dry-1', apply: false, exitCode: 1, verdictLine: null,
    output: 'REFUSED: fleet preflight failed\n',
  });
  const readback = { jobId: job.id, state: 'done', resultIds: new Set([left.id, offline.id]) };
  const dmxStatus = healthySwarmStatus({
    id: left.id, controllerId: left.controllerId, dmxEnabled: true,
  });
  const leftModel = smokestackControllerTransitionModel(left, job, dmxStatus, readback);
  assert.match(leftModel.label, /preflight failed · no writes · readback DMX/);
  const offlineModel = smokestackControllerTransitionModel(offline, job, {
    id: offline.id, reachable: false, detail: 'request timed out',
  }, readback);
  assert.match(offlineModel.label, /failed readback · unreachable/);
});

test('controller transition: exit zero alone never becomes verified', () => {
  const target = smokestackTargets(ropeRegistry())[0];
  const status = healthySwarmStatus({ id: target.id, controllerId: target.controllerId });
  const job = doneJob({ id: 'apply-1', verdictLine: null });
  const readback = { jobId: job.id, state: 'done', resultIds: new Set([target.id]) };
  const model = smokestackControllerTransitionModel(target, job, status, readback);
  assert.doesNotMatch(model.label, /^verified/);
  assert.match(model.label, /unknown after failed apply/);
  assert.equal(model.cls, 'smk-transition-danger');
});

test('controller transition: trusted verdict plus matching readback verifies both directions', () => {
  const target = smokestackTargets(ropeRegistry())[0];
  const readback = { jobId: 'apply-2', state: 'done', resultIds: new Set([target.id]) };
  const swarm = smokestackControllerTransitionModel(target,
    doneJob({ id: 'apply-2' }),
    healthySwarmStatus({ id: target.id, controllerId: target.controllerId }), readback);
  assert.match(swarm.label, /^verified · readback SWARM/);

  const dmx = smokestackControllerTransitionModel(target,
    doneJob({ id: 'apply-2', action: ACTION_TO_DMX, verdictLine: VERDICT_DMX_OK }),
    healthySwarmStatus({ id: target.id, controllerId: target.controllerId, dmxEnabled: true }),
    readback);
  assert.match(dmx.label, /^verified · readback DMX/);
});

test('controller transition: to-DMX verdict is contradicted by dual-enabled readback', () => {
  const target = smokestackTargets(ropeRegistry())[0];
  const job = doneJob({ id: 'apply-dual', action: ACTION_TO_DMX, verdictLine: VERDICT_DMX_OK });
  const readback = { jobId: job.id, state: 'done', resultIds: new Set([target.id]) };
  const status = healthySwarmStatus({
    id: target.id,
    controllerId: target.controllerId,
    dmxEnabled: true,
    swarm: { enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 100 },
  });
  const model = smokestackControllerTransitionModel(target, job, status, readback);
  assert.equal(model.label, 'failed readback · MIXED/INVALID');
  assert.equal(model.cls, 'smk-transition-danger');
});

test('controller transition: explicit per-controller rollback is preserved after failed apply', () => {
  const target = smokestackTargets(ropeRegistry())[0];
  const job = doneJob({
    id: 'apply-3', exitCode: 1, verdictLine: null,
    output: `${target.controllerId}: restored previous DMX configuration\nERROR: apply failed\n`,
  });
  const readback = { jobId: job.id, state: 'done', resultIds: new Set([target.id]) };
  const model = smokestackControllerTransitionModel(target, job,
    healthySwarmStatus({ id: target.id, controllerId: target.controllerId, dmxEnabled: true }),
    readback);
  assert.match(model.label, /^restored · readback DMX/);
});

test('job phase: apply progress surfaces reboot/restore and completion failure', () => {
  assert.equal(smokestackJobPhase({ ...doneJob(), state: 'running', output: 'waiting for reboot' }),
    'REBOOTING');
  assert.equal(smokestackJobPhase({ ...doneJob(), state: 'running',
    output: 'rolling back changed controllers' }), 'RESTORING');
  assert.equal(smokestackJobPhase(doneJob()), 'COMPLETE');
  assert.equal(smokestackJobPhase(doneJob({ exitCode: 1, verdictLine: null })), 'FAILED');
});

// ── The APPLY gate ───────────────────────────────────────────────────────────

test('apply gate: clean same-action dry-run + the exact phrase, nothing less', () => {
  const dryRun = {
    action: ACTION_TO_SWARM,
    apply: false,
    state: 'done',
    exitCode: 0,
    timedOut: false,
    outputTruncated: false,
    verdictLine: VERDICT_DRY_RUN,
    planFingerprint: 'c'.repeat(64),
  };
  assert.deepEqual(CONFIRM_PHRASES, {
    'to-dmx': 'SWITCH',
    'to-swarm': 'SWITCH',
    'repair-to-dmx': 'SWITCH',
  });
  assert.equal(applyGateModel(dryRun, ACTION_TO_SWARM, 'SWITCH').allowed, true);
  assert.equal(applyGateModel({ ...dryRun, action: ACTION_REPAIR_TO_DMX },
    ACTION_REPAIR_TO_DMX, 'SWITCH').allowed, true);

  // No/other dry-run.
  assert.equal(applyGateModel(null, ACTION_TO_SWARM, 'SWITCH').allowed, false);
  assert.equal(
    applyGateModel({ ...dryRun, action: ACTION_TO_DMX }, ACTION_TO_SWARM, 'SWITCH')
      .allowed, false);
  assert.equal(applyGateModel({ ...dryRun, apply: true }, ACTION_TO_SWARM, 'SWITCH')
    .allowed, false);
  // Not finished / refused.
  assert.equal(applyGateModel({ ...dryRun, state: 'running' }, ACTION_TO_SWARM, 'SWITCH')
    .allowed, false);
  assert.equal(applyGateModel({ ...dryRun, exitCode: 1 }, ACTION_TO_SWARM, 'SWITCH')
    .allowed, false);
  // The shared phrase is still exact: case, whitespace and old directional
  // text must never arm either action.
  for (const phrase of ['switch', 'SWITCH ', 'SWITCH TO SWARM', 'SWITCH TO DMX']) {
    assert.equal(applyGateModel(dryRun, ACTION_TO_SWARM, phrase).allowed, false);
  }
  // Exit zero does not arm APPLY when the captured run lacks the trusted
  // no-write verdict or its output integrity is compromised.
  assert.equal(applyGateModel({ ...dryRun, verdictLine: null }, ACTION_TO_SWARM,
    CONFIRM_PHRASES[ACTION_TO_SWARM]).allowed, false);
  assert.equal(applyGateModel({ ...dryRun, verdictLine: VERDICT_DMX_OK }, ACTION_TO_SWARM,
    CONFIRM_PHRASES[ACTION_TO_SWARM]).allowed, false);
  assert.equal(applyGateModel({ ...dryRun, outputTruncated: true }, ACTION_TO_SWARM,
    CONFIRM_PHRASES[ACTION_TO_SWARM]).allowed, false);
  assert.equal(applyGateModel({ ...dryRun, planFingerprint: null }, ACTION_TO_SWARM,
    CONFIRM_PHRASES[ACTION_TO_SWARM]).allowed, false);
  assert.equal(applyGateModel({ ...dryRun, planFingerprint: 'A'.repeat(64) }, ACTION_TO_SWARM,
    CONFIRM_PHRASES[ACTION_TO_SWARM]).allowed, false);
});

test('panel: compact keyed section preserves safety controls and stable scroll', () => {
  const source = fs.readFileSync(SMOKESTACK_PANEL_PATH, 'utf8');
  assert.match(source, /inputLabel\.htmlFor = inputId/);
  assert.match(source, /sectionRefs\.toggleBtn\.setAttribute\('aria-expanded'/);
  assert.match(source, /fleetStatus\.setAttribute\('role', 'status'\)/);
  assert.match(source, /verdict\.setAttribute\('role', isDanger \? 'alert' : 'status'\)/);
  assert.match(source, /gateNote\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(source, /FINAL READBACK FAILED — fleet is NOT verified/);
  assert.match(source, /smokestackFleetToggleModel\(boardModels\)/);
  assert.match(source, /smk-switch-btn smk-switch-primary/);
  assert.equal((source.match(/smk-switch-btn smk-switch-primary/g) || []).length, 1,
    'the section must create exactly one primary fleet button');
  assert.doesNotMatch(source, /for \(const action of \[ACTION_TO_DMX, ACTION_TO_SWARM\]\)/,
    'the panel must render one derived fleet action, never two direction buttons');
  assert.match(source, /createCompactRows\(targets\)/);
  assert.match(source, /target\.operatorLabel/);
  assert.match(source, /row\.dataset\.filterTags = target\.filterTag/);
  assert.match(source, /createAdvancedDetails\(targets\)/);
  assert.match(source, /el\('summary', 'smk-advanced-summary', 'Advanced details'\)/);
  assert.match(source, /let advancedOpen = false/,
    'the single Advanced details disclosure must be collapsed by default');
  assert.match(source, /preserveMainScroll\(\(\) => updateSection\(lastTargets\)\)/);
  assert.match(source, /if \(!containerEl \|\| targetSignature !== nextSignature\)/,
    'parent renders must reuse the keyed section while the four targets are unchanged');
  assert.doesNotMatch(source, /group\.replaceChildren\(/,
    'status and job updates must never replace the section or parent DOM');
  assert.match(source,
    /Switch unavailable — deployment source not provisioned\./,
    'missing provisioning must remain one short disabled-button reason');
  assert.match(source, /queuePostJobReadback\(body\.job\)/,
    'every completed dry-run/apply must queue one bounded four-controller readback');
  assert.match(source, /const postJobReadbacks = new Set\(\)/,
    'a completed job must never trigger repeated readback traffic');
  assert.match(source, /smk-job-banner/);
  assert.match(source, /smokestackRepairModel\(targets, statusResults/);
  assert.match(source, /Repair .* controller\(s\) to DMX|repairModel\.label/);
  assert.match(source, /sameTargetIds\(sectionRefs\.repairModel\.targetIds, flow\.targetIds\)/,
    'apply must retain the exact frozen repair target set from dry-run');
  assert.match(source, /payload\.targetIds = frozenTargetIds/);
  assert.match(source, /scheduleRepairFreshnessRepaint\(\)/,
    'repair eligibility must expire in-place without another network sweep');
  assert.match(source, /repairModel\.rows\.get\(target\.controllerId\)/,
    'each semantic row must show repair-target or healthy-excluded eligibility');
  assert.match(source, /Trusted verdict: NONE/,
    'missing or wrong verdicts must remain prominent rather than inferred from exit status');
  assert.match(source, /smokestackControllerTransitionModel/);
});

test('panel: automatic controller reads paint in place and never rebuild the scroller', () => {
  const controllerSource = fs.readFileSync(CONTROLLER_PANEL_PATH, 'utf8');
  const probeStart = controllerSource.indexOf('export function refreshControllerStatuses(');
  const probeEnd = controllerSource.indexOf('/** Start/stop the auto-sweep', probeStart);
  const probeSource = controllerSource.slice(probeStart, probeEnd);
  assert.ok(probeStart >= 0 && probeEnd > probeStart);
  assert.match(probeSource, /paintControllerReadState\(\)/);
  assert.doesNotMatch(probeSource, /renderIfOpen\(\)/,
    'the recurring reachability sweep must not replace #cm-body or .cm-main');

  const readPaintStart = controllerSource.indexOf('function paintControllerReadState(');
  const readPaintEnd = controllerSource.indexOf('function paintControllersToggle(', readPaintStart);
  const readPaintSource = controllerSource.slice(readPaintStart, readPaintEnd);
  assert.ok(readPaintStart >= 0 && readPaintEnd > readPaintStart);
  assert.match(readPaintSource, /querySelectorAll\('\.cm-status-dot\[data-cm-controller-id\]'/);
  assert.match(readPaintSource, /querySelectorAll\('\.led-sync-chip\[data-cm-controller-id\]'/);
  assert.doesNotMatch(readPaintSource, /replaceChildren\(|renderIfOpen\(/,
    'read-state paint must mutate keyed dots/chips only');

  const discoverySource = fs.readFileSync(LED_DISCOVERY_PATH, 'utf8');
  const syncStart = discoverySource.indexOf('export function refreshSyncChips(ctx)');
  const syncEnd = discoverySource.indexOf('export async function computeSyncState', syncStart);
  const syncSource = discoverySource.slice(syncStart, syncEnd);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.match(syncSource, /ctx\.refreshReadState\(controller\.id\)/);
  assert.doesNotMatch(syncSource, /ctx\.refresh\(\)/,
    'panel-open async sync responses must not run the full controller renderer');
});

test('panel: confirmation is vertical, narrow-safe, and logs stay under Advanced details', () => {
  const source = fs.readFileSync(SMOKESTACK_PANEL_PATH, 'utf8');
  const inputAppend = source.indexOf('confirmRow.appendChild(input)');
  const applyAppend = source.indexOf('confirmRow.appendChild(applyBtn)');
  assert.ok(inputAppend >= 0 && applyAppend > inputAppend);
  assert.doesNotMatch(source.slice(inputAppend + 1, applyAppend),
    /confirmRow\.appendChild\(/,
    'APPLY must be the next control directly beneath the textbox');
  assert.match(source, /logBody\.appendChild\(renderConsole/);
  assert.doesNotMatch(source, /body\.appendChild\(renderConsole/,
    'raw CLI output must not appear in the default transaction summary');
  assert.match(source, /const logHost = el\('div', 'smk-log-boundary'\)/);
  assert.match(source, /content\.appendChild\(logSection\)/,
    'the log host must live inside the single collapsed Advanced disclosure');

  const css = fs.readFileSync(STYLE_PATH, 'utf8');
  const start = css.lastIndexOf('.smk-confirm-row {');
  const end = css.indexOf('}', start);
  const rule = css.slice(start, end);
  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rule, /overflow-x:\s*hidden/);
  assert.match(css, /\.smk-confirm-row \.smk-apply-btn[\s\S]*?width:\s*100%/);
});

test('panel: operation bar has four evidence-driven controller segments and no fake percent', () => {
  const source = fs.readFileSync(SMOKESTACK_PANEL_PATH, 'utf8');
  assert.match(source, /for \(const target of targets\)[\s\S]*?jobSegments\.appendChild\(segment\)/);
  assert.match(source, /controller stages explicitly reported/);
  assert.match(source, /final readbacks complete/);
  assert.match(source, /smk-job-progress-indeterminate/);
  assert.doesNotMatch(source, /Math\.round\([^)]*\*\s*100\)|% complete/,
    'the UI has no source for a percent-complete estimate');
  assert.match(source, /flow\.readback && flow\.readback\.jobId === job\.id/,
    'an earlier dry-run readback must never be evaluated as a running APPLY final readback');
  assert.match(source, /TRUSTED CLI VERDICT CONTRADICTED by independent final readback/);
  assert.match(source, /board\.mode === MODE_INVALID/,
    'a dual-enabled readback must turn the terminal banner red');
});

// ── Advanced Recovery: force ONE controller ─────────────────────────────────
//
// The escape hatch that exists because the fleet flow is CORRECTLY refusing.
// Everything below pins the two promises it must keep: it can only ever touch
// exactly one approved controller, and it can never claim anything about the
// fleet.

const FORCE_DMX_MAP = {
  ss_left_left: [[30, 1], [31, 1]],
  ss_left_right: [[32, 1], [33, 1]],
  ss_right_right: [[36, 1], [37, 1]],
  ss_right_left: [[34, 1], [35, 1]],
};

function perOutputFor(controllerId) {
  return FORCE_DMX_MAP[controllerId].map(([universe, startAddress], index) => ({
    index, universe, startAddress, enabled: true,
  }));
}

/**
 * One status row per controller. `spec` overrides per controllerId; the
 * default is the fleet's REAL pre-handoff shape: all four SWARM, the saved
 * leader beaconing, the other three followers FOLLOWING with fresh beacons.
 */
function forceStatuses(targets, spec = {}) {
  return new Map(targets.map((target) => {
    const isLeader = target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID;
    const base = healthySwarmStatus({
      id: target.id,
      controllerId: target.controllerId,
      swarm: {
        enabled: true,
        isLeader,
        followState: isLeader ? 'OFF' : 'FOLLOWING',
        lastBeaconMsAgo: isLeader ? null : 800,
      },
      sacn: { perOutput: perOutputFor(target.controllerId) },
    });
    const override = spec[target.controllerId] || {};
    return [target.id, { ...base, ...override,
      swarm: { ...base.swarm, ...(override.swarm || {}) },
      health: { ...base.health, ...(override.health || {}) },
      capabilities: { ...base.capabilities, ...(override.capabilities || {}) },
      sacn: override.sacn !== undefined ? override.sacn : base.sacn }];
  }));
}

/** The live playa failure this whole feature exists for. */
function detachedFleet(targets) {
  return forceStatuses(targets, {
    ss_left_left: { swarm: { followState: 'DETACHED', lastBeaconMsAgo: 800 } },
    ss_right_right: { swarm: { followState: 'DETACHED', lastBeaconMsAgo: 800 } },
  });
}

function forceReadback(targets, now = Date.now()) {
  return { sweptAt: now, sweeping: false, resultIds: new Set(targets.map((t) => t.id)) };
}

function forceModel(targets, statuses, controllerId, action, overrides = {}) {
  const now = Date.now();
  return smokestackForceRecoveryModel(targets, statuses,
    { ...forceReadback(targets, now), ...overrides }, { controllerId, action }, now);
}

test('force phrase: exact per-controller strings for all 8 combos; throws otherwise', () => {
  for (const controllerId of SMOKESTACK_CONTROLLER_IDS) {
    assert.equal(forceConfirmPhrase(ACTION_FORCE_TO_DMX, controllerId),
      `FORCE DMX ${controllerId}`);
    assert.equal(forceConfirmPhrase(ACTION_FORCE_TO_SWARM, controllerId),
      `FORCE SWARM ${controllerId}`);
  }
  assert.throws(() => forceConfirmPhrase(ACTION_FORCE_TO_DMX, 'ss_nope'), /not one of the four/);
  assert.throws(() => forceConfirmPhrase(ACTION_FORCE_TO_DMX, '192.0.2.61'), /not one of the four/);
  assert.throws(() => forceConfirmPhrase(ACTION_TO_DMX, 'ss_left_left'), /not a force action/);
  assert.throws(() => forceConfirmPhrase(ACTION_REPAIR_TO_DMX, 'ss_left_left'),
    /not a force action/);
});

test('force model: only an exact semantic controllerId ever selects a target', () => {
  const targets = smokestackTargets(ropeRegistry());
  const statuses = detachedFleet(targets);
  for (const selection of ['192.0.2.61', 'LeftLeftRopes', 13, '', null, undefined,
    'ss_left_left,ss_right_right', ' ss_left_left', 'SS_LEFT_LEFT']) {
    const model = forceModel(targets, statuses, selection, ACTION_FORCE_TO_DMX);
    assert.equal(model.eligible, false, `'${selection}' must not select a controller`);
    assert.match(model.blockers[0], /unknown\/ambiguous identity/);
    assert.equal(model.target, null);
    assert.deepEqual(model.cliNames, []);
  }
  const ok = forceModel(targets, statuses, 'ss_left_left', ACTION_FORCE_TO_DMX);
  assert.equal(ok.eligible, true, ok.blockers.join(' | '));
  assert.deepEqual(ok.cliNames, ['ss_left_left']);
});

test('force model: a non-force action is refused outright', () => {
  const targets = smokestackTargets(ropeRegistry());
  for (const action of [ACTION_TO_DMX, ACTION_TO_SWARM, ACTION_REPAIR_TO_DMX, 'nuke', undefined]) {
    const model = forceModel(targets, detachedFleet(targets), 'ss_left_left', action);
    assert.equal(model.eligible, false);
    assert.equal(model.action, null);
    assert.match(model.blockers[0], /is not a force action/);
  }
});

test('FORCE TO DMX: eligible from DETACHED, stale, split-brain, dead leader and MIXED', () => {
  const targets = smokestackTargets(ropeRegistry());
  const cases = [
    ['DETACHED follower', detachedFleet(targets), 'ss_left_left', 'live follower stale'],
    ['stale follower', forceStatuses(targets, {
      ss_left_left: { swarm: { lastBeaconMsAgo: 60000 } } }), 'ss_left_left',
    'live follower stale'],
    ['split-brain follower', forceStatuses(targets, {
      ss_left_left: { swarm: { isLeader: true } } }), 'ss_left_left', 'live duplicate leader'],
    ['inactive leader', forceStatuses(targets, {
      ss_left_right: { swarm: { isLeader: false } } }), 'ss_left_right', 'live leader failed'],
  ];
  for (const [name, statuses, controllerId, readiness] of cases) {
    const model = forceModel(targets, statuses, controllerId, ACTION_FORCE_TO_DMX);
    assert.equal(model.eligible, true, `${name}: ${model.blockers.join(' | ')}`);
    assert.ok(model.bypasses.some((line) => line.includes(readiness)),
      `${name} must NAME the rule it steps around: ${model.bypasses.join(' | ')}`);
    assert.equal(model.consequence, 'fleet becomes MIXED — 1 DMX / 3 SWARM');
    assert.deepEqual(model.cliNames, [controllerId]);
    assert.equal(model.leaderContextRequired, false);
  }

  // Already-mixed fleet: the counts stay honest.
  const mixed = forceStatuses(targets, {
    ss_right_left: { dmxEnabled: true, swarm: { enabled: false, isLeader: false,
      followState: null, lastBeaconMsAgo: null } },
    ss_left_left: { swarm: { followState: 'DETACHED' } },
  });
  const model = forceModel(targets, mixed, 'ss_left_left', ACTION_FORCE_TO_DMX);
  assert.equal(model.eligible, true, model.blockers.join(' | '));
  assert.equal(model.consequence, 'fleet becomes MIXED — 2 DMX / 2 SWARM');
  assert.ok(model.bypasses.some((line) => /already MIXED fleet/.test(line)));
});

test('FORCE TO DMX: every gate that genuinely matters still refuses', () => {
  const targets = smokestackTargets(ropeRegistry());
  const cases = [
    ['unreachable target', { ss_left_left: { reachable: false } }, /unreachable/],
    ['unknown mode', { ss_left_left: { dmxEnabled: null } }, /mode is unknown/],
    ['identity mismatch', { ss_left_left: { controllerId: 'ss_right_left' } },
      /unknown\/ambiguous identity/],
    ['staged config', { ss_left_left: { health: { stagedPending: true } } }, /STAGED config/],
    ['degraded configSource', { ss_left_left: { health: { configSource: 'factory' } } },
      /degraded configSource/],
    ['missing capability', { ss_left_left: { capabilities: { perOutputDmx: false } } },
      /per-output DMX/],
    ['dual-enabled INVALID', { ss_left_left: { dmxEnabled: true } }, /use Repair to DMX/],
    ['sibling unreachable', { ss_right_left: { reachable: false } },
      /full four-controller readback required/],
    ['uncertain mapping', { ss_left_left: { sacn: { perOutput: [
      { index: 0, universe: 99, startAddress: 1, enabled: true },
      { index: 1, universe: 31, startAddress: 1, enabled: true }] } } },
    /uncertain mapping/],
  ];
  for (const [name, spec, pattern] of cases) {
    const statuses = forceStatuses(targets, {
      ss_left_left: { swarm: { followState: 'DETACHED' } }, ...spec });
    const model = forceModel(targets, statuses, 'ss_left_left', ACTION_FORCE_TO_DMX);
    assert.equal(model.eligible, false, `${name} must refuse`);
    assert.ok(model.blockers.some((line) => pattern.test(line)),
      `${name}: ${model.blockers.join(' | ')}`);
  }

  // Freshness: a stale or in-flight readback is not a state you may act on.
  const statuses = detachedFleet(targets);
  const stale = forceModel(targets, statuses, 'ss_left_left', ACTION_FORCE_TO_DMX,
    { sweptAt: Date.now() - (FORCE_READBACK_MAX_AGE_MS + 1000) });
  assert.equal(stale.eligible, false);
  assert.ok(stale.blockers.some((line) => /readback is stale/.test(line)));
  const sweeping = forceModel(targets, statuses, 'ss_left_left', ACTION_FORCE_TO_DMX,
    { sweeping: true });
  assert.equal(sweeping.eligible, false);
  assert.ok(sweeping.blockers.some((line) => /readback is still running/.test(line)));
});

test('FORCE TO SWARM: role authority, leader uniqueness and asset validation all hold', () => {
  const targets = smokestackTargets(ropeRegistry());
  const allDmx = (spec = {}) => forceStatuses(targets, {
    ss_left_left: { dmxEnabled: true, swarm: { enabled: false, isLeader: false,
      followState: null, lastBeaconMsAgo: null } },
    ss_left_right: { dmxEnabled: true, swarm: { enabled: false, isLeader: true,
      followState: null, lastBeaconMsAgo: null } },
    ss_right_right: { dmxEnabled: true, swarm: { enabled: false, isLeader: false,
      followState: null, lastBeaconMsAgo: null } },
    ss_right_left: { dmxEnabled: true, swarm: { enabled: false, isLeader: false,
      followState: null, lastBeaconMsAgo: null } },
    ...spec });

  // A follower with no live leader can never enter SWARM alone.
  const orphan = forceModel(targets, allDmx(), 'ss_left_left', ACTION_FORCE_TO_SWARM);
  assert.equal(orphan.eligible, false);
  assert.ok(orphan.blockers.some((line) =>
    /follower cannot enter SWARM without a healthy fresh sole leader/.test(line)));

  // With the leader live and healthy, the follower may go — WITH the leader
  // in the CLI's target set, because the coherence check needs a beacon.
  const withLeader = allDmx({ ss_left_right: {} });
  const follower = forceModel(targets, withLeader, 'ss_left_left', ACTION_FORCE_TO_SWARM);
  assert.equal(follower.eligible, true, follower.blockers.join(' | '));
  assert.equal(follower.leaderContextRequired, true);
  assert.deepEqual(follower.cliNames, ['ss_left_right', 'ss_left_left']);
  assert.equal(follower.consequence, 'fleet becomes MIXED — 2 DMX / 2 SWARM');

  // The leader's own force carries no context.
  const leader = forceModel(targets, allDmx(), 'ss_left_right', ACTION_FORCE_TO_SWARM);
  assert.equal(leader.eligible, true, leader.blockers.join(' | '));
  assert.equal(leader.leaderContextRequired, false);
  assert.deepEqual(leader.cliNames, ['ss_left_right']);

  // Duplicate leader anywhere blocks BOTH the leader path and the follower one.
  const split = allDmx({ ss_right_right: { dmxEnabled: true,
    swarm: { enabled: false, isLeader: true, followState: null, lastBeaconMsAgo: null } } });
  for (const id of ['ss_left_right', 'ss_left_left']) {
    const model = forceModel(targets, split, id, ACTION_FORCE_TO_SWARM);
    assert.equal(model.eligible, false, `${id} with a duplicate leader`);
    assert.ok(model.blockers.some((line) => /duplicate leader/.test(line)));
  }

  // A follower slot claiming leader is a saved-role-authority refusal.
  const claiming = allDmx({ ss_left_left: { dmxEnabled: true,
    swarm: { enabled: false, isLeader: true, followState: null, lastBeaconMsAgo: null } } });
  const usurper = forceModel(targets, claiming, 'ss_left_left', ACTION_FORCE_TO_SWARM);
  assert.equal(usurper.eligible, false);
  assert.ok(usurper.blockers.some((line) => /saved role authority/.test(line)));

  // Asset validation and the fleet verdict are named as NOT bypassed.
  assert.ok(follower.stillRefuses.some((line) => /frozen-asset validation/.test(line)));
  assert.ok(follower.stillRefuses.some((line) => /active map \/ active pattern/.test(line)));
  assert.ok(follower.stillRefuses.some((line) => /NEVER yields SAFE TO KILL NETWORK/.test(line)));
  assert.ok(follower.stillRefuses.some((line) => /canonical four-board TO SWARM flow/.test(line)));

  // Staged/degraded still refuse on the SWARM path too.
  for (const [spec, pattern] of [
    [{ ss_left_left: { dmxEnabled: true, health: { stagedPending: true } } }, /STAGED config/],
    [{ ss_left_left: { dmxEnabled: true, health: { configSource: 'factory' } } },
      /degraded configSource/],
    [{ ss_left_left: { dmxEnabled: true, controllerId: 'ss_right_right' } },
      /unknown\/ambiguous identity/],
  ]) {
    const model = forceModel(targets, allDmx(spec), 'ss_left_left', ACTION_FORCE_TO_SWARM);
    assert.equal(model.eligible, false);
    assert.ok(model.blockers.some((line) => pattern.test(line)), model.blockers.join(' | '));
  }
});

test('force model: the preserved output map and saved role come from the scene, never invented',
  () => {
    const targets = smokestackTargets(ropeRegistry());
    const statuses = detachedFleet(targets);
    for (const target of targets) {
      const model = forceModel(targets, statuses, target.controllerId, ACTION_FORCE_TO_DMX);
      assert.deepEqual(model.preserved.outputs.map((row) =>
        [row.output, row.universe, row.address, row.px]),
      FORCE_DMX_MAP[target.controllerId].map(([universe, address], index) =>
        [index + 1, universe, address, 40]));
      assert.equal(model.preserved.mappingVerified, true);
      assert.equal(model.preserved.role,
        target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID
          ? 'saved leader' : 'saved follower');
    }
    // A board that reports no runtime origins is UNVERIFIED, never "agrees".
    const silent = forceStatuses(targets, { ss_left_left: { sacn: { perOutput: null },
      swarm: { followState: 'DETACHED' } } });
    const model = forceModel(targets, silent, 'ss_left_left', ACTION_FORCE_TO_DMX);
    assert.equal(model.preserved.mappingVerified, false);
    assert.equal(model.preserved.outputs.every((row) => row.agrees === null), true);
    assert.equal(model.eligible, true, 'a missing readback is unverified, not a disagreement');
  });

test('preflight digest: identical readbacks match; real state changes do not; beacon age is out',
  () => {
    const targets = smokestackTargets(ropeRegistry());
    const base = detachedFleet(targets);
    assert.equal(preflightDigest(targets, base), preflightDigest(targets, detachedFleet(targets)));

    const beaconMoved = forceStatuses(targets, {
      ss_left_left: { swarm: { followState: 'DETACHED', lastBeaconMsAgo: 4321 } },
      ss_right_right: { swarm: { followState: 'DETACHED', lastBeaconMsAgo: 800 } },
    });
    assert.equal(preflightDigest(targets, beaconMoved), preflightDigest(targets, base),
      'beacon age must not invalidate a plan every second');

    for (const spec of [
      { ss_left_left: { swarm: { followState: 'FOLLOWING' } } },
      { ss_left_left: { health: { stagedPending: true } } },
      { ss_left_left: { health: { configSource: 'factory' } } },
      { ss_left_left: { capabilities: { perOutputDmx: false } } },
      { ss_left_left: { firmwareTag: '1.2.6' } },
      { ss_left_left: { reachable: false } },
      { ss_left_left: { dmxEnabled: true } },
      { ss_right_right: { swarm: { isLeader: true } } },
    ]) {
      const drifted = forceStatuses(targets, {
        ss_left_left: { swarm: { followState: 'DETACHED' } },
        ss_right_right: { swarm: { followState: 'DETACHED' } }, ...spec });
      assert.notEqual(preflightDigest(targets, drifted), preflightDigest(targets, base),
        `${JSON.stringify(spec)} must change the digest`);
    }
  });

function forceDryRunJob(overrides = {}) {
  return {
    id: '7',
    action: ACTION_FORCE_TO_DMX,
    apply: false,
    state: 'done',
    exitCode: 0,
    timedOut: false,
    outputTruncated: false,
    verdictLine: VERDICT_DRY_RUN,
    planFingerprint: 'c'.repeat(64),
    targetIds: ['ss_left_left'],
    cliNames: ['ss_left_left'],
    preflightDigest: 'digest-A',
    endedAt: 1_000_000,
    ...overrides,
  };
}

test('apply gate (force): the plan, the controller, the phrase, the digest and the clock', () => {
  const armed = { controllerId: 'ss_left_left', preflightDigest: 'digest-A', now: 1_000_100 };
  const phrase = 'FORCE DMX ss_left_left';
  assert.deepEqual(
    applyGateModel(forceDryRunJob(), ACTION_FORCE_TO_DMX, phrase, armed),
    { allowed: true, reason: '' });

  const refusals = [
    ['no dry-run at all', null, phrase, armed, /run the force-to-dmx dry-run first/],
    ['a different action\'s dry-run', forceDryRunJob({ action: ACTION_TO_DMX }), phrase, armed,
      /run the force-to-dmx dry-run first/],
    ['an APPLY job, not a dry-run', forceDryRunJob({ apply: true }), phrase, armed,
      /run the force-to-dmx dry-run first/],
    ['a refused dry-run', forceDryRunJob({ exitCode: 1 }), phrase, armed, /was refused/],
    ['no trusted no-write verdict', forceDryRunJob({ verdictLine: 'VERDICT: OK' }), phrase, armed,
      /no exact trusted no-write verdict/],
    ['a 63-char fingerprint', forceDryRunJob({ planFingerprint: 'c'.repeat(63) }), phrase, armed,
      /no exact SHA-256 plan fingerprint/],
    ['an UPPERCASE fingerprint', forceDryRunJob({ planFingerprint: 'C'.repeat(64) }), phrase,
      armed, /no exact SHA-256 plan fingerprint/],
    ['a missing fingerprint', forceDryRunJob({ planFingerprint: null }), phrase, armed,
      /no exact SHA-256 plan fingerprint/],
    ['another controller\'s plan', forceDryRunJob({ targetIds: ['ss_right_right'] }), phrase,
      armed, /planned for a different controller/],
    ['two frozen targets', forceDryRunJob({ targetIds: ['ss_left_left', 'ss_right_right'] }),
      phrase, armed, /planned for a different controller/],
    ['an unapproved selection', forceDryRunJob(), phrase,
      { ...armed, controllerId: '192.0.2.61' }, /select exactly one of the four approved/],
    ['a drifted digest', forceDryRunJob(), phrase, { ...armed, preflightDigest: 'digest-B' },
      /state drifted since the dry-run/],
    ['a missing digest', forceDryRunJob(), phrase, { ...armed, preflightDigest: undefined },
      /state drifted since the dry-run/],
    ['a plan older than the force window', forceDryRunJob(), phrase,
      { ...armed, now: 1_000_000 + FORCE_DRY_RUN_FRESH_MS + 1 }, /older than 15 minutes/],
    ['the fleet phrase', forceDryRunJob(), 'SWITCH', armed, /type FORCE DMX ss_left_left/],
    ['another controller\'s phrase', forceDryRunJob(), 'FORCE DMX ss_right_right', armed,
      /type FORCE DMX ss_left_left/],
    ['the SWARM phrase', forceDryRunJob(), 'FORCE SWARM ss_left_left', armed,
      /type FORCE DMX ss_left_left/],
    ['a lowercase phrase', forceDryRunJob(), 'force dmx ss_left_left', armed,
      /type FORCE DMX ss_left_left/],
  ];
  for (const [name, job, typed, options, pattern] of refusals) {
    const gate = applyGateModel(job, ACTION_FORCE_TO_DMX, typed, options);
    assert.equal(gate.allowed, false, `${name} must not arm`);
    assert.match(gate.reason, pattern, name);
  }
});

test('force outcomes: never safeToKillNetwork, and the CLI kill verdict is downgraded', () => {
  const applyJob = (overrides) => doneJob({
    action: ACTION_FORCE_TO_DMX, apply: true, targetIds: ['ss_left_left'],
    verdictLine: VERDICT_DMX_OK, ...overrides });

  const dmxOk = jobOutcomeModel(applyJob({}));
  assert.equal(dmxOk.kind, 'force_dmx_ok');
  assert.equal(dmxOk.safeToKillNetwork, false);
  assert.match(dmxOk.headline, /TARGET ss_left_left VERIFIED IN DMX BY CLI/);
  assert.match(dmxOk.headline, /fleet verdict pending independent readback/);

  // The single-board to-swarm case: the CLI legitimately prints its fleet
  // kill verdict for a leader-only target set. BM downgrades it, explicitly.
  const swarmOk = jobOutcomeModel(applyJob({
    action: ACTION_FORCE_TO_SWARM, targetIds: ['ss_left_right'],
    verdictLine: VERDICT_SAFE_TO_KILL }));
  assert.equal(swarmOk.kind, 'force_swarm_ok');
  assert.equal(swarmOk.safeToKillNetwork, false);
  assert.equal(swarmOk.headline,
    'TARGET ss_left_right ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN');
  assert.match(swarmOk.reason, /downgraded here/);
  assert.equal(/SAFE TO KILL/.test(swarmOk.headline), false);

  const plainSwarm = jobOutcomeModel(applyJob({
    action: ACTION_FORCE_TO_SWARM, targetIds: ['ss_left_right'], verdictLine: VERDICT_DMX_OK }));
  assert.equal(plainSwarm.kind, 'force_swarm_ok');
  assert.equal(plainSwarm.safeToKillNetwork, false);

  for (const [name, overrides, pattern] of [
    ['nonzero exit', { exitCode: 1, verdictLine: 'VERDICT: NOT SAFE - rollback OK' },
      /NOT SAFE - rollback OK/],
    ['timeout', { timedOut: true }, /TIMED OUT/],
    ['truncated output', { outputTruncated: true }, /truncated/],
    ['no verdict at all', { verdictLine: null }, /printed no verdict line/],
  ]) {
    const outcome = jobOutcomeModel(applyJob(overrides));
    assert.equal(outcome.kind, 'force_failed', name);
    assert.equal(outcome.safeToKillNetwork, false);
    assert.match(outcome.reason, pattern, name);
  }
});

test('force fleet verdict: honest at every state, and never says SAFE TO KILL', () => {
  const boards = (modes) => SMOKESTACK_CONTROLLER_IDS.map((controllerId, index) =>
    ({ controllerId, mode: modes[index] }));
  const swarm4 = [MODE_SWARM, MODE_SWARM, MODE_SWARM, MODE_SWARM];

  assert.equal(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left',
      boards([MODE_DMX, MODE_SWARM, MODE_SWARM, MODE_SWARM])),
    'TARGET RECOVERED TO DMX — FLEET REMAINS MIXED');
  assert.match(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left',
      boards([MODE_DMX, MODE_DMX, MODE_DMX, MODE_DMX])),
    /^TARGET RECOVERED TO DMX — FLEET NOW ALL DMX/);
  assert.equal(
    forceFleetVerdict(ACTION_FORCE_TO_SWARM, 'ss_left_right', boards(swarm4)),
    'TARGET ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN');
  assert.match(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left', boards(swarm4)),
    /^TARGET NOT VERIFIED — ss_left_left reads SWARM, expected DMX$/);
  assert.match(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left', boards(
      [MODE_UNREACHABLE, MODE_SWARM, MODE_SWARM, MODE_SWARM])),
    /^TARGET NOT VERIFIED — ss_left_left reads UNREACHABLE/);
  assert.match(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left', boards(swarm4).slice(0, 3)),
    /readback is incomplete \(3\/4\)/);
  assert.match(
    forceFleetVerdict(ACTION_FORCE_TO_DMX, 'ss_left_left',
      boards([MODE_DMX, MODE_SWARM, MODE_SWARM, MODE_SWARM])
        .map((row, index) => (index === 0 ? { ...row, controllerId: 'other' } : row))),
    /is missing from the final readback/);

  for (const action of [ACTION_FORCE_TO_DMX, ACTION_FORCE_TO_SWARM]) {
    for (const controllerId of SMOKESTACK_CONTROLLER_IDS) {
      for (const modes of [swarm4, [MODE_DMX, MODE_DMX, MODE_DMX, MODE_DMX],
        [MODE_DMX, MODE_SWARM, MODE_UNKNOWN, MODE_INVALID]]) {
        assert.equal(/SAFE TO KILL/.test(forceFleetVerdict(action, controllerId, boards(modes))),
          false);
      }
    }
  }
});

test('force transitions: non-targets excluded, leader context proven read-only by uptime', () => {
  const targets = smokestackTargets(ropeRegistry());
  const statuses = detachedFleet(targets);
  const target = targets[0];              // ss_left_left, the forced follower
  const leader = targets[1];              // ss_left_right, read-only context
  const other = targets[2];
  const job = {
    id: '9', action: ACTION_FORCE_TO_SWARM, apply: true, state: 'done', exitCode: 0,
    timedOut: false, outputTruncated: false, verdictLine: VERDICT_SAFE_TO_KILL,
    targetIds: [target.controllerId], cliNames: [leader.controllerId, target.controllerId],
    output: '',
  };
  const done = { jobId: '9', state: 'done', resultIds: new Set(targets.map((t) => t.id)) };

  // Before the readback settles, the leader row promises nothing.
  assert.deepEqual(
    smokestackControllerTransitionModel(leader, job, statuses.get(leader.id), null),
    { label: 'context · no write expected', cls: 'smk-transition-plan' });

  // Settled with an intact uptime: verified unchanged.
  assert.deepEqual(
    smokestackControllerTransitionModel(leader, job, statuses.get(leader.id), done,
      { preUptimeMs: 100000 }),
    { label: 'context verified · unchanged', cls: 'smk-transition-ok' });

  // A reboot (uptime went backwards) is a CHANGE, not a shrug.
  assert.deepEqual(
    smokestackControllerTransitionModel(leader, job,
      { ...statuses.get(leader.id), health: { ...statuses.get(leader.id).health, uptimeMs: 12 } },
      done, { preUptimeMs: 100000 }),
    { label: 'context CHANGED · the board rebooted', cls: 'smk-transition-danger' });

  // No baseline ⇒ we cannot claim it was untouched.
  assert.match(
    smokestackControllerTransitionModel(leader, job, statuses.get(leader.id), done).label,
    /context unverified · no uptime baseline/);

  // A board in neither set is simply excluded, with its real mode named.
  assert.deepEqual(
    smokestackControllerTransitionModel(other, job, statuses.get(other.id), done),
    { label: 'excluded · SWARM', cls: 'smk-transition-idle' });

  // The forced target itself is judged against the ACTION's expected mode.
  assert.match(
    smokestackControllerTransitionModel(target, job, statuses.get(target.id), done).label,
    /failed readback · SWARM topology unhealthy/);
  const dmxJob = { ...job, action: ACTION_FORCE_TO_DMX, cliNames: [target.controllerId],
    verdictLine: VERDICT_DMX_OK };
  assert.match(
    smokestackControllerTransitionModel(target, dmxJob, statuses.get(target.id), done).label,
    /failed readback · SWARM, expected DMX/);
  const dmxStatus = { ...statuses.get(target.id), dmxEnabled: true,
    swarm: { ...statuses.get(target.id).swarm, enabled: false } };
  assert.deepEqual(
    smokestackControllerTransitionModel(target, dmxJob, dmxStatus, done),
    { label: 'verified · readback DMX', cls: 'smk-transition-ok' });

  // Rollback wording survives a failed force apply.
  const rolledBack = { ...dmxJob, exitCode: 1, verdictLine: 'VERDICT: NOT SAFE - 1 board failed',
    output: `${target.controllerId}: rolled back to the pre-change snapshot\n` };
  assert.deepEqual(
    smokestackControllerTransitionModel(target, rolledBack, statuses.get(target.id), done),
    { label: 'restored · readback SWARM', cls: 'smk-transition-plan' });

  // A force job with no frozen target set is a loud refusal, not a guess.
  assert.match(
    smokestackControllerTransitionModel(target, { ...dmxJob, targetIds: null },
      statuses.get(target.id), done).label,
    /force target set missing/);
});

test('force model: forcing a board to the mode it is already in is idempotent and honest', () => {
  const targets = smokestackTargets(ropeRegistry());
  const allDmx = forceStatuses(targets, Object.fromEntries(
    SMOKESTACK_CONTROLLER_IDS.map((controllerId) => [controllerId, {
      dmxEnabled: true,
      swarm: { enabled: false, isLeader: controllerId === SMOKESTACK_LEADER_CONTROLLER_ID,
        followState: null, lastBeaconMsAgo: null },
    }])));
  const model = forceModel(targets, allDmx, 'ss_left_left', ACTION_FORCE_TO_DMX);
  assert.equal(model.eligible, true, model.blockers.join(' | '));
  assert.deepEqual(model.bypasses, []);
  assert.match(model.consequence, /^no change expected/);

  // The SWARM mirror: already in SWARM means no POST, and it explicitly says
  // a DETACHED follower is NOT healed this way.
  const detached = detachedFleet(targets);
  const swarmModel = forceModel(targets, detached, 'ss_left_right', ACTION_FORCE_TO_SWARM);
  assert.equal(swarmModel.eligible, true, swarmModel.blockers.join(' | '));
  assert.match(swarmModel.consequence, /no mode change expected/);
  assert.match(swarmModel.consequence, /force it to DMX first/);
});

test('force matrix: five DMX⇄SWARM cycles never drift identity, map, firmware or saved role',
  () => {
    const targets = smokestackTargets(ropeRegistry());
    const modes = new Map(SMOKESTACK_CONTROLLER_IDS.map((id) => [id, MODE_SWARM]));
    const build = () => forceStatuses(targets, Object.fromEntries(
      SMOKESTACK_CONTROLLER_IDS.map((controllerId) => {
        const isLeader = controllerId === SMOKESTACK_LEADER_CONTROLLER_ID;
        return [controllerId, modes.get(controllerId) === MODE_DMX
          ? { dmxEnabled: true, swarm: { enabled: false, isLeader,
            followState: null, lastBeaconMsAgo: null } }
          : { dmxEnabled: false, swarm: { enabled: true, isLeader,
            followState: isLeader ? 'OFF' : 'FOLLOWING', lastBeaconMsAgo: 800 } }];
      })));

    const identitySnapshot = () => targets.map((target) => {
      const status = build().get(target.id);
      return [target.controllerId, status.controllerId, status.firmwareTag,
        JSON.stringify(target.ports),
        status.swarm.isLeader === (target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID)];
    });
    const before = JSON.stringify(identitySnapshot());

    const order = ['ss_left_right', 'ss_left_left', 'ss_right_right', 'ss_right_left'];
    for (let cycle = 1; cycle <= 5; cycle++) {
      for (const controllerId of order) {
        // SWARM → DMX
        const toDmx = forceModel(targets, build(), controllerId, ACTION_FORCE_TO_DMX);
        assert.equal(toDmx.eligible, true, `cycle ${cycle} ${controllerId} to DMX: ` +
          toDmx.blockers.join(' | '));
        assert.deepEqual(toDmx.cliNames, [controllerId]);
        modes.set(controllerId, MODE_DMX);
        const midBoards = targets.map((target) => ({
          controllerId: target.controllerId, mode: modes.get(target.controllerId) }));
        const verdict = forceFleetVerdict(ACTION_FORCE_TO_DMX, controllerId, midBoards);
        assert.equal(/SAFE TO KILL/.test(verdict), false);
        assert.match(verdict, midBoards.every((row) => row.mode === MODE_DMX)
          ? /FLEET NOW ALL DMX/ : /FLEET REMAINS MIXED/);
      }
      for (const controllerId of order) {
        // DMX → SWARM: the leader first, then each follower WITH the leader.
        const toSwarm = forceModel(targets, build(), controllerId, ACTION_FORCE_TO_SWARM);
        assert.equal(toSwarm.eligible, true, `cycle ${cycle} ${controllerId} to SWARM: ` +
          toSwarm.blockers.join(' | '));
        assert.deepEqual(toSwarm.cliNames,
          controllerId === SMOKESTACK_LEADER_CONTROLLER_ID
            ? [SMOKESTACK_LEADER_CONTROLLER_ID]
            : [SMOKESTACK_LEADER_CONTROLLER_ID, controllerId]);
        modes.set(controllerId, MODE_SWARM);
        assert.equal(/SAFE TO KILL/.test(forceFleetVerdict(ACTION_FORCE_TO_SWARM, controllerId,
          targets.map((target) => ({ controllerId: target.controllerId,
            mode: modes.get(target.controllerId) })))), false);
      }
    }
    assert.equal(JSON.stringify(identitySnapshot()), before,
      'identity, firmware, saved roles and output maps must survive every cycle');
  });

test('panel: Advanced Recovery is its own labelled, distinct section that never endorses a kill',
  () => {
    const source = fs.readFileSync(SMOKESTACK_PANEL_PATH, 'utf8');
    assert.match(source, /Advanced Recovery — force ONE controller/);
    assert.match(source, /class="smk-recovery"|'smk-recovery'/);
    // Four radios, no free text: the target is chosen, never typed.
    assert.match(source, /radio\.type = 'radio'/);
    assert.equal(/smk-recovery-input-freetext/.test(source), false);
    // Its own confirm step, gated by the extended apply gate + the digest.
    assert.match(source, /forceConfirmPhrase\(action, controllerId\)/);
    assert.match(source, /preflightDigest: digestNow/);
    // A force job's CLI verdict is never rendered as the trusted one.
    assert.match(source, /trusted && !isForce/);
    assert.match(source, /forceFleetVerdict\(/);

    const style = fs.readFileSync(STYLE_PATH, 'utf8');
    for (const rule of ['.smk-recovery', '.smk-recovery-summary', '.smk-recovery-select',
      '.smk-recovery-card', '.smk-recovery-bypass', '.smk-recovery-refuses',
      '.smk-recovery-consequence', '.smk-fingerprint']) {
      assert.ok(style.includes(rule), `style.css must define ${rule}`);
    }
    // Theme tokens only — no hard-coded hex inside the recovery block.
    const block = style.slice(style.indexOf('/* ── Advanced Recovery'),
      style.indexOf('/* ── Provisional reconcile dialog'));
    assert.ok(block.length > 0);
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(block), false, 'recovery CSS must use var() tokens');
  });

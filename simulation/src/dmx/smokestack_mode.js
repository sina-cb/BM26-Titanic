/**
 * smokestack_mode.js — the PURE model behind the controller pane's smokestack
 * DMX ⇄ swarm section. No DOM, no network: smokestack_panel.js renders from
 * these shapes and the tests assert them without a browser.
 *
 * The smokestack is lit by four MarsinLED rope controllers that render in one
 * of two modes:
 *
 *   DMX    the board paints whatever arrives over sACN (the engine drives it).
 *   SWARM  the board runs its own pattern natively, leader → followers over
 *          ESP-NOW — the mode the ropes are left in when the show network is
 *          struck ("set swarm → verify → kill the Ethernet → boards keep
 *          playing forever").
 *
 * Two data paths feed this model, and they must never be conflated:
 *
 *   GLANCE   read-only GET /api/status + GET /api/config per board, proxied by
 *            the sim server (server/smokestack_status_service.cjs). Zero
 *            mutation, no registry needed — it answers "what mode is each
 *            board in RIGHT NOW".
 *   SWITCH   the operator-gated mode flip. It is executed EXCLUSIVELY by the
 *            private MarsinLED deploy CLI (registry + MAC verification,
 *            pre-flight sweep, canary-first rollout, reboot-survival check),
 *            shelled out to by server/smokestack_cli_service.cjs. This repo
 *            NEVER reimplements those safety gates and never reads the
 *            registry — if the deployment source is not provisioned, the
 *            switch flow is honestly unavailable (codex P0: no fallback).
 *
 * Mode source of truth on a board: GET /api/config → dmx.enabled
 * (true = DMX, false = swarm-native). Roles/coherence come from
 * GET /api/status → swarm.{enabled,isLeader,follow.state,follow.lastBeaconMsAgo}.
 */

// ── Which controllers are the smokestack ropes ──────────────────────────────
// Identified by the board's OWN identity (device.controllerId — the same
// binding identity the LED discovery flow verifies), never by IP, card row,
// card name, or the scene's numeric controller id. The IP and card name are
// validated only AFTER semantic identity selects the required model.

export const SMOKESTACK_COORDINATE_FRAME = Object.freeze({
  id: 'titanic_global',
  units: 'scene_world',
  normalization: Object.freeze({
    x: Object.freeze({ min: -50.318, span: 95.772 }),
    y: Object.freeze({ min: 0.25, span: 14.65 }),
    z: Object.freeze({ min: -26.379, span: 42.535 }),
  }),
  perControllerNormalization: false,
});

function point(x, y, z) {
  return Object.freeze({ x, y, z });
}

function outputModel(output, strand, modelStart, modelEnd, start, end, dominantWalk) {
  return Object.freeze({
    output,
    strand,
    modelRange: Object.freeze([modelStart, modelEnd]),
    outputLocalRange: Object.freeze([0, 39]),
    start,
    end,
    dominantWalk,
    authoredDirection: 'logical 0 → 39',
    physicalDirectionVerified: false,
  });
}

function controllerModel(placement, operatorLabel, expectedName, operatorSide, outputs) {
  return Object.freeze({
    placement,
    operatorLabel,
    filterTag: 'swarm',
    placementKind: 'legacy_controller_label',
    expectedName,
    operatorSide,
    modeScope: 'swarm_only',
    mappingPushChangesMode: false,
    coordinateFrame: SMOKESTACK_COORDINATE_FRAME,
    pixelCount: 80,
    physicalDirectionVerified: false,
    outputs: Object.freeze(outputs),
  });
}

/**
 * Controller-local SWARM models. Each board owns 80 model pixels: Output 1 is
 * model 0..39 and Output 2 is 40..79, while BOTH physical outputs retain their
 * own local 0..39 walk. Coordinates stay in the one Titanic-global frame; a
 * board must never normalize its own two ropes independently.
 *
 * Current scene names beginning `Left` occupy operator RIGHT, and names
 * beginning `Right` occupy operator LEFT (docs/TITANIC_MODEL.md §1.2). The
 * explicit operatorSide field keeps the legacy placement label from becoming
 * a false physical-side label in the UI.
 */
export const SMOKESTACK_SWARM_MODELS = Object.freeze({
  ss_left_left: controllerModel('LeftLeft', 'SWARM LeftLeft (.61)',
    'LeftLeftRopes', 'RIGHT', [
    outputModel(1, 'Left_Front_Left', 0, 39,
      point(-31.5, 2.5, 13.5),
      point(-28.29867971194932, 12.5, 10.041042514034084), 'Y+'),
    outputModel(2, 'Left_Back_Left', 40, 79,
      point(-31.5, 2, 4), point(-28, 12.5, 7.5), 'Y+'),
  ]),
  ss_left_right: controllerModel('LeftRight', 'SWARM LeftRight (.62)',
    'LeftRightRopes', 'RIGHT', [
    outputModel(1, 'Left_Front_Right', 0, 39,
      point(-13.5, 12.6, 13.4), point(-25.5, 14.8, 10.1), 'X-'),
    outputModel(2, 'Left_Back_Right', 40, 79,
      point(-13.7, 12.5, 3.8), point(-25.4, 14.7, 7.1), 'X-'),
  ]),
  ss_right_right: controllerModel('RightRight', 'SWARM RightRight (.65)',
    'RightRightRopes', 'LEFT', [
    outputModel(1, 'Right_Front_Right', 0, 39,
      point(33.6, 2.1, -10.6), point(28.6, 12.6, -11.3), 'Y+'),
    outputModel(2, 'Right_Back_Right', 40, 79,
      point(27.6, 2.1, -18.1), point(27.2, 12.7, -13.2), 'Y+'),
  ]),
  ss_right_left: controllerModel('RightLeft', 'SWARM RightLeft (.66)',
    'RightLeftRopes', 'LEFT', [
    outputModel(1, 'Right_Front_Left', 0, 39,
      point(19.5, 12.4, 0.4), point(26.9, 14.6, -9.6), 'Z-'),
    outputModel(2, 'Right_Back_Left', 40, 79,
      point(13.5, 12.6, -7.1), point(24.9, 14.9, -11.9), 'X+'),
  ]),
});

export const SMOKESTACK_CONTROLLER_IDS = Object.freeze([
  'ss_left_left',
  'ss_left_right',
  'ss_right_right',
  'ss_right_left',
]);
export const SMOKESTACK_LEADER_CONTROLLER_ID = 'ss_left_right';

const SMOKESTACK_EXPECTED_CARD_NAMES = new Set(
  Object.values(SMOKESTACK_SWARM_MODELS).map((model) => model.expectedName),
);
const SMOKESTACK_EXPECTED_STRANDS = new Set(
  Object.values(SMOKESTACK_SWARM_MODELS)
    .flatMap((model) => model.outputs.map((output) => output.strand)),
);

export const MODE_DMX = 'dmx';
export const MODE_SWARM = 'swarm';
export const MODE_INVALID = 'invalid';
export const MODE_UNKNOWN = 'unknown';
export const MODE_UNREACHABLE = 'unreachable';

/** follow.lastBeaconMsAgo older than this is a stale follower (mirrors the
 * deploy CLI's coherence window). */
export const SWARM_BEACON_MAX_MS = 15000;

function normalizeTitanicCoordinate(value, axis) {
  const rule = SMOKESTACK_COORDINATE_FRAME.normalization[axis];
  return (value - rule.min) / rule.span;
}

function interpolate(start, end, localIndex) {
  const t = localIndex / 39;
  return start + ((end - start) * t);
}

/**
 * Materialize one controller's complete 80-pixel SWARM-only model. This is a
 * pure model description; it is not a DMX model and is not a config push.
 *
 * @param {string} controllerId semantic device.controllerId
 * @returns {{controllerId, placement, coordinateFrame, pixelCount, outputs, pixels}}
 */
export function smokestackSwarmModel(controllerId) {
  const spec = SMOKESTACK_SWARM_MODELS[controllerId];
  if (!spec) {
    throw new Error(`[Smokestack Model] Unknown controllerId '${controllerId}' — expected one of ` +
      SMOKESTACK_CONTROLLER_IDS.join(', '));
  }
  const pixels = [];
  for (const output of spec.outputs) {
    for (let outputLocalIndex = 0; outputLocalIndex < 40; outputLocalIndex++) {
      const modelIndex = output.modelRange[0] + outputLocalIndex;
      const x = interpolate(output.start.x, output.end.x, outputLocalIndex);
      const y = interpolate(output.start.y, output.end.y, outputLocalIndex);
      const z = interpolate(output.start.z, output.end.z, outputLocalIndex);
      pixels.push({
        modelIndex,
        output: output.output,
        outputLocalIndex,
        strand: output.strand,
        x,
        y,
        z,
        nx: normalizeTitanicCoordinate(x, 'x'),
        ny: normalizeTitanicCoordinate(y, 'y'),
        nz: normalizeTitanicCoordinate(z, 'z'),
      });
    }
  }
  return {
    controllerId,
    placement: spec.placement,
    modeScope: spec.modeScope,
    mappingPushChangesMode: spec.mappingPushChangesMode,
    coordinateFrame: spec.coordinateFrame,
    pixelCount: spec.pixelCount,
    outputs: spec.outputs,
    pixels,
  };
}

function mappingRefusal(controllerId, detail) {
  throw new Error(`[Smokestack Model] '${controllerId}' ${detail}. Refusing an incomplete or ` +
    'misbound four-controller SWARM model.');
}

function validateTargetController(controllerId, controller, spec) {
  if (controller.name !== spec.expectedName) {
    mappingRefusal(controllerId,
      `is on card '${controller.name}', expected semantic card '${spec.expectedName}'`);
  }
  if (controller.type !== 'LED') {
    mappingRefusal(controllerId, `must be an LED controller, got '${controller.type}'`);
  }
  if (typeof controller.ip !== 'string' || controller.ip.length === 0) {
    mappingRefusal(controllerId, 'has no explicit controller IP');
  }
  if (!Array.isArray(controller.ports) || controller.ports.length !== spec.outputs.length) {
    mappingRefusal(controllerId,
      `must expose exactly ${spec.outputs.length} mapped outputs`);
  }
  for (const outputSpec of spec.outputs) {
    const port = controller.ports.find((candidate) => candidate.output === outputSpec.output);
    if (!port) mappingRefusal(controllerId, `is missing physical Output ${outputSpec.output}`);
    if (port.startAddress !== 1) {
      mappingRefusal(controllerId,
        `Output ${outputSpec.output} startAddress is ${port.startAddress}, expected 1`);
    }
    if (!Array.isArray(port.chain) || port.chain.length !== 1 ||
        port.chain[0] !== outputSpec.strand) {
      mappingRefusal(controllerId,
        `Output ${outputSpec.output} must map only '${outputSpec.strand}'`);
    }
  }
}

function looksLikeTitanicSmokestackCard(controller) {
  if (!controller || typeof controller !== 'object') return false;
  if (SMOKESTACK_EXPECTED_CARD_NAMES.has(controller.name)) return true;
  if (!Array.isArray(controller.ports)) return false;
  return controller.ports.some((port) => Array.isArray(port && port.chain)
    && port.chain.some((strand) => SMOKESTACK_EXPECTED_STRANDS.has(strand)));
}

/**
 * The smokestack targets in canonical semantic-identity order. Registry row,
 * IP and numeric controller ids never select placement. Returns [] for scenes
 * without any Titanic ropes (test_bench…), but a partial/misbound Titanic set
 * throws rather than rendering a plausible-looking incomplete model.
 *
 * @param {{controllers?: Array}} registry
 * @returns {Array<{id, name, ip, controllerId, expectedLeader}>}
 */
export function smokestackTargets(registry) {
  if (!registry || !Array.isArray(registry.controllers)) return [];
  const byControllerId = new Map();
  for (const controller of registry.controllers) {
    const controllerId = controller && controller.device && controller.device.controllerId;
    if (!SMOKESTACK_CONTROLLER_IDS.includes(controllerId)) continue;
    if (byControllerId.has(controllerId)) {
      mappingRefusal(controllerId, 'appears on more than one controller card');
    }
    byControllerId.set(controllerId, controller);
  }
  if (byControllerId.size === 0) {
    const apparentRopeCards = registry.controllers.filter(looksLikeTitanicSmokestackCard);
    if (apparentRopeCards.length === 0) return [];
    throw new Error('[Smokestack Model] Titanic smokestack cards are present, but none has a ' +
      'recognized semantic controllerId binding. Refusing to hide a misbound four-controller ' +
      `SWARM model; expected: ${SMOKESTACK_CONTROLLER_IDS.join(', ')}.`);
  }
  if (byControllerId.size !== SMOKESTACK_CONTROLLER_IDS.length) {
    const missing = SMOKESTACK_CONTROLLER_IDS.filter((id) => !byControllerId.has(id));
    throw new Error(`[Smokestack Model] Incomplete Titanic SWARM mapping — missing semantic ` +
      `controllerId(s): ${missing.join(', ')}.`);
  }
  return SMOKESTACK_CONTROLLER_IDS.map((controllerId) => {
    const controller = byControllerId.get(controllerId);
    const swarmModel = SMOKESTACK_SWARM_MODELS[controllerId];
    validateTargetController(controllerId, controller, swarmModel);
    return {
      id: controller.id,
      name: controller.name,
      ip: controller.ip,
      // The scene's own validated port rows (output → universe/startAddress).
      // The force-recovery model renders the preserved output map from THESE
      // plus the swarm model's pixel ranges; it never invents an origin.
      ports: Object.freeze(swarmModel.outputs.map((outputSpec) => {
        const port = controller.ports.find((row) => row.output === outputSpec.output);
        return Object.freeze({
          output: outputSpec.output,
          strand: outputSpec.strand,
          universe: port.universe,
          startAddress: port.startAddress,
          pixelCount: outputSpec.outputLocalRange[1] - outputSpec.outputLocalRange[0] + 1,
        });
      })),
      controllerId,
      expectedLeader: controllerId === SMOKESTACK_LEADER_CONTROLLER_ID,
      placement: swarmModel.placement,
      operatorLabel: swarmModel.operatorLabel,
      filterTag: swarmModel.filterTag,
      operatorSide: swarmModel.operatorSide,
      swarmModel,
    };
  });
}

const MODE_PRESENTATION = {
  [MODE_DMX]: { label: 'DMX', cls: 'smk-mode-dmx' },
  [MODE_SWARM]: { label: 'SWARM', cls: 'smk-mode-swarm' },
  [MODE_INVALID]: { label: 'MIXED/INVALID', cls: 'smk-mode-invalid' },
  [MODE_UNKNOWN]: { label: 'MODE ?', cls: 'smk-mode-unknown' },
  [MODE_UNREACHABLE]: { label: 'UNREACHABLE', cls: 'smk-mode-unreachable' },
};

/**
 * The per-board glance model: mode chip + role line + every warning the
 * operator must see. `status` is this board's entry from the sim server's
 * `/smokestack/status` sweep, or null when no sweep has answered yet.
 *
 * A sweep we did not perform renders MODE ? — never a confident DMX/SWARM
 * (codex P0 applies to display truth too).
 *
 * @param {{id, name, controllerId, expectedLeader}} target
 * @param {Object|null} status
 * @returns {{mode, modeLabel, modeCls, role, roleOk, warnings: string[],
 *   switchBlockers: string[], detail}}
 */
export function smokestackBoardModel(target, status) {
  const warnings = [];
  const switchBlockers = [];
  let mode = MODE_UNKNOWN;
  let role = target.expectedLeader ? 'leader' : 'follower';
  let roleOk = false;
  let detail = 'no status sweep has answered for this board yet';
  let readinessLabel = 'readiness unknown';

  if (status) {
    detail = status.detail || '';
    if (!status.reachable) {
      mode = MODE_UNREACHABLE;
      readinessLabel = 'offline';
    } else {
      const swarmEnabled = status.swarm && status.swarm.enabled === true;
      if (status.dmxEnabled === true && !swarmEnabled) mode = MODE_DMX;
      else if (status.dmxEnabled === false && swarmEnabled) mode = MODE_SWARM;
      else if (typeof status.dmxEnabled === 'boolean') {
        mode = MODE_INVALID;
        readinessLabel = 'invalid dual mode';
        const invalid = status.dmxEnabled
          ? 'INVALID MODE — DMX and SWARM are both enabled; outputs cannot be classified as DMX'
          : 'INVALID MODE — DMX and SWARM are both disabled; no canonical owner is active';
        warnings.push(invalid);
        switchBlockers.push(invalid);
      } else {
        mode = MODE_UNKNOWN;
        warnings.push('board answered but its config could not be read — mode is unknown');
      }

      // Identity: the board must be the one the scene card is bound to.
      if (status.controllerId !== target.controllerId) {
        const reported = status.controllerId || '(identity unavailable)';
        const mismatch = `identity mismatch — the board at this IP reports '${reported}', ` +
          `the scene binding expects '${target.controllerId}'. Do not switch modes until this ` +
          'is resolved.';
        warnings.push(mismatch);
        switchBlockers.push(mismatch);
      }

      const sw = status.swarm || {};
      if (mode === MODE_DMX) {
        // DMX owns output right now. Only the SAVED role is meaningful; live
        // follower state and beacon age are dormant and must never be reported
        // as active split-brain/staleness claims.
        roleOk = target.expectedLeader ? sw.isLeader === true : sw.isLeader === false;
        role = roleOk
          ? `SWARM READY · saved ${target.expectedLeader ? 'LEADER' : 'follower'}`
          : `SWARM readiness · saved ${target.expectedLeader ? 'leader' : 'follower'} mismatch`;
        readinessLabel = roleOk ? 'saved role ready' : 'saved role mismatch';
        if (!roleOk) {
          warnings.push(`SWARM readiness warning — saved role does not match this ` +
            `${target.expectedLeader ? 'leader' : 'follower'} slot. DMX is active, so this is ` +
            'not a live split-brain or stale-follower claim.');
        }
      } else if (mode === MODE_SWARM && target.expectedLeader) {
        roleOk = sw.enabled === true && sw.isLeader === true;
        role = roleOk ? 'LEADER (beaconing)' : 'LEADER (not active)';
        readinessLabel = roleOk ? 'live leader healthy' : 'live leader failed';
        if (!roleOk) {
          warnings.push('LIVE SWARM TOPOLOGY FAILURE — the expected leader is not active and ' +
            'beaconing');
        }
      } else if (mode === MODE_SWARM) {
        const beaconFresh = Number.isFinite(sw.lastBeaconMsAgo)
          && sw.lastBeaconMsAgo < SWARM_BEACON_MAX_MS;
        const claimsLeader = sw.isLeader === true;
        roleOk = sw.enabled === true && sw.isLeader === false
          && sw.followState === 'FOLLOWING' && beaconFresh;
        role = roleOk
          ? `FOLLOWING (beacon ${sw.lastBeaconMsAgo} ms ago)`
          : claimsLeader
            ? 'FOLLOWER SLOT CLAIMS LEADER'
            : `follower (${sw.followState || 'state ?'})`;
        readinessLabel = roleOk
          ? 'live follower synced'
          : claimsLeader ? 'live duplicate leader' : 'live follower stale';
        if (claimsLeader) {
          warnings.push('LIVE SWARM TOPOLOGY FAILURE — duplicate leader / split-brain: this ' +
            'expected follower reports isLeader=true');
        } else if (!roleOk) {
          warnings.push('LIVE SWARM TOPOLOGY FAILURE — expected a non-leader FOLLOWING with a ' +
            'fresh leader beacon (stale or missing follower coherence)');
        }
      }

      const health = status.health || {};
      if (health.stagedPending === true) {
        const staged = 'a STAGED config is pending on this board (someone else\'s ' +
          'unconfirmed change) — the deploy CLI will refuse it until resolved';
        warnings.push(staged);
        switchBlockers.push(staged);
      }
      if (health.configSource && health.configSource !== 'primary') {
        const degraded = `running on configSource '${health.configSource}' (degraded, ` +
          'not the committed primary config)';
        warnings.push(degraded);
        switchBlockers.push(degraded);
      }
      const caps = status.capabilities || {};
      if (caps.perOutputDmx !== true) {
        const capability = 'firmware lacks per-output DMX (capabilitiesExt.perOutputDmx) — ' +
          'a switch to DMX mode will be refused until the board is flashed';
        warnings.push(capability);
        switchBlockers.push(capability);
      }
    }
  }

  const pres = MODE_PRESENTATION[mode];
  return {
    mode,
    modeLabel: pres.label,
    modeCls: pres.cls,
    role,
    roleOk,
    warnings,
    switchBlockers,
    readinessLabel,
    detail,
  };
}

/**
 * The fleet headline over all board models: the one line that answers
 * "are the ropes uniformly where I put them?".
 *
 * @param {Array<{mode: string, warnings: string[]}>} boards
 * @returns {{text, cls, uniform: boolean}}
 */
export function smokestackFleetModel(boards) {
  if (!boards || boards.length === 0) {
    return { text: 'no rope controllers in this scene', cls: 'smk-fleet-unknown', uniform: false };
  }
  const unreachable = boards.filter((b) => b.mode === MODE_UNREACHABLE).length;
  const unknown = boards.filter((b) => b.mode === MODE_UNKNOWN).length;
  const invalid = boards.filter((b) => b.mode === MODE_INVALID).length;
  const dmx = boards.filter((b) => b.mode === MODE_DMX).length;
  const swarm = boards.filter((b) => b.mode === MODE_SWARM).length;
  const warned = boards.reduce((n, b) => n + b.warnings.length, 0);
  const roleFailures = boards.filter((b) => b.roleOk === false).length;

  const uniformModeResult = (label) => {
    const concerns = [];
    if (roleFailures > 0) concerns.push(`${roleFailures} role/coherence failure(s)`);
    if (warned > 0) concerns.push(`${warned} warning(s)`);
    return {
      text: concerns.length > 0 ? `${label} (${concerns.join(' · ')})` : label,
      cls: concerns.length > 0 ? 'smk-fleet-mixed' : 'smk-fleet-ok',
      uniform: roleFailures === 0,
    };
  };

  if (unreachable === boards.length) {
    return { text: `all ${boards.length} unreachable`, cls: 'smk-fleet-bad', uniform: false };
  }
  if (invalid > 0) {
    return { text: `MIXED/INVALID — ${invalid} controller(s) dual/off`,
      cls: 'smk-fleet-bad', uniform: false };
  }
  if (unknown + unreachable > 0) {
    const bits = [];
    if (dmx) bits.push(`${dmx} DMX`);
    if (swarm) bits.push(`${swarm} SWARM`);
    if (unknown) bits.push(`${unknown} unknown`);
    if (unreachable) bits.push(`${unreachable} unreachable`);
    return { text: bits.join(' · '), cls: 'smk-fleet-mixed', uniform: false };
  }
  if (dmx === boards.length) {
    return uniformModeResult('ALL DMX');
  }
  if (swarm === boards.length) {
    return uniformModeResult('ALL SWARM');
  }
  return { text: `MIXED — ${dmx} DMX / ${swarm} SWARM`, cls: 'smk-fleet-bad', uniform: false };
}

// ── The switch flow (deploy CLI jobs) ────────────────────────────────────────

export const ACTION_TO_DMX = 'to-dmx';
export const ACTION_TO_SWARM = 'to-swarm';
export const ACTION_REPAIR_TO_DMX = 'repair-to-dmx';
export const REPAIR_READBACK_MAX_AGE_MS = 30000;

// ── Advanced Recovery: force ONE controller ────────────────────────────────
//
// The fleet toggle and the contextual repair both act on the four boards as a
// unit and are bound by the deploy CLI's canonical asset/identity contract.
// When that contract legitimately refuses the whole fleet (an off-release
// board, an asset mismatch) but ONE controller must still be moved — the
// smokestack is dark and its follower is stuck DETACHED — this is the escape
// hatch: exactly one approved controllerId, executed through the CLI's own
// `--names` selector, never a browser-to-board write.
//
// It is deliberately harder to fire than the fleet flow: a fresh no-write
// dry-run, a 64-hex plan fingerprint with a SHORT freshness window, a
// preflight digest that refuses any state drift between plan and apply, and a
// controller-specific typed phrase. It never produces a fleet verdict.
export const ACTION_FORCE_TO_DMX = 'force-to-dmx';
export const ACTION_FORCE_TO_SWARM = 'force-to-swarm';
export const FORCE_ACTIONS = Object.freeze([ACTION_FORCE_TO_DMX, ACTION_FORCE_TO_SWARM]);
/**
 * How long a reviewed force plan stays armable. ONE constant, identical to
 * the fleet flow's window (server: DRY_RUN_FRESH_MS) — operator ruling: a
 * shorter force-only window was too restrictive in the field. Staleness is
 * not the force path's real guard anyway; the preflight digest is, and it
 * refuses on ANY state change regardless of the clock.
 */
export const FORCE_DRY_RUN_FRESH_MS = 15 * 60 * 1000;
/** The bounded readback a force decision may be made from. */
export const FORCE_READBACK_MAX_AGE_MS = REPAIR_READBACK_MAX_AGE_MS;

/**
 * Contextual repair is offered only from one complete, fresh, exact-identity
 * four-board readback. Its targetIds are the frozen semantic IDs of INVALID
 * rows only; registry order, IP order and healthy rows can never enter them.
 */
export function smokestackRepairModel(targets, statuses, readback = {}, now = Date.now()) {
  const byId = statuses instanceof Map ? statuses : new Map();
  const resultIds = readback.resultIds instanceof Set ? readback.resultIds : new Set();
  const rows = new Map();
  const invalidTargets = [];
  const blockers = [];

  for (const target of targets || []) {
    const status = byId.get(target.id) || null;
    const board = smokestackBoardModel(target, status);
    const exactIdentity = !!status && status.reachable === true
      && status.controllerId === target.controllerId;
    if (board.mode === MODE_INVALID) invalidTargets.push(target);
    if (!resultIds.has(target.id)) blockers.push(`${target.operatorLabel} missing from readback`);
    else if (!status || status.reachable !== true) blockers.push(`${target.operatorLabel} unreachable`);
    else if (!exactIdentity) blockers.push(`${target.operatorLabel} identity unknown or mismatched`);
    else if (board.mode === MODE_UNKNOWN) blockers.push(`${target.operatorLabel} mode unknown`);

    if (board.mode === MODE_INVALID) {
      rows.set(target.controllerId, {
        eligible: exactIdentity,
        label: exactIdentity ? 'repair target · DMX' : 'repair blocked · identity',
        cls: exactIdentity ? 'smk-repair-eligible' : 'smk-repair-blocked',
      });
    } else if (board.mode === MODE_UNREACHABLE) {
      rows.set(target.controllerId, { eligible: false, label: 'repair blocked · unreachable',
        cls: 'smk-repair-blocked' });
    } else if (board.mode === MODE_UNKNOWN) {
      rows.set(target.controllerId, { eligible: false, label: 'repair blocked · unknown',
        cls: 'smk-repair-blocked' });
    } else {
      rows.set(target.controllerId, { eligible: false, label: 'excluded · healthy',
        cls: 'smk-repair-excluded' });
    }
  }

  const targetIds = invalidTargets.map((target) => target.controllerId).sort();
  const ageMs = Number.isFinite(readback.sweptAt) ? Math.max(0, now - readback.sweptAt) : Infinity;
  if (readback.sweeping === true) blockers.unshift('status readback is still running');
  else if (ageMs > REPAIR_READBACK_MAX_AGE_MS) blockers.unshift('status readback is stale');
  const visible = targetIds.length > 0;
  return {
    visible,
    enabled: visible && blockers.length === 0,
    action: ACTION_REPAIR_TO_DMX,
    label: `Repair ${targetIds.length} controller(s) to DMX`,
    reason: blockers[0] || '',
    targetIds,
    rows,
    ageMs,
  };
}

/**
 * Derive the ONE fleet-toggle direction from verified board state. A mixed
 * but otherwise readable fleet has one deterministic safe recovery: disable
 * SWARM everywhere and return the full fleet to DMX. Unknown, unreachable,
 * invalid or unhealthy uniform SWARM state never guesses.
 *
 * DMX role mismatches remain visible readiness warnings but do not make the
 * direction ambiguous: the guarded to-swarm dry-run owns the repair/verify
 * plan. In live SWARM, a bad role/coherence state offers ONLY the guarded
 * exact-four DMX recovery — never TO SWARM.
 *
 * @param {Array<{mode, roleOk, warnings, switchBlockers}>} boards
 * @returns {{action:string|null, label:string, enabled:boolean, reason:string}}
 */
export function smokestackFleetToggleModel(boards) {
  if (!Array.isArray(boards) || boards.length !== SMOKESTACK_CONTROLLER_IDS.length) {
    const count = Array.isArray(boards) ? boards.length : 0;
    return {
      action: null,
      label: 'Fleet state invalid — refresh required',
      enabled: false,
      reason: `expected ${SMOKESTACK_CONTROLLER_IDS.length} verified controllers, got ${count}`,
    };
  }
  const unreachable = boards.filter((board) => board.mode === MODE_UNREACHABLE).length;
  const unknown = boards.filter((board) => board.mode === MODE_UNKNOWN).length;
  const invalid = boards.filter((board) => board.mode === MODE_INVALID).length;
  const dmx = boards.filter((board) => board.mode === MODE_DMX).length;
  const swarm = boards.filter((board) => board.mode === MODE_SWARM).length;
  if (invalid > 0) {
    return {
      action: null,
      label: 'MIXED/INVALID fleet — cannot switch',
      enabled: false,
      reason: `${invalid} controller(s) report noncanonical DMX/SWARM enablement`,
    };
  }
  if (unknown > 0 || unreachable > 0) {
    return {
      action: null,
      label: 'Fleet state unknown — cannot switch',
      enabled: false,
      reason: `${unknown} unknown · ${unreachable} unreachable — refresh and resolve every board`,
    };
  }
  const blockers = boards.flatMap((board) => board.switchBlockers || []);
  if (blockers.length > 0) {
    return {
      action: null,
      label: 'Fleet verification failed — cannot switch',
      enabled: false,
      reason: blockers[0],
    };
  }
  if (dmx > 0 && swarm > 0) {
    return {
      action: ACTION_TO_DMX,
      label: 'Recover all to DMX',
      enabled: true,
      reason: `${dmx} DMX · ${swarm} SWARM — guarded full-fleet DMX recovery`,
    };
  }
  if (dmx === boards.length) {
    return {
      action: ACTION_TO_SWARM,
      label: 'Switch all to SWARM',
      enabled: true,
      reason: '',
    };
  }
  const topologyFailures = boards.filter((board) => board.roleOk !== true).length;
  if (swarm === boards.length && topologyFailures > 0) {
    // A uniformly-SWARM fleet whose topology has failed (DETACHED/stale
    // followers, split-brain, absent leader) is unsafe to KEEP in swarm, but
    // to-dmx has no leader/follower dependency at all — the deploy CLI's
    // to-dmx plan carries no topology input. Blocking every direction here
    // only removed the safe escape; every blocker that genuinely matters for
    // to-dmx (identity, staged/degraded config, capability, invalid dual
    // mode, unknown/unreachable) was already evaluated above. TO SWARM is
    // never offered from this branch.
    return {
      action: ACTION_TO_DMX,
      label: 'Recover all to DMX',
      enabled: true,
      reason: `${topologyFailures} live SWARM role/coherence failure(s) — guarded exact-four ` +
        'DMX recovery only; the CLI\'s asset/identity contract still applies',
    };
  }
  if (swarm === boards.length) {
    return {
      action: ACTION_TO_DMX,
      label: 'Switch all to DMX',
      enabled: true,
      reason: '',
    };
  }
  return {
    action: null,
    label: 'Fleet state invalid — cannot switch',
    enabled: false,
    reason: 'fleet modes do not form one verified DMX or SWARM state',
  };
}

/**
 * The one typed confirmation phrase either apply direction requires. Direction
 * remains bound by the completed same-action dry-run job; this phrase merely
 * confirms the operator intends to perform that already-displayed plan. The
 * sim server enforces the same contract and the routes test pins parity.
 */
export const CONFIRM_PHRASES = {
  [ACTION_TO_DMX]: 'SWITCH',
  [ACTION_TO_SWARM]: 'SWITCH',
  [ACTION_REPAIR_TO_DMX]: 'SWITCH',
};

/**
 * Outcome kinds whose CLI evidence is trusted. `force_*` kinds appear here
 * because the CLI's own run passed — but they NEVER carry
 * `safeToKillNetwork`, and the panel still requires the independent
 * four-controller readback before it renders anything green.
 */
export const TRUSTED_APPLY_OUTCOME_KINDS = Object.freeze([
  'safe_to_kill', 'dmx_ok', 'repair_ok', 'force_dmx_ok', 'force_swarm_ok',
]);
export const TRUSTED_OUTCOME_KINDS = Object.freeze([
  'dry_run_ok', ...TRUSTED_APPLY_OUTCOME_KINDS,
]);

/** The EXACT verdict line the deploy CLI prints when — and only when — it is
 * safe to disconnect the show network after a to-swarm apply. */
export const VERDICT_SAFE_TO_KILL = 'VERDICT: SAFE TO KILL NETWORK';
/** The to-dmx apply success verdict line. */
export const VERDICT_DMX_OK = 'VERDICT: OK';
/** The clean dry-run verdict line. */
export const VERDICT_DRY_RUN = 'VERDICT: DRY RUN - no changes made';

/**
 * Pull the CLI's `VERDICT: …` line out of a run's captured output. The CLI
 * prints exactly one, at the end; we take the LAST match so a board whose
 * config echo happened to contain the word cannot spoof it mid-table.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function extractVerdictLine(output) {
  if (typeof output !== 'string') return null;
  const matches = output.match(/^VERDICT: .*$/gm);
  return matches && matches.length > 0 ? matches[matches.length - 1].trim() : null;
}

/** The first explicit CLI refusal/error line, suitable for the prominent UI.
 * A bare non-zero exit is not useful to an operator when the captured output
 * already names the preflight or apply failure. */
export function extractJobErrorLine(output) {
  if (typeof output !== 'string') return null;
  const line = output.split(/\r?\n/).map((candidate) => candidate.trim())
    .find((candidate) => /^(REFUSED|ERROR|FAILED|FATAL):/i.test(candidate));
  return line || null;
}

function outputPhase(output) {
  const text = typeof output === 'string' ? output.toLowerCase() : '';
  if (/roll(?:ed|ing)? back|rollback|restor(?:e|ed|ing)/.test(text)) return 'restoring';
  if (/reboot|awaiting.*boot|waiting.*boot/.test(text)) return 'rebooting';
  if (/verif(?:y|ied|ying)|readback|post[- ]?check/.test(text)) return 'verifying';
  if (/apply|writ(?:e|ing)|switching/.test(text)) return 'applying';
  if (/plan|dry[- ]?run/.test(text)) return 'planned';
  return 'preflight/read';
}

function controllerOutputPhase(target, output) {
  if (typeof output !== 'string') return null;
  const identities = [target.controllerId, target.ip, target.operatorLabel]
    .filter(Boolean).map((value) => String(value).toLowerCase());
  let phase = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.toLowerCase();
    if (!identities.some((identity) => line.includes(identity))) continue;
    if (/roll(?:ed|ing)? back|rollback|restor(?:e|ed|ing)/.test(line)) phase = 'restored';
    else if (/fail|refus|error|timeout|timed out/.test(line)) phase = 'failed';
    else if (/verif(?:y|ied)|readback.*ok|\bok\b/.test(line)) phase = 'verified';
    else if (/reboot|awaiting.*boot|waiting.*boot/.test(line)) phase = 'rebooting';
    else if (/apply|writ(?:e|ing)|switching/.test(line)) phase = 'applying';
    else if (/plan|dry[- ]?run/.test(line)) phase = 'planned';
    else if (/read|preflight|status|snapshot/.test(line)) phase = 'preflight/read';
  }
  return phase;
}

export function smokestackJobPhase(job) {
  if (!job) return 'IDLE';
  if (job.state === 'done') {
    const outcome = jobOutcomeModel(job);
    return TRUSTED_OUTCOME_KINDS.includes(outcome.kind)
      ? 'COMPLETE' : 'FAILED';
  }
  if (!job.apply) return 'PREFLIGHT/READ';
  return outputPhase(job.output).toUpperCase();
}

/**
 * One exact controller's transaction line. Fleet-wide state is used only for
 * phases that truly apply to every board (dry-run preflight and a running
 * transaction). Success is never derived from exit 0: final verification
 * needs both the trusted action verdict and the bounded board readback.
 */
export function smokestackControllerTransitionModel(target, job, status, readback = null,
  options = {}) {
  if (!job) return { label: '', cls: 'smk-transition-idle' };
  const isForce = FORCE_ACTIONS.includes(job.action);
  if (job.action === ACTION_REPAIR_TO_DMX || isForce) {
    if (!Array.isArray(job.targetIds)) {
      return { label: `${isForce ? 'force' : 'repair'} target set missing`,
        cls: 'smk-transition-danger' };
    }
    if (!job.targetIds.includes(target.controllerId)) {
      const board = smokestackBoardModel(target, status || null);
      // A follower's FORCE TO SWARM runs the leader in the same CLI target
      // set purely so the coherence check has a beacon source. The leader is
      // already in its target mode, so the CLI sends it NO mutation POST —
      // and this row says exactly that, then proves it after the readback.
      const isLeaderContext = isForce && Array.isArray(job.cliNames)
        && job.cliNames.includes(target.controllerId);
      if (isLeaderContext) {
        const settled = readback && readback.jobId === job.id && readback.state === 'done';
        if (!settled) return { label: 'context · no write expected', cls: 'smk-transition-plan' };
        const uptimeMs = status && status.health ? status.health.uptimeMs : null;
        const baseline = options.preUptimeMs;
        if (board.mode !== MODE_SWARM) {
          return { label: `context CHANGED · readback ${board.modeLabel}`,
            cls: 'smk-transition-danger' };
        }
        if (!Number.isFinite(baseline) || !Number.isFinite(uptimeMs)) {
          return { label: 'context unverified · no uptime baseline',
            cls: 'smk-transition-danger' };
        }
        if (uptimeMs < baseline) {
          return { label: 'context CHANGED · the board rebooted', cls: 'smk-transition-danger' };
        }
        return { label: 'context verified · unchanged', cls: 'smk-transition-ok' };
      }
      return { label: board.mode === MODE_UNKNOWN || board.mode === MODE_UNREACHABLE
        ? 'excluded · readback unavailable'
        : `excluded · ${isForce ? board.modeLabel : `healthy ${board.modeLabel}`}`,
      cls: 'smk-transition-idle' };
    }
  }
  const outcome = jobOutcomeModel(job);
  const isDryRun = !job.apply;
  const expectedMode = job.action === ACTION_TO_SWARM || job.action === ACTION_FORCE_TO_SWARM
    ? MODE_SWARM : MODE_DMX;
  const explicitPhase = controllerOutputPhase(target, job.output);

  if (readback && readback.jobId === job.id) {
    if (readback.state === 'pending' || readback.state === 'running') {
      return {
        label: `${explicitPhase || outputPhase(job.output)} · final readback…`,
        cls: 'smk-transition-running',
      };
    }
    if (readback.state === 'error') {
      return { label: 'unknown · final readback failed', cls: 'smk-transition-danger' };
    }
    if (readback.state === 'done') {
      const board = smokestackBoardModel(target, status || null);
      if (board.mode === MODE_UNREACHABLE) {
        return { label: 'failed readback · unreachable', cls: 'smk-transition-danger' };
      }
      if (board.mode === MODE_UNKNOWN) {
        return { label: 'unknown · saved/runtime mode unreadable', cls: 'smk-transition-danger' };
      }
      if (board.mode === MODE_INVALID) {
        return { label: 'failed readback · MIXED/INVALID', cls: 'smk-transition-danger' };
      }
      if (isDryRun) {
        const prefix = outcome.kind === 'dry_run_ok' ? 'planned · no writes' : 'preflight failed · no writes';
        return { label: `${prefix} · readback ${board.modeLabel}`, cls: outcome.kind === 'dry_run_ok'
          ? 'smk-transition-plan' : 'smk-transition-danger' };
      }
      const trusted = TRUSTED_APPLY_OUTCOME_KINDS.includes(outcome.kind);
      if (!trusted && explicitPhase === 'restored') {
        return { label: `restored · readback ${board.modeLabel}`, cls: 'smk-transition-plan' };
      }
      if (board.mode !== expectedMode) {
        return {
          label: `failed readback · ${board.modeLabel}, expected ${expectedMode.toUpperCase()}`,
          cls: 'smk-transition-danger',
        };
      }
      if (trusted && expectedMode === MODE_SWARM && !board.roleOk) {
        return { label: 'failed readback · SWARM topology unhealthy',
          cls: 'smk-transition-danger' };
      }
      if (trusted) {
        return { label: `verified · readback ${board.modeLabel}`, cls: 'smk-transition-ok' };
      }
      return {
        label: `${explicitPhase || 'unknown after failed apply'} · readback ${board.modeLabel}`,
        cls: explicitPhase === 'restored' ? 'smk-transition-plan' : 'smk-transition-danger',
      };
    }
  }

  if (job.state === 'done') {
    if (isDryRun) {
      return outcome.kind === 'dry_run_ok'
        ? { label: 'planned · no writes · readback pending', cls: 'smk-transition-plan' }
        : { label: 'preflight failed · no writes · readback pending',
          cls: 'smk-transition-danger' };
    }
    if (explicitPhase) {
      return { label: `${explicitPhase} · readback pending`, cls: explicitPhase === 'verified'
        ? 'smk-transition-plan' : 'smk-transition-danger' };
    }
    return { label: 'unknown after apply · readback pending', cls: 'smk-transition-danger' };
  }

  const phase = explicitPhase || (isDryRun ? 'preflight/read' : outputPhase(job.output));
  const labels = {
    rebooting: 'rebooting · temporary unreachable window',
    restoring: 'restoring previous mode',
  };
  return { label: labels[phase] || phase, cls: phase === 'failed'
    ? 'smk-transition-danger' : 'smk-transition-running' };
}

/**
 * The outcome model for one finished CLI job. This is where the panel's
 * loudest promise lives: after a to-swarm APPLY, `safeToKillNetwork` is true
 * ONLY when the CLI exited 0 AND printed the exact verdict line. Anything
 * else — a nonzero exit, a timeout, truncated output, a missing or different
 * verdict — is a DO-NOT-KILL result with the reason named. There is no
 * partial-success wording (mirrors the CLI's own contract).
 *
 * @param {{action, apply, state, exitCode, timedOut, outputTruncated, verdictLine}} job
 * @returns {{kind, headline, cls, safeToKillNetwork: boolean, reason: string}}
 */
export function jobOutcomeModel(job) {
  if (!job || job.state !== 'done') {
    return {
      kind: 'running', headline: 'running…', cls: 'smk-verdict-running',
      safeToKillNetwork: false, reason: 'the run has not finished',
    };
  }
  // Output-integrity failures void ANY verdict. Beyond those, a nonzero exit
  // is a failure whose best reason is the CLI's own failure verdict when one
  // was printed ("NOT SAFE - …" names the cause; a bare exit code does not).
  const cliFailureVerdict = job.verdictLine
    && job.verdictLine !== VERDICT_SAFE_TO_KILL
    && job.verdictLine !== VERDICT_DMX_OK
    && job.verdictLine !== VERDICT_DRY_RUN
    ? job.verdictLine : null;
  const outputFailure = extractJobErrorLine(job.output);
  const failureReason = job.timedOut
    ? 'the run TIMED OUT and was killed — board state is unverified'
    : job.outputTruncated
      ? 'the run\'s output overflowed and was truncated — the verdict cannot be trusted'
      : job.exitCode !== 0
        ? (cliFailureVerdict || outputFailure || `the CLI exited with code ${job.exitCode}`)
        : null;

  if (job.apply && job.action === ACTION_TO_SWARM) {
    if (!failureReason && job.verdictLine === VERDICT_SAFE_TO_KILL) {
      return {
        kind: 'safe_to_kill',
        headline: 'SAFE TO KILL NETWORK — every board verified in swarm mode ' +
          '(committed config, coherent, reboot-survived)',
        cls: 'smk-verdict-safe', safeToKillNetwork: true, reason: '',
      };
    }
    const reason = failureReason
      || (job.verdictLine ? job.verdictLine : 'the CLI printed no verdict line');
    return {
      kind: 'do_not_kill',
      headline: `DO NOT KILL THE NETWORK — ${reason}`,
      cls: 'smk-verdict-danger', safeToKillNetwork: false, reason,
    };
  }
  if (job.apply && job.action === ACTION_TO_DMX) {
    if (!failureReason && job.verdictLine === VERDICT_DMX_OK) {
      return {
        kind: 'dmx_ok', headline: 'All boards verified in DMX mode',
        cls: 'smk-verdict-safe', safeToKillNetwork: false, reason: '',
      };
    }
    const reason = failureReason
      || (job.verdictLine ? job.verdictLine : 'the CLI printed no verdict line');
    return {
      kind: 'apply_failed', headline: `Switch to DMX NOT verified — ${reason}`,
      cls: 'smk-verdict-danger', safeToKillNetwork: false, reason,
    };
  }
  if (job.apply && FORCE_ACTIONS.includes(job.action)) {
    // A force job moves ONE controller. `safeToKillNetwork` is false here
    // unconditionally — and a to-swarm run that named a leader-only target
    // set legitimately prints the CLI's fleet kill verdict (its terminal
    // check sees no followers to judge). We DOWNGRADE it on purpose.
    const id = Array.isArray(job.targetIds) && job.targetIds.length === 1
      ? job.targetIds[0] : '(no frozen target)';
    if (job.action === ACTION_FORCE_TO_DMX) {
      if (!failureReason && job.verdictLine === VERDICT_DMX_OK) {
        return {
          kind: 'force_dmx_ok',
          headline: `TARGET ${id} VERIFIED IN DMX BY CLI — fleet verdict pending independent ` +
            'readback',
          cls: 'smk-verdict-plan', safeToKillNetwork: false, reason: '',
        };
      }
    } else if (!failureReason
        && (job.verdictLine === VERDICT_SAFE_TO_KILL || job.verdictLine === VERDICT_DMX_OK)) {
      const downgraded = job.verdictLine === VERDICT_SAFE_TO_KILL
        ? 'the CLI printed its FLEET kill verdict for a ONE-controller run — downgraded here: ' +
          'a single forced controller can never make the fleet safe to disconnect'
        : '';
      return {
        kind: 'force_swarm_ok',
        headline: `TARGET ${id} ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN`,
        cls: 'smk-verdict-plan', safeToKillNetwork: false, reason: downgraded,
      };
    }
    const reason = failureReason
      || (job.verdictLine ? job.verdictLine : 'the CLI printed no verdict line');
    return {
      kind: 'force_failed',
      headline: `FORCE ${job.action === ACTION_FORCE_TO_DMX ? 'TO DMX' : 'TO SWARM'} on ${id} ` +
        `NOT verified — ${reason}`,
      cls: 'smk-verdict-danger', safeToKillNetwork: false, reason,
    };
  }
  if (job.apply && job.action === ACTION_REPAIR_TO_DMX) {
    if (!failureReason && job.verdictLine === VERDICT_DMX_OK) {
      const count = Array.isArray(job.targetIds) ? job.targetIds.length : 0;
      return {
        kind: 'repair_ok', headline: `${count} controller(s) repaired and verified in DMX mode`,
        cls: 'smk-verdict-safe', safeToKillNetwork: false, reason: '',
      };
    }
    const reason = failureReason
      || (job.verdictLine ? job.verdictLine : 'the CLI printed no verdict line');
    return {
      kind: 'repair_failed', headline: `Targeted DMX repair NOT verified — ${reason}`,
      cls: 'smk-verdict-danger', safeToKillNetwork: false, reason,
    };
  }
  // Dry-run (and the CLI `status` sub-command, if ever surfaced). Exit zero is
  // not enough: the exact dry-run verdict proves the captured output is intact
  // and that the run actually followed the no-write path.
  const dryRunVerdictFailure = !failureReason && job.verdictLine !== VERDICT_DRY_RUN
    ? (job.verdictLine
      ? `unexpected dry-run verdict '${job.verdictLine}'`
      : 'the CLI printed no dry-run verdict line')
    : !failureReason && !/^[0-9a-f]{64}$/.test(job.planFingerprint || '')
      ? 'the CLI printed no exact SHA-256 plan fingerprint'
      : null;
  if (!failureReason && !dryRunVerdictFailure) {
    return {
      kind: 'dry_run_ok',
      headline: 'Dry-run passed — zero writes were made. Review the plan above, then arm the ' +
        'apply step.',
      cls: 'smk-verdict-plan', safeToKillNetwork: false, reason: '',
    };
  }
  const dryRunFailure = failureReason || dryRunVerdictFailure;
  return {
    kind: 'dry_run_refused',
    headline: `Dry-run REFUSED — ${dryRunFailure}. Nothing was written; fix the named cause ` +
      'before switching.',
    cls: 'smk-verdict-danger', safeToKillNetwork: false, reason: dryRunFailure,
  };
}

/**
 * May the APPLY button arm? Pure gate the panel renders from: a completed,
 * clean dry-run for the SAME action plus the exact typed phrase.
 *
 * FORCE actions (Advanced Recovery) add four more terms, all mandatory:
 * the dry-run's frozen targetIds must be exactly `[controllerId]`, the typed
 * phrase must be that controller's own `FORCE DMX/SWARM <id>`, the dry-run
 * must be younger than FORCE_DRY_RUN_FRESH_MS, and the preflight digest the
 * panel just recomputed must equal the one frozen into the dry-run — any
 * state drift between plan and apply refuses.
 *
 * @param {{action, apply, state, exitCode, timedOut, outputTruncated,
 *          verdictLine, planFingerprint, targetIds, preflightDigest,
 *          endedAt}|null} dryRunJob
 * @param {string} action
 * @param {string} typedPhrase
 * @param {{controllerId?: string, preflightDigest?: string, now?: number}} [options]
 * @returns {{allowed: boolean, reason: string}}
 */
export function applyGateModel(dryRunJob, action, typedPhrase, options = {}) {
  if (!dryRunJob || dryRunJob.action !== action || dryRunJob.apply) {
    return { allowed: false, reason: `run the ${action} dry-run first` };
  }
  if (dryRunJob.state !== 'done') {
    return { allowed: false, reason: 'the dry-run is still running' };
  }
  if (dryRunJob.exitCode !== 0) {
    return { allowed: false, reason: 'the dry-run was refused — fix the named cause and re-run' };
  }
  if (dryRunJob.timedOut || dryRunJob.outputTruncated
      || dryRunJob.verdictLine !== VERDICT_DRY_RUN) {
    return { allowed: false, reason: 'the dry-run has no exact trusted no-write verdict — ' +
      're-run it before applying' };
  }
  if (!/^[0-9a-f]{64}$/.test(dryRunJob.planFingerprint || '')) {
    return { allowed: false, reason: 'the dry-run has no exact SHA-256 plan fingerprint — ' +
      're-run it before applying' };
  }
  if (FORCE_ACTIONS.includes(action)) {
    const { controllerId, preflightDigest: expectedDigest, now = Date.now() } = options;
    if (!SMOKESTACK_CONTROLLER_IDS.includes(controllerId)) {
      return { allowed: false, reason: 'select exactly one of the four approved smokestack ' +
        'controller IDs before arming a force apply' };
    }
    const frozen = dryRunJob.targetIds;
    if (!Array.isArray(frozen) || frozen.length !== 1 || frozen[0] !== controllerId) {
      return { allowed: false, reason: 'the dry-run was planned for a different controller — ' +
        're-run the dry-run for this one' };
    }
    if (Number.isFinite(dryRunJob.endedAt) && now - dryRunJob.endedAt > FORCE_DRY_RUN_FRESH_MS) {
      return { allowed: false, reason: `the force dry-run is older than ` +
        `${Math.round(FORCE_DRY_RUN_FRESH_MS / 60000)} minutes — re-run it` };
    }
    if (typeof expectedDigest !== 'string' || expectedDigest.length === 0
        || dryRunJob.preflightDigest !== expectedDigest) {
      return { allowed: false, reason: 'state drifted since the dry-run — re-run' };
    }
    if (typedPhrase !== forceConfirmPhrase(action, controllerId)) {
      return {
        allowed: false,
        reason: `type ${forceConfirmPhrase(action, controllerId)} exactly to arm the apply step`,
      };
    }
    return { allowed: true, reason: '' };
  }
  if (typedPhrase !== CONFIRM_PHRASES[action]) {
    return {
      allowed: false,
      reason: `type ${CONFIRM_PHRASES[action]} exactly to arm the apply step`,
    };
  }
  return { allowed: true, reason: '' };
}

// ── Advanced Recovery model ─────────────────────────────────────────────────

/**
 * The EXACT typed phrase a force action requires, derived per controller so a
 * phrase armed for one board can never arm another. Never table-looked-up.
 */
export function forceConfirmPhrase(action, controllerId) {
  if (!SMOKESTACK_CONTROLLER_IDS.includes(controllerId)) {
    throw new Error(`[Smokestack Force] '${controllerId}' is not one of the four approved ` +
      `smokestack controller IDs (${SMOKESTACK_CONTROLLER_IDS.join(', ')})`);
  }
  if (action === ACTION_FORCE_TO_DMX) return `FORCE DMX ${controllerId}`;
  if (action === ACTION_FORCE_TO_SWARM) return `FORCE SWARM ${controllerId}`;
  throw new Error(`[Smokestack Force] '${action}' is not a force action ` +
    `(${FORCE_ACTIONS.join(', ')})`);
}

/**
 * A stable, order-fixed fingerprint of the fleet state a force plan was
 * reviewed against. Recomputed after the dry-run and again immediately before
 * APPLY: any difference refuses the apply as drift.
 *
 * Beacon age is deliberately EXCLUDED — it changes every second and would
 * make every plan stale. `followState` is included, because DETACHED →
 * FOLLOWING is a real change that invalidates the plan's premise.
 */
export function preflightDigest(targets, statuses) {
  const byId = statuses instanceof Map ? statuses : new Map();
  const byControllerId = new Map((Array.isArray(targets) ? targets : [])
    .map((target) => [target.controllerId, target]));
  return SMOKESTACK_CONTROLLER_IDS.map((controllerId) => {
    const target = byControllerId.get(controllerId) || null;
    const status = target ? byId.get(target.id) || null : null;
    const board = target ? smokestackBoardModel(target, status) : null;
    const sw = (status && status.swarm) || {};
    const health = (status && status.health) || {};
    const caps = (status && status.capabilities) || {};
    return [
      controllerId,
      board ? board.mode : MODE_UNKNOWN,
      status ? String(sw.isLeader === true) : '?',
      sw.followState || '?',
      status ? String(health.stagedPending === true) : '?',
      health.configSource || '?',
      status ? String(caps.perOutputDmx === true) : '?',
      (status && status.firmwareTag) || '?',
      String(!!(status && status.reachable === true)),
    ].join('|');
  }).join(';');
}

/** Rendered verbatim in the panel: what a force NEVER steps around. */
const FORCE_STILL_REFUSES_COMMON = Object.freeze([
  'an unreachable board, or one whose saved mode cannot be read',
  'a board reporting a controllerId other than the one this scene card is bound to',
  'a board the deploy CLI cannot match to its registry MAC',
  'a STAGED/unconfirmed config, or a board running on a degraded (non-primary) configSource',
  'firmware without per-output DMX (capabilitiesExt.perOutputDmx)',
  'any disagreement between the scene output map and the board\'s live sACN origins',
  'any plan that would alter identity, saved roles, output mapping, universes, pins, ' +
    'pixel counts, colour order or on-board assets',
]);
const FORCE_STILL_REFUSES_SWARM = Object.freeze([
  ...FORCE_STILL_REFUSES_COMMON,
  'the deploy CLI\'s frozen-asset validation — a board off the frozen release still refuses',
  'the active map / active pattern validation',
  'the saved role authority — only ss_left_right may be leader; the other three are followers',
  'leader uniqueness — a second board reporting isLeader blocks every SWARM force',
  'a follower without a healthy, freshly beaconing sole leader',
  'a FLEET verdict: a one-controller SWARM force NEVER yields SAFE TO KILL NETWORK. Only ' +
    'the canonical four-board TO SWARM flow can, and only after fleet asset parity is restored',
]);

function forceStillRefuses(action) {
  return action === ACTION_FORCE_TO_SWARM
    ? [...FORCE_STILL_REFUSES_SWARM] : [...FORCE_STILL_REFUSES_COMMON];
}

function livePerOutputRows(status) {
  const rows = status && status.sacn && status.sacn.perOutput;
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) => row && row.enabled !== false);
}

function preservedOutputs(target, status) {
  const live = livePerOutputRows(status);
  const outputs = (target.ports || []).map((port) => {
    // The board indexes strands from 0; the scene numbers outputs from 1.
    const liveRow = live ? live.find((row) => row.index === port.output - 1) || null : null;
    return {
      output: port.output,
      strand: port.strand,
      universe: port.universe,
      address: port.startAddress,
      px: port.pixelCount,
      live: liveRow ? { universe: liveRow.universe, address: liveRow.startAddress } : null,
      agrees: liveRow
        ? liveRow.universe === port.universe && liveRow.startAddress === port.startAddress
        : null,
    };
  });
  return {
    outputs,
    verified: live !== null && outputs.length > 0 && outputs.every((row) => row.agrees === true),
    disagrees: outputs.some((row) => row.agrees === false)
      || (live !== null && live.length !== outputs.length),
  };
}

/**
 * The Advanced Recovery decision for ONE controller. Pure: the panel renders
 * it, the tests pin it, and the server independently re-derives the same
 * target/allowlist/phrase rules before it will spawn anything.
 *
 * @param {Array} targets the four semantic targets (smokestackTargets)
 * @param {Map} statuses target.id → /smokestack/status result
 * @param {{sweptAt?, sweeping?, resultIds?}} readback the bounding sweep
 * @param {{controllerId, action}} request the operator's exact selection
 * @param {number} [now]
 */
export function smokestackForceRecoveryModel(targets, statuses, readback = {},
  { controllerId, action } = {}, now = Date.now()) {
  const list = Array.isArray(targets) ? targets : [];
  const byId = statuses instanceof Map ? statuses : new Map();
  const resultIds = readback.resultIds instanceof Set ? readback.resultIds : new Set();
  const blockers = [];
  const bypasses = [];
  const validAction = FORCE_ACTIONS.includes(action);
  const ageMs = Number.isFinite(readback.sweptAt) ? Math.max(0, now - readback.sweptAt) : Infinity;

  const rows = list.map((target) => ({
    target,
    status: byId.get(target.id) || null,
    board: smokestackBoardModel(target, byId.get(target.id) || null),
  }));
  const targetRow = rows.find((row) => row.target.controllerId === controllerId) || null;

  const result = {
    visible: list.length === SMOKESTACK_CONTROLLER_IDS.length,
    eligible: false,
    action: validAction ? action : null,
    controllerId: targetRow ? targetRow.target.controllerId : null,
    target: targetRow ? targetRow.target : null,
    targetState: {
      mode: targetRow ? targetRow.board.mode : MODE_UNKNOWN,
      role: targetRow ? targetRow.board.role : '',
      followState: targetRow && targetRow.status && targetRow.status.swarm
        ? targetRow.status.swarm.followState : null,
      beaconAgeMs: targetRow && targetRow.status && targetRow.status.swarm
        ? targetRow.status.swarm.lastBeaconMsAgo : null,
      readbackAgeMs: ageMs,
    },
    blockers,
    bypasses,
    stillRefuses: forceStillRefuses(action),
    preserved: { role: null, outputs: [], mappingVerified: false },
    consequence: '',
    cliNames: [],
    leaderContextRequired: false,
    preflightDigest: preflightDigest(list, byId),
  };

  if (!validAction) {
    blockers.push(`'${action}' is not a force action`);
    return result;
  }
  if (!result.visible) {
    blockers.push('the exact four-controller scene binding is not present');
    return result;
  }
  // Selection: the semantic controllerId ONLY. An IP, a card name, a numeric
  // scene id, free text, or more than one id never selects anything.
  if (!targetRow) {
    blockers.push('unknown/ambiguous identity — select exactly one of the four approved ' +
      'smokestack controller IDs');
    return result;
  }

  result.preserved.role = targetRow.target.expectedLeader ? 'saved leader' : 'saved follower';
  const mapping = preservedOutputs(targetRow.target, targetRow.status);
  result.preserved.outputs = mapping.outputs;
  result.preserved.mappingVerified = mapping.verified;

  // Readback freshness gates everything below it — the whole point is that
  // this decision was made from state nobody had to guess at.
  if (readback.sweeping === true) blockers.push('status readback is still running');
  else if (ageMs > FORCE_READBACK_MAX_AGE_MS) blockers.push('status readback is stale — refresh');

  // The consequence line and the leader rule both need all four boards.
  for (const row of rows) {
    if (!resultIds.has(row.target.id)) {
      blockers.push(`full four-controller readback required — ${row.target.operatorLabel} is ` +
        'missing from the sweep');
    } else if (row.board.mode === MODE_UNREACHABLE) {
      blockers.push(`full four-controller readback required — ${row.target.operatorLabel} is ` +
        'unreachable');
    } else if (row.board.mode === MODE_UNKNOWN) {
      blockers.push(`full four-controller readback required — ${row.target.operatorLabel} mode ` +
        'is unknown');
    }
  }

  const status = targetRow.status;
  const swarm = (status && status.swarm) || {};
  const health = (status && status.health) || {};
  const caps = (status && status.capabilities) || {};
  if (!status || status.reachable !== true) {
    blockers.push('target is unreachable');
  } else if (status.controllerId !== targetRow.target.controllerId) {
    blockers.push('unknown/ambiguous identity — the board at this binding reports ' +
      `'${status.controllerId || '(identity unavailable)'}'`);
  }
  if (targetRow.board.mode === MODE_UNKNOWN) blockers.push('target mode is unknown');
  if (targetRow.board.mode === MODE_INVALID) {
    blockers.push('dual/none-enabled board: use Repair to DMX, not force');
  }
  if (health.stagedPending === true) blockers.push('a STAGED config is pending on the target');
  if (health.configSource && health.configSource !== 'primary') {
    blockers.push(`target runs on a degraded configSource '${health.configSource}'`);
  }
  if (caps.perOutputDmx !== true) {
    blockers.push('target firmware lacks per-output DMX (capabilitiesExt.perOutputDmx)');
  }
  if (mapping.disagrees) {
    blockers.push('uncertain mapping — the board\'s live sACN origins disagree with the ' +
      'scene output map');
  }

  const dmxCount = rows.filter((row) => row.board.mode === MODE_DMX).length;
  const swarmCount = rows.filter((row) => row.board.mode === MODE_SWARM).length;
  const leaderRow = rows.find(
    (row) => row.target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID) || null;
  const duplicateLeaders = rows.filter((row) =>
    row.target.controllerId !== SMOKESTACK_LEADER_CONTROLLER_ID
    && row.status && row.status.swarm && row.status.swarm.isLeader === true);

  if (action === ACTION_FORCE_TO_DMX) {
    if (targetRow.board.mode === MODE_SWARM) {
      if (targetRow.board.roleOk !== true) {
        bypasses.push(`the live SWARM role/coherence gate (${targetRow.board.readinessLabel}: ` +
          `${swarm.followState || 'state ?'})`);
      }
      if (dmxCount > 0) bypasses.push('the fleet-coherence gate on an already MIXED fleet');
      bypasses.push('the canonical four-board asset/parity contract — this run names ONE ' +
        'controller, so the CLI does not evaluate fleet asset parity for it');
      result.consequence = `fleet becomes MIXED — ${dmxCount + 1} DMX / ${swarmCount - 1} SWARM`;
    } else if (targetRow.board.mode === MODE_DMX) {
      result.consequence = 'no change expected — the target is already in DMX (idempotent: the ' +
        'CLI sends no mutation POST and re-verifies)';
    }
    result.cliNames = [targetRow.target.controllerId];
  } else {
    // FORCE TO SWARM. Nothing here bypasses asset validation, role authority,
    // or leader uniqueness — those are the CLI's, and they stay.
    if (duplicateLeaders.length > 0) {
      blockers.push('duplicate leader — ' +
        `${duplicateLeaders.map((row) => row.target.controllerId).join(', ')} reports ` +
        `isLeader while the saved sole leader is ${SMOKESTACK_LEADER_CONTROLLER_ID}`);
    }
    if (targetRow.target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID) {
      result.cliNames = [SMOKESTACK_LEADER_CONTROLLER_ID];
    } else {
      if (swarm.isLeader === true) {
        blockers.push('saved role authority — this follower slot claims isLeader; only ' +
          `${SMOKESTACK_LEADER_CONTROLLER_ID} may be leader`);
      }
      const leaderHealthy = !!leaderRow && leaderRow.board.mode === MODE_SWARM
        && leaderRow.board.roleOk === true;
      if (!leaderHealthy) {
        blockers.push('follower cannot enter SWARM without a healthy fresh sole leader ' +
          `(${SMOKESTACK_LEADER_CONTROLLER_ID})`);
      }
      result.leaderContextRequired = true;
      result.cliNames = [SMOKESTACK_LEADER_CONTROLLER_ID, targetRow.target.controllerId];
    }
    if (targetRow.board.mode === MODE_DMX) {
      bypasses.push('the fleet-wide TO SWARM flow — this moves ONE controller and proves ' +
        'nothing about fleet coherence');
      result.consequence = `fleet becomes MIXED — ${dmxCount - 1} DMX / ${swarmCount + 1} SWARM`;
    } else if (targetRow.board.mode === MODE_SWARM) {
      result.consequence = 'no mode change expected — the target is already in SWARM, so the ' +
        'CLI sends no mutation POST and only re-verifies (a DETACHED follower is NOT healed ' +
        'this way: force it to DMX first)';
    }
  }

  result.eligible = blockers.length === 0;
  return result;
}

/**
 * The fleet-level sentence a finished force job is allowed to print. It is
 * NEVER a fleet-safety claim: one controller's success says nothing about the
 * other three, and this function can never return a string containing
 * `SAFE TO KILL`.
 *
 * @param {string} action
 * @param {string} controllerId
 * @param {Array<{controllerId: string, mode: string}>} boards post-readback
 */
export function forceFleetVerdict(action, controllerId, boards) {
  const rows = Array.isArray(boards) ? boards : [];
  if (rows.length !== SMOKESTACK_CONTROLLER_IDS.length) {
    return 'TARGET NOT VERIFIED — the final four-controller readback is incomplete ' +
      `(${rows.length}/${SMOKESTACK_CONTROLLER_IDS.length})`;
  }
  const targetRow = rows.find((row) => row.controllerId === controllerId) || null;
  if (!targetRow) {
    return `TARGET NOT VERIFIED — ${controllerId} is missing from the final readback`;
  }
  const expectedMode = action === ACTION_FORCE_TO_SWARM ? MODE_SWARM : MODE_DMX;
  if (targetRow.mode !== expectedMode) {
    const pres = MODE_PRESENTATION[targetRow.mode] || MODE_PRESENTATION[MODE_UNKNOWN];
    return `TARGET NOT VERIFIED — ${controllerId} reads ${pres.label}, ` +
      `expected ${expectedMode.toUpperCase()}`;
  }
  if (action === ACTION_FORCE_TO_SWARM) {
    return 'TARGET ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN';
  }
  return rows.every((row) => row.mode === MODE_DMX)
    ? 'TARGET RECOVERED TO DMX — FLEET NOW ALL DMX (re-run the fleet readback before any ' +
      'fleet action)'
    : 'TARGET RECOVERED TO DMX — FLEET REMAINS MIXED';
}

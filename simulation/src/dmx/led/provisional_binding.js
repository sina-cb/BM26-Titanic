/**
 * provisional_binding.js — the PROVISIONAL → VERIFIED half of the LED
 * controller lifecycle (operator ruling 2026-07-31: "the discovery must be an
 * optional stage in the controller lifecycle and not required — that allows me
 * to put the IP I want and not have to start the controller just yet, until
 * next boot; on first boot and recognition of the board you can get missing
 * data if anything from the board itself").
 *
 * PURE: no DOM, no network, no registry mutation. The UI (led_discovery_panel)
 * and the status prober both funnel their FIRST CONTACT through
 * `reconcileProvisionalContact` and act on its verdict; the mutation itself is
 * `promoteProvisionalBinding` in controller_registry.js.
 *
 * ── The lifecycle ────────────────────────────────────────────────────────────
 *
 *   unbound ──"⚑ Mark provisional"──▶ PROVISIONAL ──first contact, clean──▶ VERIFIED
 *      ▲                                   │                                  │
 *      └────────── unbind ─────────────────┴──first contact, CONTRADICTED──▶ reconcile
 *                                                        (stays PROVISIONAL,
 *                                                         loud dialog, operator
 *                                                         picks — never us)
 *
 * ── What counts as a CONTRADICTION ──────────────────────────────────────────
 * Only things that make the BINDING ITSELF wrong — i.e. "this is not the board
 * you described, or it cannot serve this card":
 *
 *   `device_not_recognized`  the host answered but is not a MarsinLED (no
 *                            controllerId / boardId / strands fingerprint).
 *   `controller_id_claimed`  another card in this scene is already VERIFIED
 *                            against this fingerprint — two cards, one board.
 *   `ip_mismatch`            the device was found at a different IP than the
 *                            one the operator typed (discovery-panel path).
 *   `per_output_unsupported` the firmware predates per-output DMX, which is the
 *                            only addressing model this sim projects (docs/41).
 *   `board_output_count`     a port row drives a physical output the board does
 *                            not have (card says P3→output 6, board has 4).
 *   `board_id_mismatch`      the operator STATED an expected boardId and the
 *                            board disagrees.
 *   `device_name_mismatch`   same, for a stated deviceName.
 *
 * ── What is deliberately NOT a contradiction ────────────────────────────────
 * Per-output universes, enabled/disabled outputs and pixel counts on the board.
 * Those are exactly what a push is FOR, and a fresh board disagrees with the
 * scene on all of them by definition — treating them as binding failures would
 * make every first contact refuse to promote. That drift is already measured,
 * named and shown by the sync chip (`computeSyncState`), which is the right
 * surface for it. Promotion answers "is this the board?", the sync chip answers
 * "does the board carry the plan?".
 *
 * NO FALLBACKS (codex P0): a contradicted contact NEVER auto-picks a side. It
 * does not overwrite the operator's config from the board, and it does not push
 * the operator's config onto the board. It stays provisional and says exactly
 * what disagreed.
 */

import { deviceSupportsPerOutput } from './marsinled_client.js';
import {
  LED_DEVICE_VENDOR_MARSINLED,
  controllerBoundToDeviceId,
  isProvisionalLedController,
  ledOutputIndexForPort,
} from '../controller_registry.js';

export const PROVISIONAL_MISMATCH_CODES = [
  'device_not_recognized',
  'controller_id_claimed',
  'ip_mismatch',
  'per_output_unsupported',
  'board_output_count',
  'board_id_mismatch',
  'device_name_mismatch',
];

/**
 * Mismatches that can NEVER be resolved by "promote anyway": promoting past
 * them would write a fingerprint that is either unreadable or already owned by
 * another card. Everything else is a real (loud) operator choice — accept the
 * board as it is, or go fix the card.
 */
export const PROVISIONAL_HARD_BLOCKERS = ['device_not_recognized', 'controller_id_claimed'];

/** True iff a device object carries the 3-field MarsinLED fingerprint. */
function isRecognizedDevice(device) {
  return !!device
    && typeof device.controllerId === 'string' && device.controllerId.length > 0
    && typeof device.boardId === 'string' && device.boardId.length > 0
    && Array.isArray(device.strands);
}

function mismatch(code, message, expected, actual) {
  return { code, message, expected, actual };
}

/**
 * Compare a PROVISIONAL card against the board that just answered at its IP.
 *
 * @param {Object} controller - the provisional LED card.
 * @param {Object} device - a discovered-device shape (marsinled_client
 *   `buildDiscoveredDevice`, or anything carrying
 *   `{ip, controllerId, boardId, strands, deviceName?, raw?}`). `raw` (or
 *   `status`) is the `/api/status` body used for the capability check.
 * @param {{registry?: Object, status?: Object}} [opts]
 *   `registry` enables the "another card already owns this fingerprint" check —
 *   omit it and that check is SKIPPED (stated in `checkedClaims`), never
 *   silently assumed to pass.
 * @returns {{ok: boolean, mismatches: Array<{code,message,expected,actual}>,
 *   identity: {vendor, controllerId, deviceName, boardId}|null,
 *   hardBlocked: boolean, checkedClaims: boolean}}
 */
export function reconcileProvisionalContact(controller, device, opts = {}) {
  if (!isProvisionalLedController(controller)) {
    throw new Error('[Provisional] reconcileProvisionalContact: ' +
      `'${controller && controller.name}' does not carry a PROVISIONAL binding — there is ` +
      'nothing to promote');
  }
  const mismatches = [];
  const registry = opts.registry || null;

  if (!isRecognizedDevice(device)) {
    mismatches.push(mismatch('device_not_recognized',
      `${(device && device.ip) || controller.ip} answered, but it is not a MarsinLED ` +
      '(no controllerId / boardId / strands in /api/status). Check the IP typed on ' +
      `'${controller.name}'.`,
      'a MarsinLED /api/status fingerprint',
      device && device.controllerId ? String(device.controllerId) : 'no fingerprint'));
    // Nothing below can be evaluated against a device we cannot identify.
    return {
      ok: false, mismatches, identity: null, hardBlocked: true, checkedClaims: false,
    };
  }

  if (device.ip && controller.ip && device.ip !== controller.ip) {
    mismatches.push(mismatch('ip_mismatch',
      `'${controller.name}' was declared at ${controller.ip}, but this board answered at ` +
      `${device.ip}. Promoting would bind the card to a box at a different address than the ` +
      'one typed.', controller.ip, device.ip));
  }

  const claimed = controllerBoundToDeviceId(registry, device.controllerId, controller);
  if (claimed) {
    mismatches.push(mismatch('controller_id_claimed',
      `device '${device.controllerId}' is ALREADY verified on controller '${claimed.name}' — ` +
      'two cards cannot own one board.', `unclaimed '${device.controllerId}'`, claimed.name));
  }

  const status = opts.status || device.raw || device.status || null;
  if (!deviceSupportsPerOutput(status)) {
    mismatches.push(mismatch('per_output_unsupported',
      `${device.ip || controller.ip} does not advertise per-output DMX ` +
      '(capabilitiesExt.perOutputDmx) — this sim projects the per-output layout only ' +
      '(docs/41 §3). Update the firmware before binding.',
      'capabilitiesExt.perOutputDmx = true', 'absent / false'));
  }

  const boardOutputs = device.strands.length;
  const overshoot = (controller.ports || [])
    // A port with no integer `output` never came through createControllerRegistry;
    // that is the loader's / the projection's loud error to raise, not a binding
    // contradiction, so it is not silently counted as one here either.
    .filter((p) => Number.isInteger(p && p.output) && ledOutputIndexForPort(p) >= boardOutputs)
    .map((p) => `P${p.port}→output ${p.output}`);
  if (overshoot.length) {
    mismatches.push(mismatch('board_output_count',
      `the board reports ${boardOutputs} output(s), but '${controller.name}' drives ` +
      `${overshoot.join(', ')} — those port rows address hardware that does not exist.`,
      `outputs ≤ ${boardOutputs}`, overshoot.join(', ')));
  }

  const expected = controller.device;
  if (expected.boardId && device.boardId && expected.boardId !== device.boardId) {
    mismatches.push(mismatch('board_id_mismatch',
      `'${controller.name}' expected board '${expected.boardId}', the box says ` +
      `'${device.boardId}'.`, expected.boardId, device.boardId));
  }
  const reportedName = device.deviceName || null;
  if (expected.deviceName && reportedName && expected.deviceName !== reportedName) {
    mismatches.push(mismatch('device_name_mismatch',
      `'${controller.name}' expected device name '${expected.deviceName}', the box says ` +
      `'${reportedName}'.`, expected.deviceName, reportedName));
  }

  const hardBlocked = mismatches.some((m) => PROVISIONAL_HARD_BLOCKERS.includes(m.code));
  return {
    ok: mismatches.length === 0,
    mismatches,
    // The identity we WOULD write. Present even when contradicted, so the
    // reconcile dialog can show the operator exactly what "promote anyway"
    // would record — never a hidden value.
    identity: {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: device.controllerId,
      deviceName: reportedName || undefined,
      boardId: device.boardId,
    },
    hardBlocked,
    checkedClaims: !!registry,
  };
}

/**
 * One-line summary of a reconcile verdict, for a toast or a console line. The
 * full per-mismatch text lives in `result.mismatches[].message`.
 */
export function describeProvisionalReconcile(controller, result) {
  if (result.ok) {
    return `'${controller.name}' promoted to VERIFIED — device ${result.identity.controllerId}` +
      `${result.identity.boardId ? ` (${result.identity.boardId})` : ''}`;
  }
  const codes = result.mismatches.map((m) => m.code).join(', ');
  return `'${controller.name}' stays PROVISIONAL — the board contradicts the declared ` +
    `binding (${codes}). Nothing was changed on the card or the board.`;
}

/**
 * The PROVISIONAL LED cards this discovered device could be first contact for,
 * matched by IP.
 *
 * Provisional cards are matched by IP ON PURPOSE, and this is NOT a weakening of
 * the bind-by-controllerId doctrine (docs/41): a provisional card has no
 * fingerprint to match on, and the IP is the one thing the operator actually
 * asserted. The moment the match succeeds the card is promoted and every later
 * match runs on controllerId like everything else.
 */
export function provisionalCandidatesForDevice(registry, device) {
  if (!registry || !Array.isArray(registry.controllers) || !device || !device.ip) return [];
  return registry.controllers.filter((c) => isProvisionalLedController(c) && c.ip === device.ip);
}

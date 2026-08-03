/**
 * controller_status.js — the PURE model behind the controller pane's status dot
 * and its LED binding-grade badge. No DOM, no network: the editor renders from
 * these shapes and the tests assert them without a browser.
 *
 * Two INDEPENDENT facts share the card header, and conflating them is exactly
 * the confusion this feature exists to kill:
 *
 *   STATUS  is the box reachable RIGHT NOW? (online / offline / unknown —
 *           measured server-side by server/controller_probe_service.cjs)
 *   GRADE   is this card's binding operator-declared or hardware-verified?
 *           (unbound / provisional / verified — LED cards only)
 *
 * A PROVISIONAL card that is OFFLINE is the normal, healthy, intended state of
 * this feature: the operator typed the IP, the whole chain is patched, and the
 * board is still in its box. A VERIFIED card that is OFFLINE is a problem. The
 * pane has to be able to say both, so the two chips never merge.
 *
 * `unknown` never renders as offline (codex P0 applies to display truth too —
 * a probe we did not perform must not be shown as a measurement we did).
 */

import {
  CONTROLLER_TYPE_LED,
  LED_BINDING_PROVISIONAL,
  LED_BINDING_VERIFIED,
  isLedController,
  isValidIp,
  ledBindingGrade,
} from './controller_registry.js';

export const PROBE_STATE_ONLINE = 'online';
export const PROBE_STATE_OFFLINE = 'offline';
export const PROBE_STATE_UNKNOWN = 'unknown';
/** Client-only: a sweep is in flight and this card has no verdict yet. */
export const PROBE_STATE_CHECKING = 'checking';

export const PLACEHOLDER_IP = '0.0.0.0';

/**
 * The probe targets for a registry — one per controller, in pane order.
 * Cards with no IP / the placeholder sentinel are INCLUDED on purpose: the
 * server answers `unknown` with the reason, which is what the dot must show.
 * Filtering them out here would leave those cards with a blank header and no
 * explanation.
 */
export function controllerProbeTargets(registry) {
  if (!registry || !Array.isArray(registry.controllers)) return [];
  return registry.controllers.map((c) => ({
    id: c.id,
    name: c.name,
    ip: c.ip || '',
    type: isLedController(c) ? CONTROLLER_TYPE_LED : 'DMX',
  }));
}

/**
 * Fold a `/controllers/probe` response into the pane's cache (a plain Map keyed
 * by controller id). Returns the SAME map for chaining. A result for an id the
 * pane no longer has is dropped silently — the card was deleted mid-sweep, and
 * carrying it would resurrect a dot for nothing.
 */
export function mergeProbeResults(cache, response, knownIds) {
  const results = (response && Array.isArray(response.results)) ? response.results : [];
  for (const r of results) {
    if (!r || r.id === undefined) continue;
    if (knownIds && !knownIds.has(r.id)) continue;
    cache.set(r.id, r);
  }
  return cache;
}

const STATUS_PRESENTATION = {
  [PROBE_STATE_ONLINE]: { dot: '●', label: 'ONLINE', cls: 'cm-status-online' },
  [PROBE_STATE_OFFLINE]: { dot: '○', label: 'OFFLINE', cls: 'cm-status-offline' },
  [PROBE_STATE_UNKNOWN]: { dot: '◌', label: 'UNKNOWN', cls: 'cm-status-unknown' },
  [PROBE_STATE_CHECKING]: { dot: '⋯', label: 'CHECKING', cls: 'cm-status-checking' },
};

/**
 * The status-dot model for one card.
 *
 * @param {Object} controller
 * @param {Object|null} probe - this card's entry from the probe cache, or null
 *   when no sweep has answered for it yet.
 * @param {{sweeping?: boolean}} [opts] - `sweeping` renders the pre-verdict
 *   'checking' state instead of inventing one.
 * @returns {{state, dot, label, cls, title}}
 */
export function controllerStatusModel(controller, probe, opts = {}) {
  const state = probe && probe.state
    ? probe.state
    : (opts.sweeping ? PROBE_STATE_CHECKING : PROBE_STATE_UNKNOWN);
  const pres = STATUS_PRESENTATION[state] || STATUS_PRESENTATION[PROBE_STATE_UNKNOWN];
  const lines = [];
  const isLed = isLedController(controller);
  lines.push(isLed
    ? 'Probed over HTTP GET /api/status — MarsinLED boards do not answer ICMP (docs/41 §2).'
    : 'Probed by TCP connect (:80, then :8080). sACN/Art-Net receivers answer nothing on ' +
      'the data path, so a refused connection is itself proof the box is on the network.');
  if (probe && probe.detail) lines.push(probe.detail);
  if (!probe && !opts.sweeping) lines.push('No probe has answered for this controller yet.');
  if (probe && probe.at) lines.push(`last probe ${new Date(probe.at).toLocaleTimeString()}` +
    (Number.isFinite(probe.rttMs) && probe.rttMs > 0 ? ` · ${probe.rttMs} ms` : '') +
    (probe.fromCache ? ' (cached)' : ''));
  lines.push('Reachability only — it does NOT prove sACN frames are arriving.');
  return {
    state,
    dot: pres.dot,
    label: pres.label,
    cls: pres.cls,
    title: lines.join('\n'),
  };
}

/**
 * The binding-grade badge for one card. Returns null for DMX controllers and
 * for LED cards that carry no binding at all — an unbound LED card already
 * shows the "🔍 Discover / bind device" button, and a second chip saying the
 * same thing is noise.
 *
 * @returns {{grade, label, cls, title}|null}
 */
export function ledBindingBadgeModel(controller) {
  const grade = ledBindingGrade(controller);
  if (grade === LED_BINDING_PROVISIONAL) {
    return {
      grade,
      label: '⚑ PROVISIONAL',
      cls: 'cm-binding-provisional',
      title: 'This binding was DECLARED by you, not read off the board.\n\n' +
        'Everything downstream is patched exactly as if it were verified: ' +
        'patches.yaml records, engine model lanes, bridge relay routes and ' +
        'subscribed universes all exist, so the chain is complete before the ' +
        'board ever powers on.\n\n' +
        'What is missing is only the hardware fingerprint (controllerId). On ' +
        'the first successful contact the sim reads it off the board, checks it ' +
        'against what you declared, and promotes this card to VERIFIED — or ' +
        'stops and shows you exactly what disagreed.',
    };
  }
  if (grade === LED_BINDING_VERIFIED) {
    const dev = controller.device;
    return {
      grade,
      label: '✓ VERIFIED',
      cls: 'cm-binding-verified',
      title: `Bound to device '${dev.controllerId}'` +
        `${dev.boardId ? ` (${dev.boardId})` : ''} — the fingerprint was read off the ` +
        'hardware. Binding identity is the controllerId, not the IP.',
    };
  }
  return null;
}

/**
 * Should this card's probe result trigger a FIRST-CONTACT promote attempt?
 * True only for a PROVISIONAL LED card whose probe came back ONLINE carrying a
 * recognized device fingerprint. An `online` verdict with no fingerprint (some
 * other box answered on :80) is deliberately excluded — the reconcile would
 * refuse it anyway, and firing on it would spam the operator with a dialog for
 * a machine that has nothing to do with the show.
 */
export function shouldAttemptFirstContact(controller, probe) {
  return ledBindingGrade(controller) === LED_BINDING_PROVISIONAL
    && !!probe
    && probe.state === PROBE_STATE_ONLINE
    && !!probe.device
    && typeof probe.device.controllerId === 'string'
    && probe.device.controllerId.length > 0;
}

/**
 * Can the operator declare a provisional binding on this card right now?
 * Requires: an LED card, no existing binding, and a usable IP that is not the
 * placeholder sentinel. Returns `{allowed, reason}` so the button can be
 * disabled WITH the reason rather than silently absent.
 */
export function canMarkProvisional(controller) {
  if (!isLedController(controller)) {
    return { allowed: false, reason: 'only LED controllers bind to a device' };
  }
  const grade = ledBindingGrade(controller);
  if (grade === LED_BINDING_VERIFIED) {
    return { allowed: false, reason: 'already VERIFIED against real hardware — unbind first' };
  }
  if (grade === LED_BINDING_PROVISIONAL) {
    return { allowed: false, reason: 'already provisional' };
  }
  if (controller.ip === PLACEHOLDER_IP) {
    return {
      allowed: false,
      reason: `${PLACEHOLDER_IP} is the placeholder sentinel, not an address — type the real ` +
        'IP first, then declare the binding',
    };
  }
  if (!isValidIp(controller.ip)) {
    return { allowed: false, reason: 'type the controller IP first — it is the whole point of a ' +
      'provisional binding' };
  }
  return { allowed: true, reason: '' };
}

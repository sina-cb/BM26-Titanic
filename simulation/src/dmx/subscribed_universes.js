/**
 * subscribed_universes.js — the required sACN-IN subscription set, and the diff
 * against the operator-owned `📡 Subscribed Universes` field
 * (`colorWave.sacn_universes` in `scenes/common.yaml`).
 *
 * WHY THIS EXISTS (report 20260725_58 §7.1 layer 6, report 20260725_60):
 * the `sacn` package SILENTLY DROPS every packet on a universe the receiver did
 * not subscribe to — no error, no warning, no counter. A field that has fallen
 * behind the mapping is therefore indistinguishable from healthy: disk fresh,
 * routes "created", monitor green, fixtures dark. That is the operator's
 * off-lights day. This module makes the field a DERIVED quantity that the save
 * path re-checks against the configuration every time.
 *
 * NO RESTART (report 20260725_87): the bridge now re-reads this field on every
 * route recompute, and a save notifies the bridge as its last step — so a field
 * widened here reaches the RUNNING receiver on the same save. The field is still
 * the accept-list the bridge starts from at its next boot; it is no longer only
 * that.
 *
 * PURE: no DOM, no I/O, no registry imports beyond the type predicate — every
 * function is a deterministic transform of its inputs, so the whole contract is
 * unit-testable without a browser.
 *
 * Two hard rules encoded here:
 *
 *  1. **Never remove.** The diff only ever ADDS. Shrinking a subscription can
 *     only break things silently (see above), and the operator may legitimately
 *     subscribe to universes this scene's registry knows nothing about (a second
 *     scene, the engine, a console on the wire). Universes that nothing in the
 *     configuration uses are reported as an FYI line, never as an action.
 *  2. **Parse exactly like the bridge.** The bridge reads the field with
 *     `split(',') → parseInt → drop NaN / sub-1`. It does NOT understand ranges:
 *     the token `1-24` parses to the single universe 1, and the other 23 go
 *     dark. `parseSubscribedUniverses` reproduces that arithmetic EXACTLY and
 *     reports every token it had to reinterpret in `malformed`, so a range typed
 *     by hand surfaces as a loud finding instead of 23 dark universes. The
 *     bridge's own copy is `parseSubscribedUniversesField` in
 *     lib/bridge_routing.cjs (CommonJS, server-side); the two are pinned
 *     token-for-token by a parity test in tests/bridge_routing.test.js.
 */

import { isLedController } from './controller_registry.js';

// The E1.31 universe window. Mirrors bridge_routing.cjs's SACN_UNIVERSE_MIN /
// SACN_UNIVERSE_MAX — kept as literals rather than imported because that module
// is CommonJS server-side and this one runs in the browser.
export const SACN_UNIVERSE_MIN = 1;
export const SACN_UNIVERSE_MAX = 63999;

/** The GUI key and label of the field this module keeps honest. */
export const SUBSCRIBED_UNIVERSES_KEY = 'sacn_universes';
export const SUBSCRIBED_UNIVERSES_LABEL = '📡 Subscribed Universes';

/**
 * Parse the field the way the BRIDGE parses it (sacn_bridge.js:92-94), plus a
 * report of every token whose bridge-parse differs from what a human reading it
 * would expect.
 *
 * @param {string} configStr
 * @returns {{universes: number[], malformed: Array<{token: string, reason: string}>}}
 *   `universes` sorted ascending, deduped, positive integers only — byte-for-byte
 *   the set the bridge will subscribe to.
 */
export function parseSubscribedUniverses(configStr) {
  const seen = new Set();
  const malformed = [];
  const raw = String(configStr === undefined || configStr === null ? '' : configStr);
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      malformed.push({ token: trimmed, reason: 'not a number — the bridge drops it entirely' });
      continue;
    }
    if (String(parsed) !== trimmed) {
      // `1-24`, `12x`, `07 ` already trimmed, `3.5` — parseInt takes the leading
      // integer and throws the rest away. The bridge does this SILENTLY; we do
      // not.
      malformed.push({
        token: trimmed,
        reason: `the bridge reads this as U${parsed} only (it has no range syntax)`,
      });
    }
    if (parsed >= SACN_UNIVERSE_MIN) seen.add(parsed);
  }
  return { universes: [...seen].sort((a, b) => a - b), malformed };
}

/** Serialize a universe list back into the field's `1, 2, 3` form. */
export function formatSubscribedUniverses(universes) {
  return [...new Set(universes)].sort((a, b) => a - b).join(', ');
}

/**
 * Every universe the CURRENT configuration actually uses, each mapped to the
 * human-readable reasons it is needed.
 *
 * The inputs are the projections the Controller Mapping panel already computes —
 * this function is a union, NOT a new scanner:
 *
 *  - `dmxUniverseMaps` — `computeProjection().universeMaps`: the per-universe
 *    channel occupancy of every DMX fixture claim, including pinned global
 *    effects. Claims carry `controllerName` + `portNum`.
 *  - `ledClaims` — `computeLedUniverseClaims()`: the LED mirror of the above.
 *    One claim PER SEGMENT, so a strand that spills past 512 channels
 *    contributes its spill universe too. Claims key their owner by PANEL
 *    ORDINAL (docs/33 decision 20), resolved against `controllers`.
 *  - `controllers` — the registry array. Port rows are read DIRECTLY because a
 *    port declares its universe whether or not anything is patched on it yet:
 *    an empty DMX port and an LED output with no strand are both universes the
 *    hardware listens on and the sim must therefore be able to receive. (Parked
 *    outputs used to contribute here too; parking is retired — a forced push
 *    DISABLES every output no port maps, so there is no enabled-but-unrouted
 *    output left to subscribe for.)
 *  - `fixtures` / `ledStrands` — the STORED patch records (`patches.yaml` as
 *    loaded). This is what the bridge's own boot-time patches scan sees, and it
 *    is the only source that still says anything when the registry is inactive
 *    (a scene mapped before controllers.yaml existed).
 *
 * @param {{controllers?: Array<Object>, dmxUniverseMaps?: Map<number, Array>,
 *   ledClaims?: Map<number, Array>, fixtures?: Array<Object>,
 *   ledStrands?: Array<Object>}} sources
 * @returns {Map<number, string[]>} universe → reasons, ascending by universe.
 */
export function computeRequiredUniverses(sources) {
  if (!sources || typeof sources !== 'object') {
    throw new Error('[Universes] computeRequiredUniverses: a sources object is required ' +
      '{controllers, dmxUniverseMaps, ledClaims, fixtures, ledStrands}');
  }
  const {
    controllers = [],
    dmxUniverseMaps = new Map(),
    ledClaims = new Map(),
    fixtures = [],
    ledStrands = [],
  } = sources;
  if (!Array.isArray(controllers)) {
    throw new Error('[Universes] computeRequiredUniverses: controllers must be the registry ' +
      'controllers array');
  }
  if (!(dmxUniverseMaps instanceof Map)) {
    throw new Error('[Universes] computeRequiredUniverses: dmxUniverseMaps must be a Map ' +
      '(computeProjection().universeMaps)');
  }
  if (!(ledClaims instanceof Map)) {
    throw new Error('[Universes] computeRequiredUniverses: ledClaims must be a Map ' +
      '(computeLedUniverseClaims())');
  }

  const required = new Map();
  const note = (universe, reason) => {
    const u = Number.parseInt(universe, 10);
    if (!Number.isInteger(u) || u < SACN_UNIVERSE_MIN || u > SACN_UNIVERSE_MAX) return;
    if (!required.has(u)) required.set(u, []);
    const reasons = required.get(u);
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  // ── DMX fixture claims (projected patches) ────────────────────────────
  for (const [universe, claims] of dmxUniverseMaps) {
    for (const claim of claims || []) {
      const owner = claim.controllerName || `controller #${claim.controllerId}`;
      note(universe, Number.isInteger(claim.portNum) ? `${owner} port ${claim.portNum}` : owner);
    }
  }

  // ── LED strand claims (start + every spill segment) ───────────────────
  for (const [universe, claims] of ledClaims) {
    for (const claim of claims || []) {
      const ownerController = controllers[claim.controllerId - 1];
      const owner = ownerController ? ownerController.name : `controller #${claim.controllerId}`;
      const port = Number.isInteger(claim.portNum) ? ` port ${claim.portNum}` : '';
      note(universe, `${owner}${port} (LED strand '${claim.name}')`);
    }
  }

  // ── Declared ports (universes with nothing patched on them yet) ───────
  for (const controller of controllers) {
    if (!controller) continue;
    const name = controller.name || `controller #${controller.id}`;
    for (const port of controller.ports || []) {
      if (!port) continue;
      note(port.universe, isLedController(controller) && Number.isInteger(port.output)
        ? `${name} port ${port.port} → output ${port.output}`
        : `${name} port ${port.port}`);
    }
  }

  // ── Stored patch records (patches.yaml as the bridge's boot scan sees it) ──
  for (const fixture of fixtures || []) {
    if (!fixture) continue;
    note(fixture.dmxUniverse, `patched fixture '${fixture.name}'`);
  }
  for (const strand of ledStrands || []) {
    if (!strand) continue;
    if (Array.isArray(strand.segments) && strand.segments.length > 0) {
      for (const seg of strand.segments) {
        if (seg) note(seg.universe, `patched strand '${strand.name}'`);
      }
    } else {
      note(strand.dmxUniverse, `patched strand '${strand.name}'`);
    }
  }

  return new Map([...required.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * Diff the field against the required set. ADDITIVE ONLY (rule 1 above).
 *
 * @param {{currentValue: string, required: Map<number, string[]>}} input
 * @returns {{
 *   current: number[], next: number[], nextValue: string, currentValue: string,
 *   missing: Array<{universe: number, reasons: string[]}>,
 *   extras: number[], malformed: Array<{token: string, reason: string}>,
 *   changed: boolean,
 * }}
 *   `changed` is true iff at least one universe is MISSING from the field —
 *   the only condition that may interrupt a save.
 */
export function computeSubscriptionUpdate({ currentValue, required }) {
  if (!(required instanceof Map)) {
    throw new Error('[Universes] computeSubscriptionUpdate: required must be the Map returned ' +
      'by computeRequiredUniverses()');
  }
  const parsed = parseSubscribedUniverses(currentValue);
  const current = parsed.universes;
  const subscribed = new Set(current);

  const missing = [];
  for (const [universe, reasons] of required) {
    if (!subscribed.has(universe)) missing.push({ universe, reasons: [...reasons] });
  }
  const extras = current.filter((u) => !required.has(u));
  const next = [...new Set([...current, ...missing.map((m) => m.universe)])]
    .sort((a, b) => a - b);

  return {
    current,
    next,
    currentValue: formatSubscribedUniverses(current),
    nextValue: formatSubscribedUniverses(next),
    missing,
    extras,
    malformed: parsed.malformed,
    changed: missing.length > 0,
  };
}

/**
 * Operator-facing text for the update — one place, so the dialog, the console
 * line and the tests all say the same words.
 *
 * @param {ReturnType<computeSubscriptionUpdate>} update
 * @returns {{headline: string, additionLines: string[], extrasLine: (string|null),
 *   malformedLines: string[], summary: string}}
 */
export function describeSubscriptionUpdate(update) {
  if (!update || typeof update !== 'object') {
    throw new Error('[Universes] describeSubscriptionUpdate: an update object is required');
  }
  const headline = `${SUBSCRIBED_UNIVERSES_LABEL}: ${update.currentValue || '(empty)'} → ` +
    `${update.nextValue}`;

  const additionLines = update.missing.map(({ universe, reasons }) =>
    `U${universe} — ${reasons.join('; ')}`);

  const extrasLine = update.extras.length
    ? `FYI: U${update.extras.join(', U')} ${update.extras.length === 1 ? 'is' : 'are'} ` +
      'subscribed but nothing in this configuration uses ' +
      `${update.extras.length === 1 ? 'it' : 'them'} — left in place. This never removes a ` +
      'universe; a subscription you do not need is harmless, one you are missing is dark ' +
      'fixtures with no error.'
    : null;

  const malformedLines = update.malformed.map(({ token, reason }) =>
    `⚠ '${token}' — ${reason}`);

  const summary = update.changed
    ? `adding U${update.missing.map((m) => m.universe).join(', U')}`
    : 'no change — every universe this configuration uses is already subscribed';

  return { headline, additionLines, extrasLine, malformedLines, summary };
}

/**
 * The save-time gate. All effects are INJECTED, so the yes / no / cancel
 * semantics are unit-tested without a DOM and without a save server.
 *
 * Contract:
 *  - required ⊆ subscribed  → `{ proceed: true, choice: 'clean' }`, no prompt.
 *  - not interactive        → `{ proceed: true, choice: 'deferred' }`, ONE warn
 *    line, the field is NOT touched. (Auto-save runs on a 2 s timer; a modal
 *    that appears while the operator is orbiting the camera is worse than a
 *    warning he sees on his next explicit save.)
 *  - `confirm()` → 'yes'    → `applyValue(nextValue)` then `{ proceed: true }`.
 *  - `confirm()` → 'no'     → `{ proceed: true }`, field untouched, one log line.
 *  - `confirm()` → 'cancel' → `{ proceed: false }`, NOTHING written.
 *
 * @param {{
 *   requiredUniverses: () => Map<number, string[]>,
 *   currentValue: () => string,
 *   applyValue: (value: string) => void,
 *   confirm: (update: Object) => Promise<'yes'|'no'|'cancel'>,
 *   log: (message: string) => void,
 *   warn: (message: string) => void,
 *   interactive?: boolean,
 * }} deps
 * @returns {Promise<{proceed: boolean, choice: string, update: Object}>}
 */
export async function syncSubscribedUniverses(deps) {
  if (!deps || typeof deps !== 'object') {
    throw new Error('[Universes] syncSubscribedUniverses: a deps object is required');
  }
  const { requiredUniverses, currentValue, applyValue, confirm, log, warn } = deps;
  for (const [name, fn] of Object.entries({
    requiredUniverses, currentValue, applyValue, confirm, log, warn,
  })) {
    if (typeof fn !== 'function') {
      throw new Error(`[Universes] syncSubscribedUniverses: deps.${name} must be a function`);
    }
  }
  const interactive = deps.interactive !== false;

  const required = requiredUniverses();
  const update = computeSubscriptionUpdate({ currentValue: currentValue(), required });
  const described = describeSubscriptionUpdate(update);

  for (const line of described.malformedLines) {
    warn(`[Universes] ${SUBSCRIBED_UNIVERSES_LABEL} ${line}`);
  }

  if (!update.changed) return { proceed: true, choice: 'clean', update };

  if (!interactive) {
    warn(`[Universes] auto-save: ${described.additionLines.length} universe(s) used by this ` +
      `configuration are NOT in ${SUBSCRIBED_UNIVERSES_LABEL} ` +
      `(${described.summary}) — the field was left alone; the next explicit 💾 save will ask. ` +
      'Until then the bridge cannot receive those universes and they render dark with no error.');
    return { proceed: true, choice: 'deferred', update };
  }

  const choice = await confirm({ update, described });
  if (choice === 'yes') {
    applyValue(update.nextValue);
    log(`[Universes] ${described.headline} — ${described.summary}. Takes effect IMMEDIATELY: ` +
      'the save notifies the running bridge, which re-reads this field on every route recompute ' +
      '(report 20260725_87). Watch the bridge log for "runtime-subscribed U…". No restart.');
    return { proceed: true, choice: 'yes', update };
  }
  if (choice === 'no') {
    log(`[Universes] operator declined the update — ${SUBSCRIBED_UNIVERSES_LABEL} stays ` +
      `'${update.currentValue}' and the save continues. Not subscribed: ` +
      `U${update.missing.map((m) => m.universe).join(', U')}.`);
    return { proceed: true, choice: 'no', update };
  }
  if (choice === 'cancel') {
    log('[Universes] save CANCELLED by the operator at the subscribed-universes prompt — ' +
      'nothing was written.');
    return { proceed: false, choice: 'cancel', update };
  }
  throw new Error(`[Universes] syncSubscribedUniverses: confirm() resolved '${choice}' — ` +
    "expected 'yes', 'no' or 'cancel'");
}

/**
 * led_fixture_kind.js — the ONE place that answers "does this scene fixture
 * ride the LED bus?", and the count map every LED projection is fed.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The scene has two kinds of LED-bus thing, and until now only one of them was
 * treated as LED by the mapping chain:
 *
 *   • an **LED strand** (`params.ledStrands[]`) — a start→end line with an
 *     `ledCount`; its pixels are interpolated along that line;
 *   • an **LED pixel fixture** (`params.parLights[]` whose fixture DEFINITION
 *     declares `bus: led`) — real per-pixel geometry baked into the definition
 *     YAML (`dots`), placed and rotated by the gizmo like any other fixture.
 *     The TE Sign V3 halves are the ones in the ship.
 *
 * Both hang off a MarsinLED (Ango 4) pixel controller output and are addressed
 * identically: one INDEPENDENT sACN receiver per physical output, cursor
 * starting at (port.universe, channel 1), `stride` bytes per pixel, no pixel
 * ever straddling channel 512. The only difference is where the pixel
 * COORDINATES come from — which is a render/export concern, not a wiring one.
 *
 * Before this module the LED half of the chain keyed off `params.ledStrands`
 * alone, so an LED pixel fixture could only be chained on a DMX gateway: it
 * showed up in the DMX tray, took a whole-fixture DMX footprint, and exported
 * `type: 'dmx'` pixels. That is the confusion the operator called out
 * (2026-07-31: *"make sure the TE sign fixtures are clearly of type LED not
 * DMX to avoid confusion later on in the cycle of this system"*).
 *
 * The classification is DATA, not a name list: it reads `bus` off the fixture
 * definition (`fixture_definition_registry.js`, `bus: model.bus || 'dmx'`), so
 * any future LED-bus fixture type is LED everywhere the moment its YAML says
 * so — no hardcoded fixtureType table to go stale.
 *
 * PURE: no DOM, no I/O, no registry imports. The definition lookup is passed
 * in, so this is unit-testable in Node and usable from the browser, the
 * exporter and the save path alike.
 *
 * No fallbacks (codex P0): an LED-bus definition with no pixels is a broken
 * definition and throws — it must never quietly project as a 0-pixel fixture.
 */

export const BUS_LED = 'led';
export const BUS_DMX = 'dmx';

/** True when a fixture DEFINITION declares the LED bus. */
export function isLedBusDefinition(def) {
  return !!def && def.bus === BUS_LED;
}

/**
 * Pixel count of an LED-bus fixture definition — the LED equivalent of a
 * strand's `ledCount`, and the number the per-output walker advances over.
 * @throws when the definition claims the LED bus but carries no pixels.
 */
export function ledBusPixelCount(def) {
  const count = Array.isArray(def && def.pixels) ? def.pixels.length : 0;
  if (!(count > 0)) {
    throw new Error(`[led_fixture_kind] fixture definition '${(def && def.fixtureType) || '?'}' ` +
      'declares `bus: led` but carries no pixels — an LED pixel fixture is addressed per ' +
      'pixel, so a pixel-less one has no footprint and could only project as a silent no-op ' +
      '(codex P0: fail loud). Fix the definition YAML.');
  }
  return count;
}

/**
 * True when a scene fixture CONFIG rides the LED bus.
 * @param {Object} config           a `parLights` / `dmxFixtures` entry
 * @param {function} getDefinition  fixtureType → definition (or null)
 */
export function isLedBusFixture(config, getDefinition) {
  if (!config || typeof config.fixtureType !== 'string') return false;
  return isLedBusDefinition(getDefinition(config.fixtureType));
}

/**
 * The LED-bus fixtures among a scene's DMX-transport fixture configs, in
 * scene order.
 * @returns {Array<Object>} the config objects themselves (never copies — the
 *   callers mutate them in place, exactly as the DMX projection does)
 */
export function ledBusFixtures(configs, getDefinition) {
  if (!Array.isArray(configs)) return [];
  return configs.filter((c) => isLedBusFixture(c, getDefinition));
}

/**
 * The name → pixel-count map handed to `computeLedProjection` /
 * `computeLedStrandPatches`: LED strands AND LED pixel fixtures together.
 *
 * This union IS the reclassification. Both projections already key purely off
 * this map, so feeding them the union makes an LED pixel fixture take the same
 * per-output cursor, the same stride, the same no-straddle walk and the same
 * patch record shape as a strand — with no change to either projection.
 *
 * A name collision between a strand and a fixture is fatal: names are the join
 * key for patches.yaml, the controller chains and every model pixel, so an
 * ambiguous one cannot be projected (the scene-identity check reports it too,
 * but this path must not silently pick a winner).
 *
 * @param {Array<Object>} strands       `params.ledStrands`
 * @param {Array<Object>} configs       `params.parLights` / `dmxFixtures`
 * @param {function} getDefinition      fixtureType → definition (or null)
 * @returns {Map<string, number>}
 */
export function ledMappableCounts(strands, configs, getDefinition) {
  const counts = new Map();
  for (const s of (Array.isArray(strands) ? strands : [])) {
    if (!s || typeof s.name !== 'string' || s.name.length === 0) continue;
    counts.set(s.name, s.ledCount || 10);
  }
  for (const c of ledBusFixtures(configs, getDefinition)) {
    if (typeof c.name !== 'string' || c.name.length === 0) continue;
    if (counts.has(c.name)) {
      throw new Error(`[led_fixture_kind] '${c.name}' is BOTH an LED strand and an LED-bus ` +
        'fixture. Names are the join key for patches.yaml, the controller chains and every ' +
        'model pixel — rename one before anything can be projected.');
    }
    counts.set(c.name, ledBusPixelCount(getDefinition(c.fixtureType)));
  }
  return counts;
}

/** The LED-bus fixture NAMES in a scene (the LED tray's fixture half). */
export function ledBusFixtureNames(configs, getDefinition) {
  return ledBusFixtures(configs, getDefinition)
    .map((c) => c.name)
    .filter((n) => typeof n === 'string' && n.length > 0);
}

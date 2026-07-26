/**
 * dmx_output_overrides.js — Last-layer per-fixture output overrides.
 *
 * The operator can force any individual fixture Off (full blackout) or set a
 * master Brightness on it. These are applied as the FINAL stage of the DMX
 * pipeline: directly onto the merged universe read buffers, AFTER the router
 * has merged every source and AFTER pixel→sACN mapping has (re)written the
 * frame, but BEFORE the fixtures sample it for the preview and BEFORE the
 * sACN-out transmits it. That ordering makes the override unbeatable — no
 * pattern, effect or sACN source can win over it — and because the sim
 * visualisation and the sACN output read the same buffers, a change shows on
 * the lights on the very next frame.
 *
 * Kept dependency-free (plain typed-array math) so it is unit-testable and
 * reusable from the render loop without pulling in Three.js.
 */

// Channel roles whose value carries light output — only these are scaled by
// the Brightness master. Movement / strobe / function / speed channels are
// left untouched so dimming only changes a fixture's level, never its
// behaviour. Roles match the keys used in fixture-definition `pixels[].channels`.
export const OUTPUT_INTENSITY_CHANNELS = new Set([
  'red', 'green', 'blue', 'white', 'amber', 'uv', 'lime', 'cyan',
  'value', 'dimmer', 'intensity', 'warm', 'cool', 'cw', 'ww', 'master',
]);

/**
 * Resolve a fixture's own output override intent from its live config.
 * @returns {{ enabled: boolean, brightness: number }} brightness is 0–100.
 */
export function resolveFixtureOverride(config) {
  const enabled = config.enabled !== false;
  const bRaw = config.brightness;
  const brightness = (bRaw === undefined || bRaw === null)
    ? 100 : Math.max(0, Math.min(100, bRaw));
  return { enabled, brightness };
}

/**
 * Resolve a group's override intent from the groupOverrides map.
 * Missing group / fields default to on / 100 %.
 * @param {Object|null|undefined} groupOverrides — { [groupName]: {enabled, brightness} }
 * @param {string|undefined} groupName
 * @returns {{ enabled: boolean, brightness: number }}
 */
export function resolveGroupOverride(groupOverrides, groupName) {
  const g = (groupOverrides && groupName) ? groupOverrides[groupName] : null;
  const enabled = !g || g.enabled !== false;
  const bRaw = g ? g.brightness : 100;
  const brightness = (bRaw === undefined || bRaw === null)
    ? 100 : Math.max(0, Math.min(100, bRaw));
  return { enabled, brightness };
}

/**
 * Combine the group master and the per-fixture override into one effective
 * override. The GROUP takes priority over the fixture (these are both global
 * brightnesses, NOT nested/multiplied):
 *   • Brightness — the group value wins whenever it is set to anything other
 *     than 100 % (its passthrough default). Only when the group sits at 100 %
 *     does the fixture's own brightness apply. So group 60 % + fixture 80 % →
 *     60 %; group 100 % + fixture 80 % → 80 %.
 *   • On/Off — the group is a master kill: group Off forces the fixture off;
 *     group On (the default) defers to the fixture's own On/Off.
 * @returns {{ enabled: boolean, brightness: number }} brightness 0–100.
 */
export function resolveCombinedOverride(config, groupOverrides) {
  const fixture = resolveFixtureOverride(config);
  const group = resolveGroupOverride(groupOverrides, config.group);
  return {
    enabled: group.enabled && fixture.enabled,
    brightness: group.brightness !== 100 ? group.brightness : fixture.brightness,
  };
}

/**
 * The scalar (0–1) a DMX pixel's RENDERED color must be multiplied by, from the
 * SAME combined (group ▸ fixture) override `applyFixtureOutputOverrides` applies
 * to the universe bytes. Off ⇒ 0 (BLACK); otherwise the effective brightness
 * fraction (1 at ≥100 %, so a full-on fixture is a no-op).
 *
 * This is the DMX twin of `ledOutputScale` (core/group_lock.js): the universe
 * buffer is NOT the only consumer of a DMX pixel's color. The global V2
 * instanced-dot mesh and the 2D Pixel Map read the RAW `_batchRenderList` entry
 * color, and while NO fixture is patched (`window._patchesActive === false` —
 * the state the titanic show scene is actually in) the fixture bulbs are
 * direct-painted from it too, with `applyFixtureOutputOverrides` a complete
 * no-op because there are no universes to gate. Deriving those paths from this
 * one function is what makes "group Off" mean BLACK everywhere.
 *
 * `config` is the LIVE fixture config object — the very object
 * `applyFixtureOutputOverrides` reads as `fixture.config` — so the group key can
 * never diverge between the two gates.
 * @param {Object|null|undefined} config — a fixture config (enabled, brightness, group)
 * @param {Object|null|undefined} groupOverrides — params.groupOverrides
 * @returns {number} 0..1 (1 when there is no config to resolve — the caller is
 *          responsible for reporting a DMX pixel that carries none)
 */
export function dmxOutputScale(config, groupOverrides) {
  if (!config) return 1;
  const { enabled, brightness } = resolveCombinedOverride(config, groupOverrides);
  if (!enabled) return 0;
  if (brightness >= 100) return 1;
  return brightness / 100;
}

/**
 * Scale ONE batch-render entry's rendered RGBWAU **in place** by its fixture's
 * combined override (`dmxOutputScale` of `entry.fixtureConfig`). Off ⇒ hard 0 on
 * every lane; a full-on fixture is left byte-identical so there is zero behavior
 * change when nothing is disabled.
 *
 * Pure (no THREE/DOM) so the render loop's gate is unit-testable.
 * @param {Object} entry — a _batchRenderList entry (r,g,b,w,a,u + fixtureConfig)
 * @param {Object|null|undefined} groupOverrides — params.groupOverrides
 * @returns {number} the scale that was applied (1 = untouched)
 */
export function applyDmxEntryOutputGate(entry, groupOverrides) {
  const s = dmxOutputScale(entry.fixtureConfig, groupOverrides);
  if (s >= 1) return 1;
  if (s <= 0) {
    entry.r = 0; entry.g = 0; entry.b = 0;
    entry.w = 0; entry.a = 0; entry.u = 0;
    return 0;
  }
  entry.r *= s; entry.g *= s; entry.b *= s;
  entry.w *= s; entry.a *= s; entry.u *= s;
  return s;
}

/**
 * Apply On/Off + Brightness overrides onto the merged universe buffers.
 * @param {{ getFullFrame: (u:number)=>(Uint8Array|null|undefined) }} router
 * @param {Array<Array<object>>} fixtureLists — lists of fixture runtimes, each
 *        with `.config` (enabled, brightness, group, dmxUniverse, dmxAddress),
 *        optional `.patchDef` (universe, addr), and `.fixtureDef`
 *        (footprint, pixels[].channels).
 * @param {Object} [groupOverrides] — { [groupName]: {enabled, brightness} }
 */
export function applyFixtureOutputOverrides(router, fixtureLists, groupOverrides) {
  if (!router || typeof router.getFullFrame !== 'function' || !fixtureLists) return;

  for (const list of fixtureLists) {
    if (!list) continue;
    for (const fixture of list) {
      if (!fixture || !fixture.config) continue;
      const config = fixture.config;
      const { enabled, brightness } = resolveCombinedOverride(config, groupOverrides);
      // No override → leave the merged frame exactly as the sources built it.
      if (enabled && brightness >= 100) continue;

      const universe = Math.floor(Number(fixture.patchDef?.universe ?? config.dmxUniverse));
      const addr = Math.floor(Number(fixture.patchDef?.addr ?? config.dmxAddress));
      if (!Number.isFinite(universe) || universe < 1) continue;
      if (!Number.isFinite(addr) || addr < 1) continue;

      const frame = router.getFullFrame(universe);
      if (!frame) continue;
      const base = addr - 1;
      const def = fixture.fixtureDef;
      const footprint = def?.footprint || 0;

      if (!enabled) {
        // Full blackout: zero the fixture's entire DMX footprint (always off).
        const end = Math.min(frame.length, base + footprint);
        for (let i = base; i < end; i++) frame[i] = 0;
        continue;
      }

      // Brightness master: scale only intensity-bearing channels across every
      // pixel. Channel offsets are 1-based within the fixture footprint.
      const scale = brightness / 100;
      if (!def || !Array.isArray(def.pixels)) continue;
      for (const pixel of def.pixels) {
        const ch = pixel.channels;
        if (!ch) continue;
        for (const role in ch) {
          if (!OUTPUT_INTENSITY_CHANNELS.has(role)) continue;
          const off = ch[role];
          if (!off || off < 1) continue;
          const idx = base + (off - 1);
          if (idx >= 0 && idx < frame.length) {
            frame[idx] = Math.max(0, Math.min(255, Math.round(frame[idx] * scale)));
          }
        }
      }
    }
  }
}

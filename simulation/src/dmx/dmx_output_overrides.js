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
 * Resolve a fixture's output gain intent from its live config.
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
 * Apply On/Off + Brightness overrides onto the merged universe buffers.
 * @param {{ getFullFrame: (u:number)=>(Uint8Array|null|undefined) }} router
 * @param {Array<Array<object>>} fixtureLists — lists of fixture runtimes, each
 *        with `.config` (enabled, brightness, dmxUniverse, dmxAddress),
 *        optional `.patchDef` (universe, addr), and `.fixtureDef`
 *        (footprint, pixels[].channels).
 */
export function applyFixtureOutputOverrides(router, fixtureLists) {
  if (!router || typeof router.getFullFrame !== 'function' || !fixtureLists) return;

  for (const list of fixtureLists) {
    if (!list) continue;
    for (const fixture of list) {
      if (!fixture || !fixture.config) continue;
      const config = fixture.config;
      const { enabled, brightness } = resolveFixtureOverride(config);
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

/**
 * trace_visual_gate.js — ONE answer to "should the generator/trace preview
 * visuals be drawn right now?"
 *
 * The visuals in question are everything `buildTraceObject` puts in the scene
 * for authoring a trace: the wireframe path, the per-point spacing-gradient
 * preview dots (opaque `SphereGeometry r=0.3`), the start/end/aim handles
 * (`r=0.4`/`0.35`), the dashed aim line, and — riding on the group's own
 * visibility — the ⛓ chain-order overlay.
 *
 * WHY THIS EXISTS. Report 20260725_79 measured those dots sitting exactly on
 * the DMX fixtures in the `full` beauty profile: a par's bulb draws at radius
 * 0.2223, its trace dot at 0.3, so the dot COVERS the bulb and the fixture's
 * own additive halo (0.4713) survives only as a rim — a coloured ring around a
 * disk. The spacing gradient tints that disk red wherever spacing reads
 * "stretched". The operator reported "red rings around the pars" three times
 * (2026-07-30) before this was named. The visuals are correct; drawing them in
 * the view he judges the SHOW by was the mistake.
 *
 * THE RULE, in precedence order:
 *   1. Par lights off  → nothing trace-related is drawn (pre-existing coupling).
 *   2. "Show Generators" off → off. The toggle always wins when it says no.
 *   3. The operator has flipped "Show Generators" himself this session
 *      (`params.traceVisualsOperatorChoice`) → on, in EVERY profile. An
 *      explicit choice outranks the default.
 *   4. Otherwise → on in the working profiles (`edit`, `pixel_mapping`,
 *      `2d_pixels`), off in the beauty profiles (`emissive`, `full`).
 *
 * So the toggles keep working exactly as before — turning Show Generators ON
 * inside a beauty profile brings the dots back, deliberately. Only the DEFAULT
 * changed, and only for the two profiles that render the show.
 *
 * `traceVisualsOperatorChoice` is runtime-only, like `focusOnSelect` and
 * `chainOrderVisible`: `reconstructYAML` walks the scene's existing config
 * tree, so it never reaches a scene file.
 */
import { isBeautyProfile } from '../core/profile_registry.js';

export function traceVisualsShouldShow(params) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('[trace_visual_gate] traceVisualsShouldShow(params): params object required');
  }
  if (params.parsEnabled === false) return false;
  if (params.generatorsVisible === false) return false;
  if (params.traceVisualsOperatorChoice === true) return true;
  return !isBeautyProfile(params.lightingProfile);
}

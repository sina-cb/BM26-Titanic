/**
 * pixel_dot_geometry.js — the DRAWN geometry of the sim's scene-wide
 * instanced-dot mesh.
 *
 * animate.js renders ONE InstancedMesh over EVERY pixel in the scene (the "V2"
 * dot mesh). It is the layer that shows live per-pixel colour for patched
 * fixtures, so on a running show it is often the only emitter the operator
 * actually sees.
 *
 * Its per-instance position and radius used to be read straight off the pixel
 * map's `x/y/z` + `pixelSize`. Those fields are PHYSICAL by contract — the
 * exported Pixelblaze model, the sACN patching, the normalized coordinate
 * buffer handed to the engine and the analytic light pool all sample them, and
 * they must describe the real rig, never the exaggerated drawing of it
 * (fixture_model_scale.js). Reading them in a RENDER path meant the dot mesh
 * silently ignored the per-type render multiplier: a 2.5× Vintage LED drew its
 * six heads at pre-scale size and pre-scale spacing, huddled inside a housing
 * that had grown 2.5× around them.
 *
 * The bug only SHOWED on patched fixtures, because every unpatched dot is
 * forced black (or flat red under the unpatched-red overlay) by the colour
 * flush — which is why it read as "only the Left Front Rails are wrong" when in
 * fact every fixture's dots were wrong and only those four were lit.
 *
 * This module is the one place that answers "where and how big is this pixel's
 * dot DRAWN", from the render-only `rx/ry/rz` + `renderScale` fields the pixel
 * map emits alongside the physical ones. Both are equal for any fixture that
 * renders 1:1.
 */

// Dot diameter, in millimetres, for a pixel whose model declares no size — LED
// strand pixels, which are raw WS2812-class LEDs with no fixture model. A
// DEFINED default for a value that genuinely does not exist upstream, not a
// fallback masking a failure.
export const DEFAULT_PIXEL_SIZE_MM = 14;

/**
 * The radius, in world units, that one pixel's instanced dot is DRAWN at.
 *
 * @param {Object} entry - a batch render-list entry (a pixel-map pixel)
 * @param {number} globalScale - params.globalPixelScale ("Global Pixel Size")
 * @returns {number} world-unit radius
 */
export function dotDrawnRadius(entry, globalScale) {
  if (!entry) {
    throw new Error('[pixel_dot_geometry] dotDrawnRadius: missing entry');
  }
  if (!Number.isFinite(entry.renderScale) || !(entry.renderScale > 0)) {
    throw new Error('[pixel_dot_geometry] dotDrawnRadius: entry ' +
      `'${entry.name || '(unnamed)'}' carries no positive renderScale ` +
      `(got ${JSON.stringify(entry.renderScale)}). Every pixel-map producer must ` +
      'stamp the DRAWN render multiplier — see generatePixelMap().');
  }
  if (!Number.isFinite(globalScale) || !(globalScale > 0)) {
    throw new Error('[pixel_dot_geometry] dotDrawnRadius: \'globalScale\' must be a ' +
      `positive number, got ${JSON.stringify(globalScale)}`);
  }
  const sizeMm = entry.pixelSize || DEFAULT_PIXEL_SIZE_MM;
  return sizeMm * 0.001 * entry.renderScale * globalScale;
}

/**
 * Write one instance matrix of the dot mesh: the pixel's DRAWN world position
 * (`rx/ry/rz`) at the given radius. A radius of 0 hides the instance (that is
 * how view isolation drops a non-member dot).
 *
 * @param {Object} mesh - THREE.InstancedMesh (anything with setMatrixAt)
 * @param {number} index - instance index
 * @param {Object} entry - a batch render-list entry
 * @param {number} radius - world-unit radius (0 = hidden)
 * @param {Object} dummy - a shared THREE.Object3D scratch (no per-pixel alloc)
 */
export function writeDotMatrix(mesh, index, entry, radius, dummy) {
  if (!Number.isFinite(entry.rx) || !Number.isFinite(entry.ry) || !Number.isFinite(entry.rz)) {
    throw new Error('[pixel_dot_geometry] writeDotMatrix: entry ' +
      `'${entry.name || '(unnamed)'}' carries no DRAWN position (rx/ry/rz). The dot mesh ` +
      'must never fall back to the physical x/y/z — that is the render-scale bug.');
  }
  dummy.position.set(entry.rx, entry.ry, entry.rz);
  dummy.scale.setScalar(radius);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

/**
 * led_halo.js — the ONE halo recipe every LED fixture renders.
 *
 * A halo is not decoration bolted onto one fixture class: in this sim it is HOW
 * a lit pixel reads at night. An LED pixel with no halo renders as a hard dot
 * that vanishes at distance, so any LED fixture that skips the halo silently
 * drops out of the beauty render next to its neighbours.
 *
 * Two render paths used to own two different halos:
 *   • led_strand.js      — instanced additive rim, radius = params.ledHaloSize
 *                          × params.globalHaloScale (the GUI "Halo Size" and
 *                          "Global Halo Size" settings).
 *   • dmx_fixture_runtime.js for LED-bus fixtures (TE Sign, TE LED Grid) —
 *                          NO rim halo at all, only a diffusion Sprite gated on
 *                          the per-fixture `diffusion` toggle and sized from the
 *                          pixel's PHYSICAL size (a 12 mm puck ⇒ ~7× smaller
 *                          than the strand beside it, and zero with diffusion
 *                          off). That is the TE Sign "no halos" bug.
 *
 * This module is that single source of truth. Both paths now build the same
 * material and resolve the same radius from the same settings, so "every LED
 * fixture abides by the halo settings" is a property of the code, not of each
 * fixture class remembering to opt in.
 *
 * PERF (memory `sim_perf_per_object_explosion`): the halo is always drawn as ONE
 * InstancedMesh per fixture — never one object per pixel. This module hands out
 * the material + radius; the caller owns the InstancedMesh.
 */
import * as THREE from 'three';
import { params } from '../core/state.js';

// Halo radius in world units when the GUI setting is absent. Multiplied by
// params.globalHaloScale ("Global Halo Size") to get the rendered radius.
export const LED_HALO_RADIUS = 0.14;

// Per-fragment opacity of the additive rim. The legacy DMX halo recipe, kept
// byte-for-byte so the existing look is unchanged.
export const LED_HALO_OPACITY = 0.2;

// The largest a pixel's opaque BULB core may be drawn, as a fraction of the
// distance to its nearest neighbouring pixel in the SAME fixture.
//
// Why this exists: a model fixture's bulb radius is its PHYSICAL pixel size
// times the global "Global Pixel Size" slider (0.1–5). That slider knows
// nothing about how far apart a fixture's pixels actually are, so past a
// per-fixture threshold the opaque cores overlap and the fixture stops reading
// as a run of lights — it fuses into one solid blob column. The Vintage LED
// Stage Light is the worst case in the shipped set: 6 heads on a 75 mm pitch
// with 18 mm bulbs, so its cores touch at "Global Pixel Size" ≥ 1.9 and are
// 2.7× the pitch at the slider's max (and at the titanic scene's own saved
// value of 5) — six distinct Edison heads rendered as one fused sausage.
//
// 0.3 is not a taste number: it is the ratio the LED strands already render at
// under the shipped settings, which is the look the operator points to as
// correct (bulb radius params.ledPixelSize 0.08 over a titanic strand pitch of
// ~0.28 world units ⇒ 0.28). A core drawn at 0.3 × pitch leaves 40 % of the
// pitch as dark gap, so neighbouring pixels always stay individually readable.
export const MAX_BULB_PITCH_FRACTION = 0.3;

// How much wider than its bulb a DMX fixture's sphere halo is drawn at the
// default halo setting. A DMX par/bar/vintage head has a REAL physical bulb, so
// its halo is a rim around that bulb — unlike an LED-bus pixel, whose 12 mm
// puck is a token and whose halo is the absolute `ledHaloRadius()`.
export const HALO_RIM_FACTOR = 1.8;

// The largest a pixel's ADDITIVE HALO may be drawn, as a multiple of the
// distance to its nearest neighbour in the same fixture.
//
// The halo needs its own ceiling, looser than the bulb's, because the two bound
// different things. `MAX_BULB_PITCH_FRACTION` protects OPAQUE cores: two solid
// spheres that touch destroy the "six distinct Edison heads" read, and that is a
// real defect. A halo is additive and transparent — neighbouring halos merging
// is not a defect, it is how a run of lights reads at night. Every LED-bus
// fixture already does it on purpose (a sign's halos are MEANT to merge into one
// luminous sheet), and the LED strands the operator points to as CORRECT run a
// halo ~0.7× their own pitch, i.e. overlapping by 40 %.
//
// 1.5 is derived, not taste. A multi-pixel fixture's bulb sits at its own
// ceiling `0.3 × pitch`; the halo is that bulb × `dmxHaloRimMultiple`, which
// tops out at 5.0 at the slider maximum. So the smallest ceiling that lets the
// halo knob reach its top end at all is `0.3 × 5.0 = 1.5 × pitch`. Anything
// tighter pins the rim the moment the bulb hits its own cap — which is exactly
// what made "Global Halo Size" dead above 1.0 on the vintage lights and the
// bars (operator, 2026-07-30: "none of the DMX lights"). The bound still exists,
// so a dense fixture cannot smear without limit; it just no longer bites before
// the knob has done anything.
export const MAX_HALO_PITCH_MULTIPLE = 1.5;

/**
 * The rim multiple a DMX fixture's halo is drawn at, for a given "Global Halo
 * Size" setting: the halo slider widens the RIM, it does not scale the whole
 * radius.
 *
 * Why it works this way (operator: "make sure all DMX fixtures have the halo"):
 * the halo used to be `physicalBulb × 1.8 × haloScale` while the bulb it rims
 * was `physicalBulb × pixelScale`. Two different sliders on the two radii means
 * the "rim" sinks INSIDE its own opaque core as soon as
 * `haloScale < pixelScale / 1.8` — at the operator's own settings (Global Pixel
 * Size 1.1, Global Halo Size 0.6) a par's halo was 0.98× its bulb: present in
 * the scene graph, drawn every frame, and invisible. Every model-scaled fixture
 * made it worse, because the bulb grew and the rim did not.
 *
 * Expressed as a rim multiple the halo is always OUTSIDE the bulb (the factor
 * is ≥ 1 for any non-negative setting), it still answers to the same one global
 * control, and at the shipped default (1.0) it is exactly the historical
 * `bulb × 1.8`. No parallel knob, no per-fixture opt-in.
 *
 * @param {number} haloScale - params.globalHaloScale ("Global Halo Size")
 * @returns {number} multiple of the DRAWN bulb radius (>= 1)
 */
export function dmxHaloRimMultiple(haloScale) {
  if (!Number.isFinite(haloScale) || haloScale < 0) {
    throw new Error(`[led_halo] dmxHaloRimMultiple: 'haloScale' must be a non-negative number, got ${JSON.stringify(haloScale)}`);
  }
  return 1 + (HALO_RIM_FACTOR - 1) * haloScale;
}

/**
 * Bound a pixel's rendered bulb radius by the fixture's own pixel spacing, so
 * the size sliders can never fuse a multi-pixel fixture into one blob.
 *
 * This is a CEILING, not a replacement: below the ceiling the radius is passed
 * through untouched, so "Pixel Size" / "Global Pixel Size" keep working exactly
 * as before. The ceiling is derived from the fixture's own model geometry — it
 * is data, not a hardcoded magic size.
 *
 * @param {number} radius - the settings-derived radius (world units)
 * @param {number} pitch - distance to the nearest neighbouring pixel in this
 *   fixture, in world units. Pass 0 for a fixture with a single pixel (nothing
 *   to fuse with) — then there is no ceiling.
 * @returns {number} the radius to render
 */
export function clampPixelRadiusToPitch(radius, pitch) {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error(`[led_halo] clampPixelRadiusToPitch: 'radius' must be a non-negative number, got ${JSON.stringify(radius)}`);
  }
  if (!Number.isFinite(pitch) || pitch < 0) {
    throw new Error(`[led_halo] clampPixelRadiusToPitch: 'pitch' must be a non-negative number (0 = no neighbour), got ${JSON.stringify(pitch)}`);
  }
  if (pitch === 0) return radius;
  return Math.min(radius, pitch * MAX_BULB_PITCH_FRACTION);
}

// ── Per-fixture LOCAL halo scale ─────────────────────────────────────────
// Operator, 2026-07-30: "Each fixture having a local override sounds good for
// the halo, but an overall global halo too would be nice — local is maybe a
// scale for the global?" So a halo is THREE factors, multiplied:
//
//     effective halo = (class base) × Global Halo Size × local haloScale
//
//   class base  — LED bus: params.ledHaloSize (an absolute radius).
//                 DMX bus: the drawn bulb × dmxHaloRimMultiple (a rim).
//   global      — params.globalHaloScale, the one scene-wide knob (20260725_75).
//   local       — config.haloScale on the fixture, default 1.0.
//
// The UI slider bounds input to this range. Nothing is silently clamped: a
// value outside it can only arrive from a hand-edited scene, and the resolver
// below refuses garbage LOUDLY rather than quietly substituting 1.
export const LOCAL_HALO_SCALE_MIN = 0.1;
export const LOCAL_HALO_SCALE_MAX = 10;

/**
 * The per-fixture local halo multiplier for a fixture/strand config.
 *
 * ABSENT means 1.0 — a DEFINED default so every scene written before this
 * property existed renders byte-identically, not a fallback masking a failure.
 * A value that is PRESENT but not a positive finite number is a broken scene:
 * throw (codex P0) rather than silently drawing the wrong size.
 *
 * @param {Object|null} config - fixture config (parLights[] / ledStrands[] entry)
 * @param {string} [label] - fixture name for the error message
 * @returns {number} the local multiplier (> 0)
 */
export function resolveLocalHaloScale(config, label = '(unnamed fixture)') {
  if (!config || config.haloScale === undefined || config.haloScale === null) return 1;
  const scale = Number(config.haloScale);
  if (!Number.isFinite(scale) || !(scale > 0)) {
    throw new Error(`[led_halo] resolveLocalHaloScale: '${label}' has haloScale ` +
      `${JSON.stringify(config.haloScale)} — a local halo scale must be a positive ` +
      `finite number (the UI range is ${LOCAL_HALO_SCALE_MIN}–${LOCAL_HALO_SCALE_MAX}). ` +
      'Refusing to draw a guessed size.');
  }
  return scale;
}

/**
 * Bound a pixel's rendered ADDITIVE HALO radius by the fixture's own pixel
 * spacing. Same shape as clampPixelRadiusToPitch, but a LOOSER multiple
 * (MAX_HALO_PITCH_MULTIPLE) — see that constant for why the halo must not share
 * the opaque bulb's ceiling.
 *
 * @param {number} radius - the settings-derived halo radius (world units)
 * @param {number} pitch - distance to the nearest neighbouring pixel in this
 *   fixture, in world units. Pass 0 for a single-pixel fixture (nothing to merge
 *   with) — then there is no ceiling.
 * @returns {number} the radius to render
 */
export function clampHaloRadiusToPitch(radius, pitch) {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error(`[led_halo] clampHaloRadiusToPitch: 'radius' must be a non-negative number, got ${JSON.stringify(radius)}`);
  }
  if (!Number.isFinite(pitch) || pitch < 0) {
    throw new Error(`[led_halo] clampHaloRadiusToPitch: 'pitch' must be a non-negative number (0 = no neighbour), got ${JSON.stringify(pitch)}`);
  }
  if (pitch === 0) return radius;
  return Math.min(radius, pitch * MAX_HALO_PITCH_MULTIPLE);
}

/**
 * Distance from each pixel to its nearest neighbour, minimised over the whole
 * fixture — the spacing the bulb ceiling is derived from. Computed ONCE when a
 * fixture is built (it is a property of the model, not of the settings).
 *
 * Nearest-neighbour rather than "consecutive in the list" because a pixel map
 * may be a grid or an arbitrary sign layout, where list order says nothing
 * about which pixels sit next to each other on screen.
 *
 * @param {Array<{x:number,y:number,z:number}>} positions - pixel positions in
 *   fixture-local space (THREE.Vector3 or any {x,y,z}).
 * @returns {number} the minimum spacing in world units, or 0 for fewer than two
 *   pixels (no neighbour ⇒ no ceiling).
 */
export function minPixelPitch(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return 0;
  let min = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      const dz = positions[i].z - positions[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < min) min = d;
    }
  }
  // Coincident pixels (d === 0) carry no spacing information — treat the
  // fixture as unspaced rather than collapsing every bulb to zero.
  return Number.isFinite(min) && min > 0 ? min : 0;
}

/**
 * Resolve a GUI size setting against a module default. Absent or invalid
 * (non-finite, non-positive) takes the default — a DEFINED default for an
 * unset slider, not a codex "fallback behavior" masking a failure.
 * @param {*} value - the params value (may be undefined)
 * @param {number} fallback - the module default; must be a positive number
 * @returns {number}
 */
export function resolveLedSize(value, fallback) {
  if (!Number.isFinite(fallback) || !(fallback > 0)) {
    throw new Error(`[led_halo] resolveLedSize: 'fallback' must be a positive number, got ${JSON.stringify(fallback)}`);
  }
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The rendered halo radius (world units) for ANY LED fixture: the "Halo Size"
 * setting scaled by "Global Halo Size". Read fresh from `params` on every call
 * so a slider move takes effect on the next rebuild without cached copies.
 *
 * @param {number} [globalHaloScale] - override for params.globalHaloScale
 *   (callers that already received the global scale, e.g. updateScales()).
 * @returns {number} halo radius in world units
 */
export function ledHaloRadius(globalHaloScale = params.globalHaloScale) {
  const scale = Number.isFinite(globalHaloScale) && globalHaloScale > 0 ? globalHaloScale : 1;
  return resolveLedSize(params.ledHaloSize, LED_HALO_RADIUS) * scale;
}

/**
 * Build the halo material: an additive BackSide rim, so only the far hemisphere
 * draws and there is no hard front edge. Material color stays WHITE — the real
 * per-pixel color rides in the InstancedMesh's instanceColor.
 * @returns {THREE.MeshBasicMaterial} a fresh material (one per fixture)
 */
export function createLedHaloMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: LED_HALO_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
}

/**
 * Is this fixture definition an LED fixture (i.e. must it abide by the LED halo
 * settings)? The rule is the BUS, never a fixture-type name — a new LED product
 * gets the halo for free by declaring `bus: led` in its model YAML.
 * @param {Object|null} fixtureDef
 * @returns {boolean}
 */
export function isLedBusFixture(fixtureDef) {
  return !!(fixtureDef && fixtureDef.bus === 'led');
}

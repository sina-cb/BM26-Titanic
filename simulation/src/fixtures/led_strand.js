import * as THREE from 'three';
import { params } from '../core/state.js';
import { scaleSimulationPreviewRgb, mixRgbwauToRgb } from "../core/sim_preview.js";
import { ledDisplayGroup, scaleRgbForLedOutput } from "../core/group_lock.js";

// ── Shared, never-disposed module geometry ───────────────────────────────
// Endpoint handles: small draggable spheres (was 0.3 — ~6× the bulb radius,
// which visually swallowed short strands). Shrunk to 0.12 and dropped to a
// dim idle opacity so they read as edit affordances, not part of the render.
const handleGeo = new THREE.SphereGeometry(0.12, 12, 12);
const HANDLE_IDLE_OPACITY = 0.45;
const startHandleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: HANDLE_IDLE_OPACITY });
const endHandleMat   = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: HANDLE_IDLE_OPACITY });

// Unit low-poly sphere shared by every strand's bulb + halo InstancedMesh —
// same rationale as the DMX runtime's cached spheres: at pixel scale the
// facets are invisible, so a (6,4) sphere is free FPS. Module constant, never
// disposed (mirrors dmx_fixture_runtime.js:31 and the handleGeo above).
const pixelSphereGeo = new THREE.SphereGeometry(1, 6, 4);

// ── Artist-tunable LED "point source" look ───────────────────────────────
// Bulb: opaque, full-bright, toneMapped:false so it punches through the
// scene's ACES 0.55 exposure and reliably crosses the 0.92 bloom threshold
// (main.js:106-107,144-153) — the crisp LED core. Halo: the DMX halo recipe
// byte-for-byte (dmx_fixture_runtime.js:227-234) — additive BackSide rim, no
// hard front edge, soft glow. No dark housing mesh exists any more.
export const LED_BULB_RADIUS = 0.05;   // world units
export const LED_HALO_RADIUS = 0.14;   // world units, ×params.globalHaloScale
const LED_HALO_OPACITY = 0.2;

// A GLOBAL size (params.ledPixelSize / params.ledHaloSize) sets the bulb + halo
// radius for EVERY strand at once — one control above the strand list, not
// per-strand. Absent/invalid (non-finite or non-positive) falls back to the
// module default — a defined default, not a codex "fallback behavior".
function resolveSize(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Reused across setLedColorRGB calls so per-frame recolors allocate nothing.
const _pixelColor = new THREE.Color();

export class LedStrand {
  constructor(config, index, scene, interactiveObjects) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this._selected = false;
    this._visible = true;
    // Editing guides (connector wire + endpoint handles) are OUT of the beauty
    // render by default — shown only while the strand is selected/editing, or
    // when the global "Show Guides" toggle force-shows them for an edit session.
    this._guidesVisible = false;

    // Per-strand InstancedMesh handles (assigned in rebuildVisuals).
    this.bulbInst = null;
    this.haloInst = null;

    // Visual group holds wire + tube + instanced pixels (wire/tube guide-gated)
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Draggable start handle
    this.startHandle = new THREE.Mesh(handleGeo, startHandleMat.clone());
    this.startHandle.userData = { isLedStrand: true, fixture: this, handleType: 'start' };
    this.scene.add(this.startHandle);
    this.interactiveObjects.push(this.startHandle);

    // Draggable end handle
    this.endHandle = new THREE.Mesh(handleGeo, endHandleMat.clone());
    this.endHandle.userData = { isLedStrand: true, fixture: this, handleType: 'end' };
    this.scene.add(this.endHandle);
    this.interactiveObjects.push(this.endHandle);

    this.rebuildVisuals();
  }

  get startPos() {
    return new THREE.Vector3(
      this.config.startX ?? 0,
      this.config.startY ?? 5,
      this.config.startZ ?? 0
    );
  }

  get endPos() {
    return new THREE.Vector3(
      this.config.endX ?? 5,
      this.config.endY ?? 5,
      this.config.endZ ?? 0
    );
  }

  // Remove + dispose all group children. The shared pixel sphere is a module
  // constant used by every strand's InstancedMeshes — never dispose it.
  _clearGroup() {
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.material) child.material.dispose();
      if (child.geometry && child.geometry !== pixelSphereGeo) child.geometry.dispose();
    }
    this.bulbInst = null;
    this.haloInst = null;
  }

  rebuildVisuals() {
    this._clearGroup();

    const start = this.startPos;
    const end = this.endPos;
    const dir = end.clone().sub(start);
    const length = dir.length();
    const color = this.config.color || '#ff8800';
    // Static-preview color scaled by the GLOBAL master (params.strandsEnabled) +
    // this strand's group master (On/Off + Brightness) so an OFF master/group
    // dims/blacks the pixels even when no pattern is painting — the same override
    // the direct-paint path applies live. Either OFF ⇒ black. One source of
    // truth (scaleRgbForLedOutput → ledOutputScale) across every LED path.
    const baseColor = new THREE.Color(color);
    const [gr, gg, gb] = scaleRgbForLedOutput(
      params.strandsEnabled, params.ledGroupOverrides, ledDisplayGroup(this.config),
      baseColor.r, baseColor.g, baseColor.b);
    const colorObj = new THREE.Color(gr, gg, gb);

    // ─── Thin wire between endpoints (guide — hidden in the beauty render) ───
    if (length > 0.01) {
      const wireGeo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x333333,
        transparent: true,
        opacity: 0.6,
      });
      const wire = new THREE.Line(wireGeo, wireMat);
      wire.userData._strandPart = 'wire';
      this.group.add(wire);
    }

    // ─── Glow tube (only visible when selected) ───
    if (length > 0.01) {
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const orient = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize()
      );

      const tubeGeo = new THREE.CylinderGeometry(0.12, 0.12, length, 8, 1, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.copy(midpoint);
      tube.quaternion.copy(orient);
      tube.visible = this._selected;
      tube.userData._strandPart = 'tube';
      this.group.add(tube);
    }

    // ─── Individual LEDs — two InstancedMeshes (bulb + halo), no dark core ───
    const ledCount = this.config.ledCount || 10;

    // Opaque, full-bright emissive core. Material color stays white; the actual
    // pixel color rides in the per-instance instanceColor (multiplied in-shader).
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const bulbInst = new THREE.InstancedMesh(pixelSphereGeo, bulbMat, ledCount);
    bulbInst.userData._strandPart = 'led';
    // Instances span the strand while the InstancedMesh origin sits at the
    // group origin — the unit-sphere bounding volume would frustum-cull wrong,
    // so disable culling (per-strand pixel counts are modest).
    bulbInst.frustumCulled = false;

    // Soft additive rim — DMX halo recipe (dmx_fixture_runtime.js:227-234).
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: LED_HALO_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const haloInst = new THREE.InstancedMesh(pixelSphereGeo, haloMat, ledCount);
    haloInst.userData._strandPart = 'led';
    haloInst.frustumCulled = false;

    const globalHalo = Number.isFinite(params.globalHaloScale) ? params.globalHaloScale : 1;
    const bulbScale = resolveSize(params.ledPixelSize, LED_BULB_RADIUS);
    const haloScale = resolveSize(params.ledHaloSize, LED_HALO_RADIUS) * globalHalo;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < ledCount; i++) {
      const t = ledCount > 1 ? i / (ledCount - 1) : 0.5;
      const pos = new THREE.Vector3().lerpVectors(start, end, t);

      dummy.position.copy(pos);
      dummy.scale.setScalar(bulbScale);
      dummy.updateMatrix();
      bulbInst.setMatrixAt(i, dummy.matrix);
      bulbInst.setColorAt(i, colorObj);

      dummy.scale.setScalar(haloScale);
      dummy.updateMatrix();
      haloInst.setMatrixAt(i, dummy.matrix);
      haloInst.setColorAt(i, colorObj);
    }
    bulbInst.instanceMatrix.needsUpdate = true;
    haloInst.instanceMatrix.needsUpdate = true;
    if (bulbInst.instanceColor) bulbInst.instanceColor.needsUpdate = true;
    if (haloInst.instanceColor) haloInst.instanceColor.needsUpdate = true;

    this.group.add(bulbInst);
    this.group.add(haloInst);
    this.bulbInst = bulbInst;
    this.haloInst = haloInst;

    // Sync handle positions
    this.startHandle.position.copy(start);
    this.endHandle.position.copy(end);

    // Re-apply visibility so a rebuild preserves selected / guides / hidden state.
    this._applyVisibility();
  }

  writeTransformToConfig(handleType) {
    if (handleType === 'start') {
      this.config.startX = this.startHandle.position.x;
      this.config.startY = this.startHandle.position.y;
      this.config.startZ = this.startHandle.position.z;
    } else {
      this.config.endX = this.endHandle.position.x;
      this.config.endY = this.endHandle.position.y;
      this.config.endZ = this.endHandle.position.z;
    }
  }

  syncFromConfig() {
    this.rebuildVisuals();
  }

  /**
   * Re-render this strand after the GLOBAL visual size changes
   * (params.ledPixelSize / params.ledHaloSize) so the GUI can push the new
   * bulb/halo radius live. Called per-strand across every fixture on change.
   * A thin, intention-revealing alias for rebuildVisuals().
   */
  applyVisualSize() {
    this.rebuildVisuals();
  }

  destroy() {
    this._clearGroup();
    this.scene.remove(this.group);
    this.scene.remove(this.startHandle);
    this.scene.remove(this.endHandle);
    // Handle materials are per-instance clones — dispose them.
    if (this.startHandle.material) this.startHandle.material.dispose();
    if (this.endHandle.material) this.endHandle.material.dispose();

    const ioStart = this.interactiveObjects.indexOf(this.startHandle);
    if (ioStart > -1) this.interactiveObjects.splice(ioStart, 1);
    const ioEnd = this.interactiveObjects.indexOf(this.endHandle);
    if (ioEnd > -1) this.interactiveObjects.splice(ioEnd, 1);
  }

  setSelected(selected) {
    this._selected = selected;
    // Highlight handles while selected; guide/tube visibility follows selection.
    this.startHandle.material.opacity = selected ? 1.0 : HANDLE_IDLE_OPACITY;
    this.endHandle.material.opacity = selected ? 1.0 : HANDLE_IDLE_OPACITY;
    this._applyVisibility();
  }

  /**
   * Set the color of a specific LED by index. Writes the per-instance color on
   * both the bulb and halo InstancedMeshes — no fragile child-index arithmetic,
   * so a degenerate (zero-length, wire/tube-less) strand recolors correctly.
   * @param {number} index - LED index (0-based)
   * @param {number} r - Red (0-1)
   * @param {number} g - Green (0-1)
   * @param {number} b - Blue (0-1)
   */
  setLedColorRGB(index, r, g, b) {
    const [rn, gn, bn] = scaleSimulationPreviewRgb(r, g, b);
    _pixelColor.setRGB(rn, gn, bn);
    if (this.bulbInst) {
      this.bulbInst.setColorAt(index, _pixelColor);
      if (this.bulbInst.instanceColor) this.bulbInst.instanceColor.needsUpdate = true;
    }
    if (this.haloInst) {
      this.haloInst.setColorAt(index, _pixelColor);
      if (this.haloInst.instanceColor) this.haloInst.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Set an LED's color from the FULL RGBWAU pixel. The W/A/U channels are
   * folded into RGB using the firmware's exact toRGBFallback weights
   * (mixRgbwauToRgb) so a pattern that calls rgbwau(...,w,...) lights this
   * strand white in the sim, matching how the WS2812-RGBW hardware would
   * render the same pixel. Then the standard sim-brightness scale applies.
   * @param {number} index - LED index (0-based)
   * @param {number} r,g,b,w,a,u - channels (0-1)
   */
  setLedColorRGBWAU(index, r, g, b, w = 0, a = 0, u = 0) {
    const [mr, mg, mb] = mixRgbwauToRgb(r, g, b, w, a, u);
    this.setLedColorRGB(index, mr, mg, mb);
  }

  setVisibility(visible) {
    this._visible = visible;
    this._applyVisibility();
  }

  /**
   * Toggle the editing guides: the gray connector wire between the endpoints
   * and the two draggable endpoint handles. When off, only the LED pixels
   * render — a clean "pixels only" beauty view. A selected strand always shows
   * its guides regardless of this flag; the glow tube is selection-driven.
   * @param {boolean} visible
   */
  setGuidesVisible(visible) {
    this._guidesVisible = visible;
    this._applyVisibility();
  }

  // Apply the current visible / guides / selected flags to the group children
  // + handles. The instanced pixels always render; the wire + handles show when
  // guides are on OR the strand is selected; the tube shows only when selected.
  _applyVisibility() {
    this.group.visible = this._visible;
    const guidesOn = this._guidesVisible || this._selected;
    for (const child of this.group.children) {
      if (child.userData._strandPart === 'wire') child.visible = guidesOn;
      if (child.userData._strandPart === 'tube') child.visible = this._selected;
    }
    const handlesOn = this._visible && guidesOn;
    this.startHandle.visible = handlesOn;
    this.endHandle.visible = handlesOn;
  }
}

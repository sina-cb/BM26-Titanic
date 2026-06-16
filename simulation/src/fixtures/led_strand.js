import * as THREE from 'three';
import { scaleSimulationPreviewRgb } from "../core/sim_preview.js";

// ─── Shared resources ────────────────────────────────────────────────────────
// Endpoint handles (guides — hidden when LED Guides are off).
const handleGeo = new THREE.SphereGeometry(0.3, 12, 12);
const startHandleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 });
const endHandleMat   = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7 });

// Soft radial "dot" sprite, the way LX Studio / Chromatik / TouchDesigner draw
// pixels: a white hot centre fading to transparent. Tinted per-point by vertex
// colours and accumulated with additive blending so adjacent/overlapping LEDs
// bloom together instead of reading as hard spheres.
const DOT_TEXTURE = (() => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Point sizes in world units (sizeAttenuation makes them shrink with distance,
// like real fixtures). Core = tight bright pixel; glow = soft coloured corona.
const CORE_SIZE = 0.22;
const GLOW_SIZE = 0.9;

// Global pixel-size multiplier, driven by the "LED Pixel Size" control. Applied
// to new strands at build time; live changes go through LedStrand.setPixelSize.
let PIXEL_SCALE = 1;
export function setLedPixelScale(scale) {
  PIXEL_SCALE = (Number.isFinite(scale) && scale > 0) ? scale : 1;
}

export class LedStrand {
  constructor(config, index, scene, interactiveObjects) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this._selected = false;
    this._guidesVisible = true;

    // Visual group holds wire + LED points (+ selection tube).
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Draggable start/end handles (guides).
    this.startHandle = new THREE.Mesh(handleGeo, startHandleMat.clone());
    this.startHandle.userData = { isLedStrand: true, fixture: this, handleType: 'start' };
    this.scene.add(this.startHandle);
    this.interactiveObjects.push(this.startHandle);

    this.endHandle = new THREE.Mesh(handleGeo, endHandleMat.clone());
    this.endHandle.userData = { isLedStrand: true, fixture: this, handleType: 'end' };
    this.scene.add(this.endHandle);
    this.interactiveObjects.push(this.endHandle);

    // Per-LED point layers (built in rebuildVisuals).
    this.corePoints = null;
    this.glowPoints = null;
    this._coreColors = null;
    this._glowColors = null;

    this.rebuildVisuals();
  }

  get startPos() {
    return new THREE.Vector3(this.config.startX ?? 0, this.config.startY ?? 5, this.config.startZ ?? 0);
  }

  get endPos() {
    return new THREE.Vector3(this.config.endX ?? 5, this.config.endY ?? 5, this.config.endZ ?? 0);
  }

  rebuildVisuals() {
    // Clear existing children.
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.corePoints = this.glowPoints = null;
    this._coreColors = this._glowColors = null;

    const start = this.startPos;
    const end = this.endPos;
    const dir = end.clone().sub(start);
    const length = dir.length();
    const color = this.config.color || '#ff8800';

    // ─── Thin wire between endpoints (guide) ───
    if (length > 0.01) {
      const wireGeo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.5 });
      const wire = new THREE.Line(wireGeo, wireMat);
      wire.userData._strandPart = 'wire';
      wire.visible = this._guidesVisible;
      this.group.add(wire);
    }

    // ─── Selection glow tube (only when selected) ───
    if (length > 0.01) {
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const orient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      const tubeGeo = new THREE.CylinderGeometry(0.12, 0.12, length, 8, 1, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.copy(midpoint);
      tube.quaternion.copy(orient);
      tube.visible = this._selected;
      tube.userData._strandPart = 'tube';
      this.group.add(tube);
    }

    // ─── LED pixels as additive glow points (core + corona) ───
    const ledCount = Math.max(0, this.config.ledCount || 10);
    if (ledCount > 0) {
      const positions = new Float32Array(ledCount * 3);
      this._coreColors = new Float32Array(ledCount * 3);
      this._glowColors = new Float32Array(ledCount * 3);
      const base = new THREE.Color(color);

      for (let i = 0; i < ledCount; i++) {
        const t = ledCount > 1 ? i / (ledCount - 1) : 0.5;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
        this._coreColors[i * 3] = base.r; this._coreColors[i * 3 + 1] = base.g; this._coreColors[i * 3 + 2] = base.b;
        this._glowColors[i * 3] = base.r; this._glowColors[i * 3 + 1] = base.g; this._glowColors[i * 3 + 2] = base.b;
      }

      // Soft coloured corona (drawn first / underneath).
      const glowGeo = new THREE.BufferGeometry();
      glowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      glowGeo.setAttribute('color', new THREE.BufferAttribute(this._glowColors, 3));
      const glowMat = new THREE.PointsMaterial({
        size: GLOW_SIZE * PIXEL_SCALE, map: DOT_TEXTURE, vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        opacity: 0.55, toneMapped: false,
      });
      this.glowPoints = new THREE.Points(glowGeo, glowMat);
      this.glowPoints.userData._strandPart = 'led';
      this.group.add(this.glowPoints);

      // Tight bright pixel core (drives bloom; reads as a hot point).
      const coreGeo = new THREE.BufferGeometry();
      coreGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      coreGeo.setAttribute('color', new THREE.BufferAttribute(this._coreColors, 3));
      const coreMat = new THREE.PointsMaterial({
        size: CORE_SIZE * PIXEL_SCALE, map: DOT_TEXTURE, vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        toneMapped: false,
      });
      this.corePoints = new THREE.Points(coreGeo, coreMat);
      this.corePoints.userData._strandPart = 'led';
      this.group.add(this.corePoints);
    }

    // Sync handle positions.
    this.startHandle.position.copy(start);
    this.endHandle.position.copy(end);
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

  destroy() {
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.scene.remove(this.group);
    this.scene.remove(this.startHandle);
    this.scene.remove(this.endHandle);

    const ioStart = this.interactiveObjects.indexOf(this.startHandle);
    if (ioStart > -1) this.interactiveObjects.splice(ioStart, 1);
    const ioEnd = this.interactiveObjects.indexOf(this.endHandle);
    if (ioEnd > -1) this.interactiveObjects.splice(ioEnd, 1);
  }

  setSelected(selected) {
    this._selected = selected;
    this.group.children.forEach(child => {
      if (child.userData._strandPart === 'tube') child.visible = selected;
    });
    this.startHandle.material.opacity = selected ? 1.0 : 0.7;
    this.endHandle.material.opacity = selected ? 1.0 : 0.7;
  }

  /**
   * Set the color of a single LED. Writes the per-point vertex colour into both
   * the core and corona point layers (the bright core gives the hot centre, the
   * corona the soft additive halo).
   */
  setLedColorRGB(index, r, g, b) {
    if (!this.corePoints || index < 0) return;
    const n = this._coreColors.length / 3;
    if (index >= n) return;
    const [rn, gn, bn] = scaleSimulationPreviewRgb(r, g, b);
    const o = index * 3;
    this._coreColors[o] = rn; this._coreColors[o + 1] = gn; this._coreColors[o + 2] = bn;
    this._glowColors[o] = rn; this._glowColors[o + 1] = gn; this._glowColors[o + 2] = bn;
    this.corePoints.geometry.attributes.color.needsUpdate = true;
    this.glowPoints.geometry.attributes.color.needsUpdate = true;
  }

  setVisibility(visible) {
    this.group.visible = visible;
    // Handles follow both master visibility and the guides toggle.
    this.startHandle.visible = visible && this._guidesVisible;
    this.endHandle.visible = visible && this._guidesVisible;
  }

  /** Live-update this strand's pixel size (multiplier of the base point sizes). */
  setPixelSize(scale) {
    const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
    if (this.corePoints) this.corePoints.material.size = CORE_SIZE * s;
    if (this.glowPoints) this.glowPoints.material.size = GLOW_SIZE * s;
  }

  /**
   * Show/hide the strand GUIDES (wire path + drag handles) without touching the
   * lights themselves. Driven by the global "Enable LED Guides" toggle.
   */
  setGuidesVisible(visible) {
    this._guidesVisible = visible;
    this.group.children.forEach(child => {
      if (child.userData._strandPart === 'wire') child.visible = visible;
    });
    this.startHandle.visible = visible && this.group.visible;
    this.endHandle.visible = visible && this.group.visible;
  }
}

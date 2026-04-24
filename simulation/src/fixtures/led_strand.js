import * as THREE from 'three';
import { scaleSimulationPreviewRgb } from "../core/sim_preview.js";

// Shared geometry for endpoint handles
const handleGeo = new THREE.SphereGeometry(0.3, 12, 12);
const startHandleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 });
const endHandleMat   = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7 });

export class LedStrand {
  constructor(config, index, scene, interactiveObjects) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this._selected = false;

    // Visual group holds wire + LEDs + tube (tube hidden by default)
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

  rebuildVisuals() {
    // Clear existing children
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const start = this.startPos;
    const end = this.endPos;
    const dir = end.clone().sub(start);
    const length = dir.length();
    const color = this.config.color || '#ff8800';

    // ─── Thin wire between endpoints (always visible) ───
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

    // ─── Individual LEDs (realistic small emissive bulbs) ───
    const ledCount = this.config.ledCount || 10;
    const colorObj = new THREE.Color(color);

    for (let i = 0; i < ledCount; i++) {
      const t = ledCount > 1 ? i / (ledCount - 1) : 0.5;
      const pos = new THREE.Vector3().lerpVectors(start, end, t);

      // LED housing (dark base)
      const housingGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.06, 6);
      const housingMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.9,
        metalness: 0.3,
      });
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.position.copy(pos);
      // Orient housing along strand direction
      if (length > 0.01) {
        housing.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), dir.clone().normalize()
        );
      }
      housing.userData._strandPart = 'led';
      this.group.add(housing);

      // LED emissive bulb (bright glowing dome)
      const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8);
      const bulbMat = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: true,
        opacity: 0.95,
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.copy(pos);
      bulb.userData._strandPart = 'led';
      this.group.add(bulb);

      // LED glow halo (soft bloom around each LED)
      const haloGeo = new THREE.SphereGeometry(0.12, 8, 8);
      const haloMat = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(pos);
      halo.userData._strandPart = 'led';
      this.group.add(halo);
    }

    // Sync handle positions
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
    // Clean up group children
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
    // Show/hide the glow tube based on selection
    this.group.children.forEach(child => {
      if (child.userData._strandPart === 'tube') {
        child.visible = selected;
      }
    });
    // Highlight handles
    this.startHandle.material.opacity = selected ? 1.0 : 0.7;
    this.endHandle.material.opacity = selected ? 1.0 : 0.7;
  }

  /**
   * Set the color of a specific LED by index.
   * Robust accessor that avoids fragile child index arithmetic.
   * Group children layout: [wire, tube, (housing, bulb, halo) × ledCount]
   * @param {number} index - LED index (0-based)
   * @param {number} r - Red (0-1)
   * @param {number} g - Green (0-1)
   * @param {number} b - Blue (0-1)
   */
  setLedColorRGB(index, r, g, b) {
    const [rn, gn, bn] = scaleSimulationPreviewRgb(r, g, b);
    const ledStartIdx = 2; // skip wire + tube
    const baseIdx = ledStartIdx + index * 3;
    const children = this.group.children;
    // bulb = second in each LED triplet (housing, bulb, halo)
    const bulb = children[baseIdx + 1];
    const halo = children[baseIdx + 2];
    if (bulb && bulb.material) {
      bulb.material.color.setRGB(rn, gn, bn);
    }
    if (halo && halo.material) {
      halo.material.color.setRGB(rn, gn, bn);
    }
  }

  setVisibility(visible) {
    this.group.visible = visible;
    this.startHandle.visible = visible;
    this.endHandle.visible = visible;
  }
}

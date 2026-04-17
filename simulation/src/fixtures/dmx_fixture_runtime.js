/**
 * dmx_fixture_runtime.js — Unified runtime fixture for the simulation.
 *
 * Replaces both legacy ParLight and ModelFixture classes.
 * Renders the fixture based on its FixtureDefinition pixel layout:
 *   - UkingPar: single bulb/halo
 *   - ShehdsBar: 18 LEDs along a bar body
 *   - VintageLed: 6 heads vertically
 *
 * In lite mode, SpotLights are replaced with emissive spheres.
 */
import * as THREE from 'three';
import { params } from "../core/state.js";

// ── Shared geometries ────────────────────────────────────────────────────
const defaultShellMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.5 });
const defaultDotMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 32, 1, true);
baseBeamGeo.translate(0, -0.5, 0);
baseBeamGeo.rotateX(Math.PI / 2); // Point wide end towards -Z

const bulbGeo = new THREE.SphereGeometry(0.25, 12, 8);
const haloGeo = new THREE.SphereGeometry(0.6, 12, 8);

// WebGPU has no shader uniform limit — no SpotLight cap needed.

export class DmxFixtureRuntime {
  /**
   * @param {Object} config      - Fixture config from scene_config.yaml fixtures[] entry
   * @param {number} index       - Index in the fixtures array
   * @param {THREE.Scene} scene  - Three.js scene
   * @param {Array} interactiveObjects - Raycast targets array
   * @param {number} modelRadius - Scene model radius (for SpotLight range)
   * @param {Object|null} fixtureDef - From FixtureDefinitionRegistry
   * @param {Object|null} patchDef   - From PatchRegistry (null = unpatched)
     */
  constructor(config, index, scene, interactiveObjects, modelRadius, fixtureDef, patchDef) {
    // Lighting profile: full | unified | full_lite | unified_lite | super_lite | edit
    const profile = params.lightingProfile || 'full_lite';
    this.profile = profile;
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;
    this.fixtureDef = fixtureDef;
    this.patchDef = patchDef;

    const color = config.color || '#ffaa44';
    const intensity = config.intensity || 5;
    const angle = config.angle || 20;
    const penumbra = config.penumbra || 0.5;

    // ─── Group (parent container for all visuals) ────────────────────
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // ─── Parse fixture dimensions ────────────────────────────────────
    let width = 0.15, height = 0.15, depth = 0.12;
    if (fixtureDef && fixtureDef.dimensions) {
      width = (fixtureDef.dimensions.width || 100) * 0.001;
      height = (fixtureDef.dimensions.height || 100) * 0.001;
      depth = (fixtureDef.dimensions.depth || 100) * 0.001;
    }
    this._fixtureWidth = width;
    this._fixtureHeight = height;

    // ─── Hitbox ──────────────────────────────────────────────────────
    const padding = 0.1;
    const hitboxGeo = new THREE.BoxGeometry(
      Math.max(width, 0.5) + padding,
      Math.max(height, 0.5) + padding,
      Math.max(depth, 0.5) + padding
    );
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.userData = { isParLight: true, fixture: this };
    this.interactiveObjects.push(this.hitbox);
    this.scene.add(this.hitbox);

    // ─── Build Shell (fixture body) ──────────────────────────────────
    this.shellMat = null;
    if (fixtureDef && fixtureDef.shell) {
      this.shellMat = defaultShellMat.clone();
      this.shellMat.color.set(fixtureDef.shell.color || '#111111');
      let shellGeo;
      if (fixtureDef.shell.type === 'cylinder') {
        const d = fixtureDef.shell.dimensions;
        const r = (d[0] / 2) * 0.001;
        const h = d[2] * 0.001;
        shellGeo = new THREE.CylinderGeometry(r, r, h, 16);
        shellGeo.rotateX(Math.PI / 2);
      } else {
        const d = fixtureDef.shell.dimensions;
        shellGeo = new THREE.BoxGeometry(d[0] * 0.001, d[1] * 0.001, d[2] * 0.001);
      }
      this.shell = new THREE.Mesh(shellGeo, this.shellMat);
      if (fixtureDef.shell.offset) {
        const o = fixtureDef.shell.offset;
        this.shell.position.set(o[0] * 0.001, o[1] * 0.001, -o[2] * 0.001);
      }
      this.group.add(this.shell);
    } else {
      // No shell definition — create a simple can geometry (like old ParLight)
      const canGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.2, 12);
      canGeo.rotateX(Math.PI / 2);
      this.shellMat = defaultShellMat.clone();
      this.shell = new THREE.Mesh(canGeo, this.shellMat);
      this.group.add(this.shell);
    }

    // ─── Build Pixels (dots + lights) ────────────────────────────────
    // WebGPU: every pixel gets its own SpotLight (no uniform limit).
    this.pixels = [];
    const hasPixelDef = fixtureDef && fixtureDef.pixels && fixtureDef.pixels.length > 0;

    // Object-level global lights (mode-dependent)
    this.fixtureSpotLight = null;
    this.litePointLight = null;

    if (profile === 'unified') {
      // Single SpotLight per fixture
      this.fixtureSpotLight = new THREE.SpotLight(
        color, intensity, Math.min(modelRadius * 2, 80),
        THREE.MathUtils.degToRad(angle), penumbra, 1.5
      );
      this.fixtureSpotLight.castShadow = false;
      this.scene.add(this.fixtureSpotLight);
      this.scene.add(this.fixtureSpotLight.target);
    } else if (profile === 'full_lite' || profile === 'unified_lite') {
      // Single cheap PointLight per fixture
      this.litePointLight = new THREE.PointLight(color, intensity * 0.5, 40);
      this.scene.add(this.litePointLight);
    }

    if (hasPixelDef) {
      fixtureDef.pixels.forEach((pixelModel, pIndex) => {
        const dots = [];
        let avgX = 0, avgY = 0, avgZ = 0;

        if (pixelModel.dots && pixelModel.dots.length > 0) {
          pixelModel.dots.forEach(d => {
            const pos = new THREE.Vector3(d[0] * 0.001, d[1] * 0.001, -d[2] * 0.001);
            avgX += pos.x; avgY += pos.y; avgZ += pos.z;
            const dotSize = typeof pixelModel.size === 'number' ? pixelModel.size * 0.001 : 0.012;
            const dotGeo = new THREE.SphereGeometry(dotSize, 8, 8);
            const dotMesh = new THREE.Mesh(dotGeo, defaultDotMat.clone());
            dotMesh.position.copy(pos);
            this.group.add(dotMesh);
            dots.push({ pos, mesh: dotMesh });
          });
          avgX /= pixelModel.dots.length;
          avgY /= pixelModel.dots.length;
          avgZ /= pixelModel.dots.length;
        }

        const localPos = new THREE.Vector3(avgX, avgY, avgZ);

        const bulbMat = new THREE.MeshBasicMaterial({ color: color });
        const bulbSize = typeof pixelModel.size === 'number' ? pixelModel.size * 0.001 * 2 : 0.08;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(bulbSize, 8, 6), bulbMat);
        bulb.position.copy(localPos);
        this.group.add(bulb);

        const haloMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
        });
        const halo = new THREE.Mesh(new THREE.SphereGeometry(bulbSize * 2.5, 8, 6), haloMat);
        halo.position.copy(localPos);
        this.group.add(halo);

        // SpotLight — 1:1 per pixel (no cap with WebGPU)
        let spotLight = null;
        if (profile === 'full') {
          spotLight = new THREE.SpotLight(
            color, intensity, modelRadius * 3,
            THREE.MathUtils.degToRad(angle), penumbra, 1.5
          );
          spotLight.position.set(avgX, avgY, avgZ);
          spotLight.castShadow = false;
          this.scene.add(spotLight);
          this.scene.add(spotLight.target);
        }

        const coneMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.12,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const beam = new THREE.Mesh(baseBeamGeo, coneMat);
        beam.position.set(avgX, avgY, avgZ);
        this.group.add(beam);

        this.pixels.push({
          model: pixelModel, spotLight, beam, bulb, bulbMat, halo, haloMat, dots, localPos,
        });
      });
    } else {
      // No pixel definition — single bulb (simple par light fallback)
      const bulbMat = new THREE.MeshBasicMaterial({ color: color });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      this.group.add(bulb);

      const haloMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      this.group.add(halo);

      let spotLight = null;
      if (profile === 'full') {
        spotLight = new THREE.SpotLight(
          color, intensity, modelRadius * 3,
          THREE.MathUtils.degToRad(angle), penumbra, 1.5
        );
        spotLight.castShadow = false;
        this.scene.add(spotLight);
        this.scene.add(spotLight.target);
      }

      const coneMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(baseBeamGeo, coneMat);
      this.group.add(beam);

      this.pixels.push({
        model: null,
        spotLight,
        beam,
        bulb,
        bulbMat,
        halo,
        haloMat,
        dots: [],
        localPos: new THREE.Vector3(0, 0, 0),
      });
    }

    // ─── Initial positioning ─────────────────────────────────────────
    this.syncFromConfig();
  }

  // ── Visual sync ──────────────────────────────────────────────────────

  updateVisualsFromHitbox() {
    // Sync group to hitbox
    this.group.position.copy(this.hitbox.position);
    this.group.quaternion.copy(this.hitbox.quaternion);
    this.group.scale.copy(this.hitbox.scale);
    this.group.updateMatrixWorld(true);

    const dirLocal = new THREE.Vector3(0, 0, -1);
    const color = this.config.color || '#ffaa44';
    const intensity = this.config.intensity || 5;
    const angle = this.config.angle || 20;
    const penumbra = this.config.penumbra || 0.5;

    // Sync fixture-level global lights
    if (this.fixtureSpotLight) {
      const worldPos = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld);
      this.fixtureSpotLight.position.copy(worldPos);
      this.fixtureSpotLight.intensity = intensity;
      this.fixtureSpotLight.angle = Math.min(THREE.MathUtils.degToRad(angle), Math.PI / 2 - 0.1);
      this.fixtureSpotLight.penumbra = penumbra;
      this.fixtureSpotLight.color.set(color);
      const worldDir = dirLocal.clone().transformDirection(this.group.matrixWorld).normalize();
      this.fixtureSpotLight.target.position.copy(worldPos).add(worldDir.multiplyScalar(100));
      this.fixtureSpotLight.target.updateMatrixWorld();
    }
    if (this.litePointLight) {
      const worldPos = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld);
      this.litePointLight.position.copy(worldPos);
      this.litePointLight.intensity = intensity * 0.5;
      this.litePointLight.color.set(color);
    }

    this.pixels.forEach(p => {
      // Update SpotLight world position (SpotLights are scene children, not group children)
      if (p.spotLight) {
        const worldPos = p.localPos.clone().applyMatrix4(this.group.matrixWorld);
        p.spotLight.position.copy(worldPos);
        p.spotLight.intensity = intensity;
        p.spotLight.angle = THREE.MathUtils.degToRad(angle);
        p.spotLight.penumbra = penumbra;
        p.spotLight.color.set(color);

        const worldDir = dirLocal.clone().transformDirection(this.group.matrixWorld).normalize();
        p.spotLight.target.position.copy(worldPos).add(worldDir.multiplyScalar(100));
        p.spotLight.target.updateMatrixWorld();
      }

      // Beam scale
      const coneLen = 3.0;
      const angleRad = THREE.MathUtils.degToRad(angle);
      const radius = Math.tan(angleRad) * coneLen;
      p.beam.scale.set(radius, radius, coneLen);
      p.beam.material.color.set(color);

      // Bulb + halo color
      p.bulbMat.color.set(color);
      p.haloMat.color.set(color);
    });
  }

  syncFromConfig() {
    const x = this.config.x || 0;
    const y = this.config.y || 1.5;
    const z = this.config.z || 0;
    this.hitbox.position.set(x, y, z);
    this.hitbox.rotation.setFromVector3(new THREE.Vector3(
      THREE.MathUtils.degToRad(this.config.rotX || 0),
      THREE.MathUtils.degToRad(this.config.rotY || 0),
      THREE.MathUtils.degToRad(this.config.rotZ || 0)
    ), 'YXZ');
    this.updateVisualsFromHitbox();
  }

  // ── Color control (used by lighting engines) ─────────────────────────

  setColor(r, g, b) {
    if (this.fixtureSpotLight) this.fixtureSpotLight.color.setRGB(r, g, b);
    if (this.litePointLight) this.litePointLight.color.setRGB(r, g, b);
    this.pixels.forEach(p => {
      if (p.spotLight) p.spotLight.color.setRGB(r, g, b);
      p.beam.material.color.setRGB(r, g, b);
      p.bulbMat.color.setRGB(r, g, b);
      p.haloMat.color.setRGB(r, g, b);
      p.dots.forEach(d => {
        if (d.mesh) d.mesh.material.color.setRGB(r + 0.3, g + 0.3, b + 0.3);
      });
    });
  }

  setBulbColor(r, g, b) {
    this.pixels.forEach(p => {
      p.bulbMat.color.setRGB(r, g, b);
      p.haloMat.color.setRGB(r, g, b);
      p.dots.forEach(d => {
        if (d.mesh) d.mesh.material.color.setRGB(r + 0.3, g + 0.3, b + 0.3);
      });
    });
  }

  setPixelColorRGB(pIndex, r, g, b) {
    // Drive fixture-level lights from the first pixel's color
    if (pIndex === 0) {
      if (this.fixtureSpotLight) this.fixtureSpotLight.color.setRGB(r, g, b);
      if (this.litePointLight) this.litePointLight.color.setRGB(r, g, b);
    }
    if (pIndex >= 0 && pIndex < this.pixels.length) {
      const p = this.pixels[pIndex];
      if (p.spotLight) p.spotLight.color.setRGB(r, g, b);
      p.beam.material.color.setRGB(r, g, b);
      p.bulbMat.color.setRGB(r, g, b);
      p.haloMat.color.setRGB(r, g, b);
      p.dots.forEach(d => {
        if (d.mesh) d.mesh.material.color.setRGB(r + 0.3, g + 0.3, b + 0.3);
      });
    }
  }

  // ── DMX frame application (Phase 2) ──────────────────────────────────

  applyDmxFrame(dmxSlice) {
    if (!dmxSlice || !this.fixtureDef) return;
    this.fixtureDef.pixels.forEach((pixelModel, pIndex) => {
      if (!pixelModel.channels) return;
      const ch = pixelModel.channels;
      if (ch.red !== undefined && ch.green !== undefined && ch.blue !== undefined) {
        const dimmer = ch.dimmer ? (dmxSlice[ch.dimmer - 1] / 255) : 1;
        const r = (dmxSlice[ch.red - 1] / 255) * dimmer;
        const g = (dmxSlice[ch.green - 1] / 255) * dimmer;
        const b = (dmxSlice[ch.blue - 1] / 255) * dimmer;
        this.setPixelColorRGB(pIndex, r, g, b);
      } else if (ch.value !== undefined) {
        const v = dmxSlice[ch.value - 1] / 255;
        this.setPixelColorRGB(pIndex, v * 1.0, v * 0.85, v * 0.6); // warm white
      }
    });
  }

  // ── Transform ────────────────────────────────────────────────────────

  handleTransformScale() {
    if (this.hitbox.scale.x !== 1 || this.hitbox.scale.y !== 1 || this.hitbox.scale.z !== 1) {
      this.config.angle = THREE.MathUtils.clamp(
        (this.config.angle || 20) * Math.max(this.hitbox.scale.x, this.hitbox.scale.y),
        5, 90
      );
      this.hitbox.scale.set(1, 1, 1);
    }
  }

  writeTransformToConfig() {
    this.config.x = this.hitbox.position.x;
    this.config.y = this.hitbox.position.y;
    this.config.z = this.hitbox.position.z;
    const euler = new THREE.Euler().setFromQuaternion(this.hitbox.quaternion, 'YXZ');
    this.config.rotX = THREE.MathUtils.radToDeg(euler.x);
    this.config.rotY = THREE.MathUtils.radToDeg(euler.y);
    this.config.rotZ = THREE.MathUtils.radToDeg(euler.z);
  }

  // ── Visibility ───────────────────────────────────────────────────────

  setVisibility(visible, conesVisible = true) {
    const profile = params.lightingProfile || 'full_lite';
    this.hitbox.visible = visible;
    this.group.visible = visible;

    if (profile === 'edit') {
      if (this.fixtureSpotLight) this.fixtureSpotLight.visible = false;
      if (this.litePointLight) this.litePointLight.visible = false;
      this.pixels.forEach(p => {
        if (p.spotLight) p.spotLight.visible = false;
        if (p.beam) p.beam.visible = false;
      });
      return;
    }

    if (this.fixtureSpotLight) this.fixtureSpotLight.visible = visible && (profile === 'unified');
    if (this.litePointLight) this.litePointLight.visible = visible && (profile === 'full_lite' || profile === 'unified_lite');

    this.pixels.forEach(p => {
      if (p.spotLight) p.spotLight.visible = visible && (profile === 'full');
      if (p.beam) p.beam.visible = visible && conesVisible;
    });
  }

  setSelected(selected) {
    if (this.shellMat) {
      this.shellMat.emissive.setHex(selected ? 0x2288ff : 0x000000);
      this.shellMat.emissiveIntensity = selected ? 1.0 : 0;
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  destroy() {
    this.scene.remove(this.group);
    this.scene.remove(this.hitbox);
    if (this.fixtureSpotLight) {
      this.scene.remove(this.fixtureSpotLight);
      this.scene.remove(this.fixtureSpotLight.target);
    }
    if (this.litePointLight) {
      this.scene.remove(this.litePointLight);
    }
    this.pixels.forEach(p => {
      if (p.spotLight) {
        this.scene.remove(p.spotLight);
        this.scene.remove(p.spotLight.target);
      }
      p.beam.material.dispose();
      p.bulbMat.dispose();
      p.haloMat.dispose();
      p.dots.forEach(d => {
        if (d.mesh && d.mesh.material) d.mesh.material.dispose();
      });
    });
    if (this.shellMat) this.shellMat.dispose();

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  // ── Utilities ────────────────────────────────────────────────────────

  /**
   * Get the physical width of this fixture in scene units (meters).
   * Used by generators for spacing.
   */
  static getFixtureWidth(fixtureDef) {
    if (!fixtureDef || !fixtureDef.dimensions) return 0.3; // default par width
    return (fixtureDef.dimensions.width || 100) * 0.001;
  }

  static getFixtureHeight(fixtureDef) {
    if (!fixtureDef || !fixtureDef.dimensions) return 0.3;
    return (fixtureDef.dimensions.height || 100) * 0.001;
  }

  // No spotlight cap with WebGPU — resetSpotlightCount() removed.
}

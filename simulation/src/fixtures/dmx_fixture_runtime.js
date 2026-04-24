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
import { getProfileDef } from "../core/profile_registry.js";
import { scaleSimulationPreviewRgb } from "../core/sim_preview.js";

// ── Shared geometries ────────────────────────────────────────────────────
const defaultShellMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
const defaultDotMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 16, 1, true);
baseBeamGeo.translate(0, -0.5, 0);
baseBeamGeo.rotateX(Math.PI / 2); // Point wide end towards -Z

const bulbGeo = new THREE.SphereGeometry(0.5, 8, 8);
const haloGeo = new THREE.SphereGeometry(0.8, 8, 8);

const _sphereCache = {};
function getCachedSphere(size) {
  const key = size.toFixed(5);
  if (!_sphereCache[key]) _sphereCache[key] = new THREE.SphereGeometry(size, 8, 8);
  return _sphereCache[key];
}

function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

function sanitizeRgb(r, g, b) {
  return [clampUnit(r), clampUnit(g), clampUnit(b)];
}

function readDmxChannelNormalized(dmxSlice, channelIndex) {
  if (!dmxSlice || !channelIndex || channelIndex < 1) return 0;
  const raw = dmxSlice[channelIndex - 1];
  return Number.isFinite(raw) ? THREE.MathUtils.clamp(raw / 255, 0, 1) : 0;
}

// SpotLight allocation is handled by light_pool.js — fixtures do NOT create lights.

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
    const profile = params.lightingProfile || 'edit';
    const profileDef = getProfileDef(profile);
    this.profile = profile;
    this.profileDef = profileDef;
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

    // ─── Build Pixels (dots + visual geometry only) ──────────────────
    // SpotLights are managed by the global LightPool (see light_pool.js).
    // Fixtures only store their desired lighting state for the pool orchestrator.
    this.pixels = [];
    const hasPixelDef = fixtureDef && fixtureDef.pixels && fixtureDef.pixels.length > 0;

    // Legacy references — no longer instantiated, but kept for API compat
    this.fixtureSpotLight = null;
    this.litePointLight = null;

    if (hasPixelDef) {
      fixtureDef.pixels.forEach((pixelModel, pIndex) => {
        // ─── Setup Emitters & Glow ───
        const shouldBuildEmitter = this.profileDef.render.emitterMode === 'pixel' || 
                                   (this.profileDef.render.emitterMode === 'fixture_representative' && pIndex === 0);

        let dots = [];
        let avgX = 0, avgY = 0, avgZ = 0;
        let bulb = null;
        let halo = null;
        let bulbMat = null;
        let haloMat = null;
        let dotMeshList = [];

        // Always calculate local coordinates as SpotLights and Beams rely on them
        const hasDots = pixelModel.dots && pixelModel.dots.length > 0;
        if (hasDots) {
           pixelModel.dots.forEach(d => {
             const pos = new THREE.Vector3(d[0] * 0.001, d[1] * 0.001, -d[2] * 0.001);
             avgX += pos.x; avgY += pos.y; avgZ += pos.z;
           });
           avgX /= pixelModel.dots.length;
           avgY /= pixelModel.dots.length;
           avgZ /= pixelModel.dots.length;
        }
        
        const localPos = new THREE.Vector3(avgX, avgY, avgZ);

        if (shouldBuildEmitter) {
            if (hasDots) {
              pixelModel.dots.forEach(d => {
                const pos = new THREE.Vector3(d[0] * 0.001, d[1] * 0.001, -d[2] * 0.001);
                let rawSize = 0;
                if (typeof pixelModel.size === 'number') rawSize = pixelModel.size;
                else if (Array.isArray(pixelModel.size)) rawSize = Math.max(...pixelModel.size);
                const dotSize = Math.max(rawSize * 0.001, 0.012);
                const dotGeo = getCachedSphere(dotSize);
                const dotMesh = new THREE.Mesh(dotGeo, null);
                dotMesh.position.copy(pos);
                dotMesh.matrixAutoUpdate = false; 
                dotMesh.updateMatrix();
                this.group.add(dotMesh);
                dotMeshList.push({ pos, mesh: dotMesh });
              });
              dots = dotMeshList; // ASSIGN DOTS HERE
            }

            bulbMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, side: THREE.DoubleSide });
            
            if (dotMeshList.length > 0) dotMeshList.forEach(d => { d.mesh.material = bulbMat; });

            let pixelSize = 0;
            if (typeof pixelModel.size === 'number') pixelSize = pixelModel.size;
            else if (Array.isArray(pixelModel.size)) pixelSize = Math.max(...pixelModel.size);
            const baseSize = Math.max(pixelSize * 0.002, 0.12);
            const repScale = this.profileDef.render.emitterMode === 'fixture_representative' ? 6.0 : 1.0;
            const bulbSize = baseSize * repScale;
            
            bulb = new THREE.Mesh(getCachedSphere(bulbSize), bulbMat);
            bulb.position.copy(localPos);
            if (this.profileDef.render.emitterMode === 'fixture_representative') {
               bulb.position.set(0, 0, 0); // Force to origin centroid for grouped representation!
            }
            this.group.add(bulb);

            haloMat = new THREE.MeshBasicMaterial({
              color, transparent: true, opacity: 0.2,
              blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
            });
            halo = new THREE.Mesh(getCachedSphere(bulbSize * 2.5), haloMat);
            halo.position.copy(bulb.position);
            this.group.add(halo);
        }

        // SpotLight managed by LightPool — no per-pixel instantiation
        let spotLight = null;

        const shouldBuildCone = this.profileDef.render.coneMode === 'pixel' || 
                                (this.profileDef.render.coneMode === 'fixture' && pIndex === 0);
        let beam = null;
        let coneMat = null;

        if (shouldBuildCone) {
          coneMat = new THREE.MeshBasicMaterial({
            color, depthWrite: true, side: THREE.DoubleSide,
          });
          beam = new THREE.Mesh(baseBeamGeo, coneMat);
          beam.position.set(avgX, avgY, avgZ);
          this.group.add(beam);
        }

        this.pixels.push({
          model: pixelModel, spotLight: null, beam, bulb, bulbMat, halo, haloMat, dots, localPos,
        });
      });
    } else {
      // No pixel definition — single bulb (simple par light fallback)
      let bulb = null, bulbMat = null, halo = null, haloMat = null;
      
      if (this.profileDef.render.emitterMode !== 'none') {
        bulbMat = new THREE.MeshBasicMaterial({ color: color });
        bulb = new THREE.Mesh(bulbGeo, bulbMat);
        this.group.add(bulb);

        haloMat = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        });
        halo = new THREE.Mesh(haloGeo, haloMat);
        this.group.add(halo);
      }

      // SpotLight managed by LightPool — no per-fixture instantiation
      let spotLight = null;

      const coneMat = new THREE.MeshBasicMaterial({
        color: color,
        depthWrite: true,
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

    // SpotLights are managed by the global LightPool — no per-fixture sync needed.
    // Only sync visual geometry (beams, bulbs, halos).

    this.pixels.forEach(p => {

      // Beam scale
      if (p.beam) {
        const coneLen = 1.5;
        const angleRad = THREE.MathUtils.degToRad(angle);
        const radius = Math.tan(angleRad) * coneLen;
        p.beam.scale.set(radius, radius, coneLen);
        p.beam.material.color.set(color);
      }

      // Bulb + halo color
      if (p.bulbMat) p.bulbMat.color.set(color);
      if (p.haloMat) p.haloMat.color.set(color);
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
    const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
    this.pixels.forEach(p => {
      if (p.beam) p.beam.material.color.setRGB(rn, gn, bn);
      if (p.bulbMat) p.bulbMat.color.setRGB(rn, gn, bn);
      if (p.haloMat) p.haloMat.color.setRGB(rn, gn, bn);
      if (p.dots) p.dots.forEach(d => {
        if (d.mesh && d.mesh.material) d.mesh.material.color.setRGB(
          Math.min(1, rn + 0.3),
          Math.min(1, gn + 0.3),
          Math.min(1, bn + 0.3)
        );
      });
    });
  }

  setBulbColor(r, g, b) {
    const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
    this.pixels.forEach(p => {
      if (p.bulbMat) {
        if (p.bulbMat.color.r !== rn || p.bulbMat.color.g !== gn || p.bulbMat.color.b !== bn) {
          p.bulbMat.color.setRGB(rn, gn, bn);
          if (p.haloMat) p.haloMat.color.setRGB(rn, gn, bn);
        }
      }
      if (p.dots) p.dots.forEach(d => {
        if (d.mesh && d.mesh.material) {
          const dotR = Math.min(1, rn + 0.3);
          const dotG = Math.min(1, gn + 0.3);
          const dotB = Math.min(1, bn + 0.3);
          if (d.mesh.material.color.r !== dotR || d.mesh.material.color.g !== dotG || d.mesh.material.color.b !== dotB) {
            d.mesh.material.color.setRGB(dotR, dotG, dotB);
          }
        }
      });
    });
  }

  setPixelColorRGB(pIndex, r, g, b) {
    // Drive fixture-level lights from the first pixel's color
    if (pIndex === 0) {

      // Unified mode: pixel 0's color drives ALL pixels
      if (this.profileDef.unifiedColor) {
        this._unifiedR = r; this._unifiedG = g; this._unifiedB = b;
        for (let i = 0; i < this.pixels.length; i++) {
          this._applyPixelColor(i, r, g, b);
        }
        return;
      }
    }

    // Unified mode: skip individual pixel updates (pixel 0 already handled all)
    if (this.profileDef.unifiedColor) return;

    this._applyPixelColor(pIndex, r, g, b);
  }

  _applyPixelColor(pIndex, r, g, b) {
    if (pIndex >= 0 && pIndex < this.pixels.length) {
      const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
      const p = this.pixels[pIndex];
      if (p.beam && (Math.abs(p.beam.material.color.r - rn) > 0.005 || Math.abs(p.beam.material.color.g - gn) > 0.005 || Math.abs(p.beam.material.color.b - bn) > 0.005)) {
        p.beam.material.color.setRGB(rn, gn, bn);
      }
      if (p.bulbMat) p.bulbMat.color.setRGB(rn, gn, bn);
      if (p.haloMat) p.haloMat.color.setRGB(rn, gn, bn);
    }
  }

  // ── DMX frame application (Phase 2) ──────────────────────────────────

  applyDmxFrame(dmxSlice) {
    if (!dmxSlice || !this.fixtureDef) return;
    this.fixtureDef.pixels.forEach((pixelModel, pIndex) => {
      if (!pixelModel.channels) return;
      const ch = pixelModel.channels;
      if (ch.red !== undefined && ch.green !== undefined && ch.blue !== undefined) {
        const dimmer = ch.dimmer ? readDmxChannelNormalized(dmxSlice, ch.dimmer) : 1;
        const r = readDmxChannelNormalized(dmxSlice, ch.red) * dimmer;
        const g = readDmxChannelNormalized(dmxSlice, ch.green) * dimmer;
        const b = readDmxChannelNormalized(dmxSlice, ch.blue) * dimmer;
        this.setPixelColorRGB(pIndex, r, g, b);
      } else if (ch.value !== undefined) {
        const v = readDmxChannelNormalized(dmxSlice, ch.value);
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
    const profile = params.lightingProfile || 'edit';
    const profileDef = getProfileDef(profile);
    this.hitbox.visible = visible;
    this.group.visible = visible;

    // SpotLights are managed by the global LightPool — no per-fixture visibility

    this.pixels.forEach((p, j) => {
      if (p.beam) {
         const shouldCone = (profileDef.render.coneMode === 'pixel') || (profileDef.render.coneMode === 'fixture' && j === 0);
         p.beam.visible = visible && conesVisible && shouldCone;
      }
      
      const shouldEmitter = (profileDef.render.emitterMode === 'pixel') || (profileDef.render.emitterMode === 'fixture_representative' && j === 0);
      if (p.halo) p.halo.visible = visible && shouldEmitter;
      if (p.bulb) p.bulb.visible = visible && shouldEmitter;
      if (p.dots) p.dots.forEach(d => { if (d.mesh) d.mesh.visible = visible && shouldEmitter; });
    });
  }

  setSelected(selected) {
    if (this.shellMat) {
      this.shellMat.color.setHex(selected ? 0x2288ff : 0x333333);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  destroy() {
    this.scene.remove(this.group);
    this.scene.remove(this.hitbox);
    
    // Rigorous cleanup pattern to prevent GC GPU fragmentation during rapid profile swapping
    const disposeNode = (node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
        else node.material.dispose();
      }
    };

    // SpotLights are managed by the global LightPool — nothing to remove here
    
    this.pixels.forEach(p => {
      if (p.beam) disposeNode(p.beam);
      if (p.bulb) disposeNode(p.bulb);
      if (p.halo) disposeNode(p.halo);
      
      // dots share bulb material, so disposing geometry is sufficient
      if (p.dots) p.dots.forEach(d => {
        if (d.mesh && d.mesh.geometry) d.mesh.geometry.dispose();
      });
    });

    if (this.shell) {
       this.shell.traverse((child) => {
          if (child.isMesh) disposeNode(child);
       });
    }

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

  // SpotLight management delegated to light_pool.js
}

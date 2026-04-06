import * as THREE from 'three';

// Reusable Shared Geometries to save memory across hundreds of fixtures
const canGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.36, 16);
canGeo.rotateX(Math.PI / 2); // default points up, rotate to point -Z
const canMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.5 });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 32, 1, true);
baseBeamGeo.translate(0, -0.5, 0); // Tip at origin
baseBeamGeo.rotateX(Math.PI / 2); // Point wide end towards Z

const hitboxGeo = new THREE.BoxGeometry(1.5, 1.5, 2.0);
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

// Lite mode: glowing sphere replaces SpotLight
const bulbGeo = new THREE.SphereGeometry(0.25, 12, 8);
const haloGeo = new THREE.SphereGeometry(0.6, 12, 8);

// WebGL fragment shader limit: ~256 uniforms → max ~120 SpotLights active at once.
// Beyond this, shaders fail to compile and the scene goes black.
const MAX_ACTIVE_SPOTLIGHTS = 120;
let activeSpotlightCount = 0;

export class ParLight {
  constructor(config, index, scene, interactiveObjects, modelRadius, liteMode = false) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;
    this.liteMode = liteMode;

    // ─── SpotLight (skipped in lite mode for GPU performance) ────────
    if (!liteMode) {
      this.light = new THREE.SpotLight(
        config.color,
        config.intensity,
        modelRadius * 3, // Distance
        (config.angle * Math.PI) / 180,
        config.penumbra,
        1.5
      );
      this.light.position.set(config.x || 0, config.y || 1.5, config.z || 0);
      // No shadow casting — WebGL has a hard limit on shadow-casting SpotLights.
      this.light.castShadow = false;
      this.scene.add(this.light);
      this.scene.add(this.light.target);
    } else {
      // Lightweight stub so the rest of the code can reference this.light safely
      this.light = {
        position: new THREE.Vector3(config.x || 0, config.y || 1.5, config.z || 0),
        target: { position: new THREE.Vector3() },
        color: new THREE.Color(config.color),
        intensity: config.intensity,
        angle: (config.angle * Math.PI) / 180,
        penumbra: config.penumbra,
        visible: false,
      };
    }

    // Hidden interactive hitbox
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.position.copy(this.light.position);
    
    // Set rotation from config
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(config.rotX || 0),
      THREE.MathUtils.degToRad(config.rotY || 0),
      THREE.MathUtils.degToRad(config.rotZ || 0),
      "YXZ"
    );
    this.hitbox.setRotationFromEuler(euler);

    // Par Can visual
    this.canMat = canMat.clone(); // Per-instance for selection highlighting
    this.can = new THREE.Mesh(canGeo, this.canMat);
    this.scene.add(this.can);
    
    // Beam visual (cone)
    const coneMat = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.beam = new THREE.Mesh(baseBeamGeo, coneMat);
    this.scene.add(this.beam);

    // ─── Glowing bulb (always created — lightweight emissive sphere) ────
    this.bulbMat = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: false,
    });
    this.bulb = new THREE.Mesh(bulbGeo, this.bulbMat);
    this.scene.add(this.bulb);

    // Soft halo around bulb
    this.haloMat = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.halo = new THREE.Mesh(haloGeo, this.haloMat);
    this.scene.add(this.halo);
    
    // Link back to this class instance so TransformControls can update it
    this.hitbox.userData = { isParLight: true, fixture: this };
    this.interactiveObjects.push(this.hitbox);
    this.scene.add(this.hitbox);
    
    this.updateVisualsFromHitbox();
  }

  updateVisualsFromHitbox() {
    // Sync Light position/target
    this.light.position.copy(this.hitbox.position);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.hitbox.quaternion);
    this.light.target.position.copy(this.hitbox.position).add(dir.multiplyScalar(100));
    
    this.light.color.set(this.config.color);
    this.light.intensity = this.config.intensity;
    this.light.angle = THREE.MathUtils.degToRad(this.config.angle);
    this.light.penumbra = this.config.penumbra;

    // Sync Visuals
    this.can.position.copy(this.hitbox.position);
    this.can.quaternion.copy(this.hitbox.quaternion);

    this.beam.position.copy(this.hitbox.position);
    this.beam.quaternion.copy(this.hitbox.quaternion);
    this.beam.material.color.set(this.config.color);
    
    const coneLen = 3.0; // Short representation cone just in front of light
    const angleRad = typeof this.light.angle === 'number' ? this.light.angle : THREE.MathUtils.degToRad(this.config.angle);
    const radius = Math.tan(angleRad) * coneLen;
    this.beam.scale.set(radius, radius, coneLen);

    // Sync bulb + halo
    this.bulb.position.copy(this.hitbox.position);
    this.bulbMat.color.set(this.config.color);
    this.halo.position.copy(this.hitbox.position);
    this.haloMat.color.set(this.config.color);
  }

  syncFromConfig() {
    this.hitbox.position.set(this.config.x || 0, this.config.y || 1.5, this.config.z || 0);
    this.hitbox.rotation.setFromVector3(new THREE.Vector3(
      THREE.MathUtils.degToRad(this.config.rotX || 0),
      THREE.MathUtils.degToRad(this.config.rotY || 0),
      THREE.MathUtils.degToRad(this.config.rotZ || 0)
    ), "YXZ");
    this.updateVisualsFromHitbox();
  }

  handleTransformScale() {
    if (this.hitbox.scale.x !== 1 || this.hitbox.scale.y !== 1 || this.hitbox.scale.z !== 1) {
      this.config.angle = THREE.MathUtils.clamp(
        this.config.angle * Math.max(this.hitbox.scale.x, this.hitbox.scale.y), 
        5, 90
      );
      this.hitbox.scale.set(1, 1, 1);
    }
  }

  writeTransformToConfig() {
    this.config.x = this.hitbox.position.x;
    this.config.y = this.hitbox.position.y;
    this.config.z = this.hitbox.position.z;

    const euler = new THREE.Euler().setFromQuaternion(this.hitbox.quaternion, "YXZ");
    this.config.rotX = THREE.MathUtils.radToDeg(euler.x);
    this.config.rotY = THREE.MathUtils.radToDeg(euler.y);
    this.config.rotZ = THREE.MathUtils.radToDeg(euler.z);
  }

  destroy() {
    this.scene.remove(this.hitbox);
    this.scene.remove(this.can);
    this.scene.remove(this.beam);
    this.scene.remove(this.bulb);
    this.scene.remove(this.halo);
    if (!this.liteMode) {
      this.scene.remove(this.light);
      this.scene.remove(this.light.target);
    }

    this.beam.material.dispose();
    this.canMat.dispose();
    this.bulbMat.dispose();
    this.haloMat.dispose();

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  setSelected(selected) {
    this.canMat.emissive.setHex(selected ? 0x2288ff : 0x000000);
    this.canMat.emissiveIntensity = selected ? 1.0 : 0;
  }

  setVisibility(visible, conesVisible = true) {
    if (!this.liteMode) {
      // Cap active SpotLights to prevent WebGL "too many uniforms" shader crash.
      const wasActive = this.light.visible;
      const wantActive = visible && (activeSpotlightCount < MAX_ACTIVE_SPOTLIGHTS || wasActive);

      if (wantActive && !wasActive) activeSpotlightCount++;
      if (!wantActive && wasActive) activeSpotlightCount--;

      this.light.visible = wantActive;
    }
    this.can.visible = visible;
    this.beam.visible = visible && conesVisible;
    // Glowing bulb + halo always visible when fixture is on (regardless of conesEnabled)
    this.bulb.visible = visible;
    this.halo.visible = visible;
  }

  // Allow engines (gradient/pixelblaze) to color the bulb + halo
  setBulbColor(r, g, b) {
    this.bulbMat.color.setRGB(r, g, b);
    this.haloMat.color.setRGB(r, g, b);
  }

  static resetSpotlightCount() {
    activeSpotlightCount = 0;
  }
}

import * as THREE from 'three';

// Reusable Shared Geometries to save memory across hundreds of fixtures
const canGeo = new THREE.CylinderGeometry(0.5, 0.4, 1.2, 16);
canGeo.rotateX(Math.PI / 2); // default points up, rotate to point -Z
const canMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.5 });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 32, 1, true);
baseBeamGeo.translate(0, -0.5, 0); // Tip at origin
baseBeamGeo.rotateX(Math.PI / 2); // Point wide end towards -Z

const hitboxGeo = new THREE.BoxGeometry(1.5, 1.5, 2.0);
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

export class ParLight {
  constructor(config, index, scene, interactiveObjects, modelRadius) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;

    this.light = new THREE.SpotLight(
      config.color,
      config.intensity,
      modelRadius * 3, // Distance
      (config.angle * Math.PI) / 180,
      config.penumbra,
      1.5
    );
    this.light.position.set(config.x || 0, config.y || 1.5, config.z || 0);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.02;

    this.scene.add(this.light);
    this.scene.add(this.light.target);

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
    this.can = new THREE.Mesh(canGeo, canMat);
    this.scene.add(this.can);
    
    // Beam visual
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
    
    // Link back to this class instance so TransformControls can update it
    this.hitbox.userData = { isParLight: true, fixture: this };
    this.interactiveObjects.push(this.hitbox);
    this.scene.add(this.hitbox);
    
    this.updateVisualsFromHitbox();
  }

  updateVisualsFromHitbox() {
    // Sync Light
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
    const radius = Math.tan(this.light.angle) * coneLen;
    this.beam.scale.set(radius, radius, coneLen);
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
    this.scene.remove(this.light);
    this.scene.remove(this.light.target);

    this.beam.material.dispose();

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  setVisibility(visible, conesVisible = true) {
    this.light.visible = visible;
    this.can.visible = visible;
    this.beam.visible = visible && conesVisible;
  }
}

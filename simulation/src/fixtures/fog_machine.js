import * as THREE from 'three';

export class FogMachine {
  constructor(config, index, scene, interactiveObjects, modelRadius) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    
    this.group = new THREE.Group();
    this.scene.add(this.group);
    
    // Base visual box
    this.boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this.boxMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    this.box = new THREE.Mesh(this.boxGeo, this.boxMat);
    this.group.add(this.box);

    // Fog visual: CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
    // We want the wide side (5) at +Y and the narrow side (0.2) at -Y
    this.fogGeo = new THREE.CylinderGeometry(5, 0.2, 8, 16);
    this.fogGeo.translate(0, 4, 0);
    this.fogGeo.rotateX(-Math.PI / 2); // point forward (-Z)
    this.fogMat = new THREE.MeshBasicMaterial({ 
      color: 0xcccccc, 
      transparent: true, 
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending 
    });
    this.fogMesh = new THREE.Mesh(this.fogGeo, this.fogMat);
    this.group.add(this.fogMesh);

    // Hitbox (invisible, independent)
    const hitboxGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 });
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.userData = { isParLight: true, fixture: this };
    
    // Check if interactiveObjects array exists since we dynamically injected this requirement
    if (this.interactiveObjects && Array.isArray(this.interactiveObjects)) {
      this.interactiveObjects.push(this.hitbox);
    }
    this.scene.add(this.hitbox);
    
    this.fixtureDef = { fixtureType: 'FogMachine' };
    
    this.syncFromConfig();

    this.fogLevel = 0;
  }
  
  syncFromConfig() {
    const x = this.config.x || 0;
    const y = this.config.y || 0;
    const z = this.config.z || 0;
    
    this.hitbox.position.set(x, y, z);
    this.group.position.set(x, y, z);
    
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(this.config.rotX || 0),
      THREE.MathUtils.degToRad(this.config.rotY || 0),
      THREE.MathUtils.degToRad(this.config.rotZ || 0),
      'YXZ'
    ));

    this.hitbox.quaternion.copy(quat);
    this.group.quaternion.copy(quat);
  }
  
  applyDmxFrame(dmxSlice) {
    if (!dmxSlice) return;
    const val = dmxSlice[0] / 255.0;
    this.fogLevel = val;
  }
  
  update() {
    const level = this._uiFogOverride ? 1.0 : this.fogLevel;
    if (level > 0.05) {
      this.fogMat.opacity = (level * 0.4) + (Math.random() * 0.1);
      this.fogMesh.scale.x = 1.0 + Math.random() * 0.05;
      this.fogMesh.scale.y = 1.0 + Math.random() * 0.05;
    } else {
      this.fogMat.opacity = 0;
    }
  }

  handleTransformScale() {}

  writeTransformToConfig() {
    this.config.x = parseFloat(this.hitbox.position.x.toFixed(3));
    this.config.y = parseFloat(this.hitbox.position.y.toFixed(3));
    this.config.z = parseFloat(this.hitbox.position.z.toFixed(3));

    const euler = new THREE.Euler().setFromQuaternion(this.hitbox.quaternion, 'YXZ');
    this.config.rotX = parseFloat(THREE.MathUtils.radToDeg(euler.x).toFixed(1));
    this.config.rotY = parseFloat(THREE.MathUtils.radToDeg(euler.y).toFixed(1));
    this.config.rotZ = parseFloat(THREE.MathUtils.radToDeg(euler.z).toFixed(1));
  }

  updateVisualsFromHitbox() {
    this.group.position.copy(this.hitbox.position);
    this.group.quaternion.copy(this.hitbox.quaternion);
  }
  
  setVisibility(visible) {
    this.group.visible = visible;
  }
  
  setSelected(selected) {
    if (this.boxMat) {
      this.boxMat.color.setHex(selected ? 0xffff00 : 0x333333);
    }
  }

  destroy() {
    this.scene.remove(this.group);
    this.scene.remove(this.hitbox);
    
    // Remove from interactive objects
    if (this.interactiveObjects && Array.isArray(this.interactiveObjects)) {
      const idx = this.interactiveObjects.indexOf(this.hitbox);
      if (idx > -1) this.interactiveObjects.splice(idx, 1);
    }
    
    // Dispose resources
    if (this.boxGeo) this.boxGeo.dispose();
    if (this.boxMat) this.boxMat.dispose();
    if (this.fogGeo) this.fogGeo.dispose();
    if (this.fogMat) this.fogMat.dispose();
    if (this.hitbox && this.hitbox.geometry) this.hitbox.geometry.dispose();
    if (this.hitbox && this.hitbox.material) this.hitbox.material.dispose();
  }
}

import * as THREE from 'three';

export class FogMachine {
  constructor(config, index, scene, interactiveObjects, modelRadius, fixtureDef = null) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.fixtureDefRef = fixtureDef;
    
    this.group = new THREE.Group();
    this.scene.add(this.group);
    
    // Base visual box (dynamically sized based on YAML definition if provided)
    let w = 0.5, h = 0.5, d = 0.5;
    let ox = 0, oy = 0, oz = 0;
    
    if (fixtureDef && fixtureDef.shell && fixtureDef.shell.dimensions) {
      w = fixtureDef.shell.dimensions[0] * 0.001;
      h = fixtureDef.shell.dimensions[1] * 0.001;
      d = fixtureDef.shell.dimensions[2] * 0.001;
      if (fixtureDef.shell.offset) {
        ox = fixtureDef.shell.offset[0] * 0.001;
        oy = fixtureDef.shell.offset[1] * 0.001;
        oz = fixtureDef.shell.offset[2] * 0.001;
      }
    }
    
    this.boxGeo = new THREE.BoxGeometry(w, h, d);
    this.boxMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    this.box = new THREE.Mesh(this.boxGeo, this.boxMat);
    this.box.position.set(ox, oy, oz);
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
    
    this.fixtureDef = { fixtureType: config.type || config.fixtureType || 'TEFogMachine' };
    
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
    let val = dmxSlice[0] / 255.0;
    
    // Chauvet 4D uses Channel 2 for Haze output (Channel 1 is Fan speed)
    const fType = this.config.type || this.config.fixtureType;
    if (fType === 'ChauvetHaze4D' && dmxSlice.length > 1) {
      val = dmxSlice[1] / 255.0;
    }
    
    this.fogLevel = val;
    this.lastDmxUpdate = performance.now();
  }
  
  update() {
    // When UI fog override is active, push max DMX values into the router
    // so the real fixture fires (both fan + haze for Chauvet 4D)
    if (this._uiFogOverride && window.dmxRouter) {
      const u = this.config.dmxUniverse;
      const addr = this.config.dmxAddress;
      if (u && u > 0 && addr && addr > 0) {
        const fType = this.config.type || this.config.fixtureType;
        if (fType === 'ChauvetHaze4D') {
          // Ch1: Fan=255, Ch2: Haze=255
          window.dmxRouter.submitFrame('fog_ui', 250, u, new Uint8Array([255, 255]), addr);
        } else {
          // TEFogMachine: Ch1: Fog=255
          window.dmxRouter.submitFrame('fog_ui', 250, u, new Uint8Array([255]), addr);
        }
      }
    }

    if (this.lastDmxUpdate && (performance.now() - this.lastDmxUpdate > 2000)) {
        this.fogLevel = 0;
    }

    const level = this._uiFogOverride ? 1.0 : this.fogLevel;
    if (level > 0.05) {
      this.fogMat.opacity = (level * 0.4) + (Math.random() * 0.1);
      this.fogMesh.scale.x = 1.0 + Math.random() * 0.05;
      this.fogMesh.scale.y = 1.0 + Math.random() * 0.05;
      this.fogMesh.visible = true;
    } else {
      this.fogMat.opacity = 0;
      this.fogMesh.visible = false;
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

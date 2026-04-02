import * as THREE from 'three';

// Shared materials
const defaultShellMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.5 });
const defaultDotMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 32, 1, true);
baseBeamGeo.translate(0, -0.5, 0); // Tip at origin
baseBeamGeo.rotateX(-Math.PI / 2); // Point wide end towards +Z

export class ModelFixture {
  constructor(config, index, scene, interactiveObjects, modelRadius, fixtureModel) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;
    this.fixtureModel = fixtureModel; // Extracted YAML object

    // Create a parent group to hold all the fixture's visual objects, which allows TransformControls to rotate everything together.
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Parse Dimensions
    let width = 0.5, height = 0.5, depth = 0.5;
    if (this.fixtureModel && this.fixtureModel.dimensions) {
      width = (this.fixtureModel.dimensions.width || 100) * 0.001;
      height = (this.fixtureModel.dimensions.height || 100) * 0.001;
      depth = (this.fixtureModel.dimensions.depth || 100) * 0.001;
    }

    // Hitbox
    const padding = 0.1;
    const hitboxGeo = new THREE.BoxGeometry(width + padding, height + padding, depth + padding);
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.scene.add(this.hitbox);

    // Link back for TransformControls raycasting
    this.hitbox.userData = { isParLight: true, fixture: this };
    interactiveObjects.push(this.hitbox);

    // Build Shell
    if (this.fixtureModel && this.fixtureModel.shell) {
       this.shellMat = defaultShellMat.clone();
       this.shellMat.color.set(this.fixtureModel.shell.color || '#111111');
       let shellGeo;
       if (this.fixtureModel.shell.type === 'cylinder') {
           const d = this.fixtureModel.shell.dimensions;
           const radius = (d[0] / 2) * 0.001;
           const h = d[2] * 0.001;
           shellGeo = new THREE.CylinderGeometry(radius, radius, h, 16);
           shellGeo.rotateX(Math.PI / 2);
       } else {
           const d = this.fixtureModel.shell.dimensions;
           shellGeo = new THREE.BoxGeometry(d[0]*0.001, d[1]*0.001, d[2]*0.001);
       }
       this.shell = new THREE.Mesh(shellGeo, this.shellMat);
       if (this.fixtureModel.shell.offset) {
           const o = this.fixtureModel.shell.offset;
           this.shell.position.set(o[0]*0.001, o[1]*0.001, o[2]*0.001);
       }
       this.group.add(this.shell);
    }

    // Build Pixels (Spotlights AND Visual Dots)
    this.pixels = [];
    if (this.fixtureModel && this.fixtureModel.pixels) {
      this.fixtureModel.pixels.forEach((pixelModel, pIndex) => {
         // Gather all dots, compute center for the SpotLight emission point
         const dots = [];
         let avgX = 0, avgY = 0, avgZ = 0;
         if (pixelModel.dots && pixelModel.dots.length > 0) {
            pixelModel.dots.forEach(d => {
               const pos = new THREE.Vector3(d[0]*0.001, d[1]*0.001, d[2]*0.001);
               avgX += pos.x; avgY += pos.y; avgZ += pos.z;
               // Create tiny visual sphere for the dot
               const dotGeo = new THREE.SphereGeometry(0.012, 8, 8);
               const dotMesh = new THREE.Mesh(dotGeo, defaultDotMat.clone());
               dotMesh.position.copy(pos);
               this.group.add(dotMesh);
               dots.push({ pos, mesh: dotMesh });
            });
            avgX /= pixelModel.dots.length;
            avgY /= pixelModel.dots.length;
            avgZ /= pixelModel.dots.length;
         } else {
           // Default fallback center
           avgX = 0; avgY = 0; avgZ = 0;
         }

         // Construct the physical SpotLight
         const spotLight = new THREE.SpotLight(
           config.color,
           config.intensity,
           modelRadius * 3, // Distance bounds
           THREE.MathUtils.degToRad(config.angle || 25), // Use 25 degree if specified or user default
           config.penumbra || 0.5,
           1.5
         );
         spotLight.position.set(avgX, avgY, avgZ);
         spotLight.castShadow = false;

         this.scene.add(spotLight.target);
         this.scene.add(spotLight);

         // Beam Cone
         const coneMat = new THREE.MeshBasicMaterial({
           color: config.color,
           transparent: true,
           opacity: 0.15,
           blending: THREE.AdditiveBlending,
           depthWrite: false,
           side: THREE.DoubleSide
         });
         const beam = new THREE.Mesh(baseBeamGeo, coneMat);
         // Set beam position locally within the group
         beam.position.set(avgX, avgY, avgZ);
         this.group.add(beam);

         this.pixels.push({
           model: pixelModel, // Reference to YAML pixel
           spotLight,
           beam,
           dots,
           localPos: new THREE.Vector3(avgX, avgY, avgZ)
         });
      });
    }

    // Initial position
    if (this.config.x !== undefined) {
      this.syncFromConfig();
    } else {
      this.updateVisualsFromHitbox();
    }
  }

  updateVisualsFromHitbox() {
    this.group.position.copy(this.hitbox.position);
    this.group.quaternion.copy(this.hitbox.quaternion);
    this.group.scale.copy(this.hitbox.scale);

    // The group contains the visual `shell` and the local `beam` meshes.
    // However, the `THREE.SpotLight` instances and their targets are in `scene`, 
    // so we must update their WORLD positions manually based on group's world matrix.
    
    this.group.updateMatrixWorld(true);

    const dirLocal = new THREE.Vector3(0, 0, 1);
    
    this.pixels.forEach(p => {
       // SpotLight settings
       p.spotLight.intensity = this.config.intensity;
       p.spotLight.angle = THREE.MathUtils.degToRad(this.config.angle || 25);
       p.spotLight.penumbra = this.config.penumbra || 0.5;

       // Get world position of the average origin point
       const worldPos = p.localPos.clone().applyMatrix4(this.group.matrixWorld);
       p.spotLight.position.copy(worldPos);

       // Target world position (100 units forward in local -Z space)
       const worldDir = dirLocal.clone().transformDirection(this.group.matrixWorld).normalize();
       p.spotLight.target.position.copy(worldPos).add(worldDir.multiplyScalar(100));
       p.spotLight.target.updateMatrixWorld();

       // Update Beam Scale
       const coneLen = 3.0; // Short representation cone
       const radius = Math.tan(p.spotLight.angle) * coneLen;
       p.beam.scale.set(radius, radius, coneLen);
    });
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
        (this.config.angle || 25) * Math.max(this.hitbox.scale.x, this.hitbox.scale.y), 
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
    this.scene.remove(this.group); // removes shell, dots, beams
    this.scene.remove(this.hitbox); // hitbox is in scene directly
    this.pixels.forEach(p => {
       this.scene.remove(p.spotLight);
       this.scene.remove(p.spotLight.target);
       p.beam.material.dispose();
       p.dots.forEach(d => {
         if (d.mesh && d.mesh.material) d.mesh.material.dispose();
       });
    });

    if (this.shellMat) this.shellMat.dispose();

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  setSelected(selected) {
    if (this.shellMat) {
       this.shellMat.emissive.setHex(selected ? 0x2288ff : 0x000000);
       this.shellMat.emissiveIntensity = selected ? 1.0 : 0;
    }
  }

  setVisibility(visible, conesVisible) {
    this.hitbox.visible = visible;
    this.group.visible = visible;
    this.pixels.forEach(p => {
       p.spotLight.visible = visible;
       p.beam.visible = visible && conesVisible;
    });
  }

  /**
   * Called by main.js in the render loop to set colors per pixel.
   */
  setPixelColorRGB(pIndex, r, g, b) {
    if (pIndex >= 0 && pIndex < this.pixels.length) {
       const p = this.pixels[pIndex];
       p.spotLight.color.setRGB(r, g, b);
       p.beam.material.color.setRGB(r, g, b);
       
       // Brighter dots
       p.dots.forEach(d => {
         if (d.mesh) {
           d.mesh.material.color.setRGB(r + 0.3, g + 0.3, b + 0.3);
         }
       });
    }
  }
}

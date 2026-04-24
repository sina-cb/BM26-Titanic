import * as THREE from 'three';
import { getProfileDef } from "../core/profile_registry.js";
import { params } from "../core/state.js";
import { scaleSimulationPreviewRgb } from "../core/sim_preview.js";

// Shared materials
const defaultShellMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
const defaultDotMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 16, 1, true);
baseBeamGeo.translate(0, -0.5, 0); // Tip at origin
baseBeamGeo.rotateX(-Math.PI / 2); // Point wide end towards +Z

function readDmxChannelNormalized(dmxSlice, channelIndex) {
  if (!dmxSlice || !channelIndex || channelIndex < 1) return 0;
  const raw = dmxSlice[channelIndex - 1];
  if (!Number.isFinite(raw)) return 0;
  return THREE.MathUtils.clamp(raw / 255, 0, 1);
}

export class ModelFixture {
  constructor(config, index, scene, interactiveObjects, modelRadius, fixtureModel, patchDef = null) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;
    this.fixtureModel = fixtureModel; // Extracted YAML object
    this.patchDef = patchDef;

    const profile = params.lightingProfile || 'edit';
    this.profileDef = getProfileDef(profile);

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
             });
             avgX /= pixelModel.dots.length;
             avgY /= pixelModel.dots.length;
             avgZ /= pixelModel.dots.length;
             
             const shouldBuildEmitter = this.profileDef.render.emitterMode === 'pixel' || 
                                        (this.profileDef.render.emitterMode === 'fixture_representative' && pIndex === 0);
             if (shouldBuildEmitter) {
               pixelModel.dots.forEach(d => {
                  const pos = new THREE.Vector3(d[0]*0.001, d[1]*0.001, d[2]*0.001);
                  const dotGeo = new THREE.SphereGeometry(0.012, 8, 8);
                  const dotMesh = new THREE.Mesh(dotGeo, defaultDotMat.clone());
                  dotMesh.position.copy(pos);
                  this.group.add(dotMesh);
                  dots.push({ pos, mesh: dotMesh });
               });
             }
          }

          let spotLight = null;
          if (this.profileDef.render.analyticLightMode === 'pixel') {
            spotLight = new THREE.SpotLight(
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
          }

          let beam = null;
          const shouldBuildCone = this.profileDef.render.coneMode === 'pixel' || 
                                  (this.profileDef.render.coneMode === 'fixture' && pIndex === 0);
          if (shouldBuildCone) {
            const coneMat = new THREE.MeshBasicMaterial({
              color: config.color,
              depthWrite: true,
              side: THREE.DoubleSide
            });
            beam = new THREE.Mesh(baseBeamGeo, coneMat);
            beam.position.set(avgX, avgY, avgZ);
            this.group.add(beam);
          }

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
       if (p.spotLight) {
          p.spotLight.intensity = this.config.intensity;
          p.spotLight.angle = THREE.MathUtils.degToRad(this.config.angle || 25);
          p.spotLight.penumbra = this.config.penumbra || 0.5;

          const worldPos = p.localPos.clone().applyMatrix4(this.group.matrixWorld);
          p.spotLight.position.copy(worldPos);

          const worldDir = dirLocal.clone().transformDirection(this.group.matrixWorld).normalize();
          p.spotLight.target.position.copy(worldPos).add(worldDir.multiplyScalar(100));
          p.spotLight.target.updateMatrixWorld();
       }

       if (p.beam) {
          const coneLen = 1.5;
          // Provide fallback angle for cone even if spotLight lacks
          const angleRad = p.spotLight ? p.spotLight.angle : THREE.MathUtils.degToRad(this.config.angle || 25);
          const radius = Math.tan(angleRad) * coneLen;
          p.beam.scale.set(radius, radius, coneLen);
       }
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
       if (p.spotLight) {
          this.scene.remove(p.spotLight);
          this.scene.remove(p.spotLight.target);
       }
       if (p.beam && p.beam.material) p.beam.material.dispose();
       if (p.dots) p.dots.forEach(d => {
         if (d.mesh && d.mesh.material) d.mesh.material.dispose();
         if (d.mesh && d.mesh.geometry) d.mesh.geometry.dispose();
       });
    });

    if (this.shellMat) this.shellMat.dispose();

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  setSelected(selected) {
    if (this.shellMat) {
       this.shellMat.color.setHex(selected ? 0x2288ff : 0x333333);
    }
  }

  setVisibility(visible, conesVisible) {
    const profile = params.lightingProfile || 'edit';
    const profileDef = getProfileDef(profile);

    this.hitbox.visible = visible;
    this.group.visible = visible;
    this.pixels.forEach((p, j) => {
       if (p.spotLight) p.spotLight.visible = visible && (profileDef.render.analyticLightMode === 'pixel');
       if (p.beam) {
           const shouldCone = (profileDef.render.coneMode === 'pixel') || (profileDef.render.coneMode === 'fixture' && j === 0);
           p.beam.visible = visible && conesVisible && shouldCone;
       }
       if (p.dots) {
           const shouldEmitter = (profileDef.render.emitterMode === 'pixel') || (profileDef.render.emitterMode === 'fixture_representative' && j === 0);
           p.dots.forEach(d => { if (d.mesh) d.mesh.visible = visible && shouldEmitter; });
       }
    });
  }

  /**
   * Called by main.js in the render loop to set colors per pixel.
   */
  setPixelColorRGB(pIndex, r, g, b) {
    if (pIndex >= 0 && pIndex < this.pixels.length) {
       const [rn, gn, bn] = scaleSimulationPreviewRgb(r, g, b);
       const p = this.pixels[pIndex];
       if (p.spotLight) p.spotLight.color.setRGB(rn, gn, bn);
       if (p.beam) p.beam.material.color.setRGB(rn, gn, bn);
       
       // Brighter dots
       if (p.dots) p.dots.forEach(d => {
         if (d.mesh) {
           d.mesh.material.color.setRGB(
             Math.min(1, rn + 0.3),
             Math.min(1, gn + 0.3),
             Math.min(1, bn + 0.3)
           );
         }
        });
     }
  }

  applyDmxFrame(dmxSlice) {
    if (!dmxSlice || !this.fixtureModel?.pixels) return;

    this.fixtureModel.pixels.forEach((pixelModel, pIndex) => {
      const channels = pixelModel.channels;
      if (!channels) return;

      if (channels.red !== undefined && channels.green !== undefined && channels.blue !== undefined) {
        const dimmer = channels.dimmer ? readDmxChannelNormalized(dmxSlice, channels.dimmer) : 1;
        const r = readDmxChannelNormalized(dmxSlice, channels.red) * dimmer;
        const g = readDmxChannelNormalized(dmxSlice, channels.green) * dimmer;
        const b = readDmxChannelNormalized(dmxSlice, channels.blue) * dimmer;
        this.setPixelColorRGB(pIndex, r, g, b);
      } else if (channels.value !== undefined) {
        const v = readDmxChannelNormalized(dmxSlice, channels.value);
        this.setPixelColorRGB(pIndex, v, v * 0.85, v * 0.6);
      }
    });
  }
}

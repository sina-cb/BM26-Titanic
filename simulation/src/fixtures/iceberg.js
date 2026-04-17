import * as THREE from 'three';
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// ─── Simple seedable PRNG (matches Echoes Iceberg Generator V1) ───
class RNG {
  constructor(seed) {
    this.m = 0x80000000;
    this.a = 1103515245;
    this.c = 12345;
    this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
  }
  nextInt() { this.state = (this.a * this.state + this.c) % this.m; return this.state; }
  nextFloat() { return this.nextInt() / (this.m - 1); }
  nextRange(min, max) { return min + this.nextFloat() * (max - min); }
}

// Shared invisible hitbox material
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

export class Iceberg {
  constructor(config, index, scene, interactiveObjects, masterCfg) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.masterCfg = masterCfg || {};

    // Root group
    this.group = new THREE.Group();
    this.group.position.set(config.x || 0, config.y || 0, config.z || 0);
    this.scene.add(this.group);

    // Geometry is loaded separately
    this.solidMesh = null;
    this.wireMesh = null;
    this.ledLines = null;
    this.floodLight = null;
    this.floodTarget = null;
    
    // Status flag
    this.isGeometryLoaded = false;

    // Fast-init features (hitbox, floodlight)
    this.buildFast();
  }

  buildFast() {
    const cfg = this.config;
    const masterCfg = this.masterCfg;
    const r = cfg.radius || 4;
    const h = cfg.height || 6;
    const peakHeight = h; // Approx peak height

    // Interactive hitbox sized to iceberg
    if (!this.hitbox) {
      const hitboxGeo = new THREE.BoxGeometry(r * 2.5, h * 1.5, r * 2.5);
      this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
      this.hitbox.userData = { isIceberg: true, fixture: this };
      this.scene.add(this.hitbox);
      this.interactiveObjects.push(this.hitbox);
    }
    this.hitbox.position.set(cfg.x || 0, h / 2, cfg.z || 0);

    // Instantiate Floodlight immediately at estimated peak height
    if (!this.floodLight) {
      this.floodLight = new THREE.SpotLight(0xffffff, 1, 1, Math.PI / 4, 0.5, 1.5);
      this.floodLight.castShadow = false;
      this.group.add(this.floodLight);

      this.floodTarget = new THREE.Object3D();
      this.group.add(this.floodTarget);
      this.floodLight.target = this.floodTarget;
    }
    
    // Position at top center temporarily until geometry loads
    const towerHeight = peakHeight + 5;
    const offsetX = cfg.towerOffsetX || 0;
    const offsetY = cfg.towerOffsetY || 0;
    const offsetZ = cfg.towerOffsetZ || 0;
    const tx = offsetX;
    const tz = offsetZ;
    const baseHeight = towerHeight + offsetY;

    this.floodLight.position.set(tx, baseHeight, tz);
    // Target the center of the world (0, 10, 0) where the Titanic is
    this.floodTarget.position.set(-(cfg.x || 0), 10 - (cfg.y || 0), -(cfg.z || 0));

    // ─── Physical tower fixtures (pole, bracket, housing, glow) ───
    if (this.fixtureGroup) {
      this.group.remove(this.fixtureGroup);
      this.fixtureGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.fixtureGroup = new THREE.Group();

    // Tower pole
    const poleGeo = new THREE.CylinderGeometry(0.3, 0.4, baseHeight, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, metalness: 0.3 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(tx, baseHeight / 2, tz);
    pole.castShadow = true;
    this.fixtureGroup.add(pole);

    // Structural bracket
    const bracketGeo = new THREE.BoxGeometry(1.6, 0.4, 0.6);
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9, metalness: 0.8 });
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.set(tx, baseHeight - 0.7, tz);
    bracket.castShadow = true;
    this.fixtureGroup.add(bracket);

    // White LED pixel
    const pixelGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const pixelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pixel = new THREE.Mesh(pixelGeo, pixelMat);
    pixel.position.set(tx, baseHeight - 0.7, tz);
    pixel.translateZ(0.4);
    this.fixtureGroup.add(pixel);

    // Flood light housing (rectangular box)
    const housingGeo = new THREE.BoxGeometry(2, 1, 1.5);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 });
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(tx, baseHeight, tz);
    this.fixtureGroup.add(housing);

    // Glow orb at the flood source
    const finalColor = cfg.floodColor || masterCfg.masterFloodColor || '#ffffff';
    const glowGeo = new THREE.SphereGeometry(1.0, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: finalColor,
      transparent: true,
      opacity: 0.9,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(tx, baseHeight - 0.5, tz);
    this.fixtureGroup.add(glow);

    this.group.add(this.fixtureGroup);
    
    this.updateFloodlightProps();
  }

  updateFloodlightProps() {
    if (!this.floodLight) return;
    const cfg = this.config;
    const master = this.masterCfg;
    
    // Master is an AND override — if master is OFF, all floods are OFF
    const masterEnabled = master.masterFloodEnabled !== false;
    const localEnabled = cfg.floodEnabled !== false;
    const enabled = masterEnabled && localEnabled;
    
    const color = cfg.floodColor || master.masterFloodColor || '#ffffff';
    // Master intensity and angle always take priority over local
    const baseIntensity = master.masterFloodIntensity !== undefined ? master.masterFloodIntensity : (cfg.floodIntensity || 50);
    const angleDeg = master.masterFloodAngle !== undefined ? master.masterFloodAngle : (cfg.floodAngle || 40);
    
    // Apply master dimmer (0-250%) as a multiplier
    const dimmer = (master.masterFloodDimmer !== undefined ? master.masterFloodDimmer : 100) / 100;
    const intensity = baseIntensity * dimmer;

    this.floodLight.visible = enabled && dimmer > 0;
    this.floodLight.color.set(color);
    this.floodLight.intensity = intensity;
    this.floodLight.angle = THREE.MathUtils.degToRad(angleDeg);
    this.floodLight.distance = (cfg.radius || 4) * 25;
  }

  async buildGeometry(progressCallback) {
    if (this.isGeometryLoaded) return;
    
    const cfg = this.config;
    const rng = new RNG(cfg.seed || 42231);
    const radius = cfg.radius || 4;
    const height = cfg.height || 6;
    const detail = cfg.detail || 10;
    const peakCount = cfg.peakCount || 3;
    const seed = cfg.seed || 12345;
    
    const filename = `iceberg_${seed}_r${radius}_h${height}_d${detail}_p${peakCount}.stl`;
    const stlUrl = `assets/${filename}`;
    
    let geo = null;
    let triangles = [];
    let vertices3D = [];
    
    // Attempt to load from cache
    try {
      const res = await fetch(stlUrl, { method: 'HEAD' });
      if (res.ok) {
        const loader = new STLLoader();
        geo = await loader.loadAsync(stlUrl);
        geo = BufferGeometryUtils.mergeVertices(geo);
        geo.computeVertexNormals();
        
        // Recover top-surface triangles for LED string art
        const posAttr = geo.getAttribute('position');
        const indexAttr = geo.getIndex();
        
        for (let i = 0; i < posAttr.count; i++) {
          vertices3D.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
        }
        
        for (let i = 0; i < indexAttr.count; i += 3) {
          const a = indexAttr.getX(i);
          const b = indexAttr.getX(i+1);
          const c = indexAttr.getX(i+2);
          
          const vA = vertices3D[a];
          const vB = vertices3D[b];
          const vC = vertices3D[c];
          
          const cb = new THREE.Vector3().subVectors(vC, vB);
          const ab = new THREE.Vector3().subVectors(vA, vB);
          const normal = cb.cross(ab).normalize();
          
          if (normal.y > 0.01) triangles.push(a, b, c);
        }
      }
    } catch (e) {
      // Missing cache file, ignore
    }

    if (!geo) {
      // Yield to UI
      await new Promise(r => setTimeout(r, 6));

      // ─── 1. Generate grid points (V1-style) ───
      const step = (radius * 2) / detail;
      const limit = radius * 1.1;
      const gridMap = new Map(); // "gx,gz" → index
      const rawPoints = [];      // [x, z] pairs
      const gridCoords = [];     // grid coordinates for connectivity

      for (let gx = 0, ix = -limit; ix <= limit; ix += step, gx++) {
      for (let gz = 0, iz = -limit; iz <= limit; iz += step, gz++) {
        const jx = ix + rng.nextRange(-step * 0.35, step * 0.35);
        const jz = iz + rng.nextRange(-step * 0.35, step * 0.35);
        if (jx * jx + jz * jz < radius * radius * 1.05) {
          const idx = rawPoints.length;
          rawPoints.push([jx, jz]);
          gridMap.set(`${gx},${gz}`, idx);
          gridCoords.push([gx, gz]);
        }
      }
    }

    if (rawPoints.length < 3) return Promise.resolve();

    // ─── 2. Peaks for height field (V1-style) ───
    const peaks = [];
    // Main central peak
    peaks.push({
      x: rng.nextRange(-radius * 0.15, radius * 0.15),
      z: rng.nextRange(-radius * 0.15, radius * 0.15),
      h: height,
      w: rng.nextRange(radius * 0.4, radius * 0.7),
    });
    for (let i = 0; i < peakCount; i++) {
      peaks.push({
        x: rng.nextRange(-radius * 0.8, radius * 0.8),
        z: rng.nextRange(-radius * 0.8, radius * 0.8),
        h: rng.nextRange(height * 0.2, height * 0.8),
        w: rng.nextRange(radius * 0.25, radius * 0.55),
      });
    }

    // 3D vertices with height
    vertices3D = rawPoints.map(([px, pz]) => {
      let h = 0;
      for (const p of peaks) {
        const d = Math.sqrt((px - p.x) ** 2 + (pz - p.z) ** 2);
        const falloff = Math.max(0, 1 - d / p.w);
        const val = p.h * Math.pow(falloff, 1.5);
        if (val > h) h = val;
      }
      // Boundary falloff
      const dCenter = Math.sqrt(px * px + pz * pz);
      h *= Math.max(0, 1 - Math.pow(dCenter / radius, 2.5));
      return new THREE.Vector3(px, h, pz);
    });

    // Yield to allow UI Progress paint
    await new Promise(r => setTimeout(r, 6));

    // ─── 3. Triangulate via grid connectivity ───
    // Connect adjacent grid points into triangle pairs
    const allGridKeys = [...gridMap.keys()];

    for (const key of allGridKeys) {
      const [gx, gz] = key.split(',').map(Number);
      const i00 = gridMap.get(`${gx},${gz}`);
      const i10 = gridMap.get(`${gx + 1},${gz}`);
      const i01 = gridMap.get(`${gx},${gz + 1}`);
      const i11 = gridMap.get(`${gx + 1},${gz + 1}`);

      // Only create triangles if all neighbors exist
      if (i00 !== undefined && i10 !== undefined && i01 !== undefined) {
        triangles.push(i00, i10, i01);
      }
      if (i10 !== undefined && i11 !== undefined && i01 !== undefined) {
        triangles.push(i10, i11, i01);
      }
    }

    if (triangles.length < 3) return Promise.resolve();

    // Yield thread to UI
    if (progressCallback) progressCallback();
    await new Promise(r => setTimeout(r, 6));

    // ─── 4. Build solid mesh (V1-style: top + walls + bottom) ───
    const positions = [];
    const baseDepth = radius * 0.15; // Shallow base

    // Top surface (face UP) — swap winding for correct normals
    for (let i = 0; i < triangles.length; i += 3) {
      const v0 = vertices3D[triangles[i]];
      const v1 = vertices3D[triangles[i + 1]];
      const v2 = vertices3D[triangles[i + 2]];
      if (!v0 || !v1 || !v2) continue;
      positions.push(
        v0.x, v0.y, v0.z,
        v2.x, v2.y, v2.z,
        v1.x, v1.y, v1.z,
      );
    }

    // Find boundary edges (edges shared by only 1 triangle)
    const edgeCounts = {};
    const visualTriangles = []; // store in visual winding order
    for (let i = 0; i < triangles.length; i += 3) {
      const t = [triangles[i], triangles[i + 2], triangles[i + 1]]; // visual order
      visualTriangles.push(t);
      for (let j = 0; j < 3; j++) {
        const u = t[j], v = t[(j + 1) % 3];
        const key = Math.min(u, v) + '|' + Math.max(u, v);
        edgeCounts[key] = (edgeCounts[key] || 0) + 1;
      }
    }

    // Walls + bottom cap
    const floorY = -baseDepth;
    for (const vt of visualTriangles) {
      for (let j = 0; j < 3; j++) {
        const u = vt[j], v = vt[(j + 1) % 3];
        const key = Math.min(u, v) + '|' + Math.max(u, v);
        if (edgeCounts[key] === 1) {
          const vU = vertices3D[u], vV = vertices3D[v];
          // Wall quad (2 triangles)
          positions.push(
            vU.x, vU.y, vU.z, vV.x, vV.y, vV.z, vV.x, floorY, vV.z,
            vU.x, vU.y, vU.z, vV.x, floorY, vV.z, vU.x, floorY, vU.z,
          );
          // Bottom cap triangle (fan to center)
          positions.push(vV.x, floorY, vV.z, vU.x, floorY, vU.z, 0, floorY, 0);
        }
      }
    }

    // Build geometry
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    } // End of !geo

    // Solid mesh
    const showFaces = cfg.showFaces !== false;
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xddeeff,
      roughness: 0.45,
      metalness: 0.08,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.solidMesh = new THREE.Mesh(geo, iceMat);
    this.solidMesh.castShadow = true;
    this.solidMesh.receiveShadow = true;
    this.solidMesh.visible = showFaces && (this.masterCfg.icebergsEnabled !== false);
    this.group.add(this.solidMesh);

    // Wireframe mesh (illuminated edges)
    const showWire = cfg.showWireframe !== false;
    const wireGeo = new THREE.WireframeGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: cfg.wireColor || '#88ddff',
      transparent: true,
      opacity: showWire ? 0.7 : 0,
    });
    this.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.wireMesh.visible = showWire && (this.masterCfg.icebergsEnabled !== false);
    this.group.add(this.wireMesh);

    // ─── 5. LED string art on top-surface faces ───
    const ledColor = new THREE.Color(cfg.ledColor || '#aaeeff');
    const ledDensity = cfg.ledDensity || 5;
    const pattern = cfg.ledPattern || 'spiral';
    const linePoints = [];
    let ledEdgeSet = null;

    for (let i = 0; i < triangles.length; i += 3) {
      const vA = vertices3D[triangles[i]];
      const vB = vertices3D[triangles[i + 1]];
      const vC = vertices3D[triangles[i + 2]];
      if (!vA || !vB || !vC) continue;

      if (pattern === 'edges') {
        // Just trace triangle edges (deduplicated via set)
        const edgeKey = (a, b) => Math.min(a, b) + ',' + Math.max(a, b);
        const k1 = edgeKey(triangles[i], triangles[i+1]);
        const k2 = edgeKey(triangles[i+1], triangles[i+2]);
        const k3 = edgeKey(triangles[i+2], triangles[i]);
        if (!ledEdgeSet) ledEdgeSet = new Set();
        if (!ledEdgeSet.has(k1)) { linePoints.push(vA.clone(), vB.clone()); ledEdgeSet.add(k1); }
        if (!ledEdgeSet.has(k2)) { linePoints.push(vB.clone(), vC.clone()); ledEdgeSet.add(k2); }
        if (!ledEdgeSet.has(k3)) { linePoints.push(vC.clone(), vA.clone()); ledEdgeSet.add(k3); }
      } else if (pattern === 'spiral') {
        let p1 = vA.clone(), p2 = vB.clone(), p3 = vC.clone();
        const decay = 0.15;
        const pts = [p1.clone(), p2.clone(), p3.clone()];
        for (let l = 0; l < ledDensity; l++) {
          const n1 = new THREE.Vector3().lerpVectors(p1, p2, decay);
          const n2 = new THREE.Vector3().lerpVectors(p2, p3, decay);
          const n3 = new THREE.Vector3().lerpVectors(p3, p1, decay);
          pts.push(n1.clone(), n2.clone(), n3.clone());
          p1 = n1; p2 = n2; p3 = n3;
        }
        for (let k = 0; k < pts.length - 1; k++) {
          linePoints.push(pts[k], pts[k + 1]);
        }
      } else {
        for (let s = 0; s <= ledDensity; s++) {
          const t = s / ledDensity;
          const p1 = new THREE.Vector3().lerpVectors(vA, vB, t);
          const p2 = new THREE.Vector3().lerpVectors(vB, vC, t);
          linePoints.push(p1, p2);
          const p3 = new THREE.Vector3().lerpVectors(vC, vA, t);
          linePoints.push(p2.clone(), p3);
        }
      }
    }

    if (linePoints.length >= 2) {
      const ledGeo = new THREE.BufferGeometry();
      const posArr = new Float32Array(linePoints.length * 3);
      for (let i = 0; i < linePoints.length; i++) {
        posArr[i * 3] = linePoints[i].x;
        posArr[i * 3 + 1] = linePoints[i].y;
        posArr[i * 3 + 2] = linePoints[i].z;
      }
      ledGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

      const ledMat = new THREE.LineBasicMaterial({
        color: ledColor,
        transparent: true,
        opacity: 0.9,
      });
      this.ledLines = new THREE.LineSegments(ledGeo, ledMat);
      this.ledLines.visible = this.masterCfg.icebergsEnabled !== false;
      this.group.add(this.ledLines);
    }
    
    // Reposition the floodlight using exact peak now that we have vertices
    if (this.floodLight) {
        let maxH = 0;
        const peakPos = new THREE.Vector3(0, 0, 0);
        for (const v of vertices3D) {
          if (v.y > maxH) { maxH = v.y; peakPos.copy(v); }
        }
        this.floodLight.position.copy(peakPos).add(new THREE.Vector3(0, 0.5, 0));
        // Keep targeting the ship at (0, 10, 0)
        this.floodTarget.position.set(-(cfg.x || 0), 10 - (cfg.y || 0), -(cfg.z || 0));
    }

    this.isGeometryLoaded = true;
  }

  // ─── Config sync ───
  writeTransformToConfig() {
    this.config.x = this.hitbox.position.x;
    this.config.z = this.hitbox.position.z;
    this.config.y = this.hitbox.position.y - (this.config.height || 6) / 2;
    this.group.position.set(this.config.x, this.config.y || 0, this.config.z);
  }

  syncFromConfig() {
    this.group.position.set(this.config.x || 0, this.config.y || 0, this.config.z || 0);
    // Refresh properties on next load or update floodlight instantly if geom is loaded
    this.updateFloodlightProps();
    if (this.isGeometryLoaded) {
      // Rebuild geometry if parameters changed
      if (this.solidMesh) {
          this.group.remove(this.solidMesh);
          this.solidMesh.geometry.dispose();
          this.solidMesh.material.dispose();
      }
      if (this.wireMesh) {
          this.group.remove(this.wireMesh);
          this.wireMesh.geometry.dispose();
          this.wireMesh.material.dispose();
      }
      if (this.ledLines) {
          this.group.remove(this.ledLines);
          this.ledLines.geometry.dispose();
          this.ledLines.material.dispose();
      }
      this.isGeometryLoaded = false;
      this.buildGeometry();
    }
  }

  destroy() {
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
    this.scene.remove(this.group);
    this.scene.remove(this.hitbox);
    const idx = this.interactiveObjects.indexOf(this.hitbox);
    if (idx > -1) this.interactiveObjects.splice(idx, 1);
  }

  setSelected(selected) {
    // Future: highlight on select
  }

  setVisibility(visible) {
    // Visibility toggle effects meshes, hitboxes BUT NOT floodlights unless master flood override is used
    if (this.solidMesh) this.solidMesh.visible = visible && this.config.showFaces !== false;
    if (this.wireMesh) this.wireMesh.visible = visible && this.config.showWireframe !== false;
    if (this.ledLines) this.ledLines.visible = visible;
    this.hitbox.visible = visible;
  }

  // ─── Live toggle faces/wireframe without full rebuild ───
  updateVisibility() {
    if (this.solidMesh) this.solidMesh.visible = this.config.showFaces !== false && this.masterCfg.icebergsEnabled !== false;
    if (this.wireMesh) this.wireMesh.visible = this.config.showWireframe !== false && this.masterCfg.icebergsEnabled !== false;
  }

  setFixtureVisibility(visible) {
    if (this.fixtureGroup) this.fixtureGroup.visible = visible;
  }

  setColorRGB(r, g, b) {
    if (this.ledLines && this.ledLines.material) {
      this.ledLines.material.color.setRGB(r, g, b);
    }
  }
}

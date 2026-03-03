import * as THREE from 'three';

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
  constructor(config, index, scene, interactiveObjects) {
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;

    // Root group
    this.group = new THREE.Group();
    this.group.position.set(config.x || 0, config.y || 0, config.z || 0);
    this.scene.add(this.group);

    // Interactive hitbox sized to iceberg
    const r = config.radius || 4;
    const h = config.height || 6;
    const hitboxGeo = new THREE.BoxGeometry(r * 2.5, h * 1.5, r * 2.5);
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.position.set(config.x || 0, h / 2, config.z || 0);
    this.hitbox.userData = { isIceberg: true, fixture: this };
    this.scene.add(this.hitbox);
    this.interactiveObjects.push(this.hitbox);

    this.solidMesh = null;
    this.wireMesh = null;
    this.ledLines = null;
    this.floodLight = null;

    this.rebuild();
  }

  rebuild() {
    // ─── Cleanup ───
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
    this.solidMesh = null;
    this.wireMesh = null;
    this.ledLines = null;
    this.floodLight = null;

    const cfg = this.config;
    const rng = new RNG(cfg.seed || 42231);
    const radius = cfg.radius || 4;
    const height = cfg.height || 6;
    const detail = cfg.detail || 10;
    const peakCount = cfg.peakCount || 3;

    // ─── 1. Generate grid points (V1-style) ───
    // Create a regular grid with jitter, only keep points inside circle
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

    if (rawPoints.length < 3) return;

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
    const vertices3D = rawPoints.map(([px, pz]) => {
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

    // ─── 3. Triangulate via grid connectivity ───
    // Connect adjacent grid points into triangle pairs
    const triangles = []; // flat array of indices [i0, i1, i2, ...]
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

    if (triangles.length < 3) return;

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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

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
    this.solidMesh.visible = showFaces;
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
    this.wireMesh.visible = showWire;
    this.group.add(this.wireMesh);

    // ─── 5. LED string art on top-surface faces ───
    const ledColor = new THREE.Color(cfg.ledColor || '#aaeeff');
    const ledDensity = cfg.ledDensity || 5;
    const pattern = cfg.ledPattern || 'spiral';
    const linePoints = [];

    for (let i = 0; i < triangles.length; i += 3) {
      const vA = vertices3D[triangles[i]];
      const vB = vertices3D[triangles[i + 1]];
      const vC = vertices3D[triangles[i + 2]];
      if (!vA || !vB || !vC) continue;

      if (pattern === 'spiral') {
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
      this.group.add(this.ledLines);
    }

    // ─── 6. Flood light at highest peak ───
    if (cfg.floodEnabled !== false) {
      let maxH = 0;
      const peakPos = new THREE.Vector3(0, 0, 0);
      for (const v of vertices3D) {
        if (v.y > maxH) { maxH = v.y; peakPos.copy(v); }
      }

      this.floodLight = new THREE.SpotLight(
        cfg.floodColor || '#ffffff',
        cfg.floodIntensity || 5,
        radius * 15,
        THREE.MathUtils.degToRad(cfg.floodAngle || 40),
        0.5, 1.5
      );
      this.floodLight.position.copy(peakPos).add(new THREE.Vector3(0, 0.5, 0));
      this.floodLight.castShadow = false;
      this.group.add(this.floodLight);

      const target = new THREE.Object3D();
      target.position.set(0, maxH + 10, 0);
      this.group.add(target);
      this.floodLight.target = target;
    }

    // Update hitbox
    this.hitbox.position.set(cfg.x || 0, height / 2, cfg.z || 0);
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
    this.rebuild();
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
    this.group.visible = visible;
    this.hitbox.visible = visible;
  }

  // ─── Live toggle faces/wireframe without full rebuild ───
  updateVisibility() {
    if (this.solidMesh) this.solidMesh.visible = this.config.showFaces !== false;
    if (this.wireMesh) this.wireMesh.visible = this.config.showWireframe !== false;
  }
}

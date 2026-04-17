/**
 * environment.js — Ground plane, star field, model loading, and lighting setup.
 */
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  scene, camera, controls, params, lights,
  modelMeshes, interactiveObjects,
  setModel, setModelCenter, setModelSize, setModelRadius,
  setStructureMaterial, setEditMaterial,
  setGround, setStarField,
} from "./state.js";
import { Iceberg } from "../fixtures/iceberg.js";

let ground, starField;
let model, modelCenter, modelSize, modelRadius;
let structureMaterial, editMaterial;

// ─── Loading UI ─────────────────────────────────────────────────────────
const progressBar = document.getElementById("progress-bar");
const loadingStatus = document.getElementById("loading-status");
const loadingOverlay = document.getElementById("loading-overlay");

export function updateLoading(pct, msg) {
  if (progressBar) progressBar.style.width = pct + "%";
  if (loadingStatus) loadingStatus.textContent = msg;
}

// ─── Ground Plane ───────────────────────────────────────────────────────
export function createGround() {
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xc2b280, // Desert playa dust
    roughness: 0.95,
    metalness: 0.05,
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);
  setGround(ground);
}

// ─── Star Field ─────────────────────────────────────────────────────────
export function createStarField() {
  const starCount = 3000;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.7 + 0.3); // upper hemisphere only
    const r = 1500 + Math.random() * 500;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.5 + Math.random() * 2.0;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  });
  starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);
  setStarField(starField);
}

// ─── Model Loading ──────────────────────────────────────────────────────
export function loadModel(onLoaded) {
  const sceneName = window.__activeScene || 'titanic';
  if (sceneName !== 'titanic') {
    console.log(`[Model] Skipping Titanic model load for scene: ${sceneName}`);
    onLoaded(new THREE.Group(), null, null, null, true);
    return;
  }

  updateLoading(10, "Loading FBX model…");

  const loader = new FBXLoader();
  loader.load(
    "../3d_models/2601_001_BURNING MAN HONORARIA_TE.fbx",
    onLoaded,
    (xhr) => {
      if (xhr.total > 0) {
        const pct = 10 + (xhr.loaded / xhr.total) * 70;
        updateLoading(
          Math.round(pct),
          `Loading model… ${Math.round(xhr.loaded / 1024 / 1024)}MB`,
        );
      }
    },
    (err) => {
      console.error("FBX load error:", err);
      updateLoading(0, "Error loading model — check console");
    },
  );
}

export async function onModelLoaded(obj, setupGUI, rebuildParLights, rebuildDmxFixtures, isDummy = false) {
  updateLoading(70, "Processing geometry…");
  model = obj;
  setModel(model);

  // Apply PBR material
  structureMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4c4a8, // warm sandy/wood tone
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  setStructureMaterial(structureMaterial);

  // Flat bright material for editing
  editMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    wireframe: false,
  });
  setEditMaterial(editMaterial);

  let meshCount = 0;
  if (!isDummy) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.material = structureMaterial;
        child.castShadow = true;
        child.receiveShadow = true;

        // Delete original normals from Rhino (per-face flat) and recompute smooth
        child.geometry.deleteAttribute("normal");
        child.geometry.computeVertexNormals();

        modelMeshes.push(child); // Collect for snap raycasting
        meshCount++;
      }
    });
  }
  console.log(isDummy ? `Loaded dummy model for test bench` : `Loaded ${meshCount} mesh(es) from FBX`);

  modelCenter = new THREE.Vector3();
  modelSize = new THREE.Vector3(100, 100, 100);
  modelRadius = 50;

  if (!isDummy) {
    // Compute overall bounds to find the true center
    const box = new THREE.Box3().setFromObject(model);
    box.getCenter(modelCenter);
    box.getSize(modelSize);
    modelRadius = modelSize.length() / 2;

    // Translate geometry vertices directly so the local origin (0,0,0)
    // becomes the center of mass.
    model.traverse((child) => {
      if (child.isMesh) {
        child.geometry.translate(-modelCenter.x, -box.min.y, -modelCenter.z);
      }
    });
  }

  // Apply requested default model pos/rot
  if (!isDummy) {
    model.position.set(-2, 8, 16);
    model.rotation.set(THREE.MathUtils.degToRad(-90), 0, 0);
  }
  scene.add(model);

  // Recompute bounds after centering and initial transform
  if (!isDummy) {
    const finalBox = new THREE.Box3().setFromObject(model);
    finalBox.getCenter(modelCenter);
    finalBox.getSize(modelSize);
    modelRadius = finalBox.max.distanceTo(finalBox.min) / 2;
  }

  setModelCenter(modelCenter);
  setModelSize(modelSize);
  setModelRadius(modelRadius);

  updateLoading(85, "Setting up lights…");

  // Setup lighting
  setupLighting(rebuildParLights, rebuildDmxFixtures);

  // Setup camera position based on model
  const dist = modelRadius * 2.5;
  camera.position.set(dist * 0.7, modelSize.y * 1.2, dist * 0.7);
  controls.target.copy(modelCenter);
  controls.minDistance = modelRadius * 0.3;
  controls.maxDistance = modelRadius * 8;
  controls.update();

  updateLoading(90, "Loading icebergs…");

  // Instantiating initial icebergs
  window.icebergFixtures = [];
  const totalBergs = params.icebergs.length;
  
  for (let index = 0; index < totalBergs; index++) {
    const config = params.icebergs[index];
    const fixture = new Iceberg(config, index, scene, interactiveObjects, params);
    fixture.setVisibility(params.icebergsEnabled !== false);
    window.icebergFixtures.push(fixture);
    updateLoading(90 + Math.floor((index / totalBergs) * 10), `Loading iceberg markers… (${index + 1}/${totalBergs})`);
  }
  
  // Sort fixtures back into configuration order
  window.icebergFixtures.sort((a, b) => a.index - b.index);

  // Setup GUI
  setupGUI();

  updateLoading(100, "Ready");
  setTimeout(() => loadingOverlay.classList.add("hidden"), 400);
}

// ─── Lighting Setup ─────────────────────────────────────────────────────
export function setupLighting(rebuildParLights, rebuildDmxFixtures) {
  const h = modelSize.y;
  const r = modelRadius;

  // 1. Moonlight (DirectionalLight)
  const moon = new THREE.DirectionalLight(0x8899cc, 0.5);
  moon.position.set(r * 1.5, h * 4, r * 0.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(4096, 4096);
  moon.shadow.camera.left = -r * 1.5;
  moon.shadow.camera.right = r * 1.5;
  moon.shadow.camera.top = r * 1.5;
  moon.shadow.camera.bottom = -r * 1.5;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = h * 8;
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.02;
  scene.add(moon);
  scene.add(moon.target);
  moon.target.position.copy(modelCenter);
  lights.moon = moon;

  // 2. Hemisphere ambient
  const hemi = new THREE.HemisphereLight(0x223344, 0x887755, 0.3);
  scene.add(hemi);
  lights.ambient = hemi;

  // 3. Par Lights (ground-level uplights)
  rebuildParLights();
  if (typeof rebuildDmxFixtures === 'function') rebuildDmxFixtures();
}

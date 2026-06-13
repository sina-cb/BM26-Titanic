/**
 * flood_lights.js — master flood wash for the ship (work lights).
 *
 * Restored 2026-06-13 by operator request ("bring back the floods"):
 * the master-flood controls retired with the icebergs drove per-berg
 * ground uplights; the same rig now washes the SHIP. Four pole-mounted
 * floods sit around the model aiming at the structure, driven by the
 * masterFlood* params (Atmosphere → Master Floods in common.yaml,
 * rendered by the generic GUI builder):
 *
 *   masterFloodEnabled   master ON/OFF for all four
 *   masterFloodColor     wash color
 *   masterFloodIntensity 0–500 base intensity
 *   masterFloodAngle     10–90° beam angle
 *   masterFloodDistance  0.5–4× ship radius — how far out the poles sit
 *   masterFloodDimmer    0–250% multiplier on intensity
 *
 * The rig is built on the first update call and the fixture hardware
 * (poles + housings) stays in the scene PERMANENTLY — disabling only
 * turns the light off, the fixtures never come and go (operator
 * request, 2026-06-13). Corner positions re-derive from the live
 * model bounds on every update — onModelLoaded() calls update again
 * so the corners snap to the real ship once it is in the scene.
 *
 * IMPORTANT: once the rig exists, lights are turned off by driving
 * intensity to 0 — NEVER by toggling light.visible or removing them.
 * Changing the set of visible lights forces a WebGPU pipeline
 * recompile (multi-second hang); intensity changes are free. Building
 * at boot folds the one compile the lights cost into startup.
 */
import * as THREE from "three";
import { scene, params, modelCenter, modelSize, modelRadius } from "./state.js";

const FLOOD_COUNT = 4;
const POLE_HEIGHT = 6; // m — pole-mounted heads, tall enough to rake the hull

let rig = null; // { lights: SpotLight[], visuals: Group, target: Object3D }

function cornerPositions() {
  const mult = params.masterFloodDistance !== undefined ? params.masterFloodDistance : 1.4;
  const r = Math.max(modelRadius || 40, 10) * mult;
  const cx = modelCenter ? modelCenter.x : 0;
  const cz = modelCenter ? modelCenter.z : 0;
  return [
    [cx + r, cz + r],
    [cx + r, cz - r],
    [cx - r, cz + r],
    [cx - r, cz - r],
  ];
}

function buildRig() {
  rig = { lights: [], visuals: new THREE.Group(), target: new THREE.Object3D() };
  rig.visuals.name = "masterFloods";
  scene.add(rig.visuals);
  scene.add(rig.target);

  for (let i = 0; i < FLOOD_COUNT; i++) {
    const light = new THREE.SpotLight("#ffffff", 0, 0, Math.PI / 4, 0.4, 1.2);
    light.target = rig.target;
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 1;
    light.shadow.bias = -0.0005;
    rig.visuals.add(light);
    rig.lights.push(light);

    // Playa-style fixture body — a pole with the housing + glow orb
    // head the berg floods had, so the rig reads as real hardware.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, POLE_HEIGHT, 8),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 }),
    );
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 }),
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 8, 8),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9 }),
    );
    glow.position.y = 0.6;
    housing.add(glow);
    rig.visuals.add(pole);
    rig.visuals.add(housing);
    light.userData.pole = pole;
    light.userData.housing = housing;
    light.userData.glow = glow;
  }
}

export function updateFloodLights() {
  if (!scene) return;
  const enabled = params.masterFloodEnabled === true;
  if (!rig) buildRig();

  const color = params.masterFloodColor || "#ffffff";
  const base = params.masterFloodIntensity !== undefined ? params.masterFloodIntensity : 150;
  const angleDeg = params.masterFloodAngle !== undefined ? params.masterFloodAngle : 50;
  const dimmer = (params.masterFloodDimmer !== undefined ? params.masterFloodDimmer : 100) / 100;
  const intensity = enabled ? base * dimmer : 0; // off = intensity 0, never visible toggles

  const cx = modelCenter ? modelCenter.x : 0;
  const cy = modelCenter ? modelCenter.y : 0;
  const cz = modelCenter ? modelCenter.z : 0;
  const midHeight = cy + (modelSize ? modelSize.y * 0.35 : 8);
  rig.target.position.set(cx, midHeight, cz);
  const mult = params.masterFloodDistance !== undefined ? params.masterFloodDistance : 1.4;
  const reach = Math.max(modelRadius || 40, 10) * (mult + 2);

  cornerPositions().forEach(([x, z], i) => {
    const light = rig.lights[i];
    light.position.set(x, POLE_HEIGHT, z);
    light.color.set(color);
    light.intensity = intensity;
    light.angle = THREE.MathUtils.degToRad(angleDeg);
    light.distance = reach;
    light.shadow.camera.far = reach;

    const pole = light.userData.pole;
    pole.position.set(x, POLE_HEIGHT / 2, z);
    const housing = light.userData.housing;
    housing.position.set(x, POLE_HEIGHT, z);
    housing.lookAt(cx, midHeight, cz);
    light.userData.glow.material.color.set(color);
    light.userData.glow.material.opacity = intensity > 0 ? 0.9 : 0.15;
  });
}

// onModelLoaded() re-fires the update so corner positions snap to the
// real model bounds (the GUI handlers may run before the model lands).
if (typeof window !== "undefined") window.updateFloodLights = updateFloodLights;

/**
 * flood_lights.js — master flood wash for the ship (work lights).
 *
 * Restored 2026-06-13 by operator request ("bring back the floods"):
 * the master-flood controls retired with the icebergs drove per-berg
 * ground uplights; the same rig now washes the SHIP. Four ground-
 * mounted floods sit at the model's corners aiming at the structure,
 * driven by the masterFlood* params (scene yaml `floods:` section,
 * rendered by the generic GUI builder). Old semantics preserved:
 *
 *   masterFloodEnabled   master ON/OFF for all four
 *   masterFloodColor     wash color
 *   masterFloodIntensity 0–500 base intensity
 *   masterFloodAngle     10–90° beam angle
 *   masterFloodDimmer    0–250% multiplier on intensity
 *
 * The rig is created lazily on the first update with floods enabled
 * (a disabled feature never adds scene objects) and re-derives its
 * corner positions from the live model bounds on every update —
 * onModelLoaded() calls update again so the corners snap to the real
 * ship once it is in the scene.
 */
import * as THREE from "three";
import { scene, params, modelCenter, modelSize, modelRadius } from "./state.js";

const FLOOD_COUNT = 4;

let rig = null; // { lights: SpotLight[], visuals: Group, target: Object3D }

function cornerPositions() {
  const r = Math.max(modelRadius || 40, 10) * 0.85;
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
    rig.visuals.add(light);
    rig.lights.push(light);

    // Playa-style fixture body — the same housing + glow orb look the
    // berg floods had, so the rig reads as real hardware in the sim.
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
    rig.visuals.add(housing);
    light.userData.housing = housing;
    light.userData.glow = glow;
  }
}

export function updateFloodLights() {
  if (!scene) return;
  const enabled = params.masterFloodEnabled === true;
  if (!rig) {
    if (!enabled) return; // lazy: an off feature adds nothing to the scene
    buildRig();
  }

  const color = params.masterFloodColor || "#ffffff";
  const base = params.masterFloodIntensity !== undefined ? params.masterFloodIntensity : 150;
  const angleDeg = params.masterFloodAngle !== undefined ? params.masterFloodAngle : 50;
  const dimmer = (params.masterFloodDimmer !== undefined ? params.masterFloodDimmer : 100) / 100;
  const intensity = base * dimmer;
  const on = enabled && dimmer > 0;

  const cx = modelCenter ? modelCenter.x : 0;
  const cy = modelCenter ? modelCenter.y : 0;
  const cz = modelCenter ? modelCenter.z : 0;
  const midHeight = cy + (modelSize ? modelSize.y * 0.35 : 8);
  rig.target.position.set(cx, midHeight, cz);
  const reach = Math.max(modelRadius || 40, 10) * 3;

  cornerPositions().forEach(([x, z], i) => {
    const light = rig.lights[i];
    light.position.set(x, 1, z);
    light.visible = on;
    light.color.set(color);
    light.intensity = intensity;
    light.angle = THREE.MathUtils.degToRad(angleDeg);
    light.distance = reach;

    const housing = light.userData.housing;
    housing.position.set(x, 0.5, z);
    housing.lookAt(cx, 0.5, cz);
    housing.visible = enabled;
    light.userData.glow.material.color.set(color);
    light.userData.glow.visible = on;
  });
}

// onModelLoaded() re-fires the update so corner positions snap to the
// real model bounds (the GUI handlers may run before the model lands).
if (typeof window !== "undefined") window.updateFloodLights = updateFloodLights;

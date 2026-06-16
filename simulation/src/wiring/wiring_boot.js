/**
 * wiring_boot.js — opt-in loader for the 3D wiring layer.
 *
 * Gated behind the URL param `?wiring=1` so default sim boots are unchanged.
 * When requested, loads `scenes/<scene>/wiring.yaml`, validates it through the
 * wiring data core, builds the THREE layer, and adds it to the scene. Fails
 * loudly (codex P0) if requested but missing/invalid.
 */
import { parseWiring } from './wiring_model.js';
import { buildWiringGroup } from './wiring_render.js';
import { createWiringPanel } from './wiring_ui.js';
import { wiringVisibleSummary } from './wiring_layers.js';

export async function initWiringLayer(scene) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('wiring') !== '1') return;

  const sceneName = window.__activeScene || 'titanic';
  const url = `scenes/${sceneName}/wiring.yaml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[wiring] ?wiring=1 requested but ${url} could not be loaded (HTTP ${res.status})`);
  }
  const model = parseWiring(await res.text());
  const group = buildWiringGroup(model);
  scene.add(group);

  const controller = createWiringPanel(model, group);
  window.__wiringGroup = group;
  window.__wiringLayers = controller;
  window.__wiringSummary = () => wiringVisibleSummary(group);
  console.log(`[wiring] layer added — ${model.routes.length} routes, `
    + `${model.components.size} components, ${model.anchors.size} anchors`);
}

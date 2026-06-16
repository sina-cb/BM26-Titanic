/**
 * wiring_section.js — "🔌 Wiring" section in Lighting Controls.
 *
 * A first-class authoring menu (like DMX Fixtures / LED Lights) for the wiring
 * model (docs/36_wiring_tracer.md): show/hide layers, add components
 * (server/computer/switch/outlet/generator/adapter/injector), add routes (wires)
 * between endpoints, edit positions, and save to scenes/<scene>/wiring.yaml.
 *
 * The editable source of truth is a plain `doc` object; every change re-validates
 * through the wiring data core (wiring_model.js) and re-renders the 3D layer
 * (wiring_render.js). Validation errors surface loudly in a status line — the
 * render keeps the last valid state rather than crashing the sim.
 */
import yaml from 'js-yaml';

import { controls } from '../core/state.js';
import { buildWiringModel } from '../wiring/wiring_model.js';
import { buildWiringGroup } from '../wiring/wiring_render.js';
import { applyWiringVisibility, buildDefaultLayerState, wiringVisibleSummary } from '../wiring/wiring_layers.js';

const COMPONENT_TYPES = ['server', 'computer', 'switch', 'outlet', 'generator', 'adapter', 'injector'];
const FAMILY_LABELS = { power: 'Power', ethernet: 'Ethernet', dmx: 'DMX' };

function seedDoc() {
  return {
    wiring: {
      version: 2,
      defaults: { cableGap: 0.04, slack: 0.15 },
      cableTypes: {
        power:    { family: 'power',    connector: 'edison', stockLengths: [25, 50, 100], color: '#ffae42', radius: 0.03, weatherproof: false },
        ethernet: { family: 'ethernet', connector: 'rj45',   stockLengths: [10, 25, 50, 100], color: '#33c1ff', radius: 0.03, weatherproof: false },
        dmx:      { family: 'dmx',      connector: 'xlr5',   stockLengths: [25, 50, 100], color: '#b48cff', radius: 0.028, weatherproof: false },
      },
      components: [],
      anchors: [],
      routes: [],
    },
  };
}

async function loadOrSeed(sceneName) {
  const res = await fetch(`scenes/${sceneName}/wiring.yaml`).catch(() => null);
  let doc = null;
  if (res && res.ok) {
    const d = yaml.load(await res.text());
    if (d && d.wiring) doc = d;
  }
  if (!doc) doc = seedDoc(); // legitimate "no wiring yet" case
  // Normalize: always make the standard cable catalog (power/ethernet/dmx)
  // available for new routes, on top of any scene-specific types.
  const seed = seedDoc().wiring;
  doc.wiring.cableTypes = { ...seed.cableTypes, ...(doc.wiring.cableTypes || {}) };
  doc.wiring.defaults = { ...seed.defaults, ...(doc.wiring.defaults || {}) };
  doc.wiring.components = doc.wiring.components || [];
  doc.wiring.anchors = doc.wiring.anchors || [];
  doc.wiring.routes = doc.wiring.routes || [];
  return doc;
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose());
  });
}

function clearFolder(f) {
  [...f.controllers].forEach((c) => c.destroy());
  [...f.folders].forEach((sf) => sf.destroy());
}

function uniqueId(base, taken) {
  let i = 1;
  let id = `${base}_${i}`;
  while (taken.has(id)) { i++; id = `${base}_${i}`; }
  return id;
}

export async function buildWiringSection(gui, scene) {
  const sceneName = window.__activeScene || 'titanic';
  const w = { doc: await loadOrSeed(sceneName), group: null, layer: null, show: false };

  const folder = gui.addFolder('🔌 Wiring');
  folder.close();

  const status = document.createElement('div');
  status.style.cssText = 'padding:4px 8px;font-size:10px;color:var(--muted,#8a93a6);';
  const setStatus = (msg, err = false) => { status.textContent = msg; status.style.color = err ? 'var(--err,#ff6b6b)' : 'var(--muted,#8a93a6)'; };

  // ── Layer render + validation ──────────────────────────────────────────────
  function rebuildLayer() {
    let model;
    try {
      model = buildWiringModel(w.doc);
    } catch (e) {
      window.__wiringError = e.message;
      setStatus(`Invalid: ${e.message.replace('[wiring] ', '')}`, true);
      return;
    }
    // Build the new group BEFORE removing the old, so a render error leaves the
    // previous (valid) layer intact rather than wiping it.
    let group;
    try {
      group = buildWiringGroup(model);
    } catch (e) {
      window.__wiringError = e.message + '\n' + (e.stack || '');
      setStatus(`Render error: ${e.message.replace('[wiring] ', '')}`, true);
      return;
    }
    window.__wiringError = null;
    if (w.group) { scene.remove(w.group); disposeGroup(w.group); w.group = null; }
    if (!w.layer) w.layer = buildDefaultLayerState(model);
    else {
      // keep existing toggles; add any new families/routes as visible.
      for (const ct of model.cableTypes.values()) if (!(ct.family in w.layer.families)) w.layer.families[ct.family] = true;
      for (const r of model.routes) if (!(r.id in w.layer.routes)) w.layer.routes[r.id] = true;
    }
    group.visible = w.show;
    scene.add(group);
    applyWiringVisibility(group, w.layer);
    w.group = group;
    window.__wiringGroup = group;
    window.__wiringSummary = () => wiringVisibleSummary(group);
    setStatus(`${model.components.size} components · ${model.routes.length} routes`);
  }

  // ── Master toggle ───────────────────────────────────────────────────────────
  function setShow(v) {
    w.show = v;
    if (v && !w.group) rebuildLayer();
    if (w.group) { w.group.visible = v; applyWiringVisibility(w.group, w.layer); }
  }
  const master = { show: w.show };
  folder.add(master, 'show').name('Show Wiring').onChange(setShow);

  // ── Layers subfolder (labels / markers / families / routes) ─────────────────
  const layersFolder = folder.addFolder('Layers');
  function refreshLayers() {
    clearFolder(layersFolder);
    if (!w.layer) return;
    layersFolder.add(w.layer, 'labels').name('Labels').onChange(() => w.group && applyWiringVisibility(w.group, w.layer));
    layersFolder.add(w.layer, 'markers').name('Components & anchors').onChange(() => w.group && applyWiringVisibility(w.group, w.layer));
    for (const fam of Object.keys(w.layer.families)) {
      layersFolder.add(w.layer.families, fam).name(FAMILY_LABELS[fam] || fam)
        .onChange(() => w.group && applyWiringVisibility(w.group, w.layer));
    }
    for (const r of w.doc.wiring.routes) {
      if (!(r.id in w.layer.routes)) w.layer.routes[r.id] = true;
      layersFolder.add(w.layer.routes, r.id).name(r.name || r.id)
        .onChange(() => w.group && applyWiringVisibility(w.group, w.layer));
    }
  }

  // ── Endpoint option helpers ─────────────────────────────────────────────────
  function endpointOptions() {
    const opts = ['—'];
    const map = { '—': null };
    for (const c of w.doc.wiring.components) { const k = `▣ ${c.name || c.id}`; opts.push(k); map[k] = { component: c.id, port: 'main' }; }
    for (const a of w.doc.wiring.anchors) { const k = `• ${a.id}`; opts.push(k); map[k] = { anchor: a.id }; }
    const groups = new Set();
    (window.parFixtures || []).forEach((f) => { if (f && f.config && f.config.group) groups.add(f.config.group); });
    for (const g of groups) { const k = `▷ ${g}`; opts.push(k); map[k] = { groupStart: g }; }
    return { opts, map };
  }

  // ── Components subfolder ────────────────────────────────────────────────────
  const compsFolder = folder.addFolder('Components');
  const addComp = { type: 'switch', name: '' };
  function addComponent() {
    const taken = new Set(w.doc.wiring.components.map((c) => c.id));
    const id = uniqueId(addComp.type, taken);
    const t = (controls && controls.target) ? controls.target : { x: 0, y: 12, z: 0 };
    const allTypes = Object.keys(w.doc.wiring.cableTypes);
    // Spread new components so two added in a row don't sit on the same point.
    const n = w.doc.wiring.components.length;
    w.doc.wiring.components.push({
      id, name: addComp.name || `${addComp.type} ${n + 1}`, type: addComp.type,
      placement: { x: +(t.x + (n % 4) * 2).toFixed(2), y: +(t.y + 1).toFixed(2), z: +(t.z + Math.floor(n / 4) * 2).toFixed(2) },
      ports: [{ id: 'main', accepts: allTypes }],
    });
    addComp.name = '';
    rebuildLayer(); refreshComponents(); refreshRoutes(); refreshLayers();
  }
  function refreshComponents() {
    clearFolder(compsFolder);
    compsFolder.add(addComp, 'type', COMPONENT_TYPES).name('Type');
    compsFolder.add(addComp, 'name').name('Name');
    compsFolder.add({ add: addComponent }, 'add').name('+ Add Component');
    for (const c of w.doc.wiring.components) {
      const sub = compsFolder.addFolder(`${c.name} [${c.type}]`);
      sub.close();
      sub.add(c.placement, 'x', -100, 100, 0.5).name('X').onChange(() => rebuildLayer());
      sub.add(c.placement, 'y', -100, 100, 0.5).name('Y').onChange(() => rebuildLayer());
      sub.add(c.placement, 'z', -100, 100, 0.5).name('Z').onChange(() => rebuildLayer());
      sub.add({ del: () => {
        w.doc.wiring.components = w.doc.wiring.components.filter((x) => x !== c);
        w.doc.wiring.routes = w.doc.wiring.routes.filter((r) => !r.endpoints.some((e) => e.component === c.id));
        rebuildLayer(); refreshComponents(); refreshRoutes(); refreshLayers();
      } }, 'del').name('🗑 Delete');
    }
  }

  // ── Routes subfolder ────────────────────────────────────────────────────────
  const routesFolder = folder.addFolder('Routes (wires)');
  const addRoute = { from: '—', to: '—', cable: Object.keys(w.doc.wiring.cableTypes)[0], name: '' };
  function addRouteFn() {
    const { map } = endpointOptions();
    const from = map[addRoute.from];
    const to = map[addRoute.to];
    if (!from || !to) { setStatus('Pick both From and To endpoints', true); return; }
    const taken = new Set(w.doc.wiring.routes.map((r) => r.id));
    const id = uniqueId('route', taken);
    w.doc.wiring.routes.push({
      id, name: addRoute.name || id, endpoints: [from, to], cables: [{ type: addRoute.cable }], waypoints: [],
    });
    addRoute.name = '';
    rebuildLayer(); refreshRoutes(); refreshLayers();
  }
  function refreshRoutes() {
    clearFolder(routesFolder);
    const { opts } = endpointOptions();
    addRoute.from = opts.includes(addRoute.from) ? addRoute.from : '—';
    addRoute.to = opts.includes(addRoute.to) ? addRoute.to : '—';
    routesFolder.add(addRoute, 'from', opts).name('From');
    routesFolder.add(addRoute, 'to', opts).name('To');
    routesFolder.add(addRoute, 'cable', Object.keys(w.doc.wiring.cableTypes)).name('Cable');
    routesFolder.add(addRoute, 'name').name('Name');
    routesFolder.add({ add: addRouteFn }, 'add').name('+ Add Route');
    for (const r of w.doc.wiring.routes) {
      const sub = routesFolder.addFolder(`${r.name} (${r.cables.map((c) => c.type).join('+')})`);
      sub.close();
      sub.add({ del: () => {
        w.doc.wiring.routes = w.doc.wiring.routes.filter((x) => x !== r);
        delete w.layer.routes[r.id];
        rebuildLayer(); refreshRoutes(); refreshLayers();
      } }, 'del').name('🗑 Delete');
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function saveWiring() {
    try { buildWiringModel(w.doc); } catch (e) { setStatus(`Not saved — ${e.message.replace('[wiring] ', '')}`, true); return; }
    const text = yaml.dump(w.doc);
    const res = await fetch(`http://localhost:6970/save-wiring?scene=${sceneName}`, {
      method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: text,
    }).catch(() => null);
    setStatus(res && res.ok ? 'Saved wiring.yaml ✓' : 'Save failed (save server?)', !(res && res.ok));
  }
  folder.add({ save: saveWiring }, 'save').name('💾 Save Wiring');
  folder.$children.appendChild(status);

  // Initial build.
  rebuildLayer();
  refreshLayers(); refreshComponents(); refreshRoutes();

  const api = {
    state: w, rebuildLayer, addComponent, addRoute: addRouteFn, saveWiring, setShow,
    refreshAll: () => { refreshLayers(); refreshComponents(); refreshRoutes(); },
    // Automation/testing helpers (mirror the button actions).
    addComponentOfType: (type, name) => { addComp.type = type; addComp.name = name || ''; addComponent(); },
    addRouteByComponentIds: (fromId, toId, cable) => {
      const taken = new Set(w.doc.wiring.routes.map((r) => r.id));
      w.doc.wiring.routes.push({
        id: uniqueId('route', taken), name: `${fromId}→${toId}`,
        endpoints: [{ component: fromId, port: 'main' }, { component: toId, port: 'main' }],
        cables: [{ type: cable || Object.keys(w.doc.wiring.cableTypes)[0] }], waypoints: [],
      });
      rebuildLayer(); refreshRoutes(); refreshLayers();
    },
    setLayerVisible: (key, val) => {
      if (!w.layer) return;
      if (key in w.layer) w.layer[key] = val;
      else if (w.layer.families && key in w.layer.families) w.layer.families[key] = val;
      else if (w.layer.routes && key in w.layer.routes) w.layer.routes[key] = val;
      if (w.group) applyWiringVisibility(w.group, w.layer);
    },
  };
  window.__wiringSection = api;
  return api;
}

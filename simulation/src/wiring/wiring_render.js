/**
 * wiring_render.js — builds the 3D wiring layer (THREE objects) from a
 * validated wiring model (wiring_model.js). Tubes per cable (coloured by
 * cable type, with a light halo so dark cables read), box markers for
 * components, sphere markers for anchors, and canvas-text labels.
 *
 * Phase-2 visualization for docs/36_wiring_tracer.md. Pure presentation: the
 * model is the source of truth; this only draws it.
 */
import * as THREE from 'three';

const TUBE_RADIUS = 0.16;       // render radius in scene units (visibility)
const HALO_RADIUS = 0.30;
const COMPONENT_SIZE = 0.8;
const ANCHOR_RADIUS = 0.4;

function hexColor(h) {
  return new THREE.Color(h);
}

function endpointPosition(model, ep) {
  if (ep.kind === 'component') {
    const p = model.components.get(ep.component).placement;
    return new THREE.Vector3(p.x, p.y, p.z);
  }
  if (ep.kind === 'anchor') {
    const p = model.anchors.get(ep.anchor).placement;
    return new THREE.Vector3(p.x, p.y, p.z);
  }
  // groupStart — resolve against live fixtures (first fixture in the group)
  const fixtures = window.parFixtures || [];
  const match = fixtures.find((f) => f && f.config && f.config.group === ep.groupStart);
  if (!match) throw new Error(`[wiring] groupStart "${ep.groupStart}" has no fixture in the scene`);
  return match.hitbox.position.clone();
}

function makeLabel(text, color = '#ffffff') {
  const pad = 8;
  const fontPx = 48;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontPx}px Inter, Arial, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `bold ${fontPx}px Inter, Arial, sans-serif`;
  ctx.fillStyle = 'rgba(10,14,22,0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const scale = 0.013;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

/**
 * Build the wiring layer group from a validated model.
 * @returns {THREE.Group}
 */
export function buildWiringGroup(model) {
  const group = new THREE.Group();
  group.name = 'WiringLayer';

  // Cables — one tube per cable on each route.
  for (const route of model.routes) {
    const pts = [
      endpointPosition(model, route.endpoints[0]),
      ...route.waypoints.map((w) => new THREE.Vector3(w.x, w.y, w.z)),
      endpointPosition(model, route.endpoints[1]),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segs = Math.max(16, pts.length * 12);

    route.cables.forEach((cable, ci) => {
      const def = model.cableTypes.get(cable.type);
      const radius = TUBE_RADIUS + ci * 0.06; // separate stacked cables slightly

      // light halo so black/dark cables read against the night scene
      const halo = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, HALO_RADIUS + ci * 0.06, 10, false),
        new THREE.MeshBasicMaterial({ color: 0xf2f4f8, transparent: true, opacity: 0.28 }),
      );
      group.add(halo);

      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, radius, 10, false),
        new THREE.MeshBasicMaterial({ color: hexColor(def.color) }),
      );
      tube.userData = { wiringRoute: route.id, wiringCable: def.id };
      group.add(tube);
    });

    // route name label at the midpoint
    const mid = curve.getPoint(0.5);
    const label = makeLabel(route.name, '#ffffff');
    label.position.copy(mid).add(new THREE.Vector3(0, 1.2, 0));
    group.add(label);
  }

  // Components — box marker + label.
  for (const c of model.components.values()) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(COMPONENT_SIZE, COMPONENT_SIZE, COMPONENT_SIZE),
      new THREE.MeshBasicMaterial({ color: 0x39e0ff }),
    );
    box.position.set(c.placement.x, c.placement.y, c.placement.z);
    group.add(box);
    const label = makeLabel(`${c.name} [${c.type}]`, '#9ff0ff');
    label.position.copy(box.position).add(new THREE.Vector3(0, COMPONENT_SIZE, 0));
    group.add(label);
  }

  // Anchors — sphere marker + label.
  for (const a of model.anchors.values()) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(ANCHOR_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    sphere.position.set(a.placement.x, a.placement.y, a.placement.z);
    group.add(sphere);
    const label = makeLabel(a.id, '#dfe4ee');
    label.position.copy(sphere.position).add(new THREE.Vector3(0, ANCHOR_RADIUS + 0.6, 0));
    group.add(label);
  }

  return group;
}

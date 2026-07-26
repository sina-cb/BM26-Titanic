/**
 * dmx_fixture_runtime.js — Unified runtime fixture for the simulation.
 *
 * Replaces both legacy ParLight and ModelFixture classes.
 * Renders the fixture based on its FixtureDefinition pixel layout:
 *   - UkingPar: single bulb/halo
 *   - ShehdsBar: 18 LEDs along a bar body
 *   - VintageLed: 6 heads vertically
 *
 * In lite mode, SpotLights are replaced with emissive spheres.
 */
import * as THREE from 'three';
import { params } from "../core/state.js";
import { getProfileDef } from "../core/profile_registry.js";
import { scaleSimulationPreviewRgb } from "../core/sim_preview.js";
import { dmxOutputScale } from "../dmx/dmx_output_overrides.js";

// ── Shared geometries ────────────────────────────────────────────────────
const defaultShellMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
const defaultDotMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

// Lower-poly geometry constants. With ~492 pixels × (bulb + halo + dot + beam)
// per frame, even a single SphereGeometry being (8,8) vs (6,4) costs ~100×500 =
// 50k extra triangles per frame. These dots are millimeters across at the
// model scale, so facets are invisible — every segment we save is free FPS.
const baseBeamGeo = new THREE.CylinderGeometry(0.01, 1, 1, 8, 1, true);
baseBeamGeo.translate(0, -0.5, 0);
baseBeamGeo.rotateX(Math.PI / 2); // Point wide end towards -Z

// Unit sphere shared by EVERY fixture's bulb + halo InstancedMesh (mirrors
// led_strand.js:18). Each instance scales this unit sphere to that pixel's
// radius; at pixel scale the (6,4) facets are invisible, so a low-poly unit
// sphere is free FPS. Module constant — never disposed.
const emitterSphereGeo = new THREE.SphereGeometry(1, 6, 4);

// Module-level scratch reused by every instance matrix/color write, so building
// or recoloring a fixture allocates nothing per pixel (mirrors led_strand's
// dummy Object3D + _pixelColor).
const _instDummy = new THREE.Object3D();
const _instColor = new THREE.Color();

// ── LED diffusion glow sprite (shared texture) ──────────────────────────
// One procedurally generated radial-gradient texture shared by EVERY LED
// pixel halo in the scene (generated in-code — the sim must stay offline-safe,
// no external image assets). The falloff is a dual Gaussian (bright core +
// wide faint tail, like a real frosted-acrylic diffuser kernel), shifted so
// alpha reaches exactly 0 at the quad edge — no visible rim.
const LED_GLOW_TEX_SIZE = 128;
const LED_GLOW_CORE_K = 22.0;  // core Gaussian exponent (tight, bright)
const LED_GLOW_TAIL_K = 8.0;   // tail Gaussian exponent (kept tight — a wide tail reads as smoke)
const LED_GLOW_CORE_W = 0.82;  // core weight (core + tail weights sum to 1); high = clean, low = hazy
const LED_GLOW_SPAN = 1.4;     // sprite quad size in bulb-diameter units at 1× diffusion
const LED_GLOW_OPACITY = 0.45; // per-sprite opacity at 1× diffusion (fades with amt, see applyDiffusion)
let _ledGlowTexture = null;
function getLedGlowTexture() {
  if (_ledGlowTexture) return _ledGlowTexture;
  const size = LED_GLOW_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  const kernel = (r2) =>
    LED_GLOW_CORE_W * Math.exp(-LED_GLOW_CORE_K * r2) +
    (1 - LED_GLOW_CORE_W) * Math.exp(-LED_GLOW_TAIL_K * r2);
  const edge = kernel(1);       // kernel value at the quad edge (r = 1)
  const peak = kernel(0) - edge;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const g = Math.max(0, (kernel(dx * dx + dy * dy) - edge) / peak);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(g * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  _ledGlowTexture = new THREE.CanvasTexture(canvas);
  return _ledGlowTexture;
}

// ── LED diffusor "screen" panel ─────────────────────────────────────────
// A flat translucent panel drawn across the fixture's front face that reads
// the live per-pixel colors and paints a blended 2D surface — the look of
// LEDs mounted behind a ~50% opaque milky-white polycarbonate diffuser. It is
// a per-fixture CanvasTexture on a Plane (its own canvas/texture/mesh, so the
// GPU cost is isolated and it's zero when OFF), and it works for ANY pixel
// layout (grid / line / arbitrary TE-Sign map) because each pixel is stamped
// at its own local position — no grid assumption. Distinct from the diffusion
// glow (which is additive halo sprites); this is a real bounded surface.
const SCREEN_TEX_LONG_EDGE = 256;   // canvas px on the panel's longer edge
const SCREEN_MILK = 0.35;           // mix each LED color toward white (milky-diffuser pastel)
const SCREEN_BASE_ALPHA = 0.05;     // faint body of the unlit polycarb sheet
const SCREEN_CORE_ALPHA = 0.85;     // blob centre alpha before the radial falloff
const SCREEN_DEFAULT_PIXEL_MM = 60; // default blob diameter (mm) — a touch over a 50mm pitch so blobs merge

// Blob radius, in mm, that each pixel bleeds across the diffuser. Missing or
// garbage → the default; clamped so a slider can't collapse it to a dot or
// blow it up past the panel.
function clampScreenPixelMm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SCREEN_DEFAULT_PIXEL_MM;
  return THREE.MathUtils.clamp(numeric, 10, 400);
}

function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

// Per-axis fixture scale (LED resize). Missing/garbage → 1 (no scale), and the
// range keeps a dragged gizmo from collapsing the fixture to zero or blowing it
// up past the scene.
function clampScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return THREE.MathUtils.clamp(numeric, 0.1, 20);
}

function sanitizeRgb(r, g, b) {
  return [clampUnit(r), clampUnit(g), clampUnit(b)];
}

function readDmxChannelNormalized(dmxSlice, channelIndex) {
  if (!dmxSlice || !channelIndex || channelIndex < 1) return 0;
  const raw = dmxSlice[channelIndex - 1];
  return Number.isFinite(raw) ? THREE.MathUtils.clamp(raw / 255, 0, 1) : 0;
}

// SpotLight allocation is handled by light_pool.js — fixtures do NOT create lights.

export class DmxFixtureRuntime {
  /**
   * @param {Object} config      - Fixture config from scene_config.yaml fixtures[] entry
   * @param {number} index       - Index in the fixtures array
   * @param {THREE.Scene} scene  - Three.js scene
   * @param {Array} interactiveObjects - Raycast targets array
   * @param {number} modelRadius - Scene model radius (for SpotLight range)
   * @param {Object|null} fixtureDef - From FixtureDefinitionRegistry
   * @param {Object|null} patchDef   - From PatchRegistry (null = unpatched)
     */
  constructor(config, index, scene, interactiveObjects, modelRadius, fixtureDef, patchDef) {
    // Lighting profile: full | unified | full_lite | unified_lite | super_lite | edit
    const profile = params.lightingProfile || 'edit';
    const profileDef = getProfileDef(profile);
    this.profile = profile;
    this.profileDef = profileDef;
    this.config = config;
    this.index = index;
    this.scene = scene;
    this.interactiveObjects = interactiveObjects;
    this.modelRadius = modelRadius;
    this.fixtureDef = fixtureDef;
    this.patchDef = patchDef;
    // LED-bus fixtures (Ango 4 pixel panels/ropes) get resize + diffusion; a
    // DMX par/bar keeps its spotlight semantics (scale → cone angle, no glow
    // toggle). One flag switches both behaviours below.
    this._isLed = !!(fixtureDef && fixtureDef.bus === 'led');

    const color = config.color || '#ffaa44';
    const intensity = config.intensity || 5;
    const angle = config.angle || 20;
    const penumbra = config.penumbra || 0.5;

    // ─── Group (parent container for all visuals) ────────────────────
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // ─── Parse fixture dimensions ────────────────────────────────────
    let width = 0.15, height = 0.15, depth = 0.12;
    if (fixtureDef && fixtureDef.dimensions) {
      width = (fixtureDef.dimensions.width || 100) * 0.001;
      height = (fixtureDef.dimensions.height || 100) * 0.001;
      depth = (fixtureDef.dimensions.depth || 100) * 0.001;
    }
    this._fixtureWidth = width;
    this._fixtureHeight = height;

    // ─── Hitbox ──────────────────────────────────────────────────────
    const padding = 0.1;
    const hitboxGeo = new THREE.BoxGeometry(
      Math.max(width, 0.5) + padding,
      Math.max(height, 0.5) + padding,
      Math.max(depth, 0.5) + padding
    );
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.userData = { isParLight: true, fixture: this };
    this.interactiveObjects.push(this.hitbox);
    this.scene.add(this.hitbox);

    // ─── Build Shell (fixture body) ──────────────────────────────────
    // Only DMX pars/bars/fog machines get an opaque physical body. LED-bus
    // fixtures (Ango-4 pixel panels/signs — the TE Sign, te_led_grid) are
    // luminous: they must read as their pixels floating in space, NOT sit on an
    // opaque backing slab. A dark shell box renders (via unlit MeshBasicMaterial)
    // as a flat black rectangle that occludes and visually conflicts with the
    // night scene behind it. LED strands set the precedent — no body mesh at all.
    // Selection/unpatched feedback still shows via the TransformControls gizmo
    // (interaction.js attaches it to the hitbox); setSelected / setUnpatchedRed
    // no-op safely while shellMat is null.
    this.shellMat = null;
    this.shell = null;
    if (!this._isLed) {
      if (fixtureDef && fixtureDef.shell) {
        this.shellMat = defaultShellMat.clone();
        this.shellMat.color.set(fixtureDef.shell.color || '#111111');
        let shellGeo;
        if (fixtureDef.shell.type === 'cylinder') {
          const d = fixtureDef.shell.dimensions;
          const r = (d[0] / 2) * 0.001;
          const h = d[2] * 0.001;
          shellGeo = new THREE.CylinderGeometry(r, r, h, 16);
          shellGeo.rotateX(Math.PI / 2);
        } else {
          const d = fixtureDef.shell.dimensions;
          shellGeo = new THREE.BoxGeometry(d[0] * 0.001, d[1] * 0.001, d[2] * 0.001);
        }
        this.shell = new THREE.Mesh(shellGeo, this.shellMat);
        if (fixtureDef.shell.offset) {
          const o = fixtureDef.shell.offset;
          // Negate Z to match the dot coordinate convention (-Z = forward/emitting direction)
          this.shell.position.set(o[0] * 0.001, o[1] * 0.001, -o[2] * 0.001);
        }
        this.group.add(this.shell);
      } else {
        // No shell definition — create a simple can geometry (like old ParLight)
        const canGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.2, 12);
        canGeo.rotateX(Math.PI / 2);
        this.shellMat = defaultShellMat.clone();
        this.shell = new THREE.Mesh(canGeo, this.shellMat);
        this.group.add(this.shell);
      }
    }

    // ─── Build Pixels (instanced emitter geometry) ───────────────────
    // Each addressable pixel used to spawn its OWN bulb + halo (+ dot) mesh —
    // ~2-3 draw calls per pixel, ~5k draws on titanic in the emitter profiles,
    // CPU-bound at 20 FPS (see 20260724_1_render_perf_root_cause.md). We now
    // mirror led_strand.js: ONE InstancedMesh per fixture for bulbs, one for
    // sphere halos, one for cones — per-pixel color rides in instanceColor, so
    // the whole fixture is ~3 draws regardless of pixel count. The old per-pixel
    // "dot" meshes are dropped: each sat at its pixel's centroid, same material,
    // radius <= the bulb, so the bulb fully occluded it (provably invisible).
    // SpotLights are managed by the global LightPool (see light_pool.js).
    this.pixels = [];
    const hasPixelDef = fixtureDef && fixtureDef.pixels && fixtureDef.pixels.length > 0;

    // Legacy references — no longer instantiated, but kept for API compat
    this.fixtureSpotLight = null;
    this.litePointLight = null;

    // Render gates from the construction-time profile. A profile switch that
    // changes any render flag rebuilds every fixture (getProfileRebuildKey +
    // the gui_builder profile handler), so reading them once here is
    // authoritative for this fixture's lifetime.
    const emitterMode = this.profileDef.render.emitterMode; // none | pixel | fixture_representative
    const coneMode = this.profileDef.render.coneMode;       // none | pixel | fixture
    this._buildEmitters = emitterMode === 'pixel' || emitterMode === 'fixture_representative';
    this._buildCones = coneMode === 'pixel' || coneMode === 'fixture';
    // Representative modes collapse the fixture to a single visible instance
    // (pixel 0); 'pixel' renders every pixel. Cached for the matrix builders.
    this._emitterRepresentative = emitterMode === 'fixture_representative';
    this._coneRepresentative = coneMode === 'fixture';

    // Per-fixture instanced meshes (assigned below). haloInst is the DMX
    // sphere-halo batch; LED-bus fixtures keep per-pixel Sprite halos (the
    // frosted-diffuser look + per-fixture diffusion toggle), so haloInst stays
    // null for them and each pixel carries its own p.halo Sprite.
    this.bulbInst = null;
    this.haloInst = null;
    this.coneInst = null;
    this.bulbMat = null;
    this.haloMat = null;
    this.coneMat = null;

    // ── Gather per-pixel data (localPos + sizes). localPos is ALWAYS needed
    // (cones + light_pool sample it) even when no emitter renders.
    if (hasPixelDef) {
      fixtureDef.pixels.forEach((pixelModel) => {
        let avgX = 0, avgY = 0, avgZ = 0;
        const hasDots = pixelModel.dots && pixelModel.dots.length > 0;
        if (hasDots) {
          pixelModel.dots.forEach(d => {
            avgX += d[0] * 0.001; avgY += d[1] * 0.001; avgZ += -d[2] * 0.001;
          });
          avgX /= pixelModel.dots.length;
          avgY /= pixelModel.dots.length;
          avgZ /= pixelModel.dots.length;
        }
        let pixelSize = 0;
        if (typeof pixelModel.size === 'number') pixelSize = pixelModel.size;
        else if (Array.isArray(pixelModel.size)) pixelSize = Math.max(...pixelModel.size);
        const bulbSize = Math.max(pixelSize * 0.001, 0.02);
        this.pixels.push({
          model: pixelModel,
          localPos: new THREE.Vector3(avgX, avgY, avgZ),
          color: new THREE.Color(color),
          bulbSize,
          haloSize: bulbSize * 1.8,
          haloBaseSize: bulbSize * LED_GLOW_SPAN,
          halo: null, haloMat: null,
        });
      });
    } else {
      // No fixture definition — a single centroid pixel with the legacy par
      // bulb/halo radii (old bulbGeo r=0.5, haloGeo r=0.8), routed through the
      // same instanced path so every method treats it uniformly.
      this.pixels.push({
        model: null,
        localPos: new THREE.Vector3(0, 0, 0),
        color: new THREE.Color(color),
        bulbSize: 0.5,
        haloSize: 0.8,
        haloBaseSize: 0.5 * LED_GLOW_SPAN,
        halo: null, haloMat: null,
      });
    }

    const pixelCount = this.pixels.length;

    // ── Instanced bulb + sphere-halo. LED-bus fixtures use per-pixel Sprites
    // for the halo (built below) instead of the sphere InstancedMesh.
    if (this._buildEmitters && pixelCount > 0) {
      // Material color stays white; the real per-pixel color rides in
      // instanceColor (white × instanceColor = the pixel color). depthTest:false
      // matches the legacy bulb material exactly.
      this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
      this.bulbInst = new THREE.InstancedMesh(emitterSphereGeo, this.bulbMat, pixelCount);
      // Instances span the fixture while the InstancedMesh origin sits at the
      // group origin — the unit-sphere bounds would frustum-cull wrong, so
      // disable culling (per-fixture draw counts are tiny). Mirrors led_strand.
      this.bulbInst.frustumCulled = false;
      this.group.add(this.bulbInst);

      if (this._isLed) {
        // LED diffusion glow: camera-facing Sprites with the shared radial
        // gradient (unchanged look). Kept per-pixel — Sprites don't instance,
        // and the LED-bus pixel count is small. applyDiffusion() drives their
        // visibility / scale / opacity per the per-fixture diffusion toggle.
        this.pixels.forEach((p) => {
          const haloMat = new THREE.SpriteMaterial({
            map: getLedGlowTexture(), color, transparent: true,
            opacity: LED_GLOW_OPACITY,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const halo = new THREE.Sprite(haloMat);
          halo.position.copy(p.localPos);
          halo.scale.setScalar(p.haloBaseSize * (params.globalHaloScale || 1.0));
          this.group.add(halo);
          p.halo = halo; p.haloMat = haloMat;
        });
      } else {
        // DMX sphere halo: additive BackSide rim (legacy recipe, byte-for-byte;
        // material white so instanceColor carries the true per-pixel color).
        this.haloMat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
        });
        this.haloInst = new THREE.InstancedMesh(emitterSphereGeo, this.haloMat, pixelCount);
        this.haloInst.frustumCulled = false;
        this.group.add(this.haloInst);
      }
    }

    // ── Instanced cones (beam volumes).
    if (this._buildCones && pixelCount > 0) {
      this.coneMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, depthWrite: true, side: THREE.DoubleSide,
      });
      this.coneInst = new THREE.InstancedMesh(baseBeamGeo, this.coneMat, pixelCount);
      this.coneInst.frustumCulled = false;
      this.group.add(this.coneInst);
    }

    // Bulb/halo matrices (positions + sizes) are set once here; cone matrices
    // (beam angle) + the driven colors are written by updateVisualsFromHitbox
    // via syncFromConfig below. Seed instance colors to the config color now so
    // an un-driven fixture shows its base color (an InstancedMesh with no
    // instanceColor buffer would render the white material).
    this._rebuildBulbHaloMatrices();
    const seed = new THREE.Color(color);
    for (let i = 0; i < pixelCount; i++) this._writePixelColor(i, seed.r, seed.g, seed.b);

    // Diffusor screen panel — lazily built on first enable (see update()), so
    // an LED fixture that never turns it on allocates no canvas/texture/mesh.
    this._screen = null;

    // ─── Initial positioning ─────────────────────────────────────────
    this.syncFromConfig();
  }

  // Build the per-fixture diffusor panel: a Plane across the fixture's front
  // face carrying a CanvasTexture that `update()` repaints from the live pixel
  // colors. Sized to the physical fixture (falls back to the pixel bounds), so
  // it moves / rotates / resizes with the fixture (it lives in `this.group`).
  _buildScreen() {
    // Pixel bounds in group-local space (works for grid / line / arbitrary map).
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumZ = 0, n = 0;
    for (const p of this.pixels) {
      if (!p.localPos) continue;
      minX = Math.min(minX, p.localPos.x); maxX = Math.max(maxX, p.localPos.x);
      minY = Math.min(minY, p.localPos.y); maxY = Math.max(maxY, p.localPos.y);
      sumZ += p.localPos.z; n++;
    }
    if (n === 0) return; // nothing to diffuse

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const zPlane = sumZ / n;

    // Prefer the physical fixture face; fall back to the pixel span (+margin)
    // for a definition with no dimensions or a degenerate 1-row/1-col layout.
    const margin = 0.04;
    const width = Math.max(this._fixtureWidth || 0, spanX + margin, 0.05);
    const height = Math.max(this._fixtureHeight || 0, spanY + margin, 0.05);

    // Canvas: fixed long edge, aspect-matched, so the paint cost is bounded.
    const long = SCREEN_TEX_LONG_EDGE;
    const cw = width >= height ? long : Math.max(1, Math.round(long * width / height));
    const ch = width >= height ? Math.max(1, Math.round(long * height / width)) : long;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    // A hair in front of the LEDs (−Z is the emitting/front direction here).
    mesh.position.set(centerX, centerY, zPlane - 0.005);
    mesh.visible = false;
    this.group.add(mesh);

    this._screen = {
      mesh, mat, texture, canvas, ctx: canvas.getContext('2d'),
      cw, ch,
      originX: centerX - width / 2, originY: centerY - height / 2,
      width, height,
    };
  }

  // Per-frame hook (called from animate.js). Repaints the diffusor panel from
  // the live pixel colors when it's enabled; otherwise a couple of cheap
  // checks. Builds the panel lazily the first time it's switched on.
  update() {
    if (!this._isLed) return;
    const on = !!this.config.screen && this.group.visible;
    if (on && !this._screen) this._buildScreen();
    if (!this._screen) return;
    this._screen.mesh.visible = on;
    if (on) this._paintScreen();
  }

  _paintScreen() {
    const scr = this._screen;
    const { ctx, cw, ch } = scr;
    const pxPerMeter = cw / scr.width;
    const radius = Math.max(3, clampScreenPixelMm(this.config.screenPixelSize) * 0.001 * pxPerMeter);

    ctx.clearRect(0, 0, cw, ch);
    // Faint milky body of the polycarb sheet (barely visible unlit at night).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255,255,255,${SCREEN_BASE_ALPHA})`;
    ctx.fillRect(0, 0, cw, ch);
    // LED bleed: each pixel is an additive soft radial blob, its colour mixed
    // toward white so the surface reads as diffused pastel, not raw neon.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pixels) {
      if (!p.localPos || !p.color) continue;
      const c = p.color;
      const r = Math.round((c.r * (1 - SCREEN_MILK) + SCREEN_MILK) * 255);
      const g = Math.round((c.g * (1 - SCREEN_MILK) + SCREEN_MILK) * 255);
      const b = Math.round((c.b * (1 - SCREEN_MILK) + SCREEN_MILK) * 255);
      const cx = (p.localPos.x - scr.originX) * pxPerMeter;
      const cy = ch - (p.localPos.y - scr.originY) * pxPerMeter; // canvas Y is flipped
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},${SCREEN_CORE_ALPHA})`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${SCREEN_CORE_ALPHA * 0.35})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    scr.texture.needsUpdate = true;
  }

  // ── Visual sync ──────────────────────────────────────────────────────

  updateVisualsFromHitbox() {
    // Sync group to hitbox — every instanced emitter mesh is a child of the
    // group, so their world transforms follow automatically.
    this.group.position.copy(this.hitbox.position);
    this.group.quaternion.copy(this.hitbox.quaternion);
    this.group.scale.copy(this.hitbox.scale);
    this.group.updateMatrixWorld(true);

    const color = this.config.color || '#ffaa44';

    // Cone instance matrices follow the fixture's beam angle (fixture-level).
    this._rebuildConeMatrices();

    // Only reset colors to config defaults when DMX is NOT driving them.
    // Apply the On/Off + Brightness gain so a static (un-patched) fixture
    // honours the override too.
    if (!window._patchesActive) {
      const cc = new THREE.Color(color).multiplyScalar(this.outputGain());
      for (let i = 0; i < this.pixels.length; i++) this._writePixelColor(i, cc.r, cc.g, cc.b);
    }
    this.applyDiffusion();
  }

  // ── Instanced emitter helpers ────────────────────────────────────────

  // Write one pixel's color to every instanced emitter it drives (bulb, sphere
  // halo, cone) plus the LED Sprite halo. Values are already final (callers
  // apply sanitize/preview scaling). `includeCone` lets setBulbColor recolor the
  // emitter without touching the beam, matching the legacy behavior.
  _writePixelColor(i, r, g, b, includeCone = true) {
    const p = this.pixels[i];
    if (!p) return;
    p.color.setRGB(r, g, b);
    _instColor.setRGB(r, g, b);
    if (this.bulbInst) {
      this.bulbInst.setColorAt(i, _instColor);
      if (this.bulbInst.instanceColor) this.bulbInst.instanceColor.needsUpdate = true;
    }
    if (this.haloInst) {
      this.haloInst.setColorAt(i, _instColor);
      if (this.haloInst.instanceColor) this.haloInst.instanceColor.needsUpdate = true;
    }
    if (includeCone && this.coneInst) {
      this.coneInst.setColorAt(i, _instColor);
      if (this.coneInst.instanceColor) this.coneInst.instanceColor.needsUpdate = true;
    }
    if (p.haloMat) p.haloMat.color.setRGB(r, g, b); // LED Sprite halo
  }

  // (Re)write bulb + sphere-halo instance matrices from the given global pixel /
  // halo scale. Positions are group-local (the group follows the hitbox), so
  // this only runs on build and when a global size slider moves — not per frame.
  _rebuildBulbHaloMatrices(pixelScale = params.globalPixelScale || 1.0,
                           haloScale = params.globalHaloScale || 1.0) {
    const rep = this._emitterRepresentative;
    for (let i = 0; i < this.pixels.length; i++) {
      const p = this.pixels[i];
      // Representative collapses the fixture to a single big instance at the
      // group origin; pixel mode renders every pixel at its own position.
      const renders = rep ? i === 0 : true;
      const repScale = rep ? 6.0 : 1.0;
      const px = rep ? 0 : p.localPos.x;
      const py = rep ? 0 : p.localPos.y;
      const pz = rep ? 0 : p.localPos.z;
      if (this.bulbInst) {
        _instDummy.position.set(px, py, pz);
        _instDummy.scale.setScalar(renders ? p.bulbSize * repScale * pixelScale : 0);
        _instDummy.updateMatrix();
        this.bulbInst.setMatrixAt(i, _instDummy.matrix);
      }
      if (this.haloInst) {
        _instDummy.position.set(px, py, pz);
        _instDummy.scale.setScalar(renders ? p.haloSize * repScale * haloScale : 0);
        _instDummy.updateMatrix();
        this.haloInst.setMatrixAt(i, _instDummy.matrix);
      }
    }
    if (this.bulbInst) this.bulbInst.instanceMatrix.needsUpdate = true;
    if (this.haloInst) this.haloInst.instanceMatrix.needsUpdate = true;
  }

  // (Re)write cone instance matrices from the fixture's beam angle. A cone is a
  // unit geometry pointing -Z (baseBeamGeo); each instance is positioned at its
  // pixel and scaled to (radius, radius, length). 'fixture' cone mode renders
  // only pixel 0.
  _rebuildConeMatrices() {
    if (!this.coneInst) return;
    const angle = this.config.angle || 20;
    const coneLen = 1.5;
    const radius = Math.tan(THREE.MathUtils.degToRad(angle)) * coneLen;
    const rep = this._coneRepresentative;
    for (let i = 0; i < this.pixels.length; i++) {
      const p = this.pixels[i];
      const renders = rep ? i === 0 : true;
      _instDummy.position.copy(p.localPos);
      _instDummy.quaternion.identity();
      _instDummy.scale.set(renders ? radius : 0, renders ? radius : 0, renders ? coneLen : 0);
      _instDummy.updateMatrix();
      this.coneInst.setMatrixAt(i, _instDummy.matrix);
    }
    this.coneInst.instanceMatrix.needsUpdate = true;
  }

  // Per-fixture LED diffusion — a soft additive glow that lets neighbouring
  // pixels bleed into each other (a frosted-diffuser look). It reuses the halo
  // meshes each pixel already owns: ON enlarges + shows them so they overlap
  // and blend; OFF hides them so the fixture renders as crisp dots with zero
  // halo overdraw. Opt-in PER FIXTURE, so the GPU cost is isolated — a fixture
  // that doesn't need it pays nothing, and each fixture's halos are independent
  // (no shared/global buffer to serialize on). No-op for DMX fixtures.
  applyDiffusion() {
    if (!this._isLed) return;
    const on = !!this.config.diffusion;
    const amt = on ? Math.max(1, Number(this.config.diffusionAmount) || 2.5) : 1;
    const haloScale = (params.globalHaloScale || 1.0) * amt;
    // Overlap compensation: the glow footprint grows with `amt`, so the number
    // of sprites overlapping any screen pixel grows ~amt². Fading each sprite
    // by 1/amt^1.5 keeps the additive sum from blowing out to flat white under
    // the bloom pass, while the wider footprint still merges neighbouring
    // pixels into one continuous frosted sheet.
    const opacity = LED_GLOW_OPACITY / Math.pow(amt, 1.5);
    // Read the profile fresh (not the cached this.profileDef) because the
    // lighting profile is runtime state that changes without rebuilding the
    // fixture — same reason setVisibility() re-fetches it below.
    const profileDef = getProfileDef(params.lightingProfile || 'edit');
    this.pixels.forEach((p, j) => {
      if (!p.halo) return;
      const shouldEmitter = (profileDef.render.emitterMode === 'pixel') ||
        (profileDef.render.emitterMode === 'fixture_representative' && j === 0);
      p.halo.visible = this.group.visible && shouldEmitter && on;
      p.halo.scale.setScalar(p.haloBaseSize * haloScale);
      p.haloMat.opacity = opacity;
      p.halo.matrixWorldNeedsUpdate = true;
    });
  }

  syncFromConfig() {
    const x = this.config.x || 0;
    const y = this.config.y || 1.5;
    const z = this.config.z || 0;
    this.hitbox.position.set(x, y, z);
    this.hitbox.rotation.setFromVector3(new THREE.Vector3(
      THREE.MathUtils.degToRad(this.config.rotX || 0),
      THREE.MathUtils.degToRad(this.config.rotY || 0),
      THREE.MathUtils.degToRad(this.config.rotZ || 0)
    ), 'YXZ');
    // LED resize: restore the persisted per-axis scale onto the hitbox; the
    // group (all pixel visuals) copies it in updateVisualsFromHitbox.
    if (this._isLed) {
      this.hitbox.scale.set(
        clampScale(this.config.scaleX),
        clampScale(this.config.scaleY),
        clampScale(this.config.scaleZ)
      );
    }
    this.updateVisualsFromHitbox();
  }

  // ── Per-fixture output override (On/Off + Brightness) ────────────────
  // Operator override applied as the LAST LAYER on the merged DMX frame
  // (see applyFixtureOutputOverrides in animate.js) so it beats every
  // pattern, effect and sACN source on the sACN output. `enabled === false`
  // blacks the fixture's whole footprint; brightness (0–100 %, default 100)
  // scales its intensity channels. This helper is the single source of
  // truth for the gain, reused by the static-preview path below and by the
  // light pool (which frees a disabled fixture's SpotLight).
  outputGain() {
    return dmxOutputScale(this.config, params.groupOverrides);
  }

  // ── Color control (used by lighting engines) ─────────────────────────

  setColor(r, g, b) {
    const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
    for (let i = 0; i < this.pixels.length; i++) this._writePixelColor(i, rn, gn, bn);
  }

  setBulbColor(r, g, b) {
    // Bulb + halo only — leaves the beam color untouched (legacy behavior).
    const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
    for (let i = 0; i < this.pixels.length; i++) this._writePixelColor(i, rn, gn, bn, false);
  }

  setPixelColorRGB(pIndex, r, g, b) {
    // Drive fixture-level lights from the first pixel's color
    if (pIndex === 0) {

      // Unified mode: pixel 0's color drives ALL pixels
      if (this.profileDef.unifiedColor) {
        this._unifiedR = r; this._unifiedG = g; this._unifiedB = b;
        for (let i = 0; i < this.pixels.length; i++) {
          this._applyPixelColor(i, r, g, b);
        }
        return;
      }
    }

    // Unified mode: skip individual pixel updates (pixel 0 already handled all)
    if (this.profileDef.unifiedColor) return;

    this._applyPixelColor(pIndex, r, g, b);
  }

  _applyPixelColor(pIndex, r, g, b) {
    if (pIndex < 0 || pIndex >= this.pixels.length) return;
    const [rn, gn, bn] = scaleSimulationPreviewRgb(...sanitizeRgb(r, g, b));
    this._writePixelColor(pIndex, rn, gn, bn);
  }

  // ── DMX frame application (Phase 2) ──────────────────────────────────

  applyDmxFrame(dmxSlice) {
    if (!dmxSlice || !this.fixtureDef) return;
    this.fixtureDef.pixels.forEach((pixelModel, pIndex) => {
      if (!pixelModel.channels) return;
      const ch = pixelModel.channels;
      
      const dimmer = ch.dimmer ? readDmxChannelNormalized(dmxSlice, ch.dimmer) : 1;
      
      let r = 0, g = 0, b = 0;
      let hasColor = false;

      if (ch.red !== undefined && ch.green !== undefined && ch.blue !== undefined) {
        r = readDmxChannelNormalized(dmxSlice, ch.red) * dimmer;
        g = readDmxChannelNormalized(dmxSlice, ch.green) * dimmer;
        b = readDmxChannelNormalized(dmxSlice, ch.blue) * dimmer;
        hasColor = true;
      }

      if (ch.value !== undefined) {
        const warm = readDmxChannelNormalized(dmxSlice, ch.value) * dimmer;
        r += warm * 1.0;
        g += warm * 0.75;
        b += warm * 0.45;
        hasColor = true;
      }

      if (hasColor) {
        this.setPixelColorRGB(pIndex, Math.min(1, r), Math.min(1, g), Math.min(1, b));
      }
    });
  }

  // ── Transform ────────────────────────────────────────────────────────

  handleTransformScale() {
    // LED fixtures: the scale gizmo is a real resize — the scale is persisted
    // by writeTransformToConfig and kept on the hitbox (the visuals follow it).
    // Clamp the live hitbox to the SAME bounds we persist so the preview never
    // diverges from the saved value (drag past 20× then reload = silent snap).
    if (this._isLed) {
      this.hitbox.scale.set(
        clampScale(this.hitbox.scale.x),
        clampScale(this.hitbox.scale.y),
        clampScale(this.hitbox.scale.z)
      );
      return;
    }
    // DMX fixtures: a par/bar has no size, so the scale gizmo widens its beam
    // cone instead, then resets to unit scale.
    if (this.hitbox.scale.x !== 1 || this.hitbox.scale.y !== 1 || this.hitbox.scale.z !== 1) {
      this.config.angle = THREE.MathUtils.clamp(
        (this.config.angle || 20) * Math.max(this.hitbox.scale.x, this.hitbox.scale.y),
        5, 90
      );
      this.hitbox.scale.set(1, 1, 1);
    }
  }

  writeTransformToConfig() {
    this.config.x = this.hitbox.position.x;
    this.config.y = this.hitbox.position.y;
    this.config.z = this.hitbox.position.z;
    const euler = new THREE.Euler().setFromQuaternion(this.hitbox.quaternion, 'YXZ');
    this.config.rotX = THREE.MathUtils.radToDeg(euler.x);
    this.config.rotY = THREE.MathUtils.radToDeg(euler.y);
    this.config.rotZ = THREE.MathUtils.radToDeg(euler.z);
    if (this._isLed) {
      this.config.scaleX = clampScale(this.hitbox.scale.x);
      this.config.scaleY = clampScale(this.hitbox.scale.y);
      this.config.scaleZ = clampScale(this.hitbox.scale.z);
    }
  }

  // ── Visibility & Scaling ─────────────────────────────────────────────

  updateScales(pixelScale, haloScale) {
    // Rebuild bulb + sphere-halo instance matrices at the new global scale.
    // (LED Sprite halos are re-scaled by applyDiffusion below.)
    this._rebuildBulbHaloMatrices(pixelScale || 1.0, haloScale || 1.0);
    this.applyDiffusion();
  }

  setVisibility(visible, conesVisible = true) {
    this.hitbox.visible = visible;
    this.group.visible = visible;

    // SpotLights are managed by the global LightPool — no per-fixture visibility.
    // The instanced emitter/cone meshes only exist when their profile mode was
    // active at build time (a render-flag change rebuilds the fixture), so
    // whole-mesh visibility is all that's needed here. Representative modes hide
    // the non-rendered instances via zero-scale matrices, not visibility.
    if (this.bulbInst) this.bulbInst.visible = visible;
    if (this.haloInst) this.haloInst.visible = visible;
    if (this.coneInst) this.coneInst.visible = visible && conesVisible;

    // LED Sprite halos are gated by the per-fixture diffusion toggle.
    this.applyDiffusion();
  }

  setSelected(selected) {
    if (this.shellMat) {
      this.shellMat.color.setHex(selected ? 0x2288ff : 0x333333);
    }
  }

  // Diagnostic body tint for the "show unpatched as red" overlay. Sim-only;
  // the caller skips selected fixtures so selection tint is never clobbered.
  setUnpatchedRed(on) {
    if (this.shellMat) {
      this.shellMat.color.setHex(on ? 0xff2222 : 0x333333);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  destroy() {
    this.scene.remove(this.group);
    this.scene.remove(this.hitbox);

    const disposeNode = (node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
        else node.material.dispose();
      }
    };

    // SpotLights are managed by the global LightPool — nothing to remove here.

    // Per-fixture instanced emitter meshes: dispose the InstancedMesh buffers +
    // their materials. The geometry (emitterSphereGeo / baseBeamGeo) is a shared
    // module constant — NEVER dispose it (other fixtures still use it).
    if (this.bulbInst) { this.bulbInst.dispose(); if (this.bulbMat) this.bulbMat.dispose(); }
    if (this.haloInst) { this.haloInst.dispose(); if (this.haloMat) this.haloMat.dispose(); }
    if (this.coneInst) { this.coneInst.dispose(); if (this.coneMat) this.coneMat.dispose(); }

    // LED-bus fixtures carry per-pixel Sprite halos — dispose each material. The
    // Sprite's shared geometry + the module-level glow texture stay intact.
    this.pixels.forEach(p => {
      if (p.halo && p.halo.isSprite && p.halo.material) p.halo.material.dispose();
    });

    if (this._screen) {
      this._screen.mesh.geometry.dispose();
      this._screen.mat.dispose();
      this._screen.texture.dispose();
    }

    if (this.shell) {
       this.shell.traverse((child) => {
          if (child.isMesh) disposeNode(child);
       });
    }

    const ioIndex = this.interactiveObjects.indexOf(this.hitbox);
    if (ioIndex > -1) this.interactiveObjects.splice(ioIndex, 1);
  }

  // ── Utilities ────────────────────────────────────────────────────────

  /**
   * Get the physical width of this fixture in scene units (meters).
   * Used by generators for spacing.
   */
  static getFixtureWidth(fixtureDef) {
    if (!fixtureDef || !fixtureDef.dimensions) return 0.3; // default par width
    return (fixtureDef.dimensions.width || 100) * 0.001;
  }

  static getFixtureHeight(fixtureDef) {
    if (!fixtureDef || !fixtureDef.dimensions) return 0.3;
    return (fixtureDef.dimensions.height || 100) * 0.001;
  }

  // SpotLight management delegated to light_pool.js
}

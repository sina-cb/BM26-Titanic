/**
 * animate.js — Main render/animation loop with gradient and Pixelblaze lighting.
 */
import {
  controls, composer, renderer, params,
  frameCount, lastFpsTime, setFrameCount, setLastFpsTime,
  lightingEnabled, lightingMode, engineReady, engineEnabled,
  scene, selectedFixtureIndices, selectedDmxIndices
} from "./state.js";
import { generatePixelMap } from "../dmx/pixelblaze_model_exporter.js";
import { pixelInView } from "../dmx/view_registry.js";
import { isStaticHost, logStaticHostSkip } from "./static_host.js";
import { demapSacnToPixels, mapPixelsToSacn } from "../dmx/sacn_mapper.js";
import { getProfileDef } from "./profile_registry.js";
import { applyCanvasVisibility } from "./canvas_visibility.js";
import { updateLightPool } from "./light_pool.js";
import { scaleSimulationPreviewRgb } from "./sim_preview.js";
import PatchManager from "../dmx/patch_manager.js";
import { engineHttpUrl } from "./engine_endpoint.js";
import { applyFixtureOutputOverrides, applyDmxEntryOutputGate } from "../dmx/dmx_output_overrides.js";
import { blendEntryRgbwau } from "./rgbwau_blend.js";
import { entryPaintsDirect } from "./render_paint_rule.js";
import { ledOutputScale } from "./group_lock.js";
import { buildGradientLut } from "./color_transition.js";
import { createLowFpsAlarm, LOW_FPS_THRESHOLD, LOW_FPS_SUSTAIN_SECONDS } from "./low_fps_alarm.js";
import { dotDrawnRadius, writeDotMatrix } from "./pixel_dot_geometry.js";
import { adapterWarningText, adapterLogLine } from "./gpu_adapter.js";
// sACN output — lazily initialized

// ─── Per-frame pixel observers (2D Pixel Map, future taps) ────────────────
// Listeners fire once per rendered frame AFTER every color source has written
// r/g/b/w/a/u onto the entries — so a subscriber sees exactly what the 3D GPU
// flush saw. Kept a Set so subscribe/unsubscribe is O(1).
const _pixelFrameListeners = new Set();

/**
 * Subscribe to the per-frame pixel list. `fn(list, builtVersion)` is called
 * once per rendered frame; `list` is the live _batchRenderList (or null when
 * there are no pixels), `builtVersion` bumps whenever topology is rebuilt.
 * Returns an unsubscribe function.
 */
export function onPixelFrame(fn) {
  _pixelFrameListeners.add(fn);
  return () => _pixelFrameListeners.delete(fn);
}

function _dispatchPixelFrame() {
  if (_pixelFrameListeners.size === 0) return;
  for (const fn of _pixelFrameListeners) {
    try {
      fn(_batchRenderList, _batchLastBuiltVersion);
    } catch (err) {
      // Never let a listener bug kill the 3D render loop. Drop the offender
      // (its view visibly freezes — that IS the loud failure) and keep going.
      console.error('[PixelFrame] listener threw — unsubscribed (fix the listener):', err);
      _pixelFrameListeners.delete(fn);
    }
  }
}

// Warning banner + patch state managed by PatchManager (../dmx/patch_manager.js)

// Cached gradient LUT — rebuilt when stops change. Perceptual (OKLCH,
// shortest hue arc, gamut-mapped) via color_transition.js; replaced the old
// per-pixel chroma.js CIELAB scale (2026-07-24), which both bent hues in the
// blue region and allocated a chroma Color object per pixel per frame.
// POWER OF TWO so the per-pixel sample is a mask, not a bounds check.
const GRADIENT_LUT_SIZE = 1024;
const GRADIENT_LUT_MASK = GRADIENT_LUT_SIZE - 1;
let gradientLut = null;
let lastStopsKey = '';

function getGradientLut() {
  const stops = params.gradientStops || ['#8cc0ff', '#cc8cff'];
  const key = stops.join(',');
  if (key !== lastStopsKey || !gradientLut) {
    gradientLut = buildGradientLut(stops, GRADIENT_LUT_SIZE);
    lastStopsKey = key;
  }
  return gradientLut;
}

// ─── Metadata-Aware Batch Cache ──────────────────────────────────────────
// One ordered render list, rebuilt only when topology/metadata changes.
let _batchRenderList = null;    // Array of { apply(r,g,b) }
let _batchCoords = null;        // Float32Array (3 floats per pixel: nx,ny,nz)
let _batchMeta = null;          // Int32Array (4 ints per pixel: c,s,f,v)
let _batchCacheVersion = 0;
let _batchLastBuiltVersion = -1;

// ─── Native Hardware Mapping Pipeline (V2 InstancedMesh) ───
let _pixelInstancedMesh = null;
const _pixelMatrixCache = new THREE.Matrix4();
const _pixelColorCache = new THREE.Color();
const _pixelTransformObj = new THREE.Object3D(); // For easy local-to-world extraction
// View-isolation state for the instanced dots: blackening a non-member
// instance is not enough — the dot material is opaque MeshBasicMaterial,
// so a black instance renders as a solid black sphere (a visible
// "body"). While isolation is active we zero-scale non-member instance
// matrices every frame (membership can change live via Assign/Unassign),
// and run exactly one restore pass when isolation exits.
let _isolationWasActive = false;
// Tracks headless (2d_pixels) enter/exit so we toggle the 3D canvas once.
let _headlessLatched = false;

/** Increment cache version — call when topology, position, or metadata changes. */
window.invalidateMarsinBatchCache = function(reason) {
  _batchCacheVersion++;
  // console.log(`[BatchCache] Invalidated: ${reason} (v${_batchCacheVersion})`);
};

/** Rescale the V2 InstancedMesh dots when the global pixel scale slider changes. */
window.updatePixelInstancedScale = function(newScale) {
  if (!_pixelInstancedMesh || !_batchRenderList) return;
  const n = _batchRenderList.length;
  for (let i = 0; i < n; i++) {
    const e = _batchRenderList[i];
    // DRAWN position + radius — never the physical x/y/z + pixelSize. See
    // pixel_dot_geometry.js for why the distinction exists.
    writeDotMatrix(_pixelInstancedMesh, i, e, dotDrawnRadius(e, newScale), _pixelTransformObj);
  }
  _pixelTransformObj.scale.setScalar(1); // reset for future use
  _pixelInstancedMesh.instanceMatrix.needsUpdate = true;
};

import * as THREE from "three";

/** Rebuild the ordered render list, coordinate buffer, and metadata buffer. */
function _rebuildBatchCache() {
  try {
    const { pixels } = generatePixelMap();
    const list = [];
    pixels.forEach(px => {
       list.push({
         r: 0, g: 0, b: 0, w: 0, a: 0, u: 0, // default black (RGBWAU)
         ...px,
         wx: px.x, wy: px.y, wz: px.z // keep w coordinates for backward compatibility in interpolation
       }); // Clone the pixel directly, including the bound `apply` function and patch maps
    });

  // ─── Normalize coordinates to [0,1] ────────────────────────
  const n = list.length;
  
  // Clean up old instanced mesh
  if (_pixelInstancedMesh) {
     scene.remove(_pixelInstancedMesh);
     if (_pixelInstancedMesh.geometry) _pixelInstancedMesh.geometry.dispose();
     if (_pixelInstancedMesh.material) _pixelInstancedMesh.material.dispose();
     _pixelInstancedMesh = null;
  }

  if (n === 0) {
    _batchRenderList = null;
    _batchCoords = null;
    _batchMeta = null;
    _batchLastBuiltVersion = _batchCacheVersion;
    return;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const e of list) {
    if (e.wx < minX) minX = e.wx; if (e.wx > maxX) maxX = e.wx;
    if (e.wy < minY) minY = e.wy; if (e.wy > maxY) maxY = e.wy;
    if (e.wz < minZ) minZ = e.wz; if (e.wz > maxZ) maxZ = e.wz;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  _batchCoords = new Float32Array(n * 3);
  _batchMeta = new Int32Array(n * 4);

  for (let i = 0; i < n; i++) {
    const e = list[i];
    _batchCoords[i * 3]     = (e.wx - minX) / rangeX;
    _batchCoords[i * 3 + 1] = (e.wy - minY) / rangeY;
    _batchCoords[i * 3 + 2] = (e.wz - minZ) / rangeZ;
    _batchMeta[i * 4]       = e.cId;
    _batchMeta[i * 4 + 1]   = e.sId;
    _batchMeta[i * 4 + 2]   = e.fId;
    _batchMeta[i * 4 + 3]   = e.vMask;
  }

  // ─── Build V2 InstancedMesh ─────────────────────────────────
  // Unit sphere — all sizing is done via per-instance scale matrices
  // using each pixel's own size from the fixture model YAML.
  const dotGeo = new THREE.SphereGeometry(1.0, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // Draws normally with depth test
  _pixelInstancedMesh = new THREE.InstancedMesh(dotGeo, dotMat, n);
  
  const globalScale = params.globalPixelScale || 1.0;
  for (let i = 0; i < n; i++) {
     const e = list[i];
     // DRAWN position + radius (pixel_dot_geometry.js) — never the physical
     // x/y/z + pixelSize, which describe the real rig, not the drawing of it.
     writeDotMatrix(_pixelInstancedMesh, i, e, dotDrawnRadius(e, globalScale), _pixelTransformObj);
     _pixelColorCache.setRGB(0, 0, 0); // start black
     _pixelInstancedMesh.setColorAt(i, _pixelColorCache);
  }
  _pixelTransformObj.scale.setScalar(1); // reset for future use
  _pixelInstancedMesh.instanceMatrix.needsUpdate = true;
  if (_pixelInstancedMesh.instanceColor) _pixelInstancedMesh.instanceColor.needsUpdate = true;
  _pixelInstancedMesh.visible = true; // Visibility dynamically managed in animate()
  scene.add(_pixelInstancedMesh);

  _batchRenderList = list;
  _batchLastBuiltVersion = _batchCacheVersion;

  // Recompute patch state after every cache rebuild
  PatchManager.recompute();
  } catch (err) {
    console.error('[BatchCache] Failed to build render list:', err);
    _batchRenderList = null;
    _batchCoords = null;
    _batchMeta = null;
    _batchLastBuiltVersion = _batchCacheVersion; // prevent retry-loop
  }
}
// ─── Unpatched-red overlay helpers ───────────────────────────────────────
// Tracks whether the overlay ran last frame so a single reset pass clears the
// red tint the frame after it is switched off (then we stop touching bodies).
let _unpatchedOverlayWasActive = false;

function _fixtureIsUnpatched(fixture) {
  const u = Math.floor(Number(fixture?.config?.dmxUniverse));
  const a = Math.floor(Number(fixture?.config?.dmxAddress));
  return !(Number.isFinite(u) && u >= 1 && Number.isFinite(a) && a >= 1);
}

function _tintUnpatched(list, selectedSet, show) {
  if (!list) return;
  for (const fixture of list) {
    if (!fixture || typeof fixture.setUnpatchedRed !== 'function') continue;
    // Selection tint owns the body color — leave selected fixtures alone.
    if (selectedSet && selectedSet.has(fixture.index)) continue;
    fixture.setUnpatchedRed(show && _fixtureIsUnpatched(fixture));
  }
}

function _applyUnpatchedRedOverlay() {
  const show = !!params.showUnpatchedRed;
  if (!show && !_unpatchedOverlayWasActive) return; // nothing to do / already cleared
  _tintUnpatched(window.parFixtures, selectedFixtureIndices, show);
  _tintUnpatched(window.dmxSceneFixtures, selectedDmxIndices, show);
  _unpatchedOverlayWasActive = show;
}

// ─── LED-strand last-layer output gate ────────────────────────────────────
// The LED analogue of applyFixtureOutputOverrides: apply the GLOBAL LED master
// (params.strandsEnabled) and each strand's per-group master (On/Off +
// Brightness, params.ledGroupOverrides) to the entry's rendered RGBWAU IN PLACE,
// for LED entries only. Runs AFTER every color source (pattern / gradient / sACN
// demap) has written the entry colors and BEFORE every consumer that reads the
// RAW entry color — the sACN output map (mapPixelsToSacn), the global
// instanced-dot flush, and the 2D Pixel Map frame tap — so an OFF group or
// master is BLACK on EVERY path, not only the per-strand bulb/halo meshes (which
// the exporter apply closure + the static preview already scale). Keyed by
// entry.displayGroup — the 'Ungrouped'-bucket key the GUI master writes under,
// NOT the name-based entry.group used for section/view numbering. Off ⇒ 0;
// brightness scales linearly; a full-on group (scale 1) is left untouched so
// there is zero behavior change when nothing is disabled.
function _applyLedOutputGate(list) {
  if (!list) return;
  const strandsEnabled = params.strandsEnabled;
  const overrides = params.ledGroupOverrides;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || entry.type !== 'led') continue;
    const s = ledOutputScale(strandsEnabled, overrides, entry.displayGroup);
    if (s >= 1) continue;
    if (s <= 0) {
      entry.r = 0; entry.g = 0; entry.b = 0;
      entry.w = 0; entry.a = 0; entry.u = 0;
      continue;
    }
    entry.r *= s; entry.g *= s; entry.b *= s;
    entry.w *= s; entry.a *= s; entry.u *= s;
  }
}

// ─── DMX last-layer output gate (rendered-color side) ─────────────────────
// `applyFixtureOutputOverrides` makes the DMX group/fixture master real on the
// UNIVERSE BUFFER — which covers the sACN output and, through applyDmxFrame(),
// the patched fixture bulbs. It does NOT cover the consumers that read the RAW
// _batchRenderList entry color: the global V2 instanced-dot flush and the 2D
// Pixel Map frame tap. And when NOTHING is patched (window._patchesActive ===
// false — the state the titanic show scene ships in) it covers nothing at all:
// it skips every fixture whose universe < 1, so the bulbs, painted directly
// from the entry by entry.apply(), stay lit too. Measured pre-fix on the live
// show scene: group Off left entry, 2D decode, dot and bulb ALL at their full
// ON values (report 20260724_40).
//
// This runs AFTER every color source AND AFTER applyFixtureOutputOverrides /
// applyDmxFrame — never before mapPixelsToSacn, or a dimmed group would be
// scaled twice on the wire (once here, once on the buffer) — and BEFORE the
// dot flush and the 2D tap. `entry.fixtureConfig` is the live config object the
// buffer gate reads, so the two can never key differently.
let _dmxGateConfigWarned = false;

function _applyDmxOutputGate(list, headless) {
  if (!list) return;
  const overrides = params.groupOverrides;
  const patchesActive = window._patchesActive;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || entry.type !== 'dmx') continue;
    if (!entry.fixtureConfig) {
      // A DMX pixel with no config handle cannot be gated — say so once, loudly
      // (codex P0: never fail silently), then keep the render loop alive.
      if (!_dmxGateConfigWarned) {
        _dmxGateConfigWarned = true;
        console.error(`[DmxOutputGate] DMX pixel '${entry.name}' carries no fixtureConfig — ` +
          'its group/fixture master CANNOT be applied to the dots or the 2D map. The exporter ' +
          'must attach it (pixelblaze_model_exporter.js).');
      }
      continue;
    }
    const scale = applyDmxEntryOutputGate(entry, overrides);
    if (scale >= 1) continue;
    // While unpatched a DMX entry paints its fixture visual DIRECTLY (the color
    // sources already called apply() with the un-gated color this frame), and
    // no universe buffer exists to gate. Repaint from the gated color so the
    // bulb/halo/cone match the dots. Patched entries never take this branch —
    // applyDmxFrame owns their visual, from the already-gated buffer.
    if (!headless && entry.apply && entryPaintsDirect(entry, patchesActive)) {
      const [rn, gn, bn] = blendEntryRgbwau(entry);
      entry.apply(rn, gn, bn);
    }
  }
}

// Sustained-low-FPS latch. A slow badge is easy to shrug off; ten straight
// seconds under 20 FPS is a broken measurement environment, and the ONE fact
// that explains it (which GPU is rendering) has to be in the same log line —
// see report `20260725_38`, where a sustained 10 FPS was hunted through the
// render path for a session and turned out to be the Intel iGPU. Fires once.
const _lowFpsAlarm = createLowFpsAlarm(LOW_FPS_THRESHOLD, LOW_FPS_SUSTAIN_SECONDS);

export function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // FPS counter
  setFrameCount(frameCount + 1);
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    const fpsEl = document.getElementById("fps-counter");
    if (fpsEl) {
      fpsEl.textContent = `${frameCount} FPS`;
      // Color bands match HUD theme: green ≥30 (good), amber 15–29 (ok), red <15 (poor).
      const quality = frameCount >= 30 ? "good" : frameCount >= 15 ? "ok" : "poor";
      if (fpsEl.dataset.quality !== quality) fpsEl.dataset.quality = quality;
    }
    if (_lowFpsAlarm.sample(frameCount)) {
      // `window.__gpuAdapter` is set at boot by detectGpuAdapter(). Naming it
      // here covers the case the banner cannot: the RIGHT (discrete) adapter,
      // contended by something else — leftover probe windows, another sim tab.
      const adapter = window.__gpuAdapter;
      console.error(
        `[LowFPS] ${frameCount} FPS — under ${LOW_FPS_THRESHOLD} FPS for ` +
        `${LOW_FPS_SUSTAIN_SECONDS} consecutive seconds. ` +
        `${adapterLogLine(adapter, window.__rendererMode)}. ` +
        `${adapterWarningText(adapter) || 'The adapter looks correct — check for other windows ' +
          'or apps contending for the GPU (close leftover probe browsers and extra sim tabs).'}`,
      );
    }
    setFrameCount(0);
    setLastFpsTime(now);
  }

  // Headless (2d_pixels) profile: run the engine + DMX + 2D pixel tap, but
  // skip every per-frame GPU 3D operation (scene render, bloom, shadows,
  // spotlight pool, instanced-dot flush, fixture visuals) so the sim runs
  // light on a no-GPU box. Color computation for pixels/sACN still happens.
  const _headless = !!getProfileDef(params.lightingProfile).headless;

  // Headless (2d_pixels) enter/exit — the single, authoritative switch between
  // the 3D view and the 2D Pixel Map (the profile dropdown handler doesn't call
  // onLightingChange, so this per-frame latch is what makes EVERY entry path —
  // dropdown, URL, boot — behave). On enter: hide the 3D canvas (page goes truly
  // black, body is #000) at ZERO GPU cost and show the full-screen 2D map. On
  // exit: un-hide the canvas (composer.render() resumes next frame) and hide the
  // 2D map — the 3D vis comes right back. No renderer guard: it exists before
  // the first frame (a missing one is a boot bug that must crash, per repo P0).
  //
  // This latch is EDGE-triggered, and that is exactly how the "dark ghost ship"
  // got on screen: split_layout's resize handler re-showed the canvas behind the
  // 2D map and the latch, already latched, never took it back. So the hide now
  // goes through canvas_visibility.applyCanvasVisibility, which BOTH obeys the
  // profile veto and CLEARS the framebuffer on the way out — after this there is
  // no stale 3D frame left for any caller to reveal.
  if (_headless !== _headlessLatched) {
    applyCanvasVisibility(renderer, params.lightingProfile, true);
    if (window.showPixelMap2d) window.showPixelMap2d(_headless);
    _headlessLatched = _headless;
  }
  // Belt on the latch: split_layout and other resize paths re-ask for a visible
  // canvas every frame. Re-apply the headless veto so a stale 3D hull can never
  // sit behind the 2D map after layout settles (report 20260815_265).
  if (_headless) applyCanvasVisibility(renderer, params.lightingProfile, true);

  // ─── Gradient Mode (OKLCH perceptual interpolation, LUT-sampled) ───
  if (lightingEnabled && lightingMode === 'gradient' && getProfileDef(params.lightingProfile).mappingEnabled) {
    const lut = getGradientLut();
    const speed = (params.waveSpeed || 0.3) * 0.001;
    const t = now * speed;

    // Ensure batch cache is fresh so we can map gradient to the unified _batchRenderList
    if (_batchCacheVersion !== _batchLastBuiltVersion) _rebuildBatchCache();

    if (_batchRenderList && _batchRenderList.length > 0) {
      const count = _batchRenderList.length;
      for (let i = 0; i < count; i++) {
         const entry = _batchRenderList[i];
         const phase = ((entry.nx || 0) + (entry.ny || 0) + t) % 1.0;
         // Allocation-free LUT sample; mask handles the phase===1.0 edge.
         const off = ((phase * GRADIENT_LUT_SIZE) & GRADIENT_LUT_MASK) * 3;
         const r = lut[off], g = lut[off + 1], b = lut[off + 2];
         entry.r = r; entry.g = g; entry.b = b;
         entry.w = 0; entry.a = 0; entry.u = 0; // standard colors
         // Locally rendered lanes supersede any wire-derived strand preview
         // cached by the sACN-in demap (see rgbwau_blend.blendEntryRgbwau).
         if (entry._ledWirePreview) entry._ledWirePreview = null;
         // Direct-paint when unpatched OR an LED strand (LEDs have no wire
         // read-back — see render_paint_rule.js). Headless skips the visual write.
         if (entryPaintsDirect(entry, window._patchesActive) && entry.apply && !_headless) entry.apply(r, g, b);
      }
    }
  }

  // ─── Pixelblaze Pattern Engine (Metadata-Aware Batch Pipeline) ───
  if (engineReady && engineEnabled && getProfileDef(params.lightingProfile).mappingEnabled) {
    const elapsed = now * 0.001;
    const patternEngine = window.patternEngine;
    patternEngine.beginFrame(elapsed);

    // Ensure batch cache is fresh
    if (_batchCacheVersion !== _batchLastBuiltVersion) {
      _rebuildBatchCache();
    }

    if (_batchRenderList && _batchRenderList.length > 0) {
      const pixelCount = _batchRenderList.length;
      const result = patternEngine.renderAllWithMeta6ch(
        pixelCount, _batchCoords, _batchMeta
      );

      // Apply RGBWAU results by walking the same render list
      for (let i = 0; i < pixelCount; i++) {
        const entry = _batchRenderList[i];
        const off = i * 6;
        const R = result[off], G = result[off + 1], B = result[off + 2];
        const W = result[off + 3], A = result[off + 4], U = result[off + 5];

        // Capture raw colors logically for sACN mapping
        entry.r = R / 255; entry.g = G / 255; entry.b = B / 255;
        entry.w = W / 255; entry.a = A / 255; entry.u = U / 255;
        // Locally rendered lanes supersede any wire-derived strand preview
        // cached by the sACN-in demap (see rgbwau_blend.blendEntryRgbwau).
        if (entry._ledWirePreview) entry._ledWirePreview = null;

        // Direct-paint when unpatched OR an LED strand (LEDs have no wire
        // read-back — see render_paint_rule.js). When a DMX entry is patched the
        // DMX router path repaints it from the universe buffer instead.
        // Headless skips the visual write (nothing renders); colors still stored above.
        if (entryPaintsDirect(entry, window._patchesActive) && entry.apply && !_headless) {
          const [rn, gn, bn] = blendEntryRgbwau(entry);
          entry.apply(rn, gn, bn);
        }
      }
    }
  }
  // ─── Clear Pixels if Lighting Disabled ───
  if (!lightingEnabled) {
    if (_batchCacheVersion !== _batchLastBuiltVersion) {
      _rebuildBatchCache();
    }
    if (_batchRenderList && _batchRenderList.length > 0) {
      const count = _batchRenderList.length;
      for (let i = 0; i < count; i++) {
        const entry = _batchRenderList[i];
        entry.r = 0; entry.g = 0; entry.b = 0;
        entry.w = 0; entry.a = 0; entry.u = 0;
        if (entry._ledWirePreview) entry._ledWirePreview = null;
        // Clear the visual too — LED strands included, so a patched strand goes
        // black when lighting is disabled instead of freezing (see render_paint_rule.js).
        if (entryPaintsDirect(entry, window._patchesActive) && entry.apply && !_headless) {
          entry.apply(0, 0, 0);
        }
      }
    }
  }

  // ─── DMX Router: merge sources and apply to fixtures ───
  if (window.dmxRouter) {
    // Always process frame so sources stay fresh
    window.dmxRouter.processFrame();


    const mappingEnabled = getProfileDef(params.lightingProfile).mappingEnabled;

    // In sacn_in mode, demap only if lighting is enabled — the simulation is a
    // VISUALIZER here, never a bridge: the sim SERVER routes to the controllers
    // and this window only paints what it receives, regardless of which lighting
    // profile is active.
    if (lightingEnabled && lightingMode === 'sacn_in') {
      if (_batchCacheVersion !== _batchLastBuiltVersion) {
        _rebuildBatchCache();
      }
      // The undriven-entry treatment answers to the SAME switch as the other
      // two unpatched indicators below (_applyUnpatchedRedOverlay's shell tint
      // and the instanced-dot flush): red when on, black when off. Read fresh
      // every frame so flipping the toggle repaints on the next one.
      demapSacnToPixels(_batchRenderList, window.dmxRouter, !!params.showUnpatchedRed);
      // LED master/group blackout AFTER the demap writes entry colors, BEFORE
      // the global flush + 2D tap read them.
      _applyLedOutputGate(_batchRenderList);

    } else if (mappingEnabled) {
      if (_batchCacheVersion !== _batchLastBuiltVersion) {
        _rebuildBatchCache();
      }
      // Gate BEFORE mapping so the LED sACN OUTPUT honors an OFF master/group
      // too (parity with applyFixtureOutputOverrides zeroing DMX universe bytes).
      _applyLedOutputGate(_batchRenderList);
      if (window._patchesActive) {
         // Only write to DMX router when patches exist (avoid writing to unmapped addresses)
         mapPixelsToSacn(_batchRenderList, window.dmxRouter);
      }
    }

    // Last-layer operator override — runs AFTER the router merge and AFTER
    // map/demap have (re)written the universe buffers, but BEFORE fixtures
    // sample the frame for the preview and BEFORE the sACN-out send reads the
    // same buffers below. This is the unbeatable final stage: blackout (off)
    // or brightness-scale each fixture's channels on the live output.
    applyFixtureOutputOverrides(window.dmxRouter, [window.dmxSceneFixtures, window.parFixtures], params.groupOverrides);


    const applyDmx = (fixtureList) => {
      if (!fixtureList) return;
      for (const fixture of fixtureList) {
        if (!fixture) continue;
        if (fixture.applyDmxFrame) {
          const fType = fixture.fixtureDef?.fixtureType || fixture.config?.type || fixture.config?.fixtureType || '';
          const isGlobalEffect = fType.includes('Fog') || fType === 'ChauvetHaze4D' || fType.includes('Horn') || fType.includes('Fire');
          
          if (!mappingEnabled && !isGlobalEffect) continue;

          const patchUniverse = Math.floor(Number(fixture.patchDef?.universe || fixture.config?.dmxUniverse));
          const patchAddr = Math.floor(Number(fixture.patchDef?.addr || fixture.config?.dmxAddress));
          if (!Number.isFinite(patchUniverse) || patchUniverse < 1) continue;
          if (!Number.isFinite(patchAddr) || patchAddr < 1) continue;
          
          const dmxFrame = window.dmxRouter.getFullFrame(patchUniverse);
          if (dmxFrame) {
            fixture.applyDmxFrame(dmxFrame.subarray(patchAddr - 1));
          }
        }
      }
    };
    applyDmx(window.dmxSceneFixtures);
    applyDmx(window.parFixtures);
  }

  // ─── DMX group/fixture master on the RENDERED color ───────────────────────
  // Last layer, outside the router block (it must run even with no router /
  // nothing patched — that is exactly when the buffer gate does nothing) and
  // ahead of BOTH raw-entry consumers below: the instanced-dot flush and the
  // 2D Pixel Map tap.
  _applyDmxOutputGate(_batchRenderList, _headless);

  // ─── V2 InstancedMesh Raw Flush ─────────────────────────
  // Streams all colors computed in the current frame straight to GPU
  if (_pixelInstancedMesh && getProfileDef(params.lightingProfile).mappingEnabled && !_headless) {
     const count = _batchRenderList.length;
     const activeView = window.__activePreviewView;
     // Update instance matrices while isolating (and once on exit to
     // restore) — see _isolationWasActive above for why color alone
     // can't hide the dots.
     const touchMatrices = !!activeView || _isolationWasActive;
     const globalScale = params.globalPixelScale || 1.0;
     for (let i = 0; i < count; i++) {
        const entry = _batchRenderList[i];

         let rn = 0, gn = 0, bn = 0;

         // Word-aware bit test: `pixelInView` reads `vMask` for a word-0 view
         // and `vMaskHi` for a word-1 one (the exporter carries both onto
         // every entry). A flat `entry.vMask` test isolated the wrong dots
         // for any word-1 view.
         const isIsolated = activeView && !(pixelInView(entry, activeView) || (activeView.groups && activeView.groups.includes(entry.group)));

         if (touchMatrices) {
            // DRAWN position + radius (pixel_dot_geometry.js); isolation still
            // hides a non-member instance by zero-scaling its matrix.
            const worldRadius = isIsolated ? 0 : dotDrawnRadius(entry, globalScale);
            writeDotMatrix(_pixelInstancedMesh, i, entry, worldRadius, _pixelTransformObj);
         }

         if (!isIsolated) {
            if (!window._patchesActive) {
               // All-unpatched direct mode: show pattern colors
               [rn, gn, bn] = blendEntryRgbwau(entry);
            } else if (!entry.patch || !entry.patch.universe || entry.patch.universe <= 0) {
               // Mixed mode: unpatched pixels stay black — unless the operator
               // has enabled the unpatched-red overlay (a sim-only diagnostic;
               // these pixels carry no patch, so nothing reaches sACN/DMX).
               if (params.showUnpatchedRed) { rn = 0.8; gn = 0; bn = 0; }
               else { rn = 0; gn = 0; bn = 0; }
            } else {
               [rn, gn, bn] = blendEntryRgbwau(entry);
            }
         }
        
        const [previewR, previewG, previewB] = scaleSimulationPreviewRgb(rn, gn, bn);
        _pixelColorCache.setRGB(previewR, previewG, previewB);
        _pixelInstancedMesh.setColorAt(i, _pixelColorCache);
     }
     
     if (_pixelInstancedMesh.instanceColor) {
         _pixelInstancedMesh.instanceColor.needsUpdate = true;
     }
     if (touchMatrices) {
         _pixelInstancedMesh.instanceMatrix.needsUpdate = true;
         _pixelTransformObj.scale.setScalar(1);
     }
     _isolationWasActive = !!activeView;
     _pixelInstancedMesh.visible = true;
  } else if (_pixelInstancedMesh) {
     _pixelInstancedMesh.visible = false;
  }

  // ─── Per-frame pixel observers (2D Pixel Map) ───
  // Entries' r/g/b/w/a/u are final for the frame at this point (every color
  // source and the GPU flush have run); hand them to any live 2D taps.
  _dispatchPixelFrame();

  // Visual animations of fixtures — skipped in headless (nothing renders).
  const updateVisuals = (fixtureList) => {
    if (!fixtureList) return;
    for (const fixture of fixtureList) {
      if (fixture && fixture.update) fixture.update();
    }
  };
  if (!_headless) {
    updateVisuals(window.dmxSceneFixtures);
    updateVisuals(window.parFixtures);
  }

  // ─── Unpatched-red overlay (sim-only diagnostic) ───
  // Tints the bodies of fixtures with no valid DMX patch red so the
  // operator can spot what still needs mapping. Purely cosmetic — it
  // never touches the DMX router or sACN output (unpatched fixtures have
  // no universe/address to send to). Selected fixtures keep their
  // selection tint, which owns the body color.
  _applyUnpatchedRedOverlay();

  // ─── sACN Blackout Trigger ───
  if (!window.triggerSacnBlackout) {
    window.triggerSacnBlackout = async () => {
      const btn = document.getElementById('sacn-out-blackout-btn');
      const nextState = !window._sacnBlackoutActivated;

      if (isStaticHost()) {
        logStaticHostSkip('engine /global-blackout (port 6968)');
        return;
      }

      try {
        if (btn) btn.style.opacity = '0.5';
        const response = await fetch(engineHttpUrl('/global-blackout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: nextState }),
        });
        if (response.ok) {
          // The WebSocket in engine_blackout_warning.js will receive the update
          // and we can optionally update local state here as a fallback
        }
      } catch (err) {
        console.error("Failed to toggle engine blackout:", err);
      } finally {
        if (btn) btn.style.opacity = '1';
      }
    };
  }

  // ─── sACN Output: GONE. The browser is not the router. ───
  //
  // Operator ruling 2026-08-05: engine → sim SERVER → controllers. This window
  // renders, monitors and controls; it does not put packets on the wire, and
  // there is no code here that could. What used to live at this point was a
  // per-frame loop that unicast every patched universe to its real controller
  // at priority 150 through :6972 (`_160` T4/T5) — a second writer on the
  // browser's own clock, so background-tab throttling froze the rig on one
  // stale frame while the show looked alive.
  //
  // The two things that legitimately needed it were rehoused, not dropped:
  //   • "Hold to Fog" now POSTs the engine's `/fog` (gui_builder.js), which
  //     writes the fog channels on the normal engine → bridge route;
  //   • browser-generator bench output (gradient / pixelblaze driving fixtures
  //     with no engine) was retired with the operator's Option C.
  //
  // Do not reintroduce a transmit path here. `server/sacn_output_bridge.js`
  // refuses DMX by construction — it holds no sender — so a re-added client
  // would be silently ineffective and loudly logged, not quietly working.

  // ─── SpotLight Pool Orchestrator ───
  // Assigns the 10 closest-to-camera pixels to the pre-allocated SpotLight pool.
  // In headless (2d_pixels) we skip the spotlight pool AND the composer render
  // entirely — this is the bulk of the GPU cost we're cutting for the Pi.
  if (!_headless) {
    updateLightPool();
    composer.render();
  }
}

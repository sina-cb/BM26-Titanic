/**
 * animate.js — Main render/animation loop with gradient and Pixelblaze lighting.
 */
import chroma from "chroma-js";
import {
  controls, composer, params,
  frameCount, lastFpsTime, setFrameCount, setLastFpsTime,
  lightingEnabled, lightingMode, engineReady, engineEnabled,
  scene
} from "./state.js";
import { getSacnOutput } from "../dmx/sacn_output_client.js";
import { generatePixelMap } from "../dmx/pixelblaze_model_exporter.js";
import { isStaticHost, logStaticHostSkip } from "./static_host.js";
import { demapSacnToPixels, mapPixelsToSacn } from "../dmx/sacn_mapper.js";
import { getProfileDef } from "./profile_registry.js";
import { updateLightPool } from "./light_pool.js";
import { scaleSimulationPreviewRgb } from "./sim_preview.js";
import PatchManager from "../dmx/patch_manager.js";
// sACN output — lazily initialized
let sacnOutputClient = null;
let sacnOutputEnabled = false;

// Warning banner + patch state managed by PatchManager (../dmx/patch_manager.js)

// Cached chroma scale — rebuilt when stops change
let chromaScale = null;
let lastStopsKey = '';

function getChromaScale() {
  const stops = params.gradientStops || ['#8cc0ff', '#cc8cff'];
  const key = stops.join(',');
  if (key !== lastStopsKey) {
    chromaScale = chroma.scale(stops).mode('lab');
    lastStopsKey = key;
  }
  return chromaScale;
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
    const sizeMm = e.pixelSize || 14;
    const worldRadius = sizeMm * 0.001 * newScale;
    _pixelTransformObj.position.set(e.wx, e.wy, e.wz);
    _pixelTransformObj.scale.setScalar(worldRadius);
    _pixelTransformObj.updateMatrix();
    _pixelInstancedMesh.setMatrixAt(i, _pixelTransformObj.matrix);
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
     // Convert pixelSize (mm) to world units, apply global scale
     const sizeMm = e.pixelSize || 14; // default 14mm if missing
     const worldRadius = sizeMm * 0.001 * globalScale;
     _pixelTransformObj.position.set(e.wx, e.wy, e.wz);
     _pixelTransformObj.scale.setScalar(worldRadius);
     _pixelTransformObj.updateMatrix();
     _pixelInstancedMesh.setMatrixAt(i, _pixelTransformObj.matrix);
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
    setFrameCount(0);
    setLastFpsTime(now);
  }

  // ─── Gradient Mode (chroma.js LAB interpolation) ───
  if (lightingEnabled && lightingMode === 'gradient' && getProfileDef(params.lightingProfile).mappingEnabled) {
    const scale = getChromaScale();
    const speed = (params.waveSpeed || 0.3) * 0.001;
    const t = now * speed;
    
    // Ensure batch cache is fresh so we can map gradient to the unified _batchRenderList
    if (_batchCacheVersion !== _batchLastBuiltVersion) _rebuildBatchCache();
    
    if (_batchRenderList && _batchRenderList.length > 0) {
      const count = _batchRenderList.length;
      for (let i = 0; i < count; i++) {
         const entry = _batchRenderList[i];
         const phase = ((entry.nx || 0) + (entry.ny || 0) + t) % 1.0;
         const [r, g, b] = scale(phase).gl();
         entry.r = r; entry.g = g; entry.b = b;
         entry.w = 0; entry.a = 0; entry.u = 0; // standard colors
         // Direct mode only (all unpatched) — when patches active, DMX router handles it
         if (!window._patchesActive && entry.apply) entry.apply(r, g, b);
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

        // Direct mode only (all unpatched) — when patches active, DMX router handles it
        if (!window._patchesActive && entry.apply) {
          const rn = Math.min(1, entry.r + entry.w * 0.8 + entry.a * 0.9 + entry.u * 0.4);
          const gn = Math.min(1, entry.g + entry.w * 0.8 + entry.a * 0.6);
          const bn = Math.min(1, entry.b + entry.w * 0.8 + entry.u * 0.7);
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
        if (!window._patchesActive && entry.apply) {
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

    // In sacn_in mode, demap only if lighting is enabled — the simulation acts as a bridge/visualizer
    // regardless of which lighting profile is active
    if (lightingEnabled && lightingMode === 'sacn_in') {
      if (_batchCacheVersion !== _batchLastBuiltVersion) {
        _rebuildBatchCache();
      }
      demapSacnToPixels(_batchRenderList, window.dmxRouter);

    } else if (mappingEnabled) {
      if (_batchCacheVersion !== _batchLastBuiltVersion) {
        _rebuildBatchCache();
      }
      if (window._patchesActive) {
         // Only write to DMX router when patches exist (avoid writing to unmapped addresses)
         mapPixelsToSacn(_batchRenderList, window.dmxRouter);
      }
    }


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

  // ─── V2 InstancedMesh Raw Flush ─────────────────────────
  // Streams all colors computed in the current frame straight to GPU
  if (_pixelInstancedMesh && getProfileDef(params.lightingProfile).mappingEnabled) {
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

         const isIsolated = activeView && !(((entry.vMask || 0) & activeView.bit) !== 0 || (activeView.groups && activeView.groups.includes(entry.group)));

         if (touchMatrices) {
            const worldRadius = (entry.pixelSize || 14) * 0.001 * globalScale;
            _pixelTransformObj.position.set(entry.wx, entry.wy, entry.wz);
            _pixelTransformObj.scale.setScalar(isIsolated ? 0 : worldRadius);
            _pixelTransformObj.updateMatrix();
            _pixelInstancedMesh.setMatrixAt(i, _pixelTransformObj.matrix);
         }

         if (!isIsolated) {
            if (!window._patchesActive) {
               // All-unpatched direct mode: show pattern colors
               rn = Math.min(1, (entry.r||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.9 + (entry.u||0) * 0.4);
               gn = Math.min(1, (entry.g||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.6);
               bn = Math.min(1, (entry.b||0) + (entry.w||0) * 0.8 + (entry.u||0) * 0.7);
            } else if (!entry.patch || !entry.patch.universe || entry.patch.universe <= 0) {
               // Mixed mode: unpatched pixels stay black
               rn = 0; gn = 0; bn = 0;
            } else {
               rn = Math.min(1, (entry.r||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.9 + (entry.u||0) * 0.4);
               gn = Math.min(1, (entry.g||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.6);
               bn = Math.min(1, (entry.b||0) + (entry.w||0) * 0.8 + (entry.u||0) * 0.7);
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

  // Always run visual animations of fixtures regardless of DMX mode
  const updateVisuals = (fixtureList) => {
    if (!fixtureList) return;
    for (const fixture of fixtureList) {
      if (fixture && fixture.update) fixture.update();
    }
  };
  updateVisuals(window.dmxSceneFixtures);
  updateVisuals(window.parFixtures);

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
        const response = await fetch(`http://${window.location.hostname}:6968/global-blackout`, {
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

  // ─── sACN Output: send DMX to real controllers via bridge ───
  // Completely disable sACN outbound transmission if in readonly observer mode (e.g. iPad WebView)
  if (window.dmxRouter && params.parLights && !window.__readonlyMode) {
    // Lazily enable output client
    if (!sacnOutputEnabled) {
      sacnOutputClient = getSacnOutput();
      sacnOutputClient.enable();
      sacnOutputEnabled = true;
    }

    if (sacnOutputClient && sacnOutputClient.connected) {
      // Group fixtures by universe:controllerIp using deduplicated Map
      const outputGroups = new Map(); // 'universe:ip' → { universe, ip, priority }

      const isMappingOutput = !window._sacnBlackoutActivated && getProfileDef(params.lightingProfile).mappingEnabled;

      for (const config of params.parLights) {
        if (!config) continue;
        const u = config.dmxUniverse;
        const addr = config.dmxAddress;
        const ip = config.controllerIp;
        if (!u || u <= 0 || !addr || addr <= 0 || !ip || ip === '0.0.0.0') continue;

        const fType = config.fixtureType || config.type || '';
        const isEffect = fType.includes('Fog') || fType === 'ChauvetHaze4D' || fType.includes('Horn') || fType.includes('Fire') || fType.includes('Haze');

        // In sacn_in mode: relay ALL universes to controllers (simulation acts as bridge)
        // In other modes: only output when mapping is active
        // Global effects: ALWAYS output
        if (!isEffect && lightingMode !== 'sacn_in' && !isMappingOutput) continue;

        const key = `${u}:${ip}`;
        if (!outputGroups.has(key)) {
          outputGroups.set(key, { universe: u, ip, priority: 150 });
        }
      }

      // For each unique universe:ip pair, send the full universe buffer exactly ONCE
      for (const [, group] of outputGroups) {
        const fullFrame = window.dmxRouter.getFullFrame(group.universe);
        if (fullFrame) {
          sacnOutputClient.sendUniverse(group.universe, group.ip, group.priority, fullFrame);
        }
      }


    }
  }

  // ─── SpotLight Pool Orchestrator ───
  // Assigns the 10 closest-to-camera pixels to the pre-allocated SpotLight pool
  updateLightPool();

  composer.render();
}

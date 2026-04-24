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
import { demapSacnToPixels, mapPixelsToSacn } from "../dmx/sacn_mapper.js";
import { getProfileDef } from "./profile_registry.js";
import { updateLightPool } from "./light_pool.js";
import { scaleSimulationPreviewRgb } from "./sim_preview.js";
// sACN output — lazily initialized
let sacnOutputClient = null;
let sacnOutputEnabled = false;

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

/** Increment cache version — call when topology, position, or metadata changes. */
window.invalidateMarsinBatchCache = function(reason) {
  _batchCacheVersion++;
  // console.log(`[BatchCache] Invalidated: ${reason} (v${_batchCacheVersion})`);
};

import * as THREE from "three";

/** Rebuild the ordered render list, coordinate buffer, and metadata buffer. */
function _rebuildBatchCache() {
  try {
    const pixels = generatePixelMap();
    const list = [];
    pixels.forEach(px => {
       list.push({
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
  const dotGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // Draws normally with depth test
  _pixelInstancedMesh = new THREE.InstancedMesh(dotGeo, dotMat, n);
  
  for (let i = 0; i < n; i++) {
     const e = list[i];
     _pixelTransformObj.position.set(e.wx, e.wy, e.wz);
     _pixelTransformObj.updateMatrix();
     _pixelInstancedMesh.setMatrixAt(i, _pixelTransformObj.matrix);
     _pixelColorCache.setRGB(0, 0, 0); // start black
     _pixelInstancedMesh.setColorAt(i, _pixelColorCache);
  }
  _pixelInstancedMesh.instanceMatrix.needsUpdate = true;
  if (_pixelInstancedMesh.instanceColor) _pixelInstancedMesh.instanceColor.needsUpdate = true;
  _pixelInstancedMesh.visible = true; // Visibility dynamically managed in animate()
  scene.add(_pixelInstancedMesh);

  _batchRenderList = list;
  _batchLastBuiltVersion = _batchCacheVersion;
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
    document.getElementById("fps-counter").textContent = `${frameCount} FPS`;
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
         if (entry.apply) entry.apply(r, g, b);
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

        // RGBWAU → RGB blend for 3D visual preview
        const rn = Math.min(1, entry.r + entry.w * 0.8 + entry.a * 0.9 + entry.u * 0.4);
        const gn = Math.min(1, entry.g + entry.w * 0.8 + entry.a * 0.6);
        const bn = Math.min(1, entry.b + entry.w * 0.8 + entry.u * 0.7);

        if (entry.apply) entry.apply(rn, gn, bn);
      }
    }
  }

  // ─── DMX Router: merge sources and apply to fixtures ───
  if (window.dmxRouter && getProfileDef(params.lightingProfile).mappingEnabled) {
    if (_batchCacheVersion !== _batchLastBuiltVersion) {
      _rebuildBatchCache();
    }
    
    if (lightingMode === 'sacn_in') {
       // Demap incoming DMX payload to 3D pixels natively
       window.dmxRouter.processFrame(); // ensures unhandled receivers flush
       demapSacnToPixels(_batchRenderList, window.dmxRouter);
    } else {
       // Map 3D Pixelblaze patterns into outgoing DMX frame chunks 
       mapPixelsToSacn(_batchRenderList, window.dmxRouter);
    }

    const applyDmx = (fixtureList) => {
      if (!fixtureList) return;
      for (const fixture of fixtureList) {
        if (!fixture) continue;
        if (fixture.applyDmxFrame) {
          const patchUniverse = Math.floor(Number(fixture.patchDef?.universe ?? fixture.config?.dmxUniverse));
          const patchAddr = Math.floor(Number(fixture.patchDef?.addr ?? fixture.config?.dmxAddress));
          if (!Number.isFinite(patchUniverse) || patchUniverse < 1) continue;
          if (!Number.isFinite(patchAddr) || patchAddr < 1) continue;
          const u = patchUniverse;
          const addr = patchAddr;
          const dmxFrame = window.dmxRouter.getFullFrame(u);
          if (dmxFrame) {
            fixture.applyDmxFrame(dmxFrame.subarray(addr - 1));
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
     for (let i = 0; i < count; i++) {
        const entry = _batchRenderList[i];
        
        // Standardize RGB representations
        const rn = Math.min(1, (entry.r||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.9 + (entry.u||0) * 0.4);
        const gn = Math.min(1, (entry.g||0) + (entry.w||0) * 0.8 + (entry.a||0) * 0.6);
        const bn = Math.min(1, (entry.b||0) + (entry.w||0) * 0.8 + (entry.u||0) * 0.7);
        const [previewR, previewG, previewB] = scaleSimulationPreviewRgb(rn, gn, bn);
        _pixelColorCache.setRGB(previewR, previewG, previewB);
        _pixelInstancedMesh.setColorAt(i, _pixelColorCache);
     }
     
     if (_pixelInstancedMesh.instanceColor) {
         _pixelInstancedMesh.instanceColor.needsUpdate = true;
     }
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
    window.triggerSacnBlackout = () => {
      const btn = document.getElementById('sacn-out-blackout-btn');
      if (window._sacnBlackoutActivated) {
        console.log("[sACN] Resuming Output...");
        window._sacnBlackoutActivated = false;
        if (btn) {
          btn.textContent = "BLACKOUT";
          btn.style.background = "#800";
          btn.style.color = "#fff";
        }
        // Let the animation loop re-enable it naturally
      } else {
        console.log("[sACN] Blackout Triggered!");
        window._sacnBlackoutActivated = true;
        if (btn) {
          btn.textContent = "RESUME";
          btn.style.background = "#080";
          btn.style.color = "#fff";
        }
        if (sacnOutputClient && sacnOutputClient.connected) {
          const outputGroups = new Map();
          for (const config of params.parLights || []) {
            if (!config) continue;
            const u = config.dmxUniverse;
            const ip = config.controllerIp;
            if (u && ip && ip !== '0.0.0.0') {
              outputGroups.set(`${u}:${ip}`, { universe: u, ip, priority: 100 });
            }
          }
          const zeroBuffer = new Uint8Array(512);
          for (const [, group] of outputGroups) {
            sacnOutputClient.sendUniverse(group.universe, group.ip, group.priority, zeroBuffer);
          }
        }
        sacnOutputEnabled = false;
        if (sacnOutputClient) sacnOutputClient.disable();
      }
    };
  }

  // ─── sACN Output: send DMX to real controllers via bridge ───
  // Completely disable sACN outbound transmission if in readonly observer mode (e.g. iPad WebView)
  if (window.dmxRouter && params.parLights && lightingMode !== 'sacn_in' && !window._sacnBlackoutActivated && getProfileDef(params.lightingProfile).mappingEnabled && !window.__readonlyMode) {
    // Lazily enable output client
    if (!sacnOutputEnabled) {
      sacnOutputClient = getSacnOutput();
      sacnOutputClient.enable();
      sacnOutputEnabled = true;
    }

    if (sacnOutputClient && sacnOutputClient.connected) {
      // Group fixtures by universe:controllerIp using deduplicated Map
      const outputGroups = new Map(); // 'universe:ip' → { universe, ip, priority }

      // We still need to extract which IPs own which universe.
      // (This could be cached, but for now loop 1x per frame over parLights)
      for (const config of params.parLights) {
        if (!config) continue;
        const u = config.dmxUniverse;
        const addr = config.dmxAddress;
        const ip = config.controllerIp;
        if (!u || u <= 0 || !addr || addr <= 0 || !ip || ip === '0.0.0.0') continue;

        const key = `${u}:${ip}`;
        if (!outputGroups.has(key)) {
          outputGroups.set(key, { universe: u, ip, priority: 100 });
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

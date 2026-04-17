/**
 * animate.js — Main render/animation loop with gradient and Pixelblaze lighting.
 */
import chroma from "chroma-js";
import {
  controls, composer, params,
  frameCount, lastFpsTime, setFrameCount, setLastFpsTime,
  lightingEnabled, lightingMode, engineReady, engineEnabled,
} from "./state.js";
import { getSacnOutput } from "../dmx/sacn_output_client.js";

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

/** Increment cache version — call when topology, position, or metadata changes. */
window.invalidateMarsinBatchCache = function(reason) {
  _batchCacheVersion++;
  // console.log(`[BatchCache] Invalidated: ${reason} (v${_batchCacheVersion})`);
};

import * as THREE from "three";

/** Rebuild the ordered render list, coordinate buffer, and metadata buffer. */
function _rebuildBatchCache() {
  try {
  const list = [];

  // Helper to clamp metadata to uint16 range
  const clamp16 = (v) => Math.max(0, Math.min(65535, v | 0));

  // ─── Par Fixtures (first) ──────────────────────────────────
  if (window.parFixtures) {
    const _worldPos = new THREE.Vector3();
    for (const fixture of window.parFixtures) {
      if (!fixture) continue;
      const cfg = fixture.config || {};
      const cId = clamp16(cfg.controllerId || 0);
      const sId = clamp16(cfg.sectionId || 0);
      const fId = clamp16(cfg.fixtureId || 0);
      const vMask = clamp16(cfg.viewMask || 0);

      if (fixture.pixels && fixture.pixels.length > 0) {
        // Multi-pixel fixture — one entry per physical pixel
        // Need the group's world matrix for localPos → worldPos
        fixture.group.updateMatrixWorld(true);
        for (let p = 0; p < fixture.pixels.length; p++) {
          const px = fixture.pixels[p];
          // localPos is in group-local space; transform to world
          if (px.localPos) {
            _worldPos.copy(px.localPos).applyMatrix4(fixture.group.matrixWorld);
          } else {
            fixture.group.getWorldPosition(_worldPos);
          }
          const localP = p; // capture for closure
          list.push({
            wx: _worldPos.x, wy: _worldPos.y, wz: _worldPos.z,
            cId, sId, fId, vMask,
            apply: (r, g, b) => fixture.setPixelColorRGB(localP, r, g, b),
          });
        }
      } else if (fixture.light) {
        // Simple fixture — one entry for the bulb
        if (fixture.group) {
          fixture.group.getWorldPosition(_worldPos);
        } else {
          _worldPos.set(cfg.x || 0, cfg.y || 0, cfg.z || 0);
        }
        list.push({
          wx: _worldPos.x, wy: _worldPos.y, wz: _worldPos.z,
          cId, sId, fId, vMask,
          apply: (r, g, b) => {
            fixture.light.color.setRGB(r, g, b);
            if (fixture.beam && fixture.beam.material) {
              fixture.beam.material.color.setRGB(r, g, b);
            }
            if (fixture.setBulbColor) fixture.setBulbColor(r, g, b);
          },
        });
      }
    }
  }

  // ─── LED Strands (second) ──────────────────────────────────
  if (window.ledStrandFixtures) {
    for (const fixture of window.ledStrandFixtures) {
      const cfg = fixture.config || {};
      const count = cfg.ledCount || 10;
      const cId = clamp16(cfg.controllerId || 0);
      const sId = clamp16(cfg.sectionId || 0);
      const fId = clamp16(cfg.fixtureId || 0);
      const vMask = clamp16(cfg.viewMask || 0);

      const sx = cfg.startX || 0, sy = cfg.startY || 0, sz = cfg.startZ || 0;
      const ex = cfg.endX || 0, ey = cfg.endY || 0, ez = cfg.endZ || 0;

      for (let led = 0; led < count; led++) {
        const t = count > 1 ? led / (count - 1) : 0.5;
        const localLed = led; // capture for closure
        const strandFixture = fixture; // capture for closure
        list.push({
          wx: sx + (ex - sx) * t,
          wy: sy + (ey - sy) * t,
          wz: sz + (ez - sz) * t,
          cId, sId, fId, vMask,
          apply: (r, g, b) => strandFixture.setLedColorRGB(localLed, r, g, b),
        });
      }
    }
  }

  // ─── Normalize coordinates to [0,1] ────────────────────────
  const n = list.length;
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
  if (lightingEnabled && lightingMode === 'gradient' && window.parFixtures && window.parFixtures.length > 0) {
    const scale = getChromaScale();
    const speed = (params.waveSpeed || 0.3) * 0.001;
    const t = now * speed;
    const count = window.parFixtures.length;
    for (let i = 0; i < count; i++) {
      const fixture = window.parFixtures[i];
      if (!fixture) continue;
      const phase = ((i / count) + t) % 1.0;
      const [r, g, b] = scale(phase).gl();

      if (fixture.pixels && fixture.pixels.length > 0) {
        for (let p = 0; p < fixture.pixels.length; p++) {
          const subPhase = ((i / count) + (p / fixture.pixels.length) * 0.3 + t) % 1.0;
          const [sr, sg, sb] = scale(subPhase).gl();
          fixture.setPixelColorRGB(p, sr, sg, sb);
        }
      } else if (fixture.light) {
        fixture.light.color.setRGB(r, g, b);
        if (fixture.beam && fixture.beam.material) {
          fixture.beam.material.color.setRGB(r, g, b);
        }
        if (fixture.setBulbColor) fixture.setBulbColor(r, g, b);
      }
    }
  }

  // ─── Pixelblaze Pattern Engine (Metadata-Aware Batch Pipeline) ───
  if (engineReady && engineEnabled) {
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

        // RGBWAU → RGB blend (preserved from legacy per-pixel path)
        const rn = Math.min(1, (R + W * 0.8 + A * 0.9 + U * 0.4) / 255);
        const gn = Math.min(1, (G + W * 0.8 + A * 0.6) / 255);
        const bn = Math.min(1, (B + W * 0.8 + U * 0.7) / 255);

        entry.apply(rn, gn, bn);
      }
    }
  }

  // ─── DMX Router: merge sources and apply to fixtures ───
  if (window.dmxRouter) {
    window.dmxRouter.processFrame();

    // Apply DMX frames to patched fixtures (DmxFixtureRuntime objects)
    if (window.parFixtures) {
      for (const fixture of window.parFixtures) {
        if (fixture && fixture.patchDef && fixture.fixtureDef) {
          const slice = window.dmxRouter.getSlice(
            fixture.patchDef.universe,
            fixture.patchDef.addr,
            fixture.fixtureDef.totalChannels || 10
          );
          if (slice) fixture.applyDmxFrame(slice);
        }
      }
    }

    // ─── sACN Direct Apply (for legacy ParLight fixtures without patchDef) ───
    // Uses same sequential auto-pack layout as MarsinEngine:
    //   pars: 10ch each (dimmer, strobe, R, G, B, W, A, U, func, speed)
    //   LEDs: 3ch each (R, G, B)
    if (lightingMode === 'sacn_in' && window.parFixtures) {
      let patchUniverse = 1;
      let patchAddr = 1;

      for (const fixture of window.parFixtures) {
        if (!fixture) { patchAddr += 10; if (patchAddr > 502) { patchUniverse++; patchAddr = 1; } continue; }
        if (fixture.patchDef) continue; // skip already-patched runtime fixtures

        const footprint = 10; // all par fixtures are 10ch
        if (patchAddr + footprint - 1 > 512) { patchUniverse++; patchAddr = 1; }

        const slice = window.dmxRouter.getSlice(patchUniverse, patchAddr, footprint);
        if (slice && (slice[2] || slice[3] || slice[4])) {
          // Read RGB from channels 3-5 (offset 2-4 in the slice, 0-indexed)
          const rn = slice[2] / 255;
          const gn = slice[3] / 255;
          const bn = slice[4] / 255;

          if (fixture.pixels && fixture.pixels.length > 0) {
            for (let p = 0; p < fixture.pixels.length; p++) {
              fixture.setPixelColorRGB(p, rn, gn, bn);
            }
          } else if (fixture.light) {
            fixture.light.color.setRGB(rn, gn, bn);
            if (fixture.beam && fixture.beam.material) {
              fixture.beam.material.color.setRGB(rn, gn, bn);
            }
            if (fixture.setBulbColor) fixture.setBulbColor(rn, gn, bn);
          }
        }
        patchAddr += footprint;
      }

      // LED Strands
      if (window.ledStrandFixtures) {
        for (const fixture of window.ledStrandFixtures) {
          const count = fixture.config.ledCount || 10;
          const children = fixture.group.children;
          const ledStartIdx = 2;
          for (let led = 0; led < count; led++) {
            const footprint = 3;
            if (patchAddr + footprint - 1 > 512) { patchUniverse++; patchAddr = 1; }

            const slice = window.dmxRouter.getSlice(patchUniverse, patchAddr, footprint);
            if (slice) {
              const rn = slice[0] / 255;
              const gn = slice[1] / 255;
              const bn = slice[2] / 255;

              const baseIdx = ledStartIdx + led * 3;
              const bulb = children[baseIdx + 1];
              const halo = children[baseIdx + 2];
              if (bulb && bulb.material) {
                bulb.material.color.setRGB(rn, gn, bn);
              }
              if (halo && halo.material) {
                halo.material.color.setRGB(rn, gn, bn);
              }
            }
            patchAddr += footprint;
          }
        }
      }
    }
  }

  // ─── sACN Output: send DMX to real controllers via bridge ───
  if (window.dmxRouter && params.parLights) {
    // Lazily enable output client
    if (!sacnOutputEnabled) {
      sacnOutputClient = getSacnOutput();
      sacnOutputClient.enable();
      sacnOutputEnabled = true;
    }

    if (sacnOutputClient && sacnOutputClient.connected) {
      // Group fixtures by universe:controllerIp
      const outputGroups = new Map(); // 'universe:ip' → { universe, ip, priority }

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

      // For each unique universe:ip pair, send the full universe buffer
      for (const [, group] of outputGroups) {
        const fullFrame = window.dmxRouter.getFullFrame(group.universe);
        if (fullFrame) {
          sacnOutputClient.sendUniverse(group.universe, group.ip, group.priority, fullFrame);
        }
      }
    }
  }

  composer.render();
}

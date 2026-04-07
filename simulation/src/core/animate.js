/**
 * animate.js — Main render/animation loop with gradient and Pixelblaze lighting.
 */
import chroma from "chroma-js";
import {
  controls, composer, params,
  frameCount, lastFpsTime, setFrameCount, setLastFpsTime,
  lightingEnabled, lightingMode, engineReady, engineEnabled,
} from "./state.js";

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

  // ─── Pixelblaze Pattern Engine ───
  if (engineReady && engineEnabled) {
    const elapsed = now * 0.001;
    const patternEngine = window.patternEngine;
    patternEngine.beginFrame(elapsed);

    // → Par Lights + ModelFixtures
    if (window.parFixtures && window.parFixtures.length > 0) {
      let pixelOffset = 0;
      const totalFixtures = window.parFixtures.length;
      for (let i = 0; i < totalFixtures; i++) {
        const fixture = window.parFixtures[i];
        if (!fixture) { pixelOffset++; continue; }

        if (fixture.pixels && fixture.pixels.length > 0) {
          const numPixels = fixture.pixels.length;
          for (let p = 0; p < numPixels; p++) {
            const globalIdx = pixelOffset + p;
            const totalPixels = pixelOffset + numPixels;
            const t = totalPixels > 1 ? globalIdx / (totalPixels - 1) : 0.5;

            let rn, gn, bn;
            const px6 = patternEngine.renderPixel6ch(globalIdx, t, 0, 0);
            if (px6) {
              const W = px6.w || 0, A = px6.a || 0, U = px6.u || 0;
              rn = Math.min(1, (px6.r + W * 0.8 + A * 0.9 + U * 0.4) / 255);
              gn = Math.min(1, (px6.g + W * 0.8 + A * 0.6) / 255);
              bn = Math.min(1, (px6.b + W * 0.8 + U * 0.7) / 255);
            } else {
              const px = patternEngine.renderPixel(globalIdx, t, 0, 0);
              rn = px.r / 255; gn = px.g / 255; bn = px.b / 255;
            }
            fixture.setPixelColorRGB(p, rn, gn, bn);
          }
          pixelOffset += numPixels;
        } else if (fixture.light) {
          const t = totalFixtures > 1 ? pixelOffset / (totalFixtures - 1) : 0.5;
          let rn, gn, bn;
          const px6 = patternEngine.renderPixel6ch(pixelOffset, t, 0, 0);
          if (px6) {
            const W = px6.w || 0, A = px6.a || 0, U = px6.u || 0;
            rn = Math.min(1, (px6.r + W * 0.8 + A * 0.9 + U * 0.4) / 255);
            gn = Math.min(1, (px6.g + W * 0.8 + A * 0.6) / 255);
            bn = Math.min(1, (px6.b + W * 0.8 + U * 0.7) / 255);
          } else {
            const { r, g, b } = patternEngine.renderPixel(pixelOffset, t, 0, 0);
            rn = r / 255; gn = g / 255; bn = b / 255;
          }
          fixture.light.color.setRGB(rn, gn, bn);
          if (fixture.beam && fixture.beam.material) {
            fixture.beam.material.color.setRGB(rn, gn, bn);
          }
          if (fixture.setBulbColor) fixture.setBulbColor(rn, gn, bn);
          pixelOffset++;
        } else {
          pixelOffset++;
        }
      }
    }

    // → LED Strands
    if (window.ledStrandFixtures && window.ledStrandFixtures.length > 0) {
      window.ledStrandFixtures.forEach(fixture => {
        const count = fixture.config.ledCount || 10;
        const children = fixture.group.children;
        const ledStartIdx = 2; // skip wire + tube
        for (let led = 0; led < count; led++) {
          const baseIdx = ledStartIdx + led * 3;
          const bulb = children[baseIdx + 1];
          const halo = children[baseIdx + 2];
          if (!bulb || !bulb.material) continue;

          const t = count > 1 ? led / (count - 1) : 0.5;
          let rn, gn, bn;
          const px6 = patternEngine.renderPixel6ch(led, t, 0, 0);
          if (px6) {
            const W = px6.w || 0, A = px6.a || 0, U = px6.u || 0;
            rn = Math.min(1, (px6.r + W * 0.8 + A * 0.9 + U * 0.4) / 255);
            gn = Math.min(1, (px6.g + W * 0.8 + A * 0.6) / 255);
            bn = Math.min(1, (px6.b + W * 0.8 + U * 0.7) / 255);
          } else {
            const { r, g, b } = patternEngine.renderPixel(led, t, 0, 0);
            rn = r / 255; gn = g / 255; bn = b / 255;
          }
          bulb.material.color.setRGB(rn, gn, bn);
          if (halo && halo.material) {
            halo.material.color.setRGB(rn, gn, bn);
          }
        }
      });
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

  composer.render();
}

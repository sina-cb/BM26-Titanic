/**
 * sacn_mapper.js
 * Modular helper functions for Mapping and Demapping sACN packets
 */

import {
  isLedEntry,
  resolveLedWireConfig,
  ledWireBytes,
  ledPreviewRgbFromBytes,
} from './led_wire.js';

/**
 * Native strobe channel suppression — see docs/28_global_effect_macros.md §2.1.
 *
 * Engine-side software macros (Software Sync Strobe etc.) need
 * deterministic frame-locked control over fixture intensity. Every
 * supported fixture model has an internal native strobe oscillator
 * driven from a single DMX channel that, if left at a non-zero value,
 * runs in parallel with the software gate and produces beat-frequency
 * artefacts. The fix is to force those channels to 0 here, after
 * mapPixelsToSacn has filled the rest of each fixture's footprint.
 *
 * Map of fixtureType → list of relative strobe channels (1-indexed
 * from the fixture's start address). Kept narrow to the rig's actual
 * v1 fixtures so unrelated DMX devices on the same universe are
 * unaffected.
 */
const NATIVE_STROBE_CHANNELS = {
  UkingPar: [8],         // CH8 = Total Strobe
  VintageLed: [2],       // CH2 = Total Strobe
  ShehdsBar: [],         // Per docs/09 — no global strobe oscillator
  EndyshowBar: [129, 130], // RGB Strobe + ACW Strobe
};

export function suppressNativeStrobes(list, dmxRouter) {
  if (!list || !dmxRouter) return;
  const seenFixtures = new Set();
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry.patch || !entry.fixtureType) continue;
    const strobeChs = NATIVE_STROBE_CHANNELS[entry.fixtureType];
    if (!strobeChs || strobeChs.length === 0) continue;
    // Many entries (e.g. each VintageLed sub-pixel) share the same
    // patch address. Dedupe per (universe, addr) so we don't waste
    // cycles writing the same byte 33 times per frame.
    const key = `${entry.patch.universe}:${entry.patch.addr}`;
    if (seenFixtures.has(key)) continue;
    seenFixtures.add(key);
    const frame = dmxRouter.getFullFrame(entry.patch.universe);
    if (!frame) continue;
    const baseAddr = entry.patch.addr - 1; // 0-indexed
    for (const relCh of strobeChs) {
      const offset = baseAddr + relCh - 1;
      if (offset >= 0 && offset < frame.length) {
        frame[offset] = 0;
      }
    }
  }
}

/**
 * Demaps a DMX frame back into simulation pixel colors (for sacn_in)
 * @param {Object} list - The batch render list containing pixels
 * @param {Object} dmxRouter - The router containing DMX universes
 * @param {boolean} showUnpatchedRed - the operator's "Show Unpatched (Red)"
 *   switch. Required and strictly boolean: this is the ONE thing that decides
 *   whether an undriven fixture screams red or goes dark, and a caller that
 *   forgets to wire the toggle must fail loudly here rather than quietly pick
 *   a colour for him.
 */
export function demapSacnToPixels(list, dmxRouter, showUnpatchedRed) {
  if (typeof showUnpatchedRed !== 'boolean') {
    throw new TypeError(
      '[sacn_mapper] demapSacnToPixels(list, dmxRouter, showUnpatchedRed): ' +
      `showUnpatchedRed must be a boolean, got ${typeof showUnpatchedRed}`);
  }
  if (!list || !dmxRouter) return;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    // Unpatched fixtures (and fixtures on universes with no received
    // buffer) are never left carrying a stale colour in sACN-in mode —
    // skipping them used to freeze whatever color the local pattern
    // painted last, producing lit "bleeding" pixels that ignore the
    // engine's fader entirely (operator report 2026-06-11). In this mode
    // the frame is the only truth, so an undriven entry is repainted
    // every time its treatment changes: BRIGHT RED while the operator's
    // "Show Unpatched (Red)" diagnostic is on (his 2026-06-12 ruling:
    // red, not black), BLACK while it is off. Either way it stops
    // bleeding — the toggle only chooses which of the two it is.
    if (!entry.patch || !entry.channels) {
      paintUndrivenEntry(entry, showUnpatchedRed);
      continue;
    }

    const frame = dmxRouter.getFullFrame(entry.patch.universe);
    if (!frame) {
      paintUndrivenEntry(entry, showUnpatchedRed);
      continue;
    }

    const addr = entry.patch.addr - 1; // 0-indexed
    let ch = entry.channels;
    
    // Polyfill if the model serialized channels as a flat number (e.g., 10 for UkingPar fallback)
    if (typeof ch === 'number') {
      const isPar = entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed';
      const fp = entry.patch.footprint;
      if (isPar && fp >= 10) {
        ch = { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 };
      } else if (fp === 6) {
        ch = { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
      } else {
        ch = { r: 1, g: 2, b: 3 }; 
        if (typeof entry.channels === 'number' && entry.channels >= 4) ch.w = 4;
      }
    }

    let r = 0, g = 0, b = 0;
    let w = 0, a = 0, uv = 0;
    
    if (ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      r = frame[addr + ch.r - 1] / 255;
      g = frame[addr + ch.g - 1] / 255;
      b = frame[addr + ch.b - 1] / 255;
      
      // Extract WAU raw values for downstream consumers (SpotLight pool, sACN out, etc.)
      if (ch.w !== undefined) w = frame[addr + ch.w - 1] / 255;
      if (ch.a !== undefined) a = frame[addr + ch.a - 1] / 255;
      if (ch.u !== undefined) uv = frame[addr + ch.u - 1] / 255;
    } else if (ch.w !== undefined) {
      // Monochromatic fixture preview
      w = frame[addr + ch.w - 1] / 255;
      r = w; g = w; b = w;
    }

    // ── Write raw channel values back to the batch entry ──
    // This is CRITICAL: the V2 InstancedMesh flush (animate.js) and
    // SpotLight pool read entry.r/g/b/w/a/u to produce the final visual.
    // Without this, those consumers see 0 → black pixels.
    entry.r = r; entry.g = g; entry.b = b;
    entry.w = w; entry.a = a; entry.u = uv;
    // A driven entry is no longer undriven — keep the flags honest so
    // paintUndrivenEntry's steady-state fast path can't be fooled by a
    // stale marker (lose patch → regain → coincidentally red frame).
    if (entry._sacnUndriven) {
      entry._sacnUndriven = false;
      entry._sacnUndrivenRed = false;
    }

    // ── Preview colour ─────────────────────────────────────────────────
    // LED strands: the frame bytes ARE the wire bytes, so the honest
    // preview is those bytes pushed through the LED controller's own
    // processing (white extraction + gamma) — see led_wire.js. This is
    // what makes screen == strand on the sACN-IN path, and it is why the
    // strand preview no longer shows amber/UV the hardware never gets.
    // DMX fixtures keep the classic additive RGBWAU blend.
    let rn, gn, bn;
    if (isLedEntry(entry)) {
      const cfg = resolveLedWireConfig(entry);
      const preview = ledPreviewRgbFromBytes({
        r: Math.round(r * 255), g: Math.round(g * 255),
        b: Math.round(b * 255), w: Math.round(w * 255),
      }, cfg);
      entry._ledWirePreview = preview;
      [rn, gn, bn] = preview;
    } else {
      rn = Math.min(1, r + w * 0.8 + a * 0.9 + uv * 0.4);
      gn = Math.min(1, g + w * 0.8 + a * 0.6);
      bn = Math.min(1, b + w * 0.8 + uv * 0.7);
    }

    if (entry.apply) entry.apply(rn, gn, bn);
  }
}

/**
 * Paint an undriven entry — the "this fixture is unmapped / not receiving
 * data" treatment. `red` is the operator's "Show Unpatched (Red)" switch:
 * ON  → bright red, his 2026-06-12 diagnostic, unchanged in every respect;
 * OFF → black, which is what the OTHER two unpatched indicators
 *       (`_applyUnpatchedRedOverlay`'s shell tint and the instanced-dot
 *       flush, both in animate.js) already do when the switch is off.
 * Before 20260725_81 this third indicator answered to no switch at all, so
 * an operator with the toggle OFF still got red bulbs and — once `_73`/`_75`
 * grew the rim past the housing — red halo rings he could not turn off.
 *
 * entry.r/g/b carry the treatment because the V2 InstancedMesh dot flush and
 * the SpotLight pool read those fields directly (see demap above); entries
 * without a patch are never re-emitted as DMX (mapPixelsToSacn skips them),
 * so the indicator stays visual-only either way.
 *
 * `_sacnUndrivenRed` records WHICH treatment is currently painted, so the
 * (per-frame, per-pixel) apply call is skipped in steady state AND a live
 * toggle flip repaints on the very next frame — no reload, no rebuild.
 */
function paintUndrivenEntry(entry, red) {
  const level = red ? 1 : 0;
  if (entry._sacnUndriven && entry._sacnUndrivenRed === red &&
      entry.r === level && !entry.g && !entry.b && !entry.w && !entry.a && !entry.u) {
    return;
  }
  entry.r = level; entry.g = 0; entry.b = 0;
  entry.w = 0; entry.a = 0; entry.u = 0;
  entry._sacnUndriven = true;
  entry._sacnUndrivenRed = red;
  if (entry.apply) entry.apply(level, 0, 0);
}

/**
 * Maps simulation pixel colors into outgoing DMX frame buffers (for Pixelblaze and Gradient modes)
 * @param {Object} list - The batch render list containing pixels
 * @param {Object} dmxRouter - The router containing DMX universes
 */
export function mapPixelsToSacn(list, dmxRouter) {
  if (!list || !dmxRouter) return;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry.patch) continue;
    // Fallback to standard RGB if channels definition is missing
    if (!entry.channels) entry.channels = { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
    
    // Auto-create missing universe buffers dynamically in the router if they exist in the model
    let buf = dmxRouter.getFullFrame(entry.patch.universe);
    if (!buf) {
      if (dmxRouter.addUniverse) dmxRouter.addUniverse(entry.patch.universe);
      buf = dmxRouter.getFullFrame(entry.patch.universe);
      if (!buf) continue;
    }
    
    const addr = entry.patch.addr - 1; // 0-indexed buffer
    let ch = entry.channels;
    
    // Polyfill if the model serialized channels as a flat number (e.g., 3 for RGB)
    // Legacy model.js exports `channels: 3` and `type: 'par'` for Par lights.
    if (typeof ch === 'number') {
      const isPar = entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed';
      const fp = entry.patch.footprint;
      if (isPar && fp >= 10) {
        ch = { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 };
      } else if (fp === 6) {
         // Typical Shehds individual pixel
        ch = { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
      } else {
        // Standard RGB
        ch = { r: 1, g: 2, b: 3 }; 
        if (typeof entry.channels === 'number' && entry.channels >= 4) ch.w = 4;
      }
    }
    
    // Auto-set the master dimmers to 100%
    if (entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed' || entry.fixtureType === 'ShehdsBar') {
      buf[addr + 0] = 255;
    }
    // Wait! Do not force global RGBWAUV dimmers to 255, as it blasts the fixture to full white.
    // Individual pixels are addressed starting at channel 12, so globals (6-11) should stay 0.

    // ── LED-STRAND branch ──────────────────────────────────────────────
    // Strands get the clip-proof composite encode (led_wire.js): amber
    // folded into RGB (no amber emitter on a strand), UV dropped (no UV
    // emitter either), an over-unity result fitted under the ceiling by
    // scaling all three channels together so a warm white stays warm, and
    // the white already split off as W = min(RGB) so the LED controller's
    // own white processing is a no-op that CANNOT clip. Gamma is NOT
    // applied here — the LED controller owns the only gamma curve in the
    // chain. DMX fixtures never take this branch; their bytes are
    // untouched by this work.
    //
    // `whiteMode` keeps its meaning: 'native' (default) sends the
    // pattern's own white lane in the W byte — TRUE RGBW, so a controller
    // with a wire-exact white path lights its dedicated white emitter —
    // while 'synth' pushes as much of the colour as possible onto that
    // white emitter instead. Both are clip-free, and both are identical
    // on a controller that re-derives its own white split.
    if (isLedEntry(entry) && ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      const cfg = resolveLedWireConfig(entry);
      const bytes = ledWireBytes(entry.r, entry.g, entry.b, entry.w, entry.a, cfg,
        entry.whiteMode === 'synth' ? 'synth' : 'native');
      if (ch.w !== undefined) {
        buf[addr + ch.r - 1] = bytes.r;
        buf[addr + ch.g - 1] = bytes.g;
        buf[addr + ch.b - 1] = bytes.b;
        buf[addr + ch.w - 1] = bytes.w;
      } else {
        // RGB-only strand (no white emitter): the whole composite rides in
        // RGB. Still amber-folded and still clip-free by construction.
        buf[addr + ch.r - 1] = bytes.r + bytes.w;
        buf[addr + ch.g - 1] = bytes.g + bytes.w;
        buf[addr + ch.b - 1] = bytes.b + bytes.w;
      }
      // Preview honesty: the strand's on-screen colour comes from these
      // exact wire bytes, run back through the controller's white
      // extraction + gamma (see led_wire.js). Cached on the entry so the
      // 3D dot flush, the strand bulbs and the 2D map all read the SAME
      // number the wire carries.
      entry._ledWirePreview = ledPreviewRgbFromBytes(bytes, cfg);
      continue;
    }

    if (ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      buf[addr + ch.r - 1] = Math.max(0, Math.min(255, entry.r * 255)) || 0;
      buf[addr + ch.g - 1] = Math.max(0, Math.min(255, entry.g * 255)) || 0;
      buf[addr + ch.b - 1] = Math.max(0, Math.min(255, entry.b * 255)) || 0;

      // ── White lane policy (DMX fixtures) ───────────────────────────
      // DMX fixtures host-synthesize white as min(R,G,B) when the pattern
      // produced no explicit W, and pass an explicit W through as-is.
      // (LED strands never reach here — see the strand branch above.)
      if (ch.w !== undefined) {
        if (entry.w !== undefined && entry.w > 0) {
          buf[addr + ch.w - 1] = Math.max(0, Math.min(255, entry.w * 255));
        } else {
          buf[addr + ch.w - 1] = Math.min(buf[addr + ch.r - 1], buf[addr + ch.g - 1], buf[addr + ch.b - 1]);
        }
      }
      if (ch.a !== undefined && entry.a !== undefined) buf[addr + ch.a - 1] = Math.max(0, Math.min(255, entry.a * 255));
      if (ch.u !== undefined && entry.u !== undefined) buf[addr + ch.u - 1] = Math.max(0, Math.min(255, entry.u * 255));
    } else if (ch.w !== undefined) {
      const luma = entry.w !== undefined ? entry.w * 255 : ((entry.r * 255 * 0.299) + (entry.g * 255 * 0.587) + (entry.b * 255 * 0.114));
      buf[addr + ch.w - 1] = Math.max(0, Math.min(255, Math.round(luma))) || 0;
    }
  }
}

/**
 * render_paint_rule.js — when does a batch-render entry paint its 3D visual
 * DIRECTLY from the rendered color (vs. being repainted from the DMX universe
 * buffer by the router path)?
 *
 * DMX fixtures have a wire read-back: when patches are active, animate.js runs
 * mapPixelsToSacn → the router → applyDmxFrame(), so the fixture visual shows
 * the ACTUAL universe bytes. Their direct-paint is therefore skipped while
 * patched (else it would double-drive and hide real wire output).
 *
 * LED strands (FIX_RAW_LED, `type === 'led'`) have NO such read-back — nothing
 * calls applyDmxFrame() for them; their ONLY visual write is entry.apply()
 * (LedStrand.setLedColorRGB). So a patched strand painted nothing and froze at
 * its construction color while DMX fixtures animated (operator report
 * 2026-07-10: "LEDs still not getting mapped by the pixelblaze renders").
 * The sacn_in demap already calls apply() unconditionally — which is exactly
 * why the same strand animated under sACN-in but not under the patched local
 * pixelblaze engine. An LED entry must therefore paint directly EVERY frame,
 * patched or not.
 *
 * @param {{type?: string}} entry - a batch-render entry (has the exporter's `type`)
 * @param {boolean} patchesActive - window._patchesActive (any DMX fixture patched)
 * @returns {boolean} true if animate.js should call entry.apply() this frame
 */
export function entryPaintsDirect(entry, patchesActive) {
  return !patchesActive || !!(entry && entry.type === 'led');
}

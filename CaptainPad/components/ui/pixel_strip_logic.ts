/**
 * pixel_strip_logic — how a PixelStrip decides which transmitted samples to
 * draw (report _239). Pure `.ts` so the rule is unit-tested in plain Node;
 * `PixelStrip.tsx` may only ask this module, never re-derive it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Before _239 the engine capped EVERY `/ws/viz` key to one number
 * (`vis.maxPixels`, 100), so a strip could simply draw the buffer it was
 * handed: 100 samples, 100 RN <View>s, the whole rig covered.
 *
 * _239 made that cap PER KEY so the Deck PIXELS canvas can receive the rig at
 * full rate (964 samples on titanic). Two strips read one of those raised keys
 * — the deck's LIVE OUTPUT strip and the mixer's master strip, both on
 * `preDimmer` — and for them a raised cap is not a gift:
 *
 *   * TRUTH: the old code took the FIRST n samples. Handed 964 samples with a
 *     256-View budget it would have drawn model pixels 0…255 — the bow of the
 *     ship stretched across a strip that claims to show the whole rig. That is
 *     a silent lie, and it is the reason this module exists.
 *   * COST: 964 RN <View>s per strip on the iPad's UI thread is precisely the
 *     starvation the engine cap was introduced to end.
 *
 * So the strip declares its OWN budget and samples ACROSS the buffer with the
 * same uniform rule the engine uses (`floor(i * n / budget)`). Engine budget =
 * bandwidth decision; strip budget = render decision. They are different
 * concerns and each layer now owns its own.
 */

/** RGBWAU — six bytes per transmitted sample, matching the engine's frame. */
export const BYTES_PER_PIXEL = 6;

/**
 * Default number of coloured segments a strip will draw.
 *
 * 100 is not a guess: it is exactly what every strip has been drawing since
 * the vis cap was introduced (the engine capped all keys to 100 and the strips
 * drew all of them), so _239 changes the strips' cost by ZERO while fixing
 * what they show. A strip is 12–18pt tall and a few hundred wide; at 100
 * segments each block is already several px, and the strip's job is "which
 * part of the rig is lit", not per-pixel inspection — that is what the PIXELS
 * window is for.
 */
export const STRIP_MAX_SEGMENTS = 100;

/**
 * How many segments to draw for a buffer of `sampleCount` samples under
 * `maxSegments`. Fewer samples than the budget ⇒ draw them all (a small rig
 * gets its real resolution); more ⇒ the budget.
 */
export function stripSegmentCount(sampleCount: number, maxSegments: number): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new Error(`[PixelStrip] sampleCount must be a non-negative integer, got ${sampleCount}`);
  }
  if (!Number.isInteger(maxSegments) || maxSegments < 1) {
    throw new Error(`[PixelStrip] maxSegments must be a positive integer, got ${maxSegments}`);
  }
  return Math.min(sampleCount, maxSegments);
}

/**
 * Which transmitted sample segment `i` reads, given `segments` segments over
 * `sampleCount` samples.
 *
 * Identical rule to the engine's own subsample table
 * (`marsin_engine/lib/vis_budget.js`), so a strip drawing a capped buffer and
 * a strip drawing a full-rate one show the SAME picture at the same width —
 * only the second one is sharper if the strip's budget allows. When
 * `segments === sampleCount` this is the identity and nothing is dropped.
 */
export function stripSampleIndex(segment: number, segments: number, sampleCount: number): number {
  if (!(segments > 0)) throw new Error(`[PixelStrip] segments must be positive, got ${segments}`);
  if (segments >= sampleCount) return segment;
  return Math.floor((segment * sampleCount) / segments);
}

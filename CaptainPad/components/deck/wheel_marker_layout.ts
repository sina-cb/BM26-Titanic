/**
 * wheel_marker_layout — pure, presentation-only layout for hue-wheel slots.
 *
 * Several colour schemes deliberately repeat a hue at a lower brightness. The
 * wheel must retain those semantic slots without painting their numbered
 * markers on top of each other. This module moves MARKERS only: callers keep
 * using `hue` for all colour, scheme, wire, and selection work.
 */

const TAU = Math.PI * 2;
const DEFAULT_GAP_PX = 2;

export type WheelMarker = {
  /** Semantic slot identity. Never derived from a colour value. */
  key: string;
  index: number;
  /** The authoritative hue used by colour control. */
  hue: number;
  /** Marker-only position, possibly offset to avoid another marker. */
  displayHue: number;
  /** Raw hue position, relative to the wheel centre. */
  anchor: { x: number; y: number };
  /** Visible marker position, relative to the wheel centre. */
  position: { x: number; y: number };
};

export type WheelMarkerLayoutOptions = {
  radius: number;
  /** Use the largest rendered handle so an armed slot cannot overlap a peer. */
  markerDiameter: number;
  gapPx?: number;
};

function wrapHue(hue: number): number {
  return ((hue % 1) + 1) % 1;
}

function pointAt(hue: number, radius: number): { x: number; y: number } {
  const angle = hue * TAU;
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
}

/** Circular distance between two marker angles. */
function circularDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % TAU;
  return Math.min(distance, TAU - distance);
}

/**
 * Lay out one stable marker for every semantic wheel slot.
 *
 * The relaxation pushes only overlapping neighbours apart. It is deterministic
 * (slot index is the tie-breaker), handles collisions across 0/1, and leaves
 * all non-colliding markers exactly on their raw hue. The leader's `anchor`
 * makes an offset unambiguous instead of pretending the scheme output moved.
 */
export function layoutWheelMarkers(
  hues: readonly number[],
  { radius, markerDiameter, gapPx = DEFAULT_GAP_PX }: WheelMarkerLayoutOptions,
): WheelMarker[] {
  if (hues.length === 0) throw new Error('layoutWheelMarkers needs at least one hue');
  if (!(radius > 0) || !(markerDiameter > 0) || !(gapPx >= 0)) {
    throw new Error('layoutWheelMarkers needs positive radius/markerDiameter and non-negative gapPx');
  }
  if (!hues.every((hue) => Number.isFinite(hue))) {
    throw new Error('layoutWheelMarkers needs finite hues');
  }
  const separation = markerDiameter + gapPx;
  if (separation >= radius * 2) {
    throw new Error('layoutWheelMarkers marker separation exceeds wheel diameter');
  }
  const minimumAngle = 2 * Math.asin(separation / (radius * 2));
  if (minimumAngle * hues.length > TAU) {
    throw new Error('layoutWheelMarkers cannot fit all markers at this wheel size');
  }

  // Keep the caller's exact hue value in the semantic record. Wrapping is a
  // geometry concern only; normalizing here would subtly mutate persisted or
  // broadcast values such as 0.01 while merely drawing them.
  const slots = hues.map((hue, index) => ({ index, hue, angle: wrapHue(hue) * TAU }));
  // Exact-angle ties need a deterministic initial order before the first sort.
  for (const slot of slots) slot.angle += slot.index * 1e-10;

  // Five slots converge quickly. A bounded fixed pass count avoids hidden
  // timing/state while comfortably clearing the worst case: five identical hues.
  for (let pass = 0; pass < 80; pass += 1) {
    slots.sort((a, b) => a.angle - b.angle || a.index - b.index);
    let moved = false;
    for (let index = 0; index < slots.length; index += 1) {
      const left = slots[index];
      const right = slots[(index + 1) % slots.length];
      const rightAngle = index === slots.length - 1 ? right.angle + TAU : right.angle;
      const gap = rightAngle - left.angle;
      if (gap >= minimumAngle - 1e-9) continue;
      const nudge = (minimumAngle - gap) / 2;
      left.angle -= nudge;
      right.angle += nudge;
      moved = true;
    }
    if (!moved) break;
  }

  return slots
    .sort((a, b) => a.index - b.index)
    .map((slot) => {
      const displayHue = wrapHue(slot.angle / TAU);
      return {
        key: `slot-${slot.index}`,
        index: slot.index,
        hue: slot.hue,
        displayHue,
        anchor: pointAt(wrapHue(slot.hue), radius),
        position: pointAt(displayHue, radius),
      };
    });
}

/** Exposed for tests that prove every rendered handle clears its neighbours. */
export function markerDistance(a: WheelMarker, b: WheelMarker): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

/** Exposed for tests; production uses the stronger Euclidean distance above. */
export function markerAngularDistance(a: WheelMarker, b: WheelMarker): number {
  return circularDistance(a.displayHue * TAU, b.displayHue * TAU);
}

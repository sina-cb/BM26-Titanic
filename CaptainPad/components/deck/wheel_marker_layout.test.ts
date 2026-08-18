import { describe, expect, it } from 'vitest';

import { generateScheme, SCHEME_IDS } from './colors_window_logic';
import { layoutWheelMarkers, markerDistance } from './wheel_marker_layout';

const IPAD_WHEEL_RADIUS = 78;
const ARMED_HANDLE_DIAMETER = 30;
const MIN_CLEARANCE = ARMED_HANDLE_DIAMETER + 2;

function assertVisibleSlots(hues: readonly number[]) {
  const markers = layoutWheelMarkers(hues, {
    radius: IPAD_WHEEL_RADIUS,
    markerDiameter: ARMED_HANDLE_DIAMETER,
  });
  expect(markers).toHaveLength(5);
  expect(markers.map((marker) => marker.key)).toEqual(['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4']);
  expect(markers.map((marker) => marker.hue)).toEqual(hues);
  for (let a = 0; a < markers.length; a += 1) {
    for (let b = a + 1; b < markers.length; b += 1) {
      expect(markerDistance(markers[a], markers[b])).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-6);
    }
  }
  return markers;
}

describe('layoutWheelMarkers', () => {
  it('keeps all five semantic slots visibly distinct for every scheme at iPad wheel size', () => {
    for (const scheme of SCHEME_IDS) {
      const ring = generateScheme(scheme, 0.99);
      const markers = assertVisibleSlots(ring.map((colour) => colour.h));
      expect(markers.map((marker) => marker.hue)).toEqual(ring.map((colour) => colour.h));
    }
  });

  it('separates five exact duplicates without changing their authoritative hues', () => {
    const markers = assertVisibleSlots([0.37, 0.37, 0.37, 0.37, 0.37]);
    expect(markers.map((marker) => marker.anchor)).toEqual(
      Array.from({ length: 5 }, () => markers[0].anchor),
    );
    expect(new Set(markers.map((marker) => marker.displayHue))).toHaveLength(5);
  });

  it('treats near-0/1 markers as circular neighbours, not opposite wheel edges', () => {
    const markers = assertVisibleSlots([0.99, 0.01, 0.5, 0.5, 0.75]);
    expect(markers[0].displayHue).not.toBe(0.99);
    expect(markers[1].displayHue).not.toBe(0.01);
  });

  it('preserves semantic index order for A/B and slot labels', () => {
    const markers = layoutWheelMarkers([0.2, 0.2], {
      radius: IPAD_WHEEL_RADIUS,
      markerDiameter: ARMED_HANDLE_DIAMETER,
    });
    expect(markers.map(({ key, index, hue }) => ({ key, index, hue }))).toEqual([
      { key: 'slot-0', index: 0, hue: 0.2 },
      { key: 'slot-1', index: 1, hue: 0.2 },
    ]);
  });
});

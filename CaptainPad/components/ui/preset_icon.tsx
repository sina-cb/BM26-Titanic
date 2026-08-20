/**
 * PresetIcon — a GENERATED icon, drawn from colours and nothing else (_242
 * order 4: "when storing generate the icon").
 *
 * A saved palette needs a face the operator can recognise at a glance in a
 * gallery of 24. The face is a disc cut into one wedge per colour, in ring
 * order, starting at the top and going clockwise — the same reading direction
 * as the hue dial, so a palette's icon and its position on the dial rhyme.
 *
 * WHY IT IS DRAWN, NOT STORED. There is no image file, no data URI, no hash and
 * no asset to ship: the icon is a pure function of the entry's colours, so it
 * cannot go stale, it costs nothing to persist, and the preview the operator
 * approves in the naming dialog is byte-identical to the chip that lands in the
 * gallery — both call this component with the same list.
 *
 * Generic on purpose (it lives in components/ui, not components/deck): it takes
 * CSS colour strings and knows nothing about hues, schemes or the CPC. The deck
 * decides WHICH colours an entry shows (`presetIconColours`); this only draws
 * them. That is also what lets `op_dialog_sheet` render one without the dialog
 * system growing a dependency on the colours window.
 */
import React from 'react';
import { Platform, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

/** Below this the wedge seams are wider than the wedges; draw a plain dot. */
const MIN_WEDGE_SIZE = 10;

export interface PresetIconProps {
  /** One CSS colour per wedge, in order. Two is a half-and-half disc; five is
   *  the TURNS ring. An EMPTY list is a caller bug and THROWS (codex P0) — an
   *  icon with no colours would render as a hole the operator could not tell
   *  from a failed load. */
  colours: string[];
  size: number;
  /** Hairline around the disc, so a pale wedge still has an edge on a pale
   *  surface. Omit for no ring. */
  borderColor?: string;
}

/** A pie wedge from `a0` to `a1` (turns, 0 = up, clockwise). */
function wedgePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (t: number) => {
    const ang = t * Math.PI * 2;
    return `${(cx + Math.sin(ang) * r).toFixed(2)} ${(cy - Math.cos(ang) * r).toFixed(2)}`;
  };
  const large = a1 - a0 > 0.5 ? 1 : 0;
  return `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${p(a0)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${p(a1)} Z`;
}

export const PresetIcon: React.FC<PresetIconProps> = ({ colours, size, borderColor }) => {
  if (colours.length === 0) {
    throw new Error('[PresetIcon] needs at least one colour — an empty icon is indistinguishable from a failed render');
  }
  const c = size / 2;
  const r = c - (borderColor ? 0.5 : 0);
  const n = colours.length;
  if (Platform.OS !== 'web') {
    return (
      <View
        pointerEvents="none"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          flexDirection: 'row',
          borderWidth: borderColor ? 1 : 0,
          borderColor,
        }}
      >
        {colours.map((backgroundColor, index) => (
          <View key={index} style={{ flex: 1, backgroundColor }} />
        ))}
      </View>
    );
  }
  return (
    <Svg width={size} height={size} pointerEvents="none">
      {n === 1 || size < MIN_WEDGE_SIZE ? (
        <Circle cx={c} cy={c} r={r} fill={colours[0]} />
      ) : (
        colours.map((fill, i) => (
          // Wedges OVERLAP by a hair (the `+ 1` on the end angle's numerator is
          // deliberate arithmetic, not a rounding slip): abutting anti-aliased
          // edges otherwise leave a hairline of the surface showing through.
          <Path key={i} d={wedgePath(c, c, r, i / n, (i + 1.02) / n)} fill={fill} />
        ))
      )}
      {borderColor ? (
        <Circle cx={c} cy={c} r={r} fill="none" stroke={borderColor} strokeWidth={1} />
      ) : null}
    </Svg>
  );
};

import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The COLORS card lives inside a vertically scrolling workspace column. It may
 * grow as tall as its content, but it must never negotiate a width larger than
 * that column: native Text intrinsic widths otherwise let the mode rail paint
 * past the card before Yoga has a reason to shrink it.
 */
export const COLORS_WINDOW_BOUNDARY_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
};

/** The title and mode rail occupy separate bounded rows. */
export const COLORS_MODE_HEADER_STYLE: ViewStyle = {
  alignItems: 'stretch',
  gap: 6,
  minWidth: 0,
};

/** All three modes share exactly the width available inside the card. */
export const COLORS_MODE_RAIL_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  width: '100%',
  minWidth: 0,
  flexDirection: 'row',
  borderRadius: 8,
  padding: 3,
  gap: 2,
};

/**
 * Longhands are intentional. A zero basis makes label intrinsic width unable
 * to enlarge one native Yoga item; grow then divides the bounded rail evenly.
 */
export const COLORS_MODE_BUTTON_STYLE: ViewStyle = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  alignItems: 'center',
  paddingHorizontal: 4,
  paddingVertical: 7,
  borderRadius: 6,
};

export const COLORS_MODE_LABEL_STYLE: TextStyle = {
  flexShrink: 1,
  maxWidth: '100%',
  textAlign: 'center',
};

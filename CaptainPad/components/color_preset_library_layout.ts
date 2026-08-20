import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The saved palette library is mounted by both Deck and Mixer. These styles
 * deliberately use longhand flex values: Fabric/Yoga otherwise permits a
 * long palette name or a control row to negotiate past a narrow workspace.
 */
export const PALETTE_LIBRARY_HEADER_STYLE: ViewStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
};

export const PALETTE_LIBRARY_TITLE_STYLE: ViewStyle = {
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
};

export const PALETTE_LIBRARY_ACTIONS_STYLE: ViewStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  flexGrow: 0,
  flexShrink: 1,
  flexWrap: 'wrap',
  gap: 6,
  justifyContent: 'flex-end',
  minWidth: 0,
};

export const PALETTE_LIBRARY_GRID_STYLE: ViewStyle = {
  alignContent: 'flex-start',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
  width: '100%',
};

/** A chip may contract, but never paint beyond the bounded gallery. */
export const PALETTE_LIBRARY_CHIP_STYLE: ViewStyle = {
  alignSelf: 'flex-start',
  flexShrink: 1,
  maxWidth: '100%',
  minWidth: 0,
};

export const PALETTE_LIBRARY_CHIP_LABEL_STYLE: TextStyle = {
  flexShrink: 1,
  minWidth: 0,
};

/** The picker overlay must fit the smallest supported iPad width. */
export const PALETTE_PICKER_CARD_STYLE: ViewStyle = {
  alignSelf: 'center',
  maxWidth: 440,
  minWidth: 0,
  width: '92%',
};

export const PALETTE_PICKER_GRID_STYLE: ViewStyle = {
  ...PALETTE_LIBRARY_GRID_STYLE,
  gap: 10,
  paddingBottom: 2,
};

export const PALETTE_PICKER_CARD_ITEM_STYLE: ViewStyle = {
  flexBasis: '47%',
  flexGrow: 1,
  flexShrink: 1,
  maxWidth: '49%',
  minWidth: 0,
};

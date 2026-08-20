import type { ViewStyle } from 'react-native';

/** The DECK MAIN card may shrink with its workspace share, never beyond it. */
export const PARAMETER_CARD_BOUNDARY_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
};

/**
 * Identity/editor and actions are intentionally separate rows. The old single
 * flex row needed more than 190 points before the editable title received any
 * space, so a real iPad landscape card collapsed DECK MAIN into a vertical
 * sliver even though the surrounding workspace was correctly bounded.
 */
export const PARAMETER_HEADER_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  gap: 6,
  minWidth: 0,
  marginBottom: 4,
};

export const PARAMETER_HEADER_LABEL_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  width: '100%',
  minWidth: 0,
};

export const PARAMETER_HEADER_ACTIONS_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  minWidth: 0,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 4,
};

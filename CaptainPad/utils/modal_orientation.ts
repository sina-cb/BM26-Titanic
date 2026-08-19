import type { ModalProps } from 'react-native';

/**
 * iOS modals with no `supportedOrientations` default to UIInterfaceOrientationMaskAll
 * on iPad (see RN RCTModalHostView). CaptainPad is landscape-only (app.json +
 * lockCaptainPadOrientation), so an undeclared modal can SIGABRT during
 * presentation when UIKit reconciles orientations. Every native Modal that can
 * appear on the operator surface must declare this contract explicitly.
 */
export const CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS: NonNullable<
  ModalProps['supportedOrientations']
> = ['landscape', 'landscape-left', 'landscape-right'];

export type CaptainPadModalOrientation =
  (typeof CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS)[number];

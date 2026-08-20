import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';

export const CAPTAIN_PAD_ORIENTATION_LOCK = ScreenOrientation.OrientationLock.LANDSCAPE;

/**
 * Keep the native operator surface in its designed landscape composition.
 * Web remains responsive because browser orientation is owned by the window.
 */
export async function lockCaptainPadOrientation(platform = Platform.OS): Promise<void> {
  if (platform === 'web') return;

  try {
    await ScreenOrientation.lockAsync(CAPTAIN_PAD_ORIENTATION_LOCK);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`[CaptainPad] landscape orientation lock failed: ${detail}`, { cause });
  }
}

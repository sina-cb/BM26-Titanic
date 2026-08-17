/**
 * Performance-mode presentation for one Mixer channel.
 *
 * The engine remains the authority for the persisted `channel.locked` bit.
 * Performance mode only overlays that bit while its existing edit-authority
 * gate is engaged; it never manufactures a PATCH and therefore cannot erase a
 * lock the operator deliberately set before the show.
 */

export interface MixerChannelLockSource {
  locked?: boolean;
}

export interface MixerChannelPerformanceOptions {
  /** Raw global mode: owns the visible Performance face. */
  performanceModeActive: boolean;
  /** Existing authenticated edit-authority gate from usePerfLock(). */
  performanceAuthorityLocked: boolean;
}

export interface MixerChannelPerformanceState {
  managementVisible: boolean;
  effectiveLocked: boolean;
}

export function mixerChannelPerformanceState(
  channel: MixerChannelLockSource,
  options: MixerChannelPerformanceOptions,
): MixerChannelPerformanceState {
  return {
    managementVisible: !options.performanceModeActive,
    effectiveLocked: !!channel.locked || options.performanceAuthorityLocked,
  };
}

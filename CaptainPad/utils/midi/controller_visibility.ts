// Pure predicates for controller-specific UI visibility. A configured MIDI
// profile is not proof that the physical controller is attached.

export interface ControllerVisibilityStatus {
  deviceId: string;
  kind: 'disconnected' | 'connected' | 'error';
}

/** True only while this physical controller is usable. Error/disconnected
 * states must not leave hardware legends or navigation highlights on screen. */
export function midiControllerConnected(
  statuses: readonly ControllerVisibilityStatus[],
  deviceId: string,
): boolean {
  return statuses.some((status) => (
    status.deviceId === deviceId && status.kind === 'connected'
  ));
}

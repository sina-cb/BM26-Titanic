import { describe, expect, it } from 'vitest';

import { midiControllerConnected } from './controller_visibility';

describe('controller-specific UI visibility', () => {
  const statuses = [
    { deviceId: 'apc_mini_mk2', kind: 'disconnected' as const },
    { deviceId: 'mft', kind: 'error' as const },
    { deviceId: 'vsn1', kind: 'connected' as const },
  ];

  it('shows hardware affordances only for the connected controller', () => {
    expect(midiControllerConnected(statuses, 'vsn1')).toBe(true);
    expect(midiControllerConnected(statuses, 'apc_mini_mk2')).toBe(false);
    expect(midiControllerConnected(statuses, 'mft')).toBe(false);
  });

  it('does not mistake a configured or unknown controller for a connected one', () => {
    expect(midiControllerConnected([], 'vsn1')).toBe(false);
    expect(midiControllerConnected(statuses, 'unknown')).toBe(false);
  });
});

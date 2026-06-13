import { describe, it, expect } from 'vitest';
import { resolveEndpoints, EndpointResolutionError } from './endpoints';
import { MidiEndpoint } from './transport';
import { DeviceDef } from './profile';

const device: DeviceDef = {
  id: 'apc_mini_mk2', label: 'APC mini mk2', nameContains: 'APC mini mk2',
  sourcePort: 0, destinationPort: 0,
};

// The real Windows/Chromium enumeration: the device name appears on two ports,
// plus Bome virtual ports that must NOT match.
const endpoints: MidiEndpoint[] = [
  { id: 'in-bome-td', name: 'APCMini -> TouchDesigner', portIndex: 0, kind: 'source' },
  { id: 'in-0', name: 'APC mini mk2', portIndex: 1, kind: 'source' },
  { id: 'in-1', name: 'MIDIIN2 (APC mini mk2)', portIndex: 2, kind: 'source' },
  { id: 'out-bome-td', name: 'APCMini -> TouchDesigner', portIndex: 0, kind: 'destination' },
  { id: 'out-0', name: 'APC mini mk2', portIndex: 1, kind: 'destination' },
  { id: 'out-1', name: 'MIDIOUT2 (APC mini mk2)', portIndex: 2, kind: 'destination' },
];

describe('resolveEndpoints', () => {
  it('selects port 0 (first name match) and excludes Bome ports', () => {
    const r = resolveEndpoints(device, endpoints);
    expect(r.sourceId).toBe('in-0');
    expect(r.destinationId).toBe('out-0');
    expect(r.sourceName).toBe('APC mini mk2');
  });

  it('selects port 1 (MIDIIN2) when pinned', () => {
    const r = resolveEndpoints({ ...device, sourcePort: 1, destinationPort: 1 }, endpoints);
    expect(r.sourceId).toBe('in-1');
    expect(r.destinationId).toBe('out-1');
  });

  it('throws when the device is absent (no name match)', () => {
    const only = endpoints.filter((e) => e.name.startsWith('APCMini ->'));
    expect(() => resolveEndpoints(device, only)).toThrow(EndpointResolutionError);
    expect(() => resolveEndpoints(device, only)).toThrow(/No input endpoint name contains/);
  });

  it('throws when the pinned port index is out of range', () => {
    expect(() => resolveEndpoints({ ...device, sourcePort: 5 }, endpoints)).toThrow(/out of range/);
  });
});

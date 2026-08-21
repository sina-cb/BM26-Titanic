import { describe, it, expect } from 'vitest';
import {
  resolveEndpoints,
  hasMatchingEndpoint,
  EndpointResolutionError,
} from './endpoints';
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

// ── nameEquals pin: an OPTIONAL exact-name requirement. A second identical
// device (a spare APC) enumerated first would silently shift portIndex 0 onto
// the wrong unit; nameEquals requires an EXACT name match so a near-name
// ("MIDIIN2 (APC mini mk2)") can never satisfy the pin. ──
describe('resolveEndpoints — nameEquals exact pin', () => {
  const pinned: DeviceDef = { ...device, nameEquals: 'APC mini mk2' };

  it('selects the exact-name match, ignoring near-name ports', () => {
    const r = resolveEndpoints(pinned, endpoints);
    expect(r.sourceId).toBe('in-0');
    expect(r.sourceName).toBe('APC mini mk2');
    expect(r.destinationId).toBe('out-0');
  });

  it('rejects a near-name-only enumeration (no exact match) — fails loud', () => {
    // Only the "MIDIIN2 (APC mini mk2)" near-name is present; nameContains would
    // happily take it, but nameEquals must NOT.
    const near: MidiEndpoint[] = [
      { id: 'in-near', name: 'MIDIIN2 (APC mini mk2)', portIndex: 0, kind: 'source' },
      { id: 'out-near', name: 'MIDIOUT2 (APC mini mk2)', portIndex: 0, kind: 'destination' },
    ];
    expect(() => resolveEndpoints(pinned, near)).toThrow(EndpointResolutionError);
    expect(() => resolveEndpoints(pinned, near)).toThrow(/exactly matches/);
  });

  it('nameEquals + portIndex disambiguates two identical exact-name units', () => {
    // Two spare APCs both present the exact name; portIndex still picks among them.
    const twins: MidiEndpoint[] = [
      { id: 'in-a', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
      { id: 'in-b', name: 'APC mini mk2', portIndex: 1, kind: 'source' },
      { id: 'out-a', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
      { id: 'out-b', name: 'APC mini mk2', portIndex: 1, kind: 'destination' },
    ];
    expect(resolveEndpoints({ ...pinned, sourcePort: 1, destinationPort: 1 }, twins).sourceId).toBe('in-b');
  });
});

describe('resolveEndpoints — exact platform-name aliases', () => {
  const vsn1: DeviceDef = {
    id: 'vsn1',
    label: 'Intech VSN1',
    nameContains: 'Intech Grid MIDI device',
    nameEqualsAny: ['Intech Grid MIDI device', 'Grid'],
    sourcePort: 0,
    destinationPort: 0,
  };

  it.each(['Intech Grid MIDI device', 'Grid'])(
    'accepts the observed exact driver name %s',
    (name) => {
      const platformEndpoints: MidiEndpoint[] = [
        { id: 'in', name, portIndex: 0, kind: 'source' },
        { id: 'out', name, portIndex: 0, kind: 'destination' },
      ];
      const resolved = resolveEndpoints(vsn1, platformEndpoints);
      expect(resolved.sourceId).toBe('in');
      expect(resolved.destinationId).toBe('out');
      expect(hasMatchingEndpoint(vsn1, platformEndpoints)).toBe(true);
    },
  );

  it('rejects a generic near-name instead of silently broadening to contains("Grid")', () => {
    const wrongGrid: MidiEndpoint[] = [
      { id: 'in', name: 'Grid Controller', portIndex: 0, kind: 'source' },
      { id: 'out', name: 'Grid Controller', portIndex: 0, kind: 'destination' },
    ];
    expect(hasMatchingEndpoint(vsn1, wrongGrid)).toBe(false);
    expect(() => resolveEndpoints(vsn1, wrongGrid)).toThrow(EndpointResolutionError);
    expect(() => resolveEndpoints(vsn1, wrongGrid)).toThrow(/exactly matches one of/);
  });
});

// ── Ambiguity note: >2 same-name matches (multiple identical devices) must be
// LOUD, not silent — the resolver still picks by portIndex but surfaces a note. ──
describe('resolveEndpoints — >2 same-name ambiguity note', () => {
  it('emits a note naming the count when more than two same-name sources enumerate', () => {
    const many: MidiEndpoint[] = [
      { id: 'in-0', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
      { id: 'in-1', name: 'APC mini mk2', portIndex: 1, kind: 'source' },
      { id: 'in-2', name: 'APC mini mk2', portIndex: 2, kind: 'source' },
      { id: 'out-0', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
    ];
    const r = resolveEndpoints(device, many);
    expect(r.notes).toBeDefined();
    expect(r.notes!.some((n) => /3/.test(n) && /APC mini mk2/.test(n))).toBe(true);
  });

  it('emits NO note for the ordinary two-port enumeration', () => {
    const r = resolveEndpoints(device, endpoints);
    expect(r.notes).toBeUndefined();
  });
});

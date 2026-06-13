// Endpoint resolution — turn a profile's { nameContains, sourcePort,
// destinationPort } into concrete transport endpoint ids.
//
// The APC mini mk2 exposes its name on TWO ports ("APC mini mk2" and
// "MIDIIN2 (APC mini mk2)"), so nameContains alone is ambiguous; the port
// index disambiguates deterministically. Codex P0: if zero endpoints match
// the name, or the requested port index doesn't exist among the matches, we
// THROW with the endpoints actually found — never auto-pick a different one.

import { MidiEndpoint } from './transport';
import { DeviceDef } from './profile';

export class EndpointResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointResolutionError';
  }
}

export interface ResolvedEndpoints {
  sourceId: string;
  sourceName: string;
  destinationId: string;
  destinationName: string;
}

function pick(
  device: DeviceDef,
  endpoints: MidiEndpoint[],
  kind: 'source' | 'destination',
  portIndex: number,
): MidiEndpoint {
  const all = endpoints.filter((e) => e.kind === kind);
  const matches = all
    .filter((e) => e.name.includes(device.nameContains))
    .sort((a, b) => a.portIndex - b.portIndex);
  const kindWord = kind === 'source' ? 'input' : 'output';
  if (matches.length === 0) {
    const seen = all.map((e) => `"${e.name}"`).join(', ') || '(none)';
    throw new EndpointResolutionError(
      `No ${kindWord} endpoint name contains "${device.nameContains}". ${kindWord}s seen: ${seen}`,
    );
  }
  const chosen = matches[portIndex];
  if (!chosen) {
    const found = matches.map((e, i) => `[${i}] "${e.name}"`).join(', ');
    throw new EndpointResolutionError(
      `${device.label}: ${kindWord} port index ${portIndex} out of range. ` +
        `Matching ${kindWord}s: ${found}`,
    );
  }
  return chosen;
}

export function resolveEndpoints(device: DeviceDef, endpoints: MidiEndpoint[]): ResolvedEndpoints {
  const source = pick(device, endpoints, 'source', device.sourcePort);
  const destination = pick(device, endpoints, 'destination', device.destinationPort);
  return {
    sourceId: source.id,
    sourceName: source.name,
    destinationId: destination.id,
    destinationName: destination.name,
  };
}

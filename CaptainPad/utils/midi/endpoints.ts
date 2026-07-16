// Endpoint resolution — turn a profile's { nameContains, sourcePort,
// destinationPort } into concrete transport endpoint ids.
//
// The APC mini mk2 exposes its name on TWO ports ("APC mini mk2" and
// "MIDIIN2 (APC mini mk2)"), so nameContains alone is ambiguous; the port
// index disambiguates deterministically. Codex P0: if zero endpoints match
// the name, or the requested port index doesn't exist among the matches, we
// THROW with the endpoints actually found — never auto-pick a different one.
//
// A device may additionally pin an OPTIONAL exact name (`nameEquals`): when set,
// only endpoints whose name === it match (a near-name like "MIDIIN2 (APC …)"
// no longer counts), so a spare identical unit enumerated first can't silently
// shift portIndex 0 onto the wrong device. And when MORE than two same-name
// matches enumerate (a second identical device really is attached), we surface a
// LOUD `notes[]` entry — the portIndex pin is then a guess and the operator
// must see that, not have it hidden.

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
  /** VISIBLE ambiguity notes — surfaced (never silent) when the enumeration is
   *  suspicious but still resolvable: e.g. MORE THAN TWO same-name matches on one
   *  side (multiple identical devices, so the portIndex pin is guesswork). Absent
   *  for the ordinary one/two-port case. The manager routes these to a status
   *  note so the operator sees the ambiguity. */
  notes?: string[];
}

/** More than this many same-name matches on one side is loud-worthy: the APC
 *  legitimately presents TWO ports (device + MIDIIN2), so 2 is normal; 3+ means
 *  a second identical unit is plugged in and the portIndex pin is ambiguous. */
const AMBIGUITY_THRESHOLD = 2;

/** Returns the same-kind endpoints matching the device, in portIndex order.
 *  With `nameEquals` the match is EXACT (===); otherwise it is the `nameContains`
 *  substring test (backward-compatible). */
function nameMatches(device: DeviceDef, endpoints: MidiEndpoint[], kind: 'source' | 'destination'): MidiEndpoint[] {
  const all = endpoints.filter((e) => e.kind === kind);
  const matches = device.nameEquals !== undefined
    ? all.filter((e) => e.name === device.nameEquals)
    : all.filter((e) => e.name.includes(device.nameContains));
  return matches.sort((a, b) => a.portIndex - b.portIndex);
}

function pick(
  device: DeviceDef,
  endpoints: MidiEndpoint[],
  kind: 'source' | 'destination',
  portIndex: number,
): MidiEndpoint {
  const all = endpoints.filter((e) => e.kind === kind);
  const matches = nameMatches(device, endpoints, kind);
  const kindWord = kind === 'source' ? 'input' : 'output';
  // Name the criterion in the error so an exact-pin miss reads differently from
  // a substring miss (a "MIDIIN2 (…)" near-name failing an exact pin is common).
  const criterion = device.nameEquals !== undefined
    ? `exactly matches "${device.nameEquals}"`
    : `name contains "${device.nameContains}"`;
  if (matches.length === 0) {
    const seen = all.map((e) => `"${e.name}"`).join(', ') || '(none)';
    throw new EndpointResolutionError(
      `No ${kindWord} endpoint ${criterion}. ${kindWord}s seen: ${seen}`,
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

/** Loud (never silent) note when a side enumerates MORE than two same-name
 *  matches — the portIndex pin is then a guess among identical devices. */
function ambiguityNote(device: DeviceDef, endpoints: MidiEndpoint[], kind: 'source' | 'destination'): string | null {
  const matches = nameMatches(device, endpoints, kind);
  if (matches.length <= AMBIGUITY_THRESHOLD) return null;
  const kindWord = kind === 'source' ? 'input' : 'output';
  const label = device.nameEquals ?? device.nameContains;
  return (
    `${device.label}: ${matches.length} ${kindWord} ports match "${label}" ` +
    `(expected 1-2) — a second identical device may be attached; port index ` +
    `${kind === 'source' ? device.sourcePort : device.destinationPort} is a guess among them.`
  );
}

export function resolveEndpoints(device: DeviceDef, endpoints: MidiEndpoint[]): ResolvedEndpoints {
  const source = pick(device, endpoints, 'source', device.sourcePort);
  const destination = pick(device, endpoints, 'destination', device.destinationPort);
  const notes = [
    ambiguityNote(device, endpoints, 'source'),
    ambiguityNote(device, endpoints, 'destination'),
  ].filter((n): n is string => n !== null);
  return {
    sourceId: source.id,
    sourceName: source.name,
    destinationId: destination.id,
    destinationName: destination.name,
    ...(notes.length ? { notes } : {}),
  };
}

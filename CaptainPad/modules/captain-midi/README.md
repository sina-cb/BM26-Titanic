# captain-midi

Local Expo module (Swift + CoreMIDI) that bridges the FoH iPad's USB-C MIDI to
CaptainPad. The frozen five-call surface — `listEndpoints`, `openSource`,
`openDestination`, `send`, and the two events `midiMessage` /
`endpointsChanged` — matches `CaptainPad/utils/midi/transport.ts`, so the whole
mapping/dispatch/LED stack in `utils/midi/` runs byte-identical on the iPad
(this module) and desktop Chromium (Web MIDI).

## Why local

This module is checked into the repo (not `npm install`ed) for playa
compliance: no external registry, no runtime install. It rides Expo's local
autolinking (`modules/` is the default `nativeModulesDir`) and lands
automatically on the iPad build.

This does **not** make `CaptainPad/ios/` source code. The two directories have
different jobs:

- `CaptainPad/modules/captain-midi/ios/` is tracked local-Expo-module source.
  CoreMIDI is an Apple native API, so the bridge itself must be Swift.
- `CaptainPad/ios/` is generated, gitignored, EAS-ignored build output. Never
  hand-edit it. `expo prebuild --platform ios --clean` recreates it and
  autolinks this module.

Expo JavaScript alone cannot access a USB MIDI controller on iPadOS: Web MIDI
is unavailable there. The local Expo module is the smallest Expo-supported
boundary that keeps the app declarative while allowing direct CoreMIDI access.

## API

The app imports the checked-in binding from
`@/modules/captain-midi/src`. Everything is declared in `src/index.ts`; the
Swift implementation lives in `ios/CaptainMidiModule.swift`.

```ts
type Kind = 'source' | 'destination';
interface Endpoint {
  id: string;         // stable id — CoreMIDI unique id or "name#portIndex"
  name: string;       // display name (CoreMIDI kMIDIPropertyDisplayName)
  portIndex: number;  // 0-based position among same-kind endpoints
  kind: Kind;
}

listEndpoints(): Promise<Endpoint[]>;
openSource(id: string): Promise<void>;        // throws if gone (no auto-pick)
disconnectSource(id: string): Promise<void>;
openDestination(id: string): Promise<void>;
send(destinationId: string, bytes: number[]): void; // 0-255; SysEx tolerated
closeAll(): void;                             // hard-reset/test helper

addListener('midiMessage', ({ sourceId, data, timestampMs }) => void);
addListener('endpointsChanged', () => void);
```

Fail-loud rules (Codex P0):

- `openSource` / `openDestination` throw with the endpoints actually seen if
  the requested `id` is missing. The mapping layer surfaces that in the red
  chip; nothing here silently auto-picks.
- `send` validates every byte is `0-255`, requires an explicit destination,
  and fails loudly when that destination is gone.
- Hotplug fires `endpointsChanged` on CoreMIDI's
  `msgObjectAdded / msgObjectRemoved / msgSetupChanged` notifications, letting
  the JS runtime re-resolve endpoints on replug.

## Build

Nothing to hand-edit — Expo autolinking discovers the module during
`expo prebuild --platform ios --clean`. See
`.agent/ops/build_ipad_release.md` for the full iPad build steps.

## Sources

- Apple: [CoreMIDI Reference](https://developer.apple.com/documentation/coremidi)
- Expo Modules API: <https://docs.expo.dev/modules/overview/>

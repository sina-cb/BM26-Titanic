# 2026-06-19 — Art-Net output transport (sACN + Art-Net, per controller)

DEVELOPER agent, branch `dev/claude/views_rehaul`. Adds an Art-Net output
transport alongside the existing sACN/E1.31, selectable per controller.
Operator decision: transport tops out at sACN + Art-Net — NO DDP /
WLED-native. No firmware changes.

## Files added

| File | What |
|---|---|
| `marsin_engine/lib/artnet_output.js` | ArtDMX packet builder + UDP sender (Node `dgram`, no new deps) |
| `marsin_engine/lib/output_dispatch.js` | Per-controller transport routing; one interface identical to a single sACN sender |
| `marsin_engine/tests/artnet_output.test.js` | ArtDMX byte-format + real loopback UDP send proof |
| `marsin_engine/tests/output_dispatch.test.js` | Routing partition + Art-Net-on-the-wire + fail-loud tests |

## Files changed

| File | Change |
|---|---|
| `simulation/src/dmx/controller_registry.js` | New `protocol: 'sACN' \| 'artnet'` field (explicit default sACN, loud schema-migration via `_unprotocolledControllers`); `isArtnetController`, `setControllerProtocol`; `addController` honors protocol |
| `simulation/src/gui/controller_map_editor.js` | sACN/Art-Net transport toggle button on each controller card (next to the DMX/LED toggle) |
| `simulation/style.css` | `.cm-proto-artnet` style (amber) so Art-Net stands out from the default sACN |
| `simulation/main.js` | Loud one-time log for un-protocolled controllers (mirrors the un-typed log) |
| `simulation/scenes/test_bench/controllers.yaml` | Explicit `protocol: sACN` on the demo controller (schema example) |
| `marsin_engine/engine.js` | Output build switched from `createSacnOutput` to `createOutputDispatch` (identical sender interface — every call site unchanged); reads optional `config.controllers` |
| `marsin_engine/config.yaml` | Documented (commented) `controllers:` routing block schema |

## Packet format (ArtDMX, OpOutput 0x5000)

18-byte header + DMX payload (≤512, padded up to an even slot count):

```
0   ID         8  'Art-Net\0'
8   OpCode     2  0x5000  (lo-byte first → bytes 0x00 0x50)
10  ProtVer    2  big-endian 14  (bytes 0x00 0x0E)
12  Sequence   1  rolling 1..255 per universe (0 = ordering disabled)
13  Physical   1  0
14  SubUni     1  low 8 bits of 15-bit Port-Address
15  Net        1  top 7 bits of 15-bit Port-Address
16  Length     2  DMX slot count, BIG-endian
18..           N  DMX channel bytes (same 512-channel data the sACN path sends)
```

Port-Address = `(net<<8)|(subnet<<4)|universe`; for the single-net rig a
controller's universe number maps straight onto the 15-bit address
(net/subnet 0). Sent via UDP to the controller's host on port **6454**.
The DMX channel data is byte-identical to the sACN path — only framing and
port differ. Out-of-range universes/net/subnet THROW (no silent wrap).

## Per-controller routing

`config.controllers` (optional) declares
`{ name, host, protocol, universes:[…] }` per controller. The dispatch
partitions the engine's universes:

- Declared `protocol: artnet` → Art-Net sender to `host:6454`.
- Declared `protocol: sACN` → sACN unicast sender to `host`.
- **Undeclared** universes → flat-destinations sACN sender (the
  long-standing engine default — explicit documented behavior, not an
  error-hiding fallback), so the sACN path stays byte-identical for every
  controller not opting into Art-Net.

Fail-loud (codex P0): a declared controller with a missing/unrecognized
protocol or host THROWS at construction; two controllers claiming the same
universe THROWS (ambiguous routing). Nothing invents a default for
declared-but-broken state.

The sim side (`controller_registry`) is the operator-facing source of truth
for the per-controller `protocol`; the engine consumes the same decision via
the `config.controllers` routing block. (No sim→engine controllers.yaml
bridge exists today — that wiring is a separate follow-up; the engine reads
its routing from config.yaml.)

## Test results

- `node --check` — all touched/new JS files pass.
- Engine: `node --test tests/*.test.js` → **869 pass / 0 fail** (was 832;
  +37 across the two new test files).
- Sim: `npm test` → **112 pass / 0 fail** (was 106; +6 protocol tests).
- Engine auto-checks: `node engine.js --list` OK; dry-run exits 0 clean.

Proof of correctness includes asserting the exact ArtDMX bytes for a known
universe+data (header/opcode/protver/port-address/length/payload) and a real
loopback UDP socket that receives a datagram from both `createArtnetOutput`
and the full `createOutputDispatch` Art-Net route.

## Hardware-validation caveat

This **cannot be validated against real Art-Net hardware in this
environment**. The packet-format byte assertions + the loopback-UDP send
tests + the routing unit tests are the proof. Confirmation against a
physical Art-Net node/fixture on the rig is the operator's to make.

## Smoke residue (not committed)

The working tree carried pre-existing modifications from the branch / other
agents (e.g. `marsin_engine/models/titanic.js`, `*.viewmasks.js`,
`states/*/audio_state.yaml`, scene playlists/views, `auto_views.js`). These
are NOT mine and were left untouched — only the files listed above were
committed.

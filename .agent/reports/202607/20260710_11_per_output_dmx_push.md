# 2026-07-10 · Sim-side per-output sACN universe push path

Branch `feat/led_integration`. Adds the sim's per-output DMX push: assign a
distinct sACN universe per enabled MarsinLED output, deploy via read-modify-
write, verify from `sacn.perOutput`, and revert to the global mapping.

## Wire contract verified live (READ-ONLY GET, 10.x.x.202)

- `GET /api/status` → `capabilitiesExt.perOutputDmx === true`, `sacn.perOutput
  === []` (legacy), `firmwareSHA cb20b07b19c7`, 4× `WS281X_RGBW` strands (2
  enabled 40px).
- `GET /api/config` strands carry no `dmxUniverse`/`dmxStartAddress` (legacy
  global mapping). Confirmed the parsing against these bodies; no POST issued.

## Files touched (only the assigned zone)

- `simulation/src/dmx/led/marsinled_client.js`
- `simulation/src/dmx/led/device_config_mapper.js`
- `simulation/src/gui/led_discovery_panel.js`
- `simulation/tests/per_output_push.test.js` (new), plus the path exercised by
  the existing two suites (unchanged, still green).

## Public API added

`marsinled_client.js`
- `deviceSupportsPerOutput(status)` → bool (`capabilitiesExt.perOutputDmx===true`).
- `readPerOutput(status)` → `sacn.perOutput` array (`[]` legacy; throws if present
  but non-array).
- `validatePerOutputPlan(strands, universeByOutputIndex)` → `{spans,
  enabledIndices, universes}`; enforces all-or-none, sACN-only (start=1), span≤16,
  no-overlap-on-spill, range 1–63999.
- `applyPerOutputUniverses(strands, universeByOutputIndex)` (pure RMW: set fields
  on enabled, copy disabled untouched).
- `stripPerOutputUniverses(strands)` (pure RMW: remove the two fields).
- `pushPerOutputUniverses(ip, {universeByOutputIndex, opts})` → GET config →
  validate → apply → POST `text/plain` → device reply.
- `revertPerOutput(ip, opts)` → GET config → strip → POST.
- Refactor: legacy `pushConfig` now shares a private `postConfigBody` helper (its
  behavior/signature unchanged); the 400 path now also surfaces `fields[].detail`.

`device_config_mapper.js`
- `derivePerOutputPlan(controller, strandFixtures, deviceSnapshot)` →
  `{universeByOutputIndex, warnings}` from each enabled output's `port.universe`
  (S4), start=1; collects a warning (never throws) for a missing/invalid universe.
- `autoAssignPerOutputUniverses(controller, base)` → pure contiguous-run helper
  (enabled ports in order → base, base+1, …).

`led_discovery_panel.js`
- `startPush` now GETs status and branches on `deviceSupportsPerOutput`: per-output
  path (confirm dialog shows the exact strands payload + reboot warning → push →
  awaitReboot → read `sacn.perOutput` → green on match / red diff) or the unchanged
  legacy push (now annotated "firmware predates per-output DMX — update firmware").
- New "Revert to global mapping" action on the bound-controller section.

## Exact JSON the RMW POSTs for 202 (out1→U3, out2→U4)

```json
{
  "strands": [
    {"type":"WS281X_RGBW","count":40,"pinData":35,"pinClock":0,"colorOrder":"RGBW","rgbwMode":"exact","enabled":true,"deadPixels":0,"deadPixelIndices":[],"dmxUniverse":3,"dmxStartAddress":1},
    {"type":"WS281X_RGBW","count":40,"pinData":36,"pinClock":0,"colorOrder":"RGBW","rgbwMode":"exact","enabled":true,"deadPixels":0,"deadPixelIndices":[],"dmxUniverse":4,"dmxStartAddress":1},
    {"type":"WS281X_RGBW","count":40,"pinData":37,"pinClock":0,"colorOrder":"RGBW","rgbwMode":"exact","enabled":false,"deadPixels":0,"deadPixelIndices":[]},
    {"type":"WS281X_RGBW","count":40,"pinData":38,"pinClock":0,"colorOrder":"RGBW","rgbwMode":"exact","enabled":false,"deadPixels":0,"deadPixelIndices":[]}
  ],
  "dmx": {"enabled":true,"protocol":0,"timeoutMs":3000}
}
```

Content-Type `text/plain;charset=UTF-8` (the CORS-preflight fix). Disabled strands
(37/38) are copied wholesale with no per-output fields added.

## Tests

`node --test tests/per_output_push.test.js tests/marsinled_client.test.js
tests/device_config_mapper.test.js` → 62 pass / 0 fail. Covers derive-from-
port.universe, auto-assign, RMW preserves disabled strands + all fields, all-or-
none / span>16 / overlap-on-spill / range rejections, revert strips the fields,
read-back parse, feature-gate, and device-400 `fields[].detail` surfacing.

## Needs the operator's live device test

- Actual POST + reboot to 10.x.x.202 (only READ GETs were done here). Confirm the
  reply is `{outcome:"needs-reboot", reboot:true}`, the device comes back, and
  `sacn.perOutput` reports `[{index:0,universe:3,startAddress:1,enabled:true},
  {index:1,universe:4,...}]` (the green-match path).
- The "Revert to global mapping" round-trip (expect `sacn.perOutput` back to `[]`).
- End-to-end in the sim UI: confirm dialog renders the payload, reboot/verify
  status transitions, and the firmware-too-old note on any legacy controller.

# `_126` — GAMMA push learns the `deviceName` repair (follow-up to `_124`)

Developer thread, 2026-08-03. Branch `feat/bm_readiness`. Subsystem:
`simulation/` LED gamma push (docs/41 §4.1/§4.1.1). **No git operations, no
live device touched** — the fix lands at the payload-construction seam with
unit tests.

---

## 1. The exposure (`_124` §5 follow-up)

`_124` proved live that MarsinLED's `ConfigManager::update` merges a partial
`POST /api/config` body into the STORED config and validates the WHOLE merged
document: a board whose stored `deviceName` is invalid (fresh boards ship with
`""`) rejects **every** config write with `400 field=deviceName` — the proof
probe was literally a **no-op gamma write**. `_124` fixed the per-output push
(`deviceNameRepairForPush` in `marsinled_client.js`); the gamma path —
`simulation/server/led_gamma_service.cjs`, driven by both the save-server route
`POST /led/gamma-push` and the CLI `agent_tools/led_gamma_push.cjs` — still
POSTed a bare `{gamma}` and would fail on such a board with the device's
misleading message while the operator stares at a gamma payload.

## 2. The fix — same doctrine, ONE implementation

### Sharing across the module-system boundary

`led_gamma_service.cjs` is CommonJS; `marsinled_client.js` is a browser ES
module. No precedent existed for sharing logic between `simulation/src` and
`simulation/server` — so instead of a parallel copy pinned by comments, the
service **requires the client module directly** via Node's native
`require(esm)` (>= 22.12; this box runs 24.x, verified before committing to
the approach). The `.cjs` therefore executes the client's *own*
`deviceNameRepairForPush` — the regex-parity guarantee is **object identity**,
not resemblance (pinned by a test: `require()` and `import` of the client
yield the same function/regex objects). On an older Node the `require` at the
top of the file crashes at startup — the correct loud failure (codex P0), and
`marsinled_client.js` has zero imports and no top-level browser globals, so
the require is clean.

### `simulation/server/led_gamma_service.cjs`

- **`gammaPushBody({ip, gamma, storedDeviceName, controllerName})`** — pure,
  the payload-construction seam. Delegates the decision to the client's
  `deviceNameRepairForPush`:
  - stored name valid or absent → `{gamma}` only (never renames a working
    device, never invents an unreported field);
  - stored name present + invalid → `{gamma, deviceName: <card name VERBATIM>}`
    plus the repair record (logged before the POST);
  - stored invalid + card name unusable → **THROWS kind `invalid` before the
    POST**, naming the exact rename, with the docs/41 §4.1.1 pointer and the
    CLI escape hatch (`--device-name`). No sanitizing, no fallback.
- **`gammaRejectionError(host, replyJson, body)`** — pure. A `field=deviceName`
  400 on a body that never carried the field is rephrased as the §4.1.1
  merge-validation quirk (stored name invalid → every write rejected) instead
  of parroting the device. The note appears ONLY for that exact trap — a
  rejected repair or an ordinary gamma 400 keep their plain messages.
- `pushGamma` gains `opts.controllerName`, builds the body through the seam,
  **verifies the repaired name in the read-back** (a repair that didn't land is
  a `verify-mismatch`, same as a gamma mismatch), reports the post-push
  `deviceName`, and returns `deviceNameRepaired: {from, to} | null`.

### Callers

- `simulation/server/save-server.js` — `POST /led/gamma-push` passes
  `parsed.controllerName` through.
- `simulation/src/dmx/led/led_gamma.js` — `pushGammaToController` hands
  `controller.name` to the transport; `postGamma` sends it in the body. The
  card name rides along for exactly this one server-side use.
- `simulation/agent_tools/led_gamma_push.cjs` — new `--device-name <name>`
  flag (the CLI has no controller card; the flag is the operator's verbatim
  supply). Documented in the usage header: a board with a valid stored name is
  never renamed, whatever the flag says.

### Docs

`docs/41_led_controller_onboarding.md` §4.1.1 — paragraph recording that the
gamma push carries the identical repair, the `require(esm)` sharing, the UI/CLI
plumbing, and the diagnosed-not-parroted rejection.

## 3. Tests

New `simulation/tests/led_gamma_push_devicename.test.js` — 7 cases, `_126`
section style matching `_124`'s:

1. **one-implementation identity**: `require()` and `import` of
   `marsinled_client.js` hold the same `deviceNameRepairForPush` /
   `DEVICE_NAME_RE` objects, plus a source-string canary on the firmware rule;
2. valid stored name → gamma-only body (even with an illegal card name in
   hand — irrelevant when the device is healthy);
3. absent stored name → gamma-only body (never invented);
4. invalid stored `""` (the live `_124` failure) + legal card name → body
   carries the name **verbatim** beside the gamma;
5. invalid stored + unusable card names (spaces / >32 / missing) → loud
   refusal, kind `invalid`, naming the rename, with the §4.1.1 pointer (and
   `--device-name` hint on the missing-name case);
6. the `field=deviceName`-on-a-nameless-body 400 is explained (§4.1.1 note,
   `deviceError` preserved);
7. the note appears ONLY for that trap (rejected repair / plain gamma 400 stay
   plain).

`simulation/tests/led_gamma.test.js` — `okTransport` + the orchestration
assertion now pin that `pushGammaToController` passes `controller.name`.

**Results**: targeted run (`led_gamma_push_devicename` + `led_gamma` +
`per_output_push`) → 115/115. Full sim `npm test` → **1703 tests, 1695 pass,
8 fail** — the same 8 pre-existing scene-content baseline failures as the
`_123`/`_124` runs (`strand_metadata_drift @ 'TE Sign V3 A'/'B'`, titanic
view-bit headroom, scene-block CLI), none in the gamma or LED push paths.
**No new failures** (+7 tests over the `_124` count of 1696).

## 4. Files

| File | Change |
|---|---|
| `simulation/server/led_gamma_service.cjs` | `require(esm)` of the client doctrine; `gammaPushBody` seam; `gammaRejectionError` diagnosis; repair wired + read-back-verified in `pushGamma`; `deviceNameRepaired` in the result |
| `simulation/server/save-server.js` | `/led/gamma-push` passes `controllerName` through |
| `simulation/src/dmx/led/led_gamma.js` | transport carries `controller.name` |
| `simulation/agent_tools/led_gamma_push.cjs` | `--device-name` flag + usage doc |
| `simulation/tests/led_gamma_push_devicename.test.js` | new — 7 seam cases |
| `simulation/tests/led_gamma.test.js` | transport assertion pins the name plumbing |
| `docs/41_led_controller_onboarding.md` | §4.1.1 gamma paragraph |

## 5. Follow-ups (unchanged from `_124` §5)

- Discovery could surface an invalid stored `deviceName` as a loud card state
  instead of letting the first push (of either kind) find it.

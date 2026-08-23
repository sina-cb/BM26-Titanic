# 336 — Engine-side bike color link: implementation

> Wave: `feat/bm_readiness` working tree, 2026-08-20. Manager-verified.
> Scope: engine client side ONLY — the bike firmware side is already shipped
> and verified. No git operations were performed by this wave; nothing is
> committed or staged. No CaptainPad UI in this wave (the REST surface it
> will later consume is in place).

## What landed

The marsin_engine now knows how to discover MarsinLED bike controllers over
HTTP and mirror the operator-visible two-color palette
(`colorPalette1`/`colorPalette2`) out to them, under the firmware's 60 s
engine lease: the engine keeps a ~30 s keepalive cadence while linked, and
the moment it stops pushing (unlink, disable, crash, power loss) every bike
auto-restores its own pre-engine colors firmware-side. **The feature ships
DISABLED by default** — merging this changes nothing on the live rig until
the operator opts in.

### Files

| File | Change |
|---|---|
| `marsin_engine/lib/bike_color_share.js` | NEW — discovery scanner, link registry + per-bike state machine, keepalive push loop, metrics, config validation + runtime-file persistence |
| `marsin_engine/engine.js` | Wiring: construct `engineCore.bikeColorShare` at boot (non-fatal, fire-sync precedent), `stop()` in shutdown |
| `marsin_engine/lib/api_server.js` | `GET /bikes`, `POST /bikes/config` (placed beside the `/deck/color-autopilot` pair, same merge→validate→apply→persist shape) |
| `marsin_engine/config.yaml` | Appended documented `bike_color_share:` block — live keys `enabled: false`, `targets: ''`; every other field a commented default |
| `marsin_engine/tests/helpers/mock_bike_server.mjs` | NEW — loopback mock bike (full lease semantics, 4 personas) |
| `marsin_engine/tests/io/bike_color_share.test.js` | NEW — 13 in-process behavior tests |
| `marsin_engine/tests/io/bike_color_share_api.test.js` | NEW — 5 e2e tests against a real spawned engine (17560+ band, sACN black-holed to TEST-NET) |

## The firmware surface used (sanitized)

- `POST /api/colors` `{"color1":[h,s,v],"color2":[h,s,v],"engine":true}` —
  floats 0..1; engine writes are absolute and refresh a 60 s firmware-held
  lease; on expiry the bike restores its pre-engine colors itself.
- `GET /api/status` → `controllerId`, `mac`, `firmwareTag`, `activePattern`,
  `colors.engine.{leased,msRemaining}`. `GET /api/colors` also exists.
- Identity is `controllerId`, never IP. Older 1.x firmware without
  `/api/colors` (404) is marked `UNSUPPORTED` — no fallback write path (P0).

## Design shape as built

- **Lifecycle:** `DISCOVERED → LINKED → STALE → GONE` (+ `UNSUPPORTED`).
  Sweep (default 15 s) probes every configured target sequentially with a
  stagger — never a parallel blast at ESP32-class HTTP servers. STALE bikes
  auto-relink on rediscovery; STALE past `goneAfterMs` becomes GONE; GONE
  past `dropAfterMs` is dropped. A different `controllerId` answering at a
  known address (bike swap) immediately marks the prior holder STALE.
- **Keepalive:** default `pushIntervalMs` 30000, validated into
  `[20, 55000]` — the 55 s ceiling exists so one missed push still lands
  inside the 60 s lease. A push cycle overrunning its cadence warns loudly
  and is counted (`pushCycleOverruns`).
- **Frame-loop isolation:** the module lives entirely on its own unref'd,
  generation-guarded timers; every request carries
  `AbortSignal.any([stopSignal, AbortSignal.timeout(...)])`; nothing touches
  the 40 fps tick path. Proven by a timing assertion (below).
- **Config:** `config.yaml` `bike_color_share:` block for boot defaults;
  REST edits persist ONLY the feature block to
  `config.bike_color_share_runtime.yaml` (the ColorAutopilot runtime-file
  idiom — the tracked, comment-bearing `config.yaml` is never rewritten by
  code). Unknown keys, bad ranges, and out-of-bounds cadences are refused
  loudly, naming field and value.

### Deviations / decisions vs. the design brief

1. **Palette source = active-surface target values.** `getPalette` reads
   `colorPalette1/2` from `activeColorParamCenter(paramCenter,
   liveTouchSession)` — the Live Touch session's private ParamCenter when a
   session is live, the shared one otherwise (the exact
   `seedColorAutopilotFromActiveSurface` idiom). This is the operator-visible
   palette; the ParamCenter's private mid-fade `_rendered` interpolation was
   NOT exposed — at a 30 s cadence a sub-second OKLCH crossfade is
   unobservable, and reading targets needs no new seam into ParamCenter
   internals.
2. **`targets` is a comma list**, each entry `A.B.C.D`, `A.B.C.D:port`, or
   `A.B.C.D-A.B.C.E` (last-octet range), expansion capped at 256 — instead
   of a single ip-range field. Lets the operator pin known bikes and lets
   tests aim at loopback ports. Ships empty; never a hardcoded LAN default.
3. **Support check at discovery time** (`GET /api/colors` on new/degraded
   records), plus a 404 on a live push also demotes to `UNSUPPORTED`. An
   unexpected non-200/404 on the support check is treated as a transport
   failure: logged, state unchanged.
4. **Invalid palette** (getPalette throws or returns out-of-range values):
   loud error, `paletteErrors++`, cycle skipped — never pushes garbage,
   never throws from a timer. Skipped cycles don't count toward
   `pushCycles`/overrun stats.
5. **Corrupt runtime overlay file** is logged (warn) and ignored at boot —
   same posture as ColorAutopilot's loader, but louder (that one swallows
   silently).
6. One worker-integration fix by the manager: the e2e persistence test
   originally asserted an un-nested runtime YAML; the implementation follows
   the repo idiom (block wrapped under its feature key, exactly like
   `colorAutopilot:`), so the test was corrected to match the idiom.

## Gates — all personally re-run by the wave manager

| Gate | Result |
|---|---|
| Baseline full suite BEFORE changes | **3941 tests, 3941 pass, 0 fail** (223.9 s) |
| New tests (unit + e2e, run directly) | **18/18 pass** (15.9 s) |
| Full suite AFTER changes | **3959 tests, 3959 pass, 0 fail** — baseline + 18, zero regressions |
| `node --check` on all touched JS + `npm run check:dry-run` | pass |
| Tracked state files | `git status --porcelain` diff vs. pre-wave snapshot: only the 7 wave files changed by this wave. Late in the wave `states/test_bench/deck_state.yaml` showed a 1-line change (`autopilot.active: true → false`) from a PARALLEL session on this box (unrelated reports landed in `.agent/reports/` at the same time); proven not ours: sha1 + mtime of the file are bit-identical across a full re-run of all 18 new tests. Expected engine residue per AGENTS.md — reported here, not reverted, not committed |
| Port hygiene | new code/tests reference only loopback, `:0` ephemeral binds, the 17560+ e2e band, and TEST-NET literals; grep for `696[6-9]|697[0-2]|6981|5568` over the new files: zero hits |
| Public-repo hygiene | IP-literal grep over new files: only `127.0.0.1`/`192.0.2.x`; the only MAC literal is the mock's synthetic locally-administered `02:00:00:00:00:01`; `python scripts/security_check.py --all`: zero findings in any wave file (remaining findings are pre-existing, in gitignored sim scene backups + a pre-wave `.agent` memory file) |

One transient full-suite run showed `tests/mixer/live_touch_base_swap.test.js`
failing under `--test-concurrency=4`; it passes 6/6 in isolation and the
clean full run above is 0-fail. Pre-existing wall-clock-sensitive flake, not
introduced by this wave (the wave touches no mixer code).

### Test coverage highlights (all against loopback mocks — no real bike was
ever contacted)

- Disabled-by-default proven twice: module-level (zero wire traffic with a
  bike sitting in `targets`) and engine-level (spawned engine, absent block
  ⇒ disabled, zero probes after 800 ms).
- Discovery ignores wrong devices (an HTTP server that isn't a bike) and
  dead ports; identity by `controllerId` incl. the same-address bike-swap
  case; STALE → auto-relink → GONE → dropped, end to end.
- Lease keepalive: with a scaled-down mock lease (450 ms) and cadence
  (150 ms), the mock's restore counter stays 0 across many cycles; after
  `stop()` the lease lapses exactly once and the mock restores its
  pre-engine snapshot.
- Old-firmware persona (404 `/api/colors`) is `UNSUPPORTED` and receives
  zero pushes, ever.
- 40 fps isolation: 4 slow bikes (900 ms responses) under a 150 ms cadence —
  a 25 ms interval "frame loop" never gaps ≥250 ms while push cycles run and
  overrun (a synchronously-blocking implementation gaps by seconds).
- e2e over a real spawned engine: `GET /bikes` shape, enable →
  discover → LINK → engine-flagged push carrying the engine's real palette
  as `[h,s,v]` float triples, disable stops all traffic, runtime-file
  persistence with `config.yaml` byte-identical, 400 naming the offending
  field on a bad config.

## How the operator enables it (nothing happens until this)

1. **Config route** — either edit `marsin_engine/config.yaml`:

   ```yaml
   bike_color_share:
     enabled: true
     targets: '192.0.2.10-192.0.2.20'   # your bike subnet range/list (example is TEST-NET) gitleaks:allow
   ```

   and restart the engine, **or** live over REST, no restart:

   ```bash
   curl -X POST http://127.0.0.1:6968/bikes/config \
     -H 'Content-Type: application/json' \
     -d '{"enabled":true,"targets":"192.0.2.10-192.0.2.20"}'   # gitleaks:allow (TEST-NET example)
   ```

   The REST route persists to `config.bike_color_share_runtime.yaml`
   (overlaid on the config block at every boot), so it survives restarts.
   Targets accept `A.B.C.D`, `A.B.C.D:port`, and `A.B.C.D-A.B.C.E` entries,
   comma-separated, ≤256 addresses total.

2. **Linked status** — `GET http://127.0.0.1:6968/bikes` → per-bike
   `controllerId`, address, `LINKED|STALE|GONE|UNSUPPORTED`, `firmwareTag`,
   `activePattern`, `lastSeenMs`, `leaseMsRemaining`, push counters, plus
   global sweep/push/overrun stats. This is the surface a future CaptainPad
   panel reads.

3. **Unlink** — `POST /bikes/config {"enabled":false}` (or flip the yaml and
   restart). The engine simply stops pushing; every bike reverts to its own
   colors within ≤60 s by firmware lease expiry — no revert traffic needed.

4. This wave is working-tree only: review, commit, and the usual launcher
   bounce after landing are the operator's/coordinator's call. The engine
   picks the feature up at boot (or immediately via the REST route on the
   running instance once this code is live).

## Process notes

Built by two Sonnet slices (W1 module+wiring+REST, W2 mocks+tests) against a
manager-frozen contract; manager re-ran every gate independently, fixed the
one integration mismatch (runtime-YAML nesting, item 6 above), and corrected
two comment inaccuracies ("Stoker" → MarsinLED in test headers). Follow-up
candidates for the Notion board: a CaptainPad linked-status panel over
`GET /bikes`, and an operator-facing decision on default `targets` for the
playa network (deliberately not hardcoded here).

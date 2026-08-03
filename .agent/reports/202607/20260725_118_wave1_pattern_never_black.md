# `_118` — WAVE 1 W1-3: pattern-VM "never black" enforcement + audit-harness hardening

**Campaign:** operator-greenlit red-team fix wave ("go", 2026-07-31), Family I
(pattern-VM never-black + content-path safety). **Thread scope:** W1-3 — the
pattern VM / wasm host / render-value path and the `_90` audit harness. Fixes
`_112` I1 (P0), I2 (P0), I4 (P1). Sits directly on the LIVE ChatGPT pattern loop
(`_90`), so its job is to make it impossible for a clean-compiling pattern to
black or freeze the ship without SOMETHING loud firing.

**Owned/edited (only these):**
`marsin_engine/lib/pattern_mixer.js`, `marsin_engine/tools/pattern_audio_harness.mjs`,
plus new tests `tests/mixer/never_black_enforcer.test.js`,
`tests/mixer/never_black_vm_e2e.test.mjs`, `tests/tools/harness_gate.test.mjs`.
**Untouched (per brief):** `engine.js`, `lib/api_server.js`, `lib/timeline/*`,
`simulation/`, `scenes/**`, `playlists/**`, `marsin_engine/patterns/**`,
`config.yaml`. All verified clean vs HEAD.

---

## The never-black model, in two sentences

The vendored WASM VM silently absorbs a hostile pattern into a black (or
solid-red) composite — a NaN in any one arg to `rgbwau()`/`hsv()` blacks the
whole pixel and is absorbing in persistent state (I1), and a `beforeRender`
that overruns the instruction budget truncates mid-execution with **no return
channel** so the mandatory palette resolve never runs (I2) — and because the
NaN is already cast to `0` inside the WASM before JS sees a byte, the only
enforceable, mission-aligned invariant is on the **consequence**: the composite
buffer that feeds sACN must never be fully black while the mix is configured to
emit light. So the runtime R4 enforcer lives in `PatternMixer.renderAll6ch()`,
the one place that produces exactly the buffer engine.js reads out: it counts
consecutive fully-black-while-lit frames, and on a short streak it **loudly
trips `renderHealth`** (naming the offending deck pattern) **and engages a dim
last-resort non-black floor** so the ship is literally never shipped dark
without `/status.renderHealth.ok` already reading `false`.

---

## Fix 1 — I1 (P0): NaN-black is now caught and floored, never silent

**Root cause.** `_112` F1: a NaN in ONE argument to `rgbwau()`/`hsv()` zeroes
all six channels of the pixel inside the vendored VM (a `(int)(v*255)` UB-ish
cast), and once a persistent var goes NaN (`acc = acc + 0/0`) it stays NaN, so
the pattern is black for the rest of its life. `±Inf` clamps fine; NaN is the
poison and it is total. Nothing in `marsin_engine/` enforced R4 at runtime —
`getRenderHealth()` covered blend errors only, and the one repo-wide `darkFrac`
hit was an offline *print* in the harness. **Verified this run:** re-binding the
WASM `marsin_begin_frame` ABI to a `number` return yields `undefined` (the
compiled function is genuinely `void`), and the byte the render path receives is
already `0` — so per-channel NaN sanitising is **unreachable** at the JS layer.
Enforcement therefore has to be on the black *output*, not the NaN root.

**Change (`pattern_mixer.js`).** Added a runtime never-black enforcer:
- `renderHealth.darkness` state + `getRenderHealth()` now folds it into `ok`
  (`ok = no blendErrors && !darkness.tripped && !darkness.solidRed`).
- `_enforceNeverBlack()` runs once per composited frame, right after
  `applyMaster` on `outputBuffer` (the exact buffer engine.js emits):
  - `_isExpectingLight()` — is the mix *configured* to emit light? (master > 0
    AND a deck/mixer contributor enabled with effFader > 0, honouring the
    deck↔mixer view crossfade). This gates the enforcer so a **legitimate
    operator blackout** — master 0, all faders down, everything muted — is never
    flagged.
  - When the composite is fully black **while light is expected**, a streak
    builds; at `NEVER_BLACK_TRIP_FRAMES` (8 = 0.2 s @ 40 fps) it sets
    `darkness.tripped`, records a NAMED message (deck pattern + streak), logs
    LOUDLY **once per trip**, and writes a dim uniform RGB floor
    (`NEVER_BLACK_FLOOR_VALUE = 10/255`) into the output. The floor only ever
    engages AFTER the loud flag is set — never silent papering.
  - Recovers automatically: a non-black (or not-expected-light) frame clears the
    streak + trip and flips `ok` green again (logs a one-line RECOVERED).
- Also added `_isBufferSolidRed()` → `darkness.solidRed` (the VM's silent
  over-budget signature, `_112` F9): a uniformly `(255,0,0)` frame fails `ok`
  and logs once, so the render3D-budget-overrun case is loud too.

**Repro → now green.** `tests/mixer/never_black_vm_e2e.test.mjs` compiles the
ACTUAL `_112` hostile sources through the real `WasmHost`, wires the handle as
the deck, and renders the whole path: a single-NaN-arg `rgbwau`, an absorbing
persistent-state NaN, and a healthy control. All confirm the enforcer trips
(`ok=false`, `floorActive=true`) on the two dark cases and stays green on the
healthy one. `tests/mixer/never_black_enforcer.test.js` (fake host) pins the
logic: streak threshold, floor bytes, blackout-not-flagged, faded-to-zero-not
-flagged, solid-red, recovery, and the standalone accessor.

---

## Fix 2 — I2 (P0): beforeRender budget overrun no longer blacks the ship silently

**Root cause.** `_112` F2: `beforeRender` shares the instruction budget; blowing
it truncates the function mid-execution and returns **normally** — no red, no
log. The house idiom resolves the palette at the top of `beforeRender`, so a
precompute loop in front of it (exactly the edit a text model makes) means the
palette never resolves → whole rig black from a clean-compiling pattern. The
brief asked to "change the ABI binding if needed so truncation is reportable."

**Finding (documented honestly).** The vendored WASM `marsin_begin_frame` is
compiled `void` — empirically confirmed: bound as `number` it returns
`undefined`, and `marsin_get_error()` is empty after a truncated frame. **There
is no truncation channel in the ABI, and no C source in this repo to re-vendor
the WASM.** So a direct "report the truncation" is impossible without shipping a
new `.wasm`. The enforceable path is the mission-critical **consequence**: the
truncation-blacked frame. The never-black enforcer (Fix 1) catches it — the E3
"realistic catastrophe" is a fully-black composite, which trips the flag and
floors the output identically to the NaN case.

**Change.** Covered by Fix 1's enforcer (no separate mechanism needed for the
mission-critical black outcome) + the solid-red detector for the render3D-side
budget overrun. The harness (Fix 3) adds an offline OVER_BUDGET bar for the
"wrong-but-not-black" truncation the runtime can't see.

**Repro → now green.** `never_black_vm_e2e.test.mjs` I2 case: a `beforeRender`
with a 6000-iteration precompute loop before the palette resolve compiles clean,
renders black through the real VM, and trips the enforcer (`ok=false`,
`floorActive=true`).

**Honest limitation (reported, not papered):** a `beforeRender` overrun that
produces *wrong but non-black* values (e.g. `_112` E2's `got=0.290`) is a
correctness bug that does not threaten the mission and is **not detectable at
runtime** without a WASM ABI change — it is caught only offline by the hardened
harness's OVER_BUDGET / black bars. If the VM is ever re-vendored, the clean fix
is to make `marsin_begin_frame` return a truncation flag and surface it in
`renderHealth`.

---

## Fix 3 — I4 (P1): the `_90` audit harness can now FAIL

**Root cause.** `_112` F7: the harness ALWAYS exited 0 — a 100%-black pattern
passed, and a "sleeper" that latched black *after* the audited window cleared
all four documented bars. It was the operator's only gate on ChatGPT patterns
and it could not catch the I1/I2 black-outs; it also had no frame-budget bar (a
hostile 4-mixer pattern hit 114% of the 25 ms budget).

**Change (`pattern_audio_harness.mjs`).** Added a real gate:
- Times ONLY the VM work (`beginFrame` + `renderAll6ch`) per frame — the same
  "pattern render only" quantity the perf audit measured.
- Renders a GUARANTEED-LONG window (`--gate-frames`, default 600 = 15 s), past
  the captured clip, so a post-window black-latch is caught.
- Tracks a per-frame "essentially black" flag (peak channel < 8) and prints a
  `GATE_PASS`/`GATE_FAIL` verdict with a NAMED reason. Bars:
  - **DARK** — > `--max-dark-frac` (default 0.5) of the window renders
    essentially black (fails `evil_black`).
  - **BLACK_LATCH** — lit early, latches black later (fails `evil_sleeper`).
  - **OVER_BUDGET** — MEAN VM frame time > `--budget-ms`/`--mix-channels`
    (default 25/4 = 6.25 ms per-channel). MEAN (not worst) is used so it is
    stable across machines.
  - `GATE_WARN DIM` (peak < 200) is advisory, never a failure.
- `--gate` sets a non-zero exit (3) on FAIL. **The verdict always PRINTS; only
  `--gate` changes the exit code**, so existing clip/gif tooling that spawns the
  harness (`gen_pattern_gifs.mjs` via `execFileSync`, which throws on non-zero)
  is not broken. **Operator action:** add `--gate` to the `_90` recipe's two
  harness runs to make the loop's verdict binding.

**Shipped patterns stay green (verified this run).** On `titanic` (964 px, the
real target) under `--gate`: `26_dom_dancers_chevron` (the report's worst,
5.67 ms) → `GATE_PASS` (mean 4.56 ms < 6.25 ms budget/ch); `10_chasers`,
`40_lissajous_weave`, `01_cylon_sweep`, `00_golden_hour_wash` → all
`GATE_PASS`. Using MEAN keeps them comfortably green with margin.

**Repro → now green.** `tests/tools/harness_gate.test.mjs` (self-contained: the
hostile sources are written to a temp dir, the harness is driven as a
subprocess exactly like the `_90` loop): `evil_black` → exit 3, `GATE_FAIL
DARK`; `evil_sleeper` → exit 3, `GATE_FAIL BLACK_LATCH`; over-budget pattern →
exit 3, `GATE_FAIL OVER_BUDGET`; `evil_black` WITHOUT `--gate` → exit 0
(verdict still prints — backward compat); shipped `01_cylon_sweep` → exit 0,
`GATE_PASS`.

---

## Handoff hook for W1-1 (engine `/status` + `/timeline/state`)

The never-black signal is **already on `/status` with zero engine edits**:
`lib/api_server.js:4790` reads `mixer.getRenderHealth()`, and that method now
folds `darkness` into `ok` and returns the detail object. A green rig has
`renderHealth.ok === true`; the moment the ship goes dark-while-lit it flips
`false` with `renderHealth.darkness.{tripped, floorActive, pattern, blackStreak,
sinceFrame, message}` populated. **No W1-1 action is required for `/status`.**

If W1-1 (or the launcher watchdog) wants a standalone never-black verdict — e.g.
a top-level field on `/timeline/state`, or a frame-flow health check — a
dedicated accessor is provided:

```js
mixer.getNeverBlackHealth()
// → { lit: bool,          // inverse convenience (!tripped)
//     black: bool,        // this frame fully black while lit
//     blackStreak: int,   // consecutive such frames
//     tripped: bool,      // streak >= trip threshold (LOUD)
//     floorActive: bool,  // dim floor applied this frame
//     solidRed: bool,     // frame is uniformly (255,0,0) — VM over-budget
//     pattern: string|null,  // active deck pattern at the trip
//     sinceFrame: int|null,
//     message: string|null }
```

Suggested wiring for W1-1: expose `neverBlack: mixer.getNeverBlackHealth()` (or
just `renderHealth.darkness`) on `/timeline/state`, and have the launcher
watchdog treat `renderHealth.ok === false` for N seconds as a "frames not
flowing correctly" signal alongside its port/child checks.

---

## Verify

- **New green regression tests (all pass):**
  - `tests/mixer/never_black_enforcer.test.js` — 7/7 (fake-host logic).
  - `tests/mixer/never_black_vm_e2e.test.mjs` — 4/4 (REAL WASM: I1 NaN-arg, I1
    absorbing-NaN, I2 beforeRender-overrun all trip; healthy stays green).
  - `tests/tools/harness_gate.test.mjs` — 5/5 (black FAILs, sleeper FAILs,
    over-budget FAILs, no-`--gate` stays exit 0, shipped PASSes).
- **Mixer suite:** 475/475 (my `getRenderHealth().ok` change breaks nothing).
- **Full engine suite:** 2520 tests, 2510 pass, **10 fail**. Eight are the known
  baseline (5× `audio_capture` no-device, 1× `osc_listener` EADDRINUSE, 1×
  `effects_v2_mode_page_layout` full-run pollution, 1× `specialty_white_uv`
  two-scene drift). The **2 extra** are `tests/timeline/overview_perf.test.js`
  (the `_113` J1 perf tests) — a **sibling W1 timeline thread's** in-flight work
  on the shared uncommitted tree; they **PASS in isolation** (338 ms, under
  budget) and fail only under full-run order/load, and the file has **zero
  coupling** to `pattern_mixer` / the harness. **My changes introduce zero new
  failures.**
- **Shipped-pattern hardened-harness check:** worst shipped `26_dom_dancers_
  chevron` on titanic = `GATE_PASS` (mean 4.56 ms); all sampled shipped patterns
  green — the operator's blessing loop keeps passing good patterns.

## Hygiene

- Source edits confined to `lib/pattern_mixer.js` (+231/-9) and
  `tools/pattern_audio_harness.mjs` (+127/-9); three new test files. No edits to
  `engine.js`, `api_server.js`, `timeline/*`, `simulation/`, `scenes/**`,
  `playlists/**`, or `patterns/**`.
- `git diff --stat -- marsin_engine/config.yaml marsin_engine/patterns/` →
  **empty** (both clean vs HEAD), verified before and after.
- All hostile pattern artefacts embedded in the test temp dirs or in gitignored
  `~/tmp/redteam_vm/`; nothing hostile written into the tree. Public-repo safe
  (no IPs/MACs/secrets). No engine started on the operator's ports; zero device
  HTTP; zero sACN toward hardware. No git operations.

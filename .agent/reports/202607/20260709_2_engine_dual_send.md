# 2026-07-09 — Engine dual-send opt-in (`alsoFlat`) for output routing

**Branch:** `feat/led_integration` · **Scope:** LED Integration plan
`20260709_0_led_integration_execution.md`, **P5 engine part only** — the
per-controller `alsoFlat` dual-send. NOT the model re-export, NOT anything in
`simulation/` or `CaptainPad/`.

## Problem

Today a universe claimed by a `controllers:` entry is routed *only* to that
controller's transport and stops reaching the flat `sacn.destinations`
(127.0.0.1 sim bridge). The moment an LED controller claims the LED universe,
the sim goes dark for it — a parity gap. We need an explicit, per-controller
opt-in that keeps the sim fed while the hardware also gets the stream.

## Change

Added a per-controller boolean **`alsoFlat`** (default `false`) to the
controller routing schema. When `true`, that controller's universes are sent
to the controller's transport **and** continue to the flat sACN destinations
(dual-send). The universe is then owned by two senders — the per-controller
sACN/Art-Net sender and the flat-destinations sACN sender — and `sendFrame`
delivers the buffer to both.

Every existing behavior is preserved: `alsoFlat` absent/`false` keeps today's
exclusive routing; DMX (undeclared) universes are untouched; the flat sender
is still created for undeclared universes exactly as before.

### Fail-loud / unknown-key decision

The existing `normalizeControllerRouting` reads only `name`, `protocol`,
`host`, `universes` and **silently ignores any other keys** — it has no strict
unknown-key rejection. Per the task's instruction, I did **not** add
whole-entry strict rejection (that would break existing configs). I added
strict rejection **only for `alsoFlat` mistypes**: a present-but-non-boolean
`alsoFlat` (e.g. `"yes"`, `1`) throws at normalize time (codex P0). Other
unknown keys remain silently ignored, unchanged. Flagging this explicitly as
requested.

## Files changed (only the three in the allowed zone)

- `marsin_engine/lib/output_dispatch.js`
  - Module + function docstrings document the dual-send opt-in and its
    fail-loud rule.
  - `normalizeControllerRouting`: validates `alsoFlat` (non-boolean throws),
    threads `alsoFlat` into both the `byUniverse` decl and each normalized
    controller entry (defaults `false`).
  - `createOutputDispatch`: the partition loop pushes an `alsoFlat` universe
    onto `sacnDefaultUniverses` (the flat sender) *in addition* to its
    controller bucket.
  - `_routing` now also exposes `flatUniverses` (every universe the flat
    sender carries) for testable introspection.
- `marsin_engine/tests/output_dispatch.test.js` — 6 new tests (see below).
- `marsin_engine/config.yaml` — extended the commented `controllers:` example
  with an `alsoFlat` explainer line and a commented `Titanic-201` MarsinLED
  entry (kept **commented out** — the live universe isn't allocated yet).

## Tests

New cases in `output_dispatch.test.js`:

- `alsoFlat` defaults `false` when absent.
- `alsoFlat: true` is recorded on the decl + normalized entry.
- non-boolean `alsoFlat` throws (`'yes'`, `1`) — fail loud.
- `alsoFlat: false` / absent keeps exclusive routing (universe NOT in
  `flatUniverses`; single sender).
- `alsoFlat: true` puts the universe in both the controller sender and the
  flat sender (`senderCount === 2`, `flatUniverses === [4]`).
- wire test: `alsoFlat: true` Art-Net controller — the ArtDMX packet still
  lands on the per-controller loopback port while `flatUniverses` confirms the
  flat sACN sender also owns the universe.

**`output_dispatch.test.js`: 18/18 pass.**

Full engine suite (`node --test tests/*.test.js`): **1605 / 1613 pass, 8
fail** — all 8 are pre-existing/environmental, none touch output_dispatch (the
failing set even varied run-to-run):
- `led_dmx_parity.test.js` — imports `simulation/src/core/state.js`, which
  needs the `three` package (not installed in `marsin_engine/node_modules`) →
  `ERR_MODULE_NOT_FOUND`.
- `audio_capture.test.js` (5) — "Windows audio capture requires a pinned
  device" (no mic configured on this box).
- `osc_listener.test.js` / `startAsync … EADDRINUSE` — sandbox network bind
  returns `EACCES` instead of the expected `EADDRINUSE`.
- `timeline_deck_release_default_cue.test.js` / `view_fader_ramp` — parallel
  test-runner worker crash / float-timing flake.

## Test residue (do NOT commit / revert)

Running the engine suite mutated tracked files as a side effect — expected
residue per the plan:
- `marsin_engine/states/summer_camp_dome/*.yaml`
- `simulation/scenes/summer_camp_dome/playlists/default.yaml`

Additionally, **`color_autopilot.test.js` load→mutate→save-serializes
`marsin_engine/config.yaml` through js-yaml, which strips ALL comments** (the
pre-existing `controllers:` example too) and appends a `colorAutopilot:` block.
Because git operations were off-limits for this task, I re-wrote `config.yaml`
by hand back to its intended state (original content + the new commented
`alsoFlat` docs, no `colorAutopilot` residue) after the suite runs. Anyone
re-running the full suite will re-strip the comments — worth a follow-up to
have config-touching tests use a temp copy so the documented `controllers:`
block survives.

## Live activation (once a universe is allocated)

The sim's universe allocator will assign the LED universe (expect **U3+** —
U1/U2 are the DMX bench). Once known, replace `<U>` and uncomment this block
in `marsin_engine/config.yaml`:

```yaml
controllers:
  - name: Titanic-201       # MarsinLED, verified lit at 10.x.x.201
    host: 10.x.x.201
    protocol: sACN
    universes: [3]          # the sim-allocated LED universe
    alsoFlat: true          # dual-send: hardware + sim bridge (sim ↔ LED parity)
```

`alsoFlat: true` streams U3 to both 10.x.x.201 (LEDs) and the flat
`sacn.destinations` (127.0.0.1 sim bridge), so the physical strands and the sim
strands animate identically.

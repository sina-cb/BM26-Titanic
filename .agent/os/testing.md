# Testing — layout & naming spec

How tests are organized across the repo, so the suites stay legible and
**every** test actually runs. Per-subsystem runbooks in `.agent/ops/*_auto_checks.md`
reference this file. (Established 2026-07-15 test-hygiene pass.)

## The one rule that prevents silent gaps

A test file must be picked up by its subsystem's **default** runner. Prove it:
run the suite and watch the **count go up**. The failure this prevents is real —
before the cleanup, 7 engine `node:test` suites (`.mjs`) were silently excluded
by a `*.test.js`-only glob and guarded nothing for months.

## File-type naming (the safety boundary)

| Kind | Pattern | Runs via |
|---|---|---|
| Unit / scenario test | `*.test.js` / `*.test.ts` / `*.test.mjs` | default suite |
| HIL harness (mutates a live engine) | `*_test.mjs` | `npm run test:hil` **only** |
| Eval / long corpus (>30 s) | `*.eval.mjs` | `npm run test:eval` |
| Shared helper / fixture | never `*.test.*` | imported, never auto-run |

The `.test.` infix vs `_test.` suffix is load-bearing: the engine default glob
`"tests/**/*.test.js" "tests/**/*.test.mjs"` matches units and **excludes every
HIL harness by construction**. NEVER switch the engine runner to bare directory
mode (`node --test tests/`) — on Node v24 it sweeps the `*_test.mjs` HIL files
into the run and hangs on the live engine.

## marsin_engine (`marsin_engine/tests/`)

Domain subdirs, a file lives in the bucket its name implies:
`audio/ companion/ timeline/ mixer/ effects/ state/ playlist/ io/`.
Plus `helpers/` (shared `spawn_engine.mjs`, `setup_config_guard.mjs` — never
`*.test.*`), `integration/` (corpus/analysis `node:test` suites + their `.mjs`
libs), `hil/` (43 `hil_*_test.mjs` harnesses + `hil_guard.mjs` + `hil_client.mjs`
+ `run_hil.mjs` dispatcher). HIL harnesses self-skip under `node --test` via the
`NODE_TEST_CONTEXT` guard in `hil_guard.mjs`. See `tests/README.md` +
`tests/hil/README.md`.

## CaptainPad (`CaptainPad/`)

- **Unit test** = co-located `<module>.test.ts` next to the module it tests
  (`manager`, `window_slot`, `resolver`, `learn`, `led_projector`, `knob_*`,
  `mft/*`, `components/*_logic`, `utils/*_api`, …).
- **Scenario / cross-module / shipped-yaml suite** → `utils/midi/scenarios/`
  (`vsn1_runtime`, `vsn1_feedback_pipeline`, `window_sync`, `apc_operator_layout`,
  `mft_profile`, `context_switching`). Descriptive names only — no
  `_regression` / `_v2` / review-codename cruft.
- Shared test doubles → `utils/midi/test_support/` (`fake_transport.ts`).
  NOT the prod `fake_demo_transport.ts` (that's app code).
- vitest globs (`vitest.config.ts`) are recursive under `utils/midi/**` and
  `components/**`; keep new files under a matched path.

## simulation (`simulation/tests/`)

Flat `*.test.js` (node:test) is fine at its size — leave it.

## Conventions going forward

- A test has ONE home. Don't re-assert the same behavior across files; put it
  in the module's unit test or the feature's scenario file, not both.
- Extract shared harnesses (transports, engine-spawn, http clients) into the
  `helpers/` / `test_support/` module — never paste them per file.
- Deleting a test as "dead"/"duplicate" requires proving the coverage survives
  elsewhere (grep the assertion in its new home) or that the code under test is
  genuinely gone.
- Deliberately shelved tests use `describe.skip` with a dated reason + the flag
  that un-shelves them (e.g. `BANKS_UI_ENABLED`). That's the allowed kind of
  skip; a bare skip is debt.

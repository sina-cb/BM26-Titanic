# Marsin Engine Auto-Checks Spec

This spec defines the required checks for `marsin_engine`, WASM-backed pattern
rendering, mixer state, HIL tests, and generated Pixelblaze models.

## Required Before Commit

Run from the repo root:

```powershell
git diff --check -- marsin_engine marsin_pb
```

Run JavaScript syntax checks on changed engine files:

```powershell
$files = git diff --name-only --cached -- marsin_engine |
  Where-Object { $_ -match '\.(js|mjs|cjs)$' }

foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Run the engine smoke checks:

```powershell
cd marsin_engine
npm install
node engine.js --list
node engine.js --pattern test_const --model test_bench --dry-run
```

The dry run must exit 0 and should not print missing blend/transition script
warnings.

## Package Script Target

Marsin Engine should expose these scripts in `marsin_engine/package.json`:

```json
{
  "scripts": {
    "check:syntax": "node --check engine.js",
    "check:dry-run": "node engine.js --pattern test_const --model test_bench --dry-run",
    "check": "npm run check:syntax && npm run check:dry-run",
    "test:hil:transition": "node tests/hil/hil_transition_test.mjs"
  }
}
```

The `check:syntax` script above is a minimum target. A stronger implementation
should run `node --check` across all changed engine JS/MJS/CJS files.

## HIL Setup

The HIL tests are live integration tests. They require a running engine and will
talk to it over HTTP and WebSocket on port 6968.

Terminal 1:

```powershell
cd C:\Users\sina_\workspace\BM26-Titanic\marsin_engine
npm install
npx -y kill-port 6968
node engine.js --pattern test_const --model test_bench
```

Wait until `/status` responds:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:6968/status
```

Terminal 2:

```powershell
cd C:\Users\sina_\workspace\BM26-Titanic\marsin_engine
node tests/hil/hil_transition_test.mjs
```

After the test:

```powershell
git diff -- marsin_engine/states/test_bench
```

The test must not leave tracked state changes. If it does, update the test to
snapshot and restore its state files in a `finally` block.

## One-Command HIL Runner Target

For local automation, create a script that starts the engine, waits for
`/status`, runs the HIL test, stops the engine, and restores state snapshots.
The script should live under `marsin_engine/tests/hil/`.

Required behavior:

1. Copy these files to a temp directory before starting:
   - `marsin_engine/states/test_bench/deck_state.yaml`
   - `marsin_engine/states/test_bench/mixer_state.yaml`
   - `marsin_engine/states/test_bench/globals_state.yaml`
2. Start `node engine.js --pattern test_const --model test_bench`.
3. Poll `http://127.0.0.1:6968/status` until ready or timeout.
4. Run `node tests/hil/hil_transition_test.mjs`.
5. Stop the engine process.
6. Restore the copied state files.
7. Exit nonzero if the HIL test failed or the engine did not become ready.

## Updating `hil_transition_test.mjs`

The current transition HIL test is useful but diagnostic-only. Before it is used
as a merge gate, update it as follows:

1. Remove the hardcoded pixel count.
   - Do not keep `PIXEL_COUNT = 64`.
   - Decode `vis.master` and derive `pixelCount = buffer.length / 6`.
   - Use that value for all loops and reporting.

2. Add real assertions.
   - Import `node:assert/strict`.
   - Track max and average brightness deltas.
   - Track max and average per-pixel RGB deltas at the 50/50 midpoint.
   - Fail the process when thresholds are exceeded.

3. Make thresholds explicit constants.
   - Example:
     ```js
     const MAX_BRIGHTNESS_DELTA = 5;
     const MAX_PIXEL_DELTA = 10;
     const MAX_AVG_PIXEL_DELTA = 5;
     ```
   - If the system intentionally allows larger deltas, document why in the
     header and set the threshold to that real acceptance limit.

4. Make cleanup reliable.
   - Wrap channel creation and test execution in `try/finally`.
   - Delete only the channels created by the test.
   - Restore mixer view to the value it had before the test.
   - Never leave `states/test_bench/*.yaml` modified after a successful run.

5. Separate diagnostic mode from gating mode.
   - Default mode should assert and fail on unacceptable deltas.
   - Optional `--diagnostic` mode may print warnings without failing.

6. Update `marsin_engine/tests/hil/README.md`.
   - Document exact setup commands.
   - Document thresholds.
   - Document which files, if any, the test may touch.

## Current Fix Targets

These issues were observed on `dev/mixer_impl` on 2026-05-07:

1. `blend_crossfade` is referenced but no channel blend script exists.
   - Either add `marsin_engine/patterns/channel_blends/blend_crossfade.js`, or
     change boot-created base channels to use an existing mode such as
     `blend_screen`.
   - The engine dry run should no longer print a missing script warning.

2. HIL transition test logs visual threshold warnings but exits 0.
   - Apply the HIL update plan above.
   - Treat warning-only HIL output as diagnostic, not merge-ready validation.

3. HIL docs and constants are stale.
   - `test_bench` currently loads 52 pixels in dry run, not 64.
   - Derive pixel count dynamically.

4. Generated WASM changes need provenance.
   - If `marsin_pb/wasm/*` changes, the branch should include the source change
     or a note explaining how the WASM artifact was rebuilt.

## What Counts As Done

A Marsin Engine change is done only when the final response includes:

- `git diff --check -- marsin_engine marsin_pb`: pass
- JS syntax check for changed engine files: pass
- `node engine.js --list`: pass
- `node engine.js --pattern test_const --model test_bench --dry-run`: pass with no missing blend warning
- HIL transition test: pass when mixer/blend behavior changed
- Confirmation that tracked state files were not modified by HIL

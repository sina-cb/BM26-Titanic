# Simulation Auto-Checks Spec

This spec defines the required checks for the browser-based 3D simulation,
fixture model exporter, DMX runtime, and scene YAML files.

## Required Before Commit

Run from the repo root:

```powershell
git diff --check -- simulation
```

Run JavaScript syntax checks on changed simulation files:

```powershell
$files = git diff --name-only --cached -- simulation |
  Where-Object { $_ -match '\.(js|mjs|cjs)$' -and $_ -notmatch '^simulation/unreal/' }

foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

If the files are not staged yet, replace `--cached` with the branch range under
review, for example:

```powershell
git diff --name-only origin/main..HEAD -- simulation
```

## Node Test Target

Simulation should expose a real test command in `simulation/package.json`:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.js",
    "check": "npm run test"
  }
}
```

Then run:

```powershell
cd simulation
npm run check
```

## Scene ↔ Model Parity Gate (REQUIRED for scene / model changes)

Whenever `simulation/scenes/<scene>/*.yaml` or
`marsin_engine/models/<scene>.js` (or its `.effects.js` / `.viewmasks.js`
sidecars) changes, run the parity validator on that scene:

```powershell
cd simulation
node tools/scene_model_parity.cjs <scene>
node tools/scene_model_parity.cjs <scene> --strict   # before any hardware deploy
```

It reads committed files only — no ports, no engine, no browser — so it is
safe to run against the operator's live stack. Exit `0` pass, `1` parity
errors, `2` the validator could not run.

What it proves (plan `20260725_33` §4): the generated model is a faithful,
CURRENT export of the scene (pixel roster, names, groups, channel maps,
`pixelCount`), every patch in the model equals `patches.yaml` and every
`patches.yaml` record equals what the `controllers.yaml` chains imply, the
LED per-pixel walk matches the recorded segments, no duplicate DMX
addresses on one controller, no unmapped fixture or strand, no DMX/LED
section/fixture id collision, and `views.yaml` ↔ model groups ↔ the
viewmasks sidecar agree.

Two modes:

- **default** — mapping-valid for the sim audit. Placeholder controllers
  (`ip: 0.0.0.0`, name marked `PLACEHOLDER`) and unpatched strands are
  listed loudly and pass.
- **`--strict`** — the HARDWARE gate. Every placeholder becomes an error: a
  sentinel IP means the real wiring is still unknown, so the rig must not be
  deployed off that mapping.

A red validator means STOP and fix the scene — never edit `patches.yaml` by
hand to make it green. `controllers.yaml` is the authoring surface;
`patches.yaml` is derived from it and is rewritten on every sim boot, so a
hand edit is wiped back (and the validator's
`patch_record_disagrees_with_chains` catches the attempt).

Unit tests for the gate itself: `simulation/tests/scene_model_parity.test.js`
(runs inside `npm run check`).

## GPU Adapter Check (REQUIRED for every FPS / performance claim)

**Any FPS number must record which GPU produced it.** On a dual-GPU box the
browser's GPU process can sit on the integrated adapter, and the same scene at
the same commit renders **59.9 FPS on the discrete GPU vs 20 FPS windowed /
10 FPS at fullscreen-scale on the Intel iGPU** — a 6× swing that looks exactly
like a code regression (report `20260725_38` burned a full session proving it
was not).

In any sim page (probe or live), read:

```javascript
window.__gpuAdapter   // { renderer: "<unmasked adapter string>", integrated, detectionFailed }
```

Rules:

- **An `integrated: true` adapter INVALIDATES the measurement.** Do not report
  the number as a sim perf fact — report the adapter. Same for
  `detectionFailed: true` (the browser refused to name the GPU).
- The sim says so itself, loudly: a red top-center banner
  (`#gpu-adapter-warning`) naming the adapter and the remedy, plus a
  `console.error` at boot, and a one-shot `[LowFPS] …` `console.error` after
  **10 consecutive seconds under 20 FPS** that names the adapter. Seeing either
  in a console dump means STOP and fix the environment, not the code.
- The low-FPS escalation also catches the *right* adapter under contention —
  leftover probe browser windows and extra sim tabs steal the GPU. Close every
  probe browser after use and keep exactly one sim window open while measuring.
- Operator-side remedy (Windows, one-time): Settings → System → Display →
  Graphics → add `chrome.exe` → **High performance**, restart Chrome, then
  confirm `chrome://gpu` shows the NVIDIA GPU `*ACTIVE*`.

Unit tests for the visibility layer: `simulation/tests/gpu_adapter.test.js` and
`simulation/tests/low_fps_alarm.test.js` (both run inside `npm run check`).

## Browser Smoke Target

When rendering, scene config, fixture runtime, or GUI changed, do a browser smoke
test in addition to syntax/unit checks:

```powershell
cd simulation
npm start -- --scene test_bench
```

Open:

```text
http://localhost:6969/simulation/?scene=test_bench
```

Smoke test requirements:

- Page loads without a permanent loading overlay.
- No uncaught browser console errors.
- Fixture dots are visible in pixel-mapping/profile views.
- sACN input/output panels can connect when their bridge servers are running.
- Fog/haze UI toggle affects the intended special-effects fixtures.

## Dependency Rule For Tests

Browser import maps do not satisfy Node tests. If a Node test imports a module
that imports `three`, then `simulation/package.json` must include a local `three`
dependency or the test must use a proper Node loader/mock setup.

Current preferred fix:

```powershell
cd simulation
npm install --save-dev three@0.177.0
```

Only add this dependency if Node tests actually import simulation modules that
need `three`. Keep the version aligned with the import map in
`simulation/index.html`.

## Intentional Fogger Patch Collision

The `test_bench` scene intentionally patches both fog/haze fixtures to universe
1, address 511. This is not a merge blocker and should not be automatically
"fixed" as a DMX overlap. The collision is documented in:

```text
simulation/scenes/test_bench/patches.yaml
```

Agents should still report other patch collisions unless they are explicitly
documented near the patch entries.

## Current Fix Targets

These issues were observed on `dev/mixer_impl` on 2026-05-07:

1. `simulation/tests/fog_regression.test.js` is not wired into `npm test`.
   - Add the `test` and `check` scripts above.
   - Make the test runnable from `simulation`.

2. Node test dependency resolution must be fixed.
   - Either add `three` as a local dev dependency or isolate browser-only code
     behind a testable adapter.
   - Do not rely on globals to replace static imports.

3. Remove debug log spam before merge.
   - `DmxFixtureRuntime.updateScales` should not log every scale update.
   - GUI slider and fog toggle logs should be removed or gated behind an
     explicit debug flag.

4. Keep generated model files consistent.
   - If scene YAML or fixture models change, regenerate
     `marsin_engine/models/*.js` and companion `*.effects.js`.
   - Include the generated diffs in the same branch as the source YAML change.

## What Counts As Done

A simulation change is done only when the final response includes:

- `git diff --check -- simulation`: pass
- JS syntax check for changed simulation files: pass
- `cd simulation; npm run check`: pass when tests exist
- `node tools/scene_model_parity.cjs <scene>`: pass, for every scene whose
  YAML or generated model changed (and `--strict` before a hardware deploy)
- Browser smoke result when rendering, scene, fixture, or GUI code changed
- `window.__gpuAdapter.renderer` recorded next to every FPS number reported,
  with `integrated: false` — an integrated/unknown adapter invalidates the
  measurement (see "GPU Adapter Check")

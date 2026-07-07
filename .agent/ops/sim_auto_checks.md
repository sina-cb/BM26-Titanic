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
- Browser smoke result when rendering, scene, fixture, or GUI code changed

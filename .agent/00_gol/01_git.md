# Git And Merge-Readiness Rules

- Never do git operations until explicitly asked by the Human op.
- Do not claim a branch is merge-ready just because a report says "approved".
  Verify the branch with the project-specific checks below.
- Never use `git reset --hard`, `git checkout --`, or destructive cleanup to
  hide test side effects unless the Human op explicitly asks for that.
- If a test modifies tracked state files, restore those files from a temp
  snapshot or fix the test to restore them in `finally`.

## Auto-Check Specs

Before commit or merge-readiness review, follow the relevant spec files:

- CaptainPad: `.agent/00_gol/03_captain_pad_auto_checks.md`
- Simulation: `.agent/00_gol/04_sim_auto_checks.md`
- Marsin Engine: `.agent/00_gol/05_marsin_engine_auto_checks.md`

If a branch touches more than one subsystem, run every touched subsystem's
checks. If the branch touches shared generated model data, run both the source
subsystem checks and the consumer subsystem checks.

## Standard Pre-Commit Review Flow

1. Check branch and working tree:
   ```powershell
   git status --short --branch
   ```

2. Inspect the branch diff against `origin/main`:
   ```powershell
   git diff --stat origin/main..HEAD
   git diff --name-status origin/main..HEAD
   ```

3. Run whitespace checks:
   ```powershell
   git diff --check origin/main..HEAD
   ```

4. Run subsystem checks from the spec files listed above.

5. If checks fail, fix the failure before staging or committing.

6. Only after checks pass, and only when the Human op asks for it, stage and
   commit.

## Current `dev/mixer_impl` Remediation Steps

These are the known follow-up tasks from the May 7, 2026 merge-readiness review.
Agents should complete these before recommending merge to `main`.

1. Fix CaptainPad type/lint failures.
   - Follow `.agent/00_gol/03_captain_pad_auto_checks.md`.
   - Add a YAML module declaration so `@/config.yaml` typechecks.
   - Replace or define the missing `C.border` color token.
   - Type implicit `any` fader callbacks in `CPCControls`.
   - Fix mixer lint errors, including memoized component display name and JSX
     quote escaping.
   - Re-run `npx tsc --noEmit` and `npm run lint` from `CaptainPad`.

2. Update the HIL transition test so it can gate merges.
   - Follow `.agent/00_gol/05_marsin_engine_auto_checks.md`.
   - Remove hardcoded `PIXEL_COUNT = 64`; derive count from captured vis data.
   - Add assertions for brightness and per-pixel deltas.
   - Add reliable cleanup so `states/test_bench/*.yaml` are not changed by the
     test.
   - Add or document a one-command local HIL runner.

3. Resolve the missing `blend_crossfade` warning.
   - Either add `marsin_engine/patterns/channel_blends/blend_crossfade.js`, or
     stop assigning `blend_crossfade` to boot-created base channels.
   - Re-run:
     ```powershell
     cd marsin_engine
     node engine.js --pattern test_const --model test_bench --dry-run
     ```
   - The dry run should exit 0 without a missing blend-script warning.

4. Keep the intentional fogger collision.
   - The overlap between `ChauvetHaze4D 10` and `TEFogMachine 10` at universe 1,
     address 511 is intentional and documented in
     `simulation/scenes/test_bench/patches.yaml`.
   - Do not "fix" that collision unless the physical patch plan changes.

5. Clean branch hygiene.
   - Fix `git diff --check origin/main..HEAD` findings.
   - Remove or gate debug logs introduced in simulation runtime and GUI code.
   - Make sure generated model files match their source scene/fixture YAML.

6. Final verification before recommending merge:
   ```powershell
   git diff --check origin/main..HEAD
   ```
   Then run the CaptainPad, Simulation, and Marsin Engine spec checks for every
   subsystem touched by the branch.

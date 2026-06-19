# Git And Merge-Readiness Rules

- Never do git operations until explicitly asked by the Human op.
- Do not claim a branch is merge-ready just because a report says "approved".
  Verify the branch with the project-specific checks below.
- Never use `git reset --hard`, `git checkout --`, or destructive cleanup to
  hide test side effects unless the Human op explicitly asks for that.
- If a test modifies tracked state files, restore those files from a temp
  snapshot or fix the test to restore them in `finally`.

## Branch Naming and Lifecycle

Every branch on `origin` falls into one of the namespaces below. Use the
right namespace for the work; do not invent new top-level prefixes.

This repo is **agent-agnostic** — no branch namespace is tied to a particular
agent. Do not bake an agent's name (`claude`, etc.) into a branch you create.

| Namespace | Purpose | Lifetime | Pushed to origin? |
| --- | --- | --- | --- |
| `main` | Production / integration trunk. All work lands here via squash-merged PRs. | Permanent | Yes |
| `feat/<snake_case>` | **Durable feature branches** that outlive a single agent session — long-running work, deploy hosts, anything an open PR tracks. This is the only namespace for work meant to stick around. | Long-lived, until merged | Yes |
| `dev/<slug>` | Multi-agent worktree sub-agent branches. Governed by `.agent/00_gol/13_multi_agent.md`. **Local only.** | Transient, one per multi-agent run | **No — stays local** |
| `worktree-agent-<hash>` | **Temporary local worktree** scratch branches. Never durable work. | Ephemeral, delete after use | **No — stays local** |
| `<agent>/<auto_name>` | Auto-named branches an agent's web / cloud session creates for itself (random codenames like `nice-cerf-bl2jnk`). Treat as scratch until promoted. | Ephemeral | Only the originating session's own branch |

Rules:

- **Keep `origin` clean — only `feat/*` (and `main`) belong there long-term.**
  Multi-agent and worktree branches (`dev/<slug>`, `worktree-agent-<hash>`) are
  **local only — never push them to `origin`**; they stay on the machine that
  created them until promoted. Every extra branch on `origin` is noise that the
  next agent has to audit, so a steady-state `origin` holds only `main`, the
  durable `feat/*` branches, and whatever PR branches are actively in flight.
  An `<agent>/<auto_name>` branch that a web/cloud session unavoidably creates
  on `origin` for itself is not a license to accumulate — promote it to
  `feat/<snake_case>` or delete it promptly; do not let them pile up.
- **Durable work → `feat/<snake_case>`.** The slug is `snake_case` (matches
  the codex filename rule), short and descriptive: `feat/views_rehaul`,
  `feat/timeline_support`, `feat/wiring_diagram`. Do not leave long-lived work
  on an auto-named `<agent>/<auto_name>` branch — promote it.
- **Promote by renaming, not re-creating.** When an `<agent>/<auto_name>` or
  `dev/<slug>` branch becomes durable, rename it to `feat/<snake_case>`
  using GitHub's branch-rename (UI: repo → Branches → rename; or
  `gh api -X POST repos/<owner>/<repo>/branches/<old>/rename -f new_name=<new>`).
  GitHub rename **retargets any open PR and preserves its history**. NEVER do a
  manual `git push origin <new> && git push origin --delete <old>` on a branch
  that has an open PR — that closes the PR and orphans the review.
- **Never delete the head branch of an open PR** unless you intend to close
  that PR. (Deleting it auto-closes the PR.)
- **Temp branches are cleanup candidates.** `worktree-agent-*`,
  `dev/*`, and merged or superseded `<agent>/<auto_name>` branches should
  be deleted from `origin` once their work has landed — i.e. merged via PR, or
  absorbed into a `feat/` host. **Verify the content actually landed before
  deleting** (diff against `origin/main` or the absorbing `feat/` branch); a
  squash-merge means `git branch --merged` will NOT list them, so check by
  content, not by the merged flag. Record the tip SHA before deleting so the
  branch can be restored with `git push origin <sha>:refs/heads/<name>`.
- **Worktree branches follow `13_multi_agent.md`.** Worktrees live in the
  sibling `BM26-Titanic-worktrees/` dir, never inside the repo or `~/tmp/`.
  Remove them with `git worktree remove` (never `rm -rf`), then delete the
  branch. Local-only port edits to `config.yaml` never get committed.
- **Branches stay local until the Human op says "push"** (see the first rule
  of this file and `13_multi_agent.md` §3).

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

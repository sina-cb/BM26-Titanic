# 13. Multi-Agent Workflow (Worktrees + Branches)

This spec defines how an **instigator agent** (the parent Claude / Cursor
session that the human operator spoke to) can fan out work to **N sub-agents**
running in **isolated git worktrees** without stepping on each other's
filesystem, ports, or branch state, then collect and merge their results.

It exists because parallelizing real engineering work in this repo (engine,
sim, CaptainPad, control_podium) is only safe when each agent owns:

1. its own working tree (no `.git/index` lock races),
2. its own branch (no accidental cross-task commits),
3. its own ports (no engine/sim/Metro collisions when more than one agent
   actually boots a server), and
4. a clearly defined task slice (no overlapping edits on the same files).

> See also: `.agent/00_gol/00_codex.md` (master rules), `01_git.md`,
> `02_nodejs_style.md`, `01_python_style.md`, `03_captain_pad_auto_checks.md`,
> `04_sim_auto_checks.md`, `05_marsin_engine_auto_checks.md`,
> `06_run_sim.md`, `07_run_marsin_engine.md`, `08_patterns.md`,
> `11_UI_design.md`.

## 1. When to use this workflow

Use it when a single operator request decomposes cleanly into **3 or more
independent slices** that each have their own design doc / acceptance criteria
and minimal file overlap. Examples:

- "Implement these 4 design docs in parallel."
- "Pick up these 6 TODOs at once."
- "Audit + fix 5 different subsystems."

Do **NOT** use it for:

- Tightly coupled refactors (one branch, one agent).
- Tasks that all rewrite the same file (serialize them instead).
- One-shot bug fixes (overhead is not worth it).

## 2. Roles

### Instigator agent

- Reads the operator's prompt and decomposes it into N slices.
- Allocates a **slot index** `0..N-1` to each slice (see ports table below).
- Creates one worktree + branch per slice (§4).
- Spawns one sub-agent per slice with a fully self-contained prompt (§5).
- Collects results, verifies each branch is real, and reports back to the
  operator (§7).
- Only after the operator explicitly approves it: performs the final merge
  back into the parent branch (§8).

The instigator does **not** edit the source code itself — it only
orchestrates. The one exception is the multi-agent meta files
(this spec, status reports under `.agent/02_reports/`).

### Sub-agents

- Each receives a self-contained prompt with: task description, design doc
  link, allocated port slot, allocated branch name, allocated worktree path,
  pointer to this spec.
- Operates **only inside its own worktree**. Never `cd` outside it for write
  operations.
- Runs its servers (engine, sim, Metro) on its allocated port range.
- Tests its change locally (unit + integration + auto-checks + at least one
  manual smoke check, see §6).
- Commits to its branch and writes a short report to
  `.agent/02_reports/<YYYYMM>/<YYYYMMDD>_<slot>_<slug>.md` describing what
  changed, what was tested, and known gaps.
- Does NOT push to `origin` and does NOT touch other agents' branches.

## 3. Branch naming

All sub-agent branches MUST live under the `dev/claude/` namespace:

```text
dev/claude/<short_slug>
```

Examples (from the 2026-05-25 multi-agent run):

- `dev/claude/playlist_loading_fix`
- `dev/claude/mixer_layer_view`
- `dev/claude/global_effect_macros`
- `dev/claude/deck_density_optimization`
- `dev/claude/sidebar_scroll`
- `dev/claude/transition_pack`
- `dev/claude/channel_isolation`

Rules:

- Slug uses `snake_case`, max ~25 chars, must be unique per run.
- Branches are created from the parent branch the operator is currently on
  (verify with `git rev-parse --abbrev-ref HEAD` in the main repo BEFORE
  creating worktrees). Record that parent branch in the per-task report.
- Branches stay **local** until the operator says "push".

## 4. Worktree convention

Worktrees live in a sibling directory of the main repo, never inside it:

```text
~/workspace/BM26-Titanic/                      # main checkout (operator)
~/workspace/BM26-Titanic-worktrees/            # parent of all sub-agent trees
~/workspace/BM26-Titanic-worktrees/<slug>/     # one per sub-agent
```

Why sibling, not inside `~/tmp/`:

- Worktrees are real working copies (potentially > 1 GB with `node_modules`).
  `~/tmp/` is conceptually scratch, and may be wiped by other agents.
- Sibling location keeps `git worktree list` clean and lets `du` / `ls`
  inspect everything at one path.

Setup commands (run by the **instigator only**, from the main repo root):

```bash
mkdir -p ~/workspace/BM26-Titanic-worktrees

# parent branch the operator is on:
PARENT=$(git rev-parse --abbrev-ref HEAD)

# one per slice — example for slot 0:
git worktree add \
  -b dev/claude/playlist_loading_fix \
  ~/workspace/BM26-Titanic-worktrees/playlist_loading_fix \
  "$PARENT"
```

Verify:

```bash
git worktree list
```

Cleanup (after merge or abandonment, on operator approval):

```bash
git worktree remove ~/workspace/BM26-Titanic-worktrees/<slug>
git branch -D dev/claude/<slug>        # only if abandoned
```

> NEVER `rm -rf` a worktree directory. Always `git worktree remove`, which
> updates `.git/worktrees/` metadata.

## 5. Port allocation

The instigator assigns each sub-agent a **slot index** `0..6`. The slot's
base port is `31000 + slot * 100`. Every server the sub-agent starts MUST
use a port derived from its base.

Default project ports (DO NOT use these in a worktree if another process,
including the operator's main checkout, may already be using them):

| Service | Default | Source |
| --- | --- | --- |
| Marsin engine API (HTTP/WS) | `6968` | `marsin_engine/config.yaml::server.port`, also `--port` CLI |
| Marsin engine OSC | `10000` | `marsin_engine/config.yaml::osc.port` |
| Simulation HTTP | `6969` | `simulation/config.yaml::http_port` |
| Simulation save server | `6970` | `simulation/config.yaml::save_port` |
| Simulation sACN bridge | `6971` | `simulation/config.yaml::sacn_port` |
| Simulation sACN out | `6972` | `simulation/config.yaml::sacn_output_port` |
| CaptainPad `web:serve` | `6967` | `CaptainPad/package.json::web:serve` |
| CaptainPad Expo Metro | `8081` | Expo default |
| Server bridge `/health` | `7099` | `control_podium/.config.bridge.yaml::health.port` |

Per-slot allocation (use these in your worktree):

| Slot | Base | Engine API | Sim HTTP | Sim Save | sACN Bridge | sACN Out | OSC | Metro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 31000 | 31068 | 31069 | 31070 | 31071 | 31072 | 31000 | 31081 |
| 1 | 31100 | 31168 | 31169 | 31170 | 31171 | 31172 | 31100 | 31181 |
| 2 | 31200 | 31268 | 31269 | 31270 | 31271 | 31272 | 31200 | 31281 |
| 3 | 31300 | 31368 | 31369 | 31370 | 31371 | 31372 | 31300 | 31381 |
| 4 | 31400 | 31468 | 31469 | 31470 | 31471 | 31472 | 31400 | 31481 |
| 5 | 31500 | 31568 | 31569 | 31570 | 31571 | 31572 | 31500 | 31581 |
| 6 | 31600 | 31668 | 31669 | 31670 | 31671 | 31672 | 31600 | 31681 |

How to apply the ports inside your worktree:

```bash
# Engine — pass --port directly (recommended, no file edit):
cd ~/workspace/BM26-Titanic-worktrees/<slug>/marsin_engine
node engine.js --pattern test_const --model test_bench --port 31068

# Engine — if you need to also override OSC, edit the worktree's
# marsin_engine/config.yaml IN-PLACE (do NOT commit this change;
# revert before committing):
#   server.port: 31068
#   osc.port:    31000
```

```bash
# Simulation — edit simulation/config.yaml in the worktree:
#   http_port: 31069
#   save_port: 31070
#   sacn_port: 31071
#   sacn_output_port: 31072
# Then:
cd ~/workspace/BM26-Titanic-worktrees/<slug>/simulation
npm start -- --scene test_bench
```

```bash
# CaptainPad Metro:
cd ~/workspace/BM26-Titanic-worktrees/<slug>/CaptainPad
npx expo start --port 31081     # use your slot's metro port
```

Port-conflict discipline:

- Before starting any server, run `lsof -i :<port>` to confirm the port is
  free. If something already has it, fail loudly — do NOT silently pick
  another port.
- Never edit `config.yaml` port values **in the main checkout**. Only edit
  in your worktree, and `git checkout -- config.yaml` before you commit if
  you don't want the port change to be part of your PR.
- After your test, kill your processes (`npx -y kill-port <port>` works,
  or `kill $(lsof -ti:<port>)` on macOS).

## 6. Quality bar (every sub-agent)

Before claiming "done":

1. **Codex rules** (`.agent/00_gol/00_codex.md`) are non-negotiable —
   especially "no fallback behaviors" (P0) and "no temp files in source tree
   (use `~/tmp/`)".
2. **Language style** — `.agent/00_gol/02_nodejs_style.md` for JS/TS,
   `.agent/00_gol/01_python_style.md` for Python.
3. **Subsystem auto-checks** for every subsystem you touched:
   - CaptainPad — `.agent/00_gol/03_captain_pad_auto_checks.md`
   - Simulation — `.agent/00_gol/04_sim_auto_checks.md`
   - Marsin engine — `.agent/00_gol/05_marsin_engine_auto_checks.md`
4. **Tests** — at least one of (preferably all that apply):
   - Unit test (`node --test ...` in `marsin_engine/tests/` or
     `simulation/tests/`).
   - Integration / HIL test (`marsin_engine/tests/hil/*.mjs` — boot the
     engine on your allocated port, hit it over HTTP/WS, assert).
   - Sim smoke test (open `http://localhost:<simHttp>/simulation/?scene=test_bench`
     and confirm no console errors / fixtures render).
   - CaptainPad manual smoke (`npx tsc --noEmit && npm run lint`,
     plus describe what you clicked on the iPad / web build).
5. **No tracked-state side effects** — after your tests, `git status`
   inside the worktree should show only your intended diff. If a test
   modified `marsin_engine/states/test_bench/*.yaml`, restore those files
   in a `finally` block (see `05_marsin_engine_auto_checks.md`).
6. **No port leftovers** — kill all servers you started.

## 7. Reporting back

Each sub-agent writes a markdown report at:

```text
.agent/02_reports/<YYYYMM>/<YYYYMMDD>_<slot>_<slug>.md
```

Required sections:

```markdown
# Slot <N> — <slug>

- **Branch:** dev/claude/<slug>
- **Parent branch:** <parent>
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/<slug>
- **Slot ports:** engine <port>, sim <port>, metro <port>

## Scope
What design doc / TODO this slice addressed. One paragraph.

## Files changed
`git diff --name-status <parent>..HEAD` output, trimmed.

## Tests run
- Unit: <list>
- Integration / HIL: <list, with engine port>
- Sim smoke: <yes/no, what scene, what you saw>
- CaptainPad: <tsc + lint result, what you clicked>

## Known gaps / follow-ups
Things this slice intentionally did not do.

## Operator action requested
"Ready for review and merge." OR a specific question.
```

Commit the report at the end of the worktree's history.

The instigator's report back to the operator MUST list, for every sub-agent:

- Slot, branch name, slug.
- One-line outcome (success / partial / failed, with reason).
- Path to the report file.
- Whether automated checks passed.

## 8. Merge strategy (instigator only, after operator approval)

The instigator MUST NOT merge until the operator says so. When the operator
gives the go-ahead:

### 8.1 Pre-merge sweep (in the main checkout, NOT a worktree)

```bash
cd ~/workspace/BM26-Titanic
git fetch --all            # only if branches were pushed
git status --short --branch
```

Confirm the parent branch (`<PARENT>`) hasn't drifted since the worktrees
were created. If it has, the instigator should ask the operator whether to
rebase each sub-agent branch onto the new tip before merging.

### 8.2 Merge order

Merge in **safest-first** order so the highest-risk merges happen against
the cleanest possible tip:

1. Pure-additive branches first (new files only, no edits to shared code).
2. Localized-edit branches second (one or two files in one subsystem).
3. Cross-cutting refactors last (e.g. `channel_isolation`).

For each branch:

```bash
git merge --no-ff dev/claude/<slug> \
  -m "merge(claude): <slug> from slot <N> [<short summary>]"
```

If a merge has conflicts:

- STOP. Do not auto-resolve.
- Ask the operator. Reference the conflict files and the per-task reports.
- The two reports and the design docs are usually enough to choose a
  resolution that respects both intents.

### 8.3 Post-merge verification

After all merges land on `<PARENT>`:

1. Run every touched subsystem's auto-check spec (§6.3).
2. Run the full HIL battery against the merged tip (engine on its real
   default port `6968`).
3. Run `git diff --check <ORIGIN_PARENT>..HEAD` for whitespace.
4. Capture the result in a final report under
   `.agent/02_reports/<YYYYMM>/<YYYYMMDD>_merge_summary.md` listing each
   merge commit SHA and verification result.

### 8.4 Cleanup

Only after the operator confirms the merged state is good:

```bash
for slug in <list of slugs>; do
  git worktree remove ~/workspace/BM26-Titanic-worktrees/$slug
done
```

Branches (`dev/claude/*`) can stay around for archival, or be deleted on
operator request:

```bash
git branch -d dev/claude/<slug>     # safe delete (only if merged)
```

## 9. Anti-patterns (don't do these)

- **Sub-agent edits files outside its worktree.** Causes silent corruption
  of other sub-agents' trees.
- **Sub-agent pushes to `origin`** before the instigator has reviewed and
  the operator has approved.
- **Sub-agent re-uses someone else's port slot.** Server crashes look
  identical to real bugs.
- **Sub-agent runs `git reset --hard` to "clean up" test state.** See
  `01_git.md`: never destructively reset to hide test side effects. Fix
  the test instead.
- **Instigator auto-merges branches without operator approval.** The
  human owns the merge decision.
- **Instigator forgets to record the parent branch.** A failed merge
  without that context is much harder to triage.
- **Anyone commits the per-worktree port edits to `config.yaml`.** Those
  are local-only; `git checkout -- config.yaml` before committing.

## 10. Reference: relevant files for the current rig

For sub-agents that need quick orientation:

- Engine entry: `marsin_engine/engine.js`
- Engine API: `marsin_engine/lib/api_server.js`
- Mixer / blending: `marsin_engine/lib/pattern_mixer.js`
- State persistence: `marsin_engine/lib/state_manager.js`
- Engine config: `marsin_engine/config.yaml`
- Pattern files: `marsin_engine/patterns/*.js`
- Transitions: `marsin_engine/patterns/transitions/*.js`
- Channel blends: `marsin_engine/patterns/channel_blends/*.js`
- HIL tests: `marsin_engine/tests/hil/*.mjs`
- Sim launcher: `simulation/start.js`
- Sim config: `simulation/config.yaml`
- CaptainPad tab layout: `CaptainPad/app/(tabs)/_layout.tsx`
- CaptainPad deck: `CaptainPad/app/(tabs)/index.tsx`
- CaptainPad mixer: `CaptainPad/app/(tabs)/mixer.tsx`
- CaptainPad playlist UI: `CaptainPad/components/PlaylistPanel.tsx`
- CaptainPad API client: `CaptainPad/utils/api.ts`
- CaptainPad globals: `CaptainPad/components/RigGlobals.tsx`,
  `CaptainPad/components/GlobalParams.tsx`
- Server bridge / Pi: `.agent/00_gol/12_operating_raspberry_pi.md`

## 11. Quick start (instigator checklist)

1. `cd ~/workspace/BM26-Titanic && git rev-parse --abbrev-ref HEAD`
   → remember as `$PARENT`.
2. `mkdir -p ~/workspace/BM26-Titanic-worktrees`.
3. For each slice `i` in `0..N-1`:
   - Pick a `<slug>` and a slot `i`.
   - `git worktree add -b dev/claude/<slug> ~/workspace/BM26-Titanic-worktrees/<slug> "$PARENT"`.
4. Spawn N sub-agents in parallel, each with a self-contained prompt that
   contains its slot index, worktree path, branch name, design-doc link,
   and a pointer to **this** spec file.
5. Wait. Collect the per-task reports.
6. Report back to the operator with a summary table and ask for merge
   approval.
7. On approval: §8 merge flow.
8. On confirmation: §8.4 cleanup.

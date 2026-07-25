# 2026-07-24 — Commit snapshot 2: LED wave + titanic re-export (Slice 31)

Operator-ordered immediate commit ("but first commit now") of the uncommitted
work accumulated on `feat/bm_readiness` since the Slice-21 commits
(`d631c5c6` / `22d57138`). **Commit only — NOT pushed.** No `git reset` /
`checkout --`, no branch ops, no `--no-verify`. Operator went offline mid-work,
so every judgment call is documented below rather than asked.

The live prod stack was left running (sim :6969 answered 200 throughout). The
only browser page opened was a throwaway readonly export tab (`?readonly=1`,
zero sACN), closed on completion; the one-off export script was deleted.

## Commits made (3 logical commits)

| Hash | Files | Summary |
|---|---|---|
| `34c8c52f` | 16 | Sim LED-wave code (slices 22–29): TE Sign shell fix, LED Fixtures grouping + drawer flatten + rename plumbing, group LOCK + real LED group master, blackout semantics, generator catalog (S1) + ✨ Generators UI, beforeunload removal, **+ the NUL-sentinel fix**. |
| `cdccabde` | 6 | Titanic show-scene state (strand removal, auditorium/back-wall/TE Sign groups, born-locked TE Sign) + views/patches + **freshly re-exported `marsin_engine/models/titanic.*`**. |
| (this commit) | .agent | Reports 21–32, `sim_perf_per_object_explosion` memory, thread tracker + MEMORY index. |

Report `_32` (titanic station-mapping DESIGN, another Fable agent) appeared
untracked during this session — outside the briefed `_21..29` scope but a
finished, security-clean design doc from today; included to preserve it rather
than leave it dangling. Flagged here as a scope addition.

## Pre-commit checklist item 1 — gui_builder.js integrity

The cancelled S2 generator-UI agent left **no broken partial edit**. `node
--check src/gui/gui_builder.js` passes, and the full sim suite is green (see
below). The S2 generator UI work is present and **syntactically valid**:
`led_generator_catalog` import (L42–43), the `✨ Generators` folder + generic
`runLedGeneratorClick` flow (L4318+), and the `✨ + TE Sign (A+B)` button
removal note on the DMX toolbar (L1344). Per the brief, partial-but-valid
feature work on a feature branch is fine — left in and committed.

## Pre-commit checklist item 2 — NUL sentinel fix

`gui_builder.js` carried 4 literal NUL bytes (`'\x00new'` / `'\x00ungroup'`
Move…-dropdown sentinels from slice 23) at byte offsets ~240902–242063: two
`<option>.value` assignments and two `target === …` comparisons. Replaced all
four consistently with `'::new::'` / `'::ungroup::'` (distinctive, can never
collide with a real group name; the surrounding code only ever compares them
internally, and new-group names still pass through `prompt()` + the
`_ledGroupNameClash` guard). Verified: 0 residual NUL bytes, `node --check`
passes, `git diff` renders textual lines with no "Binary files differ"
marker (git now treats the file as text). Note: because the NUL bytes sat far
past git's 8000-byte binary-sniff window, `git diff --numstat` already showed
real counts before the fix; the fix still removes the tooling/security-scan
hazard the NULs posed and is required regardless.

## Pre-commit checklist item 3 — titanic model re-export (evidence)

The operator removed several LED strands after the Slice-21 export, so the
tracked `titanic.*` was stale again. Re-exported from the **current live
titanic scene**: a throwaway puppeteer tab loaded
`?scene=titanic&profile=full&renderer=webgl&readonly=1`
(`window.__readonlyMode = true`, which disables all sACN outbound in
`animate.js` — the tab wrote **zero** sACN and did not disturb the running
show) and called `window.saveModelJS()`, which POSTed model/effects/viewmasks
to the save server (:6970 → `marsin_engine/models/`). All three POSTs returned
200. Tab closed; the one-off script deleted. `scene_config.yaml` mtime confirms
the export touched only the model files (saveModelJS hits `/save-model` only).

| Marker | Committed (stale) | Re-exported (current) |
|---|---|---|
| `pixelCount` | 1141 | **981** (8 Small_* strands removed) |
| `TE Sign` pixel entries | 74 | **74** (present) |
| `TE LED Grid` entries | 0 | **0** |
| `viewmasks` `TE Sign` bit | — | **0x00100000 = 1048576** (matches `views.yaml`) |

Export readiness: `activeScene=titanic`, `readonly=true`, `parFixtures=84`,
`ledStrands=8`, not mid-rebuild. Only console noise was a pre-existing 404 for
a missing resource (same benign 404 the slice-23/24 reports noted). The 981
count is internally consistent with the committed `scene_config.yaml` (the 8
`Small_*` strands are deleted there), `views.yaml` (their view bits dropped),
and `patches.yaml` (roster updated).

## Pre-commit checklist item 4 — residue exclusions (left uncommitted, by design)

- **`marsin_engine/config.yaml`** — EXCLUDED. The diff is an **engine runtime
  re-dump**: the 5-line `priority:` doc comment is stripped (YAML serializer
  drops comments), `playlist.active: false→true` / `delay_s: '30'→'5'` (runtime
  playlist state), and 6 palette names appended to the `colorAutopilot`
  rotation list. Committing would delete the documentation comment block that
  slice 20 added — a machine rewrite, not authored work. Left as-is.
- **`marsin_engine/states/**`** — ALL EXCLUDED (engine runtime state; AGENTS.md:
  "expected residue… don't commit"): tracked `test_bench/{audio,deck,
  global_effect_slots,globals,mixer}_state.yaml`, `titanic/{audio,mixer}_
  state.yaml`; untracked `test_bench/vsn1_layout.yaml`,
  `titanic/{deck,globals,vsn1_layout}_state.yaml`.
- **`marsin_engine/models/test_bench.{js,effects.js,viewmasks.js}`** —
  EXCLUDED. `git diff --ignore-all-space --numstat` = 1 line each = the
  `Updated:` timestamp only; non-geometric test_bench edits leave model content
  unchanged. Timestamp churn.
- **`simulation/scenes/common.yaml`** — EXCLUDED. Session default flips
  (`lightingProfile 2d_pixels→full`, `lightingMode sacn_in→pixelblaze`) + live
  `_camera` position/target. Same class the Slice-21 report excluded.
- **`simulation/scenes/test_bench/scene_config.yaml`** — EXCLUDED (mixed-file
  judgment call). It carries ONE authored change — the slice-23 label rename
  `💡 LED Strands → 🔌 LED Fixtures` — but also session churn (`masterExposure
  0.2→0.6`, preview-only) and a runtime `ledGroupOverrides: Ungrouped:
  enabled:false` that would bake "bench LEDs off" into the scene. I chose to
  exclude the whole file rather than commit that runtime state; the **show
  scene's** identical label rename IS committed (in `titanic/scene_config.yaml`),
  so the only thing deferred is a cosmetic dev-bench label. Flagged loudly.
- **`simulation/scenes/test_bench/cameras.yaml`** — EXCLUDED. Front-preset
  position/target re-saved; camera session churn, not tied to any slice.
- **`simulation/scenes/test_bench/playlists/slow.yaml`** — EXCLUDED. Per-entry
  slider `defaults` populated (bench playlist tuning); undocumented, on the
  dev-bench scene, not part of any reported slice. Judgment call: excluded as
  session tuning. If the operator wanted these saved, re-save and commit
  explicitly.
- **`simulation/scenes/titanic/controllers.yaml`** — EXCLUDED. CRLF-only
  (`git diff --ignore-all-space` is empty; no `--stat` line).
- **`marsin_engine/models/led202.{js,effects.js}`** (untracked) — EXCLUDED.
  Stray auto-export with `pixelCount 0`, stamped 02:43 (one minute before the
  02:45 titanic export). An accidental empty-model save; not authored, left
  untouched (not mine to delete).
- **`{}`** (untracked, 0-byte, repo root) — EXCLUDED. Pre-existing junk noted
  in the Slice-21 report; left untouched.

### Committed as genuine authored state (NOT excluded)
`simulation/scenes/titanic/{scene_config,patches,views}.yaml` — real
show-scene build-out (strand removal, Left Center Auditorium + Left Back Wall
generator groups, born-locked TE Sign, view-bit + patch roster), forming one
self-consistent set with the re-exported model.

## Pre-commit checklist item 5 — security gate

`python scripts/security_check.py --staged` — commits 1 (16 files) and 2 (6
files) passed first try ("no leaks found"). The .agent doc commit initially
**FAILED** with 3 `bm26-report-ip` findings, all on line 78 of
`20260724_21_commit_snapshot.md`: that report's own security section quoted the
literal show-LAN IPs it had redacted *elsewhere* (`10.x.x.202`, `10.x.x.1`,
and the low end of a `10.x.x.1–254` range) — a self-leak. Redacted all to
`10.x.x.NNN` (last octet kept, per `os/security_privacy.md`), re-staged,
re-ran → PASS. The Claude Code PreToolUse hook re-ran the gate on every `git
commit` and passed. No `--no-verify`, no hook bypass. These IPs were in a
never-committed file (untracked report), so no history exposure.

## Post-commit state

`git log --oneline` tip: (docs) → `cdccabde` → `34c8c52f` → `22d57138`
(Slice-21) → `d631c5c6`. Working tree after the three commits holds exactly the
intended exclusions above (engine config/state runtime churn, timestamp-only
test_bench models, session-churn YAML, CRLF-only controllers, the `led202.*`
and `{}` junk). Nothing pushed.

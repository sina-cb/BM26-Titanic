# Agent OS Migration — `.agent/` Rehaul

- **Date:** 2026-07-06
- **Branch:** `feat/titanic_agent_rework` (off `origin/main` @ `afc668e`)
- **Author:** instigator agent (with Sina)
- **Project dossier:** `.agent/projects/agent_os_rework.md`

## Scope

Reworked `.agent/` from four numbered layers (`00_gol/`, `01_skills/`,
`02_reports/`, `03_agent_types/` + the split `04_plans/`/`plans/`) into the
**Agent OS**: codex as constitution, first-class context / memory / plans /
ops / projects / reports, radical agent autonomy codified, agent-agnostic
core with per-agent root shims.

## What changed

### Structure (257 pure `git mv` renames, staged as commit 1)

| Old | New |
|---|---|
| `.agent/00_gol/00_codex.md` | `.agent/codex.md` (**byte-identical** — verified by blob hash) |
| `.agent/00_gol/` laws (git, styles, ui_design, multi_agent, task_tracking, security_privacy) | `.agent/os/` |
| `.agent/00_gol/` runbooks/checks (auto-checks ×3, run specs ×2, patterns, ipad build, auto patcher, pi ops, pattern catalog, timeline e2e) | `.agent/ops/` |
| `.agent/01_skills/NN_x.md` | `.agent/skills/x.md` (numeric prefixes dropped) |
| `.agent/02_reports/` | `.agent/reports/` (contents untouched) |
| `.agent/03_agent_types/NN_x.md` | `.agent/roles/x.md`; `04.5_shader_glsl_expert.md` → `marsin_script_expert.md` |
| `.agent/04_plans/` + `.agent/plans/` | `.agent/plans/` (merged) |

### New OS documents

- `.agent/README.md` — OS map, precedence stack (codex › os › ops/skills › roles › context/memory), old→new path table.
- `.agent/os/autonomy.md` — radical self-reliance doctrine; the six operator gates (push/merge to origin, codex edits, hardware flash, secrets, destructive git, external publishing) — everything else is autonomous.
- `.agent/os/memory.md` — memory protocol; `.agent/memory/MEMORY.md` index seeded.
- `.agent/context/boot.md` — 8-step boot sequence + session-end checklist; `.agent/context/now.md` — living state of play.
- `.agent/projects/TEMPLATE.md` + `.agent/projects/agent_os_rework.md` — first dossier.

### Root entry files

- **`AGENTS.md`** (new) — canonical agent-agnostic map (evolved from old CLAUDE.md, all rules preserved, paths updated, new *Radical autonomy* hard rule).
- **`CLAUDE.md`** — rewritten as a thin Claude Code shim: `@AGENTS.md` + harness-specific notes.

### Reference sweeps

- All living docs (`os/`, `ops/`, `skills/`, `roles/`) — cross-references and H1 headings de-numbered and re-pathed. No semantic changes to any rule.
- External fixups: `scripts/security_check.py`, `.gitleaks.toml` (comment only), `launcher.js`, `CaptainPad/utils/api.ts` + `channelOpsApi.ts`, `marsin_engine/audio/analyzer/audio_analyzer.js`, root `README.md`, `.agent/agent_fs.yaml`.
- 24 stale `.agent/…` citations in code comments across 21 source files (sim GUI, engine libs/tests/HIL, scheduler.tsx, gen_catalog.mjs) re-pointed to the new homes.

### Left intentionally unchanged

- `.agent/codex.md` content (Sina-only; holy word).
- Historical **reports and plans contents** — pre-migration docs still cite old paths; the mapping table in `.agent/README.md` translates. Precedent: the `04_task_tracker` deprecation.
- Gitleaks **rules/regexes** (`bm26-report-ip` anchors on `.agent/` — rename-safe); Notion board config; pattern filenames (`00_golden_hour_wash.js` etc. are real files, not indexes).

## Verification

- Fresh-eyes validator (adversarial, read-only): **SHIP** — codex blob-hash identical to `origin/main`; 260-file reconciliation clean (257 renames + 3 in-place); zero stale paths in living docs; zero IPs/MACs/secrets in new files; diff discipline exact (no stray edits to states/, configs, lockfiles).
- `node --check` on every touched JS/MJS file: PASS. `python -m py_compile scripts/security_check.py`: PASS. `validation_metrics.json` still valid JSON.
- Stale-path grep over all source code (`js/ts/tsx/mjs/json/py/yml`, node_modules excluded): CLEAN.

## Known gaps / follow-ups

- `python scripts/security_check.py --staged` is **blocked on this machine**: no `gitleaks` binary or Docker. Operator is installing gitleaks v8.28.0; both commits gate on it. (Also noted in `.agent/context/now.md`.)
- Reports before 2026-07 cite old `.agent/` paths by design — do not "fix" them.
- The mobile viewer reads `agent_fs.yaml` (path `.agent` unchanged) — worth a one-time visual check that the new tree renders.

## Operator action requested

Install gitleaks v8.28.0 on PATH → commit 1 (pure renames) + commit 2 (content) land, then review for merge. No push until approved.

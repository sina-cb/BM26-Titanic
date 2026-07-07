---
name: agent-os-migration-2026-07
description: The .agent/ numbered-dir layout became the Agent OS on 2026-07-06.
type: decision
created: 2026-07-06
updated: 2026-07-06
---

On **2026-07-06** the `.agent/` directory was restructured from numbered
directories into the **Agent OS** layout: `os/` (laws), `ops/` (runbooks +
auto-checks), `skills/`, `roles/`, `context/`, `memory/`, `plans/`,
`projects/`, `reports/`. The codex moved to `.agent/codex.md`. Numeric
filename prefixes were dropped everywhere except dated `plans/` and
`reports/` entries. The migration was done as pure staged `git mv` plus new
authored docs on branch `feat/titanic_agent_rework`.

**Why:** the numbered scheme (`00_gol/`, `01_skills/`, `02_reports/`,
`03_agent_types/`, `04_plans/`) had grown to conflate laws, runbooks, and
specs in one bucket and forced brittle numeric ordering. The OS layout
separates concerns and adds a boot sequence, radical-autonomy doctrine, and
durable memory.

**How to apply:** use new paths in all new work. When you read a
pre-migration report or plan citing an old path, **do not rewrite it** —
those are historical records. Map old → new via the table in
[`../README.md`](../README.md). See the migration report
`.agent/reports/202607/20260706_1_agent_os_migration.md`.

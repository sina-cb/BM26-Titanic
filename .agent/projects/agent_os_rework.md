---
name: agent_os_rework
status: active
owner: operator (Sina) + documentation/developer agents
created: 2026-07-06
updated: 2026-07-06
---

# Agent OS Rework

## Goal

Rework the `.agent/` directory from its numbered-directory layout into a
coherent **Agent OS**: a clear law stack, separated laws/runbooks/skills/
roles, a boot sequence, a radical-autonomy doctrine, and durable memory —
so any agent can boot itself and act within the law without hand-holding.

## Current state

Directory moves complete (pure staged `git mv`). New authored docs in
place: `README.md` (OS map + precedence), `os/autonomy.md`, `os/memory.md`,
`context/boot.md`, `context/now.md`, `memory/MEMORY.md` (+ first fact),
`projects/` (this dossier + `TEMPLATE.md`), root `AGENTS.md` (canonical) and
a thin `CLAUDE.md` shim. External cross-references (scripts, code comments,
configs) updated to new paths. Work lives on `feat/titanic_agent_rework`,
**awaiting operator review + merge**.

## Links

- **Plans:** (none dedicated yet)
- **Reports:** `../reports/202607/20260706_1_agent_os_migration.md`
  (forthcoming — migration handoff)
- **Branches:** `feat/titanic_agent_rework`
- **Notion cards:** file a `Backlog` follow-up per `../os/task_tracking.md`

## Decisions log

- **2026-07-06** — dropped numeric filename prefixes (except dated plans/
  reports) and split the old `00_gol/` bucket into `os/` (laws) and `ops/`
  (runbooks + auto-checks); see memory fact `agent-os-migration-2026-07`.

## Next steps

- [ ] Operator review of the new docs and the reference fixups.
- [ ] Write the migration handoff report at the forthcoming path above.
- [ ] Merge `feat/titanic_agent_rework` (operator-gated).

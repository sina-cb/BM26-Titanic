# MEMORY.md — Fact Index

Durable, agent-agnostic facts that survive sessions and context compaction.
Protocol (format, rules, when to write): [`../os/memory.md`](../os/memory.md).

**At boot, load only this index.** Open individual facts on demand.

## Facts

- [agent-os-migration-2026-07](agent_os_migration_2026_07.md) — the `.agent/`
  numbered-dir layout was replaced by the Agent OS on 2026-07-06; old paths
  survive only in pre-migration reports.

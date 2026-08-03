# MEMORY.md — Fact Index

Durable, agent-agnostic facts that survive sessions and context compaction.
Protocol (format, rules, when to write): [`../os/memory.md`](../os/memory.md).

**At boot, load only this index.** Open individual facts on demand.

## Facts

- [agent-os-migration-2026-07](agent_os_migration_2026_07.md) — the `.agent/`
  numbered-dir layout was replaced by the Agent OS on 2026-07-06; old paths
  survive only in pre-migration reports.
- [bm-readiness-thread-tracker](bm_readiness_thread_tracker.md) — live
  tracker for the BM readiness campaign: in-flight agent threads, queued
  work, operator decision queue.
- [operator-uses-launcher](operator_uses_launcher.md) — Sina always starts
  the system via repo-root `launcher.js`; give launcher commands, never
  per-component start instructions.
- [sim-perf-per-object-explosion](sim_perf_per_object_explosion.md) —
  WebGPU perf dies by scene-graph object count: per-pixel meshes must be
  InstancedMesh; one color-write path = vivid, consistent LEDs; measure
  FPS with a fresh browser.
- [sim-perf-gpu-adapter](sim_perf_gpu_adapter.md) — FPS collapse with a
  CLEAN object census = the browser is on the Intel iGPU, not the 4090;
  check the adapter (chrome://gpu / UNMASKED_RENDERER) before blaming
  code; probes can pin an adapter via `--use-adapter-luid`.
- [spawning-a-test-engine](spawning_a_test_engine.md) — `--dest` does NOT
  black-hole sACN (the `controllers:` block wins, and the default destination
  is the operator's own sim bridge); use `MARSIN_CONFIG_FILE` with a
  black-holed config + `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR`/
  `MARSIN_TIMELINE_DIR`, and ASSERT the sender lines before trusting it.
- [doc-inconsistency-standing-fix](doc_inconsistency_standing_fix.md) —
  operator standing order 2026-07-30: doc contradicting verified
  code/hardware behavior → fix + clean up on sight, sanctioned by
  default (descriptive truth only; P0s still apply).

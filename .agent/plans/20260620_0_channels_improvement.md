# 20260620 — Channels Subsystem Improvement Campaign (INSTIGATOR plan)

> Durable memory across context compaction. **Reload this at every check-in.**

## Verbatim operator directives (CONFIGURE ME)

- TARGET SUBSYSTEM: the MarsinEngine and CaptainPad handling of **channels**.
- DELIVERABLE BRANCH (intended durable name): `feat/optimize_channels`.
  **Operational note:** the harness pins this session to push to
  `claude/bm26-channels-optimization-9ok9d3` (already cut from `origin/main`,
  already tracked on origin). Per the hard harness rule "NEVER push to a
  different branch without explicit permission", the **actual pushed
  deliverable branch is `claude/bm26-channels-optimization-9ok9d3`**;
  `feat/optimize_channels` is the conceptual name. All `dev/*` worktree
  branches merge into the claude branch and it is what gets pushed.
- SUBSYSTEM DIRS owned: `marsin_engine/`, `CaptainPad/`.
- MISSION FOCUS:
  1. check & optimize interaction between the **deck** and the **mixer**;
  2. new feature: **hot-swap playlists** (supports `feat/timeline_support`);
  3. kick off **adversarial agents** to find optimizations + QoL;
  4. make it better for **production lighting systems**, best practices;
  5. best practices to manage the **2 views** (deck + mixer);
  6. find **techdebt** and areas to improve.
- Timeline: ~10 hours, autonomous, full authority, standing merge authority.

## Operating protocol

- Multi-agent worktree protocol: `.agent/00_gol/13_multi_agent.md`.
  Worktrees in `~/workspace/BM26-Titanic-worktrees/<slug>`, branch `dev/<slug>`,
  one slot per agent (base `31000 + slot*100`). dev/* are LOCAL ONLY.
- Codex P0: NO FALLBACK BEHAVIORS (fail loud); imports top-of-file; snake_case
  filenames; scratch in `~/tmp`; never `git reset --hard` to hide test residue;
  offline-ready (no CDN/font/runtime-npm/telemetry).
- Verification bars:
  - Engine: `node engine.js --list`; dry-run exit 0 no missing-blend warning;
    `node --test "tests/*.test.js"` (baseline **760 pass / 0 fail**); HIL when
    mixer/blend/playlist behavior changes; no tracked `states/*.yaml` residue.
  - CaptainPad: `npx tsc --noEmit` (baseline exit 0); `npm run lint`
    (baseline 0 errors / 12 pre-existing warnings — no NEW warnings);
    `npm run web:build` when routes/imports/web UI change.
- Merge: safest-first (additive before shared-file). `git merge --no-commit
  --no-ff dev/<slug>`, union-of-intent on conflicts, VERIFY ON MERGED TIP
  myself, then commit `merge(channels): <slug> [summary]`. Push the deliverable
  branch to origin after each batch (ephemeral container).

## Disjoint file ownership (the #1 merge-pain guard)

| Hot file | Sole owner slice |
|---|---|
| `marsin_engine/lib/pattern_mixer.js` | E1 engine_hotswap_mixer |
| `marsin_engine/lib/api_server.js` | E1 engine_hotswap_mixer |
| `marsin_engine/lib/playlist_manager.js` | E1 engine_hotswap_mixer |
| `marsin_engine/lib/state_manager.js` | E3 engine_state_hardening |
| `CaptainPad/app/(tabs)/mixer.tsx` | C2 captainpad_views |
| `CaptainPad/app/(tabs)/index.tsx` | C2 captainpad_views |
| `CaptainPad/app/(tabs)/_layout.tsx` | C2 captainpad_views |
| `CaptainPad/components/PlaylistPanel.tsx` | C2 captainpad_views |
| `CaptainPad/utils/api.ts` | C2 captainpad_views |
| new `tests/*.test.js` | additive — any agent, distinct filenames |

Cross-module calls allowed but: E3 keeps `state_manager.js` changes ADDITIVE /
backward-compatible (no removing/renaming exports); E1 must not change how it
calls state_manager. Engine boot wiring stays inside `pattern_mixer.js`
constructor (do NOT touch `engine.js:933`).

## Recon summary (2026-06-20, two read-only agents)

- Deck = singleton PFL preview channel (`deckChannel`), ping-pong double-buffer
  swap. Mixer = array of live overlay channels composited bottom→top. Output =
  `lerp(deckBuffer, mixerBuffer, viewFader)`. (`pattern_mixer.js`)
- Codex VIOLATIONS (silent fallbacks) to fix loudly: blend-compile fail →
  JS lerp (`pattern_mixer.js:1436-1444`); lazy `_compileBlend` returns null
  (`~1527`); unknown `viewSelection.type` → null mask (`api_server.js:2340`);
  malformed playlist YAML → null silent (`playlist_manager.js:119`).
- Perf: blend lazy-compile in hot loop (move to boot precompile); redundant
  `channelBuffer.fill(0)` per frame; per-frame array reorder/alloc.
- API gap: no `/mixer/channels/:id/playlist/entry` (deck has it) — asymmetry.
- Hot-swap: today every entry advance = full WASM compile, no pool/precompile.
- CaptainPad: deck/mixer share `playlistLibrary`; WS-driven (no polling).
  QoL gaps: sub-44pt touch targets; no confirm on destructive delete; viz
  re-render storm (`setVisVersion` re-renders all strips); duplicated boot.

## Agent waves

### WAVE 1 — discovery (DONE)
Two Explore agents mapped engine + CaptainPad. Reports captured in this plan.

### WAVE 2 — first slices (3 parallel, disjoint ownership) — LAUNCHED
- **E1 `dev/engine_hotswap_mixer` (slot 0)** — owns pattern_mixer.js,
  api_server.js, playlist_manager.js. P0 fail-loud fallback removal + render
  health on `/status`; blend precompile at boot (constructor); micro-perf;
  centralize blend-mode validation + NaN/duration validation; add
  `/mixer/channels/:id/playlist/entry` symmetry; hot-swap playlist (precompile
  next entry + queued swap). Ship safe subset, document the rest.
- **C2 `dev/captainpad_views` (slot 1)** — owns mixer.tsx, index.tsx,
  _layout.tsx, PlaylistPanel.tsx, api.ts. Production-console QoL: 44pt touch
  targets, confirm destructive deletes, viz re-render isolation, shared
  deck/mixer connection-boot hook, type-safety on json/exports. NO hot-swap UI
  yet (depends on E1 endpoint — deferred to a post-merge wave).
- **E3 `dev/engine_state_hardening` (slot 2)** — owns state_manager.js + NEW
  test files only. Atomic state writes (temp+rename), serializeChannel de-dup
  helper (additive), and new tests: deck/mixer split invariants, blend-fallback
  presence, concurrent playlist-entry behavior (HIL slot 2).

### WAVE 3+ — post-merge & adversarial (PENDING)
- Hot-swap UI in CaptainPad on merged tip (after E1 endpoint lands).
- 5-agent adversarial wave when queue empties.

## Live QUEUE

- [x] Recon engine + CaptainPad
- [x] Plan + verification files
- [x] E1 engine_hotswap_mixer (slot 0) — DONE + MERGED (37f4505, pushed)
- [x] C2 captainpad_views (slot 1) — DONE + MERGED (355b2ca, pushed)
- [x] E3 engine_state_hardening (slot 2) — DONE + MERGED (45dd556, pushed)
- [ ] WAVE 3: dev/captainpad_hotswap_ui (slot 1) — RUNNING (hot-swap UI on merged tip)
- [ ] Adversarial wave (5 read-only agents on tip 37f4505) — RUNNING; implement top safe finds
- [ ] Merge WAVE 3 + adversarial fixes → verify → push

## Adversarial findings (accumulating; verify each against real code before trusting)

### Lens B — engine robustness/codex (agent a0a9fac, DONE)
Top EASY/P0 candidates (api_server.js line refs ~, must re-confirm):
- F1 fader writes lack isFinite/clamp (~2889/3709/4389) → NaN into render. EASY.
- F4 deck base-channel restore compile-fail returns silently (~1388-1394) →
  null deck; should throw loud at boot. EASY.
- F2 restore stale playlist activeEntryId not cleared when entry gone
  (~1430-1442). EASY.
- F9 /deck/transition-config durationMs range not validated (~3962-3968)
  (E1 added NaN reject; range may still be open). EASY — VERIFY vs E1's work.
- F7 transition-config mode not validated vs isValidBlendMode (~3943-3953)
  — VERIFY: E1 centralized VALID_CHANNEL_BLEND_MODES; may already be fixed.
- F10 WS broadcast routing throw may be swallowed at call site (ws_topic_routing
  + api_server ~462). EASY.
- F5 fader range clamp on disk; F6 PATCH /mixer/channels pattern-fail returns
  200 (~2933-2948) MED; F3 concurrent entry-load race MED; F8 save-during-
  transition MED; F11 stale control-id MED; F12 stale viewMask on model reload MED.
→ Consolidate verified P0/EASY ones into ONE engine-hardening slice owning
  api_server.js + ws_topic_routing.js (+ pattern_mixer.js if needed). Awaiting
  lenses A/D/E to batch before launch (avoid serial conflict on those hot files).

## Datasets / assets policy

No external assets needed. Offline-only. Scratch in `~/tmp`. Worktree
node_modules symlinked to main checkout (gitignored, never committed).

## STATUS LOG

- 2026-06-20 T0: Recon done. Baselines: engine 760 unit tests pass, dry-run
  clean, 60 patterns; CaptainPad tsc exit 0, lint 0 err/12 warn. Plan written.
  Launching WAVE 2 (3 agents).
- 2026-06-20 T1: E3 engine_state_hardening done + MERGED (45dd556, pushed).
  Verified on merged tip: 787 unit pass/0 fail (+27), dry-run clean, HIL
  concurrent 7/7, no state residue. E1 + C2 still running. Cron re-armed.
- 2026-06-20 T2: C2 captainpad_views done + MERGED (355b2ca, pushed). Verified
  on merged tip: tsc 0, lint baseline (0 err/12 warn), web:build 0 / 21 routes.
  Only E1 (engine_hotswap_mixer) still running. When E1 lands: merge+verify,
  then WAVE 3 hot-swap UI + adversarial wave.
- 2026-06-20 T3: E1 engine_hotswap_mixer done + MERGED (37f4505, pushed).
  WAVE 2 COMPLETE (all 3 slices landed). Two instigator reconciliations on
  the merged tip: rewrote blend_fallback_presence.test.js to the new fail-loud
  contract; fixed dead-deck fixture (test_bench/deck_state 29_bar_dancers→
  test_const). Merged-tip proof: 802 unit pass/0 fail, dry-run clean,
  renderHealth ok, hot-swap HIL 17/17. Cleaned up 3 merged worktrees.
  LAUNCHED WAVE 3 (dev/captainpad_hotswap_ui, slot 1) + 5-agent adversarial
  wave (read-only on tip). Endpoint contract for UI: POST /deck/playlist/swap
  {name, entryId?} + /mixer/channels/:id/playlist/swap. Cron re-armed.
</content>
</invoke>

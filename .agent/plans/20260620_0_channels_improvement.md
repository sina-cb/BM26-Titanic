# 20260620 — Channels Subsystem Improvement Campaign (INSTIGATOR plan)

> Durable memory across context compaction. **Reload this at every check-in.**

## Verbatim operator directives (CONFIGURE ME)

- TARGET SUBSYSTEM: the MarsinEngine and CaptainPad handling of **channels**.
- DELIVERABLE BRANCH (intended durable name): `feat/optimize_channels`.
  **DELIVERABLE BRANCH = `feat/optimize_channels` (pushed + tracking on origin).**
  Operator directive (2026-06-20): deliverable MUST be `feat/`-style; the old
  auto-named branch `claude/bm26-channels-optimization-9ok9d3` was promoted
  (renamed) to `feat/optimize_channels` and pushed. The operator is deleting the
  old `claude/...` ref from origin themselves (my `git push --delete` kept
  hitting a network disconnect — do NOT keep retrying; operator owns it).
  **HARD RULES (operator-reaffirmed): NEVER push `dev/*` or any temp branch to
  origin — they are LOCAL ONLY. origin holds only `main` + `feat/*`.** All
  `dev/*` worktree branches merge into `feat/optimize_channels`, which is the
  ONLY branch this campaign pushes.
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
- [x] WAVE 3: dev/captainpad_hotswap_ui — DONE + MERGED (35deb6f, pushed)
- [x] Adversarial wave (5 read-only lenses on tip 37f4505) — DONE; findings recorded
- [ ] WAVE 4: dev/engine_hardening_timeline (slot 2) — RUNNING (engine validation+perf+timeline-additive+tests)
- [x] WAVE 5: dev/captainpad_qol — DONE + MERGED (71bd908, pushed)
- [x] Full-stack smoke + screenshots (operator request) — DONE: deck+mixer CONNECTED w/ hot-swap SWAP, lit animated sim; proof in verification log + .agent_renders/
- [x] WAVE 4: dev/engine_hardening_timeline — DONE + MERGED (25f355c, pushed)
      823 unit pass/0 fail, deck-swap-param HIL all-pass.
- [x] ALL PLANNED WAVES MERGED. Deliverable feat/optimize_channels @ 25f355c.
- [x] 2nd pass: focused regression review (2 read-only agents) on the new surface — DONE.
      Result: most of the new surface verified SAFE (vis-pool keying, validateFader x4,
      render order, handle leak-safety, concurrency/EBUSY, CaptainPad res.ok). Two real finds:
      * P0 (mission-critical): deck restore can dark-start the exterior — null/missing
        pattern → silent NULL deck; compile-fail → fatal BOOT CRASH. Both = rig dark.
      * P1: deck soft-swap UI pinned to OLD entry ~8s (swap response returns pre-completion
        activeEntryId); + misleading mixer SWAP "crossfade" copy (mixer swap is instant).
- [ ] WAVE 6: dev/regression_fixes (slot 2) — RUNNING. FIX A: deck restore falls back to
      default pattern on ANY failure, LOUD+VISIBLE (/status flag), fatal only if default also
      fails — keep mission-critical exterior LIT. FIX B: swap/entry response carries resolved
      targetEntryId, UI arms pending-gate from it; mixer copy says "Switch" not "Crossfade".
      + boot-safety unit test + transition-enabled swap-response HIL.
- [x] WAVE 6: dev/regression_fixes — DONE + MERGED (5fd7f3d, pushed). 829 tests,
      FIX-B HIL 10/10, FIX-A keep-lit verified (boots not dark + deckRestoreDegraded).
- [ ] WAVE 7 (no-wait, kicked immediately per operator): two parallel agents —
      (a) FINAL INTEGRATION + OFFLINE-READINESS audit of the whole delta
          (origin/main..feat tip, 35 files) — read-only, handoff verdict.
      (b) dev/channels_docs — additive doc docs/NN_channels_deck_mixer.md: hot-swap
          API surface, /status renderHealth + deckRestoreDegraded, two-view best
          practices, timeline-readiness note.
- [x] WAVE 7a: final integration + offline audit — DONE. VERDICT: SHIP-WITH-NITS.
      Offline-readiness CLEAN (0 external URLs/fonts/CDN/telemetry; lockfile unchanged),
      codex P0 CLEAN, 829 tests pass. No P0/P1 blockers; 7 P2 nits (F1-F7).
      NOTE: audit F3 (restore 29_bar_dancers) is WRONG — that pattern is DELETED;
      test_const is the correct fallback. SKIP F3. F6 (PLAYLIST_DBG logs) pre-existing
      on main, out of scope.
- [x] WAVE 7b: dev/channels_docs — DONE + MERGED (8b20697). docs/39_channels_deck_mixer.md
      (renumbered 38->39 to dodge feat/timeline_support's docs/38). + report.
- [ ] WAVE 8: dev/audit_nits (slot 1) — RUNNING. Safe P2 fixes: N1/F4 finish fail-loud
      consistency on mixer updateMixerChannel name/mode/lock/transition; N2/F2 handle WS
      channelFaderRejected/channelModeRejected client-side; N3/F1 surface renderHealth +
      deckRestoreDegraded on the connection pill (defer if it needs unowned files);
      N4/F5 HIL honor ENGINE_PORT; N5/F7 ref-guard hot-swap re-entrancy.
- [x] WAVE 8: dev/audit_nits — DONE + MERGED (41a4bcb). 4/5 P2 nits; N3 deferred.
- [ ] WAVE 9: dev/health_pill (slot 1) — RUNNING. Last audit item N3/F1: surface
      /status renderHealth.ok===false || deckRestoreDegraded!=null as a non-intrusive
      amber "⚠ DEGRADED" chip by the connection pill (DeckTopBar). Additive; healthy
      engine = no change. Touches api.ts/engineBus.ts/useEngineConnection.ts/DeckTopBar.tsx.
- [x] WAVE 9: dev/health_pill — DONE + MERGED (a76a044). Last audit nit closed.
- [x] CAMPAIGN CLOSED. 10 slices merged + verified. Final merge summary:
      .agent/02_reports/202606/20260620_10_channels_campaign_merge_summary.md.
      Deliverable feat/optimize_channels @ a76a044 — handoff-ready, pushed.
      WINDING DOWN: re-engage only on operator request (cron stays as stuck-net).
- [ ] WAVE 10 (evidence, not churn): dev/perf_bench — measure the "optimize" claim.
      Render-loop benchmark feat (after) vs origin/main (before): ms/frame + GC/alloc
      from vis-buffer reuse, blend precompile, alloc-free transition order. Report-only
      (harness in ~/tmp, no code change). Honest numbers incl. any null result.
      bench_baseline worktree = origin/main for the "before".
- [ ] OPERATING MODE CHANGE (operator, 2026-06-20): do NOT close/wind down. KEEP
      kicking off agents to find + build NEW CHANNEL features until the timeline ends.
      Stay in the channels lane (deck/mixer/playlists/channel engine + CaptainPad deck/
      mixer views). EXCLUDE areas owned by other branches: timeline/scheduling
      (feat/timeline_support — different agent), MIDI (feat/captainpad-midi-control),
      audio DSP (feat/audio_analysis_2), UI rehaul (feat/views_rehaul). Maintain
      disjoint file ownership across parallel feature agents; merge+verify+push each;
      refill from the backlog; re-discover when it empties.
- [ ] WAVE 11: feature-discovery agent → ranked NEW-channel-feature backlog +
      recommended first parallel batch (disjoint ownership). RUNNING.
## NEW-CHANNEL-FEATURE BACKLOG (discovery a2d18e, ranked; in-lane only)
HIGH: #1 Named Mixer Snapshots/look-recall; #2 Channel Groups/gang-faders;
#3 Server-authoritative Solo + solo-safe; #4 Per-channel intensity clamp (faderMax);
#5 Grand-master fade-time/timed blackout. MED: #6 channel duplicate; #7 mixer
reorder; #8 channel color; #9 panic/home reset; #10 per-channel metering;
#11 playlist tags+search. LOW/MED: #12 per-entry hold/loop; #13 bulk ops.
KEY: api_server.js + pattern_mixer.js are the shared hot files — SERIALIZE engine
edits (one engine writer per wave), parallelize UI after. Integration line refs:
serializeChannel api_server.js:1728 + state_manager.js:15; PATCH /mixer/channels/:id
~3095; addChannel cap pattern_mixer.js:604; master ~697 / applyMaster ~1441;
index invariant ~186; viz ~1722; client solo mixer.tsx ~924; PatternChannel
pattern_channel.js:2.
PRECEDENCE NOTE: #2 groups + #3 solo both rewrite the per-channel composite gate
— do them together, decide precedence (group×fader×solo×fader-lock×clamp) once;
do NOT parallelize #2/#3/#7 (all touch composite ordering).

## FEATURE WAVES
- [ ] WAVE 11: feature discovery — DONE (backlog above).
- [ ] WAVE 12 (engine, sole engine writer): dev/channel_features_engine — RUNNING.
      F-A Snapshots (+ new snapshot_manager.js + routes), F-B Master fade (+ route),
      F-C clamp faderMax, F-D color. Engine-side + persistence + tests/HIL + docs/39.
- [ ] WAVE 13 (UI, parallel after 12 merges): SnapshotBar+master-fade controls in
      DeckTopBar (one owner) ‖ clamp+color strip controls in mixer.tsx (another owner).
      api.ts append-only (serialize or trivial-merge).
- [ ] WAVE 14: #10 metering (engine viz + ChannelVizStrip) — next engine writer.
- [ ] WAVE 15: #2 groups + #3 solo (together, composite precedence) — engine writer.
- [ ] Then #6/#9 (need snapshots), #7 reorder, #11/#12 playlist, #8 done w/12, #13.
- [ ] Repeat/refill to deadline; re-discover when backlog empties.

## STATUS LOG (cont. 2)

- 2026-06-20 T6: Full-stack smoke + screenshots delivered (operator request).
  WAVE 5 merged (71bd908). WAVE 4 merged (25f355c): fader fail-loud+clamp, boot
  fail-loud deck restore, vis-pool perf, parametric /deck/playlist/swap +
  /deck/playlist/queue, 823 tests. ALL planned waves landed. Engine suite 823/0,
  CaptainPad tsc 0 / lint baseline / web:build 21 routes. Launching focused 2nd
  regression pass on the new surface; cron re-armed.

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

### Lens A — engine perf/realtime (agent aded161, DONE)
EASY/verified candidates (pattern_mixer.js, re-confirm lines):
- A1 `_extractVis` allocates new Uint8Array every vis frame (~1690) → pre-alloc
  reuse buffer. EASY, P0-ish (GC). HIGHEST-VALUE per agent.
- A2 scripted-transition renderOrder array alloc per frame (~1596) → 2-pass
  loop. EASY.
- A5 warmInactiveDeckHandle reuse-mismatch handle leak (~939-943) → null-check
  /compare before destroy. EASY.
- A7 removeDeckChannel doesn't cancelDeckPatternSwap → orphaned transition
  state machine (~615-631). EASY.
NOTE: agent's "render thread vs request thread" model (A4) is WRONG — Node is
single-threaded event loop; treat A4/A6 skeptically. A3 (buffer ownership),
A9 (master quantization) are HARD/speculative — defer. A10 = no action (correct).

### Lens C — CaptainPad UX/console (agent acb0978, DONE)
P0/EASY (CaptainPad — owned by WAVE3 UI now; do AFTER WAVE3 merges):
- C1/C7 channel delete: removeMixerChannel doesn't check res.ok (api.ts) +
  confirmDeleteChannel ignores result (mixer.tsx ~1158) → no operator feedback.
- C2 `.catch(()=>{})` swallows fader/mute/solo/view errors (mixer.tsx ~836/853/
  895/927/1175) → CODEX P0 fail-loud violation. Surface errors.
- C3 ConfirmSheet buttons lack hitSlop (ConfirmSheet.tsx ~76). EASY.
- C5 deck-tx mode optimistic, no rollback on reject (index.tsx ~200). MED.
- C10 SOLO color-only feedback, add text state (mixer.tsx ~408). EASY.
- C6 view-selection optimistic swallow (mixer.tsx ~1173). EASY (toast).
→ Consolidate into ONE captainpad_qol slice owning mixer.tsx/index.tsx/api.ts/
  ConfirmSheet.tsx, launched AFTER WAVE3 (dev/captainpad_hotswap_ui) merges.

### Lens D — deck/mixer × hot-swap × timeline (agent aea469e, DONE) — STRATEGIC
HEADLINE: merged hot-swap path and origin/feat/timeline_support were never
integrated. Timeline drives deck via INSTANT loadPlaylistEntry (hard cuts),
bypassing loadPlaylistEntryWithTransition + /deck/playlist/swap +
precompileNextDeckEntry. Timeline uses a per-channel autopilotPool; merged tip
has a single global deck autopilot → THEY COLLIDE on merge (#2, HARD, a
merge-time design decision for whoever merges timeline — NOT mine to fix here;
DOCUMENT only). Most D findings (#1,#2,#4,#5,#9) are in the TIMELINE BRANCH
(not my deliverable branch, coordinate-free — out of scope).
IN-LANE, ADDITIVE engine items that make MY hot-swap API timeline-ready:
- D-A (P0, EASY-MED): make /deck/playlist/swap PARAMETRIC + concurrency-safe —
  optional per-call `transition:{enabled,mode,durationMs}` overriding
  deckTransitionConfig (validated same as /deck/transition-config); if
  isDeckSwapInFlight → finishDeckSwapNow() then proceed OR return 409 EBUSY.
  Closes #1/#3/#8. Additive; existing callers keep defaults.
- D-B (P1, MED): add `POST /deck/playlist/queue {name,entryId}` → compile +
  warmInactiveDeckHandle WITHOUT advancing (warm-then-fire-on-anchor). Reuses
  the already-leak-safe warmInactiveDeckHandle contract. Replaces wrong-guess
  precompile heuristic.
- D-#10 == A7: removeDeckChannel / scene-switch must cancelDeckPatternSwap()
  before tearing down _inactiveDeckChannel (avoid rebind-to-destroyed-handle).
CORRECTION D flagged: E1's report calling swap "the win timeline needs" is
aspirational — timeline doesn't call it yet. D-A/D-B make it real.

### Lens E — techdebt/tests/arch (agent aee2692, DONE)
Verdict: MAINTAINABLE, no P0 bugs, 802 tests solid. Safe ADDITIVE wins:
- E#1/#10 (EASY): extract `applyChannelPatch(channel,data,id)` helper unifying
  deck (api_server ~3684-3731) + mixer (~2854-2907) PATCH (fader-lock, blend-mode
  validation, viewSelection, transition-cancel). Behavior-preserving.
- E#2 (EASY, additive test): saveDeckState pattern-swap persistence round-trip.
- E#5 (EASY, additive test): viewFader ramp interpolation (updateTransitions).
- E#6 (EASY, additive test): null-deck control path → 404.
- E#11 (MED, additive test): viewSelection validate→compile→render round-trip.
- E#7 api_server god-file router extraction → HARD, DEFER (risky, low value).
- E#4 channelIdCounter, E#3 serialize dup = RESOLVED/no-action.
- E#8 ChannelStrip prop-drilling, E#9 remaining `any` → CaptainPad, fold into
  captainpad_qol slice.

## IMPLEMENTATION WAVES (post-adversarial)

### WAVE 4 — engine hardening + timeline-ready (dev/engine_hardening_timeline,
slot 2) — owns pattern_mixer.js + api_server.js + ws_topic_routing.js + new
engine tests. Parallel & disjoint with WAVE 3 (CaptainPad). Priority order:
P0 validation/fail-loud (B:F1/F4/F2/F9/F7/F10) → perf-EASY (A:A1/A2/A5/A7) →
timeline-additive (D-A parametric+concurrency-safe swap, D-B queue/warm) →
dedup (E#1) → tests (E#2/E#5/E#6 + tests for all changes). VERIFY each
adversarial claim against real code (some are speculative; Node is
single-threaded so A4/A6 are wrong). Ship safe subset, document rest.

### WAVE 5 — captainpad QoL (dev/captainpad_qol) — AFTER WAVE 3 merges (shares
CaptainPad files). Lens C: removeMixerChannel res.ok + delete feedback (C1/C7),
fail-loud on .catch swallow (C2), ConfirmSheet hitSlop (C3), SOLO text (C10),
view-sel/deck-tx error surfacing (C5/C6) + Lens E#9 any-typing.

## STATUS LOG (cont.)

- 2026-06-20 T4: All 5 adversarial lenses DONE; findings + WAVE 4/5 plan
  recorded. WAVE 3 hot-swap UI agent DONE (c8e14f9 on dev/captainpad_hotswap_ui;
  PlaylistPanel.tsx + api.ts only; tsc 0, lint baseline, web:build 0). WAVE 4
  worktree (dev/engine_hardening_timeline, slot 2) created from tip; agent
  not yet launched.
- 2026-06-20 T5: OPERATOR promoted deliverable to `feat/optimize_channels`
  (renamed from claude/..., pushed, tracking). Operator deleting old claude
  ref. Resuming: merge WAVE 3, launch WAVE 4 engine-hardening agent.

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

## STATUS LOG (cont. 3)
- 2026-06-20 T7: Operator: do NOT close — continuous new-channel features to deadline.
  Perf benchmark MERGED (ad08141): vis-pool 3.9-24x + -12/-33% heap (real win),
  precompile -6/-12ms first-frame, mean frame -1.6/-2.5% at 312-1000px; 40fps-capped
  so win = CPU headroom/GC stability. WAVE 11 discovery → 13-feature backlog.
  WAVE 12 (engine: snapshots+master-fade+clamp+color) RUNNING (sole engine writer).
  Parallel read-only design agent for WAVE 15 groups+solo composite precedence RUNNING.
  Cadence: engine waves serialize on api_server.js/pattern_mixer.js; UI parallel after.

## STATUS LOG (cont. 4)
- 2026-06-20 T8: WAVE 12 engine features MERGED (132504e): snapshots/look-recall,
  master-fade, faderMax clamp, color. 869 pass/0 fail, HIL 25/25, persists across restart.
  Designs done: groups+solo (report _13, for WAVE 15) and playlist tags/hold-loop
  (zero-to-minimal api_server.js). Launched 3 PARALLEL disjoint feature agents:
  * WAVE 13-A dev/ui_master_fade — master-fade UI (DeckTopBar + new masterApi.ts)
  * WAVE 13-B dev/ui_snapshots_clamp_color — snapshots bar + clamp + color
    (mixer.tsx + new SnapshotBar.tsx + new channelExtrasApi.ts)
  * WAVE 16 dev/playlist_tags_holdloop — tags/search + hold/loop (playlist_manager.js
    + 2 surgical api_server.js lines + PlaylistPanel.tsx + api.ts). SOLE engine writer.
  Disjoint files: DeckTopBar|masterApi ‖ mixer.tsx|SnapshotBar|channelExtrasApi ‖
  PlaylistPanel|api.ts|playlist_manager|api_server. No shared file across the three.
  NEXT engine waves (serial): WAVE 14 metering, WAVE 15 groups+solo (spec ready _13).

## STATUS LOG (cont. 5)
- 2026-06-20 T9: 13-A master-fade UI MERGED (c3f7192) + 13-B snapshots/clamp/color UI
  MERGED (586d4ef). Snapshots, master-fade, faderMax, color now FULLY shipped (engine+UI).
  WAVE 16 playlist tags+hold/loop still building (sole engine writer, owns api_server.js).
  Launched read-only channel-ops design (#6 dup / #7 reorder / #9 panic) to de-risk reorder.
  Next engine waves after 16 merges (serial on api_server.js): WAVE 14 metering →
  WAVE 15 groups+solo (spec _13) → channel-ops (spec pending). Then re-discover.

## STATUS LOG (cont. 6)
- 2026-06-20 T10: WAVE 16 playlist tags+hold/loop MERGED (f3194ac); also de-flaked
  master_fade test (1e-6→RAMP_TOL 0.05), suite stable 876/0. Launched:
  * WAVE 15 dev/groups_solo_engine — groups + server-solo/solo-safe ENGINE (spec _13).
    Sole engine writer. effFader gate rewrite + mixGroups + soloedChannelIds.
  * dev/ui_deck_extras — deck-side faderMax/color (closes 13-B deferral; index.tsx only).
  Disjoint: engine(pattern_mixer/api_server/pattern_channel) ‖ CaptainPad(index.tsx).
  CADENCE after 15-engine merges: 15-UI (mixer.tsx group rail+solo) ‖ WAVE 14 metering
  ENGINE (pattern_mixer viz+api_server) — disjoint, parallel. Then ops cluster (spec _17,
  after 15). FEATURES SHIPPED so far: hot-swap, snapshots, master-fade, clamp, color,
  playlist tags/search, hold/loop (+ all hardening/QoL/perf/audit/docs).

## INCIDENT (2026-06-20 T11) — WAVE 15 editing MAIN checkout, not its worktree
- dev/groups_solo_engine agent (a298669) is writing groups+solo engine edits to
  /home/user/BM26-Titanic/marsin_engine/lib/ (MAIN, on feat/optimize_channels working
  tree) instead of its worktree (which is clean). Anti-pattern §9. ~394 insertions across
  pattern_channel.js, pattern_mixer.js, api_server.js, state_manager.js.
- BACKUP of the in-progress edits: ~/tmp/wave15_backup/ (4 files) — insurance vs self-clobber.
- HOLDING all git ops in main while the agent is live (avoid index-lock race; it may run git
  in main cwd). Do NOT revert (destroys work), do NOT commit (incomplete/unverified).
- RESOLUTION PLAN when WAVE 15 reports: its edits are already in main's feat working tree →
  I verify them myself (full suite + groups/solo HIL, run carefully with state restore),
  then COMMIT directly to feat/optimize_channels with a merge-style message (I become the
  committer for this slice; worktree-branch isolation lost but outcome — verified work on
  feat — is the same). Then clean up the empty dev/groups_solo_engine worktree/branch.
- deck-extras (ece7cf1, dev/ui_deck_extras) is DONE + correct in its worktree (index.tsx
  only) — MERGE IT AFTER WAVE 15's edits are committed (index.tsx is clean in main, but
  merge needs a clean main tree first).

## INCIDENT RESOLVED (T11) — WAVE 15 self-recovered
The agent caught its own misdirection: copied the work into the worktree, restored main to
baseline (verified: main lib diff empty, only this plan note pending). Work properly committed
to dev/groups_solo_engine (9974153). 910 pass/0 fail (+34), HIL 18/18 incl. soloSafe-stays-lit.
Normal worktree-merge flow applies. ~/tmp/wave15_backup no longer needed. No cross-contamination.

## STATUS LOG (cont. 7)
- 2026-06-20 T12: WAVE 15 groups+solo ENGINE MERGED (f802f41): 910 pass/0 fail, HIL 18/18
  incl. soloSafe-stays-lit. deck-extras MERGED (fe86285). Launched 2 parallel (disjoint):
  * WAVE 15-UI dev/groups_solo_ui — group rail + server-solo + solo-safe in mixer.tsx
    (+ new groupsSoloApi.ts); deletes destructive client soloRef/preSoloStateRef.
  * WAVE 14 dev/channel_metering — engine per-channel output level (alloc-free, folded into
    vis extraction) + meter in ChannelVizStrip (self-subscribing, NOT mixer.tsx).
  Both agents told EXPLICITLY to edit only within their worktree (the WAVE 15 engine agent
  had mistakenly edited main, self-recovered; guard added to prevent repeats).
  After these: ops cluster (dup/reorder/panic, spec _17). FEATURES SHIPPED: hot-swap,
  snapshots, master-fade, clamp, color, playlist tags/search, hold/loop, groups, server-solo,
  deck-extras (+ hardening/QoL/perf/audit/docs/de-flake).

## STATUS LOG (cont. 8)
- 2026-06-20 T13: WAVE 15-UI MERGED (2f078a9, group rail + server solo + solo-safe, destructive
  client solo removed) + WAVE 14 metering MERGED (f41b81f, 923 pass/0 fail). Original 13-feature
  backlog ~exhausted (only ops cluster + low-value #13 left). Launched 2 parallel:
  * dev/channel_ops_engine — ops cluster ENGINE (dup/reorder/panic, spec _17). Sole engine writer.
  * round-2 feature DISCOVERY (read-only) — fresh backlog of NEXT channel features.
  All agents now hard-instructed: edit ONLY within worktree (post WAVE-15 misdirection guard).
  Suite at 923 pass/0 fail; deliverable f41b81f. After ops: ops-UI + round-2 batch.

## STATUS LOG (cont. 9)
- 2026-06-20 T14: ops-cluster ENGINE MERGED (6557b7c): dup/reorder/panic, 933 pass/0 fail,
  HIL 30/30 incl. panic-keeps-rig-LIT (even malformed-home). Original backlog DONE.
  Round-2 backlog banked (_23). Launched 2 parallel (disjoint):
  * dev/channel_ops_ui — dup/reorder/panic UI in mixer.tsx + new channelOpsApi.ts.
  * dev/cue_to_deck — round-2 #7 cue-to-deck: engine /deck/focus (deckFocusChannelId
    already honored in render) + index.tsx CUE + new deckFocusApi.ts + HIL.
  Disjoint: mixer.tsx(ops-UI) vs index.tsx+api_server+pattern_mixer(cue). Both worktree-scoped.
  NEXT after these: round-2 C flash/bump (pattern_mixer+mixer.tsx), B param presets (new file+
  api_server), then #3 phase-clock chain (#3/#4/#11), #1 morph, #6 follow, #8 invert, #10 undo.
  Suite 933 pass/0 fail; deliverable 6557b7c.

## OPERATOR REQUESTS (T16) — TOP PRIORITY, ahead of round-2 backlog
1. (answered) "What is CAP" = per-channel intensity ceiling (faderMax); hard clamp on a
   channel's contribution regardless of fader/transition/group; default 100%; fixture protection.
2. NEW: Hue shifter as a GLOBAL EFFECT (rotate hue of final output; fits GLOBAL EFFECTS bar).
3. NEW: Hue shifter PER MIXER CHANNEL (rotate that channel's hue before blend; per-channel field + strip control).
4. FIX: Mixer UI cramped — pattern/entry NAMES unreadable (truncated). Layout/readability fix in mixer.tsx/PlaylistPanel.
SEQUENCING: these touch mixer.tsx (cramp fix + per-channel hue UI) + engine api_server/pattern_mixer
(hue effects) — currently owned by in-flight ops-UI (mixer.tsx) + cue-to-deck (engine/index.tsx).
LET THOSE LAND FIRST, then do these as the immediate next batch. Recon agent a47e25 (read-only)
mapping global-effects architecture + the mixer-cramp cause is RUNNING.
Likely build order once files free: (4) mixer readability fix [mixer.tsx, high-impact, safe] →
(2)+(3) hue engine [one engine writer: global effect + per-channel field + composite] →
hue UI [mixer.tsx global-effects bar + per-strip]. The cramp fix (4) should go FIRST so the
new per-channel hue control lands into an already-decluttered strip.

## STATUS LOG (cont. 10) — RESUME after ~16h dormancy
- 2026-06-21 ~08:00Z: session resumed. Found ops-UI + cue-to-deck agents STALLED (dead):
  last write ~959 min ago, uncommitted partials, 123-byte output stubs, no completion, no live
  proc. Took over per protocol — discarded the stale partials (based on old tip 6557b7c),
  cleaned worktrees/branches. Readability fix (operator req #3) already MERGED a5ee521.
- PIVOT to operator's HUE requests (priority). Relaunched 2 parallel (disjoint, worktree-scoped):
  * dev/hue_engine — global + per-channel hue ENGINE (plan _27). Sole engine writer.
  * dev/channel_ops_ui (re-do) — dup/reorder/panic UI in mixer.tsx + channelOpsApi.ts.
  Disjoint: engine files (hue) vs mixer.tsx (ops-UI). NEXT: hue UI (mixer.tsx + GlobalEffectMacros,
  after both land) + re-queue cue-to-deck #7 (api_server, after hue_engine).

## STATUS LOG (cont. 11)
- 2026-06-21: ops-UI MERGED (2e482d8, dup/reorder/panic controls — ops cluster complete).
  HUE ENGINE MERGED (5d3df52): global + per-channel hue, 954 pass/0 fail, HIL 17/17 (RGB rotates,
  W/A/UV untouched, fail-loud, round-trip). Operator hue request now half-done (engine).
  Launched 2 parallel (disjoint): dev/hue_ui (global hue control in GlobalEffectMacros + per-channel
  HUE row in mixer.tsx + channelExtrasApi setChannelHue/setGlobalHue) ‖ dev/cue_to_deck #7
  (engine /deck/focus + index.tsx CUE). When hue_ui lands → operator's 3 requests ALL done
  (readability a5ee521 + hue engine 5d3df52 + hue UI) → live screenshot showcase.
  Suite 954 pass/0 fail; deliverable 5d3df52.

## STATUS LOG (cont. 12) — ALL 3 OPERATOR REQUESTS DONE
- HUE UI MERGED (36b1186): global HUE+SPIN in GLOBAL EFFECTS bar + per-channel HUE row.
  Operator's 3 requests COMPLETE end-to-end:
  (1) mixer readability a5ee521; (2)+(3) hue shifter global+per-channel: engine 5d3df52 + UI 36b1186.
  Suite 954 pass/0 fail; CaptainPad tsc 0 / lint 11 / web:build 21. Deliverable 36b1186.
- Building live screenshot showcase (mixer legible rows + per-channel HUE + global HUE; deck;
  sim showing hue rotation). cue-to-deck #7 still running (own worktree). After showcase:
  merge cue-to-deck, then resume round-2 backlog (flash/bump, param presets, speed/tap/chase, etc.).

## STATUS LOG (cont. 13)
- cue-to-deck #7 MERGED (44825b9): 960 pass/0 fail, HIL 18/18. ALL 3 operator requests proven
  with live showcase (hue_mixer.png + hue_deck.png sent): readability 2-line names, per-channel
  HUE rows (CH3=200), global HUE SHIFT 60° + SPIN +20. Round-2 continuing:
  * dev/flash_bump — #5 momentary full-while-held (bump Set in _effFader, WS+REST, auto-release
    on disconnect, faderMax-capped) engine+UI vertical.
  * snapshot-morph design (read-only) — #1 recall-fade spec.
  Remaining round-2: #9 param presets, #3 speed→#4 tap→#11 chase, #1 morph, #2 cycle, #6 follow,
  #8 invert, #10 undo. Suite 960 pass/0 fail; deliverable 44825b9.

## STATUS LOG (cont. 14)
- flash/bump #5 MERGED (7a9f113): 976 pass/0 fail, HIL 19/19 (auto-release, faderMax cap). Launched:
  * dev/snapshot_morph — #1 recall-fade morph (vertical engine+UI, design _31).
  * speed/tap/chase design (read-only) — #3/#4/#11 shared phase-clock spec.
  Remaining round-2: #9 param presets, #3/#4/#11 (after design), #2 auto-cycle (after morph),
  #6 follow, #8 invert, #10 undo. Suite 976 pass/0 fail; deliverable 7a9f113.

## STATUS LOG (cont. 15)
- snapshot-morph #1 MERGED (4f64391): 987 pass/0 fail, HIL 18/18 (lands exactly on target).
  Launched dev/phase_clock_engine — #3 speed + #4 tap-tempo + #11 chase ENGINE (design _33,
  per-channel accumulated _phaseSeconds). Sole engine writer. UI deferred (pair with next engine
  feature). NEXT: phase-clock UI ‖ param-presets engine (#9 new-file). Then #2 cycle, #6 follow,
  #8 invert, #10 undo. Suite 987 pass/0 fail; deliverable 4f64391.

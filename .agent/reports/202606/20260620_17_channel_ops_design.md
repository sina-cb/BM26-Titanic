# Design — Channel Ops Cluster: #6 Duplicate · #7 Reorder · #9 Panic/Home

Read-only design (2026-06-20). One engine wave (co-touch mixerChannels[] + api_server.js), UI after.
Compose with WAVE 12 (faderMax/color/master-fade, merged) + WAVE 15 (groups/solo, report _13).
**SEQUENCING: land WAVE 15 BEFORE this cluster** (duplicate copies the serialized blob → inherits
mixGroupId/soloSafe free; panic must clear soloedChannelIds + un-mute groups — only exist post-15).
Reorder itself is independent of 15. Metering (WAVE 14) is read-only telemetry, independent — any order.

## Router note
api_server.js is a sequential method/url if/else chain. Insert specific arms BEFORE `^/mixer/channels/[^/]+$`
PATCH/DELETE so `/duplicate` and `/reorder` aren't captured as channel ids (hazard documented at ~:3456).

## #6 Duplicate — `POST /mixer/channels/:id/duplicate`
- rejectIfWrongRole(id,'mixer') (404 deck); getMixerChannel→404 if missing.
- Cap delegated to addMixerChannel (throws → 400 with msg; single source, no double-check).
- Implement as: copy source via `serializeChannelForState(src)` (state_manager serializer captureLook uses),
  override id (`ch_${Date.now()}_${channelIdCounter++}`) + name (`${src.name} copy`), then
  `buildChannelFromSaved(serialized,'mixer',pattern)` — compiles a FRESH handle (never share src.handle →
  double-free), rebinds playlist, replays localControls, finalizeCpcValues. Lands on TOP (push).
- Copies pattern/mode/fader/enabled/locks/transition/viewSelection/faderMax/color/playlist/localControls
  (+ mixGroupId/soloSafe post-15). saveAllState + broadcastChannelPlaylistData + broadcastMixerState.
  Response shape mirrors add. UI: duplicate icon by trash (≥44pt), no ConfirmSheet (non-destructive).

## #7 Reorder — `POST /mixer/channels/reorder {order:[ids]}`
- VALIDATE before mutate (P0): order is array, length==current, no dup (Set size), exact same id set →
  else 400 `REORDER_BAD_SET`. No partial apply.
- New mixer method `reorderMixerChannels(orderedIds)`: `byId=Map(...); this.mixerChannels =
  orderedIds.map(id=>byId.get(id)||throw)` — single atomic reassignment of the SAME channel objects.
- SAFE vs index invariant (pattern_mixer.js:163-170): position==stack order, no numeric index field; all
  state lives on objects (preserved by ref). Nothing recompiled. order[0]=bottom(seeds), order[last]=top.
- MID-TRANSITION: ACCEPT (no 409). `_renderOrderScratch` is rebuilt every frame from mixerChannels via
  findIndex (no cross-frame stale index), so reorder is picked up next frame; transitions[] key on
  channelId not index. Document; don't add a spurious busy guard.
- Compose w/15: reorder must NOT touch mixGroupId/soloSafe/soloedChannelIds; group membership is a
  channel pointer (preserved by ref), members derived by filter (order-independent). CROSS-WAVE INVARIANT:
  WAVE 15 `_groupScaleCache` MUST key on group id (not array index) — flag in both PRs.
- saveAllState (order persisted by iterating mixerChannels) + broadcastMixerState. UI: up/down chevrons
  (NOT drag — draggable-flatlist isn't vendored, offline rule). Label "up = toward top of mix".

## #9 Panic/Home — `POST /mixer/panic {home?}`
- Home = recall a designated snapshot if set (reserved name "home" via snapshotManager.has/load →
  recallLook, which never-dark-rebuilds deck + respects cap), else SAFE LIT DEFAULT.
- Safe default (new mixer method `panicToSafeDefault()` + route-level globals):
  cancel master fade (setMaster(1.0) nulls _masterFade); **cancelDeckPatternSwap** (NOT finish — want
  current known-lit, not a half-chosen target); cancelChannelTransition each (restores _savedMode, clears
  scriptedTransitionTargetId); clear blackout (intensityController.setBlackout(false)+globals+persist);
  master=1.0 full (no fade — maximize visibility); enable all overlays, fader=1.0 EXCEPT faderLocked
  (respect parked) and DON'T touch faderMax (safety ceiling); post-15: soloedChannelIds.clear() + un-mute
  groups (don't delete); clear viewOverride lease + reset targetViewFader.
- FAIL-LOUD exception (mission-critical, documented): if a configured home snapshot is malformed/over-cap,
  return 400 with the structured error BUT still clear blackout + master-up so the rig is LIT. The ONE
  sanctioned fallback — and it's loud.
- saveAllState + broadcast globals/mixer/deck. UI: PANIC/HOME button in globalRigBar, amber, ConfirmSheet
  ("cancels fades/transitions, clears blackout, brings master up, returns to home — exterior will be lit").

## Ownership
Engine writer: pattern_mixer.js (reorderMixerChannels, panicToSafeDefault), api_server.js (3 route arms;
duplicate reuses buildChannelFromSaved, panic reuses recallLook+snapshotManager). snapshot_manager.js no
change (optional getHomeName helper). + tests + docs/39. UI after: mixer.tsx (dup icon, reorder chevrons,
panic button+ConfirmSheet) + utils/api.ts (duplicateMixerChannel/reorderMixerChannels/panicMixer).

## Tests
Unit: dup at cap-1 lands top / at cap 400 / distinct id+handle / inherits 15-fields; reorder permutation
reindex + bad-set 400s + objects preserved by ref; panic sets master=1, enables overlays, clears
fade/transitions/scriptedTarget, respects faderLocked+faderMax, (15) clears solo+un-mutes groups.
HIL: dup respects cap; reorder reverses + intact + no handle leak; **reorder mid scripted-transition →
200, completes, target on top throughout (2 vis frames)**; **panic with master-fade-0 + deck-swap +
transition (+solo) in flight → master 1, no swap, blackout false, all enabled, solo cleared, OUTPUT
NON-ZERO PIXELS (rig LIT — mission assertion)**; panic-with-home recalls look; panic-malformed-home →
400 but still lit.

## Risks (mitigations)
Reorder mid-transition (safe by per-frame scratch); index-invariant (validate+atomic, never splice);
panic clobbers intent (ConfirmSheet + prefer operator-defined home snapshot); dup id collision (reuse
monotonic minting, never copy id); dup shared handle (recompile fresh — test independence); maxChannels
cap=3 code vs 6 docs (delegate to addMixerChannel single source; confirm config.yaml); broken-home silent
fail (loud 400 + still lit); cross-wave gang-scale-by-index (invariant: key on group id); route shadowing
(specific arms before :id regex).

Key files: pattern_mixer.js, api_server.js, snapshot_manager.js, mixer.tsx, utils/api.ts, docs/39,
report _13 (groups/solo).

# Round-2 #1 Snapshot Crossfade/Morph — Design (read-only recon)

Recall a saved look by ramping current→target over N seconds. Additive; instant recall untouched.
ONE engine writer (api_server.js + pattern_mixer.js serial), UI after.

## API
`POST /mixer/snapshots/:name/recall-fade { durationMs }` (finite >0). 404 missing, 400 SNAPSHOT_MALFORMED,
400 durationMs<=0, 400 SNAPSHOT_OVER_CAP (validate the UNION current∪target vs maxChannels — transient
cap risk: C channels still exist while fading out while T are added). No saveAllState at kickoff (transient,
like /mixer/master/fade); persist on completion. Broadcast {type:'snapshots',action:'recall-fade'}.

## Semantics (match by channel ID)
- M (in both): ramp only `fader` current→target via fadeChannel(id,target,durationMs,{curve:smoothstep});
  SNAP structural/chroma fields (pattern,mode,viewSelection,faderMax,color,hue,mixGroupId,soloSafe).
  Skip fader-locked (fadeChannel refuses them).
- T (target-only): build at kickoff (buildChannelFromSaved), force fader=0+enabled, fadeChannel 0→target.
- C (current-only): fadeChannel(id,0,durationMs,{destroyOnComplete:true}) → updateTransitions removes it;
  finalizer must paramCenter.unregisterChannel(id) (removeChannel does NOT — instant recall does at :1847).
- Master: startMasterFade(look.master,durationMs). Groups: ADD a _groupFades ramp array parallel to
  _masterFade (v1 recommends ramping group faders; snap is the cheaper fallback). Deck: snap content
  (never-dark), ramp deck fader.
- v1 DECISION: ramp LEVELS only (fader/group/master); SNAP hue/color/faderMax. color=metadata (no render),
  faderMax=ceiling (non-linear if ramped), hue=angular (needs short-arc, v2). Document.

## Engine state
`this._morph = {startMs,durationMs,fadeOutIds,onComplete}` on PatternMixer. Kickoff in a new
`morphToLook(look,durationMs)` (api_server, owns build+CPC): cancel/replace prior _morph + master-fade
(auto via startMasterFade) + per-channel transitions (auto via fadeChannel cancel) + clear solo (transient,
like triggerMixerTransition :1343) + cancel deck swap; build T(fader0); snap M structural; restoreMixGroups;
schedule ramps. Per-frame: transitions[]/_masterFade/_groupFades already tick in beginFrame; _morph tick =
O(1) wall-clock + "no transitions for my ids" → finalizer (CPC-unregister fadeOutIds, clear _morph,
saveAllState, broadcast recall-fade-complete). Allocation-free hot path; reuse transitions[] wholesale.

## REUSE (pattern_mixer.js): startMasterFade :1110, _tickMasterFade :1151, fadeChannel :1213 (+destroyOnComplete
:1241), updateTransitions :1802 (smoothstep, exact land, removeChannel on complete :1850), updateMixGroup :877,
_effFader :997 (morph composes through solo/bump/group/faderMax automatically by ramping fader).
recallLook api_server.js:1832 (instant; teardown+rebuild+setMaster), restoreChannel :1695, captureLook :1783.

## UI (after engine)
SnapshotBar.tsx: per-row MORPH button → inline duration pills 1/3/5/10s (default 3) → recallSnapshotFade(name,
durationMs). No optimistic flip (WS reconciles). Alert on 4xx (like handleRecall :89). channelExtrasApi.ts:
recallSnapshotFade() mirroring recallSnapshot :100 + masterApi.fadeMaster body shape.

## Tests
Unit (snapshot_morph.test.js): M lerp lands exact + midpoint≈smoothstep(0.5); T 0→target; C→0+removed; same-id
changed-pattern → structural snap + level ramp; durationMs<=0/non-finite/missing rejected pre-mutation;
over-cap union → SNAPSHOT_OVER_CAP; hue/color/faderMax snap at kickoff; replace mid-flight (no orphan/double-free);
CPC unregister once on complete. HIL: recall-fade ramps master+faders monotonically, channel set converges to B,
and after durationMs the mix EQUALS an instant recall of B exactly; error paths.

## Risks
transient cap (union>max → fail-loud SNAPSHOT_OVER_CAP, no silent fallback); morph during transition/fade/bump
(cancel/replace at kickoff; manual master/fader write mid-morph → cancel whole morph for consistency); hue arc
(snap v1); CPC unregister gap (finalizer must do it); deck never-dark (snap deck content); persist only on
completion. Citations: api_server.js:1605/1695/1783/1832/1846/1872/3229/3446/3716; pattern_mixer.js:697/711/877/
997/1089/1110/1151/1213/1802/1850/1889; SnapshotBar.tsx:89; channelExtrasApi.ts:100; masterApi.ts:35.

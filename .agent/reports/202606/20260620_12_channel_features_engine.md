# Channel Features (engine side) — handoff

**Date**: 2026-06-20
**Branch**: `dev/channel_features_engine` (worktree slot 2, engine port 31268)
**Author**: engine developer agent (sole engine writer this wave)
**Scope**: `marsin_engine` only. No CaptainPad / engine.js edits (UI is a later wave).

Built the ENGINE side of four additive, backward-compatible channel features.
All changes are additive: old state files without the new fields load and
restore to documented schema defaults (a default is not a silent fallback).
Non-finite / structurally-wrong inputs are rejected loudly (Codex P0).

## What shipped (all four features — full subset, nothing deferred)

- **F-A — Named mixer snapshots / look recall** (flagship). New
  `lib/snapshot_manager.js` (`SnapshotManager` + `SnapshotLoadError`). Routes:
  `GET/POST /mixer/snapshots`, `GET/DELETE /mixer/snapshots/:name`,
  `POST /mixer/snapshots/:name/recall`. Captures the full mixer look (master +
  deck + overlays incl. faderMax/color) via the existing `serializeChannel`;
  recall reuses `buildChannelFromSaved`/`setDeckChannel`/`addMixerChannel`/
  `removeMixerChannel`/`setMaster` and respects `maxChannels` (over-cap ⇒ 400).
  Atomic YAML writes (new public `StateManager.writeFileAtomic`). WS event
  `snapshots` (save/delete/recall). Unknown name ⇒ 404; malformed ⇒ 400
  (`SNAPSHOT_MALFORMED`, mirrors `PlaylistLoadError`).
- **F-B — Grand-master timed fade / blackout** (flagship). `POST
  /mixer/master/fade {target,durationMs}`. Animates `master` on the 40 Hz tick
  copying the `viewFader` dt-clamped ramp (`_tickMasterFade` in
  `renderAll6ch`). `setMaster` cancels an in-flight fade. `master` + `masterFade`
  exposed on `/status`, `/mixer`, deck/mixer WS. Validates target finite [0,1]
  and durationMs finite >0 (NaN ⇒ 400). Instant-set behavior unchanged.
- **F-C — Per-channel intensity clamp (`faderMax`)**. Added to `PatternChannel`,
  both serializers, restore, and `PATCH /mixer/channels/:id` + `PATCH
  /deck/channel`. Hard ceiling at the composite: `min(channel.fader, faderMax)`.
  Default 1.0. Validated as a fader (finite, [0,1]).
- **F-D — Channel `color`** (metadata, no render effect). Added to
  `PatternChannel`, both serializers, restore, and both PATCH handlers. String
  or null; other types ⇒ 400. Default null.

## Files touched

- NEW `marsin_engine/lib/snapshot_manager.js`
- `marsin_engine/lib/pattern_channel.js` (faderMax/color fields)
- `marsin_engine/lib/state_manager.js` (serializeChannel + saveMixerState +
  public `writeFileAtomic`)
- `marsin_engine/lib/pattern_mixer.js` (master fade state/methods/tick; faderMax
  clamp in overlay composite)
- `marsin_engine/lib/api_server.js` (snapshot routes, master fade route,
  captureLook/recallLook, PATCH + serializers + /status + restore)
- `marsin_engine/lib/ws_topic_routing.js` (`snapshots` → control)
- NEW tests: `tests/snapshot_manager.test.js`, `tests/master_fade.test.js`,
  `tests/fader_max_clamp.test.js`, `tests/channel_feature_fields.test.js`,
  `tests/hil/hil_channel_features_test.mjs`
- `tests/state_atomicity.test.js` (key-order assertions extended for the two
  appended fields)
- `docs/39_channels_deck_mixer.md` (new §8 + impl map)

## Verification proof (exact commands + outputs)

- `git diff --check -- marsin_engine docs` → **DIFF-CHECK-CLEAN** (no
  whitespace errors).
- `node --check` on every changed/new `.js`/`.mjs` (pattern_channel,
  state_manager, pattern_mixer, snapshot_manager, api_server, ws_topic_routing,
  all 5 new test files) → **all OK**.
- `node engine.js --list` → **60 pattern(s) found**.
- `node engine.js --pattern test_const --model test_bench --dry-run` →
  **exit 0**, "Dry run complete. Pattern loads and compiles OK", **no missing
  blend/transition warning** (all blend + trans_* scripts compiled).
- `node --test tests/*.test.js` → **tests 869 / pass 869 / fail 0**
  (baseline was 829; +40 new = 869, 0 fail). New unit coverage:
  snapshot round-trip + missing→null + malformed→SnapshotLoadError + name
  safety + over-cap-via-recall (HIL); master fade reaches target over
  duration + cancels on setMaster + rejects NaN target/duration; faderMax
  ceiling enforced + persists; color persists + type-rejects.
- **HIL on :31268** (`tests/hil/hil_channel_features_test.mjs`) →
  **25/25 assertions passed**. Asserted: PATCH faderMax+color surfaced in
  broadcast; non-finite faderMax / non-string color → 400; snapshot
  capture+list+get; mutate (change faderMax/color, add overlay, change master)
  then recall → overlay count restored, faderMax 0.42 + color #1188ff restored,
  master restored; master fade → 200 + active, mid-fade master strictly
  ramping (0.6725) with masterFade active, settled near 0 + masterFade null,
  direct setMaster cancels in-flight fade; fade NaN/0/-5 → 400; recall/GET
  unknown name → 404.
- **Persistence proof**: PATCHed channel `faderMax:0.33, color:#deadbe` and
  captured snapshot `persist_proof`; on-disk `mixer_state.yaml` showed
  `faderMax: 0.33` / `color: '#deadbe'` and `snapshots/persist_proof.yaml`
  existed. **Restarted engine** → `GET /mixer` returned `faderMax=0.33
  color=#deadbe` and `GET /mixer/snapshots` listed `persist_proof`. Survived.
- **State hygiene**: snapshotted `states/test_bench/{deck,mixer,globals}_state.yaml`
  before HIL, restored after, deleted the test snapshot file. `git status
  marsin_engine/states/test_bench/` → **clean (no residue)**. Port 31268
  freed (`lsof` → PORT FREE).

## Exact new API surface (for the follow-on UI wave)

```
GET    /mixer/snapshots                  → { snapshots: string[] }
POST   /mixer/snapshots  {name}          → { status:'ok', name }
GET    /mixer/snapshots/:name            → look | 404
DELETE /mixer/snapshots/:name            → { status:'ok' } | 404
POST   /mixer/snapshots/:name/recall     → { status:'ok', name } | 404 | 400(over-cap/malformed)
POST   /mixer/master/fade {target,durationMs} → { status:'ok', masterFade } | 400
PATCH  /mixer/channels/:id {faderMax?,color?} (+ existing fields)
PATCH  /deck/channel       {faderMax?,color?} (+ existing fields)
```

New broadcast / status fields:
- Channel objects (both `/mixer` and `/deck` serializers): `faderMax:number`
  (default 1.0), `color:string|null` (default null).
- `/status`, `/mixer`, deck/mixer WS: `master:number`,
  `masterFade: null | { active, from, to, durationMs, elapsedMs, remainingMs }`.
- WS event: `{ type:'snapshots', action:'saved'|'deleted'|'recalled', name,
  snapshots }` on `/ws/control`.

Snapshot look shape (GET /mixer/snapshots/:name):
`{ name, savedAt, master, deck: <channelCore>|null, channels: [<channelCore>...] }`
where `<channelCore>` is the `state_manager.serializeChannel` output (now incl.
`faderMax`, `color`).

## Known gaps / notes

- None deferred — all four features shipped on the engine side.
- `states/summer_camp_dome/*` and `simulation/scenes/summer_camp_dome/...`
  show as dirty in `git status`, but these are **pre-existing** on the branch
  tip (other slots / prior waves) — I never ran the summer_camp_dome model and
  did not touch those files. The empty `states/summer_camp_dome/snapshots/`
  dir is an untracked harmless mkdir from a SnapshotManager boot elsewhere.
- `dev/channel_features_engine` is LOCAL ONLY (never pushed/merged).
- CaptainPad consumption (snapshot picker, master-fade button, faderMax slider,
  color chip) is the next UI wave — this branch is engine-only.

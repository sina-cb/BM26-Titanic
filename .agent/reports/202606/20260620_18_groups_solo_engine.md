# 20260620_18 — Channel Groups (gang-faders) + Server-Authoritative Solo (WAVE 15, engine side)

**Branch:** `dev/groups_solo_engine` (slot 2, local only) ·
**Worktree:** `/root/workspace/BM26-Titanic-worktrees/groups_solo_engine` ·
**Commit:** `9974153` ·
**Spec:** `.agent/02_reports/202606/20260620_13_groups_solo_design.md`

Engine-only wave. Additive, backward-compatible, allocation-free hot path,
fail-loud validation, no silent fallbacks. CaptainPad untouched (separate
later wave). Composes with the already-merged WAVE 12 (faderMax clamp,
per-channel color, master-fade animator) — read `faderMax ?? 1` defensively;
never touched `this.master` / target-master / master-fade.

## What was built

- **`lib/pattern_channel.js`** — `mixGroupId` (default `null`, single-membership
  channel→group pointer) + `soloSafe` (default `false`) ctor fields, typed/coerced.
- **`lib/pattern_mixer.js`** — `mixGroups[]` registry + `soloedChannelIds` Set
  (transient) + reused `_groupScaleCache` Map; group CRUD (`createMixGroup`,
  `updateMixGroup`, `deleteMixGroup` [clears members first], `addChannelToGroup`
  [single-membership 400 / deck-reject / 404], `removeChannelFromGroup`); solo
  (`setSolo` additive|replace, `clearSolo` one|all); **`_effFader`** implementing
  the exact precedence; per-frame precompute (`_groupScaleCache.clear()`+`set()`,
  `soloActive = size>0`) before the loop; composite-gate rewrite to one
  `eff<=0.001` skip; `removeMixerChannel` drops solo+membership (no phantom-solo);
  `triggerMixerTransition` clears solo at start; teardown clears registry.
- **`lib/api_server.js`** — group routes (`GET/POST /mixer/groups`,
  `PATCH/DELETE /mixer/groups/:gid`, `POST /mixer/groups/:gid/members`,
  `DELETE .../members/:channelId`) + solo routes (`POST /mixer/solo`,
  `DELETE /mixer/solo/:channelId`, `DELETE /mixer/solo`), armed BEFORE the
  `/mixer/channels/:id` regexes (members routes before bare `/:gid`); `soloSafe`
  in `PATCH /mixer/channels/:id`; both serializers gain `mixGroupId`/`soloSafe`;
  `serializeMixerState` gains top-level `mixGroups[]` + `soloedChannelIds[]`;
  `buildChannelFromSaved` plumbs the fields; `restoreMixGroups` at boot + recall;
  `captureLook` carries groups; WS `setSolo`/`clearSolo` (reject pushback).
- **`lib/state_manager.js`** — `serializeChannel` appends `mixGroupId`/`soloSafe`
  (after faderMax/color, byte-compatible); new `serializeMixGroup`;
  `saveMixerState` persists `mixGroups[]`; `loadMixerState` defaults `mixGroups: []`.
  Solo set deliberately NOT persisted (transient). snapshot_manager untouched —
  groups/membership/soloSafe ride along in the look channels + new `mixGroups`.
- **`docs/39_channels_deck_mixer.md` §10** — concepts, precedence, full API
  surface, persistence, impl map, deferrals.

## Precedence implemented (exactly per spec §7)

```
groupScale = group ? (group.muted ? 0 : group.fader) : 1
soloActive = soloedChannelIds.size > 0
soloGate   = !soloActive ? 1 : (soloSafe || faderLocked || soloed) ? 1 : 0
enabledGate= enabled ? 1 : 0
effFader   = clamp(fader, 0, (faderMax ?? 1)) * groupScale * soloGate * enabledGate
```
mute wins · soloSafe survives a solo but not a group-mute · group-mute beats
member-solo · fader-lock implies solo-safe AND group still scales a locked
channel · faderMax clamp before groupScale · master-fade acts last/independently.

## Verification proof

- `git diff --check -- marsin_engine docs` → **CLEAN**.
- `node --check` on all 8 changed/new JS files → **all ok**.
- `node engine.js --list` → **60 patterns**. `--dry-run` (test_const/test_bench)
  → **exit 0**, no missing-blend warning ("Pattern loads and compiles OK").
- `node --test "tests/*.test.js"` (FULL glob): **910 pass / 0 fail**
  (baseline 876 + 34 new). Re-ran — stable, no flake. (Two pre-existing
  shape-pin tests in `state_atomicity.test.js` updated to include the additive
  `mixGroupId`/`soloSafe` keys — justified, backward-compatible.)
- **Unit — `tests/groups_solo_precedence.test.js` (18)**: every §7 row —
  no-solo/no-group regression, mute-wins, soloSafe-survives-solo,
  group-mute-beats-solo, group-fader-scales (incl. soloed + locked members),
  faderMax-before-gang, fader-lock-implies-safe, additive/replace solo,
  solo-only-safe-unchanged, master-fade-after-solo, allocation-free cache reuse.
- **Unit — `tests/groups_solo_state.test.js` (16)**: ctor defaults + coercion,
  serializeChannel/serializeMixGroup round-trip, old-file→defaults, group CRUD,
  single-membership 400, idempotent same-group, 404s, deleteMixGroup clears
  members, **removeMixerChannel solo+membership cleanup (phantom-solo guard)**,
  triggerMixerTransition clears solo.
- **HIL — `tests/hil/hil_groups_solo_test.mjs` on :31268 — 18/18 PASS**, incl.:
  - **MISSION-CRITICAL: a soloSafe channel stays LIT in the rendered `master`
    vis output while another channel is soloed** (`master brightness > 0`).
  - group-mute beats member-solo → rendered output **DARK** (`brightness == 0`).
  - solo survives a fresh WS reconnect (`/mixer` broadcast carries
    `soloedChannelIds`).
  - transition clears the solo set.
  - validation: solo unknown→404, member no channelId→400, deck in group→400,
    PATCH unknown group→404, group fader NaN→400, un-solo unknown→404.
  - single-membership (2nd group)→400; `GET /mixer` carries `mixGroups[]` +
    `soloedChannelIds[]`.
- **Persistence (manual restart proof on :31268)**: after creating a group +
  member + `soloSafe` + an active solo and restarting the engine —
  `ext.mixGroupId` and `ext.soloSafe:true` **survived**, `mixGroups` registry
  **restored**, and `soloedChannelIds: []` (solo correctly transient/empty
  after restart). On-disk `mixer_state.yaml` showed `mixGroupId`, `soloSafe`,
  and the `mixGroups:` block.
- **Slot hygiene**: lsof'd :31268 first (was free); snapshotted
  `states/test_bench` + `states/summer_camp_dome` to `~/tmp/`, killed engine,
  freed port, restored both state dirs. **No tracked state residue from my run**
  (`states/test_bench` clean; the pre-existing `states/summer_camp_dome/*` +
  `simulation/.../default.yaml` dirt predates this session and was left
  untouched / NOT committed — only the 9 work files are in the commit).

## Exact NEW API surface for the follow-on UI wave

Groups (validate→mutate→saveAllState→broadcastMixerState; 400 malformed / 404 missing):
- `GET /mixer/groups` → `{ mixGroups: [{id,name,fader,muted,color}] }`
- `POST /mixer/groups {name?,color?}` → `201 {status, group}` (id `mg_*`, fader 1, muted false)
- `PATCH /mixer/groups/:gid {name?,fader?,muted?,color?}` → `200 {status, group}` (fader via validateFader; NaN→400; unknown→404)
- `DELETE /mixer/groups/:gid` → `200` (clears members' mixGroupId; unknown→404)
- `POST /mixer/groups/:gid/members {channelId}` → `200`; `400` (no channelId / deck / already in another group); `404` unknown; same-group re-add idempotent
- `DELETE /mixer/groups/:gid/members/:channelId` → `200` (idempotent); `404` unknown

Solo:
- `POST /mixer/solo {channelId, additive?:false}` → `200 {status, soloedChannelIds}`; `404` unknown / `400` deck
- `DELETE /mixer/solo/:channelId` → `200 {soloedChannelIds}`; `404` unknown
- `DELETE /mixer/solo` → `200 {soloedChannelIds:[]}`

Channel PATCH: `PATCH /mixer/channels/:id` accepts `soloSafe: boolean`.

WS (`/ws/control`, low-latency mirror):
- `{type:'setSolo', channelId, additive?}`
- `{type:'clearSolo', channelId?}` (absent channelId = clear all)
- reject pushback: `{type:'soloRejected', channelId, reason}`

Broadcast payload (`type:'mixer'`): each channel gains `mixGroupId` (string|null)
+ `soloSafe` (bool); top-level adds `mixGroups: [...]` + `soloedChannelIds: [...]`.
Client render dim/active should be **display-only**, reconciled from
`soloedChannelIds` on every broadcast (engine is the authority). UI wave should
DELETE the destructive client-side `preSoloStateRef`/`soloRef` save-restore in
`mixer.tsx` and replace `handleSoloToggle` with optimistic WS `setSolo` + REST
mirror.

## Deferrals (documented, out of engine scope)

CaptainPad `mixer.tsx` group rail + `soloSafe` toggle; `api.ts` group/solo
clients; client solo migration. See docs/39 §10.6.

## Codex P0 compliance

Additive + backward-compatible (old state files restore to documented defaults);
allocation-free hot path (per-frame `_groupScaleCache` clear/set, O(1)
`soloActive`, pure-arithmetic `_effFader`); all inputs fail loud (400/404), no
silent fallback; imports already top-of-file; snake_case filenames; temp files
in `~/tmp/`.

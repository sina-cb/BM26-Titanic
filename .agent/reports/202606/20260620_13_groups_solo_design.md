# WAVE 15 Design — Channel Groups (gang-faders) + Server-Authoritative Solo

Implementation-ready spec (from read-only design pass, 2026-06-20). For the
WAVE 15 engine agent. Composes with WAVE 12 (faderMax clamp + per-channel color
+ master-fade animator). Both features = ONE engine writer (they co-edit the
composite gate). Cite-grounded against `feat/optimize_channels`.

## Grounding
- Composite gate is two lines: `pattern_mixer.js:1652-1653`
  (`if(!channel.enabled)continue; if(!isScriptedTarget && channel.fader<=0.001)continue;`),
  contribution applied at `:1671` (fader as blend progress) and `:1692` (degraded).
  Master applied LAST at `:1712-1714` (`applyMaster` `:1441`), after view crossfade `:1699-1710`.
- "group" is overloaded (model fixture groups, transition groups, dimmer color locks)
  → gang-faders use a DISTINCT namespace: field `mixGroupId`, routes `/mixer/groups`, ids `mg_*`.
- TWO serializers to update identically: `serializeChannel()` `api_server.js:1728` AND
  inline `.map()` in `serializeMixerState()` `~:1809`. Build/restore funnels through
  `buildChannelFromSaved()` `:1574` → `PatternChannel` ctor `pattern_channel.js:2`.

## Data model
- `PatternChannel` (persisted): `mixGroupId = null` (single membership; channel→group pointer);
  `soloSafe = false` (rig-config; never gated off by another channel's solo; persisted like faderLocked).
- `PatternMixer` (mixer-level): `mixGroups = []` (MixGroup: `{id mg_*, name, fader=1 [0,1], muted=false, color|null}`);
  `soloedChannelIds = new Set()` (TRANSIENT — not persisted, cleared on restart);
  `_groupScaleCache = new Map()` (per-frame, allocation-free).
- Membership is a channel→group pointer (not group→members array) so removal can't dangle;
  derive members via `mixerChannels.filter(c=>c.mixGroupId===g.id)`.
- Backward-compat: all new fields default falsy/neutral; old state loads unchanged; byte-compatible
  additions to both serializers + `serializeMixerState` gains `mixGroups:[]` + `soloedChannelIds:[]`.

## Precedence formula (per channel, per frame) — THE core decision
```
groupScale = group? (group.muted?0:group.fader) : 1
soloActive = soloedChannelIds.size > 0
soloGate   = !soloActive ? 1 : (c.soloSafe || c.faderLocked || soloedChannelIds.has(c.id)) ? 1 : 0
enabledGate= c.enabled ? 1 : 0
effFader(c)= clamp(c.fader,0,(c.faderMax ?? 1)) * groupScale * soloGate * enabledGate
```
Then existing blend (consume effFader at :1671/:1692) → view crossfade → master(t) LAST.
The skip becomes one check: `if(!isScriptedTarget && eff<=0.001) continue;` (absorbs the
enabled check). Rules (console-norm justified):
- Mute (enabled=false) WINS over solo (don't resurrect an explicitly-killed channel).
- soloSafe survives another channel's solo (protects mission-critical exterior).
- Group-mute beats a member's solo (structural kill); soloSafe does NOT escape a mute.
- Fader-lock IMPLIES solo-safe (locked level keeps its parked contribution) AND lock guards
  only `c.fader` writes — a GROUP fader still scales a locked channel (gang scale ≠ fader write).
- faderMax clamp applied BEFORE groupScale (per-fixture safety ceiling bounds own contribution first).
- Solo isolates but doesn't force full level (group fader still attenuates a soloed member).
- Master fade (WAVE 12) acts last/independently; solo/group never touch `this.master`.

## API (fail-loud: validate→mutate, 400 malformed, 404 missing, then saveAllState+broadcastMixerState)
Groups: `GET /mixer/groups`; `POST /mixer/groups {name?,color?}`→201;
`PATCH /mixer/groups/:gid {name?,fader?,muted?,color?}` (fader via validateFader `:195`);
`DELETE /mixer/groups/:gid` (clears members' mixGroupId); `POST /mixer/groups/:gid/members {channelId}`
(400 if already in another group or is deck via `rejectIfWrongRole` `:3098`); `DELETE .../members/:channelId`.
Solo: `POST /mixer/solo {channelId, additive?:false}` (additive adds, else replaces set);
`DELETE /mixer/solo/:channelId`; `DELETE /mixer/solo` (clear all); `soloSafe` toggle added to existing
`PATCH /mixer/channels/:id` `~:3142`. WS: `{type:'setSolo',channelId,additive?}`,`{type:'clearSolo',channelId?}`
(low-latency, REST mirror) — same dual-path as mute `mixer.tsx:908`.

## Solo server-authority migration
Engine `soloedChannelIds` is sole truth; render gate reads it; sibling enabled/fader NEVER mutated by
solo (parked levels survive). Client: tap→optimistic WS setSolo + REST mirror (Alert on fail); receive→
reconcile from broadcast `soloedChannelIds`; render dim/active is DISPLAY-ONLY. DELETE the destructive
`preSoloStateRef`/`soloRef` save-restore (`mixer.tsx:920-989`). Reconnect/multi-client: solo survives
(engine-side). `triggerMixerTransition` (`:899`) must `soloedChannelIds.clear()` at start.

## Hot-path (40Hz×N, allocation-free)
Precompute group scales ONCE/frame before the loop into reused `_groupScaleCache` (`Map.clear()`+`set()`,
no realloc — mirror `_renderOrderScratch` `:259`). `soloActive`=`size>0` (O(1)). `_effFader` pure arithmetic
(no closures/arrays/literals). No new buffers. DON'T: build per-group member lists in render, `filter()` in
loop, serialize the Set in render.

## Ownership & sequencing
ONE engine writer: `pattern_channel.js`, `pattern_mixer.js`, `api_server.js` (+ tests + docs/39). Read
`channel.faderMax ?? 1` defensively so order vs WAVE 12 doesn't matter; coordinate identical field-insertion
order in both serializers + ctor; never touch master/targetMaster. UI AFTER engine: `mixer.tsx` (replace
handleSoloToggle, add group rail + soloSafe toggle), `api.ts` clients — separate writer.

## Tests (key ones)
Unit on effFader: no-solo/no-group regression; mute-wins; group-mute-beats-solo; group-fader-scales-soloed;
faderMax-before-gang; soloSafe survives; fader-lock implies safe; group scales locked; additive solo.
HIL: **#10 mission-critical — soloSafe exterior stays lit through an interior solo (P0)**; group-mute vs
member-solo dark; reconnect keeps solo; multi-client broadcast; persistence (soloSafe+membership survive,
solo set empty after reload); transition clears solo; validation 400/404.

## Edge cases (explicit requirements)
- `removeMixerChannel` (`:3209`) MUST `soloedChannelIds.delete(id)` + clear membership (else phantom-solo
  darkens everything). DELETE group clears members first. Single-membership only (400 on re-add).
- No deck in a group. Master-fade-to-0 darkens even soloed/safe (grand kill) — correct, different stage.
- Solo affects mixer composite only; deck/PFL untouched (document).

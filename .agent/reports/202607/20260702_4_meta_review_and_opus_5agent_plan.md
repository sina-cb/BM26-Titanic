# MIDI review-of-the-review + 5-agent Opus execution plan

**Date:** 2026-07-02 · **Author:** Fable (meta-review) · **Input:** `20260702_3_midi_review_findings.md`
**Method:** 4 adversarial verifier agents, each instructed to REFUTE, each quoting
file:line evidence from `feat/captainpad-midi-control` tip (`b9039a7c`).

## Part A — verdicts on the 13 findings

| # | Finding | Verdict | Severity | Correction |
|---|---|---|---|---|
| 1 | Knob index ≠ slider order | **CONFIRMED** | **P1** | Review named the wrong live trigger. cpcOwned kind-1 exports are currently *unreachable* (no shipped pattern exports both `rotate` + `sliderRotate`). The **reachable** arm: the engine only serializes `v0` when `localControls[id]` exists (`api_server.js:1314`), so **every untouched slider on an entry without saved defaults is dropped from `focused.exports`** while both screens render it at a fabricated 0.5. Off-by-k is live TODAY on every fresh pattern. Deep fix is **engine-side**: always serialize `v0` for local-control kinds (seed `localControls` from actual VM values at pattern load) + the shared derivation client-side. |
| 2 | Focus reconcile gap | **CONFIRMED** | **P1** | *Worse* than filed: the stale request is **permanent**, not transient — `reconcileRequestedFocus` only clears when the snapshot MATCHES the request, so APC-focus-2 → touch-focus-3 swallows every bound fader forever. The proposed derived-reader fix still leaves a race (touch before the request ever settles). Deep fix: **one source of truth** — route ALL focus intents (incl. touch `setMidiFocus`) through the manager. |
| 3 | Fast-turn undershoot | **CONFIRMED** (×2, independently re-derived by a second verifier) | **P1** | ~80 % of a fast sweep lost at 150 ms echo latency. Fix must cover **both** delta paths (`focusedParamDelta` at manager.ts:510 AND `paramCenterDelta` at :526), and the divergence re-seed must tolerate the engine's **throttled** modulationState broadcast or it re-seeds mid-sweep. |
| 4 | BPM-sync gate asymmetry | **CONFIRMED** | **P1** | Engine `bpm_speed_sync.js:99` really does clobber manual speed on every BPM tick (source-lock is explicitly "future"). docs/34:740 + comments at manager.ts:120/:520 assert an APC rule that **does not exist**. Prefer the shared `syncOwnedKeys` snapshot-fact variant: `paramCenterDelta` never reaches the dispatcher (it throws there), so a dispatcher-only gate can't be the single home. |
| 5 | Pickup uses v0 | CONFIRMED (code) | **P2 ↓** | Trigger is narrow (learned CC + currently-modulated deck param at a focus/entry switch); failure is a bounded one-time jump. One-line fix (`base ?? v0` at manager.ts:616). |
| 6 | Ring shows v0 | CONFIRMED (code) | **P3 ↓** | Pure feedback; the pulse animation already flags "modulated". One-line fix in the `getFocusedExportValue` closure (manager.ts:718). Design tradeoff: ring stops showing live modulation — acceptable, pulse compensates. |
| 7 | Reset/turn coalescer race | **CONFIRMED** | **P2 ↓** | No global drain exists — each slot has its own timer, so ordering is NOT bounded. But the filed "one key namespace" fix is **UNSOUND**: merging namespaces makes `combineDelta`'s mismatched-kind branch eat the reset. Correct fix: `coalescer.cancel(controlId)` called by reset. Interlocks with #3 (press-then-spin clobbers via the stale anchor regardless). |
| 8a | combineDelta silent fallback | CONFIRMED, unreachable today | P2 | Kind collision inexpressible in shipped profiles. Throw anyway — codex consistency, zero risk. |
| 8b | Unknown-CPC-key swallow | **CONFIRMED, reachable** | P2 | Root cause found: `validateProfileParams` (profile.ts:420) **never validates `paramCenterRelative` keys** — an mft.yaml bank-2 typo sails through and dies silently. Fix validation (root) + `setStatus` at the flush guard (symptom). |
| 9 | Stale LED on led.channel change | **REFUTED as stated** | P3 ↓ latent | Per-state channel variance is *inexpressible* in the schema (one `channel` per control). The real latent property: `projectLeds` never emits off for keys that vanish from `prev` → orphaned LEDs if the key set ever changes. Cheap future-proof fix survives. |
| 10 | Snapshot rebuild at CPC rate | CONFIRMED | P3 | Cost correction: NOT a network storm — `fetchPlaylist` has 5 s TTL cache. Real cost is object churn + full LED projection at 10-30 Hz on the iPad. Fix must recompute `bpmSpeedSyncOn` in the in-place patch too. |
| 11 | Sysex storm on hotplug | CONFIRMED (mechanics) | P3 | 128 frames ≈ 3.3 KB per event, and Web MIDI fires **≥2 statechanges per physical plug**, fanned to ALL transports unfiltered. EEPROM wear is *unproven* — the real cost is mid-set ring disruption + full repaint. Fix must ALSO debounce/serialize `onEndpointsChanged` (no reentrancy guard today) or it only halves the storm. |
| 12 | Render/alloc churn (a/b/c) | CONFIRMED (all 3) | P3 | Framing fix on (c): projection fires per engine update (10-30 Hz during sweeps), not "every frame". (b) is real: `setStatus(lastEvent)` at raw MIDI rate (>100/s) before the coalescer. |
| 13 | MFT knowledge in generic core | **CONFIRMED** | **P4** | Confirmed trap: a VSN1 profile setting the generic `configureOnConnect` flag would receive DJTT frames; `decodeBankChange` runs as step-0 for every controller. **Trim the fix**: minimal driver registry keyed by device id — `{ onConnectFrames?, decodeExtras?, feedbackEncoder? }`. The "profile-level LED-feedback spec" is over-engineering; action-kind dispatch already works, only the byte-encoders move behind the seam. Blast radius ≈ 4 source + 4 test files. |

## Part B — NEW findings the 8 angles missed (from the verifiers)

| # | New finding | Sev | Evidence |
|---|---|---|---|
| N1 | **Deck-scoped modulation state applied to mixer-focused exports by bare name.** `modulationState` is deck-only (`modulation_controller.js:129,:174`), but the hook keys `_modState` by param name and applies it to *whatever* channel is focused (useMidiControl.ts:504-506). Mixer channel with a name-colliding export gets the DECK's `base` as its knob anchor + a false "modulated" ring pulse. | **P1** | verifier 2 |
| N2 | `validateProfileParams` skips `paramCenterRelative` — the manager header's "invalid keys → red error" promise is false for every MFT bank-2 knob. Root cause of 8b. | P2 | verifier 3 |
| N3 | **Delta lands on the wrong channel across a focus change.** `focusedParamDelta`/`Reset` resolve `focused.exports[index]` at *flush* time (manager.ts:500-503); a focus change inside the ~33 ms window writes the accumulated delta into the NEW channel's same-index param, no pickup gate. Fix: capture focus identity at accumulate, drop on mismatch at flush. | P2 | verifier 1 |
| N4 | **MixerLocalParams renders ALL export kinds as MiniFaders** (mixer.tsx:113 — no kind filter, deck filters `kind===1`). An hsvPicker (kind 6 — expressible today) rendered as a fader writes hardcoded `v1:0, v2:0` → zeroes saturation/value on drag. | P2 | verifier 1 |
| N5 | `coalescer.dispose()` silently drops pending trailing values — contradicts the module's own "final resting position is never dropped" contract (coalescer.ts:5-7 vs :102-108). | P3 | verifier 2 |
| N6 | Every deployment requests `sysex: true` (both profiles unconditionally bundled + mft.yaml `configureOnConnect: true`), so every operator gets the scarier Chrome permission prompt; the "APC-only rigs skip it" comment (useMidiControl.ts:583) documents behavior that cannot occur. | P3 | verifier 4 |

**Bottom line:** 12 of 13 findings survive (one refuted-as-stated), 3 severity downgrades,
2 proposed fixes corrected as unsound/insufficient, 1 new P1. Post-vet P1 set:
**#1, #2, #3, #4, N1** — these five are the bench-blockers.

## Part C — the 5-agent Opus execution plan

Opus acts as **dev manager / integrator**: spawns the agents, owns all git, runs the
full gate. Dev agents NEVER run git. File ownership is disjoint per wave — the three
cross-agent interfaces are contracted up front (§C.3).

### Wave 1 — five parallel dev agents

**D1 — manager core** *(owns: `utils/midi/manager.ts`, `utils/midi/coalescer.ts`, `utils/midi/dispatch.ts` + their tests)*
- **#3** Optimistic anchor: runtime-local applied value per (channel-identity, key/index) — seed from snapshot, add deltas, re-seed only on meaningful divergence; MUST cover both `focusedParamDelta` and `paramCenterDelta`; divergence check tolerant of throttled modulation echo.
- **#2** Focus single-source-of-truth (manager side): new public `setFocusIntent(layer)` that overwrites/clears `requestedFocusLayer` on ANY focus intent; all three readers (`isFocusLocked`, `getRequestedFocusLayer`, `applyBinding` gate) go through one derived `effectiveFocusLayer(snap)`. *(D2 wires touch → this method.)*
- **#4** Sync gate at shared depth: `syncOwnedKeys` snapshot fact (derived from `bpmSpeedSyncOn`), consulted by BOTH the `paramCenterDelta` flush branch and the absolute `paramCenter` path; delete the `'speed'` literals in manager.ts:522 + the false "mirrors APC fader-7" comments; inert-fader `setStatus` on the APC path.
- **#5** Pickup anchors `exp.base ?? exp.v0` (manager.ts:616). **#6** ring closure returns `base ?? v0` (manager.ts:718).
- **#7** `coalescer.cancel(controlId)` API; reset cancels the same encoder's pending turn slot (do NOT merge key namespaces).
- **N3** Capture focus identity (layer + entry key) at accumulate; flush drops the payload with a status note if focus changed.
- **8a** `combineDelta` mismatched kinds → `throw`. **8b** unknown-CPC-key → `setStatus` (mirror the sync-gate branch).
- **N5** `dispose()` flushes pending trailing values (or the contract comment is corrected — flush preferred).
- **12b** `lastEvent` status updates move to flush cadence.

**D2 — hook + snapshot** *(owns: `hooks/useMidiControl.ts`, NEW `utils/midi/knob_order.ts` + tests)*
- **#1 (client side)** `knob_order.ts`: THE single derivation of the knob-mapped export list (kind===1, not cpcOwned, has numeric v0 — plus stable annotation of *excluded* rows so screens can label them). Hook consumes it for `focused.exports`.
- **N1** Scope `_modState` to the deck: apply modulation `base`/`modulated` ONLY when the focused channel IS the deck (match on the broadcast's `deckId`), never by bare name to mixer channels.
- **#2 (touch side)** `setMidiFocus` routes through the manager's `setFocusIntent` (contract I2).
- **#10** Drop `engine.sharedParams` from the effect deps; mirror shared values via the existing params bus into an in-place `_snapshot` patch + `_nudge()` — recomputing `bpmSpeedSyncOn` in the patch.
- **N6** Fix the false comment; sysex request stays as-is (decision D-3 below if Sina wants conditional loading).
- Export `useIsMidiFocused(i)` boolean selector (contract I3).

**D3 — screens** *(owns: `app/(tabs)/mixer.tsx`, `components/GlobalParams.tsx` + tests)*
- **#1 (screen side)** Both screens consume `knob_order.ts`: learnable/knob-mapped rows get their knob number badge (1-16); excluded rows (MATCHED / no-v0) render visually distinct so screen order ≡ knob order is *visible*, not coincidental.
- **N4** MixerLocalParams filters to kind===1 for MiniFaders (other kinds: render nothing for now — no fabricated fader writes; fail-visible with a small "unsupported kind" chip).
- **12a** Strips use `useIsMidiFocused(i)` instead of `useMidiFocus()` so `React.memo` works again.

**D4 — projector + profile** *(owns: `utils/midi/led_projector.ts`, `utils/midi/profile.ts`, `midi_profiles/*.yaml` + tests)*
- **N2** `validateProfileParams` validates `paramCenterRelative` keys (same list as `paramCenter`) — makes the manager-header promise true.
- **#9** `projectLeds` emits off for keys present in `prev` but absent from `next` (orphan-proofing for VSN1).
- **12c** Diff before construct: compare computed velocity against prev, numeric composite keys, no allocation on the no-change path.
- **#4 (projector side)** `'speed'` literal at led_projector.ts:285 replaced by the shared `syncOwnedKeys` fact (contract I4 — read-only consumption of D1's snapshot fact).

**D5 — engine** *(owns: `marsin_engine/lib/api_server.js`, `pattern_channel.js` (v0 seeding), `lib/playlist*` + engine tests)*
- **#1 (deep fix)** Always serialize `v0` for local-control-kind exports: seed `localControls` from actual VM values at pattern load / entry activation so untouched sliders broadcast their REAL value instead of being dropped (kills the client-side fabrication problem at the root). ⚠ Decision D-1 below — behavior change, Sina must ack.
- **P5** Factor `upsertMidiMapping(entry, incoming)` onto PlaylistManager; route + test both call it (deletes the "kept in lockstep" copy-paste).
- Extend engine midi tests to cover both.

### Wave 2 — after Wave-1 integration lands (single agent, sequential)

**D6 — driver seam + hotplug hygiene** *(owns: manager.ts, led_projector.ts, profile.ts, index.ts, mft/* — post-integration, no parallel writers)*
- **#13 (trimmed)** Minimal driver registry keyed by device id: `{ onConnectFrames?(): frames, decodeExtras?(msg): event|null, feedbackEncoder? }`. Move `buildConnectConfig` behind `onConnectFrames` (kills the generic-flag trap), `decodeBankChange` behind `decodeExtras` (stops running MFT decode on every controller), ring byte-encoders + `focusedIdentityColor` behind `feedbackEncoder`. Leave a `grid_vsn1` stub entry (NOT loaded) matching the Phase-6 skeleton.
- **#11** Config push only on a real disconnected→connected transition per device; debounce + serialize `onEndpointsChanged` (≥2 statechange events per physical plug, no reentrancy guard today); hoist the deterministic frames to a module const.
- **P5 batch** (now conflict-free): shared unit-clamp, dead MFT decoder exports removed, `FocusedChannel.entryId`, stale TODO, `indexByTargetParameter` helper, `_modState`/`useModulationState` single store.

### C.3 — interface contracts (agreed BEFORE Wave 1 spawns)

| ID | Contract | Producer → Consumer |
|---|---|---|
| I1 | `knob_order.ts`: `deriveKnobOrder(exports) → { knobMapped: Export[], rows: { export, knobIndex: number\|null, excludedReason?: 'matched'\|'no-v0' }[] }` | D2 → D2 (hook), D3 (screens) |
| I2 | `manager.setFocusIntent(layer: number): void` — overwrites/clears the focus request for ANY intent source | D1 → D2 |
| I3 | `useIsMidiFocused(layerIndex: number): boolean` | D2 → D3 |
| I4 | Snapshot fact `syncOwnedKeys: ReadonlySet<string>` on `MidiEngineSnapshot` | D1 (writes) → D4 (reads); D2 populates from engine state |

Opus writes these four signatures into each agent's brief verbatim. Any agent needing
to change a contract STOPS and reports — Opus renegotiates, never the agents.

### C.4 — verification stages (every stage gates the next)

**V-a (inside each dev agent, mandatory):** write the failing test FIRST (red) reproducing
the finding's exact trigger from Part A/B, then fix (green). Run scoped: `npx tsc --noEmit`
+ `npx vitest run <owned test files>` (D5: `node --test tests/`). Report: diff summary,
tests added, red→green proof.

**V-b (per work package, independent):** after each dev agent finishes, Opus spawns a
*fresh* verifier agent (not the author) with the diff + the Part A/B entries it claims to
fix. Verifier confirms: mechanism actually closed (not symptom-patched), the corrected fix
directions from Part A were followed (e.g. #7 used cancel not namespace-merge; #3 covers
both delta paths), nothing on the review's "Verified SAFE" list regressed, no contract (I1-I4)
drifted. Verdict PASS/FAIL with quoted lines; FAIL goes back to the same dev agent once,
then escalates to Opus.

**V-c (integration gate, Opus itself):** merge all Wave-1 work → full gate: `tsc --noEmit` 0
· full `vitest run` · engine `node --test` · `expo lint` 0 errors · `npm run web:build`.
Plus one cross-file pass over the four contracts. Commit (authorized for this branch),
push after merge-base check vs origin (history-rewrite rule). THEN spawn D6; repeat V-a/V-b/V-c
for Wave 2.

**V-d (adversarial sweep, optional but recommended):** one final reviewer agent over the
full Wave1+2 diff, briefed with Part A/B as "known fixed" — hunting only for NEW regressions.

### C.5 — final stage: Sina's manual bench test (Ring 1: APC + MFT → Chrome → engine → sim)

Nothing above touches hardware. When both waves are green and pushed:

1. **Knob order (#1):** load a fresh pattern, touch NOTHING → every on-screen slider must show a knob badge that matches the physical knob that moves it (incl. sliders never touched). Turn knobs 1-4 in order; confirm rows 1-4 move.
2. **Focus truth (#2):** APC track 2 → screen FOCUS ch3 → move a learned fader (must apply to ch3 immediately, no "settling" swallow); APC focus LED shows ch3; MFT side-button "next" goes to ch4 (no off-by-one).
3. **Fast sweep (#3):** rip an MFT knob 0→max in <1 s → param lands at/near max (not ~20 %). Same for bank-2 speed knob with sync OFF.
4. **Sync gate (#4):** BPM→Speed sync ON → APC fader 7 AND MFT speed knob both inert, both LEDs strobe, status names sync; sync OFF → both live again.
5. **Reset gesture (#7):** spin an encoder then immediately press → value sits at the saved default (no post-reset jump).
6. **Modulated pickup (#5/#6):** audio-modulate a param → learned fader picks up against the base (no jump on unlock); MFT ring shows the base with pulse animation.
7. **Mixer scoping (N1/N4):** focus a mixer channel whose pattern shares a param name with a deck-modulated one → ring shows the MIXER value, no false pulse; a non-slider export shows no fake fader.
8. **Hotplug (#11):** while MFT rings are lit mid-"set", unplug/replug the APC → MFT rings do NOT flicker/reconfigure; replug the MFT itself → config pushes once, rings restore.
9. **Feel check (open Qs):** detent step sizes ±0.005/0.02/0.06 and encoder-push-as-reset — bench judgement, report back for tuning.

### C.6 — decisions for Sina (before/while Opus runs)

- **D-1 (blocks D5):** engine-side v0 seeding — untouched sliders start broadcasting their real VM values (a behavior change visible to all clients). Fable recommends YES: it's the root fix for #1 and removes a whole class of fabricated-value hacks. Say no, and D5 falls back to client-side-only ordering (shallower).
- **D-2:** ring shows `base` while modulated (loses live-wobble display; pulse still signals modulation). Recommend YES (already in D1's list; veto if you want the wobble).
- **D-3:** every deployment currently triggers Chrome's sysex permission prompt (N6). Live with it (recommended — playa simplicity) or ask for conditional MFT-profile loading.
- **D-4 (carried over):** branch rename `feat/captainpad-midi-control` → snake_case via GitHub rename, or grant an exception.

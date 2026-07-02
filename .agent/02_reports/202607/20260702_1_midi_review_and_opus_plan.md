# MIDI-learn review findings + implementation plan (for Claude Opus)

**Date:** 2026-07-02 · **Branch:** `feat/captainpad-midi-control` (b6103059 + uncommitted MIDI-learn work)
**Worktree:** `.claude/worktrees/midi-learn-build` · **Author:** review agent (8-angle finder sweep + verify pass)

This is a self-contained work order. It assumes a FRESH session with no prior
context. Read `CLAUDE.md` and `.agent/00_gol/00_codex.md` first (P0: no
fallbacks, fail loudly; no git ops until Sina asks; imports at top; offline).

---

## 0. Environment setup (do this first)

1. Work ONLY in the worktree `C:\Users\sina_\workspace\BM26-Titanic\.claude\worktrees\midi-learn-build`
   (branch `feat/captainpad-midi-control` with the uncommitted MIDI-learn diff).
   Do NOT touch the main checkout; do NOT switch its branch.
2. `node_modules` in the worktree are junctions to the main checkout's
   (`CaptainPad/node_modules`, `marsin_engine/node_modules`). If missing:
   `New-Item -ItemType Junction -Path <worktree>\CaptainPad\node_modules -Target <main>\CaptainPad\node_modules`.
3. Verification commands (all must stay green after every phase):
   - `cd CaptainPad && npx tsc --noEmit`
   - `cd CaptainPad && npx vitest run` (currently 98 passing)
   - `cd CaptainPad && npx expo lint` (0 errors; 12 pre-existing warnings OK)
   - `cd CaptainPad && npm run web:build`
   - `cd marsin_engine && node --test tests/midi_mapping.test.js` (6 passing)

**Key files:** `CaptainPad/utils/midi/{manager,resolver,dispatch,learn,profile,led_projector}.ts`,
`CaptainPad/hooks/useMidiControl.ts`, `CaptainPad/components/{MidiMap,Modulation,GlobalParams}.tsx`,
`CaptainPad/utils/api.ts`, `CaptainPad/midi_profiles/apc_mini_mk2.yaml`,
`marsin_engine/lib/{midi_mapping_engine,playlist_manager,api_server}.js`, `docs/34_captainpad_midi.md`.

---

## 1. Phase 1 — Correctness fixes (8 CONFIRMED review findings, ranked)

Fix in this order. Add a unit test for EVERY fix (they're all in the
framework-free `utils/midi` layer or the hook's pure helpers — the existing
`manager.test.ts` FakeTransport harness covers most).

### 1.1 Learn can capture + shadow profile-mapped controls (`manager.ts:312`)
`applyBinding()` runs before `resolveEvent()`, and learn capture
(`controlRefFromEvent`) accepts ANY cc/noteOn — so an operator can learn CC 54
(global speed), CC 56 (master), or a mapped pad, permanently shadowing it.
`applyBinding` also returns `true` ("consume") when the bound param is absent
from the focused pattern.

**Fix (capture-time rejection — keeps runtime simple):**
- In `ControllerRuntime.onMessage`, when learn is armed, BEFORE capturing run
  `resolveEvent(this.profile, decoded, this.context)`; if it resolves to a
  static profile action, do NOT capture — instead report the conflict (extend
  the learn callback signature to deliver `{ ref } | { conflict: controlId }`,
  or add an `onLearnConflict` status). The popover shows a red inline error:
  `"CC 54 is GLOBAL SPEED on this profile — use fader 4, 5, 6, or 8"`.
- Belt-and-braces: in `MidiMapPopover.save()`, re-check the captured control
  against the loaded profile (export a `profileClaims(profile, ref, context)`
  helper from `utils/midi`) and refuse to save a conflicting binding.
- Keep the swallow-on-absent behaviour ONLY once conflicts are impossible
  (then it only affects genuinely-unmapped faders); update the status text.
- Tests: learn-arm + emit CC54 → no capture + conflict surfaced; save-time
  rejection; CC51 still captures.

### 1.2 Focus/snapshot race — writes target the old channel (`useMidiControl.ts:357`)
Focus flows track-button → callback → module global → React effect → awaited
`fetchPlaylist` → `_snapshot.focused`, while `applyBinding` reads the snapshot
synchronously. Window: fader moves after a focus press / entry switch hit the
OLD channel or stale export ids.

**Fix (make the runtime authoritative + gate on staleness):**
- The runtime already owns controller-local state (`windowCursor`). Add
  `requestedFocusLayer` there: set it synchronously in the `focusChannel`
  handler (after the existence check from 1.4), repaint LEDs from it
  immediately (projector reads it via a new
  `MidiProjectionState.getRequestedFocusLayer()` — falls back to
  `snapshot.focused.layer` when unset).
- In `applyBinding`, on the mixer context, if
  `snapshot.focused?.layer !== requestedFocusLayer` → treat all bindings as
  locked (swallow, no write) until the snapshot catches up. On deck this never
  triggers. Also gate on entry staleness via the identity key from 1.3.
- Tests: focus press then immediate CC on the fake transport → no dispatch
  until the snapshot is swapped to the new focused layer; then writes flow.

### 1.3 Pickup never re-locks across entry switches (`manager.ts:343`)
`focusKey` = `role:id:mappingIds`, and popover-derived ids (`midi_<param>`) are
identical across entries — so unlocked pickup state carries into the next
entry and the first tick jumps its param.

**Fix:** build the identity key ONCE in the hook when constructing `focused`:
`focused.key = `${role}:${id}:${activeEntryId}:${mappingIds.join(',')}``
(add `key: string` and `entryId` to `FocusedChannel`). The runtime compares
`focused.key !== this.lastFocusKey` — one string compare per event, no per-tick
allocation (also resolves the efficiency finding on the same line).
- Tests: same channel, entry A → unlock → swap snapshot to entry B with the
  same mapping id → next CC is locked again.

### 1.4 No existence check / clamp on focus (`useMidiControl.ts:346`)
Focusing an absent layer (track 3 with 2 overlays; or deleting the focused
overlay) yields `focused=null`: dead faders, dark LEDs, no recovery.

**Fix:**
- Runtime `focusChannel` handler: `if (!layerInfo(snap, layer)) return;` —
  inert like the old solo buttons. (This ALSO fixes finding 1.6: on the deck
  context `layerInfo` returns null for layers > 0, so deck-tab presses of
  track 2/3 become no-ops.)
- Hook: when rebuilding the snapshot, if `channels[_focusedLayer]` is missing,
  reset `_focusedLayer` to 0 (log a console.warn naming the reset — style
  guide: never silently swallow) and rebuild.
- Tests: focus press on absent layer → onFocusChange NOT called; channel-list
  shrink → focus falls back to 0.

### 1.5 Learned pads are dead-on-arrival under pickup (`manager.ts:361`)
Discrete note presses can never "cross" the current value → permanently locked.

**Fix:** `controlRefFromEvent` already returns `continuous`. In
`applyBinding`, bypass pickup for `continuous: false` captures — a pad press
is an intentional jump; write immediately. Keep pickup for CC.
- Tests: learned note binding writes on first press; CC binding still locks.

### 1.6 Deck-tab track buttons silently mutate mixer focus (`useMidiControl.ts:439`)
Fixed by 1.4's existence check (deck context → layers 1-2 don't exist → inert).
Add the regression test explicitly: deck context + track-button 3 press →
`_focusedLayer` unchanged.

### 1.7 `armMidiLearn` silently resolves null when MIDI is unavailable (`useMidiControl.ts:159`)
P0 fail-loudly violation; LEARN button appears dead on platforms without MIDI.

**Fix (also the simplification finding):** replace the promise+timer machinery
with the callback shape LearnController already provides:
```ts
export function armMidiLearn(cb: (r: {ref: MidiControlRef} | {error: string}) => void): () => void {
  if (!_armLearn) { cb({ error: 'MIDI unavailable on this platform (or not started)' }); return () => {}; }
  return _armLearn((ref) => cb({ ref }));
}
```
- Drop the 30-second timeout entirely — the popover owns cancellation (CANCEL
  chip, unmount, re-arm). This removes the stale-timer landmine (a leftover
  timer cancelling a LATER arm) flagged by the efficiency angle.
- `MidiMapPopover.startLearn` surfaces `{error}` as the inline red error text.
- Scope cancellation: `LearnController.cancel` is fine, but the closure
  returned from `armLearn` must only cancel ITS OWN callback — add an
  `arm()`-token check in LearnController (`cancel(token)`).
- Tests: unavailable → error surfaced; second arm not killed by first arm's
  cancel; capture still one-shot.

### 1.8 Lock-flash LED promised but not implemented (`manager.ts:366`)
The lock-transition `projectAndSend()` emits identical bytes (projector has no
lock input); learn.ts's comment promises the flash.

**Fix:** add `isFocusLocked(): boolean` to `MidiProjectionState`, fed from the
runtime: true when ANY pickupState for the current focused key is locked. In
`led_projector.ts` `focusChannel` case: focused + locked → **blink** velocity
(APC single-colour buttons: velocity 2 = blink, per
`apc_mini_mk2_reference.md`; the profile's `led` gains an optional `flash: 2`),
focused + unlocked → solid `on`, else `off`. Remove the stale comment if you
change behaviour. Tests: projector emits blink velocity when locked.

---

## 2. Phase 2 — Cleanup (verified findings from reuse/simplification/efficiency/altitude angles)

1. **Shared popover primitives:** extract `SectionLabel`, `Chip` (accent-colour
   prop), `NumberInput` from `Modulation.tsx`/`MidiMap.tsx` into
   `components/ui/PopoverKit.tsx` (or individual files matching `components/ui/`
   convention); both popovers import them. They are byte-identical copies today
   and the two surfaces are explicitly meant to read as a pair.
2. **One range-limit + clamp:** `utils/api.ts` already exports
   `MIDI_RANGE_LIMIT`; add `clampToRangeLimit()` beside it; `Modulation.tsx`
   (private `RANGE_LIMIT`/`clampRange`) and `MidiMap.tsx` both consume. Three
   parallel copies of the engine's [-4,4] window is drift waiting to happen.
3. **One MIDI scaler:** `resolver.ts`'s private `scale()`+`MIDI_MAX` duplicate
   `learn.ts scaleMidiToRange` (which also clamps). Keep the clamped one,
   import it in resolver, delete the private copy.
4. **One entry-bindings hook:** `useEntryMidiMappings` is a line-for-line clone
   of `useEntryModulations`. Write `useEntryBindings<T>(playlistName, entryId,
   pluck, transform?)` in `Modulation.tsx` or a new shared module; both become
   thin wrappers (modulations pass the mode-migration transform). Preserve the
   cached-fetchPlaylist rationale comment in the shared code.
5. **Remove the dead mixerLayerSolo pipeline** (profile kind, resolver case,
   dispatch case, LED case + `getLayerSolo`, and its tests). Verified fact: the
   engine's PATCH `/mixer/channels/:id` field whitelist (api_server.js
   ~2624-2698) IGNORES `solo` — the old controller solo was ALWAYS a silent
   no-op; solo is purely client-side in mixer.tsx. Either delete the kind
   end-to-end or (if Sina wants controller solo back later) it must be
   reimplemented against the client-side mechanism — note that in docs/34.
6. **ResolvedAction union hygiene:** `localParam` (runtime-built, never
   resolver-produced) and `focusChannel`/`playlistScroll`/`playlistWindowSelect`
   (resolver-produced, runtime-handled) muddy the pure-resolver seam. Minimum:
   make `createDispatcher`'s runtime-only cases `throw` (fail loud) instead of
   silently returning, and document the two producers in the union's doc
   comment. Better: split a `RuntimeAction` type.
7. **Snapshot rebuild efficiency:** (a) the `rev` bump listens to
   `playlistSaved` for ANY playlist — filter to names present in
   layers/deck/focused; (b) the focused-channel build calls `fetchPlaylist`
   for a playlist `playlistFor()` already fetched in the same effect run —
   reuse that result.
8. **`React.memo` comparator:** replace the six hand-written `midiMapping`
   field compares in `Modulation.tsx` with a reference compare
   (`(prev.midiMapping ?? null) === (next.midiMapping ?? null)`) — the objects
   are referentially stable between refetches.
9. **Dead API:** delete `MidiManager.cancelLearn()`; keep `isLearning()` only
   if a test still needs it after 1.7.
10. **Fail-loud logging on drops:** `console.warn` when a malformed stored
    mapping is filtered in the focused build, when `_bumpFocus` catches a
    listener error, and EXCLUDE (with a warn) exports lacking `v0` instead of
    fabricating `v0 ?? 0.5` (a fabricated 0.5 corrupts pickup math).

---

## 3. Phase 3 — Product gaps (approved direction, not yet built)

1. **Mixer-tab binding visibility + focus UI:** overlay params learned via a
   shared playlist silently respond to faders with no on-screen indication.
   Add the ⊞ badge (read-only at minimum, ideally the full popover) to the
   mixer channel-strip local params, and an on-screen FOCUS control per strip
   wired to `setMidiFocus`/`useMidiFocus` so touch and the APC track buttons
   agree. (Finding: `GlobalParams.tsx` mixer variant + `mixer.tsx` never pass
   `midiMapping` and never call `setMidiFocus`.)
2. **Engine upsert-by-target (discuss with Sina before doing):** one-per-target
   is enforced by three different mechanisms (strict save throw, lenient load
   drop, client-derived id). A cleaner home: the PUT route replaces any
   existing mapping with the same `target.parameter`, making the rule
   structural. Backwards-compatible; needs an engine test.
3. **Bench HITL pass (needs the physical APC):** deck learn happy path →
   persistence across reload; soft-takeover feel + lock-flash LED; mixer focus
   via track buttons; conflict rejection message; multi-client sync
   (second browser sees the binding via playlistSaved).

---

## 4. Phase 4 — docs/34_captainpad_midi.md proofread corrections (apply all)

The doc is well-written but 6 sections are now stale against as-built:

| # | Location | Problem | Correction |
|---|---|---|---|
| P1 | §Non-Goals: "No on-iPad mapping editor / MIDI-learn UI… learn mode is a v2 candidate" | MIDI-learn is now implemented | Move to Goals/as-built; describe the ⊞ learn flow |
| P2 | §Non-Goals "No engine-side changes: no new endpoints" + "zero engine changes" (repeated in §Tab-aware and As-built) | Engine now stores per-entry `midiMappings` + 3 CRUD routes (commit b6103059) | Reword: "zero engine surface in the CONTROL path (the render loop never reads bindings); persistence-only endpoints mirror the modulation CRUD" |
| P3 | §Mapping-layer action table: `blackoutToggle → setGlobalBlackout / POST /global-blackout` | As-built dispatches `setGlobalEffectBlackout` (unified GEM e-stop), dispatch.ts:79 | Fix row; add rows for `focusChannel` (runtime/UI state, no engine call) and `localParam` (learned static write → `/deck/channel/control` / `/mixer/channels/:id/control`) |
| P4 | §Tab-aware operator mapping: "Mixer: faders 1-4 → layer faders; track buttons 1-4 → layer **solo**; fader 5 → speed… Deck: faders → speed/size/rotate; pad row → pattern select" | Entire subsection describes the pre-unification layout | Rewrite: ONE unified layout (YAML anchor) — faders 1-3 channels, 4-6 + 8 MIDI-learn local params (focused channel), 7 global speed, 9 master; track 1-3 FOCUS (solo removed — and note the old solo PATCH was engine-ignored anyway); pad cols 1-4 playlist browsers, 5-8 colour pairs; scene 8→1 = blackout + GE slots 1-7; deck = same layout, single auto-focused channel |
| P5 | As-built deviation bullet: "Blackout is mapped to Track Button 8 (note 107)" | Current profile: Scene Launch 8, note 119 (`apc_mini_mk2.yaml:144`) | Correct note/button name |
| P6 | As-built verification: "2 pre-existing Modulation.tsx errors remain" | tsc is clean now | Delete the caveat |
| P7 | §Implementation plan Phase 5 "(later): MIDI-learn editor" | Done | Mark done; remaining later-items: APC40 profile, WS param channel, native module (phase 3) |
| P8 | §Open questions | Q1 (default mapping) and the solo question are settled by the 2026-06 bench redesign | Mark answered inline; leave Q3/Q5 (iPad provisioning, EAS minutes) open |
| P9 | New section needed | MIDI-learn architecture is undocumented | Add: per-entry `midiMappings` schema (mirrors modulations; engine = metadata store only), learn flow (arm → capture → PUT), focus model (deck auto / mixer track-button), soft-takeover pickup, binding-conflict rule (after fix 1.1), multiclient sync via `playlistSaved` |
| P10 | §MFT driver bullet | Contains a local Windows path (`C:\Users\sina_\workspace\…`) — repo is public | Replace with the GitHub URL only |

Prose/grammar is otherwise clean — no typos found worth flagging.

---

## 5. Acceptance gates (run after each phase, all must pass)

1. `npx tsc --noEmit` clean; `npx vitest run` green with NEW tests covering
   every 1.x fix; `npx expo lint` 0 errors; `npm run web:build` exports;
   engine `node --test tests/midi_mapping.test.js` green.
2. No new engine render-path changes; persistence routes untouched unless 3.2
   is approved.
3. Update `.agent/02_reports/` with a dated handoff naming what shipped and
   what remains (bench HITL items).
4. **No git operations until Sina explicitly asks.** When asked: commit in
   logical chunks (fixes / cleanup / docs) on `feat/captainpad-midi-control`
   and push.

## 6. Review evidence trail

- 8 finder angles (line-by-line, removed-behavior, cross-file, reuse,
  simplification, efficiency, altitude, conventions) → ~37 candidates →
  dedup → verify.
- 8 CONFIRMED findings (reported via the review UI; mirrored as Phase 1 here).
- 2 REFUTED after deep verification: (a) malformed-mapping TypeError in the
  memo comparator — every server path to the client passes
  `validateMidiMapping`-backed coercion (playlist_manager.js:147/274-297,
  api_server.js:3247-3252/3475/3501); (b) stranded engine solo flag — the
  engine has no solo field at all (pattern_channel.js:21-23; PATCH whitelist
  api_server.js:2624-2698 silently drops `solo`), which is itself the Phase 2.5
  dead-pipeline evidence.

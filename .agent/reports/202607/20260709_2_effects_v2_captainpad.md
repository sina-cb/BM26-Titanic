# 20260709_2 — Effects v2: CaptainPad (Track C)

**Branch:** `feat/party_integration_20260711` (in place, no git ops)
**Zone:** `CaptainPad/` only (NOT `marsin_engine/`)
**Baseline in:** 412/412 tests, typecheck 0 errors. **Out:** 428/428, typecheck 0 errors.

## Scope delivered

Track C of `.agent/projects/effects_v2_midi_layout.md`: the CaptainPad side of the
8→32 (4 pages × 8) global-effects scale-up, the two-control-per-effect model
(value + discrete mode), VSN1 side-button page select + encoder-press mode cycle,
and the state-sync + connection tests. Engine side is a parallel track — I coded
to the pinned contract, mocking the engine in tests.

### Contract pins honored
- 32 flat slots ids 1..32; page p views `8p+1..8p+8`.
- `effectsPage` (0..3) lives in **engine state** — `GET/PATCH /global-effects/page`
  + WS `effectsPage` broadcast. The UI + the VSN1 both FOLLOW the broadcast and
  write changes THROUGH the engine; no surface keeps a private page.
- Mode via `POST /global-effect-slots/:id/mode/cycle` (+ `{value}` set form).
- VSN1 side buttons sb0–sb3 (notes 41–44) → page 0–3 through the engine.
- Encoder press (note 40) changed from intensity-reset → **mode cycle** of the
  selected slot.

## Files changed

| File | Change |
|---|---|
| `utils/api.ts` | `fetchEffectsPage`/`setEffectsPage`, `cycleGlobalEffectSlotMode`/`setGlobalEffectSlotMode`; `GlobalEffectSlotStatus` gains `mode`/`modeLabel`/`modeValues` |
| `utils/midi/profile.ts` | action kinds `effectsPageSelect` (page 0–3) + `effectModeCycle`; validators |
| `utils/midi/resolver.ts` | resolves the two kinds; adds runtime-built `effectModeCycleSlot` |
| `utils/midi/dispatch.ts` | `MidiDispatchApi.setEffectsPage`/`cycleGlobalEffectSlotMode`; dispatches `effectsPageSelect` + `effectModeCycleSlot`; raw `effectModeCycle` joins the runtime-only throw guard |
| `utils/midi/manager.ts` | snapshot gains `effectsPage` + per-slot `mode`/`modeLabel`/`modeValues`; `handleModeCycle` (encoder press → selected slot); **VSN1 MIDI feedback emission** in `projectAndSend` |
| `utils/midi/vsn1_feedback.ts` | NEW — pure, diffed VSN1 slot-state/page feedback projector |
| `midi_profiles/vsn1.yaml` | notes 41–44 → page 0–3; note 40 press → `effectModeCycle` (was reset); intensity-reset relocation documented |
| `hooks/useMidiControl.ts` | threads `effectsPage` (fetch + `effectsPage` WS + connect catch-up) + mode fields into the snapshot; wires the two new api fns into the manager |
| `components/GlobalEffectMacros.tsx` | 4-page `PageSwitcher` (follows engine, writes through it); 8 cells remap to the active page's ids; per-slot value+mode badge → `SlotDetailSheet` (intensity steps + RESET, mode CYCLE + explicit picker) |
| `utils/midi/*.test.ts` (4 makeApi) | added `setEffectsPage`/`cycleGlobalEffectSlotMode` mocks |
| `utils/midi/vsn1_intensity.test.ts` | updated 3 tests to the new note-40 = mode-cycle + side-button = page contract |
| `utils/midi/effects_v2.test.ts` | NEW — 17 tests (profile/resolver/dispatch/manager runtime/feedback/connection) |

## Decision: where intensity-reset went

The VSN1 sends no long-press, and the encoder press is now the slot's MODE
control. So **intensity reset moved to the CaptainPad UI** — the `SlotDetailSheet`
has a `RESET INTENSITY` button (→ `resetGlobalEffectSlotIntensity`, the same engine
route the old jog press hit). Documented in `vsn1.yaml`'s header + the sheet.

## MIDI feedback emitted (exact messages)

CaptainPad's job ends at "sends the right MIDI feedback"; the device-side Lua
(`eventrx_cb`) that renders it is Track T. The feedback is emitted from
`ControllerRuntime.projectAndSend` → `sendVsn1Feedback` **only for the vsn1
profile**, diffed against the last frame (only changed state re-sends), and
re-sent in full on every (re)connect. Encoding (channels chosen to never collide
with the inbound control channel 0):

For the ACTIVE PAGE `p` (0..3), for each of the 8 on-page slots `i` (0..7),
flat slot id `8p+i+1`:

- **Slot active** → `Note On` ch 1, note `32+i`, velocity `active ? 127 : 0`
  → `[0x91, 32+i, 127|0]`
- **Slot value (intensity 0..1)** → `CC` ch 1, cc `32+i`, value `round(intensity*127)`
  → `[0xB1, 32+i, 0..127]`
- **Slot mode** → `CC` ch 2, cc `32+i`, value = index of `mode` within `modeValues`
  → `[0xB2, 32+i, 0..N]`

Page reporting:

- **Current page index** → `CC` ch 1, cc `40`, value `page` → `[0xB1, 40, 0..3]`
- **Side-button page LEDs** → `Note On` ch 1, notes `41..44`, velocity
  `(note-41 === page) ? 127 : 0` → `[0x91, 41+p, 127|0]`

An unthreaded slot (no intensity/mode from the engine) reports `0`/index `0` — a
defined rest state, never a fabricated live value.

## State-sync connections proven by tests (`effects_v2.test.ts`)

- **UI/side-button → engine**: a side button dispatches `setEffectsPage(page)`;
  the encoder press dispatches `cycleGlobalEffectSlotMode(selectedSlot)`; the
  dispatcher maps each kind to exactly its api fn (and threads a failed result
  back — fail-loud).
- **engine broadcast → MIDI feedback**: on connect and on `onEngineUpdate`, the
  manager emits the active/value/mode + page frames above; a single intensity
  change emits exactly the one changed CC (diffed).
- **page change from any source converges everywhere**: a snapshot `effectsPage`
  bump re-emits the page CC + side-button LEDs + the newly-viewed slot window on
  the keys — the same convergence the UI `PageSwitcher` follows via the
  `effectsPage` WS broadcast.

The UI↔engine loop (fetch/PATCH + `effectsPage`/`globalEffectMacroStatus` WS
consumption) is wired in `useMidiControl.ts` (manager snapshot) and
`GlobalEffectMacros.tsx` (panel); those React data paths mirror the field-proven
slot-status path and are exercised end-to-end in the full-stack smoke, not in
vitest (which has no React-render harness here).

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **428 passed / 428** (24 files). Was 412; +17 new
  (`effects_v2.test.ts`), −1 (consolidated two VSN1 jog-reset tests into the
  mode-cycle contract), + updated mocks.
- `npx eslint` on all touched files → **0 errors** (4 warnings, all pre-existing
  patterns: two React-hooks deps warnings on untouched effects, the `js-yaml`
  named-import warning matching the sibling `vsn1_intensity.test.ts`, and an
  untouched `no-console` directive at manager.ts:1154).

## Open follow-ups (for the board)

- The engine must ship `GET/PATCH /global-effects/page` + the `effectsPage` WS
  broadcast, the `primaryMode` registry + `mode/cycle`+`mode` routes, and thread
  `mode`/`modeLabel`/`modeValues`/`intensity` onto `/global-effect-slots/status`.
  Until then the mode UI/cycle + feedback stay inert-but-safe (never fabricate).
- Device (Track T): author the VSN1 `eventrx_cb` Lua to render the feedback
  channels above (keys/ring/LCD + page index + side-button LEDs).
- The `SlotDetailSheet` intensity editor uses 5 quick steps (0/25/50/75/100%)
  rather than a drag fader (reliable on RN-web + native); a continuous fader is a
  possible polish item if Sina wants finer on-screen control (the VSN1 jog already
  gives continuous 0..1).

---

## Addendum 2026-07-09 (b) — effects-page 400 fix + VSN1 WELCOME

Two CaptainPad-side changes on `feat/party_integration_20260711` (in place, no git
ops). Engine untouched — its contract was already correct + canonical.

### 1. Root cause of the live 400 (a body/response KEY mismatch, CaptainPad side)

Changing the effects page 400'd: `{"error":"effectsPage must be an integer in
[0..3] (got undefined)"}`. The engine's canonical key (report `20260709_1`, and
`api_server.js` — `data.effectsPage`, GET returns `{effectsPage}`, WS broadcasts
`{type:'effectsPage', effectsPage}`) is **`effectsPage`**. CaptainPad had wired the
whole page path to **`page`** — so it never worked in EITHER direction:

| Path | Was (CaptainPad) | Now (canonical) |
|---|---|---|
| PATCH body (`api.ts` `setEffectsPage`) | `{ page }` → **400** | `{ effectsPage: page }` |
| GET read (`api.ts` return type; `useMidiControl` + `GlobalEffectMacros`) | `r.data.page` (always `undefined`) | `r.data.effectsPage` |
| WS read (`useMidiControl` + `GlobalEffectMacros`) | `m.page` (always `undefined`) | `m.effectsPage` |

Fixed CaptainPad to the engine's key in all three spots (`utils/api.ts`,
`hooks/useMidiControl.ts`, `components/GlobalEffectMacros.tsx`). No dual-key
fallback. The `effectsPageSelect` MIDI action's `page` field and the panel's local
`page` React state are internal names — untouched (they don't cross the wire).

**Live-verified** against the running engine (:6968): PATCH `{effectsPage:2}` →
`{"status":"ok","effectsPage":2}`; PATCH `{page:1}` → the exact 400. Rebuilt the
web bundle (`npm run web:build`) — `dist` now emits `effectsPage:`, no `{page}`
body. Left the engine page at 0. **No engine restart needed** (no engine edits).

### 2. VSN1 WELCOME / hello (Sina feature)

On effects-panel load AND on MIDI (re)connect, CaptainPad now sends the VSN1 a
one-shot **hello** RIDING WITH the full feedback re-sync. Pinned address (added to
the vsn1.yaml feedback table — a distinct address from the side-button page LEDs,
which are Note On ch1 note 41, so no collision):

- **WELCOME → CC channel 2, controller 41, value 1** → `[0xB2, 41, 1]`

Emitted once per arm, never diffed into the steady stream. Armed on a genuine
(re)connect (`runConnect`, the `!wasConfigured` transition that also resets the
feedback diff) and via `MidiManager.requestVsn1Welcome()` — routed from the panel
mount through `useMidiControl.notifyEffectsPanelLoaded()`. Consumed (unshift-first,
so it leads the frame) in `ControllerRuntime.sendVsn1Feedback`. No-op for non-VSN1
profiles + while disconnected (the reconnect then carries it). New export
`vsn1WelcomeMessage()` + `WELCOME_CH/CC/VALUE` in `utils/midi/vsn1_feedback.ts`.
The device-side logo/greeting render is Track T's job — CaptainPad's contract ends
at "hello + full state emitted."

### Tests + verification

- **`utils/midi/effects_v2.test.ts`**: +5 WELCOME tests (address/one-shot/
  connect/panel-load/genuine-replug-reconnect).
- **`utils/effects_page_api.test.ts`** (NEW): +3 — asserts the PATCH body is
  `{ effectsPage }` (regression lock), surfaces the engine 400 verbatim, and reads
  `effectsPage` back on GET. Needed a non-recursive `utils/*.test.ts` include in
  `vitest.config.ts` (stubs RN/engineEvents/apiBase itself).
- `npx vitest run` → **436 passed / 436** (was 428; +8). `npx tsc --noEmit` → 0
  errors.

---

## Addendum — knob fix, two-step toggle, page-index band (2026-07-11)

Follow-up from live hardware play (Sina + VSN1 connected, engine :6968 /
CaptainPad :6967). Zone: `CaptainPad/` only.

### 1. KNOB BUG — root cause + fix (host side)

**Root cause: a channel pin.** The VSN1 jog wheel emits **CC 40 on channel =
the current effects page (0-3)** — the same encoder that walks a value on page 0
(channel 0) walks it on channel 1 once page 1 is selected. The shipped
`midi_profiles/vsn1.yaml` pinned the jog to `channel: 0` (the original capture,
`marsin_engine/tools/midi_discovery/captures/intech_grid_midi_device_20260708_201118.json`,
was taken entirely on page 0 — 162 CC-40 events, all channel 0, absolute 0..27,
so it neither showed nor refuted the moving channel). `resolver.ts matches()`
compares `ev.channel === m.channel`, so on pages 1-3 the jog CC failed to
resolve → returned null → nothing dispatched. That is exactly "the mode cycle
works (notes are all channel 0) but the knob does nothing." The rest of the host
path (`effectIntensityAbs` → runtime `handleIntensityAbs` → coalescer →
`flushEffectIntensity` → pickup guard → `effectIntensitySlot` dispatch →
`setGlobalEffectSlotIntensity` → `POST /global-effect-slots/:id/intensity`) was
never reached, so it was never the culprit.

**Fix (explicit, no fallback):** a first-class **`anyChannel: true`** option on
the CC match. When set, `matches()` compares the CC **number alone** and ignores
the channel — binding all four page-channels with ONE control instead of four
near-duplicate rows. Not a silent fallback: it is validated (`profile.ts`, throws
on non-boolean, defaults false), documented, and opt-in per control. Applied to
the `jog_intensity` control in `vsn1.yaml` (`channel: 0` stays as a required
placeholder, not compared). Touched: `profile.ts` (type + validator),
`resolver.ts` (`matches`), `vsn1.yaml` (jog control + header note).

**LIVE verification (host path proven end-to-end):**
- Resolver/manager tests inject the device CC on channels 0-3 against the REAL
  shipped `vsn1.yaml` → all resolve to `jog_intensity` / `effectIntensityAbs`.
  Full manager path: select slot 1, jog **on channel 1** → `setGlobalEffectSlotIntensity(1, 64/127)`.
- Engine slot status curl proved the dispatch TARGET moves the value:
  `POST /global-effect-slots/1/intensity {value:0.37}` → 200, status read back
  `intensity=0.37`; restored to 1.0. (mode-cycle + GET page also confirmed live;
  engine currently on `effectsPage:2`. All engine test residue restored.)

The device-side (does the VSN1 actually emit channel=page, and does its Lua
render the feedback) is the parallel Track-T agent's confirmation — the host is
now channel-agnostic for this control either way, so it is correct whether the
device emits on channel 0 or channel=page.

### 2. TWO-STEP slot toggle (VSN1 only) — Sina's locked contract

`manager.ts` `handleVsn1SlotKey()` (gated `device.id === 'vsn1'`; every other
device keeps the historical direct single-press dispatch). Behavior read fresh
from the slot's live `behavior` snapshot field each press (a re-bind flips the
gesture automatically):
- **TOGGLE / hold** slot: press an UN-selected slot → **SELECT only, no engine
  action** (operator sees the target on the LCD first); press the ALREADY-selected
  slot → dispatch the toggle. Re-pressing keeps toggling; pressing a DIFFERENT
  slot re-selects (no dispatch) — no fat-finger flip while reaching.
- **TRIGGER / burst** slot: **select + fire immediately on EVERY press**
  (hand-drummed). No two-step (it would defeat a momentary flash).
- Unknown/absent behavior (snapshot race) → **fails safe to two-step** (select
  first, never a surprise fire).
- The jog still works after a single (select-only) press — selection is set even
  when no toggle dispatched.

### 3. Effects panel TOP BAND — page index (P0-P3)

`GlobalEffectMacros.tsx` `Header` now renders a **PAGE P{page}** badge (0-based,
matching the engine `effectsPage` value + the VSN1 LCD numbering) next to the
"Global Effects" title, above the P1-P4 switcher. Threaded `page` into both
Header call sites.

### 4. Mode display (NAME, never "M1/M2")

Already compliant — the UI shows `formatMode(slot.mode)` (the real value, e.g.
`add`/`replace`/`max`, confirmed live on slot 4) and `slot.modeLabel`, never a
"M1/M2" ordinal. No "M1/M2" string exists anywhere in the components. No change
needed; verified by grep + live engine `modeValues`.

### Tests + verification

- `resolver.test.ts` +4 (anyChannel: matches all channels 0-15, still needs the
  CC number, pinned control unaffected).
- `profile.test.ts` +3 (anyChannel accepted/normalised, defaults false, non-bool
  throws).
- `vsn1_intensity.test.ts` +11 (two-step: select-vs-toggle-vs-trigger, re-select
  no-flip, fail-safe, jog-after-select-only; shipped-profile jog resolves on
  channels 0-3; full-path jog on channel 1 writes intensity). One pre-existing
  test updated to the two-step contract (first press selects, second toggles).
- `global_effect_slot_behavior.test.ts` +1 regression (a NON-VSN1 device
  dispatches on the FIRST press — no two-step gate).
- **`npx vitest run` → 454 passed / 454** (was 436; +18). `npx tsc --noEmit` → 0
  errors. `expo lint` → 0 errors (pre-existing warnings only, none in touched
  files).

### Needs the device / engine side
- Track T: confirm the VSN1 firmware truly emits CC 40 on channel=page and that
  its Lua renders the intensity/mode/page feedback (host is channel-agnostic
  regardless).
- Nothing needed from the engine — its intensity / mode-cycle / page endpoints
  were all verified live and are unchanged.

---

## Addendum 2 — KEYED value contract, page-change resync, prompt toggle LEDs (2026-07-11, follow-up wave)

The device track redeployed with a CHANGED encoder wire contract (firmware
constraint: the old CC 40 stream could only be relative 63/65 codes — useless
for absolute values). **This supersedes the CC 40 `anyChannel` binding from
Addendum 1** — the `anyChannel` + `ccTo` mechanisms it introduced are what the
new binding is built on. Host changes in `CaptainPad/` (yaml/manager/feedback
layer only; a design agent owns concurrent visual polish — untouched).

### 1. NEW VALUE CONTRACT (keyed, self-addressed)

The encoder value message now addresses its slot itself:
`CC channel = current effects page (0-3), controller = 32+k (key 0-7), value =
absolute 0..127` → **flat slotId = 8*channel + (controller-32) + 1**.

- `vsn1.yaml`: `jog_intensity` (CC 40) REPLACED by `key_values` —
  `match: { type: cc, channel: 0, cc: 32, ccTo: 39, anyChannel: true }`,
  `action: { kind: effectIntensityKeyed }`. **CC 40 is now unbound inbound**
  (loud silence); note 40 mode-cycle unchanged; outbound page feedback still
  rides CC 40 on the FEEDBACK channel (ch1) — different direction, no collision.
- `profile.ts`: new `ccTo` CC-range match (inclusive, mirrors the note [lo,hi]
  form; matched offset = action index; matchKeys expands the range so overlap
  detection covers every CC in it) + new `effectIntensityKeyed` action kind.
- `resolver.ts`: `effectIntensityKeyed` resolves a CONCRETE
  `effectIntensitySlot { slotId: 8*ch + k + 1, value: v/127 }` — resolveEvent is
  now that kind's second producer (doc updated). A channel > 3 addresses a slot
  > 32 and the engine rejects it — surfaced fail-loud, never clamped.
- `manager.ts`: continuous `effectIntensitySlot` payloads coalesce with a
  **per-slot key** (`controlId#s<slotId>`) so two keys turned inside one 33 ms
  window can't last-write-wins each other. Selection tracking KEPT for the
  two-step toggle + mode cycle (unchanged); value writes no longer consult it.
- **PICKUP GUARD REMOVED on this path (deliberate, documented in yaml +
  resolver):** the device renders its displayed value FROM OUR FEEDBACK STREAM,
  so the absolute position it emits is anchored on the slot's live value by
  construction — a takeover jump can't originate host-side, and a host lock
  would only swallow legitimate first writes. The legacy selected-slot
  `effectIntensityAbs` + pickup machinery stays valid profile vocabulary for
  other devices (vsn1.yaml no longer binds it).

### 2. FULL FEEDBACK RE-SEND ON EVERY PAGE CHANGE

The firmware restarts its Lua VM on each page load, wiping device-side state.
Two triggers in `manager.ts`:
- `sendVsn1Feedback` tracks `lastVsn1FeedbackPage`; ANY `effectsPage` change in
  the snapshot (engine WS broadcast, whatever surface changed it) resets the
  feedback diff → the WHOLE frame (actives/values/modes/page/side-button LEDs)
  re-emits, even byte-identical values a diff would suppress.
- A VSN1 side-button press forces a full repaint after its dispatch settles —
  covering the **same-page re-select** (VM restarts, but no broadcast arrives).
  A genuinely changed page gets a second full frame with the NEW page's slots
  from the broadcast path (cheap, correct double-paint).

### 3. PROMPT TOGGLE LED FEEDBACK (stateless device keys)

The device no longer self-lights toggle keys. `handleVsn1SlotKey`'s commit
branch captures the slot's PRE-dispatch active state and, when the engine ACKs,
`emitVsn1ActiveEcho` immediately sends the flipped active note (same optimistic
pattern as the UI's optimisticActive) — no broadcast round-trip wait. Recorded
into the feedback diff so the agreeing broadcast is suppressed; a disagreeing
engine value still re-sends (engine wins). Skipped when the slot isn't on the
visible page, when the value was already painted (broadcast beat us), and on a
FAILED dispatch (never fake-lit). The select-only first press sends NO active
feedback — no flicker (tested).

### Tests + verification

Updated (old CC 40 value contract → keyed): 6 rewritten in
`vsn1_intensity.test.ts`; new coverage —
- keyed addressing math across ALL 4 pages × 8 keys (resolver, shipped yaml);
  value scaling 0/64/127; **CC 40 no longer resolves on any channel**;
- manager full path: no selection needed; no pickup lock; channel-1 CC → slot 9;
  per-slot coalescing (two keys in one window BOTH write); unthreaded-intensity
  slot still writes; keyed write independent of a select-only press;
- `effects_v2.test.ts`: page-change full-frame re-send (byte-identical state
  re-sent), same-page side-button full re-send, steady-state stays diffed;
  toggle echo (immediate active note on ACK), select-only = no active feedback,
  failed dispatch = no echo, agreeing broadcast diff-suppressed;
- `profile.test.ts`: ccTo accepted/normalised, inverted range throws,
  out-of-range throws, range overlap detected.

**`npx vitest run` → 466 passed / 466** (was 454 after Addendum 1; +12 net).
`tsc --noEmit` → 0 errors. `expo lint` → 0 errors (pre-existing warnings only).

### Needs the device / engine side
- Track T: confirm the deployed Lua emits exactly `CC ch=page, 32+k, 0..127`
  for the selected key and renders the full-frame repaint after each VM restart
  (host now re-sends on every page change AND on every side-button press).
- Engine: nothing — endpoints unchanged (intensity POST verified live earlier).

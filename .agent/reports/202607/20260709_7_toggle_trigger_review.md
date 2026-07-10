# 20260709_7 — VSN1 toggle/trigger reliability review (read-only RCA + fix spec)

**Scope:** diagnosis only — NO code edited (host wave + device tools agents are
concurrently editing those zones). Live evidence gathered against the running
stack (engine :6968, CaptainPad :6967, VSN1 hardware).
**Symptoms (Sina, live hardware):**
1. Toggle effects don't stick to ON.
2. Trigger effects (Iceberg Flash) are unreliable under fast hand-drumming.

---

## Executive summary

**The engine is exonerated** — live curl proof below shows toggles persist and
rapid triggers all land. Both symptoms come from the host↔device seam, and both
share one systemic flaw: **the press pipeline has three fragile preconditions
(fresh behavior snapshot, page-0-only key mapping, an up-to-date device
config), and every miss degrades SILENTLY** — the worst possible failure mode
for a live drumming surface.

| # | Root cause | Zone |
|---|---|---|
| T1 | Device runs a **stale layout deploy** (2026-07-09T03:10) — per-key toggle/trigger kinds, colors, LCD names no longer match the live slots; a live-toggle key deployed as trigger-kind can never hold its LED ON | device (Track T) + engine (staleness detection) |
| T2 | **`toggle` on a dropHit slot is a silent engine no-op that returns `"status":"ok"`** — the host's fail-safe path turns trigger keys into a 200-ok black hole | engine + CaptainPad host |
| T3 | **Key→slot mapping is not page-aware** (vsn1.yaml pins keys to flat slots 1–8, notes to channel 0) — off page 0 every key press acts on an invisible page-0 slot (or resolves to nothing, pending channel-capture proof) | CaptainPad host |
| T4 | Two-step select/commit gives **no on-device cue distinguishing "selected" from "toggled"**, and a fast double-tap on the selected key flips ON→OFF with no guard | CaptainPad host + device |

---

## Live evidence (engine exonerated; state restored after each test)

All against the running engine (:6968), current layout = 8 slots, page 0,
slots 6/7 = `dropHit` `behavior:'trigger'` (Iceberg Flash), rest toggles.

1. **Toggles PERSIST.** `POST /global-effect-slots/3/toggle` → `active:true`;
   still `true` 5 s later. Same for slot 8 (2 Hz Pulse strobe —
   `burstEndFrame:null`, continuous). Restored off. Nothing engine-side
   auto-deactivates a toggled slot.
2. **Rapid triggers ALL land.** 10 back-to-back
   `POST /global-effect-slots/6/trigger` → `controller.dropHit.count == 10`.
   `triggerDropHit` (`global_effects_controller.js:777`) **pushes a new poly
   envelope per call** — no retrigger suppression, no coalescing.
3. **THE SMOKING GUN for triggers:** `POST /global-effect-slots/6/toggle` →
   HTTP 200 `{"status":"ok","slotId":6,"action":"toggle",…}` — and
   `dropHit.count` UNCHANGED, `active:false`. The engine **accepted the action,
   reported ok, and did nothing**:
   `global_effect_slot_manager.js:844-848` —
   ```js
   case 'dropHit':
     if (['trigger', 'activate', 'down'].includes(action)) {
       this.controller.triggerDropHit(resolved.params, nowMs);
     }
     return;   // ← 'toggle' falls through silently, route still replies ok
   ```

---

## Symptom 1 — "Toggles are not sticking to ON"

### Root cause A (proven): stale device layout — LED can't hold ON

The device's key LEDs are **stateless**: sticky ON comes exclusively from the
host's slot-active feedback, gated per key by a **builder-embedded kinds array**
(`encoder_init.lua:31,42` — `knd = __KINDS__`; LED held only
`if knd[base+k+1] == 1` i.e. toggle-kind). Toggle keys got `key_bc_toggle.lua`
(no self-LED); trigger keys keep the factory momentary tap-flash BC.

The last deploy (`tools/vsn1_config/dumps/layout_engine_page0.json`, generated
**2026-07-09T03:10:39Z**) embeds `knd={0,1,1,1,1,0,0,1,…}` and factory-flash
BCs on elements 0, 5, 6. The **live** engine layout has since changed
(`states/test_bench/vsn1_layout.json` + live status): **slot 1 is now
'Blast Wht' `behavior:'toggle'`** — but its key is deployed as
**trigger-kind**: the receiver ignores its active feedback and the factory BC
just tap-flashes. Toggling slot 1 succeeds on the engine, and **the key LED
still goes dark** → reads exactly as "toggle didn't stick." LCD names/abbrs/
colors (`__NAMES__/__ABBRS__/__COLORS__`, `lcd_init.lua`) are equally stale —
the surface can lie about which effect a key is.

The layout-changed hook currently only **writes `vsn1_layout.json`**
(config-gated deploy, dossier Track E) — nothing pushes to the device, and
nothing detects/reports drift. The device silently diverges after every slot
edit.

### Root cause B: two-step commit with no select-cue + no double-tap guard

`manager.ts:1237-1266` `handleVsn1SlotKey()`:
- Press on a NOT-selected toggle key → **select only** (deliberate, Sina's
  locked contract). No LED change is emitted on select (by design,
  manager.ts:1248-1254) — so on the hardware the only cue is the LCD
  name. A single press "does nothing" visually on the key itself; combined
  with root cause A there is **zero distinction between selected / toggled-on /
  stale-LED** → "it won't stick."
- Press on the ALREADY-selected key → toggle dispatch, every time, **no
  debounce**: a habitual fast double-tap (this surface trains drumming!) turns
  the effect ON then immediately OFF. `emitVsn1ActiveEcho` (manager.ts:1274)
  faithfully echoes the final OFF.

Not causes (verified): engine persistence (proof 1); the echo/diff feedback
path (the engine's WS broadcast fires inside the action route,
`api_server.js:4784`, and reaches the snapshot before/at ACK — echo is
diff-suppressed correctly); resolver note-off handling (`resolver.ts:227-228`
swallows Note Off, `midi_message.ts:27-31` normalises vel-0 — no
release-double-fire).

### Fix spec — toggles

1. **Redeploy pipeline (Track T + engine, HIGHEST value):** wire the
   layout-changed hook to actually run
   `node tools/vsn1_config/deploy_layout.cjs --layout <state file> --live`
   (per the dossier contract), and until then: manual redeploy NOW — the
   current device image is 2+ layout-generations stale. Add a staleness
   sentinel: engine status carries a layout hash; CaptainPad surfaces a red
   chip when the last-deployed hash (written by deploy_layout) ≠ current.
   Fail loud, never drift silently.
2. **Select-cue (device Lua, Track T):** on select (host already knows — it
   can emit a dedicated "selected key" feedback CC, e.g. CC ch2 cc42 = key
   index), blink/dim the selected key's LED so select vs committed-ON are
   visually distinct. Host side: emit that CC from `selectSlot()`.
3. **Commit debounce (host, manager.ts `handleVsn1SlotKey` toggle branch):**
   ignore a repeat noteOn on the SAME selected slot within ~250 ms of a
   successful commit (one `lastToggleCommitMs` per slot). A deliberate
   re-toggle is never that fast; a double-tap/bounce is.
4. Keep the two-step for toggles — it's Sina's locked contract and it isn't
   the state-loss culprit. Make it VISIBLE instead (points 1-2).

---

## Symptom 2 — "Triggers are not reliable at all"

### The two-step logic itself is CORRECT for triggers — when it engages

`manager.ts:1240-1245`: `behavior === 'trigger'` → **select + fire on EVERY
press, including the first** — no select step, no coalescing (discrete actions
bypass the coalescer, manager.ts:996-998), no debounce, one immediate
`POST /:id/trigger` per noteOn. Covered by tests
(`vsn1_intensity.test.ts:240-254` — first press fires, every press fires).
The coalescer only ever touches continuous CCs; **it cannot swallow key
presses**. Transport (`web_midi_transport.ts`) has no throttling. Engine
handles ≥10 rapid triggers (proof 2).

### Root cause: every precondition-miss lands in a SILENT black hole

The trigger branch engages only if the snapshot lookup
(`manager.ts:1239`) returns `'trigger'`. Every miss falls to the two-step
toggle branch, whose dispatch maps unknown/absent behavior to action
`'toggle'` (`dispatch.ts:180-183`) — which the engine **silently accepts and
drops** for dropHit slots (proof 3, T2). Concretely, when behavior misses:

- **1st press:** select only — the hit is eaten.
- **Every subsequent press:** `toggle` → engine 200-ok **no-op**. The key is
  dead forever, and *no error surfaces anywhere* (host `surfaceApiResult` sees
  `ok:true`).

Miss windows that exist today:
- **Boot/refresh race** — `useMidiControl.ts` seeds `globalEffectSlots` once
  via REST (`refreshSlots()`, useMidiControl.ts:961) + WS broadcasts; before
  the seed (or after an engine restart with a dead WS) behavior is
  `undefined` indefinitely.
- **Page ≠ 0 (T3):** vsn1.yaml keys are pinned to flat slots 1–8
  (`vsn1.yaml:113-136`) and `resolver.ts:295-297` uses `a.slot` verbatim —
  the ONLY VSN1 control that is not page-aware (keyed values compute
  `8*ch+k+1`; feedback projects the active page). On engine page p>0 a key
  press acts on invisible page-0 slots — "random" effects with no LED echo
  (`emitVsn1ActiveEcho` skips off-page slots, manager.ts:1277). With side
  buttons live, one press of sb1–sb3 puts the surface in this state.
- **Channel pinning (needs capture proof):** the device templates state keys
  and side-buttons emit `ch = page` (`key_bc_toggle.lua:4`,
  `side_button.lua:7`) while vsn1.yaml pins all notes to `channel: 0`. If the
  templates' comment describes the deployed firmware truthfully, then off
  page 0 every key/sb note is **dropped by `matches()`** (resolver.ts:194) —
  total deadness — and `side_button.lua:20-22` calls `page_load()` BEFORE its
  `midi_send`, so even the page-select note may ride the NEW channel and be
  dropped, desyncing device page from engine page with no recovery (the page
  CC echo is diff-suppressed when the engine page never changed). This
  contradicts Addendum 1's observation that notes stayed ch0 — the firmware
  was redeployed since the only existing capture (2026-07-08, pre-redeploy).
  **A fresh capture across all 4 device pages is required** (also capture
  ≥10 presses/s on one key to rule out device-side fast-press drops — the
  full-screen LCD repaint per event, `lcd_draw.lua:22`, is the suspect if
  drops appear).

### Fix spec — triggers

1. **Headline (engine + host): make the press semantics behavior-resolved
   SERVER-side.** Add engine action **`press`** to
   `dispatchSlotAction` — the engine already holds `resolved.behavior`:
   trigger slot → `triggerDropHit`, toggle slot → flip (mirror the
   `_dispatchKickPunch` pattern, `global_effect_slot_manager.js:999`). Host
   `dispatch.ts` sends `press` whenever it would currently guess. Then a
   stale/missing host snapshot can never convert a trigger into a dead key —
   the two-step UX gate remains the ONLY thing behavior knowledge is used for
   host-side, and IT should fail safe to select-first exactly as today.
2. **Fail loud at the engine (regardless of #1):** `case 'dropHit'` must
   REJECT non-firing actions (`toggle`/`hold`) with a 4xx + error body instead
   of ok-no-op — the host then surfaces `✕ globalEffectSlot failed` instead of
   nothing. (One-line change at `global_effect_slot_manager.js:844-848` +
   route error mapping.)
3. **Page-aware keys (host):** resolve the key's flat slot as
   `8*effectsPage + k + 1` (snapshot `effectsPage`), or from the note's
   channel if the fresh capture proves notes ride `ch = page` (then also set
   `anyChannel: true` on the 8 key controls, the jog press, and the side
   buttons in vsn1.yaml). Keys must address the slots the device is
   DISPLAYING, like the keyed values already do.
4. **Two-step for triggers: keep the bypass, never widen it.** Triggers must
   fire on every press including the first — the code already says so; the
   fixes above make it true under all conditions. Do NOT add any debounce on
   the trigger path.

## Recommendation on the two-step contract

Keep it **for toggles only** (Sina's locked contract, with the select-cue +
commit debounce), and keep triggers **fully bypassed** — the current split is
the right design; it's the silent degradation paths around it that broke the
hardware feel.

## Who fixes what

- **CaptainPad host wave:** page-aware key slots (+`anyChannel` pending
  capture), dispatch `press` when behavior unknown, commit debounce,
  select-cue emission.
- **Engine:** `press` action, dropHit loud rejection, layout-staleness hash in
  status.
- **Device tools (Track T):** redeploy the CURRENT layout to the VSN1 (stale
  since 2026-07-09T03:10 — this alone fixes slot 1's dead toggle LED), fresh
  multi-page + fast-press MIDI capture, select-cue LED render,
  `side_button.lua` send-before-page_load ordering.

*Test residue: engine slot 3/6/8 states exercised via REST and restored
(all inactive, dropHit envelope self-expired). No files besides this report
were written; no code touched.*

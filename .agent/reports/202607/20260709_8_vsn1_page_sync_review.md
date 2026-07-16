# VSN1 Effects-Page Sync Review — root causes + ranked fix plan

- **Date:** 2026-07-09
- **Role:** reviewer (read-only diagnostic; no code edits, no device flash, no engine mutation)
- **Scope:** VSN1 side buttons (sb0-3) → effects page switching across device / CaptainPad host / engine / UI
- **Live state at review time (read-only GETs, engine :6968):**
  `GET /global-effects/page` → `{"effectsPage":0}`; layout has 7 bound slots, ALL
  on page 0 (slotIds 1-6, 8); pages 1-3 are empty; `pageCount: 4`; device deploy
  `enabled: false` (device was hand-reflashed with the current effects_layout).

## Operator symptoms

1. An sb press must be repeated 1-2 times before the DEVICE page changes.
2. Sometimes the device page changes AND the CaptainPad UI follows; sometimes
   the device changes but the UI does NOT.
3. Pages 2/3: the device eventually lands there (after many clicks) but the
   CaptainPad UI NEVER shows page 2/3.

## Executive summary

The engine and the UI are **not** the problem — both are correct and tested.
All three symptoms originate on the **device Lua script ordering** plus one
**host-side race**:

- `side_button.lua` calls the local `page_load(N)` **before** its
  `midi_send` (lines 20-23). On VSN1L fw 1.5.1 `page_load()` **restarts the
  Lua VM**, so whenever the local page change actually succeeds, the
  page-select note that was supposed to follow it is killed — the host never
  hears the press. The script's own header comment claims "the sb ALWAYS
  emits its page-select note"; the code does not deliver that promise.
- The failure is *deterministic on empty pages*: firmware only drops
  `page_load` when a bulk op is in flight. Pages 1-3 are empty → no feedback
  traffic → the local `page_load` virtually always succeeds → the emit is
  virtually always killed → the engine never learns about sb2/sb3 → the UI
  never switches. That is symptom 3, and it is a true sync failure, not an
  empty-page rendering illusion (an empty page renders 8 empty sockets + the
  "PAGE P2" badge — fully observable).
- A host-side stale-snapshot repaint (`manager.ts:990-996`) can additionally
  **snap the device back** to the engine's old page right after a successful
  press, contributing to "press 1-2 times" and "many clicks".

**Headline recommendation:** make the sb press **emit-only** on the device
(drop the local `page_load`), and let the engine's page-feedback CC (already
received by `encoder_init.lua:71`) be the only thing that moves the device
page. One code path, engine stays authoritative, the emit can never be killed
because no VM restart happens until the host echo returns.

---

## (a) Root cause of each symptom, with evidence

### The loop as built (verified)

1. **Device** `marsin_engine/tools/vsn1_config/templates/effects_layout/side_button.lua`:
   ```lua
   if self:button_value() > 0 then
     page_load(self:element_index() - 9)   -- line 21: LOCAL page jump FIRST
   end
   self:midi_send(-1, -1, -1, -1)          -- line 23: note 41+N emit AFTER
   ```
   Firmware fact (VSN1L 1.5.1): `page_load()` restarts the module Lua VM
   (wipes globals, re-runs every INIT). Firmware silently drops `page_load`
   when a bulk op is in progress or page changes are disabled
   (documented in the script header, lines 3-11).
2. **Host** `CaptainPad/midi_profiles/vsn1.yaml:192-203`: notes 41-44,
   `anyChannel: true`, → `effectsPageSelect` pages 0-3 — all four pages ARE
   mapped. `resolver.ts:331-336` fires on Note On only (Note Off swallowed at
   `resolver.ts:234`; the device's vel-0 release decodes as `noteOff` at
   `midi_message.ts:31` — no double-fire). `dispatch.ts:231-234` →
   `api.setEffectsPage(page)` → PATCH `/global-effects/page` with the
   canonical `{effectsPage}` body (`api.ts:1949-1955`).
3. **Engine** `lib/api_server.js:4533-4546`: PATCH validates via
   `global_effect_slot_manager.js:245-253` (integer 0..3, throws otherwise
   → 400), persists, and broadcasts `{type:'effectsPage', effectsPage}` on
   `/ws/control` (`ws_topic_routing.js:93`). Covered by
   `tests/effects_v2_api.test.js:126-163` incl. page 2 and out-of-range
   rejection. **No clamp, no rejection of empty pages — engine is correct.**
4. **UI** `components/GlobalEffectMacros.tsx:299-303` follows the broadcast
   (`setPage`), seeds from GET on mount (line 264-266). The PageSwitcher
   renders all `EFFECTS_PAGE_COUNT = 4` pages
   (`global_effect_macros_logic.ts:23`, `GlobalEffectMacros.tsx:804`);
   `computeVisibleSlots` pads empty pages with 8 empty cells; the header
   badge shows `PAGE P<n>`. **UI is correct and an empty-page switch is
   observable.**
5. **Feedback (host→device)** `utils/midi/vsn1_feedback.ts:157-176` + 
   `manager.ts:1974-2036`: page CC 40 (ch1) + 4 side-button LED notes + 24
   per-slot messages, DIFFED; a one-shot `vsn1ForceFullResync` flag forces a
   full ~29-message frame on page change / sb press received / reconnect /
   panel load. The device receiver `encoder_init.lua:70-71` applies
   `if p2 ~= page_current() then page_load(p2) end`.

### Symptom 2 — "UI sometimes follows, sometimes not" (root cause: emit killed by the VM restart)

`side_button.lua` orders `page_load` (line 21) before `midi_send` (line 23).
The press forks deterministically on whether the firmware honours the local
`page_load`:

- **Local `page_load` dropped** (bulk op in flight / page changes disabled):
  the script continues, `midi_send` emits note 41+N → host PATCHes the
  engine → WS broadcast → **UI follows**, and the engine's page-CC echo
  lands the device page via `encoder_init.lua:71`. Everything converges.
- **Local `page_load` succeeds**: the VM restart wipes the script (or its
  queued TX) before the note escapes → **the host never hears the press** →
  engine `effectsPage` unchanged → **UI does not follow**, and the device is
  now AHEAD of the engine.

So "sometimes both, sometimes only the device" is exactly the
firmware-busy/not-busy coin flip. The script's own header (lines 6-11)
asserts "the sb ALWAYS emits its page-select note ... the HOST is the source
of truth" — the ordering breaks that guarantee precisely in the case the
local jump works.

### Symptom 3 — "device eventually reaches 2/3; UI NEVER" (root cause: same as #2, made deterministic by empty pages)

Pages 1-3 have **zero bound slots** (live layout check). Consequences:

- No slot state → no feedback diffs → no bulk ops in flight when the
  operator presses sb2/sb3 from an idle page → the local `page_load(2|3)`
  essentially **always succeeds** → the emit is **always** killed → the
  engine **never** receives `effectsPageSelect` for 2/3 → UI never moves.
- Repeat presses don't help: re-selecting the current page still restarts
  the VM (documented at `vsn1.yaml:96-99`), killing the emit again.
- Any later full-resync from the host (panel load, reconnect, a slot-key
  press, layout edit — all arm `vsn1ForceFullResync`) re-sends page CC =
  the ENGINE's page (still 0) → `encoder_init.lua:71` yanks the device BACK
  off page 2/3. That is the "many clicks" experience: the device page keeps
  reverting whenever host feedback fires.

Explicitly ruled out for symptom 3:
- UI cap/keying bug — none: switcher renders 4 pages, `setPage` is
  unconditional, empty pages render visibly.
- Engine clamp — none: PATCH accepts 0-3, tested with 2.
- Empty-page observability — a UI switch to an empty page IS visible (badge
  + highlighted segment + 8 empty sockets), so the operator's "UI never
  switches" is a real missing PATCH, not an invisible switch.

### Symptom 1 — "press 1-2 times before the device page changes" (two stacked causes)

1. **No retry on the echo path.** When the local `page_load` is dropped
   (busy firmware) the note DOES reach the host and the engine's page-CC
   echo is supposed to land the device page — but that `page_load(p2)`
   (`encoder_init.lua:71`) can be dropped by the firmware for the same
   bulk-in-progress reason (the echo rides at the head of a ~29-message
   full-resync frame, i.e. arrives exactly when the device is busiest).
   The host's diff (`manager.ts:2014-2018`) then records page CC as "sent"
   and never re-asserts it → the press is silently lost → press again.
2. **Stale-snapshot repaint race** (`manager.ts:990-996`): after the PATCH
   resolves, the handler re-arms the resync flag and calls
   `projectAndSend()`. That repaint reads `snap.effectsPage`
   (`manager.ts:1976`), which is only updated by the **WS broadcast**
   (`useMidiControl.ts:987-999`) — the PATCH response's resolved page is
   discarded. If the `.then` repaint wins the race against the broadcast,
   the host sends a full frame whose page CC is the **OLD** page; if the
   device had locally jumped, `encoder_init.lua:71` snaps it back, and the
   correct page CC only arrives on the next broadcast-driven emit — which
   the device may again drop mid-restart. Net effect: first press visibly
   "doesn't take" or flickers back; second press lands.

Also noted (cosmetic, not paging): when a page-change frame is emitted, its
FIRST message (page CC) triggers the device VM restart, so the remaining ~28
messages of that same frame hit a restarting VM and are lost — the LCD shows
defaults until the next emit. The double-blast `.then` repaint partially
covers this but is subject to the same race above.

---

## (b) Ranked fix plan, by zone (disjoint — dispatchable in parallel)

### Zone D — device Lua (`marsin_engine/tools/vsn1_config/templates/effects_layout/`) — **P0, fixes symptoms 2+3**

- **D1 (the fix):** `side_button.lua` — remove the local `page_load(...)`
  entirely; the BC becomes emit-only (`button_mode/min/max` + press-guarded
  emit semantics unchanged). The ONLY page mover on the device becomes the
  existing feedback receiver `encoder_init.lua:71` (engine-authoritative,
  already guarded `p2 ~= page_current()`). With no restart before
  `midi_send`, the note ALWAYS escapes; same-page re-selects no longer
  restart the VM at all (kills the pointless full-wipe on re-select).
- **D2 (only if D1 is rejected for feel):** at minimum reorder —
  `midi_send` BEFORE `page_load`. Caveat: if the firmware defers the
  restart to end-of-script, ordering alone may not save a TX-queued
  message; needs the hardware capture in (d) to validate. D1 does not have
  this uncertainty.
- Requires a reflash of the effects layout after the template change (via
  the config tool / registry-locked path — not part of this review).

### Zone H — CaptainPad host (`CaptainPad/utils/midi/manager.ts`) — **P1, fixes symptom 1**

- **H1 (race):** in the `effectsPageSelect` handler (`manager.ts:990-996`),
  stop repainting from a possibly-stale snapshot. The PATCH response body
  carries the resolved page (`{status:'ok', effectsPage}`) — thread it into
  the manager's view (or skip the page-CC in the post-dispatch repaint, or
  defer the repaint until the snapshot's `effectsPage` equals the dispatched
  page). The engine response is authoritative; using it removes the
  old-page-CC snap-back window entirely.
- **H2 (lost echo):** exempt the page CC (and optionally the 4 side-button
  LED notes) from the diff — always include page CC in every emitted frame,
  and/or re-assert it once ~150 ms after a page change. It is one 3-byte
  message; un-diffing it makes a firmware-dropped `page_load` self-heal on
  the next emit instead of silently persisting. (The receiver's
  `p2 ~= page_current()` guard makes re-sends idempotent.)
- **H3 (frame wipe, cosmetic):** when the emitted frame CHANGES the device
  page, send the page CC first, then delay the remaining ~28 messages by
  the measured VM-restart time (see (d)) so they don't land on a dead VM.
  This replaces the racy double-blast as the LCD-repaint guarantee.

### Zone E — engine (`marsin_engine/lib/`) — **no defect found; no work**

GET/PATCH `/global-effects/page` validates, persists, broadcasts for all
four pages (`api_server.js:4529-4546`, `global_effect_slot_manager.js:
245-253`, `ws_topic_routing.js:93`); tests cover it. Leave untouched.

### Zone U — CaptainPad UI (`components/GlobalEffectMacros.tsx`) — **no defect found; optional nicety**

The switcher + broadcast-follow are correct. Optional (P3): visually mark
empty pages in the switcher (e.g. dimmed segment) so an operator landing on
an empty page 2/3 doesn't read it as "nothing happened".

**Dispatch note:** D1 alone fixes 2+3; H1+H2 alone would NOT (the emit would
still be killed by the local restart). Both zones are independent files, no
overlap — safe to run in parallel. H fixes still matter after D1 (the echo
can still be firmware-dropped; H2 makes that self-healing).

## (c) Design question: local `page_load` vs engine-authoritative

**Recommendation: engine-authoritative (D1).** Reasons:

- The local jump's only benefit is instant feel, but it is exactly what
  kills the emit — the "optimization" causes the desync it was annotating
  around. The comment in `side_button.lua` already declares the host the
  source of truth; the code should match.
- Latency cost of the round trip (device note → host resolve/PATCH → engine
  broadcast → snapshot → feedback CC → device `page_load`) is one MIDI hop +
  one localhost HTTP + one WS hop — tens of ms. A page switch is a
  navigation gesture, not a performance gesture; this is imperceptible next
  to the VM restart itself (which happens either way).
- One code path = one behavior: device, UI, and any future surface converge
  by construction; the revert-fight (engine echo yanking the device back)
  becomes impossible because the device never moves ahead of the engine.
- Failure mode improves: if the host is down, the sb press does nothing
  (loud, honest — matches P0 no-fallback) instead of silently forking device
  state away from the engine.

## (d) Hardware captures needed to confirm (before/with implementation)

1. **Emit-kill proof:** raw MIDI monitor on the host while pressing sb2 from
   an idle empty page — expectation: NO note 43 arrives when the local page
   visibly changes (only the vel-0 release, if that). Confirms the symptom-2/3
   mechanism directly. (The 2026-07-08 discovery capture predates the current
   ordering question and doesn't settle it.)
2. **Restart semantics:** does the firmware defer the `page_load` restart to
   end-of-script, and does the restart flush the USB-MIDI TX queue? Decides
   whether D2 (reorder) would even work; D1 is immune either way.
3. **Same-page reload:** confirm `page_load(current)` still restarts the VM
   (press sb of the current page; watch for the LCD default flash) — decides
   whether D1 also removes the re-select wipe.
4. **VM restart duration:** time from page CC → receiver `page_load` →
   INIT scripts live again, to size the H3 frame delay.

## Files examined (evidence base)

- Device: `marsin_engine/tools/vsn1_config/templates/effects_layout/side_button.lua`,
  `encoder_init.lua`, `system_init.lua`
- Host: `CaptainPad/midi_profiles/vsn1.yaml`, `utils/midi/resolver.ts`,
  `dispatch.ts`, `manager.ts`, `vsn1_feedback.ts`, `midi_message.ts`,
  `hooks/useMidiControl.ts`, `utils/api.ts`
- Engine: `marsin_engine/lib/api_server.js`, `global_effect_slot_manager.js`,
  `ws_topic_routing.js`, `tests/effects_v2_api.test.js`
- UI: `CaptainPad/components/GlobalEffectMacros.tsx`,
  `components/global_effect_macros_logic.ts`
- Live: read-only GETs to `:6968/global-effects/page` and `/layout`

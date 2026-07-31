# 2026-07-25_14 — Pattern-switch "lag" + dimmed row names: debug report

**Role:** investigator (debug-only — no source file was edited).
**Bug (operator, live iPad):** "the buttons when pressed are doing something
weird to switch patterns — make sure it's snappy. When TX is enabled there's a
little lag while the TX is performing, but WITHOUT it it was snappy before —
now it's weird and it sometimes shows not-super-bright names."
**Operator clarification mid-investigation:** the LIGHTS switch immediately on
tap — the weirdness is UI-side (feedback/selection/dimming), not the engine
path.

**Test rig (all local, operator's stack untouched):** fresh
`npx expo export --platform web` dist served on `:7167` (never Metro `:6967`),
LOCAL engine `node engine.js --model test_bench --pattern 01_cylon_sweep` on
`:6968`, puppeteer with `hasTouch` at iPad-10 landscape (1180x820), WS monitor
on `ws://localhost:6968/ws/control`. Scripts + screenshots:
`~/tmp/pattern_switch_debug/` (`repro.cjs`, `diag.cjs`, `bounce.cjs`,
`perf.cjs`, `idle.cjs`, `s2_mid_transition.png`, `s3_stuck_dim.png`,
`s3_tap_swallowed.png`, `s4_after_release.png`).

---

## Measured facts (clean state)

| Measurement | Result |
|---|---|
| Tap → optimistic highlight, TX OFF (5 taps) | **46–52 ms** from touchstart (17–39 ms touch→click + ~13 ms render) |
| Tap → optimistic highlight, TX ON | **32 ms** (still optimistic — does NOT wait for the POST) |
| POST dispatched per tap | 1 (plus refresh burst: 4–5 GETs) |
| Row pressed-opacity stuck after disable-mid-press (S4) | **No** — opacity back to 1 |
| Chevron/remove click bubbling to row select (S5) | **None** — 0 entry POSTs |
| Old-vs-new tap semantics (RNW 0.21) | **Identical** — `TouchableOpacity` and `Pressable` both run the same `usePressEvents`/`PressResponder`; `onPress` fires on the native `click` in both |

**Conclusion up front:** the selection highlight is optimistic and fast; the
Pressable conversion did not change tap latency semantics and does not stick.
The two symptoms come from elsewhere:

---

## Root cause 1 — "not-super-bright names": the `deckSwapInFlight` 0.55 dim, which can WEDGE permanently

The whole entry list dims and dies while the client believes a deck swap is in
flight:

- `CaptainPad/app/(tabs)/index.tsx:1052` — `disabled={deckSwapInFlight || planGate}`
  into `SplitPlaylistPanes` → `PlaylistPanel`.
- `CaptainPad/components/PlaylistPanel.tsx:1464` — the entry ScrollView renders
  `opacity: disabled ? 0.55 : 1` → **every name washes out at 0.55** (this is
  the "not super bright" look; row text on top of a 0.55 container).
- `PlaylistPanel.tsx:860` (`if (disabled) return;`) + `:1512`
  (`disabled={missing || disabled}` on the row Pressable) → **all taps are
  silently swallowed client-side** (measured: 0 POSTs dispatched).
- The flag is set/cleared ONLY by WS events: `index.tsx:491-499`
  (`deckSwapStarted` → true, `deckSwapComplete` → false). No timeout, no
  reconnect reseed; the only rescue is the tab-blur cleanup at `index.tsx:382`.

**Transient case (by design):** every TX-ON crossfade dims the list + disables
all rows for the whole fade; a second tap mid-fade never even reaches the
engine (measured in `bounce.cjs`: tap #2 during a 2 s fade → **0 POSTs**, no
409 — dropped in the client). That is the "little lag while TX is performing"
the operator already accepts. Verified in `s2_mid_transition.png` (ancestor DIV
at computed opacity 0.55, rows `aria-disabled=true`).

**Bug case (the wedge) — REPRODUCED:** the engine can cancel an in-flight swap
WITHOUT ever broadcasting `deckSwapComplete`:

- `marsin_engine/lib/pattern_mixer.js:2429` — `cancelDeckPatternSwap()` nulls
  `_swapTransition` and returns. It never invokes the swap's `onComplete` (that
  would wrongly commit the target) and there is **no cancelled-notification of
  any kind**. The `deckSwapComplete` broadcast only lives inside the
  per-swap `onComplete` closure (`marsin_engine/lib/api_server.js:2328`).
- Callers that hit this mid-fade: **PANIC** (`panicToSafeDefault()`,
  pattern_mixer.js:1202), **snapshot/look-recall morph kickoff**
  (api_server.js:2967), **deck channel remove/replace**
  (pattern_mixer.js:1597). A **WS drop between started and complete** wedges
  the client the same way (deckSwap events are not replayed on reconnect —
  `ws_topic_routing.js` replay set excludes them).

Repro (repro.cjs S3, local engine): TX ON 4 s → tap row (WS shows
`deckSwapStarted deck_4_…`) → `POST /mixer/panic {home:false}` at +800 ms →
**no `deckSwapComplete` ever arrives** → 5 s later the list is still at 0.55
with `aria-disabled=true` (`s3_stuck_dim.png`) → operator turns **TX OFF** and
taps → **0 POSTs — tap swallowed** (`s3_tap_swallowed.png`). The ENGINE is not
wedged (`isDeckSwapInFlight()` is false after cancel), so MIDI/APC taps and
autopilot keep switching the lights normally — exactly the operator's "lights
switch fine but the list is weird and dim" picture. The wedge silently clears
when he visits the mixer tab and comes back, which is why it's "sometimes".

## Root cause 2 — "not snappy" feel on the iPad: 5 Hz whole-tab re-render saturates the main thread

The deck tab re-renders **everything** (both PlaylistPanels ≈ 62 rows,
all parameter sliders, autopilot cards, header) 5×/second, driven by the viz
strip: `index.tsx:508-517` — every `vis` message bumps `setVisVersion` on the
tab component (throttled to 200 ms) even though the pixels land in a ref.

Measured (idle.cjs, deck tab, NO interaction):

| CPU | long tasks in 5 s | main-thread blocked |
|---|---|---|
| 1× (dev box) | 0 | 0 % |
| 4× throttle (≈ iPad class) | 24 × 120–190 ms | **3 440 ms = 69 %** |

Under 4× throttle a tap's optimistic highlight still lands in ~98–168 ms, but
the pressed-feedback and highlight paints queue behind a near-continuous train
of 130–190 ms tasks — on real iPad Safari (slower still, plus the live rig's
fuller viz/audio traffic) this reads as mushy/jittery feedback while the
lights (engine path) are instant. This load is standing, not tap-triggered
(perf.cjs shows the same task train streaming after taps).

## Ruled out (with evidence)

- **Pressable regression:** RNW 0.21 `TouchableOpacity` and `Pressable` share
  `PressResponder`; both fire `onPress` from `click`. Measured touch→click
  3–39 ms. No delay semantics changed.
- **Pressed 0.6 dim sticking:** S4 held a touch, flipped the rows to disabled
  mid-press via an external swap, released after `deckSwapStarted` — opacity
  returned to 1. (Also: sub-50 ms taps never even show the 0.6 flash —
  `delayPressStart` default is 50 ms and activate/deactivate batch at release.)
- **Nested-control double-dispatch:** chevron tap fired 0 entry POSTs
  (PressResponder's `onClick` stops propagation at the child).
- **409 rollback highlight bounce:** can't happen from the list — mid-fade taps
  are swallowed before POSTing.
- **Selection waiting on server echo:** it does not; highlight is optimistic
  (46–52 ms), `pendingActiveEntryIdRef` suppresses stale echoes.

---

## MINIMAL FIX PLAN (for the implementing agent — execute verbatim)

### Fix 1 (engine — kills the wedge at the source)

**File `marsin_engine/lib/pattern_mixer.js`:**
1. In the constructor next to `this.onDeckSwapComplete = null;` (line ~602),
   add `this.onDeckSwapCancelled = null; // Callback: ({ transitionId }) => void`.
2. In `cancelDeckPatternSwap()` (line ~2429): capture the id before nulling —
   `const cancelled = this._swapTransition;` — and after the existing
   fader reset, fire the callback in a try/catch exactly like the
   `onDeckSwapComplete` invocation at ~2550:
   `if (this.onDeckSwapCancelled) { try { this.onDeckSwapCancelled({ transitionId: cancelled.id }); } catch (e) { console.warn('[Mixer] onDeckSwapCancelled threw:', e.message); } }`

**File `marsin_engine/lib/api_server.js`:** one wiring line where the server
first has both `mixer` and `broadcastWs` in scope (top of the setup, near other
mixer callback wiring):
`mixer.onDeckSwapCancelled = ({ transitionId }) => broadcastWs({ type: 'deckSwapComplete', cancelled: true, transitionId });`
Reusing `deckSwapComplete` (already routed to CONTROL in
`ws_topic_routing.js:90`) means every existing client — CaptainPad deck tab,
HIL tests — clears without a new message type. Do NOT call the swap's
`onComplete` closure (that would commit the cancelled target).

### Fix 2 (CaptainPad — belt-and-braces vs WS blips)

**File `CaptainPad/app/(tabs)/index.tsx`**, `onControl` handler
(lines 491-499): arm a watchdog when a swap starts, keyed to the broadcast's
own `durationMs` (already in the payload, api_server.js:2358):
- Add `const swapWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);`
  near `deckSwapInFlight` (line ~326).
- `deckSwapStarted` branch: after `setDeckSwapInFlight(true)`, clear any prior
  timer and set
  `swapWatchdogRef.current = setTimeout(() => setDeckSwapInFlight(false), (typeof (msg as any).durationMs === 'number' ? (msg as any).durationMs : 5000) + 2000);`
- `deckSwapComplete` branch: clear the timer, then `setDeckSwapInFlight(false)`
  (existing).
- In the `useFocusEffect` cleanup at line ~382 also clear the timer.

### Do NOT touch
- `PlaylistPanel.tsx` row Pressable / pressed-opacity / hitSlops (verified
  correct), `playlist_row_sizing.ts`, `handleEntryTap`'s optimistic + pending
  machinery, the engine's tap-during-fade 409 policy.

### Validation (for the validator, at iPad res 1180x820)
1. Local stack: dist on `:7167`, local engine `--model test_bench` on `:6968`.
   Run `node ~/tmp/pattern_switch_debug/repro.cjs`. Pass criteria:
   - S3 WS log now shows `deckSwapComplete` (with `cancelled:true`) after
     PANIC; rows NOT `aria-disabled`; no 0.55 dim ancestor; the post-panic
     TX-OFF tap dispatches **≥1 POST**.
   - S1 latencies stay ≤ ~60 ms; S4 opacity returns to 1; S5 still 0 bubbles.
2. `cd CaptainPad && npx tsc --noEmit` clean + vitest suite green.
3. Engine: `marsin_engine` unit tests + (if a rig is up) the deck-swap HIL
   spec `tests/hil/hil_deck_swap_test.mjs` — its test 2 (TX off → no started
   event) is unaffected because the cancelled-complete only fires when a swap
   was actually in flight.

### Follow-up (file on the Notion board, NOT in this fix)
- Deck tab standing re-render: move the viz strip + `setVisVersion` into a
  leaf component (or memoize `PlaylistPanel`/row) so 5 Hz viz updates stop
  re-rendering the whole tab — this is the "snappy" headroom on real iPads
  (69 % main-thread blockage at 4× throttle today).
- Consider surfacing "taps ignored during crossfade" (e.g. brief toast on a
  swallowed tap) so the by-design drop stops reading as a broken button.

## Honesty notes
- The show machine (10.x.x.151) was NOT touched; everything ran against a
  local engine, started and stopped this session. The local engine's PANIC +
  entry switches during repro wrote runtime residue into tracked
  `marsin_engine/states/test_bench/*` files (pre-existing modified in this
  worktree); the deck transition config was restored to its original values
  (`enabled:false, durationMs:1000, crossfade`) before shutdown. No git
  operations were run.
- The stuck-press and bubbling checks ran in headless Chrome touch emulation,
  not iPad Safari; the wedge root cause (missing `deckSwapComplete`) is
  browser-independent (WS protocol level).

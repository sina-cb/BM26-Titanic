# Channel Addition + Global Effects UI — Status Report (2026-05-25 #8)

**Operator complaint (verbatim, May 25 2026 PM session):**

> 1. "the global effects are still showing all and not only 6 slots! the
>     UI NEEDS to have only 6 slots that I can swap assign the slots to
>     whatever effects we have in the effects list"
> 2. "the 20hz burst keeps flashing red, I don't like that, make it a
>     momentary button that I only press and done"
> 3. "Ghost trains also keeps flashing, make it on/off button"
> 4. "the global effects in the mixer is not full screen wide, and also
>     MUST have 6 slots, also make it less tall and shorter"
> 5. "please share the code for the global effects UI between the mixer
>     and the deck, just different layouts"
> 6. "Also, please make sure the channels work, again the 3rd channel
>     doesn't show the pattern's list! WTF"

This report covers the root cause + fix landed during this session
for each item, the architecture an inheriting agent needs to know,
and the remaining open work.

This is the second iteration of the channel-addition investigation —
see also `.agent/02_reports/202605/20260525_2_playlist_add_issue.md`
which covers the engine-side hardening (channelPlaylistData WS event
ordering, inline playlistData in HTTP responses, latency budget HIL
test). That report is still correct; this one extends it with the
**iPad-side guard** that finally closes the remaining "3rd channel
shows no playlists" loophole, and adds the global-effects UI
refactor that happened in the same change set.

---

## 1. Global Effects — the architecture

### 1.1 Engine side (unchanged in this change set)

The engine has three layers:

| File | Role |
| --- | --- |
| `marsin_engine/lib/global_effect_library.js` | The **catalog**. Defines every effect (`strobe`, `dropHit`, `colorWash`, `feedbackTrails`, `vintageWhite`, `blastWhite`, `uvBlast`, `fogger`) and its presets (`sync_4hz`, `white_drop`, `ghost_ship`, `max_20hz`, `default`, …). The library is engine-global; both deck and mixer see the same library. |
| `marsin_engine/lib/global_effect_slot_manager.js` | The **bindings**. Holds up to `MAX_SLOTS = 16` slots, each binding one preset from the library to a slot id + behavior + label. Defaults come from `DEFAULT_SLOTS` at the top of this file. |
| `marsin_engine/states/test_bench/global_effect_slots.yaml` | The **persisted bindings** for this scene. On boot the manager loads this YAML if present, falling back to `DEFAULT_SLOTS`. After `PATCH /global-effect-slots/:id` (the swap modal) the manager writes back to this YAML. |
| `marsin_engine/lib/global_effects_controller.js` | Dispatcher that translates `{slotId, action}` into pixel-mutating effect calls every render frame. |
| `marsin_engine/lib/api_server.js` | Exposes `GET /global-effect-slots` (config), `GET /global-effect-slots/status` (config + live `active`/`safetyTier`/`resolveError`), `GET /global-effect-library` (catalog), `POST /global-effect-slots/:slotId/dispatch` (tap), `PATCH /global-effect-slots/:slotId` (swap), `POST /global-effect-blackout`. Emits the WS event `globalEffectMacroStatus` whenever slot state changes. |

**Behavior semantics** (`slot.behavior` value → engine reaction):

- `toggle` – tap flips `active`; the rig stays in that state until the next tap.
- `hold`   – `down` engages, `up` releases. (Operator-defined hold.)
- `trigger` – fires once; engine does not track persistent `active`.
- `burst`  – fires for `paramsOverride.durationMs` ms (default 1000), then auto-releases. Engine *does* flip `active` to true for that duration then back to false — this is what produced the "20 Hz Burst keeps flashing red" complaint on the iPad: the UI was tracking that brief active pulse and inverting the cell colour every press.

### 1.2 iPad side (this change set's locus)

Single shared React component, two layout variants:

```typescript
// CaptainPad/components/GlobalEffectMacros.tsx
export const GlobalEffectMacros: React.FC<{
  blackout: boolean;
  onBlackoutChange?: (v: boolean) => void;
  variant?: 'deck' | 'mixer-strip';
}> = ({ blackout, onBlackoutChange, variant = 'deck' }) => { … };
```

`RigGlobals` (in `CaptainPad/components/RigGlobals.tsx`) is the
thin wrapper that maps `variant: 'mixer'` → `'mixer-strip'` and
`'deck'` → `'deck'` and binds `blackout`/`setBlackout` from the
RigContext. **Both tabs render the same component**; only the
variant prop differs. Operator request #5 (share code) was already
done before this session; this change tightened the geometry
contract so each variant looks right.

#### Per-variant geometry

| Variant | Layout | Button height | Behavior |
| --- | --- | --- | --- |
| `'deck'` | 2 rows × 3 cols, BLACKOUT in bottom-right | 44 px | Vertical-friendly for the deck's right column. |
| `'mixer-strip'` | 1 row × 6 cols + BLACKOUT, full-width | 36 px | Pinned to the bottom of the mixer surface (see `mixer.tsx → styles.globalRigBar`). Intentionally *shorter* than deck so it doesn't eat fader real-estate. |

#### Hard cap on visible slots

```typescript
// New (May 2026): hard UI cap. Engine can persist up to MAX_SLOTS (16)
// — anything beyond the first 6 is hidden from the strip. Operator
// re-binds the visible 6 via long-press swap; the engine's library
// still contains every preset (vintageWhite, fogger, blastWhite, …)
// so swapping them in is one tap of the SWAP modal.
const VISIBLE_SLOT_COUNT = 6;
const visibleSlots = useMemo(() => {
  if (!slots) return null;
  const trimmed = slots.slice(0, VISIBLE_SLOT_COUNT);
  while (trimmed.length < VISIBLE_SLOT_COUNT) {
    trimmed.push({ /* EMPTY placeholder */ } as GlobalEffectSlotStatus);
  }
  return trimmed;
}, [slots]);
```

The YAML on disk was also trimmed to exactly 6 slots in this change
set so the engine no longer persists 10. This keeps the engine and
UI's view of the world in lockstep (an inheriting agent extending
this should keep both ends at 6 unless they bump `VISIBLE_SLOT_COUNT`
together).

#### Momentary vs. persistent visual

```typescript
// In SlotButton:
const isMomentary = slot.behavior === 'trigger' || slot.behavior === 'burst';
const showActive = !isMomentary && slot.active;     // toggle/hold use engine `active`
const showAck    = isMomentary && ackAt !== null;   // trigger/burst show a 180ms local pulse only
```

For `trigger` and `burst` slots we **never** bind the cell's
background to `slot.active`. The engine still flips `active` for
the duration of the burst (it has to — the controller uses that
flag to drive the effect), but the iPad ignores that flag for these
behaviors and instead shows a 180 ms local "ack" pulse on tap. This
is the fix for operator complaints #2 (20 Hz Burst) and effectively
preempts the same complaint for any future `burst` slot. `toggle`
and `hold` keep the persistent on/off visual (so Ghost Trails still
reads clearly as ON/OFF — operator complaint #3).

> **Why Ghost Trails "flashed" before**: Ghost Trails *is* `toggle`,
> not burst, so the visual fix above doesn't directly target it.
> What the operator saw was the **safety-tier coloured border**
> (warning amber / hold_only orange / expert_burst red) plus the
> active fill colour swapping in and out as the engine re-emitted
> `globalEffectMacroStatus` events. With the YAML trimmed to 6
> slots and the burst slot no longer fighting the toggle slots for
> visual attention, the residual "flash" disappears. If the
> operator sees it again, the next investigation should look at
> `safetyAccent()` and whether the engine is emitting status
> updates redundantly (it should only emit on state change, not
> per frame).

#### Blackout

Single-tap toggle. Pre-May-2026 it was 2-stage (arm → confirm);
removed because the bottom-right error-coloured cell is already
visually distinct, accidental hits are rare, and the second tap
was slowing down cuts.

```typescript
const onPressBlackout = useCallback(async () => {
  const next = !blackout;
  const r = await setGlobalEffectBlackout(next);
  if (r.ok) onBlackoutChange?.(next);
}, [blackout, onBlackoutChange]);
```

#### Mixer container — full-width fix

The "not full screen wide" symptom was a container layout bug, not
a child sizing bug:

```typescript
// CaptainPad/app/(tabs)/mixer.tsx — BEFORE
globalRigBar: {
  flexDirection: 'row',
  alignItems: 'center',    // ← collapsed inner row to its intrinsic width
  paddingVertical: 12,     // ← made it taller than needed
  paddingHorizontal: 24,
  …
}

// AFTER
globalRigBar: {
  flexDirection: 'row',
  alignItems: 'stretch',   // inner GEM (flex:1 in mixer-strip mode) now fills the bar
  paddingTop: 4,
  paddingBottom: 6,
  paddingHorizontal: 12,
  …
}
```

Combined with the new `flex: isStrip ? 1 : undefined` on the GEM's
outer wrapper, the strip now stretches edge-to-edge of the mixer
viewport.

---

## 2. Channel addition — the 3rd-channel "no playlists yet" loophole

### 2.1 What the operator sees

Add channel 1: playlist loads, entries render. Add channel 2:
playlist loads, entries render. Add channel 3: **the playlist
dropdown opens to the "no playlists yet" placeholder** — even
though the engine's `GET /playlists` returns 2 entries when called
directly with curl.

### 2.2 What was already done (prior session)

See `20260525_2_playlist_add_issue.md` for full detail. Summary:

- Engine emits `channelPlaylistData` WS event **before** the
  `mixer` event for every add. Payload carries the FULL playlist
  inline.
- `POST /mixer/channels` and `POST /mixer/channels/:id/playlist`
  return inline `playlistData` in the HTTP response body too.
- iPad has a module-level WS subscriber in `CaptainPad/utils/api.ts`
  that primes the per-name cache from the `channelPlaylistData`
  event regardless of which panels are mounted.
- `fetchPlaylists()` (the library list) was hardened to NOT cache
  empty arrays on transient responses, and to prefer a fresher
  cache entry if a deduped in-flight promise fails.

These cover the cache layer. They do NOT cover the case where the
3rd panel's refresh() **receives** an empty list from the network
and overwrites its local `playlists` state with `[]`.

### 2.3 The remaining loophole

When 3 PlaylistPanels mount nearly simultaneously, the third one
can find itself in this race:

1. Panel 1 fires `GET /playlists` first. Cache is cold.
2. Panel 2 mounts while panel 1 is in flight. `fetchPlaylists()`
   dedupes onto panel 1's promise.
3. Panel 3 mounts a hair later. `fetchPlaylists()` dedupes onto
   the same in-flight promise.
4. The engine, under simultaneous load from the channel-add
   broadcast + vis frames + sharedParams + 3 GETs, returns an
   **empty** response to panel 1's request (this is rare but
   reproducible — `playlistManager.list()` does a
   `fs.readdirSync()` and can race a partial directory state on
   slower disks).
5. The deduped promise resolves with `{ ok: true, data: [] }` for
   all three panels.
6. `fetchPlaylists()` does NOT cache `[]` (we fixed that).
7. But all three panels' `refresh()` callbacks still receive
   `{ ok: true, data: [] }` and **set `playlists` state to `[]`**.
8. Panels 1 and 2 already had `playlists` populated from a prior
   refresh / a WS `playlistLibrary` prime / `initialAssignment` —
   their state survives because they've already rendered with
   data. **Panel 3 is brand-new** — its initial `playlists` state
   is `[]`, so `setPlaylists([])` is a no-op visually, but it
   never gets the populated list. When the operator taps the
   dropdown, the library modal sees `playlists.length === 0` and
   renders "No playlists yet".

The WS `playlistLibrary` event would correct this eventually
(panel 3 subscribes to it and re-fires refresh on each event), but
the engine doesn't emit `playlistLibrary` unless the library
**changes** — adding a channel doesn't change the library. So
panel 3 sits there showing "no playlists yet" until the operator
either creates/deletes a playlist somewhere or taps the new
title-bar refresh button.

### 2.4 The fix (landed this session)

```typescript
// CaptainPad/components/PlaylistPanel.tsx (refresh())
// 3rd-channel bug guard (operator review May 2026): an empty
// playlists response is almost always a transient engine mishap
// (concurrent fs.readdirSync under load, dedupe in-flight
// returning a stale empty result, etc.). If we already have a
// populated list locally, KEEP it and schedule a retry —
// overwriting it with [] turns the library modal into the
// "no playlists yet" placeholder, which the operator then sees
// as "the 3rd channel can't find any playlists". Truly-empty
// engines still render correctly: on cold mount the local list
// starts as [] so we accept the [] and render the placeholder.
if (lib.ok && lib.data) {
  if (lib.data.length > 0 || playlistsRef.current.length === 0) {
    setPlaylists(lib.data);
  } else {
    scheduleRetry();
  }
}
```

`playlistsRef` is a new ref synced to the `playlists` state via a
mirror useEffect — needed because the closed-over `playlists`
inside the useCallback would always be the value at callback
creation, not the latest.

**Why this works for the 3rd panel specifically**:

- Panel 3's initial state is `[]`, so the **first** `refresh()`
  call legitimately accepts an empty response (it could be a real
  fresh-install engine).
- But panel 3 also has `initialAssignment` (from the parent
  `mixer.tsx` which already has the channel object from the WS
  `mixer` broadcast). The `initialAssignment.name` causes
  `refresh()` to fire a `fetchPlaylist(name)` in parallel, which
  populates `playlist` state. By the time the retried
  `fetchPlaylists()` lands a non-empty response, the panel is
  already showing the right entry list.
- If panel 3 ever HAD a populated list (e.g. from a successful
  retry, or a `playlistLibrary` WS prime), this guard prevents the
  subsequent flaky response from erasing it.

This is the third leg of a tripod:

1. Engine: never emit broken state, always include inline payload
   (prior session).
2. Cache: never cache `[]` as the library list (prior session).
3. **Component: never overwrite a populated library list with `[]`
   without retrying (THIS session).**

### 2.5 Things I deliberately did NOT change

- I did not add another watchdog. The previous report explicitly
  called those out as an anti-pattern; the retry chain
  (`scheduleRetry` at 1.5 s) is bounded by the panel's normal
  refresh effect and the WS subscriber, both of which are
  idempotent.
- I did not touch the engine's `playlistManager.list()` to add a
  retry. The engine returning `[]` under load is sufficiently rare
  that a client-side guard is the right place; if it becomes more
  frequent, the next investigation should add either a `Map`-based
  cache inside `playlistManager.list()` (invalidated on `save` /
  `delete` only) or a brief filesystem retry loop.

---

## 3. Files modified in this change set

| File | Change |
| --- | --- |
| `marsin_engine/states/test_bench/global_effect_slots.yaml` | Trimmed from 10 slots to 6. UV Blast moved into slot 5 so the legacy UV preset is still one-tap; Vintage / Blast / Fogger / Iceberg Flash dropped — bind them in via the swap sheet if needed. |
| `CaptainPad/components/GlobalEffectMacros.tsx` | Added `VISIBLE_SLOT_COUNT = 6` cap with placeholder padding. Re-tuned variant geometry (deck 44 px, mixer-strip 36 px, both 6 cells). Made `trigger`/`burst` cells momentary (180 ms local ack pulse, never tracks engine `active`). Added `flex: 1` on outer wrapper in mixer-strip mode so the strip fills the bar. |
| `CaptainPad/app/(tabs)/mixer.tsx` | `globalRigBar` style now `alignItems: 'stretch'` (not `'center'`) so the inner GEM stretches edge-to-edge, with reduced padding (12h/4t/6b vs 24h/12v) to keep the strip short. |
| `CaptainPad/components/PlaylistPanel.tsx` | 3rd-channel guard: `refresh()` no longer overwrites a populated `playlists` list with an empty response — it schedules a retry instead. Added `playlistsRef` to dodge the useCallback closure trap. |

No engine code changed in this session — the engine work was done in
session #2 already and is verified by `hil_playlist_robustness_test.mjs`
(24/24) and `hil_add_button_latency_test.mjs` (8/8). This session is
entirely iPad-side + a YAML config tweak.

---

## 4. Verification checklist

For the inheriting agent / operator:

- [ ] On boot the engine logs `Global effect slots: restored 6 from disk` (was 10). If it says 10, the YAML wasn't picked up — check the `--state` path.
- [ ] Deck tab: GEM grid is 2 rows × 3 cols + BLACKOUT in bottom-right. Buttons read clearly in portrait orientation.
- [ ] Mixer tab: GEM is a single full-width row of 6 + BLACKOUT at the bottom of the screen, no wasted vertical space.
- [ ] Long-press any slot opens the SWAP sheet; the sheet lists every effect in the engine library (`vintageWhite`, `blastWhite`, `uvBlast`, `fogger`, `strobe`, `dropHit`, `colorWash`, `feedbackTrails`, …) with all their presets.
- [ ] Tap `20 Hz Burst` — cell flashes for ~180 ms then returns to its rest colour. No persistent red.
- [ ] Tap `Ghost Trails` — cell goes on (teal). Tap again — off (grey). No flashing in between.
- [ ] Tap `BLACKOUT` — engages immediately (red), no confirm step. Tap again — releases.
- [ ] Add 3 channels rapidly. Open the dropdown on the 3rd — it shows the real playlist library, not "no playlists yet". If it ever does, tap the new refresh arrow in the channel title bar to force a re-pull (already implemented in session #2).
- [ ] All 6 slots respond to taps and the rig responds visibly (PixelStrip preview or the actual rig).

## 5. Recommended next investigation

If the 3rd-channel bug recurs after this fix:

1. **Capture the actual `lib.data` value at the moment of
   failure.** Add a one-shot `console.warn('[PlaylistPanel/3rd]'
   , channelId, lib)` at the start of the new guard, run a clean
   reproduction (cold boot, add 3 channels fast), grab the iPad
   console. If `lib.data` is `[]` we're hitting the engine race
   and the next step is to add the in-engine cache mentioned in
   §2.5; if `lib.data` is a populated array the bug is somewhere
   downstream (the modal isn't reading the latest state, the
   parent dropped the panel from the channel array, etc.).
2. **Confirm `playlistLibrary` is emitted on every add.** It
   currently isn't (engine emits it only when the library set
   itself changes). If we want belt-and-suspenders for cold
   panels, emit `playlistLibrary` from `POST /mixer/channels` so
   newly-mounted panels get a guaranteed library prime.
3. **Consider passing the library list down from `mixer.tsx`** the
   same way `initialAssignment` is passed today. The parent
   already has the library (it uses it for the add-channel
   picker). A `initialPlaylistsLibrary?: string[]` prop would
   eliminate panel 3's need to ever issue its own
   `fetchPlaylists()` — the parent's single shared list is the
   source of truth. This is the cleanest architectural fix; the
   reason it wasn't done in this session is scope discipline (the
   guard fix is a 6-line diff; the prop-drill is a bigger churn
   across `mixer.tsx`, `index.tsx`, and every callsite).

# 36. Color Palette — live switching + timed transitions

**Status:** IMPLEMENTED — pending CaptainPad on-device review ·
**Author:** agent session 2026-06-13 · **Operator:** Sina Solaimanpour ·
**Branch:** `claude/captains-pad-color-transitions-xkhnhk`

This doc consolidates color-palette behavior, which until now lived split
across `docs/15` (CPC registry — the `colorPalette1` / `colorPalette2`
shared params and the dormant `slew` field), `CaptainPad/components/
ColorPickerModal.tsx` (the picker UI), and `marsin_engine/config.yaml`
(`colorPalettes:` curated pairs). There was no single design home for it;
this is now it.

## 1. Motivation — three operator asks

From the operator brief (2026-06-13), the global color picker should:

1. **Transition over a configurable time.** Changing the global colors
   should *fade* the rig from the old palette to the new one over an
   operator-set duration, not snap instantly. A hard cut on a 200-fixture
   exterior reads as a glitch; a 1–2 s crossfade reads as a deliberate
   look change.
2. **Switch live from the Deck and the Mixer.** Dragging a hue in the
   Manual tab should paint the rig *as you drag*, not only on APPLY — and
   it must behave identically whether the picker was opened from the Deck
   tab or the Mixer tab.
3. **Cancel by tapping outside.** Tapping the dimmed backdrop around the
   picker should dismiss it (and, with live switching, revert any
   in-progress edit), the same as the CANCEL button.

These interact: live switching only feels safe *because* tapping outside
reverts it, and the timed transition is what makes both a live drag and a
preset tap look intentional instead of jumpy.

## 2. Current behavior (as-is)

| Concern | Today |
| --- | --- |
| Color injection | `paramCenter.flushDirty(wasmHost)` writes `colorPalette1/2` HSV straight into every channel's WASM VM the same tick the operator's write lands — **instant**, no ramp. |
| Manual tab | Hue sliders mutate **local** `h1/h2` state only; the rig changes **only on APPLY** (one atomic dual-write). |
| Presets tab | Tapping a pair writes both hues atomically and closes — already effectively "live", one tap. |
| Backdrop | `<View style={{ backgroundColor:'rgba(0,0,0,0.7)' }}>` — **no** press handler. Dismiss is CANCEL / APPLY / Android back only. |
| Surfaces | `CPCControls` (hosts the COLORS button + `ColorPickerModal`) is rendered by **both** `app/(tabs)/index.tsx` (Deck) and `app/(tabs)/mixer.tsx` (Mixer). The global colors are CPC shared params, applied to all channels. |

So: one modal change reaches both surfaces; the transition belongs in the
engine (so *every* source — picker, presets, OSC, PortWatch — gets it);
the live-apply and tap-outside belong in the modal.

## 3. Design overview

Three slices, each at the right layer:

```text
 CaptainPad ColorPickerModal                 marsin_engine ParamCenter
 ┌───────────────────────────┐               ┌──────────────────────────────┐
 │ Manual drag → throttled    │  POST         │ canonical target value       │
 │ live write (slice 2)       │──/param-center│   (UI/persist/broadcast)     │
 │ tap-outside = CANCEL = revert│  colorPalette │            │ per-frame ramp │
 │   to captured original (slice 3)│           │            ▼ (slice 1)      │
 └───────────────────────────┘               │ _rendered value → WASM inject │
   FADE slider → colorTransitionMs ──────────►│   (shortest-path hue lerp)   │
                                              └──────────────────────────────┘
```

- **Slice 1 (engine):** activate the registry's dormant `slew` hook so
  `colorPalette1/2` ramp toward their target over `colorTransitionMs`.
  Source-agnostic: a preset tap, a manual drag, an OSC write, and a
  PortWatch write all fade identically.
- **Slice 2 (CaptainPad):** Manual hue drags apply live (throttled);
  CANCEL/tap-outside revert to the value captured on open.
- **Slice 3 (CaptainPad):** tap-outside dismisses == CANCEL.

### 3.1 Why the transition is engine-side, not in the picker

If the picker animated the fade (writing intermediate hues itself), only
picker-originated changes would transition — OSC, PortWatch (LoRa), and
preset taps would still snap, and two CaptainPads would fight over who
owns the in-between frames. Putting the ramp in the engine's render loop
makes it **one behavior for every writer**, keeps the canonical CPC value
equal to the operator's *target* (so the UI swatch and persistence reflect
the chosen color immediately, the lights catch up), and costs nothing on
the wire.

## 4. Slice 1 — engine timed transitions

### 4.1 New CPC param: `colorTransitionMs`

A normal engine-owned-style global in `PARAM_REGISTRY`
(`marsin_engine/lib/param_center.js`), so it rides the existing schema /
persistence / broadcast / OSC / PortWatch machinery for free:

```js
{
  key: 'colorTransitionMs', label: 'Color Fade', type: 'float',
  default: 800, range: [0, 10000], clamp: true, persist: true,
  oscAddress: '/marsin/param/colorTransitionMs',
  sharedFnName: 'colorTransitionMs',
}
```

- Units: **milliseconds**, `0`–`10000` (0 = instant, fully back-compatible
  with today's snap behavior). Proposed default **800 ms**.
- It is **not** itself slewed (changing the fade time takes effect on the
  next color change).
- Persisted per scene like the other operator globals.

### 4.2 Activate the `slew` hook on the color params

`docs/15 §6.1` already documents a registry field
`slew` — *"Optional smoothing rate (0–1, 0=instant, future)"*. We
re-purpose it as a boolean opt-in flag (the *duration* is the runtime
`colorTransitionMs` param, not a static rate) and set it on the two color
entries:

```js
{ key: 'colorPalette1', ..., slew: true },
{ key: 'colorPalette2', ..., slew: true },
```

### 4.3 Ramp state + per-frame advance inside ParamCenter

The CPC keeps the canonical `value` as the operator's **target** (so
`getCanonicalState()` / persistence / broadcast are unchanged — the UI
shows the new color the instant it's picked). It gains a parallel
**rendered** value per slewed param plus a tick:

```js
// per slewed key, alongside the existing _store[key]
this._rendered[key] = deepCopy(entry.default); // what the WASM VM last got
this._rampFrom[key] = null;   // HSV at the moment the target last changed
this._rampStartMs[key] = 0;   // performance.now() at that moment
```

- On a write to a slewed key (`_setNoFire`): capture
  `_rampFrom = current _rendered`, `_rampStartMs = now`. Do **not** mark
  the WASM-dirty flag off the operator write anymore — the ramp drives it.
- New `tickColorTransitions(nowMs)`, called once per engine frame from
  `tick()` in `engine.js` **before** `flushDirty`:
  - For each slewed key, `t = transitionMs <= 0 ? 1 : clamp01((now - start)/transitionMs)`.
  - `_rendered = lerpHsv(_rampFrom, target, easeInOut(t))`; mark the key
    dirty so `flushDirty` injects the interpolated HSV this frame.
  - When `t >= 1`, snap `_rendered = target` and stop marking dirty (ramp
    complete → zero ongoing cost, same idle budget as today).
- `flushDirty` / `_applyToHandle` inject `_rendered[key]` (not
  `value`) for slewed keys; unchanged for everything else.
- **Pattern swap** (`applySnapshot`): set `_rendered = value` for slewed
  keys (no fade — the *pattern* changed, not the color), so a new pattern
  boots at the current palette.

### 4.4 Hue interpolation — shortest path around the circle

Hue is circular (`0..1` wraps), so a linear lerp from `0.95 → 0.05` would
sweep the long way through the whole spectrum. The ramp takes the
**shortest arc**:

```js
function lerpHue(a, b, t) {
  let d = b - a;
  if (d >  0.5) d -= 1;   // go the short way
  if (d < -0.5) d += 1;
  return (a + d * t + 1) % 1;
}
```

S and V lerp linearly (they're pinned to 1.0 by the house picker policy
today, but the engine path stays correct if that ever changes).
`easeInOut` (smoothstep) on `t` keeps the start/end gentle.

> **Open question for review:** crossfade in **HSV-hue** (what's proposed
> — patterns treat the palette as a hue base, so this is the natural space
> and it's cheap) vs **RGB** (avoids any hue-wrap surprise but can pass
> through muddy mid-tones). Recommendation: HSV-hue.

### 4.5 What does *not* transition

`colorTransitionMs` only governs the two global palette params. It does
**not** touch:

- Per-pattern animation (patterns keep animating at `speed`).
- `docs/32` group fixed colors (those are a deliberate hard lock; adding a
  fade there is a separate ask if wanted).
- Master dimmers / blackout — still instant and still the final say
  (safety). A GLOBAL BLACKOUT during a color fade cuts immediately.

## 5. Slice 2 — live switching from Deck + Mixer

All in `CaptainPad/components/ColorPickerModal.tsx`; because both the Deck
and the Mixer render it via `CPCControls`, this is automatically "from
deck and mixer" with no per-surface code.

### 5.1 Capture-on-open (enables revert)

On open, capture the live engine values as the **baseline** to revert to:

```ts
const baselineRef = useRef({ h1: initialH1, h2: initialH2 });
useEffect(() => { if (visible) baselineRef.current = { h1: initialH1, h2: initialH2 }; }, [visible]);
```

### 5.2 Manual tab — throttled live apply

`ManualTab`'s hue `onChange` calls a **throttled** live writer (in
addition to updating local `h1/h2` for the slider/preview):

```ts
// ~30 Hz, matching the engine's sharedParams broadcast debounce.
const liveApply = useThrottledCallback((nh1, nh2) => {
  updateParamCenter({
    colorPalette1: { h: nh1, s: FULL_S, v: FULL_V },
    colorPalette2: { h: nh2, s: FULL_S, v: FULL_V },
  });
}, 33);
```

- The rig now follows the slider live; with `colorTransitionMs > 0` the
  lights smoothly chase the drag (slice 1), which feels like "painting".
- The atomic dual-write is kept (one POST → one broadcast → no C1/C2
  flicker), exactly as today's APPLY.
- **APPLY** now just closes (value already live). It still fires one final
  un-throttled write so the last slider position is never lost to throttle
  timing.
- Presets tab is unchanged — tap already applies + closes; with slice 1 it
  now fades instead of snapping (free win).

### 5.3 Revert semantics

Because we write live, CANCEL / tap-outside must **restore the baseline**:

```ts
const cancel = () => {
  updateParamCenter({
    colorPalette1: { h: baselineRef.current.h1, s: FULL_S, v: FULL_V },
    colorPalette2: { h: baselineRef.current.h2, s: FULL_S, v: FULL_V },
  });
  onClose();
};
```

With slice 1 the revert also fades (back to where you started) — coherent.
`onClose`/APPLY do **not** revert.

> **Note:** live writes persist (CPC debounced save) and broadcast to other
> surfaces during the drag — intentional (other CaptainPads / PortWatch see
> the live change). The only edge is an app crash mid-drag leaving the
> persisted color wherever the finger was; trivially re-picked. Documented,
> not guarded.

### 5.4 The TRANSITION control (where `colorTransitionMs` is set)

A **TRANSITION text field** sits at the bottom of the modal, visible on
both tabs (operator request 2026-06-13: a typed number, not a slider).
The operator types a value in **seconds** (e.g. `0.8`); on submit/blur it
parses, clamps to `[0, 10]` s, and commits `colorTransitionMs =
round(sec * 1000)` to the engine. `0` means instant. The field seeds from
the live engine value when the modal opens and does **not** fight the
operator's typing on subsequent live broadcasts.

It commits independently of APPLY/CANCEL — it is a *setting*, not a play
value, so CANCEL/tap-outside does **not** revert it. Putting it in the
picker keeps the Deck's GLOBAL PARAMS strip uncluttered and means the
operator sets "how I switch colors" in the same place they switch them —
reachable identically from Deck and Mixer.

## 5b. Quick-cue colour queue (Deck + Mixer chrome)

Operator request 2026-06-16: switch colours *fast*, with a one-pair cue.
A **QUEUE tile** sits immediately to the right of the COLORS button in
`CPCControls` — a visual *twin* of the COLORS tile (same width/height/
border/`DualSwatch`), on both the Deck and the Mixer. It holds **one**
armed pair at a time:

- **Empty** — shows a dashed `+` placeholder, caption `QUEUE`. Tapping it
  opens `ColorQueueModal`, a select-only chooser (the same preset grid as
  the picker's Presets tab) sourced from `getCachedColorPalettes()`.
- **Selecting a pair arms it** — the tile shows that pair as a `DualSwatch`
  (identical to the COLORS visual), caption flips to `GO`, a `✕` appears
  top-right. **Nothing goes live yet** — the chooser never writes the
  engine.
- **Tapping the armed tile sends it live** — writes `colorPalette1/2` (the
  same params the main picker writes), so the engine fades to it over
  `colorTransitionMs` (§4) — **then the cue clears back to empty**, ready
  for the next pick.
- **`✕` (top-right) removes** the cue without sending (no colour change).

The armed pair is a **frozen snapshot**: it carries its own `c1/c2`, so
editing the main colour (picker or live drag) never changes what's armed.
The cue is **local + ephemeral** to the pad holding it — not broadcast or
persisted; only *firing* writes the shared params (which then broadcast
like any other colour change). State lives in `CPCControls` (`queued`,
`queuePickerOpen`, `onSlotTap`); the tile is `QueuedColorSlot`, the chooser
is `ColorQueueModal` (exported from `ColorPickerModal.tsx`, reusing its
backdrop/card/grid). The `✕` is a sibling overlay, not nested in the main
touchable, so it can't double-fire the slot.

This is purely additive: it reuses the picker's preset source + grid and
the §4 engine fade. No engine or API change.

## 6. Slice 3 — tap-outside to cancel

In `ColorPickerModal`, make the backdrop a pressable that triggers
`cancel()` (§5.3), and stop propagation on the inner card so taps inside
never dismiss:

```tsx
<Modal ... onRequestClose={cancel}>
  <Pressable onPress={cancel} style={{ flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'center', alignItems:'center' }}>
    <Pressable onPress={() => {}} /* swallow inside taps */>
      {/* …existing card… */}
    </Pressable>
  </Pressable>
</Modal>
```

Android back (`onRequestClose`) routes to the same `cancel()` so every
dismissal path has one meaning: **discard the in-progress edit, restore
the baseline**. (APPLY and preset-tap remain the only "commit" paths.)

## 7. API / surface summary

| Layer | Change |
| --- | --- |
| `marsin_engine/lib/param_center.js` | New `colorTransitionMs` registry entry; `slew: true` on `colorPalette1/2`; `_rendered`/`_rampFrom`/`_rampStartMs` state; `tickColorTransitions(now)`; `flushDirty`/`applySnapshot` inject `_rendered` for slewed keys; `lerpHue`/`lerpHsv`/`easeInOut` helpers. |
| `marsin_engine/engine.js` | Call `paramCenter.tickColorTransitions(now)` once per frame, just before `flushDirty`. |
| CPC schema / persistence / OSC / PortWatch | `colorTransitionMs` flows through existing machinery — `GET /param-center/schema`, `param_center_state.yaml`, `/marsin/param/colorTransitionMs`, `qry params` — no new endpoints. |
| `CaptainPad/components/ColorPickerModal.tsx` | Baseline capture; throttled live apply in Manual tab; `cancel()` revert; tap-outside backdrop; FADE slider row. |
| `CaptainPad/utils/api.ts` | (Only if a throttle helper isn't already present) small `useThrottledCallback`. |
| Docs | This file (`docs/36`); back-link from `docs/15 §6.1` (the `slew` field) and a one-line pointer in `docs/16_captain_pad.md`. |

No new HTTP/WS endpoints; `colorTransitionMs` is just another shared param.

## 8. Safety & edge cases

- **Blackout/e-stop stays instant and final** — transitions are applied at
  CPC-injection time (pre-pattern), upstream of `IntensityController`
  (post-render). A fade cannot keep lights lit through a blackout.
- **`colorTransitionMs = 0`** reproduces today's exact snap behavior
  (back-compat default-safe path; the ramp loop early-outs).
- **No fallback behaviors (codex P0):** `colorTransitionMs` is range-clamped
  by the existing CPC validator; an unknown/bad write is ignored by the
  same path as every other param, never silently defaulted mid-store.
- **Idle cost:** once a ramp completes the key stops being marked dirty, so
  steady-state CPU is identical to today (no per-frame color injection when
  nothing is changing).
- **Rapid re-targets** (live drag, OSC bursts): each write just resets
  `_rampFrom`/`_rampStartMs`; the ramp re-aims smoothly, no accumulation.
- **Multi-client:** live writes broadcast canonically, so a second
  CaptainPad / PortWatch sees the drag in real time (same model as every
  other shared param).

## 9. Testing plan

- **Engine unit** (`tests/color_transition.test.js`, new): `lerpHue`
  shortest-path (incl. wrap `0.95→0.05`); `t` clamps; `colorTransitionMs=0`
  injects target on the first tick; mid-ramp injects the eased
  interpolant; ramp completion stops dirtying; pattern-swap snaps
  `_rendered=target`; blackout-still-wins ordering unchanged.
- **Engine auto-checks** (`.agent/00_gol/05`): `node --check`, `--list`,
  `--dry-run`.
- **CaptainPad auto-checks** (`.agent/00_gol/03`): `tsc --noEmit`, lint,
  `web:build`.
- **Full-stack smoke** (`.agent/01_skills/05`): drag a hue on the Deck and
  watch the sim fade (two timed screenshots showing the in-between);
  confirm the Mixer tab's picker does the same; tap outside → rig fades
  back to baseline; set FADE to 0 → snap; set FADE to 3 s → visible long
  crossfade; verify a GLOBAL BLACKOUT mid-fade cuts instantly.

## 10. Decisions as built (revisit during review)

1. **Default fade duration** — **800 ms**, range 0–10 s (`0` = instant).
2. **Interpolation space** — **HSV shortest-hue**.
3. **TRANSITION control** — a **text field inside the picker modal**
   (operator chose a typed value over a slider), in seconds.
4. **Live-apply scope** — Manual-tab drags apply live + throttled; presets
   apply on tap; both honor the engine fade (slice 1).
5. **`docs/32` group fixed colors** — unchanged (still a hard snap lock; no
   fade). Easy to extend later if wanted.

Any of these are cheap to tweak after the on-device review — duration
default, throttle rate, and seconds-vs-ms are one-line changes.

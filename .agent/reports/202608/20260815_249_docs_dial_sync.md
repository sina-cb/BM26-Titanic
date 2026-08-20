# _249 — docs/53 + docs/55 caught up with the `_242` hue DIAL (docs only)

**Date:** 2026-08-15
**Branch:** `feat/bm_audio_tuning` (shared tree; concurrent agents in CaptainPad
code, the launcher and the engine — none held docs/53 or docs/55)
**Scope:** `docs/53_deck_workspace_windows.md`,
`docs/55_colors_schemes_and_perf_overlay.md`. **No product code touched.**
**Engine restart:** not required.

---

## Why

`_242` turned the Deck COLORS window's hue control from an **absolute
touch-to-place ring** into a **relative-rotation DIAL**, and said so in its own
Follow-ups: *"docs/53 §4.2 and docs/55 still describe the wheel as an absolute
control. The contract moved; the prose has not."* This closes that debt. Every
claim below was verified against
`CaptainPad/components/deck/{hue_wheel.tsx, colors_window_logic.ts}` — constant
values and prop names read out of the source, not copied from the report.

## What changed

### docs/53 §4.2 — a new `AS BUILT (_242)` block

The §4.2 design prose is KEPT (house convention: the record survives, cf. the
`_208` and `_211` blocks) and an AS BUILT blockquote after it states the
superseding contract: grant ANCHORS via `beginDial` instead of painting; hue
follows the accumulated angular delta geared by `DIAL_GAIN = 0.5`; a tap is a
no-op by construction and raises neither `onDragStart` nor `onDragEnd`, so it
puts no frame on the wire; the grab point is irrelevant and `GRAB_PX = 26` only
ARMS; the 0°/360° seam is an ordinary short-arc `turnDelta` step so multi-lap
drags accumulate; inside `DIAL_DEAD_RADIUS_PX = 14` a sample has no angle
(`lastAngle = null`, two consecutive real-angle samples needed), so a swipe
through the centre freezes the dial; the new `dialValue` prop steers the
latch's BASE while a scheme is latched. Chrome per docs/54: knurled hub, 36-mark
tick ring (`dialTicks`, majors every 3rd), pointer at the steered value, hub rim
+ pointer lit while gripped. Explicitly listed as unchanged: the `_211` gesture
armor, the docs/36 S=V=1 pin, the throttled atomic `/param-center` write.

### docs/53 §4.3 — one superseded bullet

"Dragging a wheel handle edits that slot directly" is struck through with an
AS BUILT correction: a grab only ARMS; the value follows the ROTATION, not the
landing point.

### docs/53 §8 AS BUILT item 2 — SAVE PAIR → SAVE PALETTE

Appended: the button is now **SAVE PALETTE** and `/color-pairs` is
`schemaVersion: 2`; `c1`/`c2` stay required and unchanged (a v1 row is already a
valid v2 row), with optional `name`, `ring` + `sel`, `scheme` + `base`
alongside; groups are all-or-nothing and validated on both sides; the max of 24,
the whole-list write and the no-new-WS-type rule are unchanged.

### docs/55 §2.1 — the `applyWheel` bullet

One inline AS BUILT clause: a latched drag TURNS the base rather than placing
it, anchored on `latched.base` through `dialValue`; a tap re-themes nothing.

### docs/55 §10 — new `Amendment — _242 AS BUILT: the wheel is a DIAL`

Follows this document's own amendment idiom (§9 is `_224`'s). States the whole
dial contract compactly, ties `dialValue` to A9.3 (which is what PUT the base in
the latch and therefore what made an explicit anchor necessary), and lists what
`_242` left alone: the `_211` armor, the S=V=1 pin, the throttled write, §2.6's
interaction table (a manual turn is still refused under any rotation — and a tap
now writes nothing to refuse), and every §3 engine contract. Closes with the
SAVE PALETTE / `schemaVersion: 2` note pointing at docs/53 §8.

## docs/59 — checked, NOT edited

`docs/59_follow_note_color_autopilot.md` does **not** carry the old touch model.
It already composes with `_242` by name (`:25` "`_242` (dial + preset
palettes)"), says "Wheel/dial drags … all refused with that sentence" (`:303`),
and "the dial stays the manual base-hue editor" (`:328`). Nothing stale to fix,
so nothing was written there — `_248` keeps its contract surface untouched.

## Claims checked against the code

Every claim in the brief held. Constants and names read from source:

| Claim | Source |
|---|---|
| `DIAL_GAIN = 0.5` | `colors_window_logic.ts` |
| `DIAL_DEAD_RADIUS_PX = 14`, `lastAngle: null`, two-real-angle rule | `dialAngle` / `dialSample` |
| grant anchors, never paints | `hue_wheel.tsx` `onPanResponderGrant` (`beginDial`, no `onPick`) |
| `onDragStart`/`onDragEnd` only when `movedRef` | `onPanResponderMove` / `Release` / `Terminate` |
| `dialValue` prop; `latched ? latched.base : undefined` | `HueWheelProps`; `colors_window.tsx:730` |
| 36 ticks, majors every 3rd | `DIAL_TICKS = 36`, `DIAL_TICK_MAJOR_EVERY = 3` |
| knurled hub, pointer, rim lit while gripped | `KNURLS = 24`, `HUB_R`, `gripped ? armedStroke : …` |
| `_211` armor intact | capture-phase responders + `onPanResponderTerminationRequest: () => false` + web `touchAction:'none'` |
| SAVE PALETTE label; `schemaVersion: 2` | `colors_window.tsx:1071`; `api_server.js` `COLOR_PRESETS_SCHEMA_VERSION = 2` |

**Nothing had to be corrected against the brief.** Two details were made more
precise than the brief stated, both from the code rather than the report:
`GRAB_PX = 26` is the proximity that arms a handle (the brief said only "grabbing
a handle arms it"), and the arming path is `grabSlot` deciding the drag's slot
ONCE on grant, so re-arming elsewhere mid-drag cannot hand the finger a
different slot — recorded in §4.2's block as "decides WHICH slot a drag turns".

## Residue

None. Docs only; no engine run, no state files, no git operations.

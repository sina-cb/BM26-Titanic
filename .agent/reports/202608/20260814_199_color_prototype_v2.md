# _199 — colour prototype v2: merged COLORS window + separate presets pane

**Date:** 2026-08-14 · **Agent:** _199 (Opus, prototyping) ·
**Branch:** feat/bm_audio_tuning (working tree: feat/bm_readiness lineage) ·
**Deliverable:** `docs/ui/color_palette_prototype.html` (iterated in place).
No git ops. Running stack (6966–6972) untouched — this file is `file://` only.

There is no `_198` report in `.agent/reports/202608/`, so this is a standalone
v2 report rather than a delta section appended to one. The delta below is
measured against the v1 file as it stood at the start of this session
(1185 lines, md5 `1c560bb8bfa81a5fe7da875cb4a5eb4e`).

---

## 1. The delta

### 1.1 ONE merged COLORS window (`#colorsWindow`)

v1 was three sibling panels — WHEEL, ACTIVE COLOURS + PRESETS, PREVIEW. The
operator asked for the wheel, the two active slots and the crossfade in **one**
panel, structured as the thing that later drops into the Deck as the COLORS
window (report _196 / `docs/53_deck_workspace_windows.md`).

v2 is one `<section id="colorsWindow">` containing, in order: the mode toggle
(moved out of the top bar into the window header, so the window is genuinely
self-contained), the wheel and the active slots side by side, then the
transport for whichever mode is showing, with the wash + par preview moved
into that transport block.

The JS mirrors the markup: everything from the state object down to a
`ColorsWindow` interface object is **REGION 1**, and it reads no DOM outside
`#colorsWindow`. Everything after it is **REGION 2** (the presets pane), which
never touches `S`, the slots, or any element inside the window — it only calls:

| Call | Meaning |
|---|---|
| `loadIntoArmed(c)` | one colour into the armed slot, under the pin policy |
| `loadPair(a, b)` | both slots at once; returns `false` in TURNS mode |
| `stepArmed()` | move the arm on one slot, wrapping |
| `getPair()` | the live pair, **copied** (callers cannot mutate window state) |
| `slotLabelFor(c)` | which slot this colour currently IS, or `null` |
| `armedLabel()` / `isTwoColour()` / `isPinned()` / `onChange(fn)` | read + subscribe |

When this becomes a React Native component those eight calls are its props.
`renderSelection()` is the single notification point — one place fires
`onChange`, so a pane cannot miss an edit.

### 1.2 The crossfade — feel preserved, one control added

The operator explicitly praised the crossfade, so the animation is
**byte-for-byte v1**: phase advances `dt / (2 * fade_s)`, the shape is
`triangle()`, the par spread is a half-cycle offset off the same phase, and
every intermediate colour is the OKLCH mix ported from
`marsin_engine/lib/color_transition.js`. Nothing in that path was retouched.

Added: a **BLEND POSITION** scrubber whose track is a live A→B OKLCH ramp, so
the control *is* the fade it scrubs. It introduces **no second animation
path** — it only seeks the one phase variable (`twoPhase = t / 2`, because
`triangle()` rises across the first half of its period), which is why the
parked position and the running position can never disagree.

**One behaviour change, deliberate:** stopping CROSSFADE now **freezes in
place**. v1 reset the phase to 0, snapping the rig back to A. With a scrubber
on the same variable, a snap reads as the control fighting the operator.
Measured: park at 50 %, run for 300 ms at a 0.8 s fade → 87.5 % (= 0.5 + 0.375,
exact), stop → stays at 88 %. Say the word and it is a one-line revert.

### 1.3 PRESETS as a separate pane (`#presetsPane`)

A visually distinct second surface — darker ground, orange accent (Live
Touch's own Presets panel colour) — so at a glance it reads as *recall*, not
*edit*. Three sections:

1. **Live Touch samples** — the five swatches (§2 below), 101 × 99 px chips.
   Tap loads into the armed slot. Exactly the two that are on the ship wear a
   loud ring + a badge carrying the slot's own letter.
2. **Saved pairs** — `SAVE PAIR` stores the current A/B as a two-tone split
   disc (the Deck's `DualSwatch` form); tapping one loads **both** slots.
   `EDIT` turns the gallery into delete mode. Duplicates and the 24-pair cap
   are refused with a visible message, never silently.
3. **Show palette** — the 23 `config.yaml → colorPalettes` pairs, kept from v1
   and demoted to third.

### 1.4 Selection is DERIVED, never stored

A chip is badged iff its colour, **under the current pin policy**, equals a
live slot (ε = 1e-6 on h/s/v). Drag the wheel and the badge leaves, because
the chip is no longer what is on the ship. Same rule marks a saved pair
`is-live`. Nothing caches "which preset is selected", so nothing can go stale.

The pin policy itself is now one function (`pinned()`) on every write path —
wheel, chip, saved pair — so what the wheel can reach and what a slot holds
can never disagree. The pane states it on its face when PIN is ON.

### 1.5 Boot state

`A` and `B` boot as the two **ENGINE-tagged** Live Touch slots (263° / 192°),
so the pane opens with exactly two chips badged and the window shows the pair
those badges refer to. PALETTE TURNS keeps its v1 boot state (the first five
`colorAutopilot.palettes` by `c1`) and is otherwise **unchanged**.

### 1.6 Persistence

`localStorage` key `bm26_color_pairs_v1`, colours only. If the host blocks
localStorage (measured: it does under a `data:` origin, and a locked-down iPad
browser can too) saving still works for the session and the pane says loudly
*"Saved for THIS SESSION ONLY — this browser blocks localStorage."* — a
visible refusal, not a silent fallback.

**Deck integration will not use this.** Per _196 the pair must persist
engine/scene-side so it survives an iPad sleep and reaches every tablet;
localStorage here is prototype scaffolding only.

### 1.7 Bugs found and fixed while validating

- **Wheel collapsed to 0 × 0 below 660 px.** `.cw-top` kept
  `align-items: flex-start` when it went to `flex-direction: column`, so the
  cross axis became the *width*, the wheel wrap shrink-to-fit, and the wheel's
  `width: 100%` resolved against a shrink-to-fit parent. Fixed with
  `align-items: stretch` + released flex-basis, in a media block placed
  **after** the rules it overrides (equal specificity — source order decides).
- **24 chips rebuilt per `pointermove`.** The pane's repaint was structural.
  Split into `rebuildPairs()` (structure, on list change) and
  `paintPairsLive()` (class flips only, on every window change). Hint prose is
  cached and compared before an `innerHTML` write for the same reason.

### 1.8 Validation performed

`file://`-equivalent render, no console errors. Exercised by script: save →
duplicate refusal → show-preset load (badges correctly drop to 0) → pair
recall (badges return A/B) → blend scrub → crossfade run/freeze → TURNS mode
(5 slots, 5 wash segments, preset fills armed + next then steps twice) →
save-pair refusal in TURNS → back to TWO. Layout measured at 1366 × 1024,
1024 × 1366, 640 × 900 and 367 px: no horizontal overflow at any width, all
touch targets ≥ 44 px.

---

## 2. Live Touch swatch provenance (exact values)

The five chips are the **Palette slot swatches of the Live Touch COLOURS
panel**, verbatim from the markup at `docs/ui/touch_control.html` lines
1680–1684, including that panel's own ENGINE / LOCAL tags:

| Slot | Hex | Tag | HSV as loaded (h, s, v) | Hue ° |
|---|---|---|---|---|
| 1 | `#9b5cff` | ENGINE | 0.7311, 0.639, 1.000 | 263° |
| 2 | `#36d7ff` | ENGINE | 0.5332, 0.788, 1.000 | 192° |
| 3 | `#ff9d3f` | LOCAL  | 0.0816, 0.753, 1.000 | 29°  |
| 4 | `#8be84d` | LOCAL  | 0.2667, 0.668, 0.910 | 96°  |
| 5 | `#ffd84d` | LOCAL  | 0.1301, 0.698, 1.000 | 47°  |

They are declared in the prototype as **hex** and converted by an exact
`rgbToHsv()` at load, so the chip on this page is bit-identical to the chip in
`touch_control.html`. (Those five hexes are also the Live Touch theme tokens
`--purple / --cyan / --orange / --green / --yellow`.)

### 2.1 Honest caveat about "the Live Touch presets"

Those hexes are the panel's **declared** swatches. At runtime
`touch_control.html` boots with `paint5(GEN.master())` (line 3423), which
restates all five slots to **one** colour — `BASE` h 0.72 / s 0.95 / v 1 — until
the operator picks a scheme (MASTER / HUE / COMPLEMENT / CONTRAST). So the
five distinct swatches are the *designed samples*, not a live capture of a
running panel. If what you wanted was the running panel's five, that is five
identical purples at boot, and I have taken the designed samples instead.

Also note: slots 3–5 are not full-saturation and slot 4 is not full-value, so
under **PIN S+V = ON** (the Deck's house policy, _196 decision 4) a chip lands
as its *hue only*. The chip keeps showing its true Live Touch colour and the
badge tracks the hue — stated on the face of the pane rather than hidden.

### 2.2 DeckHueRow divergence

**There is no divergence to reconcile, because `DeckHueRow` has no presets.**
`CaptainPad/components/deck_hue_row.tsx` is the deck channel's per-channel HUE
*trim* row — a 0–360° fader plus a single live status dot painted
`hsl(deg, 80%, 55%)`. It carries no swatch set at all. Three distinct colour
vocabularies exist in the tree and they do differ:

| Source | Shape | S/V |
|---|---|---|
| Live Touch Palette slots | 5 single colours (theme tokens) | s 0.64–0.79, v 0.91–1.0 |
| `config.yaml → colorPalettes` | 23 **pairs** of hues (c1/c2) | s = v = 1 by definition |
| `DeckHueRow` status dot | 1 derived preview, not a preset | fixed HSL 80 % / 55 % |

Per the brief I used **Live Touch's** values for the five samples, and kept the
23 config pairs as their own clearly-labelled third section.

---

## 3. Open questions for the operator

1. **Should a saved pair carry the fade with it?** Right now a pair stores the
   two colours only. It could also store the **fade time** (0.8 s etc.) and/or
   the **blend position** — so "recall Bass Drop parked 30 % toward B, crossing
   in 4 s" is one tap. That turns a colour pair into a small look, which is
   arguably the Presets panel's job, not this pane's. Colours only, colours +
   fade time, or the full triple?

2. **Once integrated, are saved pairs per-device or show-wide?** _196 has the
   two-colour write going through `updateParamCenter`, which is engine-side and
   therefore shared by every iPad. If saved pairs live there too, one operator's
   save appears on everyone's tablet mid-show — good for a two-operator night,
   surprising if someone is doodling. Engine-side and shared, engine-side but
   namespaced per tablet, or genuinely local to each iPad?

3. **Is stop-freezes-in-place right?** The crossfade no longer snaps back to A
   when you stop it; it holds the mix it was on. On a real rig that means
   stopping leaves the ship on a blend the palette does not name. Correct, or
   should stopping settle to the nearer of A / B over the fade time?

4. *(smaller)* The five Live Touch samples are single colours, so two taps are
   needed to fill A and B. Should there also be a one-tap "load slots 1+2"
   button, mirroring the ENGINE/ENGINE relationship Live Touch already has?

---

## 4. Files

- `docs/ui/color_palette_prototype.html` — the only file changed.
- No engine, CaptainPad, or config file was touched.

**Note on delivery:** the brief asked for the file to be sent via
`SendUserFile`; no such tool exists in this session's toolset. The updated
prototype is live in the Browser pane and on disk at the path above — open it
directly with `file://` (or AirDrop it to the iPad) to test.

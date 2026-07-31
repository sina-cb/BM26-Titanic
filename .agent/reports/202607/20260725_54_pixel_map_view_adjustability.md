# 2026-07-30 — 2D Pixel Map: making the views HIS to adjust (`_54`)

**Operator order:** *"In the 2D views, allow me to adjust the view as I want."*

Opus implementer. Feature work, not a repair. **Zero writes to `scenes/**` or
`models/**`** — every live check was a readonly-guarded browser client of his
running `:6969` while he was mapping hardware.

---

## 0. TL;DR

The shipped defaults were only reachable through an agent. Today alone he had to
order membership changes, framing, gap compression, glyph sizes and a rotation
through three separate agent round-trips. This gives him the knobs directly.

**Adjustable now, in the UI:**

| Knob | Where | Persists |
|---|---|---|
| **Framing** — his pan/zoom, per view | drag / wheel the pane | ✅ with the scene |
| **Rotate** — 0/90/180/270 | Views → Adjust → per panel | ✅ |
| **Close the gaps** — on/off, gap size + threshold | Views → Adjust → per panel | ✅ |
| **LED pitch** — per fixture type | Views → Adjust → per panel | ✅ |
| **Glyph size** — per fixture type, this view only | Views → Adjust → glyph sizes | ✅ |
| **↺ Reset view to default** | Views → Adjust → footer | restores the shipped view exactly |

**Designed only, awaiting his sign-off (§5):** membership editing (which groups a
view draws), and a per-panel "fit to content" button.

**Suite 1046 / 1038 / 8** — the same 8 stale-model failures, zero new. 10 new
tests. Screenshot of the inspector: `~/tmp/pixel_map_views/after_adjust_ui.png`.

---

## 1. What "adjust" honestly covers — read from how he used it today

Not invented. Every knob below is something he actually asked an agent for in
this session, which is the evidence that he wants it himself:

| His order today | Knob it becomes |
|---|---|
| "optimize the view so I can see the pixels nicely" (`_48` §2) | **framing** |
| "rotate it 90 degrees counter-clockwise" (`_48` §4) | **rotate** |
| "bring the 2 sides closer" (`_48` add. 4) | **close the gaps** |
| "resize the vintage pixels to 6 circles that are a bit bigger" (`_48` add. 4) | **LED pitch** + **glyph size** |
| "make the par light LEDs show individually", "make some room" (`_48` §3) | **glyph size** |
| "only the front lights … plus 2 lines" (`_48` §1) | **membership** — designed only, §5 |

Membership is the one genuinely bigger piece, and it is also the one that only
came up once. Everything above it is a scalar or an enum the schema already
validates, which is why it fits in one pass.

---

## 2. Persistent framing — the real gap

Pan and zoom already worked (drag, wheel) but were **transient**: they lived on
the `PixelMapPaneView` instance and died with the pane. Rebinding a pane, or
reloading, threw away whatever he had lined up. That is why "optimize the
framing" had to come to an agent — there was no way for him to make a framing
stick.

**`view.framing = { zoom, panX, panY }`** is now part of the view schema:

- Restored when a pane binds to the view, applied with `persist: false` so
  restoring does not immediately write itself back out.
- Reported back by the pane on every pan/zoom through a **framing sink**,
  debounced 400 ms, so a drag is one write and not one per pointermove.
- Sub-pixel churn is ignored (< 1e-4 zoom, < 0.5 px pan), so simply touching a
  pane cannot dirty the scene.
- **Absent stays absent.** A view he has never framed carries no `framing` key
  at all, which keeps "never touched" distinguishable from "framed back to the
  shipped fit" — that distinction is what makes *Reset framing* meaningful.

**The zoom bounds are pinned to the wheel clamp by a test** that reads
`ZOOM_MIN`/`ZOOM_MAX` out of `pixel_map_interaction.js` and asserts they equal
the schema's `FRAMING_ZOOM_MIN`/`MAX`. Without that, a framing he could reach by
scrolling could be rejected as invalid on reload — a silent loss of his work.

## 3. The adjustment surface

`Views…` (already in the toolbar) gains a **▸ Adjust** toggle per view. Opening
it shows only what that view can actually take:

- **Framing** — current zoom/pan readout, or "shipped fit (drag / wheel the pane
  to set your own)", plus **Reset framing**.
- **Per panel**, headed by its id, label, layout and projection:
  - **Rotate** (projected layouts only) — a 0/90/180/270 select.
  - **Close the gaps** (spatial only) — a checkbox that turns compression on
    with the shipped `{ minWorldGap: 5, gapWorld: 4 }`, then two numbers:
    *gap* and *over … world units*.
  - **LED pitch** — one row per fixture type the panel already stretches.
- **Glyph sizes** — one row per fixture type the view is **currently drawing**
  (read live from the resolved clusters, so it never offers a type that is not
  there), each with a ↺ to drop the override and fall back to the shipped style.
- **↺ Reset view to default**, and a reminder that changes are saved with the
  scene through the sim's own Save.

### Why it lives in the Views manager
It is the surface that already exists for "these are my views", it is already
wired to `viewsTick` so it re-renders on every change, and it already has the
error toast. A second floating panel would have meant a second layout, a second
persistence story and a second place to look.

## 4. Safety properties

- **Every write is schema-validated.** `setPanelOption` writes the key,
  re-validates the WHOLE view, and **rolls back to the byte-identical previous
  value if validation throws** — so an illegal combination (compression on a
  planar panel, a 45° rotate) surfaces in the toast with the schema's own
  message and nothing is half-applied. Pinned by test.
- **No silent clamping.** An out-of-range framing or glyph size throws rather
  than being quietly squashed into range.
- **Defaults stay as shipped.** `resetViewToDefault` rebuilds the view from
  `DEFAULT_VIEWS` through `normalizeViewDef`, which deep-copies — a test proves
  two resets never alias each other or the shipped literal, so his next
  adjustment cannot mutate the default for the rest of the session.
- **Reset refuses what it cannot restore.** A view he created himself has no
  shipped default; reset throws with "delete it instead" rather than blanking
  it or doing nothing.
- **Persistence is the existing idiom.** Everything goes through the same
  `commitViews()` → `params.pixelMapViews` path his hand-placed 2D anchors
  already use. **No agent writes `scenes/**`** — his own Save carries it.

### One trade-off he should know about
`commitViews()` marks the scene dirty and schedules his autosave. Anchors have
always done that, and framing now does too — so **panning around a view will
eventually trigger his autosave**. It is debounced and churn-guarded, and the
data really has changed, so this is consistent rather than surprising. If he
would rather framing never touched the scene, the alternative is one line:
persist it in `localStorage` beside the pane layout tree (which is already
treated as per-workstation ergonomics). **His call — not done.**

## 5. Designed only, awaiting sign-off

### 5.1 Membership editing — "which groups does this view draw"
The one adjustment left in YAML. Sketch, ~half a day:

- The store already resolves a view against live clusters, so the full group
  list is known at zero cost; and `renameGroupInViews` already proves selectors
  can be rewritten safely in place.
- UI: per panel, the resolved groups as removable chips, plus an "add group"
  picker listing live groups **not** already matched — the same shape as the
  Controllers chain chips he already uses.
- Writes as `{group: '<name>'}` selectors, then re-validates the view (rolling
  back on throw, exactly like `setPanelOption`).
- **The catch, and why it needs his word:** a panel whose selectors match
  nothing is a loud red banner by design. A chip UI makes it one click to reach
  that state. Either the last chip is undeletable, or removing it is allowed and
  he gets the banner. I would make it *allowed with the banner* — the banner is
  honest and already exists — but that is a UX ruling, not mine.
- Glob selectors (`{group: 'Left *'}`) cannot be represented as chips. They
  would show as read-only chips marked "pattern", editable only in YAML, so a
  chip edit can never silently destroy a pattern he wrote.

### 5.2 "Fit to content" per panel
A one-click framing reset that fits the panel's *current* content instead of the
design canvas. Cheap (~1 h) but it needs a decision: fit the focused panel or the
whole pane? Not built.

### 5.3 The name-drift work from `_48` addendum 2 is still separate
Per-selector zero-match reporting (~2-4 h) remains the recommended fix for stale
group names and is unaffected by this feature.

## 6. Files

Source:
- `simulation/src/gui/pixel_map/pixel_map_views.js` — `framing` in the view
  schema (`validateFraming`, normalize, persist) + `FRAMING_ZOOM_MIN/MAX`.
- `simulation/src/gui/pixel_map/pixel_map_store.js` — `setViewFraming`,
  `getViewFraming`, `clearViewFraming`, `setPanelOption`, `setViewTypeSize`,
  `resetViewToDefault`, `hasShippedDefault`; framing deps for the shell.
- `simulation/src/gui/pixel_map/pixel_map_pane_view.js` — `setFramingSink` and a
  `persist` flag on `setViewTransform`.
- `simulation/src/gui/modern/pixel_map_multiview_panel.js` — restore-on-bind,
  debounced report-back, timer cleanup in both teardown paths.
- `simulation/src/gui/modern/pixel_map_panel.js` — the `ViewAdjust` /
  `PanelAdjust` inspector and the Adjust toggle.
- `simulation/style.css` — `.pm-adj*` styling (neutral chrome, the one amber
  accent only on the open row, matching the renderer's stance).

Tests: `simulation/tests/pixel_map_view_adjustability.test.js` (NEW, 10).

Harness: `agent_tools/pixel_map_view_tuning_verify.cjs` gained `--adjust`,
which opens the manager, expands the inspector and captures it.

## 7. Verification

- **Suite 1046 / 1038 / 8** — the same 8 named stale-model failures, **zero
  new**.
- **Live, through the real UI** on his running `:6969` (readonly-guarded): the
  inspector renders for `top_down` with rows `Framing, Rotate, Close the gaps,
  LedStrand, ShehdsBar, UkingPar`, panels `main` + `glyph sizes`, current values
  `gap 4 / over 5 / LedStrand 5 / ShehdsBar 14 / UkingPar 13`, and the reset
  button present — i.e. it is reading the real shipped view, not a mock.
- **Zero scene writes**: GUARD 3 (0 save-server requests attempted) and GUARD 4
  (0 `[sACN Out] Enabling` lines) both held. The capture only clicks the Adjust
  toggle — pure UI state — and never a control that writes.
- GPU adapter recorded, `integrated: false`.

**Screenshot:** `~/tmp/pixel_map_views/after_adjust_ui.png` — the Views manager
with Top-Down's Adjust panel open, showing framing, the panel's rotate and
gap-compression controls, the three glyph-size rows with their ↺ buttons, and
"↺ Reset view to default".

## 8. Operator action

**Reload the sim** to pick this up, then `Views…` → **Adjust** on any view.
Two things want your word:

1. Should framing live in the scene (as now — panning eventually autosaves), or
   in browser storage beside the pane layout (§4)?
2. Membership editing (§5.1) — worth building, and may removing a panel's last
   group be allowed (leaving the loud red banner)?

---

## 9. Addendum (2026-07-30) — his answers, and Fit to visible

His rulings on §8:

1. **Framing persists to the scene — approved as-is** ("is okay"). No move to
   localStorage; §4's trade-off (panning eventually triggers his autosave) is
   accepted. Nothing changed.
2. **Membership editing — NOT built.** He did not recognise the term; the
   coordinator is explaining it. §5.1 stands as the design, untouched, pending
   his word.
3. **Fit to content — GO**, with a sharper spec than §5.2 asked for:
   *"fit to the area not under any menu, active."*

### 9.1 The obstruction is real — measured, not assumed

The coordinator asked me to say honestly if the pane is never actually
overlapped. **It is.** Measured on his live layout at 1440 × 900, the pane
canvas is 1438 × 788 and the following sit ON TOP of it:

| Overlay | Where |
|---|---|
| **Lighting Controls** (`#gui-panel`) | right edge, full height — ~330 px of the pane |
| camera-preset chip strip (`#view-presets`) | along the bottom |
| `UNSAVED CHANGES`, multi-client and engine banners | across the top |
| the `Shortcuts` pill | bottom-right corner |

Before the fit, the Top-Down view's right half and the right small smoke stack
ran straight under the Lighting Controls panel. So the order is well-founded and
no obstruction had to be invented.

### 9.2 What "fit" does

A **⤢** button in each pane header (beside split / zoom / close — the existing
per-pane idiom; the Adjust panel is per-VIEW and a view can be bound to several
panes, so a pane-level action belongs on the pane).

1. **Measure** — `measureObstructions(canvas)` walks `document.body`'s element
   children, skips anything invisible or that contains/is contained by the pane,
   takes each `getBoundingClientRect()` and intersects it with the pane rect,
   returning pane-local px. Every number comes from the live DOM at click time,
   so a dragged split divider, a resized panel or a banner that is not showing
   all give the right answer with **no hardcoded widths**.
   Using the body's child list rather than a list of element ids is deliberate:
   an id list is exactly the hardcoded-name pattern that has gone stale three
   times in this repo (`_48` addendum 2), and the child list cannot.
2. **Trim** — `unobstructedRect` shrinks the pane rect until it clears every
   overlay, taking the cheapest escape (left / right / top / bottom) each time
   and keeping the largest remaining area. Real chrome sits along the edges, so
   edge-trimming handles it exactly and the result is predictable enough for him
   to anticipate. An overlay that covers the whole pane is **ignored** rather
   than collapsing the rect to nothing.
3. **Solve** — `fitFramingFor` finds the framing that puts every active panel's
   content inside that free rect. Each panel scales about **its own** sub-rect
   centre, so a multi-panel pane cannot be rescaled by one screen-space
   similarity; but for a fixed zoom the pan enters every panel identically, so
   the union translates rigidly. That makes it exactly solvable: binary-search
   the largest zoom whose union still fits (the union grows monotonically with
   zoom), then translate that union onto the free rect's centre.
4. **Persist** — the result goes through `setViewTransform`, i.e. the framing
   sink shipped in §2, so a fit is remembered exactly like a pan or a wheel-zoom
   and rides his own Save. Same validation, same rollback, no new path.

Zoom is bounded by the same `FRAMING_ZOOM_MIN/MAX` the wheel and the schema use
(imported, not restated), and when the fit hits a bound it **says so** in the
console line rather than silently pretending — along with the free area it used
and which overlays it dodged.

Content bboxes include each pixel's glyph half-size, so a fit never clips the
edge off a dot.

### 9.3 Verified live, with the Lighting Controls panel docked

Chrome deliberately left **visible** for this capture — the whole point is that
the panel really overlaps and the fit must dodge it.

```
[FIT] pane 1438 × 788
[FIT] framing before: null
[FIT] framing after : { zoom: 0.914, panX: -178.5, panY: -57.2 }   persisted = true
```

The negative pan pulls the content left, off the docked panel. In
`after_fit_to_visible.png` the whole rig now sits within x ≈ 110-990 — clear of
the Lighting Controls panel (x ≥ 1110), above the camera-chip strip and below
the banners — and the **right small smoke stack, previously hidden under the
panel, is fully visible**. Zoom lands slightly under 1 because the free area is
smaller than the pane: the honest trade of "a little smaller, but nothing
hidden", which is what he asked for.

The harness restores his framing exactly as it found it (here: back to none), so
the run leaves no residue.

### 9.4 One judgment call

**The Views manager overlay is deliberately NOT treated as an obstruction.** It
lives inside the pixel-map panel, so the ancestor test skips it. It is transient
— he opens it, clicks, closes it — and fitting into the sliver beside it would
leave the content wrongly shrunk the moment it closed. Persistent chrome only.

### 9.5 Verification

- **Suite 1059 / 1051 / 8** — the same 8 named stale-model failures, **zero
  new**. 13 new tests (`tests/pixel_map_fit_to_visible.test.js`): trimming for a
  right-docked panel / bottom strip / top banner, several overlays composing, a
  centred overlay escaped the cheap way, a full-cover overlay ignored, the
  fitted content landing inside the free rect and centred in it, a smaller free
  area giving a smaller zoom, clamping reported, **a two-panel pane fitting both
  panels** (the case a single similarity cannot do), and empty content returning
  a neutral framing instead of dividing by zero.
- **Zero scene writes** — GUARD 3 (0 save-server requests attempted) and GUARD 4
  (0 `[sACN Out] Enabling` lines) both held; the newest `scenes/titanic/*` mtime
  is still his own save. The fit does mark the scene dirty **in the probe's own
  page** (that is what persisting means), but `debounceAutoSave` is stubbed and
  every `:6970` request is aborted, so nothing reached disk and his page is a
  separate document.

**Files:** `pixel_map_pane_view.js` (`intersectRect`, `unobstructedRect`,
`fitFramingFor`, `contentBoxes`, `fitToVisible`),
`pixel_map_multiview_panel.js` (`measureObstructions`, the ⤢ button, `onFit`,
`ZOOM_RANGE` imported from the schema), `tests/pixel_map_fit_to_visible.test.js`
(NEW), `agent_tools/pixel_map_view_tuning_verify.cjs` (`--fit`).

**Screenshot:** `~/tmp/pixel_map_views/after_fit_to_visible.png`.

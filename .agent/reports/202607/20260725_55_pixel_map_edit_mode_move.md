# 2026-07-30 — 2D Pixel Map EDIT mode: move that actually moves, + right-click group select (`_55`)

**Operator order** (screenshot: Top-Down in EDIT, a strand's pixel run outlined
in orange): *"The pixel's edit view exists, and lets me select and even
shift+select to add to the selection — but has no move, or edits. Also, can you
add right click selection for group selection?"*

Opus implementer. **Zero writes to `scenes/**` or `models/**`** — every live
check was a readonly-guarded browser client of his running `:6969` while he was
mapping hardware.

---

## 0. TL;DR

**Move was not missing. It was a silent no-op** — the worst possible shape for a
bug, and exactly what the house rules forbid.

Drag-to-move, arrow-nudge, Q/E rotate and Escape-clears have all been in
`pixel_map_interaction.js` since S4. They wrote `view.placements`. But **every
shipped view is a `spatial` or `planar` panel, and those layouts compute each
position from world coordinates and ignore `placements` outright** — the
"TRUE projection" property reports `_40` and `_48` deliberately protected. So
his drag ran, persisted an anchor, rebuilt the panel… and nothing on screen
moved, with no error anywhere.

| | Before | Now |
|---|---|---|
| Drag a fixture in Top-Down | wrote a placement nobody read → **nothing happened** | moves it, by exactly the dragged distance |
| Granularity | — | **per FIXTURE** (= the granularity of the selection) |
| Writes to | `view.placements` (ignored here) | `view.offsets` — a delta from the projected position |
| Right-click | browser context menu | selects the fixture's **whole group**; shift adds |
| Rotate on a projected fixture | silently did nothing | **says why**, once, in the console |
| Reset | — | "Reset moves" per view in the Adjust panel |

**Suite 1075 / 1067 / 8** — the same 8 named stale-model failures, zero new.
14 new tests.

---

## 1. Granularity decision, and why it is not a compromise

**Per FIXTURE (`fixKey`).**

The selection model was already per-fixture: `store.selection` is a `Set` of
`fixKey`s, and the renderer outlines a pixel when `selection.has(p.fixKey)`.
What his screenshot shows as "a strand's pixel run selected" IS one fixture —
a strand is a single cluster of 40 pixels. So the "partial pixel selection of
one fixture" case the coordinator asked me to handle honestly **cannot arise**:
there is no UI path to selecting some of a fixture's pixels.

That means no per-pixel persistence had to be invented, and none was. Moving a
selection applies one delta to each selected fixture's own offset.

## 2. What a move writes to

A new per-view map, **`view.offsets = { fixKey: { dx, dy } }`, in design units**,
deliberately separate from `placements`:

| | `placements` (existing) | `offsets` (new) |
|---|---|---|
| Meaning | ABSOLUTE anchor | DELTA from the projected position |
| Read by | `radial`, `lanes` | `spatial`, `planar` |
| Applied | at expansion, as the position | **after the fit**, as a nudge |

`ctx.getAnchor` / `ctx.setAnchor` route a move to whichever model the fixture's
**panel** uses, resolved once per rebuild into a `fixKey → {panelId, layout,
group}` map rather than re-resolving the view on every pointermove. The
interaction layer just computes a delta; it no longer knows or cares which model
is in play. `placements` behaviour on radial/lanes is byte-unchanged, and a test
pins that a placement still moves nothing on a projected panel — that is the
projection's promise, not a bug.

**Why the offset is applied AFTER the fit.** Folding it into the world
coordinates would re-run the aspect-preserving fit on every pointermove and
rubber-band the entire panel while he drags. Post-fit, his move is exactly the
distance he dragged, and nothing else on the panel shifts by a pixel — proven by
test.

**Persistence** is the path he already has: `commitViews()` →
`params.pixelMapViews` → his own Save. No agent writes `scenes/**`. An offset
dragged back to zero is **removed**, so "never moved" stays distinguishable from
"moved and moved back" — the same stance as framing, and what makes "Reset
moves" meaningful.

**Side effect worth naming:** `materializeView` used to seed a placement for
every fixture on every edit-mode press, including on projected panels where
nothing would ever read them — persistent junk in his scene that also marked it
dirty. It now skips projected panels.

## 3. Right-click = group selection

Right-click a pixel in EDIT mode → every fixture sharing that fixture's **group,
within the same panel**, is selected. **Shift+right-click** adds that group to
the existing selection. Right-click on empty space clears (shift keeps).

The browser context menu is suppressed on the canvas unconditionally — including
for a right-drag that starts on a pixel and ends on empty space, which would
otherwise still pop one.

Scoped to the panel, not the whole view, because a group can appear in more than
one panel (the Front view draws a side per panel) and selecting across panels
would move fixtures he cannot see.

## 4. The rest

- **Arrow nudge** and **Escape clears** already existed and now work, because
  they route through the same anchor model. 1 design unit, 8 with Shift.
- **Rotate (Q/E) is refused, loudly**, for a fixture on a projected panel: its
  angle comes from real world coordinates, so there is nothing to rotate. One
  console line per pane, once, saying so — rather than the silent nothing that
  caused this whole report. Rotation on radial/lanes is untouched.
- **"Reset moves"** in each view's Adjust panel (report `_54`), showing the
  count of moved fixtures. `Reset view to default` also clears them.
- The EDIT status strip now reads: *click select · shift+click add · RIGHT-click
  selects the GROUP (shift adds) · drag to move · arrows nudge · Esc clears*.

## 5. Verification

**Live, through the real handlers** on his running `:6969` (synthesised pointer
events on the real canvas, so the shipped interaction code is what ran):

```
[EDIT] target fixture: Left Front Wall 1
[EDIT] right-click selected 5 fixture(s): Left Front Wall 1..5
[EDIT] offsets before:        null
[EDIT] offsets after move:    all 5 → { dx: 56, dy: 24 }   (movedCount 5)
[EDIT] offsets after rebind:  all 5 → { dx: 56, dy: 24 }
[EDIT] survived rebind: true
```

- **Right-click selected the whole group** from one click — 5 of 5 bars.
- **The drag moved all 5 rigidly** by one delta (the 90 × 40 client-px drag
  through the pane scale, 8-unit snapped).
- **Persistence proved across a rebind** (framing-style): the pane was bound
  away to `front` and back, and the offsets came back identical.
- The probe cleared its own moves and returned the pane to VIEW mode; the run
  leaves no residue.

**Screenshots** (`~/tmp/pixel_map_views/`, all inspected):

| Path | Shows |
|---|---|
| `after_edit_right_click_group.png` + `_crop.png` | one right-click, all 5 `Left Front Wall` bars outlined amber |
| `after_edit_after_move.png` + `_crop.png` | the same 5 moved together right+down, still outlined, **every other fixture exactly where it was** |

**Suite 1075 / 1067 / 8** — same 8 named stale-model failures, zero new. 14 new
tests in `tests/pixel_map_edit_move.test.js`: the shipped views are all
projected (so the move model is the offset one), a placement still moves nothing
on a projected panel, an offset moves exactly that fixture by exactly the delta
and nothing else, a move is rigid, a multi-fixture selection moves as one,
offsets work on planar too, an offset for an absent fixture is ignored, schema
validation refuses junk rather than repairing it, round-trip through params,
empty offsets normalise to absent, no leakage between views.

**Zero scene writes** — GUARD 3 (0 save-server requests attempted) and GUARD 4
(0 `[sACN Out] Enabling` lines) held. The probe's edits marked the scene dirty in
**its own document only**; `debounceAutoSave` is stubbed and every `:6970`
request aborted, so nothing reached disk, and the newest `scenes/titanic/*` mtime
is still his own save.

**Files:** `pixel_map_views.js` (`offsets` schema/normalize/persist),
`pixel_map_layout.js` (offsets applied post-fit, `PROJECTED_LAYOUTS` exported,
`expandPanel` takes them), `pixel_map_store.js` (`getAnchor`/`setAnchor`/
`canRotate`/`groupOf`, the fixture→model map, `clearViewOffsets`/`movedCount`,
materialize skips projected panels), `pixel_map_interaction.js` (anchor-model
drag/nudge, right-click group select, context-menu suppression, loud rotate
refusal), `pixel_map_panel.js` (Reset moves + status hint).
Tests: `tests/pixel_map_edit_move.test.js` (NEW, 14).
Harness: `agent_tools/pixel_map_view_tuning_verify.cjs` `--edit`.

Scope note: everything is inside `src/gui/pixel_map/*` plus the pixel-map panel
shell — no shared GUI file was touched, so the concurrent GUI-wide wheel-guard
work has no overlap with this.

## 6. Operator action

**Reload the sim**, switch the Pixel Map to **EDIT**, then: click to select,
shift+click to add, **right-click to grab a whole group**, drag to move, arrows
to nudge, Esc to clear. Your moves save with the scene; `Views… → Adjust →
Reset moves` puts a view's fixtures back on the projection.

One thing to know: a move is a nudge **away from where the projection puts the
fixture**, not a free placement — the projection stays the source of truth
underneath. If you want a view where fixtures sit wherever you put them
regardless of world position, that is a different layout mode (`lanes` already
does it for rows); say the word and it can be offered as a per-panel choice.

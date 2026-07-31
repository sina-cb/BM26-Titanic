# 20260725_85 — Controllers pane: the UNMAPPED tray + Save-row layout

**Operator order (2026-07-30, with a screenshot):** fix the layout of the
controllers pane's UNMAPPED tray region. Circled defects: the
`💾 Save Configuration` button rendered **on top of** the tray chips
(overlapping the "TE Sign V3 A/B" chips), cramped chip rows, and the help
line squeezed against the second chip row — all appearing after the taller
MarsinLED gamma blocks from `_65` landed.

**Verdict: FIXED, at the root.** The overlap was never an absolute-position
bug — it was a **flex overflow**: the tray could be shrunk below its own
content while its `overflow` stayed *visible*. Structural fix in
`simulation/style.css` + `simulation/src/gui/controller_map_editor.js`,
pinned by 12 new source/stylesheet-contract tests and proven at real
geometry on the docked pane.

---

## 1. Root cause — what the button was actually anchored to

**Nothing.** `.vm-btn.vm-save` was a bare `<button>` appended straight into
`#cm-body`'s flex column, between `renderTray(...)` and the `.cm-hint` div,
with **no rule reserving its space**. It never moved; the chips came up to
meet it.

The chain, in `simulation/style.css`:

| Element | State | Rule |
|---|---|---|
| `.cm-body` | always | `display:flex; flex-direction:column; overflow:hidden; min-height:0` |
| `.cm-main` | user-sized | `flex: 3 1 auto` — flex-basis `auto` = the **full height of the controller cards** |
| `.cm-tray` | user-sized / collapsed | `flex: 1 1 auto; **min-height: 0**` — shrinkable to nothing |
| `.cm-tray` | always | `overflow` left at its **initial `visible`** |
| `.cm-tray-chips` | user-sized / collapsed | `**min-height: 40px**` — a hard floor inside the shrinkable box |

`.cm-tray` was the only element with a `min-height: 0` escape hatch AND no
clipping. So:

1. `_65` made each MarsinLED card taller (gamma sliders + live curve). Three
   cards side by side in `.cm-group-cards` → `.cm-main`'s flex **basis** grew
   by hundreds of px.
2. `#cm-body` went to **negative free space**. Flex distributes the deficit
   in proportion to `shrink × basis`; `.cm-main` absorbed most of it, and the
   remainder landed on `.cm-tray`, whose `min-height: 0` let its **box**
   shrink below the height of the head + chip grid it contains.
3. `.cm-tray-chips` refused to follow, because of its `min-height: 40px`
   floor — so the chip grid **painted outside the tray's border box**.
4. The Save button and the hint are laid out at the *box* positions, i.e.
   immediately under the (shrunken) tray, and they come **later in DOM
   order** — so they painted on top of the escaped chips. Hence "the Save
   button is on top of the TE Sign chips".

The operator's own hunch (defect 3 — "the tray never accounted for the cards'
new height") is exactly right; there was no fixed offset, but the tray's share
of the column was unbounded from below and unclipped.

## 2. The new layout rules

`#cm-body` is now four regions with an explicit give-way order:

```
.cm-body  (flex column, overflow:hidden)
├─ .cm-section-head   flex 0 0 auto     — the Controllers ▾/▸ head (unchanged, _50 wave)
├─ .cm-main           flex 1|3 1 auto   — SCROLLS.  Gives space up first.
├─ .cm-tray           flex 0 1 auto     — CLIPS.    Gives space up second, down to a floor.
│   ├─ .cm-tray-head  flex 0 0 auto     — title + filter, wraps on a narrow pane
│   └─ .cm-tray-chips flex 1 1 auto     — SCROLLS.  No min-height floor, ever.
├─ .cm-footer         flex 0 0 auto     — the Save row. NEVER shrinks.
└─ .cm-hint           flex 0 0 auto (docked) / 0 1 auto (floating fallback)
```

Rules, and why each one is load-bearing:

- **`.cm-footer` — the Save button's own anchored toolbar** (`flex: 0 0 auto`,
  `border-top` separator). It cannot shrink, so `.cm-main` and `.cm-tray`
  yield before it does and the row is always on screen. `render()` builds it
  as `footer.appendChild(saveBtn); bodyEl.appendChild(footer)`.
- **`.cm-tray { overflow: hidden; min-height: 0; flex: 0 1 auto }`** — the
  tray can never paint outside its own border box again, in any state. It is
  also shrinkable in the compact/floating case now (it was `0 0 auto` there),
  so a tall controller list can't push the Save row off the pane instead.
- **`.cm-tray-chips { flex: 1 1 auto; min-height: 0; overflow-y: auto }`** in
  the base rule, and `min-height: 0` (was `40px`) in **both** the
  `.cm-user-sized` and `.cm-controllers-collapsed` overrides. The chip grid
  scrolls instead of forcing the tray taller. Removing the floor is what
  makes the overlap structurally impossible rather than merely unlikely.
- **`#controller-map-panel.cm-split-docked .cm-tray { min-height: 96px }`** —
  the docked pane is always full screen height, so the tray gets a hard floor
  and `.cm-main` (which scrolls) gives the space up. This is the direct
  answer to "the tray never accounted for the cards' new height": however
  tall the gamma cards get, the tray keeps its head + a couple of chip rows.
  The floating fallback stays floor-free (it can be 180 px tall in total).
- **Chip spacing** — `row-gap: 5px` / `column-gap: 4px` (was a flat `3px`) +
  `align-content: flex-start`, chip `line-height: 1.5`, `padding: 1px 7px`.
  Wrapped rows read as rows.
- **Head + filter** — `.cm-tray-head` gets `flex-wrap: wrap` + `row-gap`, and
  `.cm-tray-title` a `min-width: 96px`, so on a narrow pane the filter box
  drops to its own line instead of crushing the title. The filter's width
  moved from an inline `style.width = '90px'` to
  `.cm-input.cm-tray-filter` — an inline width could not be overridden, so
  the docked pane now widens it to 150 px.
- **Hint** — its own `margin-top: 7px` under the separator, `line-height:
  1.45`, and it is clipped (`overflow: hidden`) rather than ever overlapping.
  In the **docked** pane it is `flex: 0 0 auto` (see §4 — measured).
- **Docked density** — `.cm-tray-title` / `.cm-tray-chip` / `.cm-hint` /
  the Save button get the same readability bump the chain chips already had
  (`_50` wave, `.cm-split-docked` block).

Nothing in the `_50` wave was touched: the collapse toggle, the two-row card
header, the `--sim-pane-left` pill relocation, the natural sort and the
"resolve tray sources ONCE per render" filter-perf fix all still hold (their
tests are unchanged and green, and the render path was not restructured — the
Save button gained a wrapper `div`, nothing else).

## 3. Files changed

| File | Change |
|---|---|
| `simulation/style.css` | `.cm-tray`, `.cm-tray-head`, `.cm-tray-title`, `.cm-tray-chips`, `.cm-tray-chip`, `.cm-hint` reworked; new `.cm-footer` + `.cm-input.cm-tray-filter`; `min-height: 40px → 0` in the two `.cm-tray-chips` overrides; six new `.cm-split-docked` density/floor rules |
| `simulation/src/gui/controller_map_editor.js` | Save button wrapped in `div.cm-footer`; tray filter takes `cm-tray-filter` instead of an inline width |
| `simulation/tests/controller_pane_ergonomics.test.js` | new **G5** section, 12 tests |
| `simulation/agent_tools/controllers_pane_toggle_verify.cjs` | `readPane` now reports overlap geometry (`saveOverTray`, `saveOverChips`, `hintOverTray`, `chipsEscapeTray`, `saveInFooter`); 7 new in-browser checks |

## 4. States verified

**Static (tests, every run):** the 12 G5 contract tests pin the footer's
placement (`footer.appendChild(saveBtn)`, and explicitly **no**
`bodyEl.appendChild(saveBtn)`), that nothing in the region is
`position: absolute|fixed|sticky`, that the tray clips + shrinks, that the
chip grid carries `min-height: 0` in **all three** state rules, the row/column
gap relation, the head wrap, the filter-width-in-CSS contract, the docked tray
floor, and the `main → tray → footer → hint` build order in `render()`.

**Live geometry (docked pane, `test_bench`, 1280×800, readonly-guarded probe
`controllers_pane_toggle_verify.cjs` — sACN OUT socket blocked and asserted,
`framesSent=0`, 0 saves, 0 device HTTP, contention banner tolerated, browser
closed):**

| Check | Expanded | Collapsed |
|---|---|---|
| Save row overlaps tray / chips | 0 px | 0 px |
| Chip grid escaping the tray box | 0 px | 0 px |
| Hint overlaps tray | 0 px | 0 px |
| Save button inside `.cm-footer` | ✓ | ✓ |
| Save + hint rows visible, same y in both states | ✓ | ✓ |

Also green in the same run: tray rises and grows on collapse, chip area grows,
chips still naturally sorted, 6 filter keystrokes in **1 ms** (the `_50`
perf fix survives), two-row card header intact at the 320 px minimum pane,
`--sim-pane-left` pill keep-out intact, collapsed state survives a reload.
PNGs inspected visually.

**Card count / width:** `.cm-main` is a grid (`auto-fill, minmax(330px,1fr)`)
and scrolls, so 1–4 cards change only what `.cm-main` must scroll — the tray's
floor and the footer are independent of it by construction. Narrow pane: the
tray head wraps; the docked minimum is 320 px (`MIN_MAP`), and the filter +
title floor fits it.

**One finding from the first probe run, fixed and re-verified.** With the
hint left shrinkable in the docked pane, the Save row **hopped 34 px** between
the expanded and collapsed states and the help text was truncated
mid-sentence — because the hint was absorbing part of the flex deficit.
`#controller-map-panel.cm-split-docked .cm-hint { flex: 0 0 auto }` makes
`.cm-main` and `.cm-tray` the only things that give; the confirmation run has
the Save + hint rows at one constant y in both states.

## 5. Test counts

| | tests | pass | fail |
|---|---|---|---|
| Baseline (before) | 1391 | 1382 | 9 |
| After | **1403** | **1394** | **9** |

**+12 tests, ZERO new failures.** The 9 failing names are byte-identical to
the baseline set (diffed; only the per-test durations differ) — the 8
long-standing stale-model failures plus the deliberate compression-headroom
tripwire (operator-owned, see `_84` §1).

Parse checks: `controller_map_editor.js` and the test file imported as ESM
(`node --input-type=module -e "import(...)"`) — no `SyntaxError`;
`node --check` on the `.cjs` probe; `style.css` brace + comment balance
verified programmatically (depth 0, 140/140).

## 6. Open — NOT this fix

The probe's three **"no rebuild"** node-identity checks fail, in both runs and
independently of this diff (they compare DOM node identity across a
`localStorage`/toggle sequence). Something re-renders the pane **once,
asynchronously, early after open** — the toggle itself does not (the
"in-progress tray filter survived a hide/show cycle" and "tray back to its
original top" checks both pass, which is the behaviour that actually matters
mid-mapping). Most likely suspect: the lil-gui `.listen()` +
`onChange` on `Show Unpatched (Red)` (`gui_builder.js:1659`), which calls
`window.refreshControllerMapPanel()` — a full pane rebuild — and can fire once
as the value settles during boot. Worth closing separately; nothing in this
report's scope touches that path.

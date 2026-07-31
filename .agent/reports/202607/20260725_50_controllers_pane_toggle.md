# 20260725_50 — Controller Mapping pane: live-mapping ergonomics + controller-lifecycle findings

**Branch:** `feat/bm_readiness` · **Scope:** `simulation/` GUI only (no scene
writes, no git operations) · **Context:** written while the operator was
LIVE-MAPPING real DMX controllers on the `titanic` scene with hardware
attached.

Three operator requests landed on the same pane, plus a read-only
investigation into controller lifecycle vs "Clear All Patches".

---

## 1. Controllers hide/show toggle (the original ask)

> "give hide show button for the controllers pane so I can see below it"

### What was actually in the way

The Controller Mapping pane is not a floating panel any more — `split_layout.js`
docks it as the LEFT screen pane. Inside it, `#cm-body` is a flex column:

```
[violations banner] → .cm-main (controllers list) → .cm-tray (unmapped) → 💾 Save → hint
```

Docked panes always carry an inline height, so `.cm-user-sized` is always on,
which gives `.cm-main` `flex: 3` against the tray's `flex: 1`
(`style.css` "Operator-sized panel" block). The controllers list therefore owns
**three quarters of the pane** and the unmapped tray — the thing you actually
read while mapping — is squeezed into a sliver at the bottom, with the Save row
and hint under it. On `titanic` that sliver has to hold **91 unmapped fixtures
and 8 strands**.

The existing `#cm-collapse-btn` (`─`) does not help: it hides the whole body,
and because `placeCanvas()` still reserves the map column, collapsing it just
leaves an empty stripe — nothing becomes visible.

### What was built

A **Controllers section header** — a direct child of `#cm-body`, *outside* the
scroll region — carrying a `▾ / ▸` chevron and a `Controllers (n)` label, in
the same idiom as the existing DMX / MarsinLED group heads. Collapsing sets one
class on `#cm-body`; CSS hides `.cm-main` and lets the tray take the whole pane
(and shed its 130 px chip cap).

- `simulation/src/gui/controller_map_editor.js` — `renderControllersSectionHead()`,
  `paintControllersToggle()`, `applyControllersCollapsed()`,
  `toggleControllersSection()`; exported pure helpers
  `parseControllersCollapsed()`, `controllersToggleState()`,
  `CONTROLLERS_COLLAPSED_CLASS`.
- `simulation/style.css` — `.cm-section-head` / `.cm-section-title` and the
  `.cm-body.cm-controllers-collapsed` rules.

Design points that matter for a live session:

- **No rebuild.** The click flips one class and repaints one button. It never
  calls `renderIfOpen()`, never recomputes a projection, never touches the
  registry. Pick mode, a half-typed address, the tray filter and the scroll
  position all ride through it. Proven in-browser by node-identity probes
  (see §4) — the same `.cm-tray` / `.cm-main` DOM nodes survive the toggle, and
  a half-typed filter still reads `half-typed` afterwards.
- **The header never hides itself** — it lives outside `.cm-main`, so the way
  back is always one click.
- **The Save row and hint stay put.** They are bottom-anchored; only the tray
  grows.
- **Persistence follows the existing idiom** — a per-machine `localStorage`
  key, `bm26.map.controllersCollapsed`, written exactly like the neighbouring
  `bm26.map.cameraFocusOnChip` pref (same try/catch + `console.error` shape).
  No new storage mechanism.

---

## 2. Controller card header — two rows, readable name box

> "Controller name text box is too small … maybe make that header 2 rows
> actually, we have space in this UI here"

### Root cause of the narrow name box

`.cm-input.cm-name` was `flex: 1`, which is shorthand for **`flex: 1 1 0%`** —
a *zero* flex basis. It was the only flexible item in a row that also had to
hold the chevron, a fixed-width IP field (**108 px** when docked, via
`#controller-map-panel.cm-split-docked .cm-input.cm-ip`) and four text buttons
(`DMX`, `sACN`, `+port`, `🗑`). Flexbox hands the fixed and content-sized items
their width first; the name input got only the leftover, and `.cm-input`'s
`min-width: 0` let it collapse without complaint. On a narrow docked pane the
leftover was a handful of characters — hence `LeftF…`.

### Fix

`.cm-controller-head` became a **column of two rows**:

- **row 1 (identity):** chevron · name input · IP input
- **row 2 (actions):** `DMX` · `sACN` · `+port` · spacer · `🗑`

plus `.cm-input.cm-name { flex: 1 1 auto; min-width: 120px }`. The delete
button is pushed to the far right by `.cm-head-spacer`, so it is no longer
adjacent to the everyday `+port` click.

Measured in the browser at the **narrowest pane the layout allows** (320 px,
`MIN_MAP`): name box **185 px** vs IP box 108 px, and the operator's real
controller name `LeftFrontWall` renders with `scrollWidth == clientWidth` —
i.e. not truncated. Port rows (`P1·U` … with `+sel/+list/+gap`) are untouched.

---

## 3. `⚠ UNPATCHED — SIM-ONLY MODE` pill covering the picker

The pill is `position: fixed; bottom: 140px; left: 14px; z-index: 9999`
(`patch_manager.js` creates it; `style.css` places it). That spot was authored
for a full-window 3D view — with the map pane docked to the left edge it lands
**inside the pane**, right on the tray chip grid, and covers fixture names in
the "+ list" picker. It is `pointer-events: none`, so chips stayed *clickable*;
they were just unreadable.

Fix — **relocate, never suppress** (the operator is mapping real hardware and
must keep seeing that status):

- `split_layout.js` now publishes the sim pane's left edge as a CSS variable
  `--sim-pane-left` and toggles two body classes on every layout pass
  (`setHudKeepOut()`): `sim-map-docked` (split + mapMax) and `sim-map-full`
  (mapMax only).
- `style.css`: `body.sim-map-docked #unpatched-warning { left: calc(var(--sim-pane-left) + 14px) }`
  parks the pill at the bottom-left **of the 3D view**, and it tracks divider
  drags for free. In `simMax` the pane is off-screen, so the pill returns to its
  home. In `mapMax` there is no 3D pane at all, so `body.sim-map-full` parks it
  bottom-right, over the pane's static hint line — nothing to read, nothing to
  pick.

Measured overlap with pick mode open on `titanic`: **before** the keep-out the
pill intersects the mapping pane (reproduced by removing the body class in the
live page); **after**, its intersection with both the pane and the chip grid is
**0 px²**, and it is still on screen.

**Related but out of scope / for the operator:** the `SACN IN/OUT MONITOR`
panels also sit over the bottom-left of the docked pane (visible in every
capture). Those are draggable registered panels, so they are operator-movable —
say the word and they can get the same keep-out treatment.

---

## 4. Validation

### Browser proof — `simulation/agent_tools/controllers_pane_toggle_verify.cjs` (new)

`agent_render.cjs` cannot open the mapping pane, so this follows the
`split_capture.cjs` precedent: it opens the pane, drives the toggle, the header
and the picker, and **asserts geometry in-page** rather than relying on eyeballs
alone. Run on `test_bench`, `studiodj` and the operator's own `titanic` —
**all checks green on all three**.

**Live-session safety, by construction:**

- `?readonly=1` is **not** usable here — `main.js` skips
  `setupControllerMapEditor()` in observer mode, so the pane under test would
  not exist. (This is also what made the first three probe runs time out.)
- Instead the probe **blocks the sACN OUT bridge socket (ws :6972) before the
  page's first script runs** and then asserts, before touching anything, that
  `sacnOutput.stats.connected` is false and `framesSent === 0`. `animate.js`
  only transmits when that client is connected, so the window cannot reach
  hardware. It touches no output gate, opens no LED push, never saves, and
  always exits pick mode.
- **Nothing was written to the scene tree.** `find simulation/scenes -newermt
  <probe start>` returns empty; the last scene write is the operator's own save
  at 16:54:30, before the probe runs.

Evidence — `~/tmp/controllers_pane_toggle/` (all visually inspected):

| File | Shows |
|---|---|
| `titanic_1_expanded.png` / `titanic_2_collapsed.png` | the ask, on his scene: collapsed reveals the entire 91-fixture / 8-strand unmapped tray at once |
| `titanic_3_reexpanded.png` | list returns, tray back to its original geometry |
| `titanic_4_after_reload.png` | collapsed state survives a reload |
| `titanic_5_header_narrow_pane.png` | `LeftFrontWall` + its LAN IP fully legible at the 320 px minimum pane |
| `titanic_6_header_default_pane.png` | two-row header at the default split |
| `titanic_7_picker_pill_before.png` | **the bug reproduced** — pill over the chip grid mid-pick |
| `titanic_8_picker_pill_after.png` | pill over the 3D view, every chip row readable |
| `test_bench_*` / `studiodj_*` | same sequence, 1–4 controllers, multi-controller header |
| `before_header/*.png` | pre-change single-row header, kept for comparison |

Note on the pill captures: the `⚠ UNPATCHED` element is only created when
**nothing** is patched (`patch_manager.js`:
`_updateWarning(_patchedCount === 0 && _totalCount > 0)`) — the state the
operator is in mid-mapping, but not the state of a saved scene. On a patched
scene the probe stands up the identical element (same id → the same stylesheet
rules decide its geometry, which is what is under test), logs that it is
synthetic, and removes it afterwards.

### Unit tests (new, existing style — pure exports + stylesheet contracts)

- `simulation/tests/controllers_pane_toggle.test.js` — 9 tests: persisted-value
  parser, chevron/title states, and the JS-class ↔ CSS-rule contract (collapse
  hides `.cm-main` and provably nothing below it).
- `simulation/tests/controller_pane_ergonomics.test.js` — 12 tests: two-row
  header structure, which control sits on which row, the name box's growth +
  minimum width, an arithmetic check that the floor still fits the 320 px
  `MIN_MAP` pane beside the 108 px IP box, and that the pill keep-out relocates
  rather than hides in every layout mode.

### Suite

`cd simulation && npm test` → **960 tests / 951 pass / 9 fail**.

All 9 failures are the known stale-titanic-model family — `scene_model_parity`,
`bench_section_sync`, `pixel_map_te_led_classification`. None of those files
import anything this change touched (`controller_map_editor.js`,
`split_layout.js`, `style.css`); they read scene YAML and the exported model.

The count moved from the stated 903/895/**8** baseline because the suite is
data-driven over the real scenes and the operator **saved new mapping mid-session
at 16:54**: he added the LED controller `LeftLeftFront` with `Left_Front_Left`
and `Left_Back_Left` chained. The 9th failure names exactly those two strands
(`strand_model_patched_without_record` — model carries addresses, `patches.yaml`
has no record yet) alongside pre-existing `duplicate_scene_name` errors for
`TE Sign V3 A`/`B`. It is scene data, not code. **Zero new failures
attributable to this change.**

---

## 5. Task 2 (read-only) — controller lifecycle vs "Clear All Patches"

No code was changed for this section.

### What "Clear All Patches" does today

`clearAllPatches(registry)` (`simulation/src/dmx/controller_registry.js`) walks
every controller → every port and does `port.chain.length = 0`. That is all.
Kept by design: the controllers array, ports, port numbers, `port.universe`,
`startAddress`, `nextControllerId`, `nextUniverse`, `type`, `protocol`, the
`led` config (including `wire.controllerGamma`) and the `device` binding with
its push provenance. Gap entries are chain entries, so they are wiped too. UX:
a `showCustomConfirm` ("Controllers and ports are kept"), a `console.warn`
naming every freed fixture, and a 12 s undo toast.

### Where controllers come from and where they live

Four creation paths, all producing the **same shape**: the `+ Add Controller`
modal and `testAutoPatch` both call `addController()`; LED Discovery calls
`addLedControllerFromDevice()`; and `createControllerRegistry()` re-builds them
from `controllers.yaml` at boot. Runtime home is `window.__controllerRegistry`
(installed by `main.js`, also hung on the config tree — same object identity,
which is why undo restores in place). It serializes to
`scenes/<scene>/controllers.yaml` via the save server, **only on an explicit
save** (`autoSave` is `false` in `common.yaml`). `id` is a monotonic integer
(`nextControllerId`) and is **never reused** after a delete.

Note the id subtlety: the `controllerId` projected onto fixtures in
`patches.yaml` is the controller's **1-based panel ordinal**, not its stable
`id` (docs/33 decision 20). Deleting a controller therefore renumbers the
projected ids of every controller after it — fixtures on untouched controllers
get a rewritten `controllerId`.

### What deleting a controller really costs

`removeController()` is nine lines: collect the freed fixture names, splice the
controller out. The reprojection that follows cleans the derived per-fixture
patch fields and LED strand records, so nothing dangles and nothing throws
(every reference site is a guarded `find()`; chains are nested *inside*
controllers, so there is no chain→controller reference that can dangle).

What is destroyed and not recoverable:

- **Every `at:` address on it.** Chain entries are the *only* home of the
  sticky-by-name allocation (docs/33 decision 19). Re-adding the controller and
  re-patching mints **new** addresses against hardware that is already
  physically set — the exact hazard `src/core/undo.js` calls out.
- **The universes are burned.** `nextUniverse` is a monotonic high-water mark
  and never rewinds, so "the same" controller comes back on different
  universes — which the engine's hand-written `marsin_engine/config.yaml`
  routing block will not match.
- **The LED `device` block** — vendor fingerprint plus `lastGammaPush`, the
  scene's mirror of the hardware-verified gamma curve — is discarded with no
  archive.
- The undo window is a ~10 s toast; the panel does not push onto the global
  Ctrl-Z stack. An empty controller is deleted with **no confirm at all**.

Mitigating fact: nothing reaches disk until the operator hits 💾, so an
accidental delete is recoverable by reloading the page. That safety net is
accidental, not designed — worth stating in any confirm copy.

Engine coupling is looser than feared: `marsin_engine` does **not** read
`controllers.yaml`; its routing is a hand-maintained block in
`marsin_engine/config.yaml`. So a sim-side delete cannot break the engine
directly — it silently *desynchronizes* the two, and the engine keeps streaming
to the old host/universes.

### Can we tell a "test" controller from a real one?

**No — not by any field.** `testAutoPatch` uses module-private constants
(`'TEST DMX'` / `'TEST LEDs'` plus two hard-coded private test IPs) that are not exported
and that nothing else reads. The controllers it creates go through the **same
`addController()`** as the modal: no flag, no `source:`, no `createdBy:`. Those
IPs are not sentinels — `isValidIp` accepts them and the sACN relay will happily
build routes to them. Worse, `testAutoPatch` **reuses** any existing valid-IP
controller of the right type instead of creating a test one, so after one run
"test" patches can sit on an operator-authored controller with no marker at all.

Two grounding facts:

- The **live** `scenes/titanic/controllers.yaml` currently holds
  `LeftFrontWall` (DMX) and `LeftLeftFront` (LED), both on the rig's own LAN subnet —
  both operator-authored.
- `TEST DMX` / `TEST LEDs` survive **only** in a scene backup
  (`simulation/.scene_backups/titanic/20260729_162556_084/…`). In other words
  the operator ran Test Auto-Patch on `titanic` today and then had to clean the
  test controllers up **by hand** — which is precisely why he is asking.

*(A first pass of this investigation mistook that backup for the live file and
concluded the live scene was all-test. Corrected here: it is a backup.)*

**Cheapest honest markers, in order of preference:**

1. **Reuse the existing PLACEHOLDER convention** — the all-zeros sentinel IP **and**
   `PLACEHOLDER` in the name. It is already enforced by
   `lib/scene_model_parity.cjs` (`sentinel_without_marker` /
   `marker_with_real_ip` are errors), the sACN relay refuses to build a route
   for the sentinel with a named warning, and runtime treats it as unpatched. Zero
   schema change. **Caveat: it means "IP unknown", not "test-created"** — using
   it for provenance would be dishonest, so only adopt it if test controllers
   genuinely should not transmit.
2. **A real `origin: 'test'` field.** There is no external YAML schema and no
   test asserting an exact key set, but `createControllerRegistry()` is a
   **whitelist re-constructor** — an unrecognized key is silently dropped on the
   next load. So this needs one line there plus one in `addController()`, or it
   evaporates on reload. ~30 minutes including a round-trip test.

### Recommended design

1. **Keep "Clear All Patches" mapping-only.** Its contract ("Controllers and
   ports are kept") is correct, is in the tooltip and the confirm text, and is
   pinned by tests. Changing it in place would be a silent semantic change to a
   destructive button.
2. **Add a checkbox inside the existing confirm dialog: "also remove
   controllers created by Test Auto-Patch (N)"** — default **on** when N > 0,
   absent when N == 0. Naming the count makes it honest, and the operator gets
   his one-click cleanup without a second button.
3. **Mark test controllers at creation** with `origin: 'test'`
   (option 2 above), and clear the marker the moment the operator edits the
   name or IP — an edited controller is his, not the tool's. Until the marker
   exists, the checkbox can offer the name+IP match (`TEST DMX`/`TEST LEDs` at
   their hard-coded test IPs) as a *transitional* rule, shown explicitly in the
   dialog as the list of controllers it will remove.
4. **Never delete an unmarked controller from this flow.** Individual deletion
   stays the per-card `🗑`.
5. **While removing test controllers, do not reclaim universes** — keep
   `nextUniverse` monotonic, consistent with today's deliberate behaviour.

**Effort:** the marker + whitelist round-trip ~0.5 h; the confirm-dialog
checkbox + selective removal + toast copy ~1.5 h; tests (marker survives
save/load, clear-with-controllers removes only marked ones, clear-without leaves
every controller) ~1 h. **≈3 hours**, no engine or CaptainPad impact.

**Separate follow-up worth filing:** the per-card delete confirm should name
what is *irreversibly* lost (the `at:` addresses and, for LED, the pushed gamma
provenance), and an **empty** controller should still confirm — one stray click
currently deletes it with no prompt and only a 10 s undo toast.

---

## 5b. Addendum — tray + picker sorted by name (operator follow-up)

> "make the fixture list in the controller pane sorted by name please so it's
> easy to find the fixtures. make sure it's fast."

### One shared comparator, not a second bespoke one

The numeric-aware compare already existed as a module-private `NATURAL` in
`src/gui/pixel_map/pixel_map_layout.js` (landed for the 2D-lanes work, report
`_44` §2 D1 — a plain compare put `"Group 10"` before `"Group 2"`). It is now
extracted to **`simulation/src/core/natural_sort.js`** and imported by both
surfaces, so two lists that each claim to be "sorted by name" cannot disagree.

Speed, per the operator's explicit constraint — two separate wins:

1. **The comparator is one cached `Intl.Collator`**, built at module load.
   `localeCompare(a, undefined, { numeric: true })` constructs a fresh collator
   on *every* call, which dominates the cost of sorting a few hundred names.
   The pixel-map lanes view gets this speedup for free.
2. **The list is sorted once per render, never per keystroke.** This was the
   real trap: `renderChips()` is the filter box's `oninput` handler, and it was
   calling `unmappedNames()` / `unmappedStrandNames()` *from inside itself* —
   re-walking every scene config and every chain entry on every character
   typed, and adding a sort would have landed on that same path. The tray now
   resolves both source lists **once** in `renderTray()`; the filter is a pure
   subset that preserves the order it is handed. Measured live on `titanic`
   (78 fixture chips + 6 strand chips): **six keystrokes across the whole tray
   in 2 ms.**

### What is sorted, and what deliberately is NOT

| List | Order | Why |
|---|---|---|
| Unmapped tray — fixture chips | **name (natural)** | the list he hunts through |
| Unmapped tray — 💡 strand chips | **name (natural)**, in their own cluster after the fixtures | clusters kept, not fused (requirement 3) |
| "+ list" picker grid | **name (natural)** | it *is* the same tray in pick mode — one fix covers both |
| A port's chain chips | **unchanged — daisy-chain order** | this is the physical wire order and the home of the `at:` addresses; sorting it would misreport the cabling |
| "+ sel" append | **unchanged — 3D selection order** | its tooltip promises "in selection order"; that is the operator's chosen chain order |

`unmappedNamesByKind()` in the registry is untouched — it still returns input
order, and the sort lives in the two panel-local helpers, so nothing else in
the codebase inherits an ordering it did not ask for.

### Validation

- **`simulation/tests/natural_sort.test.js`** (new, 10 tests) pins the 2-vs-10
  trap directly (`Left Back Wall 2` < `Left Back Wall 10`), a full 1→11 run,
  group-before-number, a mixed real-scene set, total order + null safety,
  non-mutation, that the module builds **exactly one** collator and calls no
  per-call `localeCompare`, and that both consumers import the shared function.
- **3 new tests in `controller_pane_ergonomics.test.js`**: both tray sources
  sort with `compareNatural`; `renderChips()` contains **no** call to
  `unmappedNames()` / `unmappedStrandNames()` (the per-keystroke guard); and
  the chain renderer does not use the comparator.
- **Browser proof** (same tool, `--scenes titanic` and `test_bench`): reads the
  rendered chip text in DOM order and asserts the fixture chips are in natural
  order, the strand chips are in natural order, all fixture chips precede all
  strand chips, and the filtered subset stays sorted. Green on both.
  *Note:* after the coordinator's scene cleanup no group in the live scene has
  both a `… 2` and a `… ≥10`, so the tool reports that honestly and skips its
  real-pair assertion — the trap itself is pinned in the unit tests.
- **Screenshots:** `~/tmp/controllers_pane_toggle/titanic_9_tray_sorted.png`
  (Left Auditorium 1-8 → Left Back Rails → Left Back Wall → … → TE Sign, then
  the 💡 strand cluster) vs
  `~/tmp/controllers_pane_toggle/before_sort/titanic_tray_unsorted_before.png`
  (the same tray in creation order). Both inspected.

Side observation from the sorted tray: the two `TE Sign V3 A` / `TE Sign V3 B`
duplicates now sit **adjacent**, so the `duplicate_scene_name` defect the
parity validator reports is visible at a glance in the UI — a free diagnostic
the unsorted list was hiding.

### Suite after the sort

`960/951/9` → **1002 tests / 994 pass / 8 fail**. The failure count is back to
the stated baseline of **8** and its *shape* changed exactly as expected,
because the coordinator fixed the scene on disk this morning (ghost
`Left Back Wall 1-5` deleted, `Left Back Wall Generator*` renamed) and the
operator restarted his stack at 09:23 to pick it up. All 8 remain the
stale-titanic-model family in `scene_model_parity` / `bench_section_sync` /
`pixel_map_te_led_classification`; none of those files import anything this
change touched. `pixel_map_layout_expansion.test.js` — the guard for the
comparator's original home — still passes after the extraction.

**Nothing written to the scene tree:** `find simulation/scenes models -newermt
<probe start>` is empty; the last scene write is 09:23:18 (the save server
regenerating `manifest.json` at startup — line 150 runs on boot), before my
probe windows of 09:25:19–09:26:16 and 09:26:56–09:28:00.

### Still open from the previous handoff (deliberately not started)

The duplicate controller-name guard and the loud `+port` were **not** taken —
neither is a one-liner (the name guard needs a registry-level uniqueness rule
plus its own tests, and touching `addController` while the operator is adding
controllers live is exactly the wrong moment), and the sort was what he was
waiting on. Both remain small, well-understood follow-ups.

## 6. Files touched

| File | Change |
|---|---|
| `simulation/src/core/natural_sort.js` | new — THE shared numeric-aware name comparator (one cached `Intl.Collator`) |
| `simulation/src/gui/pixel_map/pixel_map_layout.js` | its private `NATURAL` now aliases the shared comparator |
| `simulation/tests/natural_sort.test.js` | new — 10 tests (incl. the 2-vs-10 case) |
| `simulation/src/gui/controller_map_editor.js` | Controllers section head + hide/show toggle; two-row controller card header; name-sorted tray/picker + once-per-render source lists |
| `simulation/src/gui/split_layout.js` | `setHudKeepOut()` — publishes `--sim-pane-left`, toggles `sim-map-docked` / `sim-map-full` |
| `simulation/style.css` | section-head + collapsed rules; two-row header + name-box floor; `#unpatched-warning` keep-out |
| `simulation/tests/controllers_pane_toggle.test.js` | new — 9 tests |
| `simulation/tests/controller_pane_ergonomics.test.js` | new — 15 tests (12 + 3 sort/perf contracts) |
| `simulation/agent_tools/controllers_pane_toggle_verify.cjs` | new — browser proof + captures |

No scene file, no model, no `marsin_engine`, no `CaptainPad` change. No git
operations.

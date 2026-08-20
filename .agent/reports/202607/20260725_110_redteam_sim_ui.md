# 20260725_110 — Red-team: the sim's GUI + persistence layer

> **Numbering note:** commissioned as `_106`; a sibling red-team thread had
> already landed `20260725_106_redteam_controller.md`, and `_107`/`_108`/`_109`
> were taken by the time this one wrote. Renumbered to the next free slot per
> the tracker's re-read-on-mismatch rule. Same convention the `_109` thread
> followed.

**Agent:** adversarial red-team (Opus). **Mode:** report-only — **zero source
edits, zero suite edits, zero `scenes/**` writes, zero git ops.**
**Branch:** `feat/bm_readiness`. **Repro:** `node ~/tmp/redteam_simui/run_all.mjs`
(pure-module) + `node ~/tmp/redteam_simui/f_dom.cjs` / `f2_attached.cjs`
(headless Chrome on a **blank page** — DOM-semantics probes, they never load
the sim).

**Scope attacked (per brief):** `exportConfig` / auto-save races (`_86`), the
📡 Subscribed Universes Yes/No/Cancel gate (`_86`), the 2D pixel-map
persistence + rename gap (`_66`, `_76`), orphan detection + removal (`_76`),
the gamma slider UI (`_64`/`_65`), and the warning/status surfaces under load
(`_92`, `_96`, `_102`).

**⚠ SAFETY CONFIRMATION.** No sim server was started or stopped. No browser was
pointed at `:6969`–`:6972`. No save-server POST, no device HTTP, no sACN socket,
no `dgram`, no engine. The operator's stack on the standard ports was never
approached; a second stack was never started (the sim's ports are pinned —
`start.js` has no port override, so per the brief I stayed at unit/DOM level).
`git status` is byte-identical to session start apart from this report and the
one tracker line. Every probe file lives in `~/tmp/redteam_simui/`.

---

## Findings by severity

**P0: 0 · P1: 4 · P2: 6 · P3: 6**

| # | Sev | Title | Root (file:line) |
|---|---|---|---|
| **1** | **P1** | "Save cancelled — nothing was written" is a lie: the 2 s auto-save fires *through* the open universes dialog and writes the scene | `gui_builder.js:386-514` + `:1015-1029` — no re-entrancy guard, no debounce disarm |
| **2** | **P1** | Folder titles are `innerHTML`: an operator-typed fixture/group/trace name silently corrupts the header, and **executes script** | `modern_gui/marsin_gui.js:237` ← `gui_builder.js:2156, 2298-2302, 2343, 2348, 2905, 5437, 6167` |
| **3** | **P1** | Every sim shortcut (`Delete`, `D`, `Ctrl+Z`, `M`, `H`, `B`) fires *underneath* an open `vm-modal-overlay` and mutates the scene the dialog is describing | `core/interaction.js:536-546` — guards only `isSceneModalOpen()` |
| **4** | **P1** | Two windows saving: the SAVE path has **no guard at all**, and `common.yaml` is written **globally, ignoring `?scene=`** — a second tab un-applies the `_86` universe widening | `server/save-server.js:171-394`, `:385`; `gui/multi_client_warning.js:8-11` |
| **5** | **P2** | `beforeunload` beacon is a full save path that **bypasses the universes gate and skips `saveModelJS()`** | `gui_builder.js:573-590`, `:626-628` |
| **6** | **P2** | Orphan detection is byte-exact string matching (no trim, no Unicode normalization) while the group-name guard **trims** — a trailing space or an NFD name marks a whole LIVE group `⚠ ORPHANED` with an armed `🗑 Remove N` | `dmx/orphan_fixtures.js:92-98, 110-119` vs `dmx/group_rename_guard.js:52-58` |
| **7** | **P2** | The browser field parser enforces `MIN` but **not `MAX`**, and the never-remove rule then re-writes a `>63999` token into `common.yaml` on every "Update + save" — feeds `_105` H1 (bridge `process.exit(1)` at boot) | `dmx/subscribed_universes.js:85` + `:240` |
| **8** | **P2** | The pixel-map sidecar has **exactly one writer**; group rename and orphan removal mutate the tree but never schedule a write, so `pixel_map_views.yaml` stays stale indefinitely | `pixel_map/pixel_map_store.js:130-143, 173-190` vs `:205-208` |
| **9** | **P2** | `renderGammaSection` **throws mid-render** on a mirror that `normalizeLedWireConfig` accepts (`controllerGamma: {}` → NaN → `gammaCurvePath` throws) — two validators disagree | `led/led_gamma.js:60-66` vs `:218-223`; `gui/led_gamma_ui.js:300` |
| **10** | **P2** | Controller-pane render is **O(N) full projections**: `addressMergePlanNow()` recomputes `computeProjection` + `planUnifiedOutput` *per card*, uncached; warning text is O(N²) | `gui/controller_map_editor.js:341-350`; `gui/led_discovery_panel.js:868` |
| **11** | **P3** | The field parser silently drops tokens that parse below `MIN` (`0`, `-5`) without listing them as `malformed`, contradicting its own contract | `dmx/subscribed_universes.js:72-86` |
| **12** | **P3** | After a fleet gamma push completes, `Escape` can never close the modal — the guard reads a `disabled` flag that is never reset | `gui/led_gamma_ui.js:395-396, 440-441, 449` |
| **13** | **P3** | 30 unrankable overlaps produce a **5330-character** refusal message that goes into a dialog/toast verbatim | `dmx/address_merge.js:278-295` |
| **14** | **P3** | `removeOrphanFixtures` prunes **name-keyed** stores with no duplicate-name pre-check — one duplicate and deleting an orphan unmaps a live fixture | `gui_builder.js:920, 929` |
| **15** | **P3** | `_setGuiRebuilding(false)` is not in a `finally`: a throw in `renderParGUI()` leaves the undo pipeline dead for the rest of the session | `gui_builder.js:939-948` |
| **16** | **P3** | `?scene=` is **not URL-encoded** on the two full-save paths while the pixel-map path encodes it | `gui_builder.js:481, 582` vs `pixel_map/pixel_map_persist.js:78` |

---

## P1 — the four

### 1 · Cancel does not mean "nothing on disk"

`_86` §3 states the contract verbatim: *"Fires from `exportConfig()`, at the very
top — before `saveModelJS()`, so `Cancel` genuinely means nothing on disk."*
That holds **for that one call**. It does not hold for the process, because
`exportConfig` has no in-flight guard and never disarms the pending
`debounceAutoSave` timer:

- `gui_builder.js:1025-1028` — the 2 s timer calls `exportConfig({interactive:false})`
  unconditionally.
- `gui_builder.js:386` — `exportConfig` reads no lock, sets no lock, and never
  touches `saveTimeout`.
- `subscribed_universes.js:340-346` — the non-interactive path returns
  `proceed:true` and saves.

So an auto-save started **while the operator is reading the dialog** runs the
whole write to completion, including `_setSceneDirty(false)` (`:494`).

Repro (`~/tmp/redteam_simui/c_save_race.mjs` — faithful control-flow model of
`exportConfig` + `debounceAutoSave` driving the **real** `syncSubscribedUniverses`;
only DOM and `fetch` are stubbed):

```
t+    0ms  operator nudges a fixture  -> debounceAutoSave() arms the 2 s timer
t+  301ms  operator clicks 💾 (Lighting Controls)
t+  301ms  INTERACTIVE 💾 DIALOG OPENED — awaiting operator
t+ 2000ms  AUTO-SAVE    exportConfig() entered
t+ 2006ms  AUTO-SAVE    *** POST /save COMPLETED -> scene_config/patches/controllers/common.yaml written (dirty:=false) ***
t+ 3300ms  operator clicks "Cancel save"
t+ 3300ms  INTERACTIVE 💾 RETURN ok:false  toast="Save cancelled — nothing was written"

  toast shown to operator : "Save cancelled — nothing was written"
  scene writes on disk    : 1   <-- CONTRADICTS THE TOAST
  UNSAVED-CHANGES chip    : CLEARED (says "saved")
```

**Observed vs expected.** Expected: one toast, zero writes, chip still red.
Observed: five scene files rewritten, chip cleared, and the toast asserts the
opposite. Trigger window is 2 s wide on **every** explicit 💾 taken while
`autoSave` is on and the scene is dirty — i.e. the normal mapping rhythm.

Two secondary shapes of the same root, both live:

- **Redundant double-save.** Even with no dialog, an explicit 💾 leaves the
  armed timer alone, so ~2 s later the whole save runs again — a second
  `saveModelJS()`, a second five-file write, a second `notifySacnBridgeLoud()`.
- **The gate's own TOCTOU.** The dialog's diff, addition lines and controller
  attributions are computed **before** the await (`subscribed_universes.js:330-348`)
  and never re-checked. Combined with finding 3 the operator can delete
  fixtures while the card is on screen, then press "Update + save", and the save
  proceeds against a configuration the card never described.

**The fix template is already in this repo.** `pixel_map_persist.js:151-153`
chains its writes onto an `inFlight` promise for exactly this reason. The full
save path never got the same treatment.

**Handoff:** `simulation_expert.md`.

### 2 · Folder titles are `innerHTML`

`marsin_gui.js:237` — `title(title) { this.$title.innerHTML = title; }`. Group
names, fixture names and trace names are interpolated into that string raw:

- `gui_builder.js:2156` — `` `${groupName} (${items.length})` `` → `addFolder()` → `title()`
- `gui_builder.js:2298-2302, 2343, 2348` — `genCardTitle(config.name)`
- `gui_builder.js:2905, 6167` — `idxFolder.title(proposed)` straight off the rename box
- `gui_builder.js:5437` — `tFolder.title(\`${traceGlyph(...)} ${newName}\`)`

Measured in a real DOM (`~/tmp/redteam_simui/f_dom.cjs`, blank page):

```
authored : "Left <Back> Wall"      rendered : "Left  Wall (6)"   childTags=["BACK"]
authored : "A<B"                   rendered : "A"                             <-- header truncated
authored : "Bow <span style=...>"  rendered : "Bow  (6)"         childTags=["SPAN"]
```

and with the title element attached to the document, as folder headers always
are (`f2_attached.cjs`):

```
title.innerHTML = '<img src=x onerror="window.__PWNED=1"> (6)';
  rendered text : " (6)"
  script ran    : YES — window.__PWNED === 1
```

**Observed vs expected.** Expected: the name the operator typed, shown verbatim.
Observed: any `<` truncates the header from that point, tag-shaped names vanish
entirely, and a scene file (or a rename box) can run arbitrary JS in the sim's
origin — which is the origin that owns the save server, the sACN bridges and the
`__controllerRegistry`.

Practical severity for the playa is **not** "someone attacks us": it is
(a) a fixture whose header silently reads wrong while every name-keyed store
(`__globalPatchTree`, patches.yaml, pixel-map selectors, the exported model)
keys on the true string — the operator cannot see what he is mapping; and
(b) scene folders are copied between the laptop, the show server and this
**public** repo, so an untrusted `scene_config.yaml` is a code-execution vector
on the show machine. `textContent` on the title path closes both.

**Handoff:** `simulation_expert.md`.

### 3 · Sim shortcuts fire underneath every `vm-modal-overlay`

`main.js:300` registers `onKeyDown` on `window` with **capture = true**.
`interaction.js:536-546` bails only for `INPUT`/`TEXTAREA`/`contentEditable` and
for `isSceneModalOpen()` — the scene add/delete modal. The whole
`vm-modal-overlay` family (`_86` universes gate, `_96` reconcile, `_102` push
refusal, the LED push confirm, the fleet gamma push) is **not** in that list,
and the overlay only blocks *pointer* events (`style.css:2251-2265`).

Measured (`f_dom.cjs` §F2), focus on the dialog's primary button:

```
focus is on: BUTTON  (so the INPUT/TEXTAREA guard at interaction.js:538 does not apply)
handlers that fired, in order:
     sim-shortcut:Delete
     modal:Delete
     sim-shortcut:d
     modal:d
     sim-shortcut:Escape
     modal:Escape
```

So with a save-confirmation dialog on screen: `Delete` deletes the selected
fixtures (`interaction.js:636-650`) and arms an auto-save; `D` duplicates them;
`Ctrl+Z` unwinds the undo stack; `M`/`H`/`B` toggle panels. `Escape` reaches the
sim **first**, deselecting fixtures and exiting snap mode, *then* cancels the
save.

Chained with finding 1 this is the sharp edge: mutate the scene under the card,
answer "Update + save", and the save writes state the confirm never enumerated.

**Handoff:** `simulation_expert.md`.

### 4 · Two windows: no save guard, and `common.yaml` is global

The brief asked directly — *"the multi-client warning exists — does the SAVE
path actually guard?"* **No, nowhere.**

- `multi_client_warning.js:8-11` says so in its own header: *"This is a warning
  surface ONLY — no auto-kick, no writer arbitration."* The banner is
  `pointer-events:none`.
- `save-server.js:171-394` — `POST /save` takes a body, snapshots, and writes.
  No ETag, no version, no mtime precondition, no lock, no client id. Last writer
  wins the whole scene. (Node's single thread does keep the five writes of one
  request atomic against another request — files are not torn, only replaced.)
- `save-server.js:385` — `const commonPath = path.join(SCENES_ROOT, 'common.yaml')`.
  **`?scene=` is ignored for this file.** `commonKeys` (`:373`) includes
  `colorWave`, which is where `sacn_universes` lives.

Consequence chain, all of it live: window A answers "Update + save" and widens
📡 Subscribed Universes; window B — open since before, on the *same or a
different scene* — saves for any reason and writes its stale narrow field back
over `common.yaml`. The `_86` fix silently un-applies, and the failure mode it
exists to prevent (packets dropped with no event) returns with every surface
green. `_87`'s bridge notify then re-reads a field that just went backwards.

Mitigation that exists: `snapshotBeforeWrite` + the ⟲ Recover UI, so the
clobber is recoverable if noticed.

**Handoff:** `simulation_expert.md` (a save precondition), operator decision on
policy (refuse / warn / merge).

---

## P2 — the six

**5 · The unload beacon is an ungated save path.** `flushPendingSaveBeacon`
(`gui_builder.js:573-590`) runs `reconstructYAML(configTree)` and
`sendBeacon(/save)` on `beforeunload` (`:626-628`). It calls neither
`checkSubscribedUniversesBeforeSave` nor `saveModelJS()`. So a reload while the
scene is dirty writes scene_config / patches / views / controllers /
**common.yaml** with (a) the subscription field never verified — the one thing
`_86` promises happens on *every* save — and (b) **no model re-export**, which is
precisely the `scene_model_parity` staleness the suite already fails on. It also
fires while the universes dialog is open, giving a third route past "Cancel".

**6 · Orphan ownership is byte-exact; the group-name guard is not.**
`orphan_fixtures.js:92-98` keys ownership on the raw string and
`isOrphanFixture:118` does `!ownerGroupNames.has(group)` — no `trim()`, no
`normalize('NFC')`. `group_rename_guard.js:52-58` **does** trim for the same
namespace. Two modules, one namespace, different equality. Measured
(`b_orphans.mjs`):

```
B1  trace groupName "Café Ropes" (NFD)  vs group "Café Ropes" (NFC)
      -> ORPHANS DETECTED = 2   [ 'Café Ropes 1', 'Café Ropes 2' ]
B2  trace groupName "Ropes "     vs group "Ropes"
      -> ORPHANS DETECTED = 2   [ 'Rope 1', 'Rope 2' ]
B7b trace groupName "   " (whitespace-only, length>0 so it WINS over trace.name)
      -> the live group it should own becomes an ORPHAN
```

`_76` §1 names this as the one mistake the module must never make: *"an
under-counted owner set turns live fixtures into deletion candidates."* Each of
these three paints a live generated group `⚠ ORPHANED`, adds it to the
`📐 Group Generator` header count, and arms `🗑 Remove N`. The confirm dialog is
the only thing between that and the delete. Same root also produces the reverse
false-negative: a real ghost whose group differs only by whitespace is never
reported.

**7 · `MAX` is enforced on one side of the field only.**
`subscribed_universes.js:85` admits any `parsed >= SACN_UNIVERSE_MIN` —
`SACN_UNIVERSE_MAX` is declared at `:48` and never used in the parser, while
`computeRequiredUniverses`'s `note()` (`:154`) enforces both. Then the
never-remove rule (`:240`) folds `current` into `next` unconditionally.
Measured:

```
A3  currentValue '1, 70000, 999999999'  ->  nextValue "1, 5, 70000, 999999999"
```

So a `>63999` token typed once is re-written into `common.yaml` by the sim's own
"Update + save" **forever**, and there is no UI path that removes it. That is
the browser-side twin of sibling `_105` **H1**, where the identical missing
bound in `bridge_routing.cjs:285` makes the `sacn` package throw a `RangeError`
that is classified FATAL → `process.exit(1)`, killing the whole input bridge at
boot. The two halves compound: the sim keeps re-writing the token the bridge
dies on.

**8 · One writer for the pixel-map sidecar; two mutators.** Exhaustive grep:
the only caller of `schedulePixelMapViewsSave()` / `savePixelMapViewsNow()`
outside `pixel_map_persist.js` is `pixel_map_store.js:207` (`commitViews`).
`renameGroupInPixelMapViews` (`:130-143`) and `removeFixtureFromPixelMapViews`
(`:173-190`) both mutate the live container **and** `params.pixelMapViews`, and
both deliberately do not save. Before `_66` that was inert; now it is a divergence:

- **group rename** — scene_config.yaml gets the new name, `pixel_map_views.yaml`
  keeps the old one. On reload the panel shows its zero-match banner. (`_66` §8
  filed this; **confirmed still open**.)
- **orphan removal (`_76`)** — the fixture is gone from the scene, its
  `{name: …}` selectors / offsets / placements stay in the sidecar.

Neither reaches disk until the operator happens to make an unrelated 2D-map
edit. Loud on reload, but the window is unbounded.

**9 · The gamma card can throw during render.** `readGammaMirror`
(`led_gamma.js:60-66`) reads the **raw** `led.wire.controllerGamma` and does
`Number(src[ch])` with no validation. `normalizeLedWireConfig` **accepts**
`controllerGamma: {}`. Measured (`g_gamma.mjs` §G1):

```
{}  normalize=ACCEPTED   readGammaMirror={"r":NaN,"g":NaN,"b":NaN,"w":NaN}
    -> repaint() -> buildCurveSvg -> gammaCurvePath(NaN)
       THROWS: [LedGamma] cannot plot exponent null — a curve exponent must be > 0
```

`renderGammaSection` calls `repaint()` unconditionally at `led_gamma_ui.js:312`,
and `controller_map_editor.js:1505` calls it with no `try`. A `controllers.yaml`
that boots clean therefore kills the card — and the pane render — with a raw
stack trace instead of the red per-card error line the module already has
(`errorLine`, `led_gamma_ui.js:145`). Same shape for `{r: null}` and `{r: 0}`.

**10 · The pane recomputes the whole projection once per card.**
`addressMergePlanNow()` (`controller_map_editor.js:341-350`) runs
`computeProjection` + `computeLedProjection` + `planUnifiedOutput` **fresh** and
is reached from `renderSharedAddressBanner` (`led_discovery_panel.js:868`) on
every card render; `unrankableCollisionsFor` (`:403`) takes the same path at
push time. No memo per render pass. Measured (`e_pane_cost.mjs`, `d_stress.mjs`):

| N controllers | `computeProjection` | pane render (2 calls/card) |
|---|---|---|
| 5 | 1.12 ms | 15 ms |
| 15 | 1.20 ms | 37 ms |
| 30 | 0.95 ms | 58 ms |
| **50** | **2.24 ms** | **~226 ms** |

and the warning content itself is O(N²) — 50 claimants sharing one universe:

| N | overlaps | banner rows on ONE card | warning text |
|---|---|---|---|
| 10 | 45 | 9 | 8.5 KB |
| 25 | 300 | 24 | 57.3 KB |
| **50** | **1225** | **49** | **235 KB** |
| 100 | 4950 | 99 | 951 KB |

`sharedAddressBannerModel` (`led_discovery_panel.js:845-865`) caps nothing;
`renderSharedAddressBanner:872` appends one `div` per line. Answer to the
brief's question: the pane stays **truthful** at 50 — every claimant, range and
winner is named, and the warning/error grades stay distinct — but responsiveness
degrades linearly in projections and quadratically in DOM rows.

---

## P3 — the six

**11.** `parseSubscribedUniverses` reports `1-24`, `0x10`, `1e3`, `1_0`, `+5`
as `malformed` (correct — `A5` shows the `1-24` trap surfacing exactly as `_86`
claims) but drops `0`, `-5` and empty tokens with **no** entry, contradicting
the module header's *"reports every token it had to reinterpret"*
(`subscribed_universes.js:72-86`; `a_universes.mjs` §A2).

**12.** `startFleetGammaPush` sets `confirmBtn.disabled = true` at
`led_gamma_ui.js:396` and never resets it; the Escape guard at `:449` reads
`!confirmBtn.disabled`, so after the run finishes Escape is permanently dead and
only the "Close" button works.

**13.** `assertResolvableOverlaps` concatenates every ambiguity message — 30
same-IP pairs produce a **5330-character** `Error.message`, which
`led_discovery_panel.js:412` puts straight into the refusal reason
(`d_stress.mjs` §D3).

**14.** `removeOrphanFixtures` splices by config identity (correct) but then
prunes **by name**: `removeFixtureFromPixelMapViews(name)` (`:920`) and
`pruneGlobalPatchTreeKeys(names)` (`:929`). `findOrphanFixtures` happily returns
three distinct configs all named `Dup` (`b_orphans.mjs` §B4). One duplicate name
shared with a *live* fixture and deleting the orphan silently strips the live
one's pixel-map references and patch-tree key. The rename guard makes this hard
to reach today; there is no pre-check in the delete path itself.

**15.** `gui_builder.js:939-948` sets `_setGuiRebuilding(true)`, calls
`renderParGUI()` / `renderGeneratorGUI()` / `rebuildParLights()`, then resets to
`false` — **not** in a `finally`. Any throw in that render (finding 6's
malformed-trace class, or finding 9's gamma class) leaves the flag stuck, and
`gui.onFinishChange` (`:1038-1040`) early-returns forever: undo silently stops
recording for the rest of the session.

**16.** `gui_builder.js:481` and `:582` build `?scene=${window.__activeScene}`
unencoded; `pixel_map_persist.js:78` uses `encodeURIComponent`. A scene name
containing a space or `&` sends the two full-save paths to a different scene
than the sidecar path. Also: `renameGroupInViews` accepts a whitespace-only new
name and can leave duplicate `{group: …}` selectors in one panel
(`h_pixelmap.mjs` §H2/H4) — blocked upstream by the rename guard today, same
trim-consistency family as finding 6.

---

## What held (attacked, did not break)

- **The gamma NaN/Infinity-via-keyboard vector the brief hypothesised is
  CLOSED.** `_64`/`_65` replaced the four number boxes with
  `<input type="range">` clamped by the browser to 1.00–3.00 step 0.05, and
  `parseGammaField` — the one validator — refuses `''`, `NaN`, `Infinity`,
  `-Infinity`, `0.999`, `3.001`, `2,2` and Arabic-Indic digits (`g_gamma.mjs`
  §G2). `quantizeGamma` throws rather than clamping; `gammaCurvePath` throws on
  any exponent ≤ 0. There is no keyboard path into the mirror that reaches a
  bad value. Only a hand-written YAML block does — finding 9.
- **The `1-24` range trap works.** A field reading `1-24` against a 24-universe
  configuration reports `changed=true`, 23 missing universes, and names the
  token (`a_universes.mjs` §A5). Exactly as `_86` claims.
- **The universes dialog is XSS-safe.** It builds every node with
  `textContent` (`subscribed_universes_prompt.js:36-41`), so a hostile
  controller name renders literally — the opposite of finding 2's `innerHTML`
  path. `describeSubscriptionUpdate` returns plain strings and is never
  `innerHTML`'d.
- **`removeFixtureFromViews` refuses to empty a panel's `select`**, and the
  orphan delete enumerates that blocker before mutating (`h_pixelmap.mjs` §H3).
- **The orphan detector's strictness holds.** Only the boolean literal `true` is
  a claim; `'true'`, `1`, `null` and a missing key are all not-orphan.
  `generatorGroupNames` throws rather than half-scan.
- **`pixel_map_persist.js:151-153` serializes overlapping writes** on an
  `inFlight` promise chain. This is the correct pattern and it is already in the
  tree — it is the template finding 1 needs.
- **`findAddressOverlaps` determinism + early break** (`address_merge.js:170-177`)
  and the ambiguity classes hold under 100 claimants; `assertResolvableOverlaps`
  refuses (content aside, finding 13).
- **`_102`'s two warning grades never collide** — separate classes, separate
  headlines, both present at 50-way pile-up.

## Overlap with the sibling red-team threads (checked, credited)

- **`_106` HIGH-2 (reconcile dialogs stack, one per ~20 s auto-sweep)** is a
  different root from finding 1 — but the dialog it stacks is a
  `vm-modal-overlay`, so **findings 1 and 3 compound it**: while an unanswered
  reconcile card is on screen the 2 s auto-save is still writing
  `controllers.yaml`, and `Delete` still deletes fixtures. Fixing HIGH-2's
  per-card guard does not fix either.
- **`_105` H1 (bridge `process.exit(1)` on a `>63999` universe at boot)** is the
  server half of my finding 7; I add the browser half plus the never-remove
  amplifier that makes the bad token permanent. Both bounds are one line each.
- **`_109` P1-2 (a nameless DMX *gap* claim wins the higher-IP contest)** is in
  `address_merge.js`; my finding 10 is the same module's *render cost*, not its
  semantics. No duplication.
- No sibling report mentions `debounceAutoSave`, `innerHTML`, the unload beacon
  or the global `common.yaml` path.

## Coverage gaps — what I could not determine from here

- **No live browser against the sim.** The stack hardcodes 6969–6972 with no
  port override in `start.js`, and the operator's instance is up, so per the
  brief I stayed at unit/DOM level. Findings 1, 3, 9, 10 are proven at
  control-flow / DOM-semantics / measurement level, not by clicking the real UI.
  Findings 2, 4, 5, 6, 7, 8, 11–16 are proven from code + pure-module repros.
- **Finding 4's clobber window** was not exercised against a running save
  server (that would mean writing `scenes/**`). The absence of any precondition
  in `save-server.js` and the global `common.yaml` path are static facts.
- **Reachability of a malformed `params.traces` entry** (a trace with neither
  `name` nor `groupName` → `generatorGroupNames` throws → `renderParGUI` dies,
  unguarded at `gui_builder.js:2093` and `:5105`) is **low today**: all 19 real
  traces across the three scenes carry both fields. It is reported inside
  finding 15 as the throw source, not as its own finding.
- **`isLedController`'s exact shape requirements** were not mapped, so the
  gamma probe's `setGammaMirror` round-trip (`g_gamma.mjs` §G3) refused on a
  synthetic controller rather than exercising the 1.00/3.00 extremes end to end.
  The extremes are covered by `parseGammaField` + `quantizeGamma` directly.

## Suite — the tree is unchanged

`cd simulation && npm test`

```
ℹ tests 1645
ℹ pass 1637
ℹ fail 8
ℹ duration_ms 4172.8
```

**1645 / 1637 / 8 — the documented baseline, byte-identical failure list**
(fixture docking, titanic block acceptance, view-bit headroom, two parity CLI
rows, compression threshold, two `test_bench` `scene_model_parity` rows).
Zero source edits, zero suite edits.

`python scripts/security_check.py --all` — **no finding in this report or in the
tracker line.** Of the 12 findings, 11 are the known pre-existing MACs in
gitignored `simulation/.scene_backups/**`. The 12th is **not mine and IS a
commit blocker**: `.agent/reports/202607/20260725_105_redteam_bridge.md:124`
trips `bm26-report-ip` twice (a real IP in a `U2→…` route example). Flagging it
for the sibling / the coordinator — that file is new and tracked, so the
pre-commit gate will refuse the wave until it is redacted to `10.x.x.NN`.

## Top 3

1. **#1 — the auto-save writes through the open dialog**, so "Save cancelled —
   nothing was written" is false and the UNSAVED-CHANGES chip clears. Two-second
   window on every explicit 💾 during normal mapping. The serialization pattern
   is already in the tree (`pixel_map_persist.js:151`).
2. **#2 — `Folder.title()` is `innerHTML`** and takes operator-typed fixture,
   group and trace names verbatim: `A<B` truncates the header, and a scene file
   copied onto the show server can run script in the sim's origin (proven,
   `window.__PWNED === 1`).
3. **#4 — two windows can clobber each other's whole scene with no guard at
   all**, and because `common.yaml` is written globally regardless of `?scene=`,
   a second window silently un-applies the `_86` subscription widening — the
   exact dark-fixtures-with-a-green-UI failure that gate exists to end.

## Repro

```bash
node ~/tmp/redteam_simui/run_all.mjs     # findings 1, 6, 7, 9, 10, 11, 13, 14, 16
node ~/tmp/redteam_simui/f_dom.cjs       # finding 2 (name corruption), finding 3
node ~/tmp/redteam_simui/f2_attached.cjs # finding 2 (script execution)
node ~/tmp/redteam_simui/e_pane_cost.mjs # finding 10 (projection cost table)
```

Findings 4, 5, 8, 12, 15 are static and cited file:line above.

## Not filed on the board

The Notion MCP connection is **not available in this session** (no Notion tool
is exposed), so the one board row this thread owes could not be created. Per
`CLAUDE.md` I did not fall back to a task file in the repo — **Sina needs to
enable the Notion MCP connection and share the Titanic's End workspace**, then
one `Backlog` card should be filed pointing at this report. The tracker line is
in `.agent/memory/bm_readiness_thread_tracker.md`.

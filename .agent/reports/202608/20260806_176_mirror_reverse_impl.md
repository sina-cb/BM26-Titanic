# _176 — bench-mirror slot reverse + persisted selection (slice 2)

Date: 2026-08-06 · Agent: _176 (Opus, implementation) · Branch: feat/bm_readiness
Contract: `.agent/reports/202608/20260806_174_pixel_order_design.md` §3, §4, §5.2
Status: **BUILT AND GREEN.** Sim suite failing LIST identical to baseline; `simulation/scenes/**`
byte-identical across every test run. Nothing armed, no port bound, no process started, no git op.

---

## 1. What was built, against the contract

### 1.1 Persistence — a new machine-owned state file (§3.1)

New pure module **`simulation/lib/bench_mirror_state.cjs`**, written in the exact
`bench_mirror.cjs` style: `STATE_VERSION = 1` refused by name otherwise (version checked FIRST,
before the unknown-key sweep — the `_158` D-158-5 ordering lesson), exported key sets
`STATE_KEYS` / `SELECTION_KEYS` / `SLOT_STATE_KEYS` with unknown-key refusal at every level,
`source` a non-empty string or the literal `none`, `reverse` a STRICT boolean (`'true'`, `1`,
`'yes'` all refused). Writer `writeBenchMirrorState(scenesRoot, benchScene, state)` is atomic
(tmp + fsync + rename) and refuses any target outside the injected root.

File shape, exactly as designed:

```yaml
state_version: 1
selections:
  titanic:                 # key = SOURCE scene (the engine's scene at ARM)
    slots:
      bar_left:  { source: Left Front Wall 1, reverse: true }
      led_0:     { source: none,              reverse: false }
```

`simulation/scenes/test_bench/bench_mirror.yaml` (the hand-written v3 sidecar) is **byte-for-byte
untouched** — zero migration, zero edits, no version bump, its ~70 lines of operator commentary
intact.

Serialization is deterministic (scenes and slots sorted), so re-arming the same selection produces
byte-identical output rather than churn in `git status`.

### 1.2 `_lastSelection` deleted; the file subordinates it entirely (§3.2)

`sacn_bridge.js` no longer contains the identifier at all (asserted). One store, read FRESH at
every picker-open — no cache to go stale. The write happens at **ARM success only**, after the
ownership proof, at exactly one call site. Picker browsing writes nothing.

`BENCH_MIRROR_STATE_ROOT` is resolved once at module load from
`BM26_BENCH_MIRROR_STATE_ROOT` or, unset, `simulation/scenes` — one root, so a live arm cannot
have it moved underneath it.

A write failure does **not** unwind the arm (the hardware has already changed hands and composed
frames are already going out); it is reported in the log, in the monitor broadcast, and in the
returned status's `warnings`. Never swallowed.

### 1.3 Loud validation, never fallback (§3.3)

At **picker-open**: the state file is read fresh and overlaid on the resolution keyed by the
engine's **current** scene.
- unparseable file → payload-level warning quoting the parse message; zero selections applied;
  arming with a fresh explicit selection still works and rewrites the file (logged in as many
  words);
- slot id the sidecar no longer declares → payload-level warning, never applied;
- stored source not among the slot's live candidates → per-row `staleReason` quoting the stored
  name, and the row pre-fills **nothing** (the file entry is NOT deleted — it stands until the next
  successful ARM overwrites the scene key);
- stored `reverse: true` on a destination that cannot be reversed → reported and dropped.

At **ARM**: a stored-but-stale name dies on the existing R-14 exactly like a hand-typed one.

**Scene keying** is what makes a `titanic` mapping structurally unable to surface under another
scene: selections live under `selections.<sourceScene>`, and the picker only ever reads
`selections[engineState.scene]`. Proved end-to-end through the real bridge with a hand-planted
foreign-scene entry.

### 1.4 Resolver reversal (§3.5)

`loadFixtureRegistry` now also parses `model.pixels[].channels` per type into
`pixels: [{id, channels}]`, validated: same role set on every pixel, every channel within
1..footprint, no channel claimed twice.

`computeSlices(dest, src, { reverse })`:
- **dmx, reverse=false** — unchanged, single whole-footprint slice, byte-identical to before
  (asserted three ways: no opts / `{}` / explicit `false`, plus the pre-existing `_155` T-5 frozen
  v2 seven-slice pin still passes untouched);
- **dmx, reverse=true** — definition-driven per-channel map: destination pixel `p`'s role `r` is
  fed by source pixel `N-1-p`'s **same** role `r`; a channel no pixel claims is **identity-copied**.
  Merged into runs contiguous on both sides. ShehdsBar 119 ch → 19 slices (one 11-ch control run +
  18 six-ch pixel runs). VintageLed 33 ch → 14 slices (`1-2` and `9-15` identity, six 1-ch `value`
  slices 3..8 ← 8..3, six 3-ch rgb head slices with r→r/g→g/b→b inside). Never raw footprint byte
  reversal; never intra-pixel byte reversal.
- **led_strand / led_fixture** — `window = srcPx.slice(0, destPx.length)`, then `window.reverse()`.
  **Always the first-N window, then reverse those N** — the explicit counterexample against a
  last-N mapping is asserted. Whole stride blocks move intact, so in-pixel byte order (and w/a) is
  untouched.

New refusals, continuing the catalog: **R-24** selection shape (old flat shape, non-boolean
`reverse`, unknown entry key), **R-25** reverse on a fixture with fewer than 2 pixels ("refusing
rather than ignoring"), **R-26** reverse on a type whose definition is not provably permutable,
naming the model file.

### 1.5 Composition (§4)

The mirror is wire→wire. The resolver is **contractually forbidden** from reading either scene's
scene-level pixel-order store, and a source-grep contract test enforces it over
`bench_mirror_resolve.cjs`, `bench_mirror.cjs`, `bench_mirror_state.cjs` and `sacn_bridge.js`
(no `pixelOrder` identifier, no `pixel_order` require). Every comment in those files that has to
discuss the concept spells it hyphenated so the assertion stays exact rather than being weakened
to accommodate prose.

The slot toggle is pure relative orientation: `computeSlices` sees only the two fixtures' patches
plus the shared fixture definition, asserted structurally (arity check + identical output for
structurally identical but distinct inputs).

### 1.6 WS / protocol (§3.3)

Selection schema is now `{ [slotId]: {source: string|null, reverse: boolean} }`, **full
replacement**. The old flat shape is refused by name with the new shape spelled out and an explicit
"the bridge does not accept both, because an absent `reverse` would have to be guessed". No
dual-shape parser.

`benchMirrorStatus.selection` gains `reverse` and `reverseApplicable` per slot; the arm log prints
`NORMAL` / `REVERSED` per slot; `summarizeSlot` appends `· REVERSED`; the HUD banner names the
reversed slots (`⇄ REVERSED: bar_left, bar_right`) and says nothing at all when none are — an
always-present "0 REVERSED" is noise on the one banner that must stay glanceable.

### 1.7 Picker UI (§3.6)

`bench_mirror_picker.js`: per-row `⇄ REVERSED` / `→ NORMAL` toggle rendered **only** on rows the
bridge marks `reverseApplicable`; a visible badge on every applicable row in both states; the
persisted value shown on reopen (stored beats sidecar default); stale rows show what was remembered
next to the reason it was not applied; payload-level warnings rendered above the rows. Pure
`pickerSetSource` / `pickerSetReverse` / `pickerDefaults` helpers replace the old inline draft
mutation.

`↺ scene defaults` replaces the old `↺ defaults` + `last used` pair: with the remembered selection
now the prefill, "last used" was the same thing twice, and what was missing was the explicit
"forget it" gesture. It restores sidecar `default_source` + `reverse: false` everywhere, is
staging-only (writes nothing), and becomes durable at the next successful ARM.

A non-applicable row can never carry a reverse into the ARM message, from any direction: draft,
remembered state, or a direct setter call.

### 1.8 v3 invariants preserved

Bench-only ownership while armed, ship blackout on ARM, socket-loss auto-disarm, one-writer,
strict same-`fixtureType` compatibility, slice-less destinations composed as zeros, blackout
ordering and holds — all untouched, and their existing suites are green with no assertion relaxed.

---

## 2. Deviations from the contract

**D1 — a definition that fails per-pixel validation records `pixels: null` + a named reason and a
boot `console.warn`, instead of throwing out of `loadFixtureRegistry`.** §3.5 says "load-time
validation (throw, named)" and then, one sentence later, "types that fail keep `pixels: null` →
reverse refused for them at ARM, NORMAL path unaffected". Those cannot both hold: the registry is
read for EVERY fixture type on every ARM, so a throw would make one defective model file
un-armable for the whole rig, including every NORMAL mirror — the opposite of "NORMAL path
unaffected". The refusal is preserved in full at the point it matters (R-26 at ARM, quoting the
model file and the exact rule that failed). No real fixture in the tree fails today, so this is a
behaviour difference only for a future defect. The stricter half — `loadFixtureRegistry` still
THROWS on an invalid `channel_mode` or two files claiming one type with different footprints — is
unchanged.

**D2 — the picker payload carries `storedSource` (validated) alongside `stored` (raw).** §3.3 lists
`reverse`, `reverseApplicable`, `stored`, `staleReason`. Splitting the validated prefill from the
raw remembered entry keeps the "show what was remembered, apply nothing" rule expressible in one
place, and keeps the picker's precedence logic the same shape it already had. Additive only.

**D3 — the `last used` picker button was removed, not kept.** With the persisted selection as the
prefill it duplicated the default state of the dialog. §3.6 specifies the reset button; it does not
mention `last used`. Called out here because it is a visible control that disappeared.

**D4 — the test seam is an env var (`BM26_BENCH_MIRROR_STATE_ROOT`) read once at bridge load.**
§5.3 says "the bridge passes the real scenes root at exactly one call site", which it does; the env
var is how the harness injects a scratch root before requiring the module. It is not a fallback
chain — unset means the production location — and it is belt-and-braces with the writer's own
independent refusal (below).

---

## 3. The test seam and the "tests never touch real scenes" guard

`writeBenchMirrorState` refuses, by name, when the process is a `node --test` child
(`NODE_TEST_CONTEXT` is set by Node itself) **and** the target resolves inside the repo's real
`simulation/scenes/` — computed from the module's own location, so it cannot be talked out of it.
The refusal is asserted directly (`bench_mirror_state.test.js`), and the message says why: a suite
that rewrites tracked scene files destroys the byte-identity proof that says it does not.

`tests/helpers/bridge_harness.mjs` creates a fresh per-pid scratch root under
`~/tmp/fix_176/bridge_state/<pid>/` and sets the env var **before** requiring the bridge. Every
harness consumer (10 spec files) inherits it. If a future harness forgets, the writer refuses
loudly instead of writing.

All other scratch is under `~/tmp/fix_176/state/<pid>-<n>/`.

---

## 4. Byte-identity proof

SHA256 manifest of **every file under `simulation/scenes/**`** (all scenes, not just the two),
taken immediately before and immediately after a full `npm test` run:

```
diff scenes_before.sha256 scenes_after.sha256   → no output
```

and separately, the 45-file manifest of `scenes/test_bench/**` + `scenes/titanic/**` taken
**before any of my edits** compared against the tree after the final suite run:

```
manifest sha256: 1750907985b469cbd823101d2c05a6d08bf35438c727a5839533b48e87b6b102
diff scenes_before.sha256 <(current)            → no output
```

No `bench_mirror_state.yaml` exists anywhere under `simulation/scenes/` after the runs
(`find simulation/scenes -name 'bench_mirror_state.yaml*'` → empty).

Operator residue confirmed untouched: `simulation/scenes/studiodj/*` and the two
`playlists/calibration.yaml` files carry mtimes from before this session; `marsin_engine/states/**`,
`marsin_engine/patterns/66-73_*`, the manifest and the generated models were not written by me.

---

## 5. Files changed

**New**
- `simulation/lib/bench_mirror_state.cjs` — pure parse/serialize + guarded atomic writer
- `simulation/tests/bench_mirror_state.test.js` — 19 tests
- `simulation/tests/bench_mirror_reverse.test.js` — 21 tests

**Modified**
- `simulation/lib/bench_mirror_resolve.cjs` — registry per-pixel maps + validation,
  `reversedDmxChannelMap`, `reverseApplicability`, `destPixelCount`, `computeSlices(…, {reverse})`,
  new selection shape + R-24/R-25/R-26, `reverse`/`reverseApplicable` on the slot output,
  `summarizeSlot` order marker
- `simulation/server/sacn_bridge.js` — `_lastSelection` deleted, `BENCH_MIRROR_STATE_ROOT`,
  picker-open state read + overlay + stale reporting + payload warnings, ARM-success state write,
  arm-log and status reverse markers
- `simulation/src/gui/bench_mirror_picker.js` — new selection shape, reverse toggle/badge/tooltip,
  stale rows, warnings, `pickerSetSource`/`pickerSetReverse`, `pickerDefaults` reset
- `simulation/src/gui/bench_mirror_banner.js` — names the reversed slots
- `simulation/src/gui/modern/controller_map_panel.js` — renders the toggle, badge, stale note,
  warnings; `↺ scene defaults`
- `simulation/tests/helpers/bridge_harness.mjs` — scratch state-root injection, `benchStateRoot`
- `simulation/tests/bench_mirror.test.js` — `_155` §10 guard REWRITTEN (see §6), schema guard,
  one-writer/ordering assertions for the state write
- `simulation/tests/bench_mirror_arm.test.js` — picker/selection tests moved to the new shape,
  persistence + scene-keying + stale + unreadable-file end-to-end tests, banner reverse test
- `simulation/tests/bench_mirror_resolve.test.js` — selections moved to the new shape via one
  `sel()` helper

**Explicitly NOT touched:** `simulation/scenes/test_bench/bench_mirror.yaml`, and every file on
agent `_175`'s list (`src/core/config.js`, `src/gui/gui_builder.js`, `src/dmx/trace_group_rename.js`,
`src/dmx/pixelblaze_model_exporter.js`, `src/dmx/generator_chain_order.js`).

---

## 6. RULING REVERSAL — `_155` §10, by operator order

`simulation/tests/bench_mirror.test.js` used to assert that `_lastSelection` never touches disk,
enforcing the `_155` §10 decision that remembered selections stay in process memory. **That ruling
is reversed by the `_174` design, on operator order.** The test was rewritten, not deleted or
relaxed, and the rewrite is deliberately *stronger* than the original on the thing the original was
actually protecting:

- `_lastSelection` is asserted **gone** — two stores would drift, so there is one.
- The ARMED FLAG still never persists (the pre-existing `_151` test is untouched and green).
- The real invariant — **a checked-in or deployed file can never arm hardware** — is now asserted
  at the SCHEMA level rather than by scanning one variable's call sites: no admitted key of
  `bench_mirror_state.yaml` could hold `armed`, `enabled`, a universe, an address, a host, a
  priority or a controller. There is no file content that could activate anything.
- The write is asserted to be a single call site, through the guarded atomic writer, sequenced
  AFTER the ownership proof; picker browsing is asserted not to write.

The `_155` §10 rationale is answered in the code comment that replaced it rather than deleted:
rot is detected loudly at picker-open and ARM and never silently applied; a `robocopy /MIR`'d copy
can only pre-fill a picker.

---

## 7. Tests and results

New/changed bench-mirror coverage: **134 → 184 tests across the five bench-mirror spec files, all
passing** (`bench_mirror` 53, `bench_mirror_arm` 57, `bench_mirror_resolve` 34,
`bench_mirror_reverse` 21, `bench_mirror_state` 19).

The contract's slice-2 rows, and where each lives:

| Required | Where |
|---|---|
| save selection+reverse → destroy/recreate store → exact reload | `bench_mirror_state`: write→read round trip, plus a **fresh `node` subprocess** reload with `NODE_TEST_CONTEXT` cleared; `bench_mirror_arm`: real ARM → file on disk → picker re-read |
| selections source-scene-specific | `bench_mirror_arm`: hand-planted foreign-scene entry never surfaces; `bench_mirror_state`: overwrite preserves other scene keys |
| stale/invalid persisted names refuse loudly | `bench_mirror_arm`: stale source → `staleReason`, nothing pre-filled, file not edited by a read; unknown slot id → payload warning; unreadable file → warning + nothing remembered, arming still works |
| reset-to-default explicit and persistent | `bench_mirror_arm` (`↺ scene defaults` staging), `bench_mirror_state` (durable after write) |
| Wall 1→Bar Left NORMAL reproduces the opposite-X order, REVERSED aligns it (same Wall 2→Bar Right) | `bench_mirror_reverse`, LIVE tier against the **real generated models** (`marsin_engine/models/test_bench.js` + `titanic.js`): Bar Left localIndex 0→17 runs toward decreasing x, Wall 1 toward increasing x; NORMAL pairs by localIndex and walks the ship right→left, REVERSED pairs `k ↔ 17-k` and walks it left→right |
| Vintage reversal preserves shared controls, permutes six heads incl. non-contiguous lanes | `bench_mirror_reverse`, at channel-map, slice and **byte** level (33-channel unique ramp through `createMirrorState`) |
| LED whole-block swap only | `bench_mirror_reverse`: one slice per pixel, all length 4, both ends on pixel boundaries; byte-level per-lane assertion |
| 40px→20px first-window-then-reverse | `bench_mirror_reverse`: source addresses deep-equal the first-20 window, explicitly NOT the last-20 window, and end-for-end within it |
| pars cannot be reversed | `bench_mirror_reverse` (R-25, including on a held-dark slot), `bench_mirror_arm` (`reverseApplicable:false`), `bench_mirror_picker` tests (no toggle, drafts and stored values dropped, setter is a no-op) |
| w/a bytes never confused | `bench_mirror_reverse`: role-for-role over all 18 pixels with explicit `white ≠ from.amber` assertions, and per-lane on the LIVE pairing |
| resolver-never-reads-pixel-order contract test | `bench_mirror_reverse`, source grep over four product files |
| old WS shape refused | `bench_mirror_reverse` (R-24, string and `null` forms, non-boolean `reverse`, unknown key, array) |

**Sim suite (`cd simulation; npm test`):** baseline **2007 tests / 2000 pass / 6 fail / 1 todo** →
final **2117 / 2110 / 6 / 1**. The +110 is this slice's +50 and agent `_175`'s +60, which landed in
the shared tree during the run.

**Failing-LIST comparison (not totals):** identical, byte for byte.

```
1 test at tests\bench_section_sync.test.js:119:1
1 test at tests\bench_section_sync.test.js:221:1
1 test at tests\bench_section_sync.test.js:271:1
1 test at tests\bench_section_sync.test.js:451:1
1 test at tests\bench_section_sync.test.js:460:1
1 test at tests\pixel_map_view_defaults.test.js:487:1
1 test at tests\scene_data_lint.test.js:109:1
```

(The `scene_data_lint` one is the pre-existing stray `scenes/summer_camp_dome/patches.yaml.original`
in the working tree — operator residue, present at baseline.)

The engine suite was NOT run: slice 3 owns cross-suite comparison.

---

## 8. Notes for `_177` (regression agent)

1. **Slice-3 matrix rows still open for Mechanism B:** §5.4 row 9's second half — the no-double-
   apply proof (§4 rows 5-8: flip the BENCH scene's pixel-order flag, re-run, mirrored bytes
   byte-identical). I proved the *structural* half (the resolver cannot read the store); the
   *empirical* half needs `_175`'s Mechanism A wired to a real export, which is a cross-slice
   run.
2. **A LIVE-tier precondition to know about.** `bench_mirror_reverse.test.js`'s LIVE pairing tests
   read the generated model's per-pixel wire association, which Mechanism A is allowed to permute.
   They assert up front that neither `Bar Left`/`Bar Right` nor `Left Front Wall 1`/`2` carries a
   scene-level pixel-order entry, and fail loudly with "this LIVE tier must be updated" if one ever
   does. If slice 3 flags one of those four fixtures as part of a matrix run, expect that
   precondition to fire — it is doing its job, not breaking.
3. **The env-var seam is per-process.** `BM26_BENCH_MIRROR_STATE_ROOT` is read once when
   `sacn_bridge.js` loads. Any new bridge-harness consumer gets it automatically; a bespoke
   `require` of the bridge outside the harness must set it first or the writer will refuse (which
   is the intended outcome, not a bug to route around).
4. **Two GUI affordances were not visually verified** — the per-row reverse toggle/badge and the
   stale-row note. Starting the sim was off-limits (operator owns 6966-6972). Their pure state is
   fully unit-tested; the DOM rendering in `controller_map_panel.js` is asserted only by source
   shape. A screenshot pass would close that.
5. **The real HTTP `/save` round trip** flagged by `_175` is still outstanding and unrelated to this
   slice; noting it so it does not get lost.
6. **Nothing here has been exercised against hardware.** No ARM of physical fixtures, no sACN to
   hardware, no controller or universe change. The first physical test of a REVERSED slot should be
   Wall 1 → Bar Left with calibration pattern 71, which is the case the LIVE tier models.

# _175 — Mechanism A implemented: persistent per-fixture pixel order (slice 1)

Date: 2026-08-06 · Agent: _175 (Opus, implementation) · Branch: feat/bm_readiness
Contract: `.agent/reports/202608/20260806_174_pixel_order_design.md` §2 + §5.1
Scope: **simulation only — `marsin_engine/` untouched, Mechanism B untouched.**
No processes started, no ports bound, no git operations, no hardware/ARM/sACN touched.

---

## 1. What was built

A generator-group member whose physical fixture is wired opposite to the model now
carries one persistent entry in a top-level, name-keyed map in `scene_config.yaml`:

```yaml
pixelOrder:
  Left Front Wall 1: reversed
```

Wired exactly as the contract specifies — the `groupOverrides` idiom, so the flag survives
the destroy-and-recreate of every regeneration and of every boot.

| Contract item (§) | Built | Where |
|---|---|---|
| Top-level name-keyed store, `groupOverrides` idiom (2.1) | ✅ | `src/core/config.js` — load intercept before the `{value}` recursion; prune-on-persist + key deleted when nothing is reversed |
| Enum `normal`/`reversed`, lowercase, case-sensitive; everything else refused loudly (2.2) | ✅ | `src/dmx/pixel_order_store.js` (`pixelOrderFor` throws, quoting fixture + value + the fix) |
| Invalid enum throws **at model export**, aborting the whole save (2.2) | ✅ | exporter throw → `exportConfig`'s saveModelJS-first gate (already existed) — proven by a test that asserts zero POSTs |
| Single-pixel fixture entry refused at export (2.2) | ✅ | both the multi-pixel branch (`N < 2`) and the simple `fixture.light` branch |
| Stale entry = loud warn, never throw (2.2/2.7) | ✅ | `validatePixelOrderStore` returns `stale`; boot + save report it; the 🧹 button is the only remover |
| Grow preserves / shrink clears + warns at the `regenCasualties` site (2.3) | ✅ | `clearPixelOrderCasualties()` — `console.warn` + `showToast(ttl 14000)`, same channel/TTL as the resnap warning |
| Group delete routes through the same helper (2.3) | ✅ | trace `✕ Delete` handler |
| Rename carry, `carryTraceGroupOverride` twin (2.4) | ✅ | `carryPixelOrderEntries(store, old, new, count)`, called beside `carryTraceGroupOverride` and **before** the regenerate |
| Swap start/end: flags stay **name-stuck**; dialog gains the bullet + names REVERSED members (2.5) | ✅ | `confirmRenumber` — new bullet `• pixel-order flags (NORMAL/REVERSED)` + `Currently REVERSED: …`; the swap handler mutates no store |
| Exporter seam permutes the **wire association only** (2.6) | ✅ | DMX pixels: `channels` from slot `P(j)`. LED-bus pixels: `ledWalk[P(j)]` (finding F-6). Geometry / `localIndex` / `pixelSize` / name / `apply` stay at slot `j` |
| `pixelLocalIndex` semantics unchanged; sim preview unchanged; engine untouched (2.6) | ✅ | no engine file touched; `apply` still closes over `j` |
| UI toggle on generator-group members only, visible NORMAL/REVERSED (2.8) | ✅ | `Px →` / `Px ⇄ REVERSED` in the `isTraceGroup` fixture card, rendered only when the DEFINITION has > 1 pixel; toast says the effect lands on the engine's next model reload |
| GC button, explicit gesture, names listed, confirm first (2.7) | ✅ | `🧹 Clear stale pixel-order entries (N)` in the fixtures-panel header, shown only when stale entries exist |

New pure module: **`simulation/src/dmx/pixel_order_store.js`** — `pixelOrderFor`, `isReversed`,
`reverseIndex`, `wireSlot`, `validatePixelOrderStore`, `carryPixelOrderEntries`,
`clearCasualtyPixelOrder`, `casualtyClearMessage`, `reversedMembers`, `prunePixelOrder`,
plus the two refusal-message builders. No DOM, no THREE, no `window`.

## 2. Deviations from the contract (all deliberate, all small)

1. **`carryPixelOrderEntries` lives in `pixel_order_store.js`, not `trace_group_rename.js`.**
   The contract says both (§2.9's module list vs §5.1's file list). One module owning the whole
   store rule is the stronger reading, and `trace_group_rename.js` keeps its single concern. The
   call site is unchanged (beside `carryTraceGroupOverride` in `gui_builder`).
2. **Boot validation runs in `gui_builder`, not `main.js`.** The contract says "after trace
   auto-regen"; that loop lives in `gui_builder`'s `setupGUI` closure (the auto-regenerate at the
   end of the generator section). Validating from `main.js` could not be ordered against it
   without new global plumbing. A source test pins the ordering.
3. **Two validation entry points, one loud one quiet.** `reportPixelOrderStore(context)` is the
   loud pass (boot + every save: `console.warn`/`console.error` + toast). `pixelOrderStaleNames()`
   is the same computation without logging, used by `renderParGUI` to decide whether to draw the
   🧹 button — the panel re-renders constantly and must not toast on every render. Contract is
   silent on this; the behaviour it specifies (loud at boot and at save) is unchanged.
4. **`prunePixelOrder` keeps a non-enum value verbatim** instead of dropping it: it drops only the
   explicit `normal`. Silently deleting an operator's hand edit would be a destructive guess, and
   the export refuses that value and aborts the save long before a prune could run. Contract said
   "prune keeps reversed, drops everything normalized" — this is that, plus non-destructiveness.
5. **No live save-server round trip test.** The contract asks for a test proving `pixelOrder`
   round-trips POST `/save`. Spawning the save server would start a process and bind a port, which
   this agent's hard-safety brief forbids. Instead: (a) a YAML→`extractParams`→`reconstructYAML`
   →YAML round trip proves the client half, and (b) a source assertion proves the save server
   strips only **per-fixture/per-strand** keys (`delete fixture.X` / `delete strand.X`) and never
   mentions `pixelOrder` at all, so a top-level map passes through untouched. **Slice 3 should run
   the real HTTP round trip if it is allowed to bind a port.**
6. **UI was not visually verified.** Bringing up the sim would bind operator-owned ports. The GUI
   changes are pinned by source-contract tests; a human/agent with the sim running should
   eyeball the toggle and the 🧹 button once.

Known (pre-existing, not introduced): `captureSnapshot` stores plain params maps **by reference**,
so undo cannot restore a deleted `pixelOrder` key — exactly as it cannot for `groupOverrides`.
The 🧹 button still calls `pushUndo()` for consistency with the surrounding paths. Also as with
`groupOverrides`, `params.pixelOrder` is not cleared when a scene without the key loads; scene
switches reload the page, so this is unreachable today. Both left alone deliberately (changing
`undo.js` semantics for every map is out of slice 1's scope).

## 3. Files changed

| File | Change |
|---|---|
| `simulation/src/dmx/pixel_order_store.js` | **NEW** — the whole rule, pure |
| `simulation/src/core/config.js` | load intercept + prune-on-persist (+26 lines) |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | the P(j) seam + both single-pixel refusals (+46/-4) |
| `simulation/src/gui/gui_builder.js` | casualty helper, census + two validation passes, toggle, 🧹 button, rename carry, `confirmRenumber` copy, boot/save hooks (+244) |
| `simulation/tests/pixel_order_store.test.js` | **NEW** — 27 tests |
| `simulation/tests/pixel_order_export.test.js` | **NEW** — 15 tests |
| `simulation/tests/pixel_order_lifecycle.test.js` | **NEW** — 18 tests |

Not touched: `save-server.js`, `sacn_mapper.js`, `main.js`, `trace_group_rename.js`,
everything under `marsin_engine/`, every bench-mirror file (slice 2 / agent _176), and all
operator residue (patterns 66-73, manifest, calibration playlists, generated models,
`studiodj/`, `marsin_engine/states/**`).

## 4. Tests

**New: 60 tests, all passing** (27 store + 15 export + 18 lifecycle). Coverage against the
contract's slice-1 rows:

- all-NORMAL default byte-identical: exported model body compared across **no store / empty store /
  explicit `normal`** — identical strings (timestamp header normalised);
- REVERSED permutes the wire association **exactly once**: channel list is the exact reverse,
  every other field (`x/y/z`, `rx/ry/rz`, `nx/ny/nz`, `localIndex`, `pixelSize`, `name`, `type`,
  ids, `patch`) asserted unmoved slot by slot; involution asserted;
- survives export → YAML persist → reload → re-export byte-identically;
- ShehdsBar 18 px: 6-channel RGBWAU blocks move as one unit, role for role; `w`/`a` adjacency
  asserted (never swapped); control channels 1..11 never enter any pixel map;
- Vintage six heads: `value` 3..8 ↔ 8..3 head-wise, `rgb` 16..33 triplets reversed head-order with
  r→r/g→g/b→b inside; geometry still ascends 0..5;
- LED-bus fixture: stride blocks permute via `ledWalk` (addr 1,5,9,13,17,21 → 21,17,13,9,5,1),
  in-block controller order map untouched, unpatched stays unpatched;
- pars refuse (multi-pixel branch with N=1 **and** the simple `fixture.light` branch);
- invalid enum refuses (`'REVERSED'`, `'true'`, `true`, `1`) and **zero POSTs** are made;
- grow 4→5 preserves the flip on member 3; shrink 4→2 clears members 3-4 and the warn path
  (message + both channels + TTL) is asserted; shrink-then-regrow never resurrects;
- rename carry moves `<old> N` → `<new> N`, runs before the regenerate, sweep then clears nothing;
- Swap leaves flags name-stuck (handler contains no store mutation) and the dialog names REVERSED
  members;
- raw LED strands are explicitly out of scope: a strand entry is inert at export (documented
  extension), byte-identical model.

**Full sim suite** (`cd simulation && npm test`):

| | tests | pass | fail | todo |
|---|---|---|---|---|
| baseline (before my changes) | 2007 | 2000 | 6 | 1 |
| after | 2067 | 2034 | 32 | 1 |

2007 + 60 = 2067 ✅. Failing-LIST comparison (not totals):

- **No baseline failure disappeared** and **no new failure is in a file this slice touches.**
- The 26 new failures are **all** in `tests/bench_mirror.test.js` (1),
  `tests/bench_mirror_arm.test.js` (4) and `tests/bench_mirror_resolve.test.js` (21) — the
  Mechanism B suites, whose product files (`lib/bench_mirror_resolve.cjs`,
  `server/sacn_bridge.js`, `src/gui/bench_mirror_picker.js`, new `lib/bench_mirror_state.cjs`)
  are **mid-implementation in the shared working tree by agent _176**. Nothing in this slice is
  imported by any of them.
- The 6 baseline failures (bench_section_sync ×5, pixel_map_view_defaults ×1) and the 1 todo
  (scene_data_lint residue) are unchanged, verbatim.

Engine suite deliberately not run (slice 3 owns cross-suite regression).

## 5. Byte-identity proof — tests never touched the real scenes

SHA256 of every file under `simulation/scenes/test_bench/**` and `simulation/scenes/titanic/**`
(45 files), taken before the baseline run and after the post-change run:

```
manifest digest before : 8b59ea79d5bd09a7a71712099879e90bffe08e7876a499055e7f2e26bc619c1d
manifest digest after  : 8b59ea79d5bd09a7a71712099879e90bffe08e7876a499055e7f2e26bc619c1d
diff scenes_before.sha256 scenes_after.sha256 → empty
```

(the digest is of the sorted per-file hash manifest, so an identical digest means all 45 files are
byte-identical). Hashes live in `~/tmp/fix_175/`. The new tests need no scene root at all — they
build fixtures in memory and stub `fetch`, so nothing is written anywhere.

## 6. For slice 3 (_177)

1. **Failing-list baseline to use:** 6 pre-existing sim failures + 1 todo, named in §4. Any
   bench_mirror failure you see is _176's slice-2 state, not this slice's — re-baseline once
   slice 2 lands.
2. **The no-double-apply proof (§4 rows 5-8 of the design)** is untouched by this slice by
   construction: nothing here reads or writes anything the bridge consumes, and the store is a
   client-side scene map. A source grep proving `bench_mirror_resolve.cjs` never mentions
   `pixelOrder` is still yours to add (I deliberately did not add it — that file is _176's).
3. **Un-run items handed over:** (a) the real HTTP POST `/save` round trip for `pixelOrder`
   (I proved it structurally, not over the wire — see deviation 5); (b) a visual check of the
   `Px →` / `Px ⇄ REVERSED` toggle and the 🧹 button in a running sim.
4. **Where to look when a permutation is suspected:** `wireSlot(reversed, j, N)` in
   `pixel_order_store.js` is the ONLY place the permutation is computed, and it has exactly two
   call sites, both inside the DMX-fixture pixel loop of `pixelblaze_model_exporter.js`
   (`channels` and the LED-bus `patchObj`).
5. **Operator note worth carrying into the tracker:** the flag lands on hardware only at the
   engine's **next model reload** — the sim preview intentionally keeps showing model intent.
   The toast says so; the report's §2.6 rationale is the authority.

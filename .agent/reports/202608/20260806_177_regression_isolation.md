# _177 — cross-cutting regression, composition matrix and isolation proofs (slice 3)

Date: 2026-08-06 · Agent: _177 (Opus, validation) · Branch: feat/bm_readiness
Contract: `.agent/reports/202608/20260806_174_pixel_order_design.md` §4 + §5.3 + §5.4
Inputs: `_175` (Mechanism A, slice 1), `_176` (Mechanism B, slice 2) — both landed, both green.

Status: **GREEN.** The §4 matrix is closed empirically in both directions, the two suites match
their failing-list baselines exactly, and `simulation/scenes/**` + `marsin_engine/states/**` are
byte-identical across every run. No product code was changed — two test files were added. No
process started on an operator port, no ARM, no sACN, no hardware, no git operation.

---

## 1. The composition matrix (§4) — empirical, both mechanisms in one tree

New file: **`simulation/tests/pixel_order_composition.test.js`** (31 tests).

`_175` proved Mechanism A alone, `_176` proved Mechanism B alone plus the *structural* half of the
no-double-apply claim (the resolver has no code path that could read a pixel-order store). What was
left open — and is closed here — is the *empirical* half: one identifiable colour ramp pushed
through the whole chain with every combination of the two mechanisms.

**What the test actually runs.** Not a re-derivation: the REAL `generatePixelMap` exports the source
fixture's model from the REAL fixture definition at the REAL scene patch, and the REAL
`resolveBenchMirror` / `computeSlices` / `createMirrorState` / `spliceMirrorFrame` / `mirrorPayload`
carry the bytes. The engine is emulated only in the one place it has to be — writing the ramp onto
the channel numbers the exported model itself declares.

- `S_src` = Mechanism A on the ship fixture → the exported model puts model slot `j`'s channel block
  at definition block `S_src(j)`, so source wire block `m` carries `c(S_src(m))`. Asserted directly,
  slot by slot, rather than assumed.
- `M` = the Mechanism B slot toggle → dest wire block `k` := source wire block `M(k)`.
- `S_dst` = Mechanism A on the bench fixture → injected into the bench scene tree **in memory**.

**Two fixture types, deliberately:** ShehdsBar (18 contiguous 6-channel blocks after 11 control
channels) and VintageLed (six heads on NON-CONTIGUOUS lanes, `value` 3..8 + `rgb` 16..33, controls
at 1,2 and 9..15) — the one a naive footprint-wide byte reversal gets wrong.

**All 16 rows (8 per type) pass, lane for lane:**

| # | S_src | M | S_dst | dest block k carries | ShehdsBar | VintageLed |
|---|---|---|---|---|---|---|
| 1 | N | N | N | `c(k)` | ✅ | ✅ |
| 2 | N | R | N | `c(R(k))` | ✅ | ✅ |
| 3 | R | N | N | `c(R(k))` | ✅ | ✅ |
| 4 | R | R | N | `c(k)` | ✅ | ✅ |
| 5 | N | N | **R** | byte-identical to row 1 | ✅ | ✅ |
| 6 | N | R | **R** | byte-identical to row 2 | ✅ | ✅ |
| 7 | R | N | **R** | byte-identical to row 3 | ✅ | ✅ |
| 8 | R | R | **R** | byte-identical to row 4 | ✅ | ✅ |

Rows 5-8 are asserted twice over: the resolved mirror **tree** is deep-equal with and without the
bench flag, and the **composed payload** is deep-equal. Both had to hold — a byte difference either
way would mean the correction is applied twice.

Every row additionally asserts the fixture's **control channels are identity-copied** (ShehdsBar
1..11; Vintage 1,2 and 9..15), so no row can quietly feed a master dimmer or a macro lane with pixel
data.

**Three tests that make the matrix non-vacuous** (a passing "nothing changed" row proves nothing
unless the thing you flipped demonstrably does something):

1. *The S_dst flip is REAL.* The bench fixture's own exported model is exported with and without the
   flag; the two differ, and differ by exactly one end-for-end permutation. So rows 5-8 are
   "a live flag that changes the bench's standalone model leaves the mirrored wire untouched",
   not "a no-op flag changed nothing".
2. *The source scene flag never reaches the mirror tree either.* Both scene trees carrying flags,
   resolved: `spec` and `slots` deep-equal the unflagged resolution.
3. *M is relative orientation.* For each `S_src`, exactly ONE value of `M` puts model slot `k` on
   bench block `k` — and which one it is differs between `S_src=N` and `S_src=R`. That is the
   `M = G_s ∘ G_d` statement with `G` held fixed, and it also proves `S_src` and `M` each genuinely
   move the bytes (otherwise no single `M` could be singled out).

The ramp has no fixed points under `R` (N = 18 and N = 6 are both even), so a double application
could not hide behind an accidental identity.

**Not covered, by construction:** the `led_0` / `led_1` slots. Their destination is a raw LED strand
and their source (`Left_Front_Left`) is a raw strand too, and raw strands are explicitly OUTSIDE
Mechanism A's scope (design §2.9 — manually-placed things are flipped in 3D directly). There is no
`S_src`/`S_dst` to combine there; Mechanism B's strand reversal is already proved byte-level by
`_176`'s `bench_mirror_reverse.test.js`.

## 2. `_176`'s LIVE-tier precondition

`_176` §8.2 asked for a guard that fires if a Mechanism A flag ever lands on the four fixtures its
LIVE orientation tier compares. **It already existed** — inside the two async pairing tests in
`bench_mirror_reverse.test.js` (lines ~297-302), covering all four (`Bar Left`, `Bar Right`,
`Left Front Wall 1`, `Left Front Wall 2`). Verified present and correct; nothing changed there.

Added alongside it: a **standalone, always-run guard** in the new composition file naming all four
fixtures in one place, so a flag on any of them fails with an explicit "recompute that tier and
re-verify with calibration pattern 71" instruction rather than surfacing as an arithmetic mismatch
buried inside a pairing assertion. Both scenes are confirmed to carry no `pixelOrder` key at all
today.

## 3. Real HTTP `/save` round trip — DONE (both hooks are injectable)

`simulation/server/save-server.js` was inspected first, as instructed. **Both** required seams
exist and are documented as explicit test-only config hooks:

- `SIM_SAVE_SERVER_PORT` (line ~76) — validated to a real port or it throws;
- `SIM_SAVE_SERVER_ROOT` (line ~34) — substitutes for `SIM_ROOT`, and `SCENES_ROOT` + the backup
  roots derive from it.

So the round trip ran, in **`simulation/tests/pixel_order_save_roundtrip.test.js`** (4 tests): a
real `save-server.js` child on an **OS-assigned ephemeral port** (bind `:0`, read it, release it —
plus an explicit refusal if the OS ever handed back one of the operator-owned ports) with its root
under `~/tmp/fix_177/`. Nothing operator-owned was bound and no live process was touched.

Proved:

- `pixelOrder` survives a real POST `/save` **key for key and value for value** — and the save
  demonstrably rewrote the tree around it (the DMX keys were split out of `dmxLights` into
  `patches.yaml`), so this is not the trivial "nothing happened" case;
- the store did not leak into `patches.yaml`;
- fixture names with spaces and trailing digits survive verbatim, in order (a key that got quoted,
  trimmed or re-cased would orphan every flag at the next boot);
- an empty store stays empty, and **a save with no store never invents one**.

`_175`'s deviation 5 and `_176`'s open item 5 are closed.

## 4. Regression baselines — failing LIST, not totals

**Simulation** (`cd simulation; npm test`):

| | tests | pass | fail | todo |
|---|---|---|---|---|
| baseline (this tree, before my files) | 2117 | 2110 | 6 | 1 |
| after (+35 new) | 2152 | 2145 | 6 | 1 |

Failing list **identical, byte for byte**, to `_176`'s baseline:

```
tests\bench_section_sync.test.js:119:1
tests\bench_section_sync.test.js:221:1
tests\bench_section_sync.test.js:271:1
tests\bench_section_sync.test.js:451:1
tests\bench_section_sync.test.js:460:1
tests\pixel_map_view_defaults.test.js:487:1
tests\scene_data_lint.test.js:109:1        (the todo — summer_camp_dome residue)
```

**Engine** (`cd marsin_engine; npm test`): **2802 tests / 2794 pass / 8 fail / 0 todo.** The engine
was not edited by any slice in this wave, and none of the 8 is a wave regression:

```
tests\audio\audio_capture.test.js:78,109,127,150,221   (5× known win32 environmental)
tests\io\osc_listener.test.js:525                       (known EADDRINUSE environmental)
tests\effects\effects_v2_mode_page_layout.test.js:1     (known file-level)
tests\patterns\calibration_patterns.test.js:86          (NEW NAME — see below)
```

**The 8th name is operator residue, not a regression.** `marsin_engine/tests/patterns/`
`calibration_patterns.test.js` is an **untracked** file in the working tree, and it asserts that the
two **untracked** `simulation/scenes/{titanic,test_bench}/playlists/calibration.yaml` files are
byte-identical — they are not (3244 B vs 3156 B). All three files carry mtimes from before this
session and are byte-identical before and after every run I made. Nothing in `_174`/`_175`/`_176`/
`_177` touches playlists, patterns or the engine. **Flagged for the operator, not fixed** — it is
protected residue and the divergence is an operator decision.

`performance_mode.test.js` (the known contention-flaky one) did **not** fail; no isolation re-run
was needed.

**Parity suites, run explicitly for a named verdict:**

- sim `scene_model_parity` + `te_sign_grouping_parity` + `led_halo_parity`: **80/80 pass**;
- engine `io/led_dmx_parity` + `tools/view_catalog_parity`: **34/34 pass**.

## 5. Isolation proofs

**SHA256 manifests, before any run and after ALL runs** (sim baseline suite → engine suite → sim
full suite with the new tests → the new suites individually → parity suites):

```
simulation/scenes/**        81 files
  manifest digest before  : 95b2ad8df8c2b9d1034334c6fc2ee612576f5f07b3904f99bdae9fdd57e623f2
  manifest digest after   : 95b2ad8df8c2b9d1034334c6fc2ee612576f5f07b3904f99bdae9fdd57e623f2
  diff before/after       : empty

marsin_engine/states/**     40 files
  manifest digest before  : c1f44c9a6e886e8f26b6d2dd4449627011597e7d747f69ff9278f3eee63ebed6
  manifest digest after   : c1f44c9a6e886e8f26b6d2dd4449627011597e7d747f69ff9278f3eee63ebed6
  diff before/after       : empty
```

(the digest is of the sorted per-file hash manifest, so an identical digest means every one of the
121 files is byte-identical). Raw manifests in `~/tmp/fix_177/`.

**No stray state file.** `find simulation/scenes -name 'bench_mirror_state.yaml*' -o -name '*.tmp-*'`
→ **0** after every run.

**The test-write guard, exercised independently** (not merely trusted from `_176`'s suite). A
standalone `node --test` probe in `~/tmp/fix_177/guard_probe.test.js` required the real
`simulation/lib/bench_mirror_state.cjs` and:

- aimed a write at the repo's real `simulation/scenes/test_bench/` → **refused**, message naming
  `NODE_TEST_CONTEXT is set`, and **no file and no `.tmp-*` appeared** in that directory;
- aimed a path at `../../escape` → **refused** by `benchMirrorStatePath`;
- wrote to an injected scratch root → **succeeded** and read back exactly, so the two refusals are
  the guard working, not the writer being broken.

**Port audit of the new test files** (`pixel_order_store`, `pixel_order_export`,
`pixel_order_lifecycle`, `bench_mirror_reverse`, `bench_mirror_state`, `helpers/bridge_harness.mjs`,
plus my two): **no test binds an operator port.** The bench harness replaces `sacn` and `ws` with
fakes keyed by port — nothing is bound at all. `pixel_order_export`'s `save_port: 6970` is inert mock
data on a stubbed `window.serverConfig`; every call that could reach the network runs inside a
`fetch` stub, and the one throwing case asserts **zero** POSTs. My round-trip test is the only one
that binds anything, and it binds an OS-assigned ephemeral port with an explicit operator-port
refusal.

**Pre-existing finding, worth the operator's attention (NOT from this wave, NOT fixed).**
`simulation/tests/launcher_supervision.test.js`'s L1 end-to-end case spawns the real `start.js`
against the **real** `SIM_ROOT` (its ports are throwaway 786x/787x + UDP 7568 — it never touches
the operator's, and says so). The save server it launches regenerates two manifests in the repo
tree at startup: `simulation/scenes/manifest.json` and `marsin_engine/patterns/manifest.json`. Both
writes are **content-idempotent** and were verified so — the scenes manifest is inside the
byte-identity proof above and did not move, and the pattern manifest on disk was confirmed to equal
exactly what `listPatterns()` regenerates from the current patterns directory (no pattern file has
changed since before this session). So no operator data was altered; only the two mtimes moved.
Still: this is the one place the sim suite writes into the tracked tree, and the same
`SIM_SAVE_SERVER_ROOT` hook that every other save-server test uses would close it.

## 6. Static sweeps

**(a) The resolver never reads a pixel-order store — re-run independently.** `_176`'s contract test
was re-executed and the grep repeated by hand over a WIDER set than the contract names (its four
files plus the three GUI consumers):

```
lib/bench_mirror_resolve.cjs            0 hits
lib/bench_mirror.cjs                    0 hits
lib/bench_mirror_state.cjs              0 hits
server/sacn_bridge.js                   0 hits
src/gui/bench_mirror_picker.js          0 hits
src/gui/bench_mirror_banner.js          0 hits
src/gui/modern/controller_map_panel.js  0 hits
```

(pattern: `pixelOrder` OR `pixel_order`). Zero everywhere.

**(b) No new fallback behaviours.** Every `catch` and every default introduced by the two slices was
read in context. All are loud:

- bridge ARM state write → `console.error` + `broadcastLog` + `warnings[]`, and deliberately does
  NOT unwind the arm (the hardware already changed hands; only the picker pre-fill is lost);
- `gui_builder` boot/save validation → `console.error` + toast; the quiet twin
  (`pixelOrderStaleNames`, used only to decide whether to draw the 🧹 button on a panel that
  re-renders constantly) still `console.error`s;
- the per-fixture toggle → renders `⚠ Px INVALID` with the message as its tooltip and `alert()`s
  rather than guessing which enum member was meant;
- `confirmRenumber` → prints `(unreadable — …)` inline rather than omitting the line the operator is
  about to decide on;
- `readBenchMirrorState` returns an `error` string that every caller prints verbatim; it never
  half-applies a file.

Absence-is-normal (`pixelOrderFor`) and absence-is-empty (`emptyBenchMirrorState`) are DEFINED
default states with the design's precedent, not fallbacks — and a YAML `Fixture:` with no value
parses to `null`, which is refused, not coerced.

**(c) No dotted-quad IPs and no future dates** in the `.agent/**` prose this wave produced
(`_174`, `_175`, `_176` reports + the tracker block): scanned, zero hits.

## 7. Findings for the operator — reported, not decided

Neither is a defect I was willing to "fix" unilaterally; both are contract-vs-implementation
ambiguities.

**F-177-1 — a stale remembered picker row falls back to the SIDECAR DEFAULT, not to nothing.**
Design §3.3 and `_176` §1.3 both say a row whose stored source no longer resolves "pre-fills
NOTHING". The implementation shows the stale note and the remembered value, forces `reverse` to
false, and then pre-fills the sidecar's `default_source` — which `_176`'s own test pins in as many
words ("the row falls back to the sidecar default, NORMAL",
`bench_mirror_arm.test.js`). Assessment: low physical risk — the sidecar default is a declared,
checked-in mapping, it is exactly what the picker offered before persistence existed, and arming
still needs an explicit operator confirm on a row carrying a visible stale note. But it is not what
the design sentence says, so the operator should rule: keep it (and correct the design wording), or
make a stale row pre-fill `none`.

**F-177-2 — a malformed top-level `pixelOrder:` scalar is silently ignored at scene load.**
`extractParams` intercepts the key only when it is an object (`config.js`), so a hand-edited
`pixelOrder: reversed` (a string where a map belongs) is skipped by the intercept, skipped again by
the generic recursion, and then deleted from the file at the next save. That is the exact
`groupOverrides` / `pixelMap2d` idiom the design mandated ("wired **exactly like** `groupOverrides`",
§2.1), so changing it unilaterally would be a redesign of a shared pattern rather than a slice-3
fix. Worth a decision because a silently-dropped hand edit is the shape of thing the codex bans; a
one-line `console.error` on "key present but not a plain object" would close it for all three maps
at once.

## 8. Files

**New (this agent, tests only — no product code touched):**

| File | What |
|---|---|
| `simulation/tests/pixel_order_composition.test.js` | 31 tests — the §4 matrix ×2 fixture types, the non-vacuity trio, the four-fixture LIVE precondition guard |
| `simulation/tests/pixel_order_save_roundtrip.test.js` | 4 tests — the real HTTP POST `/save` round trip on an ephemeral port + scratch root |

Scratch (gitignored, outside the source tree): `~/tmp/fix_177/` — SHA256 manifests, both suite
logs, the write-guard probe, the save-server scratch root.

**Untouched:** every product file of both slices, `marsin_engine/**`, `bench_mirror.yaml`, and all
operator residue (patterns 66-73 and their manifest, the two calibration playlists, the generated
models, `simulation/scenes/studiodj/*`, `marsin_engine/states/**`) — verified by mtime and by the
byte-identity manifests above.

## 9. Left for the operator smoke

Carried forward from the two slices; none of it could be done without a live stack or hardware:

1. **Visual check of the Mechanism A affordances** — the `Px →` / `Px ⇄ REVERSED` per-fixture
   toggle and the `🧹 Clear stale pixel-order entries (N)` button in the DMX Fixtures panel
   (`_175` deviation 6).
2. **Visual check of the Mechanism B picker affordances** — the per-row `⇄ REVERSED` / `→ NORMAL`
   toggle and badge, the stale-row note, and `↺ scene defaults` (`_176` §8.4). Their pure state is
   fully unit-tested; only the DOM rendering is unverified.
3. **First physical test of a REVERSED slot: Wall 1 → Bar Left with calibration pattern 71** — the
   exact case the LIVE tier models. Nothing in this wave has been near hardware.
4. **Remember the reload semantics:** a Mechanism A flag lands on hardware only at the engine's
   **next model reload**; the sim preview intentionally keeps showing model intent. The toast says
   so.
5. **F-177-1 and F-177-2 above** need an operator ruling.
6. **The `calibration_patterns` engine test** fails on the operator's own two untracked calibration
   playlists diverging — an operator decision about which playlist is right, not a code fix.

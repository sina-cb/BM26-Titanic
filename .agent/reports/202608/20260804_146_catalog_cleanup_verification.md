# `_146` — Adversarial verification of the `_145` mixer view catalog cleanup

Independent **read-only verifier** thread, branch `feat/bm_readiness`, dated
2026-08-04. Every number below was re-derived from the repo with probes written
for this thread — none of `_145`'s figures were reused, and its report was read
only after the truth had been established independently.

**Overall verdict: CONFIRMED with two documented discrepancies, neither
functional.** Every operator-acceptance line about the *catalog itself* — the
counts, the memberships, the bits, the removals, the loud failures, the docs, the
fixture ABI — holds exactly as specified. The two discrepancies are (1) a
bookkeeping error in `_145`'s test-count reconciliation and (2) an incomplete
stale-reference sweep claim. A third finding, pre-existing and **not** caused by
`_145`, is that the offline pattern harnesses cannot resolve the derived
auto-views at all — so `inView("LEFT")`, which the rewritten docs now actively
recommend, compiles on the rig but **fails** in `tools/pattern_audio_harness.mjs`.

**Safety.** No source, test, doc, scene or model file was modified. No git
operation of any kind (read-only `git status` / `git diff` / `git show
HEAD:<file>` only — comparison, not state mutation). No engine or sim booted, no
port bound by this thread; the operator's stack kept 6966–6972, 5568, 8081,
10000. Probes live in the session scratchpad.

---

## 1. Verdict per acceptance line

| # | Acceptance line | Verdict |
|---|---|---|
| 1 | `LEFT` = 482, `RIGHT` = 482, ∩ = 0, ∪ = all 964 | **CONFIRMED** |
| 2 | Each half: wall bars, ropes, Vintage rails, stacks, auditorium pars, exactly one TE sign (~74) | **CONFIRMED** |
| 3 | `FRONT`/`BACK` resolve; `FORE`/`AFT`/`PORT`/`STARBOARD`/`BAND_*` do not; zero `*_BOTH` | **CONFIRMED** |
| 4 | `Strands` = 320 rope px; both-signs type view = 148 px; disjoint | **CONFIRMED** (name is `TE Signs`) |
| 5 | Seven composites at exact counts + prior `(word,bit)`; ten L/R variants gone | **CONFIRMED** |
| 6 | `inView("<removed>")` is a loud compile error naming the view | **CONFIRMED** via real `WasmHost.compile()`; see §4 caveat on the offline harness |
| 7 | 24 base group bits byte-identical to HEAD; zero bit collisions; no stale sidecar entries | **CONFIRMED** |
| 8 | Repo-wide stale-reference sweep clean | **CONFIRMED with exception** — one stale tracked artifact `_145` did not account for |
| 9 | Docs say seven composites, LEFT/RIGHT halves, removed aliases hard-fail, exact spelling; zero stale names/counts | **CONFIRMED** |
| 10 | Fixture ABI: `FIX_*` unrenumbered; `FIX_TE_SIGN` appended (7), previously-UNTYPED pixels only | **CONFIRMED** |
| 11 | Suites | **CONFIRMED with discrepancy** — totals match; `_145`'s +16/2627 delta attribution is wrong (actual +14 / 2629) |
| 12 | `security_check.py --all` = 6 pre-existing findings in untracked `.scene_backups/studiodj/**` | **CONFIRMED** |

Judgement calls (a) `TE Signs` collision, (b) `WALLS`/`AUDITORIUM` byte-identity,
(c) the centreline claim — **all three CONFIRMED**, §3.

---

## 2. Evidence, line by line

Probes drive the same modules the engine loads through: `lib/model_loader.js`
`loadModelForGauge('titanic')` → `lib/auto_views.js` `deriveAutoViews()` →
`lib/mask_registry.js` `buildMaskRegistry()`, with the `existingMaskNames` set
assembled exactly as `engine.js:560-564` does.

### [1] `LEFT` / `RIGHT` — CONFIRMED

```
pixelCount 964 · 24 base groups · 7 sidecar presets · 29 auto-views · 60 masks
LEFT 482 · RIGHT 482 · intersection 0 · union 964 of 964 · in NEITHER: 0
deriveAutoViews warnings: []   (no centreline pixel, no straddling controller)
```

### [2] Half composition — CONFIRMED

Both halves are structurally identical, and each carries exactly one sign group:

| Component | LEFT | RIGHT |
|---|---:|---:|
| wall bars (`* Wall`, `ShehdsBar`) | 180 | 180 |
| rope strands (`*_Left` / `*_Right`, untyped LED) | 160 | 160 |
| Vintage rails (`* Rails`, `VintageLed`) | 48 | 48 |
| stacks (`* SmokeStack(s)`, `UkingPar`) | 12 | 12 |
| auditorium pars (`* Auditorium`, `UkingPar`) | 8 | 8 |
| TE sign (`TE Sign` / `TE Sign 2`) | **74** | **74** |
| **total** | **482** | **482** |

Fixture-type breakdown per half is also symmetric: 180 `ShehdsBar`, 160 untyped
strand, 48 `VintageLed`, 20 `UkingPar`, 40 `TeSignV3A40`, 34 `TeSignV3B34`.

### [3] Name resolution — CONFIRMED

`FRONT` 388 px and `BACK` 388 px resolve. `FORE`, `AFT`, `PORT`, `STARBOARD`,
`BAND_LOW`, `BAND_MID`, `BAND_HIGH` all return `null` from the registry.
`registry.names().filter(/_BOTH/)` → `[]` (0 entries).

### [4] `Strands` / `TE Signs` — CONFIRMED

`Strands` = **320**, `TE Signs` = **148**, intersection **0**. The registered
name is `TE Signs` (plural), not the operator's literal `TE Sign` — see §3(a).
Also verified: `@BAR` 360, `@PAR` 40, `@VINTAGE` 96, and the base groups
`TE Sign` 74 / `TE Sign 2` 74.

### [5] The seven retained composites — CONFIRMED

Sidecar preset order is exactly `Hull Canvas, Silhouette, Jewelry, Organs,
Identity, Stacks, Auditoriums` — nothing else.

| View | word | bit | px | expected |
|---|---:|---|---:|---|
| Hull Canvas | 1 | `0x400` | 360 | match |
| Silhouette | 1 | `0x2000` | 320 | match |
| Jewelry | 1 | `0x10000` | 96 | match |
| Organs | 1 | `0x4` | 40 | match |
| Identity | 1 | `0x20` | 148 | match |
| Stacks | 1 | `0x40` | 24 | match |
| Auditoriums | 1 | `0x200` | 16 | match |

`git diff marsin_engine/models/titanic.viewmasks.js` shows **exactly ten**
deletions and zero additions in the `viewMasks` array (`Left/Right Hull`,
`Left/Right Silhouette`, `Left/Right Jewelry`, `Left/Right Organs`,
`Left/Right Stacks`) plus the `// Updated:` stamp. The scene registry
`simulation/scenes/titanic/views.yaml` shows the mirror change: 66 deletions,
**0 insertions**, `groupBits:` untouched. Registry scan for
`^(Left|Right) (Hull|Silhouette|Jewelry|Organs|Stacks)` → 0 hits.

### [6] `inView()` loud failure — CONFIRMED

Run through the **real** `lib/wasm_host.js` `WasmHost.compile()` with the
engine-parity `viewTable` (base groups + sidecar presets + auto-views) and the
`createBitFreeViewPromoter` the engine wires. A fresh host per name so promotion
state cannot leak.

Every one of these produced `COMPILE_FAIL: Pattern references unknown view(s)
via inView(): <name>. Known views for this model: …` — and the error text
**names the offending view** in each case:

`Left Hull` · `Right Hull` · `Left Silhouette` · `Right Silhouette` ·
`Left Jewelry` · `Right Jewelry` · `Left Organs` · `Right Organs` ·
`Left Stacks` · `Right Stacks` · `PORT` · `STARBOARD` · `FORE` · `AFT` ·
`BAND_LOW` · `BAND_MID` · `BAND_HIGH` · `WALLS_BOTH` · `Hull Canvas_BOTH` ·
`LEFT_BOTH` · `RAW` · `@RAW`

Positive controls all **COMPILED OK**: `Hull Canvas`, `Silhouette`, `LEFT`,
`RIGHT`, `Strands`, `TE Signs`.

**Caveat (pre-existing, not caused by `_145`) — see §4.**

### [7] Bit hygiene — CONFIRMED

`git diff` on the sidecar shows the `groupBits` block **byte-for-byte
unchanged** from HEAD (the diff hunks touch only the header stamp and the
`viewMasks` array). Independent collision scan: 24 distinct word-0 bits across
the base groups, 7 distinct word-1 bits across the presets, **zero** collisions
within either word. No stale sidecar entries — `assignGroupBits()` throws on any
`missing:`/`stale:` drift and the model loads clean; a direct set-difference of
`Object.keys(groupBits)` against the model's distinct group names is empty in
both directions.

### [8] Repo-wide stale sweep — CONFIRMED WITH ONE EXCEPTION

Sweeping `simulation/`, `marsin_engine/`, `CaptainPad/`, `docs/`,
`.agent/skills/` for every removed name (word-boundary anchored; substring traps
such as `FOREACH`, `RAFT`, `AFTER`, and
`default_top_down_resolves_BOTH_chimney_rings` in
`simulation/agent_tools/name_index_parity_verify.cjs` accounted for and
dismissed):

Every hit in `lib/auto_views.js`, `tests/mixer/auto_views.test.js`,
`tests/mixer/titanic_view_catalog.test.js`,
`CaptainPad/components/view_selection_picker_logic.{ts,test.ts}`,
`docs/MARSIN_ENGINE_PATTERNS.md` and `.agent/skills/highdef_pattern_generation.md`
is either **documenting the removal** or **asserting the absence** — legitimate.
Every bare `PORT` hit elsewhere in the sweep dirs is a network-port identifier
(`gallery/server.mjs`, `companion_server.js`, `osc_synth.mjs`, the HIL harnesses,
`load_ports.cjs`, `midi/manager.ts`, …) — unrelated.

**The exception `_145` did not account for:**

- `marsin_engine/tools/param_truth/param_truth_results.md` line 37
- `marsin_engine/tools/param_truth/param_truth_results.json` (one occurrence)

Both are **tracked** files inside the sweep scope and both record
`examples/inview_demo` failing with `Pattern references unknown view(s) via
inView(): PORT`. That recorded run is now doubly stale: `inview_demo.js` no
longer says `PORT` (`_145` re-pointed it to `LEFT`), and the "Known views"
list in the same record names an **older** titanic model (`Right Front Wall
Generator`, `Left Top Chimney Generator`, …) that no longer exists. Severity is
low — these are generated result snapshots that a future param-truth sweep
regenerates — but `_145` §4.6's claim that *"the only other `PORT` hits in the
repo are `control_podium/**/deploy.py` SSH port credentials"* is **not accurate**.
`_145`'s quoted grep pattern (`STARBOARD|BAND_LOW|BAND_MID|BAND_HIGH|_BOTH|@RAW|Left Hull|…`)
does not contain a bare `PORT` term, which is the most likely reason it was missed.

Out of sweep scope but worth noting for completeness: `.agent/projects/bm_readiness_mapping.md:103`
mentions `_BOTH` pairs in a dated historical bullet — legitimately historical,
correctly left intact.

### [9] Docs truth — CONFIRMED

- `docs/MARSIN_ENGINE_PATTERNS.md` §7.3.1 now reads **"31 names … 7 composite
  views plus the 24 base groups"** with a seven-row table whose counts match my
  probe exactly. New §7.3.2 tabulates the derived auto-views —
  `LEFT` 482 · `RIGHT` 482 · `FRONT` 388 · `BACK` 388 · `WALLS` 360 ·
  `AUDITORIUM` 16 · `Strands` 320 · `TE Signs` 148 · `@BAR` 360 · `@PAR` 40 ·
  `@VINTAGE` 96 · `CTRL_1…CTRL_18` — **every figure matches my independent
  registry dump**. The "names that do NOT exist" list is complete and correct,
  and **"Exact spelling is mandatory"** is stated explicitly.
- `docs/COLOR_THEORY.md` §2/§4 no longer offer the removed half-composites and
  route halves through `LEFT`/`RIGHT`.
- `docs/MARSIN_PB_LANG_SPEC.md` carries `FIX_TE_SIGN` = 7.
- `.agent/skills/highdef_pattern_generation.md` §3.1 states seven composites,
  `LEFT`/`RIGHT` = 482 each, the explicit removed-name list, the derived-view
  list, and **exact spelling mandatory**; the "17 titanic composite views"
  phrase in the harness note is corrected to "seven".

Stale-count scan for `17 composite` / `17 view` / `41 names` / `41-name` across
`docs/`, `simulation/`, `marsin_engine/`, `CaptainPad/`, `.agent/skills/`
returns **zero** hits.

### [10] Fixture ABI — CONFIRMED

`git show HEAD:marsin_engine/lib/fixture_type_constants.js` lists exactly ids
1–6 (`FIX_RAW_LED`, `FIX_PAR`, `FIX_VINTAGE_6`, `FIX_BAR_18`, `FIX_HAZE`,
`FIX_FOG`) with identical `types` arrays. The working tree adds **one** entry:
`{ id: 7, role: 'FIX_TE_SIGN', types: ['TeSignV3A40', 'TeSignV3B34'] }`.
Neither `TeSignV3A40` nor `TeSignV3B34` appears anywhere in the HEAD registry,
so those pixels resolved to `UNTYPED_ID` (0) before — the change is strictly
additive and nothing that already resolved to a `FIX_*` role moved. The affected
pixel population is exactly the 148 sign pixels (80 × `TeSignV3A40` + 68 ×
`TeSignV3B34`).

### [11] Suites — CONFIRMED, with a delta-attribution discrepancy

| Suite | Observed | `_145` claim |
|---|---|---|
| `simulation` `node tools/scene_model_parity.cjs titanic` | **PASS** — 0 errors, 0 warnings, 1 info | match |
| …`--strict` | **PASS** — 0 errors, 0 warnings, 1 info | match |
| `simulation && npm test` | **tests 1773 · pass 1766 · fail 7** | match |
| `marsin_engine && npm test` | **tests 2643 · pass 2635 · fail 8** | 2643/2636/7 |
| `tests/mixer/**` (glob, in isolation) | tests 510 · pass 505 · fail 5 | 510/510 |
| view-specific mixer files only | **101 / 101 / 0** | — |
| `tests/patterns/*` + `tests/tools/*.test.mjs` | **107 / 107 / 0** | match |
| CaptainPad `npx vitest run components/view_selection_picker_logic.test.ts` | **32 / 32** | match |

The simulation suite matches the claimed baseline **exactly**; its 7 failures
are the known scene-content families (`test_bench` `strand_metadata_drift` ×2,
`fixtures are docked beside the ship`, `the compression threshold has real
headroom`, and the three `TGT_UNIVERSE_RESERVED` bench-block tests) — none
view-related, none touching titanic views.

The engine suite's **8th** failure is
`tests/io/fire_sync_listener.test.js` → *an ON edge sets the effect and an OFF
edge clears it after the min-ON hold*. **Re-run alone it passes 14/14** — a
timing flake on a loaded box, not a regression. The other 7 are `_145`'s stated
environmental set (5× `audio_capture` `device_not_configured`, the
`effects_v2_mode_page_layout` file-level deserialize error, and OSC
`EADDRINUSE`/`EACCES` on the operator's live stack). **Zero view-related
failures.**

The 5 failures in the `tests/mixer/**` glob run are all in
`deck_entry_autocapture.test.js` / the pre-show snapshot tests and surface as
HTTP **409** conflicts — order/state dependence against the operator's live
stack. They **pass inside the full `npm test` run**, so they are not a `_145`
regression; `_145`'s clean 510/510 was simply a luckier environment.

**Discrepancy — the test-count delta.** `_145` attributes the engine suite's
2643 total to *"+16 tests authored here (9 new in `titanic_view_catalog.test.js`,
+7 net in `auto_views.test.js`), on a 2627 baseline"*. Counting `test()` calls:

| File | HEAD | now | delta |
|---|---:|---:|---:|
| `tests/mixer/titanic_view_catalog.test.js` (new) | — | 9 | +9 |
| `tests/mixer/auto_views.test.js` | **15** | 20 | **+5** |
| `tests/mixer/in_view_intrinsic.test.js` | 19 | 19 | 0 |
| `tests/mixer/view_mask_constants.test.js` | 21 | 21 | 0 |
| `tests/mixer/model_loader_word_aware.test.js` | 14 | 14 | 0 |
| `tests/io/fixture_type_constants.test.js` | 11 | 11 | 0 |
| **total** | | | **+14** |

`auto_views.test.js` had **15** tests at HEAD (I listed them by name from
`git show HEAD:`), not the 13 `_145`'s §1 table states, so the net there is +5
not +7 and the whole delta is **+14**, implying a pre-`_145` baseline of
**2629**, not 2627. The observed total (2643) is correct in both accounts; only
the reconciliation arithmetic is off by 2. No functional impact — I could not
independently confirm the true HEAD baseline number without a git state
operation, which is out of scope for this thread, but the file evidence is
unambiguous.

**Runtime residue.** `marsin_engine/states/titanic/mixer_state.yaml` carries
`pattern: 00_golden_hour_wash`, `cursor: 0`, `viewSelection: {type: viewMask,
target: Stacks}` against HEAD's `11_bioluminescence` / `cursor: 20` /
`type: all`. That diff was **already present when this thread started** and is
**byte-identical after** all my suite runs — my runs produced no new residue.
Reported, never reverted. `target: Stacks` is a retained view, so the state is
still valid.

### [12] Security check — CONFIRMED

`python scripts/security_check.py --all` → `leaks found: 6`. All six are
`bm26-mac-address` findings on line 36 of
`simulation/.scene_backups/studiodj/<timestamp>/scenes/studiodj/controllers.yaml`
across six backup snapshots. `git ls-files simulation/.scene_backups` returns
nothing and `git status --ignored` reports the directory as ignored — **untracked,
zero new findings**.

---

## 3. The three flagged judgement calls

### (a) `TE Signs` vs the operator's literal `TE Sign` — the collision is REAL, and the refusal is LOUD

Confirmed empirically:

- A base group named **exactly** `TE Sign` exists (74 px, the port sign) and is
  one of the 24 byte-preserved bits. `TE Sign 2` exists too. No group named
  `TE Signs` exists.
- Registering an operator-named typed view under a name already owned now
  **throws**, it does not silently skip. Forcing the clash (pre-seeding
  `TE Signs` into `existingMaskNames`) produced:

  > `deriveAutoViews: the fixture-type view 'TE Signs' collides with an existing
  > group or preset of the same name — one operator-facing name cannot mean two
  > different pixel sets.`

- The `@`-prefix immunity still behaves as documented: pre-seeding `@BAR`
  produces **no throw**, and the view is skipped — because an `@` name can never
  be authored by a group or preset, so a clash there is not ambiguity.

`_145`'s judgement is factually sound: the literal `TE Sign` was structurally
unavailable, the codex-P0 fix (refuse loudly rather than drop silently) was
applied, and the specified *counts* are all met. The one-letter spelling
difference genuinely needs the operator's ruling.

### (b) `WALLS` ≡ `Hull Canvas` ≡ `@BAR` and `AUDITORIUM` ≡ `Auditoriums` — byte-identical, CONFIRMED

Verified **pixel-for-pixel**, twice and by two independent routes — once through
the `MaskRegistry` `members` arrays, once by rebuilding the sets straight from
per-pixel metadata (group-name token vs. group list vs. `fixtureType` string):

| Pair | Result |
|---|---|
| `WALLS` (Wall token) vs `Hull Canvas` (4 wall groups) | **IDENTICAL**, 360 px |
| `WALLS` vs `@BAR` (`ShehdsBar`) | **IDENTICAL**, 360 px |
| `AUDITORIUM` (Auditorium token) vs `Auditoriums` (2 groups) | **IDENTICAL**, 16 px |
| `Identity` vs `TE Signs` | **IDENTICAL**, 148 px (deliberate) |

### (c) The centreline claim — CONFIRMED, nothing fudged

- **Zero** of the 964 pixels has `x == 0`. Minimum `|x|` = **12.648**; the
  nearest left pixel sits at `x = -13.34` and the nearest right at `x = 12.648`
  — a **25.99-unit clear gap** across the centreline. The halves are not a
  near-tie resolved by a tiebreak.
- **Zero** straddling base groups, **zero** straddling fixtures (`cId/fId`),
  **zero** straddling controllers (all 18 controllers are single-sided).
- **Zero** token/geometry disagreements. 148 pixels (the two `TE Sign` groups)
  carry no `Left_`/`Right_` token at all and are assigned purely from geometry —
  `TE Sign` is entirely `x < 0`, `TE Sign 2` entirely `x > 0`.
- The loud-failure paths behave as claimed on synthetic input: a pixel whose
  group token contradicts its world X **throws** (`group 'Right Front Wall'
  implies right but world x=-1 implies left — model side/geometry disagree`),
  and a genuine `x == 0` pixel with no token joins **neither** half and raises
  the centreline warning rather than being pushed to a side.

---

## 4. Finding not in `_145`'s scope — the offline harnesses cannot see the auto-views

Pre-existing, **not** introduced by `_145`, but newly consequential because the
rewritten docs now steer pattern authors to `LEFT` / `RIGHT` / `Strands` /
`TE Signs`.

`tools/pattern_audio_harness.mjs`, `tools/pattern_derived_harness.mjs` and
`tools/param_truth/render_context.js` all build their `inView()` `viewTable`
from `loadModelForGauge()` alone:

```js
for (const [group, bit] of Object.entries(loaded.groupBits)) viewTable[group] = { bit, word: 0 };
for (const vm of loaded.viewMasks) viewTable[vm.name] = { … };
```

`loadModelForGauge` does **not** call `deriveAutoViews` — only `engine.js`
does. So the offline table holds 31 names (24 groups + 7 composites) where the
engine holds 60. Measured:

```
node tools/pattern_audio_harness.mjs --model titanic --pattern <inView("Hull Canvas")>
  COMPILE_OK   LIT=360/964

node tools/pattern_audio_harness.mjs --model titanic --pattern <inView("LEFT")>
  COMPILE_FAIL: Pattern references unknown view(s) via inView(): LEFT.
  Known views for this model: … (31 names, no LEFT)
```

A pattern author following the new §7.3.2 guidance and gate-testing offline gets
a `COMPILE_FAIL` for a view that is perfectly valid on the rig. That is a
harness↔engine parity gap in the injection table, worth a follow-up — the fix is
one call to `deriveAutoViews` in the three tools before the table is built. It
does **not** affect any acceptance line here: the engine-side behaviour is
correct, and I proved line [6] through the real `WasmHost.compile()` with the
engine's own table.

---

## 5. What could not be verified

- **`_145`'s "78/78 checks" harness** — `verify_titanic_catalog.mjs`,
  `regen_titanic_views.mjs` and `alias_check.mjs` live in its session
  scratchpad, which is gone. Not reproducible. The equivalent facts were
  re-derived independently here and all hold; the permanent replacement
  (`tests/mixer/titanic_view_catalog.test.js`, 9 tests) is present and green.
- **The exact pre-`_145` engine test baseline** — establishing it would require
  checking out HEAD, a git state operation outside this thread's mandate. The
  file-level delta count (+14) is offered instead.
- **`_145`'s claim that the sidecar and `views.yaml` were "generated, not
  hand-authored"** through `createViewRegistry → removeCustomView →
  reconcileGroupBits → yaml.dump / buildViewmasksSidecarJS` — the process is not
  observable after the fact. What *is* verifiable, and does hold, is the
  artifacts' end state: `groupBits` byte-identical in both files, the two files
  mutually consistent (identical bits for all seven views), and
  `scene_model_parity --strict` clean.

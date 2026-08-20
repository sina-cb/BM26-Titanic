# `_148` — structural view dedup: `WALLS` / `AUDITORIUM` retired

**Date:** 2026-08-04 · **Branch:** `feat/bm_readiness` · Implementer thread.

Executes the operator's ruling on the open decisions `_145` §5 filed and `_146`
§3 independently confirmed.

> 1. **Keep `TE Signs` plural.** Do not rename the base group `TE Sign`.
> 2. **Remove the titanic structural selections `WALLS` and `AUDITORIUM`** —
>    `WALLS` is byte-identical to `Hull Canvas`, `AUDITORIUM` byte-identical to
>    `Auditoriums`. Canonical: `Hull Canvas`, `Auditoriums`, and `@BAR` stays
>    available as fixture-capability targeting.
> 3. Apply the same exact-membership deduplication to other scenes **only where
>    it applies safely**; a structural view with no byte-identical authored
>    counterpart MUST remain.

**No git operation of any kind. No engine boot, no sim boot, no server, no port
bound, no deploy, no install.** Everything ran in-process or as an offline
subprocess against the vendored WASM; the operator's live stack kept 6966–6972,
5568, 8081 and 10000 throughout. Scratch lived in `~/tmp/_148` and the session
scratchpad.

**Result: titanic's catalog is 60 → 58 names. Every other scene is unchanged,
measured, not assumed.**

---

## 1. Ruling 1 — `TE Signs` stands, no code change

Verified rather than edited. Across `docs/`, `.agent/skills/`,
`marsin_engine/patterns/examples/`, `CaptainPad/` and the engine libs:

- `TE Sign` and `TE Sign 2` appear **only** as the two 74-px base group names —
  correct, they are two of the 24 byte-preserved bits.
- `TE Signs` (plural, 148 px) is the fixture-type view everywhere it is offered:
  `lib/auto_views.js` `TYPE_VIEW_NAMES`, `docs/MARSIN_ENGINE_PATTERNS.md`
  §7.3.2, `.agent/skills/highdef_pattern_generation.md` §3.1,
  `CaptainPad/components/view_selection_picker_logic.ts` `TYPE_NAMES`.
- No file promises a literal `TE Sign` **selectable view**. `All TE Signs` is
  already listed in the docs as a name that does **not** exist.

No stragglers found; nothing to fix. The base group is not renamed.

## 2. Ruling 2+3 — where the dedup lives, and why it is scoped

The rule is implemented **once**, in the shared path
`marsin_engine/lib/view_catalog.js` `appendAutoViews()` — the function
`engine.js` calls directly and `buildViewCatalog()` (the three offline tools'
entry point) composes. Parity between rig and harness is therefore structural,
exactly as `_147` built it: there is no second copy to drift.

`lib/auto_views.js` `deriveAutoViews` is **untouched** beyond a header note. It
stays a pure derivation of what the model's metadata says exists; the decision
about which derived name is *redundant against the authored catalog* is a
registration-layer decision, and that is where it sits.

### 2.1 The rule

At registration, an auto-view in a **dedupable family** whose resolved pixel-set
is byte-identical to an already-authored view's (base group or declared preset,
indexed **before** the append) is not registered; the authored name is
canonical. Membership is resolved by the same two rules
`lib/mask_registry.js` `buildMaskRegistry()` uses (`groups:[…]` union /
explicit `pixelIndices:[…]`), so "byte-identical" here means byte-identical
`members[]` there.

`DEDUPABLE_FAMILIES` = **`structural`** only.

### 2.2 Why not a global rule — measured, not assumed

A global "any auto-view identical to an authored view is dropped" rule was the
brief's preferred shape. It is **unsafe**, and the operator's own ruling proves
it: ruling 2 explicitly **keeps `@BAR`**, which is byte-identical to
`Hull Canvas`. Measured across every loadable model, a global rule would also
retire:

| Family | What it would have destroyed |
|---|---|
| typed | titanic `@BAR`≡`Hull Canvas`, `@PAR`≡`Organs`, `@VINTAGE`≡`Jewelry`, `Strands`≡`Silhouette`, `TE Signs`≡`Identity`; test_bench `@PAR`≡`ParLights`, `@VINTAGE`≡`VintageLights`, `@BAR`≡`BarLights`, `TE Signs`≡`TE Sign`; studio_top_loft `@VINTAGE`≡`vintages`, `@BAR`≡`bars`; studiodj `@VINTAGE`≡`FrontTowers`; studio `Strands`≡`Strand 1`; summer_camp_dome `@PAR`, `@VINTAGE`; summer_camp_logsville `@VINTAGE` |
| controller | titanic `CTRL_1`≡`Left Front Wall`, `CTRL_5`, `CTRL_6`, `CTRL_8`, `CTRL_10`, `CTRL_13`, `CTRL_14`, `CTRL_15`, `CTRL_17`, `CTRL_18` — ten of eighteen; studiodj `CTRL_3`/`CTRL_4`; studio `CTRL_4`; summer_camp_logsville `CTRL_5` |
| spatial | studiodj `FRONT` ≡ group `Front` |

A fixture-**capability** handle that covers the same pixels as a **semantic**
instrument today is the point, not a duplicate (`_145` §5.2 already ruled
`Strands`/`Silhouette` and `TE Signs`/`Identity` deliberate). A controller that
happens to own exactly one group is still the strike/debug unit and must stay
addressable as a controller. `LEFT`/`RIGHT`/`FRONT`/`BACK` are the operator's
own terminology from `_145`; a scene that happens to name a group `Front` must
not cost the operator their primary handle.

Structural band names (`WALLS`/`DECKS`/`CHIMNEYS`/`AUDITORIUM`) are the one
family that is a pure generated token with **no operator provenance** — which is
exactly why an authored name meaning the same pixels wins over it. The rule is
still membership-driven and scene-agnostic: it fires wherever a structural band
has an authored twin and nowhere else.

### 2.3 Never a silent drop (codex P0)

Each retirement is appended to the returned `warnings` array, which **all four
callers already print** (`engine.js`, both harnesses, `render_context.js`) via
`console.warn` → **stderr**:

```text
[Model] auto-view: structural view 'WALLS' (360 px) is byte-identical to the authored view
'Hull Canvas' — NOT registered; select/target 'Hull Canvas' instead (operator ruling, report 20260804_148)
[Model] auto-view: structural view 'AUDITORIUM' (16 px) is byte-identical to the authored view
'Auditoriums' — NOT registered; select/target 'Auditoriums' instead (operator ruling, report 20260804_148)
```

Routing it through `warnings` (rather than a new field the callers must
remember to log) means a future caller cannot swallow it by omission. A
structured `deduped: [{name, family, twin, pixels}]` array is also returned for
tests. **stdout is unchanged** — `tools/gallery/gen_variations.mjs` and every
capture consumer are untouched (§5.3).

## 3. Files changed (13)

| File | Change |
|---|---|
| `marsin_engine/lib/view_catalog.js` | **The fix.** `resolveMembers()` + `authoredMembershipIndex()` helpers; `appendAutoViews()` now filters the dedupable families, rebuilds `families`, appends the notices to `warnings`, returns `deduped`. Header documents the rule and the measured reason it is scoped. |
| `marsin_engine/lib/auto_views.js` | Header note only — the structural family may be retired downstream; derivation logic untouched. |
| `marsin_engine/engine.js` | Auto-view section comment describes the dedup. |
| `marsin_engine/tools/pattern_audio_harness.mjs` | Comments: `60 → 58`, `WALLS` dropped from the example name list, warning note mentions the dedup. |
| `marsin_engine/tools/pattern_derived_harness.mjs` | Same. |
| `marsin_engine/tools/param_truth/render_context.js` | Same. |
| `marsin_engine/patterns/examples/inview_demo.js` | Example name list `"WALLS"` → `"Hull Canvas"`. |
| `marsin_engine/tests/mixer/titanic_view_catalog.test.js` | Now assembles through the **shared** path (`appendAutoViews`) instead of raw `deriveAutoViews`; authored presets captured pre-append; `WALLS`/`AUDITORIUM` added to the loud-`inView()` list; **+1 test** pinning the retirement, the twins, the 58-name catalog and `@BAR`'s survival. |
| `marsin_engine/tests/tools/view_catalog_parity.test.mjs` | Reference transcription of engine.js's sequence now reproduces the dedup **independently**, resolving membership through `lib/mask_registry.js` rather than the helper's own resolver; `WALLS` removed from the doc-steered name list; **+2 tests** (titanic retirement + "scenes without an authored twin keep their structural views"). |
| `docs/MARSIN_ENGINE_PATTERNS.md` | §7.3.2 table loses the `WALLS`/`AUDITORIUM` rows; new paragraph "There are no structural views on `titanic`"; `@BAR` documented as fixture-capability targeting; both names added to "Names that do NOT exist". |
| `.agent/skills/highdef_pattern_generation.md` | §3.1 removed-name list gains `WALLS`/`AUDITORIUM`, derived-view list loses them, new structural paragraph; §8.2/§8.3 `60 → 58`. |
| `CaptainPad/components/ViewSelectionPicker.tsx`, `view_selection_picker_logic.ts`, `view_selection_picker_logic.test.ts`, `CaptainPad/utils/api.ts` | Comments only: `60 → 58`, and STRUCTURE documented as scene-dependent. **The STRUCTURE family stays in the classifier** — a scene whose band has no authored twin still sends one; the section simply has no entries on titanic. |

`docs/COLOR_THEORY.md` needed **no change**: it references `Auditoriums` (the
surviving authored composite) and never `WALLS`/`AUDITORIUM`. Verified, not
assumed.

Not touched: mapping, controllers, patches, fixture placement, DMX, `titanic.js`,
`titanic.viewmasks.js`, `views.yaml`, playlists, any pattern. **No model or
scene artifact was regenerated** — the retirement happens at registration, so
the 24 `groupBits` and the 7 authored composites are byte-untouched.

---

## 4. The final titanic catalog — 58 names

Measured through the real `lib/model_loader.js` → `lib/view_catalog.js` →
`lib/mask_registry.js`, in-process, no engine.

| Category | N | Names |
|---|---:|---|
| GROUPS (base) | **24** | unchanged, all 24 bits byte-preserved |
| COMPOSITES (authored) | **7** | `Hull Canvas` 360 · `Silhouette` 320 · `Jewelry` 96 · `Organs` 40 · `Identity` 148 · `Stacks` 24 · `Auditoriums` 16 |
| SIDES & ENDS (derived) | **4** | `LEFT` 482 · `RIGHT` 482 · `FRONT` 388 · `BACK` 388 |
| FIXTURE TYPES (derived) | **5** | `Strands` 320 · `TE Signs` 148 · `@BAR` 360 · `@PAR` 40 · `@VINTAGE` 96 |
| CONTROLLERS (derived) | **18** | `CTRL_1` … `CTRL_18` |
| STRUCTURE (derived) | **0** | both retired as duplicates |
| **TOTAL** | **58** | |

`DECKS` and `CHIMNEYS` still register nothing on titanic (no `Deck`/`Chimney`
group token) — unchanged behaviour, not part of this ruling.

### 4.1 Per-scene dedup table

Every model `loadModelForGauge` accepts, before vs. after, with every removal
justified by the byte-identity shown:

| Scene | auto-views before | after | Retired (and against what) |
|---|---:|---:|---|
| **titanic** | 29 | **27** | `WALLS` (360 px) ≡ authored `Hull Canvas`; `AUDITORIUM` (16 px) ≡ authored `Auditoriums` |
| test_bench | 9 | 9 | none — carries **no structural band token at all** |
| studio_top_loft | 5 | 5 | none — no structural band |
| studiodj | 11 | 11 | none — no structural band |
| studio | 9 | 9 | none — no structural band |
| summer_camp_dome | 6 | 6 | none — no structural band |
| summer_camp_logsville | 10 | 10 | none — no structural band |

(`led202` has 0 pixels / 0 views. `dev_test_bench` fails to load on a
**pre-existing, unrelated** `groupBits out of sync` error — stale
`ParLights`/`VintageLights`/`BarLights`/`LED_0` keys — untouched by this thread
and reproducible before it.)

**Titanic is the only scene in the repo that carries a structural auto-view at
all**, so the rule is a no-op everywhere else — verified by running the
generator on all seven, not inferred. The parity test
`scenes without an authored twin keep their structural views` pins test_bench
and studio_top_loft against an un-deduped `deriveAutoViews` run so a future
scene edit cannot silently shrink them.

---

## 5. Verification — every number measured

### 5.1 Engine sequence (in-process, no boot) and both offline harnesses

The engine's own load sequence (`engine.js:563` `appendAutoViews` + `:627`
`buildViewTable`) driven in-process against `models/titanic.js`:

```text
catalog deep-equal offline-vs-engine: 58 = 58  (names AND {bit,word})

--- membership (engine sequence) ---
  WALLS         DOES NOT RESOLVE
  AUDITORIUM    DOES NOT RESOLVE
  Hull Canvas   360
  Auditoriums   16
  @BAR          360
  LEFT          482
  RIGHT         482
  Strands       320
  TE Signs      148
  FRONT         388
  BACK          388

--- inView() on the retired names ---
  WALLS: COMPILE_FAIL -> Pattern references unknown view(s) via inView(): WALLS. Known views …
  AUDITORIUM: COMPILE_FAIL -> Pattern references unknown view(s) via inView(): AUDITORIUM. Known views …
  Hull Canvas: folds -> ((viewMaskHi & 1024) != 0)
  Auditoriums: folds -> ((viewMaskHi & 512) != 0)
  LEFT: folds -> ((viewMask & 262144) != 0)
  @BAR: folds -> ((viewMask & 524288) != 0)
```

`deepEqual` covers **key order and every `{bit, word}`** — the offline table
built by `buildViewCatalog()` and the engine's table are the same object.

**Audio harness** (`--synth silence --frames 4`, lit-pixel counts read from the
capture JSON):

```text
WALLS          exit=2  COMPILE_FAIL: Pattern references unknown view(s) via inView(): WALLS.
AUDITORIUM     exit=2  COMPILE_FAIL: Pattern references unknown view(s) via inView(): AUDITORIUM.
Hull Canvas    exit=0  COMPILE_OK  LIT=360/964
Auditoriums    exit=0  COMPILE_OK  LIT=16/964
LEFT           exit=0  COMPILE_OK  LIT=482/964
RIGHT          exit=0  COMPILE_OK  LIT=482/964
Strands        exit=0  COMPILE_OK  LIT=320/964
TE Signs       exit=0  COMPILE_OK  LIT=148/964
FRONT          exit=0  COMPILE_OK  LIT=388/964
```

**Derived harness** (`--mod micLow:sliderLevel`, `TOTAL_BRI / 255` = members):

```text
WALLS          exit=2  unknown view(s) via inView(): WALLS.
AUDITORIUM     exit=2  unknown view(s) via inView(): AUDITORIUM.
Hull Canvas    exit=0  COMPILE_OK  TOTAL_BRI=91800   px=360
Auditoriums    exit=0  COMPILE_OK  TOTAL_BRI=4080    px=16
LEFT           exit=0  COMPILE_OK  TOTAL_BRI=122910  px=482
RIGHT          exit=0  COMPILE_OK  TOTAL_BRI=122910  px=482
Strands        exit=0  COMPILE_OK  TOTAL_BRI=81600   px=320
TE Signs       exit=0  COMPILE_OK  TOTAL_BRI=37740   px=148
FRONT          exit=0  COMPILE_OK  TOTAL_BRI=98940   px=388
```

`LEFT` 482 / `RIGHT` 482 / `Strands` 320 / `TE Signs` 148 / `FRONT` 388 are
**unchanged** from `_145`/`_146`/`_147`. `Hull Canvas` 360 and `Auditoriums` 16
still resolve, at the same counts the retired duplicates had.

**`render_context.js` (param_truth path)**:

```text
$ node tools/param_truth/run_param_truth.mjs --pattern examples/inview_demo --out ~/tmp/_148/pt_inview
patterns ok 0, compile errors 0, no params 1
```

### 5.2 Other scenes — before/after, printed

```text
  titanic                29 -> 27   dropped: WALLS(360px) == 'Hull Canvas', AUDITORIUM(16px) == 'Auditoriums'
  test_bench              9 ->  9   dropped: none
  studio_top_loft         5 ->  5   dropped: none
  studiodj               11 -> 11   dropped: none
  studio                  9 ->  9   dropped: none
  summer_camp_dome        6 ->  6   dropped: none
  summer_camp_logsville  10 -> 10   dropped: none
```

The probe additionally asserts, per scene, that the set of names present before
and absent after is **exactly** the reported `deduped` list — a drop cannot
happen without appearing in the notice.

### 5.3 Byte-stability

2 patterns × 2 models × both harnesses, same argv as `_140`/`_142`/`_147`
(`--synth full_track --frames 40`):

| run | capture/trace JSON MD5 | vs `_147` |
|---|---|---|
| `27_swipe` @ `test_bench` (audio) | `8eb3e221037ddb485e2005df29a243f5` | **IDENTICAL** |
| `27_swipe` @ `titanic` (audio) | `2839bb30956a9d1f82fa01ff2f0a0ffc` | **IDENTICAL** |
| `44_biolume_swell` @ `test_bench` (audio) | `2c4cc4e20ed6499dd3b41eb336fec3b2` | **IDENTICAL** |
| `44_biolume_swell` @ `titanic` (audio) | `b213c4a97b21733ae55fc697f793cd2c` | **IDENTICAL** |
| `25_heartbeat` @ `test_bench` (derived) | `847ffddc12064e4c1bd09a22a8c9e491` | **IDENTICAL** |
| `25_heartbeat` @ `titanic` (derived) | `cab1a925a902f543d35c60971d0f3b5a` | **IDENTICAL** |
| `29_kick_shockwave` @ `test_bench` (derived) | `33b576214132bc9c39800a243e582f48` | **IDENTICAL** |
| `29_kick_shockwave` @ `titanic` (derived) | `cf9467e9a8c8ef2c955fb82a48314dda` | **IDENTICAL** |

All eight match the values `_147` recorded (and the four audio ones the values
`_140` recorded) — the baseline is intact across four threads.

**stderr moved by design, stdout did not.** test_bench stderr stays 184 bytes
(the two straddling-controller warnings). titanic stderr goes **0 → 404 bytes**
— exactly the two dedup notices, quoted in §2.3. A grep of every captured
harness **stdout** for `auto-view` / `byte-identical` / `WALLS` / `AUDITORIUM`
returns **nothing**: the harnesses' stdout carries no catalog text at all.
`tools/gallery/gen_variations.mjs` spawns with `stdio:'inherit'` and parses
nothing, so its contract is untouched.

### 5.4 Test suites

| Suite | Result | Baseline |
|---|---|---|
| `tests/tools/*.test.mjs` | **25 / 25 pass** | 23 → **+2 mine** |
| `tests/mixer/*.test.js` + `*.test.mjs` | **511 / 511 pass** | 510 → **+1 mine** |
| `tests/patterns/*` | **95 / 95 pass** | 95 — exact |
| `marsin_engine && npm test` (run 1) | **2656 · pass 2649 · fail 7** | `_147`: 2657 / 2654 |
| `marsin_engine && npm test` (run 2) | **2660 · pass 2653 · fail 7** | |
| `simulation && npm test` | **1773 · pass 1766 · fail 7** | 1773 / 1766 / 7 — exact |
| `simulation` `node tools/scene_model_parity.cjs titanic` | **PASS** — 0 errors, 0 warnings, 1 info | match |
| …`--strict` | **PASS** — 0 errors, 0 warnings, 1 info | match |
| `CaptainPad` `npx vitest run components/view_selection_picker_logic.test.ts` | **32 / 32 pass** | 32 — exact |

**Every delta accounted for by name.** My three new tests are
`the structural duplicates WALLS / AUDITORIUM are retired on titanic` and
`scenes without an authored twin keep their structural views`
(`tests/tools/view_catalog_parity.test.mjs`, 8 → 10) and
`titanic: WALLS and AUDITORIUM are retired duplicates, not selectable views`
(`tests/mixer/titanic_view_catalog.test.js`, 9 → 10). The targeted suites show
them exactly: 23 → 25 and 510 → 511.

Full-suite run 2's **2660 = `_147`'s 2657 + 3** closes exactly on that
contribution. Run 1 reported 2656 — the full-suite total is **not deterministic
on this box** (`_147` measured a 3-test spread between two identical runs, from
file-level aborts like `tests/effects/effects_v2_mode_page_layout.test.js` whose
inner tests are never counted). Both of my runs sit inside that documented
variance and I touched no test outside `tests/tools` and `tests/mixer`.

The **7 failures are identical in both runs** and are exactly the documented
environmental set — 5 × `tests/audio/audio_capture.test.js`
(`device_not_configured`), the `effects_v2_mode_page_layout` file-level
deserialize error, and `tests/io/osc_listener.test.js` `EADDRINUSE` against the
operator's live stack. **Zero view-related failures.** The simulation suite's 7
are the known scene-content families (`test_bench` `strand_metadata_drift` ×2,
`fixtures are docked beside the ship`, `the compression threshold has real
headroom`, three `TGT_UNIVERSE_RESERVED` bench-block tests) — none view-related.

**Runtime residue.** `marsin_engine/states/titanic/mixer_state.yaml` was already
modified when this thread started (md5 `36c7f448f861e90baca2540e7d091872`) and is
**byte-identical after two full `npm test` runs** — my runs produced no new
residue. Reported, never reverted.

### 5.5 Repo sweep

`grep -rn 'WALLS|AUDITORIUM'` over `marsin_engine/`, `simulation/`,
`CaptainPad/`, `docs/`, `.agent/skills/` (excluding `.agent/reports/**`, the
append-only tracker, `CaptainPad/dist/**` build output and untracked
`.scene_backups/**`): every hit is either **documenting the removal**,
**asserting it**, generator-internal (`lib/auto_views.js` still derives the
family for scenes that need it), or unrelated — `THREE INDEPENDENT WALLS` in
`tests/e2e/timeline_e2e_harness.mjs`, `AUDITORIUM_GROUPS` (the two real base
groups) in `simulation/tests/pixel_map_views.test.js`, and the synthetic bit
table in `tests/mixer/in_view_intrinsic.test.js`. `tests/mixer/auto_views.test.js`
still asserts the structural family registers on its synthetic ship fixture —
correct, and the point: that fixture has no authored composites, so nothing
dedups. `tools/param_truth/param_truth_results.{md,json}` contain **0**
occurrences of either name.

### 5.6 Security check

```text
$ python scripts/security_check.py --all
INF scanned ~83396289 bytes (83.40 MB) in 1.42s
WRN leaks found: 6
```

**6 — exactly the baseline**, all `bm26-mac-address` in the UNTRACKED
`simulation/.scene_backups/studiodj/**` snapshots. Zero new findings; nothing
written here contains an address, MAC or secret.

`node --check` clean on all nine touched `.js`/`.mjs` files.

---

## 6. Left open / notes for the operator

1. **`@BAR` still means the same 360 pixels as `Hull Canvas`**, and `Strands` /
   `TE Signs` the same as `Silhouette` / `Identity`. Kept per ruling 2 and
   `_145` §5.2 — flagged here only so the alias map stays visible: the catalog
   is now duplicate-free in the *structural* sense only, deliberately.
2. **Ten of eighteen `CTRL_n` views are byte-identical to a single base group**
   (`CTRL_1`≡`Left Front Wall`, `CTRL_5`, `CTRL_6`, `CTRL_8`, `CTRL_10`,
   `CTRL_13`, `CTRL_14`, `CTRL_15`, `CTRL_17`, `CTRL_18`). Kept — a controller
   is the strike/debug unit regardless of what it happens to cover. Say the word
   if the picker's CONTROLLERS section should hide the redundant rows instead.
3. **`dev_test_bench` does not load** — `groupBits out of sync … stale:
   [ParLights, VintageLights, BarLights, LED_0]`. Pre-existing, unrelated to
   views, reproducible before this change. Not touched.
4. Per the brief: **no git operation of any kind** — staging, committing and
   branch work stay with the operator.

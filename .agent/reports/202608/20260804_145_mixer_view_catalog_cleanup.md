# `_145` — Mixer view catalog cleanup (operator decisions, implemented)

Implementer thread, branch `feat/bm_readiness`. Subsystems: `marsin_engine/`
auto-view generator + fixture-type registry, `simulation/` scene view registry,
`CaptainPad/` view picker, docs + skill. **No git operations, no deploys, no
installs, no engine/sim boot, no port bound.**

The operator's mixer view picker carried ~70 selectable names, many of which
were noise (height bands, symmetric `_BOTH` pairs), used the wrong vocabulary
(PORT/STARBOARD, FORE/AFT), or duplicated the ship in ten half-instrument
composites. `LEFT`/`RIGHT` — the two the operator actually reaches for — were
LED-strand-scoped and covered 234 px each instead of the ship's real halves.
This lands the operator's ruling: **7 semantic composites, exhaustive 482/482
LEFT/RIGHT halves, FRONT/BACK ends, `Strands` + `TE Signs` fixture-type views,
and every retired name a hard, loud failure.**

---

## 1. Files changed (22 tracked + 1 new)

| File | Change |
|---|---|
| `simulation/scenes/titanic/views.yaml` | 17 custom views → **7**. 66 deletions, **0 insertions**. The 24 `groupBits:` lines are **byte-for-byte untouched**. |
| `marsin_engine/models/titanic.viewmasks.js` | Regenerated through the canonical export path. 10 view entries removed + the `// Updated:` stamp. `groupBits` block **byte-for-byte untouched**. |
| `marsin_engine/lib/auto_views.js` | Rewritten catalog: whole-ship LEFT/RIGHT, FRONT/BACK, operator-named typed views, loud collision refusal. PORT/STARBOARD, FORE/AFT, BAND_*, `_BOTH` removed. |
| `marsin_engine/lib/strand_views.js` | Skips side derivation (and its now-false "rename the group" advice) when LEFT/RIGHT are already claimed. Module contract otherwise untouched. |
| `marsin_engine/lib/fixture_type_constants.js` | Appended `FIX_TE_SIGN` (**id 7**) — `TeSignV3A40` + `TeSignV3B34`. Append-only; nothing renumbered. |
| `marsin_engine/lib/in_view_intrinsic.js` | Doc comment example `PORT` → `LEFT`. |
| `marsin_engine/engine.js` | Auto-view section comment now describes the real catalog. |
| `marsin_engine/patterns/examples/inview_demo.js` | `inView("PORT")` → `inView("LEFT")`; example name list refreshed. |
| `marsin_engine/tests/mixer/titanic_view_catalog.test.js` | **NEW** — 9 tests pinning the operator's numbers against the real model + sidecar. |
| `marsin_engine/tests/mixer/auto_views.test.js` | Rewritten for the new families (13 → 20 tests). |
| `marsin_engine/tests/mixer/model_loader_word_aware.test.js` | 17 → 7 composites; 41 → 31 sidecar-declared names. |
| `marsin_engine/tests/mixer/in_view_intrinsic.test.js` | Synthetic view `PORT` → `LEFT`; the unknown-name test now uses `PORT` as the *unknown*. |
| `marsin_engine/tests/mixer/view_mask_constants.test.js` | Bit-free fixture names `PORT`/`BAND_LOW` → `LEFT`/`Strands`. |
| `marsin_engine/tests/io/fixture_type_constants.test.js` | Stability test extended with id 7 + `FIX_TE_SIGN`. |
| `CaptainPad/components/view_selection_picker_logic.ts` | `bands` + `pairs` families removed; `SIDE_NAMES` = LEFT/RIGHT/FRONT/BACK; `TYPE_NAMES` added; `BAND_RANK` → `SIDE_RANK`. |
| `CaptainPad/components/view_selection_picker_logic.test.ts` | Rewritten fixture + cases (32 tests). |
| `CaptainPad/components/ViewSelectionPicker.tsx`, `CaptainPad/utils/api.ts` | Header comments describe the real catalog. |
| `docs/MARSIN_ENGINE_PATTERNS.md` | §7.3.1 rewritten (7 composites); **new §7.3.2** documenting the derived auto-views; expanded "names that do NOT exist"; `FIX_TE_SIGN` added. |
| `docs/COLOR_THEORY.md` | §2 and §4 no longer reference the removed half-composites; point at `LEFT`/`RIGHT`. |
| `docs/MARSIN_PB_LANG_SPEC.md` | `FIX_TE_SIGN` = 7 added to the canonical role list. |
| `.agent/skills/highdef_pattern_generation.md` | §3.1 rewritten: seven composites, `LEFT`/`RIGHT` halves, explicit removed-name list, derived-view list, exact-spelling rule; `FIX_TE_SIGN` added. |

`marsin_engine/states/titanic/mixer_state.yaml` is **pre-existing engine runtime
residue** from the operator's live stack — present before this thread started,
not written or reverted by it. Its `viewSelection.target: Stacks` is a retained
view, so it stays valid.

Not touched: mapping, controllers, patches, fixture placement, DMX, pixel-map
display layouts, `titanic.js`, playlists, any pattern.

### Generated, not hand-authored

`views.yaml` + the sidecar came out of the repository's **canonical** chain,
driven offline from the scratchpad (no browser, no server, no port):
`createViewRegistry` → `removeCustomView` → `reconcileGroupBits` (asserted a
**no-op**, `+0 −0`) → `yaml.dump({views}, {lineWidth:-1})` /
`buildViewmasksSidecarJS`. The generator refuses to run unless the on-disk
`views.yaml` is already byte-identical to canonical dump output, and asserts
both `groupBits` blocks survive byte-for-byte before writing.

---

## 2. The final mixer catalog — 60 names, by category

Measured through the real `lib/model_loader.js` + `lib/mask_registry.js` against
`marsin_engine/models/titanic.js` (964 px, 24 groups).

### SIDES & ENDS (4, derived)

| View | Px | Derived from |
|---|---:|---|
| `LEFT` | **482** | world X < 0 — the whole port half |
| `RIGHT` | **482** | world X > 0 — the whole starboard half |
| `FRONT` | **388** | groups carrying a `Front` token |
| `BACK` | **388** | groups carrying a `Back` token |

`LEFT` ∪ `RIGHT` = 964, `LEFT` ∩ `RIGHT` = ∅. Per half: 180 wall bars + 160 rope
strands + 48 Vintage rails + 12 stack pars + 8 auditorium pars + 74 sign px =
**482**. Assignment is from world X (physical truth); a `Left_`/`Right_` group
token that disagrees with the geometry now **throws at model load**.

### STRUCTURE (2, derived)

`WALLS` **360** · `AUDITORIUM` **16**. `DECKS` and `CHIMNEYS` register nothing
on titanic (no `Deck`/`Chimney` group tokens) — correctly, no empty masks.

### FIXTURE TYPES (5, derived)

| View | Px | Role |
|---|---:|---|
| `Strands` | **320** | `FIX_RAW_LED` — the eight rope runs (was `@RAW`) |
| `TE Signs` | **148** | `FIX_TE_SIGN` — both signs (**new**) |
| `@BAR` | **360** | `FIX_BAR_18` |
| `@PAR` | **40** | `FIX_PAR` |
| `@VINTAGE` | **96** | `FIX_VINTAGE_6` |

`Strands` ∩ `TE Signs` = ∅ (320 + 148 = 468 LED pixels, no overlap).

### CONTROLLERS (18, derived) — unchanged

`CTRL_1` (90) · `CTRL_2` (80) · `CTRL_3` (28) · `CTRL_4` (28) · `CTRL_5` (90) ·
`CTRL_6` (8) · `CTRL_7` (80) · `CTRL_8` (4) · `CTRL_9` (80) · `CTRL_10` (90) ·
`CTRL_11` (28) · `CTRL_12` (28) · `CTRL_13` (90) · `CTRL_14` (8) ·
`CTRL_15` (4) · `CTRL_16` (80) · `CTRL_17` (74) · `CTRL_18` (74)

### GROUPS (24, base) — unchanged, all 24 bits byte-preserved

`Left Front Wall` 90 · `Left Back Wall` 90 · `Right Front Wall` 90 ·
`Right Back Wall` 90 · `Left Front Rails` 24 · `Left Back Rails` 24 ·
`Right Front Rails` 24 · `Right Back Rails` 24 · `Left SmokeStack` 8 ·
`Right SmokeStacks` 8 · `Left Small SmokeStack` 4 · `Right Small SmokeStack` 4 ·
`Left Auditorium` 8 · `Right Auditorium` 8 · `Left_Front_Left` 40 ·
`Left_Front_Right` 40 · `Left_Back_Left` 40 · `Left_Back_Right` 40 ·
`Right_Front_Left` 40 · `Right_Front_Right` 40 · `Right_Back_Left` 40 ·
`Right_Back_Right` 40 · `TE Sign` 74 · `TE Sign 2` 74

### COMPOSITES (7 authored) — memberships, names and `(word, bit)` preserved

| View | Word | Bit | Px |
|---|---:|---|---:|
| `Hull Canvas` | 1 | `0x0400` | **360** |
| `Silhouette` | 1 | `0x2000` | **320** |
| `Jewelry` | 1 | `0x10000` | **96** |
| `Organs` | 1 | `0x0004` | **40** |
| `Identity` | 1 | `0x0020` | **148** |
| `Stacks` | 1 | `0x0040` | **24** |
| `Auditoriums` | 1 | `0x0200` | **16** |

Every one keeps the exact `(word, bit)` it held before this change. The five
instruments still partition the ship: 360 + 320 + 96 + 40 + 148 = **964**.

---

## 3. Every removed name

**Semantic composites (10)** — gone from `views.yaml` and the sidecar:
`Left Hull` · `Right Hull` · `Left Silhouette` · `Right Silhouette` ·
`Left Jewelry` · `Right Jewelry` · `Left Organs` · `Right Organs` ·
`Left Stacks` · `Right Stacks`. `Left Identity` / `Right Identity` were never
created and still are not.

**Spatial (4)**: `PORT`, `STARBOARD` removed outright; `FORE` → `FRONT`,
`AFT` → `BACK` (renames).

**Height bands (3)**: `BAND_LOW`, `BAND_MID`, `BAND_HIGH` — generator section
deleted.

**Symmetric pairs (10 on titanic)** — the whole `<base>_BOTH` family deleted:
`Auditorium_BOTH` · `Back Rails_BOTH` · `Back Wall_BOTH` · `Front Rails_BOTH` ·
`Front Wall_BOTH` · `Small SmokeStack_BOTH` · `Back_Left_BOTH` ·
`Back_Right_BOTH` · `Front_Left_BOTH` · `Front_Right_BOTH`.

**Fixture type (1)**: `@RAW` → renamed `Strands` (same 320 pixels).

All of them are now **hard, loud failures**: `inView("<name>")` raises
`Pattern references unknown view(s) via inView(): <name>. Known views for this
model: …` at compile, and the mixer/CaptainPad picker cannot offer a name the
MaskRegistry never interned.

---

## 4. Verification

All offline — no engine process, no sim boot, no socket, no port bound. The
operator's stack kept 6966–6972, 5568, 8081, 10000 throughout.

### 4.1 Catalog harness — 78/78 checks

Scratchpad harness driving the REAL `lib/model_loader.js`,
`lib/auto_views.js`, `lib/mask_registry.js`, `lib/in_view_intrinsic.js`:

```
[0] 964 pixels · 24 base groups · 7 authored composites                PASS
[1] LEFT 482 · RIGHT 482 · ∩ = 0 · ∪ = 964 · every half matches world-x sign
    no base group straddles the centreline · no controller straddles it
    every Left_/Right_ token agrees with its half
    each half: 180 wall · 160 rope · 48 rail · 12 stack · 8 auditorium · 74 sign
[2] FRONT 388 · BACK 388 resolve; FORE/AFT/PORT/STARBOARD/BAND_*/@RAW GONE
    zero *_BOTH names in the registry
[3] Strands 320 · TE Signs 148 · ∩ = 0 · @BAR 360 · @PAR 40 · @VINTAGE 96
[4] the seven composites at their exact counts; all 12 removed names GONE
[5] no group/view bit collision in either word · groupBits ↔ model in sync
    every composite group reference resolves · all 7 in word 1 · auto-views bit 0
[6] 13 catalog names fold to a real bit test; 11 removed names throw loudly
ALL CHECKS PASSED
```

The same battery is now permanent in
`marsin_engine/tests/mixer/titanic_view_catalog.test.js` (9 tests) so a future
model regen or generator edit cannot silently move these numbers.

### 4.2 Scene ↔ model parity

Canonical invocation is `simulation/tools/scene_model_parity.cjs` (the CLI
driver; `simulation/lib/scene_model_parity.cjs` is the library behind it):

```
cd simulation && node tools/scene_model_parity.cjs titanic
   RESULT PASS — 0 error(s), 0 warning(s), 1 info
cd simulation && node tools/scene_model_parity.cjs titanic --strict
   RESULT PASS — 0 error(s), 0 warning(s), 1 info
```

The one info is the pre-existing `bench_parity/no_bench_block` note. The §5 view
checks (groupBits↔model sync, custom-view group references, per-word bit
collisions, views.yaml↔sidecar drift) are all clean.

### 4.3 Simulation suite — baseline exactly, zero new failures

```
cd simulation && npm test
   ℹ tests 1773   ℹ pass 1766   ℹ fail 7
```

Exactly the stated baseline (1773 / 1766 / 7). All 7 are the known
scene-content failures, none view-related:

| Failing test | Family |
|---|---|
| `real scene test_bench: the model is a faithful export of the scene` | `strand_metadata_drift` on TE Sign V3 A/B |
| `real scene test_bench: every remaining error is a known open mapping defect` | same drift |
| `fixtures are docked beside the ship, not left inside the hull` | scene geometry |
| `the compression threshold has real headroom on the live scene` | scene content |
| `the real titanic scene can accept the block today (no collisions)` | `TGT_UNIVERSE_RESERVED` (U10/U12) |
| `CLI: default emit against the real scenes exits 0 and reports parity=absent` | same collisions |
| `CLI: --require-applied fails (exit 3)` | same collisions |

Note the `view-bit headroom is REPORTED` test that was red in `_134` is now
**green** — removing 10 composites gave word 0 back its headroom. That is a
recovered failure, not a new one.

### 4.4 Marsin engine suite — zero new failures

```
cd marsin_engine && npm test
   ℹ tests 2643   ℹ pass 2636   ℹ fail 7   ℹ duration_ms 105486
```

Count delta accounted for by name: **+16 tests** authored here (9 new in
`titanic_view_catalog.test.js`, +7 net in `auto_views.test.js`), on a 2627
baseline → 2643. The 7 failures are the known environmental families, **zero
new, none view-related**:

| Failing test | Family |
|---|---|
| `reframes mixed-size byte chunks into exact-size Int16Array frames` | audio_capture (env) |
| `emits status lifecycle: starting → running → stopped` | audio_capture (env) |
| `exponential backoff doubles on unexpected exit, capped at 30s` | audio_capture (env) |
| `stop() during pending restart cancels the timer and resolves` | audio_capture (env) |
| `a throwing onFrame does not break framing of subsequent frames` | audio_capture (env) |
| `tests/effects/effects_v2_mode_page_layout.test.js` (file-level) | known env |
| `startAsync rejects with EADDRINUSE when port is already bound` | OSC port owned by the operator's live stack |

The 8th–9th baseline failure (`both scenes carry byte-identical copies of every
specialty/themed playlist`) is **gone** — it was another agent's uncommitted
playlist edits, reverted at `d6234cf9`.

### 4.5 Targeted suites

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test "tests/mixer/*.test.js" "tests/mixer/*.test.mjs"
   ℹ tests 510   ℹ pass 510   ℹ fail 0
```

covering `auto_views`, `titanic_view_catalog`, `in_view_intrinsic`,
`view_mask_constants`, `view_mask_hi_host`, `model_loader_word_aware`,
`pattern_mixer_masking`, `view_fader_ramp`, `groups_solo_*`.

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test "tests/patterns/*.test.js" "tests/tools/*.test.mjs"
   ℹ tests 107   ℹ pass 107   ℹ fail 0
```

(95 pattern + 12 tool/derived-harness — both at baseline.)

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs --test "tests/io/*.test.js"
   fixture-type stability green; the only failure is the OSC EADDRINUSE above.

cd CaptainPad && npx vitest run components/view_selection_picker_logic.test.ts
   Test Files 1 passed · Tests 32 passed
```

One flake observed and re-run clean: `viewFader ramps DOWN toward target at the
configured rate` (`expected ~0.8, got 0.79899…`) failed once on a loaded box and
passed on every subsequent run. Pre-existing timing sensitivity, not caused by
this change.

### 4.6 Repo-wide stale-name sweep

`grep -E 'STARBOARD|BAND_LOW|BAND_MID|BAND_HIGH|_BOTH|@RAW|Left Hull|…'` over
the whole repo excluding `.agent/reports/**` returns hits in only 9 files, every
one of them either **documenting the removal** or **asserting it**:
`lib/auto_views.js`, `tests/mixer/auto_views.test.js`,
`tests/mixer/titanic_view_catalog.test.js`,
`CaptainPad/components/view_selection_picker_logic.{ts,test.ts}`,
`docs/MARSIN_ENGINE_PATTERNS.md`, `.agent/skills/highdef_pattern_generation.md`
— plus two **historical, dated ledger entries** deliberately left intact:
`.agent/memory/bm_readiness_thread_tracker.md` (append-only) and one dated
2026-07-24 bullet in `.agent/projects/bm_readiness_mapping.md`. Rewriting a
dated history entry to match today's catalog would be falsifying the record.

The only other `PORT` hits in the repo are `control_podium/**/deploy.py` SSH
port credentials — unrelated.

### 4.7 Security check

```
python scripts/security_check.py --all
   WRN leaks found: 6
```

All 6 are the pre-existing MAC findings in **untracked**
`simulation/.scene_backups/studiodj/**`. Exactly the stated baseline, zero new.

---

## 5. Requiring operator confirmation

### 5.1 `TE Signs`, not `TE Sign` — a hard namespace collision (DECISION NEEDED)

The brief asked for an operator-facing fixture-type view named exactly
**`TE Sign`** = 148 px. **That name is unavailable**, and the conflict is
structural, not stylistic:

- `TE Sign` is already a **base group** name — the port sign, **74 px** — one of
  the 24 bits the brief requires kept byte-preserved.
- The engine's `MaskRegistry` is a flat namespace (`lib/mask_registry.js`
  `_add()` throws on a duplicate; `buildMaskRegistry` skips a preset whose name
  a group owns). Registering a second `TE Sign` would have been **silently
  dropped** — the view would simply not exist, with no error.

I therefore registered it as **`TE Signs`** (plural, "both signs") and, rather
than leave the trap in place, made the generator **refuse loudly** instead of
skipping: an operator-named typed view that collides now throws
`deriveAutoViews: the fixture-type view '<name>' collides with an existing group
or preset of the same name`. (The `@` prefix on `@PAR`/`@BAR`/`@VINTAGE` exists
precisely to give typed views collision immunity; naming two of them without it
is what surfaced this.)

**Every count the brief specified is met** — the view is 148 px, both signs,
disjoint from `Strands`. Only the spelling differs, by one letter.

To get the literal `TE Sign` the base groups would have to be renamed (e.g.
`TE Sign L` / `TE Sign R`), which touches the scene's group assignments,
requires a full `titanic.js` re-export, and breaks `MASK_TE_SIGN` for any
pattern using it — all explicitly out of scope here. **Say the word and it is a
one-line change** in `TYPE_VIEW_NAMES` (`marsin_engine/lib/auto_views.js`) plus
the group rename; otherwise `TE Signs` stands.

### 5.2 WALLS / AUDITORIUM are byte-identical to retained composites — kept, as instructed

The brief asked me to check and report, not remove. Confirmed by comparing
member sets pixel-for-pixel (not just counts). The complete exact-alias map of
the catalog:

| Px | Byte-identical views |
|---:|---|
| 360 | `Hull Canvas` == **`WALLS`** == `@BAR` |
| 320 | `Silhouette` == `Strands` |
| 148 | `Identity` == `TE Signs` |
| 96 | `Jewelry` == `@VINTAGE` |
| 40 | `Organs` == `@PAR` |
| 16 | `Auditoriums` == **`AUDITORIUM`** |
| 90 | `Left Front Wall` == `CTRL_1`, `Left Back Wall` == `CTRL_5`, `Right Front Wall` == `CTRL_10`, `Right Back Wall` == `CTRL_13` |
| 74 | `TE Sign` == `CTRL_17`, `TE Sign 2` == `CTRL_18` |
| 8 | `Left SmokeStack` == `CTRL_6`, `Right SmokeStacks` == `CTRL_14` |
| 4 | `Left Small SmokeStack` == `CTRL_8`, `Right Small SmokeStack` == `CTRL_15` |

So `WALLS` ≡ `Hull Canvas` and `AUDITORIUM` ≡ `Auditoriums` — **both kept this
pass, awaiting your call.** Note the `Strands`/`Silhouette` and
`TE Signs`/`Identity` pairs are *deliberate* per your ruling (operator handle vs
semantic instrument), and the CTRL_ aliases are structural (a controller that
happens to own exactly one group) — none of those are candidates for removal.

### 5.3 No centreline contradictions — the model is clean

Zero pixels required a judgement call. Every one of titanic's 964 pixels has a
non-zero world X; **no fixture spans the centreline**, no base group straddles
it, and no controller straddles it. Every `Left_`/`Right_` group token agrees
with its geometry. Nothing was fudged to hit 482/482 — the halves fell out of
the model as-is.

For **other** scenes the generator is honest rather than exhaustive: a pixel at
exactly `x = 0` with no side token joins **neither** half and is reported by
index in a loud warning (`studiodj` has 4 such pixels). It is not silently
pushed to a side. A pixel whose group token and geometry **disagree** still
throws at model load.

---

## 6. Autonomy / safety statement

- **No git command that mutates anything was run** — no add, commit, branch,
  checkout, stash, reset, push. Read-only `git status` / `git diff --stat` were
  used to prove the `groupBits` blocks and the change surface; they mutate
  nothing.
- **No deploy, no `npm install`, no package.json / lockfile change.**
- **No engine or sim was booted by hand, no port was bound by this thread.**
  Every harness uses pure library modules. The one qualification: the full
  `marsin_engine npm test` (the repo's standard gate) spawns short-lived engine
  subprocesses of its own under the suite's `setup_config_guard.mjs` scratch
  `MARSIN_CONFIG_FILE`; they lose the default ports to the operator's live stack,
  which is the known `EADDRINUSE` environmental failure. Nothing was sent to the
  operator's running engine and no state file of theirs was written.
- **The operator's launcher stack kept every port** (6966–6972, 5568, 8081,
  10000); no controller or rig traffic was emitted.
- All scratch files live in the session scratchpad, never in the source tree.
- `marsin_engine/states/titanic/mixer_state.yaml` residue was present before this
  thread and is left exactly as found — reported, never reverted.

---

## 7. Reproducing

Both scratch harnesses are in the session scratchpad (not the source tree):

- `regen_titanic_views.mjs` — the canonical regeneration. Guarded: refuses on
  non-canonical YAML on disk, on a missing view to remove, on a non-no-op
  `reconcileGroupBits`, and on any `groupBits` byte change in either artifact.
- `verify_titanic_catalog.mjs` — the 78-check membership / bit-hygiene /
  `inView()` battery (now also permanent as
  `marsin_engine/tests/mixer/titanic_view_catalog.test.js`).
- `alias_check.mjs` — the exact-membership alias map in §5.2.

Regenerating after any model change is a normal sim save (Views panel → export),
which runs the identical `view_registry` chain.

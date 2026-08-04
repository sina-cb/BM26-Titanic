# `_135` — Read-only wave verification (`_133` docs / `_134` views / `_136` loader / `_137` allocator)

Verification thread. Branch `feat/bm_readiness`. **Read-only: no source, doc,
scene, model or config file was edited.** Writes were confined to this report
and the tracker landing block. **No git mutation, no deploy, no install, no
live engine boot, no port bound.**

Scope: re-verify the four-thread wave against the **final, post-`_137`** tree —
`docs/COLOR_THEORY.md`, `docs/MARSIN_ENGINE_PATTERNS.md`,
`docs/MARSIN_PB_LANG_SPEC.md`, `simulation/scenes/titanic/views.yaml`,
`marsin_engine/models/titanic.viewmasks.js`,
`marsin_engine/lib/model_loader.js`, `simulation/src/dmx/view_registry.js`,
`simulation/lib/bench_section.cjs` (plus
`simulation/src/gui/view_masks_editor.js`, which `_137` also changed).

---

## 1. Verdict table

| # | Check | Verdict |
|---:|---|---|
| 1 | All changed files re-read against the final tree | **PASS** |
| 2 | Every documentation claim vs current code/mapping | **FAIL — 1 stale claim** (D1) |
| 3 | Doc view names exactly match authored names (41/41, irregularities included) | **PASS** |
| 4 | Docs do not present `pixel_map_views.yaml` as engine semantic masks | **PASS** |
| 5 | Bad universal radius/kick/direction policy gone; `localSpeed` mandatory + FIRST; `direction` optional + SECOND; no double global speed; `w == a` hard rule; audio modulators-only | **PASS** |
| 6 | 17 memberships + counts + (word,bit) uniqueness in the FINAL files; 24 base groupBits byte-identical to HEAD | **PASS** |
| 7 | `inView("Name")` resolves for all 41 names in both words via the real intrinsic | **PASS** |
| 8 | `scene_model_parity.cjs titanic` (+ `--strict`); targeted sim + engine subsets | **PASS — zero new failures** |
| 9 | `_136` cross-check: `loadModelForGauge('titanic')` post-migration | **PASS** |
| 10 | Doc security posture (`file:///`, `.agent/01_skills`, real IPs) | **PASS for the 3 docs** — but see D2, a **commit-blocking leak in the wave's own report + tracker** |

**Overall: the code and mapping half of the wave is sound and internally
consistent. Two items must be corrected before commit — D1 (a now-false doc
claim) and D2 (a P0 privacy leak that will hard-block the pre-commit hook).**

---

## 2. Discrepancy list

### D1 — `MARSIN_ENGINE_PATTERNS.md` §7.3.1 word-placement paragraph is FALSE post-`_137`

**File:** `docs/MARSIN_ENGINE_PATTERNS.md`, §7.3.1 "The semantic views on
`titanic`", **lines 626–632**.

**Exact current text:**

> **Word placement** (an implementation detail you should not need, but which
> explains the generated code): the 24 base groups and the first seven composites
> (`Hull Canvas` … `Jewelry`) live in the low word and fold to
> `((viewMask & <bit>) != 0)`; the remaining ten composites (`Left Jewelry` …
> `Auditoriums`) live in the high word and fold to
> `((viewMaskHi & <literal>) != 0)`. `inView()` picks the right word for you —
> which is exactly why you should use it rather than hand-written bit tests.

**Why it is false.** `_133`'s §8 reconciliation was written against the
`_134` state (7 composites in word 0, 10 in word 1). `_137` then migrated
**all seven** word-0 composites into word 1. In the current
`marsin_engine/models/titanic.viewmasks.js`, **every one of the 17 composites
carries `word: 1`** — measured, not inferred:

```
ALL 17 composites are word 1 (word0=0 word1=17)
all 41 inView() names fold (low=24 hi=17 failures=0)
```

The 24 low-word folds are the base groups **only**; there are zero low-word
composites. `Hull Canvas` in particular moved `w0 0x40000 → w1 0x400`, so the
named example in the sentence is exactly backwards.

**Correction needed** (replace lines 626–632 with substantively this):

> **Word placement** (an implementation detail you should not need, but which
> explains the generated code): the 24 base groups live in the low word and fold
> to `((viewMask & <bit>) != 0)`; **all 17 composite views live in the high word**
> and fold to `((viewMaskHi & <literal>) != 0)`. Base group bits can only live in
> word 0, so the allocator deliberately keeps composites out of it — see
> `simulation/src/dmx/view_registry.js` `CUSTOM_VIEW_WORD_ORDER`. `inView()` picks
> the right word for you — which is exactly why you should use it rather than
> hand-written bit tests.

**Nothing else in the three docs makes a word-placement or bit-value claim.**
Explicitly re-checked and found **clean**:

- `docs/COLOR_THEORY.md` — zero occurrences of `word`, `viewMask`, `viewMaskHi`
  or any bit value. Its §2/§4 view references are name-only and all resolve.
- `docs/MARSIN_PB_LANG_SPEC.md` — §5.2 lane table (L387/L390) and §5.2.1
  (L453–455) describe the **generic two-word scheme**, never titanic's
  assignment. `viewMask` = "low view word — views 0..30, bit `1 << view`" and
  `viewMaskHi` = "high view word — views 31..61, bit `1 << (view − 31)`" match
  `marsin_engine/lib/view_word.js` L9–10 verbatim. Its `inView("Hull Canvas")`
  example (L450) claims no word and stays correct.
- `MARSIN_ENGINE_PATTERNS.md` §7.1 (L501/L504) and §7.3 (L549–551) are likewise
  generic and correct.

*Informational, no action:* `_133` §8 ("the seven `Hull Canvas` … `Jewelry` are
word 0") and `_134` §2/§3.1 carry the same now-superseded split. Those are
**dated historical reports**, not live documentation — they were true when
written and should not be rewritten.

### D2 — P0 privacy: a real controller IP is in `_137`'s report AND in the tracker (will BLOCK the next commit)

`python scripts/security_check.py --all` returns **8 findings**. Six are in
untracked `simulation/.scene_backups/studiodj/**` (pre-existing, out of scope).
**Two are in files this wave authored:**

| File | Line | Rule |
|---|---:|---|
| `.agent/reports/202607/20260725_137_view_allocator_word_policy.md` | 185 | `bm26-report-ip` |
| `.agent/memory/bm_readiness_thread_tracker.md` | 7201 | `bm26-report-ip` |

Both are the same sentence, in `_137` §2.1 and in its tracker landing block:
the six genuine `TGT_UNIVERSE_RESERVED` collisions are described as being *on*
two **literal `10.x.x.x` controller IPs**. This repo is **PUBLIC**, and the
tracker is a **git-tracked** file — `.githooks/pre-commit` and the Claude Code
PreToolUse gate will refuse the commit, and CI would re-catch it.

**Correction needed:** in both files, replace the parenthesised literal IP pair
with a non-identifying reference (e.g. "on the two reserved bench controllers"
or "on the U10/U12 controllers"). The universe numbers U10/U12 are fine; only
the IP octets trip the rule. `_137`'s report is currently **untracked**, so it
must be fixed before it is added.

*(This report deliberately does not reproduce the octets.)*

**The three docs themselves are clean:** 0 × `file:///`, 0 × `.agent/01_skills`
or `.agent/00_gol`, 0 × IPv4 literal, 0 × MAC literal, and all **54** relative
links resolve.

### D3 — `_137` §1.4 / tracker quote an arithmetically impossible Views-panel readout

**Files:** `.agent/reports/202607/20260725_137_view_allocator_word_policy.md`
§1.4, and the `_137` tracker block.

**Exact text:**

> `CUSTOM VIEWS — 17 · 28 slot(s) free (14 in word 1, 7 spill into the group word)`

`simulation/src/gui/view_masks_editor.js` L336 computes
`const freeViews = free.word1 + free.word0;` — for titanic that is
`14 + 7 = 21`, not `28`. The **code is correct**; only the illustrative string
in the report/tracker is wrong (and self-inconsistent: 14 + 7 ≠ 28). The
sibling `GROUP VIEWS (auto) — 24 · 7 new group(s) fit` is correct.

**Correction needed:** `28` → `21` in both places. Documentation-only; no code
change.

### D4 — `view_registry.js` group-exhaustion message still asserts a scene-wide 31-bit cap

**File:** `simulation/src/dmx/view_registry.js`, `reconcileGroupBits`,
**lines 224–225**:

```js
throw new Error(`[Views] Out of view-mask bits while assigning group '${g}' — ` +
  `a scene supports at most 31 distinct group/view bits`);
```

Under the two-word scheme a scene supports **62** group/view bits; the 31 is
the **word-0 / base-group** ceiling. `_137` corrected exactly this class of
wording in `bench_section.cjs` (`MAX_VIEW_BITS` doc comment → "*per word*") and
in `addCustomView` (which correctly says "at most 62 … across both words"), but
left this one. An operator hitting it would be told the wrong ceiling.

**Correction needed:** e.g. "— base group bits live only in view word 0, which
holds at most 31 bits (custom views can still use word 1)."
Cosmetic/diagnostic only — no behavioural impact, and no test asserts the
string.

### D5 — `bench_section.cjs` T3 counts a malformed custom entry as word-0 (defensive nit)

**File:** `simulation/lib/bench_section.cjs`, **line 650**:

```js
const word0Customs = targetCustom.filter((v) => (v && v.word) !== 1).length;
```

For a `null`/`undefined` entry, `(v && v.word)` is falsy, `!== 1` is true, and
the entry is charged to the word-0 budget. Correct for every well-formed
`views.yaml` (and `createViewRegistry` throws on malformed entries upstream), so
this is a robustness nit rather than a live defect. **Optional** fix:
`(v?.word ?? 0) !== 1`, or reject non-objects loudly.

---

## 3. Evidence — commands run and exact results

All harnesses ran **in-process from the session scratchpad** against the
vendored WASM/pure library modules. No socket, no port, no engine process.
Ports 6966–6972, 5568, 8081, 10000 were never touched.

### 3.1 Offline verification harness (`verify_135.mjs`) — 47/47 checks, exit 0

```
[1] base groupBits byte-identical to HEAD
  PASS  views.yaml groupBits block byte-identical to HEAD (25 lines)
  PASS  titanic.viewmasks.js groupBits block byte-identical to HEAD

[2] views.yaml <-> sidecar agreement
  PASS  24 base groups (24)          PASS  24 sidecar groupBits
  PASS  views.yaml groupBits === sidecar groupBits (name + value)
  PASS  17 custom views in views.yaml (17)   PASS  17 viewMasks in sidecar (17)
  PASS  views.yaml custom[] mirrors sidecar viewMasks[] exactly (name/bit/word/groups/order)

[3] post-_137 word placement
  PASS  ALL 17 composites are word 1 (word0=0 word1=17)
  PASS  17 distinct word-1 bits (no collision)
  PASS  every bit a safe power of two <= 0x40000000
  PASS  24 distinct word-0 group bits
  PASS  word 0 used mask 0xcf3ffff (groups only)
        word0 24/31 used, 7 free group slots; word1 17/31 used, 14 free

[4] membership counts recomputed from titanic.js
  PASS  model has 964 pixels (964)   PASS  24 pixel groups in model (24)
  PASS  groupBits in sync with model (missing=[] stale=[])
  PASS  Hull Canvas       word 1 bit 0x00400  360 px (expect 360)
  PASS  Left Hull         word 1 bit 0x00800  180 px (expect 180)
  PASS  Right Hull        word 1 bit 0x01000  180 px (expect 180)
  PASS  Silhouette        word 1 bit 0x02000  320 px (expect 320)
  PASS  Left Silhouette   word 1 bit 0x04000  160 px (expect 160)
  PASS  Right Silhouette  word 1 bit 0x08000  160 px (expect 160)
  PASS  Jewelry           word 1 bit 0x10000   96 px (expect 96)
  PASS  Left Jewelry      word 1 bit 0x00001   48 px (expect 48)
  PASS  Right Jewelry     word 1 bit 0x00002   48 px (expect 48)
  PASS  Organs            word 1 bit 0x00004   40 px (expect 40)
  PASS  Left Organs       word 1 bit 0x00008   20 px (expect 20)
  PASS  Right Organs      word 1 bit 0x00010   20 px (expect 20)
  PASS  Identity          word 1 bit 0x00020  148 px (expect 148)
  PASS  Stacks            word 1 bit 0x00040   24 px (expect 24)
  PASS  Left Stacks       word 1 bit 0x00080   12 px (expect 12)
  PASS  Right Stacks      word 1 bit 0x00100   12 px (expect 12)
  PASS  Auditoriums       word 1 bit 0x00200   16 px (expect 16)
  PASS  no two custom views share an identical member set
  PASS  every referenced group exists in groupBits (bad=[])
  PASS  every view is group-based (no pixelIndices) — safe across words
  PASS  the five instrument views partition all 24 base groups (no overlap, exhaustive)
  PASS  the five instruments sum to 964 px

[5] inView() resolution via the real intrinsic (all 41 names)
  PASS  viewTable has 41 names (41)
  PASS  no name collision across groups + views
  PASS  buildMaskConstants -> 41 MASK_* entries (41), no sanitized collision
  PASS  all 41 inView() names fold (low=24 hi=17 failures=0)
  PASS  word split matches files: 24 low-word (base groups), 17 high-word (composites)
  PASS  all 6 forbidden aliases hard-error (6/6)
  PASS  doc's 24 base-group names match authored names exactly (missing=[] extra=[])
  PASS  doc's 17 composite names match authored names exactly (missing=[])

[6] _136 cross-check — loadModelForGauge(titanic)
  PASS  loads OK: pixels 964, views 17, groupBits 24
  PASS  every pixel carries a viewMaskHi bit (964/964) — all 17 composites are word 1
  PASS  viewMask (word 0) carries ONLY group bits — zero hi-word leak

ALL CHECKS PASSED
```

Notes on method:

- **[1]** compares against `git show HEAD:<file>` output captured to the
  scratchpad — read-only git inspection, nothing mutated.
- **[5]** rebuilds the `viewTable` exactly as `engine.js` L628–633 does
  (`{ name: { bit, word } }`), then folds
  `if (inView("<name>")) rgb(1,1,1); else rgb(0,0,0);` through the **real**
  `injectInViewIntrinsic()` for each of the 41 names, and asserts the emitted
  literal **equals the authored bit** and lands in the **authored word** — a
  fold to the right word with a wrong literal would still fail.
- **[6]** additionally proves zero hi-word leak: no pixel's word-0 `viewMask`
  carries a bit outside the 24-group mask `0xcf3ffff`.

### 3.2 Independent count reconciliation (`group_counts.mjs`)

Per-group counts summed straight from `marsin_engine/models/titanic.js`:

| Instrument | Derivation | Total |
|---|---|---:|
| Hull Canvas | 4 wall groups × 90 (= 5 × `ShehdsBar` 18 px) | 360 |
| Silhouette | 8 strand groups × 40 | 320 |
| Jewelry | 4 rail groups × 24 (= 4 × `VintageLed` 6 heads) | 96 |
| Organs | (8 + 4 + 8 + 4) stacks = 24 · (8 + 8) auditoriums = 16 | 40 |
| Identity | `TE Sign` 74 + `TE Sign 2` 74 | 148 |

Total **964**. `fixtureType` census: `ShehdsBar` 360, `VintageLed` 96,
`UkingPar` 40, `TeSignV3A40` 80 + `TeSignV3B34` 68 (= 2 × (40 + 34) = 148),
untyped strand pixels 320. **Every number in `COLOR_THEORY.md` §2/§4 and in
`MARSIN_ENGINE_PATTERNS.md` §7.3.1 reconciles exactly.**

### 3.3 Doc name/link/security sweeps

```
inView("…") strings across the 3 docs:
  RESOLVES  COLOR_THEORY.md  Hull Canvas / Identity / Jewelry / Organs / Silhouette / Stacks
  RESOLVES  MARSIN_ENGINE_PATTERNS.md  Hull Canvas / Right Front Rails
  RESOLVES  MARSIN_PB_LANG_SPEC.md  Hull Canvas / Left Front Wall / Right Front Wall
  placehold  "Name" / "Authored View Name" / "X" / "…"
  unresolved inView names: 0
  backticked names that case/spell-mismatch an authored view: 0

relative links checked: 54   missing: 0
file:/// : none      .agent/01_skills | .agent/00_gol : none
IPv4 literals : none      MAC literals : none        (all three docs)
```

Spelling irregularities documented in §7.3.1 were each confirmed against the
authored names: `Right SmokeStacks` (plural) vs `Left SmokeStack` (singular);
underscored strand groups (`Left_Front_Left` …); `TE Sign` / `TE Sign 2`;
`Left Auditorium` / `Right Auditorium` singular base groups vs the composite
`Auditoriums`. All correct.

`pixel_map_views.yaml` is mentioned in exactly two places
(`MARSIN_ENGINE_PATTERNS.md` L639–645, `MARSIN_PB_LANG_SPEC.md` L471–476) and in
both it is correctly labelled a **simulator 2D display-layout sidecar with no
bearing on `inView()`**, explicitly distinguished from `views.yaml`. **Check 4
PASS.**

### 3.4 Parameter-policy audit (check 5) — all PASS

| Requirement | Evidence |
|---|---|
| Universal `radius` / `kick` policy gone | Only surviving mentions are the §1 "this replaces…" callout (L69, L76) and the §1.4 "there is **no** required `radius`, `kick`…" prohibition (L130). Zero mandates. `MARSIN_PB_LANG_SPEC.md` has none. |
| `localSpeed` mandatory and **FIRST** local | §1.2 L87–88; restated §4.3 L353–354 |
| `direction` optional, **SECOND** when present | §1.3 L101–108; §4.3 L354. Autonomous reversal demoted to OPTIONAL CAPABILITY (L119–126) |
| No example double-applies global speed | Only occurrence of `globalMult`/`pow(2.0,(speed…` is the §3.1 "**Removed:**" callout (L256–262). All three worked examples (L246, L939, L978) use `localSpeed` only, each with an explicit "localSpeed ONLY" comment |
| `w == a` a hard rule | §0 item 5 (L40–42) + §6.2 (HARD CONTRACT), enforcement named: `tests/patterns/white_amber_lane_match.test.js` — **file present** |
| Audio modulators-only | §0 item 12 (L56–58) + §8 "HARD CONTRACT", cites `lib/param_center.js` `isLiveAudioSharedFnName` — **present (2 refs)**, `engineOwned` **present (7 refs)** |

Other cited sources spot-verified present and matching: `SPEED_MIN_MULT = 0.25`
/ `SPEED_MAX_MULT = 4.0` (`engine.js` L744–745, "0.5 → 1× exactly");
`VALID_CHANNEL_BLEND_MODES` = exactly `blend_screen`/`blend_add`/`blend_over`
(`lib/api_server.js` L194–197); `FIX_RAW_LED` 1 / `FIX_VINTAGE_6` 3 /
`FIX_BAR_18` 4 (`lib/fixture_type_constants.js`); `meta_abi.js` 7-int32 stride
with lane 6 = `viewMaskHi`.

### 3.5 Gates

```
cd simulation && node tools/scene_model_parity.cjs titanic
   model: 964 pixel(s) (scene implies 964)
   INFO  bench_parity/no_bench_block
   RESULT PASS — 0 error(s), 0 warning(s), 1 info

cd simulation && node tools/scene_model_parity.cjs titanic --strict
   RESULT PASS — 0 error(s), 0 warning(s), 1 info
```

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test tests/mixer/model_loader_word_aware.test.js          # _136's new file
   ℹ tests 14   ℹ pass 14   ℹ fail 0

cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test "tests/mixer/*.test.js" "tests/mixer/*.test.mjs"     # engine mixer/view subset
   ℹ tests 489   ℹ pass 489   ℹ fail 0
```

```
cd simulation && node --test tests/bench_section_sync.test.js   # _137's touched file
   ℹ tests 43   ℹ pass 39   ℹ fail 4
     ✔ view-bit headroom is REPORTED — titanic fills the word-0 ceiling exactly
     ✔ word-1 composite views are NOT charged to the word-0 budget      (_137's new test)
     ✔ REFUSES: view-bit budget would exceed the 31-bit word-0 export ceiling
     ✖ fixtures are docked beside the ship, not left inside the hull
     ✖ the real titanic scene can accept the block today (no collisions)
     ✖ CLI: default emit against the real scenes exits 0 and reports parity=absent
     ✖ CLI: --require-applied fails (exit 3) …

cd simulation && node --test tests/pixel_map_views.test.js tests/te_sign_grouping_parity.test.js \
    tests/unpatched_red_two_views.test.js tests/bench_mirror.test.js
   ℹ tests 92   ℹ pass 92   ℹ fail 0
```

The 4 bench failures are **exactly** items 1–4 of `_137` §4's known-red list
(dock geometry + the U10/U12 universe collisions and the two CLI tests that
depend on them). **Zero new failures**; `_137`'s three word-aware assertions all
green. No full-suite rerun was needed — nothing looked wrong.

Syntax gate on the four changed JS/CJS files: `node --check` passes on
`view_registry.js`, `bench_section.cjs`, `view_masks_editor.js`,
`model_loader.js`.

### 3.6 Code re-reads (check 1) — findings

- `marsin_engine/lib/model_loader.js` — `reserveExplicitBits` returns
  `{reservedMask, reservedMaskHi}` and reserves per word (L111–122);
  `loadModelForGauge` passes **only** `reservedMask` to `assignGroupBits`
  (L254–255); the two added engine.js-parity validations (`word ∉ {0,1}`,
  `word:1` without a bit) are present (L99–106); `vMaskHi ?? 0` initialised
  (L136); lane 6 packed (L294). **Mirrors `engine.js`; no check weakened.**
- `simulation/src/dmx/view_registry.js` — `CUSTOM_VIEW_WORD_ORDER = [1, 0]`
  (L57); `nextFreeSlot(registry, wordOrder)` walks the order (L163–171);
  `freeSlotCounts` (L178–188); `setCustomViewSlot` validates word + bit,
  checks collisions **within the destination word** with a correct `selfBit`
  guard, and hard-refuses a cross-word move for per-fixture membership
  (L343–368); `setCustomViewBit` delegates and still returns the old bit
  (L375–377); `createViewRegistry` preserves pinned `(word, bit)` verbatim
  (L108–114). Policy governs **new** slots only, as claimed. **See D4.**
- `simulation/lib/bench_section.cjs` — T3 counts word-0 pressure only, reports
  word-1 separately, names the ceiling "word-0" in both the refusal and the
  info finding; `MAX_VIEW_BITS` comment says "Usable bits in ONE view word".
  **See D5.**
- `simulation/src/gui/view_masks_editor.js` — imports `freeSlotCounts` (L21),
  emits both readouts (L313, L338). **See D3.**

---

## 4. Compliance statement

- **No edits were made to any verified file.** Not to the three docs, not to
  `views.yaml`, not to `titanic.viewmasks.js`, not to `model_loader.js`,
  `view_registry.js`, `bench_section.cjs` or `view_masks_editor.js` — including
  the files carrying discrepancies D1–D5, which are enumerated above for the
  coordinator rather than fixed here.
- **My only writes were this report and the tracker landing block.**
- **No git command that mutates anything was run.** Two read-only inspections
  were used and are disclosed: `git show HEAD:<file>` (to prove the groupBits
  blocks byte-identical) and `git ls-files --error-unmatch` (to determine
  whether the leaking files are tracked). No add, commit, branch, checkout,
  stash, reset, restore or push.
- **No deploy, no `npm install`, no `package.json`/lockfile change.**
- **No live engine boot, no sim server, no save server, no port bound.** Every
  harness drove the pure library modules / vendored WASM in-process. The
  parity tool and the test subsets bind no default port. The operator's
  launcher stack (**6966–6972, 5568, 8081, 10000**) kept every port throughout.
- All scratch scripts (`verify_135.mjs`, `check_docnames.mjs`,
  `group_counts.mjs`, the two `HEAD_*` captures) live in the session
  scratchpad — **nothing was written into the source tree**.
- Other agents' uncommitted work in this tree is untouched.

---

## 5. Recommended order of corrections (for the coordinator)

1. **D2 first — it hard-blocks the commit.** Redact the literal IP pair in
   `_137`'s report line 185 and tracker line 7201, then re-run
   `python scripts/security_check.py --all` and confirm only the six
   pre-existing `.scene_backups` findings remain.
2. **D1** — replace `MARSIN_ENGINE_PATTERNS.md` §7.3.1 lines 626–632 with the
   all-17-in-word-1 statement above. This is the only substantive
   documentation falsehood in the wave.
3. **D3** — `28` → `21` in `_137` §1.4 and its tracker block.
4. **D4 / D5** — optional diagnostic-message and defensive-filter cleanups in
   `view_registry.js` and `bench_section.cjs`; neither affects behaviour and
   neither is asserted by a test.

Everything else in the wave verified clean on the first pass.

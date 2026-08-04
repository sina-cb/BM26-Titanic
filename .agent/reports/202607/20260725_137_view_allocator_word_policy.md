# `_137` — View allocator word policy + word-aware bench budget

Developer thread, branch `feat/bm_readiness`. Subsystems: `simulation/`
view registry + Views panel + bench-section preflight, `marsin_engine/`
view-mask sidecar (titanic). **No git operations, no deploys, no installs,
no live server, no port bound** — every regeneration ran offline through the
registry APIs.

Fixes the two findings `_134` filed and deliberately left open:

- **§5.1** — `nextFreeSlot` spent the scarce word-0 resource on custom
  views, saturating word 0 on titanic so a new fixture group threw at export.
- **§5.3** — `bench_section.cjs` T3 counted word-1 custom views against the
  word-0 31-bit ceiling.

Sibling thread `_136` fixed `_134` §5.2 (`model_loader.js` word-blindness);
no file overlap with this one.

---

## 1. Problem 1 — the allocator spent the only word base groups can use

Two view words exist (`viewMask` / `viewMaskHi`, 31 usable bits each,
ABI `20260619_1`). They are **not** interchangeable:

| Consumer | Word 0 | Word 1 |
|---|---|---|
| Base group bits (`reconcileGroupBits` → `nextFreeBit`; mirrored in `engine.js` `assignGroupBits`) | **only home** | impossible |
| Custom views (resolve by NAME at model load) | works | works |

So word 0 is a **single-consumer-constrained** resource and word 1 is
unconstrained — yet `nextFreeSlot()` walked `word 0 → word 1`, handing every
new custom view a word-0 bit while word 1 sat empty.

Reproduced on titanic (24 groups + 17 views) before the fix:

```
word0 used 0x7fffffff   nextFreeBit 0
[Views] Out of view-mask bits while assigning group 'New Group' —
  a scene supports at most 31 distinct group/view bits
```

Word 1 had 21 free slots at that moment. The scene could not gain a single
fixture group, and the failure lands at model export (sim save), not on playa
— but it is still a hard stop, and it was caused purely by allocation order.

### 1.1 Policy chosen: word 1 first, word 0 as the spill target

`simulation/src/dmx/view_registry.js`:

```js
export const CUSTOM_VIEW_WORD_ORDER = [1, 0];
export function nextFreeSlot(registry, wordOrder = CUSTOM_VIEW_WORD_ORDER) { … }
```

`addCustomView` now allocates word 1 first and only spills into word 0 once
word 1 is full.

**Why this over a reserved word-0 headroom margin.** The margin design needs a
magic constant ("always keep N word-0 bits free for groups") that is correct
for no scene: too small on titanic, wasteful on `test_bench`, and it would
still let views eat word 0 while word 1 sits empty. Preference ordering needs
no constant, is scene-independent, and is strictly dominant — a view in word 1
behaves identically to one in word 0, so moving the *preference* costs nothing
and buys maximum group headroom. Keeping word 0 in the order as the spill
target preserves the full 62-slot capacity; exhausting all 62 still throws
(codex P0 — no silent degradation).

Verified policy behaviour:

```
empty scene, first custom slot: {"word":1,"bit":1}
after 32 addCustomView calls:   word1 count 31, word0 count 1   (spill works)
63rd view:                      throws "[Views] Out of view-mask slots …"
```

### 1.2 Existing assignments are untouched

The policy governs **new** slots only. `createViewRegistry` preserves every
pinned `(word, bit)` verbatim, so changing the policy renumbers nothing. Proven
by regenerating all three scenes' sidecars offline through
`createViewRegistry → buildViewmasksSidecarJS` and diffing against the tracked
files, ignoring the `// Updated:` stamp:

```
titanic:         sidecar-reproduces=true
studio_top_loft: sidecar-reproduces=true
test_bench:      sidecar-reproduces=true
```

`studio_top_loft` (6 groups + 2 views, word 0 at 8/31) and `test_bench`
(6 groups + 5 views, word 0 at 11/31) were **not** re-exported: byte-stable
under the new policy, nothing to write, and both have ample headroom in both
words. Only titanic was regenerated, and only because of the migration below.

### 1.3 New API: `setCustomViewSlot`

`setCustomViewBit` could only move a view *within* its word, so there was no
canonical way to relocate one. Added:

```js
setCustomViewSlot(registry, view, newWord, newBit) → { word, bit }  // the old slot
```

`setCustomViewBit` now delegates to it (contract unchanged — still returns the
old bit; the Views panel's per-fixture mask migration is unaffected).

It carries a hard refusal: a view whose membership is **per-fixture**
(`groups` empty, sidecar emits `pixelIndices` from each fixture's mask) may not
cross words, because fixtures carry a word-0 `viewMask` field only — the
membership would have nowhere to live and the view would export empty. Fail
loudly, never skip:

```
[Views] View 'PerFixture' has per-fixture membership and cannot move to word 1
  — fixture masks only exist in word 0. Give it group membership first.
```

### 1.4 Views panel budget readout made word-aware

`view_masks_editor.js` computed one flat free-bit count from
`usedBitsMask(reg)` (word 0 only) and labelled it as the custom-view budget.
Under the new policy that number is the **group** headroom, so a flat figure
would hide which ceiling is actually approaching. New helper
`freeSlotCounts(registry) → { word0, word1 }` drives two honest readouts:

- `GROUP VIEWS (auto) — 24 · 7 new group(s) fit`
- ~~`CUSTOM VIEWS — 17 · 28 slot(s) free (14 in word 1, 7 spill into the group word)`~~
- `CUSTOM VIEWS — 17 · 21 slot(s) free (14 in word 1, 7 spill into the group word)`

> **Correction (2026-08-03, `_135` verifier D3).** The struck line is what this
> report first quoted; the `28` was a transcription error **in the report only**,
> never in the code. `view_masks_editor.js:336` renders `free.word1 +
> free.word0` = 14 + 7 = **21**. The live string is the second line. See §7.

---

## 2. Problem 2 — `bench_section.cjs` T3 budget was word-blind

`checkTargetCompatibility` T3 summed `groupBits + custom.length + newBitNames`
against a flat 31-bit ceiling, charging word-1 views to the word-0 budget:

```
before: TGT_VIEW_BIT_BUDGET: applying needs 7 new view bits on top of
        24 group + 17 custom bits = 48, over the 31-bit ceiling
```

`48` was never a real quantity. Every name the bench block adds is a **group**
name, so it can only land in word 0; the budget that can actually refuse an
apply is word-0 pressure alone. Fixed to count word-0 customs only, report
word-1 usage separately, and name the ceiling honestly:

```
after:  31/31 word-0 view bits after apply
        (0 spare; word 1 holds 17 custom bit(s), independent of this budget)
```

The `MAX_VIEW_BITS = 31` doc comment now says *per word* rather than implying a
scene-wide cap.

### 2.1 Test decision — one known-red turns green, honestly

`tests/bench_section_sync.test.js` "view-bit headroom is REPORTED" asserted
`/30\/31 view bits/` and was **already failing at baseline** (the message read
`48`, and in fact no `TGT_VIEW_BIT_HEADROOM` finding existed at all because T3
was refusing). The `30` was stale from a titanic that had one fewer group.

Decision: **update the expectation to the honest value and let it go green.**
The test's purpose — "the budget must always be reported, not only when it
breaks" — is exactly what the fix restores, and pinning a number that was
already wrong helps nobody. It now asserts:

- `31/31 word-0 view bits after apply (0 spare` — the true word-0 pressure
  (24 titanic groups + 0 word-0 composites + 7 `TB ` group bits), with a
  comment explaining the arithmetic;
- `word 1 holds \d+ custom bit(s), independent of this budget` — the word-1
  figure is *reported*, never *charged*, and its exact value is deliberately
  not pinned so adding a composite view does not rot the test again.

Renamed to "…titanic fills the word-0 ceiling exactly" (it is at the ceiling,
not near it) and its sibling to "…the 31-bit **word-0** export ceiling".

One test added: **"word-1 composite views are NOT charged to the word-0
budget"** — twenty extra word-1 views must not move the word-0 number by a bit
nor turn the report into a refusal. That is the regression this fix exists to
prevent.

The pre-existing test at `:271` ("the real titanic scene can accept the block
today") **stays red**, but its refusal list shrank from 7 to 6: the spurious
`TGT_VIEW_BIT_BUDGET` is gone and only the six genuine `TGT_UNIVERSE_RESERVED`
collisions (U10/U12 on `10.x.x.13`/`.14`) remain. That is a separate, still-open
electrical defect — not this thread's.

---

## 3. titanic migration — done, and why it was safe

The policy fix prevents future waste but **cannot** unsaturate titanic on its
own: the 7 word-0 composites `_134` pinned are already there. The operator's
options were (a) land the policy only and leave titanic unable to gain a
fixture group, or (b) a one-time explicit migration of the pinned composites
into word 1 through the canonical chain.

**(b) was implemented**, because the zero-behavioural-risk bar is met. Audited
before touching anything — everything that could persist a raw `(word, bit)`:

| Potential holder | Finding |
|---|---|
| All 17 titanic composites | **group-based** (`groups: [...]`), zero `pixelIndices` — sidecar membership is by group NAME |
| `scenes/titanic/patches.yaml` (76 records) + `scene_config.yaml` (12) | every `viewMask: 0` — no fixture carries a composite bit |
| `marsin_engine/states/titanic/*.yaml` | `viewSelection: {type, target, invert}` — by name, no raw masks |
| CaptainPad | `{type:'viewMask', target:<name>}` throughout (`view_selection_picker_logic.ts`, `mixer.tsx`, `deckOverlaysApi.ts`) — by name |
| Patterns | `inView("Name")` / `MASK_*`, injected at model load. Only raw literal outside `summer_camp/` is `patterns/test/rpm_fixtures_tune_v2.js` `viewMask & 1`, which is a **group** bit — unmoved |
| Timelines / playlists / `pixel_map_views` | no view-mask references at all; `pixel_map_views` resolves `view:` selectors by name |
| Sim 3D isolation (`light_pool.js:448`, `animate.js:578`) | word-blind bit test **OR** `activeView.groups.includes(...)`; all 17 are group-based and all fixture masks are 0, so the group path is the only live one |

A `rg` for each composite's name across the whole repo returns hits in exactly
two files: `views.yaml` and `titanic.viewmasks.js` — both regenerated together.

### 3.1 What moved

Seven views, lowest free word-1 bits, in registry order. The 10 views already
in word 1 kept their exact bits; all 24 `groupBits` are byte-identical.

| View | Before | After |
|---|---|---|
| Hull Canvas | w0 `0x40000` | w1 `0x400` |
| Left Hull | w0 `0x80000` | w1 `0x800` |
| Right Hull | w0 `0x1000000` | w1 `0x1000` |
| Silhouette | w0 `0x2000000` | w1 `0x2000` |
| Left Silhouette | w0 `0x10000000` | w1 `0x4000` |
| Right Silhouette | w0 `0x20000000` | w1 `0x8000` |
| Jewelry | w0 `0x40000000` | w1 `0x10000` |

```
pre:  word0 31/31, word1 10/31
post: word0 24/31 (7 new group(s) fit), word1 17/31 (14 free)
```

Diff footprint: `views.yaml` 14 lines (7 × `bit` + 7 × `word`), sidecar 7 lines
+ the regeneration stamp. Nothing else in either file changed.

### 3.2 Canonical chain, not hand-edits

Driven offline exactly the way `_134` did — no sim browser, no save server, no
port bound:

`createViewRegistry(views.yaml)` → `setCustomViewSlot` × 7 (destination from
`nextFreeSlot(reg, [1])`) → `buildViewmasksSidecarJS(reg, pixels, 'titanic')`
+ `yaml.dump({ views }, { lineWidth: -1 })`.

The migration script **refuses to run** unless the tracked sidecar is first
proven byte-reproducible from the tracked `views.yaml` — never regenerate onto
drift. It also asserts, post-move: `groupBits` string-identical, view
names/order/membership deep-equal, every pre-existing word-1 bit unchanged, all
17 bits distinct in word 1, word 0 holding group bits only.

### 3.3 Verification

**inView() resolution harness** (`_134` style, zero-miss/zero-leak). Replicates
`engine.js:504-522`'s group tagging verbatim against the real 964-pixel titanic
model, then for every view compares the *resolved* pixel set
(`(word ? vMaskHi : vMask) & bit`) against the *expected* set (pixels whose
group is in the view):

```
harness: 17/17 views — identical pixel membership before/after, zero miss, zero leak
         total tagged pixels: 1844
```

**Engine accepts the migrated sidecar** — `engine.js --model titanic --dry-run`
(state/playlist dirs redirected to scratch; dry-run binds no port and runs no
loop):

```
[Model] Loaded 17 view-mask preset(s) from titanic.viewmasks.js
[Model] Pattern constants: MASK_LEFT_BACK_WALL, … MASK_AUDITORIUMS   (41)
  🏁 Dry run complete. Pattern loads and compiles OK.
```

The `Pattern constants` line is **byte-identical** before and after — pattern
code sees no change whatsoever.

`_136`'s now-word-aware VM loader agrees: `loadModelForGauge('titanic')` →
`pixels 964 views 17`.

**The original defect is gone:**

```
word0 used 0xcf3ffff   nextFreeBit 0x40000
[Views] Group bits reconciled (+1 −0): { added: [ 'New Group' ] }
OK added [ 'New Group' ] bit 0x40000
```

---

## 4. Gates

| Gate | Result |
|---|---|
| `node tools/scene_model_parity.cjs titanic` | **PASS** — 0 error, 0 warning, 1 info |
| `node tools/scene_model_parity.cjs titanic --strict` | **PASS** — 0 error, 0 warning, 1 info |
| `simulation` `npm test` | 1737 tests, 1730 pass, **7 fail** (baseline 1736 / 1728 / 8) |
| `marsin_engine` mixer subset (incl. `auto_views`, `in_view_intrinsic`, `pattern_mixer_masking`, `view_fader_ramp`, `view_mask_constants`, `view_mask_hi_host`) | 489 / 489 **pass** |
| `marsin_engine` integration subset | 59 / 59 **pass** |
| `marsin_engine` effects + tools + patterns subsets | 537 tests, 535 pass, 2 fail — both pre-existing/unrelated (below) |

**No new failures.** The sim suite gained one test (the word-1 budget
regression test) and lost one failure: "view-bit headroom is REPORTED" flipped
known-red → green, as designed in §2.1. The 7 remaining are exactly the
baseline 8 minus that one:

1. `fixtures are docked beside the ship…` (bench dock geometry)
2. `the real titanic scene can accept the block today…` (U10/U12 collisions; its
   refusal list shrank 7 → 6, see §2.1)
3. `CLI: default emit … parity=absent` (same universe collisions)
4. `CLI: --require-applied fails (exit 3)…` (same)
5. `the compression threshold has real headroom on the live scene`
6. `real scene test_bench: the model is a faithful export of the scene`
7. `real scene test_bench: every remaining error is a known open mapping defect`

The two engine-side failures are not regressions and not view-related:

- `tests/effects/effects_v2_mode_page_layout.test.js` — node test-runner IPC
  error (`Unable to deserialize cloned data…`) under parallel load; **47/47
  pass when the file is run alone**.
- `tests/patterns/specialty_white_uv.test.js` "both scenes carry byte-identical
  copies…" — `simulation/scenes/{test_bench,titanic}/playlists/white_only.yaml`
  genuinely diverge (titanic's entries have `defaults: {}`, the bench's carry
  slider values). Both files are **unmodified in the working tree** and contain
  no view data.

---

## 5. Files changed

| File | Change |
|---|---|
| `simulation/src/dmx/view_registry.js` | `CUSTOM_VIEW_WORD_ORDER`; `nextFreeSlot(registry, wordOrder)` word-1-first; new `freeSlotCounts`, `setCustomViewSlot`; `setCustomViewBit` delegates; module + `addCustomView` docs rewritten for the policy; `reconcileGroupBits` exhaustion message corrected (§7 D4) |
| `simulation/src/gui/view_masks_editor.js` | word-aware budget readouts (group headroom + per-word view slots); imports `freeSlotCounts` instead of `usedBitsMask` |
| `simulation/lib/bench_section.cjs` | T3 counts word-0 pressure only; word-1 usage reported, never charged; `MAX_VIEW_BITS` doc corrected to *per word*; malformed custom entries refused by name and charged to neither word (§7 D5) |
| `simulation/tests/bench_section_sync.test.js` | headroom expectations updated to the honest values + renamed; new "word-1 composites are NOT charged" and "malformed entry charged to NEITHER word" regression tests |
| `simulation/scenes/titanic/views.yaml` | **generated** — 7 composites moved to word 1 (14 lines) |
| `marsin_engine/models/titanic.viewmasks.js` | **generated** — same 7 entries + stamp (7 lines) |

`studio_top_loft` and `test_bench` scenes/sidecars: **untouched**, verified
byte-stable under the new policy (§1.2).

---

## 6. Findings filed (not fixed here)

### 6.1 `vMaskHi` never reaches exported pixels — word-1 per-fixture views export empty

`pixelblaze_model_exporter.js` writes `vMask: light.viewMask || 0` on every
pixel and no `vMaskHi` field at all, while
`buildViewmasksSidecarJS` reads `memberField = view.word === 1 ? 'vMaskHi' :
'vMask'`. A word-1 view with **per-fixture** membership therefore always finds
zero members and is silently skipped from the sidecar (with a `console.warn`).

Latent today — every scene's composites are group-based, and `setCustomViewSlot`
(§1.3) now refuses to create the cross-word case by relocation. But
`addCustomView` allocates word 1 first, so the *next* view an operator creates
and populates by clicking fixtures will hit this. Fix is either a fixture-side
`viewMaskHi` field carried through the exporter, or a loud refusal in the Views
panel when fixtures are assigned to a word-1 view. Sim-side: the same blindness
exists in the 3D isolation paths (`light_pool.js:448`, `animate.js:578`), which
test `activeView.bit` against the word-0 `viewMask` only.

### 6.2 titanic word-0 is at 24/31 with the bench block needing all 7

Post-migration titanic has exactly 7 free word-0 bits, and the `TB ` bench block
wants exactly 7 group bits — `31/31 … (0 spare)`. It fits, but with no margin:
one more fixture group in either scene and the apply refuses. Worth a plan note
before Phase B.

---

## 7. Corrections — `_135` verifier follow-up (2026-08-03)

The `_135` verifier passed the core work (47/47 offline checks, migration
byte-exact, zero new failures) and flagged three items, all corrected here.
Nothing about the allocator policy, the titanic migration, or the T3 budget
arithmetic changed as a result — D3 was a report typo, D4 was diagnostic
wording, D5 was a defensive gap on input no shipped scene contains.

### D3 — §1.4 quoted the panel string wrong (report only)

The report first wrote `CUSTOM VIEWS — 17 · 28 slot(s) free (14 in word 1,
7 …)`. `view_masks_editor.js:336` computes `free.word1 + free.word0` = 14 + 7 =
**21**; `28` was a transcription error, and 14 + 7 ≠ 28 on its face. The code
was always right. §1.4 now shows the wrong line struck through above the
corrected one, and the tracker block carries the same correction. **No code
change.**

### D4 — `reconcileGroupBits` exhaustion message claimed a 31-slot scene

`view_registry.js` still threw *"a scene supports at most 31 distinct
group/view bits"*. False since Tier-C: a scene supports **62** slots; 31 is the
**word-0** ceiling, which is the only word base groups can use. This is the
same wording class already corrected in `bench_section.cjs` and
`addCustomView` — this throw site was missed. Now:

```
[Views] Out of view-mask bits while assigning group 'One Too Many' — base group
bits live in word 0 only, which holds at most 31 bits and is full. (The scene as
a whole supports 62 slots; the rest are word-1 custom-view slots, which groups
cannot use.) Free a word-0 bit by moving a custom view to word 1 or by removing
an unused group.
```

It also now names the remedy, which is exactly the §3 migration. Diagnostic
text only — the throw condition (`nextFreeBit === 0`) is unchanged.

### D5 — a malformed `custom:` entry was charged to word 0

`bench_section.cjs` T3 used `(v && v.word) !== 1`, so a `null` entry (a bare
`- ` in `views.yaml` parses to null) and an entry with a bogus `word` both
counted as **word-0** pressure — inflating the group budget and potentially
refusing a legal apply on the strength of a junk list item.

**Decision: refuse by name, charge to neither word.** Silently dropping the
entry would hide a malformed scene file; charging it to word 0 invents a number
(codex P0 — no silent fixup, no fallback). Throwing was rejected because this
module's contract is to *report named findings* and exit non-zero, not to crash
the CLI with a stack trace. So a malformed entry now raises

```
refuse TGT_VIEW_ENTRY_MALFORMED  views.yaml
  target views.yaml has a custom-view entry the view registry would reject
  (null) — its view word is unknown, so the view-bit budget below cannot be
  trusted. Fix views.yaml before applying the bench block.
```

and is excluded from both word counts, so the budget line stays honest
alongside the refusal. "Malformed" mirrors what `createViewRegistry` would
reject for the fields T3 reads: a non-object entry, or a `word` that is present
and not 0 or 1.

New test **"REFUSES a malformed custom-view entry, and charges it to NEITHER
word"** injects `null` + `{name:'bad', word:7}` into the real titanic views and
asserts two refusals plus a `TGT_VIEW_BIT_HEADROOM` message **string-identical**
to the clean run. No shipped scene contains such an entry, so no real-scene
finding changes.

### Gates re-run after D3–D5

| Gate | Result |
|---|---|
| `node tools/scene_model_parity.cjs titanic` | **PASS** — 0 error, 0 warning, 1 info |
| `node tools/scene_model_parity.cjs titanic --strict` | **PASS** — 0 error, 0 warning, 1 info |
| `tests/bench_section_sync.test.js` | 44 tests, 40 pass, 4 fail — the same 4 pre-existing reds |
| `bench_section_sync` + `pixel_map_views` + `te_sign_grouping_parity` | 101 tests, 97 pass, 4 fail — same 4 |
| `simulation` `npm test` | **1738 / 1731 pass / 7 fail** (was 1737 / 1730 / 7; baseline 1736 / 1728 / 8) |

**Zero new failures.** The suite gained exactly the one D5 test; the 7 reds are
unchanged from §4. Engine subsets were not re-run — D3 is prose, D4 is a
sim-only throw string, and D5 is sim-only preflight code; no engine-consumed
artifact (`views.yaml`, `*.viewmasks.js`) was touched by these three fixes.

> A fourth verifier item (**D2**, two literal controller IPs in this report and
> in the tracker tripping `scripts/security_check.py`) was redacted by the
> coordinator to `10.x.x.13`/`.14` in both files. Those redactions are
> deliberate and left intact — the octets are not restored.

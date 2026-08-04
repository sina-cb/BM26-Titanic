# `_138` — `vMaskHi` reaches exported pixels (word-1 per-fixture views stop exporting empty)

Developer thread, branch `feat/bm_readiness`. Subsystem: `simulation/` model
exporter + view registry + Views panel + the two 3D isolation paths + the
scene→patch persistence chain. **No git operations, no deploys, no installs,
no live server, no sim boot, no port bound** — every regeneration and every
check ran offline through the library APIs and the node test runner.

Fixes finding **§6.1 of `20260725_137_view_allocator_word_policy.md`**, which
`_137` filed and deliberately left open. `_137` also made it urgent: its
allocator change (`CUSTOM_VIEW_WORD_ORDER = [1, 0]`) means the *next* custom
view an operator creates is a word-1 view, so the very next one they populate
by clicking fixtures would have exported empty.

---

## 1. Where the high word was dropped

Two words exist (`viewMask` / `viewMaskHi`, 31 usable bits each, ABI
`20260619_1`) and the chain that carries per-fixture membership from an
operator's click to the engine has five links. **Only the first and last were
word-aware.**

| Link | File | Word-aware before? |
|---|---|---|
| 1. view slot allocation | `view_registry.js` `addCustomView` | ✅ yes (`_137`) — allocates word 1 first |
| 2. operator clicks fixtures | `view_masks_editor.js` Assign / Unassign / delete / count | ❌ **no** — wrote `f.viewMask` unconditionally |
| 3. fixture config → pixel | `pixelblaze_model_exporter.js` | ❌ **no** — `vMask: light.viewMask \|\| 0`, no `vMaskHi` field at all |
| 4. pixels → sidecar | `view_registry.js` `buildViewmasksSidecarJS` | ✅ yes — `memberField = view.word === 1 ? 'vMaskHi' : 'vMask'` |
| 5. sidecar → engine | `engine.js` (`mergeWordBit`, `px.vMaskHi ?? 0`), `model_loader.js` (`_136`) | ✅ yes |

So the word survived allocation, was **thrown away at link 2** (the bit went
into the word-0 field), and then link 4 — correctly reading `vMaskHi` for a
word-1 view — found nothing on **any** pixel, because link 3 never wrote that
field in the first place. The view was silently skipped from the sidecar with
a `console.warn` and rendered as zero pixels.

Both links had to be fixed. Fixing only the exporter would have left the panel
writing into the wrong word; fixing only the panel would have left the exporter
with nowhere to read it from. **Link 3 is the one the brief names, and it was
the harder half: there was no `viewMaskHi` field on a fixture config anywhere
in the sim.**

### 1.1 The two failure modes, not one

An orphaned bit is not merely *missing* — in word 0 it is *wrong*:

- **Empty export.** The sidecar emits no entry, so `inView("Name")` matches
  zero pixels at render. Loud-ish (one `console.warn` at save) but fatal.
- **Aliasing.** A word-1 view's bit written into `viewMask` collides with
  whatever owns that value in word 0 — and word 0 is where **base group bits**
  live. `titanic` word-1 bits `0x1`, `0x2`, `0x4`, … are all live group bits in
  word 0. A fixture clicked into the word-1 view `Left Jewelry` (w1 `0x1`)
  would have silently joined the word-0 group view `Right Front Wall`
  (`0x1`) in the 3D isolation preview and in the per-fixture chip row.

The second mode is why the fix could not be a "carry the bit anyway" patch.

---

## 2. The fix

### 2.1 The contract, written down once

`view_registry.js` gains the word→field mapping and the three predicates that
are now the ONLY places a mask field is named:

```js
export const FIXTURE_MASK_FIELDS = ['viewMask', 'viewMaskHi'];  // configs
export const PIXEL_MASK_FIELDS   = ['vMask', 'vMaskHi'];        // exported pixels
export function viewWord(v)            // was private, now exported
export function fixtureMaskField(view) // 'viewMask' | 'viewMaskHi'
export function pixelMaskField(view)   // 'vMask'    | 'vMaskHi'
export function fixtureInView(config, view)      // read, view's own word
export function pixelInView(pixel, view)         // read, view's own word
export function setFixtureInView(config, view, member)  // write, view's own word
```

Every caller below goes through these; no site indexes the fields by hand.
`buildViewmasksSidecarJS` was already correct and now expresses it as
`pixelInView(p, view)` rather than its own inline ternary.

### 2.2 The exporter carries both words

`pixelblaze_model_exporter.js`, all three pixel-push sites (multi-pixel DMX
fixture, simple DMX fixture, LED strand):

```js
vMask:   light.viewMask   || 0,
vMaskHi: light.viewMaskHi || 0,
```

**Serialization is conditional**, and deliberately so:

```js
const hiStr = (p.vMaskHi || 0) !== 0 ? `, vMaskHi: ${p.vMaskHi}` : '';
```

`engine.js:418` declares the default (`px.vMaskHi = px.vMaskHi ?? 0`), so an
absent field is exactly the zero the engine already assumed — and a scene with
no word-1 per-fixture membership exports a **byte-identical** model file to
before. This is the same rule `ledWire` / `unpatched` already follow in the
same function, and it is what keeps §5 true. The field sits immediately after
`vMask`, before `patch`, so field order is canonical.

Note on responsibility: the engine resolves a per-fixture view from the
**sidecar's `pixelIndices`**, which `buildViewmasksSidecarJS` computes from the
**in-memory** pixel objects. So the load-bearing half of this fix is
`generatePixelMap` populating `vMaskHi`; the serialized `vMaskHi:` field is the
model↔scene consistency carrier that the parity gate now checks (§2.6).

### 2.3 The Views panel writes into the view's word

`view_masks_editor.js`: `memberCount`, "✓ Assign sel.", "✗ Unassign sel.",
delete-clears-the-bit, the bit-input's per-fixture migration, and
`applyViewMaskIsolation`'s membership test all go through
`fixtureInView` / `setFixtureInView` / `fixtureMaskField`.

Two **latent second-order bugs** surfaced while doing it and are fixed here:

- The preview-isolation highlight and the delete handler matched the active
  view by `__activePreviewView.bit === view.bit`. With two independent bit
  spaces two views can legitimately share a bit **value**, so that test lit up
  (and could have cleared) the wrong card. Both now match by view **identity**
  (`__activePreviewView === view` — it is always one of `reg.custom`).
- The delete confirmation now names the field it will clear.

### 2.4 The two 3D isolation paths outside the panel

`_137` §6.1 named both. `light_pool.js:448` → `fixtureInView(fixture.config,
activeView)`; `animate.js` instanced-dot isolation → `pixelInView(entry,
activeView)` (its `entry` objects ARE exporter pixels, so they now carry
`vMaskHi`).

### 2.5 Persistence — or the membership dies at the next reload

A word-1 bit the panel writes has to survive a save/load round trip, a
projection, and a rename, or the fix is cosmetic:

| File | Change |
|---|---|
| `server/save-server.js` | DMX patch record gains `viewMaskHi` (written only when non-zero — §5); `delete fixture.viewMaskHi` off the structural tree, unconditionally, exactly like `viewMask`. The `bus: led` branch keeps BOTH words on the structural tree, unchanged (an LED thing has a patch record only while patched, so its identity must not live there). |
| `main.js` | `__globalPatchTree` rows carry `viewMaskHi` — this tree is what the rename snapshot reads. |
| `src/gui/gui_builder.js` | `viewMaskHi` defaulted to 0 alongside `viewMask` at every config-seeding site (6); patch-tree clear zeroes it; the per-fixture "Views:" chip uses `fixtureInView`. |
| `src/dmx/auto_patcher.js` | `clearMetadata` and `clearAllPatches` zero **both** words — clearing only word 0 would leave a word-1 membership behind as invisible, un-clearable state. |
| `src/dmx/rename_invalidation.js` | `DISPLAY_PATCH_FIELDS = ['viewMask', 'viewMaskHi']`; `prunePatchTreeEntries` reports both; **`carryViewMasks` now takes `name → {viewMask, viewMaskHi}`** and carries both. The report line names both words, so a word-1-only carry no longer prints `viewMask 0x0` and reads as a no-op. |
| `src/gui/gui_builder.js` (rename) | the `oldMasks` snapshot collects both words from the patch tree AND the live configs; both `carryViewMasks` call sites and both log lines updated. |
| `lib/bench_section.cjs` + `tools/bench_section_sync.cjs` | `DERIVED_METADATA_FIELDS` strips `viewMaskHi` too — otherwise a bench fixture's word-1 membership would be imported into titanic under whatever unrelated view owns that bit there, the exact class of leak the list exists to prevent. |

`carryViewMasks`'s signature change is a **breaking contract change** and was
taken deliberately over accepting either a number or an object: a polymorphic
input would have made a word-0-only caller silently correct and a word-1 caller
silently lossy. Both call sites and the four affected tests were updated.

### 2.6 Parity gate

`lib/scene_model_parity.cjs` compares `px.vMaskHi` against the record's
`viewMaskHi` in both the DMX-record and the LED/strand structural-tree
freshness checks. A stale high word is exactly as dead as a stale low one.

---

## 3. `setCustomViewSlot`'s refusal — LIFTED, and replaced with a narrower one

`_137` §1.3 refused any cross-word relocation of a per-fixture view:

> `[Views] View 'PerFixture' has per-fixture membership and cannot move to word 1
> — fixture masks only exist in word 0. Give it group membership first.`

**That refusal existed ONLY because fixtures could not carry `vMaskHi`.** They
can now, so the premise is gone and the refusal is lifted.

It is not simply deleted, because auditing it turned up a *second*, real
reason a naive lift would be unsafe: `setCustomViewSlot` mutates the registry
only, so a caller that relocates a view across words and forgets to migrate the
per-fixture bits produces **both** failure modes of §1.1 at once — the view
exports empty from its new word AND the bit stranded in the old word aliases
whatever owns that value there. That is a foot-gun, not a reason to keep the
view stuck in word 0.

So the relocation is made **atomic** instead:

```js
setCustomViewSlot(registry, view, newWord, newBit, fixtures = null)
```

- **cross-word + no `fixtures`** → throws, naming both fields and the fix:
  *"Moving view 'X' from word 1 to word 0 must migrate its per-fixture
  membership between the 'viewMaskHi' and 'viewMask' fields — pass the scene's
  fixture + strand config list as the 5th argument. Refusing to move the view
  and strand its members."*
- **cross-word + `fixtures`** → the bit is cleared from the old field and set
  in the new one on every config that had it, inside the same call, after the
  destination-word collision check passes. Nothing partial: a rejected move
  leaves the view and every fixture untouched.
- **same-word** → unchanged. `setCustomViewBit` delegates here and its Views-
  panel caller still migrates from the returned old bit, as before.

Net effect: the *capability* the old message denied is now available; what
remains refused is only the genuinely unsafe call shape, and it is refused with
a required argument rather than a blanket "give it group membership first".

`_137`'s titanic migration path is unaffected — those seven views were
group-based, and a group-based cross-word move still needs the argument (the
list is cheap to pass and the registry cannot know a view has no fixture
members without it).

---

## 4. Regression test — `simulation/tests/view_mask_hi_export.test.js`

New file, **13 tests, 13 pass**, offline, `_134`'s zero-miss/zero-leak shape.
It drives the real `generatePixelMap` / `saveModelJS` / `buildViewmasksSidecarJS`
against a mocked browser world (THREE math + plain objects + a fetch stub), the
same harness the sibling exporter tests use.

Scene under test: three bars — `Bar A` (3 px, group `Bars`), `Bar B` (2 px,
`Bars`), `Bar C` (2 px, `Rail`) → pixel indices A `0,1,2` · B `3,4` · C `5,6`.

| Test | Asserts |
|---|---|
| a brand-new custom view is allocated into word 1 | the allocator policy that makes this the DEFAULT path, not an exotic one — `{word:1, bit:1}`, field `viewMaskHi` |
| every exported pixel carries vMask AND vMaskHi | field present on all 7 pixels; both words mirrored independently from the config |
| LED strand pixels carry the high word too | `strand.viewMaskHi` → `vMaskHi` on every strand pixel |
| **word-1 per-fixture view: sidecar membership is EXACTLY the clicked fixtures** | operator clicks A + C, not B. The bit lands in `viewMaskHi` and `viewMask` is never created. Sidecar EMITS the view (`bit: 0x0001, word: 1, pixelIndices:`) — it was skipped entirely before. Resolved set `[0,1,2,5,6]` — **zero miss, zero leak** — matched three ways: expected-by-name, the sidecar's emitted indices, and `pixelInView` |
| a word-1 view does NOT leak through the word-0 field | Bar B carries the SAME BIT VALUE in `viewMask` (a legitimate group bit); it must not appear in the word-1 view's members — the §1.1 aliasing mode |
| **word-0 control: unchanged resolution, no `vMaskHi` in the model text** | a pinned pre-Tier-C view (`{name, bit}`, no `word` key). Assign never touches the high word; every pixel's `vMaskHi === 0`; the sidecar emits the LEGACY form with no `word:` key; the serialized model contains the string `vMaskHi` **nowhere at all** and still carries `vMask: 256, patch:` |
| the model text carries vMaskHi on exactly the word-1 members | `vMaskHi: 1,` on lines 0,1,2,5,6 and absent on 3,4; canonical placement `vMask: 0, vMaskHi: 1, patch:` |
| setCustomViewSlot moves a per-fixture view across words | w1→w0 with fixtures: old slot returned, `viewMaskHi` cleared, `viewMask` set, non-member untouched, sidecar still `[0,1,2,5,6]` |
| … round-trips word 0 → word 1 | w0→w1 keeps the same membership, sidecar gains `word: 1` |
| a cross-word move WITHOUT the fixture list is refused | throws on the exact message; **nothing moved** (no partial application) |
| a same-word move still needs no fixture list | the unchanged contract |
| cross-word collisions are still checked in the DESTINATION word | a taken word-0 bit refuses the move; the view stays put |
| group-based views still resolve by group name, in EITHER word | **the brief's "verify that assumption"** — see §4.1 |

### 4.1 Group-based views are unaffected — verified, not assumed

Confirmed by reading and by test. `buildViewmasksSidecarJS` branches on
`view.groups.length > 0` **before** any mask field is touched and emits
`groups: [...]`; no fixture mask and no pixel mask is read on that path at all.
The engine then tags membership from the group names (`engine.js:507-521`),
merging the bit into the lane the view's `word` selects. So a group-based view
is word-agnostic on the sim side by construction — which is exactly why all 17
titanic composites survived `_137`'s cross-word migration untouched, and why
this thread's change cannot move them. The test pins both a word-1 and a word-0
group view emitting `groups:` with **no** `pixelIndices`.

---

## 5. Re-export sanity — all three scenes byte-stable

**No tracked scene has a per-fixture view at all**, let alone a word-1 one:

```
grep -c pixelIndices  marsin_engine/models/{titanic,studio_top_loft,test_bench}.viewmasks.js
  →  0   0   0
```

titanic's 17 word-1 views are all group-based (`_137` §3). So the change must
be a no-op on every tracked artifact, and it is. Regenerated all three sidecars
offline through the exact chain `saveModelJS` uses — `createViewRegistry(views.yaml)`
→ `reconcileGroupBits(listPixelGroups(pixels))` → `buildViewmasksSidecarJS` —
against the real tracked models, and diffed against the tracked sidecars
ignoring only the `// Updated:` stamp:

```
titanic          sidecar-reproduces=true  views=17  word1=17  per-fixture-views=0
                 model-pixels-with-vMask=0  with-vMaskHi=0
studio_top_loft  sidecar-reproduces=true  views=2   word1=0   per-fixture-views=0
                 model-pixels-with-vMask=0  with-vMaskHi=0
test_bench       sidecar-reproduces=true  views=5   word1=0   per-fixture-views=0
                 model-pixels-with-vMask=0  with-vMaskHi=0
ALL THREE SIDECARS BYTE-STABLE (stamp excluded)
```

The extra columns are the point: **not one pixel in any tracked scene carries a
non-zero `vMask` either**, so the conditional `vMaskHi:` emission means the
three model files are byte-identical too, and no `patches.yaml` / `scene_config.yaml`
record changes on the operator's next save. **No generated file was written or
hand-edited by this thread.** (The script lives in the session scratchpad.)

---

## 6. Gates

| Gate | Result |
|---|---|
| `node tools/scene_model_parity.cjs titanic` | **PASS** — 0 error, 0 warning, 1 info |
| `node tools/scene_model_parity.cjs titanic --strict` | **PASS** — 0 error, 0 warning, 1 info |
| `simulation` `npm test` | **1752 tests, 1745 pass, 7 fail** (baseline `_137` §7: 1738 / 1731 / 7) |
| `marsin_engine` `tests/mixer/model_loader_word_aware.test.js` | **14 / 14 pass** |
| `marsin_engine` view/mask mixer subset (`auto_views`, `in_view_intrinsic`, `pattern_mixer_masking`, `view_fader_ramp`, `view_mask_constants`, `view_mask_hi_host`) | **109 / 109 pass** |

**Zero new failures.** The suite grew by exactly 14 — the 13-test new file plus
one added `carryViewMasks` word-1 test — and 1738 + 14 = 1752 exactly. The 7
reds are the same 7 by name as `_137` §4/§7:

1. `fixtures are docked beside the ship…` (bench dock geometry)
2. `the real titanic scene can accept the block today…` (U10/U12 collisions)
3. `CLI: default emit … parity=absent` (same)
4. `CLI: --require-applied fails (exit 3)…` (same)
5. `the compression threshold has real headroom on the live scene`
6. `real scene test_bench: the model is a faithful export of the scene`
7. `real scene test_bench: every remaining error is a known open mapping defect`

Items 6–7 are worth naming explicitly because this thread touched the parity
validator: their diff messages are still `sId 7 ≠ 0; fId 13 ≠ 0` on the two
`TE Sign V3` strands — the pre-existing id defect. **The new `vMaskHi` check
adds no finding to any real scene**, exactly as §5 predicts.

Engine subsets were run because the exporter feeds the engine, even though no
engine source and no engine-consumed artifact changed.

---

## 7. Files changed

| File | Change |
|---|---|
| `simulation/src/dmx/view_registry.js` | word→field contract (`FIXTURE_MASK_FIELDS`, `PIXEL_MASK_FIELDS`, `viewWord` exported, `fixtureMaskField`, `pixelMaskField`, `fixtureInView`, `pixelInView`, `setFixtureInView`); `setCustomViewSlot` cross-word refusal lifted → atomic migration with a required `fixtures` argument; sidecar builder uses `pixelInView`; module doc rewritten for two-word per-fixture membership |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | `vMaskHi` on all three pixel-push sites; conditional `vMaskHi:` serialization |
| `simulation/src/gui/view_masks_editor.js` | every per-fixture read/write word-aware; preview-isolation match by identity not bit value; delete text names the field |
| `simulation/src/core/light_pool.js` | isolation membership via `fixtureInView` |
| `simulation/src/core/animate.js` | instanced-dot isolation via `pixelInView` |
| `simulation/src/gui/gui_builder.js` | `viewMaskHi` defaults (6 sites) + patch-tree clear; chips via `fixtureInView`; rename snapshot + both carry log lines two-word |
| `simulation/src/dmx/rename_invalidation.js` | `DISPLAY_PATCH_FIELDS`, `prunePatchTreeEntries`, `carryViewMasks` (contract change), report line — all two-word |
| `simulation/src/dmx/auto_patcher.js` | both clear paths zero both words |
| `simulation/server/save-server.js` | `viewMaskHi` into the DMX patch record (non-zero only); stripped from the structural tree |
| `simulation/main.js` | `__globalPatchTree` rows carry `viewMaskHi` |
| `simulation/lib/scene_model_parity.cjs` | `vMaskHi` freshness checks (DMX record + LED structural tree) |
| `simulation/lib/bench_section.cjs`, `simulation/tools/bench_section_sync.cjs` | `viewMaskHi` stripped from a ported bench block + header comment |
| `simulation/tests/view_mask_hi_export.test.js` | **new** — 13 tests |
| `simulation/tests/rename_invalidation.test.js` | updated to the two-word `carryViewMasks` contract + one new word-1 test |

No generated scene/model/sidecar file was touched. No engine source touched.

---

## 8. Findings filed (not fixed here)

### 8.1 A view with BOTH groups and clicked fixtures silently drops the fixtures

`buildViewmasksSidecarJS` branches `if (view.groups.length > 0) { …emit groups…;
continue; }` — so on a view that has *any* group attached, per-fixture bits are
never read and never exported. But the Views panel lets the operator do both:
"✓ Assign sel." writes the bit regardless, and the member count reads
`"N fixture(s) + M group(s)"`, actively advertising a mixed membership the
export cannot represent. Pre-existing, affects both words equally, and this
thread does not change it. Fix is a decision, not a patch: either the sidecar
unions groups + `pixelIndices`, or the panel refuses/warns on mixing.

### 8.2 `patches.yaml` emits `viewMaskHi` only when non-zero, unlike `viewMask`

Deliberate (§2.2, §5): it is what keeps every existing scene's `patches.yaml`
byte-identical on the next save. The reader's default is 0 in one place
(`fixtureInView`), so this is field omission against a declared default, not a
fallback. Worth revisiting only if a schema-shape check ever wants symmetry —
at which cost every scene's `patches.yaml` gains one line per fixture.

### 8.3 2D Pixel Map `view:` selectors cannot see a per-fixture view

`pixel_map_views.js` `resolveViewGroups` resolves a custom view to `v.groups`
only, so a per-fixture view resolves to the empty set and a
`view: <that name>` selector matches no cluster. Word-agnostic and
pre-existing — but now more reachable, since word-1 per-fixture views actually
work end-to-end.

---

## 9. Autonomy / safety statement

- **No git command of any kind** — no add, commit, branch, checkout, stash,
  reset, push. Working-tree state was read only through `git status --porcelain`
  and `git diff --numstat` to confirm other agents' uncommitted work was
  untouched.
- **No deploy, no `npm install`, no `package.json` / lockfile change.**
- **No server, no sim boot, no engine boot, no port bound.** The operator's
  launcher stack (6966-6972, 5568, 8081, 10000) kept every port. Every check
  ran in-process via `node --test` or a scratchpad ES module.
- **No generated file written or hand-edited** — the §5 regeneration compares
  in memory and writes nothing.
- Scratch files live in the session scratchpad only.
- Other agents' uncommitted work in the tree is untouched: the 14 files above
  plus this report and the tracker block are the complete write set.

# `_134` — Titanic semantic engine views: 17 composite views, canonically exported

Developer thread (sub-agent B of a coordinated wave), branch
`feat/bm_readiness`. Subsystem: `simulation/` view registry +
`marsin_engine/` view-mask sidecar. **No git operations, no deploys, no
installs, no live engine boot.**

The titanic scene had 24 base group bits and **zero** composite views
(`custom: []`) — every operator selection had to be a single physical group, and
patterns had no artistic handle on the ship. This lands the semantic vocabulary:
hull / silhouette / jewelry / organs / identity, each with its Left and Right
half where the ship is symmetric.

---

## 1. What changed (two files only)

| File | Change |
|---|---|
| `simulation/scenes/titanic/views.yaml` | line 27 `custom: []` → 17 custom views. **The 24 `groupBits:` lines are byte-for-byte untouched.** |
| `marsin_engine/models/titanic.viewmasks.js` | 17 `viewMasks[]` entries + the regenerated `// Updated:` stamp. **The `groupBits` block is byte-for-byte untouched.** |

Nothing else was written. `pixel_map_views.yaml`, `controllers.yaml`,
`patches.yaml`, `scene_config.yaml`, `titanic.js`, `titanic.effects.js` and every
pattern/playlist are untouched.

### Generated, not hand-authored

Both files came out of the repository's **canonical** view mechanism, driven
offline (no sim browser, no server, no ports):

- `simulation/src/dmx/view_registry.js` — `createViewRegistry` →
  `reconcileGroupBits` (asserted a **no-op**: `+0 −0`, groupBits string-identical
  before/after) → `addCustomView` (name validation + `nextFreeSlot` allocation) →
  `buildViewmasksSidecarJS`. This is the exact call chain
  `pixelblaze_model_exporter.js → saveModelJS()` runs.
- `simulation/server/save-server.js`'s own writer for the YAML:
  `yaml.dump({ views }, { lineWidth: -1 })`.

The generator **asserts** the pre-existing `views.yaml` is byte-identical to
canonical `yaml.dump` output before writing, so the file cannot be silently
reformatted, and it refuses to run if `custom[]` is non-empty (no clobbering a
concurrent edit).

No broader mapping file needed rewriting, so no scope expansion was required for
the export itself. (Three word-blindness defects found in *consumers* are
reported in §5 — none of them were edited.)

---

## 2. The 17 views

Word 0 is the legacy `viewMask` Int32; word 1 is the Tier-C `viewMaskHi`
(ABI 20260619_1). The canonical allocator (`nextFreeSlot`) fills word 0 before
word 1, so the seven bits word 0 still had free went first and the rest spilled
into word 1 — exactly what the sim's Views panel "Add view" button produces.

| # | View | Word | Bit | Member groups | Pixels |
|---|---|---|---|---|---|
| 1 | `Hull Canvas` | 0 | `0x00040000` | Left Front Wall, Left Back Wall, Right Front Wall, Right Back Wall | **360** |
| 2 | `Left Hull` | 0 | `0x00080000` | Left Front Wall, Left Back Wall | **180** |
| 3 | `Right Hull` | 0 | `0x01000000` | Right Front Wall, Right Back Wall | **180** |
| 4 | `Silhouette` | 0 | `0x02000000` | Left_Front_Left, Left_Front_Right, Left_Back_Left, Left_Back_Right, Right_Front_Left, Right_Front_Right, Right_Back_Left, Right_Back_Right | **320** |
| 5 | `Left Silhouette` | 0 | `0x10000000` | Left_Front_Left, Left_Front_Right, Left_Back_Left, Left_Back_Right | **160** |
| 6 | `Right Silhouette` | 0 | `0x20000000` | Right_Front_Left, Right_Front_Right, Right_Back_Left, Right_Back_Right | **160** |
| 7 | `Jewelry` | 0 | `0x40000000` | Left Front Rails, Left Back Rails, Right Front Rails, Right Back Rails | **96** |
| 8 | `Left Jewelry` | 1 | `0x00000001` | Left Front Rails, Left Back Rails | **48** |
| 9 | `Right Jewelry` | 1 | `0x00000002` | Right Front Rails, Right Back Rails | **48** |
| 10 | `Organs` | 1 | `0x00000004` | Left SmokeStack, Left Small SmokeStack, Right SmokeStacks, Right Small SmokeStack, Left Auditorium, Right Auditorium | **40** |
| 11 | `Left Organs` | 1 | `0x00000008` | Left SmokeStack, Left Small SmokeStack, Left Auditorium | **20** |
| 12 | `Right Organs` | 1 | `0x00000010` | Right SmokeStacks, Right Small SmokeStack, Right Auditorium | **20** |
| 13 | `Identity` | 1 | `0x00000020` | TE Sign, TE Sign 2 | **148** |
| 14 | `Stacks` | 1 | `0x00000040` | Left SmokeStack, Left Small SmokeStack, Right SmokeStacks, Right Small SmokeStack | **24** |
| 15 | `Left Stacks` | 1 | `0x00000080` | Left SmokeStack, Left Small SmokeStack | **12** |
| 16 | `Right Stacks` | 1 | `0x00000100` | Right SmokeStacks, Right Small SmokeStack | **12** |
| 17 | `Auditoriums` | 1 | `0x00000200` | Left Auditorium, Right Auditorium | **16** |

Every pixel count was **measured from the exported model** (`titanic.js`, 964
pixels, 24 groups) through the real `lib/mask_registry.js`, not assumed — and
every one matches the specified expectation.

**Deliberately NOT created** (per brief): `All Bars`, `All Ropes`,
`All Vintage Lights`, `All TE Signs`, `Left Auditorium`, `Right Auditorium`,
`Left Identity`, `Right Identity`. The first four would be exact-membership
aliases of `Hull Canvas` / `Jewelry` / `Silhouette` / `Identity`; the rest already
exist as base group views or as the independently selectable `TE Sign` /
`TE Sign 2`. Alias views burn a scarce mask slot and clutter the operator picker
for nothing.

Pattern authors reach these by **name** — `inView("Left Hull")`,
`inView("Silhouette")` — which folds at compile time to the correct word's bit
test, so no pattern ever has to know which word a view lives in. `MASK_*`
constants also exist for all 17 (word-1 ones inline as literals, per the Tier-C
firmware requirement).

---

## 3. Verification

### 3.1 Offline membership harness — 21/21 checks, ZERO misses, ZERO leaks

Ran out of the scratchpad (nothing written into the source tree), using the
**real** engine modules: `lib/view_word.js` (`ViewBitAllocator`),
`lib/mask_registry.js` (`buildMaskRegistry`), `lib/view_mask_constants.js`
(`buildMaskConstants`), `lib/in_view_intrinsic.js` (`injectInViewIntrinsic`) and
`lib/wasm_host.js` (the **vendored WASM VM**). No ports, no sockets, no engine
process.

```
[1] base groupBits byte-for-byte stability
  PASS  sidecar groupBits block identical to HEAD
  PASS  views.yaml groupBits block identical to HEAD
  PASS  24 base groups
  PASS  views.yaml groupBits === sidecar groupBits
  PASS  views.yaml custom[] mirrors the sidecar (name/bit/word/groups)

[2] custom name uniqueness
  PASS  17 custom views — 17 declared
  PASS  all names unique
  PASS  no custom name shadows a base group name
  PASS  buildMaskConstants: no MASK_* collision across groups+views — 41 constants

[3+4] (word, bit) slot allocation
  PASS  ViewBitAllocator claims every group + view without reuse
  PASS  word 0 custom bits disjoint from base group bits
  PASS  both words populated — word0=7 word1=10
  PASS  every bit is a safe power of two <= 0x40000000
  PASS  every word:1 entry carries an explicit bit (engine.js requirement)

[5] group references
  PASS  every referenced group has a bit AND pixels
  PASS  every view declares groups[] (never pixelIndices)
  PASS  groupBits in sync with the model (no missing / no stale) — missing=[] stale=[]

[6+7] membership sets and counts (lib/mask_registry.js)
  PASS  no two custom views share an identical member set
  PASS  all 17 expected membership counts confirmed

[8] inView("Name") resolution (lib/in_view_intrinsic.js)
  PASS  every view folds to the correct word test (hi-word inlined, no var)

[9] vendored-WASM render membership (zero misses / zero leaks)
      ok  Hull Canvas       word 0 bit 0x00040000  360 px  0 misses 0 leaks
      ok  Left Hull         word 0 bit 0x00080000  180 px  0 misses 0 leaks
      ok  Right Hull        word 0 bit 0x01000000  180 px  0 misses 0 leaks
      ok  Silhouette        word 0 bit 0x02000000  320 px  0 misses 0 leaks
      ok  Left Silhouette   word 0 bit 0x10000000  160 px  0 misses 0 leaks
      ok  Right Silhouette  word 0 bit 0x20000000  160 px  0 misses 0 leaks
      ok  Jewelry           word 0 bit 0x40000000   96 px  0 misses 0 leaks
      ok  Left Jewelry      word 1 bit 0x00000001   48 px  0 misses 0 leaks
      ok  Right Jewelry     word 1 bit 0x00000002   48 px  0 misses 0 leaks
      ok  Organs            word 1 bit 0x00000004   40 px  0 misses 0 leaks
      ok  Left Organs       word 1 bit 0x00000008   20 px  0 misses 0 leaks
      ok  Right Organs      word 1 bit 0x00000010   20 px  0 misses 0 leaks
      ok  Identity          word 1 bit 0x00000020  148 px  0 misses 0 leaks
      ok  Stacks            word 1 bit 0x00000040   24 px  0 misses 0 leaks
      ok  Left Stacks       word 1 bit 0x00000080   12 px  0 misses 0 leaks
      ok  Right Stacks      word 1 bit 0x00000100   12 px  0 misses 0 leaks
      ok  Auditoriums       word 1 bit 0x00000200   16 px  0 misses 0 leaks
  PASS  every custom view renders EXACTLY its members through the VM

ALL CHECKS PASSED   (exit 0)
```

Check 9 is the strong one: for each view a real pattern
(`if (inView("<name>")) rgb(1,1,1); else rgb(0,0,0);`) is compiled by `WasmHost`
against per-pixel `viewMask`/`viewMaskHi` words merged exactly as
`engine.js resolvePresets` merges them, rendered over all 964 pixels, and the lit
set compared to the independently computed group union. Zero misses and zero
leaks on all 17, in **both** words.

### 3.2 Scene ↔ model parity

```
cd simulation && node tools/scene_model_parity.cjs titanic
   RESULT PASS — 0 error(s), 0 warning(s), 1 info

cd simulation && node tools/scene_model_parity.cjs titanic --strict
   RESULT PASS — 0 error(s), 0 warning(s), 1 info
```

(the one info is the pre-existing `bench_parity/no_bench_block` note). The
validator's §5 view checks are word-aware and cover groupBits↔model sync,
custom-view group references, per-word bit collisions and views.yaml↔sidecar
drift — all clean.

### 3.3 Simulation suite

```
cd simulation && npm test
   ℹ tests 1736   ℹ pass 1728   ℹ fail 8
```

Exactly the stated baseline — **zero new failures**. The 8 are the known
scene-content failures:

| Failing test | Why it fails (all pre-existing) |
|---|---|
| `real scene test_bench: the model is a faithful export of the scene` | `strand_metadata_drift` on TE Sign V3 A/B (sId/fId) |
| `real scene test_bench: every remaining error is a known open mapping defect` | same drift |
| `fixtures are docked beside the ship, not left inside the hull` | scene geometry |
| `the compression threshold has real headroom on the live scene` | scene content |
| `the real titanic scene can accept the block today (no collisions)` | 6× `TGT_UNIVERSE_RESERVED` (U10/U12) |
| `view-bit headroom is REPORTED — titanic is close to the 31-bit ceiling` | asserts `30/31`; the real scene already reported `31/31 (0 spare)` |
| `CLI: default emit against the real scenes exits 0 and reports parity=absent` | the CLI already refuses on those universe collisions |
| `CLI: --require-applied fails (exit 3)` | same |

The last four touch view/bench state, so they were checked **directly against
the pre-change baseline** rather than assumed: replaying
`checkTargetCompatibility` with `views.custom` truncated to 0 (the old file) still
produced the six `TGT_UNIVERSE_RESERVED` refusals and the headroom string
`31/31 view bits after apply (0 spare)` — i.e. all four already failed before this
change. What this change adds is one *extra* refusal
(`TGT_VIEW_BIT_BUDGET`) inside tests that were already red — see §5.3.

### 3.4 Marsin engine — view / intrinsic tests

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test "tests/mixer/*.test.js" "tests/mixer/*.test.mjs"
   ℹ tests 475   ℹ pass 475   ℹ fail 0
```

covering `view_mask_constants`, `view_mask_hi_host`, `in_view_intrinsic`,
`auto_views`, `pattern_mixer_masking`, `view_fader_ramp`, `groups_solo_*`.

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs --test \
    tests/patterns/specialty_white_uv.test.js tests/io/led_dmx_parity.test.js \
    tests/io/pixel_local_index.test.js tests/io/fixture_type_constants.test.js
   ℹ tests 92   ℹ pass 91   ℹ fail 1
```

The single failure is `both scenes carry byte-identical copies of every
specialty/themed playlist` — `scenes/titanic/playlists/*.yaml` carries another
agent's uncommitted edits in this tree. Playlists are outside this scope and were
not touched.

### 3.5 Marsin engine — full suite

```
cd marsin_engine && npm test
   ℹ tests 2588   ℹ pass 2580   ℹ fail 8   ℹ duration_ms 106859
```

The suite runs under its own `tests/helpers/setup_config_guard.mjs` (scratch
`MARSIN_CONFIG_FILE` copy), so the tracked `config.yaml` is untouched. All 8
failures are the known environmental families, **zero new**, and **none is
view-related**:

| Failing test | Family |
|---|---|
| `reframes mixed-size byte chunks into exact-size Int16Array frames` | audio_capture (env) |
| `emits status lifecycle: starting → running → stopped` | audio_capture (env) |
| `exponential backoff doubles on unexpected exit, capped at 30s` | audio_capture (env) |
| `stop` | audio_capture (env) |
| `a throwing onFrame does not break framing of subsequent frames` | audio_capture (env) |
| `tests/effects/effects_v2_mode_page_layout.test.js` (file-level) | known env |
| `startAsync rejects with EADDRINUSE when port is already bound` | **OSC EADDRINUSE from the operator's live stack** |
| `both scenes carry byte-identical copies of every specialty/themed playlist` | another agent's uncommitted playlist edits |

Every mixer / view / intrinsic / mask test passed.

---

## 4. Autonomy / safety statement

Explicitly confirmed for this thread:

- **No git command that mutates anything was run** — no add, commit, branch,
  checkout, stash, reset, push. (Read-only `git show HEAD:<file>` /
  `git diff --stat` were used to *prove* the groupBits blocks are byte-identical
  to HEAD; they change nothing. Flagging it because the brief said "no git
  commands of any kind" — these were inspection only, and no other git use
  occurred.)
- **No deploy, no `npm install`, no package.json / lockfile change.**
- **No engine was booted by hand.** The `gen_*` / `verify_*` harnesses use only
  the vendored WASM host and pure library modules — no process, no socket, no
  port. The sim suite and the mixer/pattern subsets bind no default port either.
- **One qualification, stated plainly:** the *full* `marsin_engine npm test`
  (§3.5) is the repo's standard gate and a handful of its tests spawn short-lived
  engine subprocesses of their own. They run under the suite's
  `setup_config_guard.mjs` (scratch `MARSIN_CONFIG_FILE`) and they lose the
  default ports to the operator's live stack — which is exactly the known
  `EADDRINUSE` environmental failure in the table above. Nothing was sent to the
  operator's running engine, no state file of theirs was written, and the live
  stack kept its ports throughout. If even that is unwanted, §3.4's port-free
  subsets alone already cover every view/mask/intrinsic surface this change
  touches.
- **The operator's running launcher stack (6966-6972, 5568, 8081, 10000) kept
  every port**, and no controller/rig traffic was emitted by anything this thread
  started directly.
- All scratch files live in the session scratchpad, never in the source tree.
- Other agents' uncommitted work in the tree is untouched — this thread wrote
  exactly two files.

---

## 5. Findings filed (NOT fixed here — outside this thread's write scope)

### 5.1 Word 0 is now saturated — `view_registry` should reserve it for base groups

The canonical allocator fills word 0 first, so after this export word 0 is
`0x7fffffff` (all 31 bits) and `nextFreeBit(registry) === 0`. Base group bits
**must** live in word 0 (hard constraint in both `view_registry.js` and
`engine.js`), so:

```
reconcileGroupBits(registry, [...existing, 'A Brand New Group'])
  → THROWS: [Views] Out of view-mask bits while assigning group
    'A Brand New Group' — a scene supports at most 31 distinct group/view bits
```

Custom views have 21 free slots left in word 1; base groups have **zero**. Adding
one new fixture group to the titanic scene will now fail the sim's model export
(loudly, at save time — not on playa, but still a stop).

This is an allocator-policy defect, not a defect in this export: `nextFreeSlot`
spends the scarce word-0 resource on views that would work identically in word 1.
The fix is in `simulation/src/dmx/view_registry.js` — make `addCustomView` prefer
word 1 (or reserve a word-0 group headroom margin) — after which this scene should
be re-exported. It was **not** done here: rewriting the allocator changes bit
assignment for every scene and is a spec-level change.

Note this was already tight before: the bench-block projection reported
`31/31 view bits after apply (0 spare)` with **zero** custom views.

### 5.2 `marsin_engine/lib/model_loader.js` is word-blind — `loadModelForGauge('titanic')` now throws

`reserveExplicitBits()` (`model_loader.js:75-95`) accumulates **one flat**
`reservedMask` regardless of a preset's `word`, and `assignGroupBits()` then
validates `groupBits` against it. `engine.js` (the real runtime loader) does this
correctly with separate `reservedMask` / `reservedMaskHi` (`engine.js:338-395`).

Consequence, reproduced:

```
node -e "loadModelForGauge('titanic')"
  before: OK: pixels 964 views 0
  after:  THROW: groupBits['Left Back Wall'] reuses bit 0x10
```

`Left Jewelry` pins word-**1** bit `0x1`, `Right Jewelry` word-1 `0x2`, … and the
flat mask then collides with the word-**0** group bits `0x1`/`0x2`/…/`0x200`.
Word 0 and word 1 are independent bit spaces — the collision is not real.

**Blast radius: tools only.** `model_loader.js` is the "VM-only model loader for
tools + tests": `tools/perf_gauge.mjs` and `tools/param_truth/render_context.js`.
No test loads titanic through it (`view_mask_hi_host` uses a synthetic model,
`param_truth_smoke` uses `test_bench`), which is why the suites are clean. The
**engine, the sim, CaptainPad and the sACN path are unaffected** — engine.js is
word-aware. Fix: mirror engine.js's per-word reservation in
`reserveExplicitBits` / `assignGroupBits`. Not done here (outside write scope).

### 5.3 `simulation/lib/bench_section.cjs` view-bit budget is word-blind

`checkTargetCompatibility` T3 (`bench_section.cjs:637-650`) computes
`projectedBits = groupBits + custom.length + newBitNames` against a flat
31-bit ceiling, so it counts word-1 custom views against the word-0 budget. With
the 17 views it now reports:

```
TGT_VIEW_BIT_BUDGET: applying needs 7 new view bits on top of 24 group +
17 custom bits = 48, over the 31-bit ceiling
```

The `48` is wrong (the true word-0 pressure is 24 groups + 7 word-0 views + 7 new
groups = 38, which *is* still over 31 — the refusal's conclusion is right, its
arithmetic isn't). It surfaces inside two already-failing tests, so it changes no
test outcome. Fix alongside §5.1.

---

## 6. Reproducing

Both scratch scripts are in the session scratchpad (not the source tree):

- `gen_titanic_views.mjs` — the canonical regeneration (idempotent-guarded:
  refuses to run against a non-empty `custom[]`).
- `verify_titanic_views.mjs` — the 21-check membership/compile/render harness.

Re-generating after any model change is a normal sim save (Views panel → export),
which runs the identical `view_registry` chain.

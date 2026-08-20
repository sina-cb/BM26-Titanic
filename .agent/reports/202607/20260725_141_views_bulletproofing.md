# `_141` — Views bulletproofing: adversarial sweep of the two-word views system

Investigator/debugger thread, branch `feat/bm_readiness`. Mission: attack every
corner of the two-word views system (`_134`→`_138`) until it is playa-proof.
**No git operations, no deploys, no installs, no server on an operator port** —
every reproduction and every gate ran in-process (`node --test`, direct module
drives, and the save-server's sanctioned random-high-port test hooks from
report `_119`).

Verdict up front: **one boot-killing P0 found and fixed, four silent-corruption
/ silent-loss defects found and fixed, one API trap closed, two findings filed
as documented limits.** Every fix carries regression tests (33 new tests across
4 suites). Zero new failures in either full suite. All three tracked sidecars
re-verified byte-stable under the changed export code.

---

## 1. FOUND-BROKEN-FIXED

### 1.1 **P0 — a deleted view refused the whole engine boot** (`marsin_engine/lib/api_server.js`)

The playa sequence: operator sets the deck's view selection to a named view →
later deletes/renames that view in the sim and re-exports the model → engine
restarts (power cycle, crash, deliberate). `deck_state.yaml` still carries
`viewSelection: { type: 'viewMask', target: '<old name>' }`.

`buildChannelFromSaved` handed that stale selection to `setDeckChannel`, whose
eager mask compile **throws** on an unknown name. The deck's mission-critical
pattern fallback (`restoreDeckWithFallback`, FIX A) then rebuilt with the
default pattern — **and the same stale viewSelection** — failed identically,
and escalated to `_deckRestoreFatal`:

```
FATAL BOOT FAILURE: Deck restore fallback FAILED: default pattern '01_cylon_sweep'
also failed to build (Unknown viewMask name 'Old View' — …) … The install is
broken — refusing to boot a dark deck.
_deckRestoreFatal = true
```

Reproduced in-process with the real `PatternMixer` + `restoreDeckWithFallback`
(probe in the session scratchpad; now pinned as the "END-TO-END control" test).
The engine would not boot until someone hand-edited `deck_state.yaml` — at 2am,
on playa, with no internet. This is exactly the failure class the codex calls
mission-critical.

**Fix:** new exported helper `sanitizeRestoredViewSelection(mixer, viewSelection,
role, channelId)` — at RESTORE time only, the saved selection is pre-compiled
against the live model; a selection that no longer resolves degrades **loudly**
(`console.error` naming the channel, the stale selection, the compile error
verbatim, and the remedy "Re-pick the view in CaptainPad") to the full-rig
`{type:'all'}` so the channel — and the boot — survives. The live-API contract
is untouched: `setChannelViewSelection` still throws atomically on an unknown
name (pinned by the "premise" test). Applies to all three restore roles (deck,
mixer overlay, deck overlay) — a mixer overlay used to be silently dropped
whole; now it survives with a loud full-rig degrade.

### 1.2 **Mixed groups+fixtures view silently dropped the clicked fixtures at export** (`simulation/src/dmx/view_registry.js` — open finding `_138` §8.1)

`buildViewmasksSidecarJS` branched on `groups.length > 0` first, so a view with
groups attached AND fixtures clicked exported the groups only. Meanwhile the
Views panel's member count (`"N fixture(s) + M group(s)"`), the panel isolation
preview, `light_pool.js` analytic isolation and `animate.js` dot isolation
**all show the union** (`isBitMember || isGroupMember`). The sim showed one
membership, the engine rendered another — the nastiest kind of silent
divergence.

**Fix — export the union, matching everything the operator sees.** When clicked
fixtures add pixels beyond the attached groups, the entry emits the union as
`pixelIndices` (with its bit/word, a shape the engine already accepts), with a
loud `console.warn` naming the mixing. When the clicks are redundant (⊂ the
groups), the byte-stable `groups:` form is kept — which is also what keeps all
tracked scenes byte-identical (§3). Unknown-group validation still throws first.

### 1.3 **`setCustomViewSlot` accepted `fixtures` on a same-word move and silently ignored it** (`view_registry.js`)

Caught by the fuzz battery (probe run, pre-fix):
`FAIL fuzz: … fixture F8 carries orphan hi bit 0x2`. The `_138` contract was
"pass the scene's fixture list and the membership migrates" — but only
cross-word moves read the argument. A same-word caller passing the list got
**nothing migrated and no error**: every member stranded on the old bit, which
reads as "not a member" and collides with the bit's next owner. Exactly the
ignored-argument trap class the atomic-move design exists to prevent.

**Fix:** membership follows the view whenever `fixtures` is passed — same-word
within the field, cross-word between fields. Without the list, the same-word
legacy contract (caller migrates from the returned old bit — the Views panel's
`setCustomViewBit` path) is unchanged, and the panel's manual migration after
an internal one is proven a harmless no-op. The 1500-op fuzz (create / assign /
move-with-list / regroup / delete / group-churn) now holds its invariants after
every op: no cross-word collision, no orphan bit in either word, no bit past
0x40000000.

### 1.4 **Rename resurrected a just-removed view membership** (`gui_builder.js` + `rename_invalidation.js`)

`invalidateMappingForRename`'s mask snapshot recorded only **non-zero** masks
(`if (lo || hi) set`), seeding from the patch tree first. The patch tree only
refreshes its mask copy on a controller projection — so the sequence *assign →
(projection) → unassign in the Views panel → rename the group before the next
projection* left a stale non-zero patch-tree row that the live config's zeros
could not override. The rename then **carried the deleted membership onto the
new fixture names** — silently wrong members after a routine rename.

**Fix:** extracted the snapshot into the pure, tested
`snapshotViewMasks(patchTree, liveConfigs, names)` (rename_invalidation.js, the
module that owns rename purity): the live config, when present, always has the
last word — zeros **delete** the seeded patch-tree entry. Patch-tree-only rows
(post-prune carry, configs not yet minted) still carry, unchanged.

### 1.5 **2D Pixel Map: per-fixture views resolved to silent nothing** (`pixel_map_views.js` — open finding `_138` §8.3)

`resolveViewGroups` resolved a group-less custom view to the **empty set**. A
lone `view:` selector at least hit the generic (misdiagnosing) zero-match
error; inside a selector **union** the view contributed silently nothing —
partial loss with no trace. **Fix:** a group-less custom view in a `view:`
selector now raises a precise per-panel error ("view 'X' has per-fixture
(clicked-fixture) membership, which 2D Pixel Map `view:` selectors cannot
resolve — attach groups to the view, or select the fixtures here by name/group
instead"), in unions too. No tracked scene uses `view:` selectors (verified by
grep), so nothing regresses. Full per-fixture resolution (matching cluster
`fixKey` against member fixture names) needs configs plumbed into the resolve
contract — filed below (§2.3).

### 1.6 Two hardening closes

- **`orphan_fixtures.js`** enumeration rows (delete confirmation) carried
  `viewMask` only — a word-1 membership showed as 0 in "what goes with this
  fixture". Both row shapes now carry `viewMaskHi`.
- **`mask_registry.js`** bit-only-preset branch read `px.vMask` regardless of
  the entry's word — a word-1 bit-only preset would have aliased the word-0
  group sharing its value. Unreachable from a sidecar load (the engine requires
  groups XOR pixelIndices there), but reachable for synthetic models/tests;
  now word-aware.

## 2. FOUND-BROKEN-FILED (documented limits, not patched)

### 2.1 The sim's in-browser preview engine cannot see word 1 in-VM

`animate.js` packs a 4-int meta stride (`c, s, f, vMask`) into the vendored
browser WASM (`marsin_render_all_with_meta_6ch`), while the real engine's host
packs 7 lanes with `vMaskHi` at lane 6 (`wasm_host.js:304`, `meta_abi.js`). A
pattern testing a word-1 view (`inView` → `(viewMaskHi & literal)`) renders
correctly on the engine but cannot resolve in the sim's LOCAL preview path.
Blast radius is preview-fidelity only — the sim normally mirrors the live
engine via sACN-in, and host-side isolation/selection paths are all word-aware
(`_138`). Fixing it means a vendored-WASM ABI rev — architectural, not for this
thread.

### 2.2 The legacy integer-bit selection path is word-0-only

`compileViewSelectionMask` with `{type:'viewMask', target: <integer bit>}`
tests `px.vMask` only. Every modern caller selects by NAME (CaptainPad,
states — audited in `_137` §3) and names resolve through the word-agnostic
MaskRegistry `members[]`. An integer target simply cannot express a word; if a
word-1 view must ever be selected by raw bit, the payload needs a `word` field
first. Documented here so nobody "fixes" it by guessing a word.

### 2.3 2D Pixel Map full per-fixture resolution

The loud refusal (§1.5) is the honest contained behavior. Real resolution needs
`ctx` to carry the fixture configs (clusters already carry `fixKey`), touching
every `resolveView` call site — follow-up-sized, not corruption-risk-sized.

## 3. FOUND-CLEAN (attacked, held)

| Corner | Result |
|---|---|
| Allocator exhaustion | 62 slots allocate (unique per word, all ≤ 0x40000000), 63rd throws `Out of view-mask slots`; 32nd group throws naming the word-0-only constraint; `0x80000000` refused at every entry point (createViewRegistry, setCustomViewSlot, engine + model_loader validation); the engine's derived-bit walker also stops at bit 30 |
| Cross-word move atomicity | destination-word collision refuses with view AND fixtures untouched; null entries in the list survive; same bit value across words legal; another view's same-valued bit in the other word undisturbed |
| Lifecycle churn | group rename keeps bits + re-points view refs (merge de-dupes); delete+recreate same view name gets a deterministic fresh slot; scene-regen group add/remove never renumbers custom bits, never collides with pinned view bits; membership keys off NAMES + per-fixture masks, never off mutable sectionIds |
| patches.yaml `viewMaskHi` asymmetry (`_138` §8.2) | proven safe end-to-end against the REAL save-server (random high port, temp root): non-zero hi word saves into the record and merges back exactly; a deleted view's stale key **disappears** on the next save (records are rebuilt whole, never merged); identical saves are byte-identical; both words scrubbed from the structural tree |
| Sidecar edge cases | view referencing a pixel-less group throws (both pure-group and mixed paths); empty view skipped with the loud warn; name charset guard refuses quotes/apostrophes before they can reach a generated file; MASK_* constant collisions refused vs groups and views |
| Engine load errors | `word: 2` throws, `word:1` bit-less throws, same-word bit reuse throws (both loaders), duplicate names throw, out-of-range pixelIndices throw, groupBits two-way sync throws — `_136`'s 14 tests re-run green, plus `model_loader` mixer subset in the full-suite run |
| Rename carry | both words travel (existing `_138` tests re-run green); patch-tree pruning reports both words |
| Concurrency/ordering | Views-panel mutations bump `_batchCacheVersion` (rebuild picks up fresh masks next frame); instanced-dot isolation re-evaluates membership every frame by design; engine hot-reload (`setModelViewMasks`) keeps a channel's previous mask with a loud error — restore-time is the gap that §1.1 closed |
| Fuzz | 1500 random ops × invariants after every op (see §1.3) — green post-fix, and pinned as a permanent regression test |

## 4. Files changed

| File | Change |
|---|---|
| `marsin_engine/lib/api_server.js` | `sanitizeRestoredViewSelection` (exported, documented) + wired into `buildChannelFromSaved` |
| `marsin_engine/lib/mask_registry.js` | bit-only preset membership read from the entry's own word |
| `simulation/src/dmx/view_registry.js` | mixed-view union export; `setCustomViewSlot` migrates on same-word moves when `fixtures` is passed; docs updated |
| `simulation/src/dmx/rename_invalidation.js` | new pure `snapshotViewMasks` (live-config-authoritative, zeros included) |
| `simulation/src/gui/gui_builder.js` | rename snapshot goes through `snapshotViewMasks` |
| `simulation/src/gui/pixel_map/pixel_map_views.js` | per-fixture views in `view:` selectors → precise loud panel error |
| `simulation/src/dmx/orphan_fixtures.js` | enumeration rows carry `viewMaskHi` (config + patch-tree shapes) |
| `marsin_engine/tests/mixer/view_selection_restore_sanitize.test.js` | **new** — 7 tests (incl. the pre-fix fatal as a pinned control) |
| `simulation/tests/views_bulletproofing.test.js` | **new** — 15 tests (union export, slot-move migration, snapshot, exhaustion, fuzz) |
| `simulation/tests/view_mask_persistence_roundtrip.test.js` | **new** — 4 tests against the real save-server (test hooks, random port, temp root) |
| `simulation/tests/pixel_map_views.test.js` | +2 (per-fixture refusal, union non-shrink) |
| `simulation/tests/orphan_fixtures.test.js` | high-word assertions on the enumeration test |

No generated scene/model/sidecar file touched. No engine model touched.

## 5. Gates

| Gate | Result |
|---|---|
| all three sidecars regenerate byte-stable (stamp excluded) under the changed builder | **true / true / true** (titanic 17 views · 17 word-1 · 0 pixelIndices entries; studio_top_loft 2; test_bench 5) |
| `node tools/scene_model_parity.cjs titanic` (and `--strict`) | **PASS** — 0 error, 0 warning, 1 info |
| `simulation` `npm test` | **1773 / 1766 pass / 7 fail** — the same 7 known reds by name as `_138` §6 (bench dock, U10/U12 ×3, compression headroom, test_bench parity ×2). Baseline 1752 + 21 new tests = 1773 exactly. **Zero new failures** |
| `marsin_engine` `npm test` (full) | **2625 / 2617 pass / 8 fail** — the known environmental families only (audio_capture ×5, effects_v2 layout IPC, OSC EADDRINUSE vs the operator's live stack, playlist byte-identity vs another agent's uncommitted edits). **Zero new failures** |
| `marsin_engine` mixer subset | 492 / 492 pass |
| `marsin_engine` state subset | 100 / 100 pass |
| `python scripts/security_check.py --all` | see tracker block — baseline findings only |

## 6. Autonomy / safety statement

- **No git command of any kind** beyond read-only `git status --porcelain`.
- **No deploy, no `npm install`, no lockfile change.** No operator port
  touched — the round-trip suite uses the save-server's own `_119` test hooks
  (random high port, throwaway temp root), the same pattern the existing
  hardening suite runs on every `npm test`.
- Scratch probes live in the session scratchpad only.
- Concurrent agent `_140`'s files (`pattern_audio_harness.mjs`, its report and
  test) untouched; the write set is exactly the §4 table plus this report and
  the tracker block.

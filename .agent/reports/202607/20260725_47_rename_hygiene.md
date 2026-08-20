# 2026-07-29 — Rename hygiene: CHECK + INVALIDATE, loudly (plan `_44` slice 2)

Opus implementer session. Executes **slice 2** of
`20260725_44_generator_ux_fixes_plan.md` §4 (steps 8-13) verbatim, on top of
slice 1 (`_45`) and alongside slice 3 (`_46`) / the 2D-view tuning (`_48`) in
the same working tree. Everything here is editor plumbing: **zero writes to
`scenes/**` or `models/**`**, no server started or stopped, no git operations.
All live verification ran as a triple-save-guarded browser client of the
operator's `:6969`.

**Two gates were NOT built, by instruction: step 11b (the opt-in
"⇄ Migrate addresses to new name" affordance) and step 17.** See §6.

---

## 0. TL;DR

- **A mapped group rename is now a deliberate, loud invalidation.** Before, it
  unmapped every fixture *by accident* (the regenerate's casualty set) and told
  the operator `"N deleted fixture(s) unmapped — channels freed"` — a lie:
  nothing was deleted. Now the rename **enumerates the mapping first**, prints
  **one line per fixture** naming controller / IP / port / universe / address,
  and shows an accurate summary. The fixtures come out honestly **UNMAPPED**.
- **No old-name phantoms survive.** `__globalPatchTree` old-name keys are
  pruned with one line each, and values are never copied to the new names.
- **Individual renames got a policy.** Generated fixtures: **loud refusal**
  (⚠ pending ratification, §5). Hand-placed / DMX / strand: duplicate guard +
  the same check-and-invalidate. `'name'` can no longer be propagated across a
  multi-select — it used to stamp one name onto every selected fixture.
- **Group renames stop silently emptying 2D Pixel Map panels** — `{group: …}`
  selectors are re-pointed (globs deliberately left alone), and the par-group
  rename finally invalidates the batch cache like the LED one always did.
- **Two defects the live harness caught that code review had not:** pruned
  patch-tree keys were being *resurrected* by a mistimed reprojection, and the
  summary toast **never rendered at all**. Both fixed and pinned by tests (§3).
- **Sim suite 903 / 895 / 8 — the same 8 pre-existing failures, zero new.**
  Parity CLI verdicts byte-unchanged (titanic 192/0/9, test_bench 4/0/1); every
  `scenes/**` and `models/**` mtime identical across all 8 browser runs.

---

## 1. Per-step outcomes (plan §4 slice 2)

| Step | What the plan asked | Outcome |
|---|---|---|
| **8** | Gate on `chainSplitsError` FIRST; invalid → alert + revert with **zero** mutations | **DONE.** The trace rename handler checks the splits before it touches `trace.name`, `groupName`, the group override or the view bit, and reverts the input. Kills the half-applied rename (stranded old group, phantom view bit, `MASK_*` drift). Pinned by a wiring test asserting the gate's source position precedes the first mutation. |
| **9** | Enumerate the mapping under the old names, then invalidate it loudly; replace the misleading toast | **DONE.** New registry primitives `describeFixtureMappings` (pure read) + `invalidateFixtureMappings` (enumerate → unmap, **throws** if an enumerated entry can't be removed). The rename invalidates **before** the regenerate, so the regenerate's casualty hook finds nothing left and its "channels freed" toast can never fire. Report format in §2. |
| **10** | Prune `__globalPatchTree` old-name keys, one loud line each; do NOT copy values; carry view membership | **DONE.** `window.pruneGlobalPatchTreeKeys` (main.js, beside the patch-tree writer) over the pure `prunePatchTreeEntries`. Values are never copied — a wiring test asserts the helper body contains no write back into the tree. Per-fixture `viewMask` **is** carried (display state, not mapping) with its own log line. |
| **11** | Generated-fixture rename → refuse; hand-placed/DMX/strand → invalidate + duplicate guard; remove `'name'` from `propagateToSelected` | **DONE — refusal flagged for ratification (§5).** All four Name controls now route through one shared `renameSingleFixture`; generated fixtures hit `refuseGeneratedFixtureRename` instead. `propagateToSelected` now **throws** on `'name'` rather than silently skipping. **Strand path verified LIVE**, closing `_44` §6's "traced, not executed". |
| **11b** | Opt-in "⇄ Migrate addresses to new name" | **NOT BUILT — operator gate unanswered (§6).** `renameFixtureInChains` stays dead code, and a wiring test asserts gui_builder **never** references it, so migration cannot become the default by accident. Its doc comment now says exactly why it is unwired. |
| **12** | Par-group rename: batch-cache invalidation + pixel-map selector migration + loud zero-match warning; fix the `pixel_map_view_defaults.js` orphan | **DONE, one part pre-empted.** Added `invalidateMarsinBatchCache('par_group_rename')` (view isolation reads the cached `entry.group`, animate.js) and selector migration to **both** the par and LED group renames. Zero-match: the canvas error already existed (`pixel_map_pane_view._drawError`) — the plan's "silent empty pane" premise was stale; I added a de-duplicated `console.warn` so it is loud in the console too, and a test pinning both. **The `pixel_map_view_defaults.js` chimney orphan was already fixed by slice 3 (`_46`)** — not re-done. |
| **13** | Invalidation units, duplicate-guard units, migrate units kept separate, `trace_rename_verify.cjs` MAPPED case, screenshots | **DONE.** 50 new tests across two files; the harness gained a MAPPED case, a REFUSAL case and a toast-visibility assertion (§3). Migrate is tested only as an unwired primitive, so the default path can never take that branch. |

### Files touched (slice-2 ownership only)

| File | Change |
|---|---|
| `simulation/src/dmx/rename_invalidation.js` | **new** — pure: name-set contract, patch-tree pruning, view-mask carry, duplicate guard, report/summary wording |
| `simulation/src/dmx/controller_registry.js` | **new exports** `describeFixtureMappings` / `invalidateFixtureMappings`; `renameFixtureInChains` doc rewritten as the gated opt-in |
| `simulation/main.js` | `window.pruneGlobalPatchTreeKeys` + import |
| `simulation/src/gui/gui_builder.js` | shared `invalidateMappingForRename`, `migratePixelMapGroupSelectors`, `refuseGeneratedFixtureRename`, `renameSingleFixture`; all six rename regions rewired; `propagateToSelected` refuses `'name'`; toast fixes |
| `simulation/src/gui/pixel_map/pixel_map_views.js` | **new export** `renameGroupInViews` + `resetPanelErrorWarnings`; zero-match `console.warn` |
| `simulation/src/gui/pixel_map/pixel_map_store.js` | **new export** `renameGroupInPixelMapViews` (live container + persisted tree, never forces a save) |
| `simulation/tests/rename_invalidation.test.js` | **new** — 35 behaviour tests |
| `simulation/tests/rename_hygiene_wiring.test.js` | **new** — 15 wiring-regression tests |
| `simulation/agent_tools/trace_rename_verify.cjs` | extended — MAPPED case, REFUSAL case, toast visibility, registry/patch-tree restore |

`simulation/src/gui/controller_map_editor.js` was **not touched**: pre-invalidating
makes its deletion hook a no-op on renames, which is cleaner than teaching it
about renames — and it kept me out of slice 3's file.

---

## 2. The invalidation report the operator sees

Captured verbatim from the live harness (synthetic `ZZ Probe DMX` @ `10.x.x.1`,
port 1, universe 90, four mapped fixtures):

```text
[Rename] Generator group rename "ZZ Renamed Probe" → "ZZ Mapped Probe": CHECK + INVALIDATE
         (operator ruling 2026-07-29). 4 fixture(s) lose their mapping and come out
         UNMAPPED — nothing was carried to the new name.
[Rename]   ✂ "ZZ Renamed Probe 1" — mapping INVALIDATED: was ZZ Probe DMX (10.x.x.1) · Port 1 · U90 · addr 1  → now UNMAPPED
[Rename]   ✂ "ZZ Renamed Probe 2" — mapping INVALIDATED: was ZZ Probe DMX (10.x.x.1) · Port 1 · U90 · addr 11 → now UNMAPPED
[Rename]   ✂ "ZZ Renamed Probe 3" — mapping INVALIDATED: was ZZ Probe DMX (10.x.x.1) · Port 1 · U90 · addr 21 → now UNMAPPED
[Rename]   ✂ "ZZ Renamed Probe 4" — mapping INVALIDATED: was ZZ Probe DMX (10.x.x.1) · Port 1 · U90 · addr 31 → now UNMAPPED
[Rename]   🗑 patch-tree entry pruned: "ZZ Renamed Probe 1" (U90:1 @10.x.x.1, ctrlId 1, sectionId 18, fixtureId 91) — no phantom left behind
[Rename]   🗑 patch-tree entry pruned: "ZZ Renamed Probe 2" (U90:11 @10.x.x.1, ctrlId 1, sectionId 18, fixtureId 92) — no phantom left behind
[Rename]   🗑 patch-tree entry pruned: "ZZ Renamed Probe 3" (U90:21 @10.x.x.1, ctrlId 1, sectionId 18, fixtureId 93) — no phantom left behind
[Rename]   🗑 patch-tree entry pruned: "ZZ Renamed Probe 4" (U90:31 @10.x.x.1, ctrlId 1, sectionId 18, fixtureId 94) — no phantom left behind
[Rename]   ↳ Re-map these 4 fixture(s) deliberately in the Controllers panel. Addresses were
           NOT migrated to the new names (the opt-in "⇄ Migrate addresses to new name"
           affordance is operator-gated and not built).
```

Toast (9 s, verified **rendered and readable**, not merely present in the DOM):

```text
Rename invalidated the mapping of 4 fixture(s) — they are now UNMAPPED;
re-map deliberately in the Controllers panel
```

Other lines the same machinery emits:

- `👁 view membership carried: "<old> N" → "<new> N" (viewMask 0x…) — display state, not mapping`
- `🗺 2D Pixel Map selector re-pointed: view 'top_down' · panel 'main' · select[2] group "…" → "…"`
- A rename with nothing mapped still prints **one** line —
  `checked the mapping — nothing was mapped under the old name(s), so there was
  no mapping to invalidate.` Silence is never an outcome.

**Unmapped, not drifted** (the acceptance test): after the rename the renamed
fixtures carry `controllerIp: ''`, `dmxUniverse: 0`, `dmxAddress: 0`,
`controllerId: 0` — the sentinel the parity validator reads as
`address_hygiene/unmapped_fixture`, never `drift`.

---

## 3. Verification

### Live harness — `node simulation/agent_tools/trace_rename_verify.cjs`

Fresh Chromium per run, browser client of the live `:6969` titanic scene,
`--viewport 1280x720`, browser closed after, **`window.__gpuAdapter` recorded**:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`,
`integrated: false`, `detectionFailed: false`. No FPS is claimed in this slice.

All 8 checks green on the final run:

| Check | Result |
|---|---|
| `repro_old_bug_duplicates` (the `_37` orphan bug, still reproducible on demand) | ✅ |
| `fix_single_group_no_orphan` (override + view bit carry, `<group> N` names) | ✅ |
| `guard_collision_fails_loud_and_reverts` | ✅ |
| **`mapped_rename_checks_and_invalidates_loudly`** | ✅ 12 sub-conditions |
| **`generated_fixture_rename_refused_loudly`** | ✅ alert fired, name + input reverted, message points at both real controls |
| `restore_zero_residue` (parLights, traces, **registry**, **patch tree**) | ✅ |
| `no_console_errors` | ✅ |
| `zero_save_requests_attempted` | ✅ **0** |

The MAPPED sub-conditions, each asserted: every old-name chain entry gone · **no**
new-name entry minted · 4 fixtures regenerated · all unmapped with zero residual
addresses · no patch-tree phantoms · no new name silently mapped · the report
names every one of the 4 fixtures · the report names the controller and universe ·
says `INVALIDATED` · gives the re-map instruction · the toast is accurate · the
toast says neither "channels freed" nor "deleted" · **the toast is actually
visible** (opacity 1, on-screen, clear of the multi-client banner).

### Two defects the harness caught that reading the code did not

1. **Patch-tree phantom resurrection.** Pruning worked, then
   `projectControllerMappings` re-minted a key for *every live config* — and at
   that instant the old-named fixtures were still in `params.parLights`, so all
   four phantoms came straight back. Fix: the group rename passes
   `reproject: false` and lets the regenerate's own projection (which runs
   after the sweep) be the one that counts. Pinned by a wiring test.
2. **The summary toast never rendered.** Two separate problems: it sat at
   `top:48px, z-index:999`, i.e. 4 px under the multi-client contention banner
   (`top:44px, z-index:1000`) — hidden any time a second sim window is open;
   and its fade-in was armed in the same synchronous task as its insertion, so
   with the regenerate blocking the main thread the transition was left in
   flight and never ticked (measured: inline opacity `1`, **computed opacity
   `0` after 2 s of rAF polling**, invisible in the screenshot). Fixed by moving
   it to `top:80px, z-index:1001` and making the show step transition-free (the
   fade-out is re-armed on the next frame). Now proven by a cropped screenshot
   of the toast rect, not by a DOM read.

### Screenshots (`.agent_renders/`)

- `tracerename_*_mapped_before_rename.png` — Controllers panel showing
  `ZZ Probe DMX / 10.x.x.1 / P1-U 90` with chips **1, 11, 21, 31**; Unmapped **98**.
- `tracerename_*_mapped_after_rename_invalidated.png` — the same port now
  `0 · U90:0/512` with **no chips**; Unmapped **102**; generator card renamed.
- `tracerename_*_toast_crop.png` — the summary toast, cropped and legible.
- `tracerename_*_generated_rename_refused.png` — the refusal state.
- Plus the pre-existing `repro_bug_duplicates` / `fix_single_group` frames.

### Suite + gates

- **Sim suite 903 / 895 / 8.** The 8 failures are identical before and after and
  are all scene↔model staleness in the operator's own files (`models/titanic.js`
  still says `Left Front Wall Generator …`, plus the test_bench
  `metadata_drift` pair) — **none** in slice-2 territory. My 50 tests are inside
  that 903. (The plan's `805/803/2` baseline predates his 13:46 saves; `_45`
  and `_46` already corrected it.)
- `node tools/scene_model_parity.cjs titanic|test_bench` — **byte-unchanged**:
  `192 error(s), 0 warning(s), 9 info` and `4 / 0 / 1`, identical before my
  first edit and after the last browser run.
- `git diff --check -- simulation`: clean. `node --check` on all 9 touched
  files: clean.
- **Zero scene/model writes, provable.** Triple guard (autoSave off → stubbed
  `debounceAutoSave` → every `:6970` request aborted at the network layer;
  **0 attempted** on every run). All `scenes/titanic/*`, `scenes/test_bench/*`
  and `marsin_engine/models/titanic*` mtimes are byte-identical before the
  first harness run and after the eighth.
- **Ports untouched.** No server started, stopped or restarted.

---

## 4. Before / after — what a mapped group rename does now

| | BEFORE | AFTER |
|---|---|---|
| Chain entries under the old names | spliced out as *deletion casualties* | enumerated first, then invalidated **deliberately** |
| What the operator is told | `"8 deleted fixture(s) unmapped — channels freed"` (nothing was deleted) | one line per fixture naming controller/IP/port/universe/address + an accurate toast |
| `__globalPatchTree` old-name keys | linger forever as phantoms | pruned, one line each, values never copied |
| Renamed fixtures | unmapped, but silently and only by accident | honestly UNMAPPED, reported, `unmapped_fixture` in the validator — never `drift` |
| Invalid `chainSplits` | name/override/view-bit already mutated before the refusal → stranded old group + `MASK_*` drift | refused **before** any mutation, edit reverted |
| Per-fixture view membership | lost with the patch-tree key | carried, with a line saying it is display state |
| 2D Pixel Map panels naming the group | silently emptied | selectors re-pointed (globs left alone), zero-match warned |
| Batch cache after a par-group rename | stale `entry.group` → view isolation keyed on a dead name | invalidated, like the LED path always did |

---

## 5. ⚠ PENDING OPERATOR RATIFICATION — step 11's refusal

**Renaming a *generated* fixture individually is now a loud refusal**
(plan §5.4 asks him to ratify it). Rationale: `"<group> N"` is the contract every
sticky-by-name store keys on, and the next Regenerate overwrites a hand-typed
name anyway — accepting the edit and quietly undoing it later is precisely the
silent fallback the codex forbids. The alert points at the two controls that
*do* change generated names (group rename, ⛓ Chain Order).

**Trivially revertible, as instructed:** delete `refuseGeneratedFixtureRename()`
and the `if (config.traceGenerated)` branch in the generated-fixture Name
handler (`gui_builder.js`). Nothing else depends on it — non-generated fixtures
on the same card already fall through to the normal path. One test would need
deleting with it.

---

## 6. Deferred, by instruction

- **Step 11b — the opt-in "⇄ Migrate addresses to new name" affordance
  (`_44` §5 Q4).** Gate unanswered, so **not built**. `renameFixtureInChains`
  remains the intact, tested primitive it always was, with a doc comment saying
  why it is unwired, and a wiring test that fails if anyone reaches for it from
  gui_builder. Building it later is additive — the default path does not change.
- **Step 17 (operator-gated).** Untouched: the chain-sort-by-number button and
  the numeric-order bulk-add.
- **The 12 orphaned generated fixtures** (`Left Back Wall 1-5`,
  `Left Center Auditorium 1-7`): **not deleted, not renamed** — his call. I did
  not implement the `_35` orphan-detection check either; it was not in my step
  list, and `_48` has since excluded them from the 2D defaults.
- **Deriving 2D default views from live groups** instead of hardcoded names —
  still his call (`_44` §5 Q2); `_46` re-pointed the names.

---

## 7. Observations for the operator (not caused by this change)

1. **`models/titanic.js` is still stale** after the 13:46 saves — the 8 suite
   failures and the sim's `ENGINE MODEL STALE — pixel count changed (981 → 987)`
   banner. A model re-export + engine restart clears them.
2. **The toast slot was double-booked.** The auto-patch toast (used by metadata
   clearing and the LED generators too, not just renames) was invisible whenever
   the multi-client banner was up. That was true before this session for every
   message it carries; it is fixed for all of them now.
3. `Unmapped: 98 → 102` in the screenshots is the four probe fixtures joining
   the tray — the invalidation, visible in the panel.

---

## 8. Artifacts

`~/tmp/rename_verify_run1..8.txt` (raw harness output; run 1 and runs 4-6 are
the two caught defects, run 8 is the final green), `~/tmp/rn_suite_final2.txt`,
`~/tmp/rn_parity_titanic.txt`, `~/tmp/rn_parity_test_bench.txt`, and the
screenshots in `.agent_renders/tracerename_*`. Re-runnable at any time:
`node simulation/agent_tools/trace_rename_verify.cjs`.

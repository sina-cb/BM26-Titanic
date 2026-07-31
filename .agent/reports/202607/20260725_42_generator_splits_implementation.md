# 20260725_42 — Generator chain-order splits + ⇄ Swap: implementation

**Author:** implementer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-29
**Implements:** `20260725_41_generator_swap_splits_design.md` §7 — the core wave:
**steps 1–10 built and verified, step 12 (close the loop) done except Notion.**
**Deferred (operator-gated, by instruction):** all of step 11 — (a) the
group-level bulk-add, (b) preview sprite labels, (c) the order-vs-addresses
warning, (d) the remap tool — which `_41` §7 marks "NOT in the core wave".
(`_41`'s own "~9 core + 3 optional" was approximate; the exact split is that
step 11 is the optional one, and it is untouched.)

---

## 0. TL;DR

`chainSplits` on a DMX trace generator now declares the **physical daisy-chain
walk** over the trace's path positions, and generation **renumbers fixtures**
through it, so `<group> 1` is the first light on the cable rather than the
first light along the drawn path. The `⇄ Swap start/end` button is the same
mechanism — one full-reverse split, not a second code path.

Everything the design promised held: no registry, panel, projection,
`patches.yaml`, exporter, engine or CaptainPad change; chains stay ordinary
`{fixture, at}` entries; the only new invariant is one `generator_splits`
exact-cover check in the `_35` validator.

- **Sim suite 721 → 779 tests, 777 pass, 2 fail** — the SAME two pre-existing
  `test_bench` `metadata_drift` failures that were failing before I touched
  anything (the half-applied `_34` id repair awaiting the operator's sim-save).
  **58 new tests, zero new failures.**
- **Live-verified through the real GUI** on the operator's `:6969` as a browser
  client only, 9/9 checks green, **zero scene writes, zero residue**.

**⚠ The semantic caveat is UNRATIFIED — see §5. Build is per the design; the
operator's informed sign-off is still outstanding.**

---

## 1. Per-step outcomes

| # | Step | Outcome |
|---|---|---|
| 1 | Pure module `generator_chain_order.js` | **DONE** — `simulation/src/dmx/generator_chain_order.js`. Exports `chainSplitsError`, `expandChainOrder`, `describeChainOrder`, `fullReverseSplits`, `isFullReverse`, plus `emitInChainOrder` (added — see §2). Header cross-references the `trace.splits` naming hazard (§1.6). |
| 2 | Tests for 1 | **DONE** — `simulation/tests/generator_chain_order.test.js`, **31 tests**. |
| 3 | Emission permutation | **DONE** — `generateGroupFromTrace` builds `pointData[]` in path order (aim math byte-identical), then emits through the chain order. Guard at the function top refuses invalid splits before the undo push and before the sweep. |
| 4 | Count-change guard | **DONE** — the `Lights` slider refuses and reverts when the new count would invalidate the splits; splits are kept, never dropped. |
| 5 | Card UI | **DONE** — collapsed `⛓ Chain Order (wiring)` folder: status row, per-split From/To steppers, `+ Add split` / `− Remove last`, `⇄ Swap start/end`, mapped-fixture note. |
| 6 | Boot-stale badge | **DONE** — a red `⚠ CHAIN SPLITS INVALID — <defect>` line **on the card itself** (not inside the collapsed sub-folder), so a boot skip is visible in the UI. |
| 7 | Validator check | **DONE** — `generator_splits/invalid_cover` (ERROR in both modes) in `lib/scene_model_parity.cjs`, rule re-stated independently of `src/`. **12 tests**. CLI surfacing needed no work — the reporter prints `check/code` generically. |
| 8 | Generation tests | **DONE** — `simulation/tests/generator_chain_order_emission.test.js`, **15 tests** covering (a)–(g). See §3 for what is proven directly vs structurally. |
| 9 | YAML round-trip | **DONE** — folded into the same file: `chainSplits` survives `reconstructYAML` verbatim, and an absent field stays absent (no empty-array injection). |
| 10 | Visual verification | **DONE** — `simulation/agent_tools/generator_splits_verify.cjs`, 9/9 green, screenshots in `~/tmp/generator_splits/`, inspected. See §4. |
| 11 | Optional / operator-gated | **DEFERRED** — see §6. |
| 12 | Close the loop | **PARTIAL** — this report, master-doc R8 row + Log, tracker entry, and the auto-check gate are done. **Notion cards could not be filed** (no Notion MCP tools in this session) — the follow-up list is in §6 for the operator or the next agent to file. |

---

## 2. One deviation from the plan, and why

**`emitInChainOrder` was added to the pure module** (the design listed five
exports; there are six).

Step 8 asks for generation tests, but `generateGroupFromTrace` is a closure
inside `gui_builder.js` behind THREE and the DOM — untestable in Node. Rather
than write an oracle that *mirrors* the emission loop (which would prove
nothing about the shipping code), I moved the name-assignment seam itself into
the pure module:

```js
for (const record of emitInChainOrder(pointData, trace.chainSplits, groupName)) {
  params.parLights.push(record);
}
```

So the tests exercise the **real** code path for the part that matters —
which number lands on which path position, and what the name set is. The aim
math above it is untouched (it is a pure diff-visible no-op: the `params
.parLights.push({…})` literal became `pointData[i] = {…}` with the same key
order, so the serialized YAML is byte-identical).

Two smaller UI choices, both noted rather than assumed:

- **Split sub-folders open by default.** §6's mock draws them collapsed
  (`▸ Split 1`); burying the primary From/To controls behind a third level of
  nesting felt worse than the clutter. Trivial to flip.
- **`+ Add split` / `− Remove last` never write an invalid list.** Add divides
  the last split in half (`[{1,5}]` → `[{1,3},{4,5}]`) and refuses loudly when
  the last split is a single light; Remove merges the last split back into its
  predecessor, or deletes the field entirely when only one split remains. The
  design allowed an invalid intermediate state; keeping the buttons total felt
  strictly better and costs nothing (hand-editing From/To can still go red).

---

## 3. What the tests prove — honestly

**58 new tests**, all green:

| File | Tests | Covers |
|---|---|---|
| `tests/generator_chain_order.test.js` | 31 | Exact cover accepted (incl. the operator's 4→5/3→2/1→1, single-split identity, full reverse, `from==to`); every §3.3 defect named verbatim; expansion values pinned; empty array invalid; count changes refused rather than stretched/truncated; Swap toggle round-trip; purity. |
| `tests/generator_chain_order_emission.test.js` | 15 | (a) absent splits byte-identical to an independent replica of the pre-splits forward loop; (b) the §4 table exactly; (c) every record's payload carried through unchanged — only `name` differs; (d) per-position geometry follows path position, not number; (e) name set invariant under every valid split shape; (f) count-shrink casualties identical with and without splits; (g) snapshot round-trip; (h) `reconstructYAML` verbatim + absent-stays-absent. |
| `tests/scene_model_parity.test.js` (added) | 12 | One mutation per defect class (overlap / gap / range / empty / malformed / non-integer / no count), the operator's example and the Swap shape accepted, absent field silent, finding names the trace, error in default mode. |

**Directly proven:** (a), (b), (d), (e), (f), (g), (h), and the whole validator
rule.

**Proven structurally + in the browser, not by unit test:** (c) aim invariance.
The unit test proves the *seam* carries `rotX/Y/Z` through untouched; that the
rotations themselves are still computed per path position rests on the aim
block being unmodified (visible in the diff) and on the live run, where the
generator ran the real THREE aim math under three different split shapes with
no console errors and correct geometry. I did not find a way to unit-test the
THREE aim math without a browser, and I did not want to claim otherwise.

**Pre-existing failures, untouched (as instructed):** `real scene test_bench:
the model is a faithful export of the scene` and `… every remaining error is a
known open mapping defect`, both from the `TE Sign V3 A/B` `sId 7≠5 / fId
13≠11` drift. Baseline before my first edit: **721 tests, 719 pass, 2 fail**.
After: **779 / 777 / 2**. Parity CLI verdicts unchanged (`test_bench` FAIL 4
errors, `titanic` FAIL 92, `studiodj` PASS) — my check adds zero findings to
every committed scene, because none carries `chainSplits` yet.

---

## 4. Live verification

`simulation/agent_tools/generator_splits_verify.cjs` (new; follows the
established `trace_rename_verify.cjs` pattern). Browser client of `:6969`
only — the operator's stack was never restarted, and the probe browser was
closed at the end.

**Zero-scene-write guarantee, triple-guarded:** `params.autoSave = false`,
`window.debounceAutoSave` stubbed, and every `:6970` request aborted at the
network layer. A pristine deep clone of `params.{parLights,traces}` is restored
at exit. Confirmed after the run: **0 save requests, `parLightsMatch: true,
tracesMatch: true`, no probe group or trace left behind**, and every file under
`simulation/scenes/` still carries its pre-session mtime (2026-07-24 / -28).

**GPU adapter** (ops rule `_39`), recorded next to every observation:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`,
`integrated: false, detectionFailed: false`. This is **software rendering** (the
render script's `--use-angle=swiftshader`), which is fine for a UI/geometry
check — **no FPS or performance number is claimed anywhere in this report.**

Probe: a synthetic 5-light **line** generator from x=−10 to x=+10, so path
positions 1..5 sit at known x coordinates and a mis-permutation is unmissable.

| Check | Result |
|---|---|
| `base_no_splits_is_plain_path_order` | ✅ status row `1..5 (path order)`, names 1..5 on positions 1..5 |
| `operator_example_status_row_and_table` | ✅ status row `4→5, 3→2, 1 · covers 1–5 ✓`; after Regenerate: `1@p4 (x=5) · 2@p5 (x=10) · 3@p3 (x=0) · 4@p2 (x=−5) · 5@p1 (x=−10)` — design §4's table exactly |
| `mapped_note_warns_before_renumbering` | ✅ `⚠ 5 mapped fixture(s) keep their addresses and RENUMBER on Regenerate` |
| `swap_writes_full_reverse_and_flips_label` | ✅ `5→1 (reversed)`, label flips to `⇄ Restore path order` |
| `renumber_confirm_states_the_semantic_caveat` | ✅ (text in §5) |
| `swap_back_clears_the_field_entirely` | ✅ back to `1..5 (path order)`, `chainSplits` field **absent** (not `[]`) |
| `invalid_splits_red_badge_and_loud_refusal` | ✅ red card badge + `⚠ INVALID — see below` + Regenerate alert; **not one fixture mutated** |
| `restore_zero_residue` | ✅ |
| `no_unexpected_console_errors` | ✅ |

**Screenshots** (`~/tmp/generator_splits/`), all inspected by eye:

- `01_base_path_order.png`, `02_splits_card_status.png` — the card renders
  exactly as §6's mock: Order row, `Split 1 From 4 / To 5`, `Split 2 From 3 /
  To 2`, `Split 3 From 1 / To 1`, `[+ Add split] [− Remove last]`,
  `[⇄ Swap start/end]`.
- `03_splits_regenerated.png`, `04_mapped_note.png` — the amber mapped-note row.
- `05_swap_reversed.png` — `5→1 (reversed)`, Split 1 `From 5 / To 1`, the Swap
  button highlighted and relabelled `⇄ Restore path order`.
- `06_swap_restored.png`, `07_invalid_badge.png` — the invalid state shows the
  defect twice: in red inside the folder, and as the card-level
  `⚠ CHAIN SPLITS INVALID — positions {1, 2} not covered …` badge.

---

## 5. ⚠ The semantic caveat — still awaiting the operator's ratification

From `_41` §8, and it is the one thing in this feature that is a **judgement,
not a mechanism**:

> Renumbering changes what a fixture's NUMBER means in the 3D scene: it becomes
> **chain order**, not path order.

I built it as designed, because it is what makes the retroactive fix work and
it matches DMX-tech convention. But nothing in the code can tell the operator
whether he *wants* that, so the confirm dialog says it in as many words. Live
text, verbatim:

```
⚠ Renumber "<group>" to the new chain order?

5 mapped fixture(s) KEEP their DMX addresses (addresses are sticky by fixture
name), but each name moves to a different light.

After this, a fixture NUMBER means its position in the physical daisy chain,
NOT its position along the drawn path. The addresses stay put; which physical
light each address drives changes.

Continue?
```

The same caveat is stated in the module header, so the next reader of the code
meets it before the arithmetic.

**If Sina prefers path-order numbering preserved**, `_41` §2 option (a)
(enumeration-only) is the fallback at the same UI cost, minus retroactivity —
and it would be a rewrite of the emission seam only (`emitInChainOrder` plus
the panel add flow), not of the module, the card, or the validator.

---

## 6. Deferred — needs an operator decision, not more work

Step 11 in full, untouched by instruction:

- **(a) `+ gen (numeric order)` bulk-add** for generator groups in the
  Controllers panel. Touches the 2026-06-11 "no group-level add" ruling —
  **needs Sina's explicit yes.** This is the step that would cash in the
  feature's prospective half (today, mapping a 15-light generator in wire order
  is still 15 clicks; with splits they are at least now *in numeric order*).
- **(b) Chain-number sprite labels** on the preview dots (toggle).
- **(c) The order-vs-addresses conformance check** as a default-severity
  `warning` in the validator — deliberately NOT added, because manual address
  pins are legal operator overrides (decisions 18/19) and the check would fight
  them.
- **(d) `⟲ Remap group in chain order` panel tool** — likely unnecessary now
  that renumbering is retroactive.

Also outstanding from step 12, and **not** filed because this session had no
Notion MCP tools:

- Notion `Backlog` cards for (a)–(d).
- The `§1.6` vocabulary reconciliation between `chainSplits` (this feature) and
  the reserved int `trace.splits` (`20260724_32` circle station-chains, slice S2
  still unwired). They are documented apart in both modules' headers, which
  holds for now, but two operator-facing things called "splits" is a trap.

---

## 7. Files

**New**

- `simulation/src/dmx/generator_chain_order.js` — the pure module.
- `simulation/tests/generator_chain_order.test.js` — 31 tests.
- `simulation/tests/generator_chain_order_emission.test.js` — 15 tests.
- `simulation/agent_tools/generator_splits_verify.cjs` — live GUI proof.

**Changed**

- `simulation/src/gui/gui_builder.js` — chain-order gate + emission seam in
  `generateGroupFromTrace`; `traceLightCount()` helper (now the single place
  `count` is rounded, shared with `computeTraceBaseArclengths`); `Lights`
  count guard; the `⛓ Chain Order` card block + invalid badge.
- `simulation/lib/scene_model_parity.cjs` — `generator_splits` family,
  `readTraces`, `checkGeneratorSplits`.
- `simulation/tests/scene_model_parity.test.js` — 12 tests for the new check.

**Deliberately untouched:** `controller_registry.js`, `controller_map_editor.js`,
`pixelblaze_model_exporter.js`, `trace_chains.js`, every `scenes/**` YAML, every
`marsin_engine/models/*` file, CaptainPad.

---

## 8. Auto-checks (`ops/sim_auto_checks.md`)

- `git diff --check -- simulation` — **pass** (CRLF warnings only, pre-existing).
- `node --check` on every file I touched — **pass**.
- `cd simulation; npm run check` — **779 tests, 777 pass, 2 fail** = the two
  known pre-existing `test_bench` drift failures, nothing new.
- `node tools/scene_model_parity.cjs <scene>` — unchanged from baseline on all
  three scenes; the new family contributes **zero** findings anywhere, since no
  committed scene carries `chainSplits`.
- Browser smoke — done as §4 (GUI code changed), UI inspected, no console
  errors.
- `window.__gpuAdapter.renderer` recorded in §4; **no FPS number claimed.**

No git operations were performed.

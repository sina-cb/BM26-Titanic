# 20260725_123 — Chaining IS the patch: unbound MarsinLED cards now project

**Mode:** fix (simulation) · **Author:** developer / simulation_expert
**Branch:** `feat/bm_readiness` (base `be58eea7`) · **No git ops.**
**Scope:** `simulation/src/**`, `simulation/style.css`, `simulation/tests/**`.

---

## Operator ruling (verbatim, 2026-08-03) — this SUPERSEDES `_121`'s fix plan

> **"unbound should not cause the lights to go off or unpatched red."**

Addendum 1:

> **"the warning and patch without board button is okay. Just make sure it's not
> too noisy."**

Addendum 2:

> **"keep the messages short to avoid making the UI super noisy."**
> (plus: he pressed ⚑ *Patch without the board* on his five cards and it worked —
> so that path is to be double-checked/regression-protected, not reworked; and a
> **"No Controller"** card must exist for fixtures attached to nothing.)

**What this changes.** `_121` diagnosed the mechanism correctly but proposed the
wrong direction: it would have kept unbound-with-chains projecting NOTHING and
merely shouted louder about it. The operator ruled the opposite way — the dark
state was the bug. Typing an IP and chaining fixtures **is** patching; the device
binding is a hardware CLAIM, never an address gate.

**`_92` §4 is RELAXED by this ruling.** Routing sACN to an operator-typed but
board-unverified address is his accepted risk — that was the entire point of
making discovery optional (`_96`). The promote-on-first-contact and
contradiction-reconcile machinery from `_96` is untouched and still passes
end-to-end (see Verification).

---

## What changed

### 1. The patch chain no longer gates on binding grade

- `simulation/src/dmx/led/led_patch_projection.js:183-207` —
  `computeLedStrandPatches` dropped the `!isBoundLedController(controller)` skip.
  Every LED controller carrying chain entries projects, at any grade. The
  `isBoundLedController` import is gone from the module.
- Same file `:197-207` — the `led_bad_ip` violation became
  **`led_no_destination_ip`**, re-scoped to *chained* cards only and re-worded to
  the truth: *"N chained fixture(s) patch and render, but its IP ('') is unusable
  — nothing can be routed to them. Type the IP."* This is now the **only** loud
  LED state.
- Same file `:441-443` — `validateLedManualUniverses`' per-controller
  duplicate-universe check also dropped its bound-only gate (all LED cards
  project now, so all can collide with themselves).
- `simulation/src/dmx/controller_registry.js:855-867` — `isBoundLedController`'s
  contract doc rewritten: it is **not** the patch gate; it governs first-contact
  reconcile, promote, push/gamma receipts and bind-by-controllerId dedup.
- `simulation/src/dmx/controller_registry.js:1917-1930` — the DMX projection's
  `bad_ip` violation is no longer raised for LED controllers. It said *"its
  fixtures project unpatched"*, which is now false for them and duplicated the
  accurate LED one in the same banner.
- `simulation/src/dmx/pixelblaze_model_exporter.js:15-53` — doc block rewritten:
  what is patched = what is chained; only a strand chained nowhere exports
  `unpatched: true`.

Everything downstream falls out of this with no further change: `patches.yaml`
is written from this projection (`main.js` `projectLedStrandPatches`), the sACN
bridge builds its relay table from that file keyed on each record's controller
IP, and the engine model + the sim's lit/red overlays read the same fields.

### 2. The pane stops discarding LED violations (the `_121` MAJOR finding)

- `simulation/src/gui/controller_map_editor.js:112-118, 763-767` —
  `computeRenderProjection` now keeps `.violations` (`lastLedViolations`), not
  just `.fields`. Before this, **every** LED violation was console-only.
- `:812-834` — new `allViolations(proj)` merges DMX + LED violations for the
  header count and the scene-wide banner. Not merged into `proj.violations`
  itself: that object is `lastProj`, read by `makeAllocator` and the per-port
  `violationsFor` chips.
- `:836-870` — the header verdict is extracted as a pure, exported
  `headerStatusModel(active, unmappedTotal, violationCount)` so the predicate
  that lied in `_121` is directly unit-testable.

### 3. Quiet card UI (per addendum 1)

- `simulation/src/gui/controller_map_editor.js:1856-1876` — `renderLedPort` no
  longer branches on binding grade at all. **One** projection feeds the chips
  (`lastLedBoundFields`), so a chip can never again show an address that
  `patches.yaml` does not carry. `_121`'s proposed amber/dashed "preview" chips
  and per-port suffixes were built, then removed under the ruling — they do not
  survive anywhere (pinned).
- `simulation/src/gui/led_discovery_panel.js:947-967` — an unbound card with
  chains **and** a valid IP gets ONE muted tag: `⚑ board unverified`
  (`.led-device-tag`, secondary colour, italic), tooltip *"Patched and routed to
  <ip>. The board itself has not been read yet — first contact checks it."* It
  deliberately does **not** use `.led-binding-badge`, so `_96` §6.2's "an UNBOUND
  card shows NO grade badge" still holds.
- `controller_map_editor.js:718-737, 1404-1410` — the one loud card state:
  `isChainedLedWithoutDestination` → a red two-line `.cm-nodest-banner`
  (*"✋ No IP — nothing can be routed to 'X'"* / *"N chained fixture(s) patch and
  render. Type the IP above."*), rendered above the collapse early-return so a
  collapsed card still shows it.
- `simulation/style.css:2589-2650` — the amber `cm-unbound-banner` /
  `cm-chip-preview` / `cm-led-derived-preview` rules were deleted; added
  `.cm-controller-nodest`, `.cm-nodest-banner*`, `.led-device-tag`,
  `.cm-none-card`, `.cm-none-head/body`.

### 4. The ⚑ affordance: convenience, kept under the operator's own name

- `led_discovery_panel.js:969-987` — label stays **`⚑ Patch without the board`**
  (he uses it and it works; the class `led-device-mark-provisional` that the
  browser probe drives is unchanged). The tooltip carries the new meaning in one
  line: *"Optional — already patched. Claims the board at <ip> so first contact
  verifies it instead of adopting whatever answers."* Toast shortened.
- `:934-943` — `✕ Drop provisional`'s tooltip/toast corrected: it withdraws the
  **claim**, not the patches.

### 5. NEW — the "No Controller" card (addendum 2)

- `controller_map_editor.js:739-766` + `render()` `:1057-1059` — when anything is
  attached to nothing, a quiet dashed placeholder card renders at the foot of the
  controllers list: `🚫 No Controller · N fixture(s) · M strand(s)`, one line of
  body copy, and a `+ Add Controller` button.
- It is **not** given the `.cm-controller` class: four `agent_tools` enumerate
  that selector to read the real cards, and a placeholder in that list reads as a
  card with null name/IP/dot (this was caught by `provisional_status_verify.cjs`
  failing 3 checks, and is now pinned by a test).

---

## Before / after

Code-level repro on **test fixtures** shaped like the operator's five cards
(addendum 2: his live cards are ⚑-bound now, so the unbound state must come from
fixtures — his scene was never mutated). Script:
`~/tmp/bm26_123/repro.mjs`.

| state (5 cards, 10 chained fixtures) | patched | routed | violations | pane header |
|---|---|---|---|---|
| **BEFORE** (`be58eea7`) unbound + typed IP | 0 / 10 | 0 | 0 | `✓ fully patched` ← the lie |
| **AFTER** unbound + typed IP | 10 / 10 | 10 | 0 | `✓ fully patched` ← now true |
| **AFTER** ⚑ provisional | 10 / 10 | 10 | 0 | `✓ fully patched` |
| **AFTER** unbound, no IP | 10 / 10 | 0 | 5 × `led_no_destination_ip` | `5 violation(s) ⚠` |

`unbound ≡ provisional, byte-for-byte: true`. Pressing ⚑ on all five moved
**0** addresses and produced 0 violations.

**Live pane (read-only probe, `~/tmp/bm26_123/pane_shots.cjs`).** Every `:6970`
save request and every `:6972` sACN-out socket aborted at the network layer;
off-host fetch refused in-page; auto-sweep off; browser closed after. Scene file
mtimes verified unchanged (all still the operator's own 13:32:59 save).

- `01/02_titanic_*` — the operator's real scene: header `✓ fully patched`,
  18 cards, 12 strand chips, 0 banners, tray `✓ every fixture & strand is mapped`.
  `node tools/scene_model_parity.cjs titanic` → **PASS, 0 errors, 0 warnings, 1
  info** (was 11 info incl. 10 × `unpatched_marker`).
- `03_unbound_but_routed` — test_bench LED card unbound in memory: chips render
  normally (`💡 LED_0 U10:1–80 ×20px`), zero preview chips, zero banners, one
  muted `⚑ board unverified` tag beside `⚑ Patch without the board`.
- `04_no_destination_ip` — same card with its IP cleared: one red card banner +
  one scene banner line, no duplicate DMX message.
- `05_no_controller_card` — strands detached: `🚫 No Controller · 0 fixture(s) ·
  4 strand(s)` with `+ Add Controller`.

Screenshots: `~/tmp/bm26_123/shots/`.

---

## Tests

| gate | result |
|---|---|
| `npm test` (simulation) baseline @ `be58eea7` | 1663 tests · 1654 pass · **9 fail** |
| `npm test` after | **1687 tests · 1679 pass · 8 fail** |
| new failures | **0** |
| `agent_tools/provisional_status_verify.cjs` (test_bench) | **ALL 18 CHECKS PASSED** |
| `tools/scene_model_parity.cjs titanic` | PASS — 0 err, 0 warn, 1 info |

The 8 remaining failures are all in the baseline set (bench-block CLI/headroom
planner tests, `test_bench` TE-sign parity — the documented `_92` A4 handoff).
The 9th baseline failure (`real scene titanic: the model is fresh and complete`)
is now **fixed**: the titanic exterior is fully patched.

New / rewritten tests:

- `simulation/tests/chained_led_patches.test.js` (**new**, 15 tests) — R1 all
  three grades project byte-identically; R2 the no-destination violation and its
  non-emission; R3 the header predicate in both directions (green for
  unbound-but-routed, warn for unroutable) + the seam that carries LED
  violations; R4 the quiet cues, the single loud banner, the No-Controller card,
  and that the overruled amber styling exists nowhere; R5 the ⚑ path is
  address-neutral and keeps its name + probe class.
- `tests/provisional_binding.test.js` — the "UNBOUND projects NOTHING" and
  "dropping returns to UNPATCHED" pins **inverted** to the ruling; added the
  no-IP case and an ⚑ regression pin.
- `tests/led_patch_projection.test.js` — unbound now pinned equal to bound;
  `led_bad_ip` → `led_no_destination_ip`; added the "no IP, no chains ⇒ silent"
  pin.
- `tests/pixelblaze_model_exporter_local_index.test.js` — the two
  "UNBOUND exports UNPATCHED" pins inverted; added "chained nowhere still exports
  unpatched" so the honest marker keeps a test.
- `tests/scene_model_parity.test.js` — the three real-titanic pins updated to the
  post-⚑ world (signs patched, gate green, `--strict` promotes every `strictOnly`
  finding and invents none).

---

## Judgment calls

- **Projection, not auto-binding.** The brief floated auto-creating a provisional
  binding on save. Rejected: `markControllerProvisional` requires a valid IP and
  refuses the `0.0.0.0` sentinel, so it cannot satisfy "no IP ⇒ patches still
  work", and a silent scene mutation on save is a fallback behaviour. Removing
  the gate from the projection is the single-source change; nothing downstream
  needed touching.
- **`led_bad_ip` → `led_no_destination_ip`** rather than keeping the old code
  with new wording: the old code's name and message both encoded the removed
  semantics.
- **Kept the ⚑ button's label** rather than renaming to something like "Claim
  this board": he named it and it works. The tooltip carries the change.
- **Corrected the DMX-side `bad_ip` for LED cards** (`controller_registry.js`) —
  strictly speaking outside the four fixes, but it printed a contradictory
  sentence directly above the accurate one in the same banner.

## Deferred / flagged

- `computeLedProjection` (the sim's generic per-port model) is now dominated by
  the patch projection everywhere it is unioned (`main.js:692`,
  `subscribed_universes_prompt.js:90`, `controller_map_editor.js:255,766`): the
  "unbound" difference map is empty in every normal case. The union stays
  correct, so it was left alone rather than ripped out in this wave.
- Scene-coupled tests: the three real-titanic parity pins encode the operator's
  live scene contents, so they churn whenever he saves. Not restructured here.
- The 8 baseline failures are untouched and unrelated (`_92` A4 + bench-block
  planner).

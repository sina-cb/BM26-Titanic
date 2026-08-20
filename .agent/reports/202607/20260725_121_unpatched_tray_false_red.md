# 20260725_121 — Investigation: TE signs + 3 rope pairs read UNPATCHED after the operator "patched" them

**Mode:** bug investigation (read-only — zero source edits, zero git ops)
**Author:** investigator · **Branch + commit reviewed:** `feat/bm_readiness` @ `be58eea7` (+ operator's uncommitted scene save)
**Engine boot:** no. Sim probe: connected a fresh READ-ONLY headless browser to the operator's already-running stack on `:6969` (every `:6970` save request and every off-host request aborted at the network layer; auto-reachability sweep forced off; browser closed after). No new servers started.
**Duration:** ~50 min

Per `security_privacy.md` all real controller addresses are redacted as `10.x.x.NN`.

---

## TL;DR

The operator's five controllers (`LeftTeSign`, `RightTESign`, `LeftRightRopes`, `RightLeftRopes`, `RightRightRopes`) are **chained correctly and persisted** — but all five are **UNBOUND** (no `device:` block, neither PROVISIONAL nor VERIFIED). The `_96` lifecycle gates the ENTIRE patch chain on `isBoundLedController`, so an unbound card projects **zero** patch records: no `patches.yaml` rows, `unpatched: true` in the engine model, no bridge relay routes — the ten fixtures/strands render red on every "unpatched" surface. Meanwhile the Controller Mapping pane header says **"✓ fully patched"** and the port rows show concrete addresses (`U38:1–160 ×40px`) from the *generic preview* projection — a false-green surface over ten dark fixtures, the exact silent-lie shape codex P0 bans. **It is NOT auto-discovery undoing his work, and NOT the unmapped tray** (live probe: tray = "Unmapped fixtures (0)"). The one-step unblock: press **⚑ Patch without the board** on each of the five cards (IPs are already typed), then Save.

## Method

- Read reports `_92` (TE-sign LED reclassification), `_96` (optional discovery / provisional lifecycle), `_102` context.
- Read the tray + projection code paths: `controller_map_editor.js`, `controller_registry.js`, `led_patch_projection.js`, `led_fixture_kind.js`, `main.js` (`projectLedStrandPatches`), `patch_manager.js`, `gui_builder.js`, `orphan_fixtures.js`, `led_discovery_panel.js`.
- Read the operator's saved scene state: `scenes/titanic/controllers.yaml` (+ `git diff` vs HEAD), `patches.yaml`, `scene_config.yaml`.
- **Headless repro** (scratchpad script, pure functions on the real scene files): built the registry via `createControllerRegistry`, computed `unmappedNamesByKind` and `computeLedStrandPatches` with the real fixture/strand/definition inputs.
- **Live probe** (read-only puppeteer against the operator's running `:6969` stack): opened the Controller Mapping pane, read the header status, tray title/chips, card badges/chips, `window.__controllerRegistry` and `window.__globalPatchTree`.
- Ran `node tools/scene_model_parity.cjs titanic` (read-only gate).

## Evidence

**1. The operator's patching IS persisted.** `git diff simulation/scenes/titanic/controllers.yaml` shows exactly his work: two new LED controllers `LeftTeSign` (id 23, U38/U39, chains `TE Sign V3 A/B`) and `RightTESign` (id 24, U40/U41, chains `TE Sign 2 V3 A/B`) at typed real IPs (`10.x.x.NN` ×2) — `controllers.yaml:423-470`. The three rope controllers (`LeftRightRopes` id 13 :171, `RightLeftRopes` id 15 :212, `RightRightRopes` id 22 :387) already carried their six strand chains at HEAD. Chains resolve; nothing was reverted by any discovery/auto process.

**2. None of the five carries a `device:` block.** Only `LeftLeftRopes` (id 4, `controllers.yaml:53-61`) has one (VERIFIED). Live registry read-back confirms `device: null` on all five. The save path round-trips `device:` faithfully (LeftLeftRopes' block survives every save), so the block was never created — the operator never pressed **⚑ Patch without the board** (`led_discovery_panel.js:950`), the `_96` step that writes `device: {vendor, provisional: true}`.

**3. Unbound ⇒ the patch chain emits nothing.**
- `controller_registry.js:865-867` — `isBoundLedController = isLedController && !!controller.device`.
- `led_patch_projection.js:177` — `computeLedStrandPatches` **returns** for any LED controller that is not bound. Headless repro: `patched names: ['Left_Front_Left', 'Left_Back_Left']` — only LeftLeftRopes' two strands. Zero violations emitted.
- `main.js:615-626` (`projectLedStrandPatches`) — every LED-mappable name NOT in the bound projection has its patch fields **zeroed** (`dmxUniverse: 0`, `controllerIp: ''`) and its `__globalPatchTree` entry blanked.
- On-disk truth agrees: `patches.yaml` has **no** record for any of the ten names (grep: 0 hits); parity gate reports exactly **10 × INFO `placeholder/unpatched_marker`** (4 sign halves + 6 rope strands), `RESULT PASS — 0 errors`.
- Live `__globalPatchTree`: all ten `{u:0, a:0, ip:''}`; `Left_Front_Left` = `{u:30, a:1, ip:10.x.x.NN}`.

**4. What the operator actually sees red — the "unpatched" surfaces, all keyed on `dmxUniverse > 0`:**
- 3D "Unpatched Highlight" red tint (`params.showUnpatchedRed`, toggle at `controller_map_editor.js:819-832`, applied via `entryDisplayRgb`).
- 2D pixel map red pixels (`pixel_map_store.js:495`, `pixel_map_renderer.js:280`).
- LED Fixtures drawer rows `📡 unpatched` (`gui_builder.js:6979-6988`).
- Parity gate / model export `unpatched: true` (`pixelblaze_model_exporter.js`, per `_92` §4).

**5. It is NOT the Unmapped tray, and NOT auto-discovery.**
- Tray computation is chain-membership only: `unmappedNamesByKind` (`controller_registry.js:809-816`) filters against `mappedFixtures` (`:711-722`), which reads every chain entry through `entryFixtureName` (`:384-388` — handles both the string and `{fixture, at}` shapes). Headless repro AND live probe: tray title **"Unmapped fixtures (0)"**, zero chips.
- First-contact promotion fires only for PROVISIONAL cards (`controller_status.js` `shouldAttemptFirstContact`; `_96` §4.5) — an unbound card is never touched by the status sweep. Orphan removal (`orphan_fixtures.js:110-119`) requires `traceGenerated === true`; the sign halves are stamped `false`. Nothing removed or reverted anything.

**6. The pane actively reads GREEN over this state (live probe):**
- Header: **"✓ fully patched"** — `controller_map_editor.js:782-791`: the predicate is `unmappedTotal > 0 || proj.violations.length > 0`; "chained on an unbound LED card" is in neither term.
- Every unbound card's port rows render chips with concrete addresses — `💡 TE Sign V3 A U38:1–160 ×40px` — because `controller_map_editor.js:1750-1751` swaps in the **generic preview** projection (`lastLedGenericFields`) for unbound cards, styled identically to a bound card's real patches.
- The only visual difference from the working card: the absent grade badge (`LeftLeftRopes` shows `✓ VERIFIED`; the five show nothing — `_96` §6.2 "an UNBOUND LED card shows NO grade badge").

## Findings

### ROOT CAUSE (1)

- **Missing provisional binding + a pane that calls the result "fully patched".** Mechanism: `led_patch_projection.js:177` (unbound skip, by design per `_96`) × `controller_map_editor.js:782-791` (green predicate ignores binding grade) × `controller_map_editor.js:1750-1751` (unbound cards preview concrete addresses indistinguishable from real patches). Trigger: the operator completed every step the pane visibly asked for — create LED controller, type IP, chain fixtures, Save — and no surface in that flow states that a MarsinLED card **projects nothing until it carries a device binding**. The `⚑ Patch without the board` button (`led_discovery_panel.js:950`) reads as an optional offline convenience, not as the required completion of patching. Severity: **BLOCKER-adjacent** — ten exterior fixtures (both TE signs + 6 rope strands, 296 + 960 channels) receive no sACN while the mapping pane reads green; on the playa this is a dark ship with all surfaces green (codex P0's named failure shape). Handoff: `simulation_expert.md`.

### MAJOR (1)

- **`controller_map_editor.js:706` — LED projection violations never reach the pane.** `computeRenderProjection` keeps only `.fields` from `computeLedStrandPatches` and discards `.violations`; the pane's banner (`:796-801`) and header count render **DMX** violations only. Even today's real LED violations (`led_bad_ip`, `led_unknown_strand`, `led_unallocated_base`) are console-only (via `main.js:588`) — invisible in the surface the operator actually uses. Any fix for the root cause that emits a new LED violation is silently swallowed here unless this seam is also fixed.

### MINOR (2)

- **Sign chain entries use the pinned DMX shape on LED ports** (`controllers.yaml:430-439`: `- fixture: TE Sign V3 A / at: 1`, vs bare-string rope chains). Harmless today — `entryFixtureName` accepts both, and the LED walker only honors `at` as a start pin (`led_patch_projection.js:1805` region) — but it is a second serialized shape for the same meaning; parity/merge tooling must keep handling both.
- **`_96` §5.1's acceptance walkthrough was never completed for the ropes.** The three rope cards were the report's own worked example ("press ⚑ Patch without the board on each, and Save"); the state on disk shows step 2 was skipped. The UX above is why — the example lived in a report, not in the pane.

### PRAISE

- The downstream chain is honest and consistent everywhere it was designed to be: `patches.yaml`, the model's `unpatched: true` markers, the parity gate's 10 INFO findings, and the red overlays all agree exactly. The lie lives in one pane's summary line, not in the data path.

## Measurements

| check | result |
|---|---|
| headless repro: tray contents (real scene files) | 0 unmapped DMX fixtures, 0 unmapped LED names |
| headless repro: `computeLedStrandPatches` coverage | 2 of 12 LED-mappable names (LeftLeftRopes only) |
| live pane header | `✓ fully patched` |
| live tray title | `Unmapped fixtures (0)`, 0 chips |
| live `__globalPatchTree` | 10 names `{u:0,a:0,ip:''}`; `Left_Front_Left` `{u:30,a:1}` |
| `patches.yaml` records for the ten names | 0 |
| parity gate `titanic` | PASS — 0 err, 0 warn, 11 info (10 = `unpatched_marker` for exactly these ten) |
| grade badges (live) | `✓ VERIFIED` on LeftLeftRopes; none on the five |

## FIX PLAN (for separate fix agents — self-contained)

**Fix 0 — operator unblock (no code, do first):** in 🎛 Controller Mapping, on each of `LeftTeSign`, `RightTESign`, `LeftRightRopes`, `RightLeftRopes`, `RightRightRopes`: open the card's device-binding section and press **⚑ Patch without the board** (IPs are already typed; `canMarkProvisional` allows all five), then **💾 Save Configuration**. That writes `device: {vendor: marsinled, provisional: true}` per card; all ten patch records, engine model lanes, and bridge relay routes materialize on that save (pinned by `_96`'s "provisional ≡ verified projection" tests). On first contact the status sweep promotes each card to VERIFIED.

**Fix 1 — make "chained but UNBOUND" loud in the LED projection (the mechanism fix).**
File: `simulation/src/dmx/led/led_patch_projection.js`, `computeLedStrandPatches` (~line 173-177). Before the `!isBoundLedController` skip, if the controller is an LED controller whose ports carry ≥1 chain entry, push a violation `{code: 'led_unbound_chained', controllerId, message: "LED controller '<name>' has <n> fixture(s)/strand(s) chained but NO device binding — it projects NOTHING (no patches.yaml records, no bridge routes, model exports unpatched). Press '⚑ Patch without the board' (typed IP) or bind/Verify against the board."}` naming the chained names. Keep the projection result unchanged (still no fields — the honest dark state stands; this adds the loud signal, not a fallback). Update `tests/provisional_binding.test.js`'s "UNBOUND projects NOTHING" pin to also assert the violation, and add a pin: unbound + empty chains ⇒ no violation.

**Fix 2 — stop dropping LED violations in the pane.**
File: `simulation/src/gui/controller_map_editor.js`, `computeRenderProjection` (~line 706). Capture `computeLedStrandPatches(...)` whole, keep `.fields` as today, and merge `.violations` into what `render()` counts and the banner renders (`render()` ~lines 782-801). Result: the header flips to `N violation(s) ⚠` and the banner names the five cards — "✓ fully patched" becomes unreachable while any chained LED card is unbound. Test: a registry with one unbound chained LED controller ⇒ pane model must NOT read fully-patched (the tray-content helpers are already pure/unit-tested; add the same for the header predicate if extractable, else pin via the violation count).

**Fix 3 — distinguish the unbound card's preview chips from real patches.**
File: `simulation/src/gui/controller_map_editor.js`, `renderLedPort` (~lines 1745-1811). When `!isBoundLedController(controller)`, style the strand chips + derived line as PREVIEW (e.g. `cm-chip-preview` class, amber/dashed, suffix like `(preview — not patched)`), and add one per-card banner row on unbound cards that carry chains, mirroring the Fix-1 violation text with the ⚑ button adjacent. CSS in `simulation/style.css`. The generic numbers themselves are useful (they are what a future bind will produce for these single-strand-per-port cards) — the fix is labeling, not removal.

**Fix 4 (optional, small) — rename/re-tooltip the affordance.**
File: `simulation/src/gui/led_discovery_panel.js:950-966`. "⚑ Patch without the board" undersells that it is the REQUIRED completion of patching whenever the fingerprint hasn't been read; the card section for an unbound-with-chains controller should lead with "this card is NOT patched yet". Wording is the implementer's call; the requirement is that the required-ness is stated where the operator is looking.

**Constraint for all fixes:** no fallback behaviors — do NOT make unbound controllers project generic patches into `patches.yaml` (that direction was explicitly rejected in `_92` §4: it would route live sACN at unverified hardware addresses). The state is genuinely incomplete; the fix is to say so loudly in the pane, not to complete it silently.

**Tests to add (summary):** `led_unbound_chained` violation emission + non-emission (Fix 1); pane projection carries LED violations / fully-patched unreachable while unbound-chained exists (Fix 2); preview styling class present on unbound card chips (Fix 3, if the DOM tests idiom is available — else covered by the violation pins).

## Coverage gaps — what I couldn't determine

- Which red surface the operator was literally looking at ("tray" in his words) — tray, 3D overlay, 2D map, and drawer rows were all candidates; all key off the same zeroed patch fields, so the root cause is invariant to it. His live browser session was not inspected (only a fresh read-only session against the same saved state).
- Whether the rope/sign boards currently answer at their typed IPs (no device HTTP performed — investigation constraint). Irrelevant to the mechanism: binding grade, not reachability, gates the projection.

## Out of scope (intentional)

- `_102` same-address merge: all five IPs are distinct; no merge interaction.
- `test_bench` scene's own TE-sign parity baseline failures (documented `_92` A4 handoff, unrelated).
- Any fix implementation (investigator is read-only).

## Recommended handoffs

- ROOT CAUSE + Fixes 1-3 → `simulation_expert.md` (one developer, single wave — the three changes are one seam).
- Fix 0 → operator, immediately (unblocks the ship tonight, independent of code).
- MAJOR (violations dropped at `:706`) rides Fix 2.

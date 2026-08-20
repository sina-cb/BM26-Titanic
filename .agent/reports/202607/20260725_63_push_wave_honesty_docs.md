# 20260725_63 — S5: honesty + docs + acceptance prep (the wave closes)

Final slice of the push/save workflow wave planned in
`20260725_58_push_save_workflow_plan.md` (§6 end, §8/S5, §9), landing on top of
S2 (`_59`), S3 (`_60`), S1 (`_61`) and S4 (`_62`). Docs, copy and unit tests
only: **no browser session against the sim, no scene save, no device HTTP,
nothing started or restarted, no git operations, no `simulation/scenes/**` or
`marsin_engine/**` edits.** The operator was live-mapping lit hardware off this
stack throughout. The gamma-UI agent (`_65`) was editing `docs/41` §4.1(d) and
`led_gamma_ui.js` concurrently — neither was touched here and no edit conflict
occurred.

**With this slice the `_58` implementation wave is complete in code. What
remains is the operator-gated live acceptance run (§3) — until it happens the
whole wave is proven by unit tests only.**

---

## 1. What changed

### 1.1 The sync chip says what it measures (`led_discovery_panel.js`)

The chip compares the DEVICE to the per-output plan this page would push. It
has nothing to say about whether frames are reaching the strands — and a green
`● In sync` standing over a stale feed is exactly the shape of the operator's
dark-LED day (`_58` §3, the "lies by omission" aggravator).

- New constant `SYNC_CHIP_MEANING` + new exported pure helper
  **`describeSyncChipTooltip(sync)`**. Every chip's tooltip now leads with:

  > Measures the DEVICE against the per-output plan this page would push
  > (device ≡ plan) — NOT the sACN feed: green does not prove frames are
  > reaching the strands, which needs the scene saved (patches.yaml) and the
  > sACN bridge notified.

  followed by whatever that state adds — the `detail` sentence, or the
  per-output diff (`output 2: 24 → 23`), unchanged in content and format.
- The renderer no longer builds the title inline; it calls the helper, so the
  copy exists in exactly one place and is asserted there.
- **Reads consistently with S1's stale-feed detail** (the second work item of
  the tooltip order): after a push whose save or notify failed, the chip stays
  `in-sync` and carries `device ≡ plan, but the sACN feed is STALE — <step>
  failed: <reason>`. Header and detail now use the same two terms — `device ≡
  plan` and `the sACN feed` — so they read as one claim with a header, not two
  competing ones. A test asserts the pair.
- The ⬆ Push button's own tooltip was stale post-S1 ("…push + reboot", which
  was the whole story before this wave). It now ends "…then save the scene and
  notify the sACN bridge".

### 1.2 `docs/41_led_controller_onboarding.md` — post-wave truth

- **New §4.5 "Push, save, and the sACN feed (what actually makes the LEDs
  light)"** — the section the wave was missing. It states, with the reports
  cited: a device write moves one state layer and the feed comes from files on
  disk; ⬆ Push now runs the scene save (Option A — the same `exportConfig()`
  the 💾 buttons run, declared up front in the confirm dialog) and then the
  bridge notify, chained on the save, never on a timer; the three reported
  steps and the exact red failure sentence; the device write is deliberately
  never rolled back and a failed save suppresses the notify; push-all does one
  save + one notify after the last controller; **Save Configuration alone is
  sufficient for mapping-only changes** because both 💾 buttons are the same
  path and it notifies AFTER the write; a failed notify is loud (red save toast
  + red sACN-IN monitor line) and self-heals on WS reconnect; **two `setScene`
  messages per push are by design** (with the reason both halves are
  load-bearing); the bridge **runtime-subscribes** new universes at every route
  recompute (S3) and **needs one bridge restart to activate on a running box**;
  **pixel-count changes still need `.agent/ops/engine_model_refresh.md`** while
  universe/mapping-only changes hot-reload; and what the sync chip measures.
- **Header status blockquote** gained a "Push/save model" line pointing at
  §4.5, mirroring the existing "Mapping model" pointer to §3.
- **§3.5** now records the registry-aware pre-flight gate (S2): auto-extend
  picks universes free across the whole registry, and an explicitly declared
  port universe owned by another controller is a **blocking refusal** naming
  both sides, with no override path. Previously §3.5 documented only the
  in-controller validator and the two non-blocking chips.
- **§5 step 4** notes that the push also saves and notifies, so steps 1–2 land
  on disk in the same action.
- **Doc standing order, adjacent staleness fixed:** §7's open "Multi-controller"
  item still claimed cross-controller overlap was "a loud-but-non-blocking
  warning" — false since S2. Corrected to name the blocking gate and narrow the
  open half to fleet-scale discovery/allocation.

No numbering was disturbed (§4.5 is additive after §4.4), no full RFC1918 IP was
added, no firmware internals, no dates or deadlines.

### 1.3 Copy: one terminology fix

**"the sim feed" → "the sACN feed"** in the four operator-facing strings that
carried it (`describePushCompletion`'s failure sentence, the single-push toast,
the push-all toast, the sync-chip stale detail). Rationale in §2.

## 2. Copy final review

The `_58` plan points S5 at "`_57`'s contract terms". `_57`
(`20260725_57_docs41_per_output_contract.md`) is the docs/41 per-output rebase
report — a truth-correction ledger, not a naming/glossary spec. It has no
"contract terms" section to check strings against. **So the review was run as
the plan's intent allows: against the vocabulary `_57` established in docs/41
§§2–4, plus internal consistency across the three dialogs.** Findings:

| # | Finding | Verdict |
|---|---|---|
| 1 | **"the sim feed" vs "the sACN feed"** — the push confirm dialog said "for the **sACN feed** to follow" while the failure sentence, both toasts and the chip detail said "the **sim feed**". Two names for the one thing the whole wave is about; worse, "sim feed" is ambiguous in a UI that also has a *sACN-IN* feed *into* the sim (the monitor panel). docs/41, `_58` §3/§6/§7 and `patch_manager.js`'s own comments use "the sACN feed". | **FIXED** — normalised to "the sACN feed" in all four strings. Five assertions in `per_output_push.test.js` were pinned to the old wording and were **updated in the same change** (no behaviour change, same sentence shape). |
| 2 | Push button tooltip described a device-only push. | **FIXED** (§1.1). Not test-pinned. |
| 3 | Sync-chip tooltip had no statement of what the chip measures. | **FIXED** (§1.1) — the slice's first work item. |
| 4 | `device WAS written (cannot be rolled back)` (S1) vs `The device was NOT written.` (S2 refusal) vs `the device(s) WERE written` (push-all). | **Consistent by design** — same noun, same voice, correct tense per path. No change. |
| 5 | S2's collision message uses the **`U23`** shorthand while the confirm dialog's mapping list spells `universe 23`, and one sentence carries both "output 3" (this device) and "port 1" (the other controller). | **FLAGGED, not changed.** `U<N>` matches the bridge log vocabulary the operator reads alongside it, docs/41 §3.2 establishes port = output slot so both nouns are correct, and the exact string is pinned in several S2 tests plus the new docs/41 §3.5 quote. Changing it is cosmetic churn across three files. |
| 6 | `patch_manager.js` says "the hardware will NOT follow this change" / "the hardware keeps following the old routes" where the push says "LEDs will not follow until a successful save". | **Consistent** — same claim, and each names the object its surface is about (the save toast is global; the push dialog is about one controller's strands). No change. |
| 7 | Step names: the dialog's short `bridge notified` / `bridge NOT notified` vs `patch_manager`'s `sACN bridge NOT notified`. | **Consistent** — the push dialog introduces the full term in its declaration line ("then the sACN bridge is told to reload its routes") before using the short form in the step list. No change. |
| 8 | S1's dialog declaration, S2's refusal body and S4's failure lines all name the *layer* that is stale and the *consequence*, in that order. | **Verified consistent** across all three; that pattern is now also what docs/41 §4.5 describes. |

Nothing behavioural was touched in this review — only the strings in finding 1
and the two tooltips.

## 3. Acceptance runbook — OPERATOR-GATED, live

Not run here, and deliberately not written into a tracked runbook (it is a
one-off acceptance, and scheduling belongs in `.agent/reports_local/`). Each
push case costs one ~10 s device reboot and one real scene save.

**Pre-flight (once, before the three tests)**

- One sim stack on the standard ports; exactly one browser tab on the sim (a
  second tab is a second sACN writer — see the `sacn-route-ownership` memory).
- Have the sACN-bridge console/log visible: the route transitions and the
  `runtime-subscribed U…` lines are the evidence.
- Confirm `config.autoSave` is still **false** (that is what makes these tests
  meaningful).

**(a) Push-only — the headline claim ("push is never ignored")**

1. On the `.60` LED controller card, change **output 1's universe** (his exact
   sequence: the real next mapping change he wants, or U21→U20 and back).
2. Press **⬆ Push to controller** and confirm. **Press nothing else — no save.**
3. Expect, in order:
   - the confirm dialog declares the save up front ("Push writes the device AND
     saves the scene…");
   - the status line walks `✓ device written + verified` → `saving the scene
     (mapping → patches.yaml)…` → `✓ scene saved (patches projected) · ✓ bridge
     notified — routes follow`, ending green;
   - the bridge log shows a **route transition** for the changed universe
     (route created/removed for the `.60`), and — post-restart, see gate 2 — a
     `runtime-subscribed U…` line if the universe is new to the boot list;
   - **the LEDs follow with NO manual save**, after the ~10 s reboot.
4. Fail signature to report verbatim: any red status line. It names the stale
   layer (`scene save` or `bridge notify`) and states the device WAS written.
5. Cross-check the chip: hover `● In sync` — the tooltip must say it measures
   device ≡ plan, not the feed, and (on a green run) carry no stale-feed detail.

**(b) Save-only — "Save Configuration is sufficient"**

1. Make a **mapping-only** change: move a strand between ports on a controller
   (no pixel-count change — that is the engine-reload case, see gate 4).
2. Press **💾 Save Configuration** in the controller pane. Nothing else.
3. Expect: the save toast, a bridge `setScene` → route recompute in the log,
   and **the LEDs follow**. No push, no reboot.

**(c) WS-down save — loudness + self-heal (added by S4)**

1. With the sACN-bridge **WebSocket disconnected** (bridge stopped, or the
   page's WS dropped), make any patch change and press 💾.
2. Expect: the save succeeds, and the failed notify is **loud** — a red save
   toast **and** a red line in the sACN-IN monitor's activity log, naming the
   un-notified bridge and saying the hardware will not follow this change.
3. Reconnect the bridge/WS. Expect: the page re-sends `setScene` by itself
   (`sacn_input_source.js`, untouched) and **the LEDs catch up with no further
   operator action**.

**Standing operator gates this interacts with**

1. **Bridge restart to activate S3** (`_58` §9.4 / `_60`). Until the sACN bridge
   process is restarted, its receiver subscription is still boot-frozen — test
   (a) only proves the runtime-subscription path if the changed universe is
   outside the boot list AND the bridge has been restarted since `_60` landed. A
   restart briefly drops the relay to lit hardware, so the operator picks the
   moment. Post-restart evidence: `Runtime Subscribe : ON` in the startup banner,
   then `✅ First frame on U… — runtime-subscribed after boot`.
2. **The `.60`'s output 3** (`_58` §9.2) — enabled on hardware, no card port
   row, still carrying the universe the pre-S2 auto-extender minted, which
   another controller owns for a DMX chain. Inert (relay routes are unicast per
   universe+IP) but armed. Either disable that output on the device, or add a
   port row + third strand and re-push (post-S2 the auto-extend picks a FREE
   universe). **Note for test (a): with a port row added but the universe still
   colliding, the push will now REFUSE with the collision dialog before writing
   the device — that is the S2 gate working, not a test failure.**
3. **TE Sign V3 A/B duplicate fixture names** — the model-export guard throws on
   duplicate names and aborts the WHOLE save. Post-S1 that abort surfaces **in
   the push dialog** as the save step failing (red, verbatim reason, "the device
   WAS written… LEDs will not follow until a successful save"). If test (a) goes
   red on the save step with a duplicate-name reason, this is the cause — fix
   the names, then press 💾 (the device is already written, so no second push is
   needed).
4. **Pixel-count changes are out of scope for both tests** — adding or resizing
   a strand needs `.agent/ops/engine_model_refresh.md`; a save alone will not
   move the engine's send set.
5. **The pre-existing 8 suite failures** (stale-model family) clear on the
   operator's one sim re-export — independent of this wave, but the acceptance
   run's save is a natural moment to collect it.

## 4. Tests

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| after S4 (`_62` baseline) | 1121 | 1113 | 8 |
| after S5 | **1134** | **1126** | **8** |

+13 tests / +13 pass with the failure count unchanged. **Only 4 of those are
mine** — `_65` (gamma UI) landed its tests into the same suite concurrently, so
the delta is shared; the honest statement is **no NEW failures**, and the 8 that
fail are the same known stale-model family, name-for-name: `fixtures are docked
beside the ship…`, `the real titanic scene can accept the block today…`,
`view-bit headroom is REPORTED…`, the two `CLI:` parity cases, and the three
`real scene …` cases.

`simulation/tests/per_output_push.test.js` alone: **43/43 pass** (was 39). New
"Slice S5" section, 4 cases:

1. every tooltip leads with what the chip measures (and a missing state still
   explains itself rather than rendering a bare chip);
2. a `detail` state appends below the meaning line, blank-line separated;
3. a `changes` state still renders the per-output diff;
4. **the chip tooltip and S1's stale-feed detail read as one consistent
   claim** — driven through a real failed `runPerOutputPush`, asserting both
   halves use "the sACN feed".

Five existing assertions were re-pinned to the normalised wording (copy review
finding 1); no assertion was weakened or removed.

`node --check` (ES modules copied to `.mjs`) passes on both touched JS files.
Line endings verified CRLF-preserved on all three edited files (one accidental
LF flattening of the test file was caught and reverted before it reached the
diff).

## 5. Files

- `simulation/src/gui/led_discovery_panel.js` — `SYNC_CHIP_MEANING` +
  `describeSyncChipTooltip` (exported), chip renderer uses it, push-button
  tooltip corrected, "sim feed" → "sACN feed" ×4.
- `simulation/tests/per_output_push.test.js` — +4 S5 cases, 5 re-pinned strings,
  one new import.
- `docs/41_led_controller_onboarding.md` — new §4.5, header pointer, §3.5 gate
  paragraph, §5 step 4 note, §7 multi-controller correction.
- `.agent/projects/bm26_show_readiness.md` — S5/wave status.

## 6. Untouched / out of scope

- No `simulation/scenes/**`, `marsin_engine/**`, server or bridge code.
- `led_gamma_ui.js`, `led_gamma.js` and the gamma block in `style.css` —
  `_65`'s files this session.
- No behaviour change anywhere: this slice moved strings, a tooltip and a doc.

# 369 — Verify-race fix, the gamma PUSH returns, and the fleet DMX-off

Three operator-ordered follow-ups to the night the narrowed config push was
live-validated on four real boards. Everything here is implemented and gated
(`node --check`, targeted `node --test`, greps). **No git operation, no device
contact, no stack bounce, no live-stack port bound, no browser launched.**

Builds on `_363` (the plan), `_364` (gamma UI disabled / pull removed), `_365`
(the narrowed client contract + DMX toggle) and `_366` (panel wiring).
Controllers are named by `controllerId`; test fixtures use private /
documentation-range IPs only.

---

## 1. Objective

1. **Kill a real false-FAIL** seen twice tonight on hardware: a verify that
   times out because the board answered the reboot probe but is not serving
   reads yet.
2. **Bring the gamma PUSH back** per `_363` §11, riding the machinery the config
   push just proved — push only, no pull, ever.
3. **Add a fleet "DMX all: off"** so every board can be handed back to its own
   local pattern in one action.

---

## 2. Operator rulings this slice implements

1. **The verify-race fix comes from LIVE EVIDENCE, not theory.** The operator
   pushed four boards tonight; twice the push reported FAIL and a later manual
   read-back proved the write had applied. Diagnosis: `awaitReboot` returns on
   the FIRST `/api/status` answer, but the board finishes re-associating to WiFi
   *after* that reply and drops reads for a few seconds — and the verify's
   `getStatus`/`getConfig` had exactly ONE 8 s attempt each.
2. **"Implement the gamma push and test it too."** This re-enables the PUSH half
   only, exactly as `_363` §11 specified it. `_364`'s ruling 3 — *"only push,
   not pull"* — is **unconditional and untouched**: no refresh, no
   read-mirror-from-device, no cache, no fleet source selection.
3. **"Like the push all button, but DMX off — no swarm, boards run their
   pattern."** This is an **operator-ordered exception to `_363` §3's
   anti-switch checklist**, which explicitly said *"NOT built: no fleet
   toggle"*. It is deliberately ONE-DIRECTIONAL: off. DMX comes back through
   ⬆ Push / ⬆ Push all / a card's own ⏻ toggle, all of which state DMX ON.
4. Everything the earlier slices froze stays frozen: one snapshot per write, no
   write retries, D2 (an answered non-2xx is a definite loud failure), the
   `writeResponseLost` arbitration, the three phase budgets, no swarm key on any
   body, nothing about live mode persisted into the scene.

---

## 3. Task 1 — the verify-race fix

### 3.1 `src/dmx/led/marsinled_client.js` — `readWithRetryOnTimeout`

A new exported helper plus three constants (`VERIFY_READ_ATTEMPTS = 4`,
`VERIFY_READ_BUDGET_MS = 30000`, `VERIFY_READ_RETRY_DELAY_MS = 1500`).

The contract is deliberately narrow, because the failure it fixes is narrow:

| Rule | Why |
|---|---|
| Retries **only** `err.timedOut === true` | that marker is set by `fetchWithTimeout` and by nothing else, so it means "the device gave us no answer at all" |
| An **answered** failure (400 / 409 / 5xx) re-throws on attempt 1, verbatim | D2 — a device that spoke is final; retrying it would be a fallback |
| Any **other** rejection (connection refused, non-JSON, a thrown assert) also re-throws on attempt 1 | fail loud; never paper over an unknown error class with a loop |
| Takes a **read closure** and nothing else | it is structurally incapable of re-POSTing: the write path never passes through it |
| Bounded **twice** — attempt count AND a wall-clock budget checked before each new attempt | codex P0, no infinite spinner |
| Exhaustion throws carrying `timedOut`, `readRetriesExhausted` and `cause` | the caller's message can say how hard it tried |

### 3.2 `src/gui/led_discovery_panel.js` — where it is used

Two small internal helpers: `readRetrying(io, label, read, onRetry)` (the single
place `io.readRetry` is threaded into the client helper) and
`readVerifyPair(io, ip, …)`, which runs `getStatus` + `getConfig` as **ONE
retried unit** — they are a matched pair (an identity and the config it
describes), and half-fresh evidence is harder to reason about than a re-read.

Applied at exactly the four places the false FAIL could land:

| Call site | Read |
|---|---|
| `pushPerOutputVerifyRecord` | the post-write verify pair (the case seen tonight) |
| `toggleDmx` | the post-toggle verify pair |
| `pushAllLedControllers` | the per-board snapshot `getStatus` and `getConfig` — a fleet reaches board N seconds after board N−1 rebooted |
| `dmxOffAllControllers` / `pushGammaToDevice` (new, §4–5) | both their read pairs |

Retries surface on the SAME progress line the operator is already watching
(`the board is not serving reads yet (…) — re-reading, attempt 2 of 4…`), so a
retry can never look like a hang.

`io.readRetry` is an injected override of `{attempts, budgetMs, retryDelayMs}` —
the unit tests set `retryDelayMs: 0`. `DEFAULT_DEVICE_IO` carries no
`readRetry`, so production runs on the client's measured defaults.

**Worst case, stated honestly:** 4 attempts × an 8 s read timeout + 3 × 1.5 s
delay ≈ 36 s, since the budget gates the START of an attempt, not its end. A
verify that used to fail at ~8 s now fails at ~36 s — and the boards that
triggered this came back inside the second attempt.

---

## 4. Task 2 — the gamma PUSH (`_363` §11)

### 4.1 `marsinled_client.js` — four new pure/transport functions

- **`validateGammaCurve(raw, label)`** — complete `{r,g,b,w}`, each a finite
  number in `GAMMA_MIN`–`GAMMA_MAX` (1.0–3.0), unknown keys refused, error
  carries `.channel` so a slider can point at itself. Nothing clamps, rounds or
  substitutes.
- **`buildGammaPushBody({snapshot, gamma, controllerName, ip})`** — PURE →
  `{ gamma }`, plus `deviceName` under the unchanged §4.1.1 repair. The snapshot
  is REQUIRED even though no key of it is copied: it is where `deviceName` is
  read from, and demanding it keeps gamma on the same one-snapshot discipline as
  the other two writers instead of POSTing blind.
- **`diffGammaPush(verifyConfig, verifyStatus, expectedGamma, expected)`** —
  PURE. Per-channel compare at `GAMMA_VERIFY_EPSILON = 1e-3` (the firmware
  stores float32: a pushed 2.2 reads back as 2.200000047683716, error ≈ 5e-8),
  plus the identity check. A board that reports **no** gamma block is a loud
  mismatch, never agreement. It claims nothing about strands, dmx or swarm.
- **`pushGammaPush(ip, body, {writeTimeoutMs})`** — transport-only mirror of
  `pushDmxToggle`: validates only `body.gamma`, no internal GET, same
  `writeResponseLost` semantics, same D2 rule.

**LIVE-APPLY**: the expected reply is `{outcome:'applied', reboot:false}` and no
reboot is waited for. A `needs-reboot` reply **is** honored if a firmware ever
sends one — believing the device is not the same as assuming it.

### 4.2 `led_discovery_panel.js` — `pushGammaToDevice` + `pushGammaAllControllers`

`pushGammaToDevice(ctx, controller, gamma, io, button, onStatus)` runs the
proven sequence: pre-write identity gate → ONE `getStatus`+`getConfig` →
`buildGammaPushBody` → `pushGammaPush` → (only if the device asks) `awaitReboot`
→ retried read-back → `diffGammaPush` → G8 liveness guard → provenance +
toast. Phase text on the button (`⬆ reading… / writing… / verifying…`). Never
throws; returns `{ok, detail}` so the fleet can carry on.

`pushGammaAllControllers` is sequential, each board pushing **its own card's
curve** (`readGammaMirror` — a scene read, no I/O). No shared fleet curve and no
source selection: harvesting one card's curve to send everywhere was part of the
PULL side and stays deleted. **No scene save, no bridge notify** — gamma is not
part of the mapping.

### 4.3 `src/gui/led_gamma_ui.js` — the section is live again

- Sliders (`change`, one undo entry per drag, Link RGB honored for R/G/B) and
  preset chips now EDIT the scene mirror through `ctx.mutate` → the same values
  the preview models are the values the push sends.
- ⬆ Push gamma is live; it is inert only when the card has no usable device IP.
- The module still owns **no transport of its own** — every device hop goes
  through `pushGammaToDevice`, so there is exactly one gamma write path.
- The disabled note is replaced by the new truth, and it still ends with *"The
  sim never reads gamma back off a device."*
- `renderGammaSection` now takes `(ctx, controller)` and THROWS without a ctx —
  the sliders mutate the scene and the button talks to a device; neither can be
  faked.

### 4.4 The one deliberate choice worth flagging: the mirror is NOT written back

`_364`'s dormant `commitGammaPush` mirrored the device's **verified read-back**
into the scene. This slice does not: adopting the board's float32 numbers would
put `2.200000047683716` into `controllers.yaml`, and reading a value off a board
to keep it is precisely the pull the operator retired. The sliders are the
source; the device confirms them; **provenance records the curve that was
SENT** (confirmed within epsilon). Test-pinned.

---

## 5. Task 3 — fleet DMX off

`dmxOffAllControllers(ctx, io, onProgress)` — sequential, per board: identity
gate → ONE `getStatus`+`getConfig` → `buildDmxToggleBody({enabled:false})` →
`pushDmxToggle` → `awaitReboot` → retried read-back → `diffDmxToggle(false)` →
row PASS/FAIL, **loop continues on failure**. Success seeds that card's ⏻ label
to `off`; any failure clears it to `?` (the read-back is the only truth source).
No valid IP → `skipped`, exactly as ⬆ Push all treats it.

The body is the board's own `dmx` object with one flag flipped — **no swarm key
even on a board reporting swarm ON, no gamma, no strands** — and **nothing is
persisted into the scene** (live mode is runtime state, `_363` §3).

`startDmxOffAll(ctx)` renders ONE confirm dialog. Binding copy
(`DMX_OFF_ALL_WARNING`, exported and asserted in one place):

> ⏻ DMX all: OFF — this switches DMX (sACN) input OFF on every bound and
> reachable MarsinLED board, SEQUENTIALLY. Each board reboots (~11 s) and then
> runs its own local pattern: the sim stops driving them. Swarm and the mapping
> are NOT touched, and nothing is saved into the scene (the live mode is runtime
> state). DMX comes back with ⬆ Push, ⬆ Push all, or a card's own ⏻ DMX toggle.
> Each board is read back and confirmed; one failure never aborts the rest.

### `controller_map_editor.js` — the MarsinLED group header

`🔍 Discover · ⬆ Push all · ⬆ Push gamma to all · ⏻ DMX all: off`. The gamma
button is live (was `disabled = true` with no handler); the ⏻ button is new.
Both call into the panel, like ⬆ Push all does.

### Shared fleet plumbing

⬆ Push all keeps its bespoke dialog (it also saves the scene and confirms bridge
routes). The two new DEVICE-ONLY fleet runs share one small
`openDeviceFleetDialog` runner and one pure row model, `fleetRowsModel(results,
labels)` (+ `gammaPushAllResultsModel` / `dmxOffAllResultsModel`), so three
fleet tables cannot drift into three different honesty standards. Every failed
board keeps its own red row with its own reason; nothing is compressed into a
count.

---

## 6. Gate results

### `node --check` — every touched `.js`

```
OK  src/dmx/led/marsinled_client.js
OK  src/dmx/led/led_gamma.js
OK  src/gui/led_discovery_panel.js
OK  src/gui/led_gamma_ui.js
OK  src/gui/controller_map_editor.js
OK  tests/marsinled_client.test.js
OK  tests/per_output_push.test.js
OK  tests/led_gamma.test.js
OK  tests/led_controller_ui_round2.test.js
```

(`style.css` has no checker; `theme_parity` is green.)

### `node --test`, from `simulation/` — the brief's gate list

| Suite | before | after | fail |
|---|---|---|---|
| `marsinled_client` | 52 | **67** | 0 |
| `per_output_push` | 114 | **135** | 0 |
| `led_gamma` | 37 | **38** | 0 |
| `led_gamma_workflow` | 7 | 7 | 0 |
| `led_gamma_push_devicename` | 7 | 7 | 0 |
| `led_controller_ui_round2` | 21 | **24** | 0 |
| `controller_registry` | 74 | 74 | 0 |
| **total** | **312** | **352** | **0** |

Net **+40 tests**, all new (nothing was deleted; the two `_364` disabled-UI
assertions were REWRITTEN in place to the push-enabled truth, and one new
fleet-DMX-off wiring assertion joined them).

**Regression fences, all green, none of them a live-stack port binder:**

- `bench_mirror`, `bench_mirror_resolve`, `bench_mirror_state`,
  `bench_mirror_arm`, `bench_mirror_reverse`, `bridge_route_readback`,
  `shared_address_ui`, `led_discovery_scene_liveness`, `theme_parity`,
  `chained_led_patches`, `led_metadata` → **259/259**
- `controller_pane_ergonomics`, `led_bind_affordance`, `provisional_binding`,
  `led_wire`, `controllers_pane_toggle`, `subscribed_universes`,
  `panel_layout`, `panel_visibility`, `led_fixtures_menu_wiring`,
  `controller_status`, `controller_probe_service`, `device_config_mapper`,
  `led_device_binding`, `led_output_port_slots`, `rename_hygiene_wiring` →
  **276/276**

`npm run check` was **not** run — it binds/sweeps live-stack ports and the
operator's stack is up (`_363` §7 rule).

### Greps

| Gate | Result |
|---|---|
| `_364`'s gamma-PULL absence list (`refreshGammaFromController`, `commitGammaRefresh`, `gammaRefreshState`, `clearGammaRefreshCache`, `GAMMA_REFRESH_TTL_MS`, `gammaRefreshCache`, `cacheVerifiedGamma`, `runGammaRefresh`, `fleetGammaSourcePlan`, `startFleetGammaPush`) over `src/ server/ tests/ agent_tools/` | **0 code hits** — 7 hits, every one inside an absence-assertion test (the S1 permitted-mention precedent) |
| gamma READ leg on the client (`getGamma`, `readGamma`, `refreshGamma`, `fetchGamma` as module exports) | **0** — asserted by test, not just by grep |
| swarm WRITE anywhere in `src/` (`body.swarm`, `swarm: {`, `.swarm =`) | **0** — every `swarm` hit is a READ of a read-back (`swarmEnabledNote`) or copy stating the key is not touched |
| polling timers in `led_discovery_panel.js` + `led_gamma_ui.js` (`setInterval`/`setTimeout`/`requestAnimationFrame`) | **0** — unchanged. The retry's sleep lives in the client's pre-existing `delay()`; the client's only two `setTimeout` uses are still `delay()` and the fetch abort timer |

---

## 7. Deviations and decisions worth the operator's eye

1. **Report number.** The brief suggested `20260824_1`. Neighbouring reports use
   a CONTINUING counter (`20260821_343` … `20260823_368`), not a per-day reset,
   so this is `_369`.
2. **The verify retries the read PAIR as one unit**, not each read separately,
   in the verify stage. The fleet's pre-write snapshot reads are retried
   individually, because the identity gate must run BETWEEN them and must refuse
   before any config is read.
3. **The gamma push does NOT write the device read-back into the scene mirror**
   (§4.4). This diverges from the dormant `commitGammaPush` behaviour and is a
   direct consequence of "no pull".
4. **`renderGammaSection` signature changed** to `(ctx, controller)` and throws
   without a ctx. One call site (`controller_map_editor.js`).
5. **The gamma fleet gets a confirm dialog** even though the brief only demanded
   one for DMX-off. It writes N boards; ⬆ Push all has one; symmetry won.
6. **The old save-server gamma path is now SUPERSEDED and has no production
   caller**: `led_gamma.js`'s `pushGammaToController` / `pushGammaFleet` /
   `commitGammaPush` / `postGamma` / `DEFAULT_GAMMA_TRANSPORT`, plus
   `server/led_gamma_service.cjs`, `POST /led/gamma-push` and
   `agent_tools/led_gamma_push.cjs`. It is left standing, loudly commented as
   superseded, and still tested — deleting a path `_364`'s rulings deliberately
   kept is an operator call, not an implementer's. **Open question: delete it,
   or keep the CLI?** (Deleting it would also retire `led_gamma_workflow` and
   `led_gamma_push_devicename`, 14 tests.)
7. **`tests/led_controller_ui_round2.test.js`'s `fakeElement` gained
   `classList.add`, `value`, `checked` and `innerHTML`** so the gamma section can
   be rendered against the fake document. Additive; no existing case changed.

---

## 8. Restart vs reload

| Change | What must bounce |
|---|---|
| `marsinled_client.js`, `led_discovery_panel.js`, `led_gamma_ui.js`, `led_gamma.js`, `controller_map_editor.js`, `style.css` (browser ESM/CSS) | **page reload only** |
| `save-server.js` | untouched — **no launcher bounce needed** |
| Engine, sACN bridges, bench-mirror runtime, CaptainPad | untouched |

---

## 9. What still needs LIVE validation (operator-run, from the UI)

No browser evidence was produced: this ran in the main checkout with the
operator's stack up, and `.agent/os/multi_agent.md` §5/§9 forbid binding the
sim's ports or driving a page that relays sACN there. The substitute is the 40
new tests, which render the real DOM and drive the real flows against mock
boards. What needs eyes on hardware, in this order:

1. **Verify-race fix — the whole point.** Push a board that previously
   false-FAILed (the two from tonight). Expect: after the reboot wait, if the
   board is slow, the status line reads `the board is not serving reads yet (…)
   — re-reading, attempt 2 of 4…` and then the push goes GREEN. A push that used
   to fail at ~8 s may now take up to ~36 s before failing for real.
2. **Verify-race fix, fleet.** ⬆ Push all across ≥2 boards. Expect no board to
   FAIL on its *snapshot* read just because the previous board's reboot was
   recent.
3. **Per-card gamma push.** On one card: drag a slider (check the value sticks
   and the plot moves), press a preset chip, then ⬆ Push gamma. Expect: NO
   reboot, a fast green toast `gamma … confirmed by read-back`, the provenance
   line flipping to `✓ hardware …`, and the board visibly changing its curve.
   Then confirm on the controller's own web UI that the curve matches.
4. **Gamma epsilon.** Push 2.2 and confirm it does NOT report a mismatch (the
   board stores float32). Push a curve the board refuses (if you can provoke
   one) and confirm the failure names the channel.
5. **Gamma identity gate.** Point a bound card at another board's IP and press
   ⬆ Push gamma. Expect a refusal naming both `controllerId`s, with **nothing
   written** — verify the target board's curve is unchanged.
6. **⬆ Push gamma to all.** Give two cards different curves. Expect each board
   to receive ITS OWN curve, a per-board results table, and **no scene save**
   (the 💾 dirty state should be from the slider edits only, not from the push).
7. **⏻ DMX all: off — the show-visible one.** Read the confirm dialog first and
   tell me if any sentence is wrong. Then run it: expect each board to reboot
   (~11 s), the per-board rows to read `DMX OFF`, every card's ⏻ label to settle
   on `DMX: off`, and the boards to start running their own local patterns.
8. **The way back.** From that state, ⬆ Push all (or a per-card ⏻) must restore
   DMX ON and the labels must follow. **Confirm swarm membership survived** the
   whole cycle on at least one swarm board — nothing in this slice mentions
   swarm, and that should be visible on the controller's own UI.
9. **Partial-failure honesty.** Unplug/blackhole one board and run ⏻ DMX all:
   off. Expect that board FAILED with its own reason, the loop continuing, its
   ⏻ label falling to `?`, and the other boards still switched off.

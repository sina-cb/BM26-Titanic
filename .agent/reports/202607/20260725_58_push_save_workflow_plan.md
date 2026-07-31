# 20260725_58 — "Push to controller" ignored until full save: root cause + plan

Debug + planning session on the operator's report: he changed output 1's
universe on the `.60` LED controller card (U20 → U21), pressed **⬆ Push to
controller**, the device rebooted as expected — but the LEDs stayed dark until
he ALSO pressed save in the Lighting Controls panel; then they lit immediately.

Read-only investigation (no code changed, no writes, no reboots, no browser
sessions against his live sim; device probed with GET endpoints only). This is
the ROOT-CAUSE ANALYSIS + IMPLEMENTATION PLAN — implementation goes to
separate agents per the slices in §8.

---

## TL;DR

**Push writes exactly one of the six state layers that must agree before a
strand lights.** It writes the DEVICE (and, in memory, the page registry) —
and nothing else. The sACN *feed* to the device is produced by a chain that
reads only FILES ON DISK: `patches.yaml` → the sACN-in bridge's relay routes,
and `models/<scene>.js` → the engine's send set. Those files are written
**only by a scene save**, and auto-save is OFF (`common.yaml →
config.autoSave.value: false`), so after a push nothing converges until a
manual save runs. The operator's mental model is exactly right and both his
steps were necessary.

**Bonus root cause for the day-long darkness:** every save he made earlier
that day wrote **zero** `.60` strand records into `patches.yaml`, because the
strand-patch projection only covers **bound** controllers
(`led_patch_projection.js:167`) and his hand-added card was unbound all day
(the `_56` bind-affordance bug). The PUSH is what finally bound the card
(push-binds-unbound, addendum #3) — so the *next* save was the first one that
could project the strand patches and create the routes. Push alone: no disk,
no routes. Save alone (pre-push): unbound card, no records. Push **then**
save: light.

**Order 2 is already literally true**: the Controller pane's **💾 Save
Configuration** calls `window.exportConfig()` — the *identical* full-save
path as the Lighting Controls save button (`controller_map_editor.js:814-819`
vs `gui_builder.js:6312`). Either button would have worked. What's missing is
(a) push completing the loop itself, and (b) the failure modes of that loop
being loud (§7).

**Q3 (overlap):** his U21-on-output-1 change did **not** overlap output 2 on
the wire — the pushed plan was out1→U21, out2→U22 (a same-universe overlap is
hard-refused by `validatePerOutputPlan`). But the push DID silently create a
**cross-controller** collision: the device has a third enabled output with no
card port row, and the plan auto-extender assigned it **U23 — the universe
LeftFrontDeck (`.11`) already owns for the Left Front Rails DMX chain**. The
auto-extender only avoids collisions *within its own plan*
(`device_config_mapper.js:74-114`); it never consults the registry. Verified
live on the device: `sacn.perOutput = [{0,U21},{1,U22},{2,U23}]`. Harmless
today (the bridge unicasts U23 only to `.11`, so the `.60` never receives it —
its output 3 is armed but dark), but it is a landmine and a defect (§4).

---

## 1. The six state layers (who writes what)

For an LED strand to light from the engine, ALL of these must agree:

| # | Layer | Written by | Read by |
|---|---|---|---|
| 1 | **Device config** (universe per output) | ⬆ Push (`pushPerOutputUniverses`, device reboots) | device firmware |
| 2 | **In-page registry + projections** (card ports; strand patch fields via `projectLedStrandPatches`; `__globalPatchTree`) | every pane `mutate()` → `recomputeAndMark()` (`controller_map_editor.js:300-339`) | the sim view; the save |
| 3 | **`controllers.yaml` + `patches.yaml`** on disk | ONLY `exportConfig()` → POST `/save` (:6970 extracts them server-side, `save-server.js:164-338`) | bridge relay routing |
| 4 | **Engine model** `marsin_engine/models/<scene>.js` | ONLY `exportConfig()` → `saveModelJS()` → POST `/save-model` | engine send set (hot-reloads; G10) |
| 5 | **Bridge relay routes** (universe→controller-IP senders) | `sacn_bridge.js recomputeRoutes()` — re-reads `patches.yaml` on boot / client `setScene` / client disconnect / engine-poll change | `routeFrame()` |
| 6 | **Bridge receiver subscription** (which universes it accepts AT ALL) | boot only: all-scenes patches scan OR the `colorWave.sacn_universes` override (`sacn_bridge.js:44-104,437`) — **never updated at runtime** | the `sacn` package Receiver, which **silently drops** any packet whose universe is not in the list (`node_modules/sacn/dist/receiver.js:22`) |

The hardware feed for the `.60` is **layer 5** (bridge relay of the engine's
loopback frames). The engine has no `controllers:` route for it
(`marsin_engine/config.yaml` routes only `.202` U10/U12), and the sim tab's
own prio-150 unicast (writer #2) iterates **`params.parLights` only** —
LED strands are never unicast by the page (`animate.js:694-713`). So
`patches.yaml` + the bridge notify are the ONLY path to this hardware.

Push touches layers 1–2. Save touches 3–4 and (via
`notifySacnBridge` in `exportConfig`'s `.then`, `gui_builder.js:405`)
triggers 5. Layer 6 moves only on bridge restart — see §7.1 for why that
didn't bite here (luck: a saved override list "1..24" already covered U21/22).

## 2. Q1 — the exact trace of his sequence (evidence-backed)

Reconstructed from `.scene_backups/titanic/` pre-save snapshots, process
start times, the card's `device.lastPush` stamp, and a live device probe.
All times local (2026-07-30); `lastPush` 18:12:12 UTC = 11:12:12 local.

1. **10:23:18 — sim stack (re)started** (`launcher.js dev --scene titanic`;
   bridge PID starts then). Bridge receiver subscribes per the
   `colorWave.sacn_universes` override: **1–24**. No `.60` relay routes exist
   (no scene's `patches.yaml` mentions U21/U22; titanic's has ZERO `.60`
   strand records — the card is **unbound**, so `projectLedStrandPatches`
   skips its strands and every save writes none). Engine already emits the
   strand universes (pre-save model snapshot carries `universe: 20/21` —
   exported by the *generic* projection, which does cover unbound cards) —
   but the bridge has nowhere to send them. **Strands dark. This is the `_56`
   addendum's "configured correctly and waiting on a source" state, now fully
   explained: the missing link was patches.yaml records, which the unbound
   card could never produce.**
2. **11:11:28 — a save** (snapshot proves the disk state *before* it: card
   `LeftLeftFront`, ports U20/U21, patches.yaml `.60`-records: 0). It renames
   the card and writes the model — still **no strand records** (card still
   unbound). Dark.
3. **~11:11–11:12 — the operator edits port universes on the card**
   (port 1 → U21, port 2 → U22 by push time; a {21,21} plan would have been
   refused — `validatePerOutputPlan` NO-OVERLAP, `marsinled_client.js:585-596`)
   and presses **⬆ Push**. In-page only: `mutate()` → `recomputeAndMark()` →
   `debounceAutoSave()` → **early-return** (`gui_builder.js:734`:
   `if (!params.autoSave && !force) return;` — `autoSave: false`,
   `common.yaml:216-217`). Disk untouched, bridge untouched.
4. **11:12:12 — push completes**: device rebooted, verified; plan
   out1→U21, out2→U22, **out3→U23 auto-extended** (the device's third output
   is enabled on hardware but has no card port row — §4). The push **binds**
   the previously-unbound card (`pushPerOutputVerifyRecord`,
   `led_discovery_panel.js:743-753`) and records `lastPush` — all in memory.
   Device now listens on U21/22/23; bridge still relays nothing to it.
   **Dark — "push ignored" from where the operator stands.** The sync chip
   even says *in sync* (it compares device ↔ page plan, not the feed).
5. **11:12:29 — the full save** (Lighting Controls 💾): `exportConfig()` →
   `saveModelJS()` (model now U21/22 → engine hot-reloads its send set) →
   POST `/save` (server extracts `controllers.yaml` — card U21/U22 + device
   block + lastPush — and `patches.yaml` — **first-ever `.60` strand
   records**: `Left_Front_Left` U21@1, `Left_Back_Left` U22@1, both
   `controllerIp .60`) → `.then` `notifySacnBridge()` (`setScene` over the
   sACN WS) → bridge `recomputeRoutes('client scene')` re-reads
   `patches.yaml` → **routes created: U21→`.60`, U22→`.60`** → engine
   loopback frames relayed → **LEDs on, immediately.**

Verified end state: device `sacn.rxPackets` streaming, `lastUniverse: 22`;
card bound on U21/U22; patches records present; bridge routes derivable from
disk. Healthy.

## 3. Q2 — why the push is "ignored"

Not staleness *inside* the push — the push itself is correct and verified
(read-modify-write, reboot wait, read-back). It is **scope**: the push flow
ends at the device + in-memory provenance. Nothing in it persists the
mapping, re-exports the model, or notifies the bridge — and with
`autoSave: false` there is no background save to paper over that. The
routing table (layer 5) is rebuilt exclusively from `patches.yaml` on disk,
on `setScene`-class events; the in-page routing state the push updates is
**never consulted by any output path for strands**. So the push is fine and
the *feed* is stale — indefinitely, until a save.

Two aggravators make it read as "ignored" rather than "pending":

- **The sync chip lies by omission**: `in-sync` = device ≡ page plan. After
  a push it shows green while zero frames flow.
- **The success dialog** says "pushed, rebooted, verified — per-output
  mapping confirmed" — true, but it is a statement about layer 1 only.

## 4. Q3 — the overlap question

- **Output 1 vs output 2: NO overlap on the wire.** The pushed plan was
  {0:U21, 1:U22}; a duplicate universe inside one plan is a hard refusal
  before POST (`validatePerOutputPlan` NO-OVERLAP + span checks). If both
  ports briefly sat on U21 in the UI, the push would have errored loudly and
  he'd have fixed port 2 — the saved end state (U21/U22) is clean, and the
  UI-level duplicate check (`validateLedManualUniverses`) renders warn chips.
- **The REAL overlap, confirmed live on the device:** output 3 (enabled on
  hardware, 40 px, no card port row) was auto-extended to **U23** —
  which the registry already assigns to **LeftFrontDeck (`.11`) port 1**
  (Left Front Rails 1–4, `titanic/controllers.yaml` /
  `patches.yaml` dmxUniverse 23). `derivePerOutputPlan`'s auto-extend
  (`device_config_mapper.js:88-114`) tracks a `used` set containing only
  *this device's* universes; it never sees the registry's claims
  (`noteUniverseUsed` / `computeProjection` / `computeLedUniverseClaims`
  know U23 is taken). The only surfacing is a warnings line in the confirm
  dialog ("output 3 has no controller port row — auto-assigned U23") that
  says nothing about the collision. **Defect** (slice S2).
- **Blast radius today: zero but armed.** Relay routes are unicast per
  (universe, IP): U23 goes only to `.11`, so the `.60` never receives it and
  its output 3 stays dark. The collision fires the moment anything routes
  U23 to `.60` (e.g. someone maps a third strand and the bridge unions the
  routes) — rails DMX data would paint pixels. Separately, output 3 being
  enabled-but-unmapped means any physically-connected LEDs on it can never
  light from the sim — an operator decision is needed (§9).

## 5. Design — order 1: "Push to controller must always push and not be ignored"

**Principle: a push is DONE only when the device AND the feed agree — or it
fails loudly stating exactly which layer is stale.** No silent partial
application (codex P0).

After the existing device write + verify succeeds, the push flow continues:

1. **Persist + project**: run the save pipeline. Two options:
   - **Option A (recommended): `exportConfig(force)` — the exact path the
     operator proved by hand.** One save path in the codebase, no new
     endpoint, model re-export included (engine send set follows via hot
     reload). Side effect: saves ALL dirty scene state, not just the
     mapping. The confirm dialog must say so up front: *"Push writes the
     device AND saves the scene (mapping must land on disk for the sACN
     feed to follow)."* Given the operator's autoSave-off preference is
     about *accidental* saves, an explicit, labeled save inside an explicit
     push is consistent — but this is flagged as a micro-decision (§9).
   - **Option B (scoped)**: new save-server endpoint (e.g. `/save-mapping`)
     writing ONLY `controllers.yaml` + `patches.yaml` (input: the registry +
     `window.__globalPatchTree`; `snapshotBeforeWrite` like `/save`), plus
     the existing `/save-model` POSTs. Avoids saving unrelated dirty state;
     costs a second persistence path to keep consistent. Choose B only if
     the operator rejects A's side effect.
2. **Notify**: `PatchManager.notifySacnBridge()` **after** the save response
   (never on a timer — see §7.2), and treat "WS not connected" as a FAILURE
   of this step, not a `console.warn`.
3. **Report honestly in the push dialog**, step by step:
   `✓ device written + verified · ✓ scene saved (patches projected) · ✓
   bridge notified — routes follow U21/U22`. Any step failing → red state
   naming the stale layer: *"the device WAS written (cannot be rolled
   back); the sim feed was NOT updated: <step> — LEDs will not follow until
   a successful save."* The device write is not reverted (that would be a
   hidden fallback and a second reboot); honesty is the fail-loud behavior.
4. **Push-all** uses the same completion (one persist+notify after the
   sequential pushes; per-controller failures already reported).

Pre-flight (belongs to the same order): the **registry-aware plan gate**
(§4 / slice S2) runs BEFORE the device write, so a push can no longer mint a
cross-controller universe collision.

## 6. Design — order 2: "Save Configuration should be sufficient"

It already is — same `exportConfig()`. What the plan adds is making that
sufficiency **guaranteed and visible** rather than incidental:

- **Keep one save path.** Both buttons stay on `exportConfig`; no scoped
  divergence for the buttons themselves (Option B, if chosen, is only the
  push flow's internal persist).
- **Make `exportConfig` awaitable** (return the fetch promise) so callers
  (push flow, tests) can sequence on completion — today `.then` side
  effects are fire-and-forget.
- **Notify hardening (slice S4)**: `notifySacnBridge` failure → visible
  toast + monitor line (currently `console.warn`, swallowed); on WS
  reconnect the page already re-sends `setScene`
  (`sacn_input_source.js:113-118`) so a disconnected bridge self-heals —
  keep + test that.
- **Kill the `saveAndNotify` 500 ms race** (`patch_manager.js:342-346`): a
  save slower than 500 ms makes the bridge re-read a STALE `patches.yaml`.
  Chain the notify on save completion.
- **Runtime universe subscription (slice S3)** — see §7.1; without it,
  "Save Configuration is sufficient" is only true for universes ≤ the
  bridge's boot list. `nextUniverse` is already 27; the trap is one
  controller away.
- **What genuinely still needs more than a save**: a **pixel-count** change
  (strand added/resized) — the engine watcher refuses it
  (`/status.modelStale`) and needs the deliberate
  `POST /scene/reload` per `.agent/ops/engine_model_refresh.md`. Universe
  and mapping-only changes hot-reload fine (G10). Surfacing `modelStale`
  after a save in the sim UI is a nice-to-have noted in S5, not required
  for this order.

## 7. Latent defects found on the way (all in scope for the slices)

1. **Bridge receiver subscription is boot-frozen and silently lossy.**
   The `sacn` package Receiver **drops packets for unsubscribed universes
   with no event** (`receiver.js:22`), the bridge builds its list once at
   boot (`sacn_bridge.js:74,437`) and never calls the package's
   `addUniverse()` (it exists). `recomputeRoutes` will happily create a
   relay sender for a universe the receiver can never deliver — a
   route that looks live in every log and carries nothing. The operator was
   saved by the persisted `colorWave.sacn_universes` override ("1..24"
   covers U21/22); the first controller mapped past U24 reproduces his
   dark-LEDs day with an even more confusing signature. The in-page
   auto-subscribe (`autoSubscribePatchUniverses`) extends the PAGE's list
   but the bridge only reads it at boot. Also, the bridge's own
   `universe > MAX_UNIVERSE` warn (`sacn_bridge.js:455-459`) is dead code
   for this case — the packet never reaches it.
2. **`saveAndNotify` timing hack** — `setTimeout(notify, 500)` races the
   save (§6).
3. **`notifySacnBridge` failure is a swallowed `console.warn`** (§6).
4. **Sync chip semantics** — device≡plan only; says nothing about the feed
   (§3). With S1 landed the discrepancy window closes by construction; a
   tooltip clarification is enough.
5. **Auto-extend ignores registry claims** (§4, slice S2).
6. Observational: device `seqErrors: 357` — consistent with route/reboot
   transitions during the session; watch, not act.

## 8. Implementation slices (for separate Opus agents; disjoint files where possible)

### S1 — Push completes the loop *(core of order 1)*
- **Files:** `simulation/src/gui/led_discovery_panel.js`
  (`runPerOutputPush`, `pushPerOutputVerifyRecord`, `startPushAll` summary),
  `simulation/src/gui/gui_builder.js` (make `exportConfig` return its save
  promise; expose completion), `simulation/src/dmx/patch_manager.js`
  (notify used as a step). Option B only: `simulation/server/save-server.js`.
- **Behavior:** §5 sequence; confirm-dialog copy declares the save; every
  step reported; any failure = red with the exact stale layer; push-all
  persists+notifies once at the end. The injectable `io` bag grows
  `persistScene()` / `notifyBridge()` members so tests mock them.
- **Tests:** extend `simulation/tests/per_output_push.test.js` +
  `led_controller_ui_round2.test.js`: success path asserts persist→notify
  ordering; save-500 path asserts red + "device WAS written" message +
  no notify; notify-fail path asserts red. No live device in tests.
- **Risks:** `exportConfig` aborts when `saveModelJS` throws (duplicate
  fixture-name class — TE Sign V3 A/B is a standing operator item); that
  abort must surface in the push dialog. Reentrancy: don't double-arm the
  debounced autosave path; use the forced, awaited call only.

### S2 — Registry-aware per-output plan gate *(the U23 defect)*
- **Files:** `simulation/src/dmx/led/device_config_mapper.js`
  (`derivePerOutputPlan` takes a `claimedUniverses` set — universes owned by
  OTHER controllers, DMX + LED, from `computeProjection` +
  `computeLedUniverseClaims`), callers in `led_discovery_panel.js`
  (`startPush`, `pushAllLedControllers`, `computeSyncState`) and
  `controller_map_editor.js` (thread the claims via `ledCtx`).
- **Behavior:** auto-extend picks universes free across the WHOLE registry;
  an explicit port universe colliding with another controller's claim turns
  the confirm dialog note into a **blocking refusal** naming both sides
  ("output 3 would take U23 — owned by LeftFrontDeck port 1"). No override
  path initially (fail loud; the operator edits the card instead).
- **Tests:** new cases in `per_output_push.test.js` /
  `device_config_mapper` tests: the exact live repro (2-port card, 3 enabled
  device outputs, another controller on U23) → refusal; auto-extend skips
  claimed universes; sync-chip derive path doesn't false-drift.
- **Risk:** pure derivation change; watch that `computeSyncState` (which
  also derives) uses the same claims so chip and push agree.

### S3 — Bridge runtime universe subscription
- **Files:** `simulation/server/sacn_bridge.js` (+
  `simulation/lib/bridge_routing.cjs` for a pure subscription-diff helper),
  `simulation/tests/bridge_routing.test.js`.
- **Behavior:** on every `recomputeRoutes`, subscribe the receiver
  (`receiver.addUniverse`) to every universe in the effective route set and
  the active scenes' patch universes; log each runtime subscription once
  ("runtime-subscribed U27 (scene 'titanic' save)"); never unsubscribe
  boot-time universes (multicast-drop churn not worth it). Recompute or
  retire the boot-frozen `MAX_UNIVERSE` drop guard so it can't shadow the
  new behavior.
- **Tests:** pure diff-helper tests; a fake-Receiver unit for the add path.
- **Risk:** `addMembership` throws on some ifaces — wrap per-universe,
  fail-loud log, continue (matches existing boot behavior).
- **Note:** bridge restart required to take effect on the show box —
  operator-gated timing (any restart briefly drops the relay).

### S4 — Notify ordering + loudness
- **Files:** `simulation/src/dmx/patch_manager.js` (`saveAndNotify` chains
  on save completion — needs S1's awaitable `exportConfig`;
  `notifySacnBridge` returns success/failure, failure → toast + monitor
  line), small touch in `gui_builder.js` `.then` block.
- **Tests:** unit with mocked `window` bits: notify only after save resolve;
  failure surfaces.
- **Risk:** low; keep the WS-reconnect `setScene` re-send untouched (it is
  the self-heal).

### S5 — Honesty + docs + acceptance
- Sync-chip tooltip: state what the chip measures (device ↔ plan) — 1-line.
- `docs/41` §4: push now persists + notifies (post-S1 truth); note the
  bridge's runtime subscription (S3) and that pixel-count changes still
  need the engine-reload runbook. (Doc standing order applies.)
- Dialog/tooltip copy strings final-reviewed against `_57`'s contract terms.
- **Acceptance test (operator-gated, live):** re-run his exact sequence on
  the `.60` — change output 1's universe (e.g. U21→U20 and back, or the
  real next mapping change he wants), press Push ONLY. Expected: device
  reboots, dialog walks device✓/save✓/notify✓, bridge log shows the route
  transition, **LEDs follow with NO manual save**. Then a Save-only check:
  mapping-only change (move a strand between ports), press 💾 Save
  Configuration in the controller pane, LEDs follow. Each run costs one
  ~10 s device reboot (push case) — schedule with the operator.

**Sequencing:** S2 before S1 lands the pre-flight gate inside the new push
path once; S3/S4 independent; S5 last. All sim-side; **no engine code, no
engine restart, no `marsin_engine/config.yaml` edits needed** (the bridge
relay remains the `.60`'s feed — docs/41 §5.3's dual-destination open
decision is untouched).

## 9. Operator-gated items

1. **Live acceptance run** (S5) — reboots the device, saves the scene.
2. **The `.60`'s output 3**: enabled on hardware at U23 (collides with
   LeftFrontDeck's claim; armed-but-dark). Either disable output 3 on the
   device (config write + reboot) or add a port row + third strand to the
   card and re-push (post-S2 the auto-extend would pick a FREE universe).
   Until then: known, inert, documented here.
3. **Micro-decision, push persist scope (§5):** Option A "push also saves
   the scene" (recommended — one save path, what he did by hand) vs
   Option B scoped mapping-only save. Default A unless he objects.
4. **Bridge restart** to activate S3 on the live box (brief relay blip).
5. Unchanged standing items: TE Sign duplicate names (can abort ANY save
   via the model-export guard — including S1's push-save), the titanic
   re-export/engine-restart owed item.

## Evidence index

- Backups: `simulation/.scene_backups/titanic/20260730_111128_862` and
  `…_111229_014` (pre-save disk states: card U20/U21, `.60` strand records
  absent; model already carried strand universes).
- Current: `simulation/scenes/titanic/controllers.yaml` (card U21/U22,
  bound, `lastPush` 2026-07-30), `patches.yaml` (strand records U21/U22).
- Live probe (GET only): device outputs U21/U22/U23, out3 enabled 40 px,
  `rxPackets` streaming, `lastUniverse` 22.
- Process starts: whole sim stack 10:23:18 local (bridge boot-time
  subscription context).
- Code: cited inline throughout §§1–7.

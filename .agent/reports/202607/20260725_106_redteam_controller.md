# 20260725_106 — Red-team: controller lifecycle / provisional / status / push

**Agent:** Opus (adversarial red-team, report-only). Part of the 6-agent
bulletproofing sweep (operator order 2026-07-31 "break it in the name of
bulletproofing"). My surface: the LED controller lifecycle — optional discovery,
provisional binding, promotion/reconcile, ONLINE/OFFLINE/UNKNOWN status probes,
and the six-layer push/save chain. Siblings own the rest (`_103`–`_105`,
`_107`–`_108`).

**Rules of engagement honoured:** no source edits, no tracked-suite edits. All
repros are pure Node against the REAL modules with **injected transports / fake
probe results** — **zero device HTTP, zero sACN to hardware, no real controller
contacted, no scene writes.** The operator stack (:6969–:6972, :6967) was never
touched (I never started a server). Repros live in `~/tmp/redteam_controller/`
(gitignored). IPs redacted to `10.x.x.NN` in this public report.

**Attack surface read in full:** `provisional_binding.js`, `marsinled_client.js`,
`controller_status.js`, `server/controller_probe_service.cjs`,
`led_discovery_panel.js` (all 1974 lines), `controller_registry.js` lifecycle
functions, `controller_map_editor.js` sweep/first-contact ingestion,
`gui_builder.js` `exportConfig`, `patch_manager.js` `notifySacnBridge{,Loud}`.

---

## Findings (ranked)

### HIGH-1 — `ip_mismatch` guard is UNREACHABLE on the provisional path; a typo'd IP auto-verifies against the WRONG board (promotion-corruption)
**Repro:** `repro1_promotion_lifecycle.mjs` → "FINDING 5".

`provisional_binding.js` documents `ip_mismatch` as a contradiction: *"the device
was found at a different IP than the one the operator typed."* But **every promote
path for a provisional card builds `device.ip` FROM `controller.ip`:**

- `provisionalCandidatesForDevice` / the discovery `existing`-match logic match a
  provisional card **by IP only** (it has no fingerprint yet — by design).
- `verifyProvisionalNow` sets `device.ip = controller.ip` (led_discovery_panel.js
  ~1042).
- the status sweep's `probeLedController(ip)` stamps `device.ip = ip` where `ip`
  is the card's own target (controller_probe_service.cjs ~196).

So in `reconcileProvisionalContact`, `device.ip !== controller.ip` is **never
true** for a provisional card → the `ip_mismatch` push is dead code for the very
lifecycle its doc says it protects. The consequence:

**Observed:** a provisional card whose typed IP belongs (via a one-digit typo, or
a DHCP reshuffle) to a *different* MarsinLED rope controller contacts that box,
reconciles CLEAN (no `ip_mismatch` possible), and **auto-promotes to VERIFIED
against the wrong board's `controllerId`** — with only a success toast. Every
subsequent push then targets that IP and the sync chip is green.

**Expected:** binding to a box at an address other than the one intended should
be catchable. The only thing that CAN catch it is a stated `boardId`/`deviceName`
expectation — and those are **optional** operator fields (repro shows a
no-expectation card promoting clean off the wrong box, identity `CID-WRONG`).
This is mission-critical: it is the exterior ropes that get bound this way.

**Category:** promotion-corruption. **Why HIGH:** IP typos are ordinary, the
ropes are P0-visible, the auto-sweep is ON by default, and the documented guard
gives false assurance it can't deliver.

### HIGH-2 — reconcile dialog re-fires on every auto-sweep (no de-dup); stale stacked dialogs' "Promote anyway" throws uncaught (quirk → promotion-corruption)
**Repro:** `repro1_promotion_lifecycle.mjs` → "FINDING 1".

`controller_map_editor.js` `applyControllerProbeResults` runs on **every** sweep
(auto-sweep is ON by default, ~20 s interval) and, for each provisional card
whose probe is ONLINE-with-fingerprint, calls
`attemptFirstContactPromote(…, {interactive:true})`. A **contradicted** reconcile
(e.g. `board_id_mismatch`, `board_output_count`, `per_output_unsupported`, or the
hard-blocked `controller_id_claimed`) leaves the card PROVISIONAL and opens the
reconcile dialog — **but nothing marks "a dialog is already open for this card."**

**Observed:** a provisional card that is online but contradicted raises a **new,
stacked reconcile dialog every ~20 s, unbounded**, for as long as the operator
leaves it unanswered (repro: 3 dialogs after 3 sweeps for one card). Worse, once
the operator resolves one via "Promote anyway", the card is VERIFIED; the stale
stacked dialogs still hold their old closures, and clicking their "Promote
anyway" calls `promoteProvisionalBinding` on a now-verified card, which **THROWS**
(`'…' does not carry a PROVISIONAL binding`) — **uncaught inside the `ctx.mutate`
onclick** (repro confirms the throw).

**Expected:** at most one reconcile dialog per card at a time; a stale dialog
should no-op or refresh, never crash the mutate pipeline.

**Category:** quirk with a promotion-corruption tail. **Why HIGH:** on the playa
the auto-sweep hammers this every 20 s; a wall of stacked modals over the mapping
pane during setup, plus an uncaught exception mid-`mutate` (which can leave the
undo transaction half-open).

### MED-1 — failed-save push leaves a GREEN "In sync" chip; the stale-feed warning evaporates on the next recompute (status-lie / push-half-state)
**Repro:** `repro3_sync_chip_revert.mjs`.

The six-layer push surfaces a save/notify failure loudly *in the moment* (dialog
status line + 14 s toast + `describePushCompletion`). But the DURABLE surface —
the sync chip — is set to `{state:'in-sync', detail:'…the sACN feed is STALE…'}`
(led_discovery_panel.js ~1786): the label renders green **"● In sync"**, and the
"stale feed" truth lives only in the tooltip. Then the very next
`refreshSyncChips()` (panel reopen, or the next push) recomputes via
`computeSyncState`, which returns a **bare `{state:'in-sync'}`** (line 818) when
device ≡ plan — **dropping even the tooltip warning** (repro shows the two
tooltips side by side; the second has no stale-feed line).

**Observed:** after a push whose scene-save failed or was cancelled at the 📡
Subscribed-Universes prompt, the card settles to a plain green "In sync" chip
while `patches.yaml` on disk never got the mapping and the LEDs are dark. The
loud failure was transient (closed dialog, expired toast).

**Expected:** the durable indicator must not read green when the feed the chip's
own tooltip says it does not measure is known-stale. A persistent "feed stale /
save owed" state that survives recompute.

**Category:** status-lie / push-half-state. This is the exact "disk fresh, feed
stale, every surface green" shape reports _58/_60 exist to kill — the transient
surfaces catch it, the durable one reverts.

### MED-2 — first-contact promotion consumes a possibly-CACHED fingerprint; a same-IP hot-swap binds to the previous board (promotion-corruption)
**Repro:** `repro2_probe_service.mjs` → "FINDING 3".

The probe cache is keyed `${type}:${ip}` with a 5 s TTL and **stores the full
result including `device` (the fingerprint)**. The default-ON auto-sweep calls
`refreshControllerStatuses()` with `force:false`, so a sweep within the TTL is
served from cache (`fromCache:true`) **with the cached device**. `shouldAttempt
FirstContact` fires on that cached result, and `attemptFirstContactPromote`
promotes off `probe.device`.

**Observed (repro):** board A answers at `10.x.x.NN` (fingerprint `CID-A`);
within 5 s board A is unplugged and board B (`CID-B`) is plugged at the same IP; a
non-force sweep still reports `CID-A` (`fromCache:true`). A provisional card at
that IP would VERIFY against `CID-A` while `CID-B` is on the wire. (`force:true`
— the manual "Check status" button — sees the truth; the auto path does not.)

**Expected:** promotion is an identity write; it must never trust a cached
fingerprint. First contact should force a fresh read (or refuse to promote off a
`fromCache` result).

**Category:** promotion-corruption. **Why MED not HIGH:** the 5 s window vs the
~20 s sweep interval makes it narrow in practice, but the design lets an
identity-defining write run on cached data.

### MED-3 — "refused = ONLINE" cannot distinguish a live board from any other host, a reject-firewall, or a NAT that grabbed the IP (status-lie)
**Repro:** `repro2_probe_service.mjs` → "FINDING 4", "FINDING 6", "FINDING 7".

`HOST_ANSWERED_CODES = [ECONNREFUSED, ECONNRESET]` always → ONLINE, for both the
DMX TCP ladder and the LED HTTP path. Real-world consequences the code cannot
tell apart:

- A **reject-policy firewall / a Windows box / a router** at that IP with nothing
  serving :80 sends RST → **ONLINE** (repro), while a **drop-policy** firewall on
  the *identical dead board* times out → **OFFLINE**. Same physical "board gone",
  opposite verdict, decided only by firewall policy.
- LED path: a refused :80, or a **garbage/partial 200** (controllerId present,
  `strands[]` missing), returns **ONLINE** with `device:null, unrecognized:true`
  (repro FINDING 6) — a **green dot for a box that is not the controller**.
- DMX path: **any** host that grabbed the gateway's DHCP lease answers RST →
  ONLINE, but sACN frames go nowhere (repro FINDING 7).

**Observed:** the status dot reads confident green ONLINE for boxes that are not,
or are no longer, the intended controller.

**Expected:** at minimum, an LED "ONLINE but not a MarsinLED" verdict should get
its own non-green presentation (it already carries `unrecognized:true` and a
detail — but the DOT is the same green ONLINE as a healthy board). The refuse-vs-
drop asymmetry is inherent to TCP and is honestly documented for DMX; flagging it
so the operator knows ONLINE ≠ "correct box".

**Category:** status-lie. Partly by-design and documented, but the shared green
dot for `unrecognized` LED hosts is a genuine confusion the feature set out to
kill.

### LOW-1 — `reconcileProvisionalContact` silently SKIPS the `controller_id_claimed` hard blocker when `registry` is omitted (API footgun / silent-fallback)
**Repro:** `repro1_promotion_lifecycle.mjs` → "FINDING (control)".

With no `registry` in `opts`, the "two cards one board" check is skipped and the
result reports `checkedClaims:false, hardBlocked` computed WITHOUT it. Every
in-tree caller passes `registry` today, and `promoteProvisionalBinding` re-checks
independently — so this is not currently exploitable — but the safety-critical
blocker is opt-in at the reconcile API, not enforced. A future caller (or a test
fixture copied as a template) that forgets `registry` gets a reconcile that
cannot see a duplicate-board collision.

**Expected:** either require `registry`, or make `checkedClaims:false` itself a
hard block (you cannot certify "no other card owns this" without looking).

**Category:** silent-fallback (latent).

### LOW-2 — the LED push notifies the sACN bridge TWICE (quirk)
`exportConfig` (the push's `persistScene`) **awaits `notifySacnBridgeLoud()`
internally** on save success (gui_builder.js line 502) and returns `{ok:true}`;
then `persistAndNotifyAfterPush` calls `notifyBridge` (= `notifySacnBridge`,
quiet) again. The `setScene` reload is idempotent, so it is harmless on the wire,
but: (a) it contradicts the documented intent (patch_manager.js ~388: *"the LED
per-output push deliberately calls the QUIET notifySacnBridge … a second toast
would just repeat itself"*) — the internal LOUD notify can still emit a failure
toast during a push; and (b) `exportConfig` returns `{ok:true}` even if its
internal `notifySacnBridgeLoud` failed (it ignores the result), so the SAVE step
of a plain 💾 save reports ok while the bridge may not have been told (surfaced
only via the loud toast/monitor, not the return value).

**Category:** quirk. Redundant work + a documented-intent violation.

### LOW-3 — a board answering at the 1.2 s ceiling flaps ONLINE/OFFLINE (quirk)
`DEFAULT_TIMEOUT_MS = 1200`. A cold/slow board (`marsinled_client` measured
cold-first-byte ~5 s!) that answers *right at* the ceiling is a coin flip each
sweep. A VERIFIED card flapping OFFLINE reads as "a problem" per
`controller_status.js`'s own doc and sends the operator chasing a healthy box.
Note the **mismatch**: discovery/read budgets are 6.5–8 s for cold boards, but
the status probe deadline is 1.2 s — a cold board reads OFFLINE on the status dot
while discovery would find it fine.

**Category:** quirk. Consider a longer LED status deadline (cold boards need it)
or a hysteresis (two misses before flipping a VERIFIED card to OFFLINE).

### LOW-4 (observation, cross-surface) — a provisional card's IP edited to `0.0.0.0` after marking keeps its full patch chain
`canMarkProvisional` refuses the `0.0.0.0` sentinel at MARK time, but nothing
re-validates after an IP edit. A provisional card marked at a valid IP then edited
to `0.0.0.0` stays PROVISIONAL and `isBoundLedController` (the union grade the
patch chain reads) stays true — so `patches.yaml`/bridge routes can end up
pointing at the sentinel. Verifying whether the projection/bridge refuses a
`0.0.0.0` destination is the patch/bridge surface (`_105`/`_107`) — flagging it
here for that agent.

**Category:** potential push-half-state (unconfirmed; cross-surface).

---

## What held up (attacks that FAILED to break it — good news)

- **Two provisional cards at the same IP:** the sweep loop promotes the first,
  and the second correctly HARD-BLOCKS on `controller_id_claimed` (the first
  commit is synchronous before the second reconcile). No double-bind.
- **Partial board answer (controllerId, no strands):** `isMarsinLedStatus`
  refuses it → `device:null` → not promotable. No promote off a half-answer.
- **Push device-then-save-fails:** correctly surfaced in the moment by
  `describePushCompletion` ("device WAS written … the sACN feed was NOT
  updated"); the device write is never rolled back (no hidden second reboot). The
  only gap is the DURABLE chip reverting (MED-1).
- **Lost write reply arbitration** (`pushPerOutputVerifyRecord`): a lost reply
  falls through to reboot-wait + read-back, and only the read-back decides —
  clean. `writeResponseLost` never masquerades as success without the read-back.
- **`per_output_unsupported` / `board_output_count`:** both fire correctly on a
  contradicted first contact.
- **G8 liveness guard:** a controller deleted/undone during the reboot wait is
  caught by reference identity — provenance is not written onto a detached object.

---

## Hardening recommendations (priority order)

1. **(HIGH-1)** Make the provisional promote actually able to catch a wrong-IP
   box: since `ip_mismatch` cannot fire, either (a) require a `boardId` OR
   `deviceName` expectation before a provisional card may auto-promote unattended
   (the sweep path), OR (b) on unattended promotion, do NOT auto-verify — raise a
   confirm ("a board answered at the IP you typed; bind to `<controllerId>`?").
   Auto-verifying an identity off nothing but an IP coincidence is the P0-adjacent
   silent side-pick.
2. **(HIGH-2)** Add a per-card "reconcile dialog open" guard in
   `applyControllerProbeResults` / `attemptFirstContactPromote` so the sweep does
   not stack dialogs, and make the stale-dialog "Promote anyway" re-check
   `isProvisionalLedController` (no-op + close if already verified) instead of
   throwing inside `ctx.mutate`.
3. **(MED-2)** First contact must force a fresh probe: refuse to promote off a
   `fromCache:true` result, or key the cache in a way that a promotion always
   re-reads. An identity write on cached data is never acceptable.
4. **(MED-1)** Give the sync chip a durable "save owed / feed stale" state that
   `computeSyncState` re-derives (e.g. compare a persisted last-successful-save
   marker against the last push) so a failed-save push does not settle to plain
   green on the next recompute.
5. **(MED-3)** Present LED `unrecognized:true` ("ONLINE but not a MarsinLED")
   with its own non-green dot; it is already detected, just rendered green.
6. **(LOW-1)** Treat `checkedClaims:false` as a hard block, or require `registry`.
7. **(LOW-2)** Pick ONE notify per push; have `exportConfig` return the notify
   outcome rather than swallowing it.
8. **(LOW-3)** Raise the LED status-probe deadline toward the cold-board budget,
   or add a two-miss hysteresis before a VERIFIED card flips to OFFLINE.

---

## Repro index (`~/tmp/redteam_controller/`, all pure, no device)

- `repro1_promotion_lifecycle.mjs` — HIGH-1 (ip_mismatch dead code + wrong-board
  promote), HIGH-2 (dialog stacking + stale-promote throw), LOW-1 (registry-omit
  skip). Real `provisional_binding.js` + `controller_registry.js` +
  `controller_status.js`.
- `repro2_probe_service.mjs` — MED-2 (cache hot-swap stale fingerprint), MED-3
  (RST=ONLINE, partial-200 green, DMX any-host). Real
  `controller_probe_service.cjs` with injected `io`.
- `repro3_sync_chip_revert.mjs` — MED-1 (green chip after failed save, warning
  dropped on recompute). Real `led_discovery_panel.js` `describeSyncChipTooltip`.

**No real device was contacted; no sACN reached hardware; no scene file written;
the operator stack was never touched.**

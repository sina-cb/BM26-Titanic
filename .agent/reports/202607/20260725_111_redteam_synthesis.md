# _111 — Adversarial red-team sweep: consolidated synthesis

**Author:** coordinator. **Sweep:** operator order 2026-07-31, "adversarial
test the system to break it in the name of bulletproofing … finding quirks."
**Inputs:** 8 red-team reports — `_103` timeline/party, `_104` zoom/lease,
`_105` bridge/merge, `_106` controller lifecycle, `_107` fixtures/parity,
`_108` API/contract (the six coordinator-commissioned), plus `_109`
controllers/merge and `_110` sim-UI/persistence (**two adversaries the
coordinator did NOT commission — see Provenance**).

**Rules of engagement held by all eight:** report-only, no source or
tracked-suite edits, repros in `~/tmp/redteam_*`, sim suite byte-identical
baseline (1645 / 8 fail) after every run, zero device HTTP, zero sACN to
hardware, operator stack (:6969-72) and :6967 untouched, `config.yaml` clean.

**Tally:** 1 CRITICAL · ~15 HIGH/P1 (a few cross-report duplicates) · ~19
MED/P2 · ~30 LOW/P3. The value is not the count — it is that the findings
cluster into **seven families**, and the worst one is a single systemic
class.

---

## The one CRITICAL

**A malformed WebSocket frame kills the whole engine, and nothing restarts
it → dark ship** (`_108`). None of the `/ws/*` servers attaches a
per-connection `ws.on('error')`; an invalid-UTF-8 frame (or reserved opcode,
bad close code, RSV1) throws uncaught → `process.exit`; there is no
`uncaughtException`/`unhandledRejection` backstop; and `launcher.js` tears the
stack down rather than restarting. **No malice needed — a WiFi-corrupted
frame does it**, and playa RF is hostile. Proven live on two WS topics.

This is mission-critical because the P0 mission is "make the Titanic exterior
highly visible at night." A single bad packet blacking out the ship with no
self-heal is the one outcome the whole project exists to prevent.

---

## Seven families (fix unit = family, not finding)

### A · "Unhandled error kills a process, and nothing restarts it" — the dark-ship family ★ contains the CRITICAL
- `_108` CRITICAL — WS frame → engine exit.
- `_109` P1-1 — malformed `POST /controllers/probe` (negative `timeoutMs`) →
  `socket.setTimeout` throws before `on('error')` is registered → save-server
  process exit (scene saves/backups/gamma/probe all die; rig stays lit).
- Already-fixed cousin: `_99` bridge EINVAL (same shape — the pattern to copy).
- **Compounding root:** `launcher.js` does not supervise/restart a crashed
  child; a crash = teardown, not a blink.
- **Fix:** per-socket classified `error` handlers on all four WS servers + the
  probe socket (the `_99` shape); process-level `uncaughtException` /
  `unhandledRejection` backstops in engine.js and save-server.js; **launcher
  auto-restart/supervision** so any surviving crash is a one-second blink, not
  a blackout. This is the family that turns "dark ship" into "flicker."

### B · Validation-gate blind spots — "green but wrong" ★ operator-facing NOW
- `_107` HIGH-2 — a rope on an **unbound** controller with a stale patch record
  passes `--strict` parity **clean** (parity never reads `controller.device`);
  the exact `_92` patched-but-dark class the gate exists to catch.
- `_107` HIGH-1 — an **RGBW sign on an output set to RGB** exports stride-3
  white-less pixels and passes parity **clean** (parity trusts controller
  order, never cross-checks the fixture's declared format). The `_92`
  correction is re-openable by one wrong dropdown.
- `_105` HIGH — an out-of-range universe (>63999) hand-typed into
  `📡 Subscribed Universes`, or a bad `dmxUniverse`, passes the runtime path
  but makes the **next launcher boot** dead-on-arrival with a misleading
  "socket FAILED" (no E1.31 ceiling guard in the boot-list builders).
- **Why it matters today:** the operator is about to map the signs and ropes
  and will read a green parity as proof. It is not proof of routability or of
  correct stride. **Interim guidance already given to him: eyeball the signs
  on hardware (white channel present) and confirm ropes route; don't lean on
  green alone.**
- **Fix:** parity reads `controller.device` (routability) and cross-checks LED
  fixture declared format vs the output's order; universe-ceiling guard in the
  two boot-list builders (`bridge_routing.cjs`).

### C · The new same-address merge (`_102`) edges
- `_109` P1-2 — a DMX **gap** claim can win the higher-IP contest and mute a
  real strand (merge skips `effect` claims but not nameless gap reservations).
- `_109` P2-8 — a DMX port with an empty chain declares a universe invisible to
  the claim index → LED park/repair allocator takes it → violates `_102`'s
  "auto-assign never creates a share" invariant.
- `_105` MED — bench-mirror `mirrorTargets` built without subtracting
  `engineState.owned`; a mirror aimed at an engine/sim-owned controller is an
  unwarned second writer.
- `_105` MED — `composeUnifiedFrame` doesn't self-guard same-IP contested
  channels; sorts before filtering by universe.
- **Fix:** exclude gap claims from the merge; extend the claimed-universe sweep
  to DMX ports; subtract `engineState.owned` from `mirrorTargets`.

### D · New provisional-binding UI (`_96`)
- `_106` HIGH-1 — the `ip_mismatch` reconcile guard is **dead code** on the
  provisional path (device IP is built from the card IP), so a one-digit typo
  or DHCP reshuffle makes a rope **auto-verify against the wrong board** with
  only a success toast. Mission-critical exterior.
- `_106` HIGH-2 — the default-on status sweep re-raises the reconcile dialog
  ~every 20 s with no de-dup → dialogs stack; resolving one calls
  `promoteProvisionalBinding` on an already-verified card → uncaught throw
  inside `ctx.mutate`.
- `_109` P1-3 — the "1.2 s probe ceiling" is an **idle** timeout; a slow-drip
  host held a probe 10.4 s and wedges every later sweep. Plus IP-key
  canonicalization mismatch (`ipToNumber` folds, keys compare raw strings).
- **Fix:** a real IP-mismatch check (compare answered identity, not the typed
  IP echoed back); dialog de-dup + guard promote against non-provisional
  cards; an absolute probe deadline; canonicalize IP keys.

### E · New zoom pad (`_97` / `_104`)
- `_104` HIGH — the pad exit-claim latch leaks (plain RESUME shares the setter,
  only a zoom→null transition clears it) → the next engine-ended zoom is read
  as "ours," its "zoom ended" toast is suppressed, and the operator is
  **silently left on a deck they no longer own**. Inverts the `_97` §3.4 fix.
- `_104` MED — the scoped lease is written to `timeline_state.yaml`; only the
  boot scrub prevents a ghost PERFORM banner after a crash (F1, confirmed).
- `_104` MED — the D3 "starts when you exit" banner keeps promising a show that
  `_catchUp` silently skips if the operator lingers past the cue's window.
- **Engine "never stuck" invariant HELD** — the break is entirely on the pad.
- **Fix:** scope the latch to a live zoom and clear it on every exit path;
  make the lease runtime-only or harden the scrub; reconcile the D3 copy with
  the skip behavior.

### F · Sim save / persistence + XSS (`_110`)
- `_110` P1 — `exportConfig` has no re-entrancy guard and never disarms
  `saveTimeout`, so the 2 s auto-save writes all five scene files **through** an
  open Subscribed-Universes dialog and clears the unsaved-changes chip — then
  Cancel toasts "nothing was written." `_86`'s Cancel contract holds for one
  call, not the process. (Correct pattern already at `pixel_map_persist.js:151`.)
- `_110` P1 — `Folder.title()` is `innerHTML` and takes operator-typed fixture/
  group/trace names raw: `A<B` truncates the header, and an attached title
  **executed script** in a real DOM. A `scene_config.yaml` copied onto the show
  server is code-exec in the sim origin; and every name-keyed store is silently
  mis-keyed. Use `textContent`.
- `_110` P1 — the SAVE path has **no multi-client guard** and `common.yaml` is
  written ignoring `?scene=` → a second window clobbers the scene / un-applies
  the `_86` widening (dark fixtures, green UI).
- `_110` P1 — sim shortcuts (`Delete`/`D`/`Ctrl+Z`) fire **under** modal
  overlays → mutate the scene the open confirm is describing.
- **Fix:** re-entrancy guard + disarm the timer; `textContent`; multi-client
  SAVE guard + scene-scoped `common.yaml` write; modal keyboard guard.

### G · Party-cue re-fire thrash (`_103`)
- `_103` H1 — the mood→party cue has no "I already own the deck" idempotency
  guard; a detector that dips-and-returns (music with quiet gaps) re-arms and
  re-fires **while its own session is live**, and `timelineLoadPlaylistOnDeck`
  always reloads entry 1 with a transition swap → the exterior snaps back to
  party-pattern-1 on every music gap, all party night (60 re-fires in a
  realistic 5 h flap).
- `_103` M1 — each re-fire re-stamps the deck window, so a "12-min session +
  2-min cooldown" collapses into one endless session; configured cadence/
  cooldown never run.
- **Fix:** make a party-cue re-fire an idempotent no-op while that cue owns the
  live window; add a same-playlist/entry short-circuit in
  `timelineLoadPlaylistOnDeck`; don't re-stamp the window on a re-fire.

---

## What HELD under attack (recorded so it is not re-ploughed)

The engine cores are hardened: the `_99` boot gate + double-join invariant;
route-diff flap-freedom; `_102` merge intersection off-by-one at both edges;
runtime subscription range + per-universe isolation; the whole REST surface
(hundreds of malformed / traversal / `__proto__` / huge-payload attacks →
clean 400s, zero 500s, zero unhandled rejections); DST fall-back de-dupe;
polar/degenerate sun → safe defaultCue; overlapping `durationMin` rejected at
load; festival day-gating exact + loud out-of-window; the `_98` arm-latch fix
(27 burn-night sessions); the `te_sign` generator (every malformed CSV fails
loud, the NaN normalization path is unreachable); `orphan_fixtures` strict
provenance; gamma sliders reject hostile input; the `1-24` range trap; the
universes dialog is `textContent`-safe; the engine "never stuck" zoom
invariant.

---

## Recommended fix plan — three waves (each family = one focused Opus thread)

**WAVE 1 — mission-critical, launch first: Family A (dark-ship).** One
hardening thread: per-socket error handlers everywhere (the `_99` shape),
process-level backstops in engine + save-server, and launcher supervision/
auto-restart. Turns every current and future process-crash vector into a
one-second blink. This is the single highest-value fix in the sweep.

**WAVE 2 — operator-blocking correctness:** Family B (parity blind spots —
so green means something before the operator finishes mapping), Family G
(party thrash — party-night behavior), Family C (merge edges — just shipped,
about to be used). Three threads, parallel.

**WAVE 3 — new-feature UI hardening:** Family D (provisional binding), Family
E (zoom pad exit latch), Family F (sim save races + the `innerHTML` XSS — the
XSS is arguably Wave-2 given it is code-exec, coordinator's call to promote).
Three threads, parallel.

All fixes are operator-gated (standing rule) and land on the uncommitted
`feat/bm_readiness` wave; each will carry a red-team repro flipped from
break-it to a green regression test.

---

## SECOND-PASS ADDENDUM (`_105` second pass — a third uncommissioned adversary, landed after synthesis)

A third uncommissioned adversary ran the real `sacn_bridge.js` process (faithful
fake `sacn`/`ws`, **real `Packet` objects parsed from real wire buffers** — a
method the pure-module passes could not reach) and appended a delimited SECOND
PASS to `_105`: **5 P1 / 8 P2 / 8 P3**, 18 net-new after de-duping with the
first pass. Three are LIVE and change how much of today's visual work to trust:

- **H1 (P1, LIVE) — the sim renders a 39% ship.** The frame the bridge sends to
  browsers is the `sacn` package's **percent** payload (`value / 2.55`) copied
  into a `Uint8Array` the browser reads as **raw DMX** (`sacn_bridge.js:1002`
  vs `sacn_input_source.js:212`). Measured: engine DMX 255 → browser byte 100;
  the whole sim caps at ~39 % brightness and 101 grey levels. The relay to
  hardware is byte-exact — **only the browser branch is wrong.** Consequence:
  every "looks good / looks dark" judgement made in the sim today (and the
  render-scale/halo work) was read off an instrument showing 39 % — the sim
  under-reads brightness, so real output is brighter than it looked, not dimmer.
- **ADJACENT (LIVE, engine output — flagged, wants an owner before rig tuning):**
  every raw-DMX producer feeds the same percent API in reverse —
  `marsin_engine/lib/sacn_output.js:80` and `server/sacn_output_bridge.js:141`
  build `payload[ch+1] = <0..255>` and `Packet.buffer` multiplies by 2.55 and
  clamps → **DMX 100 → wire 255, everything above 100 flat at full.** A uniform
  ×2.55 gain preserves hue until it clips, which is plausibly why it went
  unnoticed — but it means the top ~60 % of every fader is saturated on the
  actual rig. This is a hardware-output correctness question, not sim-only.
- **H2 (P1, LIVE) — one CID for the entire project.** Nothing passes `cid`, so
  every Sender ships the package's hardcoded `DEFAULT_CID` (relay, bench mirror,
  both output bridges, `marsin_engine/lib/sacn_output.js`). Two same-CID sources
  on one universe drop **39 of 40 frames** at a real receiver — **this is the
  missing mechanism behind the `_15` flicker** (it explains why removing a
  writer was *necessary*, not merely tidy), and it goes live the moment a second
  stack exists on the LAN.
- **H3 (P1, LIVE) — the priority lockout is global, not per-universe:** one
  prio-≥150 frame on one universe halts relay of **every** universe for 10 s.
- **H4 (P1, boot-fatal)** duplicates the first pass's out-of-range-universe
  finding; **F2** re-confirms the bench-mirror / engine-owned dual-write.

**New family — H · DMX value-path fidelity.** H1 + the adjacent engine ×2.55
saturation are the same class: the percent↔byte conversion is applied wrong in
two places, so the sim under-reads and the hardware over-drives. This belongs in
**Wave 2** (correctness) and arguably deserves to lead it — it governs both the
instrument you judge the show on and the levels the rig actually emits. H2 (CID)
and H3 (priority lockout) fold into the bridge hardening near Family A. The
`_99` boot gate itself still HELD under this deeper attack.

## PATTERN-VM ADDENDUM (`_112` — a fourth uncommissioned adversary) ★ hits the live ChatGPT loop

`_112` red-teamed the pattern VM + playlist/autopilot content path: **2 P0 / 5
P1 / 5 P2 / 8 P3.** These matter now because the operator is actively authoring
patterns through ChatGPT (`_90`), and this is that path's failure surface.

**New family — I · Pattern-VM never-black + content-path safety.** All three of
the sweep's top-tier findings now produce the same mission-critical outcome — a
dark ship:

- **I1 (P0, LIVE) — a NaN in any one argument to `rgbwau()`/`hsv()` blacks the
  whole pixel, and NaN is absorbing.** Once a persistent var goes NaN
  (`acc = acc + 0/0`) the pattern is black for the rest of its life; `±Inf`
  clamps fine, NaN specifically poisons. **Nothing in `marsin_engine/` enforces
  R4 "never fully black" at runtime** (`getRenderHealth` covers blend errors
  only). A text-authored pattern using `sqrt(a-b)` / `asin(x/r)` / `0/0` does
  this routinely — i.e. ChatGPT can hand back a clean-compiling pattern that
  goes dark.
- **I2 (P0, LIVE) — `beforeRender` shares the ~5000-instruction budget and
  overrunning it truncates the function SILENTLY mid-execution** — no red, no
  log, every frame. The house idiom (a precompute loop before the mandatory
  `_hsv2rgb` palette resolve) means the palette never resolves and **the whole
  ship renders black from a pattern that compiled clean.** The wasm ABI has no
  channel to report it.
- **I3 (P1, LIVE) — a playlist entry that exists but won't compile permanently
  wedges the sequential autopilot** (compile happens before `activeEntryId` is
  written; the daemon swallows the throw; the picker re-selects the broken entry
  forever). **This is exactly the ChatGPT loop's failure mode.** Silent twin:
  duplicate entry ids wedge the deck at cursor 0 with zero log.
- **I4 (P1) — the `_90` audit harness always exits 0:** a 100%-black pattern
  passes, and a sleeper that latches black *after* the audited window clears all
  four documented bars. The tool the operator leans on to bless ChatGPT patterns
  cannot currently catch the I1/I2 black-outs. Plus a hostile-but-legal 4-mixer
  pattern hits 114 % of the 25 ms frame budget with no guard (shipped patterns
  are fine: worst 5.67 ms).

**What held:** every forbidden construct/reserved name rejects loudly; no
cross-VM memory corruption; zero leak over 2400 compile/destroy cycles + 72k
frames; corrupt playlist YAML is loud and holds rather than blacking.

**Priority impact:** the sweep now has **1 CRITICAL + 2 P0, and all three are
"dark ship."** Family I joins Family A in **Wave 1** — with a specific
sub-goal to **harden the `_90` audit harness (I4) before trusting it on more
ChatGPT output**, since that loop is live right now. R4 "never black" needs a
real runtime enforcer (a last-resort floor or a loud health trip), and the
content path needs a compile-before-commit + broken-entry-skip so one bad
ChatGPT pattern can't wedge the deck.

## RIBBON/STATE ADDENDUM (`_113` — a fifth uncommissioned adversary)

`_113` scoped itself to what `_103`/`_104` didn't hit: **2 P0 / 2 P1 / 3 P2 /
5 P3**, and narrowed two of `_103`'s "safe" verdicts. Both P0s are dark-ship
and reinforce Family A:

- **J1 (P0, LIVE) — `/timeline/overview` freezes the whole engine.** The `_95`
  day ribbon is built **synchronously on the HTTP thread** in O(days × cues²)
  (`buildDaySegments` → `resolveDeckStateAt` per sample, each re-running
  `resolveDayTimes` + building `Intl.DateTimeFormat` per clock cue). Measured on
  a real engine: 64 cues×8 days = 2.8 s frozen; 128 = 11.4 s (concurrent
  `/status` ECONNRESET); **512 (the schema's own cap) = 296 s.** Render loop +
  sACN out + the tick share that loop, and the process stays alive so nothing
  restarts it. No auth, no saved plan needed. **This is the endpoint day-zoom
  calls to draw the ribbon** — so as the operator grows the plan, opening day
  zoom can freeze the ship. Fix: paginate/async/cache the ribbon off the request
  thread.
- **J2 (P0, LIVE) — a corrupted `timeline_state.yaml` kills the timeline
  silently.** `loadTimelineState` validates only the 5 party fields; a bad
  `firedToday`/`moodArmed`/scalar loads clean, then throws on **every tick**
  (caught by `_tick().catch`) → one `console.warn`/tick forever while the plan
  drives nothing all night and the engine looks healthy. The D11 failure the
  party guard exists to stop, on the fields it doesn't cover. Fix: validate
  every persisted field loudly at load (fail-closed to a clean state).
- **J3 (P1) — the ribbon and a running engine disagree on same-fire-time cues:**
  the resolver picks the first in plan order (strict `>`), the live tick ends on
  the last — so ribbon / `/timeline/resolve` / `/timeline/travel` / boot
  `_catchUp` all name the opposite cue, and a reboot flips the deck. Refines
  Family B (green-but-wrong) + E (zoom). Plus P1 `hold.min`-unbounded (a program
  owns the deck the rest of the festival).

**Held (re-confirmed):** real `SIGTERM` mid-zoom wakes clean at both scopes
(`_100` F1); no prototype pollution; cue-cap + 1 MB body cap enforced; a
12-round `travel‖perform‖savePlan‖activity` storm left the engine armed,
`lastError: null`.

**Top tier is now 1 CRITICAL + 4 P0 — every one a "dark ship":** WS-frame
engine crash (`_108`), NaN-black + beforeRender-budget-black (`_112`),
overview-freeze + corrupt-state-silent-death (`_113`). This is a **systemic
class**: the engine has several single-thread-blocking / silent-death vectors
and the launcher supervises none of them. **Wave 1 is now the clear priority
and should also add a launcher watchdog** (an unresponsive engine — freeze, not
just crash — gets detected and restarted), plus fail-closed validation of every
persisted state field. Family A/I/J are one Wave-1 hardening campaign:
*nothing silently blacks or freezes the ship, and if it does, it restarts.*

## CAPTAINPAD ADDENDUM (`_114` — a sixth uncommissioned adversary; renumbered from a `_107` collision)

`_114` drove a scripted hostile engine behind a fresh dist and reproduced **5 P1
live in a browser** (no P0). It deepens Family E and adds a pad-side dark-ship
analog:

- **K1 (P1, LIVE) — CaptainPad has NO React error boundary anywhere, so one
  unknown `transition.mode` white-screens the ENTIRE pad.**
  `DECK_TRANSITION_MODE_LABEL[mode].toLowerCase()` (`timelineTemplate.ts:185`) is
  an unguarded map lookup called from render in DayView / EventSheet /
  DayOverviewStrip; a value the engine can emit throws, and with no boundary it
  takes every tab, the ZoomBanner and the plan-lock banner down together. **This
  is the control-surface equivalent of the engine dark-ship** — lose the pad
  mid-show and you can't drive the ship. Fix: an app-level error boundary +
  guard every widening-union lookup (`transition.mode`, `zoom.scope`).
- **K2 (P1, LIVE) — confirms Family E's exit-latch leak from the pad side**
  (`_104` A1 / the `_100` X6 gap): `_zoomExitRequested` is a module global set by
  every `resume()` (incl. the plain deck/mixer RESUME NOW) and only cleared on an
  observed zoom→null transition, so an ordinary hand-back poisons it and the next
  engine-ended zoom's "zoom ended" notice is suppressed. Proven with a clean A/B.
- **K3 (P1, LIVE) — the zoom banner asserts a live lease after the link dies:**
  `useTimeline` keeps the last state forever on disconnect, `ZoomBanner` never
  reads `connected` — screenshot shows "TIME TRAVELING" + a green ● ENGINE dot
  20 s after the socket died, two rows above a card correctly reading ENGINE
  OFFLINE. Plus K4 (empty `segments: []` renders as a completed blank review) and
  K5 (a stepper press makes pad B claim the zoom, so B's tab-return ends pad A's
  zoom — a D1 violation `_100` tested only as "B browses", not "B retargets").

**The enum-brick class, clarified:** `_98`'s strict `parsePartyConfig` is the
*safe* pattern (throws → caught → loud card error). The hazards are the
**unguarded map lookup** (K1) and the **binary if/else over a widening union**
(`zoom.scope` → silent wrong banner), while `timelineState` is admitted on
`typeof mode === 'string'` alone.

**Placement:** K2/K3/K4/K5 fold into Family E (Wave 3). **K1 (no error boundary
→ whole-pad crash) should lead Wave 3, or promote to Wave 2** — a dead control
surface during a show is severe even though it's not a P0 dark *ship*. Held:
EXIT-vs-500, stepper-hammering at edges, 4000-char labels, tab-hammering — all
clean; `shouldAnnounceZoomEnd`'s own truth table is correct (the bug is who sets
its inputs).

## CHAOS / NEVER-STUCK ADDENDUM (`_115` — a seventh uncommissioned adversary; renumbered from a second `_114` collision)

`_115` attacked process-death and recovery across boundaries: **1 P0 / 5 P1 /
6 P2 / 3 P3.** Its P0 is the missing proof under Family A — it shows *why* the
Wave-1 watchdog must probe children and output, not just the parent + two ports:

- **L1 (P0, LIVE) — `start.js` is blind to the death of every server it owns,
  and every health surface reports GREEN.** `kill -9` on the save server, the
  sACN INPUT bridge, and the sACN OUTPUT bridge (all three, real processes)
  leaves `start.js` alive; the launcher supervises `start.js`, not its children,
  so no crash is detected, the show-server `restart_count` never moves,
  `deploy.py verify` passes, and `launcher.js status` prints ✅ because it probes
  only `:6969`/`:6968`. **The rig is dark and every dashboard is green until a
  human looks at the actual lights.** (`start.js:86`, `launcher.js:1051`,
  `:928`.) This is the concrete supervision gap Family A must close: the Wave-1
  watchdog has to health-check the save/in/out bridges *and* verify frames are
  actually flowing, not just that two ports answer.
- **L2 (P1, LIVE) — a backward wall-clock step permanently strands the party
  cue.** Crash mid-party resumes in 1.2 s (correct); the same crash after the
  clock steps back 6 h / 1 day → the party cue **never fires again** for the
  duration of the jump (`triggers.js:306`,`:308` compare against persisted
  absolute epoch stamps with no `last > now` clamp). Playa-real: no internet,
  RTC drift, BIOS AC-restore boots. Forward/1970 boots recover — backward-only.
  Fix: clamp negative elapsed. (Family G/timeline.)
- **L3 (P1) — confirms `_113` J2** (corrupt `timeline_state.yaml` → dead but
  `mode:"armed"`, `lastError:null`); two adversaries independently, one P0 one
  P1. **Fail-closed persisted-state validation is now double-confirmed.**
- **L4 (P2, LIVE) — IPv4/IPv6 port shadowing defeats the launcher's own free-port
  gate:** `checkPortFree` binds `::` and reports FREE while an IPv4-only squatter
  holds the port; the sim co-binds and every IPv4 client reaches the impostor
  (`curl 127.0.0.1:PORT → IMPOSTOR!`, proven). **L5 (P1)** a failed state write
  (disk-full/EBUSY) still returns `200 {"saved":true}` — the SAVED badge lies
  (Family F, save-honesty). **L6 (P1)** `-f` kills the running stack *before*
  validating args. **P2-6** there is no port override anywhere in the sim stack/
  launcher, so launcher-profile behavior is untestable without seizing the
  operator's live ports — a testability gap Wave 1 should also close.

**Held:** `_writeFileAtomic` is crash-safe (8 kill-9 instants, zero torn files);
~330 ms cold boot; runtime-only state truly scrubbed on boot; the sACN bridge
survived 4 engine deaths with edge-triggered named UI-broadcast warnings.

**Revised top tier: 1 CRITICAL + 5 P0, every one a dark ship** — WS crash
(`_108`), NaN-black + beforeRender-black (`_112`), overview-freeze +
corrupt-state-silent-death (`_113`, corrupt-state re-confirmed by `_115`), and
**supervision-blindness (`_115` L1)**. The last reframes Wave 1's watchdog from
"restart a crashed engine" to **"actively health-check every child process and
verify frames are flowing — because green dashboards lie."** Add: a `last > now`
clock clamp, fail-closed state validation (2× confirmed), save-write honesty,
and a port override for testability.

## Provenance note (honesty)

`_109` and `_110` are red-team reports from two agents the coordinator did
**not** commission (agent IDs outside the launched six; they self-numbered as
`_104`/`_106` — the same slots as commissioned threads — then bumped to free
numbers on landing). Most likely a parallel operator-launched batch. Both held
the rules of engagement (verified: suite byte-identical, no source/scene/git
writes of their own, localhost-only traffic), and their findings are treated
as claims to verify during fix triage, identical to the commissioned six.
Flagged rather than silently absorbed.

## Coordinator actions taken this pass
- Redacted five example IPs in `_105` (`10.x.x.NN`) → the `bm26-report-ip`
  commit blocker `_110` flagged is cleared; tree now carries only 6
  pre-existing MACs in gitignored `.scene_backups/` (not a `--staged` blocker).
- No fixes launched — this sweep is find-only; Waves 1–3 await operator go.

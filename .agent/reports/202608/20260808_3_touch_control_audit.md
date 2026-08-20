# Touch Control — full audit

Read-only audit of `docs/ui/touch_control.html` + `docs/ui/touch_control_wire.js`
and everything they touch in `marsin_engine/`, `CaptainPad/` and `simulation/`.

**Method.** Six independent auditors, one per dimension (arm lifecycle, engine
surface, redundancy, correctness of recent work, effects integration, safety).
Every auditor's findings were then handed to a *separate* adversarial verifier
whose job was to refute them by reopening each cited line. Findings the verifier
marked WRONG were dropped; severities the verifier corrected were overridden.
Nothing was executed — this is static reading plus read-only GETs against the
running engine.

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 16 |
| MEDIUM | 26 |
| LOW | 43 |
| ULTRA_LOW | 9 |
| **Total surviving** | **97** |

2 findings were **refuted as WRONG** by verification and are listed at the end
so you can see what the process caught. Verifiers also surfaced 28 extra items
the original auditors missed.

---

## CRITICAL (3)

### CRITICAL-1. Arm releases the blackout LAST, behind every failure-prone step — a takeover that fails leaves a black ship reporting ARMED

`docs/ui/touch_control_wire.js:341` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** In takeControl() the mission-critical step `POST /global-blackout {state:false}` is the FINAL link of a six-deep sequential chain (source-lock 326 → autopilot 334 → color-autopilot 335 → disable-all 339 → silenceOverlays 340 → blackout 341). Any rejection or hang anywhere in links 1-5 is swallowed by the chain's own `.catch` at line 344, so the blackout is never released. Control then returns to the post-race chain (462-517), which is gated only on `state.armed` (478) — still true — and it runs to completion and issues `armFadeTo(1, ARM_FADE_MS)` at 516. The arm envelope goes back to 1 over a ship whose blackout is still engaged. Because the previous DISARM sets `global-blackout {state:true}` (line 417), blackout is true at the start of every arm after the first, so this is the normal starting condition, not an edge case.

**Why it matters.** The ship is black, the panel header says ARMED, the fade-up 'succeeded', and the deadman lease is healthy (stamped at 282) so the engine's revertToAutomaticShow will never fire — the deadman only triggers on a panel that stops answering, not on a panel that is alive and wrong. The only error report is a fail() into a status pill that is never inserted into the DOM (see separate finding), so on an iPad the operator sees nothing at all. The engine's own revertToAutomaticShow states the correct rule at api_server.js:4363 ('ORDER IS THE DESIGN. Lighting the ship comes FIRST and is never gated on anything below it') and takeControl violates exactly that rule.

**Fix.** Hoist `POST /global-blackout {state:false}` to be the FIRST call in takeControl (immediately after the deadman stamp, before the fade-out), and re-assert it unconditionally just before the fade-up at line 516 on both the success and failure paths — the same way releaseControlBody re-asserts armFadeTo(1,0) after its own .catch (426).

### CRITICAL-2. The fade-up is a single un-retried, error-swallowing POST and it is the ONLY thing that brings the ship back from black

`docs/ui/touch_control_wire.js:516` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** `armFadeTo(1, ARM_FADE_MS)` at the tail of the arm chain is one fetch. armFadeTo() catches its own rejection and returns null (line 266), so a 503 ('no intensity controller', api_server.js:6049-6052), a 400 from startArmFade's validation (api_server.js:6059-6062), or a transient wifi drop simply resolves to null. Nothing retries it, nothing verifies via `GET /arm-fade` (api_server.js:6067), and there is no engine-side hold watchdog: I grepped every engine file for `armFade` — the only writers are POST /arm-fade (6058), /mixer/panic's forceLit (8394) and revertToAutomaticShow (4396). IntensityController.armFade is a plain scalar multiplied over every pixel unconditionally (intensity_controller.js:131-142) and its ARM_FADE_MAX_MS=10000 bound is a validation limit on `durationMs`, not a maximum hold time.

**Why it matters.** armFade sits at 0, so every pixel on the ship is multiplied to zero — past the blackout, past the master, past the LOCK/parked groups, past the ignoreDimmer bypass flags. The panel says ARMED, the arm lease is alive so the deadman will not revert, and the operator has no in-panel indication. Recovery requires another surface (POST /mixer/panic) or an engine restart. This is the dark-ship-that-stays-dark outcome the whole envelope was supposed to make impossible.

**Fix.** Make the fade-up self-healing: retry armFadeTo(1,…) on failure, and add an engine-side hold watchdog in IntensityController — if armFade has been below 1 for more than (say) 3x ARM_FADE_MAX_MS with no new startArmFade, snap it to 1 and log loudly. The envelope must not be able to hold the ship at 0 indefinitely on the strength of one unacknowledged HTTP request.

### CRITICAL-3. Clean disarm ends with the ship BLACKED OUT and then releases the deadman — dark ship, nothing watching

`docs/ui/touch_control_wire.js:417` — *arm-lifecycle* — verification: **UNDERSTATED**

**What.** releaseControlBody's penultimate rig action is `req('POST', '/global-blackout', { state: true })` (417). The engine persists that (`globalsState.blackout = data.state; saveGlobals(false)`, api_server.js:6026-6028). Then armFadeTo(1,0) at 426 raises the envelope (which is correct and well-reasoned), and finally sendControl({armed:false}) at 434 deletes the arm lease. So the terminal state after a normal, successful disarm is: blackout ON, envelope at 1, master at whatever the panel left, autopilots re-enabled and cycling patterns nobody can see, and NO deadman lease — the engine has stopped watching. This is documented as intended (docs/ui/README.md:87 'Blackout released | Blackout re-engaged'), so it is a design decision, not an accident.

**Why it matters.** It inverts the mission rule and it inverts the engine's own recovery semantics: a CRASHED panel gets revertToAutomaticShow, which lights the ship first (api_server.js:4390-4403); a CLEANLY disarmed panel leaves the Titanic dark. The operator's most ordinary action — 'I'm done hand-driving, disarm' — turns the exterior off, and the deadman that could have caught it has just been released. Recovery requires CaptainPad, POST /mixer/panic, re-arming, or an engine restart (the persisted-blackout boot guard refuses to restore it, api_server.js and README:253). At the playa with an operator holding only the iPad panel, that is a dark ship until someone else intervenes.

**Fix.** Make a clean disarm converge on the same terminal state as revertToAutomaticShow: hand the params/autopilots/overlays back, then LEAVE THE SHIP LIT and let the restored automatic show drive it. If a 'dark on disarm' mode is genuinely wanted, make it an explicit second control the operator has to choose, not the default exit path.

---

## HIGH (16)

### HIGH-1. Double tap: a stale disarm chain deletes the arm lease of the arm that came after it, leaving an ARMED panel with no deadman

`docs/ui/touch_control_wire.js:434` — *arm-lifecycle* — verification: **OVERSTATED**

**What.** The page's #arm handler is a bare `classList.toggle` with no busy/pending state (touch_control.html:1651-1657), and the wire's listener starts a fresh takeControl()/releaseControl() on every click (452) with no re-entrancy guard. Each disarm chain ends with `sendControl({ type:'touchControlArmed', ownerId: OWNER, armed:false })` at 434 — after the .catch, so it runs unconditionally. OWNER is a single per-page constant (1585) and the engine keys the lease on ownerId alone (`armLease.delete(ownerId)`, api_server.js:4526). Trace: tap DISARM at t=0 → chain D issues armFadeTo(0,1500) then waits 1500 ms then runs releaseControlBody, finishing around t≈3 s. Tap ARM at t=1 s → chain A immediately stamps armLeaseSet (282 → api_server.js:11588 → 4516). At t≈3 s chain D reaches line 434 and deletes that lease. The panel is armed; the engine is watching nothing.

**Why it matters.** The entire deadman exists so that an iPad that dies while armed hands the ship back to the automatic show. After this interleave the panel holds the source lock, both autopilots are off, every effect is disabled and the overlays are muted — and if the iPad now dies, nothing reverts. The ship freezes on the last frame, permanently, with no automatic recovery. The reverse interleave (ARM then DISARM) is the same bug from the other side: chain A's takeover steps (326-341) land after chain D's handback, re-locking the params and re-killing the autopilots on a panel that says DISARMED — which is precisely the 'wreckage' state the ratchet fix at 310-318 was written to detect after the fact.

**Fix.** Add a module-level `armBusy` flag in the wire: on click, if a sequence is in flight, revert the page's class toggle and ignore the tap (or queue exactly one pending transition). Also make the page disable pointer events on #arm until the wire signals completion, and tag each sequence with a monotonic epoch so a stale chain's terminal sendControl/armFadeTo is dropped when the epoch has moved on.

### HIGH-2. The status pill is created but never inserted into the DOM — every arm/disarm failure is invisible to the operator

`docs/ui/touch_control_wire.js:69` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** `pill` is built at 57-63, stamped `pill.dataset.headless = '1'` at 69, and written to by setStatus() at 77-81 — but there is no appendChild/append/insertBefore for it anywhere in the file (all nine `pill` occurrences are 8, 56, 57, 58, 59, 69, 77, 78, 80). fail() (84-88) writes state.lastError, calls setStatus() and console.error()s. On an iPad running this in an iframe inside CaptainPad there is no console. Every arm-path failure routes through fail(): 'take control' (344), 'arm fade' (266), 'arm' timeout (465), 'arm' chain reject (475, 498), 'arm assert' (502, 515), 'arm master' (928, 930, 939), the stale-lock warning (313), 'release control' (419), 'disarm' no-capture (394), 'write' (112).

**Why it matters.** The file's own header rule 1 (line 7-9) states 'Every request that fails is surfaced in the status pill and logged. Nothing silently degrades.' That contract is currently false — nothing is surfaced anywhere the operator can see. Combined with the two findings above, the operator can be looking at a black ship with the header reading ARMED and no error anywhere on screen. The comment at 64-68 claims the element is 'still BUILT and still written to' as if that preserved the reporting, but a detached node reports to nobody.

**Fix.** Route fail() into a visible surface that does not cover the panel — e.g. paint the ARM control itself red / change #armState text to a fault string, or add a thin fault bar in the header. The pill's placement was the complaint; the reporting was not.

### HIGH-3. An engine restart while armed re-stamps only the deadman — the whole takeover is silently lost while the panel still says ARMED

`docs/ui/touch_control_wire.js:2274` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** When the engine restarts, controlWs closes and the wire reconnects every 2 s (2276-2279). On reconnect it sends touchControlHello and, if armed, touchControlArmed:true (2269-2274). That is ALL it re-sends. Nothing re-runs takeControl or armAsserts. Meanwhile the restarted engine has: dropped the source lock (state_manager.js:405-421 deliberately never restores it), lost every audio binding, lost the effect scope and parked groups, lost all group paint leases, and reset armFade to 1 (intensity_controller.js:20). But autopilot-off DID persist (POST /autopilot writes the deck channel's playlist.autopilot then saveAllState() at api_server.js:7233), and the zeroed overlay faders persisted too (saveAllState at api_server.js:8745). If the previous run ended UNCLEANLY the crash boot policy additionally runs revertToAutomaticShow at boot (api_server.js:11139-11143), which turns both autopilots back ON and force-loads the 'default' playlist.

**Why it matters.** After the reconnect the panel reports ARMED and holds a deadman lease, but it no longer holds the desk: the source lock is gone so CaptainPad, bpm-sync, MIDI and OSC can write the six params again; the 24 audio-fader bindings are silently gone; the palette, effect colours, master level and fade time are stale. On a crash restart it is worse — the automatic show is actively running patterns underneath a panel that believes it owns the rig, and the two fight. Only the group paint self-heals, via the 5 s renew loop at 1827-1833. The operator has no signal that any of this happened.

**Fix.** On WS reconnect while state.armed, re-run the full takeover — the source lock, both autopilot-offs, disable-all, silenceOverlays, blackout-off — and then re-run armAsserts + applyStatic, under the arm envelope, rather than only re-declaring the lease. Use the engine's boot/instance id (or a monotonic boot counter on /status) to distinguish 'engine restarted' from 'my socket blipped'.

### HIGH-4. Group section brightness is the one dark-making control with NO automatic recovery path anywhere — and it persists across crashes and restarts

`marsin_engine/lib/state_manager.js:465` — *engine-surface* — verification: **OVERSTATED**

**What.** The panel's 24 group faders write POST /section-brightness, which stores the value in globalsState.dimmers and fsyncs it (api_server.js:6014-6017: `intensityController.setSectionBrightness(sId, data.brightness); globalsState.dimmers[groupName] = data.brightness; saveGlobals(false);`). At boot applyGlobalsState restores every dimmer VERBATIM with no zero-guard (state_manager.js:475-479). This is the ONLY dark-making scalar in the chain that has no guard and no reset: a persisted blackout IS refused at boot (state_manager.js:445-449), a persisted grand master of 0 IS refused (api_server.js:3097-3100), and armFade is transient by construction (intensity_controller.js:17-20). Section dimmers are refused by nothing. Nor are they cleared by any recovery path: disarm does not touch them (touch_control_wire.js:357-436 releaseControlBody sends no /section-brightness), revertToAutomaticShow does not (api_server.js:4386-4456, its six steps are light/source-lock/scope/audio-bindings/paint/playlist), the crash boot policy just calls that same revert (api_server.js:11143), and POST /mixer/panic's forceLit does not (api_server.js:8385-8400) — nor does panicToSafeDefault (pattern_mixer.js:1416-1445, which restores overlay faders and un-mutes groups but never touches sectionBrightness). So panic answers `rigLit: true` over a ship whose every group is multiplied by 0.

**Why it matters.** An operator who takes the group faders (or the page's ALL OFF) to zero and then loses the panel — tab closed, iPad dies, wifi drop — leaves the Titanic dark, and every automatic net the recent work added misses it. The arm deadman fires, logs '1/6 ship lit', and the ship stays black. The crash boot policy fires and the ship stays black. A power-cycle of the show server restores the zeros from disk and the ship stays black. The only ways back are a human on CaptainPad's dimmer rack or a human re-arming the panel. This is live right now, not hypothetical: GET /dimmers on the running engine returns `"189":0` plus 20+ sections held between 0.07 and 0.32, matching globals_state.yaml:396-425 — a rig persisted at a fraction of full output by exactly this path.

**Fix.** Give section dimmers the same boot guard the blackout and the master already have (refuse a restored 0, log loudly), and add a `step('dimmers', ...)` to revertToAutomaticShow + forceLit that clears intensityController.sectionBrightness and globalsState.dimmers. Panic must not be able to answer rigLit:true while a section dimmer is 0.

### HIGH-5. Disarm fires six CONCURRENT requests through the one transport the file documents as hanging; if it hangs the ship is left at armFade 0 with the deadman disabled

`docs/ui/touch_control_wire.js:360` — *engine-surface* — verification: **CONFIRMED**

**What.** releaseControl fades the house to 0 and waits 1500 ms (lines 352-354), then releaseControlBody opens with `return Promise.all([...])` of SIX concurrent requests — /audio-bindings/clear, PUT /effect-groups, PUT /parked-groups, POST /param-center/source-lock, POST /autopilot, POST /deck/color-autopilot (lines 360-399). This is the exact pattern the same file twice records as MEASURED-to-hang: 'Concurrent writes to this engine from a browser hang - MEASURED: five fired together never returned at all' (lines 228-232) and 'fired concurrently, all five of these POSTs hung with no response and takeControl's promise never settled' (lines 319-325). takeControl was serialised because of it; releaseControlBody was not. req() uses a bare fetch with no timeout (lines 92-106), and .catch (line 419) catches rejections, not hangs. If the Promise.all never settles: `armFadeTo(1, 0)` at line 426 never runs, so the engine's envelope stays at 0 and the ship is BLACK; and `sendControl({type:'touchControlArmed', armed:false})` at line 434 never runs, so the engine still holds the arm lease — but the socket is alive and the browser stack keeps answering pings (api_server.js:11650-11653), so the lease never expires and revertToAutomaticShow never fires. The 9500 ms deadline race does not save it: on the disarm path `state.armed` is already false, so line 478 `if (!state.armed) return;` short-circuits before any fade-up.

**Why it matters.** The operator taps DISARM, the panel says DISARMED, and the ship goes black and stays black. Every automatic net is defeated at once — the deadman is held open by a live socket, and armFade is invisible on every endpoint except GET /arm-fade. Recovery exists but requires a human who knows where to look: CaptainPad's PANIC (api_server.js:8385-8400 forceLit calls startArmFade(1,0)), re-arming the panel, or restarting the engine (armFade is never persisted, intensity_controller.js:17-20). At 3 a.m. on the playa, 'disarm made the ship go dark and nothing on the panel says why' is a long outage.

**Fix.** Serialise releaseControlBody the same way takeControl was (reduce over a promise chain), give req() an AbortController timeout so a hang becomes a rejection, and move the armFadeTo(1,0) + the armed:false declaration onto an unconditional timer that fires regardless of whether the handback settled.

### HIGH-6. The panel never listens for messages on /ws/control, so it does not know when the engine's deadman has already reverted the show out from under it

`docs/ui/touch_control_wire.js:2263` — *engine-surface* — verification: **CONFIRMED**

**What.** openControlSocket registers 'open', 'close' and 'error' handlers and no 'message' handler (lines 2268-2281). The engine sends the panel four things it therefore never reads: touchControlHelloAck, touchControlArmedAck (api_server.js:11571,11590), touchControlRejected (11564,11582) and — the important one — `broadcastWs({ type: 'armRevert', why, ownerId })` fired by revertToAutomaticShow (api_server.js:4457). A 15-second link stall (ARM_LEASE_MS defaults to 15_000, api_server.js:11485-11495) expires the lease and runs the full revert: source lock released, effect scope and parks cleared, audio bindings dropped, the owner's paint released, the default playlist loaded and the deck autopilot forced ACTIVE (api_server.js:4393-4455). When the socket comes back the panel's `state.armed` is still true, so the 2 s poll resumes reconcileEffects (line 2350), the 5 s loop resumes re-PUTting every group in `painted` (lines 1827-1833), and the reconnect re-declares armed (line 2274) — but nothing re-runs takeControl, so the source lock is NOT retaken and both autopilots are now ON and fighting the panel.

**Why it matters.** After a wifi blip the operator has a panel that says ARMED, a ship running the automatic playlist, and a slow drizzle of group paint landing on top of it. The panel believes it holds a takeover it no longer holds. Worse for the ratchet fix: priorAutopilot still holds the pre-arm capture from the FIRST arm, so a later clean disarm writes that back over a state the engine has since changed. The engine deliberately broadcasts armRevert to tell the panel this happened; the panel discards it.

**Fix.** Add a message handler on controlWs that, on armRevert for this OWNER, forces the panel out of the armed state (clear state.armed, clear `painted`, clear priorAutopilot/priorColorAutopilot so the ratchet guard applies, repaint the ARM button) and says so on screen.

### HIGH-7. Arm fade-up hangs off an unbounded chain of concurrent requests — a hung request leaves the ship black with a live panel and an inert deadman

`docs/ui/touch_control_wire.js:516` — *recent-work* — verification: **OVERSTATED**

**What.** `takeControl()` fades the ship to 0 (line 283) and the ONLY thing that raises it again is `armFadeTo(1, ARM_FADE_MS)` at line 516, which is chained behind `buildEffectSlots() → pushPalette() → pushEffectColours() → reconcileEffects() → applyStatic()`. That chain is NOT covered by the arm deadline: the `Promise.race` at line 462 races only `armStep` (takeControl/releaseControl), and the assertion chain at 488-517 runs AFTER the race resolves, with no timer of its own. `req()` (lines 92-106) uses bare `fetch` with no AbortController and no timeout, so a request that never settles never rejects. `buildEffectSlots()` fires `Promise.all(cells.map(provisionCell))` at line 1278 — 24 concurrent PATCHes (24 `.fx-cell` nodes in docs/ui/touch_control.html) — which is precisely the burst this same file documents as MEASURED-hanging at lines 319-325 ("fired concurrently, all five of these POSTs hung with no response and takeControl's promise never settled"). If one of those 24 hangs, `armFade` stays at 0 forever.

**Why it matters.** The Titanic is fully black (IntensityController.apply multiplies every channel of every pixel by armFade, and it deliberately ignores the ignoreDimmer bypasses and LOCK/parked groups), while the panel header still reads ARMED. The deadman cannot save it: the /ws/control socket is alive, so pongs keep renewing the lease (api_server.js:11650-11653) and no revert ever fires. Nothing on /status shows armFade. Recovery requires a second operator on CaptainPad pressing PANIC, or a hand-issued GET /arm-fade — i.e. the ship stays dark until a human on another device happens to know about this specific scalar.

**Fix.** Put the fade-up on a wall-clock guarantee that cannot be defeated by a hung fetch: either (a) give `req()` an AbortController timeout so every request settles, and/or (b) fire a `setTimeout` at arm time that unconditionally POSTs /arm-fade {target:1} after a hard ceiling, cancelled only when the real fade-up lands. Better still, make the engine own it: have POST /arm-fade accept a `deadmanMs` after which the engine itself ramps back to 1 unless the panel re-asserts — the same reasoning that already put the ramp engine-side.

### HIGH-8. Disarm has the same unguarded window, and its own Promise.all of six concurrent writes is the documented hang pattern

`docs/ui/touch_control_wire.js:360` — *recent-work* — verification: **CONFIRMED**

**What.** `releaseControl()` fades to 0 at line 352, waits, then calls `releaseControlBody()`, whose first act is `Promise.all([...])` of SIX concurrent requests (audio-bindings/clear, PUT /effect-groups, PUT /parked-groups, POST source-lock, POST /autopilot, POST /deck/color-autopilot) at lines 360-399. The unconditional `armFadeTo(1, 0)` at line 426 sits at the end of that chain. `Promise.all` never settles if any member hangs, and none of the six has a per-request catch, so the fade-up is unreachable. This is the exact concurrency shape the arm path was rewritten to avoid — line 319 says "ONE AT A TIME, not Promise.all. MEASURED: fired concurrently, all five of these POSTs hung".

**Why it matters.** The ship is left at armFade 0 with the panel showing DISARMED. The `touchControlArmed:false` release at line 434 also never fires, so the lease is still held — which is the one mercy here: if the tab then dies the deadman reverts and lights the ship. But a panel that stays open with a hung chain leaves the Titanic black indefinitely, and the operator's mental model ("I disarmed, the blackout is on, that is why it is dark") makes it very unlikely they will look at GET /arm-fade.

**Fix.** Serialise releaseControlBody's six writes the same way takeControl was serialised, give each a `.catch`, and hoist the `armFadeTo(1, 0)` reset so it is fired on a timer independent of the handback chain.

### HIGH-9. Section dimmers are a fourth independent path to a dark ship, and no failsafe covers them — not the deadman revert, not PANIC, not the boot guards

`marsin_engine/lib/api_server.js:4393` — *recent-work* — verification: **CONFIRMED**

**What.** The revert's step 1 comment says "Blackout off, grand master up, arm envelope released. All three, because they are three independent ways to be dark and the panel drives all three." There is a fourth: `IntensityController.sectionBrightness`. The touch panel writes it for every group (touch_control_wire.js:1092 sends brightness 0 for any group whose POWER is off; 989 POSTs /section-brightness), the route persists it under the group's stable name (api_server.js:6014-6017), state_manager.js:465-486 restores it verbatim at boot with no zero-guard, and the only mutator in the whole engine is that one route (`setSectionBrightness` has exactly one caller). `revertToAutomaticShow` does not touch it, `/mixer/panic`'s `forceLit` (8385-8400) does not touch it, and `panicToSafeDefault` (pattern_mixer.js:1416-1445) has no access to it.

**Why it matters.** A panel that pulled the groups down (README.md:214 documents "All groups off means ZERO light, regardless of where the master fader is") and then died leaves a dark ship that survives the deadman revert, survives the operator's PANIC e-stop — which answers `rigLit: true` over a black rig, the exact failure the arm-envelope note at 8388-8393 was added to prevent — and survives every reboot, because the boot guards only cover `blackout` and a zero grand master. Recovery is the CaptainPad Dimmer Rack or 24 hand-issued POSTs.

**Fix.** Add a dimmer reset to both `forceLit()` and the revert's step 1 (clear `sectionBrightness` entirely, or floor every entry), and give the boot restore the same all-zero guard the grand master got at api_server.js:3097.

### HIGH-10. The strobe tempo lock is unreachable: it is gated on signals.audioPresent, which engine.js hard-codes to false

`marsin_engine/engine.js:869` — *recent-work* — verification: **CONFIRMED**

**What.** The signals bag assembled once per frame in the render loop sets `audioPresent: false` as a literal and nothing ever sets it true — it appears in only two places in the engine (engine.js:869 and the guard that reads it). The strobe's tempo lock reads `const phaseLock = this.strobeConfig.phaseLock || this.isTempoLocked(this.strobeConfig.slotId); if (phaseLock && signals.audioPresent) { ... }` (global_effects_controller.js:1027-1035), so the phase-offset branch can never execute in the running engine. Meanwhile `audioDrivenPrimary` correctly returns the base for a tempo-locked slot (1671-1679), so the depth ride is removed.

**Why it matters.** 'strobe' is the first entry in the panel's `TEMPO_CAPABLE_FX` list (touch_control_wire.js:1899). An operator who binds BPM to the strobe expecting it to land on the downbeat gets: no phase lock (dead branch) and no depth ride (correctly suppressed) — i.e. the binding does nothing at all, silently. The pre-existing `strobeConfig.phaseLock` opt-in is dead for the same reason. One of the five advertised tempo-locked effects is entirely inert.

**Fix.** Either set `audioPresent` truthfully from the Companion/OSC state, or — since `bpmPulse` is explicitly the synthetic source that "always exists" with no audio at all (engine.js:895-898) — gate the strobe phase lock on the tempo grid being valid (`tempoBpm > 0`) rather than on audio being present.

### HIGH-11. Tempo-locked breath and movement trace lock to a hard-coded 120 BPM: signals.bpm is never populated

`marsin_engine/engine.js:866` — *recent-work* — verification: **CONFIRMED**

**What.** The signals bag built at engine.js:866-873 and passed verbatim to `applyMacros` (lines 951-955 and 984) contains beatPhase, barPhase, audioPresent, micHigh, kick and dropPulse — there is NO `bpm` key. Two of the tempo-lock consumers read exactly that key: ocean breath computes `const bpm = signals && typeof signals.bpm === 'number' && signals.bpm > 0 ? signals.bpm : 120;` then `tempoSyncFor(slotId, (16*60000)/bpm, ...)` (global_effects_controller.js:360-363), and movement trace does `const bpm = typeof signals.bpm === 'number' && signals.bpm > 0 ? signals.bpm : 120; advance = dt * (bpm/60) * m.pixelsPerBeat;` (715-716). Both therefore always take the 120 fallback.

**Why it matters.** Two of the five advertised tempo-locked effects lock to a fixed 120 BPM instead of to the show's tempo. The engine's own comment (engine.js:856-857) says the arbitrated tempo "auto-follows off the live DJ BPM", so at any real set tempo the breath period and the trace travel speed are simply wrong and drift against the music — which reads to the operator as the tempo lock not working. It is invisible in testing today only because mixer_state.yaml:35 happens to hold `tempoBpm: 120`. By contrast the waterline sweep is genuinely correct, because it uses `signals.barPhase`, which IS derived from `mixer.tempoBpm` (engine.js:863-868).

**Fix.** Add `bpm: tempoBpm` to the signals object in engine.js alongside beatPhase/barPhase — it is already computed on line 863.

### HIGH-12. The panel latches the FOGGER through the no-deadman endpoint, revert never clears it, and a latched fogger is persisted and restored at boot

`docs/ui/touch_control_wire.js:1392` — *effects-integration* — verification: **CONFIRMED**

**What.** The HAZE button drives `POST /global-effect {effect:'fogger', state}`. The engine documents that route as a LATCH and provides `POST /fog` with a deadman specifically because of this (api_server.js:6137-6140: "Plain `/global-effect {effect:'fogger'}` is a LATCH — it would leave a fog machine running until someone noticed. On a fogger that is a real-world problem"). Three compounding gaps: (1) the panel never calls /fog; (2) `revertToAutomaticShow()` (api_server.js:4373-4457) has six steps — light, source-lock, scope, audio-bindings, paint, playlist/autopilot — and NONE of them deactivates a global effect, so a dead panel leaves the fogger on; (3) `POST /global-effect` writes `globalsState.effects[effect]` and saves (api_server.js:6117-6119), and `applyGlobalsState` restores every entry at boot (state_manager.js:452-463) with NO guard, unlike the explicit blackout guard three lines above it (state_manager.js:445-449).

**Why it matters.** Operator latches HAZE, walks away or the iPad's tab dies. The 15 s arm-lease deadman fires, the show reverts — and the fog machine keeps running. If the engine then crashes, the crash-boot policy reverts the playlist (api_server.js:11143) but `globals_state.yaml` still says `fogger: true` and the boot restore turns it back on before anyone is in the room. Only a manual HAZE tap, a CaptainPad action, or `panicStop()` stops it.

**Fix.** Route the fogger cell through `POST /fog {state:true, holdMs}` refreshed while the button is lit, and `{state:false}` on release — the deadman the engine already built. Add a fogger step to `revertToAutomaticShow` (and to the arm-lease expiry path). Add a boot guard in `applyGlobalsState` that refuses to restore `effects.fogger === true`, mirroring the blackout guard already at state_manager.js:445.

### HIGH-13. Section dimmers are a persisted, whole-ship dark path that NO failsafe clears — not panic, not the deadman revert, not the crash-boot policy, not the boot guards

`marsin_engine/lib/api_server.js:6016` — *safety-failure* — verification: **OVERSTATED**

**What.** The panel's 24 group faders and its ALL OFF button write POST /section-brightness (docs/ui/touch_control_wire.js:989, reached from pushAllGroupLevels -> pushGroup -> queueGroup on every groupmodeschange, wire:1092 and 1022). ALL OFF toggles every non-locked strip off (touch_control.html:3073-3086) and publishes, so all 24 groups go to brightness 0 in one flush (wire:1032 flushGroups(true)). The endpoint writes globalsState.dimmers[groupName] and saves. IntensityController.apply then multiplies every pixel of those sections by 0 (intensity_controller.js:152-163). Three independent facts make this unrecoverable-by-failsafe: (1) POST /section-brightness is the ONLY writer of setSectionBrightness in the whole engine besides the boot restore — verified by grep, only api_server.js:6014, state_manager.js:477 and :479 call it; there is no bulk reset and no clear; (2) neither forceLit() in POST /mixer/panic (api_server.js:8385-8400: blackout, armFade, master, targetViewFader only) nor revertToAutomaticShow step 1 (api_server.js:4393-4403: blackout, armFade, master only) touches a section dimmer, so the e-stop answers rigLit:true over a completely black ship; (3) applyGlobalsState restores dimmers verbatim with NO zero-guard (state_manager.js:465-485), unlike the explicit zero-guards written for blackout (state_manager.js:445) and for the grand master (api_server.js:3097). On top of that the panel never reads the real values back — state.dimmers is fetched at wire:140 and referenced nowhere else (grep: single hit) — and pushAllGroupLevels is NOT in armAsserts, so after a restart the faders show 100% while the engine holds 0.

**Why it matters.** An operator who taps ALL OFF (or drags groups down) and then loses the engine has written a full blackout into globals_state.yaml that survives every reboot. On the next start the ship comes up dark, the crash-boot revert runs and reports the ship lit, POST /mixer/panic returns rigLit:true, and the touch panel's own faders read 100%. Every failsafe in the system says the Titanic is lit while it is black. Recovery exists only through a different app (CaptainPad's Dimmer Rack, CaptainPad/app/(tabs)/dimmer_rack.tsx:358) or by hand-editing YAML.

**Fix.** Add a dimmer step to BOTH forceLit() and revertToAutomaticShow(): clear intensityController.sectionBrightness (and globalsState.dimmers) to 1.0 for every group, log it loudly. Add a boot guard mirroring the blackout/master guards: refuse to restore a dimmer set in which every known group is 0 (or clamp any restored 0 to a visible floor), warning loudly. Separately, have the panel seed its fader positions from GET /dimmers on refresh so it can never show 100% over a dark rig, and add pushAllGroupLevels to armAsserts.

### HIGH-14. A clean DISARM blacks the ship out and nothing ever brings it back

`docs/ui/touch_control_wire.js:417` — *safety-failure* — verification: **OVERSTATED**

**What.** releaseControlBody() ends its handback by asserting a global blackout. POST /global-blackout sets intensityController.blackoutActive and persists globalsState.blackout = true (api_server.js:6026-6028). The autopilots are restored just above (wire:391-399) but produce nothing, because IntensityController.apply zeroes every channel of every pixel before the blackout early-return (intensity_controller.js:104-114), and applyDmx additionally forces fogger/horn/fire off. Nothing in the panel, the engine, or the deadman clears it afterwards: the arm lease is released cleanly right after (wire:434 -> armLeaseClear at api_server.js:11589), which deliberately does NOT run revertToAutomaticShow. So the documented, intended end-of-session action leaves the exterior dark indefinitely.

**Why it matters.** The mission rule is that the Titanic is visible at night. The failure modes are inverted: if the panel DIES the engine lights the ship and starts the automatic show (revertToAutomaticShow), but if the operator disarms it PROPERLY the ship goes black and stays black until a human clears the blackout from another surface or restarts the engine. An operator who arms the panel, plays for ten minutes, disarms, and walks away has darkened the ship, and every guard listed in docs/ui/README.md §6 is silent about it because they only protect the boot path.

**Fix.** Disarm should hand the ship back to the automatic show LIT, not black — replace the terminal /global-blackout {state:true} with the same sequence revertToAutomaticShow() uses (blackout off, master up, armFade to 1, autopilots on). If a dark disarm is genuinely wanted it must be an explicit, separate operator action with its own confirmation, never the default exit path.

### HIGH-15. Any /ws/control reconnect while armed instantly reverts the whole rig — the ping/pong grace period is bypassed on the close path

`marsin_engine/lib/api_server.js:11665` — *safety-failure* — verification: **CONFIRMED**

**What.** The arm lease was deliberately built on WS ping/pong with a 15 s window (ARM_LEASE_MS, api_server.js:4485-4497) precisely so a backgrounded or throttled iPad would not have the show yanked away — the design note at api_server.js:4478-4484 says so explicitly. But the socket 'close' handler bypasses that window entirely: if the lease exists it deletes it and runs revertToAutomaticShow() immediately, with no grace, no re-connect window and no check of whether the same ownerId comes back. The panel's own socket auto-reconnects after 2 s on every close (wire:2276-2279), so a single wifi blip, an iOS app-suspend that drops the TCP socket, or an engine WS hiccup produces: full revert (blackout off, source lock released, effect scope cleared, all groups unparked, audio bindings cleared, the owner's paint released, the default playlist force-loaded, autopilot forced ON) while the operator is still holding an ARMED panel. On reconnect the panel only re-sends touchControlArmed (wire:2274); armAsserts run only on an ARM button click, so nothing re-applies the operator's look.

**Why it matters.** On playa wifi this will fire repeatedly. Mid-performance the ship jumps to the default automatic playlist, the panel still says ARMED, and panel and rig are silently divergent — the operator's subsequent writes land on top of an automatic show they did not ask for. It is also the exact scenario the deadman's ping/pong design claims to protect against, so the safety property the code documents does not hold.

**Fix.** On close, do not revert immediately: mark the lease as orphaned and let the existing expiry sweep decide after ARM_LEASE_MS, so a reconnect that re-declares the same ownerId inside the window simply re-attaches (armLeaseSet already replaces the entry). Keep the immediate release for the touch-paint lease if wanted, but the arm revert must respect the grace window. Also have the panel re-run armAsserts after a reconnect while armed.

### HIGH-16. A dead audio companion is indistinguishable from a live one — bindings freeze on the last sample, and a level binding frozen near zero holds its group dark

`marsin_engine/lib/modulation_engine.js:212` — *safety-failure* — verification: **CONFIRMED**

**What.** audio_bindings.js documents (lines 29-32) that a missing source is REPORTED rather than treated as zero, and evaluate() only counts a source missing when the key is absent or non-finite (audio_bindings.js:158-172). But the values it is handed come from resolveModulationSources(paramCenterSnapshot) (engine.js:894), which simply copies every finite number currently sitting in the param centre. The mic bands are written into the param centre by the analyser's onAnalysis callback (engine.js:2150 paramCenter.setMany(micWrites, 'audio', 'audio:mic')); when the analyser or the Companion stops, those keys are not removed and not zeroed — they just stop being updated. So the binding sees a present, finite, STALE value and rides it forever. GET /audio-sources reports liveness the same way — `live: Object.prototype.hasOwnProperty.call(snapshot, e.key)` (api_server.js:7090) — with no recency check, so the panel's LIVE dots keep saying live.

**Why it matters.** The whole missing-source safety net never fires for the failure it was written for. Worse, group bindings are a multiplier applied to every pixel of the group after the paint (global_effects_controller.js:1604-1611): a group bound in level mode at depth 1 has gain = value, so if the companion dies during a quiet moment the group freezes at gain ~0 and that part of the ship stays dark indefinitely with no error anywhere. Effect bindings freeze their magnitude the same way. Nothing times out, nothing logs.

**Fix.** Stamp a lastWriteMs per audio source in the param centre (setMany already knows the source tag 'audio:mic'), and have resolveModulationSources / audio_bindings drop any key older than a staleness window (a couple of seconds). Then the existing missing-source path fires: gain 1, target left alone, missingSources populated, and /audio-sources can report live:false honestly so the panel's meters and dots tell the truth.

---

## MEDIUM (26)

### MEDIUM-1. The deadman stamp is fire-and-forget and can silently no-op, then the ship is faded to black anyway

`docs/ui/touch_control_wire.js:282` — *arm-lifecycle* — verification: **OVERSTATED**

**What.** takeControl's first statement declares the deadman, and its comment (278-281) makes it a hard guarantee: 'THE DEADMAN MUST EXIST BEFORE ANYTHING CAN TAKE THE SHIP TO BLACK.' But sendControl returns false and does nothing when the socket is not open (2258-2261), and line 282 ignores the return value. Line 283 then fades the ship to 0 regardless. There is also no 'message' listener registered on controlWs at all — openControlSocket adds only 'open', 'close' and 'error' (2268-2280) — so the engine's `touchControlArmedAck` and `touchControlRejected` replies (api_server.js:11590-11592, 11582-11584) are never read. The panel therefore has no confirmation, ever, that a lease exists. The reachable window is the WS reconnect gap: the socket retries every 2000 ms (2278), so after any engine restart or wifi blip there is up to a 2 s period in which REST is reachable and the WS is not.

**Why it matters.** Arm inside that window and the ship goes to black with no deadman. If the iPad then dies during the fade or anywhere in the takeover, nothing reverts and the ship stays dark. That is the exact failure the stamp was placed first to prevent, defeated by an unchecked return value. Secondarily, even when the socket is open, the WS frame and the HTTP POST travel on different connections with no ordering guarantee, so the claimed 'before' is best-effort.

**Fix.** Make the stamp a gate: add a 'message' listener that resolves on touchControlArmedAck, and have takeControl await that ack (with a short timeout) before issuing the fade-out. If no ack arrives, fail the arm loudly and do not take the ship to black — or arm without the fade, which is ugly but lit.

### MEDIUM-2. Overlay faders zeroed on arm are persisted and are restored by nothing except a clean disarm

`docs/ui/touch_control_wire.js:240` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** silenceOverlays PATCHes every non-deck mixer channel to fader 0 (238-242) after stashing the prior values in the page-local `priorOverlayFaders` (227, 235). PATCH /mixer/channels/:id persists via saveAllState() (api_server.js:8745). The only restore path is restoreOverlays() (246-254), called from releaseControlBody:401. The pagehide handler (526-547) does not restore them, and revertToAutomaticShow does not either — its six steps (api_server.js:4390-4455) light the ship, open the source lock, unrestrict scope/parked, clear audio bindings, release paint and force the default playlist; there is no mixer-channel fader restore anywhere in it.

**Why it matters.** Close the tab while armed, or lose the iPad, and every overlay channel stays at fader 0 on disk — through the revert, through the crash boot policy, and through every subsequent engine restart. The 'automatic show' the revert forces back on then runs with its overlay layers permanently muted, and nothing on the touch panel can explain or fix it. The same class of invisible-overlay problem is what the MEASURED note at 218-221 was written about, only inverted.

**Fix.** Stash priorOverlayFaders on the ENGINE at arm time (a small 'panel handback snapshot' keyed by ownerId) so revertToAutomaticShow can restore it as step 7, and add a keepalive restore burst to the pagehide handler.

### MEDIUM-3. Effect preset colours overwritten on arm persist and are restored only by a clean disarm

`docs/ui/touch_control_wire.js:718` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** pushEffectColours PATCHes `/global-effect-slots/:id { paramsOverride }` for every colour-capable slot from OURS_FROM up, writing the panel's palette over the preset's own colour (702-719). The comment at 687-689 states the PATCH persists and that 'the preset's original colour is put back on disarm'. restoreEffectColours (723-736) is the only thing that does that, and it is called from exactly one place: releaseControlBody:415. It is not in the pagehide handler (526-547) and not in revertToAutomaticShow (api_server.js:4390-4455).

**Why it matters.** A tab close, force-quit, wifi loss or engine crash while armed permanently repaints 'ocean blue' and 'emergency red' with whatever the wheel happened to be on — for every future session, on disk. The next operator picks a named preset and gets last night's palette, with nothing in the UI indicating why.

**Fix.** Same shape as the overlay fix: hand the presetOverride snapshot to the engine at arm time so the revert can undo it, or write the panel's colours as a non-persisted live override layer rather than a persisting PATCH.

### MEDIUM-4. The 2 s poll fires concurrent engine traffic straight through the arm window that takeControl serialises itself to avoid

`docs/ui/touch_control_wire.js:2344` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** state.armed is set true at 444, before takeControl() is even called at 452. The 2000 ms interval at 2344-2351 therefore runs throughout the entire arm sequence: refresh() (130-157) issues four GETs via Promise.all, and `if (state.armed) reconcileEffects()` (2350) can issue write()s to /global-effect-slots/:id/press. takeControl explicitly refuses to batch its own calls for exactly this reason — the comments at 228-232 and 319-325 record that concurrent browser→engine writes were MEASURED to hang with no response, and that this is what made takeControl's promise never settle.

**Why it matters.** The arm sequence takes at minimum 1.5 s of fade plus ~10 sequential round trips, so at least two, usually three, poll ticks land inside it. Every one of them injects the burst-concurrency the sequence is built to avoid, which is the documented cause of the hang the 9.5 s deadline exists to paper over. reconcileEffects can also press effects on before takeControl's own disable-all (339) lands, silently undoing the operator's selection.

**Fix.** Add an `armInFlight` flag set for the duration of takeControl/releaseControl and have the poll early-return while it is set. Also stop setting state.armed=true before the takeover completes, or split it into `armIntent` (UI truth) and `armed` (rig truth).

### MEDIUM-5. The source lock does not lock CaptainPad out of anything — the panel and CaptainPad write the same six params through the same 'api' channel, unarbitrated

`marsin_engine/lib/api_server.js:8940` — *engine-surface* — verification: **OVERSTATED**

**What.** takeControl sets `mode: 'per-param'` with all six leases pointing at the string `'api'` (touch_control_wire.js:326-333). _checkSourceLock rejects only when `leaseOwner !== source` (param_center.js:1004-1008). REST POST /param-center hardcodes source `'api'` (api_server.js:8940 `paramCenter.set(k, data[k], 'api')`). CaptainPad's ONLY CPC write path is that same REST route — `updateParamCenter` POSTs /param-center (CaptainPad/utils/api.ts:900-912) and CPCControls funnels every knob through it (CPCControls.tsx:220-225 `const update = (key, val) => { if (disabled) return; updateParamCenter({ [key]: val }); }`). CaptainPad never sends the WS `setSharedParam` message that WOULD be rejected: the only occurrence of that string in the whole CaptainPad tree is a comment (engineParamsEvents.ts:27), and that file states the params socket has no inbound writer at all (lines 25-28). So the lease is a lease from 'api' to 'api': CaptainPad's colour, speed, rotate and transition writes sail straight through an armed panel's lock.

**Why it matters.** The operator asked exactly this question — 'when TOUCH is armed I want to know what control it has' — and the answer the manual gives is wrong in the dangerous direction. docs/ui/README.md:122-126 tells the operator 'While Touch Control is ARMED, CaptainPad loses some control... CaptainPad's colour and speed controls will appear to do nothing on those six params until Touch Control disarms', and the troubleshooting table repeats it (README.md:294). In fact both surfaces are live on the same six params with last-writer-wins and no feedback on either side. Two people on two iPads will fight over the palette with each believing the other is locked out, and the documented diagnosis ('disarm Touch Control') fixes nothing. The lock DOES work against the autopilots, the timeline, OSC and bpm-sync — which is real value — but it is not the CaptainPad exclusivity the manual promises.

**Fix.** Either lease to a per-session owner token the panel sends on every write (e.g. an `X-Param-Source` header POST /param-center honours), or stop claiming exclusivity: correct README.md:122-132 to say plainly that CaptainPad is NOT locked out and that the two surfaces must be coordinated by people, not by the engine.

### MEDIUM-6. The panel's only error surface is a DOM element that is never attached — every failure the wire is designed to report is invisible to the operator

`docs/ui/touch_control_wire.js:64` — *engine-surface* — verification: **OVERSTATED**

**What.** The status pill is created and fully styled (lines 57-63) and then deliberately not attached: `pill.dataset.headless = '1';` with the comment 'NOT ATTACHED... The element is still BUILT and still written to, so every setStatus()/fail() call keeps working and an error still lands in the console - it just no longer covers the panel.' Grep across touch_control_wire.js and touch_control.html finds no appendChild of it and no #wireStatus in the page. So fail() (lines 84-88) reduces to a console.error. The panel is served into an iframe inside CaptainPad on an iPad (CaptainPad/app/(tabs)/touch_control.tsx:1-19) where there is no console. Things that therefore vanish silently: the arm-setup timeout ('setup did not finish in 9.5s — asserting the panel state anyway', line 465); every write() failure (line 112); the stale-lock warning that says a previous panel died (lines 313-315); 'no pre-arm autopilot state was captured' (lines 394-395); 'no sectionId for <group>' (line 1089); every audio-binding and effect-scope failure.

**Why it matters.** The file's stated design rule #1 is 'NO FALLBACK BEHAVIOURS... Every request that fails is surfaced in the status pill and logged. Nothing silently degrades' (lines 7-9). With the pill detached, the second half is all that is left, and it reaches nobody. The panel can be armed, have had its takeover time out, have landed none of its assertions, and look completely normal. That is precisely the class of failure the rest of this file was rewritten to eliminate, reintroduced by a cosmetic change.

**Fix.** Keep the pill out of the way when clean, but attach it and show it on error only — e.g. append to body and set display:none unless state.lastError is set. An armed operator must be able to see that a write was refused without a laptop.

### MEDIUM-7. A DISARMED panel can darken groups of the ship through the audio-binding dropdowns, contradicting the panel's central safety promise

`docs/ui/touch_control_wire.js:2027` — *engine-surface* — verification: **OVERSTATED**

**What.** The audio dropdowns are written with req(), not write(), so they land while disarmed — for effect rows (line 1941 `req('PUT', path, body)`) and for group faders (line 2027 `req('PUT', '/audio-bindings/groups/' + ..., body)`), with the body `{ sources: list, mode: 'level', depth: 1 }` (line 2026). The justification given is 'Binding is a rig-wide routing decision, not a look... What the binding DOES still only happens while an effect is running or a group is lit' (lines 1862-1865). That last clause is false for the `groups` scope. GlobalEffectsController.applyAudioGroupGains runs every frame and multiplies every pixel of a bound group by the gain unconditionally: `const g = gains[px.group]; if (g === undefined || g === 1) continue; px.r *= g; px.g *= g; ...` (global_effects_controller.js:1604-1611). In level mode the gain IS the signal — audio_bindings.js:176 `out[scope][id] = b.mode === 'hit' ? this._hitGain(...) : 1 - b.depth + b.depth * v;` which at depth 1 is exactly `v`. The only safety is 'no signal arriving at all' → gain 1 (audio_bindings.js:167-171); a mic that IS publishing but quiet gives v≈0 and the group goes to black.

**Why it matters.** The panel's headline contract — 'NOTHING WRITES UNTIL ARMED. The rig is a real installation... opening this page cannot change the show' (lines 11-13), repeated to the operator as 'Nothing this panel does reaches the rig until you ARM it... none of it leaves the tab. That is the safety, not a courtesy' (README.md:75-77) — is not true. Someone exploring the surface with the panel disarmed can pick a stem on a group fader and take that section of the exterior to near-black during quiet passages, with no ARM, no visible state change on the fader, and no error. It is recoverable (blank the dropdown, or close the tab — pagehide clears the bindings, lines 544-546), but the operator has no reason to look there because the panel says it is disarmed.

**Fix.** Gate the `groups` scope bindings behind write() like the effect scope and the parked groups already are (both were moved for exactly this reason, lines 1058-1065 and 2057-2059), and re-assert them on arm via the existing armAsserts hook — pushAllAudioBindings already does that (line 913).

### MEDIUM-8. Arming permanently deletes every persisted group fixed colour and permanently rewrites effect slots 9-32 on disk; disarm restores neither

`marsin_engine/lib/api_server.js:5964` — *engine-surface* — verification: **CONFIRMED**

**What.** Two irreversible writes ride the arm sequence. (a) GROUP PAINT: applyStatic writes leased paint with an ownerId (touch_control_wire.js:1797-1798), and a leased PUT deletes any persisted entry for that group and saves: `if (ownerId) { touchPaintLeaseSet(group, ownerId); if (globalsState.groupFixedColors) delete globalsState.groupFixedColors[group]; saveGlobals(false); }` (api_server.js:5964-5967). desiredStatic paints every powered group when no effect is chosen (touch_control_wire.js:1703-1747), so one arm wipes the whole persisted groupFixedColors map — the map that applyGlobalsState restores at boot (state_manager.js:496-503) and that CaptainPad's own API documents as 'a PERMANENT, persisted override (the pre-existing behaviour that saved operator looks depend on)' (CaptainPad/utils/api.ts:596-599). Disarm only DELETEs (touch_control_wire.js:1813-1815, 406-408); nothing restores. (b) EFFECT SLOTS: provisionCell PATCHes slots 9..32 with new effectId/presetId/label/behavior (touch_control_wire.js:1226-1262) and buildEffectSlots disables any slot in that range the grid does not claim (lines 1272-1277). PATCH /global-effect-slots/:id persists on every call (api_server.js:6467-6468 `patchSlot(...); persistGlobalEffectSlots();`). Disarm restores only paramsOverride (restoreEffectColours, lines 723-736) — never the binding, label or behavior.

**Why it matters.** Arming the touch panel once silently destroys two categories of saved operator work that the rest of the system treats as durable: the saved per-group colours in globals_state.yaml, and CaptainPad's / the VSN1's effect bank layout for slots 9-32 in global_effect_slots.yaml. Neither loss is announced, neither is reversible from any surface, and both survive restart. The panel's own comments show the author reasoned carefully about restoring effect COLOURS on disarm (lines 686-693) but not about the bindings underneath them.

**Fix.** Snapshot GET /global-effect-slots and GET /group-fixed-colors at arm time (loadSlots already reads the former into presetOverride — extend it to the full slot record) and re-PATCH the originals on disarm, the same way restoreOverlays and restoreEffectColours already do for their own domains.

### MEDIUM-9. Overlay silencing is one-shot, blind to deck overlays, and never restored by any engine recovery path — a silenced overlay is sitting at fader 0 on the live engine right now

`docs/ui/touch_control_wire.js:225` — *engine-surface* — verification: **CONFIRMED**

**What.** Four separate gaps in the overlay handling. (1) ONE-SHOT: silenceOverlays runs only inside takeControl (line 340); a mixer channel added while armed (CaptainPad POST /mixer/channels) is never silenced and is not in priorOverlayFaders, so it blend_screens over the deck for the rest of the session with nothing on the panel able to explain it — the exact 'golden_hour_wash turned my green yellow' failure the function was written for (lines 215-224). (2) ID CHANGE: restoreOverlays PATCHes captured ids and swallows every failure — `.catch(function () {})` (line 250) — so a channel deleted and recreated while armed (new `ch_<timestamp>` id) is silently never restored. (3) DECK OVERLAYS ARE INVISIBLE TO IT: it reads `m.channels` from GET /mixer, which serialises `mixer.getMixerChannels()` (api_server.js:3679), and that returns `this.mixerChannels` (pattern_mixer.js:979-981) — a DIFFERENT array from `this.deckOverlays` (pattern_mixer.js:276), which composite into the deck buffer (pattern_mixer.js:271-275). Deck overlays are never silenced. (4) NO ENGINE RESTORE: revertToAutomaticShow's six steps never restore overlay faders (api_server.js:4386-4456), so a panel that dies while armed leaves them at 0 permanently, and mixer_state.yaml persists that.

**Why it matters.** Gap 4 is not theoretical — it is the current state of the machine. On the running engine, GET /mixer returns `master 1, blackout false, ch_1785801995942_0 00_golden_hour_wash fader 0`, with GET /param-center showing `sourceLock: null` and GET /arm-fade showing `armFade: 1`. No panel is armed, and an overlay is still muted from a session that ended. mixer_state.yaml:6 has `fader: 0` on disk. Gap 3 means the panel can still be surprised by a layer it cannot see or reach, which is the whole thing silenceOverlays exists to prevent.

**Fix.** Include GET /deck/overlays in silenceOverlays/restoreOverlays; re-run the silencing when the 2 s poll sees an uncaptured non-deck channel above 0; and add an overlay-fader restore step to revertToAutomaticShow (panicToSafeDefault already forces overlays to 1.0 at pattern_mixer.js:1426-1430 — revert should do at least that much).

### MEDIUM-10. While armed, the 2-second poll switches off any effect CaptainPad or the VSN1 starts — including the hardware's own slots 1-8 — and disarm leaves them all off

`docs/ui/touch_control_wire.js:1412` — *engine-surface* — verification: **CONFIRMED**

**What.** reconcileEffects presses OFF every slot the engine reports running that the panel's grid does not claim, explicitly including slots 1-8 which belong to the Deck and the VSN1: `Object.keys(on).forEach(function (id) { if (want[id] || slotBehavior[id] === 'trigger') return; pressOnce(id); });` with the comment 'Anything RUNNING that this grid does not claim gets switched off — including slots 1-8' (lines 1407-1415). It runs on every 2 s poll tick while armed (line 2350). Disarm then sends POST /global-effects/disable-all (line 412), which turns off everything and persists it (api_server.js:6627-6628 `disableAll(...); persistGlobalEffectSlots();`), with no restore of what slots 1-8 were doing before the panel armed.

**Why it matters.** A CaptainPad operator or someone on the VSN1 hardware panel presses an effect, sees it light, and watches it die within two seconds with no explanation on their surface. This is a deliberate design choice ('While armed the panel owns the rig') and it is defensible — but it is also invisible from the other side, it is not in the README's list of what CaptainPad loses (README.md:81-88 mentions the source lock, autopilots, overlays and blackout, not effect suppression), and it does not hand back: after disarm the Deck's and VSN1's slots 1-8 stay off until a human re-presses them.

**Fix.** Capture the running set from GET /global-effect-slots/status at arm time and re-press slots 1-8 back to that state on disarm; and document the suppression in README §4 so the CaptainPad operator knows why their effects die.

### MEDIUM-11. Two `moveHandle` functions in the SAME scope — the XY pad's handle and crosshair are dead code and never move

`docs/ui/touch_control.html:1686` — *redundancy* — verification: **CONFIRMED**

**What.** `function moveHandle(e)` (the XY pad version, writes #xyHandle + #guideH/#guideV) is declared at line 1686, and `function moveHandle(c)` (the colour-wheel version, writes #wheelHandle) is declared again at line 2068. Both are function declarations directly inside the SINGLE IIFE that opens at line 1643 and closes at line 3872 — I measured brace/paren depth through a string-and-comment-aware tokenizer and both sit at depth 2, i.e. the same function scope. The later declaration wins for every call site, so the pad's pointerdown (1695) and pointermove (1698) call the WHEEL version with a PointerEvent: `c.rad` / `c.s` / `c.v` are undefined, `rr` is NaN, and `handle.style.left = 'NaN%'` / `background = 'hsl(NaN NaN% NaN%)'` are invalid CSS the CSSOM discards. `var handle` is likewise declared twice (1683 = xyHandle, 2049 = wheelHandle), so the name points at the wheel handle after line 2049 executes.

**Why it matters.** The XY pad gives the operator NO position feedback: the handle stays frozen at its markup position (left:70%;top:35%) and the two guide lines never move, however hard the pad is dragged. The pad still writes to the engine (touch_control_wire.js has its own pointer handlers on #xyPad at 770-800), so the ship responds while the surface shows nothing — in XY MODE the X axis is the RIG MASTER, so the operator is dragging the whole ship's brightness with a control that appears stuck. The pad's own moveHandle (1686-1693) is unreachable dead code.

**Fix.** Rename the pad version to `movePadHandle` and its element var to `padHandle`; leave the wheel pair as-is. Do NOT simply delete 1686-1693 — the pad handle and guides are the only visual feedback the pad has.

### MEDIUM-12. The BPM manual-tempo write path is unreachable: nothing ever writes #bpmVal except the echo-guarded painter, and the +/- stepper has no handler at all

`docs/ui/touch_control_wire.js:856` — *redundancy* — verification: **CONFIRMED**

**What.** The wire installs a MutationObserver on #bpmVal (856-866) that POSTs /mixer/tempo when the readout text changes, guarded by `bpmEcho` so the panel does not echo the engine's own tempo back. But the ONLY writer of `bpmVal.textContent` in either file is `paintTempo()` at line 874, and it sets `bpmEcho = true` on line 873 immediately before writing. The `bpmEcho = false` reset is a `setTimeout(...,0)` (macrotask) while MutationObserver callbacks are microtasks, so the guard always holds. The stepper markup `<span class="stepper"><button>−</button><button>+</button></span>` (touch_control.html:1387) has no click handler anywhere — grep for `stepper` in the page script and in the wire returns only CSS rules and one comment.

**Why it matters.** Tapping the BPM +/- buttons does nothing. That means TAP mode (the wire's own three-state model at 843-849: SYNC / HELD / TAP, selected by tapping #bpmSync) gives the operator a 'manual tempo' they cannot change from this panel. Everything tempo-driven — movementTrace speed, beatPump, the preset auto-advance beat counter — then sits on whatever number the engine last held. Recoverable only from CaptainPad or by tapping back to SYNC. The observer block and the whole `bpmEcho` mechanism are dead weight guarding a path that can never fire.

**Fix.** Either wire the stepper (a click handler on `.bpm-global .stepper button` that nudges bpmVal.textContent, which the existing observer would then pick up), or remove the stepper markup AND the observer + bpmEcho machinery together. Do not remove the observer alone if the stepper is going to be wired.

### MEDIUM-13. The status pill is built, styled and written to on every error — but never attached to the DOM, so the operator has no on-screen error surface

`docs/ui/touch_control_wire.js:57` — *redundancy* — verification: **CONFIRMED**

**What.** `pill` is created at 57, given an id, a 6-line inline stylesheet and `dataset.headless = '1'`, and `setStatus()` writes its textContent and colours from 6 call sites. There is no `appendChild(pill)` anywhere in the wire, and `#wireStatus` does not appear in touch_control.html. So every `fail(...)` call (about 40 of them, including 'take control', 'arm', 'arm master', 'release control', 'group', 'effect groups', 'locked groups') surfaces ONLY via `console.error` on line 86.

**Why it matters.** On an iPad running this panel inside CaptainPad there is no console. A failed arm, a failed master assertion, or 'no sectionId for <group>' is completely invisible to the operator — the panel just silently does less than it says. The file's own design rule #1 at lines 7-9 states the opposite. This is deliberate per the comment at 64-68 (the bubble was covering the surface), but the replacement error surface was never built.

**Fix.** Do NOT delete the pill machinery — it is the only error path. Give the errors a real home: either attach the pill somewhere non-occluding, or route `state.lastError` into the header (there is an unused static `<button class="chip">STATUS <strong>OK</strong></button>` at touch_control.html:1397 that currently always says OK).

### MEDIUM-14. takeControl takes the ship to black without confirming the deadman lease actually reached the engine

`docs/ui/touch_control_wire.js:282` — *recent-work* — verification: **OVERSTATED**

**What.** The comment at 278-281 states the invariant: "THE DEADMAN MUST EXIST BEFORE ANYTHING CAN TAKE THE SHIP TO BLACK." The code declares it with `sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true })` and IGNORES the return value. `sendControl` (lines 2258-2261) returns `false` and sends nothing when `controlWs` is null or not in readyState 1 — no throw, no status-pill error. The very next statement, `armFadeTo(0, ARM_FADE_MS)`, goes over HTTP and succeeds independently of the socket. The reconnect backoff is 2 s (line 2278), and `new WebSocket()` throwing (line 2266) schedules no retry at all.

**Why it matters.** Whenever the /ws/control socket is not open at the moment ARM is pressed — engine just restarted, wifi blip, page loaded before the engine came up, mid-backoff — the engine has no record that a panel armed, and the panel takes the rig to black anyway. If the panel then dies inside the takeover window (which is seconds long: fade 1.5 s + up to 7 sequential round trips + assertions), nothing on the engine knows to revert. The ship is black with no deadman, no lease, and no revert. The stated invariant is asserted in prose and unenforced in code.

**Fix.** Make the fade-out conditional on the declaration landing: if `sendControl` returns false, refuse to arm (or await a `touchControlArmedAck` from the engine, which api_server.js:11590-11592 already sends) before issuing the first armFadeTo(0).

### MEDIUM-15. The deadman has no notion of a second live panel: one panel's tab close reverts the other panel's running show

`marsin_engine/lib/api_server.js:11665` — *recent-work* — verification: **OVERSTATED**

**What.** `armLease` is a Map keyed by ownerId, so two panels hold two independent entries. When panel A's socket closes, the handler at 11655-11671 deletes A's lease and calls `revertToAutomaticShow(...)` unconditionally — there is no check of `armLease.size` or of whether any other owner is still armed. `revertToAutomaticShow` (4373-4458) then releases the param-centre source lock, unrestricts the effect scope, unparks every group, clears ALL audio bindings via `ab.clearAll()` (which is global, not per-owner: audio_bindings.js:125-129), force-loads the 'default' playlist on the deck and switches the deck autopilot on.

**Why it matters.** Panel B is alive, armed and mid-performance. Panel A being closed — or merely losing wifi for 15 s — tears B's show apart: B's colour and speed writes start being arbitrated against the autopilot again, its group scope and parks vanish, its audio bindings are wiped, and the deck jumps to the default playlist. B's UI shows none of this. The panel will partially self-heal on its 2 s poll (reconcileEffects, the 5 s paint re-write) which means the two authorities then fight. Probability is 1, not a coin flip, any time two panels are open.

**Fix.** Gate the revert on `armLease.size === 0` after the delete — a dead panel should only hand the ship back to the automatic show when NO panel is still armed. Scope the audio-binding and scope teardown to the dead owner where possible.

### MEDIUM-16. Movement trace still rides its depth off the beat envelope when tempo-locked, contradicting the comment two lines above it

`marsin_engine/lib/global_effects_controller.js:675` — *recent-work* — verification: **CONFIRMED**

**What.** `_applyMovementTraceStage` takes the RAW gain: `const aGain = this.audioGainForSlot(m.slotId);` (line 675), not `audioDrivenPrimary`. `audioGainForSlot` (1620-1625) returns whatever audio_bindings computed — for a `bpmPulse` level binding that is `1 - depth + depth * (fall*fall)`, the beat envelope itself (engine.js:902-906). That gain is then multiplied straight into the effect's magnitude at lines 757, 770 and 787 (`amount: m.amount * aGain`). The tempo-lock short-circuit lives only inside `audioDrivenPrimary` (1676: `if (this.isTempoLocked(slotId)) return base;`), which this stage bypasses. Every other effect in the file routes through `audioDrivenPrimary` and is therefore correct.

**Why it matters.** Binding the tempo to a MOVEMENT button gives the operator both behaviours at once: the travel locks to the beat (line 714) AND the trace amount still pulses full-to-floor on every beat — which is precisely the "it just goes to pulse rather than driving the actual effect that I select" complaint the whole tempo-lock feature was built to remove. The comment at 712-713 asserts the opposite of what the code does: "A tempo-bound slot TRAVELS on the beat rather than having its Trace Amount ridden up and down by the beat envelope."

**Fix.** `const aGain = this.audioDrivenPrimary(m.slotId, 1);` — or compute `amount: this.audioDrivenPrimary(m.slotId, m.amount)` at each of the three apply sites, matching every other stage in the file.

### MEDIUM-17. The ARM control has no busy lock, so re-arming during a disarm sequence leaves the ship blacked out with the panel reading ARMED and no deadman

`docs/ui/touch_control.html:1651` — *recent-work* — verification: **CONFIRMED**

**What.** The page's ARM handler is a bare `arm.classList.toggle('is-armed')` with no disabled state and no in-flight guard, and the wire's handler (touch_control_wire.js:440-452) simply reads that class and launches `takeControl()` or `releaseControl()`. The disarm sequence is at least 1.5 s of fade plus a six-request handback; the arm sequence is 1.5 s plus seven sequential round trips plus assertions. Nothing prevents a second tap in that window. If the operator taps DISARM then ARM: the new `takeControl()` sets the lease and releases the blackout, while the still-in-flight `releaseControlBody()` finishes by POSTing `/global-blackout {state:true}` (line 417), clearing the source lock, disabling all effects and finally sending `touchControlArmed:false` (line 434).

**Why it matters.** End state: blackout ON (ship dark), panel showing ARMED, source lock cleared, all effects off, and the arm lease explicitly released — so the deadman will not fire either. armFade is back at 1, so the diagnostic in README's troubleshooting table ("check GET /arm-fade") points at the wrong thing. Impatient double-tapping of a switch that takes eight seconds to respond is a thoroughly foreseeable playa behaviour.

**Fix.** Track an `armBusy` flag in the wire, add `pointer-events:none`/`aria-disabled` on #arm for the duration, and have a new toggle either queue behind or explicitly cancel the in-flight chain.

### MEDIUM-18. Re-pointing a button is a structural PATCH, which is 409-gated during performance mode — the wire swallows the error while the button has already relabelled, so the cell fires the OLD effect

`docs/ui/touch_control_wire.js:109` — *effects-integration* — verification: **OVERSTATED**

**What.** `PATCH /global-effect-slots/:id` opens with `if (rejectIfPerformanceMode(res)) return;` (api_server.js:6459), which 409s while a show is live. The page's `assign()` (touch_control.html:2219-2239) has already rewritten `dataset.fxkey`, `dataset.preset`, the family stripe and the two-line face BEFORE the `fxassign` event reaches the wire, and the wire's `write()` catches every failure into a status-pill string and returns null. `reconcileEffects` then presses the slot on the operator's tap — firing whatever binding the engine still holds.

**Why it matters.** With performance mode entered from CaptainPad (POST /performance-mode, api_server.js:10565), the operator picks FREEZE from a dropdown, taps it, and the ship strobes — because slot 18 is still bound to strobe|sync_4hz. The only signal is a small red status pill; the button itself confidently displays the wrong effect. The same drift happens on any transient PATCH failure, not just performance mode.

**Fix.** Make `provisionCell` resolve/reject honestly and have the `fxassign` handler REVERT the cell (re-`assign()` to the previous option index) when the PATCH fails, plus mark the cell `fx-unwired` — `markCells()` already renders that state (touch_control_wire.js:1294-1295). Surface a distinct message for HTTP 409 ('the show is locked from the iPad') rather than the generic write error.

### MEDIUM-19. docs/44 §2.8 states the panel only switches off effects it turned on; the wire deliberately switches off every running slot including 1-8

`docs/44_touch_control.md:108` — *effects-integration* — verification: **UNDERSTATED**

**What.** The design spec says 'TOUCH CONTROL only ever provisions into slots >= 9, and only ever switches off effects it personally turned on.' The reconcile loop does the opposite by design: it iterates every slot the engine reports as ON and presses off anything the grid does not claim, with an explicit comment that this includes slots 1-8.

**Why it matters.** A CaptainPad or VSN1 operator pressing an effect on slots 1-8 will see it turn itself off within ~1.8 s (SETTLE_MS) whenever the touch panel is armed. That may be the intended 'the panel owns the rig' policy, but the spec that reviewers read says the opposite, so nobody auditing multi-surface behaviour from the docs would find it.

**Fix.** Update docs/44 §2.8 to state the actual policy (armed panel is exclusive owner of the whole effect chain) and note the consequence for the other two surfaces.

### MEDIUM-20. takeControl fades the ship to black before confirming the deadman was actually registered

`docs/ui/touch_control_wire.js:282` — *safety-failure* — verification: **OVERSTATED**

**What.** takeControl()'s own comment (wire:278-281) states the deadman MUST exist before anything can take the ship to black. The code sends the declaration and discards the result: sendControl() returns false without any error surfaced if the control socket is not open (wire:2258-2261 — `if (!controlWs || controlWs.readyState !== 1) return false;`). The very next statement is armFadeTo(0, 1500). The control socket is opened at page load and retried every 2 s on close (wire:2263-2282), so there is a real window — first seconds after page load, any moment inside a 2 s reconnect backoff, or after an engine restart — where ARM is pressed, no lease is registered on the engine, and the panel drives the arm envelope to 0.

**Why it matters.** If the panel dies inside that window (the operator walks out of range, the iPad sleeps, the tab crashes) the engine holds armFade at 0 with no lease to expire and no revert. armFade is applied unconditionally, above the section-dimmer bail-out and ignoring parked groups and every ignoreDimmerFor* bypass (intensity_controller.js:131-142), so the entire ship is black. Nothing on the engine clears it: only POST /mixer/panic, another /arm-fade, or an engine restart. The panel is gone, so the operator has to reach a different surface to find out why the ship went dark, and it fails silently — no fail() is raised.

**Fix.** Make takeControl() gate on the declaration: if sendControl() returns false, fail('arm', 'no control socket — refusing to fade the ship out without a deadman') and abort the takeover (or wait for the socket, with a bounded retry). Better still, have the engine ack (touchControlArmedAck already exists, api_server.js:11590) and wait for that ack before the first armFadeTo(0).

### MEDIUM-21. Overlay mixer faders are silenced on arm, kept only in page memory, persisted at 0, and never restored by any failsafe

`docs/ui/touch_control_wire.js:227` — *safety-failure* — verification: **OVERSTATED**

**What.** silenceOverlays() records each overlay channel's pre-arm fader into the page-local variable priorOverlayFaders and then PATCHes every one of them to 0. The only restore path is restoreOverlays(), which runs inside releaseControlBody() and nulls the record afterwards. If the page reloads, crashes, or the deadman fires instead of a clean disarm, that record is gone. revertToAutomaticShow() has six steps (api_server.js:4390-4455) and none of them touch overlay channels — it restores blackout, master, armFade, the source lock, the effect scope, parked groups, audio bindings, the owner's paint and the playlist, but not the faders the panel zeroed. Overlay faders ARE persisted (state_manager.js saveMixerState:511-521 via serializeChannel, which emits `fader: ch.fader` at state_manager.js:21), and the boot zero-guard only covers the GRAND master (api_server.js:3097), not per-channel faders.

**Why it matters.** After any non-clean end of an armed session, every overlay layer of the show is stuck at fader 0 — permanently, and across engine restarts. Whatever part of the look those overlays carry is silently missing, and the deadman revert reports the ship recovered. /mixer/panic happens to fix it (panicToSafeDefault sets c.fader = 1.0, pattern_mixer.js:1426-1430) but nothing on the automatic recovery path does.

**Fix.** Persist the pre-arm overlay faders on the ENGINE (the same place the arm lease lives) rather than in page memory, keyed by ownerId, and add a step to revertToAutomaticShow() that restores or, failing that, force-lights every overlay channel to its pre-arm value / 1.0. At minimum, add an overlay step to the revert mirroring panicToSafeDefault.

### MEDIUM-22. Audio bindings are written while DISARMED but only cleaned up when armed, so a closed panel can leave the rig driven by audio with nobody holding it

`docs/ui/touch_control_wire.js:2027` — *safety-failure* — verification: **OVERSTATED**

**What.** faderAudioWrite() and audWrite() use req(), not write(), by deliberate design (wire:1862-1865: 'Binding is a rig-wide routing decision... so it is written whether or not the panel is armed'). But the pagehide cleanup that clears bindings is gated on the armed flag: window.addEventListener('pagehide', ...) opens with `if (!state.armed) return;` (wire:526-527), and the engine-side cleanup (revertToAutomaticShow step 4) only runs when an ARM lease exists. So a panel that is opened, has a few group or effect audio pickers set, and is then closed while DISARMED leaves those bindings live on the engine forever. The engine applies group gains every frame regardless of any arm state (engine.js:887-913 -> global_effects_controller.applyAudioGroupGains, controller:1599-1612).

**Why it matters.** This is the 'audio binding with no panel' failure directly: the rig keeps breathing, pulsing or (see the stale-source finding) sitting dark to a signal nobody is driving, with no surface open that shows a binding exists. The bindings are not persisted, so the only cure is an engine restart, POST /audio-bindings/clear, or arming and disarming a panel — none of which an operator would think to try because no control is lit.

**Fix.** Either gate binding writes behind write() like every other rig-affecting control (they already get re-asserted on arm by pushAllAudioBindings, wire:913), or move the /audio-bindings/clear keepalive out of the armed-only pagehide block so it always fires. The engine side could also lease bindings by ownerId the way group paint is leased.

### MEDIUM-23. Tempo-locked STROBE never phase-locks: the lock is gated on signals.audioPresent, which engine.js hardcodes to false

`marsin_engine/engine.js:869` — *safety-failure* — verification: **CONFIRMED**

**What.** The BPM tempo-lock work makes a tempo-bound strobe force its beat phase lock (global_effects_controller.js:1027-1028 `const phaseLock = this.strobeConfig.phaseLock || this.isTempoLocked(this.strobeConfig.slotId);`). But the very next line gates it on `signals.audioPresent`, and the signals object the render loop builds and hands to applyMacros sets `audioPresent: false` unconditionally, with a comment saying it is a placeholder 'until the OSC audio path is wired'. barPhase in the same object IS computed correctly. So the strobe branch of the tempo lock is dead code in the live loop. The other four clock-owning effects use tempoSyncFor() and are unaffected (controller lines 362, 618, 714).

**Why it matters.** docs/ui/README.md:180 tells the operator 'the strobe phase-locks so its flashes land on the downbeat'. It does not. Binding a tempo signal to a strobe silently does nothing at all — audioDrivenPrimary returns the base untouched for a tempo-locked slot (controller:1676), and the phase lock is skipped — so the operator's action has no effect whatsoever and nothing says so, which is the exact 'I set it and the rig ignored me' failure the codex forbids.

**Fix.** Gate the strobe phase lock on the presence of a usable beat grid (tempoBpm > 0), not on the stubbed audioPresent flag — e.g. set signals.audioPresent from the arbitrated tempo/analyser state, or change the condition to `if (phaseLock && tempoBpm > 0)`. Until then, correct README §EFFECTS so it does not promise a lock that cannot engage.

### MEDIUM-24. The DIP dark gap is real as described, and the ARM fade-up has exactly the same shape — a multi-second black ship on every arm

`docs/ui/touch_control.html:3513` — *safety-failure* — verification: **CONFIRMED**

**What.** DIP confirmed structurally: recallWithTransition fires the master fade DOWN, then after half+60 ms calls restoreState(s2) and only then fires the fade UP. restoreState -> publishGroups -> the wire's groupmodeschange handler runs applyStatic(), pushAllGroupLevels() and flushGroups(true) (wire:1008-1033), which issues up to 24 synchronous POST /section-brightness fetches before the single fade-up POST is queued behind them on the browser's per-origin connection limit; each of those does a saveGlobals on the engine side (api_server.js:6017). The same shape exists on ARM, deliberately: the fade-up is chained off applyStatic() (wire:514-516), and applyStatic has a 500 ms coalescing timer (STATIC_MS, wire:1659, 1775) plus staggered writes spaced max(20, min(120, fadeMs/n)) apart (wire:1792), i.e. up to 24 x 120 ms = 2.88 s when the FADE bar is at its 5 s maximum.

**Why it matters.** Confirms the known DIP issue and identifies a second instance the docs do not mention. Worst case the arm sequence holds the ship at armFade 0 for 1.5 s (fade down) + several sequential HTTP round trips + 0.5 s debounce + up to 2.9 s of staggered paint writes + 1.5 s (fade up) — a black Titanic for the better part of seven seconds every time the operator arms, with no progress indication.

**Fix.** Give the engine a single bulk endpoint for the restore (a POST that takes all 24 section brightnesses and all group paints in one request, applied on one frame) so a look change is one round trip rather than 24+. Then both the DIP up-leg and the arm fade-up can start immediately after it. Failing that, start the fade-up concurrently with the restore rather than strictly after it, and cap the total black window.

### MEDIUM-25. Toggling ARM twice in quick succession interleaves takeControl and releaseControl, corrupting the overlay-fader capture and the blackout state

`docs/ui/touch_control_wire.js:452` — *safety-failure* — verification: **CONFIRMED**

**What.** The ARM click handler starts armStep = takeControl() or releaseControl() with no mutual exclusion and no cancellation of an in-flight opposite chain — the deadline at wire:453-461 is explicitly a race, not an abort ('when the deadline wins, the chain below runs while takeControl is still in flight'). Both chains open with a 1.5 s fade plus a 1.5 s wait, then run many sequential round trips, so their bodies overlap easily. Concretely: a disarm in flight will call restoreOverlays() (which nulls priorOverlayFaders, wire:252) while an arm chain that started afterwards is about to call silenceOverlays(), which re-reads GET /mixer — by then possibly showing the already-zeroed faders — and captures 0 as the 'prior' value. Symmetrically, takeControl's POST /global-blackout {state:false} (wire:341, sent with req() so it is not gated by the armed flag) and releaseControlBody's POST /global-blackout {state:true} (wire:417) can land in either order.

**Why it matters.** The overlay levels are silently and permanently lost (they are the only record, and they persist to mixer_state.yaml at 0 — see the overlay finding), and the ship can end up blacked out while the panel reads ARMED, or lit while it reads DISARMED. Double-tapping a button during a slow arm is exactly what an operator does when the surface appears unresponsive, and the arm chain is documented as having been observed never settling (wire:446-451).

**Fix.** Serialise arm transitions: keep a single in-flight promise and either ignore or queue a new ARM click until it settles, disabling the button meanwhile. Guard silenceOverlays() against overwriting a non-null priorOverlayFaders, and never capture a fader value while a restore is in flight.

### MEDIUM-26. "All groups off means ZERO light" does not hold for fixtures patched with no sectionId

`simulation/scenes/titanic/patches.yaml:2` — *safety-failure* — verification: **UNDERSTATED**

**What.** The panel's rule (docs/ui/README.md:214) is enforced entirely through per-section dimmers, and a section is only addressable if a pixel carries sId > 0: modelDimmerGroups() skips anything else (api_server.js:892 `if (px.group && px.sId > 0 && !groups[px.group])`), POST /section-brightness rejects an id that is not in that map (api_server.js:6008-6013), and IntensityController only scales pixels whose sId has an entry (intensity_controller.js:152). The titanic patch file contains fixtures with no sectionId key at all — the four TE Sign strips at the top of patches.yaml — while every other entry carries one. Two further caveats: LOCKed groups are skipped by ALL OFF by design (touch_control.html:3082), and modelDimmerGroups takes only the FIRST pixel's sId per group, so any group spanning more than one section would only have its first section dimmed.

**Why it matters.** ALL OFF is not a guaranteed blackout of the exterior, which matters if an operator relies on it as one. The direction of the error is safe (light stays on rather than going off), so this is LOW — but the rule as written in the manual is not what the code enforces.

**Fix.** Have the engine assert at model load that every pixel with a group carries a sId > 0, and that a group maps to exactly one sId — fail loudly otherwise (codex P0), since a partially-addressable dimmer rack is a silent half-control. Alternatively drive ALL OFF through the grand master or a group-level gain that covers every pixel rather than through section ids, and soften the claim in README §GROUPS.

---

## LOW (43)

### LOW-1. The fade-up is never re-guarded on state.armed — a stale arm chain raises the house in the middle of a disarm

`docs/ui/touch_control_wire.js:516` — *arm-lifecycle* — verification: **OVERSTATED**

**What.** The post-race chain checks `if (!state.armed) return;` exactly once, at line 478, before the assertions begin. Everything after that runs unconditionally, including `armFadeTo(1, ARM_FADE_MS)` at 516. The assertion phase is long: applyStatic alone waits STATIC_MS (500 ms, line 1659/1775) and then up to 24 staggered writes at 20-120 ms each (1792-1800), so 3+ seconds is normal. A disarm tapped inside that window sets state.armed=false at 444 and starts releaseControl's own armFadeTo(0, 1500) — and then the stale arm chain fades the house back UP mid-disarm-fade.

**Why it matters.** The ship visibly lurches instead of settling, which is exactly the failure the deadline widening at 454-460 was written to prevent from the other direction. Worse, the two envelope ramps fight: whichever POST the engine processes last wins (IntensityController.startArmFade replaces `_armFadeRamp` wholesale, intensity_controller.js:69), so the final level depends on network ordering rather than on which action the operator took last.

**Fix.** Capture an epoch/sequence number at 444 and re-check it (plus state.armed) immediately before the fade-up; if the epoch has moved, skip the fade-up and let the newer chain own the envelope.

### LOW-2. armAsserts are fire-and-forget, so the master, fade time, audio bindings, effect scope and parked groups can land AFTER the ship is visible

`docs/ui/touch_control_wire.js:501` — *arm-lifecycle* — verification: **OVERSTATED**

**What.** The assertion loop at 501-503 calls each armAssert synchronously and discards its return value — none of them are promises the chain waits on. The registered asserts are pushAllAudioBindings (913), the effect-scope re-push (919), the master PATCH (922-940, whose fetch is issued at 939 and only `.catch`ed), pushFade (1575) and pushParkedGroups (2076). Only applyStatic() is awaited before the fade-up (514-516). The comment at 504-511 claims the fade-up 'deliberately waits for the palette, the effect slots and the group paint to actually land' — true for the group paint, false for the master, the fade bar, the 24 audio bindings, the effect scope and the parked groups.

**Why it matters.** applyStatic's 500 ms debounce usually covers a fast LAN, but on playa wifi or a loaded engine the master PATCH can land after the ship has already faded up — the operator watches the house come up at the wrong level and then jump. The parked-groups and effect-scope asserts landing late change what is lit after the reveal. README:108-110 documents the stronger guarantee to the operator.

**Fix.** Have each armAssert return its promise, collect them (`var jobs = armAsserts.map(...)`) and `Promise.all([applyStatic()].concat(jobs))` before the fade-up. The master in particular must be on the rig before the house comes up.

### LOW-3. A failed fade-OUT is swallowed, so the entire takeover then happens as a hard cut on a lit ship with no signal

`docs/ui/touch_control_wire.js:283` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** armFadeTo never rejects (264-267) — deliberately, so a failed fade cannot abort the chain. But the arm path does not distinguish 'fade landed' from 'fade failed': line 283 issues the fade-out, line 284 waits ARM_FADE_MS unconditionally, and the takeover at 286-341 proceeds either way. Nothing reads back GET /arm-fade (api_server.js:6067) to confirm the envelope is actually at 0.

**Why it matters.** The source lock, both autopilots dying, disable-all and the overlay faders snapping to zero all land as hard visual cuts on a fully lit ship — the exact thing the envelope exists to hide (intensity_controller.js:35-40). The operator sees a violent flash-and-lurch on arm and, with the pill detached, gets no explanation. Not a safety failure (lit is the safe direction), but the feature silently does nothing.

**Fix.** Inspect armFadeTo's resolved value; on null, report the degraded arm to the operator and either retry once or proceed explicitly as a hard cut with a visible warning.

### LOW-4. The 'state.armed is not yet true' comment on the master assertion is factually wrong and records a false root cause

`docs/ui/touch_control_wire.js:935` — *arm-lifecycle* — verification: **CONFIRMED**

**What.** The comment claims req() is used instead of write() because 'state.armed is not yet true when these run'. It is: state.armed is assigned at line 444, inside the same setTimeout callback, before takeControl() is called at 452 and long before armAsserts run at 501. The real reason the earlier write()-based assertions never landed is documented correctly elsewhere in the same file (491-497): an un-caught rejection in the chain skipped them entirely.

**Why it matters.** No wrong behaviour today — req() works and the master lands. But the comment enshrines a false model of the arm lifecycle right next to the one control the same comment calls 'the one control that must never be wrong'. The next person to reason about the arm ordering from these comments will believe state.armed lags the takeover, which is precisely the thing they need to get right.

**Fix.** Correct the comment to state the real reason (arming IS the operator's request, so the master goes out unconditionally rather than through the armed gate) and delete the false 'not yet true' claim.

### LOW-5. A rejected /param-center write is answered HTTP 200 {status:'ok'} — the rejection is discarded server-side, so no REST client can ever see a source_lock

`marsin_engine/lib/api_server.js:8938` — *engine-surface* — verification: **OVERSTATED**

**What.** The POST /param-center handler loops the body, calls paramCenter.set, and looks at the result ONLY to harvest a revision number: `for (const k in data) { const r = paramCenter.set(k, data[k], 'api'); if (r.status === 'ok') rev = r.revision; }` then unconditionally writes 200 `{status:'ok', revision: rev}`. A body where every key was refused with `{status:'ignored', reason:'source_lock'}` produces a 200 with `revision: 0` and no mention of the refusal. Contrast the WS path, which does report it: api_server.js:11613-11615 sends `{type:'paramRejected', key, reason, lockedTo}`. CaptainPad's wrapper then reports success to its own caller regardless — CaptainPad/utils/api.ts:907-908 `const data = await res.json(); return { ok: true, data };` — and nothing in the CaptainPad tree parses `paramRejected` (grep for it returns zero hits; the only lock-shaped strings are a GlobalEffectMacros toast and read-only `sourceLock` mirroring in useEngineState.ts:63,480,757).

**Why it matters.** This is the second half of the README's own open question ('Not verified in this repo's testing: CaptainPad's own behaviour when its writes are rejected — whether it surfaces the rejection to its operator or silently swallows it', README.md:128-132). The answer is that CaptainPad cannot surface it even in principle over REST, because the engine never tells it. Today that is latent for CaptainPad (its writes are source 'api' and pass), but any future lock — a global-mode lock, or a per-param lease to a non-'api' owner, which is exactly the fix for the finding above — would silently black-hole every REST write with a green 200. Fail-open with a success code is the opposite of the codex P0 'fail loudly' rule this file follows everywhere else.

**Fix.** Collect the ignored keys and return them: 409 (or 200 with a non-empty `rejected: [{key, reason, lockedTo}]`) when any key was refused, and have CaptainPad's updateParamCenter return ok:false / raise the existing op_alert on a non-empty rejected list.

### LOW-6. Performance mode silently disables the pattern selector and the entire effect-grid provisioning, reporting only to the detached status pill

`marsin_engine/lib/api_server.js:3851` — *engine-surface* — verification: **OVERSTATED**

**What.** rejectIfPerformanceMode answers 409 `{error: 'performance mode is active — structural/persistent changes are locked', code: 'PERFORMANCE_MODE'}` (lines 3851-3860). Two endpoints the touch panel depends on are behind it: PUT /pattern (line 5527), which is the panel's whole pattern selector (touch_control_wire.js:556-561), and PATCH /global-effect-slots/:slotId (line 6459), which is provisionCell + buildEffectSlots — the step that makes the FX grid live at all (touch_control_wire.js:1261, 1275, and the arm chain at 488). Performance mode is a CaptainPad-side toggle on the same engine.

**Why it matters.** If performance mode is on when the operator arms, the arm sequence's buildEffectSlots fails wholesale: every cell stays unprovisioned, markCells paints them all 'fx-unwired', and the pattern dropdown does nothing. The failure is reported through write()'s fail() (touch_control_wire.js:112) into the status pill that is never attached — so from the operator's seat, arming appears to work and the effect grid is simply dead. Two peer surfaces, one hidden mode flag, no cross-surface indication.

**Fix.** Have the panel GET the performance-mode flag in refresh() and show a banner on the FX grid and the pattern selector when it is active, the same way applyCapability already banners a pad with no sliderTargetX/Y (touch_control_wire.js:162-189).

### LOW-7. The panel's pattern-slider writes (five-colour slots 3-5, the XY paint target, sliderTouch) bypass the source lock entirely and persist to deck_state.yaml

`marsin_engine/lib/api_server.js:5784` — *engine-surface* — verification: **OVERSTATED**

**What.** POST /control does not go through the param centre at all — `paramRouter.setControl(data.id, data.v0 || 0, ...)` then `saveAllState()` (lines 5789-5798). No source, no lock check. The panel drives sliderHue3/4/5, sliderVal3/4/5 (touch_control_wire.js:672,675), sliderTargetX/Y and sliderTouch (lines 780-783, 798) through it. So three of the five palette slots and the whole spatial-paint position are outside the six-param lock the arm takes, and every one of those writes fsyncs into deck_state.yaml localControls (visible now at deck_state.yaml:10-60).

**Why it matters.** It sharpens the answer to 'what control does the panel have while armed': the lock covers colorPalette1, colorPalette2, colorTransitionMs, motionTransitionMs, rotate and speed — and nothing else the panel touches. Palette slots 3-5, the XY pad, the master, the group dimmers, the group paint, the effect slots and the audio bindings are all unprotected against any other writer for the whole armed session. It also means a hung sliderTouch (the pointerup handler at line 796-799 is the only thing that clears it, and it is send()-coalesced and arm-gated) can persist to disk as a stuck finger.

**Fix.** No code change necessarily needed, but README §3 should state the true blast radius: the lock is six CPC params, and everything else the panel drives is unarbitrated. If exclusivity is wanted for the pattern sliders it has to be built — POST /control has no arbitration hook at all today.

### LOW-8. bpm-sync marks a speed as sent before checking whether the source lock refused it, so it stops re-asserting after the lock lifts

`marsin_engine/lib/bpm_speed_sync.js:189` — *engine-surface* — verification: **CONFIRMED**

**What.** `if (this._lastSpeed === speed) return; this._lastSpeed = speed; this._pc.set('speed', speed, this._source, this._origin);` — the cache is updated before the write and the return value is discarded. While the touch panel holds `speed: 'api'`, every bpm-sync write is refused with reason source_lock (param_center.js:1006-1007) but recorded as delivered. After disarm releases the lock, bpm-sync will not re-write until its mapped speed changes to a different value.

**Why it matters.** Small and self-healing — the mapped speed moves with the tempo, so the next real tempo change re-asserts. But between disarm and that next change, the engine's speed is whatever the panel last left it at while BPM sync reports itself as driving. A stable tempo (a held OSC tempo, or tap tempo left alone) makes the window arbitrarily long.

**Fix.** Only update _lastSpeed when the set returns `{status:'ok'}`.

### LOW-9. The arm declaration to the deadman is fire-and-forget and can be silently dropped

`docs/ui/touch_control_wire.js:282` — *engine-surface* — verification: **CONFIRMED**

**What.** takeControl opens with `sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true });` and ignores the return value. sendControl returns false without side effect if the socket is not open: `if (!controlWs || controlWs.readyState !== 1) return false;` (lines 2258-2261). If /ws/control happens to be between reconnect attempts (the retry is a 2 s timer, line 2278) at the moment the operator taps ARM, the engine never learns the panel is armed, and the whole takeover — source lock, autopilots off, overlays to 0, blackout released — proceeds with no deadman watching it.

**Why it matters.** Bounded, because the 'open' handler re-declares on reconnect (`if (state.armed) sendControl({... armed: true })`, line 2274), so the window is at most one retry interval. But the comment above line 282 says 'THE DEADMAN MUST EXIST BEFORE ANYTHING CAN TAKE THE SHIP TO BLACK', and for up to ~2 s of a takeover that begins by fading the ship to 0, it may not.

**Fix.** Have takeControl await a confirmed declaration — check sendControl's return and, if false, defer the fade-out until the socket opens and the armed:true has actually gone out (the engine already replies touchControlArmedAck, api_server.js:11590, which the panel could read once it has a message handler).

### LOW-10. `pushEffectColours()` is a guaranteed no-op — COLOUR_EFFECTS is an empty array — yet it is still awaited in the arm chain and re-run on every palette change and every FX reassign

`docs/ui/touch_control_wire.js:1159` — *redundancy* — verification: **OVERSTATED**

**What.** `var COLOUR_EFFECTS = [];` (1159, empty by an explicit comment at 1153-1158). `pushEffectColours()` (694-721) iterates every `.fx-cell` and returns early on `if (COLOUR_EFFECTS.indexOf(c.dataset.fxkey) === -1) return;` (705), which is unconditionally true for an empty array. `jobs` is therefore always empty and the function always resolves having written nothing. It is nevertheless called three times: inside the arm assertion chain at 489, on every `palettechange` at 742, and on every `fxassign` at 1431. The `COLOUR_NEUTRAL` merge and the `hsvToRgb6` call inside it (714-717) are unreachable from this path (COLOUR_NEUTRAL is still live via `provisionCell` at 1246).

**Why it matters.** Roughly 28 lines of arm-critical-looking code that provably does nothing, sitting in the middle of the arm sequence where every other step matters. Anyone debugging 'the effect colours are wrong' will read this function and believe it runs. It also makes `restoreEffectColours()` (723-736) look like the counterpart to a live writer when in fact the only thing that now dirties `liveOverride` is `provisionCell` (1260).

**Fix.** SAFE to delete `pushEffectColours` and its three call sites (489, 742, 1431) as long as `COLOUR_EFFECTS` stays empty. `restoreEffectColours` is NOT safe to delete — it still restores movementTrace `colors`/`fadeSpan`/`switchMs` that `provisionCell` wrote into `liveOverride`.

### LOW-11. The 2-second poll re-fetches three static endpoints and duplicates a WebSocket push the panel already receives and throws away

`docs/ui/touch_control_wire.js:2344` — *redundancy* — verification: **OVERSTATED**

**What.** `setInterval(… , POLL_MS)` at 2344 runs `refresh()` + `refreshTempo()` + (when armed) `reconcileEffects()` every 2000 ms. `refresh()` (130-157) issues four GETs — /status, /exports, /dimmer-groups, /dimmers — and then calls `loadSlots()` which is a fifth GET (/global-effect-slots). `refreshTempo()` is a sixth (GET /mixer). Armed, `engineOnSlots()` adds two more (/global-effect-slots/status, /globals). That is 6-8 GETs every 2 s for the whole show. /exports only changes when the pattern changes, /dimmer-groups and /dimmers are model-static. Separately, the panel already holds a `/ws/control` socket (openControlSocket, 2263-2282) which the engine seeds with `serializeMixerState()` on connect (marsin_engine/lib/api_server.js:11167) and broadcasts mixer changes on — but the wire registers only `open`, `close` and `error` listeners, never `message`, so every push is discarded and GET /mixer is polled instead.

**Why it matters.** Steady background load on a 40 fps render thread that the wire's own comments elsewhere say is sensitive to write rate (966-965: '141 writes/s dragged the engine from 40 fps down to ~15'). The tempo readout is also up to 2 s stale when a push would have been instant. Not a correctness bug today, but it is exactly the 'polling that duplicates a WS push' the operator asked about.

**Fix.** NOT safe to just delete the poll — it is currently the only source of tempo and slot state. Add a `message` handler on controlWs that feeds `paintTempo` from the pushed `mixer` payload, then drop `refreshTempo()` from the interval; and move /exports/#dimmer-groups//dimmers out of the tick (refetch them only on pattern change and at boot).

### LOW-12. `state.dimmers` is written every 2 seconds and never read; `state.channelId` is declared and never touched at all

`docs/ui/touch_control_wire.js:140` — *redundancy* — verification: **CONFIRMED**

**What.** `state.dimmers = dimmers || {};` at line 140 is the only occurrence of `state.dimmers` in the file — nothing reads it. The GET /dimmers that feeds it (line 135) therefore exists solely to fill a write-only field, 30 times a minute. `state.channelId: null` in the state literal (line 48) has zero other occurrences: grep for `state.channelId` returns nothing.

**Why it matters.** A wasted round trip per tick and two fields that make the state object look like it carries information it does not. `state.channelId` in particular reads as if the deck channel id is being tracked, which the file's own header (lines 21-29) makes a point of NOT doing.

**Fix.** SAFE to delete `state.channelId`, `state.dimmers` and the `req('GET','/dimmers')` leg of the Promise.all (adjusting the `r[3]` destructure at 137).

### LOW-13. `slotOf` is populated on every poll tick and never read; `stemList()` and `meterPeak` are defined and never used

`docs/ui/touch_control_wire.js:1148` — *redundancy* — verification: **CONFIRMED**

**What.** `var slotOf = {}` (1148) is reset at 1192 and filled at 1194 inside `loadSlots()`, which runs every 2 s. There is no read anywhere — `markCells()` deliberately uses `slotBinding[id]` instead, and says why at 1290-1293. `function stemList()` (1962-1971) is never called: it is the leftover of the ten-checkbox stem UI that the comment at 1982-1984 says was replaced by a dropdown. `var meterPeak = {}` (2120) has exactly one occurrence — its own declaration.

**Why it matters.** Three dead symbols in the most safety-relevant file, one of which (`slotOf`) is a map that reads like the effect→slot lookup markCells was explicitly changed to stop using — a future reader could reintroduce the bug the 1290-1293 comment describes.

**Fix.** SAFE to delete all three, plus lines 1192 and 1194. `shortStem()` must stay — `audOptionsHtml` (1882) uses it.

### LOW-14. The BRIGHT → grand master handler in the wire targets an element that was removed from the page

`docs/ui/touch_control_wire.js:1499` — *redundancy* — verification: **CONFIRMED**

**What.** `var briSlider = document.querySelector('.slider-vertical.bright');` — no element in touch_control.html carries the `bright` class. The markup where it used to live carries a comment saying it was removed (touch_control.html:1443-1446). So `briSlider` is always null and the whole 1500-1506 block, including a third distinct `PATCH /mixer {master}` write keyed `'master'`, never runs. The matching CSS rule `.slider-vertical.bright > i` at touch_control.html:543 is likewise orphaned, and the `briVal` branch of the vertical-slider loop (touch_control.html:1726: `document.getElementById(isFade ? 'fadeVal' : 'briVal')`) can never be taken because `.slider-vertical.fade` is the only vertical slider left.

**Why it matters.** Three separate code sites still describe a BRIGHT fader that no longer exists, and the wire holds a fourth path to the ship's grand master (alongside `pushMaster` at 1077, the arm assertion at 922-940 and the XY pad's `xyMaster` at 786) that can never fire. Anyone auditing 'what can move the grand master' has to trace a branch that is unreachable.

**Fix.** SAFE to delete touch_control_wire.js:1499-1506, touch_control.html:543, and to simplify 1726 to `document.getElementById('fadeVal')`.

### LOW-15. Three page-script blocks query selectors that match nothing: `.mini-switch`, `#tracerSeg`, `.slider-h`

`docs/ui/touch_control.html:1675` — *redundancy* — verification: **CONFIRMED**

**What.** `document.querySelectorAll('.mini-switch')` (1675) — no element and no CSS rule in the file uses that class (it is not among the 185 classes the stylesheet defines). `selectable('tracerSeg', 'button', 'is-active')` (1671) — no `#tracerSeg` element exists; the function returns early on `if (!el) return`. `document.querySelectorAll('.slider-h')` (1702-1714) — the class has CSS at 734-742 but no element carries it, so the entire 13-line horizontal-slider builder, including its `.val` / `.readout` sibling lookup, never runs.

**Why it matters.** About 20 lines of interaction code plus 9 lines of CSS describing controls the panel does not have. It inflates the file the operator's team has to reason about and makes `selectable`'s three-call list look like three live control groups when only two are.

**Fix.** SAFE to delete 1671, 1675-1677 and 1702-1714, plus the `.slider-h` / `.slider-h > i` CSS at 734-742.

### LOW-16. FLASH is a dead effect family: no option has it, but the CSS rule, the cap, the help text and an operator-facing legend row all still advertise it

`docs/ui/touch_control.html:1582` — *redundancy* — verification: **CONFIRMED**

**What.** I parsed FX_OPTS (line 2120) — 32 entries across exactly four families: move 9, dim 12, frame 6, texture 5. No entry has `f: 'flash'`. Yet `.fx-cell.fam-flash` (875), `FX_CAPPED.flash` (2127), `FAM_HELP.flash` (2130) and the `order` array entry (2145) all still name it, and the legend strip renders `<span><i style="background:rgba(255,216,77,.85)"></i>FLASH · one</span>` unconditionally at 1582 — a coloured key for a family the operator can never select. `fxOptionsHtml`'s `fams` filter (2146-2148) correctly drops it from the dropdown, so the legend is the only place it reaches the screen.

**Why it matters.** The effects legend is the operator's map of what stacks and what does not. One of its five rows points at nothing. Small, but it is a visible lie on a panel whose whole design premise is 'what you see is what is sent'.

**Fix.** SAFE to delete the legend row at 1582, `FX_CAPPED.flash`, `FAM_HELP.flash`, the `.fam-flash` rule and `'flash'` from the `order` array — unless a flash-family preset is expected to be re-added, in which case leave the machinery and only the legend row is wrong.

### LOW-17. `TRIGGER_EFFECTS = ['dropHit']` names an effect the panel no longer offers, so the whole momentary/trigger path for panel-owned slots is unreachable

`docs/ui/touch_control_wire.js:1211` — *redundancy* — verification: **CONFIRMED**

**What.** `var TRIGGER_EFFECTS = ['dropHit'];` is used only at 1238 to decide `behavior: 'trigger' | 'toggle'` in `provisionCell`. No FX_OPTS entry has `e: 'dropHit'` (the nine effects offered are movementTrace, beatPump, breath, crush, feedbackTrails, fogger, freeze, strobe, waterlineSweep), so every slot 9..24 the panel provisions is `'toggle'`. That makes the momentary branch in the click handler (1463-1469, guarded by `id >= 9 && slotBehavior[id] === 'trigger'`) unreachable. Similarly, three of the four `LEGACY_DMX` entries (1167: vintageWhite, blastWhite, uvBlast) match no cell — only `fogger` is on the grid.

**Why it matters.** A whole interaction mode (tap-fires-once-and-unlatches, plus `refreshFxCountSafe`'s 220 ms un-latch at 1466) is documented, implemented and dead. The `slotBehavior[id] === 'trigger'` guards inside `reconcileEffects` (1403, 1413) are NOT dead — they still apply to Deck/VSN1 slots 1-8 whose behavior comes from the engine — so this cannot be blanket-deleted.

**Fix.** Leave TRIGGER_EFFECTS in place if dropHit may return; otherwise delete it, the 1238 ternary's true branch, the 1459-1469 click branch and `refreshFxCountSafe` together. Do NOT touch the 1403/1413 guards — they cover engine-owned slots.

### LOW-18. The FX grid runs the same four-call reconcile block three times for one tap: identical copy-pasted bodies on pointerdown/pointerup/pointercancel and again on click

`docs/ui/touch_control_wire.js:1438` — *redundancy* — verification: **CONFIRMED**

**What.** Lines 1438-1453 register the same handler on `pointerdown`, `pointerup` and `pointercancel` for `[data-role=fxface]`: `setTimeout(() => { reconcileEffects(); applyStatic(); pushMovementColours(); pushMovementFade(); }, 0)`. Lines 1471-1481 repeat that block verbatim — same four calls, same comment text word for word — inside the `click` handler. A single tap on an FX face therefore fires the block on pointerdown, on pointerup and on click: three times.

**Why it matters.** Reconcile is serialised (`rcBusy`/`rcAgain`, 1360) and settle-windowed (`SETTLE_MS = 1800`, 1366), and `applyStatic` coalesces on a 500 ms timer, so the rig does not misbehave — but `pushMovementColours`/`pushMovementFade` each queue a PATCH + an `/activate` POST per lit movement cell through `send()`, so a tap costs more engine round trips than it should on a surface whose own comments repeatedly warn about write rate. The duplicated comment block is also a maintenance trap: a fix applied to one copy will silently miss the other.

**Fix.** Hoist the block into one named function and call it from a single place. Which edge to keep needs a decision: pointerdown/up drive the page's hold-vs-tap logic (touch_control.html:2334-2359) while click fires after the family-swap in `setCellOn`, so the click one is the only edge that observes a completed swap — verify before removing it.

### LOW-19. Two separate `click` listeners registered on the same #groupsGrid node in the wire, and the group level is pushed twice per tap (pointerup then click)

`docs/ui/touch_control_wire.js:1118` — *redundancy* — verification: **CONFIRMED**

**What.** Lines 1118-1120 and 1121-1123 both do `bank.addEventListener('click', …)` on the same element in the same phase — one calls `setTimeout(applyStatic, 0)` on a power tap, the other calls `pushGroup(strip)`. They could be one handler. Separately, `pushGroup` already runs on `pointerup` (1113-1116), so a tap on a strip calls it twice; and `groupmodeschange` (1008-1033) calls `pushAllGroupLevels()` which calls `pushGroup` for all 24 strips a third time. Counting the page's own four `grid.addEventListener('click', …)` registrations (touch_control.html 2485, 2908, 3052, 3173) plus the wire's capture-phase OWN handler (1630), #groupsGrid carries seven click listeners.

**Why it matters.** Harmless today — `queueGroup` dedupes on a 1% value delta (972) — but seven listeners on one node with interleaved capture/bubble phases and `stopPropagation` in three of them is exactly the shape that produced the two bugs already documented in this file's comments (the pointerup-before-click power-switch bug at 1013-1021 and the capture-phase paint bug at 1623-1629).

**Fix.** Merge 1118-1123 into one listener. Do NOT remove the pointerup or the groupmodeschange push without re-reading the comments at 1011-1021 — both were added to fix measured on-rig failures.

### LOW-20. #bpmSync has two click handlers that both fight over the same class and label

`docs/ui/touch_control.html:1679` — *redundancy* — verification: **CONFIRMED**

**What.** The page registers `bpm.addEventListener('click', function () { bpm.classList.toggle('is-on'); })` at 1679. The wire registers a second click handler on the same element at touch_control_wire.js:943-948 which reads `bpmSync.textContent === 'TAP'` to pick the next source, POSTs /mixer/tempo/source and then calls `paintTempo`, which overwrites BOTH `bpmSync.textContent` (882) and `bpmSync.classList.toggle('is-on', …)` (883). The page script runs first (it is inline at 1640; the wire is injected by `document.write` at 3885), so the page's blind toggle always runs first and is always overwritten.

**Why it matters.** The page's toggle is pure residue from the prototype era: it briefly lights or unlights SYNC before the engine's real answer lands, and if the POST fails the class is left showing a state the engine never entered — on a panel whose stated rule is that no control may pretend to have worked.

**Fix.** SAFE to delete touch_control.html:1678-1679. The wire is the sole authority for that button's state.

### LOW-21. Two constants and one function are implemented twice, once in the page and once in the wire

`docs/ui/touch_control_wire.js:1515` — *redundancy* — verification: **CONFIRMED**

**What.** `FADE_MAX_MS = 5000` is declared independently in both files — touch_control.html:1721 (used to render the '600ms' label) and touch_control_wire.js:1515 (used to convert the same slider's 0..1 into milliseconds, and by `movementFadeSpan()` at 632). Nothing keeps them in step. `refreshFxCount()` (touch_control.html:2265-2270) and `refreshFxCountSafe()` (touch_control_wire.js:1486-1492) compute the same `#fxCount` string from the same two querySelectorAll counts, in the same format — except the page's version also calls `refreshPaletteNote()` and the wire's does not.

**Why it matters.** Change the fade ceiling in one file and the readout starts lying about what the engine was told. And the wire's copy of the counter silently skips the 'your palette is one colour' warning that the page's copy refreshes, so after a momentary un-latch that note can be stale.

**Fix.** For FADE_MAX_MS: publish it from the page as a data attribute the wire reads, the same contract already used for `slots.dataset.palette`. For the counter: have the wire dispatch an event the page listens on rather than keeping a second implementation.

### LOW-22. Three header chips are decorative: STATUS always reads OK, and Help and Settings have no handlers

`docs/ui/touch_control.html:1397` — *redundancy* — verification: **UNDERSTATED**

**What.** `<button class="chip">STATUS <strong>OK</strong></button>` (1397) is static markup — nothing in either file ever writes to it, so it reads OK whether the engine is up, down, or reporting errors. `<button class="chip chip-ico" title="Help">?</button>` (1398) and `<button class="chip chip-ico" title="Settings">⚙</button>` (1399) have no click handler anywhere; only the sibling `#reloadPanel` at 1403 is wired (1753-1757).

**Why it matters.** A permanently-green STATUS indicator next to a real ARM control is worse than no indicator — it is the one place an operator would glance to check the engine link, and it is a hard-coded string. The wire already tracks exactly this in `state.online` / `state.lastError` and has nowhere to put it.

**Fix.** Either bind the STATUS chip to `state.online`/`state.lastError` (this is the natural home for the orphaned pill content) or delete all three chips. Do not leave STATUS hard-coded.

### LOW-23. OWNER id has no entropy — it is Math.floor(performance.now()) — so two panels can collide and corrupt each other's lease

`docs/ui/touch_control_wire.js:1585` — *recent-work* — verification: **OVERSTATED**

**What.** `var OWNER = 'touch_control_v2_' + Math.floor(performance.now()).toString(36);` — `performance.now()` at script-eval time is milliseconds since this page's navigation start, a small integer in a narrow band (tens to low hundreds of ms for this ~216 KB page). There is no random component, no device identity, no session id. Two panels loading the same page can produce the same string.

**Why it matters.** On collision the engine's ownerId-keyed maps merge the two panels. `armLeaseSet` (api_server.js:4516-4521) does `armLease.set(ownerId, {...ws})`, so panel B arming silently OVERWRITES panel A's lease entry and A is no longer watched. Then when A's tab closes, the close handler reads the same ownerId, finds `armLease.has(ownerId)` true — it is B's — deletes B's lease and fires the full revert against B's live show, leaving B armed with no deadman at all. `releaseTouchPaintForOwner(ownerId)` (4564-4572) likewise releases B's painted groups. I am being honest about likelihood: this needs an ms-exact collision, so it is perhaps a percent or so per pair of loads — but the id costs nothing to make unique.

**Fix.** `crypto.randomUUID()` (or `Date.now().toString(36) + Math.random().toString(36).slice(2)` for the older-browser path). Optionally have the engine reject a `touchControlHello` whose ownerId is already registered on a different live socket.

### LOW-24. The launcher re-asserts POST /pattern after boot, overriding the crash-boot revert the engine claims cannot be overridden

`launcher.js:1295` — *recent-work* — verification: **OVERSTATED**

**What.** The crash boot policy comments at api_server.js:11130-11142 state that a `--pattern` pin is "deliberately overridden by the crash policy", and the boot log says so out loud. But `startEngine()` in launcher.js waits for `/status` and then unconditionally does `await httpPostJson(`${engineUrl}/pattern`, { pattern: opts.pattern });` (line 1295), which runs strictly after `startApiServer` has already executed the revert at api_server.js:11143. POST /pattern swaps the deck handle and pattern in place (api_server.js:5577-5589) while preserving the playlist, so the revert's playlist and its `autopilot active` survive — but the reverted pattern does not.

**Why it matters.** In the supervised path — which is the production path on the show server — the pin wins over the crash policy for the pattern, exactly inverting what the code comment and the boot warning tell the operator. An operator diagnosing an unclean restart sees the pinned boot pattern on the deck and reasonably concludes the crash policy did not run. The automatic show does come back on the next autopilot beat, so this is recoverable and largely cosmetic in effect — but the documented contract is wrong, and the window between boot and the first autopilot beat is whatever `autopilot.state.delay_s` is.

**Fix.** Have the engine expose whether it took the crash-revert path (e.g. in GET /status) and have the launcher skip the /pattern re-assert when it did; or correct the comment and the boot warning to say the pin is re-applied by the supervisor.

### LOW-25. The arm envelope is invisible to every preview and to /status: CaptainPad's LIVE OUTPUT is snapshotted before the multiply

`marsin_engine/engine.js:1054` — *recent-work* — verification: **OVERSTATED**

**What.** The `preDimmer` vis buffer is captured at engine.js:1054-1066, and `intensityController.apply()` — which is where armFade is multiplied — runs at line 1069, fifteen lines LATER. The mixer's `master` key is likewise a pre-dimmer composite (comment at 1133-1136). CaptainPad's deck "LIVE OUTPUT" strip reads `visDataRef.current.preDimmer` (CaptainPad/app/(tabs)/index.tsx:981) and the mixer tab's master strip uses `vizKey="preDimmer"` (mixer.tsx:2709). The only buffer that includes armFade is `rig` (built from model.pixels at engine.js:1143-1154, after apply), and grep finds no consumer of `rig` in CaptainPad. Separately, GET /status (api_server.js:5411-5417) carries renderHealth but no armFade — the only read surface is GET /arm-fade.

**Why it matters.** During any arm/disarm fade, and during any stuck-at-zero envelope, CaptainPad shows a fully lit preview over a black ship. That is the precise diagnostic signature that would let an operator identify the problem in seconds, and it is not available on any surface they normally look at. The touch panel's own status pill is also `dataset.headless = '1'` (touch_control_wire.js:69) and not attached to the DOM.

**Fix.** Fold `armFade` (and `ramping`) into GET /status and into the mixer-state WS broadcast so every surface can show a badge; optionally point CaptainPad's LIVE OUTPUT at `rig` when armFade < 1.

### LOW-26. The arm envelope does not cover the DMX-only fixtures: fogger, horn and fire keep firing through the 'invisible' takeover

`marsin_engine/engine.js:1090` — *recent-work* — verification: **OVERSTATED**

**What.** `globalEffectsController.applyDmx(dmxBuffers, { blackout: ... })` is passed only the blackout flag; `applyDmx` (global_effects_controller.js:445-474) computes `foggerActive = !blackout && this.effects.fogger`, and likewise for horn and fire. armFade is never consulted. The engine.js comment at 1086-1087 explains the blackout pass-through as "pixel-level blackout alone wouldn't touch them" — the same reasoning applies verbatim to armFade and was not extended.

**Why it matters.** The stated purpose of the envelope is that the takeover happens where nobody can see it. On disarm the fade to 0 runs first (touch_control_wire.js:352) and `/global-effects/disable-all` does not land until much later in the chain (line 412), so for the whole fade-down plus the six-request handback the ship is black while the fogger runs, the horn sounds and the fire poofer fires. It is the opposite of invisible, and a flame effect firing during a window the operator believes is dark is worth being deliberate about.

**Fix.** Pass armFade through and treat `armFade < some epsilon` like blackout for the three DMX-only fixtures — or make the decision explicitly and document it (there is a defensible reading where the horn/fire SHOULD survive a house fade).

### LOW-27. The operator manual tells the operator that the deadman, the crash revert and the ratchet fix do not exist

`docs/ui/README.md:257` — *recent-work* — verification: **OVERSTATED**

**What.** The "Not built yet — know these before relying on the panel unattended" section states: "The engine does not notice a dead panel… The deadman that would revert to the automatic show is **not implemented**" (259-262); "A crash does not revert to the automatic playlist" (263-265); and describes the autopilot ratchet as an unfixed hazard (266-270). All three shipped. The failsafe table at 250-255 also omits the deadman and the crash boot policy entirely.

**Why it matters.** This is the document the operator reads before a show. It teaches them that a dead panel leaves the rig frozen exactly as left — so when the deadman actually fires and the ship jumps to the default automatic playlist mid-set, they will read it as a fault and start fighting it. It also tells them to manually check the autopilot before walking away, which is now the wrong procedure. On a public-facing installation, a manual that understates the automation is a safety-relevant defect, not a doc nit.

**Fix.** Rewrite section 6: move the deadman, the crash boot policy and the ratchet fix into the failsafe table with their observable behaviour (15 s lease, revert to 'default' playlist with autopilot on), and state plainly what the operator will SEE when each fires.

### LOW-28. The never-black enforcer runs upstream of armFade, so /status reads green on an envelope-black ship

`marsin_engine/lib/pattern_mixer.js:3383` — *recent-work* — verification: **CONFIRMED**

**What.** `_enforceNeverBlack()` is called from `renderAll6ch()` and inspects `this.outputBuffer` — the mixer's composite, which is upstream of the grand master and far upstream of `IntensityController.apply()` (engine.js:1069). Its trip condition also requires `_isExpectingLight()`, which only looks at the mixer master and the channel faders (pattern_mixer.js:735-752). armFade is invisible to all of it.

**Why it matters.** The rig's last-resort visibility guarantee — the one that exists specifically to enforce "the Titanic is visible at night" and that floors the output at 10/255 — provides no cover at all for the newest scalar that can black the whole ship. `/status.renderHealth.ok` stays true, and the health log stays silent, while the rig is at zero. This is not a wrong output today (the placement is otherwise correct: putting armFade upstream would make the enforcer fight the fade), but it means the failsafe inventory has a hole exactly where the new code is.

**Fix.** Add a cheap separate assertion at the end of the render tick: if armFade has been below some epsilon for more than (max fade duration + margin) with no ramp in flight, log loudly once and expose it on /status — the arm envelope's equivalent of the never-black trip.

### LOW-29. The ratchet's stale-lock fingerprint false-positives whenever a second panel arms

`docs/ui/touch_control_wire.js:310` — *recent-work* — verification: **CONFIRMED**

**What.** The fingerprint is `pcState.sourceLock.mode !== 'open'` at arm time, justified by "takeControl is the only thing that sets one and releaseControl always clears it" (comment 300-304). Within the tree that is nearly true — `setSourceLock` has exactly one route (POST /param-center/source-lock, api_server.js:8946-8948) plus the revert's release at 4411, and nothing in CaptainPad or the timeline posts one. But a SECOND touch panel arming while the first is armed sees the first panel's perfectly live lock and concludes a previous panel died.

**Why it matters.** The second panel discards its genuine autopilot capture, records `{active: true}` for both autopilots, and raises a misleading error in the status pill ("a previous panel died while armed"). The consequence is mild and in the safe direction — on disarm it asserts the automatic show ON rather than leaving nothing driving — but it silently overrides a deliberate "I turned the autopilot off first", which the comment at 306-308 explicitly promises to honour. I also confirmed a persisted lock cannot false-positive across a restart: state_manager.js:417-422 never restores one.

**Fix.** Make the fingerprint owner-aware: have the panel stamp its OWNER into the lock (or ask the engine whether any arm lease is currently held) so "a lock exists AND no panel is armed" is the actual test.

### LOW-30. The crash marker lives in os.tmpdir(), which on a Linux show server is typically wiped by the very event it is meant to detect

`marsin_engine/lib/api_server.js:11099` — *recent-work* — verification: **CONFIRMED**

**What.** `crashMarkerPath = path.join(os.tmpdir(), `bm26_engine_running_${scene}_${port}.marker`)`. The ordering is correct — read once at 11103 before any write, and `writeCrashMarker()` only runs in the `server.listen` callback at 11733 — and the scene+port key correctly isolates two engines on one machine. The placement rationale (keeping a runtime file out of the tracked states/ tree) is sound. The risk is the medium: on many Linux distributions /tmp is a tmpfs or is cleared on boot, in which case a power cut or a hard reboot — the archetypal playa crash — removes the marker before the next boot can read it.

**Why it matters.** The crash boot policy would then silently not fire for the failure mode most likely to occur, and the operator would get the pinned pattern instead of the automatic show with no indication anything was missed. UNVERIFIED: I did not determine the show server's OS or its /tmp semantics, and on Windows (%TEMP%, where this repo is checked out) the marker does survive a reboot, so this may be a non-issue in practice. A second, smaller wrinkle I did verify: because the key includes the scene name, an unclean exit on scene A followed by a deliberate run of scene B leaves A's marker behind indefinitely, and the next scene-A boot reverts spuriously.

**Fix.** Put the marker somewhere that survives a reboot on the target OS — a gitignored runtime dir under the repo, or an explicit path from an env var — and confirm the show server's /tmp policy before relying on it.

### LOW-31. FX_OPTS is a hardcoded literal in the page, not derived from the engine — 8 of 17 engine effects and 19 of 51 effect+preset pairs are unreachable from the panel

`docs/ui/touch_control.html:2120` — *effects-integration* — verification: **OVERSTATED**

**What.** `FX_OPTS` is a static 32-entry JSON array literal pasted into the page. Nothing in touch_control.html or touch_control_wire.js ever calls `GET /global-effect-library` (grepped both files: the only matches are the two COMMENTS at touch_control.html:2113 and touch_control_wire.js:1151 that CLAIM the data was read off the library). The engine registry holds 17 effects / 51 effect+preset pairs (counted by importing marsin_engine/lib/global_effect_library.js). The panel offers 9 effects / 32 pairs. Missing ENTIRELY (no option at all): vintageWhite, blastWhite, uvBlast, dropHit, colorWash, invert, kickPunch, sparkle. Missing PARTIALLY: waterlineSweep (rising_tide and beat_wipe absent; only shadow_pass offered).

**Why it matters.** Every future effect added to the engine registry is invisible to the operator panel until a human hand-edits a 3.5 kB one-line literal in a 216 kB HTML file AND hand-adds a matching FX_SHORT entry. The comment at line 2140 records that this exact trap already fired once ('A hardcoded list silently dropped the whole MOVEMENT family the day it was added'), and the fix applied then only de-hardcoded the FAMILY list, not the option list. This is the integration blocker: it is not possible to 'integrate the rest of the effects' without either regenerating this literal or making it derive at runtime.

**Fix.** Serve the catalog: at arm time (or page load) `GET /global-effect-library`, map `describeLibrary()` output into the {e,p,f,s,l} shape, and rebuild the dropdowns from that. Keep the family assignment (`f`) and the short face (`FX_SHORT`) as the only hand-maintained tables, and make a missing family fail loud the same way a missing FX_SHORT entry already does at line 2232. If a runtime fetch is refused (offline-first), at minimum add a build/test step that diffs FX_OPTS against `describeLibrary()` and fails when the engine grows an effect the panel does not list.

### LOW-32. The panel has no FLASH family at all — every effect it offers subtracts or is neutral — yet the legend advertises FLASH and omits MOVEMENT

`docs/ui/touch_control.html:1582` — *effects-integration* — verification: **OVERSTATED**

**What.** FX_OPTS families break down as move:9, dim:12, frame:6, texture:5 — zero `flash`. The DIM twelve (strobe x5, beatPump x3, breath x3, waterlineSweep|shadow_pass, whose mode is 'darken') all reduce output; frame (crush, freeze) and texture (trails, haze) are neutral. Meanwhile the CSS defines `.fx-cell.fam-flash` (line 875), FAM_HELP defines a flash entry (line 2130, 'FLASH — adds light'), FX_CAPPED caps flash at 1 (line 2127), and `fxOptionsHtml`'s preferred order includes 'flash' (line 2145). The legend renders a yellow 'FLASH · one' chip and does NOT render the purple MOVE chip even though 9 of the 16 default buttons are move.

**Why it matters.** On a ship whose mission rule is night-time visibility, the operator's effects panel can only take light away. There is no accent, no hit, no white punch available — dropHit, blastWhite, uvBlast and every colorWash are the missing effects. The legend actively promises a lane that does not exist and hides the one that dominates the grid, so the operator hunts for a flash button that was never wired.

**Fix.** Populate the flash lane with dropHit (white_drop / iceberg_flash / vintage_burst) and blastWhite; the cap, help text and CSS already exist so nothing else changes. Fix the legend to render MOVE and to derive its chips from the families actually present in FX_OPTS rather than a hand-written list.

### LOW-33. The operator manual documents kick punch and frost sparkle as panel effects; neither exists in FX_OPTS

`docs/ui/README.md:185` — *effects-integration* — verification: **OVERSTATED**

**What.** The EFFECTS section of the panel's own manual tells the operator that 'Two effects are already audio-driven by their own nature and need no tempo lock: kick punch fires off the kick drum … and frost sparkle has an audioDensity mode that ties its spawn rate to the high band.' Neither `kickPunch` nor `sparkle` appears anywhere in FX_OPTS (parsed panel effect set: movementTrace, beatPump, breath, crush, feedbackTrails, fogger, freeze, strobe, waterlineSweep). The same section says 'Only 5 of the 19 effects own a clock' while the engine's own comment (global_effects_controller.js:1685-1688) says 7 of 19, and the library actually registers 17 (19 is the count of .js FILES in marsin_engine/effects/, two of which — hue_shift.js and group_fixed_color.js — are not GEM library entries).

**Why it matters.** The manual is what the operator reads at 2 a.m. It sends them looking for two effects the panel cannot reach, and its effect count does not match any real number in the system. That erodes trust in the rest of the document.

**Fix.** Either add kickPunch and sparkle to FX_OPTS (both are registry-declared and reconcile correctly — see notes) or delete the paragraph. Replace the hardcoded '19 effects' with the registry count, ideally generated.

### LOW-34. The effects grid is CSS-locked to exactly 4 rows with overflow:hidden — extending FX_SLOTS provisions live engine slots that are invisible and unpressable

`docs/ui/touch_control.html:796` — *effects-integration* — verification: **OVERSTATED**

**What.** `.effects-grid` declares `grid-template-rows: repeat(4, minmax(0, 1fr))` with `flex: 1; min-height: 0; overflow: hidden`. The grid is populated by iterating FX_SLOTS (touch_control.html:2241-2252), and `buildEffectSlots` iterates `fxGrid.querySelectorAll('.fx-cell')` with no count limit (touch_control_wire.js:1266). The wire's own range is 9..32 (OURS_FROM=9, MAX_SLOTS=32, touch_control_wire.js:1212-1213), so 24 slots are available and only 16 are used.

**Why it matters.** The obvious way to 'integrate the rest of the effects' is to add buttons. Adding a 17th entry to FX_SLOTS creates a 5th implicit grid row; the four explicit 1fr rows consume the container height and `overflow: hidden` clips the rest. Those cells are still provisioned into engine slots 25+, still retired/reconciled by the wire, and still fire — an effect running on the rig with no button the operator can see or press. That is the exact 'I can't turn it off' class the reconcile loop was built to kill.

**Fix.** Derive the row count from FX_SLOTS.length (`grid-template-rows: repeat(var(--fx-rows), minmax(0,1fr))`, set from JS) or switch to `grid-auto-rows: minmax(0,1fr)`. Add an assertion at grid-build time that the rendered cell count equals FX_SLOTS.length and that no cell is clipped.

### LOW-35. The touch panel has permanently overwritten the VSN1 hardware controller's pages 1 and 2 — the committed layout artifact now carries the panel's own button faces

`marsin_engine/states/titanic/vsn1_layout.yaml:52` — *effects-integration* — verification: **OVERSTATED**

**What.** Slots 9-24 in the committed VSN1 layout artifact are bound to exactly the panel's FX_DEFAULT set, with names that are literally the first element of the panel's FX_SHORT table: PULSE, 2 COLOUR x3, 5 COLOUR x3, BY GROUP x2, STROBE, DUCK, SWELL, TRAILS x2, SWEEP, FREEZE. Those are VSN1 pages 1 and 2 (`pageOfSlot`, 8 slots per page). Additionally `buildEffectSlots` retires any bound slot in 9..32 that no button owns by PATCHing `enabled:false` (touch_control_wire.js:1272-1277), and `patchSlot` + `persistGlobalEffectSlots` make all of it durable.

**Why it matters.** docs/44 §2.8 frames slots >=9 as free for the panel, but they are not free — they are the VSN1's pages 1-2, and the panel has already claimed them in tracked state. A VSN1 operator who lays out pages 1-2 loses that layout the next time anyone arms the touch panel, permanently and silently. Adding more panel buttons (slots 25-32) would extend the claim to pages 3-4, i.e. the entire hardware controller.

**Fix.** Decide and document the real ownership split (e.g. the panel owns 17-32 and the VSN1 keeps 1-16), then set OURS_FROM/FX_SLOTS to match and update docs/44 §2.8. Failing that, use a dedicated BANK for the touch panel — the bank infrastructure exists in global_effect_slot_manager.js and is only shelved behind CaptainPad's BANKS_UI_ENABLED flag — so the panel's 16 slots do not sit on top of the hardware's.

### LOW-36. TRIGGER_EFFECTS is a hand-mirrored copy of the engine's behaviorTypes — adding a trigger-only effect without updating it yields a 400 and a silently unwired button

`docs/ui/touch_control_wire.js:1211` — *effects-integration* — verification: **CONFIRMED**

**What.** `provisionCell` picks behavior with `TRIGGER_EFFECTS.indexOf(eff) !== -1 ? 'trigger' : 'toggle'`, where TRIGGER_EFFECTS is the literal `['dropHit']`. The engine's `resolveSlotBinding` throws `Effect '<id>' does not support behavior '<b>'` (global_effect_slot_manager.js:180-182), which the PATCH route converts to a 400 (api_server.js:6472-6474), which `write()` swallows. dropHit's only behaviorType is 'trigger'; kickPunch supports ['trigger','toggle'].

**Why it matters.** This is the second hand-maintained mirror of engine data in the panel (after FX_OPTS and FX_SHORT). Adding any future trigger-only effect and forgetting this line produces a button that looks correct and is dead — `markCells()` will grey it as fx-unwired, so it degrades visibly rather than dangerously, but the operator gets no reason why.

**Fix.** Derive the behavior from `describeLibrary()`'s `behaviorTypes` / `presets[p].defaultBehavior` in the same fetch that would derive FX_OPTS, and drop the literal.

### LOW-37. The `s` (singleton) flag in FX_OPTS is a hand-copied duplicate of the engine's `singleton` field, and every current entry hardcodes 1

`docs/ui/touch_control.html:2313` — *effects-integration* — verification: **CONFIRMED**

**What.** `setCellOn` reads `FX_OPTS[Number(cell.dataset.opt)].s` to decide whether lighting a cell should release other cells bound to the same effect. All 32 current entries carry `"s":1`, which happens to match the engine (all nine panel effects are `singleton: true`). Two of the effects that would be added — dropHit and kickPunch — are `singleton: false` in the library.

**Why it matters.** If an added entry copies `s:1` for a non-singleton effect, the panel will silently release a second dropHit/kickPunch cell that the engine is perfectly happy to run concurrently, and the operator loses a legitimate multi-hit capability with no error anywhere. There is no cross-check against the engine.

**Fix.** Take `s` from `describeLibrary()[id].singleton` rather than the literal.

### LOW-38. The grand master and the arm envelope never reach the DMX-only fixtures — only blackout does

`marsin_engine/lib/global_effects_controller.js:445` — *safety-failure* — verification: **OVERSTATED**

**What.** applyDmx() writes the fogger, horn and fire DMX channels directly into the outbound universe buffers after IntensityController has run, and its only safety input is the blackout flag (engine.js:1088-1092 passes `{ blackout: ... }` and nothing else). The grand master (engine.js:1037-1046, pixel-only) and the arm envelope (intensity_controller.js:131-142, pixel-only) therefore do not scale these fixtures at all.

**Why it matters.** The panel's stated contract is 'the master fader is the absolute master when armed — no exceptions' apart from LOCKed groups (docs/ui/README.md:216), and the arm envelope is documented as applying unconditionally because a bypassing effect would otherwise 'flash a fading ship white' (intensity_controller.js:122-130). Both statements are false for the fire fixtures, which are light-emitting: with the master at 0, or in the middle of an arm fade-out where the whole point is that the takeover is invisible, an active fire effect keeps firing at full. Only blackout silences it.

**Fix.** Pass the grand master and armFade into applyDmx alongside blackout and treat armFade < some epsilon (and master 0) the same way blackout is treated for the light-emitting fixtures (fire at minimum). Or document explicitly, in README §GROUPS and in the arm-envelope comment, that DMX-only fixtures are outside both.

### LOW-39. ownerId is derived from performance.now() at page load, so two tabs or two iPads will frequently collide on the same lease identity

`docs/ui/touch_control_wire.js:1585` — *safety-failure* — verification: **OVERSTATED**

**What.** OWNER = 'touch_control_v2_' + Math.floor(performance.now()).toString(36). performance.now() is measured from the page's own time origin, so its value at wire-script execution is a small, low-entropy, highly repeatable number (a few hundred ms, clamped to 1 ms or coarser for cross-origin-isolation mitigations) — not a unique id. Two panels opened on two devices, or two tabs on one device, will collide with high probability. That single string is the key for both the arm lease (api_server.js:4498 armLease keyed by ownerId) and the touch-paint lease (api_server.js:4288).

**Why it matters.** On a collision the two panels share one lease: panel A disarming calls armLeaseClear(ownerId) and silently cancels the deadman protecting panel B (api_server.js:11589), and A's socket closing releases B's painted groups (releaseTouchPaintForOwner, api_server.js:11658). B is then armed with no deadman watching it — if B dies the ship stays exactly as B left it, which is the whole failure the lease was built to prevent. Two operators is explicitly a foreseeable case in this system (README §4).

**Fix.** Use crypto.randomUUID() (or crypto.getRandomValues) for OWNER. As defence in depth, key the arm lease on the socket as well as the ownerId so armLeaseClear/close can only release the lease belonging to the socket that declared it.

### LOW-40. Every ARM and every DISARM rewrites the tracked, comment-bearing marsin_engine/config.yaml through yaml.dump

`marsin_engine/lib/autopilot.js:92` — *safety-failure* — verification: **OVERSTATED**

**What.** takeControl() posts /autopilot {active:false} and /deck/color-autopilot {active:false} (wire:334-335); releaseControlBody() posts both again with the restored values (wire:391-399). POST /autopilot ends in autopilot.updateState(data) (api_server.js:7239), which calls saveConfig() -> fs.writeFileSync(CONFIG_FILE, yaml.dump(this.config)) with CONFIG_FILE defaulting to marsin_engine/config.yaml (autopilot.js:11). ColorAutopilot does the same (color_autopilot.js:147-149). The file is tracked — `git ls-files --error-unmatch marsin_engine/config.yaml` succeeds, and it is currently listed as modified in the working tree. yaml.dump round-trips the parsed object, so every comment and the original key ordering in that file are destroyed on each write. The write is also a plain writeFileSync, not the atomic temp+fsync+rename StateManager uses (state_manager.js:176-194). OTHER tracked-file writers confirmed at runtime: state_manager.save into marsin_engine/states/<scene>/*.yaml (resolved by state_paths.js:46 to the tracked tree unless MARSIN_STATE_DIR is set), playlist_manager.js:275 into simulation/scenes/<scene>/playlists (tracked — default.yaml is currently modified), vsn1_layout_deploy.js:353, and api_server.js:5493 which writes pattern source files into marsin_engine/patterns.

**Why it matters.** Confirms the reported config.yaml mechanism and its trigger. Practical consequences: the show server's git tree is permanently dirty, an operator's `git pull`/`git stash` on the playa hits conflicts on files the engine is actively rewriting, the documentation comments in config.yaml are lost on the first arm, and the non-atomic write means a power cut mid-save can leave a truncated config.yaml (loadConfig swallows the parse error at autopilot.js:86 and returns {}, silently resetting the autopilot config).

**Fix.** Split the mutable runtime autopilot state out of the tracked, comment-bearing config.yaml into a per-scene state file under the state_paths seam (the same seam that already exists precisely to keep runtime writes out of the tracked tree — state_paths.js header, incident 2026-07-08), and route the write through StateManager's atomic writeFileAtomic. At minimum, stop swallowing the write error at autopilot.js:93.

### LOW-41. The operator manual's failsafe section is stale — it tells the operator three safety mechanisms do not exist when all three have landed

`docs/ui/README.md:259` — *safety-failure* — verification: **OVERSTATED**

**What.** §6 'Not built yet — know these before relying on the panel unattended' states that the engine does not notice a dead panel and 'The deadman that would revert to the automatic show is not implemented'; that 'A crash does not revert to the automatic playlist'; and that the autopilot ratchet is unfixed. All three now exist in the tree: the arm lease and deadman (api_server.js:4470-4561, 11655-11670), the crash-marker boot policy (api_server.js:11098-11144), and the ratchet break in takeControl (touch_control_wire.js:300-318). The same section's guard table also omits every dark path that IS live (section dimmers, disarm blackout).

**Why it matters.** This is the operator manual for a night-critical installation. It currently tells the operator to expect a frozen rig after a panel death (so they will not recognise the automatic show reappearing as the designed behaviour), it tells them to check the autopilot before walking away for a problem that is fixed, and it does not warn them about the two dark paths that actually exist. Wrong safety documentation is worse than none — it drives the wrong recovery action at 3 a.m.

**Fix.** Rewrite §6: move the deadman, the crash-boot policy and the ratchet fix into the guard table with their actual behaviour (15 s lease, what the revert does to the six pieces of state, the fact that it force-loads the 'default' playlist), and add the remaining gaps — section dimmers are not covered by any failsafe, disarm blacks the ship out, overlay faders are not restored by the revert.

### LOW-42. The crash marker lives in os.tmpdir(), which is exactly the directory most likely to be cleared by the reboot that follows a power loss

`marsin_engine/lib/api_server.js:11099` — *safety-failure* — verification: **CONFIRMED**

**What.** The crash-boot policy detects an unclean shutdown by a marker file written on listen and deleted in closeNow(). It is placed in os.tmpdir() deliberately, to keep a runtime file out of the tracked states tree. But on Linux /tmp is commonly cleared at boot (systemd-tmpfiles, or a tmpfs /tmp which is empty by definition after a power cycle), and the marker's whole purpose is to survive precisely the events that reboot the machine: a power cut or a hard kill at the playa.

**Why it matters.** In the headline scenario the policy exists for — the show server loses power — the marker can be gone before the engine reads it, so crashPresentAtBoot is false, no revert runs, and the engine comes up on its pinned --pattern instead of the automatic playlist the operator asked for. The failure is silent: a missing marker is indistinguishable from a clean stop. Note the same code already fails loudly if it cannot WRITE the marker (api_server.js:11111-11112), so the reverse case is handled.

**Fix.** Put the marker somewhere reboot-durable but still untracked — a gitignored runtime directory in the repo, or a path under an explicit BM26_RUNTIME_DIR that the show server sets. If os.tmpdir() must stay, log at boot whether the marker directory looks reboot-persistent, and consider a second signal (a monotonic 'last clean shutdown' timestamp in a state file) so the policy is not single-pointed.

### LOW-43. The panel cannot tell the operator that the simulator or the sACN path is gone — its only health signal is the engine's HTTP

`docs/ui/touch_control_wire.js:132` — *safety-failure* — verification: **CONFIRMED**

**What.** refresh() polls only :6968 (GET /status, /exports, /dimmer-groups, /dimmers) every 2 s and sets state.online from that; the status pill reports 'ENGINE ●' or 'ENGINE ○ OFFLINE' and nothing else (wire:71-82). Nothing in the panel probes :6969 (the static host serving the page), :6971/:6972 (the sim sACN bridges), or the engine's sACN send health. The page itself is served by `npx http-server ../ -p 6969` from the sim stack (simulation/start.js:89), so if that process dies the panel keeps working from the already-loaded page but can never be reloaded. Mitigating: start.js supervises and restarts that child on a 10 s health probe (simulation/start.js:63-66, 87-93), and http-server is vendored in simulation/node_modules so the offline rule holds.

**Why it matters.** The answer to 'does the panel notice if the sim dies' is no. The operator gets no signal that the visual chain is down, and any reload attempt in that window loses the control surface entirely. Low rather than higher because the sim is only the visualizer on the playa (the real rig takes sACN from the engine directly) and the static server is supervised.

**Fix.** Surface the engine's own sACN send stats (already broadcast on /ws/control as `stats`) in the panel header, and add a cheap periodic HEAD against the page's own origin so a dead host shows as a warning while the tab is still alive. Longer term, serve the panel from the engine (:6968) so the control surface has no dependency on the sim stack.

---

## ULTRA-LOW (9)

### ULTRA-LOW-1. Twenty-three CSS class rules target elements that no longer exist, including the whole tab bar, the whole footer, and the removed ten-checkbox stem grid

`docs/ui/touch_control.html:220` — *redundancy* — verification: **OVERSTATED**

**What.** A tokenised scan of the <style> block (lines 25-1348) against every other byte of the page and the wire finds these classes referenced nowhere but their own rules: `.tabbar` + `.tab` + `.tab.is-active` (219-237 — the markup is now just an empty `<!-- ── Tabs ── -->` comment at 1407), `.footer-bar` + `.footer-note` + `.footer-note .ico` (1290-1298 and the 1345 media query — the markup is an empty `<!-- ── Footer ── -->` comment at 1637), `.stem-grid` / `.stem-box` / `.stem-box.is-on` / `.is-bpm` / `.is-implicit` / `.is-dead` (915-937 — the ten-checkbox stem UI the wire comment at 1982-1984 says was replaced by a dropdown), `.meter-tab` (319-324 — the meter collapse tab described in the 316-318 comment was never built), `.meter-bpm` (952-954 — only `.meter-note` survives in the markup at 1395), `.spatial-toolbar` (623), `.z-row` (731-733), `.bpm-row` (744), `.note-tight` (482), `.fader-strip.is-focused` (1061), `.is-disabled` (1302), and the `.groups-grid` media-query rule at 1344 (the element is `id=groupsGrid class="fader-bank"` — the class never existed).

**Why it matters.** ~60 lines of stylesheet that can never apply, several of which describe features (a tab bar, a footer, a collapsible meter strip, a per-stem checkbox grid) the panel no longer has. `.groups-grid` in particular looks like a live responsive rule for the fader bank and is not — the bank's real breakpoint behaviour is elsewhere.

**Fix.** SAFE to delete all 23 rule blocks. Note `.fam-dim/.fam-flash/.fam-frame/.fam-texture/.fam-move` also showed up in a naive scan but are NOT dead — they are built dynamically at 2225 (`cell.className = 'fx-cell fam-' + o.f`); only `.fam-flash` is unreachable (see the FLASH-family finding).

### ULTRA-LOW-2. `[wire-diag]` console.log diagnostics still fire on every arm and disarm

`docs/ui/touch_control_wire.js:477` — *redundancy* — verification: **OVERSTATED**

**What.** Two leftover debug lines inside the arm chain: `console.log('[wire-diag] after takeControl, state.armed =', state.armed);` (477) and `console.log('[wire-diag] running', armAsserts.length, 'arm assertions');` (500). Both are unconditional. These are the only `[wire-diag]` strings in either file.

**Why it matters.** Ship residue. Harmless on its own, but it clutters the one channel — the console — that is currently the panel's ONLY error surface (see the status-pill finding), so real failures are logged next to routine debug noise.

**Fix.** SAFE to delete both lines. Keep the `console.error` in `fail()` (86).

### ULTRA-LOW-3. `window.__wire = state` exports internal state to the global scope 'for headless verification only'

`docs/ui/touch_control_wire.js:2353` — *redundancy* — verification: **OVERSTATED**

**What.** The last statement inside the IIFE assigns the live mutable `state` object to `window.__wire`. Nothing in touch_control.html reads `__wire` (grep returns zero hits in the page), and nothing else in the repo references it.

**Why it matters.** A test hook left in the shipped surface. It punches a hole in the IIFE that the whole file's structure exists to close, and it hands any other script in the page (the panel runs inside a CaptainPad WebView) a mutable handle on `state.armed`. No exploit path today, but it is exactly the kind of thing that should not be on the playa build.

**Fix.** Keep it only if a headless test actually asserts on it — I found no such test in docs/ui. Otherwise SAFE to delete.

### ULTRA-LOW-4. Four dead statements in the presets code: an unused var, a ternary that always yields null, and a duplicated dataset write

`docs/ui/touch_control.html:3361` — *redundancy* — verification: **OVERSTATED**

**What.** 3361: `var pal = (GEN[s.gen] ? null : null);` — both branches are `null`, and `pal` is unconditionally reassigned five lines later at 3366. 3219: `var pPanel = document.getElementById('presetsPanel');` — single occurrence, never read (confirmed by a declaration-usage scan of the whole script). 3019 and 3029: `master.dataset.level = '100';` written twice, ten lines apart, with 3019 carrying a long comment explaining why the seed matters and 3029 a bare duplicate. 3014: `master.id = 'masterStrip';` — the id is never selected by anything in either file (the wire finds the master via `#groupsGrid .fader-strip.is-master`, touch_control_wire.js:927).

**Why it matters.** Pure noise, but the `(GEN[s.gen] ? null : null)` line in particular reads as a deliberate guard against a missing generator and is not one — a reader could 'fix' it into something that changes behaviour.

**Fix.** SAFE: delete 3361 (change 3366 to `var pal = …`), delete 3219, delete 3029, and delete 3014 unless an external tool selects #masterStrip.

### ULTRA-LOW-5. Five comments state reasons that are no longer true, including two that describe a scope split and a removed feature that both still exist

`docs/ui/touch_control.html:2566` — *redundancy* — verification: **CONFIRMED**

**What.** (a) 2566-2571 says the FX per-group checkbox was 'REMOVED ON OPERATOR REQUEST … Nothing was ever sent to the engine for it' — but the checkbox is built 165 lines earlier at 2401, published at 2868, and the wire turns it into `PUT /effect-groups` (touch_control_wire.js:1066). The comment at 2396-2400 says the opposite ('FX, REINSTATED WITH TEETH'). (b) 1780-1785 and 2792-2794 both claim the groups code lives 'in its own IIFE' and that 'different IIFEs' prevent the wheel from naming `applySchemes` — the file has exactly one IIFE (opens 1643, closes 3872; I verified both `moveHandle` declarations sit at the same brace depth inside it). (c) touch_control_wire.js:1696-1701 says the FX flag 'was REMOVED … and read nowhere else', while line 1741 immediately below reads it: `if (fxOn && (m.fx || m.global)) return;`. (d) touch_control_wire.js:7-9 says failures are 'surfaced in the status pill' — the pill is never attached. (e) touch_control_wire.js:833 says 'the stepper pushed a tempo at the engine' — the stepper has no handler.

**Why it matters.** These are the comments an operator or a future agent will read first when deciding what is safe to remove. Two of them actively invite the wrong deletion: someone trusting (a) would strip the FX checkbox that the effect-scope feature depends on, and someone trusting (b) would assume `groupSchemeSync` is a necessary indirection when it is not.

**Fix.** Correct the text; do not touch the code. (b) additionally means `groupSchemeSync` (1785 / 2794) is an unnecessary forward-declaration dance — but it is harmless and removing it is a bigger edit than it looks.

### ULTRA-LOW-6. touch_control_v2.html is a 486-byte redirect stub referenced by nothing in the repo

`docs/ui/touch_control_v2.html:1` — *redundancy* — verification: **CONFIRMED**

**What.** An 8-line file whose entire content is a `<meta http-equiv="refresh">` to touch_control.html plus a one-line notice. A repo-wide grep for `touch_control_v2` returns exactly two hits: line 1585 of the wire, which is an unrelated string (`var OWNER = 'touch_control_v2_' + …`, the arm-lease owner id), and docs/ui/README.md line 10 which already documents it as 'A stub. Not the live surface.' The only in-repo consumer of the panel is CaptainPad/app/(tabs)/touch_control.tsx:27, `const PANEL_PATH = '/docs/ui/touch_control.html'`.

**Why it matters.** Dead as far as the codebase is concerned. It IS still reachable over HTTP because the sim serves docs/ui statically, so it is a bookmark shim and nothing else — its own comment says 'Safe to delete once the bookmark is updated.'

**Fix.** Safe to delete ONLY after confirming no iPad in the field has the _v2 URL bookmarked — that is the one thing I cannot check from here. Cost of keeping it: 486 bytes.

### ULTRA-LOW-7. The engine's touchControlHeartbeat handler has no sender in the touch panel

`marsin_engine/lib/api_server.js:11593` — *recent-work* — verification: **CONFIRMED**

**What.** The `touchControlHeartbeat` branch (11593-11601) renews every paint lease for an owner and acks it, and the ARM LEASE comment block at 4251-4253 describes the panel renewing "by heartbeat". The panel never sends that message — grep across docs/ui/touch_control_wire.js and touch_control.html finds no `touchControlHeartbeat`. Paint leases are in fact renewed by the 5 s re-PUT of every painted group (touch_control_wire.js:1827-1833), comfortably inside the 12 s TOUCH_PAINT_LEASE_MS (api_server.js:4274-4284), so nothing is broken.

**Why it matters.** No functional impact today. It is a dead branch plus a comment that describes a mechanism that is not the one actually keeping the lease alive, which will mislead the next person who tunes the lease window.

**Fix.** Either send the heartbeat from the panel or correct the comment at api_server.js:4251-4253 to say the lease is renewed by the paint re-write.

### ULTRA-LOW-8. Stale counts throughout the effects UI and its comments: 42 pairs, 25 cells, 17 slots, '31 effects'

`docs/ui/touch_control_wire.js:1143` — *effects-integration* — verification: **OVERSTATED**

**What.** The wire's header comment says 'MEASURED against the live engine: 17 slots exist and none are free … of the 25 cells on this grid'. The grid has 16 cells, the engine allows 32 slots and the wire's own MAX_SLOTS is 32 (line 1213). The page comment at touch_control.html:2113 says the library has '42' pairs — it has 51 (42 was the count before movementTrace's 9 presets landed). The static panel subtitle at touch_control.html:1577 reads '31 effects · 0 active' before `refreshFxCount()` overwrites it with a different format entirely ('N active · M stacked').

**Why it matters.** No wrong output today, but these are the numbers a maintainer will trust when deciding how many effects can be integrated and how much room is left. Every one of them is wrong in a direction that understates the available capacity.

**Fix.** Correct the comments to 16 cells / slots 9-24 of 32, and set the initial fxCount text to the same format `refreshFxCount()` produces (or leave it empty and let the first call fill it).

### ULTRA-LOW-9. The `c` field on every FX_OPTS entry is dead — never read anywhere in the page or the wire

`docs/ui/touch_control.html:2120` — *effects-integration* — verification: **OVERSTATED**

**What.** Every FX_OPTS entry carries a `c` flag (1 for all nine movementTrace entries, 0 for the other 23). Searching touch_control.html for any read of `.c` on an option object returns nothing, and `assign()` (touch_control.html:2219-2239) copies only e/p/f into the dataset — `c` never reaches the DOM, so the wire cannot see it either. It appears to be a vestigial 'carries colour' marker superseded by `COLOUR_EFFECTS = []` and the `movementTrace` special-case at touch_control_wire.js:1254.

**Why it matters.** A maintainer adding the missing effects will have to decide what `c` should be for colorWash and dropHit — both obviously 'carry colour' — and will set it, and nothing will happen. Dead schema in a hand-maintained table is how the next silent drift starts.

**Fix.** Delete `c` from the literal, or wire it to the colour path and remove the `eff === 'movementTrace'` hardcode at touch_control_wire.js:1254.

---

## Items the verifiers found that the auditors missed

- MISSED — HIGH: the arm deadman reverts the whole show INSTANTLY on any /ws/control socket close, with no grace period. api_server.js:11655-11671: on 'close', if armLease.has(ownerId) the engine deletes the lease and calls revertToAutomaticShow immediately — blackout off, master up, source lock opened, effect scope and parked groups cleared, audio bindings dropped, paint released, the 'default' playlist force-loaded and both autopilots switched ON (4390-4455). The 15 s ARM_LEASE_MS grace (4485-4495) applies ONLY to hard link loss where 'close' never fires. Meanwhile the panel treats a close as routine and just reconnects after 2000 ms (touch_control_wire.js:2276-2279), re-stamping the lease on open (2274) but never re-running takeControl. So a one-second wifi blip, or an iPad backgrounding/locking long enough for the OS to drop the socket, yanks the operator's entire show back to the automatic playlist while the panel still reads ARMED and silently fights it via the 2 s reconcile poll. The comment at 4478-4484 argues ping/pong survives backgrounding — true for the lease timer, irrelevant to the close path, which has no such protection.
- MISSED — HIGH (structural, amplifies findings 0, 1 and 5): the panel has NO blackout, panic or house-lights control of its own. grep of docs/ui/touch_control.html for 'blackout|panic' returns zero hits, and the wire never calls POST /mixer/panic (its only mention is a comment at line 424). Every dark-ship failure mode in this dimension therefore has zero recovery from the operator's own surface — the operator must reach CaptainPad (CaptainPad/utils/api.ts:700) or restart the engine. Adding a single always-live PANIC button wired to POST /mixer/panic (api_server.js:8377-8400, whose forceLit clears blackout, raises the master AND snaps armFade to 1) would collapse findings 0, 1, 5 and 12 from ship-dark to inconvenience.
- MISSED — MEDIUM: the pagehide handler (touch_control_wire.js:526-547) opens the source lock and clears the audio bindings but does NOT send touchControlArmed:false — which is correct and deliberate (the deadman should fire) — yet it also does not restore the overlay faders or the effect preset colours, and it pre-emptively releases the source lock. The net effect is that a closed tab lands in the engine's revert path with the panel's persisted side effects (overlay faders at 0, presets recoloured) still in place, because revertToAutomaticShow has no step for either. This is the same gap as findings 7 and 8 but reached by the most common exit of all — closing the tab.
- MISSED — LOW (spec conflict worth recording): docs/44_touch_control.md:184-185 specifies that disarm 'releases paint, switches off only the effects this panel lit, and restores the look snapshotted at ARM — ramped, not snapped.' The implementation instead disables ALL effects (touch_control_wire.js:412) and engages a blackout (417). Only docs/ui/README.md:87 documents the blackout. The design spec and the operator manual disagree about what disarm does, and the safety-critical half of that disagreement is finding 5.
- DISARM DELIBERATELY LEAVES THE SHIP BLACK, and nothing in the dimension's findings mentions it. touch_control_wire.js:417 — the last real step of releaseControlBody is `req('POST', '/global-blackout', { state: true })`, and api_server.js:6026-6028 applies it AND persists it via saveGlobals. So a clean disarm ends with the exterior dark and blackout:true on disk, relying entirely on the state_manager.js:445-449 boot guard to undo it after a crash. While the engine keeps running there is no timer, no deadman and no automatic path that clears it — only a human pressing something. Given the mission rule this is the single most load-bearing design decision in the disarm path and deserves explicit scrutiny (is 'disarmed = dark' really wanted at the playa?).
- POST /section-brightness accepts a non-numeric brightness. api_server.js:5993-5996 checks only `data.brightness === undefined`, then intensity_controller.js:24-26 does `Math.max(0.0, Math.min(1.0, val))`. A JSON `null` passes the check and clamps to 0 — a dark group persisted into globals_state.yaml (dimmers) and re-applied verbatim at boot by state_manager.js:475-479. A non-numeric string yields NaN, which propagates into `px.r *= scale` at intensity_controller.js:157-159. Compare /global-blackout and /arm-fade, which validate (intensity_controller.js:55-60 throws loudly on a bad fade target). Low likelihood today (only the panel and CaptainPad post it) but it is an unvalidated dark-making input on the one scalar with no boot guard — directly compounding finding [0].
- restoreOverlays (touch_control_wire.js:246-254) fires its PATCHes with `Promise.all`, and the paint-release step at 406-408 fires up to 24 DELETEs with `Promise.all` — both on the disarm path, both the same concurrency pattern the file's own MEASURED notes at 228-232 and 319-325 say hangs. Finding [3] flags only the six-request Promise.all at line 360; the disarm chain actually contains three concurrent bursts in series, so there are three independent places it can wedge with armFade still at 0.
- The `state.online` flag is decorative. refresh() sets `state.online = false` on any failure (touch_control_wire.js:153-156), but write() (109-113) checks only `state.armed` — never `state.online`. An armed panel whose engine has gone away keeps firing writes into a dead socket every flush tick with the only signal being the detached pill, and (per finding [4]) the operator sees nothing.
- applyStatic() runs TWICE for every group POWER tap, which the auditor half-found but attributed to the wrong cause. touch_control.html:2485-2493 fires publishGroups() on a power tap, which dispatches groupmodeschange (2881); the wire's groupmodeschange handler calls applyStatic() at touch_control_wire.js:1009. The wire ALSO calls setTimeout(applyStatic, 0) from its own power-tap click listener at 1118-1119. Both fire, so the whole staggered group repaint is computed and pushed twice per tap. Finding 13 says only that the two click listeners 'could be one handler'.
- state.lastError (wire:53, set by fail() at 85, read only by setStatus() at 76) is a second write-only field in the same class as state.dimmers and state.channelId from finding 5 — it exists solely to feed the pill that is never attached.
- pushGroup() has FOUR call paths per interaction, not three: pointermove 1109-1112, pointerup 1113-1116, click 1121-1123, and pushAllGroupLevels 1099-1103 via groupmodeschange 1022. Finding 13 counts three.
- refreshTempo() is called once at boot (wire:950) and then again on the very first 2s poll tick (2346), and paintTempo is additionally invoked with the POST response at 946 — three paths repainting the same readout, on top of the polling redundancy in finding 4.
- UNVERIFIED: I did not check whether the engine's GET /status, /exports, /dimmer-groups, /dimmers or /global-effect-slots handlers do any disk I/O per request. Finding 4's cost argument assumes they are cheap reads; api_server.js was not read for those five handlers, so the real per-tick cost of the 6-8 GETs is unconfirmed.
- FX_SLOTS at docs/ui/touch_control.html:2126 is `[9,10,...,24]` — SIXTEEN slots, and the .fx-cell nodes are generated by JS at 2241-2252, not authored in the HTML. Finding [0]'s '24 concurrent PATCHes (24 .fx-cell nodes in docs/ui/touch_control.html)' is wrong on both the count and the provenance.
- The pagehide fade-up guard is SKIPPED on the disarm path — a hole that makes finding [1] worse and that the auditor did not spot. docs/ui/touch_control_wire.js:526-527 opens `window.addEventListener('pagehide', function () { if (!state.armed) return;` and the arm handler sets `state.armed = false` at line 444 BEFORE releaseControl() is called at 452. So if the six-way Promise.all at 360 hangs and the operator closes the tab, the keepalive `arm-fade target:1` at 534-536 never fires. Recovery then depends entirely on the engine-side deadman noticing the socket close (api_server.js:11665) — which does work, but the panel's own last-ditch guard is inert exactly when it is needed.
- Finding [2] missed its own mitigation: docs/ui/touch_control_wire.js:2274, `if (state.armed) sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true });` inside the socket 'open' handler, re-declares the arm on every reconnect, and state.armed is already true at that point (set at 444 before takeControl at 452). That bounds the deadman-less window to the 2 s backoff rather than leaving it open-ended.
- Finding [0]/[1] both missed that IntensityController.armFade is transient by construction — intensity_controller.js:16-20, `this.armFade = 1;` with the comment 'TRANSIENT — never persisted, always 1 on construction, so no restart can come back holding the ship down.' An engine restart is therefore a guaranteed recovery from any stuck envelope, which materially caps the worst case below CRITICAL.
- Finding [3] missed that a peer surface can undo a zeroed section dimmer: CaptainPad ships a dimmer rack (CaptainPad/app/(tabs)/dimmer_rack.tsx:358) that POSTs /section-brightness via utils/api.ts:526. The engine has no failsafe for it — which is the finding's real point — but it is not operator-unrecoverable.
- armLeaseSet (api_server.js:4516-4521) silently OVERWRITES an existing entry for the same ownerId with no rejection or warning. Combined with the zero-entropy OWNER in finding [5], a collision does not merely 'corrupt' the lease — it silently orphans the first panel's deadman with nothing logged as a conflict (the log line at 4519 reads as a normal arm).
- THE PAGE-0 CLAMP. vsn1_layout_deploy.js:506-521 filters the affected-page list down to page 0 only ('the device is a fixed page-0 surface … we drop pages 1-3 entirely'). Slots 9-24 are pages 1-2 (pageOfSlot, global_effect_slot_manager.js:111-112). The auditor never opened the deploy hook, and two of its findings (2 and 7) rest on hardware effects that this clamp prevents. Anyone auditing VSN1 interaction has to read this file first.
- LEGACY-EFFECT STATE DIVERGENCE ON DISARM — strengthens finding 1 with a mechanism it did not name. `_dispatchLegacy` (global_effect_slot_manager.js:1526-1546) calls only `controller.setEffect(effectId, next)`; unlike POST /global-effect (api_server.js:6117-6119) it never writes globalsState.effects and never calls saveGlobals. The panel's CLEAN disarm path calls POST /global-effects/disable-all (touch_control_wire.js:412 -> api_server.js:6622-6634 -> disableAll at global_effect_slot_manager.js:983-999, which reaches the fogger because _isSlotActive handles it at :1334-1335). So a normal, orderly disarm turns the fogger OFF live but leaves `fogger: true` on disk, and state_manager.js:452-463 turns it back ON at the next boot. The crash path is not the only way to get a boot-time fogger.
- THE PANEL'S JUSTIFICATION FOR THE RISKY ROUTE IS CONTRADICTED BY CURRENT ENGINE CODE. touch_control_wire.js:1160-1166 uses POST /global-effect (the latching, persisting route) because 'pressing their slot twice does NOT toggle them off. MEASURED: two presses left fogger: true'. But _dispatchLegacy at global_effect_slot_manager.js:1533 is `else if (action === 'toggle' || action === undefined) next = !isOn;` — the slot press DOES flip a legacy effect, and it does NOT persist a latch to globalsState. The measurement the panel cites appears to predate the current dispatcher, and acting on it is what created the boot-restore hazard in finding 1.
- ARMING DURING PERFORMANCE MODE IS WORSE THAN FINDING 3'S SINGLE BUTTON. grep of both panel files finds ZERO references to performanceMode. rejectIfPerformanceMode gates PATCH /global-effect-slots/:id (api_server.js:6459), so a 409 fails all 16 provisionCell calls AND all the retire PATCHes from buildEffectSlots (touch_control_wire.js:1272-1278) at once on the arm chain (:488). Every cell then goes fx-unwired at .34 opacity but stays pressable, and reconcileEffects (:1369-1423) still presses slots 9-24 against whatever the engine holds — which in the persisted bank includes trigger-behavior dropHit slots. Unintended effects can fire from a panel that looks armed and correct.
- DISARM BLACKS THE SHIP OUT. touch_control_wire.js:417 ends releaseControlBody with `req('POST','/global-blackout',{ state: true })`. That is outside the effects dimension so I did not chase it, but it is the exact condition the state_manager.js:445-449 boot guard exists to undo — worth a targeted look by whoever owns the arm/disarm dimension. UNVERIFIED whether anything after :417 raises it again.
- POISONED GROUP-LEVEL DEDUPE CACHE — a second, independent way the engine holds sections at 0 while the panel shows them on. flushGroups sets groupLastSent[sId] = b (docs/ui/touch_control_wire.js:988) BEFORE calling write(), and write() is a silent no-op while disarmed (wire:109-113, `if (!state.armed) return Promise.resolve(null)`). queueGroup then dedupes against that cache (wire:972). groupLastSent is never reset anywhere (grep: only 968/972/988). Reachable sequence: arm, ALL OFF (engine + cache = 0), disarm; ALL ON while disarmed -> cache records 1, nothing is sent; re-ARM -> pushAllGroupLevels is not in armAsserts (only 913/919/922/1575/2076 are) and any later groupmodeschange dedupes 1 against 1, so the write is skipped. Those groups stay dark on the engine until each fader is physically moved by more than 1%, with the panel showing 100%. This is the mechanism that makes finding [0] genuinely hard for the operator to diagnose.
- GET /audio-sources REPORTS EVERY AUDIO SOURCE AS LIVE, ALWAYS — not merely stale. api_server.js:7090 tests hasOwnProperty on paramCenter.getAll(), and getAll (param_center.js:523-529) iterates the entire registry store, into which every mic/detector key is permanently spliced at param_center.js:121 from audio_signals.js:346-368. So a key that has NEVER been written since boot still reports live:true, and `audioPresent` at api_server.js:7099 is therefore always true. Finding [6] treats this as a missing recency check; it is worse — there is no liveness signal at all — and param_center.js:597-610 (getLastRevision) already exists precisely to answer this question and is unused here.
- A LEVEL BINDING WITH NO AUDIO HOLDS ITS GROUP AT ZERO, not at its last value. Because the mic keys are always present with their registry default (0), audio_bindings.evaluate never reaches its documented `anyPresent === false` -> gain 1 protection (audio_bindings.js:167-171) for a built-in key; it computes gain = 1 - depth + depth*0 = 0 at the panel's hardcoded depth 1 (wire:2026). Combined with the disarmed-write asymmetry in finding [5], one dropdown left set on a closed, disarmed panel with the Companion off = that group black for the rest of the engine's run.
- STALE INLINE CLAIM THAT ARM ASSERTIONS DO NOT LAND (needs a runtime check, UNVERIFIED here). wire:933-938 states as measured EVIDENCE that state.armed is not yet true when armAsserts run, and therefore that every write()-based assertion is refused — which is why the master assertion was switched to req(). But state.armed is assigned at wire:444, before takeControl is called at 452, and the assertions run at 501. If the comment is accurate, the two write()-based armAsserts — pushEffectGroups (wire:919 -> write at 1066) and pushFade (wire:1575 -> send/write at 1558) — are silently dropped on every arm; if it is stale, the comment is misleading about a safety-relevant path. I could not resolve this without running the panel, so I am flagging it UNVERIFIED rather than asserting either way.

---

## Refuted — findings that did NOT survive verification

Listed so the report can be judged on its accuracy, not just its length.

### Every ARM unconditionally re-PATCHes all 16 slots, and the engine treats key PRESENCE (not value change) as a layout change — so arming the panel triggers a two-page VSN1 serial re-flash

Claimed at `marsin_engine/lib/global_effect_slot_manager.js:738`. **Rejected because:** The central consequence does not happen. vsn1_layout_deploy.js:506-521 is a PAGE-0-ONLY CLAMP: 'the device is a fixed page-0 surface ... we drop pages 1-3 entirely and only ever queue page 0', implemented at :513 `const clampedPages = pages.filter((p) => p === 0)`. pageOfSlot (global_effect_slot_manager.js:111-112) puts slots 9-16 on page 1 and 17-24 on page 2, so the panel's 16 PATCHes emit ONLY pages 1 and 2 -> clampedPages is empty -> :528 never arms the debounce -> runFlush never spawns the CLI (:403-404) and the multi-page soft reset (:448) never runs. There is no two-page serial re-flash and no COM12 open on arm. The mechanical premises ARE correct (_patchTouchesLayout is presence-keyed at :736-739 with no value compare; provisionCell always sends all five keys at touch_control_wire.js:1233-1239; buildEffectSlots runs on every arm from :488; vsn1.deployLayout: true is in HEAD's config.yaml:17-20). What actually results is 16 writeLayoutFile rewrites of states/titanic/vsn1_layout.yaml (:489, unconditional, before the enable check) plus 16 persistGlobalEffectSlots writes per arm — redundant I/O and log spam, not a hardware flash.

### marsin_engine/effects/hue_shift.js is orphaned — its only importer is its own test

Claimed at `marsin_engine/effects/hue_shift.js:1`. **Rejected because:** The import facts are right (repo-wide grep for hue_shift: only tests/effects/hue_shift.test.js:27 imports it; global_effect_library.js:9-26 does not), but the conclusion 'orphaned' contradicts the file's own documented purpose. hue_shift.js:7-12 states the global hue shifter was REMOVED by operator decision and 'This float module stays as the reference implementation + unit-test ground truth' for pattern_mixer's applyHueShift6chU8, and tests/effects/hue_shift.test.js:6-9 restates the same contract. A reference implementation whose only consumer is the test that pins the production byte implementation against it is doing exactly its job. This is a non-defect dressed as one.

---

## Factual notes (not defects)

- [arm-lifecycle] === 1. THE EXACT ORDERED ARM SEQUENCE ===

P0. touch_control.html:1651-1657 — the page's OWN #arm click handler runs FIRST (its inline <script> at 1640 is parsed before the wire, which is document.write-injected at 3885). It does: classList.toggle('is-armed') → aria-checked → armState.textContent='ARMED' → armLock='🔓' → shell.classList.remove('disarmed'). It talks to nothing and gates nothing. THE UI SAYS ARMED HERE, before a single byte has left the tab.

W0. touch_control_wire.js:440-443 — the wire's own click listener on the same element schedules setTimeout(fn, 0) so it reads the class the page just set rather than keeping a second copy of the truth.

W1. :444 — state.armed = armEl.classList.contains('is-armed')  → true. THIS IS THE MOMENT every write() in the file unlocks (:110) and the moment the 2 s poll starts calling reconcileEffects() (:2350).
W2. :445 — setStatus() (writes a detached DOM node; see findings).
W3. :452 — armStep = takeControl().
W4. :453-461 — armDeadline = a bare setTimeout resolving 'timeout' at 8000 + ARM_FADE_MS = 9500 ms.
W5. :462 — Promise.race([armStep, armDeadline]).

Inside takeControl (:273-345), in order:
 T1. :282 — WS frame on /ws/control: {type:'touchControlArmed', ownerId:OWNER, armed:true}. THIS IS WHERE THE DEADMAN LEASE IS STAMPED. Engine side: api_server.js:11574-11592 → armLeaseSet(ownerId, ws) at :4516 → armLease.set(ownerId,{expiresAt:now+15000, ws}) + armSweepArm(). Fire-and-forget; the ack at :11590 is never read (no 'message' listener on controlWs).
 T2. :283 — HTTP POST /arm-fade {target:0, durationMs:1500}. Engine: api_server.js:6040-6066 → IntensityController.startArmFade(0,1500) (:54-71), which returns IMMEDIATELY and sets _armFadeRamp; the ramp is ticked from apply() every frame (:98-101, :131-142). Broadcast {type:'armFade'} on /ws/control.
 T3. :284 — waitMs(1500) client-side. Ship is now at 0.
 T4. :286-287 — Promise.all of three GETs: /autopilot, /deck/color-autopilot, /param-center.
 T5. :290-291 — capture priorAutopilot, priorColorAutopilot (page-local only; they die with the tab).
 T6. :309-318 — THE RATCHET FIX. If /param-center reports a sourceLock with mode !== 'open', a previous panel died while armed, so the captures are DISCARDED and replaced with {active:true}/{active:true}, and fail('arm', …) is called.
 T7. :326-333 — POST /param-center/source-lock {mode:'per-param', leases:{colorPalette1, colorPalette2, colorTransitionMs, motionTransitionMs, rotate, speed → 'api'}}.
 T8. :334 — POST /autopilot {active:false}.   (persists — api_server.js:7233 saveAllState)
 T9. :335 — POST /deck/color-autopilot {active:false}.
 T10. :339 — POST /global-effects/disable-all {}.
 T11. :340 — silenceOverlays() (:225-244): GET /mixer, stash each non-deck channel's fader into priorOverlayFaders, then N SEQUENTIAL PATCH /mixer/channels/:id {fader:0}.
 T12. :341 — POST /global-blackout {state:false}.  ← THE SHIP IS ONLY ALLOWED TO BE LIT HERE, LAST.
 T13. :343 clearError() / :344 .catch → fail('take control', e). takeControl NEVER rejects; it always resolves.

Back in the race chain:
 W6. :463-468 — if the deadline won, fail('arm', 'setup did not finish in 9.5s'). NOTE: this is a RACE, not an abort. takeControl keeps running underneath, so T7-T12 can land AFTER everything below.
 W7. :475 — .catch(fail('arm')).
 W8. :477-478 — console.log diag; `if (!state.armed) return;`  ← the ONLY re-check of armed state in the whole post-race chain.
 W9. :488 — buildEffectSlots().
 W10. :489 — pushPalette(); pushEffectColours()  (PATCH /global-effect-slots/:id per colour-capable slot ≥ OURS_FROM).
 W11. :490 — reconcileEffects()  (GET slot state, then POST …/press for each disagreement).
 W12. :498 — .catch(fail('arm')).
 W13. :500-503 — armAsserts.forEach, SYNCHRONOUS AND UNAWAITED, in registration order: pushAllAudioBindings (:913) → effect-scope re-push (:919) → master PATCH /mixer {master} (:922-940) → pushFade (:1575) → pushParkedGroups (:2076).
 W14. :514 — applyStatic() — awaited. Debounces STATIC_MS=500 ms then issues up to 24 staggered PUT/DELETE /group-fixed-colors with ownerId=OWNER, resolving only when the LAST staggered write settles (:1821).
 W15. :515 — .catch(fail('arm assert')).
 W16. :516 — POST /arm-fade {target:1, durationMs:1500}. THE SHIP FADES UP. This is the last step; nothing verifies it.

Total HTTP calls on a nominal arm: 2 arm-fade + 3 GET + 5 POST + 1 GET /mixer + N overlay PATCH + slot builds + palette + effect colours + reconcile + master + fade + parked + scope + 24 audio bindings + up to 24 paint writes.
- [arm-lifecycle] === 2. THE EXACT ORDERED DISARM SEQUENCE ===

P0. touch_control.html:1651-1657 — same page handler, toggles is-armed OFF, text → 'DISARMED', lock → 🔒, shell gets .disarmed. Again: the UI says DISARMED before anything has been handed back.

W0. touch_control_wire.js:443 — setTimeout(fn, 0).
W1. :444 — state.armed = false. ← EVERY write() IS NOW REFUSED (:110). This is why releaseControlBody uses req() throughout, not write().
W2. :452 — armStep = releaseControl().
W3. :453-461 — the SAME 9500 ms deadline is raced against the disarm.

Inside releaseControl (:347-355):
 D1. :352 — POST /arm-fade {target:0, durationMs:1500}.
 D2. :353 — waitMs(1500).
 D3. :354 — releaseControlBody().

Inside releaseControlBody (:357-436):
 D4. :360-399 — ONE Promise.all, six calls fired CONCURRENTLY (note: the exact concurrency takeControl refuses to use):
     • POST /audio-bindings/clear {}            (:366)
     • PUT  /effect-groups {groups:null}        (:372)
     • PUT  /parked-groups {groups:null}        (:375)
     • POST /param-center/source-lock {mode:'open'}  (:376)
     • POST /autopilot {active: priorAutopilot ? !!priorAutopilot.active : true}  (:391-396; the no-capture branch also fail()s loudly)
     • POST /deck/color-autopilot {active: priorColorAutopilot ? … : true}        (:397-399)
 D5. :401 — restoreOverlays() (:246-254): Promise.all of PATCH /mixer/channels/:id {fader: prior}, then priorOverlayFaders = null.
 D6. :403-408 — clear the local `painted` map, then Promise.all of DELETE /group-fixed-colors/:name for every previously painted group.
 D7. :412 — POST /global-effects/disable-all {}.
 D8. :415 — restoreEffectColours() (:723-736): PATCH /global-effect-slots/:id {paramsOverride: original} for each slot the panel recoloured.
 D9. :417 — POST /global-blackout {state:true}.  ← THE SHIP GOES DARK HERE, AND STAYS DARK.
 D10. :418 clearError() / :419 .catch → fail('release control', e).
 D11. :426 — POST /arm-fade {target:1, durationMs:0}. Placed AFTER the .catch deliberately (:420-425) so the envelope is never what holds the ship dark.
 D12. :434 — WS frame {type:'touchControlArmed', ownerId:OWNER, armed:false}. THE DEADMAN LEASE IS RELEASED HERE, LAST. Engine: api_server.js:11589 → armLeaseClear(ownerId, 'clean disarm') at :4524. No revert is run — the panel is assumed to have done the handback itself.

Terminal state after a successful disarm: blackout ON (persisted), envelope at 1, source lock open, autopilots restored/forced on, overlays restored, paint gone, effects disabled, effect colours restored, NO deadman lease.
- [arm-lifecycle] === 3. ORDERING DEFECTS, MAPPED TO THE OPERATOR'S FOUR WINDOWS ===

A) THE WINDOW BETWEEN THE FADE TO BLACK AND THE DEADMAN EXISTING.
On the happy path this window is correctly closed: the lease is stamped at :282 BEFORE the fade at :283. But the stamp is a fire-and-forget sendControl that silently returns false when the socket is not open (:2258-2261) and whose ack (api_server.js:11590) is never read. The reachable case is the 2 s WS reconnect gap (:2278) after an engine restart or wifi blip, during which REST works and the WS does not. Arm there and the ship goes to black with nothing watching. Even when the socket is open, the WS frame and the HTTP POST are on different connections, so 'before' is best-effort, not guaranteed.

B) THE WINDOW ON DISARM BETWEEN CLEARING THE LEASE AND THE SHIP BEING LIT.
There is no such window, because the ship is never re-lit on disarm at all — D9 (:417) blacks it out on purpose, and D12 (:434) then releases the lease. The ordering within the disarm is correct (envelope up at D11 before the lease drops at D12, both after the .catch); the problem is the destination. A clean disarm terminates with a dark Titanic and no watchdog, while a CRASHED panel gets revertToAutomaticShow, which lights the ship as step 1 of 6 (api_server.js:4390-4403). Crash → lit; clean exit → dark. That inversion is the single largest ordering defect in the lifecycle.

C) CAN THE FADE-UP FIRE BEFORE THE LOOK HAS LANDED? Yes, partially. applyStatic() IS awaited (:514) and does resolve honestly on the last settled staggered write (:1821), so the group paint is covered. But armAsserts (:501-503) are synchronous fire-and-forget: the master PATCH (:939), the fade-bar push, the 24 audio bindings, the effect scope and the parked groups are all still in flight. The 500 ms applyStatic debounce usually hides this; on slow wifi it will not. README:108-110 promises the operator more than the code delivers.

D) THE Promise.race ARM DEADLINE (:453-462). It is a race with no abort — nothing cancels takeControl and nothing marks it stale. When the deadline wins at 9500 ms, W6-W16 run CONCURRENTLY with a takeControl still working through T7-T12. Consequences, in order of severity: (i) T12 (blackout off) can land after W16 (fade up) — or never, leaving a black ship reporting ARMED; (ii) T10 (disable-all) can land after W11 (reconcileEffects), silently killing every effect the operator selected; (iii) T11 (overlay faders → 0) can land after the reveal, so the ship visibly loses its overlays after the fade-up; (iv) T7 (source lock) can land after the panel has already given up on it. The deadline widening at :454-460 fixed the fade-lurch symptom but did not make the race safe.

E) STEPS THAT CAN SILENTLY NO-OP.
  • sendControl (:2258-2261) — returns false, never checked at :282 or :434. The deadman is the thing that no-ops.
  • armFadeTo (:264-267) — catches everything and resolves null. Both the fade-out (:283) and the fade-up (:516) can fail invisibly; the fade-up failing means a black ship.
  • takeControl's .catch (:344) — turns any takeover failure into a resolved promise, so the caller cannot tell a completed takeover from a failed one.
  • write() (:109-113) — returns Promise.resolve(null) whenever state.armed is false. Because state.armed flips at :444 BEFORE releaseControl runs, any applyStatic timer still pending from before the tap (STATIC_MS = 500 ms, :1775) silently discards its writes. Harmless here, but it is the same gate that made the original arm assertions vanish.
  • fail() itself (:84-88) — writes to a DOM node that is never attached (:69). Every 'silent' failure above is silent to the operator even when the code reports it.
- [arm-lifecycle] === 4. DOUBLE TAP OF ARM, TRACED ===

There is NO re-entrancy guard anywhere. The page handler (touch_control.html:1651) is an unconditional classList.toggle, and the wire handler (:440) starts a fresh sequence per click (:452). Two taps = two fully concurrent chains sharing one OWNER (:1585), one `painted` map, one priorAutopilot/priorColorAutopilot pair (:212) and one priorOverlayFaders (:213).

TRACE — tap ARM at t=0, tap again (DISARM) at t=1.0 s, mid fade-out:
  t=0.00  chain A: lease stamped (:282); POST /arm-fade{0,1500}
  t=1.00  page toggles to DISARMED; chain D: state.armed=false (:444); POST /arm-fade{0,1500} (restarts the ramp from wherever it is)
  t=1.50  chain A wakes from waitMs, does its 3 GETs, then T7-T12 sequentially → source lock ON, autopilots OFF, disable-all, overlays→0, blackout OFF
  t=2.50  chain D wakes from waitMs, runs releaseControlBody: source lock OPEN, autopilots ON, overlays restored, paint deleted, disable-all, effect colours restored, blackout ON, arm-fade→1, lease CLEARED (:434)
  Interleaving is arbitrary. Two representative outcomes, both bad:
   (a) chain A's T7/T8 land after chain D's D4 → source lock HELD and autopilots OFF with the panel reading DISARMED and no lease. This is byte-identical to the 'a previous panel died while armed' wreckage that the ratchet at :310-318 exists to detect after the fact.
   (b) chain A's T12 (blackout off) lands after chain D's D9 (blackout on) → the ship is LIT, running a frozen static look, disarmed, unlocked from nothing, with nobody driving.
  Also: chain A's post-race chain hits `if (!state.armed) return` at :478 and bails, so its fade-up at :516 never runs; the ship's level depends entirely on which of the two competing /arm-fade POSTs the engine processed last (IntensityController.startArmFade replaces _armFadeRamp wholesale, intensity_controller.js:69).

TRACE — the worse order, tap DISARM at t=0, tap ARM at t=1.0 s:
  chain D is still in its 1500 ms wait. Chain A stamps armLeaseSet at t=1.0 and begins the takeover. At t≈2.5-3.5 s chain D reaches :434 and sends {armed:false} — armLeaseClear deletes the lease by ownerId (api_server.js:4524-4526), the SAME ownerId chain A just registered. Final state: panel ARMED, takeover in place, NO DEADMAN. If the iPad dies now, nothing reverts the ship. Chain D's D9 (blackout true) may also land after chain A's T12 (blackout false), so the ship can additionally be dark.

TRACE — tap ARM, then tap DISARM during the ASSERTION phase (t≈4-7 s, applyStatic pending):
  chain D starts its fade-out; chain A's applyStatic resolves and unconditionally calls armFadeTo(1,1500) at :516 (no state.armed re-check after :478), fading the house UP into the middle of the disarm fade-DOWN.
- [arm-lifecycle] === 5. ENGINE RESTARTED WHILE THE PANEL IS ARMED ===

CLEAN RESTART (SIGTERM / POST /shutdown → closeNow, api_server.js:11822-11831):
  • shuttingDown=true is set first (:11828), so the WS-close revert is skipped (:11664) and the sweep short-circuits (:4545). Correct — a deliberate stop must not look like a dead panel.
  • The crash marker is deleted (:11115-11119), so the next boot does NOT revert.
  • Panel side: controlWs 'close' fires → retry every 2000 ms (:2276-2279). state.armed stays TRUE. Every HTTP call in the gap fails → fail('write', …) → invisible (detached pill).
  • Engine comes back with: armFade = 1 (transient by construction, intensity_controller.js:20 — good); sourceLock DROPPED loudly (state_manager.js:405-421); blackout false (the arm had set it false and it persisted) — but a persisted `true` would also be refused (README:253); master refused if persisted at 0 (api_server.js:3097-3100); autopilot active:false RESTORED (POST /autopilot persists, api_server.js:7233); overlay faders RESTORED AT 0 (PATCH persists, api_server.js:8745); audio bindings, effect scope, parked groups, group-paint leases all GONE.
  • On reconnect the wire re-sends ONLY touchControlHello + touchControlArmed:true (:2269-2274). The takeover is never re-run. Only the group paint self-heals, via the 5 s renew loop (:1827-1833).
  • Net: the panel says ARMED and holds a fresh lease, but does not hold the desk — CaptainPad/bpm-sync/MIDI/OSC can write the six params again, the audio-fader bindings are silently dead, and the overlays stay muted. The operator is told nothing.

CRASH RESTART (kill -9, power loss, unhandled throw):
  • The marker survives → crashMarkerPresentAtBoot is true (:11103) → revertToAutomaticShow runs at boot (:11139-11143), BEFORE autopilot.start(). It lights the ship, opens the lock, unrestricts scope/parked, clears audio bindings, and forces the 'default' playlist with the autopilots ACTIVE. It does NOT restore the overlay faders and does NOT restore the effect preset colours.
  • The panel then reconnects and re-stamps its lease over a rig that is now running the automatic show. The panel believes it owns the desk; the autopilot is changing patterns and palettes underneath it. The two now fight, with the operator's writes winning only until the next autopilot tick.
  • Because the arm lease is re-established, the engine will happily revert AGAIN if the panel later dies — that part is sound.
- [arm-lifecycle] === 6. DOES THE pagehide HANDLER COVER EVERYTHING THE ARM TOOK? ===

No. There are two pagehide listeners.

Handler 1 (:526-547), only when state.armed, three keepalive fetches, fired concurrently:
  1. POST /arm-fade {target:1, durationMs:0}   — raises the house first, correctly and deliberately (:528-533).
  2. POST /param-center/source-lock {mode:'open'}
  3. POST /audio-bindings/clear {}
Handler 2 (:1839-1844), unconditional: DELETE /group-fixed-colors/:name for every entry in `painted`.

What the ARM took, and who puts it back on pagehide:
  source lock          → handler 1, AND revert step 2 (api_server.js:4409). Covered twice.
  autopilot off        → NOT in pagehide. Covered only by revert step 6 (:4452), i.e. by the engine noticing the socket closed.
  color-autopilot off  → NOT in pagehide. NOT in the revert either — the revert forces the DECK autopilot on (timelineSetAutopilotOnDeck, :4453) but never touches /deck/color-autopilot. GAP.
  disable-all effects  → NOT in pagehide. NOT in the revert. The default playlist load is what changes the look; the effect slots stay disabled.
  overlay faders → 0   → NOT in pagehide. NOT in the revert (steps 1-6 at :4390-4455 contain no mixer-channel fader restore). Persisted to disk. PERMANENT GAP.
  effect preset colours→ NOT in pagehide. NOT in the revert. Persisted PATCH (:687-689). PERMANENT GAP.
  group paint          → handler 2, AND the engine's touch-paint lease + WS-close release (:11658), AND revert step 5 (:4439). Covered three times.
  effect scope / parked→ NOT in pagehide. Covered by revert step 3 (:4418).
  blackout released    → NOT in pagehide. Covered by revert step 1 (:4393), which also snaps armFade to 1 and raises the master.
  arm envelope         → handler 1, AND revert step 1. Covered twice.
  the arm lease        → deliberately NOT released. Correct: the WS close is what triggers revertToAutomaticShow (:11655-11671), so releasing it here would suppress the recovery.

Summary: pagehide plus the engine's WS-close revert together cover the mission-critical items (the ship is lit, the lock is open, the bindings and paint are gone, the automatic show is forced back). The uncovered residue is the colour autopilot, the disabled effect slots, and — the two that persist to disk and therefore survive every future restart — the zeroed overlay faders and the overwritten effect-preset colours.
- [engine-surface] COMPLETE ENDPOINT INVENTORY — REST, NOT gated by ARM (sent via req(), which bypasses the arm check at touch_control_wire.js:109-110). READS: GET /status, GET /exports, GET /dimmer-groups, GET /dimmers (all four in refresh(), line 131-135, at boot and every 2 s); GET /mixer (silenceOverlays line 226, refreshTempo line 893, every 2 s); GET /autopilot, GET /deck/color-autopilot, GET /param-center (arm only, lines 286-287); GET /global-effect-slots (loadSlots, line 1191); GET /global-effect-slots/status + GET /globals (engineOnSlots, lines 1311-1312, every reconcile); GET /audio-sources (boot, line 2305).
- [engine-surface] COMPLETE ENDPOINT INVENTORY — REST WRITES that are NOT gated by ARM: POST /arm-fade (arm line 265, disarm line 352, pagehide line 534); PATCH /mixer/channels/:id {fader:0} at arm (line 240) and {fader:prior} at disarm (line 249); POST /param-center/source-lock (arm line 326, disarm line 376, pagehide line 537); POST /autopilot and POST /deck/color-autopilot (arm lines 334-335, disarm lines 392-399); POST /global-effects/disable-all (arm line 339, disarm line 412); POST /global-blackout (arm false line 341, disarm true line 417); POST /audio-bindings/clear (disarm line 366, pagehide line 544); PUT /effect-groups {groups:null} and PUT /parked-groups {groups:null} (disarm lines 372,375); DELETE /group-fixed-colors/:group (disarm line 407, pagehide line 1841); PATCH /global-effect-slots/:id restoring the preset override (disarm line 732); PATCH /mixer {master} as an arm assertion (line 939, deliberately req() because state.armed lags — see the comment at 933-938); PUT /audio-bindings/effects/:slotId (line 1941) and PUT /audio-bindings/groups/:groupName (line 2027), both on dropdown change at any time; POST /mixer/tempo/source (SYNC button, line 945).
- [engine-surface] COMPLETE ENDPOINT INVENTORY — REST WRITES GATED BY ARM (via write(), refused with a resolved null while disarmed): PUT /pattern (line 560); POST /param-center for colorPalette1/colorPalette2 (line 661), speed (line 826), rotate (line 787), colorTransitionMs+motionTransitionMs (lines 1539, 1545, 1559); POST /control for sliderHue3-5 / sliderVal3-5 (lines 672,675), sliderTargetX/Y (780-781), sliderTouch (783, 798); PATCH /mixer {master} from the BRIGHT slider (1504), the XY pad's X axis (786) and the ship master strip (1081); POST /mixer/master/fade for the preset DIP transition (1548); POST /mixer/tempo {bpm} (864); POST /section-brightness (989); PUT /effect-groups with names (1066); PUT /parked-groups with names (2073); PUT /group-fixed-colors/:group (1614, 1797, and the 5 s renew at 1830); DELETE /group-fixed-colors/:group (1618, 1814); PATCH /global-effect-slots/:id for provisioning (1261), retirement (1275), effect colour (718) and live movement params (610); POST /global-effect-slots/:id/activate (611); POST /global-effect-slots/:id/press (1395, 1465); POST /global-effect {effect,state} for the four legacy DMX toggles fogger/vintageWhite/blastWhite/uvBlast (1392).
- [engine-surface] COMPLETE WS INVENTORY — two sockets, both to :6968. (1) ws://host:6968/ws/control (openControlSocket, line 2263): OUTBOUND only — {type:'touchControlHello', ownerId} on every open (2269) and {type:'touchControlArmed', ownerId, armed:true|false} at arm (282) / disarm (434) / reconnect-while-armed (2274). The panel never sends touchControlHeartbeat or touchControlRelease even though the engine implements both (api_server.js:11593, 11602). INBOUND: nothing — no 'message' listener is registered. The socket's real job is passive: the engine pings it every ARM_LEASE_MS/5 and the browser's network stack pongs, which is the deadman (api_server.js:11650-11653). (2) ws://host:6968/ws/signals (openMeterSocket, line 2284): INBOUND only — liveParams frames drive the meter and are republished into the page as the 'audionote' and 'audiobeat' DOM CustomEvents (lines 2226, 2239).
- [engine-surface] WHAT THE PANEL ACTUALLY CONTROLS WHILE ARMED, precisely: the deck channel's pattern and its exported sliders; the five-colour palette (slots 1-2 via the param centre, slots 3-5 via raw /control ids); global speed and rotate; both crossfade times; the engine grand master; per-group section brightness for the 24 groups in GET /dimmer-groups; per-group flat colour (leased, 12 s lease, renewed every 5 s); the effect scope mask and the parked (LOCK) set; effect slots 9-32 (binding, label, behavior, params) plus press/activate on any slot; the four legacy DMX toggles; the mixer tempo and tempo source; and all audio bindings. WHAT IT DOES NOT CONTROL: playlists, scenes, the timeline, the scheduler, MIDI/OSC config, panel firmware, deck overlays (it cannot even see them), and mixer channel content — it only zeroes overlay faders.
- [engine-surface] WHAT THE SOURCE LOCK ACTUALLY LOCKS OUT, precisely: mode 'per-param' with six leases to 'api' (touch_control_wire.js:326-333). Rejected writers are those whose source string is not 'api' — 'ws' (api_server.js:11612), 'osc' (osc_listener.js:650), 'colorAutopilot' (api_server.js:4829), 'timeline' (api_server.js:5218), 'bpm-sync' (bpm_speed_sync.js:191) and 'init' (state_manager.js:428). NOT rejected: anything over REST, because REST is hardcoded 'api'. The audio analyser's own writes (source 'audio', engine.js:2150) are unaffected because they target mic* keys, not the six leased ones. A rejected writer gets `{status:'ignored', reason:'source_lock', lockedTo}` back from param_center.js:1006-1007 — the value is simply not applied, no exception, no retry, no queue; over WS it becomes a paramRejected frame, over REST it is discarded (see the HIGH finding).
- [engine-surface] PERSISTED vs TRANSIENT, the full split for everything the panel writes. PERSISTED TO DISK: grand master and overlay faders → mixer_state.yaml (currently master: 0 and one overlay at fader: 0); section brightness → globals_state.yaml `dimmers` (currently 54 entries, one at 0); blackout → globals_state.yaml (guarded at boot); the six CPC params → globals_state.yaml `params` (the sourceLock inside it is written but deliberately never restored, state_manager.js:405-422); unleased group fixed colours → globals_state.yaml `groupFixedColors` (the panel's LEASED writes delete these instead); every /control slider → deck_state.yaml `localControls`; deck autopilot active/delay/shuffle → deck_state.yaml (currently active: false); colour autopilot → config.yaml (currently active: false); every effect slot binding and every enable/disable → global_effect_slots.yaml. TRANSIENT (in-memory only, safe across a crash): the arm envelope armFade (intensity_controller.js:17-20), the effect-group scope and the parked set (both plain controller fields, api_server.js:5855, 5894), the audio bindings, the touch-paint leases and the arm lease.
- [engine-surface] THINGS WITH NO WAY BACK EXCEPT A HUMAN OR A RESTART, collected: (1) group section brightness at 0 — survives even a restart, see the CRITICAL; (2) a stuck armFade of 0 — needs CaptainPad PANIC or a restart, and is invisible on every endpoint except GET /arm-fade; (3) overlay channels left at fader 0 — no engine path restores them, only CaptainPad's mixer or POST /mixer/panic (which forces them to 1.0, not to their prior value); (4) persisted group fixed colours deleted by an arm — gone, no restore anywhere; (5) effect slots 9-32 rebound and slots outside the grid disabled — persisted, no restore; (6) slots 1-8 (Deck/VSN1 hardware) switched off by disable-all on disarm — no restore.
- [engine-surface] THE ARM SEQUENCE'S OWN ORDER, for reference: declare the deadman over WS → fade to 0 over 1500 ms and wait → read /autopilot, /deck/color-autopilot, /param-center → (if a lock is already held, ignore the captured autopilot state — the ratchet fix, lines 310-318) → set the source lock → autopilot off → colour autopilot off → disable-all → silence overlays one at a time → blackout off. Then, outside takeControl and racing a 9500 ms deadline: buildEffectSlots → pushPalette → pushEffectColours → reconcileEffects → the armAsserts list (audio bindings, effect scope, parked set, master, fade bar) → applyStatic → fade up over 1500 ms. Everything after takeControl runs even if takeControl timed out or rejected, which is deliberate (lines 448-475).
- [engine-surface] POSITIVE OBSERVATIONS worth keeping: the takeControl serialisation, the engine-side fade ramp, the ping/pong-based deadman (correctly chosen over a JS heartbeat), the leased paint with a 12 s deadman, the never-restore guards on persisted blackout / zero master / persisted sourceLock, the unconditional armFadeTo(1,0) placed after the disarm .catch, the pagehide keepalive trio, and the trigger-vs-toggle SETTLE_MS handling in reconcileEffects are all sound and each closes a real, previously-measured failure. The problems above are gaps at the seams between them, not defects in the mechanisms themselves.
- [redundancy] SCOPE OF WHAT I READ: docs/ui/touch_control_wire.js in full (all 2354 lines), docs/ui/touch_control.html in full (3888 lines: the <style> block 25-1348, the markup 1350-1638, the page script 1640-3872), docs/ui/touch_control_v2.html in full, and targeted regions of marsin_engine/lib/api_server.js (5800-5830 for /dimmers and /dimmer-groups, 11150-11260 for the /ws/control replay-on-connect) and marsin_engine/lib/ws_topic_routing.js (the topic table header).
- [redundancy] THE TASK BRIEF'S PREMISE ABOUT THE FX BUTTON IS OUT OF DATE. The brief says 'The FX button was removed from the groups panel'. In the current tree it is present and load-bearing: the checkbox is built at touch_control.html:2401, published at 2868, restored from presets at 3302, and the wire turns the marked set into PUT /effect-groups at touch_control_wire.js:1050-1068 with an arm re-assertion at 919 and a disarm clear at 372. The CSS rule .fchk[data-k=fx] at line 1239 is live, NOT residue. What IS residue is the stale comment block at 2566-2571 claiming it was removed.
- [redundancy] CYCLE 5 and PAINT SHIP left essentially no residue. The only trace is the explanatory comment at touch_control.html:1851-1853 in the palette-actions handler ('Nothing else in this row latches: CYCLE 5 and PAINT SHIP were removed'), and there is no orphaned CSS, markup or handler for either. That comment is accurate and worth keeping as a why-not marker.
- [redundancy] The only two console.log statements in either file are the two [wire-diag] lines. Every other console call is a console.error or console.warn on a genuine failure path (assign() at 2232, presets/layout/order storage failures, dock refusal at 3833) — those are the codex's fail-loud posture and should stay.
- [redundancy] Several things that LOOK duplicated are deliberately so, with the reasoning recorded in comments, and I am not flagging them as defects: the inline master assertion at touch_control_wire.js:922-940 duplicates pushMaster() on purpose (comment at 923-926 explains it avoids depending on a var scoped inside `if (bank)`); the two lastFxGroups/lastParked dedupe keys are reset before re-asserting on arm (919, 2076) which is required, not redundant; and the capture-phase OWN listener at 1630 must be capture because the page's own handler at 2908 uses capture + stopPropagation (comment at 1623-1629).
- [redundancy] restoreEffectColours() (touch_control_wire.js:723-736) is NOT dead even though pushEffectColours() is. provisionCell() at 1260 writes liveOverride[id] = ov for movementTrace slots (colors/fadeSpan/switchMs), and pushMovementColours/pushMovementFade mutate it further, so the disarm-time diff against presetOverride is real work. Do not delete it alongside pushEffectColours.
- [redundancy] The wire opens two WebSockets. /ws/signals is fully consumed (paintMeter). /ws/control is write-only from the panel's side — it sends touchControlHello and touchControlArmed and relies on engine-side ping/pong for liveness — and deliberately has no message handler for the deadman's purposes. The redundancy finding is that the engine is already pushing mixer state down that same socket and it is discarded.
- [redundancy] Class-usage scanning method, for reproducibility: I tokenised the <style> block, collected all 185 class selectors, and tested each as a whole word against the concatenation of (markup + page script + wire). 23 came back with no reference outside the stylesheet. I then hand-checked every one of the 23 for dynamic construction and removed the five .fam-* classes from the list (built at 2225 as 'fx-cell fam-' + o.f). The remaining 23-5=18 names plus .tab/.tab.is-active (a false negative because the bare word 'tab' appears in prose comments) and .slider-h/.slider-vertical.bright (referenced only from dead JS) are what the CSS finding lists.
- [redundancy] Nothing in this dimension threatens the mission rule. I found no dead-code path that can leave the ship dark, no removed-feature residue that can hold a blackout, and no orphaned handler that writes to the engine. The two highest-impact items (the shadowed moveHandle and the dead BPM stepper) both degrade the operator's feedback and control surface without putting the rig at risk.
- [redundancy] Roughly quantified, the removable-with-confidence total is about 60 lines of CSS, about 35 lines of page script and about 45 lines of wire script — call it 140 lines out of ~6,240, i.e. a little over 2%. This is a tidy codebase by the standards of a file this size; the real finds are the four behavioural ones (shadowed moveHandle, dead stepper path, no-op pushEffectColours, detached status pill), not the volume of dead text.
- [recent-work] ARM ENVELOPE PLACEMENT IS CORRECT. intensity_controller.js:98-146 — tickArmFade() runs first (line 101) so the envelope keeps advancing under a blackout; the multiply (131-142) sits AFTER the blackout early-return and BEFORE the sectionBrightness early-return at line 146, which is the only placement that works (on the default path no section brightness has ever been set, so a multiply after line 146 would never execute). Ignoring the ignoreDimmerFor* bypasses and the LOCK/parked set is deliberate and correct — engine.js:1042 shows the grand master DOES skip parked groups, so armFade had to not, or a locked group would blaze through the fade.
- [recent-work] ARM FADE IS TRANSIENT AND CORRECTLY SO. `armFade = 1` in the constructor (intensity_controller.js:20) and it is never written to any state file — grep for armFade across marsin_engine/lib and states/ confirms it appears in no YAML. So no restart can come back holding the ship down. startArmFade throws rather than clamping (55-62) and the route turns that into a 400 (api_server.js:6056-6062), which is the right call for the last scalar before the wire.
- [recent-work] POST /mixer/panic DOES cover the envelope correctly. forceLit() at api_server.js:8385-8400 calls startArmFade(1, 0), which nulls any in-flight ramp, and it runs on every exit path including the two loud-fallback branches (8411, 8430) and the home-recall success path (8442). The deliberate decision at api_server.js:6033-6039 to have /global-blackout NOT reset the envelope is also correct — resetting it there would cancel the fade the arm sequence is hiding behind.
- [recent-work] THE SHUTDOWN GUARD WORKS. `shuttingDown = true` is the FIRST statement of closeNow() (api_server.js:11828), before armLease.clear() and before any client.terminate(), and both the sweep (4545) and the WS close handler (11664) check it. engine.js:2655 confirms closeNow() is called from shutdown(), which SIGINT/SIGTERM (2694-2695) and the in-band POST /shutdown (engineCore.requestShutdown, 2705) both route through. So a clean stop or a scene switch cannot masquerade as a dead panel. This one is solid.
- [recent-work] CRASH MARKER ORDERING IS CORRECT. Read once at api_server.js:11103 (`fs.existsSync`) during startApiServer; written only inside the server.listen callback at 11733; deleted only in closeNow at 11836. The revert at 11143 is correctly positioned after armAutopilotProfile (11121) and before autopilot.start() (11151), so the daemon starts on the reverted playlist rather than being reconfigured underneath itself.
- [recent-work] THE BOOT GUARDS THEMSELVES ARE CORRECT for what they cover. state_manager.js:445-450 forces a persisted `blackout: true` to false with a loud warning; api_server.js:3097-3103 refuses a persisted grand master of zero and boots at 1.0 while explicitly preserving a legitimate low-but-nonzero master; state_manager.js:417-422 warns about and drops a persisted sourceLock (globals_state.yaml lines 9-17 currently carry a per-param lock, so this path is live). Bypass-dimmer flags are also correctly session-scoped (state_manager.js:461).
- [recent-work] THE WATERLINE SWEEP TEMPO LOCK IS FULLY CORRECT — the one of the five that is. global_effects_controller.js:618 `tempoSyncFor(s.slotId, 'bar', s.sync)` then drives the head from `signals.barPhase`, which IS derived from the arbitrated `mixer.tempoBpm` at engine.js:863-868. Its depth also correctly goes through audioDrivenPrimary (639).
- [recent-work] BEAT PUMP has no rate parameter routed through tempoSyncFor at all (global_effects_controller.js:1068-1081 uses bp.rate raw), so listing it in TEMPO_CAPABLE_FX only buys the depth-hold from audioDrivenPrimary (1073). That is arguably the right outcome — the pump already runs off signals.beatPhase, which is genuinely tempo-derived — so I am NOT calling it a defect, but the panel's five-item list is really 'one fully correct, one correct-by-accident, one dead, two locked to 120 BPM'.
- [recent-work] THE TEMPO_SOURCES TEST IS ALL-OR-NOTHING: audio_bindings.js:192-193 requires `b.sources.every(k => TEMPO_SOURCES.includes(k))`, so a binding with sources ['bpmPulse','kick'] is NOT tempo-locked and rides the depth off bpmPulse via the MAX combine (165). The current panel UI cannot produce that (faderAudioWrite at touch_control_wire.js:2016 pushes exactly one source, and the BPM+stem button was deliberately removed per the comment at 1992-1995), so it is not reachable today — but the REST surface accepts it. Also correct: when the bound source is absent the `continue` at line 171 skips the tempoLocked flag, so a missing bpmPulse cleanly degrades to gain 1 rather than a half-locked state.
- [recent-work] GROUP audio bindings are deliberately excluded from the tempo lock (audio_bindings.js:192 gates on `scope === 'effects'`), which matches the design note at global_effects_controller.js:1645-1648 that a group binding drives a FADER. That is a considered decision, not an oversight.
- [recent-work] THE ARM LEASE TIMING IS SANE: ARM_LEASE_MS defaults to 15 s and throws loudly on a malformed env override (api_server.js:4485-4495); ARM_PING_MS = lease/5 = 3 s, so five pings fit inside one lease and a single dropped pong cannot expire it. sweepArmLeases pings before it judges (4547-4552), giving each socket a fresh chance. The sweep timer is unref'd (4509) so it never holds the process open.
- [recent-work] revertToAutomaticShow is well built for what it does: the re-entrancy guard at 4376, the per-step try/catch wrapper at 4378-4385 so one throwing step cannot abort the others, LIGHT THE SHIP first and never gated on anything below it, and a belt-and-braces outer catch (4459-4464) so it can never throw into a sweep timer. The ordering rationale at 4363-4369 is exactly right.
- [recent-work] THE PANEL DELIBERATELY BLACKS OUT ON DISARM (touch_control_wire.js:417 POSTs /global-blackout {state:true}), and this is documented intent — README.md:87 'Blackout re-engaged'. Worth flagging to the operator as an asymmetry rather than a bug: a CLEAN disarm leaves the Titanic dark, while a DEAD panel (deadman revert) leaves it lit and running the automatic show. The failure mode is safer than the success mode.
- [recent-work] UNVERIFIED — I did not run the engine, did not POST anything, and made no requests to :6968; nothing was listening during this audit. Every claim above is from reading the files named. I did not exercise the arm/disarm sequence end-to-end, did not reproduce the concurrent-request hang the wire documents as MEASURED (I take it as given from the source comments at touch_control_wire.js:228-231 and 319-325), and did not verify the show server's OS or /tmp retention policy for the crash-marker finding.
- [effects-integration] ANSWER 1 — COUNTS. ENGINE: 17 effects, 51 effect+preset pairs. Verified by importing marsin_engine/lib/global_effect_library.js and enumerating GLOBAL_EFFECT_LIBRARY: vintageWhite(1), blastWhite(1), uvBlast(1), fogger(1), strobe(5), dropHit(3), colorWash(5), invert(1), feedbackTrails(4), beatPump(3), movementTrace(9), waterlineSweep(3), kickPunch(2), freeze(3), crush(3), breath(3), sparkle(3). PANEL: 9 effects, 32 pairs (parsed straight out of the FX_OPTS literal at docs/ui/touch_control.html:2120). MISSING ENTIRELY, by name: Vintage White Boost (vintageWhite|default), Blast White (blastWhite|default), UV Blast (uvBlast|default), Drop Hit / Whiteout (dropHit|white_drop, dropHit|iceberg_flash, dropHit|vintage_burst), Color Wash Takeover (colorWash|ocean_blue, |iceberg_cyan, |emergency_red, |vintage_amber, |purple), Invert (invert|default), Kick Punch (kickPunch|punch, kickPunch|ice_punch), Frost Sparkle (sparkle|fizz, sparkle|blizzard, sparkle|hihat). MISSING PARTIALLY: Waterline Sweep — the panel has only shadow_pass; rising_tide and beat_wipe are absent. Total missing = 19 pairs across 9 effects (8 wholly absent + 1 partial). Note the effects/ DIRECTORY has 19 .js files, but group_fixed_color.js is the group-paint helper used by the controller (global_effects_controller.js:31) and hue_shift.js is orphaned — neither is a GEM library entry.
- [effects-integration] ANSWER 2 — WHERE FX_OPTS COMES FROM. It is HARDCODED. `var FX_OPTS = [...]` at docs/ui/touch_control.html:2120 is a static one-line JSON literal. Neither touch_control.html nor touch_control_wire.js ever issues `GET /global-effect-library` — the only two matches for that string in docs/ui/ are comments (touch_control.html:2113 and touch_control_wire.js:1151) that describe the data as having been 'read off' the library, i.e. it was pasted by hand at some past moment. The only consumer of that endpoint in the whole repo is CaptainPad (CaptainPad/utils/api.ts:2577); the engine serves it at api_server.js:6175 via `describeLibrary()`. PLAINLY: yes, this is the integration blocker. Adding an effect to the engine changes nothing on the panel until a human edits this literal AND the FX_SHORT map. The page already learned this lesson once at a narrower scope — the comment at touch_control.html:2140-2144 explains that a hardcoded FAMILY list 'silently dropped the whole MOVEMENT family the day it was added' — and the fix de-hardcoded the families but left the options hardcoded.
- [effects-integration] ANSWER 3 — WHY 16 SLOTS, AND WHO ELSE OWNS THEM. Nothing in the engine decides 16. `FX_SLOTS = [9..24]` (touch_control.html:2126) is a hand-written list sized to the 4x4 CSS grid (touch_control.html:793-798), starting at 9 because the wire reserves 1-8 for the Deck/VSN1 (`OURS_FROM = 9`, touch_control_wire.js:1212). The engine's real ceiling is `MAX_SLOTS = 32` in 4 pages of 8 (global_effect_slot_manager.js:86-90), so slots 25-32 are unused — 8 more buttons are available as far as the ENGINE is concerned. SHARING: the slot table is global and persisted (marsin_engine/states/titanic/global_effect_slots.yaml, version 3, one 'edit' bank). CaptainPad does NOT collide: `SHOW_EFFECT_PAGES = false` and `resolveEffectsPage()` pin its grid to page 0 = slots 1-8 (CaptainPad/components/global_effect_macros_logic.ts:43-69). The VSN1 DOES collide: marsin_engine/states/titanic/vsn1_layout.yaml lines 52-147 show slots 9-24 on pages 1 and 2, already bound to the panel's own defaults with the panel's own FX_SHORT names (PULSE, 2 COLOUR, 5 COLOUR, BY GROUP, STROBE, DUCK, SWELL, TRAILS, SWEEP, FREEZE). WHAT BREAKS when the panel repoints a slot another surface uses: (a) the other surface's binding is destroyed and PERSISTED (patchSlot → persistGlobalEffectSlots, api_server.js:6467-6468); (b) a `globalEffectSlots` WS broadcast repaints CaptainPad; (c) a `layout-changed` event fires and, with `vsn1.deployLayout: true` in config.yaml:18, spawns `deploy_layout.cjs --page N --live` which takes exclusive hold of COM12 for 10-40 s per page (vsn1_layout_deploy.js:21-23); (d) any slot in 9..32 that no panel button claims is PATCHed `enabled:false` on every arm (touch_control_wire.js:1272-1277). Additionally, while armed the panel presses OFF any running slot it does not claim, INCLUDING 1-8 (touch_control_wire.js:1407-1415) — so it interferes with CaptainPad's and the VSN1's page-0 effects too, contradicting docs/44 §2.8.
- [effects-integration] ANSWER 4 — FX_CAPPED. `var FX_CAPPED = { dim: 1, flash: 1, frame: 1, move: 1 }` (touch_control.html:2127); `texture` is deliberately absent and therefore stacks freely. The reasons are recorded verbatim in FAM_HELP (touch_control.html:2128-2134): DIM 'multiplies brightness down. One at a time: three stacked measured 23.8% of full output' — a measured VISIBILITY guard, the most mission-relevant cap on the panel; FLASH 'adds light. One at a time: stacked they clip to white'; FRAME 'changes frame state. One at a time: freeze stops the pattern'; MOVE 'two would overwrite each other'. Enforcement is in setCellOn (touch_control.html:2318-2322): lighting a capped cell calls releaseCell() on every other lit cell of the same family. WOULD ADDING MORE EFFECTS VIOLATE A CAP? No — a cap is enforced per family at press time, so N options in a family still only ever run one. The caps actually make the additions SAFER: dropHit/blastWhite/uvBlast belong in the already-defined-but-empty `flash` lane and would be auto-limited to one; colorWash is a takeover and is a natural new capped family (or 'frame'); invert, crush and sparkle are compose-freely 'texture'. The only cap that needs a decision is where colorWash goes — it is a `mode:'replace'` takeover for emergency_red, which is closer to FRAME than to TEXTURE.
- [effects-integration] ANSWER 5 — FX_SHORT AND THE FAIL-LOUD PATH. FX_SHORT (touch_control.html:2182-2215) maps 'effectId|presetId' → [NAME<=8 chars, variant<=9 chars] for the two-line button face; the long `o.l` wording stays in the dropdown. When an effect+preset has no entry, `assign()` hits the fail-loud path at touch_control.html:2228-2235: it `console.error`s '[touch-control] FX_SHORT has no entry for "<e>|<p>" - the button will show the raw label. Add it to FX_SHORT.' and then falls back to `face = [o.l, '']`, so the button visibly shows the whole long unstyled label on line one with line two blank. This is a GOOD, working guard (codex P0) and is the single best thing about the current design — it means an integration that adds FX_OPTS entries and forgets FX_SHORT is loud in the console and ugly on screen rather than silent. It is the model the FX_OPTS/TRIGGER_EFFECTS/`s`-flag mirrors should follow.
- [effects-integration] ANSWER 6 — CONCRETE ORDERED INTEGRATION PLAN. REGISTRY STATUS FIRST: all 17 library effects are already fully registry-declared, so NO engine registry work is needed for any missing effect. Verified by calling getPrimaryIntensity/getPrimaryMode on every id. WITH a primaryIntensity AND a primaryMode: strobe (Flash Strength / Frequency 2-4-5-10-20 Hz, the only one with valueLabels), dropHit (Punch / Blend add-replace-max), colorWash (Wash Depth / Blend tint-replace-multiply-max), feedbackTrails (Trail Mix / Blend), beatPump (Pump Depth / Tempo 0.5-1-2), waterlineSweep (Sweep Depth / Sync free-beat-bar), kickPunch (Punch Strength / Source auto-dropPulse-kick), freeze (Hold Fade / Hold 0-2000-5000), crush (Crush / Levels 2-3-4-6-8), breath (Breath Depth / Period 8-14-20 s), sparkle (Sparkle Density / Audio false-true). WITH primaryIntensity ONLY: movementTrace (Trace Amount; primaryMode null). WITH NEITHER (explicit null on both): vintageWhite, blastWhite, uvBlast, fogger, invert. Note the panel drives NONE of this today — it never calls /global-effect-slots/:id/intensity or /mode/cycle, by design ('the effect buttons carry NO amount fader any more', touch_control_wire.js:1494-1496) — so effects run at preset defaults and VARIATION MUST COME FROM PRESETS IN THE LIBRARY, not from panel knobs. ORDER OF WORK: (0) Decide the slot ownership split with the operator FIRST — the panel currently squats on VSN1 pages 1-2; either move the panel to slots 17-32, give it its own bank, or formally cede pages 1-2. Everything else is wasted if this changes. (1) marsin_engine/lib/global_effect_slot_manager.js:737-739 — make _patchTouchesLayout diff values instead of keys, so re-provisioning cannot storm the VSN1 deploy. (2) docs/ui/touch_control_wire.js — route the fogger to POST /fog with its deadman, and make provisionCell reject visibly so a 409/400 reverts the button face. (3) docs/ui/touch_control.html:793-798 — make the grid rows derive from FX_SLOTS.length, so the grid can grow past 16 without clipping. (4) docs/ui/touch_control.html — REPLACE the FX_OPTS literal with a runtime build from GET /global-effect-library: keep hand-maintained only the effectId→family map and FX_SHORT, take `s` from `singleton`, take behavior from `behaviorTypes`/`defaultBehavior`, and fail loud (same pattern as line 2232) on any pair with no family and on any pair with no FX_SHORT. That single change is what stops this recurring. (5) Add the families' content: `flash` ← dropHit x3 + blastWhite; `texture` ← sparkle x3 + invert + uvBlast; `frame`/new `wash` ← colorWash x5; `dim`/`flash` ← kickPunch x2; `move`/`dim` ← waterlineSweep rising_tide + beat_wipe; `texture` ← vintageWhite. (6) Extend FX_SLOTS to whatever the ownership decision in (0) allows (up to 8 more, slots 25-32) and add matching FX_SHORT entries. (7) Fix the legend (touch_control.html:1580-1585) to derive from the families present, including MOVE. (8) Update docs/ui/README.md (drop or fulfil the kick punch / frost sparkle paragraph, fix '19 effects') and docs/44 §2.8 (the slots-1-8 switch-off policy). HOW TO AVOID THE HARDCODED-CATALOG TRAP: step (4) is the answer, but if a runtime fetch is unacceptable, the minimum acceptable substitute is a test that imports describeLibrary() and asserts FX_OPTS is a complete, exact cover of the registry — a red test the day an effect is added beats a silent omission.
- [effects-integration] ANSWER 7 — WHICH MISSING EFFECTS ARE WORTH ADDING FOR A NIGHT-TIME SHIP. WORTH IT / HIGH VALUE: dropHit (all three presets) — the panel currently has NO way to punch an accent; white_drop, iceberg_flash and vintage_burst are trigger-behaviour envelopes that add light and end by themselves, which is the safest possible class for a visibility-first rig, and the wire's trigger handling already exists (TRIGGER_EFFECTS, touch_control_wire.js:1211, and the momentary path at 1459-1469). blastWhite — a whole-ship white slam (blastWhite.js:14-16 sets r/g/b/w/a to 1.0 on every pixel); maximally visible, and because the panel drives the legacy four via the idempotent POST /global-effect set-not-toggle path it cannot get stuck the way a toggle can. colorWash — five presets including emergency_red at mode 'replace', the single most useful 'something is happening' cue on a ship, and the only reason it was dropped was the panel's 'the wheel owns colour' rule (touch_control_wire.js:1153-1158), which is a design preference, not a constraint. kickPunch — one of only two effects the engine treats as inherently audio-driven, already documented to the operator in README.md:185-188, and it reuses dropHit's envelope. sparkle — W-channel glints, additive, cheap, and it has an audioDensity mode; it is the other effect the manual already promises. waterlineSweep rising_tide and beat_wipe — the panel has only the DARKEN preset (shadow_pass); the two ADD-mode presets are the ones that put light on the hull, and waterlineSweep is one of only 7 effects that can tempo-lock. QUESTIONABLE: invert — no params, flips the operator's chosen hue to its opposite, and panicStop deliberately does NOT clear it (global_effects_controller.js:2079-2083); it would fight the colour wheel, which is the panel's core idea. vintageWhite — only touches pixels where fixtureType === 'VintageLed' && name includes 'head_' (vintageWhite.js:30-31), so on most of the ship it does visibly nothing; it belongs on the panel only if the operator specifically wants those heads. uvBlast — writes only px.u (uvBlast.js:12-14). UV alone reads as near-black to the eye; it is additive so it cannot darken anything, but a button whose only visible result is 'nothing happened' on most fixtures is a trap on a visibility-critical rig. DO NOT ADD WITHOUT FIXING THE DEADMAN FIRST: the fogger is already on the panel and is the genuinely dangerous one (see the HIGH finding) — it is the one effect here with a real-world unattended-hardware consequence, and it is currently latched through the endpoint the engine explicitly documents as unsafe for it.
- [effects-integration] The wire's engine-state readback will handle every missing effect correctly if it is added — I checked each one against GlobalEffectsController.getStatus() (global_effects_controller.js:1953-2033) and the wire's engineOnSlots (touch_control_wire.js:1309-1341). colorWash, feedbackTrails, freeze, crush, breath, sparkle, beatPump, waterlineSweep (reported under the key `sweep`) and kickPunch (key `kickRouter`) all carry a `slotId`, which is what the wire matches on, so key-name-vs-effectId mismatches do not matter. `invert` reports as a bare boolean and the wire already has a special case for exactly that (touch_control_wire.js:1321-1328). The four legacy DMX effects report only through globals.effects and the wire already reads that path (touch_control_wire.js:1330-1337). dropHit reports `{active, count}` with NO slotId, but reconcile skips trigger-behaviour slots entirely (touch_control_wire.js:1403), so it is not affected.
- [effects-integration] freeze declares the SAME param, holdFadeMs, as both its primaryIntensity and its primaryMode (freeze_frame.js:133 and :138). The comment says this is deliberate ('the same param the jog-wheel writes, quantized to a few musical stops'). I did not trace setSlotIntensity/setSlotMode far enough to say whether the stored normalized `slot.intensity` and `slot.mode` can end up disagreeing with each other after a mode cycle — flagging it as a thing to look at, not as a defect.
- [effects-integration] The BPM tempo-lock feature that just landed reaches only 5 of the 7 rate-owning effects from this panel. audio_bindings.evaluate flags tempoLocked for any effect slot bound to bpmPulse in level mode (audio_bindings.js:192-195), and the controller honours it in exactly four places: strobe phase-lock (global_effects_controller.js:1027-1034), breath period (1:362), waterlineSweep sync (1:618) and movementTrace sync (1:714); beatPump ducks on the beat grid by construction. The controller's own comment (global_effects_controller.js:1685-1688) names 7 rate-owning effects — the other two are kickPunch and frost sparkle, neither of which is on the panel. Adding those two is what would make the manual's EFFECTS section true.
- [safety-failure] Rule check, 'the master is absolute when armed': HOLDS for pixels. The grand master is applied in engine.js:1037-1046 after the effect chain and after applyGroupFixedColors, before the section dimmers and blackout, across all six channels. The two documented/undocumented exceptions are parked (LOCK) groups (engine.js:1042 `if (parked && parked.has(px.group)) continue;`) and the DMX-only fogger/horn/fire fixtures (see the applyDmx finding).
- [safety-failure] Rule check, 'LOCKED groups are immune to the master': HOLDS, engine.js:1042. Blackout still kills them (IntensityController runs later, intensity_controller.js:104), and the arm envelope also overrides them by explicit design (intensity_controller.js:126-131). Both match what README §GROUPS says.
- [safety-failure] Rule check, 'all groups off means ZERO light': holds only for pixels whose group resolves to a sId > 0 and that are not LOCKed — see the patches.yaml finding. Within that set it is enforced correctly (intensity_controller.js:148-165).
- [safety-failure] The arm envelope itself is well built for the hazard it addresses: armFade is transient and constructed at 1 (intensity_controller.js:20), the ramp is wall-clock and self-clearing (tickArmFade, intensity_controller.js:79-92), tickArmFade runs before the blackout early-return so the envelope stays coherent under a blackout, and it is snapped to 1 by both forceLit() (api_server.js:8394) and revertToAutomaticShow step 1 (api_server.js:4396). GET /arm-fade exists as a read surface (api_server.js:6067-6075). I found no path by which an engine restart comes back holding armFade down.
- [safety-failure] The boot guards are correct as written and each is loud: persisted blackout true is refused (state_manager.js:445-449), a persisted grand master of 0 is refused (api_server.js:3097-3103), and a persisted sourceLock is dropped with a warning (state_manager.js:405-422). The gap is that these three cover only three of the dark paths; the section-dimmer rack, which is the fourth and the one the panel drives most, has no equivalent.
- [safety-failure] pattern_mixer's 'never fully black' enforcer (pattern_mixer.js:782-820, floor value 10 after 8 frames) cannot protect against any panel-driven dark path: it runs on the mixer composite inside renderAll6ch, which is upstream of the grand master, the group paint, the effect chain, the section dimmers, the arm envelope and the blackout — all of which engine.js applies afterwards. It is also gated on _isExpectingLight(), which returns false whenever master is 0 (pattern_mixer.js:736).
- [safety-failure] The dirty-shutdown paths are genuinely well covered. pagehide raises armFade to 1 first, opens the source lock and clears the audio bindings with keepalive (wire:526-547), a second pagehide handler DELETEs every painted group (wire:1839-1844), and the WS close then triggers revertToAutomaticShow. closeNow() sets shuttingDown before terminating clients so a clean stop or a scene switch cannot be mistaken for a dead panel (api_server.js:11828), and clearCrashMarker only runs on the deliberate stop paths (api_server.js:11836). The engine's SIGINT/SIGTERM handler and POST /shutdown share one shutdown() that emits a blackout sACN frame (engine.js:2657-2691, 2694-2705).
- [safety-failure] revertToAutomaticShow's internal structure is sound: re-entrancy guarded (api_server.js:4376), every step individually wrapped so one throw cannot abort the rest, lighting the ship is step 1 and is not gated on anything below it, and the whole function is wrapped so it can never throw into a sweep timer or a WS close handler (api_server.js:4459-4467). The problems are what it omits (section dimmers, overlay faders), not how it runs.
- [safety-failure] Group paint leasing is correct and is the model the rest of the panel state should follow: leased paint is never persisted, is swept on lapse, is released on WS close, and every auto-release logs and broadcasts the same groupFixedColors message a manual DELETE does (api_server.js:4259-4266, 4315-4349). The 5 s renewal loop in the panel (wire:1827-1833) sits comfortably inside the 12 s lease.
- [safety-failure] POST /arm-fade carries no ownerId, no auth and no arm check — any HTTP client on the network can take the whole rig to black with one request, and only /mixer/panic, another /arm-fade, or an engine restart clears it. Practically low risk on an isolated playa network, but worth knowing it is the single most powerful unauthenticated endpoint on :6968.
- [safety-failure] GET /audio-bindings already returns `missing: ab.missingSources` (api_server.js:7106) — the reporting surface for a dead audio source exists and is simply never populated for the companion-death case, because the values are stale rather than absent. Fixing the staleness detection would light this up with no new API.
- [safety-failure] The comment at wire:933-938 ('EVIDENCE: ... So state.armed is not yet true when these run') is stale relative to the current code: state.armed is assigned at wire:444, before takeControl() and before armAsserts run. It is harmless today, but it is the stated reason two arm assertions use req() while two others use write(), so it will mislead the next person who touches that block.

---

## Explicitly UNVERIFIED

Stated so nothing here is mistaken for a measurement.

- [arm-lifecycle] NOTHING HERE WAS OBSERVED RUNNING. I did not start the engine, did not GET :6968, and did not open the panel in a browser. Every finding is derived from reading the source files cited. No behavioural claim has been executed.
- [arm-lifecycle] Whether iPad Safari coalesces a fast double-tap on #arm into one click event or emits two. The double-tap trace assumes two click events, which is what a deliberate 'tap, then tap again a second later' produces; a genuine sub-300ms double-tap may behave differently and I did not test it.
- [arm-lifecycle] Whether `pagehide` fires reliably on iOS Safari force-quit and on CaptainPad iframe teardown. The handler's correctness depends on it; I only verified the code, not the browser behaviour.
- [arm-lifecycle] Whether the engine's WS `close` event actually fires within a useful time on an iPad wifi drop (as opposed to the 15 s ARM_LEASE_MS sweep catching it). The code has both paths (api_server.js:11655 fast path, :4544 sweep backstop); I did not measure either.
- [arm-lifecycle] Whether CaptainPad can clear the blackout that a clean disarm leaves behind. I did not read any CaptainPad source. The claim that recovery requires 'another surface' rests on POST /mixer/panic (api_server.js:8377) and POST /global-blackout (:6021) existing, not on CaptainPad exposing them.
- [arm-lifecycle] The exact runtime of a nominal arm on real playa wifi. My statement that 2-3 poll ticks land inside the arm window is arithmetic from ARM_FADE_MS=1500 + ~10 sequential round trips vs POLL_MS=2000, not a measurement.
- [arm-lifecycle] Whether `POST /global-effects/disable-all` and `PUT /effect-groups` / `PUT /parked-groups` persist to disk. I verified persistence only for POST /autopilot (saveAllState at api_server.js:7233), PATCH /mixer/channels/:id (:8745) and POST /global-blackout (saveGlobals at :6028). The claim that the effect-preset colour PATCH persists rests on the wire's own comment at :688, not on my reading of the /global-effect-slots/:id route body.
- [arm-lifecycle] Whether `armAsserts` contains exactly the five entries I listed. I found the five `armAsserts.push` sites (:913, :919, :922, :1575, :2076) by grep; if any push is constructed dynamically or added in a file I did not read, the list is incomplete.
- [arm-lifecycle] Whether any code outside docs/ui/touch_control_wire.js and docs/ui/touch_control.html also toggles #arm or calls the arm endpoints. I grepped those two files thoroughly but did not audit CaptainPad or the simulation for /arm-fade callers.
- [engine-surface] I did NOT empirically reproduce the concurrent-browser-write hang that the HIGH finding on releaseControlBody depends on. I am relying on the file's own twice-repeated MEASURED claims (touch_control_wire.js:228-232 and 319-325) that five concurrent POSTs from this page to this engine never returned. The code structure (Promise.all of six req() calls with no timeout, followed by the fade-up and the deadman release) is verified; the probability of the hang is not.
- [engine-surface] I did not open the panel in a browser. The page half (docs/ui/touch_control.html, 3888 lines) was only grepped, not read — so I have not verified the page's own handlers for ALL ON / ALL OFF, the preset buttons, the palette resolution that publishes slots.dataset.palette, or the group modes JSON the wire reads from bank.dataset.modes. Findings about the page's behaviour are inferred from what the wire consumes.
- [engine-surface] I did not verify that any pixel in the loaded model actually carries sId 189, so I cannot say how much of the ship the live `"189":0` dimmer is currently darkening. The persistence-and-restore mechanism is verified; the visible extent is not.
- [engine-surface] I did not read CaptainPad's dimmer_rack.tsx. I confirmed the write path exists (CaptainPad/utils/api.ts:526 POSTs /section-brightness) and therefore that a manual recovery from the zeroed-dimmer state is possible, but I did not verify that the rack surfaces all 24 groups or that it can raise a group whose persisted key is a legacy numeric id.
- [engine-surface] I did not test the arm or disarm sequence against the live engine — the audit was read-only and I issued only GETs (/status, /arm-fade, /param-center, /effect-groups, /parked-groups, /autopilot, /deck/color-autopilot, /mixer, /dimmers, /dimmer-groups). The live overlay-at-fader-0 and dimmer readings are observations of the current state, not a reproduction of how it got there — though they match the predicted residue exactly.
- [engine-surface] I did not audit the OSC listener, the MIDI mapping engine, or the timeline writers beyond confirming which source string each passes to paramCenter, so my statement that the lock blocks them rests on the source-string comparison alone and not on tracing their call sites.
- [engine-surface] I did not check whether performance mode is ever enabled in practice, or whether CaptainPad warns the operator that it is on — only that the two panel endpoints are gated by it and return 409.
- [redundancy] I did NOT open the panel in a browser. Every runtime claim — that the XY pad handle stays frozen, that the MutationObserver on #bpmVal can never fire, that pushEffectColours writes nothing — is derived from reading the source and from a brace-depth analysis, not from observed behaviour. The moveHandle shadowing in particular would take about thirty seconds to confirm or refute by loading the page and dragging the pad; I recommend doing that before acting on it.
- [redundancy] I did NOT check whether an engine is running on :6968, and made no HTTP request of any kind. The claims about /ws/control replaying mixer state come from reading marsin_engine/lib/api_server.js:11163-11168, not from watching the socket.
- [redundancy] I could not determine whether any iPad in the field still has the old /docs/ui/touch_control_v2.html URL bookmarked. That is the only thing standing between that stub and deletion, and it is not answerable from the repository.
- [redundancy] I did not exhaustively verify that every one of the 23 unreferenced CSS classes is unreachable via a string built at runtime. I hand-checked all 23 and caught the .fam-* family that way, but a class assembled from a variable I did not anticipate could still slip through. The high-confidence subset is .tabbar/.tab, .meter-tab, .stem-*, .footer-*, .slider-h and .groups-grid, where I also confirmed the corresponding markup is absent or the comment says the feature was removed.
- [redundancy] I did not audit CaptainPad/ or simulation/ for anything that might reach into this panel's DOM from outside (for example a WebView injecting script that reads window.__wire or #masterStrip). I grepped both files and the repo for __wire and touch_control_v2 only. If such an injection exists, the window.__wire and masterStrip findings would be wrong.
- [redundancy] I did not attempt to verify the engine-side behaviour of the recent work named in the brief (arm envelope, panel deadman, crash boot policy, boot guards, BPM tempo lock, autopilot ratchet). This audit was scoped to redundant/dead code in the two docs/ui files, and I stayed inside that scope.
- [redundancy] The severity I assigned to the dead BPM stepper (MEDIUM) assumes the operator can set tempo from CaptainPad instead. I did not verify that CaptainPad exposes a tempo control. If it does not, the panel is the only tempo surface and that finding is HIGH.
- [recent-work] The concurrent-request hang itself (5+ simultaneous browser→engine writes never returning). I am relying on the wire's own repeated MEASURED claims at touch_control_wire.js:228-231, 319-325 and 954-957. I did not reproduce it. If that hang has since been fixed engine-side, findings 1 and 2 drop from 'will happen' to 'unbounded by construction' — the missing timeout is still real either way.
- [recent-work] The show server's operating system and whether os.tmpdir() survives a power cut there. On this Windows checkout %TEMP% persists across reboots, so the crash marker works; on a Linux box with tmpfs /tmp it would not.
- [recent-work] Whether any out-of-tree client (a script, the podium bridge, PortWatch) ever POSTs /param-center/source-lock. I only searched marsin_engine, CaptainPad and docs/ui. If one does, the ratchet's stale-lock fingerprint is broader than LOW.
- [recent-work] CaptainPad's Dimmer Rack tab exists (CaptainPad/app/(tabs)/dimmer_rack.tsx) but I did not read it, so I have not confirmed it can actually raise a group from 0 — that is the assumed recovery path that keeps the section-dimmer finding at HIGH rather than CRITICAL.
- [recent-work] Whether the 24 concurrent PATCHes in buildEffectSlots have ever actually hung in practice on this rig. The pattern matches the documented failure; I have no capture of it occurring.
- [recent-work] OWNER-collision probability. I reasoned about the range of performance.now() at script-eval time for this page size but did not instrument it, so the ~1% figure is an estimate, not a measurement.
- [effects-integration] I did NOT run the engine and did not GET :6968 — nothing was up to query. Every count and behaviour claim above comes from reading source, plus one read-only `node -e` that imported marsin_engine/lib/global_effect_library.js in isolation to enumerate the registry (a pure module with no I/O; it starts no server, opens no port and writes nothing).
- [effects-integration] UNVERIFIED: whether the VSN1 hardware can actually REACH pages 1 and 2 today. CaptainPad's comment (global_effect_macros_logic.ts:46-55) says the party redesign remapped the VSN1 side buttons away from paging, so pages 1-3 may be inert on the device even though the engine still flashes them. If they are inert, the panel's collision with slots 9-24 costs the flash time and the persisted layout but not live hardware buttons. I did not read tools/vsn1_config/ or docs/42 in full to settle this.
- [effects-integration] UNVERIFIED: whether a VSN1 is actually attached in the show configuration. vsn1_layout_deploy.js probes attach state at each decision point and skips cleanly when detached (one log line), so the re-flash-on-every-arm finding only bites when the device is plugged in. I could not test the probe.
- [effects-integration] UNVERIFIED: I did not measure the real wall-clock cost of a single-page VSN1 flash. The 10-40 s per page and 2-3 min per full 4-page flash are the numbers stated in vsn1_layout_deploy.js:21-23, not something I timed.
- [effects-integration] UNVERIFIED: whether performance mode is ever entered in practice at the playa. The 409 finding depends on someone pressing it in CaptainPad; the endpoint exists and is gated (api_server.js:6459, 10565-10613) but I have no evidence about operator habit.
- [effects-integration] UNVERIFIED: the exact visual result of latching blastWhite or colorWash|emergency_red on the real rig. I read the pixel math (blastWhite.js:14-16, colorWash presets at global_effect_library.js:262-289) but did not render anything in the sim, so my 'maximally visible' and 'most useful cue' judgements in Answer 7 are reasoned from the code, not observed.
- [effects-integration] UNVERIFIED: whether setSlotIntensity and setSlotMode can leave freeze's stored slot.intensity and slot.mode inconsistent, given both write holdFadeMs. I read the descriptors but not the two setters end to end.
- [effects-integration] UNVERIFIED: I did not audit the panel's PRESETS feature (presettransition) or the SPATIAL/palette paths at all — out of scope for this dimension. Anything those do with effect slots is unexamined.
- [safety-failure] The exact 2.3 s figure for the DIP dark gap. I confirmed the MECHANISM from the code (the fade-up POST is issued after restoreState's synchronous burst of up to 24 /section-brightness writes, each doing a saveGlobals) but I did not run the engine or measure the gap.
- [safety-failure] Whether any titanic GROUP spans more than one sectionId. The engine loads its model from marsin_engine/models/<scene>.js and no titanic.js exists in this tree (only dev_test_bench, led202, studio, studio_top_loft). I checked the models that do exist: studio has exactly one sId per group, studio_top_loft has sId 0 for all six groups (so its dimmer rack is entirely inert). The titanic risk is inferred from simulation/scenes/titanic/patches.yaml, where fixtures share sectionIds per wall/stack and four entries carry none at all.
- [safety-failure] The claim in api_server.js:4478-4484 that a WebSocket ping keeps being answered by an iPad through backgrounding and a locked screen. This is a platform behaviour claim about iOS Safari, not something the repo can prove; iOS suspends backgrounded apps including their networking. If it is false, the 15 s lease expiry will revert the show on a slept iPad — and per my finding on the close handler, the socket dropping does it instantly regardless.
- [safety-failure] Whether os.tmpdir() on the actual show server survives a reboot. This depends on the deployed OS and its /tmp policy; I only read the code path, not the machine.
- [safety-failure] Whether CaptainPad surfaces a source_lock rejection to its operator (the same gap docs/ui/README.md:128-132 already flags). I read the touch panel and the engine, not CaptainPad's rejection handling.
- [safety-failure] I did not query a running engine on :6968 — no engine was started and I made no network calls. Every finding is from static reading of the files cited.

---

# Reviewer's accuracy pass

I re-checked this report before publishing it. Four corrections to how it should
be read, and one finding I verified myself because it contradicts something I
previously reported as working.

## 1. The headline count is inflated — 97 findings, ~79 distinct issues

Six auditors worked in parallel on overlapping dimensions, so the same defect
was found up to four times. Measured duplicate clusters:

| Defect | Copies |
|---|---|
| Status/error pill never attached to the DOM | 4 |
| Overlay faders zeroed on arm, restored by nothing else | 4 |
| Disarm fires 6 concurrent requests through the documented hang path | 4 |
| Section dimmers never recovered by any failsafe | 3 |
| Deadman stamped without confirming, ship already black | 3 |
| Clean disarm leaves the ship blacked out | 3 |
| ARM has no busy lock / double tap interleaves | 2 |
| Strobe tempo lock inert | 2 |
| Audio bindings written while disarmed | 2 |

**18 redundant copies. Treat the real number as ~79.**

## 2. Duplicates were given INCONSISTENT severities

The same defect was rated differently depending on which auditor found it:

- "Clean disarm leaves the ship blacked out" — rated **CRITICAL**, **HIGH** and
  **MEDIUM** by three different auditors.
- "Status pill never attached" — rated **HIGH**, **MEDIUM**, **MEDIUM** and **LOW**.

Where copies disagree, take the HIGHEST rating (fail closed). The per-severity
counts in the summary table are therefore soft at the boundaries.

## 3. The three CRITICALs — I verified these myself, not just the agents

- **Blackout released LAST in takeControl** (`touch_control_wire.js:341`).
  Confirmed by reading 336-344: the chain is disable-all → silenceOverlays →
  `/global-blackout {state:false}`, and the only `.catch` is at 344. Any earlier
  failure or hang means the blackout is never released, while the post-race
  chain still runs the fade-up. Ship black, panel says ARMED, deadman healthy
  (it only fires on a panel that STOPS answering, not one that is alive and
  wrong). Note the engine's own `revertToAutomaticShow` states the opposite rule
  in its comments — "lighting the ship comes FIRST and is never gated on
  anything below it" — so the engine and the panel disagree on doctrine.
- **The fade-up is one un-retried POST** (`touch_control_wire.js:516`).
  Confirmed: `armFadeTo` swallows its own rejection and returns null, nothing
  re-reads `GET /arm-fade`, and there is no engine-side hold watchdog. A single
  dropped request leaves `armFade` at 0 = every pixel multiplied to zero, past
  the master, past LOCK, past the dimmer-bypass flags.
- **Clean disarm ends blacked out** (`touch_control_wire.js:417`). Confirmed by
  reading 414-436. This one is BY DESIGN — the original intent was that a
  disarmed panel never leaves the rig lit with nobody driving. But it directly
  contradicts the mission rule (ship visible at night) AND contradicts the
  deadman, which for the same underlying situation hands back to the automatic
  show instead. **Those two behaviours should converge; right now a dead panel
  produces a better outcome than a clean disarm.** That is worth an explicit
  operator decision, not a silent fix.

## 4. A correction to something I previously told you was working

The audit found, and **I independently confirmed by reading `engine.js:866-873`**,
that the signals object handed to every effect is:

    const signals = {
      beatPhase: tempoBpm > 0 ? beats - Math.floor(beats) : 0,
      barPhase:  tempoBpm > 0 ? (beats / 4) - Math.floor(beats / 4) : 0,
      audioPresent: false,
      micHigh: 0, kick: 0, dropPulse: 0,
    };

There is **no `bpm` key at all** (a repo grep for `signals.bpm` being assigned
returns nothing) and **`audioPresent` is hard-coded `false`**. So of the five
tempo locks I reported as wired:

| Effect | Reads | Actually works? |
|---|---|---|
| waterline sweep | `signals.barPhase` (from `tempoBpm`) | **YES** |
| beat pump | `beatPhase` scaled by `rate` | **YES** |
| movement trace | `signals.bpm` -> undefined -> 120 | **NO** — fixed 120 BPM |
| ocean breath | `signals.bpm` -> undefined -> 120 | **NO** — my bug |
| strobe | gated on `audioPresent` | **NO** — can never fire |

**Two of five work.** Two of the three failures are in code I wrote this session:
I used `signals.bpm` by copying movement_trace's existing pattern without
checking the key was ever populated, and I gated the strobe on an existing
`audioPresent` flag without checking it was ever true. I reported the tempo lock
as done on the strength of an API-level test (`tempoLocked` appearing in the
gains) — that proved the BINDING was classified correctly, not that the effects
then did anything different. That was the wrong proof for the claim.

The fix is small — add `bpm: tempoBpm` to the signals object and stop gating the
strobe on `audioPresent` — but this audit is read-only, so it is filed, not done.

## 5. What this audit did NOT do

- Nothing was executed. No arm, no disarm, no fade, no deadman fire. Static
  reading plus read-only GETs.
- The page half (`touch_control.html`, ~3900 lines) was grepped rather than read
  end to end by most auditors; findings about page behaviour are inferred from
  what the wire consumes.
- No auditor opened the panel in a browser, so runtime claims (the dead XY-pad
  handle, the unreachable BPM stepper) are from source analysis only. The
  redundancy auditor flagged the XY-pad one as "thirty seconds to confirm by
  dragging the pad" — do that before acting on it.
- CaptainPad's source was only partially read. The claim that it does or does
  not surface a `source_lock` rejection is not fully settled.

# 20260804_151 — BENCH MIRROR: the runtime, session-scoped "Titanic → physical test bench" mode

**Agent:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_151`
**Design document:** `.agent/reports/202608/20260804_150_bench_mirror_audit.md`
**Predecessors:** `_89` (the mirror), `_105` (M2/F2, F10, F12, F14), `_127` (route read-back contract).

IPs are redacted to `10.x.x.NN` in this prose per `.agent/os/security_privacy.md`.
The scene/config files carry the real values; the runtime UI shows the real
values on purpose (§5).

**No git operations. No server started, no port bound, no packet toward any
controller, no device HTTP, no engine restart.** The operator's live stack
(6966–6972, 5568, 8081, 10000) was never approached. Every verification is
in-process with mocked sockets (§7).

---

## 0. TL;DR

| | |
|---|---|
| **What ships** | A temporary, session-scoped **BENCH MIRROR** mode on the EXISTING system. Engine stays on `titanic`; the visible sim stays on `titanic`; **no second tab**. The bridge re-addresses the seven declared slices onto the bench and gives them back cleanly on disarm. |
| **The one substitution** | `isMirrorActive`'s precondition 3 is now an explicit **armed flag** instead of "the spec's own scene is in the bridge's active set". Preconditions 1 and 2 are verbatim. That single change removes the second-tab requirement. |
| **Arm scope** | **Socket-scoped** — the arming sim window's disconnect (or a bridge restart) disarms and releases. Plus an explicit DISARM button. Never persisted: a fresh bridge process is always DISARMED. |
| **Suppression** | Pair-level for the DMX gateway (`U2 → 10.x.x.10`); **whole-host** for the LED box (`10.x.x.60`), so the raw `U30/U31` relay can no longer light the strands and fake a working mirror. Declared per destination in the sidecar — never guessed. |
| **Schema** | `bench_mirror.yaml` **v1 → v2**: two new REQUIRED keys, `label` (top level) and `suppress_host` (per mirror). The **mapping is byte-for-byte unchanged**. |
| **`_105` fixes** | **M2/F2** — engine-owned pairs subtracted from `mirrorTargets`, refused at ARM, auto-disarm at recompute, refused when `ownedUnavailable`. **F10** — the suppression log has its own signature. **F12** — cross-sidecar destination overlap refused at ARM. **F14** — mirror-state reuse keyed on the parsed spec, not raw bytes. |
| **Disarm** | 3× all-zero 512-channel frames per owned destination universe, **awaited before** the senders close, on every disarm path (explicit / socket drop / degrade / SIGINT-SIGTERM). |
| **Tests** | `cd simulation && npm test` — **1826 tests, 1820 pass, 6 fail**, against a measured baseline of **1773 / 1767 / 6** on this tree. **+53 tests, zero new failures, byte-identical failing list.** (After the `_152` fixes in §11: **1833 / 1827 / 6**.) |
| **Post-review** | `_152` returned **FIX-FIRST** on one defect — a second writer during the disarm release window. Fixed, with the regression reproduced-then-killed by falsification. See **§11**. |

---

## 1. What the operator sees

**ARM/DISARM** lives in the 📡 **sACN IN monitor**, next to Clear in the
activity-log header (the BLACKOUT-button recipe). A new stat row **Bench
Mirror** reads `off — Titanic left front ready` / `ARMED — Titanic left front` /
`unknown`, and carries the refusal text when the bridge refuses.

**Status** is a **panel-independent HUD banner** (`src/gui/bench_mirror_banner.js`,
structural copy of `multi_client_warning.js`), fixed top-centre at `top:78px` —
below the multi-client warning so both are visible at once, in the amber
`--primary` palette rather than error red so an armed mode is never mistaken for
a fault. It reads:

```
🪞 BENCH MIRROR ACTIVE — TITANIC LEFT FRONT · owns U2→10.x.x.10, U10→10.x.x.60,
   U12→10.x.x.60 · owns all of 10.x.x.60 · ordinary relay suppressed
```

`TITANIC LEFT FRONT` is the sidecar's new `label` upper-cased — data, not a
hard-coded string. The banner is panel-independent **because the panel is not**:
`showSacnInMonitor` is gated on the lighting-engine mode being `sacn_in`
(`gui_builder.js`, `pattern_editor.js`), and switching modes hides the panel
without disarming the bridge.

The status is broadcast **on every transition and to every newly connected
client**, so a reloaded tab can never show stale state.

---

## 2. The state machine

`sacn_bridge.js` module scope:

```js
let _mirrorArm = null;        // null | { scene, sourceScene, label, destinations, hosts, ws, armedAt }
let _mirrorDisarming = false; // a blackout is in flight: do NOT close mirror senders
let _blackoutHold = null;     // what that blackout has not finished releasing (added post-review, §11)
let _blackoutSettled = null;  // promise for the in-flight blackout's frames (added post-review, §11)
```

There is deliberately **no cached status object**: `benchMirrorStatus()` rebuilds
it fresh from live state on every call, so a broadcast can never describe a
bridge that has since moved on. (An earlier draft of this report listed a
`_lastArmStatus` field; it does not exist in the code and never did — corrected
here per `_152` **D3**.)

Process memory only — never read from or written to disk, never from the
environment (pinned by a test that scans every `_mirrorArm` line for
`writeFile|readFile|JSON.parse|localStorage|process.env`). Precedent: the
engine's PERFORMANCE MODE.

| event | armed after | mechanism |
|---|---|---|
| bridge / launcher start | **OFF** | `let _mirrorArm = null` — by construction |
| bridge crash → `start.js` restart | **OFF** | new process |
| operator presses ARM | ON (if the checks pass) | `benchMirrorArm` |
| operator presses DISARM | OFF, blacked out | `benchMirrorDisarm` |
| the **arming** window disconnects / reloads | OFF, blacked out | `ws.on('close')` compares `_mirrorArm.ws === ws` |
| a NON-arming window disconnects | unchanged | same comparison |
| engine leaves the source scene / goes unreachable | OFF, blacked out, loud | `evaluateArmedHealth` on the next recompute (≤3 s, the engine poll) |
| sidecar stops parsing / `enabled: false` / disappears | OFF, blacked out, loud | same |
| engine claims a mirrored pair or a wholly-owned host | OFF, blacked out, loud | same, plus the recompute-time `mirrorEngineClash` branch |
| SIGINT / SIGTERM while armed | OFF, blacked out, then exit | `shutdown()`, bounded at 1500 ms |

---

## 3. Suppression — operator ruling 3, implemented declaratively

The ruling: **the bridge owns ALL relay toward `10.x.x.60`** (so the raw
`U30/U31 → .60` can no longer light the strands and produce the audit's §9 false
positive) **plus the pair `10.x.x.10/U2`** — and everything else, including
`.10`'s other universes, flows normally.

That is not derivable from the data. Measured against the real scene files, the
titanic scene routes **U2, U3, U4 → `10.x.x.10`** (`LeftFrontWall`) and
**U30, U31 → `10.x.x.60`** (`LeftLeftRopes`). A uniform host rule would silence
U3/U4 on a live ship controller; a uniform pair rule leaves the §9 trap open.
So the scope is **declared**, per destination, in the sidecar:

```yaml
  - dest_universe: 2
    dest_host: 10.x.x.10
    suppress_host: false      # the ship's gateway also runs U3/U4 here
  - dest_universe: 10
    dest_host: 10.x.x.60
    suppress_host: true       # same physical board the ship binds on U30/U31
```

`suppress_host` is **required and never defaulted** — both answers change what
the hardware does, so a missing key is a loud parse refusal, not an assumption.
Two entries for one host that disagree are refused at parse time. The pure
`partitionMirrorSuppression()` splits the effective route set into `relay` and
`suppressed[{why:'pair'|'host'}]`, and the bridge logs the two reasons
differently.

**This is why the schema moved to v2.** A v1 file is refused by name with the
migration spelled out. The **mapping itself is byte-identical** — all seven
slices, all three destinations, every address and length unchanged; the
`_89` live-map tests still pass untouched.

`label` is the other required v2 key: the HUD must be able to name the region
whose hardware changed hands, and inventing that name at render time would be a
fallback.

---

## 4. Fail-loud ARM — every branch named

`evaluateArmRequest({scene, specs, specErrors, engineState, activeArm, relayRoutes, clientCount})`
in `lib/bench_mirror.cjs` is **pure**, so all of this is unit-tested with no
socket and no engine:

| # | refusal |
|---|---|
| 1 | the arm message names no scene ("the bridge never picks one for you") |
| 2 | that scene's sidecar does not parse — the parse error is quoted |
| 3 | that scene declares no sidecar — the refusal lists the scenes that do |
| 4 | `enabled: false` in the file |
| 5 | already armed (same scene or another) — "a re-arm must go through the blackout, not around it" |
| 6 | the engine is unreachable — its scene is unprovable |
| 7 | the engine is on the wrong scene — **both** scene names given |
| 8 | `ownedUnavailable` — ownership unprovable ⇒ refuse (codex P0: no permissive default) |
| 9 | **`_105` M2** — a destination pair is in `engineState.owned` |
| 10 | **`_105` M2** — the engine owns ANY universe on a wholly-owned host |
| 11 | **`_105` F12** — another *enabled* sidecar claims an overlapping destination or host |

Warnings (loud, non-blocking, per **operator ruling 2**): the live relay routes
about to be suppressed; the whole-host takeover with the universes it darkens;
an owned host that nothing else feeds ("if the strands stay dark, the box is not
listening on these universes"); `>1` sim window with the priority-150 writer-#2
caveat; and the standing note that an LED push to a mirrored destination will
correctly FAIL its `_127` route read-back.

**Then the proof, not the intent.** After `recomputeRoutes('bench mirror
armed…')` the arm re-reads the LIVE sender maps through `buildRouteTableSnapshot`
— the same `_127` snapshot the LED push uses — and requires that every owned
pair is in `mirrorOwned`, in neither `routes` nor `engineOwned`, and that no
relay sender survives on a wholly-owned host. If any of that cannot be proven it
**auto-disarms and returns the failure as the arm's refusal**.

---

## 5. Protocol (`:6971`)

Two new inbound messages, one new broadcast. Nothing else on the socket changed;
`_127`'s `getRoutes` reply shape is untouched (no field renamed or dropped —
`normalizeRouteSnapshot` still throws on the three it requires).

| in | out |
|---|---|
| `{type:'benchMirrorArm', scene, reqId}` | `{type:'benchMirrorStatus', reqId, armed, scene, sourceScene, label, destinations[], hosts[], suppressed[], warnings[], refusal, reason, available[], specErrors[], clientCount}` |
| `{type:'benchMirrorDisarm', reqId}` | same shape, `armed:false` |

The same object **minus `reqId`** is broadcast to all clients on every transition
and sent to each new connection. Handlers **reply, never throw** — a refusal
thrown inside the message handler would vanish into the outer `catch` and leave
the operator with a button that did nothing.

Client side: `SacnInputSource.armBenchMirror(scene)` / `.disarmBenchMirror()`,
reqId-correlated with a 5 s timeout, rejected on socket teardown — the same
discipline as `queryRoutes`. A **broadcast** (no reqId) drives the banner but can
never resolve somebody's pending request. On socket close the banner is hidden
rather than left asserting a stale ARMED.

**Real IPs in the UI, redacted in this report.** The banner and the panel tooltip
are live operator state on their own screen; "ARMED" that does not name the boxes
is not actionable.

---

## 6. Clean disarm — the order is the feature

1. clear `_mirrorArm` and `_activeMirrors` **synchronously**, so nothing composes
   another frame and any recompute landing mid-blackout already sees a disarmed
   bridge;
2. send **3 all-zero 512-channel frames** to every owned destination universe and
   **await** them. Mandatory: the `sacn` package hardcodes `options = 0`, so
   E1.31's `stream_terminated` bit is unreachable, and `Sender.close()` is socket
   teardown only. Without this, `10.x.x.60`'s outputs hold their last composed
   look until an unknown device-side `dmx.timeoutMs` (`0` = forever, and this
   repo never writes that field);
3. **then** `recomputeRoutes(...)` — which closes the mirror senders and restores
   the suppressed relay in the same pass, so the DMX gateway is never unfed;
4. broadcast the transition; the banner clears;
5. the disarm line states plainly that the bench gateway is now fed **raw
   titanic** bytes — lit, wrong fixtures — because that is the ordinary
   titanic-only shape and must not read as a mirror bug.

`_mirrorDisarming` holds the mirror senders open for the duration, so a recompute
triggered by anything else (a client disconnect, an engine poll) cannot close the
socket out from under the blackout. `sendVia()` now returns its promise; the
relay's hot path ignores it.

---

## 7. Verification — offline, in-process, zero packets

### 7.1 The REAL bridge with fake sockets

`tests/bench_mirror_arm.test.js` loads the real `server/sacn_bridge.js` with
`Module._load` intercepting `sacn`, `ws` and `process_priority.cjs`, and
`globalThis.fetch` stubbed as the engine. **No `sacn` Sender or Receiver is ever
constructed, no WebSocket port is bound, and every "send" lands in an array.**
The controller addresses the assertions use are READ FROM the live sidecar, so
the test file carries no address literals of its own.

Proven end-to-end against the real recompute, the real packet path and the real
message handlers:

- a freshly constructed bridge is **DISARMED**, mirrors nothing, and the ordinary
  relay owns every pair the mirror would take;
- a refused ARM changes **no** route and puts **zero** frames on the wire;
- ARM makes the mirror the **only** writer to every owned destination; the
  wholly-owned host keeps exactly the composed universes and nothing else; the
  ship gateway keeps its other universes;
- while armed, inbound U2/U30/U31 frames produce **zero** raw sends to any owned
  destination, and the gateway's composed frame is always a full 512 channels;
- a tab that connects **after** the arm is told the state, and that status drives
  its banner;
- DISARM emits **exactly 3** all-zero frames per owned universe, then the relay
  resumes on `U2 → .10`, `U30 → .60`, `U31 → .60`;
- after disarm a raw U30 frame reaches the box again and nothing composes;
- the **arming socket dropping** produces the same 3-frame blackout, the named
  log line, and the same relay restoration;
- an **engine scene change** auto-disarms loudly (`BENCH MIRROR AUTO-DISARM`,
  `engine left scene 'titanic'`), blacks out, restores the relay, and broadcasts
  `armed:false`;
- ARM is then refused end-to-end with the wrong-scene reason, and refused again
  end-to-end once the engine stops reporting `outputRouting`.

Plus 23 pure cases for every refusal, every auto-disarm reason, the banner and
the panel control.

### 7.2 Counts

| | tests | pass | fail |
|---|---|---|---|
| Baseline, measured on this tree before the change | 1773 | 1767 | **6** |
| After | **1826** | **1820** | **6** |

**+53 tests (18 in `bench_mirror.test.js`, 35 new in `bench_mirror_arm.test.js`),
zero new failures, byte-identical failing list**, all six pre-existing and
unrelated: `fixtures are docked beside the ship…`, `REFUSES: a patched fixture no
chain reaches…`, `the real titanic scene can accept the block today…`, the two
scene-block CLI cases, and `the compression threshold has real headroom…`.

*Delta against the brief:* the brief quoted a 1773 / 1766 / **7** baseline; this
tree measured 1773 / 1767 / **6** before any edit of mine. One case in that
documented failing family now passes on this working tree — the working tree also
carries the operator's own uncommitted scene/model edits from earlier today
(§7.4), which is the likely cause. It is **not** a change of mine: the
measurement was taken before the first edit.

Focused re-runs: `bench_mirror.test.js` 48/48; `bench_mirror_arm.test.js` 35/35;
`bench_mirror + bridge_routing + bridge_route_readback + multi_client_warning +
per_output_push + led_controller_ui_round2 + panel_visibility` → **231/231**.

### 7.3 Gates

- `node --check` on all five touched/added JS files — clean.
- `git diff --check -- simulation` — clean.
- `python scripts/security_check.py --all` — **6 findings, all the pre-existing
  MAC in gitignored `simulation/.scene_backups/studiodj/**`**. Nothing in any
  file this slice touched. Identical to the recorded baseline.

### 7.4 Working-tree honesty

`git status` shows many modified files this slice did not touch
(`marsin_engine/models/test_bench*`, `marsin_engine/states/**`,
`simulation/scenes/{common,titanic,test_bench,studio*}/**`, the tracker). Every
one of them has an mtime between **2026-08-04 23:47 and 2026-08-05 00:38** — the
operator's own earlier session. My nine files are all **08:43–09:03**. No test
run in this slice wrote to the source tree.

---

## 8. Files

| File | Change |
|---|---|
| `simulation/lib/bench_mirror.cjs` | v2 schema (`label`, `suppress_host` + host-consistency refusal); `isMirrorActive(spec, engineScene, **armed**)`; new pure `mirrorOwnedHosts`, `partitionMirrorSuppression`, `evaluateArmRequest`, `evaluateArmedHealth`; `describeMirror` names whole-host ownership |
| `simulation/server/sacn_bridge.js` | `_mirrorArm` / `_mirrorDisarming` / `_blackoutHold` / `_blackoutSettled` / `_lastRelayRoutes` / `_lastSuppressedSig`; armed-health gate at the top of `recomputeRoutes`; precondition 3 → armed flag; `_105` M2 subtraction + auto-disarm; `_105` F10 own signature; `_105` F14 parsed-spec state key; `readBenchMirrorSpecs()` returns parse errors; `sendVia` returns its promise; `armBenchMirror` / `disarmBenchMirror` / `benchMirrorStatus` / `broadcastBenchMirrorStatus`; two new WS messages + status on connect + socket-scoped disarm on close; SIGINT/SIGTERM blackout; boot banner line |
| `simulation/scenes/test_bench/bench_mirror.yaml` | `version: 2`, `label:`, three `suppress_host:` declarations + header rewrite. **Mapping unchanged.** |
| `simulation/src/gui/bench_mirror_banner.js` | **new** — panel-independent HUD (`bannerStateForStatus` pure + lazy DOM) |
| `simulation/src/gui/bench_mirror_control.js` | **new** — pure `benchMirrorControlState` for the panel (separate file because the panel's htm/preact deps are browser-vendored and cannot be imported by a Node test) |
| `simulation/src/gui/modern/sacn_monitor_panel.js` | `Bench Mirror` stat row + `🪞 ARM`/`DISARM` button (`sacn-in-bench-mirror-btn`) + `runBenchMirrorAction` |
| `simulation/src/dmx/sacn_input_source.js` | `armBenchMirror` / `disarmBenchMirror` (reqId-correlated), `benchMirrorStatus` dispatch → banner + `stats.benchMirror`, waiters rejected on teardown, banner hidden on close |
| `simulation/tests/bench_mirror.test.js` | 30 → **48** |
| `simulation/tests/bench_mirror_arm.test.js` | **new**, 35 |

**Not touched, as required:** `simulation/scenes/titanic/controllers.yaml`,
`simulation/scenes/test_bench/controllers.yaml`, either scene's `patches.yaml`
or fixture mappings, any `marsin_engine/` model mapping.

---

## 9. OPERATOR INSTRUCTIONS

### 9.1 Arm

1. **Restart the launcher once** so the bridge runs this code. The boot banner
   now ends with:
   `  Bench Mirror        : DISARMED (runtime mode, process memory only — arm it from the sim's 📡 sACN IN monitor; every start comes up disarmed)`
2. Run as normal — launcher pinned `titanic`, engine on `titanic`, **one** sim
   window on `titanic`. **No second tab. No `--scene test_bench` anywhere.**
3. In the sim, set the lighting engine to **sACN IN** so the 📡 sACN IN monitor
   is shown. Expand it. The **Bench Mirror** row reads
   `off — Titanic left front ready`.
4. Press **🪞 ARM**.

Expected in the launcher terminal AND the monitor's activity log (verbatim, IPs
redacted here only):

```
[sACN Bridge] 🪞 BENCH MIRROR ARMED — TITANIC LEFT FRONT ('titanic' → 'test_bench'). Owned destinations: U2 → 10.x.x.10, U10 → 10.x.x.60, U12 → 10.x.x.60; whole hosts: 10.x.x.60.
[sACN Bridge] ⚠ 🪞   Ordinary relay will be SUPPRESSED for U2 → 10.x.x.10 — the mirror composes those universes, so it becomes the only writer on them.
[sACN Bridge] ⚠ 🪞   Whole-host takeover: U30 → 10.x.x.60, U31 → 10.x.x.60 will ALSO stop being relayed, because this map owns those boxes entirely while armed. Anything on them that the mirror does not compose goes DARK — that is deliberate: it is what makes "the strands are lit" mean "the mirror reached them" instead of "the raw relay reached them".
[sACN Bridge] ⚠ 🪞   While armed, any per-output LED push to a mirrored destination will FAIL its route read-back — correct, not a push bug: the mirror owns that route.
[sACN Bridge] Route removed: U2 → 10.x.x.10 (bench mirror armed for 'test_bench')
[sACN Bridge] Route removed: U30 → 10.x.x.60 (bench mirror armed for 'test_bench')
[sACN Bridge] Route removed: U31 → 10.x.x.60 (bench mirror armed for 'test_bench')
[sACN Bridge] 🪞 BENCH MIRROR ACTIVE — TITANIC LEFT FRONT: scene 'test_bench' is showing 'titanic' fixtures. Bench stands in for the ship's left-front fixtures while the engine runs titanic.
[sACN Bridge] 🪞   composes U2 → 10.x.x.10 (5 slice(s), 344 ch, from U6+U5+U2)
[sACN Bridge] 🪞   composes U10 → 10.x.x.60 (1 slice(s), 80 ch, from U30, OWNS WHOLE HOST)
[sACN Bridge] 🪞   composes U12 → 10.x.x.60 (1 slice(s), 80 ch, from U31, OWNS WHOLE HOST)
[sACN Bridge] 🚫 Relay suppressed: U2 → 10.x.x.10 — the BENCH MIRROR composes this universe for that controller; relaying the raw frame too would put two writers on it. (declared by scenes: titanic)
[sACN Bridge] 🚫 Relay suppressed: U30 → 10.x.x.60 — the BENCH MIRROR owns ALL of 10.x.x.60 while armed (suppress_host: true), so nothing else may write to that box — a strand lit here is the mirror's doing, not the relay's. (declared by scenes: titanic)
[sACN Bridge] 🚫 Relay suppressed: U31 → 10.x.x.60 — the BENCH MIRROR owns ALL of 10.x.x.60 while armed (suppress_host: true), so nothing else may write to that box — a strand lit here is the mirror's doing, not the relay's. (declared by scenes: titanic)
```

and the amber banner at the top of the sim:
`🪞 BENCH MIRROR ACTIVE — TITANIC LEFT FRONT · owns U2→…10, U10→…60, U12→…60 · owns all of …60 · ordinary relay suppressed`.

Now watch the bench: pars, both vintage heads and both bars play the ship's left
front. The two LED strands are the caveat below.

### 9.2 Disarm

Press **🪞 DISARM** — or just close the sim window that armed it; the arm is
scoped to that socket. Either way:

```
[sACN Bridge] 🪞 BENCH MIRROR DISARMING (operator) — the operator pressed DISARM. Sending 3× all-zero frames to U2 → 10.x.x.10, U10 → 10.x.x.60, U12 → 10.x.x.60 before releasing the senders.
[sACN Bridge] Route created: U2 → 10.x.x.10 (scenes: titanic[pin+engine]; bench mirror disarmed (operator): the operator pressed DISARM)
[sACN Bridge] Route created: U30 → 10.x.x.60 (…)
[sACN Bridge] Route created: U31 → 10.x.x.60 (…)
[sACN Bridge] Bench mirror sender removed: U2 → 10.x.x.10 (…)
[sACN Bridge] Bench mirror sender removed: U10 → 10.x.x.60 (…)
[sACN Bridge] Bench mirror sender removed: U12 → 10.x.x.60 (…)
[sACN Bridge] 🪞 Bench mirror INACTIVE — no scene is standing in for another (engine scene 'titanic', active scenes: titanic).
[sACN Bridge] 🪞 BENCH MIRROR DISARMED — test_bench → titanic released. The ordinary relay is back: the bench DMX gateway is fed RAW titanic bytes again (lit, wrong fixtures — that is the ordinary titanic-only shape, not a mirror bug), and any host this map owned whole is fed its own scene universes again.
```

An auto-disarm prints the same sequence prefixed by
`⚠ 🪞 BENCH MIRROR AUTO-DISARM — <reason>.` with `(auto)` in the disarming line.

### 9.3 KNOWN CAVEAT — the strands need their config applied first

The LED strands will **not** respond to the mirror until the board is actually
running the bench binding (`U10 / U12`, `startAddress: 1`). The `test_bench`
scene's `Titanic_202` card's last push receipt still reads **`needs-reboot`**,
and the `titanic` scene's `LeftLeftRopes` card for the **same** `boardId`
(`angio4-old`) reads **`applied`** on `U30 / U31`. If the board has not been
rebooted since, it is still on U30/U31 and the mirror's frames are discarded at
the box.

With this change that now shows up **honestly**: because the mirror owns
`10.x.x.60` whole, the raw `U30/U31` relay is suppressed, so **dark strands mean
"the board is not on U10/U12"** rather than the old green-looking false positive
where the raw relay lit them and the mirror was ignored. Everything else on the
bench (pars, vintage, bars) works regardless.

To fix, when you want to: open the **test_bench** scene's controller pane, review
the `Titanic_202` card, press **Push** once, let it reboot. That is a device
write, not an agent action, and it is a revert to the bench binding rather than a
new mapping.

### 9.4 The `.60` board-state check — DOCUMENTED, NOT RUN, approval-gated

Read-only, one GET, no write, no reboot. **I did not run this** (the brief
forbids any packet toward a controller); run it yourself, or approve an agent to:

```bash
curl -s --max-time 3 http://<the .60 controller IP>/api/config
# optional second read, live counters rather than persisted config:
curl -s --max-time 3 http://<the .60 controller IP>/api/status
```

In the `/api/config` reply read **`strands[].dmxUniverse`** (and
`dmxStartAddress`, which the sim always writes as `1`) for the two enabled
outputs — the field names are `docs/41` §4.1's, not invented here:

| `strands[].dmxUniverse` shows | meaning |
|---|---|
| **10 and 12** | the bench binding is applied — the mirror will reach the strands |
| **30 and 31** | the board is still on the ship binding; the strands stay dark while armed until you push+reboot the `Titanic_202` card (§9.3) |
| anything else / `enabled:false` | neither binding is live — treat the strands as unbound |
| no reply / timeout | the board is offline or on a different address; nothing about the mirror can be concluded |

`/api/status` adds the corroborating live evidence: `sacn.lastUniverse`,
`sacn.rxPackets` and the per-output `framesPresented`. Armed, with the raw relay
suppressed, `lastUniverse` should be 10 or 12 if the mirror is landing.

**Both are `GET`s — read-only in this firmware** (`docs/41` §2: "read before
writing so we PATCH, not clobber"). Every write is a `POST /api/config`, which
is the Push button in the controller pane and stays an operator gesture.

### 9.5 Other things worth knowing while armed

- **A per-output LED push to `10.x.x.10` or to anything on `10.x.x.60` will fail
  its bridge route confirmation.** Correct, by design (`_127`
  `assessRouteReadback`) — the mirror owns those routes. Disarm before pushing.
- **A second sim window in sACN-OUT mode still outranks the mirror** at the box
  (priority 150). Arming with several windows open is allowed and warned, not
  refused (your ruling); if what the bench shows does not match what the mirror
  sends, close the extras.
- **Fog/haze on the bench gateway's U1 is untouched** — titanic has nothing on it.
- **The bench strands show the first 20 px of a 40 px titanic rope**, and the
  bench scene's `led.wire` gamma/foldAmber is not applied to mirrored bytes.
  Both are `_89` caveats, unchanged.
- **`_105` F8 is still live**: the composed frame is quantised through the `sacn`
  package's 2-dp percent float, so 202 of 256 DMX values are off by one and DMX
  1–2 read as 0. Not this slice's job, but do not judge fine colour tuning on the
  armed bench.

---

## 10. Refused / not done / open

- **Refused: `_105` M2's "validate `dest_host` against real bench controllers".**
  Explicitly out of scope per the brief and correct — `10.x.x.10` is a real ship
  controller by design, and that check would kill the intentional mapping.
- **Not done: no controller push, no re-addressing, no firmware op, no engine
  restart, no live packet test, no server started, no port bound.** The `.60`
  board-state check is documented (§9.4) and deliberately not executed.
- **Not done: `_105` F8** (percent→byte quantisation), **F3/F4/F5** (browser
  preview at 39 %, one CID project-wide, global priority lockout), **F19** (no
  `setScene` debounce — ARM/DISARM each trigger one recompute and inherit its
  cost). All pre-existing, none blocking.
- **Open, operator-only:** the `controllerId` divergence for `boardId:
  angio4-old` (`testbench` in the titanic scene vs `titanic_202` in test_bench) —
  two cards claiming one board under two ids, a reconcile hazard independent of
  this feature (memory `marsinled-controller-onboarding`: bind by `controllerId`,
  not IP).
- **Snapshot note:** a host-suppressed pair (`U30 → .60` while armed) appears in
  neither `routes` nor `mirrorOwned` in the `_127` `getRoutes` snapshot, so an LED
  push expecting it reports `missing U30→…60` rather than the friendlier
  "the bench mirror owns it". Still a loud, accurate failure; adding a
  `mirrorSuppressedHosts` field would improve the sentence and was left out to
  avoid widening the read-back contract in this slice.

---

## 11. POST-REVIEW FIXES (`_152` verdict: FIX-FIRST)

Adversarial review `.agent/reports/202608/20260804_152_bench_mirror_adversarial_review.md`
confirmed 8 of 9 attack surfaces and found one blocking defect on the disarm
gesture §9.2 advertises. All fixes below are in this same slice; the sidecar,
both scenes' controllers/patches and every engine model remain untouched, and the
mapping is still byte-identical.

### D1 (MODERATE, blocking) — second writer during the release window · FIXED

**The defect.** `disarmBenchMirror` is `async`: it clears `_mirrorArm`, empties
`_activeMirrors` and fires the first blackout round synchronously, then
**suspends** at its `await`. Any recompute landing in that window saw no arm,
suppressed nothing, and the sender-creation loop re-opened an *ordinary relay*
sender on a pair the blackout was still writing zeros to. `_mirrorDisarming`
guarded only sender **closing**. Reproduced by the reviewer, and now by this
repo's own tests: a raw relay frame on `U2 → 10.x.x.10` between blackout frames
1 and 2.

**The fix — one invariant, not one caller.** The review suggested skipping the
plain recompute in the ws-close handler. That closes the reported path but not
the others: `recomputeRoutes` is also reachable during the window from a client's
`setScene` (`sacn_bridge.js:887`) and from the 3 s engine poll
(`:781`). The fix is therefore stated where relay senders are *decided*:

- `lib/bench_mirror.cjs:356-411` — `partitionMirrorSuppression` takes an optional
  `hold` (`{keys, hosts, scene}`) and emits a third suppression reason,
  `why: 'blackout'`, alongside `pair` and `host`.
- `sacn_bridge.js:249-259` — `_blackoutHold`, raised in `disarmBenchMirror`'s
  **synchronous prologue** (`:1259-1263`, before the first `await`) from the live
  `_mirrorEntries` plus the wholly-owned hosts, and dropped in the same `finally`
  that clears `_mirrorDisarming` (`:1289-1293`).
- `sacn_bridge.js:541` — the single call site passes it. Because every recompute
  path runs through that one partition, **all** of them are covered by
  construction; a test pins that `hold: _blackoutHold` appears exactly once.
- `sacn_bridge.js:738-752` — the suppression log gained the `blackout` sentence,
  so the hold is visible rather than a silent gap.
- `sacn_bridge.js:938-948` — the ws-close comment corrected: it previously
  reasoned only about sender *closing* and asserted the opposite of what the code
  did.

**Proved by falsification, both directions.** With `hold` forced to `null`, the
new regression test fails with
`U2 → 10.x.x.10: a RAW frame was emitted between the first and last blackout
frame — two live writers on one (universe, controller) during the release
window`; with the hold restored it passes. Same for D2 with its guard removed.

### D2 (MINOR) — ARM accepted mid-blackout, bridge logged DISARMED while ARMED · FIXED

`armBenchMirror` read `activeArm: _mirrorArm`, which the in-flight disarm had
already nulled, so the "a re-arm must go through the blackout, not around it"
refusal could not fire. Now `evaluateArmRequest` takes `blackoutInFlight`
(`bench_mirror.cjs:454-476`) and refuses **first, before any other check**, with
*"a DISARM blackout is still in flight … Wait for the DISARMED line and arm
again."*; the bridge passes `_mirrorDisarming` (`sacn_bridge.js:1315`). The
regression test asserts the reply is a refusal **and** that `🪞 BENCH MIRROR
ARMED` never appears between `DISARMING` and `DISARMED`.

### D4 (TEST GAP — the reason D1 escaped) · FIXED

Three harness defects, each of which independently hid the race:

1. **`FakeClient` never sent `setScene`**, so `clientScenes` was empty and the
   close handler's `if (scene) recomputeRoutes(...)` never ran in any test — the
   socket-drop test exercised a control flow the real browser never takes.
   `connect()` now sends it, matching `sacn_input_source.js`.
2. **`FakeSender.send` resolved synchronously**, so the whole 3-frame blackout
   completed inside one microtask drain and the release window did not exist.
   It now resolves on a later event-loop turn, the way `dgram.send` behaves.
3. **`captureConsole`/`releaseConsole` were not re-entrant.** The helpers nest,
   so an inner release handed the console back mid-test and silently dropped
   every later line — including lines the outer test asserted on. Now
   reference-counted. (Found while fixing D2's test; it was masking a real
   assertion.)

Also added: an ordered cross-sender `events` log (`open`/`send`/`close`), which
is what makes "a raw frame arrived *between* two blackout frames on the same
pair" expressible at all; completion is now detected from the bridge's own
status broadcast rather than from "is a sender open on that pair" (a mirror
sender and the relay sender it replaces share one key, so that test was
ambiguous in both directions); and the reviewer's noted vacuity in *"a refused
ARM sends nothing"* is closed by feeding a live frame and asserting the ordinary
relay is still in charge.

### D3 (COSMETIC) · FIXED — §2 and §8 above no longer mention `_lastArmStatus`

### D5 (COVERAGE) — partly closed, remainder accepted

- **Runtime `ownedUnavailable` degrade** — now covered end-to-end: arm, drop
  `outputRouting` from the engine's `/status`, and assert the loud auto-disarm,
  the reason, three zero frames per owned universe, the broadcast, and that ARM
  stays refused. (Previously only the pure `evaluateArmedHealth` branch.)
- **SIGINT/SIGTERM arriving mid-blackout** — the review's narrow edge (`_mirrorArm`
  is already `null`, so the handler reported "was not armed" and exited, killing
  the in-flight blackout) is **fixed in code** (`sacn_bridge.js:1479-1487`): the
  handler now awaits `_blackoutSettled` before exiting, still bounded by the
  1500 ms `unref`'d timer. **Accepted gap: still untested** — exercising it means
  stubbing `process.exit` inside the shared bridge instance, which risks hanging
  the runner for less than it proves. Read-verified only.
- **`_105` F12 end-to-end** — **accepted gap**, pure-only. An end-to-end case
  needs a second scene directory carrying a sidecar; writing one into the source
  tree is out of scope here.
- **Tier-2 order dependence** — **accepted gap**. Node's module cache means one
  bridge instance per file, so the tests share it. Reduced where cheap: each
  Tier-2 case now arms/disarms within itself and waits on the bridge's own
  completion signals instead of fixed `settle()` counts, so they are no longer
  timing-fragile even though they remain sequential.

### Post-review verification

| | tests | pass | fail |
|---|---|---|---|
| `tests/bench_mirror.test.js` | 52 | 52 | 0 |
| `tests/bench_mirror_arm.test.js` | 38 | 38 | 0 |
| full suite `npm test` | **1833** | **1827** | **6** |

**+7 over `_151`'s 1826**, same six pre-existing failures, byte-identical list.
`python scripts/security_check.py --all` → the same 6 gitignored
`.scene_backups/studiodj/**` findings. `git diff --check -- simulation` clean.
No port bound, no packet, no engine boot, no git operation; the operator's own
uncommitted files (mtimes 00:0x–00:38) are untouched.

### RESIDUAL-1 (non-blocking, found on `_152` re-verify) — blackout hold could leak on a throw · FIXED

`_blackoutHold` was raised at the top of `disarmBenchMirror`'s prologue, but the
`try` whose `finally` releases it opened only around the `await`. Between them
sat `console.log` and `broadcastLog` — and `broadcastLog` walks `wss.clients`,
where `ws.send()` throws on a socket in transition, which is precisely the state
of the socket-close disarm path. A throw there would have leaked the hold
**permanently**: the ordinary relay would stay suppressed on those pairs until
the process restarted, leaving the bench gateway unfed. The `try` now opens
immediately after the hold is raised, so every statement after the raise is
inside the guard (`sacn_bridge.js:1290-1327`); the async IIFE needs no separate
handling because a synchronous throw inside it becomes a rejection the same
`await`/`finally` covers. One second-order hazard came with it and is fixed too:
the three fire-and-forget call sites used a bare `void`, so a rejected disarm
would have been an **unhandled rejection** — process-fatal in current Node, on
the very path that is releasing the hardware. They now go through
`disarmInBackground` (`:1361-1369`), which shouts and lets the caller's own
recompute restore the relay, and a test pins that no `void disarmBenchMirror(`
remains. A regression test connects a client whose `send` throws on exactly the
`BENCH MIRROR disarming` line, drops the arming socket, and asserts the pairs are
relayed again and the failure is logged; with the logging moved back outside the
guard it fails with *"the gateway pair must be relayed again — a leaked blackout
hold would suppress it forever"*, and passes with the fix. Post-fix counts:
`bench_mirror.test.js` **52/52**, `bench_mirror_arm.test.js` **39/39**, full
suite **1834 / 1828 / 6** — the same six pre-existing failures.

**Recovery note, for the record.** While applying this fix a scripted edit to
`simulation/server/sacn_bridge.js` used Python's `write_text`, which truncates
before encoding; a `UnicodeEncodeError` on an emoji escape left the file at
**0 bytes**. It was rebuilt from `git show HEAD:` (a read; no git state was
mutated — no `checkout`, `reset`, `stash` or any write operation) plus a
re-application of every `_151` and `_152` edit. The reconstruction is verified
three ways: all 91 bench-mirror tests pass, including ~35 source-string
assertions that pin exact code shapes; the full suite is unchanged at
1834/1828/6 with the identical failing list; and the arm/disarm log capture
reproduces §9's verbatim operator block byte for byte. No other file was
affected and no operator file was touched.

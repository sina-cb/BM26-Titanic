# 20260804_150 — bench-mirror audit: what exists, and the design for a runtime "BENCH MIRROR" mode

**Agent:** investigator (Opus) · **Mode:** READ-ONLY — zero source/test/doc/scene
edits, zero git operations, no engine/sim boot, no server, **no port bound, no
packet toward any controller.** The operator's live stack kept 6966–6972, 5568,
8081, 10000 untouched. **Branch:** `feat/bm_readiness`.

IPs are redacted to `10.x.x.NN` in prose per `.agent/os/security_privacy.md`;
the scene/config files quoted carry the real values and were not edited.

**Scope:** the existing bench-mirror system, feeding a design for a
session-scoped, runtime-armed **BENCH MIRROR** mode — engine + visible sim stay
on `titanic`, selected titanic universes are re-addressed onto the physical
bench fixtures by the bridge, canonical titanic addressing untouched.

---

## 0. TL;DR

| | |
|---|---|
| **Does the mapping match the operator's spec?** | **Yes, exactly — all seven slices, byte for byte.** No discrepancy found. §1 |
| **What forces the second tab today** | `isMirrorActive`'s **third** precondition: the sidecar's OWN scene must be in the bridge's active-scene set. With the engine on `titanic` and the launcher pinned to `titanic`, the only remaining way to put `test_bench` in that set is a connected browser tagging itself `test_bench` — i.e. a second sim tab. §2 |
| **Smallest correct change** | Replace precondition 3 (`ownSceneActive`) with an explicit, process-scoped `armed` flag. Preconditions 1 (`enabled:`) and 2 (engine scene == `source_scene`) stay verbatim. One call site. §2, §12 |
| **What that costs** | Precondition 3 **is** the deployment guard (`_89` §4.3). Removing it means the mode must supply its own: default-OFF at every process start, explicit operator gesture, unmistakable banner, loud auto-disarm. §6, §12 |
| **Suppression today** | Correct and already pinned by a test — mirrored pairs are removed from `relayRoutes` **before** the sender diff. Two defects to fix alongside: `_105` **M2** (engine-owned pairs never subtracted from mirror destinations) and `_105` **F10** (suppression lines print only when the *mirror set* changes). §4, §5 |
| **Biggest live surprise** | `10.x.x.60` is bound in **both** scenes with **different `controllerId`s** and the later (test_bench, U10/U12) push still reads `needs-reboot`. Armed today the strands would probably be lit — **by the un-suppressed raw `U30/U31 → .60` relay, not by the mirror.** A green-looking false positive. §9 |
| **Recommended surface** | Operator's instinct is right: the **sACN IN monitor** (`sacn_monitor_panel.js`) owns the ARM/DISARM control (it is the only UI that already speaks to the bridge), plus a **panel-independent HUD banner** modelled on `multi_client_warning.js`. §5 |

---

## 1. The sidecar vs the operator's mapping — EXACT MATCH

`simulation/scenes/test_bench/bench_mirror.yaml`, verified slice by slice:

| operator's spec | sidecar | file:line | verdict |
|---|---|---|---|
| U6 ch1-40 → `.10`/U2 ch1-40 | `source_universe: 6, source_addr: 1, length: 40, dest_addr: 1` | `bench_mirror.yaml:63-67` | ✅ |
| U5 ch1-33 → `.10`/U2 ch41-73 | `5, 1, 33, dest 41` (41..73) | `:68-72` | ✅ |
| U5 ch34-66 → `.10`/U2 ch74-106 | `5, 34, 33, dest 74` (74..106) | `:73-77` | ✅ |
| U2 ch1-119 → `.10`/U2 ch107-225 | `2, 1, 119, dest 107` (107..225) | `:78-82` | ✅ |
| U2 ch120-238 → `.10`/U2 ch226-344 | `2, 120, 119, dest 226` (226..344) | `:83-87` | ✅ |
| U30 ch1-80 → `.60`/U10 ch1-80 | `30, 1, 80, dest 1` | `:95-103` | ✅ |
| U31 ch1-80 → `.60`/U12 ch1-80 | `31, 1, 80, dest 1` | `:106-114` | ✅ |

Header state: `version: 1`, `enabled: true`, `source_scene: titanic`
(`:52-55`). Three destination universes, 504 mirrored channels total.
**No discrepancy to flag.** The map is also pinned against the real scenes and
the real generated models by six live-map tests (§10), so it cannot rot silently.

---

## 2. Q1 — how the mirror activates today, and what forces the second tab

**The gate is `isMirrorActive`** — `simulation/lib/bench_mirror.cjs:234-238`:

```js
function isMirrorActive(spec, engineScene, ownSceneActive) {
  if (!spec || !spec.enabled) return false;
  if (ownSceneActive !== true) return false;
  return typeof engineScene === 'string' && engineScene === spec.sourceScene;
}
```

Called once, from the route recompute — `simulation/server/sacn_bridge.js:434`:

```js
if (!isMirrorActive(found.spec, engineState.scene, activeSceneSet.has(found.scene))) continue;
```

`activeSceneSet` is built from `activeScenes` (`sacn_bridge.js:430`), which
`computeEffectiveRoutes` returns as **union(pinned, engineScene, clientScenes)**
— `simulation/lib/bridge_routing.cjs:318-323`, fed at `sacn_bridge.js:415-421`
from `pinnedScene` (`:193`, the CLI `--scene`), `engineState.scene` (`:195`,
the 3 s `/status` poll) and `clientScenes` (`:194`, one entry per connected
browser).

So for `test_bench` to be in the active set, one of three things must be true:

1. the bridge's CLI pin is `test_bench` — but `simulation/start.js:105-108`
   passes the launcher's single `--scene` straight through to the bridge, and
   the same value builds the sim URL (`start.js:77`, `launcher.js:1119`,
   `:1164`). Pin `test_bench` and the **visible sim is test_bench too** — the
   operator loses the titanic view, which is the whole point of the request;
2. the ENGINE is on `test_bench` — forbidden by precondition 2 (which requires
   the engine on `titanic`), so this is unreachable by construction;
3. **a connected client tags itself `test_bench`** — `sacn_bridge.js:751-761`,
   sent by the browser on WS open from its own `?scene=` query
   (`simulation/src/dmx/sacn_input_source.js:158-162`).

Path 3 is the only one that leaves the titanic view intact. **That is the second
tab, and it is structural, not incidental.** Worse, it is self-defeating: the
second connection immediately trips the bridge's own multi-client contention
warning (`sacn_bridge.js:731-740` → banner `multi_client_warning.js:28-35`), and
in `sacn_in` mode a second window is an independent priority-150 sACN writer
(memory `sacn-route-ownership`, `_89` §4 "writer #2").

**Nothing else gates it.** There is no bridge flag, no env var, no HTTP
endpoint. The only operator switches are `enabled:` in the sidecar
(`bench_mirror.yaml:53`) and which scenes are active.

---

## 3. Q2 — bridge architecture and the existing control surface

**Where routes come from.** `recomputeRoutes(reason)` — `sacn_bridge.js:383-652`
— is the single authority. It is called on **boot** (`:1071`), **client
`setScene`** (`:761`), **client disconnect** (`:793`), and **every engine-poll
state change** (`:706`). Held before the receive socket is listening by the
`_105`/`_99` boot gate (`:393`, `:855-867`).

Each pass:
1. builds `candidateScenes` = pin ∪ engine scene ∪ every client tag (`:395-397`);
2. re-reads each scene's `patches.yaml` **fresh, no cache** (`readSceneRoutePairs`,
   `:306-336`) → declared `(universe → controllerIp)` pairs, with refused IP
   classes named individually (`bridge_routing.cjs:73-105`, `:116-147`);
3. `computeEffectiveRoutes` (`bridge_routing.cjs:317-359`) → `{routes, excluded,
   conflicts, activeScenes}`, where `excluded` is the engine-owned subtraction
   (`engineOwnedPairs`, `:370-382`, from `/status outputRouting`);
4. resolves bench mirrors (`:425-455`) — see §4;
5. diffs the receiver's universe subscription (`:482-524`);
6. diffs relay senders (`:527-556`), rebuilds the universe-indexed
   `outgoingSenders` view (`:561-565`), then diffs the **separate** mirror
   sender map (`:567-589`).

**Who can add/remove routes at runtime.** Only the three inputs above. A client
can **ADD** its scene's routes by tagging (`setScene`) and remove them by
disconnecting; it can never clobber another scene's — that is the `_15`
last-writer fix, and it must not be reintroduced.

**The control surface on :6971** (`new WebSocketServer({ port: SACN_PORT })`,
`sacn_bridge.js:713`; `SACN_PORT` = `sacn_port` from `simulation/config.yaml`,
`:32`). Inbound JSON message types — **exactly two**:

| type | handler | effect |
|---|---|---|
| `{type:'setScene', scene}` | `:751-761` | tags this socket, triggers a full recompute |
| `{type:'getRoutes', reqId}` | `:762-783` | read-only snapshot from the LIVE sender maps, to this socket only |

Outbound: 515-byte binary DMX frames (`:1038-1044`), `{type:'log', msg, level}`
(`:930-936`), `{type:'clients', count}` (`:726-741`), `{type:'routes', …}`
(`:772-778`, built by `buildRouteTableSnapshot`, `bridge_routing.cjs:524-535`).

**No authentication, no origin check, no tags beyond the scene string.** Any
local WS client can drive it. The outer `try{}catch{}` at `:784` swallows
non-JSON frames.

**:6972 is not a candidate.** `simulation/server/sacn_output_bridge.js:126-131`
accepts **binary only** (519-byte frames) and ignores everything else — there is
no JSON control surface there at all.

**Is there a "pin"/session mechanism the ARM could ride?** `clientScenes`
(`:194`) is genuinely session-scoped — per-socket, cleared on close (`:789-793`).
But riding it is **wrong**: a scene tag adds *all* of that scene's relay routes
(test_bench would add `U1 → .10` haze/fog, `U10/U12 → .60`, …), which is
precisely the coupling the new mode is trying to shed. The ARM must be its own
flag. §12 recommends process-scoped, not socket-scoped, with reasons.

---

## 4. Q3 — ownership and suppression, measured

**How the writer for a pair is decided today**, in order, inside one recompute:

1. `computeEffectiveRoutes` removes every pair in `engineState.owned`
   (`bridge_routing.cjs:340-343`) → `excluded`. *The engine wins.*
2. The mirror's destination pairs are collected into `mirrorOwned`
   (`sacn_bridge.js:445-453` via `mirrorDestPairs`, `bench_mirror.cjs:250-252`)
   and split off: `mirrorSuppressed` = the relay routes the mirror owns,
   `relayRoutes` = everything else (`sacn_bridge.js:454-455`). *The mirror wins
   over the relay.*
3. `relayRoutes` — not `routes` — feeds the sender diff (`:527`) and the
   `outgoingSenders` map `routeFrame` reads (`:561-565`, `:1024-1027`). Mirror
   destinations are deliberately absent from it (`:558-560`).

Both hops are pinned by source-string assertions in
`simulation/tests/bench_mirror.test.js:379-387`.

**What must be suppressed while armed, and whether it is reachable today.**
Measured against the real scene files:

| owned pair | claimed by ordinary relay today? | evidence |
|---|---|---|
| `U2 → 10.x.x.10` | **YES — live** whenever `titanic` is active | `scenes/titanic/patches.yaml:402-411` — `Left Front Wall 1/2`, `dmxUniverse: 2`, `controllerIp: 10.x.x.10`; and `scenes/titanic/controllers.yaml:4-14` `LeftFrontWall` port 1 = U2 |
| `U10 → 10.x.x.60` | **No**, with only `titanic` active | titanic binds `.60` on U30/U31, not U10/U12 (`scenes/titanic/controllers.yaml:28-45`). Only a `test_bench` tag/pin makes it a relay claim (`scenes/test_bench/controllers.yaml`, Titanic_202 ports) |
| `U12 → 10.x.x.60` | **No**, same | ditto |

So suppression is **load-bearing for `U2 → .10`** — the bench DMX gateway and
the ship's `LeftFrontWall` gateway are authored at the *same address*, which is
exactly why `_89` §4.3 leaned on the deployment guard. For the two `.60` pairs
suppression is a no-op in the intended topology but must stay for the churn case
(a `test_bench` tab appearing later) — which is precisely `_105` **F10**.

**Not owned, and still live while armed:** `U30 → 10.x.x.60` and
`U31 → 10.x.x.60` remain ordinary relay routes (`scenes/titanic/patches.yaml:666-691`
— `Left_Front_Left`, `Left_Back_Left`). Same physical box, different universes:
legal under one-writer-**per-pair**, but it means the `.60` board is fed **four**
universes while armed. See §9 for why that is a diagnostic trap, not a footnote.

**The one writer the bridge cannot see.** In `sacn_in` mode every sim tab
unicasts all patched universes at priority **150** via :6972
(`src/dmx/sacn_output_client.js:81-110`; memory `sacn-route-ownership` → "OPEN:
writer #2"). 150 outranks the mirror's composed frame, which carries the
priority of the source that fed it (`sacn_bridge.js:993-995`). `_89` §4 names
this and does not work around it; neither can the ARM.

---

## 5. Q4 — the `_105` findings, verbatim, and what a fix must do

Two findings name the bench mirror. Both are **still open** in the code as read.

### `_105` M2 (first pass) / F2 (second pass) — engine-owned pairs are never subtracted

> **M2 — DOUBLE-WRITE: bench-mirror destination is never subtracted from the
> engine-owned set; and `dest_host` is not validated against real controllers**
> … "`mirrorTargets` is built purely from the active mirrors' `mirrorDestPairs`
> … and a `Sender` is created for each … **independently of `engineState.owned`.**"
> … "**Expected:** the mirror should refuse (or suppress) a destination the
> engine already owns, with a named warning — symmetric to how it suppresses the
> relay."
> — `.agent/reports/202607/20260725_105_redteam_bridge.md:103-134`

The second pass proved it end-to-end and added the sharper half:

> "**the frames are observed leaving** … the engine-suppression line at
> `sacn_bridge.js:615` is **actively false** in this state: it tells the
> operator there is one writer while the mirror is being the second."
> — `_105:361-379`

**Confirmed still present.** `sacn_bridge.js:445-453` builds `mirrorOwned` /
`mirrorTargets` from `mirrorDestPairs(m.spec)` alone; `:575-589` constructs a
`Sender` per target; `engineState.owned` is consulted nowhere on that path.

The adjacency the report flags is the live one: the engine owns
`U10/U12 → 10.x.x.202` today while the mirror composes `U10/U12 → 10.x.x.60`, so
the pairs do not collide **yet** — and `_89` §3 records that the operator has
already bound the `.60` box in the titanic scene, so the engine acquiring it is a
pending step, not a hypothesis.

**What a fix must do** (and how it coexists with the intentional mapping):
- **Do not** refuse `dest_host` for being "a real controller" — that would kill
  this mapping outright: `10.x.x.10` *is* a real ship controller
  (`LeftFrontWall`), deliberately. The intentional mapping is
  *bridge-relay-owned* destinations, which is legal.
- **Do** refuse (at ARM) and suppress+auto-disarm (at recompute) any destination
  pair present in `engineState.owned`. The engine is the higher authority; the
  bridge cannot outrank it.
- **Do** refuse to arm when `engineState.ownedUnavailable` is set
  (`sacn_bridge.js:676-679`, an older engine with no `outputRouting`): ownership
  is then **unprovable**, and "unprovable" must fail loudly, not default to
  permitted (codex P0).
- **Do** make the engine-owned suppression line at `:623` unable to lie: if a
  pair is both engine-owned and mirror-owned, that is a refusal, not two log
  lines that each claim single-writer status.

### `_105` F10 — suppression is silent under churn

> "`sacn_bridge.js:587-608` puts the `🚫 Relay suppressed … the BENCH MIRROR
> composes this universe` loop inside `if (mirrorSig !== _lastMirrorSig)`.
> `mirrorSuppressed` is recomputed every pass but printed only when the *mirror
> set* changes. The engine-owned twin at `:611` has the same shape but gates on
> `excludedSig`, which is derived from what it prints — so only the mirror half
> drifts." — `_105:530-541`

**Confirmed still present** at `sacn_bridge.js:593-616` (loop at `:610-615`
inside the `mirrorSig` guard opened at `:595`). Fix: give the suppression loop
its own signature derived from `mirrorSuppressed`, exactly like `excludedSig`
at `:619`.

### Adjacent `_105` findings an implementer will touch

- **F12** — two scenes' sidecars may claim the same destination pair; sender
  from the last spec read, payload from the first, **zero warnings**
  (`sacn_bridge.js:567-589` vs `flushMirrors` `:1011`). `parseBenchMirrorSpec`
  refuses duplicates *within* one file (`bench_mirror.cjs:140-146`) — there is
  no cross-file twin. An ARM that names one scene makes this trivially fixable:
  refuse to arm if any other **enabled** sidecar claims an overlapping pair.
- **F14** — composed buffers are rebuilt whenever `found.raw` changes
  (`sacn_bridge.js:438` compares raw file bytes), so a **comment-only** sidecar
  edit blanks the next composed frame. One-line improvement while in there: key
  the reuse signature on the **parsed** spec (`JSON.stringify(spec)`) instead of
  the raw text.
- **F8** — the mirror quantises: `bench_mirror.cjs:271` allocates
  `Uint8Array(DMX_CHANNELS)` and `:302` truncates the `sacn` package's 2-dp
  **percent** float into it. 202 of 256 DMX values wrong, DMX 1 and 2 → 0.
  **Still unfixed** — grep-proven: `useRawDmxValues` appears only inside
  `node_modules/sacn/dist/packet.js` in both trees, nowhere in project source.
  Not this mode's job to fix, but the operator judging titanic patterns on the
  armed bench is judging them through it. Flag it before a tuning session.
- **F3** (browser preview at 39 %), **F4** (one CID project-wide), **F5**
  (global priority lockout across all universes) are all still live and all sit
  on the same path. None block this design; all colour how its output is read.

---

## 6. Q5 — the right UI surface

**Which surface owns bridge/sACN routing today:** none owns *routing* — the
route table is derived, not authored. The surfaces in the neighbourhood are:

| surface | what it owns | fit for ARM |
|---|---|---|
| `src/gui/modern/sacn_monitor_panel.js` | the **bridge's own** IN/OUT monitors — renders the bridge's `{type:'log'}` lines (`:121-124`, fed from `sacn_input_source.js:249-250`), reads `window.sacnInput.stats`, and already carries a destructive action button (BLACKOUT, `:208-219`) | **Best.** The only UI that already talks to the bridge socket |
| `src/gui/controller_map_editor.js` (3004 ln) | `controllers.yaml` authoring — persistent controller/port/universe config (`:1-16`) | Wrong: persistent config, not a session mode |
| `src/gui/led_discovery_panel.js` (2143 ln) | device discovery + HTTP pushes to boards | Wrong: persistent device state; and while armed its pushes to owned controllers correctly **fail** (§11) |
| `src/gui/subscribed_universes_prompt.js` | the `📡 Subscribed Universes` save-gate dialog | Wrong: save-time, modal, one field |

**Confirming the operator's preference, with one correction.** Put the
ARM/DISARM control in `SacnInMonitor` (`sacn_monitor_panel.js:157-186`),
alongside the stat rows, matching the BLACKOUT button recipe already in
`SacnOutMonitor`. It is the bridge-owning surface, `window.sacnInput` is right
there, and the bridge's own transition log lines already land in that panel's
activity log.

**The correction:** that panel is **not persistent**. It is shown only when the
lighting-engine mode is `sacn_in` *and* enabled — `gui_builder.js:1601` and
`pattern_editor.js:804` both call
`window.showSacnInMonitor(mode === 'sacn_in' && enabled)`. That is the correct
gate for the *control* (arming is meaningless outside the mode where the bridge
relays engine frames to hardware), but it is the **wrong** gate for the status.

So: **status goes in a panel-independent HUD banner**, a new
`src/gui/bench_mirror_banner.js` copied structurally from
`src/gui/multi_client_warning.js` — a pure state function
(`bannerStateForCount`-shaped, unit-testable without a DOM, `:28-35`) plus lazy
DOM creation that is safe before `<body>` exists (`:42-68`). Same fixed
top-centre slot, error palette via theme vars, `pointer-events:none`. It must
name the owned destinations, because "armed" alone does not tell the operator
which hardware changed hands.

---

## 7. Q6 — state and lifecycle

**Process topology.** `launcher.js` spawns `simulation/start.js`
(`launcher.js:1164`), which spawns `server/sacn_bridge.js` with `--scene`
(`start.js:105-108`) under crash supervision with a restart budget
(`start.js:155-200`). The bridge is **its own process**.

**Where the armed flag must live: bridge process memory.** A module-level
`let _mirrorArm = null;` beside the existing `_activeMirrors` / `_mirrorEntries`
(`sacn_bridge.js:225-231`). Never written to disk.

There is an exact precedent for this in the engine: PERFORMANCE MODE is
documented as *"live-show structural lock (**in-memory only**). A fresh boot is
always `{active:false}`"* — `marsin_engine/lib/api_server.js` `/status` handler,
`:4977-4982`. Same discipline, same reason.

**Lifecycle matrix:**

| event | bridge process | armed state | what the UI must do |
|---|---|---|---|
| launcher start / restart | new | **OFF** ✅ | nothing (banner absent) |
| bridge crash → `start.js` restart | new | **OFF** ✅ (fail-safe: the composing writer dies, the ordinary relay comes back) | the WS reconnects (`sacn_input_source.js:177`, 3 s) and must **re-read** status |
| sim page reload | untouched | **survives** ⚠ | the bridge must **push status on every new connection**, exactly like the client census (`sacn_bridge.js:726-741`) — otherwise a reloaded tab shows no banner while the hardware is still mirrored |
| WS drop + auto-reconnect (3 s loop) | untouched | must **survive** | ditto — this is why the flag is process-scoped, not socket-scoped (§12 open question) |
| engine restart / scene switch | untouched | must **auto-disarm loudly** | precondition 2 already goes false on the next poll; the flag must follow so the banner cannot lie |

**Launcher wiring recap:** `node launcher.js dev --scene titanic` →
`opts.scene` (`launcher.js:231`) → preflight that the scene and the engine model
both exist (`:577-584`) → `start.js --scene titanic` (`:1164`) →
`sacn_bridge.js --scene titanic` (`start.js:105-108`) → `pinnedScene`
(`sacn_bridge.js:26`, `:193`). Nothing in that chain can arm anything, which is
the property to preserve.

---

## 8. Q7 — wrong-scene detection

Already built and already correct. `pollEngineStatus` (`sacn_bridge.js:659-707`)
GETs `http://127.0.0.1:<enginePort>/status` every 3 s (`ENGINE_POLL_MS`, `:191`),
verifies `j.service === 'marsin-engine'` (`:670`) and reads
`j.activeScene`, mapping the literal `'unknown'` to `null` (`:672`). The engine
side is `marsin_engine/lib/api_server.js:4939-4947` —
`activeScene: opts.modelName || 'unknown'`. Every reachability/scene transition
is logged once (`:690-701`) and triggers a recompute (`:706`).

So the bridge **already knows** the engine's scene, first-hand, with ≤3 s
latency and a null for "unreachable".

- **ARM-time check:** refuse unless `engineState.reachable === true &&
  engineState.scene === spec.sourceScene`, naming both scenes in the refusal.
- **While armed:** precondition 2 inside `isMirrorActive`
  (`bench_mirror.cjs:237`) already makes the mirror inert the moment the engine
  moves off `titanic` or goes unreachable — no new mechanism needed. The ARM
  flag must be cleared in the same pass, loudly, so the banner cannot outlive
  the mirror.
- Note the 3 s worst-case window: an engine scene switch is not instantaneous at
  the bridge. During it the mirror keeps composing against the OLD layout. That
  is pre-existing and unchanged by this design; the engine's own scene switch is
  a supervised restart (`launcher.js:1220-1240`), so frames stop before the
  bridge notices — the failure mode is a held frame, not wrong bytes.

---

## 9. Q8 — disarm cleanliness (and Q9's hardware caveat, which is entangled)

### What happens today when a route disappears

`recomputeRoutes` closes the retired sender and moves on —
`sacn_bridge.js:568-574` (mirror) and `:528-535` (relay). `close()` in the
`sacn` package is **socket teardown only**:

```js
close() { if (loopId) clearTimeout(loopId); this.socket.close(); return this; }
```
— `simulation/node_modules/sacn/dist/sender.js:81-86`

**No blackout frame. No stream-terminated bit.** And the package *cannot* set
that bit: `Packet` hardcodes `this.options = 0` on the TX path
(`node_modules/sacn/dist/packet.js:79`, written into the buffer at `:121`), so
E1.31's `stream_terminated` flag is unreachable without patching the dependency
— which the offline-readiness rule makes a real cost, not a shrug.

Consequences per destination, measured:

- **`10.x.x.10` / U2 (DMX gateway):** the *same recompute* restores the
  suppressed `U2 → .10` relay route, so the gateway is fed again within one
  frame. **No frozen frame.** But it is now fed **raw titanic U2** — wall-bar
  bytes landing on bench pars/vintage/bars at bench addresses, i.e. lit
  garbage. That is the pre-existing behaviour of a titanic-only session, not a
  regression, but the disarm log and the banner's exit state should say so
  rather than let it read as a mirror bug.
- **`10.x.x.60` / U10 + U12 (MarsinLED):** nothing else writes those pairs
  (§4), so after disarm the outputs are **unfed**. The board holds its last look
  until its own `dmx.timeoutMs` blackout — `docs/41_led_controller_onboarding.md:194`
  and `:364-368`: *"`timeoutMs` 0 = hold-last-look forever; >0 = blackout after
  N ms of no data"*, with `3000` as the documented example. **The repo never
  sets this field** (`device_config_mapper.js:229` only *references* it; grep
  finds no writer), so the actual value on that board is **unknown from the
  configs**. If it is 0, the strands freeze on the last mirrored frame forever.

**Therefore a clean disarm needs an explicit blackout**, and it must be flushed
*before* the senders are closed. Mechanics: `sendVia(entry, payload, priority,
label)` (`sacn_bridge.js:946-977`) already exists and is shared by relay and
mirror; it currently returns nothing, so the disarm path needs it to return the
underlying promise so the blackout can be awaited before `sender.close()`.

### Q9 — the `10.x.x.60` hardware question (configs and reports only; **no packets sent**)

This is the sharpest finding in the audit.

**The same physical board is bound in BOTH scenes, with different identities:**

| | `scenes/titanic/controllers.yaml:28-63` | `scenes/test_bench/controllers.yaml` (id 5, ip at `:44`) |
|---|---|---|
| card name | `LeftLeftRopes` | `Titanic_202` |
| universes | U30 (out 1), U31 (out 2) | **U10** (out 1), **U12** (out 2) |
| parked | out 3 @ U42 | out 3 @ U11 |
| `device.controllerId` | **`testbench`** | **`titanic_202`** |
| `device.boardId` | `angio4-old` | `angio4-old` — **same board** |
| `lastPush.at` | `2026-08-03T21:28:07Z` | `2026-08-05T07:00:59Z` |
| `lastPush.outcome` | **`applied`** | **`needs-reboot`** |
| `configHash` | `230e6a8e7d7d…` | `0ea7d8a09fc0…` |

**Reading, stated as evidence not assertion:** the *later* push (test_bench,
U10/U12) has **not** been confirmed applied — `needs-reboot` means the config
was written but the board has not come up on it. Unless it has been rebooted
since that receipt was written, the board is still running the **earlier
`applied`** config: **U30/U31**, i.e. the titanic binding. This is exactly the
open item `_89` §6 step 4 predicted, still open, and now with the receipt
pointing the *other* way than it did then.

**So: would the strands respond today, armed?**

- To the **mirror** (U10/U12): **probably not** — the board is most likely not
  listening on those universes.
- But they would very likely be **lit anyway**, by the **un-suppressed raw
  `U30/U31 → .60` relay** (§4), carrying the same titanic rope content at
  40 px instead of the mirror's 20.

**That is a false positive waiting to happen.** The operator arms, sees the
strands playing the ship's ropes, and concludes the mirror works — while the
mirror's frames are being discarded at the board. Any future change to the
mirror's LED slices would then appear to do nothing, for reasons two subsystems
away.

**Design consequence (belongs in the implementation):** at ARM time, warn by
name when an owned destination's **host** also receives non-owned relay
universes — here `.60` gets U30/U31 from the relay *and* U10/U12 from the
mirror. The banner and the arm reply should list what the host is being fed, not
just what the mirror owns.

**Operator action if the strands stay dark** (unchanged from `_89` §6 step 4,
and it is a revert, not a new mapping): open the **test_bench** scene's
controller pane, review the `Titanic_202` card, press **Push** once, let it
reboot. Not an agent action — it is a device write.

**Also flag:** the two cards disagree on `device.controllerId` (`testbench` vs
`titanic_202`) for one `boardId`. Memory `marsinled-controller-onboarding` is
explicit that binding is **by `controllerId`, not IP**. Two cards claiming one
board under two ids is a reconcile hazard independent of this feature.

---

## 10. Q10 — the test landscape

**`simulation/tests/bench_mirror.test.js` (395 ln, 30 tests)** — three tiers:

1. **Structural refusals** (`:53-148`): non-mapping file, unknown top-level and
   slice keys, wrong version, non-boolean `enabled`, missing `source_scene`,
   empty `mirrors`/`slices`, non-integers, out-of-range, source *and*
   destination overrun past 512, two slices on one destination channel,
   duplicate destination, every refused `dest_host` class. Adjacent
   non-overlapping slices accepted.
2. **Activation + composition** (`:150-253`): all three preconditions falsified
   individually (`:152-159`); byte-exact splicing; a universe no slice reads;
   **buffer persistence**; a dropped channel → 0 not stale; null payload → 0;
   unknown destination throws; the two bridge projections
   (`mirrorSourceUniverses`, `mirrorDestPairs`).
3. **LIVE-map tests** (`:255-375`) — read the committed sidecar against the real
   `test_bench`/`titanic` scenes and the real generated
   `marsin_engine/models/*.js`: every DMX slice is whole titanic fixtures
   starting on a fixture boundary; every slice lands on a bench fixture of the
   same footprint; LED slices equal `pixelCount × 4` at the strand's own
   channel; every mirrored source universe is one the model actually sends;
   every destination is a port the bench hardware declares.

**Bridge wiring tests are source-string reads, not execution** —
`bench_mirror.test.js:379-395` and `bridge_routing.test.js:625/637/651`
`readFileSync` `sacn_bridge.js` and regex-match it. **No test ever executes
`sacn_bridge.js`.** That is the whole reason the `_105` second pass had to build
a fake-module rig in `~/tmp`.

**Harnesses that exist for port-free bridge testing:**

- **Pure-module**, the dominant style: `bridge_routing.test.js`,
  `bench_mirror.test.js` — everything in `lib/*.cjs` is dependency-free by
  design (`bridge_routing.cjs:29-32`).
- **Real-socket stub bridge**, the one integration precedent:
  `tests/bridge_route_readback.test.js:412-460` — `new WebSocketServer({ port: 0 })`
  (ephemeral loopback), a stub that implements the bridge's message contract and
  answers `getRoutes` with the **real** `buildRouteTableSnapshot`, driven by the
  real `SacnInputSource`. **This is the model for the new WS messages** — it
  binds nothing the operator owns and sends no sACN.
- **Fake-socket seam:** `fakeWsSource()` (`bridge_route_readback.test.js:349-354`)
  fakes `_ws` with `{readyState:1, send}` — enough to test client-side
  request/reply correlation with no socket at all.

**Where new tests naturally live:**

| coverage | home | shape |
|---|---|---|
| arm/disarm decision, every refusal reason | **new** `tests/bench_mirror_arm.test.js` | pure — against a new `evaluateArmRequest()` in `lib/bench_mirror.cjs` |
| suppression + ownership under arm/churn (incl. `_105` M2 and F10) | same file | pure — feed `computeEffectiveRoutes` output + a fake `engineState.owned` |
| WS message wire shape (`benchMirrorArm` / `Disarm` / `Status`) | `tests/bridge_route_readback.test.js` (extend) | `WebSocketServer({port: 0})` stub, same as `:412` |
| "armed defaults false", "blackout precedes sender close", "suppression outside the mirrorSig gate" | `tests/bench_mirror.test.js` (extend the wiring block at `:377`) | source-string assertions, the established idiom |
| **zero-packet proof** | the suite's own discipline | keep every new test pure or `port: 0`; never construct a real `Sender` |

Baseline to hold: `_148` records `cd simulation && npm test` at **1773 / 1766
pass / 7 fail**, the documented environmental set.

---

## 11. Q11 — what else an implementer must not break

- **The `_127` read-back contract is load-bearing and brittle by design.**
  `buildRouteTableSnapshot` (`bridge_routing.cjs:524-535`) emits
  `{type, reqId, routes, engineOwned, mirrorOwned, activeScenes}`;
  `normalizeRouteSnapshot` **throws** if any of the first three arrays is
  missing (`bridge_route_confirm.js:167-172`). **Adding** a field is safe;
  renaming or dropping one breaks the LED push's third check.
- **A mirror-owned pair already fails an LED push, on purpose.**
  `assessRouteReadback` (`bridge_route_confirm.js:214-217`) classifies a
  mirror-owned expected pair as a **one-writer conflict**, never a ✓, with the
  sentence at `:271-273`. So **while armed, any per-output push to `10.x.x.10`
  will fail its route confirmation.** Correct behaviour — do not soften it. The
  banner should say so, or the operator will read it as a push bug.
- **Engine-owned pairs outrank everything.** `engineOwnedPairs`
  (`bridge_routing.cjs:370-382`) applies regardless of protocol. See §5.
- **CaptainPad is not on this socket.** The chain is CaptainPad :6967 → ws →
  engine :6968 → sACN → bridge :6969-6972 (AGENTS.md, full-stack smoke). No
  CaptainPad client speaks to :6971; arming does not touch it. What arming
  *does* change is what CaptainPad's pattern output looks like on the bench —
  through the mirror's re-address, and through F8's quantisation.
- **The sACN IN monitor is the operator's only live view of bridge decisions.**
  Every `broadcastLog` line (`sacn_bridge.js:930-936`) lands there. Arm/disarm
  transitions, refusals and suppressions must all go through it, not only to
  the launcher terminal.
- **Never reintroduce last-writer `setScene`** (`_15`, memory
  `sacn-route-ownership`). The ARM must be additive state, not a route-table
  swap.
- **Known-live defects on this exact path**, unfixed as of this read: `_105`
  **F3** (browser preview at 39 %), **F4** (one CID project-wide), **F5**
  (priority lockout is global across all universes — one prio-150 frame stops
  the whole relay for 10 s), **F8** (mirror quantisation), **F19** (no debounce
  on `setScene` recomputes). An arm/disarm that triggers a recompute inherits
  F19's cost.

---

## 12. Recommended design sketch — one implementer, one slice

### 12.1 State

```
sacn_bridge.js (module scope, beside _activeMirrors at :225)
  let _mirrorArm = null;   // null | { scene, armedAt, reason }
```

Process memory only. Never persisted. OFF at every process start by
construction (§7). Precedent: engine PERFORMANCE MODE
(`api_server.js:4977-4982`).

### 12.2 Activation — one call site changes

`bench_mirror.cjs:234-238` — rename the third parameter and keep the other two
preconditions verbatim:

```js
function isMirrorActive(spec, engineScene, armed)   // was: ownSceneActive
```

`sacn_bridge.js:434` passes `_mirrorArm !== null && _mirrorArm.scene === found.scene`
instead of `activeSceneSet.has(found.scene)`. **That single substitution removes
the second-tab requirement.** Update the wiring assertion at
`bench_mirror.test.js:385` in the same change.

### 12.3 Protocol — two new inbound messages, one new broadcast

Added to the `ws.on('message')` handler at `sacn_bridge.js:748-785`:

| message | reply |
|---|---|
| `{type:'benchMirrorArm', scene, reqId}` | `{type:'benchMirrorStatus', reqId, armed, scene, sourceScene, destinations, hostAlsoFed, warnings, refusal}` |
| `{type:'benchMirrorDisarm', reqId}` | same shape, `armed:false` |

The **same status object minus `reqId`** is broadcast to **all** clients on every
transition **and to each new connection** (alongside `broadcastClientCensus()`,
`:726-746`) — that is what keeps a reloaded tab honest (§7).

Reply, never throw: the outer `catch` at `:784` would otherwise swallow a
refusal, exactly the trap `:769-770` documents for `getRoutes`.

### 12.4 Fail-loud ARM checks — every one refuses with a named reason

Implement as a **pure** `evaluateArmRequest({specs, scene, engineState, activeArm})`
in `lib/bench_mirror.cjs`, returning `{ok, refusal, warnings, destinations}`, so
every branch is unit-testable with no socket:

1. a sidecar exists for `scene` and **parses** — `parseBenchMirrorSpec` already
   throws with the offending YAML path (`bench_mirror.cjs:66-68`);
2. `spec.enabled === true`;
3. `engineState.reachable && engineState.scene === spec.sourceScene` — name both
   scenes in the refusal (**wrong-scene detection**, §8);
4. `engineState.ownedUnavailable !== true` — ownership unprovable ⇒ refuse
   (codex P0: no permissive default);
5. **no destination pair ∈ `engineState.owned`** — `_105` M2 (§5);
6. **no destination pair claimed by another enabled sidecar** — `_105` F12;
7. not already armed to a different scene (disarm first — explicit, no implicit
   swap);
8. **warnings** (do not refuse): every owned destination that is also a live
   relay pair (so the operator sees which relay is about to be suppressed); every
   owned **host** that also receives non-owned relay universes (§9's `.60` trap);
   the writer-#2 caveat (a sim tab in `sacn_in` mode outranks the mirror at 150).

Then the **proof**: after `recomputeRoutes('bench mirror armed')`, self-check
`buildRouteTableSnapshot` — every owned pair must be in `mirrorOwned` and in
**none** of `routes` / `engineOwned`. If not, auto-disarm and report the failure.
That reuses the `_127` snapshot as an internal assertion, which is the cheapest
possible "unprovable ownership fails loudly".

### 12.5 Suppression

Mechanism unchanged (`sacn_bridge.js:454-455`, already pinned by test). Two
fixes ride along:

- subtract `engineState.owned` from `mirrorTargets` at `:445-453`, log each
  subtraction, and **auto-disarm** if it fires while armed (the engine acquiring
  a pair mid-session is a real transition, §5);
- move the `🚫 Relay suppressed … BENCH MIRROR` loop out of the `mirrorSig` gate
  (`:593-616`) onto its own signature, mirroring `excludedSig` at `:619` —
  `_105` F10.

Optional one-liner while in there: key mirror-state reuse on the parsed spec
rather than raw bytes (`:438`) — kills `_105` F14 for free.

### 12.6 Disarm sequence — ordered, and the order is the feature

1. set `_mirrorArm = null`;
2. **for each owned destination**: compose an all-zeros 512-channel payload and
   `sendVia()` it, **3×** (E1.31's convention for a terminating source), at the
   last-used priority. `sendVia` (`:946`) must return its promise so this can be
   awaited. **This step is mandatory** — the `sacn` package cannot set
   `stream_terminated` (`packet.js:79`) and `Sender.close()` only closes the
   socket (`sender.js:81-86`), so without it `.60`'s outputs hold their last look
   until an unknown device-side `dmx.timeoutMs` (§9);
3. `await` those sends, **then** `recomputeRoutes('bench mirror disarmed')` —
   which closes the mirror senders (`:568-574`) and restores `U2 → .10` to the
   ordinary relay (`:536-556`) in the same pass, so the DMX gateway is never
   unfed;
4. broadcast the status transition; the banner clears;
5. the disarm log line states plainly that the bench gateway now shows **raw
   titanic U2** (lit, wrong fixtures) — pre-existing, but it must not read as a
   bug.

**Auto-disarm triggers**, each with the same sequence and a loud reason: engine
scene leaves `source_scene`; engine unreachable; an owned pair becomes
engine-owned; the sidecar stops parsing or flips `enabled: false`. Preconditions
1+2 already make the mirror inert on the next recompute — the flag must follow so
the banner can never outlive the mirror.

### 12.7 Status surface

- **Control:** ARM/DISARM in `SacnInMonitor` (`sacn_monitor_panel.js:157-186`),
  BLACKOUT-button recipe (`:208-219`). Armed state renders as a stat row too.
- **Banner:** new `src/gui/bench_mirror_banner.js`, structural copy of
  `multi_client_warning.js` (pure state fn + lazy DOM, `:28-68`), driven from
  `sacn_input_source.js:246-265` on `{type:'benchMirrorStatus'}` exactly as
  `{type:'clients'}` is handled at `:251-255`. Panel-independent by construction.
  Text must name the destinations, e.g.
  `🪞 BENCH MIRROR ARMED — titanic → test bench · U2→…10, U10/U12→…60 · relay suppressed`.
- **Console + monitor log:** keep the existing `🪞` / `🚫` lines
  (`sacn_bridge.js:602-615`), now on their own signatures.

### 12.8 Rough size

~150 lines in `sacn_bridge.js`, ~80 pure lines in `bench_mirror.cjs`, ~70 in a
new banner module, ~30 in `sacn_input_source.js`, ~40 in `sacn_monitor_panel.js`,
plus a new `tests/bench_mirror_arm.test.js` and extensions to two existing test
files. One implementer, one slice. No scene YAML changes. No device HTTP.

---

## 13. Open questions only the operator can answer

1. **Socket-scoped or process-scoped arm?** Process-scoped (recommended) means a
   sim page reload does **not** disarm — safer against the 3 s reconnect loop
   (`sacn_input_source.js:19,177`), but the hardware stays mirrored with no
   browser open. Socket-scoped disarms on every transient WS drop. Should the
   bridge **auto-disarm when the last client disconnects**?
2. **Refuse to arm while more than one sim window is connected?** The bridge
   already counts clients (`sacn_bridge.js:726-741`), and a second window in
   `sacn_in` mode is the writer-#2 hazard that outranks the mirror at 150. A hard
   refusal is the codex-shaped answer; it is also the exact configuration
   today's mechanism *required*. Refuse, or warn loudly in the banner?
3. **`10.x.x.60`'s real config** — has the board been rebooted since the
   `2026-08-05T07:00:59Z` `needs-reboot` receipt on the `Titanic_202` card? If
   not, the armed strands will be driven by the raw U30/U31 relay, not by the
   mirror (§9). Only the operator can push+reboot.
4. **Should the raw `U30/U31 → .60` relay be suppressed while armed?** It is not
   an owned pair, so today it stays live. Suppressing it would make the mirror
   the *only* writer to that box and turn §9's false positive into a clean dark
   strand — a much better diagnostic, at the cost of widening what "owned"
   means from *pair* to *host*.
5. **`controllerId` divergence** — one board (`boardId: angio4-old`) is
   `testbench` in the titanic scene and `titanic_202` in test_bench. Which is
   canonical? (Independent of this feature; a reconcile hazard.)

---

## 14. Hygiene

- **Zero writes** outside this report and the tracker landing block. No source,
  test, doc or scene edits. No git operation of any kind.
- **No process started**: no engine, no sim, no bridge, no server. **No port
  bound.** No sACN datagram, no multicast join, no device HTTP. The operator's
  live stack (6966–6972, 5568, 8081, 10000) and the controllers on the LAN were
  never approached.
- Every claim above is a file read; every citation is `file:line` against the
  working tree on `feat/bm_readiness`.
- IPs redacted to `10.x.x.NN` in prose throughout.

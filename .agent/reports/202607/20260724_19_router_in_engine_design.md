# 2026-07-24 — Design study: move the hardware ROUTER out of sim/Chrome into the ENGINE (Slice 19, bm_readiness)

**DESIGN ONLY — no source edits, no git ops, no process touched.** Operator
ask (Sina): *"would moving the router into the engine fix the freeze when I
move away from the sim tab? … give me the design, and benefits and risks of
the change ONLY."* This study answers that, and resolves pending operator
decision **#12** (writer-#2 arbitration, report `20260724_15` §2.3) instead
of dodging it.

---

## 0. TL;DR

Yes — moving hardware-output authority into the engine removes Chrome from
the write path **by construction**, and most of the machinery already
exists: the engine already unicasts to declared controllers
(`output_dispatch.js`), already exposes its routes (`/status
outputRouting`), and its auto-exported models already carry everything an
engine-side per-fixture Off/Brightness stage needs (`fId`, `group`,
`patch {universe, addr, footprint}`, per-pixel channel offsets). The one
thing the browser writer does today that nothing else does — deliver the
operator's per-fixture Off/Brightness overrides to hardware — moves to a
small engine API + a pre-send buffer stage (= decision #12 **option (ii)**).

**Recommendation: GO, in three phases.** Phase 1 alone (overrides →
engine API; `sacn_in` tabs stop writing hardware) removes every
Chrome-focus/throttle dependency from the lights and is a small,
independently-revertible slice. Full effort ≈ 1–1.5 weeks of agent work +
3 bench sessions, each phase rollback-safe.

---

## 1. The CURRENT routing/relay architecture (what actually runs today)

Show topology (launcher `prod`/`dev`, `lighting_mode=sacn_in`):

```
 marsin_engine (:6968 API, 40 fps tick)
   └─ output_dispatch.js
        ├─ flat sACN  → 127.0.0.1:5568          (undeclared universes + alsoFlat)
        └─ unicast    → declared controllers     (config.yaml `controllers:`,
                        sACN or Art-Net)          e.g. Titanic-202 U10/U12

 sacn_bridge.js (:6971 WS + UDP 5568 Receiver)          ← "the router" today
   ├─ priority arbitration (≥150 OVERRIDE + 10 s lockout)
   ├─ HARDWARE RELAY: union routes (CLI pin ∪ engine activeScene polled
   │    every 3 s ∪ refcounted client scene tags) − engine-owned (U→ip)
   │    pairs from /status outputRouting   [landed TODAY, report _15]
   └─ WS broadcast (515 B frames) → every connected sim tab

 Browser sim tab (sacn_in mode) — animate.js per rAF frame:
   WS frames → dmxRouter (prio-200 source) → demap to pixels (display)
   → applyFixtureOutputOverrides()  ← per-fixture/group Off + Brightness
   → sends ALL patched universes, prio 150, to :6972
                                       (sacn_output_bridge → unicast to
                                        controllers as 'BM26-Simulation')
```

Key facts this design must respect:

1. **Hardware can still have up to two writers.** Today's fix killed the
   engine-vs-bridge dual write (suppression) and route flapping (union),
   but the **browser** is still a prio-150 writer in `sacn_in` mode
   (`animate.js:543-590`) — and it is the ONLY delivery path for the
   operator's per-fixture Off/Brightness overrides
   (`dmx_output_overrides.js`, applied to the merged buffers each rAF).
   That is exactly why it couldn't just be deleted (decision #12).
2. **The browser writer is clocked by Chrome.** rAF throttling on focus
   loss / occlusion / GPU contention makes it stall and then re-send
   **stale** frames in bursts (measured 0.3–1 Hz under contention, _15
   §2.3) — the leading mechanism for both the "flicker while focused"
   and "freeze when I move away from the sim tab" observations. No amount
   of bridge-side cleverness fixes a writer that lives inside Chrome.
3. **The gateways do not honor sACN priority** (option (iii) was ruled
   broken), so multi-writer states cannot be arbitrated at the receiver.
4. **Sim-without-engine matters on the bench.** In browser-generator
   modes (`pixelblaze` / gradient), `mapPixelsToSacn` + the same :6972
   path lets the sim drive hardware with NO engine running. This workflow
   must survive.
5. **The engine model is auto-exported from the sim scene** and already
   carries per-pixel `fId`, `group`, `patch {universe, addr, footprint}`
   and channel-role offsets (`models/test_bench.js`) — the metadata an
   engine-side override stage needs already ships.
6. The engine restarts on scene switch (exit 75, launcher-supervised), so
   "hardware follows the data generator" is achievable **by construction**
   rather than by the bridge's 3-second poll.

---

## 2. Target architecture

### 2.1 Where routing lives: IN-PROCESS in the engine (not a sidecar)

Extend `marsin_engine/lib/output_dispatch.js` to be the **only** hardware
writer. Rejected alternative — an engine-spawned router sidecar — because:

- The engine is *already* a hardware writer (per-controller sACN unicast +
  Art-Net senders, fail-loud validation, hot `addUniverse`). A sidecar
  duplicates that behind an IPC hop.
- Chrome-immunity is identical either way; the sidecar's only real win
  (output surviving an engine restart) is moot — when the engine is down
  there is no data to output, and "hold last look" already happens at the
  gateway.
- A sidecar is one more process for the launcher/boot chain to supervise,
  one more port, one more failure mode, one more thing to keep alive
  through a playa power cut. Codex bias: fewer moving parts, fail loud.

### 2.2 Universe → destination truth

- **Authoring truth stays where the operator edits it**: the scene's
  `patches.yaml` (`controllerIp` per patch) in the sim UI.
- **Runtime truth = the engine model.** The existing model exporter bakes
  a `controllers` table (host, protocol, universes, per-box transport)
  into the exported model, exactly mirroring what `patches.yaml` declares.
  Because the engine restarts per scene, routing follows the active scene
  automatically — no polling, no `setScene` messages, no route table that
  anything else can write.
- **Per-box differences** (Art-Net vs sACN, show-server vs laptop hosts)
  live where they already do: `marsin_engine/config.yaml` overlays merged
  by `deploy/deploy.py` per machine. `config.yaml controllers:` becomes an
  override/extension of the model's table, with `output_dispatch`'s
  existing fail-loud rules (duplicate universe claim → throw).
- `/status outputRouting` (landed today) remains the observability
  contract — the sim monitor and any tooling can always see who owns what.

### 2.3 Operator overrides — the decision-#12 answer (option ii)

New engine stage + API, mirroring `simulation/src/dmx/dmx_output_overrides.js`:

- **Engine module** `lib/output_overrides.js`: applied to the serialized
  universe buffers AFTER pattern/effects/intensity render, BEFORE
  `sendFrame()` — the same "unbeatable last layer" position it has in the
  browser today. Blackout = zero the fixture footprint at
  `(patch.universe, patch.addr, patch.footprint)`; Brightness = scale
  intensity-role channel offsets. All inputs come from model pixels
  (`fId`, `group`, `patch`, `channels`). Gap to close: the exporter must
  add master/`dimmer`-role offsets for fixtures that have them (the
  current per-pixel `channels` maps carry color roles only).
- **API**: `GET/PUT /output-overrides` — `{ fixtures: {fId|name:
  {enabled, brightness}}, groups: {group: {enabled, brightness}} }`, plus
  a WS broadcast (`outputOverrides`) so every UI stays in sync.
- **Sim UI becomes a CLIENT**: the Lighting Controls Off/Brightness
  widgets POST to the engine and render from the broadcast — one-shot
  HTTP, immune to rAF throttling (precedent: the sim's sACN Blackout
  button already calls the engine's `/global-blackout`). Latency budget:
  localhost POST (≤5 ms) + next engine tick (≤25 ms) ≈ ≤30 ms — vs
  "next rAF of a possibly-throttled tab" today. Overrides get *faster and
  more reliable*, not slower.
- **Persistence**: engine `states/` (existing `saveGlobals` machinery —
  the engine already persists `dimmers`, `blackout`,
  `groupFixedColors` this way), re-applied at boot and across the exit-75
  scene-switch restart. A fixture the operator killed mid-show MUST NOT
  come back on after a restart; a test asserts the replay.
- Sim-scene `groupOverrides` in `scene_config.yaml` stay as authoring
  defaults; on scene load the sim seeds the engine once (explicit,
  logged), then the engine is live truth.

### 2.4 Sim tabs become pure viewers

In `sacn_in` mode, delete the browser hardware-relay branch
(`animate.js` "relay ALL universes" path). The tab keeps: WS frames in →
dmxRouter → pixels for display, plus a local *preview* application of the
override state received from the engine broadcast (so the 3D view matches
the lights). It writes NOTHING to :6972.

**Browser-generator modes are explicitly preserved**: when the sim IS the
data source (`pixelblaze` / gradient bench work, engine not running), the
:6972 path and browser-side override application stay exactly as today —
single writer there by definition. The rule becomes one sentence:
**whoever generates the data writes the hardware; viewers never write.**

### 2.5 Fate of the bridges and launcher topology

- **`sacn_bridge.js` (:6971)** — keeps UDP receive, priority/OVERRIDE
  arbitration, monitor logging, client census, and the WS viewer feed.
  Its HARDWARE RELAY retires at the end of Phase 2 (today's union +
  suppression code is the migration shim: as the engine claims each
  controller, suppression already removes the bridge route live). No
  `--relay` fallback flag — codex P0, no fallbacks.
- **`sacn_output_bridge.js` (:6972)** — unchanged; serves
  browser-generator bench modes only. Idle in show profiles.
- **Launcher** — process list, ports, startup order, boot chain
  (docs/43), power-cut behavior: all unchanged. The engine's flat sender
  to `127.0.0.1` remains the viewer feed; in multi-box setups
  `sacn.destinations` can additionally carry the laptop's IP so a remote
  box gets a viewer feed with zero new machinery.
- **Offline/playa**: no new dependencies, no new processes, no network
  services beyond what runs today. Strictly fewer moving parts in the
  hardware path.

---

## 3. Failure-mode analysis

| Scenario | Today | After the move |
|---|---|---|
| **Engine process dies** | Lights lose content anyway (engine is the sole generator). BUT a `sacn_in` tab keeps re-sending its last stale frames at prio 150 — a frozen-look zombie that masks the failure. | Hardware stream stops cleanly; gateways hold last look (or blank per their E1.31 stream-loss behavior). Launcher already treats engine exit ≠75 as fatal → teardown → boot supervisor restarts the stack (docs/43). Honest failure, existing watchdog. Add: sim HUD "engine output silent" banner (viewer-side observation, no writer role). |
| **Scene-switch restart (exit 75)** | Brief dark (no data during restart). | Same. Override state replays from engine `states/` at boot. |
| **Migration mixed states** | — | Safe by design: the bridge's suppression already stands down per (universe→ip) pair exactly when the engine claims it, and warns on an old engine without `outputRouting`. Every phase is live-compatible with the previous one. |
| **Multi-box (show server + laptop)** | Two boxes' stacks can both write the same controllers; nothing detects it across boxes. | Same hazard, now *auditable*: each box's `/status outputRouting` declares its claims; a trivial cross-box check (deploy `verify` step) can refuse overlapping claims. Per-box controller declarations live in deploy overlays. |
| **CaptainPad** | Talks only to the engine API/WS. | Unaffected. Bonus: per-fixture Off/Brightness becomes reachable from CaptainPad later (it's just an engine endpoint now). |
| **Bench, no engine** | Browser-generator modes drive hardware via :6972. | Preserved verbatim (§2.4). The thing that is *lost*: a `sacn_in` VIEWER tab can no longer be abused as a hardware relay — which is precisely the bug class being removed. |
| **External sACN source (console → bridge → controllers)** | The bridge relays any winning source to routed controllers. | Dies with the relay in Phase 3. Assessed minor: a console can unicast the controllers directly (same L2 network), and the OVERRIDE/priority *monitoring* stays. Flagged for the operator to veto if this path is ever actually used. |
| **Stale model export** | Stale models already hurt (wrong pixels/universes; known hot-reload gap). | Stakes rise: overrides would target wrong addresses. Mitigation in Phase 1: exporter stamps a model hash; sim compares `/status` model hash vs the active scene and shows the existing amber mismatch affordance; override PUTs against a mismatched model are refused loudly. |

---

## 4. Benefits (each tied to an observed problem)

1. **Chrome-immunity of hardware output** — the freeze at focus loss
   (raw observation #9) and the stale-burst 0.5–1 s beat (_15 §2.3) become
   *structurally impossible*: no browser is a writer, so rAF throttling,
   GPU contention, tab lifecycle and window focus cannot touch the wire.
2. **Single writer by construction** — resolves decision #12 as option
   (ii). No interleaved sources/seqErrors at the gateways (the _15 flicker
   mechanism), no reliance on the gateways' broken priority handling
   (option iii), no per-(universe,ip) arbitration state machine to get
   wrong (option i keeps hardware chained to Chrome — today's evidence
   argues directly against it).
3. **Overrides get more reliable, consistent, and shared** — today they
   ride a contended rAF loop in ONE tab (other tabs disagree; a throttled
   tab delivers them late or not at all). Engine-side: applied every 25 ms
   tick regardless of any browser, one truth for all windows + CaptainPad,
   persisted across restarts.
4. **Priority elevation becomes whole-path** — the parallel elevation work
   (slice _20) then covers the ONLY writer; no more chasing which of three
   sources needs which priority.
5. **Route flapping can't recur** — routing is a pure function of the
   active engine model; no `setScene` table, no 3 s poll, no union
   bookkeeping once Phase 3 lands. Today's fix already proved "hardware
   follows the data generator" is right; this makes it definitional.
6. **Simpler mental model, fewer playa moving parts** — generator writes,
   viewers view, bridge monitors. One sentence an exhausted operator can
   reason with at 3 AM on playa.
7. **Multi-window tabs become hardware-harmless** — the census banner
   (landed today) demotes to a GPU-contention warning only.

## 5. Risks / costs (honest)

1. **Engine becomes the single point of failure for hardware delivery**
   (it already is for content, so the *new* exposure is limited, but the
   stale-zombie "still lit" behavior disappears — dark is more honest but
   darker). Watchdog: existing launcher + boot supervisor; no new one.
2. **Sim-only hardware driving narrows to generator modes.** If a slice
   accidentally removes the :6972 generator path, bench work breaks — the
   phase plan explicitly fences it. The external-console relay through the
   bridge is lost at Phase 3 (assessed unused; operator veto point).
3. **Stale model exports become hardware-affecting** for overrides and
   routing (compounded by the known hot-reload/universe-set engine bug).
   Requires the model-hash guard (§3) and closing the export freshness
   follow-up already on the tracker.
4. **Override coupling to engine availability** — no engine ⇒ no override
   *edits* (state persists and replays). Restart replay must be correct or
   a killed fixture relights mid-show; needs a dedicated test + HIL check.
5. **Migration surface & timing** — ≈8–12 files across THREE subsystems
   (engine dispatch/api/state, model exporter, sim animate/gui/patch
   manager, launcher docs) + test surface (sim 442, engine 2091, HIL bench
   sessions), ~5 weeks before the burn. Also supersedes part of today's
   just-landed bridge routing work (mitigated: that code IS the migration
   shim, and Phase 1 doesn't touch it).
6. **Routing-truth redesign has to be decided once, cleanly** — during
   Phase 2 there are transiently three declaration sources (scene
   patches.yaml, engine config.yaml, model table). The design collapses
   them (model = runtime truth, config = per-box overlay), but a sloppy
   landing leaves permanent ambiguity.

**Effort estimate**: Phase 1 ≈ 2–4 agent-days + 1 bench session · Phase 2
≈ 2–3 days + 1 bench session · Phase 3 ≈ 1–2 days + smoke. Total ≈ 1–1.5
weeks of agent work with operator gates between phases.

## 6. Migration & rollback sketch

- **Phase 1 — kill writer #2, move overrides (the first safe slice).**
  Engine: `output_overrides.js` + `/output-overrides` API + persistence +
  model-hash guard; exporter: master/dimmer role offsets; sim: override UI
  → engine client + delete the `sacn_in` relay branch in `animate.js`
  (generator modes untouched). Bridge (:6971) untouched — it remains the
  (Node, Chrome-immune) hardware relay. *Rollback:* re-enable the
  animate.js branch + stop posting; two small commits, independent of
  everything else.
- **Phase 2 — engine claims all controllers.** Exporter bakes the
  controller table; engine dispatch consumes it (+ per-box overlays). As
  each claim appears in `outputRouting`, the bridge's live suppression
  retires the corresponding relay route automatically — migration is
  observable route-by-route in the existing logs. *Rollback:* remove the
  declarations; suppression lifts and the bridge relay resumes, live.
- **Phase 3 — retire the bridge relay** (delete relay/union code paths;
  :6971 = viewer feed + monitor + census only), after Phase 2 has soaked
  on the bench and a full-stack smoke + `seqErrors` read on the MarsinLEDs
  confirms single-source. *Rollback:* git revert of one deletion commit.

## 7. Recommendation

**GO — phased, starting with Phase 1.** Phase 1 is small,
independently revertible, does not touch routing truth or today's landed
bridge fix, and by itself delivers the thing the operator asked for:
nothing Chrome does can perturb the lights, and it settles decision #12 as
option (ii) with evidence (option (i) would keep hardware chained to a
browser tab's focus state — the exact failure observed). Phases 2–3
complete the "engine owns the wire" end-state and should land in a calm
window with bench verification, well before playa freeze.

No implementation was started. Decision points for Sina: (a) approve
option (ii)/Phase 1; (b) confirm the external-console-via-bridge relay is
not a workflow anyone uses (Phase 3 gate); (c) pick where per-box
controller overlays live in the deploy fragments (Phase 2 detail).

# Investigation: random colours in the sim — engine data, not a rendering glitch

**Mode:** bug
**Branch + commit reviewed:** `feat/bm_readiness` @ `800806da`
**Engine boot:** no — the operator's live stack was observed passively only
(WS client taps + HTTP GETs). Nothing was bound, started, killed or restarted.
**Operator report:** *"every now and then I see random colors appearing in the
engine [sim]. I think it's related to you restarting or changing the engine on
the fly and me using that engine getting some corrupted data or something."*
Addendum: not observed on the real lights, but only a small section is watched
via the bench mirror, so hardware occurrence is **unconfirmed**, not excluded.

---

## TL;DR

1. **It is data, not rendering.** The browser-side path — bridge → WS → router →
   frame buffer → fixture — is a faithful, byte-exact carrier with no mechanism
   that can invent a colour. I audited every stage and found it clean (§3).
   Whatever the operator sees is in the DMX bytes the engine sent.
2. **Ranked root cause #1 (BLOCKER, proven):** the engine test suite spawns real
   engines that transmit sACN to **`127.0.0.1` — the operator's live sim bridge** —
   at priority 100 as source `MarsinEngine`, with the *same E1.31 CID* as his show
   engine. `npm test` runs **4 concurrent** such engines. I proved the config
   empirically (§2.1). The sim's receiver keys its sequence tracking on
   `CID+universe`, so the two streams share one counter and packets get discarded
   on the `|Δseq| > 20` rule — **silently**, because nothing listens for
   `PacketOutOfOrder`. Colliding universes stall on stale frames while the rest of
   the ship animates on: a patchwork of colours from different moments. This fires
   **exactly when an agent is "changing the engine on the fly"** — matching the
   operator's hypothesis precisely.
3. **Ranked root cause #2 (MAJOR, code-proven, not caught in the act):**
   `wasm_host.js:171` hands the pattern VM an **un-zeroed `_malloc` buffer** every
   channel every frame and copies the result back verbatim, defeating the mixer's
   own `fill(0)`. Any pixel the VM skips emits **previously-freed heap bytes** —
   i.e. another channel's or another frame's pixels. The VM *does* skip pixels: the
   red-team measured that overrunning the per-pixel instruction budget truncates
   the render silently (`_112` F9). Un-zeroed buffer × truncated render = arbitrary
   colours on arbitrary pixels, which is the symptom, verbatim.
4. **Exonerated:** browser render path, `states/**` torn writes, model hot-reload
   tearing, pattern swap/recompile ordering, sACN sender starting before first
   render, buffer resize across models. All are correctly ordered or atomic (§3).
5. **A capture procedure is ready to run** — `color_anomaly_capture.cjs`,
   validated against the live stack, dumps the last N seconds of the exact bytes
   the browser rendered plus a correlation timeline and an automatic
   engine-restart marker (§5).

**The operator's instinct was right, and more specifically right than he knew:
it is agent activity leaking into his stack. But the leak is not the *restart* —
it is the test suite's sACN output, which was never walled off.**

---

## 1. Method

| # | What I did | Where |
|---|---|---|
| 1 | Reused the prior session's probes and logs (bridge tap, engine event tap, viz probe) | `~/tmp/random_color_glitch/`, `~/tmp/sim_color_anomaly/`, `~/tmp/sim_color_inv/` |
| 2 | Read the whole browser receive path: bridge → WS → `SacnInputSource` → `UniverseRouter` → `UniverseFrameBuffer` | `simulation/src/dmx/*`, `simulation/server/sacn_bridge.js` |
| 3 | Read the vendored E1.31 receiver's sequence/dedup logic | `simulation/node_modules/sacn/dist/receiver.js` |
| 4 | **Ran the engine test suite's config guard exactly as `npm test` does** and printed the sACN block it hands every spawned engine | `~/tmp/sim_color_anomaly/guard_config_probe.mjs` |
| 5 | Traced pixel-buffer lifecycle, pattern swap ordering, boot ordering, state-file write atomicity (2 parallel read-only sub-agents) | `marsin_engine/lib/wasm_host.js`, `pattern_mixer.js`, `engine.js`, `state_manager.js` |
| 6 | Read the prior art rather than re-deriving it | reports `_15`, `_112`, `_153`, `_157` |
| 7 | Built + validated a forensic recorder against the live stack (two runs, 50 s and 25 s) | `~/tmp/sim_color_anomaly/color_anomaly_capture.cjs` |

Live-stack etiquette: only WebSocket **client** connections (`:6971`, `:6968/ws/control`)
and HTTP GETs (`:6968/status`). A client that never sends `setScene` contributes
no relay route (`sacn_bridge.js:822`, `:1325`), so no controller's traffic changed.
It does bump the client census, which shows the operator a transient
"2 sim windows connected" banner — stated here rather than hidden.

---

## 2. Findings

### BLOCKER 1 — the engine test suite transmits sACN into the operator's live sim

**`marsin_engine/tests/helpers/setup_config_guard.mjs:44-47`** — the guard that
`npm test` applies to the *entire* suite via
`node --import ./tests/helpers/setup_config_guard.mjs` (`marsin_engine/package.json:14`)
copies the real `config.yaml`, disables OSC and fire-sync, and **stops there**.
`sacn.destinations` is left at its production value.

**Evidence — I ran the guard and printed what it produces:**

```
MARSIN_CONFIG_FILE = ...\Temp\bm26_engine_config_test_47492.yaml
sacn:
  priority: 100
  sourceName: MarsinEngine
  destinations:
    - 127.0.0.1
  multicast: false
```

`127.0.0.1:5568` **is** the operator's sim input bridge — that is the engine's
one and only output path by design (`marsin_engine/lib/output_config_guard.js:17-20`).
**89 test files** under `marsin_engine/tests/` reference `engine.js`, and the
suite runs `--test-concurrency=4`, so up to four extra `MarsinEngine` sources can
be transmitting at once, on top of the operator's.

The mechanism by which this corrupts his view has three compounding parts:

1. **Shared CID.** Every sender in the project ships the `sacn` package's
   hardcoded `DEFAULT_CID` (`simulation/node_modules/sacn/dist/constants.js:23`;
   same in the engine's copy). The bridge's own mirror was given a distinct CID
   precisely because of this (`sacn_bridge.js:260-269`), but engines were not.
2. **Sequence poisoning.** The vendored receiver keys last-sequence on
   `packet.cid.toString('utf8') + packet.universe`
   (`simulation/node_modules/sacn/dist/receiver.js:25`) and **throws away** any
   packet where `Math.abs(last - seq) > 20` (`:26-31`). Two engines have
   independent counters, so both streams thrash that key and the operator's own
   frames get discarded.
3. **Silent.** The throw is re-emitted as `PacketOutOfOrder`
   (`receiver.js:36-39`), and **nothing in `simulation/` listens for that event** —
   the only references are a comment (`sacn_bridge.js:494`) and a test
   (`tests/engine_bridge_contract.test.js:236`). Frame loss is invisible.
   Worse, both processes call themselves `MarsinEngine`, so the bridge's
   source-change log (`sacn_bridge.js:1512`) never fires either. There is no
   surface anywhere that would show the operator this is happening.

**Visible result:** on colliding universes the router holds the last frame for up
to 2 s (`universe_router.js:22`, `universe_frame_buffer.js:75`) while
non-colliding universes keep animating — the ship shows fixtures frozen at
different points of different fades. That reads as "random colours".

**The project already knows loopback is not a black hole.** The timeline e2e
harness solves it correctly and says why:
`tests/e2e/timeline_e2e_harness.mjs:21-24` uses TEST-NET-1 `192.0.2.9` and notes
*"a LOOPBACK dest is NOT a black hole, because the sim's sACN receiver binds every
local interface and would relay the frames onward"*, asserting on the way up that
every `[sACN Out] Sender started` line names only the black hole (`:399-401`).
That wall exists in exactly one harness. The global guard — the one that covers
the other 88 files — does not have it.

**Also unwalled:** the same scratch config leaves `server.port: 6968`, and
`.agent/os/multi_agent.md:214-220` tells agents to isolate an engine with
`node engine.js --port 31068` — which moves HTTP only. The per-slot port table
(`multi_agent.md:204-212`) has **no sACN column at all**, so an agent following
the documented procedure to the letter still transmits into the live show.

**Next step:** give the global test guard the same output wall the e2e harness
already proves, and add sACN destination isolation to the multi-agent slot table.
→ `marsin_engine_expert.md`, with a doc follow-up on `.agent/os/multi_agent.md`.

---

### MAJOR 1 — the pattern VM is handed un-zeroed heap every frame

**`marsin_engine/lib/wasm_host.js:171-179`.** `renderAll6ch` does
`Module._malloc(outBuf6chSize)` fresh **per channel per frame**, passes it to
`_renderAllWithMeta6ch` without clearing, `.slice()`s the result, and writes it
into the caller's buffer with `outBuffer.set(result)` (`:179`).

The mixer *does* clear correctly — `pattern_mixer.js:3545-3548` zeroes every
composite each frame, and `:3634/:3654/:3680/:3696/:3746/:3805/:3914/:3978` clear
`channelBuffer` before each render. **But `set()` is the last writer**, so the
mixer's zeroes are overwritten by the malloc'd block. With emscripten's dlmalloc,
a fresh allocation of a repeatedly-freed same-size block returns **the previous
frame's rendered pixels for that channel**.

This is only latent if the VM writes every pixel unconditionally — and the red
team measured that it does not:

- **`_112` F9 (P2):** *"Blowing the per-pixel budget renders the whole rig solid
  red, silently... The real budget is ~300 trivial loop iterations, not the '5000'
  a text model reads as generous."*
- **`_112` F2 (P0):** `beforeRender` shares that budget and **truncates
  mid-execution, silently** — so the house palette resolve never runs.

A *partial* overrun — some pixels rendered, the rest skipped — is exactly the
case that (a) leaves skipped slots holding heap residue and (b) **trips no
detector**: `pattern_mixer.js:876` only flags a composite that is *uniformly*
`(255,0,0)` or *uniformly* black. Partial corruption has no engine-side signal at
all, which is why this can run for weeks as "every now and then I see random
colours".

**Why it would correlate with agent activity:** budget overruns are
data-dependent, and the residue that surfaces depends on what else is allocating.
A busier box and more channel churn make both more likely.

**Caveat, stated honestly:** only the prebuilt WASM is vendored
(`marsin_pb/wasm/marsin-engine.{cjs,wasm}`) — there is no C source in-repo, so
whether the VM always writes all `pixelCount*6` bytes is **not verifiable from
this repo**. The JS contract deliberately hands it uninitialized memory, so the
guarantee rests entirely inside the black box. That is the finding: the JS side
should not be relying on an unverifiable promise for show-critical output.

Same pattern applies to the blend scratch, `wasm_host.js:301-303` → `:287`.

**Next step:** clear the block before the VM call (or hoist and clear it once).
→ `marsin_engine_expert.md`.

---

### MAJOR 2 — a corrupt state file is indistinguishable from a missing one

**`marsin_engine/lib/state_manager.js:150-160`** — `load()` catches any parse
error, `console.warn`s, and returns `defaultState`. This is the substrate under
`loadMixerState` (`:261`), `loadDeckState` (`:276`), `loadSettingsState` (`:302`)
and `loadGlobalsState` (`:320`). A corrupt `globals_state.yaml` silently reverts
every shared param, dimmer and effect to code defaults — **wrong colours across
the whole rig, on a restart, with nothing but one warn line**.

This is a direct fallback-behaviour violation (codex P0) and it sits precisely on
the "I restarted the engine and the colours were wrong" path. Writes into
`states/**` *are* atomic (`state_manager.js:217-244`, temp + fsync + rename), so
the engine cannot corrupt its own file — but a crash-during-write from an older
build, a disk event, or a hand-edit all land here silently.

**Next step:** distinguish absent (defaults, fine) from unparseable (refuse
loudly). → `marsin_engine_expert.md`.

---

### MINOR 1 — two genuinely non-atomic writes that are re-read at runtime

- **`marsin_engine/lib/playlist_manager.js:293`** — `fs.writeFileSync` truncate+write
  of a playlist YAML that **is** re-read on live paths (`tryLoad`, `:213-223`,
  reached from `api_server.js:7811`). A `POST /playlists` racing a concurrent
  `tryLoad` yields a `PlaylistLoadError` → degrade to `null` → entry defaults are
  not applied → **wrong colours, `console.warn` only**.
- **`marsin_engine/api_server.js:7794`** — truncate+write of a pattern `.js` that
  `loadPattern` (`:592-598`) may re-read. A torn read fails to compile rather than
  producing garbage, so this one is loud enough.

Narrow windows, but they are the only real torn-read exposure in the engine.

### MINOR 2 — `PacketOutOfOrder` is never observed

`simulation/server/sacn_bridge.js` registers `receiver.on('error')` (`:1463`) and
`receiver.on('packet')` (`:1500`) but never `PacketOutOfOrder`. Any silent frame
loss — from BLOCKER 1 or from a genuinely lossy network on the playa — is
invisible to the monitor panel. A counter here would have made BLOCKER 1
self-diagnosing.

---

## 3. Exonerated — measured, not assumed

Negative results matter as much as the positives; these are the hypotheses the
task named that I can rule out.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Browser/WebGL rendering invents colours | **NO** | `sacn_input_source.js:465-480` decodes 515 bytes with fixed offsets; `universe_router.js:126-150` is priority-locked single-source; `universe_frame_buffer.js:68-77` swap is copy-then-clear with explicit hold-last-frame. JS is single-threaded, so `_read.set()` cannot tear against a fixture read. No stage can synthesise a value. |
| sACN sender emits frames before first render | **NO** | `sacnOut.start()` (`engine.js:1710`) only flips a boolean; `sacn_output.js:123` hard-guards `if (!_started) return`, and the only `sendFrame` caller is inside `tick()` (`engine.js:1231`). Render loop starts at `engine.js:2103`. |
| State restore races the render loop on boot | **NO** | `startApiServer` is a plain synchronous function (`api_server.js:979`) with the restore block at its top level (`:3399-3492`); it completes at `engine.js:1839`, before `loop.start()` at `:2103`. |
| Pattern swap / recompile renders a half-built handle | **NO** | Every compile path installs the handle then calls `beginFrame(handle, 0)` synchronously (`api_server.js:1042-1046`, `:1060`); deck swaps park the new handle at `fader = 0` (`pattern_mixer.js:2762-2804`) and the composite guard requires `fader > 0.001` (`:3803`). `tick()` is synchronous (`engine.js:868-958`) so no handler can interleave. |
| Model hot-reload renders a torn model | **NO** | The apply block (`engine.js:2004-2044`) is fully synchronous — the only `await` is `loadModel` *before* any mutation — so the 40 Hz `setInterval` tick cannot preempt it. Pixel-count changes are refused outright (`:1977-1989`). **Also not the trigger here:** `models/titanic*.js` last changed 2026-08-22 20:04 and are clean in git. |
| A half-written state YAML is parsed mid-flight | **NO** | Every writer into `states/**` is temp+rename, StateManager adding fsync (`state_manager.js:217-244`; `snapshot_manager.js:124`, `param_preset_manager.js:149`, `timeline_state.js:336`, `scheduled_tasks.js:204`). See MINOR 1 for the two exceptions, both outside `states/**`. |
| A pattern-file edit hot-reloads into the running engine | **NO** | There is **no watcher on `marsin_engine/patterns/`**. The only `fs.watch` in the engine is on `models/` (`engine.js:1945`). Pattern code changes only via explicit `POST /save-pattern`, which recompiles from the in-memory buffer, not a disk re-read (`api_server.js:7803-7806`). |
| Buffers reused across models of different pixel counts | **NO** | `pixelCount` is assigned once (`pattern_mixer.js:299`, `wasm_host.js:68`); cross-scene model change is a full process restart (`engine.js:3026-3031`). |
| Engine restart leaves two overlapping senders | **NO** (from the launcher) | Scene switch tears down outputs inside `shutdown()` before writing the handoff and exiting 75 (`engine.js:3060-3081`); the socket dies with the process. **The overlap in BLOCKER 1 is a *second, concurrent* engine, not a restart.** |
| Priority / source flapping on the operator's stream | **NO** | 60 s tap: every universe at priority **150**, 38.6 frames/s, **0 zeros, 0 gaps, 0 priority changes** (`~/tmp/random_color_glitch/tap_run3.log`). |

**Also worth naming:** the show is currently running **autopilot-driven**
(`timelineState: controller "autopilot"`, party window open, deck swaps ~11/min,
`colorAutopilot` events ~98/min). Some colour changes the operator did not
initiate are the system working as designed. The capture procedure below
distinguishes the two, because a designed palette move appears in the correlation
timeline as a `colorAutopilot` / `deckSwap` event and a corruption does not.

---

## 4. Measurements

Live stack, `feat/bm_readiness`, titanic scene, autopilot running.

| Metric | Value |
|---|---|
| sACN frames into the sim, total | **1468 /s** across ~40 universes |
| Per universe | **38.6 /s**, priority **150**, source `MarsinEngine` |
| All-zero frames / inter-frame gaps >200 ms / priority changes | **0 / 0 / 0** (60 s) |
| Engine render loop | 39–40 fps, `renderHealth.ok = true`, `darkness.tripped = false` |
| Concurrent bridge clients during observation | 2 (operator's sim + my tap) |
| Baseline false-positive rate of the capture tool at `--jump 150` | **0 hits / 25 s** |
| Same tool at `--jump 60` | fires on every ordinary crossfade — too sensitive |
| Capture size | ~21.7 MB JSON + ~450 KB decoded text per 20 s window |

**No anomaly occurred during observation.** Everything above is a clean baseline —
which is itself useful: it is the shape the data has when nothing is wrong, and
BLOCKER 1 predicts this stays clean until an agent runs the engine test suite.

---

## 5. Capture procedure — run this when it happens again

Tool: **`C:\Users\Titanic's End\tmp\sim_color_anomaly\color_anomaly_capture.cjs`**
(read-only; binds nothing; validated against the live stack).

```bash
cd "C:/Users/Titanic's End/tmp/sim_color_anomaly"
node color_anomaly_capture.cjs --window 30
```

Leave it running in a spare terminal while using the sim. **The moment you see a
wrong colour, press ENTER.** It writes the previous 30 s to `captures/`:

- `<stamp>_operator_mark.txt` — correlation timeline (pattern changes, deck swaps,
  colour-autopilot moves, bridge source/priority logs, engine restarts) plus every
  universe's first 8 fixtures decoded as `R/G/B/W/A/UV` every 250 ms.
- `<stamp>_operator_mark.json` — the raw base64 DMX for byte-exact re-analysis.

It also auto-dumps, unprompted, on: a single-frame jump above `--jump` (default
150, calibrated to zero false positives on this rig), an all-zero frame, the
**solid-red signature** (the VM over-budget tell from `_112` F9), a frame gap
>200 ms, a priority change, a `renderHealth.ok` transition, and an
**engine restart** — detected unambiguously by `/status.renderHealth.frame`
going *backwards*.

**How to read the result — this is the whole point:**

- **The wrong colour IS in the decoded bytes** → the sim rendered faithfully; the
  fault is upstream in the engine/VM. Check the timeline for a nearby
  `colorAutopilot`/`deckSwap` (designed) versus nothing at all (corruption →
  MAJOR 1).
- **The wrong colour is NOT in the bytes** → the fault is in the browser render
  path, and every conclusion in §3 needs revisiting.

**To test BLOCKER 1 deliberately** (do this only with the operator watching, and
expect the symptom): start the capture, then run `npm test` in `marsin_engine/`
from any checkout on this box. If the sim goes patchy while the suite runs, that
is the confirmation — and the fix is the e2e harness's black hole, applied to the
global guard.

**Two caveats, stated rather than buried:**

1. Connecting to `:6971` bumps the bridge's client census, so the sim shows a
   transient "2 sim windows connected — hardware output contention risk" banner.
   The tap never sends `setScene`, so it adds no relay route and cannot change
   what any controller receives.
2. A 30 s window is ~22 MB per dump and auto-dumps are rate-limited to one per
   15 s. Clear `captures/` between sessions.

Supporting probe, safe to re-run any time (no engine, no sockets) — prints the
sACN block the test suite hands every spawned engine, which is the BLOCKER 1
evidence:

```bash
cd "C:/Users/Titanic's End/workspace/BM26-Titanic/marsin_engine"
node --import ./tests/helpers/setup_config_guard.mjs \
     "C:/Users/Titanic's End/tmp/sim_color_anomaly/guard_config_probe.mjs"
```

---

## 6. Coverage gaps — what I could not determine

- **I never caught the anomaly in the act.** Everything above is a mechanism
  proven in code plus a clean baseline, not a captured instance. The capture
  procedure exists because that gap can only be closed by the operator.
- **The WASM VM is a black box.** No C source is vendored, so whether
  `marsin_render_all_with_meta_6ch` writes every pixel unconditionally is
  unverifiable here. MAJOR 1's severity hinges on that and I cannot settle it.
- **Hardware occurrence is unconfirmed.** The operator watches only a bench-mirror
  slice. BLOCKER 1 would hit hardware too — the bridge relays what it accepts, so
  dropped frames mean stale frames on the controllers as well. Untested.
- **I did not reproduce BLOCKER 1 by running the test suite**, deliberately: that
  would have injected sACN into the operator's live show, which is the very
  hazard being reported. The config is proven; the effect is inferred from the
  vendored receiver's code.
- **No long-duration soak.** Observation totalled ~2.5 minutes across three taps.
  A multi-hour recording would establish the anomaly's actual rate.

---

## 7. Recommended handoffs

| # | Finding | To |
|---|---|---|
| BLOCKER 1 | Test-suite sACN escapes into the live stack; multi-agent slot table lacks sACN isolation | `marsin_engine_expert.md` (guard), then a doc pass on `.agent/os/multi_agent.md` |
| MAJOR 1 | Un-zeroed `_malloc` handed to the VM on the hot path | `marsin_engine_expert.md` |
| MAJOR 2 | Corrupt state file silently substitutes defaults (codex P0 fallback violation) | `marsin_engine_expert.md` |
| MINOR 1 | Non-atomic playlist write re-read at runtime | `marsin_engine_expert.md`, low priority |
| MINOR 2 | `PacketOutOfOrder` unobserved in the bridge | `simulation_expert.md` — a counter on the monitor panel would make BLOCKER 1 self-diagnosing, and would also surface genuine packet loss on the playa |

BLOCKER 1 is cheap to fix, is provably the thing the operator described, and
costs nothing at show time. It should go first.

---

## 8. Out of scope (intentional)

- The two sub-agents surfaced three further engine findings I did not chase
  because they cannot produce *random colours*: a stale DMX-channel latch after a
  model re-patch, a shutdown blackout that misses DMX-only fixtures (fogger/horn
  can latch **on** — a safety issue worth its own look), and detach-prone cached
  HEAP views if WASM memory ever grows. Named here so they are not lost.
- Colour-autopilot / bike-link / party palette behaviour was not audited as a
  *bug*. It generates operator-unrequested colour changes by design, and the
  capture procedure distinguishes designed moves from corruption.
- GPU/render performance (report `_15` covers multi-window contention).
- No git operations were performed, per the brief.

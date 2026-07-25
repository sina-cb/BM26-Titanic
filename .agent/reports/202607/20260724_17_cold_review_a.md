# 2026-07-24 — Cold Review A: freeze/flicker diagnosis (independent, from scratch)

Cold reviewer A. Firewall honored: everything in §§1–6 was concluded and
drafted **before** reading `20260724_15` or the tracker's flicker sections;
§7 is the post-hoc cross-check. No git mutations, no source edits, no
operator processes touched. My probes: `~/tmp/coldA_*.cjs` (engine-cadence
sampler, bridge WS tap, headless+headed readonly sim pages, system
timer-jitter, network probes). Disclosure: my WS tap briefly raised the
bridge client census (banner may have flashed in operator windows), and one
800×600 readonly Chromium window sat bottom-right for 45 s (closed itself).

---

## 1. Live system as found (17:00–17:20)

- Stack up via `node launcher.js prod --scene test_bench` since 16:56:54
  (sim start.js + save-server + sacn_bridge + sacn_output_bridge +
  http-server :6969; engine `--model test_bench --pattern
  00_golden_hour_wash`; audio companion :6966). CaptainPad static serve
  :6967 (13:58). `prod` auto-opens TWO tabs: sim (test_bench, `profile=edit`,
  `lighting_mode=sacn_in`, `spotlights=0`) and the Audio Companion
  (launcher.js:102-121, 678-709).
- ONE Chrome window (pid 44940), active tab = "Audio Companion" → the sim
  tabs were **background tabs** during my whole measurement window. A
  renderer created 16:52:25 (pre-launcher, pid 19156) is still alive and
  burning ~15 % of a core while hidden — consistent with an extra sim tab
  from before the launch (operator: "the sim is in titanic").
- Engine `/status`: `outputRouting: Titanic-202 → 10.x.x.202 U10+U12`
  (engine writes that hardware **directly**, prio 100, plus `alsoFlat`
  loopback to 127.0.0.1 for the bridge).
- Machine: 32 logical cores, RTX 4090 Laptop GPU, **Wi-Fi-only**
  (Intel AX211, 10.x.x.226). Gateway ping 15/15, 1–4 ms. Bench controllers
  answered nothing at probe time (HTTP timeout on .202, refused on .10 —
  ICMP is expected-dead on MarsinLED; hardware likely powered down
  post-test, so receiver-side counters were unreadable).
- At 17:01–17:04 **zero** WS clients were attached to either bridge
  (netstat, twice); at 17:05 the bridge census said 2 (my tap + one unknown
  — reviewer B or a reconnecting tab). Background-tab throttling of the sim
  tabs is the parsimonious reading.

## 2. Measurements (all clean — this is the point)

| Probe | Window | Result |
|---|---|---|
| Engine frame cadence via `/status` (250 ms sampling, ×3 runs) | 17:03, 17:18 | p50 39.8 fps, worst 250 ms window 35.6 fps (9-vs-10 frame quantization), **0 windows <30 fps**, RTT <2 ms |
| Bridge WS broadcast tap (:6971, 45 s) | 17:05 | 7 052 binary frames ≈ 160/s = 40 fps × 4 universes; inter-frame gaps p99 27 ms, **max 38 ms, zero >100 ms** |
| Fresh sim page, operator's exact URL + `readonly=1`, headless/SwiftShader, 40 s | 17:08 | 23.5 fps but **perfectly even** (gap p50 43 ms, max 53 ms); **0 stalls >100 ms, 0 longtasks** |
| Same page HEADED on the real GPU (visible 800×600 window), 45 s | 17:15 | **59.9 fps, max gap 36.8 ms, 0 stalls** (ANGLE → RTX 4090 D3D11) |
| System timer jitter (10 ms tick, 90 s, ×2 — idle and during the headed run) | 17:10, 17:15 | max 31.8 ms / 13.2 ms, **zero >100 ms** — no OS/DPC stall present |
| Engine cadence DURING the headed GPU run | 17:18 | unchanged, clean |

So with the operator's sim tabs backgrounded: engine, bridge relay, wire,
a fresh rendering page, the GPU, and the OS scheduler are ALL metronome-
clean, simultaneously. Whatever freezes is **created in the operator's
focused Chrome session, and it is exported to the hardware by design**.

## 3. The mechanism (ranked)

### H1 (primary, high confidence): the browser tab is a focus-gated,
### priority-150 sACN hardware writer

`simulation/src/core/animate.js:543-590`: in `sacn_in` mode, **inside the
rAF render loop**, the page sends every patched par/DMX universe to its
`controllerIp` at **priority 150** (line 576) via the :6972 output bridge
("BM26-Simulation"). Test_bench patches put U1/U2 → 10.x.x.10, so the par
gateway has **two concurrent sACN sources** whenever a test_bench tab is
rendering:

- bridge hardware relay, "MarsinRelay Engine", prio 100, server-side,
  measured rock-steady 40 fps;
- the focused tab, prio 150, cadence = **whatever Chrome's rAF for that tab
  does** — 60 fps focused, jittery under contention, 0 when hidden/occluded.

`simulation/main.js:928-956` documents this coupling explicitly (silent-
audio keep-alive hack; TODO: "decouple the sACN output relay from the
browser render loop entirely"). Chrome tab focus is literally the on/off
switch of the second writer. Consequences:

- **Focused** → prio-150 stream wins (or interleaves, on gateways that
  ignore priority) → every hiccup of the operator's tab is replayed on the
  physical lights; on last-write-wins gateways the mere interleave of two
  time-shifted copies of the same animation reads as "flickering like
  hell".
- **Unfocused/occluded** → rAF stops → writer #2 vanishes → the clean
  server-side relay is the sole source → "the freeze is fixed".
- **The moment of blur** → the prio-150 source goes silent mid-stream; an
  E1.31 receiver holds last-look until its source-loss timeout (~2.5 s)
  before falling back to the prio-100 relay → the operator's "small freeze
  when I move away" is the writer HANDOFF, not a new fault.

LED universes are *not* page-relayed (strands live in `params.ledStrands`,
the loop reads `params.parLights`), and the bridge's relay of U10/12 →
10.x.x.202 is suppressed by the engine-ownership rule — so the LED bench
now has a single writer (engine direct) and the dual-writer symptom
concentrates on the DMX gateway path + the viewport.

### H2 (the residual raw-jank source, medium confidence): the operator's
### Chrome *instance* stalls as a whole under full test-time load

The ~1 s freezes and obs #10 ("the audio even has that freeze") cannot come
from sim-page JS: a fresh page is stall-free headless AND headed-on-GPU,
with zero longtasks, and the OS timers are clean. A stall that reaches
audio playback must live at Chrome-instance level (GPU process /
compositor / audio pipeline back-pressure) or system level **under the
combined load present while he tests** — his 4½-h-old session, ≥2 sim tabs
+ companion, hybrid-GPU laptop, plus heavyweight co-residents (Fusion 360
has burned ~11 CPU-hours; multiple agent processes). I could not reproduce
it because that exact load state wasn't present while I measured. H1 turns
this residual jank from a cosmetic problem into a hardware problem; kill
writer #2 and H2 degrades to "viewport-only annoyance to profile at
leisure".

Rejected with evidence: engine time-loop fault (3× clean cadence, wire-rate
proof); bridge broadcast/relay fault (tap clean); sim render-loop JS fault
(fresh-page probes); OS-wide DPC storm at measurement time (timer probes);
Wi-Fi link degradation to the gateway (0 % loss, ≤4 ms — though the bench
path itself was unverifiable with the controllers dark).

## 4. Observations 1–10 vs mechanism

| # | Observation | Explained by |
|---|---|---|
| 1 | launched via `launcher.js prod` | prod auto-opens the sim tab in `sacn_in` → writer #2 armed (H1); companion tab opened too |
| 2 | viewport "2 s ok, freeze, freeze" while focused | H2 raw jank in his instance; period is instance-specific. (Cross-check §7: the boot pattern itself has a ~2 s content swell — perceptual confound) |
| 3 | freeze/flicker in the actual light data | H1: prio-150 tab stream vs prio-100 relay on 10.x.x.10 (and, earlier today pre-fix, engine-direct + bridge relay dual-source on 10.x.x.202) |
| 4 | focused = flicker, unfocused = fixed | H1, deterministic: rAF gates writer #2; unfocused/occluded tab stops writing, clean relay remains |
| 5 | titanic `2d_pixels`+webgpu window "looks good" | headless profile skips ALL per-frame GPU 3D work (`animate.js:267-285`); titanic patches declare zero controller IPs → that window is neither GPU-heavy nor a writer |
| 6 | "not there before our changes today" | activation, not regression: today's workflow ran multiple sim windows + the engine `controllers:` direct path on the live bench; single-window habits never armed two writers at once |
| 7 | "contention or sth" / "2 chrome connections" / "engine time loop" | contention: right, but it's *writer* contention + instance load, not GPU alone; 2 connections: right direction (census machinery proves >1 client); engine time loop: measured clean, ruled out |
| 8 | "test bench shows a pattern, sim is in titanic — 2 things running" | literally the topology: engine drives the bench regardless of browsers; the extra (titanic) sim tab is a second live client; when a test_bench tab renders it is additionally a second *writer* |
| 9 | small freeze at the moment of leaving the sim tab | H1 handoff: prio-150 source vanishes → receiver holds last-look for its ~2.5 s source-loss timeout → relay resumes |
| 10 | "the audio even has that freeze" | H2: the stall reaches beyond one renderer — Chrome-instance/system-level under full test load. Not explainable by H1; the single strongest pointer that residual profiling must target his instance, not the sim page |

## 5. Minimal fix proposal (not implemented)

1. **Tonight, zero-risk:** make the prod sim tab a pure viewer — add
   `readonly: 1` to the `prod` profile's `simParams` in `launcher.js`
   (`window.__readonlyMode`, main.js:261, already skips the entire
   animate.js output block). One line; instantly removes writer #2, the
   focus coupling, and the blur-handoff freeze. Known cost: that tab's
   per-fixture Off/Brightness overrides stop reaching hardware (engine
   `/global-blackout` still works).
2. **Real fix:** engine becomes the only hardware writer and operator
   overrides move server-side; the `animate.js:543-590` relay branch dies
   in `sacn_in` mode. (Post-hoc note: this is exactly decision #12 option
   (ii) / design `20260724_19` Phase 1 — my independent analysis endorses
   (ii) and specifically argues against (i), which would keep hardware
   cadence chained to Chrome tab focus.)
3. **Keep** the census banner; never leave extra sim windows open while
   hardware is watched (already codified in `os/multi_agent.md` §9).
4. **Residual H2 profiling (2 min, operator present):** while he reproduces
   the focused flicker, run `coldA_timer_jitter.cjs` + the engine-cadence
   sampler concurrently and capture one DevTools performance trace in HIS
   Chrome. Decision tree: timer jitter clean + audio stutters → stall is
   inside Chrome (GPU process/audio pipeline; check `about:gpu`, hybrid-GPU
   selection); timer jitter spikes → system-level (co-resident load,
   Wi-Fi/BT coexistence if the music is on Bluetooth — the AX211 is a
   combo Wi-Fi+BT radio carrying all sACN too).

## 6. Confidence

- H1 as the mechanism binding observations 1, 3, 4, 5, 8, 9: **high** —
  every link is either code-anchored (file:line) or measured.
- H2 as "instance/system-level, not sim-page JS": **high** on the
  exclusion, **medium** on naming the exact trigger (not reproducible in
  the post-test lull; needs the 2-minute operator-present capture).

---

## 7. Cross-check vs the prior investigation (read AFTER §§1–6)

Read post-hoc: `20260724_15_sim_flicker_debug.md`, tracker flicker
sections, and the related landed items (`_19` design study, `_20` priority
hardening).

**Agree (independently converged):**
- Writer #2 (`animate.js:543-590`, prio 150 via :6972) as the leading
  live mechanism — their §2.3 "still OPEN" is my H1. The NEW focus
  observations (#4/#9, which arrived after their report) are effectively
  the operator running their staged A/B by accident: focus = writer-2 ON =
  flicker; blur = writer-2 OFF = clean. I consider their hypothesis now
  **confirmed at the behavioral level** (still unverified by receiver
  counters — controllers were offline for both of us).
- Engine exonerated (their 39 Hz wire taps ≙ my cadence + tap numbers).
- Viewport jank is not sim JS (their zero-longtask stalls ≙ my clean
  fresh-page probes); it is contention-state-dependent/bistable.
- Route-flap + engine/bridge dual-source root causes and today's fix: I
  found the fixed code in place and the wire clean; nothing contradicts.
- Their §7.2 note that `00_golden_hour_wash` has a ~1.99 s content swell is
  a valuable perceptual confound for the exact "2 s okay" phrasing — I had
  no equivalent measurement; worth keeping in mind before chasing a 2 s
  clock.

**Disagree / nuance:**
- Their §2.3 recommended option (i) (bridge stands down while a browser
  drives). The focus observations argue the other way: (i) makes the
  *browser* the primary writer whenever a tab is open — hardware stays
  chained to tab focus and every blur becomes a handoff freeze. `_19`
  later reached the same verdict (option (ii)); I concur with (ii) and
  add the `readonly=1` launcher line as a zero-code interim (their report
  treats overrides as blocking any interim kill; readonly is an explicit,
  reversible operator trade the report didn't surface).

**What they missed (new in this review):**
- The E1.31 source-loss-timeout handoff as the concrete mechanism of the
  blur-moment freeze (obs #9 — postdates their report).
- Obs #10 (audio) — evidence the residual jank is Chrome-instance/system
  wide, which narrows their "GPU/present starvation" further: profiling
  must target the operator's instance (GPU process / audio pipeline /
  co-resident load), not more sim-page probes.
- `prod` opens the sim in `profile=edit` where `mappingEnabled:false`
  strips most viewport feedback anyway — yet the tab still writes hardware
  (the relay branch ignores profile in `sacn_in` mode). Strengthens the
  case that the prod tab has no business being a writer.
- Current live state facts: sim tabs backgrounded → zero bridge WS clients
  for minutes at a time (so the "prod stack" currently delivers hardware
  data purely via the server-side relay — i.e., the system already runs
  fine in exactly the topology option (ii) would make permanent).

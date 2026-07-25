# 2026-07-24 — Cold Review B: freeze/flicker diagnosis (independent)

Cold reviewer B. Written **before** reading `20260724_15_sim_flicker_debug.md`
(bias firewall); the cross-check section at the end was added after.
No git mutations, no source edits, no operator processes touched. Probes:
`~/tmp/coldB_engine_cadence.ps1`, `~/tmp/coldB_ws_probe.cjs`,
`~/tmp/coldB_stall_probe.cjs` (one 30 s WS probe raised the bridge client
census by 1 — disclosed below).

## 0. TL;DR

The engine and the entire server-side data path are **measured clean**. The
freeze/flicker is produced at the two unmeasured edges:

1. **Hardware edge (root architectural defect):** in `lighting_mode=sacn_in`
   the sim page is itself a **priority-150 sACN writer to the physical
   controllers, clocked by Chrome's requestAnimationFrame**
   (`simulation/src/core/animate.js:543-590` → `sacn_output_client.js` →
   `sacn_output_bridge.js` → unicast). The bridge relay already delivers the
   same universes at priority 100. E1.31 receivers obey the higher priority,
   so **whenever the sim tab renders, the lights are enslaved to Chrome's
   presentation health**; every browser hiccup is a light freeze, and when
   the tab stops rendering the controller holds the last prio-150 frame for
   the E1.31 source-loss timeout (~2.5 s) before falling back to the steady
   prio-100 engine stream. Two sim windows = two equal-prio-150 writers
   interleaving (2 clients were measured connected at 17:11).
2. **Screen edge:** the browser presentation layer hitches under **GPU
   contention that is mostly external to the stack** (measured: GPU 3D engine
   at ~80% from non-Chrome processes — agent tooling, IDE, CAD, DWM up to
   48% — while Chrome 3D sat at 0-8%), compounded today by the new
   multi-window workflow (2D-pixels multiview / split screen). The feed into
   the browser is flawless, so what the operator sees flickering is the
   tab's *rendering*, not the data.

The fix is one guard: **the sim must not re-send to hardware what the bridge
already relays** (details §5).

## 1. What was measured (all during live operator testing, 17:05-17:20)

| Probe | Window | Result |
|---|---|---|
| Engine frame counter via `/status` @5 Hz | 40 s | **39.2 fps avg, min 35.2, 0 windows <30 fps**; /status latency 6-34 ms |
| WS client on in-bridge :6971 (census +1, 30 s, disclosed) | 30 s | U1,U2,U10,U12 each **1178 frames = 39.3 fps, maxGap 41 ms, zero gaps >100 ms**, single source `'MarsinEngine'` **priority 100 only**; no OVERRIDE/ACTIVE arbitration events; census showed **2 other clients already connected** |
| Machine-wide stall probe (25 ms event-loop ticks + engine @1 Hz + TCP RTT to controllers @0.5 Hz) | 180 s | **Zero event-loop gaps >100 ms, zero engine anomalies**; `10.x.x.10` and `10.x.x.202` **TCP :80 connect timeout 89/89 each** (bench hardware unreachable right now) |
| GPU engine counters (~1 Hz, 25 samples) | 100 s | total 3D **up to 83.9% with Chrome ≈0%** in long stretches; attribution: claude-agent pid 29%, DWM 20-48%, Chrome 0-8% |
| Per-process CPU (10-20 s windows) | — | system 43% of 32 threads; engine 7.8% of one core; top consumers: Antigravity IDE 92%, claude agents ~130% combined |
| Process/port census | — | Exactly ONE stack (launcher 43408, engine 4748 `test_bench`, bridges 46156/43200); post-fix bridge code (mtime 16:48) **is** what's running (started 16:56); no second engine |

Refuted by these measurements:

- **Engine time-loop trouble** (operator speculation, obs 7): engine held
  40 fps ±10% across 220 s of sampling, including while flicker was reported.
- **Bridge arbitration flapping / dual sACN source into the sim**: one
  source, prio 100, no override events, gap-free delivery. The morning's
  route-union + engine-owned-suppression fix (in `sacn_bridge.js`,
  `bridge_routing.cjs`, engine `outputRouting`) is live and doing its job.
- **Machine-wide periodic stall** (relevant to "audio has that freeze" if
  that meant speaker audio): no normal-priority process on this box stalled
  for >100 ms in 3 min. If speaker audio truly glitches, only a DPC/driver
  capture (admin) could catch it; every Chrome-page meter (audio companion
  page, CaptainPad) freezing **together** is instead exactly what GPU-process
  contention does — all Chrome windows composite through one GPU process.
- **"2 chrome connections"** (obs 7): the four engine/bridge connections from
  Chrome (in-bridge, out-bridge, engine WS, audio page) are the normal shape
  of ONE sim page + companion page.

## 2. The mechanism, end to end

Data path (prod, scene `test_bench`):

```
engine (40 fps, prio 100) ──UDP 5568──► in-bridge ──WS :6971──► sim viewport
        │                                   │
        │ direct unicast U10/12 → .202      │ relay U1/2 → 10.x.x.10  (prio 100)
        ▼                                   ▼ (U10/12 relay suppressed — engine-owned)
   LED controller                      DMX controller
        ▲                                   ▲
        └────── sim page rAF loop ──WS :6972──► out-bridge — **prio 150**, all
                (animate.js:543-590)            patched universes, every rAF tick
```

`animate.js:569-576`: in `sacn_in` mode the page relays **ALL** universes to
controllers at `priority: 150` ("simulation acts as bridge") on every
rendered frame. This block predates today (last commit 2026-07-15) — it is
the **third** writer beside the engine and the bridge relay.

Consequences, mapped to raw observations:

| # | Observation | Explained by |
|---|---|---|
| 1 | launched via `node launcher.js prod --scene test_bench` | Neutral. Launcher/stack healthy; prod opens the sacn_in sim URL, which **arms** the prio-150 writer |
| 2 | sim viewport "flickering like hell", "~2 s ok, 1 freeze…" | Screen edge: tab rendering hitches under GPU contention (external load measured ~80%; second sim window when open). Feed into the tab measured gap-free — flicker is not in the data |
| 3 | flicker earlier "in the actual data on the lights" | Hardware edge: prio-150 browser stream outranks the steady prio-100 relay; every tab hitch = light freeze. With TWO sim windows (measured at 17:11) two equal-150 writers interleave → hard flicker. (Pre-16:48 there was additionally the route-clobber/dual-source bug that the morning fix removed) |
| 4 | Chrome focused = flicker; unfocus → "freeze is fixed" | Both edges: unfocus/occlude/hide → tab stops or calms rendering → (a) nothing hitching to watch, (b) prio-150 stream ceases → controllers lock onto the engine's steady 40 fps relay |
| 5 | titanic `2d_pixels` webgpu window "looks good" | That profile is headless-render (skips spotlight pool + composer; 60 fps per report 20260724_1) and titanic patches have **no controller IPs** — it neither writes hardware nor carries the heavy 3D pipeline |
| 6 | "was not there before our changes today" | The *conditions* are new, not the writer: today added the multi-window 2D-multiview/split workflow (extra sim windows) and an all-day agent/IDE fleet loading the GPU; the morning route-clobber bug also masked/preceded this |
| 7 | "contention or sth", "2 chrome connections", "time loop" | Contention: **confirmed** (GPU + writer contention). 2 connections: normal (in+out bridge). Engine time loop: **refuted by measurement** |
| 8 | "test bench shows a pattern, sim is in titanic — 2 things running" | Literally true twice: engine(test_bench)+titanic window era (route-clobber, fixed), and generally engine + browser shadow-writer = two writers running together |
| 9 | "router still has a small freeze when I move away from the sim tab" | Signature of the shadow writer: tab hidden → rAF stops → prio-150 source vanishes mid-stream → controller holds last frame for the E1.31 source-loss timeout (~2.5 s) before falling back to prio-100. This small freeze is **inherent** as long as the shadow writer exists |
| 10 | "the audio even has that freeze" | If audio-reactive UI (companion page :6966 / CaptainPad meters): same GPU-process hitch freezing all Chrome windows at once. If speaker audio: NOT explained — my 180 s machine-wide probe saw zero stalls; would need a DPC/driver capture (admin) to pursue |

Caveats, stated plainly:

- The controllers were **TCP-unreachable during my entire window** (89/89
  timeouts to both) — bench likely off/absent right now, so hardware claims
  are about earlier today; nothing hardware-side could be re-measured.
- I could not observe the operator's tab internals (no debug port; attaching
  to his Chrome was out of scope) — the attribution of the on-screen rhythm
  to compositor/GC hitching under GPU load is **inference by exclusion**
  (every other hop measured clean), not a direct measurement.
- Reviewer A's probes were active on the box; some load/clients I saw may be
  theirs (e.g. the transient 3rd bridge client).

## 3. Latent hazards found on the way (not active now, worth filing)

- `sacn_bridge.js:415-459` — arbitration state (`activeSource`,
  `highPriorityActive`) is **global**, not per-universe/per-source: one
  ≥150-priority source on ANY universe gates every other universe's traffic
  to both the browsers and the hardware relay; below 150, any number of
  sources interleave with no arbitration at all. Measured inactive today
  (single source), but it is the amplifier that turns "a second writer
  exists" into "everything flickers".
- `sacn_bridge.js:410` — the Receiver binds UDP 5568 with `reuseAddr: true`;
  any other reuseAddr socket on this box could silently steal datagrams.
- `animate.js:564` skips only `0.0.0.0` — a patch with `controllerIp:
  127.0.0.1` would loop prio-150 frames straight back into the in-bridge and
  (via the global lockout) freeze every client for 10 s per burst.

## 4. Ranked conclusion

1. **Primary mechanism (high confidence):** the rAF-clocked prio-150 shadow
   writer in `sacn_in` mode couples hardware output to Chrome tab health;
   combined with GPU contention (external tooling + today's multi-window
   workflow) it yields focus-dependent flicker on screen and on the lights,
   and the ~2.5 s handover freeze on tab-away (obs 9).
2. Secondary/earlier: the pre-16:48 route-clobber (last-writer-wins scene
   routes) froze the bench from plain browser activity — already fixed today
   and verified live.
3. Not causal: engine timing, launcher, bridge delivery, machine-wide
   scheduling — all measured clean.

## 5. Minimal fix proposal (do NOT implement yet — operator holds)

1. **One guard in `animate.js` (~line 545/572):** in
   `lighting_mode=sacn_in`, do **not** send fixture universes to the output
   bridge — the in-bridge relay already owns hardware delivery at prio 100
   from the engine's steady clock. If the effects exception (fog/haze
   "ALWAYS output") is genuinely needed, keep ONLY that, at priority ≤100.
   This single change decouples the lights from browser health: obs 3, the
   hardware half of 4, and 9 disappear structurally.
2. Until merged: **one sim window** during bench tests (the new census
   banner already warns), and shed non-stack GPU load (IDE/CAD/agent
   browsers) while judging smoothness.
3. Hygiene follow-ups (Notion backlog, not now): per-(universe,source)
   arbitration in the bridge; drop `reuseAddr:true` on the Receiver; extend
   the `animate.js` loopback-IP skip list; make the 150/100 priorities named
   config, not literals.

## 6. Cross-check vs report 20260724_15 (read AFTER §0-5 were written)

**Verdict: agree on the mechanism stack — two fully independent
investigations converged on the same primary suspect** (the `animate.js`
prio-150 browser writer, their "writer #2" / §2.3) and the same exonerations
(engine wire cadence, JS long tasks, GC, instancing). Specifics:

**Where we agree (independently reproduced):**
- Engine clean at the wire: their 39 Hz taps ≡ my 39.2-39.3 fps probes
  (different tools, same number).
- Route-flap (last-writer-wins `setScene`) as the earlier bench-freeze root
  cause; I verified their fix is the code actually running and that the
  stream is now single-source prio-100, gap-free.
- Viewport freezes are GPU/present starvation, not page JS — they proved
  the stronger half directly (rAF gaps with **zero long tasks**, bistable
  with fleet load); I proved the complementary half (feed gap-free, machine
  scheduler clean, GPU 3D up to ~84% from non-Chrome processes).
- Writer #2 as the leading hardware-beat mechanism. My §5.1 ≈ their
  option (ii).

**Where they had something I missed:**
- The browser writer also carries the operator's per-fixture Off/Brightness
  overrides to hardware — it cannot be *simply deleted* (my §5.1 as written
  is too naive; the overrides must move server-side, which is exactly the
  `20260724_19` design study's option (ii)/Phase 1).
- Receiver priority is reportedly broken on these gateways — so prio 150 vs
  100 does not produce a clean takeover but **interleaving**, which makes
  the flicker worse than my priority-arbitration framing and definitively
  kills "rely on receiver priority" (their option iii). My tab-hide/E1.31
  fallback reasoning survives (one writer remaining = clean either way).
- The content itself (00_golden_hour_wash) has a measured ~2 s level cycle —
  a perceptual confound for the "~2 s okay" phrasing worth keeping in mind.

**What I add beyond report 15 (new observations arrived after it):**
- Obs 4/9 are effectively the **operator running their staged A/B by
  accident**: hiding/unfocusing the sim tab stops writer #2 and the lights
  recover after a single ~2.5 s E1.31 source-loss hold — precisely the
  writer-#2 signature their §8 said was "not yet confirmed". I consider
  their leading hypothesis now behaviorally confirmed by obs 4+9.
- The E1.31 source-loss-timeout explanation for obs 9's "small freeze when I
  move away" (not in report 15).
- Obs 10 (audio): machine-wide stall ruled out by measurement; the
  every-Chrome-window-freezes-together reading points at the shared GPU
  process; speaker-audio reading would need an admin DPC capture.
- Latent hazards not in report 15: bridge arbitration is global rather than
  per-universe (`sacn_bridge.js:415`), `reuseAddr: true` on the Receiver
  (`:410`), and `animate.js:564` not skipping `127.0.0.1` (a loopback patch
  would feed prio-150 into the in-bridge's 10 s global lockout).
- Hard datum for the next hardware session: both controllers are currently
  TCP-unreachable from this box (89/89 timeouts) — receiver-side seqErrors
  still unread, matching their §6.5 follow-up.

**Bottom line:** no disagreement on mechanism; my recommendation upgrades
from my own §5.1 to the already-studied option (ii) path (`20260724_19`,
Phase 1: overrides move into the engine, `sacn_in` tabs stop writing
hardware) — it is the only option that takes Chrome out of the hardware
write path entirely, which the focus-dependence observations (4, 9) show is
the property that matters.

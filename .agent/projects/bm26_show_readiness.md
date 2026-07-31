---
name: bm26_show_readiness
status: active
owner: Sina (lead artist) — coordinator agent acts as readiness manager
created: 2026-07-27
updated: 2026-07-30
---

# BM26 Show Readiness — Master Program

**This is the make-or-break doc.** Sina is the lead artist; the interface
agent is the readiness manager reporting to him. Goal: a **successful,
somewhat-autonomous art fixture** on playa — ambient by default, alive at
party moments, never stuck.

> **RULE (operator, 2026-07-27): this is THE master doc, and every agent
> maintains it.** Any agent that lands, parks, blocks, or reverses work
> touching a workstream below MUST update the affected row, the Open
> decisions, and the Log in the SAME session — before reporting done.
> Coordinator enforces; a completion message without the doc update is
> not done. Keep rows tight (state + next action + owner); evidence and
> detail belong in the linked reports, not here.

Sub-project dossiers link from here; this doc tracks the PROGRAM. Ops
detail per thread lives in `../memory/bm_readiness_thread_tracker.md`
(**canonical, most-current state**).

**Compacted end-of-day 2026-07-30 on operator order.** Everything removed —
the long workstream row bodies, the slice-by-slice `_58` wave narrative, the
resolved waiting items, the mapping-support wave block, the full dated Log —
moved **verbatim** to the archive report
[`../reports/202607/20260725_88_master_doc_archive.md`](../reports/202607/20260725_88_master_doc_archive.md)
(`_88`). Section pointers below name the archive section.

## Threads — what's going on right now (2026-07-30, end of day)

> Operator-requested quick-glance board. The coordinator maintains it
> on every launch/landing/ruling; one line per thread, detail in the
> Status snapshot below + the tracker + the linked reports.

**🔄 IN FLIGHT:** nothing — every agent has landed and the wave is committed.
**Ready for new threads.**

**⏸ WAITING ON YOU (full list in "Waiting on the operator" below)**

| # | Action | Why |
|---|---|---|
| 23 | **Hard-reload the sim tab** | One reload picks up the whole day: dot scale (`_74`), live halo knob (`_75`), per-fixture Halo × (`_77`), knob relabels (`_78`), sorted menus (`_80`), red gating (`_81`), the halo-pool leak fix (`_82`) |
| — | **Check the roof-edge par row's patching** | `_78` measured only 8 of 40 pars patched — you believed that row was mapped. Since `_81` they render DARK rather than red, so the gap is quiet instead of loud: it is still real and still yours to close |
| 15 · 18 · 22 | **`.60` card: expect ▲ Drift (normal), ⬆ Push ONCE** | One push re-parks output 3 off U23, completes the timed-out write's save+notify, and doubles as acceptance step 1 (`_71` §6) |
| 3 | **Titanic re-export + engine restart** | Clears the standing 8 stale-model suite failures AND the 2 operator-scene drift pins in one sim-save + reload |
| 17 · 19 | Live acceptance run (`_63` §3) · gamma W-preset veto (`_65`) | The `_58` wave is unit-proven only until 17 runs once on hardware |
| 27 | Top-Down compression margin (`_84`) | Nudge the Left Small SmokeStack generator x outward, or retune the pin — one more inward nudge tears a side of the view |

**✅ LANDED TODAY (2026-07-30):** the `_58` push/save wave S1–S5 complete in
code; port→output mapping (`_70`/`_71`); reboot-aware push timeout (`_69`);
LED gamma sliders + live curve (`_64`/`_65`); 2D edit-tab persistence
(`_66`, layout committed `b8b8bca5`); the halo family — fixture scale-up
(`_68`/`_73`), the dot-scale bug (`_74`), one global knob for every bus
(`_75`), per-fixture `Halo ×` (`_77`), the not-a-colour-bug verdict (`_78`),
the independent double-check (`_79`), red gating (`_81`) and the
60-slot SpotLight leak (`_82`); orphan badges + one-click removal (`_76`);
generator move carries its fixtures (`_83`) + Fable sanity PASS (`_84`);
tray layout (`_85`); `📡 Subscribed Universes` auto-sync (`_86`); and
**`_87` — zero restarts for mapping changes**. Security sweep `_67` cleared
the commit path; the whole wave was committed and pushed as **`3246deb2`**.
Suite ends the day at **1452/1442/10** (8 known stale-model + the compression
tripwire + operator-side scene drift — zero new all day).
Full detail: reports `_47`–`_87` and archive `_88` §1–§2.

## Status snapshot (read this first)

**Orientation for any reader:** reports live in
`../reports/202607/20260725_N_*.md` (N assigned centrally; the ledger and the
most-current campaign state are in `.agent/memory/bm_readiness_thread_tracker.md`
— that tracker is canonical, this doc is the program board). **Next free
report: `_89`.** Everything this doc used to carry in long form is in
archive `_88`; each section below names the archive section that holds its
history.

**Scheduling (operator rule, 2026-07-28):** dated deadline/schedule planning
lives ONLY in `.agent/reports_local/` — gitignored AND deploy-excluded.
Tracked docs record what and why, never when-by.

**Standing orders in force:**
- **NO deploys to titanic-ext** — operator develops locally and deploys
  himself. (Remote is one deploy ahead-and-consistent with local through
  `_26`.)
- Operator runs his own Expo/Metro on :6967 — agents never touch it;
  CaptainPad verification happens on `:7167` dist builds.
- **Controller firmware work PAUSED** (flash requires USB per unit); the HTTP
  config API is the supported path for controller settings.
- **White-pattern residual work PAUSED** ("colored patterns look good") —
  diagnosis + ready-to-go fix plans on file in `~/tmp`; resume only on an
  explicit ask. The RGBWAU→LED colour path is operator-ACCEPTED.
- **Commits are operator-gated.** The readiness wave WAS committed and pushed
  on operator order 2026-07-30 — **`3246deb2` on `feat/bm_readiness`** (441
  files, reports `_47`–`_87` included), plus a follow-up removing a stray
  0-byte tool-residue file. The tree is clean apart from the ledger files
  (this doc, the tracker, and today's reports). Next commit still needs his
  word, and a passing `python scripts/security_check.py --staged` first.
- **Operator is LIVE-MAPPING real DMX/LED controllers** (since 2026-07-29):
  all agent browser work runs readonly-guarded (no saves, no output-enable
  touches, sACN OUT socket blocked, short sessions); `simulation/scenes/**`
  and the models are operator-owned. The one exception on record is the
  operator-ordered coordinator scene fix of 2026-07-30 (Decisions log).
- **Scene configs may carry controller IPs** (operator ruling 2026-07-30):
  the security checker already tolerates them, and the redaction convention
  applies to `.agent/` prose, not scene data. `.agent/` files stay redacted
  (`10.x.x.60` style) — the `_67` sweep's convention holds.
- **Doc standing order (2026-07-30):** a doc contradicting verified
  code/hardware behavior gets fixed and cleaned up on sight
  (`.agent/memory/doc_inconsistency_standing_fix.md`).
- Some LED evidence deliberately lives OUTSIDE this public repo in `~/tmp`
  (colour/white reviews, controller debug transcripts) — an operator privacy
  rule for external-hardware detail; this doc carries only BM-side facts.

## Operator requirements (verbatim intent, 2026-07-27)

Headlines only — the full verbatim section, including the settled party
session model, is archive `_88` §4.

- Somewhat autonomous fixture; "we have a freaking strong base."
- **Party detection** must be calibrated and proven ON PLAYA; default
  operation is a preplanned program of playlists. Sustained party audio
  (~2 min) starts a ~10–15 min session. Must NOT catch music from across the
  playa. **Party only fires while a timeline plan is active and NEVER
  overrides a human operator** (human > operator disable > automation).
  Division of concerns: the companion configures DETECTION, the CaptainPad
  TIMELINE tab owns HANDLING, the engine owns the persisted `/party-config`.
  Session model shipped as specified (sustain always on; duration toggle,
  OFF = follow-the-music with the companion's `offConfirmMs` as the single
  release sustain; cooldown default 2 min, clock from session END).
- **Pattern pass:** manually test ALL patterns, tune speeds + defaults, record
  the tuned results as playlists.
- **Show program:** a couple of planned party moments; the rest ambient, with
  a party playlist triggered by detection.
- **Hardware:** test the smokestack rope LEDs; test the TE sign.

## Waiting on the operator (no agent action until he moves)

Numbers are the ORIGINALS — they are referenced across the reports, so they
are never renumbered. Resolved-and-retired items **1, 4, 16, 20, 24, 26** are
archived with their full text and a one-line verdict in `_88` §3.

2. **⟳ Restart-device button** on the LED controller cards — yes/no (`_56`;
   `rebootDevice()` is dead code today and the reboot endpoint is verified).
3. **Titanic re-export + engine restart.** One sim-save + re-export clears the
   standing 8 stale-model suite failures, the 2 operator-scene drift pins
   (`_84`'s compression tripwire, `_87`'s test_bench mapping pin) and the
   parity errors. Runbook: `.agent/ops/engine_model_refresh.md`.
4. *(resolved — `_88` §3)*
5. **TE Sign duplicate fixture names** (both groups carry `TE Sign V3 A/B`) —
   pick an option from `_52` §3. It also surfaces as the push dialog's save
   step failing during the item-17 acceptance run.
6. **Clear-All test-controller checkbox** (~3 h, design in `_50`) — go?
7. **Per-selector stale-name sweep** (~2–4 h, design in `_48` Add.2) — go?
8. **Membership editing** for 2D views (~0.5 d, design in `_54`) — go?
9. **Free-placement layout mode** for edit-mode moves (`_55` offer) — go?
10. **Migrate-addresses opt-in (11b)** y/n, and ratification of the step-11
    loud refusal on individually renaming a generated fixture (`_47`).
11. **Global Pixel Size can't reach LED strands** — fold strands in, or
    relabel the knob (`_53`; this is why it crept to 5).
12. **Top-Down bar-width narrowing (17→14)** partially walks back the `_40`
    ruling on that view — veto available (`_48` Add.4).
13. **Relay to the external WiFi/Ethernet agent:** the `.60` reports **no
    Ethernet interface at all** (`_56`) — Ethernet-only may be impossible on
    that hardware.
14. **`_58` push-save scope — SHIPPED AS OPTION A (`_61`), veto still open.**
    ⬆ Push runs the FULL scene save and the confirm dialog says so up front.
    If "saves everything dirty, not just the mapping" is unacceptable, S1 gets
    re-pointed at Option B (a scoped `/save-mapping` endpoint).
15. **(with 18 and 22) — ONE push settles all three.** The `.60`'s output 3 is
    enabled on-device at U23 (LeftFrontDeck's DMX universe — a cross-controller
    collision minted by the old auto-extender; inert but armed). Expect the
    card to read **▲ Drift** the moment you open the pane: that is the landmine
    becoming visible, not a new fault. One ⬆ Push re-parks output 3 onto a
    claims-approved free universe (nothing is disabled — output 3 stays
    enabled, subscribed and dark), completes the timed-out write's save+notify
    (`_69` fixed the 5 s abort), and is step 1 of the `_71` §6 live
    acceptance: cross P1→out2 / P2→out1 and back, GET-verify no output changed
    `enabled`, then the output-4 case and the duplicate refusal. Costs one
    ~11 s device reboot and one real scene save per push.
16. *(resolved — `_88` §3)*
17. **Live acceptance run for the WHOLE `_58` wave.** Every slice is proven by
    unit tests only until this runs once on hardware. Three tests, full
    checklist + pre-flight in **`_63` §3**: (a) change one port universe on the
    `.60` card, press ⬆ Push and nothing else — expect device✓/save✓/notify✓,
    a route transition in the bridge log, LEDs following with no manual save;
    (b) a mapping-only change + 💾 Save Configuration — LEDs follow;
    (c) with the bridge WS down, a save → red toast + red sACN-IN monitor line,
    then self-heal on reconnect. Interacts with item 15 and with the TE Sign
    duplicate-name save-abort (item 5).
18. *(merged into 15)*
19. **Gamma preset W-doctrine veto (`_65`):** the sim's `2.2 sRGB` / `Punchy`
    presets hold **W at 1.0** per docs/41 §4.1(d); the firmware's own presets
    put the exponent on W too. Test-guarded as shipped — say the word for
    firmware parity instead. Related unnumbered follow-up: a verified gamma
    push still mirrors in memory only, so save the scene once after a gamma
    push until the persist slice lands.
20. *(resolved — `_88` §3)*
21. **Left Front Deck — the two taste calls that survived `_72`'s
    cancellation.** The size half is fixed (`_74`) and the unpatched-red
    rendering is now toggle-gated (`_81`), so what remains is the **U23 feed
    level**: what the engine actually sends on that universe, not how big it
    draws.
22. *(merged into 15)*
23. **Hard-reload the sim tab** — the Threads board's top row. It is the
    "regenerate the instances" you asked for: it rebuilds the pixel map and
    every instance, no runtime cache survives it, no server restart needed.
    Check the Left Front Rails heads fill their housings (`_74`) and that
    Global Halo Size moves every bus live (`_75`).
24. *(resolved — `_88` §3)*
25. **Per-fixture `Halo ×` (`_77`) — two one-liners if you want them:**
    (a) fog/haze machines show the field but have no halo to scale — hide it
    there? (b) LED-bus halos still have NO pitch ceiling (deliberate — a
    sign's halos are meant to merge); say the word if you want one.
26. *(resolved — `_88` §3)*
27. **Top-Down compression margin (`_84`, NEW 2026-07-30).** Your Left Small
    SmokeStack x-move left the smallest Top-Down collapsed band at **5.20**
    against the 5-unit compressor threshold (the guard wants ≥ 7.5) — that is
    the 9th suite failure, and it is scene drift, not code. Nudge the
    generator's x outward, or retune the pin. One more inward nudge could tear
    a side of the Top-Down view.

Plus the older parked items: party `ambientFloor` calibration; the R2
pattern-tuning session; theme culling + the party-moment schedule; R4 hardware
tests; the 20-vs-40 px/strand test_bench question.

## Open decisions (Sina)

Numbers preserved. Settled items 1–4, 8 and 11 are archived in `_88` §6.

5. Pick a playa (or driveway) night for the ambient-vs-party baseline capture
   (threshold calibration).
6. TE sign test_bench mapping (`20260725_4`): agent applies via the live UI, or
   Sina maps it himself?
7. Scheduled party moments: how many / what times (rough is fine).
8. *(resolved 2026-07-27 by delegation — `_88` §6)*
9. Themed playlists: which of the proposed themes (`_88` §7) to adopt, and
   which nights get them.
10. UV spike: go/no-go after the on-fixture test (also confirm UV channel
    presence in the par inventory).
11. *(resolved — the orphans were deleted after `_76`; `_88` §6)*
12. **Live-derived 2D default views** (`_44` §5 Q2, third recurrence via
    `_51` §6): every group rename re-breaks the hardcoded names in
    `pixel_map_view_defaults.js`. Keep patching names, or derive the defaults
    from live groups?

## Workstreams

State + next action + owner only. **Full history for every row: archive `_88`
§5.**

| # | Workstream | State | Next action | Owner |
|---|---|---|---|---|
| R1 | **Party-mode detection + session logic** | BUILT + DEPLOYED (`_12`, `_19`); all 11 validation defects fixed and independently revalidated (`_20`→`_22`→`_23`) — sessions repeat, cooldown clocks from session END, restart-safe in every mode | Sina calibrates `ambientFloor` on playa via the companion PARTY tab capture flow. Standing rule from `_23`: use `hold`, not `durationMin`, for a moment that must not be interrupted | Sina (calibration) |
| R2 | **Pattern tuning + playlist capture**; specialty patterns (WHITE ONLY, UV spike) | PARKED for Sina's presence. Specialty patterns 60–65 sit on disk unvalidated; WHITE=AMBER lane match landed (`_26`); param-truth sweep (`_32`) measured 817 params across 125 patterns — real punch-list 73, while 137 "dead" params are dead only because titanic reports `sectionId 0` and clear when R8 lands sections | Resume the parked agent (validation → rosters) when Sina schedules the tuning session; eyeball the 7 patterns whose amber did real work | Sina (art) + parked agent |
| R3 | **Show program** — ambient default, scheduled party moments, detection-triggered party playlist, themed nights | Machinery DONE (R1 timeline); ambient/party trio deployed; themed drafts parked with R2. Proposed theme table: `_88` §7 | Sina: party-moment schedule (§Open 7) + theme culling (§Open 9); then author the week plan YAML | agent proposal → Sina curates |
| R4a | **Smokestack rope LEDs** — physical test | BLOCKED ON HARDWARE ACCESS | Sina schedules bench time; agent preps the test checklist (mapping, universes, patterns) | Sina + agent checklist |
| R4b | **TE sign** — physical test | BLOCKED ON ASSEMBLY | Same checklist treatment; test_bench mapping fix diagnosed (`20260725_4`), awaiting the §Open 6 mapping decision | Sina + agent checklist |
| R5 | **Autonomy & robustness** — boot, supervision, recovery, offline | STRONG BASE (deploy pipeline + supervisor + schtasks). Log disk-fill CLOSED (`_17`); VSN1 CRLF deploy-overflow fixed and MIDI attach state made first-class (`_31`) — the libuv abort's trigger environment is gone but the race itself is unpinned | **Sina, one git command:** `git add --renormalize .` (the 9 `.lua` templates are still CRLF in the tree). **Sina, step-11 sign-off** (`_30` §7 Q4): bounded launcher auto-restart on abort-class engine exits | Sina (renormalize + sign-off) |
| R6 | **Operator surface** — CaptainPad live-performance UI | SHIPPED and validated end to end: rounds 1+2 (`_11`), swap-wedge fix + hardening (`_14`–`_17`), surface trim + PARTY handling card (`_18`), adversarial validation and the D6 fix (`_20`/`_22`/`_23`), Studio-tab editor debug + fix (`_27`/`_28`) | Nothing agent-side. Needs his physical iPad for the Studio editor's remaining checks: smart punctuation, touch/magnifier caret drag, real keyboard geometry, felt Safari latency, one SAVE round-trip | done / Sina eyes |
| R7 | **LED strand tuning & mapping** — colour/white fidelity, controller onboarding | Colour path operator-ACCEPTED; white residual and firmware work PAUSED. Gamma is an operator control with sliders + a live curve and per-card / fleet push (`_25`/`_29`/`_64`/`_65`). The `_58` wave, `_71` port→output and `_87` no-restart subscription together make "map a universe → save → LEDs work" true with zero restarts | Waiting items **15·18·22** (one push), **17** (acceptance), **19** (gamma W veto). Open follow-ups: measure the strands' white-emitter colour temperature, reconcile the engine's LED controller host with the scene's, PSU/power-cap audit for the long RGB runs | Sina (eyes) + agents |
| R8 | **Titanic scene output mapping + bench section** | Phase A COMPLETE (`_34` sId/fId fix, `_35` parity validator, `_36` same-scene reload, `_37` bench-sync tool); chain-order splits + ⇄ Swap (`_42`) with the 3D chain visualisation (`_43`); the renumbering semantic was ratified by his own informed use 2026-07-29. **Phase B = his live mapping session, in progress since 2026-07-29** | Answer O1–O9 from `_33` §2 (especially the universe plan O3); do the one sim-save + re-export (waiting item 3); decide the deferred `_42` §6 items (esp. group-level "+ gen" bulk-add, which needs a yes against the 2026-06-11 no-group-add ruling); then Phase C = full-stack E2E + placeholder retirement | agents + Sina |
| R9 | **Sim render performance on the operator's box** | DIAGNOSED — NOT a code regression (`_38`): the sim was rendering on the Intel UHD iGPU (10 FPS) instead of the RTX 4090 (59.9 FPS). Visibility layer shipped (`_39`: adapter probe, red integrated-GPU banner, fire-once low-FPS error) with no auto-fallback; 2D Top-Down layout tweaks rode along (`_40`) | **The only thing still open:** Windows Settings → System → Display → Graphics → add `chrome.exe` → High performance → restart Chrome → confirm `chrome://gpu` shows the NVIDIA GPU ACTIVE. Avoid battery-saver while running the sim | Sina (setting) |
| R10 | **Generator editor UX** — select freeze, laggy move, name↔chain parity, rename hygiene | All three planned slices LANDED (`_45` select freeze 2,719 ms → ≤133 ms + cold move, `_46` parity surfaces + chimney-ring restore, `_47` rename hygiene = check-then-invalidate loudly), plus the mapping-pane and LED-menu ergonomics (`_50`/`_52`/`_55`), the Left Back Wall diagnosis (`_51`) and generator-move fixture sync with its Fable sanity PASS (`_83`/`_84`) | Operator gates only: waiting item 10 (migrate-addresses + step-11 refusal), §Open 12 (live-derived 2D defaults), and the `_44` step-17 chain-sort button + numeric bulk-add | agents + Sina |

## Existing base (don't rebuild)

- Audio companion (`marsin_engine/audio/companion/`): live capture, BPM,
  genre — sole OSC analyzer; mic recovery fixed (`20260725_7`/`_8`).
- Playlists: engine `config.yaml playlist:`, per-channel playlists in
  mixer/deck state, CaptainPad deck playlist UI.
- Autopilot + audio-reactive profiles: `autopilot_profiles_audio_reactive.md`,
  `autopilot_deck_improvement.md`, `deck_split_playlists.md` dossiers.
- Mapping/views program: `bm_readiness_mapping.md` (sub-project).
- Deploy + supervision: `deploy/deploy.py` → titanic-ext, schtasks
  `BM26TitanicStack`, verified restart-stable.

## Links

- **Archive of everything compacted out of this doc (2026-07-30):**
  `../reports/202607/20260725_88_master_doc_archive.md`
- Thread tracker (canonical state): `../memory/bm_readiness_thread_tracker.md`
- Sub-projects: `bm_readiness_mapping.md`, `autopilot_profiles_audio_reactive.md`,
  `deck_split_playlists.md`, `effect_tuning.md`
- Plans: `../plans/20260709_party_readiness_execution.md`
- Ops: `../ops/engine_model_refresh.md`, `../ops/sim_auto_checks.md`,
  `../ops/marsin_engine_auto_checks.md`
- Branch: `feat/bm_readiness` (pushed; last wave `3246deb2`)

## Decisions log

Most recent only — the full list is archive `_88` §8.

- **2026-07-29** — Standing model policy: **all sub-agents run on Opus unless
  the operator directly names another model** for a task.
- **2026-07-30** — Operator-ordered EXCEPTION to scenes-are-operator-owned:
  the coordinator manually fixed `simulation/scenes/titanic/` (5 ghost
  fixtures deleted, `Left Back Wall Generator*` → `Left Back Wall*` across
  scene/patches/views, 0 stale refs). Sticky-by-name held on his next save.
- **2026-07-30** — Standing order: doc inconsistency vs verified behavior →
  **fix and clean up on sight** (`doc_inconsistency_standing_fix.md`); first
  application `_57`.
- **2026-07-30** — Operator confirmed 2D-view framing persists to the SCENE
  (rides his save/autosave) — approved as-is, no localStorage.
- **2026-07-30** — **Commit + push authorized and done:** `3246deb2` on
  `feat/bm_readiness`, 441 files including reports `_47`–`_87`. Security check
  failed first on two full IPs in the fresh `_87` report, which were redacted
  to `10.x.x.60` before it passed.
- **2026-07-30** — **Operator ruling: scene config files (`scenes/**`) may
  carry controller IPs.** The checker already tolerates them; the redaction
  convention applies to `.agent/` prose, not scene data.
- **2026-07-30** — Operator ordered this doc compacted end-of-day, Threads
  board kept, the detail moved verbatim to a report — archive `_88`.

## Log

Every dated entry from 2026-07-27 through 2026-07-30 is archived verbatim in
`_88` §9. **New entries append here, newest first.**

---
name: bm-readiness-thread-tracker
description: Live tracker for the BM readiness campaign — in-flight agent threads, queued work, and the operator decision queue.
type: project
created: 2026-07-24
updated: 2026-07-24
---

Living tracker for the **bm_readiness_mapping** project (operator asked to
keep the thread state on file for posterity, 2026-07-24). Dossier:
[`../projects/bm_readiness_mapping.md`](../projects/bm_readiness_mapping.md).
Branch: `feat/bm_readiness` (all work uncommitted; commits operator-gated).

**How to apply:** whichever agent coordinates this project updates this file
whenever a thread starts/lands; done items move to the Landed list with
their report link. Reports live in `.agent/reports/202607/20260724_N_*.md`.

## In flight (as of 2026-07-27)

- **R6 UI wave COMPLETE except one queued tweak**: operator's final
  iteration (patterns column 20% → 40%, i.e. weights back to original
  4/3/3) was queued to the wave agent after its completion — resume
  pending; agent must apply + re-capture deck_landscape.png. Verify
  flex: 2 → 4 at index.tsx:1009 lands.

**Landed 2026-07-27 — R6 CaptainPad live-UI WAVE (Opus,
`20260725_11_captainpad_live_ui_wave.md`):** all 6 items shipped, tsc
clean, vitest 797 pass (baseline 790 + 7 new chunkStripPages tests).
(6) audio focus-reload: inFlightRef + useFocusEffect retry,
audio.tsx ~:1158-1180 — failure no longer latches. (1) SIZE global
gone from UI (CPCControls.tsx fader/readout/defaultParams); engine
size param still MIDI/script-drivable. (3) pattern rows: whole-row
Pressable + pressed opacity 0.6, name Touchable demoted, hitSlops
trimmed (remove 12→6, chevrons 8→6) — live-mode boosted height now
tappable. (5) mixer globals portrait two-row (A: SPEED+SYNC/COLORS/
QUEUE/GROUPS, B: TAP/BPM/OSC), landscape identical, GROUPS
double-render guarded. (2) DEVIATION (operator live-iterated):
stacked layout built → rejected → reverted; final = three
side-by-side columns; operator then asked 20%→40% (queued, above).
Portrait path identical to origin; his "portrait patterns gone" NOT
reproducible on fresh dist — diagnosed as RN-web Fast Refresh stale
subtree from component-identity swap (hard reload clears; structure
that caused it is gone). (4) effects strip: single-line labels
(labelLines prop, deck grid keeps 2), 'FX' title, portrait 4-chip
pager with dimming ‹ › arrows (chunkStripPages throws on size<1),
landscape 8-up, BLACKOUT pinned. iPad-10" screenshot set delivered
to operator (7 PNGs in ~/tmp/captainpad_ui_wave/). Open operator
ambiguities (one-liners if wanted): keep/drop 'FX' label; landscape
long names tail-ellipsize ("Iceberg Fla…"). Metro :6967 untouched,
no git ops.
- **R2/R3 specialty patterns wave — PARKED 2026-07-27 (operator:
  "for the patterns, don't spend time on that, that needs me to be
  here, so deprioritize for later")**. Agent was stopped while
  WRITING ITS REPORT — the build itself looks substantially done.
  Residue ON DISK (untracked/modified, NOT validated, NOT deployed,
  do not treat as finished): patterns 60_white_wash / 61_white_breathe
  / 62_white_shimmer / 63_white_chase / 64_temple_warm_white /
  65_uv_only .js + manifest.json edit + marsin_engine/tests/patterns/
  + simulation/scenes/test_bench/playlists/*.yaml (themed set) +
  partial report `20260725_13_specialty_patterns_playlists.md`
  (likely incomplete). RESUME PATH: message the stopped specialty
  agent to finish report → validate → deploy, WHEN the operator is
  present for the pattern-tuning session. Report `_13` stays
  reserved. Next free: `_14` → now `_15/_16` reserved below.
**Landed 2026-07-27 — CaptainPad surface-trim + party-handling wave
(Opus, `20260725_18`), Timeline revision INCLUDED:** Monitor tab
fully removed (monitor.tsx −129, Tabs.Screen, dead desktopcomputer
icon map, stale comment; react-native-webview left in package.json —
offline rule forbids npm install; flagged for a dependency pass).
OPEN COMPANION button: pure utils/companion_url.ts (port swap to
6966, mirrored from launcher.js COMPANIONS.audio.port; unparseable
base THROWS), proven → 10.x.x.151:6966 with his override; Audio tab
keeps ONLY this. PARTY MODE card on the TIMELINE tab (first in
scroll body): toggle + playlist chips + 3 stepper rows (m:ss / min
formats, debounced commit, unsaved marker), utils/party_api.ts
against the extended contract incl. effectiveState (engine value
wins, else derives; enabled-but-no-plan renders NO PLAN), reconciles
to PUT responses, 400s printed verbatim; fail-loud HTTP 404 state
until engine lands. tsc clean, vitest 842 (809+33), 10 remaining
tabs load on fresh dist. NO DEPLOY NEEDED (prod profile = sim+engine
only; CaptainPad Metro-served from laptop, dist/ gitignored). STILL
OWED: live card proof against real /party-config once the engine
agent (_19) ships — fold into the _20 validator. Screenshots
delivered to operator.
- **Companion PARTY tuning tab (Opus, engine zone, `_19` reserved,
  `20260725_19_companion_party_tab.md`)** — operator: companion =
  THE authoritative audio-tuning place. Live meters w/ gate markers,
  editors for all party: tunables (APPLY runtime + PERSIST via
  SURGICAL config.yaml text replacement — comment-stripping landmine
  flagged, fail loudly if key line not found), §6 calibration
  capture helpers (P95/P5 + suggested values, not auto-applied),
  read-only session numbers + moodStale pill, validation-mode
  toggle (onSustainMs→3000 runtime-only). Offline rule enforced (no
  CDNs). Deploys + verifies remote companion UI :6966. ADD-ON:
  engine-owned party-config authority — persisted {enabled (default
  true), playlist (default party_high)}; GET/PUT /party-config
  (partial PUT, 400 fail-loud on unknown playlist,
  availablePlaylists in GET); disable = trigger blocked + active
  session ends immediately + survives restart; detector keeps
  publishing (policy ≠ sensing); cue resolves playlist at FIRE
  time; /timeline/state gains partyEnabled; companion tab gets the
  same toggle by proxying the ENGINE state (never stores it),
  ARMED/DISABLED pill, NO playlist picker companion-side (operator:
  companion doesn't know playlists). ADD-ON 2: FAKE TRIGGER —
  3-state runtime-only override at the PUBLISH stage (AUTO / FORCE
  PARTY / FORCE OFF), detector truth still shown next to forced
  value, loud banner, restart→AUTO, staleness guard stays fed (real
  timeline session fires — the point), disabled-beats-forced
  precedence + manual test recipe in report. OPERATOR EMPHASIS
  relayed: timeline is the SENIOR system, party mode a well-behaved
  citizen — no party-special cases where a timeline rule exists;
  undefined interactions → least-surprising choice + flagged in
  report §timeline-compatibility. AUTHORITATIVE SEMANTICS (operator
  2026-07-27): party fires ONLY while a timeline plan is ACTIVE
  (structural — verify + pin with test; enabled flag is an extra
  gate, not a replacement), and party NEVER overrides a human
  operator (honor the timeline's existing human-takeover rule: human
  takeover blocks pending triggers AND yields running sessions; if
  no such mechanism exists, minimal party-side yield + FLAG the gap
  — coordinator decides on a general precedence feature). Precedence
  order: human > operator disable > plan/party automation. UI state
  must distinguish armed / disabled / no_plan / in_session /
  cooldown (possible additive `effectiveState` field — relay to
  CaptainPad agent if added). FINAL SESSION MODEL (operator, rev 2 —
  releaseSustainSec REMOVED): durationEnabled (default true) /
  cooldownEnabled (default true); cooldownSec default → 120;
  minDwellSec NO toggle ever; duration OFF = follow-the-music —
  session ends WHEN audioPartyStrong DROPS, no timeline-side wait:
  the release sustain IS the companion's offConfirmMs (~30 s; its
  editor doubles as the release knob — label it so); ONE sustain, no
  stacking (operator caught the 60 s double); cooldown forced-off in
  follow-music; mid-session toggle → session keeps starting mode;
  GET reports effective values. Bulletproof/playa-proof emphasis:
  boot-time throws only, restart-safe all modes, staleness
  mid-follow-music session → forced CALM ends it (test),
  zero-internet. CaptainPad card: stepper removed → hint pointing at
  companion offConfirmMs (tappable via companion_url), resilience
  vitest (unreachable mid-edit, missing fields fail-loud, flap-proof
  debounce).

**Landed 2026-07-27 — CaptainPad PARTY card rev 2 (Opus, `_18`
addendum): FINAL.** releaseSustainSec fully purged from
party_api.ts; SESSION LENGTH off → hint row w/ tappable companion
deep-link (companionUrlFromApiBase; plain text if unparseable —
never guessed); COOLDOWN forced-off/greyed/stepper-less in
follow-music via single pure describePartyRows() applied to ENGINE
fields (UI cannot show a combo the engine doesn't hold); cooldownSec
default 120. Edit model REBUILT playa-proof: all controls coalesce
into ONE patch on 700 ms debounce (live-proven: 6 rapid toggle taps
= exactly 1 PUT); engine-drop mid-edit keeps pending edits +
"unsaved" + RETRY; only successfully-PUT fields clear; malformed
contract fields rejected BY NAME; 400s verbatim. tsc clean, vitest
852 (809+43; party_api.test.ts 35 cases). Screenshots (fixed-length
/ follow-music / portrait) delivered to operator. STILL OWED: live
proof vs real /party-config (404 until _19 lands) — folded into
_20 validator.
**Landed 2026-07-27 — CaptainPad Timeline-card enrichment FINAL
(Opus, `_18` addendum 2, LIVE-PROVEN vs titanic-ext, no stubs):**
effectiveState authority w/ all six values — MANUAL amber pill
("operator has the deck"), no_plan+!inFestivalWindow → "OUT OF
WINDOW" w/ reason; in_session → "ends in m:ss" from sessionEndsAtMs
(clamped, never a fake clock — follow-music says "ends when the
signal drops"); cooldown → "Cooling down m:ss"; greying from
effectiveCooldownEnabled (engine wins; pending duration-off still
greys instantly); "· engine uses N" note on config-vs-effective
drift; in-session/cooldown ticks 1 Hz + re-reads engine every 5 s
(engine numbers, not client drift), idle polls nothing; additions
optional-parse (pre-addition engine OK) but type-checked by name.
Live proof: real GET (OUT OF WINDOW pill, 14 real playlists), PUT
round-trips cooldownSec 120→180→120 AND 120→121→120
(effectiveCooldownSec echoed), duration OFF → engine reported
durationEnabled:false + effectiveCooldownEnabled:false → card
greyed from ENGINE flag. titanic-ext restored, final GET identical
to pre-test. tsc clean, vitest 867 (809+58; party_api 50 cases incl.
verbatim titanic-ext payload). Remaining: _20 validator only.
- **Party defect-fix pipeline (operator-ordered: quick Fable plan →
  Opus fix)** — _20 verdict CONDITIONAL FAIL, 4 blockers, ALL in
  pre-existing timeline code. OPERATOR SEMANTICS (2026-07-28,
  supersedes once-per-episode; his AskUserQuestion click said "keep
  once-per-episode" but his PROSE overrides — "D1, that's bad"):
  no limit = follow music (works, don't disturb); with limit =
  session → cooldown FROM SESSION END → re-armed while music
  sustains → next session. D2 restart-kill "bad too" — fix. Fable
  plan agent IN FLIGHT (`_21` reserved,
  20260725_21_party_defect_fix_plan.md) covering D1, D2, D3, D4
  family (D5/D7/D8 — _catchUp resurrection: takeover-release rejoins
  REMAINING window or ends, savePlan keeps ORIGINAL window, orphan
  latch cleanup), D6 (CaptainPad partyConfig WS listener + ungated
  poll), D10 (empty PUT → 400), D11 (corrupt persisted field →
  fail-loud ONCE at boot, not per-tick silent timeline kill). Dwell
  question flagged to plan (least-surprising: continuously-party
  mood = dwell already satisfied → fire at cooldown expiry). Opus
  fix `_22` + revalidation `_23` reserved. Next free: `_24`.

**Landed 2026-07-28 — LED strand color/white translation review
(Fable, READ-ONLY): findings + ranked fix plan live at
~/tmp/led_color_translation_review.md ONLY (external-firmware
details stay out of this public repo per operator rule).** BM-side
findings safe to note here: strand pixels are emitted as 4-byte
RGBW by simulation/src/dmx/sacn_mapper.js:207-242 — AMBER and UV
lanes are DROPPED for strands while the sim preview still mixes
amber in (preview lies cooler-vs-wire); engine OKLCH transition
work EXONERATED (param/palette ramps only, not in pixel output).
BM-side fix candidates awaiting operator pick: fold amber into
strand RGB per-controller in the mapper + make the sim preview
match the wire. Remaining causes + fixes are external-firmware/
hardware side — see the tmp review. Operator decision pending on
fix order (recommended first lever is config-only, zero DMX
impact).
**Landed 2026-07-28 — LED white/color software wave (`_25`) +
COORDINATOR ACTIONS: gamma pushed + deployed.** New
simulation/src/dmx/led_wire.js = single home for strand translation:
amber folded (UV dropped, no emitter), clip-proof TRUE-RGBW joint
pre-scale (R+W ≤ 255 through rounding, hue+white-balance exact),
gamma REJECTED mapper-side (lives ONLY on controller; scene
controllerGamma = preview mirror), preview computes from exact wire
bytes through one modeled-controller function (out-map AND sACN-in
demap agree). Proof: temple warm white @full OLD 255,255,255
neutral → NEW 255,205,133 tint-exact; amber-only OLD black → NEW
184,122,0; saturated bit-identical; tint err 0.2% full / 1.1% @5%
master / ±4% floor below 3% (8-bit physics, test-bounded). Sim
571/571 (+29), engine parity 24/24, DMX par bytes untouched
(asserted). COORDINATOR: gamma 2.2/2.2/2.2/w1.0 pushed to
10.x.x.60 "testbench" via led_gamma_push.cjs (applied no-reboot,
hardware-verified, backup at ~/tmp/led_controller_configs_backup/
...2026-07-28T20-46-52; --revert/--restore documented); W stays 1.0
— controller derives white AFTER its RGB curve (review's 1.8 would
compound to ~4.0); scene mirror updated (controllers.yaml:72).
Fleet scan: exactly ONE LED controller answered — no partial-fleet
claim; push others with the same tool as they come online. DEPLOY
OK 13:49 (150 dirty, restart_count 0). OPEN QUESTION to operator:
local test_bench.js has 20 px/strand vs 40 in HEAD — believed to be
HIS fetched remote edit, shipped in this deploy; confirm intended.
Full runbook/wire math: ~/tmp/led_white_fix_addendum.md; report
`_25`. Next free: `_26`.

**OPERATOR VERDICT (2026-07-28): RGBWAU → LED color path ACCEPTED
— "colored patterns look good." WHITE-pattern issue PAUSED** ("we
still might have some issues with all White patterns... pause the
white issue for now"). Consequences: P1 soft-knee + headroom knob
NOT launched (plan stays ready in ~/tmp/led_white_resolution_debug
.md — mechanism proven = composite ceiling; the LED-0→0.40 hand
test recipe also on file); firmware W pass-through remains PAUSED.
Resume either only on explicit operator ask.

**STANDING ORDER (operator, 2026-07-28 ~14:15): NO DEPLOYS to
titanic-ext until further notice** — he is moving dev onto the
local machine for now and will deploy himself later. All agent
briefs' deploy steps are void; agents finish at tests-green +
report. (The _26 pattern agent was countermanded mid-flight.)
Server-freedom grant from earlier today is correspondingly
narrowed: no stack restarts on the remote either unless he asks.

**NEW AGENT LINEAGE (operator, 2026-07-28 evening): Codex agent =
CURATOR** — role brief `.agent/roles/curator.md` (scope: patterns/,
effects/, scenes/*/playlists/, tests/patterns+effects; may drive/
restart the ONE existing engine, never spawn a second; no git; work
log ~/tmp/codex_patterns_log.md; Claude folds it into tracked docs).
Curator's kickoff asks (Claude-side feature list, sequenced):
(1) Titanic model output mapping — scene titanic generated model is
981 px with ZERO patches/controller IDs/sections/viewmasks;
(2) scene↔engine parity validator (fail-loud);
(3) safe operator-controlled model regen/reload without freeing
:6968; (4) playlist contract checker (stale keys already found in
saved `01_cylon_sweep` settings); (5) playlist clone/parity tool;
(6) CaptainPad "save current tuning to playlist entry" + diff +
cross-scene copy; (7) saved transition/blend recipes per playlist
entry; (8) named effect recipes (party/party_slow/general_ambient
stacks); (9) side-by-side model preview + perf budget review;
(10) transition/blend verification harness. Canonical playlist seed
decision: test_bench default.yaml (titanic default has summer_camp
material, left untouched) — coordinator endorsed, operator to
confirm to curator. New playlists: party, party_slow,
general_ambient in BOTH scenes; all existing playlists preserved.

**CURATOR MANDATE EXPANDED (operator, 2026-07-28 late):** curator
now also owns PATTERN CODE ORGANIZATION. Taxonomy in
`.agent/roles/curator.md`: root = default (largely stays default —
sift not evacuation); confirmed new dirs white_only/, uv_only/,
deep_sea/, organic/ (organic created now, populated later);
candidates titanic/, boat/, rustic/ = propose-only. QUARANTINE
dirs (operator 2026-07-28): summer_camp/ + logsville/ — ALL such
material moves there, NOT considered for BM at all (no BM
playlists, no theme classification, no catalog audits; parked
for pop-up shows, not deleted; existing mixed playlists stay
untouched but are excluded as seed sources). Per-dir
sequential renumbering; migration = ONE atomic campaign
(classification map → operator sign-off → moves+renumber+own-scope
reference rewrite in one pass → health proof); NAMES FROZEN after
migration until post-BM. Playlist families: general_ambient,
themed (boat/deep_sea/rustic/organic...), party_slow/
party_general/party_fast — entry-level saved settings, never
duplicate pattern files to retune. Coordinator ruling relayed to
operator: migrate FIRST, curate SECOND (saved tuning is keyed by
pattern name; curating before renumbering orphans it — stale
01_cylon_sweep keys already proved the failure mode). Claude-side
sweep after migration: timeline plans/states/docs references.

- **Titanic scene mapping PLAN (Fable, `_33`,
  20260725_33_titanic_scene_mapping_plan.md) — DONE 2026-07-28:**
  investigation + 9-step/3-phase multi-agent plan on file. Headlines:
  titanic is geometrically complete but `controllers: []` = the whole
  gap (registry never activates, projection early-returns, model
  exports 981/981 `patch:null` → engine emits nothing → sacn_in red);
  model is FRESH (regen 07-25), machinery all exists (auto-patch,
  sticky sections, views reconcile, browser-only exporter →
  :6970/save-model). Pre-req bug: DMX/LED sId/fId collision
  (projectOntoConfigs DMX-only max, `_4` finding). No scene↔model
  validator exists anywhere (gate hole). No same-scene engine reload
  endpoint (POST /scene same = no-op; pixelCount changes refuse
  hot-reload → needs exit-75 force path). Placeholder strategy:
  real universes + `0.0.0.0` sentinel IPs unblock the ENTIRE sim
  audit before wiring facts (bridge relays only real IPs);
  `--strict` validator = hardware gate. Bench-as-section decision:
  derived `TB ` copy via idempotent sync tool + parity gate in the
  validator (scene-import rejected: save-server re-extract risk).
  Phase A parallel slices: sid_fid fix / validator /
  same-scene-reload+runbook / bench-sync tool. Operator inputs
  O1–O9 (inventory, wiring, universe plan, rope px, TE sign,
  Art-Net, .202-vs-.60, 20-vs-40 px, bench presence) — none block
  Phase A. TITANIC DEFAULT PLAYLIST PURGE
  (no summer_camp/logsville at all) = curator's task, sanctioned
  playlist edit, in role brief. Curator tuning workflow (batches
  of 3-5, operator checks w/wo music, UI-store or relayed tunes)
  added to role brief. Next free: `_34`.
- **TITANIC MAPPING PHASE A WAVE (4× Opus, `_34`-`_37` reserved) —
  IN FLIGHT 2026-07-28:** executing `_33` Phase A in parallel,
  disjoint slices, each reads the plan itself: `_34` sId/fId
  collision fix — **LANDED**: proven bug = DMX and LED share one
  id space but projectOntoConfigs floored over DMX-only maxima →
  shipped test_bench model has TE Sign V3 A (40px) and LED_0
  (20px) BOTH sId 5/fId 11 → /dimmer-groups duplicate section 5 →
  dimming the sign dims the strand. Fix: union floors (DMX ∪
  LED), ledStrands REQUIRED arg (default [] would be a silent
  fallback), one-time loud idempotent repair of baked collisions
  (DMX side yields). Only test_bench changes (Sign A/B sId 5→7,
  fId 11→13/12→14; LED_0/1 keep 5/11 6/12); other six scenes
  incl. titanic export IDENTICAL models. Sim suite 591→601
  (698 w/ sibling files), 10 new tests, 8/10 falsified vs pre-fix
  module. Consumer audit: zero pattern impact (all sectionId
  compares are 0-3). Reported not touched: raw dimmer maps in
  states/test_bench/globals_state.yaml + performance-preshow
  snapshot go stale on id move (both 1.0 today). OPERATOR ACTION:
  one sim-save on test_bench logs 4 repair warnings + rewrites
  patches.yaml + 3 model files atomically (no headless exporter —
  deliberate). `_35` scene↔model parity validator — **LANDED**:
  simulation/lib/scene_model_parity.cjs (pure engine, imports
  NOTHING from src/ — a validator re-running audited code agrees
  with wrong answers) + tools/ CLI (exit 0/1/2) + 52 tests; 8
  check families: coverage, patch truth (LED no-straddle walk),
  address hygiene (unmapped = error), metadata (id-collision
  check), views, bench `TB ` parity, 0.0.0.0 sentinel (info →
  ERROR under --strict; sentinel-without-marker fails both),
  drift (patches re-derived from chains). Wired as required
  pre-commit gate in ops/sim_auto_checks.md +
  marsin_engine_auto_checks.md. VERDICTS: test_bench FAIL 8
  errors ALL known (2 unmapped TE Sign fixtures = O5; 4 sId/fId
  collision findings — this validator is the proof the operator's
  sim-save landed the _34 repair); titanic FAIL 92 (100 strict) =
  84 unmapped fixtures + 8 strands and NOTHING else (coverage/
  patch-truth/views/drift spotless both scenes → 981-px model is
  a fresh faithful export; Phase B counts 92→0). OPERATOR POLICY
  Q: shared_universe_overlap (same universe, different
  controllers) = warn default / error strict — confirm before
  titanic authoring. Follow-ups in _35 §6 (unfiled; plan step 9
  owns filing). Sim suite 698/698.
  `_36` same-scene model reload path — **LANDED first**: POST
  /scene/reload {"scene":"<active>"} (explicit name = deliberate),
  ack-then-restart via untouched requestSceneSwitch (graceful →
  handoff file + exit 75, or detached self-respawn standalone;
  mode + modelStale reason in ack); LOUD refusals w/ machine codes,
  zero state change: 409 PERFORMANCE_MODE, 409 SCENE_MISMATCH
  (never implicit switch), 400 SCENE_REQUIRED/INVALID_SCENE, 404
  missing model, 500 no-hook; guard ORDER tested; /scene active
  no-op kept + hint. 18 new tests incl. real engine on OS port
  (exit-75 + handoff proven, orphan-free teardown). Curator
  runbook .agent/ops/engine_model_refresh.md (two cases: same
  pixelCount hot-reloads; changed → modelStale → this route;
  validator gate; poll-until-back; STOP-and-report; hard nevers).
  Honest gaps in _36 report: standalone self-respawn branch not
  exercised live; wrong-model detection = validator slice's gate.
  Also fixed stale now.md note (universe changes hot-reload since
  G10; real trigger = pixelCount). FOLLOW-UP flagged:
  tests/mixer/performance_mode.test.js spawns engines in
  6960-6989 overlapping show ports. Engine suite 2373/known-8.
  `_37` bench-as-section sync tool — **LANDED (Phase A COMPLETE
  4/4)**: simulation/tools/bench_section_sync.cjs (+lib/
  bench_section.cjs) derives `TB ` block from test_bench (single
  source of truth, read-only both scenes, block deliberately NOT
  applied — --apply refuses, points at Phase B step 6). Exit
  codes 2 source-contradiction / 3 applied-diverges / 4 target
  collision / 5 strict placeholders. Three-tier fields: INVARIANT
  (wiring/universes/chains/led wire/device) parity-enforced;
  TARGET-LOCAL (placement/colour) seeded then operator-owned;
  STRIPPED (sId/fId/vMask/cIds/lastPush — target re-derives; this
  stops bench sId 5/6 crossing into titanic). Idempotency proven
  byte-identical (7911 B digest 3610e53583fd…); -0.0 YAML/JSON
  sign hazard found + normalized. SENTINEL: bridge never sent to
  0.0.0.0 — it SILENTLY dropped it (and loopback) on one inline
  condition; now classified sentinel/missing/broadcast/loopback
  w/ named per-(scene,universe,ip) warning; route counts
  identical, zero refusals across all 7 scenes today. Slice-2
  cross-check: derived block = 0 bench-parity findings; follow-up
  = validator check 6 should delegate to lib/bench_section.cjs
  (two hand-synced invariant definitions). +45 tests, sim
  698/698. PHASE B BLOCKER surfaced: titanic hits 30/31 VIEW BITS
  on apply (23 group + 7 new, 1 spare) and step-5 audit views
  need bits too — re-plan the 31-bit ceiling BEFORE applying.
  Phase B also: apply via live sim, controller ids from target
  registry, reserve U1/U2/U10/U12 (O3), POST /scene/reload after
  (pixelCount grows), gate --check --require-applied + validator.
  O8 (20-vs-40 px) fix-bench-then-rederive, never the copy.
  Honesty: sacn_bridge.js edited but not executed live (unit
  tests + route-count proof; live = Phase C smoke); stray empty
  C:\c dir stub left (protected-path delete blocked). Phase C =
  E2E + placeholder retirement. O1-O9 in `_33`. Suite baselines
  now sim 698 / engine 2373 known-8. Next free: `_38`.
- **Titanic sim FPS regression (FABLE debug per operator order) —
  ROOT-CAUSED 2026-07-28, report `_38`
  (20260725_38_titanic_sim_fps_regression.md): NOT a code
  regression — GPU ADAPTER.** 9-row fresh-browser bisect at the
  operator URL all read 59.9 FPS on the RTX 4090
  (webgl+webgpu, 3200×1687 hi-DPI, gradient, 110 s sustain with
  byte-stable 1,515-object census, synthetic 24-uni×40 Hz sACN
  influx of 12,312 frames); pinning Chrome to the Intel UHD
  (`--use-adapter-luid=0,76052`) reproduced **20 FPS windowed /
  10.0 FPS at fullscreen-scale** — the operator's exact number.
  Instancing intact (267 InstancedMesh, drawCalls 3,427≈3,413
  baseline). Cause: dual-GPU laptop, no Windows per-app GPU pref
  for chrome.exe → adapter drifts; powerPreference hint already
  set and advisory. FIX CHAIN → Opus: `_38` §4 (adapter log at
  main.js:115, integrated-GPU banner, sustained-low-FPS error at
  animate.js:344-352 naming the adapter, ops-doc rule) + Sina
  one-time Windows Graphics setting. Master doc row R9 + Log
  entry added; memory `sim_perf_gpu_adapter.md` written. SIDE
  FINDING (chip filed): engine claims sACN streaming to
  127.0.0.1 @39 fps but the :6971 bridge forwards ZERO frames —
  sacn_in paints undriven red regardless. Next free: `_39`.

- **Generator swap + splits DESIGN (Fable, `_41`,
  20260725_41_generator_swap_splits_design.md; Opus implement
  chains as `_42` on plan arrival — operator: "fable to design,
  opus to implement and all") — DESIGN LANDED 2026-07-29:**
  operator feature for Phase B mapping: (1) swap start/end button
  per DMX generator (reversed physical wiring vs generated order
  = mapping nightmare); (2) SPLITS = subsections over a
  generator's fixtures, count unchanged, each with start+end
  (start==end ok; start>end = reversed) controlling ADDRESSING/
  CHAIN order, e.g. 4→5, 3→2, 1→1; (3) simple swap acceptable if
  splits too heavy — design decides honestly. Must compose with
  _33 Phase B authoring + _35 validator (splits representable in
  what the validator reads; every index covered exactly once or
  loud error; generator re-run count change invalidates splits
  LOUDLY). **RESULT: splits designed as RENUMBERING at
  generation time** — `chainSplits: [{from,to}]` on the trace
  permutes which path position gets which fixture number, so
  number order = wire order; because registry addresses are
  sticky BY NAME (docs/33 decision 19) and regen keeps names
  stable per index, this fixes mapped generators RETROACTIVELY
  (Regenerate relands existing addresses on wiring-true lights,
  no chain surgery) and makes numeric-order adds prospectively
  correct. Swap button = the single full-reverse split (same
  mechanism, no second flag). Zero registry/panel/exporter/
  engine changes (chains stay `{fixture, at}`; `_35` drift check
  reads the effect natively); ONE new validator check
  `generator_splits` (exact cover else ERROR); count-change/
  boot invalidation refused loudly, splits never dropped; boot
  stale = console.error + red badge + skip regen (saved rows
  untouched). Field deliberately `chainSplits`, NOT the reserved
  `trace.splits` int of `20260724_32` circle station-chains (S1
  built, S2 unwired — vocabulary reconciliation flagged). Prior
  art: studiodj chains hand-split LeftSmokeStack across 2
  ports w/ reversed runs. LED chains OUT of scope (order
  load-bearing there). Recommendation: BUILD SPLITS (small
  under this design; swap-only leaves segment wiring unsolved);
  operator to ratify the renumbering semantic (`_41` §8 — a
  fixture's number becomes chain order, not path order). 12-step
  plan `_41` §7 for the `_42` Opus implementer (9 core + 3
  operator-gated options incl. "+ gen" bulk add, which touches
  the 2026-06-11 no-group-add ruling). Suite baseline 721/0
  untouched (read-only session). Next free after chain: `_43`.

**Landed 2026-07-29 — Generator chain-order splits + ⇄ Swap (Opus,
`_42`, 20260725_42_generator_splits_implementation.md):** all 9
core steps of `_41` §7 done; the 3 optional/operator-gated steps
deferred (see below). `chainSplits: [{from,to}]` on a DMX trace
declares the physical daisy-chain walk over 1..count path
positions and generation RENUMBERS through it, so `<group> 1` is
the first light on the cable; the operator's 4→5 / 3→2 / 1→1
example reproduces `_41` §4's table exactly, live. ⇄ Swap = the
single full-reverse split (one code path), label flips to "⇄
Restore path order", and pressing back DELETES the field (never
`[]` — an empty list is invalid, not "absent"). New pure module
`src/dmx/generator_chain_order.js`. ONE PLAN DEVIATION: the
emission seam `emitInChainOrder` was moved into the module so the
step-8 tests exercise the shipping path, not an oracle
(`generateGroupFromTrace` is a closure behind THREE + DOM,
untestable in Node); the aim math above it is a diff-visible
no-op, so absent splits serialize byte-identically. Card gains a
collapsed "⛓ Chain Order (wiring)" folder (status row, per-split
From/To, add/remove, Swap, amber mapped-note) + a card-level red
"⚠ CHAIN SPLITS INVALID" badge so a boot skip shows in the UI.
Loud everywhere, repairs nothing: invalid splits refuse
(re)generate BEFORE the undo push and the sweep (boot →
console.error + skip that trace, saved rows untouched); a Lights
count change that would invalidate splits reverts the slider and
KEEPS them. Add/remove buttons are total (add halves the last
split; remove merges back or clears the field) so a button can
never write an invalid list. Validator gains
`generator_splits/invalid_cover` (ERROR both modes, arithmetic
re-stated independently of src/); ZERO findings on every
committed scene (none carries chainSplits), parity CLI verdicts
unchanged. Zero registry/panel/exporter/engine/CaptainPad change.
**Sim suite 721 → 779 tests, 777 pass, 2 fail — the same two
pre-existing test_bench metadata_drift fails (TE Sign V3 A/B,
half-applied `_34` repair awaiting the operator's sim-save, NOT
touched); 58 new tests, zero new failures.** Live-proved on
:6969 as a browser client only (stack never restarted, probe
closed) via new triple-guarded harness
`agent_tools/generator_splits_verify.cjs`: 9/9 green, 0 save
requests, pristine restore, every scenes/** file still at its
pre-session mtime. Screenshots `~/tmp/generator_splits/`,
inspected. Adapter recorded (SwiftShader software GL,
integrated:false); NO FPS claimed. **OPERATOR SEMANTIC RATIFIED 2026-07-29** (by informed active
use: he configured Left Front Wall Generator splits 4→5/3→2/1→1
himself, asked "is this correct", coordinator confirmed and
restated the chain-position meaning + gave explicit
object-window; no objection — proceeded to request chain
visualization instead): a fixture NUMBER means chain position,
not path position. `_41` §2 option (a) remains the documented
fallback if he ever reverses.
**Landed 2026-07-29 — generator UX plan (Fable, `_44`; survived
2× API-529 kills, resumed from transcript both times):** root
causes MEASURED: (1) select freeze = onTransformChange wired to
TransformControls 'change' which fires on ATTACH → full
regenerate + shader recompile storm = 2,719 ms rAF stall per
select-click (main.js:240); (2) drag = per-pointermove-tick full
regenerate (gui_builder.js:3596-3598, dot-drag :3694) = 2.4 s
stall/tick, 0.4 FPS; (3) name/index parity mostly right post-_42;
gaps = lexicographic 2D lane sort ("10" before "2"), no names in
3D viewport, confirm-dialog undersell; (4) MAPPED rename broken
today: group rename → unmapFixture splices ALL chain entries w/
misleading "channels freed" toast; correct primitive
renameFixtureInChains EXISTS AS DEAD CODE (controller_registry
.js:1093); RightSmokeStacks rename was clean only because
titanic registry is empty. Plan = 3 Opus slices: 1∥3, 2 after 1.
LAUNCHED 2026-07-29: **Slice 1 (`_45`, select freeze + cold
move)** and **Slice 3 (`_46`, parity surfaces — coordinator
decision on step 12: re-point default top-down at 'Right
SmokeStacks', live-derived defaults deferred as operator
option; OPERATOR RULING mid-flight 2026-07-29: 3D generator
guide labels stay INDEX-ONLY, no fixture names in viewport —
"too messy, just the index is enough"; names-in-viewport step
cancelled, relayed to agent)**. **Slice 1 (`_45`) LANDED 2026-07-29:** select-click 2,719 ms →
0-133 ms (6 runs, budget 150; 1→0 regenerates, 1→0
invalidations; cause = 'change' fires on every property setter
incl. attach → now 'objectChange'); paced drag 0.4 → 52-59 FPS
(=1.00-1.03× idle, RTX 4090 recorded); per-tick handler 24.5→0.1
ms; release fires EXACTLY ONE regenerate; cold-move semantics =
ratified §5.1 (fixtures + dot overlay freeze mid-drag, snap on
release — measured 23.247/29.247 split mid-drag). Move-trail fix
preserved BY CONTRACT + mandatory trail regression (987/987 px,
0 stale). Side wins: select no longer marks scene dirty;
autosave defers with regenerate. New
src/dmx/trace_regen_scheduler.js + 2 test files + harness;
interaction.js unchanged; slice-3 files untouched. Suite
829/821/8 — same 8 = STALE models/titanic.js after operator's
13:46 saves (sim banner 981→987; re-export via sim save +
engine restart/reload clears). Also flagged: 4+ co-located
fixture pairs (e.g. "Left Back Wall 1" ≙ "Left Back Wall
Generator 5" — overlap toast every rebuild; feeds the orphan
decision: orphan group may be the SAME physical run,
reverse-indexed). Follow-up candidate: par-fixture drags still
invalidate per tick (~20-25 ms) — next cold-move candidate, out
of scope. **Slice 3 (`_46`) LANDED 2026-07-29:** 2D lane rows sort
numerically (was lexicographic "1,10,11,12,2…" — only bites at
10+ lights/group, none live today, test covers it);
renumber-confirm now names ALL THREE sticky-by-name stores (DMX
addresses + engine sectionId/fixtureId + hand-placed 2D
anchors); Controllers chain chips got a "cable documentation,
never re-derived" tooltip; CHIMNEY RING RESTORED — old name
resolved to 0 clusters (his rename HAD silently emptied half the
default top-down), re-pointed at 'Right SmokeStacks' → 8
clusters/ring live-verified; live-derived defaults deferred as
operator option; new test fails BY NAME if either group
vanishes. Names-in-3D was built, MEASURED at 7.58× wider than
tall per light (operator's "too messy" instinct correct),
REVERTED — guides index-only + harness check goes red if name
plates return. Screenshots ~/tmp/name_index_parity/ (3 sent to
operator). Suite 829/821/8 (same stale-model 8). Slice 2 note:
still owns rest of step 12 (batch-cache invalidation on
par-group rename, pixel-map selector migration, zero-match
warning). **Slice 2 (`_47`, rename hygiene) LANDED 2026-07-29** (report
20260725_47_rename_hygiene.md). BEFORE: mapped group rename
spliced every chain entry as a deletion casualty ("channels
freed" lie), old-name __globalPatchTree keys lingered as
phantoms. NOW: rename enumerates-then-invalidates deliberately —
one ✂ console line per fixture (was controller/port/universe/addr
→ now UNMAPPED), one 🗑 line per pruned phantom, closing
"addresses NOT migrated" instruction, 9s toast (verified RENDERED
via cropped screenshot — it never rendered before: 4px under the
multi-client banner + fade-in killed by blocking regenerate; both
fixed+pinned). Renamed fixtures come out ''/0/0/0 = validator
unmapped_fixture, never drift; display state (group override,
view bit, viewMask) follows the name with its own labeled lines.
Also: chainSplits gate runs before any mutation; individual
renames share one duplicate-guarded path; propagateToSelected
throws on 'name'; par-group rename invalidates batch cache; BOTH
group renames re-point 2D pixel-map selectors (no silently
emptied panels). Two live-harness-only defects fixed: phantom
resurrection by mistimed reprojection + the never-rendering
toast. 50 new tests; suite 903/895/8 (same stale 8, zero new);
zero scene writes across 8 browser runs; security gate PASS.
renameFixtureInChains intact-but-unwired with a test guaranteeing
migration can't become default by accident. PENDING OPERATOR:
(1) ratify step-11 loud refusal on individually renaming a
generated fixture (one function + one if, trivially revertible);
(2) 11b ⇄ Migrate-addresses opt-in yes/no (NOT built). Step 17
untouched; 12 orphans untouched. ALL THREE 2026-07-29 SLICES NOW
LANDED (_47/_48+addendum/_49) — no agents in flight. OPERATOR GATES from `_44` §5 (pending): 11b
migrate-addresses opt-in yes/no; step-11 loud-refusal on
individually renaming a generated fixture; step-17 chain-sort
button + numeric bulk-add (touches 2026-06-11 no-group-add
ruling). Notion cards still unfiled (no MCP session) — _42 §6 +
_44 follow-ups.

**NEW OPERATOR BATCH LAUNCHED 2026-07-29 (both Opus, per new
standing policy: subagents default to Opus unless operator names a
model directly):**
- **`_48` LANDED 2026-07-29 — 2D pixel-map view tuning** (report
  20260725_48_pixel_map_view_tuning.md; screenshots
  ~/tmp/pixel_map_views/, 3 after-shots sent to operator).
  FRONT: membership cut 41→10 clusters/side (front bars + front
  vintage + ONE hull-drop string per side, geometry-derived not
  name-derived, pinned by test); split one panel per side (ship
  halves ~50 units apart — single elevation could only be a 24%-
  tall sliver), ~2× on-screen pixel size. Front view is now
  titanic-only: on test_bench both panels resolve 0 and paint
  LOUD error banners (deliberate, tested). TOP-DOWN: strand dots
  7→4 via per-view typeStyles; NEW byPaintOrder() in
  pixel_map_layout.js (many-pixel runs paint first, singles
  last — real defect was the 40px strand ribbon painting OVER
  chimney pars 0.05 units away in plan; occlusion fix, nothing
  moved); Left/Right Small SmokeStack added (4 pars each, tangent
  discs, true outboard positions); 12 orphans excluded from views
  (not deleted). TE SIGN: new schema-validated per-panel `rotate`
  (0/90/180/270, TRUE projections only, throws on radial/lanes);
  root cause = sign on vertical plane, planar picked world-up
  along screen-X; bearing −177°→−87° (tip left → tip down = 90°
  CCW as ordered). Suite 901/893/8 — SAME stale-model 8, 21 tests
  added. Zero scene writes (0 save requests across 4 browser
  runs, scenes mtime still operator's 13:46). New harness
  simulation/agent_tools/pixel_map_view_tuning_verify.cjs.
  TWO OPERATOR RULINGS PENDING from _48: (i) keep small smoke
  stacks in true top-down at ~28% scale cost (they sit at
  x≈−46/+42 vs hull −31…+34) vs side-panel; (ii) orphan deletion
  (same 12-orphan decision as before). Operator action: reload
  the 2D Pixel Map (served from disk, no restart). NOTE: capture
  banner showed "3 sim windows connected — hardware output
  contention risk" during runs — leftover browser windows.
- **`_49` LANDED 2026-07-29 — LED halo parity** (report
  20260725_49_led_halo_parity.md; screenshots ~/tmp/te_sign_halo/
  01-06, 3 sent to operator). ROOT CAUSE: halo was a property of
  the render CLASS not of being-an-LED — dmx_fixture_runtime.js
  `if (isLed)` REPLACED the instanced halo with diffusion sprites
  gated on the per-fixture diffusion toggle and sized from the
  model YAML's physical 12mm (~0.075 vs strands' 0.504 = ~7× too
  small, ZERO with diffusion off); GUI Halo/Pixel sliders never
  reached LED-bus fixtures (applyLedSizeToAll walked
  ledStrandFixtures; sign lives in parFixtures). SECOND gap
  found: legacy ModelFixture (per-pixel Meshes, NO halo, no
  updateScales) was reachable via the DMX Fixtures dropdown for
  any modeled fixture. FIX: new shared
  simulation/src/fixtures/led_halo.js recipe keyed on `bus: led`
  (never type names — future LED products inherit); halo
  InstancedMesh for EVERY fixture, diffusion now an extra layer;
  sliders push updateScales live; LED-bus models can no longer
  reach ModelFixture. Perf: one InstancedMesh per sign half, test
  fails if any fixture draws per-pixel halos. NEW TOOLING:
  agent_render.cjs --camera/--target/--label +
  window.animateCameraToPose (documented in see_the_world.md) —
  agents frame details without touching operator-owned
  cameras.yaml. Tests: new led_halo_parity.test.js (9, sweeps
  every model YAML through the real registry). Suite 900/892/8 —
  same stale-model 8, zero new. Zero scene writes (mtimes 13:46
  across 5 browser runs). FOLLOW-UP flagged in report:
  ModelFixture still renders DMX-bus pixels per-pixel-mesh,
  no halo — now unreachable in shipped scenes; delete or fold
  into DmxFixtureRuntime (candidate Notion card, MCP still
  unavailable).
**`_48` ADDENDUM LANDED (2026-07-29):** operator correction
applied — Front view now carries 4 smoke-stack ropes (2/side):
Left/Right_Front_Left + Left/Right_Front_Right, picked by
GEOMETRY (per-side forward axis = front-wall centroid − back-wall
centroid, strand midpoints projected; front separates from back
by ≥5.8 units both sides; test asserts >3-unit margin so a nudge
can't flip silently). Agent's earlier hull-drop-only judgment
REVERSED — deck rope's length lives in x, draws as a long shallow
line in elevation; each pair = one hull drop + one deck rope
(tested by y-span). 11 clusters/panel, 22 total; scale gain now
~2.7× vs original (deck ropes at y≈14.8 made panels
height-limited). Suite 903/895/8 (same stale 8). Zero scene
writes. _48 report §9 addendum + §0/§1/§2 revised; master doc R10
updated. after_front.png recaptured + inspected.
**`_50` reserved — Controllers pane hide/show toggle (IN FLIGHT
2026-07-29, Opus):** operator order mid-mapping-session ("so I
can see below it"). Agent under STRICT live-session constraints:
operator is actively mapping REAL controllers with hardware
attached + unsaved sim state — zero scene writes, no sim
restart, short browser sessions, never touch output controls.
Task 2 (read-only): ground the "should Clear All Patches delete
controllers?" question in code facts — coordinator's recommended
shape given to operator: Clear All stays mapping-only + explicit
opt-in "also remove controllers" + test controllers cleaned by
default; need facts on whether test controllers are
distinguishable. OPERATOR MILESTONE 2026-07-29: first live
controller mapping WORKING — test mapping enabled engine output
on real fixture.
**`_51` reserved — "Left Back Wall Generator" STILL troublesome,
debug (IN FLIGHT 2026-07-29, Opus):** operator reports continued
trouble post-_47; diagnosis-only brief (symptom first, disk-vs-
live truth split, orphan-collision vs new-code behavior; NO scene
writes, no live-session mutation — offline repro on ~/tmp copy or
test harness; barred from GUI files held by _50 agent).
**`_51` LANDED 2026-07-29** (20260725_51_left_back_wall_rename_debug
.md): SYMPTOM = trace-card rename `Left Back Wall Generator` →
`Left Back Wall` refused, `A group named "Left Back Wall" already
exists.`, ZERO mutations, input reverted. He renamed **13 of 14**
generators today (13:25/15:19/16:38 saves — Right SmokeStacks,
Left/Right Auditorium, Left/Right Front Wall, Left/Right Front+Back
Rails, Left SmokeStack, Right Back Wall); this is the ONLY refusal
and the only trace still wearing " Generator". ROOT CAUSE unchanged
= the 5 orphan `Left Back Wall 1-5` par fixtures; guard is
`trace_group_rename.js:49-53`, PRE-`_47` (`_37`) code running as the
FIRST gate — **`_47` is behaving correctly**, all 13 successes
carried view bits/overrides clean (views.yaml ZERO stale keys, no
new orphans). NEW EVIDENCE the 12 orphans are JUNK not lights:
bit-identical duplicates of live runs (`LBW 1-5` ≙ `LBW Gen
5,4,3,1,2` — the permutation IS chainSplits `4,5,3,2,1`; `Left
Center Auditorium 1-7` = the Left Auditorium line pre-7→8); backups
show he created the " Generator" traces 07-24 19:45 BECAUSE the
plain names were taken. COST: 97/987 px (9.8%) of models/titanic.js
at indices 0-96, 12 of 98 parity unmapped errors, 2 view bits,
overlap toast every rebuild, 10 Unmapped-tray rows for 5 real bars.
THREE TRAPS: (1) group `✕ Delete` RE-HOMES (no confirm) — orphans
land in Left Center Auditorium / Left Back Wall; use per-fixture
`✕ Remove`; (2) delete→rename with no save between takes
renameGroup's MERGE branch (inherits orphan bit 524288, frees 16);
(3) after a successful rename the real bars VANISH from 2D Top-Down
— `ORPHAN_GROUPS` hardcodes 'Left Back Wall'
(pixel_map_view_defaults.js:94), and its tripwire test is DEAD
(reads `scene.parLights.traces`, should be `scene.traces`).
⚠ SEPARATE LIVE BREAKAGE: his 16:38 batch already staled two
hardcoded 2D-default names — `Left Top Chimney Generator` (→ Left
SmokeStack) + `Left Front Deck Generator` (→ Left Front Rails) —
**4 red tests**, LEFT chimney ring + left front vintage MISSING from
the 2D pixel map now; same bug `_46` fixed for the RIGHT ring. Third
recurrence ⇒ live-derived 2D defaults (`_44` §5 Q2) is the
structural fix. Operator decisions filed as master-doc Open
Decisions **11 + 12**. Zero writes to scenes/models/sim source; NO
browser opened (animate.js:679 auto-enables sACN out, hardware
attached); offline repro `~/tmp/lbw_debug/probe.mjs`. Tests
71 pass / 4 fail (the 4 = his renames, §6).
**`_50` SCOPE EXTENDED (2026-07-29):** operator added to the
Controllers-pane agent mid-flight: (a) controller name text box
too narrow (~5 chars visible next to IP) — debug + enlarge;
(b) header → 2 rows (name+IP / buttons), space available;
(c) "⚠ UNPATCHED — SIM-ONLY MODE" badge floats OVER the
port-assignment picker's fixture chip grid covering names — dock
or relocate while picker open, never occlude, warning stays
discoverable (acceptance: full list readable+clickable).
**`_50` LANDED 2026-07-29** (report
20260725_50_controllers_pane_toggle.md; evidence
~/tmp/controllers_pane_toggle/, 3 shots sent to operator).
(1) Controllers (n) section header w/ chevron OUTSIDE scroll
region (can't hide its own way back); collapse = one CSS class,
display-only (no rerender/projection/registry), tray gets whole
pane (91 fixtures + 8 strands vs 130px sliver); persists via
bm26.map.controllersCollapsed (camera-focus-pref idiom).
(2) Name-box root cause: .cm-name flex:1 = flex:1 1 0% zero
basis + min-width:0 → silent collapse; header now 2 rows
(chevron·name·IP / DMX·sACN·+port·🗑), name ≥120px min,
185px at 320px MIN_MAP — "LeftFrontWall" untruncated.
(3) Pill: fixed bottom/left home predated docked pane;
split_layout.js now publishes --sim-pane-left +
sim-map-docked/full body classes; pill parks over 3D view,
tracks divider drags, 0px² overlap with pane AND chips
(before-overlap reproduced same-run). Files:
controller_map_editor.js, split_layout.js, style.css, 2 test
files, agent_tools/controllers_pane_toggle_verify.cjs. Probe
GUARD: readonly=1 unusable for this pane (observer skips
setupControllerMapEditor) → blocked sACN OUT ws :6972
pre-script, asserted connected=false/framesSent=0. Suite
960/951/9 — all 9 stale-model family; 9th failure names the
operator's OWN 16:54 save additions (LeftLeftFront LED
controller + Left_Front_Left/Left_Back_Left strands) — data-
driven suite moved under him, zero new from this change.
TASK 2 FACTS (read-only): clearAllPatches only chains=0 —
controllers/universes/gamma provenance deliberately kept. Test
controllers NOT distinguishable by any field (testAutoPatch uses
same addController; TEST DMX/TEST LEDs names are module-private
constants; not sentinel IPs; REUSES real controller when one
exists → test patches can land on operator hardware unmarked;
operator already hand-cleaned TEST controllers once — proof of
ask). Deletion truth-costs: kills at: addresses (only home of
sticky-by-name), burns universes (nextUniverse never rewinds),
drops LED lastGammaPush, renumbers later controllerIds; empty
controller deletes with NO confirm. Engine coupling loose
(engine reads own config.yaml → desync not break). RECOMMENDED
(~3h, matches coordinator position): Clear All stays
mapping-only + opt-in checkbox in existing confirm "also remove
controllers created by Test Auto-Patch (N)" default-on when N>0
listing them; origin:'test' marker at creation (must be added to
createControllerRegistry whitelist re-constructor or evaporates
on reload); marker dropped on operator edit of name/IP; never
delete unmarked from that flow; don't reclaim universes.
AWAITING OPERATOR GO. Follow-up worth filing: per-card delete
confirm should name irreversible losses; empty controller should
still confirm.
**`_52` reserved — LED Fixtures menu mapping UX (IN FLIGHT
2026-07-29, Opus):** operator orders: (1) DESIGN-ONLY —
DMX-generator-style generators for LED models (density/model
config etc.), grounded in existing trace machinery; (2)
IMPLEMENT — rename for LED fixture instance groups, must follow
_47 rename-hygiene semantics (enumerate-then-invalidate loudly,
duplicate guard, selector re-pointing) applied to whichever
name-keyed stores LED groups actually have; (3) VERIFY-ONLY —
TE Sign own-group state ("good for now" per operator); flag
whether "TE Sign 2 (2)" is a double-press duplicate. Same
live-mapping-session hard constraints; LED-panel territory only
(Controllers pane owned by _50 agent). SCOPE EXTENDED mid-flight
by operator: (4) IMPLEMENT editable name for LED controllers
(like DMX ones; mirror _50's reworked DMX header style without
editing DMX pane code; rename-hygiene rules if name-keyed;
docs/41 conventions; nothing MarsinLED-firmware-specific in this
repo); (5) IMPLEMENT add-output-port button for LED controllers
(remove exists, add-back missing; match "+port" idiom; loud
failure on invalid adds); before/after + remove-then-re-add
round-trip evidence required.
**`_52` LANDED 2026-07-29** (report
20260725_52_led_fixtures_menu_mapping_ux.md; shots
.agent_renders/ledmenu_*, 2 sent to operator; probes
~/tmp/led_fixtures_menu/). ITEM 2: Rename button EXISTED but
CLIPPED (51px of 67px scrollWidth — min-width:0 flex shrink made
the "— Re..." ellipsis the everyday rendering); toolbars now
wrap, 262px unclipped + tooltips (2-row variant built+reverted:
min-width:0 on type <select> collapsed it — reasoning kept as
comment). HARDENING: group names are ONE scene-wide namespace
but each control policed only its own list — new pure
src/dmx/group_rename_guard.js is the single "taken" definition
wired into ALL FIVE entry points (DMX ➕ Add Group had NO guard;
par rename could fuse a MASK_* bit onto a live LED group); par
rename had NO pushUndo (unrecoverable) — fixed, both refuse
before push. Rename report deliberately NOT _47 language: group
rename changes no fixture NAME → nothing unmapped; prints
CARRIED (display) / UNTOUCHED (mapping) / ⚠ ENGINE MODEL now
STALE (rename doesn't change pixel count so stale banner never
fired — this line is the only surface); toast verified rendered.
Tests pin the no-false-invalidation claim. ITEM 3 (verify-only):
TE Sign 2 NOT an orphan — own born-locked group by design,
2nd press offers separate group via themed confirm. REAL DEFECT:
buildTeSign always emits same fixture names → both groups
contain "TE Sign V3 A/B" duplicates; parity validator errors
(names are join key), patches.yaml collapses to one record,
4 indistinguishable chips in Unmapped tray while mapping.
3 options in report §3 — OPERATOR CALL, nothing touched.
ITEM 1 DESIGN (no code): params.ledGenerators mirroring traces;
reuse path/shape/handle math + card grammar + sticky-name
contract; REFUSE chainSplits reuse (LED wire order IS the port
chain in Controllers panel — no second wiring truth); new
layout:density (pitch authoritative, count DERIVED from path
length — inverse of trace model, what strip hardware wants).
~3.5-4d full, ~2d without 3D handles. OPEN QUESTIONS: which
models (catalog only has fixed-geometry sign), density unit
px/m vs mm, sign as card?, ratify chainSplits refusal,
auto-regen on density change vs explicit. ITEMS 4/5: name+port
ALREADY EXISTED (renderController shared DMX/LED; name keys
nothing — identity id+ip, hygiene N/A). REAL BUG FIXED: LED
+port minted max+1 but LED port = device output
(derivePerOutputPlan keys port-1) → deleted output 2 of 4 came
back as port 5 addressing nonexistent strands[4], output 2
unreachable, dead port silently dropped from plan; now fills
lowest free slot 1..16 (docs/41 §4.2), throws past 16, inserts
in port order, DMX unchanged; proven live rm-P2 → +port → P2
round-trip. Harness led_fixtures_menu_verify.cjs 10/10 (run 1
caught 2 defects code review missed). Suite 980/972/8 (same 8
by name, zero new; 54 tests added). Zero scene writes (0 save
attempts / 5 runs, params+registry restored deep-equal). Handed
to Controllers-pane follow-ups: duplicate controller-name guard,
loud +port. ALL FIVE 2026-07-29 THREADS NOW LANDED
(_47/_48+2 addenda/_49/_50/_51/_52).

**`_53` LANDED 2026-07-30 — vintage fixture sizing** (report
20260725_53_vintage_fixture_sizing.md). NOT a _49 regression
(DMX-bus rules byte-identical pre/post halo work; VintageLed is
bus:dmx, never reclassified). ROOT CAUSE general + pre-existing:
model-fixture core = physical pixel size × Global Pixel Size
slider, never consults pixel PITCH; common.yaml ships slider=5 →
vintage 18mm heads on 75mm pitch render 2.67× wider than their
gap = fused sausage (fuses at ≥1.88; ShehdsBar ≥1.38, TeLedGrid
≥1.25, TE Sign ≥4.17; DMX halo ran away same at 4.7). FIX:
pitch-derived ceiling MAX_BULB_PITCH_FRACTION=0.3 (derived from
the reference strands' own 0.28 ratio, not taste) —
clampPixelRadiusToPitch (throws on garbage) + per-fixture
nearest-neighbour minPixelPitch measured once at build; DMX rim
bounded by same ceiling × named HALO_RIM_FACTOR;
fixture_representative exempt; backlit-sign halo merging
preserved (only opaque core bounded). Sliders pass through
untouched below ceiling (linearity test 0.5→1.0); _49 LED-bus
rule intact, guarded at extremes. Measured at 5/4.7: vintage
bulb 0.1000 (1.33× pitch) → 0.0225 (0.30×), halo
0.1692→0.0405; at working-tree 1.1/0.6 vintage/TE/par
pixel-identical. Suite 1002/994/8 (same 8 by name; +7 tests
fixture_pixel_pitch_sizing.test.js). Zero scene/model/YAML
writes. ⚠ SCREENSHOTS BLOCKED — sim was DOWN (operator
restarting); agent correctly did NOT npm start (prestart kills
ports + opens bridges w/ hardware cabled); numeric evidence +
ready-to-run capture commands in
~/tmp/vintage_fixture_sizing/SCREENSHOTS_BLOCKED.txt — RUN
CAPTURES when :6969 is back. Crop dead-end recorded: big discs
in old renders were the chain-order editing overlay, not
emitters. OPERATOR RULING SURFACED: Global Pixel Size cannot
reach LED strands at all (why the slider crept to 5 — inflating
every model fixture while doing nothing to strands); fold
strand bulb onto multiplier vs relabel control — his call.
LEFT BACK WALL RESOLVED (2026-07-30, coordinator manual scene
edit, OPERATOR-ORDERED "yourself manually"): base = his fresh
09:03:24 save. scene_config.yaml: 5 ghost fixtures (Left Back
Wall 1-5, sectionId-2 family) DELETED; trace + 5 real fixtures
renamed Left Back Wall Generator* → Left Back Wall* (replace_all
after ghost cut). patches.yaml: 5 zeroed ghost entries deleted;
5 generator keys renamed (sectionId 50 / fixtureId 233-237
kept). views.yaml: ghost bit 524288 line deleted; generator key
renamed keeping bit 16. VERIFIED: 0 stale refs across all 4
yaml; 12/5/1 new-name refs (matches Left Front Wall precedent);
all files parse (js-yaml); exactly 1 group ×5 fixtures + 1 trace
count:5 chainSplits [4→5,3→2,1→1] intact; controllers.yaml had
ZERO refs to either family (his live patch from earlier not in
save). 87 total fixtures now (was 92). ORPHAN_GROUPS 2-file code
fix DISPATCHED to pixel-map agent (drop 'Left Back Wall' entry —
now excludes REAL bars; KEEP excluding the 7 Left Center
Auditorium ghosts, still unruled). Operator Q answered: ghosts =
07-24 pre-hygiene relics (trace deleted/renamed, fixtures
lingered — the exact bug _44/_47 fixed); undeletable in UI
because traceGenerated:true with no owning trace (generator-
managed guard, no generator to delete through). OPERATOR MUST
RELOAD sim page before next scene interaction, then re-export
model when convenient.
**`_50` ADDENDUM (sort) LANDED 2026-07-30** (report _50 §5b;
shot titanic_9_tray_sorted.png sent to operator + before_sort/).
NATURAL comparator extracted from pixel_map_layout.js →
simulation/src/core/natural_sort.js, ONE cached Intl.Collator
(localeCompare-per-call was the perf killer), both surfaces
import it. REAL trap found: renderChips() IS the filter oninput
handler and re-walked every scene config + chain entry PER
KEYSTROKE — sources now resolved once per render, filter = pure
order-preserving subset; measured 6 keystrokes / 2ms on 84
chips. Sorted: tray fixture chips + strand chips (own cluster
after fixtures, not fused) + "+ list" picker (same tray in pick
mode). Deliberately NOT sorted: port chain chips (daisy-chain
wire order = home of at: addresses) and "+ sel" (3D-selection
order per its tooltip promise); registry unmappedNamesByKind
untouched. Tests: natural_sort.test.js (10; 2-vs-10 pinned,
one-collator pinned, both consumers proven importing shared fn)
+3 ergonomics (no source-helper call inside renderChips = the
per-keystroke guard; chain renderer never touches comparator).
Honest gap: live scene has no group with both 2 and ≥10 after
cleanup — browser tool says so and skips; unit tests pin it.
FREE DIAGNOSTIC: sorted tray puts the TE Sign V3 A/B duplicate
names ADJACENT — _52's duplicate_scene_name defect now visible
at a glance. Suite 1002/994/8 (back to 8, same family by name).
Zero scene writes (09:23:18 write = save server manifest regen
on HIS restart). DECLINED as wrong-moment (offered next):
duplicate controller-name guard + loud +port — registry-level
changes while he's actively adding controllers.
SIM CONFIRMED BACK UP → _53 agent resumed to run staged
vintage before/after captures (incl. high-slider pair if
possible without touching saved scene).
**`_53` CAPTURES LANDED 2026-07-30** (report addendum;
~/tmp/vintage_fixture_sizing/, 2 sent to operator). VERDICT: at
operator's current 1.1/0.6 sliders before/after are visually
IDENTICAL (already 6 distinct heads); the fused-blob bug
reproduces fully at 5/4.7 (common.yaml HEAD value + slider max)
where the fix removes it completely — 6 separate heads, same
camera/settings. "Before" produced WITHOUT touching the tree:
new harness vintage_sizing_capture.cjs writes pre-fix instance
matrices in-page (formula verified vs HEAD), updateScales()
restores; VintageLed matrices only (bars/signs not isolated in
captures). All guards clean (0 sACN enables, 0 :6970 writes,
scales snapshotted+restored to 1.1/0.6, overlay restored, no
leftover Chrome). Scene mtimes = his 09:51:07 save only. Suite
unchanged 1002/994/8. SCREENSHOTS_BLOCKED.txt removed.
**`_48` ADDENDUM 4 IN FLIGHT (2026-07-30):** operator annotated
Top-Down sketch: (1) bring the 2 ship halves CLOSER (explicit
operator sanction to depart from single true projection FOR
TOP-DOWN ONLY — named/tested per-side gap parameter, within-side
geometry stays true; may extend to outboard small stacks if it
composes); (2) bars render as DISTINCT rectangles with gaps (now
abutting strip); strands/ring/small-stacks unchanged. Priority:
gap compression > distinct bars. Semantic change to be noted
prominently in report. SCOPE ADDS mid-flight: (3) FRONT view
vintage pixels → 6 distinct circles "a bit bigger" (verify true
VintageLed per-fixture pixel count vs sketched 6 — pin to model
definition not magic number; typeStyles mechanism; sized
relative to projected spacing per _53 pitch lesson, no 2D
sausage); (4) TE SIGN view: both signs SIDE BY SIDE in one view.
**ADDENDUM 4 LANDED 2026-07-30** (_48 §12; shots
~/tmp/pixel_map_views/, 2 sent to operator). (1) Compression
semantic: panel.compress={minWorldGap:5, gapWorld:4} — every
empty band along projected horizontal axis >5 world units
collapses to exactly 4; piecewise translation, within-side
bit-identical; THRESHOLD not name-table (name tables went stale
3× this session — geometry can't); non-silent (declared consts,
returned band list, console line per band); >3× headroom
(collapsed 26.5/13.8/8.1 vs largest must-not-move gap 1.5);
test recomputes from scene. 53% of view width was empty;
vertical fill 0.714→0.881 (~23% bigger everything). (2) Bars:
ShehdsBar 17→14 per-view (Top-Down only), gaps ~3→~13 design
units = 5 distinct boxes — ⚠ partially walks back _40 "a bit
wider" ON THIS VIEW ONLY, operator may veto; Front keeps 17.
Strands 4→5. (3) Front vintage: panel.expandPitch=
{VintageLed:0.6} — re-lays cluster pixels along own projected
axis at declared world pitch, centred on true centroid (order/
orientation/position honest, only internal spacing stretched);
6 IS REAL (model_33.yaml model.pixels=6, test reads YAML);
glyph-only sizing impossible (0.075 world pitch = 2.8 design
units); now ~22 pitch / 16 glyph (0.72); Front fill fractions
byte-identical. (4) TE Sign side-by-side: NO CHANGE NEEDED —
Addendum 2's one-panel-per-sign already tiles left→right;
confirmed live + screenshotted; OPERATOR ON STALE PAGE — needs
browser reload; if still missing after reload = new bug, report
back. Suite 1017/1009/8 (same 8 by name; +15 tests). 16
hardcoded names re-audited vs his 09:36:02 save: 0 stale. Zero
scene writes; GUARDs 3+4 held on live capture vs his :6969.
NOTE 2026-07-30: operator saved again post-cleanup —
patches.yaml regenerated by his save (sectionIds renumbered,
Left Back Wall now sectionId 64 / fixtureIds 309-313; names
carried = sticky-by-name working as designed; coordinator's
hand-written projection entries superseded, expected).
**ORPHAN_GROUPS FIX LANDED (2026-07-30, _48 §11 Addendum 3):**
ORPHAN_GROUPS now ['Left Center Auditorium'] only, dropped in
both files (pixel_map_view_defaults.js + verify.cjs CommonJS
mirror, annotated). Old 12-orphan pin did its job (went red on
scene change); replaced by 3 sharper: excluded-orphans-still-
untraced; **NO default view excludes a trace-backed group**
(general form — closes the class with no foreknowledge); Left
Back Wall drawn in Top-Down again (5 clusters PASS, crop
evidence: back-wall bezel row present below lit front row;
header 95 fix·971 px = exactly −5 ghosts/−90px). Suite 982/974/8
(same 8 by name; 139 pixel-map tests green). Parity CLI titanic
192→337 errors = model export staler under scene edit (expected;
clears on operator re-export + engine restart, owed).
JUDGMENT CALL (approved in relay): his stack was DOWN mid-verify
(he stopped it to reload the fixed scene) — agent did NOT bind
6969-6972 (hardware-attached collision risk); captured via
throwaway python static server :7969 (no save server, no
bridges, GUARD 3+4 active), stopped after, nothing listening
now; harness gained --origin flag.
**`_54` LANDED 2026-07-30 — 2D view adjustability** (report
20260725_54_pixel_map_view_adjustability.md; shot
after_adjust_ui.png sent to operator). Views… → ▸ Adjust per
view: FRAMING now persists (view.framing={zoom,panX,panY},
restores on bind persist:false, 400ms debounce, absent-stays-
absent so never-framed ≠ framed-to-shipped-fit; zoom bounds
pinned to wheel clamp by test), rotate select, close-the-gaps
on/off+gap+threshold, LED pitch per type, glyph size per type
per view w/ ↺, footer "Reset view to default" (deep-copy, never
aliases shipped literal; REFUSES on operator-created views —
"delete it instead"). Every write re-validates whole view +
rolls back byte-identically on throw (schema msg in toast, no
half-applied, no silent clamps). Persistence = commitViews() →
params.pixelMapViews (anchor idiom; HIS save carries it). Suite
1046/1038/8 (same 8; +10 tests); verified live against real
shipped view on his :6969, GUARDs held, zero scene writes.
DESIGNED-ONLY (operator word needed): membership editing
(~0.5d; RULING: may removing a panel's LAST group be allowed,
leaving the honest red no-match banner? agent recommends yes;
glob selectors read-only "pattern"); per-panel fit-to-content
(~1h; focused-panel vs whole-pane call). TRADE-OFF FLAGGED:
commitViews marks scene dirty → panning eventually autosaves
(consistent w/ anchors); one-line move to localStorage
(per-workstation ergonomics) if he'd rather framing never touch
the scene — his call.
OPERATOR ANSWERS (2026-07-30): (1) framing-to-scene APPROVED
as-is; (2) membership editing — term unclear to him, coordinator
explaining, NOT built; (3) fit-to-content GO with spec "fit to
the area not under any menu, active" → fit active pane's content
into visible unobstructed rect (measure obstructions from DOM at
click time, don't hardcode; through view.framing path; honest
fallback to pane rect if no real obstructions) — LANDED as _54 §9 addendum (2026-07-30, shot
after_fit_to_visible.png sent). Honest finding: pane IS
overlapped (Lighting Controls covers ~330px of right edge +
chip strip + banners; right small stack was hidden under it).
⤢ button per pane header (pane action, not per-view Adjust —
view can bind several panes). Measures body element children ∩
pane rect at CLICK TIME from live DOM (child-list not id-list —
id lists = the stale-name pattern), edge-trims to cheapest free
rect, full-cover overlays ignored; binary-search largest zoom
whose panel-content union fits (multi-panel exactly solvable via
rigid pan; two-panel test); persists through view.framing (same
validation/rollback; FRAMING_ZOOM_MIN/MAX imported not restated,
console line on clamp hit). Views manager overlay deliberately
NOT an obstruction (transient, inside panel). Live verify w/
panel docked: zoom 0.914, content clear of panel/strip/banners,
right small stack fully visible. Suite 1059/1051/8 (+13 tests,
same 8). Zero disk writes (probe page separate document,
autosave stubbed, :6970 aborted).
**`_52` ADDENDUM (GUI wheel guard) — STOPPED BY OPERATOR
2026-07-30 mid-verification** (last agent note: its
wheel-over-slider check might be vacuous because the panel
scrolls under the cursor; it was making each wheel tick provably
land on its target). Work state unknown/partial — do NOT assume
landed. Operator said "fix the scrolls please" → stopped agent
unresumable (killed agents stay cancelled) → FRESH Opus agent
launched 2026-07-30 with full brief + orders to reconcile any
partial edits from the killed agent (git status/diff first,
finish-or-revert wheel-guard hunks only, honor the non-vacuous
tick-targeting insight). Evidence ~/tmp/gui_wheel_guard/.
**WHEEL GUARD LANDED 2026-07-30 (_52 addendum):** killed agent's
work KEPT WHOLE (wheel_guard.js module, 19→21 tests, harness
reworked, handler deletions, install site) — reading (a)
confirmed: fix was already live via disk-served dev server;
values immune AND panel scrolls (scrollTop 427→547 over fader).
TWO independent bugs: (1) own wheel-to-value handlers with
overflow-conditional guard — DELETED; (2) Chrome stepping
focused input[type=number] as DEFAULT ACTION (unreachable by
stopPropagation) = the half that zeroed his values — document
capture listener, stops propagation + BLURS, never
preventDefault, passive:true (scroll unblockable by
construction). Addition: div.slider fader into
GUARDED_SELECTORS (was protected only by handler absence —
structural now; blur scoped to native list so keyboard editing
survives). SWEEP: every numeric widget in sim is
input[type=number], no iframes/shadow roots → document listener
covers all (patch U/Addr, map editor ×6, gamma, Adjust fields);
canvas gestures untouched. VACUITY TRAP proven live: Chrome
animates wheel scroll, two-equal-reads settle returns before
scroll starts (input measured y=356 was y=467 at tick-land) —
harness now asserts on window-capture witness of real tick
landing + pointer calibration (caught puppeteer defaultViewport
CDP-vs-CSS desync) + quiet-window settle. NEGATIVE CONTROL:
unguarded tick 0.08→-0.92 (his bug on demand); guarded identical
tick = 0.08; 11/11 PASS. Suite 1080/1072/8 (same 8). Live
safety: :6972 WS refused in constructor (interception misses
WebSockets), :6970 aborted, scene=titanic tag-union unchanged.
Deliberate leftover: dead 'wheel' entries in 2 gui_builder snap
lists (cosmetic; 1431-line in-flight diff not worth touching). OPERATOR LIVE FEEDBACK
2026-07-30: "gui scroll isn't working which is good" — wheel no
longer mutates values in his session (likely killed-agent
partial edits already live via disk-served dev server); desired
end state CONFIRMED = values-never-wheel-mutated; agent told to
verify panel scrolling still works (scroll-yes/mutate-never) and
not regress the blessed behavior while reconciling.
**`_55` LANDED 2026-07-30 — EDIT mode move + right-click group
select** (report 20260725_55_pixel_map_edit_mode_move.md; 2
shots sent to operator). FINDING: move wasn't missing — drag/
nudge/rotate/Esc existed since S4 writing view.placements, but
spatial/planar layouts IGNORE placements (the protected
true-projection property) → drag persisted an anchor, rebuilt,
nothing moved, NO ERROR (silent no-op = the exact class house
rules forbid). Granularity per-FIXTURE (selection is a Set of
fixKeys; no UI path selects part of a fixture — his "pixel run"
IS one fixture). Move writes NEW per-view offsets={fixKey:
{dx,dy}} in design units — delta from projected position,
applied POST-FIT (in-world folding would re-run aspect fit per
pointermove = rubber-banding); placements semantics on radial/
lanes byte-unchanged + test pins placement-still-moves-nothing
on projected panels; zero-dragged offset REMOVED (never-moved ≠
moved-back). getAnchor/setAnchor route per panel model resolved
once per rebuild. Fixed in passing: materializeView seeded junk
placements on every edit press (also dirtied scene) — skipped
now. Right-click = group within SAME PANEL (group spans panels;
moving unseen fixtures wrong); shift+rclick adds; rclick empty
clears (shift keeps); context menu suppressed unconditionally.
Rotate on projected fixture now refused LOUDLY (once/pane).
"Reset moves" row in Adjust panel. Live evidence: rclick → 5
bars selected, drag → all 5 at {56,24}, survived rebind, others
untouched. Suite 1075/1067/8 (+14 tests, same 8). Zero scene
writes; stayed inside pixel_map/* (no wheel-guard overlap).
OPERATOR OFFER PENDING: move = nudge from projection, not free
placement — per-panel free-layout mode available if he wants
drop-anywhere.
**`_56` reserved — .60 LED controller restart debug (IN FLIGHT
2026-07-30, Opus):** operator: sim cannot restart the .60 LED
controller — "not showing up and not working right". OPERATOR
FACT relayed mid-flight: device IS alive, its web config UI
loads fine in his browser → failure is sim↔device path
(discovery range/endpoint mismatch, CORS-swallowed page-side
fetch, restart-requires-config-write-first per docs/41, or
silent catch). Diagnosis-first brief; max ONE deliberate
restart repro, timestamped; privacy: no firmware internals in
tracked files, raw evidence ~/tmp/led_controller_debug/, IPs
redacted in .agent/. SCOPE ADD then RETRACTED by operator (2026-07-30): Ethernet-
only/WiFi-off task CANCELLED before any write — an EXTERNAL
agent (operator's own, outside this session) is handling
WiFi/Ethernet on the device. Debug agent warned: device may be
config-written/rebooted/re-addressed under it by that external
agent — timestamp everything, attribute effects carefully,
re-verify device state before live-probe conclusions, prefer
code-vs-contract evidence; one-restart budget stands.
**`_56` LANDED 2026-07-30** (report
20260725_56_led_controller_restart_debug.md; raw transcripts
~/tmp/led_controller_debug/). TWO independent sim-side causes;
device never at fault (all four docs/41 read endpoints HTTP 200
~190ms, full 3-field fingerprint, perOutputDmx advertised,
`Access-Control-Allow-Origin: *` → CORS hypothesis RULED OUT;
discovery does run page-side but can read fine). (a) **"Not
showing up" = bind-affordance bug** in
simulation/src/gui/led_discovery_panel.js: the result-card dedup
matches by controllerId **OR plain IP**, and the Bind button was
gated on `existing.id !== controller.id` — so opening
Discover/bind FROM a hand-added card whose IP already matched
suppressed Bind on exactly the card needing it. IP match ≠
bound; his card has NO `device:` block → unbound forever →
skipped by sync chip, push-all, gamma-all. NOT a swallowed
error (probeDevice→null on a sweep is documented+correct; no P0
fallback violation in this path). FIXED: new exported pure
`shouldOfferBind(controller, device)` comparing device
controllerId (rebind still offered, self-bind still suppressed)
+ dedup label now says "added … — NOT bound yet" when unbound.
5 tests (led_bind_affordance.test.js). (b) **"Can't restart" =
NO restart control exists** — `rebootDevice()` in
src/dmx/led/marsinled_client.js has ZERO callers repo-wide (no
button/route/test/CLI): dead code. Only reboot lever is the
full push+reboot flow, which also rewrites strands/dmx. Its
endpoint constant is CORRECT: verified live with a control
probe (bogus sibling path → 404 empty; real path → 200
"Device Rebooting…", uptime 353751ms→9353ms, resetReason
poweron→software, back in ~11s on the same address). Device's
own console never calls that route, which is why read-only
evidence couldn't settle it. Button NOT added — a new
DESTRUCTIVE control mid-live-mapping wants operator sign-off;
shape ready (confirm → rebootDevice → awaitReboot → status
re-read, loud on failure). ONLY restart this session caused:
**17:34:08 UTC**; NO config written to the device at all — any
other blink is the external WiFi/Ethernet agent's. Suite
1080/1072/8 — SAME 8 as baseline, zero new by name (all
pre-existing scene-parity / pixel_map CLI). Zero scene/model
writes, no sim restart, no browser session on his :6969.
DOC DEBT FLAGGED: docs/41 §3 still describes the LINEAR
single-base mapping as the contract, but hardware + the sim's
push path are per-output only — §3's worked example is stale.
OPERATOR ACTIONS PENDING: (1) reload the sim page, re-open the
.60 card's Discover/bind, press the now-present Bind button to
write the `device:` block; (2) decide on the explicit
"⟳ Restart device" button.
**`_56` ADDENDUM — live re-check 17:58Z (read-only, no writes/
reboots):** device HEALTHY + UNCHANGED. Uptime 23m53s vs 23m54s
elapsed since my 17:34:08Z reboot = EXACT match → ZERO reboots
since mine; resetReason still software; firmwareSHA, networkMode
(WIFI, no eth), strands, perOutput, gamma all identical;
configSource primary, stagedPending false → **the external WiFi/
Ethernet agent has NOT touched this device at all.** Heap
healthy, bootReport clean 3/3 bound. **REAL FINDING: strands
DARK since boot** — sACN armed+listening but rxPackets 0 /
lastUniverse 0 / lastPacketAgeMs -1 after 24 min;
framesPresented 2 per output at ~12s (boot self-test) and
nothing since; local pattern VM parked (correct while
dmx.enabled). NOT a regression, unchanged from baseline, NOT
addressed by the bind fix. CAUSE (read-only look):
marsin_engine/config.yaml `controllers:` has exactly ONE route
(to the .202 unit, 2 unrelated universes) — NO route for the .60
device or its 3 universes, so they fall through to flat
sacn.destinations = loopback and stream to the SIM ONLY, never
to hardware. (The one existing route points at .202, which never
answered this session.) = docs/41 §5.3 open "dual-destination
for LED universes" decision. Nothing changed; routing + sACN
output controls left strictly alone (live session). Scene .60
entry still has NO `device:` block (Bind not pressed — needs a
page reload). VERDICT: healthy, correctly configured, UNFED —
wants an engine-routing decision from the operator, not a device
or discovery fix.
**STANDING ORDER RECORDED (2026-07-30):** operator: "if you find
doc inconsistency, fix and clean up" → new memory fact
doc_inconsistency_standing_fix.md + MEMORY.md index line
(descriptive truth only, P0s apply, same-doc + directly-linked
scope per pass).
**.60 STATUS CHECK LANDED (2026-07-30, _56 addendum,
read-only):** device healthy at same IP/MAC/SSID; uptime 23m53s
= exactly elapsed since our sanctioned 17:34:08 restart →
ZERO reboots since, resetReason software, firmwareSHA unchanged,
stagedPending false — **operator's external WiFi/Ethernet agent
has NOT touched the device at all**. REAL FINDING: strands dark
since boot — sACN armed on its 3 per-output universes but
rxPackets 0 / lastPacketAgeMs -1 after 24 min; outputs show only
the boot self-test frames. ROOT CAUSE: engine config.yaml has NO
controllers: route for the .60 universes → they fall through to
flat sacn.destinations (loopback) = sim-only, never hardware;
the ONE existing route points at the …202 unit which never
answered this session. = docs/41 §5.3 open "dual-destination"
decision — OPERATOR ROUTING DECISION, not a device/discovery
fault; nothing changed by agent. Bind still unpressed (needs his
reload). Evidence ~/tmp/led_controller_debug/recheck_*.txt.
Agent offered to take the docs/41 fix — DECLINED by coordinator,
_57 agent already owns it.
**`_57` LANDED 2026-07-30 — docs/41 per-output contract fix**
(report 20260725_57_docs41_per_output_contract.md; 22-row
claim→correction→evidence table; 249+/69− content-only diff).
Headline: §3 "linear-mapping constraint / one contiguous stream"
(the exact model that darkens outputs past the first) → "per-
output universe contract" (one sACN receiver per output, own
{universe, startAddress:1}; feature gate + read-back; corrected
worked example out1→U4 ch1-160; plan rules all-or-none/≤16/no
overlap). Also: operator DOES pick per-port universe
(led.baseUniverse ignored); probe 600ms/32 → 6500ms/64 (cold
device ~5s to first byte); dedup-by-IP vs bind-by-controllerId
split documented w/ _56 affordance; §4.1 bodies corrected; §4.3
reboot verified-live + no-sim-restart-button recorded; §5
dual-destination answered (alsoFlat); §3.2 +port lowest-free
slot; §6 marked historical; EOF tool residue removed. Memory:
in-repo .agent/ carried no linear claim; coordinator AUTO-MEMORY
fact marsinled-controller-onboarding corrected (linear bullet +
index line). NOT fixed (called out honestly): full RFC1918 IPs
in docs/41 pre-existing convention (security gate allowlists 10.
outside .agent/) — optional cosmetic follow-up; .agent/plans/
historical; zero other docs/ occurrences; policy items left
open. ALL AGENTS NOW LANDED — nothing in flight.
**OPERATOR MILESTONE + NEW THREAD (2026-07-30): LEDs LIVE.** He
set output 1's universe to 21, pushed to controller (device
restarted as expected), then LEDs only lit AFTER a full Lighting
Controls save. Orders: (1) Push to controller must ALWAYS push
effectively, never be ignored; (2) controller-pane Save
Configuration should suffice without a full Lighting Controls
save if possible. **"use fable to get a plan, and opus to
implement and fix"** (explicit model call — Fable planner
overrides the Opus default for this plan).
**`_58` LANDED (2026-07-30, FABLE per operator) — push/save
workflow plan.** Root cause: **Push writes ONLY the device**
(+ in-memory registry); the strands' sACN feed is the bridge
relay, whose routes are rebuilt exclusively from patches.yaml
ON DISK (setScene notify after a save) and whose frames come
from the engine model file — both written ONLY by exportConfig,
and `autoSave: false`, so nothing converges until a manual save.
Day-long darkness fully explained: unbound card ⇒
projectLedStrandPatches skips its strands ⇒ every earlier save
wrote ZERO .60 records; the push BOUND the card (addendum #3),
so the NEXT save was the first that could project + route. Both
his steps were necessary. Save Configuration (controller pane)
already IS the identical exportConfig full save — order 2 is
literally true today. Overlap Q: out1/out2 = U21/U22, no clash
(validatePerOutputPlan hard-refuses same-universe); BUT the push
auto-extended the deviceʼs third enabled output (no card port
row) to **U23 = LeftFrontDeckʼs DMX universe** — cross-controller
collision, derive's `used` set is plan-local (verified live on
the device; inert today, unicast keeps U23 at .11). Latent traps
found: bridge Receiver universe list is BOOT-FROZEN and the sacn
package drops unsubscribed universes SILENTLY (saved this time
only by the persisted `sacn_universes: 1..24` override;
nextUniverse is 27 — next controller breaks); saveAndNotify 500ms
notify race; notify failure = swallowed console.warn. Plan: S1
push completes the loop (persist via awaited exportConfig +
notify + per-step honest dialog, device-written-but-feed-stale
red on failure), S2 registry-aware plan gate (auto-extend skips
claimed universes; explicit collision = blocking refusal), S3
bridge runtime addUniverse on recomputeRoutes, S4 notify
ordering+loudness, S5 chip tooltip + docs/41 §4 + live
acceptance = re-run his exact sequence, push-only ⇒ LEDs follow.
Operator-gated: acceptance run (reboots device), .60 output-3
U23 remediation (disable output or add 3rd strand + re-push),
push-save scope micro-decision (A: push also saves scene —
recommended; B: scoped /save-mapping), bridge restart for S3.
No engine code/config/restart needed anywhere. Report
`202607/20260725_58_push_save_workflow_plan.md`. **Opus
implementation dispatches: S2 → S1, S3, S4 independent, S5
last.**
**`_58` IMPLEMENTATION WAVE (2026-07-30, all Opus per operator
pre-auth "opus to implement and fix"). Reservations:** `_59` = S2 registry-aware plan gate (**LANDED
2026-07-30**: `collectClaimedUniverses` → Map universe→owner
(DMX claims keyed by stable controller.id, LED claims by panel
ordinal per docs/33 dec 20 — both test-pinned);
`derivePerOutputPlan` takes the claim index as REQUIRED 4th arg
(optional would re-open the defect), auto-extends only onto
registry-free universes, returns third field `collisions`;
explicit collision = blocking refusal MODAL pre-write (device
never written), push-all fails that controller and continues;
`computeSyncState` uses the SAME claim index (now exported) so
chip reports colliding plan as drift, not green;
controller_map_editor threads claims via
ledCtx().claimedUniverses off fresh computeProjection. Tests
+11 incl. live U23 repro → picks U24. Suite 1099/1091/8 (8 =
known stale-model family). S1 handoff: ctx member
`claimedUniverses(controller)` is REQUIRED in tests (new Map()
ok); persist+notify goes AFTER pushPerOutputVerifyRecord; keep
collision early-return ahead of save/notify wiring. Report
202607/20260725_59_push_gate_registry_claims.md), `_60` = S3 bridge runtime universe subscription (**LANDED
2026-07-30**: pure diff helper in lib/bridge_routing.cjs +
injectable applyUniverseSubscriptions; recomputeRoutes
subscribes routes ∪ engine pairs ∪ scene patch universes
BEFORE building senders, provenance-logged once each, never
unsubscribes; per-universe addMembership error isolation,
universe stays unicast-accepted; boot-frozen MAX_UNIVERSE
drop guard RETIRED (would have shadowed the fix), replaced
with a positive "First frame on U… runtime-subscribed" log.
bridge_routing tests 15→24 all pass; full suite 1088/1071/17
= 8 known stale-model + 9 from S2's concurrent edits (S3
touches neither file). ⚠ INERT until the operator-gated
bridge restart — waiting-item 16 in master doc; running
bridge still has the U24 ceiling. Report
202607/20260725_60_bridge_runtime_subscription.md),
`_61` = S1 push completes the loop (**LANDED 2026-07-30**:
`exportConfig()` async+awaitable → resolves `{ok, reason?}`
never rejects, all no-write paths answer ok:false with verbatim
reason incl. the model-export abort (TE Sign dup-name class);
`notifySacnBridge()` returns `{ok, scene?, reason?}`, WS-not-
connected = ok:false; push flow = device write/verify →
awaited save → notify, per-step dialog "✓ device · ✓ scene
saved · ✓ bridge notified — routes follow" or red naming the
stale layer + "device WAS written (cannot be rolled back)";
device write never reverted; push-all persists+notifies ONCE
after the sequence; confirm dialogs declare the save (Option A)
up front; S2 collision refusal untouched ahead of everything.
Suite 1099/1091/8 → 1111/1103/8 (same 8 stale-model).
Deviations: result-object not rejection; no force param; bridge
notified twice on success (idempotent setScene — collapsing is
S4's call); sync chip stays in-sync + "feed is STALE" detail.
⚠ Proven by unit tests only until the operator-gated live
acceptance run (master-doc item 17). Report
202607/20260725_61_push_completes_loop.md), `_62` = S4 notify ordering + loudness (**LANDED 2026-07-30**:
saveAndNotify = awaited exportConfig, notify only on ok — the
old timer was NOT a race, it ALWAYS lost (notify 500ms vs
debounce 2000ms: bridge always re-read stale patches while
reporting success); failures loud via _surfaceFailure →
console.error + red save toast (window.showSaveToast published)
+ red sACN-IN monitor line; notifySacnBridgeLoud new, quiet
variant stays the push's entry so loudness never doubles.
Caller-semantics fix: autoSubscribePatchUniverses relied on
debounce-only → now calls debounceAutoSave directly (forcing a
save there = surprise disk write vs operator's autoSave:false +
would make read-only agent tools start saving);
saveAndNotify kept as documented primitive, no in-repo caller.
Duplicate notify KEPT deliberately (idempotent setScene; both
buttons + push each stay self-sufficient/self-reporting; two
msgs per push by design). New
tests/patch_manager_notify_ordering.test.js. Suite 1111/1103/8
→ 1121/1113/8, same 8 verified name-by-name.
sacn_input_source self-heal untouched. Report
202607/20260725_62_notify_ordering_loudness.md), `_63` = S5 honesty +
docs/41 §4 + acceptance prep (QUEUED: last). Push persist scope
= **Option A** (plan's recommended default; flagged to operator
as micro-decision #3 — switch to B only if he objects).
Operator-gated (NOT dispatched): live acceptance run, .60
output-3/U23 remediation, bridge restart for S3 activation.
Live-mapping lockdown applies to every agent: no browser
sessions against his sim, no saves, no device writes, no
restarts; code + unit tests only.
**`_64`/`_65` reserved — LED controller gamma UI (operator order
2026-07-30):** "check the gamma UI and curve in the firmware and
allow a similar setting for the LED controllers from the LED
controller config UI in the sim instead of plain textboxes."
`_64` = recon + design (**LANDED 2026-07-30**: firmware gamma =
"Color Curves" card — 4 sliders R/G/B/W 1.00–3.00 step 0.05 w/
2-dp readouts, NO text entry, Link-RGB checkbox (W independent),
presets Off/sRGB 2.2/Punchy 2.6, live inline-SVG y=x^γ plot w/
identity diagonal + video clamp, gamma-only POST applies live NO
reboot, gated on capabilitiesExt.gammaRgbw, API field
gamma:{r,g,b,w}. NOTABLE: the .60's SERVED web console predates
the card (zero "gamma" in its assets) though core reports
gammaRgbw:true, device gamma currently 1/1/1/1 — the card
arrives via private-repo reflash (operator side). Sim textboxes
= led_gamma_ui.js:78-110 renderGammaSection; everything behind
them already correct (mirror → validate 1.0–3.0 → gamma-only
push → read-back verify → lastGammaPush; NOT part of per-output
plan, no bridge notify needed). Design: sliders + readouts +
Link RGB + presets + 132×84 inline-SVG curve (innerHTML
convention, offline-safe), dashed ghost of last verified curve
on drift, oninput repaint-only / onchange = one ctx.mutate,
presets hold W=1.0 per docs/41 doctrine (test-guarded). Raw
firmware captures ~/tmp/led_gamma_recon only. Follow-up filed
NOT in _65: verified gamma push mirrors in-memory only — reload
reverts mirror while hardware keeps curve; unblocked by _61 but
changes push semantics, separate slice. Report
202607/20260725_64_led_gamma_ui_design.md).
`_65` = implementation (**LANDED 2026-07-30**: textboxes →
firmware-style control on every LED card — 4 channel-coloured
sliders 1.00–3.00 step 0.05 + 2-dp readouts, Link RGB (W never
linked), presets Off / 2.2 sRGB / Punchy (active lit), live
132×84 SVG curve plot w/ identity diagonal + honest 1/255
video clamp + dashed ghost of last hardware-verified curve on
drift, caption "y = x^γ · applies live — no reboot". oninput =
local draft repaint only, onchange = one ctx.mutate; push/
verify/fleet paths byte-identical. Files: led_gamma.js
(additive), led_gamma_ui.js renderGammaSection, simulation/
style.css (NB: design's path was right, brief's src/gui/ was
wrong), tests +9 (29/29 gamma green), docs/41 §4.1(d) sentence.
Suite 1111→1130/1122/8 (own delta +9; +10 was S4 concurrent;
same 8 stale-model byte-for-byte). Deviations: throws on
non-finite/γ≤0 (no NaN corruption), CSS classes not color-mix
in SVG attrs, frozen preset copy. Lockdown held incl. NO
agent_render (would be a browser on the live sim). OPERATOR:
hard-reload sim for new style.css; sliders = preview only,
⬆ Push gamma = device write (applies live); device's own web
console lacks the card until his private-repo reflash; preset
W=1.0 doctrine flagged for veto (firmware parity available on
request). NUMBERING NOTE: _65's mention of "_66" = the gamma-
mirror-persist follow-up is WRONG — that follow-up is
UNNUMBERED/queued (from _64; save scene after a gamma push
until it lands); `_66` is the pixel edit-tab persistence bug.
Report 202607/20260725_65_led_gamma_ui_impl.md).
**`_66` reserved — 2D pixel edit-tab arrangement persistence
(operator bug 2026-07-30, IN FLIGHT, Opus):** operator edited
the arrangement in the 2D pixels edit tab, "saved all the way",
but a server reload wiped the edits. Orders: fix, make the edit
tab work correctly, and AUTO-SAVE the layout config so it
persists (explicit operator ask — layout auto-persist is
sanctioned despite scene autoSave:false; agent to scope the
persist to pixel-map layout, not a general scene autosave).
**LANDED 2026-07-30.** Root cause: `params.pixelMapViews`
(panels, anchors, framing, ALL edit-mode offsets) had NO YAML
wiring at either end — config.js only knew the retired
`pixelMap2d`; a full save wrote everything EXCEPT the layout,
and boot re-seeded the 4 shipped defaults over the gap
silently. Fix: new scene sidecar `pixel_map_views.yaml` via
new `POST /save-pixel-map-views` (validate → snapshot → atomic
write; malformed body = 400 touches nothing); parsed at boot
like views.yaml, corrupt file HALTS boot (booting past it would
let auto-save overwrite a good file). Scoped auto-save per
operator order: commitViews debounces 800ms to that endpoint +
sendBeacon flush on unload; the OLD `debounceAutoSave(true)`
force-widening (dragged whole scene to disk from a pan while
STILL not saving the layout, bypassing autoSave:false) REMOVED
— dir-scan test keeps it out. Failure = loud red toast +
console.error. Files: pixel_map_persist.js (new),
pixel_map_store.js, main.js, pixel_map_panel.js,
save-server.js, scene_backup.cjs; +20 tests. Suite 1154/1146/8
(same 8, zero new). OPERATOR VERIFY: restart sim server ONCE
(new route), EDIT-move → ~1s → scenes/titanic/
pixel_map_views.yaml appears; page reload + server restart =
identical layout; move raises NO unsaved-changes mark. NOTE:
its dossier note "next free _68" is stale — _68 = vintage 3D
scale-up (in flight), next free `_69`. Follow-up filed (task
chip): group rename fixes pixel-map selectors in memory but
gui_builder caller never persists them → reload shows loud
zero-match banner. Report
202607/20260725_66_pixel_edit_persistence.md.
**`_67` security redaction sweep (LANDED 2026-07-30, Opus):**
`--all` findings 56 → 6; ALL 50 bm26-report-ip findings under
.agent/ gone. 15 uncommitted files cleaned (13 untracked
reports _4–_47 + tracker + master doc): 48 RFC1218 IPs →
10.x.x.NN keeping last octet (.151 show machine, .60 testbench,
.202 dead sACN target, .1 synthetic probe), 2 UNC paths →
\\<show-machine>\titanic\…; 0 MACs in .agent/ (brief was wrong
— the MAC lives only in scene backups). No newline churn, no
factual claims altered. Remaining 6 = one controller MAC in six
gitignored studiodj scene-backup snapshots — operator-owned,
never stageable, documented tripwire; left alone. Commit path
is CLEAR. Report 202607/20260725_67_security_redaction_sweep.md.
**`_68` reserved — vintage lights 3D scale-up (operator order
2026-07-30, IN FLIGHT, Opus):** "the vintage lights are still
tiny in the 3d vis — make sure they are scaled up model-wise by
2.5X at least (housing and pixels)." Screenshot shows them as
tiny red dots on the davit/boat area. NB: an earlier sub-agent
resized the 2D front-view vintage circles; this is the 3D
fixture model itself. **LANDED 2026-07-30.** Root cause of "still tiny": nobody had
ever drawn the fixture larger than life — a physically 90×460
mm fixture on a ~100 m ship is specks at any camera distance;
_53's clampPixelRadiusToPitch is a CEILING (can only shrink).
Fix: new fixtures/fixture_model_scale.js per-type render
multiplier (VintageLed: 2.5, frozen+validated, throws on
garbage) applied in dmx_fixture_runtime.js to housing+offset,
hitbox, bulbSize/halo, new per-pixel renderPos for emitter/cone
matrices. pixel.localPos stays PHYSICAL (model exporter +
light_pool sample it — exported model must describe the real
rig). CRITICAL catch: the MAX_BULB_PITCH_FRACTION=0.3 clamp
would have silently eaten the 2.5× at any slider >0.45 —
_minPixelPitch now measured on DRAWN spacing so the ceiling
scales with the fixture, _53 anti-fusion intact. Instancing
asserted (1 InstancedMesh bulbs + 1 halos, ≤4 children). +7
tests incl. a floor guard failing if vintage scale ever <2.5.
Suite 1161/1153/8, zero new. Screenshot INSPECTED (readonly=1
short pass): six heads ≈45 px spaced column,
.agent_renders/1785440378_vintage_heads_tight.png. FLAGS for
operator: (1) close-view clutter is mostly the chain-order
editing overlay (~1.6 m numbered discs + red dotted wires) —
toggle GUI → Generators → "⛓ Show Chain Order"; (2) housing is
#111111 unlit — scaled but invisible at night, the heads are
what read. (Dossier's "next free _69" note stale; tracker
canonical: next free _72.) Report
202607/20260725_68_vintage_3d_scale_up.md.
**ADDENDUM LANDED (2026-07-30) — "Left Front Rails 4 still
small" was BRIGHTNESS, not size.** Live readonly probe of his
running sim: ALL 16 VintageLed fixtures identical (_modelScale
2.5, drawn radius 0.055, instanced, zero variance front/back);
exactly ONE vintage class in the registry. Left Front Rails =
the ONLY patched vintage run (U23 LeftFrontDeck addrs
1/34/67/100) so they render live DMX — at probe Rails 1/2 were
luminance 0.017/0.018 (near-black), 4 at 0.163 — while all
unpatched vintages (incl. Left Back Rails) hold static #f07100
at 0.096 forever; night apparent size = additive halo+bloom, a
dim head reads "small". NO code change; +2 regression tests
(whole real-scene VintageLed inventory must collapse to ONE
size signature; any future /vintage/i type must carry ≥2.5×).
Browser verify ABORTED on the "2 sim windows connected"
contention banner (lockdown honored; live probe = the
evidence, 0 save-server writes, scene dirty-tree predates the
session by 11 min = operator's own). Suite 1176/1168/8, zero
new. OPERATOR decision points: (1) if front rails should be
LIT, the question is what U23 is sending (ties to _58 feed
saga + the .60 output-3 park); (2) bigger night reading for
ALL vintages = Global Halo Size lever (0.6 today), not model
scale; (3) more physical scale = one line + floor-guard moves.
**`_69` reserved — per-output push timeout fix (operator bug
2026-07-30, IN FLIGHT, Opus):** live push failed "✋ per-output
push failed: timed out after 5000 ms — device did not respond";
operator: the restart takes much longer than the config-reset
timeout, fix in the LED controller pane. Known timings: reboot
~10-11s (verified 2026-07-30), cold first byte ~5s, probe
6.5s/64-batch. **LANDED 2026-07-30.** Root cause: ONE constant
(DEFAULT_HTTP_TIMEOUT_MS=5000) fed both GET and the
reboot-triggering POST — firmware goes down before flushing the
reply, so 5s aborted mid-reboot on healthy hardware EVERY time
(and 5000ms sat exactly on the ~5s cold-first-byte, so reads
were a coin flip). Deeper defect: timeout treated as proof of
failure. New named budgets: DEFAULT_HTTP 8000, PER_OUTPUT_WRITE
12000, REBOOT_WAIT 45000 (measured basis in comments);
pushPerOutputUniverses takes {readTimeoutMs, writeTimeoutMs}
and REFUSES a flat timeoutMs loudly. Three phases w/ progress
copy: write → reboot-wait poll ("waiting up to 45s… Ns
elapsed") → read-back verify. Ambiguity handled: lost POST
reply = err.writeResponseLost → same reboot wait → read-back
ARBITRATES (match ⇒ success "write reply was LOST … read-back
confirms", continue save+notify; mismatch ⇒ drift failure;
never answers ⇒ "UNCONFIRMED: may or may not have applied",
never "failed"). Answered 400/5xx stays a definite failure.
S1 dialog + S2 gate untouched; fleet rides same core. Suite
1161→1174/1166/8, zero new. OPERATOR (master-doc item 18): his
failed push likely left device AHEAD of mirror (write applied,
no provenance/save/notify) — check the card's sync chip
(in-sync ⇒ device took it), then ⬆ Push again either way
(idempotent, now finishes the loop). Report
202607/20260725_69_push_timeout_reboot_aware.md.
**`_70`/`_71` reserved — port→output association control
(operator order 2026-07-30):** (1) UI on LED controller cards
to set which PHYSICAL OUTPUT each card port drives; (2) REVISED by operator mid-design (2026-07-30): all physical
outputs stay ENABLED at all times, push never toggles enable
state — "the controller can have all 4 ports enabled at all
times, and we just direct data to the port we need". Port
assigned to output N ⇒ output N gets that port's universe;
portless outputs get PARKED on a registry-free universe (safe
auto-extend via the S2 gate); "off" = nothing routes to the
parked universe (unicast ⇒ dark). U23 remediation becomes a
re-park on re-push, no disable. Design to answer: sticky
parking vs re-derive per push (recommend one); confirm a
single card port can target output 4 directly (port number ≠
output number, no filler rows). Update relayed to the _70
agent via SendMessage; (3) uniqueness — no two ports may target the same
output (blocking refusal, S2-gate style); (4) "have agent
verify this whole workflow". **`_70` = design LANDED 2026-07-30**
(20260725_70_port_output_assoc_design.md, read-only session):
explicit 1-based `output:` per LED port row (loader drops unknown
port keys today → parsing it IS the work; identity migration +
one log/card); STICKY parking recommended — persisted
`parkedOutputs:` on the card, re-derived only when claimed/out
of the ≤16-universe span (a re-derived park makes the sync chip
flap = the phantom-drift class _59 closed); parking SUPERSEDES
_59's auto-extend; ONE asymmetric write kept — **enable-only**
(a port targeting a board-disabled output turns it ON + writes
its pixel count; never `enabled:false`), which is what makes
"drive output 4 from ONE row" work; `count` never rewritten on
an already-enabled output (20-vs-40px question untouched);
duplicate-output + out-of-range + park-span refusals through the
existing S2 refusal dialog; claims index widened to include
other cards' strandless PORT universes + parked universes (a
real hole); sync chip compares the FULL map → **expect the .60
card to read ▲ Drift the moment _71 lands** (the U23 landmine
becoming visible; one push clears it). Downstream truths found:
outputIndex DOES reach patches.yaml; led_patch_projection.js:310
would name the WRONG card port under a crossed mapping (needs
`portNum`); lib/bench_section.cjs:277-280 hardcodes
`outputIndex === port.port - 1`. 25-case unit matrix + operator
live checklist + 10-step ordered brief in the report. `_71` implementation **LANDED 2026-07-30** (after a transient
API-error crash at step 10, resumed and completed): all 10
design steps — `output:` 1-based per port row (identity
materialized at load, bad type/range hard-stops boot, duplicate
loads but push refuses); push NEVER writes enabled:false;
portless enabled outputs PARKED on claims-free universes,
persisted `parkedOutputs:` (sticky, re-derived only on
claim/collision/window-exhaustion = blocking refusal); ONE
enable-only write w/ mapped pixel count, count never rewritten
live; claims index widened (strandless port universes + parked);
_69 read-back EXTENDED in place, lost-reply arbitration covers
the full map; chip compares the same full map; UI = P1→out[4▾]
selector + crossed-mapping marker + Board outputs line + ↻
re-park + memory-only deviceOutputsCache; portNum on strand
records, bench_section compares declared output. FOUR ASKS: all
MET (unit space; DOM wiring + hardware = operator-gated §6).
Suite 1184→1224/1216/8 zero new. FIVE deviations documented —
load-bearing: EMPTY port row → disabled output enables NOTHING
(_70's literal rule would have refused every routine 4-row
push); type-flip materialization/strip; conditional refusal
lead sentence; bench orderKeys additions; enable_without_pixels
kind removed. UNVERIFIED firmware assumption (item 22): what
perOutput reports for parked-enabled outputs — mismatch fails
LOUDLY at read-back, never silent. .60 EXPECTATION: ▲ Drift on
pane open (landmine visible, not a fault); ONE push re-parks
output 3, settles waiting items 15+18. OPEN QUESTION for
operator: push only enables outputs a port drives — if "all 4
enabled at all times" means the sim should MAKE that true
(auto-enable all on push), that's a one-word go (_70 §8-3
unbuilt by design). Live checklist _71 §6 = waiting item 22.
Report 202607/20260725_71_port_output_assoc_impl.md.
**`_72` reserved — Left Front Deck visual validation (operator
order 2026-07-30, IN FLIGHT, Opus):** operator screenshot shows
one vintage fixture with 6 lit heads (circled) and a
neighboring fixture nearly dark below it + red-dot LED string
bottom-right; "the left front deck is still bad — please use
opus to validate fully with screenshots." EXPLICIT screenshot
authorization from operator overrides the abort-on-contention
default this once — readonly-guarded sessions, strictly no
saves/no output controls, close promptly, contention banner
tolerated (it's his own window). Validate every Left Front
Deck fixture visually + numerically, diagnose "bad" precisely
(dark heads vs size vs halo vs feed), inspected PNGs required.
MID-FLIGHT (13 captures + 3 probe passes, lockdown held):
evidence KILLS the pure-brightness story and partly corrects
the _68 addendum — (1) unpatched fixtures do NOT hold #f07100;
in sacn_in mode paintUndrivenEntry renders them pure RED
(1,0,0)×0.45 = the operator's "red dots"; (2) vintage heads
have literally ZERO glow: globalHaloScale 0.6 makes the halo
(r=0.054) smaller than its own bulb (r=0.055) and
bloomThreshold 0.92 is above any luminance the scene reaches —
bare 0.11 m spheres; (3) U23 live chase peaks at byte 100/255
so LF Rails swing lum 0.017–0.164 moment to moment. Re-capture
w/ chain-order overlay hidden locally (covered ~90% of deck),
then report. **CANCELLED — STOPPED BY OPERATOR (discovered
2026-07-30 ~15:00 on coordinator check-in; will not be
resumed; report _72 never written; number stays burned).** Its
mid-flight findings (above) were all actioned anyway: halo
invisibility fixed by _73/_75/_77; remaining opens from its
diagnosis = the unpatched-red rendering treatment (operator
taste call) + the U23 feed content/level (engine-side, his
call) — both folded into master-doc item 21/23 territory.
**`_73` LANDED 2026-07-30 — Uking par 3× scale + DMX halo rim
fix (resumed _68 agent):** UkingPar (uking_par_10, 47 on
titanic, most numerous + smallest emitter) → 3.0×: can 150→450
mm, bulb r 0.039→0.117, single-pixel so pitch ceiling NEVER
applies (tested at slider max), floor-guard at 3.0. HALO
SHIPPED for all DMX fixtures: root cause = rim sized by
haloScale vs bulb by pixelScale, rim sinks INSIDE the core
whenever haloScale < pixelScale/1.8 (at operator's 1.1/0.6 par
halo = 0.98× bulb — drawn every frame, invisible every frame);
now dmxHaloRimMultiple in led_halo.js = rim MULTIPLE of drawn
bulb, ≥1 at every setting, ≡ historical bulb×1.8 at defaults,
same global knob, _53 pitch ceiling still bounds, LED-bus
untouched (_49 parity suite passes unmodified). This COVERS
the vintage r0.054<r0.055 zero-glow case _72 found (all DMX
fixtures ride the same rim path). FPS GATE PASSED, adapter
verified RTX 4090 (not SwiftShader): census byte-identical
(1735 obj/292 InstancedMesh/zero new), within-session A/B
halos-off 30 vs shipped 30 FPS. Suite 1222/1214/8 zero new.
One authorized capture inspected (par cores ≈35 px @5.7 m =
predicted 0.26 m); stopped at contention banner. Report
202607/20260725_73_uking_par_scale_halos.md. ORIGINAL BRIEF
(for reference): (1) Uking par cans get
3.0× model-wise (housing+pixels), same invariants as vintage
2.5× (physical localPos untouched, drawn-spacing clamp,
floor-guard test); (2) halos on ALL DMX fixtures ONLY if FPS
holds — "High FPS is a must now" — instanced same as
bulb/halo InstancedMesh, obey existing global halo controls,
FPS measured before/after in a fresh guarded browser (adapter
verified per memory), halo half NOT shipped if it hurts,
scale ships regardless. Concurrent: _71 in LED push files,
_72 validating Left Front Deck (both disjoint).
MID-FLIGHT (wrapping up): UkingPar identified (47 on titanic,
39mm head/150mm can) → 3.0× applied (can 450mm, bulb r
0.039→0.117, single-pixel so pitch ceiling never clamps),
floor-guard at 3.0. HALO ROOT CAUSE: halos were never missing
— drawn INSIDE their own bulbs (bulb used pixelScale, halo
used haloScale; at operator's 1.1/0.6 a par halo = 0.98× its
bulb, model scale made it worse). Fixed as rim MULTIPLE of the
drawn bulb in led_halo.js (1.48× at his settings ≡ historical
1.8× at defaults; LED-bus untouched). CONVERGES with _72's
vintage finding (halo r 0.054 < bulb 0.055 — same bug class);
check on landing whether the rim fix covers vintage too. Perf
gate PASSED on verified RTX 4090: object census byte-identical
(1735 objects, 292 InstancedMesh, zero new), A/B halos-off 30
FPS vs shipped 30 FPS. Suite 1222/1214/8 zero new.
**Master-doc "Threads" board (operator order 2026-07-30):** the
master doc now opens with a quick-glance "Threads" section (in
flight / waiting-on-you top-5 / landed-today) — "so I can quickly
see what's going on". COORDINATOR MAINTAINS IT on every
launch/landing/ruling, same discipline as this tracker. Snapshot
orientation rewritten same pass; waiting-list items 19 (gamma W
veto), 20 (sim-server restart for _66 route), 21 (Left Front Deck
verdict pending _72) added; item 15 updated to the _70 re-park
remediation.
**`_74` reserved — vintage-still-bad COLD review (operator order
2026-07-30, IN FLIGHT, Opus, deliberately FRESH agent per "kick
off a new sub-agent cold"):** operator screenshot post-_73:
circled vintage fixture w/ top ~4 heads as SMALL yellow dots,
lower heads dark in oversized housings; big red hexagons nearby
= 3× Uking pars in unpatched-red (proves his session RUNS the
new code). Key operator observation: ONLY Left Front Rails bad
— the only PATCHED vintage fixtures — he suspects lingering
cache, wants instances regenerated quickly. **LANDED 2026-07-30.** Real root cause (coordinator hypothesis
KILLED — driven path only writes instanceColor, never
matrices): the sim draws TWO emitter layers per pixel — the
per-fixture bulb/halo _68 scaled, AND a scene-wide
instanced-dot mesh in animate.js (one InstancedMesh over all
971 titanic pixels) sized from PHYSICAL x/y/z + pixelSize,
never saw fixture_model_scale; the colour flush blacks
unpatched dots and lights only patched ones ⇒ pre-scale dots
visible on exactly the Left Front Rails. CORRECTS _68 addendum
("all 16 identical" probe was accurate but measured
fixture.bulbInst only; _pixelInstancedMesh is module-private,
scene-parented, unreachable from a fixture — it IS a size
bug); in pixel_mapping profile per-fixture emitters aren't
built at all, so the 2.5× was fully invisible there. Fix:
exporter adds runtime-only drawn rx/ry/rz + renderScale
(exported engine model byte-identical — not in saveModelJS
field list); new core/pixel_dot_geometry.js = the ONE drawn-dot
recipe, THROWS on physical-only data; all 3 dot writers in
animate.js (cache build, slider hook, per-frame flush — 3
copies of the same formula) route through it. +8 tests
(patched_fixture_dot_scale), suite 1224→1232/1224/8 zero new.
Proof: readonly capture pair — before reproduces his screenshot
almost pixel-for-pixel, after shows heads filling housings; 0
sACN-OUT enables, 0 save writes, session untouched. OPERATOR:
hard-reload the sim tab = the requested "regenerate"; no
server restart, no cache survives reload. Report
202607/20260725_74_patched_vintage_size_cold_review.md.
**COMMIT (operator-ordered, 2026-07-30 14:12):** `b8b8bca5` on
feat/bm_readiness — `simulation/scenes/titanic/
pixel_map_views.yaml` only (336 lines, his 2D arrangements via
the _66 sidecar; file mtime 14:11 proves he restarted the
server and the auto-save route is LIVE). Security check PASSED
staged + hook. Rest of the dirty tree (incl. his in-progress
scene mapping files) deliberately NOT committed — scope was
"the titanic 2d arrangements". Not pushed (not asked).
**`_75` reserved — Global Halo Size only reaches TE sign
(operator bug 2026-07-30, IN FLIGHT — resumed _74 agent, owns
the emitter-layer map):** "the halo size parameter only
affects the TE sign lights, no LED strands, none of the DMX
lights." **LANDED 2026-07-30.** Root cause PER BUS (live-probed at his
settings, halo 1.4): (1) STRANDS = REACH bug — the
globalHaloScale handler iterated parFixtures+dmxSceneFixtures
and stopped; strands' applyVisualSize never called, halo
frozen at build (0.196 across the whole slider; reload-fixable
before, knob never); (2) VINTAGE+BARS = CEILING bug — DMX halo
was bounded by the OPAQUE BULB's pitch ceiling; multi-pixel
bulbs sit AT that cap, so halo stalled at bulbCeiling×1.8 from
haloScale 1.0 up (he's at 1.4, past the stall — NEVER
reload-fixable, deterministic); (3) PARS were fine (pitch 0);
(4) TE SIGN = the one class both defects skipped (LED-bus
absolute radius, not a strand). Fix: halos get their OWN
looser ceiling (MAX_HALO_PITCH_MULTIPLE=1.5, derived as the
smallest bound letting the knob reach top: 0.3×5.0; inequality
test-pinned so it can't be re-tightened into a stall; _53
opaque-bulb cap intact, halos are ADDITIVE and meant to
merge); DMX halo clamps to the halo ceiling; gui_builder knob
pushes applyVisualSize to strands (strand BULB stays
ledPixelSize — decision item 11 untouched, tested). AFTER,
live-verified 0.1→5 in its own fresh guarded window: strand
0.014→0.700, vintage →0.281, bar →0.0825, par →1.112, sign
→0.700; at his 1.4 all DMX classes = same 2.12 halo/bulb
ratio, nothing held back; caps only touch at slider max=5.
Dot layer has no halo (Pixel Size only); halos exist only in
full/emissive profiles (knob correctly inert in
pixel_mapping/edit/2d). Suite 1232→1237/1229/8 zero new; one
deliberate rule change documented in dmx_halo_visibility's
"cannot smear" test (re-pointed at halo ceiling). NEW item 24:
two knobs still exist — Global Halo Size (global multiplier)
vs LED folder Halo Size (LED-bus base radius) — merge/relabel
is operator's call. OPERATOR: one hard reload to pick up the
new handler; from then on the knob moves EVERYTHING live.
Report 202607/20260725_75_global_halo_reach.md.
**`_76` reserved — orphan fixture flag + removal UI (operator
order 2026-07-30, IN FLIGHT, Opus):** "there are some fixtures
without corresponding generators, please flag those in the sim
and allow removing them one by one or group by group." = the
_51 ghost class (traceGenerated:true, no owning trace,
undeletable via UI — Left Back Wall needed coordinator scene
surgery; 7 Left Center Auditorium ghosts still sitting =
decision-queue item 4 becomes operator-clickable). **LANDED 2026-07-30.** New pure module dmx/orphan_fixtures.js:
orphan ⇔ claims traceGenerated===true (boolean only — string/1/
undefined = unknown provenance, never flagged) AND no live
trace owns its group (keyed trace.groupName||trace.name so
renames never false-positive); unreadable generator list =
THROWS, no scan. LED+DMX one class: walks parLights AND
ledStrands, bus reported never branched. UI: 📐 header "⚠ N
orphaned fixtures" + per-group banner w/ ☑ Select N + 🗑 Remove
N; group folder ⚠ ORPHANED suffix; per-card 🗑 (the control
whose absence forced Left Back Wall scene surgery). Confirm =
enumeration first (controller mapping, live-vs-zeroed patch,
patch-tree, every 2D selector/offset/placement, group
disappearance naming zero-match selectors, model pixel count) →
totals → "RE-EXPORT + SAVE" → question. Four loud refusals,
zero mutations on any; pixel-map removal BEFORE splice; dirty
only, never disk. 64 tests; detector vs real scenes: titanic
6 / test_bench 0 / studiodj 0 false positives. OPERATOR: reload
→ ⚠ 6 (he deleted LCA-5 himself at 14:28) → remove singly or
all → SAVE + re-export → when group empties, drop
'Left Center Auditorium' from ORPHAN_GROUPS (+ the
tuning_verify copy) — tripwire goes red on purpose. Report
202607/20260725_76_orphan_fixture_removal_ui.md.
**COORDINATOR FIX same pass:** the stale "7 ghosts" count pin
in pixel_map_view_defaults.test.js (broken by his 14:28
deletion; ghost counts are operator-owned now that _76 makes
deletion clickable) — count assertion dropped with explanation,
group-exists/not-traced tripwires kept, ORPHAN_GROUPS
deepEqual kept. Suite back to **1311/1303/8** = the 8 known
only. ALL AGENTS LANDED — nothing in flight (only cancelled
_72 burned).
**`_77` reserved — per-fixture local halo scale (operator
ruling on item 24, 2026-07-30, IN FLIGHT — resumed _75 agent):**
"local is maybe a scale for the global" ⇒ effective halo =
class base × Global Halo Size × per-fixture haloScale (default
1.0, absent = 1.0, existing scenes untouched). LED-bus =
ledHaloSize × global × local; DMX = bulb × rim(global) × local;
halo pitch ceiling applies AFTER local (no smear reopening).
**LANDED 2026-07-30.** Three-factor model shipped: effective
halo = class base × globalHaloScale × config.haloScale (one
property name, one resolver resolveLocalHaloScale in
led_halo.js, one "Halo ×" slider 0.1–10 step 0.05 in BOTH edit
surfaces — DMX/par per-fixture folder (which already serves
TE Sign/LED Grid via parLights) AND per-strand folder; bulk
via existing propagateToSelected, no new group machinery).
Absent/1.0 = byte-identical (tested every class), seeds like
diffusionAmount (identity, reaches disk on HIS save);
garbage THROWS naming the fixture; resolver never clamps.
Pitch ceiling runs AFTER local (bar pins 0.0825 / vintage
0.28125 at ×10, exactly at never past; pars linear, no
ceiling). Live path: syncFromConfig now refreshes bulb/halo
matrices (it only did cones — a config halo would never have
reached screen); zero per-frame cost. Live-verified ×2 doubles
all six classes, 0 enables/0 saves, keys restored. +10 tests;
suite 1298/1289/9 (the 9th = the stale "7 ghosts" pin in
pixel_map_view_defaults.test.js, orphan-side, not halo). Item
24 RESOLVED by design; item 25 added. Flagged not taken:
fog/haze shows Halo × but renders no halo in any profile
(uniformity per order; one line to hide); NO LED-bus pitch
ceiling added (against brief line — _49 pins sign halos merge
by design; one line if wanted). Report
202607/20260725_77_local_halo_scale.md.
**`_78` reserved — halo color on patched pars + missing DMX
halos (operator bug 2026-07-30, IN FLIGHT — resumed halo-owner
agent):** post-reload screenshot: (1) patched pars (currently
dark in the pattern) show an EXTRA RED halo ring around black
housings — suspicion: halo instanceColor never gets the driven
per-frame update (only bulbs do), so halos keep construction
color (unpatched-red/config); invisible for years while halos
sat inside bulbs, exposed the moment _73/_75 made them
visible; (2) RESOLVED by operator seconds later: "sorry I was using the
LED halo size not the global one" — knob mix-up. **`_78` LANDED
2026-07-30 — VERDICT: THE RED IS NOT A BUG.** Color-path
hypothesis DISPROVED by probe: _writePixelColor writes bulb +
halo + cone in ONE call, 0 mismatches across all 40 pars (both
witnesses in the same pass). The red has two legitimate
sources: (a) the roof-edge row is UNPATCHED — only 8 of 40
pars carry patches — and paintUndrivenEntry paints undriven
red per the operator's OWN 2026-06-12 ruling ("red, not
black"; #730000 = (1,0,0)×0.451 exact); OPERATOR BELIEVED that
row was patched — mapping-state discrepancy surfaced to him;
(b) the patched auditorium par is GENUINELY orange-red — live
frame [dim 100, R63, G27, B0] ⇒ #0b0500 exact. The ring is new
only because _73/_75 moved the rim from 0.98× (inside the can)
to 2.12× (outside). No color/halo/sACN code changed. NEW item
26: three unpatched-indicators exist, two obey his "Show
Unpatched (Red)" toggle (currently OFF), paintUndrivenEntry
does NOT — leave/gate/bulb-only = his ruling to make (agent
refused to silently undo 2026-06-12). UX hardening shipped:
"LED Pixel Size (LED only)", "LED Halo Base (LED only)" +
reach tooltips on all four size/halo controls (code-side;
common.yaml untouched). +5 tests (halo-follows-bulb per class,
undriven red reaches both layers, halo material white, perf
P0 50-recolour). _79 Fable independently corroborates: 4/4
verification points PASS, 0 color mismatches in fresh session,
0 red-ring signatures — convergent. OPERATOR ITEM 4 CONFIRMED
DONE (he deleted the Left Center Auditorium ghosts himself) —
**coordinator dropped ORPHAN_GROUPS to [] in
pixel_map_view_defaults.js + tuning_verify.cjs + test
assertion (the designed _51 Trap-3 follow-up); suite
1316/1308/8 = the 8 known only.** Report
202607/20260725_78_halo_driven_color.md.
**`_79` reserved — DMX halo independent double-check (operator
order 2026-07-30, IN FLIGHT, FABLE per explicit model call
"double check quickly by a fable agent"):** **LANDED 2026-07-30 (lean per P1.5 scope note).** All PASS at
his settings: par halo 0.4713 = 2.12× bulb, tracks knob, no
ceiling; bar 0.03498, cap 0.0825 exactly at max (confirms
_75); vintage 0.11925, cap 0.28125 at max; local Halo × exact
linear on par+vintage; LED "Halo Size" isolation holds (DMX
byte-identical). _78 blast radius NOT reproduced (76 fixtures
× every pixel, 0 mismatches, 0 ring signatures) —
independently corroborates _78's disproof. **NEW FINDING (what
the wave missed): the ring impostors are TRACE GENERATOR
PREVIEW DOTS** — opaque r=0.3 spacing-gradient dots
(blue→green→RED #ff4422) + r=0.4 #ff4400 end handles, drawn in
the FULL beauty profile because generatorsVisible defaults
true; a bar's midsection swallowed by a dot 8.6× its halo, a
stretched-spacing par wears a literal red ring. A/B proven:
hide haloInst → disk stays; hide trace dot → ring gone
(screenshots 1785449480_dhdc2_*). Source: gui_builder
buildTraceObject ~3396/3414/3423, default ~4990. DECISION owed
(new item): gate trace visuals out of full/emissive, or
default generators OFF outside edit — meanwhile the manual
toggles (Show Generators / Show Chain Order, both ON in his
screenshot) clear it today. 10 screenshots inspected, 0
source files changed, guards clean. Report
202607/20260725_79_dmx_halo_doublecheck.md.
**`_80` reserved — sort instance + generator lists by name
(operator minor order 2026-07-30, IN FLIGHT, Opus):**
**LANDED 2026-07-30.** Six lists natural-sorted at render time
(Light Instances groups + fixtures within, Group Generator
cards, DMX Instances, LED Generators buttons, LED Instances
strand groups + strands within; both "→ Move…" pickers
follow). Ungrouped pinned last, TE Sign groups pinned above
strands (sorted among themselves). Display-only PROVEN: copies
sorted at render, source arrays identity+order untouched
(chain/patch/model/YAML byte-identical on save), rows carry
real source index (folders/click/flyTo all index-keyed); two
source-position readers deliberately kept (generated-name
ordinal, group-delete reassignment) — test-pinned. Shared
natural_sort.js + new non-mutating sortByNameNatural helper;
localeCompare asserted ABSENT from gui_builder. +19 tests
(hostile synthetic scene + wiring scan of all 6 call sites);
suite 1316→**1335/1327/8** zero new. Operator sees order on
next reload; saves byte-identical. Report
202607/20260725_80_menu_name_sort.md. **ALL AGENTS LANDED —
nothing in flight.**
**`_81` reserved — kill the red par halos (operator escalation
2026-07-30, IN FLIGHT, Opus):** "the par lights still have the
halo red shit! and it's the Left Auditorium I am looking at
now." Coordinator reads this as the ruling on both pending
items: red rings must leave the beauty view. Agent orders: (1)
live-diagnose which source paints Left Auditorium pars NOW
(undriven-red vs genuinely-red frames vs trace dots); (2)
implement: paintUndrivenEntry obeys the existing "Show
Unpatched (Red)" toggle (currently OFF ⇒ reds gone; his
2026-06-12 diagnostic preserved BEHIND the toggle, not
deleted) = item 26 resolved toggle-obedience; (3) gate
trace/generator preview visuals OUT of full/emissive beauty
profiles by default (toggles still work in edit contexts) =
the _79 decision resolved; **LANDED 2026-07-30 — THE COMPLETE MECHANISM, operator was
right to keep pushing.** Live probe found ALL THREE sources in
his one view, plus the piece _78/_79 each missed alone: Left
Auditorium 1-8 ARE patched (U8/U6) and genuinely driven [dim
100, R47, 0, 0] = red pattern content; Right Auditorium 1-8
beside them are unpatched #730000; and EVERY par wore a trace
dot at distance ~0 — the OPAQUE r=0.3 dot COVERS the r=0.2223
bulb, leaving the additive r=0.4713 halo as an ANNULUS ⇒ a
red-driven par rendered as a RED RING around a MINT-GREEN
DISK. That exact shape is what he kept reporting; "not a
render bug" was wrong twice because each investigation held
only part. FIXES: (1) item 26 → toggle-obedience:
paintUndrivenEntry obeys "Show Unpatched (Red)" (OFF ⇒ black
on bulb+halo+dot, ON ⇒ 2026-06-12 red byte-identical;
anti-bleed untouched; demapSacnToPixels THROWS on missing
toggle arg; mid-session flip repaints next frame); (2) _79
decision → new src/gui/trace_visual_gate.js: trace visuals
default OFF in beauty profiles (emissive/full flagged
beauty:true), ON in working profiles, explicit Show Generators
flip outranks default anywhere; common.yaml untouched. LIVE
before→after on his stack: trace visuals in full 114→0;
Right Auditorium #730000→#000000 (still flagged undriven);
Left Auditorium untouched — WILL STILL GLOW RED-ORANGE, that
is the pattern's light (engine-side question if unwanted).
Suite 1335→1353/1345/8 zero new. Follow-up chip filed
(pre-existing): plain scene load marks scene dirty via
generateGroupFromTrace→debounceAutoSave during GUI build.
Report 202607/20260725_81_undriven_red_gating.md. ALL AGENTS
LANDED — nothing in flight.
**`_82` reserved — unpatched right-par halo leak (operator bug
2026-07-30, IN FLIGHT — resumed _81 agent):** "big leak, the
par light halos on the right side are being mapped, but they
are not patched, please fix!" Post-_81 an unpatched par must
be dark on EVERY layer under toggle-OFF, yet right-side halos
show lit/colored. **LANDED 2026-07-30.** NOT index bleed (80 fixtures × every
layer probed: 42 unpatched, 0 lit — _81 gate holds; drive-left
never touches right). The leaking "writer" = the ANALYTIC
SPOTLIGHT POOL: fixed camera-proximity slots that never asked
if a winner was emitting — 36/60 slots (60% of the analytic
budget) held by pure-black unpatched right-side fixtures,
EVICTING the patched left ("mapped" was literal; in full
profile that spotlight casts the visible light pool on the
hull — the "halo" he meant, far larger than the halo mesh).
RETRO-EXPLAINS the whole 3-round red-halo saga: pre-_81 those
36 slots held RED spotlights (undriven (1,0,0)) — red light
pools answering no halo knob. Fix: new
core/analytic_light_gate.js — max(r,g,b) ≥ 1/255 to compete;
emission-based not patch-based (blackout patched fixtures
also freed), identity-preserving, rebuilt per frame, red
diagnostic legitimately takes slots when toggle ON, malformed
colors throw. Ruled out + recorded: index bleed, later halo
writer, prio-150 writer, getSafeLightColor. Pool after:
60/60 patched-emitting, 0 dark. TOGGLE (operator-revised):
"Show Unpatched (Red)" now in Lighting Controls → Options AND
fixtures panel — ONE function, ONE param, both .listen(),
live-verified both directions, his OFF restored. Suite
1361→**1366/1358/8** (+13, zero new; incl. the measured leak
replayed as test data). AFTER RELOAD: the ship is LIT — 60
slots on the patched side, broad amber pool where there was a
thin wash; right stays dark (unpatched). Report
202607/20260725_82_unpatched_halo_leak.md. ALL AGENTS LANDED.
**`_83` reserved — generator move must carry its generated
fixtures (operator bug 2026-07-30, IN FLIGHT, Opus):** he moved
the Left Small SmokeStack generator; the generated lights did
NOT follow live, and after refresh they were "way off" (worse
than not moving — suggests live-vs-reload compute different
positions; stale offset or double transform). Task: make
moving an already-generated AND PATCHED trace re-place its
owned fixtures correctly — live follow + reload-stable —
preserving patches/names/chain/2D references (sticky-by-name
discipline). Operator: "it's tricky I think, but if we get it
right, it's great."
**`_84` reserved — Fable sanity check of _83 (operator order
2026-07-30, QUEUED behind _83):** "when done, have their work
validated on a quick sanity check by a fable agent… not too
much time, just sanity check the workflow." **LANDED 2026-07-30 — VERDICT: PASS** (lean, ~4 min). Suite
1391/1382/9 confirmed, 25 new tests pass; trace_anchor.js pure
?? throughout, `trace.y || 5` gone (only cosmetic `aimX || 0`
where default=0 ⇒ ||≡??); "generation never touches scene
graph" holds (one hair-overstatement: buildTraceObject reads
grp.matrixWorld for the initial aim visual but on a
freshly-placed group — not the stale class); disk scene
matches the self-consistent y=0 state; scene mods predate _83;
sticky-by-name pin present. **9TH SUITE FAILURE IDENTIFIED =
operator-scene drift, not code:** pixel_map_view_defaults:487
"compression threshold headroom" — his Left Small SmokeStack
x-move left the smallest Top-Down collapsed band at 5.20 vs
the 5-unit compressor threshold (guard wants ≥7.5). LEGITIMATE
MARGIN WARNING: one more inward nudge could tear a side of the
Top-Down view. Operator call: nudge generator x outward OR
retune the pin. Report 202607/20260725_84_generator_move_sanity.md.
ALL AGENTS LANDED — nothing in flight.
**`_85` reserved — controller-pane UNMAPPED tray layout fix
(operator order 2026-07-30, IN FLIGHT, Opus):** screenshot
shows the 💾 Save Configuration button OVERLAPPING the
unmapped-fixture chips mid-tray (z/position collision), chip
rows crowding the help text, tray cramped under 3 MarsinLED
cards. **LANDED 2026-07-30.** Root cause: NOT absolute positioning —
the Save button was a bare flex item with no reserved space;
.cm-tray was shrinkable below content (min-height:0 under
user-sized/collapsed) with overflow:visible + a hard 40px chip
floor; _65's taller gamma cards pushed #cm-body into negative
free space ⇒ tray shrank, chips painted through the border,
later-DOM Save row drew on top (operator's defect-3 hunch
exactly right). Fix: .cm-footer anchored toolbar (flex 0 0
auto, separator — main scrolls and tray clips first); tray
overflow:hidden + min-height:0; chips flex 1 1 auto (40px
floor gone, scrolls instead of forcing); docked pane tray
min-height 96px; gaps/align; filter width to class (150px
docked); hint own spacing. Probe run 1 caught its OWN
regression (hint shrink made Save row hop 34px between
collapse states) — fixed, run 2 constant-y. Live-verified
geometry: overlap 0px expanded AND collapsed, chip escape 0px,
_50 wave intact (collapse/2-row header/keep-out/sort, 6 filter
keystrokes in 1ms). Suite 1391→**1403/1394/9**, failure set
byte-identical (8 known + operator margin tripwire). Flagged
NOT mine (task chip filed): pane re-renders once async after
open — suspect Show Unpatched .listen() onChange calling
refreshControllerMapPanel (gui_builder:1659). Report
202607/20260725_85_unmapped_tray_layout.md. ALL AGENTS LANDED.
**`_86` reserved — auto-sync 📡 Subscribed Universes from
controllers on save (operator order 2026-07-30, IN FLIGHT,
Opus):** the manual field (= the colorWave.sacn_universes
override that boot-feeds the bridge receiver; stale ⇒ silent
packet drops ⇒ "off lights", the _58 §7.1 trap) shall update
automatically on controller-pane save: compute universes
actually used by controllers/patches, show YES/NO/CANCEL
popup with the old→new diff (operator asked for exactly
this), yes = update+save, no = save unchanged, cancel =
abort. Complements S3/_60 (runtime addUniverse, still inert
until bridge restart) — this fixes the BOOT list.
**LANDED 2026-07-30.** Gate lives in exportConfig() itself
BEFORE saveModelJS (Cancel = truly nothing on disk) ⇒ one
behavior for controller-pane 💾, Lighting Controls 💾, and the
LED push's scene write. Required set = computeProjection
universeMaps ∪ computeLedUniverseClaims incl. spill ∪ declared
DMX+LED port rows even unpatched ∪ parked (_71) ∪ patches.yaml
records — reused helpers, no new scanner. Covered ⇒ silent;
missing ⇒ push-flow-skin modal "1,2,3 → 1,2,3,27,30" + "+U27 —
LeftLeftRopes port 2 → output 2" per addition; never removes
(extras = FYI line); Escape=Cancel; caveat verbatim "takes
effect at the NEXT sACN bridge start". exportConfig({
interactive:false}) for the 2s debounce timer only (warning,
not modal). Derive failure ⇒ SAVE ABORTED loudly. **BONUS
FINDING: the bridge parser has NO range syntax — a hand-typed
"1-24" subscribes U1 ALONE**; now a loud finding instead of 23
dark universes. Field persists via existing save-server path
(common.yaml operator-owned, no new writer). New
dmx/subscribed_universes.js (pure) + gui/
subscribed_universes_prompt.js; +30 tests; suite
1403→**1433/1424/9**, failure list byte-identical (8 known +
margin tripwire). Report
202607/20260725_86_subscribed_universes_autosync.md. ALL
AGENTS LANDED — nothing in flight.
**`_87` reserved — no-restart universe subscription end-to-end
(operator order 2026-07-30, IN FLIGHT, Opus):** he had to kill
+ restart the launcher to get new universes accepted; wants
this restart-free. KEY FACT: that restart put S3/_60's runtime
addUniverse code INTO the running bridge for the first time —
so the machinery for restart-free now exists live. Agent:
trace + close every gap in the live chain (controller-pane
save → notify → recomputeRoutes → runtime-subscribe → frames
flow, NO restart): does every save path fire the notify? does
the S3 union cover universes newly added by _86's dialog (the
sacn_universes FIELD itself is boot-read — mapped/patched
universes ride the union; verify unmapped-but-subscribed
extras aren't needed); update _86's "takes effect at next
bridge start" caveat if now wrong; operator acceptance = next
mapping save shows "runtime-subscribed U…" in the bridge log
with zero restarts. NOTE: bridge item 16 is now DONE
implicitly (his launcher restart activated S3 + new boot
list).
**LANDED 2026-07-30 — RESTART-FREE IS TRUE END-TO-END.** Save
writes patches/common atomically BEFORE the 200, notify chains
on the awaited 200, bridge setScene handler re-reads BOTH
files per recompute ⇒ receiver subscribes before senders diff.
His restart was one-time (running bridge predated S3; restart
activated S3 + wide boot list at once — looked recurring,
wasn't). TWO genuinely restart-bound gaps found + fixed: (A)
THE REAL FIND — LED strand SPILL segments invisible:
readSceneRoutePairs read only patch.dmxUniverse (start), not
segments[] past ch512 — a 200px RGBW rope at U30 got
route+subscription for U30, NOTHING for U31 ⇒ pixels 129+
dark, log green, restart-PROOF (boot scan had the same hole);
no strand long enough today but his rope mapping heads
straight at it; fixed via patchRecordUniverses/
readPatchDeclarations in bridge_routing.cjs used by BOTH boot
scan and runtime diff. (B) _86 field boot-read only → now
re-read in recomputeRoutes through ONE parser shared with boot
+ pinned token-for-token vs the browser parser; "1-24" range
trap now warned. Dialog wording → "✅ Takes effect IMMEDIATELY
on save — no bridge restart… watch for runtime-subscribed U…
then First frame on U…". Acceptance: map → 💾 → Update+save →
launcher terminal shows runtime-subscribed → Route created →
First frame; if first appears without second, nothing is
SENDING (engine/model side). Proof: real sacn_bridge.js in a
throwaway process w/ faked sacn/ws (no port/multicast/datagram,
live bridge untouched) against real titanic files incl.
narrow-boot→wide-after harness: "runtime-subscribed U999 (📡
field)". Suite 1433→**1452/1442/10** (+19, failing list
byte-identical; 10th = ANOTHER operator-scene drift —
test_bench mapping-defect pin gone red from his scene edits,
clears with the owed re-export). Item 16 DONE. Report
202607/20260725_87_no_restart_subscription.md. ALL AGENTS
LANDED — nothing in flight.
**COMMIT + PUSH (operator-ordered, 2026-07-30 18:53):**
`3246deb2` "BM readiness wave" — ALL 441 changed files (185 M,
244 new incl. reports _47–_87, engine states residue per
operator's "all"), + follow-up commit removing a stray 0-byte
`{}` tool-residue file; pushed to origin as NEW branch
feat/bm_readiness. Security check: first run FAILED on 2 full
IPs in the fresh _87 report → coordinator redacted to
10.x.x.60 → PASSED (441 files). **OPERATOR RULING recorded:
scene config files (scenes/**) are OK to carry controller IPs**
(the checker already tolerates them; the redaction convention
applies to .agent/ prose, not scene data).
**`_88` reserved — master-doc compaction + archive (operator
order 2026-07-30 end-of-day, IN FLIGHT, Opus):** "clean up the
project file, compact it a bit, KEEP THE THREADS, get ready
for new threads tomorrow; move the compacted data to a report
in the .agent." **LANDED 2026-07-30.** Master doc 3,651 → 321 lines; archive
20260725_88_master_doc_archive.md = 3,735 lines, byte-range
verbatim moves (redactions preserved, no IP reintroduced),
9 sections mirroring doc order, empty Log ready for tomorrow.
Open items settled w/ original numbers: 2,3,5-14,15(=18+22
merged one-push),17,19,21,23,25 + NEW 27 (Top-Down compression
margin _84); decisions 5,6,7,9,10,12 open. VERIFIED RESOLVED
(checked, not assumed): 1 — Bind WAS pressed (controllers.yaml
carries device: controllerId testbench on LeftLeftRopes!), 4
(ORPHAN_GROUPS=[]), 16, 20 (launcher restart served _66 route;
pixel_map_views.yaml in b8b8bca5), 24, 26. Gitleaks direct
scan of both files: no leaks. Coordinator committed after.
Next free report after reservations: `_89`.
**`_48` ADDENDUM 2 LANDED (2026-07-29) — 2D defaults name-drift
repair (recurrence #3):** operator's 13-generator rename batch
staled CHIMNEY_GROUPS[0] (→'Left SmokeStack') and
FRONT_VINTAGE_GROUPS[0] (→'Left Front Rails'); left ring + left
front vintage restored; ALL 16 hardcoded names audited against
his 16:54:30 save (0 stale; ORPHAN_GROUPS untouched — gated).
BONUS FIND: 'TE Sign 2' silently swallowed by fixtureType-only
te_sign selector — panel blew to 2.69×/11.07× canvas (off-screen);
fixed one-panel-per-sign (group AND type), both quarter-turned.
Tests re-pointed AND de-treadmilled: back-of-ship reference
points now found STRUCTURALLY (trace-backed same-type groups by
sign of mean x) instead of by literal name; new pins catch any
retired name in any default view + a third sign. ROOT HOLE named:
resolvePanel only errors on TOTAL zero-match — per-selector
staleness is silent; RECOMMENDED durable fix = per-selector
zero-match sweep at pixel-map open, loud banner w/ named line
(~2-4h; +1h optional rename-time warning); live-derived defaults
(1-2d) not first move; alias layer REJECTED (silent migration).
OPERATOR DECISION added to master doc: pick durable option.
Suite 980/972/8 (4 reds green, zero new; baseline moving as
other agents land). NEW GUARD 4 in capture harness:
window.__readonlyMode accessor pre-page-script — sACN output
client provably never enables during agent captures (0 enable
lines/run) while Pixel Map still mounts. Recaptures inspected
(dark = his rig unlit, not regression; header 100 fix·1061 px).
_51 correction: orphan tripwire NOT dead (traces list is YAML
anchor+alias shared); hardened anyway.
Next free report after reservations: `_53`.

**RENAME READINESS ANSWER GIVEN (2026-07-29):** unmapped renames
are safe NOW (RightSmokeStack precedent); hold mapped/test_bench
renames until `_47` lands; "Left Back Wall" still blocked by the
12 orphans (operator fate decision pending). views.yaml carries
stale pre-rename keys (Left Back Wall Generator, Left Top Chimney
Generator) — harmless leftovers, flagged.

**MANUAL SCENE FIX (coordinator, operator-ordered, 2026-07-29):**
operator hand-renamed the LEFT FRONT WALL trace (name+groupName)
→ "Left Front Wall" in scene_config.yaml but fixtures/patches/
views still carried the old name (half-state = new-orphan risk).
Coordinator completed it: 5 fixtures (group+name), 5 patches.yaml
keys (all zeroed — unmapped, per invalidate ruling nothing to
migrate), views.yaml bit 64 key. Verified: 0 old-name refs
remain; 12/5/1 new-name refs. models/titanic.js still stale
until his next sim-save (expected). NOTE: his original ask was
about LEFT BACK WALL — that rename remains blocked by the 12
orphans ("Left Back Wall 1-5" + "Left Center Auditorium 1-7");
his decision pending: junk to delete, or real lights to rename?

**ORPHANED GENERATED FIXTURES FOUND IN LIVE TITANIC SCENE
(coordinator, read-only, 2026-07-29)** — operator's rename of
"Left Back Wall Generator" → "Left Back Wall" was REFUSED
("group exists") though he has no such generator. Cause: 12
trace-generated fixtures whose owning trace no longer exists:
"Left Back Wall 1-5" (ShehdsBar 18px) + "Left Center Auditorium
1-7" (UkingPar 1px). Census: 17 fixture groups vs 14 trace
groupNames; 3rd extra = "TE Sign" (traceGenerated:false =
legitimately hand-placed, not an orphan). Orphans are unmapped
(addr 0) but hold 12 patches.yaml entries and ~97 real rendered
px inside titanic's 977 — they INFLATE the Phase B unmapped
countdown with phantoms. Fed to `_44` planner: needs (a) a named
orphan check in the `_35` validator, (b) rename path that can't
create orphans, (c) LOUD operator-driven cleanup for the
existing 12 — never silent deletion (his scene data, freshly
saved; only he knows if they're junk or lights wanting a
rename).

**OPERATOR RULING (2026-07-29): rename → mapping INVALIDATED,
loudly.** "When renames happen, check the mapping and invalidate
them too" — old-name patch/metadata entries must never linger as
phantoms NOR silently carry to new names; rename leaves entries
honestly unmapped (validator shows unmapped, not drift) with a
fixture-by-fixture loud report. Silent migration forbidden; an
explicit opt-in "migrate addresses" affordance may be OFFERED in
the `_44` plan as an option only. (Live specimen on file: his
RightSmokeStacks rename verified clean across all 5 surfaces —
but that was the unmapped case.)

**Landed 2026-07-29 — chain-order 3D viz (Opus, `_43`):** with
Show Generators on, every visible trace draws its CABLE: one
colored polyline per split in daisy-chain order, comet ramp +
arrowhead per step, dashed grey inter-run hops, chain-number
label per light tinted to its run (operator's case reads
5·4·3·1·2 front-on, violet/magenta/cyan per _41 §4). New
"⛓ Show Chain Order" switch under Show Generators (default on,
runtime-only, never reaches scene files). Live refresh off
refreshChainStatus (steppers per tick, add/remove/swap/
regenerate). Invalid splits draw NOTHING (red card badge stays
the loud channel — a plausible-but-false chain = forbidden
fallback in picture form). Cost: +90 objects on titanic while
trace editor open (12 LineSegments + 12 InstancedMesh + 66
Sprites, ~6% bump — hence the switch), EXACTLY 0 hidden
(build-on-show/dispose-on-hide, census-proven via
userData.isChainViz walk); zero per-frame allocs (hoisted
scratch). New pure module src/dmx/chain_order_visual.js + 26
tests + agent_tools/chain_order_viz_verify.cjs harness;
gui_builder.js wired. Suite 805/802/3 — zero new fails; 3rd
pre-existing fail identified = STALE models/titanic.js (981 px
vs scene's 977: operator's uncommitted chimney 10→8 edit
orphans Chimney Generator 9/10 + unpatched-marker gap on
Left_Front_Left) → clears on a TITANIC sim-save, alongside the
test_bench save already queued. Screenshots ~/tmp/chain_viz/
(04 front-on sent to operator). Next free: `_44`. **DEFERRED, needs
his call:** (a) group-level "+ gen (numeric order)" bulk-add —
the step that cashes in the prospective half, touches the
2026-06-11 "no group-level add" ruling; (b) chain-number sprite
labels on preview dots; (c) order-vs-addresses `warning` check
(left out on purpose — would fight legal manual address pins);
(d) "⟲ Remap group in chain order" tool (probably unnecessary
now). Notion cards for (a)–(d) + the chainSplits-vs-trace.splits
vocabulary reconciliation (`_41` §1.6) NOT FILED — no Notion MCP
tools in that session. No git ops. Next free report: `_43`.

**Landed 2026-07-29 — 2D pixel-map layout tweaks (Opus, `_40`):**
the "stranded dot rings" were the two 10-par chimney groups being
re-normalized into a separate weight-1 `radial` "Smoke Stacks"
panel — the pars were ALREADY physically inside their strand fans
(probe: left ring x −24.9…−19.7 within strands −31.5…−13.5). Fix
= top_down is now ONE `spatial` panel (bars + strands + both
chimney groups); stacks panel deleted (spatial = true world
projection → rings land at cluster centers with nothing to sync;
per-fixture 2D override REJECTED — would hand-place 20 pars
copying a truth the projection computes). ShehdsBar glyph 13→17
(+31%, all rotations, zoom-scaled); UkingPar 24→13 on top_down
only via existing per-view typeStyles (donut fusion at ship
scale). Persists via params.pixelMapViews. Free win: deleted
panel kills the red "no fixtures match" banner eating a quarter
of the test_bench pane. Screenshots (RTX 4090, integrated:false,
fresh browsers, closed): ~/tmp/pixel_map_2d_tweaks/
before/after_titanic_top_down_*, test_bench pair, front sanity —
titanic before/after full sent to operator. Suite: pixel-map
65/65; sim 721 w/ ONLY 2 fails = pre-existing parity-drift test
(see below). OPERATOR ACTIONS: reload the 2D view (src from
disk). DRIFT FLAGGED (not _40's, needs operator): opening
test_bench re-exported models/test_bench.js → sign renumbered
sId 7/fId 13,14 while patches.yaml still holds old ids →
drift/metadata_drift ×2 (= the 2 sim-suite fails). Same
resolution as the queued _34 action: ONE proper sim-SAVE on
test_bench (rewrites patches.yaml atomically), then
`node simulation/tools/scene_model_parity.cjs test_bench` until
green. Left unrepaired deliberately (id ownership = R8 call;
model file carries uncommitted operator work).

**Landed 2026-07-28 late — GPU adapter visibility fix (Opus,
`_39`; closes the FPS thread `_38`):** zero rendering changes —
new src/core/gpu_adapter.js + low_fps_alarm.js +
gui/gpu_adapter_warning.js, 9-line boot block in main.js, one
branch inside the existing 1 Hz FPS-badge block in animate.js.
On integrated GPU: unmissable red top banner (verbatim adapter
name + "discrete GPU is idle" + the Windows Graphics fix steps +
chrome://gpu verify), red boot console line, and a fire-once
[LowFPS] error after 10 consecutive seconds <20 FPS naming the
adapter (also fires on the CORRECT GPU when something else steals
it — leftover probe windows). window.__gpuAdapter exposed; ops
rule added to sim_auto_checks.md + see_the_world.md (record
adapter next to every FPS number). Live-proven both adapters:
4090 59.9 FPS/no banner; Intel-pinned 15 FPS/banner+both errors;
screenshots inspected; both probe browsers closed. Sim suite
698→721/0 fail (23 new tests). Honest gaps in _39 §5: SwiftShader
not banner-flagged (LowFPS still fires), discrete Intel Arc would
false-flag, ==20 FPS doesn't trip (<20 strict), adapter read once
at boot; star-field randomization makes byte-identical PNG proof
impossible (diff-scope + screenshots instead). OPERATOR ACTION
(one-time): Windows Settings → System → Display → Graphics → Add
desktop app → chrome.exe → High performance → Save → restart
Chrome → chrome://gpu shows NVIDIA ACTIVE; avoid battery-saver.
:6971 bridge zero-frame side finding STILL OPEN (chip filed,
operator not yet answered on launching it).

**Landed 2026-07-28 — param truth sweep results (`_32`):** 817
params / 125 patterns swept in 183 s offline (5 points × 144
frames in the real WASM VM, sharded, no ports). TRUE 548 (67.1%) ·
DEAD 170 · WRONG 39 · UNKNOWN_CLAIM 35 · WEAK 25. HEADLINE: 137 of
170 DEAD = ship-model gap (white/blinder controls gated
sectionId==2; all 981 titanic px report sectionId 0 — measure TRUE
on test_bench; R8 mapping revives all 137 at once); 9 buried by
shipped defaults; only 25 hard-dead. REAL curator punch-list = 73
params (8.9%). Source-confirmed worst: 22_abyssal_sway_garden
sliderBaseDarkness INVERTED (glowFloor = 0.04 + baseDarkness*0.08
— "darkness" adds light); 13_sparkle sliderAmberGlint KILLED by
the `_26` lane-match (a = clamp01(w) overwrites it — fix must
modulate w AND a together, w==a preserved); 05/17 blinder pairs
gated behind kick which ships 0. Top WRONG also: 08_ocean_liner +
07_shimmer sliderRadius, 62_white_shimmer + 09_cyclone
sliderDirection, 29_kick_shockwave sliderRingWidth, 13_sparkle
sliderSparkleIntensity. 4 measurement gaps fixed mid-run
(transition progress pinned 0 → 10 false DEADs; direction
min/max; contrast; black-pixel darkness). Rerun:
`cd marsin_engine && node tools/param_truth/sweep_all.mjs`
(disk-discovery — survives curator migration). CI smoke 7/7 ~2s.
IMPORTANT META-FINDING: the "known-8" engine-suite bar is NOT
real — ANY added test file (proven w/ 3-line no-op) tips a
timeline test into ~2/5 flaky fail via a node test-runner IPC bug
(Unable to deserialize cloned data, inside node's FileTest.
parseMessage). Agents adding tests will look like regressors;
follow-up filed. Punch-list handed to curator via operator.
- **RETIRED in-flight header (see landed digest above) — param
  TRUTH sweep (Opus, `_32` reserved,
  20260725_32_pattern_param_truth_sweep.md) — IN FLIGHT
  2026-07-28:** operator order "sweep the parameters and make sure
  they do what they say for all patterns." Offline behavioral
  harness in marsin_engine/tools/param_truth/ (reuses the
  white_amber_lane_match headless render machinery): per (pattern,
  param) sweep low/default/high → measure temporal freq (speed),
  sign reversal (direction), hue stats, luma, spatial stats →
  classify TRUE/DEAD/WRONG/WEAK/UNKNOWN-CLAIM, explicit
  thresholds. Disk-discovery based (rerunnable after the curator's
  migration renames), machine-readable results + worst-first
  report + small CI smoke. Does NOT modify patterns (curator
  territory); live stack untouched. Operator also declared
  standing need: multi-agent workflows for certain large
  refactorings (explicit opt-in noted). Next free: `_33`.

**STANDING ORDER (operator, 2026-07-28 evening): NO future
dates/deadlines in tracked files** — the repo is public. Dated
schedule planning lives in gitignored `.agent/reports_local/`
(README there has the rules; status files named
YYYYMMDD_status.md, newest wins, prunable). Tracked docs record
what/why only, never when-by.

- **VSN1 MIDI attach/detach DEBUG (Fable, `_30`,
  20260725_30_vsn1_midi_attach_debug.md) — LANDED 2026-07-28,
  diagnosis complete, fix plan ready for the Opus fixer (`_31`;
  operator order: launch on plan arrival without re-asking):**
  RC1 overflow = **CRLF bug, not content**: grid_serial.cjs
  stripLineComments (:606) regex can't strip comments from
  \r-terminated lines; working-tree .lua templates are CRLF
  (core.autocrlf=true, index LF, no .gitattributes) → comments
  survive into the single-line action → encoder INIT = 5960 vs
  904/909 in the July-15 LF dump (same templates, same
  grid-protocol 1.20260615.942). Reproduced offline exactly,
  layout-independent, thrown PRE-serial at the first compiled
  element; 6/9 templates overflow under CRLF; surviving `--` +
  newline-collapse would comment out the WHOLE flashed script yet
  pass checkSyntax (silent dead-Lua hazard — the overflow saved
  the device). RC2 abort = **NOT the deploy child** (21/21 clean
  exits incl. byte-exact engine invocation vs fake engine on an
  ephemeral port), **not causally linked** to the overflow (engine
  survived it live 07-25; all engine rejections caught; engine +
  launcher have ZERO native addons so async.c:94 is only reachable
  during handle teardown) — teardown-race candidates ranked:
  engine-exit with live handles (unclosed fs.watch engine.js:1578,
  child pipes) whose abort code the launcher then treats as crash
  → teardown(1) + force-kill-all = "whole stack down";
  launcher's own execFileSync at restart moments; rare child-exit
  timing. Deploy churn (deployOnBoot:true in committed config →
  doomed deploy 1.2s into EVERY boot + every effect change) is the
  omnipresent last-line-before-crash red herring AND the trigger
  environment. Attach detection today: NONE (config gate only;
  device probed only deep inside the flash child). 12-step plan in
  `_30`: CRLF fix + comment-survival guard + .gitattributes +
  3-ending budget test w/ headroom, probe-child attach state (ONE
  loud line per transition, skipped-detached status, neutral
  CaptainPad badge), survival tests (child abort mid-drain, device
  vanish mid-burst), teardown hygiene, bounded launcher
  auto-restart on abort-class engine exits (**needs operator
  sign-off, `_30` §7** — plus: which process printed the assert
  ([engine]-prefixed / embedded in the FAILED blob / bare), does
  :6968 answer post-crash, launcher or bare engine). Repro scripts
  in ~/tmp/vsn1_debug/. Next free after reservations: `_32`.
- **Gamma UI + fleet push (Opus, `_29` reserved,
  20260725_29_gamma_ui_fleet_push.md) — LANDED 2026-07-28:** LED
  controller cards in the sim Controllers panel now carry gamma
  r/g/b/w fields (they ARE the led.wire.controllerGamma mirror,
  through the editor's normal mutate/undo/dirty pipeline) + "⬆
  Push gamma" + provenance chip (✓ hardware / ▲ hardware≠mirror /
  ○ never pushed); "⬆ Push gamma to all" in the LED group header
  runs sequential per-controller rows (ok/failed/unreachable/
  skipped, named; one failure never aborts the rest). Bounds
  1.0-3.0 (= controller-accepted ∩ led_wire.js mirror clamp —
  deliberate). Server-side discipline identical single+fleet:
  backup to ~/tmp/led_controller_configs_backup/ → partial
  {gamma}-only write → applied vs needs-reboot honoured →
  read-back verify; ONLY verified read-back updates mirror +
  stamps device.lastGammaPush; failure leaves mirror untouched.
  One implementation: NEW simulation/server/led_gamma_service.cjs
  (led_gamma_push.cjs now a thin CLI over it); routes POST
  /led/gamma-push + GET /led/gamma; src/dmx/led/led_gamma.js,
  src/gui/led_gamma_ui.js, controller_map_editor.js,
  controller_registry.js (lastGammaPush schema). Sim suite
  591/591 (571+20). Live proof vs 10.x.x.60: 2.2→2.3→verified→
  restored 2.2 exact, backups both times; 400 invalid / 502
  unreachable named; full browser→server→hardware fleet push from
  the UI (1 ok). Operator's :6969/:6970 PIDs untouched; probe
  server on scratch port, exited. OPERATOR NOTE: gamma fields
  appear on page reload, but push buttons 404 until the
  save-server Node process restarts (cd simulation && npm start).
  Save the scene after pushes to persist the mirror. docs/41
  §4.1(d) + master doc R7/Log updated. Expected residue:
  marsin_engine/patterns/manifest.json caught up 6 existing
  white/UV patterns (save-server regenerates at startup). Next
  free: `_30`.
**Landed 2026-07-28 — VSN1 fix (Opus, `_31`):** steps 1-10 + 12 of
`_30` §6 in; step 11 (launcher auto-restart-on-abort) DEFERRED
pending operator sign-off — launcher.js never opened. Overflow
closed at the root: stripLineComments splits /\r?\n/ →
6-over-budget templates → 0, EXACT July-15 known-good sizes
restored (encoder INIT 904/909, key INIT 871, lcd_draw 573,
system 626); fail-loud comment-survival guard;
.gitattributes *.lua text eol=lf. §2.7 hazard PROVEN real:
GridScript.checkSyntax() returns true on a fully-commented-out
body (would flash dead code green); CRLF also let raw
__KINDS__/__MCH__ doc tokens ride to the device as nil
identifiers. Attach state: probe_vsn1.cjs child (exit 0/3/1,
enumerate-only, serial OUT of engine proc) →
attached|detached|unknown; detached = pending pages cleared, ONE
line per transition, ZERO deploy spawns (was 4 doomed compiles +
4 red banners); unknown DELIBERATELY still attempts (a broken
probe silently disabling deploys = fallback in a safety costume).
Deviation: pure compiler split to tools/vsn1_config/
lua_action_string.cjs (engine tests never load native serialport;
grid_serial.cjs re-exports all 4 symbols). Suites: engine
2324→2347, SAME 8 pre-existing failures (7 env + 1 runner-IPC
artifact, disproven 3 ways); CaptainPad 886→889 + tsc clean; 23
new tests. Real-child E2E device-unplugged: 1 log line, 4 cheap
probes, 0 spawns. OPERATOR FOLLOW-UPS: (a) step-11 sign-off (`_30`
§7 Q4) — teardown race still unpinned, only its churn exposure
removed (step 10 = hygiene, not a proven abort fix); (b) run
`git add --renormalize .` when he next does git (templates still
CRLF in tree; harmless now by construction); (c) §7 Q1-Q3
diagnostics still useful. States-file residue predates session
(reported, untouched). Next free: `_32`.

**Landed 2026-07-28 — Studio editor FIX (Opus, `_28`):** all 7
plan steps in; validated live at 1280×800 / 820×1180 / 1180×820
on fresh :7167 dist (operator's :6967 Metro + :6968 engine
untouched, no deploy). A1 cyan caret paints rgb(0,218,243); A2
geometry lock → |scrollHeight−highlightHeight| = 0px all
viewports; A3 inline tokenizers deleted → NEW
components/code_highlight.tsx (per-line React.memo, lines joined
by literal \n in ONE pre-wrap Text so wrap geometry unchanged) +
components/studio_editor_logic.ts + 17 vitest (suite 869→886);
A4 visualViewport modal height; A5 mirror-div caret-follow; A6
Tab→2sp via execCommand (undo kept); A7 tap-preview-to-edit.
Tap-to-position EXACT (0 chars off) incl. after the deep-scroll
trap (ta.scrollTop stays 0). Keystroke median 88.4→24.8 ms
(<16ms NOT met — residual is Chrome layout of the 8.8k-px block;
useDeferredValue is the next lever if wanted). TWO extra bugs
found by invariant assertion, both fixed without changing SAVE
bytes: (1) CRLF pattern files — textarea .value strips \r so the
highlight carried 312 extra chars → taps −304 off; (2) textarea
paints a trailing empty row a pre-wrap block doesn't (20px
residual scroll). D9 smart punctuation still needs operator's
physical iPad (type ' " -- in a comment; if mangled → loud
non-ASCII save warning is the fix). tsc clean; do-not-touch list
honoured; report 20260725_28_studio_editor_fix.md; master doc R6
+ Log updated; evidence ~/tmp/studio_editor_fix/; :7167 stopped.

**Landed 2026-07-28 — Studio editor DEBUG (Fable, `_27`):**
architecture = transparent controlled TextInput/textarea overlaid
on regex-tokenized highlight in one ScrollView (studio.tsx:228-279;
react-simple-code-editor pattern — sound, 4 broken details). D1
headline: CARET INVISIBLE — RNW 0.21 silently drops selectionColor
→ caret inherits rgba(255,255,255,0) text color (measured
caretColor: transparent), both platforms. D2: textarea reserves
~15px scrollbar width the highlight doesn't → wrap divergence +6
rows @1280 / +41 rows @820 portrait (token spans proven innocent).
D3: one EOF visit → textarea internal scrollTop=120 while
highlight stays → permanent click offset. D4: 53-88 ms/keystroke
(whole-file retokenize ~2k spans ×2 surfaces sharing code state).
D5: KAV no-op in RNW (keyboard covers editor). D6 no caret-follow;
D8 Tab exits field; D9 iOS smart punctuation (device-verify).
NOT broken (verified): caret preservation through controlled
cycle, native undo, copy/paste, save/RUN, no live-data re-renders.
Verdict: PATCH not rebuild, 7-step plan. Side observation: local
test engine crashed idle on the KNOWN VSN1 page-0 overflow +
libuv assertion (existing branch thread, noted in report).
Next free: `_29`.
**Landed 2026-07-28 — white-res reconciliation + (W+A)/2 verdict
(Fable, ~/tmp/led_white_resolution_debug.md §6-7):** headroom
theory SURVIVES; the 0.65 test spec was wrong twice — (1) kick
slams push k to 1.611 (wash) / 1.685 (breathe), and 0.65×1.61 =
1.047 > 1: every kick pop stays pinned at 0.65, only slow texture
unfreezes — "did not come alive" is the CORRECT observation; (2)
only the strand's own group track (LED 0, sId 5 on test_bench)
touches the strand — any other Dimmer Rack track is a null test;
CaptainPad LIVE strips show PRE-dimmer composite so the app can't
confirm either way. Dimmer Rack IS upstream (POST
/section-brightness → IntensityController engine.js:914) —
hypothesis (a) false. DEFINITIVE HAND TEST: LED 0 track to 0.40
(or curl POST :6968/section-brightness {"sectionId":5,
"brightness":0.4}) — worst case 1.685×0.4=0.674 under ceiling →
strand MUST pop on every kick (computed W85→W102). If STILL static
at 0.40 → ceiling theory dead, suspect the DELIVERY PATH (engine
unicast still aims at dead 10.x.x.202; strand lives off the
sim-bridge relay) → sniff relay bytes during a kick next. (W+A)/2:
NO — decomposed, ~90% of the headroom win is just halving the
white lane (a dimmer in disguise: w/2 saves 0.42 composite, amber
re-route only 0.04); tint cost severe (temple 1:0.82:0.53 →
1:0.88:0.75, un-warms the just-fixed amber fold); wrong twice more
under the paused pass-through. (Its "premise off: a=w·warmth·0.85"
note is STALE — the _26 sweep made w==a true; verdict unaffected,
tint+decomposition args stand.) RECOMMENDATION: land P1 soft-knee;
optional tonight hand-knob = tint-preserving ledWire.headroom ≈
0.6 (k_worst 1.01, ratios intact, ~71% of pinned top light) — "his
idea done right". AWAITING OPERATOR: run the 0.40 hand test + go/
no-go on P1 (+ headroom knob).
**Landed 2026-07-28 — w==a lane matching, ALL patterns (Opus,
`_26`):** 39 of 40 rgbwau() patterns edited (65_uv_only already
compliant; drafts 60-65 included — 60-64's aLane was wLane×warmAmt
×0.85, warmth still shapes RGB); animation logic untouched; every
edit comments the convention. Docs: new §5.1 "White handling: the
w==a convention" in MARSIN_ENGINE_PATTERNS.md (+ fixed §6.1's own
example which TAUGHT the bug: a=color×0.4). ENFORCED: new
tests/patterns/white_amber_lane_match.test.js auto-discovers every
rgbwau() pattern, renders, asserts W==A BYTES per pixel per frame,
no allowlist. FLAGGED FOR OPERATOR EYES (R2): 17_rolling_color_
dunes (amber=standalone ember + fed brightness, most changed),
13_sparkle (independent glint + amber↔UV crossfade),
00_golden_hour_wash (amber = pattern identity), 07_shimmer,
11_bioluminescence, 04_beat_folded_helix, 05_orbital_attractor_
field; in 00/04/07/11/13 the whiteTint/whiteWarmth knob LOST its
amber arm (only UV arm moves) — re-point at RGB lanes at R2.
Systemic host-emit a=w rejected as hidden fallback (would also
corrupt transition compositors) — explicit pass + CI test instead.
Tests: lane 41/41, patterns 88/88, 68/68 compile; full suite fails
all environmental (incl. 10× 409 PERFORMANCE_MODE from the
operator's LIVE local engine; baseline-delta claim caveated).
NOTES: (1) the deploy RAN before the stand-down order arrived —
titanic-ext IS running this change, verified clean, preflight zero
remote-newer (nothing of his overwritten); no deploys since;
revert on request. (2) Live-engine residue: white_wednesday.yaml
captured 61_white_breathe slider defaults at 21:37 (drift vs
titanic copy) — reported, not reverted, not committed.
**Landed 2026-07-28 — LED white resolution DEBUG (Fable,
~/tmp/led_white_resolution_debug.md): mechanism = HEADROOM, not bit
depth.** Patterns author 1.43-1.6× RGB+W+A stacks (the vibrant par
look); strand must fit ONE 255-ceiling composite; the tint-safe
joint pre-scale maps every over-budget frame to IDENTICAL bytes —
white_wash freezes above bri 0.70 (one byte state across the loud
range while par W moves 149→213), white_breathe pinned on the
inhale half, white_chase core plateaus >0.78, shimmer GOOD (sparse
dynamics below ceiling), temple_warm_white dim-by-design not
frozen. Smoking gun: whiteKick's W/RGB-split slam is ERASED by the
controller's fold/extract — kick pops physically invisible on
strands today. W-gamma + 8-bit steps EXONERATED. His 3 answers:
(i) reduced as headroom — strand 1×255 composite vs par's 5
stacking channels; top 30% + kick pops collapse; (ii) wire is
4-byte RGBW end-to-end but current controller processing folds to
3 channels of information — the PAUSED pass-through is what makes
the 4th byte real; (iii) pass-through = ~510 white levels,
1.7-2.5× lumens, frozen range fully live, needs mapper companion
(relax pre-scale for passthrough controllers) + w-gamma 2.2 push;
dithering doesn't exist + only helps dim end — skip. PLAN: P1
soft-knee compressor in led_wire.js ledCompositeTarget (map peak
[0.72..1.7] → [0.72..1.0]) — wash/breathe recover 25-45-byte top
swing, kicks return, DMX + shimmer untouched, tonight-sized;
zero-code proof = master to ~0.65. AWAITING OPERATOR GO on P1.
Next free: `_27`.

- **(retired entry) LED white/color software-side fix wave (Opus, `_25` reserved,
  20260725_25_led_white_color_fix.md)** — operator: focus on LED
  whites/colors, NO firmware change right now. BM-repo-only levers
  from the ~/tmp review: (1) mapper emits strand pixels so the
  controller's white processing can never clip (W=0-encode vs
  joint pre-scale — wire-exact math decides, warm-white tint must
  survive full brightness); (2) amber folded into strand RGB (UV
  stays dropped, no emitter); (3) mapper-side gamma for strand
  output (config-tunable, LED path only); (4) sim preview computes
  strand color from EXACT wire bytes incl. simulated controller
  extraction — screen = strand. DMX par path byte-untouched.
  Property tests + A/B renders + deploy (with remote-newer-file
  preflight guard). Privacy: repo files use generic "LED
  controller's white processing" wording; full rationale in
  ~/tmp/led_white_fix_addendum.md. SCOPE UPDATE (operator): mapper
  gamma DROPPED → controller CONFIG gamma push instead (HTTP
  /api/config per docs/41, NOT a flash): backup each controller
  config to ~/tmp first, push per-channel gamma, reboot, read-back
  verify, revert procedure documented, no partial-fleet silent
  success; preview must model controller gamma; gamma lives in
  EXACTLY one place (state where). Separately: Fable review agent
  resumed READ-ONLY to answer the operator's firmware-effort
  question (change size/risk, OTA-vs-physical redeploy burden ×
  fleet count, quantified white-brightness payoff after software
  fixes, verdict) — answer appends to the ~/tmp review only.
  ANSWERED: surgical 1-file ~60-100 LOC change, low-med risk; NO
  OTA — USB per unit, 10 of 15 controllers benefit, ~afternoon;
  payoff 1.7-2.5× luminous white on partial-white content, 4A cap
  trims full-field to ~1.25×; verdict MODERATE — flash test-bench
  unit only, A/B, fleet-walk only if it wows.
- **Controller-firmware W pass-through: DEFERRED BY OPERATOR
  (2026-07-28)** — "do not start firmware update yet, it's looking
  better now and I think it could be good to use like this."
  Implementation agent was stopped at orientation (nothing written);
  stays parked, NO relaunch without an explicit operator go. Kept on
  file: decision-grade assessment + design in the ~/tmp review
  addendum; per-output scoping answered (RGBW driver only, RGB
  outputs byte-identical, mixed types safe per-output). BINDING
  EMISSION CONTRACT remains in force for the software wave: engine
  emits TRUE RGBW jointly pre-scaled (renders correctly on current
  firmware AND any future pass-through build; W=0 encoding rejected;
  preview models current behavior behind one isolated function).
- **ABORTED 2026-07-28 (operator: "ignore the fetch work, stop
  that")** — remote-edit loss recovery agent killed at orientation;
  `_24` number retired unused. Residual facts: operator's 12:38
  remote edits ARE fetched to laptop (7 files); whatever he edited
  remotely after 12:38 was mirrored over by his subsequent deploy
  and remains unrecovered BY CHOICE. Remote .scene_backups (deploy-
  excluded) may still hold post-12:38 snapshots if he ever wants
  them.
- (Party system CLEARED as of `_23`. Next free report: `_26`.)

**Landed 2026-07-28 — party fix REVALIDATION (Opus, `_23`): PASS —
all 11 defects stay dead, party system CLEARED.** cooldown 0 /
disabled: exactly 1 s ambient blip, 7 sessions in 400 s, never two
looks per tick; scheduled-cue re-take: reclaims ONCE at
handover+cooldownSec, byte-identical replays, 0 oscillation over
3600 ticks; ambient-fill guard: no regression, orphan shape
unreachable; D11 real-engine: ONE loud refusal naming
file+field+value, api_server up, clean boot after restore; D1
re-driven LIVE: 240 s unbroken forced party → 4 sessions with mood
never dipping calm (re-arm provably from session-END bookkeeping);
D2 proven on real state file; D6 on fresh dist — IN SESSION no
reload, carried by the 5 s poll ALONE (flaky-WS answer); 25-save
storms move sessionEndsAtMs by 0; suites zero-delta (engine 7
known-env, timeline 317/317, vitest 869, swap-wedge green);
titanic-ext deployed files MD5-identical to fixed local, GET
byte-identical before/after, SSH read-only. NEW FINDINGS (none
blocking): F1 MED operator rule — a kind:ambient|look cue with
durationMin does NOT protect its window (party reclaims at cooldown
expiry); use `hold` for must-not-interrupt moments; shipped plan
immune (all program+hold). F2 LOW — D11 refusal console-only,
/timeline/state 200 lastError:null → CaptainPad empty timeline no
banner (pre-existing shape, backlog). F3 LOW — a SECOND mood→party
cue would never re-arm (_partyCue resolves first); shipped plan has
exactly one. Local: all probe servers stopped, states restored,
only gitignored timeline_state.yaml differs.

**Landed 2026-07-28 — Opus defect FIXES (`_22`, DEPLOYED, probes
49/49):** D1+D3 _notePartySessionEnd(endMs) at timeline_service
:1324, called from all 6 end paths (:891/:1124/:1379/:760/:1521/
:1826); cooldownRemainingSec 0 while in session. D2 boot re-arm
:301 (not _catchUp), cooldown stamp still gates. D4/5/7/8
party-aware _catchUp :1790 (END vs REJOIN-original-window), live
open-ended owner blocks ambient fill :1642, orphaned latch cleared.
D10 :1160 (400). D11 timeline_state.js :215 one loud boot refusal +
"⛔ TIMELINE DID NOT START" api_server line. D6 timeline.tsx:
partyConfig WS subscribe + poll-while-mounted. triggers.js
BYTE-IDENTICAL. Probe suite 49/49 (was 38/48): 6 probes updated to
new semantics w/ dated comments; 2 probes were MIS-WRITTEN and
corrected (P8 proto-pollution literal serialized valid; P9 F8
hardcoded pre-fix timing). p9 live chain: armed → in_session
(cd 0) → cooldown 25 s → in_session ×2. p11b: card IN SESSION with
NO reload. +12 engine tests (party_session_repeat ×10) +2
CaptainPad. Engine 2278/2271/7 known-env zero delta; tsc clean;
vitest 869. states/ tracked byte-identical (3 rewritten files
restored from session-start backup — stated). DEPLOY OK
restart_count 0 bootError null.

**Landed 2026-07-28 — Fable defect-fix PLAN (`_21`):** keystone =
triggers.js UNTOUCHED (its fire-time latch prevents mid-session
re-fires); all semantics are session-END bookkeeping in
timeline_service.js via new _notePartySessionEnd(endMs) — re-stamps
moodLastFire at END (D3) + re-arms moodArmed (D1), persisted, called
from every end path (window-elapsed ~:864, follow-music release,
_endPartySessionNow, handover, _goDormant, _catchUp ends). D2: boot
re-arm in start() NOT _catchUp (blanket _catchUp re-arm would allow
mid-session re-fires on savePlan/resume); persisted
moodArmed:false = session that died with the process → flip true;
cooldown stamp honored. D4 family: _catchUp captures prior untilMs
+ follows-music; party-aware re-apply (policy off / window expired /
mood calm ⇒ END at true end; else REJOIN original window); F1
live-owner guard kills D7 ambient flash; deleted owner clears
orphaned latch (D8). D6: PartyModeSection subscribes partyConfig on
engineEvents bus + 5 s poll unconditional while mounted (poll is
LOAD-BEARING — engine only broadcasts on PUT, not session
transitions). D10: empty patch (zero-byte or {}) → 400. D11:
partyConfigOf validation in loadTimelineState → one loud boot throw
naming file+field. Operator-visibility flags: cooldown-off =
back-to-back sessions w/ ~1 s ambient blip; restart mid-session
re-fires promptly; handover re-arm lets party reclaim from a
scheduled look after cooldown; savePlan during calm dip mid-fixed-
session now ends it. Opus fixer IN FLIGHT executing verbatim
(probe re-runs p1-p12 w/ 3 expectation updates, 8 new tests,
deploy).

**Landed 2026-07-28 — party×timeline ADVERSARIAL VALIDATION (Opus,
`_20`): CONDITIONAL FAIL — 4 blockers, all PRE-EXISTING timeline
code (triggers.js mood latch, _catchUp), not _19's build.** D1
BLOCKER: party fires once per continuous music episode (re-arm only
on drop to CALM; audioPartyStrong needs 30 s silence) — 12-min
session then ambient all night while effectiveState says armed.
D2 BLOCKER: engine restart mid-party kills party for the night
(moodArmed:false/prevMood:1 persisted → boot never sees the edge).
D3 HIGH: cooldown stamped at FIRE not session end — 120 s burns
inside the 12-min session, 'cooldown' state unreachable. D4 HIGH
(+D5/D7/D8): takeover-release resurrects session w/ fresh full
durationMin even at CALM (_catchUp re-applies unchecked, re-anchors
window); savePlan restarts window; ambient flash; orphaned latch.
D6 HIGH: CaptainPad card never learns untracked transitions (no
partyConfig WS listener; 5 s poll gated on the value it refreshes)
— live-proven: engine in_session 295 s vs card "ARMED" for 24 s +
focus, reload-only fix; mirror ENABLED-over-DISABLED. Nits: D10
empty PUT → 200; D11 corrupt persisted field throws per-tick
unthrottled while silently killing the WHOLE timeline. SOLID (don't
re-litigate): precedence 7/7, flapping/edge storms 11/11 (119 vs
121 s exact, 100 flaps 0 fires), hostile HTTP 40/40 (proto
pollution, 1e400, 25 concurrent PUTs → one state), WS replay 5/5,
restart safety 6/7, live follow-music chain (~3 s release, no
cooldown, re-triggers on dwell), stale ends session,
forced+disabled inert. Suites: engine 2260/7 known-env zero delta;
party+timeline isolated 69/69; CaptainPad tsc clean vitest 867;
swap-wedge _16/_17 still green. titanic-ext UNTOUCHED (byte-
identical final GET); local states/{deck,globals}_state.yaml
restored from session-start backup (only gitignored
timeline_state.yaml differs); no festival date left anywhere.

- Parked: R2 specialty agent — resume when Sina schedules the
  tuning session.

**Landed 2026-07-27 — R1 engine authority + companion PARTY tab +
fake trigger (Opus, `20260725_19`, DEPLOYED ×2, live on
titanic-ext):** PARTY tab in companion UI: 10 Hz meters w/ gate
markers (floor×margin line, shaded kick window, four term verdicts
→ QUALIFY, dwell progress bar), 11 party: tunables APPLY/PERSIST +
dirty markers, §6.2 capture helpers (P95/P5 → suggestions, never
auto-applied), runtime-only validation mode, read-only session
context, FAKE TRIGGER (proven live: FORCE PARTY → engine key 1
while detector truth stayed false; AUTO → 0). PERSIST surgical
per-line in party: block — comments byte-identical, unlocatable key
THROWS, exponent forms refused. Engine /party-config authority:
enabled/playlist/minDwellSec/durationMin/cooldownSec(120)/
durationEnabled/cooldownEnabled, persisted timeline_state.yaml,
SEEDED ONCE from plan incl. playlist (mid-run regression caught:
override defaulted party_high over plan's party_pl — fixed),
fire-time resolution no plan reload, partyConfig WS broadcast +
connect replay, all-or-nothing 400s. Follow-music: ONE release
sustain = offConfirmMs (editor relabelled), no cooldown. CONTRACT
ADDITIONS: effectiveState armed|disabled|no_plan|MANUAL|in_session|
cooldown (manual = human takeover — agent judgment call, relayed),
effective{DurationMin,CooldownEnabled,CooldownSec}, planActive,
inFestivalWindow, controller, mode, partyCueId, sessionFollowsMusic,
sessionEndsAtMs, cooldownRemainingSec, availablePlaylists;
/timeline/state += partyEnabled, partyPlaylist. Timeline compat
UNIT-TESTED (30): no-plan structural, festival dormancy, takeover
blocks fire, disable-during-takeover inert, disable mid-session →
defaultCue reclaims, fire-time playlist+duration, forced==real,
forced+disabled=nothing, stale ends follow-music, mid-session
toggle keeps mode, fixed rides out drops, no cooldown after
follow-music, persistence round-trip. REASONED ONLY → validator
priority 1. FLAGGED GAP (pre-existing, all cue types): running
session doesn't survive engine restart (cooldown stamp persists —
no free session). Both scenes' plan cooldownSec 900→120. 45 new
tests; suite 2265 pass / exactly 7 known env fails; CaptainPad
untouched.

**Landed 2026-07-27 — hardening mini-wave (Opus, `_17`, DEPLOYED
"DEPLOY OK"):** (a) new lib/send_error_throttle.js (per-destination,
injectable clock; first error + error-class changes immediate, 30 s
summaries w/ suppressed counts, RECOVERY line, re-arm after
recovery) wired into sacn_output.js (senders restructured to
{dest,sender} so keys name destinations) + artnet_output.js; healthy
path zero-cost (hasFailures() gate). Live proof: 5 240 failed sends
→ 6 lines; 88 MB/4 h → ~KB/day. 9 new tests. (b) CaptainPad
transitionId match: deckSwapCompleteReleasesLock predicate in
deck_swap_watchdog.ts:47-79, swapTransitionIdRef in index.tsx
(:345/:517-545); missed-started + id-less completes still heal,
watchdog backstop, fired-timer ref nulled (_16 note 3). 6 new
vitest. Totals: engine 2 217 pass / 7 known-env fails (the 8th flake
didn't reproduce, 0 new), tsc clean, vitest 809, states/
residue-clean. Deploy verified, supervisor stable, Metro untouched.
FOLLOW-UP FILED: no log rotation/retention for boot_server_*.log on
show machines (throttle removed the pathological writer; rotation
still absent). Master doc updated by agent.

**Landed 2026-07-27 — swap-wedge VALIDATION (Opus, `_16`): PASS, no
product defect; pipeline CLOSED.** Non-PANIC cancels live: snapshot
morph + deck remove/replace both emit cancelled-complete w/ matching
transitionId, heal 4/2 ms, post-heal tap POSTs. Real WS sever (TCP
proxy, 19 sockets destroyed, reconnect refused 10 s): watchdog
released at 8 060 ms vs 8 000 window while OFFLINE; post-reconnect
healthy. Swap-over-swap: engine 409s (unreachable-cancel path can't
fire over HTTP); 12 PANIC×select race rounds, zero stale unlocks.
Regression: tap→highlight 22.8-47.2 ms, mid-fade dim intact, vitest
803, tsc clean. titanic-ext HEALTHY with the full dirty tree: 68
patterns (incl. parked 60-65) + 14 playlists load, no errors
referencing them; wedge fix live on remote (heal 8 ms); remote state
restored (master 0.9213, deck 00_golden_hour_wash). CORRECTIONS/
FINDINGS: _15's "7 env fails" is really 8 (timeline_deck_release_
default_cue worker-IPC flake, tracked since c6eaa733, fails
identically in isolation — 0 assertion failures); 88 MB log-spam
hazard (→ hardening wave a); transitionId latent fragility (→ wave
b); validator's own repro harness false alarm (row picker not
hit-tested — rows scrolled out of clip; product fine). Follow-up
pointers: repro.cjs/verify_fix.cjs share the un-hit-tested picker.

**Landed 2026-07-27 — swap-wedge DEBUG (Fable, `_14`) + FIX (Opus,
`_15`, DEPLOYED "DEPLOY OK" e805ef01):** root cause 1 (dim/wedged
list): deckSwapInFlight dims list 0.55 + disables rows
(index.tsx:1052 → PlaylistPanel:1464), cleared only by WS
deckSwapComplete — but cancelDeckPatternSwap (pattern_mixer:2429)
dropped transitions silently (PANIC, look-recall morph, deck
replace, WS blip) → list permanently dim, taps swallowed 0-POST,
even TX-off; MIDI/engine fine; tab-switch silently cleared (hence
"sometimes"). Root cause 2 (not-snappy): highlight is optimistic +
fast (29-52 ms measured); real drag = standing 5 Hz whole-deck-tab
re-render from viz strip (index.tsx:508-517 setVisVersion) — 69%
main-thread blockage at 4× throttle — FOLLOW-UP, deliberately not
fixed; "tap ignored during crossfade" toast also follow-up. FIX:
engine onDeckSwapCancelled (pattern_mixer:603, :2431-2452) →
api_server:3519-3532 broadcasts deckSwapComplete{cancelled:true,
transitionId} (existing type, all clients heal); CaptainPad
watchdog durationMs+2s (index.tsx:336/:390-398/:507-522 + new
components/deck_swap_watchdog.ts). Evidence: repro S3 heals (1 POST
after PANIC vs 0 before); isolation: 17 ms both / 5.3 s
watchdog-alone; latency band held 29.6-33.9 ms. Engine 2205 pass /
same 7 env fails; CaptainPad tsc clean, vitest 803 (798+5); states/
residue restored via byte-snapshot (not git). CAVEAT (validator
probing): deploy stamped 100 dirty files — full worktree incl.
parked R2 residue now ON titanic-ext.
- **R6 UI R2-4 BLOCKED on operator answer**: measured portrait
  globals = exactly two 40pt nowrap rows at 820 AND 768, nothing
  wraps. The "third row" he sees is either (a) the pre-existing
  AUDIO meter row (deliberate feature) or (b) the "⚠ BPM SYNC ON ·
  NO TEMPO" banner in CPCControls :276-288 (renders only when SYNC
  armed w/o tempo; agent wouldn't toggle SYNC on the live rig).
  Asked operator which. If (b) → same compact-toast treatment as
  R2-5.

**Landed 2026-07-27 — R6 UI wave ROUND 2 (Opus, `_11` Round 2
section):** tsc clean, vitest 798 pass (+8 new). Deck weights final
40/30/30 side-by-side (journey comment at index.tsx:942). R2-1
master fader: NOT the refactor — DeckTopBar.tsx header had no shrink
rules; right cluster ran 147pt past the edge at 1180pt (MASTER
rendered off-screen since before the wave). Fix: left cluster
flex:1/minWidth:0/hidden yields, MODEL chip absorbs squeeze, right
cluster flexShrink:0 — MASTER at x=862-908 on-screen, verified.
R2-2 mixer title bar landscape 80→48pt ONE row, nothing dropped:
MasterFadeGroup compact prop (5 pills → existing 1-tap cycler),
PERF compact, SnapshotBar compact ("+ SAVE"), CONNECTED→"LIVE"
(OFFLINE keeps full word), MODEL caption dropped, fader 160→110,
brand 20→14; first pass leaked shrink into portrait (hid badge) —
caught via portrait capture, all changes landscape-gated. R2-3
perf-mode −30%: playlist_row_sizing.ts tokens ×0.7 (rowMinHeight
78/88→55/62 etc.) with fonts FLOORED at edit-mode values (straight
×0.7 made live text smaller than edit text); edit mode untouched;
token-pinning test added. R2-5 lock warning: strip pill removed →
absolute pointerEvents:none toast, left-anchored (never covers
BLACKOUT), 2.2s auto-dismiss; ⋯/+ un-disabled to fire onLockedTap
(still dimmed+a11y-disabled, mutating path unreachable). Other
inline banners audited + left alone: bpmSyncStale (R2-4 suspect),
DeployErrorBanner (real failure), PlanLockBanner (already overlay).
VERIFICATION LIMIT: R2-3/R2-5 are perf-mode-only — verified by unit
test + code path, NOT screenshot (agent refused to force perf mode
on the live show; operator can flip perf briefly for pixel proof).
New captures: deck_landscape (40%), mixer_titlebar_{landscape,
portrait}.png — delivered to operator.

**Landed 2026-07-27 — R1 party-detection BUILD (Opus,
`20260725_12_party_detection_build.md`, DEPLOYED to titanic-ext,
verified live):** (1) `audio/signals/party_mode_strong.js` (293 L):
audioPartyStrong = calibrated level (L ≥ ambientFloor×marginX) AND
rhythm (kickRate 1.2–3.2/s, kickReg ≥ 0.45, BPM locked — computed
in-shaper from micKickRaw, NOT the genre classifier's copy which is
gated behind audioParty = circular) AND highShare ≥ 0.12 (far-camp
bass-only rejector) AND not-silent, debounce 20/30 s; 11 thresholds
in config.yaml→party:, bad key throws at boot. (2) 5 new published
keys on /param-center: audioLoudness/KickRate/KickReg/BpmLocked/
BpmConf — confirmed moving live. (3) `lib/timeline/mood_source.js`
(158 L) staleness guard on CPC WRITE REVISION (frozen key reads dead
even if value republished); staleSec 10 → mood forced CALM, one-edge
console.error, /timeline/state exposes moodStale/ForSec/Episodes/
RawValue; typo'd key = distinct failure. (4) timeline.mood.key =
audioPartyStrong; both scenes: defaultCue ambient, party cue →
party_high, minDwellSec 120 / durationMin 12 / cooldownSec 900,
whenPhase dropped. Music→party latency ~2 m 20 s (20 s detector +
120 s dwell, deliberate). (5) DRAFT playlists ×3 ×2 scenes, all 57
top-level patterns placed exactly once, defaults:{} for R2.
**Latent bug caught by deploy verification:** companion OSC emit
list (ENGINE_INTERNAL_DERIVED) is hand-maintained vs generated CPC
schema — new keys publish companion-side but never reach the engine;
audioPartyStrong would have been a permanent 0 (party could NEVER
fire) on a clean-booting stack. Fixed + two-direction drift guard,
re-deployed, re-verified. Tests 2155/2148 pass (7 pre-existing env
fails: 5 unpinned mic, 1 EACCES-vs-EADDRINUSE, 1 worker flake), 24
new green; states/ md5-identical after suite. OPERATOR PREREQS:
(a) plan not driving yet — planActive false, festival window opens
in 34 days; driveway full-chain test needs festival.startDate temp-
set to today (detector-only validation needs nothing); (b)
ambientFloor 0.09 is a PLACEHOLDER — playa capture §6.2 (ambient
P95 vs party P5, marginX = 0.5×ratio). FOLLOW-UPS FILED: CaptainPad
tuning UI (companion ui/ row = faster win, outside excluded zone);
audioSilence=1 while micMidRaw≈0.36 on show machine — miscalibrated
silence latch, look before playa.

**Landed 2026-07-27 — R1 party-mode detection AUDIT (Opus,
`20260725_10_party_mode_detection_audit.md`):** headline — the show
director already EXISTS: engine `lib/timeline/` (enabled in prod) has
mood triggers with minDwellSec/cooldownSec/whenPhase, durationMin
(cue owns the deck N min), plan-level defaultCue (ambient fallback).
Sina's ≥2-min sustain → 10–15-min session → ambient is pure plan
YAML, zero new state machine; `getMood()` reads any CPC key by
config. The BROKEN piece is the detector: `PartyMode` is a
band-loudness-only Schmitt trigger — live probe of the show machine
with NO music: audioParty=1 sustained, micKickRaw=0.000, micLowRaw≈0,
genre melodic_house@0.44, /timeline/state currentMood: party (the
operator's stuck-in-party fear reproduced on the driveway). BPM
lock/confidence + kick regularity are computed but never published;
ambient/party_high/party_low playlists don't exist (only `default`);
live plan lacks defaultCue, minDwellSec is 20. Recommended:
companion-side `audioPartyStrong` = loudness ≥ calibrated ambient
floor×margin AND rhythm (kick 1.2–3.2/s, kickReg ≥ 0.45, BPM locked)
AND high-band share minimum (distant camps arrive bass-only — the
physically-correct far-music rejector) AND not-silent, debounce
20 s on/30 s off; publish the 5 prerequisite keys; flip
timeline.mood.key (one config line); plan YAML minDwellSec 120,
durationMin 12, cooldownSec 900, defaultCue ambient. Do NOT gate on
genre (circular, 63.9% acc, confidence anti-correlated). Effort
~1–1.5 d incl. tuning UI. R5 risk flagged: companion death freezes
the mood CPC key (stuck 1 = party forever) — staleness guard ~2 h,
in build list. Signals inventory: mic Low/Mid/High raw, kick pulse,
flux, sub, per-band onsets, chroma, audioBpm, beat/bar/downbeat,
audioParty, genre+conf, silence, trackChange, riser/climax/phrase/
drop-countdown; all live via GET /param-center at ~86 Hz. Operator
decisions folded into bm26_show_readiness.md §Open decisions (1-5).

**Landed 2026-07-27 — CaptainPad live-UI PLAN (Fable Plan agent,
`20260725_9_captainpad_live_ui_plan.md`):** all 5 operator quirks +
audio latch planned, implementation-ready. (1) SIZE global: delete 3
UI touchpoints in CPCControls.tsx:363-365/:1122/:89, engine/MIDI
untouched. (2) Deck horizontal: index.tsx flex 4/3/3 at
:1000/:1075/:1223 → PATTERNS flex 2, params+autopilot stacked in one
flex-8 ScrollView (SectionHost→View avoids nested-scroll zero-height).
(3) Pattern taps: REAL dead-zone bug — only the name Touchable
(PlaylistPanel.tsx:1570-1574) selects; badge/padding/sub-row/live-mode
rowMinHeight (:1510) dead + hitSlop annexation → whole-row Pressable,
inner controls keep precedence. (4) Effects bar:
GlobalEffectMacros.tsx :817/:850-895/:1381-1395 — numberOfLines=1,
portrait = 4 flex chips + ‹ › half-pager (chunkStripPages+test),
landscape 8-up, BLACKOUT pinned. (5) Mixer globals portrait: nowrap
~700pt row crushes faders (CPCControls.tsx:302-427 +
mixer.tsx:2632-2649) → two-row portrait proposal, OPERATOR CHOICE A/B
(not hardware-reproduced). (6) Audio latch: useFocusEffect retry when
!cfg + in-flight ref at audio.tsx:1165 (per _8). Order: 6→1→3→5→2→4
(5 depends on 1). Operator decisions: item 5 A/B (blocker), item 2
split ratio, item 4 label policy. NOT implemented — awaiting
operator approval, then one Opus wave.

**Landed 2026-07-27 — AUDIO tab error DEBUG (Opus,
`20260725_8_audio_tab_native_fix.md`):** operator confirmed the tab
working mid-investigation. NO code changed, nothing deployed. The _7
`audio.tsx` edit is EXONERATED — the operator's "AUDIO CONFIG
UNAVAILABLE" screen (audio.tsx:1172) renders only when the
`GET /audio/config` fetch itself fails, before any _7 render code
runs. Remote engine probe: 10.x.x.151:6968/audio/config → 200 in
42 ms, well-formed. Real defect: the AUDIO screen fetches config
once per mount (audio.tsx:1165) and an expo-router tab stays
mounted for the session, so one failure (e.g. default 127.0.0.1
api_base before the override, or an engine restart) latches forever;
deck/mixer/timeline re-fetch via useFocusEffect and self-heal.
Recommended fix (NOT applied — operator was live-testing):
useFocusEffect reload when !cfg, with an in-flight ref against
double-fetch. Folded into the _9 plan as item 6. Evidence is
web-repro + tsc-clean; native path not end-to-end reproduced.


**LED feedback round 2 (operator tested, "chef's kiss" overall):**
**OPERATOR IS OFFLINE (announced ~this update). Autonomy mode within
the law; document all judgment calls; nothing pushed; commits were
explicitly ordered.**

**HOST-PROCESS RESTART EVENT (2026-07-25):** the Claude Code session
restarted; the in-flight agents (S0, S2-wiring, color-transitions)
were marked stopped-by-user and CANNOT be resumed (harness policy:
relaunch only on explicit operator ask). Tree verified HEALTHY after
the interruption: touched files syntax-clean, sim suite 526/526.
Awaiting operator "continue" to relaunch fresh agents for:
1. **S0 generator live proof** — report `_30` missing; committed
   generator UI code is valid but live proof/design-audit not done.
2. **S2 chain wiring** (`_34` missing) — `trace_chains` module (`_33`)
   DONE+tested; gui_builder/config wiring (startAngle/splits UI,
   chainPlan generation, multi-chain sweep) not confirmed complete;
   any partial edits in tree are syntax-clean and test-green.
3. **Color transitions** (`_38` missing) — substantial partial work ON
   DISK (sim `src/core/color_transition.js`, engine
   `lib/color_transition.js`, passing math tests, param_center/
   test_bench.effects wiring edits); missing integration proof,
   benchmarks, visual side-by-sides, report.
**Stale task chip:** "fix 4 NUL bytes in gui_builder.js" is ALREADY
DONE (commit 34c8c52f, '::new::'/'::ungroup::', 0 NULs on disk) — do
not redo.

**Landed 2026-07-25 — LED move trail + sticky selection DEBUG (Fable,
`20260725_1_led_move_trail_debug.md`):** all 3 operator symptoms
reproduced live on :6969/titanic, screenshots inspected. Root causes
(both LONGSTANDING — byte-identical since the main.js split 30495f12,
NOT introduced by the LED-wave campaign): (1) trail = 3D-handle move
path never invalidates the marsin batch cache — interaction.js:231-234
early-returns into `_onStrandTransformChange` (gui_builder.js:4329)
which skips the `invalidateMarsinBatchCache` PAR drags hit at L298;
`_batchRenderList` positions are snapshotted at generatePixelMap
(pixelblaze_model_exporter.js:393-395) and the dot flush writes colors
only → measured 40/40 dots at old line, 40/40 bulbs at new line; also
stales 2D map + engine normalized coords. Sliders don't trail
(rebuildLedStrands → invalidate at :4324) — confirming asymmetry.
(2+3) sticky selection + orange line = `deselectAllFixtures()`
(interaction.js:98-105) clears PARs only; empty-click (L489-495) and
Escape (L541-543) never call strand `setSelected(false)`; orange line
is the strand's selection glow tube (`led_strand.js:146-159`, colored
`config.color`, 7/8 titanic strands #ff8800). SIDE FINDING (filed, not
fixed): locked strand groups don't rigid-move on 3D handle drags —
slider path honors the lock, handle path doesn't. PROBE LESSON: load
sim probe pages with `&readonly=1` — main.js:267 overwrites
`__readonlyMode`, otherwise the probe becomes a live sACN writer.

**Landed 2026-07-25 — LED move trail + sticky selection FIX (Opus,
`20260725_2_led_move_trail_fix.md`, UNCOMMITTED):** surgical 2-file
diff per the `_1` plan. (1) `_onStrandTransformChange`
(gui_builder.js:4329-4345) now calls guarded
`invalidateMarsinBatchCache('strand_transform')` after
`rebuildVisuals()` — one bump cures global dots + 2D map + engine
`_batchCoords` + sACN pattern geometry. (2) `deselectAllFixtures()`
(interaction.js:98-118) also clears `ledStrandFixtures`
`setSelected(false)` + strips `gui-card-selected` from
`strandGuiFolders`; strand-pick order preserved; PAR/TE-Sign path
untouched. Live probe (readonly=1, autoSave asserted false): dots at
old/new line 40/1 → **0/41**; 2D-map 0 stale / 40 new; click-away AND
Escape now clear `_selected`/tube/handles/card (was true×4 → false×4);
84 PARs still selectable; **542/542**; screenshots inspected (post-fix
old diagonal = bare hull, glow gone after Escape). Probe lesson: on
SwiftShader allow ≥3000 ms settle — cache rebuild lands next frame and
this box runs ~1-2 fps; a 1500 ms settle false-failed once. Drag-FPS
delta unbenchmarkable on this box (structurally cheaper than the
slider path). Locked-group rigid-move side-finding still OPEN (operator
decision queue).

**Landed 2026-07-25 — COMMIT WAVE #3 (Opus,
`20260725_3_commit_3.md`, operator-ordered, NOTHING PUSHED):** four
commits: `ebf82c1b` sim (DMX gate _40 with live `fixtureConfig` handle
per pixel, rename-orphan _37, trail/selection _1/_2, OKLCH gradient
LUT + trace_chains as WIP, new verify tools); `672543f7` test_bench
scene+model (TE Sign V3 A/B fixtures + patch stubs, re-export 132→206
px = +74 = A 40 + B 34, viewmasks `TE Sign` bit); `25cb4309` engine
(audio kick fix _39, OKLCH color_transition wired into param_center
WIP); `e805ef01` .agent docs. Tests: sim 542/542; engine 2134 pass /
6 fail ALL PRE-EXISTING+environmental (proved via detached worktree at
clean HEAD: same 6 — audio_capture×5 need pinned Windows mic device,
osc_listener×1 sandbox EACCES). Security check PASSED ×4.
**DELIBERATELY UNSTAGED:** `marsin_engine/config.yaml` (engine
yaml.dump STRIPPED ALL COMMENTS incl. the _20 priority doc block;
diff also carries 6 real colorAutopilot palettes — re-add by hand on
top of the commented file if wanted); `marsin_engine/states/**`
residue — two DESTRUCTIVE ones flagged: `titanic/mixer_state.yaml`
channels EMPTIED (ch_base/08_ocean_liner gone) and
`titanic/audio_state.yaml` re-inflates per-scene tuning (reverses the
2026-06-14 migration); `test_bench/audio_state.yaml` carries the 8.83
inputGain drift _39 diagnosed + `device: test`; sim viewport residue
(common.yaml, test_bench Front camera preset MOVED — the agent_render
reference shot, titanic/controllers.yaml pure CRLF churn);
`_diag_undo.cjs` (stray scratch in repo root, codex says ~/tmp);
`models/led202.{js,effects.js}` **EMPTY export, pixelCount=0** —
committing would give the engine a nothing-model (likely relevant to
the TE-sign-no-patterns bug, sACN path); `{}` zero-byte junk file
(safe to delete). FOLLOW-UPS FILED: dead citation in param_center.js
to nonexistent `20260724_38` report; pin a mic device in
audio_capture tests for green Windows suite.

**Landed 2026-07-25 — TE SIGN test_bench NO-PATTERNS DEBUG (Fable,
`20260725_4_tesign_testbench_pattern_debug.md`):** ROOT CAUSE = DATA,
not code: TE Sign V3 A/B are the ONLY unpatched fixtures in a scene
that HAS patches. No chain in `simulation/scenes/test_bench/
controllers.yaml` references the sign → mapper re-derives
universe 0/addr 0/ip '' every boot (controller_registry.js:1650) →
exporter emits `patch: null` for all 74 sign px
(pixelblaze_model_exporter.js:79; confirmed in models/test_bench.js).
Path 1 (in-sim engine): 10/12 fixtures patched ⇒ `_patchesActive`
true ⇒ mixed mode DELIBERATELY paints unpatched pixels black
(render_paint_rule.js:25, animate.js:436/515/565-570). Probe proof:
engine computes TE colors at 1.0 while dot instanceColor stays 0;
strands animate, sign frozen. Titanic "works" only because NOTHING is
patched there. Path 2 (marsin/sACN): patch:null ⇒ engine has no
universe/channel; the static RED look is the sacn_mapper "undriven"
marker (sacn_mapper.js:72-81,148-157), not a pattern. FIX = map the
halves in test_bench (suggested: Test Bench 1, new port, U3, A ch1
120ch + B ch121 102ch) via controllers.yaml/mapping panel —
patches.yaml alone gets wiped by boot projection. Do NOT weaken the
mixed-mode black rule (intentional forgotten-patch tell). SECONDARY
BUGS FILED: sId/fId collision (TE Sign A = 5/11 = LED_0;
projectOntoConfigs numbers DMX configs blind to LED ids) +
sacn_in→pixelblaze mode-switch residue leaves unpatched bulbs frozen
red. AWAITING OPERATOR: apply the mapping (agent can do it via live
UI) or operator maps it himself.

**Landed 2026-07-27 — TITANIC-EXT DEPLOY REVIEW (Fable,
`20260725_5_titanic_ext_deploy_review.md`, read-only, stack left
parked):** VERSION CONFIRMED CURRENT — remote stamped `e805ef01`
feat/bm_readiness (24 dirty), deployed 2026-07-27 13:30 from
FoH-Windows; spot-checks all pass (dmx_output_overrides present,
`strand_transform` in gui_builder, TE Sign V3 A/B in scene,
pixelCount 206, node v24.18.0); 5/6 key files SHA-identical, 6th
(models/test_bench.js) differs only in `// Updated:` timestamp —
benign. Smoothness: operator-resolved (music sync drove GLOBAL SPEED
low); corroboration: prod runs the LIGHTEST `edit` profile, remote
has real HW accel (Ryzen 5 PRO 5650GE/Vega 7, healthy AMD driver,
Edge 1440p60) — not software rendering. NOTABLE REMOTE FINDING:
Audio Companion mic capture on titanic-ext FAILED PERMANENTLY at boot
(ffmpeg gave up on "Amazon USB Streaming Mic") — audio-reactive runs
on dead input there. FOLLOW-UP POINTER: `marsin_engine/lib/
bpm_speed_sync.js` `recompute()` ~L170-191 has NO FLOOR — BPM ≤
bpmSpeedMin or autopilot scale-sag writes speed 0.0 (music sync can
visually freeze patterns); configurable floor = candidate fix.
Deprioritized recs: headless prod viable only for engine-owned
universes (browser-routed DMX needs the page via sacn_output_bridge);
`2d_pixels` profile = 60 fps even pure-CPU (3D full ≈ 1 fps) — right
overlay knob for weak-GPU boxes, but boot_server.ps1 hardcodes
`profile=edit` in its URL; no hardware change needed. Probe cleanup
verified (ports 6969-72 free).

**Landed 2026-07-27 — TITANIC-EXT MIC RE-CHECK (Opus,
`20260725_6_titanic_ext_mic_check.md`, read-only): FIXED.** Stack up
(engine test_bench/11_bioluminescence, renderHealth ok, streaming to
Titanic-202; supervisor running since 13:35 — only audio was
hot-restarted). Device = the box's ONLY input, "Microphone (Amazon
USB Streaming Mic)" — at boot it was NOT ENUMERABLE AT ALL (saw 0
devices → ffmpeg gave up 5×); now enumerable + current. Capture
proven alive: WS hello mode:mic, 405 analysis msgs/9s @~60Hz, bands
moving, OSC totalSent advancing, engine /audio/status captureFps 86,
lastFrameAtMs advancing, restartCount 0, errorCode null (low/kick 0 =
quiet room). Recovery log signature of the operator's two-step
recorded verbatim (14:05:58 pick DEFAULT → 14:05:59 ENABLED on USB
mic) = ON-PLAYA RECIPE. FOLLOW-UP CANDIDATES with pointers:
audio_capture.js:456-468/:478-495 `_giveUp` clears all timers, never
re-arms; companion_server.js:1240-1256/:1635-1637 no device
re-enumeration on give-up path; api_server.js:7544 capture health
exists but INVISIBLE in CaptainPad.

**Landed 2026-07-27 — CAPTAINPAD MIC FLOWS (Opus,
`20260725_7_captainpad_mic_flows.md`, UNCOMMITTED):** REFRESH works
(true re-enumeration; 306ms uncached / 2ms in engine's 2s cache);
SELECT-different-device works end-to-end; RE-SELECT SAME DEVICE WAS
BROKEN — exact cause of the operator's two-step: `applyEngineCaptureDevice()`
(companion_server.js:787) guarded on device-string CHANGE, so after
terminal give-up (`capture_failed_repeatedly`) re-picking the same mic
did nothing — companion (sole OSC analyzer) stayed deaf; picking
DEFAULT first worked only by forcing the string to change. FIX 1:
companion_server.js :778-800/:1094/:1237/:1250/:1255 — re-arm capture
when a config frame re-asserts the same device AND capture terminally
gave up (reconciliation, loud log; healthy capture doesn't churn on
echoes — 38→38 sourceStatus regression check). FIX 2:
CaptainPad/app/(tabs)/audio.tsx :115-152/:1385/:1560-1573/:1622-1630 —
device card no longer lies under `capture.device: test` (showed a
real mic + ACTIVE while synthetic generator ran); now shows "TEST
SIGNAL — Companion synthetic generator" + red explainer, no ACTIVE
row unless a mic is pinned. Tests: CaptainPad 790 pass + tsc clean;
engine = 6 known baselines + 1 effects_v2 IPC flake (47/47 alone).
audio_state.yaml restored to pre-session values; ports freed. NOT
IMPLEMENTED (recommendation): engine tries to open 'test'/'file:'
sentinels as real dshow devices → error-loops when companion is on a
non-mic source — real defect, bigger fix. DEPLOY of fix 1 to
titanic-ext was permission-blocked for the agent → coordinator ran it
(see in-flight).

**Station-mapping wave plan (paused at S2):** `S0 ∥ S1(done) → S2 →
S3 → S4`.
**STACK EVENT (2026-07-25 ~04:17 local):** operator's stack went DOWN
while he was offline (all 6 ports dead; not caused by any agent —
possibly shut down before leaving). Coordinator restarted it per the
launcher law: `node launcher.js prod --scene titanic`. All services
up; **`_20` priority hardening verified live: engine + both bridges +
launcher parent all log requested=HIGH achieved=HIGH.** Engine:
titanic 981 px, render-only (0 patched — expected, patches empty).
Noise flags: VSN1 page-0 deploy FAILED (Lua action string 5960 chars >
device limit 909) + a libuv assertion in that path — engine kept
running; pre-existing device-config issue, follow up separately. A
stale browser client tagged 'test_bench' reconnected to the bridge at
boot (old tab somewhere) — bench controllers offline, harmless.
**FOLLOW-UP EVENT (~04:18):** a real Chrome window loaded
`?scene=test_bench` and an explicit /scene switch restarted the
engine titanic→test_bench (now healthy on test_bench,
02_phase_cathedral, renderHealth ok). The LAUNCHER PARENT exited
code 1 around the engine-child restart (VSN1 libuv assertion
suspected aggravator) — ALL SIX SERVICES SURVIVED and run unsupervised
(`node launcher.js stop` still the clean stop). Coordinator did NOT
switch the engine back (unknown whether the switch was the operator —
no last-writer-wins fights). NEW FOLLOW-UP CANDIDATES: (a) VSN1
deploy Lua exceeds device 909-char limit + crashes native assertion —
needs guard/fix; (b) launcher parent dying on engine scene-switch
restart deserves a look (supervision gap).
3. **S2 QUEUED** (after S0+S1+`_37`; gui_builder + config.js
   single-owner): wire trace_chains into circle traces +
   traceGenerated re-stamp. → `20260724_34`.
4. **S3 QUEUED** (after S2): scene restructure through the LIVE app UI
   per design `_32` (stations rename, par replacement, smokestack
   chains, TE Sign 2, orphan cleanup, Smokestacks view; ~/tmp backup;
   autosave on; never restart stack). → `20260724_35`.
5. **S4 QUEUED** (after S3): engine model re-export + pixel census +
   campaign report. → `20260724_36`.
6. **Color transition optimization** (Fable, research+implement+test,
   operator order, IN FLIGHT) — replace naive RGB lerp with
   perceptually optimal interpolation (evaluate OKLab/OKLCH vs
   CIELAB/CIELCH vs CAM16-UCS; operator's "Java colors lab library" =
   CIELAB family). Inventory ALL transition sites (sim gradient
   stops, engine crossfades/mixer; VM-side pattern math report-only);
   pure modules, no runtime deps, per-pixel-per-frame perf budget
   with benchmarks; hue shortest-arc + achromatic + gamut mapping;
   gui_builder.js LOCKED (owned by `_37`) — document any needed UI
   edit instead of making it. Visual side-by-side proof on hard pairs.
   → `20260724_38`.
**Design `_26` LANDED** (see Landed). Operator decision points from it:
(D1) stateless generator buttons (RECOMMENDED, designed) vs persistent
trace-style cards with Regenerate; (D2) second sign click: confirm +
`TE Sign 2` (designed) vs hard-block (only one physical sign exists);
(D3) cosmetic rename DMX "Light Instances" → "DMX Fixture Instances";
(D4) sign groups pinned top (designed) vs bottom; (D5) glyph ✨ vs 📐.
Proceeding on designed defaults unless operator objects.
Scene change (operator): several LED strands REMOVED as unneeded —
agents must re-read live state, never restore them. **Pre-commit
consequence: titanic engine model needs RE-EXPORT again** (strand
removal changed the pixel map after the _21 export).
Standing constraints: TE Sign V3 YAMLs canonical/read-only; each side
one strand on its own controller; pixel-ORDER model update INCOMING.
Held: punch (g) doubled strands.


**Observation #11 RESOLVED by machine reboot:** whole-machine/all-
Chrome flicker was accumulated Chrome-GPU-process/driver state —
operator confirms post-reboot "flicker is gone gone, performance is
great." H2 closed. Writer-#2 (H1) remains latent → option-(ii)/
Phase 1 fix still on the table (decision #12).

## Queued

- **2D-vis feedback round 1 (HELD — operator is testing; batch with his
  further findings, then one fix agent):**
  (a) top_down chimney rings render far-right (one hidden UNDER the
  Lighting Controls drawer) — move both to sit centrally among the LED
  strand clusters (shipped default in view placements, stays
  data-editable);
  (b) multiview canvas extends under the open Lighting Controls drawer —
  container must yield the drawer width when open and reflow on close
  (mirror the 3D split's drawer handling);
  (c) 2D views scene-portability — titanic-authored default views don't
  necessarily work on other scenes (test_bench etc.); per-scene behavior
  must be handled correctly (sweep verdict: seed per-scene defaults;
  Smoke Stacks panel banner on test_bench is the visible symptom);
  (d) engine↔sim scene sync affordance (operator asked "can we keep them
  synced?"): header indicator "⚡ Engine: <scene>" (amber on mismatch) +
  EXPLICIT one-click "Sync engine → <viewed scene>" + optional off-by-
  default per-session "follow me" toggle. NEVER auto-follow viewers —
  that re-creates the last-writer-wins bug the bridge fix just killed;
  (e) **LED strands still missing groups** (operator, live testing) —
  LED strands lack the DMX-style group feature in practice (Lighting
  Controls folders/assignment); TE Sign parity landed but strand grouping
  is incomplete — investigate the actual UI path, not just the registry
  contract;
  (f) **Master Enabled semantics wrong for LEDs** — with Master disabled,
  operator expects ALL LEDs black; instead they keep emitting and only
  lose the halo. Find where master gates DMX emission vs LED emission
  and make LEDs honor it fully (sim render AND any output implications);
  (g) **LED strings render as ~2 strands / doubled** — strands appear
  duplicated ("2 strands or something"); suspects: instancing wave
  double-draw (sprites + instanced bulbs), S1 strand-identity split
  showing one physical strand as two clusters (2D), or scene data.
  Fix agent must check BOTH 3D and 2D representations and name which;
  (h) **TE Sign belongs under LED, and the section renames** (operator):
  the TE Sign currently appears in the "DMX Fixtures" menu — move it to
  live with the LED strands, and rename that section "LED Fixtures".
  Consistent with the standing "TE Sign = LED type" ruling; watch the
  scene-config representation (it lives in `parLights` today) — the fix
  must not break patching/groups/`TE Sign (2)` select or the A≡B
  transform invariant.

- Writer-#2 arbitration implementation — after the operator picks option
  (i)/(ii)/(iii) (see decision queue).
- 2-minute eyes-on A/B (`~/tmp/ab_writer2.cjs` staged) — on operator "go".
- Premap execution + W-slices — wait on operator decisions.
- **Pre-commit: re-export the titanic engine model from the CURRENT scene**
  — sweep verdict: `titanic.*` models are an 11:05 snapshot (has S1
  localIndex + 1147 px) regenerated BEFORE the 15:10 TE Sign swap; still
  encodes TeLedGrid40, zero TE Sign (live map 1141 px = 1147−80+74). Do
  NOT ship the stale snapshot.
- Pre-commit residue to exclude/refresh: engine runtime state
  (`globals_state.yaml`, `audio_state.yaml`, untracked `vsn1_layout.yaml`),
  CRLF-only churn (`manifest.json`, `common.yaml`).

## Duplicate-work guard

- **`syncGuiFolders` ReferenceError (gui_builder.js:1708)** — ALREADY FIXED
  on `feat/bm_readiness` by the glitch sweep (report `20260724_5`): proper
  `export` at `interaction.js:178` + static import at `gui_builder.js:27`.
  Verified in tree 2026-07-24. The separate operator session spawned for
  this same bug has ENDED — do not re-fix.

## Landed today (2026-07-24)

- Foundation review `20260724_0`; perf root-cause `20260724_1` (render loop
  exonerated on GPU; lag = panel); split-screen shell `20260724_2`;
  engine hot-reload universe fix G10 `20260724_3`; panel perf ~10× +
  reverse link + left-dock flip `20260724_4`; **glitch sweep `20260724_5`**
  (G6/G7/G8/G9 + Lighting Controls select-all ReferenceError; 293 sim
  tests, wire-parity proven for G9); views & overlays playa design
  `20260724_7`; **CaptainPad namedViews picker W1 `20260724_8`** (shared
  sectioned/searchable picker on both view surfaces, 790 vitest pass + 28
  new, operator review pending — coordinator-initiated slice; 4 lint
  errors in `GlobalEffectMacros.tsx` pre-date W1); **emitter instancing
  `20260724_6`** (`full` 20→59.5 FPS, `emissive` 20→59.9 on real GPU;
  ~2,668 per-pixel meshes → 250 InstancedMesh + 80 Sprites; visuals A/B
  verified; **operator-confirmed "speed is day-night better"**).
- **2D-vis wave:** design `20260724_9`; S1 geometry core `20260724_10`
  (strand identity fix — 85→100 clusters, engine model byte-identical;
  radial/planar/lanes layouts; shared frame source); S2 view model
  `20260724_11` (views-as-data + 4 defaults; chimneys = TWO ×10-par groups
  → two radial rings); S3 pane shell `20260724_12` (pane tree/view/Preact
  container, injected deps, 51 tests); **S4 integration `20260724_13`**:
  multiview LIVE in `2d_pixels` (4 views seeded, migration, persistence,
  Views manager, focus-scoped keys; TE sign LED-class; TeSignV3 A+B
  registered — 8 fixture types load; **spatial/planar rewritten to true
  whole-panel projection** — top-down matches the 3D top render; 426/426
  tests; 6 panes 57.7 FPS real GPU; `pixel_map_renderer.js` retired).
  Gaps: EDIT drag only radial/lanes (deliberate); scene-YAML views
  round-trip unit-proven, not disk-exercised; pane polish descoped per
  operator (dropdown is enough).
- **LED grouping + TE Sign V3 `20260724_14`**: real sign installed —
  models `te_sign_v3/model_a_120.yaml`+`model_b_102.yaml` (provenance
  scrubbed, dots byte-identical), scene swap `TeLedGrid40`→`TE Sign V3
  A/B` group `TE Sign` identical pose, `te_sign_generator.js` (A≡B hard
  invariant, whole-sign placement), grouping parity proven. 426/426.
  **LIVE VERIFICATION ALL PASS**: labels 120/102ch; 74 px, bbox
  1.58×2.17 m; chase order correct, `rotY 180` NOT mirrored; seam
  disjoint, nearest A↔B 166.6 mm; `TE Sign (2)` group selects exactly
  both halves. Deferred: 2D te_sign view eyeball on real-GPU host.
  Tools: `agent_tools/tesign_verify*.cjs`.
- **Flicker/freeze debug + fix `20260724_15`: LANDED, wire-verified** —
  three mechanisms: (1) route flapping — every sim tab's `setScene`
  REPLACED the bridge's hardware route table (`sacn_input_source.js:116`);
  titanic = 0 routes → bench disconnected on every titanic tab load;
  (2) dual sACN writers — engine unicast U10/U12 to 10.x.x.202 + bridge
  relaying the engine's own loopback frames back (both from c6eaa733);
  (3) viewport GPU contention (fleet browsers + operator tab; zero JS
  longtasks during stalls; instancing + GC exonerated; engine cadence
  39 Hz clean). "Started today" activator = the agent fleet churning sim
  tabs. FIX LIVE: `simulation/lib/bridge_routing.cjs` union routes (CLI
  pin ∪ engine activeScene via new `/status outputRouting` ∪ refcounted
  client tags) − engine-owned pairs; flip-proof 5 tab cycles → 0 route
  removals; dual-write suppression live; wire 39.1 Hz max gap 29 ms;
  sim 436/436, engine 2091 pass/8 env; save server :6970 was dead
  pre-session — restarted by agent. Ops rule codified in
  `os/multi_agent.md` §9: agents close every sim page they open.

- **DMX dot-gate fix `20260724_40`: LANDED — bug was WORSE than
  filed**: titanic scene has ZERO patched fixtures, and
  `applyFixtureOutputOverrides` skips unpatched fixtures entirely →
  DMX group masters had NO effect on ANY rendered pixel (not just
  dots). Fix: `dmxOutputScale()`+`applyDmxEntryOutputGate()` (pure, in
  dmx_output_overrides.js) as one authority; `_applyDmxOutputGate()`
  in animate.js AFTER `applyFixtureOutputOverrides` (single-scaling on
  wire proven: 159→64 not 25.4); join by `entry.fixtureConfig` (same
  live object as the buffer gate — _27 keying trap structurally
  impossible); repaints direct-painted bulbs when unpatched;
  `outputGain()` delegates to same fn. Post-fix OFF ⇒ exact 0 on
  entry/2D/dot/bulb both regimes; 40% ⇒ exact ×0.4; 0.013 ms/frame.
  LED gate untouched (led_blackout_verify re-run PASS). New
  `dmx_blackout_verify.cjs` (+`--patch` in-memory patched regime) +
  16 tests. 542/542. **OPERATOR NOTES:** (1) visible change at boot —
  `Left Front Deck Generator` persisted at brightness:0 was rendering
  FULL, now correctly black (ties to `_32` open question #6: reset
  that override?); (2) NEW DECISION: DMX section's global Master
  Enabled (parsEnabled/dmxEnabled) is STILL visibility-only — the
  exact pre-_27 shape of punch (f); folding it in touches
  `outputGain()`/light pool, held for operator.
- **Audio Companion kick/distortion fix `20260724_39`: LANDED** — TWO
  independent bugs on the test source: (1) kick-always-off
  (long-standing): the `tone` synth's steady 55 Hz sub sits INSIDE the
  50–110 Hz kick window, pinning the adaptive ratio threshold
  (instant > ema×2.4) so the 80 Hz transient never fired — retuned
  synth (sub 0.28, kick 1.0, longer burst; ~10 kicks/6s both FFT
  sizes) + regression test; (2) distortion: engine runtime tuning had
  drifted `inputGain: 8.83` (stale mic calibration in
  states/test_bench/audio_state.yaml), synced over ws/control and
  applied to the full-scale synthetic source → 81.9% samples clipped.
  Durable guard: test source now renders at UNITY gain (immune to any
  persisted mic preamp — verified clean even with 8.83 still synced);
  `applyInputGain` fails loud on bad values; stale param-seed literal
  in companion_server removed. Engine's persisted 8.83 NOT hand-edited
  (engine-owned runtime state; test source decoupled anyway) —
  operator can reset inputGain in MIC TUNE if the real mic path runs
  hot. OSC out proven (/marsin/mic/kick ~55 Hz w/ envelope). Engine
  suite 2126/2133 (7 pre-existing env fails, zero new). Only the
  Companion process was restarted; engine/sim untouched.
- **Generator rename-orphan fix `20260724_37`: LANDED** — root cause:
  trace-name onFinishChange set `trace.groupName` to the NEW name
  BEFORE regenerating, so the sweep (which removes by current name)
  matched nothing → old fixtures orphaned as duplicates (with orphaned
  overrides + view bits); the exact mechanism behind the 12 committed
  orphans from `_32`. Fix: remove-old-first semantics — fail-loud name
  guard (reverts input), carry group master override + view-mask bit,
  set new name, regenerate sweeping OLD name via new
  `previousGroupName` param on `generateGroupFromTrace` (3rd param
  defaults null = prior behavior). New pure
  `simulation/src/gui/trace_group_rename.js` + 12 tests + live
  `agent_tools/trace_rename_verify.cjs`. config.js unchanged (re-stamp
  pinned by test). LED ✨ flow unaffected (renames via _28 paths).
  Both directions + double-rename proven live (REPRO→FIX→GUARD, zero
  scene writes). 519/519. Pre-existing 12 scene orphans left for S3.
- **S1 trace_chains `20260724_33`: LANDED (new files only)** — pure
  `simulation/src/dmx/trace_chains.js` (`chainPlan`/`chainGroupNames`;
  splits ∈ [1,4], mirror/sequential layouts, startAngle fold, fail-
  loud on all bad inputs) + 23 tests; suite 519/519. KEY FINDING for
  S2: gui_builder's arclength arithmetic is NOT reproducible by naive
  degree math (1-ULP divergence) — module replicates the exact
  sequence; splits=1 proven strict `===` against a verbatim oracle on
  real titanic smokestack params (10/10 dots bit-identical + 6 more
  geometries). S2 contract: place fixtures from `points` (authoritative,
  local space, pre-transform), chain-major naming `<group> <i+1>`,
  `angles` display-only; buildTracePath change must use
  `startRad + (s/length)*arcRad`; count is per-chain when splits>1;
  pointOffsets kept for splits=1, disabled for splits>1; group names
  union with legacy `trace.groupName` in regeneration sweep AND
  config.js traceGenerated re-stamp.
- **Commit snapshot #2 `20260724_31`: COMMITTED on feat/bm_readiness
  (NOT pushed)** — `34c8c52f` sim LED-wave code (16 files, slices
  22–29 + NUL sentinel fix `'::new::'`/`'::ungroup::'` — file diffs
  as text again); `cdccabde` titanic scene state + re-exported model
  (**1141 → 981 px** after the 8 `Small_*` strand removals; TE Sign
  74 px present; viewmasks bit matches views.yaml); `d091977b` .agent
  docs (_21.._32). gui_builder.js integrity: NO broken partial edit —
  the cancelled S2 generator UI is complete and valid; committed.
  484/484 tests. Security: commits 1–2 first-try PASS; docs commit
  failed on a `_21` self-leak (its security section quoted the IPs it
  redacted) — re-redacted → PASS. Exclusions documented in `_31`
  (engine runtime, timestamp churn, session churn, CRLF-only, junk
  files incl. stray `led202.*` 0-pixel export). Model re-export via
  readonly tab, zero sACN, show undisturbed.
- **Titanic station mapping design `20260724_32` (Fable, DESIGN ONLY):
  LANDED** — target: 64 pars / 16 groups / 8 strands unchanged / 1
  custom view. 4 wall stations = existing wall traces renamed
  (Left/Right Front/Back Wall, 5× ShehdsBar each); 4 top-deck vintage
  stations renamed + 8 NEW top-deck pars in 2 side groups of 4
  (REPLACING 7-count Center Auditorium par groups; reading "16 vintage
  + 8 pars" flagged as D3); smokestacks: per stack 2 chains × 4 pars,
  index 1 nearest start, CCW/CW fan ±22.5° for even 360°; umbrella
  "all together" = custom VIEW `Smokestacks` (groups don't nest; NOT a
  power master — flagged); TE Sign 2 starboard via ✨ generator flow
  (U10–13 proposed, patching deferred to bench). NEW FEATURE: circle
  trace params `startAngle`+`splits` (+splitLayout) with pure
  `trace_chains.js`; `splits:1` byte-identical to today. CLEANUP: 12
  orphan duplicate fixtures found (trace-RENAME ORPHANING BUG at
  gui_builder.js ~L3743) — design says delete; all patches currently
  EMPTY = cheap window for renames. 14 offline defaults in §8; 7 open
  questions for operator in §9 (headliner: 4+4-per-station vs
  16v+8p reading — changes fixture counts).
- **LED blackout semantics `20260724_27`: LANDED (absorbs punch (f))**
  — root cause: each LED strand pixel has FOUR consumers; `_24` gated
  only the per-strand meshes, while the global V2 instanced-dot flush
  (`_pixelInstancedMesh` in animate.js — the visible residue dots),
  the 2D pixel map tap, and the sACN output map all read the raw
  `_batchRenderList` entry color ungated. Punch (f) same bug: Master
  Enabled OFF only hid the THREE group. Keying trap: live scene now
  has 8 strands ALL Ungrouped; exporter tags pixels by strand name but
  the master keys on the 'Ungrouped' display bucket — an entry.group
  gate would have silently no-op'd; fixed with runtime-only
  `entry.displayGroup` field. Fix: ONE authority `ledOutputScale()` in
  group_lock.js (master OFF⇒0, group OFF⇒0, else brightness) applied
  by `_applyLedOutputGate()` in animate.js after all color sources,
  before sACN out + dot flush + 2D tap, plus exporter/static-preview
  scaling. Proof live: GROUP OFF and MASTER OFF ⇒ entry/2dDecode/bulb/
  halo ALL exactly 0 (ON baseline 1.9961); remaining glow = DMX
  generators, correctly ungoverned. 484/484 tests. Verify tool:
  `agent_tools/led_blackout_verify.cjs`. No gui_builder edits.
- **LED drawer flatten + rename `20260724_28`: LANDED** — Sign
  Fixtures / LED Strands subfolders removed; TE Sign group + strand
  groups + toolbar render as ONE flat list under 🔌 LED Fixtures;
  `window._ledFixtureInstancesFolder` = the section folder; par/strand
  renderers share the parent but tear down only their own folders
  (strand edit can no longer destroy TE Sign folders). REAL rename bug
  fixed: strand rename orphaned `ledGroupOverrides` (lock+brightness)
  — now carried old→new; fail-loud collision guard (empty/reserved/
  duplicate) on strand Rename, Add Group, Move→New, and TE Sign
  rename. 483/483 tests; 15/15 isolated live DOM checks (autosave
  aborted, operator scene untouched); 3 captures inspected.
- **LED generator S1 catalog `20260724_29`: LANDED (new files only)**
  — `led_generator_catalog.js`: pure fail-loud catalog, sole entry TE
  Sign (target parLights, bornLocked, build→buildTeSign), load-time
  validation; `uniqueGroupName` dodges target groups + trace names +
  reserved Ungrouped; `runLedGenerator` enforces one-group output
  contract. API for S2: LED_GENERATORS / LED_GENERATOR_TARGETS /
  RESERVED_GROUP_NAME / getLedGenerator / uniqueGroupName /
  runLedGenerator / assertGeneratorFixtures (+ per-entry
  `defaultGroup`). 23 new tests; suite 478/478.
- **LED generator workflow design `20260724_26` (Fable, DESIGN ONLY):
  LANDED** — mirrors the DMX split: `✨ Generators` folder under LED
  Fixtures driven by a pure catalog module (`led_generator_catalog.js`,
  sole entry TE Sign); flat list titled **"LED Fixture Instances"** as
  a VIEW not a data store (data stays in params.parLights — patching/
  select/master/rename/lock/A≡B unchanged); generator STATELESS
  (option A, no new YAML keys; the locked group is the editing
  surface); second-click guard: confirm + unique `TE Sign 2` group
  (prevents silent 4-halves fusion); future-generator seam = catalog
  `target` dispatch. ZERO scene migration. Slices S1 (catalog, new
  files) / S2 (gui_builder, after flatten+rename) / S3 (live verify
  tool). Incidental: `\0` in gui_builder.js is the intentional
  `'\0ungroup'` Move…-dropdown sentinel, not corruption.
- **LED-C group lock + generator + real LED master `20260724_24`:
  LANDED** — new pure module `simulation/src/core/group_lock.js` (lock
  predicate, member collection, TE-sign classifier, LED master RGB
  scale; 13 unit tests). 🔒 on both group toolbars; `locked` flag in
  `groupOverrides` (par) / new `ledGroupOverrides` (strand), persists
  via save/load. Rigid moves: par groups via gizmo differential
  (`interaction.js computeRigidMoveIndices`) AND numeric inputs;
  strand groups via numeric Start/End. TE Sign rigid moves route
  through `applyTeSignPlacement()` in BOTH paths — A≡B unbreakable.
  Generator `✨ + TE Sign (A+B)` births groups locked. REAL LED group
  master: brightness/On-Off scales the direct-paint path
  (exporter apply closure → `scaleRgbForGroup`, live per frame) +
  static preview; blackout unbeatable. Live verify ALL PASS
  (`agent_tools/group_lock_verify.cjs`, `.agent_renders/glock_*`);
  455/455 tests (442+13). OPERATOR NOTES: existing scene TE Sign group
  loads UNLOCKED until 🔒 pressed + saved (no `locked` in old YAML;
  regenerated signs are born locked); don't name a strand group
  literally "Ungrouped"; strand gizmo handle-drag writeback is a
  pre-existing unwired path, untouched (strand rigid moves are
  numeric-input driven).
- **LED-B "LED Fixtures" rename + grouping parity `20260724_23`:
  LANDED (absorbs punch (e)+(h))** — section renamed `🔌 LED Lights` →
  `🔌 LED Fixtures` (titanic + test_bench scene_config + new-scene
  template in save-server.js); TE Sign STAYS in `params.parLights`
  (patching/groups/`TE Sign (2)`/A≡B byte-untouched) but UI-homed under
  LED Fixtures → 🪧 Sign Fixtures via `bus: led` classification in
  renderParGUI. LED strands got DMX-style group folders: Select All,
  visibility, Rename (carries view-mask bit), +Strand, Ungroup, ➕Add
  Group, per-strand →Move…; TE Sign full parity incl. group master via
  groupOverrides. DMX Fixtures regression-guarded (14 groups, no TE
  Sign). 442/442 tests; drawer capture `.agent_renders/
  led_fixtures_drawer.png`. Extension points for LED-C documented in
  report §. LED-strand group master OUTPUT effect deliberately deferred
  to LED-C (would've been a fake control — strands direct-paint).
- **LED-A TE sign black background `20260724_22`: LANDED** — root
  cause: TE Sign V3 YAMLs declare `shell: {type: box, color: #0a0a0a}`
  and `dmx_fixture_runtime.js` drew it as an opaque unlit black box
  (shell = physical fixture body, right for pars, wrong for a luminous
  sign; other LED fixtures carry no body). Fix: shell construction
  gated on `!this._isLed` — LED-bus fixtures build NO body mesh; DMX
  untouched; model YAMLs untouched (robust to pixel-order regen);
  A≡B/patch/groups/instancing unchanged. Artifact was 3D-only (2D
  clean). Before/after renders in .agent_renders/ (1784943103/334
  led-grids etc.); 442/442 tests. All render browsers closed.
- **beforeunload removal `20260724_25`: LANDED** — sole active handler
  was `gui_builder.js` ~:480 (unsaved-changes net for :6970 save flow):
  kept the on-unload `sendBeacon` save flush, deleted only
  preventDefault/returnValue. **Safety net gone by operator order** —
  remaining protection: beacon flush + `● UNSAVED CHANGES` chip +
  Recover-scene backups. Live-verified: reload + navigate-away → zero
  dialogs, beacon still fires; 442/442 tests. Surgical one-hunk edit;
  gui_builder.js overlap with LED-B noted (handler block only).
- **Commit snapshot `20260724_21`: COMMITTED on feat/bm_readiness (NOT
  pushed)** — `d631c5c6` product code (78 files, incl. fresh titanic
  model re-export: 1147→1141 px, 74 TE Sign entries present, TE LED
  Grid 80→0, viewmasks groupBit updated; export via readonly puppeteer
  tab + saveModelJS, live show untouched) + `22d57138` Agent OS docs
  (30 files, reports _0.._20 + laws + tracker). Security gate PASS —
  first run FAILED with 24 show-LAN IP findings in today's reports;
  redacted to 10.x.x.NNN per security_privacy.md, re-ran, PASS. No
  bypass. Exclusions left uncommitted: marsin_engine/states/** runtime,
  test_bench model timestamp churn, common.yaml lightingProfile flip,
  test_bench scene_config preview values, CRLF-only files, a
  pre-existing 0-byte junk file. **Operator eye: common.yaml
  lightingProfile 2d_pixels→full + test_bench masterExposure/
  maxSpotlights judged session churn and excluded — still in working
  tree if actually intended.**
- **Cold review A `20260724_17`: diagnosis complete, AGREES with `_15`,
  CONVERGES with B** — H1 (high confidence): in `sacn_in` mode the sim
  tab is a prio-150 sACN hardware writer inside Chrome's rAF loop
  (`animate.js:543-590`, prio at :576, via :6972); tab focus is
  literally the on/off switch of writer #2 fighting the prio-100 relay.
  H2 (residual): Chrome-INSTANCE-level ~1s jank supplies the raw stalls
  while focused (fresh page on same URL stall-free headless AND headed
  on RTX 4090 at 59.9fps → not sim-page JS); H1 exports the stalls to
  the lights, blur erases them. All 10 observations explained; obs #9 =
  same E1.31 ~2.5s source-loss handoff B found (independent). Obs #10
  audio → residual stall is Chrome-instance/system-wide; the ONE open
  item: needs a 2-min operator-present trace to pin exactly. Engine
  time-loop ruled out (3× cadence probes p50 39.8fps). Launcher arms
  writer #2 itself (`launcher.js:102-121` auto-opens sacn_in tab).
  **NEW interim option: `readonly: 1` in the prod profile simParams —
  one line, kills writer #2/focus coupling/handoff freeze tonight**
  (trade: that tab's per-fixture overrides stop reaching hardware).
  Real fix: decision #12 option (ii) — same as B and `_19`; explicitly
  diverges from `_15`'s option (i). All probes closed.
- **Cold review B `20260724_18`: diagnosis complete, AGREES with `_15`**
  — #1 mechanism: in `sacn_in` mode the sim page is itself a prio-150
  sACN hardware writer clocked by Chrome rAF (`animate.js:543-590` →
  :6972) on top of the bridge's steady prio-100 relay; hardware output
  enslaved to Chrome tab health; on-screen flicker = Chrome GPU/present
  starvation under external GPU load (data feed measured flawless:
  39.3fps, maxGap 41ms, zero gaps). Obs #9 (tab-away small freeze) =
  E1.31 ~2.5s source-loss hold before fallback to relay. Obs #10
  (audio): machine-wide stall RULED OUT (zero event-loop gaps >100ms in
  180s) → points at Chrome's shared GPU process; speaker-audio would
  need admin DPC capture. Engine time-loop REFUTED. Adds 3 latent
  hazards `_15` missed: global-not-per-universe bridge arbitration
  (`sacn_bridge.js:415`), `reuseAddr:true` on Receiver (:410), missing
  `127.0.0.1` skip in `animate.js:564`. Minimal fix = option (ii)/
  Phase 1 of `_19` (guarding animate.js alone is too naive — it carries
  operator overrides). Interim: ONE sim window during bench, shed
  non-stack GPU load. Note: both controllers TCP-unreachable during
  probe (bench likely powered off). Confidence: high on mechanism.
- **Engine priority hardening `20260724_20`: LANDED (code-only, live
  stack untouched)** — new shared `tools/process_priority.cjs`
  (elevateSelf/elevatePid, always logs `requested=X achieved=Y`, no
  silent fallback); engine self-elevates (env `BM26_ENGINE_PRIORITY` >
  CLI `--engine-priority` > config > `'high'`); launcher passes env +
  parent-side belt via real engine pid (survives scene-switch restart);
  both sACN bridges elevated (self + parent). Default HIGH everywhere;
  REALTIME opt-in, honestly reports downgrade without admin. Jitter
  proof (25ms tick, 64-worker load): NORMAL mean 3.40ms/12% ticks
  dropped → HIGH mean 0.49ms/drops recovered (~7×). New 11/11 tests;
  engine suite 2103/2110 (7 pre-existing env fails, < baseline 9).
  **Activation: operator's next relaunch** — look for `[EnginePriority]
  requested=HIGH achieved=HIGH` + two `[BridgePriority]` lines. Live
  engine pid 4748 still reads Normal (untouched, the vulnerable case).
- **Router-in-engine design study `20260724_19` (DESIGN ONLY, no code)**:
  recommendation **GO, phased** — engine becomes the only hardware writer
  by extending `output_dispatch.js` in-process; universe→destination truth
  moves into the engine model (patches.yaml stays authoring surface,
  exporter bakes controller table, per-box overlays); operator per-fixture
  Off/Brightness overrides become an engine pre-send buffer stage +
  `GET/PUT /output-overrides` API (WS broadcast, `states/` persistence);
  sim tabs become pure viewers in `sacn_in` mode (`animate.js` relay
  branch dies); browser-generator bench modes keep :6972 so sim-without-
  engine bench driving survives. **Resolves decision #12 as option (ii)**
  with evidence option (i) would keep hardware chained to tab focus.
  Effort ~1–1.5 weeks in 3 rollback-safe phases; Phase 1 (overrides →
  engine + sacn_in tabs stop writing) alone removes Chrome from the write
  path. Key risks: engine = delivery SPOF, stale model exports become
  hardware-affecting (needs model-hash guard), override replay on restart
  must be exact, console-via-bridge relay dies in Phase 3. Operator
  decisions: approve option (ii)/Phase 1; confirm nobody uses console-via-
  bridge relay; pick overlay home for per-box controller declarations.
- **Integration sweep `20260724_16`: ALL GREEN** — sim 436/436 + all
  smokes/perf gates; engine 2094/9 (all 9 pre-existing env flakes, +3 new
  passes); CaptainPad tsc 0 / 790 pass. Security gate PASSES on
  commit-eligible files (21 MAC findings all in gitignored
  `.scene_backups/`). Titanic-model mystery SOLVED: 11:05 S1 export,
  stale vs the 15:10 TE Sign swap → re-export before commit. test_bench
  2D views: loads, main panels render, titanic "Smoke Stacks" panel
  shows a loud scoped no-match banner — acceptable-but-untidy, seed
  per-scene defaults (punch list). New finding → decision #14
  (auditorium fixture overlap).

## Operator decision queue (blocking)

**Premap trio (blocks all physical premapping):**
1. Physical wiring plan — controller count/IPs, output → strand/par.
2. 70-vs-84 fixture-name mismatch (titanic patches.yaml vs parLights) —
   which is authoritative?
3. Art-Net vs sACN per titanic controller.

**Views design six (from report `20260724_7`):**
4. Group-name normalization direction (gates W2 regen fix).
5. INTERIOR view membership.
6. SAFETY_MIN never-dark exterior set.
7. Night-arc show design (incl. TE Sign duty).
8. View-scoped global effects — recommend defer.
9. BAND thirds vs authored heights.

**2D-vis (from design `20260724_9`):**
10. Multiview exclusive to `2d_pixels` profile — S4 proceeded with this
    recommendation; veto still open.
11. Smoke stacks: TWO 10-par chimney groups shipped as two rings
    (data-editable) — confirm or name exact fixtures.

**Flicker/freeze round 2 (`20260724_15` §7): CLOSED** — bridge poll
CLEARED (zero recompute churn, wire clean); engine time loop CLEARED
(setInterval coalesces, monotonic clock, 39.1Hz/40ms-max on wire);
2-clients NOT sufficient alone (controlled A/B incl. pixelblaze: ≤1
freeze/100s) — rhythm required full afternoon load stack; content
golden_hour_wash has ~1.99s level cycle (perceptual cross-check).
FORWARD PLAN on next occurrence: operator F5 (session-age vs code
split); if survives, ping coordinator, close nothing — agent attaches
live. **LANDED: multi-client warning** — bridge client census broadcast
+ red HUD banner in every window when count>1
(`simulation/src/gui/multi_client_warning.js`), 6 tests, sim 442/442,
live-verified 2→3→2. Bridge now pid 30416 (census build).

**Flicker/freeze (from debug `20260724_15`):**
12. **Writer-#2 kill design** — in sacn_in mode the browser's sACN-out
    ALSO delivers per-fixture Off/Brightness overrides to hardware.
    Options: (i) input-bridge stands down per (universe,ip) while a
    browser drives it; (ii) sim-out stands down, overrides move
    server-side; (iii) rely on receiver priority (broken on these
    gateways). **Design study `20260724_19` recommends (ii)** — option
    (i) would keep hardware chained to Chrome tab focus, the exact
    observed failure. Held for operator.
13. **2-minute eyes-on A/B** — operator watches bench during scripted
    phases to tie the visual symptom to the wire signature. Staged,
    awaiting go.

14. **Left Center Auditorium overlap** (sweep finding): new *Left Center
    Auditorium* fixtures spatially overlap *…Generator* fixtures (5+
    overlap warnings) — confirm intentional double-patch or fix.

**Small confirmations:** CaptainPad namedViews picker keep/drop verdict;
lag-on-GPU-laptop calibration; sim stack restarted onto MAC-fix code
(marks the now.md commit blocker resolved).

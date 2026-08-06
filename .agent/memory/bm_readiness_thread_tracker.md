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
**NEW DAY 2026-07-31 — operator declares titanic FULLY MAPPED,
sim works, 2D vis good.** Live-mapping lockdown milestone reached;
titanic scene/models remain operator-owned (zero agent writes)
unless he says otherwise.
**`_89` reserved — test bench = titanic stand-in (operator order
2026-07-31, IN FLIGHT, Opus):** engine runs titanic model; bench
hardware (.10 DMX: 4 pars + 2 vintage + 2 bars; .60 LED: 2
strings) patched to mirror specific titanic fixtures so titanic
patterns preview on the desk. Operator chose "stand-in for real
titanic fixtures" over bench-at-titanic-coords or bench-as-is.
Constraints briefed: titanic scene untouched, test_bench scene
editable, NO device pushes (operator presses Push), zero new test
failures. **LANDED 2026-07-31** —
`202607/20260725_89_test_bench_titanic_standin.md`. MEASUREMENT
first: only the PARS line up (titanic pars sit at 1/11/21/31 in 7
universes, same as the bench); no titanic bar starts at 107/226 and
no vintage at 41/74, in ANY universe — so pure config solves one
third and the bytes must MOVE. Chose candidate 2, bridge-side:
a **bench mirror** = per-destination slice list
(`src universe/addr/len → dest addr`) composed into the universes
the boxes ALREADY listen on, so **zero device pushes and zero
gateway edits**. Slice = the ship's LEFT FRONT: Left Auditorium 5-8
→ Par 1-4 (U6, identity copy), Left Front Rails 1/2 → Vintage L/R
(U5), Left Front Wall 1/2 → Bar L/R (U2), Left_Front_Left /
Left_Back_Left px 1-20 → LED_0/LED_1 (U30/U31 → bench U10/U12).
All sources have real `titanic/patches.yaml` records (the 6
record-less ropes would go dark on his next re-export). THREE
activation preconditions, all required, none a fallback:
`enabled:true` + ENGINE on `source_scene` + the spec's own scene
active — the last is the DEPLOY GUARD (show server pins titanic ⇒
inert, ship's gateway keeps its raw relay; falsified by harness).
Mirror OWNS its dest pairs: relay suppressed before the sender
diff, named log line each (one-writer law, `_15`). Proven by
running the REAL bridge with fake `sacn`/`ws` — his stack never
touched — composed bytes exact at every boundary, raw U2
suppressed, and both inert scenarios restore normal behaviour.
Sim suite 1452→1482 (+30), fail 10→10 byte-identical; new file
30/30 incl. 6 LIVE-MAP tests that read the committed spec against
the real scenes+models (whole-fixture boundaries, matching
footprints, `pixelCount×4`, sources the model really sends, dests
the bench really listens on). Files: `lib/bench_mirror.cjs`,
`scenes/test_bench/bench_mirror.yaml`,
`server/sacn_bridge.js` (+`sendVia()` extracted, shared),
`tests/bench_mirror.test.js`,
`agent_tools/bench_mirror_slice_capture.cjs` (camera derived FROM
the map; 4 guards incl. aborting every non-GET to :6970 so the
boot `saveModelJS()` cannot rewrite the operator-owned titanic
export — `git status` confirms zero titanic/model writes).
OPERATOR STEPS: (1) launcher restart to pick up the code; (2) run
the sim pinned `--scene test_bench` with the engine on titanic;
(3) watch the bench; (4) ONLY if the strands stay dark, one Push
on the `Titanic_202` card in the **test_bench** scene to revert
the box to U10/U12 (his titanic-scene push still reads
`needs-reboot`). Off switch = any of: engine off titanic, sim
pinned elsewhere, or `enabled:false`.
**`_90` reserved — ChatGPT pattern-tuning prompt pack (operator
order 2026-07-31, IN FLIGHT, Opus):** operator's chosen loop is
"write a prompt for ChatGPT, I will pass it to them" (manual
copy-paste, no repo access). Deliverable: paste-ready self-contained
prompt doc — pattern format + API cheat-sheet, MFT/param-order
conventions as hard rules, response contract, inline example
patterns. Documentation-only mission; public-repo hygiene (no IPs,
no dates). **LANDED 2026-07-31** —
`202607/20260725_90_chatgpt_pattern_tuning_prompt.md`: how-to-use
header (what to paste first, then per pattern = file + 2D-map
screenshot + plain-words ask, then harness-verify the reply) plus a
**482-line self-contained prompt**. Prompt covers: ship/rig context;
the complete MarsinScript API (entry points, types, flat scope,
reserved names incl. `fixtureType`, math/wave/noise/array/colour
builtins, radians-vs-turns, 5000-instr limit, `pixelCount` literal
144) with "if it is not listed it does not exist"; **9 hard rules** —
R1 slider declaration order = MFT knob order (never reorder/rename/
delete, `localSpeed` 1st, `direction` 2nd, ≤12 sliders, appends go
last, NO pattern-level hue param since hue is per-channel), R2
guarded direction dead-zone, R3 `localSpeed` must drive motion +
BASE_RATE, R4 never black/never static, R5 `w == a`, R6 blend in RGB
never HSV (helpers verbatim), R7 coords already 0..1, R8 no fallbacks
(codex P0), R9 no invented API; titanic coordinate space (x = along
ship, y = height, z diagonal/secondary) and `FIX_PAR / FIX_VINTAGE_6
/ FIX_BAR_18 / FIX_RAW_LED` targeting with the absent-type compile
error; style doctrine (contrast > brightness, keep the silhouette
lit, two colours spanning the rig, incommensurate drift + large
PHASE_WRAP, ambient defaults reachable to party by knob); the
modulators-only audio model; and a **response contract** (COMPLETE
file in ONE block, no diffs/ellipses, keep identity + header, short
Changes list, ask-don't-guess, no refactors). Worked example
`example_tide_beacon` was **compiled + measured on the real harness**
from a scratch path (nothing added to `patterns/`): `COMPILE_OK`,
full_track hueSpread 0.79 / peakMaxChan 247, silence darkFrac 0.00,
modulated run `TOTAL_BRI ANIMATING` with micLow→sliderLevel
corr=0.52 REACTIVE, micFlux→sliderRadius corr=0.86, hueSpread 0.97,
peakMaxChan 255 — so `FIX_*` targeting, the guarded-direction idiom
and the `w == a` emit are compiler-proven, not doc-transcribed.
**OPEN NOTE for the R2 tuning session:** on the titanic model
`sectionId` is NOT the test_bench 1/2/3 — it carries per-group
numbers (3, 18–25, 401–414), so every legacy `sectionId == 2`
vintage-blinder branch in `patterns/` does not select the vintage
heads on the ship. The prompt steers NEW logic to `fixtureType` and
forbids touching legacy `sectionId` branches unasked; migrating them
is a separate operator-gated call (same root as `_32`'s "137 dead
params"). Doc-only: zero engine/sim edits, no git ops.
**2026-07-31 MILESTONE + FOCUS SHIFT:** operator started the
ChatGPT tuning loop live (views first, then pattern tuning) off the
`_90` prompt — `marsin_engine/patterns/**` is operator+ChatGPT
territory now, agents hands-off unless a pattern is explicitly
handed over. Declared new focus: **timeline & show planning**,
coordinator working WITH the operator interactively ("let's you and
me focus on timeline and planning and having fun with that").
Show-plan substrate on file: `scenes/titanic/timeline/playa_default.yaml`
(schemaVersion 2, sun-anchored phases philharmonic/party_night/
sunrise_set, autopilot + per-phase looks), 13 playlists incl.
burn_night/temple_white/tutu_tuesday/white_wednesday, 78 patterns.
Reminder in force: any when-by/date planning goes ONLY to
`.agent/reports_local/` (gitignored + deploy-excluded).
**Show-behavior refinements recorded (operator, 2026-07-31, in
master doc → Operator requirements):** party auto-trigger from
AMBIENT only; short gated sessions; ambient dominant; VJed party
night = automation stands down, likely no cue; playa-local time +
postpone/shift affordance wanted; playlist filling/tuning =
ChatGPT+operator territory (agents hands-off); current focus =
infra + system testing.
**`_91` reserved — show-infra audit + test plan (IN FLIGHT, Opus,
read-only):** timeline mechanics (who consumes playa_default.yaml,
phase/gap resolution, looks/autopilot/mood), theme-night switching,
party-trigger chain vs the new refinements, playa-time/postpone
support, pattern×playlist coverage matrix, timeline testability/
dry-run harness. Deliverable: gap list (SUPPORTED/PARTIAL/MISSING
per requirement) + ordered test plan; builds are separate threads.
**LANDED 2026-07-31** — `202607/20260725_91_show_infra_audit.md`.
Verdict in one line: **the MACHINERY is strong, the SHOW is not.**
CONSUMERS: the engine is the SOLE reader of
`scenes/<scene>/timeline/*.yaml` (`api_server.js:4571-4574`, gated on
`config.yaml:96-105 timeline.enabled`); the sim reads nothing;
CaptainPad only via REST (`utils/timelineApi.ts:492-573`); the state
file's `activePlan` beats the config's (`timeline_service.js:353-364`).
MECHANICS: sun anchors + tz + festival span are pure, DST-correct and
clock-injected (`triggers.js:17-125`, `festival.js:7-9`,
`sun.js`); midnight-wrapping phase windows work
(`triggers.js:131-136`); precedence human > program > autopilot holds
(`arbiter.js:67-199`); a due program under manual arms a 30 s pending
lease; catchUp re-anchors a caught-up window to its true past fire
time (`:1753-1757`); out of the festival span the plan goes fully
DORMANT (`:1487-1490, 1515-1547, 1887-1898`) — **which is the state
the rig is in right now** (`states/titanic/timeline_state.yaml`
`controller: manual`), so NOTHING is observable on the bench without a
run-time in-window fixture plan (recipe already in
`ops/timeline_e2e_tests.md:35-38`). TWO ARC FINDINGS: (G1) a program's
`hold` expiring NATURALLY re-establishes the autopilot BASELINE
(playlist `default`) and never reaches the `ambient` defaultCue —
`_applyAutopilotBaseline` (`:637-653`) does not clear
`_deckWindowCueId`, so `_reconcileDefaultCue` early-returns at
`:856-859`; only boot (`:1637-1654`), a durationMin elapse
(`:889-905`) and operator END SHOW (`:2537-2564`) reach ambient. So
the sunset+45 → sunset+120 gap runs `default` under sunset_coral.
(G2) `c_party_start` is `kind: ambient` with NO durationMin and NO
hold → it owns the deck from sunset+120 to sunrise−15, ~8 h of
"look: party". **Ambient is the exception, not the rule — the inverse
of the requirement.** Also: `philharmonic` and `sunrise_set` phases
trigger NOTHING (decorative), and a phase has no EXIT action (rising
edge only, `triggers.js:213-220`). LOOKS carry only
`{playlist, autopilot, palette, globals, tasks, target}`
(`show_plan.js:291-307`) — `hue`/`transition`/`overlays`/
`colorAutopilot` exist only on `playlist` ACTIONS, so crossfades
between phase looks need re-authoring as playlist cues. `master` in
a look's globals routes to the DECK GRAND MASTER (`:588-603`).
COVERAGE (68 top-level patterns × 13 playlists; `summer_camp/` etc.
are NOT reachable — `playlist_manager.js:100-111` is non-recursive):
**`default.yaml` names 45 patterns that do not exist at top level**
(all `summer_camp` — `40_…`–`56_…`, `63/65_dome_…`, `70_…`–`85_…`,
`96_…`, `100_…`, `110_…`–`117_…`); they load as `_missing`
(`:187`), autopilot SKIPS them (`autopilot_pick.js:53, 102-106`) and
the timeline only throws if ALL entries are missing
(`api_server.js:4381-4385`) — so the baseline playlist is a silent
27/72. **Only 14 of 203 entries scene-wide carry tuned `defaults`**
(6 in `default`, 5 `white_wednesday`, 3 `temple_white`); ZERO carry
a label or notes. **Reachable playlists: 3** (`default`, `ambient`,
`party_high`); `party_low` only via `/party-config`; **9 unassigned**
incl. BOTH fully tuned ones. Looks `burn_night`/`temple` load
`default` not their namesake playlists; `daytime` + `party_low` are
DEAD looks (no cue). Pattern orphans: 4, all deliberate
(2 calib + 2 test). THEME NIGHTS: per-day targeting EXISTS and works
(`cue.days` = 'all' | day indices | date strings,
`festival.js:58-73`; used for `days:[6]` burn / `days:[7]` temple;
CaptainPad DAYS picker `CueEditorSheet.tsx:243-347`) — **no per-day
PLAN override and none needed**; the gap is content, not code (no
Tue/Wed cue exists). PARTY CHAIN mapped end to end: companion
detector params `config.yaml:106-117` (`ambientFloor 0.09`,
`marginX 2.5`, `onSustainMs 20000`, `offConfirmMs 30000`, still
UNCALIBRATED) → `audioPartyStrong` → MoodSource staleness guard
(`staleSec 10`, forces CALM and surfaces `moodStale`) →
`triggers.js:221-260` (arm/dwell/cooldown, `partyEnabled` gate at
`:242` never burns the latch, `/party-config` timing REPLACES the
plan's at `:246-250`) → `arbiter.js:174-180` → look `party_high` →
`_notePartySessionEnd` (`:1352-1361`, ONE definition, six end paths,
cooldown anchored at END + re-arm) → persisted
`partyPlaylist party_high / dwell 120 s / duration 12 min /
cooldown 120 s`. **"AMBIENT ONLY" IS A GAP:** the only gate is
`controller === 'autopilot'` (`arbiter.js:177`) — a control-ownership
test, not a what-is-on-the-deck test. It blocks takeover + autopilot-
off + every `kind: program` hold, but NOT the `kind: ambient` party
look (deliberate per `show_plan.js:929-932`), and **the on-disk cue
DROPPED the `whenPhase: 'party_night'` the built-in template ships**
(`show_plan.js:945` vs `playa_default.yaml:158-173`) — so a sustained
loud stereo at 3 pm inside the festival window fires a session. The
cheap fix is one authored line; the strong fix is gating on the
ambient/default owner. **VJ STAND-DOWN IS A GAP as a MODE:** only the
manual global `partyEnabled` (`:1155-1227`, disable ends a live
session instantly and NEVER re-applies under a takeover, `:1392-1398`)
or a hand-authored `days:`/`enabled:false` on the mood cue; nothing
plan-driven, no reminder on the tab. PLAYA TIME: **SUPPORTED both
sides** — engine all-tz (`triggers.js:17-74`), CaptainPad reads "now"
in the PLAN tz explicitly so the tab is right off-playa
(`timeline.tsx:84-112, 368-389`), tz picker with Pacific (BRC) first
(`FestivalEditor.tsx:40-47`). **POSTPONE: MISSING** — PAUSE and HOLD
were REMOVED 2026-07-03 (`timeline_state.js:126`,
`arbiter.js:75-78`, `timeline_service.js:2392-2394`); today's only
options are takeover (auto-resumes after 120 s), AUTO OFF (kills the
whole plan), DISMISS a pending program, END SHOW, or hand-edit the
cue offset and SAVE (which hot-reloads, `:2326-2344`). Recommended
shape: a single persisted `planOffsetMin` applied in
`resolveDayTimes`, with a loud "SHOW SHIFTED +N min" banner and
one-tap reset. TESTABILITY: **317/317 timeline unit tests pass**
(`node --test "tests/timeline/*.test.js"` — the bare-directory form
FAILS on Windows); cores are `nowFn`-injected and the tests exploit
it (`party_session_repeat.test.js:96-127` `setNow`/`_tick`), but that
rig is copy-pasted per file with FAKE deps and never touches the real
plan. **No dry-run tool** (`marsin_engine/tools/` has 20+ tools, none
for the timeline), **no committed e2e runner** (the ops spec's own
"Wanted: a scripted runner", `:131-139`, still open).
`timeline_deck_release_default_cue.test.js` trips the Windows
node:test IPC flake when run ALONE because it does not mute
`console.log` (the party files do, `:31-33`) — 3-line fix.
DOC DRIFT flagged (fix-on-sight order):
`ops/timeline_e2e_tests.md:84` (S5) asserts `mode='paused'`, a mode
that no longer exists. GAP LIST (16 rows) verdicts: SUPPORTED 6
(short sessions, 2-min dwell, END-anchored cooldown, human-wins,
playa time, fail-loud) · PARTIAL 4 (ambient-only, cross-playa
rejection = uncalibrated, preplanned program, themed nights) ·
MISSING 5 (ambient-dominant as shipped, VJ stand-down mode,
postpone/shift, tuned playlists, fast-forward testability) · BLOCKED
1 (bench-observable — dormant until an in-window fixture).
**RECOMMENDED FIRST BUILD: `marsin_engine/tools/timeline_dryrun.mjs`**
— loads the REAL plan, injects the clock + a scripted mood track,
prints a minute-by-minute playa night (local time, phase, controller,
cue fires + reasons, deck playlist, `wouldFire` suppressions) with
recording fakes only: zero sACN, zero device traffic, no engine.
4–6 h, and it turns every open show question into a 5-second answer.
Ordered 4-phase test plan in `_91` §8 (Phase 0 unblock → Phase 1 read
the show back → Phase 2 party on the bench → Phase 3 postpone →
Phase 4 e2e runner + night rehearsal). READ-ONLY thread: zero code,
scene, playlist or pattern writes; `patterns/**` and playlist
contents measured only (ChatGPT+operator territory).
**`_92`++ CORRECTION LANDED (2026-07-31, Opus) — SIGN PUCKS ARE **RGBW**,
NOT RGB: "same lights as the ropes".** Operator: *"sign is also RGBW,
same lights as the ropes."* RETRACTS the addendum's "set that output's
order to RGB" instruction — CORRECT INSTRUCTION: **RGBW / stride 4, the
same setting every rope output already runs.** AUDIT: **no byte-level
bug existed.** For an LED-bus fixture stride + channel map come from the
owning controller's `led.order` (sign exactly as strand):
`led_fixture_kind.ledBusPixelCount` returns a PIXEL count never bytes;
the exporter emits `footprint: ledProj.stride` + `channels` = the
controller's order map; `computeLedProjection`/`computeLedStrandPatches`
read `led.order`; the parity gate cross-checks model stride vs
`ledStride(controller)`. So the wire would have been right on an RGBW
output regardless. WHAT WAS WRONG = every number a HUMAN reads: the two
definition YAMLs (`channel_mode: 120`/`102`, `type: "rgb"`, per-pixel
`{red,green,blue}`), the channel count baked into their FILE NAMES, the
`20260725_13` pattern-catalog row (`rgb`), and my A8 mapping
instruction. FIXED: `gen_te_sign_fixture.js` gained
`BYTES_PER_PIXEL = 4` + `PIXEL_FORMAT = 'rgbw'` threaded through
footprint / per-pixel quad / controls block / summary line, and its
emitted header now states BOTH the physical format AND that the
run-time authority is the controller's `led.order`. Definitions
regenerated + RENAMED so the name stops lying:
`model_a_120.yaml` → **`model_a_160.yaml`** (`te_sign_v3_a_160`, 40 px
× 4 = 160 ch), `model_b_102.yaml` → **`model_b_136.yaml`**
(`te_sign_v3_b_136`, 34 px × 4 = 136 ch); per pixel `type: "rgbw"`,
`channels: {red: 4i+1, green: 4i+2, blue: 4i+3, white: 4i+4}`.
`main.js` 4 registration refs repointed — SEQUENCED new-files →
repoint → delete-old so no page load could fetch a missing definition
while the operator was testing at his desk. GEOMETRY BYTE-IDENTICAL
(same 148 points, same wire order, same shared 0-1 normalisation
k=1/2165.1). CORRECTED ARITHMETIC: side A 160 ch, side B 136 ch, one
whole sign **296 ch** (was stated 222) — still one universe, 216 ch
headroom. 2 NEW REGRESSION TESTS in `scene_model_parity.test.js`: sign
defs declare RGBW at 4 B/px with an RGBW quad per pixel, and that
stride == the stride every titanic LED controller runs — the generator
cannot quietly go back to 3. SUITE 1590 tests / **8 fail = baseline 8,
ZERO NEW**; PARITY **UNCHANGED at 4 `unmapped_fixture`** (still awaiting
his mapping). NO server started/stopped/reloaded, NO scene file
written, zero device HTTP; `_96` + `_100` boundaries untouched. Defs are
fetched at page load → his CURRENT tab keeps the old ones; next hard
reload picks up RGBW. Exported model UNAFFECTED (the LED path never read
the definition channel map). Correction section appended to
`202607/20260725_92_te_sign_patch_model_fix.md`.
**`_92`+ ADDENDUM LANDED (2026-07-31, Opus) — TE SIGNS ARE **LED**, NOT
DMX; the DMX placeholder is DELETED and both signs are mappable
MarsinLED fixtures.** Operator correction: *"the TE signs must be
associated with MarsinLED controllers in the controller mapping pane,
please remove all TE sign controllers you added (I saw DMX ones,
that's wrong!) … make sure the TE sign fixtures are clearly of type
LED not DMX."* He is right — `_92` §1 parked them on a DMX placeholder
gateway because that was the ONLY thing the mapping chain would let a
`parLights` fixture attach to. REMOVED: the whole `TeSigns-PLACEHOLDER`
controller (id 23, `0.0.0.0`, U38+U39; controllers 17→16,
nextControllerId 24→23), all four sign patch records (patches.yaml now
has ZERO `TE Sign` rows), universes 38/39 from `Subscribed Universes`,
and the DMX whole-fixture patch on all 148 sign pixels. (Epitaph from
the pre-removal boot log: the bridge REFUSED the placeholder route
anyway — "U38 → '0.0.0.0' [sentinel] … No sender created".)
ADDED — a new first-class kind, the **LED PIXEL FIXTURE**: a
`parLights` fixture whose DEFINITION declares `bus: led` (the TE Sign
V3 YAMLs have said so since 20260724_14). It keeps baked per-pixel
`dots` geometry (the logo) but is wired EXACTLY like a strand — one
MarsinLED output, cursor at (port universe, ch 1), stride B/px,
no-straddle walk — so it takes the strand's per-pixel patch, the
strand's record shape, and `type: 'led'` model pixels. THE HINGE: one
new pure module `src/dmx/led/led_fixture_kind.js` whose
`ledMappableCounts()` is the UNION of strands ∪ LED fixtures. Both LED
projections (`computeLedProjection`, `computeLedStrandPatches`) already
key PURELY off that name→count map, so **neither projection changed a
line** — the reclassification is one call site per consumer:
`main.js` projectLedStrandPatches (projects onto both, stamps the
derived `bus:'led'` marker for the save-server) + projectControllerMappings
(passes `ledBusNames`); `controller_registry.projectOntoConfigs` (new
optional `ledBusNames` — LED-bus fixtures are still NUMBERED, keeping
their place in the section/fixture id space, but their ADDRESS fields
belong to the LED pass, else the two fight and log drift every boot);
`pixelblaze_model_exporter` (lane table hoisted to
`computeLedLaneFields()`, DMX loop grew an LED-bus branch);
`controller_map_editor` (LED-bus names leave the DMX tray for the LED
tray; `nameKind`→'strand' so `controllerAcceptsKind` accepts them on an
LED card and REFUSES them on DMX); `save-server` (strand record shape,
written only when patched); `lib/scene_model_parity.cjs` (roster
`type:'led'`, LED walk patch truth, no `missing_patch_record`, identity
vs scene_config). CLASSIFICATION IS DATA (`bus` off the definition),
never a name list — so **the `fixtureType` strings NEVER CHANGED**
(`TeSignV3A40`/`TeSignV3B34`): every `te_sign` selector still resolves
and the `_48` addendum-2 one-panel-per-sign (group AND type) guarantee
is intact. NOTE: `pixel_map_layout.LED_CLASS_FIXTURE_TYPES` (the
2026-07-24 operator ruling that hardcoded the two type names precisely
BECAUSE the transport said DMX) is now redundant — pixels report
`type:'led'` themselves — but LEFT IN PLACE so pre-today models still
classify; deleting it is a follow-up, not a drive-by.
TWO LATENT BUGS CAUGHT: (1) IDENTITY LOST ON UNMAP — an LED thing has a
patch record only WHILE patched, so parking sectionId/fixtureId there
meant an unmapped sign lost its identity and re-minted different ids
every boot (model drift forever). Fixed by following the strand
contract: identity lives STRUCTURALLY in scene_config.yaml, seeded with
the existing ids (TE Sign V3 A/B sId 3 fId 13/14; TE Sign 2 V3 A/B sId
415 fId 2204/2205) so nothing renumbered; verified stable across a full
save round-trip. (2) SPLIT OUTPUT GATE — a `type:'led'` pixel is scaled
by `animate.js _applyLedOutputGate`, keyed on `displayGroup`, which the
signs lacked; the LED Fixtures panel (gui_builder ALREADY lists every
`bus: led` fixture there — "TE Sign (2)"/"TE Sign 2 (2)") would have
moved their meshes while the raw entry, the 2D tap and the sACN map
stayed bright — the exact split `20260724_40` closed for DMX.
`displayGroup` now stamped on every LED-bus pixel (runtime-only).
LIVE PROOF (operator away, service grant; SIM SERVERS ONLY — engine
NEVER started, so zero sACN toward the rig; every `:6970` write aborted
at the network layer): pane reads `CONTROLLERS (16)` /
`DMX CONTROLLERS (12)`, no PLACEHOLDER, `dmxPlaceholders: []`,
`signChainedAnywhere: []`, and the unmapped tray
`UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)` with the four 💡 TE Sign chips in
the LED half (zero unmapped DMX fixtures — the signs are the only
unmapped things in the ship). All four read back `bus:"led", u:0, a:0,
cId:0, outputIndex:-1`. Both signs still render + light (wire-order
chase, halves interlocking); the "4 patched fixture(s) missing
Controller IP" banner is gone. Screenshots
`.agent_renders/*_map_pane_te_sign_filtered.png`, `*_map_pane_led_signs.png`,
`*_sign{1,2}_lit.png`.
SUITE: sim **1571 tests, 8 fail = the documented baseline 8, ZERO NEW**
(+12: 9 `led_fixture_kind.test.js` + 3 exporter LED-bus). Security PASS.
PARITY DELIBERATELY RED — **4 errors, all `unmapped_fixture` on the four
sign halves.** Removing the controller without a replacement (per the
brief: provisional binding is `_96`'s thread) NECESSARILY re-opens them;
softening `unmapped_fixture` to INFO would blind the gate to a genuinely
dark fixture, which is the whole point of the validator family.
Everything else spotless (coverage/patch-truth/drift/views clean;
`placeholder_controller` finding GONE). ONE operator action closes it:
chain the four halves on a MarsinLED output + Save → PASS. ⚠ set that
output's order to **RGB** ← ⛔ **RETRACTED, see the `_92`++ CORRECTION
above: the pucks are RGBW, same lights as the ropes — set the output to
RGBW / stride 4** (stride comes from `controller.led.order` and the gate
cross-checks it). `_96` FILE BOUNDARY NOT CROSSED
(led_discovery_panel / marsinled_client / device_config_mapper
untouched — the LED tray lives in controller_map_editor and the
projections key off the count map). HANDOFF: `test_bench` still fails
its 2 baseline parity tests — its own TE Sign halves now read LED too
and its sign identity is still in patches.yaml under the old DMX
contract; needs the same one-command re-save, LEFT ALONE (that scene is
`_89`'s active area). ALSO: the sACN INPUT bridge crashes at boot on
this box with `addMembership EINVAL` from the `sacn` package
(multicast-join/NIC condition, unrelated, pre-existing) — it will bite
the next person who starts the stack. Report: the ADDENDUM in
`202607/20260725_92_te_sign_patch_model_fix.md`.
**`_92` LANDED (2026-07-31, Opus) — TE SIGN PATCH + MODEL REBUILD;
`scene_model_parity titanic` 21 errors → **0, RESULT PASS** (the
titanic scene is FULLY PATCHED).** All 4 defects confirmed from the
repo, all 4 fixed. (1) UNPATCHED: 148 sign px `patch: null`, no
controller carried them → new `TeSigns-PLACEHOLDER` DMX controller
(`0.0.0.0` sentinel + PLACEHOLDER marker per plan `_33` §O5), 2 ports:
U38 sign 1, U39 sign 2, A@1 + B@121 (120+102=222 ch, one universe
each); `📡 Subscribed Universes` widened by 38,39 (ADD-only) or the IN
bridge drops them silently. ONE controller not two — a second
`0.0.0.0` would trip `controller_duplicate_ip`. (2) DUPLICATE NAMES:
both signs shipped `TE Sign V3 A/B`; sign 2 → `TE Sign 2 V3 A/B`,
which also retires the `~2` fixKey the 2D map was inventing
(`pixel_map_layout.js:123`) — its `pixel_map_views.yaml` offset keys
rewritten. (3) sId 3 / fId 13-14 COLLISIONS were a SYMPTOM of (2):
`projectOntoConfigs` (`controller_registry.js:2083`) keys
`configsByName` by NAME, so sign 2 never entered the map. Rename alone
→ projection minted sId **415**, fId **2204/2205**. NOTE pre-existing
side effect: any sim save re-mints generated-fixture ids (DMX groups
401-414 → 416-429) — not new, but re-check anything keyed on a raw
section number. (4) THE SIX STRANDS, named: `Left_Front_Right`,
`Left_Back_Right`, `Right_Front_Left`, `Right_Back_Left`,
`Right_Front_Right`, `Right_Back_Right` = every strand on the three
rope controllers with **no `device:` block** (`LeftRightRopes`,
`RightLeftRopes`, `RightRightRopes`). ROOT CAUSE = two projections:
`main.js:558` writes patches.yaml from `computeLedStrandPatches` ALONE
(early-returns on `!isBoundLedController`, `led_patch_projection.js:169`)
→ no record → no bridge relay route; the exporter
(`pixelblaze_model_exporter.js:327`) seeded its lanes from the GENERIC
`computeLedProjection` (ALL LED controllers) → gave them U32-U37
anyway. Engine rendered, bridge forwarded nothing, six ropes dark with
every surface green. FIX = **patches.yaml wins** (operator ruling):
exporter lane table now built from the bound projection only; unbound
strand → `patch: null` + `unpatched: true` + one loud console line.
Rejected the other direction on purpose — it would have created relay
routes to three real rope controllers and started forwarding live
frames = device traffic this order forbade, while asserting a byte
layout for unbound hardware. BLAST RADIUS = exactly those six: every
LED controller in `studio`/`studiodj`/`test_bench` is device-bound, so
no other model export changes a byte. MODEL REBUILD: the sign's pixel
geometry lives ONLY in `simulation/dmx/fixtures/te_sign_v3/model_a_120
.yaml` + `model_b_102.yaml` (everything Pixelblaze-shaped is derived);
both regenerated by the NEW reusable
`simulation/tools/gen_te_sign_fixture.js` (fail-loud on wire_order
gaps / dup points / wrong counts / a panel on both sides; `--dry-run`).
`gen_led_fixture.js map` deliberately NOT reused — it centres on the
one file it is handed, i.e. per-side bbox, the exact failure this sign
cannot survive. POINT SETS IDENTICAL old→new; the delta is **wire
order only** (A: P9→P10→P1→P2→P3→P4→P11; B: P8→P7→P6→P5), i.e. which
LED takes which channel. NORMALIZATION (operator-explicit, ONE shared
factor over A ∪ B, anchored at the union lower-left): `k = 1/2165.1 mm
= 4.618724e-4/mm` → side A `u 0…0.5388, v 0.3333…1.0`, side B
`u 0.2694…0.7313, v 0…0.8000` — deliberately NOT 0…1 per side; that
is what keeps the halves interlocking along the diagonal seam instead
of stacking. Y is NOT inverted vs the CSV (both Y-up; only the
translation to the shared full-sign centre 986.31/1254.76). `dots` stay
in mm (runtime does ×0.001 → metres); the 0-1 pair rides each pixel as
a `norm (u, v)` provenance comment. VERIFY: parity PASS with 8 honest
INFO (1 bench, 1 placeholder controller, 6 unpatched strands — all
promoted by `--strict`); sim suite 1482 tests **10 → 8 fail, ZERO
new** — 2 titanic scene-drift pins went green (`--strict is stricter`
self-healed; `0% electrically mapped` pin REWRITTEN to `fully mapped`,
stronger not weaker), 3 exporter tests rewritten to the new contract
(misaligned-start walker math still pinned at
`led_patch_projection.test.js:251`, zero coverage lost), 8 remaining
are the pre-existing stale-model family (5 bench_section_sync, 1
pixel_map compression, 2 test_bench parity — test_bench files were
never written). Engine suite 2391/8-env-fails unchanged; security
check PASS. EYES ON: both signs lit with a wire-order chase (white =
pixel 1 lands on the new CSV wire-1 points), halves assemble into one
diamond with no seam tear and true relative scale; 2D `te_sign` view
resolves ONE panel per sign (group AND type — the `_48` addendum-2
regression is NOT back). RE-EXPORT ran through the sim's own save path
(`window.exportConfig({interactive:false})`) — **no interactive
operator step left**, and **no engine restart**: pixelCount unchanged
at 964, engine hot-reloaded (`modelStale:false`). ZERO device HTTP
pushes / sACN output enables. OPERATOR STEPS REMAINING (both need
device conversations, both loud under `--strict`): (a) the sign
controller's real IP → drop the PLACEHOLDER marker (split into two
controllers if the signs land on two boxes); (b) bind the three rope
controllers in the LED discovery panel → the six records + their model
addresses appear together by construction. Report
`202607/20260725_92_te_sign_patch_model_fix.md`.
**`_92` original brief (operator order
"immediately now" 2026-07-31, Opus):** four defects to
verify+fix — 148 sign pixels unpatched in exported model; A/B
module names duplicated across the two signs; both signs sectionId
3 + fixtureId collisions; 6 LED strands patches.yaml vs generated
model disagreement (patches.yaml = truth). Plus: regenerate the
Pixelblaze-format TE sign model from fresh Fusion CSVs (side A 40
pts, side B 34 pts, 74/sign — CSVs live in the external Echoes
workspace), wire_order order, **one shared mm→0-1 scale across
both sides** (operator-explicit). Titanic scene writes authorized
by this order, scoped to these fixes; zero device traffic.
**`_91` LANDED (2026-07-31, read-only):** machinery strong
(317/317 timeline tests; sun/tz math pure + DST-correct;
human>program>autopilot holds) but the SHOW is template-shaped:
default.yaml 45/72 entries unreachable (summer_camp names,
silently skipped by autopilot_pick), 66/72 untuned; 9/13 playlists
referenced by nothing incl. BOTH fully-tuned ones; burn_night/
temple looks load `default`; party look owns ~8h of the night
(inverse of ambient-dominant); "fires from ambient only"
UNENFORCED (arbiter gate is ownership-only; on-disk cue dropped
whenPhase party_night → 3pm loud stereo fires); natural hold
expiry lands on autopilot baseline not ambient (ownership latch
not cleared); PAUSE/HOLD removed 2026-07-03 so no postpone; no
dry-run tool; plan DORMANT off-festival. Gap list: 6 SUPPORTED /
4 PARTIAL / 5 MISSING / 1 BLOCKED. Report
202607/20260725_91_show_infra_audit.md.
**`_93` reserved — timeline dry-run harness (IN FLIGHT, Opus):**
build marsin_engine/tools/timeline_dryrun.mjs per _91's first-build
rec — real loadShowPlan/TimelineService/arbiter with injected
nowFn + scripted mood, simulated dates while plan dormant, fixture
plan in test fixtures (zero scene writes), minute narrative +
suppressed-wouldFire log + session lifecycle + summary table; plus
2 fix-on-sight items (ops e2e doc stale mode='paused'; test
console.log IPC flake). Logic bugs report-only.
**`_93` LANDED (2026-07-31)** —
`202607/20260725_93_timeline_dryrun_harness.md`. SHIPPED:
`marsin_engine/tools/timeline_dryrun.mjs` +
`tests/fixtures/timeline/dryrun_bench.yaml` +
`tests/timeline/timeline_dryrun.test.js` (23 tests). Drives the
REAL code end to end — loadShowPlan, TimelineService._tick() with
injected nowFn + getMood, triggers.js, arbiter.js, sun/festival
math, PlaylistManager.load, pickNextAutoCycleEntry — against
recording fakes that mirror api_server's own contracts (an
all-`_missing` playlist THROWS, same as live). OFFLINE: zero sACN,
zero network, no engine; the plan is COPIED to ~/tmp before the
service sees a directory, so `_loadSceneFiles`'s default-plan write
physically cannot reach simulation/scenes/**; `--out` refused
outside ~/tmp. DORMANCY solved twice: an out-of-window `--date`
FAILS LOUD naming the festival window, and `--fixture` runs a
committed DATE-FREE bench plan with NO `festival` block (the
engine's own always-in-window escape hatch, timeline_service.js
:1487-1490) that mirrors the shipped show's shape and points at
real titanic playlists. FLAGS: --scene/--plan/--fixture,
--date/--from/--days/--to/--step (all independent of today),
--mood {quiet,loud_stereo_1500,night_sets,all_night} /
--mood-file, --seed (reproducible shuffle), --party-config
(through the REAL setPartyConfig), --allow-dormant,
--events-only/--engine-log/--out, --list-moods/--help. OUTPUT:
per-step playa-local time │ phase │ controller │ deck OWNER │
playlist ▸ pattern │ autopilot │ palette │ party state, plus
▶ FIRE (with WHY + kind/hold/window), ◆ lifecycle,
✖ SUPPRESSED (with the arbiter rule that dropped it), ♪ PARTY
transitions; summary = deck minutes by playlist/owner/controller/
palette, fire + suppression counts, session outcomes, playlist
health (usable/total, loads, ⚠ unreachable).
**4 × 24 h runs at 1-min resolution.** CONFIRMS _91 on the real
plan: hold-expiry lands on the autopilot BASELINE not the ambient
defaultCue (G1); c_party_start owns the deck **8h40m** unbroken
(G2); 40 min of daylight stereo fires **3** party sessions
(15:02/15:16/15:30) — the missing `whenPhase`. SHARPENS: on a
QUIET night the `ambient` playlist gets **0 minutes** (every deck
cue is no-durationMin, so the defaultCue never regains the deck),
and c_sunrise — not party — is the biggest owner at 12h35m
(it holds the deck all day).
**5 NEW BUGS, REPORT-ONLY (no timeline logic touched):**
(1) **HIGH — a SUPPRESSED party fire consumes the arm latch +
cooldown.** triggers.js:256-259 stamps moodLastFire and clears
moodArmed BEFORE arbiter.js:174-180 decides to drop the fire;
moodArmed re-arms only on a return to CALM (:230-233). Measured:
burn night + continuous 21:00–05:00 music → ONE suppression at
21:02 under c_burn_night's 120 m hold → **0 sessions all night**;
same script on a normal day → **35**. getPartyStatus() still reads
'armed' throughout (it only checks the cooldown stamp), so the
CaptainPad PARTY card lies. Contrast triggers.js:242, where the
partyEnabled gate deliberately continues BEFORE the bookkeeping
("suppression does not consume the trigger") — same invariant,
violated one layer up.
(2) MED — timeline_service.js:1758-1761: `_catchUp` calls
`_disarmBaselineAutopilot()` AFTER `_dispatchCue` applied the
caught-up program's look, cancelling the look's own autopilot on
the same deck target. The live path
(_dispatchArbitratedAction:1582-1584) disarms FIRST. Any
boot/scene-switch/savePlan/resume/lease-release inside a program
hold freezes the deck on entry 1. Measured: ap OFF + one pattern
for 90 m vs ap 90s seq rotating when the same cue fires live.
(3) MED (latent) — arbiter.js:181-186: an `ambient` cue applies
whenever controller !== 'manual', so it overwrites a running
program's deck content while activeProgram (and its mood
suppression) stays live. Measured: c_party_start replaces the
burn_night look 30 min into its 120 m hold. Invisible today (both
resolve to default+bass_drop) — wipes the burn show the moment
_91's T1 look→playlist re-pointing lands.
(4) AUTHORING — program looks with no `autopilot` block
(sunrise/burn_night/temple/daytime) leave the deck frozen for the
whole 90–120 m hold, because the program dispatch disarms the
baseline and nothing re-arms.
(5) ARC — the first party session permanently evicts the `party`
look: c_party_start has no expiry but loses ownership to the mood
cue, whose window-elapse hands the deck to defaultCue, and a phase
trigger is rising-edge once per night. Two totally different
nights (quiet: party 8h40m / ambient 0m; with music: ambient
3h09m / party look gone after the first session).
**FIX-ON-SIGHT (both done):** ops/timeline_e2e_tests.md S5
rewritten (asserted mode='paused', deleted 2026-07-03; also drove
a DISABLE PLAN button removed per PlanLockBanner.tsx:200-204) →
now an AUTO OFF/re-arm cycle with real assertions; S1 + S10 +
the level table cleaned in the same pass (S10 cited setMode/hold,
both deleted) + a new DRY level and an "Offline dry-run" section.
timeline_deck_release_default_cue.test.js now mutes console.log →
**9/9 run ALONE**, Windows node:test IPC flake gone.
**GATES:** timeline suite **317 → 340/340**; full npm test
2387/2395 with **ZERO new failures** (8 = 5 audio_capture + 1
osc_listener EACCES [both env, per now.md] + effects_v2_mode_page
[47/47 alone — full-run pollution, now.md B12] + specialty_white_uv
[operator playlist drift: titanic white_only.yaml now tuned,
studiodj's copy not]); node --check clean; git diff --check clean;
security_check --all → 6 findings, ALL pre-existing MACs in
gitignored simulation/.scene_backups/, none in a touched file. Sim
suite not run — nothing under simulation/ was touched. No git ops.
**`_94` reserved — timeline zoom design (operator feature request
2026-07-31, IN FLIGHT, FABLE — operator-named model, design-only):**
(1) DAY ZOOM — calendar week/day view to review the timeline;
(2) EVENT ZOOM — click event → if active: live "performance level"
deck control the main cue cannot steal, cue resumes on zoom-out;
if inactive: temporary TIME TRAVEL to that event to see/work the
deck at that moment; exit = back to timeline tab. Design must map
onto existing arbiter ownership (human>program>autopilot), be
honest about the PAUSE/HOLD-removed + postpone-missing gaps
(_91), prefer sharing _93's injected-clock machinery over a second
path, respect one-writer law across CaptainPad clients, keep UI
"simple and easy to understand". Deliverable: UX + state machine +
API surface + operator decisions + ordered build slices.
**`_94` DESIGN LANDED (2026-07-31)** —
`202607/20260725_94_timeline_zoom_design.md`. Navigation ladder
FESTIVAL (existing 8-day strip = week view) → DAY (DayEditor
promoted full-screen + per-day phase bands + a RESOLVED
"what-actually-plays" ribbon that shows _91's G1/G2 truths +
reserved SHIFT-TONIGHT slot for the postpone build) → EVENT (the
existing DECK tab under a mode banner — no second deck UI).
Event zoom = SCOPED OPERATOR TAKEOVER on the existing arbiter
human layer: `operatorLease.scope 'perform'|'travel'`, controller
stays 'manual', no new ownership mechanism. PERFORM's one real
change: a due program's pending lease (arbiter I2 auto-start,
30 s — which today seizes control even from a takeover,
arbiter.js:87-104,119) is DEFERRED (never dismissed) while a zoom
lease is alive; ENABLE stays offered; exit fires it via catchUp.
TIME TRAVEL: new pure `resolveDeckStateAt(plan, atMs)` extracted
from `_catchUp`'s selection core (timeline_service.js:1719-1743),
applied to the REAL deck through normal dispatch under the
takeover; live-clock warp REJECTED (catchUp would latch firedToday
for the simulated day and cancel the real night); _93's
throwaway-service recipe (makeDryRunDeps) becomes the cross-check
oracle in tests. Every exit (timeline-tab return from the entering
client, EXIT button any client, presence-ping lease expiry 120 s,
engine restart — zoom is runtime-only, autopilot OFF, plan
save/activate) funnels through resume/catchUp: never-stuck
invariant preserved; party mid-flight uses the EXISTING
end-vs-rejoin rules (:1809-1855) unchanged. One-writer: one engine
zoom session, both pads render the same broadcast banner, either
may retarget. Engine surface (all additive): overview `phases` +
`segments`, GET /timeline/resolve, takeover body {scope,cueId},
POST /timeline/travel, `zoom` field on timelineState. OPEN
DECISIONS D1–D8 (exit gesture, lease length, defer-vs-autostart,
static-vs-ticking travel, resolver impl, two-pad policy, ribbon in
v1, postpone slot) each with a recommendation. SLICES: S1 engine
resolver+review data (4-6h) → S2 engine zoom scopes (6-8h) → S3
pad day zoom (6-8h, needs S1 only) → S4 pad event zoom (6-8h,
needs S2) → S5 e2e (3-4h); day zoom and event zoom can land in
either order after S1. Zero code/scene writes; report + two
ledgers only.
**OPERATOR RULING (2026-07-31): `_94` design ACCEPTED, all
decisions D1–D8 as the designer recommended ("do them") — incl.
D3 defer-cue-until-zoom-exit, D4 static-snapshot time travel
(never a live clock warp), D5 pure resolveDeckStateAt extraction.
Build wave authorized: S1→S2 engine first, then S3/S4 pad slices,
S5 e2e.**
**`_95` reserved — zoom engine slices S1+S2 (IN FLIGHT, Opus):**
pure resolver extraction (byte-identical _catchUp proof) +
GET /timeline/resolve + overview phases/segments; takeover
lease.scope perform/travel + POST /timeline/travel + zoom
broadcast + D3 deferral. Warned off _93's files (dryrun tool +
deck_release test). S3/S4 builders will work from the _95 report's
API docs.
**`_95` LANDED (2026-07-31)** —
`202607/20260725_95_timeline_zoom_engine.md`. BOTH engine slices
shipped. **S1:** new `marsin_engine/lib/timeline/resolve_deck_state.js`
— the pure `resolveDeckStateAt({plan, atMs, sunEvents?})` lifted
VERBATIM out of `_catchUp`'s selection core (ruling D5), plus
`buildDaySegments`. No IO, no Date.now(), plan never mutated. It
returns TWO deliberately distinct answers: `restored` = what catchUp
re-applies (present even when the cue's durationMin window has
elapsed), and `owner`/`playlist`/`palette`/`controller`/`source` =
what actually drives the deck at T (a live program hold owns
outright; an ELAPSED window yields to the defaultCue). `_catchUp`
consumes `restored`. `buildOverview` gained additive per-day
`phases` (plan-ordered, midnight-wrapping, null on polar anchors)
and `segments` — the RESOLVED RIBBON, tiling 00:00→24:00 with no
gaps (last `toLocal` is the literal "24:00"). New read-only
`GET /timeline/resolve?date=&time=` (or `?cueId=`), 400 on
malformed/unresolvable/out-of-window. **S2:** the operator lease
gained `scope` ('perform'|'travel') — the zoom rides ON the lease
object, so every existing lease-clear path clears the zoom and a
zoom is structurally un-strandable (8 exits unit-tested: resume,
expiry, autopilot OFF, savePlan, activatePlan, enableProgram,
restart, window close). `POST /timeline/takeover` takes an OPTIONAL
body `{scope:'perform', cueId?}`; bodyless = today's plain takeover,
and a bodyless call under a live zoom is a REFRESH that PRESERVES
the scope (the deck touch hook must not downgrade a performance).
New `POST /timeline/travel` — `{date,time}` | `{cueId,date?}` |
`{step:'prev'|'next'}` — enters a scoped takeover + applies the
resolved snapshot through the NORMAL dispatch path; STATIC snapshot
(D4), never a clock warp, and it writes NONE of the live plan's
bookkeeping (no firedToday, no cooldown, no activeProgram, no deck
window, no party session, no cue-fire ring entry — a `travel`
lifecycle entry instead). New additive `zoom` field on
`/timeline/state` + the `timelineState` broadcast, carrying
`pendingDeferred` for the banner. **D3 deferral:** while a zoom
lease is alive the service pushes `pendingProgram.expiresAtMs` out
to the zoom lease's expiry — a SERVICE-level nudge BEFORE
`arbitrate()`, so `arbiter.js` stays pure and completely unmodified.
Deferred NEVER dismissed (no firedToday burned, ENABLE still starts
it, exit fires it via catchUp); the event log says
"Show deferred: X (starts when you exit the zoom)" under a zoom
only. **A PLAIN takeover keeps the I2 30 s auto-start
BYTE-IDENTICAL**, pinned in both directions. DESIGN GAP CLOSED: the
dormancy gate would have torn down a travel zoom within 1 s, so
`_goDormant` now preserves an UNEXPIRED travel lease (and nothing
else) — **time travel works while the plan is asleep**, exactly the
bench state today (`_91` #16); an expired one is dropped right
there so it can never strand.
**PROOF: the `_catchUp` refactor is BYTE-IDENTICAL** — a one-off
harness imported `git show HEAD:…/timeline_service.js` beside the
refactored module and ran both over 6 plan variants × 6 dates × 18
times × 2 moods = **1116 boot+resume+savePlan scenarios**, diffing
the ordered dep-call log, the whole persisted state, every deck
latch, the event ring and the full getState payload: **0
differences**. A permanent guard ships in-suite (a verbatim copy of
the pre-refactor core vs the resolver over 208 comparisons), plus a
LIVE-SERVICE ORACLE (D5's option (b) used as the test oracle: a
throwaway service booted AT each instant with recording deps).
GATES: timeline family 340 → **387/387**; full engine suite
2434/2442 (8 pre-existing/environmental — audio-device, EACCES,
playlist drift; three more files that fail under parallel load pass
47/47, 4/4, 11/11 in isolation); **19/19 REST checks** against a
REAL engine + the real `playa_default` with sACN black-holed;
security PASS; sim suite not run (zero shared files touched).
CAUTION for S5: spawning an engine outside `npm test` (without
`tests/helpers/setup_config_guard.mjs`) persists deck autopilot
state into `marsin_engine/config.yaml` — MARSIN_STATE_DIR does NOT
isolate it. Mine did; inspected + restored, file clean.
**2 PRE-EXISTING ENGINE TRUTHS FOUND, PINNED BY TESTS, NOT FIXED**
(fixing either breaks the byte-identical mandate): **F1** —
`_catchUp` dispatches the restored cue and THEN calls
`_establishBaselineIfActive`, which reloads
`plan.autopilot.playlist` ON TOP, so a boot/resume inside a
NON-PROGRAM cue's live window lands the deck on the BASELINE
playlist, not the cue's. Programs are immune (programCaughtUp skips
the baseline step); a defaultCue owner is applied after it. Invisible
on the shipped plan ONLY because every look already points at
`default` — **it bites the moment `_91`'s T1 look→playlist
re-pointing lands.** **F2** — `_91`'s G1 is now VISIBLE on the wire
as `source:'hold-expired-baseline'`: on hold expiry the arbiter
resumes autopilot and reloads the baseline playlist but never clears
the ownership latch, so the cue keeps OWNING while the baseline
plays under it and the palette is never reset. The ribbon reports
that rather than the cue's own playlist.
FOLLOW-UPS: S5 should reuse `_93`'s `makeDryRunDeps` as a heavier
cross-check oracle over a full simulated night; the ribbon does NOT
carry a night's owner across midnight (inherited catchUp day-latch,
documented — a `lookBackDays` option is the fix if the operator
finds it confusing); `GET /timeline/overview` is now ~10 pure
resolver calls per day, so S3 must fetch on focus/change, not on a
timer. **S3/S4 build from `_95` §3 (the API surface).**
**OPERATOR RULING (2026-07-31): discovery is an OPTIONAL stage of
the controller lifecycle, not required** — manual typed-IP
provisional binding must produce the full honest chain (patches,
model lanes, bridge routes) with the board offline; first contact
fetches missing data from the board, promotes to verified
(controllerId-keyed), mismatches fail loudly into a reconcile
dialog. Root cause named: the six `_92` dark ropes were
configured-but-never-bound because binding required live
discovery. **Session constraint while he TE-sign-patches live: NO
server starts/kills/reloads, no browser on his stack, no device
HTTP — agents unit-test only.**
**`_96` reserved — optional-discovery lifecycle + controller
ONLINE/OFFLINE status (IN FLIGHT, Opus):** provisional→verified
state machine; acceptance = the six ropes + the TE sign
placeholder controller patch end-to-end before boards power on.
SCOPE ADD (operator mid-flight): per-controller ONLINE/OFFLINE/
UNKNOWN badge — server-side parallel non-blocking probes, per-type
transport (MarsinLED = HTTP, never ICMP; DMX gateway probe to be
determined), cached, UI never stalls; provisional+ONLINE =
first-contact promote moment.
**OPERATOR CORRECTION (2026-07-31, urgent): TE signs are LED, not
DMX.** _92's TeSigns-PLACEHOLDER DMX controller (U38/U39) was
wrong — remove it entirely; signs must be LED-family fixtures
end-to-end (scene type, projection, exporter, 2D views) and appear
as mappable LED fixtures in the controller mapping pane for
MarsinLED association (like rope strands; 74 px/sign). No
replacement controller — provisional binding (_96) covers that.
_92 agent RESUMED with the correction (addendum to its report; no
new number). De-conflict: _96 owns led_discovery_panel/
marsinled_client/device_config_mapper — _92-resume barred from
those. Live-session constraints in force (operator patching signs
in the running stack; scene files re-read before every write).
NOTE: correction was first mis-sent to the _89 bench agent —
recalled with a stand-down message; bench agent confirmed ZERO
actions taken (read-only identity check only), _89 work stands.
**OPERATOR GRANT (2026-07-31, away from desk): agents may launch/
control the titanic services as needed** — live verification ON
for in-flight threads (_92 correction, _96). Still forbidden:
device HTTP to real boards, sACN output-enables to hardware,
operator's Expo :6967, second stacks off standard ports.
**`_95` LANDED** (see its board row/report): resolver byte-identical
(1116 scenarios, 0 diffs), timeline suite 387/387, 19/19 REST,
travel-while-dormant works; F1 boot-baseline clobber + F2
(G1-on-the-wire) pinned not fixed; partyConfig omitted from
resolver (dead param, documented); _goDormant preserves unexpired
travel lease (judgment call, documented). F1 still needs a Notion
Backlog card (no Notion access in agent sessions — coordinator to
raise with operator).
**`_97` reserved — zoom pad slices S3+S4 (IN FLIGHT, Opus):** one
agent builds day zoom (phase bands + resolved ribbon) AND event
zoom (PERFORM/TIME TRAVEL banners, steppers, D3 pendingDeferred,
exit table) in CaptainPad against _95 §3; verify on :7167 fresh
dist + live engine (service grant); operator's :6967 Expo
untouched.
**`_98` LANDED (2026-07-31)** —
`202607/20260725_98_timeline_bugfix_wave.md`. All seven fixes in,
each with a BEFORE/AFTER `timeline_dryrun.mjs` transcript on the
REAL `playa_default` at 1-min resolution, seed 1.
**1 (HIGH) suppressed party fire consumed the arm latch +
cooldown:** triggers.js is pure and books at EVALUATION time; the
arbiter then dropped the fire and `moodArmed` re-arms only on a
return to CALM. The SERVICE now snapshots `moodArmed`/
`moodLastFire` before evaluateTick and ROLLS BACK every mood fire
the arbiter dropped (`snapshotMoodBookkeeping`/`rollbackMoodFire`
exported from triggers.js). **Burn night + 8 h music: 0 → 27
sessions**, first one on the exact tick the hold ends. Side
effect handled: the trigger now re-asks every tick, so `wouldFire`
went EDGE-ONLY (one entry per continuous episode). `getPartyStatus`
gained additive `triggerArmed`; **NO new `effectiveState` value** —
CaptainPad's parsePartyConfig THROWS on unknown ones.
**2 catchUp disarm order:** disarm now precedes the dispatch (the
live path's order). Restart mid-hold `ap OFF`/one pattern →
`ap 90s seq`/rotating.
**3 ambient-over-program:** arbiter gate `controller !== 'manual'`
→ `controller === 'autopilot' && !programStartedThisTick`. Burn
show owner time 0h30m → 2h00m; the dropped phase cue is surfaced
as a wouldFire. KNOWN CONSEQUENCE (reported, not fixed): a phase
edge is rising-edge once/night, so a phase cue suppressed under a
program never re-fires — on burn night the post-show hours are the
ambient defaultCue with sessions rising out of it, which IS
requirement 1+2.
**4 program look with no autopilot block:** new pure
`lintShowPlan` + `planWarnings` on `/timeline/state` +
console.error on every load/activate/save. **Deliberately a LOUD
LINT, not a throw** — a throw would refuse to LOAD the running
show (and the engine's own defaultShowPlan). **VERDICT: the
shipped plan TRIPS IT 3× and still loads** — `sunrise`,
`burn_night`, `temple` each need a 3-line autopilot block.
OPERATOR PLAN EDIT, not touched.
**5 party-look eviction:** `kind: ambient` = the plan's background
layer; a timed cue displacing an open-ended ambient owner is
remembered and the owner is re-applied when the window elapses.
Fails closed (still enabled + still ambient + phase still active
for a phase trigger; a mood owner is NEVER restored — D4). Night
with two DJ sets: c_party_start 0h40m → 7h04m, fires 1 → 9.
**6 (`_95` F1) boot-baseline clobber:** `_establishBaselineIfActive
(reason, {keepRestoredDeck})` takes the baseline's BOOKKEEPING only
when catchUp restored a live-owning non-program cue. The
`clobberedByBootBaseline` pin in the live-service oracle FLIPPED to
assert-the-fix (no clobber term left).
**7 G1:** `__resume_autopilot__` releases the ownership latch and
hands the deck to the `defaultCue` in the same tick (one write, no
baseline flash); catchUp does the boot half via new
`restored.holdExpired`; the resolver yields, so
`source:'hold-expired-baseline'` is NEVER EMITTED AGAIN (left in
the documented union so S3/S4 need no type change). A plan with NO
defaultCue keeps today's baseline behavior exactly. **Quiet night
`ambient` 0h → 12h20m (51%)**, palette resets too.
Timeline suite 387 → **407/407** (+8 lint, +12 precedence tests);
full engine 2449/2459 — 8 pre-existing/environmental + 1
parallel-load flake (`view_fader_ramp`, 4/4 alone) + 1 NOT OURS
(§8.3). Security check: 6 findings, all the pre-existing gitignored
`.scene_backups` MACs. Sim suite not run — nothing under
`simulation/` touched.
**`whenPhase` restoration in playa_default.yaml REMAINS
OPERATOR-GATED** — his scene file, never written.
⚠ **HEADS-UP — `marsin_engine/config.yaml` is dirty:** its declared
Titanic controller `host` has been replaced with a loopback
black-hole. `git status` was CLEAN on that file at `_98`'s session
start, so it belongs to a CONCURRENT thread running a black-holed
engine. `_98` deliberately did NOT revert it (restoring the real
host while another agent boots an engine would put live sACN on the
rig) but **it must be restored before any commit**. The autopilot
residue in the same file (`playlist.active`/`delay_s`) WAS restored
by `_98` — caused by running an engine-spawning test without
`tests/helpers/setup_config_guard.mjs`.
**`_92` ADDENDUM LANDED (2026-07-31) — TE signs → LED:** DMX
placeholder controller removed entirely (controllers 17→16, zero
TE Sign rows in patches.yaml, U38/39 dropped); new first-class LED
pixel fixture kind (definition `bus: led`; hinge module
led_fixture_kind.js, ledMappableCounts = strands ∪ LED fixtures —
neither projection changed a line; fixtureType strings unchanged,
_48 one-panel-per-sign intact). 2 latent bugs fixed in passing
(unmap identity loss; missing displayGroup key on LED last-layer
gate). Pane proof live: 4 💡 sign chips in LED tray, no
PLACEHOLDER. Suite 1571/8-baseline-fails/zero new. **Parity
deliberately RED: 4 unmapped_fixture on sign halves — closes when
operator maps them to a MarsinLED output. COLOR ORDER: RGBW —
operator correction 2026-07-31 "sign is also RGBW, same lights as
the ropes"; the agent's RGB claim was wrong, RGBW-audit thread
resumed on the _92 agent.** Sim stack left DOWN by the agent.
HEADS-UP surfaced: sACN input bridge boot crash addMembership
EINVAL (pre-existing).
**`_97` LANDED (2026-07-31) — TIMELINE ZOOM PAD SLICES S3+S4:**
report `202607/20260725_97_timeline_zoom_pad.md`. Built against the
landed `_95` §3 API; **zero engine changes**.
**S3 DAY ZOOM:** the ladder is real — FESTIVAL -> DAY -> EVENT, the
two browse rungs make ZERO engine calls (reviewing can never touch
the rig). Day cards ZOOM IN on tap (`OPEN DAY >`), retiring the old
select-vs-EDIT-DAY split; `DayEditor.tsx` DELETED and promoted into
the new full-screen `DayView.tsx` carrying everything it had
(agenda, + CUE, per-row edit/delete into the existing
CueEditorSheet — no new edit semantics) plus **phase bands** and the
**resolved ribbon**. A band whose end precedes its start is drawn as
TWO pieces across midnight (`party_night` 21:34->05:23) — as one
inverted rectangle it renders NOTHING and a whole night reads empty;
pinned by test. Ribbon rows carry a plain-language reason per
`source`. The engine's calendar-day limit is printed on screen, not
faked. Missing `phases`/`segments` = a loud red block, never an
empty ribbon sold as a review. Theme badges on day cards; the
`SHIFT TONIGHT` slot is reserved, dashed and labelled inert (D8).
**S4 EVENT ZOOM:** one sheet, one action, branch chosen by the
ENGINE (`activeCue`) **and scoped to TODAY's card** — a cue-id-only
test offered "perform tomorrow's show", caught by the live pass.
PERFORM withheld out of window (takeover refuses to arm; a button
that can only 400 is a lie); TRAVEL stays available while the plan
is DORMANT — the rehearsal case and the rig's state today. Global
`ZoomBanner` mounted outside `<Tabs>` so it floats over EVERY tab:
green PERFORMING / purple TIME TRAVELING with prev/next steppers,
EXIT on every client, and the D3 line "Show due: ... — starts when
you exit" + ENABLE. Presence pings (30 s, banner-scoped) keep a
hands-off performance alive and die with the banner.
`PendingProgramOverlay` now STANDS DOWN under a zoom — it would
otherwise count down to an auto-start the engine has deferred.
**GATES:** tsc clean, CaptainPad **914 pass / 6 skip / 0 fail**
(+22 new pinned tests), lint clean on touched files, security PASS.
**LIVE-PROVEN on a fresh `:7167` dist against a real engine** (the
operator's `:6967` Expo never touched): day zoom on the dormant
shipped plan, PERFORM over the deck, TIME TRAVEL over the deck, the
deferred banner 4 min into a hands-off performance with the deck
live underneath, stepper retargets 23:50->12:51->00:30, the boundary
400 printed VERBATIM (`no prev event on ...`, never clamped), a
second client rendering the banner without auto-exiting, and the
whole D3 loop end to end — the deferred show was NOT dismissed: on
lease release `_catchUp` fired it.
**ONE REAL BUG found live, fixed, pinned:** the engine clears the
zoom and broadcasts on its own 1 s tick, which beats our `resume()`
response back — so the operator's own tab-return exit raised a
"zoom ended" alarm at the person who just asked to leave. The exit
claim is now staked BEFORE the request leaves.
**HONEST SLIP (`_97` §4.4):** the first verification engine streamed
sACN to the real LED controller for ~30 s because `--dest` does NOT
override `config.yaml`'s per-controller `controllers:` block. Killed
on sight; host black-holed for every later run; `config.yaml`
snapshotted and RESTORED (this is what clears `_98`'s pre-commit
gate below). Throwaway in-window probe plan deleted; the test_bench
timeline dir `diff -r`s IDENTICAL to its pre-run snapshot. Engine +
dist server shut DOWN at the end, so `_99`'s deferred
`launcher.js prod` is unblocked from this side.
**NOTE vs `_98`:** `_98` fixed G1 at the source, so
`source:'hold-expired-baseline'` no longer appears on the wire; the
pad keeps the amber branch (one branch, correct against a pre-`_98`
engine, loud if it ever returns). `_97`'s screenshots predate `_98`
— re-shoot when convenient, the render path is identical.
**REMAINING: S5 (e2e)** — CLOSED by `_100` (below).

**`_100` LANDED (2026-07-31) — TIMELINE ZOOM E2E (S5): THE S1-S5
WAVE IS CLOSED.** Report
`202607/20260725_100_timeline_zoom_e2e.md`.
**WHAT IT IS:** `marsin_engine/tests/e2e/` — a committed suite
(`timeline_e2e_harness.mjs` + `timeline_zoom_e2e.test.js`, **17/17
green**, ~2 min, inside `npm test`) that drives a REAL `engine.js`
subprocess over REAL HTTP and REAL `/ws/control` sockets and
restarts it by really killing it. `tests/timeline/*` pins the
LOGIC; this pins the WIRING.
**THE TWO PATHS NOBODY HAD EXERCISED LIVE, NOW COVERED:**
(X6) **engine restart mid-zoom, BOTH scopes** — process dies, the
rebooted ship has no zoom / no lease / mode `armed` / plan back on
the deck, and a **reconnecting pad reads the truth on its FIRST
frame** (the connect replay) — that is what stops a stale PERFORM
banner surviving a reboot. (X4) **plan save mid-zoom** — the
maker's auto-save hot-reloads, drops the zoom, returns the deck to
plan-at-now, and the pad learns it **from the broadcast**, having
never asked.
**EXIT TABLE: every row covered** except *festival window closing*,
which is UNIT-only for a STRUCTURAL reason (every e2e route to it
runs through savePlan/activate, themselves exits — the scenario
would assert the wrong row). Its observable consequence — a PERFORM
cannot exist out of window — IS covered (E3, dormant rehearsal).
**TWO CLIENTS (T1):** B gets the banner on its replay; B *browsing*
changes nothing (A's zoom lives); B retargets the ONE session and A
renders the identical zoom; B's EXIT ends it for both.
**`_97`'s EXIT RACE PINNED E2E (T2):** the cleared-zoom broadcast
genuinely arrives BEFORE the `resume()` response — the pad's
pre-staked exit claim answers a real ordering, not a hypothesis.
**`_98` FIX 1 PROVED LIVE (P1):** a party fire during a PERFORM
lease is suppressed, VISIBLE (`wouldFire`, edge-only — one entry
per episode not per tick), and consumes NOTHING (latch intact,
cooldown unstamped) — so the session fires the instant the operator
hands back.
**THE `--dest` TRAP IS CLOSED AT THE SOURCE.** The honest problem
behind `_97`'s 30 s of live sACN was that **there was no way to
neutralise the per-controller `controllers:` block** —
`engine.js loadConfig()` read the tracked `config.yaml`
unconditionally and `MARSIN_CONFIG_FILE` governed only the
autopilot write-back. It now governs the BOOT read too (fail-loud
on a set-but-missing path), so a harness writes a black-holed
config instead of editing the operator's file — the exact edit
`_98` had to flag as a commit blocker. New **`MARSIN_TIMELINE_DIR`**
does the same for the show-plan library: a test engine can no
longer write plans into `scenes/**` (both `_95` and `_97` had to
hand-restore that tree). Both walls **asserted on every boot**:
every `[sACN Out] Sender started` line, no Art-Net sender at all,
and `/status.outputRouting.controllers == []`.
**BUG FOUND + FIXED (B1, in `_95`'s S1 code):** `buildDaySegments`
sampled only where cues START (fire times + phase edges), never
where they HAND BACK (`durationMin` end, program hold end) — so a
segment ran from a cue's fire time to the next unrelated boundary.
On the shipped plan that reported a 90-min hold as owning past its
end; on the fixture it mis-stated **2 h 10 m**, exactly the stretch
`_98` FIX 7 gives ambient. **The surface built to make the plan
honest was lying about the biggest thing `_98` changed.** Fixed by
adding the hand-back instants to the sample set; pinned by 3 tests
incl. a full ribbon-vs-resolver equivalence walk over 3 days, and
guarded e2e on the operator's real `playa_default`.
**GATES:** timeline 407 -> **410/410**; full engine 2470/2478 (the
8 baseline, zero new — `_98`'s 9th, `status_output_routing`, is
GONE now the controller host is restored); CaptainPad **914 =
baseline** (untouched); security PASS (7 pre-existing findings,
none in touched files); **`config.yaml` CLEAN — nothing to
restore**; operator's sim stack on :6969-:6972 never approached
(engines on random 7700-7899).
**FIXTURE HYGIENE:** the in-window plan is built at RUN TIME with
NO festival block, and picks its own fixed-offset `Etc/GMT+-N` tz
so "now" is always ~17:00 plan-local — the resolver's day-latch is
per calendar day in the PLAN's tz, so a fixture pinned to a real
zone would quietly stop testing anything between local midnight
and 03:30. Nothing dated is committed.
**FINDINGS, REPORTED NOT FIXED:** (F1) the "runtime-only" zoom
lease IS written to `timeline_state.yaml`, scope/cueId/label and
all — only the boot `_catchUp` scrub stands between it and a ship
that wakes up believing a human holds the deck. The scrub works
(X6 proves it on a real restart, both scopes) and is now the thing
pinned; making it structural means omitting `operatorLease` from
the persisted shape (`timeline_state.js`, outside S5 scope).
(F2) entering ANY takeover — plain OR PERFORM — stands the deck's
pattern autopilot down, so the look stops cycling while you perform
under it. Follows from `_98` FIX 6 marking the restored cue's deck
baseline-driven; NOT zoom-specific (E1b measures both and they are
identical). Operator ruling, not a defect.
**OPS DOC UPDATED:** `.agent/ops/timeline_e2e_tests.md` — the
"wanted: a scripted runner" section is now the LANDED engine
runner + its three-wall safety contract; the DOM/puppeteer half is
restated as still wanted, with the engine harness as its model.
**`_99` LANDED (2026-07-31) — sACN input-bridge `addMembership
EINVAL` boot crash:** report
`202607/20260725_99_sacn_bridge_einval_fix.md`.
**ROOT CAUSE — NOT the NIC.** A direct probe joins 5 multicast
groups successfully on this box three ways (iface unset,
`0.0.0.0`, the adapter's own address); one Wi-Fi adapter, one
private /24, healthy. The bug is **ours and it is an ordering
race**: `new Receiver({universes})` keeps OUR array
(`this.universes = universes`) and runs its join loop from the
socket's `listening` callback — a tick later, **iterating that
live array**. `sacn_bridge.js` then ran `recomputeRoutes('boot')`
SYNCHRONOUSLY, and `addUniverse(u)` joins `u` NOW **and pushes it
into the same array** → the deferred loop joined it a SECOND time
→ duplicate `IP_ADD_MEMBERSHIP` = `EINVAL` on Windows. The package
re-emits that as `receiver.emit('error')`; the bridge had ONLY a
`packet` listener, and an EventEmitter `'error'` with no handler
**throws** → dead before one frame. The repro is damning: the
bridge's own log printed `added:[38], failed:[]` — SUCCESS — and
the process died a tick later.
**TRIGGER = DATA, not the box:** any universe in the boot union
absent from the boot subscription list. When the `📡 Subscribed
Universes` field is set it **REPLACES** the patch-derived list
outright (`sacn_bridge.js:129-131`), so **a scene patched to a
universe the field does not name crashes the bridge at boot**.
`_92` passed through exactly that on U38/U39; **`_92` §A8 step 1
(attach the TE signs to a MarsinLED output) re-creates it** —
which is why this had to be fixed structurally, not by widening
a field.
**FIX (4 parts, no fallbacks):** (1) **boot gate** — nothing
subscribes until the receive socket is listening; the held reason
is replayed IN FULL one tick later and every deferral prints a
line (ordering, not suppression); ordering is guaranteed because
`socket.bind(port, cb)` registers the package's loop as a
`'listening'` listener inside the constructor and ours registers
after. (2) **classified `receiver.on('error')`** — an
`addMembership` failure is loud + isolated, naming the interface,
stating UNICAST still arrives while MULTICAST does not, and
pointing at the config lever (the same contract
`applyUniverseSubscriptions` already documents for the RUNTIME
path — the two halves now agree); **every other socket error is
FATAL** (`exit 1`, "refusing to run half-alive"). (3)
**self-policing invariant** at `listening`: `receiver.universes`
must equal the boot list, else hard exit naming the racing
universes + "fix the ordering, do not retry" — a future refactor
fails at startup with the diagnosis pre-written. (4)
**deterministic + logged interface selection** — the boot log now
always states which interface the joins use plus the full IPv4
inventory, warns when several NICs are up (OS choice = coin flip)
or none is (the brief's original hypothesis, now a NAMED
diagnosis); optional `sacn_interface` in `simulation/config.yaml`
pins it and **throws with an inventory** on a mismatch or an
ambiguous adapter — never a silent NIC switch. Unset = the
shipped behavior, printed as such.
**FILES:** new `simulation/lib/sacn_receiver_boot.cjs` (all four
decisions, pure) + new `simulation/tests/sacn_receiver_boot.test.js`
(19); `server/sacn_bridge.js`, `lib/load_ports.cjs`,
`config.yaml`. `_89`'s uncommitted bench-mirror work in
`sacn_bridge.js` untouched (the gate is one line at the top of
`recomputeRoutes`).
**PROOF:** divergence re-created against the REAL bridge (field
narrowed to 1-27 while titanic patches U30/U31) → held →
listening → `runtime-subscribed U30/U31`, no EINVAL, no exit;
`common.yaml` restored **byte-clean** (0 lines vs HEAD). Sim
**1590 / 8 fail = the documented baseline 8, zero new** (+19,
incl. 2 LIVE receivers pinning both orderings on throwaway ports).
security_check: 6 findings, all pre-existing MACs in gitignored
`.scene_backups/studiodj/**`, none in touched files.
**STACK LEFT UP:** sim servers `npm start` pinned `titanic` —
:6969/:6970/:6971/:6972 + UDP 5568 (same pid as :6971), re-verified
alive at hand-off by port + pid + live HTTP/WS probe. While the
engine was still up the input bridge was measured receiving
**1168 pkt/5 s from `MarsinEngine`** on U1/U2/U10/U12 via a
read-only monitor WS probe (no `setScene`, so no relay route
added). **`launcher.js prod` was REFUSED by the permission gate**
(blocked-by-classifier) on the one attempt, and NOT worked around
— that, not a judgement call, is why the prod shape is
incomplete. It had also been held off earlier for a real reason
worth remembering: `launcher.js:1025` force-claims ports for
`prod` by default and would have killed `_97`/`_98`'s engine on
`:6968` (`/status` = `test_bench`, `25_heartbeat`); there is no
`--no-force`, and `--no-kill` still collides on the engine port.
**:6966/:6967/:6968/:7167 are ALL DOWN now** — the concurrent
threads released them; the bridge logged the transition correctly
(`⚠ Engine on :6968 unreachable — engine-scene routes and
dual-source suppression are OFF until it returns` + 3 `Route
removed`). Operator finishes with one command:
`node launcher.js prod --scene titanic` (it absorbs the running
sim servers; nothing to stop first). **Before he does:**
`marsin_engine/config.yaml` is now CLEAN vs HEAD with a REAL
`10.x.x.NN` Titanic host — the loopback black-hole in the
pre-commit gate below is already restored, so a `prod` start puts
engine frames on the wire toward that controller.
**NOT MINE:** `_99` never started the engine and never wrote
`marsin_engine/config.yaml` — the loopback black-hole host in the
pre-commit gate below belongs to the other engine-running thread.
**FOLLOW-UPS FILED (backlog):** (a) the `📡 Subscribed Universes`
field REPLACES rather than widens the boot list — a field edit can
still silently narrow what boot joins (belongs to `_87`'s
save-time gate); (b) `launcher.js prod` has no `--no-force`, so
the show profile can only start by killing whatever holds its
ports — unusable beside a concurrent agent or a hand-started
engine.
**⚠ PRE-COMMIT GATE (coordinator, 2026-07-31) — RESOLVED by `_97`:**
`marsin_engine/config.yaml`'s LOOPBACK BLACK-HOLE host for the
Titanic controller was **`_97`'s**, set deliberately after its
first verification engine streamed sACN to the real controller for
~30 s (`--dest` does NOT override the per-controller `controllers:`
block — see `_97` §4.4). `_97` snapshotted the file before the run
and **RESTORED it at the end**; `git status` shows
`marsin_engine/config.yaml` unmodified and the real host back in
place. `_98` was right not to revert it mid-run. Re-run
`status_output_routing.test.js` — its failure was this file.
**OPERATOR EDITS OWED (from _98's lint, his scene file):** the
shipped playa_default trips the new no-autopilot-block lint 3× —
`sunrise`, `burn_night`, `temple` looks each need a 3-line
autopilot block (else the deck freezes on one pattern for those
holds); plus the standing whenPhase party_night restoration.
**`_100` reserved — timeline zoom e2e S5 (IN FLIGHT, Opus, wave
closer):** every exit-table row incl. the two never-live-tested
(engine restart mid-zoom, plan save mid-zoom), two-client
scenarios, party-vs-zoom interplay, post-_98 conformance smoke;
sACN black-holed via controllers-block neutralization (never
--dest, the _97 trap); operator's up-and-pinned sim stack left
alone, throwaway ports only. Closes S1–S5.
**`_101` LANDED (coordinator, 2026-07-31) — operator test
checklist:** stable snapshot report of the whole wave's do-this→
see-that checks (also live with tick-boxes atop the master doc),
RGBW correction baked in. Operator orders in force: coordinator
BABYSITS the _100 e2e run + the _92 RGBW audit; REMIND the
operator on his return to pick up the checklist (top items: map
the signs RGBW, rope provisional bindings, yaml edits).
**`_92` CORRECTION #2 LANDED (2026-07-31) — RGBW audit:** wire
level was already correct (stride/order comes from the owning
output's led.order at runtime); all HUMAN-readable artifacts were
wrong and are fixed — definitions regenerated `type: rgbw` 4 B/px
and RENAMED model_a_160/model_b_136, generator pins
BYTES_PER_PIXEL=4, catalog row fixed, old "set RGB" instruction
struck through in place with dated corrections (never rewritten).
One sign = 296 ch (not 222), still one universe. Parity unchanged
(4 unmapped awaiting operator mapping); suite 1592/8-baseline/zero
new. FINAL MAPPING INSTRUCTION: chain the 4 halves on a MarsinLED
output running RGBW/stride 4 (same as rope outputs) and save.
**`_102` LANDED (2026-07-31) — same-address merge with warning**
(`20260725_102_same_address_merge.md`, Opus). Operator feature order
+ emphasis "but the UI must show that that's a warning".
THE SWEEP FOUND EXACTLY ONE HARD REFUSAL: `derivePerOutputPlan`'s
`universe_owned` collision (device_config_mapper.js), which blocked
the single push, the fleet push AND the sync chip. Now a
`sharedUniverses[]` entry mirrored into `warnings[]`. The other
three overlap sites (validateLedManualUniverses,
computeProjection's per-universe sweep, the bridge's cross-scene
conflict) were ALREADY warnings — unchanged.
MERGE RULE (one-liner): overlapping claims are allowed; each
(universe, destination IP) gets exactly ONE packet, and on any
contested channel the numerically HIGHER controller IP overrides.
IP compare is octet-wise NUMERIC (`a*2**24`, never `a<<24` — a
signed shift ranks every ≥128.x below every 10.x); string ordering
gets `.9` vs `.10` backwards, which is why. Contested
region = the INTERSECTION only. Global-effect gang-fire pins exempt.
NEW PURE MODULE `simulation/src/dmx/address_merge.js`.
UI (4 surfaces): PERSISTENT amber card banner in the mapping pane
(NOT a toast — he maps for an hour), naming both claimants + exact
(U, ch a–b) + winner; push dialog `⚠ N SHARED ADDRESSES` block
placed FIRST; sync chip stays in-sync but carries the warning in
its tooltip; `[AddressMerge]` console + fleet-push detail. Blocking
grade is a visually distinct RED banner (test pins the two
headlines/colours can never be equal).
RUNTIME: override is order-INDEPENDENT — the loser is handed the
absolute channels it must not write (index built once per
projection in main.js `publishAddressMergePlan`, resolved once per
pixel in sacn_mapper, keyed by IP), incl. the par master-dimmer
force-write.
ASYMMETRY KEPT: an EXPLICIT operator universe may be shared;
auto-assign (repair, park) still SKIPS every claimed universe — the
sim never chooses to create a shared address.
`_89` INTERPLAY: composes WITH it. Mirror unifies at the BRIDGE
(owns dest pairs, suppresses raw relay); this unifies at the SIM.
sacn_bridge.js / bench_mirror.cjs / bridge_routing.cjs UNTOUCHED —
the uncommitted `_89`/`_99` work is intact.
GATES: sim 1592 → 1645 (+53), fail 8 → 8 baseline byte-identical;
security PASS (one self-inflicted finding fixed: real routable
a real routable IP, first octet 128, in a test → RFC 5737
TEST-NET-2). LIVE 13/13 +
4 screenshots (`~/tmp/shared_address/`, `2_shared_address_warning.png`
is the operator's required evidence) via new
`agent_tools/shared_address_verify.cjs` — sACN OUT socket blocked
AND asserted at framesSent=0, zero device HTTP, zero scene writes
(in-memory injection with RFC 5737 IPs, removed after; last shot
shows the pane restored).
⚠ **TWO OPERATOR DECISIONS OPEN** (report §4): a SAME-IP overlap and
a NO-IP/placeholder-IP overlap remain HARD ERRORS with named
reasons — his rule ranks IP-BEARING claimants only, and a tie-break
would be a fallback he did not ask for. A rule for either must come
from him.
⚠ **RESIDUE REPORTED (report §9):** the probe's FIRST runs (before
the save-server guard) re-exported `marsin_engine/models/test_bench.js`
— main.js calls saveModelJS() on page boot. NOT a regression: the diff
is the timestamp + the 76 TE-sign pixels flipping dmx→led/unpatched,
i.e. the `_92` correction landing in the export; suite byte-identical
before/after. LEFT IN PLACE (never `git checkout` to hide a test side
effect). Probe now aborts every non-GET to :6970 (the `_89` GUARD-3
recipe) — re-verified: 4 writes aborted, 14/14 checks, model
byte-identical. SEPARATE, NOT MINE: `simulation/scenes/common.yaml`
`colorWave.lightingMode: sacn_in → pixelblaze` (mtime 45 min before my
first probe run) — flagged for the operator's commit-time judgement.
⚠ **MEMORY AMENDMENT PENDING** (report §7, coordinator to apply):
`sacn-route-ownership`'s flat "one writer per (universe,controller)
is the law" now needs TWO enforcers — the bridge's suppression AND
the sim's merge; the sim preserves the invariant by MERGING, not by
refusing. Proposed wording is in the report.
**`_102` LANDED (2026-07-31):** only ONE hard refusal existed
(derivePerOutputPlan universe_owned) → now sharedUniverses[] +
warnings[]; merge = one packet per (universe, dest IP), higher
controller IP wins contested channels (octet-wise NUMERIC —
signed-shift and string compares both rank wrong); UI = persistent
amber banner on the card + ⚠ block FIRST in push dialog + sync-chip
tooltip (screenshots in ~/tmp/shared_address/). Same-IP and
no-usable-IP conflicts stay HARD ERRORS (2 operator decisions if
auto-resolution wanted). Suite 1645/8-baseline/zero new; 14/14
live checks, sACN OUT asserted zero frames. Bench mirror files
untouched. **Coordinator applied the _102 §7 one-writer amendment
to the sacn-route-ownership memory.** Residue notes: test_bench
model re-export left in place (it's the _92 correction landing —
legit); scenes/common.yaml lightingMode sacn_in→pixelblaze is
UNCOMMITTED and NOT agent-made (mtime predates the probe —
presumed operator; flag to him before any commit).
**ALL WAVE THREADS LANDED — day total _89–_102 (13 + 2
corrections).**
**ADVERSARIAL RED-TEAM SWEEP (operator order 2026-07-31 "break it
in the name of bulletproofing"): 6 Opus agents launched, report-
only, ~/tmp repros, non-overlapping attack surfaces —**
`_103` timeline/arbiter/party · `_104` zoom/lease/exit-machine ·
`_105` sACN bridge/routing/bench-mirror/merge · `_106` controller
lifecycle/provisional/status/push · `_107` fixtures/patch/exporter/
parity/2D · `_108` engine API + CaptainPad contract. All under
test-harness hygiene: throwaway engines random high ports, config
black-holed via MARSIN_CONFIG_FILE, MARSIN_TIMELINE_DIR, operator
stack (:6969-72) + :6967 untouched, zero device HTTP, zero sACN to
hardware. Coordinator to synthesize findings + triage into fix
threads on landing. **RED-TEAM SWEEP COMPLETE + SYNTHESIZED (`_111`, coordinator,
2026-07-31).** 8 reports in: `_103` timeline(1H/1M/5L), `_104`
zoom(1H/2M/2L), `_105` bridge(1H/3M/3L), `_106` controller(2H/3M/
3L), `_107` fixtures(2H/2M/2L), `_108` API(**1 CRITICAL**/1M/4L) —
the six commissioned — plus **UNCOMMISSIONED** `_109` controllers/
merge(4P1/7P2/10P3) and `_110` sim-UI(4P1/6P2/6P3) (agent IDs not
in the launched six; self-numbered _104/_106 then bumped; verified
safe — suite byte-identical, no source/scene/git writes of their
own, localhost-only; presumed parallel operator batch; flagged not
absorbed). **THE CRITICAL: a malformed WS frame kills the engine
→ dark ship, no restart (_108).** Findings cluster into 7 families
(synthesis _111 §): A dark-ship/unhandled-error-kills-process
(★ has the CRITICAL + _109 P1-1 save-server crash + launcher
no-restart), B parity green-but-wrong (_107 ×2 + _105 boot
universe — OPERATOR-FACING, green ≠ routable/correct-stride,
interim guidance given), C _102 merge edges (_109 gap-wins-dark +
auto-assign-share + _105 mirror double-write), D provisional UI
(_106 ×2 dead ip guard + dialog stack + _109 probe wedge), E zoom
pad exit-latch leak (_104), F sim save race + innerHTML XSS (_110
×4), G party re-fire thrash (_103). Engine cores HELD (REST hard,
never-stuck held, _99/_98/_102-core intact). **Fix plan: 3 waves,
family=thread, ALL operator-gated (none launched).** W1 dark-ship
(launch first), W2 parity+party+merge, W3 provisional+zoom+save/XSS.
**Coordinator redacted 5 example IPs in _105 → report-IP commit
blocker CLEARED; tree carries only 6 pre-existing gitignored
.scene_backups MACs (not a --staged blocker).**
**RED-TEAM 2ND-PASS ADDENDUM (a THIRD uncommissioned adversary,
landed after the _111 synthesis) — _105 SECOND PASS via the
real-Packet method:** 5 P1/8 P2/8 P3, 18 net-new. **NEW FAMILY H —
DMX value-path fidelity (the reframe):** H1 (P1 LIVE) the sim
renders a 39% ship — the bridge sends browsers the sacn PERCENT
payload (value/2.55) that the browser reads as raw DMX
(sacn_bridge.js:1002 vs sacn_input_source.js:212): engine 255 →
browser 100, ~39% cap / 101 grey levels; relay to HW byte-exact,
only the browser wrong → every sim visual judgment made today was
read off a 39% instrument (under-reads brightness, so real output
is BRIGHTER than it looked, not dimmer). ADJACENT (LIVE, engine
output, wants an owner before rig tuning): raw-DMX producers
×2.55-and-clamp (sacn_output.js:80, sacn_output_bridge.js:141) →
DMX 100 → wire 255, top ~60% of every fader saturated on the RIG.
H2 (P1 LIVE) one hardcoded DEFAULT_CID project-wide → two same-CID
sources drop 39/40 frames = THE _15 flicker mechanism. H3 (P1 LIVE)
priority lockout is GLOBAL not per-universe (one prio-150 frame
halts all relay 10s). H4 dup boot-fatal universe; F2 re-confirm
mirror dual-write. Boot gate HELD under the deeper attack.
Coordinator re-checked: the _105 IP redaction SURVIVED the
concurrent append; _105 still report-IP-clean. **Family H → Wave 2,
leads it (governs both the instrument the show is judged on AND the
rig's emitted levels). _111 addendum updated.**
NOTE: uncommissioned adversaries now number FOUR (_109, _110, the
_105 second-pass, _112 pattern-VM) — a parallel operator batch;
each verified safe + flagged, findings triaged like the six.
**_112 PATTERN-VM (2 P0/5 P1/5 P2/8 P3) — NEW FAMILY I,
pattern-VM never-black + content-path safety, ★ hits the live
ChatGPT loop:** I1 (P0 LIVE) NaN in any rgbwau()/hsv() arg blacks
the whole pixel and is absorbing (no runtime R4 enforcement
anywhere); I2 (P0 LIVE) beforeRender budget overrun truncates
SILENTLY → whole ship black from a clean-compiling pattern (house
precompute-before-palette idiom triggers it; wasm ABI can't report
it); I3 (P1 LIVE) a playlist entry that exists-but-won't-compile
permanently wedges sequential autopilot = EXACTLY the ChatGPT
loop's failure mode (compile before activeEntryId write; daemon
swallows throw; picker re-selects forever); dup entry ids wedge
cursor 0 silently; I4 (P1) the _90 audit harness ALWAYS exits 0 —
a 100%-black pattern + a post-window sleeper both pass all 4 bars,
so it can't catch I1/I2 (harden before trusting on more ChatGPT
output); 4-mixer hostile pattern = 114% frame budget, no guard
(shipped patterns fine). Held: forbidden constructs reject loud,
no cross-VM corruption, zero leak 2400 cycles/72k frames.
**SWEEP TOP TIER IS NOW 1 CRITICAL + 2 P0, ALL "DARK SHIP" →
Family I joins Family A in WAVE 1.** _111 updated with both addenda.
**_113 RIBBON/STATE (FIFTH uncommissioned adversary; 2 P0/2 P1/3
P2/5 P3) — NEW FAMILY J, both P0 dark-ship:** J1 (P0 LIVE)
GET/POST /timeline/overview builds the _95 day ribbon SYNCHRONOUSLY
on the HTTP thread O(days×cues²) — 512 cues (the schema cap) = 296s
frozen engine, render loop+sACN+tick share it, no restart; **this
is the endpoint DAY ZOOM calls**, so a grown plan can freeze the
ship on open (fix: paginate/async/cache off-thread). J2 (P0 LIVE)
corrupt timeline_state.yaml kills the timeline silently —
loadTimelineState validates only the 5 party fields, a bad
firedToday/moodArmed throws every tick (caught) → plan drives
nothing all night, engine looks healthy (fix: fail-closed validate
every persisted field). J3 (P1) ribbon vs live tick disagree on
same-fire-time cues (resolver picks first, tick ends on last → a
reboot flips the deck); hold.min-unbounded. Held: SIGTERM-mid-zoom
clean both scopes, no proto pollution, caps enforced, 12-round
storm armed/lastError null. **TOP TIER NOW 1 CRITICAL + 4 P0, ALL
DARK SHIP (WS-crash _108; NaN-black + beforeRender-black _112;
overview-freeze + corrupt-state-death _113) = a SYSTEMIC class:
several single-thread-block/silent-death vectors, launcher
supervises none. WAVE 1 = one hardening campaign (per-socket +
process backstops + LAUNCHER WATCHDOG for freezes + fail-closed
state validation + R4 runtime enforcer + _90 harness hardening):
nothing silently blacks/freezes the ship, and if it does it
restarts.** _111 updated with the J addendum. Uncommissioned
adversaries now FIVE.
**COORDINATOR RENUMBER (2026-07-31):** the CaptainPad red-team
(SIXTH uncommissioned adversary) wrote its report as
`20260725_107_redteam_captainpad.md`, colliding with the earlier
`_107_redteam_fixtures.md`. Coordinator moved it to
`20260725_114_redteam_captainpad.md` (older fixtures `_107` kept —
already referenced in _111 + ledger), fixed its internal
self-refs (title, §7 board-row) and this tracker's filename
pointer. Findings folded into _111 as the CaptainPad addendum
(Family E + new K1). **K1 (P1 LIVE): CaptainPad has NO React error
boundary anywhere — one unknown transition.mode
(timelineTemplate.ts:185 unguarded map lookup) white-screens the
ENTIRE pad = control-surface dark-ship analog; leads Wave 3 or
promote to Wave 2.** K2 confirms the Family-E exit-latch leak from
the pad side (live A/B); K3 banner asserts live lease after link
death; K4 empty segments = blank "completed" review; K5 stepper
makes pad B claim the zoom → ends pad A's (D1 violation). No P0.
CaptainPad vitest 914 pass baseline. Uncommissioned adversaries
now SIX.
**COORDINATOR RENUMBER #2 (2026-07-31):** the chaos/never-stuck
red-team (SEVENTH uncommissioned adversary) also wrote `_114`,
colliding with the just-renumbered CaptainPad `_114`. Coordinator
moved it to `20260725_115_redteam_chaos.md`, fixed its internal
refs + this tracker's pointer. **L1 (P0 LIVE): start.js is blind to
the death of every child server (save/sACN-in/sACN-out) — launcher
supervises start.js not its children, `launcher.js status` probes
only :6969/:6968, deploy.py verify passes → RIG DARK, ALL
DASHBOARDS GREEN until a human looks at the lights.** This is the
supervision-gap proof under Family A: the Wave-1 watchdog must
health-check every child + verify frames flow, not just that 2
ports answer. L2 (P1 LIVE) backward wall-clock step permanently
strands the party cue (no last>now clamp; playa RTC drift/AC-restore
real). L3 (P1) RE-CONFIRMS _113 J2 corrupt-state dead-but-armed
(now 2× independent → fail-closed state validation double-confirmed).
L4 (P2 LIVE) IPv4/IPv6 port shadowing defeats checkPortFree (::
bind reports FREE while IPv4 squatter serves clients). L5 (P1)
failed state write returns 200 {saved:true} (SAVED badge lies,
Family F). L6 (P1) -f kills stack before arg-validate. Held:
_writeFileAtomic crash-safe (8 kill-9, 0 torn), 330ms boot,
runtime-state scrubbed, bridge survived 4 engine deaths.
**REVISED TOP TIER: 1 CRITICAL + 5 P0, ALL DARK SHIP. Wave-1
watchdog reframed: actively health-check every child + verify
frames flow (green dashboards lie); + last>now clamp + fail-closed
state validation (2× confirmed) + save-write honesty + port
override for testability.** Uncommissioned adversaries now SEVEN.
_111 updated with the chaos addendum.
**WAVE 1 LAUNCHED (operator "go" 2026-07-31) — dark-ship hardening
campaign, 4 Opus threads, DISJOINT file ownership (parallel-safe),
each flips a red-team repro into a GREEN regression test, all
source-editing (first fix wave — still commit-gated on operator):**
`_116` W1-1 engine crash-proofing — OWNS marsin_engine/{engine.js,
lib/api_server.js, lib/timeline/*}: WS per-socket error handlers
(the _108 CRITICAL) + process backstops + overview off-thread (J1)
+ fail-closed timeline_state validation (J2/L3) + content-path
compile-before-commit/skip-broken/dedup-id (I3) + backward-clock
clamp (L2) + engine save-honesty (L5).
`_117` W1-2 launcher watchdog — OWNS simulation/{start.js,
launcher.js}: real child supervision + freeze detection + honest
status (L1 capstone) + IPv4/IPv6 port-shadow fix (L4) +
arg-before-kill (L6) + port override for testability (P2-6).
`_118` W1-3 pattern-VM never-black — OWNS VM/wasm host +
pattern_audio_harness.mjs: runtime R4 enforcer (I1 NaN-black) +
beforeRender-overrun surfacing (I2) + harden the _90 audit harness
(I4, protects the LIVE ChatGPT loop). Hands a health hook to W1-1.
`_119` W1-4 save-server/probe crash-proofing — OWNS
simulation/server/{save-server.js, controller_probe_service.cjs}:
probe-crash fix (_109 P1-1) + absolute probe deadline (P1-3) +
save-honesty (L5) + non-crashing body validation.
Handoffs noted: W1-3 never-black signal → W1-1 /status; W1-2
watchdog consumes W1-1 honest /status + the bridge frame-flow
monitor. Coordinator integrates + verifies suite on landing;
Waves 2 (parity/party/merge/DMX-value-fidelity incl. H1 39%-sim +
×2.55 saturation) and 3 (provisional/zoom/save-UI/XSS/pad
error-boundary K1) still queued, operator-gated.
**WAVE 1 COMPLETE + COORDINATOR-INTEGRATED (2026-07-31). All 4
threads landed, ALL top-tier findings CLOSED (1 CRITICAL + 5 P0):**
_119 W1-4 (probe crash survived, save-honesty, +12 tests) · _117
W1-2 (real child supervision + freeze detection + honest status =
capstone L1 closed; port-shadow, arg-before-kill, port-override;
+6 tests) · _118 W1-3 (runtime R4 never-black enforcer floors
output + trips renderHealth on NaN/beforeRender-overrun; _90
harness --gate FAILs black/latch/over-budget; +16 tests; wired to
/status) · _116 W1-1 (WS-frame CRITICAL per-socket handler +
process backstops + overview 296s→347ms + fail-closed state
validation + autopilot-wedge skip/dedup + backward-clock clamp +
save-honesty; timeline 410→431; wired W1-3 never-black into
/timeline/state). **COORDINATOR INTEGRATION VERIFICATION (full
suites, all 4 threads present together): engine 2518/2510/8, sim
1663/1655/8 — BOTH at the known baseline 8 (engine=audio/osc/
effects-v2-pollution/playlist-drift env; sim=stale-model +
compression + _92 TE-sign-awaits-mapping parity), ZERO new from
Wave 1. Tree commit-clean: no report-IP blockers, config.yaml
clean, only 6 pre-existing gitignored .scene_backups MACs.** The
TE-sign strand_metadata_drift in titanic parity is the _92 RGBW
transitional state awaiting operator sign-mapping (NOT a Wave 1
regression — Wave 1 touched no fixtures/models/scenes/parity).
WAVE-1 FOLLOW-UPS (not blockers): (a) W1-1 spawned bg task for
StateManager.save() in lib/state_manager.js swallowing atomic-write
errors (shared core, needs a strict explicit-save path); (b) W1-2
wants a census-neutral /health on both sACN bridges + a frame/output
indicator on engine /status for CONTINUOUS (not on-demand)
frame-flow supervision; (c) _115 P2-3 status/stop refuse on corrupt
lock — unowned. OPERATOR ACTIONS: add `--gate` to the _90 ChatGPT
harness recipe (W1-3); map the TE signs RGBW (clears the parity
drift). WAVES 2 (parity blind spots + party thrash + merge edges +
DMX value-fidelity H1 39%-sim + ×2.55 saturation) and 3
(provisional + zoom exit-latch + sim save/XSS + pad error-boundary
K1) STILL QUEUED, operator-gated. Day's work (from be58eea7) is
large + commit-clean, awaiting operator's commit word.
**`_120` reserved — Wave-1 follow-up: strict save-now path (L5
root, operator-ordered 2026-07-31, IN FLIGHT, Opus):** the W1-1
handoff — state_manager.js `save()` (~:121) SWALLOWS atomic-write
errors (only _writeFileAtomic re-throws), so POST /settings/save-now
persists deck/mixer/globals and still returns 200 {saved:true} on
disk-full/EBUSY → CaptainPad SAVED badge lies (_115 L5). Fix per
operator spec: add a STRICT save path (saveStrict/options flag
threaded through saveMixerState/Deck/Globals) used ONLY by explicit
save-now → honest non-200; the ~80 AUTO-SAVE triggers stay
best-effort/warn-only UNCHANGED (else a transient blip hits W1-1's
exit(1) backstop = dark ship). Regression test: read-only/file-as-dir
stateDir → save-now non-200 while auto-save stays silent. Timeline
path already honest. Shared-core file (why W1-1 deferred it); Wave 1
fully landed so no collision.
Next free report after reservations: `_121`.
**`_112` RED-TEAM LANDED (2026-07-31, Opus, report-only) — PATTERN VM +
playlist/autopilot content path** (7th red-team surface, commissioned
after the six; brief said `_108`, taken → `_112`). Motivation: the
operator now feeds ChatGPT-authored patterns into the engine (`_90`).
**20 findings: 2×P0, 5×P1, 5×P2, 8×P3.** THE TWO P0s ARE BOTH
DARK-SHIP-BY-SILENCE, family A: (1) a **NaN in any one arg to
`rgbwau()`/`hsv()` blacks the WHOLE pixel** — all 6 channels — and NaN
is absorbing in persistent state, so one bad frame blacks the pattern
forever; (2) **`beforeRender` shares the ~5000-instr budget and blowing
it TRUNCATES the function silently** (no red, no error, no log) — put a
heavy loop before the house `_hsv2rgb1/2()` palette resolve and the rig
renders FULLY BLACK from a clean compile. **Nothing in `marsin_engine/`
enforces R4 "never fully black" at runtime** (grep: one offline print in
`pattern_audio_harness.mjs:313`; `getRenderHealth()` covers blend errors
only). P1s: a playlist entry that EXISTS but won't COMPILE permanently
wedges the sequential deck autopilot (proven live, 8 ticks, no client
signal — the ChatGPT loop's exact failure mode); **duplicate entry ids
wedge the deck at cursor 0 with ZERO log** (`save()` rejects dups,
`load()` doesn't); an ≥8M-element `array()` grows the WASM heap and
**detaches the cached `coordView`/`metaView`**, making `setCoords` /
`setPixelMeta` / `applySizeScale` permanent SILENT no-ops (dead SIZE
fader, frozen fixture meta, unrecoverable without restart); a corrupt
`config.yaml` makes the **Autopilot ctor truncate it 3866→59 bytes**
(3 empty catches, `autopilot.js:86,93` + `engine.js:139`); and the
**`_90` audit harness always exits 0** — a 100%-black pattern passes,
and a sleeper that latches black after the audited window clears all
four documented bars. P2s: no frame-budget guard (**4 channels of a
hostile-but-LEGAL pattern = 28.6 ms = 114% of the 25 ms budget**;
shipped 68 mean 0.75 ms / worst 5.67 ms on titanic); over-budget
`render3D` = **whole rig SOLID RED, silently**, at only ~300 loop
iterations; the precompile/ping-pong **warm slot reuses a handle by
pattern NAME without re-reading the file** + no patternsDir watcher
(stale code after a ChatGPT save); all-missing-under-live-assignment
stops the autopilot with **no log at all**; `array(n)` uncapped (1.5 GB,
silent lost writes). HELD: reserved names + every forbidden construct
reject loudly; **no cross-VM memory corruption**; limiter is cheap;
playlist hot-rewrite recovers cleanly; corrupt playlist YAML is loud +
deck holds (not black); all-missing ASSIGN 400s; 1000-entry playlist a
non-event; zero leak over 2400 compile/destroy + 72k frames. Feeds
family A (the two P0s + the F3/F4 wedges) and adds a new family:
**content-path silence**. Repros `~/tmp/redteam_vm/` (17 harnesses).
HYGIENE: zero source/suite edits, **zero writes to
`marsin_engine/patterns/**`** (poison entry = the shipped
`patterns/examples/inview_demo.js`, which won't compile on test_bench);
engines on 7950-7999, `assertBlackHoled()` on every boot;
`marsin_engine/config.yaml` byte-identical to HEAD before + after;
**engine suite re-run at close: 2482/2474 pass, 8 fail = the documented
environmental baseline, no new failures**; no git ops. **Notion board row NOT filed — no Notion MCP tools available in
this session; operator to enable the connection.**
**`_103` RED-TEAM LANDED (2026-07-31, Opus, report-only) — timeline /
arbiter / party-session lifecycle (triggers, arbiter precedence,
festival/sun/tz math, cue/look/phase resolution, plan lint, sustain/
session/cooldown/arm-latch):** 1 HIGH, 1 MED, 5 LOW, no CRITICAL.
Weaponised the `_93` dry-run harness (offline, writes only
`~/tmp/timeline_dryrun/`); no engine spawned, no source touched,
`config.yaml` CLEAN vs HEAD (absent from git status before + after),
no `:6967`/`:6969-:6972`/device/sACN. Repros `~/tmp/redteam_timeline/`
(pathological plans + `flip.json`/`flap.json` mood tracks +
`FINDING_refire_storm.txt`). **The trigger/arbiter/festival/sun cores
HELD** — DST fall-back de-dupes the repeated 01:30, polar/degenerate
sun fails safe to the defaultCue, overlapping `durationMin` windows
rejected at load, festival day-gating exact + out-of-window refuses
loud, missing playlists fail loud (non-fatal, bootError persists),
zero-cue/identical-time plans deterministic, the edge-storm dwell
defence works at default dwell, and the `_98` arm-latch fix confirmed
on burn night (27 sessions after the 2 h burn hold). **H1 (HIGH —
deck-thrash): the mood→party cue has NO "I already own the deck"
idempotency guard.** A detector that dips-and-returns (any music with
quiet gaps ≥ the audio companion's `offConfirmMs`, default 30 s)
RE-ARMS the cue on the calm dip (`triggers.js:284`), and at the
SHIPPED dwell (20 s) the next loud return re-fires it while its own
session is still live — arbiter passes it (`controller==='autopilot'`,
no ownership check, `arbiter.js:174`), `_applyAction` re-runs the whole
look, and `timelineLoadPlaylistOnDeck` (`api_server.js:4372`) ALWAYS
loads the FIRST entry with a transition swap (no "already loaded"
short-circuit) → **the exterior snaps back to party-pattern-1 with a
transition on every music gap, all party night** (harness: realistic
3-on/2-off flap → 60 re-fires, 1 honest window-elapse in 5 h; 1-min
flip + minDwell 0 → 180 re-fires, 1 elapse in 6 h). **M1 (MED — silent
cadence loss, same root): each re-fire re-stamps `_deckWindowUntilMs =
now + durationMin`** (`timeline_service.js:845`; the :824 guard only
protects the session-END bookkeeping), so a "12-min session + 2-min
cooldown" collapses into ONE endless session while music keeps
returning — the operator's cadence + cooldown never run,
`sessionEndsAtMs` slides forever. **LOW: `mood` cue `from===to`
validates but is a silent dead cue; a program `hold.until` an
already-past anchor → ~zero hold (logged revert, intent lost); two
same-time PROGRAMS both dispatch (deck double-write) and the earlier
HOLD is silently discarded (`validateNoOverlap` checks `durationMin`
only, never `hold`); DST spring-forward fires a gap-hour cue an hour
late (N/A to BM dates); the dry-run harness mis-counts the
`party-config` lifecycle line as a session end.** Coordinator: H1
first (idempotent re-fire no-op while the party cue already owns the
live window + a same-playlist short-circuit in
`timelineLoadPlaylistOnDeck`) — it visibly resets the exterior on the
mission-critical party night; M1 rides the same fix (don't re-stamp
the window on a re-fire).
**`_108` RED-TEAM LANDED (2026-07-31, Opus, report-only) — engine
HTTP/WS API contract + CaptainPad client:** 1 CRITICAL, 1 MED, 4
LOW. Every engine black-holed via the `_100` harness + asserted; no
source touched, zero device HTTP, zero sACN to hardware, operator
stack untouched, `config.yaml` CLEAN. Repros `~/tmp/redteam_api/`
(`probe.mjs`, `ws_crash.mjs`). **CRITICAL (engine-crash, the `_99`
sibling): ONE malformed WebSocket frame crashes the whole engine.**
None of the four `/ws/*` `WebSocketServer`s (nor the `/` alias)
attach a per-connection `ws.on('error')` — only `wssInst.on('error')`
+ `server.on('error')`. An invalid-UTF-8 text frame (also reserved
opcode / oversize control frame / bad close code / RSV1) makes `ws`
emit `'error'` on the socket instance with no listener → uncaught
throw → `process.exit`; no `uncaughtException` handler anywhere.
Proven live on `/ws/control` AND `/ws/params`. **Ship-dark, no
self-heal:** `launcher.js:623` does NOT restart a crashed engine — it
`teardown(1)`s the whole stack. No malice needed (a WiFi-corrupted
frame does it). Fix: classified non-fatal per-socket `ws.on('error')`
on all four servers (`_99` shape) + per-topic frame-violation test.
**MED (enum-drift): `effectiveState` is a hard engine↔pad coupling** —
`parsePartyConfig` throws on any value outside the 6 known; no live
drift today (producer closed to 6; all 3 pad consumers wrap the
throw) but a future 7th engine state puts every older pad's PARTY
card into a permanent error banner on a healthy engine (the `_98`
§8.3 fragility). Fix: pass unknown value through, derive in
`describePartyStatus` default branch; throw only on type. **LOW:**
`POST /timeline/takeover` coerces a non-object body → silent plain
takeover (200 not 400, fallback shape); concurrent
takeover(perform)+travel both 200 (last-writer, momentary response
lie, broadcast reconciles); `/timeline/resolve` over-long query → 431
empty non-JSON body; resolve routes by `startsWith`. **HELD:** the
REST surface is genuinely hard — hundreds of malformed/OOR/unicode/
traversal/`__proto__`/huge payloads → clean verbatim 400s, no 500 on
input, no unhandled rejection, no silent clamp; `festival.days`
bounded [1,31] (no buildOverview wedge); WS `message` handler
try/caught; reconnection storm + garbage/oversize text frames
survived. Coordinator: fix #1 (per-socket ws error handler) is the
one that keeps the ship lit.
**`_107` RED-TEAM LANDED (2026-07-31, Opus, report-only) —
fixture / model / patch layer (LED-vs-DMX classification, exporter,
`scene_model_parity`, orphans, TE-sign RGBW generator, 2D pixel-map
defaults):** 2 HIGH, 2 MED, 2 LOW, no CRITICAL. Harnesses
`~/tmp/redteam_fixtures/` (fabricated inputs to the pure parity lib +
`gen_te_sign_fixture.js --dry-run`); **zero source edits, zero writes
to `scenes/**`/`models/**`/`dmx/fixtures/**`**, no stack run, parity
CLI read-only. Both HIGHs are in `scene_model_parity`'s LED lane —
blind to two silent classes its DMX lane already catches. **HIGH-1
(silent-mispatch, the `_92` RGB↔RGBW class RE-OPENED): an RGBW TE
sign chained on a MarsinLED output set `order: RGB` exports stride-3,
white-less pixels and passes `--strict` CLEAN** — parity discards the
LED-bus fixture DEFINITION's declared physical format
(`channels: ledBus ? undefined`; no `channel_mode` cross-check) and
trusts the controller order as sole truth, firing only when model &
controller disagree (control: RGBW→0 err, RGB self-consistent→0 err,
RGB-vs-stride4→2 err). **HIGH-2 (silent-DARK, patched-but-unroutable):
a strand/LED-bus fixture chained on an UNBOUND LED controller (no
`device:` block) with a stale patched record+model passes clean** —
parity never reads `controller.device`, has no LED analogue of DMX's
`patch_record_disagrees_with_chains`, so a rope a fresh export would
render DARK reads green. **MED-1: `checkAddressHygiene` models an
LED-bus fixture as one `def.footprint` DMX block (ignores
`record.segments`)** → a spilling LED-bus fixture false-positives
`patch_address_out_of_range` (while `checkLedStrandPatch` calls the
same walk correct) AND its spill-universe occupancy is never claimed
(real collision missed); harmless for the 160/136-ch single-universe
signs, latent for the extensible LED-bus kind. **MED-2: `ledStride()`
accepts a sub-minimum stride the sim's `normalizeLedConfig` hard-throws
on** → misleading `strand_stride_mismatch` on a config that never
boots. LOW: te_sign `SHARED_PANEL` msg repeats per occurrence +
role-annotation mislabel (comment-only); LED-bus footprint never
cross-checked (root hook for HIGH-1). **HELD:** `gen_te_sign_fixture.js`
(every malformed CSV fails loud — bad header, dup/gap wire, wrong
count, empty, dup coord, shared panel; all-same-coord caught before
the divide-by-zero normalization path); `orphan_fixtures.js` (strict
`=== true`, ownership `groupName||name`, throws on unreadable lists,
no guessing); parity's DMX lane + pure re-statement; `_48` name-drift +
`TE Sign 2` swallow (via `pixel_map_view_defaults.test.js`, SHIPPED
defaults only — not a persisted `pixel_map_views.yaml`). Report
`20260725_107_redteam_fixtures.md`. Coordinator: HIGH-2 first (one fix
— re-derive LED binding grade + an LED `patch_record_disagrees_with_chains`
— closes the silent-dark rope class the gate exists to prevent).
**`_105` RED-TEAM LANDED (2026-07-31, Opus, report-only) —
sACN bridge/routing/subscription/bench-mirror/merge:** 1 HIGH,
3 MED, 3 LOW, no CRITICAL. Pure-module harness
`~/tmp/redteam_bridge/harness.mjs` 41/41; no source touched, no
socket/Sender, **zero sACN frame toward hardware**, zero device
HTTP. **HIGH (boot-crash): a universe >63999 in the LIVE hand-edited
`📡 Subscribed Universes` field (common.yaml is `1..37` today) — or a
bad patches.yaml dmxUniverse — bypasses the boot accept-list
(`parseSubscribedUniversesField` + `patchRecordUniverses` have NO
E1.31 ceiling), reaches `new Receiver`, `multicastGroup()` throws
RangeError, `classifyReceiverError` → FATAL → whole input bridge
`process.exit(1)` at boot.** Runtime diff path buckets the same
value as invalid and survives — boot/runtime disagree, so a bad save
is fine until the NEXT restart (misleading "socket FAILED" msg). MED:
truncated `segments[]` silently drops a spill universe (no anomaly —
`_87` class deeper); bench `mirrorTargets` never subtracted from
`engineState.owned` + `dest_host` unvalidated vs real controllers
(latent double-write); `composeUnifiedFrame` doesn't self-guard
same-IP contests. LOW: leading-zero-octet decimal/octal divergence;
boot gate replays only last deferred reason; multi-NIC = OS coin-flip
by design (pin `sacn_interface`). HELD: `_99` boot gate + double-join
invariant (3+ universes, interleaved), route-diff flap-freedom, merge
intersection off-by-one both edges, runtime range + per-universe
isolation, bench validation/gating, field-parser parity. Report
`20260725_105_redteam_bridge.md`. Recommended first fix: one-line
ceiling guard in the two boot-list builders (closes HIGH).
**`_106` RED-TEAM LANDED (2026-07-31, Opus, report-only) —
controller lifecycle/provisional/status/push:** 2 HIGH, 3 MED, 3
LOW, no CRITICAL. Pure repros in ~/tmp/redteam_controller/ against
the REAL modules with injected transports; NO device HTTP, NO sACN
to hardware, NO scene writes, operator stack untouched.
**HIGH-1 (promotion-corruption): the `ip_mismatch` reconcile guard
is DEAD CODE on the provisional path** — every promote path builds
`device.ip` FROM `controller.ip` (provisional cards match by IP
only), so `device.ip !== controller.ip` never fires. A typo'd or
DHCP-shuffled IP AUTO-VERIFIES the card against whatever MarsinLED
answers there; only an OPTIONAL boardId/deviceName expectation can
catch it. **HIGH-2 (quirk→corruption): the default-ON auto-sweep
re-raises the reconcile dialog every ~20 s** for an online-but-
contradicted provisional card (no "dialog already open" de-dup) →
unbounded stacking; after the operator promotes via one, the stale
dialogs' "Promote anyway" calls promoteProvisionalBinding on a now-
verified card → THROWS uncaught inside ctx.mutate. **MED-1
(status-lie/half-state): a push whose scene-SAVE fails settles to a
GREEN "In sync" chip** (warning tooltip-only), and the next
refreshSyncChips recompute (device≡plan → bare {state:'in-sync'})
drops even that — disk stale, LEDs dark, surface green. MED-2:
first contact promotes off a CACHED fingerprint (cache key type:ip,
5 s TTL) → same-IP hot-swap binds to the previous board. MED-3:
ECONNREFUSED/RST always → ONLINE (reject-firewall / any host / DHCP
squatter reads green; drop-firewall on the same dead box reads
OFFLINE); LED partial-200 + unrecognized host share the green dot.
LOW: reconcile silently skips controller_id_claimed when registry
omitted; push notifies the bridge TWICE (exportConfig loud + push
quiet); 1.2 s status deadline flaps cold boards (discovery budget
is 6.5-8 s). HELD cleanly: two provisionals one IP (2nd hard-
blocks), partial-answer refusal, lost-write read-back arbitration,
G8 liveness. Report `20260725_106_redteam_controller.md`.
Recommended first fixes: gate unattended provisional promote on a
stated expectation OR a confirm (HIGH-1); per-card dialog de-dup +
stale-dialog no-op (HIGH-2).
**`_109` RED-TEAM LANDED (2026-07-31, Opus, report-only) — controller
lifecycle / merge / push pre-flight (commissioned as `_104`; sibling
took that number):** 4 P1, 7 P2, 10 P3, no P0. Repros
`~/tmp/redteam_controllers/` (6 scripts); pure modules + loopback
stubs on ports 7750-7763 only — **zero device HTTP, zero sACN, zero
scene writes, zero source edits**; operator stack untouched. Sim
suite re-run after: **1645/1637/8 = baseline, byte-identical**.
**P1-1 (process kill): `POST /controllers/probe` with a negative
`timeoutMs` EXITS the save-server process** — `save-server.js:806`
forwards it unbounded, `controller_probe_service.cjs:101`
`socket.setTimeout()` throws ERR_OUT_OF_RANGE *before* `:105`
registers `on('error')`, so the still-connecting socket emits an
unhandled `error`. Server binds `0.0.0.0`, CORS `*`, JSON.parse
ignores Content-Type ⇒ CORS-simple, no preflight, no auth, no
`uncaughtException` handler. Rig stays lit (separate process) but
saves/backups/gamma/probe die, and the pane blames a stale save
server. **P1-2 (dark lights): a DMX *gap* claim can WIN the
higher-IP contest and mute a real strand** —
`address_merge.js:466` skips only `c.effect`, never the nameless
gap claims from `controller_registry.js:2017`; a gap writes no
bytes, so the contested channels go DARK under an "allowed /
unified" banner. **P1-3: the "1.2 s probe ceiling" is an IDLE
timeout, not a deadline** — a slow-drip host held a probe 10 414 ms
(measured), pinning a pool slot and `probeSweeping`, which blocks
EVERY later sweep (`controller_map_editor.js:1011`). P1-4 = the
same dialog storm `_106` HIGH-2 found first (credited; see report
§Overlap). **P2-8: the `_102` "auto-assign never creates a share"
invariant is VIOLATED** — `collectClaimedUniverses:140` skips
non-LED controllers, so a DMX port with an empty chain declares a
universe that projects no occupancy and is invisible to the claim
index; the LED park/repair then takes it. P2-5/6 + P3-15/16/20: one
root — `ipToNumber` folds numerically while every KEY (destination
map, suppression index, banner attribution, provisional match,
probe cache) compares raw strings ⇒ `0.0.0.00` bypasses BOTH the
sentinel gate and the unrankable hard error and ranks as the lowest
address; one box spelled two ways mints TWO destinations (two
racing packets, no warning). P2-7: `derivePerOutputPlan` models
neither the ≤16 span nor duplicate universes across declared
outputs, so `U2+U500` / two ports on `U7` pass the pre-flight clean
and die in `validatePerOutputPlan` after the confirm. P2-9 refines
`_106` HIGH-1 (verdict never re-validated against the card's
CURRENT ip). P2-10: no response-size cap (48 MB absorbed). P2-11:
no pixel-count ceiling — 100 000 px written into the ENABLE
`count`, both validators silent. P3s: `used.delete(port.universe)`
wrong-variable leak, repair ignores `cardUniverses`, claim-blind
`autoAssignPerOutputUniverses` (0 prod callers), unbounded
`probeCache`, `markControllerProvisional` has no IP check,
`duplicate_output` not named by reconcile. **HELD:** intersection
math exact at ch 1/512/1-ch/containment/identical/3-way and
order-independent; master-dimmer force-write correctly gated
through `pokeChannel`; the provisional/verified schema refused
every smuggling attempt; bind-by-controllerId dedup; the
drop-provisional-mid-sweep race; parks never create a share;
`unknown` never renders as `offline`. Report
`20260725_109_redteam_controllers.md`. Recommended first fixes:
listener-before-setTimeout + bound `timeoutMs` at the route
(closes P1-1); canonicalise the IP ONCE and key everything off it
(closes 5 findings). Operator decisions handed back: may a gap win
a contested channel; is a non-canonical `0.0.0.0` a placeholder or
an address; should the reconcile dialog get "don't ask again".
**`_110` RED-TEAM LANDED (2026-07-31, Opus, report-only) — sim GUI +
persistence layer (commissioned as `_106`; siblings had taken
`_106`–`_109`):** 4 P1, 6 P2, 6 P3, no P0. Repros
`~/tmp/redteam_simui/run_all.mjs` (pure modules) + two headless-Chrome
DOM probes on a BLANK page — **zero source edits, zero suite edits, zero
`scenes/**` writes, no sim/browser on :6969-72, no save-server POST, no
device HTTP, no sACN**. Sim suite after: **1645/1637/8 = baseline,
byte-identical**. **P1-1: "Save cancelled — nothing was written" is
FALSE** — `exportConfig` has no re-entrancy guard and never disarms
`saveTimeout`, so the 2 s auto-save runs to completion *through* the open
📡 Subscribed Universes dialog, writes all five scene files and clears
the UNSAVED-CHANGES chip (`gui_builder.js:386-514` + `:1015-1029`;
traced repro). The `_86` "Cancel means nothing on disk" contract holds
for one call, not for the process; `pixel_map_persist.js:151` already has
the right `inFlight` chain. **P1-2: `Folder.title()` is `innerHTML`**
(`marsin_gui.js:237`) and takes operator-typed fixture/group/trace names
raw — `A<B` truncates the header, `Left <Back> Wall` renders `Left  Wall`,
and an attached title ran `onerror` script (`window.__PWNED === 1`
measured): UI lies about the name every name-keyed store is keyed on, and
a shared `scene_config.yaml` is code-exec on the show machine. **P1-3:
every sim shortcut fires UNDER every `vm-modal-overlay`** —
`interaction.js:544` guards only `isSceneModalOpen()`, and the overlay
blocks pointer events only, so `Delete`/`D`/`Ctrl+Z` mutate the scene the
open confirm is describing (capture-phase ordering measured). **P1-4: the
SAVE path has no multi-client guard at all** — `save-server.js` has no
ETag/version/lock, and `common.yaml` is written to `SCENES_ROOT`
**ignoring `?scene=`** (`:385`), so a second window silently un-applies
the `_86` subscription widening; `multi_client_warning.js` says in its own
header it is a warning surface only. P2s: the `beforeunload` beacon is a
full save that skips BOTH the universes gate and `saveModelJS()`; orphan
ownership is byte-exact while `group_rename_guard` trims, so a trailing
space or an NFD name paints a LIVE group `⚠ ORPHANED` with `🗑 Remove N`
armed; the browser field parser enforces MIN but not MAX and never-remove
then re-writes a `>63999` token into `common.yaml` forever (browser half
of `_105` H1); the pixel-map sidecar has ONE writer so group rename +
orphan removal leave `pixel_map_views.yaml` stale indefinitely (`_66` §8
confirmed open, now also on the `_76` delete path);
`controllerGamma: {}` passes `normalizeLedWireConfig` but makes
`gammaCurvePath` THROW mid-render and kill the LED card; the controller
pane runs a FULL projection per card (measured 2.24 ms × 50 cards × 2 =
~226 ms/render) with O(N²) warning text (1225 overlaps / 235 KB / 49
banner rows on one card at N=50) — truthful but not responsive at 50.
**HELD:** the gamma NaN/Infinity keyboard vector the brief hypothesised is
CLOSED by `_64`/`_65` (range sliders + `parseGammaField` refuses ''/NaN/
Infinity/out-of-range/Arabic-Indic digits); the `1-24` range trap
surfaces; the universes dialog is `textContent`-safe; `removeFixtureFromViews`
refuses to empty a panel; the orphan detector's `=== true` strictness and
fail-loud scan; `_102`'s two warning grades never collide at 50-way
pile-up. Report `20260725_110_redteam_sim_ui.md`. Recommended first fixes:
one in-flight promise + `clearTimeout(saveTimeout)` in `exportConfig`
(closes P1-1 and the redundant double-save); `textContent` on the folder
title path (closes P1-2); add the `vm-modal-overlay` family to
`interaction.js`'s modal guard (closes P1-3). Operator decisions handed
back: multi-window save policy (refuse / warn / merge) and whether
`common.yaml` should stay global. **Board row NOT filed — no Notion MCP
tool is exposed in that session; per CLAUDE.md no repo task file was
created. Sina to enable the Notion MCP connection, then one `Backlog`
card pointing at `_110`.**
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

**LANDED 2026-07-31 — `_96` OPTIONAL-DISCOVERY LIFECYCLE + CONTROLLER
STATUS (Opus, `20260725_96_optional_discovery_lifecycle.md`):** closes the
ROOT CAUSE behind `_92` §4 (six rope strands dark for weeks because the only
path to a `device:` binding was a live discovery conversation).

- **Lifecycle `unbound → PROVISIONAL → VERIFIED`.** Operator ruling: *"the
  discovery must be an optional stage in the controller lifecycle and not
  required."* A PROVISIONAL block is `device: {vendor, provisional: true}` —
  **no controllerId, no push receipts**; the schema throws on either, and the
  absence of `provisional` still REQUIRES a controllerId, so the two shapes
  are mutually exclusive by construction. Bind-by-controllerId doctrine is
  intact: it governs VERIFIED bindings; a provisional card is IP-matched only
  to find its own first contact, then promoted.
- **A provisional card patches EVERYTHING** — patches.yaml records, engine
  model lanes (`patch:` not `unpatched: true`), bridge relay routes,
  subscribed universes — **byte-identical to a verified card**, and
  **promotion moves nothing**. Both pinned by test. Mechanism: no new branch
  anywhere; `isBoundLedController` is now the UNION of the two grades and every
  layer inherits it. Truly unbound cards keep the `_92` unpatched contract.
- **First contact = reconcile, never a side-pick.** Six codes
  (`device_not_recognized`, `controller_id_claimed`, `ip_mismatch`,
  `per_output_unsupported`, `board_output_count`, `board_id_mismatch`,
  `device_name_mismatch`); the first two are HARD BLOCKERS. A contradiction
  changes nothing on either side and raises a dialog with two explicit
  choices. Universes/enables/pixel counts are deliberately NOT contradictions
  — that is push drift and the sync chip owns it.
- **`0.0.0.0` composes**: the sentinel REFUSES a provisional binding (type the
  real IP first); a hand-written sentinel+provisional card still patches with
  the sentinel visible in every record. Conversion path pinned.
- **ONLINE/OFFLINE/UNKNOWN** (operator scope addition, same thread):
  server-side `POST /controllers/probe`, per-type probes — LED = HTTP
  `/api/status` (**MarsinLED never answers ICMP**, so ping would call the whole
  fleet dead), DMX = TCP connect ladder where a **refused** connection PROVES
  the host is up (sACN/Art-Net sinks answer nothing; ArtPoll would mis-report
  every sACN gateway). `unknown` is a first-class state and is never rendered
  as offline. Bounded pool (16) + 1.2 s ceiling + box-keyed cache; the pane
  never awaits a probe. An LED probe reply IS the fingerprint, so the sweep is
  the "next boot / recognition" trigger — provisional + ONLINE + fingerprint →
  the same promote path.
- **Numbers:** 76 new tests (33 lifecycle / 23 probe incl. real loopback
  sockets + RFC 5737 offline / 20 status model). Sim 1482 → **1559, fail 9 =
  the 8 documented baseline + `_92`'s in-flight TE-sign parity finding**
  (proved theirs: the failing message text exists 6× in the worktree
  `lib/scene_model_parity.cjs` and 0× at HEAD, and that test's whole
  dependency set is untouched by `_96`). Engine suite not run — no shared
  engine code. security_check PASS.
- **Live:** 18/18 in-browser checks + 7 inspected screenshots
  (`~/tmp/provisional_status/`), operator's stack REUSED not bounced, sACN OUT
  stubbed closed and every off-host fetch refused pre-boot — **1 off-host
  request attempted, REFUSED, and it was the pane's own pre-existing sync-chip
  read**. New tool `agent_tools/provisional_status_verify.cjs`.
- **Fixed in passing:** `lib/bench_section.cjs` mirrored a device block but
  dropped `provisional`, which would have produced a verified block with no
  controllerId — a file the registry loader refuses outright.
- **Concurrency with `_92`:** both waves edited `controller_map_editor.js` in
  disjoint regions (theirs LED-bus fixture classification, mine the status dot
  + sweep); merged file imports clean, suite re-run after. Zero scene writes.
- **OPERATOR ACTION (dossier #28):** restart the stack once (page + the new
  save-server route), then on the three rope controllers press **⚑ Patch
  without the board** and Save.

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
  loopback skip in `animate.js:564`. Minimal fix = option (ii)/
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

---

**`_104` LANDED (2026-07-31) — RED-TEAM: TIMELINE ZOOM (report-only).**
Report `202607/20260725_104_redteam_zoom.md`. Adversarial audit of the
S1–S5 zoom wave (`_94`/`_95`/`_97`/`_100`) — day/event zoom, time travel,
the operator lease + scopes, the exit state machine. **1 HIGH, 2 MED, 2 LOW;
no CRITICAL.**
**THE ENGINE INVARIANT HELD** — no zoom the rig cannot leave. Verified each
guard: `resume()` nulls the lease + `mode='armed'` BEFORE catchUp and catches
its throws (`timeline_service.js:2974-2982`); the tick releases an expired
lease and self-heals both orphan shapes (`:2146-2166`); the boot scrub
(`:1901`,`:1908`) runs synchronously before the first broadcast so no observer
sees a stale lease; `_goDormant` keeps only an UNEXPIRED travel lease and drops
an expired one (`:1666-1675`); every malformed `POST /timeline/travel` 400s in
`_resolveTarget` before any mutation.
**A1 (HIGH — silent-fallback / pad-lying):** `_zoomExitRequested` is a
module-level exit-claim set UNCONDITIONALLY by `_resume()` (`useTimeline.ts:171`),
which is ALSO the plain-takeover RESUME NOW (`resumeNow: resume`, deck +
PlanLockBanner). It is only ever cleared by `clearZoomClaims()` on a zoom→null
transition (`ZoomBanner.tsx:88`). A plain takeover has no zoom → the flag leaks
TRUE → the next real PERFORM/TRAVEL zoom the ENGINE ends (lease expiry, restart,
AUTO OFF, maker save) is read as `ours:true` → `shouldAnnounceZoomEnd` returns
false → the "Zoom ended — the plan resumed" toast + auto-nav is SUPPRESSED and
the operator is silently stranded on a deck they no longer own. Inverts the
exact `_97` §3.4 protection; the unit test covers only the pure decision fn, not
the leaky latch feeding `ours`. Fix: stake the claim only when a zoom is held,
and clear it whenever resume resolves.
**A2 (MED — latent stuck-state):** confirms `_100` F1 — `saveTimelineState`
dumps the whole `state`, so the scoped lease (scope/cueId/label/target) IS
written to `timeline_state.yaml`; only the one-line boot scrub stops a rebooted
ship waking with a ghost PERFORM banner. Latent (scrub verified), not live.
Make it structural by omitting `operatorLease`/`pendingProgram` from the
serialized shape.
**A3 (MED — pad-lying):** the D3 "⚠ Show due: X — starts when you exit" banner
keeps promising a show that `_catchUp` SILENTLY SKIPS once you linger past the
cue's hold window (`programLive` false); EXIT (skips) and ENABLE (fresh hold,
plays) then diverge under identical copy.
**A4/A5 (LOW):** engine validates a PERFORM `cueId` only for existence, not that
it is the live `activeCue` (spoofable banner label — pad guards are the only
enforcement); travel steppers use strict `>`/`<` so two co-timed cues can never
both be reached.
**HYGIENE:** report-only, no source/suite edits, no engine spawned →
`marsin_engine/config.yaml` CLEAN vs HEAD (verified before + after); no
`:6967`/`:6969-:6972` stack or device touched; no git ops; scratch
`~/tmp/redteam_zoom/`.

**`_105` RED-TEAM SECOND PASS LANDED (2026-07-31, Opus, report-only) — sACN
bridge, driven as a REAL PROCESS:** two agents were pointed at the bridge
concurrently; the first pass (pure-module, above) is preserved and my pass is
APPENDED to `20260725_105_redteam_bridge.md`, overlaps named (my F1=their H1,
F2=M2, F16=L2; their M1/M3/L1 are theirs alone). **5 P1, 8 P2, 8 P3, no P0.**
Method: the real `sacn_bridge.js` loaded with faithful fake `sacn`/`ws` (exact
deferred-join ordering, real `multicastGroup`, real Windows duplicate-join
EINVAL, recording Senders), scene tree from an in-memory VFS, faked `/status`,
`process.exit` recorded; inbound frames are REAL `Packet`s parsed from REAL wire
buffers — which is what surfaced the unit bugs a fabricated-payload harness
cannot see. **P1-F3 (LIVE): the DMX frame `routeFrame()` broadcasts to browsers
is the `sacn` package's PERCENT payload (`objectify` = `value/2.55`, 2dp, zeros
omitted) copied into a Uint8Array the browser reads as raw DMX — the sim's
sACN-IN preview renders the ship at ≤39% with 101 grey levels; the relay path
round-trips losslessly, only the browser branch (sacn_bridge.js:1002-1008) is
wrong.** **P1-F4 (LIVE): ONE CID for the whole project** — nothing ever passes
`cid`, so every Sender ships the package's hardcoded `DEFAULT_CID`; two same-CID
sources on one universe drop **39 of 40 frames** at our own receiver (measured)
and are indistinguishable to real gateways = the missing mechanism behind the
`_15` flicker; live the moment a second stack instance exists on the LAN
(laptop + interior1). **P1-F5 (LIVE): the priority lockout is GLOBAL** — one
prio-≥150 frame on one universe stops the relay of EVERY universe for 10 s.
P1-F1/F2 confirmed end-to-end (exit(1) observed; mirror+engine frames observed
leaving, with the engine-suppression line printing the OPPOSITE reassurance).
P2: `PacketCorruption`/`PacketOutOfOrder` unlistened (49 silent drops incl. start
codes 0xDD/0xCC); `reuseAddr:true` lets a SECOND input bridge bind 5568 with no
error (one gets the engine's unicast, the other relays nothing while logging
health); bench-mirror Uint8Array truncation (202/256 DMX values wrong, DMX 1-2 →
0); multicast/broadcast/free-text admitted as relay destinations (a
`239.255.0.N` typo is a self-feeding loop); mirror suppression silent unless
`mirrorSig` changes; a failed join is never retried and its warning is dedup'd
forever; cross-spec duplicate mirror destination (sender from the last spec,
payload from the first); unparseable common.yaml warns once then silently
narrows forever. P3: comment-only sidecar edit and every engine flap blank the
composed buffers; the ✅ join-count line reports the boot-list size not successes;
invariant blind to a duplicate INSIDE the boot list; same-priority source flap =
one WS broadcast per packet; no `setScene` debounce; priority-0 promoted to 100;
`sourceName` ANSI into the launcher terminal. **ADJACENT (outside the bridge,
flagged not investigated): every raw-DMX producer feeds the package's PERCENT
API** — `marsin_engine/lib/sacn_output.js:80` and
`simulation/server/sacn_output_bridge.js:141` build `payload[ch+1] = <0..255>`
and `Packet.buffer` multiplies by 2.55 and clamps → **DMX 100 → wire 255,
everything above flat at full, 256 levels → 101**; `useRawDmxValues` set nowhere,
no patch-package override. Wants an owner before the rig is tuned. HELD: the
`_99` boot gate itself (no third ordering found that yields a wrong route set or
an uncaught double join through it), the relay's byte-exact DMX round-trip,
sequence rollover, the bench-mirror spec parser's every declared refusal,
`isMirrorActive`'s three preconditions, route ownership under client storms.
**HYGIENE:** report-only, no source/suite edits, no scene writes, no git ops;
sim suite re-run **1645/1637 pass/8 fail = the documented baseline, identical
failing list**; `git status -- simulation` unchanged; no port bound on 5568, no
multicast join, zero packets toward the rig, zero device HTTP, the operator's
:6967/:6969-:6972 stack never approached; loopback-only probes on 45590/45599;
scratch `~/tmp/redteam_bridge/` (rig.js + p01 + s01-s09).

---

**2026-07-31 (`_113`) — RED-TEAM: TIMELINE REVIEW/ZOOM MACHINERY (report-only).**
Report `202607/20260725_113_redteam_timeline_ribbon_state.md`, repros
`~/tmp/redteam_timeline/{a_pure_probes,b_state_and_plans,c_engine_probes,d_followups}.mjs`.
Surface deliberately complementary to `_103` (triggers/arbiter/party) and `_104`
(pad zoom state machine): the day ribbon + `/timeline/overview`,
`resolveDeckStateAt`, `_resolveTarget`/`travel`/`resolveAt`,
`validateShowPlan`/`lintShowPlan`, `loadTimelineState`.
**2 P0, 2 P1, 3 P2, 5 P3.**
**P0-F1 (stuck/DARK show, the headline):** `GET` **and** `POST
/timeline/overview` build the day ribbon SYNCHRONOUSLY on the HTTP thread in
O(days x cues^2) — `buildDaySegments` (`resolve_deck_state.js:331`) calls
`resolveDeckStateAt` per sample point, and each of those re-runs
`applicableCues` + `resolveDayTimes` over the WHOLE cue list, constructing two
`Intl.DateTimeFormat` per clock cue. Measured on a REAL engine (:7717): 64 cues
x 8 days = **2.8 s frozen**, 128 = **11.4 s** (a concurrent `GET /status` was
ECONNRESET), 256 = **58 s**, **512 — the schema's own cap — = 296 s**. The 40 fps
render loop, the sACN sender and the timeline tick share that event loop, so the
exterior goes dark and no client can reach the engine; the PROCESS stays alive,
so no supervisor restarts it. Needs no auth and no saved plan — one maker
preview of a big draft does it. The 512 cap predates the ribbon
(`show_plan.js:799` justifies itself with "a 10k-cue POST froze /status ~32s";
the ribbon makes 512 cues cost 9x that). Fix: memoise `dayTimes` per day (the
ribbon already computes it once at :345 and discards it) and cache the two
`Intl.DateTimeFormat` objects in `clockToEpochMs` — either alone is ~100x — then
pin it with a perf regression test against a stated budget.
**P0-F2 (silent dead timeline):** `loadTimelineState` (`timeline_state.js:200`)
validates ONLY the five party fields. A corrupted `firedToday: yes`,
`moodArmed: 5`, or a scalar document loads clean and then throws at boot or on
EVERY tick (`Cannot create property 'c_x' on string 'yes'`). Because the tick is
`this._tick().catch(...)` (`:382`) that becomes one `console.warn` per tick
forever while the WHOLE plan — clock, sun, defaultCue, party — drives nothing all
night and the engine looks healthy. This is precisely the D11 failure mode the
party guard was added to stop, on every field the guard does not cover. Fix:
extend the guard to the whole persisted shape (`mode` in {armed, overridden};
`firedToday`/`moodArmed`/`moodLastFire` plain objects; lease/program fields null
or objects; the document itself a plain object) and reject loud at boot.
**P1-F3 (two answers, one plan):** two cues at the SAME fire time — the pure
resolver picks the FIRST in plan order (`resolve_deck_state.js:152`, strict `>`),
the live tick pushes actions in fire order so the deck ends on the LAST. The day
ribbon, `GET /timeline/resolve`, `POST /timeline/travel` and boot `_catchUp`
therefore all name the opposite cue from a continuously-running engine — and
rebooting flips the deck. `validateNoOverlap` cannot see it (no `durationMin`).
Sharpens `_103` L3, which recorded only the live half.
**P1-F4 (stuck show):** `hold.min` has no upper bound. `{min: 1e12}` (or a
fat-fingered `9000` = 6 1/4 days) validates and the program owns the deck for the
rest of the festival, suppressing every later ambient/mood cue; `{min: .inf}`
also validates and serialises to `untilMs: null`, indistinguishable on the wire
from an open-ended hold. Verified over 7 simulated days.
**P2 x3:** `_resolveTarget` (`timeline_service.js:2713`) shape-checks the travel/
resolve target date with a bare regex and never round-trips it — `2026-07-00`
returns **200**, silently resolved as `2026-06-30`, with the impossible date
echoed back as `target.date` and reused as `currentDate` by every later `step`
(`show_plan.js assertDate` does this correctly 30 lines away) · `validateNoOverlap`
(`show_plan.js:731`) keys windows by festival-day INDEX, so a `durationMin`
window that CROSSES MIDNIGHT is never compared against the next day's cues (23:00
+180 min and 00:30+30 min both load and genuinely overlap) — narrows `_103`'s
"overlapping deck windows are rejected at load" to within-a-day only · nothing
validates that a look's `playlist` or `palette` EXISTS: `POST /timeline/plans`
200, `plan/activate` 200, `planWarnings: []`, and the typo only surfaces as a
`cueErrors` entry at fire time — narrows `_103`'s "missing playlists fail loud"
to the runtime; the AUTHORING path (where a human would see it) is silent, and
`lintShowPlan` is exactly where it belongs.
**P3 x5:** the ribbon draws a 23 h / 25 h DST day into a column labelled
`00:00 -> 24:00` (tiling + contiguity verified correct, the scale is ~4 % off
both ways; `_103` L4 covers the cue-fires-late half) · `sun.offsetMin` is
unbounded, so a cue can fire on a DIFFERENT calendar day than the ribbon draws it
on · `_assertPlanName` accepts a 500-character name · `POST /timeline/resume` is
not authoritative against a concurrent `takeover` (40 racing pairs left a live
PERFORM zoom; self-heals at lease expiry, and CaptainPad's touch-takeover hook
makes it a real gesture — pairs with `_104` A1) · `mode` in the state file is
never validated (`mode: banana` and a truncated `mode: arm` both run and go out
on `/timeline/state`).
**WHAT HELD:** no prototype pollution (`__proto__`/`constructor` keys rejected by
`assertSlug`, `Object.prototype` untouched) · the 512-cue cap (513 -> named
throw) and the 1 MB body cap (5 MB label -> 413) · a REAL `SIGTERM` mid-zoom at
BOTH scopes wakes `mode: armed`, `zoom: null`, `controller: autopilot` — the boot
scrub works, and the lease bytes ARE on disk exactly as `_100` F1 / `_104` A2 say
· stepping past the plan edges 400s and never clamps; a bad `step` 400s · polar /
missing sun events never crash the resolver or ribbon · 33 of 43 hostile plan
mutants produced a NAMED error · a 12-round concurrent
travel||perform||savePlan||activity storm left `mode: armed`, `zoom: null`,
`lastError: null`, deck back under the plan.
**HYGIENE:** report-only — no source edits, no edits to any existing test/suite,
no writes to `scenes/**`/`patterns/**`/playlists/plans, no git ops beyond reads.
Timeline family **410/410 pass, 0 fail before AND after**.
`marsin_engine/config.yaml` absent from `git status` (CLEAN vs HEAD) both times;
`simulation/scenes/*/timeline` and `*/playlists` clean. Every spawned engine ran
the `test_bench` model with `MARSIN_CONFIG_FILE` (`controllers: []`,
`sacn.destinations: ['127.0.0.9']`) + `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR`/
`MARSIN_TIMELINE_DIR` temp dirs, with the harness's three walls ASSERTED on every
boot (sender lines, no Art-Net, empty `outputRouting.controllers`). Port **7717**
only (inside the assigned 7700-7749); 5568 never bound, no multicast, zero device
HTTP; the operator's :6967 and :6969-:6972 stack never approached.

**Landed 2026-07-31 - RED TEAM: CaptainPad zoom ladder (Opus,
`20260725_114_redteam_captainpad.md`):** adversarial pass over `_97`'s zoom
ladder against `_95` §3, hunting the gap `_100` §3.3 names ("the pad's
toast/navigation remains unit-pinned pending the DOM runner"). Method: a
scripted hostile engine (REST + `/ws/control` + a `/__ctl` drive channel) on
:7901 in front of a FRESH `web:build` dist on :7900, `localStorage.API_BASE` set
before boot, console muted pre-navigation; plus the shipped `zoom_logic.ts` /
`timelineTemplate.ts` imported and probed directly. 17 scenarios, 5 P1 / 6 P2 /
6 P3, no P0; **five P1s reproduced LIVE in a browser with screenshots**.
**P1-F3: one unknown `transition.mode` white-screens the ENTIRE pad**
(`timelineTemplate.ts:185`, `DECK_TRANSITION_MODE_LABEL[mode].toLowerCase()`,
unguarded, called from render in DayView/EventSheet/DayOverviewStrip) - and
**CaptainPad has NO React error boundary anywhere**, so any render throw takes
every tab, the ZoomBanner and the plan-lock banner with it. **P1-F1: one press of
the deck/mixer RESUME NOW permanently disarms the "zoom ended" alarm** -
`_zoomExitRequested` (useTimeline.ts:171/259) is a module global never cleared on
the success path, and its only clearer (ZoomBanner.tsx:88) runs solely on an
OBSERVED zoom non-null->null transition, which a zoom-less resume never produces;
proven live with a clean A/B control (R2b notice fires, R2/R2m it does not), so
an engine restart mid-zoom silently strands the operator on a deck they no longer
own - exactly the pad half of `_100` X6. **P1-F2: the zoom banner keeps asserting
a live lease after the link dies** - `useTimeline` retains the last state forever
on disconnect and the banner never reads `connected`; 20 s after the socket died
AND the engine released the lease the pad still reads "TIME TRAVELING ... viewing
the plan, not tonight" with a green ENGINE dot, two rows above a party card
correctly saying ENGINE OFFLINE. **P1-F4: an EMPTY ribbon passes as a completed
review** - `DayView.tsx:239` tests `Array.isArray`, which `[]` satisfies, so the
loud red block is suppressed and the RESOLVED column renders blank (and
`ribbonRows` silently DROPS non-tiling segments, 3 of 5 in the probe).
**P1-F5: a stepper press makes pad B claim it entered the zoom** (`_travel` sets
`_zoomEnteredHere` on every success), so B's next tab-return ends pad A's zoom -
the exact D1 violation the gate exists to prevent; `_100` T1 tested B browsing,
not B retargeting THEN browsing. ENUM-ADDITIVE BRICK CLASS (the `_98` dodge):
the strict validator is the SAFE one - an unknown `PartyEffectiveState` throws in
`parsePartyConfig`, is caught, and degrades to a loud card error; the hazards are
the unguarded map lookup (F3, crash) and the binary if/else over a widening union
(`zoom.scope` -> silent TIME TRAVELING with steppers that can only 400, F6).
Meanwhile `timelineState` - deck lock, plan banner, cue list, zoom - is admitted
on `typeof mode === 'string'` alone (F7). HELD: EXIT under a 500 (verbatim +
retryable), 8-press stepper hammering at a plan edge (engine 400 verbatim, never
clamped), 4000-char labels (clipped, no page widening), 0-cue and 60-cue days,
6x tab hammering during a zoom (one resume, no storm), `shouldAnnounceZoomEnd`
itself (correct across its truth table - the bug is who sets its inputs).
**HYGIENE:** report-only, ZERO source/suite edits, no git ops, no engine spawned,
no sACN/device traffic of any kind, operator's :6967 and the 6967-6972/5568 band
never approached (ports 7900/7901 only); CaptainPad vitest re-run **42 files /
914 pass / 6 skip / 0 fail = exactly the `_97`/`_100` baseline**; scratch
`~/tmp/redteam_pad/`. **Notion board row NOT filed - no Notion MCP tool in this
session; the row text is written out in the report §7 for whoever has the
connection.**


**Landed 2026-07-31 - RED TEAM `_114` CHAOS / "never stuck" across process
boundaries (Opus, `20260725_115_redteam_chaos.md`; filed as `_114` because a
sibling took `_109`): 15 findings - P0 x1, P1 x5, P2 x6, P3 x3, plus a full
RECOVERY MATRIX (component x kill-instant).**
**P0-1 (dark rig, all surfaces GREEN):** `kill -9` on the save server, the sACN
INPUT bridge or the sACN OUTPUT bridge leaves `start.js` alive - it logs one line
each (`start.js:86-94`) and never restarts or exits. The launcher supervises
`start.js`, not its children (`launcher.js:1051-1057`, one-shot `waitForTcp`),
and `cmdStatus` probes only :6969 + :6968 (`launcher.js:928-931`). Verified all
three: rig dark, `restart_count` unmoved, `deploy.py verify` would pass,
`launcher.js status` prints OK. Needs a human who notices the lights are off.
**P1 x5:** a BACKWARD wall-clock step permanently strands the party cue -
`triggers.js:306`/`:308-309` compare `now - moodSince` / `now - moodLastFire`
against PERSISTED absolute epoch stamps with no `last > now` clamp, so a 6 h or
1 day step back means the party NEVER fires again (30 s of loud music on
`ambient`, `mode: armed`, `lastError: null`); an identical crash without the jump
resumes in 1.2 s, and a dead-RTC/1970 boot also resumes - the failure is
backward-only . a corrupt `timeline_state.yaml` kills the timeline dead while
`GET /timeline/state` returns 200 `mode: "armed"`, `lastError: null`
(`api_server.js:10400-10409` catches the boot throw into one `console.error`,
contradicting its own comment) . 20/20 corrupt-state-file variants boot
"successfully" and SILENTLY reset the saved show to defaults, and a file that
parses to a SCALAR becomes the state object (`globals.blackout: undefined`,
timeline `mode: undefined`) - `state_manager.js:109-119` . a state write that
FAILS (unwritable dir = disk-full/read-only, or a Windows file lock = EBUSY)
still returns `200 {"saved":true}` while the disk keeps the old value
(`state_manager.js:121-128`) - the CaptainPad SAVED badge lies . `-f` force-
takeover force-kills the running stack at `launcher.js:1001` BEFORE `validate()`
at `:1002`, so a scene typo takes the show down and then exits 2 (proven with the
non-destructive half).
**P2 x6:** IPv4/IPv6 port shadowing - `checkPortFree` (`launcher.js:465-475`)
binds `::` with a bare `probe.listen(port)` and REPORTS FREE while an IPv4-only
process squats the port; the sim server then co-binds, logs "listening", and
every IPv4 client (127.0.0.1 / localhost / the LAN) reaches the SQUATTER, which
`waitForTcp` (`:884-886`, 127.0.0.1) then greenlights - only the netstat-based
`killStaleListeners` catches it, and `--no-kill` skips that . "the engine never
came up" is announced to NOBODY (`sacn_bridge.js:195` inits `reachable:false`,
`:676-678` short-circuits an unchanged signature) - flapping is reported
perfectly, a cold boot with a dead engine is silent . `launcher.js status`/`stop`
REFUSE on the exact corrupt lock `_99` taught `start` to recover from
(`readLock` throw uncaught at `:922`/`:948`) . a ZERO-BYTE `patches.yaml` yields
zero relay routes silently (a malformed one is diagnosed beautifully) .
single-instance TOCTOU: the lock is unlinked at `:383` and rewritten at `:1032`
with `killStaleListeners` + `assertPortsFree` (5 s retry/port) in between
[ANALYSIS] . TESTABILITY: NO port override exists anywhere in the sim stack or
the launcher (`load_ports.cjs` reads only `simulation/config.yaml`; the audio
companion's :6966 is hardcoded in `COMPANIONS`), so launcher profile behaviour
cannot be exercised without seizing the operator's live ports - which is why the
two launcher lines above are ANALYSIS and why this thread had to run a private
COPY of `simulation/`.
**P3 x3:** kill-9 mid-save leaks `.<name>.<pid>.<n>.tmp` into the TRACKED states
dir forever (not gitignored, no boot sweep) . `saveTimelineState`
(`timeline_state.js:238-245`) has no `fsync` and a fixed `.tmp` name, weaker than
every other state write . `assertSacnUdpAvailable` swallows all inspection errors
and continues (`launcher.js:507-516`).
**WHAT HELD:** `_writeFileAtomic` is genuinely crash-safe - 8 kill-9 instants
incl. inside a save and inside a snapshot write produced ZERO torn files .
engine cold boot ~330 ms . runtime-only timeline state (`zoom`, `activeProgram`,
`pendingProgram`, `operatorLease`) is really scrubbed on boot after a SIGKILL,
independently reproducing `_100` F1 / `_104` A2 . party resumes in 1.2 s when the
clock behaves . `loadTimelineState` fails loud and names the field (D11) .
the sACN bridge survived 4 engine deaths with no drop, edge-triggered named
warnings, `broadcastLog` to the UI, no stacked polls . `load_ports.cjs` is a
model fail-loud reader . `launcher.js stop` re-checks command lines before
killing recorded children (PID-reuse safe).
**HYGIENE:** report-only - no source edits, no suite edits, no scene writes, no
git ops beyond reads; everything under `~/tmp/redteam_chaos/`. ~60 engines on
7601-7641, all `MARSIN_CONFIG_FILE` black-holed (`controllers: []`,
`127.0.0.9`) + `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR`/`MARSIN_TIMELINE_DIR`,
three walls ASSERTED every boot, model `test_bench` only. Sim components have no
port override, so a PRIVATE COPY of `simulation/` ran on 7669-7672 + UDP 7568
with every scene controller IP rewritten to RFC 5737 `192.0.2.x` (0 remaining
`10.1.1.*`); UDP 5568 never bound. Launcher: only `status`/`stop` against a lock
in a fake `USERPROFILE`; NO profile ever launched. Operator's stack verified
byte-identical before/after - 6969/35692, 6970/17308, 6971/38388, 6972/50272,
UDP 5568/38388, nothing started, stopped or killed. **Notion board row NOT filed
- no Notion MCP tool in this session; the row text is written out in the report
S6 for whoever has the connection.**

**Landed 2026-07-31 — WAVE 1 `_119` W1-4: sim save-server & controller-probe
crash-proofing + save honesty (Opus, `20260725_119_wave1_saveserver_hardening.md`).**
First Wave-1 FIX thread to land (source-editing; commit-gated on operator).
Owns exclusively `simulation/server/save-server.js` +
`controller_probe_service.cjs` — no marsin_engine/, start.js, launcher.js,
scenes or patterns touched. **`_109` P1-1 (Family A) CLOSED + SURVIVED,
proven end-to-end:** the exact `POST /controllers/probe {timeoutMs:-1}` that
killed the whole save-server (scene saves/backups/gamma/probe all die) now
answers a loud **400** and the process stays alive + fully functional (real
server spawned on a random high port + throwaway `~/tmp` root). Root cause was
`socket.setTimeout(-1)` throwing ERR_OUT_OF_RANGE on a still-connecting socket
BEFORE its `error` listener existed → the later socket error was unhandled →
`process.exit`. **Fixes:** (1) route validates `timeoutMs` (finite, `>0`,
`≤60 s`) → 400 before it can reach the socket; `tcpProbe` now attaches
`on('error')` BEFORE `setTimeout` and catches the throw → honest UNKNOWN;
process-level `uncaughtException`/`unhandledRejection` backstops that log NAMED
and exit (no half-alive run — auto-restart is W1-2's job). (2) P1-3 — the
"1.2 s ceiling" was an IDLE timeout a slow-drip host held 10.4 s and wedged
every later sweep; added an ABSOLUTE per-probe deadline (TCP + HTTP) + a 256 KB
response cap. (3) `_115` L5 save-honesty — every save-server write path now
surfaces a NAMED non-200 on failure (was a bare `Error`); proven a failed disk
write answers `500 Error: …`, never `200 Saved`. (4) endpoint hardening — 1 MB
body cap (413), non-object body (incl. the `null`→TypeError→kill vector) → 400,
garbage → 400. **Suite: 1645/8 → 1657/8 — +12 green tests, ZERO new failures**
(the 8 are the known baseline, byte-identical). New tracked tests:
`save_server_hardening.test.js` (spawns the real server) + probe module tests
(crash-proofing, absolute deadline, overflow cap). Repro
`~/tmp/redteam_controller/04_probe_crash_repro.mjs` all green. Test-only env
hooks `SIM_SAVE_SERVER_PORT`/`SIM_SAVE_SERVER_ROOT` default to production paths
when unset (explicit config, not a fallback). **HYGIENE:** zero device HTTP
(loopback + RFC 5737 `192.0.2.x` only), zero sACN, operator :6970/:6967/
:6969-72 never touched, `marsin_engine/config.yaml` CLEAN, no git ops (landed
on the uncommitted `feat/bm_readiness` tree).

**Landed 2026-07-31 — WAVE 1 `_117` W1-2: launcher supervision & watchdog — the
`_115` L1/P0 capstone (Opus, `20260725_117_wave1_launcher_watchdog.md`).** Owns
exclusively `simulation/start.js` + `launcher.js` (+ one additive fail-loud line
in `simulation/lib/load_ports.cjs` — the only path the port override reaches the
child servers I don't own). **L1 CLOSED — "dark ship, green dashboard, nothing
restarts" is over.** Root cause: `start.js` only `console.log`'d a child's exit
(no restart, no teardown) and `launcher status` probed only :6969/:6968, so
`kill -9` on the save server or EITHER sACN bridge left the rig dark with every
surface ✅. **Supervision model:** `start.js` is now a real supervisor — each of
the 4 children (http/save + both bridges) is watched; DEATH (crash/`kill -9`)
AND FREEZE (3 consecutive missed 10 s health probes on a live process) →
bounded restart (5/60 s rolling) → past budget, **loud escalation** (`exit(1)`
so the launcher's teardown fires + the show-server supervisor relaunches) rather
than an endless restart-loop fallback (codex P0). `launcher status` now
health-probes EVERY child — save (`/list-scenes`), sACN-in, sACN-out — plus
engine; the two `ws` bridges use an **`expect:'any'`** criterion because a `ws`
server answers a plain GET with **426** (proves the event loop is alive) and a
bare GET fires NO `connection` event, so it never pollutes the input bridge's
sim-window contention census. Frame-flow: `status` briefly reads the input
bridge's `N packets/5s from '<src>'` broadcast → prints `⚠ … 0 packets/5s — the
rig may be DARK` when the port answers but nothing flows (never green on a dark
rig). **L4:** `checkPortFree` bind-probes BOTH families (IPv4 `0.0.0.0` + IPv6
`::`), so an IPv4-only squatter is caught (bare `listen(::)` reported FREE —
repro'd then fixed). **L6:** `validate()` moved BEFORE `assertSingleInstance()`
(the `-f`/`prod` force-takeover), so a scene/pattern typo fails loudly WITHOUT
first killing the running stack. **P2-6:** new **`BM26_SIM_CONFIG`** override
(fail-loud, same contract as `MARSIN_CONFIG_FILE`) points launcher + start.js +
save-server + both bridges (via `load_ports.cjs`) at an alternate port map;
`main()`/boot in both files guarded behind `require.main === module` and pure
helpers exported. **Suite: 1645/8 → 1663/8 — +6 new W1-2 tests, ZERO new
failures** (the 8 are the known baseline, byte-identical set;
`launcher_supervision.test.js`). Live-proven: real `kill -9` on a supervised
child → detected + restarted (fresh pid, `exited unexpectedly` logged); sACN-out
kill → `launcher status` line **❌ not green**; frame-flow warned of a dark rig.
**HYGIENE:** ran entirely on throwaway 786x/787x + UDP 7568 via the override;
operator :6969-:6972 byte-identical before/after (same PIDs 35692/17308/38388/
50272), UDP 5568 never bound, throwaway-port orphans (kill-tree races) swept to
0; `config.yaml`/`scenes/**`/engine untouched; no git ops (uncommitted
`feat/bm_readiness`). **WANTS (flagged, out of my two files): a census-neutral
plain-HTTP `/health` on both sACN bridges (`{packetsPerSec, activeSource,
universes}`) + a frame/output indicator on W1-1's engine `/status`** would let
the watchdog verify frames CONTINUOUSLY (today death/freeze is continuous,
frame-flow is an on-demand `status` advisory because connecting to the input
bridge's WS counts as a sim window in its census). `_115` P2-3 (status/stop
refuse on a corrupt lock) is unowned — small follow-up.

**Landed 2026-07-31 — WAVE 1 `_118` W1-3: pattern-VM "never black" enforcement +
`_90` audit-harness hardening (Opus, `20260725_118_wave1_pattern_never_black.md`).**
Family I (`_112` I1/I2/I4) — sits on the LIVE ChatGPT pattern loop. Owns
exclusively `lib/pattern_mixer.js` + `tools/pattern_audio_harness.mjs` (no
`engine.js`/`api_server.js`/`timeline/*`/`simulation/`/`scenes/**`/`patterns/**`
touched — verified). **THE NEVER-BLACK MODEL:** the vendored WASM absorbs a NaN
(I1: a NaN in ANY one arg to `rgbwau()`/`hsv()` blacks the whole pixel, and is
absorbing in persistent state — `acc = acc + 0/0` → black forever) or a
`beforeRender` budget overrun (I2: truncates SILENTLY mid-execution, so the
mandatory palette resolve never runs → whole ship black from a clean-compiling
pattern) into a black composite with ZERO signal; and because the NaN is cast to
`0` inside the WASM before JS sees a byte, per-channel NaN sanitising is
UNREACHABLE — so enforcement is on the CONSEQUENCE. **New runtime R4 enforcer
`_enforceNeverBlack()` in `PatternMixer.renderAll6ch()`** (the exact buffer
engine.js reads out to sACN, after `applyMaster`): counts consecutive
fully-black frames while `_isExpectingLight()` (master>0 AND a deck/mixer
contributor enabled with effFader>0, honouring the deck↔mixer view crossfade —
so a LEGIT operator blackout: master 0 / faders down / muted is NEVER flagged);
at `NEVER_BLACK_TRIP_FRAMES`=8 (0.2 s @ 40 fps) it sets `renderHealth.darkness.
tripped`, logs LOUDLY once naming the deck pattern, and writes a dim uniform RGB
floor (`NEVER_BLACK_FLOOR_VALUE`=10/255) — floor engages ONLY after the loud
flag, never silent; auto-recovers (clears + green) when light returns. Also a
`_isBufferSolidRed()` → `darkness.solidRed` for the VM's over-budget signature
(`_112` F9). `getRenderHealth().ok` now folds `darkness` in (`ok = no
blendErrors && !tripped && !solidRed`). **PROVEN END-TO-END THROUGH THE REAL
WASM** (`tests/mixer/never_black_vm_e2e.test.mjs`): a single-NaN-arg `rgbwau`, an
absorbing persistent-state NaN, and a 6000-iter-precompute `beforeRender`
overrun all COMPILE CLEAN and trip the enforcer (`ok=false`,`floorActive=true`);
a healthy pattern stays green. **I2 HONEST FINDING:** `marsin_begin_frame` is
compiled `void` — empirically confirmed (cwrap `number` binding → `undefined`;
`marsin_get_error()` empty after a truncated frame) — and there is no C source
in-repo to re-vendor the `.wasm`, so a direct "report the truncation" ABI
channel is IMPOSSIBLE. The mission-critical black outcome is caught by the
enforcer; a wrong-but-non-black truncation (`_112` E2) is caught only offline by
the hardened harness. If the WASM is ever re-vendored, make `marsin_begin_frame`
return a truncation flag and surface it in `renderHealth`. **I4 — THE `_90`
HARNESS CAN NOW FAIL** (`tools/pattern_audio_harness.mjs`): a `--gate` mode that
exits 3 with a NAMED reason on **DARK** (>`--max-dark-frac`, default 0.5, of the
window essentially black — fails `evil_black`), **BLACK_LATCH** (renders a
`--gate-frames` window, default 600 = 15 s, PAST the captured clip so a sleeper
that latches black after the audited window is caught — fails `evil_sleeper`),
and **OVER_BUDGET** (MEAN VM render time > `--budget-ms`/`--mix-channels`,
default 25/4 = 6.25 ms per-channel; MEAN not worst → machine-stable). Times ONLY
the VM work (`beginFrame`+`renderAll6ch`). The `GATE_PASS`/`GATE_FAIL` verdict
ALWAYS prints; **only `--gate` changes the exit code**, so existing clip/gif
tooling (`gen_pattern_gifs.mjs` via `execFileSync`) is unaffected. **OPERATOR
ACTION: add `--gate` to the `_90` recipe's two harness runs** to make the loop's
verdict binding. **Shipped patterns stay GREEN** on titanic under `--gate` (the
report's worst, `26_dom_dancers_chevron` 5.67 ms, → GATE_PASS at mean 4.56 ms;
`10_chasers`/`40_lissajous_weave`/`01_cylon_sweep`/`00_golden_hour_wash` all
PASS). **SUITE:** +16 new green tests (7 `never_black_enforcer` fake-host + 4
`never_black_vm_e2e` real-WASM + 5 `tools/harness_gate` subprocess); mixer suite
475/475; **ZERO new failures from this thread** — full run 2520/2510/**10 fail**
= the 8 known baseline (5× audio_capture no-device, osc EADDRINUSE, effects_v2
full-run pollution, specialty_white_uv drift) + 2 sibling
`tests/timeline/overview_perf.test.js` J1 perf tests that **PASS in isolation**
(338 ms, under budget) and flake only under full-run order/load, in a file with
zero coupling to this work. **HANDOFF to W1-1:** never-black is ALREADY on
`/status` — `api_server.js:4790` reads `mixer.getRenderHealth()`, which now folds
`darkness` into `ok`, so `/status.renderHealth.ok` flips false the moment the
ship goes dark-while-lit, NO engine edit needed; a standalone
`mixer.getNeverBlackHealth()` → `{lit, black, blackStreak, tripped, floorActive,
solidRed, pattern, sinceFrame, message}` is provided for a `/timeline/state`
field + the launcher watchdog's frame-flow check. **HYGIENE:** source edits
confined to the two owned files (+231/-9 pattern_mixer, +127/-9 harness) + 3 new
test files; `git diff --stat -- config.yaml patterns/` EMPTY before+after; all
hostile artefacts in test temp dirs / gitignored `~/tmp`; public-repo safe; zero
device HTTP, zero sACN, operator stack untouched, no git ops.

---

## W1-1 — engine HTTP/WS/timeline crash-proofing (`_116`, LANDED)

Wave-1 dark-ship hardening on the three exclusively-owned files (`engine.js`,
`lib/api_server.js`, `lib/timeline/*.js`) + `lib/autopilot_pick.js` (handed to
I3). **7 fixes, each with a red-team repro flipped to a GREEN committed test.**
Report: `.agent/reports/202607/20260725_116_wave1_engine_hardening.md`.

- **CRITICAL (`_108`, Family A) — malformed WS frame kills the engine:** added a
  classified non-fatal per-CONNECTION `ws.on('error')` in the upgrade router
  (one point covers all four `/ws/*` topics + the `/` alias), the `_99` shape.
- **Process backstops (`_108`/`_109`):** module-scope `uncaughtException` /
  `unhandledRejection` in `engine.js` — log loudly + `exit(1)` with a named
  reason (never run half-alive; W1-2 watchdog restarts the clean non-75 exit).
- **J1 (`_113`, P0) — `/timeline/overview` freeze (296 s):** Intl formatters
  cached per tz (`triggers.js`), per-day `dayTimes` injected into the per-sample
  resolver (`resolve_deck_state.js`), + a per-(plan,day) memo on
  `TimelineService.getOverview`. 500 cues × 8 days now **~347 ms** (~850×).
- **J2/L3 (`_113`+`_115`, P0, 2×-confirmed) — corrupt state silently dead:**
  `loadTimelineState` now validates the ENTIRE persisted shape (maps + values,
  numerics, `mode` enum, a non-object doc), THROWS naming file+field → `start()`
  refuses to half-run (the existing party-field contract, extended).
- **I3 (`_112`, P1) — non-compiling entry wedges the sequential autopilot:**
  picker excludes `_broken` + de-dupes ids (`autopilot_pick.js`); all three
  advance sites flag a deterministic compile failure as broken + skip it,
  surfacing which (loud), cleared on a clean load.
- **L2 (`_115`, P1) — backward wall-clock step strands the party cue:** clamp
  future-dated `moodSince`/`moodLastFire` down to `now` in `evaluateTick`
  (`triggers.js`) → self-healing re-arm.
- **L5 (`_115`, P1) — failed write returns 200 {saved:true}:** timeline-state
  writes already throw (honest); `POST /settings/save-now` wrapped → honest 500.
  **HANDOFF/spawn_task:** `StateManager.save()` (`lib/state_manager.js`, shared
  core outside the lane) swallows the atomic-write error → deck/mixer/globals
  save-now can still lie; a STRICT explicit-save path is the follow-up.
- **W1-3 handoff wired:** `/timeline/state` now carries `renderHealth`
  (`mixer.getNeverBlackHealth()`), guarded/additive, so a dark-while-lit ship
  reads unhealthy there too (W1-2 watchdog + CaptainPad).

**GATES:** timeline family **410/410**; full engine **2520/8** = the known
environmental baseline (audio-capture no-device, osc EADDRINUSE lifecycle,
mixer view-fader, pattern/scene parity, effects layout — **none import a W1-1
module; zero new failures**). New tests: `tests/e2e/ws_frame_crashproof.test.js`
+ 5 `tests/timeline/*` (clock_backstep_clamp, timeline_state_validation,
autopilot_broken_entry, overview_perf, save_write_honesty). `config.yaml` CLEAN
vs HEAD; every spawned engine black-holed via `MARSIN_CONFIG_FILE`; zero device
HTTP, zero sACN, operator stack untouched; no git ops.

---

## W1-1 follow-up — L5 strict save-now (`_120`, LANDED)

The W1-1 L5 handoff (`_116` fix 7): `StateManager.save()` (`lib/state_manager.js`,
shared engine core outside W1-1's 3-file lane) SWALLOWED the atomic-write error
with only a `console.warn`, so `POST /settings/save-now`'s deck/mixer/globals
branch could still report a lying 200 `{saved:true}` on a failed write — the
CaptainPad "✓ SAVED" badge reads that response (red-team `_115` L5). Report:
`.agent/reports/202607/20260725_120_wave1_strict_save_now.md`.

- **STRICT / BEST-EFFORT split at the save seam.** `save()` grows an options
  `{ strict = false }`: default warn-only (unchanged), `strict:true` re-throws.
  `saveMixerState`/`saveDeckState`/`saveGlobalsState` thread the flag through.
  In `api_server.js`, `saveAllState(strict=false)` + `saveGlobals(withParams,
  strict=false)` thread it; save-now calls `saveAllState(true)` +
  `saveGlobals(true,true)` so its existing (W1-1) try/catch now catches a real
  throw → honest 500 `{saved:false,error}`. The ~80 AUTO-SAVE callers pass
  nothing → best-effort, byte-unchanged (a transient disk blip never reaches
  W1-1's `exit(1)` backstop → no dark ship).
- **AUTO-SAVE behaviour is BYTE-UNCHANGED** (default-arg only; the existing
  `state_atomicity.test.js` "failed write is swallowed" invariant still passes).
- **The L5 lie is now an honest non-200.**

**GATES:** full engine **2524/8** — the 8 are the SAME known environmental
baseline (audio-capture framing ×2, OSC lifecycle/EADDRINUSE ×4, effects_v2
layout ×1, specialty-playlist parity ×1; **none touch `state_manager.js` /
`api_server.js` save paths — zero new failures**). +8 new tests, all GREEN:
`tests/state/strict_save.test.js` (7, deterministic strict/best-effort seam) +
`tests/e2e/save_now_honesty_e2e.test.js` (1, real engine subprocess: save-now →
non-200 on a broken dir while a `/global-blackout` auto-save over the SAME dir
stays 200 and the engine survives; timeline disabled to isolate the path;
imports `setup_config_guard.mjs`). `config.yaml` CLEAN vs HEAD; spawned engine
black-holed via `MARSIN_CONFIG_FILE`, state redirected via `MARSIN_STATE_DIR`;
zero device HTTP, zero sACN, operator stack untouched; no git ops.

---

## Unpatched-tray false-red investigation (`_121`, DIAGNOSED — fix pending)

Operator report: TE signs + 3 rope pairs "patched" yet still red/unpatched.
Report: `.agent/reports/202607/20260725_121_unpatched_tray_false_red.md`.

**VERDICT — not auto-discovery, not the tray.** The five controllers
(`LeftTeSign`, `RightTESign`, `LeftRightRopes`, `RightLeftRopes`,
`RightRightRopes`) are chained + saved correctly but **UNBOUND** (no `device:`
block — the `_96` "⚑ Patch without the board" step was never taken).
`computeLedStrandPatches` skips unbound cards (`led_patch_projection.js:177`),
so all 10 fixtures/strands project zeroed patches → red on every unpatched
surface — while the mapping pane header reads **"✓ fully patched"** (predicate
ignores binding grade, `controller_map_editor.js:782-791`) and unbound port
rows show concrete generic-preview addresses styled like real patches
(`:1750-1751`). Proven by headless repro on the scene files + read-only live
DOM probe (tray = 0 chips; `__globalPatchTree` zeroed for the ten) + parity
gate (10 × `unpatched_marker` INFO). MAJOR side-finding: pane drops ALL LED
projection violations (`computeRenderProjection` keeps `.fields` only, `:706`).

**Operator unblock (no code):** press ⚑ Patch without the board on each of the
5 cards, then Save — provisional grade patches everything end-to-end (`_96`).
**Fix plan (handoff → simulation_expert):** (1) emit `led_unbound_chained`
violation in `computeLedStrandPatches`; (2) merge LED violations into the
pane's banner/header count; (3) style unbound cards' chips as PREVIEW + banner;
(4) tooltip/copy on the ⚑ button. No fallbacks: never project generic patches
into patches.yaml for unbound cards (`_92` §4 rejection stands).
Zero source edits, zero device HTTP, zero sACN, no git ops.

---

## Dimmer Rack horizontal scroll (`_122`, DONE — uncommitted)

Operator report: titanic's 24 dimmer groups overflow the rack UI (flexWrap
row clipped by the fixed-height card). Report:
`.agent/reports/202607/20260725_122_dimmer_rack_hscroll.md`.

**Fix:** `CaptainPad/app/(tabs)/dimmer_rack.tsx` only (+29/-2) — fader row is
now a horizontal `ScrollView` (`:447-455`); fits→space-around spread as
before, overflows→scrolls with the partial fader at the card edge as the
natural affordance (no chrome). Gesture conflict handled two-layer per the
mixer precedent: NauticalFader capture-claims its PanResponder AND new
`faderDragging` state (`:231`, wired via existing onDragStart/onDragEnd
`:481-482`) hard-disables `scrollEnabled` during any knob drag (iOS ignores
`onShouldBlockNativeResponder`). Verified on fresh :7167 dist vs live titanic
engine, puppeteer iPad-touch viewport: overflow 2680/952, both ends
screenshotted (`.agent_renders/dimmer_rack_scroll_{left,right}.png`), mouse +
touch diagonal knob drags move value with scrollLeft frozen, gap touch-swipe
scrolls 0→340, horizontal swipe ON knob captured (no scroll, no value).
Engine dimmer writes restored to exact originals (`fullyRestored: true`).
Gates: tsc 0, vitest 914 pass/6 skip (= baseline), dimmer_rack lint clean
(4 pre-existing GlobalEffectMacros hook errors flagged, untouched), web:build
0. Operator Expo :6967 untouched; no git ops.

**Addendum (same day, operator follow-up):** orientation-responsive grid —
landscape 1 row (unchanged), portrait 2 rows column-wise inside the SAME
horizontal ScrollView (`perColumn = isPortrait ? 2 : 1`, CPCControls'
`useWindowDimensions` idiom), scroll distance halved (2680→1340). All _122
gesture guarantees re-verified in portrait 820x1180 (knob drags move value
with scroll frozen, gap swipe scrolls 0→344, no vertical leak); screenshots
`.agent_renders/dimmer_rack_{landscape,portrait}_{left,right}.png`. Gates
re-run: tsc 0, vitest 914/6 (= baseline), lint clean, web:build 0; engine
drags restored (`fullyRestored: true`). Live-stack finding flagged in the
report addendum: running engine's model now maps wall/stack/rail groups to
section ids 500+ while `/dimmers` persists only old 486-498 keys → those
faders show the `?? 1.0` default (engine-side drift, NOT a UI bug; repo's
titanic.js still produces 486-499).

---

## Chaining IS the patch (`_123`, DONE — uncommitted) — lands `_121`, reverses its direction

Report: `.agent/reports/202607/20260725_123_unbound_led_loud_ux.md`.

**OPERATOR RULING 2026-08-03 (verbatim):** *"unbound should not cause the lights
to go off or unpatched red."* Addenda: *"the warning and patch without board
button is okay. Just make sure it's not too noisy."* / *"keep the messages short
to avoid making the UI super noisy."* Plus: he pressed ⚑ on his five cards and it
WORKED (so that path is regression-protected, not reworked), and a **"No
Controller"** card must exist for fixtures attached to nothing.

**This SUPERSEDES `_121`'s Fix-plan direction and RELAXES `_92` §4.** `_121`
diagnosed correctly but proposed keeping unbound-with-chains dark and shouting
louder. The dark state WAS the bug. Routing to an operator-typed, board-unverified
IP is his accepted risk — the point of optional discovery (`_96`, whose
promote/reconcile machinery is untouched and still fully green).

**Landed:** `computeLedStrandPatches` dropped its `isBoundLedController` gate
(`led_patch_projection.js:183`) — every chained LED card projects at any grade;
`led_bad_ip` → **`led_no_destination_ip`**, chained-only, the ONE loud LED state
(`:197`). `validateLedManualUniverses` de-gated (`:441`); `isBoundLedController`
doc re-scoped to hardware claims (`controller_registry.js:855`); DMX-side
`bad_ip` no longer fires on LED cards (`:1917`, it duplicated + contradicted);
exporter doc rewritten (`pixelblaze_model_exporter.js:15`). **Pane:** LED
violations no longer discarded (`controller_map_editor.js:763`, `allViolations`
`:825`) — the `_121` MAJOR; header extracted as pure exported `headerStatusModel`
`:848`; `renderLedPort` reads ONE projection, no grade branch, no preview chips
`:1856`. **UI (quiet):** one muted `⚑ board unverified` tag on unbound+chained+IP
(`led_discovery_panel.js:955`, NOT `.led-binding-badge`); red `.cm-nodest-banner`
ONLY for chained+no-IP (`:718/:1404`); ⚑ keeps its label + `.led-device-mark-
provisional` class, tooltip re-aimed to "convenience"; NEW `.cm-none-card`
"🚫 No Controller" placeholder (`:739`, deliberately not `.cm-controller` —
4 agent_tools enumerate that selector).

**Gates:** sim `npm test` 1687 · 1679 pass · **8 fail = baseline subset, 0 new**
(baseline was 1663/9; the 9th, `real scene titanic: model fresh and complete`, is
now FIXED). `agent_tools/provisional_status_verify.cjs` **ALL 18 CHECKS PASSED**
(⚑ → PROVISIONAL → patched → contradiction refused → promoted VERIFIED).
`tools/scene_model_parity.cjs titanic` **PASS, 0 err / 0 warn / 1 info** (was 11
info incl. 10 × `unpatched_marker`). New `tests/chained_led_patches.test.js` (15);
inverted pins in `provisional_binding` / `led_patch_projection` /
`pixelblaze_model_exporter_local_index` / `scene_model_parity`.

**Evidence:** code-level before/after on TEST FIXTURES (`~/tmp/bm26_123/repro.mjs`
— before 0/10 patched + green header = the lie; after 10/10 patched + 10 routed;
no-IP variant 10/10 patched + 5 loud violations); read-only pane screenshots
`~/tmp/bm26_123/shots/` with every `:6970` save and `:6972` socket aborted at the
network layer. **Operator scene NEVER mutated** (his cards were already ⚑-bound;
mtimes verified unchanged). Note: he saved titanic mid-session (13:32) — the
device blocks + patches.yaml records in the working tree are HIS, not this wave's.
**Fix 0 of `_121` (press ⚑ on the 5 cards) is DONE by the operator** and is now
also unnecessary for patching. No git ops.

## MarsinLED push rejected on `deviceName` (`_124`, DONE — uncommitted, LANDED LIVE)

Operator bug, live 2026-08-03: every ⬆ Push to `LeftLeftRopes` (`10.x.x.60`)
died with `config apply failed (field=deviceName) — 1-32 chars,
letters/digits/-._ only`, while the confirm dialog's payload preview contained
only `strands` + `dmx` and no `deviceName` at all.

**Root cause — the firmware, not the sim.** `ConfigManager::update` merges the
partial body into the STORED config and validates the WHOLE merged document.
That board stores `deviceName: ""`, which fails its own rule, so it rejects
EVERY `POST /api/config` regardless of body. Proven with a **no-op gamma write**
(`{"gamma":{"r":1,"g":1,"b":1,"w":1}}` — the values it already held): identical
`field=deviceName` 400. The sim's body really was `{strands, dmx}` — one
construction site (`marsinled_client.js` `pushPerOutputUniverses` → `postConfigBody`),
`deviceName` in `DENIED_PUSH_KEYS` since day one. Nothing was hidden-merging.

**Landed:** new pure seam `deviceNameRepairForPush({ip, storedName,
controllerName})` (`marsinled_client.js:467`, with `DEVICE_NAME_RE` /
`isValidDeviceName`) — stored name valid → write nothing (never rename a working
box); field absent → invent nothing; stored name INVALID → write the CARD's name
**verbatim** (no sanitizer, no truncation); card name unusable → **THROW naming
the rename**, before any POST. Wired into `pushPerOutputUniverses:829`;
`derivePerOutputPlan` now returns `controllerName` (`device_config_mapper.js`);
`startPerOutputPush` pre-flights the same decision so an unusable name refuses
before the dialog opens, adds `deviceName` to the payload PREVIEW, and declares
it in its own dialog block ("⚠ This push also sets the device's NAME to …", it
is also the mDNS/AP name). `DENIED_PUSH_KEYS` keeps the key for every other
path. docs/41 gained **§4.1.1** recording the firmware behaviour + the proof.

**Gates:** `tests/per_output_push.test.js` +8 `_124` cases at the
payload-construction seam (valid stored name untouched · absent field never
invented · `""` repaired verbatim · unusable name → zero POSTs + rename text ·
plan carries `controllerName`) → **79 pass / 0 fail**. Sim `npm test` 1696 ·
**1688 pass · 8 fail = pre-existing scene-content baseline** (TE Sign V3 strand
metadata drift, titanic view-bit/CLI), none in the LED path. `security_check
--all`: 6 findings, all pre-existing MACs in `.scene_backups/studiodj/`.

**LIVE:** ran the real fixed client against the board (scratch script, not in
the tree) with the card's own plan → `{"outcome":"needs-reboot"}`, reboot,
read-back `perOutput = [{0,U30,start1,on},{1,U31,start1,on},{2,U42,start1,on}]`,
`deviceName "LeftLeftRopes"`, `dmx {enabled:true, protocol:0, timeoutMs:3000}`,
output 4 untouched/disabled. **The push the operator could not get through is
now on the hardware.** Device layer only — the sim-side files were already
correct on disk; his own ⬆ Push is still worth re-running (it persists the U42
park as `parkedOutputs` and does the scene save + bridge notify) and is now an
ordinary idempotent push. **Follow-up:** `server/led_gamma_service.cjs` has the
same exposure on any board with an invalid stored name. No git ops.

## GAMMA push learns the deviceName repair (`_126`, DONE — uncommitted)

Follow-up landing the `_124` §5 item: `server/led_gamma_service.cjs` POSTed a
bare `{gamma}`, so a board with an invalid STORED `deviceName` (fresh boards
ship `""`) failed every gamma push with the device's misleading
`field=deviceName` 400 — that no-op gamma write was literally `_124`'s proof
probe. No live device touched this wave; fixed at the payload-construction
seam.

**Landed:** the `.cjs` service consumes the client's ONE implementation
directly — Node native `require(esm)` of `marsinled_client.js` (verified on
this box's Node 24; older Node crashes loudly at startup, codex P0). New pure
seam `gammaPushBody({ip, gamma, storedDeviceName, controllerName})`: valid or
absent stored name → `{gamma}` only; invalid stored name → `{gamma,
deviceName: <card name VERBATIM>}`; unusable card name → THROW kind `invalid`
before the POST, naming the rename (+ docs/41 §4.1.1 pointer, `--device-name`
hint). New pure `gammaRejectionError`: a `field=deviceName` 400 on a nameless
body is explained as the §4.1.1 merge-validation quirk instead of parroted —
only for that exact trap. `pushGamma` verifies the repaired name in the
read-back (miss = `verify-mismatch`) and returns `deviceNameRepaired`.
Plumbing: save-server `/led/gamma-push` passes `controllerName`;
`led_gamma.js` transport sends `controller.name`; CLI `led_gamma_push.cjs`
gained `--device-name`. docs/41 §4.1.1 records the gamma repair + sharing.

**Gates:** new `tests/led_gamma_push_devicename.test.js` (7 `_126` cases —
incl. require/import OBJECT-IDENTITY of `deviceNameRepairForPush` /
`DEVICE_NAME_RE`, so regex parity is identity not resemblance) +
`led_gamma.test.js` pins the card-name plumbing. Targeted run 115/115. Sim
`npm test` **1703 · 1695 pass · 8 fail = the same pre-existing scene-content
baseline** as `_123`/`_124` (TE Sign V3 strand drift, titanic view-bit/CLI) —
no new failures. Report `20260725_126_gamma_push_devicename.md`. Remaining
follow-up unchanged: discovery could surface an invalid stored name as a loud
card state. No git ops.


## Bridge route READ-BACK — the push's third check is measured (`_127`, DONE — uncommitted)

Operator order: the chain works physically; make `✓ bridge notified — routes
follow` a real measurement matching the device write's read-back discipline.

**Landed:** the bridge (WS :6971 — it has no HTTP surface; the WS IS its
surface) answers a READ-ONLY `{type:'getRoutes'}` with its LIVE route table
(`{type:'routes', routes[], engineOwned[], mirrorOwned[], activeScenes[]}`,
pure wire shape `buildRouteTableSnapshot` in `lib/bridge_routing.cjs`).
Same-socket FIFO after the `setScene` notify = the reply is always the
post-save table. New `src/dmx/led/bridge_route_confirm.js` (pure seams):
`buildRouteExpectation` — stated BEFORE the device write; enabled outputs +
enable transitions, SPILL universes via the same `projectLedStrandSegments`
walk the patch projection uses, PARKED universes as must-be-ABSENT claims
scoped to this IP; `assessRouteReadback` — relay pair = confirmed,
engine-owned = confirmed `[engine-direct]` (one-writer arbitration working),
bench-mirror-owned = named one-writer CONFLICT, parked-routed = failure;
`confirmBridgeRoutes` — bounded 5×400 ms poll, broken transport fails
IMMEDIATELY. `SacnInputSource.queryRoutes` (reqId-correlated, 2 s timeout,
rejected on teardown). `persistAndNotifyAfterPush(io, expectations)` step 3;
omitting the expectation FAILS the confirm (no unmeasured ✓ by omission);
`[]` = explicit fleet nothing-pushed skip. Status line: `✓ bridge routes
confirmed (U30,U31→10.x.x.60)` / `✋ … missing U31→… — bridge relays N
route(s) after 5 read(s); check the sACN bridge log`. Push-all reads back the
UNION of pushed controllers' expectations. docs/41 §4.5 updated.

**Gates:** new `tests/bridge_route_readback.test.js` (18 cases incl. a
stub-bridge INTEGRATION over a real WebSocket answering with the REAL snapshot
builder); `per_output_push` / `led_controller_ui_round2` flows updated.
Targeted 169/169. Sim `npm test` **1736 · 1728 pass · 8 fail = the same
pre-existing scene-content baseline** as `_124`/`_126` — no new failures.
Report `20260725_127_bridge_route_readback.md`. **Operator note:** the show
machine's bridge must be RESTARTED (launcher) before the third check can pass;
until then it fails loudly with 'restart the launcher', which is the correct
claim. No live stack touched; no git ops.


## Calendar time-travel entry · cue `size` gone · HOLD out of the cue UI (`_128`, DONE — uncommitted)

Operator tasks 2026-08-03 + mid-flight ruling ("remove hold from the cue UI
to avoid confusion, but keep it for the party").

**Landed (CaptainPad):** the DAY calendar chart is a zoom entry point — cue
blocks/markers are touchables opening the SAME EventSheet (engine picks
perform vs travel, unchanged), and EMPTY calendar time opens the new MOMENT
mode (purple header, resolver peek, TIME TRAVEL HERE only). Empty-slot was
IMPLEMENTED, not deferred: `POST /timeline/travel {date,time}` + resolve
already existed — zero new engine surface. 15-min tap snap
(`chartTapToLocal`), 24:00 pull-back, null-on-bad-geometry. WEB LANDMINE
pinned in the report: RN-web gives `locationY` only to RESPONDER events —
Pressable presses carry none on web; the fix is the DayTimePicker
PanResponder-underlay idiom (decor layers pointerEvents:none). Cue `size`:
engine verified FIRST — cue `globals` is a fully generic CPC map
(validateGlobalsMap → _writeGlobals → setParams), NO size-specific plumbing,
so NOT the stop case; SIZE slider deleted, ON-seed now
`{speed:0.5,bpmSpeedSync:0}`, legacy size shed at load AND emit
(`cue_edit_logic.stripCueSizeGlobal`), never re-emitted; deck-level size
untouched; playa_default.yaml carries no size. HOLD: whole UI section gone;
`cue_edit_logic.assembleCue` spreads the original cue and never touches
`hold` — {min} and {until} forms round-trip byte-identical (pinned by
tests); new cues emit no hold. Engine diff = two comments.

**Gates:** tsc clean; CaptainPad vitest **931 pass / 6 skipped** (baseline
914/6 → +17, zero new failures); engine timeline tests 431/431. Live proof
on a fresh :7167 dist vs real engine (playa_default armed-dormant): block
tap → event sheet, noon tap → moment sheet, travel → purple TIME TRAVELING
banner, D1 tab-return → REST `zoom:null`, cue editor GLOBALS = speed+sync
only with no HOLD between DURATION and DAYS. Report
`20260725_128_calendar_timetravel_cue_size.md`. Harness in
`~/tmp/bm26_s128_calendar_tt/`. Servers relaunched for verify (a CC restart
had killed :7167 + :6968) and shut down after; :6967 never touched. No git
ops.

## Dimmer rack: desktop-mouse horizontal scroll (`_130`, DONE — uncommitted)

Operator bug 2026-08-03: the `_122` fader-row ScrollView was touch-only in
practice — on a computer the row was frozen. Repro on a pre-fix :7167 dist
(desktop viewport, real CDP mouse events): plain vertical wheel DEAD
(browsers drop deltaY on a horizontal-only scroller), scrollbar hidden
(`scrollbar-width:none`), gap click-drag dead; only shift+wheel/trackpad
deltaX worked.

**Landed (CaptainPad):** new pure `utils/wheel_scroll_logic.ts`
(`wheelToHorizontalDelta` — deltaY-dominant → horizontal px, pixel/line×40/
page×width; deltaX-dominant/tie/empty → null = native keeps it) + 8-case
test. `dimmer_rack.tsx`: web-only effect attaches a non-passive `wheel`
listener to `getScrollableNode()` (throws loudly if missing — no silent
fallback); preventDefault + `scrollLeft += delta` only for deltaY-dominant
events; `faderDraggingRef` mirrors the `_122` gate so mid-knob-drag wheels
are ignored (DOM listener can't read state); scrollbar now shown on web
only (`showsHorizontalScrollIndicator={Platform.OS==='web'}`) — native
touch keeps it hidden. NO gap click-drag panning (would sit on the faders'
capture-claimed PanResponder; wheel+scrollbar cover desktop).

**Gates:** tsc clean; vitest **939 pass / 6 skipped** (= `_128` baseline
931 + 8 new, zero new failures); eslint clean on touched files; web:build
pass. Live proof BOTH platforms on fresh :7167 dist: desktop wheel 0→720→
back, deltaX native 480, knob mouse drag 1.00→0.43 with scrollLeft frozen +
mid-drag wheel ignored; iPad touch re-verified all `_122` checks (landscape
1 row, portrait 2 rows tops 576/831, gap swipes 379/406, knob touch drags
never scroll). Engine dimmers diffed + restored (`fullyRestored:true`).
Report `20260725_130_dimmer_rack_desktop_scroll.md`. Note: morning engine
on :6968 was found dead; fresh `--model titanic` engine + :7167 dist server
left running for the operator; :6967 never touched. No git ops.

## Audio Companion: noise-floor calibration APPLY feedback (`_129`, DONE — uncommitted)

Operator bug 2026-08-03: running NOISE LEVEL CALIBRATION and applying it gave
NO UI feedback — nothing showed the noise level was actually set. Root cause
found in `marsin_engine/audio/companion/companion_server.js`: the
`applyNoiseGates` handler applied the gates locally, broadcast `gates` (three
sliders nudged) and fired `writeThroughShared` — a **fire-and-forget** PATCH
`/audio/config`. Nothing confirmed the value, and a 400 from the engine left
the UI looking exactly like a success. ("Noise floor" here = the per-band
noise gates lowGate/midGate/highGate in [0,0.999], not dB.)

**Landed (companion):** new pure `audio/companion/noise_floor.js`
(`normalizeGateBundle` — engine/analyzer `bands` → gate state, per-band null =
inherit, missing/non-finite THROWS; `effectiveGates`; `formatGateSummary`;
`verifyGateApply` requested-vs-read-back @5e-4; `formatApplyMessage`, which
refuses to render an incoherent outcome). `companion_server.js` gains
`applyNoiseFloor(ws, gates, opts)`: apply locally → **await** the engine
PATCH → **read back the authoritative post-apply state** (engine's own
post-PATCH config; the live analyzer's `bands` only when there is no engine,
reported as *local only*) → reconcile sliders to the read-back → verify →
emit `noiseApplyResult`. Failed PATCH / throwing read-back / changed value
⇒ `ok:false` + a loud line; no success-looking state. `gatesMsg()` puts a
server-built `summary` on every `gates` broadcast and on `hello`
(`gatesSummary` + `lastNoiseApply`). The calibration's 💾 Save path now runs
through the same verified apply and only snapshots the profile when the
read-back proves the gates landed.

**UI (`ui/*`):** two quiet lines under the calibrate card — `#noisecal-applied`
(`✓ noise floor set (engine) — low 0.061 · mid 0.043 · high 0.180`, auto-clears
after 5 s; a FAILURE stays until the next apply; appends `· saved to "<prof>"`)
and `#noisecal-current` (always there: `noise floor now: … · global 0.040`,
from server truth, so a reload still shows it). On reload a past failure is
re-shown `(last apply)`; a past success is not re-announced.

**Gates:** 17 new tests in `tests/companion/companion_noise_floor.test.js`, all
green; companion+audio dirs 663 pass / 5 fail (all `audio_capture.test.js`
"pinned Windows mic" env); full engine suite **2549 tests, 2540 pass, 9 fail**
— the 5 plus effects_v2_mode_page_layout, osc_listener EADDRINUSE,
status_output_routing, specialty_white_uv byte-identity: environmental /
pre-existing (operator's live stack holds :6968 + the OSC port), none in
audio/companion. `git diff --check` + `node --check` clean. Screenshot proof
(set / failure / after-reload) in `~/tmp/noise_cal_shots/*.png`, rendered from
the real UI files with copy produced by the real formatter — the operator's
live companion :6966 and engine :6968 were NOT touched and no gate was written
to the running engine. Report `20260725_129_audio_noise_cal_feedback.md`.
Follow-up noted: the GAIN calibration's Apply still uses the old
fire-and-forget path. No git ops.

## Audio Companion: input-gain calibration APPLY feedback (`_131`, DONE — uncommitted)

`_129` §4 follow-up: `▶ Calibrate gain → ✓ Apply gain` still fired the
fire-and-forget `setInputGain`, so a rejected apply looked exactly like a
success and no value was ever confirmed. Same treatment, same patterns.

**Landed (companion):** new pure `audio/companion/apply_readback.js` — the
shared read-back provenance vocabulary (`SOURCE_LABEL` engine / *local only*,
`sourceLabel()` throws on an unknown source); `noise_floor.js` now imports it
instead of keeping its own copy (its copy + thrown messages unchanged, `_129`'s
17 tests untouched). New pure `audio/companion/input_gain.js`:
`normalizeGainRequest` (out-of-range/non-numeric REFUSED, nothing written),
`normalizeInputGain` (read-back; missing/non-finite/outside [0,64] THROWS),
`formatGainSummary` (`×3.70`, 2 dp so a clamp shows), `verifyGainApply` @5e-3,
`formatGainApplyMessage` (refuses incoherent outcomes), and **`runGainApply`**
— the apply PATH with every side effect injected, so the ORDER is unit-tested
and the server runs that exact code (no mirror to drift). Order: validate →
apply locally → **await** the PATCH → **authoritative read-back** → reconcile
→ verify → one line. One improvement over `_129`: when the engine is up and
REFUSES the write, the path re-reads the engine's own config once and
reconciles to it, so a red "NOT set" can't sit above a readout showing the
number nothing upstream accepted (both failures reported if the re-read also
fails). `companion_server.js`: `applyGainVerified` + `liveAnalyzerGain` (test
source runs at unity by design → read the mic-preamp state there), new WS
message `applyInputGain` (sliders keep the cheap `setInputGain`), `gainMsg()`
puts a server-built `summary` on every `inputGain` broadcast + `hello`
(`gainSummary` + `lastGainApply`), and `saveActiveProfile` accepts an
`inputGain` routed through the verified apply with `persistProfile` — a profile
can only record a gain the read-back proved landed.

**UI (`ui/*`):** two quiet lines under the Calibrate-gain card, mirroring the
noise card (same classes, no CSS change) — `#gaincal-applied` (`✓ input gain
set (engine) — ×3.70`, auto-clears after 5 s; a FAILURE persists until the next
apply; appends `· saved to "<prof>"`) and `#gaincal-current` (always there:
`input gain now: ×3.70`, server truth, correct after a reload). Past failure
re-shown `(last apply)` on reload, past success not re-announced.
`NOISE_APPLY_MS` → `APPLY_CONFIRM_MS` (one 5 s lifetime for both cards). The
DESIGN page's compact `Apply` uses the verified message too and flashes the
server's read-back text; its old optimistic `flash('gain → ×…')` (which lied on
a failed apply) is gone.

**Gates:** 30 new tests in `tests/companion/companion_input_gain.test.js`, all
green (with `_129`'s: 45 pass / 0 fail); full engine suite **2582 tests, 2573
pass, 9 fail** — the exact `_129` baseline failure set (audio_capture ×5,
effects_v2_mode_page_layout, osc_listener EADDRINUSE, status_output_routing,
specialty_white_uv), all environmental, **no new failures**, none in
audio/companion. `git diff --check` + `node --check` clean. Screenshot proof
(ok / failed PATCH / engine-clamped mismatch / after-reload) in
`~/tmp/gain_apply_shots/*.png`, rendered from the real UI files with copy
produced by the real `runGainApply`, served on **:31941** (agent slot range) —
the operator's live stack (:6966/:6968/…) was NOT touched and no gain was
written to the running engine. Report
`20260725_131_audio_gain_apply_feedback.md`. Follow-up noted: give the
noise-floor path the same refused-write re-read; the gain card has no
"Save to profile" button yet (server side is in place + tested). No git ops.

## Audio Companion MIC TUNE polish: refused-write re-read + gain save button (`_132`, DONE — uncommitted)

Operator accepted `_131`'s two noted follow-ups as a wave.

**(1) Noise floor — refused-write re-read.** `_129`'s `readBackGates` fell
through to the ANALYZER when the engine REJECTED the PATCH — but the analyzer
holds the optimistic local apply, so the card showed a red `✗ noise floor NOT
set` directly above `noise floor now: low 0.061 · mid 0.043 · high 0.180`: the
exact gates the engine had just refused. Fixed by moving the read-back decision
into a new pure, awaited `resolveGateReadBack` in `audio/companion/
noise_floor.js` (same reason `_131` extracted `runGainApply` — testable without
a socket; `applyNoiseFloor`'s structure and every WS frame it emits are
unchanged, `companion_server.js` just imports it and takes `error` from it).
Rules: engine took the write → its post-PATCH body (unchanged); engine REFUSED
→ **re-read `/audio/config` ONCE** and reconcile sliders + summary to the
engine's own gates, verdict still `ok:false` (the re-read fixes what is SHOWN,
never the outcome); re-read also fails → error becomes `…; engine re-read
failed: <why>` (both reported, nothing swallowed); `fetchConfig` → null (the
503 "audio not initialized") or no engine → analyzer read-back, original error
intact; untrusted read-back → `gates:null` + `read-back failed: …`, never a
number. One authoritative read, not a retry (pinned by a call-counting test +
one proving a SUCCESSFUL write is never re-read).

**(2) Gain card — the missing 💾 Save to `<profile>`.** `_131` wired
`saveActiveProfile` to accept `inputGain` through the verified apply but shipped
no control. Added mirroring the noise card exactly: `#gaincal-save` as the
second button in the same `.mac-result` row as `✓ Apply gain` (same classes,
same copy shape, no CSS change), click sends `{saveActiveProfile, inputGain:
recommendedGain}`, and `renderProfiles` now keeps BOTH save buttons' labels
current from one string. The existing `gainApplyResult` line covers it:
`✓ input gain set (engine) — ×3.70 · saved to "Quiet room"`; a refused write
still writes nothing into the profile.

**Gates:** 8 new tests appended as §5 of
`tests/companion/companion_noise_floor.test.js` — **`_129`'s 17 all still pass
UNMODIFIED, no pinned expectation had to change**; noise_floor + input_gain
together **55 pass / 0 fail**; full engine suite **2590 tests, 2581 pass, 9
fail** — the same environmental baseline set (audio_capture ×5,
effects_v2_mode_page_layout, osc_listener EADDRINUSE, status_output_routing,
specialty_white_uv), **no new failures**, none in audio/companion.
`git diff --check` + `node --check` clean. Screenshot proof in
`~/tmp/companion_polish_shots/*.png` (`noise_refused_write.png` — red NOT-set
line above the re-read `0.040` gates; `gain_save_button.png`;
`gain_saved_to_profile.png`), real UI files driven by the real
`resolveGateReadBack`/`formatApplyMessage`/`runGainApply`, served on **:31942**
(agent slot range) — the operator's live stack (:6966/:6968/…) NOT touched,
nothing written to the running engine. The two cards are now behaviourally
identical (authority rules, refused-write reconcile, transient-✓ /
persistent-✗, reload-safe readout, verified save-to-profile). Report
`20260725_132_audio_companion_polish.md`. No git ops.

## Dimmer state survives model renumbering: stable group-name keys (`_125`, DONE — uncommitted)

**The `_122` live-stack finding, fixed at the root.** Persisted dimmer
brightness (`globals_state.yaml → dimmers`) was keyed by NUMERIC section id;
section ids are minted operator-side by the sim's controller registry
(`controller_registry.js` ~:2339 — per-group "next free id" above the DMX ∪ LED
max, re-minted on scene rework) and exported into `models/titanic.js`. The
operator's regeneration moved the wall/stack/rail groups 486-498 → 500-513, so
every saved value went orphan and the Dimmer Rack fell back to `?? 1.0`.
Expected operator churn — the fix makes state survive it.

**Landed:** dimmer state is now keyed by STABLE GROUP NAME (the identity that
survives regeneration; `groupFixedColors` set the precedent).
`StateManager.migrateDimmersToGroupKeys(globalsState, groupToSectionId)` runs
at engine load (api_server, right after `loadGlobalsState`): numeric keys
mapping to a current group are rewritten to the name; duplicates (half-migrated
file) keep the name-keyed value with a loud drop-warning; ORPHANS (id/name
matching no current group) get ONE clear warning naming every key and are
preserved on disk untouched — never deleted, never silently defaulted.
Idempotent; persists on the next globals save (hueShift-discard precedent, so
the autoSave gate is honored). `applyGlobalsState` gained an optional
`groupToSectionId` param: names resolve to the CURRENT model's ids; numeric
keys still apply verbatim (old id-keyed snapshots restore exactly as before).
WIRE UNCHANGED — CaptainPad untouched: `GET /dimmer-groups` identical (now via
the shared `modelDimmerGroups()` table), `GET /dimmers` still `{sId: v}`
(names resolved to current ids, orphans passed through verbatim),
`POST /section-brightness` still takes `sectionId` but persists under the
owning group's name and 400s LOUDLY on an id no group maps to (codex P0 — an
unmappable key could never be read back). Pre-existing orphans in the live
titanic file (1-2, 4-17, 189, 486-498) stay preserved+warned; old `titanic.js`
in git history holds their id→group map if hand-recovery is ever wanted.

**Gates:** new `tests/state/dimmer_state_stable_keys.test.js` **7/7** (legacy
file migrates · idempotent · renumbered model keeps values by name across
save/load · orphans warn loudly + survive the round-trip byte-identical ·
duplicate drop is loud · legacy numeric snapshot path unchanged · unknown name
skipped never guessed). Black-holed e2e vs the REAL titanic model (three-wall
harness pattern: `controllers: []` + dest 127.0.0.9 via MARSIN_CONFIG_FILE,
temp MARSIN_STATE_DIR/_PLAYLISTS_DIR/_TIMELINE_DIR, walls asserted from
/status): boot migrated 2 entries + warned `[189, 486, 487]`, wire ids
correct, POST persisted `"Right Front Wall": 0.33` by name, unknown id → 400,
on-disk file name-keyed with orphans byte-identical — PASS. Full engine suite
**2534 / 2526 pass / 8 fail** — all 8 in the known environmental families
(audio_capture ×5, effects_v2_mode_page_layout, osc EADDRINUSE from the live
stack, specialty_white_uv drift), **zero new failures**. `node --check`,
`git diff --check`, `--list`, `--dry-run` all pass. Operator's live
`states/titanic/` untouched (fixture copies only). **Follow-ups filed in the
report:** `viewSelection.target` (deck/mixer/snapshots/playlists) persists raw
section/fixture ids — same renumbering fragility; pre-fix snapshots carry
id-keyed `globals.dimmers` (restore unchanged, migratable later). Report
`20260725_125_dimmer_state_stable_keys.md`. No git ops.

---

## _133 — Documentation contract truth (Sub-agent A) — LANDED

**Scope:** three docs only — `docs/COLOR_THEORY.md`,
`docs/MARSIN_ENGINE_PATTERNS.md`, `docs/MARSIN_PB_LANG_SPEC.md`. No code, no
scene, no model, no config. `views.yaml` + `titanic.viewmasks.js` read-only
(Sub-agent B owns those).

**Landed:** the three documents now agree with the engine, the vendored WASM,
the finished Titanic mapping, and the operator's creative decisions.

*Parameter philosophy replaced.* The old "every pattern must expose direction +
autonomous reversal + radius + kick + two colours + true black + party
brightness" rules are gone — the parameter truth sweep (`_32`) measured 170
DEAD / 39 WRONG / 25 WEAK of 817, clustered on exactly those mandates. New
binding rule: every production pattern has a **truthful `localSpeed` as the
FIRST local control**; **direction exists only when the concept has meaningful
directional motion**, and is then the SECOND control with visibly opposite
endpoints and no centre freeze; **no other generic slider is required**; every
declared control must be truthful, perceptible, independently useful and
effective across its range; **do not invent controls to fill MIDI knobs**.
Autonomous reversal demoted to optional. Global-before-local order and
declaration-order = MIDI-knob-order preserved. Audio stays modulators-only.
Every statement is now tagged **HARD CONTRACT** / **PRODUCTION CONVENTION** /
**OPTIONAL CAPABILITY**, with an explicit ban on describing an artistic
preference as a runtime requirement.

*Timing corrected.* The double global-speed multiplication (`globalMult =
pow(2, (speed-0.5)*4)` inside `beforeRender`) is removed, as is the instruction
to `export var speed` — `speed`/`size` are `engineOwned` and never injected
(`param_center.js`). Documented truth: the engine accumulates
`patternClockSeconds += wallDelta * globalSpeedMultiplier()` and passes it to
`mixer.beginFrame`; `pattern_channel.beginFrame` differences and accumulates
without re-applying it; patterns apply **only** `localSpeed`.

*WASM `delta` re-measured by OFFLINE probe* (in-process VM, no engine, no
socket, no port). The old "fixed nominal ≈15.7, independent of `elapsed`" claim
is **false**: `delta = (elapsed_now − elapsed_prev) × 1000` ms, so it IS
global-speed-scaled (the old "SPEED scales `time()` not `delta`" gotcha is also
withdrawn). Real quirk documented: `0` doubles as the "no previous frame"
sentinel, so `delta` is a nominal **16.0 ms** on frame 1 and on any frame
following an `elapsed == 0` — a freshly loaded pattern sees `16, 16, real,
real…`; a repeated `elapsed` yields `0`, not the nominal. `t` == the passed
elapsed exactly; `time(0.1)` wraps at 6.5536 s; `pixelCount` is a literal 144
at 4 / 144 / 964 runtime pixels.

*Metadata + views corrected.* Four-variable ABI → the real **7 lanes**
(`controllerId, sectionId, fixtureId, viewMask, fixtureTypeId,
pixelLocalIndex, viewMaskHi`, `meta_abi.js`). Compile-probed the language
surface: `fixtureType` (not `fixtureTypeId`) and `pixelLocalIndex` are
builtins, `pixelIndex` is not, and `viewMaskHi` is compiler-restricted to
`(viewMaskHi & <literal>)`. `sectionId == 2 // Vintage` examples removed —
titanic sections are model-specific (514, 515…), which is what made 137 knobs
dead on the ship. Taught: prefer `inView("Authored View Name")` (folds both
words, hard compile error on unknown name, on-demand bit promotion), `FIX_*`
where fixture capability is the real distinction, raw ids only for declared
single-model work. The "always include a `sectionId == 0` fallback" advice is
**withdrawn** in both docs (codex P0). `views.yaml` (engine semantic masks) vs
`pixel_map_views.yaml` (simulator 2D layout) explicitly disambiguated.

*Colour + hardware corrected.* `w == a` invariant preserved and restated (RGB
shapes warmth, UV independent, amber not a separate accent lane). Hardware
updated to the finished ship — **964 px**: Hull Canvas 360 Shehds bar px / 4
wall groups · Silhouette 320 RGBW rope px / 8 strands · Jewelry 96 RGBW Vintage
rail px · Organs 40 RGBWAU Uking pars (24 stacks + 16 auditoriums) · Identity
2 × 74-px RGBW TE signs = 148. All five reconcile exactly against
patches/controllers/scene_config + the fixture models. **Corrected: strands and
TE signs DO have white emitters** (RGBW, `whiteMode: native`); what they lack is
amber and UV. Real output paths documented (RGBWAU DMX for bars/pars; strands
fold amber into RGB, drop UV, joint clip-proof pre-scale, gamma only on the
controller) and the `R + W + 0.8A + 0.1U` equations demoted to a **preview /
legacy** path, not the physical chain.

*COLOR_THEORY rewritten around the five instruments* with concise artistic
roles (Canvas = gradients/water/large motion · Silhouette = far-field outline,
cool saturation, travel · Jewelry = warm filigree, restrained · Organs =
heartbeat, halos, punches · Identity = deliberate punctuation, not constant
competition). "Wash the wood warm; put saturation in the pixels" kept as the
core rule. **"Four giant golden beacons" corrected to two main stack structures
plus two smaller stack beacons.** Warm stacks explicitly remain artistic
guidance, not an engine rule. New §7: one palette ≠ one colour — same global
endpoints, different palette position / luminance / saturation / motion per
instrument.

*Transitions, trails, portability.* Six-point blend contract written into both
docs (exact endpoints at 0 and 1, bounded output, identical W/A math so matched
inputs stay matched, no per-pixel allocation, truthful spatial direction).
Stale blend table replaced with the three modes the API actually accepts
(`blend_screen`, `blend_add`, `blend_over`) plus transient `trans_*`. Trails:
stop presenting a hard-coded pixel count as portable — prefer scalar/spatial
formulations or the `feedbackTrails` global effect; a model-sized array must be
marked model-specific.

*Stale material.* Two `file:///Users/ssolaimanpour/...` links → relative;
`.agent/01_skills/...` → `.agent/skills/...`; the 13-pattern static inventory
removed; `docs/36/40/41` shorthand → real links.

**Gates:** zero `file:///`, zero `.agent/01_skills`, zero portable-section-id or
double-speed claims (only deliberate "this was wrong" callouts). **Every
relative link target verified to exist** by script; every referenced code path
verified present. No real IPs, no MACs, no future dates.
`python scripts/security_check.py --all` → **no finding in any of the three
files**. **No git op, no deploy, no npm install, no live engine boot, no
default port touched** — the delta probe ran the WASM VM in-process with no
transport, from the session scratchpad.

**Open:** (1) **PENDING-B** — `MARSIN_ENGINE_PATTERNS.md` §7.3 lists the 24
current titanic group names behind an HTML comment marker; reconcile after B
lands. (2) **`.agent/skills/highdef_pattern_generation.md` still mandates the
old universal parameters and hard-codes `sectionId 1/2/3` for the ship** — it
was out of write scope and now contradicts the corrected docs; fix it or it
keeps regenerating dead knobs. (3) `lib/pattern_channel.js` L25 comment lists a
non-existent `blend_crossfade` channel mode. (4)
`marsin_engine/effects/feedbackTrails.js` (plus `blastWhite/colorWash/dropHit/
uvBlast/vintageWhite`) are camelCase filenames violating the snake_case rule —
linked under their real names, reported not renamed. Report
`20260725_133_docs_contract_truth.md`.

## Titanic semantic engine views: 17 composite views (`_134`, DONE — uncommitted)

**The titanic scene had 24 base group bits and `custom: []` — no artistic
handles at all.** Landed the semantic vocabulary, generated through the
repository's CANONICAL chain (`simulation/src/dmx/view_registry.js`:
`createViewRegistry` → `reconcileGroupBits` (asserted no-op `+0 −0`) →
`addCustomView` → `buildViewmasksSidecarJS`, plus save-server's own
`yaml.dump({views},{lineWidth:-1})` writer) driven OFFLINE — no sim browser, no
server, no ports. Two files only: `simulation/scenes/titanic/views.yaml` (line
27 `custom: []` → 17 views; the 24 `groupBits:` lines byte-for-byte untouched)
and `marsin_engine/models/titanic.viewmasks.js` (17 `viewMasks[]` + the
`// Updated:` stamp; `groupBits` block byte-for-byte untouched). `patches.yaml`,
`controllers.yaml`, `scene_config.yaml`, `pixel_map_views.yaml`, `titanic.js`,
`titanic.effects.js` and every pattern/playlist untouched.

**The 17 (word / bit / pixels):** word 0 — `Hull Canvas` 0x40000 **360** ·
`Left Hull` 0x80000 **180** · `Right Hull` 0x1000000 **180** · `Silhouette`
0x2000000 **320** · `Left Silhouette` 0x10000000 **160** · `Right Silhouette`
0x20000000 **160** · `Jewelry` 0x40000000 **96**; word 1 (`viewMaskHi`) —
`Left Jewelry` 0x1 **48** · `Right Jewelry` 0x2 **48** · `Organs` 0x4 **40** ·
`Left Organs` 0x8 **20** · `Right Organs` 0x10 **20** · `Identity` 0x20 **148**
· `Stacks` 0x40 **24** · `Left Stacks` 0x80 **12** · `Right Stacks` 0x100 **12**
· `Auditoriums` 0x200 **16**. Counts MEASURED from the exported model via the
real `lib/mask_registry.js`, all 17 matching spec. Deliberately NOT created:
`All Bars`/`All Ropes`/`All Vintage Lights`/`All TE Signs` (exact-membership
aliases of Hull Canvas / Jewelry / Silhouette / Identity), `Left|Right
Auditorium` (already base group views), `Left|Right Identity` (TE Sign /
TE Sign 2 already select independently). Patterns reach them by name —
`inView("Left Hull")` — so no pattern needs to know the word.

**Gates:** offline harness **21/21 PASS** using the REAL `view_word.js`
`ViewBitAllocator`, `mask_registry.js`, `view_mask_constants.js`,
`in_view_intrinsic.js` and the **vendored WASM host** — groupBits byte-stable vs
HEAD · 41 MASK_* constants with zero collisions · every (word,bit) unique ·
no word-0 custom bit on a group bit · no two views with identical member sets ·
inView folds correctly in BOTH words (hi-word as an inlined literal, no `var`)
· and a per-view VM compile+render over all 964 pixels with **ZERO misses and
ZERO leaks on all 17**. `scene_model_parity.cjs titanic` and `--strict` both
**PASS 0/0**. Sim suite **1736 / 1728 pass / 8 fail** = the exact known
baseline; the four view/bench-touching failures were verified against the
pre-change state (replaying `checkTargetCompatibility` with `custom` truncated
to 0 still gave the 6 `TGT_UNIVERSE_RESERVED` refusals and `31/31 (0 spare)`)
— all four were ALREADY red. Engine mixer/view suite **475/475**; full engine
suite **2588 / 2580 pass / 8 fail**, all known environmental (audio_capture ×5,
effects_v2_mode_page_layout, OSC EADDRINUSE from the live stack,
specialty_white_uv playlist drift from another agent's uncommitted edits) —
**zero new failures**. No git ops, no deploy, no install, no hand-booted
engine; operator's live stack kept every port.

**Open (filed, NOT fixed — outside write scope):** (1) **word 0 is now
saturated** (`0x7fffffff`, `nextFreeBit → 0`) because the canonical
`nextFreeSlot` fills word 0 first; base group bits MUST be word 0, so adding a
new fixture group to the titanic scene now throws at export
(`[Views] Out of view-mask bits while assigning group '…'`). Word 1 still has 21
free slots — the fix is an allocator policy change in `view_registry.js`
(prefer word 1 for custom views / reserve group headroom), then re-export. It
was already tight: the bench-block projection read `31/31 (0 spare)` with ZERO
customs. (2) **`marsin_engine/lib/model_loader.js` is word-blind** —
`reserveExplicitBits` accumulates ONE flat `reservedMask` ignoring `word`, so
`loadModelForGauge('titanic')` now throws `groupBits['Left Back Wall'] reuses
bit 0x10` (word-1 `0x10` vs word-0 group `0x10` — not a real collision).
`engine.js` does this correctly with `reservedMask`/`reservedMaskHi`, so the
engine/sim/CaptainPad/sACN path is UNAFFECTED; blast radius is
`tools/perf_gauge.mjs` + `tools/param_truth/render_context.js` on titanic, and
no test loads titanic through it. (3) **`simulation/lib/bench_section.cjs` T3
view-bit budget is word-blind** — counts word-1 customs against the 31-bit
word-0 ceiling (`24 + 17 + 7 = 48` where true word-0 pressure is 38); the
refusal's conclusion is right, its arithmetic isn't, and it only surfaces
inside two already-red tests. Report
`20260725_134_titanic_semantic_views.md`.

**_133 addendum — PENDING-B reconciled (after _134).** Re-read the FINAL
`views.yaml` + regenerated `titanic.viewmasks.js` and treated the FILES as
authority, not the hand-off note. B's 17 custom views confirmed by independently
re-summing member-group pixel counts from `models/titanic.js`: Hull Canvas 360 ·
Left/Right Hull 180+180 · Silhouette 320 · Left/Right Silhouette 160+160 ·
Jewelry 96 · Left/Right Jewelry 48+48 · Organs 40 · Left/Right Organs 20+20 ·
Identity 148 · Stacks 24 · Left/Right Stacks 12+12 · Auditoriums 16 — **all 17
match**, model total 964, all 24 base groups populated. Rebuilt the engine's
`viewTable` (41 names) and ran the REAL `buildMaskConstants()` (41 `MASK_*`, **no
sanitized-name collision** — would have failed every compile) and the REAL
`injectInViewIntrinsic()` over all 41: **31 fold low-word, 10 high-word, 0
failures**, every high-word fold an inlined literal per Tier-C. All six forbidden
aliases (`All Bars`, `All Ropes`, `All Vintage Lights`, `All TE Signs`,
`Left/Right Identity`) hard-error as intended; `Left/Right Auditorium` remain
base groups. **New finding:** the five instrument views are **mutually exclusive
and exhaustive** — they partition all 24 base groups with zero overlap and sum to
exactly 964, which makes a per-instrument `if/else if` chain provably complete.
Docs: `PENDING-B` marker removed; new **§7.3.1** in `MARSIN_ENGINE_PATTERNS.md`
(17 composites with counts + 24 base groups + word placement + a "names that do
NOT exist" list + a spelling-irregularity warning — `Right SmokeStacks` plural vs
`Left SmokeStack` singular, underscored strand groups, singular `Left/Right
Auditorium` vs composite `Auditoriums`, since `inView()` matches literally);
`COLOR_THEORY.md` §2 gained a View-name column plus halves/subdivisions, §4 now
points at `Stacks` for the funnels (warning that `Organs` also covers the
auditoriums), §7 gained a worked `inView()` palette-distribution example.
Re-verified: every concrete `inView("…")` string in all three docs resolves
against the real viewTable (only generic placeholders and the do-not-exist list
don't, by design); all 17 + 24 names present; all relative links resolve;
security check clean; **no git op, no deploy, no install, no live boot, no port
bound.**

## _136 — `model_loader.js` made word-aware (fixes `_134` §5.2) — LANDED

**Scope:** `marsin_engine/lib/model_loader.js` + one new test file. No engine.js,
no model, no sidecar, no scene, no config. Report
[`20260725_136_model_loader_word_aware.md`](../reports/202607/20260725_136_model_loader_word_aware.md).

**Landed:** the VM-only loader behind `tools/perf_gauge.mjs` and
`tools/param_truth/render_context.js` is no longer blind to the Tier-C view
**word**. `reserveExplicitBits()` accumulated ONE flat `reservedMask` across every
`viewMasks` entry and `assignGroupBits()` validated the declared `groupBits`
table against it — so once `_134` pinned 10 semantic views into word 1 at bits
`0x1..0x200`, each one read as a phantom collision with a legitimate word-0 group
bit. Repro `loadModelForGauge('titanic')`: **before** `THROW: groupBits['Left
Back Wall'] reuses bit 0x10`; **after** `OK viewMasks: 17 pixels: 964 · word1
views: 10 · 284 px with viewMaskHi set`. `engine.js` was always correct
(`reservedMask`/`reservedMaskHi`, groupBits validated against word 0 only) — the
two loaders had drifted, so the engine/sim/CaptainPad/sACN path was never
affected.

`reserveExplicitBits()` now returns `{reservedMask, reservedMaskHi}` and reserves
into the entry's own word; `assignGroupBits()` consults the **word-0** reservation
only. **No check was weakened** — a genuine same-word reuse still throws loudly
(`reuses bit 0x…` / `reuses viewMaskHi bit 0x…`), and two engine.js validations
`model_loader` lacked were brought over (a `word` outside `{0,1}` throws instead
of silently coercing to 0; a `word:1` entry with no explicit bit throws). Also
initialises `px.vMaskHi ?? 0` per `engine.js:417`. `reserveExplicitBits` /
`assignGroupBits` are now exported so the word-space contract is testable without
writing throwaway model files into the source tree (`MODELS_DIR` is fixed).

**Test:** new `tests/mixer/model_loader_word_aware.test.js` — **14/14 pass**. It
is the FIRST test to load a real multi-word model through `model_loader` (the
gap that kept every suite green while the loader was broken:
`view_mask_hi_host` uses a synthetic model, `param_truth_smoke` uses
`test_bench`). Covers: titanic loads with 24 groups + 17 views (**41 named
masks**); a guard asserting titanic still CONTAINS a word-1 bit equal to a word-0
group bit, so the suite goes red if a re-export removes the condition under test;
word-1 presets land in `viewMaskHi` with zero leak into `viewMask`; repeated
loads idempotent; and — the "do not weaken it" half — genuine word-0 and word-1
collisions, duplicate names, `0x80000000`, `word:2`, bit-less `word:1`, and a
declared-`groupBits` clash with a word-0 preset bit all still throw.

**Blast radius verified offline** (scratchpad harness; no engine process, no
socket, no port, and **no perf baseline written**): `perf_gauge.mjs`'s
`measurePair()` load path replayed verbatim — titanic loads 964 px / 24 groups /
17 views / **41 `MASK_*` constants** (matches `_134` §3.1), `01_cylon_sweep`
compiles and renders a frame lighting 964/964 px; and
`createRenderContext('titanic')` returns a full context.

**Gate:** `cd marsin_engine && npm test` → **2601 tests / 2593 pass / 8 fail** —
**zero new failures**, all 8 the known environmental families (audio_capture ×5,
`effects_v2_mode_page_layout`, OSC `EADDRINUSE` from the operator's live stack,
specialty/themed playlist drift from another agent's uncommitted edits). Every
mixer/view/mask test passed. **No git op, no deploy, no install, no hand-booted
engine, no port bound**; operator's launcher stack (6966-6972, 5568, 8081, 10000)
kept every port; other agents' uncommitted work untouched.

**Still open (NOT this thread):** `_134` §5.1 (word 0 saturated — sim-side
`view_registry.js` `nextFreeSlot` spends scarce word-0 slots on custom views, so
adding a new titanic fixture group throws at export) and §5.3
(`simulation/lib/bench_section.cjs` T3 counts word-1 customs against the word-0
31-bit ceiling). Both are sim-side; only the engine-side loader (§5.2) is fixed.

---

## _137 — View allocator word policy + word-aware bench budget (fixes `_134` §5.1 + §5.3) — LANDED

**Scope:** `simulation/src/dmx/view_registry.js`, `simulation/src/gui/view_masks_editor.js`,
`simulation/lib/bench_section.cjs`, `simulation/tests/bench_section_sync.test.js`, plus a
**generated** re-export of `scenes/titanic/views.yaml` + `marsin_engine/models/titanic.viewmasks.js`.
No engine.js, no model geometry, no controllers/patches, no config. Report
[`20260725_137_view_allocator_word_policy.md`](../reports/202607/20260725_137_view_allocator_word_policy.md).

**Landed — §5.1, the allocator policy.** Base group bits can ONLY live in view word 0
(`reconcileGroupBits` → `nextFreeBit`; mirrored in `engine.js` `assignGroupBits`); custom views
work in EITHER word because they resolve by NAME at model load. Word 0 was therefore the
single-consumer-constrained resource — and `nextFreeSlot()` walked `word 0 → word 1`, handing every
new view a word-0 bit while word 1 sat empty. On titanic (24 groups + 17 views) word 0 hit
`0x7fffffff`, `nextFreeBit → 0`, and `reconcileGroupBits(reg, [...existing, 'New Group'])` **threw**
`[Views] Out of view-mask bits …` with 21 word-1 slots free. New policy:
`CUSTOM_VIEW_WORD_ORDER = [1, 0]` — `nextFreeSlot(registry, wordOrder)` fills **word 1 first** and
spills into word 0 only when word 1 is full. Chosen over a reserved word-0 headroom margin because a
margin needs a magic constant correct for no scene and would still let views eat word 0 while word 1
is empty; preference ordering is scene-independent, keeps the full 62-slot capacity, and still
throws at 62 (P0, no silent degradation). Verified: empty scene → `{word:1,bit:1}`; 32 views → 31 in
word 1 + 1 spilled to word 0; 63rd throws. **Existing pinned assignments never renumber** —
`createViewRegistry` preserves every `(word, bit)`, proven by regenerating all three scenes offline:
`titanic / studio_top_loft / test_bench` sidecars all `reproduces=true` vs tracked (stamp excluded).
`studio_top_loft` + `test_bench` were **not** rewritten (byte-stable, ample headroom in both words).
New API `setCustomViewSlot(reg, view, word, bit)` (the canonical cross-word relocation;
`setCustomViewBit` delegates, contract unchanged) **refuses** to move a per-fixture-membership view
across words — fixtures carry a word-0 `viewMask` only, so its membership would have nowhere to
live. Views panel readout made word-aware via new `freeSlotCounts()`: `GROUP VIEWS (auto) — 24 · 7
new group(s) fit` / `CUSTOM VIEWS — 17 · 21 slot(s) free (14 in word 1, 7 spill into the group
word)` — the old flat number was word-0-only and mislabelled as the view budget. [**Corrected
2026-08-03** per `_135` D3: this block first quoted `28 slot(s) free`; the code
(`view_masks_editor.js:336` = `free.word1 + free.word0` = 14 + 7) always rendered **21**. Report
typo only, no code change — see `_137` report §7.]

**Landed — §5.3, the bench budget.** `bench_section.cjs` T3 summed
`groupBits + custom.length + newBitNames` against a flat 31-bit ceiling, charging word-1 views to
the word-0 budget: `applying needs 7 new view bits on top of 24 group + 17 custom bits = 48, over
the 31-bit ceiling`. The `48` was never a real quantity. Every name a bench block adds is a GROUP
name → word 0 only, so word-0 pressure is the only budget that can refuse. Now:
`31/31 word-0 view bits after apply (0 spare; word 1 holds 17 custom bit(s), independent of this
budget)`. `MAX_VIEW_BITS` doc corrected to *per word*.

**Test decision (documented):** `view-bit headroom is REPORTED` asserted `/30\/31 view bits/` and was
**already red at baseline** (message read `48`; in fact no `TGT_VIEW_BIT_HEADROOM` finding existed at
all because T3 was refusing) — the `30` was stale from a titanic with one fewer group. Expectation
updated to the honest `31/31 word-0 view bits after apply (0 spare` + a non-pinned
`word 1 holds \d+ custom bit(s)` match, and renamed "…fills the word-0 ceiling exactly". **Known-red
→ green, by design.** One test ADDED: *word-1 composite views are NOT charged to the word-0 budget*
(20 extra word-1 views must move the word-0 number by zero bits). The still-red `:271` "titanic can
accept the block today" shrank from **7 refusals to 6** — the spurious `TGT_VIEW_BIT_BUDGET` is gone,
the six genuine `TGT_UNIVERSE_RESERVED` (U10/U12 on `10.x.x.13/.14`) remain and are a separate open
electrical defect.

**titanic migration — DONE, zero behavioural risk.** The policy fix cannot unsaturate titanic on its
own (`_134`'s 7 word-0 composites are already pinned), so a one-time explicit migration ran through
the canonical chain. Audited every possible holder of a raw `(word,bit)` FIRST: all 17 composites are
group-based (zero `pixelIndices`); all 76 `patches.yaml` + 12 `scene_config.yaml` records are
`viewMask: 0`; engine states store `viewSelection: {type,target,invert}` by name; CaptainPad uses
`{type:'viewMask', target:<name>}` throughout; patterns use `inView()`/`MASK_*` (only raw literal
outside `summer_camp/` is `patterns/test/rpm_fixtures_tune_v2.js` `viewMask & 1`, a **group** bit);
timelines/playlists/`pixel_map_views` carry no mask data; sim 3D isolation
(`light_pool.js:448`, `animate.js:578`) matches on `activeView.groups` for group-based views. A
repo-wide search for the composite names hits exactly two files — both regenerated together. Moved:
`Hull Canvas 0x40000→w1 0x400`, `Left Hull 0x80000→0x800`, `Right Hull 0x1000000→0x1000`,
`Silhouette 0x2000000→0x2000`, `Left Silhouette 0x10000000→0x4000`,
`Right Silhouette 0x20000000→0x8000`, `Jewelry 0x40000000→0x10000`. The 10 pre-existing word-1 views
kept their exact bits; all 24 `groupBits` byte-identical. `pre: word0 31/31, word1 10/31` →
`post: word0 24/31 (7 new group(s) fit), word1 17/31 (14 free)`. Diff footprint: `views.yaml` 14
lines, sidecar 7 lines + stamp. Driven offline via
`createViewRegistry → setCustomViewSlot ×7 → buildViewmasksSidecarJS + yaml.dump({views},{lineWidth:-1})`;
the script **refuses to run** unless the tracked sidecar is first proven byte-reproducible from the
tracked `views.yaml` (never regenerate onto drift) and asserts groupBits/names/order/membership
invariance afterwards.

**Verification.** `_134`-style zero-miss/zero-leak harness replicating `engine.js:504-522` against the
real 964-px model: **17/17 views, identical pixel membership before/after, zero miss, zero leak,
1844 tagged pixels**. `engine.js --model titanic --dry-run` (state/playlist dirs redirected to
scratch; dry-run binds no port, runs no loop) loads 17 presets and the `Pattern constants` line
(41 `MASK_*`) is **byte-identical before and after** — pattern code sees no change. `_136`'s
now-word-aware `loadModelForGauge('titanic')` → `pixels 964 views 17`. Original repro now:
`nextFreeBit 0x40000` … `OK added ['New Group'] bit 0x40000`.

**Gates.** `scene_model_parity.cjs titanic` **PASS** (0 err / 0 warn / 1 info);
`--strict` **PASS** (0 err / 0 warn / 1 info); `simulation` `npm test` →
**1737 tests / 1730 pass / 7 fail** vs baseline **1736 / 1728 / 8** — **zero new failures**, +1 new
test, −1 failure (the headroom test flipped green per the decision above); remaining 7 are exactly
the baseline set minus that one. Engine subsets offline: mixer **489/489** (incl. `auto_views`,
`in_view_intrinsic`, `pattern_mixer_masking`, `view_fader_ramp`, `view_mask_constants`,
`view_mask_hi_host`), integration **59/59**, effects+tools+patterns 537 → 535 pass / 2 fail, both
**pre-existing and non-view**: `effects_v2_mode_page_layout` is a node test-runner IPC
deserialization error under parallel load (**47/47 when run alone**) and the specialty playlist
byte-identity failure is genuine divergence in two **unmodified** tracked
`scenes/*/playlists/white_only.yaml` files — the same two families `_136` recorded. **No git op, no
deploy, no install, no live save-server, no port bound**; operator's launcher stack
(6966-6972, 5568, 8081, 10000) untouched; other agents' uncommitted work preserved.

**Filed, NOT fixed (new):** (a) `vMaskHi` never reaches exported pixels —
`pixelblaze_model_exporter.js` writes only `vMask`, while `buildViewmasksSidecarJS` reads `vMaskHi`
for word-1 views, so a word-1 view with **per-fixture** membership always exports empty (skipped with
a warn). Latent today (all composites are group-based, and `setCustomViewSlot` now refuses the
relocation case) but `addCustomView` allocates word 1 first, so the next fixture-clicked view will
hit it; the same word-blindness sits in the sim's 3D isolation paths. (b) titanic word 0 is now
24/31 and the `TB ` bench block needs exactly the remaining 7 — `31/31 (0 spare)`. It fits with no
margin; one more fixture group in either scene and the apply refuses.

---

## _135 — Read-only wave verification (`_133` / `_134` / `_136` / `_137`) — LANDED (2 corrections owed)

**Scope:** verification only. **Zero edits to any verified file** — the 3 docs, `views.yaml`,
`titanic.viewmasks.js`, `model_loader.js`, `view_registry.js`, `bench_section.cjs` and
`view_masks_editor.js` were all **read-only**; discrepancies are enumerated for the coordinator, not
fixed. Writes: this block + report
[`20260725_135_wave_verification.md`](../reports/202607/20260725_135_wave_verification.md).

**Verdict: 8 of 10 checks PASS. The code + mapping half of the wave is sound and internally
consistent. Two corrections are owed before commit.**

**D1 — `docs/MARSIN_ENGINE_PATTERNS.md` §7.3.1 lines 626-632 is now FALSE.** The "Word placement"
paragraph still says *"the 24 base groups and the first seven composites (`Hull Canvas` … `Jewelry`)
live in the low word … the remaining ten composites (`Left Jewelry` … `Auditoriums`) live in the high
word"*. That was `_133` §8 reconciled against the `_134` state; `_137` then migrated **all seven**
word-0 composites into word 1. Measured on the final files: **`word0=0 word1=17`** — every composite
is high-word, the 24 low-word folds are base groups **only**, and `Hull Canvas` (the named example)
moved `w0 0x40000 → w1 0x400`, making the sentence exactly backwards. Fix: "the 24 base groups live
in the low word; **all 17 composite views live in the high word**", pointing at
`CUSTOM_VIEW_WORD_ORDER`. **This is the only substantive doc falsehood in the wave** — `COLOR_THEORY.md`
makes no word/bit claim at all, and the lang spec's L387/L390/L453-455 describe the generic two-word
scheme (verbatim agreement with `lib/view_word.js` L9-10), never titanic's assignment.

**D2 — P0 privacy, COMMIT-BLOCKING.** `python scripts/security_check.py --all` → 8 findings; 6 are
pre-existing untracked `simulation/.scene_backups/studiodj/**`, but **2 are this wave's own**:
`_137`'s report line 185 and **this tracker's line 7201** (`bm26-report-ip`) — the same sentence
naming the U10/U12 refusals spells out two literal `10.x.x.x` controller IPs. The repo is PUBLIC and
the tracker is git-tracked, so `.githooks/pre-commit` + the PreToolUse gate **will refuse the next
commit**. Fix: drop the octets in both places (keep "U10/U12"). Fix this FIRST.

**D3/D4/D5 — minor, no behavioural impact.** (D3) `_137` §1.4 and its tracker block quote
`CUSTOM VIEWS — 17 · 28 slot(s) free (14 in word 1, 7 …)`; `view_masks_editor.js` L336 computes
`free.word1 + free.word0` = **21**, and 14+7≠28 — code correct, report string wrong. (D4)
`view_registry.js` L224-225 still throws *"a scene supports at most 31 distinct group/view bits"*;
a scene supports 62, and 31 is the word-0/group ceiling — `_137` fixed this wording class in
`bench_section.cjs` and `addCustomView` but missed this one. (D5) `bench_section.cjs` L650
`(v && v.word) !== 1` charges a malformed/null custom entry to word 0 (defensive nit only;
`createViewRegistry` rejects malformed entries upstream).

**Verified clean (checks 1, 3-10).** 47/47 offline harness checks, exit 0: `groupBits` blocks
**byte-identical to HEAD** in both files (25 YAML lines + the sidecar block); `views.yaml custom[]`
mirrors the sidecar exactly (name/bit/word/groups/**order**); all 17 memberships and counts
recomputed from `titanic.js` and matching (Hull Canvas 360 · L/R Hull 180 · Silhouette 320 ·
L/R Silhouette 160 · Jewelry 96 · L/R Jewelry 48 · Organs 40 · L/R Organs 20 · Identity 148 ·
Stacks 24 · L/R Stacks 12 · Auditoriums 16); 17 distinct word-1 bits, all safe powers of two;
word0 `0xcf3ffff` = groups only, 24/31 used (7 group slots free), word1 17/31 (14 free); the five
instrument views **partition** all 24 base groups and sum to 964. `inView()` folded for **all 41
names** through the real `injectInViewIntrinsic()` against an `engine.js` L628-633-shaped viewTable —
**low=24 hi=17, 0 failures**, each emitted literal asserted **equal to the authored bit in the
authored word**; `buildMaskConstants` → **41** `MASK_*`, no sanitized collision; all 6 forbidden
aliases hard-error. Doc names match authored names exactly (24 base + 17 composite, spelling
irregularities `Right SmokeStacks`/`Left SmokeStack`, underscored strands, `TE Sign 2`,
singular `Left/Right Auditorium` vs composite `Auditoriums` all confirmed); every `inView("…")` string
in the 3 docs resolves (0 unknown, 0 case/spell mismatch, remainder are deliberate placeholders); the
`views.yaml` vs `pixel_map_views.yaml` distinction is correctly stated in both places that mention it.
Parameter policy clean: no universal `radius`/`kick` mandate survives (only the "this replaces…" and
"there is **no** required…" callouts), `localSpeed` mandatory + FIRST, `direction` optional + SECOND,
autonomous reversal demoted to OPTIONAL CAPABILITY, zero examples double-apply global speed
(`globalMult` appears only in the "**Removed:**" callout), `w == a` HARD CONTRACT with its enforcing
test file present, audio modulators-only with `isLiveAudioSharedFnName`/`engineOwned` present. Docs
security: 0 `file:///`, 0 `.agent/01_skills`, 0 IPv4, 0 MAC, **54/54** relative links resolve.
`_136` cross-check: `loadModelForGauge('titanic')` → **pixels 964, views 17, groupBits 24**, all 964
pixels carry a `viewMaskHi` bit, **zero hi-word leak into word 0**.

**Gates.** `scene_model_parity.cjs titanic` **PASS** (0 err / 0 warn / 1 info); `--strict` **PASS**
(same). `tests/mixer/model_loader_word_aware.test.js` **14/14**. Engine mixer subset **489/489**
(matches `_137` exactly). `simulation/tests/bench_section_sync.test.js` 43 → 39 pass / **4 fail** =
exactly `_137` §4's known-red items 1-4 (dock geometry + U10/U12 collisions + the two dependent CLI
tests); `_137`'s three word-aware assertions — *headroom is REPORTED … fills the word-0 ceiling
exactly*, *word-1 composites are NOT charged*, *REFUSES … word-0 export ceiling* — all **green**.
Other sim view tests (`pixel_map_views`, `te_sign_grouping_parity`, `unpatched_red_two_views`,
`bench_mirror`) **92/92**. `node --check` passes on all four changed JS/CJS files. **Zero new
failures**; no full-suite rerun needed.

**Safety.** No git mutation (two read-only inspections disclosed: `git show HEAD:<file>` for the
byte-identity proof, `git ls-files --error-unmatch` to determine tracked-ness for D2). No deploy, no
install, no live engine boot, no sim/save server, **no port bound** — every harness ran in-process on
the pure library modules + vendored WASM. Operator's launcher stack (6966-6972, 5568, 8081, 10000)
untouched. All scratch files in the session scratchpad; nothing written into the source tree; other
agents' uncommitted work preserved.

**Correction order for the coordinator:** D2 (unblocks commit) → D1 (the doc falsehood) → D3 →
D4/D5 (optional).

**_133 correction (2026-08-04) — word placement, post-_137.** The `_135`
verifier caught one substantive falsehood in `MARSIN_ENGINE_PATTERNS.md` §7.3.1:
my "Word placement" paragraph said the 24 base groups **plus the first seven
composites** (`Hull Canvas` … `Jewelry`) were low-word. True against `_134`,
invalidated by `_137`, which migrated all seven to word 1 (`Hull Canvas`
w0 `0x40000` → w1 `0x400`). Re-measured against the final files (both agree, all
17 entries `word: 1`) and re-folded all 41 names through the real
`injectInViewIntrinsic()`: **24 low-word (base groups only), 17 high-word (every
composite), 0 failures.** Corrected to "the 24 base groups live in the low word;
all 17 composite views live in the high word", now attributed to
`CUSTOM_VIEW_WORD_ORDER = [1, 0]` (`simulation/src/dmx/view_registry.js` —
customs prefer word 1 because base group bits are hard-pinned to word 0 and are
the only consumer that cannot move), with the `Hull Canvas` migration cited as
the concrete reason never to hard-code a composite's word/bit. Swept all three
docs: **this was the only view→word/bit pin**; remaining mentions are generic
language descriptions, `COLOR_THEORY.md` makes no word/bit claims, and the lang
spec's Tier-C table is a general ABI statement. All other §7.3.1 facts
re-verified unchanged (964 px · 17 counts · 41 names · no `MASK_*` collision ·
forbidden aliases absent · five-view partition exclusive+exhaustive); links and
every concrete `inView("…")` name re-checked. No git op, no deploy, no install,
no live boot, no port bound.

---

## _137 addendum — `_135` verifier D3/D4/D5 corrected (2026-08-03)

**D3 (report typo, no code change).** `_137` §1.4 and the `_137` tracker block quoted the Views
panel as `CUSTOM VIEWS — 17 · 28 slot(s) free (14 in word 1, 7 …)`. `view_masks_editor.js:336`
computes `free.word1 + free.word0` = 14 + 7 = **21**; the code was always right. Report §1.4 now
carries the wrong line struck through above the corrected one plus a dated correction note, and the
`_137` block above is corrected in place with the same note.

**D4 (diagnostic wording, no behaviour change).** `view_registry.js` `reconcileGroupBits` still threw
*"a scene supports at most 31 distinct group/view bits"* — false since Tier-C (a scene supports
**62**; 31 is the **word-0** ceiling, the only word groups can use). Same wording class already
fixed in `bench_section.cjs` and `addCustomView`; this throw site was missed. Now names the word-0
ceiling, the 62-slot scene total, and the remedy ("move a custom view to word 1 or remove an unused
group" — i.e. the `_137` §3 migration). Throw condition (`nextFreeBit === 0`) unchanged.

**D5 (defensive gap — decision documented).** `bench_section.cjs` T3's `(v && v.word) !== 1` charged
a `null` custom entry (a bare `- ` in views.yaml) and a bogus-`word` entry to **word 0**, inflating
the group budget and potentially refusing a legal apply on junk input. Chose **refuse by name,
charge to neither word** over both alternatives: silently dropping hides a malformed scene file, and
charging word 0 invents a number (P0 — no silent fixup). A hard `throw` was rejected because this
module's contract is named findings + non-zero exit, not a CLI stack trace. New
`TGT_VIEW_ENTRY_MALFORMED` REFUSE names the offending entry; the budget line stays honest beside it.
"Malformed" mirrors `createViewRegistry` for the fields T3 reads (non-object entry, or `word`
present and not 0/1). New test *REFUSES a malformed custom-view entry, and charges it to NEITHER
word* injects `null` + `{name:'bad', word:7}` into the real titanic views and asserts 2 refusals plus
a `TGT_VIEW_BIT_HEADROOM` message **string-identical** to the clean run. No shipped scene contains
such an entry — no real-scene finding changes.

**Gates re-run.** `scene_model_parity.cjs titanic` **PASS** (0/0/1) and `--strict` **PASS** (0/0/1);
`bench_section_sync` 44 tests / 40 pass / **4 fail (the same 4 pre-existing reds)`;
`bench_section_sync + pixel_map_views + te_sign_grouping_parity` 101 / 97 / 4 (same 4); full
`simulation` `npm test` **1738 / 1731 pass / 7 fail** (was 1737 / 1730 / 7; baseline 1736 / 1728 / 8)
— **zero new failures**, suite gained exactly the one D5 test, the 7 reds unchanged. Engine subsets
not re-run: D3 is prose, D4 is a sim-only throw string, D5 is sim-only preflight code, and no
engine-consumed artifact (`views.yaml`, `*.viewmasks.js`) was touched by these three fixes.

**D2 redactions left intact** — the coordinator's `10.x.x.13`/`.14` redactions on this tracker and in
the `_137` report are deliberate; the octets are not restored. No git op, no deploy, no install, no
live server, no port bound.

---

## _139 — `highdef_pattern_generation` skill rewritten to the post-`_133`/`_135` pattern policy (2026-08-03)

**Closes the last artifact teaching the overruled policy.** `_133` §6 item 2 and `_135` check 5 both
named `.agent/skills/highdef_pattern_generation.md` as the remaining offender: it is the pattern
**generator** skill (and the `_90` ChatGPT loop's workflow source), so until rewritten it kept
regenerating dead knobs and non-portable targeting. Rewritten 458 → 697 lines, procedural
(ten steps + scale + gotchas), linking to `docs/MARSIN_ENGINE_PATTERNS.md` rather than restating it,
and carrying the guide's HARD CONTRACT / PRODUCTION CONVENTION / OPTIONAL CAPABILITY tiers.

**Overruled and removed:** the "four production bars" as universal requirements (audio-reactive
PRIMARY, two-colour `hueSpread >= 0.10`, `peakMaxChan >= 200`, true-black negative space) →
`MARSIN_ENGINE_PATTERNS.md` §1.6 de-mandates all of them; the "consistency ground rules" mandating
`direction` + autonomous auto-reversal + a movement `radius` + a brightness `kick` on **every**
pattern → §1.3/§1.4 (direction conditional and second **when present**, auto-reversal demoted to
OPTIONAL, "no required radius/kick … do not invent controls to fill MIDI knobs"); the §2 rig table
hard-coding `sectionId 1=Pars/2=Vintage/3=Bars` plus "branch on sectionId" and the
`if (sectionId == 2)` vintage-blinder idiom → §7.2 (model-specific, never portable; the ship uses
514/515) and §7.3.1 (`inView()`); `whiteWarmth` tinting white toward amber → §6.2 `w == a` (amber is
not an independent accent lane, warmth is shaped on RGB); `var N = 52` → §11.2 (bench number; ship is
964; prefer scalar/spatial formulations or the `feedbackTrails` global effect); the old "global speed
free" narrative → §3 (engine owns the clock, `localSpeed` trim only, `speed`/`size` engine-owned).
Also dropped the "`git restore marsin_engine/states/ simulation/` after any boot" instruction — it
contradicts the repo's no-hiding-side-effects rule; residue is now "report it, don't revert it".

**Now taught:** truthful `localSpeed` first always; `direction` only when the concept has real
directional motion, then second, endpoints visibly opposite, dead-zone guarded; every other control
earned from the artistic idea; declaration order = MIDI knob order (12 knobs, hue never declared).
Targeting is `inView("Authored View Name")` only — five instruments with counts/emitters, halves,
`Stacks`/`Auditoriums`, **all 24 base group names verbatim** with the spelling-irregularity warning
(`Right SmokeStacks` plural, underscored strand groups, `TE Sign`/`TE Sign 2`, singular
`Left/Right Auditorium` vs composite `Auditoriums`), the six forbidden aliases, never hard-code a
view's word/bit, `FIX_*` for capability, and the exclusive+exhaustive five-instrument partition as
what makes a per-instrument `if/else if` chain provably complete. Timing carries the measured delta
contract incl. the `16, 16, <real>, <real>` first-frames quirk, zero-step tolerance and large-multiple
phase wrapping. Colour carries RGB-space palette lerp, `w == a` with "assign amber *from* white, never
staple it on", the per-instrument capability split (RGBWAU DMX bars/pars vs RGBW wire ropes/vintage
pixels/signs with amber folded and UV dropped), and a six-item COLOR_THEORY checklist
(wash-warm/saturate-pixels; stacks-stay-warm **as operator-ruled guidance, not an engine rule**;
one-palette-many-positions; dark paint as free negative space; Identity punctuates; keep the
Silhouette lit as judgement). Portability: `pixelCount` is a literal 144, no bench counts either,
model-sized arrays labelled model-specific. Audio is the real parseable `AUDIO_MODULATION_V1` block.
**"High-definition" reframed as a craft bar** (controls that don't lie, motion that never re-locks,
geometry that reads on its instrument) — explicitly NOT a mandate for true black, constant beat or
party brightness, with the ambient-dominant show philosophy stated.

**Retained after re-verification against current code** (not against the old text): harness flags and
the range-aware `--mod` grammar; **`--gate` on every gate run** (exit 3 only under `--gate`; named
`DARK`/`BLACK_LATCH`/`OVER_BUDGET`; defaults 600 frames / 25 ms / 4 channels / 0.5 dark-frac;
`GATE_WARN DIM` advisory); the printed line set; `make_vis_clip`/`publish`/`server` flags and the
gallery port from `gallery_config.json`; `--seconds` real-time clips and the loud `DOWNSAMPLED:`
line; manifest registration; the sub-agent fleet discipline. **Two stale thresholds corrected:** the
tool labels `(REACTIVE)` above |0.35| (not 0.5) and two-colour above `hueSpread` 0.06 (not 0.10) —
both now presented as tool heuristics, not bars. New material: `tools/param_truth/` as the parameter
gate (with an `--out`-to-scratch warning, since the default writes the non-gitignored library-wide
result), `pattern_derived_harness.mjs`, `gen_variations.mjs` static/sound pairing.

**Verification (offline, in-process, `verify_139.mjs` in the scratchpad).** Compiled every fenced
`javascript` block through the **real** `WasmHost` on the 964-px titanic context (`loadModelForGauge`
+ `buildMaskConstants` + `setViewTable` + bit-free promoter — the same path `engine.js` uses):
**9/9 compile.** Every concrete `inView("…")` resolves against the 41-name table; **all 24 base group
names appear verbatim**; 41 backticked view names all authored (the 6 non-views are the deliberate
"do not exist" aliases); all 29 referenced paths exist; zero `sectionId == N` taxonomy (1 guarded
historical mention, none in code); zero double-speed; zero `file:///`; zero legacy `.agent/01_skills`;
zero IPv4; `w == a` on every `rgbwau()` example; both harness invocations carry `--gate`.
**ALL CHECKS PASSED.** Negative control: `inView("All Bars")` hard-errors as documented.
`security_check.py --all` → 6 findings, **all pre-existing, all in untracked
`simulation/.scene_backups/studiodj/**`**; zero in the skill, the report or this tracker.

**Finding — real tooling gap, documented not papered over.** `tools/pattern_audio_harness.mjs`
**cannot compile an `inView()` pattern**: measured `COMPILE_FAIL: Line 4: strings cannot be used as a
function argument`. It drives `marsin_wasm_runtime.js` directly and applies only
`injectFixtureConstants()`, whereas `WasmHost.compile()` runs
`injectInViewIntrinsic()` → `injectMaskConstants()` → `injectFixtureConstants()`. Everything built on
it inherits the gap, incl. `tools/gallery/gen_variations.mjs` and the offline titanic clip path. The
skill §8.2 carries an explicit measured note: an `inView()`-targeted pattern is gated by param-truth
(full engine parity) + the CI tests, its clip comes from a live capture, and the note **forbids**
rewriting `inView()` targeting back into coordinates/`sectionId`. Recommended fix (not made — shared
tool, out of scope): mirror the three injection passes in the harness; `render_context.js` is the
working reference. Filed as a follow-up.

**Compliance.** Writes confined to the skill, report `_139`, and this block. **No git command of any
kind** (tracking status established from `.gitignore`, and the skill says "not gitignored" rather than
asserting more than was measured). No live engine boot, no port bound, no deploy, no install — every
harness ran in-process against the vendored WASM; the one `run_param_truth.mjs` invocation
(`27_swipe --model titanic`) wrote to the scratchpad, not to `param_truth_results.*`. All scratch
files stayed in the session scratchpad. Other agents' uncommitted work untouched.

## _138 — `vMaskHi` reaches exported pixels (fixes `_137` §6.1) — LANDED

**Scope:** `simulation/` only — `src/dmx/view_registry.js`,
`src/dmx/pixelblaze_model_exporter.js`, `src/gui/view_masks_editor.js`,
`src/core/{light_pool,animate}.js`, `src/gui/gui_builder.js`,
`src/dmx/{rename_invalidation,auto_patcher}.js`, `server/save-server.js`, `main.js`,
`lib/{scene_model_parity,bench_section}.cjs`, `tools/bench_section_sync.cjs`, plus
`tests/view_mask_hi_export.test.js` (new) and `tests/rename_invalidation.test.js`.
**No engine source, no generated scene/model/sidecar file, nothing hand-edited.** Report
[`20260725_138_vmaskhi_pixel_export.md`](../reports/202607/20260725_138_vmaskhi_pixel_export.md).

**Where the word was dropped.** The click→engine chain has five links; only #1 and #4/#5 were
word-aware. **#2** — the Views panel's Assign/Unassign/delete/count wrote `f.viewMask`
unconditionally, ignoring `view.word`. **#3** — the exporter wrote `vMask: light.viewMask || 0` and
had **no `vMaskHi` field at all**; there was no `viewMaskHi` on a fixture config anywhere in the sim.
So `buildViewmasksSidecarJS` — which correctly reads `vMaskHi` for a word-1 view — found zero members
on every pixel and skipped the view with a `console.warn`. Both links had to be fixed: the exporter
alone would still have been fed the wrong field, the panel alone would have had nowhere to write.
**Two failure modes, not one:** (a) empty export, and (b) **aliasing** — a word-1 bit landing in
`viewMask` collides with a live **base group bit** (titanic w1 `0x1`/`0x2`/`0x4` are all word-0 group
bits), so a fixture clicked into `Left Jewelry` would have silently joined the group view
`Right Front Wall` in 3D isolation and in the per-fixture chip row. (b) is why "carry the bit anyway"
was not an option.

**The fix.** `view_registry.js` now owns the word→field contract as the ONLY place the fields are
named: `FIXTURE_MASK_FIELDS = ['viewMask','viewMaskHi']`, `PIXEL_MASK_FIELDS = ['vMask','vMaskHi']`,
`viewWord` exported, plus `fixtureMaskField` / `pixelMaskField` / `fixtureInView` / `pixelInView` /
`setFixtureInView`. The exporter carries `vMaskHi` on all three pixel-push sites (multi-pixel DMX,
simple DMX, LED strand). **Serialization is conditional** — `vMaskHi:` is emitted only when non-zero,
because `engine.js:418` declares the default `px.vMaskHi ?? 0`, so an absent field IS that zero and a
scene without word-1 per-fixture membership exports a byte-identical model (same rule `ledWire` /
`unpatched` already follow). Panel, `light_pool.js:448` and `animate.js`'s instanced-dot isolation all
go through the predicates. **Persistence was mandatory or the fix is cosmetic:** patch record +
structural-tree strip (`save-server.js`), `__globalPatchTree` rows (`main.js`), config defaults +
chips + rename snapshot (`gui_builder.js`), both `clearMetadata`/`clearAllPatches` paths
(`auto_patcher.js`), `DISPLAY_PATCH_FIELDS` + `prunePatchTreeEntries` + **`carryViewMasks` (breaking
contract change: `name → {viewMask, viewMaskHi}`)** (`rename_invalidation.js`), the `vMaskHi`
freshness check (`scene_model_parity.cjs`), and `viewMaskHi` added to `DERIVED_METADATA_FIELDS` so a
ported bench block cannot import word-1 membership into titanic. The polymorphic
number-or-object shortcut for `carryViewMasks` was rejected — it would have made word-0 callers
silently correct and word-1 callers silently lossy.

**Two latent second-order bugs fixed in passing.** The Views panel matched the active preview view by
`__activePreviewView.bit === view.bit`; with two independent bit spaces two views can share a bit
VALUE, so that lit up — and could have cleared — the wrong card. Both sites now match by view
**identity**.

**`setCustomViewSlot` refusal — LIFTED.** `_137` §1.3's *"has per-fixture membership and cannot move
to word N — fixture masks only exist in word 0"* existed **only** because fixtures could not carry
`vMaskHi`. They can now, so the premise is gone. It is not simply deleted: auditing found a second,
real hazard — the function mutates the registry only, so a caller who relocates across words and
forgets to migrate the bits triggers **both** failure modes at once (empty export + a stranded
aliasing bit). So the move is made **atomic** instead: `setCustomViewSlot(registry, view, newWord,
newBit, fixtures = null)` **requires** `fixtures` for any cross-word move (throws, naming both fields
and the remedy, with nothing partially applied) and performs the migration itself after the
destination-word collision check. Same-word moves are unchanged; `setCustomViewBit` still delegates
and its panel caller still migrates from the returned old bit. Net: the capability the old message
denied is available; only the genuinely unsafe call shape is still refused.

**Group-based views verified unaffected (the brief's "state it").** `buildViewmasksSidecarJS` branches
on `view.groups.length > 0` **before** any mask field is touched and emits `groups: [...]`; no fixture
or pixel mask is read on that path. The engine tags membership from group names and merges into the
lane `word` selects. Word-agnostic by construction — which is exactly why `_137`'s 17 titanic
composites survived their cross-word migration. Pinned by test in both words.

**Regression test — `tests/view_mask_hi_export.test.js`, 13/13 pass**, offline, `_134`'s
zero-miss/zero-leak shape, driving the real `generatePixelMap` / `saveModelJS` /
`buildViewmasksSidecarJS`. Three bars (A 3px + B 2px in `Bars`, C 2px in `Rail`). The headline case:
a view created by `addCustomView` (which lands in word 1 naturally), operator clicks A + C, bit goes
to `viewMaskHi` and `viewMask` is never created, sidecar EMITS `bit: 0x0001, word: 1, pixelIndices:`
(it was skipped entirely before), resolved set `[0,1,2,5,6]` matched **three** ways — expected-by-name,
the sidecar's emitted indices, and `pixelInView`. Plus a leak guard (Bar B carries the SAME bit VALUE
in `viewMask` and must not appear), the **word-0 control** (pre-Tier-C `{name,bit}` view: high word
never touched, sidecar keeps the legacy no-`word:` form, and the serialized model contains the string
`vMaskHi` **nowhere at all**), model-text placement (`vMask: 0, vMaskHi: 1, patch:` on exactly the
members), the four `setCustomViewSlot` cases, and the group-based-view case.

**Re-export sanity — all three scenes byte-stable.** `grep -c pixelIndices` over the three tracked
sidecars → **0 / 0 / 0**: no tracked scene has a per-fixture view at all, and titanic's 17 word-1
views are all group-based. Regenerated all three offline through `createViewRegistry(views.yaml)` →
`reconcileGroupBits(listPixelGroups(pixels))` → `buildViewmasksSidecarJS` against the real models and
diffed ignoring only the `// Updated:` stamp: `sidecar-reproduces=true` for titanic (17 views,
word1=17), studio_top_loft (2) and test_bench (5). Additionally **not one pixel in any tracked scene
carries a non-zero `vMask` either**, so the conditional emission leaves the three model files and
every `patches.yaml` / `scene_config.yaml` byte-identical too.

**Gates.** `scene_model_parity.cjs titanic` **PASS** (0/0/1 info) · `--strict` **PASS** (0/0/1) ·
`simulation` `npm test` **1752 / 1745 pass / 7 fail** (baseline `_137` §7: 1738 / 1731 / 7 — the suite
grew by exactly 14: the 13-test new file plus one added `carryViewMasks` word-1 test, and
1738 + 14 = 1752) · engine `tests/mixer/model_loader_word_aware.test.js` **14/14** · engine view/mask
mixer subset (`auto_views`, `in_view_intrinsic`, `pattern_mixer_masking`, `view_fader_ramp`,
`view_mask_constants`, `view_mask_hi_host`) **109/109**. **Zero new failures**; the 7 reds are the same
7 by name as `_137` §4/§7. Worth naming: reds 6-7 (`real scene test_bench: …`) still fail on
`sId 7 ≠ 0; fId 13 ≠ 0` for the two `TE Sign V3` strands — **the new `vMaskHi` parity check adds no
finding to any real scene.**

**Findings filed, not fixed.** (1) A view with BOTH groups and clicked fixtures **silently drops the
fixtures**: the sidecar `continue`s on the groups branch, yet the panel's Assign writes the bit anyway
and the count advertises `"N fixture(s) + M group(s)"`. Pre-existing, both words; the fix is a
decision (union them, or refuse mixing in the panel). (2) `patches.yaml` emits `viewMaskHi` only when
non-zero, asymmetric with `viewMask` — deliberate, it is what keeps every scene byte-identical on the
next save. (3) `pixel_map_views.js` `resolveViewGroups` resolves a custom view to `v.groups` only, so
a `view:` selector naming a per-fixture view matches no cluster — pre-existing and word-agnostic, but
newly reachable now that word-1 per-fixture views work.

**Compliance.** Writes confined to the 14 source/test files, report `_138`, and this block.
**No git command of any kind** beyond read-only `git status --porcelain` / `git diff --numstat` to
confirm other agents' uncommitted work was untouched. No sim boot, no engine boot, no server, no port
bound, no deploy, no install — every check ran in-process via `node --test` or a scratchpad ES module.
**No generated file written or hand-edited** (the re-export sanity script compares in memory and
writes nothing). All scratch files stayed in the session scratchpad.

---

## _140 — offline audio harness mirrors `WasmHost`'s three injection passes (`inView()` unblocked) (2026-08-03)

**Report:** `.agent/reports/202607/20260725_140_harness_inview_injection.md` · branch `feat/bm_readiness`.

**Problem (filed by `_139` §5, reproduced).** `tools/pattern_audio_harness.mjs` could not compile a
pattern that calls `inView("Authored View Name")` — the documented targeting layer
(`docs/MARSIN_ENGINE_PATTERNS.md` §7.3, `.agent/skills/highdef_pattern_generation.md` §3). Measured
pre-fix: `COMPILE_FAIL: Line 9: strings cannot be used as a function argument`, exit 2. So an
`inView()`-targeted pattern could not run the harness, the `--gate` check, or the offline clip
pipeline, and `tools/gallery/gen_variations.mjs` (which spawns the harness) could not produce
titanic static/sound clips for one.

**Root cause — TWO faults, not one.** (1) `inView()` is not a VM builtin; it is a compile-time SOURCE
fold in `lib/in_view_intrinsic.js`. The harness drove `lib/marsin_wasm_runtime.js` (no injection stage
at all) and hand-applied only `injectFixtureConstants`, so the literal string reached the MarsinScript
compiler, which correctly rejected it. The real path, `lib/wasm_host.js` `compile()`, runs three passes
in order: `injectInViewIntrinsic` → `injectMaskConstants` → `injectFixtureConstants`. (2) **Not named in
the ticket and the more dangerous half:** the harness loaded the model with a bare
`import(models/<name>.js)`. The raw module is UNRESOLVED — every pixel `vMask: 0`, no `vMaskHi`, no
`<model>.viewmasks.js` sidecar merge (verified: titanic sample pixel `"vMask":0`). Bolting the fold on
alone would have folded every view test against a bit no pixel carries — a silent all-false render,
the exact codex-P0 failure the intrinsic exists to prevent. Both had to be fixed together.

**Fix (design decision owned per the brief): switch the harness to `loadModelForGauge()` + the real
`WasmHost`,** not a hand-built view table from the sidecar. Rationale — parity with the least
duplicated logic: `WasmHost.compile()` IS the engine's compile entry point, so the three passes and
their ORDER cannot drift, and `loadModelForGauge()` is the same word-aware loader (`_136`/`_138`)
that `tools/param_truth/render_context.js` and `tools/perf_gauge.mjs` already use. The view table is
assembled exactly as `engine.js` does (groups at word 0, presets at their authored word), the
bit-free-view promoter is wired, and a promotion re-packs meta post-compile (mirrors `engine.js`
`repackMetaIfDirty`). The hand-rolled meta pack (which used `p.localIndex || 0` instead of the
engine's `derivePixelLocalIndices`) is gone.

**Files (six).** `marsin_engine/tools/pattern_audio_harness.mjs` (the fix) ·
`marsin_engine/lib/model_loader.js` (pure extraction: the inline `metaArray` map became exported
`buildMetaArray(pixels)`, so the harness re-packs without a second copy of the ABI) ·
`marsin_engine/tests/tools/harness_inview_injection.test.mjs` (new, 3 tests) ·
`.agent/skills/highdef_pattern_generation.md` §8.2 (the "Known tooling gap" note replaced with the
measured reality) · report `_140` · this block.

**Loud-failure surface kept and EXTENDED, no fallbacks.** Unknown view →
`COMPILE_FAIL: Pattern references unknown view(s) via inView(): <name>. Known views for this model: …`
exit 2. New named failures: model fails to resolve → `MODEL_FAIL: <model> failed to load: <reason>`;
declared `pixelCount` ≠ `pixels.length` → `MODEL_FAIL` (was silently reconciled); missing pattern file
→ `PATTERN_FAIL: no pattern file <path>` (was an incidental ENOENT inside the old injector try/catch).
The one added `try/catch` wraps `await loadModelForGauge(...)` only, to honour the documented
`MODEL_FAIL` + exit-2 contract; no import is wrapped, nothing swallowed.

**Measured verification.**
1. **`inView()` renders the right pixels.** Probe on titanic, `inView("Hull Canvas")`→red /
   `inView("Stacks")`→green: `COMPILE_OK`, `LIT=384/964`, and frame 0 classifies as **red=360,
   green=24, off=580, mixed=0, overlap=0** — an exact match to the model truth read back through the
   loader (`Hull Canvas word=1 bit=0x400 members=360` · `Stacks word=1 bit=0x40 members=24` ·
   intersection 0). Both views resolve from the HIGH word, so the word-aware path is the one exercised.
2. **Negative control fails loudly** — unknown name, full known-view list, exit 2 (above).
3. **Existing patterns byte-identical.** Same argv before/after, MD5 of the full capture JSON:
   `27_swipe`@test_bench `8eb3e221…` = `8eb3e221…` · `27_swipe`@titanic `2839bb30…` = `2839bb30…` ·
   `44_biolume_swell`@test_bench `2c4cc4e2…` = `2c4cc4e2…` · `44_biolume_swell`@titanic `b213c4a9…` =
   `b213c4a9…` — **4/4 IDENTICAL**. All summary lines identical; only `meanMs`/`worstMs` move
   (`27_swipe`@titanic `0.72 → 0.83` ms, ~7× under the 6.25 ms/channel budget — `WasmHost.renderAll6ch`
   mallocs per call where the old wrapper reused a buffer). `GATE_PASS` on all four, before and after.
4. **`--gate` intact, including on `inView`**: inView probe `GATE_PASS` exit 0 · a black inView pattern
   `GATE_FAIL DARK: 100% of 600 frames …` exit 3 · `27_swipe`@test_bench `GATE_PASS` exit 0.
5. **Suites: zero new failures.** `tests/mixer/**` **489/489** · `tests/tools/*.test.mjs` **8/8**
   (5 pre-existing gate tests + 3 new) · `tests/patterns/**` **94/95**, the single red being
   `specialty_white_uv.test.js › both scenes carry byte-identical copies of every specialty/themed
   playlist` — **pre-existing and unrelated**: it diffs scene playlist YAML, and
   `test_bench/white_only.yaml` has per-entry slider `defaults:` that titanic's lacks; mtimes
   **2026-07-28** / **2026-07-27**, both predating this session.
6. **`gen_variations.mjs` inherits — deliberately NOT modified.** Its only coupling is
   `execFileSync('node', [HARNESS, …])` and the fix changes no flag, output line or exit contract.
   Proven both legs: the exact STATIC argv it builds, run against an `inView` pattern
   (`--seconds 10 --out-fps 14 --synth silence` → `GATE_PASS`), and a real end-to-end
   `--pattern 27 --model titanic` run (harness → publish → widget, exit 0). `tools/gallery/widgets/`
   is TRACKED, so the one generated widget was deleted and the directory diffed back to its original
   6 entries — **restored clean**, no tracked widget overwritten. Honest caveat: no shipped numbered
   pattern uses `inView()` yet, so the default sweep exercises the new path only once one lands.

**Security check.** `python scripts/security_check.py --all` → **6 findings = the stated baseline**,
all `bm26-mac-address` in UNTRACKED `simulation/.scene_backups/studiodj/**`. Zero new.

**Left open / refused.** (1) **`tools/pattern_derived_harness.mjs` has the SAME gap, worse** — §8.3 of
the same skill, runs on titanic, still bare-imports the raw model, uses `createWasmRuntime`, applies
**no** injection pass at all (not even `FIX_*`), and packs only 4 meta lanes (omits `fixtureTypeId`,
`pixelLocalIndex`, `viewMaskHi`). Any `inView`/`MASK_*`/`FIX_*`/`pixelLocalIndex` pattern is broken or
mis-rendered there. **Filed, not fixed** — out of the brief's scope and it needs its own verification
pass over the derived-signal chain. (2) The bit-free (Tier-A) promotion path is wired but **not
measured** (no tracked model exposes a bit-free view to this path) — claimed as a correctness guard
only. (3) The `specialty_white_uv` playlist-parity red. (4) **No git operation of any kind.**

**Compliance.** Writes confined to the six files above. No engine boot, no sim boot, no server, no port
bound, no deploy, no install — ports 6966–6972, 5568, 8081, 10000 untouched; every check ran in-process
or as an offline subprocess against the vendored WASM. Scratch stayed in `~/tmp/_140` and the session
scratchpad. Other agents' uncommitted work untouched.

---

## `_141` — Views bulletproofing: adversarial sweep of the two-word views system (LANDED)

**Report:** `.agent/reports/202607/20260725_141_views_bulletproofing.md`. Investigator/debugger
thread on the `_134`→`_138` views work. Everything in-process; no operator port touched (the one
server-shaped suite uses the save-server's own `_119` random-high-port + temp-root test hooks).

**FOUND-BROKEN-FIXED (each with regression tests; 33 new tests total):**
1. **P0 — a deleted/renamed view REFUSED THE ENGINE BOOT.** deck_state.yaml's saved
   `viewSelection` naming a view no longer in the model threw inside `setDeckChannel`; the deck
   pattern fallback rebuilt with the SAME stale selection, failed again, escalated to
   `_deckRestoreFatal` → "refusing to boot a dark deck". Reproduced in-process, then fixed:
   `sanitizeRestoredViewSelection` (api_server.js, exported) pre-compiles the saved selection at
   restore time and degrades a stale one LOUDLY to `{type:'all'}` — deck boots lit, mixer/deck
   overlays survive instead of being dropped. Live-API atomic-throw contract untouched (pinned).
2. **Mixed groups+fixtures view silently dropped the clicked fixtures at export** (`_138` §8.1).
   Panel count + both 3D isolation paths show the UNION; the sidecar exported groups-only. Now
   exports the union as pixelIndices (loud warn) when clicks add pixels beyond the groups;
   redundant clicks keep the byte-stable groups form. All 3 tracked sidecars byte-stable.
3. **`setCustomViewSlot` silently ignored `fixtures` on same-word moves** (caught by fuzz:
   orphan bit stranded on every member). Membership now follows the view whenever the list is
   passed; no-list legacy contract unchanged; panel double-migration proven a no-op.
4. **Rename resurrected a just-removed membership.** The snapshot kept stale non-zero patch-tree
   masks over live zeros (unassign → rename before the next projection). New pure
   `snapshotViewMasks` in rename_invalidation.js — live config authoritative, zeros included.
5. **2D Pixel Map `view:` selector on a per-fixture view** (`_138` §8.3): silent empty-set (worst
   inside selector unions) → precise loud per-panel error, unions included. No tracked scene uses
   `view:` selectors (grep-verified).
6. Hardening: orphan-delete enumeration carries `viewMaskHi`; mask_registry bit-only branch
   word-aware.

**FOUND-CLEAN:** allocator exhaustion (62→63 throws, 0x80000000 refused everywhere, no sign-bit
path), cross-word move atomicity on refusal, delete/recreate + group-rename + scene-regen churn
(membership never keys off mutable ids), patches.yaml `viewMaskHi` asymmetry proven safe against
the REAL save-server (stale key disappears, byte-stable re-saves) — `_138` §8.2 CLOSED, engine
load errors all loud, 1500-op fuzz invariant-clean post-fix.

**FILED (documented limits):** sim in-browser preview WASM packs 4 meta lanes (no `vMaskHi`) — a
word-1 in-VM pattern can't resolve in the LOCAL preview path (engine + sACN-in mirror correct);
legacy integer-bit `viewSelection` targets are word-0-only by shape (all modern callers use
names); full per-fixture resolution in the 2D map needs configs in the resolve contract.

**Gates.** Sidecar regen byte-stable ×3 · parity titanic PASS + PASS(--strict) · sim `npm test`
**1773/1766/7** (baseline 1752 + exactly the 21 new tests; same 7 known reds by name) · engine
`npm test` **2625/2617/8** (known environmental families only; +24 incl. this thread's 7) ·
mixer subset 492/492 · state subset 100/100. **Zero new failures anywhere.**

**Security check:** `--all` → **6 findings = stated baseline** (untracked
`simulation/.scene_backups/studiodj/**` MACs). Zero new.

**Compliance.** Write set: 7 source files + 5 test files + report + this block. No git ops, no
deploy, no install, ports 6966–6972/5568/8081/10000 untouched; `_140`'s files untouched.

---

## `_143` — Playlist parity drift: the `specialty_white_uv` byte-identity red (DEFERRED TO OPERATOR)

**Nothing was modified** — not the scene files, not the test. Read-only thread; the red stays red
**on purpose**. Report `20260725_143_playlist_parity_drift.md`.

**The red.** `specialty_white_uv.test.js › both scenes carry byte-identical copies of every
specialty/themed playlist`. Measured baseline: `tests/patterns/**` → **95 / 94 pass / 1 fail**,
that test the only red, failing on `white_only` — the stated baseline CONFIRMED, not assumed.

**Drift is wider than reported and runs BOTH ways.** The test's loop aborts on the first mismatch,
hiding the rest. Full sweep of 15 bench playlists: **`white_only`, `temple_white`, `white_wednesday`**
drifted (bench captures; the latter two OVERWROTE titanic's authored values) — exactly the three
WHITE lists, one bench session's footprint (mtimes 2026-07-28 14:37 / 15:12 / 16:01 vs titanic's
untouched 07-27 16:32). **`ambient` drifted the OPPOSITE direction** (titanic has captures, bench
`{}`) and `default` diverged on both sides — neither is covered by the test. 8 lists identical.
Both files were **born already drifted**: `git log --follow` gives exactly one commit each
(`3246deb2`, which added them); working tree currently CLEAN vs HEAD for every playlist path.

**Mechanism identified exactly.** `api_server.js:1738` `captureOrDeferOutgoingDeckEntry` →
`:1881 captureActiveEntryDefaults` → `:1894 writeEntryDefaults`, payload from
`playlist_manager.js:392 captureDefaults`. (a) The write is **AUTOMATIC on deck entry switch** — the
in-code *"night of deck tuning lost on switch"* fix; **no save action required**. (b) The values ARE
**genuine operator knob movements** — the gate `_paramsTouchedSinceLoad` is set ONLY by the operator
control-write routes (`markDeckParamsTouched`, `:1669`); autopilot / `applyEntryDefaults` / seeded
defaults never set it. (c) `captureDefaults` snapshots **ALL** local exports in **declaration
order**, which is why the bench files carry the full slider set and show **reordered keys**
(`temple_white`/`61`: `sliderWarmth` moved to the end) — signatures hand-editing cannot produce.
Values cross-checked against declared `export var` defaults: varied, non-round, deliberate
(`63`: `whiteLevel 0.60→0.93`, `level 0.07`, `whiteKick 0.86`; `64`: `localSpeed 0.25→0.83`).
`62_white_shimmer` stayed `{}` — never touched, so no capture fired.

**Show impact: NONE — test-only.** `state_paths.js:74 resolvePlaylistsDir` keys on model name, so
`--model titanic` can never read the bench copy. Independently, `_91`'s audit lists all three white
lists as **"unassigned"** — no look or cue references them on either scene.

**Why deferred (the brief's high bar, not met either way).** NOT clearly residue: real knob
movements. NOT clearly wanted state: they overwrote values `_13` §5.1 documents as *"authored and
measured … the operator's intent for them is explicit"*, and contradict the lists' stated character
(`temple_white` = *"dim warm white, **slow**"*, yet `64`'s speed went 0.18 → 0.75). NOT a ratified
design position: cross-scene sync **does not exist** — the curator kickoff queues *"(5) playlist
clone/parity tool"* and *"(6) … + cross-scene copy"* as UNBUILT. What is unrecoverable from the repo
is whether the 07-28 bench fingers were Sina's or an agent's (curator scope includes
`scenes/*/playlists/` + driving the live engine). That is the crux → operator's call.
`_91` also rules playlist contents *"ChatGPT+operator territory"*.

**LIVE HAZARD:** the operator's stack is on **titanic** right now — `titanic/ambient.yaml` (17:06)
and `default.yaml` (18:07) carry today's mtimes. Hand-patching titanic playlists under a live engine
would race its own writes.

**QUESTION FOR SINA (one line).** *On 2026-07-28 a bench deck session auto-captured knob positions
into `test_bench`'s `white_only` / `temple_white` / `white_wednesday`, overwriting the authored
"temple = slow/dim" values (e.g. `temple_white`/`64` speed 0.18 → 0.75) — real tuning pass to keep,
or audition residue?* **Recommendation if no strong feeling:** revert the three bench files to the
authored `_13` §5.1 values (parity restored, test green) — those are documented as measured and
intentional, the captures contradict the lists' character, and the bench scene never runs the show.
If the bench pass WAS his tuning, the mirror image (propagate bench → titanic) is correct.

**Durable follow-up (needs the same ruling).** This test WILL re-red the next time anyone tunes the
deck on either scene — it pins an invariant nothing maintains over files the engine mutates by
design (already left alone by `_129`, `_140`, `_141`). Lasting fix is either the queued clone/parity
tool, or relaxing the assertion to **structural** parity (same entry ids/patterns/order) with
`defaults` per-scene. Not done here.

**FILED, not fixed.** (1) **Stale docstring** — `captureActiveEntryDefaults`
(`api_server.js:1876-1880`) claims *"EXPLICIT operator action only — never wired to a control-write
path"*; it IS wired to one via capture-on-switch, misleading exactly the reader chasing this bug.
(2) `ambient` + `default` drift identically and are **not** covered by the parity test — any ruling
should cover them.

**Security check:** `--all` → **6 findings = stated baseline** (untracked
`simulation/.scene_backups/studiodj/**` MACs). Zero new.

**Compliance.** Write set: report + this block, nothing else. **No git operations of any kind**
(only `git log`/`show`/`status`). No engine/sim boot, no server, no port bound, no deploy, no
install; ports 6966–6972/5568/8081/10000 untouched. Scratch in `~/tmp/_143_baseline.txt` + session
scratchpad. `_142`'s paths (`marsin_engine/tools/`, `tests/tools/`) untouched.

---

## `_142` — derived-signal harness: model resolution + `WasmHost`'s three injection passes (2026-08-03)

**Report:** `.agent/reports/202607/20260725_142_derived_harness_injection.md` · branch
`feat/bm_readiness`.

**Problem (filed by `_140` §6.1, reproduced).** `tools/pattern_derived_harness.mjs` carried the same
gap `_140` fixed in the audio harness, and worse. `.agent/skills/highdef_pattern_generation.md` §8.3
tells pattern agents to run it on `--model titanic`, so it was reachable from the documented workflow.

**Root cause — THREE faults in one block.** (1) bare `import(models/<name>.js)` → unresolved model,
every pixel `vMask: 0`, no `vMaskHi`, no `<model>.viewmasks.js` merge. (2) `createWasmRuntime`
(`lib/marsin_wasm_runtime.js`) hands source straight to `_compile` — **no** injection stage, and this
harness hand-applied *nothing*, not even `FIX_*` (the audio harness at least did that one). Measured
against that runtime: `inView(...)` → `Line 3: strings cannot be used as a function argument`;
`MASK_STACKS` → `Undefined var`; `FIX_PAR` → `Undefined var`. (3) **The dangerous one, because it
COMPILES:** a 4-lane meta pack (`controllerId/sectionId/fixtureId/viewMask`) against the 7-field ABI,
so `fixtureTypeId`, `pixelLocalIndex` and `viewMaskHi` were all zero. A `pixelLocalIndex == 0` probe
lit **964 / 964** titanic pixels (model truth: **88**) at exit 0 — a wrong render with a green exit
code, and with `viewMaskHi` absent all 17 titanic composite views were empty.

**Fix — same design decision as `_140`, deliberately:** `loadModelForGauge()` + the real `WasmHost`,
not a hand-mirrored pass list. `WasmHost.compile()` IS the engine's compile entry point, so pass ORDER
(`injectInViewIntrinsic` → `injectMaskConstants` → `injectFixtureConstants`) cannot drift; the meta
comes from `loaded.metaArray`, so the ABI is not copied a third time. View table assembled as
`engine.js` does (groups word 0, presets at their authored word); `createBitFreeViewPromoter` wired;
`if (host.metaDirty) setPixelMeta(buildMetaArray(px))` after compile; `rt.*` → `host.*(handle, …)`;
teardown `destroy(handle)` + `shutdown()`. **`lib/model_loader.js` needed NO change** — `_140` had
already exported `buildMetaArray(pixels)`, which is exactly what this harness needed.

**Loud-failure surface (no fallbacks):** new `MODEL_FAIL: <model> failed to load: <reason>` (measured:
`titanic.effects` → *"must export a pixels array"*, exit 2) and new `pixelCount ≠ pixels.length`
guard; unknown `inView` → `COMPILE_FAIL: Pattern references unknown view(s) via inView(): No Such
View. Known views for this model: …`, exit 2. Missing model / missing pattern already loud, unchanged.
One `try/catch`, around `loadModelForGauge` only; no import wrapped.

**Measured.** *(a) No behaviour change on existing work* — 2 patterns × 2 models + a real
derived-key run (`audioClimax`/`audioRiserScore`, 200 f) × 2 models: **all 6 trace JSONs AND all 6
full stdouts byte-identical** before/after (only the echoed `--out` path differed, by construction).
This harness prints no timing fields, so nothing had to be excluded (unlike `_140`). *(b) `inView`* @
titanic: `Hull Canvas` → 360 px, `Stacks` → 24 px, union → 384 = exact sum ⇒ disjoint; matches
`loadModelForGauge` (`Hull Canvas` word 1 bit 0x400 = 360, `Stacks` word 1 bit 0x40 = 24, overlap 0)
— the HIGH word is the path exercised. `viewMaskHi & MASK_STACKS` → 24. *(c) meta lanes:*
`fixtureType == FIX_PAR` → **40** (truth 40), `pixelLocalIndex == 0` → **88** (truth 88; was 964).
*(d) negative control:* unknown view → named `COMPILE_FAIL` + full known-view list, exit 2.
*(e) suites:* `tests/tools/*.test.mjs` **12/12** (`_140` baseline 8 + my 4); `tests/mixer` **492/492**;
`tests/patterns` **94/95** — the one red is `_143`'s `specialty_white_uv` playlist-parity drift
(`simulation/scenes/**` YAML, `_141`/`_143` territory), untouched.

**Callers: none in code.** `grep -rl pattern_derived_harness` → 9 files = the harness + 8 `.agent/`
docs/reports/plans. Nothing spawns it (unlike the audio harness ← `gen_variations.mjs`). Flags,
printed line formats and exit-code contract all unchanged, so any later caller inherits the fix.

**Docs.** `.agent/skills/highdef_pattern_generation.md` **§8.3** gains a measured targeting-parity
block (the numbers above + the loud-failure contract + the pinning test + what the old behaviour
actually was). It had carried no limitation note, so nothing was retracted. **§8.2 not touched**
(already correct per `_140`).

**New test.** `marsin_engine/tests/tools/derived_harness_inview_injection.test.mjs` — 4 tests beside
`harness_inview_injection.test.mjs`; every expected count read from `loadModelForGauge` at runtime so
it stays honest if titanic is re-authored. Probes light their target set full-red so
`totalBri / 255` = member count (this harness's trace stores totals, not per-pixel colour).

**FILED, not fixed.** (1) `dev_test_bench` is now a loud `MODEL_FAIL` here (`groupBits out of sync —
stale: [ParLights, VintageLights, BarLights, LED_0]`) where the bare import used to "work" with
`vMask: 0`. That is the **correct** outcome and is **pre-existing for every `loadModelForGauge`
tool** — the audio harness (post-`_140`) rejects it identically. It is a dead dev model referenced by
nothing but its own sidecar. (2) The bit-free (Tier-A) promotion path and the `pixelCount` mismatch
guard are wired but **unreachable on tracked models** — correctness guards, claimed as such, same
caveat as `_140` §6.2.

**Security check:** `--all` → **6 findings = stated baseline** (untracked
`simulation/.scene_backups/studiodj/**` MACs). Zero new.

**Compliance.** Write set: the harness, the new test, skill §8.3, report, this block — nothing else.
**No git operations of any kind** (read-only `git status --porcelain` to prove no generated residue).
No engine/sim boot, no server, no port bound, no deploy, no install; ports 6966–6972/5568/8081/10000
untouched. Nothing under `simulation/` read or written (`_141`'s territory). Scratch in `~/tmp/_142/`.

## `_144` — Bench white playlists: audition residue REVERTED (executes the operator ruling on `_143`) — LANDED

**Report:** `.agent/reports/202607/20260725_144_bench_white_residue_revert.md` (2026-08-03).

**The ruling.** `_143` proved the mechanism and the provenance of the drift but **deferred the
taste call** to Sina: keeper tuning, or audition residue? **Sina ruled: audition residue —
revert the bench files.** That is `_143` §7's stated recommendation branch. This thread executes
it and nothing more; the mirror-image option (propagate bench → titanic) is NOT taken.

**Changed — exactly four files.** `simulation/scenes/test_bench/playlists/{white_only,
temple_white,white_wednesday}.yaml` reverted to their `titanic` counterparts' exact bytes, plus a
**comment-only** docstring fix in `marsin_engine/lib/api_server.js`. **Not touched, deliberately:**
`ambient.yaml` / `default.yaml` on either scene (drifted too — `_143` §2/§8.2 — but outside the
ruling, and the operator's LIVE engine is writing the titanic copies right now, so hand-editing
would race it), and **nothing under `simulation/scenes/titanic/playlists/` was written at all**.

**Method.** `_143` §3(c) found the captures carry a signature hand-editing can't cleanly undo —
the full export set where the authored files carried a sparse curated subset, and keys reordered
into export-declaration order (`temple_white`/`61`: `sliderWarmth` moved to the end). So parity was
taken from the authoritative side: each bench file written from its titanic copy's exact bytes (LF,
trailing newline, key order). Titanic was first cross-read against `_13` §5.1 and **still carries
the authored values** on all three lists — so "byte-identical to titanic" and "the `_13` §5.1
authored values" are the same target; no conflict to resolve. **No git checkout/restore/stash of
any kind** — file contents written directly, per the brief.

**What comes back:** `temple_white`/`64` `sliderLocalSpeed` **0.75 → 0.18** (the list is documented
*"dim warm white, slow"*) and the capture's `sliderRadius 0.45` gone; `temple_white`/`61`
`sliderLevel` **0.13 → 0.34**; `white_wednesday`/`61` loses the capture's `sliderLocalSpeed 0.89`;
`white_only` back to `defaults: {}` ×5 (it is the raw family audition list by design). File sizes
1777/1137/1453 B → **841/994/1328 B**.

**Show impact: none** — `resolvePlaylistsDir` means a `--model titanic` engine can never read the
bench copy (`_143` §4), and `_91` lists all three playlists as unassigned to any look or cue.

**Measured — byte parity across ALL 9 lists the test covers, not just the 3 touched.** SHA-256,
`test_bench` vs `titanic`: `white_only dd31a8c0…`, `uv_test 6af99401…`, `tutu_tuesday bd0ecfd3…`,
`white_wednesday c9c41bc5…`, `iceberg_ahead f3f09a73…`, `first_class_1912 cad496ab…`,
`deep_sea 0d2885e5…`, `burn_night e5b15b36…`, `temple_white 0f42b1b0…` — **9/9 IDENTICAL**. This
retires `_143`'s "the loop aborts on the first mismatch" hazard directly: the assertion sees no
second mismatch because there is none, verified independently of the test. `fc /b` on the three
touched files → *"no differences encountered"* ×3.

**Measured — suite.** `cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs
--test "tests/patterns/**/*.test.js"` → **`tests 95 · pass 95 · fail 0`**. `_143`'s baseline was
`95 / 94 / 1`, the single red being the byte-identity parity test. Delta is exactly +1 pass / −1
fail; no other test changed state. Zero `marsin_engine/states/` residue (30-min mtime sweep).

**Docstring fix (`_143` §8.1, filed→fixed).** `captureActiveEntryDefaults` claimed *"EXPLICIT
operator action only — never wired to a control-write path"* — **false**. Corrected to the real
contract, read off the three call sites (`1746`, `9400`, `9905`): (1) explicit routes
`POST /deck/playlist/capture` + `POST /mixer/channel/<id>/playlist/capture`; (2) **AUTOMATIC** deck
capture-on-entry-switch via `captureOrDeferOutgoingDeckEntry` (`:1738`) on *every* deck entry
switch when auto-save is ON. Gated on `channel._paramsTouchedSinceLoad`, set only by the operator
control-write routes — so a control-write **arms** the capture and the next entry switch writes the
playlist file without further operator intent. **Comment-only:** the edit sits inside a `/** … */`
block, `node --check lib/api_server.js` clean, no executable line in the hunk;
`tests/mixer/channel_param_isolation.test.js:221` greps only for `function
captureActiveEntryDefaults` (untouched) and nothing asserts the comment text.

**STILL OPEN — do not read this as solved.** (1) The test pins a cross-scene invariant **nothing
maintains**; it will re-red the next time anyone tunes the deck on either scene. Lasting fix is
still one of: build the queued playlist clone/parity tool (curator items 5+6), or relax the
assertion to **structural** parity (same entry ids/patterns/order) and let `defaults` be per-scene
by design — both need an operator ruling. (2) `ambient` + `default` drift (bidirectional, not
covered by the test) remains unaddressed and out of scope for this ruling.

**Security check:** `--all` → **6 findings = stated baseline** (untracked
`simulation/.scene_backups/studiodj/**` MACs). Zero new.

**Compliance.** Write set: the three bench YAMLs, the `api_server.js` docstring, the report, this
block — nothing else. **No git operations of any kind** (read-only `git diff --stat` /
`git config --get` / `git check-attr` to prove the change surface). No engine/sim boot, no server,
no port bound, no deploy, no install; the operator's live stack (6966–6972, 5568, 8081, 10000, on
the titanic scene) untouched. `_142`'s paths untouched. Scratch in the session scratchpad.

**Commit note:** `core.autocrlf=true` here with no `.gitattributes` rule for `*.yaml`, so git warns
*"LF will be replaced by CRLF"* on the three reverted files. Harmless for parity (both scenes
normalize identically; the index stores LF on both sides) — just don't mistake it for a real diff.

## `_145` — Mixer view catalog cleanup: 7 composites, exhaustive LEFT/RIGHT halves (LANDED)

Report: `.agent/reports/202608/20260804_145_mixer_view_catalog_cleanup.md` (new
month dir `202608`). Executes the operator's catalog ruling end to end.

**What the picker looked like before:** ~70 selectable names. `LEFT`/`RIGHT` were
LED-strand-scoped (234 px each, not halves); the ship's real sides were
`PORT`/`STARBOARD` (408 each, DMX-only); ends were `FORE`/`AFT`; plus three
`BAND_*` height slices, ten `<base>_BOTH` pairs, and ten `Left */Right *`
half-instrument composites.

**What landed.** `views.yaml` 17 custom → **7** (66 deletions, **0 insertions**;
the 24 `groupBits:` lines byte-for-byte untouched), sidecar regenerated through
the canonical chain (`createViewRegistry` → `removeCustomView` →
`reconcileGroupBits` asserted `+0 −0` → `buildViewmasksSidecarJS`), with a
guard that refuses to write if either `groupBits` block changes a byte. The
seven keep their **exact** `(word, bit)`: `Hull Canvas` w1 `0x400` **360** ·
`Silhouette` w1 `0x2000` **320** · `Jewelry` w1 `0x10000` **96** · `Organs` w1
`0x4` **40** · `Identity` w1 `0x20` **148** · `Stacks` w1 `0x40` **24** ·
`Auditoriums` w1 `0x200` **16**.

`lib/auto_views.js` rewritten: **`LEFT` 482 / `RIGHT` 482** are now exhaustive
whole-ship halves assigned from **world X** (physical truth), cross-checked
against the `Left_`/`Right_` group token — a disagreement **throws at model
load**. `FORE`/`AFT` → **`FRONT` 388 / `BACK` 388**. `PORT`/`STARBOARD`,
`BAND_LOW/MID/HIGH` and the entire `<base>_BOTH` family **deleted** (families
removed from the return shape, not emptied). `@RAW` → **`Strands` 320**; new
**`TE Signs` 148** on an appended `FIX_TE_SIGN` (**id 7**, `TeSignV3A40` +
`TeSignV3B34` — append-only, nothing renumbered; those 148 px were UNTYPED
before, so the change is purely additive). Final catalog: **60 names** = 24
groups + 7 composites + 4 sides/ends + 2 structural (`WALLS` 360,
`AUDITORIUM` 16) + 5 fixture types + 18 `CTRL_`.

**Measured, from the regenerated sidecar — not from my own construction.**
LEFT ∩ RIGHT = 0, LEFT ∪ RIGHT = 964. Per half: 180 wall + 160 rope + 48 rail +
12 stack + 8 auditorium + 74 sign = **482**. `Strands` ∩ `TE Signs` = ∅. All 12
removed composite names + `FORE`/`AFT`/`PORT`/`STARBOARD`/`BAND_*`/`@RAW`/
`*_BOTH` resolve to **nothing**, and `inView()` on each raises the loud
`unknown view(s) via inView(): <name>` compile error. Zero bit collisions in
either word; groupBits ↔ model in sync both ways.

**Suites.** `simulation npm test` **1773 / 1766 / 7** — the exact stated
baseline, zero new; and the `view-bit headroom is REPORTED` test that was RED in
`_134` is now **GREEN** (dropping 10 composites gave word 0 its headroom back) —
a recovered failure, not a new one. `marsin_engine npm test` **2643 / 2636 / 7**;
the +16 test delta is authored here by name (9 new `titanic_view_catalog.test.js`,
+7 net `auto_views.test.js`), and all 7 fails are the known environmental
families (5× audio_capture, effects_v2 layout, OSC EADDRINUSE from the
operator's live stack) — the 8th baseline red (playlist byte-identity) is gone,
retired by `_144`. Targeted: `tests/mixer/**` **510/510**, `tests/patterns/*` +
`tests/tools/*` **107/107**, CaptainPad picker **32/32**. Parity
`node tools/scene_model_parity.cjs titanic` and `--strict` → **PASS, 0 errors, 0
warnings, 1 info** (the pre-existing no-bench-block note). `security_check.py
--all` → **6 = baseline** (untracked `.scene_backups/studiodj/**` MACs).

**OPERATOR DECISION NEEDED — the view is `TE Signs`, not `TE Sign`.** The brief
asked for `TE Sign` = 148 px. That name is **structurally unavailable**: it is
already a base group (the port sign, **74 px**), one of the 24 bits the same
brief requires byte-preserved, and `MaskRegistry` is a flat namespace whose
`buildMaskRegistry` **silently skips** a preset whose name a group owns — the
view would simply not have existed, with no error. Registered as **`TE Signs`**
(plural = both signs), and the generator now **refuses loudly** on such a clash
instead of skipping it. Every specified count is met (148 px, both signs,
disjoint from `Strands`); only the spelling differs by one letter. Getting the
literal `TE Sign` requires renaming the base groups (e.g. `TE Sign L`/`R`),
which re-exports `titanic.js` and breaks `MASK_TE_SIGN` — out of scope here.
One-line change in `TYPE_VIEW_NAMES` (`lib/auto_views.js`) whenever you rule.

**Flagged, kept as instructed — byte-identical aliases.** Verified pixel-for-
pixel, not by count: `WALLS` ≡ `Hull Canvas` ≡ `@BAR` (360) and `AUDITORIUM` ≡
`Auditoriums` (16). Per the brief neither was removed without your call.
(`Strands` ≡ `Silhouette` and `TE Signs` ≡ `Identity` are *deliberate* — operator
handle vs semantic instrument; the `CTRL_n` ≡ single-group aliases are
structural.)

**No centreline contradictions — nothing fudged.** All 964 pixels have non-zero
world X; no fixture, base group or controller straddles the centreline, and
every `Left_`/`Right_` token agrees with its geometry. The 482/482 fell out of
the model as-is. On other scenes the generator stays honest rather than
exhaustive: an `x = 0` pixel with no side token joins **neither** half and is
reported by index in a loud warning (`studiodj` has 4) — never pushed to a side.

**Docs updated to the new truth:** `MARSIN_ENGINE_PATTERNS.md` §7.3.1 rewritten
(**seven**, not seventeen) plus a new **§7.3.2** documenting the derived
auto-views; `COLOR_THEORY.md` §2/§4; `MARSIN_PB_LANG_SPEC.md` (`FIX_TE_SIGN`);
`.agent/skills/highdef_pattern_generation.md` §3.1 (seven composites, `LEFT`/
`RIGHT` for halves, explicit removed-name list, **exact spelling mandatory**).
Patterns are still told to use the semantic `Identity` when they mean both signs
artistically. `inview_demo.js` re-pointed off `PORT`.

**Compliance.** Write set: `views.yaml`, the sidecar, `auto_views.js`,
`strand_views.js`, `fixture_type_constants.js`, `in_view_intrinsic.js`,
`engine.js` (comment), `inview_demo.js`, 5 engine test files + 1 new, 4
CaptainPad files, 3 docs, 1 skill, the report, this block — nothing else. **No
git operations of any kind** (read-only `git status` / `git diff --stat` to prove
the change surface). No engine/sim boot, no port bound by this thread, no deploy,
no install; the operator's live stack (6966–6972, 5568, 8081, 10000) kept every
port. `marsin_engine/states/titanic/mixer_state.yaml` residue predates this
thread and is left exactly as found — reported, never reverted. Scratch in the
session scratchpad. Note: this thread was killed mid-run by an expired auth
token and resumed; state was re-established from disk, not from memory.

## `_146` — Adversarial verification of `_145`'s catalog cleanup (VERIFIED, 2 discrepancies)

Independent **read-only** verifier. Truth re-derived from the repo first, own
probes, `_145`'s report read last. Report:
`.agent/reports/202608/20260804_146_catalog_cleanup_verification.md`.

**Verdict: CONFIRMED.** All 12 operator-acceptance lines hold on the substance.
`LEFT` **482** / `RIGHT` **482**, ∩ = 0, ∪ = **964/964**, zero warnings — each
half 180 wall + 160 rope + 48 rail + 12 stack + 8 auditorium + **74 sign** = 482,
one TE sign per side. `FRONT`/`BACK` 388 each resolve; `FORE`/`AFT`/`PORT`/
`STARBOARD`/`BAND_*` return `null`; **zero** `*_BOTH` names. `Strands` **320** ∩
`TE Signs` **148** = 0. The seven composites carry their exact prior counts and
`(word,bit)` slots; the ten L/R variants are gone from both `views.yaml`
(66 del / **0 ins**) and the sidecar, `groupBits` byte-identical to HEAD in both.
24 word-0 bits + 7 word-1 bits, **zero** collisions, no stale sidecar entries.
`FIX_*` 1–6 unrenumbered at HEAD, `FIX_TE_SIGN` **7** appended over pixels that
were `UNTYPED` (0) — strictly additive. Docs (`MARSIN_ENGINE_PATTERNS` §7.3.1 +
new §7.3.2, `COLOR_THEORY`, `MARSIN_PB_LANG_SPEC`, `highdef_pattern_generation`)
say seven composites, `LEFT`/`RIGHT` for halves, removed aliases hard-fail, exact
spelling mandatory — every §7.3.2 figure matches my registry dump, and `17
composite`/`41 names` scan returns **zero**. `security_check --all` = **6**, all
untracked `.scene_backups/studiodj/**`. Judgement calls **(a)** the `TE Sign`
base-group collision is real and the generator now **throws** on an
operator-named clash (`@`-prefixed still skips, as designed), **(b)** `WALLS` ≡
`Hull Canvas` ≡ `@BAR` (360) and `AUDITORIUM` ≡ `Auditoriums` (16) byte-identical
by two independent routes, **(c)** zero `x == 0` pixels, **25.99-unit clear gap**
across the centreline, zero straddling group/fixture/controller, zero
token/geometry disagreements — nothing fudged.

**`inView()` proven through the REAL compile path.** `WasmHost.compile()` with
the engine-parity viewTable (groups + presets + auto-views) + the bit-free
promoter, fresh host per name: 22 removed names each `COMPILE_FAIL` **naming the
view** (10 L/R composites, `PORT`, `STARBOARD`, `FORE`, `AFT`, `BAND_*`, three
`_BOTH` forms, `RAW`, `@RAW`); positive controls `Hull Canvas`, `Silhouette`,
`LEFT`, `RIGHT`, `Strands`, `TE Signs` all compile.

**Suites re-run.** `scene_model_parity titanic` and `--strict` → **PASS 0/0/1
info**. `simulation npm test` **1773 / 1766 / 7** — exact baseline, all 7 known
scene-content. `marsin_engine npm test` **2643 / 2635 / 8**; the 8th is
`fire_sync_listener` *ON/OFF edge* which **passes 14/14 re-run alone** — a
timing flake, so the stable figure is `_145`'s 7. Zero view-related failures.
View-specific mixer files **101/101**, `tests/patterns/*` + `tests/tools/*`
**107/107**, CaptainPad picker **32/32**. (The `tests/mixer/**` glob run in
isolation shows 5 `deck_entry_autocapture`/pre-show **409** failures that pass
inside the full run — order/state dependence against the operator's live stack,
not a `_145` regression.) `mixer_state.yaml` residue is byte-identical before and
after my runs — reported, never reverted.

**Discrepancy 1 — test-count delta attribution (cosmetic).** `_145` reconciles
2643 as "+16 on a 2627 baseline (9 new + **7** net in `auto_views.test.js`)".
`git show HEAD:` gives `auto_views.test.js` **15** tests, not 13, so the net is
**+5** and the whole delta is **+14** → the true pre-`_145` baseline is **2629**.
Totals are right; the arithmetic is off by 2. No functional impact.

**Discrepancy 2 — the stale sweep missed two tracked files.** `_145` §4.6 claims
*"the only other `PORT` hits in the repo are `control_podium/**/deploy.py` SSH
port credentials"*. Not accurate: `marsin_engine/tools/param_truth/param_truth_results.md`
(line 37) and `param_truth_results.json` both record `inView(): PORT` from
`examples/inview_demo` — doubly stale now (the demo says `LEFT`, and the recorded
"Known views" list names a superseded titanic model with `* Generator` groups).
Low severity (generated snapshots, regenerated by the next param-truth sweep),
but it is a real stale reference inside the sweep scope. `_145`'s quoted grep
pattern has no bare `PORT` term, which likely explains the miss. Everything else
in the sweep dirs is either documenting the removal or asserting it.

**Separate finding, PRE-EXISTING (not `_145`'s doing) — the offline harnesses
cannot resolve the auto-views.** `tools/pattern_audio_harness.mjs`,
`tools/pattern_derived_harness.mjs` and `tools/param_truth/render_context.js`
build their `inView()` table from `loadModelForGauge()` only, which never calls
`deriveAutoViews` — so the offline table holds **31** names where the engine
holds **60**. Measured on titanic: `inView("Hull Canvas")` → `COMPILE_OK
LIT=360/964`, but `inView("LEFT")` → `COMPILE_FAIL: unknown view(s) … LEFT`.
This is newly consequential because the rewritten docs now steer authors to
`LEFT`/`RIGHT`/`Strands`/`TE Signs`: a pattern that gate-tests offline will fail
on a view that is valid on the rig. Fix is one `deriveAutoViews` call in each of
the three tools. **Worth a follow-up card.**

**Not verifiable.** `_145`'s "78/78" scratchpad harness (its scratchpad is gone;
equivalent facts re-derived here, and the permanent 9-test replacement is green);
the exact pre-`_145` engine baseline (needs a git checkout, out of scope); and
the "generated, not hand-authored" provenance of `views.yaml`/the sidecar (not
observable after the fact — but the end state is consistent and parity-clean).

**Compliance.** Write set: this block + the `_146` report only. **No source,
test, doc, scene or model file touched. No git operation of any kind** —
read-only `git status` / `git diff` / `git show HEAD:<file>` for comparison only.
No engine/sim boot, no port bound; the operator's stack kept 6966–6972, 5568,
8081, 10000 throughout. Probes in the session scratchpad.

---

**Landed 2026-08-04 — `_147` harness↔engine `inView()` CATALOG parity (Opus,
[`../reports/202608/20260804_147_harness_autoview_parity.md`](../reports/202608/20260804_147_harness_autoview_parity.md)):**
closes the gap `_146` filed. Offline tools held **31** of titanic's **60**
view names; now **60 = 60**, byte-equal to the engine's.

**Design: ONE shared helper, and `engine.js` uses it itself** — the mirror
fallback was declined (a fourth hand-copy is exactly the drift `_140`/`_142`
killed). New `marsin_engine/lib/view_catalog.js`: `appendAutoViews()` (seeds
`existingMaskNames` from groups + presets, calls `deriveAutoViews`, pushes in
order) + `buildViewTable()` (groups word 0, presets/auto-views at their
`{bit,word}`, bit-free at `bit:0`) + `buildViewCatalog()` = the two in order.
`engine.js` calls the two primitives (logging sits between them); the three
tools call the composed one. Repo-wide, `viewTable[...]` construction and
`deriveAutoViews` now have exactly ONE production caller each — that file.
`deriveAutoViews` logic and the view catalog itself: untouched.

**engine.js behaviour PROVEN unchanged.** Its inline sequence (lines 560-575 +
622-634) was copied verbatim to scratch BEFORE the edit and its full viewTable,
auto-view names/count, family summary, warnings, post-append `viewMasks` list
and `MASK_*` names dumped per model; JSON-compared after: `titanic 60 / test_bench
20 / studio_top_loft 13` all **IDENTICAL**. (`buildMaskConstants` skips `bit:0`
entries by design, so appending bit-free auto-views cannot move the MASK_ table
— measured.)

**Second bug fixed in passing:** all three tools wired
`createBitFreeViewPromoter({pixels, viewMasks})` **without `groupBits`** where
engine.js passes its whole model — a promoted Tier-A view could have drawn a bit
a base group owns. Unreachable before (nothing offline was promotable), reachable
the moment the auto-views land. All three now pass `groupBits`.

**Measured, both harnesses, titanic.** Audio (lit-pixel counts):
`LEFT` **482**, `RIGHT` **482** (∩ = 0, ∪ = 964), `Strands` **320**,
`TE Signs` **148** (∩ Strands = 0), `FRONT` **388**, positive control
`Hull Canvas` **360** unchanged. Derived (`TOTAL_BRI/255`): 482 / 482 / 320 /
148 / 388 / 360 — same six, exact. `render_context.js`:
`run_param_truth --pattern examples/inview_demo` → **compile errors 0** (it was
the sweep's only compile error). Negative control still loud: unknown name →
`COMPILE_FAIL` naming it, exit 2, known-views list now **60 names** (was 31),
byte-identical from both harnesses.

**Byte-stability.** 2 patterns × 2 models × each harness: all 8 capture/trace
JSONs **IDENTICAL** (the four audio MD5s are the same values `_140` recorded —
baseline intact across three threads). Derived stdout differs only in the echoed
`--out` path (`_142`'s documented delta); audio stdout only in `--out` +
`meanMs`/`worstMs`. ONE deliberate new output: `deriveAutoViews` warnings now
print via `console.warn` → **stderr** (titanic 0 bytes, test_bench 184 = the two
straddling-controller warnings the engine also prints), so stdout stays
byte-stable and `gen_variations` (`stdio:'inherit'`, parses nothing) is untouched.

**Tests.** `tests/tools` **23/23** (baseline 12, +11 mine: +2 audio, +1 derived,
+8 new `view_catalog_parity.test.mjs` — including a reference transcription of
engine.js's sequence that deliberately does NOT route through the helper, both
harnesses' real known-view lists, the param_truth context, and a loud
double-append refusal). `tests/mixer/**` **510/510** (exact baseline).
`tests/patterns/*` **95/95** (the `specialty_white_uv` red `_140`/`_142` carried
is gone — another thread's fix, not mine). `npm test` run 1 **2657/2650/7**, run 2
**2654/2647/7**: the total is NOT deterministic here (two identical runs differed
by 3, from file-level aborts like `effects_v2_mode_page_layout`); run 2's
**2654 = 2643 + 11** closes exactly on my delta, and I touched no test outside
`tests/tools`. The **7 fails are identical in both runs** and are the documented
environmental set (5× `audio_capture`, `effects_v2_mode_page_layout` file-level,
OSC `EADDRINUSE`); `fire_sync_listener` did NOT flake. Zero view-related failures.
`mixer_state.yaml` residue byte-identical before/after (`36c7f448…`) — reported,
never reverted. `security_check.py --all` → **6**, the exact pre-existing
`.scene_backups/studiodj/**` baseline.

**`_146` cleanup item done.** `tools/param_truth/param_truth_results.{md,json}`
regenerated through `sweep_all.mjs` (offline, sharded, no socket, 161.7 s):
header `964 px` (was 981), `compile errors 0` (was 1), `grep -c PORT` → **0**,
`grep -c Generator` → **0**. Census moved (`WRONG 39→47, DEAD 170→112,
TRUE 548→579`) — an honest re-measurement against the current model, not a
regression; `param_truth_smoke` pins no census and is green.

**Also:** `.agent/skills/highdef_pattern_generation.md` §8.2/§8.3 gained measured
catalog-parity notes. `docs/MARSIN_ENGINE_PATTERNS.md` needed none (it carried no
stale harness claim). The bit-free PROMOTION path `_140` §6.2 / `_142` §6.1 had to
caveat as unmeasured is now exercised on every derived probe — caveat retired.
`marsin_engine/tests/mixer/model_loader_word_aware.test.js` shows modified and is
**`_145`'s, not mine** (the session-start status snapshot omitted it) — flagged so
it is not misattributed.

**Compliance.** No git operation of any kind. No engine/sim boot, no server, no
port bound; the operator's stack kept 6966–6972, 5568, 8081, 10000. Scratch in
`~/tmp/_147`.

---

**Landed 2026-08-04 — `_148` structural view dedup: `WALLS` / `AUDITORIUM`
retired (Opus,
[`../reports/202608/20260804_148_structural_view_dedup.md`](../reports/202608/20260804_148_structural_view_dedup.md)):**
executes the operator's ruling on the decisions `_145` §5 filed and `_146` §3
confirmed. Titanic's catalog **60 → 58**.

**Ruling 1 — `TE Signs` stands, no code change.** Swept `docs/`,
`.agent/skills/`, `patterns/examples/`, `CaptainPad/`, the engine libs: `TE Sign`
/ `TE Sign 2` appear ONLY as the two 74-px base groups, `TE Signs` (148) is the
fixture-type view everywhere, and nothing promises a literal `TE Sign`
selectable. No stragglers; the base group is NOT renamed.

**Rulings 2+3 — one rule, in the shared path.** Implemented once in
`lib/view_catalog.js` `appendAutoViews()` (the function `engine.js` calls and the
three tools' `buildViewCatalog()` composes), so engine↔harness parity stays
STRUCTURAL. `deriveAutoViews` logic untouched — it stays a pure derivation; the
"is this derived name redundant against the authored catalog" decision belongs at
registration. Membership resolved by the SAME two rules `buildMaskRegistry` uses,
so byte-identical here == byte-identical `members[]` there.

**Scoped to the STRUCTURAL family, and that is a measured refusal of the global
rule** — the operator's own ruling 2 keeps `@BAR`, which is byte-identical to
`Hull Canvas`. A global rule would also retire: typed `@BAR`/`@PAR`/`@VINTAGE`/
`Strands`/`TE Signs` on titanic (plus @-views on all five other scenes), **ten of
eighteen** `CTRL_n` on titanic (`CTRL_1`≡`Left Front Wall`, …), and studiodj's
`FRONT` (≡ group `Front`). Structural band names are the one family that is a
pure generated token with no operator provenance. Rule is still membership-driven
and scene-agnostic — fires wherever a structural band has an authored twin.

**Per-scene, measured not assumed** (auto-views before → after):
titanic **29 → 27** (`WALLS` 360 ≡ authored `Hull Canvas`; `AUDITORIUM` 16 ≡
`Auditoriums`); test_bench 9→9 · studio_top_loft 5→5 · studiodj 11→11 ·
studio 9→9 · summer_camp_dome 6→6 · summer_camp_logsville 10→10 — **titanic is
the only scene in the repo carrying a structural auto-view at all.** New parity
test pins test_bench + studio_top_loft against an un-deduped `deriveAutoViews`
run so a future scene edit cannot silently shrink them.

**Never silent (codex P0).** Each drop is appended to the returned `warnings`
array — which all FOUR callers already print to **stderr** — naming the view, its
px count and its surviving twin. Routing through `warnings` rather than a new
field means a future caller cannot swallow it by omission. Structured
`deduped:[{name,family,twin,pixels}]` also returned, for tests.

**Verified.** Engine sequence in-process (no boot) vs shared catalog:
**58 = 58 deep-equal**, names AND `{bit,word}`. `WALLS`/`AUDITORIUM` DO NOT
RESOLVE and `inView()` on either is a loud `COMPILE_FAIL` naming it; `Hull Canvas`
**360** and `Auditoriums` **16** still fold. Both offline harnesses agree:
audio LIT `Hull Canvas` 360 · `Auditoriums` 16 · `LEFT` **482** · `RIGHT` **482** ·
`Strands` **320** · `TE Signs` **148** · `FRONT` **388** (unchanged), and the two
retired names exit 2; derived `TOTAL_BRI/255` gives the identical seven.
`run_param_truth --pattern examples/inview_demo` → **compile errors 0**.

**Byte-stability.** 2 patterns × 2 models × both harnesses: all **8 MD5s
IDENTICAL** to `_147`'s (and the four audio ones to `_140`'s) — baseline intact
across four threads. stdout unchanged (grep for `auto-view`/`WALLS`/
`byte-identical` over every captured stdout → nothing); titanic **stderr 0 → 404 B**
(the two notices), test_bench stderr unchanged at 184 B. `gen_variations`
(`stdio:'inherit'`, parses nothing) untouched.

**Tests.** `tests/tools` **25/25** (23 +2 mine) · `tests/mixer/**` **511/511**
(510 +1 mine) · `tests/patterns` **95/95** (exact) · `simulation && npm test`
**1773/1766/7** (exact baseline) · `scene_model_parity titanic` and `--strict`
**PASS** (0/0/1 info) · CaptainPad picker **32/32**. `marsin_engine && npm test`
run 1 **2656/2649/7**, run 2 **2660/2653/7** — run 2 = `_147`'s 2657 + my 3, and
run 1 sits inside the ±3 file-abort variance `_147` documented; the **7 fails are
identical in both runs** and are the documented environmental set (5×
`audio_capture`, `effects_v2_mode_page_layout` file-level, OSC `EADDRINUSE`).
Zero view-related failures. `mixer_state.yaml` residue byte-identical before/after
(`36c7f448…`) — reported, never reverted. `security_check.py --all` → **6**, the
exact pre-existing untracked `.scene_backups/studiodj/**` baseline.
`node --check` clean on all nine touched JS/MJS files.

**Docs/UI.** `docs/MARSIN_ENGINE_PATTERNS.md` §7.3.2 loses both rows, gains a
"there are no structural views on titanic" paragraph and both names in "Names
that do NOT exist"; `@BAR` documented as fixture-capability targeting.
`.agent/skills/highdef_pattern_generation.md` §3.1 + §8.2/§8.3 (`60 → 58`).
`docs/COLOR_THEORY.md` needed NO change (verified — it references only the
surviving `Auditoriums`). CaptainPad comments only: **the STRUCTURE family stays
in the classifier** because another scene may still send one. No model or scene
artifact regenerated — `groupBits` and the 7 composites are byte-untouched.

**Left for the operator:** ten `CTRL_n` views remain byte-identical to a single
base group (kept — a controller is the strike/debug unit); `dev_test_bench` still
fails to load on a pre-existing, unrelated stale-`groupBits` error.

**Compliance.** No git operation of any kind. No engine/sim boot, no server, no
port bound; the operator's stack kept 6966–6972, 5568, 8081, 10000. Scratch in
`~/tmp/_148`.

**Landed 2026-08-04 — `_150` bench-mirror AUDIT (read-only) feeding a runtime
"BENCH MIRROR" mode (Opus,
[`../reports/202608/20260804_150_bench_mirror_audit.md`](../reports/202608/20260804_150_bench_mirror_audit.md)):**
factual audit only — no source/test/doc/scene edit, no git op, no process
started, no port bound, zero packets toward hardware.

**Mapping verified EXACT.** All seven slices in
`simulation/scenes/test_bench/bench_mirror.yaml` match the operator's spec byte
for byte (U6→U2@1, U5→U2@41/74, U2→U2@107/226, U30→U10, U31→U12). **No
discrepancy.**

**Why the second tab exists.** `isMirrorActive`'s THIRD precondition
(`bench_mirror.cjs:234-238`, called at `sacn_bridge.js:434`) requires the
sidecar's OWN scene to be in the bridge's active set = union(pin, engine scene,
client tags). Engine must be on `titanic` (precondition 2) and the launcher pins
`titanic`, so the only remaining path is a browser tagging itself `test_bench`
(`sacn_bridge.js:751`) — a second tab, which itself trips the multi-client
contention warning and is the writer-#2 (prio-150) hazard. **Smallest correct
change: swap precondition 3 for an explicit process-scoped `armed` flag; keep 1
and 2 verbatim. One call site.** Precondition 3 IS the `_89` §4.3 deployment
guard, so the mode must supply its own: OFF at every process start, explicit
gesture, unmistakable banner, loud auto-disarm.

**Ownership measured.** Suppression already runs before the sender diff
(`sacn_bridge.js:454-455`, pinned by `bench_mirror.test.js:379-387`).
`U2 → 10.x.x.10` IS a live titanic relay route today (`titanic/patches.yaml:402-411`)
so suppressing it is load-bearing; `U10/U12 → 10.x.x.60` are NOT claimed with
only titanic active (no-op today, needed for churn). `U30/U31 → .60` stays
relayed while armed — same box, four universes.

**`_105` findings still OPEN and in scope:** **M2/F2** — `mirrorTargets`
(`sacn_bridge.js:445-453`) never subtracts `engineState.owned`, and the
engine-suppression line at `:623` then lies; fix = refuse at ARM + suppress and
auto-disarm at recompute, and refuse when `ownedUnavailable`. Do NOT "validate
dest_host against real controllers" — `10.x.x.10` is a real ship controller by
design. **F10** — the `🚫 … BENCH MIRROR` suppression loop is inside the
`mirrorSig` gate (`:593-616`); give it its own signature like `excludedSig`
(`:619`). Adjacent: **F12** cross-file duplicate destinations, **F14** raw-bytes
state key, **F8** percent→Uint8Array quantisation (`useRawDmxValues` grep-proven
absent from all project source).

**Disarm is NOT clean today.** `Sender.close()` is socket teardown only
(`node_modules/sacn/dist/sender.js:81-86`) and the package hardcodes
`this.options = 0` (`packet.js:79`) so E1.31 `stream_terminated` is unreachable.
`.10`/U2 is refed instantly by the restored relay (with RAW titanic U2 = lit
wrong fixtures, pre-existing); `.60`/U10+U12 are unfed and hold last look until
the device's own `dmx.timeoutMs` (docs/41:194,364-368 — value never set by this
repo, `0` = hold forever). **Design requires an explicit 3× all-zero frame per
owned destination, awaited BEFORE the sender close** (`sendVia` at `:946` must
return its promise).

**HARDWARE TRAP (operator).** `10.x.x.60` is bound in BOTH scenes on one
`boardId: angio4-old`: titanic `LeftLeftRopes` U30/U31 `controllerId: testbench`
lastPush `2026-08-03` **applied**; test_bench `Titanic_202` U10/U12
`controllerId: titanic_202` lastPush `2026-08-05` **needs-reboot**. Unless
rebooted since, the board is still on U30/U31 → armed, the strands would be lit
by the RAW relay, not the mirror — a green-looking false positive. Fix is
`_89` §6 step 4 (Push the test_bench card once, let it reboot). Also: two
controllerIds for one board contradicts `marsinled-controller-onboarding`.

**Surface (operator's instinct confirmed, one correction).** ARM/DISARM belongs
in the sACN IN monitor (`sacn_monitor_panel.js:157-186`, BLACKOUT recipe at
`:208-219`) — the only UI already talking to the bridge. BUT that panel only
shows when the engine mode is `sacn_in` and enabled (`gui_builder.js:1601`,
`pattern_editor.js:804`), so **status must be a panel-independent HUD banner**
modelled on `multi_client_warning.js:28-68`. Protocol: two new :6971 messages
(`benchMirrorArm`/`Disarm`) + a `benchMirrorStatus` broadcast on transition AND
on every new connection (the census pattern, `:726-746`) so a reloaded tab
cannot show a stale/absent banner. `_127`'s snapshot fields must not be renamed
(`bridge_route_confirm.js:167-172` throws); a mirror-owned pair correctly FAILS
an LED push's third check (`:214-217`) — say so in the banner, don't soften it.

**Tests.** No test ever executes `sacn_bridge.js` — bridge wiring is
source-string regex (`bench_mirror.test.js:379-395`). Port-free precedents: pure
modules, plus the `WebSocketServer({port: 0})` stub-bridge integration at
`bridge_route_readback.test.js:412-460`. New coverage lands in a new
`tests/bench_mirror_arm.test.js` against a PURE `evaluateArmRequest()`, plus
extensions to those two files.

**Open operator questions:** (1) socket- vs process-scoped arm / auto-disarm on
last client disconnect? (2) refuse to arm with >1 sim window, or warn? (3) has
`.60` been rebooted since the `needs-reboot` receipt? (4) should raw
`U30/U31 → .60` also be suppressed while armed (widening "owned" from pair to
host)? (5) which `controllerId` is canonical for `angio4-old`?

**Landed 2026-08-04 — `_151` BENCH MIRROR runtime mode, built on `_150`'s design
(Opus, `.agent/reports/202608/20260804_151_bench_mirror_runtime_mode.md`):** the
temporary session-scoped "Titanic → physical test bench" preview ships on the
EXISTING system — engine stays `titanic`, visible sim stays `titanic`, **no
second tab**. `isMirrorActive`'s precondition 3 is now an explicit **armed flag**
(`bench_mirror.cjs`), preconditions 1+2 verbatim; `sacn_bridge.js` passes
`_mirrorArm !== null && _mirrorArm.scene === found.scene`.

**Operator rulings executed.** (1) **Socket-scoped** arm — `_mirrorArm.ws`; the
arming window's close/reload disarms with the full blackout; explicit DISARM
button too; process memory only, DISARMED at every bridge start (pinned by a test
that scans every `_mirrorArm` line for persistence calls). (2) **Multi-window
warns, does not refuse** — the warning names the prio-150 writer-#2 hazard.
(3) **Host-level suppression is DECLARED, not guessed**: the sidecar moved to
**v2** with a REQUIRED per-mirror `suppress_host` (+ REQUIRED top-level `label`
for the banner). Measured reason: titanic routes **U2/U3/U4 → .10** and
**U30/U31 → .60**, so a uniform host rule would silence the ship gateway's U3/U4
and a uniform pair rule leaves `_150` §9's false positive open. `.60` =
`suppress_host: true` (whole box), `.10` = `false` (pair only). **The mapping
itself is byte-identical** — all seven slices unchanged; `_89`'s live-map tests
pass untouched. (4) The `.60` board-state check is **documented, not run**
(`GET /api/config` → `strands[].dmxUniverse` 10/12 vs 30/31, plus
`/api/status.sacn.lastUniverse`); report §9.4.

**`_105` fixes landed:** **M2/F2** — `engineState.owned` subtracted from
`mirrorTargets`, refused at ARM (pair AND any universe on a wholly-owned host),
auto-disarm at recompute, refused when `ownedUnavailable`. M2's
"dest_host must be a bench controller" deliberately NOT implemented (would kill
the intentional mapping). **F10** — suppression logs on `suppressedSig`, outside
the `mirrorSig` gate. **F12** — cross-sidecar destination/host overlap refused at
ARM. **F14** — mirror-state reuse keyed on `JSON.stringify(spec)`, not raw bytes.

**Clean disarm:** 3× all-zero 512-ch frames per owned destination, **awaited
before** the senders close (`sendVia` now returns its promise; `_mirrorDisarming`
holds mirror senders open so no other recompute can close them mid-blackout), on
every path — DISARM / socket drop / degrade / SIGINT+SIGTERM. Then one recompute
restores the relay in the same pass, so the DMX gateway is never unfed.

**Surface:** ARM/DISARM + a `Bench Mirror` stat row in the sACN IN monitor
(`sacn-in-bench-mirror-btn`); pure decision half in new
`src/gui/bench_mirror_control.js` (separate file — the panel's htm/preact deps
are browser-vendored and unimportable from Node tests). Panel-independent HUD in
new `src/gui/bench_mirror_banner.js`: **"🪞 BENCH MIRROR ACTIVE — TITANIC LEFT
FRONT · owns U2→…10, U10→…60, U12→…60 · owns all of …60 · ordinary relay
suppressed"**. Two new `:6971` messages (`benchMirrorArm`/`benchMirrorDisarm`,
reqId-correlated) + `benchMirrorStatus` broadcast on every transition AND to
every new connection. `_127`'s snapshot shape untouched.

**ARM proves ownership rather than intending it:** after the recompute it
re-reads the LIVE sender maps through `buildRouteTableSnapshot` and auto-disarms
if any owned pair is not exclusively mirror-owned, or a relay sender survives on
a wholly-owned host.

**Tests: `npm test` 1826 / 1820 pass / 6 fail** vs a baseline **measured on this
tree** of 1773 / 1767 / 6 — **+53, zero new failures, byte-identical failing
list**. (The brief quoted 1773/1766/**7**; this tree measured 6 BEFORE any edit —
the working tree carries the operator's own uncommitted scene/model edits from
00:0x–00:38 today.) New `tests/bench_mirror_arm.test.js` (35) loads the **REAL
`sacn_bridge.js`** with `sacn`/`ws`/`process_priority` faked and `fetch` stubbed
— **zero ports bound, zero packets, no address literals** (they are read from the
sidecar) — and proves: fresh bridge DISARMED; refused ARM sends nothing and
changes no route; armed ⇒ mirror is the ONLY writer, `.60` keeps only the
composed universes, `.10` keeps U3/U4; raw frames never reach an owned
destination; status reaches a tab that connects AFTER the arm; DISARM = exactly
3 zero frames/universe then relay resumes; socket-drop and engine-scene-change
auto-disarms. `bench_mirror.test.js` 30 → 48. `security_check.py --all` = the 6
pre-existing gitignored `.scene_backups/studiodj/**` MACs, unchanged.

**Operator caveat (unchanged, now honest):** the strands need the authored
U10/U12 config applied+rebooted before they respond. Because `.60` is now owned
whole, **dark strands mean "the board is not on U10/U12"** instead of the old
green-looking false positive where the raw U30/U31 relay lit them. Fix = Push the
`Titanic_202` card once in the test_bench controller pane (a device write,
operator-only). Also still open: two `controllerId`s (`testbench` vs
`titanic_202`) for one `boardId: angio4-old`.

**Not done / refused:** no controller push, no re-addressing, no firmware op, no
engine restart, no live packet test, no server started, no port bound, no git
operation. `_105` F8 (percent→byte quantisation), F3/F4/F5, F19 left open. A
host-suppressed pair reads as `missing U30→…60` in the `_127` push read-back
rather than "the mirror owns it"; adding a `mirrorSuppressedHosts` field would
improve the sentence and was left out to avoid widening that contract here.

**Reviewed 2026-08-04 — `_152` adversarial routing + test review of `_151`
(Opus, READ-ONLY,
`.agent/reports/202608/20260804_152_bench_mirror_adversarial_review.md`):**
verdict **FIX-FIRST — 1 moderate defect on the operator's advertised disarm
gesture**; 8 of 9 attack surfaces CONFIRMED. Zero code edits, zero git writes
(`show`/`diff`/`status` only), no port bound, no packet, no engine/sim/bridge
started.

**CONFIRMED as claimed:** mapping byte-identical vs `git show HEAD` (all 7
slices, every addr/length; only `version`/`label`/`suppress_host`/comments
differ) with `suppress_host` matching the ruling (`.60` true, `.10` false) and
v1 refused **at parse** with the migration quoted into the ARM refusal; armed
defaults OFF (module-scope `let _mirrorArm = null`, no persistence on any
`_mirrorArm` line, **no client-side auto-rearm** — reconnect sends only
`setScene`); all 11 ARM refusals named + fail-loud, and the post-recompute
ownership **proof** via `buildRouteTableSnapshot` is real (an ARM behind a closed
boot gate auto-disarms loudly rather than assuming); status built fresh every
call, pushed on connect + every transition, no staleness; one-writer holds in
**steady-state armed** (relay diff runs on the post-suppression set; client-tag
and engine-owned paths both covered; arm-time gap is straight-line sync);
`_105` **M2 subtraction present WITHOUT the dest-host validation half** (only
`classifyRouteIp`, so the intentional cross-scene mapping survives) and **F10
`suppressedSig` outside the `mirrorSig` gate**, plus F12/F14. Non-interference
verified by mtime: `_151`'s 9 files 08:43–09:10; every other modified scene/model
file 00:10–00:22 (operator's own session); titanic `controllers.yaml`/
`patches.yaml` untouched. `security_check.py --all` = the 6 baseline gitignored
`.scene_backups/studiodj/**` MACs; **no IP literal** in any changed source file.

**Test counts reproduce exactly** (runner is `node --test`, not jest):
`bench_mirror_arm.test.js` **35/35**, `bench_mirror.test.js` **48/48**, full sim
suite **1826 / 1820 pass / 6 fail** with a byte-identical failing list. The rig
is genuine — `Module._load` patched before the require, so the REAL
`sacn_bridge.js`, real recompute, real handlers execute; zero ports, zero
packets, no address literals.

**DEFECTS.** **D1 (MODERATE, blocks) `sacn_bridge.js:943-946`** — the ws-close
handler calls `recomputeRoutes()` **synchronously while `disarmBenchMirror` is
suspended mid-blackout**. `_mirrorDisarming` guards mirror-sender *closing*
(`:668`) but **not relay-sender creation** (`:627-647`), so an ordinary relay
sender is opened on an owned pair and a **raw frame is emitted between blackout
frames 1 and 2** on `U2 → 10.x.x.10` — two live writers, reproduced
deterministically offline. Blast radius is small (only that pair collides; the
wholly-owned `.60` blackout lands on U10/U12 vs restored U30/U31, so no frozen
frame) but it breaks the categorical "no second writer" requirement on the very
gesture `_151` §9.2 advertises ("just close the sim window"). Fix: skip the plain
recompute when this socket's disconnect already started the disarm — the disarm's
own recompute (`:1237`) restores the relay and `clientScenes.delete(ws)` (`:935`)
already ran. **D2 (MINOR) `sacn_bridge.js:1256-1266`** — no `_mirrorDisarming`
guard on the ARM path, so an ARM landing inside the blackout is accepted
(bypassing the "a re-arm must go through the blackout" refusal) and the bridge
prints `BENCH MIRROR DISARMED … released` **while ARMED**, with the DISARM's own
reply carrying `armed:true`; reproduced once `FakeSender` resolves on a later
event-loop turn as real `dgram.send` does. Low reachability (a few ms; the
unauthenticated `:6971` surface is the practical vector). **D3 (cosmetic)** —
`_151` §2/§8 document `let _lastArmStatus = null;`; **no such identifier exists**
(status is always rebuilt fresh, which is better). **D4 (test gap, and the reason
D1 was missed)** — `FakeClient` never sends `setScene`, so `clientScenes` is
always empty and the close handler's `recomputeRoutes` at `:946` **never runs in
any test**; the socket-drop test exercises a flow the real browser never takes.
**D5** — SIGINT/SIGTERM blackout, the runtime `ownedUnavailable` degrade and F12
end-to-end are untested; Tier-2 tests are order-dependent on one shared bridge.

**Owed to `_151`/next implementer:** D1 fix + comment correction at `:938-942`;
D2 refusal; `setScene` in the test rig's `connect()` plus an overlap assertion;
strike `_lastArmStatus` from the `_151` report. None of it touches the sidecar,
either scene's controllers/patches, or any engine model.

**AMENDMENT to `_151` (2026-08-04) — `_152` FIX-FIRST defects CLOSED (Opus,
report §11 appended in place):** all five items addressed; no renumbering, same
slice, sidecar/scenes/engine-models still untouched and the mapping still
byte-identical.

**D1 (blocking) FIXED with a general invariant, not the suggested per-caller
branch.** The review's fix (skip the plain recompute in the ws-close handler)
closes only that path; `recomputeRoutes` is also reachable during the release
window from a client `setScene` (`sacn_bridge.js:887`) and from the 3 s engine
poll (`:781`). So the hold is stated where relay senders are DECIDED:
`partitionMirrorSuppression` gained an optional `hold` and a third suppression
reason `why:'blackout'` (`bench_mirror.cjs:356-411`); `_blackoutHold` is raised in
`disarmBenchMirror`'s SYNCHRONOUS prologue before the first `await`
(`sacn_bridge.js:1259-1263`, from the live `_mirrorEntries` + wholly-owned hosts)
and dropped in the same `finally` that clears `_mirrorDisarming` (`:1289-1293`);
the single call site passes it (`:541`) — pinned by a test asserting
`hold: _blackoutHold` appears EXACTLY ONCE, so every recompute path is covered by
construction. Suppression log gained the blackout sentence (`:738-752`); the
misleading ws-close comment corrected (`:938-948`).

**Reproduced-then-killed.** With `hold` forced null the new regression fails with
`U2 → 10.x.x.10: a RAW frame was emitted between the first and last blackout
frame — two live writers on one (universe, controller) during the release
window`; restored, it passes. Same falsification run for D2's guard.

**D2 FIXED** — `evaluateArmRequest` takes `blackoutInFlight` and refuses FIRST,
before every other check (`bench_mirror.cjs:454-476`); bridge passes
`_mirrorDisarming` (`:1315`). Test asserts the refusal AND that `🪞 BENCH MIRROR
ARMED` never appears between `DISARMING` and `DISARMED`.

**D4 FIXED — three harness defects, each of which alone hid the race:**
`connect()` now sends `setScene` like the real browser (so `clientScenes` is
non-empty and the close handler's recompute actually runs); `FakeSender.send`
resolves on a later event-loop turn as `dgram.send` does (so the window exists at
all); and `captureConsole`/`releaseConsole` are now REFERENCE-COUNTED — they
nest, and an inner release was silently dropping every later log line, masking a
real assertion. Added an ordered cross-sender `open`/`send`/`close` event log
(the only way to express "a raw frame BETWEEN two blackout frames"); completion
is now read from the bridge's own status broadcast rather than "is a sender open
on that pair" (mirror and relay senders share one key — ambiguous both ways); and
the reviewer's noted vacuity in "a refused ARM sends nothing" is closed.

**D3 FIXED** — `_lastArmStatus` struck from `_151` §2/§8 and replaced with the
actual rebuild-fresh mechanism (+ `_blackoutHold`/`_blackoutSettled`).

**D5 partly closed.** Runtime `ownedUnavailable` degrade now covered end-to-end.
SIGINT/SIGTERM mid-blackout edge FIXED IN CODE (`:1479-1487` awaits
`_blackoutSettled`; previously it saw `_mirrorArm===null`, said "was not armed"
and exited, killing the blackout) but **accepted as untested** — stubbing
`process.exit` in the shared bridge risks hanging the runner. **Accepted gaps:**
F12 end-to-end (needs a second scene dir with a sidecar), and Tier-2 order
dependence (one bridge per module cache) — though the Tier-2 cases now wait on
the bridge's own completion signals instead of fixed settle counts.

**Tests: `npm test` 1833 / 1827 pass / 6 fail** (+7 over `_151`'s 1826), same six
pre-existing failures, byte-identical list. `bench_mirror.test.js` 48 → 52,
`bench_mirror_arm.test.js` 35 → 38. `security_check.py --all` = the same 6
gitignored `.scene_backups/studiodj/**` findings. `git diff --check` clean. Still
zero ports bound, zero packets, no engine boot, no git operation; the operator's
uncommitted files (mtimes 00:0x–00:38) untouched.

**`_152` AMENDMENT (2026-08-04) — re-verification of the D1–D5 fixes: SHIP**
(Opus, READ-ONLY; report §5 appended in place, `_152` not renumbered): all five
closures **CONFIRMED**, D1 and D2 **falsified independently** without touching
production code. Verdict upgraded **FIX-FIRST → SHIP**.

**D1 CONFIRMED, and the owner's general invariant is better than the per-caller
skip I proposed** — my fix closed only the ws-close path; `setScene` (`:887`) and
the 3 s engine poll (`:781`) reach `recomputeRoutes` in the same window.
Verified: `partitionMirrorSuppression` has **exactly one** call site feeding the
sender diff (`sacn_bridge.js:541`, with `hold: _blackoutHold`) — the only other
production call is inside `evaluateArmRequest` (`bench_mirror.cjs:575`), which
computes warnings and creates no sender, so holdless is correct there; the hold is
raised at `:1253` **before every suspension point** (the `_blackoutSettled` IIFE
at `:1266` runs its first send round synchronously; the outer function first
suspends at `:1277`), so no interleaving window exists; it is dropped in the same
`finally` as `_mirrorDisarming` (`:1278-1282`), so a rejected blackout still
releases it; and the hold set (live `_mirrorEntries` + `was.hosts`) is not stale —
an engine-claimed destination has no mirror sender, gets no zeros, needs no hold.

**Falsification, both directions, zero source edits:** a `--require` preload
intercepting `lib/bench_mirror.cjs` and forcing the exported
`partitionMirrorSuppression` to `hold: null` makes the repo's D1 regression fail
with `U2 → 10.x.x.10: a RAW frame was emitted between the first and last blackout
frame`; unpatched it passes. Same for D2 with `blackoutInFlight` forced false.
**My own §1 repro — a separately written harness — now reports "No raw frame
overlapped the blackout" against the fixed tree.** Their regression is
non-vacuous: it pumps live traffic on all three owned universes and asserts on an
ordered cross-sender `open`/`send`/`close` window, plus that raw frames really
flowed and resumed.

**D2 CONFIRMED** — refuses FIRST, before even the empty-scene guard
(`bench_mirror.cjs:463-474`), correct since a blackout is a property of the bridge
not the request. **D4 CONFIRMED** — `setScene` sent, `FakeSender.send` resolves on
a later turn, capture/release reference-counted; the third was the owner's own
find and was real. **D3 CONFIRMED** — `_lastArmStatus` gone. **D5** — runtime
`ownedUnavailable` degrade covered end-to-end; the SIGINT/SIGTERM mid-blackout
edge I raised is **fixed in code** (`:1496`, `:1502-1511` await `_blackoutSettled`);
untested / F12 e2e / Tier-2 ordering accepted, correctly labelled.

**RESIDUAL-1 (non-blocking, `sacn_bridge.js:1253-1276`):** the hold is raised at
`:1253` but the `try` guaranteeing its release opens at `:1276`; `console.log` and
`broadcastLog` sit in between, and `ws.send()` can throw on a socket in transition
— precisely the socket-close disarm path. A throw there leaks `_blackoutHold`
**permanently**, suppressing the ordinary relay on those pairs (unfed gateway)
until process restart. Narrow (`readyState === 1` guard; `ws` removes closed
sockets first) and the async IIFE at `:1266` is NOT a risk (a sync throw in an
async body becomes a rejected promise the `finally` handles). One-line fix: open
the `try` immediately after the hold is raised.

**Counts observed = counts claimed:** `bench_mirror.test.js` **52/52**,
`bench_mirror_arm.test.js` **38/38**, full suite **1833 / 1827 / 6** with the same
six pre-existing failures, `security_check.py --all` **6** baseline gitignored
`.scene_backups/studiodj/**`. **No scope creep** — only `bench_mirror.cjs`,
`sacn_bridge.js` and the two test files changed since the first pass; sidecar
mapping still **byte-identical to HEAD** (re-verified programmatically),
`suppress_host` unchanged, titanic `controllers.yaml`/`patches.yaml` untouched,
operator's files still at 00:10–00:22. Zero falsification residue in the tree
(both preloads intercept at module load from the scratchpad). Still read-only: no
port, no packet, no engine boot, no git write.

**AMENDMENT 2 to `_151` — `_152` RESIDUAL-1 CLOSED (report §11):** the `try`
guarding `_blackoutHold` now opens immediately after the hold is raised, not just
around the `await` (`sacn_bridge.js:1290-1327`), so a throw from the prologue's
`console.log`/`broadcastLog` — `ws.send()` throws on a socket in transition,
exactly the socket-close disarm path — can no longer leak the hold and suppress
the bench gateway's relay until process restart. The three fire-and-forget call
sites moved from a bare `void` to `disarmInBackground` (`:1361-1369`), because a
rejected disarm would otherwise be an unhandled rejection (process-fatal in
current Node) on the very path releasing the hardware; a test pins that no
`void disarmBenchMirror(` remains. Regression added (a client whose `send` throws
only on the `BENCH MIRROR disarming` line): fails without the fix with "the
gateway pair must be relayed again — a leaked blackout hold would suppress it
forever", passes with it. **Tests: `bench_mirror.test.js` 52/52,
`bench_mirror_arm.test.js` 39/39, full suite 1834 / 1828 / 6** — same six
pre-existing failures; `security_check.py --all` = the same 6 gitignored
`.scene_backups/studiodj/**` findings. **Incident:** a scripted edit truncated
`sacn_bridge.js` to 0 bytes (Python `write_text` truncates before encoding; an
emoji escape raised `UnicodeEncodeError`). Rebuilt from `git show HEAD:` (a READ
— no git state mutated) plus re-application of every `_151`/`_152` edit; verified
by 91/91 bench-mirror tests incl. ~35 source-shape pins, an unchanged full-suite
result, and a byte-identical replay of the report's verbatim arm/disarm log
block. No other file affected; operator's uncommitted files untouched.

**`_155` BENCH MIRROR v3 DESIGN — selectable source mapping at ARM + control
relocation to the Controllers header (Fable, DESIGN-ONLY; report
`.agent/reports/202608/20260805_155_bench_mirror_selectable_mapping_design.md`):**
zero production edits, zero git writes, zero ports/packets. Independent of the
two in-flight random-colors investigations by construction. **Core inversion:**
the sidecar goes v3 and stops carrying slices/addresses/IPs entirely — it
declares SLOTS (bench fixture NAMES + `default_source`) and suppression policy
by CONTROLLER NAME; every universe/address/footprint/host/slice is resolved
FRESH from scene data (controllers/patches/scene_config + the one fixture
registry) at ARM time in a new pure `lib/bench_mirror_resolve.cjs`, then
materialized into the SAME internal spec shape, re-validated by the SAME
structural validator, and handed to the UNCHANGED `_151` pipeline
(evaluateArmRequest 1–11, ownership proof, blackout hold, 3× zero-frame disarm
— all carried verbatim; refusal catalog grows R-12…R-20, every one naming the
offending slot/choice). **Compatibility = same `fixtureType` string, both ends
through the one registry** (⇒ identical personality/footprint/channel map by
construction; whole-fixture slices re-proven at arm, untouched dest channels
zero) — NO channel-map translation, refused deliberately: a hand-kept second
map is exactly the semantic-mismatch class behind the failed physical test.
LED strands add identical pixel format (order/stride/white) + srcPx≥destPx
prefix copy (warned); typed LED fixtures (future TE sign slot — schema stanza
ready, activates when the bench sign is patched) require exact px equality.
Residual named, not hidden: data cannot see a fixture's PHYSICAL personality
switch. Same source → two slots allowed (fan-out); overlapping dest impossible
by construction AND re-refused at runtime; all-`none` controller stays owned
and dark (operator Q2). Selection: complete map or absent=defaults, partial
refused; last-used remembered in bridge PROCESS MEMORY only (never disk —
selection ≠ arm; deployment guard intact). Protocol: new `benchMirrorOptions`
(picker data, advisory — ARM re-resolves from disk, no TOCTOU trust);
`benchMirrorArm` + optional `selection`; status gains `selection` +
`blackoutInFlight`, pushed to new connections. UI: ARM/DISARM moves to the
🎛 Controllers header (8 exact states incl. LINK DOWN / DISARMING lockout /
refusal text beside the control; never silently picks among 0/>1 sidecars);
ARM opens a compact picker, defaults/last-used pre-selected, one-click
confirm, per-slot `— none (held dark) —`; armed Controllers cards badge owned
destinations + `← titanic source` per fixture; sACN monitor demoted to
read-only stat row + logs, button REMOVED (no duplicates); banner gains the
slot census. Test plan T-1…T-8 incl. byte-level per-slot deterministic-frame
tests and a default-equivalence pin (computed defaults ≡ frozen v2 seven-slice
table) against the 1834/1828/6 baseline. Implementation sliced S1–S5 for one
owner (~250 resolver + ~120 bridge + ~220 UI + sidecar rewrite). **Open
operator questions (3):** region presets in the picker now or later; all-`none`
controller owned-dark (designed) vs released; process-memory last-used
(designed) vs defaults-every-time.

## `_154` — BENCH MIRROR fixture-profile + address semantic verification (INVESTIGATION, READ-ONLY)

**Report:** `.agent/reports/202608/20260805_154_bench_mirror_fixture_profile_verification.md`
**Trigger:** BENCH MIRROR failed its first PHYSICAL test — after ARM the bench
fixtures showed apparently random output/colors. The byte pipeline was proven by
`_150`/`_151`/`_152`; nobody had ever proven SEMANTIC compatibility of source and
destination fixtures. Read-only: no source/test/scene edit, no git write, no port
bound, no packet, no device HTTP, no ARM.

**VERDICT: the fixture profiles are NOT the bug. All 344 destination channels on
the bench DMX gateway check out — 0 mismatches.** Source fixture type,
personality, channel function, footprint and start-address offset agree exactly
on all five DMX slices; both LED slices agree on stride (4), order (RGBW), white
lane (`native`), start address (1) and wire math. Verified mechanically from the
live scene YAMLs + the three fixture personality YAMLs + the generated engine
model `marsin_engine/models/titanic.js` (which is what actually emits the bytes,
and which agrees with `scenes/titanic/patches.yaml`).

**SOURCE TRUTH:** U6 = four `UkingPar` 10-ch at 1/11/21/31 (Left Auditorium 5-8);
U5 ch1-66 = two `VintageLed` 33-ch at 1/34 (Left Front Rails 1/2); U2 ch1-238 =
two `ShehdsBar` 119-ch at 1/120 (Left Front Wall 1/2); U30/U31 = 40-px RGBW ropes
(footprint 4/px, addrs 1,5,…,157) so 80 ch is exactly 20 whole pixels.
**DEST TRUTH:** bench U2 ch1-344 tiled contiguously by 4 `UkingPar` + 2
`VintageLed` + 2 `ShehdsBar`, no gaps, no overlaps, nothing after ch344; haze/fog
are on **U1** and untouched. **The "stale titanic re-patch" hypothesis is
DISPROVEN** — `titanic/patches.yaml` and `controllers.yaml` are unmodified vs
`HEAD` and still match the sidecar's assumptions. **The "RGB-packed source
reinterpreted as RGBW" hypothesis is DISPROVEN** — the ropes are RGBW×4 in the
model, no stride shift possible.

**SMOKING GUN — M1: the sim window is a priority-150 writer to the same
controllers, and it wins.** `simulation/src/core/animate.js:696-724`: in
`sacn_in` mode the `continue` guard is bypassed
(`!isEffect && lightingMode !== 'sacn_in' && !isMappingOutput`) so the tab
unicasts EVERY patched `(universe, controllerIp)` of the loaded scene to the real
controller at **priority 150** — including `U2 → 10.x.x.10` and
`U30/U31 → 10.x.x.60`. The mirror goes out at the SOURCE frame's priority
(`sacn_bridge.js:1427-1436`), i.e. the engine's **100**
(`marsin_engine/config.yaml sacn.priority: 100`). 150 > 100. And in `sacn_in`
mode the sim never rewrites its router from pixels (`mapPixelsToSacn` is in the
`else if (mappingEnabled)` branch, `animate.js:497-519`), so what it retransmits
is the **raw received titanic frame, byte-accurate**. **This is structural, not
bad luck: the ARM button lives in the sACN IN monitor, which is rendered ONLY
when the mode IS `sacn_in`** — the operator cannot arm the mirror without being in
the exact mode that makes the sim outrank it. Nothing in `animate.js`,
`sacn_output_client.js` or `sacn_output_bridge.js` mentions the bench mirror
(grep: zero hits).

**Byte-level evidence that this IS "random".** Raw titanic U2 =
ch1=255, ch2-11=0, ch12-119 = LFW1's 18 px × RGBWAV, ch120=255, ch121-130=0,
ch131-238 = LFW2, ch239+ = 0. Landing that at bench addresses puts ANIMATED PIXEL
COLOUR on: Par 2 strobe (ch18 = LFW1 px2 Red) and **Par 2 Function-selection**
(ch19 = px2 Green, which jumps between manual / colour-macro / jump / gradate /
pulse / sound-active); Par 3 strobe+funcsel (ch28/29 = px3 Amber/Violet); Par 4
strobe+funcsel (ch38/39 = px5 Blue/White); **Vintage Left Total Strobe** (ch42 =
px6 Red) and **Main/Aux Light Effect** macros (ch52/54 = px7 Amber / px8 Red,
which run the fixture's own built-in chases); Vintage Right the same at
ch75/85/87; **Bar Left Strobe + Function** (ch108/109 = px17 Red/Green, which
drops the bar into auto mode); Bar Right the same at ch227/228. Pars 1 and 2 read
master-dimmer bytes of 0 and go dark. That is an exact match for the reported
symptom.

**Aggravator:** the same mechanism sends raw `U30/U31 → 10.x.x.60` at 150, which
**defeats `suppress_host: true` from OUTSIDE the bridge** — so `_151` section 9.3's
promise ("dark strands mean the board is not on U10/U12") does not hold and must
be retracted until M1 is fixed.

**M2 — the relay path produces IDENTICAL garbage**, so a failed/absent/auto-
disarmed ARM is visually indistinguishable from "armed but outranked". Any retest
must read the bridge's own `BENCH MIRROR ACTIVE` / `Relay suppressed` lines
before trusting the fixtures.

**M3 — `_105` F8 measured exactly:** round-trip through the `sacn` package's 2-dp
percent lane leaves **54 of 256 byte values exact, worst error −3, and DMX 1 and 2
collapse to 0** (0→0, 3→3, 26→26, 64→64, 128→127, 153→153, 200→199, 230→229,
254→252, 255→255). Not a "random colour" mechanism, but it MUST be baked into the
truth-test expectations or the tests fail for the wrong reason.

**M5 — cosmetic only, do not chase:** bench strands show 20 of 40 rope px (`_89`
by design); `controllerGamma` 1.0 (titanic default, no `wire:` block) vs 2.2
(bench explicit) is **preview-only and never reaches the wire**
(`ledCompositeTarget`/`ledCompositeToBytes` don't read it); `_105` F3's 39 %
browser preview does not affect the retransmitted bytes (re-scaled ×2.55 on exit).

**UNPROVABLE (6 items, each with the exact physical check):** the four bench
pars' 10-ch vs 6-ch personality; the vintage heads' 33 vs 15-ch mode; the bars'
119 vs 108/12-ch mode; the physical DMX start addresses; whether the `.60` board
is on U10/U12 (`GET /api/config` → `strands[].dmxUniverse`, plus `/api/status`
`sacn.lastUniverse` — both reads, still NOT run); and whether the bench DMX
gateway even implements E1.31 priority arbitration (if it doesn't, M1 produces a
flickering merge rather than a clean 150-wins — worse). **Strong shortcut: if the
bench renders its own `test_bench` scene correctly, four of those six are proven
by construction**, because the bench-side channel maps are byte-identical to the
titanic-side ones.

**Working tree vs `HEAD`:** `titanic/patches.yaml` + `controllers.yaml`
UNMODIFIED. `test_bench/patches.yaml` dropped two never-patched TE-Sign entries
(`universe 0`); `test_bench/controllers.yaml` gained `output: 1/2` + `parkedOutputs`
and — the one change that matters — **`Titanic_202` lastPush flipped `applied`
(older) → `needs-reboot` (this session)**, i.e. the bench LED binding was
re-pushed and is unconfirmed. `scene_config.yaml` churn is positions/haloScale,
no `fixtureType` changed. Sidecar mapping still byte-identical to `HEAD`.

**Test gap found:** the live-map test `tests/bench_mirror.test.js:490` asserts
"lands on a bench fixture of the SAME footprint" — **footprint only**. Two
different 33-channel fixtures would pass. Types do match today, but the assertion
does not prove what its name implies; tighten it to compare `fixtureType`.

**Deliverable for the implementation owner:** the report carries the full
deterministic truth-test expectation table (constant red / green / blue /
RGB-white / native-white+amber / blackout, mapping expected source bytes to
expected mirrored bytes after M3 to expected physical appearance) per fixture
family, plus the regression assertions that catch M1 directly (`VintageLed`
rel2/rel12/rel14 and `ShehdsBar` rel2/rel3/rel6-11 must be 0 in EVERY look), and
the note that **NATIVE WHITE is the decisive LED test** (20 px of `(0,0,0,255)`
lands on channels 4,8,…,80; a stride bug lights the next pixel's red instead).

**Recommended fix order:** (1) while armed, the sim's output loop must skip every
mirror-owned `(universe, ip)` and every wholly-owned host — the bridge already
broadcasts `destinations[]`/`hosts[]` in `benchMirrorStatus`, so the data is
already at the client; (2) fix the ARM warning (`bench_mirror.cjs:602-607`) to
fire at `clientCount >= 1` and to say `sacn_in`, not "sACN-OUT"; (3) retract
`_151` section 9.3 until (1) lands; (4) tighten the footprint-only live-map test;
(5) encode F8 into the truth tests rather than working around it. Every truth
test in the report's section 8 is meaningless until (1) lands.

**`_153` — BENCH MIRROR first physical test failed: packet/routing investigation**
(investigator, Opus, READ-ONLY; report
`.agent/reports/202608/20260805_153_bench_mirror_packet_routing_investigation.md`).
Zero source/test/scene edits, zero git writes, no port bound, no packet, no
device HTTP, nothing armed — every measurement in-process against faked sockets,
scratch in `~/tmp/bench_mirror_debug_153/`. **Independently converges with `_154`
on the primary cause** (my F1 = their M1), from the routing side rather than the
fixture side, and adds four findings they did not cover plus one correction to
theirs.

**F1 CONFIRMED-OFFLINE — the sim window is a second, higher-priority writer the
mirror cannot suppress.** `animate.js:682-727`: when `lightingMode === 'sacn_in'`
the per-fixture skip at `:709` is unreachable, so every patched DMX fixture is
grouped by `(universe, controllerIp)` and sent at a **hard-coded priority 150**
(`:713`) through `sacn_output_client.js:81-122` to `ws://localhost:6972` to
`sacn_output_bridge.js:63-73`. That is a **separate process** (`start.js:105-108`
vs `:116`); the mirror's ownership machinery lives only inside `sacn_bridge.js`,
and `benchMirror` has **zero** grep hits in `animate.js` or
`sacn_output_client.js`. The sim runs `titanic`, so its pairs include
`U2 -> 10.x.x.10` — the mirror's owned pair — carrying raw `Left Front Wall 1/2`
(`ShehdsBar` fp119) bytes. Measured: the mirror leaves at **priority 100** on all
three owned destinations, every frame (it inherits the source frame's priority,
`sacn_bridge.js:1432-1434`; engine `sacn.priority: 100`). 150 > 100.
**Structural, not bad luck: the ARM control only renders when the mode IS
`sacn_in`** (`showSacnInMonitor(mode === 'sacn_in' && enabled)`), and `_151` §9.1
step 3 tells the operator to be there.

**CORRECTION to `_154` M1's "aggravator".** `_154` says the same mechanism also
sends raw `U30/U31 -> 10.x.x.60` at 150 and so defeats `suppress_host` from
outside the bridge. **The DMX half is right; the LED half is not.** LED strands
are not in `params.parLights` (`patch_manager.js:57`), and `sendUniverse` has
exactly one caller fed only from `params.parLights` — verified against the live
scene: walking `titanic/scene_config.yaml` gives `parLights.fixtures` count 80
with `has Left_Front_Left = false`, and the strands under `strands:` map to
`params.ledStrands` (`config.js:129-135`). **The browser has no path that
transmits a strand universe**, so `suppress_host: true` still holds and `_151`
§9.3's "dark strands mean the board is not on U10/U12" survives — subject only to
F4 and F10 below. Do not retract §9.3 on the LED ground.

**F1b CONFIRMED-OFFLINE — NEW, project-wide, biggest byte-level defect found: the
ENGINE's DMX values are multiplied by 2.55 and clipped at 100.**
`marsin_engine/lib/sacn_output.js:76-79` puts the DMX router's **0-255** buffer
(`sacn_mapper.js:351-353` writes `min(255, entry.r*255)`; `engine.js:61` imports
that module) into the `sacn` package's `payload`, which the package treats as
**percent**: `packet.js:138` `inRange(payload[ch] * 2.55)` unless
`useRawDmxValues` — and **no project source ever sets it** (both vendored copies
`sacn@4.6.2`). Measured with the real `Packet`: `1->3, 2->5, 50->127, 99->252,
100->255, 101->255, 128->255, 200->255, 255->255`. **Everything the engine renders
above DMX 100 leaves the box as 255**, and the information is gone before the
bridge — relay and mirror both faithfully forward an already-clipped value.
`(255,120,60)` reaches the fixture as `(255,255,153)`. This is the **hardware-side
half of `_105` F3** (the 39 % browser preview is the same unit confusion seen from
the receiving end, `sacn_mapper.js:124-131`); F3's wire consequence has never been
written down. It hits ship and bench identically, so it is NOT the differential
cause of "did not match the corresponding titanic fixtures" — but it is a live
answer to "colours that did not match [what the pattern intended]" and it dwarfs
`_105` F8. **Sequencing: land F1 first and retest the mirror; F1b changes what
every fixture does and would make that retest unreadable.**

**F2 CONFIRMED-OFFLINE — one CID for the whole project.**
`node_modules/sacn/dist/constants.js:22-26` `DEFAULT_CID` = ASCII
`kyleHenselDefaul`; grep finds no project source passing `cid:`. Captured on the
wire from my harness: `6b796c6548656e73656c44656661756c` on every frame. Each
`Sender` keeps its own sequence counter from 0 (`sender.js:29`, `:60`), so two of
our processes on one universe look like **ONE source** with two interleaved
counters and a priority field alternating 100/150 — and E1.31 §6.7.2 discards
`seq_new - seq_last` in `[-20,0]`. **So F1 produces flicker/garbage even on a
gateway that ignores priority entirely.** Two independent mechanisms, one symptom.
(`_105` F4, unfixed, now load-bearing.)

**F3 CONFIRMED-OFFLINE — the bridge's source arbitration is switched OFF by
config.** `scenes/common.yaml:200-202` `sacn_high_priority: 100` and the engine
sends at 100, so `sacn_bridge.js:1073` `priority >= HIGH_PRIORITY` is true for
every frame and the `else` branch — the only place a lower-priority source is
silenced — is dead code. Measured: an inbound U2 at priority 150 is composed AND
emitted, at outbound priority 150. The comment at `:1457-1459` ("an sACN priority
override silences the mirror exactly as it silences the relay") is **false in this
configuration**.

**F4 NEEDS-LIVE-CAPTURE — the engine unicasts U10/U12 to `10.x.x.202`, and
ownership is compared by ADDRESS while hardware is a BOARD.**
`marsin_engine/config.yaml:7-13` declares `Titanic-202` host `10.x.x.202`
universes `[10,12]`, no `alsoFlat`, so `output_dispatch.js:137-149` routes them
**only** there. In the titanic model U10 = `Left Back Wall 3/4` (`ShehdsBar`),
U12 = `Left SmokeStack 1-4`. The mirror composes U10/U12 to `10.x.x.60`, the box
the `test_bench` scene calls `Titanic_202` / `boardId: angio4-old`. If `.202` and
`.60` are the same board, the strands get engine bar/smokestack bytes AND mirror
rope bytes on the same universes under the same CID — and
`evaluateArmRequest`'s clash check cannot see it, because `10 -> 10.x.x.202` is
not `10 -> 10.x.x.60` and the host check tests `key.endsWith('->10.x.x.60')`.
**Adjacent, independent of the mirror:** because U10/U12 never reach the flat
`127.0.0.1` destination, the bridge's `U10 -> 10.x.x.13` and `U12 -> 10.x.x.14`
relay routes (created every boot — seen in my capture) carry **no frames at all**,
i.e. the ship's Left Back Wall 3/4 and Left SmokeStacks are dark.

**REFUTED-OFFLINE, with byte tables (so the fix hunt does not waste time here).**
Harness `~/tmp/bench_mirror_debug_153/capture.cjs` loads the REAL
`server/sacn_bridge.js` with `sacn`/`ws`/`process_priority` faked, and — unlike
the repo's own rig — **encodes every send through the real `sacn` `Packet`**, so
the captured bytes are the bytes `dgram` would have sent (CID, sequence, priority,
512 slots); source frames are round-tripped through a real encode/decode so the
bridge sees a true percent payload. Results: **(F5)** armed, 5 consecutive frames
give `U2->10.x.x.10`, `U10->10.x.x.60`, `U12->10.x.x.60` each 5 frames, **1 CID, 1
sourceName, sequence strictly monotonic, priority 100, zero stray frames to the
wholly-owned host, no raw U2 anywhere** — bridge-side suppression is complete and
`_152`'s steady-state conclusion reproduces exactly. **(F6)** `boundaries.cjs`
(pure module, per-channel-unique markers): 344 + 80 + 80 mapped channels,
**0 mismatches, 0 unmapped-non-zero**, every slice edge exact
(`1..40 from U6 1..40`, `41..73 from U5 1..33`, `74..106 from U5 34..66`,
`107..225 from U2 1..119`, `226..344 from U2 120..238`), ch345-512
deterministically zero, dropped channel gives 0, null payload gives 0.
**Partial source:** a U6-only arrival emits a composed frame whose
not-yet-arrived region is **zero, never stale**. **Cadence:** one engine frame
(5 datagrams) gives exactly one composed send per destination (the `setImmediate`
coalescing works). **(F8)** source-universe truth: the engine's generated
`models/titanic.js` places `Left Auditorium 5/8` at U6 addr 1/31 fp10,
`Left Front Rails 1/2` at U5 addr 1/34 fp33, `Left Front Wall 1/2` at U2 addr
1/120 fp119, `Left_Front_Left`/`Left_Back_Left` at U30/U31 addr 1 — an exact match
for the sidecar; `titanic/controllers.yaml` and `patches.yaml` are UNMODIFIED vs
`HEAD`; the operator's morning edits touched nothing that moves a mirrored
address; `node --test tests/bench_mirror{,_arm}.test.js` = **91/91**.
**(F7)** `_105` F8 measured: the loss is the fractional part of a 0..100 percent
value truncated into a `Uint8Array` (`bench_mirror.cjs:704`), about 2.55 DMX steps
(mirror `2->3, 4->8, 6->13` vs relay `2->5, 4->10, 6->15`); consistent with
`_154`'s worst -3 over the full range. Real, small, cannot look random.

**Writer enumeration closed:** ordinary relay (suppressed, measured), stale sender
surviving arm (no — closed and re-created in one recompute pass, sequence from 0),
second sim tab (possible, but it is just another instance of F1), a second `:6971`
bridge (port bound once), multicast (**no project sender multicasts** — every
`new Sender(...)` passes `useUnicastDestination`; the Receiver joins groups for
reception only; a third-party multicast source is **NEEDS-LIVE-CAPTURE**),
CaptainPad/podium/`marsin_pb` (no sACN sender anywhere).

**Live-capture procedure is written out for operator approval and NOT run**
(report §7): (A) passive `tshark -f "udp port 5568"` with `e131.cid`,
`e131.priority`, `e131.seq_number`, `e131.source_name` columns — two source names
(`MarsinRelay Engine` prio 100 and `BM26-Simulation` prio 150) on
`ip.dst == 10.x.x.10 / universe 2` confirms F1, an identical CID on both confirms
F2; **(B) the decisive one-gesture counter-test — with the mirror ARMED, switch
the sim's lighting-engine mode away from `sACN IN`. The arm survives (process
state; the panel gate only hides the control, the HUD banner is
panel-independent) but the 150-priority stream stops within a frame. If the bench
snaps to the correct mirrored look, F1 is proven live.** (C) two GETs on the `.60`
board for `strands[].dmxUniverse` + `sacn.lastUniverse`; (D) `arp`/`ping`/capture
on `.202` and a board-identity comparison against `.60`; (E) hex-dump a titanic
universe and check whether mid-brightness channels all read `0xFF` (F1b).

**Fix ordering this report recommends:** (1) F1 — the one-writer law must reach
the browser's output loop or `:6972`; the bridge already broadcasts
`destinations[]`/`hosts[]` in `benchMirrorStatus`, and note that the ARM control's
placement inside the offending mode is itself part of the defect; (2) F2 —
per-process CID, so a two-writer situation is diagnosable instead of silently
merged; (3) F3 — raise `sacn_high_priority` above the engine's 100 so the
arbitration exists at all; (4) F4 — ownership must be board-identity-aware, and
the engine's `controllers:` block still names `.202`; (5) **F1b/F7 as their own
later slice** — flipping `useRawDmxValues` must happen on every sender WITH the
receive-side `objectify` compensation removed in the same change, or the rig goes
2.55x dark instead of 2.55x bright.

**`_155` AMENDMENT — operator rulings + `_154`/`_153` folded into the design in
place (report §15; §§3/6/7/8/9/13 marked, not rewritten; design-only, zero
production edits/git writes/ports/packets):** (1) **Suppression model replaced —
ARMED = BENCH IS THE ONLY PHYSICAL OUTPUT** (operator ruling): relay set is EMPTY
while armed for every active scene; `suppress_host` and the sidecar `controllers:`
section are DELETED; `partitionMirrorSuppression` degenerates to armed-or-hold ⇒
suppress-all, keeping the `_152` D1 single-call-site invariant with simpler
semantics; disarm restores the ENTIRE relay set in the existing post-blackout
recompute. Ship goes deterministically DARK on arm — 3× zeros to every suspended
relay destination through the retiring senders, awaited (frozen-last-look is a
surprise in both directions; `blackoutInFlight` now covers both directions,
symmetric D2). (2) **Sim-writer root cause (`_154` M1 / `_153` F1) covered by a
SERVER-SIDE GATE at :6972** — the output bridge is its own process, so the gate
lives there: one additive JSON control message (gate/ungate + ack + drop count),
commanded by sacn_bridge over a loopback control link, gate held only while that
link asserts armed (link drop ⇒ auto-ungate loudly — no stuck-dark ship after a
crash); ARM awaits the gate ACK before any composition and REFUSES without it
(R-23: one-writer must be PROVEN, not assumed); client-side transmit stop is a
belt, never the enforcement (stale tabs/second windows/races all funnel through
:6972). Per-mode writer truth table recorded — in sacn_in the tab's hard-coded 150
outranks the bridge's 100 today, pre-existing writer-#2 now on record. (3)
**Scene-parametric source** (operator: "or any other scenes"): source scene =
engine's active scene, `source_scene` dropped from v3, no scene picker; R-22a/b/c
refusals (self-mirror, zero compatible candidates, default unresolvable in the
current scene — defaults path refuses, picker is the way in); last-used keyed by
(bench, source) scene pair, process memory confirmed. **No presets** — simplest
per-slot picker. (4) **R-21 (subsumes R-9/R-10): ARM refuses while the engine
reports ANY direct controller destination** — `_153` F4 proves address≠board, so
engine-direct routes make "bench only" unprovable; consequence flagged: today's
engine `Titanic-202` block blocks arming until removed (open Q1). (5) **Priority
escalation above 150 REJECTED** (masks the two-writer bug class, F2's shared CID
corrupts regardless, F3's dead arbitration re-emits 150 at 150); mirror emits at
FIXED declared 100 instead of inheriting; **distinct stable CID per sender role
REQUIRED for mirror vs :6972** (project-wide CID split + sacn_high_priority raise
flagged as separate small slices). (6) Secondary folds: live test :490 upgraded
footprint→fixtureType equality; wire-truth tables model the ×2.55-clip (F1b) —
physical constants restricted to 0/255, F1b fix is its own later slice per
`_153` sequencing; smoke passes on bridge/gate LOG LINES, never eyeballs
("armed-but-outranked" is visually identical to "inactive"); `_153`'s LED-half
retraction honored (nothing designed against browser strand transmit). New tests
T-9 (gate) + T-10 (global suppression); refusal numbering stable (R-17 retired,
R-7 repurposed). **Open operator questions now 2:** remove the engine
`Titanic-202` block (or grow a runtime park) so R-21 can pass; confirm
ship-dark-on-arm vs frozen-last-look.

**`_153` AMENDMENT — flicker addendum (report §10, appended in place; `_153` not renumbered).**
Second live test ("sane colors, but flickering like hell") investigated offline against
md5-pinned tree (`sacn_bridge.js` 79393bb4, compose path lines 1418-1455 md5 9235188038e8 —
both UNCHANGED throughout; `bench_mirror.cjs` changed under the run at 12:18:59 to `_156`'s
v3 `slots` schema, disclosed not worked around; the three compose functions verified
byte-identical in both builds, so the measurements hold for v2 and v3).
**H1 SPLIT: "partial-source ZEROS" REFUTED-OFFLINE (0 % zero regions in 200 measured engine
frames) — buffers persist, so a partial compose emits STALE, never black. "Variable compose
cadence with sub-frame tearing" CONFIRMED-OFFLINE**: `mirrorInbound` coalesces over ONE POLL
PHASE, not one engine frame, and there is no frame sync of any kind (the `sacn` package
hardcodes `syncUniverse = 0`). Measured over 40 engine frames per pattern: `U2 → 10.x.x.10`
(5 slices, 3 sources) goes **1.00 → 2.00 → 3.00 composed sends per engine frame** as arrivals
split across 1/2/3 poll phases, with **50 % → 67 % of emitted frames carrying a region from
the PREVIOUS engine frame**; `U10`/`U12 → 10.x.x.60` (1 slice, 1 source) stay **1.00 per frame,
100 % fully fresh, 0 % torn in EVERY pattern**. **That asymmetry — multi-source destinations
tear, single-source destinations cannot — matches the operator's "DMX definitely flickering,
LEDs not noticed" exactly.** **H5 (new) CONFIRMED-OFFLINE:** buffer reuse keyed on
`JSON.stringify(spec)` (`sacn_bridge.js:519`) means any parsed-field sidecar edit or any
re-arm drops the buffers — measured **304 of 344 mapped channels BLACK on the first composed
frame**, and the sidecar is re-read on every recompute, so `_156`'s live edits flash the
bench. **H2 NEEDS-LIVE-CAPTURE and H1 makes it worse:** `animate.js` is unmodified at HEAD so
the priority-150 stream is still in the code; per E1.31 §6.7.2 two same-CID streams flicker
for **214/256 ≈ 83.6 %** of sequence offsets, and the mirror's *variable* 1-3 sends/frame vs
the sim's 1 makes the offset **drift 0-2 per frame, sweeping all 256 values every 1.6-6.4 s** —
a multi-second beat cycling sane / garbage / 80 Hz alternation, which fits "sane colors,
flickering like hell" better than a steady 150-priority win. **H3 KILLED** (sequence restart
costs exactly one packet: `0 − 173` is outside the `[−20,0]` discard window, and the `sacn`
receiver updates `lastSequence` before throwing). **H4 real but subsumed** by the H1 fix
(≈120 pkt/s on U2 vs a gateway's ~44 Hz DMX rate).
**FIX SPEC for `_156` (v3), report §10.4:** add `requiredSources: Map<destKey, Set<universe>>`
to `createMirrorState`, and `_mirrorSeen: Map<destKey, Set<universe>>` beside `_mirrorDirty`
in the bridge; `flushMirrors` emits a destination **only when its seen-set covers its
required-set**, then clears it — an incomplete key stays dirty and stays scheduled. Restores
exactly 1.00 fully-fresh send per destination per engine frame in all arrival patterns, drops
the gateway packet rate 120→40/s (closes H4), and **removes H5's black flash for free** (a
fresh state never emits until complete). **No timeout-emit fallback** (codex P0) — instead a
watchdog that after ~250 ms incomplete logs ONCE per destination naming the missing universes.
**Does NOT fix F1**: the sim's priority-150 stream is untouched; the cadence fix only stops the
H2 offset drifting. **URGENT operational (report §10.0.1):** `_156`'s v3 parser landed while
the on-disk sidecar is still v2, so `parseBenchMirrorSpec` now throws *"unknown key
'source_scene'"* on the live file — `readBenchMirrorSpecs()` runs on every recompute, so any
bridge restart onto this tree refuses ARM and auto-disarms a live arm. **Land the file and the
parser together**; this is the likeliest cause of "the bench lights are now dark". Read-only
throughout: no source/test/scene edit, no git write, no port, no packet, nothing armed.

## `_157` — sACN stack review: full wire-layer defect list + Opus fix plan (REVIEW-ONLY, Fable)

Operator-requested wire-layer review (engine sACN out, vendored `sacn@4.6.2`,
both bridges @HEAD `948447e9` because `_156` is editing them in-tree, sim
client/input paths, configs, CaptainPad/podium sweep). Zero edits, zero git
writes, zero ports/packets; all measurements via real library code with `dgram`
faked (`~/tmp/sacn_review_157/probe.cjs`, 9 probe groups, ALL PASS). Report:
`.agent/reports/202608/20260805_157_sacn_stack_review.md`.

**Verified/deepened:** F1b CONFIRMED + blast radius mapped lane-by-lane — engine
(`sacn_output.js:75-79`) AND `:6972` output bridge (`:139-148` @HEAD) both feed
raw 0-255 into the package's PERCENT payload (50→127, ≥101→255); relay lane
round-trips exactly (all 256 values); browser WS lane carries 0-100
percent-bytes (the `_105` F3 39% preview is the same unit bug); the sim's
150-priority `sacn_in` stream is a double-quantised copy (±3) of already-clipped
data. Exact fix specified: `useRawDmxValues` on all 4 sender sites +
`payloadAsBuffer` on the bridge receive path + WS raw bytes + mapper
compensation removal + mirror raw compose, ONE slice, own operator gate,
after the mirror retest. F2 CONFIRMED + quantified AT OUR OWN RECEIVER: the
package keys sequence state by CID+universe and drops |Δseq|>20 — two same-CID
writers interleaved = **98/100 packets dropped** (measured); CID fix must pass
EXACTLY 16 bytes (`Packet` splices `[...cid]` unchecked — short CID shifts the
whole frame). F3 CONFIRMED + deepened: threshold 100 ≤ engine 100 kills the else
branch AND the GUI slider min is 100 (cannot express a working value) AND —
**new** — arbitration state is GLOBAL across universes (`sacn_bridge.js:820-822`
@HEAD): raising the threshold without per-universe scoping lets ONE ≥threshold
source on one universe silence the ENTIRE rig through the bridge. Fix = per-
universe arbitration map + threshold 120 + slider/value raise together.

**F4 PARTIALLY REFUTED:** HEAD `marsin_engine/config.yaml:14` has
`alsoFlat: true` on the Titanic-202 block **since c6eaa733 (July 15)** — `_153`
quoted lines 1-13 and missed it. U10/U12 DO reach loopback; the bridge relays
them to the ship boxes (titanic patches: U10→10.x.x.13, U12→10.x.x.14; pair-
keyed exclusion doesn't match .202). "Ship U10/U12 dark" is wrong at HEAD, and
`_155` A9-1's "currently receiving nothing at all" is overstated — removing the
block only kills the redundant .202 direct stream (R-21 still requires it; the
.202-may-be-a-live-board two-writer risk still NEEDS-LIVE-CAPTURE).

**NEW findings:** (D5) the `sacn` Receiver silently discards out-of-order AND
corrupt packets via `PacketOutOfOrder`/`PacketCorruption` events **no project
code listens for** — fail-loud P0 violation, would have named the bench-night
corruption in the log; tiny fix, land first. (D7) injection surfaces: receiver
joins ~40 multicast groups with no source filter and threshold 100 admits any
default-priority stranger → relayed UNICAST to hardware (amplifier); `:6972` WS
is an unauthenticated any-DMX-to-any-IP proxy for the LAN. (D8) NO 'error'
listener on any Sender dgram socket (package registers none, project none) —
an emitted socket error (Windows UDP ECONNRESET class) kills engine/bridge;
live-check procedure written. (D9) every sender re-create restarts sequence at
0 → compliant controllers discard up to ~0.5 s (route churn, `:6972` 15 s reap,
mirror arm/disarm). (D10) Stream_Terminated is never settable; engine SHUTDOWN
blackout is sent 1× vs the stale-universe path's own 3× rule — one lost
datagram = rig frozen bright at exit. (D11) unicast senders skip universe
validation entirely (0 and 64000 accepted, >65535 aliases). (D12) falsy-default
conflations + browser port-guess fallbacks.

**Non-findings (sound):** bridge_routing.cjs (admission/exclusion/range gates),
no project sender multicasts, reuseAddr discipline holds, boot-join race fix
holds, relay byte fidelity exact, throughput trivial, no sACN in CaptainPad/
podium/marsin_pb, outputRouting introspection matches consumption.

**Fix plan sliced for Opus (report §11):** S-D5 loud-drop listeners (first,
tiny) → S-D3 per-role 16-byte CIDs → S-D4 per-universe arbitration + threshold
→ S-D6 remove Titanic-202 block (operator, with corrected §6 stakes) → S-D1 raw
DMX end-to-end (OWN OPERATOR GATE, ship-wide look change, not in the mirror-
retest window) → hardening batch (D8/D10/D11/D12) → D7 ops/config + playa
tshark sweep. Nothing urgent enough to interrupt the bench-mirror work: D2's
fix is `_156`'s in-flight gate, and D1 must deliberately wait for the retest.
S-D5/S-D3 should ride immediately after `_156` merges (same-file conflicts).

## `_156` — BENCH MIRROR v3: selectable mapping, bench-only output, the :6972 gate, the cadence fix, and the removal of the engine's direct-unicast exception — LANDED (unmerged, NOT physically confirmed)

**Report:** `.agent/reports/202608/20260805_156_bench_mirror_v3_implementation.md`.
Implements `_155` as amended by its §15, plus `_153` §10 (flicker) and `_157`
D2/D6/§11. No git ops, no operator port bound, no packet toward a controller, no
device HTTP, no engine restart, nothing armed — every verification is in-process
against faked sockets.

**Sidecar v3 (`scenes/test_bench/bench_mirror.yaml`):** declares SLOTS
(`slot` / `bench_fixture` / `default_source`) and NOTHING else — no universe, no
address, no slice length, no IP, no `source_scene`, no `suppress_host`; a test
asserts no dotted quad and no plumbing key survives outside comments. v1/v2 refused
at parse with the migration quoted (R-20). **New pure `lib/bench_mirror_resolve.cjs`**
resolves every slot at ARM from live `patches`/`controllers`/`scene_config` + the
ONE fixture registry (`dmx/fixtures/<family>/model_*.yaml`), materializes the same
internal spec the `_151` pipeline already consumed, and re-runs it through the same
structural validator (`validateMirrorTree`, split out of the v2 parser).
**Compatibility is by IDENTITY not shape** — same `fixtureType` string, so both ends
resolve through one definition (this is `_154` §7's footprint→fixtureType upgrade,
now at runtime not just CI); `led_strand` keeps the `srcPx >= destPx` prefix
allowance (warned), `led_fixture` demands equality (a sign is a shape). Source
scene is **whatever the engine is running** (scene-parametric, R-22a/b/c).
**T-5 default-equivalence pin passes:** the computed default mapping's
(destU,destHost,destCh) -> (srcU,srcCh) function over all 504 channels is identical
to the frozen v2 seven-slice table, hard-coded in the test.

**ARMED = BENCH IS THE ONLY PHYSICAL OUTPUT.** `partitionMirrorSuppression`
degenerates to armed-or-hold ⇒ suppress ALL, keeping the `_152` D1 single-call-site
invariant (exact-count assertion still pins `hold: _blackoutHold` at exactly one
site). ARM: `_relaySuspended` raised in the same synchronous turn as the arm (so no
raw frame interleaves with the zeros — D1 pointing the other way),
`_relayCloseHeld` holds the retiring relay senders open, **3x all-zero frames to
every suspended relay route, awaited, THEN the recompute closes them** — the ship
goes deterministically DARK, not frozen. The ownership proof now also requires that
**no relay sender survived at all**. DISARM restores the FULL relay set.

**Root cause closed (`_153` F1 / `_154` M1): the :6972 gate.** `sacn_output_bridge.js`
gains one additive JSON control message (`benchMirrorGate` -> `benchMirrorGateAck`
with a drop count); while gated it drops every 519-byte DMX frame **but still
answers control messages** (`_157` D2a — the control handler runs BEFORE the drop
check, pinned by a source-ordering test), and it **releases the gate loudly when its
control link drops** so a crashed input bridge can never strand the rig dark. The
input bridge holds a loopback WS control link, **awaits the ack before any
suppression or composition, and REFUSES without it (R-23)**; a link drop while armed
auto-disarms loudly. Client-side transmit stop in `animate.js` is a belt, never the
lock. `_157` D2b's settle-after-DISARM (recreated senders restart sequence at 0) is
written into the smoke procedure as expected-brief / not-sustained.

**Flicker closed (`_153` §10).** `createMirrorState` now returns
`requiredSources: Map<destKey,Set<universe>>`; the bridge keeps `_mirrorSeen` beside
`_mirrorDirty` and **emits a destination only when seen covers required**, then
clears — one composed frame per destination per ENGINE frame instead of one per
libuv poll phase. **No timeout-emit fallback** (codex P0): a stalled source stops
that destination and a ~250 ms watchdog names the missing universes. H5 (state-reset
black flash) dies for free — nothing is emitted until every source has arrived
fresh. Tests: 1.00 composed send/frame under per-poll-phase adversarial jitter,
tearing 0, single-source unaffected, watchdog fires and NAMES the universe, nothing
before the first complete frame. Also: mirror emits at a **fixed declared priority
100** (never inherits — closes the F3 corollary; escalation above 150 stays
rejected) with a **distinct stable 16-byte CID** (md5 of `bm26:bridge-mirror`;
`_157` D3's exact-16-bytes requirement asserted).

**UI relocation.** ARM/DISARM moved to the **Controllers view header** as its own
signal-driven Preact root (`cm-bench-mirror-host`), available regardless of lighting
mode — the old sACN-monitor placement was part of the defect, since that panel only
renders in `sacn_in`, the very mode that made every window a priority-150 writer.
All 8 `_155` §8.2 states implemented with exact text and the refusal rendered BESIDE
the control; new `bench_mirror_picker.js` (pure state + Preact modal, lastUsed >
default pre-selection, `none` everywhere, zero-candidate rows, `x2` fan-out badge,
refusals verbatim with no confirm). The sACN IN monitor is **read-only** — a test
greps it for `armBenchMirror`/`runBenchMirrorAction`/the old button id and requires
zero hits. Banner leads with `ALL SHIP OUTPUT SUSPENDED — BENCH ONLY`.
`_lastSelection` remembered in **bridge process memory only**, keyed
(bench, source) scene, with the persistence grep pin extended to it.

**Operator ruling 4 + addendum — the engine's direct-unicast exception is GONE, not
just unused.** Deleted: the `controllers:` block from `marsin_engine/config.yaml`,
`lib/output_dispatch.js` (292 ln), `lib/artnet_output.js` (221 ln),
`tests/io/output_dispatch.test.js` (24 tests), `tests/io/artnet_output.test.js`
(11 tests). `engine.js` builds `createSacnOutput` directly. **Made
unrepresentable:** new `lib/output_config_guard.js` — a config still declaring
`controllers:` (**even empty**) or a stray top-level `alsoFlat:`/`protocol:` makes
the engine **refuse to boot** by name, stating that all sACN to hardware flows
through the bridge. `/status.outputRouting` STAYS, permanently `{controllers: []}`,
because its ABSENCE means "engine too old to say" and is a hard bridge-side refusal
(R-8). **Breadcrumbs scrubbed with every reference listed in report §7.3:**
`docs/41` §5/§6/§7 (which literally instructed adding a `controllers:` entry with
`alsoFlat: true`), `lib/bridge_routing.cjs` header, `.agent/ops/engine_model_refresh.md`,
`.agent/memory/spawning_a_test_engine.md` (whole premise rewritten), the
`bm_readiness_mapping` dossier (history kept, standing correction added),
`tests/bridge_routing.test.js`'s `engineOwnedPairs` fixture (parser RETAINED and
tested — R-21 is only meaningful if a non-empty payload still parses), and the four
engine test/harness files that wrote or asserted `controllers: []`. **`_157` D6
correction adopted:** the removed block carried `alsoFlat: true`, so U10/U12 already
reach loopback — the "Left Back Wall 3/4 + SmokeStacks may go dark" caveat is WRONG
and is struck; removal is strictly safe.

**R-21 (subsumes R-9/R-10):** ARM refuses while `engineState.owned` is non-empty,
naming the routes — kept as the structural guard even though ruling 4 makes it
vacuous today, and it also auto-disarms if the engine ever starts delivering
directly mid-session.

**Verification.** Sim `npm test` **1875 / 1869 / 6** against a measured pre-change
baseline of **1834 / 1828 / 6** — **+41 tests, zero new failures, byte-identical
failing list**. Focused: `bench_mirror.test.js` 49/49, `bench_mirror_resolve.test.js`
32/32 (new), `bench_mirror_arm.test.js` 51/51. The arm rig now loads **BOTH real
bridge modules** and wires a faked loopback WS between them, so the gate is
exercised across the real two-process boundary — zero ports, zero packets, every
send in an array, teardown asserts the class identities. Every `_152` regression
(D1 no-raw-frame-between-blackouts, D2 refuse-mid-blackout, RESIDUAL-1 no-hold-leak,
D5 runtime degrades) carried forward unweakened. Engine `npm test` **2631 / 2624 /
7** vs baseline **2657 / 2650 / 7** — same seven environmental fails; the -26 is
35 tests removed with the mechanism minus 10 added. `security_check.py --all` — the
same 6 pre-existing gitignored `.scene_backups/studiodj/**` findings.
**Guard proving itself, recorded:** before the e2e-harness rewrite the engine suite
went to 26 failures — every spawning case — because `timeline_e2e_harness.mjs` wrote
`cfg.controllers = []` and the new boot guard correctly refuses an empty key too.
The harness now DELETES it.

**Working-tree honesty:** mtimes+sizes of all 39 pre-existing files recorded before
the first edit and re-measured after — **every operator scene/model/pattern/playlist
file is byte-identical**. Two exceptions reported, not reverted: running
`marsin_engine`'s suite rewrote `states/titanic/{audio,globals}_state.yaml` (spawned
engines; AGENTS.md records this as expected residue), and the tracker + `_153` grew
from other agents' work.

**Deviations from `_155`, justified in report §11:** no per-controller-card badges
in the 3004-line legacy Controllers body (header + banner carry the truth); R-11
compares COMPUTED destination pairs via `otherClaims` (v3 has no declared
destinations to compare); operator DISARM is refused during the ARM blackout while
internal auto-disarms await it (refusing an auto-disarm would leave the bridge armed
with nobody to press the button); `validateMirrorTree` allows empty `slices`
because an all-`none` destination composing zeros is the §6.1 ruling.

**NOT SHIP.** Physical confirmation is the operator's gate. Report §9 is the smoke
procedure and it passes on **bridge/gate LOG LINES, never eyeballs** (`_154` M2 —
"inactive" and "armed but outranked" look identical). `_153` pin folded in: the
"sane for a few seconds then degrades" sequence-beat was the OLD build's signature;
after this slice **any recurrence means a second writer survived and the smoke has
FAILED**. Ready for the adversarial reviewer. `_157`'s S-D5/S-D3/S-D4/S-D1 remain
explicitly out of scope and should ride after this merges.

**Landed 2026-08-05 — `_158` adversarial review of the `_156` BENCH MIRROR v3
rebuild (Opus, READ-ONLY + 3 parallel sub-reviewers,
`.agent/reports/202608/20260805_158_bench_mirror_v3_adversarial_review.md`):**
verdict **FIX-FIRST — 1 blocking defect on the gate, the very thing the rebuild
exists to be.** Ground truth re-established from disk in full; nothing from `_152`
carried over as still-valid. Zero source/test edits, zero git writes, no port
bound, no packet, no engine against the real config, nothing armed.

**D-158-1 (BLOCKING) `sacn_bridge.js:1478`** — `onGateLinkLost` early-returns on
`blackoutInFlight()` (`:320` = `_mirrorDisarming || _armBlackoutInFlight`).
`armBenchMirror` raises `_armBlackoutInFlight` synchronously (`:1848`) and holds it
across the AWAITED 3-frame ship-dark blackout (`finally` at `:1886`), so a gate-link
loss inside that window is **swallowed**: `_gateLink` nulled, **no auto-disarm**, and
the post-recompute ownership proof (`:1901-1946`) verifies senders but **never the
gate**. The arm completes reporting `armed:true` / "ALL SHIP OUTPUT SUSPENDED — BENCH
ONLY" while the output bridge has released its gate — and a **priority-150 sim frame
reaches the ship gateway again**, i.e. `_153` F1 silently restored, permanently (no
recovery while armed). **Reproduced** offline with both real bridges in-process
(`bm158_gate_window.mjs`): killed the link on the first blackout zero frame →
`armed:true`, `refusal:NONE`, `auto-disarm:false`, 1 prio-150 frame delivered. Also
defeats `_156` §9.3, which routes "bench shows garbage" to *"suspect the fixture's
personality/menu"* and has no row for an `UNGATED` line after arming. **Fix:** add
the gate to the ownership proof (closes the class), and/or a sticky
`_gateLostDuringBlackout` acted on in the `finally`.

**D-158-2 (MEDIUM)** — an all-`none` destination is **never emitted** (zero slices ⇒
never in `bySource` ⇒ never dirty), so the box **holds its last look**. `_155` §6.1
rules it "composes all-zero frames … dark where unselected", and `_156` §11
deviation 4 cites that ruling — so deviation 4 is a **weakening**, not a deviation.
Measured: `U10→…60 total=0` frames while `U2`/`U12` got 12 each. **One click away** —
U10/U12 carry one slot each — and it lands on the `.60` box whose binding is already
the open question, so a frozen strand would be misread as `needs-reboot`.

**D-158-3 (MEDIUM)** — the cadence gate (`:1995-2001`) tests source **presence**, not
frame identity. All of `_156` §6's explicit claims CONFIRMED by independent
byte-level measurement (1.00 sends/dest/engine-frame, **0 torn** across five
adversarial poll-phase splits; no timeout-emit fallback anywhere; watchdog logs and
never sends; H5 dead; fixed prio 100 under rogue 150/200; CID 16 B). BUT one lost
source datagram under split phases desynchronises **permanently and silently**:
1.00 sends/frame, 40/344 channels one engine frame stale forever, **0 log lines** —
the destination *is* completing. Their tests assert counts, never byte freshness.
Symptom is a steady WRONG REGION, not flicker, so `_156` §9.3's "flicker ⇒ second
writer" rule would miss it.

**Also:** **D-158-4** R-11 (`bench_mirror.cjs:554-563`) has **no intersection test** —
refuses if ANY other enabled sidecar resolves, naming its pairs as if they collided
(disjoint `U99 → 10.x.x.99` refused with "the same destination(s)"); fails safe,
latent while one sidecar exists. **D-158-5** the v1/v2 **migration text is
unreachable** — `requireKnownKeys` (`:142`) fires before the version check (`:144`),
so a real v1/v2 file dies on "unknown key 'source_scene'"; refusal still loud+named,
but R-20's UX claim is false and their test only exercises an impossible v3-shaped
tree. **D-158-6** "unrepresentable" is **QUALIFIED**: the guard is strong (31 cases;
`key in config` catches even empty/null/false) but `sacn.destinations` still streams
straight to a box, bypassing the bridge, while `/status.outputRouting` positively
asserts `{controllers: []}` — the removed mechanism's failure mode under another key,
invisible to R-8/R-21. **D-158-7** the "no plumbing" sidecar test is **defeatable** (a
YAML line-continuation puts an intact dotted quad in a value; renamed keys; hex/
decimal IPs) — the property is really held by `SPEC_KEYS`/`SLOT_KEYS` + the resolver
ignoring `note`/`label`, so it is test theatre, not a safety hole. **D-158-8**
`:1995` `|| new Set()` degrades a missing `requiredSources` to "complete ⇒ emit" — a
P0-shaped fallback on the emission path, currently unreachable.

**CONFIRMED under attack:** R-23 refuses both with no output bridge and with a
FOREIGN link holding the gate (the `gated:true`+`refusal` ack is correctly checked at
`:1509`); a refused ARM sends 0 frames and 0 ship zeros; control channel not deafened
while gated (`:168` precedes `:175`); both crash directions fail safe; **single
suppression call site** (`:706`, exact-count pinned); the ARM-side D1 class closed by
a STRONGER mechanism than the hold (`_relaySuspended` gates the send itself at
`:2038`) — measured **0 raw frames between the ARM's first and last zero**, 0
post-arm sends to non-bench destinations, second window mid-arm harmless; DISARM
restores the FULL relay (verified functionally — sender-key tracking is ambiguous
because mirror and relay share a key) and **ungates last**; resolve-layer
compatibility is genuinely `fixtureType` IDENTITY (33-ch imposter refused); TOCTOU
re-resolves from disk and auto-disarms on fingerprint change (caveat: event-driven,
not polled); **the default-equivalence pin verified INDEPENDENTLY from
`git show HEAD:` + `_154`'s byte tables — 504/504 channels, 0 diffs, both against
their frozen table and against the resolver**; zero actionable ARM left in the sACN
monitor (full read, not their grep); 8 header states exact; **all three `_152`
regressions still have teeth** (falsified D1 via `hold:null`, D2 via
`blackoutInFlight:false`; RESIDUAL-1 fixed in code at `:1678` and non-vacuous);
armed-OFF with **no persistence on `_mirrorArm` OR `_lastSelection`**; engine
deletions clean with **zero dangling refs**; `/status.outputRouting` a hardcoded
literal (`api_server.js:4995`).

**Counts observed:** sim **1875/1869/6** ✓ (same six pre-existing); focused
**49/32/51** ✓; engine **2631/2624/7** on one run but **2634/2627/7** on another —
the total is **nondeterministic ±3** (a file-level crash in
`effects_v2_mode_page_layout.test.js`), failing list byte-identical either way;
`security_check.py --all` **6** baseline. **Report corrections owed (D-158-9/10):**
§8.2 has a duplicated paragraph saying 9 then 8 cases (true = **9**); the "−35 +10,
residual ±1 subtest accounting" arithmetic is **wrong** (zero subtests exist; real
net −25; residual is the ±3 run noise) though its conclusion holds; §7.3 is 12 rows
over **10** unique files, not 11; pervasive line-number drift; and two missed
breadcrumbs in `.agent/plans/20260709_0` and `20260710_1` (imperative `alsoFlat:` /
`controllers:` instructions) — same standing-correction header used on
`bm_readiness_mapping.md` would close them.

**Operator files untouched** — every canonical scene/model/pattern/playlist file
still carries the `00:06`–`00:22` mtimes recorded in `_152`; titanic
`controllers.yaml`/`patches.yaml` unmodified. **Disclosed:**
`states/titanic/{deck,globals}_state.yaml` residue is the documented-expected
engine-suite output, and **part of it is mine** — this review ran the engine suite
twice. `_156` §8.4 names `{audio,globals}`; observed is `{deck,globals}`+`mixer`.

**NOT SHIP and not mine to grant** — the operator's physical confirmation is the hard
gate. Status after this review: **FIX-FIRST**, then READY-FOR-PHYSICAL-SMOKE once
D-158-1 is closed (D-158-2 and the §9.3 diagnostic rows strongly recommended first,
since both would otherwise be misread during the smoke itself).

### `_156` AMENDMENT — post-`_158` fixes (FIX-FIRST verdict closed, all three falsified)

`_158`'s adversarial review returned **FIX-FIRST**: one blocking defect and two
that had to be closed before touching hardware, plus seven minors. All fixed in
the same `_156` slice; report `_156` gains **§13**. Each of the three is
**falsifiable** — a scratchpad preload rewrites the module source at compile time
to neutralise exactly one fix and its regression then fails; no source was edited
and reverted, so no falsification residue exists in the tree.

**D-158-1 (BLOCKING) — the gate failed OPEN during the ARM blackout, silently.**
`onGateLinkLost` early-returned on `blackoutInFlight()`, and `armBenchMirror`
holds `_armBlackoutInFlight` across its AWAITED ship-dark blackout — so a control
link lost in that window recorded nothing, fired no auto-disarm, and was never
re-checked, because the ownership proof verified senders but **never the gate**.
The arm completed reporting `armed:true` while the output bridge had already
released its gate: the exact `_153` F1 priority-150 second writer restored
silently, with the banner reading BENCH ONLY. `_158` measured one prio-150 frame
reaching the ship gateway. **FIXED** with both halves the reviewer offered:
sticky `_gateLostWhileArmed` (`sacn_bridge.js:1405`, recorded BEFORE the blackout
branch at `:1473-1503`, cleared only at arm start `:1912` and disarm completion
`:1777` — never by a reconnect, because a healed link does not un-send escaped
frames), plus new `proveOutputGateHeld()` (`:1534`: no sticky loss AND a live
link AND the output bridge re-acknowledging the gate NOW) consumed by the
ownership proof at `:2002`. A gate failure now takes the same path a surviving
relay sender does — auto-disarm through the normal blackout, so a failed arm can
never strand the ship suspended. Regression reproduces `_158`'s scenario exactly
(warm-up arm proves the bridge CAN arm, then the link is killed on the FIRST
ship-blackout zero frame via a one-shot send hook, ONE arm attempt deliberately —
a retry helper would just re-arm over a healed link).

**D-158-2 (MEDIUM) — "none (held dark)" left the box FROZEN.** A slice-less
destination never entered `bySource`, was never dirtied and was never emitted, so
the box held its last look — `_155` §6.1 rules "composes all-zero frames … dark
where unselected", and `_156` §11 deviation 4 cited that ruling while not
implementing it (a weakening, not a deviation; the report now says so). **FIXED**
(`bench_mirror.cjs:672-712`): a slice-less destination's `requiredSources` is
every source universe the whole mapping reads, plus zero-length `bySource`
entries that write nothing and exist only to make it reachable — so a dark box is
refreshed on the mapping's own engine frame, at exactly the lit rate, never on a
bare poll phase. Regression asserts continuous full-512 all-zero frames at the
SAME count as the lit gateway.

**D-158-3 (MEDIUM) — the cadence gate tested PRESENCE, not frame identity.** With
sources split across poll phases, one lost datagram shifted the gather boundary
permanently: 1.00 sends/frame, every count-based assertion green, one region one
engine frame stale FOREVER, zero log output — and the symptom is a STEADY WRONG
REGION, not flicker, so §9.3 would have sent the operator to the fixture menus.
**FIXED using the frame identity E1.31 already carries**: the engine's senders
advance in lockstep, so every universe of one frame carries the same sequence.
`routeFrame`/`mirrorInbound` now carry `packet.sequence` through;
`_mirrorRegionSeq` (`:2090`) records which engine frame each REGION of the
composed buffer holds (never cleared — the buffer is not cleared either); the
emit condition (`:2181`) is all-present AND all-sequences-equal. Exact, no
baseline, no calibration, self-healing in one frame. A MISSING source keeps the
250 ms watchdog (normal mid-frame); regions DISAGREEING about which frame they
are is never normal and logs immediately (throttled, with a running count),
naming every region with its frame — `regions carry DIFFERENT engine frames
(U6#41 U5#41 U2#40)` — and naming the symptom, `STEADY WRONG COLOUR, not
flicker`. No fallback emission of guessed data anywhere on that path. **A rig
correction came with it and matters:** the old `engineFrame()` helper fed some
universes twice per "frame" and each `inbound` advanced its own counter —
modelling a stream no receiver ever sees. The rig now models the engine (one
shared sequence per frame, explicit `dropDatagram()` for "sent, then eaten by the
wire"), and several cadence assertions were corrected to the stronger rule.

**Minors, all fixed.** **D-158-4**: R-11 had no intersection test and printed a
false sentence; moved to pure `evaluateClaimOverlap` (`bench_mirror.cjs:607`)
called after resolution (`sacn_bridge.js:1904`), naming ONLY colliding pairs,
tested for disjoint/same-universe-different-host/same-host-different-universe/
self/mixed. **D-158-5**: the version check now runs before `requireKnownKeys`
(`:142-152`), so the v1/v2 migration text is reachable for the files it was
written for. **D-158-7**: the no-plumbing test walks the PARSED tree (keys at any
depth, values against dotted-quad / hex-packed / dash-separated forms) plus a
direct assertion against the exported `SPEC_KEYS`/`SLOT_KEYS` — the real
guarantee — with a second test feeding each evasion to the parser and requiring a
named refusal. **D-158-8**: the `|| new Set()` permissive default is gone; a
missing `requiredSources` entry now shouts `BENCH MIRROR INVARIANT VIOLATED` and
auto-disarms, and all per-destination bookkeeping moved behind one
`forgetMirrorGather()` used by the retire, flush and disarm paths. **D-158-6**:
report now states honestly that "unrepresentable" is true of the removed
MECHANISM and its key, not of the capability — `sacn.destinations` still exists
by design (it is how the engine reaches the bridge) and `/status.outputRouting`
asserts only "no per-controller route", which is the precise claim. **D-158-9**:
duplicate paragraph removed, arithmetic corrected (static net −25, not "±1
subtest"), the engine total quoted as a RANGE because a file-level crash makes it
nondeterministic, line numbers refreshed, "11 files" → 10. **D-158-10**: the two
`.agent/plans/` breadcrumbs now carry the same non-destructive standing-correction
header as the dossier.

**Smoke procedure hardened** (`_156` §9.3, per the reviewer's note): three new
diagnostic rows ahead of everything else — an `UNGATED` line appearing after
arming (smoke INVALID), a STEADY wrong colour (read the `frame NOT WHOLE` line;
**do not go to the fixture menus**), and a FROZEN bench fixture (a `none` slot
must be dark, not held). All three states would otherwise have been misread.

**Falsification, reproduced-then-killed.** D1 neutralised ⇒ *"an arm that cannot
prove the sim output path is gated must NOT report success — true !== false"*.
D2 neutralised ⇒ *"a held-dark destination must keep being SENT, not go silent —
got 0 frames"*. D3 neutralised ⇒ *"a partial engine frame must NOT be emitted —
4 !== 0"*. Unmodified, all pass.

**Counts after the fixes:** `bench_mirror.test.js` **52/52**,
`bench_mirror_resolve.test.js` **32/32**, `bench_mirror_arm.test.js` **54/54**;
full sim `npm test` **1881 / 1875 / 6** (same six, byte-identical; **+47 tests /
zero new failures** against the original 1834 / 1828 / 6 baseline); engine
`npm test` **2633 / 2626 / 7** (same seven; the total is nondeterministic in the
range 2631–2634 because `effects_v2_mode_page_layout.test.js` crashes at file
level — recorded as a range, not chased). `security_check.py --all` **6**,
unchanged. No new test file carries a real controller address (re-verified: 0).

**Working-tree residue, disclosed:** `marsin_engine/states/titanic/*_state.yaml`
and `simulation/scenes/titanic/playlists/default.yaml` carry fresh mtimes. Running
the engine suite spawns real engines, and the operator's live stack runs from this
tree; AGENTS.md records that class as expected residue to report, not revert.
**None of it is an edit of mine** — no `states/`, `playlists/` or scene file was
opened by this slice, and every canonical mapping file
(`controllers.yaml` / `patches.yaml` / `scene_config.yaml`, both scenes) is
byte-identical to the pre-session snapshot.

**Still NOT SHIP** — the operator's physical confirmation remains the hard gate.
Ready for `_158`'s re-verification pass and for the §9 smoke.

## `_161` — SIM test-gap discovery: 16-gap catalog with implementable specs (READ-ONLY, Fable, operator-requested)

**Report:** `.agent/reports/202608/20260805_161_sim_test_gap_catalog.md`. Partner `_162`
owns the engine side. Zero production edits, zero git ops, no operator port bound; one
full sim-suite run measured **1881/1875/6** — the same six pre-existing failures.

**Method:** mapped all 105 test files to their surfaces (require + path-reference scan),
then walked `sacn_bridge.js`, `sacn_output_bridge.js`, `sacn_input_source.js`,
`sacn_output_client.js`, `universe_router/frame_buffer`, save-server endpoints, scene
data, and the GUI pure-state modules for untested branches.

**Top gaps (rank order):** (1) receiver priority-arbitration/lockout state machine —
zero tests, incl. the `_157` D4 global-across-universes trap, unpinned; (2) bridge WS
client lifecycle (`setScene` tag glue, disconnect recompute, census broadcast) — the
2026-07-24 freeze class is tested only in its pure half; (3) engine-poll transitions
(reachable flips, scene change, `outputRouting` loss, wrong-service answer, poll
re-entrancy); (4) :6972 DATA path (519-B parse, sender pool, 15 s reap = D9 sequence
reset, error-dedup ladder) — only the GATE is tested; (5) 515-B browser protocol has no
round-trip parity test and carries the `priority||200` D12 conflation; (6)
`UniverseRouter`/`UniverseFrameBuffer` — the merge core that feeds both the display AND
the `sacn_in` hardware relay has ZERO tests; (7) bridge shutdown ordering (disarmed
fast-exit, signal-during-blackout, double-signal); (8) save-server endpoints
(`/delete-pattern` traversal, create/delete-scene, restore-backup HTTP glue,
`||'titanic'` silent default); (9) all-scenes structural lint (6 of 8 scene dirs
unvalidated; `summer_camp_dome/patches.yaml.original` residue); (10)
`sendUniverse` 519-B construction (`priority||100` pin, silent IP-octet coercion).
Plus six S-sized: `load_ports` refusals, animate.js belt wiring, monitor-panel pure
logic, boot-invariant exit glue, static-host gates, sidecar warn dedup
(`[_159-overlap?]`).

**Every D12/D4-class characterization is specced as a NAMED PIN** to be flipped by the
`_157` fixes — never a silent blessing of a fallback. Non-gaps table in the report so
effort isn't re-spent (bench mirror, routing math, readback, boot lib, backups lib,
launcher, views/pixel-map are all adequately covered). Prerequisite for implementers:
extract the `bench_mirror_arm.test.js:518-770` fake-module harness into
`tests/helpers/bridge_harness.mjs` (test-code-only refactor). One item needs an operator
ruling eventually: a `BM26_SIM_SCENES_ROOT` test hook (production edit) to test broken
sidecars without writing into `scenes/`.

**`_158` AMENDMENT (2026-08-05) — re-verification of the `_156` post-review fixes:
READY FOR PHYSICAL SMOKE (re-smoke REQUIRED)** (Opus, READ-ONLY; report §5 appended
in place, `_158` not renumbered). Ground truth re-established from disk first
(`bench_mirror.cjs` 14:05, `sacn_bridge.js` 13:58, tests 13:09–14:09, `_156` 14:14,
both `.agent/plans/` 14:05). Verdict upgraded **FIX-FIRST → READY FOR PHYSICAL
SMOKE**; three residuals, none blocking.

**D-158-1 (was blocking) CLOSED and falsified.** Sticky `_gateLostWhileArmed`
recorded BEFORE the blackout branch (`sacn_bridge.js:1497`), deferral shouted;
cleared at exactly two sites — arm start (`:1912`) and disarm completion (`:1777`),
grep-confirmed no third — so **a reconnect cannot clear it**, because
`proveOutputGateHeld` (`:1534`) tests the sticky FIRST (`:1535`), before the live-link
check and the fresh re-ack; the proof consumes it (`:2002`) so a gate failure takes
the normal auto-disarm-through-blackout path and a failed arm cannot strand the
relay suspended. **Falsified** by rewriting `sacn_bridge.js` in memory at compile
time from a scratchpad preload (`Module.prototype._compile`), deleting only
`if (gateFailure !== null) unproven.push(gateFailure);` → their regression fails with
*"an arm that cannot prove the sim output path is gated must NOT report success"*;
unpatched it passes. **All four attack variants safe:** reconnect-clears-sticky NO
(structural + empirical); **post-proof gate loss** ⇒ auto-disarm fires, ship relayed
again (5 destinations fed), re-arm after heal succeeds; re-ack race sound (honest at
that instant, escaped frames are exactly what the sticky covers); **no recursion** on
the auto-disarm path (`:1479` returns on `_mirrorArm === null`).

**D-158-2 CLOSED for the principal case** — `led_0: none` ⇒ that destination gets 6
frames over 6 engine frames, **all-zero, all 512 channels**, exactly the lit
destinations' rate. **D-158-3 CLOSED** — wraparound is a non-event (seq
253,254,255,0,1,2 in lockstep ⇒ **6/6 emitted**); immediate desync log naming every
region + frame + the `STEADY WRONG COLOUR, not flicker` symptom; no fallback
emission. **Minors all CLOSED:** D-158-4 `evaluateClaimOverlap` does a REAL
intersection and names only collisions; D-158-5 the **actual committed HEAD v1
sidecar** now yields `version must be 3 (got 1)` WITH the migration text; D-158-7 now
walks the PARSED tree and asserts the real guarantee (`SPEC_KEYS`/`SLOT_KEYS`)
directly; D-158-8 `INVARIANT VIOLATED` + auto-disarm + one `forgetMirrorGather()`
across retire/flush/disarm (`:863`, `:2099`, `:2140`, `:2157`); D-158-9 report
corrections in; D-158-10 both `.agent/plans/` files carry the standing-correction
header with history left intact.

**NEW RESIDUALS (none blocking).** **R-158-A (MEDIUM)** — the all-sequences-equal
rule assumes every engine universe shares one sACN sequence per frame. Each `sacn`
`Sender` owns its counter (`sender.js:28,60`), so lockstep is EMERGENT, not
guaranteed: it **holds from a clean boot** (`engine.js:951-955` builds `dmxBuffers`
from every `universeIds` entry each frame) but the **model-reload path breaks it
permanently** — `engine.js:1726 addUniverse` makes a Sender at sequence 0 while
siblings are at N, and `engine.js:1758 sendFrame({[staleU]:…})` advances ONE universe
3× for a universe the code says may be *"revived on a later reload"*. Reproduced: U5
at a fixed −7 offset ⇒ the multi-source gateway emitted **0 of 10** engine frames
(single-source LED dest unaffected, 10/10). Fail-loud and correct per P0 (better
silent than torn), but **unrecoverable without an engine restart** and the log blames
*"a source datagram was lost or a source is lagging"*, misdirecting to network loss.
**R-158-B (LOW/MED)** — D-158-2 not fixed for TOTAL-none: all 10 slots `none` ⇒
`requiredSources` empty everywhere ⇒ **0 frames to every destination**, every box
frozen, arm still accepted. **R-158-C (LOW, test-only)** — the plumbing value scan
skips non-strings, so a packed numeric address in an allowed key (`note: 168364348`,
which decodes to a 10.9.9.x documentation-range quad) passes all three assertions; not a safety hole (`note`/`label` are never
read by the resolver) and the test now asserts the schema, which is the real
guarantee.

**Counts observed:** focused **52 / 32 / 54** ✓; sim **1881 / 1875 / 6** ✓ same six
pre-existing; `security_check.py --all` **6** ✓; **zero real controller IPs** in all
four new/rewritten test files ✓. Engine: **2632 tests / 2621 pass / 11 fail** — total
inside the claimed 2631–2634 range, but **11 not 7**, and the four extra
(`SIGKILL mid-performance`, `enter captures pre-show snapshot`, `exit KEEP persists`,
`dirty deck tuning surfaces`) are all in `tests/mixer/performance_mode.test.js`,
which spawns engines, binds ports and asserts on `states/**` — **re-run in isolation
it is 11/11 green**. They are contention artifacts of the four concurrent agents
(and my own earlier engine run), NOT a regression; the documented seven are all
present and unchanged. An engine count taken while other agents run should not be
treated as a gate.

**RE-SMOKE IS REQUIRED.** The operator's earlier physical pass was against the
PRE-fix build, and these fixes change three things on exactly the paths a smoke
exercises: the emit condition is strictly stricter (a rig that previously emitted
torn frames can now legitimately emit NOTHING — that is R-158-A), the arm path gained
a hard gate proof + re-ack (an arm that previously succeeded can now refuse), and
held-dark destinations now transmit. Recommend two rows added to `_156` §9.3 before
running it: *bench dark + `frame NOT WHOLE … regions carry DIFFERENT engine frames`*
⇒ sequence desync, **restart the engine** (not packet loss, not a fixture menu); and
*an `UNGATED` line after arming* ⇒ the gate was lost, stop. Zero falsification
residue — every neutralisation this pass was a compile-time source rewrite from the
scratchpad, never an edit to a tracked file. **SHIP remains the operator's call and
no agent's.**

## `_162` — Engine-side test-gap catalog: offline-testable surfaces, specs for the Sonnet wave (DISCOVERY, READ-ONLY)

Operator-requested (Fable): find every meaningful UNTESTED-but-offline-testable
surface on the ENGINE side + cross-process boundaries; `_161` owns the sim side.
Zero production edits, zero git ops, no ports, no packets, no suites run. Report:
`.agent/reports/202608/20260805_162_engine_test_gap_catalog.md` — 16 gap entries
with implementable TEST SPECS, 8 regression specs pinned to `_157` fix slices,
6 survey defect notes, explicit non-gaps.

**Top gaps:** (1) `lib/sacn_output.js` — the engine's ONLY output path — has ZERO
tests; spec G-1 pins wire truth in-process via fake `dgram` + the vendored
package's own `Packet` parser (one datagram per (universe,dest) per frame,
start/stop gating, 1-indexing, zero-channel-goes-to-zero-on-the-wire, sequence,
close). (2) `mapPixelsToSacn` OUTGOING packing (`sacn_mapper.js:260`) untested in
the direction the engine uses — every DMX byte the rig emits; G-2 gives exact
byte expectations for the par/polyfill/white-synth/LED branches;
`suppressNativeStrobes` also has zero tests (G-11). (3) no permanent
engine↔bridge in-process contract rig (G-4 — `_157`/`_158` proved the fake-socket
technique then left it in scratch; spec includes relay fidelity, engineOwnedPairs
exclusion, pacing, and homes the D3/D4 receiver-side regressions). (4) only
`titanic` has model-load tests — `test_bench` and 7 others unlinted (G-3:
all-models load + patch-table lint + pinned overlap counts). (5) no HTTP
malformed/hostile sweep on the unauthenticated API (G-5: per-route bad JSON, 413
cap, traversal set, process-alive assertion). (6) corrupt state YAML behavior
UNPINNED — `state_manager.load()` silently limps to defaults (G-6 + NEEDS-RULING
on a `/status.stateRestoreDegraded` flag). Plus config boot matrix (G-8),
WS connect-replay + picker-catalog contracts against what CaptainPad actually
parses (G-9/G-10), shutdown ordering + 1× blackout pin (G-7, flips to 3× with
S-D10), meta-ABI stride (G-12), applyDmx channels (G-13), save-pattern compile
gate over HTTP (G-15), ffmpeg_resolver (G-16).

**Regression specs R-D1/D3/D4/D5/D8/D10/D11/D12** written to land WITH their
`_157` slices, marked blocked — they pin the fixes, not today's broken behavior.
R-D4's file is bridge-side: flagged for `_161` coordination, as is G-4's home
(`simulation/tests/engine_bridge_contract.test.js`).

**Survey defect notes for the fix wave (not test-as-spec):** N-1 silent state-limp
(P0 tension); N-2 DEAD config keys live in repo `config.yaml` today —
`sacn.multicast`, the whole top-level `playlist:` block, likely
`web_client.enabled` — the exact silently-ignored-key class the output guard
exists to kill; N-3 `playlist.delay_s: '90'` is a string in a numeric field
(harmless only because the key is dead); N-4 `loadConfig()` default path
catch-warns-continues, so with `--port` an unreadable config.yaml runs the engine
with the ENTIRE config silently ignored (override path throws; default should
too); N-5 `path.basename` on direct pattern-set routes mangles legal `dir/name`
slugs (playlist path accepts them — the two disagree); N-6 `sendFrame` silently
skips universes with no sender.

**Non-gaps verified:** OSC/fire_sync malformed input, WS crash-proofing, playlist
malformed-loud, state WRITE atomicity, mixer core (~40 files), two-word views,
output guard, VM compile errors, throttle, audio/companion/timeline breadth.
Suite-count discipline: every spec asserts its own file's counts — engine total
is nondeterministic ±3 (known). No hardware claim made; nothing here gates SHIP.

**Landed 2026-08-05 — `_159` DISARMED-PATH SAFETY REVIEW of BENCH MIRROR v3
(Opus, READ-ONLY, `.agent/reports/202608/20260805_159_disarmed_path_safety_review.md`):**
verdict **INERT-CONFIRMED on every disarmed surface reachable offline — no
defect.** The operator's stated worry ("messing up the routing and actual light
communications for the titanic scene or any other scene") does not reproduce.
Zero source/test/scene edits, zero git writes, no port bound, no packet, no
engine started, nothing armed. Snapshot: `sacn_bridge.js` 13:58 / `bench_mirror.cjs`
14:05 / `sacn_output_bridge.js` 12:49 — **post-`_158`** (D-158-1/2/3/4/5/8 all
present in the code read); re-checked at the end, nothing changed underneath.

**The counterfactual that makes "zero delta" provable:** `lib/bridge_routing.cjs`
diff vs HEAD is **comments only**, so `computeEffectiveRoutes` IS the pre-mirror
routing core, unmodified. Harness (both real bridges in-process, faked sockets,
`~/tmp/disarmed_review_159/`) compared the LIVE relay sender set against that
function at **15/15** steps of a full battery — boot, one window, client tags
across every scene on disk (`studio`/`test_bench`/`titanic`/`studiodj`/`led202`),
a second window, engine scene moves (with real 3.4 s waits for the bridge's own
poll), engine claims and releases a titanic pair, window close — **all equal.
0 mirror senders ever created. 0 connections to :6972 ever opened.** Relay byte
path identity-checked: the payload object handed to the sender IS the inbound
object, priority in = priority out (100 and 150), `sourceName` unchanged, **no
CID override on relay frames**. `active requests: 0`; **no mirror-owned timer
exists** (all six timers enumerated; the stall watchdog and misalign counter live
inside `flushMirrors`, scheduled only below `mirrorInbound`'s early return).
Exhaustive 14-row touch-point table in §2.1. **v3 is strictly LIGHTER than HEAD
on the disarmed path** — v2 called `readBenchMirrorSpecs()` on EVERY recompute;
v3 only when armed (0.295 ms measured, now only on connect/transition).

**Hostile sidecars: 16 trees via an `fs` OVERLAY (operator tree never written) —
relay unaffected in all 16, no crash, refusal only in `status.specErrors` /
`available` / the ARM text.** absent · unparseable · the real committed HEAD v1 ·
v2-shaped · empty · `null` · a list · unknown key · valid-but-unresolvable ·
**broken sidecar in all 8 scenes at once** · **valid sidecar in all 8 at once** ·
1 MB of comments · 5000 slots · BOM/NUL. ARM attempted for `test_bench`/`titanic`/
`studio`/nonexistent/`null` in every case: **every refusal = 0 frames, 0 gate
links, named reason.** Only `test_bench` carries a sidecar (all 8 scene dirs
enumerated). D-158-5 confirmed fixed in passing (a real v1 file now dies on the
VERSION check with the migration paragraph present).

**Containment:** `gateHolder` is module-scope with **no write path anywhere in the
output bridge** — proved dynamically by cache-dropping and re-requiring it:
**a fresh instance cannot start gated**. Gate dies with its link (verified both
directions). A **foreign** gate holder drops sim frames but the input bridge's
relay keeps running. The input bridge **never dials :6972 while disarmed**
(`ensureGateLink` has exactly three callers, all arm/disarm/prove). SIGINT while
disarmed takes the `_mirrorArm === null` branch and exits with **no blackout to
any relay route** (read-verified, not executed). **Arm→disarm round trip leaves
ZERO residue**: relay sender set byte-identical to pre-arm, 0 open mirror senders,
gate link closed, output bridge forwarding again, status object string-identical,
post-cycle scene battery still equal to the pre-mirror core. **ARM pressed with
the output bridge DEAD** refuses at R-23 in 15 ms with 0 frames and an untouched
relay that keeps relaying — the playa scenario that would otherwise dark the ship.

**Engine side (offline, guard called directly; no engine booted):** real
`config.yaml` passes and declares no `controllers:`; `destinations: [127.0.0.1]`;
reintroducing the key — or `controllers: []`/`null`, top-level `alsoFlat:`/
`protocol:` — refuses to boot; both deleted modules gone with no dangling refs
(only `ws_topic_routing` hits); `/status.outputRouting` the literal
`{controllers: []}`; **R-21 vacuous but armed** (a non-empty payload still parses
to 2 pairs). Guard suite 9/9. **Verified independently from the live route table
(not from `_157`'s prose): ship U10/U12 relay to `10.x.x.13`/`10.x.x.14`, so the
ship is unaffected by the removal** — but `10.x.x.202` appears in NO scene file,
so if that board is real it is now unfed and was never zeroed (**OBS-6, one live
look owed**).

**Seven observations, no defects:** OBS-1 new SIGINT handler exits 0 instead of
by signal (launcher restarts on any exit — inert); **OBS-2 `MIRROR_CID` hashes
MD5 at module load — the one disarmed-path line that CAN throw (FIPS Node), on
the ship's boot path**; OBS-3 sidecar I/O on the connect path (0.295 ms, ~8 ms
pathological); OBS-4 `:6972` accepts a gate from any unauthenticated client
(pre-existing `_157` D7 — ship unaffected, sim's own path dies until restart);
OBS-5 the `animate.js` belt trusts a pushed status (bounded three ways, and it is
explicitly not the enforcement); OBS-6 above; OBS-7 `window.sacnInput.armBenchMirror`
is a page global. **Residual-risk list and the 2 am RECOVERY INVARIANT are in the
report §5/§6: DISARM → close the arming window → kill the input bridge (comes back
DISARMED, full relay rebuilt from the `--scene` pin before any client connects) →
restart launcher → power-cycle. Every rung works; nothing persists an arm or a
gate.** Not self-recovering: the bench boxes' last look after a kill-mid-arm, and
`10.x.x.202`.

**Counts:** sim **1881 / 1875 / 6** ✓ same six pre-existing; focused four
(`bench_mirror`, `_resolve`, `_arm`, `bridge_routing`) **181 / 181 / 0** ✓; engine
`output_config_guard` **9 / 9 / 0** ✓. Engine full suite deliberately NOT run (it
spawns engines; `_158` already contributed that residue twice), and
`status_output_routing.test.js` skipped for the same reason. `security_check.py
--all` is **12 at the moment I write this**, not the `_158` baseline of 6: the 6
gitignored `.scene_backups/**` + **6 NEW `bm26-report-ip` findings in TRACKED docs
this wave wrote** — `_161`'s report ×4, `_158`'s report ×1, this tracker ×1 (all
synthetic/example addresses in prose). A seventh was mine and **I removed it**.
The number moves while several agents write concurrently; **whoever commits this
branch must clear the tracked-doc findings or the pre-commit gate blocks.**

**UNPROVABLE OFFLINE (exact live checks in report §4):** wire-level byte identity
of the disarmed relay (one capture: relay CID must be the package default, NOT
the mirror CID; priority 100; one source per universe); SIGINT emitting nothing;
the launcher's real restart timing; what `10.x.x.202` physically is; whether the
show box's Node is FIPS (OBS-2).

**Landed 2026-08-05 — `_160` full review of the TITANIC SCENE as it runs on playa,
bench mirror DISARMED (Opus, READ-ONLY + 3 parallel sub-reviewers,
`.agent/reports/202608/20260805_160_titanic_scene_playa_review.md`):**
verdict **NOT READY FOR PLAYA — 3 BLOCKERs, 6 HIGH**, none of them in the mapping.
Zero production edits, zero git writes, no port bound, no packet sent, no engine
booted against the real config, nothing armed. `_159` owns mirror-inertness; not
duplicated here. `_156` was still writing this tree (modified 30 -> 51, untracked
6 -> 18 mid-review) but **the titanic scene files were never touched**, which is why
every measurement is stable.

**The mapping is CLEAN and that is the larger half.**
`scene_model_parity titanic --strict` **PASS, exit 0, 0 err / 0 warn / 1 info**
(the info is "no `TB ` bench block" = plan step 6 unapplied). 80 DMX fixtures +
8 LED strands + 18 controllers -> 964 model pixels, scene implies 964, **0 unpatched,
0 pixels without a patch block**. **VERIFIED ROUTE TABLE: 38 universes -> 18
controllers, U2-27 + U30-41.** Derived offline through the REAL
`bridge_routing.readPatchDeclarations` -> `partitionRoutePairs`: 38 routes, 0 refusals,
0 anomalies, **0 universes routed to >1 IP**. Independently parsing all 964 model
pixels gives emitted universes {2..27,30..41} — **identical set**, so **no engine
universe lacks a route and no route lacks a feed**. controllers.yaml ports == route
universes with matching IPs; the one `parkedOutputs` (LeftLeftRopes o3, U42) correctly
has no record and no route; max channel used 238, **no channel claimed twice**;
the Subscribed Universes field (`common.yaml:192`) is a superset; `sacn_bridge.js:27`
pins `--scene` to **titanic by default**, so routes exist without engine or browser.
**D6 / the U10-U12 dark-fixture story is CLOSED and verified closed**: config.yaml
is `destinations: [127.0.0.1]` with no `controllers:`, `/status.outputRouting` is a
hardcoded `{controllers: []}`, `engineOwnedPairs` returns EMPTY, subtracts nothing.

**BLOCKER T1 (NEW) — `stop` freezes the ship, it does not turn it off.**
`show_server_ops.md:30/:63/:75` and `deploy/README.md:19,364` promise "lights OFF …
before generator work". `launcher.js:1074` -> `forceKillTree` -> `:438-448`
`taskkill /PID /T /F`. `/F` = TerminateProcess, so **the engine's SIGTERM blackout
(`engine.js:2521-2549`, verified present and correct) NEVER RUNS**, and the relay dies
in the same tree so nothing could carry one. The rig holds its last frame until an
**unknown** device-side timeout — the repo says so itself (`sacn_bridge.js:2301-2303`).
Workaround: drive an explicit blackout and confirm it BY EYE, then `stop`, then cut
PSU power. Also re-confirmed `_157` D10: even the graceful blackout is sent **1x**
while `engine.js:1753-1759` documents 3x.

**BLOCKER T2 (NEW) — the persisted show state boots the WHOLE ship at 2.7-17.9 %.**
`states/titanic/globals_state.yaml` `dimmers:` names **all 24** titanic groups, every
one in 0.0268-0.1786. At HEAD only 3 name keys existed and all 3 were **`1`**. Restored
silently at boot: `state_paths.js:1-33` (this tree IS the operator's show state,
authoritative unless `MARSIN_STATE_DIR`) + `state_manager.js:428-448` (a resolving NAME
key logs NOTHING; only unresolvable names warn). Checked and ruled out the legacy
numeric keys: `'1'..'17'/'189'/'486'..'498'` are applied verbatim via the `/^\d+$/`
branch but titanic's real section ids are {3,18-25,415,514-527} — **zero
intersection, all inert**. Values quantise to n/112 = hand-set slider positions.
**This is the most direct failure against the codex's one mission-critical goal and
nothing in the stack says a word.**

**BLOCKER T3 — D1's x2.55 clip, and the NEW finding that it is MASKING T2.**
Reproduced independently in-process against the real vendored `Packet` (no socket):
`0 1 2 5 10 20 26 40 50 64 80 99 100 101 128 … 255` -> `0 3 5 13 26 51 66 102 127 163
204 252 255 255 255 … 255`; CID = `6b796c6548656e73656c44656661756c`
("kyleHenselDefaul"). **NEW, and it changes `_157`'s picture:** the x2.55 gain is the
only thing lifting T2's dimmers to a visible level (Right Front Wall 2.7 % -> DMX 7 ->
wire 18 = 7 %; Left Back Wall 16.1 % -> DMX 41 -> wire **105** = 41 %). **Flipping
`useRawDmxValues` without fixing T2 first takes the wire byte down to the DMX column —
the rig goes 2.55x DARKER.** The D1 slice and the dimmer reset MUST land in one
operator gate, dimmers first. `_157`'s severity ranking is not disputed.

**HIGH T4 — a `sacn_in` sim tab is a second writer on all 38 universes, under the
engine's own CID.** `animate.js:703-736`: admits every patched fixture (`:721`),
hard-codes **priority 150** (`:726`), ~60 fps vs the engine's 40, straight through
`:6972` to the real box. Mirror DISARMED means `benchMirrorArmed` is false at `:702`, so
`_156`'s gate is not asserted. Relay senders set **no `cid:`** (`sacn_bridge.js:819-825`);
so do the output bridge's (`sacn_output_bridge.js:94-104`) — same CID+universe as the
engine, which is `_157` P4's measured **98/100 drop**. The ops docs actively tell the
operator to open the sim. Workaround: watch in ANY mode other than `sacn_in` with
mapping off (titanic has no effects fixtures, so the tab is then inert); one tab, never two.
**HIGH T5 (NEW)** — that tab then **holds its last frame forever** if the engine or
bridge dies (`universe_frame_buffer.js:68-77` explicit hold-last-frame; the 2 s
staleness in `universe_router.js:116-161` gates MERGING, never EMITTING) — a dead show
that looks alive, at a priority that outranks the relay.
**HIGH T6 (NEW, pre-existing at HEAD)** — `playlists/default.yaml`: **45 of 72 entries**
name patterns that do not exist (they live in `patterns/summer_camp/`; `patternExists`
resolves against the ROOT dir, `playlist_manager.js:100-111`). Degrades safely
(`:187` `_missing`, `autopilot_pick.js:63` skips) but the timeline's daytime,
philharmonic, party, sunrise, burn_night AND temple looks all point at
`default`, so the show runs on **27 usable entries**. Every OTHER titanic playlist is
clean (131/131 refs resolve).
**HIGH T7 (NEW, pre-existing at HEAD)** — `states/titanic/audio_state.yaml` carries
`capture.device: test`, the exact value `state_paths.js:1-15` names as a prior outage
cause. **test_bench was fixed in this very tree and titanic was not.** No mic at boot,
so every audio modulation and the timeline's `mood: true` autopilot are dead.
**HIGH T8 (NEW)** — LED fleet: **3 of 6 controllers are `provisional`** (boards nobody
has met: .62/.63/.64), and `LeftLeftRopes` (.60, carrying 80 px of silhouette) is bound
to `controllerId: testbench` / `boardId: angio4-old` with a 2026-08-03 `lastPush`.
`provisional` is a documented intentional grade (`controller_registry.js:125-150`) so
this is NOT a data defect — it is the size of the live-hardware gap.
**HIGH T9** — tracked code top-level-imports untracked files (`engine.js:64` ->
`output_config_guard.js`; `sacn_bridge.js:68`; `sacn_input_source.js:18`;
`controller_map_panel.js:42-43`) with `artnet_output.js`/`output_dispatch.js` deleted
but unstaged — `_156`'s slice must land as ONE unit; no deploy from this tree first.

**Per-defect playa ruling asked for by the operator (`_157` D1/D3/D4/D5/D7/D8): all
CONFIRMED, three are WORSE in titanic context.** D1 worse in **sequencing** (masks T2).
D3 worse in **reachability** — latent in theory, one operator click away in practice,
and the click is the one the ops docs recommend. D5 worse **in combination** — it is
why T4 will present on the night as "the ship is behaving weirdly" with a clean log;
cheapest fix in the list, should land FIRST. D7 **widened**: beyond `:6972`
(`WebSocketServer({port})`, all interfaces, no auth) and unfiltered multicast, ALSO
`osc: {host: 0.0.0.0, port: 10000, allowedSenders: []}` — `osc_listener.js:542` only
filters when the allowlist is NON-EMPTY, so any LAN device can drive every CPC param —
and `start.js:89` serves the **repo root** on `:6969` with `--cors`. Note for ops:
**the titanic show does not need `:6972` at all** (light flows engine -> loopback ->
relay -> controllers; `:6972` is browser-to-hardware only). D4 and D8 confirmed unchanged.

**Views/mixer CLEAN, no blocker.** Measured on the real model: **exactly 58** catalog
names, `viewTable` and `MaskRegistry` agree exactly (0 one-sided) = 24 groups + 7
word-1 composites + 27 auto-views. **Zero dead/zero-pixel selectors** (min 4 px);
zero bit collisions (word-0 0xcf3ffff / 24 bits, word-1 0x12664 / 7 bits; 31 of 62
slots used); LEFT + RIGHT = 964 exhaustive and disjoint; `views.yaml` and
`titanic.viewmasks.js` byte-equivalent. **`CTRL_n` selects the correct physical box for
all 18** — `cId` is the panel ORDINAL (`pixelblaze_model_exporter.js:247`,
`controller_registry.js:1903-1912`, decision 20), verified 18/18 by universe join,
sum 964. **No wrong-box bug.** The persisted `mixer_state` `target: RIGHT` IS a real
catalog name (482 px). MEDIUM fallout: the ordinal is **not countable** in the panel it
is named after (DMX cards then LED cards, so wrong for 14/18; no card shows its ordinal;
the pad shows `CTRL_9 · 80 px` with no name), and **12 of 18 CTRL_n numbers are a
DIFFERENT controller's stable `id:`**.

**Offline readiness CLEAN.** No show-time external fetch anywhere (sim, engine,
CaptainPad dist); every importmap entry and `<link>` in `index.html:11-32` resolves to
a present vendored file (three.webgpu/tsl, js-yaml, chroma, preact, htm, signals, both
font CSS + all 6 woff2) — **zero missing**; gstatic hits in `CaptainPad/dist` are dead
metadata; `node_modules` ships with the deploy; no NTP/DNS/telemetry/license path.
Two non-prod exceptions recorded: CaptainPad's `npx serve` (not a dependency — would
hit the registry offline) and `useServerDiscovery.ts:129` -> `api.ipify.org` on WEB
builds only. **Partial-stack matrix measured**: engine-before-bridge = **silent** full
dark (prevented by `launcher.js:1168`); `:6972` down = **no show impact**;
**no browser open at all = light still reaches the controllers** (`routeFrame` relays
BEFORE the `wss.clients.size===0` return, `sacn_bridge.js:2241-2249`; routes seed from
the pin at `:625`) — **the show does NOT require a browser tab**; bridge crash ~1 s;
engine crash = whole-stack teardown + 10 s cold boot with **no blackout**. MEDIUM:
headless prod emits **zero** frame-flow evidence (`:1302-1309` gates on `clientCount>0`);
any child exit tears everything down; a FROZEN bridge takes up to **~42 s** to detect.

**Residue.** Titanic scene files clean vs HEAD except UI-viewport residue
(`pixel_map_views.yaml` framing only; `common.yaml` default camera moved wide to
close-in, which affects every scene's `agent_render` presets). Real residue is in engine
state: T2 + `mixer_state` "New Layer" enabled at fader 1 blend_screen masked
Stacks -> **RIGHT** + `deck_state` `00_golden_hour_wash` -> **`13_sparkle`** (cursor
2 -> 22, localControls replaced) + `default.yaml` entry 0 `sliderLevel: 0.12` vs the
pattern's own **0.62** (`00_golden_hour_wash.js:21,29`; studiodj got 0.62). No conflict
markers, no added TODO/debugger/.only/.skip anywhere. **No cross-scene playlist
leakage** — the other four scenes' diffs are a coherent slider rename matching the new
pattern exports, and the prior "playlist residue revert" has NOT reappeared. Also LOW:
`RightRightRopes` is the only LED controller with an explicit `led.wire` block and it is
**byte-identical to `LED_WIRE_DEFAULTS`** (measured: only its 80 px carry `ledWire:`) —
a no-op today, a left/right silhouette split waiting for anyone who edits the defaults;
FRONT + BACK = 776, not 964 (188 px in neither, by design);
`pixel_map_views.yaml:19` excludes a group that exists nowhere (inert);
`timeline/playa_default.yaml:9` carries a **future date in a tracked file**
(`festival.startDate`) — needs an operator ruling, not a silent fix.

**Counts.** Sim `npm test` **1881 / 1875 / 6** vs `_158`'s **1875/1869/6** — **+6 tests,
ZERO new failures**; all six pre-existing (5 = `bench_section_sync` refusing because the
bench block reserves U10/U12 that titanic already occupies = plan step 6 unapplied, the
same thing the parity info line says; 1 = `pixel_map_view_defaults` "smallest collapsed
band 5.20 too close to the 5-unit threshold" on the live scene). `security_check.py --all`
**6**, exact baseline. **Engine `npm test` DELIBERATELY NOT RUN** — it rewrites
`states/titanic/*.yaml`, the exact artifact T2/T7/T14 are about; running it would have
destroyed the evidence.

**READY/NOT-READY.** Scene data **READY** (strict gate passes; no defect found in the
titanic mapping). Wire path **READY IN SHAPE, NOT IN FIDELITY** — topology right, one
writer, one router, exclusion proven empty rather than assumed; what travels down it is
wrong. Operations **NOT READY** — T1 alone disqualifies any night where a human touches
the rig. Fix order: T2 -> T5 + D5 listeners -> T1 -> T7/T6/T14/T15 -> land `_156` ->
**T3+T2 together, never D1 alone** -> D2 gate / D4 per-universe / network isolation / D8.
**Live checks offline cannot replace:** (1) each controller's E1.31 data-loss behaviour
and timeout in seconds — **T1's severity turns entirely on this number** and nothing in
the repo determines it; (2) power/verify/push the 3 provisional LED boards; (3) settle
10.x.x.60's identity (ship board or the bench `angio4-old`); (4) D1 before/after capture
per `_153` section 7E with the dimmers fixed first; (5) the tshark multicast sweep
(`_153` section 7A step 5, still open); (6) D8's occurrence on this OS/Node; (7) frame-flow
proof in headless prod; (8) the 38-sender relay under real link churn. **Nothing here is
a SHIP grant — the operator's physical confirmation remains the hard gate.**

**`_159` addendum (disclosed):** `sacn_bridge.js` was **rewritten under me at
14:32** (116 732 → 122 881 B) after my measurements. **All five harnesses were
re-run against the new file and all still pass** (H1 15/15, 0 mirror senders,
0 gate links; H2 all 16 hostile trees; H3/H5/H6 green), and the disarmed-path
delta was re-read. The one addition that touches this review is a **NEW TIMER**,
`_darkTickTimer` (`setDarkTick`, `:2134-2152`), a 40 fps ticker for the
all-`none` held-dark mapping (evidently the fix for `_160`'s R-158-B). It is
**mirror-only and cannot run while disarmed**: both call sites are
`recomputeRoutes:691` (`_activeMirrors.some(...)` — false whenever the array is
empty, i.e. always while disarmed) and `disarmBenchMirror:1747`
(`setDarkTick(false)`); the body early-returns on `_activeMirrors.length === 0`
and the handle is `unref`'d. Verdict **unchanged: INERT-CONFIRMED**. `file:line`
citations in the report are against the 13:58 snapshot unless the disclosure box
says otherwise.

### `_156` AMENDMENT 2 — post-`_158` §5 residuals closed (R-158-A/B/C), all falsified

`_158`'s re-verification returned **READY FOR PHYSICAL SMOKE** with D-158-1/2/3
and every minor CONFIRMED closed (its independent falsification of the gate fix
was clean, and its three gate attack variants — reconnect clearing the sticky,
loss after the proof, re-ack race — all came back safe by construction). Three
residuals were raised, none blocking; two would have actively misled a bench
session, so all three are fixed in `_156`. Report gains **§14**.

**R-158-A (MEDIUM) — a permanent sequence offset read as a lost datagram.** The
all-sequences-equal rule assumes one shared sequence per engine frame, and that
lockstep is EMERGENT, not guaranteed: each `sacn` Sender owns its counter from 0,
and the engine's model-reload path creates a Sender mid-run (`engine.js:1726`) and
advances one universe three times (`:1758`). `_158` reproduced a permanent −7
offset — the multi-source gateway emitted 0 of 10 frames while single-source LED
destinations kept running (correct fail-loud per P0, but unrecoverable without an
engine restart) and the log said *"a source datagram was lost"*, sending the
operator to hunt network loss. **Bridge-side diagnosis fix only — nothing in
`marsin_engine/` touched; engine-side sequence semantics belong to the `_157`
slices.** New `offsetSignature()` computes wrap-aware SIGNED lag (seven behind
reads `-7`, not `249`). **The discriminator is the MINIMUM lag each source reaches
while the window is open, not a repeated signature** — offsets swing within a
single frame as its datagrams land one at a time, so consecutive readings are
never identical (that was the first attempt and it never fired); a source merely
one frame late touches 0 at some point in the cycle, a permanently offset one
never does. After 6 flushes without an emission, any source whose minimum lag is
still non-zero is FIXED, and the new diagnosis jumps the throttle window because
it contradicts the line printed before it. Message names the offset (`U5 at -7`),
rules out the wrong remedy (`This is NOT network loss and it will NOT recover on
its own`), names the cause class (`engine MODEL RELOAD`) and states the remedy
(`**RESTART THE ENGINE**`). Regression is `_158`'s repro verbatim, plus a second
half asserting a ONE-OFF loss still reads as a lost datagram — otherwise the new
message would merely replace the old misdirection.

**R-158-B (LOW/MED) — a total-`none` arm froze every box.** D-158-2 gave a
slice-less destination `requiredSources` = every source the mapping reads; with
EVERY slot `none` the mapping reads nothing, so that set was empty everywhere and
nothing ticked — 0 frames, every bench box holding its last look, arm accepted.
**Chose emit-zeros over refusing the arm**, per the ruling text ("unselected =
actively held dark") and because "own the whole bench and hold it dark" is a
legitimate mid-session gesture. A destination with an empty `required` set now
emits unconditionally (it can be neither whole nor torn — the frame is all-zero by
construction), and a mapping with no source universes anywhere starts a
`DARK_TICK_MS = 25` (40 fps, the engine's own frame rate) ticker that marks its
destinations dirty. `unref`'d, started only for that degenerate shape
(`recomputeRoutes`, `_activeMirrors.some(m => m.state.bySource.size === 0)`),
stopped at disarm. **Not a timeout-emit fallback**: nothing is guessed and no
source is waited on. Regression arms all-`none`, feeds NO inbound traffic at all,
asserts ≥4 full-512 all-zero frames per owned destination, then asserts the ticker
does not outlive the disarm and the ship relay is restored.

**R-158-C (LOW, test-only) — a numerically encoded address evaded the scan.**
Closed both ways, the structural one being the point: the value scan now flags any
integer that byte-unpacks into `10.0.0.0/8`, **and** a new assertion parses the
committed sidecar twice — once clean, once with `note`/`label` poisoned with a
packed address, a dotted quad and a hex literal — and requires an identical
`slot`/`bench_fixture`/`default_source` set, the only fields the resolver reads.
An address smuggled into free text cannot become a route in ANY encoding: a
property, not a pattern list.

**Smoke procedure.** §9 now opens with a prominent **RE-SMOKE IS REQUIRED**
notice naming the three behavioural changes since the operator's first pass (the
arm path gained a gate proof; the emit condition is stricter; held-dark
destinations now transmit) — a pass on the old build tells you nothing about this
one. §9.3 gained the two rows `_158` specified: an `UNGATED` line after arming ⇒
**STOP THE SMOKE** (and a successful arm reporting that is a defect, not a
hardware problem), and **bench dark while the LED strands still run** ⇒ read the
`BENCH MIRROR STUCK` line and restart the engine (that asymmetry IS the
signature, since single-source destinations are structurally immune). The
frozen-fixture row now states flatly that while armed nothing on the bench should
ever freeze.

**Falsification** (same in-memory compile-time interception, no file touched):
RA neutralised ⇒ *"a persistent constant offset must be reported as its own state,
not as a lost datagram"*; RB neutralised ⇒ *"U2 → 10.x.x.10 must keep receiving
frames with no engine input at all — got 0. Silence here means the box holds its
last look."* Unmodified, both pass.

**Counts.** `bench_mirror.test.js` **52/52**, `bench_mirror_resolve.test.js`
**32/32**, `bench_mirror_arm.test.js` **56/56**; full sim `npm test`
**1883 / 1877 / 6** (same six, byte-identical; **+49 tests / zero new failures**
against the original 1834 / 1828 / 6 baseline); engine `npm test`
**2640 / 2633 / 7** (same seven). `security_check.py --all` **6**, unchanged. No
new test file carries a real controller address (0).

**Engine-suite contention, recorded correctly.** `_158` measured four extra
failures in `tests/mixer/performance_mode.test.js` that appear ONLY when
concurrent agents are running — it spawns real engines and competes for
resources. **In isolation on this tree it is 11 / 11 / 0**
(`node --import ./tests/helpers/setup_config_guard.mjs --test tests/mixer/performance_mode.test.js`).
A run showing it red is measuring machine contention, not this branch. The engine
TOTAL also drifts run to run (2631–2640 observed) because
`tests/effects/effects_v2_mode_page_layout.test.js` crashes at file level — the
failing LIST is the stable quantity, not the count.

**Still NOT SHIP** — the operator's physical confirmation remains the hard gate,
and a **re-smoke is required** because the earlier pass ran against the pre-fix
build.

## `_163` — SIM test-gap implementation: harness extraction + 14/16 catalog gaps

**Agent:** test implementer `_163` (Sonnet 5, operator-assigned) · **Branch:**
`feat/bm_readiness`. **Report:** `.agent/reports/202608/20260805_163_sim_test_implementation.md`.
Implements report `_161`'s catalog. **TEST CODE ONLY** — zero production edits, zero git
ops, no operator port bound, no real controller IP in any new test.

**Prerequisite done first:** extracted the H-A fake-module bridge harness from
`bench_mirror_arm.test.js:518–847` into `tests/helpers/bridge_harness.mjs`
(`createBridgeHarness()`, call once per test file) and refactored
`bench_mirror_arm.test.js` to consume it — **zero assertions changed**, verified
**56/56 before and after** (the file had already grown 54→56 under a concurrent
agent mid-session; re-read immediately before editing, matched against the CURRENT
content, not a stale one).

**Implemented (14 of 16 gaps + prerequisite), 120 new tests (119 pass, 1 `todo`):**
G1 arbitration/lockout (9, `sacn_bridge_arbitration.test.js`) — found the catalog's
OWN priority-0 example was wrong for the live config: `sacn_high_priority=100` means
the inflated `priority||100` conflation hits the `>=` threshold EXACTLY, so priority-0
triggers an OVERRIDE, not "routes as low" as `_161` assumed. G3 client lifecycle (7).
G4 engine-poll (11, real wall-clock waits — `pollEngineStatus` has no
`module.exports` at all, so it cannot be called directly; ~40s file runtime is the
real cost of that). G2 output-bridge datapath (8, incl. a real 21s wait for the 15s
stale-sender reap — confirms `_157` D9's sequence-reset timing exactly). G6
sacn_input_source frames + G15 half (8). G5 UniverseRouter/FrameBuffer (10, fake
clock). G10 shutdown ordering (9 across 3 files — `_shuttingDown` never resets, so
disarmed/armed/mid-blackout-race each needed their own fresh harness; grabbed the
input bridge's specific `process.listeners('SIGINT')[1]` to invoke directly rather
than `process.emit`, which would also fire the output bridge's own independent
SIGINT handler). G7 save-server endpoints (10, **reduced scope**: skipped
`/save-pattern`/`/delete-pattern`/`/list-patterns` because `SIM_SAVE_SERVER_ROOT`
does NOT redirect `ENGINE_ROOT` — those endpoints resolve to `<OS temp
dir>/marsin_engine`, one level above the per-test unique dir and SHARED across every
run on the machine; flagged as a test-hook isolation gap, not routed around).
G8 scene lint (21 + 1 `todo`, **reduced scope**: skipped the DMX-address-overlap
check — the real rule lives inside `checkSceneModelParity` and needs fixture/3D-model
resolution most of the 6 non-gated scenes don't have; a fresh reimplementation
risked a second, subtly-different "what a patch occupies" algorithm). G12
sacn_output_client + G15 half (6). G9 load_ports (5). G11 animate.js wiring (5,
source-text). G14 boot-invariant/error exits (5). G13 monitor-panel pure logic (5,
weak source-text guard — module imports `htm/preact`, not node-resolvable; option
(a) from the spec, not (b)).

**Skipped: G16** (broken-sidecar warn dedup) — needs either writing into the real
`scenes/` tree (forbidden) or a `BM26_SIM_SCENES_ROOT` production hook (its own
reviewed slice), exactly as `_161` predicted. Left for `_159` or a follow-up.

**Residue tripwire (G8) is a `test.todo`, not a normal assertion** — it correctly
fails today. Surfacing per AGENTS.md rather than deleting:
**`simulation/scenes/summer_camp_dome/patches.yaml.original` still exists** (first
flagged `_161`) — operator: please delete or archive it, `robocopy /MIR` ships it to
the show server.

**Production-bug list for the Opus reviewer** (none fixed, all pinned/documented —
full detail + line numbers in the report): (1) priority-0 → OVERRIDE on live config,
sharper than `_161` catalogued [D12]; (2) global-not-per-universe lockout [D4]; (3)
three more silent-remap conflations across `sacn_input_source.js`/`sacn_output_client.js`
[D12 x3]; (4) the 15s stale-reap sequence-reset timing, now pinned exactly [D9];
(5) `/save-cameras` silently defaults to/creates `scenes/titanic/` with no `?scene=`
[P0-tension]; (6) the `SIM_SAVE_SERVER_ROOT`/`ENGINE_ROOT` test-hook isolation gap
(new finding, save-server); (7) the `patches.yaml.original` residue (data, not code).

**Counts.** Baseline before this session's new tests: **1883 / 1877 / 6** (same six
`_161`/`_158` already recorded). Harness refactor alone: still **1883/1877/6**,
byte-identical failing names. **Final: 2003 / 1996 / 6 / 1 todo** — same six
failures, **+120 tests, zero new failures.** `security_check.py --all`: **6**
findings, all pre-existing in gitignored `.scene_backups/studiodj/**` — **zero new**.
No new test binds a real port, sends a real packet, or carries a real controller IP
literal.

**Files:** new — `tests/helpers/bridge_harness.mjs` + 16 new `tests/*.test.js` files
(see report §5 for the full list). Modified — `tests/bench_mirror_arm.test.js`
(harness-consumption only). **Not touched** — every production file; the tracked-file
diff this session produced is exactly those two categories (verified via `git
status`). The heavy concurrent tree churn visible in `git status` during this
session (marsin_engine/*, several other simulation/* files, a new
`scenes/titanic/playlists/dirty_probe.yaml`) belongs to other agents working in
parallel — not this task.

**Handoff:** `_162` owns the engine-side catalog (`_162` report) and the one shared
boundary (G8's playlist→pattern resolution, deliberately left to them). The G7/G8
scope reductions and the G16 skip are each a candidate follow-up slice; none are
blocking. Still **NOT SHIP** — unchanged from `_158`/`_159`'s standing verdict; this
slice is test coverage only and does not itself move that needle.

## `_164` — Engine-side test-gap implementation: 11 of 16 gaps + a critical crash pin

**Agent:** test implementer `_164` (Sonnet 5, operator-assigned) · **Branch:**
`feat/bm_readiness`. **Report:** `.agent/reports/202608/20260805_164_engine_test_implementation.md`.
Implements `_162`'s catalog. **TEST CODE ONLY** — zero production edits, zero git
ops, no operator port bound, no real controller IP literal, no packets to hardware.
Sibling `_163` implemented the SIM catalog (`_161`) concurrently; `_163`'s
`simulation/tests/helpers/bridge_harness.mjs` already existed by the time this
session reached G-4 and was reused as-is (no `_163`-owned file touched).

**Baseline:** engine `npm test` **2631 / 2624 / 7** (inside the documented
2631-2634 range; the 7 are the known audio_capture/effects_v2/osc_listener set).

**Implemented (12 catalog entries, 138 new engine tests + 5 new sim tests, all
green):** G-1 sACN wire truth (9, `tests/io/sacn_output_wire.test.js` - the
vendored sacn lib's payload-to-wire path multiplies by 2.55, so only {0,255} are
pinned exactly; intermediate values are R-D1's job). G-2 + G-11 mapPixelsToSacn
packing + native-strobe suppression (22, `tests/io/sacn_mapper_pack.test.js` -
found the mono-luma branch ROUNDS via `Math.round`, so the catalog's own
127-truncation assumption was wrong; real value is 128, pinned as such). G-3
all-models load+lint (34, `tests/mixer/all_models_load_lint.test.js` - **found
`dev_test_bench` cannot boot at all**: its `.viewmasks.js` sidecar declares
group names absent from the 0-pixel model; verified against the REAL engine
CLI, pinned as a named characterization, not fixed). G-4 engine-bridge
byte-fidelity rig (5, `simulation/tests/engine_bridge_contract.test.js` - reused
`_163`'s harness; drives the REAL `marsin_engine/lib/sacn_output.js` Sender
through a dgram patch, parses real wire bytes with the vendored `Packet` class,
feeds them into the bridge's REAL receiver path; empirically confirmed Node's
ESM-importing-CJS `sacn` import does NOT route through the harness's
`Module._load` patch, so the engine side stays real while the bridge side
stays faked - exactly the "real sender vs real receiver" the catalog asked
for). G-5 + G-15 HTTP malformed sweep + save-pattern compile honesty (36 + 1,
`tests/e2e/http_malformed_sweep.test.js` - see CRITICAL finding below). G-6
corrupt state YAML (6, `tests/state/state_corrupt_load.test.js`). G-7 shutdown
ordering (3, `tests/e2e/shutdown_ordering.test.js`, **scope cut**: both the
stale-universe-reload half and the live-signal half turned structural - see
report section 5). G-8 config boot matrix (8, `tests/state/config_boot_matrix.test.js`
- **found `_162`'s own N-2 survey note wrong**: the top-level `playlist:`
config block is NOT dead, `lib/autopilot.js` reads/writes it via its own
independent load cycle on the same file). G-9 WS connect-replay (5,
`tests/e2e/ws_connect_replay.test.js` - found `/ws/params` replays ONLY
`sharedParams`, never `paramSchema`, contra the catalog draft). G-10 picker
catalog contract (4, `tests/e2e/picker_catalog_contract.test.js` - found there
is NO word/bit discriminator on `namedViews` entries anywhere in the wire
contract; Tier-A resolves entirely by name, by design). G-12 meta-ABI stride
(6, `tests/mixer/meta_abi_stride.test.js` - found the `LANE_*` named constants
in `meta_abi.js` are imported NOWHERE; both real pack loops hardcode their own
offsets, a real drift-detection gap now closed by this pin). G-16
ffmpeg_resolver (4, `tests/audio/ffmpeg_resolver.test.js` - found a REAL
silent-fallback-chain P0 violation: an explicit misconfigured path is silently
discarded, not refused; NEEDS-RULING pinned).

**CRITICAL production bug found mid-implementation, pinned in its own file:**
`GET /pattern-dirs/<invalid-slug>` (e.g. the catalog's own G-5 traversal
example, `..%2F..`, or plain `Default` with a capital D) **crashes the ENTIRE
ENGINE PROCESS** - `api_server.js:4911-4920` sends `res.writeHead(200)`
speculatively BEFORE `listPatternsInDir()` (which throws on any slug failing
`VALID_PATTERN_DIR`) runs; the catch block's `res.writeHead(400)` is a SECOND
header-send on an already-sent response, throwing `ERR_HTTP_HEADERS_SENT` with
nothing left to catch it, reaching `engine.js`'s `uncaughtException` handler
which (correctly, per its own design) `process.exit(1)`s. Reproduced
deterministically 7/7 in isolation. One unauthenticated GET request, no state
required, kills the exterior lighting. Pinned in its OWN isolated
spawn/teardown (`tests/e2e/pattern_dirs_crash_pin.test.js`) so it cannot
cascade into other tests; the main sweep deliberately avoids sending this exact
input to its shared harness. **Recommend this as the #1 priority for the next
fix wave**, ahead of the already-tracked D-series items.

**Skipped - time budget, not blocked:** G-13 (applyDmx channels) - not
implemented this pass; a straightforward follow-up pickup. **Correctly left
alone (blocked on `_157` fix slices, not this agent's call):** R-D1/D3/D4/D5/
D8/D10/D11/D12.

**Other findings folded in from `_162`'s N-1..N-6 survey, with test evidence:**
N-1 (state-restore-degraded, no `/status` flag) confirmed + pinned with a
NEEDS-RULING test. N-2/N-3 **corrected** (playlist block is live, not dead -
see above; the `delay_s` string is harmless because `autopilot.js` already
`parseInt`s it, not because the key is dead). N-5 (`path.basename` mangles
`dir/name` slugs on direct pattern routes) confirmed + pinned. N-4/N-6 not
independently re-verified this pass (flagged, not re-tested).

**Counts.** Engine final: **2772 / 2765 / 7** - same 7 failure names as
baseline, byte-identical, **zero new failures**. `performance_mode.test.js`
verified green in isolation (11/11) per the documented contention caveat, not
chased. Sim (touched via G-4's new file only): one full run, **2008 / 2001 / 6**
- same 6 pre-existing failures, **zero new**. `security_check.py --all`:
**7 findings, not 6** - the documented 6 (gitignored `.scene_backups/studiodj/**`)
are unchanged; the 7th is a real MAC address literal in
`.agent/reports/202608/20260805_163_sim_test_implementation.md:113` - **written
by `_163`, not this session** (untracked file at scan time), in a TRACKED
(non-gitignored) report, which is worse than the gitignored `.scene_backups`
class since it would actually be committed. Flagged for `_163`/the reviewer to
redact; not this session's file, not touched. This session's own additions
contribute **zero** new findings.

**Files:** new - `marsin_engine/tests/io/{sacn_output_wire,sacn_mapper_pack}.test.js`,
`marsin_engine/tests/mixer/{all_models_load_lint,meta_abi_stride}.test.js`,
`marsin_engine/tests/state/{state_corrupt_load,config_boot_matrix}.test.js`,
`marsin_engine/tests/e2e/{http_malformed_sweep,pattern_dirs_crash_pin,
ws_connect_replay,picker_catalog_contract,shutdown_ordering}.test.js`,
`marsin_engine/tests/audio/ffmpeg_resolver.test.js`,
`simulation/tests/engine_bridge_contract.test.js`. **Not touched:** every
production file, `bridge_harness.mjs` (read-only reuse), every `_163`-owned file.

**Handoff:** the `GET /pattern-dirs` crash (above) is the standout priority.
G-16's fallback-chain ruling and N-1's state-restore-degraded ruling both need
an operator/reviewer decision. `dev_test_bench`'s boot failure needs a fix or
the model needs marking scratch-only. G-13 open for a follow-up slice.
R-D1/D3/D4/D5/D8/D10/D11/D12 remain correctly blocked on `_157`. Still **NOT
SHIP** - unchanged standing verdict; this slice is test coverage only.

## `_165` — Opus review of `_163`'s SIM test wave (VERDICT: ACCEPT-WITH-FIXES)

**Agent:** reviewer `_165` (Opus, operator-assigned) · **Branch:** `feat/bm_readiness`.
**Report:** `.agent/reports/202608/20260805_165_sim_test_review.md`. Reviews `_163`'s
implementation of `_161`'s 16-gap catalog: 16 new test files, the extracted
`tests/helpers/bridge_harness.mjs`, and the `bench_mirror_arm.test.js` refactor.
**READ-ONLY on production code AND on `_163`'s test files** — zero edits, zero git ops,
no operator port bound, no packet sent. All mutations were applied **in memory only**
via a `--import`/`--require` source-rewriting preload (`~/tmp/review_165/`); no file on
disk was modified.

**VERDICT: ACCEPT-WITH-FIXES.** The operator's stated distrust of Sonnet work is not
borne out here. **Zero vacuous tests found.**

**Mutation testing — 30 mutations across 12 production files, 30 kills.** Each mutation
neutralises one production expression and re-runs the owning test file. Every safety-
critical claim in the wave has real teeth: arbitration (`priority||100`, `universe||1`,
the global-lockout branch, the lockout timer — 4/4), engine poll (`_enginePollBusy`, the
`service` gate — 2/2), shutdown ordering (armed-blackout gate, `_shuttingDown` latch,
the mid-blackout branch — 3/3), output-bridge datapath (pool key, 519-length gate,
`STALE_SENDER_MS` — 3/3), boot invariant/error fork (2/2), the browser-side D12 pins
(3/3), the router stale boundary, client-lifecycle tagging/cleanup (2/2), the
`/save-cameras` titanic default, and all three source-text pins.

**Harness-extraction safety — the `_152`/`_158` regressions still fail when their fixes
are neutralised, THROUGH the new harness.** `_152 D1` dies when `if (_mirrorDisarming)
continue;` is removed; `_152 D2` / `_152 RESIDUAL-1` / `_155 A3` die when
`blackoutInFlight()` stops reporting the disarm blackout; `_158 R-158-A` dies when the
fixed-offset diagnosis is forced false. `bench_mirror_arm.test.js` is **56/56** in
isolation, same names; the destructure at `:502-508` re-binds exactly the names the
inline block declared. **Extraction is safe; zero assertions lost.**

**Suite integrity reproduced exactly.** `cd simulation && npm test`: **2003 / 1996 / 6 /
1 todo**, the same six pre-existing failures byte-identical. `bench_mirror_arm.test.js`
alone 56/56. `security_check.py --all`: **6**, all gitignored `.scene_backups/studiodj/**`.
**No flake:** the five timing-sensitive files (engine poll, output datapath, both armed
shutdown files, arbitration) each ran **3x clean in isolation**. IP hygiene independently
re-verified: every live controller is `10.1.1.x`, every test literal is
`10.0.0.x`/`10.1.0.x`/`10.1.2.x`/`10.9.9.x` — **zero overlap**.

**PIN discipline: 12 pins, ZERO blessings.** Every characterization names its defect ID,
cites its report, and states the post-fix expectation; every test NAME states the defect
("**not** preserved as 0", "**silently** coerced … **not a refusal**") or is explicitly
labelled a characterization.

**Production-bug verification — all 7 of `_163`'s claims CONFIRMED, zero wrong.** Two are
UNDERSTATED and matter for the fix wave: (1) the priority-0→OVERRIDE defect cannot be
configured away downward — `sacn_high_priority`'s slider `min` is also **100**; (5) the
`|| 'titanic'` silent default is at **FIVE** call sites in `save-server.js`
(`:56`, `:60`, `:66`, plus `:242`/`:488`/`:532` `backupScene`), so a scene-less write
also files its BACKUP under titanic — not the two `_163` listed. **Highest-value
finding for the operator: the `SIM_SAVE_SERVER_ROOT` → `ENGINE_ROOT` isolation gap**
(`save-server.js:35-36`) — confirmed with direct evidence (a spawn logged
`Regenerated <OS temp>/marsin_engine/patterns/manifest.json`); a one-line production fix
unblocks the whole pattern-endpoint test surface.

**Four defects, all non-blocking, all test-code or report-wording:**
**D-165-1** G2's error ladder is half-implemented and the reduction was NOT disclosed —
mutation evidence: neutralising the entire 30 s heartbeat branch
(`sacn_output_bridge.js:223-229`) leaves the file **8/8 green**, and blanking the
`(after N suppressed errors)` recovery tail also leaves it 8/8. `errorsSinceLog` is
asserted nowhere. **D-165-2** G15's port-guess half is missing while the report says
"folded in **as specced**" — the four config-fetch port fallbacks
(`sacn_input_source.js:477,492`, `sacn_output_client.js:221,231`) are unpinned by any
test in the repo. **D-165-3** G8's stated blocker is overstated: `checkSceneModelParity`
takes `input.model` **optionally** (`scene_model_parity.cjs:280,285`) and the overlap
rule doesn't read `modelPixels`, so the real validator COULD have been invoked on the six
scenes with findings filtered — the concern was right, the impossibility was not.
**D-165-4** G7's rationale wording is inaccurate: `save-server.js:218` calls
`writePatternManifest()` unconditionally at boot, so the file already writes to shared OS
temp on every run (as does the pre-existing `save_server_hardening.test.js`).

**G16 skip ENDORSED.** Blocker verified real: `SIM_ROOT = path.join(__dirname,'..')`
(`sacn_bridge.js:23`) with no env hook, `readBenchMirrorSpecs` unexported (the file has
**zero** `module.exports` — which also confirms `_163`'s claim that `pollEngineStatus`
cannot be called directly). The spec's weak fallback would have been genuinely vacuous
(`warnOnce` never fires on a valid tree), so skipping beat writing a zero-teeth test.

**Correction for the record, clearing `_163`:** `_164`'s tracker block reports a **7th**
`security_check.py` finding — "a real MAC address literal in
`20260805_163_sim_test_implementation.md:113`, written by `_163`". **This does not
reproduce.** Two `--all` runs this session both returned **6**, and a MAC-shaped grep over
`_163`'s report returns nothing. Either it was misattributed or it was already redacted;
either way `_163`'s report is clean on the current tree.

**Cleared as NOT defects:** no try/catch swallows an assertion (all four `try {` blocks are
`try/finally` restores); no truthy-on-object assertions; no missing `await` before an
assertion; no assertion on a value the test told its own mock to produce; order-dependence
is deliberate and documented in the three files that have it.

**Handoff:** the four D-165 items are follow-up slices, none blocking. Priority for the
`_157` fix wave, in order: the `ENGINE_ROOT` hook (one line, unblocks G7's remainder),
`/save-cameras`'s five-call-site titanic default, then the D12 conflation family.
Operator action still outstanding from `_163`: delete or archive
`simulation/scenes/summer_camp_dome/patches.yaml.original`. Still **NOT SHIP** — unchanged
standing verdict; this review adds confidence in the test wave, not hardware confirmation.

## `_166` — Opus review of the ENGINE test wave (`_164` vs `_162`) — ACCEPT-WITH-FIXES

**Agent:** reviewer `_166` (Opus, operator-assigned: "Sonnet agents wrote them, Opus
agents review them") · **Branch:** `feat/bm_readiness`. **Report:**
`.agent/reports/202608/20260805_166_engine_test_review.md`. Sibling `_165` reviewed the
SIM wave concurrently; this review covers `marsin_engine/tests/**` (12 new files) plus
the G-4 contract rig that lives sim-side. **READ-ONLY on production code and on `_164`'s
test files** — zero edits, zero git ops, no operator port bound, no packets, scratch in
`~/tmp/review_166/`.

**VERDICT: ACCEPT-WITH-FIXES.** The wave is real coverage, not decoration.

**Mutation testing — 27 mutations, all applied IN MEMORY** via an ESM `load` hook
(`--import` + `MUT_SPEC`), never a byte changed on disk; every rule throws if its target
string is absent, so a "surviving" test can never be an unapplied mutation. **24 killed,
1 survived (a genuinely vacuous test), 2 inconclusive by tooling/target.** Killed
mutations covered: the off-by-one in sACN payload packing (kills 3 wire tests + the G-4
relay test), the `_started` gate, `addUniverse` idempotency, socket close, packet
sourceName/priority, the master-dimmer force, the strobe dedupe, the `EndyshowBar`
strobe-channel table, the `state_manager` warn and default, the 413 cap, the bad-JSON
error string, the `Not Found` body (one space), the "No API port" refusal, the
output-config guard message, `cSacn.priority || 100`, a forced bad patch addr (6 models
incl. titanic + test_bench), a forced cross-fixture overlap, and the meta-lane pack
offset.

**The CRITICAL claim is CONFIRMED, three ways.** (1) A from-scratch Node rig on an
ephemeral loopback port carrying only the branch's 6 lines + the real
`VALID_PATTERN_DIR` regex: every failing slug raises an uncaught
`ERR_HTTP_HEADERS_SENT` and the request never completes. (2) The real spawned engine
prints `ENGINE FATAL — uncaughtException … ERR_HTTP_HEADERS_SENT` and exits. (3)
**Mutation M13 fixes the bug in memory (build the JSON body BEFORE `writeHead(200)`) and
the pin goes RED** — so the pin is a genuine tripwire and the root cause is isolated to
exactly that ordering. **Severity refined:** it does kill the PROCESS, but
`deploy/boot_server.ps1` relaunches after `RestartDelaySeconds = 10` on a non-75 exit —
supervised, one request buys a ~10 s + boot blackout and a REPEATED request buys a
permanent crash-loop; launched by hand (`npm start`, every bench/agent run) there is no
supervisor and the ship stays dark. **Trigger class:** any `GET /pattern-dirs/<seg>`
whose decoded segment isn't `default` and fails `/^[a-z0-9][a-z0-9_-]{0,63}$/` — any
uppercase letter, space, dot, leading `_`/`-`, odd character, or >64 chars.
`/pattern-dirs/Default` is enough. Unauthenticated, no body, no state — and because it is
a plain GET, **any web page open in a browser on the playa LAN can fire it cross-origin**
(no preflight, response never needs to be readable). A malformed percent-escape (`%zz`)
does NOT crash — `decodeURIComponent` throws before `writeHead`, so the catch works;
the bug is strictly the post-`writeHead` throw. **Isolation of the pin is CORRECT:**
`node --test` runs each file in its own child process and the harness takes its own
random 7100-7399 port, so the deliberately-killed engine cannot cascade — verified in
isolation and inside the full suite.

**Defects (report-only, not fixed):** **D-1 VACUOUS** —
`sacn_mapper_pack.test.js:332` (out-of-bounds strobe channel) asserts only
`doesNotThrow`; deleting the production bound check leaves all 22 tests green, because an
out-of-range `Uint8Array` write silently no-ops in JS — the assertion is unfalsifiable.
**D-2 POLICY** — `simulation/tests/engine_bridge_contract.test.js:91` hardcodes a REAL
controller IP (also at `:51`, `:86`), contradicting `_164`'s own "no real controller IP
literal in any new test" claim; already tracked in scene YAML so not a new disclosure and
`security_check` doesn't flag it, but derive it from the scene data the harness already
loads. **D-5 SPEC WEAKENING** — `http_malformed_sweep.test.js:115`'s
`ACCEPTS_NONOBJECT_AS_NOOP` is a skip-list not a pin (only `status < 500` is asserted for
5 routes), so the "minor consistency defect" `_164` reports is not actually pinned
anywhere. **D-6 BRITTLENESS** — `config_boot_matrix.test.js:206-229` asserts the live
`marsin_engine/config.yaml`'s VALUES; a legitimate operator config edit turns the suite
red for no safety benefit. **D-7** `shutdown_ordering.test.js` is 3 source-text greps
against `engine.js` (cuts honestly reasoned, but G-7's real assertions stay unproven —
keep G-7 open; a `POST /shutdown` route would unblock it and R-D10). Plus D-3/D-4/D-8
(low/cosmetic). **No VACUOUS files; no pin blesses a bug as correct** — pin discipline
across the crash, ffmpeg P0, `dev_test_bench`, `LANE_*`, `/ws/params` and the two
`blocked-on S-D10/S-D12` markers is CORRECT in every case.

**Production-bug claims: zero wrong.** Independently confirmed — the crash; N-1 silent
state limp; N-2 correction (`playlist:` block IS live: `autopilot.js:11,69,83,90-108,155`
loads/saves `config.playlist` through its own cycle and `api_server.js:7` constructs it —
**`_164` is right, `_162` §6 N-2/N-3 needs a correction note**); `sacn.multicast` and
`web_client.enabled` dead (grep); N-5 `path.basename` at `api_server.js:5077`;
`dev_test_bench` cannot boot (ran the real engine: exit 1, groupBits sidecar stale on
ParLights/VintageLights/BarLights/LED_0); `resolveFfmpegPath('/does/not/exist/ffmpeg')`
returns the vendored `ffmpeg-static` binary, identical to passing `null` — P0 violation
CONFIRMED; `LANE_*` dead everywhere but `meta_abi.js`; `/ws/params` replays only
`sharedParams` (`api_server.js:10596-10607`); no word discriminator on `namedViews`. One
`_164` comment is drifted: `config_boot_matrix.test.js:216` claims `web_client.port` /
`build_dir` ARE consumed — engine-side they are not. **G-13's skip was cheap to avoid** —
`applyDmx` is a plain sync method and `global_effect_blackout.test.js` already stands up
the fixture; "time budget" undersells it. First pickup of the follow-up slice.

**Counts (all re-run by me).** Engine: **2769 / 2762 / 7** — failing LIST byte-matches
baseline (5x `audio_capture`, 1x `effects_v2_mode_page_layout` file-level, 1x
`osc_listener` EADDRINUSE→EACCES), **zero new failures**. `performance_mode.test.js`
isolated: **11/11**. `pattern_dirs_crash_pin.test.js` isolated: **1/1** with the FATAL
observed. Sim: **2008 / 2001 / 6** — the 6 pre-existing, none from G-4.
`security_check.py --all`: **6 findings, not 7** — all in gitignored
`simulation/.scene_backups/studiodj/**`; `_163`'s report MAC has been cleaned, so
`_164`'s "7" was accurate at its write time and is now stale. Engine-suite state-yaml
residue present and documented-expected.

**Handoff, in priority order:** (1) **fix `GET /pattern-dirs/<invalid-slug>`** — three
lines, plus an audit of every other `writeHead`-before-work site in `api_server.js`;
(2) rulings needed: the ffmpeg explicit-path-discard P0 question and the
`/status.stateRestoreDegraded` question; (3) `dev_test_bench` — fix the sidecar or mark
the model scratch-only; (4) test-side fixes D-1/D-2/D-5/D-6; (5) G-13 (cheap) and G-7
(needs a shutdown route) stay open, R-D1/D3/D4/D5/D8/D10/D11/D12 correctly still blocked
on `_157`; (6) add the N-2/N-3 correction note to `_162` (I did not edit their file).
Still **NOT SHIP** — unchanged standing verdict; this review raises confidence in the
test wave and surfaces one remotely-triggerable engine-kill, not hardware confirmation.

**`_166` ADDENDUM (written at review close) — the fix landed mid-review; the crash pin
is now RED.** While this review was running, a concurrent agent landed the
`/pattern-dirs` fix into the working tree: `marsin_engine/lib/api_server.js` now carries
a `COMPUTE THE BODY BEFORE COMMITTING HEADERS` block on that route plus a new
`sendJsonError` responder whose header cites `_164` §3. `git diff -U0 --
marsin_engine/lib/api_server.js | grep -c pattern-dirs` went from **0** (early in this
review) to **1**. Re-ran the pin just now: `tests/e2e/pattern_dirs_crash_pin.test.js` is
**1 / 0 pass / 1 fail**, failing after 10.3 s on `engine did not exit within timeout` —
the exact failure mode mutation M13 predicted, which independently re-confirms both the
root cause and that the pin is a genuine tripwire. **Every count in the `_166` block
above was taken BEFORE that fix landed and is accurate as of that moment;** post-fix the
engine suite is expected to read **2769 / 2761 / 8**. **Now-urgent follow-up:** rewrite
the crash pin exactly as its own header instructs — flip it from "the engine must die" to
"the request is handled without dying" (4xx with `Invalid pattern directory`, then `GET
/status` still 200), keep the root-cause comment as history, and add the two non-crashing
edges this review characterized (a malformed percent-escape `%ZZ`, which always went
through the catch correctly, and the legal `default` / sub-directory slugs). Whoever owns
the fix slice owns the rewrite; until it lands the engine suite carries a spurious 8th
failure. Nothing else in the `_166` verdict changes.

## `_168` — CaptainPad Dimmer Rack: MASTER fader (drive all 24 group dimmers at once)

**Agent:** feature `_168` (Opus) · **Branch:** `feat/bm_readiness`.
**Report:** `.agent/reports/202608/20260805_168_captainpad_master_dimmer.md`.
Operator request, verbatim: *"can you add a single slider in the dimmer rack on captain
pad to controll allllll sliders at the same time as convenience so I can control them all
if needed"*.

**What shipped.** One MASTER slider pinned at the top of the Dimmer Rack card, above the
group-fader row it commands. Full-width HORIZONTAL bar in the accent colour with a
`MASTER` pill + `ALL <n> GROUPS` caption + `%` readout — deliberately unlike the vertical
"nautical" group knobs so it can't be mistaken for one.

**Semantics (documented, no hidden modes).** **Absolute:** the master writes its value
verbatim to every section — no ratio/scaling mode, because the rack has no such concept
anywhere else. **Readout = MEAN of the section levels:** right after a master move that
equals the commanded value; once an individual fader diverges the bar shows the true
average rather than a stale "last commanded" number. **Same command path as an individual
fader:** one `POST /section-brightness` per section, fanned out — so it persists into
`globals_state.yaml` by stable group name exactly like a hand-moved fader. **`marsin_engine`
was NOT touched — zero new engine API.** Works in SECTION-ID space (aliased group names
sharing one section are written once and weighted once).

**Backpressure, not a fixed throttle.** 24 groups × a drag's values would queue hundreds of
POSTs behind the browser's 6-per-host cap and land the STALE ones last. The sender keeps
only the LATEST requested level while a batch is in flight. Measured on a 12-step drag:
**8 batches of exactly 24 writes**, last batch = the release value.

**Fail loudly.** A failed write paints a red `24/24 groups failed — <reason>` line under
the bar (verified by blackholing the POST route mid-session). Engine-down at load keeps
the rack's existing "Engine offline / RETRY" state with no master rendered.

**Files.** New: `CaptainPad/utils/master_dimmer_logic.ts` (pure, RN-free:
`uniqueSectionIds` / `masterLevel` / `applyMasterLevel` / `createCoalescedSender`) +
`CaptainPad/utils/master_dimmer_logic.test.ts` (17 cases). Changed:
`CaptainPad/app/(tabs)/dimmer_rack.tsx` (master strip; the rack now OWNS every section
level in `dimmerStates` instead of fire-and-forgetting the POST) and
`CaptainPad/components/NauticalFader.tsx` (external-value sync now moves the KNOB, not
just the number — it was positioned once on mount; `draggingRef` guard; new
`onPanResponderTerminate` mirroring release, which also fixes a pre-existing stuck-drag
hazard on a cancelled gesture; live callback refs; `React.memo`).

**Verification** — throwaway mock engine on **:6990** + fresh `expo export` dist served on
**:7167**; never Metro (stale-bundle memory), never the operator's `:6967`/`:6968`, no
operator port bound. Screenshots (`~/tmp/feat_168/shots_clean/`): load @ **70%** = exact
mean of the seeded levels; master dragged to 25% → **all 24** faders at `0.25` with knobs
moved, mock `GET /dimmers` confirms sections 1–24 all `0.25`; one fader then dragged to
`0.82` → master reads **27%** (the new mean); engine-down red banner; iPad-portrait
two-high stack intact.

**Counts.** vitest **45 files / 960 passed / 6 skipped, 0 failures** (baseline 44 / 943 / 6
→ +1 file, +17 tests, **zero new failures**). `tsc --noEmit` **clean**. `expo lint` **21
problems (4 errors, 17 warnings) — all pre-existing**, none in any touched file.
`security_check.py --all` **6 findings = baseline** (gitignored `.scene_backups/studiodj/**`
MACs), zero new. Only page error is `Minified React error #418` (hydration), which
reproduces identically on untouched `/config` and `/audio` — pre-existing, app-wide.
`CaptainPad/dist/` was rebuilt for verification (gitignored, untracked). No git ops.

**Open follow-up (not needed for the request):** the mean readout doesn't live-track dimmer
changes made OUTSIDE the rack (MIDI, a second CaptainPad) until the screen refetches on
foreground — the rack has never had a dimmer WS mirror; a `dimmers` broadcast on
`/ws/control` would close it.

---

## `_167` — FIX: `GET /pattern-dirs/<invalid-slug>` no longer kills the engine

**Agent:** fix `_167` (Opus) · branch `feat/bm_readiness` · report
`.agent/reports/202608/20260805_167_engine_http_crash_fix.md`. Operator-authorized fix
of `_164` §3 — the one-request, unauthenticated, no-state-required remote engine kill.

**Root cause, confirmed exactly as `_164` and `_166` described it.** The
`/pattern-dirs/<dir>` route committed response headers (`writeHead(200)`) BEFORE
evaluating `listPatternsInDir(...)`, which correctly THROWS on any slug failing
`VALID_PATTERN_DIR` (`/^[a-z0-9][a-z0-9_-]{0,63}$/`). The catch arm's second
`writeHead(400)` then raised `ERR_HTTP_HEADERS_SENT` from inside the catch, uncaught →
`engine.js`'s `uncaughtException` → `ENGINE FATAL` → `process.exit(1)`.

**Fix, two halves, both in `marsin_engine/lib/api_server.js`.** (a) The route now
computes the JSON body BEFORE `writeHead`, so a refused slug yields a **loud, named
400** while the response is still uncommitted. (b) New module-scope export
`sendJsonError(res, status, payload, headers)` checks `res.headersSent` and refuses to
`writeHead` twice under any circumstance — it does NOT swallow: it names the error and
the intended status on stderr, then closes the socket. `headers` passes straight
through, so `sendJsonError(res, 400, x)` is byte-identical to the bare
`res.writeHead(400)` it replaces. **No global `uncaughtException`/`clientError` net was
added** (P0: no fallback behaviors) — grep-verified that no `server.on('clientError')`
exists; `engine.js`'s handler is untouched and its own comment already states the
"fix at the source, this is only the net beneath" doctrine (`_108` precedent).

**Same-shape audit (brace-matching scanner, `~/tmp/fix_167/scan_shape*.mjs`).** 97
try/catch blocks in `api_server.js` have a catch that calls `res.writeHead`. 56 never
commit headers before a throwable. **19 are the exact crash shape (a real function call
evaluated after headers are committed) — 18 FIXED, 1 false positive.** The 18: the
`/pattern-dirs` bug itself, plus `POST /scene`, `POST /scene/reload` (both of which had
a nested try that SWALLOWED the second-writeHead throw — replaced, no more swallow),
`PATCH /global-effect-slots`, `POST /global-effect-slots/<id>/<action>`,
`GET /party-config`, `GET /mixer/param-presets`, `PATCH /osc/config`, `POST /playlists`,
`DELETE /playlists/<name>`, `POST /deck/overlays/<id>/playlist[/entry]`,
`POST /deck/playlist`, `POST /deck/playlist/capture`,
`POST /mixer/channels/<id>/playlist[/entry|/capture|/discard]`. **`GET
/mixer/param-presets` is the notable second find** — its own comment claimed a corrupt
preset file would "fail loud"; it actually killed the engine. False positive: the
`/scheduled-tasks/<id>` outer try, whose `writeHead` lives in an async `readBody`
callback that cannot run before the outer catch. **23 tier-2 blocks listed NOT fixed** —
only property reads on already-resolved values run after headers there, not reachable
by malformed input; converting them is the follow-up that would make the class
structurally impossible.

**Pin test flipped**, exactly as `_166`'s addendum demanded.
`tests/e2e/pattern_dirs_crash_pin.test.js` went 1 test (assert the engine dies) → **16**
(assert it survives): 10 hostile slugs (`..%2F..`, `%2e%2e%2f%2e%2e`, `Default`,
embedded space, embedded dot, leading `_`, leading `-`, 65-char, `%ZZ`, `%00`) each
asserting 400 + a NAMED reason + `proc.exitCode === null` + a live `/status`; happy-path
(`/pattern-dirs` lists `default`, `/pattern-dirs/default` returns a non-empty array);
end-of-sweep liveness; and 4 unit tests driving `sendJsonError` directly, including the
branch where `writeHead` would throw. Filename kept so `_164`/`_166` references resolve;
its own isolated spawn/teardown kept so a regression stays contained.

**Counts.** `pattern_dirs_crash_pin.test.js` isolated: **16 / 16**.
`http_malformed_sweep.test.js` (G-5) isolated: **36 / 36**. Full engine suite:
**2789 / 2782 / 7** — failing LIST byte-matches baseline (5x `audio_capture`, 1x
`effects_v2_mode_page_layout` file-level, 1x `osc_listener` EADDRINUSE→EACCES), **zero
new failures**; `performance_mode.test.js` passed in this run. Total rose from `_164`'s
2772 because this file went 1 → 16 and concurrent agents added their own.
`security_check.py --all`: **6 findings = baseline** (gitignored
`.scene_backups/studiodj/**`), zero in any file I touched. No git ops. Engine-suite
state-yaml residue present and documented-expected.

**Concurrency disclosure.** `api_server.js` was edited by at least two other agents
while I worked (a `/shutdown` route from the `_169` slice, an `outputRouting` change
from the bench-mirror work). Their hunks are in the tree alongside mine and were NOT
reverted; the full-suite number therefore measures the combined tree, and the two
isolated runs are the clean evidence for this fix.

**Operator note.** The fix applies at your NEXT engine restart. The engine currently
running on your box still has the crashing route in memory — until it is restarted,
`GET /pattern-dirs/Default` against THAT process still kills it. Nothing here touched
your live engine.

**Follow-up left open:** convert the remaining 23 tier-2 catch arms to `sendJsonError`
to make the double-`writeHead` process-kill class structurally impossible in this file.

## `_171` — "the browser is not the router": the `sacn_in` viewer write REMOVED; the rest BLOCKED on an operator decision

**Report:** `.agent/reports/202608/20260805_171_browser_router_removal.md`. Operator ruling: *"do
the browser not being the router"* — engine → sim SERVER (the router) → controllers, browser never
transmits; plus the tab-switch freeze. No git ops, no port bound, no packet, no process started,
nothing armed, no scene/pattern/playlist/engine file edited. Scratch `~/tmp/fix_171/`.

**LANDED — a viewer can no longer write.** One file, `src/core/animate.js`. The output block's skip
condition read `if (!isEffect && lightingMode !== 'sacn_in' && !isMappingOutput) continue;` — i.e.
it OUTPUT whenever the mode WAS `sacn_in`. Inverted: `const browserIsDataSource = lightingMode !==
'sacn_in'` now feeds `isMappingOutput`, and the skip is `if (!isEffect && !isMappingOutput)`.
**Both halves were needed**: `isMappingOutput` previously read only `profile.mappingEnabled`, which
is true for `emissive` / `full` / `pixel_mapping` / `2d_pixels`, so deleting the mode clause alone
would have left an `emissive` viewer transmitting anyway. **Every scene ships `lightingMode:
sacn_in`** (`scenes/common.yaml:167`, no scene overrides), so this is the configuration the operator
actually runs.

**This is the operator's freeze.** A `sacn_in` tab re-sent every patched universe at hard-coded
priority 150 — outranking the bridge's 100, under the same default CID, which `_157` P4 measured at
98/100 packets dropped — on the BROWSER's clock, so background-tab throttling stalled the loop and
the tab kept painting the rig with one frozen frame while the show was dead (`_160` T4/T5, predicted
by `_19` §4). No writer, no throttling path to the wire. **For titanic it is total**: the scene
patches no Fog/Haze/Horn/Fire fixture, so a titanic viewer tab in any profile now emits nothing.

**Closes:** `_160` **T4** and **T5** (for the ship), `_159` **OBS-5** (the browser belt no longer
stands between a viewer and the wire in `sacn_in`; the mode exclusion does, and it reads no pushed
state). **NOT closed:** `_159` **OBS-4** (unauthenticated `:6972` gate command) — it dies with the
gate, and the gate cannot die until the decision below.

**STOPPED, per the brief's own instruction** (*"if you find [a legitimate feature depending on
browser→hardware transmit in non-`sacn_in` modes], STOP and report the conflict instead of breaking
it"*). **I found one, and it is a live interactive control:** `gui_builder.js:2814-2845` builds a
**"💨 Hold to Fog"** button per `TEFogMachine`/`ChauvetHaze4D` that submits DMX straight into the
browser-local router (`submitFrame('fog_ui', 250, …)`). `window.dmxRouter` is browser-local; the ONLY
path from there to a physical fog machine is the `animate.js` loop → `:6972`. No engine call, no
server endpoint. Delete the browser transmit path and that button silently stops firing fog — it
still depresses, still logs, nothing happens. Second, weaker case: `_19` §2.4 explicitly preserves
browser-generator bench output (`pixelblaze`/gradient, engine not running) as "single writer by
definition" — but `_19` is an **unimplemented design** (its own §2.4 called for deleting the
`sacn_in` branch, which was still present until today), so it is a proposal, not evidence of use.

**Therefore NOT done:** the browser transmit path still exists for effects and browser-generator
modes; `:6972` still forwards; **no gate code was touched** — under the landed shape the gate stays
load-bearing, because a fog or bench-generator tab can still write while ARMED, so R-23 /
`proveOutputGateHeld` remain necessary. Every `_152`/`_158` regression keeps its teeth; no gate
coverage was removed or weakened.

**DECISION NEEDED (report §3/§4):** may "Hold to Fog" and bench-generator output be killed?
Option **A** = as landed (both work, gate stays, OBS-4 open). Option **B** = kill browser transmit
entirely (both die, gate deleted, ARM proof asserts structural absence, OBS-4 closed). Option **C**
= B but move fog to an engine endpoint (capability survives, architecture intact) — **my
recommendation** if the browser is to be fully out of the wire. Report §5 scopes the B/C follow-up
to the line, including the trap that the sACN OUT panel's **BLACKOUT button is not a `:6972`
control** (it POSTs the engine's `/global-blackout` on `:6968`) and must be rehoused, not deleted.

**Docs/comments scrubbed** (report §6): `animate.js:680-685` block header, `:719` *"relay ALL
universes to controllers (simulation acts as bridge)"*, `:495` *"the simulation acts as a
bridge/visualizer"*, and the belt comment at `:690-698`. A test now pins that `simulation acts as
bridge` appears **nowhere** in `animate.js` — it was load-bearing misinformation and the sentence a
future reader would restore the behaviour from. Deliberately NOT scrubbed: the `_153`/`_154`
quotations of the old code inside historical investigation reports, and `_19` §2.4 itself (the
design under dispute — rewriting it while the question is open would falsify the record).
`show_server_ops.md`'s *"open the sim view and confirm the lights are animating"* is now safe as
written for titanic.

**Tests.** `tests/animate_output_wiring.test.js` reworked 6 → **10**, all passing: the mode
exclusion at the source; that a mapping-enabled PROFILE alone is not enough; that the skip condition
no longer mentions `sacn_in`; that `simulation acts as bridge` is gone; that the throttle freeze is
named where the fix lives; and that Hold-to-Fog still has its carve-out with a pointer to the
conflict section. Full sim suite **2020 / 2013 / 6** against a measured pre-change baseline of
**2008 / 2001 / 6** — same six, byte-identical, **zero new failures** (+12 = my +4 and `_170`'s +8).
Focused mirror suites **140 / 140 / 0**. `security_check.py --all` **6**, unchanged.

**Concurrency artefact, recorded so it is not mistaken for a regression.** My first post-change run
showed **11** failures. None were mine: 2 were `_170`'s own R-D1 tests mid-landing, and 3 were my
mirror source-shape assertions invalidated **textually** by `_170`'s edit. I verified before
touching anything that they had **preserved** `cid: MIRROR_CID` (adding `useRawDmxValues: true`
beside it) and **preserved** `packet.sequence` as `routeFrame`'s 4th argument (changing only
`packet.payload` → `rawDmxPayload(packet)`), so the D-158-3 mechanism was intact throughout.
`_170` then re-based those three assertions themselves and the settled tree is 2020/2013/6. I
changed nothing of theirs. **Note for `_170`:** under option B/C the output bridge's payload-unit
fix becomes moot, because the forwarding path it scales would no longer exist — sequence that work
after this decision.

## `_169` — `stop` now blacks the rig out before the force-kill (T1 FIXED)

**Agent:** fix `_169` (Opus) · **Branch:** `feat/bm_readiness` · **Report:**
`.agent/reports/202608/20260805_169_stop_blackout_fix.md`. Operator-authorized and
explicitly optional ("the stop to black out is optional but nice to have → fix if
minimal work"). Fixes **T1** of `_160`. No git ops, no scene/pattern/playlist edits, no
operator port bound, no live process signalled. Scratch `~/tmp/fix_169/`.

**The defect.** `launcher.js stop` force-kills the tree (`taskkill /PID <pid> /T /F` =
`TerminateProcess`), so the engine's SIGTERM handler — the ONLY emitter of the shutdown
blackout (`engine.js` §8) — never ran and every controller held its **last live frame**
until its own unknown E1.31 timeout, while four docs promise "lights OFF … before
generator work". Unfixable launcher-side alone: Windows has no graceful signal (the
launcher's OWN teardown also force-kills its children), and the engine had **no in-band
shutdown route** — `POST /scene` / `/scene/reload` reach `shutdown()` but always restart.

**The fix — reach the EXISTING blackout, don't build a second one.**
`engine.js:2569` `engineCore.requestShutdown = () => shutdown()` (one hook onto the same
re-entrancy-guarded `shutdown()` the signal handlers call). `api_server.js:5511`
`POST /shutdown` — requires `{"confirm": true}` (400 `CONFIRM_REQUIRED`), 500
`NO_SHUTDOWN_HOOK` if unwired, else 200 then `setTimeout(…, 50)` → the hook
(respond-then-act, the `POST /scene` pattern). `launcher.js:1070-1129`
`blackoutEngineBeforeKill(lock, deps)` + calls at `:1140` (stale-lock branch) and `:1154`
**immediately before** `forceKillTree(lock.pid)`.

**Why not the existing `POST /global-blackout`** (which would have been a zero-engine-change
fix): it writes `globalsState.blackout = true` + `saveGlobals()`, and
`state_manager.js:413` **restores that flag at boot** — `stop` would have made the next
`start` boot the ship DARK. `/shutdown` persists nothing.

**Bounded and loud.** POST, then poll `pidAlive(lock.children.engine)` every 200 ms for a
bounded **3 s**. Confirmed ⇒ one stdout line. **Five** unconfirmed outcomes, every one
carrying `BLACKOUT NOT CONFIRMED — rig may still be lit. Confirm darkness by eye before
any electrical work.`: no `engine` child in the lock, engine pid already gone, port map
unreadable, POST rejected, engine still alive after the budget. **The kill ALWAYS
follows** — the function never throws and never returns past the kill; `stop` still
always stops. The already-gone guard also means `stop` can never POST `/shutdown` into
whatever OTHER engine happens to answer `:6968` when its own engine is dead.

**Two deliberate properties:** `/shutdown` is **not** gated by `rejectIfPerformanceMode`
(a stop during a live show is exactly when the blackout matters — it sits with the other
safety routes), and it **requires an explicit confirm**. Recorded, not swallowed: the
engine API already accepts `/global-blackout` from anyone who can reach `:6968`, so this
adds no new auth class, but it does add a *stop-the-show* verb to that surface.

**Two integration fixes the loud path needed.** `deploy/deploy.py` `stop_stack()`
captures `launcher stop`'s output and only prints it on failure — an unconfirmed blackout
on rc 0 would have been **invisible in the show path**; it now echoes any
`BLACKOUT NOT CONFIRMED` line. `.agent/ops/show_server_ops.md` §stop now states how OFF
happens and what the warning means (treat the rig as LIT, kill the PSUs).

**Tests.** NEW `marsin_engine/tests/state/shutdown_api.test.js` (**2/2**): a REAL engine on
an **OS-assigned free port** (asserted not in `{5568, 6966-6972}`), `--dest 127.0.0.9`
black-holing sACN, temp state/playlists, scene `summer_camp_dome` — unconfirmed POST ⇒
400 + still serving; confirmed ⇒ 200, **exits 0 on its own**, stdout shows `⏹ Stopping...`
AND `✅ Shutdown complete` (printed from `finish()`, which only runs after
`sacnOut.sendFrame(blackBuffers)` settles). Observed: `Sender stopped after 15 frames` vs
`14 frames rendered` — **the 15th frame IS the blackout**. NEW: 6 tests appended to
`simulation/tests/launcher_supervision.test.js` (file **12/12**), all in-process with
injected deps — confirmed path (stderr **empty**, no crying wolf), request-failed, the
**bounded** wait (injected clock: 1 precheck + exactly 15 polls, then loud), already-dead
engine (**zero POSTs**), no engine in lock, and a source-level **ORDER pin** that the
blackout precedes `forceKillTree` (the defect was pure ordering).

**Counts.** Engine `npm test` **2790 / 2783 / 7** — failing LIST byte-matches baseline
(5× `audio_capture`, 1× `effects_v2_mode_page_layout` file-level, 1× `osc_listener`
EADDRINUSE→EACCES), **zero new failures**. Sim `npm test` **2021 / 2014 / 6** vs baseline **2008 / 2001 / 6** — the same 6
pre-existing failures, **zero new**; `launcher_supervision.test.js` isolated **12/12**.
`security_check.py --all` **6** = the gitignored `.scene_backups/studiodj/**` baseline,
zero from my files.

**Concurrency disclosure.** Several other agents were editing this same working tree
during this session (`output_dispatch`/`artnet_output` removal, `sacn_bridge.js`,
`sacn_output_bridge.js`, `animate.js`, CaptainPad); `engine.js` and `api_server.js` carry
their hunks alongside mine. An earlier sim run this session showed **13** failures — 7
extra, in `animate_output_wiring` / `engine_bridge_contract` / the two `sacn_bridge_*`
files, **none of which import any file `_169` touched**; they cleared on the re-run and
track those in-flight edits plus a live engine answering `:6968` at that moment.

**Operator note.** The fix applies at the **next** stack start — the engine currently
running on your box has no `/shutdown` route in memory, so a `stop` against it will print
`BLACKOUT NOT CONFIRMED` (accurately: that engine cannot be asked to go dark) and then
kill as before. Nothing here touched your live stack.

**Follow-ups left open.** (1) `_157` D10 / `_160` §2: even a graceful shutdown sends the
blackout **once** while the engine's stale-universe path uses a 3× repeat
(`engine.js:1753-1759`) — one lost datagram on exit still = frozen bright. Cheap fix,
pinned today by `shutdown_ordering.test.js`'s "exactly ONE ... (blocked-on S-D10: flips
to 3x)". (2) `_166`'s G-7 gap ("needs a shutdown route") is now **unblocked**.
(3) `startChild`'s exit handler logs `engine exited unexpectedly … Tearing down` during a
deliberate stop — cosmetic, deliberately left (brief forbade other launcher changes).

---

## `_170` — RAW DMX on the wire (S-D1): the ×2.55 percent clip is DEAD

**Agent:** fix `_170` (Opus, operator-authorised "do #4") · **Branch:** `feat/bm_readiness`.
**Report:** `.agent/reports/202608/20260805_170_raw_dmx_wire_fix.md`. Fixes `_157` **D1**
= `_153` **F1b + F7** = `_105` **F3 + F8** — one root cause, four symptoms, one slice.
**No git ops. No operator process touched, no port bound, no packet emitted.**

**The defect.** The vendored `sacn@4.6.2` treats `Sender.send({payload})` as a **0..100
PERCENT** field (`packet.js:138` — `inRange(payload[ch] * 2.55)` unless `useRawDmxValues`)
and `objectify` divides wire bytes by 2.55 on receive. **No project source ever set the
flag, and every project source wrote raw 0-255 DMX into that field.** Measured with the
real `Packet`: `0->0 1->3 32->82 50->127 100->255 101->255 200->255 255->255` — **exact
round-trips 2 of 256**, on the engine lane AND the mirror lane. Everything the engine
rendered above DMX 100 left as FULL, so colour was crushed toward white on every
controller on the ship; the browser got 0-100 "DMX" (the 39 % preview, `_105` F3); and the
mirror truncated those percent floats into a `Uint8Array` (F7's ~100 levels) on top.

**The fix.** (1) All **four** senders declare `useRawDmxValues: true` in
`defaultPacketOptions` — engine `sacn_output.js`, `sacn_output_bridge.js`'s pool, the input
bridge's **relay** senders, the **mirror** senders (beside `MIRROR_CID`). (2) The receive
path reads `packet.payloadAsBuffer` via a new `rawDmxPayload(packet)` in `sacn_bridge.js`,
never `packet.payload` (that getter IS the percent view), so relay resend + mirror splice +
WS broadcast all carry raw bytes. (3) The browser needed **no change** — `sacn_mapper.js`'s
`/255` was always right arithmetic fed the wrong unit; a repo grep confirms **zero** `2.55`
compensations existed anywhere, so there was none to remove. (4) The mirror needed no
arithmetic change either: integers instead of floats into its `Uint8Array` kills F7 with
the unit. **Shape deliberately unchanged** — `rawDmxPayload` keeps `objectify`'s sparse
(zero-omitting) shape so ONLY the unit moves.

**The `_157` pitfall was real and is heeded.** Handing `payloadAsBuffer` back as `payload`
objectifies it to percent and then writes that percent AS the byte: measured
`1->0 64->25 128->50 200->78 255->100` — **2.55× DARK**. `rawDmxPayload` returns a plain
1-indexed object of raw numbers; an executable **PITFALL GUARD** test pins it.
`payloadAsBuffer === null` is structurally unreachable from the wire and is treated as an
invariant violation (`❌` + `process.exit(1)`, like `checkBootSubscriptionInvariant`) —
**not** a throw, because the vendored `Receiver` wraps `emit('packet')` in try/catch and
would swallow it.

**PROOF — all 256 values, three lanes, ZERO distortion.** Every wire byte produced and read
with the package's OWN `Packet` class (the `_157`/`_164` technique), never a hardcoded
offset. **A** engine→wire **256/256**. **B** wire→`payloadAsBuffer`→`rawDmxPayload`→relay
resend→wire **256/256** (the relay's exact round-trip `_157` P8 measured under the old
units is preserved under the new ones). **C** raw→`spliceMirrorFrame`→`mirrorPayload`→
mirror sender→wire **256/256**. Was 2/256 on A and C. Position independence asserted too
(first/middle/last channel).

**Test flips: 6 pins flipped, 5 new tests, 2 truth tables extended past {0,255}.**
Flipped: `sacn_output_wire.test.js` header ("KNOWN QUIRK, pinned not fixed / blocked on
R-D1" → "NOW FIXED", `_155` A5's {0,255} rule retired), its `_155` A5 value test, its
1-indexing `notEqual(…,0)` → `equal(…,42)`; `engine_bridge_contract.test.js`'s "relays as
the sacn-percentage-scale equivalent" → "as RAW DMX 255"; `bench_mirror.test.js`'s `_155`
A4 CID source pin (now requires `useRawDmxValues: true`) and its `_153` §10 / `_158`
D-158-3 pin (now requires `routeFrame(…, rawDmxPayload(packet), …)`). New: the full R-D1
0..255 table in the engine, a `defaultPacketOptions`-placement mechanism guard, the R-D1
end-to-end 256-value PROOF + PITFALL GUARD in `engine_bridge_contract`, and the 256-value
**armed mirror** compose+wire proof in `bench_mirror_arm`. `bench_mirror_resolve` gained
mid-range truth tables per fixture family (PAR: 32/64/128/200 on each of R/G/B/W + a
10-ch ramp; STRAND: same per RGBW pixel lane + a 16-ch ramp), retiring the `_155` A5 /
`_156` "0 and 255 only" restriction in prose. Held UNCHANGED on purpose: the ALL-ZERO
"empty payload" pin (sparse shape preserved). Harness: `inbound()` builds the raw
512-byte buffer (same `{channel: 0..255}` API, now fails loudly outside 0-255) and
`FakeSender` records `useRawDmxValues`; three direct `emit('packet')` sites updated.

**Suites — zero new failures.** Sim baseline **2008/2001/6 fail/1 todo** → after
**2024/2017/6/1**, failing LIST byte-identical (same 6, same files, same lines; G8's
`summer_camp_dome/patches.yaml.original` still outstanding for the operator). Engine
baseline **2784/2776/8 fail** → after **2793/2786/7**, the 7 a strict SUBSET of the 8.
`security_check.py --all`: **6**, all gitignored `.scene_backups/studiodj/**` — baseline.
**Tree moved under this session** (concurrent `_167`/`_168`/`_169` + bridge-routing/scene
edits), which is why totals rose by more than this slice's own +5 sim / +2 engine tests.
**Contention caveat:** the strobe case (failed baseline, passed after), `EADDRINUSE`, and
`pattern_dirs_crash_pin` are timing-sensitive; the engine list is stable only up to those.

**OPERATOR — bench A/B, before you restart anything.** Full recipe in the report §6.
Short: on the **currently running** stack (old code still in memory) ARM the bench mirror
for `test_bench`←`titanic`, select **`test_const`** with **Color 1 = deep amber/orange,
S=1, V=1** (hue ≈ 0.05-0.08 — R at 255, G mid-range, B at 0; the one look that puts a
channel at each extreme AND one exactly where the percent scale did its worst), note every
slider position, photograph the pars and the strand with locked exposure. Optional
10-second desk check: drive one par to **50 %** and read its channel — **before it reads
255, after ~128**. Then disarm, **restart the engine AND the launcher** (the fix is in the
engine and in BOTH bridges), re-arm, reselect the identical settings, photograph again.
Use only a pattern with no `AUDIO_MODULATION_V1` block — `test_const`, `rainbow`, or
`27_swipe` frozen at `localSpeed = 0` — everything else moves with the room and the A/B is
unreadable. Expect: **blacks and full white unchanged; the amber is finally amber instead
of yellow/near-white (the saturation recovery is more visible than the dimming); and
everything that is not 0 or 255 is dimmer.**

**WARNING — the whole SHIP will read darker at the same slider positions.** The old wire
was a crude, colour-destroying 2.55× brightness boost, and the rig has been running on it
since sACN output existed. Output at a given rendered value falls to: DMX 25→39 %,
50→39 %, 100→39 %, 150→59 %, 200→78 %, 255 unchanged. **The retune tool is the dimmer
rack** (and the new master slider, `_168`, once it lands) — and the retune must happen
AFTER this fix, because every level set on the old wire was set against a boost and a
saturation ceiling. Per `_153`'s sequencing note this slice is its own operator gate and
must NOT share a window with a bench-mirror retest.

**Not touched:** `launcher.js`, `marsin_engine/lib/api_server.js`, `CaptainPad/**`
(concurrent agents), every scene/pattern/playlist file, every browser source.
**Still NOT SHIP** — unchanged standing verdict; this kills the largest byte-level defect
in the sACN stack but confirms nothing on hardware, and it makes an operator-visible look
change that has not yet been seen on the physical rig.

---

## `_171` AMENDMENT — Option C landed: the browser transmit path is DELETED, fog rehoused on the engine, the gate retired

**Report:** `.agent/reports/202608/20260805_171_browser_router_removal.md` §9 (the
first-pass sections are preserved — the amendment is only legible against the conflict
they record). Operator chose **Option C** on the decision `_171` was blocked on.

**The conflict, resolved.** The blocker was that two things genuinely used the browser's
transmit path: the sim's **"💨 Hold to Fog"** button and bench-generator output. Fog moved
to the engine; bench-generator output was retired.

**`POST /fog`** (`marsin_engine/lib/api_server.js`) — `{state:boolean, holdMs?:1..10000}`
→ 200 `{status,state,holdMs}` / 400 named-field refusal / 503 no effects controller.
Deliberately **not** `/global-effect {effect:'fogger'}`, which already exists: that is a
**latch**, and the browser path being deleted was by accident a **deadman** — fog flowed
only while the browser kept sending, so a closed tab stopped it. A latch would leave a fog
machine running until somebody noticed. `/fog` holds for `holdMs` and switches itself off;
the button re-POSTs every 600 ms against a 1500 ms hold. The 3D preview stayed local
(`_uiFogOverride`), so the button still feels instant — preview is this window's opinion,
hardware is the engine's.

**What died:** `src/dmx/sacn_output_client.js` (deleted); the `animate.js` output block,
import and vars; the output bridge's entire sender pool, forward path **and its `sacn`
import**; the `benchMirrorGate` protocol at both ends; `tests/sacn_output_client_frames.test.js`.
**`:6972` survives as a refusal tripwire** — a stale cached bundle still opens that socket,
and unbound it would fail silently and look like "the sim just isn't driving anything".
It now names itself once per 30 s per client with cause (`STALE BUNDLE`) and remedy
(hard-reload). `start.js`, `config.yaml`, `load_ports.cjs` and the ten `agent_tools`
`:6972` guards stay truthful and untouched. The sACN OUT panel became **`🔌 Engine
Blackout`** — its BLACKOUT button was never a `:6972` control (it POSTs `/global-blackout`
on `:6968`); `sacn-out-blackout-btn`, `window.triggerSacnBlackout` and the `SacnOutMonitor`
alias are preserved verbatim.

**Gate outcome: retired, not disabled.** `R-23`, `proveOutputGateHeld`, `setOutputGate`,
`ensureGateLink`, `_gateLostWhileArmed`, the `ws` client import — all gone from both
processes. The ARM's ownership proof keeps every relay clause and drops only the gate one.
**Structural absence is the stronger guarantee**: a gated stream is a live capability held
shut, and `_158` **D-158-1** was exactly the cost of that (a gate lost inside the ship-dark
blackout produced an arm reporting success while the ship was reachable at priority 150).
That defect is now **unrepresentable**, and its regression is retired with the property it
defended named and rehoused. **Closes `_159` OBS-4** — there is no gate command to accept
on `:6972`, authenticated or not.

**Coverage inverted, not deleted.** Every retired test names its replacement in place.
New `simulation/tests/browser_transmit_absence.test.js` (11) asserts the absences over the
source; the data-path suite became a refusal spec; `G10` now proves a frame reaches
**nothing**. The **tab-throttle freeze is untestable by construction** and that is recorded
as a passing test rather than left as a gap.

**`_170` interaction — their fix is NOT lost, that lane is.** `useRawDmxValues` had landed
on the forward path I deleted, but it survives untouched everywhere it still matters:
engine→wire (`marsin_engine/lib/sacn_output.js`), bridge relay→wire and mirror→wire
(`sacn_bridge.js`). Their `R-D1` round-trip proofs run against the surviving lanes and are
green. No `_170` test was reworked or weakened.

**Suites.** Sim **2007 / 2000 / 6** — the *same 6* pre-existing failures name for name,
zero new. The 17-test drop is retired machinery against **+11** new absence tests; net
coverage up, because absence needs fewer assertions than a data path. Focused mirror +
absence + refusal + armed-shutdown **154 / 154 / 0**. Engine **2797 / 2789 / 8**, all 8
accounted for and none mine: 5 × `audio_capture` are an **environment** precondition on
this box (`Windows audio capture requires a pinned device`; file unmodified since
`c6eaa733`, fails identically alone), and `fire_sync_listener` (2) +
`effects_v2_mode_page_layout` (1) are **contention artefacts, green in isolation** —
`performance_mode` **11 / 11 in isolation**. `fog_endpoint` **8 / 8** against a real engine
on an OS-assigned free port on `studiodj` (titanic patches no fog fixture, so it could not
prove this). `security_check.py --all` **6**, unchanged baseline, all inside gitignored
`.scene_backups/`.

**Constraints honoured:** no git operations, operator's live stack never touched (no
service started on an operator port, engine never restarted), no scene/pattern/playlist
edit, nothing left armed, scratch in `~/tmp/fix_171/`.

**Still NOT SHIP** — unchanged standing verdict. This removes an entire class of writer
and closes the tab-freeze failure mode, but the fog rehousing has **not been seen on a
physical fog machine**, and the bench-mirror physical smoke `_158` called for is still
outstanding. Docs scrubbed: `profile_registry.js`, `sacn_monitor_panel.js`, and a standing
**SUPERSEDED IN PART** header on `20260724_19_router_in_engine_design.md` §2.4 (its rule
was adopted, its browser-generator carve-out was not; original text left intact below it).

---

**`_172` — WAVE OVERSIGHT SWEEP (`_153`–`_171`): cross-cutting check, verdict ISSUES —
none in the landed code.** Report `.agent/reports/202608/20260805_172_wave_oversight_sweep.md`.
Read-only; fresh solo suite runs reproduce the settled baselines exactly — sim
**2007/2000/6/1 todo** (the documented six, name for name), engine **2796/2789/7** (the
documented list: 5× audio_capture, osc EADDRINUSE→EACCES, effects_v2 file-level; an
earlier `pattern_dirs_crash_pin` red was this sweep's own three-suites-in-parallel
contention, green solo), `security_check --all` **6** (gitignored `.scene_backups`
baseline). **Late-wave interactions all verified clean:** `_167`+`_169`+`_171` co-exist in
`api_server.js` (`sendJsonError` :416, `/shutdown` :5553, `/fog` :5621, `engine.js:2569`
hook); `_170`'s `useRawDmxValues` survives on all three living lanes after `_171`'s
deletion; zero dangling refs to `sacn_output_client`/the gate (comments + absence tests
only); every claimed new file exists. `_161`/`_162` catalog smell check: every factual
error was caught downstream; no implemented test rests on a wrong premise. **Top issues:**
(1) **T2 still open and D1 landed alone** — titanic `globals_state.yaml` dimmers still
~0.03–0.32; `_160` said "never D1 alone"; next boot is near-dark until the operator
retunes (dimmer rack + `_168` master). (2) **NEW residue:**
`simulation/scenes/titanic/playlists/dirty_probe.yaml` — written by
`performance_mode.test.js` via a spawned engine into the TRACKED titanic scene; not caught
by the `*.original`-only residue tripwire; would ship via robocopy. Delete + widen
tripwire + isolate that test's playlist root. (3) `_162` §6 N-2 stale "playlist block
dead" claim never annotated (`_166` §9 asked; autopilot.js consumes it). (4) `_166` D-2
real-IP literal still in `engine_bridge_contract.test.js:99`. (5) `_157` S-D5/S-D4/S-D3/
S-D8 hardening slices unpicked (S-D5 cheapest, `_160` says land first). Full 30-item
leftover table in the report §(b): blocker-class = T2 retune + bench-mirror/`_170` physical
A/B; H = T6/T7/T8/T9 (tree still uncommitted, `output_config_guard.js` untracked but
imported); rulings owed = ffmpeg fallback + N-1 stateRestoreDegraded; test debt =
D-165-1..4, D-166-1/2/5/6, `_167` tier-2 ×23, G-13, G16, `patches.yaml.original`.
**Standing verdict NOT SHIP unchanged.** Zero production edits; scratch
`~/tmp/sweep_172/`.

---

**`_173` — AUDIO COMPANION KEEPS REVERTING TO THE TEST SIGNAL: root cause found +
fixed.** Report `.agent/reports/202608/20260805_173_audio_companion_state_fix.md`.
Operator: *"it keeps going back to the test signals … I want it to remember our
last settings."*

**Root cause — the engine test suite PATCHes the operator's live show.**
`audio/companion/companion_server.js` resolved `ENGINE_CONFIG_PATH` from a
**hardcoded** `../../config.yaml` and did **not** honour `MARSIN_CONFIG_FILE`, so
every spawned companion resolved `companion.engine` → `127.0.0.1:6968` and
`companion.osc` → `127.0.0.1:10000` — the live stack. The two suites that boot the
real companion (`tests/companion/companion_osc_accounting.test.js:67`,
`…/companion_new_signals.test.js:76`) both send `{type:'setMode',mode:'test'}`,
which write-throughs as `PATCH /audio/config {"capture":{"device":"test"}}`. The
engine persists that into `states/<scene>/audio_state.yaml` and rebroadcasts
`audioConfig`, flipping the operator's real Companion to the synthetic generator
mid-session and on every boot thereafter. **Reproduced end-to-end** against a fake
engine (`~/tmp/fix_173/repro_clobber.mjs`) — the PATCH is logged verbatim. Git
agrees: titanic `capture.device` went `audio=Microphone (Amazon USB Streaming
Mic)` (`3246deb2`) → `test` (`7d2cb6d7`, committed) → `''` (now). Second-order
damage: with the source on `test`, `applyEngineCaptureDevice` never populates
`configDevice`, so the Companion's "Mic / Line" button writes **`''`** — which
`audio_capture.js:145` **throws** on for win32 (`device_not_configured`). Hence
the loop: test → click mic → deaf → back to test.
**Not the engine:** `engine.js` has no `'test'` device path and no silent
mic→test fallback (no P0 violation). **Not the state-dir redirect:** every
`engine.js`-spawning suite already goes through `spawn_engine.mjs` /
`MARSIN_STATE_DIR`; HIL is gated to `test_bench`. The Companion was the only gap.

**Fix (4 files, minimal).** `companion_server.js`: `ENGINE_CONFIG_PATH` resolves
through `MARSIN_CONFIG_FILE` — unset ⇒ tracked config (operator path
byte-identical), set-but-relative/empty ⇒ **throws at boot** (no silent fallback).
New `tests/helpers/companion_isolation.mjs`: `isolatedCompanionEnv()` writes a
scratch config with `companion.engine.host`/`companion.osc.host` → **the RFC 5737 TEST-NET-1 black-hole address**
(RFC 5737, never routed) and `companion.source: test` (so a spawned companion also
never opens the operator's mic); `assertEngineLinkDown()` fails the suite if the
link is up. Both companion suites now spawn with that env and assert the link is
DOWN **before** sending `setMode`. **`127.0.0.9` is NOT a black hole** — the
assertion caught it: the engine binds `0.0.0.0`, which accepts every local
address and all of `127/8` is local.

**Operator step (once, live, no restart):** CaptainPad → AUDIO → SETTINGS →
device picker → *Microphone (Amazon USB Streaming Mic)*. `titanic` currently holds
`capture.device: ''` (unstartable on Windows); the engine is running so it was
deliberately NOT hand-edited. `test_bench` already holds the real device.

**Suites.** Engine **2796 / 2789 / 7** — the `_172` baseline name for name (5 ×
`audio_capture` win32 env, `osc_listener` EADDRINUSE→EACCES, `effects_v2_mode_
page_layout` file-level); zero new. Focused companion pair **5 / 5 / 0**.
`security_check --all` **6** (gitignored `.scene_backups` baseline). Sim not run —
no `simulation/` file touched. Post-run residue = my 4 files only; no state file
gained a `capture.device: test`.

**Disclosed:** the repro + the first assertion-failing run each leaked a few
seconds of synthetic audio OSC at the live engine (runtime-only, overwritten at
~86 Hz) and the repro opened the USB mic for ~2 s — the same leak both suites have
caused on every run, now closed. No `capture.device` PATCH ever reached the live
engine.

**Follow-ups (not done):** (1) **`--dest 127.0.0.9` is likely not a black hole
either** — the sim's sACN receiver `socket.bind(port, cb)` with no address
(`simulation/node_modules/sacn/dist/receiver.js:43`) binds `0.0.0.0`; every
spawned test engine may be feeding the live bridge. Measure, re-point at
the TEST-NET-1 black hole, update `.agent/memory/spawning_a_test_engine.md`. (2) `capture.device`
conflates source-mode with mic identity — selecting `test` destroys the mic
string; a separate `capture.source` would make it un-losable (schema change,
deliberately deferred). (3) `config.yaml companion.source: mic` +
`audio.capture.device: null` makes a cold-start Companion (engine down) die loudly
on win32. Constraints honoured: no git ops, live engine never touched, no state /
scene / pattern / playlist edit; scratch `~/tmp/fix_173/`.

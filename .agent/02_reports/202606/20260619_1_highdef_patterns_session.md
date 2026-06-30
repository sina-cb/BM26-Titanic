# 2026-06-19 — High-Def Patterns + Gallery session (handoff)

**Branch:** `feat/highdef_patterns` (all work here; deployment agent pulls this).
**HEAD at report time:** `59f35f2`.
**Scope:** pattern tuning to consistency ground rules, white audit, gallery
features (port/launcher/nav/model-switching/recording-length/physical-map),
docs/skills, and a cross-model fidelity audit + in-progress fix.

This is a **mid-flight handoff written for a context compaction.** Read the
"IN FLIGHT" and "NEXT STEPS" sections first — there is live agent work running.

---

## 1. What shipped (committed + pushed)

### Gallery tool (`marsin_engine/tools/gallery/`) — standalone, offline, Node built-ins only
- **Port via config:** `gallery_config.json` `{ "port": 6965 }`. Resolution
  `--port` > `GALLERY_PORT` > config > 6965; malformed config = fatal (no silent
  fallback). 6965 is just below the engine/sim block 6967–6972.
- **`gallery_launcher.mjs`** — Tailscale-aware: resolves port, prints
  `http://100.x.y.z:6965/`, spawns `server.mjs`. NOT the prod `launcher.js`.
- **Navigation/explore:** `/` (sort Number/Name/Recent, group by number band,
  model filter chips, search), `/grid` (lazy contact-sheet via
  IntersectionObserver), `/compare?a=&b=`, `/w/<name>` with `‹ ›` prev/next,
  `/api/list` → `[{name,mtime,num,family,model}]`.
- **Model switching:** harness/`make_vis_clip`/`publish` take `--model`;
  per-model widgets named `<pattern>__<model>.html`; gallery groups variants on
  `__` onto one card. Validated on test_bench/titanic/dome/logsville.
- **Recording length:** harness/`capture_vis` `--seconds <S>` (default 10s,
  real-time paced) + `--out-fps` (default 20); `--max-cells` (150k) caps big
  rigs (lowers fps then strides pixels, prints loud `DOWNSAMPLED:`). JSON stamps
  `fps`/`seconds`/`pixelStride`/`coordSpread`.
- **Physical map view:** `make_vis_clip --layout strip|map|auto` (auto=strip for
  test_bench, map otherwise) + `--view top|front|auto`. Map = each pixel a
  glowing dot at its real normalized coord; `auto` picks the two widest
  raw-spread axes (titanic → top-down X/Z ship outline). Strip output for
  test_bench unchanged.

### Patterns — all 00–25 upgraded to the 7 consistency ground rules
Effective `localSpeed`; guarded direction + autonomous incommensurate
auto-switch; high-def (hueSpread≥0.10, peak≥200); non-static at zero audio;
direction never freezes; audio-reactive `radius`/`kick` knobs; identity kept.
Fixed real bugs: coord re-normalization, transform-on-store sliders, a VM
single-letter-reassign miscompile, phase-wrap seams. corr borderlines (00/01/09)
were a wrong-synth artifact (full_track) — validate PRIMARY on bassline/kick_4floor.

### White audit (skill 12 §8.1 documents the convention)
Controllable white via `rgbwau` + `white_*` identity sliders
(`whiteLevel`/`whiteKick` + a third: `whiteWarmth`/`blinderBite`/`whiteSpread`),
modulators-only, additive over cp1/cp2. Kick-gated vintage-head (sectionId==2)
blinders. Applied to 00,01,06,08,09,12,13,19,25 and **backlog 04,05,07,11,17**.
Report: `.agent/02_reports/202606/20260619_0_white_audit.md`.

### Docs / skills
- Skill `12_highdef_pattern_generation.md`: §0 ground rules, §6 auto-switch
  idiom, §8.1 white control, §10/11 recording-length + map-view notes. (Filename
  typo `geneneration`→`generation` fixed.)
- Skill `13_pattern_gallery.md` (new): full gallery how-to (port 6965, loop,
  nav, model-switching, map view).
- `docs/MARSIN_ENGINE_PATTERNS.md` §0: the ground rules contract.

### Key commits (newest first)
`59f35f2` 23 peak+corr · `ee20191` 06 stillpoints/08·21·22 · `7b4a114` white
backlog · `4f6b403` 00/01/09 corr · `9982f2a` recording-length+map ·
`6131f82` white 12/19/25 · `4e05fdc`+`c17f8c5` gallery nav+model-switch merges ·
`6ad9da6`/`896144e`/`acdb201`/`40d4bbd` pattern HD upgrades · `920c935` ground
rules · `7d4deb5`/`e5b920b` gallery port/launcher.

---

## 2. IN FLIGHT (3 background fix agents — DO NOT commit their files mid-edit)

**Cross-model dark/partial bug fix.** Patterns self-filtered their whole output
on test_bench `fixtureId`(1–8)/`sectionId`(1–3) or hardcoded a 52/`pixelCount`
buffer, so they went dark/partial on titanic(970)/dome(266)/logsville(216).
Three agents are making 12 patterns **rig-agnostic** (coord-driven output;
section/fixture only as ADDITIVE accents, never gates; buffers sized to a
runtime-safe max like `var N=1024` guarded by `index<N`), preserving the
test_bench look:
- **04, 27, 40, 46** (self-filter → dark)
- **49, 53, 30, 41** (dark + hardcoded-52/pixelCount buffers)
- **05, 35, 43, 57** (partial id-gates + 57 buffer)

These 12 files show as modified in `git status` — that is the live agent work.
**Commit only after each agent reports done and you re-validate.**

Validation per pattern (the bar): on EACH of test_bench/titanic/dome/logsville,
`LIT` ~full and no crash; then on test_bench with its real `--mod`: COMPILE_OK,
hueSpread≥0.10, peak≥200, PRIMARY corr≥0.5, ANIMATING, silence-safe.

---

## 3. NEXT STEPS (resume here after compaction)

1. As each fix agent finishes: re-run the 4-model LIT check + test_bench gates
   for its patterns, `git add` only those files, commit, push.
   Quick 4-model check:
   ```bash
   cd marsin_engine
   for M in test_bench titanic summer_camp_dome summer_camp_logsville; do
     node tools/pattern_audio_harness.mjs --pattern patterns/NN.js --model $M \
       --synth full_track --frames 8 --out ~/tmp/genkit/out/NN_$M.json 2>&1 | grep -E "LIT=|Error"
   done
   ```
2. Write **`marsin_engine/patterns/catalog.md`** — every top-dir pattern (57
   show patterns) with: one-line identity, cross-model status (now-fixed /
   accent-only / coverage / fully cross-model), and remaining issue (link the
   Notion ticket below for ④/⑤). Write it AFTER the fixes land so "remaining
   issues" is accurate.
3. Push to `feat/highdef_patterns`; tell the operator it's ready to **deploy a
   fresh gallery** (pull branch, `npm install` in marsin_engine, regenerate
   widgets at 10s, `node tools/gallery/gallery_launcher.mjs`, open
   `http://<tailscale-ip>:6965/`, use `/grid`).

---

## 4. Cross-model audit (the bug + the deferred remainder)

Root cause = **pattern issue** (not model, not gallery): models supply valid
coords; gallery renders faithfully; most patterns light 970/970. Categories:
- **① dark (self-filter):** 04,27,40,46,49,53 (LIT 0) + 30 (LIT 2, buffer) — *fixing now.*
- **② hardcoded 52/pixelCount buffer:** 30,41,49,57 — *fixing now.*
- **③ partial id-gate:** 05,35,43 — *fixing now.*
- **④ blinder/fixture ACCENT lost (lights fully):** 00,01,02,06,07,09,12,13,17,19,22,25,28,38,48 — **deferred → Notion.**
- **⑤ partial geometry coverage:** 03,11,20,29,31,34,51,54,58 — **deferred → Notion.**

**Notion ticket (④+⑤, Backlog/Bug/Medium, defer to view/fixture-type system):**
<https://app.notion.com/p/3847fd75b80081268cbfd9081359b2b4>
The seamless-cross-model rule: drive off normalized coords (0..1); treat
section/fixture as optional accents; size buffers by a runtime-safe max (NOT
`52`/`pixelCount` — `pixelCount` compiles to a literal 144 in the VM).

---

## 5. Working knowledge for continuation

- **Offline harness (no engine):** `marsin_engine/tools/pattern_audio_harness.mjs`
  — synth → real DSP → modulation map → MarsinVM → capture JSON. Flags:
  `--pattern --model --synth --frames|--seconds --out-fps --mod sig:slider,… --out`.
  Folds W/amber/UV into displayed RGB (white shows in QUALITY/peak/clip).
- **Synths:** full_track, bassline, kick_4floor, hats, riser, edm_drop, silence,
  … Validate PRIMARY on the synth where micLow varies (bassline/kick_4floor),
  NOT full_track (near-constant low band).
- **Gallery publish:** `node tools/gallery/publish.mjs --name NN [--model M] --capture ~/tmp/genkit/out/NN.json`. Widgets are gitignored scratch.
- **Models** (in `marsin_engine/models/`): test_bench(52), summer_camp_dome(266),
  summer_camp_logsville(216), titanic(970). All expose pixels[] with i/fId/sId/nx/ny/nz.
- **Codex P0:** no silent fallbacks (fail loud), imports at top, snake_case,
  temp in `~/tmp/` only, after engine boot `git restore marsin_engine/states/ simulation/`.
- **Deps:** `npm install` in `marsin_engine/` (needs fft.js etc.).

## 6. Open decision (operator)
**23_prismatic_strange_attractors:** committed the reactive version (corr 0.59,
peak 255) but its uniform level floor killed the sparse black space
(darkFrac 0.50→0.00). Hard either/or (floor 0 → darkFrac 0.50 but corr 0.32,
fails). Operator to choose reactive-glowy (current) vs sparse-black-space.

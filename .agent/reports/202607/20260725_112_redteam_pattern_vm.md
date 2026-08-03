# `_112` — RED TEAM: the pattern VM + the playlist/autopilot content path

**Operator order (2026-07-31):** "adversarial test the system to break it in the
name of bulletproofing and finding quirks."

**Surface:** the MarsinScript WASM VM's hostile-input behaviour, the
compile-time / frame-time / silent split, the 40 fps budget, the playlist
manager + deck autopilot under content abuse, and the `_90` audit harness
itself. Motivation: the operator is now feeding **ChatGPT-authored patterns**
into this engine (`_90`). A hostile-or-buggy pattern must never kill or wedge
the 40 fps show.

**Filename note:** the brief named `_108`; a sibling thread had already taken
`20260725_108_redteam_api.md`, and the coordinator had reserved `_111` for the
red-team synthesis, so this landed at `_112` (the tracker's stated next free).

**FIND AND DOCUMENT ONLY.** Zero source edits, zero suite edits, zero writes
into `marsin_engine/patterns/**`. Every hostile pattern lives in
`~/tmp/redteam_vm/` and is loaded through the existing scratch-path seams
(`tools/pattern_audio_harness.mjs --pattern <abs path>`, and a `WasmHost`
harness that compiles source strings directly). Every live engine ran
black-holed on ports 7950-7999 per `.agent/memory/spawning_a_test_engine.md`,
with `assertBlackHoled()` copied verbatim from
`tests/e2e/timeline_e2e_harness.mjs`. **Zero sACN toward the rig.**

---

## 0. Findings

| # | Sev | Finding | Blast radius |
|---|---|---|---|
| F1 | **P0** | A NaN in **any one** argument to `rgbwau()`/`hsv()` blacks the **entire pixel** (all 6 channels), and NaN is absorbing in persistent state — one bad frame blacks the pattern forever. Nothing at runtime enforces R4 "never fully black". | Exterior dark. Mission-critical. Silent. |
| F2 | **P0** | `beforeRender` is under the same ~5000-instruction budget as `render3D`, and blowing it **truncates the function mid-execution, silently** — no red, no error, no log. The house palette idiom (`_hsv2rgb1/2` inside `beforeRender`) then never runs → **fully black rig** from a pattern that compiles clean. | Exterior dark. Silent. |
| F3 | **P1** | A playlist entry whose pattern **exists but does not compile** permanently wedges the sequential deck autopilot on the entry *before* it. Proven live: 8 ticks, 8 identical warnings, deck never advanced. No client-visible signal. | Show stops cycling all night. |
| F4 | **P1** | **Duplicate entry ids** in a playlist file wedge the deck at `cursor=0` forever with **zero log output**. `save()` rejects duplicates (400); `load()` accepts them silently. | Show stops cycling. Totally silent. |
| F5 | **P1** | A pattern that grows the WASM heap (`array(≥8e6)`) **detaches** `WasmHost.coordView` / `metaView`. `setCoords`, `setPixelMeta` and `applySizeScale` then become **permanent silent no-ops** — model reload, fixture meta and the global SIZE fader are dead until restart. | Wrong geometry, dead SIZE, dead `fixtureType` targeting. Silent, unrecoverable in-process. |
| F6 | **P1** | A corrupt `config.yaml` makes `Autopilot`'s constructor **truncate it from 3866 → 59 bytes**, destroying every top-level key except `playlist`. Three empty `catch` blocks. Irreversible without git. | Total config loss on the show server. |
| F7 | **P1** | The `_90` audit harness **always exits 0** and has no failing bar. A pattern that renders 100 % black passes with exit 0; a pattern that is perfect for the audited window and latches black afterwards clears **all four documented bars**. | The ChatGPT loop's only gate is not a gate. |
| F8 | **P2** | No frame-budget guard. 4 mixer channels of a hostile-but-**legal** pattern = **28.6 ms/frame = 114 % of the 25 ms budget** from pattern render alone. `renderHealth` tracks blend errors only; fps is broadcast but never alerted. | Show drops below 40 fps, nothing says so. |
| F9 | **P2** | Blowing the **per-pixel** budget renders the **whole rig solid red**, silently — no log, no health flag, no client signal. The real budget is ~**300 trivial loop iterations**, not the "5000" a text model reads as generous. | Whole ship red. Silent. |
| F10 | **P2** | The precompile / ping-pong **warm slot reuses a compiled handle by pattern NAME without re-reading the file**, and there is no pattern-file watcher. Rewriting a pattern on disk mid-show (exactly the ChatGPT loop) can keep serving the **old** code. | "I saved it and nothing changed." |
| F11 | **P2** | A playlist that becomes **all-missing under a live assignment** makes the autopilot `return` with **no log at all**. (The *assign* path correctly rejects all-missing with 400 — the hole is the mid-flight rewrite.) | Show stops cycling. Totally silent. |
| F12 | **P2** | `array(n)` has **no size cap**: `array(400000000)` grew the heap to 1.5 GB with no error; `array(40000000)` **silently loses** writes at the top index. | OOM / silent data loss. |
| F13 | **P3** | Number-literal lexer rejects `1e9`, `1e-6`, `1E3`, `1.5e2`, `0x10`, `0b101`, `1_000` — with the misleading error `Undefined var e9`. Not mentioned in the `_90` briefing; a text model writes these constantly. | Loud compile fail (good), confusing message. |
| F14 | **P3** | `pixelCount` is a hardcoded **144** on every model — measured on `test_bench` (166 px), `titanic` (964 px) and `studiodj` (250 px). Documented, but it is a live footgun. | Wrong-sized buffers. |
| F15 | **P3** | String literals **compile** (`var q = "hello";`) despite the spec's "NO strings". Arithmetic on one fails loudly. | Spec drift. |
| F16 | **P3** | 40 sliders compile fine (80 exports). **Nothing** anywhere warns that exports 13-40 get no MFT knob. | Silent operator surprise. |
| F17 | **P3** | A `render3D` that never calls a colour builtin compiles and renders black, with no warning. | Silent black. |
| F18 | **P3** | `getExports()` swallows JSON parse errors and returns `[]` (codex-P0 fallback) — a pattern whose export table fails to parse silently exposes **no controls**. | Silent control loss. |
| F19 | **P3** | `PlaylistManager.load()` regenerates ids for id-less entries from `Date.now()+random(10000)`: **2 collisions at 500 entries, 9 at 5000** — which is F4's wedge. Ids also change on every load, so a persisted `activeEntryId` never resolves. | Feeds F4. |
| F20 | **P3** | `lib/api_server.js` contains three literal **NUL bytes** (offsets 91928 / 92095 / 92405, used as map-key separators), which makes `grep`/ripgrep treat the file as binary and stop searching. | Tooling friction. |

**Counts — P0: 2 · P1: 5 · P2: 5 · P3: 8 (20 total).**

### What held up (worth knowing)

- **Reserved names are airtight.** All 15 (`t i index x y z pixelCount PI PI2
  true false controllerId sectionId fixtureId viewMask`) reject **loudly** on
  both assignment and declaration.
- **Forbidden constructs reject loudly:** `let`, `const`, `try/catch`, `Math.*`,
  `console.*`, `import`, arrow functions, object literals, template strings,
  `null`, `undefined`, zero-arg `random()`, unknown `FIX_*`, unknown
  `inView("…")`, undefined functions/vars, duplicate slider exports.
- **No cross-VM memory corruption.** 20 frames of an out-of-bounds
  array-write attacker (indices ±400 on an `array(4)`) left a co-resident
  victim VM's state **byte-identical**.
- **The instruction limiter is cheap** — an infinite `while(1)` costs
  6.3 ms/frame on 964 px, i.e. it aborts each pixel early rather than hanging.
- **Playlist hot-rewrite recovers cleanly.** Rewriting the active playlist file
  mid-play, dropping every live entry id, re-homed the deck within one tick;
  restoring a healthy file after corruption recovered automatically.
- **Corrupt playlist YAML is loud and safe** — `[Playlist] MALFORMED YAML …`
  on stdout, `400 PLAYLIST_MALFORMED` on the REST read, deck holds its current
  pattern (does **not** go black).
- **All-missing playlist ASSIGN is rejected 400.** One-missing sequential walk
  correctly skips the hole (`e_ok → e_ok2 → e_ok → e_ok2`).
- **1000-entry playlist is a non-event** — 116 ms load, 309 ms assign,
  autopilot advanced normally.
- **Shuffle escapes the F3 wedge** probabilistically (`w_a → w_c → w_a → …`,
  the poison entry never selected).
- **Shipped patterns are comfortably inside budget**: 68 top-level patterns on
  `titanic` (964 px) mean **0.75 ms/frame**, worst `26_dom_dancers_chevron.js`
  at **5.67 ms (23 %)**.
- **No leak under autopilot churn**: 2400 compile→render→destroy cycles left
  the WASM heap at exactly 16.0 MB; 72 000 render frames likewise.

---

## 1. P0 — NaN blacks the whole pixel, forever, silently (F1)

### Repro
```bash
cd ~/tmp/redteam_vm && node battery_f.mjs      # === F4 ===
cd ~/tmp/redteam_vm && node battery_a.mjs nan
```

### Observed vs expected

| Pattern body | Expected | **Observed** |
|---|---|---|
| `rgbwau(1.0, 0.0/0.0, 1.0, 0.5, 0.5, 0.0)` | `[255, 0, 255, 127, 127, 0]` (NaN → that channel 0) | **`[0,0,0,0,0,0]` — the whole pixel** |
| `rgbwau(n,n,n,n,n,n)` with `n = 0/0` | some floor | `sum=0`, `nonzero=0` — black |
| `hsv(n,n,n)` | — | black |
| `sqrt(-1.0)` into red | — | black |
| `wave(1.0/0.0)` into red | — | black |
| `acc = acc + (0.0/0.0)` in `beforeRender`, `rgbwau(acc,0.5,0.5,…)` | one bad frame | **black on every frame from then on** — `0.5` and `0.5` are lost too |

`+Inf` / `-Inf` clamp correctly to 255 / 0 (`1/0`, `pow(10,400)`, `log(0)` all
behave). **NaN is the poison, and it is total.**

### Root-cause / where it should be caught

The clamp lives inside the vendored WASM VM (`marsin_pb/wasm/marsin-engine.wasm`
— no C++ source in this repo), so the per-channel `NaN → 0` is presumably a
`(int)(v * 255)` UB-ish cast. The engine-side gap is the real finding:

- **Nothing in `marsin_engine/` checks for a black frame at runtime.** A
  repo-wide grep for `darkFrac|allBlack|isBlack|neverBlack` returns exactly one
  live hit: `tools/pattern_audio_harness.mjs:313`, an offline *print*.
- `lib/pattern_mixer.js:628 getRenderHealth()` reports **blend errors only**.
- So R4 ("NEVER FULLY BLACK … visibility at night is the mission",
  `_90` §3) is an instruction to ChatGPT with **no enforcement anywhere**.

A text model writes `sqrt(a-b)`, `asin(x/r)`, `log(v)` and `0/0` by accident
routinely. Any one of them, on any one pixel path, on any one frame, drops that
pixel to black permanently.

---

## 2. P0 — `beforeRender` truncates silently at the instruction limit (F2)

### Repro
```bash
cd ~/tmp/redteam_vm && node battery_e.mjs      # === E1, E2, E3 ===
```

### E1 — `render3D` over budget → SOLID RED (loud-ish, at least visible)

```
  iters=  200 first6=[0,127,0,…] ok
  iters=  400 first6=[255,0,0,…] <<< SOLID RED
```
Boundary is between 200 and 400 iterations of `acc = acc + 0.001`.

### E2 — `beforeRender` over budget → **SILENT TRUNCATION**

```
  iters=   300 acc wanted=0.300 got=0.290 ok
  iters=   400 acc wanted=0.400 got=0.290 <<< SILENTLY TRUNCATED
  iters=100000 acc wanted=1.000 got=0.290 <<< SILENTLY TRUNCATED
```

The VM stops executing `beforeRender` at ~290 iterations and **returns
normally**. No red. No error. No log. `render3D` then runs against
half-computed state, every frame, forever.

### E3 — the realistic catastrophe

Every pattern in this show follows the `_90` house idiom: resolve both colour
pickers to RGB **inside `beforeRender`** via `_hsv2rgb1()` / `_hsv2rgb2()`. Put
a plausible "precompute" loop **before** them — exactly the kind of edit a text
model makes when asked to smooth motion — and the palette resolve is never
reached:

```
  frame2 first6=[0,0,0,0,0,0] (want [255,127,63,…]) -> FULLY BLACK, silently
```

**A pattern that compiles clean, renders no red, logs nothing, and blacks the
entire ship.** This is the single worst thing found in this run.

### Root cause / cites

- The budget is enforced inside the WASM VM for **both** entry points, but only
  `render3D` has a visible failure mode (solid red). `beforeRender` has none.
- Engine side: `lib/pattern_channel.js:253 wasmHost.beginFrame(...)` and
  `lib/wasm_host.js:151-155 beginFrame()` have **no return value to inspect** —
  the C ABI `marsin_begin_frame` is bound as `null` return
  (`lib/wasm_host.js:82`), so even if the VM wanted to report the truncation
  there is no channel for it.
- `_90` §2 "RUNTIME LIMITS" tells the author "~5000 instructions per pixel.
  Blowing it renders solid red" — which is **only true of `render3D`**, and
  reads as a far larger budget than ~300 loop iterations.

---

## 3. P1 — a non-compiling entry wedges the deck autopilot (F3)

### Repro
```bash
cd ~/tmp/redteam_vm && node w1_wedge.mjs
```

Poison entry uses a **shipped** file — `patterns/examples/inview_demo.js`,
which fails to compile on `test_bench` (`unknown view(s) via inView(): PORT`).
Zero writes into `patterns/`.

Playlist `rt_wedge`: `e_a`(13_sparkle) → `e_poison`(examples/inview_demo) →
`e_c`(01_cylon_sweep). Deck assigned, landed on `e_a`, sequential autopilot
`delay_s: 2`.

### Observed

```
  entries: [{"id":"e_a","missing":false},{"id":"e_poison","missing":false},…]
  OBSERVED entry sequence over 16s @2s autopilot:
    t=0s entry=e_a
  engine log lines mentioning the failure: 8
    Autopilot playlist swap failed: Compile error: Pattern references unknown view(s)…
  /status keys hinting at a problem: ["deckRestoreDegraded"] -> [null]
  engine alive: true
```

**Expected:** skip the broken entry the way `_missing` entries are skipped, or
advance past it and surface the failure to the operator.
**Observed:** the deck sat on `e_a` for the whole run. `e_c` was never reached.
Eight identical failures on stdout. **Nothing** on `/status`, nothing on the WS
control channel.

### Root cause

1. `lib/api_server.js:1966-1996 loadPlaylistEntry()` compiles **before** it
   writes `channel.playlist.activeEntryId` (`:1995`). A compile failure throws
   at `:1973`, so the cursor never moves.
2. `lib/api_server.js:4098-4107` — the deck daemon's `changePattern` callback
   catches everything and only `console.warn`s.
3. `lib/autopilot_pick.js:103` — sequential picks `findIndex(e => e.id === cur)`
   + 1. `cur` is unchanged, so the picker re-selects the **same** broken entry
   on every beat, forever.
4. `_missing` (`lib/playlist_manager.js:187`) is a *file-existence* flag only —
   a file that exists but does not compile is not `_missing`, so
   `usable`-filtering does not protect against it.

Each failed beat also re-runs `stowSessionParams` +
`captureOrDeferOutgoingDeckEntry` (`api_server.js:2293-2294`) before throwing,
so with auto-save on this is also a repeating disk write every `delay_s`.

**This is precisely the ChatGPT loop's failure mode**: paste a tuned pattern
over a shipped file, one construct is wrong, save, and the show silently stops
cycling for the rest of the night.

---

## 4. P1 — duplicate entry ids wedge the deck with zero output (F4)

### Repro
```bash
cd ~/tmp/redteam_vm && node w3_dupids.mjs
```

Playlist with ids `dup, dup, dup, other`.

### Observed

```
  load id "dup" -> 200 dup/cursor=0
  sequential walk with 3 duplicate ids:
    dup/cursor=0   (x8, over 8 seconds at delay_s=1)
  SAVE round-trip (POST /playlists): {"status":400,"error":"Duplicate entry id: dup"}
```

Entries 2, 3 and 4 (`other` / `09_cyclone`) are **permanently unreachable** —
not by the autopilot and not by an operator tap, because every lookup is
`findIndex(e => e.id === entryId)` and always resolves to index 0. **Not one log
line is emitted** — every load "succeeds".

### Root cause

- `lib/playlist_manager.js:219-226` — the duplicate-id check exists **only in
  `save()`**. `load()` (`:166-189`) has no equivalent, so a hand-written or
  AI-generated file on disk passes straight through.
- `lib/autopilot_pick.js:91,103` and `lib/api_server.js:1966` all resolve by
  first match.

F19 is the ambient version of this: `load()` mints ids for id-less entries from
`e_${Date.now()}_${Math.floor(Math.random()*10000)}`
(`lib/playlist_manager.js:297-299`). Measured (`w4_ids_offline.mjs`):

```
  n=  500 uniqueIds=498 COLLISIONS=2
  n= 5000 uniqueIds=4991 COLLISIONS=9
  same-millisecond worst case, n=500: 17 collisions
```

and because the ids are re-minted on **every** load, a persisted
`activeEntryId` for an id-less playlist can never resolve after a restart.

---

## 5. P1 — heap growth silently detaches the engine's cached WASM views (F5)

### Repro
```bash
cd ~/tmp/redteam_vm && node battery_b.mjs      # [B1]
cd ~/tmp/redteam_vm && node battery_d.mjs      # growth threshold
```

### Observed

```
[B1] initial heap=16.0MB coordView.len=2892 metaView.len=6748
[B1] before-growth probe: px0.r=0 px500.r=132 px963.r=254   (coords reaching the VM)
[B1] AFTER hostile alloc: heap=152.8MB
[B1] coordView detached? true  metaView detached? true
[B1] coordView.length=0        metaView.length=0
[B1] setCoords after growth threw=null
[B1] setPixelMeta after growth threw=null
[B1] after-growth probe: px0.r=0 px500.r=132 px963.r=254   (UNCHANGED — the +0.5 never landed)
[B1] applySizeScale(2.0) threw=null -> px963.r=254 (expect ~127)
```

Threshold (`battery_d.mjs`): `array(4000000)` is fine; **`array(8000000)` grows
the heap and detaches**.

### Root cause

`marsin_pb/wasm/marsin-engine.cjs` is built with memory growth
(`growMemory` / `updateMemoryViews` present, `getHeapMax()=2147483648`), and
`updateMemoryViews()` replaces `Module.HEAP*` with fresh views over the **new**
buffer, detaching every cached view over the old one.

- `lib/wasm_host.js:94` caches `this.coordView` over `Module.HEAPF32.buffer` **once**.
- `lib/wasm_host.js:290` caches `this.metaView` over `Module.HEAP32.buffer` **once**.
- Indexed writes to a **detached** typed array are silently ignored by JS — no
  throw. So `setCoords` (`:202-215`), `setPixelMeta` (`:293-306`) and
  `applySizeScale` (`:232-248`) all become permanent no-ops. `applySizeScale`
  even records `this._lastSizeScale = m` (`:247`), so it believes it worked.
- `setPixelMeta` early-returns on `if (!this.metaPtr)` (`:283`) — the view is
  **never** rebuilt, so a full model reload cannot heal it.

Consequences after one growth event: the global SIZE fader is dead; a model
hot-reload / scene reload silently keeps the previous model's coordinates; and
`fixtureType` / `sectionId` / `viewMask` per-pixel meta silently freezes, so
`FIX_VINTAGE_6` targeting and `inView()` promotions paint the wrong pixels.
Only an engine restart recovers.

`lib/marsin_wasm_runtime.js:74` has the identical cached-`coordView` bug (that
is the runtime the `_90` audit harness uses).

**Reachability:** requires an ~8 M-element `array()`, i.e. an absurd pattern —
but there is no cap (F12) and the failure is permanent and invisible.
Normal operation is nowhere near the cliff (2400 compile/destroy cycles and
72 000 frames both left the heap at exactly 16.0 MB).

---

## 6. P1 — a corrupt `config.yaml` is destroyed by the Autopilot constructor (F6)

### Repro
```bash
cd ~/tmp/redteam_vm && node w5_hot_rewrite.mjs   # section E (scratch copy only)
```

### Observed
```
  config.yaml 3866 bytes -> 59 bytes
  surviving top-level keys: ["playlist"]
```

Controllers, sACN destinations, server port, audio, VSN1, timeline, mixer
limits, palettes — **all gone**, replaced by a 59-byte file containing only
`playlist: {active: false, delay_s: '30', shuffle: false}`.

### Root cause — three stacked codex-P0 fallback violations

```js
// lib/autopilot.js:81-88
loadConfig() {
  try { … return yaml.load(…) || {}; } catch(e) {}   // :86  swallowed
  return {};
}
// lib/autopilot.js:71-78 (constructor)
if (!this.config.playlist) { this.config.playlist = {…}; this.saveConfig(); }
// lib/autopilot.js:90-94
saveConfig() { try { fs.writeFileSync(CONFIG_FILE, yaml.dump(this.config)); } catch(e) {} }  // :93
```

A parse error → `{}` → "no playlist block" → **write `{playlist:…}` over the
whole file**. And `engine.js:134-141` does the same swallow on the boot read
(`console.warn` + `return {}`), so the engine does **not** refuse to start on a
corrupt config — it starts with an empty one (dark rig, no controllers) and
then permanently destroys the file.

Note the asymmetry: with `MARSIN_CONFIG_FILE` set (tests/harnesses) the boot
read **throws** correctly (`engine.js:124-132`). Only the production default
path swallows.

---

## 7. P1 — the `_90` audit harness cannot fail a pattern (F7)

`_90` §"How to use it" tells the operator to verify every ChatGPT edit with two
`pattern_audio_harness.mjs` runs and check four bars: `COMPILE_OK`,
`hueSpread >= 0.10`, `peakMaxChan >= 200`, primary `corr >= 0.5`, plus "silence
must render calm-but-not-black".

### 7.1 A 100 %-black pattern passes the gate

```bash
node tools/pattern_audio_harness.mjs --pattern ~/tmp/redteam_vm/evil_black.js \
     --synth full_track --frames 96
```
```
COMPILE_OK
LIT=0/166 maxChan=0
TOTAL_BRI min/avg/max=0/0/0 (LOW-VARIATION)
QUALITY hueSpread=0.00 darkFrac=1.00 peakMaxChan=0 (DIM: lift peak toward 255)
EXIT_CODE=0
```

The harness **prints** the problem and **exits 0**. It has no failing path for
any quality bar (`process.exit(2)` exists only for bad arguments and compile
errors). Nothing can be automated around it; the gate is a human reading text.

### 7.2 A sleeper passes every bar and is black on the rig

`~/tmp/redteam_vm/evil_sleeper.js` is a plain, unobfuscated, `_90`-conformant
pattern that counts frames and latches fully black after frame 200 (5 s). Run
the **exact `_90` recipe**:

```
--synth full_track --frames 96 --mod micLow:sliderLevel,micKick:sliderKick
  COMPILE_OK
  QUALITY hueSpread=0.30  darkFrac=0.00  peakMaxChan=255
  AUDIO_REACT micLow->sliderLevel: corr=0.61 (REACTIVE)
  AUDIO_REACT micKick->sliderKick: corr=0.77 (REACTIVE)
--synth silence --frames 48
  COMPILE_OK  TOTAL_BRI (ANIMATING)  darkFrac=0.00
```

**Four for four, both runs, clean.** Extend to 400 frames and the truth appears
(`darkFrac=0.50`, `TOTAL_BRI min=0`) — but nothing in the documented workflow
runs 400 frames, and even then the exit code is 0.

The sandbox itself was **not** escaped: the harness compiles through the same
`injectFixtureConstants` pass as the engine, and no pattern reached the host.
The weakness is purely that the harness **observes a bounded window and never
fails**.

---

## 8. P2 — the 40 fps budget (F8, F9)

```bash
cd ~/tmp/redteam_vm && node perf_budget.mjs titanic
```

`titanic`, 964 pixels, budget **25.00 ms/frame**. Pattern render only — no
blend, no global effects, no vis, no sACN.

| Case | ms/frame | % of budget |
|---|---|---|
| 68 shipped top-level patterns, mean | 0.75 | 3 % |
| worst shipped (`26_dom_dancers_chevron.js`) | 5.67 | 23 % |
| `10_chasers.js` / `40_lissajous_weave.js` | 3.63 / 3.35 | 15 % / 13 % |
| worst-case-**legal** hostile (200-iter per-pixel loop) | **7.76** | **31 %** |
| the same, **4 mixer channels** | **28.60** | **114 % — over budget** |
| over-limit (solid-red) pattern | 6.28 | 25 % |

Findings:

- **F8** — a pattern that compiles clean, renders clean, and never trips the
  instruction limiter can eat a third of the frame budget per channel. Four of
  them (a normal mixer load) blow the budget from pattern render alone. There is
  **no per-frame time budget, no slow-frame counter, and no fps alert**:
  `lib/pattern_mixer.js:628 getRenderHealth()` reports blend errors only, and
  `engine.js:972-983` broadcasts `fps` on a `stats` frame with no threshold.
- **F9** — going *over* the limit is cheap (the limiter aborts each pixel early)
  but renders **solid red across the whole rig**, and nothing logs, flags, or
  broadcasts it. The instruction budget bites at ~300 trivial loop iterations,
  which is far tighter than "~5000 instructions" sounds.

---

## 9. P2 — stale warm handles vs. the ChatGPT rewrite loop (F10)

Not reproduced end-to-end — proving it requires overwriting a file in
`marsin_engine/patterns/`, which this thread is forbidden to do. Code path and
live evidence:

- `lib/api_server.js:2527-2569 precompileNextDeckEntry()` compiles the predicted
  next entry and parks the handle in the mixer's inactive deck slot, keyed by
  **pattern name**. Armed after every deck load (`:2270`, `:2479`) whenever
  sequential autopilot is active.
- `lib/api_server.js:2319-2336` — the swap path reuses that handle when
  `inactivePattern === entry.pattern` and the entry has no `defaults`,
  **skipping `loadPattern()` entirely**. The ping-pong keeper does the same for
  the outgoing pattern, so an A↔B cycle can run indefinitely on two handles
  compiled once.
- On reuse the code also **skips re-seeding `export var` defaults**
  (`:2368 if (!isReused)`), so an edited pattern's changed defaults would not
  apply either.
- There is **no watcher on `patternsDir`** — `engine.js:1613` watches
  `modelsDir` only. `loadPattern()` (`:452-458`) re-reads from disk, but only
  when a compile actually happens.

Live evidence that the warm slot is armed constantly (`w6_hot_a.mjs`, 1 s
autopilot, 14 s):

```
[Deck] precompiled next entry '07_shimmer' into warm slot
[Deck] precompiled next entry '13_sparkle' into warm slot
… (one per advance, every advance)
```

**Operator-facing symptom:** save a ChatGPT edit over a pattern that is
currently in the warm slot or in an A↔B ping-pong, and the rig keeps rendering
the old code with no indication why.

---

## 10. P2 — the silent autopilot stop (F11)

```bash
cd ~/tmp/redteam_vm && node w5_hot_rewrite.mjs   # section C
```

Rewriting the **actively-assigned** playlist file so every entry is missing:

```
  C) replace with an ALL-MISSING list mid-play
     after 3.5s: activeEntryId=z1 (unchanged)  alive=true
  log lines "Autopilot playlist swap failed": 0 new
```

`lib/api_server.js:4064-4065` — `if (usable.length === 0) return;` — a bare
return with **no log and no broadcast**. Same at `:2539` (mixer overlay tick)
and `lib/autopilot_pick.js:54`. The show simply stops cycling.

Note the *assign* boundary is correct: `POST /deck/playlist` with an all-missing
playlist returns **400** and leaves the previous assignment in place. The hole is
only the mid-flight rewrite. Restoring a healthy file recovers automatically —
verified (section D, deck resumed within one tick).

---

## 11. P2/P3 — the rest

### F12 — `array(n)` has no cap (`battery_d.mjs`)

```
array(  4000000)  heap 16.0->16.0MB    lastIdxReadback=255 (ok)
array(  8000000)  heap 16.0->30.6MB    coordView DETACHED
array( 40000000)  heap 16.0->152.8MB   lastIdxReadback=0  <<< the write silently vanished
array(400000000)  heap 16.0->1526.0MB  lastIdxReadback=0
```

No compile error, no runtime error, no size guard. `_90` §2 says "allocate ONLY
at top level" but names no ceiling.

### F13 — number-literal lexer (`battery_e.mjs` E4)

```
  1e9      FAIL err="Line 3: Undefined var e9"
  1e-6     FAIL err="Line 3: Undefined var e"
  1E3      FAIL err="Line 3: Undefined var E3"
  1.5e2    FAIL err="Line 3: Undefined var e2"
  0x10     FAIL err="Line 3: Undefined var x10"
  0b101    FAIL err="Line 3: Undefined var b101"
  1_000    FAIL err="Line 3: Undefined var _000"
  .5       OK
  5.       OK
```

Fails loudly (good) but the message points at a phantom variable, and `_90`'s
briefing never says "no scientific notation" — a text model writes `1e-6` in
tolerance checks constantly.

### F14 — `pixelCount` (`battery_f.mjs` F1)

```
  model=test_bench  realPixels= 166   VM pixelCount ≈ 144
  model=titanic     realPixels= 964   VM pixelCount ≈ 144
  model=studiodj    realPixels= 250   VM pixelCount ≈ 144
```

Confirms `_90`'s claim on **every** model including `titanic`. It is a literal,
not a value.

### F15 / F16 / F17 (`battery_e.mjs` E5, `battery_f.mjs` F2/F3, `battery_a.mjs`)

- `var q = "hello";` compiles OK; `q * 0.0` fails loudly
  (`Arithmetic on strings is not supported`). Spec says strings do not exist.
- 40 sliders → 80 exports, compiles clean, **no warning** about the 12-knob MFT
  limit anywhere in the compile or broadcast path.
- `render3D(){ var q = 1; }` (never calls a colour builtin) → compiles OK,
  renders `sum=0` black, no warning. Same for `render3D(){ rgbwau(0,0,0,0,0,0); }`.
- An empty file / comment-only file fails loudly (`Line 1: Unexpected end`).

### F18 — `getExports` fallback

```js
// lib/wasm_host.js:187-194   (and lib/marsin_wasm_runtime.js:198-205)
try { return JSON.parse(this._getExportsJson(handle) || '[]'); } catch (_) { return []; }
```

A codex-P0 silent fallback: an unparseable export table becomes "this pattern
has no controls", which downstream reads as a legitimate answer
(`pattern_channel.js:292`, `playlist_manager.js:392,421`). Low likelihood
(export names are identifiers), but it should throw.

### F20 — NUL bytes in `api_server.js`

Three literal `\x00` bytes at offsets 91928 / 92095 / 92405, used as composite
map-key separators (`` `${plName}\0${entryId}` ``). Valid JS, but `grep` and
ripgrep classify the file as binary and **stop searching after the first
match** — which is why several searches in this thread returned truncated
results. A ` ` escape would read identically to JS and keep the file text.

---

## 12. Engine-death surface (no finding, but worth recording)

- `engine.js:773 tick()` runs the entire render path with **no `try`/`catch`**,
  and `engine.js:1061 setInterval(tick, intervalMs)` gives it no guard either.
- There is **no `process.on('uncaughtException')` / `unhandledRejection`
  handler anywhere in `marsin_engine/`** (only inside one test).
- Therefore any throw in the render path kills the engine process outright.

**No hostile pattern in this run produced such a throw** — the VM absorbs
everything into red/black/truncation, and the detached-view path is silent
rather than throwing. But the guard rail is absent, so a future change that
makes any of these paths throw (e.g. "fix" the detached view by asserting on it)
converts a silent bug into a dead show.

This is the **same missing backstop** as `_108`'s CRITICAL (a malformed WS
frame kills the engine; `_111` family A). The fix for that CRITICAL — a
process-level `uncaughtException` handler plus a supervisor that restarts —
covers this surface too, and is a prerequisite for any of §13's
"assert instead of silently no-op" fixes.

---

## 13. Recommended fixes, ranked

1. **F1/F2/F17 — add a runtime never-black watchdog.** The engine already walks
   every pixel each frame (`engine.js:834-842`). A running "N consecutive frames
   with composite sum == 0 while a channel is enabled and faded up" counter,
   surfaced on `/status.renderHealth` and broadcast, costs almost nothing and
   directly defends the mission-critical goal.
2. **F2 — give `beforeRender` a visible failure mode.** Either make the VM
   report the truncation (the `marsin_begin_frame` ABI returns `void` today —
   `wasm_host.js:82`) or, cheaply, document the *real* budget in `_90` in loop
   iterations rather than instructions, and add a harness check.
3. **F3 — do not let a compile failure freeze the cursor.** On a compile error,
   mark the entry `_broken` in memory (mirroring `_missing`), advance past it,
   and broadcast the failure so CaptainPad can show the ⚠ badge it already has.
4. **F4/F19 — reject duplicate ids in `load()`**, not only `save()`, and make
   `generateEntryId()` collision-free (a monotonic counter, not
   `Date.now()+random`).
5. **F6 — delete the three empty `catch` blocks** (`autopilot.js:86,93`,
   `engine.js:139`). A corrupt config must fail the boot, never be overwritten.
6. **F5 — stop caching `coordView`/`metaView`.** Re-derive them from
   `Module.HEAPF32/HEAP32` on each use (they are cheap), or register an
   `onmemorygrowth` rebuild. Cap `array(n)` (F12) while you are there.
7. **F7 — give the audit harness a `--gate` mode** that exits non-zero on
   `darkFrac > 0.9`, `peakMaxChan < 200`, `hueSpread < 0.10`, and any solid-red
   frame — and run it over a longer window than the audited one.
8. **F8/F9 — a slow-frame counter and a solid-red detector on
   `renderHealth`.** Both are a handful of lines in `tick()`.
9. **F10 — invalidate the warm slot on pattern-file mtime change**, or add a
   `patternsDir` watcher next to the existing model watcher.
10. **F11 — log once when the autopilot finds zero usable entries**, instead of
    the bare `return`.
11. **F13/F14/F15/F16 — fold into `_90`'s briefing**: no scientific notation /
    hex / underscores; `pixelCount` is literally 144 on the ship too; strings
    parse but cannot be used; sliders past the 12th get no knob.

---

## 14. Hygiene

- **No source edits, no suite edits, no writes into
  `marsin_engine/patterns/**`.** Every artefact lives in `~/tmp/redteam_vm/`.
- **Every live engine was black-holed and asserted**: `MARSIN_CONFIG_FILE` with
  `controllers: []` + `sacn.destinations: ['127.0.0.9']`, plus
  `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` / `MARSIN_TIMELINE_DIR` into
  `mkdtemp` dirs, ports 7950-7999, OSC / web client / audio / VSN1 deploy off.
  `assertBlackHoled()` (sACN sender lines name only `127.0.0.9`, no Art-Net
  sender, `/status.outputRouting.controllers == []`) ran on every boot.
- **`marsin_engine/config.yaml` verified byte-identical to HEAD** before and
  after (the corrupt-config test operated on a `mkdtemp` copy only). Also
  verified clean at the end of the run:
  `git diff --stat -- marsin_engine/config.yaml marsin_engine/patterns/
  simulation/scenes/test_bench/playlists/` → **empty**.
- **Engine suite re-run at the end of the thread: `2482 tests · 2474 pass ·
  8 fail`** — exactly the documented baseline (`now.md` "Hot notes",
  2026-07-31): 5 × `audio_capture` (no audio device) + 1 × `osc_listener`
  (EACCES not EADDRINUSE) + 1 × `effects_v2_mode_page_layout` (known full-run
  state pollution) + 1 × `specialty_white_uv` (pre-existing two-scene playlist
  drift). **No new failures — the tree is unchanged.**
- Nothing on `:6967-:6972` / `5568` was started or touched. No git operations.
- The `marsin_engine/states/titanic/*` and other working-tree modifications in
  `git status` are **pre-existing / sibling-thread work** — this thread wrote
  none of them.

### Repro artefacts (`~/tmp/redteam_vm/`)

| File | What it proves |
|---|---|
| `vm_probe.mjs` | shared compile+render probe over `createWasmRuntime` |
| `battery_a.mjs` | instruction ladder, NaN/Inf, arrays, recursion, reserved names, structural cases |
| `battery_b.mjs` | F5 heap-growth detach + cross-VM corruption attempt |
| `battery_c.mjs` | growth cliff, 2400-compile churn, 72 000-frame churn |
| `battery_d.mjs` | `array(n)` write/read-back at scale (F12) |
| `battery_e.mjs` | F2/F9 instruction boundaries, F13 lexer, E5 construct gate |
| `battery_f.mjs` | F14 `pixelCount`, F16 exports, F15 strings, F1 NaN scope |
| `find_compile_fail{,2}.mjs` | locates the shipped non-compiling file used as the F3 poison |
| `rig.mjs` | black-holed engine spawner (ports 7950-7999) |
| `w1_wedge.mjs` | **F3** live wedge |
| `w2_playlists.mjs` | 1000-entry, all-missing vs one-missing, dup ids, shuffle escape |
| `w3_dupids.mjs` | **F4** live wedge |
| `w4_ids_offline.mjs` | **F19** id collisions |
| `w5_hot_rewrite.mjs` | hot rewrite A-D + **F6** config truncation |
| `w6_hot_a.mjs` | tick-by-tick hot-rewrite recovery (the good news) |
| `perf_budget.mjs` | **F8/F9** the 40 fps budget |
| `evil_black.js`, `evil_sleeper.js` | **F7** harness false-good artefacts |

---
description: The end-to-end recipe for building a high-def, sound-reactive MarsinScript show pattern for the Titanic — from idea, to controls, to audio mapping, to colour, to offline verification with the harness + LED widget, to reviewing it on your phone in the gallery. Read this before writing or redoing any pattern in marsin_engine/patterns/.
---

# 🎛️ High-Def Pattern Generation — full pipeline

This is the canonical, step-by-step recipe for producing a **production-grade**
lighting pattern: high-definition, genuinely **sound-reactive**, strict two-colour,
never dead-static, never dead-black. It pairs with:

- `.agent/01_skills/08_visualize_patterns_widget.md` — the LED widget anatomy.
- `docs/MARSIN_ENGINE_PATTERNS.md` — the language/parameter/colour contracts (§2,3,4,7,8,9).
- `docs/MARSIN_PB_LANG_SPEC.md` — MarsinScript reference (§2.4 reserved names, §6 builtins).
- The template pattern `marsin_engine/patterns/27_swipe.js` (copy its shape + `_hsv2rgb` helpers).

Everything below is **offline** — no engine boot, no ports, no mic. You drive a
deterministic synth → the **real** engine DSP → a modulation map → the MarsinVM →
a capture you can assert on and render.

---

## 0. The four production bars (every pattern must clear all four)

A pattern is not done until the offline harness shows:

1. **Audio-reactive (first-class).** The PRIMARY continuous mapping measures
   `corr >= 0.5` (REACTIVE), AND a 2nd signal visibly drives a *different* visual
   dimension. Modulators-only — **never read audio globals natively** (codex P0).
2. **Two colours.** `cp1` and `cp2` are distinct hues and the geometry uses BOTH
   across the rig. Harness `hueSpread >= 0.10`.
3. **Non-repeating math.** Incommensurate / irrational ratios so motion never
   visibly loops. The core equation is documented in the header.
4. **High-def + bright.** Crisp cores, true-black-ish negative space,
   `peakMaxChan >= 200` at a musical peak. **Never fully black in silence** —
   keep a small clock-driven base (mission-critical visibility).

Plus two always-on invariants:
- **`localSpeed` must drive motion** (see §6) — declaring it is not enough.
- **Silence-safe** — renders a calm, non-black, non-crashing base on `--synth silence`.

### Consistency ground rules (apply to EVERY pattern in the set)
These are non-negotiable across the whole `patterns/` library — old and new —
so the show feels coherent. A pattern (or an upgrade of an existing one) is not
done until all hold:

1. **`localSpeed` is the first control and is genuinely effective** — motion
   visibly speeds up / slows down across its range (§6); it is never declared
   but unused.
2. **Direction is not always forward.** Provide a guarded `direction` control
   AND give the pattern *autonomous direction variation* — some patterns
   **occasionally auto-switch direction on their own** (clock-driven, on an
   incommensurate cadence, so the rig doesn't flip in lockstep). Motion should
   feel organic, not one-way-forever.
3. **High-def** — follow the four bars above (crisp cores, true-black-ish
   negative space, `peakMaxChan >= 200`, two colours spanning the rig).
4. **Never static at zero audio.** With no modulation and all controls at
   default the pattern still animates from the clock alone.
5. **The `direction` parameter must never freeze the pattern** at any value —
   guard the slider-centre dead-zone (§6) so it changes heading, never stalls.
6. **Validate in the gallery.** Publish every pattern (skill `13`) and iterate
   on the harness gates until the clip is strong; the operator does the final
   on-phone visual pass.
7. **Expose clearly audio-reactive knobs** — at minimum a movement **radius**
   (how far elements travel / how much they scale) and a brightness **kick**
   (kick-driven brightness pop), plus 1–2 more natural to the pattern, each an
   identity `slider*` designed to be modulated (§3, §5).

When *upgrading* an existing pattern, keep its identity (concept, palette feel,
name) — modernize it to these rules, don't rewrite it into something new.

---

## 1. Idea — start from what we love

The operator's taste: **HD, sound-reactive reinterpretations of the 00–25 core
set**, with the **golden-hour vintage-blinder** technique and the
**bioluminescence** feel. So begin one of two ways:

- **Reinterpret a 00–25 pattern.** Read the source (e.g. `11_bioluminescence`,
  `00_golden_hour_wash`, `21_pelagic_manta_rays`), keep its identity, and make it
  HD + audio-reactive. Most show patterns should be these.
- **A clean concept** (Lissajous, reaction-diffusion, quasicrystal, phyllotaxis…)
  — fine in moderation, but still must clear the four bars.

Write a one-line concept + the core (non-repeating) math you'll use, and which
audio signal drives which visual dimension, BEFORE coding. Put that in the header.

**Signature techniques to reach for**
- **Vintage blinders** (`00_golden_hour_wash`): the vintage heads
  (`sectionId == 2`, fixtureId 5–6, the upper Y heads) act as audience blinders —
  on the kick, drive the **W (white) channel hard** on those fixtures via
  `rgbwau(...)`. Great on heartbeat / elevator / golden-hour patterns.
- **Bioluminescence** (`11`): slow `cp1` ambient swell + sharp pow-shaped `cp2`
  crests + a gentle additive UV glow.

---

## 2. The rig + coordinate model (test_bench, ports to the real rig)

`render3D(index, x, y, z)` receives **normalized coords — x, y, z ∈ [0,1]**
(verified). Do NOT re-normalize (no `(x+1.264)/3.125`, no `y/6.5` — that was a real
regression that rendered `02`/`22` dead-black). Use the coords directly (clamp 0..1)
for spatial gradients.

Fixture identity comes from **`sectionId`** (and `fixtureId`):

| sectionId | fixtures | fixtureId | axis | count |
|---|---|---|---|---|
| 1 | Pars | 1–4 | X | 4 |
| 2 | Vintage (upper heads — blinders) | 5–6 | Y | 12 |
| 3 | Bars | 7–8 | X | 36 |

Branch on `sectionId` for per-fixture behaviour (NOT on raw `y` thresholds).
Cover the whole rig. `var N = 52;` for any feedback/history buffer — **never**
`pixelCount` (it compiles to a literal 144).

---

## 3. Parameters (local controls) — design the knobs

- **First control is always `localSpeed`** (UI order = declaration order):
  ```javascript
  export var localSpeed = 0.5;
  export function sliderLocalSpeed(v) { localSpeed = v; }
  ```
- Then **2–3 audio-intended `slider*` controls**, each a *distinct* visual
  dimension. Use the **identity-slider convention** so defaults apply and the
  offline harness can drive them:
  ```javascript
  export var shimmer = 0.35;                       // var name = control
  export function sliderShimmer(v) { shimmer = v; } // slider = "slider" + Shimmer
  ```
  Store `v` **directly** (don't transform before storing — no `foo = 0.1 + v*0.8`);
  scale inside `render3D`. Declaration order of `slider*` = UI order in CaptainPad.
- **Colour pickers** (always present, strict palette):
  ```javascript
  export var cp1H = 0.52, cp1S = 1.0, cp1V = 1.0;
  export var cp2H = 0.10, cp2S = 1.0, cp2V = 1.0;
  export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
  export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
  ```

Reserved names you must NEVER declare/assign: `i t h f p q r g b x y z index
pixelCount PI PI2 controllerId sectionId fixtureId viewMask true false`. Exception:
`r/g/b` are OK as locals inside `render3D` (the 27_swipe idiom), never inside the
`_hsv2rgb` helpers. Safe locals: `kk`, `hv/iv/fv/pv/qv/tv`, `bri`, `nx`, `ny`.

---

## 4. Signals — what the music gives you

The analyzer exposes five modulation sources (see
`marsin_engine/audio/analyzer/` and the synth bank):

| Signal | Meaning | Good for |
|---|---|---|
| `micLow` | low band / bass energy (continuous) | overall brightness / scale (the usual PRIMARY) |
| `micMid` | mid band (continuous) | geometry reshape, secondary detail |
| `micHigh` | high band / hats (continuous) | sparkle / fine detail / colour shimmer |
| `micKick` | kick transient (0..1 spikes) | discrete events (blinder pop, ring, flash, step) |
| `micFlux` | spectral flux / build (continuous) | risers / build-ups / expansions |

**Test synths** (`marsin_engine/audio/synth/test_synths.js`) exercise these
deterministically: `tone kick_4floor bassline hats chord_stab riser edm_drop
full_track sine_sweep white_noise silence`. Pick the synth that best exercises
your PRIMARY signal:
- highs → `hats`; kick events → `kick_4floor`; bass → `bassline`;
  build/flux → `riser` / `edm_drop`; everything together → `full_track`;
  baseline / silence-safety → `silence`.

---

## 5. Audio mapping (modulators-only) — wire signals to controls

- **NEVER** read `micLow`/etc. directly in the pattern. The engine/harness pushes
  the signal into your `slider*` setter via a modulation map. Document the intent
  in the header:
  ```text
  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderShimmer (shimmer) <- micHigh
      MODULATE sliderRipple  (ripple)  <- micKick
  ```
- **Choose the mapping so the bars pass:**
  - PRIMARY = a *continuous band → overall brightness* coupling, `corr >= 0.5`.
    `micLow → brightness` is the reliable default. Make the whole rig's brightness
    rise/fall with it (a level-driven gain that does NOT wobble with your own
    animation phase — wobble kills the correlation).
  - 2nd dimension = a *different* visual axis: `micHigh → sparkle/detail`,
    `micKick → a discrete event`, `micFlux → a build`. These intentionally have
    low brightness-correlation (they're not the brightness budget) — that's fine,
    the harness only requires they drive a different dimension.
  - Kick-gated patterns (shockwave, strobe, chevron, heartbeat) anchor their
    PRIMARY corr on `kick_4floor` (where `micLow` actually varies); `full_track`'s
    low band is near-constant so corr reads lower there — validate on the right synth.
- **If a slider drives the PRIMARY corr only when other sliders are also
  modulated** (e.g. a kick mod changes the brightness budget), validate with the
  FULL intended `--mod` set, and note in the header that all mappings must be wired.

---

## 6. Speed — `localSpeed` must actually move things (and you get global speed free)

The engine advances the VM clock by `wallDelta * globalSpeedMultiplier()` and hands
the pattern that already-scaled clock (`engine.js` `globalSpeedMultiplier` /
`beginFrame(elapsed)`). So **`t`, `time(scale)`, and `beforeRender`'s `delta` are
all pre-scaled by the global SPEED fader.** Therefore:

- Drive **autonomous, continuous motion** from the clock (`t` / `time()` / `delta`)
  so the pattern animates with **no audio mapped and all controls at default** —
  never dead-static, never audio-only-motion.
- Scale that motion's rate by `localSpeed` (canonical idiom):
  ```javascript
  export function beforeRender(delta) {
    var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // 0.5->1x, 1->4x, 0->0.25x
    phase = (phase + (delta / 65536.0) * localMultiplier) % 1.0;   // delta-driven, OR
    // tPhase = time(BASE_SCALE / localMultiplier);                 // time()-driven
    _hsv2rgb1(); _hsv2rgb2();
  }
  ```
- Keep a non-zero base rate so the pattern still creeps at `localSpeed = 0` if that
  matters; for **direction** controls, never let the effective sign sit at exactly 0
  (slider-center freeze) — guard it:
  ```javascript
  export function sliderDirection(v) {
    var d = (v * 2.0) - 1.0;
    if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
    globalDir = d;
  }
  ```
- **Autonomous direction variation (ground rule #2).** Don't run forever in one
  heading. Layer a slow clock-driven sign over the manual `direction`, and on
  *some* patterns let it **occasionally auto-switch** on an incommensurate
  cadence so the rig never flips in lockstep. The manual control biases it; the
  pattern still varies on its own at default:
  ```javascript
  // autoFlip drifts on an irrational period; sign() flips heading occasionally.
  autoFlip = autoFlip + dt * localMultiplier * 0.013;   // ~slow, prime-ish rate
  if (autoFlip >= 10000.0) autoFlip = autoFlip - 10000.0;
  var autoDir = wave(autoFlip * 1.6180339) < 0.5 ? -1.0 : 1.0; // golden-ratio cadence
  var heading = globalDir * autoDir;                    // manual bias × autonomous flip
  ```
  Vary the rate/cadence per pattern (different irrational multipliers) so they
  feel individual. Never let `heading` resolve to exactly 0 (ground rule #5).

---

## 7. Non-repeating math (and avoiding discontinuities)

- Use incommensurate/irrational ratios so the look never re-locks:
  `√2 ≈ 1.41421`, `√3 ≈ 1.73205`, `φ ≈ 1.61803`, golden-angle `≈ 2.39996`,
  distinct primes. No plain integer periods.
- **Wrap accumulating phases at a LARGE multiple of their period**, never at `1.0`
  (or `2π`) if anything multiplies that phase by a non-integer factor. Wrapping a
  phase to `0..1` and then using `phase * 0.5` somewhere jumps half a cycle at each
  wrap → a visible seam/flash (this was the `34_moire_interference` bug). Pattern:
  ```javascript
  var PHASE_WRAP = 10000.0; // turns; far from any in-frame use
  driftA = driftA + dt * localSpeed * MAX_RATE;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  ```
  Give each consumer its own accumulator rather than scaling a shared wrapped phase.

---

## 8. Colour — strict cp1↔cp2, high contrast, blinders

- Copy `_hsv2rgb1()` / `_hsv2rgb2()` verbatim from `27_swipe.js`; call both in
  `beforeRender`. Blend **in RGB space** (`pr1/pg1/pb1 → pr2/pg2/pb2`), never in
  HSV (HSV interpolation traverses non-palette hues).
- Make `cp1` and `cp2` **distinct hues** and span both across the rig
  (blend by position/value, or assign cp1/cp2 to two physical elements/parities).
  Target `hueSpread >= 0.10`. Analogous palettes (warm golden-hour red→gold, or
  blue→green underwater) sit near 0.10 by nature — that's acceptable for those
  concepts; lean on W/UV for extra contrast there.
- **Vintage blinder**: `if (sectionId == 2) { ...drive W hard on the kick... }`
  via `rgbwau(r,g,b, w, a, u)`. Clamp every channel 0..1.
- Keep a **small additive non-black floor** so silence is calm-but-visible.

### 8.1 White control (the W channel + vintage blinders)
The fixtures have a dedicated **white emitter** (the `w` arg of `rgbwau`). White
is its own design dimension — not just `min(r,g,b)`. Reference patterns:
`00_golden_hour_wash` (kick-driven vintage-blinder W) and `11_bioluminescence`
(gentle white cores under colour). Aim for **~30% of the library to use white**,
with the strongest effect being the **vintage heads as audience blinders**.

- **Emit white explicitly**: `rgbwau(r, g, b, w, a, u)` with `w` computed
  separately from the RGB colour. Plain `rgb()` leaves W=0 (white emitter off);
  if `entry.w` is undefined the mapper backfills `W = min(r,g,b)` — so to *control*
  white you must set `w` yourself. Clamp `w` to 0..1.
- **Vintage blinder is the headline use**: drive `w` hard on `sectionId == 2`
  (the upper vintage heads, fixtureId 5–6), gated by the kick, so the audience
  gets a white punch on the beat. Keep the pars/bars (sections 1/3) coloured and
  let the vintage heads carry the white bite. A small always-on warm-white keep
  on the vintage heads is fine (golden-hour feel); the *pop* is audio-driven.
- **A white pattern still obeys the ground rules**: white is additive on top of
  the strict `cp1`/`cp2` geometry — it must not flatten the two-colour spread
  (don't wash the whole rig white) and must not break silence-safety or the
  no-static rule.

**`white_*` control conventions** (identity sliders, §3; declare what the
pattern needs, modulate the audio-reactive ones, §5):

| Control | Meaning | Typical audio source |
|---|---|---|
| `whiteLevel` | overall white amount / base keep (raise/lower the white) | `micLow` or static |
| `whiteKick` | kick-driven white *pop* (blinder bite on the beat) | `micKick` |
| `whiteWarmth` | tint of the white toward warm (amber `a`) vs cool/UV (`u`) | static or `micMid` |
| `blinderBite` | how hard/snappy the vintage-head blinder hits (attack/decay) | `micKick` / static |
| `whiteSpread` | how far the white reaches across the rig / which sections | `micFlux` or static |

Pick a sensible subset per pattern (most need `whiteLevel` + `whiteKick`; a true
blinder pattern adds `blinderBite`/`whiteWarmth`). Store `v` directly, scale
inside `render3D`. Document the white mapping in the header like any other:
```text
WHITE (modulators-only):
    MODULATE sliderWhiteKick (whiteKick) <- micKick   // vintage-head blinder pop
    MODULATE sliderWhiteLevel(whiteLevel)<- micLow    // overall white keep
```
Validate white the same way as colour: it must read on the gallery clip
(white pixels are visibly whiter than the palette) and, on `--buffer rig`, the
vintage heads' W channel must actually rise on the kick — judge it on the
`rig`/DMX bytes, not just the dark vis UI.

---

## 9. Verify — the offline harness loop (this is the gate)

From `marsin_engine/` (Node deps already installed; if a fresh checkout, `npm i`):

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs \
  --pattern patterns/NN_name.js \
  --synth full_track --frames 96 \
  --mod micLow:sliderLevel,micHigh:sliderDetail,micKick:sliderEvent \
  --out ~/tmp/genkit/out/NN_name.json
```

Read these lines and tune the `.js` until all pass:

- `COMPILE_OK` (else fix the language error printed).
- `QUALITY hueSpread=.. darkFrac=.. brightFrac=.. peakMaxChan=..` →
  need `hueSpread >= 0.10`, `peakMaxChan >= 200`, sensible dark/bright for the concept.
- `AUDIO_REACT <sig>-><slider>: corr=.. (REACTIVE|weak)` → PRIMARY `corr >= 0.5`.
- `TOTAL_BRI .. (ANIMATING|LOW-VARIATION)` — note: spatial motion can be real even
  when *total* brightness is flat; trust the code, but confirm motion exists.

Also run **silence** (calm, non-black, no crash) and the synth that best exercises
each signal:

```bash
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js --synth silence --frames 96
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js --synth kick_4floor --frames 96 --mod micKick:sliderEvent
```

**Discontinuity check** (catch seams/flashes the bars miss): capture 240 silent
frames and compare per-frame mean abs delta — a spike ≫ the median = a seam (fix per §7).

---

## 10. Widget — render the real per-pixel output

```bash
cd marsin_engine
node tools/make_vis_clip.mjs --in ~/tmp/genkit/out/NN_name.json --out ~/tmp/genkit/out/NN_name.html --fps 14
```

This is the LED-strip clip (Pause + Speed), grouped by section, physical order —
the same look as CaptainPad DECK MAIN. See skill `08` for the widget anatomy.
(Inline `show_widget` works in the desktop/terminal client; if it ever doesn't,
use the gallery below.)

**~10 s clips + physical map view.** Record real-time clips with the harness'
`--seconds 10` (default `--out-fps 20` → 200 frames; big rigs auto-downsample
with a printed `DOWNSAMPLED:` line). For the titanic and other rigs, `make_vis_clip`
defaults (`--layout auto`) to a **top-down physical map** — each pixel a glowing
dot at its real coordinate — instead of strips; `--view top|front` sets the
plane. See skill `13` / the gallery README for the flags.

---

## 11. Gallery — review it on your phone (offline, over Tailscale)

The gallery is a **standalone offline tool** (`marsin_engine/tools/gallery/`), NOT
wired to the launcher — start it separately.

**Publish** a pattern (preferred form builds the clip for you; pass `--layout` /
`--view` to control the map projection, e.g. a titanic top-down clip):
```bash
cd marsin_engine
node tools/gallery/publish.mjs --name NN_name --capture ~/tmp/genkit/out/NN_name.json
# -> writes tools/gallery/widgets/NN_name.html, prints /w/NN_name
# titanic top-down physical map (auto-selected for non-test_bench rigs):
node tools/gallery/publish.mjs --name NN_name --model titanic \
  --capture ~/tmp/genkit/out/NN_name__titanic.json   # [--view top|front] [--layout strip|map]
```

**Start** the server (once; it re-reads the widgets dir per request, so re-publish
without restarting):
```bash
cd marsin_engine
node tools/gallery/server.mjs            # port from gallery_config.json (6965), binds 0.0.0.0
```
It prints the candidate URLs; on the **phone** (Tailscale up) open
`http://<your-tailscale-ip>:6965/`, use the search box, tap the pattern name, and
watch the visualization. (`/` = index, `/w/<name>` = the clip, `/api/list` = JSON.)

So the loop is: *"I just made `NN_name`"* → `publish.mjs --name NN_name` →
operator opens the gallery on the phone → selects `NN_name` → sees it live.

See skill `13_pattern_gallery.md` and `marsin_engine/tools/gallery/README.md`
for full details.

---

## 12. Register, test, commit

1. Add the file to `marsin_engine/patterns/manifest.json` (keep numbers distinct).
2. Keep the suite green: `cd marsin_engine && node --test tests/companion_*.test.js`.
3. Spot-check it loads in the real engine, then restore runtime residue:
   ```bash
   cd marsin_engine
   node engine.js --pattern NN_name --model test_bench --dry-run
   git restore marsin_engine/states/ simulation/   # after any engine boot
   ```
4. Commit to the working branch (currently `feat/highdef_patterns`) with the repo
   footers. Don't open a PR unless asked.

---

## 13. Doing it at scale — the sub-agent fleet

For a batch (redo N + create M), fan out **one pattern per sub-agent**, several at a
time (the operator has allowed up to 10 concurrent). Each sub-agent: reads the
template + its source pattern + the docs, writes/edits ONE pattern file, iterates the
§9 harness loop until all four bars pass, builds the clip, and returns the final
QUALITY + AUDIO_REACT lines + the exact `--mod` string. The orchestrator must:

- Keep `manifest.json`, git, and commits **central** (sub-agents never touch them) —
  avoids write races.
- **Independently re-run the harness** on each returned pattern (don't trust
  self-reports) on the synth where its bars are claimed.
- Publish each accepted pattern to the gallery for operator review.

---

## 14. Gotchas (learned the hard way)

- `render3D` coords are **0..1**; re-normalizing renders patterns black/dim.
- `pixelCount` is a literal 144 — size buffers with `var N = 52;`.
- The standalone host applies declared `export var` defaults via the harness; prefer
  identity sliders so the default lands where you expect.
- A wrapped-then-scaled phase causes a periodic seam — wrap at a large multiple (§7).
- The LIVE engine applies a GLOBAL palette that overrides per-pattern cp1/cp2, so
  "use two colours" means the *geometry* must span both ends regardless of the hues.
- After any engine boot: `git restore marsin_engine/states/ simulation/`.
- `localSpeed` present but unused, or motion only from audio, = a bug (dead-static).

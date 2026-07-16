# global_effects — survey + 10 new effect proposals (VJ system)

- **Role:** artist/designer (read-only design task, no code changes)
- **Scope:** survey the existing GLOBAL post-mixer effects, then propose 10 new
  creative effects for the live VJ system, ranked by impact × feasibility for
  the party THIS Saturday.
- **Sources read:** `marsin_engine/lib/global_effects_controller.js`,
  `lib/global_effect_slot_manager.js`, `effects/*` (all 11),
  `docs/28_global_effect_macros.md`, `docs/37_marsin_audio_framework.md`,
  `lib/tempo_arbiter.js`, `engine.js` render loop, `models/*.js`.

---

## 1. Survey — what exists today

### 1.1 Pipeline (engine.js render loop, 40 fps)

```
mixer.renderAll6ch() → unpack into model.pixels (objects, floats 0..1: r/g/b/w/a/u)
  → applyPixels()            legacy rig-globals (vintageWhite / uvBlast / blastWhite)
  → applyMacros()            GEM chain, fixed order:
       1. colorWash          (tint/replace/multiply/max takeover)
       2. feedbackTrails     (decay+inject ring-less trail buffer, colorBleed)
       3. dropHit            (poly A/H/R envelopes, add/max/replace)
       4. strobe             (frame-locked ON/OFF gate, safety-tiered)
  → applyHueShift()          first-class knob; YIQ rotation, RGB ONLY, auto-rotate
  → applyInvert()            first-class toggle; 1-v, RGB ONLY
  → applyGroupFixedColors()  operator group locks repaint over everything
  → IntensityController      master + section dimmers
  → blackout                 hard safety zero
  → sACN encode              native fixture strobe channels forced to 0
```

Key facts confirmed in code:

- **Pixels DO carry positional info.** Every pixel object has world coords
  `x/y/z` AND normalized `nx/ny/nz` in `[0..1]`, plus `group`, `fixtureType`,
  `fId` (fixture ordinal), `localIndex` (within-fixture ordinal). The macro
  apply functions receive the full pixel objects — **spatial global effects
  are possible today with zero plumbing.**
- **W/A/UV convention:** brightness gates (strobe, dropHit, wash, trails)
  touch all 6 channels; *chroma* ops (hueShift, invert) are **RGB-only** —
  W/A/UV byte-for-byte untouched (mission-critical exterior whites must never
  be tinted/flipped). New effects must follow the same split: gates may scale
  all 6, chroma grammar must be RGB-only.
- **Scale:** titanic model = 970 px, studio_top_loft = 252 px, dome = 266 px.
  At 40 fps, 970 px × ~30 flops ≈ 30k flops/frame — a per-pixel effect with a
  dozen mults is < 0.1 ms. Budget is generous; the rule is allocation-free
  hot loops (all existing effects comply) and a zero-cost early-return when
  inactive (codex P0 pattern used by hueShift/invert).
- **Slots (GEM):** `MAX_SLOTS = 16`, 13 default bindings today (strobes,
  drops, washes, trails, invert, legacy vintage/blast/UV/fogger). Behaviors:
  `toggle` (persistent, preset-aware switching), `trigger` (fire-and-forget
  envelope), `hold` (down/up), `burst` (auto-timeout, clamped to
  `MAX_BURST_MS`). Safety tiers gate fast strobes to burst-only server-side.
  Blackout and hue are first-class controls outside the slot grid; invert
  is now slot 9. `panicStop()` kills animation but preserves hue/invert/locks.
- **Dispatch surfaces:** CaptainPad GEM grid + APC scene buttons →
  `POST /global-effect-slots/:id/{activate,deactivate,trigger}`; the
  engine-owned scheduler uses the slot-less `dispatchEffectAction()`. New
  effects that register in `GLOBAL_EFFECT_LIBRARY` with presets get slots,
  scheduler access, and APC binding for free; `triggerGenericMacro()` is the
  explicit plug-in point left for them.
- **Tempo/audio available at the right scope:** the render loop closes over
  `paramCenter` (CPC) and `mixer`. CPC carries the Companion's OSC signals —
  `audioBpm`, `rawLow/rawMid/rawHigh/rawKick/rawFlux`, `dropPulse`,
  `buildScore`, `beat/barPhase/downbeat` (docs/37 §2.2) — and
  `mixer.tempoBpm` is the arbitrated show tempo (docs — tempo_arbiter.js).
  **applyMacros() currently receives only `{pixels, frameIndex, nowMs}`** —
  audio/BPM-reactive effects need one small plumbing addition: pass a
  read-only `signals` bag (tempoBpm + a handful of CPC floats) into
  `applyMacros`. That is a ~5-line engine.js change and is shared by every
  reactive effect below, so I cost it once.
- **Content underneath:** ~60 patterns (washes, chases, shimmer, kick
  shockwave, bass comet, heartbeat, strobing lattices…). Global effects sit
  ON TOP of already-animated content — the winning global effects are the
  ones that *reshape dynamics, time, space, or color grammar* of whatever is
  playing, not ones that draw their own imagery.

### 1.2 Gaps the current library leaves open

| Axis | Covered today | Missing |
|---|---|---|
| Dynamics / punch | strobe, dropHit | anything *rhythmic* (BPM-locked pump), anything *audio-driven* |
| Space | — (nothing uses nx/ny/nz!) | sweeps, wipes, chases across the rig geometry |
| Time | feedbackTrails (smear) | freeze, stutter/echo, slow-motion |
| Color grammar | wash, hue, invert | posterize/crush, palette snap, split-tone |
| Transitions | — | build-up riser, arm-and-release tools |
| Ambient | trails (barely) | slow breathing, drifting glints |

---

## 2. Ten proposed effects

Shared conventions for every proposal below:
- "Gate" = multiplies channels (may touch all 6, like strobe). "Chroma" =
  RGB-only, W/A/UV untouched (like hue/invert). "Overlay" = additive color
  (color6-driven, per-preset choice of W/A/UV content, like dropHit).
- Cost is per-frame on the 970-px titanic model (worst case; studio is 4×
  cheaper). All are allocation-free in the hot loop and zero-cost when off.
- **Chain position** refers to the applyMacros order (wash → trails →
  dropHit → strobe) and the post-macro stages (hue → invert → locks →
  intensity → blackout). Group locks, dimmers, and blackout always win —
  none of these effects change that.

---

### E1. Beat Pump — "the whole rig breathes on the kick grid" ★ BUILD FIRST

1. **Pitch:** BPM-locked sidechain duck: brightness dips and swells back
   every beat, exactly like a sidechained pad. One button turns any pattern
   into a pumping techno pattern.
2. **At fixture scale:** the entire rig (bars, pars, vintage heads, strips)
   inhales/exhales in lockstep. Reads perfectly at coarse resolution because
   it is pure global luminance — the *shape in time* is the content.
3. **VJ use:** the workhorse groove-glue. Toggle it on for any driving
   section; depth knob rides the energy. Distinct from strobe: no dark
   frames, so it's usable for whole songs, not just moments. **BPM-reactive.**
4. **Sketch (gate, all 6 channels):**
   ```
   // once per frame:
   beatPhase = (nowMs / 60000 * tempoBpm * rate) % 1     // rate: 1=every beat, 0.5=half-time, 2=double
   env = pow(beatPhase, curve)                            // curve ~2..4: fast dip, eased recovery
   scale = 1 - depth * (1 - env)                          // depth 0..1
   // per pixel: px.{r,g,b,w,a,u} *= scale                // 6 mults
   ```
   Params: `depth` (knob), `rate` (knob/stepped ×0.5/×1/×2), `curve` (preset),
   `phaseOffsetMs` (preset, to land the dip ON the kick). Prefer locking phase
   to CPC `barPhase`/`beat` when live so the dip aligns to the downbeat;
   fall back to free-running tempo phase.
   Cost: ~6 mults/px ≈ 6k flops — negligible. Needs the `signals` plumbing.
5. **Interactions:** lives at the END of applyMacros, same stage as strobe
   (it IS a soft strobe). Mutually stackable with strobe (multiplies fine)
   but the UI should treat pump+strobe as "strobe wins visually." Trails
   should run BEFORE it so trail history isn't pump-modulated (same reasoning
   as dropHit ordering). No conflict with hue/invert (they're chroma).

---

### E2. Waterline Sweep — "a wall of light rolls across the rig" ★ BUILD FIRST

1. **Pitch:** a soft-edged band of boosted light sweeps across the model
   (bottom→top, left→right, or radial), tempo-synced or free-running. The
   Titanic's own "rising tide" (docs/28 §7 futures list — never built).
2. **At fixture scale:** THE spatial money-shot for bar/tower rigs: each bar
   lights as the wave passes through its `ny`/`nx` position. Because pixels
   carry normalized coords, the wave is geometry-true — it climbs the towers
   and runs down the bars in real space, something no per-fixture effect can do.
3. **VJ use:** fills the "space" axis the library completely lacks. Slow
   (8-bar) rise = build-up riser; fast per-beat sweeps = chase energy;
   inverted (darkness band) = dramatic wipe. Tempo-syncable → **BPM-reactive**;
   at 0.05 Hz free-run it is also a legitimate ambient mode.
4. **Sketch (overlay or gate, choose per preset):**
   ```
   // once per frame:
   head = sweepPhase(nowMs, tempo or speed)               // 0..1, wraps
   // per pixel:
   d = axisSel(px)            // px.ny, px.nx, or dist to center (precomputable? it's a field read)
   t = 1 - clamp(abs(d - head) / width, 0, 1)             // triangular band, width knob
   t = t * t                                              // soften edge
   boost mode:  px.rgbwau += color6 * t * amount          (add, clamped)
   darken mode: px.rgbwau *= 1 - t * amount
   ```
   Params: `axis` (x/y/radial — stepped), `width` (knob), `amount` (knob),
   `color6` (preset), `mode` add/darken (preset), `sync` (per-beat / per-bar /
   free Hz). Cost: ~10 ops/px ≈ 10k flops. Zero plumbing needed for
   free-running; tempo-sync shares the E1 `signals` bag.
5. **Interactions:** place BEFORE feedbackTrails (new step 1.5 in
   applyMacros) so trails capture the sweep — a sweeping band with a ghost
   tail is gorgeous and free. HueShift after it rotates the sweep color
   consistently — fine. Additive presets should keep `u` at 0 by default
   (UV boost is a deliberate choice, not a side effect).

---

### E3. Kick Punch — "the analyzer plays the White Drop for you" ★ BUILD FIRST

1. **Pitch:** auto-fires drop-hit envelopes from the live kick/onset signal —
   the rig physically punches with the track, hands-free.
2. **At fixture scale:** identical read to the existing (excellent) White
   Drop / Iceberg Flash, but arriving ON the music without operator timing.
   Coarse rigs love full-rig flashes; this makes them rhythmic.
3. **VJ use:** the highest-value **audio-reactive** toggle: engage during
   drops/peaks and the rig tracks every kick; the operator's hands stay free
   for washes and sweeps. Threshold knob doubles as sensitivity — at high
   threshold only the big hits land (tasteful), at low it's full assault.
4. **Sketch (controller-level trigger router — near-zero pixel cost):**
   ```
   // once per frame, in the controller (NOT per pixel):
   k = signals.rawKick (or dropPulse event)
   if (k > threshold && nowMs - lastFire > minGapMs):
       triggerDropHit({...preset.params, intensity: map(k)}, nowMs)  // reuse EXISTING poly envelope path
       lastFire = nowMs
   ```
   Params: `threshold` (knob), `minGapMs` (preset, e.g. 120), `intensityFloor/
   Ceil` (preset), plus the full existing dropHit preset (color6/AHR/blend).
   Pixel work is the existing dropHit apply — nothing new. Needs the
   `signals` plumbing; reuses 100% of the envelope machinery, poly-stacking
   already handled.
5. **Interactions:** none new — it IS dropHit, same chain position (after
   trails, before strobe). Guard: while strobeActive, either suppress or let
   stack (they compose safely — dropHit adds, strobe gates after). Panic-stop
   already clears dropHits; the router toggle must also be killed by panic.

---

### E4. Freeze Frame — "time stops"

1. **Pitch:** one button freezes the entire rig's current frame — all motion
   halts mid-flight; release (or auto-timeout) resumes. Docs/28 §7 wished for
   it; nothing was built.
2. **At fixture scale:** motion → sudden stillness is one of the strongest
   percepts at ANY spatial resolution — arguably stronger on a coarse rig
   because motion is the main information channel.
3. **VJ use:** breakdown/beat-drop tool: freeze on the last bar before the
   drop, release ON the drop (pairs devastatingly with E3/White Drop).
   Momentary (`hold`) for stutter-freezes; toggle for full breakdowns.
   Optional slow fade-to-black while held = "time dies" outro.
4. **Sketch (buffer capture/replay):**
   ```
   on enable: copy px.{r,g,b,w,a,u} → freezeBuffer (Float32Array pixelCount*6, lazy like trails)
   per frame while active:
       fade = holdFadeMs ? max(0, 1 - elapsed/holdFadeMs) : 1
       px.rgbwau = freezeBuffer[off..off+5] * fade         // 6 reads + 6 mults
   ```
   Params: `holdFadeMs` (0 = hold forever; knob candidate), `behavior`
   hold/toggle. Cost: ~12 ops/px, one 23 KB buffer. Zero plumbing.
5. **Interactions:** place FIRST in applyMacros (before wash) so wash,
   sweep, strobe, hue still animate ON TOP of the frozen base — the rig is
   frozen but the operator is not disarmed. Trails naturally decay to the
   frozen image (nice). Dimmers/blackout unaffected (they run later).

---

### E5. Beat Echo / Stutter — "the light does the DJ's beat-repeat"

1. **Pitch:** records the last beat of light and loops it — a
   quarter/eighth-note visual stutter, BPM-locked, exactly like an audio
   beat-repeat.
2. **At fixture scale:** rhythmic recurrence of whatever just happened —
   chases snap back and repeat, flashes machine-gun. Reads as *rhythm*, which
   coarse rigs excel at.
3. **VJ use:** fill/transition tool for the last bar of a phrase (like a DJ
   loop-roll), or comedic glitch in a breakdown. **BPM-reactive.** Momentary
   by nature — engage-for-a-bar, release.
4. **Sketch (ring buffer):**
   ```
   always-cheap recording only while armed:
   ring = Float32Array(pixelCount * 6 * N)     // N = frames per beat at current tempo, cap 40 (1s)
   per frame: write current frame into ring[head]; head = (head+1) % N
   while stuttering:
       loopLen = beatFraction * N               // 1/4, 1/8, 1/16 note
       px.rgbwau = ring[(head - loopLen + frameInLoop) mod N]   // pure copy-back, 6 reads/px
   ```
   Params: `beatFraction` (stepped knob 1, 1/2, 1/4, 1/8), `mix` (knob,
   blend live vs looped). Cost: 12 ops/px + memory 970×6×40×4 B ≈ 930 KB —
   fine; allocate lazily on first arm, like the trail buffer. Needs
   `signals` (tempo) plumbing.
5. **Interactions:** capture point = same place as trails (after wash) so
   the loop replays the washed look; run BEFORE dropHit/strobe so live
   punches still cut through the loop. Do not run simultaneously with
   Freeze (UI: same "time" family, mutually exclusive slot semantics like
   singleton strobe).

---

### E6. Palette Crush (Posterize) — "instant harder color grammar"

1. **Pitch:** quantizes the rig's colors to N levels per channel — smooth
   gradients become bold stepped blocks; every soft pattern instantly reads
   "harder," more techno, more graphic.
2. **At fixture scale:** gradients across a bar collapse into 2-4 crisp color
   zones — MORE legible at fixture scale than the smooth original. This is
   the rare effect that makes coarse rigs look *better* than dense ones.
3. **VJ use:** color-grammar toggle for genre shifts: crush ON when the set
   gets harder, OFF for melodic sections. Depth knob (levels 2→8) is a
   surprisingly expressive continuous control. Stacks beautifully with hue
   auto-rotate (rotating stepped hues = classic hard-style look).
4. **Sketch (chroma, RGB-only — W/A/UV untouched, same rule as hue/invert):**
   ```
   inv = 1 / (levels - 1)
   q(v) = round(v * (levels-1)) * inv                     // 2 mults + round per channel
   px.r = mix(px.r, q(px.r), amount); same g, b            // amount = crush blend knob
   ```
   Params: `levels` (stepped knob 2..8), `amount` (knob 0..1). Cost: ~12
   ops/px ≈ 12k flops. Zero plumbing, zero state, zero buffers — the
   cheapest build in this list.
5. **Interactions:** place AFTER applyHueShift and BEFORE applyInvert (a new
   chroma stage): hue rotates first so crushed bands rotate smoothly; invert
   of a crushed image stays crisp. Runs after strobe by definition of the
   stage order — fine (quantizing black frames is a no-op).

---

### E7. Bar Chase Roulette — "the rig plays hot-potato with the light"

1. **Pitch:** tempo-synced chase across the model's named GROUPS (or
   fixtures): one group at full boost while the rest duck, stepping each
   beat/half-beat. Docs/28 §7 `sectionChase`, upgraded with tempo lock.
2. **At fixture scale:** whole bars/towers take turns carrying the energy —
   the classic "who's got the light" club look. Group-granular, so it reads
   at ANY distance; uses the model's own group vocabulary (BarLights,
   VintageLights, ParLights…).
3. **VJ use:** peak-time rhythm effect that adds SPATIAL rhythm without dark
   frames (strobe-adjacent energy, longer wearability). **BPM-reactive.**
   Order presets: L→R sweep, ping-pong, random-no-repeat.
4. **Sketch (gate, all 6):**
   ```
   on enable: build px → groupIndex array ONCE (int per pixel; groups from px.group)
   per frame: step = floor(beatCount / stepBeats) → active = order[step % order.length]
   per pixel: s = (groupIndex[i] == active) ? hotGain : duckGain
              px.rgbwau *= s
   ```
   Params: `stepBeats` (stepped 1/2, 1, 2), `duckGain` (knob 0..0.6),
   `hotGain` (preset ~1.0-1.2 clamped), `order` (preset). Cost: 7 ops/px +
   one int array (4 KB). Needs `signals` (beat) plumbing; group indexing
   uses existing `px.group` strings, precomputed on enable.
5. **Interactions:** gate-family — end of applyMacros next to strobe/pump.
   Composes with pump (pump inside the hot group = extra bounce). Conflicts
   conceptually with groupFixedColors (a locked group repaints AFTER and
   ignores the chase — correct and already handled by stage order; document
   for operators).

---

### E8. Riser — "8 bars of automated tension, armed to the drop"

1. **Pitch:** one press arms an automated build: brightness swells, a slow
   pulse accelerates toward strobe-speed over N bars, then auto-releases
   (optionally firing a White Drop) exactly on the bar line.
2. **At fixture scale:** accelerating full-rig pulse + rising floor — pure
   temporal shaping, perfectly legible on coarse fixtures.
3. **VJ use:** THE build-up tool. Operators currently have to hand-ride
   strobe presets during builds; this automates the cliché correctly and
   lands the release on the downbeat via `barPhase`. **BPM-reactive** (bar
   grid) and optionally audio-armed (`buildScore` as an auto-trigger later).
4. **Sketch (controller state machine + gate):**
   ```
   armed at bar B, length L bars → progress p = barsSince(B)/L (from barPhase/beat)
   pulseHz = lerp(startHz=1, endHz=10, p^2)               // quantized via existing strobe timing math
   floor   = lerp(0.6, 1.0, p)                             // rising base brightness
   gate    = strobeGate(pulseHz) ? 1 : floor               // never fully dark — this is a riser, not a strobe
   px.rgbwau *= gate * masterLift(p)
   on p>=1: auto-release → optional triggerDropHit(white_drop); effect self-disarms
   ```
   Params: `lengthBars` (stepped 4/8/16), `endHz` (preset, safety-capped at
   10 Hz per the strobe tier rules — reuse SAFETY_TIERS), `fireDropOnRelease`
   (toggle). Cost: strobe-equivalent (~6 ops/px). Needs `signals`
   (beat/barPhase) plumbing + a small state machine; the most build-logic of
   the list, and it must respect strobe safety tiers (cap accel below the
   hold-only band, or require the same server-side gating).
5. **Interactions:** occupies the strobe stage and must be exclusive with
   manual strobe (singleton with it — reuse the strobe slot semantics).
   panicStop must disarm it. Release-fired dropHit goes through the normal
   path. Trails before it, as usual.

---

### E9. Ocean Breath — "the rig breathes like a sleeping ship" (AMBIENT)

1. **Pitch:** a very slow (6-16 s) full-rig luminance swell with a subtle
   warmth drift at the trough — the between-sets / sunrise / chill-room mode.
2. **At fixture scale:** global brightness + warmth cycling; the ONE effect
   family that needs no spatial or temporal detail at all, so it reads
   perfectly everywhere, including the mission-critical exterior at 400 m.
3. **VJ use:** the AMBIENT slot this library completely lacks. Toggle on
   during breakdowns, ambient interludes, doors-open and end-of-night; it
   makes any static or slow pattern feel alive without adding motion. Also
   the "we're still on, but resting" look for the playa at 5 am.
4. **Sketch (gate + gentle amber overlay):**
   ```
   phase = 2π * nowMs / periodMs
   b = 1 - depth * (0.5 + 0.5 * cos(phase))               // luminance swell, never below 1-depth
   warm = warmth * (0.5 + 0.5 * cos(phase + π))            // warm at the dim trough
   px.r,g,b,w,u *= b            // gate all but amber
   px.a = min(1, px.a * b + warm * 0.3)                    // amber floor breathes UP as rig dims
   ```
   Params: `periodMs` (knob 4-20 s), `depth` (knob 0..0.6), `warmth` (knob).
   Cost: ~8 ops/px; cos computed once per frame. Zero plumbing. Optional
   later: couple `depth` to CPC `slowZone` for auto-engage.
5. **Interactions:** gate stage (with strobe/pump); pointless while strobe
   or pump is on — UI family note, no hard conflict (multiplication
   composes). The amber-floor trick deliberately touches `a` (it is a
   brightness/warmth gesture, not a chroma rotation) — keep `u` untouched
   in the default preset. Sits before intensity, so dimmers still cap it.

---

### E10. Frost Sparkle — "glints of ice across the whole rig" (AMBIENT ↔ PEAK)

1. **Pitch:** transient single-pixel glints (white/ice-blue) sprinkled over
   whatever is playing — champagne fizz at low density, blizzard at high.
   Docs/28 §7 `sparkleOverlay`, finally built, with a density knob that
   morphs it from ambient texture to peak-time chaos.
2. **At fixture scale:** individual bar-pixels and par cans wink at random —
   at 970 px a 2% density is ~20 simultaneous glints, plenty of life without
   erasing the pattern beneath. On DMX pars a glint = a full-can blink:
   charming, vintage, and unlike anything else in the library.
3. **VJ use:** dual-mode: at `density 0.01, decay 400ms` it is the second
   AMBIENT effect (fairy-dust over slow washes); at `density 0.15, decay
   80ms` it's a drop texture. Optional `audioDensity` coupling (density ×
   rawHigh) makes hi-hats literally sparkle — a cheap third **audio-reactive**
   mode.
4. **Sketch (overlay + per-pixel energy array):**
   ```
   spark = Float32Array(pixelCount)                        // lazy, like trails
   per frame:
       spawnCount = density * pixelCount * dt * rate       // expected value; spawn via loop of RNG picks
       for k in spawnCount: spark[randIdx] = 1
       per pixel: e = spark[i]; if (e > 0.01) {
           px.rgb += color6.rgb * e; px.w += color6.w * e   // additive glint (clamped)
           spark[i] = e * decayPerFrame }
   ```
   Params: `density` (knob — THE knob), `decayMs` (knob), `color6` (presets:
   ice white, UV-tinged, amber ember), `audioDensity` (toggle). Cost: ~8
   ops/px + a handful of RNG calls ≈ cheapest stateful effect here. Plumbing
   only for the optional audio mode.
5. **Interactions:** overlay stage, AFTER trails (glints should NOT smear by
   default — a `beforeTrails` preset flag can opt into comet-glints), before
   strobe. Hue-shift after it will tint glints — acceptable; presets that
   must stay white can put the glint in `w` (untouched by hue) — a neat use
   of the channel convention.

---

## 3. Ranking (impact × feasibility, party THIS Saturday)

Feasibility includes the shared `signals` plumbing (pass `{tempoBpm, beat,
barPhase, rawKick, rawHigh, dropPulse}` into `applyMacros` — one small
engine.js change, do it once, first).

| # | Effect | Impact | Feasibility | Notes |
|---|---|---|---|---|
| 1 | **E1 Beat Pump** ★ | ★★★★★ | ★★★★★ | whole-set groove glue; ~40 lines + plumbing |
| 2 | **E2 Waterline Sweep** ★ | ★★★★★ | ★★★★☆ | first spatial effect ever; coords already on px |
| 3 | **E3 Kick Punch** ★ | ★★★★☆ | ★★★★★ | reuses dropHit wholesale; trigger router only |
| 4 | E4 Freeze Frame | ★★★★☆ | ★★★★★ | trivial buffer copy; killer with drops |
| 5 | E6 Palette Crush | ★★★☆☆ | ★★★★★ | stateless 12 ops/px; instant genre shift |
| 6 | E9 Ocean Breath | ★★★☆☆ | ★★★★★ | fills the empty ambient slot; trivial |
| 7 | E10 Frost Sparkle | ★★★☆☆ | ★★★★☆ | dual ambient/peak; small state array |
| 8 | E7 Bar Chase Roulette | ★★★★☆ | ★★★☆☆ | group indexing + order presets; medium |
| 9 | E5 Beat Echo | ★★★★☆ | ★★★☆☆ | ring buffer + tempo math; test the mod-index care |
| 10 | E8 Riser | ★★★★★ | ★★☆☆☆ | biggest payoff, most state-machine risk + safety-tier work — not a same-week build |

**Build first (top 3): E1 Beat Pump, E2 Waterline Sweep, E3 Kick Punch.**
Together they add the three missing axes with the least new machinery:
BPM dynamics (E1), space (E2), audio reactivity (E3) — and all three are
demoable on `studio_top_loft` (252 px) with the full-stack smoke rig.
If a 4th fits before Saturday, E4 Freeze Frame is an afternoon.

## 4. Build notes (shared, for whoever implements)

- **Register in `GLOBAL_EFFECT_LIBRARY`** with presets + `behaviorTypes`
  so slots/APC/scheduler come free; wire dispatch via the existing
  `triggerGenericMacro` plug-point or dedicated `_dispatch*` helpers.
- **Zero-cost-when-off gate** (hueShift pattern) is mandatory; lazy-allocate
  buffers (trails pattern); allocation-free hot loops.
- **panicStop** must kill E1/E2/E3-router/E5/E7/E8 activity (animation), and
  may leave E6/E9 (static/slow chroma-ish) per the hue/invert precedent —
  decide per-effect and document in the controller header like existing ones.
- **W/A/UV:** gates scale all 6; chroma ops (E6) RGB-only; overlays choose
  W/A/UV per preset deliberately.
- New chain order proposal:
  `freeze → wash → sweep/chase-color → trails → echo → dropHit(+kick router) → pump/chase-gate/riser/strobe/breath → hue → crush → invert → locks → intensity → blackout`.

— artist/designer session, 2026-07-07 (read-only; no code touched)

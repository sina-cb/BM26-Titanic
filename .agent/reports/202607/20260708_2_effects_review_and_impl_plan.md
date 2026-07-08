# global_effects — existing-effect review + implementation plan for E1–E10

- **Role:** artist/technical-design (read-only; no code changed, no git ops).
- **Scope:** (A) honestly review EVERY existing global/post-mixer effect and
  propose concrete improvements; (B) hand-to-a-builder implementation plan for
  all 10 proposed effects (E1–E10), grouped into build waves, with the shared
  `signals`-bag prerequisite specced against the REAL CPC keys.
- **Builds on:** `20260708_1_global_effects_proposals.md` (the survey + E1–E10
  sketches). Do not re-derive its pipeline/coord/GEM facts; this refines them
  against the code and corrects the signal key names.
- **Sources read (this session):** `engine.js` render loop (l.606–843),
  `lib/global_effects_controller.js`, `lib/global_effect_slot_manager.js`,
  `lib/global_effect_library.js`, `effects/{strobe,dropHit,colorWash,feedbackTrails,invert,hue_shift,group_fixed_color}.js`,
  `lib/param_center.js` (`getAll`/`get`), `lib/tempo_arbiter.js`,
  `audio/postproc/audio_signals.js`, and the **live engine** on `:6968`
  (`/globals` param dump — authoritative CPC key list).

---

## TABLE 1 — Existing effects: review + improvements

| Effect | What it does | Cost (970px) | Key weakness | Proposed improvement(s) | Effort |
|---|---|---|---|---|---|
| **colorWash** (`colorWash.js`, toggle, chain #1) | Tint/replace/multiply/max blend of a preset color6 over all 6 ch. | ~8–12 mults/px | `tint` mode formula is a muddy hybrid (`px*ia + (px+c)*0.5*a`) that brightens as it tints — not a clean tint; no BPM/audio hook; touches W/A/U so it can dim exterior whites. | Fix `tint` to a true lerp toward a tint target (or rename current to `glow`); add a `chromaOnly` preset flag (RGB-only, protect W/A/U per hue/invert rule); add optional `pulseDepth`+`pulseSync` so wash amount breathes on `audioBarPhase`. | S |
| **feedbackTrails** (`feedbackTrails.js`, toggle, chain #2) | Decay+inject a `pixelCount*6` Float32 trail buffer, colorBleed, add/replace/max mix back. | ~20 ops/px + 23KB buf | `colorBleed` reads `tr` AFTER it was just written (`tb += tr*bleed` uses the bleed-modified `tr`) → asymmetric, order-dependent bleed; buffer is index-based so any pixel reorder smears wrong; no spatial/temporal length control beyond decay. | Snapshot pre-bleed channel temporaries so bleed is symmetric; expose `decay` as a live knob (currently preset-only); add a `motionGate` preset that scales injection by frame-to-frame delta (trails only where motion is) — cheap, uses existing buffer. | M |
| **dropHit** (`dropHit.js`, trigger, poly, chain #3) | A/H/R envelope flash, add/replace/max of color6; multiple envelopes summed. | ~6 mults/px × N live envelopes | Linear envelope (no curve); no velocity/intensity from audio; poly-stack has no cap so a stuck auto-trigger (E3) could pile envelopes; `replace` mode with N stacked envelopes double-dips. | Add `curve` (pow on attack/release) for a punchier snap; clamp `dropHits.length` (drop oldest); expose `intensity` mapping so E3/Kick-Punch can drive it by `micKick`; keep the existing apply path — it is the reuse target for E3. | S |
| **strobe** (`strobe.js`, toggle singleton, chain #4) | Frame-locked ON/OFF gate, Hz quantized to frame grid, blended fade-out, burst clamp. | ~6 mults/px | Hard 50% default duty only exposed via preset; safety tiers are computed but the dispatcher **no longer enforces** them (all toggle) — a real strobe-safety regression; no phase-lock to the beat grid (free-runs from `startedAtFrame`). | Add `audioBarPhase` phase-lock option so the ON frame lands on the downbeat; re-introduce a server-side cap on sustained ≥10Hz toggles (auto-convert to burst) to restore the safety intent; expose `duty` as a knob. | M |
| **invert** (`invert.js`, toggle slot 9, post-macro) | `1-v` on RGB only; W/A/U untouched; clamps; zero-cost gate. | ~3 ops/px | Solid. Only nit: it is binary — no partial-invert / solarize. | Optional `amount` (lerp `px` ↔ `1-px`) to get solarize/partial-invert as a knob; otherwise leave as-is (it is a clean reference). | XS |
| **group_fixed_color** (`group_fixed_color.js`, post-macro) | Repaints locked groups to `color6*brightness`; wins over macros; loses to dimmers/blackout. | ~6 mults/matched px | Hard replace — no blend, so a lock is always a hard cut; string-keyed `overrides[px.group]` lookup per pixel (map hit each pixel). | Add optional `blend` (lerp instead of replace) for soft locks; precompute a per-pixel "has-lock" flag on set to skip the object lookup in the hot loop. | S |
| **applyPixels legacy** (`vintageWhite`/`blastWhite`/`uvBlast`) | Pre-macro rig-global overrides; per-pixel name/fixtureType string checks + dimmer-bypass flags. | ~O(px) w/ string tests | Per-pixel `px.name.includes('head_')` / `fixtureType===` string comparisons every frame even when off (loop runs, sets 4 bypass flags per px unconditionally); no zero-cost early return. | Add a top-of-`applyPixels` early return when no legacy effect is active; precompute the vintage-head pixel index set once at model load instead of string-matching each frame. | S |
| **fogger/horn/fire DMX** (`applyDmx`) | Writes DMX-only fixtures; blackout forces off. | O(devices) | Fine; not a pixel effect. Blackout handling correct. | None (leave as-is). | — |
| **hue_shift** (`hue_shift.js`) | YIQ RGB-only rotation. **GLOBAL path REMOVED** — now per-channel via `applyHueShift6chU8`. | n/a globally | Global hue is going away by decision; file stays as reference/test ground truth. | No global work. Any hue polish (audio-driven rotate, palette-snap) belongs on the **per-channel** `PatternChannel.hue` path, not here. | — (out of scope) |

**Effort key:** XS < S < M < L. All improvements above are optional polish —
none block E1–E10.

---

## TABLE 2 — All 10 new effects: implementation plan

Chain reference (current `applyMacros` order, then post-macro stages):
`wash(1) → trails(2) → dropHit(3) → strobe(4)` → `invert` → `groupLocks` →
`intensity` → `blackout`. "New step N.5" = inserted between existing steps.

| # | Effect | Chain insertion point | Core transform (1 line) | Params (knob/toggle/armed) | Prereq/shared | Wave | Effort |
|---|---|---|---|---|---|---|---|
| **E1** | Beat Pump | END of `applyMacros` (step 4.5, just before/beside strobe) | `scale = 1 - depth*(1 - pow(beatPhase,curve))`; `px.*6 *= scale` | depth (**knob**), rate ×0.5/1/2 (**stepped knob**), curve (preset), phaseOffsetMs (preset) | **signals bag** (`tempoBpm`,`audioBarPhase`,`audioBeat`) | 1 | S |
| **E2** | Waterline Sweep | step **1.5** (after wash, before trails) so trails capture the band | `t = smooth(1 - |axisSel(px) - head|/width)`; boost `+= c6*t*amt` or darken `*= 1-t*amt` | axis x/y/radial (**stepped**), width (**knob**), amount (**knob**), mode add/darken (preset), sync per-beat/bar/free (preset) | signals bag (tempo-sync only; free-run needs none) | 1 | M |
| **E3** | Kick Punch | controller-level trigger router; reuses dropHit apply at step 3 | `if micKick>thr && gap ok: triggerDropHit(preset, intensity=map(micKick))` | threshold/sensitivity (**knob**), minGapMs (preset), full dropHit preset (preset) | **signals bag** (`micKick` or `audioDropPulse`); reuses 100% of dropHit path | 1 | S |
| **E4** | Freeze Frame | **FIRST** in `applyMacros` (step 0, before wash) so wash/sweep/strobe still animate on the frozen base | on enable: copy `px.*6→freezeBuf`; while active: `px.*6 = freezeBuf * holdFade` | holdFadeMs (**knob**, 0=∞), behavior hold/toggle (**armed/momentary**) | lazy `Float32Array(px*6)`; zero plumbing | 2 | S |
| **E6** | Palette Crush | new chroma stage **after invert, before groupLocks** (RGB-only) | `q(v)=round(v*(L-1))/(L-1)`; `px.rgb = mix(px.rgb, q, amount)` | levels 2..8 (**stepped knob**), amount (**knob**) | none (stateless) | 2 | XS |
| **E9** | Ocean Breath | gate stage, END of `applyMacros` (with pump/strobe) | `b=1-depth*(0.5+0.5cos φ)`; `px.rgbwu*=b`; `px.a=min(1,px.a*b+warm)` | periodMs (**knob**), depth (**knob**), warmth (**knob**) | none (self-clock off `nowMs`) | 2 | S |
| **E10** | Frost Sparkle | overlay, AFTER trails, before dropHit (a `beforeTrails` flag opts into comet-glints) | spawn `density*px*dt` glints into `spark[]`; `px.rgb/w += c6*e`; `e*=decay` | density (**knob**), decayMs (**knob**), color6 (preset), audioDensity (**toggle**) | lazy `Float32Array(px)`; signals only for audio mode (`micHigh`) | 3 | S |
| **E7** | Bar Chase Roulette | gate stage, END of `applyMacros` (with pump/strobe) | `active=order[floor(beat/stepBeats)%len]`; `px.*6 *= (grp==active?hot:duck)` | stepBeats 1/2/1/2 (**stepped**), duckGain (**knob**), hotGain (preset), order (preset) | **signals bag** (`audioBeatInBar`/beat count); per-pixel groupIndex built on enable | 3 | M |
| **E5** | Beat Echo / Stutter | capture same point as trails (after wash); replay BEFORE dropHit/strobe | ring-buffer N frames/beat; `px.*6 = ring[(head-loopLen+f) mod N]` | beatFraction 1/½/¼/⅛ (**stepped knob**), mix (**knob**) | **signals bag** (tempo→N); lazy ring `px*6*N` (~930KB) | 3 | M |
| **E8** | Riser | strobe stage; **mutually exclusive** with manual strobe (singleton) | `p=barsSince/L`; `pulseHz=lerp(1,endHz,p²)`; `gate=strobeGate?1:floor(p)`; auto-release fires dropHit | lengthBars 4/8/16 (**armed**), endHz (preset, safety-capped), fireDropOnRelease (**toggle**) | **signals bag** (`audioBarPhase`,`audioBeat`) + state machine + strobe SAFETY_TIERS | 4 | L |

---

## The `signals` bag — precise spec

**Problem today:** `applyMacros({ pixels, frameIndex, nowMs })` (controller
l.241; call site `engine.js` l.815–821) receives NO tempo/audio. The render
loop *closes over* `paramCenter` and `mixer`, so the bag must be **assembled at
the call site in `engine.js` and passed in** — the controller must not import
paramCenter (keep it a pure consumer).

**Do NOT call `paramCenter.getAll()` per frame** — it deep-copies the *entire*
store (60+ keys, `param_center.js` l.501) every frame. Build a small bag with
per-key `paramCenter.get(k)` reads (each is one map hit + scalar passthrough)
OR read the flat object once and pick fields. At 40fps × ~8 keys this is
negligible and allocation-light if the bag object is reused.

**CORRECTION to report 1's field names** — verified against the LIVE engine
`/globals` dump. The report used placeholder names; the real CPC keys are:

| Report placeholder | REAL CPC key | Range | Notes |
|---|---|---|---|
| `tempoBpm` | `mixer.tempoBpm` (NOT a CPC key) | BPM | arbitrated show tempo; read off `mixer`, not paramCenter |
| `beat` | `audioBeat` | 0/1 | rising-edge beat pulse (30Hz) |
| `barPhase` | `audioBarPhase` | 0..1 | position in bar — use for phase-lock |
| `downbeat` | `audioDownbeat` | 0/1 | bar-start pulse |
| (beat-in-bar) | `audioBeatInBar` | 0..4 | for E7 step counting |
| `rawKick` | `micKick` | 0..1 | kick envelope — E3 trigger source |
| `rawHigh` | `micHigh` | 0..1 | E10 audioDensity source |
| `rawLow/Mid/Flux` | `micLow`/`micMid`/`micFlux` | 0..1 | available if needed |
| `dropPulse` | `audioDropPulse` | 0..1 | exists! use for E3 alt-trigger |
| `buildScore` | `audioBuildScore` | 0..1 | E8 auto-arm candidate |
| (riser) | `audioRiserScore` | 0..1 | E8 auto-arm candidate |

**Recommended bag shape** (read-only, reused object, assembled in `engine.js`
`tick()` right before the `applyMacros` call):

```js
// once, module scope: const _sig = {};   // reused, no per-frame alloc
const all = paramCenter ? paramCenter.getAll() : {};   // OR per-key get() for hot path
_sig.tempoBpm   = mixer.tempoBpm || 120;
_sig.beat       = all.audioBeat      || 0;   // 0/1 pulse
_sig.barPhase   = all.audioBarPhase  || 0;   // 0..1
_sig.downbeat   = all.audioDownbeat  || 0;
_sig.beatInBar  = all.audioBeatInBar || 0;   // 0..4
_sig.kick       = all.micKick        || 0;   // 0..1
_sig.high       = all.micHigh        || 0;
_sig.dropPulse  = all.audioDropPulse || 0;
_sig.buildScore = all.audioBuildScore|| 0;
globalEffectsController.applyMacros({ pixels: model.pixels, frameIndex: frameCount, nowMs: now, signals: _sig });
```

Then `applyMacros({ pixels, frameIndex, nowMs, signals })` — signals is
**optional** (default `{}`) so existing effects and tests are untouched.
**Codex note:** report 1 assumed a `getAll()` deep-copy; if the profiler ever
flags it, switch to `paramCenter.get(k)` per key (throws on unknown key — which
is the desired fail-loud, but means the bag must guard for the audio keys not
being registered when the Companion is off; prefer a `has()`/try wrap or read
`getAll()` which never throws). This is the one open plumbing decision for Sina.

---

## Build waves (ordering)

- **Wave 1 — the party trio + shared plumbing (smallest correct first PR):**
  **signals bag + E1 Beat Pump + E2 Waterline Sweep + E3 Kick Punch.**
  These add the three missing axes (BPM dynamics, space, audio-reactivity) and
  E3 reuses the dropHit apply wholesale. Ship this first; it is demoable on
  `studio_top_loft` (252px) via the full-stack smoke rig.
- **Wave 2 — stateless/tiny-buffer independents (no cross-deps):**
  E4 Freeze Frame (buffer copy, zero plumbing), E6 Palette Crush (stateless,
  cheapest), E9 Ocean Breath (self-clocked). None need the signals bag, so they
  can land in parallel with Wave 1 if a second builder is free.
- **Wave 3 — small-state, signals-dependent:** E10 Frost Sparkle (spark array),
  E7 Bar Chase (groupIndex + beat counting), E5 Beat Echo (ring buffer + tempo
  math — test the mod-index carefully).
- **Wave 4 — the state machine:** E8 Riser (bar-grid state machine + strobe
  safety-tier reuse). Highest payoff, most risk; not a same-week build.

### Smallest-correct-first PR (explicit)

> **PR #1 = `signals` bag plumbing + E1 + E2 + E3.**
> Scope: (1) add optional `signals` param to `applyMacros` + assemble the reused
> bag in `engine.js` `tick()`; (2) register `beatPump`, `waterlineSweep`,
> `kickPunch` in `GLOBAL_EFFECT_LIBRARY` with presets + `behaviorTypes`;
> (3) add controller state + apply/router for each; (4) wire GEM slots (below).
> E3 adds ~0 pixel cost (reuses dropHit). E1 is ~6 mults/px, E2 ~10 ops/px.
> Everything is zero-cost when off and lazy-alloc'd. This one PR proves the bag
> and delivers the three headline party effects.

---

## GEM slot wiring + panicStop policy (per effect)

Register each effect in `GLOBAL_EFFECT_LIBRARY` (`category`, `behaviorTypes`,
`singleton`, `presets`, `apply`) → it inherits slot/APC/scheduler dispatch for
free. Add a dedicated `_dispatch<Effect>` in `global_effect_slot_manager.js`
(the `triggerGenericMacro` fallback currently just throws) and a matching
`case` in `_dispatchResolved` + an active-state branch in `_isSlotActive`.

| # | behaviorTypes | singleton | `_isSlotActive` reads | panicStop kills? |
|---|---|---|---|---|
| E1 Beat Pump | toggle | yes | `c.beatPump.enabled` | **YES** (animation) |
| E2 Waterline | toggle | yes | `c.sweep.enabled` | **YES** |
| E3 Kick Punch | toggle | yes | `c.kickRouter.enabled` | **YES** (also clears pending dropHits already) |
| E4 Freeze | toggle + hold | yes | `c.freeze.active` | **YES** (release the freeze) |
| E5 Beat Echo | toggle + hold | yes (mutex w/ Freeze) | `c.echo.active` | **YES** |
| E6 Palette Crush | toggle | yes | `c.crush.enabled` | **NO** (static chroma, like invert) |
| E7 Bar Chase | toggle | yes | `c.chase.enabled` | **YES** |
| E8 Riser | trigger/armed | yes (mutex w/ strobe) | `c.riser.armed` | **YES** (disarm) |
| E9 Ocean Breath | toggle | yes | `c.breath.enabled` | **NO** (slow ambient, safe; UI-family only) — or YES if Sina wants "one hard kill"; recommend NO, matching invert precedent |
| E10 Frost Sparkle | toggle | yes | `c.sparkle.enabled` | **YES** (animation) |

Precedent: `panicStop()` kills strobe/dropHit/trails/wash/legacy but
**preserves** invert + group locks (static chroma, not flash hazards). Follow
that split: animated/flash effects → killed; static chroma (E6) + slow ambient
(E9) → preserved. Document the choice in the controller header like the existing
invert/groupFixedColors notes.

---

## Interactions & ordering conflicts (incl. Part-A effects)

- **E1 Pump × strobe:** both gate at the END stage; they multiply cleanly but
  UI should treat "strobe wins visually." Trails must run BEFORE both (already
  do) so trail history isn't pump/strobe-modulated.
- **E2 Sweep × trails:** sweep at step 1.5 (before trails) gives free comet
  tails. Sweep `add` presets should keep `u=0` by default (UV boost is a
  deliberate choice). If E2 runs in `darken` mode it can fight colorWash's
  `multiply` — document as an operator combo, not a bug.
- **E3 Kick Punch IS dropHit** — no new chain position; guard the poly-stack cap
  (Part-A dropHit improvement) so a low threshold can't pile envelopes.
- **E4 Freeze at step 0** means wash/sweep/strobe animate on the frozen base —
  intentional (operator not disarmed). Trails decay toward the frozen image.
- **E5 Echo × E4 Freeze:** same "time" family → **mutually exclusive** slot
  semantics (like the strobe singleton). Enforce in dispatch.
- **E6 Crush after invert:** a crushed image inverts crisply; placing crush
  after invert (not before) keeps quantization bands stable. Crush is RGB-only —
  same W/A/U protection as invert/hue.
- **E7 Chase × groupFixedColors:** a locked group repaints AFTER the chase and
  ignores it — correct by stage order, but document for operators (a locked bar
  won't participate in the roulette).
- **E8 Riser × manual strobe:** occupy the same stage → singleton mutex; reuse
  strobe SAFETY_TIERS so the accel can't exceed the safe band. Release-fired
  dropHit goes through the normal path.
- **E9 Breath / E1 Pump:** both are luminance gates → pointless together
  (multiplication composes but reads muddy); UI-family note, no hard conflict.
- **Group locks / dimmers / blackout always win** — none of E1–E10 change that;
  they all sit before `applyGroupFixedColors` / intensity / blackout.

---

## Risks / open questions for Sina

1. **Signals-bag read path:** `getAll()` deep-copies the whole store each frame;
   `get(k)` is cheaper but **throws on unknown key** (fail-loud) — which means
   when the Companion is OFF the audio keys may be unregistered and E1/E3 would
   crash. Confirm: are all `audio*`/`mic*` keys always registered at boot
   (so `get` is safe), or should the bag use `getAll()` + `|| 0` defaults?
   The live `/globals` dump shows them registered now — need confirmation they
   register even with no Companion attached.
2. **`audioDropPulse` exists** (report 1 didn't know) — is it a better E3
   trigger than raw `micKick`? It may already be onset-shaped. Recommend
   exposing both as a preset choice.
3. **Strobe safety regression (Part A):** the dispatcher dropped HOLD_ONLY/
   EXPERT_BURST enforcement; a 20Hz preset is now a plain sustained toggle.
   E8 Riser reuses those tiers — do we re-introduce a server-side sustained-
   ≥10Hz cap first, or accept the current all-toggle behavior?
4. **`tempoBpm` source:** it's on `mixer`, not paramCenter — confirm the bag
   should read `mixer.tempoBpm` (arbitrated) vs `audioBpm` (raw OSC). Recommend
   `mixer.tempoBpm` so pump/sweep track whatever the operator locked.
5. **colorWash `tint` fix (Part A)** is a behavior change to a shipped preset —
   confirm we can adjust the formula, or add a new mode and leave `tint` as-is.

— artist/technical-design session, 2026-07-08 (read-only; no code touched).

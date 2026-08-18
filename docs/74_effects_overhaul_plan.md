# 74 — Effects overhaul: audit, gallery, Live Touch colour effects, 30 new effects, Opus wave plan

**Status:** DESIGN (report `_310`, Fable — operator-requested art direction).
**Nothing in this document is implemented.** Sina reviews and vetoes here
first; only then does an Opus lead run the §9 waves. Zero product code was
changed by the `_310` session — its only tree writes are this document, the
new `docs/pattern_gallery/effects/` gallery, and the `_310` report.

**Operator order (verbatim anchors):** *"Analyze the effects we have and
create a plan to optimize them… add gallery-level descriptions and gallery
GIFs for effects like the patterns and the transitions have… the effects I
want to review, add new ones, and remove shitty ones… review the Live Touch
use of effects and how it uses the 5 colour effects we have; suggest new
ones… to allow nice global effects… propose 30 extra creative effects…
use effects to change colors, add fades, add global booms and swipes, use
best practices of visual effects used in projection mapping and VJ art."*

**How to veto:** every verdict in §4 is per-pair, every new effect in §7 is
numbered E1–E30, every wave in §9 is numbered, and every ruling in §10 is
numbered D1–D…. Strike any line and the plan re-balances; nothing below
depends on an unvetoed sibling unless a dependency is named explicitly.

---

## 1. The system as it is (map, evidence-anchored)

### 1.1 The chain

Effects are POST-MIXER transforms on the 964-pixel 6-channel (RGBWAU)
buffer, 40 fps, applied in `engine.js` in this fixed order
(`engine.js:960-1130`, `global_effects_controller.js applyMacros`):

```
pattern mixer → applyPixels (legacy W/U/RGB slams + release ramps)
             → group fixed colors (pre)
             → applyMacros:
                  preWash      Freeze Frame
                  0.5          Movement Trace   (palette placer, group-ordinal space)
                  1            Color Wash       (multi-instance, per-slot)
                  1.5          Waterline Sweep  (nx/ny/nz band) + postWash
                  2            Feedback Trails  (frame-feedback buffer)
                  postTrails   Frost Sparkle    (W-channel glints)
                  3            Kick router → Drop Hit envelopes (poly, voice-steal)
                  4            Strobe           (frame-locked gate)
                  END          Beat Pump, Ocean Breath
             → applyInvert → postInvert (Palette Crush)
             → group fixed colors (post) → SPATIAL paint (operator gesture)
             → grand master / dimmers / blackout → sACN
```

Load-bearing properties the plan preserves:

- **Every stage self-gates** — an idle chain costs nothing.
- **Safety cutoffs run last** — no effect can defeat blackout/dimmers.
- **Effects never invent colour where the architecture says palette**
  (movementTrace places the operator's colours; invert never touches
  W/A/U — mission-critical exterior whites stay white).
- **Chain anchors are extensible** (`registerChainStage`) — most new
  effects in §7 are pure library+controller additions, no engine.js edits.

### 1.2 The library and the slots

`lib/global_effect_library.js`: **17 effectIds, 51 effectId|presetId
pairs** (live-verified against `GET /global-effect-library`). Slots:
**1–8 belong to the Deck + VSN1**, **9–24 to Live Touch** (provisioned by
its ARM chain; `FX_SLOTS`, `touch_control.html:6410`), 25–32 spare. Each
effect exposes at most one `primaryIntensity` (VSN1 jog / intensity API)
and one `primaryMode` (encoder press / mode-cycle API).

Live right now (read-only snapshot, 2026-08-17): slots 1–8 = strobe×2,
trails×2, dropHit×2, waterlineSweep×2; slots 9–13 hold a stale previous
Live Touch layout (Invert / UV Blast / Fogger / Long Trails / Cosmic
Trails), 14–24 unbound — consistent with `_302` §4's finding (tiles
provision only at ARM).

### 1.3 Surfaces

| Surface | Slots | Mechanism |
|---|---|---|
| CaptainPad Deck / VSN1 | 1–8 | GEM slot UI, jog = primaryIntensity, press = primaryMode |
| Live Touch EFFECTS grid | 9–24 | 16 re-pointable tiles, tap=latch hold=momentary; provisioned at ARM (`_302` §4); PLAY/EDIT grammar designed in docs/70 §10, remainder owned by `_291` |
| Scheduler | slotless | `dispatchEffectAction` by effectId+presetId (zero live tasks on titanic) |
| Special events | — | `setEffect` only, hard-allowlisted to 5 effectIds, never a preset (`show_schema.js:84-86`) |
| Legacy `/global-effect` route | — | vintageWhite / blastWhite / uvBlast / fogger toggles |

(§2 reachability table carries the per-pair evidence.)

### 1.4 The colour architecture the effects must respect

- Palette = `colorPalette1/2` in param-center; Live Touch derives a
  5-colour scheme (`paletteRgb6()`) from the wheel + scheme generator and
  pushes it into movementTrace slots as `paramsOverride.colors` at
  provision time (`touch_control_wire.js:3338-3347`).
- docs/71 (designed, `_297` pending) makes two-tone palette presets a
  first-class store applied through the SAME `colorPalette1/2` write.
- W=A=U=0 is the pattern-side contract on this rig; W/A/U are the
  EFFECTS' channels (vintage heads, amber, UV) and are used deliberately.

---

## 2. Reachability (evidence)

> Filled from the `_310` cross-reference sweep; see report
> `.agent/reports/202608/20260817_310_effects_audit_and_plan.md` for the
> full file:line table. Summary used by the §4 verdicts:

**Every pair is nominally reachable** — CaptainPad's swap sheet
(`effect_picker_logic.ts:136-175`, "NOTHING is filtered") and Live
Touch's EDIT dropdowns (`FX_OPTS` built from the live library,
`touch_control.html:6662-6706`; `FX_SHORT` carries all 51 faces and the
grid THROWS on a missing one) both enumerate the full library. So "dead"
here means **cold**: on no default layout in any scene and no Live Touch
default tile — reachable only by hunting a picker mid-show.

| Surface | Reach | Evidence |
|---|---|---|
| Engine slots (banks v3, 32 slots / 4 pages) | live titanic bank: 13 slots (1–8 deck set; 9–13 a STALE pre-Live-Touch layout, overwritten at next ARM) | `states/titanic/global_effect_slots.yaml`; `global_effect_slot_manager.js:86-108` |
| Live Touch | 16 default tiles (`FX_DEFAULT`: 9 movementTrace + strobe sync_4hz, beatPump soft, breath calm, trails soft+ghost, sweep shadow, freeze hold); all 51 via EDIT dropdown (Performance mode OFF only — client + engine 409 gate) | `touch_control.html:6392-6409`; `api_server.js:8698` |
| CaptainPad GEM | all 32 slots by page; any pair bindable via swap sheet; intensity badge + mode cycle | `GlobalEffectMacros.tsx`, `global_effect_macros_logic.ts:43-44` |
| VSN1 | slots 1–8 only (page 0), names no pairs | `vsn1_layout_deploy.js:510` |
| Scheduler | any pair via `dispatchEffectAction`; **zero live tasks on titanic** | `scheduled_tasks.js:245` |
| Special events | hard-allowlisted to 5 effectIds (`strobe, vintageWhite, blastWhite, uvBlast, invert`), never a presetId | `show_schema.js:84-86` |
| Autopilot | **fires no global effects at all** (verified zero hits) | — |
| Legacy `/global-effect` + podium radio | the 4 legacy toggles | `api_server.js:8450`; `control_podium bridge.py:1115-1128` |

**Cold pairs (15):** colorWash iceberg_cyan / emergency_red /
vintage_amber, beatPump halftime, kickPunch punch + ice_punch, freeze
fade_2s + stutter, crush ×3, breath deep + sunrise, sparkle blizzard +
hihat. **Titanic-cold (7 more):** strobe pulse_2hz + max_20hz, dropHit
white_drop, colorWash ocean_blue + purple, beatPump deep, sparkle fizz.
kickPunch is cold on EVERY surface — the library's most interesting
instrument has never had a button.

Two structural notes the waves inherit: **family caps and singletons are
panel-only** (Live Touch enforces `FX_CAPPED`/singleton eviction;
engine, CaptainPad and VSN1 enforce nothing — two GEM slots of one
singleton just overwrite each other's controller state), and the master
gallery index generator **never scans for sibling galleries** (§9 W2
carries the fix).

---

## 3. The gallery (delivered with this plan)

`docs/pattern_gallery/effects/` — one card per pair: GIF + MP4 over a
fixed approved base pattern (`baby_tease/01_bullseye_tide`, titanic, 40 fps
internal / 20 fps media), 2 s base → 6 s effect ON → OFF → 2 s tail, with
per-pair metrics (RMS delta, changed-pixel fraction, peak-brightness
ratio, release tail, measured ms/frame) and an intra-effect overlap
matrix. Media were rendered fully offline (no port bound) with the same
harness stack as the transitions gallery; W/A/U are composited into the
RGB media with a documented visualization mapping (stated in the gallery
footer). The **combined gallery index was deliberately not touched**
(concurrent writers own it); the effects gallery has its own
`index.html` + `manifest.json`. Regeneration: §9 W2 productizes the
generator into `marsin_engine/tools/effects_gallery/`.

Headline numbers from the delivered gallery (full metrics in
`manifest.json`; contact sheets inspected frame-by-frame):

- **50 of 51 pairs rendered** (fogger is DMX-only, carded as
  not-renderable); 3 pairs are audio-only (`kickPunch` ×2,
  `sparkle|hihat`) and are labeled so — none silently inert.
- **Measured duplicates:** `freeze hold vs stutter` RMS **0.00** (§4.11's
  kill, now a measurement, not an argument). All three movementTrace
  `repeat` vs `reverse` pairs also measure RMS **0.00** across the whole
  6 s ON window — at the default 1 px/beat a ping-pong cannot even REACH
  a turn inside six seconds on this rig's group lengths, so "reverse" is
  indistinguishable from "repeat" for the better part of a minute
  (§4.8's folds, and one more reason direction is a mode, not a tile).
  `beatPump deep vs halftime` RMS 5.98 — inside the near-dupe band.
- **Genuinely distinct siblings, confirmed:** `cosmic_trails` vs
  `ghost_ship` RMS 24.6; the three dropHits 17–29 apart; the five washes
  42–65 apart (their KILLs are supersession, not duplication).
- **Cost, measured:** the most expensive pair (`movementTrace`) costs
  **0.04 ms/frame**; the sum of ALL 50 pairs simultaneously active is
  **1.3 ms** against the 25 ms frame budget — §8's headroom claim is now
  a measurement.
- **Flash-hazard column:** the boom family peaks at ×3.9–×4.4 base
  brightness for well-bounded envelopes (that is their job);
  `sparkle|blizzard` holds ×2.39 over 88 % of pixels CONTINUOUSLY (the
  §4.12 retune evidence); `colorWash` tint-lerps lift dark-scene
  brightness up to ×1.9 — worth knowing, not alarming.
- The gallery index verdict pills mirror §4 one-for-one (29 KEEP /
  15 FOLD / 4 KILL / 3 OPT), driven by a verdicts file so a veto here
  re-renders there without touching media.
- **One decision rides on the media (D18):** the gallery weighs 163 MB
  (138 MB of GIFs; the MP4s that carry the review value are only
  25 MB). Regeneration is one offline command (W2 records it), so
  shrinking or dropping the GIFs is a one-liner if the repo weight
  offends.

---

## 4. Audit — every pair, one verdict

Verdict codes: **KEEP** (ship as is) · **OPT** (keep, change named) ·
**KILL** (remove from library + surfaces, with migration note) ·
**FOLD** (absorb into a sibling via primaryMode/param — the pair's LOOK
survives, its LIBRARY ENTRY dies). Each row is independently vetoable.

Identity = what it does at fifty feet, one sentence. Reach = where an
operator can fire it today (§2). Verdicts marked ◆ changed after gallery
evidence landed.

### 4.1 Legacy rig globals (4 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 1 | `vintageWhite\|default` | Slams every vintage filament head's W channel to full, with the fire-sync release ramp on exit — the ship's 1912 signature flash. | **KEEP** | Unique hardware identity; fire-sync depends on it. |
| 2 | `blastWhite\|default` | Every channel of every pixel to full white — the photo-moment / crowd-hit slam. | **KEEP** | The rig's one honest full-white; release envelope already generalized. |
| 3 | `uvBlast\|default` | U channel to full across the rig — blacklight bath. | **KEEP** | Only UV gesture in the system. |
| 4 | `fogger\|default` | DMX relay to the haze machines; no pixel output. | **KEEP** | Hardware relay, not a pixel effect. Gallery card marked not-renderable. |

### 4.2 Strobe (5 pairs — one instrument wearing five name tags)

The five presets differ ONLY in `hz`, and the frequency already moved to
the `primaryMode` 'Frequency' wheel (library comment, `strobe:132-158`) —
the per-Hz presets were kept verbatim purely for state back-compat. Five
tiles that are one knob is exactly the "seven Movement Trace cells read
identically" problem docs/70 §10.1 already convicted.

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 5 | `strobe\|sync_4hz` | Frame-locked full-rig gate at 4 Hz — the canonical strobe. | **KEEP** | Becomes THE Strobe entry; Frequency wheel walks 2/4/5/10/20 Hz from here. |
| 6 | `strobe\|pulse_2hz` | Same gate at 2 Hz. | **FOLD → sync_4hz** | A mode-wheel position, not a library identity. Persisted refs migrate (W1). |
| 7 | `strobe\|punch_5hz` | Same gate at 5 Hz. | **FOLD → sync_4hz** | Same. |
| 8 | `strobe\|hard_10hz` | Same gate at 10 Hz. | **FOLD → sync_4hz** | Same; WARNING tier travels with the mode value. |
| 9 | `strobe\|max_20hz` | Same gate at 20 Hz (2-frame cycle at 40 fps). | **FOLD → sync_4hz** | Stays reachable as the wheel's expert stop, never a default tile (D16). |

### 4.3 Drop Hit (3 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 10 | `dropHit\|white_drop` | 400 ms additive white+W pop — the hand-drummed boom primitive. | **KEEP** | Distinct envelope + colour from its siblings; the VSN1 drum voice. |
| 11 | `dropHit\|iceberg_flash` | Icy cyan pop with UV, longer 500 ms ring-out. | **KEEP** | Genuinely different colour story and tail. |
| 12 | `dropHit\|vintage_burst` | Amber flash that lights the vintage heads (A=1) and rings 600 ms. | **KEEP** | The warm boom; pairs with vintageWhite identity. |

### 4.4 Color Wash (5 pairs — fixed paint in a palette-driven system)

Five hard-coded colours in a system whose whole colour story (wheel,
schemes, docs/71 two-tone presets) flows through `colorPalette1/2`. The
operator's "use effects to change colors" is better served by washes that
FOLLOW the palette (E1) than by five frozen tints.

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 13 | `colorWash\|ocean_blue` | 70 % lerp toward deep blue. | **KILL** (superseded by E1) | Not a visual dupe (gallery: RMS 51.9 from iceberg_cyan) — killed because BOTH are frozen paint the wheel + E1 produce on demand (F2). |
| 14 | `colorWash\|iceberg_cyan` | 75 % lerp toward pale cyan. | **KILL** (superseded by E1) | Same supersession. Any "cold ocean" look survives as a two-tone preset, not a library pair. |
| 15 | `colorWash\|emergency_red` | 90 % REPLACE toward red — alarm takeover. | **KEEP** | The one wash whose identity is fixed by meaning, not taste; used as a show cue. |
| 16 | `colorWash\|vintage_amber` | 65 % tint toward amber with W+A lift — the 1912 grade. | **OPT** | Keep the look, retune as a true luma-preserving grade (see E4); today it visibly brightens the scene. |
| 17 | `colorWash\|purple` | 75 % tint toward violet. | **KILL** (superseded by E1) | "A colour I like" is what the wheel + E1 are for. |

### 4.5 Invert + Palette Crush (4 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 18 | `invert\|default` | 1−v on RGB of the whole frame; W/A/U protected. | **KEEP** | Cheap, striking, safety-clean chroma op. |
| 19 | `crush\|hard_2` | RGB posterize to 2 levels — woodcut poster look. | **KEEP** | Becomes THE Palette Crush entry. |
| 20 | `crush\|bold_4` | Posterize to 4 levels. | **FOLD → hard_2** | `levels` becomes the mode wheel (2/4/6); `amount` is already the jog. |
| 21 | `crush\|soft_6` | Posterize to 6 levels at 60 %. | **FOLD → hard_2** | Same. |

### 4.6 Feedback Trails (4 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 22 | `feedbackTrails\|soft_afterimage` | Short additive comet tails (decay .88). | **KEEP** | The everyday trails. |
| 23 | `feedbackTrails\|long_afterimage` | Same additive tails, longer (decay .96). | **FOLD → soft_afterimage** | Identical mechanism and blend; length becomes the mode wheel (short/long). |
| 24 | `feedbackTrails\|ghost_ship` | REPLACE-blend memory with heavy colour bleed — the ship dissolves into its own after-image. | **KEEP** | Distinct blend mode, distinct look, name earns itself. |
| 25 | `feedbackTrails\|cosmic_trails` | MAX-blend trails with bleed — light accumulates without darkening. | **KEEP ◆confirmed** | Overlap matrix separates it from ghost_ship (RMS 24.6 — well clear of the near-dupe band). |

### 4.7 Beat Pump + Ocean Breath (6 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 26 | `beatPump\|soft` | Whole-rig luminance duck on the beat, 35 %. | **KEEP** | Becomes THE Beat Pump; depth is ALREADY the jog (`primaryIntensity`), so… |
| 27 | `beatPump\|deep` | Same duck at 60 %. | **FOLD → soft** | …a preset that only moves the jog's default is not a second effect. |
| 28 | `beatPump\|halftime` | Same duck at half tempo. | **FOLD → soft** | `rate` (0.5/1/2) becomes the mode wheel. |
| 29 | `breath\|calm` | 8 s whole-rig swell, ±35 %. | **KEEP** | The ambient idle-breathing gesture; tempo-locks to 4 bars. |
| 30 | `breath\|deep` | 14 s swell, ±50 %. | **FOLD → calm** | Depth is the jog; period folds into mode (8 s/14 s/free). |
| 31 | `breath\|sunrise` | 20 s swell that warms (W/A lift) as it rises. | **KEEP** | The warmth curve is a real second identity, not a knob position. |

### 4.8 Movement Trace (9 pairs — the colour-effect family, see §6)

These are the operator's colour effects: they place the wheel's palette
along every group and travel it. Nine tiles today; §6 argues five
identities + two mode wheels.

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 32 | `movementTrace\|pulse_slow_fade` | Whole-palette burst, then a 5 s fall to almost-out — the ship breathes its colours. | **KEEP** | Unique envelope; the operator singled it out for tile 1. |
| 33 | `movementTrace\|every_other_repeat` | Two palette colours alternate pixel-by-pixel and walk forward, both stepping through the palette. | **KEEP** | "2 COLOUR walk" — core identity. |
| 34 | `movementTrace\|every_other_reverse` | Same, ping-pong travel. | **FOLD → 33** | Direction is a mode (and MFT law already says direction is the 2nd param, not a separate button). |
| 35 | `movementTrace\|every_other_two_tone` | Two colours, no dark gaps — the docs/71 two-tone look in motion. | **KEEP** | The no-gap variant reads differently at 50 ft (denser, calmer); earns its tile. Rename "TWO TONE". |
| 36 | `movementTrace\|one_per_color_repeat` | All five palette colours laid as a ladder along every group, crawling. | **KEEP** | "5 COLOUR walk" — the flagship. |
| 37 | `movementTrace\|one_per_color_reverse` | Same ladder, ping-pong. | **FOLD → 36** | Direction mode. |
| 38 | `movementTrace\|one_per_color_double` | Same ladder at 2 px/beat. | **FOLD → 36** | Speed is a mode stop (×1/×2), not an identity. |
| 39 | `movementTrace\|whole_group_repeat` | Each group holds ONE colour; colours march group-by-group across the ship. | **KEEP** | The boldest, most architectural of the family; only mode that reads on 1–2-pixel groups. |
| 40 | `movementTrace\|whole_group_reverse` | Same, ping-pong. | **FOLD → 39** | Direction mode. |

### 4.9 Waterline Sweep (3 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 41 | `waterlineSweep\|rising_tide` | Soft blue band climbing the hull, 4 s per pass. | **KEEP** | The ship's identity move — the tide. |
| 42 | `waterlineSweep\|beat_wipe` | The same soft band, marginally narrower, synced per-beat. | **FOLD → rising_tide** | Differs by width .05 and the sync flag — sync is already the tempo-bind story, and its own `speedHz: 0.5` is DEAD CODE (speedHz never executes when sync≠free). The HARD wipe the name promises is E15. |
| 43 | `waterlineSweep\|shadow_pass` | A moving band of DARKNESS drifting bow→stern. | **KEEP** | Only darken-mode spatial gesture in the library; unique and cheap. |

### 4.10 Kick Punch (2 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 44 | `kickPunch\|punch` | Auto-fires white dropHits off the live kick signal (threshold + rate limit). | **KEEP** | A different instrument from dropHit (the music plays the drum). Inert without audio — label it so on every surface. |
| 45 | `kickPunch\|ice_punch` | Same router, icy colour. | **OPT** | Keep, but colour should follow palette B instead of a frozen cyan (rides the E1 colour-source plumbing). |

### 4.11 Freeze Frame (3 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 46 | `freeze\|hold` | Captures the frame and holds it until released. | **KEEP** | The DJ's stop-time. |
| 47 | `freeze\|fade_2s` | Holds, then lets the live show bleed back over 2 s. | **KEEP** | Distinct, musical exit. |
| 48 | `freeze\|stutter` | **Byte-identical params to `hold`** (`{holdFadeMs: 0}`, `global_effect_library.js:521`); no special dispatch anywhere in the tree. | **KILL** | A duplicate wearing a lie for a name. The REAL stutter (time-quantize) ships as E-series work (§7 E14 note / D1). |

### 4.12 Frost Sparkle (3 pairs)

| # | pair | identity | verdict | reason |
|---|---|---|---|---|
| 49 | `sparkle\|fizz` | Sparse white glints (1 % of pixels, 400 ms decay) on the W channel — frost. | **KEEP** | Signature overlay; cheap. |
| 50 | `sparkle\|blizzard` | 15 % of the rig glinting at 80 ms — a white-noise blizzard. | **OPT** | Density 0.15 reads as noise, not weather, and is a real W-power spike; retune toward ~0.06 with the gallery as the judge. |
| 51 | `sparkle\|hihat` | Glint density rides the live hi-hat band; zero glints without audio. | **KEEP** | The only audio-textured overlay; label the audio dependency on every surface (it looks dead in silence, by design). |

### 4.13 Score

**KEEP 29 · OPT 3 · FOLD 15 · KILL 4** (the kills: freeze|stutter, and
colorWash ocean_blue / iceberg_cyan / purple — superseded by palette-fed
E1 — nothing else dies). Every FOLDed look survives behind its sibling's
mode wheel; no capability is lost, fifteen redundant name-tags are.
Library: 51 pairs → 32, before §7 adds thirty NEW identities that are
actually distinct.

---

## 5. Systemic findings (what "optimize" means here)

Five structural findings drive every OPT/FOLD above; fixing them IS the
optimization pass.

**F1 — Presets are being used as knob positions.** Fifteen of the 51
pairs differ from a sibling only in the value of a parameter the surfaces
can already drive (strobe hz, pump depth/rate, trail decay, crush levels,
movement direction/speed, breath period). The engine has a first-class
answer — `primaryMode` wheels + the intensity jog — and the library
predates it in places. FOLD moves each knob-position onto the wheel it
belongs to. Where an effect's ONE mode wheel is already spoken for, the
fold instead ships as a `paramsOverride` toggle in the Live Touch EDIT
posture (docs/70 §10) — W1 verifies wheel capacity per effect before
touching anything (D2).

**F2 — Colour is frozen where the system says palette.** colorWash's five
hard-coded colours (and kickPunch's `ice_punch` cyan) bypass the wheel /
schemes / docs/71 two-tone store that every other colour on the ship
flows through. §7 E1 (palette-fed wash) + a small `colorSource:
'palette1'|'palette2'|'fixed'` field on colour-carrying effects (W3)
lets effects change colour WITH the show. This is the operator's "use
effects to change colors" made structural.

**F3 — One genuine corpse.** `freeze|stutter` is byte-identical to
`freeze|hold` and dispatches nowhere specially — it has been lying on
the surface since it shipped (§4.11).

**F4 — The library has no boom/wipe vocabulary.** Category census of the
51: gate ×8, colour ×10, feedback ×4, movement ×9, envelope ×5, spatial
×3, ambient/overlay/time ×8, legacy ×4. There is not ONE one-shot spatial
gesture — no shockwave, no directional wipe-through, no impact that
starts SOMEWHERE on the ship and goes somewhere else. Every spatial thing
we own loops. That absence is exactly the projection-mapping / VJ grammar
the operator is asking for, and it is where most of §7 lives.

**F5 — Audio-dependent pairs look dead in silence, silently.**
`kickPunch` (toggle mode) and `sparkle|hihat` are inert without the audio
companion — correct behaviour (no fallback flashing), but no surface SAYS
so, which reads as "broken tile" during a quiet moment. Surfaces get an
AUDIO corner tag (W7; same grammar as the docs/70 §10 family tag).

**F6 — The colour effects run FLAT RED everywhere except Live Touch.**
The controller's movementTrace default palette is one colour —
`[[1,0,0,0,0,0]]` (`global_effects_controller.js:264`) — no library
preset declares `colors`, and the generic GEM/VSN1 dispatch sends preset
params only. Only Live Touch's provision path (and the XY-pad session)
ever supplies the wheel's palette. Bind a movement tile on CaptainPad
and the "colour effect" paints the ship solid red. P4 (colorSource:
palette, W3) fixes this for every surface at once. Related boot trap:
Live Touch's default scheme is `master` — FIVE COPIES OF ONE COLOUR
(`touch_control.html:5429,5537`) — so even on the panel the colour
family boots flat until the operator touches a scheme (the `#palNote`
nag exists because of this; D13 proposes `contrast` as the boot scheme).

**F7 — Small library rot, individually cheap to fix (W1 rides them):**
colorWash `tint` and `replace` are byte-identical code paths (one mode
stop is a no-op, `colorWash.js:20-26` vs `:52-57`); `freeze` is the one
effect whose jog and encoder drive the SAME param (`holdFadeMs` is both
primaryIntensity and primaryMode — they fight); `invert` has no `apply`
key and `kickPunch.apply` is a boolean predicate (both break a generic
registry walker); `dropHit.curve` reaches `Math.pow` unvalidated;
`beatPump.curve` and `sparkle.intensity` are dead knobs;
`feedbackTrails.decay/injection` are preset-only (no wheel reaches
them); `waterlineSweep.speedHz` is dead whenever sync≠free (so
`beat_wipe`'s value never executes — §4.9); the stale 40-line
`COLOUR_EFFECTS` comment in `touch_control_wire.js:1910-1923` describes
a mechanism that is now an empty array.

---

## 6. Live Touch — the colour effects and the surface

### 6.1 How the colour effects work today (mechanism, verified)

The operator's "5 colour effects" are the **movementTrace family**: nine
presets filling the first nine of the sixteen Live Touch tiles
(`FX_DEFAULT`, `touch_control.html:6392-6409`). Colour flows in exactly
one way: at ARM/provision time the panel sends the wheel's current
5-colour scheme as `paramsOverride.colors` (plus `fadeSpan`, `switchMs`)
on each movementTrace slot (`touch_control_wire.js:3338-3347`). The
engine never invents colour — the effect places the palette it is handed
(`effects/movement_trace.js` header contract), the colour-fade buffer
eases palette changes in over `switchMs`, and travel is tempo-locked.

This is a GOOD architecture. Its three real problems:

1. **Nine tiles, five looks.** Direction (`repeat/reverse`) and speed
   (`×1/×2`) are knob positions wearing tile faces — the same F1 disease,
   and the direct cause of docs/70 §10's "seven cells read identically as
   Movement Trace" conviction (D17 asked for exactly this curation pass).
2. **Colour is pushed, and only the panel pushes it.** Within Live
   Touch the loop is actually closed — every wheel move fires
   `palettechange` → `pushMovementColours()` re-PATCHes + re-activates
   the LIT movement tiles (`touch_control_wire.js:1975-1982, 1820-1832`)
   — good machinery, keep it. The gaps are outside the panel: a docs/71
   two-tone preset applied from CaptainPad writes `colorPalette1/2` at
   the engine, which Live Touch **never reads back** (write-only, both
   directions — two disjoint colour authorities), and every OTHER
   surface supplies no palette at all, so movement effects run flat red
   there (F6). The engine-side `colorSource: 'palette'` field (W3, P4)
   closes both at once: a movementTrace (or wash, or A/B flash) bound to
   the palette re-colours the moment `colorPalette1/2` moves — whoever
   moved it — with the existing `_movementColorFrom` fade making it
   arrive as a fade, not a snap.
3. **The family owns 9 of 16 tiles**, leaving seven for ALL other
   grammar — no boom, no wipe, no riser on the performance surface.

### 6.2 Verdict on the five colour effects

| tile identity | verdict | change |
|---|---|---|
| PULSE (burst + long fade) | **KEEP** | none — the envelope floor (0.04, "almost out, never out") is exactly right for a night art piece |
| 2 COLOUR walk (`every_other`, gaps) | **KEEP** | direction → mode wheel |
| TWO TONE (`every_other`, no gaps) | **KEEP** | rename to match docs/71 language; direction → mode |
| 5 COLOUR ladder (`one_per_color`) | **KEEP** | direction + ×2 speed → mode wheel |
| BLOCKS (`whole_group`) | **KEEP** | direction → mode wheel |

Five tiles, two mode stops each — the operator's phrase "the 5 colour
effects" becomes literally true on the surface, and four tiles come free.

### 6.3 The proposed PLAY bank (16 tiles, composes with docs/70 §10)

Post-`_291` PLAY grammar (FX_SHORT two-liners, family tags, no legend),
post-W7 of this plan. Rows read top→bottom as colour → colour-global →
build/boom → texture/time:

```
row 1  PULSE      WALK 2     TONE 2     LADDER 5      (MOVE family)
row 2  BLOCKS     AB FLASH   TONE LOCK  PAL WASH      (MOVE, FLASH, colour globals E23/E2/E1)
row 3  RISER      DEPTH CHG  CURTAIN    RADAR         (build + boom + wipes E8/E11/E15/E17)
row 4  STROBE     TRAILS     SHUTTER    FREEZE        (gate, feedback, E16, time)
```

- Everything colour-carrying on rows 1–2 follows the live palette
  (colorSource), so ONE wheel gesture or ONE two-tone preset re-themes
  eight tiles at once — that is the "nice global effects" ask.
- Family caps stay: rows enforce at-a-glance grammar (MOVE ×1 active,
  FLASH ×1, DIM ×1, FRAME ×1, TEXTURE stacks) — new effects get family
  assignments in W7 (D12).
- Displaced from defaults (still dropdown-reachable in EDIT): SWEEP
  shadow, BEAT PUMP, BREATH calm — ambient textures the deck already
  owns on slots 1–8, weak currency on a performance surface.
- `max_20hz` never appears on this surface (D16).

### 6.4 Which of E1–E30 belong on Live Touch

Surface-worthy (in the bank above): **E1, E2, E8, E11, E15, E16, E17,
E23**. Deck/VSN1-worthy (drummed or jogged, not tiled): E12, E13, E14,
E19, E22, E24, E29. Autopilot/scheduler-worthy (ambient, self-running):
E4, E9, E20, E21, E28. Expert/EDIT-only: the rest.

---

## 7. Thirty new effects — E1..E30

Ground rules that shaped all thirty. This is a **sparse 964-pixel 3D
ship**, not a raster: screen-space VJ moves (kaleidoscope tiling, pixel
sorting, zoom feedback) die here, so each classic is TRANSLATED into the
three coordinate systems the rig actually has — world coords (nx/ny/nz +
shipLong), **group ordinals** (the strand-relative space movementTrace
proved out), and the **24 named regions**. Colour comes from the palette
(colorSource, F2) unless the effect's meaning fixes it (white thunder,
amber bell). Nothing touches W/A/U by accident; nothing outlives
blackout; every effect self-gates to zero cost when off. Params are
listed in MFT knob order — **amount first, direction second where the
effect has one** (`.agent/memory/pattern-param-order` law), then shape,
then time.

Per entry: category · identity · mechanism · params · cost @40fps/964px ·
surfaces · engine-change flag. "lib-only" = new module + controller state
on an existing chain anchor, no engine.js edits. Primitives P1–P4 are
built once in W3:

- **P1 spatial index maps** (built at model load, static): per-pixel
  mirror partner (port↔starboard nearest by |x|-flip), vertical
  neighbour chain (next pixel down within Δnx/Δnz tolerance), and the
  group-ordinal neighbour arrays pixel_group_index already implies.
- **P2 frame ring** — N snapshot buffers (964×6 f32 ≈ 23 KB each) with
  beat-mark capture.
- **P3 one-shot envelope runner** — the dropHit AHR machinery
  generalized to drive any spatial one-shot (attack/travel/release with
  per-pixel phase offsets).
- **P4 colorSource resolver** — `'fixed' | 'palette1' | 'palette2' |
  'paletteWalk'` resolved per frame from param-center (F2).

### 7.1 Colour transforms (E1–E6)

**E1 · PALETTE WASH** — colour transform. *The colour wash that follows
the show: tints the whole rig toward live palette colour A, B, or slowly
alternates A↔B on the bar.* Mechanism: existing colorWashEffect verbatim;
the entry's colour comes from P4 instead of frozen params;
`paletteWalk` mode crossfades target colour A→B→A with smoothstep over
`barsPerSide` bars (tempo clock, free-run fallback 8 s). Params: [amount,
source(A/B/walk), barsPerSide]. Cost: identical to colorWash (~12
ops/px). Surfaces: Live Touch tile, deck, scheduler. **lib-only** (needs
P4). Replaces the three killed colorWash pairs.

**E2 · TONE LOCK** — colour transform. *Snaps every pixel's chroma to
whichever of the two palette colours it is nearer — any pattern becomes a
clean two-tone poster of the show's palette.* Mechanism: per pixel
compute luma `l = max(r,g,b)`; pick nearer of A/B by hue-agnostic RGB
distance to the normalized pixel colour; output `chosen * l` lerped over
the original by `amount`. W/A/U untouched. Params: [amount, bias(A↔B
midpoint shift)]. Cost ~25 ops/px. Surfaces: Live Touch tile (the docs/71
look as a stompbox), deck. **lib-only** (P4). postInvert anchor (chroma
family, beside crush).

**E3 · COMPLEMENT POP** — colour transform. *On each downbeat the whole
ship's colours flip to their complements for ~100 ms and snap back — a
chromatic pulse with zero brightness change.* Mechanism: gate =
`beatPhase < popSpan`; inside the gate apply the invert map to RGB but
re-scale to preserve per-pixel max (pure chroma rotation, no luma pop);
rate mode 1/2/4 beats. Params: [amount, rate, popSpanMs]. Cost ~10 ops/px
inside the gate, 0 outside. Surfaces: deck, Live Touch EDIT. **lib-only**.

**E4 · VINTAGE GRADE** — colour transform. *A luma-preserving 1912 grade:
the whole picture re-maps into lamplight amber with a W-channel lift on
the filament heads.* Mechanism: luma `l`; target = amber curve
`[1, .62·l^.9, .18·l^1.4]·l`; lerp by amount; add `wLift·l` into W on
fixtures that carry it. This is the honest version of what
`colorWash|vintage_amber` gestures at (§4.4 #16 folds into this when it
ships). Params: [amount, wLift]. ~18 ops/px. Surfaces: deck, scheduler
(golden-hour cue), autopilot. **lib-only**.

**E5 · HUE ORBIT** — colour transform. *The whole rig's hues rotate once
around the wheel per 1/2/4 bars — colour cycling as a performance
gesture.* Mechanism: RGB hue-rotation via the standard 3×3 lerp matrix
(coefficients recomputed once per frame); phase from the tempo clock;
always returns to 0° when toggled off (release ramps phase to nearest
360°, never parks a cast). **Flag (D10):** the operator REMOVED the
persistent global hue shifter in 2026-07; this is a transient, tempo-
locked EFFECT with a self-zeroing exit, not a standing offset — but it
needs explicit sign-off precisely because of that history. Params:
[amount, direction, barsPerOrbit]. ~15 ops/px. Surfaces: deck.
**lib-only**.

**E6 · CHROMA SPLIT** — colour transform. *The picture's red and blue
ghosts slide apart along each strand on the beat and snap back — chromatic
aberration for LEDs.* Mechanism: frame copy (P2 single-slot); pixel k
takes R from ordinal k−d, B from k+d within its group (clamped at ends),
G stays; `d = round(maxSplit · env(beatPhase))`, env = fast-attack decay.
Params: [amount, maxSplitPx, rate]. ~20 ops/px + one 23 KB copy.
Surfaces: deck, Live Touch EDIT. **needs P1+P2**.

### 7.2 Fade envelopes (E7–E10)

**E7 · CURTAIN DROP** — fade-envelope. *Hold: the ship fades to black
over half a second; release: it snaps back with an optional white pop —
the VJ cut-before-the-drop.* Mechanism: hold behavior (exists in slot
grammar); while held, master-style scalar `s → 0` over `fadeMs`
(smoothstep); on release s snaps to 1 and optionally fires one
dropHit|white_drop at `popAmount`. Runs at END anchor (gate family) so
dimmers still cap it; blackout still wins. Params: [amount(final floor),
fadeMs, popAmount]. ~6 ops/px. Surfaces: Live Touch (though hold-gesture
reliability was doubted for VSN1 — tap-toggle fallback mode), deck.
**lib-only**.

**E8 · RISER** — fade-envelope. *Arm it and the whole rig climbs an
exponential swell for 4 or 8 bars, whitening as it goes, then POPS and
releases on the downbeat — the buildup, as one button.* Mechanism: on
activate, wait for next bar boundary; `g = amount · (2^(t/T) − 1)` added
as luma lift + W fraction rising with g²; at T fire dropHit pop and
self-release (auto-off state change, like strobe bursts already do).
Params: [amount, bars(4/8), whiten]. ~10 ops/px. Surfaces: Live Touch
tile, deck. **lib-only** (P3).

**E9 · HEARTBEAT** — fade-envelope. *The ship beats like a heart —
lub-dub, lub-dub — at half tempo.* Mechanism: luminance envelope = two
gaussian bumps at phase 0 and 0.18 of each 2-beat cycle, depth `amount`,
between-beat floor 1−amount; multiplies RGBW like beatPump (whose single
duck it deliberately complements). Params: [amount, rate(½/¼), thump
width]. ~8 ops/px. Surfaces: deck, autopilot (ambient pulse), Live Touch
EDIT. **lib-only**.

**E10 · POWER FLICKER** — fade-envelope. *For three seconds the ship's
power fails — groups gutter and flicker like dying filaments — then
recovers on its own.* Mechanism: one-shot; per-GROUP random walk gate
(hash(groupId, floor(t·13)) → dip to floor 0.25..0.6), global floor
0.25, total length 3 s then auto-release with a 500 ms swell back.
Night-visibility note: self-limiting (≤3 s, floor 0.25, never full
dark) — but it exists to be scary, so it is a D-item (D15). Params:
[amount, lengthMs]. ~8 ops/px. Surfaces: deck trigger, special events
(iceberg moment). **lib-only** (P3).

### 7.3 Global booms (E11–E14)

**E11 · DEPTH CHARGE** — global boom. *One hit: a ring of light erupts
from the ship's heart and rolls outward through the hull, leaving a
briefly darker wake.* Mechanism: P3 one-shot; per pixel `d =
radial(nx,nz)` (sweep's axisCoord radial); ring at `R(t) = t/T`, width w:
`lift = amount · exp(−((d−R)/w)²)` in palette/white colour; wake =
`−0.3·amount` for `d < R−w` fading as t→T; T ≈ 1.2 s. Multiple
overlapping charges allowed (poly like dropHit, cap 3). Params: [amount,
origin(center/bow/stern), width, durationMs]. ~18 ops/px while ringing.
Surfaces: Live Touch tile, deck drum pad. **lib-only** (P3).

**E12 · BOW STRIKE** — global boom. *An impact flash hits the bow and
shudders down the length of the ship, arriving at the stern half a second
later — the iceberg, felt.* Mechanism: P3; per pixel delay `τ =
shipLong · travelMs` (direction flips for stern origin); each pixel runs
a 90 ms white/palette flash + 400 ms decay starting at its τ; a second,
weaker echo at 1.5× τ. Params: [amount, direction, travelMs]. ~14
ops/px. Surfaces: deck drum pad, special events. **lib-only** (P3).

**E13 · BELL TOLL** — global boom. *One deep amber pulse fills the whole
ship and rings down through three fading echoes, one per beat.* Mechanism:
P3; envelope = Σ echoes k=0..3 of `amount·0.55^k` gaussian bumps at
`t = k·beatLen`; colour amber + A channel + W on vintage heads (meaning-
fixed colour, like thunder's white). Params: [amount, echoes, decay].
~8 ops/px. Surfaces: deck, scheduler (hour marks — ship's bell!).
**lib-only** (P3).

**E14 · THUNDER** — global boom + the real stutter. *Two frames of
blinding white, then the light drains away unevenly, pixel by pixel, like
afterglow crackling out.* Mechanism: 2-frame full-white gate; then per-
pixel decay `exp(−t/(τ·(0.5+hash(i))))` on the flash layer over the live
show; optional `stutterFrames` mode re-fires the 2-frame gate 2–3 times
at 60–90 ms gaps (THIS is the stutter freeze|stutter pretended to be —
closes D1's replacement clause). Params: [amount, stutter(off/2/3),
tailMs]. ~10 ops/px while ringing. Surfaces: deck drum pad, Live Touch
EDIT. **lib-only** (P3).

### 7.4 Swipe-wipes (E15–E18)

**E15 · CURTAIN WIPE** — swipe. *A hard bright edge sweeps once down the
full length of the ship, dragging darkness (or the palette) behind it —
the projection-mapping wipe, on a hull.* Mechanism: P3 one-shot; edge at
`shipLong = t/T`; `|x−edge| < edgeW` → leading-edge colour at full;
behind the edge → mode: 'dark' (scale 0.15), 'palette' (wash to colour
B), 'reveal' (untouched — edge only). T from durationMs or one bar.
Differs from waterlineSweep by being one-shot, hard-edged, and
consequence-leaving. Params: [amount, direction, mode, durationMs].
~12 ops/px during traversal. Surfaces: Live Touch tile, deck.
**lib-only** (P3).

**E16 · SHUTTER** — swipe. *Venetian blinds made of ship: alternating
groups slam dark and swap sides on the beat.* Mechanism: per pixel gate =
`(groupId + floor(beat·rate)) % 2` → scale 1−amount; group-parity is the
sparse-rig translation of screen shutter bars (guaranteed to read,
because groups are physical runs). Params: [amount, rate(1/2/4 per bar),
parity span(1/2 groups)]. ~6 ops/px. Surfaces: Live Touch tile, deck.
**lib-only**.

**E17 · RADAR** — swipe. *A luminous bearing-line sweeps a full circle
around the ship's mast, wiping the hull with light as it passes, glow
fading behind it.* Mechanism: per pixel bearing `θ = atan2(nz−0.5,
nx−0.5)`; head angle from tempo (one rotation per 1/2/4 bars) or free;
`lift = amount · wrapGauss(θ−head) + afterglow · wrapGauss(θ−head,
wide, behind-only)`. Reads from every viewing angle because it is a real
3D rotation, not a screen wipe. Params: [amount, direction, barsPerTurn,
glow]. ~16 ops/px (one atan2 per pixel per frame — precompute θ per
pixel once at enable: then ~8). Surfaces: Live Touch tile, deck,
autopilot. **lib-only** (θ cache = trivial local state).

**E18 · SPLIT SLAM** — swipe. *One hit: the bow half slams to palette A,
the stern half to palette B, a white seam flashes at midships, then both
halves drain back to the show.* Mechanism: P3; masks `shipLong <>0.5`;
wash each side (replace-mode, amount envelope 1→0 over T); seam =
gaussian at 0.5 flashing white for 150 ms. Params: [amount, axis
(long/vert), durationMs]. ~12 ops/px while ringing. Surfaces: deck drum
pad, Live Touch EDIT. **lib-only** (P3, P4).

### 7.5 Trail-feedback (E19–E21)

**E19 · BEAT ECHO** — trail-feedback. *Everything the ship does comes
back one bar later as a fainter ghost — a delay line for light.*
Mechanism: P2 ring captures the frame at each beat mark (cap 8 slots);
output `px = max(px, snapshot[k beats ago] · mix · 0.98^age)`; k mode
1/2/4 beats. Distinct from feedbackTrails: discrete echoes of whole
FRAMES at musical offsets, not continuous smear. Params: [amount(mix),
delay(1/2/4), feedback(echo-of-echo 0..0.5)]. ~8 ops/px + ring writes.
Surfaces: deck, Live Touch EDIT, autopilot. **needs P2**.

**E20 · RISING SMOKE** — trail-feedback. *Light leaves a smoke-trail
that drifts UPWARD off the hull, thinning as it climbs.* Mechanism:
trails buffer where each frame's buffer is sampled from the vertical-
neighbour-below (P1 chain) before decay — injection at the pixel,
memory climbing pixel-to-pixel; decay 0.90; W excluded (smoke is
chroma). Params: [amount(mix), climb px/s, decay]. ~14 ops/px + one
buffer. Surfaces: autopilot, deck. **needs P1**.

**E21 · WAKE** — trail-feedback. *Every light drags a wake behind it,
streaming toward the stern, like the ship is under way.* Mechanism: same
displaced-feedback machinery as E20 but along group ordinals toward
stern (P1 ordinal neighbour, direction from the group's world-space
long-axis sign so "aft" is aft on both sides). Params: [amount,
direction(fore/aft), flow px/s, decay]. ~14 ops/px. Surfaces: autopilot
(THE at-sea ambient), deck, Live Touch EDIT. **needs P1**.

### 7.6 Strobe-flash (E22–E24)

**E22 · LIGHTNING** — strobe-flash. *Storm light: random parts of the
ship flash white for a frame or two, sometimes twice in quick succession,
under a faint afterglow.* Mechanism: every 0.4–2.5 s (density knob,
hash-jittered) pick 1–3 of the 24 named regions; flash their pixels 1–2
frames at `amount` white+W, 30 % chance of a 80 ms double-hit; regional
afterglow 250 ms. Uses the region registry as the flash quantum — a
sparse rig's version of screen-space lightning (whole architectural
chunks, readable at distance). Params: [amount, density, doubleHit%].
~4 ops/px average. Surfaces: deck, scheduler (storm cue), Live Touch
EDIT. **lib-only** (region indices from the group index at enable).

**E23 · A/B FLASH** — strobe-flash. *The whole ship flashes between the
two palette colours on the beat — a chromatic strobe with no white and no
dark.* Mechanism: gate from beatPhase (rate 1/2/4 per beat); colour =
A on even gates, B on odd (P4); applied as replace-lerp by amount; luma
preserved at min 0.6 of live so it never blacks out. The
photosensitivity-friendly strobe (chroma alternation, brightness held).
Params: [amount, rate, softness(gate edge)]. ~10 ops/px. Surfaces: Live
Touch tile, deck. **lib-only** (P4).

**E24 · ROLLING SHUTTER** — strobe-flash. *A flash that travels: each
strobe cycle's ON window sweeps down the ship, so the flash ripples
bow→stern instead of hitting everywhere at once.* Mechanism: strobe
timing (frame-locked, existing helpers) + per-pixel phase offset
`shipLong · spread` frames; duty 0.3. At spread 0 it IS the strobe; at
spread 8 it is a luminous wave at strobe speed. Params: [amount,
direction, hz(mode), spreadFrames]. ~8 ops/px. Surfaces: deck.
**lib-only**. Safety: same tier table as strobe (it inherits the
frequency wheel; effective per-pixel rate never exceeds the named hz).

### 7.7 Spatial displacement (E25–E28)

**E25 · CAROUSEL** — displacement. *The pattern itself picks up and rides
around the ship, one group-step per beat — everything the show is doing,
rotated.* Mechanism: frame copy; pixel k of group g reads the copy at
ordinal `(k + floor(phase)) % len` with linear interpolation on frac;
phase advances px/beat. movementTrace moves the PALETTE; this moves the
PICTURE. Params: [amount(mix), direction, pxPerBeat]. ~12 ops/px + copy.
Surfaces: deck, Live Touch EDIT. **needs P1+P2**.

**E26 · MIRROR FOLD** — displacement. *While held, the port side becomes
a live mirror of starboard — the ship snaps into perfect symmetry.*
Mechanism: P1 mirror map (built once: nearest pixel under x-flip);
`px[i] = lerp(px[i], px[mirror[i]], amount)` for the chosen side; mode
picks which side is truth. The sparse-rig kaleidoscope: reflection
instead of tiling. Params: [amount, source(stbd/port/alternate-on-bar)].
~8 ops/px. Surfaces: deck, Live Touch EDIT. **needs P1**.

**E27 · GRAVITY DROP** — displacement. *One hit: all the ship's light
lets go, falls to the waterline, splashes white along the hull's foot,
and the show climbs back up.* Mechanism: P3 + P1 vertical chains; phase 1
(500 ms): content sampled from `ny + ½g·t²` above (accelerating fall);
phase 2: 150 ms white band at min-ny pixels of each chain (the splash);
phase 3: sample offset eases back to 0 over 800 ms. Params: [amount,
durationMs]. ~16 ops/px while running. Surfaces: deck drum pad, special
events. **needs P1+P3**.

**E28 · SLOSH** — displacement. *The whole picture sloshes bow→stern and
back with the tempo, like water in the hull.* Mechanism: frame copy;
ordinal displacement `d = amp · sin(2π·barPhase) · groupLen`, sampled
with interpolation; amp scales per group by its world-long extent so
short strands slosh proportionally. Params: [amount, amp, rate(1/2
bars)]. ~12 ops/px + copy. Surfaces: autopilot, deck. **needs P1+P2**.

### 7.8 Composites (E29–E30)

**E29 · DROP MACRO** — composite. *One button plays the whole drop: a
4-bar riser, then on the downbeat a depth charge, a white pop and two
seconds of heavy trails — then it cleans up after itself.* Mechanism: a
macro dispatcher (P3 extension, W3) that drives a timed script of
existing controller setters: E8(4 bars) → at bar boundary
E11+dropHit|white_drop + feedbackTrails|soft (mix .7) → trails fade out
at +2 s. One slot, behavior trigger; panic kills the whole script.
Params: [amount, bars]. Cost = sum of constituents (bounded, measured in
W6 gate). Surfaces: Live Touch EDIT → tile if it earns it, deck.
**needs macro dispatcher** (engine-adjacent: new controller module, no
engine.js change).

**E30 · GHOST SHIP** — composite. *One toggle and the Titanic becomes
her own ghost: the show freezes, inverts to a pale negative, breathes
slowly, and trails smear off her edges — hold as long as the moment
lasts.* Mechanism: macro toggle arming freeze|hold + invert +
feedbackTrails|ghost_ship + breath(depth .3); release tears down in
reverse order over 1 s. Params: [amount(trail mix), breathDepth].
Surfaces: deck, special events (midnight moment), Live Touch EDIT.
**needs macro dispatcher**.

### 7.9 Top five by wow-per-effort (for staging W4–W6)

1. **E11 Depth Charge** — the missing boom primitive, pure lib+P3, reads
   at any distance.
2. **E23 A/B Flash** — huge palette-driven energy, ~30 lines over
   existing machinery, brightness-safe.
3. **E15 Curtain Wipe** — the one-shot wipe the library plainly lacks.
4. **E1 Palette Wash** — kills three stale pairs, delivers "effects
   change colours" everywhere at once.
5. **E22 Lightning** — region-quantized storm; cheap, dramatic,
   unmistakably ours.

---

## 8. Cost model (why every E above fits 40 fps)

The frame budget at 40 fps is 25 ms; the whole existing effects chain on
964 pixels is measured in fractions of a millisecond per active stage
(per-pair measurements in the gallery manifest — see §3). Working
numbers: 964 px × 40 fps ≈ 38.6 k pixel-visits/s per active per-pixel
pass; a 20-op pass is ~0.8 M simple ops/s — noise on this hardware
(the engine already runs a WASM VM + mixer over the same pixels every
frame). Memory: every buffer any E-effect wants (frame copy, trails
buffer, 8-slot beat ring, P1 index maps) is 964×6 f32 ≈ 23 KB apiece —
under 300 KB total if EVERYTHING ships and is simultaneously armed.

The honest budget risks are not per-pixel math:

1. **Stacking** — six effects at ~15 ops/px each is still fine (<1 ms),
   but W4–W6 gates measure the WORST-CASE armed stack, not single
   effects (gate: full proposed Live Touch bank all-on ≤ 2 ms/frame on
   the show server class of hardware).
2. **Per-frame allocation** — the house rule stands: allocate at enable,
   never in the frame loop (every existing module complies; new modules
   inherit the review checklist).
3. **atan2/exp in hot loops** — E17 caches per-pixel bearings at enable;
   E11/E14 use small LUTs if the measured cost says so (gate-driven, not
   speculative).

---

## 9. The Opus wave plan

Waves are sized for one Opus lead each, sequential except where marked.
**No wave starts before Sina has reviewed this document**, and W1 starts
only after a coordinator git checkpoint of the pre-overhaul tree (the
docs/71 §0 convention). No agent commits; the operator owns every
checkpoint. Engine-touching waves note their restart; the launcher
bounce batches with whatever is already pending.

### W1 — Library hygiene (kills + folds)

**Scope:** `marsin_engine/lib/global_effect_library.js`,
`lib/global_effect_slot_manager.js` (mode plumbing only),
effect modules' `primaryMode` descriptors, and every persisted reference:
`DEFAULT_SLOT_CONFIG`, `marsin_engine/states/**` migration shim,
`docs/ui/touch_control.html` FX_DEFAULT/FX_OPTS, scene playlists/timeline
cues that name killed pairs, CaptainPad swap-sheet lists.
**Step zero:** verify mode-wheel capacity per FOLD target (each effect
has ONE primaryMode; where it is already occupied — e.g. strobe's
Frequency IS the fold destination, movementTrace's current mode is
checked here — the fold either rides the existing wheel or becomes an
EDIT-posture param toggle; any fold that fits neither returns to Sina
instead of improvising).
**Migration law:** a persisted reference to a killed/folded pair loads as
its survivor + the equivalent mode value, WITH a log line — never a
silent 404, never a crash on old state.
**F7 hygiene rides along** (each its own commit-sized item): collapse
colorWash `tint`/`replace` to one honest mode list; give `freeze` a real
primaryIntensity or an explicit null (jog and encoder currently drive
the SAME param); `invert` gets an explicit `apply` or a documented
no-walker note, `kickPunch.apply` stops masquerading as a pixel fn;
validate `dropHit.curve`; delete or wire the dead knobs
(`beatPump.curve`, `sparkle.intensity`); put `feedbackTrails` decay on
the new Length mode (it is currently preset-only); delete the stale
`COLOUR_EFFECTS` comment block in `touch_control_wire.js:1910-1923`.
**Gates:** library/catalog contract suites green (incl.
`touch_control_catalog_contract`); a new migration test (old state file
naming all 19 dead pairs loads to the mapped survivors); gallery regen
diff shows exactly the intended removals; grep proves no dangling pair
ids outside history docs. **Restart:** yes (library). **Rollback:** the
fold map is a pure table — revert the commit; state files were never
rewritten in place.

### W2 — Effects gallery productization (parallel-safe with W1)

**Scope:** move the `_310` generator from scratch into
`marsin_engine/tools/effects_gallery/generate.mjs` (house style, offline,
socket-free), add `tests/patterns/effects_gallery_tool.test.mjs`
(mirroring `playlist_gallery_tool.test.mjs`: manifest schema, digest
match, per-pair media present, metrics sanity), and register the
effects gallery in the master index generator so `--index-only` lists it
(it currently only knows playlists + transitions — verified in §2's
sweep). **Gates:** tool suite green; regenerated media digest-stable
across two runs; master index links resolve offline. **Restart:** no.

### W3 — Engine primitives (P1–P4 + macro dispatcher)

**Scope:** new `lib/` modules: `spatial_index_maps.js` (P1: mirror map,
vertical chains, ordinal neighbours — built once per model load, unit-
tested against titanic + test_bench geometry), `frame_ring.js` (P2),
one-shot envelope runner (P3: generalize dropHit's AHR into a reusable
per-pixel-phase envelope), `colorSource` resolution (P4) reading
`colorPalette1/2` from param-center at frame time + the movementTrace /
colorWash / kickPunch opt-in fields, and the macro dispatcher (E29/E30
substrate; panic tears down any running script). Controller wiring only —
**no engine.js edits** (all anchors exist).
**Gates:** unit suites for each primitive; zero-cost-when-off proof
(frame-time delta with all primitives idle = 0 within noise); palette-
follow proof (move colorPalette1 → a bound movementTrace re-colours
through its existing fade, no re-provision); state-shape review (nothing
new persists without a schema note). **Restart:** yes.
**Dependency:** W1 first (fold landscape settled). E-effects depending
only on P3/P4 may start as soon as those land.

### W4 — Colour + fade effects (E1–E10)

**Scope:** ten new modules + library entries + controller state, each an
independent, individually-vetoable landing (one module, one entry, one
test each — a vetoed E leaves zero residue).
**Gates (per effect, the distinctness-and-coverage bar):**
- **Distinctness:** over the standard gallery base capture, the new
  pair's ON-window render must sit ≥ a floor RMS byte distance from
  EVERY existing library pair's render (floor set from the §3 overlap
  matrix's observed near-dupe band — the same-effect near-dupes it
  flagged define "too close"); the full 30×51 matrix is regenerated and
  archived with the wave report.
- **Cost:** measured ms/frame within its §7 estimate ×2, and the §8
  stack gate holds.
- **Safety/night-visibility:** no effect except explicit holds (E7) may
  hold full-rig mean luma below 15 % for >3 s (automated over the
  gallery render); flash-family effects respect the strobe tier table.
- **Gallery:** card + GIF + description added; verdict column starts
  KEEP by construction.
**Restart:** yes. **Rollback:** delete module + entry; nothing else
references a new effect until W7.

### W5 — Booms + wipes (E11–E18)

Same per-effect structure and gates as W4, plus a **coverage gate** for
the spatial ones: over one full gesture, every one of the 24 named
regions must register the effect (mean-peak delta > 0 in every region —
the `_305` §4.3 census machinery, reused verbatim). **Depends:** W3.

### W6 — Trails, strobe-family, displacement (E19–E28)

Same structure; adds the **photosensitivity ceiling** (no default-
surface configuration exceeds 10 Hz effective flash; E24's per-pixel
rate proof), and displacement effects prove **endpoint honesty** (at
amount 0 the frame is byte-identical to input — no drift through the
resample). **Depends:** W3; E25/E28 also want W1's movementTrace mode
conclusions.

### W7 — Live Touch surface rework

**Scope:** `docs/ui/touch_control.html` + `touch_control_wire.js`: new
FX_DEFAULT bank (§6.3), direction/speed mode wiring on the five colour
tiles, palette-follow opt-in on colour-carrying tiles, AUDIO corner tag
(F5), FX_SHORT + family assignments for the new tiles (D12).
**Hard dependency: `_291`** (docs/70 §10 W6 PLAY/EDIT grammar) **lands
first** — this wave extends that grammar (it satisfies its D17 curation
clause) and must not race it in the same files. Also after W4/W5 (the
tiles must exist to be tiled).
**Gates:** the docs/70 §10.3 acceptance list re-run green;
`touch_control_catalog_contract` extended to the new bank; ARM
provision/readback proof on a scratch engine; physical-iPad checklist
appended for Sina. **Restart:** no (hot-served panel) + one scratch-
engine validation. **Rollback:** FX_DEFAULT is one array; the old bank
is a one-line revert.

### W8 — Deck/VSN1 curation + acceptance

**Scope:** slots 1–8 default layout refresh (booms on drum-friendly
trigger slots), CaptainPad swap-sheet ordering, docs refresh (docs/28
pointer to this doc), final gallery + master index regen, and the
operator acceptance script (a guided 20-minute rig walk: each family,
each new tile, the drop macro, the kill-list absences).
**Gates:** all suites green across marsin_engine + simulation touched
sets; security check; `now.md`/dossier/tracker updates. **Restart:**
final launcher bounce, operator-timed.

### Failure posture (all waves)

Fail loudly and stop — no fallback dispatch, no silently skipped gate.
A red gate returns to the operator with the measurement, per house P0.

---

## 10. Decision list (vetoable, numbered)

One line each; strike to veto. Defaults are what the waves implement if
you say nothing beyond "go".

- **D1** — KILL `freeze|stutter` (byte-duplicate of `hold`); the real
  stutter ships inside E14 Thunder's stutter mode. Veto → it stays as a
  third identical tile.
- **D2** — The 15 FOLDs of §4 (strobe ×4, crush ×2, trails ×1, beatPump
  ×2, breath ×1, movementTrace ×4, waterlineSweep ×1), each surviving as
  a mode-wheel stop; W1 step-zero verifies wheel capacity and returns to
  you where a fold doesn't fit. Veto per-row in §4 freely.
- **D3** — KILL colorWash ocean_blue / iceberg_cyan / purple, superseded
  by E1 Palette Wash; emergency_red and the vintage grade survive. Veto →
  they stay as fixed presets alongside E1.
- **D4** — E1's `paletteWalk` A↔B alternation defaults to 4 bars per
  side.
- **D5** — The five colour tiles of §6.2 with direction/speed on mode
  wheels (satisfies docs/70 D17). Veto → nine movement tiles stay.
- **D6** — Proposed 16-tile PLAY bank layout of §6.3. Reorder freely —
  it is one array.
- **D7** — SWEEP shadow / BEAT PUMP / BREATH / TRAILS soft leave the
  default Live Touch bank (stay dropdown-reachable; ghost keeps the
  TRAILS tile). Veto per-tile.
- **D8** — `sparkle|blizzard` density retune 0.15 → ~0.06 (gallery-
  judged). Veto → keep the blizzard as-is.
- **D9** — `kickPunch|ice_punch` colour follows palette B once P4 lands.
- **D10** — **E5 Hue Orbit needs your explicit yes**: you removed the
  persistent global hue shifter in 2026-07; E5 is transient, tempo-locked,
  self-zeroing on exit — but it is still a global hue rotation.
- **D11** — E10 Power Flicker ships (self-limiting ≤3 s, floor 0.25)
  as a deck/special-events trigger only. Veto → cut it (night-visibility
  purism is a legitimate ruling).
- **D12** — Family assignments for new effects (booms/wipes → FLASH-like
  one-at-a-time caps; E19–E21/E25–E28 → TEXTURE stackable; E23 → FLASH;
  E16 → DIM) — implementer proposes the exact table in W7, you bless.
- **D13** — P4 palette-follow becomes the DEFAULT colour source for
  movementTrace and E-series colour effects on ALL surfaces (kills the
  flat-red F6 failure; fixed colours remain available via EDIT), and
  Live Touch's boot scheme changes `master` → `contrast` so the colour
  family never boots as five copies of one colour. Veto either half.
- **D14** — The effects gallery tool moves into
  `marsin_engine/tools/effects_gallery/` and registers with the master
  index (W2). Veto → it stays a scratch tool, gallery regenerated by
  hand.
- **D15** — 30 effects is the CATALOGUE, not a shipping quota: W4–W6
  land them in the §7.9-informed order and you can stop the line after
  any wave with a coherent library. Default: all thirty attempt to land.
- **D16** — 20 Hz strobe (and any ≥10 Hz mode stop) never appears on a
  default surface tile; expert access via EDIT/deck only. (Standing
  safety posture, restated so it inherits to E24.)
- **D17** — E29/E30 macro slots are engine-side scripts (survive panel
  death, panic-killable). Veto → composites become panel-side gesture
  macros instead (weaker, but zero engine surface).
- **D18** — Gallery media policy: keep full GIFs (163 MB) vs GIFs at
  half fps/size (~40 MB) vs MP4-only (25 MB). Default: half-fps GIFs at
  the W2 productization; the current full-fat set stands until then.

---

## 11. What Sina should review first (suggested order)

1. §4.13 the score + the four KILLs (30 seconds).
2. §6 the Live Touch story — five colour tiles + the proposed bank.
3. §7.9 the top-five new effects, then skim E1–E30 headlines and strike
   any that don't spark.
4. The gallery (`docs/pattern_gallery/effects/index.html`) with §4's
   table beside it — the verdicts cite it.
5. §10 decisions D1–D17.
6. §9 waves last — they reshape themselves around whatever you struck.

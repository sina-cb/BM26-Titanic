# Color Theory — lighting the physical ship

**Status:** REFERENCE — palette and composition guidance for pattern, look and
playlist tuning. **Operator:** Sina Solaimanpour.

Nothing in this document is an engine rule. It is guidance: the physics is
fixed, the artistic direction is the operator's, and the engine enforces
neither. Where a rule *is* enforced (the `w == a` white invariant, the
no-fallback rule), it lives in
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) and is labelled as a
hard contract there.

The Titanic's exterior is wood, and the wood is not a neutral canvas: parts are
stained a bold yellow (most prominently the **smokestacks** — tall, highly
visible), and other parts are painted blue or black (dark, low reflectance).
Every wash fixture's output is effectively *multiplied* by the surface's
reflectance, so palette choices that look great on a neutral render can fail on
the physical structure.

---

## 1. The physics in one line

A surface reflects its own color and absorbs the rest. Yellow stain reflects
reds, oranges, yellows, and most greens well — and **absorbs blue**. Dark
blue/black paint absorbs almost everything and returns little light regardless
of hue.

---

## 2. The five instruments

The ship is **964 mapped pixels**. They are not one homogeneous rig — they are
five instruments with different reach, different emitters, and different jobs.

| Instrument | Pixels | Hardware | Emitters | View name |
|---|---:|---|---|---|
| **Hull Canvas** | 360 | 20 Shehds LED bars (18 px each) across four wall groups | RGB + W + Amber + UV | `Hull Canvas` |
| **Silhouette** | 320 | 8 rope/strand runs of 40 px | RGBW | `Silhouette` |
| **Jewelry** | 96 | 16 Vintage rail fixtures (6 heads each) | RGBW | `Jewelry` |
| **Organs** | 40 | 40 UKing pars — 24 across the main and small stack structures, 16 across the left and right auditoriums | RGB + W + Amber + UV | `Organs` |
| **Identity** | 148 | 2 independently controlled TE signs, 74 px each | RGBW | `Identity` |

**Each instrument is a real, named engine view.** A pattern targets one with
`inView("Hull Canvas")` — no bit arithmetic, no section ids. The Organs
subdivide into `Stacks` (24 px, the funnels only) and `Auditoriums` (16 px);
those seven names are the whole authored composite set. For a **half** of the
ship, use the exhaustive `LEFT` / `RIGHT` views (482 px each, every instrument
included) — `inView("Silhouette") && inView("LEFT")` is the left half of the
silhouette. The per-instrument `Left *` / `Right *` composites were removed
(report `_145`) and are now hard compile errors. Full catalog — 7 composites,
24 base groups, and the derived auto-views — in
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §7.3.1–§7.3.2.

Sources: [`simulation/scenes/titanic/views.yaml`](../simulation/scenes/titanic/views.yaml),
[`simulation/scenes/titanic/patches.yaml`](../simulation/scenes/titanic/patches.yaml),
[`simulation/scenes/titanic/controllers.yaml`](../simulation/scenes/titanic/controllers.yaml),
[`simulation/scenes/titanic/scene_config.yaml`](../simulation/scenes/titanic/scene_config.yaml),
and the fixture models under `simulation/dmx/fixtures/`.

### 2.1 Artistic roles

- **Hull Canvas** — the big surface. Broad gradients, surface-aware color,
  water, interference patterns, large beat motion. This is where a look has
  room to *be a picture* rather than a gesture.
- **Silhouette** — the far-field outline. Cool saturation, tracing,
  convergence, directional travel. Direct-view pixels against dark paint: this
  is what draws the ship's shape out of the night from across the playa.
- **Jewelry** — warm detail. Incandescent sparkle, elegant accents, restrained
  chases. Six small heads per fixture is a *filigree* instrument, not a wash;
  treat it like trim, not like a light source.
- **Organs** — structural heartbeat. Stack halos, auditorium breath, punches
  and power. Forty single-pixel sources with real output behind them: this is
  the instrument that hits.
- **Identity** — legible, deliberate TE punctuation. The signs say who we are.
  They should read as a statement, **not as constant visual competition** with
  everything else — a sign that is always animating is a sign nobody reads.

### 2.2 What each instrument can actually emit

- **Bars and pars run RGBWAU-capable DMX paths.** Their white, amber and UV
  lanes reach real emitters.
- **Ropes, Vintage rail pixels, and the TE signs are RGBW.** They *do* have
  dedicated white emitters — the TE sign pucks are the same LEDs as the rope
  strands. What they lack is amber and UV.
- On the LED-strand path (ropes and signs) the **amber lane is folded into RGB**
  and the **UV lane is dropped**, then the whole RGBW quad is jointly pre-scaled
  so nothing clips — hue and the colour/white balance survive, the picture just
  dims. See [`simulation/src/dmx/led_wire.js`](../simulation/src/dmx/led_wire.js).

**The practical consequence for palettes:** a look built on UV will simply not
exist on the Silhouette or on the signs. A look built on amber *will* exist
there, but as an RGB mix rather than an amber emitter. If the UV or amber is
carrying the idea, put it on the bars and pars and let the RGBW instruments
carry something else.

> The `w == a` rule (whenever logical white is emitted with `rgbwau`, W and A
> must be byte-identical) is what keeps a white cue landing at the same colour
> temperature on both paths. Cooler/warmer whites are shaped with RGB, never by
> unbalancing W against A; UV stays independent; amber is not a separate
> authoring accent lane under this project's convention. Full statement and
> enforcement: [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §6.2.

---

## 3. Yellow-stained wood (the smokestacks, and patches elsewhere)

- **Lean into warm palettes for anything that washes stained wood.** Ambers,
  golds, oranges, and warm reds are amplified by the stain and look rich and
  saturated.
- **Warm white (≈2700–3000 K) makes the stain look intentional** — varnished,
  golden. Cool white makes the same stain read as water damage / dirt. Prefer
  warm white as the base wash on wood.
- **Pure blue wash is the worst case.** The stain eats it: the result is dim,
  muddy, near-black — and because the staining is uneven, blue is also the hue
  that *maximizes* visible patchiness between stained and unstained areas. If a
  look needs blue on wood, it needs real intensity behind it, and expect navy,
  not azure.
- **Want "cool" on stained wood? Use teal/cyan, not pure blue.** Cyan keeps a
  green component the wood can still reflect, so it reads as sea-glass/teal
  instead of mud. Conveniently nautical.
- **Deep red is the one non-warm hue that survives bold yellow** — it renders as
  ember/crimson rather than muddy. Red-and-gold is the go-to "dramatic" palette
  for the stacks.
- **On the RGBWAU fixtures aimed at stained zones:** the W emitter's output
  picks up the surface yellow. For cool looks on those zones, mix white from
  R+G+B with the blue biased up rather than leaning on W.

---

## 4. The stacks specifically

The real Titanic's funnels were White Star Line buff (yellow-gold) with black
tops — the stain is accidentally historically accurate.

**The physical truth:** there are **two main stack structures plus two smaller
stack beacons**, lit by the Organs (24 of the 40 pars sit across those four
structures). Not four identical giant funnels — two large, two small.

- **Own the gold.** Warm amber/gold on the stacks is the highest-visibility
  combination available at night (bold yellow stain + tall silhouette + warm
  light). Exterior night visibility is the mission-critical requirement;
  glowing gold funnels against a dark hull read as "ship" from across the playa.
- **Let the stacks be the warm exception inside cool looks.** When the deck goes
  teal/blue/purple, keeping the stacks gold/amber rather than dragging them
  along tends to read as intentional and expensive — a blue wash turns the most
  prominent feature olive-brown at exactly the moment everything else looks
  good.
- The stacks exist as their own engine views — **`Stacks`** (all 24 px) and the
  four finer base groups (`Left SmokeStack`, `Right SmokeStacks`,
  `Left Small SmokeStack`, `Right Small SmokeStack`); for one side, combine
  `Stacks` with `LEFT` / `RIGHT`. So a "stacks stay warm" constraint *is* trivially
  implementable engine-side — `inView("Stacks")` is one line. **Operator
  ruling: keep this as artistic guidance, not an enforced engine rule.**
- Note that `Organs` covers the pars on the **auditoriums too**. If you want
  the funnels warm without dragging the auditoriums along, target `Stacks`,
  not `Organs`.

---

## 5. Blue and black surfaces

- Dark surfaces disappear at night — they are **free negative space**, not a
  problem to solve. Don't spend wash intensity trying to color them.
- Direct-view pixels (the Silhouette strands, the Jewelry heads, the Identity
  signs) pop maximally against the dark areas with zero color distortion. Put
  the saturated blues and purples there.

---

## 6. The core composition rule

**Wash the wood warm; put saturation in the pixels.**

Direct-view fixtures are their own light source — the surface can't distort
them — so the classic pairing is a warm amber wash on the structure with
saturated blue/cyan in the direct-view LEDs. The complementary contrast makes
both look *more* saturated than either would alone.

---

## 7. One palette does not mean one colour

The engine gives the operator two global palette endpoints (`colorPalette1`,
`colorPalette2`) and patterns blend strictly between them. That is what makes
the whole ship read as one coherent look.

**It does not mean every fixture family should show the same colour at the same
brightness.** A coherent look uses the same global palette endpoints but
different **palette positions**, **luminance**, **saturation**, and **motion**
per instrument. That is the difference between a lighting design and a paint
bucket.

A worked example of the same two endpoints, distributed:

| Instrument | Palette position | Luminance | Motion |
|---|---|---|---|
| Hull Canvas | full sweep between both endpoints | mid | slow, large |
| Silhouette | pinned near the cool endpoint, high saturation | high | directional travel |
| Jewelry | pinned near the warm endpoint, desaturated toward white | low | sparse, occasional |
| Organs | warm endpoint, biased gold regardless | high on hits | beat-locked punches |
| Identity | either endpoint, at full legibility | high but intermittent | deliberate, rare |

Patterns implement this by choosing the blend factor from `inView("…")` or
`fixtureType` instead of from a continuous spatial gradient — see
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §9.3. Because each
instrument is a named view, that table transcribes almost literally:

```javascript
export function render3D(index, x, y, z) {
  var blend = 0.5;               // palette position for this pixel
  var v     = 1.0;               // luminance for this pixel
  if      (inView("Hull Canvas")) { blend = sweep;  v = 0.6; }
  else if (inView("Silhouette"))  { blend = 0.0;    v = 1.0; }
  else if (inView("Jewelry"))     { blend = 1.0;    v = 0.25; }
  else if (inView("Organs"))      { blend = 1.0;    v = hit; }
  else if (inView("Identity"))    { blend = 1.0;    v = signLevel; }
  rgb((pr1 + (pr2 - pr1) * blend) * v,
      (pg1 + (pg2 - pg1) * blend) * v,
      (pb1 + (pb2 - pb1) * blend) * v);
}
```

The five views are mutually exclusive and together cover all 964 pixels, so an
`if / else if` chain like this leaves nothing unlit and nothing double-assigned.

---

## 8. Using this when tuning

- When tuning playlists and patterns, check every look against: *what does this
  hue do on bold yellow? on dark paint? does it exist at all on an RGBW
  instrument?*
- Palette smoke test per look:
  1. Stacks still gold, or deliberately ember-red?
  2. Any pure-blue wash landing on stained wood?
  3. Are the saturated cool hues carried by direct-view fixtures rather than by
     wash?
  4. Is the UV or amber content on an instrument that actually has those
     emitters?
  5. Are the TE signs punctuating, or competing?
- Related docs:
  [`36_color_palette_live_transitions.md`](36_color_palette_live_transitions.md),
  [`40_autopilot_improvements.md`](40_autopilot_improvements.md),
  [`41_audio_reactive_tuning.md`](41_audio_reactive_tuning.md),
  [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md).

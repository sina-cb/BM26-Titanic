# 20260725_77 — Per-fixture local halo scale: base × global × local

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (halo recipe + fixture runtimes + GUI)
**Order (operator, 2026-07-30, resolving readiness item 24):**
*"Each fixture having a local override sounds good for the halo, but an overall
global halo too would be nice — local is maybe a scale for the global?"*
**Emphasis, same day:** *"LED fixtures, DMX fixtures are both fixtures, keep that
in mind please."*

## TL;DR — the three-factor model

```
effective halo = (class base) × Global Halo Size × local haloScale
```

| factor | where it lives | LED bus | DMX bus |
|---|---|---|---|
| **class base** | the fixture's own recipe | `params.ledHaloSize` — an absolute radius | the DRAWN bulb × `dmxHaloRimMultiple` — a rim |
| **global** | `params.globalHaloScale`, "Global Halo Size" | ✔ | ✔ |
| **local** | `config.haloScale`, "Halo ×" on the fixture | ✔ | ✔ |

Item 24 is resolved by **this design, not by merging the two existing knobs**.
Their roles are unchanged: **Global Halo Size** stays the one scene-wide knob
(`_75`), and the LED folder's **Halo Size** stays the LED-bus *base* radius that
the global one multiplies. The local scale is a third, per-fixture factor on top.

Live-verified in his running sim — a local scale of 2 doubles the drawn halo on
**every** class:

| class | local 1 → 2 |
|---|---|
| UKing par | 0.47128 → 0.94255 |
| TE Sign V3 A / B | 0.196 → 0.392 |
| Shehds bar | 0.03498 → 0.06996 |
| Vintage LED | 0.11925 → 0.23850 |
| LED strand | 0.196 → 0.392 |

(Guards clean: **0 sACN-OUT enables, 0 save-server requests**, every touched
config key restored — including deleting keys that were never there.)

## "Both are fixtures" — one property, one name, both panels

The operator's emphasis is the design constraint, and it is met literally:

- **one property name** — `haloScale`, on the fixture config, for every bus;
- **one persistence shape** — a plain number on the same config object the scene
  serializer already writes for `brightness`, `angle`, `diffusionAmount`;
- **one resolver** — `resolveLocalHaloScale()` in `led_halo.js`, the module that
  already owns the single halo recipe shared by both buses;
- **one UI affordance** — a compact **`Halo ×`** slider, `0.1 – 10`, step 0.05.

It appears in **both** places fixtures are edited today, with identical
semantics:

| panel | covers | note |
|---|---|---|
| the per-fixture folder in the DMX/par list | pars, bars, vintage **and the LED-bus panels/signs** | LED-bus fixtures (TE Sign, TE LED Grid) already live in `parLights` and are built by `DmxFixtureRuntime`, so this one panel serves both buses — the same folder that already carries the LED-only Diffusion/Screen controls |
| the per-strand folder in the LED strand list | LED strands | strands are a separate list with a separate runtime class; the field is added there with the same name, range and meaning |

**Group / bulk set** comes for free on the DMX-list side: the field routes
through the existing `propagateToSelected(index, 'haloScale', v)`, the same
mechanism every other numeric property in that panel uses, so editing `Halo ×`
with a multi-selection sets it across the selection. **No new group machinery
was built**, per the brief.

**The one class with no halo, stated rather than silently omitted:** fog / haze
machines (`TEFogMachine`, `ChauvetHaze4D`) are built by `FogMachine`, which
renders no emitter and no halo in any profile. They still show the `Halo ×`
field, because the whole point of the emphasis is that the fixture property is
uniform — but on those two types it is inert. If the operator would rather it be
hidden there, that is a one-line change; it is flagged, not decided silently.

## Defaults: absent and 1.0 are a perfect no-op

`resolveLocalHaloScale(config)` returns **1.0** when `haloScale` is absent or
null — a DEFINED default so every scene written before this property existed
renders **byte-identically**. There is a test that builds one fixture of every
registered class twice, once with no `haloScale` key and once with an explicit
`1`, and asserts the drawn halo radii are equal to the bit.

lil-gui needs a property to bind to, so opening a fixture folder seeds
`haloScale = 1` on that config — exactly as the existing `diffusionAmount` /
`screenPixelSize` / `scaleX` controls already do. Seeding changes no pixel (1.0
is the identity) and does not trigger autosave; it reaches disk only on the
operator's next save, through the normal mutate → dirty → save flow. **No scene
file was written by this work.**

## Validation: loud, and nothing is silently clamped

- **Absent / null** → 1.0 (the defined default above).
- **Present but not a positive finite number** → **throws**, naming the fixture:
  `resolveLocalHaloScale: 'Left Front Rails 1' has haloScale -2 — a local halo
  scale must be a positive finite number (the UI range is 0.1–10). Refusing to
  draw a guessed size.` A broken hand-edited scene fails loudly rather than
  quietly drawing the wrong size (codex P0).
- **Range**: the UI slider bounds input to **0.1 – 10**
  (`LOCAL_HALO_SCALE_MIN/MAX`). The resolver does **not** clamp — it accepts any
  positive finite number and refuses garbage. So there is **no silent clamping
  anywhere in this feature**; the only bound applied to a *result* is the halo
  pitch ceiling below, which is a documented physical guard, not a range clamp.

## Cap behaviour: the ceiling runs AFTER the local multiplier

For DMX fixtures the composition is
`clampHaloRadiusToPitch(drawnBulb × rim(global) × local, pitch)` — the local
factor multiplies *first*, then the ceiling from `_75`
(`MAX_HALO_PITCH_MULTIPLE = 1.5 × pitch`) applies. A local override can widen a
rim but **cannot reopen the smear hole** on a dense fixture. Tested at the top of
the UI range: at `Halo × 10` both multi-pixel DMX classes sit exactly *at* their
ceiling and not past it —

| fixture | pitch | ceiling | halo at `Halo × 10` |
|---|---|---|---|
| Shehds bar (18 px) | 0.055 | 0.0825 | 0.0825 (pinned) |
| Vintage LED (6 px) | 0.1875 | 0.28125 | 0.28125 (pinned) |

The cap does **not** swallow the control at useful settings: at his own Global
Halo Size 1.4, a `Halo × 1.3` on the vintage light still moves the drawn radius
(tested), and the live sweep above shows `Halo × 2` landing well under both
ceilings. Single-pixel fixtures (the pars) have no neighbour, therefore no
ceiling, and are exactly linear in the local factor at every setting.

**Deliberate deviation from the brief, flagged:** the brief said "both still
bounded by your new halo pitch ceiling". I did **not** add a pitch ceiling to the
LED bus, because LED-bus halos have never had one and that is by design — a
sign's halos are *meant* to merge into one luminous sheet (`led_halo.js`), `_49`'s
parity suite pins the LED-bus halo to exactly `ledHaloRadius()`, and clamping it
would silently regress `_75`'s verified behaviour (the TE Sign's 0.7 halo at
Global Halo Size 5 would be cut to 0.25). The smear guard exists on the bus that
has opaque cores to protect. Say the word if you want a ceiling on the LED bus
too — it is one line, but it is a look change, so it is not done unasked.

## Live update, per class

The local scale is re-read on every rebuild, so both existing live entry points
carry it with no fixture rebuild:

- **DMX + LED-bus** — the GUI writes `config.haloScale` then calls
  `syncLightFromConfig(index)` → `fixture.syncFromConfig()`. `syncFromConfig`
  now also refreshes the bulb/halo instance matrices. It already refreshed the
  *cone* matrices (via `updateVisualsFromHitbox`) but not the emitter radii —
  that asymmetry is exactly why a config-driven halo would otherwise have sat in
  the config and never reached the screen. It is a discrete edit path only (the
  drag handlers call `updateVisualsFromHitbox` directly), so this adds **no
  per-frame work**. It also makes the group propagation work for free, since
  `propagateToSelected` drives the same call.
- **Strands** — `applyVisualSize()`, the same entry point the global halo knob
  uses since `_75`.

## Tests

New `simulation/tests/local_halo_scale.test.js` (**+10**):

- **NO-OP** — absent vs explicit `1` is byte-identical on every registered class,
  and the halo property never moves the bulb;
- **resolver** — absent/null → 1, a YAML-quoted `'3'` → 3, and `0 / -1 / NaN /
  Infinity / 'wide' / {}` all throw with the fixture name in the message;
- **COMPOSITION (all buses)** — a local scale moves the halo, upward, on every
  class, and moves nothing else;
- **COMPOSITION (DMX)** — exactly `drawnBulb × dmxHaloRimMultiple(global) ×
  local` at local 0.5 / 1 / 3;
- **COMPOSITION (LED bus + strand)** — exactly `ledHaloRadius(global) × local`,
  and the sign and the strand land on the *same* number (one shared LED recipe);
- **independence** — global and local multiply across three global values;
- **CEILING** — at `Halo × 10` the bar and the vintage are at, and never past,
  `pitch × MAX_HALO_PITCH_MULTIPLE`, on every pixel;
- **cap does not swallow the control** — `Halo × 1.3` on the vintage is visible;
- **LIVE** — writing `config.haloScale` and calling the real entry point
  (`syncFromConfig` / `applyVisualSize`) changes the drawn radius on every class;
- **PERSISTENCE** — round-trips through YAML **in memory** (no scene written) and
  a fixture rebuilt from the deserialized config draws the same halo, for both a
  DMX fixture and a strand.

**Suite: 1298 / 1289 / 9.** My contribution is **+10 tests, all passing, zero new
failures**. The baseline moved under me because **`_76` landed concurrently**
(+51 tests and one failure of its own — *"every excluded orphan group is STILL an
orphan (untraced) in the scene"* in `tests/pixel_map_view_defaults.test.js`,
which contains no halo code and is untouched by this work). The 8 long-standing
stale-model / scene-parity failures are unchanged. `node --check` clean on every
touched file. No Edit conflicts with `_76`: this diff touches the per-fixture
*property* region of `gui_builder.js` and the per-strand folder, not the
fixture-list regions.

## What the operator does

1. Open any fixture in the **DMX Light Fixtures** list — pars, bars, vintage, and
   the TE Sign panels alike — and you will find **`Halo ×`** alongside
   Brightness / Intensity / Angle. Default 1.0 = exactly what you see today.
   Drag it and that fixture's halo responds immediately.
2. With several fixtures selected, editing `Halo ×` on one sets it across the
   selection, like every other numeric field in that panel.
3. Open any strand in the **LED Strands** list — same **`Halo ×`** field, same
   meaning.
4. **Global Halo Size** still scales everything at once; the LED folder's **Halo
   Size** is still the LED-bus base radius. Local multiplies on top of both.
5. The values persist on your next scene save — nothing was saved by me.

Fog/haze machines show the field but have no halo to scale; say the word if you
want it hidden for those two types.

## Files

- `simulation/src/fixtures/led_halo.js` (`resolveLocalHaloScale`, `LOCAL_HALO_SCALE_MIN/MAX`)
- `simulation/src/fixtures/dmx_fixture_runtime.js` (composition + `syncFromConfig` refresh)
- `simulation/src/fixtures/led_strand.js` (composition)
- `simulation/src/gui/gui_builder.js` (both `Halo ×` fields)
- `simulation/tests/local_halo_scale.test.js` (new)
- `simulation/agent_tools/halo_reach_probe.cjs` (extended with the local-scale phase)

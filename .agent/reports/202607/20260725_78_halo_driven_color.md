# 20260725_78 — The red par halos: measured, and it is not a colour bug

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (diagnosis + GUI labels only)
**Order (operator, 2026-07-30, after his hard reload):** "great progress" — LED
strings good, TE sign good, then: *"there's an extra halo around the par lights
that are red, but those pars are mapped patched and are good"*, and shortly
after: *"the red halo around the par in the auditorium which is patched still
exists."* Plus, on Bug 2: *"sorry, I was using the LED halo size, not the global
one in options."*

## TL;DR

**The proposed mechanism is disproved.** The hypothesis was that the driven
per-frame colour path writes `instanceColor` on the BULB mesh only, leaving the
HALO stuck at its construction colour. A readonly-guarded probe of his running
sim read both buffers for **all 40 UkingPars at the same instant**:

> **MISMATCH: bulb colour ≠ halo colour → *none* — every par's halo carries the
> same colour as its bulb.**

`_writePixelColor` writes bulb, halo **and** cone in one call, so the two cannot
diverge. There is no colour-propagation defect, on any class.

**The red is real, and it has two legitimate sources.** Measured, per fixture:

| fixture set | patch | bulb | halo | source of the colour |
|---|---|---|---|---|
| Right SmokeStacks 1–8 (the roof-edge row in his screenshot) | **UNPATCHED** | `#730000` | `#730000` | `paintUndrivenEntry` → `entry.apply(1, 0, 0)` |
| Left Auditorium 1–8 (his second witness) | **U6 / U8, patched** | `#0b0500` | `#0b0500` | its own live frame |

- The roof row is **unpatched**, and in `sacn_in` mode every undriven entry is
  painted **pure red** by `sacn_mapper.paintUndrivenEntry`. `#730000` is exactly
  `(1, 0, 0)` × the sim-brightness preview scale (0.451) — an exact numeric
  match, so the source is named, not guessed. That red is an **explicit operator
  ruling**, recorded in the code: *"operator decision 2026-06-12: red, not
  black"*.
- The auditorium par is **patched and driven**. Its live frame at probe time was
  `[100, 63, 27, 0, …]` — dimmer 100, **R 63, G 27, B 0**. That is a dim
  orange-red, and `#0b0500` is exactly what that frame produces. The fixture is
  showing the colour the engine is sending it.

**What actually changed is halo GEOMETRY, not colour.** Before `_73` a par's
halo was `physicalBulb × 1.8 × haloScale` against a bulb of
`physicalBulb × modelScale × pixelScale` — at his settings **0.98× its own
bulb**, i.e. entirely buried inside the can and invisible every frame. `_73` made
it a rim multiple of the drawn bulb and `_75` removed the ceiling that pinned it,
so at his Global Halo Size 1.4 it is now **2.12×** the bulb — measured
`rBulb 0.2223 / rHalo 0.4713`, against a 0.225 housing radius.

So the halo now extends **more than twice the housing radius**, while the opaque
bulb sits at almost exactly the housing silhouette. The red was always being
painted; the ring is new because the rim finally reaches outside the can. That is
the whole of Bug 1.

## Why it reads as "black housing + red ring"

Two layers, same colour, different materials:

| layer | material | at colour `#730000` |
|---|---|---|
| bulb | opaque `MeshBasicMaterial`, `depthTest:false`, r ≈ housing radius | a dark disc that reads as the **housing** |
| halo | **additive**, `BackSide`, opacity 0.2, r = 2.12× the bulb | a coloured **glow** on the night sky |

An additive rim over a black background *adds* colour and reads as light; an
opaque core *replaces* the background with a dark value and reads as body. Same
number, opposite perception. Nothing in the pipeline is inconsistent — the eye is
comparing a lit rim against a dark body.

## The one thing that is genuinely inconsistent (operator decision needed — NOT changed)

There are **two** "this fixture is unmapped" indicators and they disagree about
whose toggle they answer to:

| indicator | what it paints | gated by `Show Unpatched (Red)`? |
|---|---|---|
| `_applyUnpatchedRedOverlay` (animate.js) | the fixture **shell** tint | **yes** |
| the scene-wide dot flush (animate.js) | the pixel **dot** | **yes** |
| `paintUndrivenEntry` (sacn_mapper.js) | the fixture's **bulb + halo** | **no** |

His `showUnpatchedRed` is **false** right now (probe: `showUnpatchedRed=false`,
and shells read `#111111`, untinted) — yet his unpatched pars still glow red,
because the third indicator ignores that switch.

**I did not change this.** The red-not-black behaviour is an explicit operator
decision from 2026-06-12 with a stated rationale (a skipped entry used to freeze
whatever the local pattern last painted, producing lit "bleeding" pixels that
ignored the engine's fader — report 2026-06-11). Silently gating it would undo a
ruling and could resurrect that bug. Per the brief — *"no code change for
whatever turns out to be by-design — report it plainly instead"* — here is the
choice, for him to make:

- **(A) leave as is** — unpatched fixtures scream red in `sacn_in` mode
  regardless of the toggle. Now conspicuous because the halo grew.
- **(B) gate it on `showUnpatchedRed`** so all three indicators obey one switch;
  undriven entries go black when it is off (the same thing the dot flush already
  does).
- **(C) keep the red on the bulb, drop it from the halo** — the indicator stays
  loud but stops throwing a metre-wide glow.

A one-line change either way; say which.

## Bug 2 — closed by the operator himself

*"sorry, I was using the LED halo size, not the global one in options."* He was
dragging the LED-bus **base radius**, which DMX fixtures ignore **by design**
(`_77`'s three-factor model: a DMX halo is a rim around its own bulb, not an
absolute LED radius). **No DMX reach defect exists** — `_75`'s liveness tests
stand, and the same probe re-confirmed all six classes moving under Global Halo
Size in the `full` profile he runs.

That pair of names has now cost two debugging rounds in one day, which was
already flagged as readiness item 24. **Label/tooltip hardening only — no
behaviour change:**

| before | after |
|---|---|
| `Pixel Size` (LED Strands panel) | **`LED Pixel Size (LED only)`** |
| `Halo Size` (LED Strands panel) | **`LED Halo Base (LED only)`** |

…plus hover tooltips stating reach on all four halo/size controls, including the
two auto-built ones (`Global Halo Size`, `Global Pixel Size`). The global halo
tooltip spells out the model: *"ALL fixtures … Effective halo = (class base) ×
THIS × the fixture's own Halo ×. Not to be confused with 'LED Halo Base' in the
LED Strands panel."* Tooltips for the auto-built controls are defined in code
(`CONTROL_SCOPE_TOOLTIPS` in `gui_builder.js`) because `scenes/common.yaml` is
operator-owned and was not written.

I considered merging the two knobs and did not: they are genuinely different
quantities (an absolute LED radius vs a rim multiplier), and `_77`'s three-factor
model depends on both. Naming was the actual defect.

## Method

`simulation/agent_tools/halo_color_probe.cjs` (new) dumps, per UkingPar: patch,
config colour, shell material, bulb / halo / cone `instanceColor`, drawn radii,
and the live DMX frame bytes it is being driven by — every layer that can paint
at that spot, so the red one is *named*. Guards are the established set
(`__readonlyMode` accessor before any page script, `:6972` refused at the
`WebSocket` constructor, save-server requests counted, and this one is strictly
read-only — no param, config or matrix is written). Result: **0 sACN-OUT
enables, 0 save-server requests.** Both witness sets — the roof-edge SmokeStacks
row from the screenshot *and* the patched Left Auditorium pars he named second —
were in the same pass, and they reproduce identically: halo colour ≡ bulb colour
in both.

## Tests

New `simulation/tests/halo_driven_color.test.js` (**+5**) — pinning the invariant
that made the diagnosis possible, so the ruled-out mechanism can never quietly
become true:

- **DRIVEN, per class** — a dim red-dominant frame (his auditorium par's actual
  content: dimmer 100 / R 63 / G 27 / B 0) leaves bulb and halo `instanceColor`
  identical on **every** pixel of **every** registered class;
- **every colour entry point** — `setColor`, `setBulbColor`, `setPixelColorRGB`
  keep the two layers in lockstep (and the colour demonstrably changes between
  them, so the check isn't vacuous);
- **unpatched treatment consistency** — the exact undriven-red paint `(1,0,0)`
  reaches BOTH layers as pure red; the indicator can never paint half a fixture;
- **PERF P0** — 50 recolours add no scene-graph objects and reuse both
  materials; the halo stays one `InstancedMesh` ("High FPS is a must");
- **halo material stays white** — a tinted halo material would multiply into
  every instance and silently decouple the rim from its bulb, which is exactly
  the failure mode ruled out here.

**Suite: 1316 / 1307 / 9.** My contribution is **+5 tests, all passing, zero new
failures.** The 9th failure is **not mine and not `_76`'s code** — it is `_76`'s
scene-data-driven test failing on the operator's own edit:
`'Left Center Auditorium' no longer exists in the scene at all — drop it from
ORPHAN_GROUPS`. He deleted the Left Center Auditorium ghosts (**readiness waiting
item 4 — done**) and saved; the test's `ORPHAN_GROUPS` list now names a group
that is gone. It needs a one-line list update in `_76`'s file, which I have not
touched. `node --check` clean on every touched file.

## What he sees after ONE more reload

**Nothing about the red changes** — that is the honest answer, and deliberately
so: the colours are correct, and the only red he can switch off is behind a
decision he needs to make (A/B/C above). What he *will* see is the LED Strands
panel now reading **"LED Pixel Size (LED only)"** and **"LED Halo Base (LED
only)"**, with hover text on those and on Global Halo/Pixel Size stating exactly
which fixtures each one reaches.

If he wants the roof row to stop glowing red **today**, without any code
decision, there are already two knobs that do it: set those unpatched pars'
per-fixture **`Halo ×`** (`_77`) down — the field is on each fixture, and it
bulk-sets across a multi-selection — or patch them, at which point they stop
being undriven and take their real colour.

## Files

- `simulation/src/gui/gui_builder.js` (labels + scope tooltips only — no behaviour change)
- `simulation/tests/halo_driven_color.test.js` (new)
- `simulation/agent_tools/halo_color_probe.cjs` (new)

No fixture-runtime, halo-recipe, or sACN code was changed by this report.

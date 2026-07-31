# 20260725_81 — The red leaves the beauty view: undriven-red obeys its toggle, trace dots leave `full`/`emissive`

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/`
**Order (operator, third complaint on the same thing):** *"the par lights still
have the halo red shit! and it's the Left Auditorium I am looking at now."*

Read as the RULING on both pending decision items: `_78`'s item 26 (undriven-red
vs the "Show Unpatched (Red)" toggle) and `_79`'s trace-dots-in-beauty-profiles
decision. Both are now resolved — **behind the switches he already owns**, with
the 2026-06-12 red diagnostic intact.

## TL;DR — what he was actually looking at

A readonly-guarded probe of his running sim, measured per fixture, found **all
three** candidate sources live at once in that one view — and, crucially, a
fourth thing neither `_78` nor `_79` saw on its own: **the trace dot was
manufacturing the RING SHAPE around a genuinely red par.**

| what he sees | fixture | source | measured |
|---|---|---|---|
| red RING around a dark/green core | **Left Auditorium 1–8** — all **PATCHED** (U8:1/11/21/31, U6:1/11/21/31) | **the pattern**: live frame `[dimmer 100, R 47, G 0, B 0]`, pure red | bulb ≡ halo `#080000`; entry `(0.184, 0, 0)`, `undriven=false` |
| solid red glow | **Right Auditorium 1–8** (same view, the row beside it) — **UNPATCHED** | `paintUndrivenEntry`'s undriven-red | bulb ≡ halo `#730000` = `(1,0,0) ×` sim-brightness 0.451, exact |
| the ring GEOMETRY itself | **both rows** | a trace generator preview dot sitting on every par, distance **0.000–0.001** | opaque `r = 0.3` vs bulb `r = 0.2223`, halo `r = 0.4713` |

**The mechanism, finally complete.** A par's opaque bulb draws at 0.2223 and the
trace preview dot at **0.3 — 1.35× the bulb, dead-centre on it**. The dot covers
the bulb completely. What is left visible of the fixture is the additive halo
from 0.3 out to 0.4713: **an annulus**. So a par driven pure red rendered as a
red ring around an opaque mint-green disk — literally "a halo red ring, and the
par itself isn't red". `_78` proved the colour path correct and `_79` proved the
dots were impostors; neither noticed the two combine into exactly the shape he
kept reporting. That is why "not a render bug" never satisfied him, and he was
right to keep pushing.

**Honest part, and it does not change:** the Left Auditorium pars are patched,
driven, and the frame is red. **After this change those eight pars will still
glow red-orange, because that is the light the pattern is sending them.** Their
ring will become a normal glowing disc (the dot stops covering the bulb), and
the unpatched row beside them stops glowing entirely — but the red on the LEFT
row is show content, not a rendering artefact, and nothing here hides it.

## Gate 1 — `paintUndrivenEntry` now obeys "Show Unpatched (Red)" (item 26)

There were three "this fixture is unmapped" indicators and only two answered the
switch (`_78`'s table). The third now does:

| indicator | paints | obeys the toggle |
|---|---|---|
| `_applyUnpatchedRedOverlay` (animate.js) | fixture **shell** tint | yes (always did) |
| the instanced-dot flush (animate.js) | the pixel **dot** | yes (always did) |
| `paintUndrivenEntry` (sacn_mapper.js) | the fixture's **bulb + halo + cone** | **yes — new** |

- Toggle **OFF** (his setting) ⇒ undriven entries are painted **black**.
- Toggle **ON** ⇒ **bright red, byte-identical to before** — the 2026-06-12
  ruling is not deleted, it is behind the switch that was already named after it.
- **Anti-bleed (2026-06-11) is untouched**: an undriven entry is still actively
  *repainted* every frame its treatment changes and still carries
  `_sacnUndriven`, so it can never freeze at whatever the local pattern last
  painted. The toggle chooses *which* repaint, never *whether*.
- `demapSacnToPixels(list, router, showUnpatchedRed)` **throws** if the third
  argument is not a boolean. The treatment of an unmapped fixture is an operator
  setting; a caller that forgets to wire it must fail loudly, not pick a colour
  on his behalf.
- **Live flip, no reload**: `_sacnUndrivenRed` records which treatment is
  currently painted, so the steady-state fast path stays free (one `apply` per
  change, not per frame) *and* a mid-session flip repaints on the very next
  frame.

## Gate 2 — trace/generator visuals leave the beauty profiles by default (`_79`)

New single gate, `simulation/src/gui/trace_visual_gate.js`, asked by every
caller that used to compute visibility itself:

1. Par lights off → off (pre-existing coupling, unchanged).
2. `Show Generators` off → off. The toggle always wins when it says no.
3. The operator has moved `Show Generators` himself this session → **on, in
   every profile**. An explicit choice outranks the default.
4. Otherwise → on in the working profiles (`edit`, `pixel_mapping`,
   `2d_pixels`), **off in the beauty profiles (`emissive`, `full`)**.

`emissive`/`full` are now flagged `beauty: true` in `profile_registry.js` with
an `isBeautyProfile()` accessor, so a profile added later has to be classified
deliberately instead of silently inheriting authoring furniture into the show
view (a test pins that).

Notes on scope:
- **Edit-class profiles are unchanged.** Nothing about authoring moved.
- **⛓ Show Chain Order keeps its existing subordinate design** — the overlay
  rides on the trace group's own visibility (one gate, `_38`'s contract), so in
  a beauty profile it returns together with `Show Generators`. Its own switch
  still works exactly as before.
- The "he chose it himself" mark is set on the **control**, not in the handler,
  because `window.applyAllHandlers` replays every handler on undo/redo and must
  not forge a choice he never made. It is runtime-only (like `focusOnSelect` and
  `chainOrderVisible`) and never reaches a scene file. **`scenes/common.yaml`
  was not touched** — it is operator-owned; `generatorsVisible` still ships
  `true` and still means "on" everywhere he authors.
- **Picking follows visibility.** Raycasts against an explicit object array skip
  Three.js's own visibility check, so `interaction.js` now also drops any trace
  object that is invisible in the scene graph — otherwise a hidden preview dot
  would still swallow clicks meant for a fixture underneath it.

## Live verification — in his own running stack, both gates and both toggles

Same readonly-guarded convention as `_78`/`_79`: `?readonly=1`, `__readonlyMode`
pinned true by accessor before any page script, `:6972` refused at the
`WebSocket` constructor, `:6970` intercepted with non-GET aborted, no save, no
device HTTP, no server restart, contention banner tolerated, sessions closed
promptly. Never his window — a throwaway page each time.

**Before → after, same fixtures, same settings** (profile `full`, `sacn_in`,
Global Halo Size 1.4, `showUnpatchedRed=false`, `generatorsVisible=true`):

| measurement | before | after |
|---|---|---|
| trace visuals drawn in `full` | **114 / 114** | **0 / 114** |
| Right Auditorium 1–8 (unpatched) bulb ≡ halo | `#730000` | `#000000` |
| Right Auditorium entries | `(1, 0, 0)`, `undriven=true` | `(0, 0, 0)`, `undriven=true` (still marked — no bleed) |
| Left Auditorium 1–8 (patched) | driven red, `undriven=false` | driven red, `undriven=false` — **untouched** |

**The toggles still work, live, with no reload** (flipped in a throwaway page,
every param restored to the value it was read at):

| step | result |
|---|---|
| `Show Unpatched (Red)` → ON | Right Auditorium bulb **and** halo return to `#730000` — the diagnostic is intact |
| → back OFF | `#000000` again |
| `Show Generators` → ON in `full` | trace visuals **114 / 114** — explicit choice beats the beauty default |
| → OFF | **0 / 114** |
| restore | `showUnpatchedRed` false → false, `generatorsVisible` true → true, choice cleared |

Guard totals across all four sessions: **0 sACN-OUT enables, 0 save-server
requests, 0 aborted writes needed, params restored exact.** Left Auditorium
frames changed between passes (R 47 → R 5) with the fixtures animating — the
measurements are of a live, moving show, not a frozen one.

Incidental, **not mine and not touched**: every plain scene load marks the scene
dirty during GUI construction (`generateGroupFromTrace` → `debounceAutoSave`
inside `buildParLightsSection`), so the `● UNSAVED CHANGES` chip is up before
anyone edits anything. Pre-existing; recorded here because it was ruled out as a
side effect of this work, not because it was fixed.

## Tests

**Suite: 1353 / 1345 / 8** — **+18 tests, all passing, zero new failures.** The
8 are the known stale-model / scene-data failures only (unchanged all day).
`node --check` clean on every touched file.

- `tests/sacn_mapper.test.js` (**+7**, rewritten around the two now-separate
  rules): no-bleed under *both* treatments; black-when-off is actively painted,
  not skipped; both treatments equally cheap in steady state; the OFF→ON→OFF
  flip produces exactly one repaint each, in order; a caller that omits or
  mistypes the toggle throws; a genuinely red driven frame survives the gate
  (the Left Auditorium's real bytes); regaining a patch clears both marks.
- `tests/halo_driven_color.test.js` (**+3**, extending `_78` rather than
  weakening it — its five originals are unchanged): the demap wired to a real
  fixture through the same `entry.apply` closure the render list uses, asserting
  the actual InstancedMesh buffers. OFF ⇒ **bulb, halo and the dot-layer decode
  all dark**, every class; ON ⇒ pure red on all three, every class; a live flip
  moves the **halo**, not just the bulb.
- `tests/trace_visual_gate.test.js` (**+8**, new): every profile classified and
  only the two beauty views are beauty; default off in beauty / on in every
  working profile; an explicit `Show Generators` ON overrides the default; OFF
  wins everywhere regardless; the par master outranks everything; an unset
  `generatorsVisible` behaves as the shipped `true`; the gate throws rather than
  guess with no params.

## What he sees after ONE reload

1. **The unpatched pars stop glowing.** Right Auditorium and the roof-edge
   SmokeStacks row go dark instead of red — because his "Show Unpatched (Red)"
   is off. Turning it on brings the red back, exactly as before, instantly.
2. **The dots and handles are gone from the beauty view.** No mint-green disks
   over bar mid-sections, no amber spheres on the vintage heads, no ring around
   a par housing. `📐 Group Generator → Show Generators` brings them back in any
   profile whenever he wants them, and `edit` / `pixel_mapping` are unchanged.
3. **The Left Auditorium pars still glow red-orange.** They are patched, driven,
   and the frame is red — that is the pattern, not the renderer. What changes is
   the shape: a glowing disc with a rim, instead of a red ring around a green
   dot. If that red is wrong, it is a pattern/engine question, not a sim one.

## Files

- `simulation/src/dmx/sacn_mapper.js` — undriven treatment takes the toggle
- `simulation/src/core/animate.js` — passes it, read fresh every frame
- `simulation/src/core/profile_registry.js` — `beauty` flag + `isBeautyProfile()`
- `simulation/src/gui/trace_visual_gate.js` (new) — the one gate
- `simulation/src/gui/gui_builder.js` — every visibility call routed through it,
  profile change re-asks, `Show Generators` tooltip
- `simulation/src/core/interaction.js` — invisible trace objects are not pickable
- `simulation/tests/{sacn_mapper,halo_driven_color,trace_visual_gate}.test.js`
- `simulation/agent_tools/chain_order_viz_verify.cjs` — it runs in `full` and
  asserts on the chain overlay, so it now replays the operator's explicit
  "Show Generators" choice at setup and restores it with the rest of the
  pristine state. Left alone: the other generator verifiers assert on object
  identity/transforms rather than visibility, which the gate does not change.

No `scenes/**`, no `marsin_engine/**`, no `common.yaml`, no git operations, no
saves, no device HTTP, no server restarts. Probe scripts and JSON/PNG evidence
live in `~/tmp/left_aud_red/` (gitignored).

# 20260725_82 — The leak was real: unpatched fixtures were eating 60% of the analytic light pool

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/`
**Order (operator, immediately after `_81`):** *"a big leak — the par light halos
on the right side are being mapped, but they are not patched, please fix!"*

## TL;DR

He was right, the word "mapped" was literal, and it was not a colour bug.

**Nothing unpatched is lit** — a full-scene probe of his running sim checked all
80 fixtures on both buses across every layer that can carry light (bulb, halo,
cone `instanceColor`, per-pixel `p.color`, the LED sprite halo material, the
shell tint): **42 unpatched fixtures, 0 lit on any layer.** `_81`'s gate holds.

**But 36 of the 60 active analytic SpotLight slots — 60% of the budget — were
held by those unpatched, pure-black right-side fixtures.** They were being
*mapped into the light pool* while emitting nothing, and they were evicting the
patched left-side fixtures that were actually being driven.

| active pool slots | before | after |
|---|---|---|
| total active | 60 | 60 |
| **emitting nothing (colour `#000000`)** | **36** | **0** |
| **owned by an UNPATCHED fixture** | **36** | **0** |
| owned by a PATCHED, emitting fixture | 24 | **60** |

Before, by owner: Right Front Wall 8, Right Back Wall 8, TE Sign 6, TE Sign 2 6,
Right Front Rails 3, Right Back Rails 3, Right SmokeStacks 2 — **all unpatched,
all `#000000`, all on the right side**. After: Left Front Wall 24, Left Back Wall
21, Left Front Rails 5, Left Back Rails 5, Left Auditorium 2, Left SmokeStack 2,
Left Small SmokeStack 1 — every slot on a patched fixture that is emitting, with
live colours like `#757000`.

## Why it was the RIGHT side, and why it looked like "halos"

The pool is a **fixed, GPU-bounded** set of slots handed each frame to the pixels
**closest to camera**. Every unpatched fixture in this scene is on the right
(`Right Front/Back Wall`, `Right Front/Back Rails`, `Right SmokeStacks`,
`Right Small SmokeStack`, `Right Auditorium`, both TE Signs — 42 of 80), and the
camera is on that side. So the nearest-pixel rule handed them the majority of the
analytic budget by construction, and the pool never asked whether a winning pixel
was emitting anything.

In the `full` profile the analytic SpotLight is what casts a fixture's visible
pool of light on the hull and ground — the thing being called a "halo" here, far
larger than the halo mesh itself. So the symptom was: right-side fixtures with no
patch occupying the light budget, and the patched side barely lighting the ship.

**It also retro-explains the whole red-halo saga.** Before `_81`, undriven
fixtures were painted `(1, 0, 0)`, so those same 36 slots held *red* spotlights
at unpatched right-side fixtures — casting red light pools around fixtures that
were not patched. That is a red "halo" no halo knob could touch, which is exactly
what he kept reporting and what `_78`/`_79` were measuring one layer below.

## The fix

New `simulation/src/core/analytic_light_gate.js` — one rule, stated once:

```
emitsVisibleLight(color) → max(r, g, b) >= 1/255
```

`light_pool.js`'s `_collectLightRequests` now skips any pixel that fails it, on
both the per-pixel and per-fixture branches, and reports `skippedDark=N` in its
one-shot diagnostic.

Why this shape:

- **It is about EMISSION, not about patching.** A patched fixture at blackout
  wastes a slot exactly as much as an unpatched one; a group switched off does
  too. One rule covers all of them, and it cannot drift out of sync with the
  patch machinery because it never consults it.
- **It is visually identity-preserving.** A SpotLight contributes
  colour × intensity × falloff — a black one contributes exactly zero. Nothing
  that was visible before is missing now; the slot simply goes to a pixel that
  *is* emitting.
- **Nothing is sticky.** Requests are rebuilt every frame, so a pixel that
  lights up competes on distance again immediately, exactly as before.
- **The threshold is one 8-bit code value** — below that the preview quantises
  to `#000000`, so no visible light can be dropped.
- **The operator's diagnostic still wins.** With "Show Unpatched (Red)" ON,
  undriven fixtures are painted red (`_81`) — they are then genuinely emitting
  and take pool slots again, on purpose. His diagnostic stays as loud as he asked
  for it to be.
- A malformed colour **throws** rather than silently winning or losing a slot.

No double-painting, no patch-over: the leak is corrected where the requests are
built, not by muting lights afterwards.

## The hypotheses that were checked and are NOT the cause

Recorded so nobody re-runs them:

- **Cross-fixture index bleed (patched-LEFT data painting unpatched-RIGHT halo
  instances).** Not happening. `_writePixelColor` writes bulb, halo and cone from
  one call on a per-fixture `InstancedMesh`, and the live census shows every
  unpatched fixture black on every layer while its patched neighbours animate.
  Now pinned by test (below) so it can never start.
- **A later per-frame writer repainting halos after the gate.** The only
  candidates are `fixture.update()` (LED screen canvas only — it returns
  immediately for non-LED fixtures) and `updateVisualsFromHitbox()`, which
  repaints the config colour **only when nothing in the scene is patched**. With
  patches active it leaves the gated black alone. Pinned by test.
- **The prio-150 sACN-OUT writer** (`animate.js`) — it skips any fixture without
  a universe, an address and a controller IP, so an unpatched fixture is never
  in an output group.
- **`getSafeLightColor` falling back to `config.color`.** It substitutes only on
  a missing/NaN colour; black is finite and stays black. Not a fallback path
  here — though it is the kind of thing worth keeping an eye on.

## Add-on — "Show Unpatched (Red)" now appears in TWO places, with ONE value

Operator, mid-session: *"move that to the options as it affects the LEDs too"*,
then: *"actually don't move — clone it in the options too, but sync them to 1
value please, both places would be nice."* He went looking for the switch under
Lighting Control → ⚙️ Options and it was not there; it sat at the top of the
fixtures panel, which both hid it and implied it was DMX-only. It is not — it
governs the LED bus exactly as much as DMX.

Shipped as he revised it: the switch is now built in **both** places, by **one**
function.

| view | where |
|---|---|
| ⚙️ Options | Lighting Controls → ⚙️ Options — the scene-wide rendering options |
| fixtures panel | top of 🔌 DMX Fixtures, where it has always been |
| (third, pre-existing) | "Unpatched Highlight" button in the Controller Mapping panel |

**Divergence is impossible by construction, not by careful bookkeeping:**

- **One param, one persistence key.** Both controllers are bound to the same
  `params.showUnpatchedRed` — there is no mirror variable anywhere, so there is
  no second value that *could* disagree. His current OFF carries over untouched.
- **One builder.** `addUnpatchedRedControl(folder)` defines the name, the
  tooltip and the onChange once and is called twice, so the two views cannot
  drift in behaviour either.
- **Both `.listen()`.** The controller's own per-frame poll calls
  `updateDisplay()` the moment the value changes, whoever changed it — the same
  mechanism that already kept the Controller Mapping button in step. This is the
  existing two-views pattern in this GUI, not a new one.
- `_81` semantics and the instant repaint-on-flip are untouched.
- The Options view carries a tooltip stating the real scope: *"ALL fixtures, LED
  strands and DMX alike"*, and the Controller Mapping button's tooltip was
  updated to name both checkboxes.
- **`scenes/common.yaml` was not touched** — it is operator-owned, so the
  control is defined in code (same precedent as `CONTROL_SCOPE_TOOLTIPS`).

**Verified live in his running sim** (throwaway readonly session, 0 saves), by
clicking the real DOM inputs and reading what each control *displays*:

| step | param | view 1 (Options) | view 2 (fixtures) | Right Auditorium bulbs |
|---|---|---|---|---|
| baseline | `false` | shows off | shows off | `#000000` |
| clicked the **fixtures** view | `true` | **shows on** | shows on | `#730000` |
| clicked the **Options** view | `false` | shows off | **shows off** | `#000000` |
| restored | `false` | off | off | `#000000` |

Both controllers report `listening=true`, both are bound to the same `params`
object, and every view agreed with the param at every step. Found at
`🔦 Lighting Controls › 🔌 DMX Fixtures` and `🔦 Lighting Controls › ⚙️ Options`.

## Method

One readonly-guarded session per pass, never his window: `?readonly=1`,
`__readonlyMode` pinned true by accessor before any page script, `:6972` refused
at the `WebSocket` constructor, `:6970` intercepted with non-GET aborted and
counted, no save, no device HTTP, no server restart, closed promptly. Guard
totals across all passes: **0 sACN-OUT enables, 0 save-server requests, nothing
written to any param or config.** Environment read live: profile `full`, mode
`sacn_in`, patches active, `showUnpatchedRed=false`, `maxSpotlights=100`, pool
64 slots.

Probes and JSON/PNG evidence in `~/tmp/left_aud_red/` (gitignored):
`unpatched_leak_probe.cjs` (all 80 fixtures × every light-carrying layer),
`pool_owner_probe.cjs` (every active pool light mapped back to its nearest
fixture and that fixture's patch state).

## Tests

**Suite: 1366 / 1358 / 8** — **+13 tests, all passing, zero new failures.** The 8
are the known stale-model / scene-data ones, unchanged. `node --check` clean on
every touched file.

- `tests/analytic_light_gate.test.js` (**+6**, new): black never holds a slot;
  any single emitting channel does, including the Left Auditorium's real driven
  `0.18` red and the undriven-red diagnostic; the threshold is exactly `1/255`
  and one code value still lights while `0.9/255` does not; the rule is about
  emission, not patching (patched-at-blackout out, unpatched-but-red-diagnosed
  in); malformed colours throw; and the measured leak replayed as data — 36 dark
  right-side requests no longer evict 24 lit left-side ones.
- `tests/halo_driven_color.test.js` (**+2**): driving a patched fixture with the
  operator's real frame leaves an unpatched fixture in the SAME render list —
  ordered after it, the order a bleed would exploit — black on **bulb AND
  halo**; and the writer-ordering invariant, that `updateVisualsFromHitbox()`
  cannot repaint the config colour over a gated-black fixture while patches are
  active (with the converse asserted too, so the test is not vacuous).
- `tests/unpatched_red_two_views.test.js` (**+5**, new): one builder used in
  exactly two places; the param bound to a GUI control in exactly ONE source
  file and once inside it (a second binding is a second persistence key); both
  views `.listen()` and refresh the mapping panel; `listen()`'s poll really does
  redraw on any external change; and **no module holds its own copy** of the
  flag — a cached mirror is the only way two views could disagree. The controls
  are built inside `setupGUI`'s browser-only closure, so this is pinned by
  source contract, the tool `wheel_guard.test.js` and
  `rename_hygiene_wiring.test.js` already use for closure-bound wiring facts;
  the behaviour itself was verified by clicking both controls in his live GUI
  (table above).

## What he sees after ONE reload

**The ship is lit.** The patched left side now holds all 60 analytic slots
instead of 24, so its light actually reaches the hull and the ground — in the
capture, a broad amber pool where before there was a thin red wash. The pattern
was sending that amber the whole time; 60% of the sim's analytic budget was being
spent on fixtures with no patch and no light.

The right side stays dark, because it is still unpatched — that has not changed
and is not a rendering question. Turning "Show Unpatched (Red)" on still marks
every unpatched fixture in red, instantly, exactly as `_81` left it — and that
switch is now in **Lighting Controls → ⚙️ Options** as well as at the top of the
fixtures panel, one value behind both.

## Files

- `simulation/src/core/analytic_light_gate.js` (new) — the emission rule
- `simulation/src/core/light_pool.js` — requests obey it, `skippedDark` in the
  diagnostic line
- `simulation/src/gui/gui_builder.js` — `addUnpatchedRedControl`, built into
  ⚙️ Options and the fixtures panel
- `simulation/src/gui/controller_map_editor.js` — comment + tooltip now name
  both checkboxes (no behaviour change; it already wrote the same param)
- `simulation/tests/analytic_light_gate.test.js` (new)
- `simulation/tests/unpatched_red_two_views.test.js` (new)
- `simulation/tests/halo_driven_color.test.js` — bleed + writer-order pins

No `scenes/**`, no `marsin_engine/**`, no git operations, no saves, no device
HTTP, no server restarts.

# 20260725_4 — Why the TE Sign shows no patterns in test_bench (both drive paths)

**Author:** Debugger/Investigator agent · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-25
**Operator question (verbatim):** "why the TE sign in the test_bench scene not
showing patterns? even on pixelblaze lighting engine from the sim not from
marsin engine over sacn"

## TL;DR — one underlying cause, two symptoms

**The TE Sign V3 halves are the only unpatched fixtures in a scene that has
patches.** `test_bench` maps every other fixture to a controller
(`controllers.yaml`: Pars/Bars/Vintage/effects on U1–U2, LED_0/LED_1 on
U10/U12) but the TE Sign V3 A/B halves are in **no controller chain**, so their
patch is `universe 0 / address 0 / controllerIp ''`. That single data fact
kills both drive paths, each through deliberate (working-as-designed) code:

1. **In-sim pixelblaze engine:** with ≥1 fixture patched anywhere,
   `window._patchesActive === true` — and in that "mixed mode" the sim
   *deliberately* renders unpatched pixels **black** on the global dots and
   never direct-paints unpatched DMX fixture bulbs. The engine **does** compute
   pattern colors for all 74 TE-sign pixels every frame; every consumer then
   drops them.
2. **marsin_engine over sACN:** the exported engine model carries
   `patch: null` on all 74 TE-sign pixels, so the engine has no
   universe/address to transmit them on, and the sim's sACN-in demap has no
   address to read for them — it paints them with the solid-red
   "undriven" marker instead (that static red diamond IS the symptom the
   operator sees in sacn_in mode).

The titanic scene shows the sign fine because it is the opposite patch state:
**zero** fixtures patched (`_patchesActive === false`, report `20260724_40`),
so every entry direct-paints from the raw pattern color.

**The fix is scene data, not engine code: map the two TE Sign halves onto a
controller in test_bench** (details in Fix Plan). Do NOT "fix" the mixed-mode
black rule — it is an intentional, tested semantic (unpatched = dark when the
scene is patched; `showUnpatchedRed` is the diagnostic for it).

## Root cause, per drive path, with file:line evidence

### The shared data fact

- `simulation/scenes/test_bench/scene_config.yaml:236-281` — TE Sign V3 A
  (`TeSignV3A40`) + B (`TeSignV3B34`), group `TE Sign`, both `enabled: true`,
  `brightness: 100`. `groupOverrides['TE Sign']` (line 320-323) is
  `enabled: true, brightness: 100, locked: true` — **the group master is NOT
  the cause** (`locked` is only the rigid-move flag, `group_lock.js:36-43`),
  and `dmxOutputScale` for this group is 1.0.
- `simulation/scenes/test_bench/patches.yaml:82-97` — `TE Sign V3 A/B`:
  `controllerIp: ''`, `dmxUniverse: 0`, `dmxAddress: 0`.
- `simulation/scenes/test_bench/controllers.yaml` — controller 1
  (`Test Bench 1`, DMX, U1/U2) chains the 10 other DMX fixtures; controller 5
  (`Titanic_202`, LED, U10/U12) chains LED_0/LED_1. **No chain references the
  TE Sign.** The mapper therefore *re-derives the sign as unpatched on every
  boot* (`controller_registry.js:1650-1668` — with an active registry,
  unmapped names get `'' / 0 / 0` projected onto their config; hand-editing
  patches.yaml alone cannot fix this, the registry would wipe it back).
- Exporter: `simulation/src/dmx/pixelblaze_model_exporter.js:79` — a DMX pixel
  gets `patch: null` unless `universe > 0 && addr > 0`.
- Exported model `marsin_engine/models/test_bench.js` (regenerated
  2026-07-26T03:22Z): 206 pixels total; **74 `TeSignV3*` pixels, all
  `patch: null`** (e.g. pixel `i: 52`, `TE Sign V3 A - pixel_1`).

### Path 1 — in-sim pixelblaze engine (primary focus)

The pattern engine paints the whole `_batchRenderList`, TE-sign entries
included (verified live: their entry RGB reaches 1.0). Then all three
consumers drop unpatched DMX entries because the scene is in mixed patch
state:

- `simulation/src/dmx/patch_manager.js:246-256` — `_patchesActive =
  _patchedCount > 0`. test_bench: **10 of 12** parLights fixtures patched →
  `true`.
- `simulation/src/core/render_paint_rule.js:25-27` —
  `entryPaintsDirect(entry, patchesActive) = !patchesActive || entry.type ===
  'led'`. TE-sign entries are `type: 'dmx'` → **false**.
- `simulation/src/core/animate.js:436-439` — engine loop only calls
  `entry.apply()` (the fixture bulb paint) when `entryPaintsDirect` → the TE
  fixtures' `setPixelColorRGB` is **never called** in pixelblaze mode.
- `simulation/src/core/animate.js:503-524` — the patched repaint path
  (`applyDmxFrame` from the universe buffer) skips any fixture with
  `universe < 1` → the TE bulbs are not painted by the router either. Net:
  the bulbs **freeze at whatever was painted last** (see Residue below).
- `simulation/src/core/animate.js:561-573` — the V2 global instanced-dot
  flush, mixed mode branch: `_patchesActive && (!entry.patch ||
  entry.patch.universe <= 0)` → dot color forced **0,0,0** ("Mixed mode:
  unpatched pixels stay black"), or 0.8 red if the `showUnpatchedRed`
  diagnostic is on. The 2D Pixel Map tap reads the same entries but the raw
  colors — the map would show TE pixels lit while the 3D stays dark (not
  probed, noted for completeness).

### Path 2 — marsin_engine over sACN (sacn_in mode)

- The engine model has `patch: null` for all 74 TE pixels (above) — marsin has
  **no universe/channel to put the sign's colors on**. Nothing about the sign
  ever reaches the wire.
- Sim side, `simulation/src/dmx/sacn_mapper.js:60-81` (`demapSacnToPixels`):
  an entry with `!entry.patch` is handed to `paintUndrivenEntry`
  (`sacn_mapper.js:148-157`) which paints it **solid red (1,0,0)** on both the
  entry and the fixture bulbs — the deliberate "unmapped hole" marker
  (operator decision 2026-06-12). The global dots still show black for them
  (mixed-mode rule above). So in sacn_in mode the sign is a static red
  diamond: no pattern, by design, because there is no patch.
- The sim's own outbound map skips them too: `sacn_mapper.js:168`
  (`mapPixelsToSacn`: `if (!entry.patch) continue`).

## Live reproduction (readonly probe, shared stack untouched)

Probe: `~/tmp/tesign_probe/tesign_testbench_probe.cjs` — own throwaway
Chromium against the already-running :6969, URL
`?scene=test_bench&readonly=1&profile=full&renderer=webgl`. Gate asserted
before anything else: `__readonlyMode === true`, `params.autoSave === false`,
scene `test_bench` (probe aborts loudly otherwise — first run DID abort until
the engine bootstrap was added, see Honesty). `debounceAutoSave` stubbed,
`window.sacnInput` shimmed; readonly mode hard-disables sACN out
(`animate.js:651`). Browser closed at exit. Readonly boot skips the pattern
engine (`main.js:755` — "Observer mode … pattern engine disabled"), so the
probe bootstraps it in-page via `loadPatternPresets()` + `initPatternEngine()`
(rainbow pattern), then flips `lightingMode = 'pixelblaze'` through
`onLightingChange()`.

Measured (t0 and t0+1s, identical):

| Pixel set | n | max entry RGB (pattern output) | max global-dot instanceColor |
|---|---|---|---|
| TE Sign (`TeSignV3*`) | 74 | **1.0** — engine IS computing them | **0** — mixed-mode black |
| LED strands | 80 | 1.0 | 1.0 (animating) |
| Patched DMX | 52 | 1.0 | 1.0 (animating) |

Topology check: `_patchesActive = true`, batch = 206 entries, first TE entry
`{patch: null, paintsDirect: false, sId: 5, fId: 11}`.

TE fixture bulb `instanceColor` max = 1.0 on both halves — that is the
**frozen red** from the boot-phase sacn_in demap (`paintUndrivenEntry`), not
pattern output; it does not change between samples.

Screenshots (visually inspected; camera on the sign at (-2, 9, 0.5)):

- `~/tmp/tesign_probe/tesign_tb_1785036859_pixelblaze_frame_a.png`
- `~/tmp/tesign_probe/tesign_tb_1785036864_pixelblaze_frame_b.png`

Frame A: LED strand animating pink/orange rainbow; TE sign a **static red
diamond**. Frame B (1 s later): strands moved to teal/blue/green — pattern
clearly animating — TE sign **identical static red**. Exactly the operator's
symptom, reproduced under the in-sim engine.

## Secondary findings (not the root cause, worth filing)

1. **sId/fId collision between the TE Sign and the LED strands.** Exported
   model: TE Sign A pixels carry `sId 5, fId 11` — **identical** to LED_0's
   `sectionId 5, fixtureId 11` (scene_config.yaml:301-302); TE Sign B carries
   `sId 5, fId 12` vs LED_1's `6, 12`. Cause:
   `controller_registry.js:1671-1694` (`projectOntoConfigs` metadata pass)
   computes `maxSectionId`/`maxFixtureId` over **DMX configs only** — it never
   sees the LED strand ids that `assignLedStrandMetadata` handed out earlier,
   so when the TE Sign was added (sectionId 0) it was given 4+1=5 / 10+1=11,
   colliding with LED_0. Any engine pattern keyed on section/fixture metadata
   treats TE-Sign-A and LED_0 as one fixture. Independent bug; does not cause
   the blackout.
2. **Mode-switch residue:** leaving sacn_in with unpatched DMX fixtures leaves
   their bulbs frozen at the undriven red (nothing repaints them in
   pixelblaze/gradient mode while `_patchesActive` — see Path 1). Cosmetic,
   but it is why the sign reads "red" rather than "off" to the operator.
   `entry._sacnUndriven` is never cleared on mode change.

## FIX PLAN (for an Opus implementer)

**The correct fix is to patch the TE Sign in the test_bench scene — data, not
code.** Mechanism and order:

1. **Map the halves onto a controller** (this is the ONLY durable place —
   `projectOntoConfigs` re-derives patches from `controllers.yaml` on every
   boot, so editing patches.yaml alone gets wiped):
   - Either via the live Controller Mapping panel (operator or a non-readonly
     session; auto-derives addresses, saves controllers.yaml + patches.yaml,
     re-exports the model), or by hand-editing
     `simulation/scenes/test_bench/controllers.yaml` and letting the sim
     reload/save once.
   - Footprints: `TeSignV3A40` = 120 ch, `TeSignV3B34` = 102 ch (222 total —
     fits one universe). Suggested: a new port on controller 1 (`Test Bench
     1`, 10.x.x.10) with a **fresh universe** (e.g. U3), chain
     `TE Sign V3 A` at 1, `TE Sign V3 B` at 121; or mirror whatever the
     titanic-scene hardware plan is. `nextUniverse: 24` in the file is the
     allocator hint — any unused universe ≥1 works, U3 keeps it tidy.
   - Do NOT chain them onto the LED controller (`Titanic_202`) — they are
     DMX-transported fixtures (bus: led fixture defs on a DMX chain), not
     LED-projection strands.
2. **Verify the regenerated artifacts** (the sim rewrites these on save):
   `patches.yaml` gains real universe/addr for both halves;
   `marsin_engine/models/test_bench.js` TE pixels get
   `patch: { universe: U, addr: A, footprint: 3 }` (per-pixel 3-ch RGB
   footprints — the exporter emits per-pixel channels r/g/b offsets);
   viewmasks sidecar rebuilds without error.
3. **Verification recipe (both paths):**
   - Re-run `~/tmp/tesign_probe/tesign_testbench_probe.cjs` (or re-create from
     this report): expect TE `maxDot > 0` and dot colors changing between the
     two samples; screenshots show the sign animating the rainbow.
   - sACN path: with the shared stack's engine on the test_bench model,
     sacn_in mode should now demap the sign (no red diamond); check the sACN
     IN monitor shows the new universe subscribed
     (`autoSubscribePatchUniverses` picks it up from the patch).
   - Run the sim auto-check spec for touched subsystems before claiming
     merge-ready (`cd simulation && npm test` — no code changes expected, but
     scene YAMLs feed several tests).
4. **Optional, separate slices (file on the Notion board, do not fold in):**
   - The sId/fId collision (secondary finding 1): make the
     `projectOntoConfigs` metadata pass compute its max over
     `gatherAllConfigs(params)` + LED strand ids (the same union
     `assignLedStrandMetadata` uses) so DMX and LED ids stay mutually
     exclusive; then re-save both scenes and re-export models. Risk: existing
     patterns keyed on the old ids change targets — coordinate with the
     operator.
   - The sacn_in→pixelblaze frozen-red residue (finding 2): clear
     `_sacnUndriven` + repaint black once on mode change (pattern_editor
     `onLightingChange` or the animate clear pass). Cosmetic.
   - If the operator *wants* unpatched fixtures to preview patterns in mixed
     scenes, that is a semantics decision on `animate.js:565` — recommend NOT
     doing it; `showUnpatchedRed` already exists as the diagnostic, and the
     black-in-mixed-mode rule is what makes a forgotten patch visible.

## Honesty notes

- The first probe run **aborted** (engineReady false) because readonly boot
  never initializes the pattern engine; the probe now bootstraps it in-page.
  No fallback was added — the abort was loud, the bootstrap is explicit.
- The probe page raised 3 console errors: one 404 (pre-existing resource
  miss), and two `Cannot read properties of undefined (reading 'connected')`
  pageerrors — probe-induced (a readonly page driven into pixelblaze mode, a
  state normal readonly never enters; some monitor code assumes objects that
  readonly boot skipped). Not present in the operator's flow, not related to
  the root cause.
- The sim showed "2 sim windows connected — hardware output contention risk"
  during the probe — my readonly observer plus the operator's window. Readonly
  hard-disables sACN out (`animate.js:651`), so no contention was possible;
  the probe browser is closed.
- The 2D Pixel Map behavior (TE pixels lit on the map while dark in 3D) is
  inferred from code (`_dispatchPixelFrame` reads raw entries), not probed.
- Titanic-scene contrast (`_patchesActive === false` → sign direct-paints) is
  taken from report `20260724_40`'s verified measurement, not re-probed here.
- No source files, scene files, or state files were modified. Repo writes:
  this report only. Probe script + PNGs live in `~/tmp/tesign_probe/`.

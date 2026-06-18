# LED ↔ DMX fixture PARITY — investigation & design (no firmware change)

**Date:** 2026-06-18
**Author:** research/design agent (requested by Sina)
**Type:** Investigation + design — NO source changed, NO git ops, **NO
MarsinLED firmware change** (MarsinLED is read-only reference here).
**Scope studied:** MarsinLED RGBW output path (firmware reference only),
BM26 `marsin_engine` render→sACN path, `simulation` controller-mapping +
LED-strand UI + exporter, the shipped views-rehaul work (reports
`20260618_1.._5`).
**Status:** DESIGN / RFC — needs Sina's sign-off before implementation.

---

## 0. TL;DR

The operator wants LED strands to reach **parity with DMX fixtures**:
mapped to "LED controllers" in the same menu (with a controller **type**
field), RGBW/white support, the same patterns, and view support
(per-strand + left/right groups).

Most of the *targeting* substrate already shipped in the views rehaul:
strands already resolve to `FIX_RAW_LED` (id 1), already carry stable
`group` names, already flow through the WASM 6-channel render, and the
named-mask `MaskRegistry` can already hold arbitrary host-side masks. The
genuinely missing pieces are concentrated and JS-only:

1. **Controllers have no `type` field** and LED strands are **never
   patched** — `pixelblaze_model_exporter.js:225` emits `patch: null` for
   every strand, and `mapPixelsToSacn` **skips every patch-less pixel**
   (`sacn_mapper.js:168 if (!entry.patch) continue`). So strands render
   in the VM but their colour goes **nowhere on output**. This is the
   core parity gap.
2. **RGBW/white** is fully understood (see §A) and already carried as the
   `w` byte end-to-end; the only output question is *how* an LED
   controller serialises RGBW (channel order / W lane) — a JS mapper
   decision, no firmware change.
3. **Patterns already run on strands** (they are real model pixels the VM
   renders); `FIX_RAW_LED` already lets a pattern target them portably.
4. **Views**: per-strand and left/right-group views are derivable for
   free from the existing `group` field (16 `Left_*`/`Right_*` strand
   groups on titanic) via the already-built `MaskRegistry`.

No firmware change is needed for any of it. The "no firmware change"
constraint only forces one real JS-side decision: the **LED output
protocol** (sACN-DMX-as-LED vs DDP/WLED) is implemented host-side in a
new LED mapper, not in the VM.

---

## A. RGBW handling — MarsinLED reference + BM26 engine

### A.1 How the W lane is *produced* (the VM — identical in firmware & BM26 WASM)

The VM never invents white. The MarsinScript color builtins
(`LANGUAGE_SPEC.md:52-56, 525-532`) are:

- `hsv(h,s,v)` → RGB only, **W=0**
- `rgb(r,g,b)` → RGB only, **W=0**
- `rgbwau(r,g,b,w,a,u)` → Marsin extension, the **only** builtin that
  sets W/A/U (not Pixelblaze-compatible)

Proven in the VM source: `OP_RGB`/`OP_HSV` return
`MarsinPixel::fromRGB(...)` which forces `w=a=u=0`
(`src/MarsinVM.cpp:711, 737`); only `OP_RGBWAU`
(`src/MarsinVM.cpp:743-768`) populates all six channels. So **W is
non-zero only when a pattern explicitly calls `rgbwau()`**. For every
Pixelblaze-style `rgb()`/`hsv()` pattern, W is 0 and white must be
*derived from equal RGB downstream* — the documented Pixelblaze RGBW
philosophy (`LANGUAGE_SPEC.md:58-80, 553-578`: "Express pure white as
`rgb(1,1,1)`… let the RGBW transport derive white at output time").

### A.2 Where W *goes* — firmware (reference) vs BM26 (live)

**Firmware (reference only — do not change):** white extraction is a
**driver-layer** concern, not a VM concern.
`Ws2812RgbwDriver::setPixelRGBW` (`src/Ws2812RgbwDriver.h:72-99`):

- If the pattern set `w > 0` (explicit `rgbwau`): it boosts RGB by `w`
  and lets FastLED's `RGBWEmulatedController` emit the 4th (W) byte.
- If `w == 0` (plain `rgb`/`hsv`): it hands raw RGB to FastLED whose
  configured `RGBW_MODE` (exact/boosted/max/off) extracts white from
  equal-RGB automatically.

The RGB-only *preview* fallback (when no W hardware) is
`MarsinPixel::toRGBFallback` (`src/MarsinPixel.cpp:9-13`):
`outR = min(255, R + W + A·0.8 + U·0.1)`, etc. — the canonical RGBWAU→RGB
mix.

**BM26 engine (live, what actually runs the show):** the VM is the
**vendored WASM**, and BM26 uses the **6-channel** render entry
`marsin_render_all_with_meta_6ch`
(`MarsinLED/src/wasm/marsin_wasm_api.cpp:468-506`), which writes the raw
`pixel.w` byte at `outBuf[i*6+3]` (and a/u at +4/+5). So **the full
RGBWAU MarsinPixel crosses into BM26 untouched** — no driver-layer white
extraction happens in BM26; the W lane is exactly what the pattern set
(0 unless `rgbwau`). The BM26 chain:

1. `wasm_host.renderAll6ch` calls the 6ch entry, returns a
   `pixelCount×6` `Uint8Array` (`marsin_engine/lib/wasm_host.js:71,
   123-145`).
2. `engine.js:649-657` unpacks the 6 bytes back onto each model pixel as
   `px.r/g/b/w/a/u` (0..1).
3. **DMX output** `mapPixelsToSacn` (`simulation/src/dmx/sacn_mapper.js`,
   imported by `engine.js:52`, called `:685`) writes each channel to the
   fixture's DMX address using the per-pixel `channels` map: W to
   `channels.w` if the fixture has a white channel (`:213`). If a fixture
   has a `w` channel but the pattern produced no explicit W, BM26
   **synthesises** white as `min(R,G,B)` (`sacn_mapper.js:213`) — the
   BM26 JS-side equivalent of FastLED's white extraction.
4. **Sim 3D preview** of W/A/U: the inbound DMX→colour path mixes
   `rn = min(1, r + w·0.8 + a·0.9 + uv·0.4)` (and g/b variants)
   (`sacn_mapper.js:129-132`) — close to, but not identical to, the
   firmware `toRGBFallback` weights (firmware uses `+W` full, `A·0.8`,
   `U·0.1`). Minor, but worth aligning (§D.3).

**Net:** RGBW is already a solved, end-to-end-carried datum in BM26 for
**DMX** fixtures. The W lane exists, is rendered, is output, and is
visualised. The parity gap is that **LED strands never reach steps 3–4**
because they have no patch — not that W is missing.

---

## B. Current LED vs DMX model in BM26

### B.1 DMX fixtures — defined, patched, output

- **Authored** in `scenes/<scene>/scene_config.yaml` under the
  `🔌 DMX Fixtures` (`fixtureArray`) section: `group, name, fixtureType,
  color, intensity, x/y/z, rot…`.
- **Patched** by the **Controller Mapping** UI
  (`simulation/src/gui/controller_map_editor.js`, opened via the
  `🎛 Controllers` button `gui_builder.js:4231-4235`) which writes
  `scenes/<scene>/controllers.yaml`. Controller shape
  (`controller_registry.js:23-35`): `{ id, name, ip, ports:[{ port,
  universe, chain:[{fixture, at}] }] }`. **No `type` field.** Projection
  (`controller_registry.js computeProjection/projectOntoConfigs`) stamps
  `controllerIp/dmxUniverse/dmxAddress/controllerId` onto each fixture.
- **Exported** to the engine model: each fixture pixel carries
  `patch:{universe,addr,footprint}` + `channels:{r,g,b[,w,a,u]}`
  (`pixelblaze_model_exporter.js:77-138`, e.g. `test_bench.js:13-51`).
- **Output**: `mapPixelsToSacn` → `universe_router` → `sacn_output.js`
  (UDP :5568).

### B.2 LED strands — defined, NOT patched, NOT output

- **Authored** in `scene_config.yaml` under `💡 LED Strands`
  (`ledStrandArray`) section; edited by `gui_builder.js:4032-4194`
  (`buildLedStrandsSection`). Per strand: `name, color, intensity,
  ledCount(2-100), startX/Y/Z, endX/Y/Z`, plus a V2-metadata sub-panel
  exposing `controllerId/sectionId/fixtureId/viewMask` (the
  `controllerId` input exists at `gui_builder.js:~4170` **but there is no
  UI to bind it to an actual controller**).
- **Exported** as `type:'led'` pixels
  (`pixelblaze_model_exporter.js:204-234`): `fixtureType:''`,
  `group: strand.name`, `cId/sId/fId/vMask` from the strand,
  **`patch:null, channels:null`**, plus an `apply(r,g,b)` callback that
  drives the in-sim bulb colour (`fixture.setLedColorRGB`).
- **titanic model**: 480 LED pixels (490 DMX + 480 LED = 970 total),
  in **16 strand groups**, all named `Left_*`/`Right_*`
  (8× 40-pixel hull strands `{Left,Right}_{Front,Back}_{Left,Right}`,
  8× 20-pixel `Small_{Left,Right}_{1..4}`). All carry `fixtureType:''`
  → resolves to `FIX_RAW_LED` id 1 (`fixture_type_constants.js:52`). Left
  strands sit at negative x (e.g. `x:-31.5`), right at positive x — so
  **left/right is derivable from either the group-name prefix or the x
  sign.**
- **Output protocol today: NONE.** `mapPixelsToSacn` skips them
  (`sacn_mapper.js:168`). On real hardware the strands are dark. In the
  sim they are driven *only* by the in-process `apply` callback (the WASM
  render writes their `px.r/g/b/w` but nothing maps it outward); note the
  inbound DMX viz path paints **patch-less driven entries bright RED** as
  an "unmapped" indicator (`sacn_mapper.js:148-157`) — confirm strands
  use the `apply` callback path and are not caught by that indicator.

### B.3 The controller-mapping menu the operator means

It is the sim's floating **🎛 Controller Mapping** panel
(`controller_map_editor.js`, ~1200 lines). It maps **fixtures** to
controller **ports**; it has **no concept of LED controllers or
strands** today. Adding a `type: DMX | LED` field touches: the YAML
schema (`controllers.yaml`), the registry
(`controller_registry.js:23-35` shape + validation + projection), and the
editor UI (`controller_map_editor.js`). CaptainPad has **no** controller/
topology UI — it is pattern/mixer playback only — so controller-type work
is **sim + engine only**, not CaptainPad.

---

## C. Parity gap analysis

| Feature | DMX today | LED today | Gap | Fix location |
|---|---|---|---|---|
| **Controller mapping** | Mapped via 🎛 Controller Mapping → `controllers.yaml` | `controllerId` field exists but **no UI binding**, never patched | Add LED controllers + strand-to-controller binding | `controller_registry.js`, `controller_map_editor.js`, `controllers.yaml` |
| **Controller `type`** | implicit DMX (sACN unicast IP) | none | Add explicit `type: DMX\|LED` | `controller_registry.js:23-35`, editor UI, YAML |
| **Patching / addressing** | `patch{universe,addr,footprint}` + `channels{}` per pixel | `patch:null, channels:null` | Strands need an addressing scheme (universe+start-channel per strand, RGBW stride) | `pixelblaze_model_exporter.js:204-234`, new LED projection in `controller_registry.js` |
| **RGBW / white output** | W → `channels.w` DMX ch; synth `min(R,G,B)` if no explicit W (`sacn_mapper.js:213`) | strands never reach output | LED mapper emits RGBW with chosen W lane (explicit-W passthrough; opt RGB→RGBW extraction) | new `led_mapper.js` (engine/sim/dmx) |
| **Pattern execution** | runs | **already runs** (strands are real VM pixels) | none (targeting via `FIX_RAW_LED` already works) | — (shipped) |
| **Sim viz of W/A/U** | mixed `r + w·0.8 + a·0.9 + uv·0.4` (`sacn_mapper.js:130`) | strand bulbs driven by `apply(r,g,b)` — W/A/U dropped at the callback (`exporter:227-230` only passes r,g,b) | pass W/A/U into strand bulb colour (or mix before apply) | `pixelblaze_model_exporter.js:227-230`, `led_strand.js` |
| **Fixture-type targeting (`FIX_RAW_LED`)** | works | **works** (id 1, `''`/`RawLed`) | none | — (shipped, report `20260618_1`) |
| **View support (named masks)** | works (MaskRegistry) | strands carry `group` + `vMask`; MaskRegistry can hold host-side masks unbounded | derive strand views, expose in selection options | `mask_registry.js` (shipped), engine `loadModel`, `api_server` view-options |
| **Per-strand views** | n/a | each strand already a distinct `group` (e.g. `Left_Front_Left`) | auto-register one host-side mask per strand group | engine `loadModel` (MaskRegistry), exporter sidecar |
| **Left/Right group views** | n/a | derivable from `group` prefix `Left_*`/`Right_*` OR x-sign | auto-register `LEFT`/`RIGHT` composite masks | engine `loadModel` / view derivation |
| **Named-mask / MaskRegistry applicability** | applies | **applies unchanged** (strands are pixels with membership) | only need to *populate* strand/derived masks | `mask_registry.js` + load-time derivation |

**Condensed:** the only *hard-missing* machinery is (1) controller type +
LED patching/addressing and (2) an LED output mapper. Everything in the
"pattern / targeting / views / mask" rows is **already built** by the
views rehaul and just needs strand membership populated.

---

## D. Design (no firmware change)

### D.1 Controller types DMX / LED in the menu + data model

- **Schema:** add `type: 'DMX' | 'LED'` to each controller in
  `controllers.yaml` (default `'DMX'` for back-compat — this is a
  *schema* default for un-migrated files, not a runtime fallback;
  un-typed loads as DMX and is logged once, not silently masked).
- **Registry** (`controller_registry.js:23-35`): carry `type`; branch
  validation + projection on it. A `DMX` controller projects
  universe/addr/footprint as today; an `LED` controller projects an
  **LED patch** (see D.2). Keep `id/name/ip/ports` shared.
- **Editor UI** (`controller_map_editor.js`): a type toggle on the
  controller header (DMX/LED); LED controllers show a strand tray
  (sourced from `params.ledStrands`) instead of the DMX fixture tray, and
  per-port LED config (universe + start channel + RGBW order). The
  fixture-vs-strand tray is the only substantive UI fork; the chain/port
  model is reused.

### D.2 Map LEDs to LED controllers (patching)

LED strands become **patchable** exactly like DMX fixtures, but with an
LED patch shape. Recommended: keep the **same sACN/E1.31 transport**
(it already exists, is offline-safe, and most pixel controllers —
WLED/Pixelblaze-class — speak sACN/E1.31), so **no new protocol** and no
firmware change:

- Each strand gets `patch:{ universe, addr, footprint, stride, order }`
  where `stride` = bytes-per-pixel (3 RGB / 4 RGBW) and `order` =
  channel order (e.g. `GRBW`). `channels` per pixel is then *derived*
  from `(pixelLocalIndex × stride)` rather than authored.
- The exporter (`pixelblaze_model_exporter.js:204-234`) stops emitting
  `patch:null` for strands once a controller binds them; it emits the LED
  patch + per-pixel `channels`. A strand spanning >512 channels wraps to
  the next universe (LED projection in `controller_registry.js`).
- `mapPixelsToSacn` then writes strand pixels with **zero special-casing**
  — they have a patch + channels like any fixture. (Alternatively a thin
  `led_mapper.js` if RGBW stride/order logic is cleaner separated; see
  D.3.) **Decision Q1:** sACN/E1.31 reuse (recommended) vs a DDP/WLED-JSON
  LED path (more controller-native but a new host sender + offline
  validation).

### D.3 RGBW / white parity (engine output + sim viz)

- **Engine output:** the W byte is already rendered and carried
  (§A.2). The LED mapper writes RGBW per pixel using the strand's
  `order`. White policy mirrors DMX: **explicit `rgbwau` W passes
  through**; for plain `rgb`/`hsv` patterns, either (a) leave W=0 and send
  equal RGB (let the LED controller's own RGBW mode extract white, the
  Pixelblaze philosophy), or (b) synthesise `W=min(R,G,B)` like
  `sacn_mapper.js:213`. **Decision Q2:** which white policy for strands —
  recommend (a) as default (matches `LANGUAGE_SPEC`), (b) as a per-
  controller opt-in.
- **Sim viz:** pass W/A/U into the strand bulb colour. Today the strand
  `apply` callback only forwards `(r,g,b)`
  (`pixelblaze_model_exporter.js:227-230`), so any `rgbwau` white on a
  strand is invisible in the sim. Fix: mix RGBWAU→RGB *before* `apply`
  (reuse the `sacn_mapper.js:130-132` formula, or better, align it to the
  firmware `toRGBFallback` weights so sim matches hardware). Small, JS-
  only, in `pixelblaze_model_exporter.js` + `led_strand.js`.

### D.4 Patterns run on LEDs

**Already true** — strands are real model pixels the WASM renders, and
`FIX_RAW_LED` (id 1) lets any pattern target them portably
(`fixture_type_constants.js:52`). No change needed beyond making the
output land (D.2). A proof step: run an existing pattern, confirm strand
pixels animate in the sim, then confirm the new LED patch emits sACN.

### D.5 Per-strand + left/right-group views via MaskRegistry

The shipped `MaskRegistry` (`marsin_engine/lib/mask_registry.js`,
report `20260618_5`) already supports unbounded host-side named masks
with per-pixel membership. Strands need **only their membership
populated** at `loadModel`:

- **Per-strand view:** one `MaskEntry{ kind:'group', name:<strand.group>,
  members: pixels where group===name }` per distinct strand group. The 16
  titanic strand groups become 16 selectable views for free.
- **Left/Right group views:** two composite `MaskEntry`s — `LEFT` =
  union of groups matching `^(Small_)?Left_`, `RIGHT` = `^(Small_)?Right_`
  (or derive from `x < 0` / `x > 0`; group-name is more robust since it
  survives re-centring). Optionally `FRONT`/`BACK` from the `_Front_`/
  `_Back_` infix.
- These are **host-side (Tier-A) masks** — no viewMask bit consumed
  (report `20260618_2` §3.3 Tier A), so they don't compete with titanic's
  already-heavy group-bit budget. Patterns that need them *in-VM* opt into
  the Tier-B working-set bit; channel/mixer selection uses them with zero
  bit cost.
- Surface them in `/model/view-selection-options`
  (`marsin_engine/lib/api_server.js`) so CaptainPad/operator can pick
  "Left strands" / "Right strands" / a single strand as a view target.

### D.6 Exact files to change

**simulation/**
- `src/dmx/controller_registry.js` — `type` field; LED validation +
  LED projection (universe/addr/stride/order).
- `src/gui/controller_map_editor.js` — controller type toggle; LED strand
  tray + per-port RGBW config.
- `src/dmx/pixelblaze_model_exporter.js:204-234` — emit LED `patch` +
  `channels` when bound; pass RGBWAU→RGB into strand `apply` (`:227-230`).
- `src/fixtures/led_strand.js` — accept W/A/U-mixed colour in the bulb
  material.
- `src/dmx/sacn_mapper.js` — either reuse for LED pixels as-is (if they
  carry a normal patch+channels) **or** factor a `led_mapper.js`; align
  the viz mix weights to `toRGBFallback`.
- `scenes/<scene>/controllers.yaml` — gains `type:`; titanic strands get
  an LED controller.

**marsin_engine/**
- `engine.js loadModel` — register per-strand + LEFT/RIGHT derived masks
  into the `MaskRegistry`; route LED pixels through the (reused or new)
  LED mapper on output.
- `lib/mask_registry.js` — (already built) consume the derived strand
  masks; likely no change, just populate.
- `lib/api_server.js` — expose strand/derived views in
  view-selection-options.
- *(optional)* `lib/led_mapper.js` (NEW) — RGBW stride/order serialiser if
  not folded into `sacn_mapper.js`.

**CaptainPad/** — no controller/topology change; at most surface the new
strand/left-right view targets if the view picker enumerates from
`/model/view-selection-options` (likely already dynamic).

### D.7 Already-working vs genuinely-new

- **Already working (views rehaul, reports `20260618_1.._5`):**
  strands resolve to `FIX_RAW_LED`; patterns render on strand pixels;
  `MaskRegistry` holds unbounded host-side named masks; `FIX_*`/`MASK_*`
  compile-time injection; strands carry stable `group` + `cId/sId/fId/
  vMask` fields through the exporter; the 6-channel RGBWAU render path and
  the `w` byte end-to-end.
- **Genuinely new:** controller `type` field + LED-controller UI; LED
  patching/addressing (strand → universe/channel/stride/order); the LED
  output mapper (W lane serialisation); RGBWAU→RGB in the strand sim viz;
  load-time *population* of per-strand and LEFT/RIGHT masks; view-options
  exposure of strand views.

### D.8 Risks & "no-firmware-change" pressure points

1. **LED protocol is a host decision (the one forced choice).** Because
   no firmware change is allowed, the LED transport must be implemented
   in BM26 JS. Reusing sACN/E1.31 (D.2) is zero-new-protocol and offline-
   safe; DDP/WLED would need a new host sender + offline-readiness review
   (no CDNs/telemetry — codex). Recommend sACN/E1.31 reuse.
2. **Channel-budget / universe wrap.** 480 RGBW strand pixels = 1920
   channels ≈ 4 universes just for strands; LED projection must wrap
   universes and not collide with the 490 DMX fixtures' universes.
3. **No-fallback (codex P0).** Un-typed controllers loading as DMX is a
   *schema migration* default, acceptable only if logged loudly and one-
   time; an unbound strand must **not** silently emit black or red —
   decide explicit behaviour (unmapped strand = loud "unpatched" state,
   like DMX `paintUndrivenEntry`, not a silent skip).
4. **Sim/hardware viz drift.** The sim's RGBWAU→RGB weights
   (`sacn_mapper.js:130`) differ from firmware `toRGBFallback`
   (`MarsinPixel.cpp:9-13`); align them so the sim predicts hardware.
5. **White policy ambiguity.** `rgb(1,1,1)` vs `rgbwau(...,w,...)` produce
   different W on hardware depending on the chosen extraction policy
   (Q2); pick one default and document in `LANGUAGE_SPEC`-adjacent BM26
   docs (`docs/MARSIN_ENGINE_PATTERNS.md`).
6. **Left/Right derivation source.** Group-name prefix is robust;
   x-sign breaks if the model is re-centred. Use group-name, fall back to
   x only for strands lacking the convention (and warn).

---

## E. Open questions / decisions for the operator

- **Q1 — LED transport.** Reuse sACN/E1.31 for strands (recommended, no
  new protocol, offline-safe) or implement DDP/WLED-native output (more
  controller-native, new host sender + offline review)?
- **Q2 — White policy on strands.** For plain `rgb`/`hsv` patterns, send
  equal-RGB and let the LED controller extract W (Pixelblaze philosophy,
  recommended default), or synthesise `W=min(R,G,B)` host-side like the
  DMX path? Per-controller opt-in?
- **Q3 — RGBW channel order / stride per LED controller.** Expose
  `order` (RGB/GRB/RGBW/GRBW…) + `stride` (3/4) in the controller UI, or
  fix a project default?
- **Q4 — Controller-type UI shape.** A type toggle on the existing
  Controller Mapping panel (one panel, two modes) vs a separate "LED
  Controllers" panel? (Operator asked for the *same* menu → recommend the
  toggle.)
- **Q5 — Strand addressing granularity.** Patch a whole strand to one
  port/start-channel (simplest) vs per-segment patching for long runs
  that wrap universes?
- **Q6 — Derived view naming.** Reserve names `LEFT`/`RIGHT`/`FRONT`/
  `BACK` (+ per-strand `Left_Front_Left` …) — confirm spelling and
  whether to also auto-derive `ALL_STRANDS` / `FIX_RAW_LED`-as-a-view.
- **Q7 — Unmapped strand behaviour.** Loud "unpatched" indicator (like
  DMX `paintUndrivenEntry`) vs leave dark — must not be a silent fallback
  (codex P0).

---

## F. References

- **MarsinLED (reference, read-only):** `LANGUAGE_SPEC.md:52-101,
  525-578`; `src/MarsinVM.cpp:684-768` (OP_RGB/OP_HSV/OP_RGBWAU);
  `src/MarsinPixel.{h:16-39,cpp:5-14}`; `src/Ws2812RgbwDriver.h:72-99`;
  `src/wasm/marsin_wasm_api.cpp:289-506` (6ch render entries).
- **BM26 render→output:** `marsin_engine/lib/wasm_host.js:71,123-145`;
  `marsin_engine/engine.js:52,649-657,685`;
  `simulation/src/dmx/sacn_mapper.js:80-221` (viz mix + DMX out);
  `marsin_engine/lib/sacn_output.js`;
  `simulation/src/dmx/universe_router.js`.
- **Controllers / strands:** `simulation/src/dmx/controller_registry.js:
  23-35,292-303`; `simulation/src/gui/controller_map_editor.js`;
  `simulation/src/gui/gui_builder.js:4032-4194,4231-4235`;
  `simulation/src/fixtures/led_strand.js`;
  `simulation/src/dmx/pixelblaze_model_exporter.js:204-234,276-278`;
  `simulation/scenes/test_bench/controllers.yaml`;
  `marsin_engine/models/titanic.js:503+` (480 LED px, 16 groups).
- **Shipped views-rehaul substrate:**
  `marsin_engine/lib/fixture_type_constants.js:52`,
  `marsin_engine/lib/mask_registry.js`,
  reports `202606/20260618_1_fixture_type_design.md`,
  `_2_named_masks_design.md`, `_5_bm26_views_impl.md`.

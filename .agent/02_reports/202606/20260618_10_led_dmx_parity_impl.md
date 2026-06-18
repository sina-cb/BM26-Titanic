# LED ↔ DMX fixture PARITY — implementation

**Date:** 2026-06-18
**Author:** developer agent (implements `20260618_6_led_dmx_parity_design.md`)
**Branch:** `dev/claude/views_rehaul` (committed, NOT pushed)
**Scope:** BM26 JS only — `simulation/` + `marsin_engine/`. **NO firmware
change** (`MarsinLED` read as reference only). NO CaptainPad source change
(the view picker already enumerates `/model/view-selection-options`).

---

## 0. What shipped (per step)

| Step | What | Files |
|---|---|---|
| 1 | Controller `type: DMX\|LED` field + LED config (order/stride/baseUniverse/startAddr/whiteMode) in the data model, the Controller Mapping editor (DMX/LED toggle + LED sub-panel + strand tray), and `controllers.yaml` schema | `controller_registry.js`, `controller_map_editor.js`, `main.js`, `scenes/test_bench/controllers.yaml` |
| 2 | LED strands emit a real per-pixel patch `{universe, addr, footprint, led:true}` + `channels` from the LED projection; unbound strands emit a LOUD `unpatched:true` marker (never silent) | `pixelblaze_model_exporter.js`, `controller_registry.js` (`computeLedProjection`) |
| 3 | LED output mapper: RGBW write per order/stride, W passed through RAW (native) for LED pixels; DMX `min(R,G,B)` white-synth kept DMX-only; per-LED-controller `whiteMode:'synth'` opt-in | `sacn_mapper.js` |
| 4 | Sim viz of W: strand bulbs mix RGBWAU→RGB with the EXACT firmware `toRGBFallback` weights, so `rgbwau(...,w,...)` lights strands white in the sim as on hardware | `sim_preview.js` (`mixRgbwauToRgb`), `led_strand.js` (`setLedColorRGBWAU`), `pixelblaze_model_exporter.js` |
| 5 | Per-strand + LEFT/RIGHT views auto-registered at engine `loadModel` as Tier-A host masks (ZERO viewMask-bit cost); surfaced in `/model/view-selection-options` (`namedViews`) | `engine.js` `loadModel`, `lib/strand_views.js` (new), `lib/api_server.js` |

---

## 1. LED patch / contract format

### controllers.yaml (LED controller)
```yaml
controllers:
  - id: 2
    name: LED Bow
    ip: 10.1.1.40
    type: LED                 # NEW — DMX is the other value
    led:                      # NEW — present only on LED controllers
      baseUniverse: 0         # 0 = auto from the port universe
      startAddr: 1            # 1–512
      order: RGBW             # RGB/GRB/BGR/RGBW/GRBW/RGBWA
      stride: 4               # bytes/pixel (derived from order, override allowed)
      whiteMode: native       # native (pass W raw) | synth (min(R,G,B))
    ports:
      - port: 1
        universe: 20
        chain: [Left_Front_Left, Small_Left_1]   # strand NAMES (not {fixture,at})
```
DMX controllers now serialize `type: DMX` explicitly. Un-typed legacy
files load as DMX with a **one-time loud log** (`main.js`) — a schema
migration default, never a silent runtime fallback (codex P0). The next
save persists `type: DMX`.

### Exported model pixel (LED, patched)
```js
{ i, type:'led', fixtureType:'', name, group, x,y,z, nx,ny,nz,
  cId, sId, fId, vMask,
  patch: { universe, addr, footprint:<stride>, led:true },
  channels: { r:1, g:2, b:3, w:4 },     // from the controller's order map
  whiteMode: 'native' }
```
### Exported model pixel (LED, UNPATCHED — loud)
```js
{ ..., patch: null, channels: null, whiteMode:'native', unpatched:true }
```
The engine `loadModel` scans these and prints a `✋ N LED-strand pixel(s)
across M strand(s) are UNPATCHED … [names]` warning — proven live on
titanic (480 px / 16 strands, the current state with no LED controller
bound yet).

### LED addressing (`computeLedProjection`)
Pixel `k` of a strand: `startByte = (startAddr-1) + k*stride`,
`universe = baseUniverse + floor(startByte/512)`,
`addr = (startByte % 512) + 1`; a pixel that would straddle 512 rolls
whole to the next universe (no split pixel). Strands pack sequentially
along a port's chain. Reuses sACN/E1.31 (offline-safe, WLED speaks it) —
no new protocol, no firmware change.

### White policy (the contract)
- LED + `native` (default): W byte = rendered W lane AS-IS. `rgb()`/`hsv()`
  → W=0 (hardware derives white). `rgbwau(...,w,...)` → explicit W passes
  through. **Never** host-synthesises `min(R,G,B)` — that stays DMX-only.
- LED + `synth`: opt back into host `min(R,G,B)` white.
- DMX: unchanged (`min(R,G,B)` when no explicit W).

### Sim/firmware viz mix (exact)
`mixRgbwauToRgb` = firmware `MarsinPixel::toRGBFallback`:
`R=min(1,r+w+a·0.8+u·0.1)`, `G=min(1,g+w+a·0.4)`, `B=min(1,b+w+u·0.5)`.

---

## 2. Test / perf / functional results

- **Engine tests:** `node --test tests/*.test.js` → **814 pass / 0 fail**
  (was 792; +22 in new `tests/led_dmx_parity.test.js` covering controller
  type, LED config validation, LED projection incl. universe wrap +
  bad-IP, LED mapper RGBW + native W pass-through + synth opt-in + GRBW
  order, DMX path unchanged, RGBWAU→RGB firmware mix, strand-view
  derivation + MaskRegistry registration).
- **Sim tests:** `npm run check` → **97 pass / 0 fail** (+5 LED parity
  cases in `tests/controller_registry.test.js`); `sacn_mapper.test.js`
  6/6.
- **Perf gauge:** `node tools/perf_gauge.mjs --gate` → fails ONLY on
  `titanic/27_swipe` mean/p99 (~25–37%) — but the **golden output hash is
  identical** (`6993b71cfcb1`) and the SAME failure reproduces on a clean
  `git stash` baseline (verified). This is machine-load timing noise, not
  a regression; the gauge uses `loadModelForGauge`, which my changes never
  touch. **Did NOT re-baseline** (output unchanged — re-baselining inflated
  noise would mask a future real regression).
- **Headless functional harness** (`~/tmp/led_parity_harness.mjs`,
  ALL CHECKS PASSED):
  - (a) LED-patched strand pixels → non-zero sACN on the projected LED
    universe (U20); explicit `rgbwau` white → **W byte = 255 on 15/15
    mapped pixels**; native plain-rgb → **W stays 0** (no synth).
  - (b) Unmapped strand → `patch:null` + `unpatched:true`, LOUD count+names
    (3 px / `Stern_Unmapped`), **zero sACN emitted**.
  - (c) per-strand view `Left_Front_Left` → exactly its 6 px; `LEFT` → 10
    px (only Left_* groups); `RIGHT` → 8 px (Right_* + an x-sign-fallback
    strand, loudly warned); `LEFT ∩ RIGHT = ∅` (zero out-of-view leak).
- **Live engine boot (titanic):** `loadModel` logs
  `Strand views (Tier-A, no bit cost): 0 per-strand, LEFT, RIGHT`
  (per-strand already exist as base group bits, correctly skipped),
  pattern constants now include `MASK_LEFT, MASK_RIGHT`, 28 group-bits
  unchanged (no bit pressure), and the loud unpatched warning fires.

---

## 3. Decisions made (within the design's bounds)

1. **LED projection lives in `computeLedProjection`** (registry), and the
   **exporter computes it directly from `window.__controllerRegistry`** +
   live `params.ledStrands` — rather than threading LED fields through the
   DMX `projectOntoConfigs`/patch-tree/undo pipeline. Keeps STEP 2
   self-contained and the DMX patch-stamping path untouched.
2. **DMX projection skips LED controllers** so strand names never surface
   as `orphan` fixtures.
3. **Per-strand views** are NOT re-registered when the strand group is
   already a base group (titanic): the base group already provides that
   view (zero duplication). Only LEFT/RIGHT are genuinely new there.
4. **`_untypedControllers` is non-enumerable** so it never serializes into
   `controllers.yaml` (the registry IS the saved config node).
5. **Did NOT add an LED controller to titanic's committed scene** — real
   hardware IPs/topology are operator config, out of scope for "make LEDs
   capable". The capability is proven via the harness + unit tests; the
   loud unpatched path is the correct current titanic state.

---

## 4. Screenshot-proof step — EXACTLY what to capture next

Bring up the sim (`cd simulation && npm start`), then in the
**🎛 Controller Mapping** panel:

1. **Controller menu showing DMX/LED types.** Add one DMX and one LED
   controller (or toggle an existing one). Capture the panel with the
   `DMX`/`LED` type toggle visible on the controller headers AND the LED
   sub-panel row (order / stride / U / @ / W-mode). `--show-ui`.
2. **Strand tray + binding.** On the LED controller's port, click
   `+ add strands` and capture the tray showing 💡 strand chips; after
   binding, capture the port chain showing per-strand address preview
   (`💡 Left_Front_Left U20:1 ×40px RGBW`).
3. **Strands lit WHITE.** Load/run a pattern that calls
   `rgbwau(0,0,0,1,0,0)` (or any explicit-white pattern) on the strands;
   capture a strand close-up showing the bulbs rendered white (proves the
   firmware RGBWAU→RGB mix in the sim).
4. **Strands animating a pattern.** Run a normal RGB pattern (e.g.
   `01_cylon_sweep`) and capture two frames showing the strand pixels
   animating in color alongside the DMX fixtures.
5. **Per-strand + LEFT/RIGHT view filtering.** In the mixer/CaptainPad
   view picker (or via `/model/view-selection-options` `namedViews`),
   select `LEFT` on a channel and capture only the left strands lit; then
   `RIGHT`; then a single strand (`Left_Front_Left`) — proving the filter
   isolates exactly that set with no leaks.

Recommended views/flags: `node agent_render.cjs --show-ui --viewport
1280x720` (+ `xvfb-run -a` on headless), and visually inspect each PNG.

---

## 5. Residue / notes

- Engine smoke writes runtime state into tracked `marsin_engine/states/`
  — expected residue, left UNCOMMITTED (do not commit/revert).
- `~/tmp/led_parity_harness.mjs` + `~/tmp/eng_titanic.log` are gitignored
  scratch.
- A pre-existing unrelated `ffmpeg` audio option error appears at engine
  boot tail — not introduced here.

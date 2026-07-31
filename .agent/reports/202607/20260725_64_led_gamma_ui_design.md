# 20260725_64 — LED gamma: firmware UI recon + sim "curve" control design

Recon + design slice for the operator order (2026-07-30):

> "check the gamma UI and curve in the firmware and allow a similar setting
> for the LED controllers from the LED controller config ui in the sim please
> instead of plain textboxes which I don't understand at all."

**This report changes no code.** Device access was **GET-only** (no POST, no
config write, no reboot); no browser session against the sim; no scene save;
no git operations; nothing under `simulation/src/**` touched. Implementation
is `_65` (see §6 for the verbatim brief).

Raw captures (firmware UI assets, device JSON) live in
`~/tmp/led_gamma_recon/` and `~/tmp/led_controller_debug/` — **outside this
repo on purpose**: the controller firmware is a private repo and its source
must never enter a tracked file here. Everything below is a
**presentation-level** description plus public API field names.

---

## TL;DR

1. **The firmware's gamma control is a "Color Curves" card**: a live **SVG
   plot of all four y = x^γ curves** (channel-coloured, over a quarter grid
   with the y=x identity diagonal), **four sliders** R/G/B/W (1.00–3.00,
   step 0.05) with read-only numeric readouts, a **Link RGB** toggle, and
   **preset chips**. No text entry anywhere. It applies live — no reboot.
2. **The sim already has the whole gamma pipeline** (mirror → validate →
   backup → gamma-only write → read-back verify → mirror the VERIFIED
   values). What it lacks is exactly what the operator says: the UI is
   **four `<input type="number">` boxes** in
   `simulation/src/gui/led_gamma_ui.js:78-110`.
3. **So `_65` is a UI-only slice**: swap the four textboxes for
   sliders + presets + a live curve plot, reusing the existing validation and
   push paths untouched. It needs **no** edit to `led_discovery_panel.js`,
   `controller_map_editor.js`, `gui_builder.js` or any server file — i.e. it
   is **disjoint from the S1 push-flow work** (which landed as `_61` while
   this recon ran).
4. **The device's own web console does not show this card.** The bundle
   served by the `10.x.x.60` controller today contains **zero** occurrences
   of "gamma" — its flashed UI image predates the Color Curves wave, while
   its firmware core has gamma (`capabilitiesExt.gammaRgbw: true`,
   config schema `3.1.0`). Consistent with the 2026-07-28 finding already in
   the dossier. Getting the card onto the device is a private-repo reflash —
   **operator-gated, out of scope here**; the sim UI is the supported path.

---

## 1. Firmware recon (device GETs + the private firmware repo)

### 1.1 What the device serves today

`GET /` on the controller returns a small SPA shell (title "MarsinLED
Console") that loads one hashed ES-module bundle + one stylesheet, with three
lazily-imported tab chunks (a DMX tab, a mapping tab, a sync tab) and one tiny
shared chunk. All five JS assets and the CSS were fetched and searched:

| probe | result |
|---|---|
| `grep -i gamma` across every served JS + CSS asset | **0 matches** |
| `curve`, `correction`, `Color Correction` | 0 matches |
| `globalBrightness`, `maxMilliamps`, `transitionDuration`, `rgbwMode` | present |

So the config page the operator can reach on that device has **no gamma
control at all** — it is a pre-gamma UI image. The firmware *core* underneath
does support gamma (below). This matches the already-logged 2026-07-28
observation ("older bundled UI that predates the gamma card").

### 1.2 What the firmware actually implements (private repo, read-only)

The gamma feature is specified in the firmware repo's own design note
("per-channel gamma curves") and implemented as a React card in its UI
sources. Presentation-level summary — **no firmware code is reproduced**:

| aspect | firmware presentation |
|---|---|
| Card title | **"Color Curves"**, sitting next to the brightness / power-cap cards on the config page |
| Channels | **four**: R, G, B, **W** — controller-global (NOT per-output, NOT per-strand) |
| Control type | **`<input type="range">` sliders**, one per channel; **no text entry** |
| Range / step | **1.00 – 3.00**, step **0.05**; **default 1.00 = off/linear** |
| Readout | read-only monospace value per channel, 2 decimals (`2.20`) |
| Colour coding | channel letter + slider accent + plot stroke share one colour; W is a neutral grey |
| Grouping | **"Link RGB" checkbox, ON by default** — moving R, G or B moves all three; **W is always independent** |
| Presets | three chips: **Off (1.0)**, **sRGB (2.2)**, **Punchy (2.6)** — each sets **all four** channels |
| Curve preview | **inline SVG**, ~240×160 with 8 px padding, background `rgba(0,0,0,.35)`, 1 px hairline border |
| Curve maths | all four `y = x^γ` overlaid, **48 samples**, x and y both normalised 0→1 (x = input level left→right, y = output level bottom→top) |
| Curve extras | quarter grid lines at 0.25/0.5/0.75 + a **dashed y=x identity diagonal** as the "off" reference |
| Video clamp | for `x > 0` the plotted y is floored at **1/255** — the LUT's FastLED-style `applyGamma_video` behaviour, so a dim pixel never drops to full black |
| Caption | `y = x^γ · applies live — no reboot` |
| Save semantics | **debounced (350 ms) POST carrying ONLY `{gamma:{…}}`** — never commits unrelated unsaved edits from other tabs |
| Feature gate | card renders dimmed with a "firmware doesn't support color curves" note when `capabilitiesExt.gammaRgbw` is absent |

### 1.3 The API field (evidence)

From `~/tmp/led_controller_debug/recheck_20260730T175802Z.txt` (GET-only probe
of the `10.x.x.60` device, 2026-07-30):

- `GET /api/config` → top-level **`"gamma": {"r":1,"g":1,"b":1,"w":1}`**
  (alongside `globalBrightness`, `maxMilliamps`, `transitionDurationMs`);
  `"version":"3.1.0"`.
- `GET /api/status` → echoes the same `gamma` block, and
  **`capabilitiesExt.gammaRgbw: true`** (the feature-detect flag; the frozen
  `capabilities` object is untouched).
- Device currently at **1/1/1/1 = curve off** on all four channels.

Firmware-side semantics worth carrying into the sim's help text: brightness is
applied **before** gamma; on RGBW outputs the R/G/B curves are applied
**before** white extraction and the W curve then applies to the extracted W —
which is exactly why our own doctrine (docs/41 §4.1(d)) says **keep W at
1.0** unless the white emitter is measured.

### 1.4 docs/41 — already documented

`docs/41_led_controller_onboarding.md` §4.1(d) already carries: the `{r,g,b,w}`
shape, the **1.0–3.0** range with 1.0 = off, "this is the ONE gamma in the
whole chain" (the sim's sACN mapper emits linear bytes), the W-stays-1.0
rationale, the **live-verified** `{"outcome":"applied","reboot":false}` (no
reboot for a gamma-only write, 2026-07-28), the float32 read-back noise
(`2.2` → `2.200000048`, compare with an epsilon and round before mirroring),
and the current UI sentence — *"r/g/b/w gamma fields + ⬆ Push gamma"* — which
is the one line `_65` must update.

---

## 2. Sim-side recon — where the "plain textboxes" are

### 2.1 The textboxes

`simulation/src/gui/led_gamma_ui.js` → `renderGammaSection(ctx, controller)`
(lines **62–141**), called once per LED controller card from
`simulation/src/gui/controller_map_editor.js:1239`. Its body today:

- a `gamma` label (`.cm-led-lbl`) with a long explanatory `title`;
- **four `<input type="number" step="0.1" min="1" max="3">`** (lines 78–110),
  classes `cm-input cm-num cm-led-gamma-input`, each preceded by a tiny
  channel letter — **these are the boxes the operator means**;
- `⬆ Push gamma` button (`.cm-led-gamma-push`), disabled without a valid IP;
- a provenance chip: `✓ hardware 2.2 / 2.2 / 2.2 / 1 · <date>` when the mirror
  matches `device.lastGammaPush.gamma`, `▲ hardware … ≠ mirror — push to
  apply` when it drifts, `○ never pushed` otherwise;
- a hidden error line that turns red with the thrown validation message.

The fleet action `startFleetGammaPush(ctx)` (same file, lines 177–279) is
wired from the LED group header at `controller_map_editor.js:968`
(`⬆ Push gamma to all`).

Styling lives in `simulation/style.css` **lines 2998–3092**
(`.cm-led-gamma*`, `.led-gamma-row-*`).

### 2.2 How gamma reaches the device (already wired, end to end)

Gamma is **not** part of the per-output mapping push plan and **not** part of
`device_config_mapper.js`. It has its own, independent path:

```
card fields ──mutate()──> scene mirror  controllers.yaml →
                          <LED ctrl>.led.wire.controllerGamma
      │
      └─ "⬆ Push gamma" ─> pushGammaToController()            [src/dmx/led/led_gamma.js]
                             └─ POST /led/gamma-push          [browser → sim save-server]
                                  └─ led_gamma_service.cjs    [server/]
                                       GET /api/status  (identity, fail loud)
                                       GET /api/config  (full config)
                                       write ~/tmp backup of the FULL config
                                       POST /api/config  { gamma }   ← partial, gamma ONLY
                                       honour applied | needs-reboot
                                       GET /api/config  → verify (epsilon) or THROW
                             └─ commitGammaPush(): mirror the VERIFIED values,
                                stamp device.lastGammaPush, bind an unbound card
```

Key properties already true (do not re-litigate them in `_65`):

- **One validation source**: `led_gamma.js` (`LED_GAMMA_MIN/MAX = 1.0/3.0`,
  `parseGammaField`, `validateGammaMirror`) agrees byte-for-byte with
  `led_wire.js` (`normalizeLedWireConfig`) and with the server
  (`led_gamma_service.cjs`). All three refuse out-of-range loudly, no clamping.
- **`RECOMMENDED_CONTROLLER_GAMMA = {r:2.2, g:2.2, b:2.2, w:1.0}`**
  (`src/dmx/led_wire.js:106`) — our doctrine, deliberately **different** from
  the firmware card's "sRGB" preset, which also sets W to 2.2.
- The scene **default** mirror is `1/1/1/1` (curve off) — the preview must
  never invent a correction the hardware may not be running.
- A failed push leaves the mirror untouched and names the controller;
  `mirror ≠ hardware` is surfaced by the drift chip.
- The CLI equivalent `simulation/agent_tools/led_gamma_push.cjs` shares the
  same server implementation.

### 2.3 Composition with the in-flight push work (`_58` S1 / `_59` S2)

- `_59` (**S2, landed**) added the required ctx member
  **`claimedUniverses(controller)`** and made `derivePerOutputPlan` take a
  claim index. That is entirely on the **mapping** push path
  (`led_discovery_panel.js` / `device_config_mapper.js`) — **the gamma path
  never calls it**. Any *new* ctx object built in `_65`'s tests must still
  supply `claimedUniverses: () => new Map()`; `_65`'s tests are DOM-free and
  need no ctx at all, so this is a guard-rail, not a task.
- `_58` **S1 landed as `_61`** (during this recon): the *mapping* push now
  awaits a scene persist and a bridge notify. Both live in the **module-private
  `DEFAULT_DEVICE_IO` bag** in `led_discovery_panel.js:126-151`
  (`persistScene: () => window.exportConfig()`,
  `notifyBridge: () => window.PatchManager.notifySacnBridge()`) — **not** on
  `ledCtx`, and **not exported**. **Gamma needs neither step**: it changes no
  universe, no route, no patch record, so the bridge has nothing to
  recompute. `_65` therefore does not hook that flow and does not edit those
  files.
- **Open gap, deliberately deferred to `_66` (see §5.3):** a verified gamma
  push mutates the scene mirror **in memory only**; with `autoSave: false`
  the new curve is not in `controllers.yaml` until a manual save — the same
  class of "one layer moved, the others didn't" gap `_58` root-caused for the
  mapping push. Now unblocked by `_61`, but it changes *push semantics*
  (a gamma push would also save the scene — `_58` §9.3's Option A, which the
  operator defaulted to for the mapping push), so it stays a separate,
  reviewable slice rather than a rider on a UI change.

---

## 3. Design — the gamma control `_65` implements

Goal: **match the firmware card's presentation** (sliders + live curve +
presets + Link RGB), in the sim's own visual language, offline-safe, with the
existing validation and push paths untouched.

### 3.1 Layout (one LED controller card, docked-pane width)

```
 gamma  [Off] [2.2 sRGB] [Punchy]   ☑ Link RGB      ⬆ Push gamma   ✓ hardware 2.2/2.2/2.2/1 · <date>
 ┌───────────────┐  R ──────●────── 2.20
 │   curve plot  │  G ──────●────── 2.20
 │  (inline SVG) │  B ──────●────── 2.20
 └───────────────┘  W ●───────────── 1.00
 y = x^γ · applies live — no reboot
```

- **Row 1 (`.cm-led-gamma-head`)**: existing `gamma` label (keep + extend the
  tooltip), preset chips, Link RGB checkbox, the **unchanged** push button,
  the **unchanged** provenance chip.
- **Row 2 (`.cm-led-gamma-body`)**: `display:flex; gap:8px; flex-wrap:wrap`.
  Left = `.cm-led-gamma-plot`; right = `.cm-led-gamma-sliders` (`flex:1 1
  150px; min-width:150px`).
- The pane is narrow and its type is 8.5–10 px, so the plot is **132 × 84 px**
  (not the firmware's 240 × 160), `width:100%; max-width:132px; height:auto`
  via `viewBox="0 0 132 84"`.
- The hidden error line stays, last child, `flex-basis:100%`.

### 3.2 The curve plot

Built as an **inline SVG string** assigned to a wrapper `div.innerHTML` — the
established sim convention (`src/gui/control_drawer.js:20`,
`left_drawer.js:32`, `split_layout.js:42` all inline SVG this way; there is
**no** `createElementNS` anywhere in `simulation/src/`). **No library, no
CDN, no font** — offline P0 satisfied by construction.

Contents, in draw order:
1. background rect + 1 px border (theme vars, §3.5);
2. quarter grid at 0.25 / 0.5 / 0.75 (both axes), hairline;
3. the **dashed y = x identity diagonal** = "curve off" reference;
4. **ghost hardware curves** — only when `device.lastGammaPush.gamma` exists
   **and** differs from the mirror: the same four paths at `opacity .35`,
   `stroke-dasharray="2 2"`. This makes the drift chip's "▲ hardware ≠
   mirror" *visible* rather than just stated. Omit entirely when in sync.
5. the four **live mirror curves**, channel-coloured, `stroke-width` 1.4,
   round caps/joins.

Curve maths (pure, unit-tested, mirrors the firmware LUT semantics):

```
samples    = 48
clampFloor = 1/255
y(x)       = x === 0 ? 0 : max(x ** γ, clampFloor)      // video clamp
screen x   = pad + x * (W - 2*pad)
screen y   = pad + (1 - y) * (H - 2*pad)                // y up
```

with `W = 132`, `H = 84`, `pad = 5`, coordinates rounded to 1 decimal.

### 3.3 The sliders

Per channel: `<span class="cm-led-gamma-ch">R</span>` +
`<input type="range" min="1" max="3" step="0.05">` +
`<span class="cm-led-gamma-val">2.20</span>` (monospace, tabular-nums,
`width:2.4rem`, right-aligned, **read-only**, matching the firmware).

- **`oninput` (dragging)** → update a **local draft object** only: repaint the
  SVG + the numeric readout. **No `ctx.mutate`, no scene write, no `refresh`.**
  Dragging must not flood the undo stack or re-render the pane mid-drag.
- **`onchange` (release / keyboard commit)** → run the value through
  **`parseGammaField(String(value), ch)`** (single validation source; throws
  loudly, and the throw path keeps the existing red error line + error toast),
  then `quantizeGamma`, then commit:
  `ctx.mutate("Set '<name>' gamma <ch> = <v>", () => setGammaMirror(controller, next))`
  — one undo entry per gesture, exactly like today's `onchange`.
- **Link RGB**: a `<input type="checkbox">`, **default checked**, state held in
  a per-render closure variable — **ephemeral UI state, never written to
  `controllers.yaml`**. When checked, an R/G/B commit sets all three to the
  same value and leaves W untouched; W's slider is never linked.
- Every slider carries a `title` naming the channel, the range, and
  "1.0 = off (linear)".

### 3.4 Presets

`.cm-led-gamma-preset` chips, `.cm-on` when the current mirror equals that
preset (`gammaEquals`). **Three, and deliberately NOT the firmware's three:**

| chip | curve | why |
|---|---|---|
| `Off` | `{1, 1, 1, 1}` | curve off / linear — the scene default |
| `2.2 sRGB` | `{2.2, 2.2, 2.2, 1.0}` = `LED_GAMMA_RECOMMENDED` | our documented recommendation |
| `Punchy` | `{2.6, 2.6, 2.6, 1.0}` | firmware's "punchy" exponent, W held at 1.0 |

**Deviation from the firmware, on purpose:** the firmware's sRGB/Punchy chips
set **W to the same exponent**; ours hold **W at 1.0** because the controller
derives white *after* applying the R/G/B curve, so a second exponent on W
compounds and crushes pastels (docs/41 §4.1(d), `led_wire.js` header,
`led_gamma_service.cjs` header). A preset click is one `ctx.mutate` setting
all four channels.

### 3.5 Colour + theme

Add to `:root` in `style.css` (so the stylesheet owns the palette and the SVG
just references the vars — inline SVG inherits CSS custom properties):

```css
--gamma-r: #ff5b5b;   --gamma-g: #5bd75b;
--gamma-b: #5b8bff;   --gamma-w: color-mix(in srgb, var(--text) 80%, transparent);
```

These four are **fixed hues by design** (same rationale as the existing
`--caution`): R/G/B/W must read as R/G/B/W in every palette. Grid/diagonal/
background derive from `--text` / `--input-bg` / `--ghost-border` via
`color-mix`, like the rest of the pane. Slider `accent-color` is set per
channel to the matching var (the pixel-map pane already sets
`accent-color: var(--primary)` on its range inputs — `style.css:3605`).

**Note for the implementer:** the existing gamma CSS uses
`var(--warning, #e0a030)`, but `--warning` is **not** a `:root` var in this
stylesheet (`--caution: #ffb400` is). Leave the existing drift rule alone —
that is a separate cleanup, not `_65`'s job.

### 3.6 Feature gating — deliberately none

The firmware card dims itself on `capabilitiesExt.gammaRgbw`. The sim's
`device:` block does **not** store device capabilities
(`normalizeDeviceBlock`, `controller_registry.js`), and inventing a
render-time device GET to decide whether to draw a control would be both a
new network dependency in the render path and a guess. So: **always render
the control**; an unsupported controller fails **loudly** at push time
(`led_gamma_service.cjs` throws `rejected` on a device 400 and
`verify-mismatch` on a read-back mismatch — both already surface as a red
per-controller result). No fallback, no silent dimming.

---

## 4. Exact change surface for `_65`

| file | change | anchor |
|---|---|---|
| `simulation/src/dmx/led/led_gamma.js` | **add** pure helpers + constants (below). Nothing existing removed — `parseGammaField`, `validateGammaMirror`, `formatGamma`, `gammaEquals`, `setGammaMirror`, `commitGammaPush`, both push functions stay **byte-identical**. | new section after `formatGamma` (ends line **128**), before `// ── Transport` (line **188**) |
| `simulation/src/gui/led_gamma_ui.js` | **replace the body of `renderGammaSection`** (lines **62–141**). `runSingleGammaPush` (143–159) and `startFleetGammaPush` (161–279) unchanged; the imports grow. | lines 62–141 |
| `simulation/style.css` | **extend** the gamma block: new `.cm-led-gamma-head/-body/-plot/-sliders/-row/-val/-preset/-link` rules + the four `--gamma-*` root vars. **Delete** `.cm-input.cm-led-gamma-input`, `.cm-led-gamma-input.cm-led-gamma-bad` and `.cm-led-gamma-field` **only if** those classes are no longer emitted (no dead CSS). | root block at top; gamma block **2998–3060** |
| `simulation/tests/led_gamma.test.js` | **add** a "curve geometry + presets + quantize" section. Existing tests untouched. | append |
| `docs/41_led_controller_onboarding.md` | **one sentence** in §4.1(d): the sim UI is now sliders + a live curve preview + presets (Off / 2.2 sRGB / Punchy) + Link RGB, still with ⬆ Push gamma / ⬆ Push gamma to all. Keep the file's existing full-IP convention; change nothing else. | around line **304–312** |

**Do NOT touch** (just landed under `_61`, or simply not involved):
`led_discovery_panel.js`, `controller_map_editor.js` (the two call sites at
`:968` and `:1239` stay byte-identical — the new row is entirely inside
`renderGammaSection`), `gui_builder.js`, `patch_manager.js`,
`device_config_mapper.js`, `server/**`, `agent_tools/**`, `scenes/**`,
`marsin_engine/**`.

### 4.1 New exports in `led_gamma.js` (all pure, DOM-free)

```
LED_GAMMA_STEP = 0.05
LED_GAMMA_PRESETS = [
  { key:'off',         label:'Off',      gamma:{r:1,g:1,b:1,w:1},
    title:'Curve off (linear) — the controller passes bytes through' },
  { key:'srgb',        label:'2.2 sRGB', gamma:LED_GAMMA_RECOMMENDED,
    title:'Recommended: R/G/B 2.2, W 1.0 (white is derived AFTER the RGB curve)' },
  { key:'punchy',      label:'Punchy',   gamma:{r:2.6,g:2.6,b:2.6,w:1},
    title:'Deeper curve — more contrast in the low end; W stays 1.0' },
]
GAMMA_CURVE_GEOMETRY = { width:132, height:84, pad:5, samples:48, clampFloor:1/255 }

quantizeGamma(value)          // snap to the 0.05 grid, round to 2 dp.
                              // NO clamping — an out-of-range number must
                              // already have thrown in parseGammaField.
gammaCurvePath(exponent, geom = GAMMA_CURVE_GEOMETRY) -> 'M…L…' string
activeGammaPresetKey(gamma)   -> 'off' | 'srgb' | 'punchy' | null   (gammaEquals)
```

`gammaCurvePath` is the only place the curve maths exists; the UI module never
computes geometry itself. That is what makes the plot unit-testable with no
DOM.

### 4.2 Validation / clamping rules (unchanged contract)

- The range input's `min/max/step` constrain the **gesture**; the **value**
  still passes `parseGammaField` before it can reach the mirror. One source of
  truth, and a programmatic bad value still throws loudly.
- `quantizeGamma` **snaps only** (0.05 grid → 2 dp). It must **not** clamp:
  clamping would be a silent fallback (codex P0) and would hide a bug in the
  caller. Rationale for the rounding: `Math.round(v/0.05)*0.05` alone yields
  `2.3000000000000003`, which would land verbatim in `controllers.yaml`.
- W is never moved by the Link RGB toggle.
- The commit path stays inside `ctx.mutate(...)` so the scene is dirty-marked
  and the change is undoable — identical to today.

### 4.3 Tests to add (`simulation/tests/led_gamma.test.js`)

DOM-free, `node:test`, run by `cd simulation && npm test`:

1. `quantizeGamma` snaps to the 0.05 grid and returns ≤ 2 decimals
   (`2.2749 → 2.25`; `2.3` stays exactly `2.3`, no `…0003` tail).
2. `quantizeGamma` does **not** clamp — the caller's `parseGammaField` is what
   refuses 0.9 / 3.1, and that refusal is already covered; assert the pair
   composes (parse throws, so quantize is never reached).
3. `gammaCurvePath(1.0, …)` is the identity diagonal: first point at
   (pad, H-pad), last at (W-pad, pad), and the mid sample sits on the
   diagonal within a 0.15 px tolerance.
4. `gammaCurvePath` is **monotonic non-decreasing in x** and **non-increasing
   in screen-y** for γ = 1.0, 2.2 and 3.0 (parse the path's numbers).
5. **Video clamp**: at γ = 3.0 the first sample after x = 0 has screen-y
   strictly above the plot floor (i.e. y ≥ 1/255 → never full black), and
   x = 0 is exactly on the floor.
6. Endpoints: every γ starts at (0,0) and ends at (1,1) in curve space.
7. `LED_GAMMA_PRESETS` — three entries; every `gamma` passes
   `validateGammaMirror`; `srgb` deep-equals `LED_GAMMA_RECOMMENDED`;
   **every preset has `w === 1.0` except `off`** (the doctrine guard — this
   test is the reason a future edit can't quietly adopt the firmware's W=2.2).
8. `activeGammaPresetKey` returns the key for each preset curve, `null` for a
   hand-tuned curve, and tolerates float noise (`2.2000001 → 'srgb'`, via
   `gammaEquals`).
9. `GAMMA_CURVE_GEOMETRY` sanity: `pad*2 < width`, `pad*2 < height`,
   `samples ≥ 24`, `clampFloor === 1/255`.

**Guard-rail (from `_59`):** any *new* `ctx` object built in a sim test must
include `claimedUniverses: () => new Map()`. The tests above need no ctx.

**Baseline to preserve** (`_59`): `1099 tests / 1091 pass / 8 fail`; the 8 are
the known pre-existing stale-model family (TE Sign V3 A/B duplicate names +
stale `test_bench` / `titanic` model exports) and must be byte-identical
before and after. Also run `node --check` (as ESM) on every edited file.

### 4.4 Visual verification

`_65` verifies with the puppeteer renderer only — `.agent/skills/see_the_world.md`,
`node agent_render.cjs --show-ui --viewport 1280x720` with the Controllers
pane open — **never** a built-in web tool, and **never** against the
operator's live stack while he is running lit hardware. If the sim stack is
busy, hand the visual check to the operator and say so; do not start a second
stack (port topology memory: one stack on the standard ports).

---

## 5. Findings, flags, and what stays with the operator

### 5.1 Operator-gated

1. **Any actual curve change on the fleet is a device write.** A gamma-only
   write applies **live, no reboot** (verified 2026-07-28, docs/41), so it is
   cheap — but it changes what the audience sees. `_65` ships the control; the
   operator presses ⬆ Push gamma / ⬆ Push gamma to all.
2. **The controller's own web console will still have no gamma card.** Its
   flashed UI image predates the feature. Putting the card on the device is a
   private-repo build + flash — operator's call, in the other repo, not here.
3. **Preset doctrine.** Ours hold W at 1.0 where the firmware's set W to the
   RGB exponent. Documented and test-guarded; flagging it so the operator can
   overrule if he wants firmware parity instead.

### 5.2 Confirmed on the device (GET-only, no writes)

`10.x.x.60`: `gamma` = 1/1/1/1 (**curve off**), `capabilitiesExt.gammaRgbw`
= true, config `version` 3.1.0. No config was written, nothing rebooted.

### 5.3 Deferred, filed — gamma push does not persist the scene

A verified gamma push mutates the mirror **in memory** and marks the scene
dirty; with `autoSave: false` the curve is not in `controllers.yaml` until a
manual save. Reload before saving and the mirror silently reverts while the
**hardware keeps the pushed curve** — mirror and hardware diverge, which is
the exact invariant `led_gamma.js` exists to protect. Blast radius is smaller
than `_58`'s (the preview lies; the strands are correct), and the drift chip
would show it after a reload, but it is the same shape of bug.

**Fix belongs in `_66`** — unblocked now that S1 landed (`_61`):
`runSingleGammaPush` and the fleet run should `await` the same persist step
after a verified push and report it in the toast (`✓ verified on hardware ·
✓ scene saved`), failing loudly and naming the stale layer otherwise.
**No bridge notify** — gamma changes no universe, no route, no patch record.
Implementation note for `_66`: `persistScene` is currently module-private
inside `led_discovery_panel.js`'s `DEFAULT_DEVICE_IO`, so `_66` either
exports it or gives `led_gamma.js` its own injectable one-member io bag
following the same pattern (fail loudly when `window.exportConfig` is
missing; injectable so tests never save a scene). Kept out of `_65` because
it changes push *semantics*, not the control's look — the operator's order
was about the control.

---

## 6. `_65` brief (copy-paste)

> Replace the four gamma **number boxes** on every LED controller card in the
> sim's Controllers panel with the firmware-style control: **four sliders
> (1.00–3.00, step 0.05, read-only 2-dp readouts), a Link RGB toggle (default
> on, W always independent), three preset chips (Off / 2.2 sRGB / Punchy), and
> a live inline-SVG curve plot** of all four `y = x^γ` curves with the quarter
> grid, the dashed identity diagonal, the 1/255 video clamp, and a dashed
> ghost of the last hardware-verified curve when the mirror has drifted.
> Follow §3 (presentation), §4 (exact files, anchors, new pure exports,
> validation rules) and §4.3 (tests) of this report verbatim.
> **Files:** `simulation/src/dmx/led/led_gamma.js` (add pure helpers),
> `simulation/src/gui/led_gamma_ui.js` (rewrite `renderGammaSection` lines
> 62–141), `simulation/style.css` (gamma block + 4 root vars),
> `simulation/tests/led_gamma.test.js` (append), `docs/41` §4.1(d) (one
> sentence). **Touch nothing else** — `led_discovery_panel.js`,
> `controller_map_editor.js`, `gui_builder.js` and the server files were just
> rewritten by S1 (`_61`); leave them alone. Offline P0: inline SVG only, no library, no CDN, no
> font. No device writes, no scene saves, no git operations; visual check via
> `agent_render.cjs --show-ui` only, and only if the sim stack is free.

---

## Evidence index

- `~/tmp/led_gamma_recon/` — firmware UI assets fetched by GET
  (`index.html`, main bundle, stylesheet, 4 lazy chunks) + the grep results
  showing **0** gamma occurrences in the served build. **Untracked on
  purpose.**
- `~/tmp/led_controller_debug/recheck_20260730T175802Z.txt` — GET
  `/api/status` + `/api/config` + `/api/board` + `/api/version`:
  `gamma {r,g,b,w} = 1/1/1/1`, `capabilitiesExt.gammaRgbw: true`,
  config `version 3.1.0`.
- Private firmware repo (read-only, outside this repo): the per-channel gamma
  design note + the "Color Curves" React card — presentation described in
  §1.2; **no source reproduced here**.
- Sim: `simulation/src/gui/led_gamma_ui.js:62-141` (the textboxes),
  `:177-279` (fleet push); `simulation/src/dmx/led/led_gamma.js` (mirror,
  validation, orchestration); `simulation/server/led_gamma_service.cjs`
  (backup → partial write → verify); `simulation/src/dmx/led_wire.js:106`
  (`RECOMMENDED_CONTROLLER_GAMMA`); `simulation/style.css:2998-3092`;
  call sites `simulation/src/gui/controller_map_editor.js:968,1239`.
- Prior reports: `20260725_58_push_save_workflow_plan.md` (six state layers,
  slices S1–S5), `20260725_59_push_gate_registry_claims.md` (S2 landed; the
  required `claimedUniverses` ctx member; the 1099/1091/8 test baseline).
- `docs/41_led_controller_onboarding.md` §4.1(d) — the existing gamma
  contract, live-verified `applied` / no-reboot behaviour, float32 read-back
  note.

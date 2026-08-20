# 20260725_65 — LED gamma "curve" control: implementation

Implements the design in `20260725_64_led_gamma_ui_design.md` §3–4 against the
operator order:

> "check the gamma UI and curve in the firmware and allow a similar setting
> for the LED controllers from the LED controller config ui in the sim please
> instead of plain textboxes which I don't understand at all."

**Scope discipline this slice ran under (LIVE-MAPPING LOCKDOWN):** code + unit
tests only. **No browser session against the sim, no scene save, no device
HTTP of any kind (not even a GET), no restarts, no git operations, nothing
under `simulation/scenes/**` or `marsin_engine/**`.** The operator is running
lit hardware; the visual check is handed to him (§5).

---

## TL;DR

The four `<input type="number">` gamma boxes on every LED controller card are
gone. In their place, matching the controller's own "Color Curves" card in the
sim's visual language:

- **four R/G/B/W sliders**, 1.00–3.00, step 0.05, channel-coloured, each with a
  **read-only 2-dp readout**;
- a **Link RGB** checkbox, **on by default** — R/G/B move together, **W is
  never linked**;
- three **preset chips** — `Off` (1/1/1/1), `2.2 sRGB`
  (= `LED_GAMMA_RECOMMENDED`), `Punchy` (2.6/2.6/2.6/1.0) — the active one
  lights up;
- a **live inline-SVG curve plot** (132 × 84) of all four `y = x^γ` curves over
  a quarter grid, with the **dashed identity diagonal** as the "curve off"
  reference, the **1/255 video clamp** drawn honestly, and a **dashed ghost of
  the last hardware-verified curve** whenever the mirror has drifted from it;
- caption `y = x^γ · applies live — no reboot`.

Everything behind the control is byte-identical: the mirror, `parseGammaField`
/ `validateGammaMirror` (1.0–3.0, throws loudly), the gamma-only push, the
read-back verify, `commitGammaPush`, the fleet run, the provenance chip and the
red error line. This was a **presentation** slice, exactly as `_64` scoped it.

---

## 1. What changed, file by file

### 1.1 `simulation/src/dmx/led/led_gamma.js` — new pure exports

Added one section after `formatGamma`, before `// ── Transport`. **Nothing
existing was removed or edited** — `parseGammaField`, `validateGammaMirror`,
`formatGamma`, `gammaEquals`, `setGammaMirror`, `commitGammaPush`,
`pushGammaToController`, `pushGammaFleet` and `summarizeFleetResults` are
untouched.

| export | what it is |
|---|---|
| `LED_GAMMA_STEP = 0.05` | slider granularity |
| `LED_GAMMA_PRESETS` | the three chips (`off` / `srgb` / `punchy`), each `{key,label,gamma,title}`, frozen |
| `GAMMA_CURVE_GEOMETRY` | `{width:132, height:84, pad:5, samples:48, clampFloor:1/255}`, frozen |
| `quantizeGamma(v)` | snaps to the 0.05 grid **and** to 2 dp; **never clamps**; throws on a non-finite input |
| `gammaCurvePath(γ, geom?)` | the `M…L…` path for one channel, in plot pixel space |
| `activeGammaPresetKey(gamma)` | `'off' \| 'srgb' \| 'punchy' \| null`, via `gammaEquals` |

The curve maths exists **only** here — the UI module asks for a path string and
draws it, which is what makes the plot unit-testable with no DOM.

Two notes on `quantizeGamma`:

- The double rounding is not cosmetic. `Math.round(v/0.05)*0.05` alone yields
  `2.3000000000000003`, which would land verbatim in `controllers.yaml`.
- It **snaps only**. Clamping would be a silent fallback (codex P0) that hides a
  caller bug; refusing an out-of-range number is `parseGammaField`'s job and it
  already does it loudly. Test 2 asserts both halves of that split.

### 1.2 `simulation/src/gui/led_gamma_ui.js` — `renderGammaSection` rewritten

Only that function's body changed (plus the import list, the module header's
"four fields" sentence, and one new module-private helper `buildCurveSvg` +
the `CH_LABEL` map). **`runSingleGammaPush` and `startFleetGammaPush` are
byte-identical.** Both call sites in `controller_map_editor.js` (`:968`,
`:1239`) are byte-identical — the whole new row lives inside the function, as
designed.

Structure emitted:

```
.cm-led-gamma
├─ .cm-led-gamma-head   gamma · [Off][2.2 sRGB][Punchy] · ☑ Link RGB · ⬆ Push gamma · prov chip
├─ .cm-led-gamma-body   .cm-led-gamma-plot (inline SVG) + .cm-led-gamma-sliders (4 × row)
├─ .cm-led-gamma-caption  y = x^γ · applies live — no reboot
└─ .cm-led-gamma-error    (hidden until a throw)
```

**Interaction contract, as specified:**

- `oninput` (dragging) writes a **local draft object** and repaints the SVG,
  the readouts and the preset chips. **No `ctx.mutate`, no scene write, no
  `ctx.refresh`** — a drag cannot flood the undo stack or re-render the pane
  under the operator's finger.
- `onchange` (release / keyboard commit) runs the value through
  `parseGammaField(String(value), ch)` → `quantizeGamma` → **exactly one**
  `ctx.mutate("Set '<name>' gamma <ch|rgb> = <v>", …)`, then re-seeds the draft
  from the mirror. One undo entry per gesture, identical to the old textbox.
- A throw keeps the existing behaviour — red error line + error toast — and
  additionally **puts the sliders back on the mirror** (the truth), rather than
  leaving the plot showing a curve the scene does not hold. That is a refusal,
  not a fallback.
- **Link RGB** state is a per-render closure variable — **ephemeral UI state,
  never written to `controllers.yaml`**. Checked ⇒ an R/G/B commit sets all
  three and leaves W alone. W's slider is never linked, in either direction.
- A preset chip is one `ctx.mutate` setting all four channels.

**The plot** is an inline SVG string assigned to a wrapper `div.innerHTML` —
the established convention in this codebase (`control_drawer.js`,
`left_drawer.js`, `split_layout.js`); there is no `createElementNS` anywhere in
`simulation/src/`. No library, no CDN, no font — offline P0 satisfied by
construction. Draw order: background rect → quarter grid → dashed identity
diagonal → ghost curves (only on drift) → the four live curves. Every colour is
a CSS class, so the stylesheet owns the palette.

### 1.3 `simulation/style.css`

- Four new `:root` vars — `--gamma-r/-g/-b/-w`. **Fixed hues by design**, same
  rationale as the existing `--caution`: R/G/B/W must read as R/G/B/W in every
  palette or the plot lies about which curve is which. (`--gamma-w` derives
  from `--text` so it stays legible on any background.) The theme-parity test
  only asserts the gruvbox tokens are *present* in `:root`, so extra vars are
  safe — verified by running it.
- Gamma block rewritten: `.cm-led-gamma` becomes a column; new
  `-head`, `-body`, `-plot`, `-sliders`, `-row`, `-row-<ch>`, `-slider`,
  `-val`, `-preset` (+ `.cm-on`), `-link`, `-caption` rules, plus the SVG
  classes `.cm-gamma-plot-bg/-grid/-ident/-curve/-ghost/-r/-g/-b/-w`.
  Per-channel `accent-color` on the sliders and per-channel colour on the
  channel letters, both from the four vars.
- **Deleted as dead CSS** (no longer emitted anywhere — grepped the whole
  repo): `.cm-input.cm-led-gamma-input`,
  `.cm-input.cm-led-gamma-input.cm-led-gamma-bad`, `.cm-led-gamma-field`.
- `.cm-led-gamma-push`, `.cm-led-gamma-prov`, `.cm-led-gamma-drift`,
  `.cm-led-gamma-error`, `.cm-push-all-gamma` and the fleet-row rules are
  untouched — including the pre-existing `var(--warning, #e0a030)` fallback the
  design flagged as a **separate** cleanup. Left alone deliberately.

### 1.4 `simulation/tests/led_gamma.test.js`

Appended the nine cases `_64` §4.3 lists, as one "curve geometry + presets +
quantize" section. Existing tests untouched. All DOM-free; none needs a `ctx`,
so the `_59` `claimedUniverses: () => new Map()` guard-rail did not come into
play (no new ctx object was built).

1. `quantizeGamma` snaps to the grid, stays at 2 dp (`2.2749 → 2.25`; `2.3`
   stringifies as exactly `'2.3'`, no `…0003` tail); throws on non-finite.
2. `quantizeGamma` does **not** clamp (`0.9 → 0.9`, `3.1 → 3.1`) and the pair
   composes — `parseGammaField` throws first, so quantize is never reached.
3. `gammaCurvePath(1.0)` is the identity diagonal: first point `(pad, H-pad)`,
   last `(W-pad, pad)`, mid sample on the diagonal within 0.15 px.
4. Monotonic for γ = 1.0 / 2.2 / 3.0: x strictly rises, screen-y never rises.
5. **Video clamp**: at γ = 3.0, x = 0 sits exactly on the plot floor and the
   first lit sample is strictly above it — a dim pixel never reads as black.
6. Endpoints `(0,0)`→`(1,1)` for every γ; γ ≤ 0 and non-numeric throw.
7. `LED_GAMMA_PRESETS`: three entries in order, every curve passes
   `validateGammaMirror`, every value on the 0.05 grid, `srgb` deep-equals
   `LED_GAMMA_RECOMMENDED`, and **every preset has `w === 1.0`** — the doctrine
   guard, so a future edit cannot quietly adopt the firmware's W = 2.2.
8. `activeGammaPresetKey` returns each preset's key, tolerates float32
   read-back noise (`2.2000001 → 'srgb'`), and returns `null` for a hand-tuned
   curve and for `null`.
9. `GAMMA_CURVE_GEOMETRY` sanity: `pad*2 < width`, `pad*2 < height`,
   `samples ≥ 24`, `clampFloor === 1/255`.

### 1.5 `docs/41_led_controller_onboarding.md` §4.1(d)

The one sentence `_64` specified — "r/g/b/w gamma fields" becomes the slider +
live curve preview + presets (Off / 2.2 sRGB / Punchy, all holding W at 1.0) +
Link RGB description. `⬆ Push gamma` / `⬆ Push gamma to all` wording, the
existing full-IP convention and everything else in the file unchanged.

---

## 2. Files touched (and only these)

```
simulation/src/dmx/led/led_gamma.js       + pure helpers (nothing removed)
simulation/src/gui/led_gamma_ui.js        renderGammaSection rewritten
simulation/style.css                      gamma block + 4 root vars
simulation/tests/led_gamma.test.js        + 9 cases
docs/41_led_controller_onboarding.md      1 sentence in §4.1(d)
.agent/reports/202607/20260725_65_led_gamma_ui_impl.md   (this file)
.agent/projects/bm26_show_readiness.md    _65 marked landed
```

**Not touched**, per the concurrency lockout: `led_discovery_panel.js`,
`controller_map_editor.js`, `gui_builder.js`, `patch_manager.js`,
`device_config_mapper.js`, `server/**`, `agent_tools/**`, `scenes/**`,
`marsin_engine/**`.

---

## 3. Tests

`cd simulation && npm test`:

| run | tests | pass | fail |
|---|---|---|---|
| baseline (measured at slice start, this branch) | 1111 | 1103 | 8 |
| after `_65` | 1130 | 1122 | 8 |

- **This slice's own delta is +9**, all in `tests/led_gamma.test.js`, which now
  runs **29 / 29 green** (20 pre-existing + 9 new).
- The other **+10** landed concurrently from S4's work in other files — the
  brief's baseline-drift warning, confirmed. `_64`'s recorded baseline was
  1099/1091/8, so the tree gained 31 tests from other slices while this one ran.
- **Failures unchanged at 8**, and they are byte-for-byte the known
  pre-existing stale-model family — nothing in the gamma, GUI or theme files:
  fixtures-docked-beside-the-ship, titanic-scene-accepts-the-block,
  view-bit-headroom, the two model-emit CLI cases, the two `test_bench`
  real-scene cases, and the `titanic` real-scene case.
- `node --check` clean (as ESM) on all three edited JS files.
- Theme-parity test still green — the four new `:root` vars do not disturb it.
- Line length ≤ 100 chars on every line this slice added.

---

## 4. Deviations from the `_64` design

Three, all small, all deliberate:

1. **`quantizeGamma` throws on a non-finite input** (the design only specified
   "no clamping"). Returning `NaN` would be a silent-corruption path into the
   mirror; a throw is the codex-consistent behaviour and is test-asserted.
   Same for `gammaCurvePath` with γ ≤ 0 or non-numeric.
2. **Plot colours are CSS classes on the SVG elements, not `color-mix()`
   inline in presentation attributes.** The design's intent — "the stylesheet
   owns the palette and the SVG just references the vars" — is better served
   this way, and it avoids depending on `color-mix()` parsing inside SVG
   presentation attributes. The four `--gamma-*` root vars are exactly as
   specified; the grid / diagonal / background still derive from
   `--text` / `--input-bg` / `--ghost-border` via `color-mix`, just in the
   stylesheet rather than in the markup.
3. **`LED_GAMMA_PRESETS.srgb.gamma` is a frozen *copy* of
   `LED_GAMMA_RECOMMENDED`**, not the same object reference. Deep-equal either
   way (test 7 asserts it); the copy just stops the preset table from aliasing
   a constant that another module owns.

Everything else — geometry, sample count, clamp floor, preset set and W-at-1.0
doctrine, the oninput/onchange split, Link-RGB semantics, the ghost curve, the
caption, the untouched push path — is as `_64` §3–4 specifies.

The design's §5.3 gap is **not** addressed here, as instructed: a verified
gamma push still mutates the mirror in memory only. That stays `_66`.

---

## 5. For the operator

1. **Nothing was pushed to any controller and nothing was saved.** The lockdown
   held: zero device HTTP (not even a GET), zero browser sessions, zero scene
   saves, zero git operations. The `.60` is exactly where `_64` left it —
   gamma 1/1/1/1, curve **off**.
2. **The visual check is yours.** `_64` §4.4 calls for
   `agent_render.cjs --show-ui --viewport 1280x720` with the Controllers pane
   open, but that means a browser session against the sim, which the lockdown
   forbids while you are running lit hardware. Reload the sim when you are
   free, open Controllers → any LED controller card, and the curve control is
   there. (Hard-reload so the new `style.css` is picked up.)
3. **Moving a slider changes the PREVIEW only.** A real curve change on the
   fleet is still a device write behind **⬆ Push gamma** / **⬆ Push gamma to
   all** — and a gamma-only write **applies live, no reboot** (verified
   2026-07-28). Cheap to try, but it changes what the audience sees.
4. **The controller's own web console still has no Color Curves card.** Its
   flashed UI image predates the feature; putting the card on the device is a
   private-repo build + flash, your call, in the other repo. The sim control is
   the supported path meanwhile.
5. **Preset doctrine, flagged for a veto:** our `2.2 sRGB` and `Punchy` chips
   hold **W at 1.0**, where the firmware's equivalents put the RGB exponent on
   W too. Ours is the docs/41 §4.1(d) rule (white is derived *after* the RGB
   curve, so a second exponent compounds and crushes pastels) and it is now
   test-guarded. Say the word if you want firmware parity instead.
6. **Still open (`_66`):** a verified push mirrors the curve in memory only —
   with autoSave off, reload before saving and the mirror reverts while the
   hardware keeps the pushed curve. Save the scene after a push until `_66`
   lands.

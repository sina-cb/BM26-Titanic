---
name: vsn1_mock_ui_design
status: active
owner: planner agent (design) → developer agent (build); operator: Sina
created: 2026-07-08
updated: 2026-07-08
---

# VSN1 interactive HTML mock — design + implementation spec

## Goal

A **standalone, self-contained, interactive HTML mock of the Intech VSN1**
(Sina's effects surface) that opens in a browser and looks/behaves like the
physical device running our deployed `effects_layout` config — welcome
screen, 2×4 LCD grid, jog-wheel value edits, mode cycling, page flashes,
sticky toggle LEDs, 5-LED encoder bar — **without the hardware**. Baseline
is fully offline (embedded demo layout); an optional LIVE mode mirrors the
running engine. Scope: **VSN1 only** (not MFT/APC).

This dossier is the complete build spec. The implementing agent should not
need to re-derive anything — but every number below is traceable to a
source-of-truth file, listed next, and when in doubt **the Lua templates
win** over this doc.

## Source-of-truth files (read before building)

| What | File |
|---|---|
| Hardware facts (LCD 320×240, 8 Hall-effect keys, endless jog, 4 side buttons, RGB per element) | `docs/42_vsn1_controller.md` |
| LCD INIT: grid renderer `gdw`, selection, welcome flag, page-flash arming | `marsin_engine/tools/vsn1_config/templates/effects_layout/lcd_init.lua` |
| LCD DRAW: full live-screen layout, welcome/flash branching (pixel recipe) | `.../effects_layout/lcd_draw.lua` |
| Welcome art `wdw`, flash box `fdw`, 5-LED bar `ebar` (exact formulas) | `.../effects_layout/system_init.lua` |
| MIDI feedback receiver semantics (what the host pushes at the device) | `.../effects_layout/encoder_init.lua` |
| Encoder turn (relative edit, clamp, absolute CC out) / press (mode cycle) | `.../effects_layout/encoder_turn.lua`, `encoder_press.lua` |
| Key LED init + toggle-key BC (stateless press) | `.../effects_layout/key_init.lua`, `key_bc_toggle.lua` |
| Side-button page change + press-only guard | `.../effects_layout/side_button.lua` |
| Palette fallback, abbreviation algorithm, name clamps, empty-slot color | `marsin_engine/tools/vsn1_config/deploy_layout.cjs` (PALETTE, `abbreviate()`, MAX_NAME_LEN 12, EMPTY_COLOR) |
| Deployed behavior narrative + LCD Lua API semantics | `marsin_engine/tools/vsn1_config/README.md` |
| Two-step toggle / trigger-every-press host semantics | `.agent/reports/202607/20260709_4_e2e_vsn1_verify.md` (verdict table + hardware script) |
| Engine layout/status API shapes | `marsin_engine/lib/global_effect_slot_manager.js` (`getLayout()`, `getStatus()`), `marsin_engine/lib/api_server.js` (`GET /global-effects/layout`, CORS `ACAO:*` at ~line 4020) |

Confirmed hardware facts used throughout: LCD is **320×240 px**; the endless
encoder has **exactly 5 addressable LEDs** (grid-fw `grid_esp32s3.c`; Sina
counted 5 on the unit); side buttons are **4 small tactile buttons under the
screen** (product page); Sina's unit is a **VSN1L — "Left Screen"** variant
(all dumps are `vsn1_VSN1L_*`); factory key/LED mapping puts the 8 keys at
elements 0–7, encoder 8, side buttons 9–12, LCD 13.

---

## 1. Visual spec

### 1.1 Overall page

- Single HTML file, dark stage: page background `#0c0d10`, the device
  floating centered with a soft drop shadow (`0 24px 80px rgba(0,0,0,.6)`).
- Above/below the device, minimal chrome in a system font stack
  (`-apple-system, "Segoe UI", Roboto, sans-serif`): a small title
  ("VSN1 — effects surface mock"), the LIVE-mode toggle (§3), and an
  optional collapsible MIDI event log (§2.6). **No external fonts, no CDNs,
  no fetches except the engine in live mode** (offline codex rule).
- Everything scales from one CSS variable `--u` (device scale unit) so the
  whole unit can be resized; default sized so the LCD renders at **2×**
  (640×480 CSS px) — crisp on a laptop, honest pixels.

### 1.2 Device body (VSN1L)

Dark, premium, faithful silhouette. Proportions below are the design
target; the implementer should eyeball the product photo at
<https://intech.studio/shop/vsn1> once while online and tune the silhouette
(the artifact itself must embed nothing external).

- **Body**: rounded rectangle (~16px radius at 2× scale), near-black
  charcoal `#17181c` with a subtle 1px lighter edge (`#2a2c33`) and a very
  soft top-light vertical gradient (+4% lightness at top). Matte plastic
  feel: no glossy highlights. Aspect roughly **2:1 (wide)**.
- **Left half** (this is the "L" variant):
  - The **LCD** in a recessed bezel: bezel `#000` with 2px inner radius,
    1px rim `#2a2c33`. Screen = the 320×240 canvas at 2× (§1.4).
  - **4 side buttons (sb0–sb3)** in a horizontal row directly **under the
    screen**, evenly spaced across the LCD width: small rounded-square
    tactile buttons ~26×18 CSS px, cap `#26282e`, 1px rim, each with a tiny
    LED dot (§1.6). Label them `sb0…sb3` in 9px grey `#5a5d66` beneath
    (mock affordance; the real caps are blank).
- **Right half**:
  - **Jog wheel** centered in the upper region: outer ring diameter
    ~170 CSS px. Render as three concentric parts: (a) a dark ring
    `#101114` with a fine radial knurl texture (repeating-conic-gradient,
    2° steps, ±3% lightness), (b) the **LED ring channel** — a thin
    (~6px) recessed track just inside the outer edge where the 5 LED
    points live (§1.6), (c) a slightly domed center cap `#1d1f24`
    (~55% of diameter) which is the **press** target. A faint rotation
    indicator dot on the ring that actually rotates with drag input sells
    the "endless" feel.
  - **8 keys** below the wheel in a **2 rows × 4 columns** grid (this
    matches the LCD grid mapping: key *k* → column `k % 4`, row
    `k // 4`; top row = keys 0–3 left→right, bottom row = keys 4–7).
    Each key: MX-style keycap ~64×64 CSS px, 10px gap, cap top `#202227`,
    darker 3px "skirt" below-right for depth, 6px radius. Under each cap,
    the RGB LED glow (§1.6). Pressed state: translate down 2px + skirt
    shrinks (tactile).
- A small engraved wordmark (`VSN1`, grey `#3a3d45`, letter-spaced) in a
  corner of the body. Optional: the Grid magnetic-edge notches on the sides
  as subtle darker insets — decoration only.

### 1.3 Color language

| Token | Value | Use |
|---|---|---|
| Mars orange | `rgb(226,88,34)` | Welcome disc/rule, flash border — the MarsinLED brand color (exact from `system_init.lua`) |
| Empty slot | `rgb(30,30,30)` | Empty key LED color + LCD abbr color (`EMPTY_COLOR`) |
| Slot palette (fallback by key position 0–7) | `[255,40,40] [255,140,0] [255,220,0] [60,220,60] [0,200,200] [60,120,255] [160,60,255] [255,60,200]` | key LEDs, LCD cells, value bar (`deploy_layout.cjs PALETTE`) |
| LCD chrome greys | value bar bg `rgb(40,40,40)`, mode text `rgb(200,200,200)`, page text `rgb(140,140,140)`, welcome sub `rgb(170,170,170)` | exact from `lcd_draw.lua` / `system_init.lua` |
| ON marker | `rgb(60,255,60)` | LCD "ON" text |

### 1.4 LCD rendering — pixel-faithful contract

- `<canvas width="320" height="240">`, CSS-scaled 2× with
  `image-rendering: pixelated;`. All drawing in **device pixels** on the
  320×240 surface. Background black; the panel has a slight glow —
  optionally add a faint `box-shadow: 0 0 24px rgba(80,120,200,.08)`.
- Implement the **Grid Lua LCD API 1:1 as JS functions**, then
  **transliterate `lcd_draw.lua` + `system_init.lua`'s wdw/fdw directly** —
  do not re-lay-out by eye. Primitives (colors are `[r,g,b]`):
  - `drawAreaFilled(x1,y1,x2,y2,c)` → `fillRect(x1, y1, x2-x1+1, y2-y1+1)`
    (Lua coords are inclusive corners).
  - `drawRectangleRounded(x1,y1,x2,y2,r,c)` — stroked rounded rect,
    1px line.
  - `drawRectangleRoundedFilled(x1,y1,x2,y2,r,c)` — filled; note
    `wdw` uses radius 30 on a 60×60 rect = a **filled circle**.
  - `drawTextFast(text, x, y, size, color)` — **fixed glyph advance =
    `size` px, y = TOP of the glyph box**. Proof from the welcome screen:
    `"Marsin"` at x=16 size 32 ends exactly at 16+6·32=208, where `"LED"`
    starts. Render each character individually: char *i* centered in the
    box `[x + i*size, y] .. [x + (i+1)*size, y + size]`, using a bold
    monospace stack (`"Consolas, 'Cascadia Mono', 'Courier New', monospace"`,
    weight 700, `font-size ≈ 0.9*size`, `textAlign:center`,
    `textBaseline:middle` at `y + size/2`). The real device font is an
    unknown bitmap face — fidelity target is the **layout metrics**
    (advance/positions/sizes), not glyph shapes. Tune the 0.9 factor by
    comparing the welcome screen against these anchor points.
  - `drawSwap()` — with a single canvas this is a no-op; keep the call
    sites so the JS mirrors the Lua structure.
- Repaint model: a dirty flag + `requestAnimationFrame`, mirroring the
  device's `dirty` gate. (The device draws at 40 Hz; rAF is fine — the
  only real-time constant that matters is the 0.5 s flash.)

### 1.5 LCD content — the three states (exact recipes)

**A. WELCOME (boot)** — shown on page load until first interaction
(any key/side-button/encoder input) or, in live mode, the first successful
engine contact (the "hello" equivalent). From `wdw` in `system_init.lua`:

```
clear 0,0,319,239 black
rounded-filled  130,30 → 190,90  r=30           rgb(226,88,34)   (orange disc)
text "Marsin"   x=16  y=116 size=32             white
text "LED"      x=208 y=116 size=32             rgb(226,88,34)
filled          16,158 → 303,163                rgb(226,88,34)   (rule)
text "welcome aboard"  x=48 y=184 size=16       rgb(170,170,170)
```

**B. LIVE SCREEN** — from `gdw` (`lcd_init.lua`) + `lcd_draw.lua`. With
`sel` = selected key 0–7, `page` = current page 0–3, slot index
`si = page*8 + sel`, `v = vals[si] (0..127)`, `c = cls[sel]` (slot color):

```
clear black
GRID (top, y 0..105): for i in 0..7:
  x = (i%4)*80 ; y = (i//4)*53                 (cells 80×53, 4 cols × 2 rows)
  if i == sel:
    filled x+2,y+2 → x+78,y+51 in cls[i]
    abbr text at x+8, y+18, size 16, in CONTRAST color:
      (r*3 + g*6 + b > 1280) ? black : white   (luma rule, exact)
  else:
    abbr text at x+8, y+18, size 16, in cls[i]  (empty slots: rgb(30,30,30) — near-invisible, faithful)
BOTTOM:
  full name        x=16  y=118 size=24  color c
  value number     x=250 y=118 size=24  white          (tostring(v), integer)
  mode name        x=16  y=156 size=16  rgb(200,200,200)
                   = modeNames[sel][ mods[si] ] or "-"
  "ON" (if active) x=200 y=156 size=16  rgb(60,255,60)
  "P"..page        x=286 y=156 size=16  rgb(140,140,140)
  value bar bg     16,200 → 303,222     rgb(40,40,40)
  value bar fill   16,200 → 16+w,222 in c, where w = floor(v*288/127); skip if w==0
```

**C. PAGE FLASH** — overlay for **0.5 s** after every page change (never at
boot; while flashing, the base is always the LIVE screen — welcome is
suppressed during a flash). From `fdw`:

```
filled          90,70 → 229,170                black
rounded stroke  90,70 → 229,170  r=10          rgb(226,88,34)
text "P"..page  x=96 y=88 size=64              white
```

Implement as: on page change set `flashUntil = now + 500ms`; repaint live
screen + overlay while active; one final repaint clears it.

**Abbreviations** (grid cell labels, ≤4 chars) — replicate
`deploy_layout.cjs abbreviate()` exactly, because live mode receives full
names and must derive identical cells: 1 word → first 4 chars; 2 words →
first 2 + first 2; 3+ words → initials (≤4). Empty slot → `"-"`.
Name clamp 12 chars, mode-name clamp 10 (display-data normalization).

### 1.6 LED behavior (exact)

- **Key LEDs** (RGB glow under each cap; render as a radial-gradient
  colored halo + a tinted keycap edge, intensity ∝ brightness 0–255):
  - Color is fixed per key = slot color (empty: `rgb(30,30,30)` — reads
    as off).
  - **Toggle slots**: brightness is **sticky** and driven ONLY by
    active-state feedback: 255 when the slot is active, 0 when not
    (`encoder_init.lua` receiver + `key_bc_toggle.lua`: a press never
    lights its own key). In the offline mock, the mock host (§2.5) is that
    feedback source.
  - **Trigger slots and empty keys**: factory **momentary tap-flash** —
    brightness 255 while pressed / ~120 ms pulse on click, then back to 0.
- **Encoder LED ring — 5 points, bottom-fill progress bar** (`ebar`):
  exactly 5 LED dots on the wheel's LED channel. Suggested placement:
  evenly spaced along the ring from bottom (LED 0 at 6 o'clock) rising up
  the **left** side to top (LED 4 at 12 o'clock) — a visual "fill from the
  bottom"; physical positions on the real unit are unverified, mark with a
  code comment. Color = **selected** slot's color. Brightness, exact
  formula per LED `i` (0..4) for value `v` (0..127):
  `b = clamp( floor((v*5 - i*127) * 255 / 127), 0, 255 )`
  → below-band LEDs full, above-band off, in-band linear ramp. Edge cases
  to self-verify: v=0 → all off; v=127 → all 255; v=64 → LEDs 0-1 full,
  LED 2 ≈ 33, LEDs 3-4 off.
  Updated on: encoder turn, key-press selection change, and (live mode)
  selected-slot value feedback — same three call sites as the device.
- **Side-button LEDs**: one small dot per sb; the **current page's** sb is
  lit (white or soft orange, brightness 255), others off — mirroring the
  host's sb-LED feedback notes `41+p`.

---

## 2. Interaction spec (offline baseline)

The mock plays BOTH roles: the device (Lua behavior above) and a minimal
"mock host" standing in for engine+CaptainPad (the device itself is
stateless by design — selection lives on the device, truth lives on the
host). From the operator's POV it must behave exactly like the verified
hardware loop (report `20260709_4`, "Hardware test script" section).

### 2.1 Key press (mousedown on a key)

1. Dismisses welcome (any user event).
2. **Selects** the key: `sel = k` — LCD grid highlight moves, bottom pane
   re-renders for that slot, encoder ring recolors + re-levels to the
   slot's value (`ebar(vals[si])`). Selection happens on EVERY press,
   including triggers and empty keys.
3. Behavior (mock-host side, mirroring `manager.handleVsn1SlotKey`):
   - **Toggle slot**: **two-step** — if the key was NOT selected before
     this press: select only, no state change. If it WAS already selected:
     toggle `active` (LCD "ON" appears/disappears, key LED sticks
     on/off).
   - **Trigger slot**: fires on **EVERY press** (no two-step): momentary
     key-LED flash; pulse the LCD "ON" marker for ~300 ms (the engine's
     trigger is momentary).
   - **Empty key**: select only; name "-", value 0, mode "-".

### 2.2 Jog wheel

- **Turn**: pointer-drag on the ring (circular gesture or simple
  horizontal/vertical drag mapped to detents) AND mouse-wheel over the
  wheel. Each detent = ±1 on the selected slot's value, clamped 0–127
  (hold Shift = ±5 for coarse, a mock nicety). Updates: LCD value number +
  bar, 5-LED ring — instantly (the device local-predicts). Turning also
  dismisses welcome. Small rotation animation of the indicator dot.
- **Press** (click the center cap): **mode cycle** —
  `mods[si] = (mods[si]+1) % len(modeNames[slot])`; LCD mode name
  advances, wraps. If the slot has no modes, display stays "-" and the
  press is a visual no-op (the real engine ignores it). On the real
  device the engine cycles and echoes; the mock host cycles locally.

### 2.3 Side buttons (sb0–sb3)

- Click sb*p* → **page change to p**: current page indicator `P<p>`
  updates, the 8 keys + LCD grid repaint to that page's slots, sb LEDs
  move, and the **0.5 s page flash** overlays the live screen.
- Mirror the device's VM-restart semantics: on page change **`sel` resets
  to 0**; values/modes/actives persist (the host is the source of truth
  and re-sends full feedback — the mock host simply keeps them).
- Idempotent: clicking the current page's sb re-flashes but changes
  nothing (harmless; matches the local+echo convergence).

### 2.4 Welcome lifecycle

- Shown on load ("boot"). Dismissed by the FIRST of: any key press,
  encoder turn/press, side-button press, or (live mode) first successful
  engine poll. Once dismissed it never returns until page reload — page
  switches do NOT re-show it (that was the fixed welcome-on-page-swap
  bug).

### 2.5 Mock host state + embedded demo layout

State: `vals[32]` (0–127, default = each slot's demo default),
`mods[32]`, `acts[32]`, `page`, `sel`. Embed a demo layout that mirrors
the real deployed engine layout (6 slots, page 0) plus two page-1 slots so
paging demonstrates something. Shape = engine layout + status merged
(exactly what `deploy_layout.cjs --from-engine` consumes):

```jsonc
[
  { "id": 1, "name": "Freeze",       "color": [255,40,40],  "behavior": "toggle",  "modeNames": ["hold","decay"] },
  { "id": 2, "name": "5 Hz Punch",   "color": [255,140,0],  "behavior": "toggle",  "modeNames": ["kick","auto"] },
  { "id": 3, "name": "Ghost Trails", "color": [255,220,0],  "behavior": "toggle",  "modeNames": ["add","replace","max"] },
  { "id": 4, "name": "Palette Crush","color": [60,220,60],  "behavior": "toggle",  "modeNames": [] },
  { "id": 5, "name": "Sparkle",      "color": [0,200,200],  "behavior": "toggle",  "modeNames": [] },
  { "id": 6, "name": "Iceberg Flash","color": [60,120,255], "behavior": "trigger", "modeNames": [] },
  { "id": 9, "name": "UV Blast",     "color": [160,60,255], "behavior": "toggle",  "modeNames": [] },
  { "id": 10,"name": "Ocean Breath", "color": [255,60,200], "behavior": "toggle",  "modeNames": ["slow","fast"] }
]
```

(Names/behaviors echo the real effects; exact set is the implementer's
call — keep ≥1 trigger, ≥1 empty page, ≥1 multi-word name so `abbreviate()`
paths all show.) Slots absent from the list are EMPTY (name "-", color
`[30,30,30]`).

### 2.6 MIDI event log (recommended, small)

A collapsible monospace strip under the device that prints what the REAL
device would emit for each gesture — priceless for Sina to sanity-check
the protocol without hardware:

```
key 2 press   → Note On  ch<page> note 34 vel 127
jog +3        → CC       ch<page> cc 34 val 87        (absolute, 32+sel)
jog press     → Note On  ch<page> note 40 vel 127     (mode cycle)
sb1 press     → Note On  ch<page> note 42 vel 127     (page select)
```

(Outgoing contract: notes `32+k`, sb `41+N`, encoder press note 40, all on
channel = page; jog value = absolute CC `32+sel`. From
`deploy_layout.cjs` / README "Device → engine".)

---

## 3. LIVE MODE (stretch — design pinned, build optional)

A toggle ("● LIVE") in the page chrome connects the mock to the running
engine so it mirrors reality. **Baseline deliverable is the offline mock;
live mode may ship in the same file behind the toggle, or as a follow-up
commit.** CORS is already open (`api_server.js` sends
`Access-Control-Allow-Origin: *`), so `fetch()` works even from a
`file://` page — no server needed.

- **Config**: engine URL input, default `http://127.0.0.1:6968`
  (persist in `localStorage`).
- **Connect** (on toggle ON):
  1. `GET /global-effects/layout` → `{ layout: { slots: [{slotId, page,
     name, color, …}] } }` — replaces the demo layout. `color: null` →
     palette fallback **by key position** (same rule as
     `deploy_layout.cjs`).
  2. `GET /global-effect-slots/status` → per-slot `{ behavior, active,
     intensity (0..1), modeValues, modeIndex, … }` → `behavior`,
     `modeNames` (clamped 10), `acts`, `mods`, `vals = round(intensity*127)`.
  3. `GET /global-effects/page` → `{ effectsPage }` → `page`.
  4. First successful round dismisses welcome (the hello equivalent).
- **Mirror loop**: poll status + page every **500 ms** and diff-apply
  (LCD/LEDs update like MIDI feedback would). A `layout` re-fetch every
  ~5 s (or on a slot-shape change in status) picks up re-layouts.
  (WS push exists on the engine; polling is the simpler v1 — note it as a
  future upgrade.)
- **Two-way (optional level 2)**: gestures POST like CaptainPad does —
  key two-step toggle → `POST /global-effect-slots/:id/toggle`, trigger →
  `POST /global-effect-slots/:id/trigger`, jog → `POST
  /global-effect-slots/:id/intensity {value: v/127}` (coalesce to ≤1
  in-flight request per slot), jog press → `POST
  /global-effect-slots/:id/mode/cycle`, sb → `PATCH /global-effects/page
  {effectsPage: p}`. Optimistic local update + reconcile on next poll.
  If level 2 is not built, live mode is read-only: gestures still move the
  local selection (device-local anyway) but value/toggle gestures show a
  brief "read-only mirror" hint instead of mutating.
- **Fail loudly (P0 — no fallbacks)**: if any fetch fails while live, show
  a red "ENGINE OFFLINE — live mode halted" banner and STOP polling;
  do **not** silently fall back to demo data. The operator explicitly
  toggles back to mock mode.
- Live indicator: the chrome shows `● LIVE <url>` green when mirroring,
  red on failure, grey when off.

---

## 4. File placement + how Sina opens it

### Options considered

| Option | Verdict |
|---|---|
| `marsin_engine/tools/vsn1_sim/` (new sibling tool dir) | **CHOSEN** — clean disjoint zone (multi_agent law), self-describing name, sits beside `vsn1_config/` (the Lua source of truth it mirrors) and `midi_discovery/` in the tools family; room for its own tiny README; zero coupling to `vsn1_config`'s npm/GPL/serial machinery. |
| `marsin_engine/tools/vsn1_config/preview/` | Rejected — `vsn1_config` is the serial deploy tool zone (own package.json, GPL deps in node_modules, dumps/, operator-gated live writes). A browser mock inside it muddies that zone's contract and its README's scope. |
| `simulation/…` | Rejected — `simulation/` is the Three.js rig sim with its own server, ports, and vendoring rules; the VSN1 mock is not part of the rig scene graph and shouldn't ride its npm/server lifecycle. |

### Recommendation

- **File: `marsin_engine/tools/vsn1_sim/vsn1_sim.html`** — ONE
  self-contained file (all CSS/JS inline, zero dependencies, zero build
  step, no external fonts/CDNs — system font stack + canvas only). Plus a
  ~15-line `README.md` in the same dir (tools-family convention): what it
  is, how to open, live-mode note, pointer back to this dossier and the
  Lua templates.
- **Snake_case** filename per codex; no npm, no package.json.
- **How Sina opens it: double-click the file** (or drag into a browser).
  Everything including live mode works from `file://` because the engine
  serves `Access-Control-Allow-Origin: *`. No static server required; if
  one is ever wanted (e.g. phone on the LAN), `python -m http.server` from
  the dir works — mention in the README, don't build anything.
- Offline-ready by construction: the only network touch in the whole file
  is the operator-initiated live-mode fetch to the local engine.

---

## 5. Implementation checklist (for the building agent)

**Headline: build `marsin_engine/tools/vsn1_sim/vsn1_sim.html` as a
1:1 transliteration of the effects_layout Lua — verify every LCD state and
LED formula against the recipes in §1.5/§1.6 with screenshots before
reporting done.**

1. [ ] Read the source-of-truth files (§0 table) — especially
   `lcd_draw.lua`, `lcd_init.lua`, `system_init.lua`. The Lua wins over
   this doc on any discrepancy; note discrepancies in the report.
2. [ ] Create `marsin_engine/tools/vsn1_sim/vsn1_sim.html` (snake_case,
   single file, inline everything; system fonts only; no CDNs).
3. [ ] LCD engine: 320×240 canvas @2× pixelated; implement the 5 draw
   primitives (§1.4) incl. the fixed-advance `drawTextFast` (advance ==
   size, y = top); then transliterate `wdw`, `fdw`, `gdw`, and the
   `lcd_draw.lua` body verbatim.
4. [ ] Device body (§1.2): VSN1L layout — LCD left + 4 sb under it; wheel
   + 2×4 keys right; dark premium styling per §1.2–1.3. Sanity-check the
   silhouette against the product photo once (do not embed it).
5. [ ] State machine: welcome → live screen; page flash 500 ms overlay;
   `sel` reset on page change; welcome dismissal rules (§2.4).
6. [ ] Interactions: key two-step-toggle / trigger-every-press / select-
   always (§2.1); jog drag+wheel turn with clamp 0–127 (§2.2); jog press
   mode-cycle with wrap; sb page switching (§2.3).
7. [ ] LEDs: sticky toggle key LEDs (feedback-driven), momentary
   trigger/empty tap-flash, sb page LED, and the 5-LED `ebar` with the
   exact formula + its three call sites (§1.6).
8. [ ] Embedded demo layout (§2.5) + `abbreviate()` replicated exactly.
9. [ ] MIDI event log strip (§2.6) — small, collapsible.
10. [ ] LIVE mode (§3) — optional; if skipped, leave the toggle out
    entirely (no dead UI), and say so in the report.
11. [ ] `README.md` in the dir: open-by-double-click, live-mode
    prerequisite (engine on :6968), rollback-free (pure viewer).
12. [ ] **Self-verify with screenshots** (browser tooling — e.g. the
    preview/Chrome MCP tools; the puppeteer `see_the_world` skill is for
    the 3D sim only). Capture and EYEBALL each against §1.5:
    - welcome screen (anchor: "Marsin"/"LED" seam at x=208; disc is a
      circle at 130,30–190,90),
    - live screen page 0 slot 0 selected (grid highlight + contrast-text
      rule on a light color, e.g. yellow → black text),
    - value bar at v=0 / 64 / 127 (w = 0 / 144 / 288) + ring LEDs
      (all-off / 0-1 full+2≈33 / all-full),
    - page flash overlay mid-flash,
    - a trigger press flash vs a sticky toggle ON,
    - empty page (P2/P3): all "-" cells, dim keys.
13. [ ] Interaction walkthrough mirroring the hardware script in
    `20260709_4` §"Hardware test script" (two-step toggle ON→OFF, trigger
    every-press, mode wrap, page switch + flash + sb LED).
14. [ ] Hygiene: no external URLs in the file except the engine default
    (`grep -i "https\?://" vsn1_sim.html`); temp files in `~/tmp/`;
    **no git ops until asked**; when a commit is requested run
    `python scripts/security_check.py --staged` first.

## Links

- **Reports:** `../reports/202607/20260708_6_vsn1_config_tool.md` (device
  behavior, addenda 7–11), `../reports/202607/20260709_4_e2e_vsn1_verify.md`
  (interaction truth), `docs/42_vsn1_controller.md`
- **Dossier:** `effects_v2_midi_layout.md` (the system this mock mirrors)
- **Branches:** `feat/party_integration_20260711`

## Decisions log

- **2026-07-08** — Mock lives at `marsin_engine/tools/vsn1_sim/vsn1_sim.html`,
  single self-contained file, opened by double-click; live mode rides the
  engine's existing `ACAO:*` CORS from `file://`. (this design)
- **2026-07-08** — LCD fidelity strategy: implement the Grid Lua draw API
  in JS and transliterate the deployed Lua, rather than re-designing the
  screen — pixel positions come from the source, not from taste. Font =
  fixed-advance monospace (advance == size), glyph shapes approximate.
- **2026-07-08** — Offline mock is the baseline; live mode optional, and
  on live failure the mock fails loudly (no silent fallback — P0).

## Next steps

- [ ] Opus developer agent builds from §5 checklist.
- [ ] Sina opens `vsn1_sim.html`, compares against the physical unit,
  files fidelity deltas (esp. font feel + encoder LED physical positions
  and fill direction).
- [ ] Optional: live-mode level 2 (two-way POSTs) once the mirror is
  proven.

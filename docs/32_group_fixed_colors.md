# 32. Group Fixed Colors — per-group fixed-color overrides from the Dimmer Rack

**Status:** implemented + smoke-tested on `feature/group-fixed-colors`
(2026-06-10, see `.agent/02_reports/202606/20260610_1_group_fixed_colors.md`) ·
**Author:** agent sessions 2026-06-09/10 · **Operator:** Sina Solaimanpour

## 1. Motivation — what the summer-camp hack proved

During the Logsville summer-camp event we needed the DJ-booth pars to hold a
steady hot pink while the rest of the rig ran the show. The on-site hack
(branch `summer_camp_after/logsville`) bolted a `djLights` override onto the
engine: a new `effects/djLights.js`, a hardcoded `'DJLights'` group match, a
config.yaml block, a GEM slot 13, and — crucially — **two** duplicated apply
sites (one inside `GlobalEffectsController.applyPixels()`, one in
`engine.js::createRenderLoop()` *after* intensity dimming, marked `// HACK:`).

It proved the operator need is real: **lock an arbitrary fixture group to a
fixed color + brightness while patterns and macros keep animating everything
else.** It also demonstrated three things to fix before this becomes a
production feature:

1. **The post-intensity apply path defeated blackout.** The hack re-painted
   the group *after* `IntensityController.apply()`, so a GLOBAL BLACKOUT /
   e-stop left the DJ pars burning. That is a safety bug, not a feature.
2. **The `enabled` flag was ignored.** Both apply sites gated on
   `brightness > 0` only, so the slot-13 toggle wrote `enabled: false` while
   the lights stayed pink.
3. **One hardcoded group, one hardcoded preset** ('hot_pink') — not
   generalizable on the playa without code edits.

## 2. Design overview

A single engine-side override table, keyed by **group name**, applied at
**one** point in the render pipeline, controlled from the CaptainPad
**Dimmer Rack** tab, persisted per scene like the section dimmers.

```text
WASM mixer render
  → applyPixels()            (legacy vintage/UV/blast overrides)
  → applyMacros()            (wash, trails, drop hit, strobe)
  → applyGroupFixedColors()  ◀── NEW — single application point
  → IntensityController.apply()   (section dimmers + blackout — final say)
  → mapPixelsToSacn → sACN out
```

### 2.1 Engine-side data model

`GlobalEffectsController` owns the runtime state:

```js
// { [groupName]: { color: [r,g,b,w,a,u], brightness: 0..1 } }
// Presence in the table === override active. No separate `enabled`
// flag — that flag is exactly what the hack got out of sync.
this.groupFixedColors = {};
```

Mutators (both throw on bad input — codex P0, no fallback behaviors):

- `setGroupFixedColor(group, color6, brightness)` — validates the group is a
  non-empty string, `color6` via the library's `validateColor6()`, and
  `brightness` is a finite number in `[0..1]`. `brightness: 0` is valid and
  means "lock this group dark" (a per-group blackout, occasionally useful).
- `clearGroupFixedColor(group)` — removes the override; returns whether one
  existed (idempotent — clearing an absent override is not an error).

The pixel math lives in a stateless apply helper,
`marsin_engine/effects/group_fixed_color.js` (snake_case per the codex; the
older camelCase effect files predate that rule), mirroring how
`colorWash.js` / `uvBlast.js` keep state in the controller and math in
`effects/`:

```js
applyGroupFixedColors({ pixels, overrides })
// for each pixel: ov = overrides[px.group]; if set,
// px.{r,g,b,w,a,u} = ov.color[i] * ov.brightness
```

One O(pixels) pass with a hash lookup per pixel, zero allocation — same hot-
path budget as the other per-frame effects.

### 2.2 Where it applies — one principled point

`engine.js::createRenderLoop()` calls
`globalEffectsController.applyGroupFixedColors(model.pixels)` exactly once,
**after `applyMacros()` and before `intensityController.apply()`**. The
hack's second (post-intensity) site is gone. Rationale:

- **After the macros** because "fixed" must mean fixed: a color wash, ghost
  trail, drop hit, or software strobe repainting the locked group would
  defeat the whole point (the DJ booth flashing white during a drop is
  exactly what the operator was trying to prevent on site). The lock is the
  last *creative* voice on those pixels.
- **Before intensity dimming and master cutoffs** because the Dimmer Rack's
  section faders and GLOBAL BLACKOUT are *safety/master* controls and must
  always have the final say (same contract as docs/28 §2.2 for macros).
  Consequences, intentionally:
  - Blackout / e-stop kills locked groups too — fixes hack bug #1.
  - A section fader at 50% scales a locked group's output by 50%. The
    override's `brightness` is the *artistic* level; the rack fader remains
    the *master* trim on top of it. Predictable, single mental model.

### 2.3 Interaction with the global effects / slot (GEM) system

This is deliberately **not** a GEM library effect and gets **no slot**:

- GEM slots bind one `(effectId, presetId)` to one button — a singleton
  toggle. Group fixed colors are an open-ended *set* of per-group
  configurations; squeezing them into the slot model is what produced the
  hack's hardcoded 'hot_pink' preset and slot 13.
- Conceptually they are **rig state**, like the section dimmers — owned by
  the Dimmer Rack, persisted per scene — not a show macro you punch during a
  set.
- `panicStop()` therefore does **not** clear them (it doesn't clear dimmer
  levels either); blackout already silences their output because the apply
  point is pre-intensity. After an e-stop release the rig comes back with
  the locked groups still locked — matching operator expectation that rig
  configuration survives an e-stop.
- Macros keep working untouched on every non-locked pixel. The only ordering
  rule is the pipeline position above.

Status surfaces through the existing
`GlobalEffectsController.getStatus().groupFixedColors` snapshot so the GEM
status endpoint/WS payloads carry it for free.

### 2.4 REST / WS API surface

All under the existing engine API server (`:6968` by default):

| Method · path | Body | Behavior |
| --- | --- | --- |
| `GET /group-fixed-colors` | — | `{ groups: string[], overrides: {...} }`. `groups` is every distinct `pixel.group` in the loaded model (the UI's picker source); `overrides` is the live table. |
| `PUT /group-fixed-colors/:group` | `{ color: number[6], brightness: number }` | Sets/replaces the override. `:group` is URL-encoded (group names may contain spaces). Unknown group → **400** (fail loudly — a typo must not silently no-op). Bad color/brightness → **400**. |
| `DELETE /group-fixed-colors/:group` | — | Clears the override. Returns `{ status: 'ok', removed: boolean }`. |

Every successful mutation broadcasts `{ type: 'groupFixedColors', overrides }`
on `/ws/control` (new entry in `ws_topic_routing.js` — low-volume operator
state, same topic as `globalEffectSlots`), so multiple connected CaptainPads
stay in lockstep.

### 2.5 Persistence

`globalsState.groupFixedColors` in `states/<model>/globals_state.yaml` —
exactly where the dimmers and blackout live, saved through the same
`stateManager.saveGlobalsState()` path and restored on boot by
`applyGlobalsState()` (which routes each entry through
`setGroupFixedColor()`, so a hand-edited bad YAML entry fails loudly at boot
instead of half-applying). No `config.yaml` block: per-scene state is the
right scope (the hack's config.yaml default was a deploy-time hardcode), and
`config.yaml` stays portable engine defaults.

### 2.6 CaptainPad — Dimmer Rack UI/UX

The Dimmer Rack tab gains a **FIXED COLORS** strip between the bypass
checkboxes and the fader card:

- One **chip per model group** (loaded from `GET /group-fixed-colors`,
  refreshed by the same lifecycle as the dimmer faders + live via the
  `groupFixedColors` WS event). A chip with an active override shows a
  color swatch dot tinted with the override color and a highlighted border;
  inactive chips are ghosted.
- **Tapping a chip opens an editor modal** (same visual language as
  `ColorPickerModal`): a hue slider (S/V pinned to 100% per the house picker
  policy), a brightness slider, a live preview swatch, and three actions —
  **APPLY** (PUT), **CLEAR** (DELETE, only shown when an override exists),
  **CANCEL**.
- Color model: the UI writes RGB from the hue (W/A/U = 0); the engine API
  stays full RGBWAU so future UI (or curl) can drive white/amber/UV
  channels. When reopening, the hue slider re-derives from the stored RGB.
- No optimistic state for the table itself — the modal applies, the engine
  broadcasts, the chips re-render from engine truth (single source of
  truth, same pattern as the GEM grid). On modal close the screen also
  refetches `GET /group-fixed-colors` so the chips converge even when
  `/ws/control` is down — still engine truth, never optimism.
- The strip is hidden entirely until the engine answers the GET (no
  groups → nothing to render; no fabricated placeholder list).

### 2.7 Safety considerations

- **Blackout/e-stop always wins** (pre-intensity apply point). Verified by
  unit test.
- **Section dimmers always win** (same reason). The Dimmer Rack page is
  self-consistent: everything on it scales everything.
- **No strobe interaction**: the override is a constant repaint, applied
  after the strobe gate, so a locked group cannot flicker — locked means
  visually steady, which is also the photosensitivity-safe choice.
- **Validation throws** end-to-end (controller + API 400s); no silent
  clamping of out-of-range colors, no defaulting of unknown groups.
- **Boot restore is strict**: malformed persisted entries crash through the
  same validators (logged via the existing `applyGlobalsState` catch with a
  visible warning, never silently dropped into a half-state).

## 3. Files touched

| File | Change |
| --- | --- |
| `marsin_engine/effects/group_fixed_color.js` | NEW — stateless apply helper |
| `marsin_engine/lib/global_effects_controller.js` | `groupFixedColors` state, `set/clear/applyGroupFixedColors`, `getStatus()` entry |
| `marsin_engine/engine.js` | single pipeline call site (after macros, before intensity) |
| `marsin_engine/lib/api_server.js` | GET/PUT/DELETE routes, persistence, WS broadcast |
| `marsin_engine/lib/state_manager.js` | restore `globalsState.groupFixedColors` on boot |
| `marsin_engine/lib/ws_topic_routing.js` | `groupFixedColors → /ws/control` |
| `marsin_engine/tests/group_fixed_colors.test.js` | NEW — unit tests |
| `CaptainPad/utils/api.ts` | `fetchGroupFixedColors` / `setGroupFixedColor` / `clearGroupFixedColor` |
| `CaptainPad/app/(tabs)/dimmer_rack.tsx` | FIXED COLORS chip strip + editor modal |

## 4. What the hack had that this intentionally drops

- The duplicated post-intensity apply block in `createRenderLoop()` (safety
  bug — defeated blackout).
- The second apply site inside `applyPixels()` (ordering bug — macros ran
  *after* it and repainted the "locked" group).
- The `djLights` GEM library entry, slot 13, and `_dispatchDjLights()`.
- The `config.yaml djLights:` block and `opts._config` plumbing.
- The unused per-group view-mask bitmask edits (`'DJ Lights'`,
  `'WallVintageLightsTop'`, …) — those belong to the logsville model, not
  to this feature.

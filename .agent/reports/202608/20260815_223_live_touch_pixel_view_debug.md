# _223 — Live Touch: "PIXEL VIEW UNAVAILABLE" + first-load theme flash

**Operator report (verbatim):** "live touch isn't working pixel view
unavailable shit please debug." Then, in the same pass: "on first load, the
touch live shows a different color, then changes to the gruvbox theme
afterwards. please fix that glitch too."

Two independent regressions, both in the Live Touch panel
(`docs/ui/touch_control*`). Neither came from waves _217 or _221.

---

## Symptom 1 — PIXEL VIEW UNAVAILABLE

### Root cause: the pixel-map editor's own auto-save invalidates the Live Touch artifact

Live Touch does not resolve geometry at runtime. It reads a pre-resolved,
offline artifact — `docs/ui/touch_control_pixel_views.json` — produced by
`simulation/tools/export_touch_control_pixel_views.mjs`. That artifact carries
a **byte fingerprint of every authoritative input**, including
`simulation/scenes/titanic/pixel_map_views.yaml`, and the reader
(`docs/ui/touch_control_pixel_views.js`, `load()`) **fails closed** the moment
any fingerprint disagrees:

```js
if (fingerprints[1] !== artifact.source.viewsFingerprint) {
  throw new Error('pixel-view artifact is stale against pixel_map_views.yaml');
}
```

`failClosed()` then paints the operator's exact string,
`PIXEL VIEW UNAVAILABLE — …`, blanks the canvas and sets `aria-disabled`.

MEASURED at the start of this session — only ONE of the five fingerprints was
wrong:

| fingerprint | state |
|---|---|
| `viewsFingerprint` (pixel_map_views.yaml) | **STALE** |
| `camerasFingerprint` | match |
| `resolverFingerprint` | match |
| `resolvedFingerprint` | match |
| `modelFingerprint` (live engine topology) | match |

The exporter's own gate agreed:
`node tools/export_touch_control_pixel_views.mjs --check` →
`stale docs\ui\touch_control_pixel_views.json`.

**What actually changed in that YAML is the important part.** Comparing the
artifact before and after a clean re-export:

```
top_down  panels 1 -> 1 | pixelCount 720 -> 720 | paint 720 -> 720
          framing zoom 1.120 -> 0.893 | glyphs moved 0  maxdelta 0.0
front/strands/te_sign                  | glyphs moved 0  maxdelta 0.0
```

**Zero glyphs moved. The resolved geometry was byte-identical.** The only
delta was `views[top_down].framing` — the saved viewport zoom/pan — plus YAML
key reordering (`label`/`layout` swapped, one `label:` dropped) from
`yaml.dump()` round-tripping.

So Live Touch was bricked by the operator **framing the 2D Pixel Map**, not by
any geometry change. The 2D Pixel Map auto-saves its layout sidecar on every
pan/zoom via `POST /save-pixel-map-views` (`simulation/server/save-server.js`),
which rewrites `pixel_map_views.yaml` — and nothing regenerated the artifact.

This was **confirmed live, mid-session**: after re-exporting at 08:07:57 the
YAML changed again at 08:14:10 (`framing.panX -0.58 → -35.58`,
`panY -34.05 → -118.05`) and Live Touch went straight back to
`PIXEL VIEW UNAVAILABLE`. The operator was panning the map while this was
being debugged. **This is a repeating brick, not a one-off staleness.**

Not wave _217 (colour autopilot / api_server / deck) and not _221 (tab
reorder). Both are innocent.

### Fix

1. **Re-exported the artifact** (`npm run pixel-views:export`) against the
   operator's current YAML. `--check` now reports `artifact is current`.
2. **Closed the loop at the source** —
   `simulation/server/save-server.js`, `POST /save-pixel-map-views`: after a
   successful write to a `titanic` `pixel_map_views.yaml`, re-run the exporter
   so the artifact can never drift from the file it fingerprints.
   The layout is already safely on disk when this runs, so an export failure
   must **not** fail the save and lose the operator's arrangement: it is
   reported in the response body and logged loudly
   (`⚠ Live Touch artifact export FAILED`) rather than passing silently.
   `child_process` is imported at the top of the file per `AGENTS.md`.

### Verification

Isolated harness (`~/tmp/fix_223/verify_pixelview.cjs`) serving the repo on a
high port, engine port 6968 **blocked at the CDP layer** so the harness could
never register a `touchPaint` owner or contend for Live Touch ownership. Same
page, two artifacts:

| artifact | `staticVerified` | console |
|---|---|---|
| stale (what the operator hit) | `false` | `PIXEL VIEW UNAVAILABLE — pixel-view artifact is stale against pixel_map_views.yaml` |
| regenerated | **`true`** | no staleness error |

Regenerated run also reports `viewId: "top_down"`, `axisX/axisY: nx/nz`,
`staticRenderCount: 1`, `reprojectCount: 1` — the 720-glyph top-down view
resolved and drew. `engineVerified` is `false` in BOTH runs **by design**,
because this harness deliberately cannot reach the engine.

Screenshot `~/tmp/fix_223/px_after_settled.png`: the VIEW selector reads
**"Top-Down"**; with the stale artifact it was empty.

Independent structural check on the regenerated artifact: 1584 glyphs, **0**
world-identity mismatches against `marsin_engine/models/titanic.js`, and
`modelFingerprint` matches the live engine topology.

---

## Symptom 2 — wrong palette on first load, then a snap to gruvbox

### Root cause: the panel paints its standalone blue palette before the CaptainPad theme can possibly arrive

Embedded in CaptainPad, the panel gets its palette by `postMessage`
(`docs/ui/touch_control_theme.js` → `applyTheme()` sets `--bg`, `--panel`, …).
Three facts make a flash unavoidable without a gate:

1. `docs/ui/touch_control.html` hard-codes a **standalone blue** palette in
   `:root` — `--bg: #1c3054`, `--panel: #24406f`, `--bg-elevated: #0b1220`.
2. `touch_control_theme.js` is loaded at **line 5736 of 5751 — the very end of
   the body**. The document is fully laid out and painted long before it runs.
3. The host only answers **after** the iframe `load` event —
   `shouldSendLiveTouchThemeOnReady(frameLoadedRef.current, …)` in
   `CaptainPad/app/(tabs)/touch_control.tsx` — then one postMessage round trip.

The theme link already stamped `theme-pending` / `theme-applied` on
`<html>`… but **no CSS rule for either class existed anywhere in the repo**.
The classes were inert. So the panel painted blue, then snapped to gruvbox.

### Fix — `docs/ui/touch_control.html`

A first-paint gate, and deliberately **not** a fallback palette (P0: no
fallback behaviours). Nothing is guessed; the paint is held until the
authoritative tokens exist:

- a **synchronous inline `<head>` script** stamps `theme-pending` when
  `window.parent !== window`. Embed detection is duplicated from the theme
  link on purpose — that file loads at the end of the body and cannot gate the
  first paint from there.
- CSS: `html.theme-pending body { visibility: hidden; }` plus
  `html.theme-pending, html.theme-pending body { background: transparent; }`
  and `html.theme-pending { color-scheme: normal; }`.
- `touch_control_theme.js` `fail()` now **releases** the gate, so a broken
  handshake shows a visible error on a visible panel, never a blank rectangle.
  The head script carries its own 3 s escape hatch for the case where the theme
  link never loads at all; it reveals and logs an error, and never substitutes
  a palette.

**Two non-obvious traps, both caught by looking at rendered pixels rather than
trusting the code:**

- `visibility: hidden` on `body` is **not enough**. An element's background
  still reaches the canvas: `html`'s background propagates to the canvas, and
  if `html` is transparent then `body`'s propagates in its place. The first
  attempt hid all the content and still painted the whole panel solid
  `#1c3054` — a contentless blue flash. Both backgrounds must go transparent.
- With `:root { color-scheme: dark; }` a transparent iframe is **not**
  transparent: Chrome paints its dark-mode canvas base `#121212`. MEASURED
  `rgb(18,18,18)` where the host's gruvbox `#282828` was expected. Neutralising
  `color-scheme` for the pending state only lets the host's own themed backdrop
  show through — so the operator sees correctly-themed pixels from frame one.

### Verification

`~/tmp/fix_223/verify_screencast.cjs` — CDP `Page.startScreencast` collects the
frames the compositor actually produced (`page.screenshot()` is far too slow
during load and misses the window under test), decodes each in-browser and
classifies four probe points against the full **blue family**
(`#1c3054`, `#0b1220`, `#24406f`, `#101a2d`) and **gruvbox family**
(`#282828`, `#1d2021`, `#3c3836`, `#32302f`).

The control is faithful: the server serves the **same file with only the gate
stripped**, so the comparison isolates this change and nothing else.

```
PRE-FIX   1173ms  BLUE[--bg #1c3054] BLUE[--panel #24406f] BLUE[--panel] BLUE[--panel]
          1190ms  BLUE[--bg #1c3054] BLUE[--panel #24406f] BLUE[--panel] other
          1200ms  BLUE[--bg #1c3054] BLUE[--panel #24406f] BLUE[--panel] other
          1226ms  gruvbox gruvbox gruvbox other        <- the snap the operator saw
          >>> WRONG-PALETTE FRAMES: 3 (1173..1200ms)

POST-FIX    33ms  other other other other
             52ms  gruvbox gruvbox gruvbox gruvbox
            546ms  gruvbox gruvbox gruvbox other
          >>> WRONG-PALETTE FRAMES: 0 — no standalone-blue pixel ever reached the screen

RESULT: PASS
```

The harness host paints CaptainPad's real gruvbox background behind the iframe
and uses the exact fifteen `LIVE_TOUCH_THEME_KEYS` values from
`CaptainPad/constants/theme.ts` → `Colors.gruvbox`, so the round trip is the
real one.

Screenshots in `~/tmp/fix_223/`, all inspected:
`before_t120ms_handshake_inflight.png` (blue), `px_after_settled.png`
(fully gruvbox, VIEW = Top-Down).

---

## Files changed

| file | change |
|---|---|
| `docs/ui/touch_control_pixel_views.json` | regenerated (build artifact) |
| `docs/ui/touch_control.html` | first-paint gate: head script + `theme-pending` CSS |
| `docs/ui/touch_control_theme.js` | `fail()` releases the gate |
| `simulation/server/save-server.js` | re-export the artifact after a pixel-map save |

`marsin_engine/**` untouched. No git operations.

## Tests

`simulation`: `node --test tests/*.test.js` — **13 failures, and the failing
list is IDENTICAL before and after this work** (captured both sides). None are
mine:

- 6 × scene/patch/CLI (`_176 §5.3`, `fixtures are docked…`, orphan patch,
  block collisions, 2 × CLI parity) — unrelated files.
- 6 × `theme_parity` — `simulation/src/gui/theme.js` is missing the
  `borderStrong` token that `CaptainPad/constants/theme.ts` now has, plus the
  `style.css` `:root` boot defaults. Fallout of the _217 COLORS work; files I
  never touched. **Worth a follow-up: the SIM's own theme is out of sync with
  CaptainPad's gruvbox.**
- 1 × `Live display orientation is a pure projection…` — **pre-existing and
  proven independent**: it calls `buildArtifact()` (re-resolving from YAML), so
  it never reads the file I regenerated. `corr(x, nx)` is **0.989143 on both
  the old and the new artifact**, against a `> 0.999` threshold. The cause is
  the operator's authored `offsets:` block in `pixel_map_views.yaml`, which
  deliberately nudges fixtures off pure projection. **The test's premise and
  the offsets feature genuinely conflict — that needs a decision, not a
  silently loosened threshold, so it was left red.**

## Does the live engine need a restart?

**No engine restart.** `marsin_engine/**` was not touched.

- **Live Touch panel + artifact:** the sim's HTTP server reads `docs/ui/**` and
  `docs/ui/touch_control_pixel_views.json` from disk per request. **Reloading
  the Live Touch tab is enough** — both fixes are live now.
- **`simulation/server/save-server.js`: needs a SAVE-SERVER restart** (part of
  the sim stack, :6970). It was NOT restarted — the operator's stack is live
  and that is the coordinator's call. **Until it is restarted, every 2D Pixel
  Map pan/zoom will re-brick Live Touch**, and the recovery is
  `cd simulation && npm run pixel-views:export` followed by a tab reload.

## Live-stack safety

No live port was bound, restarted or killed. No state-changing request was sent
to the live engine. Every browser check ran against a private static server on
ports 7223–7226 with **engine port 6968 blocked at the CDP layer**, so no
`touchPaint` owner was ever registered and Live Touch ownership was never
contended. Scratch files live in `~/tmp/fix_223/` only. The concurrent agent's
files (`simulation/scenes/*/playlists/**`,
`marsin_engine/patterns/manifest.json`, `tests/patterns/**`) were not touched.

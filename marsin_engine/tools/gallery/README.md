# Pattern Gallery — offline phone review tool

A standalone, **offline** local web gallery for reviewing BM26-Titanic
lighting-pattern visualizations on a **phone** over Tailscale.

This is a **dev/review tool**. It is completely separate from the engine and
launcher — it does not touch `engine.js`, `launcher.js`, or any config, and it
starts on its own. Node built-ins only (`http`, `fs`, `path`, `url`, `os`) — no
npm dependencies, no CDNs, no external fonts, no telemetry. Everything served
is self-contained.

## Start the server

Preferred — the **gallery launcher** (resolves the port, prints the Tailscale
phone URL up front, then spawns the server):

```bash
cd marsin_engine
node tools/gallery/gallery_launcher.mjs              # port from gallery_config.json (6965)
node tools/gallery/gallery_launcher.mjs --port 6965  # explicit override
GALLERY_PORT=6965 node tools/gallery/gallery_launcher.mjs
```

**One-action refresh — `--regen`.** `node tools/gallery/gallery_launcher.mjs
--regen` does the whole rebuild in one shot: it **wipes** the old generated
clips from `widgets/` (the gitignored scratch — never the tracked `.gitignore`),
**regenerates the full gallery data** (every pattern's STATIC + SOUND variation
via `gen_variations.mjs`), and only **then serves** it. Generation is fail-loud
(codex P0): a compile/render error aborts BEFORE the server starts, so you never
serve a half-built gallery over freshly-wiped data. Pass-through flags forwarded
to the generator: `--model`, `--seconds`, `--fps`, `--pattern` (subset; omit for
the whole library).

```bash
node tools/gallery/gallery_launcher.mjs --regen                       # clean+generate ALL, then serve
node tools/gallery/gallery_launcher.mjs --regen --model titanic --seconds 10
node tools/gallery/gallery_launcher.mjs --regen --pattern 24,25,27    # rebuild a subset only
```

**Cost (plan strike time):** a full `--regen` renders every pattern on BOTH
default rigs × Static+Sound ≈ **~228 clips**, and titanic (970 px) clips are the
slow/large ones (~0.5 MB each, ~60 MB total, several minutes on a laptop). For a
quick first pass use `--seconds 6` or scope with `--pattern` / `--model test_bench`.

It is standalone — NOT the production stack launcher (`launcher.js`) and shares
no code with it. To start the bare server without the Tailscale highlight:

```bash
cd marsin_engine
node tools/gallery/server.mjs              # same port contract
node tools/gallery/server.mjs --port 6965  # explicit override
GALLERY_PORT=6965 node tools/gallery/server.mjs
```

The port lives in **`gallery_config.json`** (`{ "port": 6965 }`). Resolution
order is `--port` arg > `GALLERY_PORT` env > `gallery_config.json` > built-in
default `6965`. A present-but-malformed config is a hard error (we never
silently fall back to a different port). **Port 6965** binds `0.0.0.0` — in the
69xx range, one slot below the engine/sim block 6967–6972 (no collision). On startup it prints the
port, the localhost URL, and every non-internal IPv4 address so you can pick
your Tailscale one.

## Phone access (Tailscale)

With Tailscale up on both the laptop and the phone, open:

```text
http://<your-tailscale-ip>:6965/
```

on the phone. The server prints the candidate addresses at startup — use the
Tailscale `100.x.y.z` one. No auth (local / Tailscale only).

## URL scheme

| Path           | What it serves                                              |
|----------------|------------------------------------------------------------|
| `/`            | Phone index: grouped/sorted cards, search box + family/model filter chips |
| `/grid`        | Contact-sheet: many live clip thumbnails at once (lazy-loaded), tap to open |
| `/compare`     | Two clips side by side. `?a=<name>&b=<name>`; pickers if either is missing |
| `/w/<name>`    | The standalone widget page, with a sticky `← gallery` bar + prev/next nav |
| `/api/list`    | JSON `[{ "name", "mtime", "num", "family", "model" }]`, newest first |
| `/api/models`  | JSON `{ "models": [...], "default": "test_bench" }` — rigs for the picker (see the **MODEL PICKER** section below) |

The widgets dir is re-read on **every** request, so newly published patterns
appear without restarting the server. The top nav (`List · Grid · Compare`)
appears on every chrome page.

## Navigation & exploration

**Naming convention.** Patterns are `NN_name`; per-model variants are
`NN_name__<model>` (e.g. `12_phase_cathedral__titanic`). The gallery splits on
`__`: everything before it is the **family** (the grouping key) and everything
after is the **model**. All variants of a pattern collapse onto **one card**,
with a small link per variant (`base`, `titanic`, …); the card's main tap opens
the `base` variant (the one with no `__model`), or the first variant if there is
no bare one. `/api/list` exposes the parsed `num` / `family` / `model` for each
clip (the legacy `name` + `mtime` fields are unchanged, so existing consumers
keep working).

**List view (`/`).**
- **Sort** toggle: `Number` (default, parsed from the `NN_` prefix), `Name`
  (alphabetical by label), or `Recent` (newest publish first).
- **Group** toggle: `Grouped` bands the cards into number ranges
  (`00–09`, `10–19`, … and a trailing `Unnumbered`) — only when sorting by
  Number; `Flat` is one continuous list. Bandless patterns land in
  `Unnumbered`.
- **Filter chips**: one chip per model found in the library, plus `All`. Tapping
  a model chip narrows the list to families that have a variant for that model.
- **Search** matches family name, human label, full clip name, and model — so
  typing a model name also filters. All of this runs client-side over a JSON
  payload embedded in the page, so toggles are instant and need no round-trips.

**Grid view (`/grid`).** A contact sheet of every clip rendered as a scaled-down
`<iframe>` of its `/w/<name>` page, so the LEDs actually animate. To keep a
phone light, each tile mounts its iframe **only when it scrolls near the
viewport** (an `IntersectionObserver` with a one-screen `rootMargin`) and blanks
it again when it scrolls far away — so off-screen clips stop their animation
loop and a 50-clip library never runs 50 `requestAnimationFrame` loops at once.
The search box filters tiles live. Built-ins only — no libraries.

**Compare view (`/compare`).** Two `<select>` pickers; choosing either reloads
with `?a=&b=` and shows the two clips side by side (stacked on a phone, two
columns ≥ 680px). Deep-linkable, e.g.
`/compare?a=01_cylon_sweep&b=53_neon_elevator_hd`.

**Widget page (`/w/<name>`).** Adds `‹` / `›` prev/next links in the sticky bar
that step through the number-sorted library (disabled at the ends), so you can
walk a band without bouncing back to the list.

## Publish a pattern

Run from `marsin_engine/` (the preferred form shells out to
`make_vis_clip.mjs`, which must run from that dir).

**Preferred — from a capture JSON** (runs `make_vis_clip` for you, then wraps
the fragment into a self-contained page):

```bash
cd marsin_engine
node tools/gallery/publish.mjs --name 34_moire_interference \
  --capture ~/tmp/genkit/out/34_moire_interference.json
# optional: --fps 14
```

**Alternate — wrap an existing make_vis_clip fragment:**

```bash
cd marsin_engine
node tools/make_vis_clip.mjs --in ~/tmp/genkit/out/34_moire_interference.json --out ~/tmp/frag.html
node tools/gallery/publish.mjs --name 34_moire_interference --in ~/tmp/frag.html
```

Either form writes `tools/gallery/widgets/<name>.html` (overwriting the same
name) and prints the served path `/w/<name>`. The page is fully self-contained:
it defines the CSS variables the fragment relies on
(`--border-radius-lg`, `--border-radius-md`, `--color-border-tertiary`,
`--color-text-secondary`, `--color-text-tertiary`), sets a dark background so
the LEDs read, and includes the mobile viewport meta. The fragment's own
trailing `<script>` animates it.

## Files

- `gallery_launcher.mjs` — launch + serve: Tailscale-aware wrapper that spawns `server.mjs` on the resolved port.
- `server.mjs` — the http server (index, `/w/<name>`, `/api/list`, 404).
- `gallery_config.json` — the served port (`{ "port": 6965 }`).
- `publish.mjs` — CLI to publish/update a widget (both forms above).
- `widgets/` — published `<name>.html` pages (scratch; gitignored).
- `widgets/.gitignore` — ignores everything in the dir except itself.
- `README.md` — this file.

<!-- BEGIN model-switching (feat/highdef_patterns) — keep separate for merge -->
## Publishing for a non-default rig model (`--model`)

By default the gallery shows clips rendered on the **test_bench** rig. To review
the same pattern on another rig (e.g. `summer_camp_dome`, `summer_camp_logsville`,
`titanic`), capture against that model and publish with `--model`:

```bash
cd marsin_engine
# capture offline against the dome rig (the harness stamps the model into the JSON):
node tools/pattern_audio_harness.mjs --pattern patterns/27_swipe.js \
  --model summer_camp_dome --synth full_track --frames 96 \
  --out ~/tmp/genkit/out/27_swipe__dome.json
# publish it (or omit --model and let publish read it from the capture JSON):
node tools/gallery/publish.mjs --name 27_swipe --model summer_camp_dome \
  --capture ~/tmp/genkit/out/27_swipe__dome.json
# -> writes widgets/27_swipe__summer_camp_dome.html, serves /w/27_swipe__summer_camp_dome
```

**Naming convention.** The default model (`test_bench`) keeps the bare
`<pattern>.html`. Any other model publishes `<pattern>__<model>.html` so several
models for one pattern coexist in the gallery. `__` is the reserved separator —
the gallery index groups variants by splitting the filename on `__`, so neither
`--name` nor `--model` may contain `__`.

Model resolution for `publish.mjs`: explicit `--model` wins, else the `model`
field recorded in the `--capture` JSON, else `test_bench`. The `--capture` and
`--in` forms both still work. A missing/foreign model is **never** silently
swapped for test_bench — the harness fails loudly (non-zero exit) if the model
file is missing or its `pixels[]` lack the required `i/fId/sId/nx/ny/nz` fields.
<!-- END model-switching (feat/highdef_patterns) -->

<!-- BEGIN clip-length-and-map (feat/highdef_patterns) — keep separate for merge -->
## 10-second clips (`--seconds` / `--out-fps`) and the physical map view (`--layout` / `--view`)

### Recording length — real-time ~10 s clips
The offline harness now records **real-time** clips instead of a fixed frame
count. `--seconds <S>` (wins over `--frames`) makes an S-second clip; the audio
analyzer + VM still step at the internal 40 fps for fidelity, but a stored frame
is **emitted every `round((1/F)/DT)` internal steps** for `round(S*F)` stored
frames — so it spans S real seconds of pattern + audio (not slow-mo, not
compressed). `--out-fps <F>` (default 20) is the clip's playback rate, stamped
into the JSON as `fps`; `make_vis_clip`/`publish` play at that rate
automatically. Legacy `--frames` is unchanged (stamps `fps: 40`).

```bash
cd marsin_engine
# 10 s @ 20 fps test_bench clip (200 stored frames, full 52-px fidelity):
node tools/pattern_audio_harness.mjs --pattern patterns/27_swipe.js \
  --seconds 10 --out ~/tmp/genkit/out/27_swipe.json
node tools/gallery/publish.mjs --name 27_swipe --capture ~/tmp/genkit/out/27_swipe.json
```

**Big-rig safety.** A 10 s clip on the titanic (970 px) would be a heavy HTML
page, so the harness caps total emitted color cells (`frames × pixels`,
`--max-cells`, default 150 000): it first lowers `out-fps` (down to 8 fps), then
strides pixels for the clip — and **prints** exactly what it did
(`DOWNSAMPLED: …`). It never silently truncates. test_bench / dome / logsville
keep full fidelity; titanic drops to ~15 fps (≈ 145 k cells, no striding).
`capture_vis.mjs` (live engine) takes the same `--seconds` / `--out-fps`
(out-fps defaults to the ~5 Hz vis-WS rate) and stamps `fps`/`seconds`/
`coordSpread` so its JSON stays shape-compatible.

### Physical map view — `--layout strip|map|auto`, `--view top|front|auto`
`make_vis_clip.mjs` can lay the rig out as a **top-down physical map**: every
pixel is an absolutely-positioned glowing dot at its real coordinate, on a dark
field (`#06060a`), with a brightness-scaled bloom — it reads like looking at the
actual lights.

- `--layout auto` (default): keep the section-**strip** layout for `test_bench`,
  use the **map** for every other rig (titanic, dome, logsville). `--layout
  strip|map` overrides. test_bench strip output is unchanged.
- `--view auto` (default): pick the two **physically widest** axes as the plane
  (from the capture's `coordSpread`, else normalized std-dev) — titanic →
  top-down **X/Z** ship outline, a flat front rig → **X/Y**. `top` = X/Z,
  `front` = X/Y. The vertical axis is flipped so up/forward reads naturally and
  the real aspect ratio is preserved (not stretched to a square).

`publish.mjs` passes `--layout` / `--view` straight through and respects the
capture's stamped `fps`:

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/27_swipe.js \
  --model titanic --seconds 10 --out ~/tmp/genkit/out/27_swipe__titanic.json
node tools/gallery/publish.mjs --name 27_swipe --model titanic \
  --capture ~/tmp/genkit/out/27_swipe__titanic.json   # auto → map, top-down X/Z
# force the strip layout or a specific plane:
node tools/gallery/publish.mjs --name 27_swipe --model titanic \
  --capture ~/tmp/genkit/out/27_swipe__titanic.json --layout map --view top
```
<!-- END clip-length-and-map (feat/highdef_patterns) -->

<!-- BEGIN live-vis (feat/highdef_patterns) — keep separate for merge -->
## LIVE mode — visualize the running engine (`/live`)

Everything above is **OFFLINE**: pre-rendered clips in `widgets/`, no engine
needed. The gallery ALSO has an **ONLINE / LIVE** view that renders the running
engine's real-time per-pixel output. Both coexist and are clearly separated:
the offline clip views (`/ /grid /compare /w/<name>`) keep working with no
engine; `/live` is the only view that talks to the engine.

### What it is
`/live` opens a **browser WebSocket** to the engine's vis broadcast
(`ws://<engineHost>/ws/viz` — the same stream `capture_vis.mjs` records),
decodes the chosen buffer, and paints the rig LIVE in the **same visual style
as the offline clips** (the strip + physical-map dot renderers are factored
from `make_vis_clip.mjs` into `live_layout.mjs` + `live_client.js`).

- **master** (default) = the DECK MAIN composition. **rig** = post dimmers / FX
  (hardware truth). Toggle with the `master / rig` segmented control (or
  `?buffer=rig`).
- **Pause** freezes the paint loop. On disconnect the cells blank to black —
  we never show stale/zero data as if it were live (codex P0: fail visibly).

### Model-aware layout (why a model is needed)
The live WS buffer is just bytes (6/px RGBWAU, in `model.pixels[]` order) with
**no coordinates**. So the SERVER imports the active model
(`marsin_engine/models/<model>.js`), reads each pixel's `i/fId/sId/nx/ny/nz`,
and embeds a layout spec in the page; the client positions pixels from it
(strip for `test_bench`, top-down dot map for `titanic`/dome/logsville — same
`--layout/--view auto` rules as the clips). Pick the model with
`?model=<name>` (default `test_bench`). A **missing model file fails LOUD**
(HTTP 500 with the reason) — never a silent test_bench fallback.

### engineHost resolution
The engine host:port resolves in this order:

1. `?host=<ip:port>` query on `/live`
2. `gallery_config.json` `"engineHost"` (default `"127.0.0.1:6968"`)
3. built-in default `127.0.0.1:6968`

A present-but-malformed `engineHost` (not a bare `host:port`) is a hard error
at startup (same fail-loud contract as `port`). The startup banner prints the
resolved engine host.

### Routes added
| Path | Serves |
|------|--------|
| `/live` | LIVE visualizer page (model-aware, connection-state UI) |
| `/live/<name>` | same page, with `<name>` shown as a caption (gallery never drives the engine — load the pattern in the engine yourself) |
| `/live_client.js` | the browser-side live renderer module |
| `/api/live-layout?model=<name>` | the raw model-aware layout JSON `/live` embeds |

### Use it
```bash
cd marsin_engine
# 1. run the engine on a model (this is what the live view mirrors):
node engine.js --model test_bench --pattern 27_swipe
# 2. (in another shell) start the gallery and open /live:
node tools/gallery/gallery_launcher.mjs        # or server.mjs
#    http://localhost:6965/live                 # test_bench strip, master buffer
#    http://localhost:6965/live?model=titanic   # titanic top-down map
#    http://localhost:6965/live?buffer=rig      # hardware-truth buffer
#    http://localhost:6965/live?host=100.x.y.z:6968   # remote engine over Tailscale
```
The header shows the connection state: `○ connecting…`, `● connected to
engine · <buffer> · Npx live`, or `✕ engine not reachable at <host>` (auto-
retries every 2 s). The sibling model-picker links here as `/live?model=<active>`.

Live-mode files: `live_layout.mjs` (server: model → layout spec; fail-loud),
`live_client.js` (browser: WS decode + paint + connection-state UX).
<!-- END live-vis (feat/highdef_patterns) -->
<!-- BEGIN model-select (feat/highdef_patterns) — keep separate for merge -->
## The global MODEL PICKER — choose which rig you're viewing

Every chrome page (`/`, `/grid`, `/compare`) now has a **prominent Model picker
in the header** — a labelled `Model` `<select>` plus a `Viewing <rig>` readout
and a `Live ›` link. This is the obvious answer to "which rig am I looking at,
and how do I switch?" — pick a rig and the whole gallery re-renders for it.

**Where the rigs come from.** `GET /api/models` lists the real rigs in
`marsin_engine/models/` (each bare `<rig>.js`; the `.effects.js` /
`.viewmasks.js` / `.js.original` siblings are not rigs and are skipped):

```json
{ "models": ["test_bench", "summer_camp_dome", "summer_camp_logsville", "titanic"],
  "default": "test_bench" }
```

`test_bench` is the **default** and is hoisted to the front of the list.

**How the active rig flows through the UI.**

- The picker sets `?model=<rig>` on the URL and the rest of the page renders for
  that rig. The choice also persists to `localStorage` (`gallery.model`), so a
  later visit with no querystring redirects once to your remembered rig. An
  explicit `?model=` always wins over storage. An unknown/garbage `?model=`
  falls back to `test_bench` (the picker only ever offers real rigs; a
  hand-typed querystring should not 404 the page).
- **List (`/`)** and **Grid (`/grid`)** surface, per pattern, the **chosen
  rig's clip** (`<pattern>__<rig>.html`, or the bare `<pattern>.html` when the
  rig is `test_bench`). When no per-rig clip exists, they fall back to the
  test_bench base clip and flag it — a `no <rig> clip — (test_bench)` badge on
  the list card and a `(test_bench)` tag on the grid tile — so you always see
  *something* and know it's the base, not the rig's own render.
- Every `/w/<name>` link, the `/grid` and `/compare` links, and the **sibling's
  `/live?model=<rig>`** link all carry the active rig, so it stays selected as
  you navigate. The widget page (`/w/<name>`) shows the active rig as a chip and
  carries it back through `← gallery` and the `‹ ›` prev/next.
- The legacy per-model **filter chips** on the list and the search/sort/group
  toggles all still work unchanged — the picker is an additional, global layer.

Offline/self-contained as ever: Node built-ins + browser only, no CDNs or deps.
<!-- END model-select (feat/highdef_patterns) -->
<!-- BEGIN deck-control (feat/highdef_patterns) — keep separate for merge -->
## NEW — DECK CONTROL surface on `/live` (drives the running engine)

The `/live` page now carries a **collapsible DECK CONTROL panel** below the live
visualizer, so the operator can drive the **running engine** — load patterns and
control the deck playlist — straight from the gallery on a phone over Tailscale.
The live vis stays primary; the deck panel is a secondary `<details>` section.

This is the gallery's first **ONLINE write** surface: every other view is
read-only / offline. The offline clip views (`/ /grid /compare /w/<name>`) remain
**engine-independent**; only `/live` (vis + deck) talks to the engine, and the
deck only ever acts on an **explicit operator tap** — the gallery never drives
the engine on its own.

### Why a proxy (CORS) — `/api/engine/<path>`
The gallery page runs in a phone browser; the engine REST API is on a different
origin/port, so a **direct browser → engine fetch is blocked by CORS** (and we
may NOT add CORS to the engine). The gallery **server** is co-located with the
engine and reaches it over loopback, so:

```text
phone browser → (same-origin) gallery /api/engine/<path> → (loopback) engine REST API
```

`server.mjs` adds an `ALL /api/engine/<path>` route that forwards the request to
`http://<ENGINE_HOST><path>` SERVER-side and relays the engine's status + JSON
body verbatim. The target is the **configured `ENGINE_HOST`** (`gallery_config.json`
`engineHost` / `ENGINE_HOST`, default `127.0.0.1:6968`) — fixed server-side, NOT
the browser auto-host the live WS uses. The phone cannot redirect it elsewhere.

- **Strict allowlist** (method + exact path / prefix). Anything else → **403**
  (no arbitrary forwarding / SSRF). Allowed: `GET /patterns`, `POST /pattern`,
  `GET|PATCH /deck/channel`, `POST /deck/channel/control`, `GET /exports`,
  `GET /playlists`, `GET /playlists/<name>`, `GET|POST /deck/playlist`,
  `POST /deck/playlist/entry`, `POST /deck/playlist/autopilot`.
- **~4s timeout**; on timeout → 504, on connection-refused → 502, both with a
  clean `{ "error": "engine not reachable" }` JSON body. It **never hangs** the
  gallery (codex P0: fail loud, never spin forever, never fake success).

### The deck panel (`deck_client.js`)
Browser built-ins only (`fetch`, DOM), served statically at `/deck_client.js`.

- **Deck state** (active pattern, master fader, blackout) from
  `GET /api/engine/deck/channel`, on load + a light ~2 s poll (reads only).
- **Patterns**: list (`GET /patterns`), tap to load (`POST /pattern`); the active
  pattern chip is highlighted.
- **Playlists**: list (`GET /playlists`), load one (`POST /deck/playlist`), tap an
  entry (`POST /deck/playlist/entry`), **Next / Prev** (computed from the entry
  list + active entry, wrapping), and an **Autopilot** toggle
  (`POST /deck/playlist/autopilot`). A `409 EBUSY` mid-transition is treated as a
  no-op, not an error.
- **Master fader** (0..1) → `PATCH /deck/channel { fader }`, debounced during the
  drag.
- **Engine offline**: when the proxy returns the not-reachable error, the panel
  disables every control and shows **“engine offline — controls unavailable”**;
  a later successful poll re-enables it. Per-action success/failure feedback is
  shown inline.

### Use it
Run the engine, start the gallery, open `/live`:

```bash
cd marsin_engine
node engine.js --model test_bench --pattern 27_swipe      # the engine the deck drives
node tools/gallery/server.mjs --port 6965                  # (other shell) the gallery
#   http://localhost:6965/live   → expand "Deck Control"
```

Files added/changed: `server.mjs` (proxy route + allowlist + deck panel markup),
`deck_client.js` (the browser-side control surface). **No** engine / `lib/` files
are touched — the deck uses only the engine's existing HTTP API.
<!-- END deck-control (feat/highdef_patterns) -->

<!-- BEGIN variation-axis (NEW — feat/highdef_patterns) -->
## NEW — Static ↔ Sound variations (per pattern)

Each pattern can now carry **two** clips that the operator switches between on
one card:

- **Static** — a no-audio recording (`--synth silence`, no modulation): what the
  pattern looks like at rest with operator-set sliders.
- **Sound** — a synthetic audio-reactive recording: the harness drives the
  pattern's sliders from a musical synth through the **real DSP**, applying the
  pattern's `AUDIO_MODULATION_V1` block as the engine's OVERRIDE modulation
  (`param = lerp(min, max, curve(signal))`). This mirrors the deployed
  sound-reactive output.

These sit on a **VARIATION axis** alongside the existing **MODEL** (rig) axis.

### Naming / parse scheme (backward-compatible)

A widget filename is `<pattern>[__<seg>...]`. The server (`server.mjs`
`parseName`) classifies **each** `__`-segment after the pattern independently:

| Segment           | Classified as |
|-------------------|---------------|
| `static` / `sound`| **variation** |
| a known rig name (in `models/`) | **model** |
| legacy/unknown text | **model** (so old `<pattern>__<oldrig>` clips never disappear) |

A clip with **no** variation segment is treated as `static` (the pre-existing
bare `<pattern>` and `<pattern>__<model>` clips are the no-audio look, so they
slot onto the Static side automatically). Resulting widget names:

```
<pattern>                       base clip          (model='',  variation=static)
<pattern>__<model>              model variant      (model=rig, variation=static)
<pattern>__static               static variation   (model='',  variation=static)
<pattern>__sound                sound variation    (model='',  variation=sound)
<pattern>__<model>__static      static on a rig
<pattern>__<model>__sound       sound on a rig
```

### Gallery UX

- All variations + models of a pattern collapse onto **one card** (as before).
- Each card carries a small **Static | Sound** toggle (`.varpick`); a missing
  side is disabled. The card's **main tap** defaults to the **Sound** variation
  when present, else **Static**, else the bare clip.
- The list/grid still scope to the active **rig** first (model picker + chips),
  then pick the variation. The grid contact sheet shows the Sound clip by
  default and tags each tile with its variation.
- `/api/list` now also exposes `variation` per clip (additive — `name`, `mtime`,
  `num`, `family`, `model` are unchanged).

### Generate the variations

`tools/gallery/gen_variations.mjs` renders both clips for each pattern offline
(no engine, Node built-ins + the in-repo tools):

```bash
cd marsin_engine
node tools/gallery/gen_variations.mjs                  # all patterns/[0-9]*_*.js
node tools/gallery/gen_variations.mjs --pattern 27     # just NN_* (e.g. 27_swipe)
node tools/gallery/gen_variations.mjs --pattern 24,25,27
node tools/gallery/gen_variations.mjs --model titanic  # render on a non-default rig
node tools/gallery/gen_variations.mjs --seconds 10 --fps 14
```

For each pattern it runs the **static** clip (`--synth silence`) and, when the
pattern has an `AUDIO_MODULATION_V1` block, the **sound** clip (`--synth
<spec.synth> --mod <spec.modString>`), then publishes both as variation widgets.
A pattern with no block gets only the static clip and is reported as `no-block`.
A compile/render error **stops the run** (codex P0 — never skip silently). It
prints a per-pattern summary (static / sound / no-block).

### The spec parser — `tools/audio_mod_spec.mjs`

`parseAudioModSpec(patternSource[, patternName])` →
`{ mappings, modString, synth }` (or `null` when there is no block):

- `mappings`: `[{ slider, signal, min, max, curve }]` in declaration order,
  parsed from each `slider<Name> <- mic<Sig> range a..b curve linear|pow2|ease`
  line. Blank / comment-only / parenthetical prose lines are ignored; a
  malformed mapping line is a **hard error** (never silently dropped).
- `modString`: the harness `--mod` string **with ranges**, e.g.
  `micLow:sliderLevel:0.30:1.00:linear,micKick:sliderKick:0.00:1.00:pow2`.
- `synth`: a musical synth that exercises the PRIMARY mapping — default
  `full_track`; `kick_4floor` when the PRIMARY is kick-gated (a `# PRIMARY`
  micKick mapping, or no micLow→level PRIMARY) or the pattern name suggests a
  beat (`heartbeat` / `kick` / `shockwave` / `strobe`). Positional/swipe
  patterns (e.g. `27_swipe`) keep `full_track`.

### Harness `--mod` range grammar (`tools/pattern_audio_harness.mjs`)

The `--mod` token grammar is now **range-aware** (purely additive; bare tokens
unchanged):

```
--mod  sig:slider[:min:max[:curve]]   (comma-separated for multiple)
```

- Bare `sig:slider` = range `0..1` linear (identity — `slider := signal`, the
  legacy behaviour).
- With a range, each frame `slider = lerp(min, max, curve(signalNorm))`, matching
  the engine's OVERRIDE modulation. `curve ∈ linear | pow2 (x²) | ease (easeOut,
  1−(1−x)²)`; default `linear`. A bad range or curve **fails loud** (`MOD_FAIL`).
<!-- END variation-axis (NEW — feat/highdef_patterns) -->

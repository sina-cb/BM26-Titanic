---
description: Review lighting-pattern visualizations on your phone — publish per-pixel clips to the standalone OFFLINE pattern gallery and serve them over Tailscale. Use when the operator says "put it in the gallery", "let me see the patterns on my phone", "host the gallery", or wants to browse/compare many pattern clips off-device.
---

# 📱 Pattern Gallery — offline phone review

The gallery is a **standalone, offline** web tool for browsing
lighting-pattern clips on a **phone over Tailscale**. It lives at
`marsin_engine/tools/gallery/` and is completely separate from `engine.js` /
`launcher.js` — it does not touch any config, ports, or runtime state, and you
start it on its own. Node built-ins only (`http fs path url os`): no npm deps,
no CDNs, no fonts, no telemetry (playa-offline safe).

It pairs with the clip pipeline — skill `07_pixel_vis_clips.md` (capture/clip),
`08_visualize_patterns_widget.md` (widget anatomy), and
`12_highdef_pattern_generation.md` §10–11 (where the clip + gallery sit in the
pattern workflow). The clips themselves are the real per-pixel output; this
skill is just how you get them onto a phone.

## When to use
- "Show me the patterns on my phone", "host/start the gallery", "publish it".
- Reviewing a **batch** of clips side by side, or when inline `show_widget`
  isn't available (mobile/web client) — the gallery is the fallback surface.

## The port (config-driven)
The served port lives in **`marsin_engine/tools/gallery/gallery_config.json`**
(`{ "port": 6965 }`). Resolution order:
`--port` arg > `GALLERY_PORT` env > `gallery_config.json` > built-in `6965`.
A present-but-malformed config is a **hard error** — the server exits loudly
rather than quietly picking another port (codex P0: no silent fallbacks).
Port **6965** binds `0.0.0.0` — in the 69xx range, one slot below the
engine/sim block 6967–6972 (no collision).

## The loop (capture → publish → serve → phone)

1. **Get a capture JSON.** Either offline (no engine) via the harness, or live
   from the engine (skill 07). Offline is the usual path:
   ```bash
   cd marsin_engine
   node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
     --synth full_track --frames 96 --out ~/tmp/genkit/out/NN_name.json
   ```
   (The harness JSON — `{meta, frames}` — is what `make_vis_clip`/`publish`
   consume. Captures live in `~/tmp/`, never in the source tree.)

2. **Publish** (preferred form builds the clip for you via `make_vis_clip.mjs`,
   so run it from `marsin_engine/`):
   ```bash
   cd marsin_engine
   node tools/gallery/publish.mjs --name NN_name \
     --capture ~/tmp/genkit/out/NN_name.json   # optional: --fps 14
   # -> writes tools/gallery/widgets/NN_name.html, prints /w/NN_name
   ```
   Alternate (wrap an existing `make_vis_clip` fragment):
   ```bash
   node tools/make_vis_clip.mjs --in ~/tmp/genkit/out/NN_name.json --out ~/tmp/frag.html
   node tools/gallery/publish.mjs --name NN_name --in ~/tmp/frag.html
   ```

3. **Launch + serve** with the dedicated **gallery launcher** (start once — the
   server re-reads the widgets dir on **every** request, so re-publishing
   appears without a restart):
   ```bash
   cd marsin_engine
   node tools/gallery/gallery_launcher.mjs   # port from gallery_config.json (6965)
   ```
   The launcher resolves the port (same contract as the server), prints the
   **Tailscale phone URL** (`http://100.x.y.z:6965/`) up front, then spawns
   `server.mjs` pinned to that port. It is standalone — NOT the production stack
   launcher (`launcher.js`) and shares no code with it. (You can still run
   `node tools/gallery/server.mjs` directly if you don't want the Tailscale
   highlight.)

4. **Phone** (Tailscale up on both machine and phone): open
   `http://<your-tailscale-ip>:6965/`, use the search box, tap a pattern, watch
   it animate (the clip has Pause + Speed; a sticky `← gallery` bar returns).

## URL scheme
| Path        | Serves |
|-------------|--------|
| `/`         | Phone index: grouped/sorted cards, search box + family/model filter chips, **Static\|Sound** toggle, global model picker |
| `/grid`     | Contact-sheet of live clip thumbnails (lazy-loaded), tap to open |
| `/compare`  | Two clips side by side (`?a=<name>&b=<name>`; pickers if missing) |
| `/w/<name>` | The standalone clip page, sticky `← gallery` bar + `‹ ›` prev/next |
| `/api/list` | JSON `[{name, mtime, num, family, model, variation}]`, newest first |
| `/api/models` | JSON `{models:[...], default:"test_bench"}` — rigs for the global model picker (see the **MODEL PICKER** section below) |
| **OFFLINE views above need no engine.** The routes below are **LIVE / ONLINE** — they talk to the running engine: ||
| `/live` `/live/<name>` | Live per-pixel view of the running engine + **Deck Control** panel (see **LIVE mode** + **DECK CONTROL** below) |
| `/live_client.js` `/api/live-layout` | The live renderer + the model-aware layout JSON |
| `/api/engine/<path>` | Same-origin **allowlisted proxy** to the engine REST API (deck control; see **DECK CONTROL** below) |

Names are restricted to `[A-Za-z0-9._-]` (no traversal); anything else 404s.
A top nav (`List · Grid · Compare`) is on every chrome page.

## Navigate & explore
- **Naming convention.** `NN_name`, with optional per-model variants
  `NN_name__<model>`. The gallery splits on `__`: the part before is the
  **family** (grouping key), the part after is the **model**. All variants of a
  pattern collapse onto **one card** with a per-variant link (`base`,
  `titanic`, …); the main tap opens the `base` (no-`__`) variant.
- **List `/`**: `Sort` by Number / Name / Recent; `Group` by number band
  (`00–09`, `10–19`, … `Unnumbered`) or Flat (banding applies when sorting by
  Number). Model filter chips + a search that also matches model names. All
  client-side over a JSON payload — instant, no round-trips.
- **Grid `/grid`**: every clip as a scaled live `<iframe>`; tiles mount their
  iframe only when near the viewport (`IntersectionObserver`) and blank when
  far, so off-screen clips stop animating — a phone never runs every loop at
  once. Built-ins only.
- **Compare `/compare`**: two `<select>` pickers → side-by-side, deep-linkable.
- **`/w/<name>`**: `‹ ›` step through the number-sorted library.

## Publishing a whole batch
Loop the harness + publish over `marsin_engine/patterns/*.js`. Publish
overwrites the same `<name>.html`, so re-running is idempotent. If a pattern
fails to compile/render, **stop and report it** — don't skip silently. Example:
```bash
cd marsin_engine
for f in patterns/[0-9]*_*.js; do
  name=$(basename "$f" .js)
  node tools/pattern_audio_harness.mjs --pattern "$f" --synth full_track \
    --frames 96 --out ~/tmp/genkit/out/$name.json || { echo "FAILED: $name"; break; }
  node tools/gallery/publish.mjs --name "$name" --capture ~/tmp/genkit/out/$name.json || { echo "FAILED publish: $name"; break; }
done
node tools/gallery/gallery_launcher.mjs
```

## Files & hygiene
- `gallery_launcher.mjs` — launch + serve (Tailscale-aware; spawns `server.mjs`).
- `server.mjs` — http server (index, `/grid`, `/compare`, `/w/<name>`, `/live`,
  `/api/*`, the `/api/engine/` proxy + allowlist, 404).
- `gallery_config.json` — the served port (`port`) + the engine host
  (`engineHost`, default `127.0.0.1:6968`) the live view + deck proxy target.
- `publish.mjs` — CLI to publish/update a widget.
- `gen_variations.mjs` — generate the Static + Sound variation clips per pattern.
- `../audio_mod_spec.mjs` — parse a pattern's `AUDIO_MODULATION_V1` block →
  `{mappings, modString, synth}` (shared by `gen_variations`).
- `live_layout.mjs` — server-side model-aware layout for the live view.
- `live_client.js` — browser live renderer (WS → per-pixel paint).
- `deck_client.js` — browser deck-control panel on `/live`.
- `widgets/` — published `<name>.html` pages. **Gitignored scratch** — the
  generated clips are NOT committed; regenerate them anytime from captures.
- After any engine boot to capture live, restore runtime residue:
  `git restore marsin_engine/states/ simulation/`.

See `marsin_engine/tools/gallery/README.md` for the same details from the
tool's side.

<!-- BEGIN model-switching (feat/highdef_patterns) — keep separate for merge -->
## Reviewing a pattern on a different rig model (`--model`)

The clip pipeline defaults to the **test_bench** rig, but you can render and
publish the same pattern on any rig in `marsin_engine/models/` (e.g.
`summer_camp_dome`, `summer_camp_logsville`, `titanic`) so they show up
side-by-side in the gallery.

```bash
cd marsin_engine
# 1. capture offline against the chosen rig (model is stamped into the JSON):
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
  --model summer_camp_dome --synth full_track --frames 96 \
  --out ~/tmp/genkit/out/NN_name__dome.json
# 2. publish (omit --model to let publish read it from the capture JSON):
node tools/gallery/publish.mjs --name NN_name --model summer_camp_dome \
  --capture ~/tmp/genkit/out/NN_name__dome.json
# -> widgets/NN_name__summer_camp_dome.html, served at /w/NN_name__summer_camp_dome
```

**Naming convention.** The default model (`test_bench`) keeps the bare
`<pattern>.html`; any other model publishes `<pattern>__<model>.html`. `__` is
the reserved separator the gallery index splits on to group a pattern's model
variants, so neither `--name` nor `--model` may contain `__`.

**Fail-loud (codex P0).** The harness `--model` never silently falls back to
test_bench: a missing model file, or one whose `pixels[]` lack the required
`i/fId/sId/nx/ny/nz` fields, exits non-zero with a clear `MODEL_FAIL:` message
and writes no capture. `make_vis_clip.mjs` stays model-agnostic — it
auto-detects each section's axis from the coord spread and only labels sections
`Pars/Vintage/Bars` for test_bench (other rigs get neutral `Section N`).
<!-- END model-switching (feat/highdef_patterns) -->

<!-- BEGIN clip-length-and-map (feat/highdef_patterns) — keep separate for merge -->
## ~10-second clips + the physical map view

**Real-time clip length.** The harness records real-time clips: `--seconds <S>`
(wins over `--frames`) makes an S-second clip, `--out-fps <F>` (default 20) is
the playback rate. The analyzer + VM keep stepping at the internal 40 fps, but a
stored frame is emitted every `round((1/F)/DT)` internal steps for `round(S*F)`
stored frames — a true S-second span (not slo-mo). `fps`/`seconds` are stamped
into the JSON and the clip plays at that rate. So 10 s @ 20 fps = 200 frames.

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
  --seconds 10 --out ~/tmp/genkit/out/NN_name.json     # 200 frames @ 20 fps
```

**Big-rig safety.** The harness caps emitted color cells (`frames × pixels`,
`--max-cells` default 150 000): it first lowers out-fps, then strides pixels for
the clip, and **prints** what it did (`DOWNSAMPLED: …`) — never a silent
truncation. test_bench/dome/logsville stay full fidelity; titanic (970 px) drops
to ~15 fps.

**Physical map layout.** `make_vis_clip.mjs --layout strip|map|auto` (default
`auto` = strip for test_bench, **map** for titanic/dome/logsville) lays each
pixel as a glowing bloom dot at its real coordinate on a dark field — like
looking at the actual lights. `--view top|front|auto` (default `auto` picks the
two physically-widest axes; titanic → top-down **X/Z** ship outline). `publish.mjs`
passes both flags through and respects the stamped fps:

```bash
node tools/gallery/publish.mjs --name NN_name --model titanic \
  --capture ~/tmp/genkit/out/NN_name__titanic.json   # auto map, top-down
node tools/gallery/publish.mjs --name NN_name --model titanic \
  --capture ~/tmp/genkit/out/NN_name__titanic.json --layout map --view top
```
<!-- END clip-length-and-map (feat/highdef_patterns) -->

<!-- BEGIN live-vis (feat/highdef_patterns) — keep separate for merge -->
## LIVE mode — visualize the running engine (`/live`)

Everything above is **OFFLINE** (pre-rendered clips, no engine). The gallery
also has an **ONLINE / LIVE** view that renders the running engine's real-time
per-pixel output, in the **same visual style as the clips**. Offline and online
are clearly separated: `/ /grid /compare /w/<name>` need no engine; only
`/live` talks to the engine.

`/live` opens a **browser WebSocket** to `ws://<engineHost>/ws/viz` (the same
vis stream `capture_vis.mjs` records), decodes the chosen buffer, and paints the
rig live. The strip + physical-map renderers are factored from
`make_vis_clip.mjs` into `live_layout.mjs` (server) + `live_client.js` (browser).

```bash
cd marsin_engine
# 1. run the engine on a model — the live view mirrors its vis:
node engine.js --model test_bench --pattern 27_swipe
# 2. start the gallery (another shell) and open /live:
node tools/gallery/gallery_launcher.mjs        # or server.mjs
#    http://localhost:6965/live                 # test_bench strip, master buffer
#    http://localhost:6965/live?model=titanic   # titanic top-down map
#    http://localhost:6965/live?buffer=rig      # hardware-truth buffer
#    http://localhost:6965/live?host=100.x.y.z:6968  # remote engine over Tailscale
# 3. after capturing live, restore residue: git restore marsin_engine/states/ simulation/
```

- **buffer**: `master` (default, DECK MAIN composition) vs `rig` (post dimmers/
  FX, hardware truth) — toggle in the header or with `?buffer=rig`. **Pause**
  freezes the loop.
- **Model-aware layout.** The WS buffer is bytes only (6/px RGBWAU, in
  `model.pixels[]` order, **no coords**). The SERVER imports
  `models/<model>.js` (`?model=`, default `test_bench`), reads each pixel's
  `i/fId/sId/nx/ny/nz`, and embeds a layout spec the client positions from
  (strip for test_bench, top-down dot map for titanic/dome/logsville). A
  **missing model file fails LOUD** (HTTP 500), never a silent test_bench swap.
- **engineHost** resolves `?host=` query > `gallery_config.json "engineHost"`
  (default `127.0.0.1:6968`) > built-in default. A malformed `engineHost` is a
  hard error at startup.
- **Connection state (codex P0: fail visibly).** The header shows `○
  connecting…`, `● connected to engine · <buffer> · Npx live`, or `✕ engine not
  reachable at <host>`. On disconnect the cells blank to black — never stale/
  zero data shown as live. Auto-retries every 2 s.

Routes added: `/live`, `/live/<name>` (name is a caption only — the gallery
never drives the engine), `/live_client.js` (the renderer), `/api/live-layout`
(the raw layout JSON). The sibling model-picker links here as
`/live?model=<active>`. See `README.md` for the same from the tool's side.
<!-- END live-vis (feat/highdef_patterns) -->
<!-- BEGIN model-select (feat/highdef_patterns) — keep separate for merge -->
## The global MODEL PICKER — "which rig am I viewing?"

Every chrome page (`/`, `/grid`, `/compare`) has a **prominent Model picker in
the header**: a labelled `Model` `<select>`, a `Viewing <rig>` readout, and a
`Live ›` link. Pick a rig and the whole gallery re-renders for it — this is the
obvious, global control (the old per-pattern `__model` chips were easy to miss).

- **Rig list** comes from `GET /api/models` → `{ "models": [...], "default":
  "test_bench" }`, read live from `marsin_engine/models/` (each bare `<rig>.js`;
  `.effects.js` / `.viewmasks.js` / `.js.original` siblings are skipped).
  `test_bench` is the default and is hoisted to the front.
- **The active rig flows everywhere** as `?model=<rig>` and persists in
  `localStorage` (`gallery.model`); an explicit `?model=` wins over storage, and
  an unknown rig falls back to `test_bench` (no 404 on a hand-typed querystring).
  All `/w/`, `/grid`, `/compare`, and the sibling **`/live?model=`** links carry
  the rig, and the widget page shows it as a chip + carries it back.
- **Variant fallback.** List + Grid surface the chosen rig's clip
  (`<pattern>__<rig>.html`, or bare `<pattern>.html` for `test_bench`). When no
  per-rig clip exists they fall back to the test_bench base and flag it
  (`no <rig> clip — (test_bench)` on the card, `(test_bench)` on the grid tile),
  so you always see something and know it's the base render.
- Search / sort / group and the legacy per-model filter chips still work — the
  picker is an added global layer. Offline as ever (Node built-ins + browser).

```bash
curl -s localhost:6965/api/models                 # the rig list + default
curl -s 'localhost:6965/?model=titanic' | head    # gallery rendered for titanic
```
<!-- END model-select (feat/highdef_patterns) -->
<!-- BEGIN deck-control (feat/highdef_patterns) — keep separate for merge -->

## NEW — DECK CONTROL on `/live` (drive the running engine)

The `/live` page now has a **collapsible DECK CONTROL panel** under the live
visualizer that drives the **running engine** from the gallery: load patterns,
control the deck playlist, ride the master fader — from a phone over Tailscale.

This is the gallery's only **ONLINE write** surface. The offline clip views
(`/ /grid /compare /w/<name>`) stay **engine-independent**; only `/live` talks to
the engine, and the deck acts **only on an explicit operator tap** — the gallery
never drives the engine on its own.

### The CORS proxy — `/api/engine/<path>`
The phone browser and the engine REST API are different origins, so a direct
browser→engine call is **blocked by CORS** (and we must NOT add CORS to the
engine). The gallery SERVER is co-located with the engine, so the browser calls
the gallery **same-origin** and the server forwards over loopback:

```text
phone → (same-origin) gallery /api/engine/<path> → (loopback) engine REST API
```

- Target is the **configured `ENGINE_HOST`** (default `127.0.0.1:6968`,
  server-side) — NOT the browser auto-host the live WS uses.
- **Strict allowlist** (method + path/prefix); anything else → **403** (no SSRF).
  Allowed: `GET /patterns`, `POST /pattern`, `GET|PATCH /deck/channel`,
  `POST /deck/channel/control`, `GET /exports`, `GET /playlists`,
  `GET /playlists/<name>`, `GET|POST /deck/playlist`, `POST /deck/playlist/entry`,
  `POST /deck/playlist/autopilot`.
- **~4s timeout**; timeout → 504, connection-refused → 502, both with a clean
  `{"error":"engine not reachable"}` — never a hang (codex P0).

### The panel (`deck_client.js`, browser built-ins only)
Deck state (active pattern / fader / blackout) from `GET /deck/channel` on load +
a light ~2 s read-only poll. Patterns list + tap-to-load. Playlists list + load +
tappable entries + **Next/Prev** (computed from the entry list, wrapping) +
**Autopilot** toggle. **Master fader** (debounced) → `PATCH /deck/channel`.
**Engine offline** → controls disabled + "engine offline — controls unavailable";
re-enables on a later good poll. Per-action success/failure feedback inline.
A `409 EBUSY` mid-transition is a no-op, not an error.

### Use it
```bash
cd marsin_engine
node engine.js --model test_bench --pattern 27_swipe   # the engine the deck drives
node tools/gallery/server.mjs --port 6965              # (other shell) the gallery
#   http://localhost:6965/live  → expand "Deck Control"

# proxy smoke (engine + gallery up):
curl -s localhost:6965/api/engine/patterns                                   # list
curl -s -XPOST -H 'Content-Type: application/json' \
  -d '{"pattern":"01_cylon_sweep"}' localhost:6965/api/engine/pattern        # load
curl -s -o /dev/null -w '%{http_code}\n' localhost:6965/api/engine/mixer     # 403 (not allowed)
```

Files: `server.mjs` (proxy route + allowlist + deck panel markup) and the new
`deck_client.js`. **No** engine / `lib/` files are touched — existing HTTP API only.
<!-- END deck-control (feat/highdef_patterns) -->

<!-- BEGIN variation-axis (NEW — feat/highdef_patterns) -->
## NEW — Static ↔ Sound variations

Each pattern can carry **two** clips the operator switches between on one card:
a **Static** (no-audio, `--synth silence`) recording and a **Sound** (synthetic
audio-reactive) recording. The sound clip drives the pattern's sliders through
the **real DSP** from a musical synth, applying the pattern's
`AUDIO_MODULATION_V1` block as the engine's OVERRIDE modulation
(`param = lerp(min, max, curve(signal))`), so it looks like the deployed
sound-reactive output. These sit on a **VARIATION axis** next to the existing
**MODEL** (rig) axis.

### Generate them

```bash
cd marsin_engine
node tools/gallery/gen_variations.mjs                  # all patterns/[0-9]*_*.js
node tools/gallery/gen_variations.mjs --pattern 24,25,27
node tools/gallery/gen_variations.mjs --model titanic --seconds 10 --fps 14
```

For each pattern it renders the static clip and (when the pattern has an
`AUDIO_MODULATION_V1` block) the sound clip, publishes both as variation
widgets, and prints a per-pattern summary. No block → only the static clip,
reported as `no-block`. A compile/render error **stops the run** (codex P0).

**One action — clean + generate + serve.** To rebuild the WHOLE gallery from
scratch and serve it in a single command, use the launcher's `--regen`: it wipes
the old `widgets/` clips, runs the full `gen_variations` over every pattern, then
serves — aborting before it serves if any pattern fails to render (so you never
serve over freshly-wiped data). Forwards `--model`/`--seconds`/`--fps`/`--pattern`.

```bash
node tools/gallery/gallery_launcher.mjs --regen                    # clean → generate ALL → serve
node tools/gallery/gallery_launcher.mjs --regen --model titanic --seconds 10
```

A full `--regen` is ~228 clips (every pattern × both default rigs × Static+Sound);
titanic (970 px) clips dominate the time/size (~0.5 MB each, ~60 MB, several
minutes). Use `--seconds 6` or `--pattern`/`--model test_bench` for a fast pass.

### Naming / parse scheme (backward-compatible)

Widget = `<pattern>[__<seg>...]`; each `__`-segment after the pattern is
classified: `static`/`sound` → **variation**, a known rig name → **model**,
legacy/unknown → **model** (so old `<pattern>__<oldrig>` clips never vanish). A
clip with no variation segment counts as `static`, so the pre-existing bare
`<pattern>` and `<pattern>__<model>` clips slot onto the Static side. Names:

```
<pattern>__static            <pattern>__sound
<pattern>__<model>__static   <pattern>__<model>__sound
```

### Gallery UX

One card per pattern (as before) with a small **Static | Sound** toggle.
**Opening a pattern** (card tap or grid tile) lands on a **combined view** that
shows BOTH the Static and the Sound clip **side by side**, each labelled, with a
`Both | Static | Sound` switch (default Both) — so you never get stuck on one
variation. The raw single clips are served chrome-free at `/raw/<name>` and are
what the grid thumbnails and `/compare` panes embed. List/grid still scope to
the active rig first. `/api/list` additionally exposes `variation` per clip.

**Both rigs by default.** `gen_variations` (and the launcher's `--regen`) render
every pattern on **test_bench AND titanic** by default, so the model picker has
both rigs' Static/Sound clips out of the box. `--model <one>` forces a single
rig; `--models a,b,c` an explicit set.

### Spec parser — `tools/audio_mod_spec.mjs`

`parseAudioModSpec(src[, name])` → `{ mappings:[{slider,signal,min,max,curve}],
modString, synth }` or `null` (no block). Malformed mapping line = hard error
(never silently dropped). `synth` = `full_track` by default, `kick_4floor` for
kick-gated/beat patterns (heartbeat/kick/shockwave/strobe). `modString` is the
range-aware harness `--mod` string, e.g.
`micLow:sliderLevel:0.30:1.00:linear,micKick:sliderKick:0.00:1.00:pow2`.

### Harness `--mod` range grammar — `tools/pattern_audio_harness.mjs`

`--mod sig:slider[:min:max[:curve]]` (comma-separated). Bare `sig:slider` =
`0..1` linear (identity, legacy). With a range, each frame
`slider = lerp(min, max, curve(signalNorm))` — matching the engine's OVERRIDE
modulation. `curve ∈ linear | pow2 (x²) | ease (1−(1−x)²)`, default `linear`. Bad
range/curve fails loud (`MOD_FAIL`).
<!-- END variation-axis (NEW — feat/highdef_patterns) -->

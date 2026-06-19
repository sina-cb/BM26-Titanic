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
| `/`         | Phone index: grouped/sorted cards, search box + family/model filter chips |
| `/grid`     | Contact-sheet of live clip thumbnails (lazy-loaded), tap to open |
| `/compare`  | Two clips side by side (`?a=<name>&b=<name>`; pickers if missing) |
| `/w/<name>` | The standalone clip page, sticky `← gallery` bar + `‹ ›` prev/next |
| `/api/list` | JSON `[{name, mtime, num, family, model}]`, newest first |

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
- `server.mjs` — http server (index, `/w/<name>`, `/api/list`, 404).
- `gallery_config.json` — the served port.
- `publish.mjs` — CLI to publish/update a widget.
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

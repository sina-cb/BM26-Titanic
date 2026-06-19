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

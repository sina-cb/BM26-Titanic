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
node tools/gallery/gallery_launcher.mjs              # port from gallery_config.json (6765)
node tools/gallery/gallery_launcher.mjs --port 6765  # explicit override
GALLERY_PORT=6765 node tools/gallery/gallery_launcher.mjs
```

It is standalone — NOT the production stack launcher (`launcher.js`) and shares
no code with it. To start the bare server without the Tailscale highlight:

```bash
cd marsin_engine
node tools/gallery/server.mjs              # same port contract
node tools/gallery/server.mjs --port 6765  # explicit override
GALLERY_PORT=6765 node tools/gallery/server.mjs
```

The port lives in **`gallery_config.json`** (`{ "port": 6765 }`). Resolution
order is `--port` arg > `GALLERY_PORT` env > `gallery_config.json` > built-in
default `6765`. A present-but-malformed config is a hard error (we never
silently fall back to a different port). **Port 6765** binds `0.0.0.0` and
deliberately stays off the engine/sim range 6967–6972. On startup it prints the
port, the localhost URL, and every non-internal IPv4 address so you can pick
your Tailscale one.

## Phone access (Tailscale)

With Tailscale up on both the laptop and the phone, open:

```text
http://<your-tailscale-ip>:6765/
```

on the phone. The server prints the candidate addresses at startup — use the
Tailscale `100.x.y.z` one. No auth (local / Tailscale only).

## URL scheme

| Path           | What it serves                                              |
|----------------|------------------------------------------------------------|
| `/`            | Phone-friendly index: search box + tap list of all widgets (newest first, with publish time) |
| `/w/<name>`    | The standalone widget page, with a sticky `← gallery` top bar |
| `/api/list`    | JSON `[{ "name":…, "mtime":… }]`, newest first             |

The widgets dir is re-read on **every** request, so newly published patterns
appear without restarting the server.

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
- `gallery_config.json` — the served port (`{ "port": 6765 }`).
- `publish.mjs` — CLI to publish/update a widget (both forms above).
- `widgets/` — published `<name>.html` pages (scratch; gitignored).
- `widgets/.gitignore` — ignores everything in the dir except itself.
- `README.md` — this file.

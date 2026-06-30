# Gallery regen (all patterns) + dedicated gallery launcher

**Date:** 2026-06-18
**Branch:** `feat/highdef_patterns`
**Author:** pattern-finder agent (with Sina)

## What was done

1. **Regenerated the offline phone gallery for every top-level show pattern.**
   Ran the harness → publish loop over `marsin_engine/patterns/[0-9]*_*.js` +
   `rainbow.js`:
   ```bash
   cd marsin_engine
   for f in patterns/[0-9]*_*.js patterns/rainbow.js; do
     name=$(basename "$f" .js)
     node tools/pattern_audio_harness.mjs --pattern "$f" --synth full_track \
       --frames 96 --out ~/tmp/genkit/out/$name.json
     node tools/gallery/publish.mjs --name "$name" --capture ~/tmp/genkit/out/$name.json
   done
   ```
   **58/58 published, zero failures** (00–54, 57, 58, rainbow). The harness runs
   fully offline (no engine boot), so there is **no source-tree residue** — captures
   live in `~/tmp/genkit/out/`, widgets in the gitignored `tools/gallery/widgets/`.
   `test_const` / `test_dualband` were **not** published (not numbered show
   patterns; out of scope for the gallery).

2. **Added a dedicated gallery launcher** —
   `marsin_engine/tools/gallery/gallery_launcher.mjs`. Standalone, Node built-ins
   only, in the same style as `server.mjs`. It is **NOT** the production stack
   launcher (`launcher.js`) and shares no code with it. Value over running the
   bare server: it resolves the served port (same contract — `--port` >
   `GALLERY_PORT` > `gallery_config.json` > 6765, malformed config is fatal),
   prints the **Tailscale phone URL** up front, then spawns `server.mjs` pinned
   to that port; Ctrl+C tears the server down cleanly.

3. **Pointed the docs at the launcher** — skill `13_pattern_gallery.md` and
   `tools/gallery/README.md` now use `gallery_launcher.mjs` as the preferred
   launch/serve step (bare `server.mjs` retained as the no-highlight fallback).

## Verification

Served via the launcher on **port 6765** (`0.0.0.0`). `/` returned `200`,
`/api/list` listed **58** widgets, and the launcher surfaced the phone URL
`http://100.98.202.90:6765/` (Tailscale). Confirm on-device by opening that URL
with Tailscale up and checking a couple of clips animate (Pause/Speed work).

## Notes

- Widgets are gitignored scratch — nothing from the regen is committed; the
  gallery regenerates anytime from captures.
- Committed in this change: the launcher, the two doc updates, and this report.

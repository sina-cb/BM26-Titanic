---
description: Capture short video clips (MP4/GIF) of the 3D lighting simulation
---

# 🎥 Capture Sim Video — Frame-Burst → MP4

This skill records short video clips of the BM26 Titanic simulation by capturing
a burst of frames from the running sim and encoding them with ffmpeg. Use it
when a still PNG (see `00_see_the_world.md`) isn't enough — e.g. showing a
pattern animating, a gradient color-wave sweeping the ship, or a
transition/crossfade in motion.

It is a **preview/sharing tool only** — like the screenshot renderer, it runs the
headed Chromium + SwiftShader pipeline. It is NOT part of the deployed playa
stack (the offline-readiness rules in the codex do not apply to this dev-only
tool).

> ⚠️ There is no real screen-recording here. We capture a sequence of PNG frames
> and stitch them. On software-GL machines each frame is expensive, so clips
> read more like a stylized timelapse than buttery-smooth motion. That is
> expected; tune for it (see §4).

> Note: for an exact **per-pixel LED replay** of a pattern (the CaptainPad
> DECK MAIN look) rather than a 3D-scene clip, use `08_visualize_patterns_widget.md`
> instead — that taps the engine's real pixel buffer. This skill films the 3D sim.

## Prerequisites
- The sim servers running (`cd simulation && npm start`) — same as `00_see_the_world.md`.
- `simulation/agent_tools/capture_seq.cjs` — the frame-burst capture tool
  (committed alongside `agent_render.cjs`; reuses its Chrome flags + load/hide logic).
- An ffmpeg binary. The container often has no system ffmpeg. Get one without
  apt via npm's `ffmpeg-static`:
  ```bash
  mkdir -p ~/tmp/vid && cd ~/tmp/vid
  npm init -y >/dev/null && npm i ffmpeg-static >/dev/null
  FF=$(node -p "require('ffmpeg-static')")   # path to the ffmpeg binary
  ```
  (`~/tmp` is gitignored — keep all frames and clips there.)

## Workflow

### 1. Capture a frame burst
Run from `simulation/agent_tools/` (so `node_modules/puppeteer` resolves). Wrap
in `xvfb-run -a` on headless machines.
```bash
cd simulation/agent_tools
URL="http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl&lighting_mode=gradient"
xvfb-run -a node capture_seq.cjs \
  --view dramatic --frames 24 --interval 0 \
  --viewport 640x360 --url "$URL" \
  --out ~/tmp/vid/frames
```

| Flag | Meaning |
|---|---|
| `--view <key>` | Camera preset from `scenes/<scene>/cameras.yaml` (e.g. `dramatic`, `aerial`, `topright`) |
| `--frames N` | Number of frames to capture |
| `--interval MS` | Extra delay between frames (use 0; the screenshot cost already dominates) |
| `--viewport WxH` | Resolution. Lower = faster per frame (use `640x360`/`854x480`) |
| `--url <url>` | Full sim URL (set profile, lighting_mode, scene) |
| `--out <dir>` | Frame output dir (under `~/tmp/`) — wiped + recreated each run |

The tool loads the sim once, navigates to the view, hides the UI, then writes
`f_0000.png … f_NNNN.png` into `--out`.

### 2. Encode to MP4
```bash
FF=$(node -p "require('ffmpeg-static')")     # from ~/tmp/vid
"$FF" -y -framerate 8 -i ~/tmp/vid/frames/f_%04d.png \
  -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
  -c:v libx264 -movflags +faststart ~/tmp/vid/clip.mp4
```
- `-framerate 8` is the playback fps. Lower it (6–10) so each costly frame reads
  as deliberate slow motion rather than a stutter.
- `format=yuv420p` + even dimensions = plays everywhere (phones, browsers).

For a GIF instead:
```bash
"$FF" -y -i ~/tmp/vid/frames/f_%04d.png -vf "fps=8,scale=480:-1:flags=lanczos" ~/tmp/vid/clip.gif
```

### 3. Send it
```
SendUserFile(files: ["~/tmp/vid/clip.mp4"], status: "normal", caption: "...")
```

### 4. Inspect before sending
Always `Read` a mid-sequence frame (e.g. `f_0011.png`) to confirm it isn't
black/blown-out before encoding — same visual-inspection rule as
`00_see_the_world.md`.

## Tuning notes (learned the hard way)
- **Use `profile=full` for light washes.** The big amber/colored spotlight pools
  that make the rig look alive come from the analytic lights in `full`.
  `profile=emissive` only renders the small per-pixel emissive dots + bloom — it
  captures fast but looks dim and flat for fixture washes.
- **SwiftShader is the bottleneck, not `--interval`.** At `1280x720`, full-profile
  frames can take several seconds each. Drop to `640x360` for video; keep
  `1280x720` for hero stills only.
- **Smoothness vs. motion.** Real time between frames ≈ the screenshot cost, so
  the animation jumps by `waveSpeed × seconds-per-frame` each frame. To reduce
  jumpiness, temporarily lower `colorWave.waveSpeed` (e.g. 0.05–0.1) and play
  back at a low fps. There is no way to get 30 fps smoothness out of the
  software renderer — pick a look that embraces the timelapse feel.
- **Default sim exposure is very low** (`masterExposure: 0.05` "preview only" in
  the titanic scene). For visible video, temporarily raise it (~0.7–1.0).

## Render-only scene edits (and ALWAYS restore them)
To make specific lights pop or to isolate a group, you will temporarily edit
scene/atmosphere YAML. These are **render-only — they must never be committed**.
Back up first, edit, render, then restore:
```bash
cp simulation/scenes/common.yaml ~/tmp/common.bak
cp simulation/scenes/titanic/scene_config.yaml ~/tmp/scene.bak
# ... edits (exposure, per-fixture intensity, atmosphere off) ...
# render ...
cp ~/tmp/common.bak simulation/scenes/common.yaml
cp ~/tmp/scene.bak  simulation/scenes/titanic/scene_config.yaml
git status --short   # MUST be clean afterwards (codex P0: no silent residue)
```
The capture browser loads the scene once at page-load, so you can restore the
YAML the moment capture starts and still get the boosted frames — the in-memory
scene is unaffected. Restore early to keep the tree clean.

## Isolating one group ("turn everything off but X")
Set every other fixture's intensity to 0, the target group's to ~80, turn off
LED strands (`ledStrands.strandsEnabled`) and the environment
(`atmosphere.ambientIntensity → 0`, `moonlight.moonEnabled → false`,
`floods.masterFloodEnabled → false`). Edit via js-yaml so the structure stays
valid (the titanic scene uses a YAML anchor on traces — a js-yaml load→dump
round-trip expands it, which is fine for a throwaway render file you restore
afterward).

## File reference
| File | Purpose |
|---|---|
| `simulation/agent_tools/capture_seq.cjs` | Frame-burst capture tool |
| `simulation/agent_tools/agent_render.cjs` | Single-still renderer (`00_see_the_world.md`) |
| `~/tmp/vid/` | Scratch: `node_modules/ffmpeg-static`, frames, clips (gitignored) |
| `scenes/<scene>/cameras.yaml` | Camera preset keys for `--view` |

---
description: Capture a clip/still from the test-bench webcam and (optionally) upload it to Google Drive, to watch the real physical rig remotely
---

# 📷 Webcam Remote Debug — see the real rig from afar

When debugging the physical Titanic rig remotely, a sim screenshot isn't enough
— you need to see the **actual fixtures**. These two tools grab footage from a
USB webcam pointed at the bench and get it to you:

- `simulation/agent_tools/webcam_capture.cjs` — ffmpeg/DirectShow capture → MP4 clip or JPEG still.
- `simulation/agent_tools/webcam_to_drive.cjs` — push the file to Google Drive via rclone (clips are MBs; inlining as base64 is impractical).

**Windows-only** (uses dshow; the bench runs Windows). Dev/debug tooling — not
the playa stack. Output goes under the repo's `tmp/` (gitignored), so nothing
binary gets committed.

## One-time setup (run once on the bench)
```bash
winget install --id Gyan.FFmpeg -e        # ffmpeg (dshow capture + x264 encode)
winget install --id Rclone.Rclone -e      # rclone (Drive upload)
rclone config                             # new remote → name "gdrive" → type "drive" → authorize Google
node simulation/agent_tools/webcam_capture.cjs --list-devices   # confirm the bench cam (e.g. "USB_Camera")
```
Note the exact quoted device name from `--list-devices` — that's your `--device`.
(ffmpeg only needs to be on the Windows PATH; Node finds it even if Git Bash's
PATH doesn't. If it isn't installed you can also pass `--ffmpeg <path>` to any
ffmpeg build, e.g. the bundled `marsin_engine/node_modules/ffmpeg-static`.)

## Capture + upload (the reusable flow)
```bash
# 1) capture a 5s 1080p clip (add --crop to frame just the rig; drop it for the room)
node simulation/agent_tools/webcam_capture.cjs --device "USB_Camera" \
    --size 1920x1080 --fps 30 --duration 5
#    --crop 480x405+636+441     # WxH+X+Y in source pixels, optional
# → prints the output .mp4 path on the LAST stdout line

# 2) upload that path to Drive
node simulation/agent_tools/webcam_to_drive.cjs --file <that-path> \
    --remote "gdrive:Webcam Recordings"
# → prints the Drive destination; share that + a one-line note on what it shows
```
Script it: `OUT=$(node simulation/agent_tools/webcam_capture.cjs --device "USB_Camera" | tail -1)`.

## Quick-look (send a still inline, no Drive)
Images render inline in chat even when video doesn't:
```bash
node simulation/agent_tools/webcam_capture.cjs --still --device "USB_Camera"
```
Then deliver the printed `.jpg` to the operator as a single file.

## webcam_capture.cjs flags
| Flag | Meaning |
|---|---|
| `--list-devices` | List dshow video devices (quoted names → `--device`) |
| `--device <name>` | dshow device friendly name (default `USB_Camera`) |
| `--size WxH` | Resolution (default `1920x1080`) — **must be a mode the camera advertises** |
| `--fps N` | Frame rate (default 30) — also must match an advertised mode |
| `--duration S` | Clip length (default 5; ignored with `--still`) |
| `--crop WxH+X+Y` | Crop region in source pixels (e.g. `480x405+636+441`) |
| `--raw` | Use the cam's raw (yuyv422) mode instead of MJPEG (some cams need this) |
| `--still` | One JPEG frame instead of a clip |
| `--crf N` | x264 quality, lower = better/larger (default 20) |
| `--out <path>` | Output path (default `<repo>/tmp/webcam/<ts>.<ext>`) |
| `--ffmpeg <path>` | Explicit ffmpeg binary (else PATH, else winget location) |

## webcam_to_drive.cjs flags
| Flag | Meaning |
|---|---|
| `--file <path>` | File to upload (required) |
| `--remote <r:dir>` | rclone `remote:folder` (required), e.g. `"gdrive:Webcam Recordings"` |
| `--name <name>` | Rename on upload (default keeps the source filename) |
| `--rclone <path>` | Explicit rclone binary (else PATH) |

## Gotchas (learned by running it)
- **Mode matching is the #1 failure.** If ffmpeg says *"Could not set video
  options"*, the `--size`/`--fps`/codec combo isn't a mode the camera
  advertises. Run `--list-devices`, and if MJPEG fails try `--raw` and/or a
  common mode (e.g. `--raw --size 640x480 --fps 30`). The default MJPEG path
  unlocks 1080p30 on most UVC cams.
- **Give the camera a beat between captures.** Back-to-back opens (e.g. a still
  immediately followed by a clip) can throw a transient `I/O error` while the
  device releases — wait ~2–3 s and retry.
- **Both tools fail loud** (codex P0): missing ffmpeg/rclone, a bad device/mode,
  or a missing file exits non-zero with a clear hint — never a silent no-op.
- The capture tool prints the output path as the **last stdout line only**
  (logs go to stderr), so `| tail -1` always gives the path.

## File reference
| File | Purpose |
|---|---|
| `simulation/agent_tools/webcam_capture.cjs` | dshow webcam → MP4 clip / JPEG still |
| `simulation/agent_tools/webcam_to_drive.cjs` | upload a file to Drive via rclone |
| `tmp/webcam/` | output dir (gitignored) |
| `00_see_the_world.md` / `09_capture_sim_video.md` | the *sim*-side still / video tools (this skill is for the *real* rig) |

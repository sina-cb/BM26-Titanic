#!/usr/bin/env node
/**
 * webcam_capture.cjs — capture a short clip (or still) from a webcam via
 * ffmpeg's DirectShow backend, for remote test-bench debugging.
 *
 * Why this exists: when debugging the physical rig from afar, a screenshot of
 * the sim isn't enough — you need to see the real fixtures. This grabs a clip
 * from a USB webcam pointed at the bench. Pair it with webcam_to_drive.cjs to
 * push the file somewhere you can watch it.
 *
 * DirectShow (dshow) is Windows-only; the test bench runs Windows. On Linux you
 * would swap the input to v4l2, on macOS to avfoundation — out of scope here.
 *
 * Modes:
 *   node webcam_capture.cjs --list-devices              List dshow video devices
 *   node webcam_capture.cjs                             5s clip, default device, 1080p30
 *   node webcam_capture.cjs --still                     Single JPEG frame
 *
 * Flags:
 *   --device <name>    dshow device friendly name (default "USB_Camera").
 *                      Run --list-devices to see the exact names.
 *   --size WxH         Capture resolution (default 1920x1080). Must be a mode
 *                      the camera advertises (see --list-devices output).
 *   --fps N            Capture frame rate (default 30).
 *   --duration S       Clip length in seconds (default 5). Ignored with --still.
 *   --crf N            x264 quality, lower = better/larger (default 20).
 *   --crop WxH+X+Y     Crop region in source pixels (e.g. 480x405+636+441).
 *   --raw              Use the camera's raw (yuyv422) mode instead of MJPEG.
 *                      MJPEG is the default because it unlocks 1080p30 on most
 *                      UVC cams; raw is often capped to a few fps at HD.
 *   --still            Capture one JPEG frame instead of a clip.
 *   --out <path>       Output file path (default <repo>/tmp/webcam/<ts>.<ext>).
 *   --ffmpeg <path>    Explicit ffmpeg binary (else PATH, else winget install).
 *
 * Output path is printed on the last line of stdout (and nothing else there),
 * so callers can capture it with `OUT=$(node webcam_capture.cjs | tail -1)`.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Config ──
const DEFAULT_DEVICE = 'USB_Camera';
const DEFAULT_SIZE = '1920x1080';
const DEFAULT_FPS = 30;
const DEFAULT_DURATION = 5;
const DEFAULT_CRF = 20;

// agent_tools lives at simulation/agent_tools; repo root is two levels up. We
// write under the repo's tmp/ (gitignored) so the mobile/remote viewer, which
// only serves files inside the project tree, can show the result.
const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'tmp', 'webcam');

// ── CLI parsing ──
const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function opt(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`❌ ${name} expects a value.`);
    process.exit(1);
  }
  return value;
}

// ── ffmpeg discovery ──
// Fail loudly if ffmpeg is missing — no silent skip (codex P0).
function findFfmpeg(override) {
  if (override) {
    if (!fs.existsSync(override)) {
      console.error(`❌ --ffmpeg path does not exist: ${override}`);
      process.exit(1);
    }
    return override;
  }
  const onPath = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'ffmpeg';
  const wingetBase = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft', 'WinGet', 'Packages',
  );
  const found = findExeUnder(wingetBase, 'ffmpeg.exe', 'Gyan.FFmpeg');
  if (found) return found;
  console.error(
    '❌ ffmpeg not found. Install it with:  winget install --id Gyan.FFmpeg -e\n' +
    '   (or pass --ffmpeg <path> to an existing binary).',
  );
  process.exit(1);
}

// Shallow-ish recursive search for an executable under a base dir, only
// descending into entries whose top-level name contains `topMatch`.
function findExeUnder(baseDir, exeName, topMatch) {
  if (!baseDir || !fs.existsSync(baseDir)) return null;
  const tops = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.includes(topMatch));
  for (const top of tops) {
    const hit = walkFor(path.join(baseDir, top.name), exeName, 6);
    if (hit) return hit;
  }
  return null;
}
function walkFor(dir, exeName, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return null; // unreadable dir — keep searching elsewhere
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === exeName) return full;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const hit = walkFor(path.join(dir, entry.name), exeName, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

// ── Device listing ──
function listDevices(ffmpeg) {
  // ffmpeg exits non-zero on the dummy input by design; we parse stderr.
  const res = spawnSync(
    ffmpeg,
    ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
    { encoding: 'utf8' },
  );
  const lines = (res.stderr || '').split(/\r?\n/);
  console.log('Video devices (use the quoted name as --device):\n');
  for (const line of lines) {
    const m = /"([^"]+)"\s+\(video\)/.exec(line);
    if (m) console.log(`  • ${m[1]}`);
  }
}

// ── Crop geometry: WxH+X+Y → "crop=W:H:X:Y" ──
function parseCrop(geometry) {
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(geometry);
  if (!m) {
    console.error(`❌ --crop expects WxH+X+Y (e.g. 480x405+636+441), got: ${geometry}`);
    process.exit(1);
  }
  const [, w, h, x, y] = m;
  return `crop=${w}:${h}:${x}:${y}`;
}

// ── Capture ──
function capture(ffmpeg) {
  const device = opt('--device', DEFAULT_DEVICE);
  const size = opt('--size', DEFAULT_SIZE);
  const fps = opt('--fps', String(DEFAULT_FPS));
  const duration = opt('--duration', String(DEFAULT_DURATION));
  const crf = opt('--crf', String(DEFAULT_CRF));
  const cropGeometry = opt('--crop', null);
  const useRaw = flag('--raw');
  const still = flag('--still');
  const ext = still ? 'jpg' : 'mp4';
  const defaultOut = path.join(DEFAULT_OUT_DIR, `${Math.floor(Date.now() / 1000)}.${ext}`);
  const outPath = opt('--out', defaultOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const input = ['-f', 'dshow', '-rtbufsize', '512M'];
  if (!useRaw) input.push('-vcodec', 'mjpeg');
  input.push('-video_size', size, '-framerate', fps, '-i', `video=${device}`);

  const filters = cropGeometry ? ['-vf', parseCrop(cropGeometry)] : [];
  const encode = still
    ? ['-update', '1', '-frames:v', '1', '-q:v', '2']   // -update: write one image to the exact path (no %d pattern)
    : [
      '-t', duration,
      '-c:v', 'libx264', '-crf', crf, '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    ];

  const ffArgs = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    ...input, ...filters, ...encode, outPath,
  ];

  console.error(`🎥 Capturing from "${device}" @ ${size}/${fps}fps → ${outPath}`);
  const res = spawnSync(ffmpeg, ffArgs, { encoding: 'utf8' });
  if (res.stderr) console.error(res.stderr.trim());
  if (res.status !== 0 || !fs.existsSync(outPath)) {
    console.error(`❌ Capture failed (exit ${res.status}). Check --device/--size against --list-devices.`);
    process.exit(1);
  }
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.error(`✅ Wrote ${kb} KB`);
  // Last stdout line = the path, for easy scripting.
  console.log(outPath);
}

// ── Main ──
function main() {
  const ffmpeg = findFfmpeg(opt('--ffmpeg', null));
  if (flag('--list-devices')) {
    listDevices(ffmpeg);
    return;
  }
  capture(ffmpeg);
}

main();

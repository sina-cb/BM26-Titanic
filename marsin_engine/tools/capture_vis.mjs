/*
  capture_vis.mjs — capture the engine's LIVE per-pixel vis buffer to JSON.

  Grabs the exact bytes CaptainPad's DECK MAIN strip renders (the engine's
  `master` / `rig` vis broadcast over ws://<host>:6968/ws/viz) — 6 bytes per
  pixel (R,G,B,W,A,U), in model.pixels[] order, NOT subsampled when the model
  fits under the cap (e.g. test_bench's 52 px). Also records per-pixel metadata
  (fId, sId, nx, ny) so the clip generator can group + sort by PHYSICAL position
  without hardcoding any per-model layout.

  Usage (run from marsin_engine/):
    node tools/capture_vis.mjs --pattern 27_swipe --frames 48 --buffer master \
        --out ~/tmp/vis.json [--host 127.0.0.1:6968] [--model test_bench] \
        [--sections 1,2,3] [--set sliderBlur=0,sliderTrail=0.5] [--view deck]

  Notes:
   - The vis WS broadcasts at ~5 Hz; `--frames 48` ≈ 9.6 s of capture.
   - `master` = mixer composition (what DECK MAIN shows). `rig` = post dimmers
     + blackout + global FX (hardware-truth). Use `rig` to judge brightness
     floors as they reach the lights; `master` for the composition look.
   - `--set` pushes deck control values first (after loading the pattern), so
     the capture reflects the exact slider state you want. Control ids are
     resolved from /exports by name.
*/
import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}
const pattern = arg('pattern', null);
// --seconds (real-time clip length) wins over --frames, mirroring the offline
// harness. The vis WS broadcasts at ~5 Hz, so out-fps defaults to 5 here (the
// stored-frame cadence); frames = round(seconds * out-fps). fps/seconds are
// stamped into the JSON so the clip plays at the right rate (JSON shape stays
// otherwise identical to the legacy --frames capture).
const secondsArg = arg('seconds', null);
const outFps = parseFloat(arg('out-fps', '5'));
if (!(outFps > 0) || !isFinite(outFps)) { console.error('❌ --out-fps must be > 0, got ' + arg('out-fps', '5')); process.exit(1); }
const useSeconds = secondsArg !== null && secondsArg !== undefined;
const seconds = useSeconds ? parseFloat(secondsArg) : null;
if (useSeconds && (!(seconds > 0) || !isFinite(seconds))) { console.error('❌ --seconds must be > 0, got ' + secondsArg); process.exit(1); }
const frames = useSeconds ? Math.max(1, Math.round(seconds * outFps)) : parseInt(arg('frames', '48'), 10);
const stampFps = useSeconds ? outFps : parseFloat(arg('out-fps', '5'));
const buffer = arg('buffer', 'master');           // master | rig
const host = arg('host', '127.0.0.1:6968');
const modelName = arg('model', 'test_bench');
const view = arg('view', 'deck');
const sections = (arg('sections', '') || '').split(',').filter(Boolean);
const sets = (arg('set', '') || '').split(',').filter(Boolean).map(s => s.split('='));
const outRaw = arg('out', path.join(process.env.USERPROFILE || process.env.HOME, 'tmp', 'vis.json'));
const out = outRaw.replace(/^~/, process.env.USERPROFILE || process.env.HOME);

const base = 'http://' + host;
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.text());

async function ids() {
  const ex = await (await fetch(base + '/exports')).json();
  const list = Array.isArray(ex) ? ex : (ex.exports || ex.controls || []);
  const id = {}; for (const e of list) if (e && e.name) id[e.name] = e.id;
  return id;
}

const model = await import(pathToFileURL(path.join(ENGINE_DIR, 'models', modelName + '.js')).href);
const meta = model.pixels.map(p => ({ i: p.i, fId: p.fId || 0, sId: p.sId || 0, nx: p.nx, ny: p.ny, nz: p.nz }));
// Raw physical axis spreads (un-normalized model coords if present) so the clip
// generator's `--view auto` can pick the two physically-widest axes (nx/ny/nz
// are normalized per-axis and lose the real-world aspect).
function rawSpread(ax) { const v = model.pixels.map(p => p[ax]).filter(x => typeof x === 'number'); return v.length ? (Math.max(...v) - Math.min(...v)) : 0; }
const coordSpread = (typeof model.pixels[0].x === 'number') ? { x: rawSpread('x'), y: rawSpread('y'), z: rawSpread('z') } : null;

if (pattern) {
  console.log('loading pattern', pattern);
  await post('/pattern', { pattern });
  await post('/mixer/view', { view });
  for (const s of sections) await post('/section-brightness', { sectionId: +s, brightness: 1.0 });
  if (sets.length) {
    const id = await ids();
    for (const [name, val] of sets) {
      if (id[name] === undefined) {
        console.error('❌ unknown control in --set: ' + name + ' (not in /exports)');
        process.exit(1);
      }
      await post('/control', { id: id[name], v0: +val });
    }
  }
  await new Promise(r => setTimeout(r, 800));
}

const frameData = await new Promise(res => {
  const acc = []; const ws = new WebSocket('ws://' + host + '/ws/viz');
  ws.on('open', () => console.log('connected /ws/viz, capturing', frames, 'frames of', buffer));
  ws.on('message', d => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.type !== 'vis' || !m.vis || !m.vis[buffer]) return;
    const buf = Buffer.from(m.vis[buffer], 'base64');
    // Fold White/Amber/UV into the displayed RGB the SAME way the offline harness
    // does (pattern_audio_harness.mjs fold), so a W/A/U-heavy pattern (e.g.
    // 16_ghost_tide_uv) captures with matching brightness/hue live vs offline —
    // not darker because the extra channels were dropped. 6ch order: R,G,B,W,Am,U.
    const fr = [];
    for (let i = 0; i < buf.length / 6; i++) {
      const o = i * 6;
      const R = buf[o], G = buf[o + 1], B = buf[o + 2], W = buf[o + 3], Am = buf[o + 4], U = buf[o + 5];
      fr.push([
        Math.min(255, Math.round(R + W + Am * 0.8 + U * 0.1)),
        Math.min(255, Math.round(G + W + Am * 0.4)),
        Math.min(255, Math.round(B + W + U * 0.5)),
      ]);
    }
    acc.push(fr);
    if (acc.length >= frames) { ws.close(); res(acc); }
  });
  setTimeout(() => { try { ws.close(); } catch {} res(acc); }, frames * 250 + 4000);
});

// Fail loudly (codex P0: no silent fallback) — if we captured nothing, the
// engine is down / not broadcasting; don't write an empty JSON and exit 0.
if (frameData.length === 0) {
  console.error('❌ captured 0 frames from ws://' + host + '/ws/viz — is the engine running and broadcasting vis?');
  process.exit(1);
}
if (frameData.length < frames) {
  console.warn('⚠️  captured only ' + frameData.length + '/' + frames + ' frames before timeout.');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ pattern, buffer, model: modelName, fps: stampFps, seconds: useSeconds ? seconds : +(frameData.length / stampFps).toFixed(3), coordSpread, meta, frames: frameData }));
console.log('wrote', frameData.length, 'frames x', (frameData[0] || []).length, 'px ->', out);
process.exit(0);

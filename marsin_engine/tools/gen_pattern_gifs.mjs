/*
  gen_pattern_gifs.mjs — render a COMPACT test_bench preview of each pattern as a
  small animated GIF for the catalog. DEV/DOC TOOL ONLY.

  Layout mirrors the gallery widget, condensed to two rows:
    top row  = Pars (sId 1) + Vintage (sId 2), laid out left→right
    bottom row = Bars (sId 3)
  For each pattern we drive it offline through the real harness (sound-reactive
  clip), pull the three sections out of the capture JSON, and encode an animated
  GIF. Self-contained: Node built-ins only, with an inlined GIF89a (per-frame
  local color table, LZW) encoder — no deps, no CDNs, offline-safe.

  Usage (from marsin_engine/):
    node tools/gen_pattern_gifs.mjs                    # all patterns -> patterns/gifs/
    node tools/gen_pattern_gifs.mjs --pattern 00,13,25
    node tools/gen_pattern_gifs.mjs --seconds 2.5 --fps 12 --variation static
*/
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';
import { execFileSync } from 'child_process';
import { parseAudioModSpec } from './audio_mod_spec.mjs';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i + 1]; }

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const OUT_DIR = path.resolve(arg('out-dir', path.join(PATTERNS_DIR, 'gifs')));
const TMP = path.join(os.homedir(), 'tmp', 'pattern_gifs');
const seconds = arg('seconds', '2.5');
const fps = arg('fps', '12');
const variation = arg('variation', 'sound');     // sound | static

// Layout MIRRORS the gallery's test_bench strip widget (tools/make_vis_clip.mjs):
// each section stacked vertically with its label — a horizontal cell ROW for an
// x-axis section (Pars sId 1, Bars sId 3) and one COLUMN per fixture of square
// cells for a y-axis section (Vintage sId 2). Geometry is derived from the
// capture meta exactly like the widget, never invented.
const W = 384;
const LBL_H = 7, LBL_PAD = 2, SEC_GAP = 8;         // label band height + spacing
const ROW_H = 18, ROW_RGAP = 1;                    // horizontal section (Pars/Bars) cell row
const SQ_W = 24, SQ_H = 13, COL_GAP = 12, VG = 3;  // vertical section (Vintage) squares
const LABEL_RGB = [120, 130, 150];                 // cool grey, dim vs the lights

// 5x7 uppercase bitmap font (rows MSB-left), only the glyphs the labels need.
const FONT = {
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
};
function drawText(px, x0, y0, str, ci, H) {
  let x = x0;
  for (const ch of str) {
    const g = FONT[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r] & (1 << (4 - c))) { const X = x + c, Y = y0 + r; if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = ci; }
    }
    x += 6;
  }
}

// ── GIF89a animated encoder (per-frame local color table + LZW) ───────────────
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  write(code, len) {
    for (let i = 0; i < len; i++) {
      if (code & (1 << i)) this.cur |= (1 << this.n);
      if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  flush() { if (this.n > 0) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } }
}

// LZW-encode palette indices (GIF variant). Code-width growth + full-table clear
// follow the omggif/spec convention: bump BEFORE assigning the code that needs
// the wider width (bumping a step early produces a stream real decoders reject).
function lzw(indices, paletteBits) {
  const minCodeSize = Math.max(2, paletteBits);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const bw = new BitWriter();
  let codeWidth, dict, next;
  const reset = () => { dict = new Map(); next = clear + 2; codeWidth = minCodeSize + 1; };
  const codeOf = s => (dict.has(s) ? dict.get(s) : +s);   // single symbol -> its own value
  reset();
  bw.write(clear, codeWidth);
  let prev = '' + indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const cand = prev + ',' + k;
    if (dict.has(cand)) { prev = cand; continue; }
    bw.write(codeOf(prev), codeWidth);
    if (next === 4096) {
      bw.write(clear, codeWidth);   // table full -> clear + restart
      reset();
    } else {
      if (next === (1 << codeWidth) && codeWidth < 12) codeWidth++;
      dict.set(cand, next++);
    }
    prev = '' + k;
  }
  bw.write(codeOf(prev), codeWidth);
  bw.write(eoi, codeWidth);
  bw.flush();
  return { minCodeSize, data: bw.bytes };
}

function subBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

// frames: [{ palette:[[r,g,b]...], pixels:Uint8Array(W*HEIGHT) }]
function encodeGif(frames, width, height, delayCs) {
  const b = [];
  const push = (...x) => b.push(...x);
  const u16 = v => push(v & 0xff, (v >> 8) & 0xff);
  for (const c of 'GIF89a') push(c.charCodeAt(0));
  u16(width); u16(height); push(0x00, 0x00, 0x00);        // LSD: no global color table
  push(0x21, 0xff, 0x0b);                                 // NETSCAPE loop-forever
  for (const c of 'NETSCAPE2.0') push(c.charCodeAt(0));
  push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const f of frames) {
    const n = f.palette.length;
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, n))));
    const ctEntries = 1 << bits;
    push(0x21, 0xf9, 0x04, 0x04); u16(delayCs); push(0x00, 0x00);   // GCE (disposal 1)
    push(0x2c); u16(0); u16(0); u16(width); u16(height);            // image descriptor
    push(0x80 | (bits - 1));                                        // LCT present, size bits-1
    for (let i = 0; i < ctEntries; i++) {
      const c = f.palette[i] || [0, 0, 0];
      push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff);
    }
    const { minCodeSize, data } = lzw(f.pixels, bits);
    push(minCodeSize, ...subBlocks(data));
  }
  push(0x3b);
  return Buffer.from(b);
}

// ── layout (mirrors make_vis_clip strip layout) ───────────────────────────────
const SECTION_NAMES = { 1: 'PARS', 2: 'VINTAGE', 3: 'BARS' };   // test_bench sIds
function buildLayout(meta) {
  const bySection = {};
  meta.forEach((m, j) => { (bySection[m.sId] = bySection[m.sId] || []).push({ ...m, j }); });
  const sections = [];
  for (const sId of Object.keys(bySection).map(Number).sort((a, b) => a - b)) {
    const px = bySection[sId];
    const nxs = px.map(p => p.nx), nys = px.map(p => p.ny);
    const vertical = (Math.max(...nys) - Math.min(...nys)) > (Math.max(...nxs) - Math.min(...nxs));
    const name = SECTION_NAMES[sId] || ('SEC' + sId);
    if (vertical) {
      const fids = [...new Set(px.map(p => p.fId))].sort((a, b) => a - b);
      const cols = fids.map(f => px.filter(p => p.fId === f).sort((a, b) => b.ny - a.ny).map(p => p.j)); // top→bottom
      sections.push({ name, axis: 'y', cols });
    } else {
      const row = px.slice().sort((a, b) => a.nx - b.nx).map(p => p.j);               // left→right
      sections.push({ name, axis: 'x', cols: [row] });
    }
  }
  return sections;
}

// Stack the sections vertically; compute each section's y offsets + total height.
function geometry(sections) {
  let y = 0; const secY = [];
  for (const sec of sections) {
    const cellY = y + LBL_H + LBL_PAD;
    const h = sec.axis === 'x'
      ? ROW_H
      : (() => { const R = Math.max(...sec.cols.map(c => c.length)); return R * SQ_H + (R - 1) * VG; })();
    secY.push({ labelY: y, cellY, sec });
    y = cellY + h + SEC_GAP;
  }
  return { secY, H: y - SEC_GAP };
}

function buildFrame(fr, geom) {
  const pal = [[0, 0, 0]];                                // index 0 = black bg/gap
  const key = new Map(); key.set('0,0,0', 0);
  const idxOf = c => { const k = c.join(','); if (!key.has(k)) { key.set(k, pal.length); pal.push(c); } return key.get(k); };
  const colAt = j => idxOf(fr[j].map(clamp255));
  const lbl = idxOf(LABEL_RGB);
  const H = geom.H;
  const px = new Uint8Array(W * H);
  const rect = (x0, y0, w, h, ci) => {
    for (let y = y0; y < y0 + h && y < H; y++) for (let x = x0; x < x0 + w && x < W; x++) if (x >= 0 && y >= 0) px[y * W + x] = ci;
  };
  for (const { labelY, cellY, sec } of geom.secY) {
    drawText(px, 2, labelY, sec.name, lbl, H);
    if (sec.axis === 'x') {
      const row = sec.cols[0], n = row.length;
      for (let i = 0; i < n; i++) {
        const cx0 = Math.round(i * W / n), cx1 = Math.round((i + 1) * W / n);
        rect(cx0, cellY, (cx1 - cx0) - ROW_RGAP, ROW_H, colAt(row[i]));
      }
    } else {
      let cx = 2;
      for (const col of sec.cols) {
        for (let r = 0; r < col.length; r++) rect(cx, cellY + r * (SQ_H + VG), SQ_W, SQ_H, colAt(col[r]));
        cx += SQ_W + COL_GAP;
      }
    }
  }
  return { palette: pal, pixels: px };
}

function captureFor(file, base) {
  const src = fs.readFileSync(path.join(PATTERNS_DIR, file), 'utf8');
  const spec = parseAudioModSpec(src, base);
  const out = path.join(TMP, base + '.json');
  const flags = ['--pattern', path.join('patterns', file), '--model', 'test_bench',
    '--seconds', String(seconds), '--out-fps', String(fps), '--out', out];
  if (variation === 'sound' && spec) flags.push('--synth', spec.synth, '--mod', spec.modString);
  else flags.push('--synth', 'silence');
  execFileSync('node', [HARNESS, ...flags], { cwd: ENGINE_DIR, stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const clamp255 = v => Math.max(0, Math.min(255, v | 0));

function patternGif(cap) {
  const sections = buildLayout(cap.meta);
  if (!sections.length) throw new Error('no sections in capture meta');
  const geom = geometry(sections);
  const frames = cap.frames.map(fr => buildFrame(fr, geom));
  const delayCs = Math.max(2, Math.round(100 / Number(fps)));
  return encodeGif(frames, W, geom.H, delayCs);
}

// ── driver ────────────────────────────────────────────────────────────────────
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const filter = arg('pattern');
const wanted = filter ? new Set(filter.split(',').map(s => s.trim())) : null;
const files = fs.readdirSync(PATTERNS_DIR).filter(f => /^\d+_.*\.js$/.test(f)).sort()
  .filter(f => !wanted || wanted.has(/^(\d+)_/.exec(f)[1]));

console.log('gen_pattern_gifs: ' + files.length + ' pattern(s) -> ' + OUT_DIR +
  ' (' + variation + ', ' + seconds + 's @ ' + fps + 'fps, width ' + W + ', test_bench widget layout)');
let done = 0;
for (const file of files) {
  const base = file.replace(/\.js$/, '');
  const num = /^(\d+)_/.exec(file)[1];
  process.stdout.write('  ' + base + ' … ');
  const gif = patternGif(captureFor(file, base));
  fs.writeFileSync(path.join(OUT_DIR, num + '.gif'), gif);
  console.log((gif.length / 1024).toFixed(1) + ' KB');
  done++;
}
console.log('wrote ' + done + ' gif(s).');

/**
 * wiring_schematic.mjs — offline, dependency-free renderer for the Wiring
 * Tracer (docs/36_wiring_tracer.md §7, "printable wiring views").
 *
 * End-to-end: wiring.yaml -> validated wiring_model -> BOM -> projected PNG
 * wiring sheets. Pure Node (zlib for PNG, software 3D projection); no WebGL,
 * no browser, no external deps — playa/offline-ready (codex). Each sheet is an
 * orthographic projection of the COMPLETE wiring data: every route drawn as a
 * coloured cable, components/anchors as labelled markers, a ground grid, the
 * calibrated scale, and a legend; plus a BOM page.
 *
 * Usage:
 *   node tools/wiring_schematic.mjs <wiring.yaml> <outDir>
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWiring, computeBom, formatBomText } from '../src/wiring/wiring_model.js';

// ─── PNG encoder (RGBA, no deps) ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Canvas (RGBA software raster) ───────────────────────────────────────────

class Canvas {
  constructor(width, height, bg = [244, 244, 246, 255]) {
    this.w = width;
    this.h = height;
    this.buf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.buf[i * 4] = bg[0]; this.buf[i * 4 + 1] = bg[1];
      this.buf[i * 4 + 2] = bg[2]; this.buf[i * 4 + 3] = bg[3];
    }
  }

  blend(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const ia = 1 - a;
    this.buf[i] = r * a + this.buf[i] * ia;
    this.buf[i + 1] = g * a + this.buf[i + 1] * ia;
    this.buf[i + 2] = b * a + this.buf[i + 2] * ia;
    this.buf[i + 3] = 255;
  }

  disk(cx, cy, radius, [r, g, b], alpha = 1) {
    const r0 = Math.ceil(radius + 1);
    for (let dy = -r0; dy <= r0; dy++) {
      for (let dx = -r0; dx <= r0; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        const cov = Math.max(0, Math.min(1, radius + 0.5 - d));
        if (cov > 0) this.blend(cx + dx, cy + dy, r, g, b, cov * alpha);
      }
    }
  }

  line(x0, y0, x1, y1, color, width = 1, alpha = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.disk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color, alpha);
    }
  }

  rect(x, y, w, h, color, alpha = 1) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) this.blend(x + xx, y + yy, color[0], color[1], color[2], alpha);
    }
  }

  rectOutline(x, y, w, h, color, lw = 1) {
    this.rect(x, y, w, lw, color); this.rect(x, y + h - lw, w, lw, color);
    this.rect(x, y, lw, h, color); this.rect(x + w - lw, y, lw, h, color);
  }

  text(str, x, y, color, scale = 2) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const glyph = FONT[ch] || FONT[' '];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '#') this.rect(cx + col * scale, y + row * scale, scale, scale, color);
        }
      }
      cx += 6 * scale;
    }
  }

  png() { return encodePng(this.w, this.h, this.buf); }
}

// ─── 5x7 bitmap font ─────────────────────────────────────────────────────────

const G = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '/': ['....#', '...#.', '..#..', '..#..', '.#...', '#....', '#....'],
  '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
  ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
  '#': ['.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'J': ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};
const FONT = G;

// ─── Colour helpers ──────────────────────────────────────────────────────────

function hex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// ─── Vector / projection ─────────────────────────────────────────────────────

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

function basisFor(dir) {
  const forward = norm(dir);
  let up0 = { x: 0, y: 1, z: 0 };
  if (Math.abs(dot(forward, up0)) > 0.99) up0 = { x: 0, y: 0, z: 1 };
  const right = norm(cross(up0, forward));
  const up = cross(forward, right);
  return { right, up, forward };
}

// ─── Build drawable geometry from the model ──────────────────────────────────

function endpointPos(model, ep) {
  if (ep.kind === 'component') return model.components.get(ep.component).placement;
  if (ep.kind === 'anchor') return model.anchors.get(ep.anchor).placement;
  throw new Error(`schematic: groupStart endpoints need a live scene; not supported offline ("${ep.groupStart}")`);
}

function buildScene(model) {
  const markers = [];
  for (const c of model.components.values()) {
    markers.push({ kind: 'component', pos: c.placement, label: c.name, type: c.type });
  }
  for (const a of model.anchors.values()) {
    markers.push({ kind: 'anchor', pos: a.placement, label: a.id });
  }

  const cables = []; // one polyline per cable on each route
  for (const route of model.routes) {
    const pts = [endpointPos(model, route.endpoints[0]), ...route.waypoints, endpointPos(model, route.endpoints[1])];
    route.cables.forEach((cable, ci) => {
      const def = model.cableTypes.get(cable.type);
      cables.push({ pts, color: hex(def.color), routeName: route.name, cableType: def.id, strand: ci });
    });
  }

  const refs = (model.scale?.references || []).map((r, i) => ({
    pts: model.scale.references[i].points || [], // points live on the raw ref; see note
  }));
  return { markers, cables, refs };
}

// ─── Render one view ─────────────────────────────────────────────────────────

function renderView(model, scene, view, bom) {
  const W = 1280, H = 800;
  const cv = new Canvas(W, H);
  const pad = 90;
  const { right, up } = basisFor(view.dir);

  // collect world points to auto-fit
  const worldPts = [];
  for (const m of scene.markers) worldPts.push(m.pos);
  const visibleCables = scene.cables.filter((c) => !view.family || model.cableTypes.get(c.cableType).family === view.family);
  for (const c of visibleCables) for (const p of c.pts) worldPts.push(p);
  if (worldPts.length === 0) worldPts.push({ x: 0, y: 0, z: 0 });

  const center = worldPts.reduce((a, p) => ({ x: a.x + p.x / worldPts.length, y: a.y + p.y / worldPts.length, z: a.z + p.z / worldPts.length }), { x: 0, y: 0, z: 0 });
  const proj = (p) => { const r = sub(p, center); return { sx: dot(r, right), sy: dot(r, up), depth: dot(r, view.dir) }; };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of worldPts) { const q = proj(p); minX = Math.min(minX, q.sx); maxX = Math.max(maxX, q.sx); minY = Math.min(minY, q.sy); maxY = Math.max(maxY, q.sy); }
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad - 40) / spanY);
  const toScreen = (p) => { const q = proj(p); return { x: W / 2 + (q.sx - (minX + maxX) / 2) * scale, y: H / 2 + 20 - (q.sy - (minY + maxY) / 2) * scale, depth: q.depth }; };

  // faint ground grid on y=0
  const gridColor = [214, 216, 222];
  const gmin = Math.floor(Math.min(...worldPts.map((p) => Math.min(p.x, p.z))) - 5);
  const gmax = Math.ceil(Math.max(...worldPts.map((p) => Math.max(p.x, p.z))) + 5);
  for (let g = gmin; g <= gmax; g += 5) {
    let a = toScreen({ x: g, y: 0, z: gmin }), b = toScreen({ x: g, y: 0, z: gmax });
    cv.line(a.x, a.y, b.x, b.y, gridColor, 1, 0.6);
    a = toScreen({ x: gmin, y: 0, z: g }); b = toScreen({ x: gmax, y: 0, z: g });
    cv.line(a.x, a.y, b.x, b.y, gridColor, 1, 0.6);
  }

  // cables (with per-strand screen-space offset so multiple cables on a route separate)
  for (const cable of visibleCables) {
    const screen = cable.pts.map(toScreen);
    const off = (cable.strand - (0)) * 3;
    for (let i = 1; i < screen.length; i++) {
      const a = screen[i - 1], b = screen[i];
      const nx = -(b.y - a.y), ny = (b.x - a.x);
      const nl = Math.hypot(nx, ny) || 1;
      const ox = (nx / nl) * off, oy = (ny / nl) * off;
      // white halo under the cable so black-on-light still reads cleanly
      cv.line(a.x + ox, a.y + oy, b.x + ox, b.y + oy, [255, 255, 255], 7, 0.9);
      cv.line(a.x + ox, a.y + oy, b.x + ox, b.y + oy, cable.color, 4.2, 1);
    }
    // endpoint dots
    cv.disk(screen[0].x, screen[0].y, 3.2, cable.color);
    cv.disk(screen[screen.length - 1].x, screen[screen.length - 1].y, 3.2, cable.color);
  }

  // markers — labels flip to the left when they'd run off the right edge
  const labelX = (s, label, scale, gap) => {
    const wpx = label.length * 6 * scale;
    return (s.x + gap + wpx > W - 8) ? s.x - gap - wpx : s.x + gap;
  };
  for (const m of scene.markers) {
    const s = toScreen(m.pos);
    if (m.kind === 'component') {
      cv.rect(s.x - 7, s.y - 7, 14, 14, [40, 46, 60]);
      cv.rectOutline(s.x - 7, s.y - 7, 14, 14, [255, 255, 255], 2);
      cv.text(m.label, labelX(s, m.label, 2, 12), s.y - 6, [30, 34, 44], 2);
      cv.text(m.type, labelX(s, m.type, 1, 12), s.y + 8, [120, 124, 134], 1);
    } else {
      cv.disk(s.x, s.y, 5, [255, 255, 255]);
      cv.disk(s.x, s.y, 3.5, [90, 96, 110]);
      cv.text(m.label, labelX(s, m.label, 2, 10), s.y - 4, [80, 84, 96], 2);
    }
  }

  // header
  cv.rect(0, 0, W, 40, [24, 28, 38]);
  cv.text(view.title, 16, 12, [240, 242, 248], 3);
  const scaleNote = bom.calibrated ? `SCALE ${bom.realPerUnit.toFixed(2)} ${bom.unit}/UNIT` : 'NOT CALIBRATED';
  cv.text(scaleNote, W - scaleNote.length * 6 * 2 - 16, 14, [150, 200, 255], 2);

  // legend (routes + colours)
  let ly = H - 22 - model.routes.length * 20;
  cv.rect(12, ly - 10, 360, model.routes.length * 20 + 18, [255, 255, 255], 0.85);
  cv.rectOutline(12, ly - 10, 360, model.routes.length * 20 + 18, [200, 204, 212], 1);
  for (const route of model.routes) {
    const def = model.cableTypes.get(route.cables[0].type);
    cv.line(24, ly + 5, 52, ly + 5, [255, 255, 255], 7, 0.9);
    cv.line(24, ly + 5, 52, ly + 5, hex(def.color), 4.2, 1);
    cv.text(`${route.name}  (${def.id})`, 62, ly, [40, 44, 56], 2);
    ly += 20;
  }
  return cv.png();
}

// ─── BOM page ────────────────────────────────────────────────────────────────

function renderBomPage(bom) {
  const W = 1280, H = 800;
  const cv = new Canvas(W, H, [255, 255, 255, 255]);
  cv.rect(0, 0, W, 40, [24, 28, 38]);
  cv.text('BILL OF MATERIALS', 16, 12, [240, 242, 248], 3);
  let y = 64;
  for (const line of formatBomText(bom).split('\n')) {
    cv.text(line.replace(/×/g, 'X').replace(/[⚠—│]/g, '-'), 24, y, [30, 34, 44], 2);
    y += 22;
  }
  return cv.png();
}

// ─── Main ────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: 'iso', title: 'WIRING - ISOMETRIC', dir: { x: -1, y: -0.85, z: -1 } },
  { id: 'front', title: 'WIRING - FRONT', dir: { x: 0, y: 0, z: -1 } },
  { id: 'side', title: 'WIRING - SIDE', dir: { x: -1, y: 0, z: 0 } },
  { id: 'top', title: 'WIRING - TOP', dir: { x: 0, y: -1, z: 0 } },
  { id: 'power_only', title: 'WIRING - POWER ONLY', dir: { x: -1, y: -0.85, z: -1 }, family: 'power' },
];

function main() {
  const [yamlPath, outDir] = process.argv.slice(2);
  if (!yamlPath || !outDir) {
    console.error('usage: node tools/wiring_schematic.mjs <wiring.yaml> <outDir>');
    process.exit(1);
  }
  const model = parseWiring(readFileSync(yamlPath, 'utf8'),
    { validCameraKeys: ['front', 'side', 'aerial', 'dramatic', 'night-walk'] });
  const bom = computeBom(model);
  const scene = buildScene(model);

  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const view of VIEWS) {
    const file = `${outDir}/wiring_${view.id}.png`;
    writeFileSync(file, renderView(model, scene, view, bom));
    written.push(file);
  }
  const bomFile = `${outDir}/wiring_bom.png`;
  writeFileSync(bomFile, renderBomPage(bom));
  written.push(bomFile);

  console.log(`Rendered ${written.length} sheets:`);
  for (const f of written) console.log('  ' + f);
  console.log('\n' + formatBomText(bom));
}

main();

/*
  live_layout.mjs — model-aware layout builder for the gallery LIVE visualizer.

  The live vis WS buffer (ws://<engineHost>/ws/viz) carries only per-pixel
  bytes, in model.pixels[] order, with NO coordinates. To lay the rig out
  (strip rows/cols for test_bench, top-down dot map for titanic/dome/...) the
  SERVER imports the active model, reads each pixel's meta (i/fId/sId/nx/ny/nz),
  and produces a serializable layout spec that the browser client positions
  pixels with. The strip/map layout math here is a faithful copy of
  make_vis_clip.mjs so the LIVE view reads identically to the offline clips —
  the difference is that LIVE addresses cells by MODEL INDEX `p.i` (the live
  buffer is the full model in order, never strided), whereas the offline clip
  addresses by array position (its capture may stride pixels).

  Pure ESM, Node built-ins only (it imports a model file). No deps, no CDNs.
  Fails LOUD (throws) if the model file is missing or its pixels lack the
  required meta fields — codex P0: never silently fall back.
*/
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

// test_bench's sIds 1/2/3 are Pars/Vintage/Bars; any other model (or unknown
// id) falls back to a neutral "Section N" so a foreign rig is never mislabeled.
const TEST_BENCH_SECTION_NAMES = { 1: 'Pars', 2: 'Vintage', 3: 'Bars' };

// Resolve a model name to its file under marsin_engine/models/<name>.js.
// engineDir is marsin_engine/. Throws (fail loud) if absent.
export function modelFilePath(engineDir, modelName) {
  return path.join(engineDir, 'models', modelName + '.js');
}

// Import the model and extract the live layout spec. Returns:
//   { model, pixelCount, buffer, meta:[{i,fId,sId,nx,ny,nz}], coordSpread,
//     layoutMode, view, layout, report }
// `layout` is the serializable render spec consumed by live_client.js:
//   strip: { mode:'strip', sections:[{name, axis:'x'|'y', cols:[[i,...],...]}] }
//   map:   { mode:'map', dots:[{i,x,y}], dot, W, H, pad, planeSrc }
export async function buildLiveLayout(engineDir, modelName, opts = {}) {
  const layoutArg = opts.layout || 'auto';
  const viewArg = opts.view || 'auto';
  const buffer = opts.buffer || 'master';
  if (!['strip', 'map', 'auto'].includes(layoutArg)) {
    throw new Error('layout must be strip|map|auto, got ' + layoutArg);
  }
  if (!['top', 'front', 'auto'].includes(viewArg)) {
    throw new Error('view must be top|front|auto, got ' + viewArg);
  }

  const file = modelFilePath(engineDir, modelName);
  if (!fs.existsSync(file)) {
    throw new Error('model file not found: ' + file +
      ' (no silent fallback — pass a model that exists in marsin_engine/models/)');
  }
  const model = await import(pathToFileURL(file).href);
  if (!Array.isArray(model.pixels) || model.pixels.length === 0) {
    throw new Error('model ' + modelName + ' has no pixels[]');
  }

  // Validate the meta fields the layout needs are present. Fail loud per pixel.
  const meta = model.pixels.map((p) => {
    if (p.i === undefined || p.nx === undefined || p.ny === undefined) {
      throw new Error('model ' + modelName + ' pixel is missing required meta ' +
        '(needs i/nx/ny, saw ' + JSON.stringify(Object.keys(p)) + ')');
    }
    return { i: p.i, fId: p.fId || 0, sId: p.sId || 0, nx: p.nx, ny: p.ny, nz: p.nz || 0 };
  });

  const coordSpread = (typeof model.pixels[0].x === 'number')
    ? {
        x: rawSpread(model.pixels, 'x'),
        y: rawSpread(model.pixels, 'y'),
        z: rawSpread(model.pixels, 'z'),
      }
    : null;

  // auto = STRIP for test_bench (the canonical small section-structured rig),
  // MAP for everything else (titanic, dome, logsville). Explicit overrides.
  const layoutMode = layoutArg !== 'auto'
    ? layoutArg
    : (modelName === 'test_bench' ? 'strip' : 'map');

  const sectionNames = modelName === 'test_bench' ? TEST_BENCH_SECTION_NAMES : {};

  let layout;
  let view = '';
  let report = '';
  if (layoutMode === 'strip') {
    layout = buildStrip(meta, sectionNames);
    report = 'strip ' + layout.sections.map((s) => s.name + '[' + s.axis + ',' + s.cols.length + ']').join(' ');
  } else {
    const m = buildMap(meta, coordSpread, viewArg);
    layout = m.layout;
    view = m.planeSrc;
    report = 'map ' + m.planeSrc + ' ' + m.layout.W + 'x' + m.layout.H + ' dot=' + m.layout.dot + ' px=' + meta.length;
  }

  return {
    model: modelName,
    pixelCount: model.pixels.length,
    buffer,
    meta,
    coordSpread,
    layoutMode,
    view,
    layout,
    report,
  };
}

function rawSpread(pixels, ax) {
  const v = pixels.map((p) => p[ax]).filter((x) => typeof x === 'number');
  return v.length ? (Math.max(...v) - Math.min(...v)) : 0;
}

// ── STRIP: group by section id; each section is one horizontal row (axis X,
// sorted by nx left→right) or one column per fixture (axis Y, sorted by ny
// top→bottom). Cells address the live buffer by MODEL INDEX p.i.
function buildStrip(meta, sectionNames) {
  const bySection = {};
  for (const m of meta) { (bySection[m.sId] = bySection[m.sId] || []).push(m); }
  const sections = [];
  for (const sId of Object.keys(bySection).sort((a, b) => a - b)) {
    const px = bySection[sId];
    const nxs = px.map((p) => p.nx);
    const nys = px.map((p) => p.ny);
    const nxSpread = Math.max(...nxs) - Math.min(...nxs);
    const nySpread = Math.max(...nys) - Math.min(...nys);
    const vertical = nySpread > nxSpread;
    const name = sectionNames[sId] || ('Section ' + sId);
    if (vertical) {
      const fids = [...new Set(px.map((p) => p.fId))].sort((a, b) => a - b);
      const cols = fids.map((f) => px.filter((p) => p.fId === f).sort((a, b) => b.ny - a.ny).map((p) => p.i)); // top→bottom
      sections.push({ name, axis: 'y', cols });
    } else {
      const row = px.slice().sort((a, b) => a.nx - b.nx).map((p) => p.i); // left→right
      sections.push({ name, axis: 'x', cols: [row] });
    }
  }
  return { mode: 'strip', sections };
}

// ── MAP: a top-down/front physical dot field. Same projection/aspect math as
// make_vis_clip.mjs. Dots address the live buffer by MODEL INDEX p.i.
function buildMap(meta, coordSpread, viewArg) {
  const AX = ['nx', 'ny', 'nz'];
  function normStd(ax) {
    const v = meta.map((m) => m[ax]);
    const mu = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length);
  }
  let planeA;
  let planeB;
  let planeSrc;
  if (viewArg === 'top') { planeA = 'nx'; planeB = 'nz'; planeSrc = 'top (X/Z)'; }
  else if (viewArg === 'front') { planeA = 'nx'; planeB = 'ny'; planeSrc = 'front (X/Y)'; }
  else {
    const spread = coordSpread
      ? { nx: coordSpread.x, ny: coordSpread.y, nz: coordSpread.z }
      : { nx: normStd('nx'), ny: normStd('ny'), nz: normStd('nz') };
    const ranked = AX.slice().sort((a, b) => spread[b] - spread[a]);
    const [w0, w1] = [ranked[0], ranked[1]];
    planeA = spread[w0] >= spread[w1] ? w0 : w1;
    planeB = planeA === w0 ? w1 : w0;
    planeSrc = `auto (${planeA[1].toUpperCase()}/${planeB[1].toUpperCase()}, ${coordSpread ? 'raw spread' : 'norm std'})`;
  }

  const ha = meta.map((m) => m[planeA]);
  const va = meta.map((m) => m[planeB]);
  const ha0 = Math.min(...ha);
  const ha1 = Math.max(...ha);
  const hRange = (ha1 - ha0) || 1;
  const va0 = Math.min(...va);
  const va1 = Math.max(...va);
  const vRange = (va1 - va0) || 1;
  const rawKey = { nx: 'x', ny: 'y', nz: 'z' };
  const rawH = coordSpread ? (coordSpread[rawKey[planeA]] || hRange) : hRange;
  const rawV = coordSpread ? (coordSpread[rawKey[planeB]] || vRange) : vRange;
  const BOX = 640;
  const aspect = rawV / rawH;
  const W = aspect <= 1 ? BOX : Math.round(BOX / aspect);
  const H = aspect <= 1 ? Math.round(BOX * aspect) : BOX;
  const area = W * H;
  const dot = Math.max(5, Math.min(22, Math.round(Math.sqrt(area / Math.max(1, meta.length)) * 0.85)));
  const pad = Math.ceil(dot / 2) + 2;

  const dots = meta.map((m) => {
    const x = (m[planeA] - ha0) / hRange;     // 0..1 left→right
    const y = 1 - (m[planeB] - va0) / vRange;  // 0..1 top→bottom (flip vertical)
    return { i: m.i, x, y };
  });

  return { layout: { mode: 'map', dots, dot, W, H, pad }, planeSrc };
}

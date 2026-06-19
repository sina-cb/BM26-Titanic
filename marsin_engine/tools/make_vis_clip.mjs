/*
  make_vis_clip.mjs — turn a capture_vis.mjs JSON into an animated clip widget.

  Reads {meta, frames} from capture_vis.mjs and writes a self-contained HTML
  fragment that replays the per-pixel buffer as an LED strip — the same look as
  CaptainPad's DECK MAIN. Groups pixels by section (sId), auto-detects each
  section's axis from the coordinate spread (X = horizontal row sorted by nx,
  Y = vertical columns per fixture sorted by ny), so it works for any model
  without hardcoding a layout.

  Usage (run from marsin_engine/):
    node tools/make_vis_clip.mjs --in ~/tmp/vis.json --out ~/tmp/clip.html [--fps 14]
      [--layout strip|map|auto] [--view top|front|auto]

  Two layouts:
   - STRIP (the original): per-section rows/columns, sorted by physical axis.
     Great for test_bench and small section-structured rigs.
   - MAP: a top-down (or front) physical layout — each pixel is an absolutely
     positioned glowing dot at its real normalized coordinate, so the rig reads
     like the actual lights. Used for titanic / dome / logsville.

  --layout auto (default): STRIP for test_bench (and small section-structured
  rigs), MAP for everything else. Explicit --layout strip|map overrides.

  --view top|front|auto (map only, default auto): the projection plane.
    top   = X/Z (top-down), front = X/Y. auto picks the two physically-widest
    axes (from the capture's coordSpread, else normalized std-dev). The vertical
    axis is flipped so "up"/forward reads naturally; real aspect ratio is kept.

  If the capture stamped `fps` (clip playback rate), the clip plays at that rate;
  --fps is the fallback.

  Then, as the agent: Read the --out file and pass its contents to the
  visualize show_widget tool (title + the HTML as widget_code) to render the
  clip inline for the user. (The widget itself has Pause + Speed controls.)
*/
import fs from 'fs';
import path from 'path';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i + 1]; }
const home = process.env.USERPROFILE || process.env.HOME;
const inPath = (arg('in', path.join(home, 'tmp', 'vis.json'))).replace(/^~/, home);
const outPath = (arg('out', path.join(home, 'tmp', 'clip.html'))).replace(/^~/, home);
const layoutArg = arg('layout', 'auto');
const viewArg = arg('view', 'auto');
if (!['strip', 'map', 'auto'].includes(layoutArg)) { console.error('error: --layout must be strip|map|auto, got ' + layoutArg); process.exit(1); }
if (!['top', 'front', 'auto'].includes(viewArg)) { console.error('error: --view must be top|front|auto, got ' + viewArg); process.exit(1); }

const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const meta = data.meta, frames = data.frames, N = frames.length;
// Play at the capture's stamped fps (real clip rate) when present, else --fps.
const fps = data.fps ? Math.max(1, Math.round(data.fps)) : parseInt(arg('fps', '14'), 10);

// ── layout selection ──────────────────────────────────────────────────────────
// auto = STRIP for test_bench (and small section-structured rigs), MAP for
// everything else (titanic, dome, logsville). Explicit --layout overrides.
// "Section-structured + small" = a handful of sections each laid out as a clean
// row/column, like the test_bench. We treat test_bench by name (the canonical
// strip rig) and otherwise fall back to MAP, which always reads physically.
function chooseLayout() {
  if (layoutArg !== 'auto') return layoutArg;
  if (data.model === 'test_bench') return 'strip';
  return 'map';
}
const layoutMode = chooseLayout();
// Section labels are model-specific. test_bench's sIds 1/2/3 are Pars/Vintage/
// Bars; for any other model — or an unknown id on test_bench — we fall back to
// a neutral "Section N", so a foreign rig is never mislabeled with test_bench
// section names.
const TEST_BENCH_SECTION_NAMES = { 1: 'Pars', 2: 'Vintage', 3: 'Bars' };
const SECTION_NAMES = data.model === 'test_bench' ? TEST_BENCH_SECTION_NAMES : {};

const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
const framesHex = frames.map(fr => fr.map(hex));

// Per-frame color arrays are indexed by POSITION in meta (the harness may stride
// pixels for big rigs, so meta[j] ↔ frame[j], NOT model index p.i). Map model
// index p.i → array position j for the strip layout (which addresses by p.i).
const posOf = {}; meta.forEach((m, j) => { posOf[m.i] = j; });

let bodyHtml = '';   // the inner markup
let jsCells = '';    // JS that builds cell groups
let summaryNote = ''; // a short status line for the widget footer
let layoutReport = '';

if (layoutMode === 'strip') {
  // Section labels are model-specific. test_bench's sIds 1/2/3 are Pars/Vintage/
  // Bars; for any other model — or an unknown id on test_bench — we fall back to
  // a neutral "Section N", so a foreign rig is never mislabeled.
  const TEST_BENCH_SECTION_NAMES = { 1: 'Pars', 2: 'Vintage', 3: 'Bars' };
  const SECTION_NAMES = data.model === 'test_bench' ? TEST_BENCH_SECTION_NAMES : {};

  // Group by section id.
  const bySection = {};
  for (const m of meta) { (bySection[m.sId] = bySection[m.sId] || []).push(m); }

  // Build a layout description: for each section, either one horizontal row
  // (axis X) or one column per fixture (axis Y). Cells address frames by ARRAY
  // POSITION (posOf[p.i]) so striding never misaligns colors.
  const layout = [];
  for (const sId of Object.keys(bySection).sort((a, b) => a - b)) {
    const px = bySection[sId];
    const nxs = px.map(p => p.nx), nys = px.map(p => p.ny);
    const nxSpread = Math.max(...nxs) - Math.min(...nxs);
    const nySpread = Math.max(...nys) - Math.min(...nys);
    const vertical = nySpread > nxSpread;
    const name = SECTION_NAMES[sId] || ('Section ' + sId);
    if (vertical) {
      const fids = [...new Set(px.map(p => p.fId))].sort((a, b) => a - b);
      const cols = fids.map(f => px.filter(p => p.fId === f).sort((a, b) => b.ny - a.ny).map(p => posOf[p.i])); // top→bottom
      layout.push({ name, axis: 'y', cols });
    } else {
      const row = px.slice().sort((a, b) => a.nx - b.nx).map(p => posOf[p.i]); // left→right
      layout.push({ name, axis: 'x', cols: [row] });
    }
  }

  let ri = 0;
  for (const sec of layout) {
    const sub = sec.axis === 'x' ? 'swipe x' : 'swipe y · ' + sec.cols.length + ' strip(s)';
    bodyHtml += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;"><span style="font-size:12px;letter-spacing:1px;color:#9aa;">${sec.name.toUpperCase()}</span><span style="font-size:11px;color:#667;">${sub}</span></div>`;
    if (sec.axis === 'x') {
      bodyHtml += `<div id="r${ri}" style="display:flex;gap:2px;height:28px;margin-bottom:16px;"></div>`;
      jsCells += `mk('r${ri}', ${JSON.stringify(sec.cols[0])}, 'row');`;
    } else {
      bodyHtml += `<div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:16px;">` +
        sec.cols.map((_, k) => `<div id="r${ri}_${k}" style="display:flex;flex-direction:column;gap:3px;"></div>`).join('') + `</div>`;
      jsCells += sec.cols.map((col, k) => `mk('r${ri}_${k}', ${JSON.stringify(col)}, 'col');`).join('');
    }
    ri++;
  }
  summaryNote = `strip vis · ${(frames[0] || []).length}px · ${data.buffer}`;
  layoutReport = 'strip ' + layout.map(l => l.name + '[' + l.axis + ',' + l.cols.length + ']').join(' ');
} else {
  // ── MAP layout: top-down/front physical dot field ───────────────────────────
  // Pick the projection plane. --view top=X/Z, front=X/Y; auto = the two
  // physically-widest axes. Normalized nx/ny/nz lose the real aspect, so we use
  // the capture's raw coordSpread when present, else fall back to the normalized
  // std-dev of each axis (better than min/max, which is ~1.0 for all).
  const AX = ['nx', 'ny', 'nz'];
  function normStd(ax) { const v = meta.map(m => m[ax]); const mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); }
  let planeA, planeB, planeSrc;
  if (viewArg === 'top') { planeA = 'nx'; planeB = 'nz'; planeSrc = 'top (X/Z)'; }
  else if (viewArg === 'front') { planeA = 'nx'; planeB = 'ny'; planeSrc = 'front (X/Y)'; }
  else {
    // auto: rank axes by physical spread (raw coordSpread) or normalized std-dev.
    const spread = data.coordSpread
      ? { nx: data.coordSpread.x, ny: data.coordSpread.y, nz: data.coordSpread.z }
      : { nx: normStd('nx'), ny: normStd('ny'), nz: normStd('nz') };
    const ranked = AX.slice().sort((a, b) => spread[b] - spread[a]);
    // Keep a stable horizontal/vertical assignment: the wider of the top-two is
    // horizontal (X-of-plane), the other vertical.
    const [w0, w1] = [ranked[0], ranked[1]];
    planeA = spread[w0] >= spread[w1] ? w0 : w1;
    planeB = planeA === w0 ? w1 : w0;
    planeSrc = `auto (${planeA[1].toUpperCase()}/${planeB[1].toUpperCase()}, ${data.coordSpread ? 'raw spread' : 'norm std'})`;
  }

  // Coordinates: horizontal = planeA, vertical = planeB (flipped so "up"/forward
  // reads naturally — bigger coord = higher on screen). nx/ny/nz are normalized
  // 0..1 per axis (so they'd render as a square); to preserve the REAL aspect we
  // scale the normalized span by the raw coordSpread ratio when available.
  const ha = meta.map(m => m[planeA]); const va = meta.map(m => m[planeB]);
  const ha0 = Math.min(...ha), ha1 = Math.max(...ha), hRange = (ha1 - ha0) || 1;
  const va0 = Math.min(...va), va1 = Math.max(...va), vRange = (va1 - va0) || 1;
  // Real-world aspect: prefer raw axis spreads (coordSpread) keyed by the chosen
  // plane axes; else fall back to the normalized spans (≈ square).
  const rawKey = { nx: 'x', ny: 'y', nz: 'z' };
  const rawH = data.coordSpread ? (data.coordSpread[rawKey[planeA]] || hRange) : hRange;
  const rawV = data.coordSpread ? (data.coordSpread[rawKey[planeB]] || vRange) : vRange;
  // Layout box: keep the wider axis at BOX px, scale the other by aspect.
  const BOX = 640;
  const aspect = rawV / rawH;                  // height / width in real units
  const W = aspect <= 1 ? BOX : Math.round(BOX / aspect);
  const H = aspect <= 1 ? Math.round(BOX * aspect) : BOX;
  // Dot size: scale so the rig reads but dots don't mush. Spread the field area
  // over N pixels, take a fraction of the per-pixel spacing.
  const area = W * H;
  const dot = Math.max(5, Math.min(22, Math.round(Math.sqrt(area / Math.max(1, meta.length)) * 0.85)));
  const pad = Math.ceil(dot / 2) + 2;

  // Per-dot normalized screen position (0..1), array-position indexed.
  const dots = meta.map((m, j) => {
    const x = (m[planeA] - ha0) / hRange;       // 0..1 left→right
    const y = 1 - (m[planeB] - va0) / vRange;    // 0..1 top→bottom (flip vertical)
    return { j, x, y };
  });

  bodyHtml = `<div id="map" style="position:relative;width:${W}px;height:${H}px;max-width:100%;margin:0 auto;"></div>`;
  jsCells = `mkMap('map', ${JSON.stringify(dots)}, ${dot}, ${W}, ${H}, ${pad});`;
  summaryNote = `physical map · ${planeSrc} · ${meta.length}px${data.pixelStride > 1 ? ` (1/${data.pixelStride} strided)` : ''}`;
  layoutReport = `map ${planeSrc} ${W}x${H} dot=${dot} px=${meta.length}`;
}

const html = `<h2 class="sr-only">Animated replay of the per-pixel light buffer (${data.pattern || 'pattern'}) on the ${data.model} rig${layoutMode === 'map' ? ', shown as a physical top-down map of glowing dots' : ''}.</h2>
<div style="padding:1rem 0;">
<div style="background:#06060a;border-radius:var(--border-radius-lg);padding:18px 20px;border:0.5px solid var(--color-border-tertiary);overflow:auto;">
${bodyHtml}
</div>
<div style="display:flex;align-items:center;gap:14px;margin-top:12px;">
  <button id="pp" style="font-size:13px;">Pause</button>
  <label style="font-size:13px;color:var(--color-text-secondary);">Speed</label>
  <input id="spd" type="range" min="4" max="30" value="${fps}" step="1" style="flex:1;max-width:200px;">
  <span style="font-size:12px;color:var(--color-text-tertiary);">${summaryNote}</span>
</div>
</div>
<script>
const F=${JSON.stringify(framesHex)};const N=${N};const groups=[];
function mk(elId, idxs, kind){const el=document.getElementById(elId);el.innerHTML='';const cells=[];
  for(const mi of idxs){const c=document.createElement('div');
    c.style.cssText = kind==='row' ? 'flex:1 1 0;min-width:4px;height:100%;border-radius:3px;background:#000;transition:background 60ms linear;'
                                   : 'width:26px;height:15px;border-radius:3px;background:#000;transition:background 60ms linear;';
    el.appendChild(c);cells.push([c,mi]);}
  groups.push(cells);}
function mkMap(elId, dots, dot, W, H, pad){const el=document.getElementById(elId);el.innerHTML='';const cells=[];
  const iw=W-2*pad, ih=H-2*pad;
  for(const d of dots){const c=document.createElement('div');
    const px=pad+d.x*iw, py=pad+d.y*ih;
    c.style.cssText='position:absolute;left:'+(px-dot/2)+'px;top:'+(py-dot/2)+'px;width:'+dot+'px;height:'+dot+'px;border-radius:50%;background:#000;transition:background 60ms linear,box-shadow 60ms linear;';
    el.appendChild(c);cells.push([c,d.j]);}
  groups.push(cells);}
${jsCells}
let f=0,playing=true,fps=${fps},last=0;
const MAP=${layoutMode === 'map' ? 'true' : 'false'};
function draw(fr){const cols=F[fr];for(const g of groups)for(const [c,mi] of g){const hx=cols[mi];c.style.background=hx;
  if(MAP){ // bloom: glow scales with brightness so lit dots read like real lights.
    const r=parseInt(hx.slice(1,3),16),gg=parseInt(hx.slice(3,5),16),b=parseInt(hx.slice(5,7),16);
    const lum=(r+gg+b)/765; c.style.boxShadow= lum<0.03 ? 'none' : '0 0 '+(2+lum*10).toFixed(1)+'px '+(0.5+lum*3).toFixed(1)+'px '+hx;}}}
function loop(t){if(playing&&t-last>1000/fps){f=(f+1)%N;draw(f);last=t;}requestAnimationFrame(loop);}
draw(0);requestAnimationFrame(loop);
document.getElementById('pp').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play';};
document.getElementById('spd').oninput=e=>{fps=+e.target.value;};
</script>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log('wrote clip widget (' + html.length + ' bytes, ' + N + ' frames @ ' + fps + 'fps) ->', outPath);
console.log('layout:', layoutReport);

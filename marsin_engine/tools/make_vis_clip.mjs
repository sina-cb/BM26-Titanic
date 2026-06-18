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
const fps = parseInt(arg('fps', '14'), 10);

const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const meta = data.meta, frames = data.frames, N = frames.length;
const SECTION_NAMES = { 1: 'Pars', 2: 'Vintage', 3: 'Bars' };

// Group by section id.
const bySection = {};
for (const m of meta) { (bySection[m.sId] = bySection[m.sId] || []).push(m); }

// Build a layout description: for each section, either one horizontal row
// (axis X) or one column per fixture (axis Y), with model-index order.
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
    const cols = fids.map(f => px.filter(p => p.fId === f).sort((a, b) => b.ny - a.ny).map(p => p.i)); // top→bottom
    layout.push({ name, axis: 'y', cols });
  } else {
    const row = px.slice().sort((a, b) => a.nx - b.nx).map(p => p.i); // left→right
    layout.push({ name, axis: 'x', cols: [row] });
  }
}

const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
const framesHex = frames.map(fr => fr.map(hex));

let rows = '';
let jsCells = '';
let ri = 0;
for (const sec of layout) {
  const sub = sec.axis === 'x' ? 'swipe x' : 'swipe y · ' + sec.cols.length + ' strip(s)';
  rows += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;"><span style="font-size:12px;letter-spacing:1px;color:#9aa;">${sec.name.toUpperCase()}</span><span style="font-size:11px;color:#667;">${sub}</span></div>`;
  if (sec.axis === 'x') {
    rows += `<div id="r${ri}" style="display:flex;gap:2px;height:28px;margin-bottom:16px;"></div>`;
    jsCells += `mk('r${ri}', ${JSON.stringify(sec.cols[0])}, 'row');`;
  } else {
    rows += `<div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:16px;">` +
      sec.cols.map((_, k) => `<div id="r${ri}_${k}" style="display:flex;flex-direction:column;gap:3px;"></div>`).join('') + `</div>`;
    jsCells += sec.cols.map((col, k) => `mk('r${ri}_${k}', ${JSON.stringify(col)}, 'col');`).join('');
  }
  ri++;
}

const html = `<h2 class="sr-only">Animated replay of the live per-pixel light buffer (${data.pattern || 'pattern'}) on the ${data.model} rig.</h2>
<div style="padding:1rem 0;">
<div style="background:#0a0a0e;border-radius:var(--border-radius-lg);padding:18px 20px;border:0.5px solid var(--color-border-tertiary);">
${rows}
</div>
<div style="display:flex;align-items:center;gap:14px;margin-top:12px;">
  <button id="pp" style="font-size:13px;">Pause</button>
  <label style="font-size:13px;color:var(--color-text-secondary);">Speed</label>
  <input id="spd" type="range" min="4" max="30" value="${fps}" step="1" style="flex:1;max-width:200px;">
  <span style="font-size:12px;color:var(--color-text-tertiary);">live engine vis · ${(frames[0]||[]).length}px · ${data.buffer} · no subsampling</span>
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
${jsCells}
let f=0,playing=true,fps=${fps},last=0;
function draw(fr){const cols=F[fr];for(const g of groups)for(const [c,mi] of g)c.style.background=cols[mi];}
function loop(t){if(playing&&t-last>1000/fps){f=(f+1)%N;draw(f);last=t;}requestAnimationFrame(loop);}
draw(0);requestAnimationFrame(loop);
document.getElementById('pp').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play';};
document.getElementById('spd').oninput=e=>{fps=+e.target.value;};
</script>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log('wrote clip widget (' + html.length + ' bytes, ' + N + ' frames) ->', outPath);
console.log('layout:', layout.map(l => l.name + '[' + l.axis + ',' + l.cols.length + ']').join(' '));

/**
 * gen_led_fixture.js — LED fixture definition generator ("LED designing").
 *
 * Authors an LED fixture *definition YAML* from a shape spec, so a line, a
 * grid, or an arbitrary pixel map (the TE Sign) becomes a first-class fixture
 * that rides the EXACT SAME pipeline as every DMX fixture: rendered by
 * DmxFixtureRuntime, placed/rotated by the gizmo, patched by the controller
 * registry, exported per-pixel by pixelblaze_model_exporter. No runtime code
 * is duplicated — an LED fixture is just a definition with N RGB pixels.
 *
 * These are LED-bus fixtures: they live on Ango 4 (chroma.tech) pixel
 * controllers powered by a 110 VAC → 24 VDC adapter, NOT on DMX gateways.
 * That is recorded as `bus: led` in the model so the controller registry can
 * flag a fixture chained on the wrong controller kind.
 *
 * Channel layout: a pure pixel fixture has NO master/control channels. Pixel
 * i (0-based) occupies 3 consecutive channels — red 3i+1, green 3i+2, blue
 * 3i+3 — so an N-pixel fixture has a 3N-channel footprint. The fixture's base
 * DMX address (assigned by the controller registry) offsets the whole block.
 *
 * Usage:
 *   node gen_led_fixture.js grid --name te_led_grid --cols 8 --rows 5 --pitch 50
 *   node gen_led_fixture.js line --name te_led_line --count 40 --pitch 50
 *   node gen_led_fixture.js map  --name te_sign --file te_sign_pixels.json
 *
 * Common flags:
 *   --type <PascalCase>   fixture_type (default: PascalCase of --name)
 *   --pixel-size <mm>     visual dot diameter (default 12)
 *   --margin <mm>         shell margin around the pixel extent (default 25)
 *   --depth <mm>          shell depth (default 30)
 *   --wiring <serpentine|row>   grid wiring order (default serpentine)
 *   --axis <x|y>          line axis (default x)
 *   --out <path>          output file (default dmx/fixtures/<name>/model_<3N>.yaml)
 *   --force               overwrite an existing output file
 *
 * `map` --file JSON shape (pixels in wiring order):
 *   { "pixels": [ { "x_mm": -100, "y_mm": 50, "z_mm": 0 }, ... ] }
 *
 * No fallbacks: bad or missing arguments crash loudly (codex P0).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '..', 'dmx', 'fixtures');

// ── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const mode = argv[0];
  if (!mode || mode.startsWith('--')) {
    fail('First argument must be a mode: grid | line | map');
  }
  const opts = { _mode: mode };
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) fail(`Unexpected argument '${tok}' — flags must start with --`);
    const key = tok.slice(2);
    if (key === 'force') { opts.force = true; continue; }
    const val = argv[++i];
    if (val === undefined) fail(`Flag --${key} requires a value`);
    opts[key] = val;
  }
  return opts;
}

function fail(msg) {
  console.error(`\n[gen_led_fixture] ERROR: ${msg}\n`);
  process.exit(1);
}

function reqNum(opts, key, { int = false, min = undefined } = {}) {
  if (opts[key] === undefined) fail(`Missing required flag --${key}`);
  const n = Number(opts[key]);
  if (!Number.isFinite(n)) fail(`--${key} must be a number, got '${opts[key]}'`);
  if (int && !Number.isInteger(n)) fail(`--${key} must be an integer, got '${opts[key]}'`);
  if (min !== undefined && n < min) fail(`--${key} must be >= ${min}, got ${n}`);
  return n;
}

function optNum(opts, key, dflt) {
  if (opts[key] === undefined) return dflt;
  const n = Number(opts[key]);
  if (!Number.isFinite(n)) fail(`--${key} must be a number, got '${opts[key]}'`);
  return n;
}

// ── Naming ─────────────────────────────────────────────────────────────────

function pascalCase(snake) {
  return snake.split(/[_\s-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function humanName(snake) {
  return snake.split(/[_\s-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Pixel layout builders (return array of {x_mm, y_mm, z_mm} in wiring order) ─

function buildGrid(opts) {
  const cols = reqNum(opts, 'cols', { int: true, min: 1 });
  const rows = reqNum(opts, 'rows', { int: true, min: 1 });
  const pitch = optNum(opts, 'pitch', 50);
  const wiring = opts.wiring || 'serpentine';
  if (wiring !== 'serpentine' && wiring !== 'row') {
    fail(`--wiring must be 'serpentine' or 'row', got '${wiring}'`);
  }
  const px = [];
  // Row 0 = TOP (max y); columns run left (min x) to right (max x).
  for (let r = 0; r < rows; r++) {
    const y = ((rows - 1) / 2 - r) * pitch;
    const leftToRight = wiring === 'row' ? true : r % 2 === 0;
    for (let cc = 0; cc < cols; cc++) {
      const c = leftToRight ? cc : cols - 1 - cc;
      const x = (c - (cols - 1) / 2) * pitch;
      px.push({ x_mm: x, y_mm: y, z_mm: 0 });
    }
  }
  const spanW = (cols - 1) * pitch;
  const spanH = (rows - 1) * pitch;
  return { pixels: px, spanW, spanH,
    detail: `${cols}×${rows} grid, ${pitch}mm pitch, ${wiring} wiring` };
}

function buildLine(opts) {
  const count = reqNum(opts, 'count', { int: true, min: 1 });
  const pitch = optNum(opts, 'pitch', 50);
  const axis = opts.axis || 'x';
  if (axis !== 'x' && axis !== 'y') fail(`--axis must be 'x' or 'y', got '${axis}'`);
  const px = [];
  for (let i = 0; i < count; i++) {
    const t = (i - (count - 1) / 2) * pitch;
    px.push({ x_mm: axis === 'x' ? t : 0, y_mm: axis === 'y' ? t : 0, z_mm: 0 });
  }
  const span = (count - 1) * pitch;
  return { pixels: px,
    spanW: axis === 'x' ? span : 0,
    spanH: axis === 'y' ? span : 0,
    detail: `${count} px line along ${axis}, ${pitch}mm pitch` };
}

function buildMap(opts) {
  if (!opts.file) fail('map mode requires --file <pixels.json>');
  const raw = fs.readFileSync(path.resolve(opts.file), 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { fail(`--file is not valid JSON: ${e.message}`); }
  const list = Array.isArray(data) ? data : data.pixels;
  if (!Array.isArray(list) || list.length === 0) {
    fail('map --file must contain a non-empty array (or { "pixels": [...] })');
  }
  const px = list.map((p, i) => {
    const x = Number(p.x_mm ?? p.x);
    const y = Number(p.y_mm ?? p.y);
    const z = Number(p.z_mm ?? p.z ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      fail(`pixel ${i} in --file has non-numeric coordinates: ${JSON.stringify(p)}`);
    }
    return { x_mm: x, y_mm: y, z_mm: z };
  });
  const xs = px.map(p => p.x_mm), ys = px.map(p => p.y_mm);
  return { pixels: px,
    spanW: Math.max(...xs) - Math.min(...xs),
    spanH: Math.max(...ys) - Math.min(...ys),
    detail: `${px.length} px from pixel map ${path.basename(opts.file)}` };
}

// ── YAML emission (hand-formatted to match model_119.yaml style) ────────────

function fmt(n) {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function emitYaml({ name, type, id, pixels, spanW, spanH, pixelSize, margin, depth, detail, mode }) {
  const n = pixels.length;
  const footprint = n * 3;
  const width = Math.round(spanW + 2 * margin);
  const height = Math.round(Math.max(spanH, 0) + 2 * margin);
  const lines = [];
  lines.push(`# ${humanName(name)} — LED Fixture Pixel Model (${footprint}ch)`);
  lines.push(`# Generated by gen_led_fixture.js — ${mode}: ${detail}.`);
  lines.push('# Bus: LED — Ango 4 (chroma.tech) sACN pixel controller, 110 VAC → 24 VDC.');
  lines.push('# Pure pixel fixture: no master channels. Pixel i uses R=3i+1, G=3i+2, B=3i+3.');
  lines.push('');
  lines.push('model:');
  lines.push(`  id: "${id}"`);
  lines.push(`  name: "${humanName(name)}"`);
  lines.push(`  fixture_type: "${type}"`);
  lines.push(`  channel_mode: ${footprint}`);
  lines.push('  bus: led');
  lines.push('  controller_family: ango_4');
  lines.push('  power: "110VAC->24VDC adapter"');
  lines.push('');
  lines.push('  dimensions:');
  lines.push(`    width: ${width}`);
  lines.push(`    height: ${height}`);
  lines.push(`    depth: ${depth}`);
  lines.push('');
  lines.push('  shell:');
  lines.push('    type: "box"');
  lines.push(`    dimensions: [${width}, ${height}, ${depth}]`);
  lines.push('    color: "#0a0a0a"');
  lines.push(`    offset: [0, 0, ${-Math.round(depth / 2)}]`);
  lines.push('');
  lines.push('  pixels:');
  pixels.forEach((p, i) => {
    const ch = { red: 3 * i + 1, green: 3 * i + 2, blue: 3 * i + 3 };
    lines.push(`    - id: "pixel_${i + 1}"`);
    lines.push('      type: "rgb"');
    lines.push(`      size: ${pixelSize}`);
    lines.push(`      channels: { red: ${ch.red}, green: ${ch.green}, blue: ${ch.blue} }`);
    lines.push(`      dots: [[${fmt(p.x_mm)}, ${fmt(p.y_mm)}, ${fmt(p.z_mm)}]]`);
    lines.push('');
  });
  lines.push('  controls:');
  lines.push('    - { channel: "1..' + footprint + '", function: "RGB pixel data", ' +
    'range: "3 channels per pixel (R,G,B), no master/dimmer" }');
  lines.push('');
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
if (!opts.name) fail('Missing required flag --name (snake_case, e.g. te_led_grid)');
if (!/^[a-z0-9_]+$/.test(opts.name)) {
  fail(`--name must be snake_case [a-z0-9_], got '${opts.name}'`);
}

let layout;
if (opts._mode === 'grid') layout = buildGrid(opts);
else if (opts._mode === 'line') layout = buildLine(opts);
else if (opts._mode === 'map') layout = buildMap(opts);
else fail(`Unknown mode '${opts._mode}' — use grid | line | map`);

const type = opts.type || pascalCase(opts.name);
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(type)) {
  fail(`--type must be PascalCase alphanumeric, got '${type}'`);
}
const footprint = layout.pixels.length * 3;
const id = `${opts.name}_${footprint}`;

const yamlStr = emitYaml({
  name: opts.name,
  type,
  id,
  pixels: layout.pixels,
  spanW: layout.spanW,
  spanH: layout.spanH,
  pixelSize: optNum(opts, 'pixel-size', 12),
  margin: optNum(opts, 'margin', 25),
  depth: optNum(opts, 'depth', 30),
  detail: layout.detail,
  mode: opts._mode,
});

const outPath = opts.out
  ? path.resolve(opts.out)
  : path.join(FIXTURES_DIR, opts.name, `model_${footprint}.yaml`);

if (fs.existsSync(outPath) && !opts.force) {
  fail(`Output already exists: ${outPath}\n  Pass --force to overwrite.`);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, yamlStr);

console.log(`[gen_led_fixture] Wrote ${layout.pixels.length} pixels (${footprint}ch) → ${outPath}`);
console.log(`  fixture_type: ${type}   (${layout.detail})`);
console.log('  Next: register the model file in simulation/main.js (fetch list + fixtureModels entry),');
console.log('        then add instances to a scene and assign them to an Ango 4 (led) controller.');

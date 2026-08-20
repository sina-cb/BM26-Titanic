/**
 * gen_te_sign_fixture.js — rebuild the TE Sign V3 fixture pixel models from the
 * CAD LED-string exports.
 *
 * The TE Sign is ONE physical luminous face split at a diagonal seam into two
 * coplanar halves, each backlit by its own puck-LED chain:
 *
 *   Side A → dmx/fixtures/te_sign_v3/model_a_160.yaml   (TeSignV3A40, 40 px / 160 ch)
 *   Side B → dmx/fixtures/te_sign_v3/model_b_136.yaml   (TeSignV3B34, 34 px / 136 ch)
 *
 * Those YAMLs are the ONLY place the sign's pixel geometry lives. Everything
 * downstream is derived from them: DmxFixtureRuntime draws the pucks,
 * pixelblaze_model_exporter emits one model pixel per `dots` entry, and the 2D
 * pixel-map panels lay the halves out. Re-running this script IS the drop-in
 * point documented in src/fixtures/te_sign_generator.js — the next CAD export
 * is a re-run, never a hand edit.
 *
 * ── THE INVARIANT THIS SCRIPT EXISTS TO PROTECT ─────────────────────────────
 * Side A and Side B share ONE fixture-local coordinate frame: both are centred
 * on the FULL-SIGN bounding box, and the scene places both halves at the
 * IDENTICAL transform. The "half-ness" lives entirely in the pixel coordinates.
 *
 * Therefore the two sides MUST be normalised together, with ONE shared mm→unit
 * factor taken over the UNION of both point sets. Normalising each side to its
 * own bounding box would re-centre and re-scale the halves independently — the
 * seam tears and the logo scrambles. `gen_led_fixture.js map` does exactly that
 * (it centres on the file it was handed), which is why the sign gets its own
 * generator instead of reusing that mode.
 *
 * The shared normalisation is computed and reported explicitly:
 *
 *   k     = 1 / max(union span x, union span y)      ← ONE factor, both sides
 *   u     = (x_mm − union min x) · k                 ← 0‥1, aspect preserved
 *   v     = (y_mm − union min y) · k
 *
 * The authoritative `dots` stay in MILLIMETRES relative to the shared full-sign
 * centre, because that is the unit the runtime consumes (dmx_fixture_runtime
 * multiplies every dot by 0.001 to get metres) and the convention the files
 * being replaced already carry. `u`/`v` are emitted per pixel as provenance so
 * the shared normalisation is auditable in the file itself.
 *
 * ── ORIENTATION ─────────────────────────────────────────────────────────────
 * Y is NOT inverted between the CAD CSV and the fixture YAML: both are Y-up.
 * The only transform is the translation to the shared centre. (The runtime
 * negates Z when it draws, which is irrelevant here — every sign pixel is
 * coplanar at z = 0.)
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *   node tools/gen_te_sign_fixture.js \
 *     --side-a "<...>/TE_Sign_v3_led_string_points_side_A.csv" \
 *     --side-b "<...>/TE_Sign_v3_led_string_points_side_B.csv"
 *
 *   --out-dir <path>   output directory (default dmx/fixtures/te_sign_v3)
 *   --dry-run          print the summary + normalisation, write nothing
 *
 * CSV columns: wire_order,panel,x_mm,y_mm — sign-absolute millimetres, origin
 * at the sign's lower-left, one row per LED in PHYSICAL CHAIN ORDER. Pixel i
 * (0-based) takes channels R=3i+1, G=3i+2, B=3i+3, so the CSV's wire_order is
 * literally the DMX channel order.
 *
 * No fallbacks (codex P0): a missing flag, a malformed row, a wire_order gap, a
 * duplicate point or an unexpected pixel count crashes loudly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUT_DIR = path.resolve(__dirname, '..', 'dmx', 'fixtures', 'te_sign_v3');

// ── Physical constants of the CNC-built sign (CAD assembly, not derivable from
// the LED point list). The centre is the origin of the SHARED fixture frame.
const SIGN = Object.freeze({
  width: 1972.6,
  height: 2509.5,
  depth: 133.4,
  centreX: 986.31,
  centreY: 1254.76,
});

// Per-half back-panel shells, in the shared frame. Both halves are cut from the
// same sign, so these describe which part of the face each chain lights.
const SIDES = Object.freeze({
  A: {
    key: 'a',
    letter: 'A',
    fixtureType: 'TeSignV3A40',
    modelId: 'te_sign_v3_a_160',
    modelName: 'TE Sign V3 Side A',
    pixelCount: 40,
    seamHalf: 'A',
    shell: { dimensions: [1246.6, 1523.4, 30], offset: [-236.3, 332.9, -15] },
    outFile: 'model_a_160.yaml',
  },
  B: {
    key: 'b',
    letter: 'B',
    fixtureType: 'TeSignV3B34',
    modelId: 'te_sign_v3_b_136',
    modelName: 'TE Sign V3 Side B',
    pixelCount: 34,
    seamHalf: 'B',
    shell: { dimensions: [1080.0, 1812.1, 30], offset: [263.7, -244.4, -16.5] },
    outFile: 'model_b_136.yaml',
  },
});

// The pucks are RGBW — the SAME LEDs the rope strands use (operator correction
// 2026-07-31: "sign is also RGBW, same lights as the ropes"). Every MarsinLED
// output in the ship runs `order: RGBW, stride: 4`, so a sign takes 4 bytes per
// pixel just like a rope: side A 40 px = 160 ch, side B 34 px = 136 ch, i.e.
// one whole sign is 296 ch and still fits inside one universe.
//
// This is the PHYSICAL format of the LEDs. At run time the authority is the
// owning controller's `led.order` (that is what the exporter and patches.yaml
// read, for a sign exactly as for a strand) — this constant keeps the generated
// definition honest about the hardware, and keeps `channel_mode` truthful.
const BYTES_PER_PIXEL = 4;
const PIXEL_FORMAT = 'rgbw';

const PIXEL_SIZE_MM = 12;

// ── Arg parsing ────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n[gen_te_sign_fixture] ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) fail(`Unexpected argument '${tok}' — flags must start with --`);
    const key = tok.slice(2);
    if (key === 'dry-run') { opts.dryRun = true; continue; }
    const val = argv[++i];
    if (val === undefined) fail(`Flag --${key} requires a value`);
    opts[key] = val;
  }
  if (!opts['side-a']) fail('Missing required flag --side-a <side_A.csv>');
  if (!opts['side-b']) fail('Missing required flag --side-b <side_B.csv>');
  return opts;
}

// ── CSV reading ────────────────────────────────────────────────────────────

/**
 * Read one side's LED string export.
 * @param {string} file  path to TE_Sign_v3_led_string_points_side_<X>.csv
 * @param {Object} side  the SIDES entry this file must satisfy
 * @returns {Array<{wire:number, panel:string, x:number, y:number}>} in wire order
 */
function readSideCsv(file, side) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`Side ${side.letter} CSV not found: ${abs}`);
  const text = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) fail(`Side ${side.letter} CSV has no data rows: ${abs}`);

  const header = lines[0].split(',').map((h) => h.trim());
  const expected = ['wire_order', 'panel', 'x_mm', 'y_mm'];
  if (header.length !== expected.length || header.some((h, i) => h !== expected[i])) {
    fail(`Side ${side.letter} CSV header is '${header.join(',')}', expected '${expected.join(',')}'`);
  }

  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== 4) {
      fail(`Side ${side.letter} CSV row ${i + 2} has ${cells.length} cells, expected 4: '${line}'`);
    }
    const wire = Number(cells[0]);
    const x = Number(cells[2]);
    const y = Number(cells[3]);
    if (!Number.isInteger(wire) || wire < 1) {
      fail(`Side ${side.letter} CSV row ${i + 2}: wire_order '${cells[0]}' is not a positive integer`);
    }
    if (cells[1].length === 0) fail(`Side ${side.letter} CSV row ${i + 2}: empty panel`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      fail(`Side ${side.letter} CSV row ${i + 2}: non-numeric coordinates (${cells[2]}, ${cells[3]})`);
    }
    return { wire, panel: cells[1], x, y };
  });

  if (rows.length !== side.pixelCount) {
    fail(`Side ${side.letter} CSV has ${rows.length} points but ${side.fixtureType} is a ` +
      `${side.pixelCount}-pixel / ${side.pixelCount * BYTES_PER_PIXEL}-channel fixture. Changing the pixel ` +
      'count changes the DMX footprint and every downstream patch — update SIDES in this ' +
      'script deliberately, do not let it drift.');
  }

  rows.sort((a, b) => a.wire - b.wire);
  rows.forEach((r, i) => {
    if (r.wire !== i + 1) {
      fail(`Side ${side.letter} wire_order is not a contiguous 1..${rows.length} run — ` +
        `position ${i + 1} carries wire_order ${r.wire}. wire_order IS the channel order, so a ` +
        'gap or a duplicate silently mis-addresses every LED after it.');
    }
  });

  const seen = new Map();
  for (const r of rows) {
    const key = `${r.x.toFixed(3)},${r.y.toFixed(3)}`;
    if (seen.has(key)) {
      fail(`Side ${side.letter}: wire_order ${r.wire} and ${seen.get(key)} sit at the same ` +
        `point (${r.x}, ${r.y}) — two LEDs cannot occupy one hole.`);
    }
    seen.set(key, r.wire);
  }
  return rows;
}

// ── Shared normalisation (the invariant) ───────────────────────────────────

/**
 * ONE mm→unit factor over the union of both sides, anchored at the union's
 * lower-left. Aspect is preserved (a single factor for x and y), so the halves
 * keep their true relative size and position.
 */
function sharedNormalisation(rowsA, rowsB) {
  const all = [...rowsA, ...rowsB];
  const xs = all.map((r) => r.x);
  const ys = all.map((r) => r.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const span = Math.max(spanX, spanY);
  if (!(span > 0)) fail('the union of both sides has zero extent — the CSVs are degenerate');
  return { minX, minY, spanX, spanY, factor: 1 / span };
}

function normalise(norm, row) {
  return { u: (row.x - norm.minX) * norm.factor, v: (row.y - norm.minY) * norm.factor };
}

function extentsOf(norm, rows) {
  const us = rows.map((r) => normalise(norm, r).u);
  const vs = rows.map((r) => normalise(norm, r).v);
  return {
    uMin: Math.min(...us), uMax: Math.max(...us),
    vMin: Math.min(...vs), vMax: Math.max(...vs),
  };
}

// ── Emission ───────────────────────────────────────────────────────────────

function round(n, places) {
  const f = 10 ** places;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** `start` / `mid` / `end` within the pixel's own panel run, as the CAD notes it. */
function panelRoles(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.panel, (counts.get(r.panel) || 0) + 1);
  const seen = new Map();
  return rows.map((r) => {
    const i = seen.get(r.panel) || 0;
    seen.set(r.panel, i + 1);
    const last = counts.get(r.panel) - 1;
    const role = i === 0 ? 'start' : (i === last ? 'end' : 'mid');
    return { index: i, role };
  });
}

function emitYaml(side, rows, norm, panelOrder) {
  const footprint = rows.length * BYTES_PER_PIXEL;
  const roles = panelRoles(rows);
  const ext = extentsOf(norm, rows);
  const L = [];

  L.push(`# TE Sign V3 — Side ${side.letter} (seam half ${side.seamHalf}) — LED Fixture Pixel Model (${footprint}ch)`);
  L.push(`# ${rows.length} puck LEDs on back-panel half ${side.seamHalf} of the CNC-built "Titanic's End" logo sign.`);
  L.push(`# Data/chain order = physical strand order: panels ${panelOrder.join(' -> ')}, start->end within each panel.`);
  L.push(`# Frame: mm, origin at the FULL SIGN bbox center (${SIGN.width} x ${SIGN.height} mm), X right, Y up,`);
  L.push('# +Z = emission side. Side A and Side B share this frame: place both fixtures at the');
  L.push('# SAME scene transform and the two halves assemble into the one physical sign.');
  L.push('# Bus: LED — Ango 4 (chroma.tech) sACN pixel controller, 110 VAC -> 24 VDC.');
  L.push(`# Pure pixel fixture: no master channels. Pixel i uses R=${BYTES_PER_PIXEL}i+1, ` +
    `G=${BYTES_PER_PIXEL}i+2, B=${BYTES_PER_PIXEL}i+3, W=${BYTES_PER_PIXEL}i+4.`);
  L.push('# The pucks are RGBW — the SAME LEDs as the rope strands (operator, 2026-07-31).');
  L.push('# NOTE: for an LED-bus fixture this block documents the PHYSICAL puck format only.');
  L.push('# The authority at run time is the `led.order` / `stride` of the owning');
  L.push('# MarsinLED output — exactly as for a rope strand. The exporter reads the');
  L.push('# channel map off the controller, never from here.');
  L.push('#');
  L.push('# GENERATED by tools/gen_te_sign_fixture.js from the CAD LED-string export.');
  L.push('# Do not hand-edit: re-run the generator against the newest CSVs instead.');
  L.push(`# Shared 0-1 normalisation (ONE factor over side A + side B together, never per side):`);
  L.push(`#   u = (x_mm - ${round(norm.minX, 2)}) / ${round(1 / norm.factor, 2)}   ` +
    `v = (y_mm - ${round(norm.minY, 2)}) / ${round(1 / norm.factor, 2)}`);
  L.push(`#   this side spans u ${round(ext.uMin, 4)}..${round(ext.uMax, 4)}, ` +
    `v ${round(ext.vMin, 4)}..${round(ext.vMax, 4)}`);
  L.push('');
  L.push('model:');
  L.push(`  id: "${side.modelId}"`);
  L.push(`  name: "${side.modelName}"`);
  L.push(`  fixture_type: "${side.fixtureType}"`);
  L.push(`  channel_mode: ${footprint}`);
  L.push('  bus: led');
  L.push('  controller_family: ango_4');
  L.push('  power: "110VAC->24VDC adapter"');
  L.push('');
  L.push('  dimensions:');
  L.push(`    width: ${SIGN.width}`);
  L.push(`    height: ${SIGN.height}`);
  L.push(`    depth: ${SIGN.depth}`);
  L.push('');
  L.push('  shell:');
  L.push('    type: "box"');
  L.push(`    dimensions: [${side.shell.dimensions.join(', ')}]`);
  L.push('    color: "#0a0a0a"');
  L.push(`    offset: [${side.shell.offset.join(', ')}]`);
  L.push('');
  L.push('  pixels:');
  rows.forEach((r, i) => {
    const dx = round(r.x - SIGN.centreX, 2);
    const dy = round(r.y - SIGN.centreY, 2);
    const { u, v } = normalise(norm, r);
    L.push(`    - id: "pixel_${i + 1}"`);
    L.push(`      type: "${PIXEL_FORMAT}"`);
    L.push(`      size: ${PIXEL_SIZE_MM}`);
    const base = BYTES_PER_PIXEL * i;
    L.push(`      channels: { red: ${base + 1}, green: ${base + 2}, blue: ${base + 3}, ` +
      `white: ${base + 4} }`);
    L.push(`      dots: [[${dx}, ${dy}, 0]]   # ${r.panel} led ${roles[i].index} (${roles[i].role}); ` +
      `sign mm (${round(r.x, 1)}, ${round(r.y, 1)}); norm (${round(u, 4)}, ${round(v, 4)})`);
    L.push('');
  });
  L.push('  controls:');
  L.push(`    - { channel: "1..${footprint}", function: "RGBW pixel data", ` +
    `range: "${BYTES_PER_PIXEL} channels per pixel (R,G,B,W), no master/dimmer" }`);
  L.push('');
  return L.join('\n');
}

function panelOrderOf(rows) {
  const order = [];
  for (const r of rows) if (order[order.length - 1] !== r.panel) order.push(r.panel);
  return order;
}

// ── Main ───────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
const outDir = opts['out-dir'] ? path.resolve(opts['out-dir']) : DEFAULT_OUT_DIR;

const rowsA = readSideCsv(opts['side-a'], SIDES.A);
const rowsB = readSideCsv(opts['side-b'], SIDES.B);

const sharedPanels = panelOrderOf(rowsA).filter((p) => panelOrderOf(rowsB).includes(p));
if (sharedPanels.length > 0) {
  fail(`panel(s) ${sharedPanels.join(', ')} appear on BOTH sides — each panel belongs to exactly ` +
    'one seam half, so a panel on both means the two CSVs describe overlapping chains.');
}

const norm = sharedNormalisation(rowsA, rowsB);
const extA = extentsOf(norm, rowsA);
const extB = extentsOf(norm, rowsB);

console.log('[gen_te_sign_fixture] shared 0-1 normalisation (ONE factor, both sides together)');
console.log(`  union extent   : x ${round(norm.minX, 1)}..${round(norm.minX + norm.spanX, 1)} mm ` +
  `(span ${round(norm.spanX, 1)}), y ${round(norm.minY, 1)}..${round(norm.minY + norm.spanY, 1)} mm ` +
  `(span ${round(norm.spanY, 1)})`);
console.log(`  mm -> unit     : 1 / ${round(1 / norm.factor, 2)} mm  = ${norm.factor.toExponential(6)} per mm`);
console.log(`  side A extents : u ${round(extA.uMin, 4)}..${round(extA.uMax, 4)}  ` +
  `v ${round(extA.vMin, 4)}..${round(extA.vMax, 4)}`);
console.log(`  side B extents : u ${round(extB.uMin, 4)}..${round(extB.uMax, 4)}  ` +
  `v ${round(extB.vMin, 4)}..${round(extB.vMax, 4)}`);

for (const [rows, side] of [[rowsA, SIDES.A], [rowsB, SIDES.B]]) {
  const order = panelOrderOf(rows);
  const yamlStr = emitYaml(side, rows, norm, order);
  const outPath = path.join(outDir, side.outFile);
  if (opts.dryRun) {
    console.log(`  [dry-run] side ${side.letter}: ${rows.length} px, panels ${order.join(' -> ')} ` +
      `-> ${outPath} (not written)`);
    continue;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, yamlStr);
  console.log(`  wrote side ${side.letter}: ${rows.length} px / ${rows.length * BYTES_PER_PIXEL} ch, ` +
    `panels ${order.join(' -> ')} -> ${outPath}`);
}

if (!opts.dryRun) {
  console.log('  Next: reload the sim (the fixture definitions are fetched at boot) and SAVE the');
  console.log('        scene so marsin_engine/models/<scene>.js is re-exported from the new map.');
}

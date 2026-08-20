// VSN1 effects-layout template budget + line-ending regression.
//
// WHY THIS EXISTS (report .agent/reports/202607/20260725_30_…, fix plan step 4):
// on 2026-07-28 every VSN1 layout deploy on the operator's machine died with
//   "Action string is 5960 chars; device limit is 909 (grid CONFIG_LENGTH)."
// The Lua was innocent. The comment stripper split on '\n', so on a CRLF
// working tree every line ended in '\r', the comment regex could never match,
// and NOT ONE comment was stripped — the entire commented template rode into
// the device string. The repo has core.autocrlf=true and had no .gitattributes,
// so ANY checkout re-created the fault. Six of nine templates blew the budget.
//
// This test compiles every template through the REAL pipeline in all three
// line-ending forms and asserts they are BYTE-IDENTICAL. That is the strong
// invariant: line endings are a storage detail and must never reach the device.
//
// It also PRINTS per-template headroom, because the margin here is genuinely
// thin — the encoder INIT sits at 904/909, five characters from the ceiling.
// The next person who adds a line of Lua to that template needs to see that
// number, not discover it on the playa.
//
// Fully OFFLINE: no serial, no device, no ports, no engine. It imports
// lua_action_string.cjs (pure) rather than grid_serial.cjs precisely so the
// native `serialport` addon never loads into the test runner.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/vsn1 → tests → marsin_engine
const CFG_DIR = path.resolve(__dirname, '..', '..', 'tools', 'vsn1_config');
const TPL_DIR = path.join(CFG_DIR, 'templates', 'effects_layout');

const cfgRequire = createRequire(path.join(CFG_DIR, 'deploy_layout.cjs'));
const las = cfgRequire('./lua_action_string.cjs');

// Headroom below this many characters is called out loudly in the test output.
// Not an assertion — a template legitimately may sit close to the ceiling — but
// it must never be a SURPRISE.
const TIGHT_HEADROOM = 20;

let gp = null;
let maxLength = 0;

// Substitution values mirroring what deploy_layout.cjs feeds each template at
// its realistic worst case (a full page of 8 bound slots).
const KINDS = `{${new Array(32).fill(1).join(',')}}`;
const MIDI_SUBS = {
  __FCH__: 1, __MCH__: 2, __SB__: 32, __PCC__: 40,
  __SNB__: 41, __HCC__: 41, __SCC__: 42, __VCC__: 43,
};
const nameTable = (n, len) => `{${new Array(n).fill(`"${'W'.repeat(len)}"`).join(',')}}`;
const colorTable = (n) => `{${new Array(n).fill('{255,140,0}').join(',')}}`;
const modeTable = (n, empty) =>
  `{${new Array(n).fill(empty ? '{}' : '{"rep","mul","tin"}').join(',')}}`;

// Per template: the substitution map, and whether it must fit outright.
// lcd_init is the ONE template deploy_layout.cjs protects with a display-shrink
// ladder (names truncated, mode tables dropped) because its size scales with
// the operator's slot names. So its contract is not "fits at full display" —
// it is "fits at the ladder's FLOOR". If the floor overflowed, the page would
// be undeployable no matter what the operator named things.
const PROFILES = [
  { file: 'encoder_init.lua', subs: MIDI_SUBS },
  { file: 'encoder_turn.lua', subs: { __SB__: MIDI_SUBS.__SB__ } },
  { file: 'encoder_press.lua', subs: {} },
  { file: 'key_init.lua', subs: { __R__: 255, __G__: 140, __B__: 0, __KINDS__: KINDS } },
  { file: 'key_bc_toggle.lua', subs: {} },
  { file: 'side_button.lua', subs: {} },
  { file: 'lcd_draw.lua', subs: {} },
  { file: 'system_init.lua', subs: {} },
  {
    file: 'lcd_init.lua',
    // The shrink ladder's tightest rung: 6-char names, no mode tables.
    subs: { __NAMES__: nameTable(8, 6), __COLORS__: colorTable(8), __MODES__: modeTable(8, true) },
    label: 'lcd_init.lua (ladder floor)',
  },
];

const toLf = (s) => s.replace(/\r\n/g, '\n');
const toCrlf = (s) => toLf(s).replace(/\n/g, '\r\n');

function substitute(src, map) {
  let out = src;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(String(v));
  return out;
}

/** No placeholder may reach the DEVICE. Checked on the compiled action string,
 *  not the source: several templates mention placeholders like `__KINDS__`
 *  inside `--` documentation comments, which are stripped and never ship. (Note
 *  that under the CRLF bug those comment-borne tokens DID reach the device —
 *  one more thing the un-stripped comments were smuggling through.) An
 *  unresolved placeholder in the real code would be a bare Lua identifier:
 *  valid syntax, silently nil at runtime. Exactly the failure mode to refuse. */
function assertNoPlaceholders(device, label) {
  const left = device.match(/__[A-Z0-9_]+__/g);
  assert.equal(left, null, `${label}: placeholder(s) reached the device: ${left && left.join(', ')}`);
}

before(async () => {
  gp = await import(pathToFileURL(cfgRequire.resolve('@intechstudio/grid-protocol')).href);
  await gp.initLuaFormatter();
  maxLength = Number(gp.grid.getProperty('CONFIG_LENGTH'));
  assert.ok(maxLength > 0, 'CONFIG_LENGTH must resolve from the grid protocol package');
});

test('every effects_layout template compiles identically from LF, CRLF and on-disk bytes', () => {
  const report = [];
  for (const profile of PROFILES) {
    const label = profile.label || profile.file;
    const raw = fs.readFileSync(path.join(TPL_DIR, profile.file), 'utf8');

    const variants = {
      'on-disk': substitute(raw, profile.subs),
      lf: substitute(toLf(raw), profile.subs),
      crlf: substitute(toCrlf(raw), profile.subs),
    };
    const compiled = {};
    for (const [mode, src] of Object.entries(variants)) {
      // Any surviving line comment, syntax break or overflow throws in here —
      // the compile succeeding IS the assertion for the step-2 guard.
      compiled[mode] = las.buildActionStringFromLua(gp, src, maxLength);
    }

    // THE core invariant: line endings are a storage detail. This is what the
    // CRLF bug violated — same bytes of Lua, wildly different device strings.
    assert.equal(compiled.crlf, compiled.lf,
      `${label}: CRLF and LF must compile to the SAME device string`);
    assert.equal(compiled['on-disk'], compiled.lf,
      `${label}: the working-tree copy must compile like LF (line-ending drift)`);

    const device = compiled.lf;
    assertNoPlaceholders(device, label);
    assert.ok(device.length <= maxLength,
      `${label}: ${device.length} chars exceeds the ${maxLength}-char device budget`);
    // No `--` line-comment opener may reach the device. `--[[@cb]]`, the
    // protocol's code-block marker, is excluded by the regex by design.
    assert.equal(las.SURVIVING_LINE_COMMENT_RE.test(device), false,
      `${label}: a line comment reached the device string`);
    assert.equal(gp.GridScript.checkSyntax(device.replace(/^<\?lua |\s\?>$/g, '')), true,
      `${label}: device action string must be valid Lua`);

    report.push({ label, length: device.length, headroom: maxLength - device.length });
  }

  // ── Headroom report (the point of the exercise) ──────────────────────
  console.log(`\n  VSN1 template budget — device limit ${maxLength} chars:`);
  for (const r of report.sort((a, b) => a.headroom - b.headroom)) {
    const flag = r.headroom < TIGHT_HEADROOM ? '  ⚠ TIGHT' : '';
    console.log(`    ${r.label.padEnd(28)} ${String(r.length).padStart(4)}/${maxLength}  headroom ${String(r.headroom).padStart(4)}${flag}`);
  }
  console.log('');

  assert.equal(report.length, PROFILES.length, 'every template was measured');
});

test('every .lua template in the tree is covered by a budget profile', () => {
  // A new template that nobody measured is exactly how the next overflow ships.
  const onDisk = fs.readdirSync(TPL_DIR).filter((f) => f.endsWith('.lua')).sort();
  const covered = PROFILES.map((p) => p.file).sort();
  assert.deepEqual(onDisk, covered,
    'a template was added or renamed without a budget profile in this test');
});

test('the encoder INIT compiles to its known-good size, not the CRLF-bug size', () => {
  // Two hard numbers from the July-15 known-good device dump
  // (tools/vsn1_config/dumps/layout_engine_page0.json): a healthy encoder INIT
  // is 904/909. Under the CRLF bug this same template produced 5960. Pinning
  // the healthy number catches BOTH a silent regrowth and a stripping
  // regression, in one assertion.
  const raw = fs.readFileSync(path.join(TPL_DIR, 'encoder_init.lua'), 'utf8');
  const device = las.buildActionStringFromLua(gp, substitute(raw, MIDI_SUBS), maxLength);
  assert.equal(device.length, 904,
    `encoder INIT is ${device.length} chars; the known-good size is 904. If this ` +
    `grew deliberately, update this number AND check the headroom report — the ` +
    `ceiling is ${maxLength}.`);
});

// ── The fail-loud comment-survival guard (fix plan step 2) ───────────────
//
// The overflow was the LUCKY failure. The dangerous one is a SHORTER template
// whose comment survives: once newlines collapse to spaces, that `--` comments
// out the entire rest of the script — and `checkSyntax` still passes, because a
// comment is valid Lua. The device would take the flash, light up green, and do
// nothing. These tests prove the guard is what stands in the way.

test('a surviving line comment is REFUSED, even though it is valid Lua', () => {
  // CR-only (classic Mac) line endings are a REAL residual case: the stripper
  // splits on /\r?\n/, so this stays one line and `.*$` cannot cross the \r.
  // The fix makes CRLF safe; the guard makes everything else non-shippable.
  const crOnly = 'local a=1 -- this comment survives\rlocal b=2\rself:led(1,1,1)';
  assert.throws(
    () => las.buildActionStringFromLua(gp, crOnly, maxLength),
    /line comment survived comment stripping/,
    'a surviving line comment must refuse to flash',
  );
});

test('checkSyntax alone would have PASSED the dead-code script (why the guard exists)', () => {
  // This is the whole argument for step 2, asserted rather than claimed.
  const crOnly = 'local a=1 -- this comment survives\rlocal b=2\rself:led(1,1,1)';
  const minified = gp.GridScript
    .minifyScript(las.stripLineComments(crOnly))
    .replace(/\n+/g, ' ')
    .trim();
  assert.equal(gp.GridScript.checkSyntax(minified), true,
    'if this ever goes false, checkSyntax started catching dead code on its own');
  // …and everything after the `--` is dead. (`[\s\S]` rather than `.` because
  // `.` cannot cross the \r — which is the very reason the stripper missed it.)
  assert.match(minified, /--[\s\S]*local b=2/, 'the rest of the script is inside the comment');
});

test('stripLineComments removes comments from LF, CRLF and mixed sources alike', () => {
  const cases = [
    ['x=1 -- gone\ny=2\n', 'LF'],
    ['x=1 -- gone\r\ny=2\r\n', 'CRLF'],
    ['x=1 -- gone\ny=2\r\nz=3\n', 'mixed'],
  ];
  for (const [src, label] of cases) {
    const out = las.stripLineComments(src);
    assert.equal(out.includes('gone'), false, `${label}: comment text must be stripped`);
    assert.equal(out.includes('\r'), false, `${label}: no carriage return may survive`);
    assert.ok(out.includes('x=1') && out.includes('y=2'), `${label}: code must survive`);
  }
});

test('--[[ ]] block markers are NOT stripped (the protocol needs them)', () => {
  const src = 'x=1 --[[@cb]] y=2 -- drop this\r\n';
  const out = las.stripLineComments(src);
  assert.ok(out.includes('--[[@cb]]'), 'the code-block marker must survive stripping');
  assert.equal(out.includes('drop this'), false, 'the trailing line comment must not');
});

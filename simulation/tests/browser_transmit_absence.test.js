/**
 * browser_transmit_absence.test.js — the browser cannot put a DMX packet on the
 * wire, and that is a property of the CODE, not of a runtime handshake
 * (report 20260805_171; operator ruling: engine → sim SERVER → controllers).
 *
 * ── WHY THIS FILE REPLACES THE GATE TESTS ──────────────────────────────────
 *
 * `_156` gave the bench-mirror ARM a `benchMirrorGate` handshake with the
 * output bridge and refused (R-23) without an ack; `_158` D-158-1 then closed a
 * window where that gate could be lost silently. All of it existed for ONE
 * reason: to silence the browser's priority-150 stream while the mirror was
 * armed. The stream is now gone, so the gate is gone with it — and this file
 * carries the coverage forward in the stronger form. A gated stream is a live
 * capability held shut; an absent capability cannot be held open by accident,
 * cannot be lost mid-blackout, and cannot be re-enabled by a config flag.
 *
 * Nothing was deleted without replacement: every property the gate tests
 * asserted has an equivalent below, stated over the source instead of over a
 * socket. The `_152` / `_158` mirror regressions are untouched and still run in
 * `bench_mirror_arm.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SIM_ROOT, ...p), 'utf8');

// ── The client half ────────────────────────────────────────────────────────

test('_171: the browser sACN output client does not exist', () => {
  assert.equal(fs.existsSync(path.join(SIM_ROOT, 'src', 'dmx', 'sacn_output_client.js')), false,
    'a dead module is the breadcrumb someone re-imports — it must be gone, not unused');
});

test('_171: nothing in src/ imports or references it', () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      // Comments explaining the removal are fine; code is not.
      for (const line of src.split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/sacn_output_client|getSacnOutput|sacnOutputClient|window\.sacnOutput\b/.test(line)) {
          hits.push(`${path.relative(SIM_ROOT, full)}: ${line.trim()}`);
        }
      }
    }
  };
  walk(path.join(SIM_ROOT, 'src'));
  assert.deepEqual(hits, [], 'no live reference to the deleted transmit client may survive');
});

test('_171: animate.js has no transmit path at all', () => {
  const src = read('src', 'core', 'animate.js');
  assert.doesNotMatch(src, /sendUniverse/, 'the send call must be gone');
  assert.doesNotMatch(src, /simulation acts as (a )?bridge/i,
    'and so must the sentence a reader would restore it from');
  assert.match(src, /sACN Output: GONE\. The browser is not the router\./,
    'the removal must be stated where the code used to be, or it reads as an accidental deletion');
  // The two legitimate users were rehoused, not dropped — say so at the site.
  assert.match(src, /Hold to Fog/);
  assert.match(src, /Option C/);
});

// ── The server half: refusal BY CONSTRUCTION ───────────────────────────────

test('_171: the output bridge holds no sACN sender — it cannot forward', () => {
  const src = read('server', 'sacn_output_bridge.js');
  assert.doesNotMatch(src, /require\(['"]sacn['"]\)/,
    'importing a Sender is the capability; not importing it is the guarantee');
  assert.doesNotMatch(src, /new Sender\(/);
  assert.doesNotMatch(src, /\.send\(\{/, 'no packet construction may survive');
  assert.doesNotMatch(src, /senderPool/);
});

test('_171: a DMX-shaped frame is REFUSED, loudly and by name', () => {
  const src = read('server', 'sacn_output_bridge.js');
  assert.match(src, /data\.length !== 519/, 'it still recognises the shape it used to forward');
  assert.match(src, /REFUSED a DMX frame from/);
  assert.match(src, /STALE BUNDLE/,
    'the refusal must name the likely cause — a cached tab running the old client');
  assert.match(src, /hard-reload/i, 'and the remedy');
  assert.match(src, /nothing can be: this process holds no sACN sender/,
    'and state that the refusal is structural, not a policy that could be relaxed');
  // Rate-limited: a stale bundle sends at frame rate.
  assert.match(src, /REFUSAL_REPEAT_MS/);
});

test('_171: the bench-mirror gate is gone from BOTH processes', () => {
  const out = read('server', 'sacn_output_bridge.js');
  const inb = read('server', 'sacn_bridge.js');
  // Comments that EXPLAIN the removal are wanted; executing code is not. Strip
  // comment lines before asserting, so the history stays readable without
  // weakening the check on what actually runs.
  const codeOnly = (src) => src.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const [name, src] of [['output bridge', out], ['input bridge', inb]]) {
    assert.doesNotMatch(codeOnly(src), /benchMirrorGate/,
      `${name} must not speak the gate protocol`);
    assert.doesNotMatch(codeOnly(src), /gateHolder|setOutputGate|proveOutputGateHeld|_gateLink/,
      `${name} must carry no gate machinery`);
  }
  assert.doesNotMatch(codeOnly(inb), /R-23/,
    'the refusal that required an ack is retired with the ack');
  assert.doesNotMatch(codeOnly(inb), /WebSocketClient/,
    'the input bridge needs no WS client now that it dials nobody');
});

test('_171: the ARM proof asserts the relay set, and no longer a gate', () => {
  const src = read('server', 'sacn_bridge.js');
  // The clauses that must SURVIVE — this is the "no coverage deleted" half.
  assert.match(src, /has no mirror sender/);
  assert.match(src, /is ALSO an ordinary relay route/);
  assert.match(src, /is ALSO engine-owned/);
  assert.match(src, /ordinary relay route\(s\) survived the arm/);
  // …and the gate clause that must not.
  assert.doesNotMatch(src, /gateFailure/);
  assert.match(src, /The second half is now\s*\n\s*\/\/ STRUCTURAL/,
    'the proof must say why it no longer checks a gate, or the absence reads as an omission');
});

test('_171: operator-facing text no longer promises a gate', () => {
  const bridge = read('server', 'sacn_bridge.js');
  const mirror = read('lib', 'bench_mirror.cjs');
  assert.doesNotMatch(bridge, /is GATED \(the ARM refuses/);
  assert.match(bridge, /No browser can transmit to hardware at all/,
    'the boot banner must state the new guarantee');
  assert.doesNotMatch(mirror, /GATED while armed rather than trusted/);
  assert.match(mirror, /a sim window cannot transmit to hardware at /,
    'the multi-window ARM warning must describe extra windows as harmless now');
  assert.match(mirror, /extra windows cost GPU and nothing else/);
});

// ── Fog: rehoused, not dropped ─────────────────────────────────────────────

test('_171: Hold to Fog POSTs the engine and refreshes a deadman hold', () => {
  const src = read('src', 'gui', 'gui_builder.js');
  assert.match(src, /engineHttpUrl\('\/fog'\)/, 'the button must ask the engine');
  assert.match(src, /holdMs: FOG_HOLD_MS/);
  assert.match(src, /setInterval\(\(\) => postFog\(true\), FOG_REFRESH_MS\)/,
    'a held button must REFRESH the hold, or the engine deadman will cut the fog mid-hold');
  assert.ok(src.indexOf('const FOG_REFRESH_MS = 600;') > 0);
  // …and it must no longer write DMX itself.
  const fogBlock = src.slice(src.indexOf('const FOG_REFRESH_MS'), src.indexOf('const startFog'));
  assert.doesNotMatch(fogBlock, /submitFrame/,
    'the button must not write into the local router any more — that was the browser transmitting');
});

test('_171: the fog fixture keeps its PREVIEW and loses its DMX write', () => {
  const src = read('src', 'fixtures', 'fog_machine.js');
  assert.doesNotMatch(src, /submitFrame/, 'no DMX may be written from the browser');
  assert.match(src, /const level = this\._uiFogOverride \? 1\.0 : this\.fogLevel;/,
    'the 3D preview must still respond instantly, or the button loses its tactile feel');
});

// ── The failure mode that is now untestable ────────────────────────────────

test('_171: the tab-throttle freeze is UNTESTABLE BY CONSTRUCTION — recorded, not skipped', () => {
  // `_160` T5: a throttled background tab kept re-emitting one stale frame at
  // priority 150 forever, so the rig looked alive while the show was dead. There
  // is deliberately no test for it, because there is no code path to drive: the
  // browser has no transmit loop to throttle. The assertions in this file ARE
  // that test — they prove the absence that makes the scenario unreachable.
  //
  // This case exists so the missing coverage is a recorded decision rather than
  // a gap someone later "notices".
  const animate = read('src', 'core', 'animate.js');
  const priorityLiterals = animate.match(/priority:\s*150/g) || [];
  assert.deepEqual(priorityLiterals, [],
    'the priority-150 literal was the tab-freeze writer; its absence is the fix');
});

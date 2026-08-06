/**
 * sacn_monitor_panel_pure.test.js — `src/gui/modern/sacn_monitor_panel.js`
 * pure logic (catalog 20260805_161 gap G13, size S, LOW priority):
 * `readDirectionStats`, `formatUniverses`, the log cap.
 *
 * The module imports `htm/preact` / `preact/hooks` / `@preact/signals`,
 * which are NOT node-resolvable in this test runner, and the functions are
 * module-private (not exported) — the catalog's own spec offers two options:
 * (a) a cheap-but-weak source-text guard, or (b) extracting the pure
 * functions to a DOM-free sibling module (a real refactor, out of scope for
 * a test-only slice). This file takes (a): it pins the literals and the
 * dot-ladder / cap logic AS SOURCE TEXT, so a change to any of them is a
 * visible diff here even though the functions cannot be called directly.
 * If a future slice does (b), this file should be deleted in favor of real
 * unit tests against the extracted module — not kept alongside them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(
  path.join(SIM_ROOT, 'src', 'gui', 'modern', 'sacn_monitor_panel.js'), 'utf8');

test('G13: the log cap is 20 entries, applied via slice(-MAX_LOG_ENTRIES)', () => {
  assert.match(SRC, /const MAX_LOG_ENTRIES = 20;/);
  assert.match(SRC, /\.slice\(-MAX_LOG_ENTRIES\)/);
});

test('G13: the dot ladder — "receiving" iff connected && fps>0, "connected" iff connected && fps===0',
  () => {
    assert.match(SRC, /if\s*\(st\.connected\s*&&\s*st\.fps\s*>\s*0\)\s*dot\s*=\s*'receiving';/);
    assert.match(SRC, /else if\s*\(st\.connected\)\s*dot\s*=\s*'connected';/);
  });

test('G13 [D12-pin]: priority 0 renders as \'—\', indistinguishable from "no priority reported"', () => {
  // `st.lastPriority || '—'` — a genuine priority-0 frame renders identically
  // to "never received a priority at all". Pinning the literal; `_157` D12.
  assert.match(SRC, /priority:\s*st\.lastPriority\s*\|\|\s*'—'/);
});

test('G13: formatUniverses renders "N [sorted,list]" when non-empty, "—" when empty', () => {
  assert.match(SRC, /function formatUniverses\(unis\)\s*\{/);
  assert.match(SRC, /\$\{sorted\.length\}\s*\[\$\{sorted\.join\(','\)\}\]/);
  assert.match(SRC, /return '—';/);
});

test('G13: the bench-mirror control is READ-ONLY here — no arm/disarm dispatcher imported', () => {
  // report 20260805_155 §8.5: this panel used to own the ARM button; the
  // defect was that it is rendered only in `sacn_in` mode, the exact mode
  // that outranks the mirror at the box. It must import the READ-ONLY
  // projection, never anything that sends benchMirrorArm/Disarm.
  assert.match(SRC, /import \{ benchMirrorControlState \} from '\.\.\/bench_mirror_control\.js';/);
  assert.doesNotMatch(SRC, /benchMirrorArm|benchMirrorDisarm/);
});

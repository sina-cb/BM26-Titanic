/**
 * hil_audio_realtime_test.mjs — operator-run realtime / smoothness HIL test.
 *
 * Proves (or disproves) the "discretized packets" symptom on a REAL source,
 * per docs/37 §13. It spawns the Audio Companion server, switches it to the
 * requested source, lets the analyzer run, then reads the {type:'diag'} report
 * and grades the §13 metrics (PASS / WARN / FAIL).
 *
 * WHY HIL: needs a real capture device (mic / line-in) or an Audio-Slice-style
 * local file, which CI / the remote container do not have. Run it on the rig.
 *
 * Usage:
 *   cd marsin_engine
 *   node tests/hil/hil_audio_realtime_test.mjs                 # mic, 30 s
 *   node tests/hil/hil_audio_realtime_test.mjs --seconds 45
 *   node tests/hil/hil_audio_realtime_test.mjs --device "<name>"   # pin a device
 *   node tests/hil/hil_audio_realtime_test.mjs --source file --file /path/clip.wav
 *
 * THE DECISIVE CHECK (do both, compare):
 *   1) run with --source file --file <a 60s EDM clip>   → the reference
 *      (file mode is perfectly clocked by a timer).
 *   2) run with --source mic, same clip playing into the mic.
 *   If mic-mode analyzerHopMs.jitterStd and micLowStepP95 are within ~1.5× of
 *   the file-mode numbers, the discretization is gone. The capture-side
 *   interArrivalMs WILL look bursty in mic mode — that is EXPECTED; gate on the
 *   analyzer/chunkiness metrics, not capture arrival.
 *
 * Exit code: 0 if overall PASS, 1 if any FAIL (so it can gate CI on the rig).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(__dirname, '../../audio/companion/companion_server.js');

function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; }
const PORT = parseInt(arg('--port', '6979'), 10);   // off the default 6973 so it won't clash
const SECONDS = parseInt(arg('--seconds', '30'), 10);
const SOURCE = arg('--source', 'mic');              // mic | file | test
const DEVICE = arg('--device', null);
const FILE = arg('--file', null);

// §13 thresholds. [passMax] inclusive pass; above [warnMax] inclusive is FAIL.
const EXPECTED_HOP_MS = (512 / 44100) * 1000;       // ≈ 11.61
function grade(v, passMax, warnMax) {
  if (v <= passMax) return 'PASS';
  if (v <= warnMax) return 'WARN';
  return 'FAIL';
}

function log(s) { process.stdout.write(s + '\n'); }

async function main() {
  if (SOURCE === 'file' && !FILE) { log('  ❌ --source file requires --file <path>'); process.exit(2); }

  log('='.repeat(58));
  log('hil_audio_realtime_test — docs/37 §13 smoothness / realtime');
  log(`  source: ${SOURCE}${DEVICE ? ` device="${DEVICE}"` : ''}${FILE ? ` file="${FILE}"` : ''}`);
  log(`  window: ${SECONDS}s   companion port: ${PORT}`);
  log('='.repeat(58));

  const child = spawn(process.execPath, [COMPANION, '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (b) => process.stderr.write(`  [companion] ${b}`));
  const cleanup = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  // Wait for the server to bind, then connect.
  await new Promise((r) => setTimeout(r, 1200));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  let frames = 0;

  await new Promise((resolve, reject) => {
    const fail = (e) => reject(new Error(e));
    ws.on('error', (e) => fail(`WS error: ${e.message} (is the companion up?)`));
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'setMode', mode: SOURCE, device: DEVICE, file: FILE }));
      log(`  ▶ source set to "${SOURCE}", collecting for ${SECONDS}s …`);
      setTimeout(() => ws.send(JSON.stringify({ type: 'diag' })), SECONDS * 1000);
    });
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      if (m.type === 'frame') { frames++; return; }
      if (m.type === 'sourceStatus' && m.status && m.status.error) {
        log(`  ⚠ source error: ${m.status.error}${m.status.needsDevice ? ' (pin a --device)' : ''}`);
      }
      if (m.type === 'diag') { report(m); resolve(); }
    });
  }).catch((e) => { log(`  ❌ ${e.message}`); cleanup(); process.exit(1); });

  function report(d) {
    log('');
    if (frames === 0) {
      log('  ❌ NO frames received — the source never produced audio. Check the device/file.');
      cleanup(); process.exit(1);
    }
    const a = d.analyzerHopMs || { median: 0, p95: 0, jitterStd: 0 };
    const rows = [
      ['analyzerHopMs.median', d.analyzerHopMs?.median, `${EXPECTED_HOP_MS.toFixed(1)}±0.5`,
        grade(Math.abs((a.median || 0) - EXPECTED_HOP_MS), 0.5, 1.5)],
      ['analyzerHopMs.jitterStd', a.jitterStd, '<2 / <4', grade(a.jitterStd, 2, 4)],
      ['analyzerGapsOver2x', d.analyzerGapsOver2x, '0 / ≤2', grade(d.analyzerGapsOver2x, 0, 2)],
      ['micLowStepP95', d.micLowStepP95, '(compare mic↔file)', 'INFO'],
      ['realtimeRatio', d.realtimeRatio, '0.99–1.01', grade(Math.abs((d.realtimeRatio || 0) - 1), 0.01, 0.03)],
      ['effectiveFps', d.effectiveFps, '(broadcast Hz)', 'INFO'],
    ];
    log('  metric                     value      target               verdict');
    log('  ' + '-'.repeat(64));
    for (const [k, v, t, g] of rows) {
      log(`  ${k.padEnd(26)} ${String(v).padEnd(10)} ${String(t).padEnd(20)} ${g}`);
    }
    log('');
    log('  capture arrival (EXPECTED to look bursty on mic — not a gate):');
    log(`    interArrivalMs: ${JSON.stringify(d.interArrivalMs)}  gapsOver2x=${d.gapsOver2x}`);
    log('');
    const verdicts = rows.map((r) => r[3]).filter((g) => g !== 'INFO');
    const overall = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('WARN') ? 'WARN' : 'PASS';
    log(`  OVERALL: ${overall}   (frames=${frames}, ${d.elapsedSec}s)`);
    if (SOURCE === 'mic') {
      log('  → Re-run with: --source file --file <same clip>  and compare micLowStepP95');
      log('    + analyzerHopMs.jitterStd. Within ~1.5× of file = discretization gone.');
    }
    cleanup();
    setTimeout(() => process.exit(overall === 'FAIL' ? 1 : 0), 100);
  }
}

main().catch((e) => { log(`  ❌ ${e.stack || e.message}`); process.exit(1); });

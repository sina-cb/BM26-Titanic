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
 * REFERENCES (NOTE: only `test` mode is perfectly clocked — `file` AND `mic`
 * both go through ffmpeg, so both can look bursty):
 *   - `--source test`  → the steady-clock reference (setInterval at the hop rate).
 *   - `--source file`  → ffmpeg decoding a file; realistic but still ffmpeg-batched.
 *   - `--source mic`   → the real concern.
 * THE DECISIVE CHECK: compare mic-mode analyzerHopMs.jitterStd + the capture
 * interArrivalMs max gap BEFORE vs AFTER a capture/jitter-buffer fix on the SAME
 * device. A big drop = the discretization is closing. (interArrivalMs being
 * bursty is the symptom we're fixing here, not a metric to wave away.)
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
  // Visualizer-payload evidence: how big are the spectrum/wave arrays the client
  // actually receives, how often do frames arrive (client update rate), and does
  // the data move frame-to-frame (live) or sit frozen?
  const fp = { specLen: 0, waveLen: 0, lastT: 0, gaps: [], specChange: [], prevSpec: null };

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
      if (m.type === 'frame') {
        frames++;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (fp.lastT) { fp.gaps.push(now - fp.lastT); if (fp.gaps.length > 4000) fp.gaps.shift(); }
        fp.lastT = now;
        if (Array.isArray(m.spectrum)) {
          fp.specLen = m.spectrum.length;
          if (fp.prevSpec) {                       // mean |Δ| vs previous frame = "is it live?"
            let s = 0; const n = Math.min(fp.prevSpec.length, m.spectrum.length);
            for (let i = 0; i < n; i++) s += Math.abs(m.spectrum[i] - fp.prevSpec[i]);
            fp.specChange.push(n ? s / n : 0); if (fp.specChange.length > 4000) fp.specChange.shift();
          }
          fp.prevSpec = m.spectrum;
        }
        if (Array.isArray(m.wave)) fp.waveLen = m.wave.length;
        return;
      }
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
    if (d.jitter) log(`    jitterBuffer: ${JSON.stringify(d.jitter)}`);
    log('');
    // Visualizer payload evidence (the histogram + raw-audio "low sample rate" report).
    const g = fp.gaps.slice().sort((x, y) => x - y);
    const gq = (p) => (g.length ? g[Math.min(g.length - 1, Math.floor(g.length * p))] : 0);
    const clientFps = fp.gaps.length ? (1000 / (fp.gaps.reduce((a, b) => a + b, 0) / fp.gaps.length)) : 0;
    const chg = fp.specChange;
    const chgMean = chg.length ? chg.reduce((a, b) => a + b, 0) / chg.length : 0;
    log('  VISUALIZER PAYLOAD (the histogram / raw-audio resolution question):');
    log(`    spectrum bins (histogram resolution): ${fp.specLen}`);
    log(`    wave points (oscilloscope resolution): ${fp.waveLen}`);
    log(`    client frame update rate: ${clientFps.toFixed(1)} Hz  (inter-frame ms median ${gq(0.5).toFixed(1)}, p95 ${gq(0.95).toFixed(1)}, max ${(g[g.length-1]||0).toFixed(1)})`);
    log(`    spectrum liveness (mean |Δ| frame-to-frame): ${chgMean.toFixed(5)}  (≈0 = frozen, higher = updating)`);
    log('');
    const verdicts = rows.map((r) => r[3]).filter((g2) => g2 !== 'INFO');
    const overall = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('WARN') ? 'WARN' : 'PASS';
    log(`  OVERALL: ${overall}   (frames=${frames}, ${d.elapsedSec}s)`);
    if (SOURCE === 'mic') {
      log('  → Save these numbers. After a capture/jitter-buffer fix, re-run mic on the');
      log('    SAME device and compare: analyzerHopMs.jitterStd + interArrivalMs.max');
      log('    should drop sharply. (`--source test` is the steady-clock reference.)');
    }
    cleanup();
    setTimeout(() => process.exit(overall === 'FAIL' ? 1 : 0), 100);
  }
}

main().catch((e) => { log(`  ❌ ${e.stack || e.message}`); process.exit(1); });

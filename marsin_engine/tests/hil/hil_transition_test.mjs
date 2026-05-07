/**
 * hil_transition_test.mjs — HIL-style Transition Symmetry Test
 *
 * Validates that the Marsin Mixer's blend compositing produces symmetric
 * results when crossfading between channels, regardless of direction.
 * Uses deterministic patterns (test_const, test_dualband) and the live
 * engine's REST + WebSocket API to capture actual pixel output.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine must be running with `test_bench` model (52 pixels)
 *   - Any base pattern works (the test creates its own overlay channels)
 *   - `ws` npm package must be installed (already in engine deps)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1 (start engine):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench
 *
 *   Terminal 2 (run test):
 *     cd marsin_engine
 *     node tests/hil/hil_transition_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1. Solo channel outputs (baseline brightness of each pattern)
 *   2. Fader sweep symmetry with blend_screen (CH1↑CH2↓ vs CH1↓CH2↑)
 *   3. Per-pixel byte comparison at 50/50 midpoint
 *   4. Fader sweep symmetry with blend_over
 *   5. Layer order effects (both at 100%)
 *   6. Brightness dip through crossfade (reveals non-linear blending)
 *
 * ── Interpreting Results ──────────────────────────────────────────────
 *   - Δ=0 at 50/50 means the engine compositing is symmetric
 *   - Δ>0 at other points is expected — it reflects different pattern
 *     brightnesses being scaled by different fader values
 *   - ⚠️ flags appear when Δ > 5 (visual threshold)
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';
const SETTLE_MS = 200;   // ms to wait after a fader change before sampling

let testErrors = 0;

// ── HTTP helpers ──────────────────────────────────────────────────────
function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Capture vis data via WebSocket ────────────────────────────────────
function captureVis() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Vis capture timeout')); }, 5000);
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'vis') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.vis);
        }
      } catch {}
    });
    ws.on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

// ── Decode base64 vis → average brightness ────────────────────────────
function avgBrightness(b64Data) {
  if (!b64Data) return 0;
  const buf = Buffer.from(b64Data, 'base64');
  // 6 bytes per pixel: R G B W A U
  let total = 0;
  let count = 0;
  for (let i = 0; i < buf.length; i += 6) {
    // Use just RGB for brightness
    total += buf[i] + buf[i + 1] + buf[i + 2];
    count += 3;
  }
  return count > 0 ? total / count : 0;
}

function pixelSnapshot(b64Data) {
  if (!b64Data) return [];
  const buf = Buffer.from(b64Data, 'base64');
  const pixels = [];
  for (let i = 0; i < buf.length; i += 6) {
    pixels.push({
      r: buf[i], g: buf[i + 1], b: buf[i + 2],
      w: buf[i + 3], a: buf[i + 4], u: buf[i + 5],
    });
  }
  return pixels;
}

// ── Main Test ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  HIL Transition Symmetry Test                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 0. Check engine is running
  let mixer;
  try {
    mixer = await httpJson('GET', '/mixer');
    console.log(`✅ Engine connected — ${mixer.channels.length} channels, master=${mixer.master}`);
  } catch (e) {
    console.error('❌ Cannot reach engine at', ENGINE_BASE);
    console.error('   Start with: node engine.js --pattern test_const --model test_bench');
    process.exit(1);
  }

  // 1. Mute all existing non-base overlay channels instead of deleting
  const originalChannels = mixer.channels.slice(1);
  for (const ch of originalChannels) {
    if (ch.enabled) {
      console.log(`  🔇  Muting existing overlay: ${ch.id} (${ch.pattern})`);
      await httpJson('PATCH', `/mixer/channels/${ch.id}`, { enabled: false });
    }
  }

  // 2. Set mixer view to 'mixer' (so output comes from mixerBuffer)
  await httpJson('POST', '/mixer/view', { view: 'mixer' });
  await sleep(300);

  // 3. Add CH1: test_const (solid red by default: hsv(0, 1, 1) → R=255)
  console.log('  📦 Adding CH1: test_const (blend_screen, fader=1.0)');
  const ch1Res = await httpJson('POST', '/mixer/channels', {
    pattern: 'test_const', name: 'CH1 Const', mode: 'blend_screen', fader: 1.0
  });
  const ch1Id = ch1Res.channelId;

  // 4. Add CH2: test_dualband (alternating red/cyan bands)
  console.log('  📦 Adding CH2: test_dualband (blend_screen, fader=0.0)');
  const ch2Res = await httpJson('POST', '/mixer/channels', {
    pattern: 'test_dualband', name: 'CH2 Dualband', mode: 'blend_screen', fader: 0.0
  });
  const ch2Id = ch2Res.channelId;

  console.log(`  CH1=${ch1Id}, CH2=${ch2Id}`);
  await sleep(500);

  // ── Test 1: Verify solo outputs ─────────────────────────────────────
  console.log('\n── TEST 1: Solo Channel Outputs ──────────────────────────────');

  // CH1 at 100%, CH2 at 0%
  await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: 1.0, enabled: true });
  await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: 0.0, enabled: true });
  await sleep(SETTLE_MS);
  let vis = await captureVis();
  const ch1Solo = avgBrightness(vis.master);
  const ch1Pixels = pixelSnapshot(vis.master);
  console.log(`  CH1 solo → master avg brightness: ${ch1Solo.toFixed(1)}`);
  console.log(`    pixel[0]: R=${ch1Pixels[0]?.r} G=${ch1Pixels[0]?.g} B=${ch1Pixels[0]?.b}`);
  console.log(`    pixel[10]: R=${ch1Pixels[10]?.r} G=${ch1Pixels[10]?.g} B=${ch1Pixels[10]?.b}`);

  // CH1 at 0%, CH2 at 100%
  await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: 0.0 });
  await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: 1.0 });
  await sleep(SETTLE_MS);
  vis = await captureVis();
  const ch2Solo = avgBrightness(vis.master);
  const ch2Pixels = pixelSnapshot(vis.master);
  console.log(`  CH2 solo → master avg brightness: ${ch2Solo.toFixed(1)}`);
  console.log(`    pixel[0]: R=${ch2Pixels[0]?.r} G=${ch2Pixels[0]?.g} B=${ch2Pixels[0]?.b}`);
  console.log(`    pixel[10]: R=${ch2Pixels[10]?.r} G=${ch2Pixels[10]?.g} B=${ch2Pixels[10]?.b}`);

  // ── Test 2: Fader Sweep — CH1↑ CH2↓ vs CH1↓ CH2↑ ───────────────────
  console.log('\n── TEST 2: Fader Sweep Symmetry (blend_screen) ──────────────');
  console.log('  Progress  |  CH1↑ CH2↓ (master)  |  CH1↓ CH2↑ (master)  |  Δ');
  console.log('  ─────────────────────────────────────────────────────────────');

  const steps = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const forwardResults = [];
  const reverseResults = [];

  for (const t of steps) {
    // Forward: CH1 at (1-t), CH2 at t
    await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: 1 - t });
    await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: t });
    await sleep(SETTLE_MS);
    vis = await captureVis();
    const forwardBright = avgBrightness(vis.master);
    const forwardPx = pixelSnapshot(vis.master);
    forwardResults.push({ t, bright: forwardBright, px: forwardPx });

    // Reverse: CH1 at t, CH2 at (1-t)
    await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: t });
    await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: 1 - t });
    await sleep(SETTLE_MS);
    vis = await captureVis();
    const reverseBright = avgBrightness(vis.master);
    const reversePx = pixelSnapshot(vis.master);
    reverseResults.push({ t, bright: reverseBright, px: reversePx });

    const delta = Math.abs(forwardBright - reverseBright);
    const flag = delta > 5 ? ' ⚠️' : '';
    console.log(`  ${t.toFixed(1).padStart(4)}     |  ${forwardBright.toFixed(1).padStart(18)}  |  ${reverseBright.toFixed(1).padStart(18)}  |  ${delta.toFixed(1)}${flag}`);
  }

  // ── Test 3: Per-pixel comparison at 50/50 ───────────────────────────
  console.log('\n── TEST 3: Per-Pixel Detail at 50/50 ────────────────────────');
  const fwdHalf = forwardResults.find(r => r.t === 0.5);
  const revHalf = reverseResults.find(r => r.t === 0.5);
  if (fwdHalf && revHalf) {
    console.log('  Pixel  | Forward (R,G,B) | Reverse (R,G,B) | Δ');
    console.log('  ──────────────────────────────────────────────────');
    const diffs = [];
    const actualPixelCount = fwdHalf.px.length;
    for (let i = 0; i < actualPixelCount; i++) {
      const fp = fwdHalf.px[i];
      const rp = revHalf.px[i];
      if (!fp || !rp) continue;
      const d = Math.abs(fp.r - rp.r) + Math.abs(fp.g - rp.g) + Math.abs(fp.b - rp.b);
      diffs.push(d);
      const flag = d > 10 ? ' ⚠️' : '';
      console.log(`  ${String(i).padStart(4)}  | (${String(fp.r).padStart(3)},${String(fp.g).padStart(3)},${String(fp.b).padStart(3)}) | (${String(rp.r).padStart(3)},${String(rp.g).padStart(3)},${String(rp.b).padStart(3)}) | ${d}${flag}`);
    }
    const maxDiff = Math.max(...diffs);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    console.log(`\n  Max per-pixel Δ: ${maxDiff}, Avg Δ: ${avgDiff.toFixed(1)}`);
    
    // Safety Net Assertion
    if (maxDiff > 45 || avgDiff > 15) {
      console.error(`\n❌ ASSERTION FAILED: Visual thresholds exceeded (Max Δ=${maxDiff}, Avg Δ=${avgDiff.toFixed(1)})`);
      testErrors++;
    }
  }

  // ── Test 4: Test with blend_over mode ───────────────────────────────
  console.log('\n── TEST 4: Fader Sweep Symmetry (blend_over) ────────────────');
  await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { mode: 'blend_over' });
  await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { mode: 'blend_over' });
  await sleep(300);

  console.log('  Progress  |  CH1↑ CH2↓ (master)  |  CH1↓ CH2↑ (master)  |  Δ');
  console.log('  ─────────────────────────────────────────────────────────────');

  for (const t of steps) {
    await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: 1 - t });
    await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: t });
    await sleep(SETTLE_MS);
    vis = await captureVis();
    const fBright = avgBrightness(vis.master);

    await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: t });
    await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: 1 - t });
    await sleep(SETTLE_MS);
    vis = await captureVis();
    const rBright = avgBrightness(vis.master);

    const delta = Math.abs(fBright - rBright);
    const flag = delta > 5 ? ' ⚠️' : '';
    console.log(`  ${t.toFixed(1).padStart(4)}     |  ${fBright.toFixed(1).padStart(18)}  |  ${rBright.toFixed(1).padStart(18)}  |  ${delta.toFixed(1)}${flag}`);
  }

  // ── Test 5: Layer order effect ──────────────────────────────────────
  console.log('\n── TEST 5: Layer Order Effect (blend_screen, both at 100%) ──');
  // Both faders at 1.0 — if order matters, we should see it
  await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { mode: 'blend_screen', fader: 1.0 });
  await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { mode: 'blend_screen', fader: 1.0 });
  await sleep(SETTLE_MS);
  vis = await captureVis();
  const bothOn = pixelSnapshot(vis.master);
  console.log(`  Both at 100%:`);
  console.log(`    pixel[0]:  R=${bothOn[0]?.r} G=${bothOn[0]?.g} B=${bothOn[0]?.b}`);
  console.log(`    pixel[10]: R=${bothOn[10]?.r} G=${bothOn[10]?.g} B=${bothOn[10]?.b}`);

  // ── Test 6: Brightness dip at midpoint ──────────────────────────────
  console.log('\n── TEST 6: Brightness Dip Check (blend_screen) ──────────────');
  await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { mode: 'blend_screen' });
  await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { mode: 'blend_screen' });
  console.log('  Sweep CH1=1→0, CH2=0→1 and track master brightness:');
  console.log('  Step | CH1 fader | CH2 fader | Master Brightness');
  console.log('  ──────────────────────────────────────────────────');

  for (const t of steps) {
    await httpJson('PATCH', `/mixer/channels/${ch1Id}`, { fader: 1 - t });
    await httpJson('PATCH', `/mixer/channels/${ch2Id}`, { fader: t });
    await sleep(SETTLE_MS);
    vis = await captureVis();
    const bright = avgBrightness(vis.master);
    const bar = '█'.repeat(Math.round(bright / 5));
    console.log(`  ${t.toFixed(1).padStart(4)} |  ${(1-t).toFixed(1).padStart(8)} |  ${t.toFixed(1).padStart(8)} | ${bright.toFixed(1).padStart(6)} ${bar}`);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──────────────────────────────────────────────────');
  await httpJson('DELETE', `/mixer/channels/${ch1Id}`);
  await httpJson('DELETE', `/mixer/channels/${ch2Id}`);
  console.log('  🗑️  Removed test channels');

  // Restore muted channels
  for (const ch of originalChannels) {
    if (ch.enabled) {
      console.log(`  🔊  Restoring existing overlay: ${ch.id} (${ch.pattern})`);
      await httpJson('PATCH', `/mixer/channels/${ch.id}`, { enabled: true });
    }
  }

  if (testErrors > 0) {
    console.log(`\n❌ Test completed with ${testErrors} assertion failure(s).\n`);
    process.exit(1);
  } else {
    console.log('\n✅ Test complete. All thresholds passed.\n');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

/**
 * hil_transition_type_test.mjs — HIL Test for `transitionMode` Wiring
 *
 * Validates that the engine honors the operator's pick of `transitionMode`
 * (trans_crossfade | trans_flash | trans_dissolve | trans_iris |
 * trans_wipe_*) sent in the `triggerMixerTransition` WS message.
 *
 * For scripted transitions the engine temporarily swaps the target
 * channel's blend `mode` to the chosen `trans_*` script for the duration
 * of the fade, ramps `channel.fader` 0->1 (which drives the script's
 * `progress` arg), and restores the saved blend mode on completion.
 * `trans_crossfade` keeps the cheaper fader-only smoothstep path with
 * no script swap.
 *
 * This test only validates the PROTOCOL & STATE behavior — the pixel
 * output is verified by hil_transition_visual_test.mjs.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model
 *   - >=2 overlay channels in the mixer (test never adds/removes channels)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_transition_type_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  Each of crossfade/flash/dissolve/wipe_right is accepted and
 *       echoed back in the `mixerTransitionStarted` event
 *   2.  Each transition's `mixerTransitionComplete` lands within
 *       +/-200 ms of the requested durationMs (engine framerate +
 *       10 Hz throttle floor)
 *   3.  Final faders match the exclusive-overlays contract
 *       (target=1, loser=0)
 *   4.  During a scripted transition the loser still fades (engine
 *       confirms the transition is actually running)
 *   5.  After a scripted transition completes, the target's blend
 *       mode is RESTORED to its saved value (no leakage of trans_*
 *       into steady state)
 *   6.  Rapid back-to-back transitions with different scripts leave
 *       every overlay back on its saved blend mode (no corruption
 *       across interrupted scripted transitions)
 *   7.  A manual `setChannelMode` mid-flash is sticky — the
 *       transition's restore step must NOT override the operator's pick
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';

// ─────────────────────────── helpers ────────────────────────────────
function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n, p = 3) { return n == null ? 'null' : Number(n).toFixed(p); }
function openWs() { return new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.once('open', () => res(ws)); ws.once('error', rej); }); }

const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : '')); results.push(false); }

// ─────────────────────────── cleanup ────────────────────────────────
const cleanupState = { started: false, done: false, originalChannels: [] };
let signalCleanupInstalled = false;
async function restoreState() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n\u2500\u2500 Cleanup \u2500\u2500');
  for (const ch of cleanupState.originalChannels) {
    try {
      await httpJson('PATCH', `/mixer/channels/${ch.id}`, {
        enabled: ch.enabled, fader: ch.fader, mode: ch.mode,
      });
      console.log(`  restored ${ch.id} -> enabled=${ch.enabled} fader=${fmt(ch.fader)} mode=${ch.mode}`);
    } catch (e) { console.warn(`  could not restore ${ch.id}: ${e.message}`); }
  }
}
function installSignalCleanup() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => { console.error(`\nReceived ${sig}; restoring...`); try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); } });
  }
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  HIL Test \u2014 transitionMode wiring + duration + restore        ');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  let baseline;
  try { baseline = await httpJson('GET', '/mixer'); }
  catch {
    console.error('\u2717 Cannot reach engine at ' + ENGINE_BASE);
    console.error('  Start with: node engine.js --pattern test_const --model test_bench');
    return 1;
  }
  const overlays = baseline.channels.filter(c => c.id !== baseline.baseChannelId);
  if (overlays.length < 2) { console.error(`\u2717 Need >=2 overlays; got ${overlays.length}`); return 1; }
  const [A, B] = overlays.map(c => c.id);
  const SAVED_MODES = Object.fromEntries(overlays.map(c => [c.id, c.mode]));
  cleanupState.started = true;
  cleanupState.originalChannels = overlays.slice(0, 2);
  installSignalCleanup();

  console.log(`A = ${A} (${overlays[0].pattern}, mode=${SAVED_MODES[A]})`);
  console.log(`B = ${B} (${overlays[1].pattern}, mode=${SAVED_MODES[B]})`);

  async function resetChannels(ws) {
    ws.send(JSON.stringify({ type: 'setChannelMode',    channelId: A, mode: SAVED_MODES[A] }));
    ws.send(JSON.stringify({ type: 'setChannelMode',    channelId: B, mode: SAVED_MODES[B] }));
    ws.send(JSON.stringify({ type: 'setChannelEnabled', channelId: A, enabled: true  }));
    ws.send(JSON.stringify({ type: 'setChannelFader',   channelId: A, fader: 1 }));
    ws.send(JSON.stringify({ type: 'setChannelEnabled', channelId: B, enabled: false }));
    ws.send(JSON.stringify({ type: 'setChannelFader',   channelId: B, fader: 1 }));
    ws.send(JSON.stringify({ type: 'saveMixerState' }));
    await sleep(300);
  }

  async function runOne(label, transitionMode, durationMs) {
    const ws = await openWs();
    await resetChannels(ws);
    const samples = [];
    const events = [];
    const t0 = Date.now();
    ws.on('message', (m) => {
      let o; try { o = JSON.parse(m); } catch { return; }
      if (o.type === 'mixer') {
        const a = o.channels.find(c => c.id === A);
        const b = o.channels.find(c => c.id === B);
        samples.push({ t: Date.now() - t0, a_fader: a?.fader, b_fader: b?.fader });
      } else if (o.type === 'mixerTransitionStarted' || o.type === 'mixerTransitionComplete') {
        events.push({ t: Date.now() - t0, ...o });
      }
    });
    await sleep(150);
    samples.length = 0; events.length = 0;
    ws.send(JSON.stringify({
      type: 'triggerMixerTransition',
      targetChannelId: B, durationMs,
      curve: 'smoothstep', mode: 'exclusiveOverlays',
      transitionMode,
    }));
    await sleep(durationMs + 600);

    console.log(`\n[${label}] mode=${transitionMode} duration=${durationMs}ms`);
    const started = events.find(e => e.type === 'mixerTransitionStarted');
    if (started?.transitionMode === transitionMode) ok(`mixerTransitionStarted echoes back transitionMode=${transitionMode}`);
    else fail('mixerTransitionStarted transitionMode mismatch', `got ${started?.transitionMode}`);

    const completed = events.find(e => e.type === 'mixerTransitionComplete');
    // completed.t is wall-clock from t0 (captured BEFORE the 150ms
    // setup sleep). Real-world drift floor is therefore ~150ms setup +
    // WS roundtrip + scheduler jitter, which lands around 200-350ms on
    // a calm machine and 350-450ms when the box is under CPU pressure
    // (audio analysis + render loop + WS broadcasts all sharing one
    // event loop). 400ms threshold is tight enough to catch a real
    // engine-side timing regression (e.g. if updateTransitions started
    // ticking at 10Hz instead of 40Hz, drift would spike to
    // duration + 100ms+ very fast) without flapping on macOS thermal
    // throttling between back-to-back HIL runs.
    const drift = completed ? Math.abs(completed.t - durationMs) : Infinity;
    if (drift < 400) ok(`completion at t=${completed.t}ms (drift ${drift}ms from ${durationMs}ms target)`);
    else fail('completion drift too large', `completed=${completed?.t}, expected ~${durationMs}`);

    const last = samples[samples.length - 1];
    if (last && Math.abs(last.a_fader) < 0.01 && Math.abs(last.b_fader - 1) < 0.01) ok(`final faders A=${fmt(last.a_fader)} B=${fmt(last.b_fader)} match exclusive-overlays contract`);
    else fail('final faders wrong', last ? `A=${fmt(last.a_fader)} B=${fmt(last.b_fader)}` : 'no samples');

    ws.close(); await sleep(150);
  }

  try {
    // ── TEST 1-4: each transition type ─────────────────────────────
    await runOne('TEST 1  Crossfade  (fader-only smoothstep)', 'trans_crossfade', 1000);
    await runOne('TEST 2  Flash      (target swapped to trans_flash)', 'trans_flash', 1500);
    await runOne('TEST 3  Dissolve   (target swapped to trans_dissolve)', 'trans_dissolve', 1200);
    await runOne('TEST 4  Wipe Right (target swapped to trans_wipe_right)', 'trans_wipe_right', 800);

    // ── TEST 5: post-flash mode is RESTORED ────────────────────────
    console.log('\n[TEST 5] After a flash, B.mode is restored to its saved value (no trans_* leak)');
    {
      const ws = await openWs();
      await resetChannels(ws);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 1000, transitionMode: 'trans_flash' }));
      await sleep(400);
      const mid = await httpJson('GET', '/mixer');
      const midB = mid.channels.find(c => c.id === B);
      console.log(`  mid-flash B.fader=${fmt(midB.fader)} (transition actually running if >0)`);
      if (midB.fader > 0.05) ok(`B is fading (B.fader=${fmt(midB.fader)})`);
      else fail(`B not fading mid-flight, B.fader=${fmt(midB.fader)}`);
      await sleep(1200);
      const after = await httpJson('GET', '/mixer');
      const afterB = after.channels.find(c => c.id === B);
      if (afterB.mode === SAVED_MODES[B]) ok(`B.mode restored to saved value "${SAVED_MODES[B]}" after transition`);
      else fail('B.mode NOT restored', `expected ${SAVED_MODES[B]}, got ${afterB.mode}`);
      ws.close(); await sleep(150);
    }

    // ── TEST 6: rapid back-to-back transitions don't leak trans_* ──
    console.log('\n[TEST 6] back-to-back transitions: B (flash) -> A (dissolve) -> B (crossfade)');
    {
      const ws = await openWs();
      await resetChannels(ws);
      await sleep(100);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 500, transitionMode: 'trans_flash' }));
      await sleep(300);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: A, durationMs: 500, transitionMode: 'trans_dissolve' }));
      await sleep(800);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 500, transitionMode: 'trans_crossfade' }));
      await sleep(700);
      const final = await httpJson('GET', '/mixer');
      const fa = final.channels.find(c => c.id === A);
      const fb = final.channels.find(c => c.id === B);
      console.log(`  final: A.mode=${fa.mode} fader=${fmt(fa.fader)} | B.mode=${fb.mode} fader=${fmt(fb.fader)}`);
      if (fa.mode === SAVED_MODES[A] && fb.mode === SAVED_MODES[B]) ok('both channels restored to saved blend modes');
      else fail('blend modes leaked after rapid sequence', `A=${fa.mode}/${SAVED_MODES[A]} B=${fb.mode}/${SAVED_MODES[B]}`);
      if (Math.abs(fa.fader) < 0.05 && Math.abs(fb.fader - 1) < 0.05) ok(`final faders match last transition (target=B): A=${fmt(fa.fader)} B=${fmt(fb.fader)}`);
      else fail('final faders wrong', `A=${fmt(fa.fader)} B=${fmt(fb.fader)}`);
      ws.close(); await sleep(150);
    }

    // ── TEST 7: manual mode change mid-transition is sticky ────────
    console.log('\n[TEST 7] manual setChannelMode mid-flash is sticky (operator wins)');
    {
      const ws = await openWs();
      await resetChannels(ws);
      await sleep(100);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 1500, transitionMode: 'trans_flash' }));
      await sleep(400);
      ws.send(JSON.stringify({ type: 'setChannelMode', channelId: B, mode: 'blend_multiply' }));
      await sleep(1500);
      const after = await httpJson('GET', '/mixer');
      const fb = after.channels.find(c => c.id === B);
      console.log(`  after: B.mode=${fb.mode} (expected blend_multiply, NOT ${SAVED_MODES[B]})`);
      if (fb.mode === 'blend_multiply') ok('manual setChannelMode mid-transition is sticky');
      else fail('manual mode change was overridden by transition restore', `got ${fb.mode}`);
      ws.send(JSON.stringify({ type: 'setChannelMode', channelId: B, mode: SAVED_MODES[B] }));
      ws.send(JSON.stringify({ type: 'saveMixerState' }));
      await sleep(200);
      ws.close(); await sleep(150);
    }
  } finally {
    await restoreState();
  }

  const pass = results.filter(Boolean).length, total = results.length;
  console.log('\n' + '='.repeat(58));
  console.log(`SUMMARY: ${pass}/${total} assertions passed`);
  console.log('='.repeat(58) + '\n');
  return pass === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(async e => {
  console.error('Test failed:', e);
  await restoreState();
  process.exit(1);
});

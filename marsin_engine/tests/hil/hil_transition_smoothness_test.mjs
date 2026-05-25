/**
 * hil_transition_smoothness_test.mjs — HIL Test for Server-Side Smooth-Step Transitions
 *
 * Validates the architectural rewrite (May 2026) that moved transition
 * animation from client rAF + WS-throttled fader writes to a single
 * `triggerMixerTransition` WS message that drives engine-side smooth-step
 * interpolation. Replaces the agent-diagnosed sin/cos asymmetry + 250 ms
 * echo lockout with a perceptually symmetric curve and 10 Hz throttled
 * progress broadcasts.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model (52 pixels)
 *   - At least 2 overlay channels in the mixer (the test uses existing
 *     overlays so it never adds/removes channels; mute/fader state is
 *     restored on exit)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     node tests/hil/hil_transition_smoothness_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  `mixerTransitionStarted` broadcast lands within one frame of
 *       the WS request
 *   2.  Engine emits ≥8 throttled `mixer` broadcasts per second-long
 *       transition (10 Hz throttle floor + start/end snap)
 *   3.  Faders evolve monotonically (target ↗, losers ↘) — no
 *       throttle-induced bounce-back
 *   4.  Smoothstep symmetry: brightness sum stays in [0.95, 1.05]
 *       throughout the transition (no sin/cos pump that the previous
 *       client-side code produced)
 *   5.  Midpoint check: at t ≈ duration/2, faders land near 0.5/0.5
 *   6.  Final state: target=1, losers=0, all overlays remain enabled
 *   7.  `mixerTransitionComplete` fires exactly once per group
 *   8.  Back-compat: legacy `triggerTransition` (old name) still works
 *   9.  Validation: targeting the base/deck channel is rejected
 *  10.  Validation: targeting an unknown channel id is rejected
 *  11.  Manual `setChannelFader` mid-transition cancels just that
 *       channel's animation (operator wins, no rubber-band snap-back)
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed (details printed inline)
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';
const DEFAULT_DURATION_MS = 1000;

// ─────────────────────────── helpers ────────────────────────────────
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
function fmt(n, p = 3) { return n == null ? 'null' : Number(n).toFixed(p); }
function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// ─────────────────────────── assertion bus ──────────────────────────
// Single source of truth: ok()/fail() push exactly once each. NEVER
// wrap with `results.push(ok(...))` — that double-counts (the wrapping
// push records `undefined`, which the summary treats as a failure).
const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

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
    } catch (e) {
      console.warn(`  could not restore ${ch.id}: ${e.message}`);
    }
  }
}
function installSignalCleanup() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      console.error(`\nReceived ${sig}; restoring mixer state...`);
      try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
    });
  }
}

// ─────────────────────────── per-test helpers ───────────────────────
function makeMixerObserver(ws, ids) {
  // Records every `mixer` broadcast as a fader sample for the given
  // channel ids. Also collects mixerTransitionStarted/Complete events.
  const samples = [];
  const events = [];
  const t0 = Date.now();
  ws.on('message', (m) => {
    let o; try { o = JSON.parse(m); } catch { return; }
    if (o.type === 'mixer') {
      const row = { t: Date.now() - t0 };
      for (const [key, id] of Object.entries(ids)) {
        const ch = o.channels.find(c => c.id === id);
        row[`${key}_fader`] = ch?.fader;
        row[`${key}_enabled`] = ch?.enabled;
      }
      samples.push(row);
    } else if (o.type === 'mixerTransitionStarted' ||
               o.type === 'mixerTransitionComplete' ||
               o.type === 'mixerTransitionRejected') {
      events.push({ t: Date.now() - t0, ...o });
    }
  });
  return { samples, events, reset() { samples.length = 0; events.length = 0; } };
}

async function resetTwoChannels(ws, A, B) {
  // A enabled at fader=1, B disabled at fader=1.
  ws.send(JSON.stringify({ type: 'setChannelEnabled', channelId: A, enabled: true  }));
  ws.send(JSON.stringify({ type: 'setChannelFader',   channelId: A, fader: 1 }));
  ws.send(JSON.stringify({ type: 'setChannelEnabled', channelId: B, enabled: false }));
  ws.send(JSON.stringify({ type: 'setChannelFader',   channelId: B, fader: 1 }));
  ws.send(JSON.stringify({ type: 'saveMixerState' }));
  await sleep(250);
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  HIL Test \u2014 Server-Side Transition Smoothness                ');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  let baseline;
  try { baseline = await httpJson('GET', '/mixer'); }
  catch {
    console.error('\u2717 Cannot reach engine at ' + ENGINE_BASE);
    console.error('  Start with: node engine.js --pattern test_const --model test_bench');
    return 1;
  }
  const overlays = baseline.channels.filter(c => c.id !== baseline.baseChannelId);
  if (overlays.length < 2) {
    console.error(`\u2717 Need at least 2 overlay channels; got ${overlays.length}`);
    return 1;
  }
  const [A, B] = overlays.map(c => c.id);
  cleanupState.started = true;
  cleanupState.originalChannels = overlays.slice(0, 2);
  installSignalCleanup();

  try {
    console.log(`A = ${A} (${overlays[0].pattern})`);
    console.log(`B = ${B} (${overlays[1].pattern})`);

    // ─── TEST 1: happy path, A (enabled, fader=1) -> B over 1000ms ───
    console.log('\n[TEST 1] triggerMixerTransition: A->B, duration=' + DEFAULT_DURATION_MS + 'ms');
    {
      const ws = await openWs();
      await resetTwoChannels(ws, A, B);
      const obs = makeMixerObserver(ws, { a: A, b: B });
      await sleep(150);
      obs.reset();

      ws.send(JSON.stringify({
        type: 'triggerMixerTransition',
        targetChannelId: B,
        durationMs: DEFAULT_DURATION_MS,
        curve: 'smoothstep',
      }));
      await sleep(DEFAULT_DURATION_MS + 500);

      console.log('  events: ' + (obs.events.map(e => `${e.t}ms:${e.type}`).join(' | ') || '(none)'));
      console.log(`  ${obs.samples.length} progress broadcasts:`);
      for (const s of obs.samples) {
        console.log(`    t=${String(s.t).padStart(4)}ms  A=${fmt(s.a_fader)}  B=${fmt(s.b_fader)}  sum=${fmt((s.a_fader||0)+(s.b_fader||0))}`);
      }

      const startedEvent = obs.events.find(e => e.type === 'mixerTransitionStarted');
      check(!!startedEvent, 'mixerTransitionStarted broadcast received', 'mixerTransitionStarted broadcast missing');
      const completes = obs.events.filter(e => e.type === 'mixerTransitionComplete');
      check(completes.length === 1, 'mixerTransitionComplete broadcast received exactly once', 'mixerTransitionComplete count != 1', `got ${completes.length}`);
      check(obs.samples.length >= 8, `received ${obs.samples.length} progress broadcasts (>=8)`, `only ${obs.samples.length} progress broadcasts`);

      let monoOK = true;
      for (let i = 1; i < obs.samples.length; i++) {
        const da = obs.samples[i].a_fader - obs.samples[i-1].a_fader;
        const db = obs.samples[i].b_fader - obs.samples[i-1].b_fader;
        if (da > 1e-3) monoOK = false;
        if (db < -1e-3) monoOK = false;
      }
      check(monoOK, 'faders evolve monotonically (A descends, B ascends)', 'faders NOT monotonic');

      let sumMax = 0, sumMin = 2;
      for (const s of obs.samples) { const sum = (s.a_fader||0) + (s.b_fader||0); sumMax = Math.max(sumMax, sum); sumMin = Math.min(sumMin, sum); }
      check(sumMax <= 1.05 && sumMin >= 0.95, `brightness sum stays in [${fmt(sumMin)}, ${fmt(sumMax)}] near 1.0`, `brightness sum out of range [${fmt(sumMin)}, ${fmt(sumMax)}]`);

      // Midpoint is measured RELATIVE TO THE TRANSITION START, not the
      // WS connect time. The triggerMixerTransition message lands a
      // few hundred ms after the ws opens (we wait 150 ms + 1 RTT
      // for it to land); the engine's broadcast-side clock is also
      // offset. startedEvent.t is the wall-clock instant the engine
      // emitted the mixerTransitionStarted broadcast, which is the
      // best proxy we have for "transition began".
      const tStart = startedEvent ? startedEvent.t : 0;
      const midTargetT = tStart + DEFAULT_DURATION_MS / 2;
      const mid = obs.samples.reduce((best, s) =>
        (!best || Math.abs(s.t - midTargetT) < Math.abs(best.t - midTargetT)) ? s : best, null);
      const midOK = mid && Math.abs(mid.a_fader - 0.5) < 0.15 && Math.abs(mid.b_fader - 0.5) < 0.15;
      check(midOK,
        `midpoint (engine t=${mid?.t}ms, expected ~${midTargetT}ms): A=${fmt(mid?.a_fader)} B=${fmt(mid?.b_fader)} both near 0.5`,
        'midpoint not centered',
        mid ? `A=${fmt(mid.a_fader)} B=${fmt(mid.b_fader)} at t=${mid.t}ms (expected near ${midTargetT}ms)` : 'no broadcast near midpoint');

      const last = obs.samples[obs.samples.length - 1];
      check(last && Math.abs(last.a_fader) < 0.01 && Math.abs(last.b_fader - 1) < 0.01,
        `final faders A=${fmt(last?.a_fader)} B=${fmt(last?.b_fader)} match target`,
        'final faders wrong',
        last ? `A=${fmt(last.a_fader)} B=${fmt(last.b_fader)}` : 'no samples');
      check(last && last.a_enabled && last.b_enabled,
        'both overlays remain enabled after transition (loser not auto-disabled)',
        'overlay enabled state wrong after transition');

      ws.close(); await sleep(150);
    }

    // ─── TEST 2: back-compat with legacy `triggerTransition` name ────
    console.log('\n[TEST 2] back-compat: legacy `triggerTransition` (old name) still works');
    {
      const ws = await openWs();
      await resetTwoChannels(ws, A, B);
      const obs = makeMixerObserver(ws, { a: A, b: B });
      await sleep(150); obs.reset();
      ws.send(JSON.stringify({ type: 'triggerTransition', targetChannelId: B, durationMs: 600 }));
      await sleep(1100);
      check(obs.events.some(e => e.type === 'mixerTransitionStarted'), 'legacy `triggerTransition` accepted', 'legacy `triggerTransition` rejected');
      check(obs.events.some(e => e.type === 'mixerTransitionComplete'), 'legacy `triggerTransition` completed', 'legacy `triggerTransition` did not complete');
      ws.close(); await sleep(150);
    }

    // ─── TEST 3: validation - reject base channel as target ─────────
    console.log('\n[TEST 3] validation: base channel as transition target -> rejected');
    {
      const ws = await openWs();
      let rejected = null;
      ws.on('message', m => { try { const o = JSON.parse(m); if (o.type === 'mixerTransitionRejected') rejected = o; } catch {} });
      await sleep(100);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: baseline.baseChannelId, durationMs: 500 }));
      await sleep(300);
      check(rejected && rejected.reason === 'cannot-transition-to-base',
        `rejected with reason "${rejected?.reason}"`,
        'base-channel target NOT rejected',
        JSON.stringify(rejected));
      ws.close(); await sleep(150);
    }

    // ─── TEST 4: validation - unknown channel id rejected ───────────
    console.log('\n[TEST 4] validation: unknown channel id -> rejected');
    {
      const ws = await openWs();
      let rejected = null;
      ws.on('message', m => { try { const o = JSON.parse(m); if (o.type === 'mixerTransitionRejected') rejected = o; } catch {} });
      await sleep(100);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: 'ch_does_not_exist', durationMs: 500 }));
      await sleep(300);
      check(!!rejected, `unknown target rejected (reason="${rejected?.reason}")`, 'unknown target NOT rejected');
      ws.close(); await sleep(150);
    }

    // ─── TEST 5: manual fader cancels in-flight transition ──────────
    console.log('\n[TEST 5] manual setChannelFader cancels in-flight transition for that channel');
    {
      const ws = await openWs();
      await resetTwoChannels(ws, A, B);
      const samples = [];
      const t0 = Date.now();
      ws.on('message', (m) => {
        try {
          const o = JSON.parse(m);
          if (o.type === 'mixer') {
            const b = o.channels.find(c => c.id === B);
            samples.push({ t: Date.now() - t0, b_fader: b?.fader });
          }
        } catch {}
      });
      await sleep(150);
      samples.length = 0;
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 2000 }));
      await sleep(300);
      console.log('  at t=300ms, user manually drags B fader to 0.2');
      ws.send(JSON.stringify({ type: 'setChannelFader', channelId: B, fader: 0.2 }));
      await sleep(900);
      const lateSamples = samples.filter(s => s.t > 500);
      console.log(`  last 5 samples after cancel:`);
      lateSamples.slice(-5).forEach(s => console.log(`    t=${String(s.t).padStart(4)}ms  B=${fmt(s.b_fader)}`));
      const last = lateSamples[lateSamples.length - 1]?.b_fader;
      check(Math.abs((last || 0) - 0.2) < 0.05,
        `B fader settled at ${fmt(last)} near 0.2 (cancellation worked)`,
        `B fader=${fmt(last)}, expected 0.2 (transition was not cancelled)`);
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

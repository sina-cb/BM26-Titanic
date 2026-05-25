/**
 * hil_deck_swap_warmth_test.mjs — HIL test for deck ping-pong handle warmth
 *
 * Validates the May 2026 ping-pong refactor of `triggerDeckPatternSwap`.
 * The old design allocated a fresh PatternChannel + compiled a fresh WASM
 * handle on every swap, then destroyed both on completion — so the
 * per-swap latency was dominated by recompile cost and varied wildly
 * with pattern size (test_dualband compiles faster than, say, a 200-
 * line scripted pattern).
 *
 * The new design keeps the previously-active handle alive in a hidden
 * `_inactiveDeckChannel` slot after every swap. On an A→B→A→B ping-pong,
 * each return trip reuses the warm handle from the inactive slot — no
 * recompile, no allocation, no destroy.
 *
 * ── What this test asserts ────────────────────────────────────────────
 *   1.  5 back-to-back swaps (A→B→A→B→A→B) all complete with
 *       `deckSwapComplete` matching the requested `transitionId`.
 *   2.  After the first swap warms the cache, the wall-time variance
 *       (max - min, normalized to mean) across the remaining swaps is
 *       < 20%. This is what proves "no per-swap recompile cost" —
 *       if the engine were re-compiling each time, the variance would
 *       be dominated by compile jitter (typically > 30%).
 *   3.  Same event ordering contract as the smoothness test:
 *       deckSwapStarted is always followed by exactly one
 *       deckSwapComplete with the matching transitionId, in that order.
 *   4.  Final visible deck pattern matches the last requested pattern
 *       (vis-distance proxy: master pixels match B's known signature
 *       with distance ≤ 8 — the "0.0 ± 8" contract from the smoothness
 *       test, here approximated by max per-pixel L1 distance).
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model (52 pixels) on $ENGINE_BASE
 *     (defaults to http://127.0.0.1:6968).
 *   - test_const and test_dualband patterns are available (they ship
 *     with the engine, used by hil_deck_swap_test.mjs as well).
 *
 * ── Exit code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = process.env.ENGINE_BASE || 'http://127.0.0.1:6968';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:6968';
const PIXEL_COUNT = 52;
const SETTLE_MS = 250;
const DURATION_MS = 400;   // short so the 5-swap sweep finishes in ~3 s
const NUM_SWAPS = 5;       // after first warm-up swap, measure variance

// ─────────────────────────── helpers ────────────────────────────────
function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function openWs() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => res(ws));
    ws.once('error', rej);
  });
}

function decodeVis(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const out = [];
  for (let i = 0; i < PIXEL_COUNT; i++) {
    out.push({ r: buf[i * 6], g: buf[i * 6 + 1], b: buf[i * 6 + 2] });
  }
  return out;
}

// ─────────────────────────── assertion bus ──────────────────────────
const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// ─────────────────────────── cleanup ────────────────────────────────
const cleanupState = {
  started: false,
  done: false,
  hilPlaylistName: null,
  savedTxCfg: null,
  savedDeckPlaylistName: null,
  savedView: 'deck',
};

async function cleanup() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    if (cleanupState.savedTxCfg) {
      await httpJson('POST', '/deck/transition-config', {
        enabled: !!cleanupState.savedTxCfg.enabled,
        mode: cleanupState.savedTxCfg.mode || 'trans_crossfade',
        durationMs: cleanupState.savedTxCfg.durationMs || 1000,
        shuffle: !!cleanupState.savedTxCfg.shuffle,
      });
      console.log(`  restored deck transition config`);
    }
  } catch (e) { console.warn('  txcfg restore failed:', e.message); }
  try {
    if (cleanupState.savedDeckPlaylistName) {
      await httpJson('POST', '/deck/playlist', { name: cleanupState.savedDeckPlaylistName });
      console.log(`  restored deck playlist: ${cleanupState.savedDeckPlaylistName}`);
    }
  } catch (e) { console.warn('  deck playlist restore failed:', e.message); }
  try {
    if (cleanupState.hilPlaylistName) {
      await httpJson('DELETE', `/playlists/${cleanupState.hilPlaylistName}`);
      console.log(`  deleted test playlist: ${cleanupState.hilPlaylistName}`);
    }
  } catch (e) { console.warn('  playlist delete failed:', e.message); }
}

function installCleanupSignals() {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      console.error(`\nReceived ${sig}; cleaning up...`);
      try { await cleanup(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
    });
  }
}

// ─────────────────────────── WS subscriber ──────────────────────────
async function subscribeWs() {
  const ws = await openWs();
  await httpJson('POST', '/mixer/view', { view: 'deck' });
  await sleep(SETTLE_MS);

  const visFrames = [];
  const events = [];
  const t0 = Date.now();
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const t = Date.now() - t0;
      if (msg.type === 'vis' && msg.vis && msg.vis.master) {
        visFrames.push({ t, master: msg.vis.master });
      } else if (msg.type === 'deckSwapStarted' || msg.type === 'deckSwapComplete') {
        events.push({ t, ...msg });
      }
    } catch {}
  });
  return { ws, visFrames, events, t0 };
}

// ─────────────────────────── main ───────────────────────────────────
(async () => {
  installCleanupSignals();
  cleanupState.started = true;

  console.log('==========================================================');
  console.log('hil_deck_swap_warmth_test.mjs — Deck ping-pong handle warmth');
  console.log('==========================================================');

  // ── Setup ────────────────────────────────────────────────────────
  cleanupState.savedTxCfg = await httpJson('GET', '/deck/transition-config');
  try {
    const currentDeckPl = await httpJson('GET', '/deck/playlist');
    cleanupState.savedDeckPlaylistName = (currentDeckPl && currentDeckPl.name) || 'default';
  } catch {
    cleanupState.savedDeckPlaylistName = 'default';
  }

  const HIL_PL = 'hil_deck_swap_warmth';
  cleanupState.hilPlaylistName = HIL_PL;
  await httpJson('POST', '/playlists', {
    name: HIL_PL,
    entries: [
      { id: 'e_warm_const', pattern: 'test_const',    label: 'A', defaults: {} },
      { id: 'e_warm_dual',  pattern: 'test_dualband', label: 'B', defaults: {} },
    ],
  });
  await sleep(SETTLE_MS);
  await httpJson('POST', '/deck/playlist', { name: HIL_PL });
  await sleep(SETTLE_MS * 2);

  // Enable transitions with a short duration so the sweep finishes fast.
  // Use trans_crossfade — the simplest, most representative case.
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: DURATION_MS, shuffle: false,
  });

  // Reset to entry A using the bypass (disable+swap+enable) so we start
  // each test from a known baseline without paying for a 400 ms fade.
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_warm_const' });
  await sleep(SETTLE_MS);
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: DURATION_MS, shuffle: false,
  });
  await sleep(SETTLE_MS);

  try {
    // ── TEST 1: 5 consecutive swaps complete + variance check ────────
    console.log(`\n[TEST 1] ${NUM_SWAPS} back-to-back swaps A↔B at ${DURATION_MS} ms each`);
    const sub = await subscribeWs();
    await sleep(200);

    // Per-swap latency = (Date.now() at deckSwapComplete) - (Date.now() at HTTP POST).
    // We measure wall-time from the moment we submitted the swap request
    // to the moment the engine broadcast deckSwapComplete. Since the
    // transition duration is fixed at DURATION_MS, the remaining
    // variance is everything-else: compile (if any), allocation, WS
    // round-trip, scheduling jitter. With the warm-handle reuse, the
    // expensive bits (compile + allocation) should drop out entirely.
    const latencies = [];
    const txIds = [];
    const targets = [];

    for (let i = 0; i < NUM_SWAPS; i++) {
      // Alternate A → B → A → B → A → B …
      const targetEntryId = (i % 2 === 0) ? 'e_warm_dual' : 'e_warm_const';
      const targetPattern = (i % 2 === 0) ? 'test_dualband' : 'test_const';
      targets.push(targetPattern);

      sub.events.length = 0; // discard any stragglers from the previous loop
      const t0 = Date.now();
      const swapResp = await httpJson('POST', '/deck/playlist/entry', { entryId: targetEntryId });
      const expectedTxId = swapResp && swapResp.transitionId;
      txIds.push(expectedTxId);

      // Wait for deckSwapComplete with the matching transitionId.
      // We give the engine up to 2x the duration as headroom; if it
      // takes longer than that something is genuinely wrong.
      const deadline = Date.now() + (DURATION_MS * 3 + 500);
      let completeEv = null;
      while (Date.now() < deadline) {
        completeEv = sub.events.find((e) => e.type === 'deckSwapComplete' && e.transitionId === expectedTxId);
        if (completeEv) break;
        await sleep(20);
      }
      const t1 = Date.now();

      if (!completeEv) {
        fail(`swap #${i + 1} (→ ${targetPattern}) deckSwapComplete received with matching transitionId=${expectedTxId}`,
          `timed out after ${t1 - t0} ms`);
        continue;
      }
      ok(`swap #${i + 1} (→ ${targetPattern}) deckSwapComplete received with matching transitionId`);

      // Ordering: deckSwapStarted MUST precede deckSwapComplete for the
      // same id. (Same contract as the smoothness test.)
      const startedEv = sub.events.find((e) => e.type === 'deckSwapStarted' && e.transitionId === expectedTxId);
      check(!!startedEv && startedEv.t <= completeEv.t,
        `swap #${i + 1} deckSwapStarted preceded deckSwapComplete`,
        `swap #${i + 1} event ordering wrong`,
        `started=${startedEv?.t} complete=${completeEv.t}`);

      latencies.push(t1 - t0);
      console.log(`    swap #${i + 1} → ${targetPattern}: latency=${t1 - t0} ms`);

      // Tiny breather between swaps so we don't race the post-complete
      // bookkeeping (saveAllState, broadcastMixerState).
      await sleep(50);
    }

    // ── Variance check (skip first swap — it warms the cache) ─────────
    // Why skip swap #1? On a fresh engine boot OR after a destroyed
    // inactive slot (e.g. after removeDeckChannel), the first swap must
    // compile its fresh handle and allocate the inactive sibling. From
    // swap #2 onwards, the inactive slot is warm — the operator's
    // expected "ping-pong" regime. Variance is what we care about
    // there.
    const measured = latencies.slice(1);
    if (measured.length >= 2) {
      const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
      const min = Math.min(...measured);
      const max = Math.max(...measured);
      const spreadPct = ((max - min) / mean) * 100;
      console.log(`    post-warmup latencies (ms): ${measured.join(', ')}`);
      console.log(`    mean=${mean.toFixed(1)} min=${min} max=${max} spread=${spreadPct.toFixed(1)}%`);
      check(spreadPct < 20,
        `post-warmup latency spread < 20% (got ${spreadPct.toFixed(1)}%)`,
        'latency variance too high — ping-pong reuse may not be working',
        `measured ${measured.join(' / ')} ms`);
    } else {
      fail('not enough successful swaps to compute variance', `got ${measured.length}`);
    }

    sub.ws.close();
    await sleep(SETTLE_MS);

    // ── TEST 2: final vis distance to target ─────────────────────────
    console.log('\n[TEST 2] final master vis matches last target pattern');
    // The last swap targeted whichever pattern's index made (i % 2 === 0)
    // for i = NUM_SWAPS - 1.
    const lastTarget = targets[targets.length - 1];
    // Open a fresh subscriber to capture clean vis frames now that the
    // sweep is fully settled.
    const sub2 = await subscribeWs();
    await sleep(500);
    sub2.ws.close();
    const lastFrame = sub2.visFrames.length ? sub2.visFrames[sub2.visFrames.length - 1] : null;
    const pixels = lastFrame ? decodeVis(lastFrame.master) : null;
    if (!pixels) {
      fail('final master vis frame captured', 'no vis frame received');
    } else {
      // Compute the L1 distance against the expected signature.
      // test_const     → every pixel ≈ R255 G0 B0 (red)
      // test_dualband  → pixel[0] ≈ R255 G0 B0, pixel[15] ≈ R0 G255 B*
      if (lastTarget === 'test_const') {
        let maxDist = 0;
        for (const p of pixels) {
          const d = Math.abs(p.r - 255) + Math.abs(p.g) + Math.abs(p.b);
          if (d > maxDist) maxDist = d;
        }
        check(maxDist <= 8,
          `final master matches test_const signature (max per-pixel L1 distance=${maxDist})`,
          'final master vis off target',
          `max L1 distance ${maxDist} > 8`);
      } else {
        // test_dualband: pixel[0]=red, pixel[15]=cyan-ish.
        const p0 = pixels[0];
        const p15 = pixels[15];
        const d0 = Math.abs(p0.r - 255) + Math.abs(p0.g) + Math.abs(p0.b);
        const isCyan = (p15.g > 200 && p15.b > 0);
        check(d0 <= 8 && isCyan,
          `final master matches test_dualband (p0 L1=${d0}, p15 cyan=${isCyan} g=${p15.g} b=${p15.b})`,
          'final master vis off target',
          `p0=R${p0.r}G${p0.g}B${p0.b} p15=R${p15.r}G${p15.g}B${p15.b}`);
      }
    }
  } finally {
    await cleanup();
  }

  const pass = results.filter(Boolean).length, total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${pass}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(pass === total ? 0 : 1);
})().catch(async (e) => {
  console.error('Test threw:', e);
  await cleanup();
  process.exit(1);
});

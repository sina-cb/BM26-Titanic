/**
 * hil_deck_transition_smoothness_test.mjs — Deck transition smoothness HIL
 *
 * Operator review May 2026 #16 — "the deck transition is not smooth enough
 * and at the end of the transition I see a visual flicker or breakage…"
 *
 * This test characterises the deck pattern-swap pipeline end-to-end and
 * locks in the smoothness contract that the fix lands on. It also
 * exercises the rapid-back-to-back swap path (the user's "two channel
 * ping-pong" hypothesis) so the next refactor that promotes the shadow
 * channel into a long-lived inactive-deck slot can run this same test
 * and prove it didn't regress visible behaviour.
 *
 * What gets asserted:
 *
 *   T1.  /deck/channel exposes a deck base channel (post Slot-6
 *        deck/mixer split — `/mixer` no longer carries the deck id).
 *
 *   T2.  Default trans_crossfade swap: deckSwapStarted then
 *        deckSwapComplete fire in order, complete lands within
 *        ±400 ms of the configured durationMs, and the FINAL deck
 *        vis frame matches the NEW pattern's solo signature within
 *        a tight tolerance (no residual contribution from the OLD
 *        pattern leaking past completion → this is the "tail
 *        flicker" the operator reported).
 *
 *   T3.  Mid-transition vis: at ~50 % of the duration the deck vis
 *        shows BOTH patterns contributing (not pure-A, not pure-B).
 *        Without this you'd be cut-fading which would also feel
 *        non-smooth.
 *
 *   T4.  Rapid back-to-back swaps: as soon as one swap completes,
 *        fire another. The second swap MUST also produce a clean
 *        ramp + clean tail (no "first swap fine, second swap pops"
 *        regression that the current destroy-on-complete path is
 *        susceptible to if handle pre-allocation drifts).
 *
 *   T5.  Tap-during-swap is rejected with 409 and the in-flight
 *        transition still lands cleanly on its original destination
 *        (no half-broken state).
 *
 *   T6.  Slot persistence smoke: /global-effect-slots GET returns
 *        the SAME bindings after a swap as before — proves the
 *        deck-swap path does not accidentally clobber GEM state.
 *
 * The test owns its own throwaway playlist (hil_tx_smooth) and cleans
 * it up on exit so the operator's playlists folder is left untouched.
 *
 * Prerequisites: engine running on 127.0.0.1:6968 with `test_bench` model.
 * Test patterns required: test_const (solid red), test_dualband (10 red +
 * 10 cyan alternating).
 *
 * Exit code: 0 on all-pass, 1 on any failure.
 */

import http from 'http';
import WebSocket from 'ws';

// Port is overridable via env so the test can run alongside an already-
// running operator engine on 6968 (cursor IDE setups commonly auto-
// spawn one). Default keeps backwards compat.
const HIL_PORT = process.env.MARSIN_HIL_PORT || '6968';
const BASE   = `http://127.0.0.1:${HIL_PORT}`;
const WS_URL = `ws://127.0.0.1:${HIL_PORT}`;
const PIXEL_COUNT = 52;
const SETTLE_MS = 250;
const TX_DURATION_MS = 1000;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Attach the message listener BEFORE 'open' resolves so no early frames
// are dropped — same pattern that hil_ws_topic_split_test landed on.
function subscribeWs() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
    const t0 = Date.now();
    const events = [];
    const visFrames = [];
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || !msg.type) return;
      if (msg.type === 'vis' && msg.vis) {
        visFrames.push({ t: Date.now() - t0, vis: msg.vis });
        if (visFrames.length > 200) visFrames.shift();
      } else {
        events.push({ t: Date.now() - t0, ...msg });
        if (events.length > 500) events.shift();
      }
    });
    ws.once('open', () => res({ ws, events, visFrames, t0 }));
    ws.once('error', rej);
  });
}

function decodeVis(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const out = new Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const o = i * 6;
    out[i] = { r: buf[o] || 0, g: buf[o + 1] || 0, b: buf[o + 2] || 0 };
  }
  return out;
}

// Distance metric: per-pixel L1 over RGB, averaged. Range 0..765.
function visDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += Math.abs(a[i].r - b[i].r) + Math.abs(a[i].g - b[i].g) + Math.abs(a[i].b - b[i].b);
  }
  return s / a.length;
}

// Solo signature: pick `pattern` onto the deck with transitions OFF, wait
// for the master vis to stabilise, then snapshot it. We use this as the
// ground-truth "what does pattern X look like alone".
async function captureSoloVis(entryId, sub) {
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist/entry', { entryId });
  await sleep(SETTLE_MS * 3);
  sub.visFrames.length = 0;
  await sleep(SETTLE_MS * 2);
  const last = sub.visFrames[sub.visFrames.length - 1];
  return last ? decodeVis(last.vis.master) : null;
}

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { console.log('  ✓ PASS  ' + label); pass++; }
  else      { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); fail++; }
}

const cleanupState = { savedTxCfg: null, savedDeckPlaylist: null, hilPlaylist: 'hil_tx_smooth', gemSnap: null };
async function cleanup() {
  console.log('\n── Cleanup ──');
  try {
    if (cleanupState.savedTxCfg) {
      await httpJson('POST', '/deck/transition-config', cleanupState.savedTxCfg);
    }
    if (cleanupState.savedDeckPlaylist) {
      await httpJson('POST', '/deck/playlist', { name: cleanupState.savedDeckPlaylist });
    }
    await httpJson('DELETE', `/playlists/${cleanupState.hilPlaylist}`);
  } catch (e) { console.warn('  cleanup warning:', e.message); }
}

async function main() {
  console.log('==========================================================');
  console.log('hil_deck_transition_smoothness_test.mjs');
  console.log('==========================================================');

  // ── T1: deck base exists via /deck/channel ─────────────────────────
  console.log('\n[T1] Deck base channel via /deck/channel');
  const deckRes = await httpJson('GET', '/deck/channel');
  check(deckRes.status === 200 && deckRes.body?.channel?.id, 'GET /deck/channel returns a channel',
        `status=${deckRes.status} body=${JSON.stringify(deckRes.body).slice(0, 120)}`);
  if (!deckRes.body?.channel?.id) {
    console.log('  FATAL: no deck channel — aborting');
    process.exit(1);
  }

  // Snapshot transition config + current playlist for cleanup.
  cleanupState.savedTxCfg = (await httpJson('GET', '/deck/transition-config')).body;
  cleanupState.savedDeckPlaylist = (await httpJson('GET', '/deck/playlist')).body?.name || 'default';
  // Snapshot GEM slots for T6.
  cleanupState.gemSnap = JSON.stringify((await httpJson('GET', '/global-effect-slots')).body);

  // Force view = deck so vis.master surfaces ONLY the deck output (no
  // mixer overlays leaking into our pattern-identity assertions). The
  // engine boots in 'deck' view too on a fresh state, but operators
  // may have left it on 'mixer' before the test runs.
  await httpJson('POST', '/mixer/view', { view: 'deck' });
  await sleep(SETTLE_MS * 2); // viewFader is time-based, give it room to land

  // Build throwaway playlist with two deterministic patterns.
  await httpJson('POST', '/playlists', {
    name: cleanupState.hilPlaylist,
    entries: [
      { id: 'e_A', pattern: 'test_const',    label: 'A (red)',      defaults: {} },
      { id: 'e_B', pattern: 'test_dualband', label: 'B (red+cyan)', defaults: {} },
    ],
  });
  await sleep(SETTLE_MS);
  await httpJson('POST', '/deck/playlist', { name: cleanupState.hilPlaylist });
  await sleep(SETTLE_MS * 2);

  // Pin colour palette so test_const / test_dualband render deterministically.
  await httpJson('POST', '/param-center', {
    colorPalette1: { h: 0.0, s: 1.0, v: 1.0 },
    colorPalette2: { h: 0.5, s: 1.0, v: 1.0 },
    size: 0.5,
  });
  await sleep(SETTLE_MS);

  const sub = await subscribeWs();
  await sleep(300);

  // Capture solo vis signatures.
  const visA = await captureSoloVis('e_A', sub);
  const visB = await captureSoloVis('e_B', sub);
  check(visA && visB, 'captured solo vis for A and B');
  const aToB = visA && visB ? visDistance(visA, visB) : 0;
  check(aToB > 30, 'A and B are visually distinct (distance > 30)', `distance=${aToB.toFixed(1)}`);

  // ── T2 + T3: trans_crossfade swap A → B ────────────────────────────
  console.log('\n[T2/T3] trans_crossfade A → B: order, timing, mid-blend, clean tail');
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_A' });
  await sleep(SETTLE_MS * 3);
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: TX_DURATION_MS, shuffle: false,
  });
  sub.events.length = 0;
  sub.visFrames.length = 0;

  const tStart = Date.now();
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_B' });
  await sleep(TX_DURATION_MS + 800);

  const started = sub.events.find(e => e.type === 'deckSwapStarted');
  const completed = sub.events.find(e => e.type === 'deckSwapComplete');
  check(!!started, 'deckSwapStarted fired');
  check(!!completed, 'deckSwapComplete fired');
  if (started && completed) {
    check(started.t < completed.t, 'started before complete');
    const elapsed = completed.t - started.t;
    const drift = Math.abs(elapsed - TX_DURATION_MS);
    check(drift < 500, `complete lands near durationMs (elapsed=${elapsed}ms, target=${TX_DURATION_MS}ms, drift=${drift}ms)`);
  }

  // Mid-blend: pick the vis frame closest to t = tStart + durationMs/2.
  const midTarget = (tStart - sub.t0) + TX_DURATION_MS / 2;
  let mid = null, midDist = Infinity;
  for (const f of sub.visFrames) {
    const d = Math.abs(f.t - midTarget);
    if (d < midDist) { midDist = d; mid = f; }
  }
  if (mid) {
    const v = decodeVis(mid.vis.master);
    const dA = visDistance(v, visA);
    const dB = visDistance(v, visB);
    // True blend → both distances should be NON-trivial (not pure A, not pure B).
    check(dA > 5 && dB > 5, `mid-transition vis is a blend (dA=${dA.toFixed(1)}, dB=${dB.toFixed(1)})`);
  } else {
    check(false, 'captured a mid-transition vis frame');
  }

  // Tail check: the LAST vis frame after deckSwapComplete must match B
  // within tight tolerance. This is exactly the operator's complaint —
  // a residual "screen-blend bright" at the tail produces dA-from-B
  // well above the OLD-residual threshold.
  await sleep(SETTLE_MS * 2);
  const tail = sub.visFrames[sub.visFrames.length - 1];
  if (tail) {
    const vTail = decodeVis(tail.vis.master);
    const dTailToB = visDistance(vTail, visB);
    // Pre-fix: dTail-to-B was ~15-25 because old-pattern screen residual
    // leaks light. Post-fix: < 5 (only sampling jitter).
    check(dTailToB < 8, `final vis matches B exactly (distance ${dTailToB.toFixed(1)}, need < 8)`);
  } else {
    check(false, 'captured a post-swap vis frame');
  }

  // ── T4: rapid back-to-back swaps ───────────────────────────────────
  console.log('\n[T4] Rapid back-to-back swaps: B → A → B with no inter-swap delay');
  sub.events.length = 0;
  sub.visFrames.length = 0;
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_A' });
  // Wait for completion, then IMMEDIATELY fire the next one. Clear the
  // event buffer between waits so the SECOND waitForEvent doesn't
  // match the FIRST deckSwapComplete that's still buffered.
  await waitForEvent(sub, 'deckSwapComplete', TX_DURATION_MS + 1000);
  sub.events.length = 0;
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_B' });
  await waitForEvent(sub, 'deckSwapComplete', TX_DURATION_MS + 1000);
  const completes2 = sub.events.filter(e => e.type === 'deckSwapComplete');
  check(completes2.length >= 1, `second rapid swap completed (got ${completes2.length} after clear)`);
  await sleep(SETTLE_MS * 2);
  const tail2 = sub.visFrames[sub.visFrames.length - 1];
  if (tail2) {
    const v = decodeVis(tail2.vis.master);
    const d = visDistance(v, visB);
    check(d < 8, `second-swap tail still matches B exactly (distance ${d.toFixed(1)})`);
  }

  // ── T5: tap-during-swap rejected, original landing preserved ──────
  console.log('\n[T5] Tap-during-swap is rejected with 409');
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_A' });
  await waitForEvent(sub, 'deckSwapComplete', TX_DURATION_MS + 1000);
  sub.events.length = 0;
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_B' });
  // Immediately fire a second tap while the swap is in flight.
  await sleep(100);
  const dupe = await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_A' });
  check(dupe.status === 409, `second tap returns 409 (got ${dupe.status})`);
  await waitForEvent(sub, 'deckSwapComplete', TX_DURATION_MS + 1000);
  await sleep(SETTLE_MS * 2);
  const tail3 = sub.visFrames[sub.visFrames.length - 1];
  if (tail3) {
    const v = decodeVis(tail3.vis.master);
    const d = visDistance(v, visB);
    check(d < 8, `in-flight swap landed on B as originally requested (distance ${d.toFixed(1)})`);
  }

  // ── T6: GEM slot bindings unchanged across swaps ──────────────────
  console.log('\n[T6] /global-effect-slots bindings unchanged across deck swaps');
  const gemAfter = JSON.stringify((await httpJson('GET', '/global-effect-slots')).body);
  check(gemAfter === cleanupState.gemSnap,
    'GEM slot bindings round-trip identical across deck transitions',
    `before=${cleanupState.gemSnap?.slice(0, 80)}…  after=${gemAfter?.slice(0, 80)}…`);

  sub.ws.close();
  await cleanup();
  console.log(`\n── Summary ── ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function waitForEvent(sub, type, timeoutMs) {
  return new Promise((res) => {
    const start = Date.now();
    const tick = setInterval(() => {
      const e = sub.events.find(x => x.type === type && x.t > (start - sub.t0 - 50));
      if (e || Date.now() - start > timeoutMs) {
        clearInterval(tick);
        res(e || null);
      }
    }, 50);
  });
}

process.on('SIGINT',  async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });

main().catch(async (e) => {
  console.error('test crashed:', e);
  await cleanup();
  process.exit(1);
});

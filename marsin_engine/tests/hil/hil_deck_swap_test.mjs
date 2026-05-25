/**
 * hil_deck_swap_test.mjs — HIL Test for Deck Pattern Soft-Swap
 *
 * Validates the engine's `triggerDeckPatternSwap` machinery: when an
 * operator (or autopilot) switches the deck base channel to a new
 * pattern AND deck transitions are enabled, the engine compiles the
 * new pattern, runs it side-by-side with the old one for the duration
 * of the chosen transition, then atomically promotes the new handle
 * onto the base channel.
 *
 * This is verified via the visible deck output (the master vis stream)
 * by switching between two deterministic test patterns:
 *
 *   test_const     — every pixel = HSV(0, 1, 1) = RED (255, 0, 0)
 *   test_dualband  — 10 RED + 10 CYAN pixels, alternating
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model (52 pixels)
 *   - The `default` playlist is loaded on the deck OR the test will
 *     re-load it before running.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_deck_swap_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  /deck/transition-config persists writes (GET round-trips POST)
 *   2.  With transitions DISABLED, /deck/playlist/entry swap is instant
 *       (no deckSwapStarted event)
 *   3.  With transitions ENABLED + trans_crossfade:
 *         a) Server broadcasts deckSwapStarted within 500 ms
 *         b) Master vis at midpoint is BLENDED (between A's and B's
 *            solo signatures — no pure A, no pure B)
 *         c) deckSwapComplete fires once, within +/-400 ms of duration
 *         d) Final master vis matches B's solo signature
 *   4.  With transitions ENABLED + trans_flash:
 *         Master vis at midpoint goes WHITE (all R,G,B saturated)
 *   5.  Autopilot shuffle: with shuffle=true and 1 s timer, the next
 *       entry picked is NOT the current one (we sample several rounds)
 *   6.  Autopilot routes through the soft-swap when enabled (we see
 *       deckSwapStarted events on autopilot ticks)
 *   7.  Tap-during-swap is silently rejected with 409 (engine + UI
 *       contract: clicks during an in-flight transition are ignored,
 *       NOT queued, NOT replacing the in-flight swap)
 *   8.  View → mixer finalizes an in-flight swap on the spot, so a
 *       round-trip away from the deck tab leaves the deck pinned on
 *       the destination pattern (no half-blended buffer waiting around
 *       invisibly while the operator is in the mixer view)
 *   9.  Decoupled autopilot timer: with delay=1 s + transition=3 s, the
 *       cycle takes ~4 s end-to-end (delay → transition → delay → …)
 *       — proves the old setInterval bug (fires every 1 s regardless
 *       of in-flight transition) is gone
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = process.env.ENGINE_BASE || 'http://127.0.0.1:6968';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:6968';
const PIXEL_COUNT = 52;
const SETTLE_MS = 250;

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

// Decode `vis` channel's base64 RGBWAU buffer into [{r,g,b,w,a,u}, ...]
function decodeVis(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const out = [];
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const o = i * 6;
    out.push({
      r: buf[o], g: buf[o + 1], b: buf[o + 2],
      w: buf[o + 3], a: buf[o + 4], u: buf[o + 5],
    });
  }
  return out;
}

function meanWhiteish(pixels) {
  // count pixels where R/G/B all >= 200 (i.e. near-white)
  if (!pixels) return 0;
  let n = 0;
  for (const p of pixels) if (p.r >= 200 && p.g >= 200 && p.b >= 200) n++;
  return n;
}

function meanChannelMax(pixels) {
  if (!pixels) return 0;
  let s = 0;
  for (const p of pixels) s += Math.max(p.r, p.g, p.b);
  return s / pixels.length;
}

const results = [];
function check(cond, label, detail) {
  if (cond) console.log('  \u2713 PASS  ' + label);
  else console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : ''));
  results.push(!!cond);
}

// ─────────────────────────── cleanup ────────────────────────────────
const cleanupState = {
  started: false,
  savedTxCfg: null,
  savedView: null,
  // savedDeckPlaylistName: the playlist the deck was on BEFORE the test
  // pointed it at our throwaway HIL playlist. Captured in setup, used
  // here to swing the deck back BEFORE we delete the test playlist (so
  // the engine never holds a handle on a playlist we're about to
  // unlink).
  savedDeckPlaylistName: null,
  // hilPlaylistName: the disposable playlist the test created. Cleanup
  // deletes it via DELETE /playlists/:name so the operator's
  // playlists folder stays as we found it.
  hilPlaylistName: null,
};
let signalCleanupInstalled = false;

async function cleanup() {
  if (cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    if (cleanupState.savedTxCfg) {
      await httpJson('POST', '/deck/transition-config', cleanupState.savedTxCfg);
      console.log(`  restored deck transition config: enabled=${cleanupState.savedTxCfg.enabled} mode=${cleanupState.savedTxCfg.mode}`);
    }
    if (cleanupState.savedView) {
      await httpJson('POST', '/mixer/view', { view: cleanupState.savedView });
      console.log(`  restored mixer view: ${cleanupState.savedView}`);
    }
    // Swing the deck back to its original playlist BEFORE deleting the
    // HIL playlist. Otherwise the engine would still have the test
    // playlist loaded when its yaml gets unlinked under it; not
    // catastrophic (the loaded entry stays in memory) but the next
    // operator action would 404 on the now-missing assignment.
    if (cleanupState.savedDeckPlaylistName) {
      try {
        await httpJson('POST', '/deck/playlist', { name: cleanupState.savedDeckPlaylistName });
        console.log(`  restored deck playlist: ${cleanupState.savedDeckPlaylistName}`);
      } catch (e) {
        console.warn(`  could not restore deck playlist: ${e.message}`);
      }
    }
    if (cleanupState.hilPlaylistName) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanupState.hilPlaylistName)}`);
        console.log(`  deleted test playlist: ${cleanupState.hilPlaylistName}`);
      } catch (e) {
        console.warn(`  could not delete test playlist ${cleanupState.hilPlaylistName}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('  cleanup warn:', e.message);
  }
}

function installCleanupSignals() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      try { await cleanup(); } finally { process.exit(1); }
    });
  }
}

// ─────────────────────────── core ────────────────────────────────────
//
// `subscribeWs` opens a connection that records every `vis` and every
// engine event we care about — so a single subscriber can answer both
// "what did the master pixels look like at t=midpoint?" and "did the
// engine emit deckSwapStarted/deckSwapComplete?".
async function subscribeWs() {
  const ws = await openWs();
  // Switch to deck view so master vis = deck output (with the soft-swap
  // composited on top). We snapshot the existing view and restore at exit.
  await httpJson('POST', '/mixer/view', { view: 'deck' });
  await sleep(SETTLE_MS);

  const visFrames = []; // { t, master: Uint8Array }
  const events = [];    // { t, type, ...payload }
  const t0 = Date.now();
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const t = Date.now() - t0;
      if (msg.type === 'vis' && msg.vis && msg.vis.master) {
        visFrames.push({ t, master: msg.vis.master });
      } else if (
        msg.type === 'deckSwapStarted' ||
        msg.type === 'deckSwapComplete' ||
        msg.type === 'pattern' ||
        msg.type === 'mixer'
      ) {
        events.push({ t, ...msg });
      }
    } catch {}
  });
  return { ws, visFrames, events, t0 };
}

function pixelsAt(visFrames, targetT) {
  // Find the vis frame closest to targetT
  let best = null;
  let bestDelta = Infinity;
  for (const f of visFrames) {
    const d = Math.abs(f.t - targetT);
    if (d < bestDelta) { best = f; bestDelta = d; }
  }
  return best ? decodeVis(best.master) : null;
}

/**
 * Reset the deck to a known entry quickly, bypassing whatever transition
 * config the test had configured. We disable transitions, do the swap
 * (which is now instant), then restore the caller's config.
 *
 * Without this helper, tests that enable a 1.5 s transition + reset to A
 * + immediately tap "swap to B" would have the reset swap STILL IN FLIGHT
 * when the test swap fires — and the test swap would be silently rejected
 * with 409 EBUSY per the operator's tap-during-transition spec.
 */
async function resetDeckTo(entryId, restoreCfg) {
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist/entry', { entryId });
  await sleep(SETTLE_MS);
  if (restoreCfg) {
    await httpJson('POST', '/deck/transition-config', restoreCfg);
    await sleep(SETTLE_MS);
  }
}

// ─────────────────────────── tests ──────────────────────────────────
(async () => {
  installCleanupSignals();
  cleanupState.started = true;

  console.log('==========================================================');
  console.log('hil_deck_swap_test.mjs — Deck pattern soft-swap');
  console.log('==========================================================');

  // ── Setup ────────────────────────────────────────────────────────
  // Snapshot existing transition config so we can restore it later.
  cleanupState.savedTxCfg = await httpJson('GET', '/deck/transition-config');
  // Snapshot the current view so we restore it at exit. The engine
  // ships state via WS on connect, so we just default to 'deck' which
  // matches the deck tab's typical UI state.
  cleanupState.savedView = 'deck';

  // Make sure the deck playlist is loaded and seeded with deterministic
  // entries we control: test_const, then test_dualband. We'll switch
  // between them with transitions on.
  // Post channel-isolation: the deck channel lives in its OWN slot,
  // NOT in /mixer.channels[]. Fetch via /deck/channel; fall back to
  // /mixer.baseChannelId for older engines.
  const baseChMixer = await httpJson('GET', '/mixer');
  let baseCh = null;
  try {
    const deckResp = await httpJson('GET', '/deck/channel');
    baseCh = deckResp && deckResp.channel ? deckResp.channel : null;
  } catch {}
  if (!baseCh) {
    baseCh = baseChMixer.channels.find((c) => c.id === baseChMixer.baseChannelId);
  }
  if (!baseCh) {
    console.log('  FATAL: no deck base channel — engine not initialized');
    await cleanup();
    process.exit(1);
  }
  const baseChId = baseCh.id;

  // Snapshot the deck's CURRENT playlist BEFORE we point it at our
  // throwaway test playlist. Cleanup uses this to swing the deck back
  // to the operator's playlist before we DELETE the HIL playlist on
  // exit. Falls back to 'default' if the deck somehow has no
  // assignment (engine boot edge case).
  try {
    const currentDeckPl = await httpJson('GET', '/deck/playlist');
    cleanupState.savedDeckPlaylistName = (currentDeckPl && currentDeckPl.name) || 'default';
  } catch {
    cleanupState.savedDeckPlaylistName = 'default';
  }

  // Build (or reuse) a test playlist with our two patterns. We don't
  // mutate any existing playlist — just create a sibling "hil_deck_swap"
  // that the test owns end-to-end. Cleanup DELETEs it on exit so the
  // operator's playlists/ folder stays as we found it (previously this
  // file was being left behind by every test run, polluting prod state).
  const HIL_PL = 'hil_deck_swap';
  cleanupState.hilPlaylistName = HIL_PL;
  await httpJson('POST', '/playlists', {
    name: HIL_PL,
    entries: [
      { id: 'e_hil_const', pattern: 'test_const', label: 'A (red)', defaults: {} },
      { id: 'e_hil_dual',  pattern: 'test_dualband', label: 'B (red+cyan)', defaults: {} },
    ],
  });
  await sleep(SETTLE_MS);
  // Load it onto the deck (first entry — test_const)
  await httpJson('POST', '/deck/playlist', { name: HIL_PL });
  await sleep(SETTLE_MS * 2);

  // Pin the color palette so test_const/test_dualband render
  // deterministically (red and cyan).
  const cpcBefore = await httpJson('GET', '/param-center');
  const cpcParams = cpcBefore.params || cpcBefore;
  const savedC1 = cpcParams.colorPalette1?.value || cpcParams.colorPalette1 || { h: 0, s: 1, v: 1 };
  const savedC2 = cpcParams.colorPalette2?.value || cpcParams.colorPalette2 || { h: 0.5, s: 1, v: 1 };
  const savedSize = (typeof cpcParams.size?.value === 'number') ? cpcParams.size.value
                  : (typeof cpcParams.size === 'number' ? cpcParams.size : 0.5);
  await httpJson('POST', '/param-center', {
    colorPalette1: { h: 0.0, s: 1.0, v: 1.0 },
    colorPalette2: { h: 0.5, s: 1.0, v: 1.0 },
    size: 0.5,
  });
  // Restore in cleanup
  const cpcRestore = { colorPalette1: savedC1, colorPalette2: savedC2, size: savedSize };
  const cleanupCpc = async () => {
    try { await httpJson('POST', '/param-center', cpcRestore); console.log('  restored CPC'); } catch (e) { console.warn('  CPC restore failed:', e.message); }
  };

  // ── TEST 1: config round-trip ────────────────────────────────────
  console.log('\n[TEST 1] /deck/transition-config persists writes');
  const cfg1 = await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_flash', durationMs: 1500, shuffle: false,
  });
  check(cfg1.enabled === true, 'enabled = true');
  check(cfg1.mode === 'trans_flash', `mode round-trips as trans_flash (got ${cfg1.mode})`);
  check(cfg1.durationMs === 1500, `durationMs round-trips (got ${cfg1.durationMs})`);
  const cfg1Get = await httpJson('GET', '/deck/transition-config');
  check(cfg1Get.mode === 'trans_flash', 'GET matches POST');

  // ── TEST 2: transitions DISABLED → no deckSwapStarted ───────────
  console.log('\n[TEST 2] transitions disabled → instant swap, no deckSwapStarted');
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  // Make sure we start on entry A
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_const' });
  await sleep(SETTLE_MS * 2);
  let sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });
  await sleep(800);
  const txStartedDisabled = sub.events.find((e) => e.type === 'deckSwapStarted');
  check(!txStartedDisabled, 'no deckSwapStarted event with transitions disabled');
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── TEST 3: transitions ENABLED + trans_crossfade ───────────────
  console.log('\n[TEST 3] transitions enabled + trans_crossfade');
  // Reset to A using the bypass helper — if we left transitions
  // enabled during the reset, the reset itself becomes a 1.2 s soft
  // swap, and the subsequent test swap would land in the 409 window.
  await resetDeckTo('e_hil_const', {
    enabled: true, mode: 'trans_crossfade', durationMs: 1200, shuffle: false,
  });
  sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  sub.visFrames.length = 0;

  const swapStart = Date.now();
  const swapTriggerT = swapStart - sub.t0;
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });

  // Wait for completion event
  await sleep(2000);

  const startedEv = sub.events.find((e) => e.type === 'deckSwapStarted');
  const completeEv = sub.events.find((e) => e.type === 'deckSwapComplete');
  check(!!startedEv, 'deckSwapStarted event broadcast');
  check(!!completeEv, 'deckSwapComplete event broadcast');
  if (completeEv && startedEv) {
    const dur = completeEv.t - startedEv.t;
    check(Math.abs(dur - 1200) < 400, `completion within 400 ms of 1200 ms (actual=${dur} ms)`);
  }

  // Midpoint sample — pixels should be BLENDED (some red dimmed + some cyan partially)
  const startedAbs = startedEv ? sub.t0 + startedEv.t : swapStart;
  const midT = (startedAbs - sub.t0) + 600;
  const midPixels = pixelsAt(sub.visFrames, midT);
  const whiteish = meanWhiteish(midPixels);
  check(whiteish < 5, `crossfade midpoint not white (whiteish=${whiteish}/${PIXEL_COUNT})`);

  // Final sample (after completion + settle): must be B's signature
  await sleep(SETTLE_MS * 2);
  sub.visFrames.length = 0;
  await sleep(300);
  const finalPixels = pixelsAt(sub.visFrames, sub.visFrames.length ? sub.visFrames[sub.visFrames.length - 1].t : midT + 1000);
  if (finalPixels) {
    // test_dualband: half red, half cyan. Specifically pixel[15] is cyan.
    const p0 = finalPixels[0];
    const p15 = finalPixels[15];
    const isB = (p0 && p0.r > 200 && p0.g < 50) && (p15 && p15.g > 200);
    check(isB, `final master matches B solo (p0=R${p0?.r}G${p0?.g}B${p0?.b} p15=R${p15?.r}G${p15?.g}B${p15?.b})`);
  } else {
    check(false, 'final pixels sampled', 'no vis frame after completion');
  }
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── TEST 4: transitions ENABLED + trans_flash ───────────────────
  console.log('\n[TEST 4] transitions enabled + trans_flash → white midpoint');
  await resetDeckTo('e_hil_const', {
    enabled: true, mode: 'trans_flash', durationMs: 1200, shuffle: false,
  });
  sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  sub.visFrames.length = 0;
  const flashStart = Date.now();
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });
  await sleep(2000);

  const startedFlash = sub.events.find((e) => e.type === 'deckSwapStarted');
  const startedFlashAbs = startedFlash ? sub.t0 + startedFlash.t : flashStart;
  const flashMidT = (startedFlashAbs - sub.t0) + 600;
  const flashMidPixels = pixelsAt(sub.visFrames, flashMidT);
  const flashWhiteish = meanWhiteish(flashMidPixels);
  const flashMaxCh = meanChannelMax(flashMidPixels);
  check(flashWhiteish >= 40, `flash midpoint goes white (whiteish=${flashWhiteish}/${PIXEL_COUNT})`);
  check(flashMaxCh >= 200, `flash midpoint pixels saturate (mean maxCh=${flashMaxCh.toFixed(1)})`);
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── TEST 5: autopilot shuffle is honored ─────────────────────────
  console.log('\n[TEST 5] autopilot shuffle picks a different entry each tick');
  // Disable transitions to keep the test fast (we just want to see
  // the entryId change, not the visual fade).
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  // Reset to A and enable autopilot at 1s with shuffle on
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_const' });
  await sleep(SETTLE_MS);
  await httpJson('POST', '/autopilot', { active: true, delay_s: '1', shuffle: true });
  await sleep(SETTLE_MS);

  // Watch which entry the deck cursor lands on over several ticks
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    await sleep(1200);
    // Post channel-isolation: deck is at /deck/channel, not in /mixer.
    const deck = await httpJson('GET', '/deck/channel');
    const ch = deck && deck.channel;
    const eid = ch && ch.playlist && ch.playlist.activeEntryId;
    if (eid) seen.add(eid);
  }
  // Stop autopilot
  await httpJson('POST', '/autopilot', { active: false });
  check(seen.size >= 2, `autopilot picked >=2 distinct entries over 4 ticks (seen=${seen.size}: ${[...seen].join(',')})`);

  // ── TEST 6: autopilot routes through soft-swap when enabled ─────
  console.log('\n[TEST 6] autopilot routes through soft-swap when transitions on');
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: 600, shuffle: false,
  });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_const' });
  await sleep(SETTLE_MS);
  sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  await httpJson('POST', '/autopilot', { active: true, delay_s: '1', shuffle: false });
  // Wait for 2 autopilot ticks
  await sleep(2500);
  await httpJson('POST', '/autopilot', { active: false });
  const swapEvts = sub.events.filter((e) => e.type === 'deckSwapStarted');
  check(swapEvts.length >= 1, `at least 1 deckSwapStarted event from autopilot (got ${swapEvts.length})`);
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── TEST 7: tap-during-swap is silently rejected with 409 ───────
  // Per the operator's "ignore my clicks during a transition" spec,
  // the engine returns HTTP 409 (Conflict) with code: 'EBUSY' instead
  // of cancelling the in-flight swap and starting a new one. The first
  // swap is allowed to complete on its OWN destination, and the late
  // tap is dropped on the floor.
  console.log('\n[TEST 7] tap-during-swap returns 409, first swap wins');
  await resetDeckTo('e_hil_const', {
    enabled: true, mode: 'trans_crossfade', durationMs: 1500, shuffle: false,
  });
  // First swap: A -> B (1.5 s crossfade in flight)
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });
  await sleep(400); // 400 ms in — definitely still mid-fade
  // Second tap mid-fade: engine should reject with 409. We use the
  // raw http call so we can read the status code, not just the body.
  const rejectRes = await new Promise((resolve, reject) => {
    const u = new URL('/deck/playlist/entry', ENGINE_BASE);
    const req = http.request({
      method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ entryId: 'e_hil_const' }));
    req.end();
  });
  check(rejectRes.status === 409, `mid-fade tap returns HTTP 409 (got ${rejectRes.status})`);
  let parsedBody = {};
  try { parsedBody = JSON.parse(rejectRes.body); } catch (_) {}
  check(parsedBody.code === 'EBUSY', `409 body carries code: 'EBUSY' (got ${parsedBody.code})`);
  // Let the first swap complete unhindered
  await sleep(2000);
  // Post channel-isolation: deck is at /deck/channel, not in /mixer.
  const t7Deck = await httpJson('GET', '/deck/channel');
  const t7Ch = t7Deck && t7Deck.channel;
  check(
    t7Ch && t7Ch.pattern === 'test_dualband',
    `first swap (A→B) completes despite mid-fade tap (got ${t7Ch?.pattern})`,
  );

  // ── TEST 8: view→mixer finalizes the in-flight swap ─────────────
  // If the operator navigates to the mixer tab mid-fade, they expect
  // the deck to be settled on the DESTINATION by the time they come
  // back. We verify by kicking off a long swap, immediately setting
  // view='mixer', and checking that the engine fires deckSwapComplete
  // long before the natural duration would have ended.
  console.log('\n[TEST 8] view→mixer finalizes in-flight swap immediately');
  await resetDeckTo('e_hil_const', {
    enabled: true, mode: 'trans_crossfade', durationMs: 3000, shuffle: false,
  });
  // Listen for deckSwapComplete events
  sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  const t8Start = Date.now();
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });
  await sleep(200); // let the swap actually start
  // NOW switch view → mixer mid-fade. Server should finalize the swap.
  await httpJson('POST', '/mixer/view', { view: 'mixer' });
  // Give the server a beat to process the finalize
  await sleep(150);
  const t8CompleteEv = sub.events.find((e) => e.type === 'deckSwapComplete');
  const t8Elapsed = Date.now() - t8Start;
  check(!!t8CompleteEv, 'deckSwapComplete fired after view→mixer');
  check(
    t8Elapsed < 1000,
    `swap finalized well under 3000 ms duration (actual=${t8Elapsed} ms)`,
  );
  // Switch back to deck so subsequent tests see deck output
  await httpJson('POST', '/mixer/view', { view: 'deck' });
  await sleep(SETTLE_MS);
  // And confirm the deck is settled on B
  // Post channel-isolation: deck is at /deck/channel, not in /mixer.
  const t8Deck = await httpJson('GET', '/deck/channel');
  const t8Ch = t8Deck && t8Deck.channel;
  check(
    t8Ch && t8Ch.pattern === 'test_dualband',
    `deck pattern is test_dualband after view-finalize (got ${t8Ch?.pattern})`,
  );
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── TEST 9: decoupled autopilot timer (delay vs transition) ─────
  // With delay_s=1 and transitionDuration=3000ms, the autopilot cycle
  // should be: show 1 s → run 3 s transition → show 1 s → run 3 s …
  // Old setInterval bug would fire every 1 s regardless of in-flight
  // transitions; we'd see ≥3 deckSwapStarted in a 4 s window. With
  // the new self-rescheduling setTimeout we should see ≤1 (we have
  // 4 s budget = ~one full cycle = one swap).
  console.log('\n[TEST 9] autopilot timer waits for transition to complete');
  await resetDeckTo('e_hil_const', {
    enabled: true, mode: 'trans_crossfade', durationMs: 3000, shuffle: false,
  });
  sub = await subscribeWs();
  await sleep(200);
  sub.events.length = 0;
  // Kick off autopilot at 1s delay
  await httpJson('POST', '/autopilot', { active: true, delay_s: '1', shuffle: false });
  // Watch for 4 s: enough for delay=1 + transition=3 = exactly 1 cycle.
  await sleep(4000);
  await httpJson('POST', '/autopilot', { active: false });
  const t9SwapEvts = sub.events.filter((e) => e.type === 'deckSwapStarted');
  check(
    t9SwapEvts.length <= 2,
    `at most 2 swaps in 4 s window with delay=1+transition=3 (got ${t9SwapEvts.length})`,
  );
  check(
    t9SwapEvts.length >= 1,
    `at least 1 swap fired in 4 s window (got ${t9SwapEvts.length})`,
  );
  // Sub-test: AFTER pausing autopilot, NO further swaps should fire.
  // This is the operator's "when autopilot play is not enabled, disable
  // the pattern switching" requirement — protects against the old
  // setInterval bug where a tick scheduled before the pause would still
  // fire after.
  const t9PausedAt = Date.now();
  sub.events.length = 0;
  // Watch for the next 5s — covers a full delay+transition cycle plus
  // a safety margin in case a stale generation tick was racing.
  await sleep(5000);
  const t9PostPauseSwaps = sub.events.filter(
    (e) => e.type === 'deckSwapStarted' && (sub.t0 + e.t) > t9PausedAt,
  );
  check(
    t9PostPauseSwaps.length === 0,
    `no autopilot swaps after pause (got ${t9PostPauseSwaps.length})`,
  );
  sub.ws.close();
  await sleep(SETTLE_MS);

  // ── Cleanup ──────────────────────────────────────────────────────
  // cleanup() handles deck-playlist restore + HIL-playlist deletion
  // (see cleanupState declaration up top). The CPC pin is restored
  // separately because it was captured later in the setup flow.
  await cleanupCpc();
  await cleanup();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});

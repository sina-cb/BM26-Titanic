/**
 * hil_transition_visual_test.mjs — HIL Test for Pixel-Level Transition Behavior
 *
 * Verifies each `trans_*` blend script ACTUALLY paints the expected
 * pixels on the master output, not just that the WS protocol carries
 * the right fields (that's hil_transition_type_test.mjs).
 *
 * Uses deterministic patterns so signatures are unambiguous:
 *   - CH1 = test_const     : every pixel = HSV(0, 1, 1) = RED (255, 0, 0)
 *   - CH2 = test_dualband  : 10 RED + 10 CYAN pixels, alternating
 *
 * Each blend script has a distinctive fingerprint at the transition
 * midpoint, which we assert against:
 *
 *   trans_crossfade : pixels are a smooth blend — no white spike,
 *                     no spatial gradient, mean brightness between
 *                     A's and B's solo brightness.
 *   trans_flash     : near-WHITE explosion — at progress=0.5 the script
 *                     writes mix(fR,toR,0)=1, mix(fG,toG,0)=1,
 *                     mix(fB,toB,0)=1, mix(1,toW,0)=1. So R, G, B all
 *                     hit 255 on every pixel.
 *   trans_dissolve  : per-pixel random threshold. Pixels split into
 *                     "fully A" and "fully B" buckets — distinctly
 *                     bimodal, NOT a smooth average.
 *   trans_wipe_right: spatial gradient (one half = A, other half = B
 *                     with a wipe edge between).
 *
 * Plus an end-state check: after a flash the master output must be
 * back to B's solo signature (no white residue, confirming the saved
 * blend mode was actually restored).
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model (52 pixels)
 *
 * ── Destructive setup ─────────────────────────────────────────────────
 *   The mixer is capped at `mixer.maxChannels` channels TOTAL
 *   (config.yaml). To stay under the cap while adding the two test
 *   channels, this test DELETES every existing overlay before running,
 *   then re-creates them with the same pattern/mode/fader/enabled at
 *   cleanup. Note that:
 *     - Channel IDs change on recreate (Date.now()-based).
 *     - Per-channel playlist assignments, CPC bindings, and live
 *       export values are NOT preserved across the delete/recreate.
 *   If your channels carry state you can't easily rebuild, run this
 *   test against a scene that doesn't matter (e.g. test_bench).
 *
 *   The test also snapshots and overrides three CPC params so the
 *   baselines are deterministic, then restores them at cleanup:
 *     - colorPalette1 = pure red (h=0, s=1, v=1)
 *     - colorPalette2 = pure cyan (h=0.5, s=1, v=1)
 *     - size          = 0.5 (engine SIZE multiplier = 1.0). Without
 *                       this, scaled pixel coords push `x` outside the
 *                       wipe edge window and the wipe test sees only A.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_transition_visual_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';
const PIXEL_COUNT = 52;
const PIXEL_BYTES = 6; // RGBWAU

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
function fmt(n, p = 1) { return n == null ? 'null' : Number(n).toFixed(p); }
function openWs() { return new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.once('open', () => res(ws)); ws.once('error', rej); }); }

const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

function b64(s) { return Buffer.from(s || '', 'base64'); }

function pixelsOf(buf) {
  const px = [];
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const off = i * PIXEL_BYTES;
    px.push({ r: buf[off]||0, g: buf[off+1]||0, b: buf[off+2]||0, w: buf[off+3]||0 });
  }
  return px;
}

function analyze(buf) {
  const px = pixelsOf(buf);
  const lum = px.map(p => Math.max(p.r, p.g, p.b, p.w));
  const mean = lum.reduce((s, x) => s + x, 0) / lum.length;
  const stddev = Math.sqrt(lum.reduce((s, x) => s + (x - mean) ** 2, 0) / lum.length);
  const whiteish = px.filter(p => Math.min(p.r, p.g, p.b) >= 200).length;
  const maxCh = Math.max(...px.flatMap(p => [p.r, p.g, p.b, p.w]));
  return { px, mean, stddev, whiteish, maxCh };
}

// ─────────────────────────── cleanup ────────────────────────────────
// `removedOverlays` holds the FULL channel records of every overlay we
// deleted during setup. Cleanup recreates each via POST /mixer/channels
// using the same pattern/mode/fader/enabled. New channels get new IDs
// (no way to preserve them) and lose per-channel CPC/playlist/export
// state — documented in the doc header.
//
// `savedCpc` holds the canonical pre-test values for colorPalette1/2
// (pinned to red+cyan so test_const/test_dualband have predictable
// pixel signatures) and `size` (pinned to 0.5 so the engine's global
// SIZE multiplier = 1.0 — without this, scaled coords can push the
// wipe's `x` outside the edge window and produce a false-negative).
const cleanupState = {
  started: false, done: false,
  removedOverlays: [], testChannelIds: [],
  savedCpc: null,
};
let signalCleanupInstalled = false;
async function cleanup() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n\u2500\u2500 Cleanup \u2500\u2500');
  for (const id of cleanupState.testChannelIds) {
    if (!id) continue;
    try { await httpJson('DELETE', `/mixer/channels/${id}`); console.log(`  removed test channel ${id}`); }
    catch (e) { console.warn(`  could not remove ${id}: ${e.message}`); }
  }
  for (const ch of cleanupState.removedOverlays) {
    try {
      const body = {
        pattern: ch.pattern,
        name: ch.name,
        mode: ch.mode,
        fader: ch.fader,
        enabled: ch.enabled,
      };
      const r = await httpJson('POST', '/mixer/channels', body);
      console.log(`  recreated overlay ${ch.pattern} -> ${r.channelId || '(failed: ' + r.error + ')'}`);
    } catch (e) { console.warn(`  could not recreate overlay ${ch.pattern}: ${e.message}`); }
  }
  if (cleanupState.savedCpc) {
    try {
      await httpJson('POST', '/param-center', cleanupState.savedCpc);
      console.log(`  restored CPC: colorPalette1=${JSON.stringify(cleanupState.savedCpc.colorPalette1)} colorPalette2=${JSON.stringify(cleanupState.savedCpc.colorPalette2)} size=${cleanupState.savedCpc.size}`);
    } catch (e) { console.warn(`  could not restore CPC: ${e.message}`); }
  }
}
function installSignalCleanup() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => { console.error(`\nReceived ${sig}; cleaning up...`); try { await cleanup(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); } });
  }
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  HIL Test \u2014 Pixel-Level Transition Visual Verification        ');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  let mixer;
  try { mixer = await httpJson('GET', '/mixer'); }
  catch {
    console.error('\u2717 Cannot reach engine at ' + ENGINE_BASE);
    console.error('  Start with: node engine.js --pattern test_const --model test_bench');
    return 1;
  }
  cleanupState.started = true;
  installSignalCleanup();

  try {
    // 1. Delete every existing overlay so we never exceed mixer.maxChannels
    //    once we add the two test channels. We snapshot the full record
    //    of each so cleanup() can recreate them (new ids, same patterns).
    const existingOverlays = mixer.channels.slice(1); // skip baseChannelId
    console.log(`  Engine cap: maxChannels=${mixer.maxChannels}  existing overlays=${existingOverlays.length}`);
    for (const ch of existingOverlays) {
      cleanupState.removedOverlays.push(ch);
      try {
        await httpJson('DELETE', `/mixer/channels/${ch.id}`);
        console.log(`  deleted existing overlay ${ch.id} (${ch.pattern}) -- will be recreated on cleanup`);
      } catch (e) {
        console.warn(`  could not delete ${ch.id}: ${e.message}`);
      }
    }

    // 2. Engage mixer view (master output reflects mixerBuffer, not deck).
    //    viewFader ramps in 0.05/frame at 40 fps -> ~500 ms to fully switch.
    await httpJson('POST', '/mixer/view', { view: 'mixer' });
    await sleep(700);

    // 3. Pin CPC color palette + size. We snapshot the pre-test values
    //    so cleanup() can restore them.
    //      - colorPalette1/2: pinned to red+cyan so test_const renders
    //        pure red and test_dualband renders red+cyan bands. Both
    //        patterns auto-bind their `colorPalette*` exports to these
    //        canonical CPC keys via the slider*/hsvPicker* convention.
    //      - size: pinned to 0.5 so engine SIZE multiplier = 1.0.
    //        Without this, scaled coords push `x` in trans_wipe_* outside
    //        the edge window and the wipe degenerates to "show A only".
    const cpcState = await httpJson('GET', '/param-center');
    const cpcParams = cpcState.params || cpcState;
    cleanupState.savedCpc = {
      colorPalette1: cpcParams.colorPalette1?.value || cpcParams.colorPalette1 || { h: 0, s: 1, v: 1 },
      colorPalette2: cpcParams.colorPalette2?.value || cpcParams.colorPalette2 || { h: 0.5, s: 1, v: 1 },
      size: (typeof cpcParams.size?.value === 'number') ? cpcParams.size.value
             : (typeof cpcParams.size === 'number' ? cpcParams.size : 0.5),
    };
    console.log(`  saved CPC (will restore on exit): C1=${JSON.stringify(cleanupState.savedCpc.colorPalette1)} C2=${JSON.stringify(cleanupState.savedCpc.colorPalette2)} size=${cleanupState.savedCpc.size}`);
    await httpJson('POST', '/param-center', {
      colorPalette1: { h: 0.0, s: 1.0, v: 1.0 }, // pure red
      colorPalette2: { h: 0.5, s: 1.0, v: 1.0 }, // pure cyan
      size: 0.5,                                  // engine SIZE multiplier = 1.0
    });
    await sleep(200);

    // 4. Add two deterministic test channels. Abort with a clear
    //    diagnostic if the engine refuses (e.g. still over the cap, or
    //    test_const / test_dualband missing from patterns/).
    console.log('\n  Adding CH1 = test_const (solid red)');
    const r1 = await httpJson('POST', '/mixer/channels', { pattern: 'test_const',    name: 'CH1', mode: 'blend_screen', fader: 1.0 });
    if (!r1.channelId) {
      console.error('\u2717 Failed to add CH1: ' + JSON.stringify(r1));
      return 1;
    }
    const A = r1.channelId; cleanupState.testChannelIds.push(A);

    console.log('  Adding CH2 = test_dualband (alternating red+cyan)');
    const r2 = await httpJson('POST', '/mixer/channels', { pattern: 'test_dualband', name: 'CH2', mode: 'blend_screen', fader: 0.0 });
    if (!r2.channelId) {
      console.error('\u2717 Failed to add CH2: ' + JSON.stringify(r2));
      return 1;
    }
    const B = r2.channelId; cleanupState.testChannelIds.push(B);
    await sleep(500);

    // ─── Capture solo baselines (proves test_const = red, test_dualband = red+cyan) ─
    console.log('\n[baseline] solo signatures');
    async function captureMaster() {
      const ws = await openWs();
      const frame = await new Promise(r => {
        const onMsg = m => { try { const o = JSON.parse(m); if (o.type === 'vis') { ws.off('message', onMsg); r(o.vis); } } catch {} };
        ws.on('message', onMsg);
        setTimeout(() => r(null), 1500);
      });
      ws.close();
      return frame ? b64(frame.master) : null;
    }

    await httpJson('PATCH', `/mixer/channels/${A}`, { fader: 1, enabled: true });
    await httpJson('PATCH', `/mixer/channels/${B}`, { fader: 0, enabled: true });
    await sleep(300);
    const soloA = analyze(await captureMaster());
    console.log(`  CH1 solo (test_const)    : mean=${fmt(soloA.mean)} stddev=${fmt(soloA.stddev)} maxCh=${soloA.maxCh}`);
    console.log(`    pixel[0]=R:${soloA.px[0].r} G:${soloA.px[0].g} B:${soloA.px[0].b}`);
    if (soloA.px.every(p => p.r > 200 && p.g < 10 && p.b < 10)) ok('CH1 = solid red across all pixels (test_const baseline correct)');
    else fail('CH1 is not solid red', `pixel[0]=R:${soloA.px[0].r} G:${soloA.px[0].g} B:${soloA.px[0].b}`);

    await httpJson('PATCH', `/mixer/channels/${A}`, { fader: 0 });
    await httpJson('PATCH', `/mixer/channels/${B}`, { fader: 1 });
    await sleep(300);
    const soloB = analyze(await captureMaster());
    console.log(`  CH2 solo (test_dualband) : mean=${fmt(soloB.mean)} stddev=${fmt(soloB.stddev)} maxCh=${soloB.maxCh}`);
    console.log(`    pixel[0]=R:${soloB.px[0].r} G:${soloB.px[0].g} B:${soloB.px[0].b}   pixel[15]=R:${soloB.px[15].r} G:${soloB.px[15].g} B:${soloB.px[15].b}`);
    const dualbandOK = soloB.px.slice(0, 10).every(p => p.r > 200 && p.b < 10) && soloB.px.slice(10, 20).every(p => p.g > 200 && p.b > 200);
    if (dualbandOK) ok('CH2 = 10 red + 10 cyan repeating (test_dualband baseline correct)');
    else fail('CH2 is not the expected red/cyan dualband');

    // ─── Helper: trigger a transition, return master frame at the
    // moment when target.fader is closest to 0.5 ──────────────────────
    //
    // We use a *longer* duration (3000 ms) so there are plenty of
    // vis frames to sample from, and we correlate the per-pixel vis
    // stream (40 Hz) with the throttled mixer broadcasts (10 Hz)
    // by wall-clock timestamp. The progress argument that the blend
    // script sees IS the live channel.fader value — there's no other
    // ground truth for "we're at the midpoint."
    async function triggerAndCaptureAtMidpoint(transitionMode, durationMs) {
      await httpJson('PATCH', `/mixer/channels/${A}`, { fader: 1, enabled: true, mode: 'blend_screen' });
      await httpJson('PATCH', `/mixer/channels/${B}`, { fader: 0, enabled: false, mode: 'blend_screen' });
      await sleep(300);

      const ws = await openWs();
      const visFrames = [];   // { t, master }
      const faderSamples = []; // { t, fader }
      const t0 = Date.now();
      ws.on('message', m => {
        try {
          const o = JSON.parse(m);
          if (o.type === 'vis' && o.vis) {
            visFrames.push({ t: Date.now() - t0, master: b64(o.vis.master) });
          } else if (o.type === 'mixer') {
            const bCh = o.channels.find(c => c.id === B);
            if (bCh) faderSamples.push({ t: Date.now() - t0, fader: bCh.fader });
          }
        } catch {}
      });
      await sleep(200); visFrames.length = 0; faderSamples.length = 0;
      ws.send(JSON.stringify({
        type: 'triggerMixerTransition',
        targetChannelId: B, durationMs,
        curve: 'smoothstep', mode: 'exclusiveOverlays',
        transitionMode,
      }));
      await sleep(durationMs + 700);
      ws.close();

      // Find the mixer broadcast where target's fader is closest to 0.5
      let bestFader = null, bestFaderDiff = Infinity;
      for (const s of faderSamples) {
        const d = Math.abs(s.fader - 0.5);
        if (d < bestFaderDiff) { bestFaderDiff = d; bestFader = s; }
      }
      if (!bestFader) return { vis: null, midFader: null };

      // Find the vis frame closest in WALL TIME to that mixer sample
      let bestVis = null, bestVisDiff = Infinity;
      for (const f of visFrames) {
        const d = Math.abs(f.t - bestFader.t);
        if (d < bestVisDiff) { bestVisDiff = d; bestVis = f; }
      }
      return { vis: bestVis, midFader: bestFader.fader, midT: bestFader.t };
    }

    const VISUAL_DUR_MS = 3000; // generous window for plenty of vis samples

    // ─── TEST 1: trans_crossfade ─────────────────────────────────────
    console.log('\n[TEST 1] trans_crossfade — smooth blend, no white spike');
    {
      const { vis, midFader, midT } = await triggerAndCaptureAtMidpoint('trans_crossfade', VISUAL_DUR_MS);
      if (!vis) { fail('no vis sample captured'); }
      else {
        const m = analyze(vis.master);
        console.log(`  sampled at fader=${fmt(midFader, 3)} (engine t=${midT}ms): mean=${fmt(m.mean)} whiteish=${m.whiteish}/${PIXEL_COUNT} maxCh=${m.maxCh}`);
        console.log(`    pixel[0]=R:${m.px[0].r} G:${m.px[0].g} B:${m.px[0].b}   pixel[15]=R:${m.px[15].r} G:${m.px[15].g} B:${m.px[15].b}`);
        check(m.whiteish < 10, `whiteish=${m.whiteish} pixels (<10) — no flash`, `whiteish=${m.whiteish} suggests unexpected flash`);
      }
    }

    // ─── TEST 2: trans_flash ─────────────────────────────────────────
    // At progress=0.5 the script writes rgbwau(1, 1, 1, 1, 0, 0) on
    // every pixel = pure white. Even sampling +/-0.1 around progress
    // still gives near-white via mix(fromX, 1, pow(amt, 0.5)).
    console.log('\n[TEST 2] trans_flash — midpoint pixels go full WHITE (R=G=B≈255)');
    {
      const { vis, midFader, midT } = await triggerAndCaptureAtMidpoint('trans_flash', VISUAL_DUR_MS);
      if (!vis) { fail('no vis sample captured'); }
      else {
        const m = analyze(vis.master);
        console.log(`  sampled at fader=${fmt(midFader, 3)} (engine t=${midT}ms): mean=${fmt(m.mean)} whiteish=${m.whiteish}/${PIXEL_COUNT} maxCh=${m.maxCh}`);
        console.log(`    pixel[0]=R:${m.px[0].r} G:${m.px[0].g} B:${m.px[0].b}   pixel[15]=R:${m.px[15].r} G:${m.px[15].g} B:${m.px[15].b}`);
        check(m.maxCh >= 240, `maxCh=${m.maxCh} >= 240 — pixels saturate near white`, `maxCh=${m.maxCh} too low for a flash (expected >=240)`);
        check(m.whiteish >= PIXEL_COUNT * 0.6,
          `${m.whiteish}/${PIXEL_COUNT} pixels are white-ish (R,G,B all >=200) — WHITE FLASH CONFIRMED`,
          `only ${m.whiteish}/${PIXEL_COUNT} white-ish pixels`,
          `expected >=${Math.round(PIXEL_COUNT * 0.6)}`);
      }
    }

    // ─── TEST 3: trans_dissolve ──────────────────────────────────────
    // Dissolve writes per-pixel: each pixel is either ~A (red) or ~B
    // (red or cyan depending on position). We check that the GREEN
    // channel (which is 0 in A and 255 in cyan-band B pixels) splits
    // bimodally — pixels are either close to 0 or close to 255, not
    // averaged.
    console.log('\n[TEST 3] trans_dissolve — pixels are BINARY (per-pixel close to A or B, not averaged)');
    {
      const { vis, midFader, midT } = await triggerAndCaptureAtMidpoint('trans_dissolve', VISUAL_DUR_MS);
      if (!vis) { fail('no vis sample captured'); }
      else {
        const m = analyze(vis.master);
        console.log(`  sampled at fader=${fmt(midFader, 3)} (engine t=${midT}ms): mean=${fmt(m.mean)} stddev=${fmt(m.stddev)}`);
        // Cyan-band pixel indices have G high in B-solo and G=0 in A-solo.
        const cyanBandIdx = [];
        for (let i = 10; i < PIXEL_COUNT; i++) if (Math.floor(i / 10) % 2 === 1) cyanBandIdx.push(i);
        let binaryHits = 0;
        for (const i of cyanBandIdx) {
          const g = m.px[i].g;
          if (g < 50 || g > 200) binaryHits++;
        }
        const binaryFrac = binaryHits / cyanBandIdx.length;
        console.log(`    cyan-band pixels (count=${cyanBandIdx.length}): ${binaryHits} binary (g<50 or g>200), ${cyanBandIdx.length-binaryHits} averaged`);
        check(binaryFrac >= 0.7,
          `${(binaryFrac*100).toFixed(0)}% of differentiable pixels are binary — per-pixel A-or-B confirmed`,
          `only ${(binaryFrac*100).toFixed(0)}% binary`,
          `expected >=70%, dissolve should NOT look like an average`);
      }
    }

    // ─── TEST 4: trans_wipe_right ────────────────────────────────────
    // Wipe uses the pixel's normalized x coordinate (nx) — NOT the
    // array index. test_const (A) is uniform red. test_dualband (B)
    // alternates red+cyan by index. Mid-wipe, pixels with low nx
    // show B (so cyan-band B pixels emit green); pixels with high
    // nx still show A (no green). We import the model to get nx
    // and check that "high-G" pixels cluster on the low-nx side.
    console.log('\n[TEST 4] trans_wipe_right — spatial gradient (low-nx pixels show B, high-nx show A)');
    {
      const { vis, midFader, midT } = await triggerAndCaptureAtMidpoint('trans_wipe_right', VISUAL_DUR_MS);
      if (!vis) { fail('no vis sample captured'); }
      else {
        const m = analyze(vis.master);
        // Load model to map index -> nx.
        const modelModule = await import('../../models/test_bench.js');
        const nx = modelModule.pixels.map(p => p.nx);
        const highG = m.px.map((p, i) => ({ i, g: p.g, nx: nx[i] })).filter(p => p.g > 80);
        const meanG = m.px.reduce((s, p) => s + p.g, 0) / m.px.length;
        const meanNxOfHighG = highG.length > 0 ? highG.reduce((s, p) => s + p.nx, 0) / highG.length : null;
        console.log(`  sampled at fader=${fmt(midFader, 3)} (engine t=${midT}ms): meanG=${fmt(meanG)} highG-pixels=${highG.length}`);
        console.log(`    pixel[18]=R:${m.px[18].r} G:${m.px[18].g} B:${m.px[18].b} nx=${fmt(nx[18], 3)}`);
        console.log(`    pixel[30]=R:${m.px[30].r} G:${m.px[30].g} B:${m.px[30].b} nx=${fmt(nx[30], 3)}`);
        console.log(`    pixel[10]=R:${m.px[10].r} G:${m.px[10].g} B:${m.px[10].b} nx=${fmt(nx[10], 3)} (Vintage Right, should be A=red at progress=0.5)`);
        if (highG.length > 0) {
          console.log(`    high-G pixels (first 8): ${highG.slice(0, 8).map(p => `idx=${p.i}(nx=${fmt(p.nx,2)},G=${p.g})`).join(' ')}`);
          console.log(`    mean nx of high-G pixels: ${fmt(meanNxOfHighG, 3)} (expected < 0.5 — high-G pixels are on the unrevealed B side)`);
        }
        // Pass if at least 4 pixels show high green AND they're concentrated on the low-nx side.
        check(highG.length >= 4 && meanNxOfHighG !== null && meanNxOfHighG < 0.5,
          `wipe edge present — ${highG.length} cyan-band B pixels visible, clustered at meanNx=${fmt(meanNxOfHighG, 3)}`,
          `wipe not producing expected spatial split`,
          `highG-count=${highG.length}, meanNxOfHighG=${fmt(meanNxOfHighG, 3)}`);
      }
    }

    // ─── TEST 5: after a flash, master is back to B's solo signature ───
    console.log('\n[TEST 5] After a flash, master must be back to B-solo (no white residue, mode restored)');
    {
      const ws = await openWs();
      await httpJson('PATCH', `/mixer/channels/${A}`, { fader: 1, enabled: true, mode: 'blend_screen' });
      await httpJson('PATCH', `/mixer/channels/${B}`, { fader: 0, enabled: false, mode: 'blend_screen' });
      await sleep(300);
      ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: B, durationMs: 800, transitionMode: 'trans_flash' }));
      await sleep(1400);
      ws.close();
      await sleep(300);
      const after = analyze(await captureMaster());
      console.log(`  post-flash: mean=${fmt(after.mean)} whiteish=${after.whiteish}/${PIXEL_COUNT} maxCh=${after.maxCh}`);
      // Should match B's solo signature: 10 red + 10 cyan repeating.
      const okPattern = after.px.slice(0, 10).every(p => p.r > 200 && p.b < 10) &&
                        after.px.slice(10, 20).every(p => p.g > 200 && p.b > 200);
      if (okPattern) ok('post-flash master matches B solo (test_dualband: red+cyan bands) — restoration succeeded');
      else fail('post-flash master does not match B solo', `pixel[0]=R:${after.px[0].r} G:${after.px[0].g} B:${after.px[0].b}`);
      if (after.whiteish < 5) ok(`only ${after.whiteish} white-ish pixels — no flash residue`);
      else fail(`${after.whiteish} pixels still white-ish`, 'flash mode was not restored');
    }
  } finally {
    await cleanup();
  }

  const pass = results.filter(Boolean).length, total = results.length;
  console.log('\n' + '='.repeat(58));
  console.log(`SUMMARY: ${pass}/${total} pixel-level assertions passed`);
  console.log('='.repeat(58) + '\n');
  return pass === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(async e => {
  console.error('Test failed:', e);
  await cleanup();
  process.exit(1);
});

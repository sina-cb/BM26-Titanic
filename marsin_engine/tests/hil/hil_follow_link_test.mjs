/**
 * hil_follow_link_test.mjs — HIL test for channel FOLLOW/LINK (round-2 #6).
 *
 * Drives the full engine path for docs/39 §F-follow:
 *   - PATCH a follower's followLeaderId so it tracks a leader; drive the
 *     leader's fader and assert the follower's VIS METER LEVEL tracks the
 *     leader's effective level × followScale (the follower's manual fader is
 *     replaced by the followed input). Read levels off the WS `vis` broadcast.
 *   - PATCH followScale and assert the followed level scales.
 *   - Self-follow → 400 FOLLOW_CYCLE; A→B→A cycle → 400 FOLLOW_CYCLE;
 *     unknown leader → 404 FOLLOW_LEADER_NOT_FOUND; bad followScale → 400.
 *   - DELETE the leader → the follower's followLeaderId clears (fail safe:
 *     reverts to its own fader, never dangles / freezes dark).
 *   - Serialized round-trip: followLeaderId/followScale appear in /mixer.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node tests/hil/hil_follow_link_test.mjs
 *   (or: node tests/hil/hil_follow_link_test.mjs --port 31268)
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';

import { assertDisposableEngine } from './hil_guard.mjs';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : (process.env.ENGINE_PORT ? parseInt(process.env.ENGINE_PORT, 10) : 31268);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failDetail) {
  if (cond) ok(passLabel); else fail(passLabel, failDetail);
}

const getOverlay = (mixer, id) => (mixer?.channels || []).find(c => c.id === id);

// Open the /ws/viz topic, collect `vis` `levels` payloads for `windowMs`, and
// return the MAX level seen for `channelId` (max smooths the per-frame meter so
// a single noisy frame doesn't decide the assertion). Vis is broadcast at
// ~1 Hz, so the window must comfortably exceed 1 s to guarantee a frame.
// Returns null if never seen.
function sampleLevel(channelId, windowMs = 2500) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}/ws/viz`);
    let best = null;
    ws.on('message', (m) => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'vis' && d.levels && typeof d.levels[channelId] === 'number') {
          if (best === null || d.levels[channelId] > best) best = d.levels[channelId];
        }
      } catch (_) {}
    });
    ws.on('error', () => resolve(best));
    setTimeout(() => { try { ws.close(); } catch (_) {} resolve(best); }, windowMs);
  });
}

async function main() {
  console.log(`\n== HIL: follow_link (engine ${BASE}) ==\n`);

  let baseline;
  try {
    baseline = (await httpJson('GET', '/mixer')).body;
  } catch (e) {
    console.error(`Cannot reach engine at ${BASE}: ${e.message}`);
    console.error(`  Start with: node engine.js --pattern test_const --model test_bench --port ${PORT}`);
    return 1;
  }

  // Refuse to mutate a non-disposable engine BEFORE adding any channel.
  await assertDisposableEngine(BASE);

  const playlists = (await httpJson('GET', '/playlists')).body || [];
  const pl = Array.isArray(playlists) && playlists.length > 0 ? playlists[0] : 'default';
  const originalCount = (baseline.channels || []).length;
  const added = [];

  try {
    // ── Add a leader + a follower overlay (test_const = constant brightness) ─
    const addLeader = await httpJson('POST', '/mixer/channels', {
      playlist: pl, name: 'hil_follow_leader', mode: 'blend_screen', fader: 1.0,
    });
    if (addLeader.status !== 200) { console.error(`leader add failed: ${JSON.stringify(addLeader.body)}`); return 1; }
    const leaderId = addLeader.body.channelId;
    added.push(leaderId);

    const addFollower = await httpJson('POST', '/mixer/channels', {
      playlist: pl, name: 'hil_follow_follower', mode: 'blend_screen', fader: 0.1,
    });
    if (addFollower.status !== 200) { console.error(`follower add failed: ${JSON.stringify(addFollower.body)}`); return 1; }
    const followerId = addFollower.body.channelId;
    added.push(followerId);
    await sleep(50);

    // ── Link follower → leader, drive leader, assert follower level tracks ──
    console.log('[follow] PATCH followLeaderId, follower level tracks leader');
    {
      const r = await httpJson('PATCH', `/mixer/channels/${followerId}`, { followLeaderId: leaderId });
      check(r.status === 200, 'PATCH followLeaderId → 200', `status ${r.status} ${JSON.stringify(r.body)}`);
      const m = (await httpJson('GET', '/mixer')).body;
      check(getOverlay(m, followerId)?.followLeaderId === leaderId,
        'followLeaderId surfaced in /mixer broadcast', `got ${getOverlay(m, followerId)?.followLeaderId}`);

      // Leader at 1.0 → follower (scale 1.0) tracks ~leader level (its manual
      // 0.1 is replaced). Sample the leader + follower meter levels.
      await httpJson('PATCH', `/mixer/channels/${leaderId}`, { fader: 1.0 });
      await sleep(150);
      const leaderHigh = await sampleLevel(leaderId);
      const followerHigh = await sampleLevel(followerId);
      check(leaderHigh !== null && followerHigh !== null,
        'both leader + follower report a meter level', `leader=${leaderHigh} follower=${followerHigh}`);
      check(leaderHigh !== null && followerHigh !== null && Math.abs(followerHigh - leaderHigh) < 0.08,
        `follower level (${followerHigh}) tracks leader level (${leaderHigh}) at scale 1.0`);

      // Drive leader DOWN to 0.3 → follower tracks down too (NOT its 0.1). The
      // test_const meter levels are small in absolute terms (low intrinsic
      // brightness), so compare RATIOS, not absolute margins: the follower must
      // drop to clearly below its previous (full) level and stay within ~10% of
      // the leader's new level.
      await httpJson('PATCH', `/mixer/channels/${leaderId}`, { fader: 0.3 });
      await sleep(200);
      const leaderLow = await sampleLevel(leaderId);
      const followerLow = await sampleLevel(followerId);
      check(followerLow !== null && followerHigh !== null && followerLow < followerHigh * 0.6,
        `follower level dropped when leader dropped (followerLow=${followerLow} < 0.6×${followerHigh})`);
      check(followerLow !== null && leaderLow !== null && leaderLow > 0 &&
        Math.abs(followerLow - leaderLow) < leaderLow * 0.2 + 0.01,
        `follower level (${followerLow}) tracks lowered leader (${leaderLow})`);
    }

    // ── followScale scales the followed level ───────────────────────────────
    console.log('\n[follow] followScale scales the followed level');
    {
      await httpJson('PATCH', `/mixer/channels/${leaderId}`, { fader: 1.0 });
      const r = await httpJson('PATCH', `/mixer/channels/${followerId}`, { followScale: 0.5 });
      check(r.status === 200, 'PATCH followScale=0.5 → 200', `status ${r.status}`);
      await sleep(250);
      const leaderFull = await sampleLevel(leaderId);
      const followerHalf = await sampleLevel(followerId);
      // Ratio check: at scale 0.5 the follower's level is ~half the leader's
      // (absolute magnitudes are small for test_const, so compare the ratio).
      check(followerHalf !== null && leaderFull !== null && leaderFull > 0 &&
        Math.abs(followerHalf / leaderFull - 0.5) < 0.15,
        `follower at scale 0.5 (${followerHalf}) is ~half the leader (${leaderFull})`);
      // Reset scale back to 1.0 for tidiness.
      await httpJson('PATCH', `/mixer/channels/${followerId}`, { followScale: 1.0 });
    }

    // ── Cycle / self / unknown rejection ────────────────────────────────────
    console.log('\n[follow] cycle + self + unknown leader rejection');
    {
      const self = await httpJson('PATCH', `/mixer/channels/${followerId}`, { followLeaderId: followerId });
      check(self.status === 400 && self.body?.code === 'FOLLOW_CYCLE',
        'self-follow → 400 FOLLOW_CYCLE', `status ${self.status} ${JSON.stringify(self.body)}`);

      // follower already follows leader (A→leader). Now make leader follow
      // follower → leader→follower→leader cycle, must be rejected.
      const cyc = await httpJson('PATCH', `/mixer/channels/${leaderId}`, { followLeaderId: followerId });
      check(cyc.status === 400 && cyc.body?.code === 'FOLLOW_CYCLE',
        'A→B→A cycle → 400 FOLLOW_CYCLE', `status ${cyc.status} ${JSON.stringify(cyc.body)}`);

      const unknown = await httpJson('PATCH', `/mixer/channels/${followerId}`, { followLeaderId: 'ch_nope_999' });
      check(unknown.status === 404 && unknown.body?.code === 'FOLLOW_LEADER_NOT_FOUND',
        'unknown leader → 404 FOLLOW_LEADER_NOT_FOUND', `status ${unknown.status} ${JSON.stringify(unknown.body)}`);

      const badScale = await httpJson('PATCH', `/mixer/channels/${followerId}`, { followScale: 'oops' });
      check(badScale.status === 400, 'non-finite followScale → 400 (fail loud)', `status ${badScale.status}`);
    }

    // ── Leader DELETE clears the follower (fail safe) ───────────────────────
    console.log('\n[follow] leader DELETE clears the follower');
    {
      // Re-confirm the link is still in place before deleting.
      const pre = (await httpJson('GET', '/mixer')).body;
      check(getOverlay(pre, followerId)?.followLeaderId === leaderId,
        'follower still linked before leader delete', `got ${getOverlay(pre, followerId)?.followLeaderId}`);

      const del = await httpJson('DELETE', `/mixer/channels/${leaderId}`);
      check(del.status === 200, 'DELETE leader → 200', `status ${del.status}`);
      added.splice(added.indexOf(leaderId), 1);
      await sleep(100);

      const post = (await httpJson('GET', '/mixer')).body;
      const f = getOverlay(post, followerId);
      check(f && f.followLeaderId === null,
        'follower followLeaderId cleared after leader delete (fail safe, not dangling)',
        `got ${f?.followLeaderId}`);
      // Follower reverts to its OWN manual fader (0.1), still rendering — sample
      // a non-null level (not frozen / errored out).
      const lvl = await sampleLevel(followerId);
      check(lvl !== null, 'follower still reports a meter level after leader delete (not dark/frozen)', `got ${lvl}`);
    }

  } finally {
    // ── Cleanup: delete any overlays we added beyond the original count ─────
    try {
      const current = (await httpJson('GET', '/mixer')).body;
      const overlays = current.channels || [];
      for (const id of added) {
        await httpJson('DELETE', `/mixer/channels/${id}`);
      }
      // Belt-and-braces: trim any stragglers above the original count.
      const after = (await httpJson('GET', '/mixer')).body;
      const remaining = after.channels || [];
      for (let i = remaining.length - 1; i >= originalCount; i--) {
        await httpJson('DELETE', `/mixer/channels/${remaining[i].id}`);
      }
    } catch (e) {
      console.warn(`  cleanup failed: ${e.message}`);
    }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\nSUMMARY: ${passed}/${total} assertions passed\n`);
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});

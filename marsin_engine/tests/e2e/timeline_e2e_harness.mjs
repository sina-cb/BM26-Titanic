/*
 * timeline_e2e_harness.mjs — the shared rig for the TIMELINE ZOOM e2e suite
 * (slice S5, report `_100`; design `_94`, engine `_95`, pad `_97`, bugfixes `_98`).
 *
 * WHAT AN "E2E" SCENARIO IS HERE: a REAL `engine.js` subprocess on a throwaway
 * port, driven over REAL HTTP and REAL `/ws/control` WebSockets, restarted by
 * really killing the process. The `tests/timeline/*` family already pins the
 * TimelineService's logic in-process; this suite pins the WIRING — routes,
 * broadcasts, persistence across a process boundary, and two clients at once.
 *
 * ── SAFETY: THREE INDEPENDENT WALLS, EVERY ONE ASSERTED, NOT ASSUMED ───────
 *
 *  1. sACN can never reach hardware. `--dest` alone was NOT enough while the
 *     engine still supported a per-controller `controllers:` block that carried
 *     its OWN host and won for the universes it claimed — the `_97` §4.4 trap
 *     that put 30 s of live sACN on the real rig. That mechanism is REMOVED
 *     (operator ruling 2026-08-05): the engine has one output path, and a config
 *     that still declares `controllers:` makes it refuse to boot
 *     (`lib/output_config_guard.js`). This harness therefore writes a config
 *     with the key ABSENT (not merely emptied — an empty key is itself refused)
 *     plus `sacn.destinations: [192.0.2.9]` — TEST-NET-1 (RFC 5737), reserved
 *     for documentation and never routed; a LOOPBACK dest is NOT a black hole,
 *     because the sim's sACN receiver binds every local interface and would
 *     relay the frames onward — points the engine at it with
 *     MARSIN_CONFIG_FILE, and ASSERTS on the way up that
 *     (a) every `[sACN Out] Sender started` line names only the black hole, and
 *     (b) `GET /status.outputRouting.controllers` is empty.
 *     `assertBlackHoled()` throws before any scenario runs.
 *
 *  2. Engine state can never touch the tracked tree. MARSIN_STATE_DIR,
 *     MARSIN_PLAYLISTS_DIR and MARSIN_TIMELINE_DIR (added in `_100`) all point
 *     into throwaway temp dirs. The show-plan library is a COPY, so
 *     `POST /timeline/plans` / `plan/activate` — which `_95` and `_97` both had
 *     to hand-restore afterwards — cannot reach `simulation/scenes/**`.
 *
 *  3. Ports can never collide with the operator's stack. BM26 pins
 *     6967-6972 + 5568 (`.agent/memory/bm26-port-topology.md`); every engine
 *     here gets a random port well above that band, OSC is off, the web client
 *     is off, and VSN1 layout deploy is off (no device HTTP).
 *
 * The in-window fixture plan is BUILT AT RUN TIME from the engine's own clock
 * (`.agent/ops/timeline_e2e_tests.md` — a committed in-window plan goes stale
 * the next day), so this file commits no dates.
 *
 * Not a `*.test.*` module, so no runner picks it up.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/e2e → tests → marsin_engine
export const ENGINE_DIR = path.resolve(__dirname, '..', '..');
export const REPO_DIR = path.resolve(ENGINE_DIR, '..');

/**
 * The sACN black hole: TEST-NET-1 (RFC 5737), reserved for documentation and
 * never routed, so a datagram can only be dropped. NOT a loopback address —
 * the simulation's sACN receiver binds every local interface, so a
 * loopback-destined frame is still RECEIVED and relayed on to the live rig.
 */
export const BLACKHOLE_HOST = '192.0.2.9';

/** The scene these engines run. test_bench — never `titanic`. */
export const E2E_SCENE = 'test_bench';

/**
 * The plan timezone the e2e fixture uses — CHOSEN so that "now" always lands
 * mid-afternoon in plan-local time.
 *
 * Why not just `America/Los_Angeles`: the fixture needs cues that ALREADY FIRED
 * today (3 h ago, 20 min ago) and one that fires in a minute, and the resolver's
 * day-latch semantics are per CALENDAR DAY in the plan's tz (`_95` §2.1). A
 * fixture pinned to a real zone would therefore stop meaning anything between
 * local midnight and ~03:30 — a committed suite that quietly changes what it
 * tests depending on the hour is worse than no suite. Anchoring the PLAN's tz to
 * the clock makes every scenario identical at 4 pm and at 4 am.
 *
 * Fixed-offset `Etc/GMT±N` zones have no DST, so the arithmetic is exact. NOTE
 * the POSIX sign inversion: `Etc/GMT+7` is UTC−7.
 */
export function planTzForNow(nowMs, targetLocalHour = 17) {
  const d = new Date(nowMs);
  const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
  let offset = Math.round(targetLocalHour - utcHour);
  while (offset > 12) offset -= 24;
  while (offset < -11) offset += 24;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

// ── config ────────────────────────────────────────────────────────────────

/**
 * Write a BLACK-HOLED copy of the engine config into `dir` and return its path.
 *
 * Everything that can reach the outside world is disarmed here, at the source
 * of truth the engine actually boots from — not by a CLI flag that only covers
 * half of it.
 *
 * @param {string} dir           absolute temp dir
 * @param {object} timelinePatch merged over the `timeline:` block
 */
export function writeBlackHoledConfig(dir, timelinePatch = {}) {
  const real = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8')) || {};
  const cfg = JSON.parse(JSON.stringify(real));

  // WALL 1 — output. The engine has exactly one output path now, so the black
  // hole in `sacn.destinations` IS the whole wall. The `controllers:` key is
  // DELETED rather than emptied: the engine refuses to boot on its mere
  // presence, so an empty one would not be a safer config, it would be an
  // unbootable one.
  cfg.sacn = { ...(cfg.sacn || {}), destinations: [BLACKHOLE_HOST], multicast: false };
  delete cfg.controllers;

  // WALL 3 — no listeners, no device traffic, no port squatting.
  cfg.osc = { ...(cfg.osc || {}), enabled: false };
  cfg.fire_sync = { ...(cfg.fire_sync || {}), enabled: false };
  cfg.web_client = { ...(cfg.web_client || {}), enabled: false };
  cfg.audio = { ...(cfg.audio || {}), enabled: false };
  cfg.vsn1 = { ...(cfg.vsn1 || {}), deployLayout: false, deployOnBoot: false };

  cfg.timeline = { ...(cfg.timeline || {}), enabled: true, ...timelinePatch };

  // Belt and braces: refuse to write a config that could still reach a device.
  if ('controllers' in cfg) {
    throw new Error('e2e config guard: `controllers` must be ABSENT before spawning an engine — ' +
      'the direct-to-hardware mechanism is removed and the engine refuses to boot on the key');
  }
  for (const d of cfg.sacn.destinations) {
    if (d !== BLACKHOLE_HOST) {
      throw new Error(`e2e config guard: sACN destination ${d} is not the black hole ${BLACKHOLE_HOST}`);
    }
  }

  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, yaml.dump(cfg), 'utf8');
  return file;
}

// ── run-time plan fixtures ────────────────────────────────────────────────

/**
 * FROZEN at module load, so every fixture, every date helper and every assertion
 * in one suite run share ONE timezone. Recomputing per call would let the zone
 * flip mid-run (the choice changes on the half hour), which is a flake that
 * would only ever appear at 3 am.
 */
export const E2E_PLAN_TZ = planTzForNow(Date.now());

/** `HH:MM` in `tz`, `offsetMin` from `nowMs`. */
export function clockAt(nowMs, offsetMin, tz = E2E_PLAN_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs + offsetMin * 60000));
  const get = (t) => parts.find(p => p.type === t).value;
  // en-US renders midnight as hour "24" under hourCycle h23/h24 on some ICUs.
  return `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** `YYYY-MM-DD` in `tz`, `offsetDays` from `nowMs`. */
export function dateAt(nowMs, offsetDays = 0, tz = E2E_PLAN_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs + offsetDays * 86400000));
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const LOOKS = {
  ambient: {
    playlist: 'ambient', palette: 'deep_sea',
    autopilot: { active: true, delay_s: 90, shuffle: true },
    target: { channel: 'deck', id: null },
  },
  evening: {
    playlist: 'default', palette: 'sunset_coral',
    autopilot: { active: true, delay_s: 45, shuffle: false },
    target: { channel: 'deck', id: null },
  },
  show: {
    playlist: 'burn_night', palette: 'bass_drop',
    autopilot: { active: true, delay_s: 60, shuffle: false },
    target: { channel: 'deck', id: null },
  },
  party_high: {
    playlist: 'party_high', palette: 'bass_drop',
    autopilot: { active: true, delay_s: 30, shuffle: true },
    target: { channel: 'deck', id: null },
  },
  morning: {
    playlist: 'slow', palette: 'aurora',
    autopilot: { active: true, delay_s: 60, shuffle: false },
    target: { channel: 'deck', id: null },
  },
};

/**
 * The IN-WINDOW e2e plan, anchored to `nowMs`.
 *
 * NO `festival` block ⇒ always in window on any date (same trick as
 * `tests/fixtures/timeline/dryrun_bench.yaml`), so nothing here goes stale and
 * no date is committed.
 *
 * The shape each scenario needs:
 *   c_expired   program, fired 3 h ago, hold 30 m — ALREADY EXPIRED. Post-`_98`
 *               FIX 7 conformance: the deck must be on the defaultCue (ambient),
 *               and the ribbon must never say `hold-expired-baseline`.
 *   c_live      ambient, fired `liveAgoMin` ago, open-ended — the ACTIVE cue,
 *               i.e. the PERFORM target.
 *   c_show      program, due `showInMin` from now, hold 30 m — comes due
 *               MID-ZOOM, which is the D3 deferral.
 *   c_morning   ambient, fired at 04:00 — a second timed event so the travel
 *               steppers have somewhere to walk.
 *   c_party     mood, fast dwell/cooldown — the party-session-vs-zoom scenarios.
 */
export function buildE2EPlan(nowMs, { name = 'zoom_e2e', liveAgoMin = 20, showInMin = 3 } = {}) {
  return {
    schemaVersion: 2,
    name,
    location: { lat: 40.7864, lon: -119.2065, tz: E2E_PLAN_TZ, elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'default', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: LOOKS,
    defaultCue: { label: 'Ambient program', action: { type: 'look', look: 'ambient' } },
    cues: [
      {
        id: 'c_expired', label: 'Expired show', enabled: true, catchUp: true,
        trigger: { type: 'clock', at: clockAt(nowMs, -180) },
        action: { type: 'look', look: 'show' },
        kind: 'program', hold: { min: 30 }, days: 'all',
      },
      {
        id: 'c_live', label: 'Evening ramp', enabled: true, catchUp: true,
        trigger: { type: 'clock', at: clockAt(nowMs, -liveAgoMin) },
        action: { type: 'look', look: 'evening' },
        kind: 'ambient', days: 'all',
      },
      {
        id: 'c_show', label: 'Scheduled show', enabled: true, catchUp: true,
        trigger: { type: 'clock', at: clockAt(nowMs, showInMin) },
        action: { type: 'look', look: 'show' },
        kind: 'program', hold: { min: 30 }, days: 'all',
      },
      {
        id: 'c_morning', label: 'Morning', enabled: true, catchUp: true,
        trigger: { type: 'clock', at: '04:00' },
        action: { type: 'look', look: 'morning' },
        kind: 'ambient', durationMin: 60, days: 'all',
      },
      {
        id: 'c_party', label: 'Party session', enabled: true, catchUp: true,
        trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 2, cooldownSec: 2 },
        action: { type: 'look', look: 'party_high' },
        kind: 'mood', durationMin: 1, days: 'all',
      },
    ],
  };
}

/**
 * A DORMANT plan — same shape, but its festival window opens well after today,
 * so `takeover()` refuses to arm (no PERFORM) while TRAVEL to an in-window
 * target must still work. That is the rehearsal case (`_95` §3.7), and it is
 * the state the real rig is in outside the festival.
 *
 * The start date is computed from the clock, never committed.
 */
export function buildDormantPlan(nowMs, { name = 'zoom_e2e_dormant', startInDays = 30 } = {}) {
  const plan = buildE2EPlan(nowMs, { name });
  plan.festival = { startDate: dateAt(nowMs, startInDays), days: 8 };
  return plan;
}

// ── the harness ───────────────────────────────────────────────────────────

/**
 * @param {object}  o
 * @param {string}  o.prefix         temp-dir prefix (also the log tag)
 * @param {object}  [o.plans]        { <planName>: <plan object> } seeded into the plan dir
 * @param {string[]}[o.copyPlans]    absolute plan YAML paths to COPY in (read-only sources)
 * @param {string}  o.activePlan     config `timeline.activePlan`
 * @param {object}  [o.timelinePatch] merged over the config `timeline:` block
 * @param {string}  [o.pattern]
 * @param {object}  [o.extraEnv]      test-only engine environment overrides
 * @param {number}  [o.portBase]      isolated HTTP port range start
 * @param {number}  [o.portSpan]      number of candidate ports above portBase
 */
export function createTimelineE2E(o) {
  const {
    prefix, plans = {}, copyPlans = [], activePlan,
    timelinePatch = {}, pattern = '13_sparkle', extraEnv = {},
    portBase = 7700, portSpan = 200,
  } = o;
  if (!prefix) throw new Error('createTimelineE2E: `prefix` is required');
  if (!activePlan) throw new Error('createTimelineE2E: `activePlan` is required');
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65535) {
    throw new Error('createTimelineE2E: `portBase` must be an integer from 1024 to 65535');
  }
  if (!Number.isInteger(portSpan) || portSpan < 1 || portBase + portSpan > 65536) {
    throw new Error('createTimelineE2E: `portSpan` must define a non-empty range within 65535');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const stateRoot = path.join(root, 'states');
  const stateDir = path.join(stateRoot, E2E_SCENE);
  const playlistsDir = path.join(root, 'playlists');
  const timelineDir = path.join(root, 'timeline');
  for (const d of [stateRoot, stateDir, playlistsDir, timelineDir]) fs.mkdirSync(d, { recursive: true });

  // Real playlist CONTENT (so `loadPlaylist` resolves real patterns and the
  // deck answers honestly), copied — the engine may write playlists, and those
  // writes must land in the temp dir.
  const realPlaylists = path.join(REPO_DIR, 'simulation', 'scenes', E2E_SCENE, 'playlists');
  for (const f of fs.readdirSync(realPlaylists)) {
    if (f.endsWith('.yaml')) fs.copyFileSync(path.join(realPlaylists, f), path.join(playlistsDir, f));
  }

  for (const [planName, plan] of Object.entries(plans)) {
    fs.writeFileSync(path.join(timelineDir, `${planName}.yaml`), yaml.dump(plan), 'utf8');
  }
  for (const src of copyPlans) {
    fs.copyFileSync(src, path.join(timelineDir, path.basename(src)));
  }

  const configFile = writeBlackHoledConfig(root, { activePlan, ...timelinePatch });

  // Well clear of the pinned 6967-6972 band, of the other spawn harnesses'
  // 7100-7400 range, and of 7680 (Windows Delivery Optimization squats it on
  // this box — a random hit there would fail the boot for no real reason).
  const port = portBase + Math.floor(Math.random() * portSpan);
  const base = () => `http://127.0.0.1:${port}`;

  let proc = null;
  let stdout = '';
  const sockets = new Set();

  function env() {
    return {
      ...process.env,
      ...extraEnv,
      MARSIN_CONFIG_FILE: configFile,
      MARSIN_STATE_DIR: stateRoot,
      MARSIN_PLAYLISTS_DIR: playlistsDir,
      MARSIN_TIMELINE_DIR: timelineDir,
      // The timeline is the SUBJECT here — the shared spawn helper's
      // BM26_DISABLE_TIMELINE=1 must not leak in from an outer env.
      BM26_DISABLE_TIMELINE: '0',
      MARSIN_VSN1_DEPLOY: '0',
    };
  }

  function spawnEngine() {
    stdout = '';
    proc = spawn(
      'node',
      ['engine.js', '--pattern', pattern, '--model', E2E_SCENE,
        '--port', String(port), '--dest', BLACKHOLE_HOST],
      { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: env() },
    );
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stdout += d.toString(); });
    return proc;
  }

  async function waitForReady(timeoutMs = 40000) {
    const t0 = Date.now();
    let lastErr = null;
    while (Date.now() - t0 < timeoutMs) {
      if (proc && proc.exitCode !== null) {
        throw new Error(`engine exited (${proc.exitCode}) during boot:\n${stdout.slice(-3000)}`);
      }
      try {
        const res = await fetch(base() + '/status');
        if (res.ok) {
          const j = await res.json();
          if (j.service === 'marsin-engine') return j;
        }
      } catch (e) { lastErr = e; }
      await sleep(200);
    }
    throw new Error(`engine never became ready: ${lastErr?.message || 'timeout'}\n${stdout.slice(-3000)}`);
  }

  /**
   * WALL 1, ASSERTED. Runs before every scenario and again after every restart.
   * Fails the suite rather than letting one frame out.
   */
  async function assertBlackHoled(status) {
    const senderLines = stdout.split('\n').filter(l => l.includes('[sACN Out] Sender started'));
    assert.ok(senderLines.length > 0, `no sACN sender line in engine output:\n${stdout.slice(-2000)}`);
    for (const line of senderLines) {
      const m = line.match(/destinations \[([^\]]*)\]/);
      assert.ok(m, `unparseable sACN sender line: ${line}`);
      for (const host of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        assert.equal(host, BLACKHOLE_HOST,
          `sACN sender points at ${host}, not the black hole — refusing to run (the _97 trap)`);
      }
    }
    assert.deepEqual(status.outputRouting, { controllers: [] },
      `per-controller routing is non-empty: ${JSON.stringify(status.outputRouting)}`);
  }

  async function api(method, url, body) {
    const res = await fetch(base() + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  /** GET /timeline/state, throwing on anything but 200. */
  async function state() {
    const r = await api('GET', '/timeline/state');
    assert.equal(r.status, 200, `GET /timeline/state → ${r.status}: ${JSON.stringify(r.data)}`);
    return r.data;
  }

  /**
   * THE RIG'S OWN ANSWER: what is loaded on the deck right now.
   * `{ name, autopilot:{active, delay_s, shuffle} }` — the `delay_s` is what
   * distinguishes one look from another when two looks share a playlist.
   */
  async function deck() {
    const r = await api('GET', '/deck/playlist');
    assert.equal(r.status, 200, `GET /deck/playlist → ${r.status}`);
    return r.data;
  }

  async function start() {
    spawnEngine();
    const status = await waitForReady();
    await assertBlackHoled(status);
    return status;
  }

  async function kill() {
    for (const ws of sockets) { try { ws.close(); } catch { /* already gone */ } }
    sockets.clear();
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill('SIGTERM');
    const won = await Promise.race([exited.then(() => true), sleep(4000).then(() => false)]);
    if (!won) { proc.kill('SIGKILL'); await Promise.race([exited, sleep(2000)]); }
  }

  /** A REAL restart: the process dies, a new one boots on the same dirs+port. */
  async function restart() {
    await kill();
    await sleep(400);
    spawnEngine();
    const status = await waitForReady();
    await assertBlackHoled(status);
    return status;
  }

  /**
   * A CaptainPad-shaped client: opens /ws/control, records every frame, and
   * can wait for a predicate over `timelineState` frames.
   *
   * Resolves only once the connect-time `timelineState` REPLAY has landed —
   * a real pad paints from that frame, and a test that inspects `latest()`
   * before it arrives is racing the handshake, not testing anything.
   */
  async function client(tag = 'pad') {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    const frames = [];
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      frames.push({ atMs: Date.now(), msg });
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${tag}: ws open timeout`)), 10000);
      ws.once('open', () => { clearTimeout(t); resolve(); });
      ws.once('error', (e) => { clearTimeout(t); reject(e); });
    });
    sockets.add(ws);

    const timelineFrames = () => frames.filter(f => f.msg.type === 'timelineState');
    const replayT0 = Date.now();
    while (timelineFrames().length === 0) {
      if (Date.now() - replayT0 > 10000) throw new Error(`${tag}: no timelineState replay after connect`);
      await sleep(50);
    }
    return {
      tag, ws, frames, timelineFrames,
      /** The most recent timelineState this client saw (its rendered truth). */
      latest() {
        const t = timelineFrames();
        return t.length ? t[t.length - 1].msg : null;
      },
      async waitFor(pred, { timeoutMs = 12000, what = 'condition' } = {}) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          for (const f of timelineFrames()) if (pred(f.msg)) return f;
          await sleep(100);
        }
        const last = this.latest();
        throw new Error(`${tag}: timed out waiting for ${what}; last zoom=`
          + `${JSON.stringify(last && last.zoom)} mode=${last && last.mode}`);
      },
      close() { sockets.delete(ws); try { ws.close(); } catch { /* already gone */ } },
    };
  }

  async function teardown() {
    await kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  return {
    start, restart, kill, teardown, api, state, deck, client,
    assertBlackHoled, base, port,
    root, stateRoot, stateDir, playlistsDir, timelineDir, configFile,
    get stdout() { return stdout; },
    get proc() { return proc; },
  };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Poll `fn` until `pred` holds. Fails loud with the last value — never returns
 * a "close enough" answer (codex P0).
 */
export async function until(fn, pred, { timeoutMs = 12000, what = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}; last = ${JSON.stringify(last)}`);
}

/**
 * Publish the mood key the way the Audio Companion does — a REPUBLISH every
 * ~500 ms, because the timeline's staleness guard measures the CPC write
 * REVISION, not the value (`lib/timeline/mood_source.js`). A single write goes
 * stale and the show drops to calm.
 *
 * Returns a stop function.
 */
export function startMoodPublisher(harness, valueFn) {
  let alive = true;
  let flip = 0;
  (async () => {
    while (alive) {
      const value = valueFn(flip++);
      try { await harness.api('POST', '/param-center', { audioPartyStrong: value }); } catch { /* engine down */ }
      await sleep(400);
    }
  })();
  return () => { alive = false; };
}

/**
 * The mood key the timeline reads (`config.timeline.mood.key`) must be a real,
 * registered CPC key — otherwise MoodSource reports permanent CALM and every
 * party scenario would "pass" by never firing. Assert it rather than assume it.
 */
export async function assertMoodKeyRegistered(harness, key = 'audioPartyStrong') {
  const r = await harness.api('GET', '/param-center/schema');
  assert.equal(r.status, 200);
  assert.ok(r.data.some(e => e.key === key),
    `mood key "${key}" is not a registered CPC key — party scenarios would silently never fire`);
}

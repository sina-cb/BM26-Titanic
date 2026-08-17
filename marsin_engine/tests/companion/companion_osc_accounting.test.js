// Tests for the Companion's OSC-OUT accounting surface + multi-theme CSS
// (dev/companion_ui, 2026-06-20):
//   1. /osc_accounting + /catalog data SHAPE — boots the real companion server
//      in TEST source mode on an isolated port, hits the HTTP endpoints, and
//      asserts the accounting frame enumerates every designed OUTPUT signal
//      (address + cpcKey + live value + count + rate) plus the always-on BPM
//      emit, with the live OSC stream actually flowing (counts climb).
//   2. THEME var completeness — every [data-theme="…"] block in
//      companion_app.css defines the FULL companion var set (a missing var
//      would leave that theme half-styled), and GENRE_NAMES matches the
//      canonical sibling list.
//
// Run:  cd marsin_engine && node --test tests/companion_osc_accounting.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isolatedCompanionEnv, isolatedStateRoot } from '../helpers/companion_isolation.mjs';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKED_AUDIO_CONFIG = loadTrackedAudioAnalysisConfig(path.join(__dirname, '..', '..'));
const SERVER = path.join(__dirname, '..', '..', 'audio', 'companion', 'companion_server.js');
const CSS = path.join(__dirname, '..', '..', 'audio', 'companion', 'ui', 'companion_app.css');

// The companion var set every theme must define (the tokens the UI reads).
// --on-accent is required in EVERY theme: it is the foreground on top of --accent
// (active seg-btn, .primary, .cal-apply). Light's teal accent fails WCAG AA on the
// near-black text, so each theme carries its own AA-passing on-accent color — a
// missing token must FAIL here, not silently fall back (codex P0).
const REQUIRED_VARS = ['--bg', '--panel', '--panel2', '--raised', '--border', '--text', '--muted', '--accent', '--ok', '--err', '--on-accent'];
const EXPECTED_THEMES = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];
const CANONICAL_GENRES = ['ambient', 'deep_house', 'melodic_house', 'tech_house', 'techno', 'melodic_techno', 'downtempo'];

async function getJson(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  assert.equal(res.ok, true, `${route} → ${res.status}`);
  return res.json();
}

async function waitForServer(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/catalog`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`companion server did not come up on :${port}`);
}

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

// Boot the real companion server (test source mode by default in standalone),
// switch it to TEST over WS so the OSC stream flows without a mic, and run
// `fn(ws, targets)` where `targets` names the ephemeral OSC + engine ports this
// companion was pointed at. The documented bench ports used to be hardcoded
// here, which made the file a shared-resource test and forced the whole
// companion suite to run at --test-concurrency=1.
//
// HERMETIC (report `_220`): `isolatedCompanionEnv` hands the child a scratch
// config with black-holed companion endpoints AND a throwaway `MARSIN_STATE_DIR`
// seeded with the two-key mic fixture. Before this the spawn merged the
// operator's live `states/test_bench/audio_state.yaml` over config.yaml, so the
// analyzer feeding this accounting ran at whatever inputGain / fftSize the rig
// happened to be on.
async function withCompanion(port, fn) {
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const isolation = isolatedCompanionEnv('osc_accounting');
  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port',
    String(port),
    '--model',
    'test_bench',
    '--host',
    '127.0.0.1',
    '--source',
    'test',
    '--no-mic',
    '--osc-port',
    String(oscPort),
    '--engine-port',
    String(enginePort),
  ], {
    cwd: path.join(__dirname, '..', '..'),
    env: isolation.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForServer(port);
    assert.equal(proc.exitCode, null, `spawned companion remains alive: ${stderr}`);
    // Force TEST source so analysis runs headless (the worktree config may boot
    // the companion in mic mode, which has no device in CI).
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const helloPromise = new Promise((resolve) => {
      ws.on('message', (buf) => {
        const message = JSON.parse(buf.toString());
        if (message.type === 'hello') resolve(message);
      });
    });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const hello = await helloPromise;
    // The analyzer producing this accounting is the TRACKED one. Every
    // assertion in this file is structural or a counter, so nothing else here
    // would notice a dropped `env: isolation.env` and the suite would quietly
    // go back to scoring the rig's live overlay (pre-`_220`: inputGain 8.83,
    // noiseGate 0.06, fftSize 1024 rather than the tracked 1 / 0.04 / 2048).
    assert.equal(hello.inputGain, TRACKED_AUDIO_CONFIG.bands.inputGain,
      'the spawned companion is running the operator\'s live input gain, not the tracked one');
    assert.equal(hello.gates.noiseGate, TRACKED_AUDIO_CONFIG.bands.noiseGate,
      'the spawned companion is running the operator\'s live noise gate, not the tracked one');
    ws.send(JSON.stringify({ type: 'setMode', mode: 'test' }));
    // Let a few analyzer hops + accounting ticks happen.
    await new Promise(r => setTimeout(r, 1500));
    await fn(ws, { oscPort, enginePort });
    ws.close();
  } finally {
    proc.kill('SIGKILL');
    isolation.cleanup();
  }
}

test('/osc_accounting enumerates every designed OUTPUT + the BPM emit, live', async () => {
  const port = await getFreePort();
  await withCompanion(port, async (_ws, targets) => {
    // Catalog advertises the canonical GENRE_NAMES.
    const cat = await getJson(port, '/catalog');
    assert.deepEqual(cat.genreNames, CANONICAL_GENRES);

    const acc = await getJson(port, '/osc_accounting');
    assert.ok(acc.target && typeof acc.target.host === 'string', 'target host present');
    assert.ok(Number.isInteger(acc.target.port), 'target port present');
    assert.ok(Array.isArray(acc.outputs), 'outputs is an array');
    assert.ok(typeof acc.totalSent === 'number', 'totalSent present');

    // Every row carries the accounting fields.
    for (const o of acc.outputs) {
      assert.equal(typeof o.address, 'string');
      assert.ok(o.address.startsWith('/marsin/'), `address looks like an OSC address: ${o.address}`);
      assert.equal(typeof o.cpcKey, 'string');
      assert.equal(typeof o.count, 'number');
      assert.equal(typeof o.rateHz, 'number');
      assert.ok('value' in o, 'value field present');
      assert.ok('label' in o, 'label field present');
    }

    // The default design ships the curated band, flux, and dom signals; BPM is always
    // advertised. So the accounting must contain those addresses by NAME (the
    // page is generic but these are the known boot outputs).
    const byAddr = new Map(acc.outputs.map(o => [o.address, o]));
    for (const a of ['/marsin/mic/low', '/marsin/mic/flux', '/marsin/dom/freq1', '/marsin/audio/bpm']) {
      assert.ok(byAddr.has(a), `accounting includes ${a}`);
    }
    // BPM is the built-in derived emit.
    assert.equal(byAddr.get('/marsin/audio/bpm').cpcKey, 'audioBpm');

    // The OSC stream is actually flowing in test mode — at least the band
    // signals have sent packets and report a live value + a non-zero rate.
    const micLow = byAddr.get('/marsin/mic/low');
    assert.ok(micLow.count > 0, `micLow has emitted packets (count=${micLow.count})`);
    assert.ok(micLow.rateHz > 0, `micLow reports a send rate (${micLow.rateHz}/s)`);
    assert.ok(acc.totalSent > 0, `totalSent climbed (${acc.totalSent})`);

    const snapshot = await getJson(port, '/signal_snapshot');
    assert.equal(snapshot.mode, 'test');
    assert.equal(snapshot.micDisabled, true);
    assert.equal(snapshot.engineLink.connected, false);
    assert.deepEqual(snapshot.targets.osc, { host: '127.0.0.1', port: targets.oscPort });
    assert.deepEqual(snapshot.targets.engine, { host: '127.0.0.1', port: targets.enginePort });
    const snapshotByKey = new Map(snapshot.signals.map(signal => [signal.key, signal]));
    for (const key of [
      'micOnsetLowRaw', 'micOnsetMidRaw', 'micOnsetHighRaw', 'micSubRaw',
      'micTonalStabilityRaw', 'micChromaFluxRaw', 'micChromaTiltRaw',
    ]) {
      assert.ok(snapshotByKey.has(key), `diagnostic snapshot exposes ${key}`);
      assert.ok(Number.isFinite(snapshotByKey.get(key).value), `${key} value is finite`);
    }

    // PRODUCTION, not registration. The row set comes from the static `live`
    // descriptor flag — that only proves a key EXISTS. The write counters come
    // from the real ParamCenter write path, so they are the part of this
    // endpoint that can actually distinguish a driven key from a dead one.
    assert.ok(Number.isInteger(snapshot.analyzerHops) && snapshot.analyzerHops > 0,
      `analyzer hops have run (${snapshot.analyzerHops})`);
    for (const entry of snapshot.signals) {
      assert.equal(typeof entry.registered, 'boolean', `${entry.key} reports registration`);
      assert.ok(Number.isInteger(entry.writes), `${entry.key} reports a write count`);
      assert.ok(entry.lastWriteHop === null || Number.isInteger(entry.lastWriteHop),
        `${entry.key} reports a last-write hop`);
    }
    // The raw mirrors are written every single hop, so they must show real,
    // recent production — a snapshot that showed them "live" with zero writes
    // would be exactly the lie these fields were added to kill.
    for (const key of ['micLowRaw', 'micMidRaw', 'micHighRaw', 'micFluxRaw']) {
      const entry = snapshotByKey.get(key);
      assert.ok(entry.writes > 0, `${key} has been written (${entry.writes})`);
      assert.ok(snapshot.analyzerHops - entry.lastWriteHop <= 2,
        `${key} was written on a recent hop (last=${entry.lastWriteHop}, now=${snapshot.analyzerHops})`);
    }
    // Designed outputs bypass the Companion's local ParamCenter and go straight
    // from their post-processing chain to OSC. They still need honest producer
    // evidence here, kept distinct from CPC writes, plus wire accounting.
    for (const key of ['micLow', 'micMid', 'micHigh', 'micFlux']) {
      const entry = snapshotByKey.get(key);
      assert.ok(entry.writes > 0, `${key} reports designed-chain production`);
      assert.ok(entry.producer.designedWrites > 0, `${key} names designed-chain writes`);
      assert.equal(entry.producer.kinds.includes('designed_chain'), true);
      assert.ok(snapshot.analyzerHops - entry.lastWriteHop <= 2,
        `${key} designed producer is recent`);
      assert.ok(entry.transport.count > 0, `${key} reports packets on its real OSC path`);
      assert.ok(entry.transport.rateHz > 0, `${key} reports a live transport rate`);
    }
  });
});

// ── ARGUMENT-PARSE REFUSALS — no isolation env, on purpose ──────────────────
// The four tests below die inside companion_server.js's CLI validation, which
// runs BEFORE `loadEffectiveAudioAnalysisConfig` (before the `--host` check, at
// module scope). They therefore never open config.yaml and never touch
// `states/`, so there is nothing for `MARSIN_CONFIG_FILE` / `MARSIN_STATE_DIR`
// to isolate — adding an env here would only imply a coupling that does not
// exist. The two production-port tests further down DO reach the config read;
// see the note there.
//
// --no-mic means "this process must not touch the show". Without --source the
// boot source falls back to config.yaml companion.source — `mic` on the rig —
// and setMode('mic') threw inside the ffmpeg-resolver `.finally()`, killing the
// process on an unhandled rejection AFTER the analyzer and servers were built.
// The combination is now refused at argument parsing, before anything binds.
test('--no-mic without --source is refused at argument parsing', async () => {
  const port = await getFreePort();
  const proc = spawn('node', [
    SERVER, '--port', String(port), '--host', '127.0.0.1',
    '--model', 'test_bench', '--no-mic',
    '--osc-port', String(await getFreePort()), '--engine-port', String(await getFreePort()),
  ], { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolve) => proc.on('exit', resolve));
  assert.notEqual(code, 0, 'the companion must refuse to boot');
  assert.match(stderr, /--no-mic requires --source test\|file/);
  // It died at arg-parse time: no HTTP server was ever bound.
  await assert.rejects(fetch(`http://127.0.0.1:${port}/catalog`));
});

// LOOPBACK IS NOT ISOLATION. The loopback interlock alone passes on the show rig,
// because config.yaml's engine endpoint is 127.0.0.1:6968 — the LIVE PRODUCTION
// ENGINE. So `--no-mic --source test` with no port flags used to boot happily and
// then POST its design manifest + PATCH the live audio config into the running
// show. Both ports must now be named explicitly on the command line.
for (const omitted of ['--osc-port', '--engine-port', 'both']) {
  test(`--no-mic --source test without ${omitted === 'both' ? 'either port flag' : omitted} is refused before anything binds`, async () => {
    const port = await getFreePort();
    const args = [
      SERVER, '--port', String(port), '--host', '127.0.0.1',
      '--model', 'test_bench', '--source', 'test', '--no-mic',
    ];
    if (omitted === '--engine-port') args.push('--osc-port', String(await getFreePort()));
    if (omitted === '--osc-port') args.push('--engine-port', String(await getFreePort()));
    const proc = spawn('node', args, {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const code = await new Promise((resolve) => proc.on('exit', resolve));
    assert.notEqual(code, 0, 'the companion must refuse to boot');
    assert.match(stderr, /--no-mic requires explicit isolated ports; missing:/);
    // The refusal NAMES the flag(s) actually missing, and only those.
    const missingLine = stderr.match(/missing: ([^\n]*)/)[1];
    if (omitted === 'both') {
      assert.equal(missingLine.trim(), '--osc-port, --engine-port');
    } else {
      assert.equal(missingLine.trim(), omitted);
    }
    // The documented bench ports are named as the fix.
    assert.match(stderr, /--osc-port 31601 --engine-port 31668/);
    // Nothing was bound: it threw at module load, before any socket.
    await assert.rejects(fetch(`http://127.0.0.1:${port}/catalog`));
  });
}

// These two reach the SECOND interlock stage, which is the only place in this
// file that reads the effective analyzer config — so they get the STATE half of
// the isolation (`isolatedStateRoot`, report `_220`) and deliberately NOT the
// config half. The subject here IS the tracked config.yaml's production
// endpoint: `targetsMatch` compares hosts, so handing the child the black-holed
// scratch config (companion.engine/osc host → TEST-NET-1) would stop the
// configured target matching the loopback effective one and the refusal this
// test exists to prove would never fire — a green run that proved nothing.
for (const target of [
  { flag: '--engine-port', productionPort: 6968, label: 'engine' },
  { flag: '--osc-port', productionPort: 10000, label: 'OSC' },
]) {
  test(`--no-mic rejects the explicit configured production ${target.label} port`, async () => {
    const port = await getFreePort();
    const otherPort = await getFreePort();
    const isolation = isolatedStateRoot(`osc_accounting_prod_${target.label}`);
    const args = [
      SERVER, '--port', String(port), '--host', '127.0.0.1',
      '--model', 'test_bench', '--source', 'test', '--no-mic',
      '--osc-port', target.flag === '--osc-port' ? String(target.productionPort) : String(otherPort),
      '--engine-port', target.flag === '--engine-port' ? String(target.productionPort) : String(otherPort),
    ];
    const proc = spawn('node', args, {
      cwd: path.join(__dirname, '..', '..'),
      env: isolation.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    try {
      const code = await new Promise((resolve) => proc.on('exit', resolve));
      assert.notEqual(code, 0, 'the companion must refuse before opening outbound links');
      assert.match(stderr, new RegExp(`matches configured production ${target.label} endpoint`, 'i'));
      await assert.rejects(fetch(`http://127.0.0.1:${port}/catalog`));
    } finally {
      isolation.cleanup();
    }
  });
}

test('a STOPPED OSC stream decays its accounting rate toward 0 (no stale-rate lie)', async () => {
  // Observability that LIES is a codex-P0 hazard: if a stream stops (a tap is
  // removed/disabled, or BPM goes silent), its last EWMA rate must NOT freeze
  // forever. We boot test mode so /marsin/mic/low streams (rate > 0), then
  // remove that signal so its packets STOP, wait past the idle cutoff, and
  // assert the accounting rate has decayed to ~0 while its count stays frozen.
  const port = await getFreePort();
  await withCompanion(port, async (ws) => {
    const addr = '/marsin/mic/low';
    let acc = await getJson(port, '/osc_accounting');
    let row = acc.outputs.find(o => o.address === addr);
    assert.ok(row && row.count > 0, `${addr} is streaming (count=${row && row.count})`);
    assert.ok(row.rateHz > 0, `${addr} reports a live rate before stop (${row.rateHz}/s)`);
    // Stop the stream: remove the 'low' signal so its tap no longer emits.
    ws.send(JSON.stringify({ type: 'removeSignal', id: 'low' }));
    // Let any in-flight analyzer hop that was already mid-send land, then snapshot
    // the now-frozen count (the removal + last packet have settled).
    await new Promise(r => setTimeout(r, 400));
    const incompleteCatalog = await getJson(port, '/catalog');
    assert.ok(incompleteCatalog.missingCuratedOutputs.includes('micLow'),
      'catalog exposes the live incomplete-design state after a curated tap is removed');
    let settled = (await getJson(port, '/osc_accounting')).outputs.find(o => o.address === addr);
    const frozenCount = settled.count;

    // Wait past the hard idle cutoff (OSC_RATE_IDLE_CUTOFF_TAUS=4 × TAU=1000ms).
    await new Promise(r => setTimeout(r, 4500));

    acc = await getJson(port, '/osc_accounting');
    row = acc.outputs.find(o => o.address === addr);
    assert.ok(row, `${addr} still accounted for after stop (defensive row)`);
    assert.equal(row.count, frozenCount, 'count is frozen after stop — no new packets sent');
    assert.equal(row.rateHz, 0, `stopped stream decays to 0 (was non-zero), got ${row.rateHz}`);
  });
});

test('every [data-theme] block defines the full companion var set', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  for (const theme of EXPECTED_THEMES) {
    // Grab the declaration block for this theme.
    const re = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, 'g');
    const blocks = [...css.matchAll(re)].map(m => m[1]).join(';');
    assert.ok(blocks.length > 0, `[data-theme="${theme}"] block exists`);
    for (const v of REQUIRED_VARS) {
      assert.ok(new RegExp(`${v}\\s*:`).test(blocks), `theme "${theme}" defines ${v}`);
    }
  }
  // The default :root must also define the full set (so a missing data-theme
  // still renders).
  const rootBlock = (css.match(/:root[^{]*\{([^}]*)\}/) || [])[1] || '';
  for (const v of REQUIRED_VARS) {
    assert.ok(new RegExp(`${v}\\s*:`).test(rootBlock), `:root defines ${v}`);
  }
});

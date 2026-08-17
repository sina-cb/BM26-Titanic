/**
 * touch_artifact_freshness.test.js — the Live Touch pixel-view artifact is
 * OWNED by the save server, not by a human remembering a manual export.
 *
 * History: docs/ui/touch_control_pixel_views.json fingerprints its inputs
 * (model, pixel_map_views.yaml, cameras.yaml, resolver sources) and the Live
 * Touch panel fails CLOSED when any live input drifts. Report 20260815_223
 * added a re-export to /save-pixel-map-views only; the operator kept hitting
 * "PIXEL VIEW UNAVAILABLE … stale against cameras.yaml" because saving a
 * camera preset (view_presets.js → /save-cameras) staled the artifact with no
 * re-export, and nothing regenerated it at boot either.
 *
 * These tests run the REAL server process (SIM_SAVE_SERVER_PORT random high
 * port, SIM_SAVE_SERVER_ROOT throwaway tree — the same harness as
 * save_server_endpoints.test.js). Under the root override the server passes
 * `--out <tmp>/touch_control_pixel_views.json` to the exporter, so this file
 * proves the exact production wiring without ever writing the tracked
 * artifact.
 *
 * Both directions are covered: staleness self-heals (boot + save triggers,
 * byte-identical to a direct exporter run), and a genuine export failure is a
 * LOUD, named WARNING on a save that still succeeds — never a silent pass,
 * never a lost operator edit.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArtifact, serializeArtifact } from '../tools/export_touch_control_pixel_views.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVE_SERVER = path.resolve(HERE, '..', 'server', 'save-server.js');
const SAVE_SERVER_SRC = fs.readFileSync(SAVE_SERVER, 'utf8');
const RUNTIME_SRC = fs.readFileSync(
  path.resolve(HERE, '..', '..', 'docs', 'ui', 'touch_control_pixel_views.js'), 'utf8');

let child = null;
let port = 0;
let tmpRoot = '';
let childExited = null;
let artifactPath = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const reserved = server.address().port;
      server.close(() => resolve(reserved));
    });
  });
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : String(body);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, agent: false,
      headers: data
        ? { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  port = await freePort();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'touch_artifact_freshness_'));
  artifactPath = path.join(tmpRoot, 'touch_control_pixel_views.json');
  fs.mkdirSync(path.join(tmpRoot, 'scenes', 'titanic'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'scenes', 'titanic', 'scene_config.yaml'),
    'modelTransform: {}\n');

  child = spawn(process.execPath, [SAVE_SERVER], {
    env: { ...process.env, SIM_SAVE_SERVER_PORT: String(port), SIM_SAVE_SERVER_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });
  child.stderr.on('data', () => {});

  await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`save-server did not report listening in 30s:\n${buffer}`)), 30_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (/listening on/.test(buffer)) { clearTimeout(timer); resolve(); }
    });
  });
});

after(() => {
  if (child && childExited === null) child.kill('SIGKILL');
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Boot-time self-heal ──────────────────────────────────────────────────

test('startup regenerates the Live Touch artifact before any save arrives', () => {
  // The `listening on` line is printed after the boot refresh, so the file
  // must already exist — this is the heal for inputs edited while the stack
  // was down (git pull, hand edit, resolver change).
  assert.ok(fs.existsSync(artifactPath),
    'boot must export the artifact into the (overridden) root');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.schemaVersion, 4);
  assert.equal(artifact.source.scene, 'titanic');
});

test('the server-exported artifact is byte-identical to a direct exporter run', () => {
  // Ownership moved, resolver did not: the save server must produce exactly
  // what `npm run pixel-views:export` produces — same single implementation.
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), serializeArtifact(buildArtifact()));
});

// ── /save-cameras heals the recurring operator trigger ──────────────────

test('/save-cameras (titanic) re-exports the artifact — camera presets no longer brick Live Touch',
  async () => {
    fs.rmSync(artifactPath);
    const reply = await request('POST', '/save-cameras?scene=titanic', 'presets: []\n');
    assert.equal(reply.status, 200);
    assert.match(reply.body, /^Saved/);
    assert.ok(!/WARNING/.test(reply.body),
      `a healthy re-export must not warn: ${reply.body}`);
    assert.ok(fs.existsSync(artifactPath),
      'saving camera presets must regenerate the artifact');
  });

test('/save-cameras for a NON-titanic scene does not touch the Titanic artifact', async () => {
  fs.rmSync(artifactPath);
  fs.mkdirSync(path.join(tmpRoot, 'scenes', 'other_scene'), { recursive: true });
  const reply = await request('POST', '/save-cameras?scene=other_scene', 'presets: []\n');
  assert.equal(reply.status, 200);
  assert.ok(!fs.existsSync(artifactPath),
    'another scene\'s cameras are not a Titanic artifact input');
});

// ── /save (views.yaml split-out) and /save-pixel-map-views triggers ─────

test('/save (titanic) re-exports the artifact — views.yaml is a resolver input', async () => {
  assert.ok(!fs.existsSync(artifactPath), 'precondition: artifact absent');
  const reply = await request('POST', '/save?scene=titanic',
    'modelTransform: {}\nviews: { groupBits: {}, custom: [] }\n');
  assert.equal(reply.status, 200);
  assert.match(reply.body, /^Saved/);
  assert.ok(fs.existsSync(artifactPath), 'a full scene save must regenerate the artifact');
});

test('/save-pixel-map-views (titanic) still re-exports through the shared helper', async () => {
  fs.rmSync(artifactPath);
  const reply = await request('POST', '/save-pixel-map-views?scene=titanic',
    JSON.stringify({ version: 1, views: [] }));
  assert.equal(reply.status, 200);
  assert.match(reply.body, /^Saved/);
  assert.ok(!/WARNING/.test(reply.body), `a healthy re-export must not warn: ${reply.body}`);
  assert.ok(fs.existsSync(artifactPath));
});

// ── Genuine breakage stays LOUD, and the save is never lost ─────────────

test('an export failure is a named WARNING with the remedy; the save itself still lands',
  async () => {
    fs.rmSync(artifactPath);
    // A directory squatting on the artifact path makes the exporter's atomic
    // rename fail — a real, local-only breakage the exporter cannot route
    // around, exactly like a corrupt scene source would fail its build step.
    fs.mkdirSync(artifactPath);
    try {
      const reply = await request('POST', '/save-cameras?scene=titanic', 'presets: [broken]\n');
      assert.equal(reply.status, 200, 'the cameras write itself must still succeed');
      assert.match(reply.body, /WARNING/, 'the failed export must be named in the response');
      assert.match(reply.body, /pixel-views:export/,
        'the warning must name the manual remedy');
      const saved = fs.readFileSync(
        path.join(tmpRoot, 'scenes', 'titanic', 'cameras.yaml'), 'utf8');
      assert.match(saved, /broken/, 'the operator\'s edit must be on disk despite the warning');
    } finally {
      fs.rmSync(artifactPath, { recursive: true, force: true });
    }
    // …and the very next save heals the artifact with no warning.
    const healed = await request('POST', '/save-cameras?scene=titanic', 'presets: []\n');
    assert.equal(healed.status, 200);
    assert.ok(!/WARNING/.test(healed.body), `heal-after-failure must not warn: ${healed.body}`);
    assert.ok(fs.existsSync(artifactPath));
    assert.equal(childExited, null, 'a failed export must never take the save server down');
  });

// ── Source pins — the wiring and the refusal copy stay honest ────────────

test('save-server keeps every refresh trigger: startup, cameras, scene, model, pixel-map',
  () => {
    for (const trigger of ["refreshTouchPixelViews('startup')",
      "refreshTouchPixelViews('save-cameras')",
      "refreshTouchPixelViews('save')",
      "refreshTouchPixelViews('save-model')",
      "refreshTouchPixelViews('save-pixel-map-views')"]) {
      assert.ok(SAVE_SERVER_SRC.includes(trigger),
        `save-server.js must keep ${trigger}`);
    }
  });

test('the panel\'s staleness refusals name the regeneration remedy, not just the symptom',
  () => {
    for (const source of ['pixel_map_views.yaml', 'cameras.yaml', 'the simulation resolver']) {
      assert.ok(RUNTIME_SRC.includes(`pixel-view artifact is stale against ${source}`),
        `runtime must still refuse stale ${source}`);
    }
    assert.match(RUNTIME_SRC, /REGEN_HINT/,
      'stale refusals must carry the regeneration hint');
    assert.match(RUNTIME_SRC, /npm run pixel-views:export/,
      'the refusal copy must name the manual export command');
  });

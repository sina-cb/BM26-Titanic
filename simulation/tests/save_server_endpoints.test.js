/**
 * save_server_endpoints.test.js — HTTP-level coverage for save-server.js
 * endpoints beyond `/save` and `/controllers/probe` (catalog 20260805_161
 * gap G7, rank 8, size L): `/create-scene`, `/delete-scene`, `/backups`,
 * `/restore-backup`, `/list-scenes`, and `/save-cameras`'s silent-default
 * scene-name fallback.
 *
 * Runs against the REAL server process (H-B: `SIM_SAVE_SERVER_PORT` on a
 * random high port, `SIM_SAVE_SERVER_ROOT` on a throwaway temp dir) — same
 * harness `save_server_hardening.test.js` already uses, extended here to
 * endpoints that harness never touched.
 *
 * SCOPE NOTE (recorded for the reviewer): the catalog spec for this gap also
 * asked for `/save-pattern`, `/delete-pattern` and `/list-patterns`
 * coverage, including a `/delete-pattern` traversal probe. Deliberately NOT
 * implemented here: those three endpoints resolve their target directory as
 * `path.join(SIM_ROOT, '..', 'marsin_engine', 'patterns')`
 * (`save-server.js` `ENGINE_ROOT`), and `SIM_SAVE_SERVER_ROOT` only
 * substitutes for `SIM_ROOT` — so with the test-only root override in
 * effect, `ENGINE_ROOT` resolves to `<the OS temp dir>/marsin_engine`, ONE
 * LEVEL ABOVE the per-test unique tmp dir, not inside it. That path is
 * shared across every test run on the machine (not unique per
 * `mkdtempSync()` call), so writing/deleting real files there from a test
 * risks colliding with a concurrent test run in this actively multi-agent
 * repo. This is itself worth flagging to the fix-plan reviewer as a test-hook
 * isolation gap (`SIM_SAVE_SERVER_ROOT` should also redirect `ENGINE_ROOT`,
 * or the endpoints should read pattern paths through a hook of their own) —
 * not something to route around by writing to shared OS temp space anyway.
 *
 * `/delete-pattern`'s specific traversal shape IS worth one held finding for
 * the record even so: `safeName = name.replace(/[^a-z0-9_-]/gi, '_')`
 * replaces `.`, `/` and `\` alike, so a `../sentinel`-shaped name collapses
 * to a harmless same-directory filename (`___sentinel.js`) — the endpoint
 * looks safe by construction, not merely untested. Left for `_162`/a
 * follow-up to confirm with a properly isolated `ENGINE_ROOT`.
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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const SAVE_SERVER = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'server', 'save-server.js');

let child = null;
let port = 0;
let tmpRoot = '';
let childExited = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body));
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, agent: false,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (err) => done(reject, err));
    if (data) req.write(data);
    req.end();
  });
}

const SEED_SCENE = 'g7_seed';

before(async () => {
  port = await freePort();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saveserver_endpoints_'));
  fs.mkdirSync(path.join(tmpRoot, 'scenes', SEED_SCENE), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'scenes', SEED_SCENE, 'scene_config.yaml'), 'modelTransform: {}\n');

  child = spawn(process.execPath, [SAVE_SERVER], {
    env: { ...process.env, SIM_SAVE_SERVER_PORT: String(port), SIM_SAVE_SERVER_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });
  child.stderr.on('data', () => {});

  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('save-server did not report listening in 10s')), 10_000);
    child.stdout.on('data', (d) => { buf += d.toString(); if (/listening on/.test(buf)) { clearTimeout(to); resolve(); } });
  });
});

after(() => {
  if (child && childExited === null) child.kill('SIGKILL');
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── /create-scene ────────────────────────────────────────────────────────

test('G7: /create-scene refuses an invalid name (400), never touches disk', async () => {
  for (const bad of ['../evil', '', 'has spaces', '.dotstart']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await request('POST', '/create-scene', { name: bad });
    assert.equal(r.status, 400, `name ${JSON.stringify(bad)} must be refused`);
    assert.match(r.body, /Invalid scene name/);
  }
  assert.equal(childExited, null);
});

test('G7: /create-scene happy path creates a scene dir + seeds scene_config.yaml; /list-scenes sees it',
  async () => {
    const r = await request('POST', '/create-scene', { name: 'g7_created' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { scene: 'g7_created' });
    const cfgPath = path.join(tmpRoot, 'scenes', 'g7_created', 'scene_config.yaml');
    assert.ok(fs.existsSync(cfgPath));
    assert.doesNotThrow(() => yaml.load(fs.readFileSync(cfgPath, 'utf8')));

    const listed = await request('GET', '/list-scenes');
    assert.equal(listed.status, 200);
    assert.ok(JSON.parse(listed.body).includes('g7_created'));
  });

test('G7: /create-scene on an EXISTING name is a named 409, never silently overwrites', async () => {
  const r = await request('POST', '/create-scene', { name: 'g7_created' });
  assert.equal(r.status, 409);
  assert.match(r.body, /already exists/);
});

// ── /delete-scene ────────────────────────────────────────────────────────

test('G7: /delete-scene refuses an invalid name (400)', async () => {
  const r = await request('POST', '/delete-scene', { name: '../etc' });
  assert.equal(r.status, 400);
});

test('G7: /delete-scene on a NON-existent (but well-formed) name is a named 404', async () => {
  const r = await request('POST', '/delete-scene', { name: 'g7_never_existed' });
  assert.equal(r.status, 404);
  assert.match(r.body, /Not found/);
});

test('G7: /delete-scene removes exactly the named scene, leaving a sibling untouched', async () => {
  await request('POST', '/create-scene', { name: 'g7_sibling' });
  const r = await request('POST', '/delete-scene', { name: 'g7_created' });
  assert.equal(r.status, 200);
  assert.match(r.body, /Deleted/);
  assert.equal(fs.existsSync(path.join(tmpRoot, 'scenes', 'g7_created')), false);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'scenes', 'g7_sibling', 'scene_config.yaml')),
    'deleting one scene must not touch another');
});

// ── /save-cameras + /backups + /restore-backup HTTP glue ────────────────

test('G7: /save-cameras writes a parseable YAML file for the seeded scene', async () => {
  const r = await request('POST', `/save-cameras?scene=${SEED_SCENE}`, 'camera: { x: 1 }\n');
  assert.equal(r.status, 200);
  assert.match(r.body, /Saved/);
  const camerasPath = path.join(tmpRoot, 'scenes', SEED_SCENE, 'cameras.yaml');
  const parsed = yaml.load(fs.readFileSync(camerasPath, 'utf8'));
  assert.deepEqual(parsed, { camera: { x: 1 } });
});

test('G7: /backups + /restore-backup — a second save backs up the first; restoring rolls it back',
  async () => {
    // NOTE: `snapshotBeforeWrite` writes a manifest (possibly with an EMPTY
    // `files[]`) on every call, even when nothing existed yet to back up, and
    // COALESCES into the same dir for 10s (`COALESCE_WINDOW_MS`) — so the
    // FIRST /save-cameras call above already created one backup ENTRY (with
    // no files), and this second call is very likely to coalesce into that
    // SAME entry rather than open a new one. The count is therefore not a
    // reliable signal here; what matters is that SOME backup now carries
    // cameras.yaml with the pre-overwrite (x:1) content.
    const r2 = await request('POST', `/save-cameras?scene=${SEED_SCENE}`, 'camera: { x: 2 }\n');
    assert.equal(r2.status, 200);

    const backupsReply = await request('GET', `/backups?scene=${SEED_SCENE}`);
    assert.equal(backupsReply.status, 200);
    const backups = JSON.parse(backupsReply.body);
    assert.ok(backups.length >= 1, 'the overwrite must have taken at least one backup');
    const withCameras = backups.find((b) => b.files.some((f) => f.endsWith('cameras.yaml')));
    assert.ok(withCameras, 'some backup entry must carry the pre-overwrite cameras.yaml');
    const newestId = withCameras.id;

    const restoreReply = await request('POST', `/restore-backup?scene=${SEED_SCENE}`, { id: newestId });
    assert.equal(restoreReply.status, 200);
    const result = JSON.parse(restoreReply.body);
    assert.ok(result.restored.includes('cameras.yaml') || result.restored.some((f) => f.endsWith('cameras.yaml')));

    const restoredContent = yaml.load(
      fs.readFileSync(path.join(tmpRoot, 'scenes', SEED_SCENE, 'cameras.yaml'), 'utf8'));
    assert.deepEqual(restoredContent, { camera: { x: 1 } },
      'restoring must roll the live file back to the backed-up (pre-overwrite) content');
  });

test('G7: /restore-backup with a syntactically-invalid id is a named 400; a well-formed but ' +
  'unknown id is a named 404 — never a bare 500 stack', async () => {
  const badSyntax = await request('POST', `/restore-backup?scene=${SEED_SCENE}`, { id: '../etc' });
  assert.equal(badSyntax.status, 400);
  assert.match(badSyntax.body, /Invalid backup id/);

  const wellFormedUnknown = await request('POST', `/restore-backup?scene=${SEED_SCENE}`,
    { id: '20200101_000000_000' });
  assert.equal(wellFormedUnknown.status, 404);
  assert.match(wellFormedUnknown.body, /Backup not found/);
  assert.equal(childExited, null, 'a bad restore must never take the process down');
});

// ── Silent-default characterization [P0-tension] ─────────────────────────

test('G7 [P0-tension]: /save-cameras with NO scene param defaults to "titanic" — pinned, not blessed',
  async () => {
    // `resolveSceneCamerasPath` does `(sceneName || 'titanic')`. This tmpRoot
    // has no titanic scene at all, so the write lands at
    // scenes/titanic/cameras.yaml, silently CREATING a scene directory the
    // operator never asked for, rather than refusing "no scene specified".
    // This is a defect candidate for the `_157`/fix-plan review, not a
    // behavior this test endorses — it exists so a fix changes this
    // assertion, not accidentally leaves the silent default in place.
    const r = await request('POST', '/save-cameras', 'camera: { x: 9 }\n'); // no ?scene=
    assert.equal(r.status, 200, '[P0-tension] a missing scene name is NOT refused — it silently ' +
      'succeeds against a fallback scene name');
    const fellBackTo = path.join(tmpRoot, 'scenes', 'titanic', 'cameras.yaml');
    assert.ok(fs.existsSync(fellBackTo),
      '[P0-tension] the write landed at scenes/titanic/ — a scene the operator never named, ' +
      'silently created by this request');
  });

/**
 * view_mask_persistence_roundtrip.test.js — patches.yaml carries BOTH view
 * words honestly across save → load → save cycles (views-bulletproofing
 * sweep, report 20260725_141, open finding _138 §8.2).
 *
 * `viewMaskHi` is deliberately asymmetric on disk: written only when
 * non-zero (so every existing scene's patches.yaml stays byte-identical),
 * while `viewMask` is always written. These regressions prove the asymmetry
 * cannot bite across the playa lifecycle:
 *
 *   1. a word-1 membership SAVES into the fixture's patch record,
 *   2. the record merges back onto a config exactly (the applyPatches
 *      Object.assign contract),
 *   3. deleting the view (mask back to 0) makes the stale `viewMaskHi` key
 *      DISAPPEAR from patches.yaml on the next save — no ghost field,
 *   4. both words are scrubbed from the structural scene_config.yaml
 *      unconditionally.
 *
 * Runs the REAL save-server on a random high port with a throwaway temp
 * root (the SIM_SAVE_SERVER_PORT / SIM_SAVE_SERVER_ROOT test hooks from
 * report 20260725_119) — never the operator's :6970, never the real scenes/.
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

import yaml from 'js-yaml';

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
    const data = body === undefined ? undefined : String(body);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false,
      headers: data ? { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data) } : {} },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  port = await freePort();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'viewmask_roundtrip_'));
  fs.mkdirSync(path.join(tmpRoot, 'scenes'), { recursive: true });
  child = spawn(process.execPath, [SAVE_SERVER], {
    env: { ...process.env, SIM_SAVE_SERVER_PORT: String(port), SIM_SAVE_SERVER_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });
  child.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('save-server did not report listening in 10 s')), 10_000);
    child.stdout.on('data', (d) => { buf += d.toString(); if (/listening on/.test(buf)) { clearTimeout(to); resolve(); } });
  });
});

after(() => {
  if (child && childExited === null) child.kill('SIGKILL');
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const SCENE = 'roundtrip';
const patchesPath = () => path.join(tmpRoot, 'scenes', SCENE, 'patches.yaml');
const configPath = () => path.join(tmpRoot, 'scenes', SCENE, 'scene_config.yaml');

// The config tree the CLIENT posts: one DMX fixture carrying both words —
// exactly what exportConfig serializes after a Views-panel assign.
function tree(fixture) {
  return yaml.dump({
    parLights: { fixtures: [fixture] },
    views: { groupBits: { Bars: 0x1 }, custom: [{ name: 'Clicked', bit: 0x2, word: 1, groups: [] }] },
  }, { lineWidth: -1 });
}

const FIXTURE = {
  name: 'Bar 1', group: 'Bars', fixtureType: 'ShehdsBar',
  controllerIp: '10.0.0.1', dmxUniverse: 3, dmxAddress: 10,
  controllerId: 7, sectionId: 2, fixtureId: 4,
  viewMask: 0x1, viewMaskHi: 0x2,
};

test('save 1: a word-1 membership lands in the patch record; both words leave the structural tree', async () => {
  const r = await request('POST', `/save?scene=${SCENE}`, tree(FIXTURE));
  assert.equal(r.status, 200, r.body);

  const patches = yaml.load(fs.readFileSync(patchesPath(), 'utf8')).patches;
  assert.deepEqual(patches['Bar 1'], {
    controllerIp: '10.0.0.1', dmxUniverse: 3, dmxAddress: 10, controllerId: 7,
    sectionId: 2, fixtureId: 4, viewMask: 0x1, viewMaskHi: 0x2,
  });

  const cfg = yaml.load(fs.readFileSync(configPath(), 'utf8'));
  const structural = cfg.parLights.fixtures[0];
  assert.equal('viewMask' in structural, false, 'viewMask scrubbed from the structural tree');
  assert.equal('viewMaskHi' in structural, false, 'viewMaskHi scrubbed from the structural tree');
});

test('the record merges back onto a config exactly (the applyPatches contract)', () => {
  // main.js applyPatches: Object.assign(fixture, patchTree[fixture.name]).
  const patches = yaml.load(fs.readFileSync(patchesPath(), 'utf8')).patches;
  const loaded = { name: 'Bar 1', group: 'Bars' };
  Object.assign(loaded, patches['Bar 1']);
  assert.equal(loaded.viewMask, 0x1);
  assert.equal(loaded.viewMaskHi, 0x2);
});

test('save 2: view deleted (mask 0) — the stale viewMaskHi key DISAPPEARS from patches.yaml', async () => {
  const r = await request('POST', `/save?scene=${SCENE}`,
    tree({ ...FIXTURE, viewMaskHi: 0 }));
  assert.equal(r.status, 200, r.body);

  const raw = fs.readFileSync(patchesPath(), 'utf8');
  assert.ok(!raw.includes('viewMaskHi'),
    'a zero high word must leave NO key behind — absent IS the declared default');
  const patches = yaml.load(raw).patches;
  assert.equal(patches['Bar 1'].viewMask, 0x1, 'the low word still round-trips');
  assert.equal('viewMaskHi' in patches['Bar 1'], false);
  // Reload semantics: an absent key merges onto the seeded-zero default.
  const loaded = { name: 'Bar 1', viewMask: 0, viewMaskHi: 0 };
  Object.assign(loaded, patches['Bar 1']);
  assert.equal(loaded.viewMaskHi, 0, 'no resurrected membership');
});

test('save 3: byte-stability — re-saving the same zero-hi tree changes nothing', async () => {
  const before = fs.readFileSync(patchesPath(), 'utf8');
  const r = await request('POST', `/save?scene=${SCENE}`,
    tree({ ...FIXTURE, viewMaskHi: 0 }));
  assert.equal(r.status, 200, r.body);
  assert.equal(fs.readFileSync(patchesPath(), 'utf8'), before,
    'an identical save must be byte-identical (no churn from the conditional key)');
});

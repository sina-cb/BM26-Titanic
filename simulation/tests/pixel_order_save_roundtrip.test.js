/**
 * pixel_order_save_roundtrip.test.js — Mechanism A's `pixelOrder` store over
 * the REAL wire: POST `/save` to a real `save-server.js` process and read the
 * file it wrote (design contract 20260806_174 §5.4 row 11).
 *
 * WHY THIS EXISTS. Slice 1 (`_175`) proved the client half of the round trip
 * (`reconstructYAML` → YAML → `extractParams`) and asserted STRUCTURALLY that
 * the save server strips only per-fixture / per-strand keys and never mentions
 * `pixelOrder`. What it could not do was run the server, because that binds a
 * port. This closes it: the server is spawned on a FREE EPHEMERAL PORT
 * (`SIM_SAVE_SERVER_PORT`, discovered by binding :0 and releasing it — never the
 * operator's save port) with `SIM_SAVE_SERVER_ROOT` pointed at a throwaway tree
 * under `~/tmp/fix_177/`, so nothing this file does can reach the real
 * `simulation/scenes/`. Same harness shape as `save_server_endpoints.test.js`.
 *
 * WHAT IT PROVES. `/save` rewrites the config tree substantially — it splits
 * patch records out of the fixture arrays into `patches.yaml` and strips the
 * DMX keys from the structural tree. A top-level, name-keyed map has to survive
 * that rewrite untouched, key for key and value for value, or the flag would
 * silently evaporate on the next save and the operator would re-verify pixel
 * order forever. The negative half matters just as much: a save with no
 * `pixelOrder` must not INVENT one.
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

const SAVE_SERVER = path.resolve(fileURLToPath(import.meta.url), '..', '..',
  'server', 'save-server.js');

/** Scratch only — `~/tmp/` is gitignored and the agent brief's only write area. */
const SCRATCH = path.join(os.homedir(), 'tmp', 'fix_177', 'save_roundtrip', String(process.pid));

const SCENE = 'pixel_order_roundtrip';

let child = null;
let port = 0;
let childExited = null;

/**
 * The ports the OPERATOR owns on this machine: the sim stack (:6966-:6972),
 * sACN (:5568), Metro (:8081) and the engine's control surface (:10000). A test
 * that landed on one of these would fight a live show stack.
 */
const OPERATOR_PORTS = new Set([6966, 6967, 6968, 6969, 6970, 6971, 6972, 5568, 8081, 10000]);

/** Bind :0, read the port the OS handed out, release it. Never a fixed port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => {
        // Stated rather than assumed: the OS ephemeral range does not overlap
        // the operator's ports, and if it ever did we refuse instead of binding.
        if (OPERATOR_PORTS.has(p)) {
          reject(new Error(`the OS handed out operator-owned port ${p} — refusing to bind it`));
          return;
        }
        resolve(p);
      });
    });
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
      headers: data
        ? { 'Content-Type': 'text/yaml', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve,
        { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (err) => done(reject, err));
    if (data) req.write(data);
    req.end();
  });
}

const sceneFile = (name) => path.join(SCRATCH, 'scenes', SCENE, name);

/** The tree the sim client POSTs: structural scene + fixtures carrying patches. */
function configTree(pixelOrder) {
  const tree = {
    modelTransform: {},
    dmxLights: [
      { name: 'Bar Left', type: 'ShehdsBar', group: 'Bars', fixtureId: 7,
        controllerIp: '127.0.0.1', controllerId: 1, dmxUniverse: 2, dmxAddress: 107 },
      { name: 'Bar Right', type: 'ShehdsBar', group: 'Bars', fixtureId: 8,
        controllerIp: '127.0.0.1', controllerId: 1, dmxUniverse: 2, dmxAddress: 226 },
    ],
  };
  if (pixelOrder !== undefined) tree.pixelOrder = pixelOrder;
  return yaml.dump(tree, { lineWidth: -1 });
}

before(async () => {
  port = await freePort();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SCRATCH, 'scenes', SCENE), { recursive: true });
  fs.writeFileSync(sceneFile('scene_config.yaml'), 'modelTransform: {}\n');

  child = spawn(process.execPath, [SAVE_SERVER], {
    env: { ...process.env, SIM_SAVE_SERVER_PORT: String(port), SIM_SAVE_SERVER_ROOT: SCRATCH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });
  child.stderr.on('data', () => {});

  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(
      () => reject(new Error('save-server did not report listening in 10s')), 10_000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (/listening on/.test(buf)) { clearTimeout(to); resolve(); }
    });
  });
});

after(() => {
  if (child && childExited === null) child.kill('SIGKILL');
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

test('_177 §5.4-11: `pixelOrder` survives a REAL POST /save, key for key and value for value',
  async () => {
    const store = { 'Bar Left': 'reversed', 'Bar Right': 'reversed' };
    const res = await request('POST', `/save?scene=${SCENE}`, configTree(store));
    assert.equal(res.status, 200, res.body);

    const written = yaml.load(fs.readFileSync(sceneFile('scene_config.yaml'), 'utf8'));
    assert.deepEqual(written.pixelOrder, store,
      'a top-level name-keyed map must pass through the save split untouched');

    // The save really did rewrite the tree — so the survival above is not the
    // trivial "nothing happened" case.
    assert.equal(written.dmxLights.length, 2);
    for (const fixture of written.dmxLights) {
      for (const stripped of ['controllerIp', 'controllerId', 'dmxUniverse', 'dmxAddress']) {
        assert.equal(fixture[stripped], undefined,
          `${stripped} must have been split out of the structural tree`);
      }
    }
    const patches = yaml.load(fs.readFileSync(sceneFile('patches.yaml'), 'utf8'));
    assert.equal(patches.patches['Bar Left'].dmxAddress, 107);
    assert.equal(patches.patches['Bar Right'].dmxAddress, 226);
    // And the store did NOT leak into the patch file — one home, not two.
    assert.equal(patches.pixelOrder, undefined);
    assert.equal(patches.patches.pixelOrder, undefined);
  });

test('_177 §5.4-11: the fixture NAME is the key — spaces and case survive verbatim', async () => {
  // The store is keyed by the only identity a generated fixture has. A YAML
  // round trip that quoted, trimmed, lower-cased or re-ordered those keys would
  // orphan every flag on the next boot.
  const store = { 'Left Front Wall 1': 'reversed', 'Left Front Wall 10': 'normal' };
  const res = await request('POST', `/save?scene=${SCENE}`, configTree(store));
  assert.equal(res.status, 200, res.body);
  const written = yaml.load(fs.readFileSync(sceneFile('scene_config.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(written.pixelOrder), ['Left Front Wall 1', 'Left Front Wall 10']);
  assert.deepEqual(written.pixelOrder, store);
});

test('_177 §5.4-11: a save with an EMPTY store keeps an empty one, and no store invents nothing',
  async () => {
    let res = await request('POST', `/save?scene=${SCENE}`, configTree({}));
    assert.equal(res.status, 200, res.body);
    let written = yaml.load(fs.readFileSync(sceneFile('scene_config.yaml'), 'utf8'));
    assert.deepEqual(written.pixelOrder, {});

    res = await request('POST', `/save?scene=${SCENE}`, configTree(undefined));
    assert.equal(res.status, 200, res.body);
    written = yaml.load(fs.readFileSync(sceneFile('scene_config.yaml'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(written, 'pixelOrder'), false,
      'the save server must never invent a store the client did not send');
  });

test('_177: this test never wrote outside its scratch root', () => {
  // The guarantee is the injected root, stated as an assertion so a future edit
  // that drops `SIM_SAVE_SERVER_ROOT` fails here rather than in a byte-identity
  // manifest three steps later.
  const real = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'scenes');
  assert.equal(path.relative(SCRATCH, real).startsWith('..'), true);
  assert.equal(fs.existsSync(path.join(real, SCENE)), false,
    'the throwaway scene must not exist under the repo\'s real scenes directory');
});

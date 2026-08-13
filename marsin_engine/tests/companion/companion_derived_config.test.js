import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { WebSocket } from 'ws';

import { loadEffectiveAudioAnalysisConfig } from '../../audio/config/audio_analysis_config.js';
import { loadSceneAudio } from '../../audio/config/audio_config_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ENGINE_DIR, 'audio', 'companion', 'companion_server.js');

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

async function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/catalog`);
      if (response.ok) return;
    } catch { /* process is still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`companion did not boot on port ${port}`);
}

function waitForMessage(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    const listener = (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.off('message', listener);
      resolve(message);
    };
    ws.on('message', listener);
  });
}

test('Companion derived config protocol hot-applies valid patches and rejects invalid ones', async () => {
  const port = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  let stderr = '';
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26-companion-derived-'));
  const stateDir = path.join(stateRoot, 'test_bench');
  fs.mkdirSync(stateDir);
  fs.copyFileSync(
    path.join(ENGINE_DIR, 'states', 'test_bench', 'audio_state.yaml'),
    path.join(stateDir, 'audio_state.yaml'),
  );
  // Snapshot: the Companion must leave this file byte-for-byte alone.
  const stateFileBefore = fs.readFileSync(path.join(stateDir, 'audio_state.yaml'), 'utf8');
  const rootAudioConfig = yaml.load(
    fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8'),
  ).audio;
  const processHandle = spawn('node', [
    SERVER,
    '--port', String(port),
    '--model', 'test_bench',
    '--host', '127.0.0.1',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], {
    cwd: ENGINE_DIR,
    env: { ...process.env, MARSIN_STATE_DIR: stateRoot },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  processHandle.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer(port);
    assert.equal(processHandle.exitCode, null, stderr);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const helloPromise = waitForMessage(ws, (message) => message.type === 'hello');
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const hello = await helloPromise;
    const original = hello.derivedConfig.trackChange.silenceConfirmMs;

    const changedPromise = waitForMessage(
      ws,
      (message) => message.type === 'derivedConfig'
        && message.config.trackChange.silenceConfirmMs === original + 100,
    );
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { silenceConfirmMs: original + 100 },
    }));
    const changed = await changedPromise;
    assert.equal(changed.config.trackChange.silenceConfirmMs, original + 100);

    const noteColorPromise = waitForMessage(
      ws,
      (message) => message.type === 'derivedConfig'
        && message.config.noteColors.a === 0.5,
    );
    const offlineNotePromise = waitForMessage(
      ws,
      (message) => message.type === 'engineLink' && message.connected === false
        && typeof message.note === 'string' && message.note.includes('noteColors'),
    );
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'noteColors',
      patch: { a: 0.5 },
    }));
    const noteColor = await noteColorPromise;
    assert.equal(noteColor.config.noteColors.a, 0.5);

    // SINGLE WRITER: the ENGINE owns audio_state.yaml. The Companion applies
    // the edit to its live modules and writes it THROUGH via PATCH — it must
    // not do its own load → merge → save on the same file (that was a
    // lost-update race against the engine doing exactly the same thing).
    assert.equal(
      fs.readFileSync(path.join(stateDir, 'audio_state.yaml'), 'utf8'),
      stateFileBefore,
      'the Companion must not write the scene state file',
    );
    assert.equal(
      loadSceneAudio(stateDir).derivedSignals,
      undefined,
      'nothing was live-patched through the engine, so nothing is persisted',
    );
    const previousStateRoot = process.env.MARSIN_STATE_DIR;
    try {
      process.env.MARSIN_STATE_DIR = stateRoot;
      assert.equal(
        loadEffectiveAudioAnalysisConfig({ engineDir: ENGINE_DIR, modelName: 'test_bench' })
          .audioConfig.derivedSignals.noteColors.a,
        rootAudioConfig.derivedSignals.noteColors.a,
        'with no engine to persist through, the next boot still resolves config.yaml',
      );
    } finally {
      if (previousStateRoot === undefined) delete process.env.MARSIN_STATE_DIR;
      else process.env.MARSIN_STATE_DIR = previousStateRoot;
    }

    // …and the operator is TOLD the edit is local-only, so a divergence that
    // will vanish on the next boot can't hide (it is parked for replay when
    // the engine link comes up).
    await offlineNotePromise;

    const resetPromise = waitForMessage(
      ws,
      (message) => message.type === 'derivedConfig'
        && message.config.noteColors.a === hello.derivedConfig.noteColors.a,
    );
    const resetFlashPromise = waitForMessage(
      ws,
      (message) => message.type === 'flash'
        && message.text === 'All note colors reset to the reference wheel',
    );
    ws.send(JSON.stringify({ type: 'resetDerivedConfig', group: 'noteColors' }));
    const reset = await resetPromise;
    assert.deepEqual(reset.config.noteColors, hello.derivedConfig.noteColors);
    assert.equal(
      fs.readFileSync(path.join(stateDir, 'audio_state.yaml'), 'utf8'),
      stateFileBefore,
      'the reset is written through to the engine too, never to disk here',
    );
    await resetFlashPromise;

    const errorPromise = waitForMessage(
      ws,
      (message) => message.type === 'flash' && message.error === true,
    );
    const echoPromise = waitForMessage(
      ws,
      (message) => message.type === 'derivedConfig'
        && message.config.trackChange.silenceConfirmMs === original + 100,
    );
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { offThresh: 0.9 },
    }));
    const error = await errorPromise;
    assert.match(error.text, /offThresh < onThresh/);
    await echoPromise;

    const hueErrorPromise = waitForMessage(
      ws,
      (message) => message.type === 'flash' && message.error === true,
    );
    const hueEchoPromise = waitForMessage(
      ws,
      (message) => message.type === 'derivedConfig'
        && message.config.noteColors.a === hello.derivedConfig.noteColors.a,
    );
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'noteColors',
      patch: { a: 1 },
    }));
    const hueError = await hueErrorPromise;
    assert.match(hueError.text, /noteColors\.a must be in \[0, 1\)/);
    await hueEchoPromise;
    ws.close();
  } finally {
    processHandle.kill('SIGKILL');
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

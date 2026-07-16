// HIL dispatcher — list / run-one / run-all the HIL harnesses against a booted
// test_bench engine. Honors the shared guard (refuses a non-test_bench target,
// exit 2) and returns nonzero on the FIRST failing harness (no fallback).
//
// Prerequisite for `run` / `run-all`: an engine running the DISPOSABLE
// `test_bench` model (never a live scene). Start one on a spare port:
//   node engine.js --pattern test_const --model test_bench --port 7180
//
// Usage:
//   node tests/hil/run_hil.mjs list                 # inventory (no engine)
//   node tests/hil/run_hil.mjs run <name> [--port N] # one harness
//   node tests/hil/run_hil.mjs run-all [--port N]    # every harness (default)
//
// `<name>` accepts the bare stem or the full file (e.g. `hil_tap_tempo_test` or
// `hil_tap_tempo_test.mjs`). Port resolves via --port → ENGINE_PORT → 6968.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDisposableEngine } from './hil_guard.mjs';
import { parseHilPort, engineBase } from './hil_client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function listHarnesses() {
  return fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('_test.mjs'))
    .sort();
}

function runOne(file, port) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(__dirname, file), '--port', String(port)], {
      stdio: 'inherit',
      // Cover the harnesses' drifted port readers (--port / ENGINE_PORT /
      // MARSIN_HIL_PORT) so every one targets the same disposable engine.
      env: { ...process.env, ENGINE_PORT: String(port), MARSIN_HIL_PORT: String(port) },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'run-all';
  const port = parseHilPort(6968);

  if (cmd === 'list') {
    const harnesses = listHarnesses();
    for (const f of harnesses) console.log(f);
    console.error(`\n${harnesses.length} HIL harnesses.`);
    return 0;
  }

  if (cmd !== 'run' && cmd !== 'run-all') {
    console.error(`unknown command '${cmd}'. Use: list | run <name> [--port N] | run-all [--port N]`);
    return 1;
  }

  // Both run modes MUTATE engine state — pre-flight the guard once (fail fast,
  // exit 2 on a wrong/unreachable target) before spawning any harness.
  await assertDisposableEngine(engineBase(port));

  if (cmd === 'run') {
    const name = argv[1];
    if (!name) {
      console.error('usage: run_hil.mjs run <name> [--port N]');
      return 1;
    }
    const file = name.endsWith('.mjs') ? name : `${name}.mjs`;
    if (!listHarnesses().includes(file)) {
      console.error(`unknown harness '${name}'. Try: node tests/hil/run_hil.mjs list`);
      return 1;
    }
    return await runOne(file, port);
  }

  // run-all
  const harnesses = listHarnesses();
  for (let i = 0; i < harnesses.length; i++) {
    const f = harnesses[i];
    console.log(`\n── [${i + 1}/${harnesses.length}] ${f} ──────────────────────────────`);
    const code = await runOne(f, port);
    if (code !== 0) {
      console.error(`\nFAIL: ${f} exited ${code}. Stopping (nonzero on first fail).`);
      return code;
    }
  }
  console.log(`\nAll ${harnesses.length} HIL harnesses passed.`);
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e);
  process.exit(1);
});

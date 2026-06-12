#!/usr/bin/env node
/**
 * promote_state — headless wrapper around the engine's /state routes.
 *
 * Talks to a RUNNING engine (so debounced saves get flushed before the
 * copy — never copies files itself). For the offline case (engine not
 * running) there is deliberately no fallback: start the engine or copy
 * by hand with eyes open.
 *
 * Usage:
 *   node tools/promote_state.mjs                  # status (runtime vs defaults)
 *   node tools/promote_state.mjs --promote        # runtime → state_defaults/
 *   node tools/promote_state.mjs --reset          # state_defaults/ → runtime
 *   node tools/promote_state.mjs --url http://10.1.1.20:6968 --promote
 */

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const base = urlIdx !== -1 ? args[urlIdx + 1] : 'http://127.0.0.1:6968';
const doPromote = args.includes('--promote');
const doReset = args.includes('--reset');

if (doPromote && doReset) {
  console.error('Pick ONE of --promote / --reset.');
  process.exit(1);
}

async function call(method, route) {
  const res = await fetch(`${base}${route}`, { method });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${body.error || JSON.stringify(body)}`);
  }
  return body;
}

try {
  if (doPromote) {
    const r = await call('POST', '/state/promote');
    console.log(`Promoted runtime → state_defaults/${r.model}/`);
    for (const f of r.written) console.log(`  written: ${f}`);
    for (const f of r.removed) console.log(`  removed: ${f}`);
    if (r.written.length === 0 && r.removed.length === 0) {
      console.log('  (defaults already match the runtime — nothing to do)');
    } else {
      console.log('Review with `git diff -- marsin_engine/state_defaults` and commit when happy.');
    }
  } else if (doReset) {
    const r = await call('POST', '/state/reset');
    console.log(`Reset runtime ← state_defaults/${r.model}/`);
    for (const f of r.written) console.log(`  written: ${f}`);
    for (const f of r.removed) console.log(`  removed: ${f}`);
    console.log('⚠️  Restart the engine to load the reset state.');
  } else {
    const r = await call('GET', '/state/runtime');
    console.log(`Runtime state for model '${r.model}': ${r.dirty ? 'DIFFERS from defaults' : 'matches defaults'}`);
    for (const f of r.files) {
      const tag = f.differs ? 'differs'
        : !f.inDefaults ? 'runtime-only'
        : !f.inRuntime ? 'defaults-only'
        : 'same';
      console.log(`  ${tag.padEnd(13)} ${f.file}`);
    }
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  console.error(`   Is the engine running at ${base}?`);
  process.exit(1);
}

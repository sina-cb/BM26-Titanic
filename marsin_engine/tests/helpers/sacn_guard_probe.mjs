// sacn_guard_probe.mjs — prints the sACN block the global test config guard
// hands every spawned engine, as one line of JSON on stdout.
//
// This is the evidence procedure from report `_361` §2.1, promoted to a
// tracked file so the regression test in `tests/io/config_guard_sacn_wall.test.mjs`
// can run it in a child process (the guard only builds a scratch config when
// MARSIN_CONFIG_FILE is UNSET, which is the fresh-`npm test` path and cannot be
// observed from inside an already-guarded process).
//
// Run it by hand any time:
//   cd marsin_engine
//   node --import ./tests/helpers/setup_config_guard.mjs tests/helpers/sacn_guard_probe.mjs
//
// Not a `*.test.*` module, so no runner picks it up.
import fs from 'node:fs';

import yaml from 'js-yaml';

const configFile = process.env.MARSIN_CONFIG_FILE;
if (!configFile) {
  throw new Error('sacn_guard_probe: MARSIN_CONFIG_FILE is unset — the config guard did not run. '
    + 'Load it with `node --import ./tests/helpers/setup_config_guard.mjs`.');
}
const parsed = yaml.load(fs.readFileSync(configFile, 'utf8'));
if (!parsed || typeof parsed !== 'object') {
  throw new Error(`sacn_guard_probe: could not parse ${configFile}`);
}
process.stdout.write(JSON.stringify({ configFile, sacn: parsed.sacn ?? null }) + '\n');

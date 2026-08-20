// BOOT MODE TOGGLE (report _236) — the persisted "start in edit or performance"
// preference, against a REAL engine subprocess.
//
// Operator order: "in the config, add a new config toggle to go straight to edit
// mode or performance mode, and make sure that's stored as part of the state
// persisted".
//
// What this suite proves:
//
//   1. an auth-required engine still boots LOCKED by default (docs/56 D1 is
//      unchanged when nobody has touched the toggle);
//   2. POST /settings {bootMode:'edit'} persists into settings_state.yaml and
//      does NOT move the CURRENT session's mode — it is a next-boot preference;
//   3. after a restart that engine comes up UNLOCKED, with NO edit-session
//      principal and NO pre-show snapshot: the show lock is off, the PASSCODE
//      GATE IS NOT — the engine persists nothing until a principal is asserted;
//   4. asserting an owner principal on that boot-into-edit engine opens
//      persistence, exactly as it does after a normal perf exit;
//   5. flipping the toggle back to 'performance' brings the boot lock back;
//   6. the engine 400s an unknown bootMode instead of coercing it, and a
//      hand-edited junk value in the YAML loads as 'performance' (the safe
//      direction — a gate must never open because a file was unreadable);
//   7. auth-DISABLED engines ignore the toggle entirely (they have no gate to
//      arm), so benches and the test fleet are unaffected either way.
//
// Isolation: throwaway MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR, sACN black-holed
// at 192.0.2.9 (TEST-NET-1, RFC 5737), and a fixed high port far from the
// operator's live stack (:6966-:6972).
//
// Run: node --test tests/security/boot_mode_toggle.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import yaml from 'js-yaml';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

/** Test-only passphrases. Deliberately obvious placeholders. */
const TEST_SECRETS = {
  owner: 'test-owner-passphrase',
  collaborator: 'test-collaborator-passphrase',
  bringup: 'test-bringup-passphrase',
};

const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-mode-secrets-'));
const secretsPath = path.join(secretsDir, 'test_secrets.yaml');
fs.writeFileSync(secretsPath, [
  `SinaAuth: ${TEST_SECRETS.owner}`,
  `MishaAuth: ${TEST_SECRETS.collaborator}`,
  `MARITIME_TERM_FOR_SAILIOR_PASS: ${TEST_SECRETS.bringup}`,
  '',
].join('\n'), 'utf8');

const SCENE = 'summer_camp_dome';

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'boot-mode',
  portBase: 17236,
  portSpan: 1,
  extraEnv: {
    BM26_CAPTAINPAD_AUTH_REQUIRED: '1',
    BM26_SECRETS: secretsPath,
  },
  extraArgs: ['--dest', '192.0.2.9'],
});

const pass = (passcode) => ({ 'X-CaptainPad-Passcode': passcode });

const settingsFile = () => path.join(h.stateDir, 'settings_state.yaml');
const snapshotFile = () => path.join(h.stateDir, 'snapshots', 'performance-preshow.yaml');
const readSettingsFile = () => yaml.load(fs.readFileSync(settingsFile(), 'utf8'));

/** Stop the engine and bring it back up on the same state dir. */
async function restart() {
  const proc = h.proc;
  assert.ok(proc, 'no engine process to restart');
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGKILL');
  await Promise.race([
    exited,
    new Promise((r) => setTimeout(r, 5000)).then(() => assert.fail('engine did not exit')),
  ]);
  h.spawnEngine();
  await h.waitForReady();
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
  fs.rmSync(secretsDir, { recursive: true, force: true });
});

test('default: an auth-required engine still boots LOCKED (docs/56 D1 unchanged)', async () => {
  const state = await h.api('GET', '/performance-mode');
  assert.equal(state.data.active, true, 'the default boot mode stopped locking the engine');
  assert.equal(state.data.editPrincipal, null);
  assert.ok(fs.existsSync(snapshotFile()), 'boot-locked engine has no pre-show snapshot');

  const settings = await h.api('GET', '/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.data.bootMode, 'performance', 'the default boot mode is not performance');
});

test('the toggle is refused while the show lock is on, and refuses junk values', async () => {
  // The lock outranks config writes, exactly as it does for autoSave.
  const locked = await h.api('POST', '/settings', { autoSave: true, bootMode: 'edit' });
  assert.equal(locked.status, 409, JSON.stringify(locked.data));
  assert.equal(locked.data.code, 'PERFORMANCE_MODE');

  // Leave the lock so the rest of the suite can write settings.
  const exit = await h.api('POST', '/performance-mode',
    { active: false, exitAction: 'keep' }, pass(TEST_SECRETS.owner));
  assert.equal(exit.status, 200, JSON.stringify(exit.data));

  // Fail LOUD on an unknown mode — no coercion of a safety-critical toggle.
  for (const junk of ['EDIT', 'Performance', '', 1, true, null]) {
    const bad = await h.api('POST', '/settings', { autoSave: true, bootMode: junk });
    assert.equal(bad.status, 400, `bootMode '${junk}' was accepted`);
    assert.equal(bad.data.code, 'INVALID_BOOT_MODE');
  }
  // …and the stored preference is untouched by every refusal.
  assert.equal((await h.api('GET', '/settings')).data.bootMode, 'performance');
});

test('a sailor session cannot rewrite the boot mode (docs/56 D6 family 4)', async () => {
  const handover = await h.api('POST', '/edit-session', {}, pass(TEST_SECRETS.bringup));
  assert.equal(handover.status, 200, JSON.stringify(handover.data));

  const refused = await h.api('POST', '/settings', { autoSave: true, bootMode: 'edit' });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.code, 'EDIT_PRINCIPAL_READONLY');
  // Nothing was written: the engine still reports the default, and — since the
  // settings file is only created by a SUCCESSFUL write — it does not exist yet.
  assert.equal((await h.api('GET', '/settings')).data.bootMode, 'performance');
  assert.equal(fs.existsSync(settingsFile()), false, 'a refused write created the settings file');

  const back = await h.api('POST', '/edit-session', {}, pass(TEST_SECRETS.owner));
  assert.equal(back.status, 200, JSON.stringify(back.data));
});

test("bootMode:'edit' persists to disk and does NOT move the current session", async () => {
  const before_ = await h.api('GET', '/performance-mode');
  assert.equal(before_.data.active, false);

  const set = await h.api('POST', '/settings', { autoSave: true, bootMode: 'edit' });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.bootMode, 'edit');

  // Persisted in the SAME file as autoSave (settings_state.yaml), atomically.
  assert.equal(readSettingsFile().bootMode, 'edit', 'bootMode did not reach settings_state.yaml');

  // It is a NEXT-BOOT preference: nothing about this session changed.
  const after_ = await h.api('GET', '/performance-mode');
  assert.equal(after_.data.active, false);
  assert.equal(after_.data.editPrincipal, 'owner', 'the toggle disturbed the live edit session');
});

test("restart with bootMode:'edit' → UNLOCKED, but the passcode gate is NOT lifted", async () => {
  await restart();

  const state = await h.api('GET', '/performance-mode');
  assert.equal(state.data.active, false, 'boot mode EDIT still came up locked');
  assert.equal(state.data.authRequired, true, 'the engine forgot it has a passcode gate');
  // THE decision this whole mode rests on: no principal is handed out at boot.
  assert.equal(state.data.editPrincipal, null,
    'booting into edit invented an edit session — the gate opened itself');

  // Nothing is locked, so there is nothing to restore to: no reserved snapshot.
  assert.equal(fs.existsSync(snapshotFile()), false,
    'an edit-boot engine captured a pre-show snapshot it can never use');

  // Editing is OPEN — the point of the mode.
  const live = await h.api('POST', '/pattern', { pattern: '13_sparkle' });
  assert.equal(live.status, 200, `live edit was refused: ${JSON.stringify(live.data)}`);

  // …but the DISK is not. Every explicit rig-state writer still 403s, because
  // principalMaySave() is false with no principal.
  const saveNow = await h.api('POST', '/settings/save-now', {});
  assert.equal(saveNow.status, 403, JSON.stringify(saveNow.data));
  assert.equal(saveNow.data.code, 'EDIT_PRINCIPAL_READONLY');
  assert.equal(saveNow.data.principal, null);

  // The preference itself survived the restart.
  assert.equal((await h.api('GET', '/settings')).data.bootMode, 'edit');
});

test('asserting an owner principal on an edit-boot engine opens persistence', async () => {
  const escalate = await h.api('POST', '/edit-session', {}, pass(TEST_SECRETS.owner));
  assert.equal(escalate.status, 200, JSON.stringify(escalate.data));
  assert.equal(escalate.data.editPrincipal, 'owner');

  const saveNow = await h.api('POST', '/settings/save-now', {});
  assert.equal(saveNow.status, 200, JSON.stringify(saveNow.data));
  assert.equal(saveNow.data.saved, true);
});

test("flipping back to 'performance' brings the boot lock back", async () => {
  const set = await h.api('POST', '/settings', { autoSave: true, bootMode: 'performance' });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(readSettingsFile().bootMode, 'performance');

  await restart();

  const state = await h.api('GET', '/performance-mode');
  assert.equal(state.data.active, true, 'the engine did not come back locked');
  assert.equal(state.data.editPrincipal, null);
  assert.ok(fs.existsSync(snapshotFile()), 'the re-locked engine has no pre-show snapshot');
});

test('a junk bootMode in the YAML loads as performance — the safe direction', async () => {
  // Hand-edit the file the way a tired human at 4am would, then restart. A gate
  // that opens because a value was unreadable is exactly the quiet fallback the
  // codex forbids.
  const raw = readSettingsFile();
  fs.writeFileSync(settingsFile(), yaml.dump({ ...raw, bootMode: 'edti' }), 'utf8');
  await restart();

  assert.equal((await h.api('GET', '/performance-mode')).data.active, true,
    'a typo in settings_state.yaml unlocked the show engine');
  assert.equal((await h.api('GET', '/settings')).data.bootMode, 'performance');
});

test('auth DISABLED: the toggle is inert — the engine boots unlocked either way', async () => {
  const plain = createEngineHarness({
    scene: SCENE,
    pattern: '13_sparkle',
    prefix: 'boot-mode-noauth',
    portBase: 17237,
    portSpan: 1,
    extraEnv: { BM26_CAPTAINPAD_AUTH_REQUIRED: '0' },
    extraArgs: ['--dest', '192.0.2.9'],
  });
  try {
    plain.spawnEngine();
    await plain.waitForReady();

    assert.equal((await plain.api('GET', '/performance-mode')).data.active, false);
    // The field is still reported and still persisted — a bench operator can
    // set it now and enable auth later — it just arms nothing here.
    const set = await plain.api('POST', '/settings', { autoSave: true, bootMode: 'performance' });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.bootMode, 'performance');

    const proc = plain.proc;
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill('SIGKILL');
    await exited;
    plain.spawnEngine();
    await plain.waitForReady();

    assert.equal((await plain.api('GET', '/performance-mode')).data.active, false,
      'an auth-disabled engine locked itself at boot');
  } finally {
    await plain.teardown();
  }
});

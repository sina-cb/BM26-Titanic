// Launcher → engine contract for --dev-no-auth.
//
// The launcher is the ONE authority that sets BM26_CAPTAINPAD_AUTH_REQUIRED for
// supervised dev runs. With auth disabled (0), CaptainPad Performance enter/exit
// and Edit-mode persistence behave as documented in docs/56 — no passcode gates.
//
// Run: node --test tests/security/launcher_dev_no_auth_contract.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'summer_camp_dome';

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'launcher-dev-no-auth',
  portBase: 17240,
  portSpan: 1,
  extraEnv: { BM26_CAPTAINPAD_AUTH_REQUIRED: '0' },
  extraArgs: ['--dest', '192.0.2.9'],
});

test('auth-disabled engine (launcher --dev-no-auth contract): Performance enter/exit without passcode', async () => {
  try {
    h.spawnEngine();
    await h.waitForReady();

    const boot = await h.api('GET', '/performance-mode');
    assert.equal(boot.status, 200);
    assert.equal(boot.data.active, false);
    assert.equal(boot.data.authRequired, false);

    const enter = await h.api('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));
    assert.equal(enter.data.active, true);
    assert.equal(enter.data.authRequired, false);

    const exit = await h.api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
    assert.equal(exit.status, 200, JSON.stringify(exit.data));
    assert.equal(exit.data.active, false);
    assert.equal(exit.data.editPrincipal, null);
    assert.equal(exit.data.authRequired, false);
  } finally {
    await h.teardown();
  }
});

test('auth-disabled engine (launcher --dev-no-auth contract): Edit persistence without passcode', async () => {
  try {
    h.spawnEngine();
    await h.waitForReady();

    const settingsWrite = await h.api('POST', '/settings', { autoSave: true });
    assert.equal(settingsWrite.status, 200, JSON.stringify(settingsWrite.data));

    const saveNow = await h.api('POST', '/settings/save-now', {});
    assert.equal(saveNow.status, 200, JSON.stringify(saveNow.data));
    assert.equal(saveNow.data.saved, true);

    const editSession = await h.api('POST', '/edit-session', {});
    assert.equal(editSession.status, 503, JSON.stringify(editSession.data));
    assert.equal(editSession.data.code, 'PRIVILEGED_AUTH_DISABLED');
    assert.equal(editSession.data.editPrincipal, undefined);
  } finally {
    await h.teardown();
  }
});

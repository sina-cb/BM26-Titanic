// ══ SPECIAL EVENTS — STAGE AUTOPILOT (pattern rotation) ═══════════════════
//
// The operator's ask, verbatim (2026-08-15): *"an auto transition between those
// patterns that I can set the timer for in the UI … use crossfade for the
// transitions … allow full auto pilot controls that I can set to change how
// fast the patterns change (give me the deck auto pilot settings exactly no
// color)"*.
//
// So a show STAGE may carry the deck's AUTOPILOT PATTERNS settings, and the
// operator may retune them live while the stage holds the rig. This suite pins
// the four things that make that trustworthy on the night:
//
//   1. ARMING. Firing a stage that authors `autopilot:` puts the DECK's own
//      pattern autopilot on that stage's cadence + crossfade — the same daemon
//      the deck tab drives, not a second timer racing it for the deck channel.
//   2. LIVE. POST /special-events/autopilot changes the cadence and the
//      crossfade WHILE the stage runs, and the change is visible on the deck's
//      own endpoints — the tab is not being told a story.
//   3. HANDOVER + RESTORE. A stage that authors NO rotation forces it off (a
//      blackout must not keep swapping patterns behind a dark ship), and
//      FINISH puts the operator's own deck autopilot and transition config back
//      EXACTLY as they were found.
//   4. MEMORY. Live tuning is remembered per show+stage, so re-firing the stage
//      keeps the cadence the operator dialled at the rail.
//
// And, underneath all of it, the one thing a unit test cannot fake: with the
// rotation armed the deck's PATTERN ACTUALLY CHANGES, on the engine's clock,
// with nothing driving it from outside.
//
// SAFETY. `--dest 192.0.2.9` — TEST-NET-1 (RFC 5737), never routed —
// black-holes the sACN (a loopback dest does NOT: the sim's receiver binds
// every local interface and relays onward). MARSIN_STATE_DIR /
// MARSIN_PLAYLISTS_DIR / MARSIN_SPECIAL_EVENTS_DIR all point into temp dirs, so
// nothing here can touch `simulation/scenes/**` or `marsin_engine/states/**`.
// The port sits at 17230 — far above the operator's pinned 6966-6972 + 5568
// band and clear of every other spawn harness.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const SCENE = 'test_bench';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// This suite exercises HTTP show rotation only. Keep its isolated engine off
// the operator's OSC / fire-sync UDP ports as well as its black-holed sACN.
const isolatedConfigPath = process.env.MARSIN_CONFIG_FILE;
if (!isolatedConfigPath) throw new Error('special_events_autopilot_api requires an isolated config');
const isolatedConfig = yaml.load(fs.readFileSync(isolatedConfigPath, 'utf8'));
isolatedConfig.osc.enabled = false;
isolatedConfig.fire_sync.enabled = false;
fs.writeFileSync(isolatedConfigPath, yaml.dump(isolatedConfig), 'utf8');

const showsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-autopilot-shows-'));

// The Baby Reveal SHAPE on bench playlists: a rotating tease, a blackout that
// must NOT rotate, and a plain hold. `ambient` is used for the tease because it
// carries enough entries for a rotation to visibly move.
const ROTATING_SHOW = {
  schemaVersion: 1,
  id: 'rotating_show',
  name: 'Rotating Show',
  stages: [
    {
      id: 'tease',
      label: 'START TEASE',
      actions: [{ type: 'playlist', playlist: 'ambient' }],
      autopilot: {
        active: true,
        everySec: 2,
        shuffle: false,
        transition: { enabled: true, mode: 'trans_crossfade', durationMs: 300 },
      },
      extend: { label: 'RESTART TEASE', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    },
    // No `autopilot:` key at all — the stage that proves rotation STOPS.
    { id: 'blackout', label: 'GO DARK', actions: [{ type: 'masterFade', target: 0.0, durationMs: 200 }] },
    { id: 'photos', label: 'PHOTO GLOW', actions: [{ type: 'masterFade', target: 1.0, durationMs: 200 }] },
  ],
};

// A stage that offers the CONTROLS but starts parked — `supported` and `active`
// are different questions, and the operator must be able to start rotation from
// the tab on a stage the author left off.
const PARKED_SHOW = {
  schemaVersion: 1,
  id: 'parked_show',
  name: 'Parked Show',
  stages: [
    {
      id: 'hold',
      label: 'HOLD',
      actions: [{ type: 'playlist', playlist: 'ambient' }],
      autopilot: { active: false, everySec: 45 },
    },
  ],
};

// G1 (docs/57 §6): a stage that PINS a global. Before `_240` the ARM snapshot
// covered only the mixer LOOK, so a `globals` write outlived FINISH and left
// the whole night retuned. This show exists to prove it does not any more.
const GLOBALS_SHOW = {
  schemaVersion: 1,
  id: 'globals_show',
  name: 'Globals Show',
  stages: [
    {
      id: 'pin',
      label: 'PIN SPEED',
      actions: [
        { type: 'playlist', playlist: 'ambient' },
        { type: 'globals', set: { speed: 0.25 } },
      ],
    },
  ],
};

fs.writeFileSync(path.join(showsDir, 'rotating_show.yaml'), yaml.dump(ROTATING_SHOW), 'utf8');
fs.writeFileSync(path.join(showsDir, 'parked_show.yaml'), yaml.dump(PARKED_SHOW), 'utf8');
fs.writeFileSync(path.join(showsDir, 'globals_show.yaml'), yaml.dump(GLOBALS_SHOW), 'utf8');

const h = createEngineHarness({
  scene: SCENE,
  pattern: '01_cylon_sweep',
  prefix: 'marsin-se-autopilot',
  // Assigned for this slice by the coordinator; 17233 is the spare.
  portBase: 17230,
  portSpan: 3,
  extraArgs: ['--dest', '192.0.2.9'],
  extraEnv: {
    MARSIN_SPECIAL_EVENTS_DIR: showsDir,
    MARSIN_VSN1_DEPLOY: '0',
  },
});
const { api } = h;

function seedPlaylists() {
  const src = path.join(REPO_DIR, 'simulation', 'scenes', SCENE, 'playlists');
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.yaml')) fs.copyFileSync(path.join(src, f), path.join(h.playlistsDir, f));
  }
}

async function state() {
  const r = await api('GET', '/special-events/state');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

/** The DECK's own autopilot endpoint — engine truth, not the runner's echo. */
async function deckAutopilot() {
  const r = await api('GET', '/autopilot');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function deckTransition() {
  const r = await api('GET', '/deck/transition-config');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function deckPattern() {
  const r = await api('GET', '/deck/playlist');
  return r.data && r.data.activeEntryId ? r.data.activeEntryId : null;
}

async function until(read, predicate, { what = 'condition', timeoutMs = 12000 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}; last saw ${JSON.stringify(last)}`);
}

async function forceIdle() {
  const st = await state();
  if (st.status === 'armed' || st.status === 'running') await api('POST', '/special-events/abort');
  await api('POST', '/special-events/dismiss');
}

/**
 * ARM + fire a stage — the starting position for most tests below.
 *
 * `reset` is the interesting argument. Live tuning is REMEMBERED across runs on
 * purpose (that is the feature), so without an explicit reset one test's
 * `{active:false}` would silently become the next test's starting state and the
 * suite would be testing leftovers. Resetting on entry makes each test start
 * from what the show file authored; the one test that is ABOUT the memory
 * passes `reset:false` on its second arm and asserts the tuning survived.
 */
async function armAndFire(showId, stageId, { reset = true } = {}) {
  const armed = await api('POST', '/special-events/arm', { show: showId });
  assert.equal(armed.status, 200, JSON.stringify(armed.data));
  const fired = await api('POST', '/special-events/fire', { stageId });
  assert.equal(fired.status, 200, JSON.stringify(fired.data));
  if (!reset) return fired.data.state;
  const cleared = await api('POST', '/special-events/autopilot', { reset: true });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  return cleared.data.state;
}

const armAndTease = (opts) => armAndFire('rotating_show', 'tease', opts);

before(async () => {
  seedPlaylists();
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
  fs.rmSync(showsDir, { recursive: true, force: true });
});

// ── the authored block reaches the tab ──────────────────────────────────────

test('the show summary carries each stage\'s authored rotation, supported or not', async () => {
  const r = await api('GET', '/special-events');
  assert.equal(r.status, 200);
  const show = r.data.shows.find(s => s.id === 'rotating_show');
  assert.ok(show, 'rotating_show did not load');

  const tease = show.stages.find(s => s.id === 'tease').autopilot;
  assert.equal(tease.supported, true);
  assert.equal(tease.active, true);
  assert.equal(tease.everySec, 2);
  assert.equal(tease.transition.enabled, true);
  assert.equal(tease.transition.mode, 'trans_crossfade');
  assert.equal(tease.transition.durationMs, 300);

  // A stage that authors nothing still sends a COMPLETE block, so the tab never
  // has to invent one — it just does not draw the card.
  const blackout = show.stages.find(s => s.id === 'blackout').autopilot;
  assert.equal(blackout.supported, false);
  assert.equal(blackout.active, false);
  assert.equal(typeof blackout.everySec, 'number');
  assert.equal(typeof blackout.transition.mode, 'string');
});

// ── 1. arming ───────────────────────────────────────────────────────────────

test('firing a rotating stage arms the DECK pattern autopilot with its cadence', async (t) => {
  t.after(forceIdle);
  await armAndTease();

  // The runner's own view…
  const st = await state();
  assert.equal(st.autopilot.supported, true);
  assert.equal(st.autopilot.stageId, 'tease');
  assert.equal(st.autopilot.active, true);
  assert.equal(st.autopilot.everySec, 2);
  assert.equal(st.autopilot.overridden, false, 'nothing has been tuned yet');

  // …and the DECK's, which is the one that actually swaps patterns. If these
  // two ever disagree the tab is telling a story about a rig that is doing
  // something else.
  const ap = await until(deckAutopilot, (a) => a.active === true,
    { what: 'the deck autopilot to go active' });
  assert.equal(String(ap.delay_s), '2');
  assert.equal(ap.shuffle, false);

  const tx = await deckTransition();
  assert.equal(tx.enabled, true);
  assert.equal(tx.mode, 'trans_crossfade');
  assert.equal(tx.durationMs, 300);
});

test('the deck pattern actually rotates on its own while the stage holds', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  const first = await until(deckPattern, (p) => p !== null,
    { what: 'the tease playlist to land on the deck' });

  // Nothing drives this but the engine's own clock: no request is made between
  // here and the assertion. everySec is 2, so ~10 s is a generous window.
  const moved = await until(deckPattern, (p) => p !== null && p !== first,
    { what: `the deck entry to advance away from ${first}`, timeoutMs: 12000 });
  assert.notEqual(moved, first);
});

// ── 2. live retune ──────────────────────────────────────────────────────────

test('POST /special-events/autopilot retunes the cadence live, on the deck', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  await until(deckAutopilot, (a) => a.active === true, { what: 'rotation to arm' });

  const r = await api('POST', '/special-events/autopilot', { everySec: 17 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'ok');
  // The mutation answers with the FULL runner document, exactly like every
  // other verb, so the tab adopts it instead of re-reading.
  assert.equal(r.data.state.autopilot.everySec, 17);
  assert.equal(r.data.state.autopilot.overridden, true);

  const ap = await until(deckAutopilot, (a) => String(a.delay_s) === '17',
    { what: 'the deck cadence to become 17 s' });
  assert.equal(ap.active, true);
});

test('transition time and SINGLE / SHUFFLE ALL are settable live on the deck', async (t) => {
  t.after(forceIdle);
  await armAndTease();

  const r = await api('POST', '/special-events/autopilot', {
    transition: { durationMs: 4500, mode: 'trans_dissolve', shuffle: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.autopilot.transition.durationMs, 4500);
  assert.equal(r.data.state.autopilot.transition.mode, 'trans_dissolve');
  assert.equal(r.data.state.autopilot.transition.shuffle, true);
  // `enabled` was NOT in the patch and must survive it — a sparse patch that
  // silently cleared the rest would turn the crossfade off mid-tease.
  assert.equal(r.data.state.autopilot.transition.enabled, true);

  const tx = await until(deckTransition, (v) => v.durationMs === 4500,
    { what: 'the deck crossfade time to become 4500 ms' });
  assert.equal(tx.mode, 'trans_dissolve');
  assert.equal(tx.enabled, true);
  assert.equal(tx.shuffle, true);
});

test('PAUSE from the tab stops the deck rotation without ending the stage', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  await until(deckAutopilot, (a) => a.active === true, { what: 'rotation to arm' });

  const r = await api('POST', '/special-events/autopilot', { active: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.autopilot.active, false);
  // The STAGE is untouched — pausing the rotation is not leaving the tease.
  assert.equal(r.data.state.status, 'running');
  assert.equal(r.data.state.stageId, 'tease');

  const ap = await until(deckAutopilot, (a) => a.active === false,
    { what: 'the deck autopilot to stop' });
  assert.equal(ap.active, false);
});

test('a stage may offer the controls but start parked, and the tab can start it', async (t) => {
  t.after(forceIdle);
  await armAndFire('parked_show', 'hold');

  const parked = await state();
  assert.equal(parked.autopilot.supported, true, 'the controls must be offered');
  assert.equal(parked.autopilot.active, false, 'but nothing is rotating yet');
  assert.equal(parked.autopilot.everySec, 45);
  assert.equal((await deckAutopilot()).active, false);

  const r = await api('POST', '/special-events/autopilot', { active: true, everySec: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await until(deckAutopilot, (a) => a.active === true && String(a.delay_s) === '3',
    { what: 'the parked stage to start rotating at 3 s' });
});

// ── 3. handover + restore ───────────────────────────────────────────────────

test('a stage that authors no rotation forces it OFF when it takes the rig', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  await until(deckAutopilot, (a) => a.active === true, { what: 'rotation to arm' });

  const r = await api('POST', '/special-events/fire', { stageId: 'blackout' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // The blackout must not keep swapping patterns behind a dark ship.
  assert.equal(r.data.state.autopilot.supported, false);
  assert.equal(r.data.state.autopilot.active, false);
  const ap = await until(deckAutopilot, (a) => a.active === false,
    { what: 'the deck rotation to stop on the blackout' });
  assert.equal(ap.active, false);
});

// ── G2 (docs/57 §6, report `_240`) ─────────────────────────────────────────
//
// A stage that authors NO `autopilot:` block used to INHERIT whatever deck
// transition the previous stage left behind. Measured in `_231` §5: THE KISS
// landed its answer playlist as a ~5.7 s dissolve it never asked for, under a
// 900 ms flash — so the flash hid nothing and the audience watched the swap.
// A stage with no rotation is a HARD CUT stage, and the runner now says so
// explicitly BEFORE dispatching that stage's actions.
test('a no-autopilot stage lands as a HARD CUT, not the previous stage\'s crossfade', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  // The tease authors a real crossfade, so the deck is genuinely left dissolving.
  const during = await until(deckTransition, (d) => d.enabled === true,
    { what: "the tease's crossfade to land on the deck" });
  assert.equal(during.enabled, true, 'precondition: the tease leaves a crossfade on the deck');

  // Now take a stage that authors no `autopilot:` at all.
  const r = await api('POST', '/special-events/fire', { stageId: 'blackout' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const after = await until(deckTransition, (d) => d.enabled === false,
    { what: 'the deck transition to be forced OFF for the no-autopilot stage' });
  assert.equal(after.enabled, false,
    'a stage with no rotation must not inherit the previous stage\'s dissolve — '
    + 'that is the bug class that made THE KISS swap in the open');
});

// ── W6 (docs/57 §4.3, report `_240`) ───────────────────────────────────────
//
// NOW PLAYING on the simplified SHOW card. Read engine-side onto the existing
// `specialEvents` frame so the Events tab never grows a second data source for
// the deck.
test('the autopilot wire carries nowPlaying, matching the deck\'s own truth', async (t) => {
  t.after(forceIdle);
  await armAndTease();

  // It resolves to a real entry once the tease's crossfade has landed...
  const st = await until(state, (s) => s.autopilot.nowPlaying !== null,
    { what: 'nowPlaying to name the deck entry' });
  const np = st.autopilot.nowPlaying;
  assert.ok(np && typeof np === 'object', 'nowPlaying must be an object once the deck has an entry');
  assert.ok('pattern' in np && 'label' in np, 'the card reads both fields');

  // ...and it agrees with the DECK's own playlist truth, not a second guess.
  const deckPl = (await api('GET', '/deck/playlist')).data;
  const pl = (await api('GET', `/playlists/${deckPl.name}`)).data;
  const entries = pl.entries || (pl.playlist && pl.playlist.entries) || [];
  const entry = entries.find((e) => e.id === deckPl.activeEntryId);
  assert.ok(entry, `the deck's activeEntryId ${deckPl.activeEntryId} must exist in ${deckPl.name}`);
  assert.equal(np.pattern, entry.pattern, 'nowPlaying.pattern is the deck entry\'s pattern');
  assert.equal(np.label, entry.label || null, 'nowPlaying.label is the operator\'s own name');
});

test('nowPlaying tracks a rotation swap with no request in between', async (t) => {
  t.after(forceIdle);
  await armAndTease();                      // everySec: 2 — swaps on its own
  const first = await until(state, (s) => s.autopilot.nowPlaying !== null,
    { what: 'a first nowPlaying' });
  const firstPattern = first.autopilot.nowPlaying.pattern;

  // Nothing below asks the deck anything: the runner's own 1 s tick broadcast
  // is what carries the new name to the tab.
  const swapped = await until(
    state,
    (s) => s.autopilot.nowPlaying !== null && s.autopilot.nowPlaying.pattern !== firstPattern,
    { what: 'nowPlaying to follow the rotation swap', timeoutMs: 20000 });
  assert.notEqual(swapped.autopilot.nowPlaying.pattern, firstPattern,
    'the name must change when the rotation swaps the pattern under it');
});

// ── G1 (docs/57 §6, report `_240`) ─────────────────────────────────────────
//
// The pre-show snapshot restores the mixer LOOK; ParamCenter is a different
// surface it never reached, so a stage that pinned SPEED for a ceremony left it
// pinned for the rest of the night (`_231` §7.1). ARM now captures the globals
// and the end of the show puts back exactly the keys a `globals` action wrote.

/** The live canonical value of one ParamCenter key. */
async function globalParam(key) {
  const r = await api('GET', '/param-center');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const slot = r.data && r.data.params && r.data.params[key];
  assert.ok(slot, `ParamCenter has no '${key}' — the fixture needs a real global`);
  return slot.value;
}

for (const [label, endPath] of [['FINISH', '/special-events/finish'], ['ABORT', '/special-events/abort']]) {
  test(`a stage that pins a global has it restored after ${label}`, async (t) => {
    t.after(forceIdle);
    // A deliberate, specific pre-show value: the restore has to reproduce THIS.
    const seed = 0.8;
    assert.equal((await api('POST', '/param-center', { speed: seed })).status, 200);
    assert.equal(await globalParam('speed'), seed, 'precondition: the pre-show value is set');

    const armed = await api('POST', '/special-events/arm', { show: 'globals_show' });
    assert.equal(armed.status, 200, JSON.stringify(armed.data));
    const fired = await api('POST', '/special-events/fire', { stageId: 'pin' });
    assert.equal(fired.status, 200, JSON.stringify(fired.data));

    await until(() => globalParam('speed'), (v) => v === 0.25,
      { what: 'the stage to pin SPEED' });

    const ended = await api('POST', endPath, {});
    assert.equal(ended.status, 200, JSON.stringify(ended.data));
    const back = await until(() => globalParam('speed'), (v) => v === seed,
      { what: `SPEED to be restored after ${label}` });
    assert.equal(back, seed,
      `${label} must put back the global the show pinned — otherwise one ceremony `
      + 'retunes the whole night');
  });
}

test('an unsupported stage carries nowPlaying: null alongside supported: false', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  const r = await api('POST', '/special-events/fire', { stageId: 'blackout' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.autopilot.supported, false);
  assert.equal(r.data.state.autopilot.nowPlaying, null,
    'a stage with no rotation card has no name to show on it');

  // Idle carries the complete block too, so the tab never invents one.
  await forceIdle();
  const idle = await state();
  assert.equal(idle.autopilot.supported, false);
  assert.equal(idle.autopilot.nowPlaying, null);
});

test('FINISH puts the operator\'s own autopilot and crossfade back exactly', async (t) => {
  t.after(forceIdle);
  // A deliberate, specific pre-show deck: the restore has to reproduce THIS,
  // not merely "off".
  assert.equal((await api('POST', '/deck/playlist', { name: 'party_high' })).status, 200);
  const setAp = await api('POST', '/autopilot', { active: true, delay_s: '55', shuffle: true });
  assert.equal(setAp.status, 200, JSON.stringify(setAp.data));
  const setTx = await api('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_iris', durationMs: 7000, shuffle: false,
  });
  assert.equal(setTx.status, 200, JSON.stringify(setTx.data));
  const beforeAp = await deckAutopilot();
  const beforeTx = await deckTransition();

  await armAndTease();
  // The show has taken it over — different cadence, different transition.
  await until(deckAutopilot, (a) => String(a.delay_s) === '2',
    { what: 'the show cadence to take over' });
  assert.equal((await deckTransition()).durationMs, 300);

  const fin = await api('POST', '/special-events/finish');
  assert.equal(fin.status, 200, JSON.stringify(fin.data));

  const restoredAp = await until(deckAutopilot, (a) => String(a.delay_s) === '55',
    { what: 'the operator cadence to come back' });
  assert.equal(restoredAp.active, beforeAp.active);
  assert.equal(restoredAp.shuffle, beforeAp.shuffle);

  const restoredTx = await until(deckTransition, (v) => v.durationMs === beforeTx.durationMs,
    { what: 'the operator crossfade to come back' });
  assert.equal(restoredTx.mode, beforeTx.mode);
  assert.equal(restoredTx.enabled, beforeTx.enabled);
  assert.equal(restoredTx.shuffle, beforeTx.shuffle);
});

// ── 4. the tuning is remembered ─────────────────────────────────────────────

test('live tuning survives leaving and re-firing the stage, and RESET undoes it', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  assert.equal((await api('POST', '/special-events/autopilot', { everySec: 29 })).status, 200);

  // Walk away from the stage and come back to it in a fresh run.
  assert.equal((await api('POST', '/special-events/fire', { stageId: 'blackout' })).status, 200);
  assert.equal((await api('POST', '/special-events/finish')).status, 200);
  assert.equal((await api('POST', '/special-events/dismiss')).status, 200);

  await armAndTease({ reset: false });
  const again = await state();
  assert.equal(again.autopilot.everySec, 29, 'the operator\'s cadence was forgotten');
  assert.equal(again.autopilot.overridden, true);
  await until(deckAutopilot, (a) => String(a.delay_s) === '29',
    { what: 'the remembered cadence to arm' });

  // …and the way back to what the show file asked for.
  const reset = await api('POST', '/special-events/autopilot', { reset: true });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal(reset.data.state.autopilot.everySec, 2, 'RESET did not return to the show file');
  assert.equal(reset.data.state.autopilot.overridden, false);
});

// ── refusals — the engine is the guard, not the tab ─────────────────────────

test('the autopilot route refuses when nothing is running', async () => {
  await forceIdle();
  const r = await api('POST', '/special-events/autopilot', { everySec: 10 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'NO_EVENT_ARMED');
});

test('a stage that authors no rotation has none to tune', async (t) => {
  t.after(forceIdle);
  await armAndTease();
  assert.equal((await api('POST', '/special-events/fire', { stageId: 'blackout' })).status, 200);

  const r = await api('POST', '/special-events/autopilot', { everySec: 10 });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'NO_STAGE_AUTOPILOT');
  assert.match(r.data.error, /authors no 'autopilot:' block/);
});

test('out-of-range and unknown settings are refused by NAME, never clamped', async (t) => {
  t.after(forceIdle);
  await armAndTease();

  for (const [body, pattern] of [
    [{ everySec: 0 }, /everySec/],
    [{ everySec: 99999 }, /everySec/],
    [{ groupSize: 99 }, /groupSize/],
    [{ groupDwell: 0 }, /groupDwell/],
    [{ transition: { mode: 'crossfade' } }, /trans_\*/],
    [{ transition: { durationMs: 999999 } }, /durationMs/],
    [{ nope: true }, /unknown key/],
    [{}, /at least one of/],
  ]) {
    const r = await api('POST', '/special-events/autopilot', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} was not refused: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.code, 'AUTOPILOT_INVALID', JSON.stringify(r.data));
    assert.match(r.data.error, pattern);
  }

  // …and none of that moved the rig: the cadence is still the authored one.
  assert.equal((await state()).autopilot.everySec, 2);
});

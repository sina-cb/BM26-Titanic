// ══ SPECIAL EVENTS RUNNER — engine API (docs/52) ══════════════════════════
//
// A REAL engine subprocess on a random high port with its sACN black-holed and
// every state/playlist/show path redirected into throwaway temp dirs. This
// suite pins the WIRING and the STATE MACHINE: the ARM transaction, stage
// sequencing, the CHOICE stage's flash-then-playlist ordering, the blackout
// stage, extension + auto-advance, the shared restore, the SPECIAL_EVENT deck
// write gate, PANIC precedence, and restart-mid-show recovery.
//
// The TIMELINE composition (force-resume abort, ARM's performance-mode passcode)
// needs a running plan, so it lives in special_events_timeline_api.test.js on
// the timeline e2e harness.
//
// SAFETY. `--dest 192.0.2.9` — TEST-NET-1 (RFC 5737), never routed —
// black-holes the output (a loopback dest does NOT: the sim's sACN receiver
// binds every local interface and relays onward); MARSIN_STATE_DIR /
// MARSIN_PLAYLISTS_DIR / MARSIN_SPECIAL_EVENTS_DIR all point into temp dirs so
// nothing can touch `simulation/scenes/**` or `marsin_engine/states/**`; the
// port sits well above the operator's pinned 6967-6972 + 5568 band.
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

// This suite exercises HTTP show state only. The shared config guard gives it
// an isolated config copy; disable unrelated UDP listeners in that copy before
// the child boots so the test never joins the operator's OSC / fire-sync ports.
const isolatedConfigPath = process.env.MARSIN_CONFIG_FILE;
if (!isolatedConfigPath) throw new Error('special_events_api requires an isolated config');
const isolatedConfig = yaml.load(fs.readFileSync(isolatedConfigPath, 'utf8'));
isolatedConfig.osc.enabled = false;
isolatedConfig.fire_sync.enabled = false;
fs.writeFileSync(isolatedConfigPath, yaml.dump(isolatedConfig), 'utf8');

// ── fixture shows ───────────────────────────────────────────────────────────
// Authored against test_bench's real playlists so every activation resolves a
// real pattern and the deck answers honestly.

const showsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-shows-'));

/** The Baby Reveal SHAPE, on bench playlists: tease → blackout → final choice hold. */
const BENCH_REVEAL = {
  schemaVersion: 1,
  id: 'bench_reveal',
  name: 'Bench Reveal',
  color: '#FF9EC4',
  stages: [
    {
      id: 'tease',
      label: 'START TEASE',
      actions: [{ type: 'playlist', playlist: 'ambient' }],
      extend: { label: 'RESTART TEASE', actions: [{ type: 'playlist', playlist: 'ambient' }] },
      quickEffects: [
        { id: 'strobe', label: 'STROBE', actions: [{ type: 'effect', effectId: 'strobe', hz: 6, durationMs: 600 }] },
        { id: 'vintage_white', label: 'VINTAGE WHITE', actions: [{ type: 'effect', effectId: 'vintageWhite', holdMs: 400 }] },
      ],
    },
    {
      id: 'blackout',
      label: 'GO DARK',
      actions: [{ type: 'masterFade', target: 0.0, durationMs: 300 }],
    },
    {
      id: 'reveal',
      label: 'THE REVEAL',
      ceremonial: true,
      autopilot: {
        active: true,
        everySec: 15,
        shuffle: true,
        transition: {
          enabled: true,
          mode: 'trans_crossfade',
          durationMs: 1000,
          shuffle: false,
        },
      },
      choices: [
        {
          id: 'girl',
          label: "IT'S A GIRL",
          actions: [
            { type: 'masterFade', target: 1.0, durationMs: 200 },
            {
              type: 'effect', effectId: 'blastWhite', holdMs: 900,
              releaseMs: 800, releaseTo: 'show',
            },
            { type: 'playlist', playlist: 'deep_sea', delayMs: 700 },
          ],
        },
        {
          id: 'boy',
          label: "IT'S A BOY",
          actions: [
            { type: 'masterFade', target: 1.0, durationMs: 200 },
            {
              type: 'effect', effectId: 'blastWhite', holdMs: 900,
              releaseMs: 800, releaseTo: 'show',
            },
            { type: 'playlist', playlist: 'white_only', delayMs: 700 },
          ],
        },
      ],
    },
  ],
};

/** A timed show, for the countdown + extension + auto-advance paths. */
const TIMED_SHOW = {
  schemaVersion: 1,
  id: 'timed_show',
  name: 'Timed Show',
  stages: [
    {
      id: 'first',
      label: 'FIRST',
      advance: { afterSec: 3 },
      extend: { label: '+5s', addSec: 5 },
      actions: [{ type: 'playlist', playlist: 'ambient' }],
    },
    { id: 'second', label: 'SECOND', actions: [{ type: 'playlist', playlist: 'deep_sea' }] },
  ],
};

/** A show pointing at a playlist this scene does not have — the ARM refusal. */
const GHOST_SHOW = {
  schemaVersion: 1,
  id: 'ghost_playlist',
  name: 'Ghost Playlist',
  stages: [
    { id: 'one', label: 'ONE', actions: [{ type: 'playlist', playlist: 'no_such_playlist' }] },
  ],
};

fs.writeFileSync(path.join(showsDir, 'bench_reveal.yaml'), yaml.dump(BENCH_REVEAL), 'utf8');
fs.writeFileSync(path.join(showsDir, 'timed_show.yaml'), yaml.dump(TIMED_SHOW), 'utf8');
fs.writeFileSync(path.join(showsDir, 'ghost_playlist.yaml'), yaml.dump(GHOST_SHOW), 'utf8');
// A file that EXISTS but is broken. It must appear as a named load error and
// must never be armable — the operator sees a red card, not a missing show.
fs.writeFileSync(path.join(showsDir, 'torn_show.yaml'), yaml.dump({
  schemaVersion: 1,
  id: 'torn_show',
  name: 'Torn Show',
  stages: [{ id: 'one', label: 'ONE', actions: [{ type: 'teleport', to: 'mars' }] }],
}), 'utf8');

const h = createEngineHarness({
  scene: SCENE,
  pattern: '01_cylon_sweep',
  prefix: 'marsin-special-events',
  // Clear of the operator's pinned band, of 7100-7400 (the other spawn
  // harnesses) and of 7700-7900 (the timeline e2e harness).
  portBase: 7420,
  portSpan: 60,
  extraArgs: ['--dest', '192.0.2.9'],
  extraEnv: {
    MARSIN_SPECIAL_EVENTS_DIR: showsDir,
    MARSIN_VSN1_DEPLOY: '0',
  },
});
const { api } = h;

/** Real bench playlist CONTENT, copied so the engine's writes stay in temp. */
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

async function deckPlaylistName() {
  const r = await api('GET', '/deck/playlist');
  return r.data && r.data.name ? r.data.name : null;
}

async function effectsStatus() {
  const r = await api('GET', '/global-effect-slots/status');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.controller;
}

async function masterValue() {
  const r = await api('GET', '/mixer');
  return r.data.master;
}

/** Poll until `predicate(value)` or fail with what was actually seen. */
async function until(read, predicate, { what = 'condition', timeoutMs = 8000 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}; last saw ${JSON.stringify(last)}`);
}

/** Put the runner back to idle whatever state a failed assertion left it in. */
async function forceIdle() {
  const st = await state();
  if (st.status === 'armed' || st.status === 'running') await api('POST', '/special-events/abort');
  await api('POST', '/special-events/dismiss');
}

before(async () => {
  seedPlaylists();
  h.spawnEngine();
  await h.waitForReady();
  // Put the deck on a KNOWN pre-show playlist so the restore has something
  // specific to come back to.
  const r = await api('POST', '/deck/playlist', { name: 'party_high' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

after(async () => {
  await h.teardown();
  fs.rmSync(showsDir, { recursive: true, force: true });
});

// ── library ─────────────────────────────────────────────────────────────────

test('GET /special-events lists validated shows AND names every broken file', async () => {
  const r = await api('GET', '/special-events');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.shows.map(s => s.id).sort(),
    ['bench_reveal', 'ghost_playlist', 'timed_show']);
  assert.equal(r.data.loadErrors.length, 1);
  assert.equal(r.data.loadErrors[0].id, 'torn_show');
  assert.match(r.data.loadErrors[0].error, /type must be one of/);

  const reveal = r.data.shows.find(s => s.id === 'bench_reveal');
  assert.equal(reveal.stages.length, 3);
  assert.equal(reveal.stages[2].kind, 'choice');
  assert.deepEqual(reveal.stages[2].choices.map(c => c.id), ['girl', 'boy']);
  assert.deepEqual(reveal.stages[0].quickEffects.map(q => q.id), ['strobe', 'vintage_white']);
});

test('a broken show is never armable — it refuses with its own load error', async () => {
  const r = await api('POST', '/special-events/arm', { show: 'torn_show' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'SHOW_LOAD_ERROR');
  assert.match(r.data.error, /type must be one of/);
  assert.equal((await state()).status, 'idle');
});

test('an unknown show refuses with 404 and lists what exists', async () => {
  const r = await api('POST', '/special-events/arm', { show: 'not_a_show' });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'SHOW_NOT_FOUND');
  assert.match(r.data.error, /bench_reveal/);
});

test('ARM refuses a show whose playlist is missing, naming it and what IS available', async () => {
  const r = await api('POST', '/special-events/arm', { show: 'ghost_playlist' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'SPECIAL_EVENT_PLAYLIST_MISSING');
  assert.match(r.data.error, /"no_such_playlist": no such playlist in this scene/);
  assert.match(r.data.error, /Available playlists:.*ambient/);
  assert.deepEqual(r.data.detail.missing, ['no_such_playlist']);
  // A refused ARM leaves NOTHING behind — no lease, no snapshot, no state.
  assert.equal((await state()).status, 'idle');
});

// ── ARM / sequencing ────────────────────────────────────────────────────────

test('ARM captures the pre-show look, disarms the deck autopilot and arms stage 1', async () => {
  const before = await api('POST', '/deck/playlist/autopilot', { active: true, delay_s: 45 });
  assert.equal(before.status, 200);

  const r = await api('POST', '/special-events/arm', { show: 'bench_reveal' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.status, 'armed');
  assert.equal(r.data.state.showId, 'bench_reveal');
  assert.equal(r.data.state.armedStageId, 'tease');
  assert.equal(r.data.state.stageId, null);

  // The reserved pre-show snapshot exists...
  const snaps = await api('GET', '/mixer/snapshots');
  assert.ok(snaps.data.snapshots.includes('ev_prev'), JSON.stringify(snaps.data));
  // ...and the operator cannot clobber it by hand.
  const clobber = await api('POST', '/mixer/snapshots', { name: 'ev_prev' });
  assert.equal(clobber.status, 400);
  assert.equal(clobber.data.code, 'SNAPSHOT_NAME_RESERVED');

  // The deck pattern autopilot is off for the duration of the show.
  const mixer = await api('GET', '/mixer');
  const deck = mixer.data.channels
    ? null : null; // deck lives on its own key; read it from /deck/playlist below
  assert.equal(deck, null);
  const pl = await api('GET', '/deck/playlist');
  assert.equal(pl.data.autopilot.active, false);

  // ARM changes no deck CONTENT — it is still on the pre-show playlist.
  assert.equal(await deckPlaylistName(), 'party_high');
});

test('a second ARM while a show holds the rig is refused with EVENT_ACTIVE', async () => {
  const r = await api('POST', '/special-events/arm', { show: 'timed_show' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'EVENT_ACTIVE');
});

test('firing out of order is refused by the ENGINE, not just the UI', async () => {
  const r = await api('POST', '/special-events/fire', { stageId: 'reveal', choiceId: 'girl' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'STAGE_NOT_ARMED');
  assert.match(r.data.error, /the armed stage is "tease"/);
  assert.equal((await state()).status, 'armed');
});

test('an unknown stage id is a 404 that lists the show stages', async () => {
  const r = await api('POST', '/special-events/fire', { stageId: 'nope' });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'STAGE_NOT_FOUND');
  assert.match(r.data.error, /tease, blackout, reveal/);
});

test('firing TEASE activates its playlist and arms the blackout', async () => {
  const r = await api('POST', '/special-events/fire', { stageId: 'tease' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.status, 'running');
  assert.equal(r.data.state.stageId, 'tease');
  assert.equal(r.data.state.armedStageId, 'blackout');
  await until(deckPlaylistName, n => n === 'ambient', { what: 'the tease playlist on the deck' });
});

// ── single-writer gate ──────────────────────────────────────────────────────

test('deck content routes 409 SPECIAL_EVENT while a show holds the rig', async () => {
  for (const [method, url, body] of [
    ['POST', '/deck/playlist', { name: 'deep_sea' }],
    ['POST', '/deck/playlist/entry', { entryId: 'e_deep_sea_0_08_ocean_liner' }],
    ['POST', '/deck/playlist/secondary', { name: 'deep_sea' }],
    ['POST', '/set-pattern', { pattern: '13_sparkle' }],
  ]) {
    const r = await api(method, url, body);
    assert.equal(r.status, 409, `${method} ${url} → ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.code, 'SPECIAL_EVENT');
    assert.equal(r.data.showId, 'bench_reveal');
  }
  // The show's own playlist is untouched by the refused writes.
  assert.equal(await deckPlaylistName(), 'ambient');
});

test('safety routes stay OPEN while a show holds the rig', async () => {
  // The grand master and the blackout release are the operator's hands on the
  // rig; a show must never be able to lock them out.
  const master = await api('POST', '/mixer/master/fade', { target: 1.0, durationMs: 50 });
  assert.equal(master.status, 200, JSON.stringify(master.data));
  const unblack = await api('POST', '/global-effect-macros/blackout', { enabled: false });
  assert.equal(unblack.status, 200, JSON.stringify(unblack.data));
  assert.equal((await state()).status, 'running');
});

// ── quick effects ───────────────────────────────────────────────────────────

test('a quick effect PULSES and releases itself without advancing the stage', async () => {
  const before = await state();
  const r = await api('POST', '/special-events/quick-effect', { id: 'vintage_white' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const on = await effectsStatus();
  assert.equal(on.effects.vintageWhite, true, 'the flash should be UP immediately');
  await until(effectsStatus, s => s.effects.vintageWhite === false,
    { what: 'the vintage-white pulse to release itself' });
  const after = await state();
  assert.equal(after.stageId, before.stageId, 'a quick effect must not advance the stage');
  assert.equal(after.status, 'running');
});

test('the strobe quick effect fires a bounded burst', async () => {
  const r = await api('POST', '/special-events/quick-effect', { id: 'strobe' });
  assert.equal(r.status, 200);
  const on = await effectsStatus();
  assert.equal(on.strobe.active, true);
  assert.equal(on.strobe.config.hz, 6);
  assert.ok(on.strobe.burstEndFrame !== null, 'a burst must carry an end frame — it self-terminates');
  await until(effectsStatus, s => s.strobe.active === false, { what: 'the strobe burst to end' });
});

test('an unknown quick effect id is a 404 listing the stage\'s own buttons', async () => {
  const r = await api('POST', '/special-events/quick-effect', { id: 'fireworks' });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'QUICK_EFFECT_NOT_FOUND');
  assert.match(r.data.error, /strobe \| vintage_white/);
});

// ── extension ───────────────────────────────────────────────────────────────

test('an action-extend re-fires its authored set without advancing', async () => {
  const r = await api('POST', '/special-events/extend');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.stageId, 'tease');
  assert.equal(r.data.state.armedStageId, 'blackout');
  assert.equal(await deckPlaylistName(), 'ambient');
});

// ── blackout ────────────────────────────────────────────────────────────────

test('the BLACKOUT stage rides the grand master to zero — not the e-stop', async () => {
  const r = await api('POST', '/special-events/fire', { stageId: 'blackout' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.stageId, 'blackout');
  await until(masterValue, m => m <= 0.02, { what: 'the grand master to reach 0' });

  // Crucially NOT the e-stop: the persisted blackout flag stays off, so the
  // rig is dark by a transient ramp that anything can simply ramp back.
  const globals = await api('GET', '/globals');
  assert.equal(globals.data.blackout, false,
    'a blackout STAGE must never latch the persisted e-stop blackout');
});

// ── the reveal: flash BEFORE the playlist ───────────────────────────────────

test('a CHOICE stage refuses a missing or unknown choice', async () => {
  const missing = await api('POST', '/special-events/fire', { stageId: 'reveal' });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.code, 'CHOICE_REQUIRED');
  assert.match(missing.data.error, /girl \| boy/);

  const unknown = await api('POST', '/special-events/fire', { stageId: 'reveal', choiceId: 'cat' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.code, 'CHOICE_NOT_FOUND');
});

test('THE REVEAL: white flash lands FIRST, the playlist swaps under it, then it releases', async () => {
  const beforeName = await deckPlaylistName();
  const r = await api('POST', '/special-events/fire', { stageId: 'reveal', choiceId: 'girl' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.stageId, 'reveal');
  assert.equal(r.data.state.choiceId, 'girl');

  // t≈0: the flash is UP and the deck has NOT swapped yet (the playlist action
  // is authored at delayMs 700). This ordering IS the moment.
  const atFlash = await effectsStatus();
  assert.equal(atFlash.effects.blastWhite, true, 'the white flash must be up the instant the button lands');
  assert.equal(await deckPlaylistName(), beforeName,
    'the playlist must NOT have swapped yet — the flash goes first');
  // The master is on its way back up from the blackout.
  await until(masterValue, m => m > 0.9, { what: 'the grand master back up for the reveal' });

  // ...then the answer arrives underneath the flash...
  await until(deckPlaylistName, n => n === 'deep_sea', { what: 'the answer playlist' });
  // ...and the flash releases itself.
  await until(effectsStatus, s => s.effects.blastWhite === false,
    { what: 'the white flash to release' });
  assert.equal(await deckPlaylistName(), 'deep_sea');
  const holding = await state();
  assert.equal(holding.armedStageId, null,
    'the chosen answer is the final stage and must hold until END SHOW');
  assert.equal(holding.autopilot.stageId, 'reveal');
  assert.equal(holding.autopilot.active, true);
  assert.equal(holding.autopilot.everySec, 15);
  assert.equal(holding.autopilot.shuffle, true);
  assert.equal(holding.autopilot.transition.durationMs, 1000);
});

test('re-firing the CURRENT stage is allowed (the "run it again" gesture)', async () => {
  const r = await api('POST', '/special-events/fire', { stageId: 'reveal', choiceId: 'boy' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.choiceId, 'boy');
  await until(deckPlaylistName, n => n === 'white_only', { what: 'the re-fired answer playlist' });
});

// ── finish / restore ────────────────────────────────────────────────────────

test('FINISH restores the pre-show look, the autopilot flag and the deck playlist', async () => {
  const r = await api('POST', '/special-events/finish');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.status, 'ended');
  assert.equal(r.data.state.endedReason, 'finished');

  // The 3 s snapshot morph puts the pre-show deck + master back.
  await until(deckPlaylistName, n => n === 'party_high',
    { what: 'the pre-show playlist to come back', timeoutMs: 12000 });
  await until(masterValue, m => m > 0.9, { what: 'the pre-show master' });
  const pl = await api('GET', '/deck/playlist');
  assert.equal(pl.data.autopilot.active, true, 'the deck autopilot must be re-armed');

  // Deck content routes are open again the moment the show ends.
  const open = await api('POST', '/deck/playlist', { name: 'party_high' });
  assert.equal(open.status, 200, JSON.stringify(open.data));
});

test('the ENDED card is sticky until dismissed, and dismiss returns to idle', async () => {
  let st = await state();
  assert.equal(st.status, 'ended');
  assert.equal(st.endedReason, 'finished');
  const r = await api('POST', '/special-events/dismiss');
  assert.equal(r.status, 200);
  st = await state();
  assert.equal(st.status, 'idle');
  assert.equal(st.endedReason, null);
});

test('extend / fire / finish with nothing armed are refused, never silent no-ops', async () => {
  for (const url of ['/special-events/extend', '/special-events/finish', '/special-events/abort']) {
    const r = await api('POST', url);
    assert.equal(r.status, 409, `${url} → ${r.status}`);
    assert.equal(r.data.code, 'NO_EVENT_ARMED');
  }
  const fire = await api('POST', '/special-events/fire', { stageId: 'tease' });
  assert.equal(fire.status, 409);
  assert.equal(fire.data.code, 'NO_EVENT_ARMED');
});

// ── timed advance + countdown extension ─────────────────────────────────────

test('a timed stage counts down, +addSec extends it, and it auto-advances', async () => {
  const armed = await api('POST', '/special-events/arm', { show: 'timed_show' });
  assert.equal(armed.status, 200, JSON.stringify(armed.data));
  const fired = await api('POST', '/special-events/fire', { stageId: 'first' });
  assert.equal(fired.status, 200);
  assert.ok(fired.data.state.countdownSec >= 2 && fired.data.state.countdownSec <= 3,
    `countdown should start near 3 s, got ${fired.data.state.countdownSec}`);

  const extended = await api('POST', '/special-events/extend');
  assert.equal(extended.status, 200);
  assert.ok(extended.data.state.countdownSec >= 6,
    `+5s must extend the LIVE countdown, got ${extended.data.state.countdownSec}`);

  // Repeatable.
  const again = await api('POST', '/special-events/extend');
  assert.ok(again.data.state.countdownSec >= 11,
    `extend must be repeatable, got ${again.data.state.countdownSec}`);

  // Manual always pre-empts the countdown.
  const manual = await api('POST', '/special-events/fire', { stageId: 'second' });
  assert.equal(manual.status, 200);
  assert.equal(manual.data.state.stageId, 'second');
  assert.equal(manual.data.state.countdownSec, null);
  await until(deckPlaylistName, n => n === 'deep_sea', { what: 'the second stage playlist' });
  await api('POST', '/special-events/abort');
  await api('POST', '/special-events/dismiss');
});

test('a timed stage fires the next stage by itself when nobody taps', async () => {
  await api('POST', '/special-events/arm', { show: 'timed_show' });
  await api('POST', '/special-events/fire', { stageId: 'first' });
  const advanced = await until(state, s => s.stageId === 'second',
    { what: 'the auto-advance to fire', timeoutMs: 12000 });
  assert.equal(advanced.status, 'running');
  await api('POST', '/special-events/abort');
  await api('POST', '/special-events/dismiss');
});

// ── abort ───────────────────────────────────────────────────────────────────

test('ABORT from mid-show restores the pre-show look', async () => {
  await api('POST', '/deck/playlist', { name: 'party_high' });
  const armed = await api('POST', '/special-events/arm', { show: 'bench_reveal' });
  assert.equal(armed.status, 200, JSON.stringify(armed.data));
  await api('POST', '/special-events/fire', { stageId: 'tease' });
  await until(deckPlaylistName, n => n === 'ambient', { what: 'the tease playlist' });
  await api('POST', '/special-events/fire', { stageId: 'blackout' });
  await until(masterValue, m => m <= 0.02, { what: 'the blackout' });

  const r = await api('POST', '/special-events/abort');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.endedReason, 'aborted');
  await until(deckPlaylistName, n => n === 'party_high',
    { what: 'the pre-show playlist after an abort', timeoutMs: 12000 });
  // The abort must lift the blackout stage's master ramp — never leave the
  // ship dark because the show ended mid-blackout.
  await until(masterValue, m => m > 0.9, { what: 'the master back up after an abort' });
  await api('POST', '/special-events/dismiss');
});

// ── PANIC precedence ────────────────────────────────────────────────────────

test('PANIC ends the show WITHOUT a snapshot recall and releases every pulsed effect', async () => {
  await api('POST', '/deck/playlist', { name: 'party_high' });
  await api('POST', '/special-events/arm', { show: 'bench_reveal' });
  await api('POST', '/special-events/fire', { stageId: 'tease' });
  await until(deckPlaylistName, n => n === 'ambient', { what: 'the tease playlist' });
  // Latch a long flash so the release is observable.
  await api('POST', '/special-events/quick-effect', { id: 'vintage_white' });

  const panic = await api('POST', '/mixer/panic', { home: false });
  assert.equal(panic.status, 200, JSON.stringify(panic.data));
  assert.equal(panic.data.rigLit, true);

  const st = await until(state, s => s.status === 'ended', { what: 'the show to end on panic' });
  assert.equal(st.endedReason, 'panic');
  // NO snapshot recall: panic just established a known-good LIT state and the
  // runner must not morph an old look over it.
  assert.equal(await deckPlaylistName(), 'ambient',
    'panic must NOT recall the pre-show snapshot');
  assert.equal((await effectsStatus()).effects.vintageWhite, false,
    'every effect the runner pulsed must be released on panic');
  // Deck content is open again.
  const open = await api('POST', '/deck/playlist', { name: 'party_high' });
  assert.equal(open.status, 200, JSON.stringify(open.data));
  await api('POST', '/special-events/dismiss');
});

test('the e-stop blackout also ends a live show (enable only)', async () => {
  await api('POST', '/special-events/arm', { show: 'bench_reveal' });
  await api('POST', '/special-events/fire', { stageId: 'tease' });
  const on = await api('POST', '/global-effect-macros/blackout', { enabled: true });
  assert.equal(on.status, 200);
  const st = await until(state, s => s.status === 'ended', { what: 'the show to end on e-stop' });
  assert.equal(st.endedReason, 'panic');
  await api('POST', '/global-effect-macros/blackout', { enabled: false });
  await api('POST', '/special-events/dismiss');
});

// ── restart mid-show ────────────────────────────────────────────────────────

test('an engine RESTART mid-show is an abort: it boots restored and ended', async () => {
  await forceIdle();
  await api('POST', '/deck/playlist', { name: 'party_high' });
  const armed = await api('POST', '/special-events/arm', { show: 'bench_reveal' });
  assert.equal(armed.status, 200, JSON.stringify(armed.data));
  await api('POST', '/special-events/fire', { stageId: 'tease' });
  await until(deckPlaylistName, n => n === 'ambient', { what: 'the tease playlist' });

  // The state file is the breadcrumb the recovery reads.
  const stateFile = path.join(h.stateDir, 'special_events_state.yaml');
  const persisted = yaml.load(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'running');
  assert.equal(persisted.showId, 'bench_reveal');

  // Kill it the way a crash / power cut would.
  await h.teardown();
  h.spawnEngine();
  await h.waitForReady();

  const st = await until(state, s => s.status === 'ended',
    { what: 'the boot recovery to land', timeoutMs: 15000 });
  assert.equal(st.endedReason, 'aborted');
  assert.match(st.endedDetail, /restarted mid-show/);
  await until(deckPlaylistName, n => n === 'party_high',
    { what: 'the pre-show playlist restored on boot', timeoutMs: 12000 });

  // And the breadcrumb is cleared, so a second boot does not re-abort.
  const after = yaml.load(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(after.status, 'idle');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';

const TARGET = { channel: 'deck', id: null };

// The Baby show has exactly three playlists — `baby_tease`, `baby_girl`,
// `baby_boy`. `baby_reveal` is the SPECIAL EVENT show id and never a playlist,
// and the old `baby_pink`/`baby_blue` photo-hold playlists are retired (the
// same two words survive only as COLOUR PALETTE ids in config.yaml, which is
// why the palette assertions below still name them).
const TEASE_PLAYLIST = 'baby_tease';
const BOY_PLAYLIST = 'baby_boy';
const GIRL_PLAYLIST = 'baby_girl';
const TEASE_ENTRY = 'e_baby_reveal_orbit_question';

function playlistAction(entryId, palette, celebration = false) {
  return {
    type: 'playlist',
    name: celebration ? BOY_PLAYLIST : TEASE_PLAYLIST,
    ...(entryId ? { entryId } : {}),
    palette,
    target: TARGET,
    autopilot: { active: celebration, delay_s: 90, shuffle: celebration },
    transition: {
      mode: 'trans_crossfade',
      durationMs: celebration ? 3000 : 1,
      enabled: celebration,
      shuffle: false,
    },
    overlays: 'disable',
    colorAutopilot: {
      active: false,
      palettes: [palette],
      delay_s: 60,
      shuffle: false,
      transitionMs: 0,
    },
    hue: 0,
    globals: { speed: 0.5, bpmSpeedSync: 0 },
  };
}

function babyPlan() {
  return {
    schemaVersion: 2,
    name: 'baby_test',
    location: {
      lat: 40.7864,
      lon: -119.2065,
      tz: 'America/Los_Angeles',
      elevationM: 1190,
    },
    autopilot: {
      enabled: true,
      playlist: 'ambient',
      delay_s: 90,
      shuffle: true,
      target: TARGET,
      mood: false,
    },
    phases: {},
    looks: {},
    cues: [{
      id: 'c_baby_reveal_blue',
      label: 'BABY REVEAL - BLUE',
      enabled: true,
      catchUp: false,
      trigger: { type: 'manual' },
      action: {
        type: 'sequence',
        steps: [
          { afterSec: 0, action: playlistAction(TEASE_ENTRY, 'baby_reveal_duet') },
          { afterSec: 992, action: playlistAction(null, 'baby_blue', true) },
        ],
      },
      kind: 'program',
      hold: { min: 120 },
      days: 'all',
    }],
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baby-sequence-'));
  const sceneDir = path.join(root, 'timeline');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(babyPlan(), path.join(sceneDir, 'baby_test.yaml'));

  let now = Date.UTC(2026, 7, 30, 2, 0, 0);
  const calls = {
    loadPlaylist: [],
    setAutopilot: [],
    setParams: [],
  };
  const deps = {
    loadPlaylist: wire => {
      if (wire.entryId === 'missing_entry') throw new Error(`entry "missing_entry" not found in playlist "${TEASE_PLAYLIST}"`);
      calls.loadPlaylist.push(structuredClone(wire));
    },
    setAutopilot: wire => calls.setAutopilot.push(structuredClone(wire)),
    setParams: wire => calls.setParams.push(structuredClone(wire)),
    setMaster: () => {},
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [
      { name: 'ambient' },
      { name: TEASE_PLAYLIST },
      { name: BOY_PLAYLIST },
    ],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => {},
    releaseDeckView: () => {},
    getViewOverrideMode: () => 'deck',
  };
  const service = new TimelineService({
    scene: 'titanic',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true,
      activePlan: 'baby_test',
      tickMs: 1000000,
      colorPalettes: [
        { id: 'baby_reveal_duet', c1: 0.94, c2: 0.56 },
        { id: 'baby_blue', c1: 0.52, c2: 0.61 },
      ],
    },
    nowFn: () => now,
  });
  return {
    service,
    calls,
    setNow: value => { now = value; },
    startMs: now,
  };
}

test('sequence schema preserves exact entries and rejects decreasing offsets', () => {
  const normalized = validateShowPlan(babyPlan());
  const sequence = normalized.cues[0].action;
  assert.equal(sequence.type, 'sequence');
  assert.equal(sequence.steps[0].action.entryId, TEASE_ENTRY);
  assert.equal(sequence.steps[0].action.palette, 'baby_reveal_duet');

  const invalid = babyPlan();
  invalid.cues[0].action.steps[1].afterSec = -1;
  assert.throws(() => validateShowPlan(invalid), /afterSec must be a finite number >= 0/);
});

// This test used to pin `baby_reveal` / `baby_pink` / `baby_blue` as the plan's
// PLAYLIST names, which is how the shipped plan kept pointing at playlists that
// had been deleted: nothing anywhere checked that a timeline playlist action
// names a playlist that EXISTS. The special-event runner has that check
// (`_assertPlaylistsUsable` refuses the ARM by name); the timeline does not, so
// a dangling name is silent until the cue fires in front of the crowd. The
// on-disk assertion at the end of this test is that missing guard, standing in
// until the timeline grows a load-time one of its own.
test('shipped Titanic plan drives the three canonical Baby playlists, and they exist', () => {
  const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const repoRoot = path.resolve(engineDir, '..');
  const config = yaml.load(fs.readFileSync(path.join(engineDir, 'config.yaml'), 'utf8'));
  const paletteIds = new Set(config.colorPalettes.map(palette => palette.id));
  // COLOUR PALETTES, not playlists — these three ids keep their names.
  assert.ok(paletteIds.has('baby_reveal_duet'));
  assert.ok(paletteIds.has('baby_pink'));
  assert.ok(paletteIds.has('baby_blue'));

  const plan = validateShowPlan(yaml.load(fs.readFileSync(
    path.join(repoRoot, 'simulation', 'scenes', 'titanic', 'timeline', 'playa_default.yaml'),
    'utf8',
  )));
  const pink = plan.cues.find(cue => cue.id === 'c_baby_reveal_pink');
  const blue = plan.cues.find(cue => cue.id === 'c_baby_reveal_blue');

  // Both paths open on the SAME outcome-blind tease — the answer only appears
  // in step two, which is the whole point of the reveal.
  assert.equal(pink.action.steps[0].action.name, TEASE_PLAYLIST);
  assert.equal(blue.action.steps[0].action.name, TEASE_PLAYLIST);
  assert.equal(pink.action.steps[0].action.entryId, TEASE_ENTRY);
  assert.equal(blue.action.steps[0].action.entryId, TEASE_ENTRY);
  assert.equal(pink.action.steps[0].action.palette, 'baby_reveal_duet');
  assert.equal(blue.action.steps[0].action.palette, 'baby_reveal_duet');

  assert.equal(pink.action.steps[1].action.name, GIRL_PLAYLIST);
  assert.equal(pink.action.steps[1].action.palette, 'baby_pink');
  assert.equal(blue.action.steps[1].action.name, BOY_PLAYLIST);
  assert.equal(blue.action.steps[1].action.palette, 'baby_blue');
  assert.equal(pink.action.steps[1].afterSec, 992);
  assert.equal(blue.action.steps[1].afterSec, 992);

  // Every playlist this plan names must be on disk, with the named entry.
  const playlistDir = path.join(repoRoot, 'simulation', 'scenes', 'titanic', 'playlists');
  for (const cue of [pink, blue]) {
    for (const step of cue.action.steps) {
      const file = path.join(playlistDir, `${step.action.name}.yaml`);
      assert.equal(fs.existsSync(file), true,
        `${cue.id} fires playlist "${step.action.name}" which does not exist`);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      assert.ok(doc.entries.length > 0, `${step.action.name}.yaml has no entries`);
      if (!step.action.entryId) continue;
      assert.ok(doc.entries.some(entry => entry.id === step.action.entryId),
        `${cue.id} names entry "${step.action.entryId}" which ${step.action.name}.yaml does not define`);
    }
  }
});

test('baby sequence starts exact entry at zero and celebrates at exactly 992 seconds', async () => {
  const { service, calls, setNow, startMs } = setup();
  await service.start();
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;
  calls.setParams.length = 0;
  try {
    await service.fireCue('c_baby_reveal_blue');
    assert.deepEqual(calls.loadPlaylist[0], {
      target: { kind: 'deck' },
      name: TEASE_PLAYLIST,
      entryId: TEASE_ENTRY,
    });
    assert.equal(service.getState().activeSequence?.nextInSec, 992);
    assert.ok(calls.setParams.some(call => call.colorPalette1?.h === 0.94));
    assert.ok(calls.setParams.some(call => call.speed === 0.5 && call.bpmSpeedSync === 0));

    setNow(startMs + 991999);
    await service._advanceSequence(startMs + 991999);
    assert.equal(calls.loadPlaylist.length, 1, 'celebration must not start early');

    setNow(startMs + 992000);
    await service._advanceSequence(startMs + 992000);
    assert.equal(calls.loadPlaylist.length, 2);
    assert.deepEqual(calls.loadPlaylist[1], {
      target: { kind: 'deck' },
      name: BOY_PLAYLIST,
      entryId: null,
    });
    assert.equal(service.getState().activeSequence, null);
    assert.equal(service.getState().lastSequence?.status, 'completed');
  } finally {
    service.stop();
  }
});

test('refire restarts and operator takeover cancels pending sequence', async () => {
  const { service, calls, setNow, startMs } = setup();
  await service.start();
  calls.loadPlaylist.length = 0;
  try {
    await service.fireCue('c_baby_reveal_blue');
    setNow(startMs + 30000);
    await service._applyAction(service.plan.cues[0].action, { cueId: 'c_baby_reveal_blue' });
    assert.equal(service.getState().activeSequence?.nextInSec, 992);
    assert.equal(calls.loadPlaylist.length, 2, 'refire must reload the exact reveal entry');

    service.takeover();
    assert.equal(service.getState().activeSequence, null);
    assert.equal(service.getState().lastSequence?.status, 'cancelled');
    assert.match(service.getState().lastSequence?.reason || '', /operator takeover/);
  } finally {
    service.stop();
  }
});

test('explicit unknown entry fails loudly and never falls back', async () => {
  const { service, calls } = setup();
  await service.start();
  calls.loadPlaylist.length = 0;
  try {
    await assert.rejects(
      service._applyAction({
        ...playlistAction('missing_entry', 'baby_reveal_duet'),
        entryId: 'missing_entry',
      }),
      /entry "missing_entry" not found/,
    );
    assert.equal(calls.loadPlaylist.length, 0);
  } finally {
    service.stop();
  }
});

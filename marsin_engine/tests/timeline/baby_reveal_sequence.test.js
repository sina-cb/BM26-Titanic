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
// ONE answer playlist now serves both outcomes (docs/73). `baby_boy` and
// `baby_girl` are retired: the family is carried by `colorPalette1` — the
// colour the patterns render and derive their dark tone from — not by which
// playlist fires. The two names below are kept as aliases only so the fixtures
// below read as "the answer", whichever side fired it.
const REVEAL_PLAYLIST = 'baby_reveal';
// The hero (docs/73 §5 K06): the look that rises under the white bloom, pinned
// by entryId so playlist order and later curation cannot move it.
const REVEAL_ENTRY = 'e_baby_reveal_diamond_quilt';
const BOY_PLAYLIST = REVEAL_PLAYLIST;
const GIRL_PLAYLIST = REVEAL_PLAYLIST;
// Was `e_baby_tease_two_color_world_walk` until the tease redesign (`_300`)
// retired that look; `_305` §2.4 catalogued the resulting dangling cue. The
// shipped plan now pins the tease arc's own calm opener.
const TEASE_ENTRY = 'e_baby_tease_bullseye_tide';

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
test('shipped Titanic plan drives the two canonical Baby playlists, and they exist', () => {
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

  // THE ANSWER IS A COLOUR NOW, NOT A PLAYLIST (docs/73, PALETTE CONTRACT v2).
  // Both cues fire the SAME `baby_reveal` list, pinned to the hero entry; what
  // differs is `colorPalette1`, which IS the answer — the patterns render that
  // colour and derive their own dark tone from it. A curated `palette:` id
  // cannot carry it: those are hue-only (s=1, v=1) and would OVERWRITE
  // colorPalette1, i.e. change the answer's colour. So the answer rides in the
  // step's `globals`, and this is the assertion that stops someone
  // "simplifying" it back to a `palette:` key.
  assert.equal(pink.action.steps[1].action.name, REVEAL_PLAYLIST);
  assert.equal(blue.action.steps[1].action.name, REVEAL_PLAYLIST);
  assert.equal(pink.action.steps[1].action.entryId, REVEAL_ENTRY,
    'the answer step pins the hero entry, not whatever the playlist happens to open on');
  assert.equal(blue.action.steps[1].action.entryId, REVEAL_ENTRY,
    'the answer step pins the hero entry, not whatever the playlist happens to open on');
  assert.equal(pink.action.steps[1].action.palette, undefined,
    'a curated palette on the answer step would overwrite colorPalette1 — the ANSWER\'S COLOUR');
  assert.equal(blue.action.steps[1].action.palette, undefined,
    'a curated palette on the answer step would overwrite colorPalette1 — the ANSWER\'S COLOUR');

  const darkK = 0.28;
  for (const [cue, hue, sat] of [[pink, 0.943869, 0.965], [blue, 0.594795, 0.967]]) {
    const globals = cue.action.steps[1].action.globals;
    assert.ok(globals, `${cue.id}: the answer step must write the palette in its globals`);
    assert.equal(globals.colorTransitionMs, 0,
      `${cue.id}: the palette must SNAP — a slewed palette crosses the wheel through an `
      + 'INTERMEDIATE HUE, showing a wrong colour on the ship during the reveal');
    assert.deepEqual(globals.colorPalette1, { h: hue, s: sat, v: 1.0 },
      `${cue.id}: colorPalette1 IS the answer — a Baby family hue at full value`);
    assert.deepEqual(globals.colorPalette2, { h: hue, s: sat, v: darkK },
      `${cue.id}: slot 2 mirrors the same hue at the dark tone. The patterns do NOT read it — it `
      + 'is written so the global palette pair matches the tones the ship is showing');
  }
  // The two cues must never write each other's family.
  assert.notEqual(pink.action.steps[1].action.globals.colorPalette1.h,
    blue.action.steps[1].action.globals.colorPalette1.h);
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

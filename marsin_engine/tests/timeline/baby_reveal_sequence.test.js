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

function playlistAction(entryId, palette, celebration = false) {
  return {
    type: 'playlist',
    name: celebration ? 'baby_blue' : 'baby_reveal',
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
          { afterSec: 0, action: playlistAction('e_baby_reveal_blue', 'baby_reveal_duet') },
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
      if (wire.entryId === 'missing_entry') throw new Error('entry "missing_entry" not found in playlist "baby_reveal"');
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
      { name: 'baby_reveal' },
      { name: 'baby_blue' },
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
  assert.equal(sequence.steps[0].action.entryId, 'e_baby_reveal_blue');
  assert.equal(sequence.steps[0].action.palette, 'baby_reveal_duet');

  const invalid = babyPlan();
  invalid.cues[0].action.steps[1].afterSec = -1;
  assert.throws(() => validateShowPlan(invalid), /afterSec must be a finite number >= 0/);
});

test('shipped Titanic plan and palette catalog contain both explicit reveal paths', () => {
  const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const repoRoot = path.resolve(engineDir, '..');
  const config = yaml.load(fs.readFileSync(path.join(engineDir, 'config.yaml'), 'utf8'));
  const paletteIds = new Set(config.colorPalettes.map(palette => palette.id));
  assert.ok(paletteIds.has('baby_reveal_duet'));
  assert.ok(paletteIds.has('baby_pink'));
  assert.ok(paletteIds.has('baby_blue'));

  const plan = validateShowPlan(yaml.load(fs.readFileSync(
    path.join(repoRoot, 'simulation', 'scenes', 'titanic', 'timeline', 'playa_default.yaml'),
    'utf8',
  )));
  const pink = plan.cues.find(cue => cue.id === 'c_baby_reveal_pink');
  const blue = plan.cues.find(cue => cue.id === 'c_baby_reveal_blue');
  assert.equal(pink.action.steps[0].action.entryId, 'e_baby_reveal_pink');
  assert.equal(pink.action.steps[1].action.name, 'baby_pink');
  assert.equal(pink.action.steps[1].action.palette, 'baby_pink');
  assert.equal(blue.action.steps[0].action.entryId, 'e_baby_reveal_blue');
  assert.equal(blue.action.steps[1].action.name, 'baby_blue');
  assert.equal(blue.action.steps[1].action.palette, 'baby_blue');
  assert.equal(pink.action.steps[1].afterSec, 992);
  assert.equal(blue.action.steps[1].afterSec, 992);
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
      name: 'baby_reveal',
      entryId: 'e_baby_reveal_blue',
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
      name: 'baby_blue',
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

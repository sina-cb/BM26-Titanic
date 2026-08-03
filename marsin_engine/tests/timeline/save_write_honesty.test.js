/*
 * save_write_honesty.test.js — regression for L5 (reports _116 / _115):
 * a failed state write must NOT report success (the CaptainPad "✓ SAVED" badge
 * reads the response — a 200 {saved:true} on a disk-full/EBUSY write is a lie).
 *
 * For the timeline state the engine persists through its endpoints, the write
 * goes through `saveTimelineState` (raw writeFileSync + renameSync, which THROW
 * on failure) and `_persistAndBroadcast` does NOT swallow — so a write failure
 * propagates out of the service method and the endpoint returns a non-200
 * instead of {saved:true}. This pins both halves.
 *
 * NOTE (handoff, not tested here): `StateManager.save()` (lib/state_manager.js,
 * a shared engine core OUTSIDE this thread's exclusive file lane) still SWALLOWS
 * the atomic-write error with only a console.warn, so the deck/mixer/globals
 * branch of POST /settings/save-now can still succeed silently on a failed
 * write. That swallow is the remaining L5 root; the save-now handler is now
 * honest the moment it becomes a throw. See report _116.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';
import {
  saveTimelineState, defaultTimelineState,
} from '../../lib/timeline/timeline_state.js';

test('L5: saveTimelineState THROWS when the write cannot land (unlike a swallow)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l5-'));
  // Make the "state dir" a FILE, so the atomic write into <dir>/…tmp fails.
  const stateDir = path.join(dir, 'state');
  fs.writeFileSync(stateDir, 'not a directory', 'utf8');
  assert.throws(() => saveTimelineState(defaultTimelineState(), stateDir));
});

test('L5: a persist failure PROPAGATES out of setPartyConfig (endpoint → non-200, not saved:true)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l5-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const plan = {
    schemaVersion: 2,
    name: 'l5_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    festival: { startDate: '2026-08-25', days: 10 },
    autopilot: { enabled: true, playlist: 'ambient', delay_s: 45, shuffle: true, target: { channel: 'deck', id: null }, mood: true },
    phases: {},
    looks: { ambient: { playlist: 'ambient' } },
    defaultCue: { label: 'Ambient', action: { type: 'look', look: 'ambient' } },
    cues: [],
  };
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const svc = new TimelineService({
    scene: 'test_bench', sceneDir, stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps: {
      loadPlaylist: () => {}, setAutopilot: () => {}, setParams: () => {}, requestScene: () => {},
      patchScheduledTask: () => {}, fireScheduledTask: () => {}, listMixerChannelIds: () => [],
      listPlaylists: () => ['ambient'], setDeckTransition: () => {}, setDeckOverlaysEnabled: () => {},
      setColorAutopilot: () => {}, forceDeckView: () => {}, releaseDeckView: () => {},
      getViewOverrideMode: () => null,
    },
    broadcast: () => {},
    config: { enabled: true, activePlan: plan.name, tickMs: 1000, mood: { key: 'audioPartyStrong', partyThreshold: 0.5 }, colorPalettes: [] },
    nowFn: () => Date.UTC(2026, 7, 30, 6, 0, 0),
  });
  await svc.start();
  svc.stop();
  // Now break the state dir: replace it with a FILE so the next persist fails.
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.writeFileSync(stateDir, 'now a file', 'utf8');
  // A valid config edit whose only remaining step is the persist: it must REJECT
  // (the endpoint's try/catch turns this into a non-200), never resolve as saved.
  await assert.rejects(() => svc.setPartyConfig({ minDwellSec: 5 }),
    'a failed persist must propagate, not silently report success');
});

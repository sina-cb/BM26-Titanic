import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendAutoViews } from '../../lib/view_catalog.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';
import { loadModelForGauge } from '../../lib/model_loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const profilesRuntime = require(path.resolve(
  here, '../../../docs/ui/touch_control_group_profiles.js'));
const profilesSource = fs.readFileSync(path.resolve(
  here, '../../../docs/ui/touch_control_group_profiles.js'), 'utf8');

async function liveCatalog() {
  const model = await loadModelForGauge('titanic');
  appendAutoViews(model.pixels, model.viewMasks, model.groupBits);
  const registry = buildMaskRegistry({
    pixels: model.pixels,
    pixelCount: model.pixelCount,
    groupBits: model.groupBits,
    viewMasks: model.viewMasks,
  });
  const groupCounts = new Map();
  for (const pixel of model.pixels) {
    groupCounts.set(pixel.group, (groupCounts.get(pixel.group) || 0) + 1);
  }
  const namedViews = registry.names().map((name) => {
    const entry = registry.get(name);
    const counts = new Map();
    let memberCount = 0;
    entry.members.forEach((member, index) => {
      if (!member) return;
      memberCount++;
      const group = model.pixels[index].group;
      counts.set(group, (counts.get(group) || 0) + 1);
    });
    const groupNames = [];
    const partialGroupNames = [];
    for (const [group, count] of counts) {
      (count === groupCounts.get(group) ? groupNames : partialGroupNames).push(group);
    }
    return {
      name,
      kind: entry.kind,
      bit: entry.bit,
      memberCount,
      groupNames: groupNames.sort(),
      partialGroupNames: partialGroupNames.sort(),
    };
  });
  return { groups: [...groupCounts.keys()].sort(), namedViews };
}

test('Live Touch exposes individual plus two exact canonical-view profiles', async () => {
  const catalog = await liveCatalog();
  const profiles = profilesRuntime.compileProfiles(catalog);
  assert.deepEqual(profiles.map((profile) => profile.id),
    ['individual', 'instruments', 'planes']);
  assert.deepEqual(profiles[1].channels.map((channel) => channel.name),
    ['Hull Canvas', 'Silhouette', 'Jewelry', 'Organs', 'Identity']);
  assert.deepEqual(profiles[2].channels.map((channel) => channel.name),
    ['FRONT', 'BACK', 'Organs', 'Identity']);
  assert.deepEqual(profiles[1].channels.map((channel) => channel.memberCount),
    [360, 320, 96, 40, 148]);
  assert.deepEqual(profiles[2].channels.map((channel) => channel.memberCount),
    [388, 388, 40, 148]);

  for (const profile of profiles.filter((candidate) => candidate.channels)) {
    const flattened = profile.channels.flatMap((channel) => channel.groups);
    assert.equal(flattened.length, catalog.groups.length);
    assert.deepEqual([...new Set(flattened)].sort(), catalog.groups,
      `${profile.id} must partition all 24 groups exactly once`);
  }
});

test('profile compilation fails loudly on stale, partial, or overlapping views', async () => {
  const catalog = await liveCatalog();
  const stale = structuredClone(catalog);
  stale.namedViews = stale.namedViews.filter((view) => view.name !== 'Identity');
  assert.throws(() => profilesRuntime.compileProfiles(stale), /unknown view 'Identity'/);

  const partial = structuredClone(catalog);
  partial.namedViews.find((view) => view.name === 'FRONT').partialGroupNames = ['Right Front Wall'];
  assert.throws(() => profilesRuntime.compileProfiles(partial), /cuts through group/);

  const overlap = structuredClone(catalog);
  overlap.namedViews.find((view) => view.name === 'Identity').groupNames.push('Left Auditorium');
  assert.throws(() => profilesRuntime.compileProfiles(overlap), /overlaps group 'Left Auditorium'/);
});

test('profile faders have keyboard semantics and a window-level final flush', () => {
  assert.match(profilesSource, /setAttribute\('role', 'slider'\)/);
  assert.match(profilesSource, /setAttribute\('aria-valuenow'/);
  assert.match(profilesSource, /event\.key === 'Home'/);
  assert.match(profilesSource, /root\.addEventListener\('pointerup'/);
  assert.match(profilesSource, /root\.addEventListener\('pointercancel'/);
  assert.match(profilesSource, /setAttribute\('role', 'button'\)/);
  assert.match(profilesSource, /setAttribute\('aria-pressed'/);
});

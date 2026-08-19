/**
 * url_canonicalization.test.js — bare sim URLs become explicit show defaults.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SIM_URL_BOOT_DEFAULTS,
  SIM_URL_CANONICAL_KEYS,
  canonicalUrlSearchString,
  resolveCanonicalUrlSearchParams,
  canonicalizeBrowserLocation,
} from '../src/core/url_canonicalization.js';
import {
  explicitBenchMirrorRequested,
  shouldAutoDisarmStaleBenchMirror,
} from '../src/core/bench_mirror_boot_policy.js';
import { applyBootUrlOverrides } from '../src/core/url_overrides.js';
import { params, configTree, setConfigTree } from '../src/core/state.js';
import { bannerStateForStatus } from '../src/gui/bench_mirror_banner.js';
import { benchMirrorControlState } from '../src/gui/bench_mirror_control.js';

const CANONICAL =
  'scene=titanic&profile=2d_pixels&lighting_mode=sacn_in&spotlights=0';

test('pins the prod show-default query contract', () => {
  assert.deepEqual(SIM_URL_BOOT_DEFAULTS, {
    scene: 'titanic',
    profile: '2d_pixels',
    lighting_mode: 'sacn_in',
    spotlights: '0',
  });
  assert.deepEqual(SIM_URL_CANONICAL_KEYS,
    ['scene', 'profile', 'lighting_mode', 'spotlights']);
});

test('bare URL fills every canonical key', () => {
  const { params: out, changed, filled } = resolveCanonicalUrlSearchParams('');
  assert.equal(changed, true);
  assert.deepEqual(filled,
    ['scene', 'profile', 'lighting_mode', 'spotlights']);
  assert.equal(canonicalUrlSearchString(out), CANONICAL);
});

test('explicit present-but-empty canonical keys are preserved, not replaced', () => {
  const { params: out, filled } = resolveCanonicalUrlSearchParams('?scene=&profile=full');
  assert.deepEqual(filled, ['lighting_mode', 'spotlights']);
  assert.equal(out.get('scene'), '');
  assert.equal(out.get('profile'), 'full');
  assert.equal(out.get('lighting_mode'), 'sacn_in');
  assert.equal(out.get('spotlights'), '0');
});

test('partial URL fills only missing canonical keys and preserves explicit values', () => {
  const { params: out, filled } = resolveCanonicalUrlSearchParams(
    '?scene=test_bench&profile=full&renderer=webgl&theme=ocean',
  );
  assert.deepEqual(filled, ['lighting_mode', 'spotlights']);
  assert.equal(out.get('scene'), 'test_bench');
  assert.equal(out.get('profile'), 'full');
  assert.equal(out.get('renderer'), 'webgl');
  assert.equal(out.get('theme'), 'ocean');
  assert.equal(out.get('lighting_mode'), 'sacn_in');
  assert.equal(out.get('spotlights'), '0');
});

test('canonical string uses stable key order even when the input was shuffled', () => {
  const shuffled = resolveCanonicalUrlSearchParams(
    '?spotlights=0&lighting_mode=sacn_in&profile=2d_pixels&scene=titanic&renderer=webgl',
  );
  assert.equal(
    canonicalUrlSearchString(shuffled.params),
    `${CANONICAL}&renderer=webgl`,
  );
});

test('canonicalizeBrowserLocation rewrites the address bar once without reload', () => {
  const calls = [];
  const location = { pathname: '/simulation/', search: '', hash: '' };
  const history = {
    state: { boot: 1 },
    replaceState(_state, _title, href) {
      calls.push(href);
      const q = href.indexOf('?');
      location.search = q === -1 ? '' : href.slice(q);
    },
  };

  const first = canonicalizeBrowserLocation(location, history);
  assert.equal(first.changed, true);
  assert.equal(first.href, `/simulation/?${CANONICAL}`);
  assert.equal(calls.length, 1);

  const second = canonicalizeBrowserLocation(location, history);
  assert.equal(second.changed, false);
  assert.equal(calls.length, 1, 'a second pass must not loop replaceState');
});

test('boot overrides honor the canonical default spotlights=0', () => {
  const tree = {
    options: { lightingProfile: { value: 'full' }, rendererMode: { value: 'webgl' } },
    colorWave: { lightingMode: { value: 'gradient' } },
    parLights: { maxSpotlights: { value: 150 } },
  };
  setConfigTree(tree);
  params.lightingProfile = 'full';
  params.lightingMode = 'gradient';
  params.rendererMode = 'webgl';
  params.maxSpotlights = 150;

  applyBootUrlOverrides(new URLSearchParams(`?${CANONICAL}`),
    { confirmSpotlightOverCap: () => false });

  assert.equal(params.lightingProfile, '2d_pixels');
  assert.equal(params.lightingMode, 'sacn_in');
  assert.equal(params.maxSpotlights, 0);
});

test('bench mirror boot policy: default URL disarms stale mirror; explicit param does not', () => {
  assert.equal(shouldAutoDisarmStaleBenchMirror(new URLSearchParams(`?${CANONICAL}`)), true);
  assert.equal(explicitBenchMirrorRequested(new URLSearchParams('?bench_mirror=1')), true);
  assert.equal(shouldAutoDisarmStaleBenchMirror(new URLSearchParams('?bench_mirror=1')), false);
  assert.equal(explicitBenchMirrorRequested(new URLSearchParams('?bench_mirror=armed')), true);
  assert.equal(explicitBenchMirrorRequested(new URLSearchParams('?bench_mirror=0')), false);
  assert.equal(explicitBenchMirrorRequested(new URLSearchParams('?bench_mirror=maybe')), false);
  assert.equal(shouldAutoDisarmStaleBenchMirror(new URLSearchParams('?bench_mirror=maybe')), true);
});

test('bench mirror control: link down and unknown status disable ARM without arming', () => {
  const down = benchMirrorControlState(null, { connected: false });
  assert.equal(down.disabled, true);
  assert.equal(down.action, null);
  assert.match(down.statusText, /LINK DOWN/);

  const unknown = benchMirrorControlState(null, { connected: true });
  assert.equal(unknown.disabled, true);
  assert.equal(unknown.action, null);
  assert.match(unknown.statusText, /UNKNOWN/);
});

test('armed bench mirror suspends ship output in banner + control state (ARM unavailable)', () => {
  const status = {
    armed: true,
    scene: 'test_bench',
    sourceScene: 'titanic',
    label: 'TEST BENCH STAND-IN',
    destinations: [{ universe: 2, ip: '10.1.1.10' }],
    selection: [{ slot: 'bar_left', source: 'Left Front Wall 9', reverse: true }],
  };
  const banner = bannerStateForStatus(status);
  assert.match(banner.text, /BENCH MIRROR ACTIVE/);
  assert.match(banner.text, /ALL SHIP OUTPUT SUSPENDED/);

  const control = benchMirrorControlState(status, { connected: true });
  assert.match(control.statusText, /ACTIVE/);
  assert.equal(control.action, 'disarm');
  assert.equal(control.disabled, false);
  assert.match(control.noticeText, /SHIP OUTPUT SUSPENDED/);
});

test('disarmed mirror leaves ARM available when exactly one sidecar is armable', () => {
  const status = {
    armed: false,
    available: [{ scene: 'test_bench', label: 'TEST BENCH STAND-IN', slots: 10 }],
    selection: [],
  };
  const control = benchMirrorControlState(status, { connected: true });
  assert.match(control.statusText, /OFF/);
  assert.equal(control.action, 'arm');
  assert.equal(control.disabled, false);
  assert.equal(control.armScene, 'test_bench');
});

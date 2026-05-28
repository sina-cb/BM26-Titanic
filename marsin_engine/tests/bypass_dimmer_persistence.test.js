/**
 * tests/bypass_dimmer_persistence.test.js
 *
 * The dimmer-rack BypassCheckbox sets `*BypassDimmer` flags on the
 * GlobalEffectsController. Pre-fix, those flags were written into
 * globals_state.yaml and reloaded on the next engine boot — which
 * meant an operator's mid-show "bypass dimmer for this one cue"
 * choice leaked into every future session. Scheduler fires (and
 * GEM-slot taps) of vintageWhite/blastWhite/uvBlast would then ignore
 * the dimmer rack with no visible cause.
 *
 * Fix: bypass-dimmer flags are session-scoped. The save path strips
 * them; the load/apply path also skips them defensively (so existing
 * YAML files with bypass:true don't leak through on first boot after
 * the upgrade).
 *
 * Run:  node --test tests/bypass_dimmer_persistence.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import yaml from 'js-yaml';

import { StateManager } from '../lib/state_manager.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bypass_${label}_`));
}

test('saveGlobalsState strips *BypassDimmer keys before writing', () => {
  const dir = tmpDir('save');
  const sm = new StateManager(dir);
  const globalsState = {
    blackout: false,
    effects: {
      vintageWhite: true,
      vintageWhiteBypassDimmer: true,
      blastWhiteBypassDimmer: true,
      uvBlastBypassDimmer: true,
      fogger: false,
    },
    dimmers: {},
  };
  sm.saveGlobalsState(globalsState);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'globals_state.yaml'), 'utf8'));
  assert.equal(onDisk.effects.vintageWhite, true, 'non-bypass effects persist');
  assert.equal(onDisk.effects.fogger, false, 'non-bypass effects persist');
  assert.ok(!('vintageWhiteBypassDimmer' in onDisk.effects), 'bypass key stripped');
  assert.ok(!('blastWhiteBypassDimmer' in onDisk.effects), 'bypass key stripped');
  assert.ok(!('uvBlastBypassDimmer' in onDisk.effects), 'bypass key stripped');

  // The in-memory state passed in must NOT be mutated — the operator
  // is still looking at it.
  assert.equal(globalsState.effects.vintageWhiteBypassDimmer, true,
    'live state not mutated by save');
});

test('applyGlobalsState skips *BypassDimmer keys when loading legacy YAML', () => {
  // Simulate loading a file written by the pre-fix engine, which DID
  // persist bypass flags. They must not propagate into the controller.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.effects.vintageWhiteBypassDimmer = false; // baseline

  const sm = new StateManager(tmpDir('apply'));
  sm.applyGlobalsState(
    {
      effects: {
        vintageWhite: true,
        vintageWhiteBypassDimmer: true, // ← legacy leak attempt
        blastWhiteBypassDimmer: true,
      },
    },
    null, null, ctrl,
  );
  assert.equal(ctrl.effects.vintageWhite, true, 'non-bypass effect applied');
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, false, 'bypass NOT applied from yaml');
  assert.equal(ctrl.effects.blastWhiteBypassDimmer, false, 'bypass NOT applied from yaml');
});

test('operator-driven setEffect on bypass key still works (live source of truth)', () => {
  // The dimmer-rack BypassCheckbox calls setEffect('vintageWhiteBypassDimmer', true)
  // at runtime. That live path must NOT be blocked by the persistence fix.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.setEffect('vintageWhiteBypassDimmer', true);
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, true);
  ctrl.setEffect('vintageWhiteBypassDimmer', false);
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, false);
});

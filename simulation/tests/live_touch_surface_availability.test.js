import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PANEL_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html'), 'utf8');
const WIRE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_wire.js'), 'utf8');

test('panel mounts the engine-unavailable curtain and blocks mutation chrome', () => {
  assert.match(PANEL_SOURCE, /id="liveTouchUnavailable"/);
  assert.match(PANEL_SOURCE, /livetouchavailability/);
  assert.match(PANEL_SOURCE, /is-engine-unavailable/);
  assert.match(PANEL_SOURCE, /NOT AVAILABLE/);
});

test('wire publishes availability from online and protocol readiness', () => {
  assert.match(WIRE_SOURCE, /function liveTouchAvailabilityDetail/);
  assert.match(WIRE_SOURCE, /livetouchavailability/);
  assert.match(WIRE_SOURCE, /surfaceAvailable/);
  assert.match(WIRE_SOURCE, /NOT AVAILABLE/);
  assert.match(WIRE_SOURCE, /_publishLiveTouchAvailability/);
  assert.match(WIRE_SOURCE, /markAvailabilityKnown/);
});

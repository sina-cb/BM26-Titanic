import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTICE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_spatial_contact_notice.js'),
  'utf8',
);
const WIRE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js'),
  'utf8',
);
const PANEL_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control.html'),
  'utf8',
);

function bootNotice() {
  function CustomEvent(name, init) {
    this.type = name;
    this.detail = init && init.detail ? init.detail : undefined;
  }
  const events = [];
  const timers = [];
  let now = 0;
  const context = {
    SpatialContactNotice: undefined,
    CustomEvent,
    Date: {
      now() { return now; },
    },
    setTimeout(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + ms, ms });
      return id;
    },
    clearTimeout(id) {
      for (let i = 0; i < timers.length; i += 1) {
        if (timers[i].id === id) timers.splice(i, 1);
      }
    },
    document: {
      dispatchEvent(event) {
        events.push({
          type: event.type,
          detail: JSON.parse(JSON.stringify(event.detail || {})),
        });
      },
    },
    window: null,
  };
  context.window = context;
  vm.runInNewContext(NOTICE_SOURCE, context, {
    filename: 'touch_control_spatial_contact_notice.js',
  });
  return {
    notice: context.SpatialContactNotice,
    events,
    timers,
    advance(ms) { now += ms; },
    fireDue() {
      const due = timers.filter((entry) => entry.at <= now);
      timers.splice(0, timers.length, ...timers.filter((entry) => entry.at > now));
      due.forEach((entry) => entry.fn());
    },
  };
}

test('SpatialContactNotice emits one deduped status notice with 3 s TTL', () => {
  const boot = bootNotice();
  boot.notice.show();
  boot.notice.show();
  assert.equal(boot.events.length, 2, 'repeat while visible still refreshes the single notice');
  assert.equal(boot.events[0].detail.role, 'status');
  assert.equal(boot.events[0].detail.ttlMs, 3000);
  assert.match(boot.events[0].detail.message, /SPATIAL contact limit reached/);
  assert.equal(boot.timers.length, 1);
  boot.advance(2999);
  boot.fireDue();
  assert.ok(boot.notice.isVisible(), 'notice stays up until TTL elapses after last repeat');
  boot.advance(2);
  boot.fireDue();
  assert.equal(boot.notice.isVisible(), false);
  assert.equal(boot.events.at(-1).detail.message, '');
});

test('SpatialContactNotice cleanup clears timer and status on disarm/unmount', () => {
  const boot = bootNotice();
  boot.notice.show();
  boot.notice.cleanup();
  assert.equal(boot.notice.isVisible(), false);
  assert.equal(boot.events.at(-1).detail.message, '');
  assert.equal(boot.timers.length, 0);
});

test('wire routes spatial contact limit to status notice instead of fail()', () => {
  assert.match(PANEL_SOURCE, /touch_control_spatial_contact_notice\.js/);
  assert.match(PANEL_SOURCE, /SpatialContactNotice\.show\(\)/);
  assert.match(PANEL_SOURCE, /id="panelStatus" role="status" aria-live="polite"/);
  assert.match(WIRE_SOURCE, /SpatialContactNotice\.show\(\)/);
  assert.match(WIRE_SOURCE, /msg === window\.SpatialContactNotice\.MESSAGE/);
  assert.match(WIRE_SOURCE, /SpatialContactNotice\.cleanup\(\)/);
});

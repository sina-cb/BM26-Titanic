// Tests for the LED controller GAMMA feature (report 20260725_29):
// the scene mirror (controllers.yaml → led.wire.controllerGamma), its
// validation, the mirror↔hardware sync discipline, and the sequential fleet
// push with per-controller results.
//
// The contract under test:
//   - a curve outside the controller's accepted 1.0–3.0 range is refused
//     LOUDLY, at the field, and never reaches the mirror;
//   - a push writes the HARDWARE-VERIFIED values into the mirror and stamps
//     device.lastGammaPush — mirror and hardware can never silently diverge;
//   - a FAILED push leaves the mirror untouched and names the controller;
//   - a fleet push is sequential, reports every controller (ok / failed /
//     unreachable / skipped), and one failure never aborts the rest.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAMMA_CURVE_GEOMETRY,
  LED_GAMMA_MIN,
  LED_GAMMA_MAX,
  LED_GAMMA_PRESETS,
  LED_GAMMA_RECOMMENDED,
  LED_GAMMA_STEP,
  activeGammaPresetKey,
  commitGammaPush,
  formatGamma,
  gammaCurvePath,
  gammaEquals,
  parseGammaField,
  pushGammaFleet,
  pushGammaToController,
  quantizeGamma,
  readGammaMirror,
  setGammaMirror,
  summarizeFleetResults,
  validateGammaMirror,
} from '../src/dmx/led/led_gamma.js';
import {
  normalizeDeviceBlock,
  recordDeviceGammaPush,
  normalizeLedConfig,
} from '../src/dmx/controller_registry.js';

function ledController(overrides = {}) {
  return {
    id: 1,
    name: 'LED A',
    ip: '10.0.0.5',
    type: 'LED',
    protocol: 'sACN',
    ports: [],
    led: normalizeLedConfig({ order: 'RGBW' }, 'LED A'),
    ...overrides,
  };
}

function boundLedController(overrides = {}) {
  return ledController({
    device: normalizeDeviceBlock(
      { vendor: 'marsinled', controllerId: 'bench_1', deviceName: 'Bench-1', boardId: 'angio4-old' },
      'LED A'),
    ...overrides,
  });
}

// ── Mirror read / validation ────────────────────────────────────────────────

test('readGammaMirror returns the scene mirror, or the wire default when unset', () => {
  // No mirror in the scene ⇒ the wire default, which is the curve OFF
  // (1/1/1/1) — the preview must not invent a correction the hardware may not
  // be running.
  const bare = ledController();
  assert.deepEqual(readGammaMirror(bare), { r: 1, g: 1, b: 1, w: 1 });

  const withMirror = ledController({
    led: normalizeLedConfig({ order: 'RGBW', wire: { controllerGamma: { r: 2, g: 2.4, b: 2, w: 1 } } },
      'LED A'),
  });
  assert.deepEqual(readGammaMirror(withMirror), { r: 2, g: 2.4, b: 2, w: 1 });
});

test('validateGammaMirror enforces the controller-accepted range and the key set', () => {
  assert.deepEqual(validateGammaMirror({ r: 2.2, g: 2.2, b: 2.2, w: 1 }),
    { r: 2.2, g: 2.2, b: 2.2, w: 1 });
  assert.throws(() => validateGammaMirror({ r: 0.9, g: 2, b: 2, w: 1 }), /must be a number in/);
  assert.throws(() => validateGammaMirror({ r: 3.1, g: 2, b: 2, w: 1 }), /must be a number in/);
  assert.throws(() => validateGammaMirror({ r: 2, g: 2, b: 2 }), /\.w/);
  assert.throws(() => validateGammaMirror({ r: 2, g: 2, b: 2, w: 1, x: 1 }), /unknown key/);
  assert.throws(() => validateGammaMirror(2.2), /must be an object/);
});

test('validateGammaMirror names the offending channel on the error', () => {
  try {
    validateGammaMirror({ r: 2.2, g: 9, b: 2.2, w: 1 });
    assert.fail('expected a throw');
  } catch (err) {
    assert.equal(err.channel, 'g');
  }
});

test('parseGammaField rejects empty / non-numeric / out-of-range input loudly', () => {
  assert.equal(parseGammaField('2.3', 'g'), 2.3);
  assert.equal(parseGammaField(' 1 ', 'w'), 1);
  assert.throws(() => parseGammaField('', 'r'), /is empty/);
  assert.throws(() => parseGammaField('   ', 'r'), /is empty/);
  assert.throws(() => parseGammaField('bright', 'r'), /is not a number/);
  assert.throws(() => parseGammaField(String(LED_GAMMA_MIN - 0.1), 'r'), /outside/);
  assert.throws(() => parseGammaField(String(LED_GAMMA_MAX + 0.1), 'r'), /outside/);
});

test('gammaEquals / formatGamma', () => {
  assert.ok(gammaEquals({ r: 2.2, g: 2.2, b: 2.2, w: 1 }, { r: 2.2, g: 2.2, b: 2.2, w: 1 }));
  assert.ok(!gammaEquals({ r: 2.2, g: 2.2, b: 2.2, w: 1 }, { r: 2.2, g: 2.3, b: 2.2, w: 1 }));
  assert.ok(!gammaEquals(null, { r: 1, g: 1, b: 1, w: 1 }));
  assert.equal(formatGamma({ r: 2.2, g: 2.2, b: 2.2, w: 1 }), '2.2 / 2.2 / 2.2 / 1');
});

// ── Mirror writes ───────────────────────────────────────────────────────────

test('setGammaMirror writes controllerGamma and PRESERVES the other wire keys', () => {
  const controller = ledController({
    led: normalizeLedConfig({
      order: 'RGBW',
      wire: {
        foldAmber: false,
        amberRgb: [0.8, 0.5, 0.1],
        controllerWhite: 'passthrough',
        controllerGamma: { r: 2.2, g: 2.2, b: 2.2, w: 1 },
      },
    }, 'LED A'),
  });
  setGammaMirror(controller, { r: 2.4, g: 2.4, b: 2.4, w: 1 });
  const wire = controller.led.wire;
  assert.deepEqual({ ...wire.controllerGamma }, { r: 2.4, g: 2.4, b: 2.4, w: 1 });
  assert.equal(wire.foldAmber, false);
  assert.equal(wire.controllerWhite, 'passthrough');
  assert.deepEqual([...wire.amberRgb], [0.8, 0.5, 0.1]);
});

test('setGammaMirror refuses an out-of-range curve and a non-LED controller', () => {
  const controller = ledController();
  assert.throws(() => setGammaMirror(controller, { r: 4, g: 2.2, b: 2.2, w: 1 }),
    /must be a number in/);
  // Mirror untouched by the rejected write (still the wire default).
  assert.deepEqual(readGammaMirror(controller), { r: 1, g: 1, b: 1, w: 1 });

  const dmx = { id: 2, name: 'DMX 1', ip: '10.0.0.9', type: 'DMX', ports: [] };
  assert.throws(() => setGammaMirror(dmx, { r: 2.2, g: 2.2, b: 2.2, w: 1 }),
    /not an LED controller/);
});

// ── Push provenance stamp ───────────────────────────────────────────────────

test('device.lastGammaPush round-trips through the registry validator', () => {
  const device = normalizeDeviceBlock({
    vendor: 'marsinled',
    controllerId: 'bench_1',
    lastGammaPush: {
      at: '2026-07-27T10:00:00.000Z', outcome: 'applied',
      gamma: { r: 2.2, g: 2.3, b: 2.2, w: 1 }, firmwareSHA: 'abc123',
    },
  }, 'LED A');
  assert.deepEqual(device.lastGammaPush.gamma, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  assert.equal(device.lastGammaPush.outcome, 'applied');
  assert.equal(device.lastGammaPush.firmwareSHA, 'abc123');
});

test('a malformed lastGammaPush hard-stops (bad outcome, bad curve, missing at)', () => {
  const base = { vendor: 'marsinled', controllerId: 'bench_1' };
  assert.throws(() => normalizeDeviceBlock({
    ...base, lastGammaPush: { at: '2026-07-27T10:00:00.000Z', outcome: 'maybe' },
  }, 'LED A'), /lastGammaPush.outcome/);
  assert.throws(() => normalizeDeviceBlock({
    ...base, lastGammaPush: { outcome: 'applied' },
  }, 'LED A'), /lastGammaPush.at/);
  assert.throws(() => normalizeDeviceBlock({
    ...base,
    lastGammaPush: { at: 'x', outcome: 'applied', gamma: { r: 9, g: 2, b: 2, w: 1 } },
  }, 'LED A'), /must be a number in/);
});

test('recordDeviceGammaPush refuses an unbound controller', () => {
  const controller = ledController();
  assert.throws(() => recordDeviceGammaPush(controller, {
    at: '2026-07-27T10:00:00.000Z', outcome: 'applied', gamma: { r: 2, g: 2, b: 2, w: 1 },
  }), /not bound to a device/);
});

test('commitGammaPush mirrors the VERIFIED curve and stamps provenance', () => {
  const controller = boundLedController();
  commitGammaPush(controller, {
    verified: { r: 2.2, g: 2.3, b: 2.2, w: 1 },
    outcome: 'applied',
    at: '2026-07-27T10:00:00.000Z',
    firmwareSHA: 'sha-1',
  });
  assert.deepEqual(readGammaMirror(controller), { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  assert.deepEqual(controller.device.lastGammaPush.gamma, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  assert.equal(controller.device.lastGammaPush.outcome, 'applied');
  assert.equal(controller.device.lastGammaPush.firmwareSHA, 'sha-1');
});

test('commitGammaPush binds an UNBOUND card from the device identity it verified', () => {
  const controller = ledController();
  commitGammaPush(controller, {
    verified: { r: 2, g: 2, b: 2, w: 1 },
    outcome: 'needs-reboot',
    controllerId: 'bench_9',
    deviceName: 'Bench-9',
    boardId: 'angio4-old',
  });
  assert.equal(controller.device.controllerId, 'bench_9');
  assert.equal(controller.device.lastGammaPush.outcome, 'needs-reboot');
});

test('commitGammaPush refuses to stamp an unbound card the device could not identify', () => {
  const controller = ledController();
  assert.throws(() => commitGammaPush(controller, {
    verified: { r: 2, g: 2, b: 2, w: 1 }, outcome: 'applied',
  }), /cannot stamp the push provenance/);
});

// ── Single push ─────────────────────────────────────────────────────────────

function okTransport(verified, extra = {}) {
  const calls = [];
  return {
    calls,
    pushGamma: async (ip, gamma) => {
      calls.push({ ip, gamma });
      return {
        ip, verified, outcome: 'applied', reboot: false,
        controllerId: 'bench_1', deviceName: 'Bench-1', boardId: 'angio4-old',
        backupPath: '/home/op/tmp/led_controller_configs_backup/x.json',
        ...extra,
      };
    },
  };
}

function throwingTransport(kind, message) {
  return {
    calls: [],
    pushGamma: async (ip) => {
      const err = new Error(`${message} (${ip})`);
      err.kind = kind;
      throw err;
    },
  };
}

test('pushGammaToController sends the mirror curve and commits the verified read-back', async () => {
  const controller = boundLedController();
  setGammaMirror(controller, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  const transport = okTransport({ r: 2.2, g: 2.3, b: 2.2, w: 1 });
  let committed = null;
  const res = await pushGammaToController(controller, transport,
    (c, result) => { committed = c; commitGammaPush(c, result); });

  assert.equal(res.state, 'ok');
  assert.deepEqual(transport.calls[0], { ip: '10.0.0.5', gamma: { r: 2.2, g: 2.3, b: 2.2, w: 1 } });
  assert.equal(committed, controller);
  assert.deepEqual(res.verified, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  assert.deepEqual(controller.device.lastGammaPush.gamma, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
});

test('a device that answered with DIFFERENT values mirrors what the HARDWARE reports', async () => {
  // The read-back is the truth. (The server refuses a mismatched write, but if
  // a device ever normalizes a value, the mirror must follow the hardware.)
  const controller = boundLedController();
  setGammaMirror(controller, { r: 2.2, g: 2.3, b: 2.2, w: 1 });
  const transport = okTransport({ r: 2.2, g: 2.2, b: 2.2, w: 1 });
  const res = await pushGammaToController(controller, transport,
    (c, result) => commitGammaPush(c, result));
  assert.equal(res.state, 'ok');
  assert.deepEqual(readGammaMirror(controller), { r: 2.2, g: 2.2, b: 2.2, w: 1 });
});

test('an unreachable controller is reported as such and leaves the mirror UNTOUCHED', async () => {
  const controller = boundLedController();
  setGammaMirror(controller, { r: 2.4, g: 2.4, b: 2.4, w: 1 });
  const before = readGammaMirror(controller);
  const res = await pushGammaToController(controller,
    throwingTransport('unreachable', 'did not answer within 10000 ms'),
    (c, result) => commitGammaPush(c, result));

  assert.equal(res.state, 'unreachable');
  assert.match(res.detail, /did not answer/);
  assert.deepEqual(readGammaMirror(controller), before);
  assert.equal(controller.device.lastGammaPush, undefined);
});

test('a rejected / mismatched push is a FAILURE, not a silent success', async () => {
  const controller = boundLedController();
  const res = await pushGammaToController(controller,
    throwingTransport('verify-mismatch', 'read-back MISMATCH'),
    (c, result) => commitGammaPush(c, result));
  assert.equal(res.state, 'failed');
  assert.match(res.detail, /MISMATCH/);
  assert.equal(controller.device.lastGammaPush, undefined);
});

test('a controller without a usable IP is skipped, never pushed', async () => {
  const controller = boundLedController({ ip: '' });
  const transport = okTransport({ r: 2.2, g: 2.2, b: 2.2, w: 1 });
  const res = await pushGammaToController(controller, transport, () => {});
  assert.equal(res.state, 'skipped');
  assert.equal(transport.calls.length, 0);
});

// ── Fleet push ──────────────────────────────────────────────────────────────

test('pushGammaFleet reports EVERY controller and one failure never aborts the rest', async () => {
  const a = boundLedController({ id: 1, name: 'LED A', ip: '10.0.0.5' });
  const b = boundLedController({ id: 2, name: 'LED B', ip: '10.0.0.6' });
  const c = boundLedController({ id: 3, name: 'LED C', ip: '' });
  const dmx = { id: 4, name: 'DMX 1', ip: '10.0.0.9', type: 'DMX', ports: [] };

  const seen = [];
  const transport = {
    pushGamma: async (ip, gamma) => {
      seen.push(ip);
      if (ip === '10.0.0.6') {
        const err = new Error('device did not answer');
        err.kind = 'unreachable';
        throw err;
      }
      return {
        ip, verified: gamma, outcome: 'applied', reboot: false,
        controllerId: `id_${ip}`, backupPath: '/tmp/x.json',
      };
    },
  };

  const progress = [];
  const results = await pushGammaFleet([a, b, c, dmx], transport, {
    commit: (ctl, result) => commitGammaPush(ctl, result),
    onResult: (record, done, total) => progress.push([record.name, record.state, done, total]),
  });

  // DMX controllers are not in the run at all — gamma is LED-only.
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => [r.name, r.state]),
    [['LED A', 'ok'], ['LED B', 'unreachable'], ['LED C', 'skipped']]);
  // Sequential, in registry order, and the unreachable one still got tried.
  assert.deepEqual(seen, ['10.0.0.5', '10.0.0.6']);
  assert.deepEqual(progress.map((p) => p[0]), ['LED A', 'LED B', 'LED C']);
  assert.deepEqual(progress[2].slice(2), [3, 3]);
  // Only the successful controller carries a stamp.
  assert.ok(a.device.lastGammaPush);
  assert.equal(b.device.lastGammaPush, undefined);
  assert.equal(c.device.lastGammaPush, undefined);
});

test('summarizeFleetResults counts every state without collapsing failures', () => {
  const tally = summarizeFleetResults([
    { state: 'ok' }, { state: 'ok' }, { state: 'unreachable' },
    { state: 'failed' }, { state: 'skipped' },
  ]);
  assert.deepEqual(tally, { ok: 2, failed: 1, unreachable: 1, skipped: 1 });
});

// ── Curve geometry + presets + quantize (report 20260725_65) ────────────────
//
// The "curve" control (sliders + live SVG plot + preset chips) puts real
// maths in front of the operator, so the maths lives in led_gamma.js and is
// tested here with no DOM. What these guard:
//   - quantize SNAPS to the slider grid and never CLAMPS (clamping would be a
//     silent fallback that hides a caller bug — parseGammaField is what
//     refuses an out-of-range number, loudly);
//   - the plot never lies: 1.0 is the identity diagonal, every curve is
//     monotonic, the endpoints are (0,0)→(1,1), and the 1/255 video clamp is
//     drawn (a dim pixel never reads as full black);
//   - our presets hold W at 1.0 — the doctrine the controller's own card does
//     NOT follow (docs/41 §4.1(d)).

/** Parse an 'M x,y L x,y …' path back into points. */
function pathPoints(d) {
  return d.slice(1).split('L').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

test('quantizeGamma snaps to the 0.05 slider grid and stays at 2 decimals', () => {
  assert.equal(quantizeGamma(2.2749), 2.25);
  assert.equal(quantizeGamma(2.26), 2.25);
  assert.equal(quantizeGamma(2.2751), 2.3);
  // The float tail is the whole point: Math.round(2.3/0.05)*0.05 alone gives
  // 2.3000000000000003, which would land verbatim in controllers.yaml.
  assert.equal(String(quantizeGamma(2.3)), '2.3');
  assert.equal(String(quantizeGamma(1.15)), '1.15');
  for (const v of [1, 1.05, 1.7, 2.2, 2.6, 3]) {
    assert.equal(quantizeGamma(v), v, `${v} is already on the grid`);
  }
  // Every result is expressible in 2 decimals.
  for (let i = 0; i <= 40; i++) {
    const q = quantizeGamma(1 + i * 0.05 + 0.013);
    assert.equal(q, Number(q.toFixed(2)));
  }
  assert.throws(() => quantizeGamma('nope'), /not a finite number/);
});

test('quantizeGamma does not clamp — parseGammaField is what refuses the range', () => {
  // Snapping an out-of-range value leaves it out of range: no silent rescue.
  assert.equal(quantizeGamma(0.9), 0.9);
  assert.equal(quantizeGamma(3.1), 3.1);
  // …and the pair composes so quantize is never reached with such a value.
  for (const bad of ['0.9', '3.1']) {
    assert.throws(() => quantizeGamma(parseGammaField(bad, 'r')),
      new RegExp(`outside ${LED_GAMMA_MIN}–${LED_GAMMA_MAX}`));
  }
});

test('gammaCurvePath(1.0) is the identity diagonal', () => {
  const { width, height, pad, samples } = GAMMA_CURVE_GEOMETRY;
  const pts = pathPoints(gammaCurvePath(1));
  assert.equal(pts.length, samples + 1);
  assert.deepEqual(pts[0], { x: pad, y: height - pad });
  assert.deepEqual(pts[pts.length - 1], { x: width - pad, y: pad });
  const mid = pts[Math.floor(samples / 2)];
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const onDiagonal = pad + (1 - (mid.x - pad) / innerW) * innerH;
  assert.ok(Math.abs(mid.y - onDiagonal) <= 0.15,
    `mid sample ${mid.y} is off the diagonal (${onDiagonal})`);
});

test('gammaCurvePath is monotonic: x rises, screen-y never rises', () => {
  for (const g of [1.0, 2.2, 3.0]) {
    const pts = pathPoints(gammaCurvePath(g));
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].x > pts[i - 1].x, `γ=${g}: x went backwards at ${i}`);
      assert.ok(pts[i].y <= pts[i - 1].y, `γ=${g}: screen-y rose at ${i}`);
    }
  }
});

test('gammaCurvePath draws the 1/255 video clamp — a lit pixel is never full black', () => {
  const { height, pad } = GAMMA_CURVE_GEOMETRY;
  const floor = height - pad;
  const pts = pathPoints(gammaCurvePath(3.0));
  // x = 0 is genuinely off, and sits exactly on the plot floor.
  assert.equal(pts[0].y, floor);
  // The very next sample is clamped up off the floor: (1/48)^3 ≈ 9e-6, well
  // under 1/255, so without the clamp it would round onto the floor.
  assert.ok(pts[1].y < floor, `first lit sample ${pts[1].y} sits on the floor ${floor}`);
});

test('gammaCurvePath endpoints are (0,0) and (1,1) in curve space for every γ', () => {
  const { width, height, pad } = GAMMA_CURVE_GEOMETRY;
  for (const g of [1.0, 1.8, 2.2, 2.6, 3.0]) {
    const pts = pathPoints(gammaCurvePath(g));
    assert.deepEqual(pts[0], { x: pad, y: height - pad }, `γ=${g} start`);
    assert.deepEqual(pts[pts.length - 1], { x: width - pad, y: pad }, `γ=${g} end`);
  }
  assert.throws(() => gammaCurvePath(0), /greater than 0/);
  assert.throws(() => gammaCurvePath('x'), /greater than 0/);
});

test('LED_GAMMA_PRESETS are valid curves and hold W at 1.0 (our doctrine)', () => {
  assert.equal(LED_GAMMA_PRESETS.length, 3);
  assert.deepEqual(LED_GAMMA_PRESETS.map((p) => p.key), ['off', 'srgb', 'punchy']);
  for (const preset of LED_GAMMA_PRESETS) {
    assert.ok(preset.label && preset.title, `${preset.key} needs a label + tooltip`);
    // Every preset survives the same validation the mirror enforces.
    assert.deepEqual(validateGammaMirror(preset.gamma, preset.key), { ...preset.gamma });
    // THE guard: the controller's own sRGB/Punchy chips put the RGB exponent
    // on W too. Ours must not — white is derived AFTER the RGB curve, so a
    // second exponent compounds and crushes pastels (docs/41 §4.1(d)).
    assert.equal(preset.gamma.w, 1.0, `${preset.key} must keep W at 1.0`);
    // Every value is on the slider grid.
    for (const v of Object.values(preset.gamma)) {
      assert.equal(quantizeGamma(v), v, `${preset.key}: ${v} is off the ${LED_GAMMA_STEP} grid`);
    }
  }
  const srgb = LED_GAMMA_PRESETS.find((p) => p.key === 'srgb');
  assert.deepEqual({ ...srgb.gamma }, { ...LED_GAMMA_RECOMMENDED });
});

test('activeGammaPresetKey names the matching chip, tolerates float32 read-back noise', () => {
  for (const preset of LED_GAMMA_PRESETS) {
    assert.equal(activeGammaPresetKey(preset.gamma), preset.key);
  }
  // What a verified push actually mirrors back (float32 storage on the device).
  assert.equal(activeGammaPresetKey({ r: 2.2000001, g: 2.2, b: 2.1999998, w: 1 }), 'srgb');
  // A hand-tuned curve is nobody's preset.
  assert.equal(activeGammaPresetKey({ r: 2.2, g: 2.2, b: 2.2, w: 1.4 }), null);
  assert.equal(activeGammaPresetKey({ r: 1.85, g: 1.85, b: 1.85, w: 1 }), null);
  assert.equal(activeGammaPresetKey(null), null);
});

test('GAMMA_CURVE_GEOMETRY is a drawable plot', () => {
  const { width, height, pad, samples, clampFloor } = GAMMA_CURVE_GEOMETRY;
  assert.ok(pad * 2 < width, 'padding must leave a plot area horizontally');
  assert.ok(pad * 2 < height, 'padding must leave a plot area vertically');
  assert.ok(samples >= 24, `${samples} samples is too coarse for a smooth curve`);
  assert.equal(clampFloor, 1 / 255);
});

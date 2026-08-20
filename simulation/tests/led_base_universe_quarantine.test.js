/**
 * led_base_universe_quarantine.test.js — G9: one source of truth for a BOUND
 * LED controller's addressing.
 *
 * The per-output device layout (computeLedStrandPatches) is byte-correct and
 * hardware-proven (docs/41): each port IS an independent receiver on its OWN
 * port.universe, channel 1. `led.baseUniverse` is the vestige of the removed
 * single-base linear model; it is still honored by the GENERIC projection
 * (computeLedProjection, the unbound model) but IGNORED by the device path. The
 * sweep stops writing baseUniverse on create/bind so a bound controller carries
 * exactly one source of truth (port.universe).
 *
 * These tests are the parity guard the brief asks for: they prove the wire path
 * is IMMUNE to baseUniverse (so nothing about hardware addressing changed), and
 * that with baseUniverse unset (the new default) the generic and device
 * projections AGREE — i.e. there is no competing source. Pure: no DOM, no device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  computeLedProjection,
  CONTROLLER_TYPE_LED,
} from '../src/dmx/controller_registry.js';
import { computeLedStrandPatches } from '../src/dmx/led/led_patch_projection.js';

const DEVICE = { vendor: 'marsinled', controllerId: 'titanic_201', boardId: 'angio4-old' };

function boundReg(baseUniverse) {
  return createControllerRegistry({
    controllers: [{
      id: 1, name: 'T201', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse, startAddr: 1 },
      device: DEVICE,
      ports: [
        { port: 1, universe: 3, chain: ['lineA'] },
        { port: 2, universe: 4, chain: ['lineB'] },
      ],
    }],
  });
}

const COUNTS = new Map([['lineA', 40], ['lineB', 40]]);

// ── The wire path is IMMUNE to baseUniverse (byte behaviour unchanged) ────────

test('G9: computeLedStrandPatches ignores baseUniverse — bogus value gives identical addresses', () => {
  const zero = computeLedStrandPatches(boundReg(0), COUNTS).fields;
  const bogus = computeLedStrandPatches(boundReg(999), COUNTS).fields;

  // Byte-for-byte identical regardless of baseUniverse — the hardware-proven
  // per-output layout is keyed off port.universe alone.
  assert.deepEqual(bogus.get('lineA'), zero.get('lineA'));
  assert.deepEqual(bogus.get('lineB'), zero.get('lineB'));

  // …and the addresses are the port universes (U3/U4 ch1), not baseUniverse.
  assert.deepEqual([zero.get('lineA').dmxUniverse, zero.get('lineA').dmxAddress], [3, 1]);
  assert.deepEqual([zero.get('lineB').dmxUniverse, zero.get('lineB').dmxAddress], [4, 1]);
});

// ── With baseUniverse UNSET (new default) both projections AGREE ──────────────

test('G9: baseUniverse=0 → generic and device projections agree (single source of truth)', () => {
  const reg = boundReg(0);
  const dev = computeLedStrandPatches(reg, COUNTS).fields;
  const gen = computeLedProjection(reg, COUNTS).fields;

  for (const name of ['lineA', 'lineB']) {
    assert.equal(gen.get(name).universe, dev.get(name).dmxUniverse, `${name} start universe agrees`);
    assert.equal(gen.get(name).addr, dev.get(name).dmxAddress, `${name} start channel agrees`);
  }
});

// ── Rationale guard: a stray baseUniverse is exactly what created the conflict ─

test('G9: a stray baseUniverse makes the GENERIC projection disagree — why we stopped writing it', () => {
  const reg = boundReg(999);
  const dev = computeLedStrandPatches(reg, COUNTS).fields;   // wire truth: U3
  const gen = computeLedProjection(reg, COUNTS).fields;      // generic honors baseUniverse: U999

  // The device path stays authoritative at the port universe…
  assert.equal(dev.get('lineA').dmxUniverse, 3);
  // …while the generic path collapses onto the stray base — a divergent second
  // source. Not writing baseUniverse for bound controllers removes this trap.
  assert.equal(gen.get('lineA').universe, 999);
  assert.notEqual(gen.get('lineA').universe, dev.get('lineA').dmxUniverse);
});

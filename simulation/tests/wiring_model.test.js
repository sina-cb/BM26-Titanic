/**
 * wiring_model.test.js — Phase-1 data core for the Wiring Tracer
 * (docs/36_wiring_tracer.md). Loads the demo wiring (a black "ground test"
 * wire and a yellow "e-stop" wire), proves validation + calibrated BOM, and
 * exercises the loud-failure rules (§10).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseWiring, buildWiringModel, computeBom, formatBomText } from '../src/wiring/wiring_model.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_YAML = readFileSync(join(here, 'fixtures', 'wiring_demo.yaml'), 'utf8');

const OPTS = { validCameraKeys: ['front', 'side', 'aerial', 'dramatic', 'night-walk'] };

function model() {
  return parseWiring(DEMO_YAML, OPTS);
}

test('demo loads and indexes both wires', () => {
  const m = model();
  assert.equal(m.routes.length, 2);

  const ground = m.routes.find((r) => r.name === 'ground test');
  const estop = m.routes.find((r) => r.name === 'e-stop');
  assert.ok(ground, 'has a "ground test" route');
  assert.ok(estop, 'has an "e-stop" route');

  // ground wire is black, e-stop wire is yellow
  assert.equal(m.cableTypes.get('ground_wire').color, '#000000');
  assert.equal(m.cableTypes.get('estop_wire').color, '#ffd400');

  // each route carries exactly its one cable
  assert.equal(ground.cables[0].type, 'ground_wire');
  assert.equal(estop.cables[0].type, 'estop_wire');
});

test('scale calibrates to 1 ft per model-unit', () => {
  const m = model();
  assert.ok(m.scale.primary, 'has a primary reference');
  assert.equal(m.scale.primary.realPerUnit, 1);
});

test('BOM computes calibrated lengths and rounds to per-type stock', () => {
  const m = model();
  const bom = computeBom(m);
  assert.equal(bom.calibrated, true);
  assert.deepEqual(bom.warnings, []);

  const lines = Object.fromEntries(bom.lines.map((l) => [l.route, l]));

  // ground test: 4+2+2 == 8 units * 1 ft/unit * 1.15 slack = 9.2 ft -> 10 ft stock
  assert.ok(Math.abs(lines.ground_test.measured - 9.2) < 1e-6);
  assert.equal(lines.ground_test.stock, 10);

  // e-stop: 4+3+5+3 == 15 units * 1.15 = 17.25 ft -> 25 ft stock
  assert.ok(Math.abs(lines.estop.measured - 17.25) < 1e-6);
  assert.equal(lines.estop.stock, 25);

  // formatted output is non-empty and mentions both wires' types
  const text = formatBomText(bom);
  assert.match(text, /ground_wire/);
  assert.match(text, /estop_wire/);
});

test('uncalibrated scene refuses to measure (loud, not silent)', () => {
  const m = model();
  m.scale = null; // simulate a wiring.yaml with no scale block
  const bom = computeBom(m);
  assert.equal(bom.calibrated, false);
  assert.match(bom.warnings[0], /Not calibrated/);
});

test('over-max stock is a BOM warning, not a failure', () => {
  const m = model();
  // Force the e-stop cable absurdly long via an override.
  m.routes.find((r) => r.id === 'estop').cables[0].lengthOverrideFt = 250;
  const bom = computeBom(m);
  assert.ok(bom.warnings.some((w) => /exceeds max stock/.test(w)), 'warns over-max');
  assert.equal(bom.lines.find((l) => l.route === 'estop').overMax, true);
});

// ─── Loud-failure rules (§10) ────────────────────────────────────────────────

function demoDoc() {
  // deep-ish clone of a minimal valid doc we can corrupt per-test
  return {
    wiring: {
      version: 2,
      scale: { unit: 'ft', references: [{ id: 'r', role: 'primary',
        points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], actualDistance: 10 }] },
      cableTypes: { ground_wire: { family: 'power', connector: 'ring_lug', stockLengths: [6] } },
      components: [{ id: 'panel', type: 'adapter', placement: { x: 0, y: 0, z: 0 },
        ports: [{ id: 'gnd', accepts: ['ground_wire'] }] }],
      anchors: [{ id: 'chassis', placement: { x: 0, y: 0, z: 5 } }],
      routes: [{ id: 'w', name: 'w', endpoints: [{ component: 'panel', port: 'gnd' }, { anchor: 'chassis' }],
        cables: [{ type: 'ground_wire' }], waypoints: [] }],
    },
  };
}

test('unknown cableType throws', () => {
  const d = demoDoc();
  d.wiring.routes[0].cables[0].type = 'nope';
  assert.throws(() => buildWiringModel(d), /unknown cableType "nope"/);
});

test('unknown port throws', () => {
  const d = demoDoc();
  d.wiring.routes[0].endpoints[0].port = 'missing';
  assert.throws(() => buildWiringModel(d), /unknown port "missing"/);
});

test('incompatible cable on a port throws', () => {
  const d = demoDoc();
  d.wiring.cableTypes.estop_wire = { family: 'power', connector: 'e_stop', stockLengths: [50] };
  d.wiring.routes[0].cables[0].type = 'estop_wire'; // port "gnd" only accepts ground_wire
  assert.throws(() => buildWiringModel(d), /incompatible with port "gnd"/);
});

test('duplicate route id throws', () => {
  const d = demoDoc();
  d.wiring.routes.push({ ...d.wiring.routes[0] });
  assert.throws(() => buildWiringModel(d), /duplicate route id "w"/);
});

test('route without exactly two endpoints throws', () => {
  const d = demoDoc();
  d.wiring.routes[0].endpoints = [{ anchor: 'chassis' }];
  assert.throws(() => buildWiringModel(d), /exactly two endpoints/);
});

test('malformed scale reference (coincident points) throws', () => {
  const d = demoDoc();
  d.wiring.scale.references[0].points = [{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }];
  assert.throws(() => buildWiringModel(d), /coincident/);
});

test('bad waypoint coordinates throw', () => {
  const d = demoDoc();
  d.wiring.routes[0].waypoints = [{ x: 0, y: NaN, z: 1 }];
  assert.throws(() => buildWiringModel(d), /finite x, y, z/);
});

test('malformed print view (unknown camera) throws', () => {
  const d = demoDoc();
  d.wiring.printViews = [{ id: 'pv', camera: 'bogus' }];
  assert.throws(() => buildWiringModel(d, OPTS), /unknown camera preset "bogus"/);
});

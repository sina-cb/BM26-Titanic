/**
 * load_ports.test.js — `lib/load_ports.cjs`'s fail-loud contract (catalog
 * 20260805_161 gap G9): every server process boots through
 * `loadSimPorts`, but only its SUCCESS path was ever exercised incidentally
 * by other harnesses — its REFUSALS had no test before this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadSimPorts, SACN_E131_UDP_PORT } = require('../lib/load_ports.cjs');

function tempConfig(obj) {
  const file = path.join(os.tmpdir(), `bm26_load_ports_test_${process.pid}_${Math.random().toString(36).slice(2)}.yaml`);
  const yaml = require('js-yaml');
  fs.writeFileSync(file, yaml.dump(obj));
  return file;
}

test('G9: all five ports present → returns them; sacn_udp_port absent → the E1.31 default', () => {
  const file = tempConfig({
    http_port: 6969, save_port: 6970, sacn_port: 6971, sacn_output_port: 6972,
    marsin_engine_port: 6968,
  });
  const ports = loadSimPorts(file);
  assert.equal(ports.http_port, 6969);
  assert.equal(ports.save_port, 6970);
  assert.equal(ports.sacn_port, 6971);
  assert.equal(ports.sacn_output_port, 6972);
  assert.equal(ports.marsin_engine_port, 6968);
  assert.equal(ports.sacn_udp_port, SACN_E131_UDP_PORT);
  assert.equal(ports.sacn_udp_port, 5568);
  assert.equal(ports.sacn_interface, null);
  fs.unlinkSync(file);
});

test('G9: a missing required port key throws, naming BOTH the key and the resolved path', () => {
  const file = tempConfig({
    http_port: 6969, save_port: 6970, sacn_output_port: 6972, marsin_engine_port: 6968,
    // sacn_port omitted
  });
  assert.throws(() => loadSimPorts(file), (err) => {
    assert.match(err.message, /'sacn_port'/);
    assert.ok(err.message.includes(file), 'the resolved path must be named too');
    return true;
  });
  fs.unlinkSync(file);
});

test('G9: a string port value throws (Number.isInteger gate) — no coercion', () => {
  const file = tempConfig({
    http_port: '6969', save_port: 6970, sacn_port: 6971, sacn_output_port: 6972,
    marsin_engine_port: 6968,
  });
  assert.throws(() => loadSimPorts(file), /'http_port'/);
  fs.unlinkSync(file);
});

test('G9: sacn_interface — empty string and a non-string both throw; absent is null; whitespace is trimmed',
  () => {
    const base = {
      http_port: 6969, save_port: 6970, sacn_port: 6971, sacn_output_port: 6972,
      marsin_engine_port: 6968,
    };
    const emptyFile = tempConfig({ ...base, sacn_interface: '' });
    assert.throws(() => loadSimPorts(emptyFile), /'sacn_interface'/);
    fs.unlinkSync(emptyFile);

    const numberFile = tempConfig({ ...base, sacn_interface: 3 });
    assert.throws(() => loadSimPorts(numberFile), /'sacn_interface'/);
    fs.unlinkSync(numberFile);

    const absentFile = tempConfig({ ...base });
    assert.equal(loadSimPorts(absentFile).sacn_interface, null);
    fs.unlinkSync(absentFile);

    const trimFile = tempConfig({ ...base, sacn_interface: '  10.0.0.5 ' });
    assert.equal(loadSimPorts(trimFile).sacn_interface, '10.0.0.5');
    fs.unlinkSync(trimFile);
  });

test('G9: BM26_SIM_CONFIG wins over the passed path; set-but-unreadable throws, NEVER falls back',
  () => {
    const real = tempConfig({
      http_port: 1, save_port: 2, sacn_port: 3, sacn_output_port: 4, marsin_engine_port: 5,
    });
    const override = tempConfig({
      http_port: 11, save_port: 12, sacn_port: 13, sacn_output_port: 14, marsin_engine_port: 15,
    });
    const savedEnv = process.env.BM26_SIM_CONFIG;
    try {
      process.env.BM26_SIM_CONFIG = override;
      const ports = loadSimPorts(real);
      assert.equal(ports.http_port, 11, 'the env override must win over the passed path');

      process.env.BM26_SIM_CONFIG = path.join(os.tmpdir(), 'bm26_load_ports_does_not_exist.yaml');
      assert.throws(() => loadSimPorts(real), /ENOENT/,
        'a set-but-unreadable BM26_SIM_CONFIG must throw, never silently fall back to the real config');
    } finally {
      if (savedEnv === undefined) delete process.env.BM26_SIM_CONFIG;
      else process.env.BM26_SIM_CONFIG = savedEnv;
      fs.unlinkSync(real);
      fs.unlinkSync(override);
    }
  });

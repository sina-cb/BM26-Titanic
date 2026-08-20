import assert from 'node:assert/strict';
import test from 'node:test';

import { loadModelForGauge } from '../../lib/model_loader.js';
import {
  COVERAGE_SCENARIOS,
  CRISP_KEEPERS,
  loadCrispRegionIntents,
  measureCrispModelCoverage,
} from '../../tools/titanic_model/coverage.mjs';
import {
  buildTitanicModelCensus,
  TITANIC_HULL_REGION_NAMES,
  TITANIC_REGION_NAMES,
} from '../../tools/titanic_model/regions.mjs';

const COVERAGE_FLOOR = 0.20;
const HULL_COVERAGE_FLOOR = 0.80;

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

test('Titanic model census and every Crisp region intent remain explicit', async () => {
  const loaded = await loadModelForGauge('titanic');
  const census = buildTitanicModelCensus(loaded.pixels);
  const intents = loadCrispRegionIntents();

  assert.equal(census.pixelCount, 964);
  assert.deepEqual(census.regions.map((region) => region.name), TITANIC_REGION_NAMES);
  assert.deepEqual(Object.keys(intents), CRISP_KEEPERS);
  for (const regionName of TITANIC_HULL_REGION_NAMES) {
    assert.ok(census.regions.some((region) => region.name === regionName),
      `named hull region missing: ${regionName}`);
  }
});

test('Crisp keepers animate every intended Titanic region and test-bench role',
  { timeout: 60_000 }, async () => {
    const report = await measureCrispModelCoverage({ frameCount: 160 });
    const intents = loadCrispRegionIntents();

    for (const pattern of CRISP_KEEPERS) {
      const result = report.patterns[pattern];
      for (const scenario of COVERAGE_SCENARIOS.map((entry) => entry.name)) {
        const regions = result.titanic[scenario];
        assert.deepEqual(Object.keys(regions), TITANIC_REGION_NAMES,
          `${pattern}/${scenario}: named Titanic census drifted`);
        for (const [regionName, measurement] of Object.entries(regions)) {
          assert.ok(measurement.everLitFraction >= COVERAGE_FLOOR,
            `${pattern}/${scenario}/${regionName}: only ` +
            `${measurement.everLitFraction.toFixed(3)} ever lights`);
          assert.ok(measurement.dynamicFraction >= COVERAGE_FLOOR,
            `${pattern}/${scenario}/${regionName}: only ` +
            `${measurement.dynamicFraction.toFixed(3)} animates`);
          assert.ok(measurement.litSampleFraction > 0,
            `${pattern}/${scenario}/${regionName}: no lit time samples`);
        }

        for (const regionName of TITANIC_HULL_REGION_NAMES) {
          const measurement = regions[regionName];
          assert.ok(measurement.everLitFraction >= HULL_COVERAGE_FLOOR,
            `${pattern}/${scenario}/${regionName}: incomplete wall reach`);
          assert.ok(measurement.dynamicFraction >= HULL_COVERAGE_FLOOR,
            `${pattern}/${scenario}/${regionName}: incomplete wall animation`);
        }
        const hullOccupancy = average(TITANIC_HULL_REGION_NAMES.map(
          (name) => regions[name].litSampleFraction,
        ));
        assert.ok(hullOccupancy >= 0.08 && hullOccupancy <= 0.90,
          `${pattern}/${scenario}: hull lit occupancy ${hullOccupancy.toFixed(3)}`);

        const groups = result.test_bench[scenario];
        for (const [groupName, measurement] of Object.entries(groups)) {
          assert.ok(measurement.everLitFraction >= COVERAGE_FLOOR,
            `${pattern}/${scenario}/test_bench/${groupName}: role disappears`);
          assert.ok(measurement.dynamicFraction >= COVERAGE_FLOOR,
            `${pattern}/${scenario}/test_bench/${groupName}: role is static`);
        }
      }

      const saved = result.titanic.saved;
      const portEnergy = average([
        saved['Left Front Wall'].litSampleFraction,
        saved['Left Back Wall'].litSampleFraction,
      ]);
      const starboardEnergy = average([
        saved['Right Front Wall'].litSampleFraction,
        saved['Right Back Wall'].litSampleFraction,
      ]);
      if (intents[pattern].balance_mode !== 'deliberately_asymmetric') {
        assert.ok(Math.abs(portEnergy - starboardEnergy) <= 0.20,
          `${pattern}: ${intents[pattern].balance_mode} port/starboard energy ` +
          `differs by ${Math.abs(portEnergy - starboardEnergy).toFixed(3)}`);
      } else {
        assert.ok(portEnergy > 0.05 && starboardEnergy > 0.05,
          `${pattern}: deliberate asymmetry became an accidental omission`);
      }
    }
  });

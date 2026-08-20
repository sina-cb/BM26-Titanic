/**
 * Canonical named light regions in the exported Titanic pattern model.
 *
 * The strings are scene-owned group names from simulation/scenes/titanic.
 * Counts describe the current generated marsin_engine/models/titanic.js and
 * intentionally fail loud when authoritative model data changes. Update this
 * registry and docs/TITANIC_MODEL.md together after a deliberate scene export.
 */

export const TITANIC_REGION_SPECS = Object.freeze([
  { name: 'Left Front Wall', role: 'Hull Canvas', side: 'port', station: 'forward', pixels: 90, fixtures: 5, fixtureType: 'ShehdsBar' },
  { name: 'Left Back Wall', role: 'Hull Canvas', side: 'port', station: 'aft', pixels: 90, fixtures: 5, fixtureType: 'ShehdsBar' },
  { name: 'Right Front Wall', role: 'Hull Canvas', side: 'starboard', station: 'forward', pixels: 90, fixtures: 5, fixtureType: 'ShehdsBar' },
  { name: 'Right Back Wall', role: 'Hull Canvas', side: 'starboard', station: 'aft', pixels: 90, fixtures: 5, fixtureType: 'ShehdsBar' },
  { name: 'Left_Front_Left', role: 'Silhouette', side: 'port', station: 'forward', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Left_Front_Right', role: 'Silhouette', side: 'port', station: 'forward', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Left_Back_Left', role: 'Silhouette', side: 'port', station: 'aft', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Left_Back_Right', role: 'Silhouette', side: 'port', station: 'aft', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Right_Front_Left', role: 'Silhouette', side: 'starboard', station: 'forward', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Right_Front_Right', role: 'Silhouette', side: 'starboard', station: 'forward', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Right_Back_Left', role: 'Silhouette', side: 'starboard', station: 'aft', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Right_Back_Right', role: 'Silhouette', side: 'starboard', station: 'aft', pixels: 40, fixtures: 1, fixtureType: '' },
  { name: 'Left Front Rails', role: 'Jewelry', side: 'port', station: 'forward', pixels: 24, fixtures: 4, fixtureType: 'VintageLed' },
  { name: 'Left Back Rails', role: 'Jewelry', side: 'port', station: 'aft', pixels: 24, fixtures: 4, fixtureType: 'VintageLed' },
  { name: 'Right Front Rails', role: 'Jewelry', side: 'starboard', station: 'forward', pixels: 24, fixtures: 4, fixtureType: 'VintageLed' },
  { name: 'Right Back Rails', role: 'Jewelry', side: 'starboard', station: 'aft', pixels: 24, fixtures: 4, fixtureType: 'VintageLed' },
  { name: 'Left SmokeStack', role: 'Organs', side: 'port', station: 'distributed', pixels: 8, fixtures: 8, fixtureType: 'UkingPar' },
  { name: 'Left Small SmokeStack', role: 'Organs', side: 'port', station: 'outboard', pixels: 4, fixtures: 4, fixtureType: 'UkingPar' },
  { name: 'Left Auditorium', role: 'Organs', side: 'port', station: 'distributed', pixels: 8, fixtures: 8, fixtureType: 'UkingPar' },
  { name: 'Right SmokeStacks', role: 'Organs', side: 'starboard', station: 'distributed', pixels: 8, fixtures: 8, fixtureType: 'UkingPar' },
  { name: 'Right Small SmokeStack', role: 'Organs', side: 'starboard', station: 'outboard', pixels: 4, fixtures: 4, fixtureType: 'UkingPar' },
  { name: 'Right Auditorium', role: 'Organs', side: 'starboard', station: 'distributed', pixels: 8, fixtures: 8, fixtureType: 'UkingPar' },
  { name: 'TE Sign', role: 'Identity', side: 'port', station: 'local_surface', pixels: 74, fixtures: 2, fixtureType: 'TeSignV3A40|TeSignV3B34', indexRange: [0, 73] },
  { name: 'TE Sign 2', role: 'Identity', side: 'starboard', station: 'local_surface', pixels: 74, fixtures: 2, fixtureType: 'TeSignV3A40|TeSignV3B34', indexRange: [74, 147] },
]);

export const TITANIC_REGION_NAMES = Object.freeze(
  TITANIC_REGION_SPECS.map((region) => region.name),
);

export const TITANIC_HULL_REGION_NAMES = Object.freeze([
  'Left Front Wall',
  'Left Back Wall',
  'Right Front Wall',
  'Right Back Wall',
]);

export const TITANIC_MODEL_BOUNDS = Object.freeze({
  x: Object.freeze([-50.318, 45.454]),
  y: Object.freeze([0.25, 14.9]),
  z: Object.freeze([-26.379, 16.156]),
});

export const TITANIC_FORWARD_AXES = Object.freeze({
  port: Object.freeze({ x: -0.0179846943, z: 0.9998382623 }),
  starboard: Object.freeze({ x: 0.6147022500, z: 0.7887592432 }),
});

export const TITANIC_BALANCE_MODES = Object.freeze([
  'uniform_field',
  'mirrored',
  'deliberately_asymmetric',
]);

function regionPixels(pixels, name) {
  return pixels.filter((pixel) => pixel.group === name);
}

function range(values) {
  return [Math.min(...values), Math.max(...values)];
}

function near(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

export function buildTitanicModelCensus(pixels) {
  if (!Array.isArray(pixels)) throw new Error('Titanic model pixels must be an array');
  const actualGroups = [...new Set(pixels.map((pixel) => pixel.group))].sort();
  const expectedGroups = [...TITANIC_REGION_NAMES].sort();
  if (JSON.stringify(actualGroups) !== JSON.stringify(expectedGroups)) {
    throw new Error(
      `Titanic named regions drifted: expected [${expectedGroups.join(', ')}], ` +
      `found [${actualGroups.join(', ')}]`,
    );
  }
  if (pixels.length !== 964) {
    throw new Error(`Titanic pixel census drifted: expected 964, found ${pixels.length}`);
  }

  const rawBounds = {
    x: range(pixels.map((pixel) => pixel.x)),
    y: range(pixels.map((pixel) => pixel.y)),
    z: range(pixels.map((pixel) => pixel.z)),
  };
  for (const axis of ['x', 'y', 'z']) {
    for (let edge = 0; edge < 2; edge += 1) {
      if (!near(rawBounds[axis][edge], TITANIC_MODEL_BOUNDS[axis][edge])) {
        throw new Error(
          `Titanic ${axis} bound drifted: expected ${TITANIC_MODEL_BOUNDS[axis][edge]}, ` +
          `found ${rawBounds[axis][edge]}`,
        );
      }
    }
  }

  const regions = TITANIC_REGION_SPECS.map((spec) => {
    const members = regionPixels(pixels, spec.name);
    const fixtures = new Set(members.map((pixel) => pixel.fId));
    const fixtureTypes = [...new Set(members.map((pixel) => pixel.fixtureType))].sort();
    const expectedTypes = spec.fixtureType.split('|').sort();
    if (members.length !== spec.pixels) {
      throw new Error(`${spec.name}: expected ${spec.pixels} pixels, found ${members.length}`);
    }
    if (fixtures.size !== spec.fixtures) {
      throw new Error(`${spec.name}: expected ${spec.fixtures} fixtures, found ${fixtures.size}`);
    }
    if (JSON.stringify(fixtureTypes) !== JSON.stringify(expectedTypes)) {
      throw new Error(
        `${spec.name}: expected fixture types [${expectedTypes.join(', ')}], ` +
        `found [${fixtureTypes.join(', ')}]`,
      );
    }
    const indexRange = range(members.map((pixel) => pixel.i));
    if (spec.indexRange
        && JSON.stringify(indexRange) !== JSON.stringify(spec.indexRange)) {
      throw new Error(
        `${spec.name}: expected global indices ${spec.indexRange.join('..')}, ` +
        `found ${indexRange.join('..')}`,
      );
    }
    return {
      ...spec,
      sections: [...new Set(members.map((pixel) => pixel.sId))].sort((a, b) => a - b),
      raw: {
        x: range(members.map((pixel) => pixel.x)),
        y: range(members.map((pixel) => pixel.y)),
        z: range(members.map((pixel) => pixel.z)),
      },
      normalized: {
        x: range(members.map((pixel) => pixel.nx)),
        y: range(members.map((pixel) => pixel.ny)),
        z: range(members.map((pixel) => pixel.nz)),
      },
      localIndices: [...new Set(members.map((pixel) => pixel.localIndex))]
        .sort((a, b) => a - b),
      indexRange,
    };
  });

  for (const pixel of pixels) {
    for (const axis of ['x', 'y', 'z']) {
      const [minimum, maximum] = TITANIC_MODEL_BOUNDS[axis];
      const expected = (pixel[axis] - minimum) / (maximum - minimum);
      if (!near(pixel[`n${axis}`], expected, 0.00006)) {
        throw new Error(
          `pixel ${pixel.i} ${axis} normalization drifted: expected ${expected}, ` +
          `found ${pixel[`n${axis}`]}`,
        );
      }
    }
  }

  return { pixelCount: pixels.length, rawBounds, regions };
}

export function validateTitanicRegionIntent(pattern, intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw new Error(`${pattern}: missing Titanic model-region intent`);
  }
  const allowedRoot = new Set(['balance_mode', 'balance_rationale', 'region_treatments']);
  for (const key of Object.keys(intent)) {
    if (!allowedRoot.has(key)) throw new Error(`${pattern}: unknown model-region key ${key}`);
  }
  if (!TITANIC_BALANCE_MODES.includes(intent.balance_mode)) {
    throw new Error(`${pattern}: invalid balance_mode ${intent.balance_mode}`);
  }
  if (typeof intent.balance_rationale !== 'string' || intent.balance_rationale.length < 20) {
    throw new Error(`${pattern}: balance_rationale must be descriptive`);
  }
  if (!Array.isArray(intent.region_treatments) || intent.region_treatments.length === 0) {
    throw new Error(`${pattern}: region_treatments must be a non-empty array`);
  }
  const named = [];
  intent.region_treatments.forEach((treatment, index) => {
    const keys = Object.keys(treatment).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['intent', 'regions'])) {
      throw new Error(`${pattern}: region_treatments[${index}] needs regions + intent only`);
    }
    if (!Array.isArray(treatment.regions) || treatment.regions.length === 0) {
      throw new Error(`${pattern}: region_treatments[${index}].regions must be non-empty`);
    }
    if (typeof treatment.intent !== 'string' || treatment.intent.length < 20) {
      throw new Error(`${pattern}: region_treatments[${index}].intent must be descriptive`);
    }
    named.push(...treatment.regions);
  });
  const sortedNamed = [...named].sort();
  const sortedExpected = [...TITANIC_REGION_NAMES].sort();
  if (JSON.stringify(sortedNamed) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${pattern}: region intent must name every Titanic region exactly once; ` +
      `found [${sortedNamed.join(', ')}]`,
    );
  }
  return intent;
}

export function measureNamedRegionCoverage(pixels, frames, darkThreshold = 8, deltaThreshold = 4) {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error('region coverage requires at least two frames');
  }
  const byGroup = new Map(TITANIC_REGION_NAMES.map((name) => [name, []]));
  pixels.forEach((pixel, index) => {
    if (byGroup.has(pixel.group)) byGroup.get(pixel.group).push(index);
  });
  const results = {};
  for (const [name, indices] of byGroup) {
    if (indices.length === 0) throw new Error(`coverage region missing from model: ${name}`);
    let litPixels = 0;
    let dynamicPixels = 0;
    let litSamples = 0;
    for (const pixelIndex of indices) {
      let minimum = 255;
      let maximum = 0;
      for (const frame of frames) {
        const offset = pixelIndex * 6;
        const level = Math.max(frame[offset], frame[offset + 1], frame[offset + 2]);
        minimum = Math.min(minimum, level);
        maximum = Math.max(maximum, level);
        if (level >= darkThreshold) litSamples += 1;
      }
      if (maximum >= darkThreshold) litPixels += 1;
      if (maximum - minimum >= deltaThreshold) dynamicPixels += 1;
    }
    results[name] = {
      pixels: indices.length,
      everLitFraction: litPixels / indices.length,
      dynamicFraction: dynamicPixels / indices.length,
      litSampleFraction: litSamples / (indices.length * frames.length),
    };
  }
  return results;
}

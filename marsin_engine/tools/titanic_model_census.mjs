#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pixels } from '../models/titanic.js';
import { measureCrispModelCoverage } from './titanic_model/coverage.mjs';
import { buildTitanicModelCensus } from './titanic_model/regions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const outputPath = argumentValue('--out');
const frameCount = Number(argumentValue('--frames') || 160);
if (!Number.isInteger(frameCount) || frameCount < 40) {
  throw new Error('--frames must be an integer >= 40');
}

const result = {
  schemaVersion: 1,
  source: 'marsin_engine/models/titanic.js',
  census: buildTitanicModelCensus(pixels),
  coverage: await measureCrispModelCoverage({ frameCount }),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  const resolved = path.resolve(HERE, '..', outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, serialized);
  console.log(`wrote ${resolved}`);
} else {
  process.stdout.write(serialized);
}

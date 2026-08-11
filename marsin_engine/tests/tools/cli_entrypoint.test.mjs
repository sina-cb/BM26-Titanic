import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isMainModule } from '../../tools/cli_entrypoint.mjs';

test('isMainModule matches a native path containing spaces', () => {
  const entryPath = path.resolve('tmp dir', 'entrypoint.mjs');
  assert.equal(isMainModule(pathToFileURL(entryPath).href, entryPath), true);
});

test('isMainModule rejects a different entrypoint', () => {
  const modulePath = path.resolve('tools', 'one.mjs');
  const entryPath = path.resolve('tools', 'two.mjs');
  assert.equal(isMainModule(pathToFileURL(modulePath).href, entryPath), false);
});

test('isMainModule fails loudly on missing inputs', () => {
  assert.throws(() => isMainModule('', 'entry.mjs'), /moduleUrl/);
  assert.throws(() => isMainModule(pathToFileURL('entry.mjs').href, ''), /argv1/);
});

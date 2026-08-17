import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveDeckBlendName,
  sequenceStage,
  smoothstepProgress,
} from '../../tools/transition_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const TRANSITIONS_DIR = path.join(ENGINE_DIR, 'patterns', 'transitions');
const GALLERY_DIR = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'transitions');

test('transition gallery sequence boundaries are deterministic', () => {
  assert.equal(sequenceStage(0, 1, 2), 'a');
  assert.equal(sequenceStage(0.999, 1, 2), 'a');
  assert.equal(sequenceStage(1, 1, 2), 'transition');
  assert.equal(sequenceStage(2.999, 1, 2), 'transition');
  assert.equal(sequenceStage(3, 1, 2), 'b');
  assert.equal(sequenceStage(4, 1, 2), 'b');
});

test('transition gallery mirrors the current Deck blend dispatch', () => {
  assert.equal(resolveDeckBlendName('trans_crossfade'), 'trans_crossfade');
  assert.equal(resolveDeckBlendName('trans_flash'), 'trans_flash');
  assert.equal(smoothstepProgress(0), 0);
  assert.equal(smoothstepProgress(0.5), 0.5);
  assert.equal(smoothstepProgress(1), 1);
});

test('permanent transition gallery covers every transition with MP4 and GIF', () => {
  const manifestPath = path.join(GALLERY_DIR, 'manifest.json');
  const htmlPath = path.join(GALLERY_DIR, 'index.html');
  assert.equal(fs.existsSync(manifestPath), true, 'transition manifest must exist');
  assert.equal(fs.existsSync(htmlPath), true, 'transition gallery page must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = fs.readdirSync(TRANSITIONS_DIR)
    .filter((name) => name.startsWith('trans_') && name.endsWith('.js'))
    .map((name) => path.basename(name, '.js'))
    .sort();
  const actual = manifest.items.map((item) => item.transition).sort();
  assert.deepEqual(actual, expected);
  assert.equal(manifest.model, 'titanic');
  assert.equal(manifest.pixelCount, 964);
  assert.equal(manifest.endpointA.pattern, 'baby/51_boy_keel_breath');
  assert.equal(manifest.endpointB.pattern, 'baby/66_girl_keel_breath');
  assert.equal(
    manifest.phasePolicy,
    'incoming B zero-seeded and parked until transition start; phase state promoted atomically',
  );
  assert.equal(manifest.deckExecution.faderCurve, 'smoothstep');
  assert.equal(manifest.deckExecution.crossfadeBlend, 'trans_crossfade');
  assert.equal(manifest.deckExecution.tailCut, false);
  assert.equal(manifest.items.length, 15);
  assert.equal(manifest.p0OpenCount, 0);
  assert.equal(
    manifest.p0OpenCount,
    manifest.items.filter((item) => item.audit.p0Open).length,
  );

  for (const item of manifest.items) {
    assert.ok(['KEEP', 'TUNE', 'OPTIMIZE', 'REMOVE'].includes(item.verdict));
    assert.equal(
      fs.existsSync(path.join(GALLERY_DIR, 'videos', item.video)),
      true,
      `missing MP4 for ${item.transition}`,
    );
    assert.equal(
      fs.existsSync(path.join(GALLERY_DIR, 'gifs', item.gif)),
      true,
      `missing GIF for ${item.transition}`,
    );
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /A · BLUE/);
  assert.match(html, /B · PINK/);
  assert.match(html, /data-action="seek"/);
  assert.match(html, /ENDPOINT ORACLE · PASS/);
  assert.doesNotMatch(html, /morse/i);
});

test('master gallery index links transitions and all three Baby galleries', () => {
  const index = fs.readFileSync(
    path.join(REPO_DIR, 'docs', 'pattern_gallery', 'index.html'),
    'utf8',
  );
  assert.match(index, /href="transitions\/index\.html"/);
  for (const playlist of ['baby_tease', 'baby_boy', 'baby_girl']) {
    assert.match(index, new RegExp(`playlists/titanic/${playlist}/index\\.html`));
  }
  assert.match(index, /<strong>Baby Tease<\/strong><small>20 entries<\/small>/);
  assert.match(index, /<strong>Baby Boy<\/strong><small>30 entries<\/small>/);
  assert.match(index, /<strong>Baby Girl<\/strong><small>30 entries<\/small>/);
});

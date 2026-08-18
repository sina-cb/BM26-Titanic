import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import {
  compressTitanicHalves,
  drawUpwardWashLayer,
  encodeFramesWithFfmpeg,
  encodeVideoFramesWithFfmpeg,
  galleryManifestMeetsCampaignContract,
  publishGallery,
  renderTitanicHullCoverageFrames,
  resolveGalleryPalette,
  TITANIC_OPERATOR_HULL_REGIONS,
  titanicSmokeStackIndices,
  validateSavedDefaults,
} from '../../tools/playlist_gallery/generate.mjs';
import { pixels as titanicPixels } from '../../models/titanic.js';
import { TITANIC_REGION_NAMES } from '../../tools/titanic_model/regions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');

test('Titanic wall diagnostic uses operator position, not legacy scene side labels', () => {
  assert.deepEqual(TITANIC_OPERATOR_HULL_REGIONS, [
    'Right Front Wall',
    'Right Back Wall',
    'Left Front Wall',
    'Left Back Wall',
  ]);
});

test('Titanic wall diagnostic renders and fails loud on a missing named wall', () => {
  const capture = {
    meta: titanicPixels,
    frames: [titanicPixels.map((pixel) => pixel.group.includes('Wall')
      ? [255, 64, 0]
      : [0, 0, 0])],
  };
  const rendered = renderTitanicHullCoverageFrames(capture);
  assert.equal(rendered.width, 1440);
  assert.equal(rendered.height, 330);
  assert.equal(rendered.frames.length, 1);
  assert.equal(rendered.frames[0].length, 1440 * 330 * 3);

  assert.throws(() => renderTitanicHullCoverageFrames({
    ...capture,
    meta: capture.meta.filter((pixel) => pixel.group !== 'Left Front Wall'),
  }), /Left Front Wall requires 90 pixels/);
});

test('Ambient gallery carries Crisp autoplay evidence for every named hull wall', () => {
  const galleryDir = path.join(
    REPO_DIR, 'docs', 'pattern_gallery', 'playlists', 'titanic', 'ambient',
  );
  const manifest = JSON.parse(fs.readFileSync(
    path.join(galleryDir, 'manifest.json'), 'utf8',
  ));
  const playlist = yaml.load(fs.readFileSync(
    path.join(REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists', 'ambient.yaml'),
    'utf8',
  ));
  assert.equal(manifest.items.length, playlist.entries.length);
  assert.equal(typeof manifest.modelRegionIntentDigest, 'string');
  assert.equal(manifest.modelRegionIntentDigest.length, 64);
  const crispItems = manifest.items.filter((item) => item.pattern.startsWith('crisp/'));
  assert.equal(crispItems.length, 6);
  for (const item of crispItems) {
    assert.ok(item.modelRegionIntent, `${item.pattern}: missing model-region intent`);
    assert.deepEqual(
      item.modelRegionIntent.region_treatments.flatMap((entry) => entry.regions).sort(),
      [...TITANIC_REGION_NAMES].sort(),
    );
    assert.ok(fs.existsSync(path.join(galleryDir, 'coverage_gifs', item.coverageGif)),
      `${item.pattern}: coverage GIF missing`);
    assert.ok(fs.existsSync(path.join(galleryDir, 'coverage_videos', item.coverageVideo)),
      `${item.pattern}: coverage video missing`);
    assert.equal(item.parameterSweepSegments.length, item.controls.length * 3,
      `${item.pattern}: every control needs min/mid/max sweep segments`);
    assert.deepEqual(
      [...new Set(item.parameterSweepSegments.map((segment) => segment.value))],
      [0, 0.5, 1],
      `${item.pattern}: parameter sweep values drifted`,
    );
    assert.ok(fs.existsSync(path.join(
      galleryDir, 'parameter_sweeps', item.parameterSweepVideo,
    )), `${item.pattern}: parameter sweep video missing`);
  }
  assert.equal(fs.existsSync(path.join(
    REPO_DIR, 'docs', 'pattern_gallery', 'playlists', 'titanic', 'crisp',
  )), false);
  const html = fs.readFileSync(path.join(galleryDir, 'index.html'), 'utf8');
  for (const label of [
    'LEFT FRONT · PORT BOW',
    'LEFT BACK · PORT STERN',
    'RIGHT FRONT · STARBOARD BOW',
    'RIGHT BACK · STARBOARD STERN',
  ]) assert.match(html, new RegExp(label));
  assert.match(html, /Every slider at minimum · midpoint · maximum/);
});

test('playlist gallery encoder emits a GIF89a stream with exact dimensions', () => {
  const frame = Buffer.from([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
  ]);
  const output = path.join(os.tmpdir(), `bm26_playlist_gallery_${process.pid}.gif`);
  encodeFramesWithFfmpeg([frame, frame], 2, 2, 10, output);
  const gif = fs.readFileSync(output);
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 2);
  assert.equal(gif.readUInt16LE(8), 2);
  assert.equal(gif.at(-1), 0x3b);
});

test('playlist gallery encoder emits a seekable ISO MP4 stream', () => {
  const frame = Buffer.from([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
  ]);
  const output = path.join(os.tmpdir(), `bm26_playlist_gallery_${process.pid}.mp4`);
  encodeVideoFramesWithFfmpeg([frame, frame], 2, 2, 10, output);
  const video = fs.readFileSync(output);
  assert.equal(video.subarray(4, 8).toString('ascii'), 'ftyp');
  assert.ok(video.includes(Buffer.from('moov')), 'fast-start MP4 must contain a moov atom');
  assert.ok(video.includes(Buffer.from('mdat')), 'MP4 must contain encoded frame data');
});

test('permanent playlist gallery index exists and documents regeneration', () => {
  const indexPath = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'index.html');
  const readmePath = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'README.md');
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(readmePath), true);
  const index = fs.readFileSync(indexPath, 'utf8');
  assert.match(index, /Pattern Galleries/);
  const titanicAt = index.indexOf('<h2>Titanic</h2>');
  const transitionsAt = index.indexOf('<h2>Transitions</h2>');
  const hiddenAt = index.indexOf('<summary>Other scenes (hidden by default)</summary>');
  assert.ok(titanicAt >= 0 && titanicAt < transitionsAt,
    'Titanic must be the first gallery section');
  assert.ok(transitionsAt < hiddenAt,
    'non-Titanic scenes must remain collapsed at the bottom');
  assert.ok(index.indexOf('<h2>Studio</h2>') > hiddenAt);
  assert.ok(index.indexOf('<h2>Test Bench</h2>') > hiddenAt);
  assert.match(fs.readFileSync(readmePath, 'utf8'), /generate\.mjs --scene titanic --playlist ambient/);
});

const GALLERY_ROOT = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'playlists', 'titanic');

/**
 * How many entries the SOURCE playlist actually lists.
 *
 * The gallery is a rendering OF a playlist, so the playlist is the authority on
 * how many looks belong on the page. Reading it here (instead of writing 15)
 * means adding a tease pattern is a pattern + playlist + regenerate job with no
 * test edit at all.
 */
function playlistEntryCount(name) {
  const file = path.join(
    REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists', `${name}.yaml`);
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  return doc.entries.length;
}

function babyGallery(playlist) {
  const dir = path.join(GALLERY_ROOT, playlist);
  return {
    html: fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
    manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    dir,
  };
}

test('the baby tease gallery autoplays every preview and exposes manual controls', () => {
  const { html } = babyGallery('baby_tease');
  const videos = html.match(/<video\b[^>]*>/g) || [];
  assert.equal(videos.length, playlistEntryCount('baby_tease'));
  for (const video of videos) {
    assert.match(video, /\bautoplay\b/);
    assert.match(video, /\bmuted\b/);
    assert.match(video, /\bloop\b/);
    assert.match(video, /\bplaysinline\b/);
    assert.match(video, /\.mp4/);
  }
  assert.match(html, /const autoplay=video\.play\(\)/);
  assert.match(html, /Autoplay was blocked by this browser/);
  assert.match(html, /data-action="play"/);
  assert.match(html, /data-action="restart"/);
  assert.match(html, /data-action="repeat"/);
  assert.match(html, /data-action="seek"/);
});

// The Baby show is now TWO playlists (docs/73 — the Baby Reveal unification
// retired the boy/girl twin answer playlists in favour of one colour-blind
// `baby_reveal` playlist), and the galleries are how a teammate reviews them
// without the rig. The contract that matters here is SEPARATION: the tease
// gallery must not show an answer, because a reviewer scrolling it before the
// party would learn the outcome from the page.
//
// NOTE ON SCOPE: this test used to also compare the `baby_girl`/`baby_boy`
// galleries against the tease. Those playlists and their pattern source
// (`patterns/baby/`) are retired and deleted — `playlistEntryCount('baby_girl')`
// now throws ENOENT, which is exactly what caught this test needing a rework.
// `patterns/baby_reveal/*.js` (the replacement family) is being authored by a
// concurrent wave (docs/73) and its gallery has not been regenerated yet —
// generating it needs the palette armed (`patterns/baby_reveal/README.md`
// "The palette-carrier contract"), which is out of scope for a plumbing-only
// pass. So this test is narrowed to what it can still assert today: the tease
// gallery's own shape, and that it still answers nothing. A `baby_reveal`
// gallery gets its own coverage here once it exists and is regenerated —
// tracked as a TODO rather than silently dropped.
//
// Counts are DERIVED from the playlist the gallery was generated from, never
// hardcoded: the tease is deliberately curated, so changing its keeper count
// should not require changing this assertion. What stays pinned is that the
// gallery renders the playlist WHOLE — a generator that quietly dropped an
// entry is exactly what this catches.
test('the tease gallery exposes the outcome-blind tease and answers nothing', () => {
  const tease = babyGallery('baby_tease');

  const name = 'baby_tease';
  const idShape = /^baby_tease\/\d\d+_/;
  assert.equal(tease.manifest.playlist, name);
  const expected = playlistEntryCount(name);
  assert.equal(tease.manifest.items.length, expected,
    `${name} gallery renders ${tease.manifest.items.length} looks but the playlist ` +
    `lists ${expected} — regenerate the gallery`);
  for (const item of tease.manifest.items) {
    assert.match(item.pattern, idShape,
      `${name} gallery renders "${item.pattern}", which is not a ${name} pattern`);
    // Qualified ids keep their slash in the DATA and lose it only in the
    // generated media FILENAME.
    assert.ok(item.pattern.includes('/'), `${name}: pattern id must stay qualified`);
    assert.ok(!item.gif.includes('/') && !item.video.includes('/'),
      `${name}: media filename must not carry the directory separator`);
    assert.ok(fs.existsSync(path.join(tease.dir, 'gifs', item.gif)), `${name}: missing ${item.gif}`);
    assert.ok(fs.existsSync(path.join(tease.dir, 'videos', item.video)), `${name}: missing ${item.video}`);
  }

  // The tease answers nothing: no reveal pattern appears on its page.
  // The tease playlist's first entry (docs/72 §7 arc: calm -> curious ->
  // kinetic). This names a real look on purpose — a curation that retires it
  // must update this line, which is the point: the assertion should notice.
  assert.match(tease.html, /Baby Tease - Bullseye Tide/);
  assert.doesNotMatch(tease.html, /\d\d_girl_|\d\d_boy_/);
  assert.doesNotMatch(tease.html, /Baby (Girl|Boy|Reveal) -/);
});

// TODO(baby_reveal gallery): once patterns/baby_reveal/*.js exist and the
// gallery is regenerated with the palette armed (see README), add a sibling
// assertion here pinning its id shape to /^baby_reveal\/\d\d+_/ and its
// entry count to the playlist, matching the tease coverage above.

// `baby_reveal` is the SPECIAL EVENT show id. A playlist gallery under that name
// would mean the word has two meanings again, which is the confusion that put
// the show's own ARM on the wrong playlist.
test('no baby_reveal playlist gallery exists', () => {
  assert.equal(fs.existsSync(path.join(GALLERY_ROOT, 'baby_reveal')), false,
    'baby_reveal is a special event, not a playlist — its gallery must not exist');
  const index = fs.readFileSync(
    path.join(REPO_DIR, 'docs', 'pattern_gallery', 'index.html'), 'utf8');
  assert.doesNotMatch(index, /playlists\/titanic\/baby_reveal\//);
  for (const name of ['baby_tease', 'baby_girl', 'baby_boy']) {
    assert.match(index, new RegExp(`playlists/titanic/${name}/index\\.html`),
      `the gallery index does not link ${name}`);
  }
});

test('gallery palette resolution is explicit and fail-loud', () => {
  const config = { colorPalettes: [{ id: 'baby_blue', c1: 0.52, c2: 0.61 }] };
  assert.deepEqual(resolveGalleryPalette(config, 'baby_blue'), {
    id: 'baby_blue', c1: 0.52, c2: 0.61,
  });
  assert.equal(resolveGalleryPalette(config, null), null);
  assert.throws(() => resolveGalleryPalette(config, 'missing'), /not found/);
  assert.throws(() => resolveGalleryPalette({ colorPalettes: [
    { id: 'bad', c1: -0.1, c2: 0.4 },
  ] }, 'bad'), /invalid c1/);
});

test('playlist saved defaults are exact, finite, and target real controls', () => {
  const source = `
export var level = 0.4
export function sliderLevel(v) { level = v }
`;
  assert.deepEqual(validateSavedDefaults('example', source, { sliderLevel: 0.7 }), {
    sliderLevel: 0.7,
  });
  assert.throws(() => validateSavedDefaults('example', source, null), /plain object/);
  assert.throws(() => validateSavedDefaults('example', source, []), /plain object/);
  assert.throws(
    () => validateSavedDefaults('example', source, { sliderLevell: 0.7 }),
    /undeclared control sliderLevell/,
  );
  for (const value of ['0.7oops', Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
    assert.throws(
      () => validateSavedDefaults('example', source, { sliderLevel: value }),
      /finite value in \[0, 1\]/,
    );
  }
});

test('gallery publish swaps only after a complete staging tree exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_gallery_publish_'));
  const scratch = path.join(root, 'scratch');
  const outputRoot = path.join(root, 'output');
  const staging = path.join(scratch, 'staging', 'one');
  const output = path.join(outputRoot, 'scene', 'playlist');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(staging, 'new.txt'), 'complete');
  fs.writeFileSync(path.join(output, 'old.txt'), 'known good');
  publishGallery(staging, output, scratch, outputRoot);
  assert.equal(fs.readFileSync(path.join(output, 'new.txt'), 'utf8'), 'complete');
  assert.equal(fs.existsSync(path.join(output, 'old.txt')), false);
  assert.equal(fs.existsSync(staging), false);
  fs.rmSync(root, { recursive: true });
});

test('intent-campaign galleries are not ready until long exact-saved media exists', () => {
  const item = { scene: 'titanic', playlist: 'ambient_extra' };
  const entry = {
    intent: { schema_version: 1 },
    savedValues: { sliderLocalSpeed: 0.6 },
    effectiveValues: { sliderLocalSpeed: 0.6 },
    sourceDigest: 'a'.repeat(64),
  };
  const manifest = {
    schemaVersion: 3,
    seconds: 40,
    fps: 8,
    variation: 'saved',
    playlistDigest: 'b'.repeat(64),
    goalsDigest: 'c'.repeat(64),
    items: [entry],
  };
  assert.equal(galleryManifestMeetsCampaignContract(item, manifest), true);
  assert.equal(galleryManifestMeetsCampaignContract(item, { ...manifest, seconds: 10 }), false);
  assert.equal(galleryManifestMeetsCampaignContract(item, { ...manifest, variation: 'sound' }), false);
  assert.equal(galleryManifestMeetsCampaignContract(item, {
    ...manifest,
    items: [{ ...entry, effectiveValues: null }],
  }), false);
  assert.equal(galleryManifestMeetsCampaignContract(
    { scene: 'titanic', playlist: 'white_only' }, manifest), true);
  assert.equal(galleryManifestMeetsCampaignContract(
    { scene: 'studio', playlist: 'ambient' }, { schemaVersion: 2 }), true);
});

test('Titanic gallery compression closes the break without scaling either half', () => {
  const source = [
    { nx: 0.10, nz: 0.20 },
    { nx: 0.20, nz: 0.30 },
    { nx: 0.80, nz: 0.70 },
    { nx: 0.90, nz: 0.80 },
  ];
  const compressed = compressTitanicHalves(source, 0.5);
  const nearlyEqual = (actual, expected) => {
    assert.ok(Math.abs(actual - expected) < 1e-12);
  };
  nearlyEqual(compressed[1].nx - compressed[0].nx, 0.10);
  nearlyEqual(compressed[1].nz - compressed[0].nz, 0.10);
  nearlyEqual(compressed[3].nx - compressed[2].nx, 0.10);
  nearlyEqual(compressed[3].nz - compressed[2].nz, 0.10);
  assert.ok(compressed[2].nx - compressed[1].nx < source[2].nx - source[1].nx);
  assert.ok(compressed[2].nz - compressed[1].nz < source[2].nz - source[1].nz);
});

test('Titanic gallery exposes all stack PARs and only the physical front chains', () => {
  const meta = [];
  for (const [group, front] of [
    ['Left SmokeStack', [1, 2, 3, 4]],
    ['Right SmokeStacks', [5, 6, 7, 8]],
  ]) {
    for (let fixture = 1; fixture <= 8; fixture += 1) {
      meta.push({
        fixtureType: 'UkingPar',
        group,
        name: `${group} ${fixture} - rgbwau_1`,
        expectedFront: front.includes(fixture),
      });
    }
  }
  const roles = titanicSmokeStackIndices(meta);
  assert.equal(roles.all.length, 16);
  assert.deepEqual(roles.front, meta
    .map((item, index) => item.expectedFront ? index : null)
    .filter((index) => index !== null));
});

test('front stack PARs render a compact source with an upward-only body wash', () => {
  const width = 1440;
  const height = 330;
  const frame = Buffer.alloc(width * height * 3);
  drawUpwardWashLayer(frame, [{ x: 100, y: 100 }], [[255, 180, 40]]);
  const peakAt = (x, y) => Math.max(...frame.subarray((y * width + x) * 3,
    (y * width + x) * 3 + 3));
  assert.ok(peakAt(100, 100) > 200, 'PAR source must stay compact and bright');
  assert.ok(peakAt(100, 78) > 10, 'wash must illuminate above the source');
  assert.equal(peakAt(100, 115), 0, 'wash must not extend below the source');
});

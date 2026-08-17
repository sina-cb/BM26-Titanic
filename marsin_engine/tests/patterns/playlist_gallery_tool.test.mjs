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
  resolveGalleryPalette,
  titanicSmokeStackIndices,
  validateSavedDefaults,
} from '../../tools/playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');

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

// The Baby show is THREE playlists — an outcome-blind tease plus two manual
// answers — and the galleries are how a teammate reviews them without the rig.
// The contract that matters here is SEPARATION: the tease gallery must not show
// an answer, because a reviewer scrolling it before the party would learn the
// outcome from the page. A single combined `baby_reveal` gallery (which is what
// used to live here) cannot express that, which is why it is asserted gone.
// Counts are DERIVED from the playlist the gallery was generated from, never
// hardcoded: the tease is meant to grow past 20 looks (operator, 2026-08-15) and a
// frozen 15 here would turn every new tease pattern into a test edit. What stays
// pinned is that the gallery renders the playlist WHOLE — a generator that quietly
// dropped an entry is exactly what this catches.
test('split baby galleries expose the outcome-blind tease and manual answers', () => {
  const tease = babyGallery('baby_tease');
  const girl = babyGallery('baby_girl');
  const boy = babyGallery('baby_boy');

  for (const [name, gallery, prefix] of [
    ['baby_tease', tease, 'tease'],
    ['baby_girl', girl, 'girl'],
    ['baby_boy', boy, 'boy'],
  ]) {
    assert.equal(gallery.manifest.playlist, name);
    const expected = playlistEntryCount(name);
    assert.equal(gallery.manifest.items.length, expected,
      `${name} gallery renders ${gallery.manifest.items.length} looks but the playlist ` +
      `lists ${expected} — regenerate the gallery`);
    for (const item of gallery.manifest.items) {
      assert.match(item.pattern, new RegExp(`^baby/\\d\\d+_${prefix}_`),
        `${name} gallery renders "${item.pattern}", which is not a ${prefix} pattern`);
      // Qualified ids keep their slash in the DATA and lose it only in the
      // generated media FILENAME.
      assert.ok(item.pattern.includes('/'), `${name}: pattern id must stay qualified`);
      assert.ok(!item.gif.includes('/') && !item.video.includes('/'),
        `${name}: media filename must not carry the directory separator`);
      assert.ok(fs.existsSync(path.join(gallery.dir, 'gifs', item.gif)), `${name}: missing ${item.gif}`);
      assert.ok(fs.existsSync(path.join(gallery.dir, 'videos', item.video)), `${name}: missing ${item.video}`);
    }
  }

  // The tease answers nothing: no girl or boy pattern appears on its page, and
  // neither answer playlist is linked from it.
  assert.match(tease.html, /Baby Tease - Orbit Question/);
  assert.doesNotMatch(tease.html, /\d\d_girl_|\d\d_boy_/);
  assert.doesNotMatch(tease.html, /Baby (Girl|Boy) -/);

  assert.match(girl.html, /Baby Girl - Orbit Glow/);
  assert.match(boy.html, /Baby Boy - Orbit Glow/);
  assert.doesNotMatch(girl.html, /\d\d_boy_/);
  assert.doesNotMatch(boy.html, /\d\d_girl_/);
});

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

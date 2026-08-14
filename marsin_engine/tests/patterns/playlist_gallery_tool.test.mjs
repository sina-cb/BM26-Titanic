import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compressTitanicHalves,
  drawUpwardWashLayer,
  encodeFramesWithFfmpeg,
  encodeVideoFramesWithFfmpeg,
  resolveGalleryPalette,
  titanicSmokeStackIndices,
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
  assert.match(fs.readFileSync(indexPath, 'utf8'), /Pattern Galleries/);
  assert.match(fs.readFileSync(readmePath, 'utf8'), /generate\.mjs --scene titanic --playlist ambient/);
});

test('baby reveal gallery exposes seek, playback, repeat, restart, and chapters', () => {
  const galleryPath = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'playlists',
    'titanic', 'baby_reveal', 'index.html');
  const gallery = fs.readFileSync(galleryPath, 'utf8');
  assert.match(gallery, /<video[^>]+\.mp4/);
  assert.match(gallery, /data-action="play"/);
  assert.match(gallery, /data-action="restart"/);
  assert.match(gallery, /data-action="repeat"/);
  assert.match(gallery, /data-action="seek"/);
  assert.match(gallery, /data-chapter="90"[^>]*>.*Blackout/s);
  assert.match(gallery, /data-chapter="92"[^>]*>.*Reveal explosion/s);
});

test('split baby galleries expose the outcome-blind tease and manual answers', () => {
  const galleryRoot = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'playlists', 'titanic');
  const tease = fs.readFileSync(path.join(galleryRoot, 'baby_tease', 'index.html'), 'utf8');
  const girl = fs.readFileSync(path.join(galleryRoot, 'baby_girl', 'index.html'), 'utf8');
  const boy = fs.readFileSync(path.join(galleryRoot, 'baby_boy', 'index.html'), 'utf8');
  assert.match(tease, /Baby Tease - The Impossible Question/);
  assert.match(tease, /data-chapter="60"[^>]*>.*Side scarcity swings/s);
  assert.match(tease, /data-chapter="120"[^>]*>.*Pink \/ All \/ Blue \/ All/s);
  assert.match(tease, /data-chapter="150"[^>]*>.*White-flash finale/s);
  assert.match(tease, /data-chapter="158"[^>]*>.*Blackout/s);
  assert.doesNotMatch(tease, /Reveal explosion/);
  assert.match(girl, /Baby Girl - Reveal Explosion/);
  assert.match(girl, /data-chapter="0"[^>]*>.*Reveal explosion/s);
  assert.match(boy, /Baby Boy - Reveal Explosion/);
  assert.match(boy, /data-chapter="2"[^>]*>.*Photo hold/s);
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

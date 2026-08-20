#!/usr/bin/env node
/*
 * Generate the permanent, offline Deck-transition comparison gallery.
 *
 * Every row uses the same exact saved Titanic Baby endpoints:
 *   A: baby_boy / Keel Breath (blue)
 *   B: baby_girl / Keel Breath (pink)
 *
 * The compositor mirrors the production Deck execution path: smoothstep
 * progress and the selected trans_* script for every in-flight frame, followed
 * by an exact atomic promotion to B. There is no universal tail cut.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { WasmHost } from '../../lib/wasm_host.js';
import {
  encodeFramesWithFfmpeg,
  encodeVideoFramesWithFfmpeg,
  renderCaptureFrames,
} from '../playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const TRANSITIONS_DIR = path.join(PATTERNS_DIR, 'transitions');
const PLAYLISTS_DIR = path.join(REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists');
const DOCS_DIR = path.join(REPO_DIR, 'docs', 'pattern_gallery', 'transitions');
const SCRATCH_DIR = path.join(os.homedir(), 'tmp', 'transition_gallery');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const PLAYLIST_INDEX = path.join(ENGINE_DIR, 'tools', 'playlist_gallery', 'generate.mjs');

const MODEL = 'titanic';
const INTERNAL_FPS = 40;
const DEFAULT_OUTPUT_FPS = 20;
const DEFAULT_HOLD_SECONDS = 1;
const DEFAULT_TRANSITION_SECONDS = 2;
const P0_COMPLETION_EXCESS_RMS_THRESHOLD = 2;

const ENDPOINTS = {
  a: {
    playlist: 'baby_boy',
    entryId: 'e_baby_boy_keel_breath',
    color: 'blue',
    shortLabel: 'A · BLUE',
  },
  b: {
    playlist: 'baby_girl',
    entryId: 'e_baby_girl_keel_breath',
    color: 'pink',
    shortLabel: 'B · PINK',
  },
};

const VERDICTS = {
  trans_crossfade: {
    verdict: 'KEEP',
    reason: 'True six-lane linear interpolation with exact A and B endpoints.',
  },
  trans_color_burst: {
    verdict: 'KEEP',
    reason: 'Script now owns its full curve and converges exactly to B.',
  },
  trans_flash: {
    verdict: 'KEEP',
    reason: 'Script now owns its full white-flash curve and converges exactly to B.',
  },
  trans_ripple_in: {
    verdict: 'TUNE',
    reason: 'Keep the concept; repair weak or misleading ring controls before blessing.',
  },
  trans_wave_sweep: {
    verdict: 'TUNE',
    reason: 'Keep the concept; the frequency control did not pass the parameter-truth audit.',
  },
};

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument "${token}"`);
    const name = token.slice(2);
    if (['help', 'strict-audit'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Deck transition gallery generator

Options:
  --hold-seconds <n>        A and B hold duration (default ${DEFAULT_HOLD_SECONDS})
  --transition-seconds <n>  transition duration (default ${DEFAULT_TRANSITION_SECONDS})
  --fps <n>                 MP4/GIF playback fps (default ${DEFAULT_OUTPUT_FPS})
  --strict-audit            exit non-zero when a completion discontinuity exceeds baseline
`);
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing unsafe generated path outside ${parent}: ${target}`);
  }
}

function readYaml(filePath) {
  const value = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error(`invalid YAML object: ${filePath}`);
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function prettyName(value) {
  return value
    .replace(/^trans_/, '')
    .split('_')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}

function savedSet(defaults) {
  return Object.entries(defaults || {})
    .map(([name, value]) => {
      if (!Number.isFinite(value)) {
        throw new Error(`saved control ${name} must be a finite number, got ${value}`);
      }
      return `${name}=${value}`;
    })
    .join(',');
}

export function smoothstepProgress(linear) {
  const value = Math.max(0, Math.min(1, Number(linear)));
  return value * value * (3 - 2 * value);
}

export function resolveDeckBlendName(transition) {
  return transition;
}

export function sequenceStage(timeSeconds, holdSeconds, transitionSeconds) {
  if (timeSeconds < holdSeconds) return 'a';
  if (timeSeconds < holdSeconds + transitionSeconds) return 'transition';
  return 'b';
}

function loadEndpoint(spec) {
  const playlistPath = path.join(PLAYLISTS_DIR, `${spec.playlist}.yaml`);
  const playlist = readYaml(playlistPath);
  if (!Array.isArray(playlist.entries)) {
    throw new Error(`playlist has no entries array: ${playlistPath}`);
  }
  const entry = playlist.entries.find((candidate) => candidate?.id === spec.entryId);
  if (!entry) throw new Error(`${spec.playlist}: entry not found: ${spec.entryId}`);
  const patternPath = path.join(PATTERNS_DIR, `${entry.pattern}.js`);
  assertInside(PATTERNS_DIR, patternPath);
  if (!fs.existsSync(patternPath)) throw new Error(`pattern not found: ${patternPath}`);
  return {
    ...spec,
    entry,
    playlistPath,
    patternPath,
    label: entry.label,
    pattern: entry.pattern,
  };
}

function captureEndpoint(endpoint, seconds) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const outputPath = path.join(SCRATCH_DIR, `${endpoint.playlist}_${endpoint.entryId}.json`);
  const args = [
    HARNESS,
    '--pattern', endpoint.patternPath,
    '--model', MODEL,
    '--seconds', String(seconds),
    '--out-fps', String(INTERNAL_FPS),
    '--gate-frames', String(Math.ceil(seconds * INTERNAL_FPS)),
    '--max-cells', String(Math.ceil(seconds * INTERNAL_FPS * 2000)),
    '--synth', 'silence',
    '--out', outputPath,
  ];
  const set = savedSet(endpoint.entry.defaults);
  if (set) args.push('--set', set);
  execFileSync(process.execPath, args, {
    cwd: ENGINE_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const capture = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (capture.model !== MODEL) throw new Error(`${endpoint.pattern}: capture model is ${capture.model}`);
  if (capture.fps !== INTERNAL_FPS) {
    throw new Error(`${endpoint.pattern}: capture fps is ${capture.fps}, expected ${INTERNAL_FPS}`);
  }
  if (!Array.isArray(capture.frames) || !Array.isArray(capture.meta)) {
    throw new Error(`${endpoint.pattern}: malformed capture`);
  }
  return capture;
}

function rgbToRgbwau(frame, pixelCount) {
  if (!Array.isArray(frame) || frame.length !== pixelCount) {
    throw new Error(`frame pixel count ${frame?.length} does not match model ${pixelCount}`);
  }
  const output = new Uint8Array(pixelCount * 6);
  for (let index = 0; index < pixelCount; index += 1) {
    const color = frame[index];
    output[index * 6] = color[0];
    output[index * 6 + 1] = color[1];
    output[index * 6 + 2] = color[2];
  }
  return output;
}

function rgbwauToRgb(frame, pixelCount) {
  const output = new Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    output[index] = [frame[index * 6], frame[index * 6 + 1], frame[index * 6 + 2]];
  }
  return output;
}

function bufferDiff(a, b, pixelCount) {
  if (a.length !== b.length) throw new Error(`buffer length mismatch: ${a.length} != ${b.length}`);
  let squared = 0;
  let maximum = 0;
  let changedPixels = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = Math.abs(a[index] - b[index]);
    squared += delta * delta;
    maximum = Math.max(maximum, delta);
  }
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 6;
    let changed = false;
    for (let lane = 0; lane < 6; lane += 1) {
      if (a[offset + lane] !== b[offset + lane]) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  return {
    rmsBytes: Math.sqrt(squared / a.length),
    maxByteDelta: maximum,
    changedPixels,
  };
}

function transitionFiles() {
  const files = fs.readdirSync(TRANSITIONS_DIR)
    .filter((name) => name.startsWith('trans_') && name.endsWith('.js'))
    .sort();
  if (files.length === 0) throw new Error(`no transitions found in ${TRANSITIONS_DIR}`);
  return files;
}

function blendSourcePath(transition) {
  return path.join(TRANSITIONS_DIR, `${transition}.js`);
}

function defaultVerdict(transition) {
  return VERDICTS[transition] || {
    verdict: 'KEEP',
    reason: 'Deterministic retained transition with exact endpoint convergence.',
  };
}

function renderTransition(host, transition, captureA, captureB, options) {
  const sourcePath = blendSourcePath(transition);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = host.compile(source);
  if (!compiled.ok) throw new Error(`${transition}: compile failed: ${compiled.error}`);

  const pixelCount = captureA.meta.length;
  const totalSeconds = options.holdSeconds * 2 + options.transitionSeconds;
  const internalFrames = Math.round(totalSeconds * INTERNAL_FPS);
  const emitEvery = INTERNAL_FPS / options.outputFps;
  if (!Number.isInteger(emitEvery)) {
    throw new Error(`--fps must divide ${INTERNAL_FPS} exactly`);
  }
  if (captureA.frames.length < internalFrames || captureB.frames.length < internalFrames) {
    throw new Error(`${transition}: endpoint capture is shorter than ${internalFrames} frames`);
  }

  const outputFrames = [];
  const holdFrames = Math.round(options.holdSeconds * INTERNAL_FPS);
  let previous = null;
  let largestFrameJump = null;
  let completionJump = null;
  let completionBaseline = null;
  let endpointAResidual = null;
  let endpointBResidual = null;
  try {
    host.beginFrame(compiled.handle, 0);
    for (let frameIndex = 0; frameIndex < internalFrames; frameIndex += 1) {
      const timeSeconds = frameIndex / INTERNAL_FPS;
      const stage = sequenceStage(
        timeSeconds, options.holdSeconds, options.transitionSeconds);
      const from = rgbToRgbwau(captureA.frames[frameIndex], pixelCount);
      const incomingFrameIndex = Math.max(0, frameIndex - holdFrames);
      const to = rgbToRgbwau(captureB.frames[incomingFrameIndex], pixelCount);
      let output;
      if (stage === 'a') {
        output = from;
      } else if (stage === 'b') {
        output = to;
        if (completionJump === null && previous !== null) {
          const previousB = rgbToRgbwau(
            captureB.frames[Math.max(0, incomingFrameIndex - 1)], pixelCount);
          completionJump = {
            ...bufferDiff(previous, output, pixelCount),
            frameIndex,
            timeSeconds,
          };
          completionBaseline = {
            ...bufferDiff(previousB, output, pixelCount),
            frameIndex,
            timeSeconds,
          };
        }
      } else {
        const linear = (timeSeconds - options.holdSeconds) / options.transitionSeconds;
        const progress = smoothstepProgress(linear);
        const scripted = host.renderBlend6ch(
          compiled.handle, pixelCount, from, to, progress);
        if (endpointAResidual === null) {
          endpointAResidual = bufferDiff(scripted, from, pixelCount);
        }
        output = scripted;
      }

      if (previous !== null && stage !== 'a') {
        const jump = {
          ...bufferDiff(previous, output, pixelCount),
          frameIndex,
          timeSeconds,
        };
        if (largestFrameJump === null || jump.rmsBytes > largestFrameJump.rmsBytes) {
          largestFrameJump = jump;
        }
      }
      previous = output;
      if (frameIndex % emitEvery === 0) {
        outputFrames.push(rgbwauToRgb(output, pixelCount));
      }
    }

    const lastA = rgbToRgbwau(
      captureA.frames[holdFrames], pixelCount);
    const lastB = rgbToRgbwau(
      captureB.frames[0], pixelCount);
    endpointAResidual = bufferDiff(
      host.renderBlend6ch(compiled.handle, pixelCount, lastA, lastB, 0),
      lastA,
      pixelCount,
    );
    endpointBResidual = bufferDiff(
      host.renderBlend6ch(compiled.handle, pixelCount, lastA, lastB, 1),
      lastB,
      pixelCount,
    );
  } finally {
    host.destroy(compiled.handle);
  }

  if (completionJump === null || completionBaseline === null) {
    throw new Error(`${transition}: completion boundary was not sampled`);
  }
  const completionExcessRms = Math.max(
    0,
    completionJump.rmsBytes - completionBaseline.rmsBytes,
  );
  return {
    capture: {
      ...captureA,
      fps: options.outputFps,
      seconds: totalSeconds,
      pattern: `${captureA.pattern} -> ${transition} -> ${captureB.pattern}`,
      frames: outputFrames,
    },
    audit: {
      endpointAResidual,
      endpointBResidual,
      completionJump,
      completionBaseline,
      completionExcessRms,
      largestFrameJump,
      p0Open: completionExcessRms >= P0_COMPLETION_EXCESS_RMS_THRESHOLD,
    },
  };
}

function formatMetric(value) {
  return Number(value).toFixed(2);
}

function galleryHtml(manifest) {
  const cards = manifest.items.map((item, index) => {
    const p0 = item.audit.p0Open
      ? `<span class="p0">P0 · completion excess ${formatMetric(item.audit.completionExcessRms)} RMS bytes</span>`
      : '<span class="clean">Completion tracks B baseline</span>';
    return `<article class="transition" id="${escapeHtml(item.transition)}">
      <header><span class="number">${String(index + 1).padStart(2, '0')}</span><div>
        <p class="eyebrow">${escapeHtml(item.transition)} · actual blend ${escapeHtml(item.actualBlend)}</p>
        <h2>${escapeHtml(prettyName(item.transition))}</h2>
      </div><span class="verdict ${item.verdict.toLowerCase()}">${escapeHtml(item.verdict)}</span></header>
      <div class="sequence" aria-label="Fixed comparison sequence">
        <span class="a">${escapeHtml(manifest.endpointA.shortLabel)}<small>${escapeHtml(manifest.endpointA.label)}</small></span>
        <b>→</b><span class="tx">TRANSITION<small>${escapeHtml(item.transition)}</small></span>
        <b>→</b><span class="b">${escapeHtml(manifest.endpointB.shortLabel)}<small>${escapeHtml(manifest.endpointB.label)}</small></span>
      </div>
      <div class="view-labels"><span>TOP · X/Z</span><span>FRONT · X/Y</span><span>${escapeHtml(item.featureLabel)}</span></div>
      <div class="clip-player" data-hold="${manifest.holdSeconds}" data-transition="${manifest.transitionSeconds}">
        <video src="videos/${escapeHtml(item.video)}" muted playsinline preload="metadata" autoplay loop></video>
        <div class="transport">
          <button type="button" data-action="play">Pause</button>
          <button type="button" data-seek="0">A · Blue</button>
          <button type="button" data-seek="${manifest.holdSeconds}">Transition</button>
          <button type="button" data-seek="${manifest.holdSeconds + manifest.transitionSeconds}">B · Pink</button>
          <span class="stage">A · BLUE</span>
          <input data-action="seek" type="range" min="0" max="${manifest.totalSeconds}" step="0.025" value="0" aria-label="Seek sequence">
          <a href="gifs/${escapeHtml(item.gif)}" download>Download GIF</a>
        </div>
      </div>
      <div class="audit">${p0}<span>completion ${formatMetric(item.audit.completionJump.rmsBytes)} RMS</span><span>B baseline ${formatMetric(item.audit.completionBaseline.rmsBytes)} RMS</span><span>end residual ${item.audit.endpointBResidual.maxByteDelta} byte</span></div>
      <p class="reason">${escapeHtml(item.reason)}</p>
    </article>`;
  }).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BM26 · Titanic Deck Transition Gallery</title>
<style>
:root{--bg:#06090e;--panel:#0e141e;--line:#253247;--text:#edf3fb;--muted:#93a4bb;--gold:#f6bd39;--blue:#5bb7ff;--pink:#ff71bf;--red:#ff665f;--green:#73d6a5}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#182235 0,#06090e 48%);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{width:min(1720px,100%);margin:auto;padding:34px clamp(10px,2.2vw,38px) 90px}.hero{padding:12px 4px 30px;border-bottom:1px solid var(--line)}.back{color:var(--gold);text-decoration:none;font-weight:700}.eyebrow{margin:0;color:var(--muted);font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase}h1{font-size:clamp(30px,4vw,56px);letter-spacing:-.035em;margin:14px 0 7px}.hero>p{max-width:1040px;color:var(--muted);font-size:17px}.facts,.audit{display:flex;gap:8px;flex-wrap:wrap}.facts span,.audit span{border:1px solid #33425a;border-radius:999px;padding:5px 10px;color:#cad5e3;background:#0a1018}.facts .p0,.audit .p0{color:#ffd1cf;border-color:#7f342f;background:#25110f}.transition{margin-top:28px;padding:clamp(12px,1.5vw,24px);background:linear-gradient(145deg,#101824,#0a1018);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 55px #0008;overflow:hidden}.transition header{display:flex;align-items:center;gap:13px;margin-bottom:14px}.number{display:grid;place-items:center;flex:0 0 48px;height:42px;border-radius:11px;background:#251e0c;color:var(--gold);font-weight:900}.transition h2{font-size:clamp(20px,2vw,27px);letter-spacing:-.02em;margin:2px 0 0}.verdict{margin-left:auto;border:1px solid;border-radius:999px;padding:5px 10px;font:800 11px ui-monospace,monospace}.verdict.keep{color:var(--green)}.verdict.tune{color:var(--gold)}.verdict.remove{color:var(--red)}.sequence{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:stretch;gap:10px;margin:10px 0 15px}.sequence>span{display:flex;flex-direction:column;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-weight:900}.sequence small{font-weight:500;color:var(--muted)}.sequence b{align-self:center}.sequence .a{border-color:#2d78a7;color:var(--blue)}.sequence .tx{border-color:#786423;color:var(--gold)}.sequence .b{border-color:#9a396e;color:var(--pink)}.view-labels{display:grid;grid-template-columns:repeat(3,1fr);font:700 11px ui-monospace,monospace;letter-spacing:.08em;color:#aebbd0;text-align:center;background:#09101a}.view-labels span{padding:10px}.clip-player{background:#04070c;border:1px solid #2b3a50}.clip-player video{display:block;width:100%;height:auto;background:#04070c}.transport{display:grid;grid-template-columns:auto auto auto auto minmax(90px,auto) minmax(180px,1fr) auto;gap:8px;align-items:center;padding:10px;background:#09101a}.transport button,.transport a{border:1px solid #40516a;border-radius:8px;background:#111b29;color:var(--text);padding:7px 9px;font:700 12px inherit;text-decoration:none;cursor:pointer}.transport input{width:100%}.stage{color:var(--gold);font:900 11px ui-monospace,monospace}.audit{margin-top:13px}.audit .clean{color:var(--green)}.reason{color:#c5d0df;margin-bottom:0}@media(max-width:800px){.transport{grid-template-columns:repeat(2,1fr)}.transport input{grid-column:1/-1}.sequence{grid-template-columns:1fr}.sequence b{display:none}.transition{padding-inline:8px}.view-labels{font-size:9px}}
</style></head><body><main><div class="hero"><a class="back" href="../index.html">← All galleries</a><p class="eyebrow">BM26 · Titanic’s End · production transition oracle</p><h1>Deck Transition Gallery</h1><p>Every row is the same deterministic, full-rig sequence: exact saved Baby Boy Keel Breath in blue, the selected Deck transition, then exact saved Baby Girl Keel Breath in pink. Both endpoint VMs share one synchronized 40 fps phase clock so the visual comparison isolates transition behavior. MP4s are seekable; GIFs are downloadable.</p><div class="facts"><span>${manifest.items.length} transitions</span><span>${manifest.pixelCount} Titanic pixels</span><span>${manifest.holdSeconds}s A · ${manifest.transitionSeconds}s transition · ${manifest.holdSeconds}s B</span><span>${manifest.outputFps} fps media · ${manifest.internalFps} fps audit</span><span class="${manifest.p0OpenCount ? 'p0' : 'clean'}">${manifest.p0OpenCount ? `P0 OPEN · ${manifest.p0OpenCount}` : 'ENDPOINT ORACLE · PASS'}</span></div></div>${cards}</main>
<script>
for(const player of document.querySelectorAll('.clip-player')){
  const video=player.querySelector('video');const play=player.querySelector('[data-action="play"]');const seek=player.querySelector('[data-action="seek"]');const stage=player.querySelector('.stage');const hold=Number(player.dataset.hold);const transition=Number(player.dataset.transition);
  const refresh=()=>{const t=video.currentTime||0;seek.value=t;stage.textContent=t<hold?'A · BLUE':t<hold+transition?'TRANSITION':'B · PINK';play.textContent=video.paused?'Play':'Pause'};
  play.addEventListener('click',()=>video.paused?video.play():video.pause());video.addEventListener('timeupdate',refresh);video.addEventListener('play',refresh);video.addEventListener('pause',refresh);seek.addEventListener('input',()=>{video.currentTime=Number(seek.value);refresh()});for(const button of player.querySelectorAll('[data-seek]'))button.addEventListener('click',()=>{video.currentTime=Number(button.dataset.seek);video.play()});video.play().catch(refresh);refresh();
}
</script></body></html>`;
}

async function generate(options) {
  const endpointA = loadEndpoint(ENDPOINTS.a);
  const endpointB = loadEndpoint(ENDPOINTS.b);
  const totalSeconds = options.holdSeconds * 2 + options.transitionSeconds;
  const captureA = captureEndpoint(endpointA, totalSeconds);
  const captureB = captureEndpoint(endpointB, totalSeconds);
  if (captureA.meta.length !== captureB.meta.length) {
    throw new Error(`A/B model pixel counts differ: ${captureA.meta.length} != ${captureB.meta.length}`);
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const gifDir = path.join(DOCS_DIR, 'gifs');
  const videoDir = path.join(DOCS_DIR, 'videos');
  for (const directory of [gifDir, videoDir]) {
    assertInside(DOCS_DIR, directory);
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
    fs.mkdirSync(directory, { recursive: true });
  }

  const host = new WasmHost();
  await host.init(captureA.meta.length);
  host.setCoords(captureA.meta);

  const items = [];
  const files = transitionFiles();
  for (let index = 0; index < files.length; index += 1) {
    const transition = path.basename(files[index], '.js');
    process.stdout.write(`[${index + 1}/${files.length}] ${transition} ... `);
    const result = renderTransition(host, transition, captureA, captureB, options);
    const rendered = renderCaptureFrames(result.capture, MODEL);
    const stem = `${String(index + 1).padStart(3, '0')}_${transition}`;
    const gif = `${stem}.gif`;
    const video = `${stem}.mp4`;
    encodeFramesWithFfmpeg(
      rendered.frames, rendered.width, rendered.height, options.outputFps, path.join(gifDir, gif));
    encodeVideoFramesWithFfmpeg(
      rendered.frames, rendered.width, rendered.height, options.outputFps, path.join(videoDir, video));
    const verdict = defaultVerdict(transition);
    items.push({
      transition,
      source: path.relative(REPO_DIR, path.join(TRANSITIONS_DIR, files[index])).replaceAll('\\', '/'),
      actualBlend: resolveDeckBlendName(transition),
      verdict: verdict.verdict,
      reason: verdict.reason,
      gif,
      video,
      featureLabel: rendered.featureLabel,
      audit: result.audit,
    });
    console.log(`${verdict.verdict} · completion excess ${formatMetric(result.audit.completionExcessRms)} RMS`);
  }

  const manifest = {
    schemaVersion: 1,
    model: MODEL,
    pixelCount: captureA.meta.length,
    endpointA: {
      ...ENDPOINTS.a,
      label: endpointA.label,
      pattern: endpointA.pattern,
      defaults: endpointA.entry.defaults || {},
    },
    endpointB: {
      ...ENDPOINTS.b,
      label: endpointB.label,
      pattern: endpointB.pattern,
      defaults: endpointB.entry.defaults || {},
    },
    phasePolicy: 'incoming B zero-seeded and parked until transition start; phase state promoted atomically',
    holdSeconds: options.holdSeconds,
    transitionSeconds: options.transitionSeconds,
    totalSeconds,
    internalFps: INTERNAL_FPS,
    outputFps: options.outputFps,
    deckExecution: {
      faderCurve: 'smoothstep',
      crossfadeBlend: 'trans_crossfade',
      tailCut: false,
    },
    p0CompletionExcessRmsThreshold: P0_COMPLETION_EXCESS_RMS_THRESHOLD,
    p0OpenCount: items.filter((item) => item.audit.p0Open).length,
    items,
  };
  fs.writeFileSync(path.join(DOCS_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), galleryHtml(manifest));
  // Windows can briefly retain a sharing lock on the master index while the
  // generated transition media is being closed/scanned. Retry only that
  // isolated index rebuild; exhaust the bounded attempts and the tool still
  // fails loudly (there is no stale-index success path).
  let indexBuilt = false;
  let indexError = null;
  for (let attempt = 1; attempt <= 5 && !indexBuilt; attempt += 1) {
    try {
      execFileSync(process.execPath, [PLAYLIST_INDEX, '--index-only'], {
        cwd: ENGINE_DIR,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      indexBuilt = true;
    } catch (error) {
      indexError = error;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }
  }
  if (!indexBuilt) throw indexError;
  console.log(`GALLERY ${path.join(DOCS_DIR, 'index.html')}`);
  if (manifest.p0OpenCount > 0) {
    console.error(`P0_OPEN: ${manifest.p0OpenCount} transitions exceed ` +
      `${P0_COMPLETION_EXCESS_RMS_THRESHOLD} RMS bytes above the B motion baseline.`);
  }
  return manifest;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const options = {
    holdSeconds: Number(args['hold-seconds'] ?? DEFAULT_HOLD_SECONDS),
    transitionSeconds: Number(args['transition-seconds'] ?? DEFAULT_TRANSITION_SECONDS),
    outputFps: Number(args.fps ?? DEFAULT_OUTPUT_FPS),
  };
  if (!(options.holdSeconds > 0) || !(options.transitionSeconds > 0)) {
    throw new Error('--hold-seconds and --transition-seconds must be > 0');
  }
  if (!(options.outputFps >= 2 && options.outputFps <= INTERNAL_FPS)
      || !Number.isInteger(INTERNAL_FPS / options.outputFps)) {
    throw new Error(`--fps must be an integer divisor of ${INTERNAL_FPS} in [2, ${INTERNAL_FPS}]`);
  }
  const manifest = await generate(options);
  if (args['strict-audit'] && manifest.p0OpenCount > 0) process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`transition_gallery: ${error.message}`);
    process.exitCode = 1;
  });
}

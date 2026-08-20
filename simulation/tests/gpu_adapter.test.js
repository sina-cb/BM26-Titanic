/**
 * gpu_adapter.test.js — pure tests for the GPU-adapter visibility layer
 * (src/core/gpu_adapter.js + src/gui/gpu_adapter_warning.js), from report
 * `20260725_38`: a sustained 10 FPS on the titanic scene was the Intel iGPU,
 * not a code regression, and nothing in the sim said so.
 *
 * DOM-free: covers the classification of real adapter strings observed on this
 * box, the messaging both the banner and the low-FPS escalation share, and the
 * banner state machine. The browser probes themselves are not unit-testable
 * (they need a real GPU process) and are proved live instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAdapter, adapterWarningText, adapterLogLine, GPU_ADAPTER_REMEDY,
} from '../src/core/gpu_adapter.js';
import { bannerStateForAdapter } from '../src/gui/gpu_adapter_warning.js';

// Real strings: rows 1 and 10 of the `20260725_38` measurement matrix.
const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) ' +
  'Direct3D11 vs_5_0 ps_5_0, D3D11)';
const INTEL_UHD = 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) ' +
  'Direct3D11 vs_5_0 ps_5_0, D3D11)';

test('the discrete adapter (the 59.9 FPS case) classifies clean', () => {
  assert.deepEqual(classifyAdapter(NVIDIA), {
    renderer: NVIDIA, integrated: false, detectionFailed: false,
  });
});

test('the Intel UHD adapter (the 10 FPS repro) classifies integrated', () => {
  const a = classifyAdapter(INTEL_UHD);
  assert.equal(a.integrated, true);
  assert.equal(a.detectionFailed, false);
  assert.equal(a.renderer, INTEL_UHD);
});

test('other integrated / software adapter strings are caught', () => {
  const strings = [
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
    'Intel Open Source Technology Center Mesa DRI Intel(R) HD Graphics',
    'Integrated GPU device',
  ];
  for (const s of strings) assert.equal(classifyAdapter(s).integrated, true, s);
});

test('non-Windows discrete/unified adapters are NOT flagged', () => {
  // Apple Silicon's GPU is integrated by construction and renders this scene
  // fine — flagging it would be a false alarm on every Mac operator surface.
  const fine = [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
    'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    NVIDIA,
  ];
  for (const s of fine) assert.equal(classifyAdapter(s).integrated, false, s);
});

test('an unreadable adapter is reported as UNKNOWN, never assumed healthy', () => {
  for (const bad of [null, undefined, '', '   ', 42, {}]) {
    const a = classifyAdapter(bad);
    assert.equal(a.detectionFailed, true);
    assert.equal(a.renderer, null);
    assert.equal(a.integrated, false); // unknown is not "integrated" — it is unknown
  }
});

test('the integrated warning names the adapter and carries the operator remedy', () => {
  const text = adapterWarningText(classifyAdapter(INTEL_UHD));
  assert.match(text, /RENDERING ON/);
  assert.match(text, /Intel\(R\) UHD Graphics/);
  assert.match(text, /discrete GPU is idle/);
  assert.match(text, /~10-20 FPS/);
  assert.ok(text.includes(GPU_ADAPTER_REMEDY), 'remedy text must be embedded verbatim');
});

test('the remedy names the exact Windows path and the chrome://gpu check', () => {
  assert.match(GPU_ADAPTER_REMEDY, /Windows Settings → Display → Graphics/);
  assert.match(GPU_ADAPTER_REMEDY, /High performance/);
  assert.match(GPU_ADAPTER_REMEDY, /chrome:\/\/gpu/);
});

test('a healthy adapter produces no warning text at all', () => {
  assert.equal(adapterWarningText(classifyAdapter(NVIDIA)), null);
  assert.equal(adapterWarningText(null), null);
  assert.equal(adapterWarningText(undefined), null);
});

test('an UNKNOWN adapter still warns — an unverifiable FPS number proves nothing', () => {
  const text = adapterWarningText(classifyAdapter(null));
  assert.match(text, /GPU ADAPTER UNKNOWN/);
  assert.ok(text.includes(GPU_ADAPTER_REMEDY));
});

test('the boot log line states the backend and the verdict', () => {
  assert.match(adapterLogLine(classifyAdapter(NVIDIA), 'webgl'), /webgl: .*RTX 4090.*\(discrete\)/);
  assert.match(adapterLogLine(classifyAdapter(INTEL_UHD), 'webgpu'), /webgpu: .*\(INTEGRATED — SLOW\)/);
  assert.match(adapterLogLine(classifyAdapter(''), 'webgl'), /adapter UNKNOWN/);
  assert.match(adapterLogLine(null, 'webgl'), /adapter UNKNOWN/);
});

test('banner shows for integrated and for unknown, hides for discrete', () => {
  assert.equal(bannerStateForAdapter(classifyAdapter(INTEL_UHD)).show, true);
  assert.equal(bannerStateForAdapter(classifyAdapter(null)).show, true);
  assert.deepEqual(bannerStateForAdapter(classifyAdapter(NVIDIA)), { show: false, text: '' });
});

test('banner text is exactly the shared warning text (badge and log cannot diverge)', () => {
  const adapter = classifyAdapter(INTEL_UHD);
  assert.equal(bannerStateForAdapter(adapter).text, adapterWarningText(adapter));
});

test('no adapter yet (detection has not run) shows nothing', () => {
  assert.deepEqual(bannerStateForAdapter(null), { show: false, text: '' });
  assert.deepEqual(bannerStateForAdapter(undefined), { show: false, text: '' });
});

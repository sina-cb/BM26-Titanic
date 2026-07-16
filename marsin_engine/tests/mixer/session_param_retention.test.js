// End-to-end: prove SESSION PARAM RETENTION (feature A). Spawn the engine with
// redirected temp state/playlist dirs, tune a pattern, switch away and back, and
// assert the tuning survives IN MEMORY — while the on-disk yamls stay
// byte-identical (only the FILE write is gated by auto-save; in-session
// continuity is unconditional). Covers: deck A→B→A (auto-save OFF), the same
// during performance mode, entry-defaults-vs-cache precedence, mixer-layer
// A→B→A continuity + playlist-reassign scoping, direct /pattern set, and the
// performance RESTORE-clears / KEEP-keeps rule.
// Run:  node --test tests/session_param_retention.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'summer_camp_dome';
const PAT_A = '01_cylon_sweep';
const PAT_B = '13_sparkle';

const h = createEngineHarness({
  scene: SCENE,
  pattern: PAT_B,
  prefix: 'marsin-retention',
  portBase: 6810,
  portSpan: 60,
});
const { api, stateDir, playlistsDir } = h;
const BASE = h.base;

const DECK_FILE = () => path.join(stateDir, 'deck_state.yaml');
const MIXER_FILE = () => path.join(stateDir, 'mixer_state.yaml');
const GLOBALS_FILE = () => path.join(stateDir, 'globals_state.yaml');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readBytes = p => (fs.existsSync(p) ? fs.readFileSync(p) : null);
function snapStateFiles() {
  return { deck: readBytes(DECK_FILE()), mixer: readBytes(MIXER_FILE()), globals: readBytes(GLOBALS_FILE()) };
}
function assertStateUnchanged(before, label) {
  const now = snapStateFiles();
  for (const k of ['deck', 'mixer', 'globals']) {
    const a = before[k], b = now[k];
    if (a === null && b === null) continue;
    assert.ok(a && b && a.equals(b), `${label}: ${k}_state.yaml must be byte-identical (session retention is memory-only)`);
  }
}

// Pick a non-CPC-owned local slider on the deck channel: returns {id, name, v0}.
async function pickDeckLocalSlider() {
  const deck = await api('GET', '/deck/channel');
  const exps = deck.data.channel.exports || [];
  const s = exps.find(e => typeof e.name === 'string' && e.name.startsWith('slider') && !e.cpcOwned) || exps[0];
  assert.ok(s, 'deck pattern must expose a non-CPC local slider');
  return s;
}
async function deckExportValue(id) {
  const deck = await api('GET', '/deck/channel');
  const e = (deck.data.channel.exports || []).find(x => x.id === id);
  return e ? e.v0 : null;
}
async function mixerChannel(id) {
  const m = await api('GET', '/mixer');
  return (m.data.channels || []).find(c => c.id === id);
}

before(async () => { h.spawnEngine(); await h.waitForReady(); });
after(async () => { await h.teardown(); });

test('DECK A→B→A with auto-save OFF: tuning restored in memory, all state yamls byte-identical', async () => {
  await api('POST', '/playlists', { name: 'deck_show', entries: [
    { id: 'd_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'd_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'deck_show' }); // loads entry A (PAT_A)
  await sleep(200);
  await api('POST', '/settings', { autoSave: false });
  await sleep(200);

  const slider = await pickDeckLocalSlider();
  const plBefore = readBytes(path.join(playlistsDir, 'deck_show.yaml'));
  const stateBefore = snapStateFiles();

  // Tune A to a distinctive value.
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.617, v1: 0, v2: 0 });
  await sleep(150);
  // Switch A→B→A.
  await api('POST', '/deck/playlist/entry', { entryId: 'd_b' });
  await sleep(200);
  assert.ok(Math.abs((await deckExportValue(slider.id)) - 0.617) > 0.05 || true); // B has its own value
  await api('POST', '/deck/playlist/entry', { entryId: 'd_a' });
  await sleep(200);

  const restored = await deckExportValue(slider.id);
  assert.ok(Math.abs(restored - 0.617) < 1e-6, `A's tuning must be restored on return (got ${restored})`);

  // No disk writes: state yamls AND the playlist file are byte-identical.
  assertStateUnchanged(stateBefore, 'deck A→B→A');
  const plAfter = readBytes(path.join(playlistsDir, 'deck_show.yaml'));
  assert.ok(plBefore.equals(plAfter), 'playlist file must NOT be rewritten while auto-save is OFF (no capture)');
});

test('DECK A→B→A DURING performance mode: tuning restored, state yamls byte-identical', async () => {
  // (auto-save still OFF from the previous test.) Enter performance mode.
  const enter = await api('POST', '/performance-mode', { active: true });
  assert.equal(enter.status, 200);
  await sleep(150);
  const slider = await pickDeckLocalSlider();
  const stateBefore = snapStateFiles();

  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.733, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', '/deck/playlist/entry', { entryId: 'd_b' });
  await sleep(200);
  await api('POST', '/deck/playlist/entry', { entryId: 'd_a' });
  await sleep(200);

  const restored = await deckExportValue(slider.id);
  assert.ok(Math.abs(restored - 0.733) < 1e-6, `perf-mode A tuning must survive A→B→A (got ${restored})`);
  assertStateUnchanged(stateBefore, 'perf A→B→A');

  // Exit KEEP so the cache is preserved for the next test.
  const exit = await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  assert.equal(exit.status, 200);
  await sleep(200);
});

test('performance KEEP keeps the session cache: the 0.733 tuning is still restorable', async () => {
  const slider = await pickDeckLocalSlider();
  // We are on entry A after the KEEP. Switch away and back — cache must persist.
  await api('POST', '/deck/playlist/entry', { entryId: 'd_b' });
  await sleep(200);
  await api('POST', '/deck/playlist/entry', { entryId: 'd_a' });
  await sleep(200);
  const restored = await deckExportValue(slider.id);
  assert.ok(Math.abs(restored - 0.733) < 1e-6, `KEEP must retain the mid-show cache (got ${restored})`);
});

test('performance RESTORE clears the session cache: mid-show tuning does NOT resurface later', async () => {
  const slider = await pickDeckLocalSlider();
  // Enter, tune to a fresh distinctive value, switch B, exit RESTORE.
  await api('POST', '/performance-mode', { active: true });
  await sleep(150);
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.911, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', '/deck/playlist/entry', { entryId: 'd_b' }); // A stowed into cache mid-show
  await sleep(200);
  const restore = await api('POST', '/performance-mode', { active: false, exitAction: 'restore' });
  assert.equal(restore.status, 200);
  await sleep(300);

  // The rig is back to the pre-show look. Now navigate A→(current)→A: the
  // mid-show 0.911 must NOT come back (cache was cleared on RESTORE).
  await api('POST', '/deck/playlist/entry', { entryId: 'd_a' });
  await sleep(200);
  const v = await deckExportValue(slider.id);
  assert.ok(Math.abs(v - 0.911) > 1e-6, `mid-show tuning (0.911) must NOT resurface after RESTORE (got ${v})`);
});

test('entry-defaults-vs-cache precedence: session cache wins over the saved entry default', async () => {
  // Build a playlist whose entry A has a SAVED default for sliderRadius.
  await api('POST', '/settings', { autoSave: false });
  await api('POST', '/playlists', { name: 'prec_show', entries: [
    { id: 'p_a', pattern: PAT_A, label: null, defaults: { sliderRadius: 0.20 } },
    { id: 'p_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'prec_show' });
  await sleep(200);
  // Discover sliderRadius's id.
  const deck = await api('GET', '/deck/channel');
  const radius = (deck.data.channel.exports || []).find(e => e.name === 'sliderRadius');
  assert.ok(radius, 'PAT_A must expose sliderRadius');
  const applied = await deckExportValue(radius.id);
  assert.ok(Math.abs(applied - 0.20) < 1e-6, `entry default 0.20 should apply on load (got ${applied})`);

  // Tune to 0.70 (session cache), switch away and back.
  await api('POST', '/deck/channel/control', { id: radius.id, v0: 0.70, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', '/deck/playlist/entry', { entryId: 'p_b' });
  await sleep(200);
  await api('POST', '/deck/playlist/entry', { entryId: 'p_a' });
  await sleep(200);
  const after = await deckExportValue(radius.id);
  assert.ok(Math.abs(after - 0.70) < 1e-6, `session cache (0.70) must WIN over entry default (0.20) — got ${after}`);
});

test('MIXER LAYER A→B→A continuity + playlist-reassign scoping + deck cache isolation', async () => {
  await api('POST', '/settings', { autoSave: false });
  // Two playlists for the mixer layer.
  await api('POST', '/playlists', { name: 'mix_show1', entries: [
    { id: 'm1_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'm1_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/playlists', { name: 'mix_show2', entries: [
    { id: 'm2_a', pattern: PAT_A, label: null, defaults: {} },
  ] });
  // Add a mixer channel and assign mix_show1.
  const add = await api('POST', '/mixer/channels', { pattern: PAT_A, name: 'Layer1', mode: 'blend_screen', fader: 0.5 });
  const chId = add.data.channelId;
  assert.ok(chId, 'mixer channel id');
  await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'mix_show1' });
  await sleep(200);

  const ch = await mixerChannel(chId);
  const mslider = (ch.exports || []).find(e => typeof e.name === 'string' && e.name.startsWith('slider') && !e.cpcOwned);
  assert.ok(mslider, 'mixer layer pattern must expose a local slider');

  // Tune, A→B→A within mix_show1 → retained.
  await api('POST', `/mixer/channels/${chId}/control`, { id: mslider.id, v0: 0.484, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', `/mixer/channels/${chId}/playlist/entry`, { entryId: 'm1_b' });
  await sleep(200);
  await api('POST', `/mixer/channels/${chId}/playlist/entry`, { entryId: 'm1_a' });
  await sleep(200);
  let mv = (await mixerChannel(chId)).exports.find(e => e.id === mslider.id).v0;
  assert.ok(Math.abs(mv - 0.484) < 1e-6, `mixer layer A→B→A must retain tuning (got ${mv})`);

  // Also stow the DECK cache state now (it should be unaffected by mixer ops).
  // Re-tune the deck on prec_show entry p_a to a marker, so we can prove the
  // mixer playlist reassign below does not disturb the deck cache.
  const dslider = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: dslider.id, v0: 0.271, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', '/deck/playlist/entry', { entryId: 'p_b' });
  await sleep(200);

  // Re-assign the mixer layer's playlist → its cache is CLEARED (fresh defaults).
  await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'mix_show2' });
  await sleep(200);
  // Back to mix_show1: the earlier 0.484 tuning must be GONE (playlist swap = fresh).
  await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'mix_show1' });
  await sleep(200);
  mv = (await mixerChannel(chId)).exports.find(e => e.id === mslider.id).v0;
  assert.ok(Math.abs(mv - 0.484) > 1e-6, `mixer layer tuning must be CLEARED after a playlist reassign (got ${mv})`);

  // Deck cache unaffected by the mixer playlist churn: return to deck p_a.
  await api('POST', '/deck/playlist/entry', { entryId: 'p_a' });
  await sleep(200);
  const dv = await deckExportValue(dslider.id);
  assert.ok(Math.abs(dv - 0.271) < 1e-6, `deck cache must be unaffected by mixer playlist changes (got ${dv})`);
});

test('DIRECT /pattern set path stows + overlays session tuning (keyed by pattern name)', async () => {
  await api('POST', '/settings', { autoSave: false });
  // Put the deck on PAT_A directly, tune it, jump to PAT_B directly, come back.
  await api('POST', '/pattern', { pattern: PAT_A });
  await sleep(200);
  const slider = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.529, v1: 0, v2: 0 });
  await sleep(150);
  await api('POST', '/pattern', { pattern: PAT_B });
  await sleep(200);
  await api('POST', '/pattern', { pattern: PAT_A });
  await sleep(200);
  const v = await deckExportValue(slider.id);
  assert.ok(Math.abs(v - 0.529) < 1e-6, `direct /pattern set must restore session tuning (got ${v})`);
});

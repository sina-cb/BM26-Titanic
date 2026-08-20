// SPECIAL EVENTS — the WEDDING show (docs/52, show #2).
//
// The sibling of `show_schema.test.js`'s "shipped show" block, for
// `simulation/scenes/<scene>/special_events/wedding_program.yaml`. It lives in
// its own file because the wedding is entirely DATA: it adds no verb, no
// route and no UI, so everything that can break it is a YAML edit — and a YAML
// edit is exactly what nobody re-tests at 2 a.m.
//
// OPERATOR RULING: the wedding is a test_bench show ONLY (this task's S1 —
// docs/52, report `_326`+). titanic never carries `wedding_program.yaml` or
// any `wedding_*` playlist; the engine's `_assertPlaylistsUsable` /
// `isShowUsableHere` refuse loudly if a scene ever half-carries the show
// again, and the CaptainPad picker gates on `playlistsUsable` so the card
// never even offers a show a scene cannot ARM. This file pins that contract.
//
// What this file refuses to let drift:
//
//   1. THE ARM MUST NOT FAIL IN FRONT OF A WEDDING PARTY. The runner's
//      `_assertPlaylistsUsable` refuses to ARM when a referenced playlist is
//      absent or has no loadable entry. That check runs on the rig; this file
//      runs the same question offline, against test_bench (the only scene
//      that carries the show), so the answer is known before anybody is
//      standing at an altar — and it also pins that titanic carries NEITHER
//      the show file NOR any wedding playlist, so an accidental copy is
//      caught here instead of at 2 a.m.
//   2. THE FLASH MUST HIDE THE SWAP. THE KISS flashes every channel white and
//      swaps the deck UNDER the flash. If the ordering ever inverts, the crowd
//      watches the playlist change instead of a kiss. The timings are data, so
//      they are asserted as data.
//   3. NOTHING FLASHES DURING THE VOWS. The ceremony stage authors no quick
//      effects on purpose. A well-meaning "just add STROBE to every stage" edit
//      is a real thing that would happen.
//   4. THE SHOW MUST BE FULLY RESTORABLE. The special-event pre-show snapshot
//      (`captureLook()`) covers master + deck + overlays + groups — NOT the
//      shared ParamCenter bucket. So a `globals` write would survive FINISH and
//      leave the night retuned. The wedding therefore speaks only the three
//      snapshot-covered verbs, and this test pins that.
//   5. THE CALM STAGES MUST STAY CALM WHATEVER THE PALETTE IS. CEREMONY and
//      PHOTO GLOW lean on the WHITE ONLY family (60..64), which declares no
//      `colorPalette1` and therefore cannot be tinted by the live global
//      palette or the colour autopilot. That is the only reason those two
//      stages look right regardless of what the deck was doing before ARM.
//   6. EVERY PATTERN MUST LIGHT UP ON THE MODEL THE SHOW ACTUALLY SHIPS ON. A
//      wedding stage that renders black on the bench is a dark ship.
//   7. TITANIC MUST REFUSE THE WEDDING LOUDLY, NOT SILENTLY. Requesting a show
//      a scene does not carry must never hang, no-op, or produce a confusing
//      error — `arm()` throws `SHOW_NOT_FOUND`, naming both the show and the
//      scene, checked here directly against the runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import '../helpers/setup_config_guard.mjs';
import { SpecialEventsService } from '../../lib/special_events/special_events_service.js';
import {
  loadShow,
  loadShowLibrary,
  showPlaylistNames,
  summarizeShow,
  ACTION_TYPES,
} from '../../lib/special_events/show_schema.js';
import { GLOBAL_EFFECT_LIBRARY } from '../../lib/global_effect_library.js';
import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES_DIR = path.join(REPO_DIR, 'simulation', 'scenes');

const SHOW_ID = 'wedding_program';
/**
 * The ONLY scene that carries the wedding (operator ruling — see the header).
 * `OTHER_SCENE` is the negative space: everything the wedding must NOT touch.
 */
const SHOW_SCENE = 'test_bench';
const OTHER_SCENE = 'titanic';
/** Declaration order in the YAML is the operator's evening, in order. */
const STAGE_ORDER = ['gathering', 'procession', 'ceremony', 'kiss', 'celebration', 'photos'];
/** First-referenced order, which is what `showPlaylistNames` returns. */
const PLAYLISTS = [
  'wedding_gathering', 'wedding_procession', 'wedding_ceremony',
  'wedding_party', 'wedding_glow',
];

function showPath(scene) {
  return path.join(SCENES_DIR, scene, 'special_events', `${SHOW_ID}.yaml`);
}

function playlistPath(scene, name) {
  return path.join(SCENES_DIR, scene, 'playlists', `${name}.yaml`);
}

function readPlaylist(scene, name) {
  return yaml.load(fs.readFileSync(playlistPath(scene, name), 'utf8'));
}

const SHOW = loadShow(showPath(SHOW_SCENE));

/** Every action the show can possibly dispatch, flattened. */
function allActions(show) {
  const out = [];
  for (const stage of show.stages) {
    for (const action of stage.actions || []) out.push(action);
    for (const choice of stage.choices || []) out.push(...choice.actions);
    if (stage.extend && stage.extend.actions) out.push(...stage.extend.actions);
    for (const quick of stage.quickEffects) out.push(...quick.actions);
  }
  return out;
}

function stage(id) {
  const found = SHOW.stages.find((s) => s.id === id);
  assert.ok(found, `the wedding show has no '${id}' stage`);
  return found;
}

// ── the show file ───────────────────────────────────────────────────────────

test('the wedding show validates in test_bench, the only scene that carries it', () => {
  const file = showPath(SHOW_SCENE);
  assert.ok(fs.existsSync(file), `${SHOW_SCENE} is missing ${SHOW_ID}.yaml`);
  // Loading through the real loader is the point: a broken file here would
  // become a red card on the tab instead of an armable show.
  const show = loadShow(file);
  assert.equal(show.id, SHOW_ID);
  assert.deepEqual(show.stages.map((s) => s.id), STAGE_ORDER);
});

test('test_bench\'s special_events directory loads with zero errors and lists the wedding', () => {
  const { shows, errors } = loadShowLibrary(path.join(SCENES_DIR, SHOW_SCENE, 'special_events'));
  assert.deepEqual(errors, [], `${SHOW_SCENE} has broken show files: ${JSON.stringify(errors)}`);
  assert.ok(shows.some((s) => s.id === SHOW_ID), `${SHOW_SCENE} does not list ${SHOW_ID}`);
});

test('titanic carries NEITHER the wedding show file NOR any wedding playlist', () => {
  // The operator ruling in one file: this is what catches a future "also copy
  // it to titanic" edit before it ships. `_assertPlaylistsUsable` /
  // `isShowUsableHere` are the RUNTIME half of this refusal (see the fail-loud
  // test below and special_events_service.test.js); this is the static half.
  assert.ok(!fs.existsSync(showPath(OTHER_SCENE)),
    `${OTHER_SCENE} must not carry special_events/${SHOW_ID}.yaml — the wedding is test_bench-only`);

  const { shows, errors } = loadShowLibrary(path.join(SCENES_DIR, OTHER_SCENE, 'special_events'));
  assert.deepEqual(errors, [], `${OTHER_SCENE} has broken show files: ${JSON.stringify(errors)}`);
  assert.ok(!shows.some((s) => s.id === SHOW_ID),
    `${OTHER_SCENE} must not list ${SHOW_ID} among its special-event shows`);

  for (const name of PLAYLISTS) {
    assert.ok(!fs.existsSync(playlistPath(OTHER_SCENE, name)),
      `${OTHER_SCENE} must not carry playlist '${name}' — the wedding is test_bench-only`);
  }
});

test('the show names exactly the five wedding playlists, in evening order', () => {
  assert.deepEqual(showPlaylistNames(SHOW), PLAYLISTS);
});

test('the show speaks ONLY the verbs the pre-show snapshot can restore', () => {
  // `captureLook()` (api_server) records master + deck + overlays + mixGroups.
  // It does NOT record the shared ParamCenter bucket, so a `globals` write
  // would outlive FINISH. Until the runner's snapshot covers globals, the
  // wedding must not use it — and neither may a well-meaning retune.
  const used = new Set(allActions(SHOW).map((a) => a.type));
  assert.deepEqual([...used].sort(), ['effect', 'masterFade', 'playlist']);
  assert.ok(!used.has('globals'),
    'the wedding must not use `globals` — the pre-show snapshot cannot restore it');
  for (const type of used) {
    assert.ok(ACTION_TYPES.includes(type), `'${type}' is not a special-event verb`);
  }
});

test('every effect the show can pulse still exists in the global effect library', () => {
  for (const action of allActions(SHOW)) {
    if (action.type !== 'effect') continue;
    assert.ok(GLOBAL_EFFECT_LIBRARY[action.effectId],
      `'${action.effectId}' is no longer in GLOBAL_EFFECT_LIBRARY`);
  }
});

// ── the stages ──────────────────────────────────────────────────────────────

test('GATHERING and PROCESSION hold indefinitely and can be restarted', () => {
  for (const id of ['gathering', 'procession']) {
    const s = stage(id);
    assert.deepEqual(s.advance, { mode: 'manual', afterSec: null },
      `${id} must wait for a human — a wedding does not run on a countdown`);
    assert.ok(s.extend && s.extend.actions,
      `${id} must offer an action EXTEND (a manual stage cannot extend a countdown)`);
    assert.equal(s.extend.actions[0].playlist, `wedding_${id === 'gathering' ? 'gathering' : 'procession'}`);
  }
});

test('CEREMONY dims the surround with a master ramp, and authors NO quick effects', () => {
  const s = stage('ceremony');
  const fade = s.actions.find((a) => a.type === 'masterFade');
  assert.ok(fade, 'the ceremony must dim the surround');
  assert.ok(fade.target > 0 && fade.target < 1,
    `the ceremony dims, it does not black out (target ${fade.target})`);
  assert.ok(fade.durationMs >= 3000,
    `the dim must be a settle, not a snap (${fade.durationMs} ms)`);
  assert.equal(s.actions.find((a) => a.type === 'playlist').playlist, 'wedding_ceremony');
  assert.deepEqual(s.quickEffects, [],
    'there must be no button on this screen that can flash the ship during the vows');
});

test('THE KISS is the ceremonial choice, and the flash hides the swap', () => {
  const s = stage('kiss');
  assert.equal(s.kind, 'choice');
  assert.equal(s.ceremonial, true);
  assert.deepEqual(s.choices.map((c) => c.id), ['party', 'glow']);
  assert.deepEqual(s.quickEffects, [], 'the kiss IS the effect');

  for (const choice of s.choices) {
    const lift = choice.actions.find((a) => a.type === 'masterFade');
    const flash = choice.actions.find((a) => a.type === 'effect' && a.effectId === 'blastWhite');
    const playlist = choice.actions.find((a) => a.type === 'playlist');
    assert.ok(lift && lift.target === 1, `${choice.id}: the ceremony dim is never lifted`);
    assert.ok(flash, `${choice.id} has no white flash`);
    assert.ok(playlist, `${choice.id} activates no playlist`);
    assert.ok(flash.delayMs < playlist.delayMs,
      `${choice.id}: the flash must start BEFORE the playlist swap`);
    assert.ok(flash.delayMs + flash.holdMs > playlist.delayMs,
      `${choice.id}: the flash must still be up when the playlist lands, so the swap hides under it`);

    // THE SOFT EXIT (docs/57 §2, report `_240`). The flash blooms out over
    // 700 ms with the landing look rising through it, rather than cutting.
    assert.equal(flash.releaseMs, 700, `${choice.id}: the kiss flash must bloom out`);
    assert.equal(flash.releaseTo, 'show',
      `${choice.id}: 'dark' would decay to black over the look this moment exists to reveal`);

    // THE INVARIANT (docs/57 §2.5). The release starts at the END of the hold,
    // so it can only ever expose what the swap ALREADY replaced. Pin it here
    // rather than in the schema — a future show may legitimately flash and then
    // swap in the open; these two must not.
    assert.ok(playlist.delayMs <= flash.delayMs + flash.holdMs,
      `${choice.id}: the swap must land INSIDE the flash hold `
      + `(playlist ${playlist.delayMs} ms vs flash end ${flash.delayMs + flash.holdMs} ms) — `
      + 'otherwise the release would reveal the swap itself');
  }
  assert.equal(s.choices.find((c) => c.id === 'party').actions
    .find((a) => a.type === 'playlist').playlist, 'wedding_party');
  assert.equal(s.choices.find((c) => c.id === 'glow').actions
    .find((a) => a.type === 'playlist').playlist, 'wedding_glow');
});

test('no stage anywhere in the wedding offers FLASH ALL WHITE as a quick effect', () => {
  // docs/57 §3 — the removal is structural (the schema refuses it), and this is
  // the data half: not one chip on any stage, in either scene, can slam the
  // whole ship white. It stays legal as a STAGE action, which is THE KISS.
  for (const stg of SHOW.stages) {
    for (const q of stg.quickEffects) {
      for (const a of q.actions) {
        assert.notEqual(a.effectId, 'blastWhite',
          `stage "${stg.id}" chip "${q.id}" still carries the all-white slam`);
      }
    }
  }
  const kiss = stage('kiss');
  assert.ok(
    kiss.choices.every((c) => c.actions.some((a) => a.effectId === 'blastWhite')),
    'and it is still exactly where it belongs — on the ceremonial choice');
});

test('every quick-effect pulse in the wedding ends on a soft release', () => {
  // docs/57 §2.5 — a chip that snaps off reads as a glitch. Toggles carry a
  // releaseMs; the strobe burst carries its own fadeOutMs.
  let checked = 0;
  for (const stg of SHOW.stages) {
    for (const q of stg.quickEffects) {
      for (const a of q.actions) {
        if (a.type !== 'effect') continue;
        checked += 1;
        if (a.effectId === 'strobe') {
          assert.ok(a.fadeOutMs > 0, `${stg.id}/${q.id}: the strobe burst snaps off`);
        } else {
          assert.ok(a.releaseMs > 0, `${stg.id}/${q.id}: '${a.effectId}' snaps off`);
          assert.equal(a.releaseTo, 'show',
            `${stg.id}/${q.id}: a chip must never decay to black over the running show`);
        }
      }
    }
  }
  assert.ok(checked >= 5, `expected the wedding's quick effects to be checked, saw ${checked}`);
});

test('CELEBRATION starts the party whichever way the kiss landed, and carries the full quick set', () => {
  const s = stage('celebration');
  assert.equal(s.actions.find((a) => a.type === 'playlist').playlist, 'wedding_party');
  // The party's full chip set is now THREE (docs/57 §3, report `_240`):
  // `blast_white` left the operator surface for good — the all-white slam is
  // THE KISS's staged moment, and the schema refuses it inside quickEffects.
  assert.deepEqual(s.quickEffects.map((q) => q.id),
    ['strobe', 'vintage_white', 'uv_blast']);
});

test('PHOTO GLOW brings the house back to full and carries the FINISH affordance', () => {
  // `finishAvailable` in the tab is `currentStageId === last stage id`, so the
  // last stage IS the exit. Nothing else in the show may sit after it.
  const s = SHOW.stages[SHOW.stages.length - 1];
  assert.equal(s.id, 'photos');
  assert.equal(s.actions.find((a) => a.type === 'playlist').playlist, 'wedding_glow');
  const fade = s.actions.find((a) => a.type === 'masterFade');
  assert.ok(fade && fade.target === 1, 'the photo hold must guarantee a lit ship');
});

test('the summary the tab renders from carries no action internals', () => {
  // `durationMs` is deliberately NOT in this list: the stage summary carries
  // the AUTOPILOT transition config, which legitimately has one.
  const summary = JSON.stringify(summarizeShow(SHOW));
  for (const leak of ['blastWhite', 'masterFade', 'wedding_party', 'holdMs', 'effectId']) {
    assert.equal(summary.includes(leak), false, `the show summary leaks '${leak}'`);
  }
});

test('every holding stage rotates its playlist — and THE KISS deliberately does not', () => {
  const rotating = SHOW.stages.filter((s) => s.autopilot.active).map((s) => s.id);
  assert.deepEqual(rotating,
    ['gathering', 'procession', 'ceremony', 'celebration', 'photos']);
  assert.equal(stage('kiss').autopilot.active, false,
    'a ceremonial moment must never swap looks underneath itself');

  for (const id of rotating) {
    const ap = stage(id).autopilot;
    assert.equal(ap.active, true, `${id}: rotation is authored but parked`);
    assert.equal(ap.shuffle, false,
      `${id}: each wedding playlist is ordered as an arc — shuffling throws it away`);
    assert.ok(ap.everySec >= 20,
      `${id}: ${ap.everySec}s between looks is a nervous tic at a wedding`);
    assert.equal(ap.transition.enabled, true, `${id}: rotation must not hard-cut`);
  }
  // The two calm stages get the slowest rotations in the show.
  assert.ok(stage('ceremony').autopilot.everySec >= stage('celebration').autopilot.everySec * 2,
    'the ceremony must move far more slowly than the dance floor');
});

test('THE KISS swaps as a hard CUT, so the 900 ms flash actually hides it', () => {
  // The runner applies a stage's transition config BEFORE that stage's actions,
  // and a stage that authors no `autopilot:` block at all inherits whatever the
  // PREVIOUS stage left set — here, the ceremony's 5 s crossfade. Measured on
  // the bench: the party then takes ~5 s to dissolve in and the flash hides
  // nothing. The kiss therefore authors a parked block whose only real job is
  // `transition.enabled: false`.
  const kiss = stage('kiss');
  assert.equal(kiss.autopilot.supported, true,
    'the kiss must author an autopilot block — that is how it sets its transition');
  assert.equal(kiss.autopilot.transition.enabled, false,
    'the kiss must CUT, not crossfade: a dissolve would outlive the flash');
  const flash = kiss.choices[0].actions.find((a) => a.type === 'effect');
  const swap = kiss.choices[0].actions.find((a) => a.type === 'playlist');
  assert.ok(flash.holdMs > swap.delayMs,
    'the flash must outlast the swap it is hiding');
  // Every stage the kiss can hand off to re-establishes its own transition, so
  // the cut does not leak into the rest of the night.
  for (const id of ['celebration', 'photos']) {
    assert.equal(stage(id).autopilot.transition.enabled, true,
      `${id} must restore a soft transition after the kiss's cut`);
  }
});

// ── the playlists (the ARM contract, run offline) ────────────────────────────

test('every referenced playlist exists in test_bench and is loadable', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  const manifestIds = new Set(Array.isArray(manifest) ? manifest : manifest.patterns);

  for (const name of PLAYLISTS) {
    const file = playlistPath(SHOW_SCENE, name);
    assert.ok(fs.existsSync(file),
      `scene '${SHOW_SCENE}' has no '${name}' playlist — ARM would refuse by name`);

    const pl = readPlaylist(SHOW_SCENE, name);
    assert.equal(pl.schemaVersion, 1);
    assert.equal(pl.name, name, `${SHOW_SCENE}/${name}: the playlist's own name disagrees`);
    assert.ok(Array.isArray(pl.entries) && pl.entries.length > 0,
      `${SHOW_SCENE}/${name}: exists but has no entry — ARM would refuse`);

    const ids = new Set();
    for (const entry of pl.entries) {
      assert.ok(!ids.has(entry.id), `${SHOW_SCENE}/${name}: duplicate entry id '${entry.id}'`);
      ids.add(entry.id);
      const src = path.join(PATTERNS_DIR, `${entry.pattern}.js`);
      assert.ok(fs.existsSync(src),
        `${SHOW_SCENE}/${name}: entry '${entry.id}' points at missing pattern '${entry.pattern}'`);
      assert.ok(manifestIds.has(entry.pattern),
        `${SHOW_SCENE}/${name}: '${entry.pattern}' is not registered in patterns/manifest.json`);
    }
  }
});

test('CEREMONY and PHOTO GLOW lean on the palette-immune WHITE ONLY family', () => {
  // A pattern that declares `colorPalette1` can be tinted by the live global
  // palette and by the colour autopilot. The two calm stages must not depend
  // on what the deck happened to be doing before ARM, so a majority of each of
  // those playlists is drawn from the family that declares neither.
  for (const name of ['wedding_ceremony', 'wedding_glow']) {
    const entries = readPlaylist(SHOW_SCENE, name).entries;
    const immune = entries.filter((entry) => {
      const src = fs.readFileSync(path.join(PATTERNS_DIR, `${entry.pattern}.js`), 'utf8');
      return !src.includes('export function colorPalette1');
    });
    assert.ok(immune.length * 2 >= entries.length,
      `${name}: only ${immune.length}/${entries.length} entries are palette-immune — `
      + 'this stage would change character with the live palette');
  }
});

test('every wedding pattern compiles and renders lit on the model it legitimately covers', async () => {
  // The wedding is test_bench-only, so test_bench is the ONLY model this
  // suite owes a lit-render guarantee on. These same pattern files are also
  // used by titanic's OWN playlists (party_high/party_low/party_dancers, the
  // same confetti/spectrum/orbital family) and their titanic-render is
  // guarded there (patterns/party_dancers.test.js et al.) — this test is not
  // that suite's only backstop.
  const wanted = [];
  for (const name of PLAYLISTS) {
    for (const entry of readPlaylist(SHOW_SCENE, name).entries) {
      if (!wanted.includes(entry.pattern)) wanted.push(entry.pattern);
    }
  }
  assert.ok(wanted.length >= 20, `only ${wanted.length} distinct wedding patterns`);

  for (const modelName of [SHOW_SCENE]) {
    const loaded = await loadModelForGauge(modelName);
    const host = new WasmHost();
    await host.init(loaded.pixels.length);
    host.setCoords(loaded.pixels.map((p) => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
    host.setPixelMeta(loaded.metaArray);
    host.setFixtureConstants(loaded.fixtureConstants);
    const frame = new Uint8Array(loaded.pixels.length * 6);
    try {
      for (const id of wanted) {
        const src = fs.readFileSync(path.join(PATTERNS_DIR, `${id}.js`), 'utf8');
        const result = host.compile(src);
        assert.equal(result.ok, true, `${id} on ${modelName}: ${result.error}`);
        let peak = 0;
        for (const elapsed of [0, 0.7, 1.9, 3.3, 5.0]) {
          host.beginFrame(result.handle, elapsed);
          const out = host.renderAll6ch(result.handle, frame);
          for (let i = 0; i < out.length; i++) if (out[i] > peak) peak = out[i];
        }
        assert.ok(peak >= 8,
          `${id} on ${modelName}: renders black at its authored defaults (peak ${peak})`);
        host.destroy(result.handle);
      }
    } finally {
      host.shutdown();
    }
  }
});

// ── the fail-loud refusal (docs P0) ──────────────────────────────────────────

/** A full, inert dep set — ARM against 'wedding_program' on titanic fails
 *  before any of these would be called; they exist only to satisfy the
 *  constructor's REQUIRED_DEPS check. */
function inertDeps() {
  const noop = () => {};
  return {
    activatePlaylist: noop,
    listPlaylists: () => [],
    inspectPlaylist: () => ({ exists: false }),
    setDeckControl: noop,
    fadeMaster: noop,
    setMaster: noop,
    getMaster: () => 1,
    setGlobals: noop,
    captureGlobals: () => ({}),
    setEffect: noop,
    startStrobe: noop,
    fireStrobeBurst: noop,
    stopStrobe: noop,
    captureSnapshot: noop,
    recallSnapshotFade: noop,
    getAutopilotFlags: () => ({ patternAutopilot: false, colorAutopilot: null }),
    setPatternAutopilot: noop,
    setColorAutopilot: noop,
    getPatternAutopilot: () => ({ active: false, delay_s: 30, shuffle: false, nextSwapAtMs: null }),
    getDeckTransition: () => ({ enabled: false }),
    setDeckTransition: noop,
    getDeckNowPlaying: () => null,
  };
}

test('titanic refuses ARM of the wedding LOUDLY — named show, named scene, never silent', async (t) => {
  // The real runner, pointed at titanic's REAL special_events/ directory (no
  // fixture — an accidental future copy of wedding_program.yaml back into
  // titanic would make this library scan pick it up and this test would stop
  // proving what it claims to prove).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-titanic-wedding-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const svc = new SpecialEventsService({
    scene: OTHER_SCENE,
    showsDir: path.join(SCENES_DIR, OTHER_SCENE, 'special_events'),
    stateDir: path.join(dir, 'state'),
    deps: inertDeps(),
    broadcast: () => {},
  });
  svc.reloadLibrary();
  assert.ok(!svc.getShow(SHOW_ID), 'titanic must not carry the wedding show at all');

  await assert.rejects(
    () => svc.arm(SHOW_ID),
    (err) => {
      // Never silent (no resolve-with-nothing), never a generic 500, never a
      // hang — a specific, listed refusal naming BOTH the show and the scene.
      assert.equal(err.code, 'SHOW_NOT_FOUND');
      assert.equal(err.status, 404);
      assert.match(err.message, new RegExp(SHOW_ID));
      assert.match(err.message, new RegExp(OTHER_SCENE));
      return true;
    });
});

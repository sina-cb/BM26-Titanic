// SPECIAL EVENTS — the Baby Reveal choice dispatches BOTH halves of the answer
// (docs/73 §2, PALETTE CONTRACT v2, report `_306` + operator ruling
// 2026-08-17).
//
// The reveal used to answer the question by picking one of two playlists, each
// backed by its own duplicated set of hard-coded patterns. It now fires ONE
// playlist and writes the family as a colour, so the answer is carried by two
// actions that have to agree:
//
//   • a `globals` action writing colorPalette1 — THE answer, the colour the
//     patterns render and derive their own dark tone from — plus colorPalette2
//     (the mirrored dark tone, for other consumers) and colorTransitionMs: 0;
//   • a `playlist` action activating `baby_reveal`, pinned to the hero entry.
//
// If either half goes missing the show does not degrade gracefully: it runs the
// reveal on whatever colour happened to be loaded, which is how a blue reveal
// announces a girl. Under contract v1 the patterns black-holed a missing
// palette; under v2 they render one colour blind, so THE DISPATCH is now what
// has to refuse — hence the readback tests at the bottom of this file.
//
// This drives the runner's own action entry point against the SHIPPED show
// files — not a fixture — so an edit to the YAML that drops or reorders an
// action fails here. Fake deps throughout: no engine, no ports, no sockets.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import '../helpers/setup_config_guard.mjs';
import { SpecialEventsService } from '../../lib/special_events/special_events_service.js';
import { validateAction } from '../../lib/special_events/show_schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENES_DIR = path.resolve(HERE, '..', '..', '..', 'simulation', 'scenes');
const SCENES = ['titanic', 'test_bench'];

// The two families, as docs/73 §2.3 puts them on the wire.
const EXPECTED = {
  girl: { h: 0.943869, s: 0.965 },
  boy: { h: 0.594795, s: 0.967 },
};

/**
 * The pre-show ParamCenter, in the flat `{ key: value }` shape `captureGlobals`
 * returns. Seeded with a STALE palette (the live scene's persisted h 0.8, and
 * the deck wheel's default 800 ms slew) so a swallowed write reads back as the
 * WRONG COLOUR rather than as a missing param — the failure this guards.
 */
function preShowGlobals() {
  return {
    colorTransitionMs: 800,
    colorPalette1: { h: 0.8, s: 1.0, v: 1.0 },
    colorPalette2: { h: 0.8, s: 1.0, v: 1.0 },
    speed: 0.25,
  };
}

/**
 * @param {object}  [opts]
 * @param {'all'|string[]|null} [opts.swallow]
 *   Keys the fake ParamCenter DROPS: `setGlobals` records the call and returns
 *   without storing them. That is exactly what api_server's real dep does when
 *   ParamCenter refuses a write with `source_lock` (Live Touch armed) — it
 *   treats the refusal as runtime arbitration and continues WITHOUT ERROR.
 * @param {boolean} [opts.captureThrows] make `captureGlobals()` fail outright.
 */
function makeService({ swallow = null, captureThrows = false } = {}) {
  const calls = { setGlobals: [], activatePlaylist: [], setEffect: [], strobe: [], fadeMaster: [] };
  const noop = () => {};
  // A small STATEFUL fake ParamCenter: `setGlobals` stores what it accepts and
  // `captureGlobals` hands the store back, which is what the runner's write
  // verification (`_assertGlobalsLanded`) reads. A pure recorder would look
  // identical to a totally swallowed write, so the store is the point.
  const store = preShowGlobals();
  const dropped = (key) => swallow === 'all'
    || (Array.isArray(swallow) && swallow.includes(key));
  const deps = {
    activatePlaylist: (...args) => { calls.activatePlaylist.push(args); },
    listPlaylists: () => [],
    inspectPlaylist: () => ({ exists: true, entries: 10, loadable: 10, missingPatterns: [] }),
    setDeckControl: noop,
    fadeMaster: (...args) => calls.fadeMaster.push(args),
    setMaster: noop,
    getMaster: () => 1,
    setGlobals: (...args) => {
      calls.setGlobals.push(args);
      for (const [key, value] of Object.entries(args[0])) {
        if (dropped(key)) continue;
        store[key] = value;
      }
    },
    captureGlobals: () => {
      if (captureThrows) throw new Error('paramCenter not available');
      return { ...store };
    },
    setEffect: (...args) => calls.setEffect.push(args),
    startStrobe: noop,
    fireStrobeBurst: (...args) => calls.strobe.push(args),
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-reveal-'));
  const svc = new SpecialEventsService({
    scene: 'test_bench',
    showsDir: path.join(dir, 'shows'),
    stateDir: path.join(dir, 'state'),
    deps,
    broadcast: noop,
  });
  return { svc, calls, store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** The shipped reveal stage's two choices, actions validated as the loader would. */
function revealChoices(scene) {
  const file = path.join(SCENES_DIR, scene, 'special_events', 'baby_reveal.yaml');
  const show = yaml.load(fs.readFileSync(file, 'utf8'));
  const stage = show.stages.find((s) => s.id === 'reveal');
  assert.ok(stage, `${scene}: baby_reveal.yaml has no reveal stage`);
  const out = new Map();
  for (const choice of stage.choices) {
    out.set(choice.id, choice.actions.map((a, i) => validateAction(a, `${choice.id}[${i}]`)));
  }
  return out;
}

for (const scene of SCENES) {
  test(`${scene}: each reveal choice writes its palette AND activates the one playlist`, (t) => {
    const choices = revealChoices(scene);
    assert.deepEqual([...choices.keys()].sort(), ['boy', 'girl'],
      'the reveal stage is exactly two choices — the answer is binary');

    for (const [id, actions] of choices) {
      const { svc, calls, cleanup } = makeService();
      t.after(cleanup);
      for (const action of actions) svc._applyAction(action);

      // ── the palette half ──────────────────────────────────────────────
      assert.equal(calls.setGlobals.length, 1,
        `${id}: exactly one globals write — the palette IS the answer, and writing it twice `
        + 'would mean two sources of truth for which family is on the ship');
      const set = calls.setGlobals[0][0];
      const want = EXPECTED[id];
      // SLOT 1 IS THE ANSWER (contract v2). The patterns render this colour and
      // derive their own dark tone from it internally; nothing else decides the
      // family, so every property of this one value is load-bearing.
      assert.equal(set.colorPalette1.h, want.h, `${id}: wrong family hue in slot 1`);
      assert.equal(set.colorPalette1.s, want.s, `${id}: wrong saturation in slot 1`);
      assert.equal(set.colorPalette1.v, 1.0,
        `${id}: slot 1 carries the family PRIMARY and must be at full value — the patterns scale `
        + 'this down to reach their dark tone, so a dimmed slot 1 dims the whole reveal');
      // SLOT 2 is still written, at the same hue and the dark value — but the
      // reveal patterns DO NOT READ IT. It exists so the engine's global
      // palette PAIR mirrors the tone the ship is actually showing, for any
      // other consumer of the slots. It is not a handshake and nothing
      // validates it on the pattern side.
      assert.equal(set.colorPalette2.h, want.h,
        `${id}: slot 2 must mirror slot 1's hue — the pair describes ONE family's two tones, and a `
        + 'second colour there would make the global palette disagree with the ship');
      assert.ok(set.colorPalette2.v > 0 && set.colorPalette2.v < 0.5,
        `${id}: slot 2 mirrors the DARK tone, so it must be a genuinely darker shade of the same `
        + `hue (got v=${set.colorPalette2.v})`);
      assert.equal(set.colorTransitionMs, 0,
        `${id}: the palette must SNAP. The slots are slewed by default, and with no handshake `
        + 'blackout a slewed palette does not go black mid-ramp — it shows an INTERMEDIATE HUE '
        + 'crossing the wheel toward the answer, a wrong colour mid-ceremony (docs/73 §2.3)');

      // ...and it must never write the OTHER family, on ANY key of the set.
      const other = id === 'girl' ? EXPECTED.boy : EXPECTED.girl;
      for (const [key, value] of Object.entries(set)) {
        if (typeof value !== 'object' || value === null) continue;
        assert.notEqual(value.h, other.h,
          `${id}: ${key} carries the OTHER family's hue — this is the wrong-answer defect`);
      }

      // ── the playlist half ─────────────────────────────────────────────
      assert.equal(calls.activatePlaylist.length, 1, `${id}: exactly one playlist activation`);
      assert.deepEqual(calls.activatePlaylist[0], ['baby_reveal', 'e_baby_reveal_diamond_quilt'],
        `${id}: both answers now activate the SAME playlist, pinned to the hero entry. Two `
        + 'playlists is the duplication this wave removed.');
    }
  });

  test(`${scene}: the palette lands before the playlist, with the whole flash intact`, () => {
    for (const [id, actions] of revealChoices(scene)) {
      const globals = actions.find((a) => a.type === 'globals');
      const playlist = actions.find((a) => a.type === 'playlist');
      assert.ok(globals && playlist, `${id}: the reveal needs both halves`);
      assert.ok(globals.delayMs < playlist.delayMs,
        `${id}: the palette (t=${globals.delayMs}ms) must be written BEFORE the playlist loads `
        + `(t=${playlist.delayMs}ms), or the hero's first frames — the ones the white bloom `
        + 'exposes — render the PREVIOUS colour');
      assert.equal(globals.delayMs, 0, `${id}: the palette write is the first thing the answer does`);

      // The ceremony itself is untouched by this wave and must stay that way:
      // white release, master lift, the 2 s strobe, the blast that the playlist
      // rises through.
      const effects = actions.filter((a) => a.type === 'effect');
      assert.equal(effects.filter((a) => a.effectId === 'strobe').length, 1, `${id}: lost the strobe burst`);
      assert.equal(effects.filter((a) => a.effectId === 'blastWhite').length, 2,
        `${id}: the reveal is a white release plus a white blast — the bloom the answer rises through`);
      assert.ok(actions.some((a) => a.type === 'masterFade' && a.target === 1.0),
        `${id}: lost the master lift`);
    }
  });
}

test('the operator\'s pink<->blue correction re-issues the palette, not just the playlist', (t) => {
  // The correction control is the SAME button re-fired, so it replays the whole
  // action list. That is what makes the palette follow the corrected answer —
  // if a future edit ever moved the palette write out of the choice's actions
  // and into the stage's, a correction would swap the playlist and leave the
  // ship the wrong colour. Which is the wrong answer, loudly.
  const choices = revealChoices('titanic');
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  for (const action of choices.get('girl')) svc._applyAction(action);
  for (const action of choices.get('boy')) svc._applyAction(action);

  assert.equal(calls.setGlobals.length, 2, 'a correction must write the palette again');
  assert.equal(calls.setGlobals[0][0].colorPalette1.h, EXPECTED.girl.h);
  assert.equal(calls.setGlobals[1][0].colorPalette1.h, EXPECTED.boy.h,
    'after the correction the LAST palette write must be the corrected family');
  assert.equal(calls.activatePlaylist.length, 2);
  for (const call of calls.activatePlaylist) assert.equal(call[0], 'baby_reveal');
});

// ── THE DISPATCH VERIFICATION ───────────────────────────────────────────────
// Under contract v1 a swallowed palette write failed safe: the patterns saw no
// handshake and rendered black. Under v2 they render whatever colour is live,
// so a swallowed write is a WRONG-COLOUR reveal, and the refusal has to live in
// the dispatch path instead. `_applyAction` therefore reads the values back
// through `captureGlobals` and throws if any key it wrote is not live.
//
// The swallow is not hypothetical: api_server's `setGlobals` dep treats a
// ParamCenter `source_lock` refusal as runtime arbitration and CONTINUES
// WITHOUT ERROR, so Live Touch holding the lock drops the write silently.

/** The shipped `globals` action out of one reveal choice. */
function revealGlobalsAction(choiceId) {
  const action = revealChoices('titanic').get(choiceId).find((a) => a.type === 'globals');
  assert.ok(action, `${choiceId}: the reveal choice must carry a globals action`);
  return action;
}

test('a SWALLOWED globals write refuses the stage rather than run a stale colour', (t) => {
  const { svc, calls, cleanup } = makeService({ swallow: 'all' });
  t.after(cleanup);
  const action = revealGlobalsAction('girl');

  assert.throws(
    () => svc._applyAction(action, 'stage reveal'),
    (err) => {
      assert.match(err.message, /DID NOT LAND/,
        'the refusal must say plainly that the write did not take');
      assert.match(err.message, /'colorTransitionMs'|'colorPalette1'|'colorPalette2'/,
        'the refusal must NAME the offending key');
      assert.match(err.message, /source_lock/,
        'the refusal must point at the likely cause so the operator can act on it');
      return true;
    },
    'a dropped palette write must throw — there is no pattern-side blackout left to catch it');

  assert.equal(calls.setGlobals.length, 1,
    'the write WAS attempted and returned without error — it is the READBACK that refuses');
  assert.equal(svc._globalsWritten.size, 0,
    'a refused write must leave nothing for END SHOW to "restore"');
});

test('a PARTIALLY swallowed globals write refuses too, naming the key that was dropped', (t) => {
  // The nastiest shape: the cheap key lands and the ANSWER does not, so every
  // surface says the write happened while the ship shows the old colour.
  const { svc, cleanup } = makeService({ swallow: ['colorPalette1'] });
  t.after(cleanup);
  const action = revealGlobalsAction('boy');

  assert.throws(
    () => svc._applyAction(action, 'stage reveal'),
    (err) => {
      assert.match(err.message, /'colorPalette1'/,
        'the refusal must name the dropped key, not the ones that landed');
      assert.match(err.message, /0\.594795/, 'the refusal must report the value that was WRITTEN');
      assert.match(err.message, /0\.8/, 'the refusal must report the STALE value read back');
      return true;
    });
});

test('a globals write that LANDS does not throw, and is recorded for the END SHOW restore', (t) => {
  const { svc, store, cleanup } = makeService();
  t.after(cleanup);
  const action = revealGlobalsAction('girl');

  assert.doesNotThrow(() => svc._applyAction(action, 'stage reveal'),
    'a clean write must pass the readback untouched — the verification is a safety, not a tax');
  assert.deepEqual([...svc._globalsWritten].sort(),
    ['colorPalette1', 'colorPalette2', 'colorTransitionMs']);
  assert.deepEqual(store.colorPalette1, { h: EXPECTED.girl.h, s: EXPECTED.girl.s, v: 1.0 });
  assert.equal(store.colorTransitionMs, 0);
});

test('an unreadable ParamCenter refuses the stage — unverified is not verified', (t) => {
  const { svc, cleanup } = makeService({ captureThrows: true });
  t.after(cleanup);
  assert.throws(
    () => svc._applyAction(revealGlobalsAction('girl'), 'stage reveal'),
    /cannot be verified/,
    'if the readback itself fails the show must refuse, never assume the write took');
});

test('both scenes carry byte-identical reveal shows', () => {
  const [a, b] = SCENES.map((scene) =>
    fs.readFileSync(path.join(SCENES_DIR, scene, 'special_events', 'baby_reveal.yaml')));
  assert.ok(a.equals(b),
    'the answer must not depend on which rig is driving — both scenes carry the same show');
});

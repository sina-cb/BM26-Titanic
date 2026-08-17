// SPECIAL EVENTS — show schema (docs/52). Pure unit coverage of the LOUD
// REFUSAL surface: every one of these would otherwise be a 2 a.m. surprise.
//
// The schema is the only thing standing between an operator's YAML edit and a
// stage that silently does nothing, so each assertion below pins a specific
// refusal MESSAGE fragment, not just "it threw".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import '../helpers/setup_config_guard.mjs';
import {
  validateShow,
  validateAction,
  validateActionList,
  loadShow,
  loadShowLibrary,
  showPlaylistNames,
  summarizeShow,
  EVENT_EFFECT_IDS,
  MAX_STAGES,
  EFFECT_RELEASE_MS_MAX,
} from '../../lib/special_events/show_schema.js';
import { GLOBAL_EFFECT_LIBRARY } from '../../lib/global_effect_library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..');

/** A minimal show that validates, as the base for targeted mutations. */
function baseShow(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'demo',
    name: 'Demo',
    stages: [
      { id: 'one', label: 'ONE', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    ],
    ...overrides,
  };
}

function refusal(fn) {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  assert.fail('expected a throw, got none');
}

// ── show-level ──────────────────────────────────────────────────────────────

test('a minimal show validates and normalizes its optional fields', () => {
  const show = validateShow(baseShow());
  assert.equal(show.id, 'demo');
  assert.equal(show.color, null);
  assert.equal(show.icon, null);
  assert.equal(show.leaseDurationSec, null);
  assert.equal(show.stages.length, 1);
  assert.equal(show.stages[0].kind, 'action');
  assert.equal(show.stages[0].ceremonial, false);
  assert.deepEqual(show.stages[0].advance, { mode: 'manual', afterSec: null });
  assert.equal(show.stages[0].extend, null);
  assert.deepEqual(show.stages[0].quickEffects, []);
});

test('a wrong schemaVersion is refused by name', () => {
  const msg = refusal(() => validateShow(baseShow({ schemaVersion: 2 })));
  assert.match(msg, /schemaVersion must be 1/);
});

test('an unknown top-level key is refused rather than ignored', () => {
  const msg = refusal(() => validateShow(baseShow({ stagez: [] })));
  assert.match(msg, /unknown key 'stagez'/);
});

test('a non-slug id is refused', () => {
  assert.match(refusal(() => validateShow(baseShow({ id: 'Baby Reveal' }))), /show\.id must be a slug/);
});

test('a show id that disagrees with its file name is refused', () => {
  const msg = refusal(() => validateShow(baseShow({ id: 'demo' }), 'baby_reveal'));
  assert.match(msg, /does not match its file name 'baby_reveal\.yaml'/);
});

test('a malformed accent colour is refused, not silently dropped', () => {
  assert.match(refusal(() => validateShow(baseShow({ color: 'pink' }))), /must be a '#RRGGBB' hex colour/);
});

test('an absolute show lease is optional, whole, and bounded', () => {
  assert.equal(validateShow(baseShow({ leaseDurationSec: 1800 })).leaseDurationSec, 1800);
  assert.match(
    refusal(() => validateShow(baseShow({ leaseDurationSec: 59 }))),
    /leaseDurationSec must be a finite number in \[60, 21600\]/);
  assert.match(
    refusal(() => validateShow(baseShow({ leaseDurationSec: 1800.5 }))),
    /leaseDurationSec must be a whole number/);
});

test('an empty or over-long stage list is refused', () => {
  assert.match(refusal(() => validateShow(baseShow({ stages: [] }))), /stages must be a non-empty array/);
  const many = Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({
    id: `s${i}`, label: 'X', actions: [{ type: 'playlist', playlist: 'ambient' }],
  }));
  assert.match(refusal(() => validateShow(baseShow({ stages: many }))), /max 12/);
});

test('duplicate stage ids are refused', () => {
  const stages = [
    { id: 'one', label: 'A', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    { id: 'one', label: 'B', actions: [{ type: 'playlist', playlist: 'ambient' }] },
  ];
  assert.match(refusal(() => validateShow(baseShow({ stages }))), /'one' is duplicated/);
});

// ── stage-level ─────────────────────────────────────────────────────────────

test('a stage must define exactly one of actions | choices', () => {
  const neither = [{ id: 'one', label: 'A' }];
  assert.match(refusal(() => validateShow(baseShow({ stages: neither }))), /exactly one of 'actions'/);
  const both = [{
    id: 'one', label: 'A',
    actions: [{ type: 'playlist', playlist: 'ambient' }],
    choices: [],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: both }))), /exactly one of 'actions'/);
});

test('a CHOICE stage needs 2..4 variants, each with actions and a unique id', () => {
  const one = [{
    id: 'r', label: 'R',
    choices: [{ id: 'girl', label: 'G', actions: [{ type: 'playlist', playlist: 'ambient' }] }],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: one }))), /must hold 2\.\.4 variants/);

  const dupe = [{
    id: 'r', label: 'R',
    choices: [
      { id: 'girl', label: 'G', actions: [{ type: 'playlist', playlist: 'ambient' }] },
      { id: 'girl', label: 'B', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    ],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: dupe }))), /'girl' is duplicated/);

  const noActions = [{
    id: 'r', label: 'R',
    choices: [
      { id: 'girl', label: 'G' },
      { id: 'boy', label: 'B', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    ],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: noActions }))), /choices\[0\]\.actions/);
});

test('advance must be manual or a positive afterSec', () => {
  const bad = [{
    id: 'one', label: 'A', advance: { afterSec: 0 },
    actions: [{ type: 'playlist', playlist: 'ambient' }],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: bad }))), /afterSec must be a finite number/);

  const ok = validateShow(baseShow({
    stages: [{
      id: 'one', label: 'A', advance: { afterSec: 30 },
      actions: [{ type: 'playlist', playlist: 'ambient' }],
    }],
  }));
  assert.deepEqual(ok.stages[0].advance, { mode: 'timed', afterSec: 30 });
});

test('extend must be exactly one of addSec | actions, and addSec needs a countdown', () => {
  const both = [{
    id: 'one', label: 'A', advance: { afterSec: 30 },
    actions: [{ type: 'playlist', playlist: 'ambient' }],
    extend: { label: 'MORE', addSec: 30, actions: [{ type: 'playlist', playlist: 'ambient' }] },
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages: both }))), /exactly one of 'addSec'/);

  const addOnManual = [{
    id: 'one', label: 'A',
    actions: [{ type: 'playlist', playlist: 'ambient' }],
    extend: { label: 'MORE', addSec: 30 },
  }];
  assert.match(
    refusal(() => validateShow(baseShow({ stages: addOnManual }))),
    /extends a COUNTDOWN, but this stage advances manually/);
});

test('duplicate quick-effect ids inside one stage are refused', () => {
  const stages = [{
    id: 'one', label: 'A',
    actions: [{ type: 'playlist', playlist: 'ambient' }],
    quickEffects: [
      { id: 'strobe', label: 'S', actions: [{ type: 'effect', effectId: 'strobe', durationMs: 500 }] },
      { id: 'strobe', label: 'T', actions: [{ type: 'effect', effectId: 'strobe', durationMs: 500 }] },
    ],
  }];
  assert.match(refusal(() => validateShow(baseShow({ stages }))), /'strobe' is duplicated/);
});

// ── actions ─────────────────────────────────────────────────────────────────

test('an unknown verb is refused and lists the vocabulary', () => {
  const msg = refusal(() => validateAction({ type: 'scene', scene: 'titanic' }, 'a'));
  assert.match(msg, /a\.type must be one of playlist \| control \| masterFade \| globals \| effect/);
});

test("the removed 'pattern' verb refuses with the playlist replacement spelled out", () => {
  const msg = refusal(() => validateAction({ type: 'pattern', pattern: '13_sparkle' }, 'a'));
  assert.match(msg, /'pattern' is not a special-event verb/);
  assert.match(msg, /type: 'playlist'/);
});

test('an unknown key inside an action is refused (a typo must not vanish)', () => {
  const msg = refusal(() => validateAction({ type: 'playlist', playlist: 'a', entryid: 'x' }, 'a'));
  assert.match(msg, /unknown key 'entryid'/);
});

test('control needs exactly one of value | pulse', () => {
  assert.match(
    refusal(() => validateAction({ type: 'control', control: 'sliderX' }, 'a')),
    /exactly one of 'value'/);
  assert.match(
    refusal(() => validateAction({ type: 'control', control: 'sliderX', value: 1, pulse: true }, 'a')),
    /exactly one of 'value'/);
  const pulse = validateAction({ type: 'control', control: 'sliderX', pulse: true }, 'a');
  assert.equal(pulse.pulse, true);
  assert.equal(pulse.pulseMs, 120);
  const steady = validateAction({ type: 'control', control: 'sliderX', value: 0.25 }, 'a');
  assert.equal(steady.value, 0.25);
  assert.equal(steady.pulse, false);
});

test('masterFade bounds are enforced (this is the BLACKOUT verb)', () => {
  assert.match(
    refusal(() => validateAction({ type: 'masterFade', target: 1.5, durationMs: 100 }, 'a')),
    /target must be a finite number in \[0, 1\]/);
  assert.match(
    refusal(() => validateAction({ type: 'masterFade', target: 0, durationMs: 0 }, 'a')),
    /durationMs must be a finite number/);
  const ok = validateAction({ type: 'masterFade', target: 0, durationMs: 1500 }, 'a');
  assert.deepEqual(ok, { type: 'masterFade', delayMs: 0, target: 0, durationMs: 1500 });
});

test('globals must be a non-empty map of finite numbers', () => {
  assert.match(refusal(() => validateAction({ type: 'globals', set: {} }, 'a')), /non-empty object/);
  assert.match(
    refusal(() => validateAction({ type: 'globals', set: { speed: 'fast' } }, 'a')),
    /must be a finite number/);
});

test('an unknown effectId is refused and lists the allowed ones', () => {
  const msg = refusal(() => validateAction({ type: 'effect', effectId: 'fogger', holdMs: 100 }, 'a'));
  assert.match(msg, /effectId must be one of strobe \| vintageWhite \| blastWhite \| uvBlast \| invert/);
});

test('a toggle effect needs exactly one of holdMs | state, and holdMs is bounded', () => {
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'blastWhite' }, 'a')),
    /exactly one of 'holdMs'/);
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'blastWhite', holdMs: 99999 }, 'a')),
    /holdMs must be a finite number in \[1, 5000\]/);
  const pulse = validateAction({ type: 'effect', effectId: 'blastWhite', holdMs: 900 }, 'a');
  assert.equal(pulse.holdMs, 900);
  assert.equal(pulse.state, null);
});

test('a strobe burst is bounded to the controller cap and defaults its hz', () => {
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'strobe', durationMs: 5000 }, 'a')),
    /durationMs must be a finite number in \[1, 2000\]/);
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'strobe', hz: 40, durationMs: 500 }, 'a')),
    /hz must be a finite number in \[0\.2, 25\]/);
  const burst = validateAction({ type: 'effect', effectId: 'strobe', durationMs: 1200 }, 'a');
  assert.equal(burst.hz, 6);
  // holdMs/state belong to the toggle effects, not the burst.
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'strobe', durationMs: 500, holdMs: 100 }, 'a')),
    /unknown key 'holdMs'/);
});

test('a strobe toggle is explicit and mutually exclusive with burst timing', () => {
  const toggle = validateAction({ type: 'effect', effectId: 'strobe', hz: 6, toggle: true }, 'a');
  assert.deepEqual(toggle, {
    type: 'effect', delayMs: 0, effectId: 'strobe', hz: 6,
    toggle: true, durationMs: null, fadeOutMs: 0,
  });
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'strobe', toggle: true, durationMs: 500 }, 'a')),
    /toggle cannot also set durationMs/);
  assert.match(
    refusal(() => validateAction({ type: 'effect', effectId: 'strobe', toggle: false }, 'a')),
    /toggle must be true/);
});

// ── FLASH RELEASE (docs/57 §2.3, report `_240`) ─────────────────────────────

test('a strobe burst may author a fadeOutMs, defaulting to the historical snap-off', () => {
  assert.equal(
    validateAction({ type: 'effect', effectId: 'strobe', durationMs: 1200 }, 'a').fadeOutMs, 0,
    'default 0 — every show file written before this still means what it said');
  assert.equal(
    validateAction({ type: 'effect', effectId: 'strobe', durationMs: 1200, fadeOutMs: 400 }, 'a')
      .fadeOutMs, 400);
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'strobe', durationMs: 1200, fadeOutMs: 5001 }, 'a')),
    /fadeOutMs must be a finite number in \[0, 5000\]/);
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'strobe', durationMs: 1200, fadeOutMs: 400.5 }, 'a')),
    /fadeOutMs must be a whole number/);
  // The toggles' release fields are not the strobe's.
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'strobe', durationMs: 1200, releaseMs: 400 }, 'a')),
    /unknown key 'releaseMs'/);
});

test('a toggle effect defaults to the historical hard cut', () => {
  const pulse = validateAction({ type: 'effect', effectId: 'blastWhite', holdMs: 900 }, 'a');
  assert.equal(pulse.releaseMs, 0, 'no release unless asked for');
  assert.equal(pulse.releaseTo, 'show', 'and the default target is the live show');
});

test('releaseMs is bounded, whole, and legal on both the pulse and the unlatch', () => {
  const pulse = validateAction(
    { type: 'effect', effectId: 'blastWhite', holdMs: 900, releaseMs: 700, releaseTo: 'show' }, 'a');
  assert.equal(pulse.releaseMs, 700);
  assert.equal(pulse.releaseTo, 'show');

  const unlatch = validateAction(
    { type: 'effect', effectId: 'uvBlast', state: false, releaseMs: 800, releaseTo: 'dark' }, 'a');
  assert.equal(unlatch.releaseMs, 800);
  assert.equal(unlatch.releaseTo, 'dark');

  assert.equal(
    validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 10, releaseMs: EFFECT_RELEASE_MS_MAX }, 'a')
      .releaseMs, EFFECT_RELEASE_MS_MAX, 'the bound itself is legal');
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 10, releaseMs: 5001 }, 'a')),
    /releaseMs must be a finite number in \[0, 5000\]/);
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 10, releaseMs: -1 }, 'a')),
    /releaseMs must be a finite number in \[0, 5000\]/);
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 10, releaseMs: 700.5 }, 'a')),
    /releaseMs must be a whole number/);
});

test('a releaseTo with no release is REFUSED — a target with no mechanism', () => {
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 900, releaseTo: 'dark' }, 'a')),
    /releaseTo is set but releaseMs is 0/);
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', holdMs: 900, releaseMs: 700, releaseTo: 'black' }, 'a')),
    /releaseTo must be one of show \| dark/);
});

test('a release on a LATCH ON is REFUSED — a rising edge has no falling edge', () => {
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'blastWhite', state: true, releaseMs: 700 }, 'a')),
    /'state: true' AND a releaseMs/);
  // ...and turning it off later is exactly where the release belongs.
  assert.equal(
    validateAction({ type: 'effect', effectId: 'blastWhite', state: false, releaseMs: 700 }, 'a')
      .releaseMs, 700);
});

test('a release on an effect with no envelope is REFUSED', () => {
  // `invert` is a whole-frame filter — there is no boost to decay, so a
  // release on it would be a setting that silently does nothing.
  assert.match(
    refusal(() => validateAction(
      { type: 'effect', effectId: 'invert', holdMs: 400, releaseMs: 700 }, 'a')),
    /releaseMs is set on 'invert', which has no release envelope/);
  // The three slams that DO decay are all fine.
  for (const effectId of ['vintageWhite', 'blastWhite', 'uvBlast']) {
    assert.equal(
      validateAction({ type: 'effect', effectId, holdMs: 400, releaseMs: 700 }, 'a').releaseMs,
      700, `${effectId} must accept a release`);
  }
});

// ── FLASH ALL WHITE is not an operator chip (docs/57 §3) ────────────────────

test('a quickEffect carrying blastWhite is REFUSED, with the fix in the message', () => {
  const withChip = (actions) => baseShow({
    stages: [{
      id: 'one', label: 'ONE',
      actions: [{ type: 'playlist', playlist: 'ambient' }],
      quickEffects: [{ id: 'blast_white', label: 'FLASH ALL WHITE', actions }],
    }],
  });
  const msg = refusal(() => validateShow(
    withChip([{ type: 'effect', effectId: 'blastWhite', holdMs: 350 }])));
  assert.match(msg, /is not allowed as a QUICK EFFECT/);
  assert.match(msg, /staged moment, not a drummable chip/);
  assert.match(msg, /stage's `actions:`/, 'the refusal must say where it DOES belong');

  // It is refused wherever it hides in the list, and a release does not buy it
  // a way back in.
  assert.match(
    refusal(() => validateShow(withChip([
      { type: 'masterFade', target: 1.0, durationMs: 200 },
      { type: 'effect', effectId: 'blastWhite', holdMs: 350, releaseMs: 700 },
    ]))),
    /is not allowed as a QUICK EFFECT/);

  // Every OTHER effect is still a legal chip.
  for (const effectId of ['strobe', 'vintageWhite', 'uvBlast', 'invert']) {
    const action = effectId === 'strobe'
      ? { type: 'effect', effectId, durationMs: 600 }
      : { type: 'effect', effectId, holdMs: 400 };
    assert.doesNotThrow(() => validateShow(withChip([action])), `${effectId} must stay a legal chip`);
  }
});

test('blastWhite STAYS a legal stage and choice action', () => {
  // The removal is from the operator's chip row only — the reveal and THE KISS
  // are exactly what it is for.
  assert.doesNotThrow(() => validateShow(baseShow({
    stages: [{
      id: 'one', label: 'ONE',
      actions: [{ type: 'effect', effectId: 'blastWhite', holdMs: 900, releaseMs: 700 }],
    }],
  })));
  assert.ok(EVENT_EFFECT_IDS.includes('blastWhite'),
    'and it stays in the effect vocabulary — the schema refusal is scoped to quickEffects');
});

test('action delays are ABSOLUTE offsets and may never go backwards', () => {
  const msg = refusal(() => validateActionList([
    { type: 'effect', effectId: 'blastWhite', holdMs: 900, delayMs: 700 },
    { type: 'playlist', playlist: 'ambient' },
  ], 'set'));
  assert.match(msg, /goes BACKWARDS/);

  const ok = validateActionList([
    { type: 'masterFade', target: 1, durationMs: 200 },
    { type: 'effect', effectId: 'blastWhite', holdMs: 900 },
    { type: 'playlist', playlist: 'ambient', delayMs: 700 },
  ], 'set');
  assert.deepEqual(ok.map(a => a.delayMs), [0, 0, 700]);
});

test('every EVENT_EFFECT_ID still exists in the global effect library', () => {
  // A library rename must never leave show data pointing at a ghost.
  for (const id of EVENT_EFFECT_IDS) {
    assert.ok(GLOBAL_EFFECT_LIBRARY[id], `'${id}' is no longer in GLOBAL_EFFECT_LIBRARY`);
  }
});

// ── library scan ────────────────────────────────────────────────────────────

test('loadShowLibrary lists good shows AND reports each broken file by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-lib-'));
  fs.writeFileSync(path.join(dir, 'good.yaml'), yaml.dump(baseShow({ id: 'good' })), 'utf8');
  fs.writeFileSync(path.join(dir, 'torn.yaml'), 'stages: [ this is: not\n  valid yaml', 'utf8');
  fs.writeFileSync(path.join(dir, 'bad_verb.yaml'), yaml.dump(baseShow({
    id: 'bad_verb',
    stages: [{ id: 'one', label: 'A', actions: [{ type: 'nope' }] }],
  })), 'utf8');

  const { shows, errors } = loadShowLibrary(dir);
  assert.deepEqual(shows.map(s => s.id), ['good']);
  assert.deepEqual(errors.map(e => e.id).sort(), ['bad_verb', 'torn']);
  assert.match(errors.find(e => e.id === 'torn').error, /unparseable YAML|must be a YAML mapping/);
  assert.match(errors.find(e => e.id === 'bad_verb').error, /type must be one of/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing special_events directory is not an error — the scene just has no shows', () => {
  const { shows, errors } = loadShowLibrary(path.join(os.tmpdir(), 'se-does-not-exist-9c1f'));
  assert.deepEqual(shows, []);
  assert.deepEqual(errors, []);
});

// ── the shipped show ────────────────────────────────────────────────────────

test('the shipped titanic Baby Reveal show validates and has the operator flow', () => {
  const file = path.join(
    REPO_DIR, 'simulation', 'scenes', 'titanic', 'special_events', 'baby_reveal.yaml');
  const benchFile = path.join(
    REPO_DIR, 'simulation', 'scenes', 'test_bench', 'special_events', 'baby_reveal.yaml');
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(benchFile, 'utf8'),
    'Baby Reveal show YAML must stay byte-identical on Titanic and test bench');
  const show = loadShow(file);
  assert.equal(show.leaseDurationSec, 1800, 'Baby Reveal owns the rig for at most 30 minutes');
  assert.deepEqual(show.stages.map(s => s.id), ['tease', 'blackout', 'reveal']);

  // The three canonical playlists, and nothing else.
  assert.deepEqual(showPlaylistNames(show), ['baby_tease', 'baby_girl', 'baby_boy']);

  // The historically named BLACKOUT stage now holds a neutral full-rig white
  // source at the 10% master safety floor — never the e-stop blackout and
  // never pitch black show choreography.
  const blackout = show.stages[1];
  assert.equal(blackout.actions.length, 2);
  assert.deepEqual(
    blackout.actions.map(action => ({
      type: action.type,
      effectId: action.effectId,
      state: action.state,
      target: action.target,
    })),
    [
      { type: 'effect', effectId: 'blastWhite', state: true, target: undefined },
      { type: 'masterFade', effectId: undefined, state: undefined, target: 0.1 },
    ]);

  // REVEAL is a two-variant choice, and each variant flashes BEFORE its
  // playlist lands — the ordering is authored data, so assert it as data.
  const reveal = show.stages[2];
  assert.equal(reveal.kind, 'choice');
  assert.equal(reveal.ceremonial, true);
  assert.deepEqual(reveal.choices.map(c => c.id), ['girl', 'boy']);
  for (const choice of reveal.choices) {
    const flash = choice.actions.find(a => a.type === 'effect'
      && a.effectId === 'blastWhite' && Number.isFinite(a.holdMs));
    const playlist = choice.actions.find(a => a.type === 'playlist');
    assert.ok(flash, `${choice.id} has no white flash`);
    assert.ok(playlist, `${choice.id} activates no playlist`);
    assert.ok(flash.delayMs < playlist.delayMs,
      `${choice.id}: the flash must start BEFORE the playlist swap`);
    assert.ok(flash.delayMs + flash.holdMs >= playlist.delayMs,
      `${choice.id}: the flash must still be up when the playlist lands, so the swap hides under it`);

    // THE SOFT EXIT: the answer colour BLOOMS out of white through the full
    // 1 s playlist transition instead of exposing a half-landed swap.
    assert.equal(flash.releaseMs, 1000, `${choice.id}: the reveal flash must bloom out`);
    assert.equal(flash.releaseTo, 'show',
      `${choice.id}: 'dark' would decay to black over the answer colour`);

    // THE INVARIANT (docs/57 §2.5): the release starts where the hold ends, so
    // the swap must land INSIDE the hold — then the envelope can only ever
    // reveal the NEW look, never the moment it replaced the old one.
    assert.ok(playlist.delayMs <= flash.delayMs + flash.holdMs,
      `${choice.id}: the swap must land INSIDE the flash hold `
      + `(playlist ${playlist.delayMs} ms vs flash end ${flash.delayMs + flash.holdMs} ms)`);
    assert.ok(
      flash.delayMs + flash.holdMs + flash.releaseMs
        >= playlist.delayMs + reveal.autopilot.transition.durationMs,
      `${choice.id}: the white bloom must cover the complete answer transition`);
  }
  assert.equal(reveal.choices.find(c => c.id === 'girl').actions.find(a => a.type === 'playlist').playlist, 'baby_girl');
  assert.equal(reveal.choices.find(c => c.id === 'boy').actions.find(a => a.type === 'playlist').playlist, 'baby_boy');

  // REVEAL is the final holding stage. It shuffles whichever answer playlist
  // the operator chose until END SHOW; there is no redundant PHOTO GLOW hop.
  assert.equal(reveal.autopilot.supported, true);
  assert.equal(reveal.autopilot.active, true);
  assert.equal(reveal.autopilot.everySec, 15);
  assert.equal(reveal.autopilot.shuffle, true);
  assert.equal(reveal.autopilot.transition.enabled, true);
  assert.equal(reveal.autopilot.transition.durationMs, 1000);
  assert.equal(show.stages[0].autopilot.shuffle, true);
  assert.equal(show.stages[0].autopilot.active, true);
  assert.equal(show.stages[0].autopilot.everySec, 15);
  assert.equal(show.stages[0].autopilot.transition.durationMs, 1000);

  // The tease carries the operator's quick-effect palette — WITHOUT the
  // all-white slam (docs/57 §3, report `_240`). `blast_white` is a staged
  // moment, not a chip; the schema now refuses it inside quickEffects, so this
  // list is also what makes the show loadable at all.
  const quickIds = show.stages[0].quickEffects.map(q => q.id);
  assert.deepEqual(quickIds, ['strobe', 'vintage_white', 'uv_blast']);
  assert.equal(quickIds.includes('blast_white'), false,
    'FLASH ALL WHITE never comes back to the operator chip row');
  const strobe = show.stages[0].quickEffects.find(q => q.id === 'strobe').actions[0];
  assert.equal(strobe.toggle, true, 'the tease strobe is an operator ON/OFF toggle');

  // The summary the tab renders from carries no action internals.
  const summary = summarizeShow(show);
  assert.equal(summary.stages[2].choices.length, 2);
  assert.equal(summary.stages[0].extend.kind, 'actions');
  assert.equal(JSON.stringify(summary).includes('blastWhite'), false);
});

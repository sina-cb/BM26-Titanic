/**
 * bench_mirror_arm.test.js — the BENCH MIRROR runtime mode, v3
 * (reports 20260804_151, 20260804_152, 20260805_153, 20260805_155).
 *
 * Three tiers:
 *
 *  1. PURE — every ARM refusal and every auto-disarm reason, against
 *     `evaluateArmRequest` / `evaluateArmedHealth`, plus the HUD banner, the
 *     Controllers-header control and the picker. No socket, no sender.
 *
 *  2. IN-PROCESS BRIDGES — the REAL `server/sacn_bridge.js` AND the REAL
 *     `server/sacn_output_bridge.js`, both loaded with the `sacn` and `ws`
 *     packages replaced by fakes and `fetch` stubbed as the engine. The two
 *     processes talk to each other over a faked loopback WebSocket, so the
 *     bench-mirror GATE — the fix for the actual root cause of the first
 *     physical test's failure — is exercised end to end rather than mocked.
 *
 *     This is the only way to prove the properties that live in the wiring:
 *     that a fresh bridge is DISARMED, that ARM refuses without a gate ack, that
 *     arming makes the mirror the ONLY writer anywhere, that the ship is zeroed
 *     rather than frozen, that one composed frame goes out per ENGINE frame with
 *     no tearing, and that disarming gives everything back.
 *
 * ZERO PACKETS, ZERO PORTS. Nothing constructs a real `sacn` Sender or Receiver
 * and nothing binds a WebSocket port — the operator's live stack owns 6966–6972
 * and 5568. Every "send" lands in an array. Controller addresses used in
 * assertions are READ FROM the live scene data, so this file carries no address
 * literals of its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { bannerStateForStatus } from '../src/gui/bench_mirror_banner.js';
import { benchMirrorControlState } from '../src/gui/bench_mirror_control.js';
import { benchMirrorPickerState, pickerDefaults, pickerSetSource, pickerSetReverse }
  from '../src/gui/bench_mirror_picker.js';
// The fake-module H-A bridge harness (report 20260805_161 prerequisite):
// extracted from this very file so it stops being copy-pasted a third time.
// `SIM_ROOT`/`liveSidecar`/`liveResolution`/`LIVE_DESTS`/`GATEWAY`/`STRAND`/
// `ALL_SOURCES` are the exact values this file used to compute inline —
// re-computing them here would just be a second, redundant read of the same
// live scene data.
import { SIM_ROOT, liveSidecar, liveResolution, LIVE_DESTS, GATEWAY, STRAND,
  ALL_SOURCES, createBridgeHarness } from './helpers/bridge_harness.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseBenchMirrorSpec, evaluateArmRequest, evaluateClaimOverlap, evaluateArmedHealth,
  mirrorDestPairs } = require('../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry } = require('../lib/bench_mirror_resolve.cjs');
const { routeKey } = require('../lib/bridge_routing.cjs');
// The REAL vendored packet encoder, for the `_170` wire-truth proof below. The
// harness's `Module._load` patch matches the bare specifier `'sacn'` only, so
// this deep path resolves to the genuine package even under the fakes.
const { Packet } = require('sacn/dist/packet.js');

const LIVE_SPEC_PATH = path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml');

// ── Tier 1: pure ARM decisions ─────────────────────────────────────────────

const SPECS = [{ scene: 'test_bench', spec: liveSidecar }];
const ENGINE_OK = { reachable: true, scene: 'titanic', owned: new Set(), ownedUnavailable: false };
const ARM_ARGS = (over = {}) => ({
  scene: 'test_bench',
  specs: SPECS,
  specErrors: [],
  engineState: ENGINE_OK,
  activeArm: null,
  blackoutInFlight: false,
  otherClaims: [],
  relayRoutes: [],
  clientCount: 1,
  ...over,
});

test('_155: a valid request passes the state checks and reports the engine\'s scene as source', () => {
  const v = evaluateArmRequest(ARM_ARGS());
  assert.equal(v.ok, true);
  assert.equal(v.refusal, null);
  assert.equal(v.label, liveSidecar.label);
  assert.equal(v.sourceScene, 'titanic', 'the source scene is the ENGINE\'s, not a sidecar key');
});

test('_155 A1: the source scene follows the engine — any scene is a legal source', () => {
  // v2 refused unless the engine matched a `source_scene` key. v3 has no such
  // key: the mapping is computed against whatever the engine is running.
  const v = evaluateArmRequest(ARM_ARGS({
    engineState: { ...ENGINE_OK, scene: 'studio' },
  }));
  assert.equal(v.ok, true, v.refusal || '');
  assert.equal(v.sourceScene, 'studio');
});

test('_155 R-22a: a scene cannot stand in for itself', () => {
  const v = evaluateArmRequest(ARM_ARGS({
    engineState: { ...ENGINE_OK, scene: 'test_bench' },
  }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /which is the stand-in scene itself/);
  assert.match(v.refusal, /source and destination would be the same controllers/);
});

test('_155 R-6/R-7: an engine that cannot be reached, or reports no scene, refuses', () => {
  const unreachable = evaluateArmRequest(ARM_ARGS({
    engineState: { ...ENGINE_OK, reachable: false, scene: null },
  }));
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.refusal, /the engine is unreachable/);

  for (const scene of [null, '', undefined]) {
    const v = evaluateArmRequest(ARM_ARGS({ engineState: { ...ENGINE_OK, scene } }));
    assert.equal(v.ok, false);
    assert.match(v.refusal, /reports no active scene/);
  }
});

test('_151 R-2: ARM is refused when the sidecar does not parse — with the parse error', () => {
  const v = evaluateArmRequest(ARM_ARGS({
    specs: [],
    specErrors: [{ scene: 'test_bench', message: 'slots[0].slot: must be a snake_case id' }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /does not parse/);
  assert.match(v.refusal, /must be a snake_case id/);
});

test('_151 R-3: ARM is refused for a scene with no sidecar at all', () => {
  const v = evaluateArmRequest(ARM_ARGS({ scene: 'titanic' }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /declares no bench_mirror\.yaml/);
  assert.match(v.refusal, /test_bench/, 'the refusal must say which scenes DO');
});

test('_151 R-1: ARM is refused when the arm message names no scene — the bridge never guesses', () => {
  for (const scene of [null, undefined, '', '   ']) {
    const v = evaluateArmRequest(ARM_ARGS({ scene }));
    assert.equal(v.ok, false);
    assert.match(v.refusal, /no scene named/);
  }
});

test('_151 R-4: ARM is refused when the sidecar is enabled: false', () => {
  const off = parseBenchMirrorSpec(
    { ...yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8')), enabled: false }, 'off');
  const v = evaluateArmRequest(ARM_ARGS({ specs: [{ scene: 'test_bench', spec: off }] }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /'enabled: false'/);
});

test('_151 R-5: ARM is refused while already armed — a re-arm must go through the blackout', () => {
  const same = evaluateArmRequest(ARM_ARGS({ activeArm: { scene: 'test_bench' } }));
  assert.equal(same.ok, false);
  assert.match(same.refusal, /already armed for 'test_bench'/);
  const other = evaluateArmRequest(ARM_ARGS({ activeArm: { scene: 'other' } }));
  assert.equal(other.ok, false);
  assert.match(other.refusal, /already armed for 'other'/);
  assert.match(other.refusal, /DISARM it first/);
});

test('_152 D2: ARM is refused while a blackout is in flight — in EITHER direction', () => {
  // `activeArm` is ALREADY null during a disarm — the disarm clears it
  // synchronously — so the "already armed, disarm first" branch cannot catch
  // this. It is checked before everything else, so it holds whatever was named.
  const v = evaluateArmRequest(ARM_ARGS({ blackoutInFlight: true }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /blackout is still in flight/);
  assert.match(v.refusal, /Wait for the DISARMED line/);
  for (const scene of ['test_bench', 'titanic', null]) {
    assert.equal(evaluateArmRequest(ARM_ARGS({ blackoutInFlight: true, scene })).ok, false);
  }
  assert.equal(evaluateArmRequest(ARM_ARGS({ blackoutInFlight: false })).ok, true,
    'and it does not refuse when no blackout is running');
});

test('_151 R-8: ARM is refused when engine ownership is UNPROVABLE (no outputRouting)', () => {
  const v = evaluateArmRequest(ARM_ARGS({
    engineState: { ...ENGINE_OK, ownedUnavailable: true },
  }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /UNPROVABLE/);
  assert.match(v.refusal, /Restart the engine/);
});

test('_155 R-21: ANY engine-direct route refuses — "bench only" becomes unprovable', () => {
  // Strictly stronger than the old R-9/R-10 (which compared only the mirror's
  // OWN destinations). `_153` F4 proved address-keyed comparison cannot
  // establish BOARD identity, so any direct route at all is disqualifying.
  const owned = new Set([routeKey(10, '10.9.9.202'), routeKey(12, '10.9.9.202')]);
  const v = evaluateArmRequest(ARM_ARGS({ engineState: { ...ENGINE_OK, owned } }));
  assert.equal(v.ok, false);
  assert.match(v.refusal, /the ENGINE delivers/);
  assert.match(v.refusal, /10→10\.9\.9\.202/);
  assert.match(v.refusal, /bypassing the bridge/);
  assert.match(v.refusal, /remove the direct route declaration from the engine config/);
  // A route on a box the mirror does not touch AT ALL still refuses.
  const unrelated = evaluateArmRequest(ARM_ARGS({
    engineState: { ...ENGINE_OK, owned: new Set([routeKey(99, '10.9.9.250')]) },
  }));
  assert.equal(unrelated.ok, false);
  assert.match(unrelated.refusal, /99→10\.9\.9\.250/);
});

test('_158 D-158-4 / R-11: only a REAL intersection refuses, and it names only the collisions',
  () => {
    const mine = [{ universe: 2, ip: '10.9.9.10' }, { universe: 10, ip: '10.9.9.60' }];

    // DISJOINT — a different universe on a different host. The previous
    // implementation refused here and said "resolves onto the SAME
    // destination(s) U99 -> 10.9.9.99", which was simply untrue.
    assert.equal(evaluateClaimOverlap({
      scene: 'test_bench',
      destinations: mine,
      otherClaims: [{ scene: 'other_rig', pairs: [{ universe: 99, ip: '10.9.9.99' }] }],
    }), null, 'a disjoint claim is not a collision');

    // Same universe, DIFFERENT host — still disjoint as a (universe, host) pair,
    // which is the unit the one-writer law is stated in.
    assert.equal(evaluateClaimOverlap({
      scene: 'test_bench',
      destinations: mine,
      otherClaims: [{ scene: 'other_rig', pairs: [{ universe: 2, ip: '10.9.9.77' }] }],
    }), null);
    // Same host, different universe — also disjoint.
    assert.equal(evaluateClaimOverlap({
      scene: 'test_bench',
      destinations: mine,
      otherClaims: [{ scene: 'other_rig', pairs: [{ universe: 3, ip: '10.9.9.10' }] }],
    }), null);

    // A REAL collision, mixed in with two disjoint pairs: the refusal must name
    // the colliding pair and NOTHING else.
    const refusal = evaluateClaimOverlap({
      scene: 'test_bench',
      destinations: mine,
      otherClaims: [{ scene: 'other_rig', pairs: [
        { universe: 99, ip: '10.9.9.99' },
        { universe: 10, ip: '10.9.9.60' },
        { universe: 3, ip: '10.9.9.10' },
      ] }],
    });
    assert.ok(refusal, 'an overlapping pair must refuse');
    assert.match(refusal, /ARM refused \[R-11\]/);
    assert.match(refusal, /'other_rig'/);
    assert.match(refusal, /U10 → 10\.9\.9\.60/);
    assert.doesNotMatch(refusal, /U99/, 'a disjoint pair must not be named as a collision');
    assert.doesNotMatch(refusal, /U3 /, 'nor must a same-host different-universe pair');
    assert.match(refusal, /one sender and two payloads/);

    // A sidecar never collides with itself.
    assert.equal(evaluateClaimOverlap({
      scene: 'test_bench', destinations: mine,
      otherClaims: [{ scene: 'test_bench', pairs: mine }],
    }), null);
  });

test('_155 A2: the warnings say the SHIP goes dark, and how many routes stop', () => {
  const relayRoutes = [
    { universe: 2, ip: '10.9.9.10', scenes: ['titanic'] },
    { universe: 3, ip: '10.9.9.10', scenes: ['titanic'] },
    { universe: 30, ip: '10.9.9.60', scenes: ['titanic'] },
  ];
  const v = evaluateArmRequest(ARM_ARGS({ relayRoutes }));
  assert.equal(v.ok, true, v.refusal || '');
  const suspend = v.warnings.find(w => /ALL ordinary relay will be SUSPENDED/.test(w));
  assert.ok(suspend, 'the operator must be told the whole ship stops receiving data');
  assert.match(suspend, /3 route\(s\) across 2 controller\(s\)/);
  assert.match(suspend, /zeroed 3× on the way out/);
  assert.match(suspend, /goes DARK \(deliberately, not frozen\)/);
  assert.ok(v.warnings.some(w => /route read-back/.test(w)));
  assert.ok(v.warnings.some(w => /personality\/menu/.test(w)),
    'the one residual data cannot see must be named at ARM (_155 §5.6)');
});

test('_171: multi-window WARNS, and now says the extra windows are harmless', () => {
  const v = evaluateArmRequest(ARM_ARGS({ clientCount: 3 }));
  assert.equal(v.ok, true, 'arming with several windows open must proceed');
  const w = v.warnings.find(x => /3 sim windows are connected/.test(x));
  assert.ok(w);
  // The warning used to point at the gate, because each extra window was an
  // independent priority-150 writer. They cannot transmit at all now, so the
  // honest warning is "this costs GPU" — and it must still SAY what changed,
  // or an operator who remembers the old hazard will not believe it.
  assert.match(w, /cannot transmit to hardware at /);
  assert.match(w, /extra windows cost GPU and nothing else/);
  assert.match(w, /used to be independent priority-150 writers/);
  assert.doesNotMatch(w, /GATED|gate ack/);
});

// ── Tier 1b: auto-disarm health ───────────────────────────────────────────

const HEALTH = (over = {}) => ({
  scene: 'test_bench', sourceScene: 'titanic', specs: SPECS, specErrors: [],
  engineState: ENGINE_OK, ...over,
});

test('_151: a healthy arm reports no degrade', () => {
  assert.equal(evaluateArmedHealth(HEALTH()), null);
});

test('_151/_155: every degrade that must auto-disarm is named', () => {
  const cases = [
    [HEALTH({ engineState: { ...ENGINE_OK, scene: 'studio' } }), /engine left scene 'titanic'/],
    [HEALTH({ engineState: { ...ENGINE_OK, reachable: false } }), /engine became unreachable/],
    [HEALTH({ engineState: { ...ENGINE_OK, ownedUnavailable: true } }), /ownership became unprovable/],
    [HEALTH({ engineState: { ...ENGINE_OK, owned: new Set([routeKey(10, '10.9.9.202')]) } }),
      /engine took direct ownership of/],
    [HEALTH({ specs: [] }), /disappeared/],
    [HEALTH({ specs: [], specErrors: [{ scene: 'test_bench', message: 'boom' }] }),
      /stopped parsing: boom/],
  ];
  for (const [args, re] of cases) {
    const reason = evaluateArmedHealth(args);
    assert.ok(reason, `expected a degrade reason for ${re}`);
    assert.match(reason, re);
  }
});

test('_151: enabled: false on a live arm auto-disarms', () => {
  const off = parseBenchMirrorSpec(
    { ...yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8')), enabled: false }, 'off');
  assert.match(evaluateArmedHealth(HEALTH({ specs: [{ scene: 'test_bench', spec: off }] })),
    /switched to 'enabled: false'/);
});

// ── Tier 1c: the HUD banner, the header control and the picker ────────────

test('_151: the banner is hidden unless the bridge says ARMED', () => {
  for (const s of [null, undefined, { armed: false }, { armed: 'yes' }]) {
    assert.deepEqual(bannerStateForStatus(s), { show: false, text: '' });
  }
});

test('_155 A2: the armed banner leads with ALL SHIP OUTPUT SUSPENDED', () => {
  const state = bannerStateForStatus({
    armed: true,
    label: liveSidecar.label,
    scene: 'test_bench',
    sourceScene: 'titanic',
    destinations: LIVE_DESTS,
    selection: liveResolution.slots.map(s => ({ slot: s.slot, source: s.source })),
  });
  assert.equal(state.show, true);
  assert.match(state.text, /BENCH MIRROR ACTIVE — TEST BENCH STAND-IN ← titanic/);
  assert.match(state.text, /ALL SHIP OUTPUT SUSPENDED — BENCH ONLY/);
  assert.match(state.text, /10 slot\(s\) mapped, 0 dark/);
  assert.doesNotMatch(state.text, /REVERSED/,
    'an all-NORMAL arm says nothing about pixel order — the banner must stay readable');
  for (const d of LIVE_DESTS) {
    assert.ok(state.text.includes(`U${d.universe}→${d.ip}`),
      `the banner must name U${d.universe}→${d.ip}`);
  }
});

test('_176 §3.5: the armed banner NAMES the slots that are running end for end', () => {
  const state = bannerStateForStatus({
    armed: true,
    label: liveSidecar.label,
    scene: 'test_bench',
    sourceScene: 'titanic',
    destinations: LIVE_DESTS,
    selection: liveResolution.slots.map(s => ({
      slot: s.slot, source: s.source,
      reverse: s.slot === 'bar_left' || s.slot === 'bar_right',
    })),
  });
  assert.match(state.text, /⇄ REVERSED: bar_left, bar_right/,
    'a deliberately backwards bench looks exactly like an accidentally backwards one — the ' +
    'banner is where that distinction has to live');
  // A held-dark slot is never counted as reversed: there is nothing running.
  const dark = bannerStateForStatus({
    armed: true, label: liveSidecar.label, scene: 'test_bench', sourceScene: 'titanic',
    destinations: LIVE_DESTS,
    selection: [{ slot: 'bar_left', source: null, reverse: true }],
  });
  assert.doesNotMatch(dark.text, /REVERSED/);
});

test('_155 §8.2: all eight header-control states render their exact text', () => {
  // 1 — link down (distinct from "connected but not yet told").
  const down = benchMirrorControlState(null, { connected: false });
  assert.equal(down.statusText, '🪞 BENCH MIRROR: LINK DOWN');
  assert.equal(down.disabled, true);
  assert.equal(down.action, null);
  assert.match(down.noticeText, /no connection to the sACN bridge/);

  // 2 — no status yet.
  const unknown = benchMirrorControlState(null, { connected: true });
  assert.equal(unknown.statusText, '🪞 BENCH MIRROR: UNKNOWN');
  assert.equal(unknown.disabled, true);
  assert.match(unknown.noticeText, /has not reported its state/);
  assert.deepEqual(benchMirrorControlState(null).statusText, '🪞 BENCH MIRROR: UNKNOWN',
    'with no link info at all, unknown — never OFF');

  // 3 — off, exactly one armable sidecar.
  const one = benchMirrorControlState({
    armed: false, available: [{ scene: 'test_bench', label: liveSidecar.label, slots: 10 }],
  }, { connected: true });
  assert.equal(one.statusText, '🪞 BENCH MIRROR: OFF');
  assert.equal(one.disabled, false);
  assert.equal(one.action, 'arm');
  assert.equal(one.armScene, 'test_bench');
  assert.match(one.noticeText, /Test bench stand-in ready/);
  assert.match(one.title, /ONLY physical output/);

  // 4 — off, nothing armable.
  const none = benchMirrorControlState({ armed: false, available: [], specErrors: [] },
    { connected: true });
  assert.equal(none.disabled, true);
  assert.equal(none.noticeText, '✋ nothing armable');

  // 5 — off, more than one candidate: the bridge will not pick.
  const many = benchMirrorControlState({
    armed: false, available: [{ scene: 'a', label: 'A' }, { scene: 'b', label: 'B' }],
  }, { connected: true });
  assert.equal(many.disabled, true);
  assert.equal(many.noticeText, '✋ 2 candidates');
  assert.match(many.title, /will not pick one for you/);

  // 6 — off, the last ARM was refused: the refusal renders BESIDE the control.
  const refused = benchMirrorControlState({
    armed: false,
    refusal: 'ARM refused [R-23]: cannot prove the sim\'s physical output path is gated',
    available: [{ scene: 'test_bench', label: liveSidecar.label, slots: 10 }],
  }, { connected: true });
  assert.equal(refused.disabled, false, 'a refusal does not disable a control that could work');
  assert.match(refused.noticeText, /^✋ ARM refused \[R-23\]/);
  assert.match(refused.title, /Last refusal: ARM refused \[R-23\]/);

  // 7 — armed.
  const armed = benchMirrorControlState({
    armed: true, label: liveSidecar.label, destinations: LIVE_DESTS,
    selection: [{ slot: 'a', source: 'X' }, { slot: 'b', source: null }],
  }, { connected: true });
  assert.equal(armed.statusText, '🪞 BENCH MIRROR: ACTIVE — TEST BENCH STAND-IN');
  assert.equal(armed.buttonLabel, 'DISARM');
  assert.equal(armed.action, 'disarm');
  assert.equal(armed.disabled, false);
  assert.match(armed.noticeText, /SHIP OUTPUT SUSPENDED · 1 slot\(s\) mapped, 1 dark/);

  // 8 — a blackout in flight locks both gestures.
  for (const wasArmed of [true, false]) {
    const busy = benchMirrorControlState({ armed: wasArmed, blackoutInFlight: true },
      { connected: true });
    assert.equal(busy.statusText, '🪞 BENCH MIRROR: DISARMING…');
    assert.equal(busy.disabled, true);
    assert.equal(busy.action, null);
  }
});

test('_155 §8.5: no actionable ARM control remains in the sACN IN monitor', () => {
  const panel = fs.readFileSync(
    path.join(SIM_ROOT, 'src', 'gui', 'modern', 'sacn_monitor_panel.js'), 'utf8');
  assert.doesNotMatch(panel, /armBenchMirror|disarmBenchMirror/,
    'the monitor must not be able to arm or disarm — that placement was part of the defect');
  assert.doesNotMatch(panel, /runBenchMirrorAction/);
  assert.doesNotMatch(panel, /sacn-in-bench-mirror-btn/);
  assert.match(panel, /benchMirrorControlState\(st\.benchMirror, \{ connected:/,
    'it still renders the SAME pure state, read-only, so the two surfaces cannot disagree');
  // …and the control does live in the Controllers header.
  const shell = fs.readFileSync(
    path.join(SIM_ROOT, 'src', 'gui', 'modern', 'controller_map_panel.js'), 'utf8');
  assert.match(shell, /id="cm-bench-mirror-btn"/);
  assert.match(shell, /queryBenchMirrorOptions/);
  assert.match(shell, /armBenchMirror\(scene, state\.selection\)/,
    'the header must send the COMPLETE selection map');
});

/** The `benchMirrorOptions` payload shape, as the bridge now sends it. */
function pickerOptions() {
  return {
    ok: true, scene: 'test_bench', sourceScene: 'titanic', label: 'Test bench stand-in',
    warnings: [],
    slots: [
      { slot: 'par_1', benchFixture: 'Par 1', kind: 'dmx', fixtureType: 'UkingPar',
        footprintCh: 10, pixelCount: null, dest: { universe: 2, addr: 1 },
        defaultSource: 'Left Auditorium 5',
        storedSource: 'Left Auditorium 6', reverse: false, reverseApplicable: false,
        stored: { source: 'Left Auditorium 6', reverse: false }, staleReason: null,
        candidates: [
          { name: 'Left Auditorium 5', universe: 6, addr: 1, note: '' },
          { name: 'Left Auditorium 6', universe: 6, addr: 11, note: '' },
        ] },
      { slot: 'par_2', benchFixture: 'Par 2', kind: 'dmx', fixtureType: 'UkingPar',
        footprintCh: 10, pixelCount: null, dest: { universe: 2, addr: 11 },
        defaultSource: 'Left Auditorium 7',
        storedSource: null, reverse: false, reverseApplicable: false,
        stored: null, staleReason: null,
        candidates: [{ name: 'Left Auditorium 7', universe: 6, addr: 21, note: '' }] },
      { slot: 'bar_left', benchFixture: 'Bar Left', kind: 'dmx', fixtureType: 'ShehdsBar',
        footprintCh: 119, pixelCount: null, dest: { universe: 2, addr: 107 },
        defaultSource: 'Left Front Wall 1',
        storedSource: 'Left Front Wall 1', reverse: true, reverseApplicable: true,
        stored: { source: 'Left Front Wall 1', reverse: true }, staleReason: null,
        candidates: [{ name: 'Left Front Wall 1', universe: 6, addr: 1, note: '' }] },
      { slot: 'sign', benchFixture: 'TE Sign', kind: 'led_fixture', fixtureType: 'TeSignV3A40',
        footprintCh: 160, pixelCount: 40, dest: { universe: 38, addr: 1 },
        defaultSource: null,
        storedSource: null, reverse: false, reverseApplicable: true,
        stored: null, staleReason: null, candidates: [] },
    ],
  };
}

test('_176 §3.6: the picker pre-selects STORED > default and carries pixel order', () => {
  const options = pickerOptions();
  const s = benchMirrorPickerState(options, null);
  assert.equal(s.ok, true);
  assert.deepEqual(s.selection.par_1, { source: 'Left Auditorium 6', reverse: false },
    'the remembered source beats the sidecar default');
  assert.deepEqual(s.selection.par_2, { source: 'Left Auditorium 7', reverse: false },
    'the default applies when nothing is remembered');
  assert.deepEqual(s.selection.bar_left, { source: 'Left Front Wall 1', reverse: true },
    'a remembered REVERSED slot comes back REVERSED — that is the whole point of persisting');
  assert.deepEqual(s.selection.sign, { source: null, reverse: false },
    'a zero-candidate slot pre-selects nothing');
  assert.equal(s.rows[3].empty, true);
  assert.match(s.rows[3].emptyNote, /no compatible fixture in 'titanic'/);
  for (const row of s.rows) {
    assert.equal(row.choices[0].value, null, '`none` is always the first choice');
    assert.match(row.choices[0].label, /none \(held dark\)/);
  }
  assert.match(s.subtitle, /titanic → test_bench/);
  assert.match(s.confirmLabel, /3\/4 slots/);

  // The visible badge, on every applicable row, in both states.
  assert.equal(s.rows[2].reverseLabel, 'REVERSED');
  assert.equal(s.rows[3].reverseLabel, 'NORMAL');
  assert.equal(s.rows[0].reverseApplicable, false, 'a par row offers no toggle at all');
  assert.equal(s.rows[0].reverseLabel, '', 'and shows no order badge either');
  assert.match(s.rows[0].reverseTitle, /single pixel/);

  // A draft overrides the pre-selection, and duplicates are badged not refused.
  const dup = benchMirrorPickerState(options, {
    par_1: { source: 'Left Auditorium 7', reverse: false },
    par_2: { source: 'Left Auditorium 7', reverse: false },
    bar_left: { source: null, reverse: false },
    sign: { source: null, reverse: false },
  });
  assert.equal(dup.rows[0].duplicate, true);
  assert.equal(dup.rows[1].duplicate, true);
  assert.equal(dup.canConfirm, true, 'fan-out is legal — dest pairs stay disjoint');
});

test('_176 §3.6: pars can never be reversed, from any direction', () => {
  const options = pickerOptions();
  // 1 — a DRAFT that claims a par is reversed is dropped, not rendered.
  const drafted = benchMirrorPickerState(options, {
    par_1: { source: 'Left Auditorium 5', reverse: true },
    par_2: { source: null, reverse: false },
    bar_left: { source: null, reverse: false },
    sign: { source: null, reverse: false },
  });
  assert.equal(drafted.selection.par_1.reverse, false,
    'a non-applicable row cannot carry a reverse into the ARM message');
  // 2 — a STORED reverse on a par (a hand-edited state file) is likewise dropped.
  const stored = pickerOptions();
  stored.slots[0].reverse = true;
  assert.equal(benchMirrorPickerState(stored, null).selection.par_1.reverse, false);
  // 3 — the setter itself refuses to move a non-applicable row.
  const base = drafted.selection;
  assert.equal(pickerSetReverse(base, 'par_1', true, false), base,
    'pickerSetReverse is a no-op on a non-applicable row — same object back');
  const flipped = pickerSetReverse(base, 'bar_left', true, true);
  assert.deepEqual(flipped.bar_left, { source: null, reverse: true });
  assert.deepEqual(base.bar_left, { source: null, reverse: false }, 'and it is pure');
});

test('_176 §3.6: the setters keep the OTHER half of each entry', () => {
  const selection = {
    a: { source: 'X', reverse: true },
    b: { source: null, reverse: false },
  };
  assert.deepEqual(pickerSetSource(selection, 'a', 'Y'), {
    a: { source: 'Y', reverse: true }, b: { source: null, reverse: false },
  }, 'changing the source must not silently normalize the pixel order');
  assert.deepEqual(pickerSetSource(selection, 'a', '').a, { source: null, reverse: true },
    'the empty `<select>` value is the `none` choice');
  assert.deepEqual(pickerSetReverse(selection, 'a', false, true).a, { source: 'X', reverse: false },
    'flipping the order must not drop the source');
});

test('_176 §3.6: `↺ scene defaults` restores the sidecar defaults AND NORMAL', () => {
  const options = pickerOptions();
  assert.deepEqual(pickerDefaults(options), {
    par_1: { source: 'Left Auditorium 5', reverse: false },
    par_2: { source: 'Left Auditorium 7', reverse: false },
    bar_left: { source: 'Left Front Wall 1', reverse: false },
    sign: { source: null, reverse: false },
  });
  // It is a STAGING gesture: applied as a draft it survives a re-render, and the
  // remembered REVERSED on bar_left is gone from the selection that would arm.
  const s = benchMirrorPickerState(options, pickerDefaults(options));
  assert.equal(s.selection.bar_left.reverse, false);
  assert.equal(s.rows[2].reverseLabel, 'NORMAL');
});

test('_176 §3.3: a stale remembered entry is SHOWN, not applied', () => {
  const options = pickerOptions();
  options.slots[2].storedSource = null;
  options.slots[2].staleReason = "stored source 'Left Front Wall 9' no longer resolves against " +
    "'titanic' for this slot";
  options.slots[2].stored = { source: 'Left Front Wall 9', reverse: true };
  const s = benchMirrorPickerState(options, null);
  assert.deepEqual(s.selection.bar_left, { source: 'Left Front Wall 1', reverse: false },
    'nothing stale is applied: the row falls back to the sidecar default, NORMAL');
  assert.match(s.rows[2].staleNote, /remembered: Left Front Wall 9 · REVERSED/);
  assert.match(s.rows[2].staleNote, /no longer resolves/);
  // Payload-level warnings (an unknown slot id in the file) reach the operator.
  options.warnings = ["bench_mirror_state.yaml remembers a slot 'ghost' that … no longer declares"];
  assert.deepEqual(benchMirrorPickerState(options, null).warnings, options.warnings);
});

test('_155 §8.3: a refused options reply renders VERBATIM with no confirm button', () => {
  const s = benchMirrorPickerState({ ok: false, refusal: 'ARM refused [R-22b]: nothing fits' }, null);
  assert.equal(s.ok, false);
  assert.equal(s.canConfirm, false);
  assert.equal(s.refusal, 'ARM refused [R-22b]: nothing fits');
  assert.deepEqual(s.rows, []);
  const pending = benchMirrorPickerState(null, null);
  assert.equal(pending.canConfirm, false);
});

// ── Tier 2: the REAL bridges, with fake sockets — H-A harness ─────────────
// Extracted into tests/helpers/bridge_harness.mjs (report 20260805_161
// prerequisite) so G1/G3/G4/G10/G14 stop copy-pasting this setup. Every name
// destructured below is exactly the name this block used to declare locally —
// only the construction moved, nothing under test changed shape.
const H = createBridgeHarness();
const {
  sends, senders, events, wsServers, outputWss, inputWss, simPorts,
  FakeSender, FakeReceiver, FakeClient, FakeWebSocketServer, FakeWebSocketClient,
  isZeroPayload, tick, settle, waitFor, openSenders, sendsTo, pairEvents,
  advanceFrame, inbound, engineFrame, captureConsole, releaseConsole, logs,
  connect, request, armFrom, disarmFrom, optionsFrom, setObserver, disarmBroadcasts, waitForDisarm,
} = H;
const receiverRef = H.receiver;

let observer = connect();
setObserver(observer);

test('_151 bridge: a freshly constructed bridge is DISARMED and mirrors nothing', async () => {
  await settle();
  const first = connect();
  await settle();
  const status = first.json('benchMirrorStatus')[0];
  assert.ok(status, 'the status must be pushed to a newly connected client');
  assert.equal(status.armed, false, 'armed defaults OFF at every process start');
  assert.equal(status.blackoutInFlight, false);
  assert.equal(status.scene, null);
  assert.deepEqual(status.destinations, []);
  assert.deepEqual(status.selection, []);
  assert.deepEqual(status.available,
    [{ scene: 'test_bench', label: liveSidecar.label, slots: liveSidecar.slots.length }]);

  // The ordinary relay owns the pairs the mirror would take.
  const open = openSenders();
  for (const d of LIVE_DESTS) {
    assert.ok(open.includes(routeKey(d.universe, d.ip)) || d.universe !== GATEWAY.destUniverse,
      'the ordinary relay feeds the bench boxes while disarmed');
  }
  assert.ok(open.includes(routeKey(GATEWAY.destUniverse, GATEWAY.destHost)));
});

test('_155 §7.1: benchMirrorOptions returns every slot with its live candidates', async () => {
  const ws = connect();
  const options = await optionsFrom(ws);
  assert.equal(options.ok, true, options.refusal || '');
  assert.equal(options.sourceScene, 'titanic');
  assert.equal(options.slots.length, liveSidecar.slots.length);
  const byId = new Map(options.slots.map(s => [s.slot, s]));
  assert.equal(byId.get('par_1').defaultSource, 'Left Auditorium 5');
  assert.ok(byId.get('par_1').candidates.length >= 40);
  assert.equal(byId.get('par_1').storedSource, null,
    'a fresh scratch state root remembers nothing');
  assert.equal(byId.get('par_1').stored, null);
  assert.equal(byId.get('par_1').reverse, false);
  assert.equal(byId.get('par_1').reverseApplicable, false, 'a par is never reversible');
  assert.equal(byId.get('bar_left').reverseApplicable, true,
    'an 18-pixel bar is — that is what the toggle is for');
  assert.deepEqual(options.warnings, []);
  // The picker renders it without further help.
  const picker = benchMirrorPickerState(options, null);
  assert.equal(picker.ok, true);
  assert.equal(picker.rows.length, liveSidecar.slots.length);

  const noScene = await request(ws, { type: 'benchMirrorOptions' }, 'opt-none',
    'benchMirrorOptions');
  assert.equal(noScene.ok, false);
  assert.match(noScene.refusal, /no scene named/);
});

test('_151 bridge: a refused ARM changes nothing and composes nothing', async () => {
  const ws = connect();
  const before = openSenders().slice();
  sends.length = 0;
  const reply = await armFrom(ws, 'titanic');   // titanic declares no sidecar
  assert.equal(reply.armed, false);
  assert.match(reply.refusal, /declares no bench_mirror\.yaml/);
  assert.deepEqual(openSenders(), before, 'a refusal must not touch the route table');
  assert.equal(sends.length, 0, 'a refusal must put nothing on the wire by itself');

  // …and the relay is demonstrably still in charge — a live frame proves the
  // refusal changed nothing, where an empty `sends` array alone would hold
  // vacuously (report 20260804_152 §2.7).
  inbound(GATEWAY.destUniverse, { 1: 9 });
  await settle(3);
  const raw = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse);
  assert.ok(raw.length > 0, 'the ordinary relay still feeds the gateway pair after a refusal');
  assert.ok(raw.every(s => Object.keys(s.payload).length !== 512),
    'a refused ARM must not have started composing 512-channel frames');
});

// `_155 R-23` (ARM refuses without a gate ack) RETIRED by _171: the browser
// has no transmit path, so there is no stream to gate and no ack to demand.
// Replaced by the structural assertions in tests/browser_transmit_absence.test.js.

test('_155 A2 / _171: ARM zeroes the ship and makes the bench the ONLY output',
  async () => {
    const ws = connect();
    await settle();
    const relayBefore = openSenders().slice();
    assert.ok(relayBefore.length > 1, 'the ship has live relay routes before arming');
    sends.length = 0;
    events.length = 0;
    logs.length = 0;

    captureConsole();
    const reply = await armFrom(ws);
    releaseConsole();
    assert.equal(reply.armed, true, reply.refusal || '');
    assert.equal(reply.sourceScene, 'titanic');
    assert.deepEqual(reply.destinations, LIVE_DESTS);
    assert.equal(reply.selection.length, liveSidecar.slots.length);
    assert.ok(reply.selection.every(s => s.source), 'the defaults path maps every slot');

    // 1. The output bridge cannot reach a controller AT ALL now (_171), so the
    //    old "the gate ack came back" check is replaced by the stronger one:
    //    feed it the exact frame a stale browser bundle would send and prove
    //    nothing leaves. No gate is involved — it holds no sender.
    const outClient = outputWss.connect();
    const dmxFrame = Buffer.alloc(519);
    dmxFrame.writeUInt16LE(2, 0);
    const before = sends.length;
    outClient.emit('message', dmxFrame);
    await settle(3);
    assert.equal(sends.length, before,
      'a DMX frame reaching the output bridge must produce NO hardware send, ever');

    // 2. Every retired relay route got exactly 3 all-zero frames, and the zeros
    //    came BEFORE its sender closed.
    for (const key of relayBefore) {
      const [u, ip] = key.split('→');
      const ev = pairEvents(Number(u), ip);
      const zeros = ev.filter(e => e.kind === 'send' && e.zero).length;
      assert.equal(zeros, 3, `${key} must be zeroed 3× on ARM — dark, not frozen`);
      const lastZero = ev.map((e, i) => ({ e, i })).filter(x => x.e.kind === 'send' && x.e.zero)
        .map(x => x.i).pop();
      const closeIdx = ev.findIndex(e => e.kind === 'close');
      if (closeIdx !== -1) {
        assert.ok(closeIdx > lastZero, `${key}: the sender closed before its last zero landed`);
      }
    }
    assert.ok(logs.some(l => /SHIP GOING DARK/.test(l)));
    assert.ok(logs.some(l => /ALL ordinary relay SUSPENDED/.test(l)));

    // 3. The relay set is EMPTY and only the mirror's destinations have senders.
    const open = openSenders();
    for (const d of LIVE_DESTS) {
      assert.equal(open.filter(k => k === routeKey(d.universe, d.ip)).length, 1,
        `${routeKey(d.universe, d.ip)} must have exactly one writer`);
    }
    const destKeys = new Set(LIVE_DESTS.map(d => routeKey(d.universe, d.ip)));
    for (const key of open) {
      assert.ok(destKeys.has(key), `${key} survived the arm — the bench must be the ONLY output`);
    }

    // 4. Each slot's chosen source is in the arm log, by name.
    assert.ok(logs.some(l => /🪞   par_1 *← Left Auditorium 5/.test(l)));
    assert.ok(logs.some(l => /🪞   led_1 *← Left_Back_Left/.test(l)));
  });

test('_155 A4: composed frames carry the mirror\'s OWN 16-byte CID at a FIXED priority 100',
  async () => {
    sends.length = 0;
    engineFrame(200);
    await settle(6);
    const composed = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse);
    assert.ok(composed.length > 0);
    const expected = crypto.createHash('md5').update('bm26:bridge-mirror').digest();
    for (const s of composed) {
      assert.equal(s.priority, 100, 'the mirror emits at its own declared priority, never 150');
      assert.ok(Buffer.isBuffer(s.cid), 'every composed frame carries an explicit CID');
      assert.equal(s.cid.length, 16, 'a CID is EXACTLY 16 bytes — the package splices it unchecked');
      assert.ok(s.cid.equals(expected), 'and it is the mirror\'s own stable CID');
    }
    // The output bridge's senders carry no CID of their own, so the two are
    // distinguishable at the receiver — which is the whole point.
    const outSender = senders.find(s => s.defaultPacketOptions
      && s.defaultPacketOptions.sourceName === 'BM26-Simulation');
    if (outSender) {
      assert.notEqual(
        outSender.defaultPacketOptions.cid && outSender.defaultPacketOptions.cid.toString('hex'),
        expected.toString('hex'), 'the mirror CID must differ from the output bridge\'s');
    }
  });

test('_170 R-D1: EVERY DMX value 0..255 survives the composed mirror lane, byte for byte',
  async () => {
    // Lane C of the S-D1 proof (report 20260805_170): inbound wire bytes ->
    // `rawDmxPayload` -> `spliceMirrorFrame` -> `mirrorPayload` -> the mirror's
    // real sender options -> wire. Before the fix this lane lost twice: the
    // percent floats truncated into the compose `Uint8Array` (~100 levels,
    // `_153` F7) and then everything above 100 saturated on transmit (F1b).
    const mapped = GATEWAY.slices.flatMap(
      sl => Array.from({ length: sl.length }, (_, i) => sl.destAddr + i));
    assert.ok(mapped.length > 0, 'sanity: the gateway must map at least one channel');
    const wholeUniverse = (v) => {
      const p = {};
      for (let ch = 1; ch <= 512; ch += 1) p[ch] = v;
      return p;
    };
    const distortions = [];
    for (let v = 0; v <= 255; v += 1) {
      sends.length = 0;
      const seq = advanceFrame();
      for (const u of ALL_SOURCES) inbound(u, wholeUniverse(v), seq);
      await settle(4);
      const composed = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).pop();
      assert.ok(composed, `the gateway must emit a composed frame at value ${v}`);
      assert.equal(composed.useRawDmxValues, true,
        'the mirror sender must declare raw values on every frame');
      // Compose truth…
      for (const ch of mapped) {
        if (composed.payload[ch] !== v) {
          distortions.push({ v, ch, got: composed.payload[ch], leg: 'compose' });
        }
      }
      // …and wire truth, through the package's own encoder with the mirror's
      // real options (CID included, since it is spliced into the same frame).
      const slots = new Packet(new Packet({
        payload: composed.payload, universe: composed.universe, priority: composed.priority,
        sequence: 0, sourceName: 'MarsinRelay Engine',
        cid: composed.cid, useRawDmxValues: composed.useRawDmxValues,
      }).buffer).payloadAsBuffer;
      for (const ch of mapped) {
        if (slots[ch - 1] !== v) distortions.push({ v, ch, got: slots[ch - 1], leg: 'wire' });
      }
    }
    assert.deepEqual(distortions, [],
      'the ship byte and the bench byte must be the same number, for all 256 values');
  });

test('_151 bridge: while armed, raw frames never reach ANY controller', async () => {
  sends.length = 0;
  engineFrame(11);
  inbound(30, { 1: 33 });
  inbound(31, { 1: 44 });
  await settle(6);

  const destKeys = new Set(LIVE_DESTS.map(d => routeKey(d.universe, d.ip)));
  for (const s of sends) {
    assert.ok(destKeys.has(routeKey(s.universe, s.ip)),
      `U${s.universe} → ${s.ip} was written while armed — only bench destinations may be`);
    assert.equal(Object.keys(s.payload).length, 512,
      'a composed frame is always a full 512-channel frame, never the raw payload');
  }
});

// ── _153 §10: emission cadence — one composed frame per ENGINE frame ───────

test('_153 §10: exactly ONE composed send per destination per engine frame, under jitter',
  async () => {
    // The defect: the old flush coalesced over one libuv POLL PHASE, so a
    // destination composed from three source universes emitted 1-3 times per
    // engine frame depending on how the datagrams split — with 50-67 % of those
    // frames carrying a stale region. Deliver each source in its OWN poll phase,
    // which is the adversarial case.
    const sources = [...new Set(GATEWAY.slices.map(s => s.sourceUniverse))];
    assert.ok(sources.length >= 3, 'the gateway must be multi-source for this to bite');
    for (const frameNo of [1, 2, 3, 4, 5]) {
      sends.length = 0;
      const seq = advanceFrame();            // ONE engine frame, one sequence
      for (const u of sources) {
        inbound(u, { 1: frameNo, 2: frameNo, 120: frameNo }, seq);
        await tick();                        // force a separate poll phase
      }
      await settle(4);
      const composed = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse);
      assert.equal(composed.length, 1,
        `engine frame ${frameNo}: expected exactly 1 composed send, got ${composed.length} — ` +
        'more than one means the destination was emitted before all its sources arrived');
    }
  });

test('_153 §10: no composed frame is emitted until EVERY source has arrived (no tearing)',
  async () => {
    const sources = [...new Set(GATEWAY.slices.map(s => s.sourceUniverse))];
    sends.length = 0;
    // Feed all but one source, repeatedly. Nothing may go out.
    for (let i = 0; i < 4; i += 1) {
      const seq = advanceFrame();
      for (const u of sources.slice(0, -1)) inbound(u, { 1: 99 }, seq);
      await settle(3);
    }
    assert.equal(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length, 0,
      'a partial engine frame must NOT be emitted — that is the tearing this rule prevents');

    // Feeding ONLY the missing source now would complete the gather on paper,
    // but its regions would be four engine frames older than the rest — the
    // sequence rule (D-158-3) correctly refuses that too. Recovery is a WHOLE
    // fresh frame, and then exactly one send.
    inbound(sources[sources.length - 1], { 1: 99 });
    await settle(4);
    assert.equal(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length, 0,
      'a source arriving with a NEWER sequence than its siblings does not make a whole frame');

    // Recovery costs at most one engine frame: the gather that detects the
    // mismatch is discarded and rebased, and the next whole one is emitted.
    sends.length = 0;
    for (const gen of [98, 99, 100]) { engineFrame(gen); await settle(4); }
    const resumed = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse);
    assert.ok(resumed.length >= 2,
      `emission must resume within one frame of a rebase — got ${resumed.length} of 3`);
    assert.ok(resumed.every(f => Object.keys(f.payload).length === 512));
  });

test('_153 §10: a SINGLE-source destination still emits once per frame (the LEDs never flickered)',
  async () => {
    sends.length = 0;
    for (let i = 0; i < 3; i += 1) {
      inbound(STRAND.slices[0].sourceUniverse, { 1: i + 1 });
      await settle(3);
    }
    assert.equal(sendsTo(STRAND.destHost, STRAND.destUniverse).length, 3,
      'one source, one send per frame — structurally immune, then and now');
  });

test('_153 §10: a STALLED source is reported by name, never papered over with a half frame',
  async () => {
    const sources = [...new Set(GATEWAY.slices.map(s => s.sourceUniverse))];
    const missing = sources[sources.length - 1];
    sends.length = 0;
    logs.length = 0;
    captureConsole();
    try {
      // Keep the other sources arriving past the 250 ms watchdog window.
      const start = Date.now();
      while (Date.now() - start < 400) {
        const seq = advanceFrame();
        for (const u of sources.slice(0, -1)) inbound(u, { 1: 5 }, seq);
        await new Promise((r) => setTimeout(r, 20));
      }
      await settle(4);
    } finally {
      releaseConsole();
    }
    assert.equal(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length, 0,
      'a stalled source stops emission — it does not produce a stale-region frame');
    // Either shape is correct and both name the culprit: "source stalled" when
    // that universe has never arrived for this destination, "frame NOT WHOLE"
    // when it HAS arrived before and is now lagging behind its siblings. The
    // second is the one a mid-session stall produces, and it is the louder of
    // the two (immediate, not after a settling window).
    const stall = logs.find(l => /BENCH MIRROR source stalled|BENCH MIRROR frame NOT WHOLE/.test(l));
    assert.ok(stall, 'the stall must be shouted');
    assert.match(stall, new RegExp(`U${missing}`), 'and must NAME the lagging universe');
    assert.match(stall, /NOT being sent|was NOT sent/);
    // Recovery: the next WHOLE engine frame resumes emission. (Feeding only the
    // missing source would leave its region on a NEWER sequence than the rest —
    // still not one frame, which is D-158-3.)
    sends.length = 0;
    for (const gen of [5, 6, 7]) { engineFrame(gen); await settle(4); }
    assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length >= 2,
      'emission resumes once the stalled source is delivering whole frames again');
  });

test('_151 bridge: the status is broadcast to a tab that connects AFTER the arm', async () => {
  const late = connect();
  await settle();
  const status = late.json('benchMirrorStatus')[0];
  assert.ok(status, 'a reloaded tab must be told the arm state on connect');
  assert.equal(status.armed, true);
  assert.equal(status.label, liveSidecar.label);
  assert.deepEqual(status.destinations, LIVE_DESTS);
  assert.equal(status.selection.length, liveSidecar.slots.length);
  assert.equal(bannerStateForStatus(status).show, true,
    'and that status must drive the banner in the reloaded tab');
  assert.equal(benchMirrorControlState(status, { connected: true }).action, 'disarm');
});

test('_155: DISARM blacks out the bench and restores the FULL relay', async () => {
  sends.length = 0;
  logs.length = 0;
  assert.ok(H.armedSocket, 'the arming socket is known');
  captureConsole();
  const reply = await disarmFrom(H.armedSocket);
  releaseConsole();
  assert.equal(reply.armed, false);

  for (const d of LIVE_DESTS) {
    const zero = sends.filter(s => s.ip === d.ip && s.universe === d.universe
      && Object.values(s.payload).every(v => v === 0));
    assert.equal(zero.length, 3,
      `U${d.universe} → ${d.ip} must receive exactly 3 all-zero frames on disarm`);
    assert.equal(Object.keys(zero[0].payload).length, 512, 'a full blackout frame');
  }

  await settle(6);
  // The FULL relay set is back — not just the mirrored pairs.
  const open = openSenders();
  assert.ok(open.includes(routeKey(GATEWAY.destUniverse, GATEWAY.destHost)));
  assert.ok(open.length > LIVE_DESTS.length,
    'every suspended ship route must be relayed again, not only the bench ones');
  assert.ok(logs.some(l => /BENCH MIRROR DISARMED/.test(l)));
});

test('_176 §3.2: the ARM wrote the selection to disk, and the picker reads it back', async () => {
  // The previous test armed with the sidecar DEFAULTS and then disarmed. The
  // file must now hold exactly that, keyed by the SOURCE scene, and the picker
  // must offer it back — this is the whole of `_176`'s reversal of `_155` §10,
  // end to end through the real bridge.
  const stateFile = path.join(H.benchStateRoot, 'test_bench', 'bench_mirror_state.yaml');
  assert.ok(fs.existsSync(stateFile),
    'a successful ARM writes the remembered selection; a refused one never does');
  const onDisk = yaml.load(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(onDisk.state_version, 1);
  assert.deepEqual(Object.keys(onDisk.selections), ['titanic'],
    'selections are keyed by the SOURCE scene — that is what stops one scene leaking into another');
  assert.deepEqual(onDisk.selections.titanic.slots.par_1,
    { source: 'Left Auditorium 5', reverse: false });
  assert.equal(Object.keys(onDisk.selections.titanic.slots).length, liveSidecar.slots.length,
    'every slot is written explicitly — absence is not a choice here either');
  // NOTHING in the file can arm anything.
  const text = fs.readFileSync(stateFile, 'utf8');
  for (const forbidden of ['armed', 'enabled', 'universe', 'dmxAddress', 'controllerIp']) {
    assert.doesNotMatch(text, new RegExp(`^\\s*${forbidden}\\s*:`, 'm'),
      `a state file must not be able to carry '${forbidden}'`);
  }

  const ws = connect();
  const options = await optionsFrom(ws);
  assert.equal(options.ok, true, options.refusal || '');
  const par1 = options.slots.find(s => s.slot === 'par_1');
  assert.equal(par1.storedSource, 'Left Auditorium 5',
    'the previous arm\'s choice is offered back — now from disk, validated against this scene');
  assert.deepEqual(par1.stored, { source: 'Left Auditorium 5', reverse: false });
  assert.equal(par1.staleReason, null);
});

test('_176 §3.2: a selection remembered for one SOURCE scene never surfaces under another',
  async () => {
    const stateFile = path.join(H.benchStateRoot, 'test_bench', 'bench_mirror_state.yaml');
    const before = fs.readFileSync(stateFile, 'utf8');
    // Hand-plant a selection for a DIFFERENT source scene, then ask the picker
    // while the engine is on `titanic`.
    const tree = yaml.load(before);
    tree.selections.some_other_ship = { slots: { par_1: { source: 'Nope 1', reverse: true } } };
    fs.writeFileSync(stateFile, yaml.dump(tree), 'utf8');
    try {
      const ws = connect();
      const options = await optionsFrom(ws);
      const par1 = options.slots.find(s => s.slot === 'par_1');
      assert.equal(par1.storedSource, 'Left Auditorium 5',
        "the titanic entry is what a titanic session sees");
      assert.deepEqual(par1.stored, { source: 'Left Auditorium 5', reverse: false },
        'the other scene\'s entry is structurally unreachable — it is under a different key');
      assert.deepEqual(options.warnings, [],
        'and it is not even a warning: a selection for another scene is simply not this session');
    } finally {
      fs.writeFileSync(stateFile, before, 'utf8');
    }
  });

test('_176 §3.3: a stale stored source is reported by name and pre-fills NOTHING', async () => {
  const stateFile = path.join(H.benchStateRoot, 'test_bench', 'bench_mirror_state.yaml');
  const before = fs.readFileSync(stateFile, 'utf8');
  const tree = yaml.load(before);
  tree.selections.titanic.slots.par_1 = { source: 'Left Auditorium 999', reverse: false };
  tree.selections.titanic.slots.ghost_slot = { source: 'Left Auditorium 5', reverse: false };
  fs.writeFileSync(stateFile, yaml.dump(tree), 'utf8');
  try {
    const ws = connect();
    const options = await optionsFrom(ws);
    const par1 = options.slots.find(s => s.slot === 'par_1');
    assert.equal(par1.storedSource, null, 'nothing stale is ever pre-filled');
    assert.deepEqual(par1.stored, { source: 'Left Auditorium 999', reverse: false },
      'but the operator is shown what WAS remembered');
    assert.match(par1.staleReason, /stored source 'Left Auditorium 999' no longer resolves/);
    assert.match(par1.staleReason, /kept until the next successful ARM/);
    assert.ok(options.warnings.some(w => /remembers a slot 'ghost_slot'/.test(w)),
      'a slot id the sidecar no longer declares is a payload warning, never applied');
    // The file is NOT edited by a read.
    assert.equal(fs.readFileSync(stateFile, 'utf8'), yaml.dump(tree),
      'picker-open never writes — only a successful ARM does');
  } finally {
    fs.writeFileSync(stateFile, before, 'utf8');
  }
});

test('_176 §3.2: an unreadable state file is reported, and does not block arming', async () => {
  const stateFile = path.join(H.benchStateRoot, 'test_bench', 'bench_mirror_state.yaml');
  const before = fs.readFileSync(stateFile, 'utf8');
  fs.writeFileSync(stateFile, 'state_version: 7\nselections: {}\n', 'utf8');
  try {
    const ws = connect();
    const options = await optionsFrom(ws);
    assert.equal(options.ok, true, 'a rotten state file must not break the picker');
    assert.ok(options.warnings.some(w => /is unreadable/.test(w)),
      'it is reported verbatim…');
    assert.ok(options.warnings.some(w => /state_version must be 1/.test(w)),
      '…with the parse message, so the operator can fix or delete it');
    for (const slot of options.slots) {
      assert.equal(slot.stored, null, 'and NOTHING is remembered from it');
    }
  } finally {
    fs.writeFileSync(stateFile, before, 'utf8');
  }
});

test('_151 bridge: after disarm, raw frames reach the boxes again and nothing composes', async () => {
  sends.length = 0;
  inbound(30, { 1: 55 });
  await settle(4);
  assert.ok(sendsTo(GATEWAY.destHost).length + sends.length > 0, 'the ordinary relay resumed');
  assert.equal(sendsTo(STRAND.destHost, STRAND.destUniverse).length, 0,
    'nothing composes for the mirror once disarmed');
});

test('_155: ARM with an explicit selection composes the CHOSEN source, not the default',
  async () => {
    const ws = connect();
    const options = await optionsFrom(ws);
    const par1 = options.slots.find(s => s.slot === 'par_1');
    // Pick a DIFFERENT candidate from the default, at a different address.
    const other = par1.candidates.find(c => c.name !== par1.defaultSource
      && c.universe === par1.candidates.find(x => x.name === par1.defaultSource).universe);
    assert.ok(other, 'the picker must offer more than one par');
    const selection = Object.fromEntries(options.slots.map(s => [s.slot,
      { source: s.slot === 'par_1' ? other.name : s.defaultSource, reverse: false }]));

    captureConsole();
    const reply = await armFrom(ws, 'test_bench', selection);
    releaseConsole();
    assert.equal(reply.armed, true, reply.refusal || '');
    assert.equal(reply.selection.find(s => s.slot === 'par_1').source, other.name);

    // Feed a frame whose value encodes WHICH source region it came from, and
    // assert the composed bytes carry the chosen one.
    sends.length = 0;
    const payload = {};
    const def = par1.candidates.find(c => c.name === par1.defaultSource);
    for (let i = 0; i < 10; i += 1) { payload[def.addr + i] = 11; payload[other.addr + i] = 22; }
    // ONE engine frame, with the crafted payload carried by the universe both
    // candidates live on. Feeding that universe a second time would read as a
    // new frame and restart the gather (_158 D-158-3).
    const seq = advanceFrame();
    for (const u of ALL_SOURCES) inbound(u, u === other.universe ? payload : { 1: 1 }, seq);
    await settle(6);
    const composed = sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).pop();
    assert.ok(composed, 'the gateway frame must be composed');
    assert.equal(composed.payload[par1.dest.addr], 22,
      'the CHOSEN source\'s bytes must land, not the default\'s');

    await disarmFrom(ws);
    await settle(6);
  });

test('_155 R-13: an incomplete selection is refused end-to-end, naming the slots', async () => {
  const ws = connect();
  const reply = await armFrom(ws, 'test_bench',
    { par_1: { source: 'Left Auditorium 5', reverse: false } });
  assert.equal(reply.armed, false);
  assert.match(reply.refusal, /ARM refused \[R-13\]/);
  assert.match(reply.refusal, /missing slot\(s\)/);
  assert.match(reply.refusal, /led_1/);
});

test('_155 R-15: an incompatible choice is refused end-to-end, naming slot AND rule', async () => {
  const ws = connect();
  const options = await optionsFrom(ws);
  const selection = Object.fromEntries(options.slots.map(s => [s.slot,
    { source: s.defaultSource, reverse: false }]));
  // a par into the bar slot
  selection.bar_left = { source: options.slots.find(s => s.slot === 'par_1').defaultSource,
    reverse: false };
  const reply = await armFrom(ws, 'test_bench', selection);
  assert.equal(reply.armed, false);
  assert.match(reply.refusal, /ARM refused \[R-15\]/);
  assert.match(reply.refusal, /slot 'bar_left'/);
  assert.match(reply.refusal, /\[rule: fixtureType\]/);
});

test('_151 bridge: the arming socket disconnecting disarms with the same blackout', async () => {
  const ws = connect();
  captureConsole();
  const reply = await armFrom(ws);
  releaseConsole();
  assert.equal(reply.armed, true, reply.refusal || '');

  sends.length = 0;
  logs.length = 0;
  const baseline = disarmBroadcasts();
  captureConsole();
  ws.drop();
  try {
    await waitForDisarm(baseline, 'the socket-drop disarm to complete');
  } finally {
    releaseConsole();
  }

  for (const d of LIVE_DESTS) {
    const zero = sends.filter(s => s.ip === d.ip && s.universe === d.universe
      && Object.values(s.payload).every(v => v === 0));
    assert.equal(zero.length, 3,
      `U${d.universe} → ${d.ip} must be blacked out when the arming window goes away`);
  }
  assert.ok(logs.some(l => /the sim window that armed it disconnected/.test(l)),
    'the disarm reason must be logged');
});

// ── _152 D1 regression: no second writer during the release window ────────

test('_152 D1: no raw relay frame reaches an owned pair between the blackout frames', async () => {
  const ws = connect();
  captureConsole();
  const reply = await armFrom(ws);
  releaseConsole();
  assert.equal(reply.armed, true, reply.refusal || '');

  events.length = 0;
  const baseline = disarmBroadcasts();
  captureConsole();
  ws.drop();                       // starts the disarm; it suspends at its await
  // Pump raw traffic on the owned universes for the whole release window — this
  // is the engine still running while the operator closes the window.
  for (let i = 0; i < 500 && disarmBroadcasts() === baseline; i += 1) {
    engineFrame(200);
    await tick();
  }
  for (let i = 0; i < 6; i += 1) { engineFrame(210); await tick(); }
  releaseConsole();

  for (const d of LIVE_DESTS) {
    const ev = pairEvents(d.universe, d.ip);
    const zeroAt = ev.map((e, i) => ({ e, i })).filter(x => x.e.kind === 'send' && x.e.zero)
      .map(x => x.i);
    assert.equal(zeroAt.length, 3,
      `U${d.universe} → ${d.ip}: expected exactly 3 blackout frames`);

    const window = ev.slice(zeroAt[0], zeroAt[zeroAt.length - 1] + 1);
    assert.ok(!window.some(e => e.kind === 'send' && !e.zero),
      `U${d.universe} → ${d.ip}: a RAW frame was emitted between the first and last blackout ` +
      'frame — two live writers on one (universe, controller) during the release window');
    assert.ok(!window.some(e => e.kind === 'open'),
      `U${d.universe} → ${d.ip}: an ordinary relay sender was OPENED mid-blackout — the relay ` +
      'took the pair back before the mirror finished handing it over');
    assert.ok(!window.some(e => e.kind === 'close'),
      `U${d.universe} → ${d.ip}: the mirror sender was closed before its blackout finished`);
  }

  // Non-vacuity: raw traffic really was flowing, and it resumed afterwards.
  const gatewayEv = pairEvents(GATEWAY.destUniverse, GATEWAY.destHost);
  const lastZero = gatewayEv.map((e, i) => ({ e, i }))
    .filter(x => x.e.kind === 'send' && x.e.zero).map(x => x.i).pop();
  assert.ok(gatewayEv.slice(lastZero).some(e => e.kind === 'send' && !e.zero),
    'raw relay frames must resume on the gateway pair once the blackout has finished — ' +
    'otherwise this test proves nothing about ordering');
  assert.ok(openSenders().includes(routeKey(GATEWAY.destUniverse, GATEWAY.destHost)),
    'and the pair ends up with a live sender again');
});

test('_152 D2: an ARM landing inside the blackout window is REFUSED, not accepted', async () => {
  const owner = connect();
  const other = connect();
  captureConsole();
  const armed = await armFrom(owner);
  releaseConsole();
  assert.equal(armed.armed, true, armed.refusal || '');

  logs.length = 0;
  const baseline = disarmBroadcasts();
  captureConsole();
  owner.drop();                    // disarm starts and suspends — we are inside it
  const reply = await request(other, { type: 'benchMirrorArm', scene: 'test_bench' }, 'd2-arm');
  try {
    await waitForDisarm(baseline, 'the blackout to finish');
  } finally {
    releaseConsole();
  }

  assert.equal(reply.armed, false, 'the bridge must not arm while a blackout is in flight');
  assert.match(reply.refusal, /blackout is still in flight/);

  const armedIdx = logs.findIndex(l => /🪞 BENCH MIRROR ARMED/.test(l));
  assert.equal(armedIdx, -1, 'the bridge must not print ARMED during a disarm');
  assert.ok(logs.some(l => /BENCH MIRROR DISARMED/.test(l)),
    'and the disarm still completes and says so');
});

test('_152 RESIDUAL-1: a throw in the disarm prologue must not leak the blackout hold', async () => {
  const ws = connect();
  captureConsole();
  const armed = await armFrom(ws);
  releaseConsole();
  assert.equal(armed.armed, true, armed.refusal || '');

  // A socket in transition: `ws.send()` throws. The bridge's `broadcastLog` in
  // the disarm PROLOGUE walks the client set, so this throws between the raise
  // of `_blackoutHold` and the `finally` that releases it. Poisoned narrowly —
  // only the disarming line — so the earlier close-handler broadcasts still work
  // and this reproduces RESIDUAL-1 and nothing else.
  const poison = connect();
  poison.send = (data) => {
    if (String(data).includes('BENCH MIRROR disarming')) throw new Error('socket in transition');
  };

  logs.length = 0;
  captureConsole();
  try {
    ws.drop();
    await settle(30);
  } finally {
    releaseConsole();
    poison.readyState = 3;
    inputWss.clients.delete(poison);
  }

  // The hold must have been released by the `finally` even though the prologue
  // threw — and the close handler's own recompute must therefore have handed the
  // routes back. If the hold leaked, they stay suppressed until the process
  // restarts and every controller is left unfed.
  sends.length = 0;
  inbound(GATEWAY.destUniverse, { 1: 77 });
  inbound(30, { 1: 78 });
  await settle(6);
  assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length > 0,
    'the gateway pair must be relayed again — a leaked blackout hold would suppress it forever');
  assert.ok(logs.some(l => /BENCH MIRROR disarm \(disconnect\) FAILED/.test(l)),
    'and the failure must be shouted, not swallowed');
});

// `_155 A3` (losing the gate control link auto-disarms) RETIRED by _171: there
// is no control link, because there is nothing on the other end to silence.

// The engine poll is a 3 s interval inside the bridge, so these last cases wait
// on a real timer.
async function waitMs(cond, what, ms = 8000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function armEventually(ws, ms = 8000) {
  const start = Date.now();
  for (;;) {
    const status = await armFrom(ws);
    if (status.armed) return status;
    if (Date.now() - start > ms) throw new Error(`could not arm: ${status.refusal}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('_152 D5: losing outputRouting at RUNTIME auto-disarms — ownership becomes unprovable',
  async () => {
    const ws = connect();
    captureConsole();
    const reply = await armEventually(ws);
    releaseConsole();
    assert.equal(reply.armed, true, reply.refusal || '');

    sends.length = 0;
    logs.length = 0;
    const baseline = disarmBroadcasts();
    captureConsole();
    H.setEngineStatus({ service: 'marsin-engine', activeScene: 'titanic' });   // no outputRouting
    try {
      await waitMs(() => disarmBroadcasts() > baseline, 'the ownedUnavailable auto-disarm');
      await settle(12);
    } finally {
      releaseConsole();
    }

    assert.ok(logs.some(l => /BENCH MIRROR AUTO-DISARM/.test(l)), 'the auto-disarm must be loud');
    assert.ok(logs.some(l => /ownership became unprovable/.test(l)), 'and must name the reason');
    for (const d of LIVE_DESTS) {
      const zero = sends.filter(s => s.ip === d.ip && s.universe === d.universe
        && Object.values(s.payload).every(v => v === 0));
      assert.equal(zero.length, 3, `U${d.universe} → ${d.ip} blacked out on auto-disarm`);
    }

    const again = await armFrom(connect());
    assert.equal(again.armed, false);
    assert.match(again.refusal, /UNPROVABLE/);
  });

test('_155 R-21: an engine that starts delivering directly auto-disarms', async () => {
  H.setEngineStatus({
    service: 'marsin-engine', activeScene: 'titanic', outputRouting: { controllers: [] },
  });
  const ws = connect();
  captureConsole();
  const reply = await armEventually(ws);
  releaseConsole();
  assert.equal(reply.armed, true, reply.refusal || '');

  logs.length = 0;
  const baseline = disarmBroadcasts();
  captureConsole();
  H.setEngineStatus({
    ...H.getEngineStatus(),
    outputRouting: { controllers: [{ name: 'x', host: '10.9.9.202', universes: [10] }] },
  });
  try {
    await waitMs(() => disarmBroadcasts() > baseline, 'the engine-direct auto-disarm');
    await settle(12);
  } finally {
    releaseConsole();
  }
  assert.ok(logs.some(l => /engine took direct ownership of/.test(l)));
  assert.ok(logs.some(l => /can no longer be proven/.test(l)));

  // …and it stays refused while the engine keeps a direct route.
  const again = await armFrom(connect());
  assert.equal(again.armed, false);
  assert.match(again.refusal, /bypassing the bridge/);
  H.setEngineStatus({
    service: 'marsin-engine', activeScene: 'titanic', outputRouting: { controllers: [] },
  });
});

test('_151 bridge: an engine scene change auto-disarms loudly and restores the relay', async () => {
  const ws = connect();
  captureConsole();
  const reply = await armEventually(ws);
  releaseConsole();
  assert.equal(reply.armed, true, reply.refusal || '');

  sends.length = 0;
  logs.length = 0;
  const baseline = disarmBroadcasts();
  captureConsole();
  H.setEngineStatus({ ...H.getEngineStatus(), activeScene: 'studio' });
  try {
    await waitMs(() => disarmBroadcasts() > baseline, 'the scene-change auto-disarm');
    await settle(12);
  } finally {
    releaseConsole();
  }

  assert.ok(logs.some(l => /BENCH MIRROR AUTO-DISARM/.test(l)), 'the auto-disarm must be loud');
  assert.ok(logs.some(l => /engine left scene 'titanic'/.test(l)), 'and must name the reason');
  for (const d of LIVE_DESTS) {
    const zero = sends.filter(s => s.ip === d.ip && s.universe === d.universe
      && Object.values(s.payload).every(v => v === 0));
    assert.equal(zero.length, 3, `U${d.universe} → ${d.ip} blacked out on auto-disarm`);
  }
  const status = ws.json('benchMirrorStatus').pop();
  assert.equal(status.armed, false, 'the broadcast status follows the auto-disarm');
});

// ══════════════════════════════════════════════════════════════════════════
// Post-review regressions (report 20260805_158)
// ══════════════════════════════════════════════════════════════════════════

// `_158` D-158-1 (a gate lost inside the ARM blackout was swallowed, and the arm
// reported success while the ship was reachable again at priority 150) is
// UNREPRESENTABLE after _171 and its regression is retired: the failure needed a
// gate to lose and a browser stream to leak through it, and neither exists. The
// property it defended — an arm may not claim bench-only unless bench-only is
// true — is now carried by the ownership proof's relay clauses (still asserted
// below) plus the absence assertions in tests/browser_transmit_absence.test.js.

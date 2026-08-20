/**
 * port_cleanup_arm_interlock.test.js — `tools/port_cleanup.cjs` must REFUSE to
 * force-kill an sACN bridge that is holding an ARMED bench mirror (report
 * 20260815_233 F7, from the forensics in 20260815_229 §4).
 *
 * THE INCIDENT. `port_cleanup` resolves the UDP :5568 holder with
 * `netstat -ano -p udp` and kills it with `taskkill /PID <pid> /T /F` — and the
 * :5568 holder is `sacn_bridge.js`, alone (its sibling holds TCP :6972 and
 * survived, which is the fingerprint that identified the mechanism). A `/F`
 * kill delivers no SIGTERM, so the bridge's shutdown path never runs, so the
 * DISARM blackout never goes out: every mirrored box was left holding its last
 * composed frame — a lit rig with no writer, which reads as alive to a passerby
 * and as a bug to the operator. `_212` filed it as a coordination matter; it
 * recurred, so it is a code guard now.
 *
 * NOTHING IS EVER KILLED BY THIS FILE. The guard is exercised through injected
 * process-inspection seams, and every `killPid` call names a PID no operating
 * system can have issued (see `ARMED.pid`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const portCleanup = require('../../tools/port_cleanup.cjs');
const {
  benchMirrorArmGuard, readArmMarker, writeArmMarker, clearArmMarker, killPid,
  forceSacnKillRequested, FORCE_SACN_KILL_ENV, FORCE_SACN_KILL_FLAG,
  BENCH_MIRROR_ARM_MARKER,
} = portCleanup;

/** A scratch marker path — never the live stack's. */
const SCRATCH = path.join(os.homedir(), 'tmp', 'fix_233', String(process.pid));
const MARKER = path.join(SCRATCH, 'bench_mirror_armed.json');
fs.rmSync(SCRATCH, { recursive: true, force: true });

const ARMED = {
  // 2147483647 is beyond every OS PID range (Windows PIDs are multiples of 4
  // and cap near 4194304; Linux pid_max never exceeds it), so not one assertion
  // below can reach a real process even if the guard were broken.
  pid: 2147483647,
  armedAt: '2026-08-15T04:54:53.000Z',
  scene: 'test_bench',
  sourceScene: 'titanic',
  destinations: ['U2 → 10.1.1.10'],
};
/** The seams: a live process whose command line looks like the bridge. */
const asLiveBridge = { markerPath: MARKER, isAlive: () => true, commandline: () => 'node C:\\bm26\\simulation\\server\\sacn_bridge.js --scene titanic' };

test('the marker round-trips, and a missing one is ABSENT rather than an error', () => {
  assert.equal(readArmMarker(MARKER).state, 'absent',
    'no marker means nothing is armed — that must be a first-class answer, not a throw');
  writeArmMarker(ARMED, MARKER);
  const read = readArmMarker(MARKER);
  assert.equal(read.state, 'armed');
  assert.equal(read.marker.pid, ARMED.pid);
  assert.equal(read.marker.scene, 'test_bench');
});

test('_233 F7: an ARMED bridge is refused, and the refusal says why and how to override', () => {
  const guard = benchMirrorArmGuard(ARMED.pid, asLiveBridge);
  assert.ok(guard, 'the armed bridge must be protected');
  assert.match(guard.why, /BENCH MIRROR is ARMED/);
  assert.match(guard.why, /test_bench/, 'and name what is armed, or the operator cannot judge it');
  assert.match(guard.why, /FREEZE/,
    'the STAKES must be in the line — "refused" without "the boxes freeze" is not actionable');
  assert.match(guard.why, /DISARM/, 'the correct remedy comes first');
  assert.match(guard.why, new RegExp(FORCE_SACN_KILL_ENV),
    'and the deliberate override must be named, or the operator is stuck');
});

test('_233 F7: a STALE claim never blocks a kill', () => {
  // The bridge was force-killed and never removed its marker. The PID is gone,
  // so the claim is inert — a guard that trusted the file alone would wedge
  // every later launcher start behind a process that no longer exists.
  const guard = benchMirrorArmGuard(ARMED.pid, { ...asLiveBridge, isAlive: () => false });
  assert.equal(guard, null);
});

test('_233 F7: PID REUSE never blocks a kill', () => {
  // The OS handed that PID to something else. Alive, but not a bridge — so the
  // claim does not describe it and it is killable like anything else.
  const guard = benchMirrorArmGuard(ARMED.pid, { ...asLiveBridge, commandline: () => 'chrome.exe --type=renderer' });
  assert.equal(guard, null);
});

test('_233 F7: the interlock covers ONLY the process the marker names', () => {
  const guard = benchMirrorArmGuard(ARMED.pid + 1, asLiveBridge);
  assert.equal(guard, null,
    'a claim on one PID must not make every other process unkillable');
});

test('_233 F7: an UNREADABLE marker refuses every sACN bridge, loudly', () => {
  // We cannot tell which PID is armed, and the cost of guessing wrong is a
  // frozen rig. So the interlock widens to "anything that looks like a bridge"
  // and says exactly why — never a silent skip, never a silent kill.
  fs.writeFileSync(MARKER, '{ this is not json');
  const guard = benchMirrorArmGuard(ARMED.pid, asLiveBridge);
  assert.ok(guard, 'an unreadable claim must not be read as "nothing is armed"');
  assert.match(guard.why, /UNREADABLE/);
  assert.match(guard.why, /does not parse as JSON/, 'and must say what is wrong with the file');
  assert.match(guard.why, new RegExp(FORCE_SACN_KILL_ENV));
  // …but it still does not make unrelated processes unkillable.
  assert.equal(
    benchMirrorArmGuard(ARMED.pid, { ...asLiveBridge, commandline: () => 'python worker.py' }), null);
  writeArmMarker(ARMED, MARKER);
});

test('_233 F7: killPid REFUSES rather than kills, and reports it', () => {
  const said = [];
  const outcome = killPid(ARMED.pid, { guardDeps: asLiveBridge, log: (m) => said.push(m) });
  assert.equal(outcome.killed, false);
  assert.equal(outcome.refused, true);
  assert.match(outcome.why, /BENCH MIRROR is ARMED/);
  assert.equal(said.length, 1, 'the refusal must be SAID, not just returned');
  assert.match(said[0], /REFUSING to kill/);
});

test('_233 F7: the operator can override it deliberately, and is warned when they do', () => {
  const said = [];
  const outcome = killPid(ARMED.pid, { guardDeps: asLiveBridge, force: true, log: (m) => said.push(m) });
  assert.equal(outcome.refused, false);
  assert.equal(outcome.killed, true);
  assert.match(said[0], /OVERRIDE/);
  assert.match(said[0], /FREEZE/,
    'an override must still say what it is about to cost — the boxes hold their last frame');
});

test('_233 F7: the override is spelled two ways, because the callers differ', () => {
  // The env var works everywhere; the flag is for callers that put it on an
  // argv `forceSacnKillRequested` can see. `launcher.js` rejects unknown
  // options, so it had to be taught this one by name — pinned below.
  const hadEnv = process.env[FORCE_SACN_KILL_ENV];
  delete process.env[FORCE_SACN_KILL_ENV];
  assert.equal(forceSacnKillRequested(), false, 'nothing is overridden by default');
  process.env[FORCE_SACN_KILL_ENV] = '1';
  assert.equal(forceSacnKillRequested(), true);
  if (hadEnv === undefined) delete process.env[FORCE_SACN_KILL_ENV];
  else process.env[FORCE_SACN_KILL_ENV] = hadEnv;

  process.argv.push(FORCE_SACN_KILL_FLAG);
  assert.equal(forceSacnKillRequested(), true, 'the flag must work for argv-forwarding callers');
  process.argv.pop();
  assert.equal(forceSacnKillRequested(), false);
});

test('_234: launcher.js ACCEPTS the flag instead of exiting 2 on it', () => {
  // The launcher requires port_cleanup IN-PROCESS, so `forceSacnKillRequested`
  // reads the launcher's own argv — acceptance is the whole mechanism, and
  // there is nothing to forward. Before this, the parser's unknown-option arm
  // killed the invocation before any port work began (report 20260815_233 §4).
  const src = fs.readFileSync(new URL('../../launcher.js', import.meta.url), 'utf8');
  assert.match(src, /case portCleanup\.FORCE_SACN_KILL_FLAG: break;/,
    'the flag must be matched off the shared constant, not re-spelled in the launcher');
  assert.match(src, new RegExp(`\\$\\{portCleanup\\.FORCE_SACN_KILL_FLAG`),
    'and it must appear in --help — an override nobody can find is not an override');
});

test('_233 F7: a test process may NOT write or delete the live stack\'s interlock', () => {
  // The production marker is the LIVE bench's claim. A suite that wrote it
  // would overwrite it and then, on its own disarm, DELETE it — silently
  // unprotecting an armed bench while the operator is standing at the rig.
  // Same doctrine as `bench_mirror_state.cjs`: the seam is the env var, and the
  // guard makes it un-bypassable rather than optional.
  assert.equal(path.resolve(BENCH_MIRROR_ARM_MARKER),
    path.resolve(path.join(os.homedir(), 'tmp', 'bm26_bench_mirror_armed.json')),
    'this spec must be running against the PRODUCTION default, or it proves nothing');
  assert.throws(() => writeArmMarker(ARMED), /NODE_TEST_CONTEXT/,
    'writing the live interlock from a test must be refused by name');
  assert.ok(process.env.NODE_TEST_CONTEXT, 'and the refusal must be keyed on the test context');
});

test('_233 F7: freeStackPorts reports refusals instead of swallowing them', () => {
  const src = fs.readFileSync(new URL('../../tools/port_cleanup.cjs', import.meta.url), 'utf8');
  assert.match(src, /const outcome = killPid\(pid, \{ log: \(m\) => log\(m\) \}\);/,
    'the sweep must go through the guarded killer, or the interlock is decorative');
  assert.match(src, /if \(outcome\.refused\) refused\.push\(\{ port, pid, why: outcome\.why \}\);/);
  assert.match(src, /return \{ killed, foreign, refused \};/,
    'a port left held because of the interlock must be reported to the caller — a sweep that ' +
    'silently did nothing is how the next hour gets lost');
});

test('_233 F7: the bridge publishes and releases the claim on the arm/disarm paths', () => {
  const src = fs.readFileSync(new URL('../server/sacn_bridge.js', import.meta.url), 'utf8');
  assert.match(src, /const interlockWarning = claimArmInterlock\(_mirrorArm\);/,
    'claimed in the same synchronous turn the arm is recorded — the ship-dark blackout takes ' +
    'real time and a sweep landing inside it freezes the boxes just as badly');
  assert.match(src, /releaseArmInterlock\(`disarming \(\$\{how\}\)`\);/,
    'and released before the disarm blackout, so a disarmed bridge never looks armed to a sweep');
  assert.match(src, /reapStaleArmInterlock\(\);/,
    'a start is always DISARMED, so a claim standing at boot belongs to a bridge that died');
  assert.match(src, /if \(interlockWarning !== null\) warnings\.push\(interlockWarning\);/,
    'and a claim that could NOT be published must reach the operator — an arm that thinks it is ' +
    'protected and is not is worse than one that knows it is exposed');
});

test('cleanup: the scratch marker is removed', () => {
  assert.equal(clearArmMarker(MARKER), true);
  assert.equal(readArmMarker(MARKER).state, 'absent');
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

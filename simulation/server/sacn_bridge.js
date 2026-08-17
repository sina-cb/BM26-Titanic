/**
 * sacn_bridge.js — Standalone sACN → WebSocket bridge server.
 *
 * Runs as a separate process, receives sACN (E1.31) packets on the
 * local network and forwards DMX frame data to browser clients via WebSocket.
 *
 * Config is read from scene_config.yaml 'sacn' section.
 * Port is read from server_config.yaml 'sacn_port'.
 *
 * Protocol (WS messages, binary):
 *   Byte 0-1:  Universe number (uint16 LE)
 *   Byte 2:    Priority (uint8)
 *   Byte 3-514: DMX data (512 bytes)
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const SIM_ROOT = path.join(__dirname, '..');

// ── Scene selection via --scene <name> ─────────────────────────────────
const sceneIdx = process.argv.indexOf('--scene');
const sceneName = sceneIdx !== -1 && process.argv[sceneIdx + 1] ? process.argv[sceneIdx + 1] : 'titanic';
const sceneConfigPath = path.join(SIM_ROOT, 'scenes', sceneName, 'scene_config.yaml');

// ── Read config (fail-loud: no silent port guessing) ────────────────────
const { loadSimPorts } = require('../lib/load_ports.cjs');
const _simPorts = loadSimPorts(path.join(SIM_ROOT, 'config.yaml'));
const SACN_PORT = _simPorts.sacn_port;
const SACN_UDP_PORT = _simPorts.sacn_udp_port;
// Optional: the local IPv4 address (or adapter name) every multicast join is
// pinned to. Absent = the OS picks, which is what shipped before and is logged
// as such at boot. See lib/sacn_receiver_boot.cjs.
const SACN_INTERFACE = _simPorts.sacn_interface;

// ── Realtime priority (self-elevation) ──────────────────────────────────
// This bridge relays every DMX frame; a starved relay freezes the rig just
// like a starved engine. Elevate above the NORMAL class Chrome sits in.
// Default HIGH; the launcher can pass BM26_BRIDGE_PRIORITY. Reads the achieved
// class back and logs [BridgePriority] — an un-elevated bridge is never silent.
const processPriority = require('../../tools/process_priority.cjs');
processPriority.elevateSelf(
  processPriority.normalizePriorityRequest(process.env.BM26_BRIDGE_PRIORITY, { fallback: 'high' }) || 'high',
  { label: 'BridgePriority', logger: (m) => console.log(`[sacn_bridge] ${m}`) });

// The pure half of routing lives in lib/bridge_routing.cjs (unit-tested). It is
// required HERE — above the boot-time universe derivation — because both the
// boot scan and the runtime recompute read patches.yaml and the
// `📡 Subscribed Universes` field through the SAME helpers: one implementation
// of "what a patch record occupies" and one of "what the field means".
const { computeEffectiveRoutes, engineOwnedPairs, routeKey, partitionRoutePairs,
  applyUniverseSubscriptions, readPatchDeclarations,
  parseSubscribedUniversesField, buildRouteTableSnapshot } = require('../lib/bridge_routing.cjs');

// Bench stand-in re-addressing (operator order 2026-07-31). Pure halves in
// lib/bench_mirror.cjs (schema, activation, suppression, arm judgement) and
// lib/bench_mirror_resolve.cjs (ARM-time resolution of the v3 sidecar into the
// internal spec); this file owns the file reads, the senders and the logs.
const { parseBenchMirrorSpec, isMirrorActive, mirrorSourceUniverses, mirrorDestPairs,
  partitionMirrorSuppression, evaluateArmRequest, evaluateClaimOverlap, evaluateArmedHealth,
  createMirrorState, spliceMirrorFrame, mirrorPayload,
  describeMirror, DMX_CHANNELS } = require('../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry } = require('../lib/bench_mirror_resolve.cjs');
// The MACHINE-OWNED remembered picker state (design report 20260806_174 §3).
// Pure parse + a guarded atomic writer; this file supplies the ONE root.
const { readBenchMirrorState, writeBenchMirrorState, setSceneSelection,
  sceneSelection, BENCH_MIRROR_STATE_FILE } = require('../lib/bench_mirror_state.cjs');

// Boot-time correctness of the RECEIVE socket: which interface it joins
// multicast on, when it may be subscribed to, and what a socket error means
// (report 20260725_99 — the `addMembership EINVAL` boot crash).
const { resolveMulticastInterface, createBootGate, classifyReceiverError,
  checkBootSubscriptionInvariant } = require('../lib/sacn_receiver_boot.cjs');

/** Sidecar filename a scene uses to declare itself a stand-in for another. */
const BENCH_MIRROR_FILE = 'bench_mirror.yaml';

// ── Derive universes from ALL scene patches.yaml files ─────────────────
function getAllPatchUniverses() {
  const universes = new Set([1, 2]); // always include 1+2 as baseline
  const scenesDir = path.join(SIM_ROOT, 'scenes');
  try {
    const entries = fs.readdirSync(scenesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const patchesPath = path.join(scenesDir, entry.name, 'patches.yaml');
      if (!fs.existsSync(patchesPath)) continue;
      try {
        // readPatchDeclarations, not a bare `dmxUniverse` read: an LED strand
        // record spans every universe in its `segments[]`, and the boot floor
        // must cover the spill exactly as the runtime diff does.
        const read = readPatchDeclarations(yaml.load(fs.readFileSync(patchesPath, 'utf8')));
        for (const u of read.universes) universes.add(u);
        for (const a of read.anomalies) {
          console.warn(`[sACN Bridge] ⚠ ${entry.name}/patches.yaml — '${a.source}' ${a.message}`);
        }
      } catch (e) {
        console.warn(`[sACN Bridge] Could not read ${entry.name}/patches.yaml:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[sACN Bridge] Could not scan scenes directory:', e.message);
  }
  const sorted = [...universes].sort((a, b) => a - b);
  console.log(`[sACN Bridge] Subscribing to ${sorted.length} universe(s) from patches: [${sorted.join(', ')}]`);
  return sorted;
}

/** Unwrap the `{value, label}` GUI-control shape the scene YAML uses. */
function unwrapConfigValue(v) {
  return (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
}

/**
 * Read the `colorWave` settings block the bridge cares about, scene config
 * overriding common.yaml. Called at BOOT for the receiver options and on EVERY
 * recompute for the `📡 Subscribed Universes` field — a save rewrites
 * scenes/common.yaml before the client's `setScene` notify arrives, so a
 * re-read here is a FRESH read by construction (the save server's write is
 * atomic + fsync'd and completes before it answers 200).
 *
 * Throws on an unreadable / malformed file — the callers decide how loud.
 */
function readColorWaveSection() {
  let s = null;
  const commonPath = path.join(SIM_ROOT, 'scenes', 'common.yaml');
  if (fs.existsSync(commonPath)) {
    const commonConfig = yaml.load(fs.readFileSync(commonPath, 'utf8'));
    if (commonConfig && commonConfig.colorWave) s = commonConfig.colorWave;
  }
  if (fs.existsSync(sceneConfigPath)) {
    const sceneConfig = yaml.load(fs.readFileSync(sceneConfigPath, 'utf8'));
    if (sceneConfig && sceneConfig.colorWave) s = sceneConfig.colorWave;
  }
  return s;
}

const patchUniverses = getAllPatchUniverses();
let sacnOpts = { universes: patchUniverses, lockoutMs: 10000, highPriorityThreshold: 150, sourceStaleMs: 2000 };
try {
  const s = readColorWaveSection();
  if (s) {
    const univOverride = unwrapConfigValue(s.sacn_universes);
    // Only override if explicitly set in config; otherwise use patch-derived list
    const universes = univOverride
      ? parseSubscribedUniversesField(univOverride).universes
      : patchUniverses;
    sacnOpts = {
      universes,
      lockoutMs: unwrapConfigValue(s.sacn_lockout_ms) || 10000,
      highPriorityThreshold: unwrapConfigValue(s.sacn_high_priority) || 150,
      sourceStaleMs: unwrapConfigValue(s.sacn_stale_ms) || 2000,
    };
  }
} catch (e) {
  console.warn('[sACN Bridge] Could not read scene config:', e.message);
}

// ── Dependencies ───────────────────────────────────────────────────────
let Receiver, Sender, WebSocketServer;
try { ({ Receiver, Sender } = require('sacn')); } catch (e) {
  console.error('[sACN Bridge] sacn package not installed. Run: npm install sacn');
  process.exit(1);
}
try {
  WebSocketServer = require('ws').Server;
} catch (e) {
  console.error('[sACN Bridge] ws package not installed. Run: npm install ws');
  process.exit(1);
}

// ── Build Outward Network Map ───────────────────────────────────────────
// `outgoingSenders` is universe -> Map<ip, entry> (read by routeFrame). Each
// entry wraps the underlying sacn Sender along with per-target dedup state so
// we don't spam `Relay Error: send EHOSTDOWN <ip>:5568` once per inbound
// frame (≈30+/s) when a controller is offline: log on first occurrence and on
// transition, then suppress identical errors and emit a single heartbeat per
// RELAY_ERROR_LOG_INTERVAL_MS until the target recovers.
//
// ROUTE OWNERSHIP (2026-07-24 flicker/freeze fix, report 20260724_15): the
// route table used to be GLOBAL LAST-WRITER state — every browser's
// `setScene` replaced it wholesale, so a titanic viewer (0 routes) silently
// disconnected the test_bench hardware and the bench lights froze with plain
// browser activity. Routes are now the UNION of:
//   - the CLI `--scene` pin (deploy-time intent),
//   - the ENGINE's active scene (polled from :<enginePort>/status — hardware
//     follows the data generator, not browser windows),
//   - each connected client's tagged scene (a client only ADDS its scene),
// MINUS every (universe → host) pair the engine's declared controllers
// deliver directly (from /status `outputRouting`) — relaying those would put
// two interleaved sACN sources on one universe and flicker the fixtures.
// Pure computation lives in lib/bridge_routing.cjs (required at the top of this
// file, above the boot-time universe derivation which uses the same helpers).

const outgoingSenders = new Map();
const RELAY_ERROR_LOG_INTERVAL_MS = 30000;
const ENGINE_PORT = _simPorts.marsin_engine_port;
const ENGINE_POLL_MS = 3000;

const pinnedScene = sceneName;              // CLI --scene (always a string)
const clientScenes = new Map();             // ws → scene tag (set by setScene)
let engineState = { reachable: false, scene: null, owned: new Set() };

const _routeEntries = new Map();            // routeKey → sender entry
// Last recompute's engine-owned exclusions + active scenes, kept for the
// read-only `getRoutes` introspection (report 20260725_127): the push's third
// check reads them back to tell "route missing" from "engine delivers it
// directly" — the designed one-writer arbitration, not a failure.
let _lastExcluded = [];
let _lastActiveScenes = [];
// The ordinary relay set as of the last recompute. Read by the ARM evaluation
// so its warnings can name exactly which live routes arming is about to
// suppress — measured, not predicted from the scene files a second time.
let _lastRelayRoutes = [];
let _lastExcludedSig = '';
let _lastConflictSig = '';
const _warnedMissingScenes = new Set();
const _warnedRefusedRoutes = new Set();     // "scene|U→ip" — one named warning each
const _warnedSubscriptionErrors = new Set(); // full message — one shout per failure
const _warnedPatchAnomalies = new Set();    // "scene|fixture|message"
const _warnedFieldIssues = new Set();       // full message — one shout per field problem
const _warnedMirrorSpecs = new Set();       // "scene|message" — one shout per broken spec

// Held shut until the sACN receive socket is listening (see recomputeRoutes).
const _bootGate = createBootGate({
  onDefer: (reason) => console.log(
    `[sACN Bridge] Route recompute ('${reason}') held until the sACN socket is listening — ` +
    'multicast joins must not race the receiver\'s own boot join loop.'),
});

// ── Bench stand-in mirrors ──────────────────────────────────────────────
// `_activeMirrors` is [{ scene, spec, state }] for every scene whose
// bench_mirror.yaml is enabled AND whose preconditions hold right now. State
// (the composed 512-byte buffers) is REUSED across recomputes while the spec is
// byte-identical, so a route recompute never blanks a bench frame mid-show.
let _activeMirrors = [];
const _mirrorEntries = new Map();           // destKey → sender entry (same shape as a relay)
let _mirrorStates = new Map();              // scene → { sig, state }
let _lastMirrorSig = '';
let _lastSuppressedSig = '';                // _105 F10: its OWN signature, not the mirror set's
const _mirrorDirty = new Set();             // destKeys awaiting a flush
let _mirrorFlushScheduled = false;

// ── Mirror wire identity (report 20260805_155 §15.A4) ──────────────────────
//
// PRIORITY IS FIXED AND DECLARED, never inherited from the source frame. The
// old behaviour re-emitted a composed frame at whatever priority last fed it,
// so a rogue priority-150 inbound would have left the mirror AT 150 — priority
// games riding a dead arbitration path (`_153` F3). Escalation above 150 was
// rejected outright by the operator: it MASKS a second writer instead of
// refusing it, which is the exact bug class this slice exists to close. The
// second writer is handled structurally — no browser can transmit at all — and
// by refusals, not by shouting louder on the wire.
const MIRROR_PRIORITY = 100;

// A DISTINCT, STABLE CID. Every sACN sender in this project ships the `sacn`
// package's hardcoded DEFAULT_CID, so any two writers on one universe look like
// ONE E1.31 source with two interleaved sequence counters — receivers then
// discard packets semi-randomly under E1.31 §6.7.2 REGARDLESS of priority
// (`_153` F2, measured). Giving the mirror its own CID turns any residual
// two-writer situation into deterministic multi-source arbitration and makes a
// wire capture attributable. Derived from a fixed namespace string so it is the
// same 16 bytes on every machine and every boot — a random CID per process would
// look like a new source after every restart.
const MIRROR_CID = crypto.createHash('md5').update('bm26:bridge-mirror').digest();

// ── BENCH MIRROR arm (report 20260804_151) ─────────────────────────────────
// The runtime mode switch. PROCESS MEMORY ONLY — never read from or written to
// disk, so every bridge start and every launcher start comes up DISARMED and the
// checked-in sidecar can never activate hardware by itself. Same discipline as
// the engine's PERFORMANCE MODE (marsin_engine/lib/api_server.js /status).
//
// SOCKET-SCOPED (operator ruling 2026-08-04): `ws` is the sim window that armed
// it. That window's disconnect — a close, a reload, a crashed tab — disarms
// cleanly, so the hardware can never stay re-addressed with nobody watching.
let _mirrorArm = null;          // null | { scene, sourceScene, label, selection, spec, slots,
//                                          destinations, armedAt, ws }
let _mirrorDisarming = false;   // a DISARM blackout is in flight: do NOT close mirror senders

// ── ARMED = THE BENCH IS THE ONLY PHYSICAL OUTPUT (operator ruling) ────────
//
// While armed, ALL ordinary relay to ALL controllers of every active scene is
// suspended. The ship must go DETERMINISTICALLY DARK rather than frozen: a DMX
// gateway has no timeout and the MarsinLED `dmx.timeoutMs` is unwritten by this
// repo (0 = hold forever, `_150` §9), so simply ceasing to send would leave the
// ship holding its last look — which reads as alive to a passerby and as a bug
// to the operator. So ARM sends 3× all-zero frames through the RETIRING relay
// senders and awaits them before they are closed: the exact mirror image of the
// disarm blackout.
//
// `_relaySuspended` stops `routeFrame` relaying raw frames the instant the arm
// begins, before any await — otherwise raw frames would interleave with the
// zeros on the same pairs, which is the D1 defect pointing the other way.
// `_relayCloseHeld` keeps those senders OPEN for the duration, the same way
// `_mirrorDisarming` keeps the mirror senders open through the disarm blackout.
let _relaySuspended = false;
let _relayCloseHeld = false;
let _armBlackoutInFlight = false;

// What an in-flight blackout has NOT finished handing back (report 20260804_152
// D1). `disarmBenchMirror` is async: it clears `_mirrorArm` synchronously and
// then SUSPENDS at its first `await`. Any recompute that lands in that window —
// a client's `setScene`, a client disconnect, an engine-poll change — sees no
// arm, suppresses nothing, and re-creates ordinary relay senders on pairs the
// blackout is still writing zeros to: two live writers on one
// (universe, controller), which is precisely the law `_15` established. Holding
// the release through `partitionMirrorSuppression` closes EVERY such path at the
// single point where relay senders are decided, not one caller at a time.
let _blackoutHold = null;       // null | { scene:string }
let _blackoutSettled = null;    // null | Promise — resolves when the zero frames have landed

/** A blackout in EITHER direction (arm's ship-dark, or disarm's bench release). */
function blackoutInFlight() {
  return _mirrorDisarming || _armBlackoutInFlight;
}

// ── Remembered SELECTIONS now live on disk (design 20260806_174 §3.2) ──────
//
// THIS REVERSES `_155` §10 BY OPERATOR ORDER, and the reversal is deliberate
// rather than an oversight, so the old rationale is answered rather than
// deleted. `_155` kept the last-used selection in process memory because a file
// could rot against the scene and could ride a `robocopy /MIR` onto the show
// server. Both objections are now met head-on:
//
//   - ROT IS DETECTED, LOUDLY, and never silently applied: every stored entry is
//     re-validated against the CURRENT source scene at picker-open (a stale row
//     is reported by name and pre-fills nothing) and again at ARM (where a
//     stored-but-stale name dies on R-14 exactly like a hand-typed one).
//   - A DEPLOYED COPY CANNOT LIGHT ANYTHING: the state schema has no key that
//     could hold an arm bit, a universe, an address or a host, so the file can
//     only ever pre-fill a picker. ARMING IS STILL PROCESS MEMORY (`_mirrorArm`
//     above), still an operator gesture, still cleared on every start.
//
// There is exactly ONE store: the file. A process-memory cache beside it would
// drift, so there is none and the file is read FRESH at every picker-open.
//
// ONE ROOT, INJECTED ONCE. `BM26_BENCH_MIRROR_STATE_ROOT` is the test seam — the
// suite points it at a scratch directory so no test can ever write into the
// repo's tracked `simulation/scenes/**`. It is not a fallback chain: unset means
// the production location, and the writer independently REFUSES a `node --test`
// process that aims at the real scenes directory (see `assertWritableTarget`).
const BENCH_MIRROR_STATE_ROOT =
  (typeof process.env.BM26_BENCH_MIRROR_STATE_ROOT === 'string'
    && process.env.BM26_BENCH_MIRROR_STATE_ROOT.trim() !== '')
    ? path.resolve(process.env.BM26_BENCH_MIRROR_STATE_ROOT.trim())
    : path.join(SIM_ROOT, 'scenes');

// ── The port-cleanup ARM INTERLOCK (report 20260815_233 F7) ────────────────
//
// `tools/port_cleanup.cjs` resolves the UDP :5568 holder — which is THIS
// process and nothing else — and `taskkill /T /F`s it. That skips SIGTERM, so
// `shutdown()` never runs, so the DISARM blackout never goes out, so every
// mirrored box freezes on its last composed frame: a lit rig with no writer.
// `_212` called it a standing hazard; `_229` §4 caught it happening.
//
// Arming is process memory and its only live surface is the sim WebSocket,
// which a synchronous zero-dependency killer cannot dial. So the arm publishes
// a PID-stamped marker that the killer reads, and the killer refuses this pid
// while the marker is live. Written on ARM success, removed on DISARM, and
// removed again on a clean exit — and stale-proof by construction, because the
// guard believes it only while that PID is alive AND still looks like a bridge.
const { writeArmMarker, clearArmMarker, readArmMarker, pidAlive,
  BENCH_MIRROR_ARM_MARKER } = require('../../tools/port_cleanup.cjs');

/**
 * Publish "this process holds an armed bench mirror" for the port sweeps.
 *
 * A write failure does NOT unwind the arm — the hardware has already changed
 * hands — but it is never swallowed: it is logged, broadcast and returned as an
 * arm warning, because it means the interlock is NOT protecting this session.
 * @returns {string|null} the warning, or null on success
 */
function claimArmInterlock(arm) {
  try {
    writeArmMarker({
      pid: process.pid,
      armedAt: arm.armedAt,
      scene: arm.scene,
      sourceScene: arm.sourceScene,
      label: arm.label,
      destinations: arm.destinations.map(d => `U${d.universe} → ${d.ip}`),
    });
    console.log(`[sACN Bridge] 🔒 arm interlock claimed — ${BENCH_MIRROR_ARM_MARKER} (pid ` +
      `${process.pid}). A port sweep that would force-kill this bridge is REFUSED while the ` +
      'mirror is armed, so the boxes cannot be frozen by one.');
    return null;
  } catch (e) {
    const why = `the port-cleanup ARM INTERLOCK could not be claimed — ${e.message} The mirror ` +
      'is armed and running, but a port sweep (launcher start, kill-ports, another session) can ' +
      'still force-kill this bridge, which would FREEZE every mirrored box on its last frame ' +
      'instead of blacking it out.';
    console.error(`[sACN Bridge] ❌ 🪞 ${why}`);
    broadcastLog(`❌ 🪞 ${why}`, 'warn');
    return why;
  }
}

/**
 * At boot: clear an interlock left behind by a bridge that no longer exists.
 *
 * Every start comes up DISARMED, and only one process can hold UDP :5568, so a
 * marker naming a DEAD pid at this moment is by definition the residue of the
 * force-kill this interlock exists to prevent. A marker naming a LIVE process is
 * never touched — it is reported instead, because that is either a second bridge
 * (a real fault) or a claim that is not ours to drop.
 */
function reapStaleArmInterlock() {
  const state = readArmMarker();
  if (state.state === 'absent') return;
  if (state.state === 'corrupt') {
    console.warn(`[sACN Bridge] ⚠ the port-cleanup arm interlock marker is unreadable — ` +
      `${state.error}. Port cleanup will refuse to kill ANY sACN bridge until it is deleted.`);
    return;
  }
  if (pidAlive(state.marker.pid) && state.marker.pid !== process.pid) {
    console.warn(`[sACN Bridge] ⚠ the arm interlock ${BENCH_MIRROR_ARM_MARKER} is claimed by a ` +
      `LIVE pid ${state.marker.pid} that is not this bridge. Leaving it alone; if that process ` +
      'is not an armed sACN bridge, port cleanup is being blocked by a claim nobody owns.');
    return;
  }
  try {
    if (clearArmMarker()) {
      console.log(`[sACN Bridge] 🔓 cleared a STALE arm interlock (pid ${state.marker.pid} is ` +
        `gone, armed ${state.marker.armedAt || 'at an unrecorded time'}). That bridge did not ` +
        'disarm before it died — its mirrored boxes were left holding their last composed frame.');
    }
  } catch (e) {
    console.warn(`[sACN Bridge] ⚠ could not clear the stale arm interlock — ${e.message}`);
  }
}

/** Drop the interlock. Loud on failure — a stale claim blocks port cleanup. */
function releaseArmInterlock(why) {
  try {
    if (clearArmMarker()) {
      console.log(`[sACN Bridge] 🔓 arm interlock released (${why}) — port sweeps may kill this ` +
        'bridge again.');
    }
  } catch (e) {
    console.error(`[sACN Bridge] ❌ the arm interlock marker ${BENCH_MIRROR_ARM_MARKER} could ` +
      `NOT be removed (${e.message}). Port cleanup will keep refusing to kill an sACN bridge ` +
      'until it is deleted by hand.');
  }
}

/**
 * The inbound frame's RAW DMX bytes, as the 1-indexed `{channel: value}` object
 * every downstream consumer in this file takes.
 *
 * WHY THIS EXISTS (report 20260805_170 — `_157` D1, `_153` F1b/F7). The `sacn`
 * package's `packet.payload` getter is a PERCENT view: it runs `objectify`,
 * which divides every wire byte by 2.55 and rounds to 2 dp. Feeding that to the
 * relay, the bench mirror and the browser WebSocket is what made this bridge
 * carry 0-100 "DMX" values — the sim's 39 % preview and the mirror's ~100-level
 * quantisation are both that one unit error, seen from two sides.
 * `payloadAsBuffer` is the same slice untouched, so this is the whole fix on
 * the receive side: read the raw bytes, and let every sender declare
 * `useRawDmxValues` so nothing rescales them again.
 *
 * DO NOT "simplify" this by handing `packet.payloadAsBuffer` straight to
 * `Sender.send({ payload })`. `Packet`'s own getter objectifies a Buffer
 * payload back to PERCENT, and `useRawDmxValues` would then write that percent
 * number as the wire byte — 2.55× DARK on every resend (`_157` §1, proved
 * again in this slice's report). The payload handed to a sender must always be
 * a plain 1-indexed object of raw 0-255 numbers.
 *
 * SHAPE IS UNCHANGED ON PURPOSE — only the UNIT moves. Zero channels are
 * omitted exactly as `objectify` omitted them, so every downstream consumer
 * sees the same sparse object it always did: the relay's outgoing frame still
 * zero-fills all 512 slots itself (`packet.js` `empty(512)`, pinned by
 * `marsin_engine/tests/io/sacn_output_wire.test.js`), the mirror's splice
 * already writes 0 for an absent channel, and the WebSocket frame starts from a
 * zeroed `Uint8Array`. Densifying here would have been a second, unrelated
 * behaviour change riding along with the unit fix.
 *
 * A frame shorter than 512 slots (legal E1.31: `propertyValueCount` < 513) is
 * carried at its own length; the absent tail reads as 0 downstream, exactly as
 * before.
 */
function rawDmxPayload(packet) {
  const buf = packet.payloadAsBuffer;
  if (!buf) {
    // STRUCTURALLY UNREACHABLE from the wire: `Packet` only returns null here
    // when it was built from an options object, and `Receiver` always builds
    // from the received Buffer. So this is a programming error, not a state to
    // accommodate — and there is no honest guess available (an empty frame
    // would black the rig out, a percent fallback would reintroduce D1). The
    // same invariant treatment `checkBootSubscriptionInvariant` gets at boot.
    // NOTE: throwing here would be SWALLOWED — the vendored Receiver wraps its
    // `emit('packet')` in try/catch and re-emits as `PacketOutOfOrder`, which
    // nothing listens to.
    console.error('[sACN Bridge] ❌ Inbound packet carries no raw DMX buffer — the receive path ' +
      'is not reading real E1.31 frames and the bridge will not guess their values.');
    process.exit(1);
  }
  const payload = {};
  const slots = Math.min(buf.length, DMX_CHANNELS);
  for (let i = 0; i < slots; i += 1) if (buf[i] !== 0) payload[i + 1] = buf[i];
  return payload;
}

/** E1.31 blackout payload: a full 512-channel frame of zeros. */
function zeroDmxPayload() {
  const payload = {};
  for (let i = 1; i <= DMX_CHANNELS; i += 1) payload[i] = 0;
  return payload;
}

// Blackout frames go out at the same declared priority the traffic they are
// retiring carried: the mirror's own fixed 100, and 100 for the relay (the
// engine's configured `sacn.priority`). A stated constant, not a guess about
// what a box last saw.
const BLACKOUT_DEFAULT_PRIORITY = 100;

/** How many all-zero frames a retiring source sends. */
const BLACKOUT_FRAMES = 3;

/** Log a message at most once for the lifetime of the process. */
function warnOnce(seen, message) {
  if (seen.has(message)) return;
  seen.add(message);
  console.warn(`[sACN Bridge] ${message}`);
  broadcastLog(message, 'warn');
}

/**
 * Re-read the `📡 Subscribed Universes` field (scenes/common.yaml →
 * `colorWave.sacn_universes`, scene config overriding) on every recompute.
 *
 * WHY AT RUNTIME (report 20260725_87): the field is the operator's ONLY way to
 * declare a universe that no patch record and no engine route can imply — an
 * external console or a second machine on the wire. Reading it only at boot is
 * what forced a launcher restart after the save-gate widened it: the file was
 * fresh, the running receiver was not. The save writes common.yaml and THEN
 * notifies the bridge (gui_builder.exportConfig awaits the 200 first), so the
 * read below is always the just-saved value.
 *
 * This is a floor, never a ceiling: field universes are ADDED to the wanted set
 * alongside the patch/engine-derived ones. The bridge never unsubscribes, so a
 * universe removed from the field stays accepted until the next start — the
 * same never-remove rule the save-side gate follows.
 *
 * @returns {{universes:number[], malformed:Array<{token:string, reason:string}>}|null}
 *   null when the scene declares no field at all (the patch scan is the floor).
 */
function readSubscribedUniversesField() {
  let s;
  try {
    s = readColorWaveSection();
  } catch (e) {
    warnOnce(_warnedFieldIssues,
      `⚠ Could not re-read 📡 Subscribed Universes from the scene config: ${e.message}. ` +
      'This recompute subscribes from the patch/engine-derived universes ONLY — a universe ' +
      'that exists only in that field will not be received until the file parses again.');
    return null;
  }
  if (!s) return null;
  const raw = unwrapConfigValue(s.sacn_universes);
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  return parseSubscribedUniversesField(raw);
}

/**
 * Read one scene's patch declarations: the (universe → controllerIp) relay
 * pairs AND every universe the scene patches at all (a fixture with no
 * controller IP still has to REACH THE BROWSERS, so the receiver must accept
 * its universe — see the subscription block in recomputeRoutes).
 *
 * FRESH ON EVERY CALL: the file is re-read here, inside the function, with no
 * cache anywhere. recomputeRoutes() calls this for every active scene, and a
 * client's post-save `setScene` triggers a recompute — so the bridge always
 * routes and subscribes from the patches.yaml the save server just wrote.
 *
 * An LED strand record occupies EVERY universe in its `segments[]`, not just
 * `dmxUniverse`; lib/bridge_routing.cjs's readPatchDeclarations expands that
 * (report 20260725_87 §gap A — the spill universes used to be invisible to both
 * the relay and the subscription diff).
 *
 * Returns `{ routes, universes }` — `routes` is [] for a scene whose patches
 * declare no controller IPs (a legitimate zero — e.g. titanic before the LED
 * cards were bound) — and null for a missing / unreadable file (logged loudly
 * by the caller, once per scene).
 *
 * Pairs the relay must NOT build (the `0.0.0.0` placeholder sentinel, a missing
 * IP, broadcast, loopback) are classified by lib/bridge_routing.cjs and REFUSED
 * with one named warning apiece — never dropped in silence. Report 20260725_33
 * §2 makes this a hard requirement: the titanic scene can be patched against
 * placeholder controllers long before the wiring is known, and an operator
 * staring at dark hardware must be able to see WHY from the log.
 */
function readSceneRoutePairs(sName) {
  const patchesYamlPath = path.join(SIM_ROOT, 'scenes', sName, 'patches.yaml');
  let pConf;
  try {
    if (!fs.existsSync(patchesYamlPath)) return null;
    pConf = yaml.load(fs.readFileSync(patchesYamlPath, 'utf8'));
  } catch (e) {
    console.warn(`[sACN Bridge] Could not parse ${sName}/patches.yaml for routing:`, e.message);
    return null;
  }
  const { declared, universes, anomalies } = readPatchDeclarations(pConf);
  for (const a of anomalies) {
    warnOnce(_warnedPatchAnomalies,
      `⚠ ${sName}/patches.yaml — record '${a.source}' ${a.message}`);
  }

  const { routes, refusals } = partitionRoutePairs(declared);
  for (const r of refusals) {
    const key = `${sName}|${routeKey(r.universe, r.ip)}`;
    if (_warnedRefusedRoutes.has(key)) continue;
    _warnedRefusedRoutes.add(key);
    const shown = r.sources.slice(0, 4).join(', ');
    const more = r.sources.length > 4 ? ` +${r.sources.length - 4} more` : '';
    const label = `U${r.universe} → '${r.ip}' [${r.status}]`;
    console.warn(
      `[sACN Bridge] ⚠ RELAY ROUTE REFUSED for scene '${sName}': ${label} — ${r.reason}. ` +
      `Declared by: ${shown}${more}. No sender created; nothing is sent to this address.`);
    broadcastLog(`⚠ Relay route REFUSED (${r.status}): ${label} in '${sName}'`, 'warn');
  }
  return { routes, universes };
}

/**
 * Read every scene's `bench_mirror.yaml` sidecar, fresh, with no cache — same
 * doctrine as readSceneRoutePairs (report 20260725_87): the operator edits the
 * map and the next recompute picks it up, no launcher restart.
 *
 * A spec that does not parse is REFUSED with one named warning and contributes
 * nothing. It is never partially applied: a half-right re-address map is wrong
 * fixtures with a green log, which is the failure mode the whole module exists
 * to avoid.
 *
 * The parse FAILURES are returned alongside the successes, not merely logged:
 * an ARM naming a scene whose sidecar is broken must be refused with THAT
 * message, and a live arm whose sidecar stops parsing must auto-disarm with it
 * (report 20260804_151). `warnOnce` still keeps the log from repeating.
 *
 * @returns {{found:Array<{scene:string, spec:Object, raw:string}>,
 *            errors:Array<{scene:string, message:string}>}}
 */
function readBenchMirrorSpecs() {
  const found = [];
  const errors = [];
  const scenesDir = path.join(SIM_ROOT, 'scenes');
  let entries;
  try {
    entries = fs.readdirSync(scenesDir, { withFileTypes: true });
  } catch (e) {
    warnOnce(_warnedMirrorSpecs, `⚠ Could not scan scenes for ${BENCH_MIRROR_FILE}: ${e.message}`);
    return { found, errors };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = path.join(scenesDir, entry.name, BENCH_MIRROR_FILE);
    if (!fs.existsSync(specPath)) continue;
    let raw;
    try {
      raw = fs.readFileSync(specPath, 'utf8');
      found.push({ scene: entry.name, spec: parseBenchMirrorSpec(yaml.load(raw), `${entry.name}/${BENCH_MIRROR_FILE}`), raw });
    } catch (e) {
      errors.push({ scene: entry.name, message: e.message });
      warnOnce(_warnedMirrorSpecs,
        `⚠ BENCH MIRROR REFUSED — ${entry.name}/${BENCH_MIRROR_FILE}: ${e.message} ` +
        'Nothing is mirrored from this scene until the file is fixed.');
    }
  }
  return { found, errors };
}

/**
 * Read one scene's three declaration files as parsed trees, FRESH, no cache —
 * the same doctrine as `readSceneRoutePairs` / `readBenchMirrorSpecs`. These are
 * what the bench-mirror resolver turns into universes, addresses and slices, so
 * a scene edit is picked up by the next ARM with no restart.
 *
 * @returns {{controllers:Object, patches:Object, sceneConfig:Object}|null}
 *          null when the scene directory does not carry all three.
 */
function readSceneTrees(sName) {
  const dir = path.join(SIM_ROOT, 'scenes', sName);
  const out = {};
  for (const [key, file] of [['controllers', 'controllers.yaml'], ['patches', 'patches.yaml'],
    ['sceneConfig', 'scene_config.yaml']]) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return null;
    // A scene file caught MID-WRITE (an editor or another agent saving) is a
    // PARSE throw, not a missing file — and this runs on the armed health check
    // every ENGINE_POLL_MS. Unguarded it escaped `resolveMirrorFor` (whose two
    // try blocks start below these reads), then `recomputeRoutes`, then the
    // async engine poll, which has no catch: an unhandled rejection that KILLS
    // the whole input bridge. `readSceneRoutePairs` above has always guarded
    // its own `yaml.load`; this one was the oversight. Report 20260814_212.
    try {
      out[key] = yaml.load(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error(`${sName}/${file} did not parse — ${e.message}`);
    }
  }
  return out;
}

/**
 * Resolve one sidecar against a source scene. Wraps the pure resolver with the
 * file reads it deliberately does not do, and turns a missing scene into a named
 * refusal rather than a crash.
 *
 * @returns {{ok:boolean, refusal:(string|null), warnings:string[], slots:Array,
 *            spec:(Object|null)}}
 */
function resolveMirrorFor(benchSceneName, spec, sourceSceneName, selection) {
  let benchScene;
  let sourceScene;
  try {
    benchScene = readSceneTrees(benchSceneName);
    sourceScene = readSceneTrees(sourceSceneName);
  } catch (e) {
    // A scene file that does not parse is an operator-fixable condition, so it
    // is a NAMED REFUSAL — never a throw that unwinds into the caller's async
    // timer and takes the bridge down with it.
    return { ok: false, warnings: [], slots: [], spec: null,
      refusal: `ARM refused [R-16]: a scene declaration file could not be read — ${e.message}` };
  }
  if (benchScene === null) {
    return { ok: false, warnings: [], slots: [], spec: null,
      refusal: `ARM refused [R-16]: scene '${benchSceneName}' does not carry all three of ` +
        'controllers.yaml / patches.yaml / scene_config.yaml, so its bench slots cannot be ' +
        'resolved.' };
  }
  if (sourceScene === null) {
    return { ok: false, warnings: [], slots: [], spec: null,
      refusal: `ARM refused [R-22b]: the engine's scene '${sourceSceneName}' does not carry all ` +
        'three of controllers.yaml / patches.yaml / scene_config.yaml, so there is nothing ' +
        'provable to mirror from it.' };
  }
  let registry;
  try {
    registry = loadFixtureRegistry(path.join(SIM_ROOT, 'dmx', 'fixtures'));
  } catch (e) {
    return { ok: false, warnings: [], slots: [], spec: null,
      refusal: `ARM refused [R-16]: the fixture definition registry could not be read — ` +
        `${e.message}` };
  }
  try {
    return resolveBenchMirror({
      spec, benchSceneName, benchScene, sourceSceneName, sourceScene, registry, selection,
    });
  } catch (e) {
    // A throw out of a PURE resolver is a defect, not an operator error — but it
    // must still be a refusal, never a half-armed bridge.
    return { ok: false, warnings: [], slots: [], spec: null,
      refusal: `ARM refused [R-19]: the mapping resolver threw — ${e.message}. Nothing was armed.` };
  }
}

/**
 * Recompute the effective route set and diff it onto the live senders.
 * Called on: boot, client setScene, client disconnect, engine poll change.
 * Every route add/remove/suppression is logged AND broadcast to the sim's
 * monitor panel — on playa someone WILL wonder why a universe isn't relayed.
 */
function recomputeRoutes(reason) {
  // ── Boot gate (report 20260725_99) ──────────────────────────────────────
  // A recompute SUBSCRIBES universes, and a subscription before the receive
  // socket is listening is joined twice — once by us, once by the `sacn`
  // package's own boot join loop, which runs in the socket's `listening`
  // callback over the SAME array `addUniverse` pushes into. A duplicate
  // IP_ADD_MEMBERSHIP is `addMembership EINVAL` on Windows, which the package
  // re-emits as an 'error' event: that is what killed the input bridge at boot.
  // Ordering, not suppression — `_bootGate.open()` replays the held reason the
  // instant the socket is up, and the deferral is logged.
  if (!_bootGate.guard(reason)) return;

  // ── Armed-state health, evaluated BEFORE anything else this pass ─────────
  // A live arm that has become illegitimate (engine moved, sidecar broke, the
  // engine claimed a mirrored pair) must not survive one more frame. The
  // disarm is ASYNC because it must blackout the owned destinations before
  // their senders close, so this pass bails out and the disarm's own recompute
  // finishes the job. `_mirrorArm` is cleared synchronously inside
  // disarmBenchMirror, so that recompute cannot re-enter this branch.
  if (_mirrorArm && !blackoutInFlight()) {
    const { found: healthSpecs, errors: healthErrors } = readBenchMirrorSpecs();
    let degrade = evaluateArmedHealth({
      scene: _mirrorArm.scene,
      sourceScene: _mirrorArm.sourceScene,
      specs: healthSpecs,
      specErrors: healthErrors,
      engineState,
    });
    if (!degrade) {
      // RE-RESOLVE from disk and compare. The armed mapping is FROZEN at the
      // arm; a scene or sidecar edit that changes what it would resolve to must
      // NOT hot-reshape live hardware — that is a fallback behaviour in
      // disguise. Auto-disarm loudly and let the operator re-arm to pick the
      // change up (report 20260805_155 §9).
      const sidecar = healthSpecs.find(s => s.scene === _mirrorArm.scene);
      const again = sidecar
        ? resolveMirrorFor(_mirrorArm.scene, sidecar.spec, _mirrorArm.sourceScene,
          _mirrorArm.selection)
        : null;
      if (again && !again.ok) {
        degrade = `the armed mapping no longer resolves against the scene — ${again.refusal}`;
      } else if (again && mirrorFingerprint(again.spec) !== _mirrorArm.fingerprint) {
        degrade = 'the armed mapping no longer matches the scene (a scene or sidecar edit ' +
          'changed what it resolves to) — re-arm to pick up the change';
      }
    }
    if (degrade) {
      console.warn(`[sACN Bridge] ⚠ 🪞 BENCH MIRROR AUTO-DISARM — ${degrade}. ` +
        'Blacking out the owned destinations and handing them back to the ordinary relay.');
      broadcastLog(`⚠ 🪞 BENCH MIRROR auto-disarmed — ${degrade}`, 'warn');
      disarmInBackground(degrade, 'auto');
      return;
    }
  }

  const candidateScenes = new Set([pinnedScene]);
  if (engineState.scene) candidateScenes.add(engineState.scene);
  for (const s of clientScenes.values()) candidateScenes.add(s);

  const sceneRoutes = new Map();
  const scenePatchUniverses = new Map();   // scene → every universe it patches
  for (const s of candidateScenes) {
    const read = readSceneRoutePairs(s);
    if (read === null) {
      if (!_warnedMissingScenes.has(s)) {
        _warnedMissingScenes.add(s);
        console.warn(`[sACN Bridge] ⚠ No readable patches.yaml for scene '${s}' — it contributes no relay routes.`);
        broadcastLog(`⚠ Unknown scene '${s}' — no relay routes from it`, 'warn');
      }
      continue;
    }
    sceneRoutes.set(s, read.routes);
    scenePatchUniverses.set(s, read.universes);
  }

  const { routes, excluded, conflicts: rawConflicts, activeScenes } = computeEffectiveRoutes({
    sceneRoutes,
    pinnedScene,
    engineScene: engineState.scene,
    clientScenes: clientScenes.values(),
    engineOwned: engineState.owned,
  });
  _lastExcluded = excluded;
  _lastActiveScenes = activeScenes;

  // ── Bench stand-in mirrors (operator order 2026-07-31) ─────────────────
  // Resolved BEFORE the subscription block and the sender diff: an active
  // mirror adds SOURCE universes the receiver must accept, and OWNS its
  // destination (universe → host) pairs, whose ordinary relay must be
  // suppressed (one writer per pair — report 20260724_15).
  // Activation precondition 3 is now the ARMED FLAG, not "is this spec's own
  // scene in the active set" — the substitution that removes the second-tab
  // requirement (report 20260804_151 §12.2). Preconditions 1 and 2 are verbatim.
  //
  // The active mirror is the COMPUTED spec frozen at ARM — not something
  // re-derived here. The health check above has already proven, this same pass,
  // that re-resolving from disk still yields exactly this mapping; anything else
  // has auto-disarmed. So there is one mirror at most, and its bytes cannot
  // change shape underneath a live composition.
  const nextMirrors = [];
  const nextMirrorStates = new Map();
  if (_mirrorArm !== null) {
    const armedSpec = _mirrorArm.spec;
    if (isMirrorActive(armedSpec, engineState.scene, true)) {
      // Reuse the composed buffers while the map is SEMANTICALLY identical, so a
      // route recompute never blanks a bench frame mid-show. Keyed on the parsed
      // spec, not the raw bytes: a comment-only edit used to blank the next
      // composed frame (_105 F14). With the seen-covers-required emission gate
      // below, even a genuine state reset can no longer emit a partly-black
      // frame (`_153` H5) — nothing goes out until every source has arrived.
      const sig = mirrorFingerprint(armedSpec);
      const prev = _mirrorStates.get(_mirrorArm.scene);
      const state = (prev && prev.sig === sig) ? prev.state : createMirrorState(armedSpec);
      nextMirrorStates.set(_mirrorArm.scene, { sig, state });
      nextMirrors.push({ scene: _mirrorArm.scene, spec: armedSpec, state });
    }
  }
  _activeMirrors = nextMirrors;
  _mirrorStates = nextMirrorStates;
  // A mapping that reads NO source universe (every slot `none`) has no engine
  // frame to ride, so its held-dark destinations are ticked by a timer instead.
  setDarkTick(_activeMirrors.some(m => m.state.bySource.size === 0));

  // ── _105 M2/F2: the ENGINE outranks the mirror ──────────────────────────
  // `mirrorTargets` used to be built from mirrorDestPairs ALONE, so a pair the
  // engine delivers itself got a mirror Sender anyway and the engine-owned
  // suppression line one screen below became actively false. Subtract it here,
  // name every subtraction, and — because a mirror that cannot own its
  // destinations is not the mode the operator armed — auto-disarm.
  //
  // `hold` is an in-flight blackout (report 20260804_152 D1): while it is
  // non-null the ordinary relay may not take anything back, no matter WHICH
  // caller triggered this recompute. It is cleared when the zero frames have
  // landed, and the disarm's own post-blackout recompute then creates the relay
  // senders. Under the bench-only ruling this partition ALSO empties the relay
  // set outright whenever a mirror is active: armed = the bench is the only
  // physical output.
  const {
    relay: relayRoutes, suppressed: mirrorSuppressed, targets: allTargets,
  } = partitionMirrorSuppression({ routes, mirrors: _activeMirrors, hold: _blackoutHold });
  const mirrorTargets = new Map();          // destKey → { universe, ip, scene }
  const mirrorEngineClash = [];
  for (const [key, target] of allTargets) {
    if (engineState.owned.has(key)) { mirrorEngineClash.push(target); continue; }
    mirrorTargets.set(key, target);
  }
  if (mirrorEngineClash.length > 0) {
    const named = mirrorEngineClash.map(t => `U${t.universe} → ${t.ip}`).join(', ');
    console.warn(`[sACN Bridge] ⚠ 🪞 BENCH MIRROR destination(s) ${named} are ENGINE-OWNED — ` +
      'no mirror sender is created for them; the engine is the single writer.');
    broadcastLog(`⚠ 🪞 Bench mirror destination engine-owned: ${named}`, 'warn');
    if (_mirrorArm && !blackoutInFlight()) {
      const why = `the engine took ownership of ${named}`;
      console.warn(`[sACN Bridge] ⚠ 🪞 BENCH MIRROR AUTO-DISARM — ${why}.`);
      broadcastLog(`⚠ 🪞 BENCH MIRROR auto-disarmed — ${why}`, 'warn');
      disarmInBackground(why, 'auto');
      return;
    }
  }

  _lastRelayRoutes = relayRoutes;

  // Annotate scene provenance for the logs: "test_bench[engine]".
  const provenance = (scene) => {
    const tags = [];
    if (scene === pinnedScene) tags.push('pin');
    if (scene === engineState.scene) tags.push('engine');
    for (const s of clientScenes.values()) { if (s === scene) { tags.push('client'); break; } }
    return tags.length ? `${scene}[${tags.join('+')}]` : scene;
  };

  // ── Receiver subscription (report 20260725_58 §7.1, slice S3) ───────────
  // BEFORE any sender is created: the `sacn` Receiver silently drops packets
  // for universes it is not subscribed to, so a relay route on a universe the
  // receiver never accepted is a route that looks live in every log and
  // carries nothing. The boot list (patches scan, or the colorWave
  // sacn_universes override) is only a starting point — a scene saved after
  // boot can patch anything. Subscribe to the effective route set, to the
  // engine-owned pairs we deliberately do NOT relay (they still have to reach
  // the browsers), and to every universe the active scenes patch at all.
  // Never unsubscribe: dropping multicast memberships to chase the exact set
  // would churn IGMP for no benefit, and a stale subscription costs nothing.
  //
  // The `📡 Subscribed Universes` field joins the same union (report
  // 20260725_87): it is RE-READ here rather than only at boot, so the save-time
  // gate's widened list reaches the running receiver on the notify that
  // immediately follows the save — no launcher restart.
  const wantedUniverses = [];
  for (const r of relayRoutes) {
    wantedUniverses.push({ universe: r.universe, source: `relay route → ${r.ip}` });
  }
  for (const m of _activeMirrors) {
    for (const u of mirrorSourceUniverses(m.spec)) {
      wantedUniverses.push({ universe: u, source: `bench mirror source (scene '${m.scene}')` });
    }
  }
  for (const e of excluded) {
    wantedUniverses.push({ universe: e.universe, source: `engine-owned route → ${e.ip}` });
  }
  for (const scene of activeScenes) {
    for (const u of scenePatchUniverses.get(scene) || []) {
      wantedUniverses.push({ universe: u, source: `scene '${scene}' patch` });
    }
  }
  const field = readSubscribedUniversesField();
  if (field) {
    for (const u of field.universes) {
      wantedUniverses.push({ universe: u, source: '📡 Subscribed Universes field' });
    }
    for (const m of field.malformed) {
      warnOnce(_warnedFieldIssues,
        `⚠ 📡 Subscribed Universes: token '${m.token}' — ${m.reason}. ` +
        'Type each universe separated by commas (e.g. 1, 2, 3).');
    }
  }
  applyUniverseSubscriptions({
    receiver,
    wanted: wantedUniverses,
    reason,
    onLog: (msg) => {
      console.log(`[sACN Bridge] ${msg}`);
      broadcastLog(msg, 'source');
    },
    onError: (msg) => {
      if (_warnedSubscriptionErrors.has(msg)) return;
      _warnedSubscriptionErrors.add(msg);
      console.warn(`[sACN Bridge] ${msg}`);
      broadcastLog(msg, 'warn');
    },
  });

  // Diff → close removed senders, create added ones.
  const nextKeys = new Set(relayRoutes.map(r => routeKey(r.universe, r.ip)));
  for (const [key, entry] of _routeEntries) {
    if (!nextKeys.has(key)) {
      // NEVER while the ARM's ship-dark blackout is in flight: those 3 all-zero
      // frames ARE the termination mechanism (the `sacn` package hardcodes
      // options=0, so E1.31's stream_terminated bit is unreachable and
      // `Sender.close()` is socket teardown only). Closing the socket out from
      // under them would leave the ship holding its last look until an unknown
      // device-side timeout — the exact frozen-ship outcome the zeros exist to
      // prevent. The arm's own post-blackout recompute closes them.
      if (_relayCloseHeld) continue;
      try { entry.sender.close(); } catch (e) {}
      _routeEntries.delete(key);
      console.log(`[sACN Bridge] Route removed: U${entry.universe} → ${entry.ip} (${reason})`);
      broadcastLog(`Relay route removed: U${entry.universe} → ${entry.ip}`, 'warn');
    }
  }
  for (const r of relayRoutes) {
    const key = routeKey(r.universe, r.ip);
    if (_routeEntries.has(key)) continue;
    const sender = new Sender({
      universe: r.universe,
      useUnicastDestination: r.ip,
      // Destination port only — reuseAddr would bind this sender to *:5568
      // and steal datagrams from our own Receiver (task 010).
      port: SACN_UDP_PORT,
      // RAW DMX ON THE WIRE (report 20260805_170, `_157` D1 / `_153` F1b).
      // Without this the package treats `payload[ch]` as a 0..100 PERCENT and
      // writes `inRange(value * 2.55)`, so every relayed byte ≥ 101 left as
      // 255. `defaultPacketOptions` is spread first inside `Sender.send()` and
      // `sendVia` never passes the flag, so it survives on every frame —
      // including the blackout zeros.
      defaultPacketOptions: { useRawDmxValues: true },
    });
    _routeEntries.set(key, {
      sender,
      universe: r.universe,
      ip: r.ip,
      lastErrorMsg: null,
      lastErrorLoggedAt: 0,
      errorsSinceLog: 0,
    });
    console.log(`[sACN Bridge] Route created: U${r.universe} → ${r.ip} (scenes: ${r.scenes.map(provenance).join(', ')}; ${reason})`);
    broadcastLog(`Relay route created: U${r.universe} → ${r.ip}`, 'source');
  }

  // Rebuild the universe-indexed view routeFrame reads. Mirror destinations are
  // deliberately ABSENT from it: an inbound frame on U2 must NOT be forwarded
  // raw to a box the mirror is composing for.
  outgoingSenders.clear();
  for (const entry of _routeEntries.values()) {
    if (!outgoingSenders.has(entry.universe)) outgoingSenders.set(entry.universe, new Map());
    outgoingSenders.get(entry.universe).set(entry.ip, entry);
  }

  // Mirror senders, diffed the same way and kept in their own map.
  //
  // NEVER while a blackout is in flight: `Sender.close()` in the `sacn` package
  // is socket teardown only (no stream_terminated bit — the package hardcodes
  // options=0), so the 3 all-zero frames ARE the termination mechanism, and
  // closing the socket out from under them would leave the box holding its last
  // composed look until an unknown device-side dmx.timeoutMs. The disarm runs
  // its own recompute after the blackout resolves, and that pass closes them.
  for (const [key, entry] of _mirrorEntries) {
    if (mirrorTargets.has(key)) continue;
    if (_mirrorDisarming) continue;
    try { entry.sender.close(); } catch (e) {}
    _mirrorEntries.delete(key);
    // Every per-gather map, not just `_mirrorDirty` (report 20260805_158
    // D-158-8): the disarm path already clears all of them, and an asymmetry
    // here is stale state waiting for a future caller to find.
    forgetMirrorGather(key);
    console.log(`[sACN Bridge] Bench mirror sender removed: U${entry.universe} → ${entry.ip} (${reason})`);
  }
  for (const [key, target] of mirrorTargets) {
    if (_mirrorEntries.has(key)) continue;
    _mirrorEntries.set(key, {
      sender: new Sender({
        universe: target.universe,
        useUnicastDestination: target.ip,
        port: SACN_UDP_PORT,
        // A DISTINCT, STABLE CID so the mirror is a different E1.31 SOURCE from
        // the output bridge and the relay (`_153` F2), and RAW DMX values on
        // the wire (report 20260805_170) — the composed buffer already holds
        // 0-255 DMX bytes, so without the flag the package would rescale them
        // by 2.55 and clip. `defaultPacketOptions` is spread first inside
        // Sender.send(), and `sendVia` never passes either key, so both survive
        // on every frame.
        defaultPacketOptions: { cid: MIRROR_CID, useRawDmxValues: true },
      }),
      universe: target.universe,
      ip: target.ip,
      lastErrorMsg: null,
      lastErrorLoggedAt: 0,
      errorsSinceLog: 0,
    });
  }

  // Mirror activation/deactivation is a big behavioural switch — say exactly
  // what changed, on every transition, to the console AND the monitor panel.
  const mirrorSig = _activeMirrors
    .map(m => `${m.scene}:${describeMirror(m.spec).join('|')}`).sort().join(';');
  if (mirrorSig !== _lastMirrorSig) {
    _lastMirrorSig = mirrorSig;
    if (_activeMirrors.length === 0) {
      console.log('[sACN Bridge] 🪞 Bench mirror INACTIVE — no scene is standing in for another ' +
        `(engine scene '${engineState.scene}', active scenes: ${activeScenes.join(', ') || 'none'}).`);
      broadcastLog('🪞 Bench mirror inactive', 'source');
    }
    for (const m of _activeMirrors) {
      console.log(`[sACN Bridge] 🪞 BENCH MIRROR ACTIVE — ${m.spec.label.toUpperCase()}: scene ` +
        `'${m.scene}' is showing '${m.spec.sourceScene}' fixtures. ${m.spec.note}`);
      for (const slot of (_mirrorArm ? _mirrorArm.slots : [])) {
        console.log(`[sACN Bridge] 🪞   ${slot.slot.padEnd(14)} ← ` +
          `${(slot.source || 'none').padEnd(22)} (${slot.summary})`);
      }
      for (const line of describeMirror(m.spec)) {
        console.log(`[sACN Bridge] 🪞   composes ${line}`);
      }
      broadcastLog(`🪞 Bench mirror ACTIVE — '${m.scene}' shows '${m.spec.sourceScene}'`, 'source');
    }
  }

  // ── _105 F10: suppression logs on ITS OWN signature ─────────────────────
  // This loop used to live inside the `mirrorSig` gate, so `mirrorSuppressed`
  // — recomputed every pass — was printed only when the MIRROR SET changed. A
  // relay route that changed hands under scene churn did so in silence. Same
  // shape as `excludedSig` below: derived from exactly what it prints.
  //
  // Under the bench-only ruling this is now the WHOLE relay set, so it is
  // summarised rather than printed one line per route — a 40-route ship would
  // otherwise bury the arm transition it is explaining.
  const suppressedSig = mirrorSuppressed
    .map(s => `${s.why}:${routeKey(s.universe, s.ip)}`).sort().join(',');
  if (suppressedSig !== _lastSuppressedSig) {
    _lastSuppressedSig = suppressedSig;
    if (mirrorSuppressed.length > 0) {
      const why = mirrorSuppressed[0].why;
      const named = mirrorSuppressed.map(s => `U${s.universe} → ${s.ip}`).join(', ');
      const hosts = new Set(mirrorSuppressed.map(s => s.ip)).size;
      if (why === 'armed') {
        console.log(`[sACN Bridge] ⛔ ALL ordinary relay SUSPENDED (${mirrorSuppressed.length} ` +
          `route(s) across ${hosts} controller(s), zeroed 3×) — the bench is the only physical ` +
          `output while armed. Suspended: ${named}`);
        broadcastLog(`⛔ ALL ship relay SUSPENDED (${mirrorSuppressed.length} routes) — ` +
          'bench mirror armed', 'warn');
      } else {
        console.log(`[sACN Bridge] 🚫 Relay held (${mirrorSuppressed.length} route(s)) — a BENCH ` +
          'MIRROR blackout is still in flight; the relay may not take anything back until the ' +
          'last all-zero frame has gone, or two writers would share a (universe, controller). ' +
          'Handed back the moment the blackout completes.');
        broadcastLog('🚫 Relay held — bench mirror blackout in flight', 'warn');
      }
    }
  }

  // Engine-owned suppressions: say WHAT was excluded and WHY, on every change.
  const excludedSig = excluded.map(e => routeKey(e.universe, e.ip)).join(',');
  if (excludedSig !== _lastExcludedSig) {
    _lastExcludedSig = excludedSig;
    for (const e of excluded) {
      console.log(`[sACN Bridge] 🚫 Relay suppressed: U${e.universe} → ${e.ip} — the engine delivers this universe to that controller ITSELF (declared in marsin_engine/config.yaml); relaying too would double-source it and flicker the fixture. (scenes: ${e.scenes.join(', ')})`);
      broadcastLog(`Relay suppressed U${e.universe} → ${e.ip}: engine owns this route`, 'warn');
    }
    if (excluded.length === 0 && excludedSig === '') {
      // nothing suppressed any more — no log needed beyond route transitions
    }
  }

  // Cross-scene conflicts: same universe → different controllers. All are
  // relayed (each scene's declaration is explicit intent) but this is almost
  // always two rigs' scenes active at once — shout about it.
  // A pair the mirror owns is no longer relayed, so it cannot contend for its
  // universe — drop it from the conflict report rather than warning about a
  // collision that suppression already resolved.
  const relayedIps = new Map();
  for (const r of relayRoutes) {
    if (!relayedIps.has(r.universe)) relayedIps.set(r.universe, new Set());
    relayedIps.get(r.universe).add(r.ip);
  }
  const conflicts = rawConflicts.filter(c => (relayedIps.get(c.universe) || new Set()).size > 1);

  const conflictSig = conflicts.map(c => `${c.universe}:${c.ips.join('|')}`).join(',');
  if (conflictSig !== _lastConflictSig) {
    _lastConflictSig = conflictSig;
    for (const c of conflicts) {
      console.warn(`[sACN Bridge] ⚠ Universe ${c.universe} is relayed to MULTIPLE controllers (${c.ips.join(', ')}) — two active scenes claim it. Check which scenes are open/pinned (active: ${activeScenes.join(', ')}).`);
      broadcastLog(`⚠ U${c.universe} relayed to multiple controllers: ${c.ips.join(', ')}`, 'warn');
    }
  }
}

// ── Engine poll: hardware follows the ENGINE's active scene ─────────────
// GET /status on the engine every ENGINE_POLL_MS. Reachability transitions
// are logged ONCE (not per poll). Unreachable engine ⇒ no engine-scene
// routes and no ownership suppression (no dual writer can exist then).
let _enginePollBusy = false;
async function pollEngineStatus() {
  if (_enginePollBusy) return; // never stack slow polls
  _enginePollBusy = true;
  const next = { reachable: false, scene: null, owned: new Set() };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ENGINE_POLL_MS - 500);
    const res = await fetch(`http://127.0.0.1:${ENGINE_PORT}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      if (j && j.service === 'marsin-engine') {
        next.reachable = true;
        next.scene = (typeof j.activeScene === 'string' && j.activeScene !== 'unknown') ? j.activeScene : null;
        next.owned = engineOwnedPairs(j.outputRouting);
        if (j.outputRouting === undefined) {
          // Older engine without the introspection field: suppression is
          // unavailable — warn on transition below via the signature change.
          next.ownedUnavailable = true;
        }
      }
    }
  } catch (e) { /* unreachable — reflected in next.reachable */ }
  _enginePollBusy = false;

  const sig = `${next.reachable}|${next.scene}|${[...next.owned].sort().join(',')}|${!!next.ownedUnavailable}`;
  const prevSig = `${engineState.reachable}|${engineState.scene}|${[...engineState.owned].sort().join(',')}|${!!engineState.ownedUnavailable}`;
  if (sig === prevSig) return;

  const prev = engineState;
  engineState = next;
  if (next.reachable !== prev.reachable) {
    if (next.reachable) {
      console.log(`[sACN Bridge] Engine reachable on :${ENGINE_PORT} — active scene '${next.scene}', ${next.owned.size} engine-owned route(s).`);
      broadcastLog(`Engine up — hardware routes follow scene '${next.scene}'`, 'source');
    } else {
      console.warn(`[sACN Bridge] ⚠ Engine on :${ENGINE_PORT} unreachable — engine-scene routes and dual-source suppression are OFF until it returns.`);
      broadcastLog('⚠ Engine unreachable — engine-scene relay routes off', 'warn');
    }
  } else if (next.scene !== prev.scene) {
    console.log(`[sACN Bridge] Engine active scene changed: '${prev.scene}' → '${next.scene}'.`);
    broadcastLog(`Engine scene → '${next.scene}'`, 'source');
  }
  if (next.ownedUnavailable && !prev.ownedUnavailable) {
    console.warn('[sACN Bridge] ⚠ Engine /status has no outputRouting field (older engine build) — cannot suppress engine-owned relay routes. Restart the engine on current code.');
    broadcastLog('⚠ Engine too old for dual-source suppression', 'warn');
  }
  // OUTSIDE the try above, and this whole function is an unawaited async
  // callback of `setInterval`. Anything that escapes `recomputeRoutes` here
  // becomes an UNHANDLED REJECTION, which modern Node turns into a process
  // exit — the input bridge dying every ENGINE_POLL_MS on a condition it is
  // supposed to merely report. `recomputeRoutes` reads scene YAML, resolves the
  // armed mapping and walks the client set, so it is not throw-free by
  // construction. Report 20260814_212.
  guardedRecompute('engine poll');
}

/**
 * Run a route recompute so that a defect inside it CANNOT kill the process.
 *
 * This is not a swallow: the failure is named at full volume and, if the bench
 * mirror is armed, the arm is released — the same loud auto-disarm an
 * unresolvable mapping already takes. What it refuses to do is let one bad
 * recompute end the only process that feeds the rig, because a dead router
 * leaves every mirrored box frozen on its last frame with no blackout.
 */
function guardedRecompute(reason) {
  try {
    recomputeRoutes(reason);
  } catch (err) {
    const why = `the route recompute ('${reason}') threw — ${err.message}`;
    console.error(`[sACN Bridge] ❌ ${why}\n${err.stack}`);
    broadcastLog(`❌ ${why}`, 'warn');
    if (_mirrorArm !== null && !blackoutInFlight()) {
      disarmInBackground(why, 'auto');
    }
  }
}
// NOTE: the boot-time recomputeRoutes / pollEngineStatus calls and the poll
// interval start at the BOTTOM of this file — they broadcast to the WS
// clients, so `wss` and `broadcastLog` must exist first.

// ── WebSocket Server ───────────────────────────────────────────────────
const wss = new WebSocketServer({ port: SACN_PORT });
let clientCount = 0;

// ── Client census broadcast (multi-window contention warning) ───────────
// >1 connected sim window is a production hazard (2026-07-24 operator
// decision): extra windows contend for the GPU and — in sacn_in mode — each
// is an independent prio-150 sACN writer to the hardware. Every transition
// is pushed to ALL clients as `{type:'clients', count}` so each window can
// show the HUD banner (src/gui/multi_client_warning.js), plus loud log +
// monitor lines here. Warning only — NO auto-kick: the writer-arbitration
// decision (report 20260724_15 §2.3 options i/ii/iii) belongs to the
// operator and must not be preempted.
let _lastCensusCount = 0;
function broadcastClientCensus() {
  const json = JSON.stringify({ type: 'clients', count: clientCount });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(json);
  });
  if (clientCount !== _lastCensusCount) {
    if (clientCount > 1) {
      console.warn(`[sACN Bridge] ⚠ ${clientCount} sim clients connected — hardware output contention risk (multiple windows can double-drive controllers and starve the GPU; close extra sim windows).`);
      broadcastLog(`⚠ ${clientCount} sim windows connected — hardware output contention risk`, 'warn');
    } else if (_lastCensusCount > 1) {
      console.log(`[sACN Bridge] ✅ Back to ${clientCount} sim client(s) — multi-window contention cleared.`);
      broadcastLog(`✅ Single sim window again — contention cleared`, 'source');
    }
    _lastCensusCount = clientCount;
  }
}

wss.on('connection', (ws) => {
  clientCount++;
  broadcastLog(`Browser connected (${clientCount} client(s))`, 'source');
  broadcastClientCensus();
  // A reloaded tab must never show stale BENCH MIRROR state: push the status to
  // EVERY new connection, exactly like the client census. Without this a page
  // reload during an armed session shows no banner while the hardware is still
  // re-addressed (report 20260804_150 §7).
  try {
    ws.send(JSON.stringify(benchMirrorStatus({ reason: 'status on connect' })));
  } catch (err) {
    console.warn(`[sACN Bridge] ⚠ Could not send the bench-mirror status to a new client: ` +
      `${err.message} — that window will show no BENCH MIRROR banner until the next transition.`);
  }

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'setScene' && data.scene) {
        // A client TAGS ITSELF with its scene. Its scene's routes join the
        // union (and its patches.yaml is re-read, so a just-saved patch
        // change lands — PatchManager.notifySacnBridge re-sends this after
        // every save). It can no longer clobber other scenes' routes: the
        // old last-writer-wins table let every titanic tab disconnect the
        // test_bench hardware (2026-07-24 freeze root cause).
        const prev = clientScenes.get(ws);
        clientScenes.set(ws, String(data.scene));
        console.log(`[sACN Bridge] Client tagged scene '${data.scene}'${prev && prev !== data.scene ? ` (was '${prev}')` : ''}`);
        recomputeRoutes(`client scene '${data.scene}'`);
      } else if (data.type === 'getRoutes') {
        // READ-ONLY route-table introspection (report 20260725_127): the LED
        // push's third check confirms its routes here instead of trusting its
        // own notify. Answered from the LIVE sender maps, to THIS client only.
        // Same-socket FIFO: a query sent after `setScene` on this socket is
        // handled after that recompute, so the reply is never the pre-save
        // table. No state is touched. The outer catch exists to ignore
        // non-JSON frames; a FAILED reply here must not vanish into it — the
        // client would time out with no trace of why.
        try {
          ws.send(JSON.stringify(buildRouteTableSnapshot({
            reqId: data.reqId,
            routeEntries: _routeEntries,
            mirrorEntries: _mirrorEntries,
            excluded: _lastExcluded,
            activeScenes: _lastActiveScenes,
          })));
        } catch (err) {
          console.warn(`[sACN Bridge] ⚠ getRoutes reply failed: ${err.message} — the querying ` +
            'client will time out its route read-back.');
        }
      } else if (data.type === 'benchMirrorOptions') {
        // ADVISORY picker data (report 20260805_155 §7.1): every slot, its
        // compatible candidates from the ENGINE's current scene, the sidecar
        // default and the REMEMBERED source + pixel order. Computed FRESH on every request and
        // trusted by nothing — the ARM re-resolves from disk in the same pass
        // that arms, so a scene edit between "picker opened" and "ARM clicked"
        // is caught there rather than assumed away here.
        try {
          ws.send(JSON.stringify(benchMirrorOptions(
            typeof data.scene === 'string' ? data.scene : null,
            data.reqId === undefined ? null : data.reqId)));
        } catch (err) {
          console.warn(`[sACN Bridge] ⚠ benchMirrorOptions reply failed: ${err.message} — the ` +
            'picker will time out.');
        }
      } else if (data.type === 'benchMirrorArm' || data.type === 'benchMirrorDisarm') {
        // The BENCH MIRROR runtime mode (reports 20260804_151, 20260805_155).
        // REPLY, never throw: a refusal thrown here would vanish into the outer
        // catch and the operator would see a button that did nothing.
        const run = data.type === 'benchMirrorArm'
          ? armBenchMirror(typeof data.scene === 'string' ? data.scene : null,
            (data.selection === undefined || data.selection === null) ? null : data.selection, ws)
          : disarmOnOperatorRequest();
        run.then((status) => {
          if (ws.readyState !== 1) return;
          ws.send(JSON.stringify({ ...status, reqId: data.reqId === undefined ? null : data.reqId }));
        }).catch((err) => {
          console.error(`[sACN Bridge] ❌ 🪞 ${data.type} failed: ${err.message}`);
          broadcastLog(`❌ 🪞 ${data.type} failed: ${err.message}`, 'warn');
          if (ws.readyState !== 1) return;
          ws.send(JSON.stringify(benchMirrorStatus({
            reqId: data.reqId === undefined ? null : data.reqId,
            refusal: `${data.type} failed: ${err.message}`,
          })));
        });
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    clientCount--;
    const scene = clientScenes.get(ws);
    clientScenes.delete(ws);
    broadcastLog(`Browser disconnected (${clientCount} client(s))`, 'warn');
    broadcastClientCensus();
    // The arm is SOCKET-SCOPED (operator ruling 2026-08-04): the window that
    // armed it going away — closed, reloaded, crashed — releases the hardware
    // cleanly.
    //
    // The scene-removal recompute below STILL RUNS in that case, and that is
    // safe only because of the blackout hold (`_blackoutHold`, report
    // 20260804_152 D1): `disarmBenchMirror` raises it synchronously before its
    // first `await`, so this pass suppresses every destination the blackout has
    // not finished releasing instead of re-creating an ordinary relay sender on
    // top of the zero frames. `clientScenes.delete(ws)` above has already run, so
    // both this pass and the disarm's own post-blackout pass see the departure.
    if (_mirrorArm && _mirrorArm.ws === ws) {
      disarmInBackground('the sim window that armed it disconnected', 'disconnect');
    }
    if (scene) recomputeRoutes(`client of scene '${scene}' disconnected`);
  });
  ws.on('error', (err) => console.error('[sACN Bridge] WS error:', err.message));
});

// ── sACN Receiver ──────────────────────────────────────────────────────
// The interface is resolved BEFORE the socket exists so a bad `sacn_interface`
// is a startup error with an inventory of the box, not a mystery EINVAL later.
const _sacnIface = resolveMulticastInterface({
  requested: SACN_INTERFACE,
  interfaces: os.networkInterfaces(),
});
for (const line of _sacnIface.report) console.log(`[sACN Bridge] ${line}`);
const IFACE_LABEL = _sacnIface.iface || 'OS default';

const receiver = new Receiver({
  universes: sacnOpts.universes,
  port: SACN_UDP_PORT,
  reuseAddr: true,
  // undefined = unchanged behavior (the OS routes the join); a configured
  // address pins every IP_ADD_MEMBERSHIP to that NIC.
  iface: _sacnIface.iface,
});

const LOCKOUT_MS = sacnOpts.lockoutMs;
const HIGH_PRIORITY = sacnOpts.highPriorityThreshold;

let activeSource = null;
let highPriorityActive = false;
let highPriorityTimer = null;
let packetCount = 0;
let lastLogTime = 0;

// Snapshot of what boot subscribed to. Must be taken BEFORE the first runtime
// subscription: the `sacn` package keeps the very array we handed its
// constructor and pushes into it, so `sacnOpts.universes` IS
// `receiver.universes` from here on.
const BOOT_UNIVERSES = new Set(sacnOpts.universes);
const _seenRuntimeUniverses = new Set();

// ── Receive-socket lifecycle (report 20260725_99) ──────────────────────────
// The `sacn` package reports every constructor-time `addMembership` failure as
// an 'error' event. With no listener, Node THROWS — which is how one bad
// multicast group used to kill the whole input bridge with a bare stack trace.
// Both outcomes below are loud; only a socket-level failure is fatal, matching
// the per-universe isolation `applyUniverseSubscriptions` already applies at
// runtime.
receiver.on('error', (err) => {
  const { fatal, message } = classifyReceiverError(err, IFACE_LABEL);
  if (!fatal) {
    console.error(`[sACN Bridge] ${message}`);
    broadcastLog(message, 'warn');
    return;
  }
  console.error(`[sACN Bridge] ❌ ${message}`);
  process.exit(1);
});

// The gate opens only after the package's own join loop has run. Node fires
// `listening` listeners in registration order and `socket.bind(port, cb)`
// registered that loop first, so by the time this runs every boot group is
// joined and `addUniverse` can no longer collide with it.
receiver.socket.on('listening', () => {
  const invariant = checkBootSubscriptionInvariant(BOOT_UNIVERSES, receiver.universes);
  if (!invariant.ok) {
    console.error(`[sACN Bridge] ❌ ${invariant.message}`);
    process.exit(1);
  }
  const replay = _bootGate.open();
  console.log(`[sACN Bridge] ✅ Receive socket listening on :${SACN_UDP_PORT} — ` +
    `${BOOT_UNIVERSES.size} multicast group(s) joined on ${IFACE_LABEL}.`);
  broadcastLog(`sACN input listening on :${SACN_UDP_PORT} — ${BOOT_UNIVERSES.size} universe(s) ` +
    `joined on ${IFACE_LABEL}`, 'source');
  if (replay) recomputeRoutes(replay);
});

// The old `universe > MAX_UNIVERSE` drop guard lived here and is RETIRED
// (report 20260725_58 §7.1). It could never fire — the Receiver drops every
// unsubscribed universe before the handler runs — and with runtime
// subscription it turned actively harmful: MAX_UNIVERSE was frozen at the
// boot list's largest entry, so the first frame on a newly subscribed U27
// would have been dropped by the very guard meant to explain drops. What
// replaces it is the positive signal: say so, once, when a universe that boot
// did NOT know about starts delivering.
receiver.on('packet', (packet) => {
  const priority = packet.priority || 100;
  const sourceKey = packet.sourceName || 'Unknown';
  const universe = packet.universe || 1;

  if (!BOOT_UNIVERSES.has(universe) && !_seenRuntimeUniverses.has(universe)) {
    _seenRuntimeUniverses.add(universe);
    console.log(`[sACN Bridge] ✅ First frame on U${universe} from '${sourceKey}' — runtime-subscribed after boot.`);
    broadcastLog(`✅ First frame on U${universe} (runtime-subscribed)`, 'source');
  }

  if (priority >= HIGH_PRIORITY) {
    if (!highPriorityActive || activeSource !== sourceKey) {
      const msg = `🔴 OVERRIDE — '${sourceKey}' (Priority ${priority}) in control.`;
      broadcastLog(msg, 'warn');
      highPriorityActive = true;
      activeSource = sourceKey;
    }
    clearTimeout(highPriorityTimer);
    highPriorityTimer = setTimeout(() => {
      const msg = `🟢 RELEASED — '${activeSource}' went silent for ${LOCKOUT_MS / 1000}s.`;
      broadcastLog(msg, 'source');
      highPriorityActive = false;
      activeSource = null;
    }, LOCKOUT_MS);
    // RAW DMX bytes, never `packet.payload` (that getter is a PERCENT view) —
    // see rawDmxPayload's header, report 20260805_170.
    routeFrame(universe, priority, rawDmxPayload(packet), packet.sequence);
  } else {
    if (!highPriorityActive) {
      if (activeSource !== sourceKey) {
        const msg = `🟡 ACTIVE — '${sourceKey}' (Priority ${priority}) forwarding.`;
        broadcastLog(msg, 'source');
        activeSource = sourceKey;
      }
      // RAW DMX bytes, never `packet.payload` (that getter is a PERCENT view) —
    // see rawDmxPayload's header, report 20260805_170.
    routeFrame(universe, priority, rawDmxPayload(packet), packet.sequence);
    }
  }

  packetCount++;
  const now = Date.now();
  if (now - lastLogTime > 5000) {
    if (packetCount > 0 && clientCount > 0) {
      const msg = `${packetCount} packets/5s from '${activeSource || 'none'}', ${clientCount} client(s)`;
      broadcastLog(msg, 'info');
    }
    packetCount = 0;
    lastLogTime = now;
  }
});

/**
 * Send a log message to all browser clients as JSON text.
 * Browser sacn_input_source.js will forward these to the monitor panel.
 */
function broadcastLog(msg, type) {
  if (wss.clients.size === 0) return;
  const json = JSON.stringify({ type: 'log', msg, level: type || 'info' });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(json);
  });
}

/**
 * Send one composed/relayed frame through a sender entry, with the per-target
 * error dedup both the relay and the bench mirror rely on: log on first
 * occurrence and on transition, then suppress identical errors and emit a
 * single heartbeat per RELAY_ERROR_LOG_INTERVAL_MS until the target recovers.
 * Without it an offline controller produces one `EHOSTDOWN` line per inbound
 * frame (≈30+/s).
 *
 * RETURNS the settled promise (it never rejects — the catch below is terminal)
 * so the bench-mirror disarm can AWAIT its blackout frames before the senders
 * are closed. On the relay's hot path the return value is ignored.
 *
 * @returns {Promise<void>}
 */
function sendVia(entry, payload, priority, label) {
  return entry.sender.send({ payload, sourceName: 'MarsinRelay Engine', priority })
    .then(() => {
      if (entry.lastErrorMsg) {
        const burst = entry.errorsSinceLog;
        const tail = burst > 0 ? ` (after ${burst} suppressed errors)` : '';
        console.log(`[sACN Bridge] ✅ Recovered ${label} U${entry.universe}→${entry.ip}${tail}`);
        entry.lastErrorMsg = null;
        entry.lastErrorLoggedAt = 0;
        entry.errorsSinceLog = 0;
      }
    })
    .catch(err => {
      const now = Date.now();
      const msg = err.message;
      if (msg !== entry.lastErrorMsg) {
        const transition = entry.lastErrorMsg ? ` (was: ${entry.lastErrorMsg})` : '';
        console.error(`[sACN Bridge] ⚠ ${label} error U${entry.universe}→${entry.ip}: ${msg}${transition}`);
        entry.lastErrorMsg = msg;
        entry.lastErrorLoggedAt = now;
        entry.errorsSinceLog = 0;
      } else if (now - entry.lastErrorLoggedAt >= RELAY_ERROR_LOG_INTERVAL_MS) {
        const suppressed = entry.errorsSinceLog;
        console.error(`[sACN Bridge] ⚠ ${label} still failing U${entry.universe}→${entry.ip}: ${msg} ` +
          `(${suppressed} suppressed in last ${Math.round((now - entry.lastErrorLoggedAt) / 1000)}s)`);
        entry.lastErrorLoggedAt = now;
        entry.errorsSinceLog = 0;
      } else {
        entry.errorsSinceLog++;
      }
    });
}
// ── BENCH MIRROR: arm, disarm, status, gate (reports 20260804_151, 20260805_155)
//
// The mode is a TEMPORARY, session-scoped stand-in: the engine stays on the ship
// scene it is running, the visible sim stays where it is, and while armed the
// BENCH IS THE ONLY PHYSICAL OUTPUT — the ordinary relay is suspended and no
// browser can transmit to hardware at all.
//
// EXACTLY ONE THING HERE WRITES TO DISK (design 20260806_174 §3.2): a successful
// ARM records the selection it just proved into
// `<benchScene>/bench_mirror_state.yaml`, atomically, through
// `writeBenchMirrorState` and nothing else. THE ARMED FLAG STILL NEVER
// PERSISTS — it is `_mirrorArm`, process memory, cleared on every start — and
// the state schema cannot express one.

/** A stable fingerprint of a COMPUTED mapping, for reuse + drift detection. */
function mirrorFingerprint(spec) {
  return JSON.stringify(spec.mirrors);
}

// ── ONE-WRITER IS NOW STRUCTURAL, NOT GATED (report 20260805_171) ──────────
//
// There used to be a control link to the sim's output bridge on :6972, and the
// ARM refused (R-23) unless that process acknowledged a gate command. Its only
// purpose was to silence the BROWSER's own priority-150 stream for the duration
// of an arm — the second writer that defeated the mirror's first physical test.
//
// That stream no longer exists. Operator ruling 2026-08-05: the browser is not
// the router. `src/dmx/sacn_output_client.js` is deleted, `animate.js` has no
// transmit path, and `server/sacn_output_bridge.js` holds no sACN sender at all
// — it can only refuse. So there is nothing left to gate, and the arm no longer
// has to prove a stream is being held shut: it is proving the absence of a
// capability, which is the stronger statement and needs no runtime handshake.
//
// What that absence is verified BY is source-level structure, in
// `tests/browser_transmit_absence.test.js` — the guarantee is that no code path
// exists, so the thing to check is the code, not a live ack.

/** Broadcast the current arm status to every connected client. */
function broadcastBenchMirrorStatus(extra) {
  const status = benchMirrorStatus(extra);
  if (wss.clients.size === 0) return status;
  const json = JSON.stringify(status);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(json);
  });
  return status;
}

/**
 * The wire shape both the reply and the broadcast use. `reqId` is added by the
 * reply path only. Built FRESH from live state on every call — there is no
 * cached status object, so a broadcast can never describe a bridge that has
 * since moved on. Real IPs are included ON PURPOSE: this is runtime state on
 * the operator's own screen, not a tracked document, and "armed" without naming
 * the boxes that changed hands is not actionable.
 */
function benchMirrorStatus(extra) {
  const { found, errors } = readBenchMirrorSpecs();
  const available = found
    .filter(f => f.spec.enabled === true)
    .map(f => ({ scene: f.scene, label: f.spec.label, slots: f.spec.slots.length }));
  const base = {
    type: 'benchMirrorStatus',
    armed: _mirrorArm !== null,
    // Drives every DISARMING… UI state. Broadcast at blackout START as well as
    // at completion, in BOTH directions (arm's ship-dark and disarm's release),
    // so no window offers a button the bridge would refuse.
    blackoutInFlight: blackoutInFlight(),
    scene: _mirrorArm ? _mirrorArm.scene : null,
    sourceScene: _mirrorArm ? _mirrorArm.sourceScene : null,
    label: _mirrorArm ? _mirrorArm.label : null,
    destinations: _mirrorArm ? _mirrorArm.destinations : [],
    // `reverse` rides the armed status because "which way round is this fixture
    // running" is not derivable from anything else on the operator's screen.
    selection: _mirrorArm ? _mirrorArm.slots.map(s => ({
      slot: s.slot, benchFixture: s.benchFixture, source: s.source, summary: s.summary,
      reverse: s.reverse === true, reverseApplicable: s.reverseApplicable === true,
    })) : [],
    suspendedRoutes: _mirrorArm ? _mirrorArm.suspendedRoutes : 0,
    warnings: [],
    refusal: null,
    reason: null,
    available,
    specErrors: errors.map(e => ({ scene: e.scene, message: e.message })),
    clientCount,
  };
  return { ...base, ...(extra || {}) };
}

/**
 * ADVISORY picker data for one scene: every slot, its compatible candidates from
 * the ENGINE's current scene, the sidecar default and the REMEMBERED choice
 * (source + pixel order) read fresh from `bench_mirror_state.yaml`.
 *
 * Trusted by NOTHING. The ARM re-resolves everything from disk in the same pass
 * that arms, so a scene edit between "picker opened" and "ARM clicked" is caught
 * there by name rather than assumed away here.
 *
 * STORED STATE IS VALIDATED HERE, LOUDLY (design 20260806_174 §3.3). Selections
 * are keyed by the ENGINE'S CURRENT SCENE, which is what makes a `titanic`
 * mapping structurally unable to surface under any other scene's session. Per
 * entry: a slot id the sidecar no longer declares becomes a payload warning and
 * is never applied; a source that no longer resolves becomes a per-row
 * `staleReason` quoting the stored name, with NOTHING pre-filled; a stored
 * `reverse: true` on a destination that cannot be reversed is reported and
 * dropped. The file is never edited by a read — it stands until the next
 * successful ARM overwrites its scene key.
 */
function benchMirrorOptions(scene, reqId) {
  const base = {
    type: 'benchMirrorOptions', reqId, scene, ok: false, refusal: null,
    label: null, sourceScene: engineState.scene, slots: [], warnings: [],
  };
  if (typeof scene !== 'string' || scene.trim() === '') {
    return { ...base, refusal: 'no scene named — the bridge never picks one for you' };
  }
  const { found, errors } = readBenchMirrorSpecs();
  const broken = errors.find(e => e.scene === scene);
  if (broken) {
    return { ...base, refusal: `${scene}/bench_mirror.yaml does not parse — ${broken.message}` };
  }
  const sidecar = found.find(f => f.scene === scene);
  if (!sidecar) return { ...base, refusal: `scene '${scene}' declares no bench_mirror.yaml` };
  base.label = sidecar.spec.label;
  if (engineState.reachable !== true || typeof engineState.scene !== 'string'
      || engineState.scene === '') {
    return { ...base, refusal: 'the engine is unreachable or reports no active scene, so there ' +
      'is no source scene to choose fixtures from' };
  }
  const resolution = resolveMirrorFor(scene, sidecar.spec, engineState.scene, null);
  // A refused DEFAULTS resolution is not a refusal for the picker: choosing
  // explicitly is exactly the way in. Re-resolve with an all-`none` selection so
  // the candidate lists are still computed.
  const withNone = resolution.ok ? resolution : resolveMirrorFor(scene, sidecar.spec,
    engineState.scene, Object.fromEntries(sidecar.spec.slots.map(
      s => [s.slot, { source: null, reverse: false }])));
  if (!withNone.ok) return { ...base, refusal: withNone.refusal };

  // ── The remembered selection, read FRESH and validated per entry ──────────
  const stored = readBenchMirrorState(BENCH_MIRROR_STATE_ROOT, scene);
  const warnings = [];
  if (stored.error !== null) warnings.push(stored.error);
  const rememberedSlots = sceneSelection(stored.state, engineState.scene);
  const declaredIds = new Set(withNone.slots.map(s => s.slot));
  for (const id of Object.keys(rememberedSlots)) {
    if (declaredIds.has(id)) continue;
    warnings.push(`${scene}/${BENCH_MIRROR_STATE_FILE} remembers a slot '${id}' that ` +
      `${scene}/bench_mirror.yaml no longer declares — ignored, never applied. The next ` +
      'successful ARM rewrites this scene key and drops it.');
  }

  return {
    ...base,
    ok: true,
    warnings,
    slots: withNone.slots.map((s) => {
      // A default that does not resolve in THIS source scene is reported as
      // null rather than silently swapped — the picker shows nothing
      // pre-selected and the operator chooses.
      const defaultSource = s.candidates.some(c => c.name === s.defaultSource)
        ? s.defaultSource : null;
      const entry = Object.prototype.hasOwnProperty.call(rememberedSlots, s.slot)
        ? rememberedSlots[s.slot] : null;
      let storedSource = null;
      let reverse = false;
      let staleReason = null;
      if (entry !== null) {
        if (entry.source !== null && !s.candidates.some(c => c.name === entry.source)) {
          staleReason = `stored source '${entry.source}' no longer resolves against ` +
            `'${engineState.scene}' for this slot — it is not among its ${s.candidates.length} ` +
            'compatible candidate(s). Nothing was pre-filled; pick again. (The stored value is ' +
            'kept until the next successful ARM.)';
        } else {
          storedSource = entry.source;
          reverse = entry.reverse;
        }
        if (reverse === true && s.reverseApplicable !== true) {
          staleReason = `stored reverse: true, but '${s.benchFixture}' cannot be reversed ` +
            '(a single-pixel fixture, or a definition whose per-pixel channel maps do not ' +
            'validate). REVERSED was not pre-filled.';
          reverse = false;
        }
      }
      return {
        slot: s.slot,
        benchFixture: s.benchFixture,
        kind: s.kind,
        fixtureType: s.fixtureType,
        footprintCh: s.footprintCh,
        pixelCount: s.pixelCount,
        dest: s.dest,
        defaultSource,
        // The VALIDATED prefill pair. `stored` is the RAW entry as the file
        // holds it, so a stale row can show the operator what was remembered
        // next to the reason it was not applied.
        storedSource,
        reverse,
        reverseApplicable: s.reverseApplicable,
        stored: entry === null ? null : { source: entry.source, reverse: entry.reverse },
        staleReason,
        candidates: s.candidates,
      };
    }),
  };
}

/**
 * Blackout + release. THE ORDER IS THE FEATURE.
 *
 * 1. clear the flag and the active mirrors SYNCHRONOUSLY, and RAISE THE BLACKOUT
 *    HOLD, so nothing composes another frame while this runs and no recompute
 *    that lands mid-blackout — from any caller — can hand a still-blacking-out
 *    destination back to the ordinary relay (report 20260804_152 D1);
 * 2. send BLACKOUT_FRAMES all-zero 512-channel frames to every owned bench
 *    destination and AWAIT them. This is mandatory: the `sacn` package cannot
 *    set E1.31's stream_terminated bit and `Sender.close()` only closes the
 *    socket, so without it the LED box's outputs hold their last composed look
 *    until an unknown device-side `dmx.timeoutMs` (0 = forever);
 * 3. drop the hold, THEN recompute — which closes the mirror senders and
 *    restores the ENTIRE relay set in the same pass, so the ship starts being
 *    fed live frames again immediately (no zeros needed on that side);
 * 4. UNGATE :6972, so the sim's own output path resumes.
 *
 * @param {string} reason human sentence, printed and broadcast
 * @param {'operator'|'auto'|'disconnect'|'shutdown'} how
 * @returns {Promise<Object>} the post-disarm status
 */
async function disarmBenchMirror(reason, how) {
  // A disarm that lands while the ARM's ship-dark blackout is still going out
  // must not race it. Internal callers WAIT (an auto-disarm that refused would
  // leave the bridge armed with nobody to press the button); the operator's own
  // DISARM is refused instead, symmetric with `_152` D2's ARM refusal.
  if (_armBlackoutInFlight) {
    await Promise.resolve(_blackoutSettled).catch(() => {});
  }
  if (_mirrorArm === null) {
    return broadcastBenchMirrorStatus({ reason: `already disarmed (${reason})` });
  }
  const was = _mirrorArm;
  const entries = [..._mirrorEntries.values()];
  _mirrorArm = null;
  _mirrorDisarming = true;
  // Raised BEFORE the first await, in the same synchronous turn that clears the
  // arm — otherwise a recompute in between sees neither the arm nor the hold.
  _blackoutHold = { scene: was.scene };
  _activeMirrors = [];
  _mirrorDirty.clear();
  _mirrorRegionSeq.clear();
  _mirrorEmitSeq.clear();
  _mirrorIncompleteSince.clear();
  _mirrorStallWarned.clear();
  _mirrorMisaligned.clear();
  _mirrorMisalignTotal.clear();
  _mirrorLastWholeAt.clear();
  _mirrorTearWindow.clear();
  setDarkTick(false);
  // The port-cleanup interlock is released HERE — in the same synchronous turn
  // the arm is cleared, before the blackout is even scheduled — so there is no
  // window in which a disarmed bridge still looks armed to a port sweep.
  releaseArmInterlock(`disarming (${how})`);

  // The `try` opens HERE — immediately after the hold is raised — not just
  // around the await (report 20260804_152 RESIDUAL-1). The two log calls below
  // can throw: `broadcastLog` walks `wss.clients` and `ws.send()` throws on a
  // socket in transition, which is exactly the state of the socket-close disarm
  // path. A throw between the raise and the `finally` would leak `_blackoutHold`
  // FOREVER — the ordinary relay would stay suppressed until the process
  // restarted, leaving every controller unfed. Everything after the raise is
  // inside the guard.
  try {
    const named = entries.map(e => `U${e.universe} → ${e.ip}`).join(', ') || 'none';
    console.log(`[sACN Bridge] 🪞 BENCH MIRROR DISARMING (${how}) — ${reason}. Sending ` +
      `${BLACKOUT_FRAMES}× all-zero frames to ${named} before releasing the senders.`);
    broadcastLog(`🪞 BENCH MIRROR disarming — ${reason}`, 'warn');
    broadcastBenchMirrorStatus({ reason: `disarming: ${reason}` });

    // An async IIFE never throws synchronously — a throw inside it becomes a
    // rejection of `_blackoutSettled`, which the await below turns into a throw
    // this same `finally` covers.
    _blackoutSettled = (async () => {
      for (let i = 0; i < BLACKOUT_FRAMES; i += 1) {
        await Promise.all(entries.map((entry) => sendVia(
          entry, zeroDmxPayload(), MIRROR_PRIORITY, 'Bench mirror blackout')));
      }
    })();
    await _blackoutSettled;
  } finally {
    _mirrorDisarming = false;
    _blackoutHold = null;
    _blackoutSettled = null;
    _relaySuspended = false;
  }

  recomputeRoutes(`bench mirror disarmed (${how}): ${reason}`);

  console.log(`[sACN Bridge] 🪞 BENCH MIRROR DISARMED — ${was.scene} → ${was.sourceScene} ` +
    'released. The FULL ordinary relay is back: every ship controller is being fed live frames ' +
    'again, and the bench gateway is fed RAW ' + `${was.sourceScene} bytes (lit, wrong fixtures — ` +
    'that is the ordinary single-scene shape, not a mirror bug). Senders recreated on a disarm ' +
    'restart their E1.31 sequence at 0, so a brief settle at the boxes is expected; a sustained ' +
    'one is not.');
  broadcastLog('🪞 BENCH MIRROR DISARMED — full ordinary relay restored', 'source');
  return broadcastBenchMirrorStatus({ reason });
}

/**
 * The operator's own DISARM. Refused while the ARM's ship-dark blackout is still
 * in flight — symmetric with `_152` D2's ARM refusal, and the reason the UI
 * disables the button on `blackoutInFlight`.
 */
function disarmOnOperatorRequest() {
  if (_armBlackoutInFlight) {
    const refusal = 'DISARM refused: the ARM\'s ship-dark blackout is still in flight — its ' +
      'all-zero frames have not finished going out. Wait for the ARMED line and disarm again.';
    console.warn(`[sACN Bridge] ⚠ 🪞 ${refusal}`);
    broadcastLog(`⚠ 🪞 ${refusal}`, 'warn');
    return Promise.resolve(benchMirrorStatus({ refusal }));
  }
  return disarmBenchMirror('the operator pressed DISARM', 'operator');
}

/**
 * Fire-and-forget a disarm from a synchronous caller.
 *
 * `disarmBenchMirror` CAN reject — `broadcastLog` walks the client set and
 * `ws.send()` throws on a socket in transition (report 20260804_152
 * RESIDUAL-1). A bare `void` on the promise would make that an UNHANDLED
 * rejection, which modern Node turns into a process exit: the bridge would die
 * on the very path that is trying to release the hardware cleanly. The blackout
 * hold is already released by the disarm's own `finally`, and the caller's own
 * recompute restores the relay — so the correct behaviour here is to SHOUT,
 * never to swallow.
 */
function disarmInBackground(reason, how) {
  disarmBenchMirror(reason, how).catch((err) => {
    console.error(`[sACN Bridge] ❌ 🪞 BENCH MIRROR disarm (${how}) FAILED: ${err.message}. ` +
      'The blackout hold has been released and the ordinary relay resumes, so nothing is left ' +
      'unfed — but the all-zero frames may not all have gone out. If a mirrored destination is ' +
      'holding a frozen look, re-arm and disarm again.');
  });
}

/**
 * Arm for `scene`, or refuse with a named reason. Never throws — a refusal that
 * escaped into the WS handler's outer catch would leave the operator with a
 * button that did nothing and no trace of why.
 *
 * ORDER (report 20260805_155 §15.A2): state checks → resolution → GATE :6972 and
 * await its ack → suspend + zero the ship → recompute → ownership proof.
 *
 * @param {string} scene
 * @param {Object|null} selection `{ slotId: {source: string|null, reverse: boolean} }`, or null =
 *        the sidecar defaults with every slot NORMAL. The pre-`_176` flat shape
 *        is REFUSED by name in the resolver (R-24) — no dual-shape parser.
 * @param {Object} ws the socket making the request — the arm is scoped to it
 * @returns {Promise<Object>} status (with `refusal` set when refused)
 */
async function armBenchMirror(scene, selection, ws) {
  const { found, errors } = readBenchMirrorSpecs();

  // Destination pairs OTHER enabled sidecars resolve onto, so R-11 compares
  // computed claims rather than declared text. Best effort: a sidecar that does
  // not resolve cannot be armed either, so it cannot become a second writer.
  const otherClaims = [];
  if (engineState.reachable === true && typeof engineState.scene === 'string') {
    for (const other of found) {
      if (other.scene === scene || other.spec.enabled !== true) continue;
      const r = resolveMirrorFor(other.scene, other.spec, engineState.scene, null);
      if (r.ok) otherClaims.push({ scene: other.scene, pairs: mirrorDestPairs(r.spec) });
    }
  }

  const verdict = evaluateArmRequest({
    scene,
    specs: found,
    specErrors: errors,
    engineState,
    activeArm: _mirrorArm,
    // _152 D2: a blackout in flight has already nulled `_mirrorArm`, so the
    // "already armed — disarm first" branch cannot see it. This is what keeps a
    // re-arm going THROUGH the blackout rather than around it. Covers BOTH
    // directions now — the arm's ship-dark blackout as well as a disarm's.
    blackoutInFlight: blackoutInFlight(),
    otherClaims,
    relayRoutes: _lastRelayRoutes,
    clientCount,
  });
  const refuseArm = (refusal, warnings) => {
    console.warn(`[sACN Bridge] ⚠ 🪞 ${refusal}`);
    broadcastLog(`⚠ 🪞 ${refusal}`, 'warn');
    return benchMirrorStatus({ refusal, warnings: warnings || [] });
  };
  if (!verdict.ok) return refuseArm(verdict.refusal, verdict.warnings);

  // ── Resolution: R-12 … R-19, R-22b/c ──────────────────────────────────────
  const sidecar = found.find(f => f.scene === scene);
  const resolution = resolveMirrorFor(scene, sidecar.spec, verdict.sourceScene, selection);
  if (!resolution.ok) return refuseArm(resolution.refusal, verdict.warnings);
  const computed = resolution.spec;
  const destinations = mirrorDestPairs(computed);
  const warnings = [...verdict.warnings, ...resolution.warnings];

  // ── R-11: a REAL intersection, now that our own pairs exist ───────────────
  const overlap = evaluateClaimOverlap({ scene, destinations, otherClaims });
  if (overlap) return refuseArm(overlap, warnings);

  // ── Ship goes DARK, deterministically, before the mirror takes over ───────
  // `_relaySuspended` stops raw relaying in the SAME synchronous turn the arm is
  // recorded, so no raw frame can interleave with the zeros. `_relayCloseHeld`
  // keeps the retiring senders open until the zeros have landed.
  const retiring = [..._routeEntries.values()];
  _relaySuspended = true;
  _relayCloseHeld = true;
  _armBlackoutInFlight = true;
  _mirrorArm = {
    scene,
    sourceScene: verdict.sourceScene,
    label: verdict.label,
    selection: selection === null ? null : { ...selection },
    spec: computed,
    fingerprint: mirrorFingerprint(computed),
    slots: resolution.slots,
    destinations,
    suspendedRoutes: retiring.length,
    armedAt: new Date().toISOString(),
    ws,
  };
  // Claimed in the SAME synchronous turn the arm is recorded — the ship-dark
  // blackout below takes real time, and a port sweep landing inside it would
  // freeze the boxes exactly as badly as one landing an hour later.
  const interlockWarning = claimArmInterlock(_mirrorArm);
  if (interlockWarning !== null) warnings.push(interlockWarning);

  try {
    console.log(`[sACN Bridge] 🪞 BENCH MIRROR ARMED — ${verdict.label.toUpperCase()} ` +
      `('${verdict.sourceScene}' → '${scene}'). Owned destinations: ` +
      `${destinations.map(d => `U${d.universe} → ${d.ip}`).join(', ')}.`);
    for (const slot of resolution.slots) {
      console.log(`[sACN Bridge] 🪞   ${slot.slot.padEnd(14)} ← ` +
        `${(slot.source || 'none').padEnd(22)} ` +
        `${(slot.reverse ? 'REVERSED' : 'NORMAL  ')} (${slot.summary})`);
    }
    for (const w of warnings) console.warn(`[sACN Bridge] ⚠ 🪞   ${w}`);
    broadcastLog(`🪞 BENCH MIRROR ARMED — ${verdict.label}`, 'warn');
    broadcastBenchMirrorStatus({ reason: `arming: zeroing ${retiring.length} ship route(s)` });

    console.log(`[sACN Bridge] ⛔ SHIP GOING DARK — ${BLACKOUT_FRAMES}× all-zero frames to ` +
      `${retiring.length} suspended relay route(s) before their senders close. Dark, not frozen: ` +
      'a gateway has no timeout and the LED boxes may hold their last look forever, which reads ' +
      'as alive to a passerby and as a bug to you.');
    _blackoutSettled = (async () => {
      for (let i = 0; i < BLACKOUT_FRAMES; i += 1) {
        await Promise.all(retiring.map((entry) => sendVia(
          entry, zeroDmxPayload(), BLACKOUT_DEFAULT_PRIORITY, 'Ship blackout')));
      }
    })();
    await _blackoutSettled;
  } finally {
    _armBlackoutInFlight = false;
    _relayCloseHeld = false;
    _blackoutSettled = null;
  }

  recomputeRoutes(`bench mirror armed for '${scene}'`);

  // ── PROOF, not intent (report 20260804_150 §12.4) ───────────────────────
  // Re-read the LIVE sender maps through the same snapshot the LED push's
  // read-back uses: every owned pair must be a mirror sender and must appear in
  // neither the relay table nor the engine-owned set, and NO ordinary relay
  // sender may survive at all (bench-only). If it cannot be PROVEN, disarm.
  //
  // "The bench is the only physical output" used to have two halves — the
  // bridge's own relay set, and the sim's :6972 path — and D-158-1 was a gate
  // lost inside the ship-dark blackout producing an arm that reported success
  // while the ship was reachable again at priority 150. The second half is now
  // STRUCTURAL: no browser can transmit, so there is no gate to lose and no
  // window in which to lose it. What remains to prove here is the relay set,
  // which is what this snapshot has always measured.
  const snapshot = buildRouteTableSnapshot({
    reqId: null,
    routeEntries: _routeEntries,
    mirrorEntries: _mirrorEntries,
    excluded: _lastExcluded,
    activeScenes: _lastActiveScenes,
  });
  const mirrorSet = new Set(snapshot.mirrorOwned.map(p => routeKey(p.universe, p.ip)));
  const relaySet = new Set(snapshot.routes.map(p => routeKey(p.universe, p.ip)));
  const engineSet = new Set(snapshot.engineOwned.map(p => routeKey(p.universe, p.ip)));
  const unproven = [];
  for (const d of destinations) {
    const key = routeKey(d.universe, d.ip);
    if (!mirrorSet.has(key)) unproven.push(`${key} has no mirror sender`);
    if (relaySet.has(key)) unproven.push(`${key} is ALSO an ordinary relay route`);
    if (engineSet.has(key)) unproven.push(`${key} is ALSO engine-owned`);
  }
  if (relaySet.size > 0) {
    unproven.push(`${relaySet.size} ordinary relay route(s) survived the arm ` +
      `(${[...relaySet].slice(0, 6).join(', ')}${relaySet.size > 6 ? ', …' : ''}) — while armed ` +
      'the bench must be the ONLY physical output');
  }
  if (unproven.length > 0) {
    const why = `ownership could not be proven after the recompute: ${unproven.join('; ')}`;
    console.error(`[sACN Bridge] ❌ 🪞 BENCH MIRROR ARM FAILED — ${why}.`);
    broadcastLog(`❌ 🪞 BENCH MIRROR arm failed — ${why}`, 'warn');
    const after = await disarmBenchMirror(why, 'auto');
    return { ...after, refusal: `ARM refused: ${why}`, warnings };
  }

  // ── Remember the selection: the ONE state-file write in this bridge ───────
  //
  // ON ARM SUCCESS ONLY — this is the single moment a selection is PROVEN
  // resolvable against the live scenes AND proven to own its hardware. Picker
  // browsing writes nothing, so a file on disk always describes something that
  // actually ran.
  //
  // A write failure does NOT unwind the arm: the hardware has already changed
  // hands and the composed frames are already going out, so throwing here would
  // trade a remembered selection for a live mirror. It is reported instead — in
  // the log, in the monitor and in the returned status's warnings — never
  // swallowed.
  try {
    const existing = readBenchMirrorState(BENCH_MIRROR_STATE_ROOT, scene);
    if (existing.error !== null) {
      console.warn(`[sACN Bridge] ⚠ 🪞 ${existing.error} This ARM is REWRITING the file from ` +
        'the selection that just armed.');
      warnings.push(existing.error);
    }
    const next = setSceneSelection(existing.state, verdict.sourceScene,
      Object.fromEntries(resolution.slots.map(s => [s.slot,
        { source: s.source, reverse: s.reverse === true }])));
    const written = writeBenchMirrorState(BENCH_MIRROR_STATE_ROOT, scene, next);
    console.log(`[sACN Bridge] 🪞 selection remembered under selections.${verdict.sourceScene} ` +
      `→ ${written.path} (${written.bytes} B, atomic). It pre-fills the picker next time and ` +
      'cannot arm anything by itself.');
  } catch (e) {
    const why = `the selection could NOT be remembered — ${e.message} The mirror is armed and ` +
      'running; only the picker pre-fill is lost.';
    console.error(`[sACN Bridge] ❌ 🪞 ${why}`);
    broadcastLog(`❌ 🪞 ${why}`, 'warn');
    warnings.push(why);
  }

  return broadcastBenchMirrorStatus({
    warnings,
    reason: `armed by an operator gesture at ${_mirrorArm.armedAt}`,
  });
}

// ── Composition cadence: ONE composed frame per destination per ENGINE FRAME ─
//
// THE DEFECT THIS CLOSES (report 20260805_153 §10). The old flush coalesced over
// one libuv POLL PHASE, not one engine frame. The engine's five source datagrams
// do not reliably land in a single poll phase, so a destination composed from
// three of them emitted 1 to 3 times per engine frame, and 50-67 % of those
// frames carried a region belonging to the PREVIOUS frame — sub-frame TEARING.
// Worse, the varying emission rate made the sequence offset against any other
// writer on the same universe drift through all 256 values every few seconds, so
// an E1.31 receiver's out-of-order discard turned it into multi-second beats of
// sane-then-garbage. Single-source destinations were structurally immune, which
// is exactly why the DMX gateway flickered and the LED strands did not.
//
// THE RULE: a destination is emitted only when EVERY source universe its slices
// read has contributed since the last emission, AND every one of those
// contributions belongs to the SAME gather. No timeout-emit fallback (codex P0):
// a stalled source stops that destination's emission and is REPORTED by name,
// rather than being papered over with a half-fresh frame.
//
// FRAME IDENTITY, not merely presence (report 20260805_158 D-158-3). The
// presence-only gate answered "have all my sources arrived?" but never "did they
// all arrive for the SAME engine frame?". Lose one source datagram while the
// engine's datagrams are split across poll phases — the exact arrival pattern
// this rule exists for — and the gather boundary shifts by one source
// permanently: the destination completes every frame, emits 1.00 times per
// frame, passes every count-based assertion, and carries one region that is one
// engine frame stale FOREVER, with zero log output. That symptom is a STEADY
// WRONG REGION, not flicker, so the smoke procedure's "flicker => second writer"
// rule would not catch it either.
//
// The fix needs a real frame identity, and E1.31 already carries one: the
// per-universe SEQUENCE NUMBER. The engine's senders are created together and
// each advances once per universe per frame, so within one engine frame every
// universe carries the SAME sequence — and a lost datagram does not shift that,
// it simply leaves one region holding an older sequence until the next frame
// arrives.
//
// THE RULE, therefore, in one line: a destination is emitted when every source
// it reads has contributed AND all their contributions carry the SAME sequence.
//
// That is exact, needs no baseline and no calibration, and self-heals: in the
// lost-datagram case the region that missed a frame simply keeps its older
// sequence, the destination is not emitted for that frame, and the very next
// frame realigns every region. Compare the old presence-only gate, which
// completed the gather on the FIRST arrival of the next frame and emitted it
// with two regions still one frame behind — 1.00 sends/frame, every count-based
// assertion green, one region permanently stale, and zero log output.
//
// NOTHING IS EMITTED WHILE MISALIGNED, and misalignment is REPORTED by the same
// watchdog that reports a missing source (codex P0: no fallback emission of
// guessed data). The symptom this protects against is a STEADY WRONG REGION,
// not flicker, so it would not be caught by the smoke procedure's
// "flicker => second writer" rule — which is exactly why it has to be
// impossible to miss in the log instead.
// destKey → Map<source universe, the sACN sequence of the datagram whose bytes
// currently occupy that region of the composed buffer>. Never cleared while the
// destination lives: it describes the BUFFER, and the buffer is not cleared
// either.
const _mirrorRegionSeq = new Map();
const _mirrorEmitSeq = new Map();          // destKey → the aligned sequence last emitted
const _mirrorIncompleteSince = new Map();  // destKey → ms timestamp of first incompleteness
const _mirrorStallWarned = new Map();      // destKey → the last-warned signature
// destKey → { count, since, lastLoggedAt, flushes, offsetSets, announcedFixed }
const _mirrorMisaligned = new Map();
// The HONEST scale of a destination's misalignment (report 20260814_212).
// `_mirrorMisaligned` is deleted the moment a destination composes one whole
// frame — correct for the stuck DISCRIMINATOR, since a destination that
// realigns and emits is not stuck, and the immediate `count === 1` line is a
// deliberate ruling (D-158-3: misalignment is reported at once, never after a
// settling window). But `count` is also what the log REPORTS, so a destination
// flapping between aligned and misaligned printed "1 frame(s) so far" over and
// over: in the incident 1594 of 1627 lines each claimed to be the first, and
// nothing on screen revealed that the same destination had in fact failed to
// compose hundreds of times. The per-run count still drives the diagnosis; this
// cumulative one makes the line tell the truth about the scale. Cleared only
// when the destination is forgotten.
const _mirrorMisalignTotal = new Map();    // destKey → cumulative misaligned flushes
/**
 * When each destination last composed a WHOLE frame (report 20260815_233 F2).
 *
 * THIS IS THE STUCK DISCRIMINATOR. A destination whose sources are at a genuine
 * fixed offset composes ZERO whole frames — that is what "stuck" means and it is
 * the only property the two candidate causes do not share. A burst-torn read
 * composes one between every tear (measured: `count in this run` was 1 in ALL
 * 975 misaligned lines of the `_229` session, never 2), so this timestamp keeps
 * moving and STUCK can never fire on it.
 *
 * Seeded on the first misaligned flush of a destination that has never composed
 * one, because that is when the measurement starts — not a fallback value: it is
 * the earliest instant at which "no whole frame since" can be true.
 */
const _mirrorLastWholeAt = new Map();      // destKey → ms of the last whole composition
/**
 * The rate-limited tear ROLLUP (report 20260815_233 F4). 975 immediate `⚠`
 * lines in 3h43m for a 0.6 % tear rate is noise that buried the real signal, so
 * a run shorter than the settling grace is counted here and summarised, never
 * printed one line at a time.
 */
// destKey → { tears, worst, longestRun, wholeFrames, since, lastSummaryAt }
const _mirrorTearWindow = new Map();
//
// NOT DONE, DELIBERATELY (report 20260815_233, `_229` F6): a one-deep staging
// slot per region, keyed by sequence, so a datagram for frame N+1 cannot
// overwrite frame N before N has had its chance to compose. It would erase the
// residual ~0.6 % drop, and it was skipped because the cost is in the wrong
// place: every region would carry two buffers and the flush would have to
// decide WHICH generation it is composing, which is the one path in this file
// that must stay trivially provable ("every region carries the same sequence,
// or nothing goes out"). The drop is one frame per ~4 s, invisible on lights,
// and now costs one summary line per 10 s instead of 975 warnings per session.
// Revisit only if a dropped frame ever becomes visible.
const MIRROR_STALL_WARN_MS = 250;
/**
 * The settling grace a TORN read gets — the same one a MISSING source already
 * had (report 20260815_233 F4).
 *
 * `_158` D-158-3 ruled that misalignment is reported at once, never after a
 * settling window, on the grounds that regions disagreeing about which frame
 * they are is "never normal". `_229` measured it and it is normal: the engine
 * writes all 38 universes in ONE synchronous burst, and a libuv poll phase that
 * delivers part of that burst leaves the destination reading `{N+1, N, N}` for
 * the few milliseconds until the rest lands. That is the identical situation the
 * missing-source branch already calls NORMAL, seen a frame later. So it gets the
 * identical grace, and D-158-3 is superseded on this point only: a tear that
 * OUTLIVES the grace is still reported immediately-on-detection and loudly.
 */
const MIRROR_TEAR_GRACE_MS = MIRROR_STALL_WARN_MS;
/** How often a destination may print its burst-skew rollup. */
const MIRROR_TEAR_SUMMARY_MS = 10000;
const MIRROR_MISALIGN_LOG_INTERVAL_MS = 2000;
/**
 * How many CONSECUTIVE misaligned flushes a fixed offset must survive before it
 * counts as persistent rather than transient.
 *
 * This is one of THREE conditions, and on its own it proves nothing — six
 * consecutive torn reads under CPU load is exactly what fired 47 of the 48 false
 * STUCK lines in the `_229` session. It is joined by "the offset pattern is
 * literally FIXED" (below) and "no whole frame has composed at all" (above).
 */
const MIRROR_FIXED_OFFSET_FLUSHES = 6;
/**
 * The smallest offset magnitude that may be called FIXED (report 20260815_233
 * F1).
 *
 * A one-frame skew is the DEFINITION of a torn read of one frame's datagram
 * burst — 850 of the 975 misalignments in the `_229` session had a circular
 * spread of exactly 1. A real sender offset is the number of frames that elapsed
 * between two sender constructions, i.e. a large arbitrary constant. So ±1 is
 * refused the name unconditionally.
 */
const MIRROR_MIN_FIXED_OFFSET = 2;
/**
 * How long a destination must compose NO whole frame before STUCK may fire.
 *
 * At 40 fps this is ~40 consecutive refused frames with not one composition in
 * between. A burst tear cannot reach it (it composes every ~25 ms); a genuine
 * offset never leaves it.
 */
const MIRROR_STUCK_NO_WHOLE_MS = 1000;
/**
 * Distinct offset values kept per source while judging "is this offset FIXED".
 *
 * The only question asked of the set is whether it is a SINGLETON, so the answer
 * is decided the moment a second value appears and can never change back. Capped
 * so a long stall costs the same as a short one — the O(1)-in-stall-length
 * property `_212` pinned.
 */
const MIRROR_OFFSET_SET_CAP = 2;

/**
 * A held-dark mapping (EVERY slot `none`) reads no source universe at all, so
 * there is no inbound frame to ride and nothing would ever tick. The operator
 * ruling is that an unselected destination is ACTIVELY held dark — composed as
 * zeros — not merely unwritten, and "unwritten" on a DMX gateway or a MarsinLED
 * box means the last look is held indefinitely.
 *
 * So in that one degenerate shape the flush is driven by a timer instead, at the
 * engine's frame rate. This is NOT a timeout-emit fallback: nothing is guessed
 * and no source is waited on — the frame is all-zero by construction, which is
 * the whole content of the operator's instruction.
 */
const DARK_TICK_MS = 25;                   // 40 fps, the engine's frame rate
let _darkTickTimer = null;
/** E1.31 sequence numbers are a single byte and wrap. */
const SACN_SEQUENCE_MODULUS = 256;

/**
 * Start/stop the held-dark ticker. Started only for a mapping with NO source
 * universes anywhere; every other shape rides the engine's own frames.
 */
function setDarkTick(active) {
  if (active && _darkTickTimer === null) {
    _darkTickTimer = setInterval(() => {
      if (_activeMirrors.length === 0) return;
      for (const m of _activeMirrors) {
        for (const t of m.state.targets) _mirrorDirty.add(t.key);
      }
      if (_mirrorDirty.size === 0 || _mirrorFlushScheduled) return;
      _mirrorFlushScheduled = true;
      setImmediate(flushMirrors);
    }, DARK_TICK_MS);
    if (_darkTickTimer.unref) _darkTickTimer.unref();
    return;
  }
  if (!active && _darkTickTimer !== null) {
    clearInterval(_darkTickTimer);
    _darkTickTimer = null;
  }
}

/** Forget every per-gather bookkeeping entry for one destination. */
function forgetMirrorGather(key) {
  _mirrorDirty.delete(key);
  _mirrorRegionSeq.delete(key);
  _mirrorEmitSeq.delete(key);
  _mirrorIncompleteSince.delete(key);
  _mirrorStallWarned.delete(key);
  _mirrorMisaligned.delete(key);
  _mirrorMisalignTotal.delete(key);
  _mirrorLastWholeAt.delete(key);
  _mirrorTearWindow.delete(key);
}

function mirrorInbound(universe, payload, sequence) {
  if (_activeMirrors.length === 0) return;
  for (const m of _activeMirrors) {
    for (const key of spliceMirrorFrame(m.state, universe, payload)) {
      _mirrorDirty.add(key);
      if (!_mirrorRegionSeq.has(key)) _mirrorRegionSeq.set(key, new Map());
      // This region of the composed buffer now holds THIS datagram's bytes, so
      // it carries THIS sequence. That is the whole bookkeeping.
      _mirrorRegionSeq.get(key).set(universe, sequence);
    }
  }
  if (_mirrorDirty.size === 0 || _mirrorFlushScheduled) return;
  _mirrorFlushScheduled = true;
  setImmediate(flushMirrors);
}

/**
 * The per-source sequence offsets of a misaligned destination, relative to a
 * FIXED anchor source, as a per-universe signature plus an operator-readable
 * form.
 *
 * Signed and wrap-aware: E1.31 sequences are one byte, so a source seven frames
 * behind reads as -7 rather than 249.
 *
 * THE ANCHOR IS THE LOWEST-NUMBERED SOURCE, AND THAT IS THE WHOLE POINT (report
 * 20260815_233 F3). This used to normalise against the MOST ADVANCED source,
 * which made the signature useless for the only question it is asked:
 *
 *   - the leader always read `d = 0` and every other source read `d < 0` BY
 *     CONSTRUCTION, so "is any source behind?" was answered `yes` on every torn
 *     flush, whoever happened to lead it — which is how a source that is merely
 *     systematically last in the engine's send burst was declared permanently
 *     offset (`_229` §3.3);
 *   - and it was not even stable for a genuinely fixed offset: once the laggard's
 *     wrapped sequence read HIGHER than its siblings', the laggard became the
 *     `max` and the sign of the whole reading flipped, so a constant skew looked
 *     like two alternating patterns.
 *
 * A fixed anchor gives one reading per real offset, wrap included, so the SET of
 * values a source produces across a run is a singleton if and only if the offset
 * is genuinely constant.
 *
 * @returns {{anchor:number, byUniverse:Array<[number,number]>, human:string}}
 */
function offsetSignature(required, regionSeq) {
  const universes = [...required].sort((a, b) => a - b);
  const anchor = universes[0];
  const base = regionSeq.get(anchor);
  const parts = universes.map((u) => {
    let d = ((regionSeq.get(u) - base) % SACN_SEQUENCE_MODULUS + SACN_SEQUENCE_MODULUS)
      % SACN_SEQUENCE_MODULUS;
    if (d > SACN_SEQUENCE_MODULUS / 2) d -= SACN_SEQUENCE_MODULUS;
    return { u, d };
  });
  return {
    anchor,
    byUniverse: parts.map(x => [x.u, x.d]),
    human: parts.filter(x => x.d !== 0).map(x => `U${x.u} at ${signed(x.d)}`).join(', ')
      || 'no offset',
  };
}

/** `+3` / `-70` — the sign is load-bearing in every offset line. */
function signed(d) { return d > 0 ? `+${d}` : String(d); }

/**
 * Print one destination's accumulated burst-skew tears, at most once per
 * `MIRROR_TEAR_SUMMARY_MS` (report 20260815_233 F4).
 *
 * Called from BOTH the torn path and the aligned path, so a burst that stops
 * still gets reported on the destination's next composed frame rather than
 * waiting for a tear that may never come. Nothing is ever dropped silently: the
 * cumulative per-destination total rides every line.
 */
function reportTearRollup(key, now) {
  const w = _mirrorTearWindow.get(key);
  if (!w || w.tears === 0) return;
  if (now - w.lastSummaryAt < MIRROR_TEAR_SUMMARY_MS) return;
  const span = ((now - w.since) / 1000).toFixed(1);
  const total = _mirrorMisalignTotal.get(key) || 0;
  // The verdict half of the line is DERIVED, never assumed: a window in which
  // the destination composed nothing is not burst skew, and saying so would be
  // the same false reassurance in the opposite direction from the old STUCK.
  const verdict = w.wholeFrames > 0
    ? `The destination composed ${w.wholeFrames} whole frame(s) between them, so this is the ` +
      'engine\'s per-frame datagram burst landing across two libuv poll phases — NOT sender ' +
      'misalignment and NOT a reason to restart anything (report 20260815_229 §3.2).'
    : 'This destination composed NO whole frame in that window — it is dark, and the STUCK line ' +
      'above is the diagnosis to act on.';
  const msg = `🪞 bench mirror burst skew — ${key}: ${w.tears} frame(s) in the last ${span} s ` +
    `arrived TORN and were not sent (widest spread ${w.worst}, longest unbroken run ` +
    `${w.longestRun} flush(es); ${total} torn flush(es) since this destination was composed). ` +
    verdict;
  console.log(`[sACN Bridge] ${msg}`);
  broadcastLog(msg, 'source');
  w.tears = 0;
  w.worst = 0;
  w.longestRun = 0;
  w.wholeFrames = 0;
  w.since = now;
  w.lastSummaryAt = now;
}

/**
 * Emit every composed destination whose buffer currently holds ONE WHOLE engine
 * frame — every source present, every region carrying the same sequence.
 *
 * A destination that is not whole stays dirty and is NOT rescheduled here: it
 * can only become whole when another source arrives, and that arrival schedules
 * the next flush. Rescheduling from here would spin the event loop.
 */
function flushMirrors() {
  _mirrorFlushScheduled = false;
  const keys = [..._mirrorDirty];
  const now = Date.now();
  for (const key of keys) {
    const entry = _mirrorEntries.get(key);
    const owner = _activeMirrors.find(m => m.state.buffers.has(key));
    if (!entry || !owner) {          // sender retired / mirror deactivated mid-flight
      forgetMirrorGather(key);
      continue;
    }
    // NO `|| new Set()` FALLBACK HERE (report 20260805_158 D-158-8). An absent
    // `requiredSources` entry would have degraded to "nothing required =>
    // complete => emit unconditionally" — a silent permissive default on the one
    // path that decides whether a half-fresh frame goes out, which is the exact
    // shape the codex forbids. `buffers` and `requiredSources` are filled in the
    // same loop and `owner` is found via `buffers.has(key)`, so a miss is an
    // invariant violation, not a state to accommodate: shout and disarm.
    const required = owner.state.requiredSources.get(key);
    if (!required) {
      const why = `the composed destination ${key} has a buffer but no requiredSources entry ` +
        '— the mirror state is internally inconsistent and the bridge will not guess whether ' +
        'a frame is whole';
      console.error(`[sACN Bridge] ❌ 🪞 BENCH MIRROR INVARIANT VIOLATED — ${why}.`);
      broadcastLog(`❌ 🪞 BENCH MIRROR invariant violated — ${why}`, 'warn');
      forgetMirrorGather(key);
      disarmInBackground(why, 'auto');
      return;
    }

    // ── The held-dark degenerate shape (report 20260805_158 R-158-B) ───────
    // A mapping whose every slot is `none` reads NO source universe, so there is
    // no frame to be whole or torn: every tick is a fresh, correct, all-zero
    // frame. Emitting unconditionally here is the operator ruling, not a
    // fallback — the alternative is every bench box holding its last look while
    // the bridge reports the destinations as owned, which is precisely the
    // frozen-not-dark outcome the whole ship-dark design argues against.
    if (required.size === 0) {
      _mirrorIncompleteSince.delete(key);
      _mirrorStallWarned.delete(key);
      _mirrorMisaligned.delete(key);
      _mirrorDirty.delete(key);
      sendVia(entry, mirrorPayload(owner.state, key), MIRROR_PRIORITY, 'Bench mirror (held dark)');
      continue;
    }

    const regionSeq = _mirrorRegionSeq.get(key) || new Map();
    const missing = [];
    const seqs = [];
    for (const u of required) {
      if (!regionSeq.has(u)) missing.push(u);
      else seqs.push(regionSeq.get(u));
    }
    const aligned = seqs.length > 0 && seqs.every(v => v === seqs[0]);

    if (missing.length > 0) {
      // A source that has not arrived yet is NORMAL for the few milliseconds
      // between an engine frame's datagrams. It only becomes news if it lasts.
      if (!_mirrorIncompleteSince.has(key)) _mirrorIncompleteSince.set(key, now);
      const waited = now - _mirrorIncompleteSince.get(key);
      const sig = missing.sort((a, b) => a - b).join(',');
      if (waited >= MIRROR_STALL_WARN_MS && _mirrorStallWarned.get(key) !== sig) {
        _mirrorStallWarned.set(key, sig);
        const msg = `⚠ 🪞 BENCH MIRROR source stalled — ${key} has been waiting ` +
          `${Math.round(waited)} ms for U${missing.join(', U')}. That destination is NOT being ` +
          'sent: a composed frame is emitted only when every source it reads has arrived, and ' +
          'emitting a half-fresh frame instead would be the tearing this rule exists to stop. ' +
          'Check that the engine is still sending those universes.';
        console.warn(`[sACN Bridge] ${msg}`);
        broadcastLog(msg, 'warn');
      }
      continue;                      // stays dirty; the next arrival re-schedules
    }

    if (!aligned) {
      // EVERY source is present and they disagree about which engine frame this
      // is. Nothing is emitted: a mixed frame would leave those fixtures on a
      // STEADY WRONG COLOUR, which looks nothing like flicker and would be
      // misread as a fixture-menu problem.
      //
      // TWO CAUSES, OPPOSITE REMEDIES (report 20260805_158 R-158-A, remeasured
      // by 20260815_229). A TORN READ is the engine's one-frame datagram burst
      // caught mid-flight — the destination composes a whole frame a millisecond
      // later and every time after. A FIXED SENDER OFFSET never composes one at
      // all. The discriminator below asks that, and only that.
      //
      // WHAT THIS REPLACED, AND WHY (`_229` §3.3). The old test was "did every
      // source reach lag 0 at some point in the window", against a signature
      // normalised to the most advanced source — which gives the leader 0 and
      // everyone else < 0 BY CONSTRUCTION, so a source that is merely last in
      // the engine's send burst can never reach 0. Six consecutive torn flushes
      // then read as "a FIXED offset" and told the operator to restart a
      // perfectly healthy engine. It did that 48 times in one session and was
      // wrong 48 times.
      const offsets = offsetSignature(required, regionSeq);
      const prev = _mirrorMisaligned.get(key);
      const offsetSets = prev ? prev.offsetSets : new Map();
      let worst = 0;
      for (const [u, d] of offsets.byUniverse) {
        if (Math.abs(d) > worst) worst = Math.abs(d);
        if (!offsetSets.has(u)) offsetSets.set(u, new Set());
        const seen = offsetSets.get(u);
        // Bounded — see MIRROR_OFFSET_SET_CAP. Past two distinct values the
        // singleton answer is settled forever, so growing it would be pure
        // per-flush accumulation.
        if (seen.size < MIRROR_OFFSET_SET_CAP || seen.has(d)) seen.add(d);
      }
      const state = {
        count: (prev ? prev.count : 0) + 1,
        since: prev ? prev.since : now,
        lastLoggedAt: prev ? prev.lastLoggedAt : 0,
        flushes: (prev ? prev.flushes : 0) + 1,
        offsetSets,
        announcedFixed: prev ? prev.announcedFixed : false,
      };
      _mirrorMisaligned.set(key, state);
      const total = (_mirrorMisalignTotal.get(key) || 0) + 1;
      _mirrorMisalignTotal.set(key, total);
      // The measurement clock for F2. A destination with no recorded whole frame
      // has not composed one SINCE NOW — the earliest instant the claim can be
      // true — so that is where "no whole frame for X" starts counting.
      if (!_mirrorLastWholeAt.has(key)) _mirrorLastWholeAt.set(key, now);
      const wholeAge = now - _mirrorLastWholeAt.get(key);

      // ── F3: "fixed" now means literally fixed ─────────────────────────────
      // One reading per source, against a stable anchor, across the whole run.
      // A singleton set is a constant offset; anything else is a moving one.
      // ── F1: an offset of ±1 is a torn read by definition, never "fixed".
      const fixedUniverses = [...offsetSets.entries()]
        .filter(([, seen]) => seen.size === 1
          && Math.abs([...seen][0]) >= MIRROR_MIN_FIXED_OFFSET)
        .map(([u, seen]) => [u, [...seen][0]]);
      // ── F2, the class-deleter: has this destination composed ANYTHING? ────
      // All three must hold. The first two describe the offset; the third is the
      // one a torn read can never satisfy, because it composes a whole frame
      // between every tear.
      const persistent = state.flushes >= MIRROR_FIXED_OFFSET_FLUSHES && fixedUniverses.length > 0;
      const noWholeFrame = wholeAge >= MIRROR_STUCK_NO_WHOLE_MS;
      const fixed = persistent && noWholeFrame;
      // A newly-detected fixed offset must not wait out the throttle window: it
      // is a different diagnosis, and the previous line said the wrong thing.
      const firstFixed = fixed && !state.announcedFixed;
      if (firstFixed) state.announcedFixed = true;

      // ── F4: a tear gets the same settling grace a missing source gets ─────
      // Below the grace it is counted into the rollup and nothing is printed;
      // above it, this run is a real sustained fault and is named at once.
      if (!_mirrorTearWindow.has(key)) {
        _mirrorTearWindow.set(key,
          { tears: 0, worst: 0, longestRun: 0, wholeFrames: 0, since: now, lastSummaryAt: now });
      }
      const tearWindow = _mirrorTearWindow.get(key);
      tearWindow.tears += 1;
      if (worst > tearWindow.worst) tearWindow.worst = worst;
      if (state.count > tearWindow.longestRun) tearWindow.longestRun = state.count;
      reportTearRollup(key, now);

      const sustained = now - state.since >= MIRROR_TEAR_GRACE_MS;
      if (fixed || sustained) {
        if (firstFixed || state.lastLoggedAt === 0
            || now - state.lastLoggedAt >= MIRROR_MISALIGN_LOG_INTERVAL_MS) {
          state.lastLoggedAt = now;
          const regions = [...required].map(u => `U${u}#${regionSeq.get(u)}`).join(' ');
          const named = fixedUniverses.map(([u, d]) => `U${u} at ${signed(d)}`).join(', ');
          const secs = (wholeAge / 1000).toFixed(1);
          const msg = fixed
            // ── F5: what was MEASURED, and the remedy that follows from it ──
            // "RESTART THE ENGINE" was wrong 48 times out of 48 in the `_229`
            // session, and `_212` made the cause it named — senders at different
            // sequence origins — impossible by construction: the engine stamps
            // ONE counter across every universe of a frame. So the line states
            // the measurement and points at the causes that remain.
            ? `❌ 🪞 BENCH MIRROR STUCK — ${key}: NO whole frame has composed for ${secs} s ` +
              `(${state.flushes} consecutive torn flushes, ${total} for this destination) AND ` +
              `its sources hold a PERSISTENT multi-step offset (${named}, measured against ` +
              `U${offsets.anchor}). Both were measured, not inferred: a burst-skew tear composes ` +
              'a whole frame between tears — this has composed none. This destination is sending ' +
              `NOTHING until it clears (regions: ${regions}). DO NOT restart the engine on this ` +
              'line alone: since report 20260814_212 the engine stamps every universe of one ' +
              'frame with ONE sequence counter, so a live engine cannot put its own senders at ' +
              'different origins. Check instead, in order: (1) is the engine still sending every ' +
              'source universe — the sACN IN monitor and :6968/status; (2) is a SECOND WRITER ' +
              '(another engine, a console, a stale bridge) interleaving its own sequence counter ' +
              'on those universes — that is the only remaining way sources stay permanently ' +
              'apart; (3) if a source has genuinely died, DISARM and re-arm to recompose from ' +
              'what is live.'
            : `⚠ 🪞 BENCH MIRROR frame NOT WHOLE — ${key}: its regions have carried DIFFERENT ` +
              `engine frames for ${Math.round(now - state.since)} ms (${regions}; offsets ` +
              `${offsets.human} against U${offsets.anchor}). A source datagram was lost or a ` +
              `source is lagging (${state.count} frame(s) in this run, ${total} for this ` +
              'destination since it was composed). Those frames were NOT sent — a mixed one ' +
              'would leave those fixtures showing a STEADY WRONG COLOUR, not flicker. A tear ' +
              'shorter than a settling window is ordinary burst skew and is summarised instead ' +
              'of printed; this one outlived it, so the mirror is dropping engine frames.';
          console.warn(`[sACN Bridge] ${msg}`);
          broadcastLog(msg, 'warn');
        }
      }
      continue;                      // stays dirty; the next arrival re-schedules
    }

    _mirrorIncompleteSince.delete(key);
    _mirrorStallWarned.delete(key);
    _mirrorMisaligned.delete(key);
    _mirrorDirty.delete(key);
    // THE WHOLE-FRAME STAMP (report 20260815_233 F2). Set here — before the
    // "nothing new to say" short-circuit below — because COMPOSING a whole frame
    // is the event that disproves stuckness, whether or not those same bytes are
    // put on the wire again.
    _mirrorLastWholeAt.set(key, now);
    const openWindow = _mirrorTearWindow.get(key);
    if (openWindow) openWindow.wholeFrames += 1;
    reportTearRollup(key, now);
    // Nothing new to say: the buffer has not moved on since the last emission.
    if (_mirrorEmitSeq.get(key) === seqs[0]) continue;
    _mirrorEmitSeq.set(key, seqs[0]);
    sendVia(entry, mirrorPayload(owner.state, key), MIRROR_PRIORITY, 'Bench mirror');
  }
}

/**
 * Fan one inbound frame out to the mirror, the relay and the browser.
 *
 * `payload` is RAW DMX: a 1-indexed `{channel: 0..255}` object from
 * `rawDmxPayload`. Every consumer below assumes that unit — the relay resends
 * it through senders that declare `useRawDmxValues`, the mirror splices it into
 * `Uint8Array` buffers (no truncation now that the values are integers, which
 * is `_153` F7 gone), and the WebSocket frame carries true DMX bytes so the
 * browser's `sacn_mapper.js` `/255` finally means what it says (`_105` F3).
 * Report 20260805_170.
 */
function routeFrame(universe, priority, payload, sequence) {
  // 0. Bench stand-in: compose this frame into any destination it feeds. The
  //    composed frame goes out at the mirror's OWN fixed priority, never the
  //    inbound one — see MIRROR_PRIORITY. The inbound E1.31 SEQUENCE travels
  //    with it: it is the only frame identity on the wire, and the composition
  //    gate needs it to tell "all my sources are here" from "all my sources are
  //    here FOR THE SAME FRAME".
  mirrorInbound(universe, payload, sequence);

  // 1. Relay to physical sACN devices directly.
  //    `_relaySuspended` is raised in the SAME synchronous turn the arm is
  //    recorded, before the ship-dark zeros go out. Without it a raw frame could
  //    interleave with those zeros on a pair that is being retired — the `_152`
  //    D1 defect pointing the other way. While armed `outgoingSenders` is empty
  //    anyway; this closes the window before that is true.
  if (!_relaySuspended) {
    const ipTargets = outgoingSenders.get(universe);
    if (ipTargets) {
      for (const entry of ipTargets.values()) sendVia(entry, payload, priority, 'Relay');
    }
  }

  // 2. Broadcast to Browser WebSocket clients — TRUE DMX BYTES (0-255). The
  //    browser's `sacn_input_source.js` hands these straight to the DMX router
  //    and `sacn_mapper.js` divides by 255; before report 20260805_170 the
  //    values here were the package's 0-100 percent view, which is exactly the
  //    39 % preview ceiling logged as `_105` F3.
  if (wss.clients.size === 0) return;
  const dmx = new Uint8Array(512);
  if (payload) {
    for (const ch in payload) {
      const idx = parseInt(ch, 10) - 1;
      if (idx >= 0 && idx < 512) dmx[idx] = payload[ch];
    }
  }
  const msg = Buffer.alloc(515);
  msg.writeUInt16LE(universe, 0);
  msg.writeUInt8(priority, 2);
  dmx.forEach((v, i) => { msg[3 + i] = v; });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

console.log('═'.repeat(56));
console.log('  📡 sACN → WebSocket Bridge');
console.log('─'.repeat(56));
console.log(`  sACN Universes      : ${sacnOpts.universes.join(', ')} (boot)`);
console.log('  Runtime Subscribe   : ON — relay routes + active scenes\' patched universes ' +
  '(incl. LED spill) + the 📡 Subscribed Universes field, all RE-READ on every recompute');
console.log(`  WebSocket Port      : ${SACN_PORT}`);
console.log(`  Priority Threshold  : ≥${HIGH_PRIORITY}`);
console.log(`  Lockout Duration    : ${LOCKOUT_MS / 1000}s`);
console.log(`  Source Stale        : ${sacnOpts.sourceStaleMs}ms`);
console.log(`  Pinned Scene        : ${pinnedScene} (--scene)`);
console.log(`  Engine Poll         : http://127.0.0.1:${ENGINE_PORT}/status every ${ENGINE_POLL_MS}ms`);
console.log('  Bench Mirror        : DISARMED (runtime mode, process memory only — arm it from ' +
  'the sim\'s 🎛 Controllers view header; every start comes up disarmed)');
console.log('  Bench Mirror Scope  : while ARMED the bench is the ONLY physical output — all ' +
  'ordinary relay is suspended and zeroed. No browser can transmit to hardware at all ' +
  '(report 20260805_171), so the mirror is the single writer by construction');
console.log('═'.repeat(56));

// ── Boot the relay route table ──────────────────────────────────────────
// Runs LAST so `wss` / `broadcastLog` exist for the transition broadcasts.
// Initial set = the CLI pin's routes; the engine poll and client scene tags
// join the union as they arrive.
//
// This call is HELD by the boot gate and replayed from the receive socket's
// `listening` handler (report 20260725_99): subscribing a universe before the
// `sacn` package's own join loop has run makes that loop join it twice, and a
// duplicate IP_ADD_MEMBERSHIP is `addMembership EINVAL` on Windows — the crash
// that used to kill this process at startup.
recomputeRoutes('boot');
pollEngineStatus();
const _enginePollTimer = setInterval(pollEngineStatus, ENGINE_POLL_MS);
if (_enginePollTimer.unref) _enginePollTimer.unref();

// A start is always DISARMED, so any interlock claim standing right now belongs
// to a bridge that died without disarming (report 20260815_233 F7).
reapStaleArmInterlock();

// ── Shutdown while armed (report 20260804_151) ─────────────────────────────
// A bridge that dies mid-mirror leaves the composed frame frozen on the box
// until an unknown device-side dmx.timeoutMs. Take the same blackout path the
// operator's DISARM takes, then exit — bounded, because a hung socket must not
// turn Ctrl-C into a process that will not die.
const SHUTDOWN_BLACKOUT_TIMEOUT_MS = 1500;
let _shuttingDown = false;
function shutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  if (_mirrorArm === null && !blackoutInFlight()) {
    console.log(`[sACN Bridge] ${signal} — exiting (bench mirror was not armed).`);
    process.exit(0);
  }
  const done = () => process.exit(0);
  setTimeout(done, SHUTDOWN_BLACKOUT_TIMEOUT_MS).unref();
  // A signal that lands DURING a blackout must not kill it (report 20260804_152
  // D5): `_mirrorArm` is already null by then, so without this branch the bridge
  // would report "was not armed" and exit with one or two zero frames unsent —
  // exactly the frozen-frame outcome the blackout exists to prevent.
  if (_mirrorArm === null) {
    console.log(`[sACN Bridge] ${signal} while a BENCH MIRROR blackout is in flight — waiting ` +
      'for its all-zero frames to land before exit.');
    Promise.resolve(_blackoutSettled).then(done).catch(done);
    return;
  }
  console.log(`[sACN Bridge] ${signal} while the BENCH MIRROR is ARMED — blacking out the owned ` +
    'destinations before exit.');
  disarmBenchMirror(`the bridge received ${signal}`, 'shutdown').then(done).catch((err) => {
    console.error(`[sACN Bridge] ⚠ blackout on ${signal} failed: ${err.message} — exiting anyway.`);
    done();
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Last-resort loudness (report 20260814_212) ─────────────────────────────
// An error that reaches here has already escaped every guard, so the process
// state is UNKNOWN. Continuing would be a fallback — a guess that the bridge is
// still coherent — which the codex forbids and which is worse than dying: a
// wedged-but-responsive bridge is invisible to the launcher's freeze watchdog
// (it only kills a server that stops answering its health probe), so it would
// sit there feeding nothing and reporting healthy.
//
// So: SHOUT, release the hardware, then DIE NONZERO and let the supervisor do
// its job. `start.js` restarts a crashed bridge within 1 s and escalates loudly
// past its budget, and a restarted bridge comes up DISARMED with the full
// ordinary relay restored — which is exactly the un-freeze the boxes need.
//
// The stack goes out with `fs.writeSync` on fd 2, never `console.error`: this
// path ends in `process.exit`, and the whole reason this incident took an hour
// was a diagnostic that never made it to the log.
function fatalEscapedError(kind, err) {
  const e = err instanceof Error ? err : new Error(String(err));
  fs.writeSync(2, `[sACN Bridge] ❌ FATAL ${kind} — ${e.message}\n${e.stack}\n` +
    'This escaped every guard, so the bridge state is UNKNOWN and it will NOT continue on a ' +
    'guess. Exiting nonzero so the launcher restarts it (disarmed, full relay restored). ' +
    'This is a DEFECT — report it with the stack above.\n');
  if (_mirrorArm === null && !blackoutInFlight()) process.exit(1);
  // Armed: the owned destinations must go dark deliberately rather than freeze
  // on their last composed frame. Bounded, because a hung socket must not turn
  // a crash into a process that will not die.
  const die = () => process.exit(1);
  setTimeout(die, SHUTDOWN_BLACKOUT_TIMEOUT_MS).unref();
  disarmBenchMirror(`a fatal ${kind}: ${e.message}`, 'shutdown').then(die).catch(die);
}
process.on('unhandledRejection', (reason) => fatalEscapedError('unhandled promise rejection', reason));
process.on('uncaughtException', (err) => fatalEscapedError('uncaught exception', err));

// ── Exit breadcrumb ────────────────────────────────────────────────────────
// The 2026-08-14 incident cost an hour because the bridge vanished with
// `code=1` and NOTHING else in the launcher log, leaving no way to tell an
// internal crash from an external kill. On Windows a force-terminated process
// (`taskkill /F`, which is how port sweeps and stack teardowns kill things)
// exits with exactly code 1 and no output — indistinguishable, after the fact,
// from a silent self-exit. This line closes that gap permanently: an exit this
// process CHOSE always says so. `fs.writeSync` on fd 2, not console.error,
// because an 'exit' listener may not queue async work.
process.on('exit', (code) => {
  // Drop our own interlock claim if it survived this far (a `process.exit` that
  // skipped the disarm path). Only ever OUR claim, and only synchronous work.
  const claim = readArmMarker();
  if (claim.state === 'armed' && claim.marker.pid === process.pid) {
    try { clearArmMarker(); } catch (e) { fs.writeSync(2, `[sACN Bridge] arm interlock left behind: ${e.message}\n`); }
  }
  fs.writeSync(2, `[sACN Bridge] process exiting on its own with code=${code} ` +
    `(armed=${_mirrorArm !== null}). If the launcher reports an exit WITHOUT this line, the ` +
    'bridge did not choose it — it was force-killed from outside (on Windows that is code=1 ' +
    'with no output; suspect a port sweep or a stack teardown from another session).\n');
});

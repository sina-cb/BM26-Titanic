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
  parseSubscribedUniversesField } = require('../lib/bridge_routing.cjs');

// Bench stand-in re-addressing (operator order 2026-07-31). Pure half in
// lib/bench_mirror.cjs; this file owns the file reads, the senders and the logs.
const { parseBenchMirrorSpec, isMirrorActive, mirrorSourceUniverses, mirrorDestPairs,
  createMirrorState, spliceMirrorFrame, mirrorPayload,
  describeMirror } = require('../lib/bench_mirror.cjs');

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
try { WebSocketServer = require('ws').Server; } catch (e) {
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
const _mirrorDirty = new Set();             // destKeys awaiting a flush
const _mirrorPriority = new Map();          // destKey → priority of the last contributing frame
let _mirrorFlushScheduled = false;

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
 * @returns {Array<{scene:string, spec:Object, raw:string}>}
 */
function readBenchMirrorSpecs() {
  const out = [];
  const scenesDir = path.join(SIM_ROOT, 'scenes');
  let entries;
  try {
    entries = fs.readdirSync(scenesDir, { withFileTypes: true });
  } catch (e) {
    warnOnce(_warnedMirrorSpecs, `⚠ Could not scan scenes for ${BENCH_MIRROR_FILE}: ${e.message}`);
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = path.join(scenesDir, entry.name, BENCH_MIRROR_FILE);
    if (!fs.existsSync(specPath)) continue;
    let raw;
    try {
      raw = fs.readFileSync(specPath, 'utf8');
      out.push({ scene: entry.name, spec: parseBenchMirrorSpec(yaml.load(raw), `${entry.name}/${BENCH_MIRROR_FILE}`), raw });
    } catch (e) {
      warnOnce(_warnedMirrorSpecs,
        `⚠ BENCH MIRROR REFUSED — ${entry.name}/${BENCH_MIRROR_FILE}: ${e.message} ` +
        'Nothing is mirrored from this scene until the file is fixed.');
    }
  }
  return out;
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

  // ── Bench stand-in mirrors (operator order 2026-07-31) ─────────────────
  // Resolved BEFORE the subscription block and the sender diff: an active
  // mirror adds SOURCE universes the receiver must accept, and OWNS its
  // destination (universe → host) pairs, whose ordinary relay must be
  // suppressed (one writer per pair — report 20260724_15).
  const activeSceneSet = new Set(activeScenes);
  const nextMirrors = [];
  const nextMirrorStates = new Map();
  for (const found of readBenchMirrorSpecs()) {
    if (!isMirrorActive(found.spec, engineState.scene, activeSceneSet.has(found.scene))) continue;
    // Reuse the composed buffers while the map is byte-identical, so a route
    // recompute never blanks a bench frame mid-show.
    const prev = _mirrorStates.get(found.scene);
    const state = (prev && prev.sig === found.raw) ? prev.state : createMirrorState(found.spec);
    nextMirrorStates.set(found.scene, { sig: found.raw, state });
    nextMirrors.push({ scene: found.scene, spec: found.spec, state });
  }
  _activeMirrors = nextMirrors;
  _mirrorStates = nextMirrorStates;

  const mirrorOwned = new Set();
  const mirrorTargets = new Map();          // destKey → { universe, ip, scene }
  for (const m of _activeMirrors) {
    for (const pair of mirrorDestPairs(m.spec)) {
      const key = routeKey(pair.universe, pair.ip);
      mirrorOwned.add(key);
      mirrorTargets.set(key, { universe: pair.universe, ip: pair.ip, scene: m.scene });
    }
  }
  const mirrorSuppressed = routes.filter(r => mirrorOwned.has(routeKey(r.universe, r.ip)));
  const relayRoutes = routes.filter(r => !mirrorOwned.has(routeKey(r.universe, r.ip)));

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
  for (const [key, entry] of _mirrorEntries) {
    if (mirrorTargets.has(key)) continue;
    try { entry.sender.close(); } catch (e) {}
    _mirrorEntries.delete(key);
    _mirrorDirty.delete(key);
    console.log(`[sACN Bridge] Bench mirror sender removed: U${entry.universe} → ${entry.ip} (${reason})`);
  }
  for (const [key, target] of mirrorTargets) {
    if (_mirrorEntries.has(key)) continue;
    _mirrorEntries.set(key, {
      sender: new Sender({
        universe: target.universe,
        useUnicastDestination: target.ip,
        port: SACN_UDP_PORT,
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
      console.log(`[sACN Bridge] 🪞 BENCH MIRROR ACTIVE — scene '${m.scene}' is showing ` +
        `'${m.spec.sourceScene}' fixtures. ${m.spec.note}`);
      for (const line of describeMirror(m.spec)) {
        console.log(`[sACN Bridge] 🪞   composes ${line}`);
      }
      broadcastLog(`🪞 Bench mirror ACTIVE — '${m.scene}' shows '${m.spec.sourceScene}'`, 'source');
    }
    for (const s of mirrorSuppressed) {
      console.log(`[sACN Bridge] 🚫 Relay suppressed: U${s.universe} → ${s.ip} — the BENCH MIRROR ` +
        'composes this universe for that controller; relaying the raw frame too would put two ' +
        `writers on it. (declared by scenes: ${s.scenes.join(', ')})`);
      broadcastLog(`Relay suppressed U${s.universe} → ${s.ip}: bench mirror owns it`, 'warn');
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
  recomputeRoutes('engine poll');
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
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    clientCount--;
    const scene = clientScenes.get(ws);
    clientScenes.delete(ws);
    broadcastLog(`Browser disconnected (${clientCount} client(s))`, 'warn');
    broadcastClientCensus();
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
    routeFrame(universe, priority, packet.payload);
  } else {
    if (!highPriorityActive) {
      if (activeSource !== sourceKey) {
        const msg = `🟡 ACTIVE — '${sourceKey}' (Priority ${priority}) forwarding.`;
        broadcastLog(msg, 'source');
        activeSource = sourceKey;
      }
      routeFrame(universe, priority, packet.payload);
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
 */
function sendVia(entry, payload, priority, label) {
  entry.sender.send({ payload, sourceName: 'MarsinRelay Engine', priority })
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

/**
 * Feed one inbound frame to every active bench mirror and coalesce the sends.
 *
 * A composed destination is fed by SEVERAL source universes that arrive as
 * separate datagrams. Sending on each splice would emit the destination once per
 * source (3× per engine frame for the bench's U2) and put partially-updated
 * frames on the wire. `setImmediate` runs after the poll phase that delivered
 * this burst of datagrams, so one engine frame becomes one composed send.
 */
function mirrorInbound(universe, priority, payload) {
  if (_activeMirrors.length === 0) return;
  for (const m of _activeMirrors) {
    for (const key of spliceMirrorFrame(m.state, universe, payload)) {
      _mirrorDirty.add(key);
      // The composed frame goes out at the priority of the source that last fed
      // it — never a number this file invents.
      _mirrorPriority.set(key, priority);
    }
  }
  if (_mirrorDirty.size === 0 || _mirrorFlushScheduled) return;
  _mirrorFlushScheduled = true;
  setImmediate(flushMirrors);
}

/** Emit every composed destination that changed since the last flush. */
function flushMirrors() {
  _mirrorFlushScheduled = false;
  const keys = [..._mirrorDirty];
  _mirrorDirty.clear();
  for (const key of keys) {
    const entry = _mirrorEntries.get(key);
    if (!entry) continue;               // sender retired between splice and flush
    const owner = _activeMirrors.find(m => m.state.buffers.has(key));
    if (!owner) continue;               // mirror deactivated between splice and flush
    sendVia(entry, mirrorPayload(owner.state, key), _mirrorPriority.get(key), 'Bench mirror');
  }
}

function routeFrame(universe, priority, payload) {
  // 0. Bench stand-in: compose this frame into any destination it feeds. Runs
  //    on the same admitted frames the relay does, so an sACN priority override
  //    silences the mirror exactly as it silences the relay.
  mirrorInbound(universe, priority, payload);

  // 1. Relay to physical sACN devices directly
  const ipTargets = outgoingSenders.get(universe);
  if (ipTargets) {
    for (const entry of ipTargets.values()) sendVia(entry, payload, priority, 'Relay');
  }

  // 2. Broadcast to Browser WebSocket clients
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

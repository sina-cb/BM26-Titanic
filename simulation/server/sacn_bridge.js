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

// ── Realtime priority (self-elevation) ──────────────────────────────────
// This bridge relays every DMX frame; a starved relay freezes the rig just
// like a starved engine. Elevate above the NORMAL class Chrome sits in.
// Default HIGH; the launcher can pass BM26_BRIDGE_PRIORITY. Reads the achieved
// class back and logs [BridgePriority] — an un-elevated bridge is never silent.
const processPriority = require('../../tools/process_priority.cjs');
processPriority.elevateSelf(
  processPriority.normalizePriorityRequest(process.env.BM26_BRIDGE_PRIORITY, { fallback: 'high' }) || 'high',
  { label: 'BridgePriority', logger: (m) => console.log(`[sacn_bridge] ${m}`) });

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
        const pConf = yaml.load(fs.readFileSync(patchesPath, 'utf8'));
        if (pConf && pConf.patches) {
          for (const patch of Object.values(pConf.patches)) {
            const u = parseInt(patch.dmxUniverse, 10);
            if (u > 0) universes.add(u);
          }
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

const patchUniverses = getAllPatchUniverses();
let sacnOpts = { universes: patchUniverses, lockoutMs: 10000, highPriorityThreshold: 150, sourceStaleMs: 2000 };
try {
  const commonPath = path.join(SIM_ROOT, 'scenes', 'common.yaml');
  let s = null;
  if (fs.existsSync(commonPath)) {
    const commonConfig = yaml.load(fs.readFileSync(commonPath, 'utf8'));
    if (commonConfig && commonConfig.colorWave) s = commonConfig.colorWave;
  }
  if (fs.existsSync(sceneConfigPath)) {
    const sceneConfig = yaml.load(fs.readFileSync(sceneConfigPath, 'utf8'));
    if (sceneConfig && sceneConfig.colorWave) s = sceneConfig.colorWave;
  }

  if (s) {
    const val = (v) => (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
    const univOverride = val(s.sacn_universes);
    // Only override if explicitly set in config; otherwise use patch-derived list
    const universes = univOverride
      ? String(univOverride).split(',').map(u => parseInt(u.trim(), 10)).filter(u => !isNaN(u))
      : patchUniverses;
    sacnOpts = {
      universes,
      lockoutMs: val(s.sacn_lockout_ms) || 10000,
      highPriorityThreshold: val(s.sacn_high_priority) || 150,
      sourceStaleMs: val(s.sacn_stale_ms) || 2000,
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
// Pure computation lives in lib/bridge_routing.cjs (unit-tested).
const { computeEffectiveRoutes, engineOwnedPairs, routeKey } =
  require('../lib/bridge_routing.cjs');

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

/**
 * Read one scene's declared (universe → controllerIp) pairs from its
 * patches.yaml. Returns [] for a scene whose patches declare no controller
 * IPs (a legitimate zero — e.g. titanic today) and null for a missing /
 * unreadable file (logged loudly by the caller, once per scene).
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
  const pairs = [];
  const seen = new Set();
  if (pConf && pConf.patches) {
    for (const patch of Object.values(pConf.patches)) {
      const u = parseInt(patch.dmxUniverse, 10);
      const ip = patch.controllerIp;
      if (u > 0 && ip && ip !== '127.0.0.1' && ip !== '0.0.0.0' && String(ip).toLowerCase() !== 'localhost') {
        const key = routeKey(u, ip);
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ universe: u, ip });
        }
      }
    }
  }
  return pairs;
}

/**
 * Recompute the effective route set and diff it onto the live senders.
 * Called on: boot, client setScene, client disconnect, engine poll change.
 * Every route add/remove/suppression is logged AND broadcast to the sim's
 * monitor panel — on playa someone WILL wonder why a universe isn't relayed.
 */
function recomputeRoutes(reason) {
  const candidateScenes = new Set([pinnedScene]);
  if (engineState.scene) candidateScenes.add(engineState.scene);
  for (const s of clientScenes.values()) candidateScenes.add(s);

  const sceneRoutes = new Map();
  for (const s of candidateScenes) {
    const pairs = readSceneRoutePairs(s);
    if (pairs === null) {
      if (!_warnedMissingScenes.has(s)) {
        _warnedMissingScenes.add(s);
        console.warn(`[sACN Bridge] ⚠ No readable patches.yaml for scene '${s}' — it contributes no relay routes.`);
        broadcastLog(`⚠ Unknown scene '${s}' — no relay routes from it`, 'warn');
      }
      continue;
    }
    sceneRoutes.set(s, pairs);
  }

  const { routes, excluded, conflicts, activeScenes } = computeEffectiveRoutes({
    sceneRoutes,
    pinnedScene,
    engineScene: engineState.scene,
    clientScenes: clientScenes.values(),
    engineOwned: engineState.owned,
  });

  // Annotate scene provenance for the logs: "test_bench[engine]".
  const provenance = (scene) => {
    const tags = [];
    if (scene === pinnedScene) tags.push('pin');
    if (scene === engineState.scene) tags.push('engine');
    for (const s of clientScenes.values()) { if (s === scene) { tags.push('client'); break; } }
    return tags.length ? `${scene}[${tags.join('+')}]` : scene;
  };

  // Diff → close removed senders, create added ones.
  const nextKeys = new Set(routes.map(r => routeKey(r.universe, r.ip)));
  for (const [key, entry] of _routeEntries) {
    if (!nextKeys.has(key)) {
      try { entry.sender.close(); } catch (e) {}
      _routeEntries.delete(key);
      console.log(`[sACN Bridge] Route removed: U${entry.universe} → ${entry.ip} (${reason})`);
      broadcastLog(`Relay route removed: U${entry.universe} → ${entry.ip}`, 'warn');
    }
  }
  for (const r of routes) {
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

  // Rebuild the universe-indexed view routeFrame reads.
  outgoingSenders.clear();
  for (const entry of _routeEntries.values()) {
    if (!outgoingSenders.has(entry.universe)) outgoingSenders.set(entry.universe, new Map());
    outgoingSenders.get(entry.universe).set(entry.ip, entry);
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
const receiver = new Receiver({ universes: sacnOpts.universes, port: SACN_UDP_PORT, reuseAddr: true });

const LOCKOUT_MS = sacnOpts.lockoutMs;
const HIGH_PRIORITY = sacnOpts.highPriorityThreshold;

let activeSource = null;
let highPriorityActive = false;
let highPriorityTimer = null;
let packetCount = 0;
let lastLogTime = 0;
const MAX_UNIVERSE = sacnOpts.universes[sacnOpts.universes.length - 1] || 256;
const _warnedUniverses = new Set();

receiver.on('packet', (packet) => {
  const priority = packet.priority || 100;
  const sourceKey = packet.sourceName || 'Unknown';
  const universe = packet.universe || 1;

  if (universe > MAX_UNIVERSE && !_warnedUniverses.has(universe)) {
    _warnedUniverses.add(universe);
    console.warn(`[sACN Bridge] ⚠ Received data for Universe ${universe} from '${sourceKey}' — exceeds subscription range (1–${MAX_UNIVERSE}). Packet dropped.`);
    broadcastLog(`⚠ Universe ${universe} exceeds subscription range (1–${MAX_UNIVERSE})`, 'warn');
    return;
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

function routeFrame(universe, priority, payload) {
  // 1. Relay to physical sACN devices directly
  const ipTargets = outgoingSenders.get(universe);
  if (ipTargets) {
    for (const entry of ipTargets.values()) {
      entry.sender.send({ payload, sourceName: 'MarsinRelay Engine', priority })
        .then(() => {
          // Healthy send. If we were in a failure streak, log recovery once
          // (with the suppressed-error count) and reset dedup state.
          if (entry.lastErrorMsg) {
            const burst = entry.errorsSinceLog;
            const tail = burst > 0 ? ` (after ${burst} suppressed errors)` : '';
            console.log(`[sACN Bridge] ✅ Recovered U${entry.universe}→${entry.ip}${tail}`);
            entry.lastErrorMsg = null;
            entry.lastErrorLoggedAt = 0;
            entry.errorsSinceLog = 0;
          }
        })
        .catch(err => {
          const now = Date.now();
          const msg = err.message;
          if (msg !== entry.lastErrorMsg) {
            const transition = entry.lastErrorMsg
              ? ` (was: ${entry.lastErrorMsg})`
              : '';
            console.error(`[sACN Bridge] ⚠ Relay error U${entry.universe}→${entry.ip}: ${msg}${transition}`);
            entry.lastErrorMsg = msg;
            entry.lastErrorLoggedAt = now;
            entry.errorsSinceLog = 0;
          } else if (now - entry.lastErrorLoggedAt >= RELAY_ERROR_LOG_INTERVAL_MS) {
            const suppressed = entry.errorsSinceLog;
            console.error(`[sACN Bridge] ⚠ Still failing U${entry.universe}→${entry.ip}: ${msg} (${suppressed} suppressed in last ${Math.round((now - entry.lastErrorLoggedAt) / 1000)}s)`);
            entry.lastErrorLoggedAt = now;
            entry.errorsSinceLog = 0;
          } else {
            entry.errorsSinceLog++;
          }
        });
    }
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
console.log(`  sACN Universes      : ${sacnOpts.universes.join(', ')}`);
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
recomputeRoutes('boot');
pollEngineStatus();
const _enginePollTimer = setInterval(pollEngineStatus, ENGINE_POLL_MS);
if (_enginePollTimer.unref) _enginePollTimer.unref();

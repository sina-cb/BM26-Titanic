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

// ── Read config ────────────────────────────────────────────────────────
const serverConfig = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'config.yaml'), 'utf8'));
const SACN_PORT = serverConfig.sacn_port || 6971;
const SACN_UDP_PORT = serverConfig.sacn_udp_port || 5568;

let sacnOpts = { universes: [1, 2, 3, 4], lockoutMs: 10000, highPriorityThreshold: 150, sourceStaleMs: 2000 };
try {
  const sceneConfig = yaml.load(fs.readFileSync(sceneConfigPath, 'utf8'));
  if (sceneName) console.log(`[sACN Bridge] Using scene config: ${sceneName}`);
  const s = sceneConfig && sceneConfig.colorWave;
  if (s) {
    const val = (v) => (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
    const univStr = String(val(s.sacn_universes) || '1,2,3,4');
    sacnOpts = {
      universes: univStr.split(',').map(u => parseInt(u.trim(), 10)).filter(u => !isNaN(u)),
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

// ── Build Outward Network Map (Option B) ───────────────────────────────
const outgoingSenders = new Map(); // universe -> Map<ip, Sender>

function loadRoutesForScene(sName) {
  // Clear old
  for (const uMap of outgoingSenders.values()) {
    for (const sender of uMap.values()) {
      try { sender.close(); } catch(e){}
    }
  }
  outgoingSenders.clear();

  try {
    const patchesYamlPath = path.join(SIM_ROOT, 'scenes', sName, 'patches.yaml');
    if (fs.existsSync(patchesYamlPath)) {
      const pConf = yaml.load(fs.readFileSync(patchesYamlPath, 'utf8'));
      if (pConf && pConf.patches) {
        let routeCount = 0;
        for (const patch of Object.values(pConf.patches)) {
          const u = patch.dmxUniverse;
          const ip = patch.controllerIp;
          if (u > 0 && ip && ip !== '127.0.0.1' && ip !== '0.0.0.0' && ip.toLowerCase() !== 'localhost') {
             if (!outgoingSenders.has(u)) outgoingSenders.set(u, new Map());
             const uMap = outgoingSenders.get(u);
             if (!uMap.has(ip)) {
               uMap.set(ip, new Sender({ 
                 universe: u, 
                 useUnicastDestination: ip,
                 reuseAddr: true,
                 port: SACN_UDP_PORT
               }));
               console.log(`[sACN Bridge] Route Created: Universe ${u} -> Unicast ${ip}`);
               routeCount++;
             }
          }
        }
        console.log(`[sACN Bridge] Loaded ${routeCount} route(s) for scene: ${sName}`);
      }
    }
  } catch(e) {
    console.warn('[sACN Bridge] Could not parse patches.yaml for routing:', e.message);
  }
}

// Load initial routes
loadRoutesForScene(sceneName);

// ── WebSocket Server ───────────────────────────────────────────────────
const wss = new WebSocketServer({ port: SACN_PORT });
let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  broadcastLog(`Browser connected (${clientCount} client(s))`, 'source');
  
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'setScene' && data.scene) {
        console.log(`[sACN Bridge] Browser requested route switch to scene: ${data.scene}`);
        loadRoutesForScene(data.scene);
      }
    } catch(e) {}
  });

  ws.on('close', () => { clientCount--; broadcastLog(`Browser disconnected (${clientCount} client(s))`, 'warn'); });
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

receiver.on('packet', (packet) => {
  const priority = packet.priority || 100;
  const sourceKey = packet.sourceName || 'Unknown';
  const universe = packet.universe || 1;

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
    for (const sender of ipTargets.values()) {
      sender.send({ payload, sourceName: 'MarsinRelay Engine', priority })
            .catch(err => console.error(`[sACN Bridge] Relay Error: ${err.message}`));
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
console.log('═'.repeat(56));

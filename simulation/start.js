#!/usr/bin/env node
/**
 * start.js — Reads ports from config/server_config.yaml and launches
 * both the static HTTP server and the save server.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPath = path.join(__dirname, 'config', 'server_config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
const HTTP_PORT = config.http_port || 6969;
const SAVE_PORT = config.save_port || 8181;

console.log(`[start] HTTP server on port ${HTTP_PORT}, Save server on port ${SAVE_PORT}`);
console.log(`[start] Open: http://localhost:${HTTP_PORT}/simulation/`);

const httpServer = spawn('npx', ['http-server', '../', '-p', String(HTTP_PORT), '-c-1', '--cors'], {
  stdio: 'inherit',
  cwd: __dirname,
});

const saveServer = spawn('node', ['server/save-server.js'], {
  stdio: 'inherit',
  cwd: __dirname,
});

// ── sACN Bridge (optional) ──────────────────────────────────────────────
const sacnConfig = config.sacn || {};
if (sacnConfig.enabled) {
  try {
    const { startSacnBridge } = require('./server/sacn_bridge');
    startSacnBridge({
      enabled: true,
      universes: sacnConfig.universes || [1],
      wsPort: sacnConfig.ws_port || 5555,
    });
  } catch (err) {
    console.warn(`[start] sACN bridge failed to start: ${err.message}`);
    console.warn(`[start] Install dependencies: npm install sacn ws`);
  }
} else {
  console.log(`[start] sACN bridge disabled (set sacn.enabled: true in server_config.yaml)`);
}

function cleanup() {
  httpServer.kill();
  saveServer.kill();
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

httpServer.on('exit', (code) => {
  if (code !== null) console.log(`[start] HTTP server exited with code ${code}`);
});

saveServer.on('exit', (code) => {
  if (code !== null) console.log(`[start] Save server exited with code ${code}`);
});

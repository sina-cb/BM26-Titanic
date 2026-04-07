#!/usr/bin/env node
/**
 * start.js — Reads ports from config/server_config.yaml and launches
 * the static HTTP server, save server, and sACN bridge.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPath = path.join(__dirname, 'config', 'server_config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
const HTTP_PORT = config.http_port || 6969;
const SAVE_PORT = config.save_port || HTTP_PORT + 1;
const SACN_PORT = config.sacn_port || HTTP_PORT + 2;

console.log(`[start] HTTP: ${HTTP_PORT}  Save: ${SAVE_PORT}  sACN: ${SACN_PORT}`);
console.log(`[start] Open: http://localhost:${HTTP_PORT}/simulation/`);

const httpServer = spawn('npx', ['http-server', '../', '-p', String(HTTP_PORT), '-c-1', '--cors'], {
  stdio: 'inherit',
  cwd: __dirname,
});

const saveServer = spawn('node', ['server/save-server.js'], {
  stdio: 'inherit',
  cwd: __dirname,
});

// sACN bridge — read scene config to check if enabled
let sacnEnabled = false;
try {
  const sceneConfig = yaml.load(fs.readFileSync(path.join(__dirname, 'config', 'scene_config.yaml'), 'utf8'));
  const cw = sceneConfig && sceneConfig.colorWave;
  if (cw && cw.sacn_enabled) {
    sacnEnabled = typeof cw.sacn_enabled === 'object' ? cw.sacn_enabled.value : cw.sacn_enabled;
  }
} catch (e) { /* ignore */ }

let sacnBridge = null;
if (sacnEnabled) {
  sacnBridge = spawn('node', ['server/sacn_bridge.js'], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  sacnBridge.on('exit', (code) => {
    if (code !== null && code !== 0) console.log(`[start] sACN bridge exited with code ${code}`);
  });
} else {
  console.log(`[start] sACN bridge disabled (set colorWave.sacn_enabled: true in scene_config.yaml)`);
}

// sACN output bridge — always starts (for sending DMX to real controllers)
const sacnOutputBridge = spawn('node', ['server/sacn_output_bridge.js'], {
  stdio: 'inherit',
  cwd: __dirname,
});
sacnOutputBridge.on('exit', (code) => {
  if (code !== null && code !== 0) console.log(`[start] sACN output bridge exited with code ${code}`);
});

function cleanup() {
  httpServer.kill();
  saveServer.kill();
  if (sacnBridge) sacnBridge.kill();
  sacnOutputBridge.kill();
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


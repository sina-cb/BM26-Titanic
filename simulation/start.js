#!/usr/bin/env node
/**
 * start.js — Reads ports from config/server_config.yaml and launches
 * the static HTTP server, save server, and sACN bridge.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPath = path.join(__dirname, 'config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
const HTTP_PORT = config.http_port || 6969;
const SAVE_PORT = config.save_port || HTTP_PORT + 1;
const SACN_PORT = config.sacn_port || HTTP_PORT + 2;
const SACN_OUTPUT_PORT = config.sacn_output_port || 6972;

// ── Scene selection via --scene <name> ──────────────────────────────────
const sceneIdx = process.argv.indexOf('--scene');
const sceneName = sceneIdx !== -1 && process.argv[sceneIdx + 1] ? process.argv[sceneIdx + 1] : 'titanic';
const sceneConfigPath = path.join(__dirname, 'scenes', sceneName, 'scene_config.yaml');

console.log(`[start] HTTP: ${HTTP_PORT}  Save: ${SAVE_PORT}  sACN Bridge: ${SACN_PORT}  sACN Output: ${SACN_OUTPUT_PORT}`);
console.log(`[start] Scene: ${sceneName}`);
console.log(`[start] Config: ${sceneConfigPath}`);

const sceneUrl = `http://localhost:${HTTP_PORT}/simulation/?scene=${sceneName}`;
console.log(`[start] Open: ${sceneUrl}`);

const httpServer = spawn('npx', ['http-server', '../', '-p', String(HTTP_PORT), '-c-1', '--cors'], {
  stdio: 'inherit',
  cwd: __dirname,
  shell: process.platform === 'win32',
});

const saveServer = spawn('node', ['server/save-server.js'], {
  stdio: 'inherit',
  cwd: __dirname,
});

let sacnBridge = null;
const bridgeArgs = ['server/sacn_bridge.js'];
if (sceneName) bridgeArgs.push('--scene', sceneName);
sacnBridge = spawn('node', bridgeArgs, {
  stdio: 'inherit',
  cwd: __dirname,
});
sacnBridge.on('exit', (code) => {
  if (code !== null && code !== 0) console.log(`[start] sACN bridge exited with code ${code}`);
});


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


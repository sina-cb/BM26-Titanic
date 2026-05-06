#!/usr/bin/env node
/**
 * start.mjs — CaptainPad Expo Startup (iOS/Android only)
 *
 * Usage:
 *   npm start           # Start Expo dev server
 *   npm run start:k     # Kill port before starting
 *   npm run start:kc    # Kill port + clear Metro cache
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);
const shouldKillPort = args.includes('-k') || args.includes('--kill');
const expoArgs = args.filter(a => a !== '-k' && a !== '--kill');

let port = 6967;
try {
  const cfg = yaml.load(fs.readFileSync(path.join(rootDir, '..', 'marsin_engine', 'config.yaml'), 'utf8'));
  if (cfg?.web_client?.port) port = cfg.web_client.port;
} catch (e) { /* use default */ }

// Clean stale dist/ (crashes Metro file watcher on Windows)
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  try { fs.rmSync(distDir, { recursive: true, force: true }); } catch (e) {}
}

// Kill port if -k flag is passed
if (shouldKillPort) {
  console.log(`\n  🧹 Killing port ${port}...`);
  let killed = false;

  // 1. Kill any zombie 'web-watch.js' or 'serve dist' processes that hold/respawn the port
  if (isWin) {
    try {
      const procs = execSync('wmic process get processid,commandline /format:csv', { encoding: 'utf8' });
      const zombiePatterns = [`serve dist -p ${port}`, 'web-watch.js'];
      for (const line of procs.split('\n')) {
        if (zombiePatterns.some(p => line.includes(p))) {
          const parts = line.trim().split(',');
          const pid = parts[parts.length - 1]?.trim();
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); killed = true; } catch (e) {}
            console.log(`  🗑️  Killed zombie process (PID ${pid})`);
          }
        }
      }
    } catch (e) { /* wmic may not be available */ }
  }

  // 2. Kill whatever is listening on the port
  try {
    if (isWin) {
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== '0') {
            try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); killed = true; } catch (e) {}
          }
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: 'ignore' });
      killed = true;
    }
  } catch (e) { /* nothing on port */ }

  // 3. Wait for OS to release the port after killing
  if (killed) {
    console.log(`  ⏳ Waiting for port ${port} to be released...`);
    const deadline = Date.now() + 5000; // up to 5 seconds
    while (Date.now() < deadline) {
      try {
        const check = execSync(`netstat -ano`, { encoding: 'utf8' });
        const stillListening = check.split('\n').some(l => l.includes(`:${port}`) && l.includes('LISTENING'));
        if (!stillListening) break;
        // A zombie may have respawned — kill it again
        for (const line of check.split('\n')) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const pid = line.trim().split(/\s+/).pop();
            if (pid && pid !== '0') {
              try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
            }
          }
        }
      } catch (e) { break; }
      // Busy-wait 200ms
      const wait = Date.now() + 200;
      while (Date.now() < wait) {}
    }
    console.log(`  ✅ Port ${port} is free.`);
  }

  // 4. Clean stale dist/ (crashes Metro file watcher on Windows)
  if (fs.existsSync(distDir)) {
    try { fs.rmSync(distDir, { recursive: true, force: true }); console.log('  🗑️  Removed stale dist/'); } catch (e) {}
  }
}

// Start Expo
console.log(`\n  🚀 Starting Expo on port ${port}...\n`);
const proc = spawn(isWin ? 'npx.cmd' : 'npx',
  ['expo', 'start', '--go', '--port', port.toString(), ...expoArgs],
  { cwd: rootDir, stdio: 'inherit', shell: isWin }
);

proc.on('close', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => proc.kill('SIGINT'));
process.on('SIGTERM', () => proc.kill('SIGTERM'));

#!/usr/bin/env node
'use strict';

// Resolve operator shortcut URLs from the launcher's authoritative profile
// registry plus the deployed simulation port map. This is imported by the
// laptop dry-run and executed again on the server after overlays are applied.

const path = require('path');

const [repoRoot, launcherProfile, scene] = process.argv.slice(2);
if (!repoRoot || !launcherProfile || !scene) {
  process.stderr.write('usage: shortcut_plan.cjs <repo-root> <launcher-profile> <scene>\n');
  process.exit(2);
}

const launcher = require(path.join(path.resolve(repoRoot), 'launcher.js'));
const profile = launcher.PROFILES[launcherProfile];
if (!profile) {
  process.stderr.write(`unknown launcher profile: ${launcherProfile}\n`);
  process.exit(3);
}
if (!profile.processes.includes('sim') || !profile.processes.includes('captainpad')) {
  process.stderr.write('launcher profile does not run both simulation and CaptainPad\n');
  process.exit(4);
}
if (!(profile.companions || []).includes('audio') || !launcher.COMPANIONS.audio) {
  process.stderr.write('launcher profile does not run the Audio Companion\n');
  process.exit(5);
}

const ports = launcher.readPorts();
const query = new URLSearchParams({ scene, ...launcher.SIM_QUERY_COMMON });
for (const [key, value] of Object.entries(profile.simParams)) {
  query.set(key, String(value));
}

const plan = {
  scene,
  launcherProfile,
  lightingProfile: profile.simParams.profile,
  simulation: `http://localhost:${ports.http_port}/simulation/?${query.toString()}`,
  audio: `http://localhost:${launcher.COMPANIONS.audio.port}/`,
  captainpad: `http://localhost:${ports.captainpad_web_port}/`,
};
process.stdout.write(JSON.stringify(plan));

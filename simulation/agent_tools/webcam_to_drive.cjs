#!/usr/bin/env node
/**
 * webcam_to_drive.cjs — upload a captured file to Google Drive via rclone,
 * for remote test-bench debugging.
 *
 * Why rclone (not an inlined API call): a webcam clip is megabytes. Uploading
 * through a tool that inlines the file as base64 is impractical (the encoded
 * payload is ~1.4x the bytes and tokenises ~2.4 tokens/char — a few MB becomes
 * millions of tokens). rclone streams the bytes directly, full quality, any
 * size. Credentials live in rclone's own config, never in this repo (offline /
 * no-secrets rules stay intact).
 *
 * One-time setup (do this on the bench once):
 *   winget install --id Rclone.Rclone -e
 *   rclone config            # create a remote named e.g. "gdrive" (type: drive)
 *
 * Usage:
 *   node webcam_to_drive.cjs --file <path> --remote "gdrive:Webcam Recordings"
 *
 * Flags:
 *   --file <path>      File to upload (required).
 *   --remote <r:dir>   rclone "remote:folder" destination (required), e.g.
 *                      "gdrive:Webcam Recordings".
 *   --name <name>      Rename on upload (default keeps the source filename).
 *   --rclone <path>    Explicit rclone binary (else PATH).
 *
 * Prints the destination "remote:folder/name" on success.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function flag(name) {
  return process.argv.includes(name);
}
function opt(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`❌ ${name} expects a value.`);
    process.exit(1);
  }
  return value;
}

// Fail loudly if rclone is missing — no silent skip (codex P0).
function findRclone(override) {
  if (override) {
    if (!fs.existsSync(override)) {
      console.error(`❌ --rclone path does not exist: ${override}`);
      process.exit(1);
    }
    return override;
  }
  const onPath = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'rclone';
  console.error(
    '❌ rclone not found. Install it with:  winget install --id Rclone.Rclone -e\n' +
    '   then configure a remote:  rclone config',
  );
  process.exit(1);
}

function main() {
  const file = opt('--file', null);
  const remote = opt('--remote', null);
  const rename = opt('--name', null);
  const rclone = findRclone(opt('--rclone', null));
  if (!file || !remote) {
    console.error('❌ Both --file and --remote are required.');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`❌ File not found: ${file}`);
    process.exit(1);
  }
  if (!remote.includes(':')) {
    console.error(`❌ --remote must be "remote:folder" (got: ${remote}). See: rclone listremotes`);
    process.exit(1);
  }
  // copyto when renaming (needs a full dest path); copy otherwise (keeps name).
  const name = rename || path.basename(file);
  const dest = `${remote.replace(/\/+$/, '')}/${name}`;
  const rcArgs = rename
    ? ['copyto', file, dest, '--progress']
    : ['copy', file, remote, '--progress'];
  console.error(`☁️  Uploading ${path.basename(file)} → ${dest}`);
  const res = spawnSync(rclone, rcArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (res.status !== 0) {
    console.error(`❌ rclone exited ${res.status}. Check the remote name with: rclone listremotes`);
    process.exit(1);
  }
  console.log(dest);
}

main();

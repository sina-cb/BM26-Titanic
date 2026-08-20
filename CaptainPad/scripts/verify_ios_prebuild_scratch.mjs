#!/usr/bin/env node
/**
 * Non-mutating iOS prebuild freshness check.
 *
 * Copies CaptainPad to ~/tmp/, runs `expo prebuild --platform ios --clean`
 * there, and compares semantic native outputs against app.json. Never writes
 * into the repo's gitignored ios/ folder.
 *
 * Usage (from CaptainPad/):
 *   node scripts/verify_ios_prebuild_scratch.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const EXCLUDE = new Set([
  'node_modules',
  'ios',
  'android',
  '.expo',
  'dist',
  'web-build',
]);

function copyProject(destRoot) {
  const src = ROOT.endsWith('/') ? ROOT : `${ROOT}/`;
  const result = spawnSync(
    'rsync',
    [
      '-a',
      ...Array.from(EXCLUDE).flatMap((name) => ['--exclude', name]),
      src,
      `${destRoot}/`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function plistValue(xml, key) {
  const re = new RegExp(`<key>${key}</key>\\s*([\\s\\S]*?)(?=\\s*<key>|\\s*</dict>)`, 'm');
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

function plistString(xml, key) {
  const block = plistValue(xml, key);
  if (!block) return null;
  const match = block.match(/<string>([^<]*)<\/string>/);
  return match ? match[1] : block.replace(/<\/?string>/g, '');
}

function plistIncludes(xml, key, needle) {
  const block = plistValue(xml, key);
  return block != null && block.includes(needle);
}

function pbxBundleId(pbxproj) {
  const match = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;/);
  return match ? match[1].replace(/"/g, '') : null;
}

function run() {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'captainpad-prebuild-verify-'));
  console.log(`Scratch copy: ${scratchRoot}`);

  try {
    copyProject(scratchRoot);

    const npmCi = spawnSync('npm', ['ci', '--prefer-offline'], {
      cwd: scratchRoot,
      stdio: 'inherit',
    });
    if (npmCi.status !== 0) {
      process.exit(npmCi.status ?? 1);
    }

    const prebuild = spawnSync(
      'npx',
      ['expo', 'prebuild', '--platform', 'ios', '--clean', '--no-install'],
      { cwd: scratchRoot, stdio: 'inherit' },
    );
    if (prebuild.status !== 0) {
      process.exit(prebuild.status ?? 1);
    }

    const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
    const ios = appJson.expo.ios;
    const infoPlist = readFileSync(join(scratchRoot, 'ios', 'CaptainPad', 'Info.plist'), 'utf8');
    const pbxproj = readFileSync(join(scratchRoot, 'ios', 'CaptainPad.xcodeproj', 'project.pbxproj'), 'utf8');

    const checks = [
      ['CFBundleDisplayName', 'CaptainPad', plistString(infoPlist, 'CFBundleDisplayName')],
      ['PRODUCT_BUNDLE_IDENTIFIER', ios.bundleIdentifier, pbxBundleId(pbxproj)],
      ['NSBonjourServices contains _marsinengine._tcp', true, plistIncludes(infoPlist, 'NSBonjourServices', '_marsinengine._tcp')],
      ['ITSAppUsesNonExemptEncryption false', true, (() => {
        const block = plistValue(infoPlist, 'ITSAppUsesNonExemptEncryption');
        return block === '<false/>' || block === 'false';
      })()],
      ['UIRequiresFullScreen true', true, infoPlist.includes('<key>UIRequiresFullScreen</key>\n    <true/>')],
      ['RCTNewArchEnabled true', true, infoPlist.includes('<key>RCTNewArchEnabled</key>\n    <true/>')],
    ];

    let failed = 0;
    for (const [label, expected, actual] of checks) {
      const ok = actual === expected;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${String(expected)}, got ${String(actual)}`);
      if (!ok) failed += 1;
    }

    if (/DEVELOPMENT_TEAM\s*=\s*[A-Z0-9]{10}/.test(pbxproj)) {
      console.log('FAIL pbxproj contains a baked DEVELOPMENT_TEAM (should be empty after prebuild)');
      failed += 1;
    } else {
      console.log('PASS pbxproj has no baked DEVELOPMENT_TEAM');
    }

    if (failed > 0) {
      console.error(`\n${failed} check(s) failed. Update app.json/plugins, not ios/.`);
      process.exit(1);
    }

    console.log('\nAll semantic prebuild checks passed. ios/ is regenerable from tracked config.');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

run();

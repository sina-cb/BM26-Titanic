#!/usr/bin/env node
/**
 * led_gamma_push.cjs — CLI front end for the LED controller's per-channel
 * gamma correction (the strand "vibrancy" knob).
 *
 * ALL the discipline — full-config backup → partial gamma write → reboot-aware
 * read-back verify — lives in ../server/led_gamma_service.cjs, which the sim's
 * Controllers UI drives through the save-server route POST /led/gamma-push.
 * This file is only argument parsing + printing, so the CLI and the UI can
 * never drift apart.
 *
 * WHY: strand PWM is linear in the wire byte, so an authored mid-level lands at
 * half the photons instead of half the perceived brightness — mids and pastels
 * read washed-out next to the DMX pars. The LED controller can apply a
 * per-channel gamma curve to fix exactly that, and it is the ONLY gamma in the
 * chain (the sACN mapper deliberately emits linear bytes — see
 * simulation/src/dmx/led_wire.js).
 *
 * DEFAULT CURVE: r=2.2 g=2.2 b=2.2 w=1.0
 *   The W exponent is 1.0 on purpose. The controller derives its white channel
 *   AFTER applying the R/G/B curve, so the white it emits has already been
 *   corrected once; a second exponent on W compounds with the first and crushes
 *   whites and pastels. Trim W only if the white emitter is measured to need
 *   it, and trim it relative to 1.0.
 *
 * USAGE (from simulation/agent_tools/):
 *   node led_gamma_push.cjs --host 10.1.1.60 --read
 *   node led_gamma_push.cjs --host 10.1.1.60                 # push default curve
 *   node led_gamma_push.cjs --host 10.1.1.60 --gamma 2.0,2.0,2.0,1.0
 *   node led_gamma_push.cjs --host 10.1.1.60 --revert         # back to 1,1,1,1 (off)
 *   node led_gamma_push.cjs --host 10.1.1.60 --restore <backup.json>
 *
 * Prefer the sim UI for anything fleet-wide: the Controllers panel has
 * per-controller gamma fields, a per-card PUSH GAMMA, and a "Push gamma to ALL"
 * fleet action that also keeps the scene mirror in step.
 *
 * Discovery note: these controllers do not answer ICMP — probe over HTTP
 * (`GET /api/status`), never ping (docs/41 §2).
 */

const fs = require('fs');
const {
  DEFAULT_GAMMA,
  OFF_GAMMA,
  parseGammaSpec,
  pushGamma,
  readGamma,
  validateGamma,
} = require('../server/led_gamma_service.cjs');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
function has(name) { return process.argv.includes(name); }

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

(async () => {
  const host = arg('--host');
  if (!host) die('--host <ip> is required (HTTP probe only — these controllers ignore ICMP)');

  if (has('--read')) {
    const info = await readGamma(host).catch((e) => die(e.message));
    console.log(`🔌 ${host} → controller "${info.controllerId || info.deviceName || host}"`);
    console.log(`   current gamma: ${JSON.stringify(info.gamma)}`);
    return;
  }

  let target;
  if (has('--revert')) {
    target = OFF_GAMMA;
  } else if (has('--restore')) {
    const file = arg('--restore');
    if (!file) die('--restore needs a backup file path');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved.gamma) die(`${file} carries no gamma block`);
    target = validateGamma(saved.gamma);
  } else if (has('--gamma')) {
    target = parseGammaSpec(arg('--gamma'));
  } else {
    target = DEFAULT_GAMMA;
  }

  const result = await pushGamma(host, target, { onLog: (m) => console.log(m) })
    .catch((e) => die(e.message));

  console.log('\nNow mirror it for the sim preview (scenes/<scene>/controllers.yaml, LED controller):');
  console.log('  led:\n    wire:\n      controllerGamma: ' +
    `{ r: ${target.r}, g: ${target.g}, b: ${target.b}, w: ${target.w} }`);
  console.log('  (the sim Controllers panel does this for you — gamma fields + PUSH GAMMA)');
  console.log(`\nRevert:  node led_gamma_push.cjs --host ${host} --revert`);
  console.log(`Restore: node led_gamma_push.cjs --host ${host} --restore "${result.backupPath}"`);
})();

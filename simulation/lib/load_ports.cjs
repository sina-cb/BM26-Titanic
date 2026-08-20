/**
 * load_ports.cjs — Single fail-loud reader for the simulation port map (plus
 * the one machine-local network setting that lives beside it, `sacn_interface`).
 *
 * Reads simulation/config.yaml. A missing or non-integer configurable port is a
 * HARD ERROR — no silent `|| default` guessing that hides a typo'd/renamed key
 * (codex P0: fail loudly). `sacn_udp_port` keeps the E1.31 standard 5568 as a
 * documented constant default because it is fixed by the protocol, not a free
 * choice.
 *
 * PORT OVERRIDE (report 20260725_115 P2-6): `BM26_SIM_CONFIG`, when set, points
 * every sim-stack reader (start.js, save-server.js, both sACN bridges) AND the
 * launcher at an ALTERNATE config file — so the whole constellation can run on
 * throwaway ports for tests (double-launch, launch-during-shutdown, the TOCTOU
 * lock window, IPv4/IPv6 port shadowing) WITHOUT seizing the operator's live
 * :6969-:6972 / UDP 5568. It wins over the passed/default path when set. Same
 * fail-loud contract as MARSIN_CONFIG_FILE: a set-but-unreadable value throws
 * here (readFileSync), never falls back to the real config. Unset = byte-for-
 * byte the shipped behavior.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SACN_E131_UDP_PORT = 5568; // fixed by the E1.31 standard — never renumber

function loadSimPorts(configPath = path.join(__dirname, '..', 'config.yaml')) {
  const resolvedPath = process.env.BM26_SIM_CONFIG || configPath;
  const cfg = yaml.load(fs.readFileSync(resolvedPath, 'utf8')) || {};
  const requireInt = (key) => {
    const v = cfg[key];
    if (!Number.isInteger(v)) {
      throw new Error(
        `[config] '${key}' missing or not an integer in ${resolvedPath} — ` +
        'refusing to guess a port. Fix simulation/config.yaml.'
      );
    }
    return v;
  };
  const requireOptionalString = (key) => {
    const v = cfg[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new Error(
        `[config] '${key}' is present in ${resolvedPath} but is not a non-empty string ` +
        `(got ${JSON.stringify(v)}) — remove the key or give it a real value.`
      );
    }
    return v.trim();
  };
  return {
    http_port: requireInt('http_port'),
    save_port: requireInt('save_port'),
    sacn_port: requireInt('sacn_port'),
    sacn_output_port: requireInt('sacn_output_port'),
    sacn_udp_port: Number.isInteger(cfg.sacn_udp_port) ? cfg.sacn_udp_port : SACN_E131_UDP_PORT,
    // The engine's API port — the sACN bridge polls :<port>/status so the
    // hardware relay follows the ENGINE's active scene (2026-07-24 fix).
    marsin_engine_port: requireInt('marsin_engine_port'),
    // OPTIONAL, machine-local: the IPv4 address (or adapter name) the sACN
    // input bridge pins its multicast joins to. Absent means "let the OS route
    // the join" — the shipped behavior, logged verbatim at boot. Present but
    // not a non-empty string is a typo, and typos fail loudly here rather than
    // as a mystery `addMembership EINVAL` a tick later (report 20260725_99).
    sacn_interface: requireOptionalString('sacn_interface'),
  };
}

module.exports = { loadSimPorts, SACN_E131_UDP_PORT };

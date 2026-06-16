/**
 * load_ports.cjs — Single fail-loud reader for the simulation port map.
 *
 * Reads simulation/config.yaml. A missing or non-integer configurable port is a
 * HARD ERROR — no silent `|| default` guessing that hides a typo'd/renamed key
 * (codex P0: fail loudly). `sacn_udp_port` keeps the E1.31 standard 5568 as a
 * documented constant default because it is fixed by the protocol, not a free
 * choice.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SACN_E131_UDP_PORT = 5568; // fixed by the E1.31 standard — never renumber

function loadSimPorts(configPath = path.join(__dirname, '..', 'config.yaml')) {
  const cfg = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
  const requireInt = (key) => {
    const v = cfg[key];
    if (!Number.isInteger(v)) {
      throw new Error(
        `[config] '${key}' missing or not an integer in ${configPath} — ` +
        'refusing to guess a port. Fix simulation/config.yaml.'
      );
    }
    return v;
  };
  return {
    http_port: requireInt('http_port'),
    save_port: requireInt('save_port'),
    sacn_port: requireInt('sacn_port'),
    sacn_output_port: requireInt('sacn_output_port'),
    sacn_udp_port: Number.isInteger(cfg.sacn_udp_port) ? cfg.sacn_udp_port : SACN_E131_UDP_PORT,
  };
}

module.exports = { loadSimPorts, SACN_E131_UDP_PORT };

/**
 * kill-ports.js — Free the simulation's ports before `npm start`.
 *
 * Offline-safe: uses the shared identity-checked killer (lsof/netstat), NOT
 * `npx kill-port` (which fetches from the network — fatal on the playa). Reads
 * the port map fail-loud from simulation/config.yaml.
 */
const { loadSimPorts } = require('../lib/load_ports.cjs');
const { freeStackPorts } = require('../../tools/port_cleanup.cjs');

const p = loadSimPorts();
const ports = [p.http_port, p.save_port, p.sacn_port, p.sacn_output_port];

console.log(`Freeing ports: ${ports.join(', ')}`);
const { foreign } = freeStackPorts(ports, { log: (m) => console.log(m) });
for (const f of foreign) {
  console.warn(`  ⚠ port ${f.port} held by a non-stack process (pid ${f.pid}: ${f.cmd.slice(0, 80)}) — not killing it; the bind will fail loudly if it's still there.`);
}

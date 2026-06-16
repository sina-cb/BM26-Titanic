/**
 * port_cleanup.cjs — Offline-safe, zero-dependency port inspection + cleanup.
 *
 * Shared by launcher.js, simulation/start.js's pre-kill, and the marsin_engine
 * boot so NOTHING in the stack shells out to `npx kill-port` (which tries to
 * fetch the package from the network — fatal on the offline playa). Uses only
 * OS tools that are always present: `lsof`/`ps` on POSIX, `netstat`/`taskkill`/
 * PowerShell on Windows.
 *
 * Cleanup is IDENTITY-CHECKED: a process listening on one of our ports is only
 * killed if its command line matches a known stack entrypoint. Anything else is
 * left alone (and reported), so we never kill a process we don't own.
 */

const { execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

// Command-line fragments that identify a process as part of this stack.
const STACK_PROCESS_SIGNATURES = [
  'start.js', 'engine.js', 'save-server.js', 'sacn_bridge.js',
  'sacn_output_bridge.js', 'http-server', 'expo', 'metro', 'launcher.js',
];

/**
 * PIDs listening on a TCP port (or bound to a UDP port). POSIX uses lsof,
 * Windows uses netstat. Returns [] when nothing matches.
 * @param {number} port
 * @param {object} [opts]
 * @param {boolean} [opts.udp=false] inspect UDP instead of listening TCP
 * @returns {number[]}
 */
function listenersOnPort(port, opts = {}) {
  const udp = opts.udp === true;
  if (IS_WIN) {
    const out = execFileSync('netstat', ['-ano', '-p', udp ? 'udp' : 'tcp'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      // TCP: "TCP <local> <remote> LISTENING <pid>"; UDP: "UDP <local> *:* <pid>"
      if (cols[0] !== (udp ? 'UDP' : 'TCP')) continue;
      if (!udp && cols[3] !== 'LISTENING') continue;
      if (cols[1] && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[cols.length - 1]));
    }
    return [...pids];
  }
  const sel = udp ? `-iUDP:${port}` : `-iTCP:${port}`;
  const args = udp ? ['-t', '-nP', sel] : ['-t', '-nP', sel, '-sTCP:LISTEN'];
  try {
    const out = execFileSync('lsof', args, { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
  } catch (err) {
    if (err.status === 1) return []; // lsof exits 1 when nothing matches
    if (err.code === 'ENOENT') {
      throw new Error('lsof not found — install it or free the stack ports manually.');
    }
    throw err;
  }
}

/** Full command line of a PID ('' if the process is already gone). */
function commandlineOf(pid) {
  try {
    if (IS_WIN) {
      const out = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], { encoding: 'utf8' });
      return out.trim();
    }
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function killPid(pid) {
  try {
    if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch (err) {
    // Already gone.
  }
}

/**
 * Free a set of ports of OUR stale stack processes (identity-checked). Foreign
 * processes are never killed; their ports are returned so the caller can decide
 * (we let the subsequent bind fail loud with EADDRINUSE rather than touching
 * something we don't own).
 *
 * @param {number[]} ports
 * @param {object} [opts]
 * @param {boolean} [opts.udp=false]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {{ killed:number[], foreign:Array<{port:number,pid:number,cmd:string}> }}
 */
function freeStackPorts(ports, opts = {}) {
  const udp = opts.udp === true;
  const log = opts.log || (() => {});
  const killed = [];
  const foreign = [];
  for (const port of ports) {
    for (const pid of listenersOnPort(port, { udp })) {
      if (pid === process.pid) continue;
      const cmd = commandlineOf(pid);
      if (!cmd) continue; // exited between listing and inspection
      if (STACK_PROCESS_SIGNATURES.some((sig) => cmd.includes(sig))) {
        log(`Freeing ${udp ? 'UDP' : 'TCP'} :${port} — killing stale stack process pid ${pid}`);
        killPid(pid);
        killed.push(pid);
      } else {
        foreign.push({ port, pid, cmd });
      }
    }
  }
  return { killed, foreign };
}

module.exports = {
  STACK_PROCESS_SIGNATURES,
  listenersOnPort,
  commandlineOf,
  killPid,
  freeStackPorts,
};

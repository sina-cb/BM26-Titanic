/**
 * sacn_receiver_boot.cjs — the boot-time correctness of the sACN INPUT
 * Receiver: WHICH interface it joins multicast on, WHEN it is allowed to be
 * subscribed to, and WHAT a socket error from it means.
 *
 * Why this module exists (report 20260725_99). The input bridge died at boot on
 * the operator's box with a bare, unhandled
 *
 *   Error: addMembership EINVAL
 *       at Socket.addMembership (node:dgram)
 *       at Socket.<anonymous> (node_modules/sacn/dist/receiver.js:46)
 *
 * and no other message. Three separate defects stacked up to produce it:
 *
 *  1. THE RACE (the root cause). `new Receiver({universes})` keeps the very
 *     array it is handed (`this.universes = universes`) and joins each entry
 *     from inside the socket's `listening` callback — i.e. a tick LATER.
 *     `sacn_bridge.js` then called `recomputeRoutes('boot')` synchronously, and
 *     `applyUniverseSubscriptions` → `receiver.addUniverse(u)` joins `u`
 *     immediately AND pushes it into that same array. When the deferred loop
 *     finally ran it joined `u` a SECOND time on the SAME socket, and a
 *     duplicate `IP_ADD_MEMBERSHIP` is `EINVAL` on Windows. Trigger condition:
 *     any universe in the boot recompute's union that was not in the boot list
 *     — e.g. a scene patched to a universe the `📡 Subscribed Universes` field
 *     does not name.
 *  2. NO ERROR LISTENER. The package reports constructor-time join failures as
 *     `receiver.emit('error', err)`. `sacn_bridge.js` had a `packet` listener
 *     and nothing else, so an EventEmitter `'error'` with no listener THREW —
 *     one bad group took the whole input bridge down, while the runtime path
 *     (`applyUniverseSubscriptions`) had per-universe isolation by design.
 *  3. NO INTERFACE VISIBILITY. `iface` was never passed, so the OS picked the
 *     multicast interface and the log never said which one — leaving the true
 *     environmental EINVAL causes (no IPv4 on the chosen NIC, a VPN adapter
 *     winning the default route) undiagnosable from the transcript.
 *
 * Everything here is PURE (no sockets, no fs) so the invariants are unit
 * tested; `sacn_bridge.js` owns the imperative half.
 */
'use strict';

/**
 * Flatten `os.networkInterfaces()` into the external IPv4 candidates a
 * multicast join can actually use.
 *
 * @param {Object} interfaces `os.networkInterfaces()` output.
 * @returns {Array<{name:string, address:string, netmask:string}>} in
 *          enumeration order (stable for a given box + link state).
 */
function listIpv4Interfaces(interfaces) {
  const out = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const a of addrs || []) {
      // Node <18 reported family as 'IPv4', >=18 as 4. Accept both — this is a
      // shape difference, not a condition worth guessing about.
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal) continue;
      out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/**
 * Decide the local interface the Receiver joins its multicast groups on.
 *
 * NOT a fallback ladder — exactly two outcomes, both explicit:
 *   - `requested` set  → that interface, or a THROW naming what the box has.
 *     A typo'd or unplugged NIC never silently becomes "some other NIC".
 *   - `requested` unset → `iface: undefined`, which is the unchanged, documented
 *     behavior (the OS routes the join by its own default). The report says so
 *     out loud and lists every candidate, so the operator can pin it.
 *
 * @param {Object} args
 * @param {string|null|undefined} args.requested `sacn_interface` from
 *        simulation/config.yaml — an IPv4 address or an interface name.
 * @param {Object} args.interfaces `os.networkInterfaces()` output.
 * @returns {{iface: (string|undefined), source: string,
 *            candidates: Array<{name:string,address:string,netmask:string}>,
 *            report: string[]}}
 *          `report` lines are logged verbatim at boot, `⚠` where it matters.
 * @throws {Error} when `requested` names nothing on this box, or names an
 *         interface carrying several IPv4 addresses (ambiguous — pick one).
 */
function resolveMulticastInterface({ requested, interfaces }) {
  const candidates = listIpv4Interfaces(interfaces);
  const inventory = candidates.length
    ? candidates.map(c => `${c.name} ${c.address}/${c.netmask}`).join(' | ')
    : '(none)';

  const asked = (requested === undefined || requested === null) ? '' : String(requested).trim();
  if (asked.length > 0) {
    const byAddress = candidates.filter(c => c.address === asked);
    const byName = candidates.filter(c => c.name === asked);
    const matches = byAddress.length ? byAddress : byName;
    if (matches.length === 0) {
      throw new Error(
        `[sACN Bridge] sacn_interface '${asked}' (simulation/config.yaml) matches no external ` +
        `IPv4 interface on this machine. Available: ${inventory}. Refusing to join multicast on ` +
        'a different interface than the one configured — fix the config or bring the interface up.');
    }
    if (matches.length > 1) {
      throw new Error(
        `[sACN Bridge] sacn_interface '${asked}' is ambiguous — it carries ${matches.length} IPv4 ` +
        `addresses (${matches.map(m => m.address).join(', ')}). Name the address, not the adapter.`);
    }
    const chosen = matches[0];
    return {
      iface: chosen.address,
      source: 'config',
      candidates,
      report: [
        `Multicast interface: ${chosen.address} (${chosen.name}) — pinned by sacn_interface in simulation/config.yaml.`,
        `IPv4 interfaces on this machine: ${inventory}`,
      ],
    };
  }

  const report = [
    'Multicast interface: OS DEFAULT (no sacn_interface in simulation/config.yaml). ' +
    'Set sacn_interface to the lighting-LAN address to pin it.',
    `IPv4 interfaces on this machine: ${inventory}`,
  ];
  if (candidates.length === 0) {
    report.push('⚠ No external IPv4 interface is up. Multicast joins will FAIL (addMembership EINVAL/ENODEV) ' +
      'and only UNICAST sACN (engine loopback frames, a sim window sending to 127.0.0.1) will be received.');
  } else if (candidates.length > 1) {
    report.push(`⚠ ${candidates.length} IPv4 interfaces are up — the OS picks which one receives multicast sACN, ` +
      'and it may not be the lighting LAN. Pin it with sacn_interface if fixtures go dark.');
  }
  return { iface: undefined, source: 'os-default', candidates, report };
}

/**
 * The boot gate: nothing may subscribe to the Receiver until its socket is
 * listening and the package's own join loop has finished.
 *
 * This is ordering, not suppression — the deferred reason is replayed the
 * instant the gate opens, and every deferral is logged.
 *
 * @param {Object} args
 * @param {(reason:string)=>void} args.onDefer called with the recompute reason
 *        each time a call is held back.
 * @returns {{isOpen:()=>boolean, guard:(reason:string)=>boolean,
 *            open:()=>(string|null)}}
 *          `guard` returns true when the caller may proceed. `open` marks the
 *          gate open and returns the reason to replay (null when nothing was
 *          held back).
 */
function createBootGate({ onDefer }) {
  let open = false;
  let pending = null;
  return {
    isOpen: () => open,
    guard(reason) {
      if (open) return true;
      pending = reason;
      onDefer(reason);
      return false;
    },
    open() {
      open = true;
      const replay = pending;
      pending = null;
      return replay;
    },
  };
}

/**
 * Turn a Receiver `'error'` event into a decision plus an operator-readable
 * sentence. The two cases are deliberately different:
 *
 *   - `addMembership` → NOT fatal, and it matches what the runtime subscription
 *     path already does on a failed join (`applyUniverseSubscriptions`): the
 *     universe stays accepted for UNICAST, multicast on it is lost, and the log
 *     says exactly that. One unroutable group must not take the bridge down.
 *   - anything else (bind EADDRINUSE, ENETDOWN, …) → FATAL. The bridge cannot
 *     receive anything, and limping on would be a silent dark rig.
 *
 * @param {Error & {code?:string, syscall?:string}} err
 * @param {string} ifaceLabel human label for the interface in use.
 * @returns {{fatal:boolean, message:string}}
 */
function classifyReceiverError(err, ifaceLabel) {
  const code = (err && err.code) ? err.code : 'UNKNOWN';
  const syscall = (err && err.syscall) ? err.syscall : '';
  const text = (err && err.message) ? err.message : String(err);
  if (syscall === 'addMembership') {
    return {
      fatal: false,
      message: `⚠ Multicast JOIN FAILED at boot (${text}) on interface ${ifaceLabel}. ` +
        'UNICAST sACN on the affected universe still arrives; MULTICAST sources on it will NOT. ' +
        'Usual causes: the interface has no usable IPv4 address, or another adapter (VPN, virtual ' +
        'switch) owns the default multicast route. Pin the right one with sacn_interface in ' +
        'simulation/config.yaml.',
    };
  }
  return {
    fatal: true,
    message: `sACN receive socket FAILED (${code}${syscall ? ` on ${syscall}` : ''}): ${text}. ` +
      `Interface in use: ${ifaceLabel}. The input bridge cannot receive a single frame — refusing ` +
      'to run half-alive.',
  };
}

/**
 * The self-policing half of the race fix: after the socket is listening, the
 * Receiver's universe list must be EXACTLY the boot list. Anything extra was
 * pushed in before the package's join loop ran and has therefore been joined
 * twice — the `addMembership EINVAL` shape this module exists to kill.
 *
 * @param {Iterable<number>} bootUniverses the list handed to the constructor.
 * @param {Iterable<number>} currentUniverses `receiver.universes` at 'listening'.
 * @returns {{ok:boolean, extra:number[], message:(string|null)}}
 */
function checkBootSubscriptionInvariant(bootUniverses, currentUniverses) {
  const boot = new Set([...bootUniverses]);
  const extra = [...currentUniverses].filter(u => !boot.has(u));
  if (extra.length === 0) return { ok: true, extra: [], message: null };
  return {
    ok: false,
    extra,
    message: `sACN Receiver subscription RACE: universe(s) ${extra.join(', ')} were subscribed before ` +
      'the socket was listening, so the package\'s own boot join loop joined them a second time ' +
      '(duplicate IP_ADD_MEMBERSHIP = addMembership EINVAL on Windows). A caller reached ' +
      'recomputeRoutes() without going through the boot gate — fix the ordering, do not retry.',
  };
}

module.exports = {
  listIpv4Interfaces,
  resolveMulticastInterface,
  createBootGate,
  classifyReceiverError,
  checkBootSubscriptionInvariant,
};

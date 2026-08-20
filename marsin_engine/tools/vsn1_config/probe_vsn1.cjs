#!/usr/bin/env node
/*
  probe_vsn1.cjs — "is a VSN1 plugged in right now?", as a short-lived child.

  WHY A CHILD PROCESS (report _30 §1/§5): the engine process holds NO device
  handle and NO native addons — that is deliberate crash isolation, and it is
  why a serial-layer fault has never been able to kill the show. Answering the
  attach question in-process would mean requiring `serialport` (a native addon)
  into the engine and giving up that property. So the engine asks this ~40-line
  child instead, exactly like it already shells out to deploy_layout.cjs.

  This ONLY enumerates ports. It never OPENS one, so it cannot collide with the
  deploy CLI's exclusive hold on the port, and it is safe to call at any moment.

  Output: ONE line of JSON on stdout, always — attached or not.
    { "attached": true,  "path": "COM12", "vid": 12346, "pid": 33059 }
    { "attached": false, "path": null, "vid": null, "pid": null, "seen": [...] }
  `seen` lists the non-matching ports so a "detached" answer is diagnosable
  (wrong driver? device in bootloader with a different PID?).

  Exit codes (the engine reads THESE, not the text):
    0 — a VSN1 is attached
    3 — no VSN1 attached (a normal, expected state — NOT an error)
    1 — the probe itself failed (enumeration threw); attach state is UNKNOWN

  The 3-vs-1 split is the whole point: "no device" and "I could not tell" are
  different states and must never collapse into one (Codex P0 — no fallbacks).
*/
'use strict';

const gs = require('./grid_serial.cjs');

const EXIT_ATTACHED = 0;
const EXIT_DETACHED = 3;
const EXIT_ERROR = 1;

async function main() {
  const ports = await gs.listPorts();
  const match = ports.find(gs.isVsn1);
  if (match) {
    process.stdout.write(`${JSON.stringify({
      attached: true, path: match.path, vid: match.vid, pid: match.pid,
    })}\n`);
    return EXIT_ATTACHED;
  }
  process.stdout.write(`${JSON.stringify({
    attached: false,
    path: null,
    vid: null,
    pid: null,
    seen: ports.map((p) => ({ path: p.path, vid: gs.hex4(p.vid), pid: gs.hex4(p.pid) })),
  })}\n`);
  return EXIT_DETACHED;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    // A genuine probe failure (driver stack error, permission denied). Loud on
    // stderr, exit 1 — the caller must treat this as UNKNOWN, never as
    // "detached", or a broken probe would silently disable deploys forever.
    process.stderr.write(`probe_vsn1: port enumeration failed: ${e.message}\n`);
    process.exitCode = EXIT_ERROR;
  });

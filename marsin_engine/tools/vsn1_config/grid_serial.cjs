/*
  grid_serial.cjs — shared serial/protocol plumbing for the vsn1_config tools
  (read_config.cjs, write_config.cjs, restore_config.cjs).

  Everything here is transport + codec glue around @intechstudio/grid-protocol;
  it contains NO device-mutating logic by itself. Callers decide what to send.

  Protocol facts encoded here (all live-verified against a VSN1L, fw 1.5.1):
    - USB VID:PID 0x303A:0x8123, 2 000 000 baud, DTR+RTS asserted on open.
    - Outbound frame = grid.encode_packet(descr).serial + LF(10).
    - Inbound frames split on LF(10) whose byte 3 positions back is EOT(4).
    - The device heartbeat arrives as HEARTBEAT/EXECUTE (not /REPORT), and
      piggybacks a PAGEACTIVE/REPORT with the currently active page.
    - Stored action strings use the `<?lua ... ?>` wrapper; GridScript.humanize
      yields `<lua ... >` and shortify does NOT restore the `<?...?>` form —
      toDeviceActionString() below applies the wrapper fix (validated as a
      45/45 exact round-trip against the factory page-0 dump).
*/
'use strict';

const { SerialPort } = require('serialport');

// ── Constants (verified against grid-editor configuration.json + serialport.ts)
const VSN1_VID = 0x303a; // Espressif / Intech ESP32-S3 native USB
const VSN1_PID = 0x8123; // Grid ESP32 application PID (USB_VID_2 / USB_PID_2)
const BAUD_RATE = 2000000;

const BYTE_EOT = 4;
const BYTE_LF = 10;

const HEARTBEAT_WAIT_MS = 6000; // device beats ~ every 250 ms
const FETCH_TIMEOUT_MS = 1500; // CONFIG/REPORT reply
const ACK_TIMEOUT_MS = 1500; // CONFIG/ACKNOWLEDGE reply (editor uses 500)

// PAGESTORE flash-commit time SCALES with the number of changed action
// strings on the page (the firmware bulk page-store walks every dirty
// config into littlefs, and NVM garbage collection can stall it further).
// Observed datapoints: a 15-string page blew a flat 5 s timeout; 26-string
// pages blew 10000+250/str (= 16.5 s) twice. Deploys are rare and pre-playa,
// so budget generously — false timeouts cost re-runs and confidence:
// 26-string layout page -> 39.5 s ceiling. A timeout may still be a LATE
// ACK: re-read the page before assuming the store failed.
const PAGESTORE_TIMEOUT_BASE_MS = 20000;
const PAGESTORE_TIMEOUT_PER_WRITE_MS = 750;

function pageStoreTimeout(writeCount) {
  return PAGESTORE_TIMEOUT_BASE_MS + PAGESTORE_TIMEOUT_PER_WRITE_MS * (writeCount || 0);
}

// ── Port discovery ────────────────────────────────────────────────────────────
async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    vid: p.vendorId ? parseInt(p.vendorId, 16) : null,
    pid: p.productId ? parseInt(p.productId, 16) : null,
    manufacturer: p.manufacturer || null,
  }));
}

function isVsn1(p) {
  return p.vid === VSN1_VID && p.pid === VSN1_PID;
}

function hex4(n) {
  return n === null || n === undefined ? '????' : `0x${n.toString(16).padStart(4, '0')}`;
}

async function findVsn1Port() {
  const ports = await listPorts();
  const matches = ports.filter(isVsn1);
  if (matches.length === 0) {
    const seen = ports
      .map((p) => `${p.path} (VID:${hex4(p.vid)} PID:${hex4(p.pid)})`)
      .join('\n    ');
    throw new Error(
      `No VSN1 found (looking for VID:${hex4(VSN1_VID)} PID:${hex4(VSN1_PID)}).\n` +
        `  Serial ports seen:\n    ${seen || '(none)'}\n` +
        `  Is the VSN1 plugged in? Is the Grid Editor holding the port?`,
    );
  }
  if (matches.length > 1) {
    console.warn(
      `Multiple VSN1-class ports found; using the first: ` +
        matches.map((m) => m.path).join(', '),
    );
  }
  return matches[0].path;
}

// ── Frame assembler ───────────────────────────────────────────────────────────
// Accumulates raw serial bytes and emits complete Grid frames (EOT then LF).
class FrameAssembler {
  constructor() {
    this._buf = [];
  }

  push(chunk, onFrame) {
    for (const b of chunk) {
      this._buf.push(b);
    }
    let start = 0;
    for (let i = 0; i < this._buf.length; i++) {
      if (this._buf[i] === BYTE_LF && this._buf[i - 3] === BYTE_EOT) {
        // Frame is [start .. i) — excludes the trailing LF, matching grid-editor.
        onFrame(this._buf.slice(start, i));
        start = i + 1;
      }
    }
    this._buf = this._buf.slice(start);
  }
}

// ── Promise helpers over the serialport callback API ─────────────────────────
function openPort(portPath) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: BAUD_RATE }, (err) => {
      if (err) {
        reject(
          new Error(
            `Could not open ${portPath}: ${err.message}\n` +
              `  If the port is busy, close the Grid Editor (it holds the port ` +
              `exclusively).`,
          ),
        );
        return;
      }
      // Explicitly assert DTR + RTS: the VSN1 is a USB-CDC device and some
      // driver/OS combos gate device TX on DTR. Don't rely on open defaults.
      port.set({ dtr: true, rts: true }, (setErr) => {
        if (setErr) {
          reject(new Error(`Could not assert DTR/RTS on ${portPath}: ${setErr.message}`));
        } else {
          resolve(port);
        }
      });
    });
  });
}

function closePort(port) {
  return new Promise((resolve) => {
    if (!port.isOpen) {
      resolve();
      return;
    }
    port.close(() => resolve());
  });
}

function writePort(port, bytes) {
  return new Promise((resolve, reject) => {
    port.write(Buffer.from(bytes), (err) => {
      if (err) {
        reject(new Error(`Serial write failed: ${err.message}`));
      } else {
        resolve();
      }
    });
  });
}

// Register a one-shot predicate waiter on a waiters array; resolves with the
// first matching decoded class, rejects on timeout. Self-deregistering.
function waitForClass(waiters, predicate, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    const waiter = (classObj) => {
      if (predicate(classObj)) {
        clearTimeout(timer);
        remove();
        resolve(classObj);
      }
    };

    const remove = () => {
      const idx = waiters.indexOf(waiter);
      if (idx !== -1) {
        waiters.splice(idx, 1);
      }
    };

    waiters.push(waiter);
  });
}

// ── Connection: port + frame assembly + decode + waiter fan-out ───────────────
// Returns { port, waiters, send(descr), waitFor(...), connectInfo() }.
async function connect(gp, portPath) {
  const { grid } = gp;
  const port = await openPort(portPath);
  const assembler = new FrameAssembler();
  const waiters = [];

  port.on('data', (chunk) => {
    assembler.push(chunk, (frame) => {
      const classArray = grid.decode_packet_frame(frame);
      if (!classArray) {
        return; // checksum/frame error — decoder already logged it
      }
      grid.decode_packet_classes(classArray);
      for (const c of classArray) {
        // Snapshot: a waiter may deregister others while we iterate.
        for (const w of [...waiters]) {
          w(c);
        }
      }
    });
  });

  return {
    port,
    waiters,
    // Encode a descriptor and write it to the wire (+ LF terminator).
    async send(descr) {
      const packet = grid.encode_packet(descr);
      if (packet === undefined) {
        throw new Error(
          `encode_packet returned undefined for ${descr.class_name}/${descr.class_instr}.`,
        );
      }
      await writePort(port, Uint8Array.from([...packet.serial, BYTE_LF]));
      return packet;
    },
    waitFor(predicate, timeoutMs, timeoutMessage) {
      return waitForClass(waiters, predicate, timeoutMs, timeoutMessage);
    },
    close() {
      return closePort(port);
    },
  };
}

// Wait for a heartbeat and derive module identity. NOTE: the device broadcasts
// HEARTBEAT/EXECUTE (verified live) — match on class name only.
async function waitForHeartbeat(gp, conn) {
  const { grid } = gp;
  const hb = await conn.waitFor(
    (c) => c.class_name === 'HEARTBEAT',
    HEARTBEAT_WAIT_MS,
    'No HEARTBEAT received. Is this a Grid device? Is the port already open ' +
      'in the Grid Editor?',
  );
  const hwcfg = hb.class_parameters.HWCFG;
  const moduleType = grid.module_type_from_hwcfg(hwcfg);
  if (moduleType === undefined) {
    throw new Error(`Unrecognized module hwcfg=${hwcfg}; cannot proceed.`);
  }
  return {
    moduleType,
    hwcfg,
    dx: hb.brc_parameters.SX,
    dy: hb.brc_parameters.SY,
    firmware:
      `${hb.class_parameters.VMAJOR}.${hb.class_parameters.VMINOR}` +
      `.${hb.class_parameters.VPATCH}`,
  };
}

// ── Descriptor builders (shapes verified against grid-editor instructions.ts) ─
function configFetchDescriptor(gp, dx, dy, page, elementIndex, eventType) {
  const version = gp.grid.getProperty('VERSION');
  return {
    brc_parameters: { DX: dx, DY: dy },
    class_name: 'CONFIG',
    class_instr: 'FETCH',
    class_parameters: {
      VERSIONMAJOR: version.MAJOR,
      VERSIONMINOR: version.MINOR,
      VERSIONPATCH: version.PATCH,
      PAGENUMBER: page,
      ELEMENTNUMBER: elementIndex,
      EVENTTYPE: eventType,
      ACTIONLENGTH: 0,
    },
  };
}

function configExecuteDescriptor(gp, dx, dy, page, elementIndex, eventType, actionString) {
  const version = gp.grid.getProperty('VERSION');
  return {
    brc_parameters: { DX: dx, DY: dy },
    class_name: 'CONFIG',
    class_instr: 'EXECUTE',
    class_parameters: {
      VERSIONMAJOR: version.MAJOR,
      VERSIONMINOR: version.MINOR,
      VERSIONPATCH: version.PATCH,
      PAGENUMBER: page,
      ELEMENTNUMBER: elementIndex,
      EVENTTYPE: eventType,
      ACTIONLENGTH: actionString.length,
      ACTIONSTRING: actionString,
    },
  };
}

function pageActiveDescriptor(page) {
  return {
    brc_parameters: { DX: -127, DY: -127 }, // broadcast, as grid-editor ChangePage
    class_name: 'PAGEACTIVE',
    class_instr: 'EXECUTE',
    class_parameters: { PAGENUMBER: page },
  };
}

function pageStoreDescriptor() {
  return {
    brc_parameters: { DX: -127, DY: -127 }, // broadcast, as grid-editor StorePage
    class_name: 'PAGESTORE',
    class_instr: 'EXECUTE',
    class_parameters: {},
  };
}

// RESET/EXECUTE — soft-REBOOT the module (the grid-editor "restart module"
// action). The MCU restarts: the serial port drops and re-enumerates a few
// seconds later; PAGESTORE'd config in NVM survives (verify on first use by
// reading the layout back). Hands-free equivalent of unplug/replug — the
// field remedy for the initial-load pad wedge (docs/42 Known issues).
// Fire-and-forget: a rebooting device cannot ACK the frame that reboots it.
function resetDescriptor() {
  return {
    brc_parameters: { DX: -127, DY: -127 },
    class_name: 'RESET',
    class_instr: 'EXECUTE',
    class_parameters: {},
  };
}

// IMMEDIATE/EXECUTE: run a Lua snippet ONCE on the module WITHOUT storing it
// (grid-editor SendConfigImmediate; class 0x085). It never touches flash and
// never counts against a page's 909-char config budget — the string only has
// to fit one frame. We use it to paint the "SYNCING…" reflash screen: the LCD
// keeps whatever was last drawn to its framebuffer until the next DRAW, and
// during a deploy the LCD's own DRAW handler is being torn down + rebuilt (each
// CONFIG write restarts the Lua VM), so an IMMEDIATE draw HOLDS on-screen for
// the whole flash. Addressed to a specific module (dx,dy) like the CONFIG path.
function immediateDescriptor(gp, dx, dy, actionString) {
  return {
    brc_parameters: { DX: dx, DY: dy },
    class_name: 'IMMEDIATE',
    class_instr: 'EXECUTE',
    class_parameters: {
      ACTIONLENGTH: actionString.length,
      ACTIONSTRING: actionString,
    },
  };
}

// ── Reflash "Loading…" screen (operator requirement) ─────────────────────────
// The temporary loading indicator shown on the VSN1 LCD whenever a CaptainPad
// effect change triggers a re-flash. Drawn via IMMEDIATE (above) right before a
// page's CONFIG writes begin, and cleared after PAGESTORE; it HOLDS for the
// whole flash because each CONFIG write tears down + rebuilds the LCD's own
// DRAW handler, so nothing repaints over it until we clear it.
// Uses the MODULE-GLOBAL gui_draw_* short names (no `self`) so it runs in the
// storeless IMMEDIATE context, not an element handler:
//   ggdaf = gui_draw_area_filled   ggdrrf = gui_draw_rectangle_rounded_filled
//   ggdft = gui_draw_fasttext      ggdsw  = gui_draw_swap  glsb = lcd_set_backlight
// draw_swap flips the framebuffer so the paint is visible immediately.
// Centering: box spans x 40..279 (239 wide). "Loading" = 7 glyphs * 32 px =
// 224 px -> x = 40 + (239-224)/2 ≈ 48. Subtitle 15 glyphs * 16 px = 240 px.
const SYNC_SCREEN_LUA =
  '<?lua --[[@cb]] ' +
  'glsb(255) ' +
  'ggdaf(0,0,319,239,{0,0,0}) ' +
  'ggdrrf(40,80,279,160,16,{226,88,34}) ' +
  'ggdft("Loading",48,102,32,{255,255,255}) ' +
  'ggdft("updating layout",42,176,16,{240,240,240}) ' +
  'ggdsw() ?>';

// Force the freshly-loaded page's LCD DRAW to repaint the live screen NOW,
// clearing the SYNCING overlay (dirty=1 makes the next DRAW frame render).
const SYNC_CLEAR_LUA = '<?lua --[[@cb]] dirty=1 ?>';

// Paint the SYNCING screen on the module. Fire-and-forget: IMMEDIATE gets no
// ACK. Best-effort — a failed draw must NOT abort a deploy, so callers wrap it.
async function drawSyncScreen(gp, conn, dx, dy) {
  await conn.send(immediateDescriptor(gp, dx, dy, SYNC_SCREEN_LUA));
}

// Clear the SYNCING screen (repaint the live screen). Fire-and-forget.
async function clearSyncScreen(gp, conn, dx, dy) {
  await conn.send(immediateDescriptor(gp, dx, dy, SYNC_CLEAR_LUA));
}

// Editor-style heartbeat. Firmware (grid-fw grid_decode.c heartbeat handler):
// a heartbeat with TYPE > 127 marks "editor connected" and sets
// page_change_enabled = (TYPE == 255). This matters because EVERY accepted
// CONFIG/EXECUTE sets page_change_enabled = 0 (unsaved-changes lock) and
// PAGESTORE does NOT re-enable it — only a TYPE-255 heartbeat (or reboot)
// does. Without it, PAGEACTIVE is silently ignored AND on-device Lua
// page_load() (our side buttons) refuses with a purple LED flash.
function editorHeartbeatDescriptor() {
  return {
    brc_parameters: { DX: -127, DY: -127 },
    class_name: 'HEARTBEAT',
    class_instr: 'EXECUTE',
    class_parameters: { TYPE: 255, HWCFG: 255, VMAJOR: 0, VMINOR: 0, VPATCH: 0 },
  };
}

// Re-enable page changes on the device (see editorHeartbeatDescriptor).
// Fire-and-forget by design — the firmware sends no reply to heartbeats.
async function enablePageChange(gp, conn) {
  await conn.send(editorHeartbeatDescriptor());
  await new Promise((r) => setTimeout(r, 100));
}

// Page-activation retry policy. The single-heartbeat-then-PAGEACTIVE approach
// is fragile: the re-enable heartbeat can be DROPPED at the reader (deploy-time
// Lua-error debug text interleaves with frames and surfaces as checksum
// mismatches, per README "Mid-deploy Lua-error noise"), or its effect may not
// have propagated before PAGEACTIVE arrives — either way PAGEACTIVE is silently
// ignored and we time out. So we RETRY: each round re-sends the TYPE-255
// heartbeat AND re-issues PAGEACTIVE, then waits a short slice for the device's
// heartbeat-piggybacked PAGEACTIVE/REPORT. Heartbeats are cheap and idempotent;
// re-sending keeps page_change_enabled latched ON across the whole dance.
const PAGE_ACTIVATE_ATTEMPTS = 6;
const PAGE_ACTIVATE_SLICE_MS = 1200; // per-attempt wait; device beats ~250 ms

// Make `page` the ACTIVE page and wait until the device CONFIRMS it.
// Firmware facts (grid-fw grid_decode.c / grid_ui.c) that force this dance:
//   - CONFIG/EXECUTE is NACKed unless its PAGENUMBER == the ACTIVE page.
//   - PAGEACTIVE/EXECUTE is silently ignored (no reply) if page changes are
//     disabled or a bulk operation is running.
//   - The active page only updates when the async bulk page-load COMPLETES.
// So: re-enable page changes, request the page, then wait for the device's
// own heartbeat piggyback (PAGEACTIVE/REPORT, ~every 250 ms) to announce the
// target page. Retries a bounded number of times, re-sending the enable
// heartbeat each round so a dropped heartbeat / still-locked page can recover
// without a power-cycle. Fails LOUD with an actionable message if it can't.
async function activatePage(gp, conn, page, timeoutMs) {
  // Total budget: caller override, else the retry ladder. A single dropped
  // heartbeat now costs one ~1.2 s slice, not the whole run.
  const attempts = PAGE_ACTIVATE_ATTEMPTS;
  const sliceMs = timeoutMs ? Math.max(500, Math.floor(timeoutMs / attempts)) : PAGE_ACTIVATE_SLICE_MS;

  let activated = false;
  for (let attempt = 1; attempt <= attempts && !activated; attempt++) {
    // Arm the confirmation waiter BEFORE sending, so a fast device reply
    // (its next ~250 ms heartbeat) can't race ahead of the registration.
    const confirmed = conn.waitFor(
      (c) =>
        c.class_name === 'PAGEACTIVE' &&
        c.class_instr === 'REPORT' &&
        Number(c.class_parameters.PAGENUMBER) === page,
      sliceMs,
      `slice timeout (attempt ${attempt})`,
    );
    // The slice timer can fire while the enable/send awaits below are still in
    // flight — at that instant nothing is awaiting `confirmed`, and Node kills
    // the process on the unhandled rejection (bare "slice timeout" crash, seen
    // live 2026-07-09 from the engine's auto-deploy spawn). Mark the rejection
    // handled up front; the `await confirmed` below still observes it.
    confirmed.catch(() => {});
    // Re-enable page changes (TYPE-255 heartbeat) then request the page. Doing
    // BOTH every round is what makes this robust: if the previous round's
    // heartbeat was dropped, this one re-latches page_change_enabled before the
    // PAGEACTIVE lands.
    await enablePageChange(gp, conn);
    await conn.send(pageActiveDescriptor(page));
    try {
      await confirmed;
      activated = true;
    } catch (err) {
      // Not confirmed this slice — loop and try again (re-heartbeat + re-send).
      if (attempt === attempts) {
        throw new Error(
          `VSN1 page-change is locked: the device did not report page ${page} ` +
            `active after ${attempts} attempts (~${Math.round((attempts * sliceMs) / 1000)} s). ` +
            `The device's page_change_enabled flag latched OFF after a config write ` +
            `and the TYPE-255 editor heartbeat did not clear it (common after an ` +
            `interrupted deploy). POWER-CYCLE the VSN1 (unplug/replug USB) and re-run.`,
        );
      }
    }
  }

  // CRITICAL BARRIER: the heartbeat reports the new page as active at the
  // START of the firmware's bulk page-load (grid_ui.c: page_activepage is
  // assigned before the Lua VM restart + NVM read). A CONFIG write sent in
  // that window is ACKed but its Lua registration is SILENTLY LOST (the
  // firmware only debug-prints "dostring failed" and ACKs anyway) — this
  // black-screened a deploy. A CONFIG/FETCH is the true barrier: its reply
  // needs the live Lua VM (debug.getinfo), so a REPORT proves the page load
  // fully completed. Poll until it answers.
  const probeBudgetMs = 5000;
  const probeDeadline = Date.now() + probeBudgetMs;
  for (;;) {
    try {
      const reply = conn.waitFor(
        (c) =>
          c.class_name === 'CONFIG' &&
          c.class_instr === 'REPORT' &&
          Number(c.class_parameters.PAGENUMBER) === page &&
          Number(c.class_parameters.ELEMENTNUMBER) === 0 &&
          Number(c.class_parameters.EVENTTYPE) === 0,
        500,
        'probe timeout',
      );
      // Same early-rejection hazard as the PAGEACTIVE waiter above: the 500 ms
      // timer can fire during the send await → unhandled rejection → process
      // death. Pre-handle; the `await reply` below still throws into the catch.
      reply.catch(() => {});
      await conn.send(configFetchDescriptor(gp, 0, 0, page, 0, 0));
      await reply;
      return; // page load complete — the Lua VM answered
    } catch (err) {
      if (Date.now() > probeDeadline) {
        throw new Error(
          `Page ${page} reported active but the Lua VM did not answer a ` +
            `CONFIG/FETCH probe within ${probeBudgetMs} ms — page load appears stuck.`,
        );
      }
    }
  }
}

// Await a CONFIG ACK — and surface a NACKNOWLEDGE as the loud failure it is.
// The firmware NACKs a CONFIG/EXECUTE when any of these fail: action length
// <= 909, frame ends with ETX, TARGET PAGE IS THE ACTIVE PAGE, element
// exists, event exists on that element (grid-fw grid_decode.c,
// grid_decode_config_to_ui EXECUTE branch).
function waitForConfigAck(conn, timeoutMs, contextLabel) {
  return new Promise((resolve, reject) => {
    conn
      .waitFor(
        (c) =>
          c.class_name === 'CONFIG' &&
          (c.class_instr === 'ACKNOWLEDGE' || c.class_instr === 'NACKNOWLEDGE'),
        timeoutMs,
        `No CONFIG/ACKNOWLEDGE for ${contextLabel} within ${timeoutMs} ms.`,
      )
      .then((c) => {
        if (c.class_instr === 'NACKNOWLEDGE') {
          reject(
            new Error(
              `Device NACKed the CONFIG write for ${contextLabel}. Firmware ` +
                `reject reasons: oversize action, bad framing, target page not ` +
                `ACTIVE (most likely — activatePage() must precede writes), or ` +
                `bad element/event.`,
            ),
          );
        } else {
          resolve(c);
        }
      })
      .catch(reject);
  });
}

// ── Action-string building & validation ──────────────────────────────────────
// The device stores single-line short-form strings wrapped `<?lua ... ?>`.
// GridScript.humanize maps that to `<lua ... >`; shortify maps names back but
// keeps the `<lua ... >` wrapper — so we restore `<?lua ... ?>` ourselves.
// This exact transform round-trips all 45 factory page-0 action strings.
function toDeviceActionString(gp, humanWrapped) {
  const short = gp.GridScript.shortify(humanWrapped);
  if (!short.startsWith('<lua ') || !short.endsWith('>')) {
    throw new Error(
      `shortify produced an unexpected wrapper (want "<lua ... >"): ` +
        `${short.slice(0, 60)}...`,
    );
  }
  return `<?lua ${short.slice(5, -1).trimEnd()} ?>`;
}

function toHumanActionString(gp, deviceShort) {
  return gp.GridScript.humanize(deviceShort);
}

// Strip `--` line comments (to end of line) while keeping `--[[ ... ]]` block
// comments (the protocol's action-block markers). Limitation: a literal "--"
// inside a Lua string would be treated as a comment — our templates avoid
// that, and the syntax check below fails loudly if stripping breaks the code.
function stripLineComments(luaSource) {
  return luaSource
    .split('\n')
    .map((line) => line.replace(/--(?!\[\[).*$/, '').trimEnd())
    .join('\n');
}

// Compile a human-readable Lua FILE body into a device action string:
// strip line comments -> minify -> require single line -> syntax check ->
// wrap as a code-block action -> shortify -> device `<?lua ... ?>` form.
// Fails loudly at every stage. Requires initLuaFormatter() already awaited.
function buildActionStringFromLua(gp, luaSource, maxLength) {
  const { GridScript } = gp;

  const stripped = stripLineComments(luaSource);
  const minified = GridScript.minifyScript(stripped).replace(/\n+/g, ' ').trim();
  if (minified.length === 0) {
    throw new Error('Lua source is empty after comment stripping + minification.');
  }
  if (/\n/.test(minified)) {
    throw new Error('Minified Lua still contains newlines; action strings must be single-line.');
  }
  if (!GridScript.checkSyntax(minified)) {
    throw new Error(
      'Lua syntax check failed after minification. If your source has "--" ' +
        'inside a string literal, remove it — line-comment stripping cannot ' +
        'distinguish it.',
    );
  }

  // Wrap as a single code-block action (the --[[@cb]] marker, as used by the
  // factory config), then map to the short/device form.
  const device = toDeviceActionString(gp, `<lua --[[@cb]] ${minified} >`);

  if (device.length > maxLength) {
    throw new Error(
      `Action string is ${device.length} chars; device limit is ${maxLength} ` +
        `(grid CONFIG_LENGTH). Shorten the Lua.`,
    );
  }
  return device;
}

// ── Pretty-printing for dry runs ──────────────────────────────────────────────
function frameToHex(serialBytes) {
  const withLf = [...serialBytes, BYTE_LF];
  const lines = [];
  for (let i = 0; i < withLf.length; i += 16) {
    const slice = withLf.slice(i, i + 16);
    const hex = slice.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = slice
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`    ${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

module.exports = {
  VSN1_VID,
  VSN1_PID,
  BAUD_RATE,
  BYTE_EOT,
  BYTE_LF,
  HEARTBEAT_WAIT_MS,
  FETCH_TIMEOUT_MS,
  ACK_TIMEOUT_MS,
  PAGESTORE_TIMEOUT_BASE_MS,
  PAGESTORE_TIMEOUT_PER_WRITE_MS,
  pageStoreTimeout,
  listPorts,
  isVsn1,
  hex4,
  findVsn1Port,
  FrameAssembler,
  openPort,
  closePort,
  writePort,
  waitForClass,
  connect,
  waitForHeartbeat,
  configFetchDescriptor,
  configExecuteDescriptor,
  pageActiveDescriptor,
  pageStoreDescriptor,
  resetDescriptor,
  immediateDescriptor,
  drawSyncScreen,
  clearSyncScreen,
  SYNC_SCREEN_LUA,
  SYNC_CLEAR_LUA,
  editorHeartbeatDescriptor,
  enablePageChange,
  activatePage,
  waitForConfigAck,
  toDeviceActionString,
  toHumanActionString,
  stripLineComments,
  buildActionStringFromLua,
  frameToHex,
};

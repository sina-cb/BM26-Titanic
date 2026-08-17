/**
 * bridge_harness.mjs — the fake-module bridge harness (H-A, catalog
 * 20260805_161), extracted from `bench_mirror_arm.test.js:518-770` so every
 * spec that needs the REAL `server/sacn_bridge.js` + `server/sacn_output_bridge.js`
 * wired together stops copy-pasting it. Test-code-only extraction — no
 * production file is touched.
 *
 * `Module._load` interception replaces `sacn` (FakeSender/FakeReceiver) and
 * `ws` (FakeWebSocketServer/FakeClient keyed by port, nothing bound), stubs
 * `fetch` as the engine, then `require`s the REAL `server/sacn_output_bridge.js`
 * first and the REAL `server/sacn_bridge.js` second. Frames are injected via
 * `receiver.emit('packet', {universe, priority, sourceName, payloadAsBuffer,
 * sequence})` — `payloadAsBuffer` is the RAW 512-byte wire slice the bridge
 * reads since report 20260805_170; use `inbound()`/`engineFrame()`, which keep
 * taking the same 1-indexed `{channel: 0..255}` objects and build it.
 * Every "send" lands in the `sends` array. ZERO PACKETS, ZERO PORTS — nothing
 * constructs a real `sacn` Sender/Receiver and nothing binds a WebSocket port;
 * the operator's live stack owns 6966-6972 and 5568.
 *
 * USAGE — call `createBridgeHarness()` ONCE per test FILE, at module top
 * level (exactly like the original inline setup did). `node --test` gives
 * each matched file its own process, so the `Module._load` patch and the
 * `require` cache below are safely file-scoped: two different spec files each
 * get their OWN bridge instance, never two instances in the same process.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseBenchMirrorSpec, mirrorDestPairs } = require('../../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry } = require('../../lib/bench_mirror_resolve.cjs');
const { routeKey } = require('../../lib/bridge_routing.cjs');

export const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_SPEC_PATH = path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml');
export const liveSidecar = parseBenchMirrorSpec(
  yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8')), 'live');

function liveScene(name) {
  const dir = path.join(SIM_ROOT, 'scenes', name);
  return {
    controllers: yaml.load(fs.readFileSync(path.join(dir, 'controllers.yaml'), 'utf8')),
    patches: yaml.load(fs.readFileSync(path.join(dir, 'patches.yaml'), 'utf8')),
    sceneConfig: yaml.load(fs.readFileSync(path.join(dir, 'scene_config.yaml'), 'utf8')),
  };
}

/** The mapping the bridge will compute for the committed sidecar + defaults. */
export const liveResolution = resolveBenchMirror({
  spec: liveSidecar,
  benchSceneName: 'test_bench',
  benchScene: liveScene('test_bench'),
  sourceSceneName: 'titanic',
  sourceScene: liveScene('titanic'),
  registry: loadFixtureRegistry(path.join(SIM_ROOT, 'dmx', 'fixtures')),
  selection: null,
});
assert.equal(liveResolution.ok, true, liveResolution.refusal || '');
export const LIVE_DESTS = mirrorDestPairs(liveResolution.spec);
/** The bench DMX gateway destination (composed from three source universes). */
export const GATEWAY = liveResolution.spec.mirrors.find(m => m.slices.length > 1);
/** One single-source destination (a strand) — structurally immune to tearing. */
export const STRAND = liveResolution.spec.mirrors.find(m => m.slices.length === 1);
/** Every DISTINCT source universe the armed mapping reads. */
export const ALL_SOURCES = [...new Set(liveResolution.spec.mirrors
  .flatMap(m => m.slices.map(s => s.sourceUniverse)))].sort((a, b) => a - b);

export { routeKey, yaml, liveScene };

/**
 * A FRESH, per-process scratch scenes root for the bridge's remembered
 * bench-mirror selections (design 20260806_174 §5.3).
 *
 * WHY THIS EXISTS. A successful ARM writes `bench_mirror_state.yaml` into the
 * bench scene's directory. Left unredirected, every arm test in this suite would
 * rewrite a TRACKED file under `simulation/scenes/`, destroying the SHA256
 * before/after proof that the suite does not touch real scene data — and
 * dirtying the operator's working tree on every `npm test`.
 *
 * Belt AND braces: this redirect is the belt, and `writeBenchMirrorState`
 * independently REFUSES any `node --test` process aiming at the repo's real
 * scenes directory (the braces), so a future harness that forgets this gets a
 * loud refusal rather than a quiet write.
 *
 * Keyed by pid because `node --test` gives every spec FILE its own process; two
 * files therefore never share a state file.
 */
function freshStateRoot() {
  const root = path.join(os.homedir(), 'tmp', 'fix_176', 'bridge_state', String(process.pid));
  fs.rmSync(root, { recursive: true, force: true });
  // Only the scenes that can be armed need a directory; the writer refuses to
  // create one, deliberately (it is a sibling of an existing scene, never a new
  // scene).
  fs.mkdirSync(path.join(root, 'test_bench'), { recursive: true });
  fs.mkdirSync(path.join(root, 'titanic'), { recursive: true });
  return root;
}

/**
 * Build one bridge harness: patches `sacn`/`ws`, requires the two REAL bridge
 * modules, opens the boot gate, and returns every utility a spec needs to
 * drive them. Call ONCE per test file.
 */
export function createBridgeHarness() {
  // MUST be set before the bridge module is required — it resolves the root
  // once, at load, so there is exactly one root per process and no way for a
  // later test to move it out from under a live arm.
  const benchStateRoot = freshStateRoot();
  process.env.BM26_BENCH_MIRROR_STATE_ROOT = benchStateRoot;
  // The port-cleanup ARM INTERLOCK marker (report 20260815_233 F7). Same
  // doctrine as the state root, and for a sharper reason: the production marker
  // is the LIVE stack's claim, so a test arm that wrote it would overwrite — and
  // on disarm delete — the operator's real one, silently unprotecting an armed
  // bench. `tools/port_cleanup.cjs` refuses the production path under
  // `node --test` outright, so forgetting this line is a loud failure, not a
  // quiet one. Per-pid, exactly like the state root.
  const armMarkerPath = path.join(benchStateRoot, 'bench_mirror_armed.json');
  process.env.BM26_BENCH_MIRROR_ARM_MARKER = armMarkerPath;
  /** Every frame either bridge tried to put on the wire, by sender. */
  const sends = [];
  const senders = [];
  /**
   * ORDERED lifecycle log across all senders — open / send / close, in the
   * order they happened (report 20260804_152 D1). `sends` alone cannot
   * express "a raw frame arrived BETWEEN two blackout frames on the same
   * pair"; this can.
   */
  const events = [];
  let receiverRef = null;
  let engineStatus = {
    service: 'marsin-engine', activeScene: 'titanic', outputRouting: { controllers: [] },
  };

  const isZeroPayload = (p) => Object.values(p).every(v => v === 0);
  /** One-shot `(sender, frame) => void`, fired on the next send and cleared. */
  let sendHook = null;

  class FakeSender {
    constructor(opts) {
      this.universe = opts.universe;
      this.ip = opts.useUnicastDestination;
      this.defaultPacketOptions = opts.defaultPacketOptions || null;
      this.closed = false;
      senders.push(this);
      events.push({ kind: 'open', universe: this.universe, ip: this.ip });
    }
    send(frame) {
      if (this.closed) return Promise.reject(new Error('sender closed'));
      const merged = { ...this.defaultPacketOptions, ...frame };
      // One-shot hook so a test can act at an EXACT point in a send sequence —
      // e.g. kill the gate control link on the first ship-blackout zero frame,
      // which is the only way to land inside the ARM's awaited blackout window.
      if (sendHook) { const h = sendHook; sendHook = null; h(this, merged); }
      sends.push({
        universe: this.universe, ip: this.ip, priority: merged.priority,
        cid: merged.cid || null, payload: merged.payload,
        // The wire UNIT this frame would have been encoded in (report
        // 20260805_170). `false` here means the `sacn` package would have
        // multiplied every value by 2.55 and clipped at 255 — the D1 defect.
        useRawDmxValues: merged.useRawDmxValues === true,
      });
      events.push({
        kind: 'send', universe: this.universe, ip: this.ip, zero: isZeroPayload(merged.payload),
      });
      // Resolve on a LATER event-loop turn, the way `dgram.send`'s callback
      // actually behaves (report 20260804_152 D2/D4). With a synchronously
      // resolving fake the whole 3-frame blackout completes inside one
      // microtask drain and the entire release window is invisible to the
      // tests — which is half of why D1 escaped the first pass.
      return new Promise((resolve) => setImmediate(resolve));
    }
    close() {
      this.closed = true;
      events.push({ kind: 'close', universe: this.universe, ip: this.ip });
      return this;
    }
  }

  class FakeEmitter {
    constructor() { this._h = new Map(); }
    on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, []); this._h.get(ev).push(fn); return this; }
    emit(ev, ...args) { for (const fn of this._h.get(ev) || []) fn(...args); }
  }

  class FakeReceiver extends FakeEmitter {
    constructor(opts) {
      super();
      this.universes = opts.universes;   // the package keeps the caller's array
      this.socket = new FakeEmitter();
      receiverRef = this;
    }
    addUniverse(u) { if (!this.universes.includes(u)) this.universes.push(u); }
  }

  /**
   * Faked WS servers, keyed by the port they "bound". Nothing is actually
   * bound — this registry is what lets the loopback client below find the
   * OTHER bridge in this same process, so the gate is exercised across the
   * real two-process boundary without either process existing.
   */
  const wsServers = new Map();

  class FakeClient extends FakeEmitter {
    constructor() { super(); this.readyState = 1; this.received = []; this.peer = null; }
    send(data) {
      this.received.push(data);
      if (this.peer) setImmediate(() => this.peer.emit('message', data));
    }
    json(type) {
      return this.received
        .filter(d => typeof d === 'string')
        .map(d => JSON.parse(d))
        .filter(m => !type || m.type === type);
    }
    drop() {
      this.readyState = 3;
      if (this.server) this.server.clients.delete(this);
      this.emit('close');
      if (this.peer) { this.peer.readyState = 3; this.peer.emit('close'); }
    }
  }

  class FakeWebSocketServer extends FakeEmitter {
    constructor(opts) {
      super();
      this.clients = new Set();
      this.port = opts && opts.port;
      wsServers.set(this.port, this);
      // Deliberately NO deferred `listening` emit. The output bridge prints
      // its boot banner from that handler, and a banner written to stdout
      // from a later event-loop turn lands in the middle of `node --test`'s
      // serialized reporter stream, which corrupts it ("Unable to
      // deserialize cloned data") and fails the whole FILE under the
      // concurrent full-suite run. Nothing under test depends on the banner,
      // and a fake server never listened.
    }
    connect() {
      const ws = new FakeClient();
      ws.server = this;
      this.clients.add(ws);
      this.emit('connection', ws, { socket: { remoteAddress: '127.0.0.1' } });
      return ws;
    }
    close() { for (const c of this.clients) c.readyState = 3; this.clients.clear(); }
  }

  /**
   * The loopback WS CLIENT the input bridge uses to command the output
   * bridge's gate. It finds the fake server by port and wires a
   * bidirectional pair, so both ends run their REAL handlers.
   */
  class FakeWebSocketClient extends FakeEmitter {
    constructor(url) {
      super();
      this.readyState = 0;
      const port = Number(String(url).split(':').pop().replace(/\D/g, ''));
      setImmediate(() => {
        const server = wsServers.get(port);
        if (!server) { this.emit('error', new Error(`no server on :${port}`)); return; }
        const serverSide = server.connect();
        this.peer = serverSide;
        serverSide.peer = this;
        this.readyState = 1;
        this.emit('open');
      });
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('gate link not open');
      setImmediate(() => { if (this.peer) this.peer.emit('message', data); });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.peer) { this.peer.drop(); this.peer = null; }
      this.emit('close');
    }
  }

  const logs = [];
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  // REFERENCE-COUNTED: the helpers nest (a test captures, then calls
  // `request`, which captures and releases around its own wait). A
  // non-counted release inside the inner helper would hand the console back
  // mid-test and silently drop every later line — including the
  // `BENCH MIRROR DISARMED` the outer test asserts on.
  let _captureDepth = 0;
  function captureConsole() {
    if (_captureDepth === 0) {
      console.log = (...a) => logs.push(a.join(' '));
      console.warn = (...a) => logs.push(a.join(' '));
      console.error = (...a) => logs.push(a.join(' '));
    }
    _captureDepth += 1;
  }
  function releaseConsole() {
    _captureDepth = Math.max(0, _captureDepth - 1);
    if (_captureDepth === 0) Object.assign(console, realConsole);
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'sacn') return { Receiver: FakeReceiver, Sender: FakeSender };
    if (request === 'ws') {
      return {
        Server: FakeWebSocketServer,
        WebSocketServer: FakeWebSocketServer,
        WebSocket: FakeWebSocketClient,
      };
    }
    if (typeof request === 'string' && request.endsWith('process_priority.cjs')) {
      return { elevateSelf: () => {}, normalizePriorityRequest: () => 'high' };
    }
    return originalLoad.apply(this, arguments);
  };
  // The default impl mirrors `engineStatus`; a spec that needs to model an
  // unreachable engine (a rejecting fetch), a non-OK response, or a wrong
  // `service` field swaps the whole implementation via `setFetchImpl` rather
  // than fighting the `engineStatus` shape (report 20260805_161 G4).
  let fetchImpl = async () => ({ ok: true, json: async () => engineStatus });
  globalThis.fetch = (...args) => fetchImpl(...args);

  const simPorts = require('../../lib/load_ports.cjs')
    .loadSimPorts(path.join(SIM_ROOT, 'config.yaml'));

  captureConsole();
  // The OUTPUT bridge loads FIRST so its (faked) server exists when the
  // input bridge's gate link dials it. Both are the real modules.
  require('../../server/sacn_output_bridge.js');
  require('../../server/sacn_bridge.js');
  receiverRef.socket.emit('listening');       // opens the boot gate, replays 'boot'
  releaseConsole();

  const outputWss = wsServers.get(simPorts.sacn_output_port);
  const inputWss = wsServers.get(simPorts.sacn_port);
  assert.ok(outputWss && inputWss, 'both bridges must have created their (fake) servers');

  const tick = () => new Promise((resolve) => setImmediate(resolve));
  async function settle(n = 12) { for (let i = 0; i < n; i += 1) await tick(); }

  /** Spin the event loop until `cond` holds. Turn-bounded, so it cannot hang. */
  async function waitFor(cond, what, turns = 800) {
    for (let i = 0; i < turns; i += 1) {
      if (cond()) return;
      await tick();
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /**
   * Real-wall-clock wait, for state driven by an actual (unref'd) interval
   * inside the bridge — e.g. the 3 s engine poll — that a `setImmediate`
   * turn-spin can never reach.
   */
  async function waitMs(cond, what, ms = 8000) {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Live senders (open) as universe→ip strings. */
  const openSenders = () => senders.filter(s => !s.closed).map(s => routeKey(s.universe, s.ip));
  const sendsTo = (ip, universe) => sends.filter(
    s => s.ip === ip && (universe === undefined || s.universe === universe));
  /** The ordered open/send/close log for ONE (universe, controller) pair. */
  const pairEvents = (universe, ip) => events.filter(e => e.universe === universe && e.ip === ip);

  /**
   * E1.31 sequence numbers, modelling the ENGINE's senders.
   *
   * The engine creates one Sender per universe together and `sendFrame`
   * writes every universe each frame, so all universes of one engine frame
   * carry the SAME sequence and advance in lockstep. The bridge relies on
   * exactly that to tell "all my sources are here" from "all my sources are
   * here FOR THE SAME FRAME" (report 20260805_158 D-158-3), so a rig with
   * independent per-universe counters would be testing a stream no real
   * receiver ever sees.
   */
  let frameSeq = 0;
  const advanceFrame = () => { frameSeq = (frameSeq + 1) % 256; return frameSeq; };

  /**
   * Feed one inbound sACN frame through the real packet handler.
   * `seq` defaults to a fresh engine frame carrying only this universe.
   *
   * `payload` stays the same convenient 1-indexed `{channel: value}` shape it
   * always was, and the values are RAW DMX (0-255) — they always were, in
   * every caller. What changed with report 20260805_170 is that the bridge now
   * reads `packet.payloadAsBuffer` (the untouched wire slice) instead of
   * `packet.payload` (the package's PERCENT view), so the fake packet must
   * carry the buffer, exactly like a real `Packet` parsed off the socket does.
   * Nothing else about the injected frame changed.
   */
  function inbound(universe, payload = { 1: 7 }, seq) {
    const buf = Buffer.alloc(512);
    for (const ch in payload) {
      const idx = Number(ch) - 1;
      if (idx < 0 || idx >= 512) continue;
      const v = payload[ch];
      // Loud, not silently masked: a >255 "DMX value" would wrap mod 256 in the
      // buffer and quietly test a stream no real sender can produce.
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 255,
        `inbound(U${universe}) channel ${ch}: ${v} is not a raw DMX byte (0-255)`);
      buf[idx] = v;
    }
    receiverRef.emit('packet', {
      universe, priority: 100, payloadAsBuffer: buf, sourceName: 'test',
      sequence: seq === undefined ? advanceFrame() : seq,
    });
  }

  /**
   * Deliver one whole ENGINE frame: each distinct source universe EXACTLY
   * ONCE, all carrying the same sequence — which is what makes it one frame.
   */
  function engineFrame(value = 7) {
    const seq = advanceFrame();
    for (const u of ALL_SOURCES) inbound(u, { 1: value, 2: value, 120: value }, seq);
  }

  /**
   * A new sim window — INCLUDING the `{type:'setScene'}` the real browser
   * sends from its `onopen` handler (`src/dmx/sacn_input_source.js`).
   * Without it `clientScenes` stays empty for every test socket and the
   * close handler's `if (scene) recomputeRoutes(...)` never runs, so the
   * rig exercises a control flow the real system never takes (report
   * 20260804_152 D4, and the reason D1 was invisible to the first pass).
   */
  function connect(scene = 'titanic') {
    captureConsole();
    const ws = inputWss.connect();
    ws.emit('message', JSON.stringify({ type: 'setScene', scene }));
    releaseConsole();
    return ws;
  }

  /** Send a request and wait for the reply that carries OUR reqId. */
  async function request(ws, message, reqId, type = 'benchMirrorStatus') {
    captureConsole();
    const replies = () => ws.json(type).filter(m => m.reqId === reqId);
    ws.emit('message', JSON.stringify({ ...message, reqId }));
    try {
      await waitFor(() => replies().length > 0, `a reply to ${message.type}`);
    } finally {
      releaseConsole();
    }
    return replies().pop();
  }

  let _reqSeq = 0;
  /** The socket that owns the live arm, so later tests need not go hunting. */
  let armedSocket = null;

  async function armFrom(ws, scene = 'test_bench', selection) {
    _reqSeq += 1;
    const msg = { type: 'benchMirrorArm', scene };
    if (selection !== undefined) msg.selection = selection;
    const status = await request(ws, msg, `arm-${_reqSeq}`);
    if (status.armed) armedSocket = ws;
    return status;
  }

  async function disarmFrom(ws) {
    _reqSeq += 1;
    return request(ws, { type: 'benchMirrorDisarm' }, `disarm-${_reqSeq}`);
  }

  async function optionsFrom(ws, scene = 'test_bench') {
    _reqSeq += 1;
    return request(ws, { type: 'benchMirrorOptions', scene }, `opt-${_reqSeq}`,
      'benchMirrorOptions');
  }

  // Completion signal for a disarm that has NO reply to wait on (a socket
  // drop, an auto-disarm). The bridge broadcasts its status to every client
  // as the last step of `disarmBenchMirror` — after the blackout AND after
  // the recompute — so a new `armed:false` broadcast is the bridge's own "I
  // have finished releasing". The observer socket is supplied by the caller
  // (via `setObserver`) because it is created AFTER this harness returns.
  let observerRef = null;
  function setObserver(ws) { observerRef = ws; }
  function disarmBroadcasts() {
    return observerRef.json('benchMirrorStatus').filter(m => m.armed === false && !m.blackoutInFlight).length;
  }
  async function waitForDisarm(baseline, what = 'the disarm to complete') {
    await waitFor(() => disarmBroadcasts() > baseline, what);
    await settle(6);   // let the post-disarm recompute's sender diff settle
  }

  return {
    // ── Fixed live data (module-level exports, re-surfaced for convenience) ──
    SIM_ROOT, yaml, routeKey, liveSidecar, liveResolution, LIVE_DESTS, GATEWAY, STRAND, ALL_SOURCES,
    simPorts,
    /** Where this process's bridge writes its remembered selections. */
    benchStateRoot,
    /** Where this process's bridge publishes its port-cleanup arm interlock. */
    armMarkerPath,

    // ── Fake classes + registries ──
    FakeSender, FakeEmitter, FakeReceiver, FakeClient, FakeWebSocketServer, FakeWebSocketClient,
    wsServers, outputWss, inputWss,
    get receiver() { return receiverRef; },

    // ── Engine /status stub (swappable per test) ──
    getEngineStatus: () => engineStatus,
    setEngineStatus: (v) => { engineStatus = v; },
    // Full `fetch` override — for modelling an unreachable engine (a
    // rejecting/throwing impl), a non-OK response, or a wrong `service` field,
    // none of which the `engineStatus` shape alone can express.
    setFetchImpl: (fn) => { fetchImpl = fn; },
    resetFetchImpl: () => { fetchImpl = async () => ({ ok: true, json: async () => engineStatus }); },

    // ── One-shot send hook ──
    setSendHook: (fn) => { sendHook = fn; },
    clearSendHook: () => { sendHook = null; },
    isZeroPayload,

    // ── Timing ──
    tick, settle, waitFor, waitMs,

    // ── Wire introspection ──
    sends, senders, events, openSenders, sendsTo, pairEvents,

    // ── Frame injection ──
    advanceFrame, inbound, engineFrame,

    // ── Console capture ──
    captureConsole, releaseConsole, logs,

    // ── Protocol helpers ──
    connect, request, armFrom, disarmFrom, optionsFrom,
    setObserver, disarmBroadcasts, waitForDisarm,
    get armedSocket() { return armedSocket; },

    // ── Module-load restore (teardown assertions) ──
    restoreModuleLoad: () => { Module._load = originalLoad; },
    originalModuleLoad: originalLoad,
    Module,
  };
}

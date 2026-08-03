/**
 * bench_mirror.cjs — pure "stand-in" re-addressing for the sACN bridge.
 *
 * WHY (operator order 2026-07-31): the physical test bench should stop being a
 * bench and become a WINDOW ONTO THE SHIP — "set up test bench to show part of
 * the titanic scene for me — led bars, par lights and vintage lights! LED
 * strings too." The engine runs the `titanic` model; the bench boxes must show
 * exactly the bytes specific titanic fixtures are being sent.
 *
 * WHY A RE-ADDRESS STAGE IS NEEDED AT ALL. sACN reception is the easy half — a
 * second listener on a universe is free. The blocker is the DMX START ADDRESS,
 * which lives in the physical fixture and cannot be assumed re-settable:
 *
 *   family              titanic addresses      bench addresses
 *   UkingPar   (fp 10)  1, 11, 21, 31          1, 11, 21, 31     ← ALIGNED
 *   VintageLed (fp 33)  1, 34, 67, 100         41, 74            ← does not line up
 *   ShehdsBar  (fp 119) 1, 120                 107, 226          ← does not line up
 *
 * Pars alone could be done by pure config (point the bench's par port at a
 * titanic par universe). Bars and vintage cannot: no titanic fixture of those
 * families ever starts at 107/226 or 41/74. So the bytes have to be MOVED, and
 * this module is the pure half of moving them.
 *
 * WHAT IT DOES. A mirror declares, per destination universe, a list of SLICES:
 * "copy `length` channels starting at `source_addr` on universe `source_universe`
 * to `dest_addr` on `dest_universe`". The bridge feeds it every inbound frame;
 * it splices into a persistent 512-byte buffer per destination universe and
 * hands back the destinations that changed, which the bridge unicasts to the
 * bench box. Nothing here does I/O.
 *
 * ONE WRITER PER (UNIVERSE, CONTROLLER) — the standing law (report 20260724_15).
 * A mirrored destination pair is OWNED by the mirror, so the bridge must
 * suppress its ordinary relay for that pair; `mirrorDestPairs()` is what it
 * suppresses. Otherwise the raw titanic U2 (Left Front Wall) and the synthesized
 * bench U2 would both land on the bench box and fight.
 *
 * ACTIVATION IS A PRECONDITION, NOT A FALLBACK (codex P0). A mirror declares the
 * `source_scene` whose byte layout it was authored against. Splicing `test_bench`
 * bytes through a map written for `titanic` would put par data inside a bar's
 * control channels — actively harmful. `isMirrorActive()` therefore compares the
 * ENGINE's active scene against that declaration; when they differ the mirror
 * is inert, the ordinary relay is not suppressed, and the bench behaves exactly
 * as it always has. Both transitions are logged loudly by the caller.
 *
 * FAIL LOUD. Every structural problem in a spec THROWS with the offending path
 * named: unknown keys, missing keys, non-integers, ranges that walk off the end
 * of a universe, two slices claiming the same destination channel, a destination
 * host the relay would refuse anyway. A mirror that is half-right is worse than
 * no mirror — it is dark or wrong fixtures with a green log.
 */
'use strict';

const { classifyRouteIp, SACN_UNIVERSE_MIN, SACN_UNIVERSE_MAX } = require('./bridge_routing.cjs');

/** One DMX universe is 512 channels, addressed 1..512. */
const DMX_CHANNELS = 512;

/** The only spec version this build understands. */
const BENCH_MIRROR_VERSION = 1;

const SPEC_KEYS = new Set(['version', 'enabled', 'source_scene', 'note', 'mirrors']);
const MIRROR_KEYS = new Set(['dest_universe', 'dest_host', 'note', 'slices']);
const SLICE_KEYS = new Set(['source_universe', 'source_addr', 'length', 'dest_addr', 'note']);

/** Throw with the YAML path that is wrong — a mirror is edited by hand. */
function fail(where, message) {
  throw new Error(`[BenchMirror] ${where}: ${message}`);
}

function requireKnownKeys(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(where, `unknown key '${key}' — allowed: ${[...allowed].sort().join(', ')}. ` +
        'Refusing to ignore it silently; a typo here is a dark or wrong fixture.');
    }
  }
}

function requireInt(value, where, { min, max }) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(where, `must be an integer (got ${JSON.stringify(value)})`);
  }
  if (value < min || value > max) {
    fail(where, `must be within ${min}..${max} (got ${value})`);
  }
  return value;
}

/**
 * Parse + validate one bench-mirror spec tree (the `yaml.load()` result).
 *
 * @param {*} tree parsed YAML
 * @param {string} label where it came from, for error messages
 * @returns {{version:number, enabled:boolean, sourceScene:string, note:string,
 *            mirrors:Array<{destUniverse:number, destHost:string, note:string,
 *              slices:Array<{sourceUniverse:number, sourceAddr:number,
 *                            length:number, destAddr:number, note:string}>}>}}
 */
function parseBenchMirrorSpec(tree, label) {
  const where = label || 'bench_mirror.yaml';
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    fail(where, 'the file must contain a mapping (version / enabled / source_scene / mirrors)');
  }
  requireKnownKeys(tree, SPEC_KEYS, where);

  if (tree.version !== BENCH_MIRROR_VERSION) {
    fail(where, `version must be ${BENCH_MIRROR_VERSION} (got ${JSON.stringify(tree.version)}) — ` +
      'this build does not know how to read any other layout');
  }
  if (typeof tree.enabled !== 'boolean') {
    fail(`${where}.enabled`, `must be true or false (got ${JSON.stringify(tree.enabled)})`);
  }
  if (typeof tree.source_scene !== 'string' || tree.source_scene.trim() === '') {
    fail(`${where}.source_scene`, 'must name the scene whose byte layout this map was authored ' +
      'against — the mirror only runs while the ENGINE is on that scene');
  }
  if (!Array.isArray(tree.mirrors) || tree.mirrors.length === 0) {
    fail(`${where}.mirrors`, 'must be a non-empty list of destination universes');
  }

  const mirrors = [];
  const seenDest = new Set();
  tree.mirrors.forEach((raw, i) => {
    const mWhere = `${where}.mirrors[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(mWhere, 'must be a mapping (dest_universe / dest_host / slices)');
    }
    requireKnownKeys(raw, MIRROR_KEYS, mWhere);

    const destUniverse = requireInt(raw.dest_universe, `${mWhere}.dest_universe`,
      { min: SACN_UNIVERSE_MIN, max: SACN_UNIVERSE_MAX });
    if (typeof raw.dest_host !== 'string') {
      fail(`${mWhere}.dest_host`, `must be the controller IP string (got ${JSON.stringify(raw.dest_host)})`);
    }
    const destHost = raw.dest_host.trim();
    const verdict = classifyRouteIp(destHost);
    if (!verdict.admit) {
      fail(`${mWhere}.dest_host`, `'${destHost}' cannot receive a mirror — ${verdict.reason}`);
    }
    const destKey = `${destUniverse}→${destHost}`;
    if (seenDest.has(destKey)) {
      fail(mWhere, `U${destUniverse} → ${destHost} is declared twice — merge the slices into ` +
        'one entry so the composed frame has a single definition');
    }
    seenDest.add(destKey);

    if (!Array.isArray(raw.slices) || raw.slices.length === 0) {
      fail(`${mWhere}.slices`, 'must be a non-empty list — a destination with no slices would ' +
        'send an all-zero frame and blackout the fixtures on it');
    }

    // Destination channels must have exactly one source. Two slices writing the
    // same channel is an authoring bug whose symptom (one fixture flickering
    // between two sources) is almost impossible to read off the hardware.
    const claimed = new Map(); // dest channel → slice index
    const slices = raw.slices.map((rawSlice, j) => {
      const sWhere = `${mWhere}.slices[${j}]`;
      if (!rawSlice || typeof rawSlice !== 'object' || Array.isArray(rawSlice)) {
        fail(sWhere, 'must be a mapping (source_universe / source_addr / length / dest_addr)');
      }
      requireKnownKeys(rawSlice, SLICE_KEYS, sWhere);

      const sourceUniverse = requireInt(rawSlice.source_universe, `${sWhere}.source_universe`,
        { min: SACN_UNIVERSE_MIN, max: SACN_UNIVERSE_MAX });
      const length = requireInt(rawSlice.length, `${sWhere}.length`, { min: 1, max: DMX_CHANNELS });
      const sourceAddr = requireInt(rawSlice.source_addr, `${sWhere}.source_addr`,
        { min: 1, max: DMX_CHANNELS });
      const destAddr = requireInt(rawSlice.dest_addr, `${sWhere}.dest_addr`,
        { min: 1, max: DMX_CHANNELS });

      if (sourceAddr + length - 1 > DMX_CHANNELS) {
        fail(`${sWhere}`, `source range ${sourceAddr}..${sourceAddr + length - 1} walks past ` +
          `channel ${DMX_CHANNELS} of U${sourceUniverse}`);
      }
      if (destAddr + length - 1 > DMX_CHANNELS) {
        fail(`${sWhere}`, `destination range ${destAddr}..${destAddr + length - 1} walks past ` +
          `channel ${DMX_CHANNELS} of U${destUniverse}`);
      }
      for (let ch = destAddr; ch < destAddr + length; ch += 1) {
        if (claimed.has(ch)) {
          fail(sWhere, `destination channel ${ch} of U${destUniverse} is already written by ` +
            `slices[${claimed.get(ch)}] — two sources for one channel is ambiguous`);
        }
        claimed.set(ch, j);
      }
      return {
        sourceUniverse,
        sourceAddr,
        length,
        destAddr,
        note: typeof rawSlice.note === 'string' ? rawSlice.note : '',
      };
    });

    mirrors.push({
      destUniverse,
      destHost,
      note: typeof raw.note === 'string' ? raw.note : '',
      slices,
    });
  });

  return {
    version: tree.version,
    enabled: tree.enabled,
    sourceScene: tree.source_scene.trim(),
    note: typeof tree.note === 'string' ? tree.note : '',
    mirrors,
  };
}

/**
 * Is this spec allowed to run right now? THREE conditions, all required.
 *
 * 1. `enabled: true` — the operator's switch, in the file itself.
 * 2. The ENGINE is on `source_scene`. The map re-addresses bytes by their
 *    POSITION in that scene's universes, so it is meaningless — and actively
 *    harmful — against any other model's bytes.
 * 3. The scene the spec BELONGS TO is active (CLI pin / engine / a connected
 *    client). This is the deployment guard: on the show server the launcher is
 *    pinned to `titanic` and no bench window is open, so a bench mirror that
 *    rides along in the deployed tree stays inert and the ship's real gateway on
 *    the same IP keeps its ordinary relay. On the bench laptop the operator
 *    already runs `--scene test_bench`, which turns it on.
 *
 * These are declared preconditions, not fallbacks: when any is false the mirror
 * does nothing, suppresses nothing, and the caller says so out loud.
 *
 * @param {Object} spec parsed spec
 * @param {string|null} engineScene the engine's active scene (null = unreachable)
 * @param {boolean} ownSceneActive is the spec's own scene in the active set?
 * @returns {boolean}
 */
function isMirrorActive(spec, engineScene, ownSceneActive) {
  if (!spec || !spec.enabled) return false;
  if (ownSceneActive !== true) return false;
  return typeof engineScene === 'string' && engineScene === spec.sourceScene;
}

/** Every universe a spec must be able to RECEIVE for its slices to have data. */
function mirrorSourceUniverses(spec) {
  const out = new Set();
  for (const m of spec.mirrors) {
    for (const s of m.slices) out.add(s.sourceUniverse);
  }
  return [...out].sort((a, b) => a - b);
}

/** Every (universe, host) pair the mirror OWNS — the bridge suppresses these. */
function mirrorDestPairs(spec) {
  return spec.mirrors.map(m => ({ universe: m.destUniverse, ip: m.destHost }));
}

/**
 * Build the runtime state: one persistent 512-byte buffer per destination plus
 * the source→slices index the packet handler walks.
 *
 * The buffers PERSIST across frames on purpose. Sources arrive as separate
 * datagrams; a destination composed from three of them would otherwise be sent
 * two-thirds blank on every frame.
 *
 * @param {Object} spec parsed spec
 * @returns {{buffers:Map<string,Uint8Array>, bySource:Map<number,Array>, targets:Array}}
 */
function createMirrorState(spec) {
  const buffers = new Map();     // destKey → Uint8Array(512)
  const targets = [];            // { key, universe, ip }
  const bySource = new Map();    // source universe → [{ destKey, sourceAddr, length, destAddr }]
  for (const m of spec.mirrors) {
    const key = `${m.destUniverse}→${m.destHost}`;
    buffers.set(key, new Uint8Array(DMX_CHANNELS));
    targets.push({ key, universe: m.destUniverse, ip: m.destHost });
    for (const s of m.slices) {
      if (!bySource.has(s.sourceUniverse)) bySource.set(s.sourceUniverse, []);
      bySource.get(s.sourceUniverse).push({
        destKey: key,
        sourceAddr: s.sourceAddr,
        length: s.length,
        destAddr: s.destAddr,
      });
    }
  }
  return { buffers, bySource, targets };
}

/**
 * Splice one inbound frame into the destination buffers it feeds.
 *
 * @param {Object} state from createMirrorState
 * @param {number} universe the inbound universe
 * @param {Object|null} payload the sACN payload ({ channel: value }, 1-based)
 * @returns {string[]} destination keys whose buffer changed (may be empty)
 */
function spliceMirrorFrame(state, universe, payload) {
  const slices = state.bySource.get(universe);
  if (!slices) return [];
  const touched = new Set();
  for (const s of slices) {
    const buf = state.buffers.get(s.destKey);
    for (let i = 0; i < s.length; i += 1) {
      const value = payload ? payload[s.sourceAddr + i] : undefined;
      buf[s.destAddr - 1 + i] = (typeof value === 'number') ? value : 0;
    }
    touched.add(s.destKey);
  }
  return [...touched];
}

/**
 * Turn a destination buffer into the `{ channel: value }` payload the `sacn`
 * Sender takes. Channels the map never writes stay 0 and are sent as 0 — a DMX
 * frame is 512 channels whether we authored them or not, and omitting them
 * would leave whatever the box last held on those channels.
 *
 * @param {Object} state from createMirrorState
 * @param {string} destKey
 * @returns {Object} payload
 */
function mirrorPayload(state, destKey) {
  const buf = state.buffers.get(destKey);
  if (!buf) fail('mirrorPayload', `no buffer for destination '${destKey}'`);
  const payload = {};
  for (let i = 0; i < DMX_CHANNELS; i += 1) payload[i + 1] = buf[i];
  return payload;
}

/** One-line human summary of what a spec will do, for the boot banner. */
function describeMirror(spec) {
  const lines = [];
  for (const m of spec.mirrors) {
    const chans = m.slices.reduce((n, s) => n + s.length, 0);
    const sources = [...new Set(m.slices.map(s => `U${s.sourceUniverse}`))].join('+');
    lines.push(`U${m.destUniverse} → ${m.destHost} ` +
      `(${m.slices.length} slice(s), ${chans} ch, from ${sources})`);
  }
  return lines;
}

module.exports = {
  parseBenchMirrorSpec,
  isMirrorActive,
  mirrorSourceUniverses,
  mirrorDestPairs,
  createMirrorState,
  spliceMirrorFrame,
  mirrorPayload,
  describeMirror,
  BENCH_MIRROR_VERSION,
  DMX_CHANNELS,
};

/**
 * bench_mirror.cjs — pure "stand-in" re-addressing for the sACN bridge.
 *
 * WHY (operator order 2026-07-31): the physical test bench should stop being a
 * bench and become a WINDOW ONTO THE SHIP — "set up test bench to show part of
 * the titanic scene for me — led bars, par lights and vintage lights! LED
 * strings too." The engine runs a ship model; the bench boxes must show exactly
 * the bytes specific ship fixtures are being sent.
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
 * ship par universe). Bars and vintage cannot: no ship fixture of those
 * families ever starts at 107/226 or 41/74. So the bytes have to be MOVED, and
 * this module is the pure half of moving them.
 *
 * ── v3: THE SIDECAR DECLARES SLOTS, NOT PLUMBING (report 20260805_155) ───────
 *
 * v1/v2 authored the plumbing by hand: universes, start addresses, slice
 * lengths and controller IPs, all duplicated out of the scene files. Every one
 * of those numbers could rot against the scene independently, and the failure
 * mode of a rotten one is pixel data landing in a fixture's control channels —
 * "random colours with a green log".
 *
 * v3 removes the whole class. The sidecar declares only what cannot be derived:
 * which BENCH FIXTURE each slot is, and which SOURCE FIXTURE feeds it by
 * default. Every universe, address, footprint, host and slice is RESOLVED FRESH
 * from scene data at ARM time by lib/bench_mirror_resolve.cjs, which then
 * materializes the SAME internal spec shape this module has always consumed and
 * runs it through `validateMirrorTree()` — the same structural invariants a
 * hand-authored map had to satisfy. There is no address to typo because there
 * is no address to author.
 *
 * The source scene is DYNAMIC (operator ruling 2026-08-05): whatever scene the
 * engine is on at ARM time. It is frozen into the computed spec, so the runtime
 * comparison in `isMirrorActive` is unchanged in shape.
 *
 * ── ARMED = THE BENCH IS THE ONLY PHYSICAL OUTPUT (operator ruling) ─────────
 *
 * While armed, ALL ordinary relay to ALL controllers of every active scene is
 * SUSPENDED. The mirror's composed bench destinations are the only sACN the
 * bridge emits, and no browser can transmit to hardware at all (report
 * 20260805_171). There is therefore no per-pair or
 * per-host suppression scope left to declare — `suppress_host` and the v2
 * `controllers:` section are gone — and `partitionMirrorSuppression` degenerates
 * to "armed-or-blackout-hold ⇒ suppress everything", which keeps the `_152` D1
 * single-call-site invariant with strictly simpler semantics.
 *
 * ARMING IS AN OPERATOR GESTURE, NOT A FILE STATE (report 20260804_151). The
 * armed flag is process memory in the bridge, set by an explicit gesture on the
 * Controllers view header, cleared on every bridge start. The checked-in sidecar
 * can therefore never activate hardware by itself.
 *
 * FAIL LOUD. Every structural problem THROWS or REFUSES with the offending path
 * named: unknown keys, missing keys, duplicate slots, ranges that walk off the
 * end of a universe, two slices claiming one destination channel. A mirror that
 * is half-right is worse than no mirror — it is dark or wrong fixtures with a
 * green log.
 */
'use strict';

const { classifyRouteIp, routeKey,
  SACN_UNIVERSE_MIN, SACN_UNIVERSE_MAX } = require('./bridge_routing.cjs');

/** One DMX universe is 512 channels, addressed 1..512. */
const DMX_CHANNELS = 512;

/**
 * The only spec version this build understands.
 *
 * v1 → v2 added `label` and `suppress_host`. v2 → v3 (report 20260805_155)
 * REMOVED the entire plumbing layer instead: no `mirrors`, no `slices`, no
 * universes, no addresses, no IPs, no `source_scene`, no `controllers:`
 * suppression policy. A v1 or v2 file is REFUSED by name with the migration
 * spelled out — never read with assumed values, and never partially applied.
 */
const BENCH_MIRROR_VERSION = 3;

const SPEC_KEYS = new Set(['version', 'enabled', 'label', 'note', 'slots']);
const SLOT_KEYS = new Set(['slot', 'bench_fixture', 'default_source', 'note']);

/** The literal a slot uses to say "feed me nothing — hold this fixture dark". */
const NONE_SOURCE = 'none';

/** Slot ids are snake_case so they can be used as stable keys in the UI + WS. */
const SLOT_ID_RE = /^[a-z][a-z0-9_]*$/;

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

/** The v1/v2 → v3 migration sentence, quoted verbatim into the ARM refusal. */
const V3_MIGRATION =
  ' — v3 no longer carries mirrors, slices, universes, addresses, IPs, ' +
  '`source_scene` or `suppress_host`. Declare `slots` instead (one entry per BENCH ' +
  'fixture: `slot`, `bench_fixture`, `default_source`); the bridge resolves every ' +
  'address from the scene at ARM time, and the source scene is whatever the engine ' +
  'is running. Suppression is no longer scoped: while armed the bench is the ONLY ' +
  'physical output. See report 20260805_155.';

/**
 * Parse + validate one bench-mirror sidecar (the `yaml.load()` result), v3.
 *
 * @param {*} tree parsed YAML
 * @param {string} label where it came from, for error messages
 * @returns {{version:number, enabled:boolean, label:string, note:string,
 *            slots:Array<{slot:string, benchFixture:string,
 *                         defaultSource:(string|null), note:string}>}}
 */
function parseBenchMirrorSpec(tree, label) {
  const where = label || 'bench_mirror.yaml';
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    fail(where, 'the file must contain a mapping (version / enabled / label / slots)');
  }
  // VERSION FIRST, before the unknown-key sweep (report 20260805_158 D-158-5).
  // Every REAL v1/v2 sidecar carries `source_scene` and `mirrors`, which are now
  // unknown keys — so with the sweep first, the migration text below was
  // unreachable for exactly the files it was written for, and the operator got
  // "unknown key 'source_scene'" instead of "here is how to move to v3". The
  // refusal was still loud and non-partial; it was the wrong loud refusal.
  if (tree.version !== BENCH_MIRROR_VERSION) {
    const migration = (tree.version === 1 || tree.version === 2) ? V3_MIGRATION : '';
    fail(where, `version must be ${BENCH_MIRROR_VERSION} (got ${JSON.stringify(tree.version)}) — ` +
      `this build does not know how to read any other layout${migration}`);
  }
  requireKnownKeys(tree, SPEC_KEYS, where);

  if (typeof tree.enabled !== 'boolean') {
    fail(`${where}.enabled`, `must be true or false (got ${JSON.stringify(tree.enabled)})`);
  }
  if (typeof tree.label !== 'string' || tree.label.trim() === '') {
    fail(`${where}.label`, 'must name this stand-in in operator language (e.g. "Test bench ' +
      'stand-in") — it is shown verbatim in the runtime BENCH MIRROR banner, and a banner that ' +
      'cannot say WHICH hardware changed hands is worse than none');
  }
  if (!Array.isArray(tree.slots) || tree.slots.length === 0) {
    fail(`${where}.slots`, 'must be a non-empty list of bench slots — one entry per BENCH ' +
      'fixture this stand-in can drive');
  }

  const slots = [];
  const seenSlotIds = new Set();
  const seenBenchFixtures = new Set();
  tree.slots.forEach((raw, i) => {
    const sWhere = `${where}.slots[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(sWhere, 'must be a mapping (slot / bench_fixture / default_source)');
    }
    requireKnownKeys(raw, SLOT_KEYS, sWhere);

    if (typeof raw.slot !== 'string' || !SLOT_ID_RE.test(raw.slot)) {
      fail(`${sWhere}.slot`, `must be a snake_case id (got ${JSON.stringify(raw.slot)}) — it is ` +
        'the stable key the picker and the WS protocol use');
    }
    if (seenSlotIds.has(raw.slot)) {
      fail(sWhere, `slot id '${raw.slot}' is declared twice — ids must be unique`);
    }
    seenSlotIds.add(raw.slot);

    if (typeof raw.bench_fixture !== 'string' || raw.bench_fixture.trim() === '') {
      fail(`${sWhere}.bench_fixture`, 'must name a fixture in THIS scene\'s patches.yaml ' +
        `(got ${JSON.stringify(raw.bench_fixture)})`);
    }
    const benchFixture = raw.bench_fixture.trim();
    if (seenBenchFixtures.has(benchFixture)) {
      fail(sWhere, `bench fixture '${benchFixture}' is claimed by two slots — one physical ` +
        'fixture cannot be fed by two sources');
    }
    seenBenchFixtures.add(benchFixture);

    // `default_source` is REQUIRED and explicit. `none` is a choice ("hold this
    // fixture dark by default"); absence is not, and inventing one would be the
    // silent default the codex bans.
    if (typeof raw.default_source !== 'string' || raw.default_source.trim() === '') {
      fail(`${sWhere}.default_source`, 'must name a source fixture, or the literal ' +
        `'${NONE_SOURCE}' to hold this slot dark by default ` +
        `(got ${JSON.stringify(raw.default_source)}). There is no implicit default: an absent ` +
        'key would silently decide what a physical fixture shows.');
    }
    const defaultSourceRaw = raw.default_source.trim();

    slots.push({
      slot: raw.slot,
      benchFixture,
      defaultSource: defaultSourceRaw === NONE_SOURCE ? null : defaultSourceRaw,
      note: typeof raw.note === 'string' ? raw.note : '',
    });
  });

  return {
    version: tree.version,
    enabled: tree.enabled,
    label: tree.label.trim(),
    note: typeof tree.note === 'string' ? tree.note : '',
    slots,
  };
}

/**
 * Structural validation of a COMPUTED internal mirror tree.
 *
 * This is the invariant set a hand-authored v2 map had to satisfy, kept alive
 * and applied to the resolver's output (report 20260805_155 §4 step 6): a
 * computed map obeys every rule an authored one did, and if it cannot, ARM
 * refuses (R-19) rather than composing something that "should" be right.
 *
 * EMPTY `slices` ARE LEGAL HERE, unlike in the v2 parser. A destination whose
 * slots are all `none` is still OWNED and composes an all-zero frame — that is
 * the ruling ("armed = the bench is the mirror's, dark where unselected"), not
 * an authoring accident.
 *
 * @param {Array} mirrors [{destUniverse, destHost, note, slices:[...]}]
 * @param {string} where label for error messages
 * @returns {Array} the same mirrors, proven
 */
function validateMirrorTree(mirrors, where) {
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    fail(where, 'the computed mapping has no destinations at all');
  }
  const seenDest = new Set();
  mirrors.forEach((m, i) => {
    const mWhere = `${where}.mirrors[${i}]`;
    requireInt(m.destUniverse, `${mWhere}.destUniverse`,
      { min: SACN_UNIVERSE_MIN, max: SACN_UNIVERSE_MAX });
    if (typeof m.destHost !== 'string') {
      fail(`${mWhere}.destHost`, `must be the controller IP string (got ${JSON.stringify(m.destHost)})`);
    }
    const verdict = classifyRouteIp(m.destHost);
    if (!verdict.admit) {
      fail(`${mWhere}.destHost`, `'${m.destHost}' cannot receive a mirror — ${verdict.reason}`);
    }
    const destKey = `${m.destUniverse}→${m.destHost}`;
    if (seenDest.has(destKey)) {
      fail(mWhere, `U${m.destUniverse} → ${m.destHost} appears twice — the composed frame for a ` +
        'destination must have a single definition');
    }
    seenDest.add(destKey);

    if (!Array.isArray(m.slices)) fail(`${mWhere}.slices`, 'must be a list');
    // Destination channels must have exactly one source. Two slices writing the
    // same channel is a bug whose symptom (one fixture flickering between two
    // sources) is almost impossible to read off the hardware.
    const claimed = new Map(); // dest channel → slice index
    m.slices.forEach((s, j) => {
      const sWhere = `${mWhere}.slices[${j}]`;
      requireInt(s.sourceUniverse, `${sWhere}.sourceUniverse`,
        { min: SACN_UNIVERSE_MIN, max: SACN_UNIVERSE_MAX });
      requireInt(s.length, `${sWhere}.length`, { min: 1, max: DMX_CHANNELS });
      requireInt(s.sourceAddr, `${sWhere}.sourceAddr`, { min: 1, max: DMX_CHANNELS });
      requireInt(s.destAddr, `${sWhere}.destAddr`, { min: 1, max: DMX_CHANNELS });
      if (s.sourceAddr + s.length - 1 > DMX_CHANNELS) {
        fail(sWhere, `source range ${s.sourceAddr}..${s.sourceAddr + s.length - 1} walks past ` +
          `channel ${DMX_CHANNELS} of U${s.sourceUniverse}`);
      }
      if (s.destAddr + s.length - 1 > DMX_CHANNELS) {
        fail(sWhere, `destination range ${s.destAddr}..${s.destAddr + s.length - 1} walks past ` +
          `channel ${DMX_CHANNELS} of U${m.destUniverse}`);
      }
      for (let ch = s.destAddr; ch < s.destAddr + s.length; ch += 1) {
        if (claimed.has(ch)) {
          fail(sWhere, `destination channel ${ch} of U${m.destUniverse} is already written by ` +
            `slices[${claimed.get(ch)}] — two sources for one channel is ambiguous`);
        }
        claimed.set(ch, j);
      }
    });
  });
  return mirrors;
}

/**
 * Is this COMPUTED spec allowed to run right now? THREE conditions, all required.
 *
 * 1. `enabled: true` — the operator's switch, in the sidecar itself.
 * 2. The ENGINE is still on the scene the mapping was computed against. The map
 *    re-addresses bytes by their POSITION in that scene's universes, so it is
 *    meaningless — and actively harmful — against any other model's bytes.
 * 3. The bridge is ARMED for this spec's scene. Process memory only, set by an
 *    explicit operator gesture, cleared on every bridge start, on DISARM, on the
 *    arming window's disconnect, and on any degrade (report 20260804_151). The
 *    deployment guard is preserved by construction: a deployed tree that nobody
 *    arms mirrors nothing, because the flag is never read from or written to
 *    disk.
 *
 * These are declared preconditions, not fallbacks: when any is false the mirror
 * does nothing, suppresses nothing, and the caller says so out loud.
 *
 * @param {Object} spec COMPUTED spec (carries the frozen `sourceScene`)
 * @param {string|null} engineScene the engine's active scene (null = unreachable)
 * @param {boolean} armed is the bridge armed FOR THIS SPEC'S SCENE?
 * @returns {boolean}
 */
function isMirrorActive(spec, engineScene, armed) {
  if (!spec || !spec.enabled) return false;
  if (armed !== true) return false;
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

/** Every (universe, host) pair the mirror OWNS and composes. */
function mirrorDestPairs(spec) {
  return spec.mirrors.map(m => ({ universe: m.destUniverse, ip: m.destHost }));
}

/**
 * Split the effective relay route set into what the ordinary relay may still
 * send and what the BENCH MIRROR has taken over.
 *
 * ── ARMED = BENCH ONLY (operator ruling 2026-08-05) ─────────────────────────
 *
 * While a mirror is active, or while a DISARM blackout is in flight, the relay
 * set is EMPTY. Every ordinary relay route of every active scene is suspended;
 * the mirror's composed bench destinations are the only sACN the bridge emits.
 * Two reasons are reported so the log can say WHY:
 *
 *   - `armed`:    a bench mirror is live. The ship is deliberately not being fed
 *                 (it was zeroed on ARM — see the bridge's ship-dark sequence).
 *   - `blackout`: a DISARM is in flight. Its all-zero frames to the BENCH have
 *                 not all landed yet, so the mirror has not finished handing the
 *                 hardware back and the relay may not take anything yet
 *                 (`_152` D1). Without this, any recompute landing while
 *                 `disarmBenchMirror` is suspended at its `await` — a client's
 *                 `setScene`, a client disconnect, an engine poll — re-creates
 *                 relay senders on pairs the blackout is still writing to, and a
 *                 raw frame goes out between two zero frames on the same
 *                 (universe, controller).
 *
 * The hold is stated by the CALLER (which owns the blackout) rather than derived
 * from `mirrors`, because by the time it matters `_activeMirrors` is already
 * empty — clearing it is the first thing the disarm does.
 *
 * Pure — the caller owns the logging and the sender diff.
 *
 * @param {Object} args
 * @param {Array<{universe:number, ip:string, scenes?:string[]}>} args.routes
 * @param {Array<{scene:string, spec:Object}>} args.mirrors the ACTIVE mirrors
 * @param {{scene:string}|null} [args.hold] a blackout that has not finished
 * @returns {{relay:Array, suppressed:Array<{universe:number, ip:string,
 *            scenes:string[], why:'armed'|'blackout', scene:string}>,
 *            ownedKeys:Set<string>,
 *            targets:Map<string,{universe:number, ip:string, scene:string}>}}
 */
function partitionMirrorSuppression({ routes, mirrors, hold }) {
  const ownedKeys = new Set();
  const targets = new Map();
  const active = mirrors || [];
  for (const m of active) {
    for (const pair of mirrorDestPairs(m.spec)) {
      const key = routeKey(pair.universe, pair.ip);
      ownedKeys.add(key);
      targets.set(key, { universe: pair.universe, ip: pair.ip, scene: m.scene });
    }
  }

  const armedScene = active.length > 0 ? active[0].scene : null;
  const holding = (hold !== null && hold !== undefined && typeof hold === 'object');
  if (armedScene === null && !holding) {
    return { relay: [...(routes || [])], suppressed: [], ownedKeys, targets };
  }

  const why = armedScene !== null ? 'armed' : 'blackout';
  const scene = armedScene !== null ? armedScene : ((hold && hold.scene) ? hold.scene : '');
  const suppressed = (routes || []).map(r => ({
    universe: r.universe,
    ip: r.ip,
    scenes: Array.isArray(r.scenes) ? r.scenes : [],
    why,
    scene,
  }));
  return { relay: [], suppressed, ownedKeys, targets };
}

// ── ARM / DISARM decisions (reports 20260804_151, 20260805_155) ─────────────
//
// Pure so every refusal branch is unit-testable with no socket, no sender and
// no engine. The bridge owns the state, the sends, the file reads and the logs;
// these two functions own the JUDGEMENT.
//
// Codex P0 shape: every failure is a NAMED refusal, never a silent no-op and
// never a permissive default. "Ownership unprovable" refuses — it does not
// assume the destination is free.

/** Find one scene's parsed sidecar among the freshly read set. */
function findSpec(specs, scene) {
  for (const s of specs || []) {
    if (s.scene === scene) return s;
  }
  return null;
}

/**
 * May the bridge arm the bench mirror for `scene` right now?
 *
 * This is the STATE half of the decision. The MAPPING half (can the slots be
 * resolved, is every chosen source compatible) lives in
 * lib/bench_mirror_resolve.cjs and runs after this returns ok — the two are
 * sequenced by the bridge so each refusal is attributable.
 *
 * @param {Object} args
 * @param {string} args.scene                 the sidecar scene the operator named
 * @param {Array<{scene:string, spec:Object}>} args.specs sidecars that PARSED
 * @param {Array<{scene:string, message:string}>} args.specErrors sidecars that did not
 * @param {{reachable:boolean, scene:(string|null), owned:Set<string>,
 *          ownedUnavailable:boolean}} args.engineState
 * @param {{scene:string}|null} args.activeArm the arm in force, if any
 * @param {boolean} args.blackoutInFlight a blackout's zero frames are still going out
 * @param {Array<{scene:string, pairs:Array<{universe:number, ip:string}>}>} [args.otherClaims]
 *        destination pairs OTHER enabled sidecars resolve onto (best effort)
 * @param {Array<{universe:number, ip:string, scenes?:string[]}>} args.relayRoutes
 *        the effective relay set as it stands BEFORE arming
 * @param {number} args.clientCount connected sim windows
 * @returns {{ok:boolean, refusal:(string|null), warnings:string[], scene:string,
 *            sourceScene:(string|null), label:(string|null)}}
 */
function evaluateArmRequest({ scene, specs, specErrors, engineState, activeArm,
  blackoutInFlight, otherClaims, relayRoutes, clientCount }) {
  const base = {
    ok: false, refusal: null, warnings: [], scene: typeof scene === 'string' ? scene : '',
    sourceScene: null, label: null,
  };
  const refuse = (message) => ({ ...base, refusal: message });

  // R-5b, FIRST, before anything else (_152 D2). A disarm in flight has ALREADY
  // set `activeArm` to null, so the "already armed — disarm first" branch below
  // cannot see it; without this check an ARM landing inside the blackout window
  // is accepted, the re-arm skips the blackout it is supposed to go through, and
  // the disarm that is still finishing prints "BENCH MIRROR DISARMED … released"
  // about a bridge that is armed. A lying log is the one outcome this design
  // exists to make impossible.
  if (blackoutInFlight === true) {
    return refuse('ARM refused: a blackout is still in flight — its all-zero frames have not ' +
      'finished going out, so the hardware has not yet been handed over. Wait for the DISARMED ' +
      'line and arm again.');
  }

  // R-1
  if (typeof scene !== 'string' || scene.trim() === '') {
    return refuse('ARM refused: no scene named. The arm message must carry the scene whose ' +
      'bench_mirror.yaml is to be armed — the bridge never picks one for you.');
  }

  // R-2 / R-20
  const broken = (specErrors || []).find(e => e.scene === scene);
  if (broken) {
    return refuse(`ARM refused: scene '${scene}' has a bench_mirror.yaml that does not parse — ` +
      `${broken.message} Nothing is mirrored until the file is fixed.`);
  }

  // R-3
  const found = findSpec(specs, scene);
  if (!found) {
    return refuse(`ARM refused: scene '${scene}' declares no bench_mirror.yaml. ` +
      `Scenes that do: ${(specs || []).map(s => s.scene).join(', ') || 'none'}.`);
  }
  const spec = found.spec;
  base.label = spec.label;

  // R-4
  if (spec.enabled !== true) {
    return { ...refuse(`ARM refused: ${scene}/bench_mirror.yaml has 'enabled: false' — the map ` +
      'is switched off in the file itself. Set it true and save; the bridge re-reads on the ' +
      'next recompute, no restart.'), label: spec.label };
  }

  // R-5
  if (activeArm && activeArm.scene !== scene) {
    return { ...refuse(`ARM refused: the bench mirror is already armed for '${activeArm.scene}'. ` +
      'DISARM it first — the bridge will not swap one live re-address for another without a ' +
      'clean blackout in between.'), label: spec.label };
  }
  if (activeArm && activeArm.scene === scene) {
    return { ...refuse(`ARM refused: already armed for '${scene}'. DISARM first if you want to ` +
      're-arm (a re-arm must go through the blackout, not around it).'), label: spec.label };
  }

  // R-6 / R-7 — the source scene is the ENGINE's scene, so an engine that cannot
  // be reached, or that reports no scene, makes the source UNPROVABLE.
  if (engineState.reachable !== true) {
    return { ...refuse('ARM refused: the engine is unreachable, so the scene whose bytes would ' +
      'feed the bench cannot be confirmed. The mapping re-addresses bytes BY POSITION in the ' +
      'running model\'s universes; computing it against an unknown model is guesswork.'),
    label: spec.label };
  }
  if (typeof engineState.scene !== 'string' || engineState.scene === '') {
    return { ...refuse('ARM refused: the engine reports no active scene, so there is no source ' +
      'to mirror. Load a scene in the engine and arm again.'), label: spec.label };
  }
  base.sourceScene = engineState.scene;

  // R-22a — a scene cannot stand in for itself: source and destination would be
  // the same boxes, so the mirror would compose a box's own bytes back onto it.
  if (engineState.scene === scene) {
    return { ...refuse(`ARM refused: the engine is running '${engineState.scene}', which is the ` +
      'stand-in scene itself. A scene cannot stand in for itself — source and destination would ' +
      'be the same controllers. Put the engine on the scene you want to SEE on the bench.'),
    label: spec.label, sourceScene: engineState.scene };
  }

  // R-8
  if (engineState.ownedUnavailable === true) {
    return { ...refuse('ARM refused: the engine\'s /status carries no outputRouting field, so ' +
      'which universes the ENGINE delivers itself is UNPROVABLE. "The bench is the only physical ' +
      'output" cannot be proven against an unknown engine route set. Restart the engine on ' +
      'current code.'), label: spec.label, sourceScene: engineState.scene };
  }

  // R-21 (subsumes the old R-9/R-10, strictly stronger) — the bridge cannot
  // suspend what the ENGINE unicasts itself, and address-keyed comparison cannot
  // establish BOARD identity (report 20260805_153 F4: one board can answer on two
  // addresses). So any engine-direct destination at all makes "bench only"
  // unprovable, and unprovable refuses (codex P0).
  const owned = engineState.owned instanceof Set ? engineState.owned : new Set();
  if (owned.size > 0) {
    return { ...refuse('ARM refused: the ENGINE delivers ' +
      `${[...owned].sort().join(', ')} directly to hardware, bypassing the bridge. While armed ` +
      'the bench must be the ONLY physical output, and the bridge cannot suspend an engine-direct ' +
      'route — so "bench only" cannot be proven. Engine output must flow through the bridge: ' +
      'remove the direct route declaration from the engine config and restart it.'),
    label: spec.label, sourceScene: engineState.scene };
  }

  // R-11 lives in `evaluateClaimOverlap` below, NOT here: this function runs
  // before the arming scene is resolved, so its own destination pairs are not
  // yet known and an intersection is not computable at this point. The version
  // that used to live here refused whenever ANY other sidecar had ANY pair —
  // including a disjoint universe on a different host — and said "resolves onto
  // the SAME destination(s)", which was untrue (report 20260805_158 D-158-4).

  // ── Warnings — loud, never blocking ───────────────────────────────────────
  const routes = relayRoutes || [];
  if (routes.length > 0) {
    base.warnings.push(`ALL ordinary relay will be SUSPENDED — ${routes.length} route(s) across ` +
      `${new Set(routes.map(r => r.ip)).size} controller(s) stop receiving physical data and are ` +
      'zeroed 3× on the way out. The ship goes DARK (deliberately, not frozen); the sim keeps ' +
      'showing it correctly. The bench is the only physical output while armed.');
  }
  if (Number(clientCount) > 1) {
    base.warnings.push(`⚠ ${Math.floor(Number(clientCount))} sim windows are connected. Arming ` +
      'anyway (operator ruling), and harmlessly: a sim window cannot transmit to hardware at ' +
      'all any more (report 20260805_171), so extra windows cost GPU and nothing else. They ' +
      'used to be independent priority-150 writers to the ship\'s controllers.');
  }
  base.warnings.push('While armed, any per-output LED push will FAIL its route read-back — ' +
    'correct, not a push bug: the relay is suspended and the mirror owns the bench routes.');
  base.warnings.push('If a bench fixture shows garbage while armed, check ITS personality/menu ' +
    'against the scene\'s declared profile — the mapping itself is verified from scene data at ' +
    'arm time, so a wrong-looking fixture is a physical-personality mismatch, not a slice typo.');

  base.ok = true;
  return base;
}

/**
 * **R-11** — two stand-ins composing one destination is one sender and two
 * payloads. Run AFTER resolution, because it needs the arming scene's own
 * computed destination pairs; `evaluateArmRequest` cannot see them yet.
 *
 * Refuses on a REAL INTERSECTION and names ONLY the pairs that actually collide
 * (report 20260805_158 D-158-4 — the previous version refused on any non-empty
 * other-claim and then printed a sentence that was false).
 *
 * Structurally unreachable while only one arm can exist at a time; this is the
 * guard that makes it stay that way, and it now says something true when a
 * second rig eventually gets a sidecar.
 *
 * @param {Object} args
 * @param {string} args.scene the scene being armed
 * @param {Array<{universe:number, ip:string}>} args.destinations its COMPUTED pairs
 * @param {Array<{scene:string, pairs:Array<{universe:number, ip:string}>}>} args.otherClaims
 * @returns {string|null} a refusal, or null
 */
function evaluateClaimOverlap({ scene, destinations, otherClaims }) {
  const mine = new Set((destinations || []).map(p => routeKey(p.universe, p.ip)));
  for (const other of otherClaims || []) {
    if (other.scene === scene) continue;
    const collisions = (other.pairs || [])
      .filter(p => mine.has(routeKey(p.universe, p.ip)))
      .map(p => `U${p.universe} → ${p.ip}`);
    if (collisions.length > 0) {
      return `ARM refused [R-11]: scene '${other.scene}' has an enabled bench_mirror.yaml that ` +
        `resolves onto the same destination(s) ${collisions.join(', ')}. Two stand-ins composing ` +
        'one destination is one sender and two payloads — disable one of them.';
    }
  }
  return null;
}

/**
 * Is a live arm still legitimate? Returns a NAMED reason to auto-disarm, or null.
 *
 * Called on every route recompute while armed. Every branch is a real
 * transition an operator can cause without touching the arm control, and each
 * one makes the mirror either wrong (bad bytes) or a second writer — so the flag
 * must follow, loudly, or the banner outlives the thing it describes.
 *
 * The RE-RESOLUTION check (has the scene edit changed the computed mapping?)
 * lives in the bridge, which owns the file reads; it reports its own reason.
 *
 * @param {Object} args
 * @param {string} args.scene the armed sidecar scene
 * @param {string} args.sourceScene the scene the mapping was computed against
 * @param {Array} args.specs
 * @param {Array} args.specErrors
 * @param {Object} args.engineState
 * @returns {string|null}
 */
function evaluateArmedHealth({ scene, sourceScene, specs, specErrors, engineState }) {
  const broken = (specErrors || []).find(e => e.scene === scene);
  if (broken) return `${scene}/bench_mirror.yaml stopped parsing: ${broken.message}`;
  const found = findSpec(specs, scene);
  if (!found) return `${scene}/bench_mirror.yaml disappeared`;
  const spec = found.spec;
  if (spec.enabled !== true) return `${scene}/bench_mirror.yaml was switched to 'enabled: false'`;
  if (engineState.reachable !== true) {
    return 'the engine became unreachable, so its scene can no longer be confirmed';
  }
  if (engineState.scene !== sourceScene) {
    return `the engine left scene '${sourceScene}' (now '${engineState.scene}') — ` +
      'this mapping is only valid against that model\'s byte layout';
  }
  if (engineState.ownedUnavailable === true) {
    return 'the engine stopped reporting outputRouting — engine ownership became unprovable';
  }
  const owned = engineState.owned instanceof Set ? engineState.owned : new Set();
  if (owned.size > 0) {
    return `the engine took direct ownership of ${[...owned].sort().join(', ')} — an ` +
      'engine-direct route bypasses the bridge, so "the bench is the only physical output" ' +
      'can no longer be proven';
  }
  return null;
}

/**
 * Build the runtime state: one persistent 512-byte buffer per destination plus
 * the source→slices index the packet handler walks.
 *
 * The buffers PERSIST across frames on purpose. Sources arrive as separate
 * datagrams; a destination composed from three of them would otherwise be sent
 * two-thirds blank on every frame.
 *
 * `requiredSources` is what makes the emission cadence correct (report
 * 20260805_153 §10): a destination composed from N source universes may only be
 * SENT once all N have contributed to the frame being assembled. Without it the
 * bridge emitted once per libuv poll phase — 1 to 3 composed sends per engine
 * frame depending on how the source datagrams happened to split across phases,
 * with 50-67 % of them carrying a stale region from the previous frame. That is
 * sub-frame TEARING, and because the emission rate then varies, the sequence
 * offset against any other writer on the same universe drifts through all 256
 * values every few seconds — multi-second beats of sane-then-garbage. It also
 * explains exactly why the DMX gateway (5 slices, 3 sources) flickered while the
 * single-source LED destinations did not.
 *
 * @param {Object} spec COMPUTED spec
 * @returns {{buffers:Map<string,Uint8Array>, bySource:Map<number,Array>,
 *            targets:Array, requiredSources:Map<string,Set<number>>}}
 */
function createMirrorState(spec) {
  const buffers = new Map();     // destKey → Uint8Array(512)
  const targets = [];            // { key, universe, ip }
  const bySource = new Map();    // source universe → [{ destKey, sourceAddr, length, destAddr }]
  const requiredSources = new Map(); // destKey → Set<source universe>

  // Every source universe the WHOLE mapping reads. A held-dark destination has
  // no sources of its own, so this is the only honest definition of "an engine
  // frame has happened" available to it — see below.
  const allSources = new Set();
  for (const m of spec.mirrors) {
    for (const s of m.slices) allSources.add(s.sourceUniverse);
  }

  for (const m of spec.mirrors) {
    const key = `${m.destUniverse}→${m.destHost}`;
    buffers.set(key, new Uint8Array(DMX_CHANNELS));
    targets.push({ key, universe: m.destUniverse, ip: m.destHost });

    if (m.slices.length === 0) {
      // ── HELD DARK, and that means SENT (report 20260805_158 D-158-2) ───────
      // A destination whose every slot is `none` is still OWNED, and the ruling
      // (`_155` §6.1) is that it "composes all-zero frames … dark where
      // unselected". Registering it with no sources made it un-dirty-able, so
      // nothing was ever written to it and the box HELD ITS LAST LOOK — the
      // exact frozen-vs-dark failure §4.2 of the design argues against, on the
      // one destination reachable with a single picker click. It is also the
      // `.60` box, whose applied binding is already an open question, so a
      // frozen strand would have been misread as that.
      //
      // Its tick is the mapping's OWN engine frame: it emits when every source
      // the mapping reads has arrived, exactly like its sourced siblings, so a
      // dark box is refreshed at the same rate as a lit one and never faster.
      // The zero-length entries below write nothing; they exist purely to make
      // the destination reachable from `spliceMirrorFrame`'s `touched` set.
      requiredSources.set(key, new Set(allSources));
      for (const u of allSources) {
        if (!bySource.has(u)) bySource.set(u, []);
        bySource.get(u).push({ destKey: key, sourceAddr: 1, length: 0, destAddr: 1 });
      }
      continue;
    }

    requiredSources.set(key, new Set(m.slices.map(s => s.sourceUniverse)));
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
  return { buffers, bySource, targets, requiredSources };
}

/**
 * Splice one inbound frame into the destination buffers it feeds.
 *
 * @param {Object} state from createMirrorState
 * @param {number} universe the inbound universe
 * @param {Object|null} payload RAW DMX ({ channel: 0..255 }, 1-based). The
 *   caller (`sacn_bridge.js` `rawDmxPayload`) reads the packet's untouched wire
 *   bytes; before report 20260805_170 it passed the `sacn` package's PERCENT
 *   view instead, and writing those floats into the `Uint8Array` below
 *   truncated the mirror to ~100 levels (`_153` F7 / `_105` F8). Integers in,
 *   integers out — the quantisation is gone with the unit, not with a rounding
 *   change here.
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

/** One-line human summary of what a computed spec will do, for the arm log. */
function describeMirror(spec) {
  const lines = [];
  for (const m of spec.mirrors) {
    const chans = m.slices.reduce((n, s) => n + s.length, 0);
    const sources = [...new Set(m.slices.map(s => `U${s.sourceUniverse}`))].join('+') || 'nothing';
    lines.push(`U${m.destUniverse} → ${m.destHost} ` +
      `(${m.slices.length} slice(s), ${chans} ch, from ${sources})`);
  }
  return lines;
}

module.exports = {
  parseBenchMirrorSpec,
  validateMirrorTree,
  isMirrorActive,
  mirrorSourceUniverses,
  mirrorDestPairs,
  partitionMirrorSuppression,
  evaluateArmRequest,
  evaluateClaimOverlap,
  evaluateArmedHealth,
  createMirrorState,
  spliceMirrorFrame,
  mirrorPayload,
  describeMirror,
  BENCH_MIRROR_VERSION,
  DMX_CHANNELS,
  NONE_SOURCE,
  // The admitted-key sets are the REAL no-plumbing guarantee (a sidecar cannot
  // carry an address because no key would hold one), so a test may assert
  // against them directly rather than re-deriving them from a text scan.
  SPEC_KEYS,
  SLOT_KEYS,
};

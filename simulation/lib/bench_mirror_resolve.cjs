/**
 * bench_mirror_resolve.cjs — ARM-time resolution of a v3 bench-mirror sidecar
 * into the internal mirror spec the bridge has always composed from.
 *
 * WHY THIS EXISTS (report 20260805_155). The v2 sidecar authored the plumbing by
 * hand: universes, DMX start addresses, slice lengths and controller IPs, all
 * copied out of the scene files. Every one of those numbers could rot against
 * the scene independently, and a rotten one puts pixel data into a fixture's
 * control channels — "random colours with a green log". v3 declares only SLOTS
 * (which bench fixture, and which source fixture feeds it); everything physical
 * is resolved HERE, fresh, from live scene data, at the moment of arming. There
 * is no address to typo because there is no address to author.
 *
 * PURE. The caller does the `fs` reads and hands parsed trees in, so every
 * branch below is unit-testable with no I/O, no socket and no engine.
 *
 * COMPATIBILITY IS BY IDENTITY, NOT BY SHAPE (report 20260805_155 §5).
 * A DMX slot accepts a source only when both ends declare the SAME
 * `fixtureType` string, because both then resolve through the ONE fixture
 * definition under `dmx/fixtures/<family>/model_*.yaml` — identical footprint AND
 * identical per-channel meaning, by construction. Footprint equality alone is
 * NOT enough (two 10-channel profiles can order their channels differently) and
 * name-pattern matching is exactly the guess the codex bans. There is no
 * channel-map translation layer, deliberately: a hand-maintained second channel
 * map is the artifact class that produces this bug.
 *
 * THE ONE ASYMMETRY. Ship strands are 40 px, bench strands 20 px. Requiring
 * equality would make every strand slot permanently un-armable, so `led_strand`
 * allows `srcPx >= destPx` with a PREFIX copy, warned at ARM and noted in the
 * picker. Typed LED fixtures (a sign) do NOT get that allowance: a sign is a
 * shape, and a prefix of it is scrambled content rather than a smaller sign.
 *
 * ── PER-SLOT PIXEL REVERSE (design report 20260806_174 §3.5, §4) ────────────
 *
 * A slot may be armed REVERSED: destination pixel block k is fed from source
 * pixel block N-1-k. It exists because two individually-correct scenes can still
 * disagree about which way their fixtures are wired — the observed case is the
 * bench bars running toward decreasing X while the ship walls run toward
 * increasing X.
 *
 * THE MIRROR IS WIRE→WIRE, AND THIS MODULE IS CONTRACTUALLY FORBIDDEN FROM
 * READING EITHER SCENE'S SCENE-LEVEL PIXEL-ORDER STORE. The composition algebra
 * (§4 of the design) is: with `S_src` the source scene's own correction, `M`
 * this slot toggle and `G_s`/`G_d` the two fixtures' physical wiring, a bench
 * that replicates the ship requires exactly `M = G_s ∘ G_d` — the RELATIVE
 * orientation of the two physical fixtures, independent of both scenes' flags,
 * because each scene's correction is already baked into its own wire stream
 * before the mirror ever sees a byte. Reading a scene-level store here would
 * apply a correction twice. The inputs to this file are patches, controllers,
 * scene fixture types, fixture definitions and the sidecar — nothing else, and
 * a source-grep test enforces it.
 *
 * REVERSAL IS DEFINITION-DRIVEN, NEVER BYTE-DRIVEN. A DMX fixture's reversal
 * permutes WHOLE PER-PIXEL CHANNEL MAPS taken from the fixture definition, so
 * Vintage's non-contiguous per-head lanes (`value` 3..8, `rgb` 16..33) permute
 * correctly, Shehds' RGBWAV blocks stay intact, w/a bytes never swap with each
 * other, and channels no pixel claims (dimmer, strobe, macros) are identity-
 * copied. Reversing the raw footprint bytes instead would turn a fixture's
 * control channels into pixel data — the exact "random colours with a green
 * log" failure this whole subsystem exists to prevent.
 */
'use strict';

const { validateMirrorTree, DMX_CHANNELS } = require('./bench_mirror.cjs');
const { classifyRouteIp } = require('./bridge_routing.cjs');

/**
 * Refusal ids match the catalog in report 20260805_155 §9 / §15.A7, continued
 * by report 20260806_174 §3.3 (R-24 … R-26, the reverse-pixels rules).
 */
const R = {
  UNKNOWN_SLOT: 'R-12',
  INCOMPLETE_SELECTION: 'R-13',
  UNKNOWN_SOURCE: 'R-14',
  INCOMPATIBLE: 'R-15',
  SLOT_UNRESOLVABLE: 'R-16',
  AMBIGUOUS_IDENTITY: 'R-18',
  COMPUTED_INVALID: 'R-19',
  NO_CANDIDATES: 'R-22b',
  DEFAULT_UNRESOLVABLE: 'R-22c',
  SELECTION_SHAPE: 'R-24',
  REVERSE_NOT_APPLICABLE: 'R-25',
  REVERSE_UNPROVABLE: 'R-26',
};

/** The new selection shape, quoted verbatim into every shape refusal. */
const SELECTION_SHAPE_TEXT =
  "{ '<slot>': { source: '<fixture name>' | null, reverse: true | false } }";

/**
 * Index a scene's `scene_config.yaml` fixture declarations by name.
 *
 * A name declared twice with DIFFERENT `fixtureType`s is an ambiguity the
 * bridge refuses to resolve (R-18) — picking either one would silently decide
 * what a physical fixture shows.
 *
 * @param {Object} sceneConfig parsed scene_config.yaml
 * @returns {{types:Map<string,string>, ambiguous:Set<string>}}
 */
function indexFixtureTypes(sceneConfig) {
  const types = new Map();
  const ambiguous = new Set();
  const groups = (sceneConfig && sceneConfig.parLights) ? sceneConfig.parLights : {};
  for (const value of Object.values(groups)) {
    if (!Array.isArray(value)) continue;
    for (const f of value) {
      if (!f || typeof f.name !== 'string' || typeof f.fixtureType !== 'string') continue;
      if (types.has(f.name) && types.get(f.name) !== f.fixtureType) {
        ambiguous.add(f.name);
        continue;
      }
      types.set(f.name, f.fixtureType);
    }
  }
  return { types, ambiguous };
}

/** Every controller entry of a scene, indexed by IP. */
function indexControllers(controllers) {
  const byIp = new Map();
  for (const c of (controllers && controllers.controllers) || []) {
    if (!c || typeof c.ip !== 'string') continue;
    if (!byIp.has(c.ip)) byIp.set(c.ip, []);
    byIp.get(c.ip).push(c);
  }
  return byIp;
}

/**
 * The controller entry that actually carries `(universe, ip)` on one of its
 * ports. A patch record whose universe no port declares is a scene-authoring
 * inconsistency, not something to route around.
 */
function findControllerPort(byIp, ip, universe) {
  for (const c of byIp.get(ip) || []) {
    for (const p of c.ports || []) {
      if (Number(p.universe) === Number(universe)) return { controller: c, port: p };
    }
  }
  return null;
}

/**
 * The pixel-space segment list of an LED patch record: `[{universe,
 * startChannel, pixelCount}]`. A record with no `segments[]` is treated as one
 * segment at its own universe/address — the shape `readPatchDeclarations`
 * already assumes elsewhere.
 */
function patchSegments(patch) {
  if (Array.isArray(patch.segments) && patch.segments.length > 0) {
    return patch.segments.map(s => ({
      universe: Number(s.universe),
      startChannel: Number(s.startChannel),
      endChannel: Number(s.endChannel),
      pixelCount: Number(s.pixelCount),
    }));
  }
  return [{
    universe: Number(patch.dmxUniverse),
    startChannel: Number(patch.dmxAddress),
    endChannel: Number(patch.endChannel),
    pixelCount: Number(patch.pixelCount),
  }];
}

/**
 * Expand an LED patch into a per-pixel `(universe, channel)` list, so a copy
 * between two strands is a pixel-space walk rather than a channel-space
 * assumption. Handles a future multi-universe strand on either side; today both
 * sides are 1:1.
 */
function pixelLocations(patch, stride) {
  const out = [];
  for (const seg of patchSegments(patch)) {
    for (let i = 0; i < seg.pixelCount; i += 1) {
      out.push({ universe: seg.universe, channel: seg.startChannel + (i * stride) });
    }
  }
  return out;
}

/** The `led:` block of a controller, normalized. Missing = not an LED port. */
function ledFormat(controller) {
  const led = controller && controller.led;
  if (!led || typeof led !== 'object') return null;
  const stride = Number(led.stride);
  if (!Number.isInteger(stride) || stride < 1) return null;
  return {
    order: typeof led.order === 'string' ? led.order : null,
    stride,
    whiteMode: typeof led.whiteMode === 'string' ? led.whiteMode : null,
    wire: led.wire || null,
  };
}

function sameFormat(a, b) {
  return a !== null && b !== null
    && a.order === b.order && a.stride === b.stride && a.whiteMode === b.whiteMode;
}

/**
 * Resolve ONE fixture name in a scene into everything the mapping needs.
 *
 * @returns {{ok:true, resolved:Object}|{ok:false, why:string}}
 */
function resolveFixture({ name, patches, byIp, fixtureTypes, ambiguous, registry }) {
  const patch = (patches && patches.patches) ? patches.patches[name] : undefined;
  if (!patch || typeof patch !== 'object') {
    return { ok: false, why: `no patch entry named '${name}'` };
  }
  if (ambiguous.has(name)) {
    return { ok: false, why: `'${name}' is declared more than once in scene_config.yaml with ` +
      'different fixtureTypes — fix the scene; the bridge will not pick' };
  }
  const ip = typeof patch.controllerIp === 'string' ? patch.controllerIp.trim() : '';
  const universe = Number(patch.dmxUniverse);
  const addr = Number(patch.dmxAddress);
  if (ip === '' || !Number.isInteger(universe) || !Number.isInteger(addr)) {
    return { ok: false, why: `'${name}' has an incomplete patch record ` +
      `(controllerIp=${JSON.stringify(patch.controllerIp)}, universe=${patch.dmxUniverse}, ` +
      `address=${patch.dmxAddress})` };
  }
  const verdict = classifyRouteIp(ip);
  if (!verdict.admit) {
    return { ok: false, why: `'${name}' is patched to '${ip}', which cannot carry sACN — ` +
      verdict.reason };
  }
  const hit = findControllerPort(byIp, ip, universe);
  if (!hit) {
    return { ok: false, why: `no controller in controllers.yaml declares a port on ` +
      `U${universe} → ${ip} for '${name}'` };
  }

  const fixtureType = fixtureTypes.has(name) ? fixtureTypes.get(name) : null;
  const pixelCount = Number.isInteger(patch.pixelCount) ? patch.pixelCount : null;
  const ctrlType = typeof hit.controller.type === 'string' ? hit.controller.type : '';
  const fmt = ledFormat(hit.controller);

  // `kind` is DERIVED, never declared — one less thing to rot.
  let kind = null;
  if (pixelCount !== null && fixtureType === null) kind = 'led_strand';
  else if (fixtureType !== null && ctrlType === 'LED') kind = 'led_fixture';
  else if (fixtureType !== null && ctrlType === 'DMX') kind = 'dmx';
  if (kind === null) {
    return { ok: false, why: `the kind of '${name}' cannot be derived — fixtureType=` +
      `${JSON.stringify(fixtureType)}, pixelCount=${JSON.stringify(patch.pixelCount)}, ` +
      `controller type=${JSON.stringify(hit.controller.type)}. The mirror maps only what the ` +
      'scene proves' };
  }

  let footprintCh = null;
  let definition = null;
  if (kind === 'dmx' || kind === 'led_fixture') {
    if (!registry.has(fixtureType)) {
      return { ok: false, why: `no fixture definition for '${fixtureType}' (fixture '${name}') — ` +
        'add its model_*.yaml under simulation/dmx/fixtures/' };
    }
    definition = registry.get(fixtureType);
    footprintCh = definition.footprint;
  }
  if (kind === 'led_strand' || kind === 'led_fixture') {
    if (fmt === null) {
      return { ok: false, why: `controller '${hit.controller.name}' carries '${name}' but ` +
        'declares no usable `led:` block (order / stride / whiteMode)' };
    }
    if (pixelCount === null || pixelCount < 1) {
      return { ok: false, why: `'${name}' is on an LED port but declares no pixelCount` };
    }
    const spanned = patchSegments(patch).reduce((n, s) => n + s.pixelCount, 0);
    if (spanned !== pixelCount) {
      return { ok: false, why: `'${name}' declares pixelCount ${pixelCount} but its segments ` +
        `span ${spanned} px — the patch record is inconsistent` };
    }
    if (kind === 'led_strand') footprintCh = pixelCount * fmt.stride;
    else if (footprintCh !== pixelCount * fmt.stride) {
      return { ok: false, why: `'${name}' is a ${fixtureType} (${footprintCh} ch) but its patch ` +
        `spans ${pixelCount} px × ${fmt.stride} = ${pixelCount * fmt.stride} ch — the scene and ` +
        'the fixture definition disagree' };
    }
  }

  return {
    ok: true,
    resolved: {
      name,
      kind,
      fixtureType,
      footprintCh,
      pixelCount,
      pixelFormat: fmt,
      patch,
      controller: { name: hit.controller.name, ip },
      universe,
      addr,
      // The fixture DEFINITION's per-pixel channel maps — the only thing a DMX
      // reversal is allowed to permute (design 20260806_174 §3.5). `null` when
      // the definition could not be proven permutable (including a registry
      // entry that carries no `pixels` at all); the reason travels with it so an
      // ARM refusal can name the offending model file. UNPROVABLE REFUSES — it
      // never assumes an identity map.
      defPixels: (definition !== null && Array.isArray(definition.pixels))
        ? definition.pixels : null,
      defPixelsRefusal: definition === null ? null
        : (definition.pixelsRefusal
          || (Array.isArray(definition.pixels) ? null : 'the registry entry carries no ' +
            'per-pixel channel maps')),
      defFile: definition === null ? null : (definition.file || null),
    },
  };
}

/**
 * How many PIXELS a resolved destination has, for the purpose of "can this slot
 * be reversed at all". DMX counts the definition's pixels; an LED destination
 * counts its patched pixels. `null` = unprovable (see `reverseRefusal`).
 */
function destPixelCount(dest) {
  if (dest.kind === 'dmx') return dest.defPixels === null ? null : dest.defPixels.length;
  return Number.isInteger(dest.pixelCount) ? dest.pixelCount : null;
}

/**
 * May this destination be armed REVERSED? Returns `{applicable, why}` — `why`
 * is the sentence a refusal quotes, present whenever `applicable` is false.
 *
 * Single-pixel destinations (every par) are NOT quietly treated as identity:
 * asking to reverse a 1-pixel fixture means the operator believes something
 * about that fixture that is not true, and ignoring it would hide the mistake.
 */
function reverseApplicability(dest) {
  if (dest.kind === 'dmx' && dest.defPixels === null) {
    return { applicable: false, unprovable: true,
      why: `the fixture definition for '${dest.fixtureType}' (${dest.defFile || 'unknown file'}) ` +
        `cannot be proven permutable — ${dest.defPixelsRefusal || 'its per-pixel channel maps ' +
        'did not validate'}. Reversing it would be guesswork about which bytes belong to which ` +
        'pixel, so the bridge refuses instead.' };
  }
  const n = destPixelCount(dest);
  if (n === null) {
    return { applicable: false, unprovable: true,
      why: `'${dest.name}' does not declare how many pixels it has, so a per-pixel reversal ` +
        'cannot be computed' };
  }
  if (n < 2) {
    return { applicable: false, unprovable: false,
      why: `'${dest.name}' is a ${n}-pixel fixture — reversing its pixel order is meaningless. ` +
        'Refusing rather than ignoring it: a reverse flag on a par means something else is wrong.' };
  }
  return { applicable: true, unprovable: false, why: '' };
}

/** Every fixture name a scene patches — the candidate pool before filtering. */
function sceneFixtureNames(patches) {
  return Object.keys((patches && patches.patches) || {});
}

/**
 * Is `src` an acceptable source for bench slot `dest`? Returns the failing rule
 * by name so the refusal can quote it (R-15).
 *
 * @returns {{ok:true, warnings:string[]}|{ok:false, rule:string, why:string}}
 */
function checkCompatible(dest, src) {
  const warnings = [];
  if (dest.kind !== src.kind) {
    return { ok: false, rule: 'kind',
      why: `the bench slot is a ${dest.kind} and '${src.name}' is a ${src.kind}` };
  }
  if (dest.kind === 'dmx' || dest.kind === 'led_fixture') {
    if (dest.fixtureType !== src.fixtureType) {
      return { ok: false, rule: 'fixtureType',
        why: `the bench fixture is a ${dest.fixtureType} (${dest.footprintCh} ch) and ` +
          `'${src.name}' is a ${src.fixtureType} (${src.footprintCh} ch) — profiles must be ` +
          'identical; the bridge does not translate channel maps' };
    }
  }
  if (dest.kind === 'led_strand' || dest.kind === 'led_fixture') {
    if (!sameFormat(dest.pixelFormat, src.pixelFormat)) {
      const fmt = (f) => f ? `${f.order}/stride ${f.stride}/${f.whiteMode}` : 'none';
      return { ok: false, rule: 'pixelFormat',
        why: `the bench strand is ${fmt(dest.pixelFormat)} and '${src.name}' is ` +
          `${fmt(src.pixelFormat)} — pixel bytes are only copied between identical formats` };
    }
    if (dest.kind === 'led_fixture' && src.pixelCount !== dest.pixelCount) {
      return { ok: false, rule: 'pixelCount',
        why: `a typed LED fixture is a SHAPE: '${src.name}' has ${src.pixelCount} px and the ` +
          `bench fixture has ${dest.pixelCount} — a prefix of a sign is scrambled content, not ` +
          'a smaller sign' };
    }
    if (dest.kind === 'led_strand') {
      if (src.pixelCount < dest.pixelCount) {
        return { ok: false, rule: 'pixelCount',
          why: `'${src.name}' has ${src.pixelCount} px and the bench strand needs ` +
            `${dest.pixelCount} — a source cannot be shorter than its destination` };
      }
      if (src.pixelCount > dest.pixelCount) {
        warnings.push(`showing the first ${dest.pixelCount} of '${src.name}'s ` +
          `${src.pixelCount} px`);
      }
    }
    const dw = JSON.stringify((dest.pixelFormat && dest.pixelFormat.wire) || null);
    const sw = JSON.stringify((src.pixelFormat && src.pixelFormat.wire) || null);
    if (dw !== sw) {
      warnings.push(`'${src.name}' and the bench strand declare different led.wire settings ` +
        '(gamma / amber folding). Those are DEVICE-side colour fidelity, not byte semantics — ' +
        'the mirrored bytes are identical either way, but the two boxes may not look identical');
    }
  }
  return { ok: true, warnings };
}

/**
 * The per-channel source map of a REVERSED DMX destination: `map[c]` is the
 * source channel (both 1-based within the footprint) whose byte belongs in
 * destination channel `c`.
 *
 * DEFINITION-DRIVEN. Destination pixel `p`'s role `r` is fed by source pixel
 * `N-1-p`'s SAME role `r`, so:
 *   - a pixel's channels move as a unit and by role — w↔a, r↔g and every other
 *     intra-pixel swap is structurally impossible;
 *   - non-contiguous per-pixel lanes (Vintage: `value` at 3..8, `rgb` at
 *     16..33) permute correctly without anyone writing an offset;
 *   - a channel NO pixel claims (Vintage 1,2,9-15; Shehds 1-11) is identity-
 *     copied, so master dimmer stays master dimmer. This is the F-7 finding of
 *     the design audit: a footprint-wide byte reversal would put pixel data in
 *     those channels.
 */
function reversedDmxChannelMap(dest) {
  const pixels = dest.defPixels;
  const n = pixels.length;
  const map = new Array(dest.footprintCh + 1);
  for (let c = 1; c <= dest.footprintCh; c += 1) map[c] = c;   // controls: identity
  for (let p = 0; p < n; p += 1) {
    const from = pixels[n - 1 - p].channels;
    for (const role of Object.keys(pixels[p].channels)) {
      map[pixels[p].channels[role]] = from[role];
    }
  }
  return map;
}

/**
 * Compute the slices that copy `src` onto `dest`, merged into the longest
 * contiguous runs (fewest slices, identical bytes).
 *
 * @param {Object} dest resolved bench fixture
 * @param {Object} src  resolved source fixture
 * @param {{reverse?:boolean}} [opts] `reverse: true` = destination pixel block k
 *        is fed from source pixel block N-1-k. The caller has already PROVEN
 *        the destination is reversible (`reverseApplicability`); this function
 *        does not re-decide it.
 */
function computeSlices(dest, src, opts) {
  const reverse = !!(opts && opts.reverse);
  if (dest.kind === 'dmx') {
    if (!reverse) {
      return [{
        sourceUniverse: src.universe,
        sourceAddr: src.addr,
        length: dest.footprintCh,
        destAddr: dest.addr,
        note: `${src.name} (${src.fixtureType}, ${dest.footprintCh} ch)`,
      }];
    }
    // REVERSED: one run per maximal stretch that is contiguous on BOTH sides.
    // Total coverage is still exactly the footprint and the runs are disjoint by
    // construction, so `validateMirrorTree`'s one-source-per-channel invariant
    // holds without a special case.
    const map = reversedDmxChannelMap(dest);
    const note = `${src.name} (${src.fixtureType}, ${dest.footprintCh} ch, REVERSED ` +
      `${dest.defPixels.length} px)`;
    const slices = [];
    let run = null;
    for (let c = 1; c <= dest.footprintCh; c += 1) {
      const sourceAddr = src.addr + map[c] - 1;
      const destAddr = dest.addr + c - 1;
      if (run !== null && run.sourceAddr + run.length === sourceAddr
          && run.destAddr + run.length === destAddr) {
        run.length += 1;
        continue;
      }
      if (run !== null) slices.push(run);
      run = { sourceUniverse: src.universe, sourceAddr, destAddr, length: 1, note };
    }
    if (run !== null) slices.push(run);
    return slices;
  }
  // LED: walk pixel space so a multi-universe strand on either side is handled
  // by construction rather than by an assumption about contiguity.
  const stride = dest.pixelFormat.stride;
  const dstPx = pixelLocations(dest.patch, stride);
  // FIRST-N WINDOW, *THEN* REVERSE — never a silent switch to the last N. A
  // 40 px rope feeding a 20 px bench strand still shows rope pixels 1-20; the
  // reverse flag decides which END of that window lands on bench pixel 1, and
  // nothing else. Whole stride blocks move intact, so in-pixel byte order (and
  // therefore w/a) is untouched.
  const window = pixelLocations(src.patch, src.pixelFormat.stride).slice(0, dstPx.length);
  if (reverse) window.reverse();
  const srcPx = window;
  const slices = [];
  let run = null;
  for (let i = 0; i < dstPx.length; i += 1) {
    const s = srcPx[i];
    const d = dstPx[i];
    const contiguous = run !== null
      && run.sourceUniverse === s.universe
      && run.destUniverse === d.universe
      && run.sourceAddr + run.length === s.channel
      && run.destAddr + run.length === d.channel;
    if (contiguous) {
      run.length += stride;
      continue;
    }
    if (run !== null) slices.push(run);
    run = {
      sourceUniverse: s.universe,
      sourceAddr: s.channel,
      destUniverse: d.universe,
      destAddr: d.channel,
      length: stride,
      note: `${src.name} px 1-${dstPx.length} (${dest.pixelFormat.order} × ${stride}` +
        `${reverse ? ', REVERSED' : ''})`,
    };
  }
  if (run !== null) slices.push(run);
  return slices;
}

/**
 * Resolve a v3 sidecar + a selection into the internal mirror spec.
 *
 * @param {Object} args
 * @param {Object} args.spec              parsed v3 sidecar
 * @param {string} args.benchSceneName
 * @param {{controllers:Object, patches:Object, sceneConfig:Object}} args.benchScene
 * @param {string} args.sourceSceneName   the ENGINE's active scene
 * @param {{controllers:Object, patches:Object, sceneConfig:Object}} args.sourceScene
 * @param {Map<string,{footprint:number}>} args.registry fixtureType → definition
 * @param {Object|null} args.selection    `{ slotId: {source: string|null, reverse: boolean} }`,
 *        or null = the sidecar defaults with every slot NORMAL. The pre-`_176`
 *        flat shape (`{ slotId: sourceName|null }`) is REFUSED by name (R-24);
 *        there is deliberately no dual-shape parser, because accepting both
 *        would mean silently reading an absent `reverse` as `false` on a wire
 *        message that never mentioned pixel order.
 * @returns {{ok:boolean, refusal:(string|null), warnings:string[],
 *            slots:Array<Object>, spec:(Object|null)}}
 */
function resolveBenchMirror({ spec, benchSceneName, benchScene, sourceSceneName, sourceScene,
  registry, selection }) {
  const out = { ok: false, refusal: null, warnings: [], slots: [], spec: null };
  const refuse = (id, message) => ({ ...out, refusal: `ARM refused [${id}]: ${message}` });

  const benchTypes = indexFixtureTypes(benchScene.sceneConfig);
  const benchByIp = indexControllers(benchScene.controllers);
  const srcTypes = indexFixtureTypes(sourceScene.sceneConfig);
  const srcByIp = indexControllers(sourceScene.controllers);

  // ── 1. Resolve every bench slot from the bench scene ──────────────────────
  const slots = [];
  for (const declared of spec.slots) {
    const r = resolveFixture({
      name: declared.benchFixture,
      patches: benchScene.patches,
      byIp: benchByIp,
      fixtureTypes: benchTypes.types,
      ambiguous: benchTypes.ambiguous,
      registry,
    });
    if (!r.ok) {
      const id = benchTypes.ambiguous.has(declared.benchFixture)
        ? R.AMBIGUOUS_IDENTITY : R.SLOT_UNRESOLVABLE;
      return refuse(id, `slot '${declared.slot}' ('${declared.benchFixture}') cannot be ` +
        `resolved from the '${benchSceneName}' scene — ${r.why}. The mirror maps only what the ` +
        'scene proves.');
    }
    slots.push({ declared, dest: r.resolved, candidates: [], chosen: null, reverse: false,
      reverseApplicable: reverseApplicability(r.resolved).applicable, warnings: [] });
  }

  // ── 2. Build the candidate pool per slot from the SOURCE scene ────────────
  const sourceResolved = new Map();     // name → resolved | null (unresolvable)
  for (const name of sceneFixtureNames(sourceScene.patches)) {
    const r = resolveFixture({
      name,
      patches: sourceScene.patches,
      byIp: srcByIp,
      fixtureTypes: srcTypes.types,
      ambiguous: srcTypes.ambiguous,
      registry,
    });
    sourceResolved.set(name, r.ok ? r.resolved : null);
  }
  for (const slot of slots) {
    for (const [name, src] of sourceResolved) {
      if (src === null) continue;
      const compat = checkCompatible(slot.dest, src);
      if (!compat.ok) continue;
      slot.candidates.push({
        name,
        universe: src.universe,
        addr: src.addr,
        pixelCount: src.pixelCount,
        note: compat.warnings.join('; '),
      });
    }
    slot.candidates.sort((a, b) => a.name.localeCompare(b.name));
  }

  // R-22b — the engine's scene offers nothing this bench can show.
  if (slots.every(s => s.candidates.length === 0)) {
    const profiles = [...new Set(slots.map(s => s.dest.fixtureType || s.dest.kind))].join(', ');
    return refuse(R.NO_CANDIDATES, `the engine's scene '${sourceSceneName}' has no fixture ` +
      `compatible with ANY bench slot (bench profiles: ${profiles}). Put the engine on a scene ` +
      'that carries the same fixture profiles, or arm a different stand-in.');
  }

  // ── 3. Apply the selection ────────────────────────────────────────────────
  const byId = new Map(slots.map(s => [s.declared.slot, s]));
  if (selection === null || selection === undefined) {
    for (const slot of slots) {
      const want = slot.declared.defaultSource;
      if (want === null) { slot.chosen = null; continue; }
      const hit = slot.candidates.find(c => c.name === want);
      if (!hit) {
        // R-22c — auto-substituting `none` would be a silent fallback.
        const src = sourceResolved.get(want);
        const why = (src === undefined || src === null)
          ? `the '${sourceSceneName}' scene does not patch it`
          : checkCompatible(slot.dest, src).why;
        return refuse(R.DEFAULT_UNRESOLVABLE, `slot '${slot.declared.slot}' defaults to ` +
          `'${want}', which cannot feed it from the engine's scene '${sourceSceneName}' — ` +
          `${why}. Open the picker and choose explicitly; the bridge will not substitute 'none' ` +
          'for you.');
      }
      slot.chosen = want;
      slot.warnings = checkCompatible(slot.dest, sourceResolved.get(want)).warnings;
    }
  } else {
    for (const id of Object.keys(selection)) {
      if (!byId.has(id)) {
        return refuse(R.UNKNOWN_SLOT, `the selection names slot '${id}' but ` +
          `${benchSceneName}/bench_mirror.yaml declares no such slot. Declared: ` +
          `${slots.map(s => s.declared.slot).join(', ')}.`);
      }
    }
    const missing = slots.filter(s => !(s.declared.slot in selection)).map(s => s.declared.slot);
    if (missing.length > 0) {
      return refuse(R.INCOMPLETE_SELECTION, `the selection is missing slot(s) ` +
        `${missing.join(', ')}. A selection covers every slot explicitly — 'none' is a choice, ` +
        'absence is not.');
    }
    for (const slot of slots) {
      const id = slot.declared.slot;
      const entry = selection[id];

      // ── R-24: the shape, checked BEFORE anything is read out of it ─────────
      // The pre-`_176` wire shape put a bare name (or null) here. Accepting it
      // would mean inventing `reverse: false` for a message that never spoke
      // about pixel order — a fallback, and the one whose failure mode is a
      // physical fixture quietly running the wrong way round.
      if (entry === null || typeof entry === 'string') {
        return refuse(R.SELECTION_SHAPE, `slot '${id}' carries the OLD selection shape ` +
          `(${JSON.stringify(entry)}). Since report 20260806_174 a selection entry is ` +
          `${SELECTION_SHAPE_TEXT}. Send the new shape; the bridge does not accept both, ` +
          'because an absent `reverse` would have to be guessed.');
      }
      if (typeof entry !== 'object' || Array.isArray(entry)) {
        return refuse(R.SELECTION_SHAPE, `slot '${id}' carries ${JSON.stringify(entry)}, which ` +
          `is not a selection entry. Expected ${SELECTION_SHAPE_TEXT}.`);
      }
      for (const key of Object.keys(entry)) {
        if (key !== 'source' && key !== 'reverse') {
          return refuse(R.SELECTION_SHAPE, `slot '${id}' carries unknown key '${key}' — a ` +
            `selection entry is exactly ${SELECTION_SHAPE_TEXT}.`);
        }
      }
      if (typeof entry.reverse !== 'boolean') {
        return refuse(R.SELECTION_SHAPE, `slot '${id}' has reverse=` +
          `${JSON.stringify(entry.reverse)}, which is not a boolean. Pixel order is a two-state ` +
          'physical fact; a truthy value would decide it by accident.');
      }
      const want = entry.source === undefined ? null : entry.source;
      if (want !== null && typeof want !== 'string') {
        return refuse(R.UNKNOWN_SOURCE, `slot '${id}' names ` +
          `${JSON.stringify(want)}, which is not a fixture name or null.`);
      }

      // ── R-25 / R-26: may this destination be reversed AT ALL? ──────────────
      // Checked even when the slot is held dark, so "reverse a par" is refused
      // by name rather than silently disappearing with the `none`.
      if (entry.reverse === true) {
        const verdict = reverseApplicability(slot.dest);
        if (!verdict.applicable) {
          return refuse(verdict.unprovable ? R.REVERSE_UNPROVABLE : R.REVERSE_NOT_APPLICABLE,
            `slot '${id}' ('${slot.dest.name}') was armed REVERSED, but ${verdict.why}`);
        }
      }
      slot.reverse = entry.reverse;

      if (want === null) { slot.chosen = null; continue; }
      const src = sourceResolved.get(want);
      if (src === undefined || src === null) {
        return refuse(R.UNKNOWN_SOURCE, `slot '${id}' names '${want}', which ` +
          `the '${sourceSceneName}' scene does not patch as a usable fixture.`);
      }
      const compat = checkCompatible(slot.dest, src);
      if (!compat.ok) {
        return refuse(R.INCOMPATIBLE, `slot '${id}' ` +
          `('${slot.dest.name}') cannot take '${want}' — ${compat.why} [rule: ${compat.rule}].`);
      }
      slot.chosen = want;
      slot.warnings = compat.warnings;
    }
  }

  // ── 4. Compute slices and materialize the internal spec ──────────────────
  const byDest = new Map();   // "universe→ip" → mirror entry
  const ensureDest = (universe, host) => {
    const key = `${universe}→${host}`;
    if (!byDest.has(key)) {
      byDest.set(key, { destUniverse: universe, destHost: host, note: '', slices: [] });
    }
    return byDest.get(key);
  };
  for (const slot of slots) {
    // A slot with no source is still OWNED and composed as zeros: releasing it
    // to the ordinary relay would resurrect the false positive where raw ship
    // bytes light bench hardware while the operator believes they are mirroring.
    const destUniverses = slot.dest.kind === 'dmx'
      ? [slot.dest.universe]
      : [...new Set(patchSegments(slot.dest.patch).map(s => s.universe))];
    for (const u of destUniverses) ensureDest(u, slot.dest.controller.ip);
    if (slot.chosen === null) continue;

    const src = sourceResolved.get(slot.chosen);
    for (const s of computeSlices(slot.dest, src, { reverse: slot.reverse })) {
      const destUniverse = s.destUniverse === undefined ? slot.dest.universe : s.destUniverse;
      ensureDest(destUniverse, slot.dest.controller.ip).slices.push({
        sourceUniverse: s.sourceUniverse,
        sourceAddr: s.sourceAddr,
        length: s.length,
        destAddr: s.destAddr,
        note: s.note,
      });
    }
    for (const w of slot.warnings) {
      out.warnings.push(`slot '${slot.declared.slot}': ${w}`);
    }
  }

  const mirrors = [...byDest.values()]
    .sort((a, b) => (a.destHost.localeCompare(b.destHost) || a.destUniverse - b.destUniverse));
  try {
    validateMirrorTree(mirrors, `${benchSceneName}/computed`);
  } catch (e) {
    // R-19 — an internal-shaped failure is still a refusal, never a warning.
    return refuse(R.COMPUTED_INVALID, `the computed mapping violates a structural invariant — ` +
      `${e.message}. This indicates overlapping bench patches or a resolver defect; nothing was ` +
      'armed.');
  }

  // Fan-out (one source feeding two slots) is legal and useful — badge it, do
  // not warn about it (dest pairs stay disjoint, so the one-writer law holds).
  const chosenCounts = new Map();
  for (const slot of slots) {
    if (slot.chosen === null) continue;
    chosenCounts.set(slot.chosen, (chosenCounts.get(slot.chosen) || 0) + 1);
  }

  out.ok = true;
  out.slots = slots.map(s => ({
    slot: s.declared.slot,
    benchFixture: s.dest.name,
    kind: s.dest.kind,
    fixtureType: s.dest.fixtureType,
    footprintCh: s.dest.footprintCh,
    pixelCount: s.dest.pixelCount,
    dest: {
      controller: s.dest.controller.name,
      ip: s.dest.controller.ip,
      universe: s.dest.universe,
      addr: s.dest.addr,
    },
    defaultSource: s.declared.defaultSource,
    candidates: s.candidates,
    source: s.chosen,
    // The two facts the picker, the arm log and the armed status all report.
    // `reverseApplicable` is destination-only (pixel count > 1 and a permutable
    // definition), so a par row can never even offer the control.
    reverse: s.reverse,
    reverseApplicable: s.reverseApplicable,
    fanout: s.chosen === null ? 1 : chosenCounts.get(s.chosen),
    summary: s.chosen === null
      ? `HELD DARK — composed as zeros${s.reverse ? ' (REVERSED, but nothing to reverse)' : ''}`
      : summarizeSlot(s, sourceResolved.get(s.chosen)),
  }));
  out.spec = {
    version: spec.version,
    enabled: spec.enabled,
    label: spec.label,
    note: spec.note,
    scene: benchSceneName,
    sourceScene: sourceSceneName,
    mirrors,
  };
  return out;
}

/**
 * The one-line "U6/1 → U2/1 (UkingPar, 10 ch)" the picker and arm log show.
 * A reversed slot says so IN WORDS — an armed banner that cannot tell the
 * operator which way round a fixture is running is not actionable.
 */
function summarizeSlot(slot, src) {
  const d = slot.dest;
  const order = slot.reverse ? ' · REVERSED' : '';
  if (d.kind === 'dmx') {
    return `U${src.universe}/${src.addr} → U${d.universe}/${d.addr} ` +
      `(${d.fixtureType}, ${d.footprintCh} ch)${order}`;
  }
  const prefix = src.pixelCount > d.pixelCount
    ? `first ${d.pixelCount} of ${src.pixelCount} px` : `${d.pixelCount} px`;
  return `U${src.universe}/${src.addr} → U${d.universe}/${d.addr} ` +
    `(${d.pixelFormat.order} × ${d.pixelFormat.stride}, ${prefix})${order}`;
}

// ── The ONE impure helper, kept here so there is ONE implementation ─────────
//
// `loadFixtureRegistry` is the only function in this file that touches the
// filesystem. It lives here rather than in the bridge because the resolver's
// central claim — "both ends resolve through the same fixture definition" — is
// only true if there is exactly one reader of that directory; a second copy in
// the tests could drift from the one the bridge uses and prove nothing.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Validate a model file's per-pixel channel maps into the `pixels` array a
 * REVERSED DMX slot is permuted with.
 *
 * Three rules, all of which a reversal silently depends on:
 *   1. every pixel declares the SAME role set — otherwise `pixels[N-1-p]` has no
 *      channel to supply some role and the destination would keep a stale byte;
 *   2. every channel is within 1..footprint — a map that walks outside the
 *      fixture would read another fixture's bytes;
 *   3. no channel is claimed by two pixels — the permutation must be a bijection
 *      on the claimed set, or two sources would write one destination channel.
 *
 * @returns {{pixels:Array|null, why:(string|null)}} `pixels: null` = not
 *          provably permutable; `why` names what failed. A definition that fails
 *          is NOT fatal to the registry: it only makes REVERSE refuse for that
 *          one type (design 20260806_174 §3.5), leaving every NORMAL path — and
 *          every other type — untouched.
 */
function validateDefinitionPixels(model, footprint, file) {
  const raw = model.pixels;
  if (raw === undefined || raw === null) {
    return { pixels: null, why: 'the model declares no `pixels:` list' };
  }
  if (!Array.isArray(raw)) {
    return { pixels: null, why: '`model.pixels` is not a list' };
  }
  const pixels = [];
  const claimed = new Map();   // channel → pixel index
  let roleSet = null;
  for (let i = 0; i < raw.length; i += 1) {
    const p = raw[i];
    const where = `pixels[${i}]${p && typeof p.id === 'string' ? ` ('${p.id}')` : ''}`;
    if (!p || typeof p !== 'object' || !p.channels || typeof p.channels !== 'object') {
      return { pixels: null, why: `${where} declares no \`channels:\` mapping` };
    }
    const roles = Object.keys(p.channels).sort();
    if (roleSet === null) roleSet = roles.join(',');
    else if (roles.join(',') !== roleSet) {
      return { pixels: null, why: `${where} declares roles [${roles.join(', ')}] but the first ` +
        `pixel declares [${roleSet.split(',').join(', ')}] — every pixel must carry the same ` +
        'role set for a reversal to be role-for-role' };
    }
    const channels = {};
    for (const role of roles) {
      const ch = Number(p.channels[role]);
      if (!Number.isInteger(ch) || ch < 1 || ch > footprint) {
        return { pixels: null, why: `${where} role '${role}' is channel ` +
          `${JSON.stringify(p.channels[role])}, which is outside 1..${footprint}` };
      }
      if (claimed.has(ch)) {
        return { pixels: null, why: `channel ${ch} is claimed by both ${where} and ` +
          `pixels[${claimed.get(ch)}] — one channel, one pixel` };
      }
      claimed.set(ch, i);
      channels[role] = ch;
    }
    pixels.push({ id: typeof p.id === 'string' ? p.id : `pixel_${i + 1}`, channels });
  }
  // An empty `pixels: []` (the fog machines) is VALID and simply not reversible:
  // there is nothing to permute, and `reverseApplicability` refuses on count.
  return { pixels, why: null, file };
}

/**
 * Read `simulation/dmx/fixtures/<family>/model_*.yaml` into
 * `fixtureType → { footprint, modelId, file, pixels, pixelsRefusal }`.
 *
 * FAIL LOUD: two model files declaring the same `fixture_type` with different
 * `channel_mode`s is an ambiguity that would silently decide a fixture's
 * footprint, so it throws rather than picking one.
 *
 * `pixels` is the per-pixel channel map a REVERSED slot permutes; a definition
 * that cannot be proven permutable gets `pixels: null` plus a named
 * `pixelsRefusal` and a boot warning, and REVERSE is refused for that type at
 * ARM. It is deliberately NOT a throw: a defect in one model file must not make
 * every NORMAL mirror in the rig un-armable.
 *
 * @param {string} fixturesDir absolute path to simulation/dmx/fixtures
 * @returns {Map<string,{footprint:number, modelId:string, file:string,
 *                       pixels:(Array|null), pixelsRefusal:(string|null)}>}
 */
function loadFixtureRegistry(fixturesDir) {
  const registry = new Map();
  for (const entry of fs.readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(fixturesDir, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (!/^model_.*\.ya?ml$/.test(file)) continue;
      const tree = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
      const model = tree && tree.model;
      if (!model || typeof model.fixture_type !== 'string') continue;
      const footprint = Number(model.channel_mode);
      if (!Number.isInteger(footprint) || footprint < 1) {
        throw new Error(`[BenchMirror] ${entry.name}/${file}: model.channel_mode must be a ` +
          `positive integer (got ${JSON.stringify(model.channel_mode)})`);
      }
      const prev = registry.get(model.fixture_type);
      if (prev && prev.footprint !== footprint) {
        throw new Error(`[BenchMirror] fixture type '${model.fixture_type}' is declared with ` +
          `${prev.footprint} channels in ${prev.file} and ${footprint} in ${entry.name}/${file} ` +
          '— one type, one channel map; the bridge will not pick');
      }
      const where = `${entry.name}/${file}`;
      const pixelCheck = validateDefinitionPixels(model, footprint, where);
      if (pixelCheck.pixels === null) {
        console.warn(`[BenchMirror] ⚠ ${where}: per-pixel channel maps do not validate — ` +
          `${pixelCheck.why}. '${model.fixture_type}' can still be mirrored NORMALLY; a ` +
          'REVERSED slot on this type will be REFUSED by name.');
      }
      registry.set(model.fixture_type, {
        footprint,
        modelId: typeof model.id === 'string' ? model.id : '',
        file: where,
        pixels: pixelCheck.pixels,
        pixelsRefusal: pixelCheck.why,
      });
    }
  }
  return registry;
}

module.exports = {
  resolveBenchMirror,
  loadFixtureRegistry,
  validateDefinitionPixels,
  indexFixtureTypes,
  indexControllers,
  resolveFixture,
  checkCompatible,
  computeSlices,
  reversedDmxChannelMap,
  reverseApplicability,
  destPixelCount,
  patchSegments,
  pixelLocations,
  DMX_CHANNELS,
  REFUSALS: R,
  SELECTION_SHAPE_TEXT,
};

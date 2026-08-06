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
 */
'use strict';

const { validateMirrorTree, DMX_CHANNELS } = require('./bench_mirror.cjs');
const { classifyRouteIp } = require('./bridge_routing.cjs');

/** Refusal ids match the catalog in report 20260805_155 §9 / §15.A7. */
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
};

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
  if (kind === 'dmx' || kind === 'led_fixture') {
    if (!registry.has(fixtureType)) {
      return { ok: false, why: `no fixture definition for '${fixtureType}' (fixture '${name}') — ` +
        'add its model_*.yaml under simulation/dmx/fixtures/' };
    }
    footprintCh = registry.get(fixtureType).footprint;
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
    },
  };
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
 * Compute the slices that copy `src` onto `dest`, merged into the longest
 * contiguous runs (fewest slices, identical bytes).
 */
function computeSlices(dest, src) {
  if (dest.kind === 'dmx') {
    return [{
      sourceUniverse: src.universe,
      sourceAddr: src.addr,
      length: dest.footprintCh,
      destAddr: dest.addr,
      note: `${src.name} (${src.fixtureType}, ${dest.footprintCh} ch)`,
    }];
  }
  // LED: walk pixel space so a multi-universe strand on either side is handled
  // by construction rather than by an assumption about contiguity.
  const stride = dest.pixelFormat.stride;
  const srcPx = pixelLocations(src.patch, src.pixelFormat.stride);
  const dstPx = pixelLocations(dest.patch, stride);
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
      note: `${src.name} px 1-${dstPx.length} (${dest.pixelFormat.order} × ${stride})`,
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
 * @param {Object|null} args.selection    { slotId: sourceName|null }, or null = defaults
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
    slots.push({ declared, dest: r.resolved, candidates: [], chosen: null, warnings: [] });
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
      const want = selection[slot.declared.slot];
      if (want === null || want === undefined) { slot.chosen = null; continue; }
      if (typeof want !== 'string') {
        return refuse(R.UNKNOWN_SOURCE, `slot '${slot.declared.slot}' names ` +
          `${JSON.stringify(want)}, which is not a fixture name or null.`);
      }
      const src = sourceResolved.get(want);
      if (src === undefined || src === null) {
        return refuse(R.UNKNOWN_SOURCE, `slot '${slot.declared.slot}' names '${want}', which ` +
          `the '${sourceSceneName}' scene does not patch as a usable fixture.`);
      }
      const compat = checkCompatible(slot.dest, src);
      if (!compat.ok) {
        return refuse(R.INCOMPATIBLE, `slot '${slot.declared.slot}' ` +
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
    for (const s of computeSlices(slot.dest, src)) {
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
    fanout: s.chosen === null ? 1 : chosenCounts.get(s.chosen),
    summary: s.chosen === null
      ? 'HELD DARK — composed as zeros'
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

/** The one-line "U6/1 → U2/1 (UkingPar, 10 ch)" the picker and arm log show. */
function summarizeSlot(slot, src) {
  const d = slot.dest;
  if (d.kind === 'dmx') {
    return `U${src.universe}/${src.addr} → U${d.universe}/${d.addr} ` +
      `(${d.fixtureType}, ${d.footprintCh} ch)`;
  }
  const prefix = src.pixelCount > d.pixelCount
    ? `first ${d.pixelCount} of ${src.pixelCount} px` : `${d.pixelCount} px`;
  return `U${src.universe}/${src.addr} → U${d.universe}/${d.addr} ` +
    `(${d.pixelFormat.order} × ${d.pixelFormat.stride}, ${prefix})`;
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
 * Read `simulation/dmx/fixtures/<family>/model_*.yaml` into
 * `fixtureType → { footprint, modelId, file }`.
 *
 * FAIL LOUD: two model files declaring the same `fixture_type` with different
 * `channel_mode`s is an ambiguity that would silently decide a fixture's
 * footprint, so it throws rather than picking one.
 *
 * @param {string} fixturesDir absolute path to simulation/dmx/fixtures
 * @returns {Map<string,{footprint:number, modelId:string, file:string}>}
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
      registry.set(model.fixture_type, {
        footprint,
        modelId: typeof model.id === 'string' ? model.id : '',
        file: `${entry.name}/${file}`,
      });
    }
  }
  return registry;
}

module.exports = {
  resolveBenchMirror,
  loadFixtureRegistry,
  indexFixtureTypes,
  indexControllers,
  resolveFixture,
  checkCompatible,
  computeSlices,
  patchSegments,
  pixelLocations,
  DMX_CHANNELS,
  REFUSALS: R,
};

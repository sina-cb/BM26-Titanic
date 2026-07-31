import * as THREE from "three";
import { params } from "../core/state.js";
import { getProfileDef } from "../core/profile_registry.js";
import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";
import { reconcileGroupBits, listPixelGroups, buildViewmasksSidecarJS } from "./view_registry.js";
import { computeLedProjection, LED_CHANNEL_ORDERS, MAX_UNIVERSE } from "./controller_registry.js";
import { computeLedStrandPatches, projectLedStrandPixels } from "./led/led_patch_projection.js";
import { groupKeyForStrand } from "./led/led_metadata.js";
import { ledDisplayGroup, scaleRgbForLedOutput } from "../core/group_lock.js";
import { saveHttpUrl } from "../core/save_endpoint.js";
import { fixtureModelScale } from "../fixtures/fixture_model_scale.js";

export function generatePixelMap() {
  const pixels = [];
  const specialEffects = [];
  if (window._isRebuildingFixtures) return { pixels, specialEffects };

  function standardizeChannels(ch) {
    if (!ch) return null;
    const std = {};
    if (ch.red !== undefined) std.r = ch.red;
    if (ch.green !== undefined) std.g = ch.green;
    if (ch.blue !== undefined) std.b = ch.blue;
    if (ch.white !== undefined) std.w = ch.white;
    if (ch.value !== undefined && std.w === undefined) std.w = ch.value;
    if (ch.amber !== undefined) std.a = ch.amber;
    if (ch.violet !== undefined) std.u = ch.violet;
    if (ch.purple !== undefined) std.u = ch.purple;
    if (ch.uv !== undefined) std.u = ch.uv;
    return Object.keys(std).length > 0 ? std : null;
  }


  // Par Lights & DMX Fixtures (Unified)
  const dmxList = (params.dmxFixtures && params.dmxFixtures.length > 0) ? params.dmxFixtures : params.parLights;
  if (dmxList) {
    // Skip pixel map generation entirely if fixtures are still being built
    const fixturesReady = window.parFixtures && window.parFixtures.length >= dmxList.length && !window._isRebuildingFixtures;
    if (!fixturesReady) {
      console.log(`[pixelblaze] Skipping pixel map: fixtures not ready (${window.parFixtures?.length || 0}/${dmxList.length}, rebuilding=${!!window._isRebuildingFixtures})`);
    }
    if (fixturesReady) dmxList.forEach((light, i) => {
      const fType = light.type || light.fixtureType || 'Generic';

      // Bind the runtime fixture by CONFIG IDENTITY, never by index
      // coincidence. The old `dmxSceneFixtures[i] || parFixtures[i]`
      // lookup silently fell through to a DIFFERENT array at the same
      // index whenever a slot was empty (failed build, mid-rebuild
      // residue) — the entry's apply() then painted the wrong fixture,
      // scrambling colors identically in pixelblaze AND sacn_in modes
      // (operator report 2026-06-12). Identity can't cross wires; a
      // miss is loud, and the index lookup remains only as a verified
      // fast path.
      let fixture = (window.dmxSceneFixtures && window.dmxSceneFixtures[i]) ||
        (window.parFixtures && window.parFixtures[i]) || null;
      if (!fixture || fixture.config !== light) {
        fixture = (window.dmxSceneFixtures || []).find(f => f && f.config === light) ||
          (window.parFixtures || []).find(f => f && f.config === light) || null;
        if (!fixture) {
          console.error(`[pixelblaze] No runtime fixture for config '${light.name || i}' ` +
            `(index ${i}) — its pixels are skipped this pass. A failed fixture build or ` +
            'stale rebuild state is desynced from the config list.');
        }
      }
      if (fixture && fixture.pixels && fixture.pixels.length > 0) {
        if (fixture.hitbox) fixture.hitbox.updateMatrixWorld(true);
        if (fixture.group) fixture.group.updateMatrixWorld(true);
        // The type's RENDER multiplier (fixture_model_scale.js — the one table
        // that says "draw fixture type X at N× its physical size"), read from
        // the same authority DmxFixtureRuntime uses to build px.renderPos, so
        // the exported drawn geometry below cannot drift from what is drawn.
        // A class that renders 1:1 carries no fixtureDef here and gets 1.
        const renderScale = fixtureModelScale(fixture.fixtureDef);
        fixture.pixels.forEach((px, j) => {
          // TWO positions, deliberately. `worldPos` is the PHYSICAL one (from
          // px.localPos) — it is what the engine model, the sACN patching and
          // the analytic light pool sample, and an exported model must describe
          // the real rig, never the exaggerated drawing of it. `renderWorld` is
          // the DRAWN one (localPos × renderScale — the same product
          // DmxFixtureRuntime stores as px.renderPos) and exists ONLY for the
          // sim's own scene-wide instanced-dot mesh, which is a render path.
          // They are equal at render scale 1.
          const worldPos = new THREE.Vector3();
          const renderWorld = new THREE.Vector3();
          if (fixture.group && px.localPos) {
            worldPos.copy(px.localPos).applyMatrix4(fixture.group.matrixWorld);
            renderWorld.copy(px.localPos).multiplyScalar(renderScale)
              .applyMatrix4(fixture.group.matrixWorld);
          } else {
            worldPos.set(light.x || 0, light.y || 0, light.z || 0);
            renderWorld.copy(worldPos);
          }
            let u = light.dmxUniverse;
            let addr = light.dmxAddress;
            const fp = fixture.fixtureDef ? (fixture.fixtureDef.footprint || fixture.fixtureDef.channelMode || fixture.fixtureDef.channel_mode || fixture.fixtureDef.totalChannels || 10) : 10;
            
            // Only create a valid patch if actually patched (no silent auto-assign)
            const patchObj = (u && u > 0 && addr && addr > 0) ? { universe: u, addr: addr, footprint: fp } : null;

            pixels.push({
              type: 'dmx',
              fixtureType: light.type || light.fixtureType || 'UkingPar',
              name: (light.name || `Fixture ${i + 1}`) + (px.model ? ` - ${px.model.id}` : ` (Ch ${j + 1})`),
              // Runtime-only grouping keys for the 2D Pixel Map: fixIndex is an
              // unambiguous per-fixture cluster key (fId is often 0), fixKey is
              // a stable persist key. NOT serialized into the engine model.
              fixIndex: i,
              fixKey: light.name || `Fixture ${i + 1}`,
              group: light.group || '',
              // Runtime-only LIVE handle on this pixel's fixture config (NOT in
              // the saveModelJS field list, so the engine model is unchanged).
              // It is the SAME object applyFixtureOutputOverrides reads as
              // `fixture.config`, which is what lets the last-layer DMX entry
              // gate (animate.js) resolve the group master by exactly the key
              // the universe-buffer gate uses — no `group`-string join, no
              // keying drift, and the per-fixture On/Off + Brightness comes
              // along for free (report 20260724_40).
              fixtureConfig: light,
              x: +(worldPos.x).toFixed(3),
              y: +(worldPos.y).toFixed(3),
              z: +(worldPos.z).toFixed(3),
              nx: 0, ny: 0, nz: 0,
              cId: light.controllerId || 0,
              sId: light.sectionId || 0,
              fId: light.fixtureId || 0,
              // localIndex: TRUE 0-based ordinal of this pixel WITHIN its own
              // fixture, straight from the loop index `j` over the fixture's
              // own pixel list (the exporter knows the real grouping; the
              // engine no longer has to re-derive it from (group,fId)). A
              // multi-pixel fixture (e.g. a bar) numbers its pixels 0..N-1 in
              // physical order, so a sweep keyed on localIndex runs ALONG the
              // bar. See marsin_engine/lib/pixel_local_index.js (consumer).
              localIndex: j,
              vMask: light.viewMask || 0,
              _prePatched: true,
              patch: patchObj,
              channels: standardizeChannels(px.model && px.model.channels ? px.model.channels : null),
              // Per-pixel size from fixture model definition (in mm). PHYSICAL,
              // like x/y/z above — it goes into the exported model.
              pixelSize: px.model && typeof px.model.size === 'number' ? px.model.size : 14,
              // ── Runtime-only DRAWN geometry (NOT in the saveModelJS field
              // list, so the engine model is byte-identical). The sim renders a
              // scene-wide instanced-dot mesh over EVERY pixel (animate.js);
              // that is a render path, so it must place and size its dots from
              // the DRAWN geometry, not from the physical x/y/z + pixelSize
              // above. Without these the dots ignored fixture_model_scale
              // entirely: a 2.5× Vintage LED drew its heads at pre-scale size,
              // clustered at pre-scale spacing inside a 2.5× housing — visible
              // only on fixtures whose dots are lit, i.e. the PATCHED ones.
              rx: +(renderWorld.x).toFixed(3),
              ry: +(renderWorld.y).toFixed(3),
              rz: +(renderWorld.z).toFixed(3),
              renderScale,
              // Bind the apply callback natively for the simulator
              apply: (r, g, b) => {
                if (!getProfileDef(params.lightingProfile).mappingEnabled) return;
                fixture.setPixelColorRGB(j, r, g, b);
              },
           });
        });
        


      } else if (fixture && fixture.light) {
        // Simple fixture
        const worldPos = new THREE.Vector3();
        if (fixture.group) {
           if (fixture.hitbox) fixture.hitbox.updateMatrixWorld(true);
           fixture.group.updateMatrixWorld(true);
           fixture.group.getWorldPosition(worldPos);
        } else {
           worldPos.set(light.x || 0, light.y || 0, light.z || 0);
        }
        const chFallback = fixture.fixtureDef ? fixture.fixtureDef.footprint : 3;

        let u = light.dmxUniverse;
        let addr = light.dmxAddress;
        const fp = fixture.fixtureDef ? (fixture.fixtureDef.channel_mode || fixture.fixtureDef.totalChannels || 10) : 10;
        
        const patchObj = (u && u > 0 && addr && addr > 0) ? {
            universe: u,
            addr: addr,
            footprint: fp
        } : null;

        pixels.push({
            type: 'dmx',
            fixtureType: light.type || light.fixtureType || 'Generic',
            name: light.name || `Fixture ${i + 1}`,
            // Runtime-only grouping keys for the 2D Pixel Map (see multi-pixel
            // push above). NOT serialized into the engine model.
            fixIndex: i,
            fixKey: light.name || `Fixture ${i + 1}`,
            group: light.group || '',
            // Runtime-only LIVE fixture-config handle for the last-layer DMX
            // output gate — see the multi-pixel push above.
            fixtureConfig: light,
            x: +(worldPos.x).toFixed(3),
            y: +(worldPos.y).toFixed(3),
            z: +(worldPos.z).toFixed(3),
            nx: 0, ny: 0, nz: 0,
            cId: light.controllerId || 0,
            sId: light.sectionId || 0,
            fId: light.fixtureId || 0,
            // Runtime-only DRAWN geometry (see the multi-pixel push above). This
            // branch's fixture has no pixel model — its single emitter sits at
            // the GROUP ORIGIN, and a uniform scale about that origin cannot
            // move it, so the drawn position IS the physical one. The size
            // multiplier still applies.
            rx: +(worldPos.x).toFixed(3),
            ry: +(worldPos.y).toFixed(3),
            rz: +(worldPos.z).toFixed(3),
            renderScale: fixtureModelScale(fixture.fixtureDef),
            // localIndex: a simple/single-pixel DMX fixture is its own fixture
            // with exactly one pixel, so its within-fixture ordinal is 0.
            localIndex: 0,
            vMask: light.viewMask || 0,
            _prePatched: true, // We polyfill dynamically, so they are practically patched
            patch: patchObj,
            channels: (fType.includes('Fog') || fType === 'ChauvetHaze4D' || fType.includes('Horn') || fType.includes('Fire')) ? null : (standardizeChannels(fixture.fixtureDef && fixture.fixtureDef.channels ? fixture.fixtureDef.channels : null) || chFallback),
            apply: (r, g, b) => {
               if (!getProfileDef(params.lightingProfile).mappingEnabled) return;
               if (fixture.setPixelColorRGB) {
                   fixture.setPixelColorRGB(0, r, g, b); // Emulate single-pixel structure
               }
            }
        });
      } else if (fType.includes('Fog') || fType === 'ChauvetHaze4D' || fType.includes('Horn') || fType.includes('Fire')) {
        // [GLOBAL EFFECTS EXPORT PIPELINE]
        // We export non-lighting global fixtures (Foggers, Hazers, Horns, Fire) into a separate specialEffects model.
        let u = light.dmxUniverse || 0;
        let addr = light.dmxAddress || 0;
        
        const isChauvet = fType === 'ChauvetHaze4D';
        const fp = fixture && fixture.fixtureDef ? (fixture.fixtureDef.footprint || fixture.fixtureDef.channelMode || fixture.fixtureDef.channel_mode || fixture.fixtureDef.totalChannels || (isChauvet ? 2 : 1)) : (isChauvet ? 2 : 1);
        
        let channelsObj = null;
        let controlGroup = 'none';
        let kind = 'other';
        if (isChauvet) {
            channelsObj = { fan: 1, haze: 2 };
            controlGroup = 'fogger';
            kind = 'haze';
        } else if (fType.includes('Fog')) {
            channelsObj = { fog: 1 };
            controlGroup = 'fogger';
            kind = 'fog';
        } else if (fType.includes('Horn')) {
            channelsObj = { horn: 1 };
            controlGroup = 'horn';
            kind = 'horn';
        } else if (fType.includes('Fire')) {
            channelsObj = { fire: 1 };
            controlGroup = 'fire';
            kind = 'fire';
        }

        specialEffects.push({
          id: (light.name || fType).toLowerCase().replace(/[^a-z0-9]/g, '_'),
          kind: kind,
          fixtureType: light.fixtureType || fType,
          name: light.name || fType,
          group: light.group || 'GlobalEffects',
          patch: (u && u > 0 && addr && addr > 0) ? {
             universe: u,
             addr: addr,
             footprint: fp
          } : null,
          channels: channelsObj,
          controlGroup: controlGroup
        });
      } else {
        const errorMsg = `[MarsinEngine Export] Warning: Unsupported or missing fixture definition! Par light at index ${i} (Type: ${light.fixtureType || 'Unknown'}) could not be resolved against supported fixtures. Skipping.`;
        if (window._missingFixtureWarnCount === undefined) window._missingFixtureWarnCount = 0;
        if (window._missingFixtureWarnCount < 20) {
          console.warn(errorMsg, { config: light, fixture: fixture });
          window._missingFixtureWarnCount++;
        }
      }
    });
  }

  // ── LED strands ───────────────────────────────────────────────────────
  // Strands are real model pixels (FIX_RAW_LED). Their patch/addressing
  // comes from the LED projection of the controller registry: every
  // strand bound to an LED controller gets a sequential per-pixel
  // {universe, addr, stride, order} patch on the shared sACN/E1.31
  // transport (report 20260618_6 §D.2). A strand NOT bound to any LED
  // controller emits a LOUD unpatched marker (patch:null + unpatched:true)
  // — never a silent skip (codex P0): the engine logs it and the sim
  // paints it as undriven.
  if (params.ledStrands) {
    const ledCounts = new Map();
    params.ledStrands.forEach((strand) => {
      if (strand && typeof strand.name === 'string' && strand.name.length > 0) {
        ledCounts.set(strand.name, strand.ledCount || 10);
      }
    });
    const registry = (typeof window !== 'undefined' && window.__controllerRegistry) || null;
    // Two projections of the SAME registry. `computeLedProjection` is the
    // sim's GENERIC per-port model (each port restarts at the controller's
    // base lane). `computeLedStrandPatches` is the DEVICE-linear model (one
    // contiguous cursor across the enabled outputs, skipping disabled ones) —
    // the firmware's real byte layout, and exactly what patches.yaml records.
    // A controller carrying a `device:` binding declares those firmware
    // semantics, so its strands MUST export the device-linear addresses or the
    // engine model would disagree with both the hardware and patches.yaml
    // (report 20260710_1; docs/41 §3). NON-bound controllers have no hardware
    // to agree with, so they keep the generic per-port projection unchanged.
    const genericProj = registry
      ? computeLedProjection(registry, ledCounts)
      : { fields: new Map(), violations: [] };
    const deviceProj = registry
      ? computeLedStrandPatches(registry, ledCounts)
      : { fields: new Map(), violations: [] };
    for (const v of genericProj.violations) console.warn(`[LED Patch] ✋ ${v.message}`);
    for (const v of deviceProj.violations) console.warn(`[LED Patch/device] ✋ ${v.message}`);

    // Merge: the generic per-strand projection is the base; every DEVICE-bound
    // strand OVERRIDES its universe/addr with the firmware's contiguous start.
    // Order, stride and whiteMode are firmware semantics read from the SAME
    // `controller.led`, so they carry over from the generic entry unchanged —
    // only the address differs. A device-linear strand with no generic lane is
    // impossible (both projections walk the same ports/chains); if it ever
    // happens the registry is internally inconsistent — fail LOUD (codex P0),
    // never guess an address.
    const ledFields = new Map(genericProj.fields);
    for (const [name, dev] of deviceProj.fields) {
      const gen = genericProj.fields.get(name);
      if (!gen) {
        throw new Error(`[pixelblaze] LED strand '${name}' has a device-linear patch but no ` +
          'generic projection lane — the controller registry is internally inconsistent (a ' +
          'device-bound strand must also resolve in computeLedProjection). Refusing to export ' +
          'a guessed address.');
      }
      ledFields.set(name, {
        ...gen,
        universe: dev.dmxUniverse,
        addr: dev.dmxAddress,
        deviceLinear: true,
      });
    }

    // Strands continue the DMX cluster-index space so every strand becomes its
    // OWN 2D-Pixel-Map cluster (fixIndex is the cluster key). DMX fixtures used
    // 0..dmxList.length-1, so the first strand starts at dmxList.length — no
    // collision. fixIndex/fixKey are runtime-only grouping keys (like the DMX
    // pixels above): NOT serialized by saveModelJS, so the engine model stays
    // byte-identical. Without them buildClusters (fixIndex-contiguity) collapsed
    // ALL strands into one mega-cluster (report 20260724_9 §1.3).
    const dmxIndexBase = dmxList ? dmxList.length : 0;
    params.ledStrands.forEach((strand, i) => {
      const fixture = window.ledStrandFixtures && window.ledStrandFixtures[i] ? window.ledStrandFixtures[i] : null;
      const count = strand.ledCount || 10;
      const sx = +(strand.startX || 0), sy = +(strand.startY || 0), sz = +(strand.startZ || 0);
      const ex = +(strand.endX || 0), ey = +(strand.endY || 0), ez = +(strand.endZ || 0);
      const proj = ledFields.get(strand.name);
      const orderMap = proj ? (LED_CHANNEL_ORDERS[proj.order] || LED_CHANNEL_ORDERS.RGBW) : null;
      // The strand's DISPLAY group — the SINGLE key the GUI group master + Master
      // Enabled write under and the exporter's paint scale reads. Distinct from
      // `groupKeyForStrand` below (which keys an UNGROUPED strand by its NAME for
      // section/view numbering); the master keys ungrouped strands by the shared
      // 'Ungrouped' bucket. Carried on every LED pixel as `displayGroup` so the
      // last-layer output gate (animate.js) resolves the master by the SAME key
      // the bulb-mesh apply closure uses — never by the name-based `group` field.
      const dispGroup = ledDisplayGroup(strand);
      // EVERY patched strand — device-bound AND generic (unbound) — places its
      // per-pixel {universe, addr} through the SAME contiguous walker
      // (projectLedStrandPixels), the ONE source of truth for the firmware's
      // whole-pixel-spill / 128-px-per-universe / no-straddle byte layout. A
      // device-bound strand starts at the firmware's contiguous cursor
      // (proj.universe/addr set in the merge above); an unbound strand starts at
      // its generic per-port lane — but from that start the wrap math is
      // identical, so the exported model is byte-for-byte identical to
      // patches.yaml and the walker. This closes G3: the old unbound path used a
      // dense-byte formula (uniSpan = floor(startByte/512)) that ignored the tail
      // bytes skipped at each no-straddle wrap, diverging from the walker whenever
      // (startAddr − 1) % stride ≠ 0 (e.g. stride 4, startAddr 3: pixel 128 at
      // U+1 ch5 per the walker vs ch3 per the old formula).
      let ledPixels = null;
      if (proj) {
        const walk = projectLedStrandPixels(proj.universe, proj.addr, proj.stride, count);
        // codex P0 — an unbound strand past the sACN ceiling must NOT export a
        // silently truncated model. Fail loud (the device-bound path shares this
        // walker, so both are protected).
        if (walk.overflow) {
          throw new Error(`[pixelblaze] LED strand '${strand.name || `#${i + 1}`}' spills past the ` +
            `sACN universe ceiling ${MAX_UNIVERSE} (stride ${proj.stride} × ${count} px from ` +
            `U${proj.universe} ch${proj.addr}) — refusing to export a truncated model.`);
        }
        ledPixels = walk.pixels;
      }
      if (!proj) {
        console.warn(`[LED Patch] Strand '${strand.name || `#${i + 1}`}' is not bound to an LED ` +
          'controller — it exports UNPATCHED (no sACN output). Bind it in the Controller Mapping ' +
          'panel (an LED-type controller) to light it on hardware.');
      }
      for (let j = 0; j < count; j++) {
        const t = count > 1 ? j / (count - 1) : 0.5;
        // Per-pixel LED patch: each pixel occupies `stride` bytes starting
        // `j*stride` past the strand's start address, wrapping universes at
        // 512 (a pixel never straddles a universe boundary).
        let pxPatch = null;
        let pxChannels = null;
        if (proj) {
          // Device-bound AND unbound both read the same walker placement — the
          // no-straddle contiguous layout, ONE source of truth.
          const dp = ledPixels[j];
          pxPatch = { universe: dp.universe, addr: dp.addr, footprint: proj.stride, led: true };
          pxChannels = { ...orderMap };
        }
        // The pushed pixel object — captured so the strand `apply` can read
        // its own raw RGBWAU (animate.js writes entry.w/a/u before apply)
        // and mix to RGB with the firmware toRGBFallback weights, so a
        // pattern calling rgbwau(...,w,...) lights the strand white in the
        // sim exactly as the WS2812-RGBW hardware would.
        const px = {
          type: 'led',
          fixtureType: '',
          // Runtime-only 2D-Pixel-Map cluster keys (NOT serialized — see
          // saveModelJS field list). fixIndex makes each strand its own cluster;
          // fixKey is the stable per-strand persist/placement key.
          fixIndex: dmxIndexBase + i,
          fixKey: strand.name || `Strand ${i + 1}`,
          name: strand.name || 'Strand',
          // Effective group key — the SINGLE source of truth shared with the
          // section-numbering pass (led_metadata.assignLedStrandMetadata), so a
          // named group and its section id can never disagree. Ungrouped
          // strands key off their name (unchanged bit-for-bit for old scenes).
          group: groupKeyForStrand(strand),
          // Runtime-only display-group key (NOT serialized — see saveModelJS
          // field list) for the last-layer LED output gate; keeps ungrouped
          // strands under the shared 'Ungrouped' master bucket.
          displayGroup: dispGroup,
          x: +(sx + (ex - sx) * t).toFixed(3),
          y: +(sy + (ey - sy) * t).toFixed(3),
          z: +(sz + (ez - sz) * t).toFixed(3),
          // Runtime-only DRAWN geometry (see the DMX push above). A strand's
          // pixels are laid out directly on its start→end line — led_strand.js
          // draws them at exactly these coordinates — and no strand carries a
          // fixture type, so there is no render multiplier: drawn === physical.
          rx: +(sx + (ex - sx) * t).toFixed(3),
          ry: +(sy + (ey - sy) * t).toFixed(3),
          rz: +(sz + (ez - sz) * t).toFixed(3),
          renderScale: 1,
          nx: 0, ny: 0, nz: 0,
          cId: (proj ? proj.controllerId : strand.controllerId) || 0,
          sId: strand.sectionId || 0,
          fId: strand.fixtureId || 0,
          // localIndex: TRUE 0-based ordinal of this pixel WITHIN its own
          // strand — the loop index `j` over the strand's own LED count. A
          // strand IS one fixture (FIX_RAW_LED), so a sweep keyed on
          // localIndex runs ALONG the strand in true pixel order. The engine
          // consumes this directly instead of re-deriving from (group,fId).
          localIndex: j,
          vMask: strand.viewMask || 0,
          patch: pxPatch,
          channels: pxChannels,
          whiteMode: proj ? proj.whiteMode : 'native',
          // Scene-level LED colour-encode override (null unless the
          // controller config sets one) — see led_wire.js.
          ledWire: (proj && proj.wire) ? proj.wire : null,
          unpatched: !proj,
        };
        // The batch-render loop (animate.js) and the inbound sACN demap
        // (sacn_mapper.js) BOTH write the rendered RGBWAU onto a CLONE of
        // this pixel — not this closure's `px` — then call apply() with the
        // already-mixed RGB. So the apply MUST consume its (r,g,b) args
        // (exactly like the DMX-fixture apply above); reading px.* here read
        // the stale clone-source and left every strand black under patched
        // engine + sACN-in (the LED-parity output path). The RGBWAU→RGB mix
        // already happened in the caller; route it straight to the bulb.
        px.apply = fixture
          ? ((r, g, b) => {
            if (!getProfileDef(params.lightingProfile).mappingEnabled) return;
            // LED-strand GLOBAL master (params.strandsEnabled) + per-group master
            // (On/Off + Brightness) — a REAL last-layer output override on the
            // direct-paint path, the LED analogue of applyFixtureOutputOverrides
            // for DMX. Read live each frame (keyed by the strand DISPLAY group) so
            // a slider move dims the group on the very next frame; either OFF ⇒
            // black. Same authority (ledOutputScale) the raw-color paths gate on.
            const [sr, sg, sb] = scaleRgbForLedOutput(
              params.strandsEnabled, params.ledGroupOverrides, dispGroup, r || 0, g || 0, b || 0);
            fixture.setLedColorRGB(j, sr, sg, sb);
          })
          : (() => {});
        pixels.push(px);
      }
    });
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  pixels.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  });
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  pixels.forEach(p => {
    p.nx = +((p.x - minX) / rangeX).toFixed(4);
    p.ny = +((p.y - minY) / rangeY).toFixed(4);
    p.nz = +((p.z - minZ) / rangeZ).toFixed(4);
  });

  return { pixels, specialEffects };
}

export function saveModelJS() {
  const { pixels, specialEffects } = generatePixelMap();

  const lines = [
    '// Auto-generated Pixelblaze model — do not edit manually',
    '// Updated: ' + new Date().toISOString(),
    '//',
    '// Note: Non-light simulation fixtures (Horn, Fire, Foggers) are exported to',
    '// the companion .effects.js model.',
    '//',
    '// Each pixel has: index, type, name, group, world coords (x,y,z),',
    '// normalized coords (nx,ny,nz) in [0..1], a 0-based within-fixture',
    '// `localIndex` (per-fixture/per-strand pixel ordinal), and optional V2',
    '// metadata maps',
    '',
    'export const pixelCount = ' + pixels.length + ';',
    '',
    'export const pixels = [',
  ];

  pixels.forEach((p, i) => {
    // LED-patched pixels carry `led: true` (+ stride footprint) so the
    // engine's LED output mapper passes white through raw (native) instead
    // of the DMX-fixture min(R,G,B) white-synth. An UNPATCHED strand pixel
    // serializes patch:null + `unpatched: true` — a LOUD marker the engine
    // surfaces, never a silent skip (codex P0).
    let patchStr = 'null';
    if (p.patch) {
      patchStr = `{ universe: ${p.patch.universe}, addr: ${p.patch.addr}, ` +
        `footprint: ${p.patch.footprint}${p.patch.led ? ', led: true' : ''} }`;
    }
    const chStr = p.channels ? JSON.stringify(p.channels) : 'null';
    // LED strands may carry a scene-level colour-encode override
    // (`ledWire`) — serialized ONLY when the scene sets one, so a default
    // rig exports byte-for-byte the same model file as before.
    const extra = (p.type === 'led')
      ? `, whiteMode: '${p.whiteMode || 'native'}'` +
        `${p.ledWire ? `, ledWire: ${JSON.stringify(p.ledWire)}` : ''}` +
        `${p.unpatched ? ', unpatched: true' : ''}`
      : '';
    // localIndex is the exporter-emitted 0-based within-fixture ordinal
    // (DMX: per-fixture pixel order; LED: per-strand pixel order). The
    // engine prefers it over its (group,fId) heuristic; a NEW export always
    // carries it on every pixel, so it is serialized unconditionally.
    lines.push(`  { i: ${i}, type: '${p.type}', fixtureType: '${p.fixtureType || ''}', name: '${p.name}', group: '${p.group}', x: ${p.x}, y: ${p.y}, z: ${p.z}, nx: ${p.nx}, ny: ${p.ny}, nz: ${p.nz}, cId: ${p.cId || 0}, sId: ${p.sId || 0}, fId: ${p.fId || 0}, localIndex: ${p.localIndex || 0}, vMask: ${p.vMask || 0}, patch: ${patchStr}, channels: ${chStr}${extra} },`);
  });

  lines.push('];');
  lines.push('');

  const modelJS = lines.join('\n');
  const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';

  // Build effects model
  const effectsLines = [
    '// Auto-generated Companion Special Effects model — do not edit manually',
    '// Updated: ' + new Date().toISOString(),
    '',
    'export const specialEffects = [',
  ];

  specialEffects.forEach(fx => {
    const patchStr = fx.patch ? `{ universe: ${fx.patch.universe}, addr: ${fx.patch.addr}, footprint: ${fx.patch.footprint} }` : 'null';
    const chStr = fx.channels ? JSON.stringify(fx.channels) : 'null';
    effectsLines.push(`  { id: '${fx.id}', kind: '${fx.kind}', fixtureType: '${fx.fixtureType}', name: '${fx.name}', group: '${fx.group}', patch: ${patchStr}, channels: ${chStr}, controlGroup: '${fx.controlGroup}' },`);
  });

  effectsLines.push('];');
  effectsLines.push('');
  const effectsJS = effectsLines.join('\n');

  // Build the view-masks sidecar from the scene-owned view registry, in
  // the SAME pass as the model so the two can never drift apart (the
  // engine throws on any mismatch at load), and BEFORE any POST fires:
  // a sidecar that fails to build (bit exhaustion, a view referencing a
  // group with no pixels) must abort the model write too — otherwise
  // model and sidecar split and the engine refuses the model at its
  // next load. Skipped when the pixel map was skipped (fixtures
  // mid-rebuild) — a sidecar generated from an empty pixel list would
  // wipe real membership data.
  let viewmasksJS = null;
  if (window.__viewRegistry && pixels.length > 0) {
    // Reconcile from the PIXELS just generated — the exact group set
    // the engine will validate the sidecar against.
    reconcileGroupBits(window.__viewRegistry, listPixelGroups(pixels));
    // Scene name only stamps the generated header comment; routing uses
    // sceneParam. '(unknown scene)' is deliberately not a real scene
    // name so a missing __activeScene can never masquerade as one.
    viewmasksJS = buildViewmasksSidecarJS(
      window.__viewRegistry, pixels, window.__activeScene || '(unknown scene)');
  }

  // Static host has no save-server (port 6970) — everything above still
  // built (reconcile mutates the live registry), just nothing persists
  // over a transport that can't reach localhost.
  if (isStaticHost()) {
    logStaticHostSkip('save-model POSTs (port 6970)');
    return;
  }
  fetch(saveHttpUrl(`/save-model${sceneParam}`), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: modelJS,
  }).catch(err => console.warn('[PB] Failed to save model:', err));
  fetch(saveHttpUrl(`/save-model${sceneParam ? sceneParam + '&' : '?'}type=effects`), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: effectsJS,
  }).catch(err => console.warn('[PB] Failed to save effects model:', err));
  if (viewmasksJS !== null) {
    fetch(saveHttpUrl(`/save-model${sceneParam ? sceneParam + '&' : '?'}type=viewmasks`), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: viewmasksJS,
    }).catch(err => console.warn('[PB] Failed to save viewmasks sidecar:', err));
  }
}

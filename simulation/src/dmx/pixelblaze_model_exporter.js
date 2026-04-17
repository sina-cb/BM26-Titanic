import * as THREE from "three";
import { params } from "../core/state.js";

export function generatePixelMap() {
  const pixels = [];

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
    dmxList.forEach((light, i) => {
      const fixture = (window.dmxSceneFixtures && window.dmxSceneFixtures[i]) || (window.parFixtures && window.parFixtures[i]) || null;
      if (fixture && fixture.pixels && fixture.pixels.length > 0) {
        if (fixture.hitbox) fixture.hitbox.updateMatrixWorld(true);
        if (fixture.group) fixture.group.updateMatrixWorld(true);
        fixture.pixels.forEach((px, j) => {
          const worldPos = new THREE.Vector3();
          if (fixture.group && px.localPos) {
            worldPos.copy(px.localPos).applyMatrix4(fixture.group.matrixWorld);
          } else {
            worldPos.set(light.x || 0, light.y || 0, light.z || 0);
          }
          pixels.push({
            type: 'dmx',
            fixtureType: light.type || light.fixtureType || 'UkingPar',
            name: (light.name || `Fixture ${i + 1}`) + (px.model ? ` - ${px.model.id}` : ` (Ch ${j + 1})`),
            group: light.group || '',
            x: +(worldPos.x).toFixed(3),
            y: +(worldPos.y).toFixed(3),
            z: +(worldPos.z).toFixed(3),
            nx: 0, ny: 0, nz: 0,
            cId: light.controllerId || 0,
            sId: light.sectionId || 0,
            fId: light.fixtureId || 0,
            vMask: light.viewMask || 0,
            _prePatched: (light.dmxUniverse > 0 && light.dmxAddress > 0),
            patch: (light.dmxUniverse > 0 && light.dmxAddress > 0) ? {
               universe: light.dmxUniverse,
               addr: light.dmxAddress,
               footprint: fixture.fixtureDef ? (fixture.fixtureDef.footprint || fixture.fixtureDef.channelMode || fixture.fixtureDef.channel_mode || fixture.fixtureDef.totalChannels || 10) : 10
            } : null,
            channels: standardizeChannels(px.model && px.model.channels ? px.model.channels : null),
            // Bind the apply callback natively for the simulator
            apply: (r, g, b) => {
              if (params.lightingProfile === 'edit') return;
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
        pixels.push({
            type: 'dmx',
            fixtureType: light.type || light.fixtureType || 'Generic',
            name: light.name || `Fixture ${i + 1}`,
            group: light.group || '',
            x: +(worldPos.x).toFixed(3),
            y: +(worldPos.y).toFixed(3),
            z: +(worldPos.z).toFixed(3),
            nx: 0, ny: 0, nz: 0,
            cId: light.controllerId || 0,
            sId: light.sectionId || 0,
            fId: light.fixtureId || 0,
            vMask: light.viewMask || 0,
            _prePatched: (light.dmxUniverse > 0 && light.dmxAddress > 0),
            patch: (light.dmxUniverse > 0 && light.dmxAddress > 0) ? {
               universe: light.dmxUniverse,
               addr: light.dmxAddress,
               footprint: fixture.fixtureDef ? (fixture.fixtureDef.channel_mode || fixture.fixtureDef.totalChannels || 10) : 10
            } : null,
            channels: standardizeChannels(fixture.fixtureDef && fixture.fixtureDef.channels ? fixture.fixtureDef.channels : null),
            apply: (r, g, b) => {
               if (params.lightingProfile === 'edit') return;
               fixture.light.color.setRGB(r, g, b);
               if (fixture.beam && fixture.beam.material) fixture.beam.material.color.setRGB(r, g, b);
               if (fixture.setBulbColor) fixture.setBulbColor(r, g, b);
            }
        });
      } else {
        const errorMsg = `[MarsinEngine Export] Warning: Unsupported or missing fixture definition! Par light at index ${i} (Type: ${light.fixtureType || 'Unknown'}) could not be resolved against supported fixtures. Skipping.`;
        console.warn(errorMsg, { config: light, fixture: fixture, paramsDmx: params.dmxFixtures?.length, paramsPar: params.parLights?.length, winDmx: window.dmxSceneFixtures?.length, winPar: window.parFixtures?.length });
      }
    });
  }

  // LED strands
  if (params.ledStrands) {
    params.ledStrands.forEach((strand, i) => {
      const fixture = window.ledStrandFixtures && window.ledStrandFixtures[i] ? window.ledStrandFixtures[i] : null;
      const count = strand.ledCount || 10;
      const sx = +(strand.startX || 0), sy = +(strand.startY || 0), sz = +(strand.startZ || 0);
      const ex = +(strand.endX || 0), ey = +(strand.endY || 0), ez = +(strand.endZ || 0);
      for (let j = 0; j < count; j++) {
        const t = count > 1 ? j / (count - 1) : 0.5;
        pixels.push({
          type: 'led',
          name: strand.name || 'Strand',
          group: strand.name || '',
          x: +(sx + (ex - sx) * t).toFixed(3),
          y: +(sy + (ey - sy) * t).toFixed(3),
          z: +(sz + (ez - sz) * t).toFixed(3),
          nx: 0, ny: 0, nz: 0,
          cId: strand.controllerId || 0,
          sId: strand.sectionId || 0,
          fId: strand.fixtureId || 0,
          vMask: strand.viewMask || 0,
          patch: null,
          channels: null,
          apply: fixture ? ((r, g, b) => {
            if (params.lightingProfile === 'edit') return;
            fixture.setLedColorRGB(j, r, g, b);
          }) : (() => {})
        });
      }
    });
  }

  // Iceberg LEDs
  if (params.icebergs) {
    params.icebergs.forEach((berg, i) => {
      const fixture = window.icebergFixtures && window.icebergFixtures[i] ? window.icebergFixtures[i] : null;
      pixels.push({
        type: 'iceberg',
        name: berg.name || 'Iceberg',
        group: berg.name || '',
        x: +(berg.x || 0),
        y: +(berg.y || 0),
        z: +(berg.z || 0),
        nx: 0, ny: 0, nz: 0,
        cId: berg.controllerId || 0,
        sId: berg.sectionId || 0,
        fId: berg.fixtureId || 0,
        vMask: berg.viewMask || 0,
        patch: null,
        channels: null,
        apply: fixture ? ((r, g, b) => {
          if (params.lightingProfile === 'edit') return;
          fixture.setColorRGB(r, g, b);
        }) : (() => {})
      });
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

  return pixels;
}

export function saveModelJS() {
  const pixels = generatePixelMap();

  const lines = [
    '// Auto-generated Pixelblaze model — do not edit manually',
    '// Updated: ' + new Date().toISOString(),
    '//',
    '// Each pixel has: index, type, name, group, world coords (x,y,z),',
    '// normalized coords (nx,ny,nz) in [0..1], and optional V2 metadata maps',
    '',
    'export const pixelCount = ' + pixels.length + ';',
    '',
    'export const pixels = [',
  ];

  pixels.forEach((p, i) => {
    const patchStr = p.patch ? `{ universe: ${p.patch.universe}, addr: ${p.patch.addr}, footprint: ${p.patch.footprint} }` : 'null';
    const chStr = p.channels ? JSON.stringify(p.channels) : 'null';
    lines.push(`  { i: ${i}, type: '${p.type}', fixtureType: '${p.fixtureType || ''}', name: '${p.name}', group: '${p.group}', x: ${p.x}, y: ${p.y}, z: ${p.z}, nx: ${p.nx}, ny: ${p.ny}, nz: ${p.nz}, cId: ${p.cId || 0}, sId: ${p.sId || 0}, fId: ${p.fId || 0}, vMask: ${p.vMask || 0}, patch: ${patchStr}, channels: ${chStr} },`);
  });

  lines.push('];');
  lines.push('');

  const modelJS = lines.join('\n');
  const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
  fetch(`http://localhost:6970/save-model${sceneParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: modelJS,
  }).catch(err => console.warn('[PB] Failed to save model:', err));
}

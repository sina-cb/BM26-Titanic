/**
 * fixtures.js — Fixture rebuild/sync logic.
 *
 * Uses DmxFixtureRuntime (replaces legacy ParLight).
 * Supports both old config format (parLights[]) and new format during transition.
 */
import * as THREE from "three";
import {
  scene, params, interactiveObjects, modelRadius,
  selectedFixtureIndices, selectedDmxIndices,
} from "./state.js";
import { DmxFixtureRuntime } from "../fixtures/dmx_fixture_runtime.js";
import { ModelFixture } from "../fixtures/model_fixture.js";
import { FogMachine } from "../fixtures/fog_machine.js";
import { getDefinition } from "../dmx/fixture_definition_registry.js";

export function rebuildParLights(force = false) {
  if (!window.parFixtures) {
    window.parFixtures = [];
  }

  if (force) {
    selectedFixtureIndices.clear();
    window.parFixtures.forEach((f) => f.destroy());
    window.parFixtures = [];
  }

  while (window.parFixtures.length > params.parLights.length) {
    const f = window.parFixtures.pop();
    if (f) f.destroy();
  }

  const total = params.parLights.length;
  console.log(`[fixtures] rebuildParLights: ${total} fixtures, scene=${!!scene}, liteMode=${!!params.liteMode}`);

  // Async chunked mode is only used for profile switches (heavy SpotLight construction).
  // All other rebuilds (regenerate, delete, add) run synchronously for instant visual feedback.
  window._missingFixtureWarnCount = 0;
  const CHUNK = 25;
  const needsAsync = force && total > CHUNK && !window._isAppBooting && window._asyncProfileRebuild;

  if (needsAsync) {
    window._isRebuildingFixtures = true;
    window._fixtureRebuildGeneration = (window._fixtureRebuildGeneration || 0) + 1;
    // Async chunked rebuild — yields to browser between batches
    _rebuildParLightsAsync(0, total, CHUNK, window._fixtureRebuildGeneration);
  } else {
    // Synchronous rebuild
    for (let i = 0; i < total; i++) {
      _buildFixtureAt(i);
    }
    _finishRebuild();
  }
}

function _buildFixtureAt(index) {
  const config = params.parLights[index];
  if (!config) return;
  let fixture = window.parFixtures[index];

  // Detect fixture type change — must destroy and recreate
  if (fixture) {
    const currentType = fixture.fixtureDef?.fixtureType || 'UkingPar';
    const newType = config.type || config.fixtureType || 'UkingPar';
    if (currentType !== newType) {
      fixture.destroy();
      fixture = null;
      window.parFixtures[index] = null;
    }
  }

  if (!fixture) {
    const fixtureType = config.type || config.fixtureType || 'UkingPar';
    const fixtureDef = getDefinition(fixtureType);

    try {
      const patchDef = (config.dmxUniverse && config.dmxAddress) ? {
        universe: config.dmxUniverse,
        addr: config.dmxAddress
      } : null;

      if (fixtureType === 'FogMachine') {
        fixture = new FogMachine(
          config, index, scene, interactiveObjects, modelRadius
        );
      } else {
        fixture = new DmxFixtureRuntime(
          config, index, scene, interactiveObjects, modelRadius, fixtureDef, patchDef
        );
      }
      window.parFixtures[index] = fixture;
    } catch (err) {
      console.error(`[fixtures] Failed to create fixture ${index} (${fixtureType}):`, err);
      return;
    }
  } else {
    fixture.config = config;
    fixture.index = index;
    fixture.patchDef = (config.dmxUniverse && config.dmxAddress) ? {
      universe: config.dmxUniverse,
      addr: config.dmxAddress
    } : null;
    fixture.syncFromConfig();
  }

  fixture.setVisibility(params.parsEnabled !== false, params.conesEnabled !== false);
}

function _rebuildParLightsAsync(start, total, chunk, generationId) {
  if (generationId && generationId !== window._fixtureRebuildGeneration) {
    console.warn(`[fixtures] Async rebuild cancelled (generation ${generationId} superceded)`);
    return;
  }

  const end = Math.min(start + chunk, total);
  for (let i = start; i < end; i++) {
    _buildFixtureAt(i);
  }

  if (end < total) {
    // Yield to browser — keeps UI responsive
    requestAnimationFrame(() => _rebuildParLightsAsync(end, total, chunk, generationId));
  } else {
    _finishRebuild();
    console.log(`[fixtures] Async rebuild complete: ${total} fixtures`);
  }
}

function _finishRebuild() {
  const invalidSelections = [];
  for (const idx of selectedFixtureIndices) {
    if (idx >= window.parFixtures.length) invalidSelections.push(idx);
  }
  invalidSelections.forEach(idx => selectedFixtureIndices.delete(idx));

  if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('fixtures rebuilt');

  // Async rebuild complete -- allow saves again and queue one
  if (window._isRebuildingFixtures) {
    window._isRebuildingFixtures = false;
    if (window.debounceAutoSave && !window._isAppBooting) {
      window.debounceAutoSave();
    }
  }
}

export function rebuildDmxFixtures(force = false) {
  if (!window.dmxSceneFixtures) window.dmxSceneFixtures = [];

  if (force) {
    selectedDmxIndices.clear();
    window.dmxSceneFixtures.forEach((f) => f.destroy());
    window.dmxSceneFixtures = [];
  }

  while (window.dmxSceneFixtures.length > params.dmxFixtures.length) {
    const f = window.dmxSceneFixtures.pop();
    if (f) f.destroy();
  }

  params.dmxFixtures.forEach((config, index) => {
    let fixture = window.dmxSceneFixtures[index];
    
    if (fixture) {
      const currentType = fixture.config.type || 'None';
      const newType = config.type || 'None';
      if (currentType !== newType) {
        fixture.destroy();
        fixture = null;
      }
    }

    if (!fixture) {
      const fixtureType = config.type; 
      const fixtureModel = fixtureType && window.fixtureModels && window.fixtureModels[fixtureType];

      if (fixtureType === 'FogMachine') {
        fixture = new FogMachine(
          config,
          index,
          scene,
          interactiveObjects,
          modelRadius
        );
        window.dmxSceneFixtures[index] = fixture;
      } else if (fixtureModel) {
        fixture = new ModelFixture(
          config,
          index,
          scene,
          interactiveObjects,
          modelRadius,
          fixtureModel,
        );
        window.dmxSceneFixtures[index] = fixture;
      } else {
        const fixtureDef = getDefinition(fixtureType);
        fixture = new DmxFixtureRuntime(
          config,
          index,
          scene,
          interactiveObjects,
          modelRadius,
          fixtureDef,
          null,
        );
        window.dmxSceneFixtures[index] = fixture;
      }
    } else {
      fixture.config = config;
      fixture.index = index;
      fixture.syncFromConfig();
    }
    
    fixture.setVisibility(params.dmxEnabled !== false, params.conesEnabled !== false);
  });

  const invalidSelections = [];
  for (const idx of selectedDmxIndices) {
    if (idx >= window.dmxSceneFixtures.length) invalidSelections.push(idx);
  }
  invalidSelections.forEach(idx => selectedDmxIndices.delete(idx));

  if (window.invalidateMarsinBatchCache) {
    window.invalidateMarsinBatchCache('rebuildDmxFixtures');
  }
}

// Sync individual fixture from its config (called from GUI)
window.syncLightFromConfig = function (index) {
  if (window.parFixtures && window.parFixtures[index]) {
    window.parFixtures[index].syncFromConfig();
    if (window.debounceAutoSave) window.debounceAutoSave();
  }
};

window.syncDmxFromConfig = function (index) {
  if (window.dmxSceneFixtures && window.dmxSceneFixtures[index]) {
    window.dmxSceneFixtures[index].syncFromConfig();
    if (window.debounceAutoSave) window.debounceAutoSave();
  }
};

// Expose for other modules
window.rebuildParLights = rebuildParLights;
window.rebuildDmxFixtures = rebuildDmxFixtures;

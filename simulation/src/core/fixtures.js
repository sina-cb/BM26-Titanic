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

  console.log(`[fixtures] rebuildParLights: ${params.parLights.length} fixtures, scene=${!!scene}, liteMode=${!!params.liteMode}`);

  params.parLights.forEach((config, index) => {
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
      // Resolve fixture type — check config, fall back to UkingPar
      const fixtureType = config.type || config.fixtureType || 'UkingPar';
      const fixtureDef = getDefinition(fixtureType);

      try {
        fixture = new DmxFixtureRuntime(
          config,
          index,
          scene,
          interactiveObjects,
          modelRadius,
          fixtureDef,
          null, // patchDef — unpatched in legacy mode
          !!params.liteMode,
        );
        window.parFixtures[index] = fixture;
      } catch (err) {
        console.error(`[fixtures] Failed to create fixture ${index} (${fixtureType}):`, err);
        return;
      }
    } else {
      fixture.config = config;
      fixture.index = index;
      fixture.syncFromConfig();
    }
    
    fixture.setVisibility(params.parsEnabled !== false, params.conesEnabled !== false);
  });

  const invalidSelections = [];
  for (const idx of selectedFixtureIndices) {
    if (idx >= window.parFixtures.length) invalidSelections.push(idx);
  }
  invalidSelections.forEach(idx => selectedFixtureIndices.delete(idx));
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

      if (fixtureModel) {
        fixture = new ModelFixture(
          config,
          index,
          scene,
          interactiveObjects,
          modelRadius,
          fixtureModel,
        );
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
          !!params.liteMode,
        );
      }
      window.dmxSceneFixtures[index] = fixture;
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

import * as THREE from 'three';
import { DmxFixtureRuntime } from './src/fixtures/dmx_fixture_runtime.js';
import { getProfileDef } from './src/core/profile_registry.js';
import { params } from './src/core/state.js';

params.lightingProfile = 'pixel_mapping'; // simulate the active parameter

const scene = new THREE.Scene();
const interactiveObjects = [];

const config = {
   type: 'ShehdsBar',
   dmxUniverse: 1,
   dmxAddress: 1,
   x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0
};

const fixtureDef = {
   pixels: [
      { dots: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] }
   ]
};

try {
   const runtime = new DmxFixtureRuntime(config, 0, scene, interactiveObjects, 100, fixtureDef, null);
   console.log("Success");
} catch (err) {
   console.error("Crash:", err.message);
   console.error(err.stack);
}

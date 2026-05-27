import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const patchesPath = path.join(__dirname, '..', '..', 'simulation', 'scenes', 'summer_camp_dome', 'patches.yaml');
const patchesDoc = yaml.load(fs.readFileSync(patchesPath, 'utf8'));
const patches = patchesDoc.patches;

// Apply Test Bench Mappings
// BarLights 3 -> Bar Left (U2: 107)
patches['BarLights 3'].dmxUniverse = 2;
patches['BarLights 3'].dmxAddress = 107;
patches['BarLights 3'].controllerIp = '10.1.1.102';

// BarLights 2 -> Bar Right (U2: 226)
patches['BarLights 2'].dmxUniverse = 2;
patches['BarLights 2'].dmxAddress = 226;
patches['BarLights 2'].controllerIp = '10.1.1.102';

// VintageLights 1 -> Vintage Left (U2: 41)
patches['VintageLights 1'].dmxUniverse = 2;
patches['VintageLights 1'].dmxAddress = 41;
patches['VintageLights 1'].controllerIp = '10.1.1.102';

// VintageLights 2 -> Vintage Right (U2: 74)
patches['VintageLights 2'].dmxUniverse = 2;
patches['VintageLights 2'].dmxAddress = 74;
patches['VintageLights 2'].controllerIp = '10.1.1.102';

// UkingPar 23 -> Par 1 (U2: 1)
patches['UkingPar 23'].dmxUniverse = 2;
patches['UkingPar 23'].dmxAddress = 1;
patches['UkingPar 23'].controllerIp = '10.1.1.102';

// UkingPar 24 -> Par 2 (U2: 11)
patches['UkingPar 24'].dmxUniverse = 2;
patches['UkingPar 24'].dmxAddress = 11;
patches['UkingPar 24'].controllerIp = '10.1.1.102';

// UkingPar 25 -> Par 3 (U2: 21)
patches['UkingPar 25'].dmxUniverse = 2;
patches['UkingPar 25'].dmxAddress = 21;
patches['UkingPar 25'].controllerIp = '10.1.1.102';

// Set of target mapped fixtures
const mappedKeys = new Set([
  'BarLights 2', 'BarLights 3',
  'VintageLights 1', 'VintageLights 2',
  'UkingPar 23', 'UkingPar 24', 'UkingPar 25'
]);

// Shift all others to Universe 10+
let currentUniverse = 10;
let currentAddress = 1;

for (const key of Object.keys(patches)) {
  if (mappedKeys.has(key)) continue;
  
  const fixture = patches[key];
  fixture.controllerIp = ''; // Ensure no conflict with test bench
  
  // Determine footprint based on prefix to safely pack them
  let footprint = 10; // Default
  if (key.startsWith('BarLights') || key.startsWith('ShehdsBar')) footprint = 119;
  else if (key.startsWith('VintageLights')) footprint = 33;
  else if (key.startsWith('UkingPar')) footprint = 10;
  else if (key.startsWith('TEFogMachine')) footprint = 1;
  else footprint = 10;

  if (currentAddress + footprint > 512) {
    currentUniverse++;
    currentAddress = 1;
  }

  // TEFogMachine historically is at 512
  if (key.startsWith('TEFogMachine')) {
    fixture.dmxUniverse = currentUniverse;
    fixture.dmxAddress = 512;
  } else {
    fixture.dmxUniverse = currentUniverse;
    fixture.dmxAddress = currentAddress;
    currentAddress += footprint;
  }
}

fs.writeFileSync(patchesPath, yaml.dump(patchesDoc), 'utf8');
console.log('Successfully patched summer_camp_dome fixtures!');

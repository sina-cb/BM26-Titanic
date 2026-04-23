import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load configurations
function loadYaml(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

async function exportForUnreal(modelName) {
    const rootPath = path.resolve(__dirname, '../../../');
    const scenesPath = path.join(rootPath, 'simulation/scenes');
    
    // Parse main files
    const commonPath = path.join(scenesPath, 'common.yaml');
    const sceneCfgPath = path.join(scenesPath, modelName, 'scene_config.yaml');
    const patchesPath = path.join(scenesPath, modelName, 'patches.yaml');

    if (!fs.existsSync(sceneCfgPath)) {
        console.error(`Cannot find scene config for model: ${modelName}`);
        process.exit(1);
    }

    const commonData = loadYaml(commonPath) || {};
    const sceneData = loadYaml(sceneCfgPath) || {};
    const patchData = loadYaml(patchesPath) || { patches: {} };

    // Here we construct a flattened JSON representing the entire footprint mapping
    const payload = {
        fixtures: [],
        staticGeometry: []
    };

    const extractObjects = (objects) => {
        // Obsoleted
    };

    function findSceneObjects(node, objectsList) {
        if (Array.isArray(node)) {
            node.forEach(item => {
                if (item && typeof item === 'object' && item.name) {
                    objectsList.push(item);
                } else {
                    findSceneObjects(item, objectsList);
                }
            });
        } else if (node && typeof node === 'object') {
            Object.values(node).forEach(value => {
                if (value && typeof value === 'object' && value.name && typeof value.name === 'string') {
                    // It's an object acting like a map but it has its own name? Rarely happens, but just in case
                    objectsList.push(value);
                }
                findSceneObjects(value, objectsList);
            });
        }
    }

    const allObjects = [];
    if (sceneData) findSceneObjects(sceneData, allObjects);
    if (commonData) findSceneObjects(commonData, allObjects);

    // Load fixture model YAMLs for pixel layout data
    const fixtureModelsDir = path.join(rootPath, 'simulation/dmx/fixtures');
    const fixtureModels = {};
    if (fs.existsSync(fixtureModelsDir)) {
        for (const dir of fs.readdirSync(fixtureModelsDir)) {
            const dirPath = path.join(fixtureModelsDir, dir);
            if (!fs.statSync(dirPath).isDirectory()) continue;
            for (const file of fs.readdirSync(dirPath)) {
                if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
                const model = loadYaml(path.join(dirPath, file));
                if (model && model.model && model.model.fixture_type) {
                    fixtureModels[model.model.fixture_type] = model.model;
                }
            }
        }
    }
    console.log(`[Unreal Export] Loaded ${Object.keys(fixtureModels).length} fixture model(s): ${Object.keys(fixtureModels).join(', ')}`);

    // Deduplicate by name just in case
    const processed = new Set();

    allObjects.forEach(details => {
        if (processed.has(details.name)) return;
        processed.add(details.name);

        const patch = patchData.patches ? patchData.patches[details.name] : null;
        const fixtureType = details.fixtureType || details.type || 'UnknownMesh';
        const model = fixtureModels[fixtureType] || null;

        const baseObj = {
            name: details.name,
            type: fixtureType,
            position: [details.x || 0, details.y || 0, details.z || 0],
            rotation: [details.rotX || 0, details.rotY || 0, details.rotZ || 0],
            color: details.color || '#ffaa44',
            intensity: details.intensity || 5,
            angle: details.angle || 45,
        };

        // Embed pixel layout from model YAML
        if (model && model.pixels && model.pixels.length > 0) {
            baseObj.pixelCount = model.pixels.length;
            const mappedPixels = [];
            let fallbackOffset = 0;
            for (const p of model.pixels) {
                // The fixtures specify absolute 1-based channel mapping in the `channels` object
                let offset = fallbackOffset;
                if (p.channels) {
                    if (Array.isArray(p.channels)) {
                        // Relative Array (e.g. VintageLed)
                        fallbackOffset += p.channels.length;
                    } else if (typeof p.channels === 'object') {
                        // Absolute Object (e.g. ShehdsBar, UkingPar)
                        // Prioritize the actual color start channel over master dimmers
                        if ('red' in p.channels && typeof p.channels.red === 'number') {
                            offset = p.channels.red - 1;
                        } else if ('value' in p.channels && typeof p.channels.value === 'number') {
                            offset = p.channels.value - 1;
                        } else {
                            const vals = Object.values(p.channels).filter(v => typeof v === 'number');
                            if (vals.length > 0) {
                                offset = Math.min(...vals) - 1;
                            }
                        }
                    }
                } else {
                    // Fallback
                    const dflt = (p.type === 'warm' || p.type === 'w' ? 1 : (p.type === 'rgbw' ? 4 : 3));
                    fallbackOffset += dflt;
                }
                
                mappedPixels.push({
                    id: p.id,
                    type: p.type || 'rgb',
                    offset: offset,
                    // Average dot position (mm) for light placement
                    position: p.dots && p.dots.length > 0
                        ? p.dots.reduce((acc, d) => [acc[0] + d[0]/p.dots.length, acc[1] + d[1]/p.dots.length, acc[2] + d[2]/p.dots.length], [0,0,0])
                        : [0, 0, 0],
                });
            }
            baseObj.pixels = mappedPixels;
            baseObj.dimensions = model.dimensions || null;
        }

        if (!patch) {
            payload.staticGeometry.push(baseObj);
        } else {
            baseObj.universe = patch.dmxUniverse || 1;
            baseObj.address = patch.dmxAddress || 1;
            baseObj.channelMode = model ? model.channel_mode : 0;
            payload.fixtures.push(baseObj);
        }
    });

    const outPath = path.join(__dirname, 'unreal_ingested_model.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

    console.log(`[Unreal Export] Generated flattened JSON structure for {${modelName}}`);
    console.log(` -> ${payload.fixtures.length} DMX-Bound Fixtures`);
    console.log(` -> ${payload.staticGeometry.length} Static Read-Only Meshes`);
    console.log(` Output: ${outPath}`);
}

const args = process.argv.slice(2);
const modelArg = args[0] || 'test_bench';
exportForUnreal(modelArg).catch(console.error);

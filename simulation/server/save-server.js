const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Resolve paths relative to the simulation root (parent of server/)
const SIM_ROOT = path.join(__dirname, '..');
const ENGINE_ROOT = path.join(SIM_ROOT, '..', 'marsin_engine');
const SCENES_ROOT = path.join(SIM_ROOT, 'scenes');

/**
 * Resolve scene-specific config path. If sceneName is omitted, defaults to 'titanic'.
 */
function resolveSceneConfigPath(sceneName) {
  const safeName = (sceneName || 'titanic').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(SCENES_ROOT, safeName, 'scene_config.yaml');
}

function resolveSceneCamerasPath(sceneName) {
  const safeName = (sceneName || 'titanic').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(SCENES_ROOT, safeName, 'cameras.yaml');
}

// Read port from config.yaml
const serverConfig = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'config.yaml'), 'utf8'));
const SAVE_PORT = serverConfig.save_port || 6970;

// Atomic + durable write: write to a sibling temp file, fsync it, then
// rename over the target. A crash mid-write can no longer leave a
// truncated yaml/model behind for the next boot to load as "stale but
// parseable" state, and the fsync makes the rename survive a power cut
// (the playa runs on generators). On any failure the temp file is
// removed before rethrowing, so crash residue never lands next to
// tracked files.
function writeFileAtomic(targetPath, contents) {
  const tmpPath = `${targetPath}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, contents);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

// ─── Static manifests (single source of truth for the client) ───────────
// The simulation client (main.js, pattern_editor.js) discovers the scene
// and pattern lists by fetching these JSON files — same path in dev and
// production (GitHub Pages). No localhost fetch, no hardcoded fallback
// (see .agent/00_gol/00_codex.md P0). We regenerate them here after every
// mutation so the dev experience stays "live" without two client code paths.
const SCENE_MANIFEST_PATH = path.join(SCENES_ROOT, 'manifest.json');
const PATTERN_MANIFEST_PATH = path.join(ENGINE_ROOT, 'patterns', 'manifest.json');

function listScenes() {
  if (!fs.existsSync(SCENES_ROOT)) return [];
  const scenes = [];
  for (const entry of fs.readdirSync(SCENES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(SCENES_ROOT, entry.name, 'scene_config.yaml');
    if (fs.existsSync(cfgPath)) scenes.push(entry.name);
  }
  return scenes.sort();
}

function listPatterns() {
  const patternsDir = path.join(ENGINE_ROOT, 'patterns');
  if (!fs.existsSync(patternsDir)) return [];
  const names = fs.readdirSync(patternsDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js') && !e.name.startsWith('test_') && e.name !== 'test.js')
    .map(e => e.name.replace(/\.js$/, ''));
  const numbered = names.filter(n => /^\d/.test(n)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    return na - nb || a.localeCompare(b);
  });
  const named = names.filter(n => !/^\d/.test(n)).sort();
  return [...numbered, ...named];
}

function writeSceneManifest() {
  try {
    fs.mkdirSync(SCENES_ROOT, { recursive: true });
    fs.writeFileSync(SCENE_MANIFEST_PATH, JSON.stringify(listScenes(), null, 2) + '\n');
    console.log(`[SAVE SERVER] Regenerated ${SCENE_MANIFEST_PATH}`);
  } catch (err) {
    console.error(`[SAVE SERVER] Failed to regenerate scene manifest: ${err.message}`);
  }
}

function writePatternManifest() {
  try {
    fs.mkdirSync(path.join(ENGINE_ROOT, 'patterns'), { recursive: true });
    fs.writeFileSync(PATTERN_MANIFEST_PATH, JSON.stringify(listPatterns(), null, 2) + '\n');
    console.log(`[SAVE SERVER] Regenerated ${PATTERN_MANIFEST_PATH}`);
  } catch (err) {
    console.error(`[SAVE SERVER] Failed to regenerate pattern manifest: ${err.message}`);
  }
}

// Refresh both manifests at startup so a fresh clone has accurate lists
// even before any save endpoint is hit.
writeSceneManifest();
writePatternManifest();

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }

  // Parse URL + query params once
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const sceneName = parsedUrl.searchParams.get('scene') || null;
  
  if (req.method === 'POST' && pathname === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const outPath = resolveSceneConfigPath(sceneName);
      const patchesPath = path.join(path.dirname(outPath), 'patches.yaml');
      console.log(`[SAVE SERVER] POST /save (scene=${sceneName || 'default'}). Body: ${body.length} bytes`);
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });

        // Parse and decouple patching logic
        const configTree = yaml.load(body);

        // Collect ALL fixture arrays from any known config location
        const allFixtureArrays = [];
        if (configTree && configTree.parLights && Array.isArray(configTree.parLights.fixtures)) {
          allFixtureArrays.push(configTree.parLights.fixtures);
        }
        if (configTree && Array.isArray(configTree.dmxLights)) {
          allFixtureArrays.push(configTree.dmxLights);
        }
        if (configTree && configTree.dmxLights && Array.isArray(configTree.dmxLights.fixtures)) {
          allFixtureArrays.push(configTree.dmxLights.fixtures);
        }

        if (allFixtureArrays.length > 0) {
          const patches = { patches: {} };
          for (const fixtureArray of allFixtureArrays) {
            fixtureArray.forEach(fixture => {
              const name = fixture.name;
              if (name) {
                patches.patches[name] = {
                  controllerIp: fixture.controllerIp || '',
                  dmxUniverse: fixture.dmxUniverse || 0,
                  dmxAddress: fixture.dmxAddress || 0,
                  controllerId: fixture.controllerId || 0,
                  sectionId: fixture.sectionId || 0,
                  fixtureId: fixture.fixtureId || 0,
                  viewMask: fixture.viewMask || 0,
                };
                // Clean structural tree
                delete fixture.controllerIp;
                delete fixture.dmxUniverse;
                delete fixture.dmxAddress;
                delete fixture.controllerId;
                delete fixture.sectionId;
                delete fixture.fixtureId;
                delete fixture.viewMask;
              }
            });
          }

          // Write extracted patches.yaml
          writeFileAtomic(patchesPath, yaml.dump(patches, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${patchesPath} (${Object.keys(patches.patches).length} fixture(s))`);

          // Re-serialize the cleaned structural tree
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Decouple the view registry into its own views.yaml (same
        // pattern as patches.yaml): the client attaches it to the
        // config tree as `views`, we split it back out so the
        // structural scene_config.yaml stays free of it.
        if (configTree && configTree.views && typeof configTree.views === 'object') {
          const viewsPath = path.join(path.dirname(outPath), 'views.yaml');
          writeFileAtomic(viewsPath, yaml.dump({ views: configTree.views }, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${viewsPath} ` +
            `(${Object.keys(configTree.views.groupBits || {}).length} group(s), ` +
            `${(configTree.views.custom || []).length} custom view(s))`);
          delete configTree.views;
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Decouple the controller mapping into its own controllers.yaml
        // (docs/33) — same pattern as views.yaml. The client attaches
        // the live registry to the config tree as `controllers`.
        if (configTree && configTree.controllers && typeof configTree.controllers === 'object') {
          const controllersPath = path.join(path.dirname(outPath), 'controllers.yaml');
          writeFileAtomic(controllersPath, yaml.dump({
            nextControllerId: configTree.controllers.nextControllerId || 1,
            nextUniverse: configTree.controllers.nextUniverse || 2,
            controllers: configTree.controllers.controllers || [],
          }, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${controllersPath} ` +
            `(${(configTree.controllers.controllers || []).length} controller(s))`);
          delete configTree.controllers;
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Split configTree into common and scene configurations
        const commonKeys = ['atmosphere', 'options', 'colorWave', 'config', '_camera', '_patternEditor'];
        const commonConfig = {};
        const sceneConfig = {};
        for (let k in configTree) {
          if (commonKeys.includes(k)) {
            commonConfig[k] = configTree[k];
          } else {
            sceneConfig[k] = configTree[k];
          }
        }

        // Write common.yaml
        const commonPath = path.join(SCENES_ROOT, 'common.yaml');
        writeFileAtomic(commonPath, yaml.dump(commonConfig, { lineWidth: -1 }));

        // Write cleaned scene_config.yaml
        writeFileAtomic(outPath, yaml.dump(sceneConfig, { lineWidth: -1 }));

        console.log(`[SAVE SERVER] ✅ Wrote ${commonPath} and ${outPath}`);
        // Saving may create a new scene directory; keep the manifest live.
        writeSceneManifest();
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end('Error');
      }
    });
  } else if (req.method === 'POST' && pathname === '/save-cameras') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const outPath = resolveSceneCamerasPath(sceneName);
      console.log(`[SAVE SERVER] POST /save-cameras (scene=${sceneName || 'default'}). Body: ${body.length} bytes`);
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, body);
        console.log(`[SAVE SERVER] ✅ Wrote ${outPath}`);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end('Error');
      }
    });
  } else if (req.method === 'POST' && req.url === '/save-stl') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[SAVE SERVER] Received POST /save-stl. Body length: ${body.length}`);
      try {
        const payload = JSON.parse(body);
        const { filename, stlData } = payload;
        if (!filename || !stlData) throw new Error('Missing filename or stlData');
        const safeName = filename.replace(/[^a-z0-9_.-]/gi, '_');
        const outPath = path.join(SIM_ROOT, 'assets', safeName);
        fs.writeFileSync(outPath, stlData);
        console.log(`[SAVE SERVER] Successfully wrote to ${outPath}`);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end('Error');
      }
    });
  } else if (req.method === 'POST' && req.url === '/save-pattern') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, code } = JSON.parse(body);
        if (!name || typeof code !== 'string') throw new Error('Missing name or code');
        const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
        const outPath = path.join(ENGINE_ROOT, 'patterns', safeName + '.js');
        fs.mkdirSync(path.join(ENGINE_ROOT, 'patterns'), { recursive: true });
        fs.writeFileSync(outPath, code);
        console.log(`[SAVE SERVER] Saved pattern: ${outPath}`);
        writePatternManifest();
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Pattern save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'POST' && req.url === '/delete-pattern') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) throw new Error('Missing name');
        const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
        const filePath = path.join(ENGINE_ROOT, 'patterns', safeName + '.js');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[SAVE SERVER] Deleted pattern: ${filePath}`);
          writePatternManifest();
          res.end('Deleted');
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      } catch (e) {
        console.error(`[SAVE SERVER] Pattern delete error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'GET' && req.url === '/list-patterns') {
    // The simulation client now reads the static manifest directly, but we
    // keep this endpoint for ad-hoc tooling. Source of truth is listPatterns().
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listPatterns()));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else if (req.method === 'POST' && pathname === '/save-model') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        if (!sceneName) {
          res.writeHead(400);
          res.end('Missing scene parameter');
          return;
        }
        // Determine model filename based on active scene. `type` picks
        // the companion file: effects (foggers/horns) or viewmasks (the
        // group→bit + named-views sidecar the engine validates against).
        // Scene name is sanitized exactly like the /save endpoint — a
        // raw query param must never become a path segment.
        const safeScene = sceneName.replace(/[^a-z0-9_-]/gi, '_');
        const type = parsedUrl.searchParams.get('type');
        const suffix = type === 'effects' ? '.effects.js'
          : type === 'viewmasks' ? '.viewmasks.js'
          : '.js';
        const modelFilename = `${safeScene}${suffix}`;
        const outDir = path.join(ENGINE_ROOT, 'models');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, modelFilename);
        writeFileAtomic(outPath, body);

        console.log(`[Save] Wrote model data to ${outPath}`);
        res.writeHead(200);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Model save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'GET' && pathname === '/list-scenes') {
    // The simulation client now reads the static manifest directly, but we
    // keep this endpoint for ad-hoc tooling. Source of truth is listScenes().
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listScenes()));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(SAVE_PORT, () => console.log(`Save server listening on ${SAVE_PORT}`));

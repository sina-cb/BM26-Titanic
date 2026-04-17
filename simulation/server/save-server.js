const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Resolve paths relative to the simulation root (parent of server/)
const SIM_ROOT = path.join(__dirname, '..');
const ENGINE_ROOT = path.join(SIM_ROOT, '..', 'marsin_engine');
const SCENES_ROOT = path.join(SIM_ROOT, 'config', 'scenes');

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

// Read port from server_config.yaml
const serverConfig = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'config', 'server_config.yaml'), 'utf8'));
const SAVE_PORT = serverConfig.save_port || 6970;

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
        if (configTree && configTree.parLights && Array.isArray(configTree.parLights.fixtures)) {
          const patches = { patches: {} };
          configTree.parLights.fixtures.forEach(fixture => {
            const name = fixture.name;
            if (name) {
              patches.patches[name] = {
                controllerIp: fixture.controllerIp,
                dmxUniverse: fixture.dmxUniverse,
                dmxAddress: fixture.dmxAddress,
                controllerId: fixture.controllerId,
                sectionId: fixture.sectionId,
                fixtureId: fixture.fixtureId,
                viewMask: fixture.viewMask,
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

          // Write extracted patches.yaml
          fs.writeFileSync(patchesPath, yaml.dump(patches, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${patchesPath}`);
          
          // Re-serialize the cleaned structural tree
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Write cleaned scene_config.yaml
        fs.writeFileSync(outPath, body);
        console.log(`[SAVE SERVER] ✅ Wrote ${outPath}`);
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
        const outPath = path.join(SIM_ROOT, 'models', safeName);
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
        const outPath = path.join(SIM_ROOT, 'patterns', safeName + '.js');
        fs.mkdirSync(path.join(SIM_ROOT, 'patterns'), { recursive: true });
        fs.writeFileSync(outPath, code);
        console.log(`[SAVE SERVER] Saved pattern: ${outPath}`);
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
        const filePath = path.join(SIM_ROOT, 'patterns', safeName + '.js');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[SAVE SERVER] Deleted pattern: ${filePath}`);
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
    try {
      const patternsDir = path.join(ENGINE_ROOT, 'patterns');
      const files = fs.existsSync(patternsDir) ? fs.readdirSync(patternsDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')) : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(files));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else if (req.method === 'POST' && pathname === '/save-model') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        // Determine model filename based on active scene
        const modelFilename = sceneName ? `${sceneName}.js` : 'model.js';
        const outDir = path.join(ENGINE_ROOT, 'models');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, modelFilename);
        fs.writeFileSync(outPath, body);
        // Also keep a copy in simulation for backward compat
        const simModelDir = path.join(SIM_ROOT, 'patterns', 'model');
        fs.mkdirSync(simModelDir, { recursive: true });
        fs.writeFileSync(path.join(simModelDir, 'model.js'), body);
        console.log(`[SAVE SERVER] Saved model: ${outPath} (${body.length} bytes)`);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Model save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'GET' && pathname === '/list-scenes') {
    try {
      const scenes = [];
      if (fs.existsSync(SCENES_ROOT)) {
        for (const entry of fs.readdirSync(SCENES_ROOT, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const cfgPath = path.join(SCENES_ROOT, entry.name, 'scene_config.yaml');
            if (fs.existsSync(cfgPath)) {
              scenes.push(entry.name);
            }
          }
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(scenes));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(SAVE_PORT, () => console.log(`Save server listening on ${SAVE_PORT}`));

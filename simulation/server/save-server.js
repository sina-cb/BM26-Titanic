const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Resolve paths relative to the simulation root (parent of server/)
const SIM_ROOT = path.join(__dirname, '..');

// Read port from server_config.yaml
const serverConfig = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'config', 'server_config.yaml'), 'utf8'));
const SAVE_PORT = serverConfig.save_port || 8181;

// Read sACN config from scene_config.yaml
let sacnConfig = {};
try {
  const sceneConfig = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'config', 'scene_config.yaml'), 'utf8'));
  if (sceneConfig && sceneConfig.sacn) {
    const s = sceneConfig.sacn;
    sacnConfig = {
      enabled: s.enabled && (typeof s.enabled === 'object' ? s.enabled.value : s.enabled),
      universes: s.universes ? String(typeof s.universes === 'object' ? s.universes.value : s.universes)
        .split(',').map(u => parseInt(u.trim(), 10)).filter(u => !isNaN(u)) : [1, 2, 3, 4],
      lockoutMs: s.lockout_ms ? (typeof s.lockout_ms === 'object' ? s.lockout_ms.value : s.lockout_ms) : 10000,
      highPriorityThreshold: s.high_priority_threshold ? (typeof s.high_priority_threshold === 'object' ? s.high_priority_threshold.value : s.high_priority_threshold) : 150,
      sourceStaleMs: s.source_stale_ms ? (typeof s.source_stale_ms === 'object' ? s.source_stale_ms.value : s.source_stale_ms) : 2000,
    };
  }
} catch (e) {
  console.warn('[Save Server] Could not read sACN config from scene_config.yaml:', e.message);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[SAVE SERVER] Received POST /save. Body length: ${body.length}`);
      console.log(`[SAVE SERVER] Preview: ${body.substring(0, 100)}...`);
      try {
        fs.writeFileSync(path.join(SIM_ROOT, 'config', 'scene_config.yaml'), body);
        console.log(`[SAVE SERVER] Successfully wrote to config/scene_config.yaml`);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end('Error');
      }
    });
  } else if (req.method === 'POST' && req.url === '/save-cameras') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[SAVE SERVER] Received POST /save-cameras. Body length: ${body.length}`);
      try {
        fs.writeFileSync(path.join(SIM_ROOT, 'config', 'scene_preset_cameras.yaml'), body);
        console.log(`[SAVE SERVER] Successfully wrote to config/scene_preset_cameras.yaml`);
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
      const patternsDir = path.join(SIM_ROOT, 'patterns');
      const files = fs.existsSync(patternsDir) ? fs.readdirSync(patternsDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')) : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(files));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else if (req.method === 'POST' && req.url === '/save-model') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const outPath = path.join(SIM_ROOT, 'patterns', 'model', 'model.js');
        fs.mkdirSync(path.join(SIM_ROOT, 'patterns', 'model'), { recursive: true });
        fs.writeFileSync(outPath, body);
        console.log(`[SAVE SERVER] Saved model: ${outPath} (${body.length} bytes)`);
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Model save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else {
    res.statusCode = 404; res.end();
  }
});

server.listen(SAVE_PORT, () => {
  console.log(`Save server listening on ${SAVE_PORT}`);

  // Attach sACN bridge to this HTTP server
  try {
    const { attachSacnBridge } = require('./sacn_bridge');
    attachSacnBridge(server, sacnConfig);
  } catch (err) {
    console.warn(`[Save Server] sACN bridge not available: ${err.message}`);
    console.warn(`[Save Server] Install deps: npm install sacn ws`);
  }
});

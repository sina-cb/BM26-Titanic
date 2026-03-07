const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req, res) => {
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
        fs.writeFileSync(path.join(__dirname, 'scene_config.yaml'), body);
        console.log(`[SAVE SERVER] Successfully wrote to scene_config.yaml`);
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
        fs.writeFileSync(path.join(__dirname, 'scene_preset_cameras.yaml'), body);
        console.log(`[SAVE SERVER] Successfully wrote to scene_preset_cameras.yaml`);
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
        const outPath = path.join(__dirname, 'models', safeName);
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
        const outPath = path.join(__dirname, 'pb', safeName + '.js');
        fs.mkdirSync(path.join(__dirname, 'pb'), { recursive: true });
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
        const filePath = path.join(__dirname, 'pb', safeName + '.js');
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
      const pbDir = path.join(__dirname, 'pb');
      const files = fs.existsSync(pbDir) ? fs.readdirSync(pbDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')) : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(files));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(8181, () => console.log('Save server listening on 8181'));

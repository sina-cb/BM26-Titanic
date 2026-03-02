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
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(8181, () => console.log('Save server listening on 8181'));

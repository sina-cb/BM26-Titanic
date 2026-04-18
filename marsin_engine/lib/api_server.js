import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

// Local utility clones identical to engine.js requirements
function listPatterns(patternsDir) {
  if (!fs.existsSync(patternsDir)) return [];
  return fs.readdirSync(patternsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''));
}

function loadPattern(patternsDir, name) {
  const filePath = path.join(patternsDir, `${name}.js`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Pattern not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function startApiServer(opts, runtime, patternsDir, publishStatsRef) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, PUT, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && (req.url === '/patterns' || req.url === '/list-patterns')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listPatterns(patternsDir)));
    } else if (req.method === 'GET' && req.url === '/exports') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runtime.getExports()));
    } else if (req.method === 'GET' && req.url.startsWith('/pattern-code')) {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const name = urlObj.searchParams.get('name');
      if (!name) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' }));
      }
      const safeName = path.basename(name).endsWith('.js') ? path.basename(name) : path.basename(name) + '.js';
      const filePath = path.join(patternsDir, safeName);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404); return res.end(JSON.stringify({ error: 'pattern not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(fs.readFileSync(filePath, 'utf8'));
    } else if (req.method === 'POST' && req.url === '/save-pattern') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name || !data.code) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'name and code required' }));
          }
          let safeName = path.basename(data.name);
          if (!safeName.endsWith('.js')) safeName += '.js';
          const filePath = path.join(patternsDir, safeName);
          
          const comp = runtime.compile(data.code);
          if (!comp.ok) {
            res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
          }
          
          fs.writeFileSync(filePath, data.code, 'utf8');
          
          // Re-broadcast exports if active pattern was overwritten
          if (opts.pattern === safeName.replace('.js', '')) {
            const exportsBroadcast = JSON.stringify({ type: 'exports', data: runtime.getExports() });
            wss.clients.forEach(c => {
              if (c.readyState === 1) c.send(exportsBroadcast);
            });
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch(e) {
           res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if ((req.method === 'PUT' || req.method === 'POST') && (req.url === '/pattern' || req.url === '/set-pattern')) {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.pattern) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'pattern required' }));
          }
          // The iPad app might send 'test_params.js', so strip the extension
          const patternName = path.basename(data.pattern, '.js');
          
          const src = loadPattern(patternsDir, patternName);
          const comp = runtime.compile(src);
          if (!comp.ok) {
            res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
          }
          opts.pattern = patternName;
          console.log(`\n  ✅ Hot-swapped pattern to ${patternName}`);
          
          const broadcast = JSON.stringify({ type: 'pattern', name: patternName });
          const exportsBroadcast = JSON.stringify({ type: 'exports', data: runtime.getExports() });
          wss.clients.forEach(c => {
            if (c.readyState === 1) {
              c.send(broadcast);
              c.send(exportsBroadcast);
            }
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', pattern: opts.pattern }));
        } catch(e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/control') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.id === undefined) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
          }
          runtime.setControl(data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', id: data.id }));
        } catch(e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'pattern', name: opts.pattern }));
    ws.send(JSON.stringify({ type: 'exports', data: runtime.getExports() }));

    ws.on('message', msg => {
      try {
        const d = JSON.parse(msg);
        if (d.type === 'setControl') {
          runtime.setControl(d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
        }
      } catch(e) {}
    });
  });

  server.listen(opts.port, () => {
    console.log(`\n  🌐 Output Server listening on HTTP/WS port ${opts.port}`);
  });

  // Assign the callback for engine.js to push stats to
  publishStatsRef.publish = (stats) => {
    const statsMsg = JSON.stringify({ type: 'stats', ...stats });
    wss.clients.forEach(c => {
      if (c.readyState === 1) c.send(statsMsg);
    });
  };

  return server;
}

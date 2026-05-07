import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Autopilot } from './autopilot.js';
import { StateManager } from './state_manager.js';

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

export function startApiServer(opts, engineCore, patternsDir, publishStatsRef, intensityController, globalEffectsController) {
  const { mixer, wasmHost, paramRouter, paramCenter } = engineCore;
  const localControlKinds = new Set([1, 2, 3, 6]);

  function onChannelCompiled(channel) {
    if (paramCenter) {
      paramCenter.registerChannel(channel.id, channel.handle, wasmHost.getExports(channel.handle));
      // Force the VM to execute its top-level scope (export var defaults) so that
      // CPC values don't get clobbered by the first real beginFrame.
      wasmHost.beginFrame(channel.handle, 0);
      // We also broadcast so clients know the new schema bindings
      broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
    }
  }

  /**
   * Push current CPC (global) values to a channel as the FINAL step after
   * onChannelCompiled + applyPatternCache + localControls restore.
   * This ensures the latest system color palette, speed, etc. always wins
   * over any saved/cached per-pattern state.
   */
  function finalizeCpcValues(channel) {
    if (paramCenter) {
      paramCenter.applyToChannel(wasmHost, channel.id);
    }
  }

  function broadcastWs(msgObj) {
    if (!global.wss) return;
    const msg = JSON.stringify(msgObj);
    global.wss.clients.forEach(c => {
      if (c.readyState === 1) c.send(msg);
    });
  }

  const stateDir = path.join(patternsDir, '..', 'states', opts.modelName || 'default');
  const stateManager = new StateManager(stateDir);

  let mixerState = stateManager.loadMixerState();
  let deckState = stateManager.loadDeckState();
  let globalsState = stateManager.loadGlobalsState();

  if (paramCenter) {
    paramCenter.saveHook = () => stateManager.saveGlobalsState(globalsState, paramCenter);
  }

  try {
    stateManager.applyGlobalsState(globalsState, paramCenter, intensityController, globalEffectsController);
  } catch (err) {
    console.warn('Failed to apply loaded state:', err);
  }

  // After loading saved CPC values, push them to all boot-created channels.
  // This must happen after the channels have been primed with beginFrame(0)
  // (which onChannelCompiled already does).
  if (paramCenter) paramCenter.applySnapshot(wasmHost);

  function saveAllState() {
    stateManager.saveMixerState(mixer);
    stateManager.saveDeckState(mixer);
  }

  function getReplayableLocalExport(channel, controlId) {
    if (paramCenter && paramCenter.isSharedControlId(channel.id, controlId)) return null;
    const exp = wasmHost.getExports(channel.handle).find(e => e.id === controlId);
    if (!exp || !localControlKinds.has(exp.kind)) return null;
    return exp;
  }

  function applyPatternCache(channel) {
    if (!channel.patternCache) channel.patternCache = {};
    const cached = channel.patternCache[channel.pattern];
    if (!cached) return;

    const exports = wasmHost.getExports(channel.handle);
    const exportIds = new Set(exports.map(e => e.id));
    const exportById = {};
    for (const e of exports) exportById[e.id] = e;

    let applied = 0, stale = 0, cpcBlocked = 0;
    for (const [idStr, v] of Object.entries(cached)) {
      const controlId = parseInt(idStr, 10);

      // Check: does this ID even exist in the current pattern?
      if (!exportIds.has(controlId)) {
        const expName = v._name || idStr;
        console.warn(`[Cache] ⚠ Stale cache entry on ${channel.id}/${channel.pattern}: ID ${expName} (${controlId}) not found in pattern exports — purging`);
        delete cached[idStr];
        stale++;
        continue;
      }

      // Check: is this a CPC-owned control?
      if (!getReplayableLocalExport(channel, controlId)) {
        const exp = exportById[controlId];
        console.warn(`[Cache] ⚠ CPC-owned '${exp?.name || controlId}' found in cache for ${channel.id}/${channel.pattern} — skipping`);
        delete cached[idStr];
        cpcBlocked++;
        continue;
      }

      paramRouter.setChannelControl(channel.id, controlId, v.v0, v.v1, v.v2);
      applied++;
    }

    if (stale > 0 || cpcBlocked > 0) {
      console.warn(`[Cache] ${channel.id}/${channel.pattern}: applied=${applied}, stale=${stale} (purged), cpcBlocked=${cpcBlocked} (skipped)`);
    }
  }

  function updatePatternCache(channel, controlId, v0, v1, v2) {
    if (!channel) return;
    if (!channel.patternCache) channel.patternCache = {};
    if (!channel.patternCache[channel.pattern]) channel.patternCache[channel.pattern] = {};
    channel.patternCache[channel.pattern][controlId] = { v0, v1, v2 };
  }

  function restoreChannel(saved) {
    try {
      const src = loadPattern(patternsDir, saved.pattern);
      const comp = wasmHost.compile(src);
      if (comp.ok) {
        const ch = mixer.addChannel({
          id: saved.id,
          name: saved.name,
          pattern: saved.pattern,
          handle: comp.handle,
          mode: saved.mode,
          fader: saved.fader,
          enabled: saved.enabled
        });
        if (saved.patternCache) ch.patternCache = saved.patternCache;
        onChannelCompiled(ch);
        if (saved.localControls) {
          for (const [idStr, cv] of Object.entries(saved.localControls)) {
            const controlId = parseInt(idStr, 10);
            if (!getReplayableLocalExport(ch, controlId)) continue;
            paramRouter.setChannelControl(ch.id, controlId, cv.v0, cv.v1, cv.v2);
          }
        }
        applyPatternCache(ch);
        // CPC gets the last word — latest color palette, speed, etc. always win
        finalizeCpcValues(ch);
      } else {
        console.warn(`Failed to compile saved channel ${saved.pattern}:`, comp.error);
      }
    } catch (e) {
      console.warn(`Failed to restore channel ${saved.pattern}:`, e.message);
    }
  }

  const hasDeck = deckState.channel != null;
  const hasMixer = mixerState.channels && mixerState.channels.length > 0;

  if (hasDeck || hasMixer) {
    const existingIds = mixer.channels.map(c => c.id);
    for (const id of existingIds) {
      const ch = mixer.getChannel(id);
      if (ch) ch.destroy(wasmHost);
      mixer.removeChannel(id);
    }
    
    if (hasDeck) {
      restoreChannel(deckState.channel);
    } else {
      restoreChannel({
        id: 'ch_base',
        name: 'Base',
        pattern: opts.pattern,
        mode: 'blend_screen',
        fader: 1.0,
        enabled: true
      });
    }

    if (hasMixer) {
      for (const saved of mixerState.channels) {
        if (!saved.id.startsWith('ch_base_')) {
          restoreChannel(saved);
        }
      }
    }
    
    if (mixerState.master !== undefined) {
      mixer.setMaster(mixerState.master);
    }
    
    const base = mixer.getChannel(mixer.baseChannelId);
    if (base) opts.pattern = base.pattern;
  } else {
    mixer.channels.forEach(ch => { applyPatternCache(ch); finalizeCpcValues(ch); });
  }

  // Single source of truth for serializing mixer state — used by
  // GET /mixer, broadcastMixerState(), and WS connect.
  function serializeMixerState() {
    return {
      type: 'mixer',
      blackout: globalsState.blackout,
      master: mixer.master,
      maxChannels: mixer.maxChannels,
      channels: mixer.channels.map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
        fader: c.fader,
        enabled: c.enabled,
        locked: !!c.locked,
        transitionMode: c.transitionMode || 'trans_crossfade',
        transitionTime: c.transitionTime || 1.0,
        exports: wasmHost.getExports(c.handle)
          .filter(e => !(paramCenter && paramCenter.isSharedExport(c.id, e.name)))
          .filter(e => !(paramCenter && paramCenter.getBlockedIds(c.id).has(e.id)))
          .filter(e => localControlKinds.has(e.kind))
          .map(e => {
            const cv = c.localControls[e.id];
            if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
            return e;
          })
      }))
    };
  }

  function broadcastMixerState() {
    broadcastWs(serializeMixerState());
  }

  // Initialize Autopilot Daemon
  const autopilot = new Autopilot(
    listPatterns, 
    patternsDir, 
    () => opts.pattern, 
    async (nextPattern) => {
      try {
        const src = loadPattern(patternsDir, nextPattern);
        const comp = wasmHost.compile(src);
        if (comp.ok) {
           opts.pattern = nextPattern;
           
           // Legacy replacement: swap out the base channel
           const oldBase = mixer.getChannel(mixer.baseChannelId);
           const oldCache = oldBase ? oldBase.patternCache : {};
           if (oldBase) oldBase.destroy(wasmHost);
           mixer.removeChannel(mixer.baseChannelId);
           
           const newChannel = mixer.addChannel({
             id: 'ch_base_' + Date.now(),
             name: 'Base',
             pattern: nextPattern,
             handle: comp.handle,
             mode: 'blend_screen',
             fader: 1.0,
             enabled: true
           });
           
           mixer.channels.pop();
           mixer.channels.unshift(newChannel);
           mixer.baseChannelId = newChannel.id;
           newChannel.patternCache = oldCache;

           onChannelCompiled(newChannel);
           applyPatternCache(newChannel);
           finalizeCpcValues(newChannel);
           saveAllState();
           
           const broadcast = JSON.stringify({ type: 'pattern', name: nextPattern });
           if (global.wss) {
             global.wss.clients.forEach(c => {
               if (c.readyState === 1) c.send(broadcast);
             });
           }
           broadcastMixerState();
        }
      } catch(e) {
        console.warn('Autopilot swap failed:', e.message);
      }
    }
  );

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, PUT, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Body parsing helper
    const readBody = (callback) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          callback(JSON.parse(body || '{}'));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    };

    if (req.method === 'GET' && (req.url === '/patterns' || req.url === '/list-patterns')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listPatterns(patternsDir)));
    } else if (req.method === 'GET' && req.url === '/channel-blends') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const blendsDir = path.join(patternsDir, 'channel_blends');
      try {
        const files = fs.readdirSync(blendsDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
        res.end(JSON.stringify(files));
      } catch (e) {
        res.end(JSON.stringify([]));
      }
    } else if (req.method === 'GET' && req.url === '/transitions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const transitionsDir = path.join(patternsDir, 'transitions');
      try {
        const files = fs.readdirSync(transitionsDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
        res.end(JSON.stringify(files));
      } catch (e) {
        res.end(JSON.stringify([]));
      }
    } else if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        service: 'marsin-engine',
        name: 'MarsinEngine',
        version: '2.0',
        port: opts.port || 6968,
        activeScene: opts.modelName || 'unknown', 
        activeModel: opts.modelName || 'unknown', 
        activePattern: opts.pattern || 'unknown', 
        unrealState: 'streaming' 
      }));
    } else if (req.method === 'GET' && req.url === '/exports') {
      // Legacy endpoint, return exports of base channel
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const baseChannel = mixer.getChannel(mixer.baseChannelId);
      if (!baseChannel) {
        res.end('[]'); return;
      }
      const exports = wasmHost.getExports(baseChannel.handle);
      const filtered = exports.filter(e => !(paramCenter && paramCenter.isSharedExport(baseChannel.id, e.name)));
      res.end(JSON.stringify(filtered));
    } else if (req.method === 'GET' && req.url.startsWith('/pattern-code')) {
      const name = req.url.split('?name=')[1];
      if (!name) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' })); }
      let safeName = path.basename(name);
      if (!safeName.endsWith('.js')) safeName += '.js';
      const filePath = path.join(patternsDir, safeName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(fs.readFileSync(filePath, 'utf8'));
      } else {
        res.writeHead(404); res.end('Not Found');
      }
    } else if (req.method === 'POST' && req.url === '/save-pattern') {
      readBody(data => {
        if (!data.name || !data.code) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'name and code required' }));
        }
        let safeName = path.basename(data.name);
        if (!safeName.endsWith('.js')) safeName += '.js';
        const filePath = path.join(patternsDir, safeName);
        
        // Compile check (does not destroy existing running patterns because of WasmHost!)
        const comp = wasmHost.compile(data.code);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        wasmHost.destroy(comp.handle); // Clean up validation handle
        
        fs.writeFileSync(filePath, data.code, 'utf8');
        
        const patternName = safeName.replace('.js', '');
        mixer.channels.forEach(ch => {
          if (ch.pattern === patternName) {
            const compNew = wasmHost.compile(data.code);
            if (compNew.ok) {
              if (ch.handle) wasmHost.destroy(ch.handle);
              ch.handle = compNew.handle;
              onChannelCompiled(ch);
              applyPatternCache(ch);
              finalizeCpcValues(ch);
            }
          }
        });
        
        stateManager.saveMixerState(mixer);
        stateManager.saveDeckState(mixer);
        broadcastMixerState();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if ((req.method === 'PUT' || req.method === 'POST') && (req.url === '/pattern' || req.url === '/set-pattern')) {
      readBody(data => {
        if (!data.pattern) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'pattern required' }));
        }
        const patternName = path.basename(data.pattern, '.js');
        const src = loadPattern(patternsDir, patternName);
        const comp = wasmHost.compile(src);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        
        // Legacy set-pattern replaces the base channel
        const oldBase = mixer.getChannel(mixer.baseChannelId);
        const oldCache = oldBase ? oldBase.patternCache : {};
        if (oldBase) oldBase.destroy(wasmHost);
        mixer.removeChannel(mixer.baseChannelId);
        
        const newChannel = mixer.addChannel({
          id: 'ch_base_' + Date.now(),
          name: 'Base',
          pattern: patternName,
          handle: comp.handle,
          mode: 'blend_screen',
          fader: 1.0,
          enabled: true
        });

        // Ensure the deck channel is at the bottom of the stack and tracked correctly
        mixer.channels.pop();
        mixer.channels.unshift(newChannel);
        mixer.baseChannelId = newChannel.id;
        newChannel.patternCache = oldCache;

        opts.pattern = patternName;
        onChannelCompiled(newChannel);
        applyPatternCache(newChannel);
        finalizeCpcValues(newChannel);
        saveAllState();
        
        const broadcast = JSON.stringify({ type: 'pattern', name: patternName });
        if (global.wss) {
          global.wss.clients.forEach(c => {
            if (c.readyState === 1) c.send(broadcast);
          });
        }
        broadcastMixerState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', pattern: opts.pattern }));
      });
    } else if (req.method === 'POST' && req.url === '/control') {
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        const result = paramRouter.setControl(data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        
        if (result.status === 'ok') {
          const baseChannel = mixer.getChannel(mixer.baseChannelId);
          if (baseChannel) updatePatternCache(baseChannel, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        }

        saveAllState();
        broadcastMixerState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', id: data.id }));
      });
    } else if (req.method === 'GET' && req.url === '/dimmers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalsState.dimmers || {}));
    } else if (req.method === 'POST' && req.url === '/section-brightness') {
      readBody(data => {
        if (data.sectionId === undefined || data.brightness === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'sectionId and brightness required' }));
        }
        if (intensityController) intensityController.setSectionBrightness(data.sectionId, data.brightness);
        if (!globalsState.dimmers) globalsState.dimmers = {};
        globalsState.dimmers[data.sectionId] = data.brightness;
        stateManager.saveGlobalsState(globalsState);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sectionId: data.sectionId, brightness: data.brightness }));
      });
    } else if (req.method === 'POST' && req.url === '/global-blackout') {
      readBody(data => {
        if (data.state === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'state boolean required' }));
        }
        if (intensityController) intensityController.setBlackout(data.state);
        globalsState.blackout = data.state;
        stateManager.saveGlobalsState(globalsState);
        broadcastMixerState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', blackoutActive: data.state }));
      });
    } else if (req.method === 'POST' && req.url === '/global-effect') {
      readBody(data => {
        if (data.effect === undefined || data.state === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'effect string and state boolean required' }));
        }
        if (globalEffectsController) globalEffectsController.setEffect(data.effect, data.state);
        if (!globalsState.effects) globalsState.effects = {};
        globalsState.effects[data.effect] = data.state;
        stateManager.saveGlobalsState(globalsState);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', effect: data.effect, state: data.state }));
      });
    } else if (req.method === 'GET' && req.url === '/globals') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalsState));
    } else if (req.method === 'GET' && req.url === '/autopilot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(autopilot.state));
    } else if (req.method === 'POST' && req.url === '/autopilot') {
      readBody(data => {
        autopilot.updateState(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(autopilot.state));
      });
    } 
    // ---- MIXER API ----
    else if (req.method === 'GET' && req.url === '/mixer') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serializeMixerState()));
    } else if (req.method === 'PATCH' && req.url === '/mixer') {
      readBody(data => {
        if (data.master !== undefined) mixer.setMaster(data.master);
        stateManager.saveMixerState(mixer);
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/channels') {
      readBody(data => {
        const patternName = path.basename(data.pattern, '.js');
        const src = loadPattern(patternsDir, patternName);
        const comp = wasmHost.compile(src);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        const channel = mixer.addChannel({
          id: 'ch_' + Date.now(),
          name: data.name || 'New Layer',
          pattern: patternName,
          handle: comp.handle,
          mode: data.mode || 'blend_screen',
          fader: data.fader !== undefined ? data.fader : 1.0,
          enabled: true
        });
        onChannelCompiled(channel);
        applyPatternCache(channel);
        finalizeCpcValues(channel);
        stateManager.saveMixerState(mixer);
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', channelId: channel.id }));
      });
    } else if (req.method === 'PATCH' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        const channel = mixer.getChannel(id);
        if (!channel) { res.writeHead(404); return res.end(); }
        if (data.name !== undefined) channel.name = data.name;
        if (data.mode !== undefined) channel.mode = data.mode;
        if (data.fader !== undefined) channel.fader = data.fader;
        if (data.enabled !== undefined) channel.enabled = data.enabled;
        if (data.transitionMode !== undefined) channel.transitionMode = data.transitionMode;
        if (data.transitionTime !== undefined) channel.transitionTime = data.transitionTime;
        if (data.locked !== undefined) channel.locked = !!data.locked;
        // Pattern swap: recompile WASM, swap handle, preserve channel ID
        if (data.pattern !== undefined && data.pattern !== channel.pattern) {
          const patternName = path.basename(data.pattern, '.js');
          const src = loadPattern(patternsDir, patternName);
          const comp = wasmHost.compile(src);
          if (comp.ok) {
            // Destroy old handle
            if (channel.handle) wasmHost.destroy(channel.handle);
            channel.handle = comp.handle;
            channel.pattern = patternName;
            channel.localControls = {};
            onChannelCompiled(channel);
            applyPatternCache(channel);
            finalizeCpcValues(channel);
          } else {
            console.warn(`[Mixer] Pattern swap FAILED: ${patternName} compile error:`, comp.error);
          }
        }
        stateManager.saveMixerState(mixer);
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      if (paramCenter) paramCenter.unregisterChannel(id);
      mixer.removeChannel(id);
      stateManager.saveMixerState(mixer);
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/control$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        const result = paramRouter.setChannelControl(id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        if (result.status === 'ok') {
          const channel = mixer.getChannel(id);
          if (channel) updatePatternCache(channel, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url.match(/\/mixer\/view/)) {
      readBody(data => {
        if (data.view === 'deck') mixer.targetViewFader = 0.0;
        else if (data.view === 'mixer') mixer.targetViewFader = 1.0;
        // Allow the deck to focus on a specific channel for preview
        if (data.deckChannel !== undefined) {
          mixer.deckFocusChannelId = data.deckChannel || null;
        }
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'GET' && req.url === '/param-center/schema') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getSchema() : []));
    } else if (req.method === 'GET' && req.url === '/param-center') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getCanonicalState() : {}));
    } else if (req.method === 'POST' && req.url === '/param-center') {
      readBody(data => {
        if (!paramCenter) return res.end('{}');
        let rev = 0;
        for (const k in data) {
          const r = paramCenter.set(k, data[k], 'api');
          if (r.status === 'ok') rev = r.revision;
        }
        paramCenter.applySnapshot(wasmHost);
        paramCenter.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', revision: rev }));
        broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
      });
    } else if (req.method === 'POST' && req.url === '/param-center/source-lock') {
      readBody(data => {
        if (paramCenter) paramCenter.setSourceLock(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sourceLock: paramCenter ? paramCenter.getSourceLock() : null }));
        broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
      });
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  });

  const wss = new WebSocketServer({ server });
  
  wss.on('error', (e) => {
    // catch wss errors to prevent crash
    console.warn('WebSocketServer error:', e.message);
  });
  
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  ❌ Port ${opts.port} is already in use by another process.`);
      process.exit(1);
    } else {
      console.error('Server error:', e);
    }
  });
  global.wss = wss; 
  autopilot.start();

  wss.on('connection', ws => {
    // Send full state on connect — uses shared serializer
    ws.send(JSON.stringify(serializeMixerState()));

    if (paramCenter) {
      ws.send(JSON.stringify({ type: 'sharedParams', ...paramCenter.getCanonicalState() }));
    }

    ws.on('message', msg => {
      try {
        const d = JSON.parse(msg);
        if (d.type === 'setControl' && d.id !== undefined) {
          const result = paramRouter.setControl(d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          if (result.status === 'ok') {
            const baseChannel = mixer.getChannel(mixer.baseChannelId);
            if (baseChannel) updatePatternCache(baseChannel, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          }
          stateManager.saveMixerState(mixer);
          broadcastMixerState();
        } else if (d.type === 'setChannelControl' && d.channelId && d.id !== undefined) {
          const result = paramRouter.setChannelControl(d.channelId, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          if (result.status === 'ok') {
            const channel = mixer.getChannel(d.channelId);
            if (channel) updatePatternCache(channel, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          }
          stateManager.saveMixerState(mixer);
          broadcastMixerState();
        } else if (d.type === 'setChannelFader' && d.channelId && d.fader !== undefined) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            channel.fader = d.fader;
            // No broadcast — fader-only updates during transitions are high-frequency.
            // The engine applies the value immediately; full state syncs on completion.
          }
        } else if (d.type === 'setChannelMode' && d.channelId && d.mode) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            channel.mode = d.mode;
            // Pre-compile the blend handle so first frame isn't skipped
            mixer.getBlendHandle(d.mode);
            // No save/broadcast — mode changes during transitions are transient.
            // State is persisted explicitly via 'saveMixerState' at transition end.
          }
        } else if (d.type === 'setChannelEnabled' && d.channelId !== undefined) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            channel.enabled = !!d.enabled;
            // No broadcast — enabled toggles during transition setup are batched.
          }
        } else if (d.type === 'saveMixerState') {
          // Explicit save + broadcast — called once at transition completion
          stateManager.saveMixerState(mixer);
          broadcastMixerState();
        } else if (d.type === 'setSharedParam') {
          if (!paramCenter) return;
          const res = paramCenter.set(d.key, d.value, 'ws', d.origin);
          if (res.status === 'ignored') {
            ws.send(JSON.stringify({ type: 'paramRejected', key: d.key, reason: res.reason, lockedTo: res.lockedTo }));
          } else {
            paramCenter.applySnapshot(wasmHost);
            paramCenter.save();
            broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
          }
        }
      } catch(e) {}
    });
  });

  server.listen(opts.port, () => {
    console.log(`\n  🌐 Output Server listening on HTTP/WS port ${opts.port}`);
  });

  publishStatsRef.publish = (data) => {
    // Vis data has its own type
    const msg = data.type === 'vis'
      ? JSON.stringify(data)
      : JSON.stringify({ type: 'stats', ...data });
    wss.clients.forEach(c => {
      if (c.readyState === 1) c.send(msg);
    });
  };

  return server;
}

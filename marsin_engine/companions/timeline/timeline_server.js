/*
 * timeline_server.js — the Timeline Companion PROCESS (the "show director").
 * A server-side, engine-supervised subprocess (docs/38 §2.1): same uptime as
 * the engine, independent of any iPad, fires cues whether or not a CaptainPad
 * is connected. It serves a standalone monitor UI (HTTP + /ws) and runs a 1 Hz
 * tick loop that evaluates triggers (triggers.js, pure) and dispatches actions
 * (actions.js) against the engine (engine_link.js).
 *
 * It comes UP and WAITS for the engine — it must NEVER crash when the engine is
 * absent (codex P0 offline/resilience). Scene is from --scene or discovered via
 * the engine /status; until known the UI shows "waiting for engine".
 *
 * Standalone: `node companions/timeline/timeline_server.js [--port 6965] [--scene <name>]`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

import { computeSunEvents, formatLocal } from './sun.js';
import { loadShowPlan, saveShowPlan, defaultShowPlan } from './show_plan.js';
import { resolveDayTimes, evaluateTick, activePhase, dayKeyFor } from './triggers.js';
import { loadTimelineConfig } from './timeline_config.js';
import { loadTimelineState, saveTimelineState } from './timeline_state.js';
import { EngineLink } from './engine_link.js';
import { applyAction } from './actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.yaml');

const SUN_RIBBON_EVENTS = [
  'sunrise', 'goldenHourEnd', 'solarNoon', 'goldenHourStart',
  'sunset', 'civilDusk', 'nauticalDusk', 'sunrise',
];

// ── argv ───────────────────────────────────────────────────────────────────
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const cfg = loadTimelineConfig();
const PORT = (() => {
  const v = argValue('--port');
  return v ? parseInt(v, 10) : cfg.port;
})();
const SCENE_ARG = argValue('--scene');

// ── runtime singletons ───────────────────────────────────────────────────────
let scene = null;              // resolved scene name (null until known)
let sceneDir = null;           // simulation/scenes/<scene>/timeline/
let stateDir = null;           // marsin_engine/states/<scene>/
let plan = null;               // active show plan
let state = null;              // runtime timeline state
let lastStateJson = '';        // throttle persistence (only on change)
let bootError = null;          // last boot-phase error surfaced to the UI
let lastError = null;          // last dispatch-phase error surfaced to the UI
const cueErrors = {};          // cueId → last error string
const recentFires = [];        // ring of { cueId, atMs, reason }
const RECENT_MAX = 30;

// Sun-events cache keyed by dayKey (recomputed once per calendar day).
let sunCache = { dayKey: null, events: null };

const clients = new Set();
function broadcast(obj) {
  const m = JSON.stringify(obj);
  for (const c of clients) if (c.readyState === 1) c.send(m);
}

// ── engine link ──────────────────────────────────────────────────────────────
const engineLink = new EngineLink({
  host: cfg.engine.host,
  port: cfg.engine.port,
  moodKey: cfg.mood.key,
  partyThreshold: cfg.mood.partyThreshold,
  onMood: () => { /* read on each tick via engineLink.mood(); no per-frame work */ },
  onStatus: (connected) => {
    if (state) broadcastState();
    console.log(`  🔗 engine link ${connected ? 'UP' : 'DOWN'} → ${cfg.engine.host}:${cfg.engine.port}`);
  },
});
engineLink.start();

// ── sun / day-time helpers ────────────────────────────────────────────────────
function sunEventsFor(now) {
  const tz = plan.location.tz;
  const dayKey = dayKeyFor(now, tz);
  if (sunCache.dayKey !== dayKey) {
    sunCache = {
      dayKey,
      events: computeSunEvents({ lat: plan.location.lat, lon: plan.location.lon, date: new Date(now) }),
    };
  }
  return sunCache.events;
}

function cueLabel(cue) {
  return cue.label || cue.id;
}

function triggerSummary(t) {
  switch (t.type) {
    case 'clock': return `clock ${t.at}`;
    case 'sun': return `${t.event}${t.offsetMin ? (t.offsetMin > 0 ? `+${t.offsetMin}m` : `${t.offsetMin}m`) : ''}`;
    case 'phase': return `phase ${t.phase}`;
    case 'mood': return `mood ${t.from}→${t.to}`;
    case 'manual': return 'manual';
    default: return t.type;
  }
}

// ── timelineState broadcast ───────────────────────────────────────────────────
function buildTimelineState() {
  const now = Date.now();
  if (!plan || !state) {
    return {
      type: 'timelineState',
      mode: 'armed', scene: scene, activePlan: cfg.activePlan,
      currentPhase: null, currentMood: 'calm', party: 0, moodValue: 0,
      engineConnected: engineLink.connected,
      waiting: true, nextCue: null,
      sun: {}, phases: {}, cues: [], recentFires: [],
      lastError: bootError || lastError,
    };
  }

  const sunEvents = sunEventsFor(now);
  const dayTimes = resolveDayTimes({ plan, now, sunEvents });
  const phaseNow = activePhase({ plan, now, dayTimes });
  const mood = engineLink.mood();

  // Sun ribbon: HH:MM local for each named event we have.
  const sun = {};
  const tz = plan.location.tz;
  for (const name of SUN_RIBBON_EVENTS) {
    const d = sunEvents[name];
    if (d instanceof Date) sun[name] = formatLocal(d, tz);
  }

  // Phase windows as HH:MM local.
  const phases = {};
  for (const [name, win] of Object.entries(dayTimes.phases)) {
    phases[name] = {
      start: win.startMs !== null ? formatLocal(new Date(win.startMs), tz) : null,
      end: win.endMs !== null ? formatLocal(new Date(win.endMs), tz) : null,
    };
  }

  // Cue rows + next upcoming clock/sun cue today.
  const cues = [];
  let nextCue = null;
  for (const cue of plan.cues) {
    const fireMs = dayTimes.cueTimes[cue.id];
    let nextInSec = null;
    if (typeof fireMs === 'number' && fireMs > now && cue.enabled !== false) {
      nextInSec = Math.round((fireMs - now) / 1000);
      if (nextCue === null || nextInSec < nextCue.inSec) {
        nextCue = { id: cue.id, label: cueLabel(cue), inSec: nextInSec };
      }
    }
    cues.push({
      id: cue.id,
      label: cueLabel(cue),
      trigger: triggerSummary(cue.trigger),
      enabled: cue.enabled !== false,
      nextInSec,
      lastError: cueErrors[cue.id] || null,
    });
  }

  const holding = typeof state.manualHoldUntilMs === 'number' && state.manualHoldUntilMs > now;
  const mode = holding ? 'holding' : state.mode;

  return {
    type: 'timelineState',
    mode,
    scene,
    activePlan: state.activePlan || cfg.activePlan,
    currentPhase: phaseNow,
    currentMood: mood.party ? 'party' : 'calm',
    party: mood.party,
    moodValue: mood.value,
    engineConnected: engineLink.connected,
    waiting: false,
    nextCue,
    sun,
    phases,
    cues,
    recentFires: recentFires.slice(-RECENT_MAX),
    lastError: bootError || lastError,
  };
}

function broadcastState() {
  broadcast(buildTimelineState());
}

// ── dispatch one cue's action ─────────────────────────────────────────────────
async function dispatchCue(cueId, reason) {
  const cue = plan.cues.find((c) => c.id === cueId);
  if (!cue) throw new Error(`cue "${cueId}" not in active plan`);
  const result = await applyAction({ action: cue.action, plan, engineLink, configPath: CONFIG_PATH });
  delete cueErrors[cueId];
  state.lastFiredCueId = cueId;
  state.lastFiredAtMs = Date.now();
  recentFires.push({ cueId, atMs: Date.now(), reason });
  if (recentFires.length > RECENT_MAX) recentFires.shift();
  return result;
}

// ── catchUp on boot ───────────────────────────────────────────────────────────
// Among enabled clock/sun cues whose resolved time today already passed and
// whose action is look/playlist and catchUp !== false, fire the one with the
// LATEST passed time (restore the right look after a restart). Mark ALL passed
// clock/sun cues as firedToday so they don't re-fire on the next tick.
async function catchUp() {
  const now = Date.now();
  const sunEvents = sunEventsFor(now);
  const dayTimes = resolveDayTimes({ plan, now, sunEvents });
  const dayKey = dayKeyFor(now, plan.location.tz);
  if (!state.firedToday) state.firedToday = {};
  state.dayKey = dayKey;

  let best = null;
  for (const cue of plan.cues) {
    if (cue.enabled === false) continue;
    const t = cue.trigger;
    if (t.type !== 'clock' && t.type !== 'sun') continue;
    const fireMs = dayTimes.cueTimes[cue.id];
    if (typeof fireMs !== 'number' || fireMs > now) continue;
    // This cue's time already passed today — latch it so the tick loop won't
    // re-fire it.
    state.firedToday[cue.id] = dayKey;
    const restorable = (cue.action.type === 'look' || cue.action.type === 'playlist') && cue.catchUp !== false;
    if (restorable && (best === null || fireMs > best.fireMs)) {
      best = { cue, fireMs };
    }
  }

  if (best) {
    try {
      const result = await dispatchCue(best.cue.id, 'catchUp');
      console.log(`  ⏪ catchUp restored "${best.cue.id}": ${result.steps.join('; ')}`);
    } catch (e) {
      cueErrors[best.cue.id] = `catchUp failed: ${e && e.message}`;
      bootError = `catchUp "${best.cue.id}": ${e && e.message}`;
      console.warn(`  ⚠ catchUp "${best.cue.id}" failed: ${e && e.message}`);
    }
  }
  saveTimelineState(state, stateDir);
  lastStateJson = JSON.stringify(state);
}

// ── scene resolution + plan/state load ────────────────────────────────────────
async function resolveScene() {
  if (SCENE_ARG) return SCENE_ARG;
  // Poll the engine /status until it answers. The server is already UP and the
  // UI shows "waiting for engine" until this resolves.
  for (;;) {
    try {
      const status = await engineLink.getStatus();
      const s = status && (status.activeScene || status.scene);
      if (typeof s === 'string' && s) return s;
    } catch {
      // engine not up yet — keep the UI alive and retry.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function loadSceneFiles(name) {
  scene = name;
  sceneDir = path.join(REPO_ROOT, 'simulation', 'scenes', name, 'timeline');
  stateDir = path.join(__dirname, '..', '..', 'states', name);
  if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });
  const planPath = path.join(sceneDir, `${cfg.activePlan}.yaml`);
  if (!fs.existsSync(planPath)) {
    // A fresh scene must be runnable — write the default plan.
    saveShowPlan(defaultShowPlan(), planPath);
    console.log(`  📝 wrote default plan → ${planPath}`);
  }
  plan = loadShowPlan(planPath);
  state = loadTimelineState(stateDir);
  if (!state.activePlan) state.activePlan = cfg.activePlan;
}

// Switch to a different plan name in the scene dir (reload + re-run catchUp).
async function activatePlan(name) {
  const planPath = path.join(sceneDir, `${name}.yaml`);
  if (!fs.existsSync(planPath)) throw new Error(`plan "${name}" not found in ${sceneDir}`);
  plan = loadShowPlan(planPath);
  state.activePlan = name;
  // Reset the day latch so cues for the new plan can resolve fresh.
  state.firedToday = {};
  await catchUp();
  broadcastState();
}

function listPlanNames() {
  if (!sceneDir || !fs.existsSync(sceneDir)) return [];
  return fs.readdirSync(sceneDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''));
}

// ── the tick loop ──────────────────────────────────────────────────────────────
async function tick() {
  if (!plan || !state) return;
  const now = Date.now();
  const sunEvents = sunEventsFor(now);
  const dayTimes = resolveDayTimes({ plan, now, sunEvents });
  const mood = engineLink.mood();

  const { fires, state: nextState } = evaluateTick({ now, plan, state, mood, dayTimes });
  state = nextState;
  state.currentMood = mood.party ? 'party' : 'calm';

  const holding = typeof state.manualHoldUntilMs === 'number' && state.manualHoldUntilMs > now;
  const suppressed = state.mode === 'paused' || state.mode === 'overridden' || holding;

  for (const fire of fires) {
    if (suppressed) {
      // Record as "would fire" — visible, never silently dispatched.
      broadcast({ type: 'wouldFire', cueId: fire.cueId, reason: fire.reason, mode: state.mode, holding });
      continue;
    }
    try {
      const result = await dispatchCue(fire.cueId, fire.reason);
      lastError = null;
      console.log(`  ▶ fired "${fire.cueId}" (${fire.reason}): ${result.steps.join('; ')}`);
    } catch (e) {
      cueErrors[fire.cueId] = `${e && e.message}`;
      lastError = `cue "${fire.cueId}": ${e && e.message}`;
      console.warn(`  ⚠ cue "${fire.cueId}" failed: ${e && e.message}`);
      // Never crash the loop on a dispatch failure (codex P0 fail loud, but
      // keep ticking — the failure is surfaced, not fatal).
    }
  }

  // Throttle-persist: only write when the state actually changed.
  const json = JSON.stringify(state);
  if (json !== lastStateJson) {
    saveTimelineState(state, stateDir);
    lastStateJson = json;
  }

  broadcastState();
}

// ── HTTP + WS server ──────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }   // null signals a bad JSON body
    });
  });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }

  // Launcher probe + UI bootstrap.
  if (p === '/' || p === '/health') {
    if (p === '/health') { sendJson(res, 200, { ok: true, scene, ready: !!plan }); return true; }
    return false;   // '/' falls through to static index.html
  }

  if (p === '/state') {
    sendJson(res, 200, buildTimelineState());
    return true;
  }

  if (p === '/plans' && method === 'GET') {
    sendJson(res, 200, { plans: listPlanNames() });
    return true;
  }

  const planMatch = /^\/plans\/([a-z0-9][a-z0-9_-]*)$/.exec(p);
  if (planMatch && method === 'GET') {
    const name = planMatch[1];
    const planPath = path.join(sceneDir, `${name}.yaml`);
    if (!fs.existsSync(planPath)) { sendJson(res, 404, { error: `plan "${name}" not found` }); return true; }
    sendJson(res, 200, loadShowPlan(planPath));
    return true;
  }

  if (p === '/plan/activate' && method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body.name !== 'string') { sendJson(res, 400, { error: 'body { name } required' }); return true; }
    try { await activatePlan(body.name); sendJson(res, 200, { ok: true, activePlan: body.name }); }
    catch (e) { sendJson(res, 400, { error: `${e && e.message}` }); }
    return true;
  }

  if (p === '/mode' && method === 'POST') {
    const body = await readBody(req);
    if (!body || (body.mode !== 'armed' && body.mode !== 'paused')) {
      sendJson(res, 400, { error: 'body { mode: armed | paused } required' });
      return true;
    }
    state.mode = body.mode;
    if (body.mode === 'armed') state.manualHoldUntilMs = null;
    saveTimelineState(state, stateDir);
    lastStateJson = JSON.stringify(state);
    broadcastState();
    sendJson(res, 200, { ok: true, mode: state.mode });
    return true;
  }

  if (p === '/hold' && method === 'POST') {
    const body = await readBody(req);
    const minutes = body && Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) { sendJson(res, 400, { error: 'body { minutes > 0 } required' }); return true; }
    state.manualHoldUntilMs = Date.now() + minutes * 60000;
    saveTimelineState(state, stateDir);
    lastStateJson = JSON.stringify(state);
    broadcastState();
    sendJson(res, 200, { ok: true, manualHoldUntilMs: state.manualHoldUntilMs });
    return true;
  }

  if (p === '/resume' && method === 'POST') {
    state.mode = 'armed';
    state.manualHoldUntilMs = null;
    saveTimelineState(state, stateDir);
    lastStateJson = JSON.stringify(state);
    broadcastState();
    sendJson(res, 200, { ok: true, mode: state.mode });
    return true;
  }

  const fireMatch = /^\/cues\/([a-z0-9][a-z0-9_-]*)\/fire$/.exec(p);
  if (fireMatch && method === 'POST') {
    const cueId = fireMatch[1];
    if (!plan || !plan.cues.some((c) => c.id === cueId)) { sendJson(res, 404, { error: `cue "${cueId}" not found` }); return true; }
    try {
      const result = await dispatchCue(cueId, 'manual');
      lastError = null;
      saveTimelineState(state, stateDir);
      lastStateJson = JSON.stringify(state);
      broadcastState();
      sendJson(res, 200, { ok: true, steps: result.steps });
    } catch (e) {
      cueErrors[cueId] = `${e && e.message}`;
      lastError = `manual fire "${cueId}": ${e && e.message}`;
      broadcastState();
      sendJson(res, 400, { error: `${e && e.message}` });
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let handled = false;
  try {
    handled = await handleApi(req, res, url);
  } catch (e) {
    sendJson(res, 500, { error: `${e && e.message}` });
    return;
  }
  if (handled) return;

  // Static UI.
  let pth = decodeURIComponent(url.pathname);
  if (pth === '/') pth = '/index.html';
  const file = path.join(UI_DIR, path.normalize(pth).replace(/^([/\\])+/, ''));
  if (!file.startsWith(UI_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(buildTimelineState()));
  ws.on('close', () => clients.delete(ws));
});

// ── boot ───────────────────────────────────────────────────────────────────────
let tickTimer = null;
function startTickLoop() {
  tickTimer = setInterval(() => {
    tick().catch((e) => {
      lastError = `tick: ${e && e.message}`;
      console.warn(`  ⚠ tick error: ${e && e.message}`);
    });
  }, cfg.tickMs);
}

server.listen(PORT, () => {
  console.log(`Timeline Companion (show director) → http://localhost:${PORT}`);
  console.log(`     ↔ engine ${cfg.engine.host}:${cfg.engine.port} · mood key "${cfg.mood.key}" ≥ ${cfg.mood.partyThreshold}`);
  // Resolve the scene (arg or engine /status), load plan + state, catch up,
  // then start the tick loop. Boot NEVER crashes — it waits for the engine.
  (async () => {
    const name = await resolveScene();
    console.log(`  🎬 scene "${name}"`);
    loadSceneFiles(name);
    try { await catchUp(); }
    catch (e) {
      bootError = `catchUp: ${e && e.message}`;
      console.warn(`  ⚠ catchUp threw: ${e && e.message}`);
    }
    startTickLoop();
    broadcastState();
  })().catch((e) => {
    bootError = `boot: ${e && e.message}`;
    console.error(`  ⚠ boot error (server still up, UI shows the error): ${e && e.message}`);
  });
});

// ── graceful shutdown ────────────────────────────────────────────────────────
function shutdown() {
  console.log('Timeline Companion shutting down…');
  if (tickTimer) clearInterval(tickTimer);
  try { engineLink.stop(); } catch { /* ignore */ }
  for (const c of clients) { try { c.close(); } catch { /* ignore */ } }
  wss.close(() => server.close(() => process.exit(0)));
  // Hard cap so a hung socket can't block teardown forever.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

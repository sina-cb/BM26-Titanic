import http from 'http';
import os from 'os';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Autopilot } from './autopilot.js';
import { StateManager } from './state_manager.js';
import { PlaylistManager } from './playlist_manager.js';
import { validateModulationMapping } from './modulation_engine.js';
import { describeLibrary, GLOBAL_EFFECT_LIBRARY } from './global_effect_library.js';
import { validateSlotsConfig } from './global_effect_slot_manager.js';
import {
  ScheduledTaskService,
  ScheduledTaskValidationError,
  ON_DURATION_PRESETS_MS,
  INTERVAL_PRESETS_MS,
} from './scheduled_tasks.js';
import { topicForType, TOPICS } from './ws_topic_routing.js';

/**
 * Validate a `viewSelection` payload before it reaches the mixer.
 * Per docs/27_[todo]_mixer_layer_view_selection.md §3.1 the API MUST
 * reject malformed shapes with 400 — silently coercing them would let
 * a typo brick the render loop into "everything masked to black".
 *
 * Returns { ok: true, value } on success (value is the normalized
 * object suitable for handing to mixer.setChannelViewSelection), or
 * { ok: false, error } on failure (error is a human-readable string
 * suitable for the 400 response body).
 */
export function validateViewSelection(vs) {
  if (vs === null || vs === undefined) {
    return { ok: true, value: { type: 'all', target: null, invert: false } };
  }
  if (typeof vs !== 'object' || Array.isArray(vs)) {
    return { ok: false, error: 'viewSelection must be an object' };
  }
  const type = vs.type;
  const target = vs.target;
  const invert = !!vs.invert;
  if (typeof type !== 'string') {
    return { ok: false, error: 'viewSelection.type must be a string' };
  }
  switch (type) {
    case 'all':
      if (target !== null && target !== undefined) {
        return { ok: false, error: "viewSelection.target must be null or omitted when type === 'all'" };
      }
      return { ok: true, value: { type: 'all', target: null, invert } };
    case 'group':
      if (typeof target !== 'string' || target.length === 0) {
        return { ok: false, error: "viewSelection.target must be a non-empty string when type === 'group'" };
      }
      return { ok: true, value: { type: 'group', target, invert } };
    case 'section':
      if (!Number.isInteger(target)) {
        return { ok: false, error: "viewSelection.target must be an integer when type === 'section'" };
      }
      return { ok: true, value: { type: 'section', target, invert } };
    case 'fixture':
      if (!Number.isInteger(target)) {
        return { ok: false, error: "viewSelection.target must be an integer when type === 'fixture'" };
      }
      return { ok: true, value: { type: 'fixture', target, invert } };
    case 'viewMask':
      // Two shapes accepted:
      //   1. target: '<name>'  (preferred — resolved against the model's
      //      viewMasks dictionary at mask-compile time so operators
      //      pick by human label, not a bitmask integer).
      //   2. target: <positive int>  (legacy bitmask passthrough; kept so
      //      tests / programmatic clients can still drive raw bits
      //      without going through the model dictionary).
      if (typeof target === 'string') {
        if (target.length === 0) {
          return { ok: false, error: "viewSelection.target must be a non-empty string name when type === 'viewMask'" };
        }
        return { ok: true, value: { type: 'viewMask', target, invert } };
      }
      if (Number.isInteger(target) && target > 0) {
        return { ok: true, value: { type: 'viewMask', target, invert } };
      }
      return { ok: false, error: "viewSelection.target must be a non-empty string name OR a positive integer bitmask when type === 'viewMask'" };
    default:
      return { ok: false, error: `Unknown viewSelection.type '${type}' (expected: all | group | section | fixture | viewMask)` };
  }
}

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

/**
 * Enumerate every non-internal IPv4 URL the engine is reachable on,
 * for the boot-time "Reachable on:" block.
 *
 * Loopback (127.0.0.1) is always first — useful for the local browser
 * dev case even on a quiet box. Then RFC1918 private addresses
 * (10.x, 192.168.x, 172.16-31.x) — those are the "real" LAN URLs the
 * operator usually wants for CaptainPad's Config tab fallback when
 * discovery is flaky. Then any remaining public IPv4 at the bottom.
 *
 * Excluded outright (noise that's never reachable from a LAN peer):
 *   - IPv4 link-local (169.254.0.0/16, APIPA) — only assigned when
 *     DHCP fails, never useful to hand to a peer.
 *   - VPN / tunnel virtual interfaces by name prefix: `utun`, `tun`,
 *     `tap`, `ipsec`. Addresses on these (e.g. 10.254.x from a corp
 *     VPN) are reachable only via the tunnel endpoint, NOT from a
 *     peer on the operator's LAN. Printing them clutters the boot log
 *     and misleads anyone trying to type the URL into a browser.
 *
 * One pass at boot — we don't re-enumerate on interface changes.
 */
function reachableUrls(port) {
  const isPrivate = (ip) => {
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10);
      return second >= 16 && second <= 31;
    }
    return false;
  };
  const ips = ['127.0.0.1'];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    // Drop VPN / tunnel virtual interfaces wholesale — their addresses
    // only route through the tunnel endpoint, not from a LAN peer.
    if (name.startsWith('utun') || name.startsWith('tun')
        || name.startsWith('tap') || name.startsWith('ipsec')) continue;
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4') continue;
      if (info.internal) continue;
      // Drop IPv4 link-local (APIPA, 169.254.0.0/16) — only assigned
      // when DHCP fails, never a useful URL to give a peer.
      if (info.address.startsWith('169.254.')) continue;
      if (!ips.includes(info.address)) ips.push(info.address);
    }
  }
  const rank = (ip) => {
    if (ip === '127.0.0.1') return 0;
    if (isPrivate(ip)) return 1;
    return 2;
  };
  ips.sort((a, b) => rank(a) - rank(b));
  return ips.map(ip => `http://${ip}:${port}`);
}

export function startApiServer(opts, engineCore, patternsDir, publishStatsRef, intensityController, globalEffectsController) {
  const { mixer, wasmHost, paramRouter, paramCenter, model } = engineCore;
  const localControlKinds = new Set([1, 2, 3, 6]);

  /**
   * Distinct fixture-group names declared by the loaded model, sorted
   * for stable UI ordering. Source list for the Dimmer Rack's FIXED
   * COLORS picker and the validation gate for PUT /group-fixed-colors
   * (docs/32 §2.4).
   */
  function listModelGroups() {
    const seen = new Set();
    if (model && Array.isArray(model.pixels)) {
      for (const px of model.pixels) {
        if (px && typeof px.group === 'string' && px.group.length > 0) seen.add(px.group);
      }
    }
    return [...seen].sort();
  }
  // Monotonic suffix for new-channel ids — guards against two POSTs in
  // the same millisecond producing the same `ch_<Date.now()>` id.
  let channelIdCounter = 0;

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
   * onChannelCompiled + (optional) playlist entry defaults + localControls
   * restore. Ensures the latest system color palette, speed, etc. always
   * wins over any per-pattern state.
   */
  function finalizeCpcValues(channel) {
    if (paramCenter) {
      paramCenter.applyToChannel(wasmHost, channel.id);
    }
  }

  // Topic-aware broadcaster. Picks the right WebSocketServer based on
  // the message `type` (see lib/ws_topic_routing.js for the full
  // routing table). The four sockets (`/ws/control`, `/ws/params`,
  // `/ws/signals`, `/ws/viz`) are created in `wssByTopic` below; this
  // function is a no-op until that map is populated, which makes it
  // safe to call during early boot before listen() has bound.
  //
  // A missing classification throws — see ws_topic_routing.js — so a
  // typo in a payload `type` fails loud at the broadcast site instead
  // of silently disappearing or leaking onto every socket.
  function broadcastWs(msgObj) {
    if (!msgObj || typeof msgObj !== 'object') return;
    const topic = topicForType(msgObj.type);
    const wssForTopic = global.wssByTopic && global.wssByTopic[topic];
    if (!wssForTopic) return;
    const msg = JSON.stringify(msgObj);
    wssForTopic.clients.forEach(c => {
      if (c.readyState === 1) c.send(msg);
    });
  }

  // Wire the ModulationController's broadcast publisher to our local
  // broadcastWs. The controller was constructed in engine.js BEFORE
  // this fn ran, so it was given a deferred ref — now it flows.
  //
  // WS topic routing note: when the round-3 WS topic split lands,
  // `modulationState` must route to /ws/params (the "values changing
  // live" socket alongside sharedParams + liveParams). Until then it
  // rides the single global.wss like everything else.
  if (engineCore.modulationBroadcastRef) {
    engineCore.modulationBroadcastRef.publish = broadcastWs;
  }

  // Same pattern for the SignalPostProcessor (docs/29) — the engine
  // constructs it before api_server runs, hands us a deferred ref;
  // wire it here so `audioChainsChanged` (on PUT/PATCH/reset) and
  // 5 Hz `signalChain` previews flow through broadcastWs.
  if (engineCore.signalPostProcessorBroadcastRef) {
    engineCore.signalPostProcessorBroadcastRef.publish = broadcastWs;
  }

  const stateDir = path.join(patternsDir, '..', 'states', opts.modelName || 'default');
  const stateManager = new StateManager(stateDir);

  // Playlist library lives in simulation/scenes/<scene>/playlists/
  const playlistsDir = path.join(
    patternsDir, '..', '..', 'simulation', 'scenes',
    opts.modelName || 'default', 'playlists'
  );
  const playlistManager = new PlaylistManager(playlistsDir, patternsDir);

  // ── Modulation context push ─────────────────────────────────────────
  // Whenever the deck's (playlist, activeEntryId) tuple changes OR a
  // CRUD mutation lands on the currently-active entry, push the
  // matching mappings into the ModulationController. The hot loop
  // never reads disk for this.
  function pushActiveEntryToModulation() {
    const mc = engineCore.modulationController;
    if (!mc) return;
    const deckCh = mixer.getDeckChannel();
    const playlistName = deckCh?.playlist?.name || null;
    const entryId = deckCh?.playlist?.activeEntryId || null;
    if (!playlistName || !entryId) {
      mc.setActiveEntry({ playlistName: null, entryId: null, pattern: null, mappings: [] });
      return;
    }
    let mappings = [];
    let pattern = deckCh?.pattern || null;
    try {
      const pl = playlistManager.load(playlistName);
      const entry = pl && pl.entries.find(e => e.id === entryId);
      if (entry) {
        mappings = Array.isArray(entry.modulations) ? entry.modulations : [];
        pattern = entry.pattern || pattern;
      }
    } catch (err) {
      console.warn(`[Modulation] could not load mappings for ${playlistName}/${entryId}: ${err.message}`);
    }
    mc.setActiveEntry({ playlistName, entryId, pattern, mappings });
  }
  if (playlistManager.list().length === 0) {
    try {
      playlistManager.generateDefault();
      console.log(`  ✅ Playlist library initialized at ${playlistsDir} (default.yaml generated)`);
    } catch (e) {
      console.warn(`[Playlist] Could not generate default playlist:`, e.message);
    }
  } else {
    console.log(`  ✅ Playlist library: ${playlistManager.list().length} playlist(s) in ${playlistsDir}`);
  }

  let mixerState = stateManager.loadMixerState();
  let deckState = stateManager.loadDeckState();
  let globalsState = stateManager.loadGlobalsState();

  // ── Deck transition config ───────────────────────────────────────────
  // Operator picks (deck tab → DECK TRANSITIONS row) for how playlist
  // entry switches on the deck should look:
  //
  //   enabled    : false → instant swap (original behaviour)
  //                true  → soft swap via mixer's hidden shadow channel
  //   mode       : 'trans_crossfade' | 'trans_flash' | 'trans_dissolve'
  //                | 'trans_wipe_*' | 'trans_iris' — see patterns/transitions/
  //   durationMs : 50..30000
  //   shuffle    : if true, pick a random transition style per swap
  //                (mode field is ignored)
  //
  // Persisted alongside the deck state so it survives engine restarts.
  // The mixer's swap machinery lives in pattern_mixer.js
  // (`triggerDeckPatternSwap` + `updateDeckSwapTransition`).
  const deckTransitionConfig = {
    enabled: false,
    mode: 'trans_crossfade',
    durationMs: 1000,
    shuffle: false,
    ...(deckState && deckState.transitionConfig ? deckState.transitionConfig : {}),
  };

  if (paramCenter) {
    paramCenter.saveHook = () => stateManager.saveGlobalsState(globalsState, paramCenter);
  }

  try {
    stateManager.applyGlobalsState(globalsState, paramCenter, intensityController, globalEffectsController);
  } catch (err) {
    console.warn('Failed to apply loaded state:', err);
  }

  // Restore Global Effect Macro slot bindings (docs/28 §8 — persistent).
  // The slot manager is created at engine boot with the in-code default
  // config; if a persisted file exists AND validates we overlay it.
  // If validation throws (e.g. old yaml references a removed effect),
  // we leave the defaults in place and log — never silently fall back.
  const globalEffectSlotManager = engineCore.globalEffectSlotManager || null;
  if (globalEffectSlotManager) {
    const persistedSlots = stateManager.loadGlobalEffectSlots();
    if (persistedSlots && Array.isArray(persistedSlots.slots)) {
      try {
        validateSlotsConfig(persistedSlots.slots);
        globalEffectSlotManager.setSlots(persistedSlots.slots);
        console.log(`  ✅ Global effect slots: restored ${persistedSlots.slots.length} from disk`);
      } catch (e) {
        console.warn(`[GlobalEffectSlots] persisted config invalid, keeping defaults: ${e.message}`);
      }
    }
  }

  // ── Scheduler service (docs/31_scheduled_tasks.md v3) ───────────────
  // Engine-owned task list that fires (effectId, presetId) bindings
  // from the global effect library on a timer ("hazer 10s every 1m").
  // The schedule keeps running even when CaptainPad is closed, asleep,
  // or disconnected — the engine is the source of truth. Persisted to
  // states/<model>/scheduled_tasks.yaml. Dispatch goes through
  // GlobalEffectSlotManager.dispatchEffectAction — slot-less direct
  // route, no GEM slot reservation (v3 change).
  const scheduledTaskService = new ScheduledTaskService({
    stateDir,
    slotManager: globalEffectSlotManager,
    broadcast: broadcastWs,
    getFrameIndex: () => (engineCore.getFrameIndex ? engineCore.getFrameIndex() : 0),
  });
  try {
    scheduledTaskService.loadFromDisk();
    if (scheduledTaskService.list().length > 0) {
      console.log(`  ✅ Scheduled tasks: restored ${scheduledTaskService.list().length} from disk`);
    }
  } catch (err) {
    // Codex P0: hand-edited YAML with off-preset values must crash boot
    // loudly rather than silently dropping the bad row.
    console.error(`[ScheduledTasks] failed to load scheduled_tasks.yaml: ${err.message}`);
    process.exit(1);
  }
  scheduledTaskService.start();

  // After loading saved CPC values, push them to all boot-created channels.
  // This must happen after the channels have been primed with beginFrame(0)
  // (which onChannelCompiled already does).
  if (paramCenter) paramCenter.applySnapshot(wasmHost);

  // ── CPC fan-out via onChange (docs/24 §7.2) ────────────────────────────
  //
  // Single source of truth for post-mutation work after a CPC write
  // from any source (HTTP, WS, OSC, future MIDI). Replaces the
  // ad-hoc `applySnapshot/save/broadcastWs` calls that used to live
  // in each handler, which would double-broadcast as soon as we
  // added a second source.
  //
  // - WASM injection: relies on the render loop's flushDirty() —
  //   set() marks the slot dirty; flushDirty pushes on the next
  //   frame. No applySnapshot call here.
  // - Persistence: skipped entirely for batches that touch only
  //   live (persist:false) params, so audio at 60 Hz never writes
  //   to disk.
  // - WS broadcast: throttled per-key by registry broadcastHz.
  let lastOscStats = null;
  // Same caching contract as lastOscStats — a WS client that connects
  // after the most recent audioStatus broadcast gets it replayed on
  // connect so the Audio Analysis tab paints the right state without
  // waiting up to a second for the next 1Hz heartbeat (docs/25 §6.3).
  let lastAudioStatus = null;
  // Cached most-recent payloads for replay on WS connect. lastSharedParams
  // is the full canonical CPC doc; lastLiveParams is the audio-derived
  // subset that broadcasts on the `liveParams` channel — see
  // broadcastCpcSplit() below.
  let lastSharedParams = null;
  let lastLiveParams = null;
  const lastBroadcastMs = {};
  // Bucket-level emit cap (May 2026 perf). Per-key throttles are too
  // coarse — with 4 mic bands all flagged 15 Hz but staggered, ANY
  // band passing its 66ms deadline triggers a broadcast carrying ALL
  // live keys, so the wire rate climbs to ~4×15 = 60 msg/s. The eye
  // can't see meter ticks above ~20 Hz, and at 60 msg/s the iPad
  // JS thread pays JSON.parse + listener fan-out for nothing. Cap the
  // BUCKET so livePayloads emit at most every 50 ms regardless of how
  // many per-key deadlines are firing. Per-key Hz values still act as
  // a CEILING (a key flagged 5 Hz still throttles its own contribution).
  const LIVE_BUCKET_MIN_INTERVAL_MS = 50; // 20 Hz cap
  let lastLiveBroadcastMs = 0;
  let hzByKeyCache = null;
  let liveKeysSetCache = null;
  function getHzByKey() {
    if (hzByKeyCache) return hzByKeyCache;
    hzByKeyCache = {};
    if (paramCenter) {
      for (const e of paramCenter.getSchema()) {
        hzByKeyCache[e.key] = e.broadcastHz || 30;
      }
    }
    return hzByKeyCache;
  }
  // Set of CPC keys flagged `live: true` (see lib/param_center.js
  // REGISTRY). These are the audio-derived, high-rate, non-persistent
  // params (mic bands + kick, OSC stems, tempoBpm) that ride a
  // SEPARATE `liveParams` WS message so the mixer / deck onmessage
  // path doesn't have to parse + setState a 1.5 KB sharedParams
  // snapshot 30× / second while the audio analyser is running.
  // Cached once at boot because the schema is immutable per process.
  function getLiveKeysSet() {
    if (liveKeysSetCache) return liveKeysSetCache;
    liveKeysSetCache = new Set();
    if (paramCenter) {
      for (const e of paramCenter.getSchema()) {
        if (e && e.live === true) liveKeysSetCache.add(e.key);
      }
    }
    return liveKeysSetCache;
  }
  // Throttle helper, shared by both message types. `bucket` namespaces
  // the timestamps so a key can independently pace its sharedParams
  // and liveParams emissions even though the key only ever appears in
  // one of them (defensive: cheap insurance against future re-classing).
  function pastThrottle(now, bucket, keys, hzByKey) {
    for (const k of keys) {
      const hz = hzByKey[k] || 30;
      const interval = 1000 / hz;
      const ts = lastBroadcastMs[`${bucket}:${k}`] || 0;
      if (!ts || (now - ts) >= interval) return true;
    }
    return false;
  }
  function stampThrottle(now, bucket, keys) {
    for (const k of keys) lastBroadcastMs[`${bucket}:${k}`] = now;
  }
  // Emit one `sharedParams` (steady keys) and / or one `liveParams`
  // (audio-derived keys) per CPC change batch.
  //
  // Why split: pre-split, every audio hop pushed the whole CPC
  // snapshot (~30 keys, ~1.5 KB) at up to 30 Hz to every WS client,
  // including the mixer / deck which don't react to audio params at
  // all. That cost was visible as JS-thread starvation on the iPad
  // (slow playlist taps with the mic listener active). After the
  // split:
  //   - sharedParams: full CPC, only emitted when a STEADY key
  //     actually changes (colors, speed, gains, etc.) — i.e. when the
  //     operator turns a knob. Quiet by default.
  //   - liveParams: just the live keys (mic*, stems*, tempoBpm),
  //     broadcast at their per-key rate. Small payload (~150 B), the
  //     audio tab is the only consumer that has to re-render on it.
  //
  // The mixer / deck onmessage handlers can early-return on the
  // `liveParams` type and stay smooth even with the analyser hot.
  function broadcastCpcSplit(state, changedKeys) {
    if (!changedKeys || changedKeys.length === 0) return;
    const now = Date.now();
    const hzByKey = getHzByKey();
    const liveSet = getLiveKeysSet();
    const liveChanged = [];
    const steadyChanged = [];
    for (const k of changedKeys) {
      if (liveSet.has(k)) liveChanged.push(k);
      else steadyChanged.push(k);
    }

    // ── liveParams: tight payload, only live keys ───────────────────
    // Two gates must both pass: (1) per-key Hz (cheap insurance against
    // a single key spamming faster than its declared rate) AND (2) the
    // BUCKET rate cap which keeps total liveParams traffic below 20 Hz
    // even when multiple keys are evolving in parallel.
    if (liveChanged.length > 0
        && (now - lastLiveBroadcastMs) >= LIVE_BUCKET_MIN_INTERVAL_MS
        && pastThrottle(now, 'live', liveChanged, hzByKey)) {
      lastLiveBroadcastMs = now;
      stampThrottle(now, 'live', liveChanged);
      const params = {};
      const srcParams = (state && state.params) || {};
      // Only ship live keys; if you need full CPC state, hit
      // /param-center or wait for the next sharedParams emission.
      for (const k of liveSet) {
        const slot = srcParams[k];
        if (!slot) continue;
        params[k] = { value: slot.value };
      }
      const payload = {
        type: 'liveParams',
        revision: state && state.revision,
        params,
      };
      lastLiveParams = payload;
      broadcastWs(payload);
    }

    // ── sharedParams: full canonical CPC, steady-key triggered ──────
    // We keep emitting the WHOLE state (back-compat for any consumer
    // that flattens `params[k].value`), but only when a steady key
    // actually changed — so it goes from "30 Hz audio-driven firehose"
    // back to "operator-touch driven".
    if (steadyChanged.length > 0 && pastThrottle(now, 'steady', steadyChanged, hzByKey)) {
      stampThrottle(now, 'steady', steadyChanged);
      const payload = { type: 'sharedParams', ...state };
      lastSharedParams = payload;
      broadcastWs(payload);
    }
  }
  if (paramCenter) {
    paramCenter.onChange = ({ changedKeys, state }) => {
      if (paramCenter.hasPersistentDirty(changedKeys)) {
        paramCenter.save();
      }
      broadcastCpcSplit(state, changedKeys);
    };
  }

  function saveAllState() {
    stateManager.saveMixerState(mixer);
    stateManager.saveDeckState(mixer, { transitionConfig: { ...deckTransitionConfig } });
  }

  function getReplayableLocalExport(channel, controlId) {
    if (paramCenter && paramCenter.isSharedControlId(channel.id, controlId)) return null;
    const exp = wasmHost.getExports(channel.handle).find(e => e.id === controlId);
    if (!exp || !localControlKinds.has(exp.kind)) return null;
    return exp;
  }

  // ── Debounced per-channel auto-capture ───────────────────────────────
  // Every control change schedules a capture of the active playlist entry's
  // defaults 500 ms after the LAST change. Coalesces fast slider drags into
  // one disk write and one WS broadcast. The broadcast lets every open client
  // (deck + mixer) update its UI in lockstep.
  const captureTimers = new Map();
  const CAPTURE_DEBOUNCE_MS = 500;

  /**
   * Capture current channel state as the entry.defaults of the playlist's
   * currently active entry. Persists to disk.
   */
  function captureActiveEntryDefaults(channel) {
    if (!channel.playlist || !channel.playlist.name || !channel.playlist.activeEntryId) {
      throw new Error('Channel has no active playlist entry');
    }
    const playlist = playlistManager.load(channel.playlist.name);
    if (!playlist) throw new Error(`Playlist not found: ${channel.playlist.name}`);
    const entry = playlist.entries.find(e => e.id === channel.playlist.activeEntryId);
    if (!entry) throw new Error(`Active entry not found: ${channel.playlist.activeEntryId}`);
    entry.defaults = playlistManager.captureDefaults(channel, wasmHost, paramCenter);
    playlistManager.save(playlist);
    return entry.defaults;
  }

  function scheduleEntryCapture(channelId) {
    if (!channelId) return;
    // Locked channels intentionally do NOT auto-capture. Param edits are
    // still applied to the live WASM handle (so the operator can tweak a
    // show), but the playlist defaults on disk stay frozen until the user
    // unlocks and explicitly chooses save or discard.
    const ch0 = mixer.getChannel(channelId);
    if (ch0 && ch0.locked) return;
    const existing = captureTimers.get(channelId);
    if (existing) clearTimeout(existing);
    captureTimers.set(channelId, setTimeout(() => {
      captureTimers.delete(channelId);
      const ch = mixer.getChannel(channelId);
      if (!ch || !ch.playlist || !ch.playlist.activeEntryId) return;
      // Defensive re-check: lock may have been engaged inside the debounce
      // window. Never let a stale timer write into a locked channel.
      if (ch.locked) return;
      try {
        const defaults = captureActiveEntryDefaults(ch);
        broadcastWs({
          type: 'playlistEntryCaptured',
          channelId,
          playlist: ch.playlist.name,
          entryId: ch.playlist.activeEntryId,
          defaults,
        });
      } catch (e) {
        // Active entry may have been removed mid-edit, etc. Surface to the
        // operator log but never crash the request handler.
        console.warn('[Playlist] Auto-capture skipped:', e.message);
      }
    }, CAPTURE_DEBOUNCE_MS));
  }

  /**
   * Track whether a control was edited *while the channel was locked*. We
   * keep this as an explicit, intent-driven flag rather than diffing the
   * live state against the saved entry defaults, because:
   *
   *   1. Freshly-added playlist entries have `defaults = {}` (no opinion
   *      saved yet). A diff would either flag every channel as dirty (any
   *      WASM init produces non-empty captureDefaults output) or never
   *      flag them (empty-saved-equals-clean). Neither matches user
   *      intent for the "I locked this, then tweaked sliders, now I'm
   *      unlocking" workflow.
   *   2. Pattern exports can change between releases. Diff-based dirty
   *      would chase phantom diffs from added/removed exports rather than
   *      real user edits.
   *
   * The flag lifecycle:
   *   - Initialized lazily to `false` whenever read.
   *   - Set to `true` only when `markChannelDirtyIfLocked` is called on a
   *     locked channel (i.e. operator turned a knob while the lock was on).
   *   - Cleared whenever we resolve the state: on lock toggle (either
   *     direction), on capture, on discard, and on entry swap.
   */
  function markChannelDirtyIfLocked(channelId) {
    const ch = mixer.getChannel(channelId);
    if (!ch || !ch.locked) return;
    if (ch._dirty) return;
    ch._dirty = true;
    broadcastMixerState();
  }
  function clearChannelDirty(channel) {
    if (channel && channel._dirty) channel._dirty = false;
  }

  /**
   * Load a playlist entry into an EXISTING channel: compile pattern, swap
   * handle, apply entry defaults, and let CPC have the last word. Updates
   * channel.playlist.activeEntryId + cursor.
   */
  function loadPlaylistEntry(channel, playlistName, entryId) {
    const playlist = playlistManager.load(playlistName);
    if (!playlist) throw new Error(`Playlist not found: ${playlistName}`);
    const idx = playlist.entries.findIndex(e => e.id === entryId);
    if (idx < 0) throw new Error(`Entry not found in ${playlistName}: ${entryId}`);
    const entry = playlist.entries[idx];
    if (entry._missing) throw new Error(`Pattern missing for entry ${entryId}: ${entry.pattern}`);

    // Cancel any pending auto-capture targeting the PREVIOUS active entry —
    // we don't want a stale timer to write old values into the entry we just
    // left behind (which would then overwrite the on-disk defaults captured
    // at switch time).
    const pending = captureTimers.get(channel.id);
    if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }

    const src = loadPattern(patternsDir, entry.pattern);
    const comp = wasmHost.compile(src);
    if (!comp.ok) throw new Error(`Compile error: ${comp.error}`);

    if (channel.handle) wasmHost.destroy(channel.handle);
    channel.handle = comp.handle;
    channel.pattern = entry.pattern;
    channel.localControls = {};
    onChannelCompiled(channel);

    playlistManager.applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter);
    finalizeCpcValues(channel);

    // Update assignment cursor
    channel.playlist = channel.playlist || {};
    channel.playlist.name = playlistName;
    channel.playlist.activeEntryId = entryId;
    channel.playlist.cursor = idx;
    channel.playlist.autopilot = channel.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };

    // Switching to a new entry resets the "dirty since lock" state — the
    // new entry's own defaults are now the canonical reference, and any
    // edits made in the previous entry are no longer relevant here.
    channel._dirty = false;

    // Push the entry's modulations into the ModulationController if this
    // load lands on the deck channel.
    if (mixer.getDeckChannel && mixer.getDeckChannel()?.id === channel.id) {
      pushActiveEntryToModulation();
    }

    return { entry, index: idx, total: playlist.entries.length };
  }

  // ── Deck pattern transitions (double-buffer via mixer shadow channel) ──
  //
  // `loadPlaylistEntryWithTransition` is the soft-swap sibling of
  // `loadPlaylistEntry`. When the operator has enabled deck transitions
  // (see /deck/transition-config), playlist entry loads on the deck base
  // channel route through here:
  //
  //   1. Compile the new pattern (we need both old + new running
  //      simultaneously during the fade, so we DON'T install on the
  //      base channel yet — that would clobber the live one).
  //   2. Hand the fresh handle to `mixer.triggerDeckPatternSwap`, which
  //      drives a smoothstep fader on a hidden shadow channel composited
  //      ON TOP of the deck buffer using the chosen blend script.
  //   3. On completion (callback), do all the bookkeeping that
  //      `loadPlaylistEntry` would have done up front: CPC re-register,
  //      apply entry defaults, finalize CPC values, update the cursor,
  //      save state, broadcast.
  //
  // If `transitionConfig` is missing or disabled, we fall back to the
  // instant `loadPlaylistEntry`.
  function pickRandomTransitionMode() {
    // Transition shuffle picks a random visual style each swap. We list
    // these explicitly (instead of reading the transitions/ dir) so we
    // can guarantee the picks are scripts the engine knows how to drive
    // via the `progress` argument — adding a new wipe script needs an
    // intentional bump here so a busted script doesn't silently roulette.
    const TRANSITION_OPTIONS = [
      'trans_crossfade', 'trans_flash', 'trans_dissolve',
      'trans_wipe_right', 'trans_wipe_left', 'trans_wipe_down',
      'trans_iris', 'trans_iris_close',
      'trans_diagonal_wipe', 'trans_diamond_wipe',
      'trans_ripple_in', 'trans_color_burst',
      'trans_split_horizontal', 'trans_split_vertical',
      'trans_wave_sweep', 'trans_morse_blink',
    ];
    return TRANSITION_OPTIONS[Math.floor(Math.random() * TRANSITION_OPTIONS.length)];
  }

  /**
   * Returns:
   *   {
   *     entry, index, total,
   *     transitionId : string|null,   // null for instant load
   *     done         : Promise<void>, // resolves on swap completion
   *                                   // (or immediately for instant load)
   *   }
   *
   * `done` is awaited by the autopilot daemon so its inter-pattern timer
   * cleanly stays decoupled from the transition duration — i.e. with
   * delay=1s + transition=5s the cycle is `show 1s → transition 5s → next`
   * instead of an interval-overlap mess where the timer fires every 1s
   * regardless of whether the previous transition has settled.
   *
   * HTTP handlers don't need to await; they read `transitionId` (so the
   * client can correlate the upcoming `deckSwapStarted` broadcast) and
   * respond immediately. Completion drives further broadcasts.
   *
   * Throws if a swap is already in flight — see `cannotStartReason`
   * below for the specific guard. Callers are expected to short-circuit
   * with a 409 (HTTP) or no-op (autopilot).
   */
  function deckSwapInFlightReason() {
    if (mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) {
      return 'swap-already-in-flight';
    }
    return null;
  }

  function loadPlaylistEntryWithTransition(channel, playlistName, entryId, transitionConfig) {
    const enabled = !!(transitionConfig && transitionConfig.enabled);
    if (!enabled) {
      const r = loadPlaylistEntry(channel, playlistName, entryId);
      saveAllState();
      opts.pattern = channel.pattern;
      broadcastWs({ type: 'pattern', name: channel.pattern });
      broadcastMixerState();
      return { ...r, transitionId: null, done: Promise.resolve() };
    }

    // Refuse if a swap is already in flight — taps during a transition
    // are explicitly ignored at the operator's request, not queued.
    const reason = deckSwapInFlightReason();
    if (reason) {
      const err = new Error(reason);
      err.code = 'EBUSY';
      throw err;
    }

    const playlist = playlistManager.load(playlistName);
    if (!playlist) throw new Error(`Playlist not found: ${playlistName}`);
    const idx = playlist.entries.findIndex(e => e.id === entryId);
    if (idx < 0) throw new Error(`Entry not found in ${playlistName}: ${entryId}`);
    const entry = playlist.entries[idx];
    if (entry._missing) throw new Error(`Pattern missing for entry ${entryId}: ${entry.pattern}`);

    // Pre-cancel any pending auto-capture targeting the PREVIOUS entry,
    // same reasoning as in loadPlaylistEntry.
    const pending = captureTimers.get(channel.id);
    if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }

    // ── Ping-pong handle reuse ──────────────────────────────────────
    // The mixer keeps the previously-active deck handle alive in an
    // INACTIVE slot after every swap completes (its WASM handle stays
    // warm and is ticked each frame). If the operator is ping-ponging
    // A→B→A→B, the inactive slot already holds the target pattern's
    // compiled handle from the last swap — recompiling would burn
    // tens-to-hundreds of ms per tap. We check the inactive slot HERE,
    // BEFORE paying the compile cost. If it's warm, signal reuse to
    // the mixer with newHandle:null.
    //
    // We do NOT reuse if the inactive holds the SAME pattern but the
    // entry has different `defaults` — in that case we want a fresh
    // compile so default application starts from a clean export-table
    // state rather than overwriting whatever the previous swap's
    // controls were when the handle got demoted. (Most playlist
    // entries have empty defaults, so this branch is rare.)
    const inactivePattern = mixer.getInactiveDeckPattern && mixer.getInactiveDeckPattern();
    const wantHandleReuse = inactivePattern === entry.pattern
      && (!entry.defaults || Object.keys(entry.defaults).length === 0);

    let handleForSwap = null;
    let handleExports = null;
    let isReused = false;
    if (wantHandleReuse) {
      const inactiveCh = mixer.getInactiveDeckChannel && mixer.getInactiveDeckChannel();
      handleForSwap = inactiveCh ? inactiveCh.handle : null;
      isReused = !!handleForSwap;
    }
    if (!handleForSwap) {
      const src = loadPattern(patternsDir, entry.pattern);
      const comp = wasmHost.compile(src);
      if (!comp.ok) throw new Error(`Compile error: ${comp.error}`);
      handleForSwap = comp.handle;
    }
    handleExports = wasmHost.getExports(handleForSwap);

    // Resolve transition mode + duration. Shuffle picks a fresh random
    // visual style per swap; otherwise the operator's configured pick wins.
    let transMode = transitionConfig.mode || 'trans_crossfade';
    if (transitionConfig.shuffle) transMode = pickRandomTransitionMode();
    const durationMs = Math.max(50, Math.min(30000, Number(transitionConfig.durationMs) || 1000));

    // CPC needs to know about the inactive handle so it receives
    // global color palette / speed / etc. during the fade. We register
    // under a stable shadow id so it cleans up tidily. On reuse the
    // handle is already warm — re-registering is still cheap and
    // ensures CPC's per-channel snapshot reflects the current global
    // state (which may have shifted since the previous swap).
    if (paramCenter) {
      paramCenter.registerChannel('__deck_swap__', handleForSwap, handleExports);
      if (!isReused) {
        // Execute top-level scope so export var defaults land. Skip on
        // reuse — the handle has been ticking via beginFrame() the
        // whole time (warm in the inactive slot) so its exports are
        // already initialized.
        wasmHost.beginFrame(handleForSwap, 0);
      }
      paramCenter.applyToChannel(wasmHost, '__deck_swap__');
    }
    // Apply per-entry defaults to the swap handle directly (not via
    // the channel object — that's still pointing at the active
    // channel). Mimics playlistManager.applyEntryDefaults but bypasses
    // the channel lookup.
    if (entry.defaults && Object.keys(entry.defaults).length > 0) {
      const byName = {};
      for (const e of (handleExports || [])) byName[e.name] = e;
      for (const [name, value] of Object.entries(entry.defaults)) {
        const exp = byName[name];
        if (!exp) continue;
        // Skip CPC-owned + blocked just like applyEntryDefaults does, but
        // resolve against the shadow id.
        if (paramCenter && paramCenter.isSharedExport('__deck_swap__', exp.name)) continue;
        if (paramCenter && paramCenter.getBlockedIds('__deck_swap__').has(exp.id)) continue;
        if (typeof value === 'object' && value !== null) {
          wasmHost.setControl(handleForSwap, exp.id, value.h ?? 0, value.s ?? 0, value.v ?? 0);
        } else {
          wasmHost.setControl(handleForSwap, exp.id, value, 0, 0);
        }
      }
    }

    let resolveDone;
    const done = new Promise((res) => { resolveDone = res; });

    const txid = mixer.triggerDeckPatternSwap({
      // On reuse, signal "use the warm inactive handle" by passing
      // null. Otherwise transfer ownership of the fresh compile to
      // the mixer (it destroys the previously-inactive handle on our
      // behalf).
      newHandle: isReused ? null : handleForSwap,
      patternName: entry.pattern,
      durationMs,
      transitionMode: transMode,
      steadyMode: 'blend_screen',
      onComplete: () => {
        // Handle has been promoted onto `channel` (the base) by the
        // mixer. Finish the bookkeeping that loadPlaylistEntry would
        // normally do synchronously.
        channel.localControls = {};
        // Re-register CPC against the new handle (replaces the old
        // registration in-place for `channel.id`).
        if (paramCenter) {
          paramCenter.registerChannel(channel.id, channel.handle, wasmHost.getExports(channel.handle));
          wasmHost.beginFrame(channel.handle, 0);
          broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
        }
        // Replay per-entry defaults onto the now-installed base handle,
        // then let CPC have the last word.
        playlistManager.applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter);
        finalizeCpcValues(channel);
        // Clean up the shadow CPC registration.
        if (paramCenter && paramCenter.unregisterChannel) {
          paramCenter.unregisterChannel('__deck_swap__');
        }

        channel.playlist = channel.playlist || {};
        channel.playlist.name = playlistName;
        channel.playlist.activeEntryId = entryId;
        channel.playlist.cursor = idx;
        channel.playlist.autopilot = channel.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
        channel._dirty = false;

        // Refresh modulation context for the new entry now that the
        // deck channel's handle and playlist tuple reflect the swap.
        pushActiveEntryToModulation();

        opts.pattern = channel.pattern;
        saveAllState();
        broadcastWs({ type: 'pattern', name: channel.pattern });
        broadcastWs({ type: 'deckSwapComplete', pattern: channel.pattern, transitionId: txid, transitionMode: transMode });
        broadcastMixerState();
        // Resolve the autopilot's await so its inter-pattern timer
        // can start its next countdown from a clean baseline.
        try { resolveDone(); } catch (_) {}
      },
    });

    if (!txid) {
      // Swap rejected (e.g. no deck base). Fall back to instant load
      // so the operator's pick still lands instead of vanishing.
      console.warn('[Deck] triggerDeckPatternSwap returned null — falling back to instant load');
      if (paramCenter && paramCenter.unregisterChannel) {
        paramCenter.unregisterChannel('__deck_swap__');
      }
      const r = loadPlaylistEntry(channel, playlistName, entryId);
      saveAllState();
      opts.pattern = channel.pattern;
      broadcastWs({ type: 'pattern', name: channel.pattern });
      broadcastMixerState();
      try { resolveDone(); } catch (_) {}
      return { ...r, transitionId: null, done };
    }

    // Optimistic broadcast so the UI knows a transition is in flight.
    // Final state lands via the onComplete broadcast above.
    broadcastWs({ type: 'deckSwapStarted', pattern: entry.pattern, transitionId: txid, transitionMode: transMode, durationMs });
    return {
      entry, index: idx, total: playlist.entries.length,
      transitionId: txid, done,
    };
  }

  function restoreChannel(saved, role /* 'deck' | 'mixer' */) {
    try {
      const src = loadPattern(patternsDir, saved.pattern);
      const comp = wasmHost.compile(src);
      if (!comp.ok) {
        console.warn(`Failed to compile saved channel ${saved.pattern}:`, comp.error);
        return;
      }
      const config = {
        id: saved.id,
        name: saved.name,
        pattern: saved.pattern,
        handle: comp.handle,
        mode: saved.mode,
        fader: saved.fader,
        enabled: saved.enabled,
        // Restore lock flags so the channel survives engine restart in
        // the same lock state the operator left it in. Pre-fader_lock
        // these were silently dropped; with the new faderLocked field
        // added in slot 5 we plumb them through explicitly. Falsy
        // defaults match the PatternChannel constructor.
        locked: !!saved.locked,
        faderLocked: !!saved.faderLocked,
        // Same reasoning for transition prefs.
        transitionMode: saved.transitionMode || 'trans_crossfade',
        transitionTime: saved.transitionTime || 1.0,
        // Restore view-selection so a mask-restricted channel survives
        // engine restart. setDeckChannel / addMixerChannel will compile
        // the mask immediately via recompileChannelMask (no extra call
        // needed here).
        viewSelection: saved.viewSelection || { type: 'all', target: null, invert: false },
      };
      const ch = role === 'deck'
        ? mixer.setDeckChannel(config)
        : mixer.addMixerChannel(config);
      if (saved.playlist) ch.playlist = saved.playlist;
      onChannelCompiled(ch);

      // Per docs/19_playlists.md §9.3 the playlist entry's `defaults` is the
      // canonical per-slot state. If a playlist+entry survived in saved
      // state, re-apply those defaults; otherwise just replay localControls.
      const pl = ch.playlist && ch.playlist.name && playlistManager.load(ch.playlist.name);
      const entry = pl && ch.playlist.activeEntryId &&
        pl.entries.find(e => e.id === ch.playlist.activeEntryId);
      if (entry && !entry._missing) {
        playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
      } else if (saved.localControls) {
        for (const [idStr, cv] of Object.entries(saved.localControls)) {
          const controlId = parseInt(idStr, 10);
          if (!getReplayableLocalExport(ch, controlId)) continue;
          paramRouter.setChannelControl(ch.id, controlId, cv.v0, cv.v1, cv.v2);
        }
      }
      // CPC gets the last word — latest color palette, speed, etc. always win
      finalizeCpcValues(ch);
    } catch (e) {
      console.warn(`Failed to restore channel ${saved.pattern}:`, e.message);
    }
  }

  const hasDeck = deckState.channel != null;
  const hasMixer = mixerState.channels && mixerState.channels.length > 0;

  if (hasDeck || hasMixer) {
    // Tear down whatever the engine boot created and rebuild from saved
    // state. Boot installs a single deck channel; we destroy it
    // explicitly because the replacement may use the same id (`ch_base`)
    // and we don't want a duplicate handle to leak.
    if (mixer.getDeckChannel()) mixer.removeDeckChannel();
    for (const overlay of [...mixer.getMixerChannels()]) {
      mixer.removeMixerChannel(overlay.id);
    }

    if (hasDeck) {
      restoreChannel(deckState.channel, 'deck');
    } else {
      restoreChannel({
        id: 'ch_base',
        name: 'Base',
        pattern: opts.pattern,
        mode: 'blend_screen',
        fader: 1.0,
        enabled: true
      }, 'deck');
    }

    if (hasMixer) {
      for (const saved of mixerState.channels) {
        // Defensive: skip any leaked deck-shaped id. The state_manager
        // migration also strips these on load, this is belt-and-braces.
        if (saved.id && saved.id.startsWith('ch_base')) continue;
        restoreChannel(saved, 'mixer');
      }
    }

    if (mixerState.master !== undefined) {
      mixer.setMaster(mixerState.master);
    }

    const base = mixer.getDeckChannel();
    if (base) opts.pattern = base.pattern;
  } else {
    if (mixer.getDeckChannel()) finalizeCpcValues(mixer.getDeckChannel());
    for (const ch of mixer.getMixerChannels()) finalizeCpcValues(ch);
  }

  // ── Channel serialization (post-split) ────────────────────────────
  //
  // After the May 2026 channel split, /mixer surfaces ONLY overlay
  // channels and /deck/channel surfaces the deck channel. The two
  // payloads use the same per-channel shape (so the iPad's renderer
  // doesn't have to fork). The deck channel is intentionally NOT
  // returned in the mixer broadcast — a regression test
  // (hil_channel_isolation_test.mjs) asserts this invariant on every
  // engine boot.
  function serializeChannel(c) {
    return {
      id: c.id,
      name: c.name,
      pattern: c.pattern,
      mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
      fader: c.fader,
      enabled: c.enabled,
      locked: !!c.locked,
      // Fader-lock: surfaced so CaptainPad can render the lock icon
      // and skip the channel in client-side solo gestures. Independent
      // of `locked` (the playlist/pattern lock). See
      // PatternChannel.faderLocked for the four semantic rules.
      faderLocked: !!c.faderLocked,
      // `dirty` is true iff the operator changed a param *while this
      // channel was locked*. Drives the unlock-time save-or-discard
      // prompt on the client. Cleared on lock toggle / capture /
      // discard / entry swap (see markChannelDirtyIfLocked +
      // clearChannelDirty).
      dirty: !!c._dirty,
      transitionMode: c.transitionMode || 'trans_crossfade',
      transitionTime: c.transitionTime || 1.0,
      playlist: c.playlist || null,
      viewSelection: c.viewSelection || { type: 'all', target: null, invert: false },
      // CPC-matched exports are tagged with `cpcOwned`/`cpcKey`/
      // `cpcLabel` so the iPad can show a disabled "MATCHED · SPEED"
      // badge instead of silently hiding them — see notes in the
      // pre-split serializer for the May 2026 reasoning.
      exports: wasmHost.getExports(c.handle)
        .filter(e => localControlKinds.has(e.kind))
        .map(e => {
          const cv = c.localControls[e.id];
          if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
          const owned = paramCenter ? paramCenter.cpcKeyForExport(c.id, e) : null;
          if (owned) {
            e.cpcOwned = true;
            e.cpcKey = owned.key;
            e.cpcLabel = owned.label;
          }
          return e;
        })
    };
  }

  function serializeDeckChannel() {
    const deck = mixer.getDeckChannel();
    return deck ? serializeChannel(deck) : null;
  }

  function serializeDeckState() {
    return {
      type: 'deck',
      blackout: globalsState.blackout,
      master: mixer.master,
      channel: serializeDeckChannel(),
    };
  }

  function broadcastDeckState() {
    broadcastWs(serializeDeckState());
  }

  // Single source of truth for serializing mixer state — used by
  // GET /mixer, broadcastMixerState(), and WS connect.
  //
  // Post-split: `channels` contains ONLY mixer overlays. The deck
  // channel goes through serializeDeckChannel(). `baseChannelId` is
  // surfaced for legacy clients that still want to display the deck's
  // id, but the deck channel itself is no longer in `channels`.
  function serializeMixerState() {
    return {
      type: 'mixer',
      blackout: globalsState.blackout,
      master: mixer.master,
      maxChannels: mixer.maxChannels,
      baseChannelId: mixer.baseChannelId,
      channels: mixer.getMixerChannels().map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
        fader: c.fader,
        enabled: c.enabled,
        locked: !!c.locked,
        // Fader-lock — see serializeChannel above for semantics.
        faderLocked: !!c.faderLocked,
        // `dirty` is true iff the operator changed a param *while this
        // channel was locked*. Drives the unlock-time save-or-discard
        // prompt on the client. Cleared on lock toggle / capture / discard
        // / entry swap (see markChannelDirtyIfLocked + clearChannelDirty).
        dirty: !!c._dirty,
        transitionMode: c.transitionMode || 'trans_crossfade',
        transitionTime: c.transitionTime || 1.0,
        // View-selection: per-channel masking config (which group/section/
        // fixture/viewMask the channel paints). Broadcast so CaptainPad
        // can show / set the selection per channel strip. See
        // docs/27_[todo]_mixer_layer_view_selection.md.
        viewSelection: c.viewSelection || { type: 'all', target: null, invert: false },
        // Playlist assignment is the "where am I right now in this slot"
        // pointer. Broadcasting it lets the deck and mixer panels detect
        // cross-tab swaps without polling.
        playlist: c.playlist || null,
        // CPC-matched exports used to be filtered out here. As of
        // May 2026 they're SURFACED with a `cpcOwned` / `cpcKey` /
        // `cpcLabel` tag so the UI can show a disabled "MATCHED ·
        // SPEED" badge instead of silently hiding them — operators
        // want to see what each pattern declares, even when a global
        // is driving the underlying variable. The /control write
        // path still no-ops on these exports (getReplayableLocalExport
        // returns null for shared IDs), so re-exposing them in the
        // payload doesn't open a back-channel write.
        exports: wasmHost.getExports(c.handle)
          .filter(e => localControlKinds.has(e.kind))
          .map(e => {
            const cv = c.localControls[e.id];
            if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
            const owned = paramCenter ? paramCenter.cpcKeyForExport(c.id, e) : null;
            if (owned) {
              e.cpcOwned = true;
              e.cpcKey = owned.key;
              e.cpcLabel = owned.label;
            }
            return e;
          })
      }))
    };
  }

  function broadcastMixerState() {
    // Post-split: every "mixer changed" event also implicitly carries
    // deck-state implications (e.g. master changed; blackout flipped;
    // playlist entries fired CPC writes that the deck cares about).
    // Broadcast BOTH events back-to-back so subscribers only have to
    // pick the message type they care about. Deck-only changes have
    // their own callers that fire just `broadcastDeckState()`.
    broadcastWs(serializeMixerState());
    broadcastWs(serializeDeckState());
  }

  // ── Channel-id role enforcement ─────────────────────────────────────
  //
  // Bullet-proofs the deck-vs-mixer isolation at the API boundary. The
  // mixer routes (`/mixer/channels/:id/...`) must NEVER accept the
  // deck channel's id; the deck routes (`/deck/...`) must never accept
  // a mixer overlay's id.
  //
  //   - returns null if `id` is appropriate for the given role
  //   - returns a `{ status, body }` triple the route handler should
  //     send back to the client otherwise
  function rejectIfWrongRole(id, role /* 'mixer' | 'deck' */) {
    if (role === 'mixer') {
      if (mixer.deckChannel && id === mixer.deckChannel.id) {
        return {
          status: 400,
          body: {
            error: 'deck channel cannot be addressed via /mixer routes',
            code: 'WRONG_ROLE',
            channelId: id,
            useInstead: '/deck/channel',
          },
        };
      }
    } else if (role === 'deck') {
      if (mixer.deckChannel && id !== mixer.deckChannel.id) {
        return {
          status: 400,
          body: {
            error: 'this id is not the deck channel',
            code: 'WRONG_ROLE',
            channelId: id,
            useInstead: `/mixer/channels/${encodeURIComponent(id)}`,
          },
        };
      }
    }
    return null;
  }

  // Push the FULL playlist content (entries + defaults) for a channel
  // out over WS as a dedicated event, so every connected client can
  // prime its per-name playlist cache without having to issue a
  // follow-up GET /playlists/<name>. Called on channel add and on
  // playlist swap — both right BEFORE broadcastMixerState() so the
  // iPad processes the cache-prime BEFORE it mounts the new
  // PlaylistPanel off the mixer event. Without this ordering,
  // the panel would race the POST response and risk timing out
  // on the entries fetch.
  function broadcastChannelPlaylistData(channel) {
    try {
      if (!channel || !channel.playlist || !channel.playlist.name) return;
      const pl = playlistManager.load(channel.playlist.name);
      if (!pl) return;
      broadcastWs({
        type: 'channelPlaylistData',
        channelId: channel.id,
        playlist: channel.playlist,
        playlistData: pl,
      });
    } catch (e) {
      console.warn('[api_server] broadcastChannelPlaylistData failed:', e.message);
    }
  }

  // ── Server-driven group transitions ───────────────────────────────────
  // The mixer's updateTransitions() runs once per render tick (40 Hz) and
  // calls back to us whenever a transition is making progress. We throttle
  // those frame-rate callbacks down to 10 Hz of WS broadcasts so the iPad's
  // slider UI updates smoothly without flooding the WS. On completion we
  // do ONE save + broadcast — that's the canonical end-of-transition state.
  // Per agent review (May 2026): the completion callback fires exactly
  // once per transition group, even if N channels finish on the same tick,
  // so we never call saveAllState() N times.
  let lastTransitionBroadcastMs = 0;
  mixer.onTransitionProgress = () => {
    const now = Date.now();
    if (now - lastTransitionBroadcastMs >= 100) {
      lastTransitionBroadcastMs = now;
      broadcastMixerState();
    }
  };
  mixer.onTransitionComplete = ({ transitionId } = {}) => {
    lastTransitionBroadcastMs = 0; // unthrottle the next transition's first broadcast
    saveAllState();
    broadcastWs({
      type: 'mixerTransitionComplete',
      transitionId: transitionId || null,
    });
    broadcastMixerState();
  };

  // Single payload shape used by every autopilot writer. Kept on its own
  // WS event type so subscribers (CaptainPad's deck tab, future PortWatch
  // mirror, etc.) can wire `if (msg.type === 'autopilot') …` without
  // having to scrape the larger mixer broadcast.
  function broadcastAutopilot() {
    const st = autopilot.state || {};
    broadcastWs({
      type: 'autopilot',
      active: !!st.active,
      delay_s: st.delay_s !== undefined ? String(st.delay_s) : '30',
      shuffle: !!st.shuffle,
    });
  }

  // The "view override" pins the engine output to the deck regardless of
  // any subsequent /mixer/view writes from another panel. When cleared,
  // we restore whatever target the user last picked. Implemented on the
  // server (instead of mutating mixer.targetViewFader directly) so the
  // pre-override target survives even if the live mixer panel keeps
  // sending writes while we're held in deck. A WS broadcast keeps every
  // UI honest about whether the override is engaged.
  //
  // The override is also surfaced as the `controlLock` field of
  // `globalsState` — making it a first-class entry in the unified
  // global-parameters interface. Once `controlLock === 'portwatch'`,
  // every UI in the building (CaptainPad, future control surfaces,
  // diagnostic dashboards) reads off that one field to decide whether
  // to disable interactive controls. This avoids a parallel
  // "is-locked" mechanism per client and means a fresh client
  // hitting `/globals` on boot already sees the lock state without
  // needing to subscribe to the WS event first.
  //
  // Boot-time hydration: if the engine restarted while a lock was
  // engaged, we honour the persisted value but we only know it was
  // a deck-pin (the only kind we set). Restoring the saved view
  // fader is impossible — we have no record — so we leave the engine
  // wherever its persisted mixerState put it and let the operator
  // release explicitly.
  let viewOverrideMode =
    (globalsState && globalsState.controlLock === 'portwatch') ? 'deck' : null;
  let savedTargetViewFader = null;       // float pre-override

  // ── controlLock lease ───────────────────────────────────────────────
  //
  // The lock is a LEASE, not a permanent take. The owner (PortWatch
  // today) must renew within `CONTROL_LOCK_LEASE_MS` or the engine
  // auto-clears the override and CaptainPad regains control. This
  // protects against:
  //
  //   * a phone walking out of LoRa range while holding the lock
  //   * the PortWatch app crashing / being force-quit
  //   * the bridge or radio link going down silently
  //
  // Without the lease, any of those would permanently lock CaptainPad
  // out and require a manual engine restart. With a 30 s lease and a
  // ~20 s client-side renew cadence, the worst-case lockout is one
  // missed beat of operator visibility.
  //
  // Renewal happens via the same POST /mixer/view-override {override:
  // 'deck'} call that takes the lock — every successful POST resets
  // the timer. The wire surface stays minimal (no new endpoint), and
  // clients that just want to take the lock once still work — they
  // either renew or they let the lease expire.
  const CONTROL_LOCK_LEASE_MS = 30_000;
  let controlLockLeaseTimer = null;
  let controlLockLeaseExpiresAtMs = null;

  function clearViewOverrideInternal() {
    if (viewOverrideMode === 'deck' && savedTargetViewFader !== null) {
      mixer.targetViewFader = savedTargetViewFader;
    }
    viewOverrideMode = null;
    savedTargetViewFader = null;
  }

  function disarmControlLockLease() {
    if (controlLockLeaseTimer !== null) {
      clearTimeout(controlLockLeaseTimer);
      controlLockLeaseTimer = null;
    }
    controlLockLeaseExpiresAtMs = null;
  }

  function armControlLockLease() {
    // Restart the timer on every arm. setTimeout is cheap and the
    // resolution doesn't need to be tighter than 1 s.
    if (controlLockLeaseTimer !== null) {
      clearTimeout(controlLockLeaseTimer);
    }
    controlLockLeaseExpiresAtMs = Date.now() + CONTROL_LOCK_LEASE_MS;
    controlLockLeaseTimer = setTimeout(() => {
      // Lease expired with no renew — auto-release. Same code path as
      // a manual `view/clear` so every UI sees the standard
      // viewOverride broadcast and reacts identically. We
      // intentionally do NOT bypass syncControlLockToGlobals here:
      // CaptainPad's overlay clears via the globals fan-out, not via
      // a separate "lease expired" event.
      controlLockLeaseTimer = null;
      controlLockLeaseExpiresAtMs = null;
      if (viewOverrideMode !== 'deck') return;
      clearViewOverrideInternal();
      syncControlLockToGlobals();
      broadcastViewOverride();
      console.log('[viewOverride] lease expired — released to CaptainPad');
    }, CONTROL_LOCK_LEASE_MS);
  }

  function controlLockLeaseRemainingMs() {
    if (controlLockLeaseExpiresAtMs === null) return 0;
    return Math.max(0, controlLockLeaseExpiresAtMs - Date.now());
  }

  function broadcastViewOverride() {
    broadcastWs({
      type: 'viewOverride',
      override: viewOverrideMode,           // 'deck' | null
      // Mirror the engine-globals view of the same fact. We deliberately
      // namespace it ("controlLock") rather than reusing "viewOverride"
      // so listeners can tell at a glance whether they're looking at
      // raw view-fader state or "who owns the rig right now".
      controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
      // Lease metadata — every UI can render a countdown without
      // needing to subscribe to a separate event. expiresAt is an
      // absolute UNIX ms timestamp so clients with skewed clocks
      // can still compute "remaining = max(0, expiresAt - now)" off
      // a synchronised time source if they care.
      controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
      controlLockLeaseDurationMs: viewOverrideMode === 'deck'
        ? CONTROL_LOCK_LEASE_MS
        : null,
      currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
      savedView: savedTargetViewFader === null
        ? null
        : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
    });
  }

  // Persist the override into globalsState as a single source of truth.
  // Called by every code path that flips `viewOverrideMode`, and on
  // boot to seed the initial value. Idempotent + cheap (saveGlobalsState
  // batches via the same hook the rest of the globals use).
  function syncControlLockToGlobals() {
    const next = viewOverrideMode === 'deck' ? 'portwatch' : null;
    if ((globalsState.controlLock || null) !== next) {
      globalsState.controlLock = next;
      try {
        stateManager.saveGlobalsState(globalsState, paramCenter);
      } catch (err) {
        // Persistence failure shouldn't break the in-memory state —
        // worst case the lock isn't restored on the next engine
        // restart, which is the safe direction (everything unlocks).
        console.warn('Failed to persist controlLock:', err && err.message);
      }
    }
  }
  // Seed globalsState on boot in case it was missing the field
  // (older saved state has no `controlLock`).
  syncControlLockToGlobals();
  // If we restored a `controlLock === 'portwatch'` from disk, arm a
  // fresh lease so the lock doesn't outlive the engine restart by
  // more than CONTROL_LOCK_LEASE_MS. Without this, a crash while
  // someone held the lock would silently strand CaptainPad after
  // boot until an operator manually cleared the override.
  if (viewOverrideMode === 'deck') {
    armControlLockLease();
  }

  // Initialize Autopilot Daemon. We are always in playlist mode, so the
  // "current key" is the active entry id and the swap target is the next
  // entry in the deck channel's playlist.
  const autopilot = new Autopilot(
    listPatterns,
    patternsDir,
    () => {
      const baseCh = mixer.getDeckChannel();
      return baseCh && baseCh.playlist ? baseCh.playlist.activeEntryId : null;
    },
    async () => {
      const baseCh = mixer.getDeckChannel();
      if (!baseCh || !baseCh.playlist || !baseCh.playlist.name) return;
      try {
        const pl = playlistManager.load(baseCh.playlist.name);
        if (!pl || pl.entries.length === 0) return;
        const usable = pl.entries.filter(e => !e._missing);
        if (usable.length === 0) return;

        const cur = baseCh.playlist.activeEntryId;
        let nextEntry;
        if (baseCh.playlist.autopilot && baseCh.playlist.autopilot.shuffle) {
          const others = usable.filter(e => e.id !== cur);
          nextEntry = others.length ? others[Math.floor(Math.random() * others.length)] : usable[0];
        } else {
          const idx = pl.entries.findIndex(e => e.id === cur);
          // Walk forward until we hit a non-missing entry.
          let nextIdx = (idx + 1) % pl.entries.length;
          for (let i = 0; i < pl.entries.length; i++) {
            if (!pl.entries[nextIdx]._missing) { nextEntry = pl.entries[nextIdx]; break; }
            nextIdx = (nextIdx + 1) % pl.entries.length;
          }
        }
        if (!nextEntry) return;
        // Route through the deck-transition path: if the operator has
        // enabled transitions, the load runs as a smooth double-buffer
        // swap; otherwise it falls back to the instant load that
        // `loadPlaylistEntryWithTransition` does internally. We AWAIT
        // the `done` Promise so the autopilot daemon can keep its
        // inter-pattern timer decoupled from the transition duration:
        //
        //   - With delay=1s + transition=5s the cycle is
        //     "show pattern 1s → run transition 5s → wait 1s → swap again"
        //   - The autopilot's self-rescheduling setTimeout only schedules
        //     the next tick AFTER this awaits resolves.
        const r = loadPlaylistEntryWithTransition(
          baseCh, baseCh.playlist.name, nextEntry.id, deckTransitionConfig,
        );
        if (r && r.done && typeof r.done.then === 'function') {
          await r.done;
        }
      } catch (e) {
        if (e && e.code === 'EBUSY') {
          // A manual operator tap landed first and is still animating —
          // skip this autopilot beat, the next setTimeout cycle will
          // pick up the new active entry as its baseline.
          console.warn('[Autopilot] tick skipped: swap already in flight');
        } else {
          console.warn('Autopilot playlist swap failed:', e.message);
        }
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
      const baseChannel = mixer.getDeckChannel();
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
        const allChannels = [
          ...(mixer.getDeckChannel() ? [mixer.getDeckChannel()] : []),
          ...mixer.getMixerChannels(),
        ];
        allChannels.forEach(ch => {
          if (ch.pattern === patternName) {
            const compNew = wasmHost.compile(data.code);
            if (compNew.ok) {
              if (ch.handle) wasmHost.destroy(ch.handle);
              ch.handle = compNew.handle;
              onChannelCompiled(ch);
              // Re-apply playlist entry defaults if a playlist+entry is active.
              const pl = ch.playlist && ch.playlist.name && playlistManager.load(ch.playlist.name);
              const entry = pl && ch.playlist.activeEntryId &&
                pl.entries.find(e => e.id === ch.playlist.activeEntryId);
              if (entry && !entry._missing) {
                playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
              }
              finalizeCpcValues(ch);
            }
          }
        });
        
        saveAllState();
        broadcastMixerState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if ((req.method === 'PUT' || req.method === 'POST') && (req.url === '/pattern' || req.url === '/set-pattern')) {
      readBody(data => {
        try {
          if (!data.pattern) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'pattern required' }));
          }
          const patternName = path.basename(data.pattern, '.js');

          // Compile FIRST so we never tear down the live deck channel
          // for a pattern that turns out to fail to compile / load.
          // PortWatch hits us over LoRa with whatever name landed in
          // its (possibly stale or partially-fetched) catalog, so a
          // bad name is a routine, recoverable case — not a reason
          // to leave the deck channel-less and the rig dark.
          let src;
          try {
            src = loadPattern(patternsDir, patternName);
          } catch (loadErr) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: String(loadErr.message || loadErr) }));
          }
          const comp = wasmHost.compile(src);
          if (!comp.ok) {
            res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
          }

          // Legacy /set-pattern replaces the deck channel's WASM handle
          // with the freshly compiled pattern. Post-channel-split this
          // is dramatically simpler: the deck slot is its own field, so
          // we don't have to dance around mixer overlay slots or do the
          // "below cap / at cap" two-branch swap that the old combined
          // array required. The deck id stays STABLE (we just swap the
          // handle in place) so CaptainPad's PlaylistPanel keeps its
          // /mixer/channels/<id>/playlist fetches valid.
          const oldBase = mixer.getDeckChannel();
          const oldPlaylist = oldBase ? oldBase.playlist : null;
          const oldBaseId = oldBase ? oldBase.id : null;
          const oldHandle = oldBase ? oldBase.handle : null;

          let newChannel;
          if (oldBase) {
            // In-place handle swap on the existing deck channel —
            // preserves id, faders, exports list, etc.
            oldBase.handle = comp.handle;
            oldBase.pattern = patternName;
            oldBase.mode = 'blend_screen';
            oldBase.fader = 1.0;
            oldBase.enabled = true;
            oldBase.localControls = {};
            newChannel = oldBase;
            if (oldHandle && oldHandle !== comp.handle) {
              try { wasmHost.destroy(oldHandle); } catch (_) {}
            }
          } else {
            newChannel = mixer.setDeckChannel({
              id: 'ch_base_' + Date.now(),
              name: 'Base',
              pattern: patternName,
              handle: comp.handle,
              mode: 'blend_screen',
              fader: 1.0,
              enabled: true,
            });
          }
          if (oldPlaylist) {
            // Re-attach the playlist, but pick the first entry whose
            // pattern matches the one we just loaded so the panel in
            // CaptainPad highlights the right row. Without this the
            // legacy /set-pattern path (used by PortWatch over LoRa
            // and by anything calling `cmd pattern/<name>`) would
            // render the new pattern but leave activeEntryId pinned
            // to whatever was active before — making CaptainPad's
            // playlist UI lie about what's on stage.
            try {
              const pl = playlistManager.load(oldPlaylist.name);
              const entry = (pl && Array.isArray(pl.entries))
                ? pl.entries.find(e => e && e.pattern === patternName)
                : null;
              newChannel.playlist = {
                ...oldPlaylist,
                activeEntryId: entry ? entry.id : null,
              };
            } catch (_) {
              // Playlist file may have been deleted out from under us.
              // Falling back to the old assignment is fine — the panel
              // will refresh on the next mixer broadcast.
              newChannel.playlist = oldPlaylist;
            }
          }

          opts.pattern = patternName;
          onChannelCompiled(newChannel);
          finalizeCpcValues(newChannel);
          saveAllState();

          broadcastWs({ type: 'pattern', name: patternName });
          broadcastMixerState();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', pattern: opts.pattern }));
        } catch (err) {
          // Last-resort guard: anything that escaped above should
          // become a clean 500 rather than crashing the engine and
          // dropping sACN entirely. The bridge surfaces it as
          // `nak engine_error` and PortWatch leaves the deck on the
          // previously-active pattern.
          try {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err && err.message || err) }));
          } catch (_) { /* response already sent */ }
        }
      });
    } else if (req.method === 'POST' && req.url === '/control') {
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setControl(data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        // Legacy /control targets the deck base channel; auto-capture into
        // its active playlist entry so the deck's playlist stays in sync.
        scheduleEntryCapture(mixer.baseChannelId);
        markChannelDirtyIfLocked(mixer.baseChannelId);
        saveAllState();
        broadcastMixerState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', id: data.id }));
      });
    } else if (req.method === 'GET' && req.url === '/dimmer-groups') {
      // Build group→sectionId map from model pixels
      const groups = {};
      if (model && model.pixels) {
        for (const px of model.pixels) {
          if (px.group && px.sId > 0 && !groups[px.group]) {
            groups[px.group] = px.sId;
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(groups));
    } else if (req.method === 'GET' && req.url === '/dimmers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalsState.dimmers || {}));

    // ── Group fixed colors (docs/32) ─────────────────────────────────
    // Per-group color locks driven by the CaptainPad Dimmer Rack.
    // GET    /group-fixed-colors          → { groups, overrides }
    // PUT    /group-fixed-colors/:group   → set/replace override
    // DELETE /group-fixed-colors/:group   → clear override
    // Group names are URL-encoded in the path (names may have spaces).
    } else if (req.method === 'GET' && req.url === '/group-fixed-colors') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        groups: listModelGroups(),
        overrides: globalEffectsController ? globalEffectsController.groupFixedColors : {},
      }));
    } else if ((req.method === 'PUT' || req.method === 'DELETE')
               && req.url.startsWith('/group-fixed-colors/')) {
      const m = req.url.match(/^\/group-fixed-colors\/(.+)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      if (!globalEffectsController) {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'effects controller not initialized' }));
      }
      let group;
      try {
        group = decodeURIComponent(m[1]);
      } catch (e) {
        res.writeHead(400); return res.end(JSON.stringify({ error: `bad group encoding: ${e.message}` }));
      }
      if (req.method === 'DELETE') {
        const removed = globalEffectsController.clearGroupFixedColor(group);
        if (globalsState.groupFixedColors) delete globalsState.groupFixedColors[group];
        stateManager.saveGlobalsState(globalsState);
        broadcastWs({ type: 'groupFixedColors', overrides: globalEffectsController.groupFixedColors });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', group, removed }));
      }
      readBody(data => {
        try {
          // Reject unknown groups loudly — a typo'd group name must not
          // become a silent no-op override (codex P0).
          const known = listModelGroups();
          if (!known.includes(group)) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `unknown group '${group}' (model groups: ${known.join(', ')})` }));
          }
          globalEffectsController.setGroupFixedColor(group, data.color, data.brightness);
          if (!globalsState.groupFixedColors) globalsState.groupFixedColors = {};
          globalsState.groupFixedColors[group] = {
            color: [...data.color],
            brightness: data.brightness,
          };
          stateManager.saveGlobalsState(globalsState);
          broadcastWs({ type: 'groupFixedColors', overrides: globalEffectsController.groupFixedColors });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', group, override: globalEffectsController.groupFixedColors[group] }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
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

    // ── Global Effect Macros (docs/28 §5) ────────────────────────────
    } else if (req.method === 'GET' && req.url === '/global-effect-library') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ effects: describeLibrary() }));
    } else if (req.method === 'GET' && req.url === '/global-effect-slots') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ slots: globalEffectSlotManager.getSlots() }));
    } else if (req.method === 'GET' && req.url === '/global-effect-slots/status') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        slots: globalEffectSlotManager.getStatus(),
        controller: globalEffectsController && globalEffectsController.getStatus
          ? globalEffectsController.getStatus()
          : null,
      }));
    } else if (req.method === 'PATCH' && req.url === '/global-effect-slots') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      readBody(data => {
        try {
          if (!Array.isArray(data.slots)) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'body must include slots: array' }));
          }
          globalEffectSlotManager.setSlots(data.slots);
          stateManager.saveGlobalEffectSlots(globalEffectSlotManager.getSlots());
          broadcastWs({ type: 'globalEffectSlots', slots: globalEffectSlotManager.getSlots() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ slots: globalEffectSlotManager.getSlots() }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/global-effect-macros/panic-stop') {
      if (!globalEffectsController || !globalEffectsController.panicStop) {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'macros controller not initialized' }));
      }
      globalEffectsController.panicStop();
      broadcastWs({ type: 'globalEffectMacroStatus',
        controller: globalEffectsController.getStatus(),
        slots: globalEffectSlotManager ? globalEffectSlotManager.getStatus() : [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));

    // E-stop. Unified blackout endpoint that:
    //   1. Sets the IntensityController blackout flag (pixel-level kill).
    //   2. Kills every active macro / legacy global effect (panic stop)
    //      so when blackout is released the rig wakes up to a clean
    //      slate instead of resuming the strobe/wash/etc. that was
    //      running at e-stop time. This is the operator's expectation
    //      from the "e-stop" framing.
    //   3. Persists globalsState.blackout so the next boot honours it.
    //
    // Body: { enabled: boolean }. Returns the resolved blackout flag.
    } else if (req.method === 'POST' && req.url === '/global-effect-macros/blackout') {
      readBody(data => {
        if (typeof data.enabled !== 'boolean') {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'enabled boolean required' }));
        }
        if (intensityController) intensityController.setBlackout(data.enabled);
        globalsState.blackout = data.enabled;
        // E-stop also clears the macro/legacy state when ENABLING so a
        // release leaves the rig dark instead of resuming whatever
        // strobe/wash was running at e-stop time.
        if (data.enabled && globalEffectsController && globalEffectsController.panicStop) {
          globalEffectsController.panicStop();
        }
        stateManager.saveGlobalsState(globalsState);
        broadcastMixerState();
        broadcastWs({ type: 'globalEffectMacroStatus',
          controller: globalEffectsController ? globalEffectsController.getStatus() : null,
          slots: globalEffectSlotManager ? globalEffectSlotManager.getStatus() : [],
          blackout: data.enabled,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', blackout: data.enabled }));
      });
    } else if (req.method === 'PATCH' && req.url.startsWith('/global-effect-slots/')) {
      // PATCH /global-effect-slots/:slotId
      const m = req.url.match(/^\/global-effect-slots\/(\d+)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const slotId = parseInt(m[1], 10);
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      readBody(data => {
        try {
          const slot = globalEffectSlotManager.patchSlot(slotId, data || {});
          stateManager.saveGlobalEffectSlots(globalEffectSlotManager.getSlots());
          broadcastWs({ type: 'globalEffectSlots', slots: globalEffectSlotManager.getSlots() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ slot }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.startsWith('/global-effect-slots/')) {
      // POST /global-effect-slots/:slotId/{activate,deactivate,trigger}
      const m = req.url.match(/^\/global-effect-slots\/(\d+)\/(activate|deactivate|trigger|toggle|down|up)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const slotId = parseInt(m[1], 10);
      const action = m[2];
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      try {
        const frameIndex = engineCore.getFrameIndex ? engineCore.getFrameIndex() : 0;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        globalEffectSlotManager.dispatchSlotAction({ slotId, action, frameIndex, nowMs });
        broadcastWs({ type: 'globalEffectMacroStatus',
          slots: globalEffectSlotManager.getStatus(),
          controller: globalEffectsController.getStatus(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          slotId, action,
          controller: globalEffectsController.getStatus(),
        }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }

    // ── Scheduled tasks (docs/31_scheduled_tasks.md) ────────────────
    // Engine-owned schedule that fires GEM slots on a timer. CaptainPad
    // is a thin client over these endpoints + the `scheduledTasks` WS
    // broadcast. All validation errors return 400 with a human-readable
    // message — never silently clamp (codex P0).
    } else if (req.method === 'GET' && req.url === '/scheduled-tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tasks: scheduledTaskService.list(),
        presets: {
          onDurationMs: [...ON_DURATION_PRESETS_MS],
          intervalMs:   [...INTERVAL_PRESETS_MS],
        },
      }));
    } else if (req.method === 'POST' && req.url === '/scheduled-tasks') {
      readBody(data => {
        try {
          const task = scheduledTaskService.create(data || {});
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } catch (e) {
          const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
          res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if ((req.method === 'PATCH' || req.method === 'DELETE' || req.method === 'POST')
               && req.url.startsWith('/scheduled-tasks/')) {
      // The id path uses URL-safe characters; allow letters, digits,
      // dash, underscore (covers crypto.randomUUID() output + the
      // operator-friendly slugs the doc shows in YAML examples).
      const m = req.url.match(/^\/scheduled-tasks\/([A-Za-z0-9_-]+)(?:\/(fire-now|stop))?$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const id = m[1];
      const sub = m[2] || null;

      try {
        if (req.method === 'PATCH' && !sub) {
          readBody(data => {
            try {
              const task = scheduledTaskService.patch(id, data || {});
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ task }));
            } catch (e) {
              const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
              res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else if (req.method === 'DELETE' && !sub) {
          scheduledTaskService.delete(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.method === 'POST' && sub === 'fire-now') {
          const task = scheduledTaskService.fireNow(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } else if (req.method === 'POST' && sub === 'stop') {
          const task = scheduledTaskService.stop(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } else {
          res.writeHead(404); res.end('Not Found');
        }
      } catch (e) {
        const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
        res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
      }

    } else if (req.method === 'GET' && req.url === '/globals') {
      // Always reflect the LIVE override state alongside whatever was
      // persisted to disk — the in-memory `viewOverrideMode` is the
      // canonical source of truth (it can change without an immediate
      // save), and a CaptainPad client polling /globals before any WS
      // event lands needs to see the same value the broadcast would
      // have shown.
      const live = {
        ...globalsState,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(live));
    } else if (req.method === 'GET' && req.url === '/autopilot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(autopilot.state));
    } else if (req.method === 'POST' && req.url === '/autopilot') {
      readBody(data => {
        autopilot.updateState(data);
        // ── Mirror into deck base channel's per-playlist autopilot ──
        // The actual "advance to next entry" runner in the autopilot
        // callback (see `new Autopilot(...)` above) reads
        // `baseCh.playlist.autopilot.shuffle` to decide between
        // shuffle and sequential. Without this mirror, the iPad would
        // toggle the SHUFFLE pill, the Autopilot daemon would store
        // it in its own config.yaml, but the runner would still see
        // `baseCh.playlist.autopilot.shuffle === false` and keep
        // walking the playlist sequentially. Fixed May 2026.
        try {
          const baseCh = mixer.getDeckChannel();
          if (baseCh) {
            baseCh.playlist = baseCh.playlist || { name: null, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            const ap = baseCh.playlist.autopilot = baseCh.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
            if (data.active !== undefined) ap.active = !!data.active;
            if (data.delay_s !== undefined) ap.delay_s = parseInt(data.delay_s, 10) || 30;
            if (data.shuffle !== undefined) ap.shuffle = !!data.shuffle;
            saveAllState();
            broadcastMixerState();
          }
        } catch (e) {
          console.warn('[Autopilot] mirror-to-deck failed:', e.message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(autopilot.state));
        // External writers (PortWatch over LoRa, scripts, etc.) need the
        // CaptainPad UI to reflect their flips immediately. Broadcast on
        // every transition so the existing `engineEvents` bus on the iPad
        // can mirror state without polling.
        broadcastAutopilot();
      });
    }
    // ---- MODEL METADATA ----
    // Lightweight enumeration of the model's view-selection targets
    // (groups, sections, fixtures, and the union of viewMask bits the
    // model actually uses). Consumed by the CaptainPad mixer strip so
    // it can populate the view-selection picker WITHOUT having to ship
    // the full pixel list. Pure read; safe to hit at panel mount time.
    else if (req.method === 'GET' && req.url === '/model/view-selection-options') {
      const pixels = (model && Array.isArray(model.pixels)) ? model.pixels : [];
      const groups = new Set();
      const sections = new Set();
      const fixtures = new Set();
      let viewMaskUnion = 0;
      for (const px of pixels) {
        if (typeof px.group === 'string' && px.group.length > 0) groups.add(px.group);
        const sId = px.sId ?? px.sectionId;
        if (Number.isInteger(sId)) sections.add(sId);
        const fId = px.fId ?? px.fixtureId;
        if (Number.isInteger(fId)) fixtures.add(fId);
        const vMask = px.vMask ?? px.viewMask;
        if (Number.isInteger(vMask)) viewMaskUnion |= vMask;
      }
      // Named view-mask presets the model author declared (e.g.
      // [{name:'MainShow', bit:2}, ...]). Picker rows in the CaptainPad
      // mixer strip render straight from this array, so we strip any
      // malformed entries here rather than push that work onto the iPad.
      // We also enrich each entry with `inUse` = whether ANY pixel has
      // that bit set, so the picker can dim presets that the operator
      // hasn't tagged any fixtures with yet (without removing them —
      // they may belong to a future scene).
      const rawViewMasks = (model && Array.isArray(model.viewMasks)) ? model.viewMasks : [];
      const viewMasks = rawViewMasks
        .filter(vm => vm && typeof vm.name === 'string' && vm.name.length > 0 && Number.isInteger(vm.bit))
        .map(vm => ({
          name: vm.name,
          bit: vm.bit,
          inUse: (viewMaskUnion & vm.bit) !== 0,
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        groups: [...groups].sort(),
        sections: [...sections].sort((a, b) => a - b),
        fixtures: [...fixtures].sort((a, b) => a - b),
        viewMaskUnion,
        viewMasks,
        // Group→bit table for this model (pinned by the sidecar or
        // derived at load time — docs/13 §4.5.1) and the MASK_* pattern
        // constants built from it. Surfaced so operators, tools, and
        // pattern authors can verify the assignment instead of guessing
        // at bit values.
        groupBits: (model && model.groupBits) || {},
        maskConstants: (model && model.maskConstants) || {},
        pixelCount: pixels.length,
      }));
    }
    // ---- MIXER API ----
    else if (req.method === 'GET' && req.url === '/mixer') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serializeMixerState()));
    } else if (req.method === 'PATCH' && req.url === '/mixer') {
      readBody(data => {
        if (data.master !== undefined) mixer.setMaster(data.master);
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/channels') {
      // Add a mixer channel. Two ways to call this, both are playlist-driven:
      //  1. {playlist:'<name>', playlistEntryId?:'<id>'} — load that playlist
      //     onto the new channel; pattern comes from the entry.
      //  2. {pattern:'<name>'} — legacy; we still attach the 'default' playlist
      //     afterwards so every channel is always in playlist mode.
      readBody(data => {
        let playlistName = data.playlist;
        let entryId = data.playlistEntryId;
        let patternName;

        // Resolve pattern + playlist together so we always end up with a
        // channel that has a playlist assignment.
        if (playlistName) {
          const pl = playlistManager.load(playlistName);
          if (!pl) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist not found: ${playlistName}` }));
          }
          const usable = pl.entries.filter(e => !e._missing);
          if (usable.length === 0) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist ${playlistName} has no usable entries` }));
          }
          const entry = entryId
            ? pl.entries.find(e => e.id === entryId && !e._missing) || usable[0]
            : usable[0];
          entryId = entry.id;
          patternName = entry.pattern;
        } else if (data.pattern) {
          patternName = path.basename(data.pattern, '.js');
          playlistName = 'default';
        } else {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'playlist or pattern required' }));
        }

        const src = loadPattern(patternsDir, patternName);
        const comp = wasmHost.compile(src);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        // Validate (optional) initial view-selection before we burn a
        // WASM handle. Invalid payloads MUST 400 so the operator sees
        // the typo instead of getting a silently-defaulted channel.
        let initialViewSelection = { type: 'all', target: null, invert: false };
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          initialViewSelection = v.value;
        }
        // Channel ids combined Date.now() + a per-process monotonic counter
        // so two POSTs in the same millisecond can never collide. The old
        // pure-Date.now() id caused the second-and-later rapid adds to
        // silently overwrite each other.
        //
        // Wrap mixer.addChannel in an explicit try so the iPad sees a
        // real error message (e.g. "Maximum of 6 channels allowed")
        // instead of readBody's generic "Invalid JSON" — the latter is
        // what made the "tried to add a channel and it said Adding but
        // nothing happened" bug so hard to diagnose.
        let channel;
        try {
          channel = mixer.addMixerChannel({
            id: 'ch_' + Date.now() + '_' + (channelIdCounter++),
            name: data.name || 'New Layer',
            pattern: patternName,
            handle: comp.handle,
            mode: data.mode || 'blend_screen',
            fader: data.fader !== undefined ? data.fader : 1.0,
            enabled: true,
            viewSelection: initialViewSelection
          });
        } catch (addErr) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: String(addErr.message || addErr) }));
        }
        onChannelCompiled(channel);

        // Attach the playlist + (best-effort) load the chosen entry. If we
        // came in via the legacy {pattern:...} path, just stamp the playlist
        // name without forcing an entry switch so the channel keeps the
        // requested pattern.
        try {
          if (data.playlist) {
            loadPlaylistEntry(channel, playlistName, entryId);
          } else {
            channel.playlist = { name: playlistName, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
          }
        } catch (e) {
          console.warn(`[Mixer] Could not attach playlist ${playlistName} to new channel:`, e.message);
        }

        finalizeCpcValues(channel);
        saveAllState();
        // Emit playlist content on WS BEFORE the mixer broadcast so
        // every client primes its playlist cache before mounting the
        // new PlaylistPanel off the mixer event. See
        // broadcastChannelPlaylistData() for the why.
        broadcastChannelPlaylistData(channel);
        broadcastMixerState();
        // Bundle the FULL playlist data (entries, defaults) inline in
        // the response so the iPad's brand-new PlaylistPanel for this
        // channel never has to do a follow-up
        // GET /playlists/<name>. That follow-up was the bottleneck
        // under rapid-add load — the engine was busy broadcasting
        // mixer + vis, the GET would queue behind, and panels would
        // stall on "still loading" past their 8s fetch timeout. Now
        // the panel gets everything it needs to render the entry list
        // from this single response. See PlaylistPanel.tsx
        // initialPlaylist prop and CaptainPad/utils/api.ts
        // primePlaylistCache for the iPad side.
        let inlinePlaylistData = null;
        try {
          if (channel.playlist && channel.playlist.name) {
            const pl = playlistManager.load(channel.playlist.name);
            if (pl) inlinePlaylistData = pl;
          }
        } catch (_) {}
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          channelId: channel.id,
          pattern: channel.pattern,
          playlist: channel.playlist,
          playlistData: inlinePlaylistData,
        }));
      });
    } else if (req.method === 'PATCH' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        const reject = rejectIfWrongRole(id, 'mixer');
        if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
        const channel = mixer.getMixerChannel(id);
        if (!channel) { res.writeHead(404); return res.end(); }
        if (data.name !== undefined) channel.name = data.name;
        if (data.mode !== undefined) {
          // PATCH-driven mode change: clear any scripted-transition
          // restore so the operator's pick is sticky. Mirrors the WS
          // setChannelMode logic — see that handler for rationale.
          if (channel._savedMode) delete channel._savedMode;
          mixer.cancelChannelTransition(id);
          channel.mode = data.mode;
          mixer.getBlendHandle(data.mode);
        }
        if (data.fader !== undefined) {
          // Fader-lock: reject the fader portion silently (no-op) but
          // still process other fields in this PATCH. We do NOT 4xx
          // because operators bulk-PATCH multiple fields at once and a
          // hard error would block name / mode / enabled updates that
          // are still valid on a fader-locked channel. The next mixer
          // broadcast carries the unchanged fader so the iPad re-syncs.
          if (!channel.faderLocked) {
            // Manual fader writes ALWAYS cancel any in-flight transition
            // for that channel — mirrors WS setChannelFader (see above).
            mixer.cancelChannelTransition(id);
            channel.fader = data.fader;
          }
        }
        if (data.enabled !== undefined) channel.enabled = data.enabled;
        if (data.faderLocked !== undefined) {
          // Pure boolean toggle — orthogonal to `locked`. No transition
          // cleanup needed: an in-flight fade on this channel can
          // continue naturally (the locked flag will gate the NEXT
          // fadeChannel call), and we don't want to interrupt a
          // visually-mid-fade animation just because the operator
          // tapped the lock icon.
          channel.faderLocked = !!data.faderLocked;
        }
        if (data.transitionMode !== undefined) channel.transitionMode = data.transitionMode;
        if (data.transitionTime !== undefined) channel.transitionTime = data.transitionTime;
        // View-selection update: validate first so a typo can't brick
        // the render loop. The mixer recompiles the channel's
        // compiledPixelMask synchronously; the next frame composites
        // through the new mask.
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          mixer.setChannelViewSelection(id, v.value);
        }
        if (data.locked !== undefined) {
          const becameLocked = !channel.locked && !!data.locked;
          channel.locked = !!data.locked;
          // Lock just engaged — cancel any pending auto-capture so a timer
          // that armed pre-lock can't fire after lock and silently overwrite
          // the saved defaults the user is now trying to preserve.
          if (becameLocked) {
            const pending = captureTimers.get(channel.id);
            if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }
          }
          // Either direction: the dirty flag tracks edits made while locked.
          // Toggling the lock is a clean transition — any "dirty since last
          // resolve" state is no longer relevant after the user changes the
          // lock state through a deliberate UI action.
          clearChannelDirty(channel);
        }
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
            finalizeCpcValues(channel);
          } else {
            console.warn(`[Mixer] Pattern swap FAILED: ${patternName} compile error:`, comp.error);
          }
        }
        // PATCH might target ch_base, so persist deck state too.
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      if (paramCenter) paramCenter.unregisterChannel(id);
      mixer.removeMixerChannel(id);
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/control$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setChannelControl(id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        scheduleEntryCapture(id);
        markChannelDirtyIfLocked(id);
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/view') {
      // NOTE: this match must be exact-string, NOT a regex like
      // /\/mixer\/view/, otherwise it would also catch
      // /mixer/view-override and shadow the override handler below.
      readBody(data => {
        // While the override is engaged we still let the user pre-set
        // their next view; we save it so `clear` knows where to land,
        // but don't actually move the live fader.
        if (viewOverrideMode === 'deck') {
          if (data.view === 'deck') savedTargetViewFader = 0.0;
          else if (data.view === 'mixer') savedTargetViewFader = 1.0;
        } else {
          if (data.view === 'deck') mixer.targetViewFader = 0.0;
          else if (data.view === 'mixer') mixer.targetViewFader = 1.0;
        }
        if (data.deckChannel !== undefined) {
          mixer.deckFocusChannelId = data.deckChannel || null;
        }
        // ── Auto-finalize an in-flight deck swap on view → mixer ────
        // Per the operator's spec: navigating to the mixer tab while a
        // deck pattern transition is mid-flight should treat the
        // transition as complete, so coming back to the deck shows the
        // destination pattern fully (no half-blended buffer waiting
        // around invisibly). This snaps the shadow channel to the end,
        // promotes its handle onto the base channel, and fires the
        // same onComplete callback the natural completion path uses.
        if (data.view === 'mixer' && mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) {
          mixer.finishDeckSwapNow();
        }
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
        broadcastViewOverride();
      });
    } else if (req.method === 'POST' && req.url === '/mixer/view-override') {
      // Body shape: { override: 'deck' } or { override: null }
      // Forces the engine output to the deck side, regardless of any
      // /mixer/view writes that arrive while engaged. Clearing the
      // override snaps back to whatever target was active before.
      readBody(data => {
        const requested = (data && data.override) || null;
        if (requested === 'deck') {
          if (viewOverrideMode !== 'deck') {
            savedTargetViewFader = mixer.targetViewFader;
            mixer.targetViewFader = 0.0;
            viewOverrideMode = 'deck';
          }
          // (Re)arm the lease on every successful deck-pin POST. This
          // is the renew path: clients holding the lock POST again
          // every ~20s to refresh the 30s lease. Doing it for the
          // initial take too keeps the code single-pathed and means
          // a first take always starts the countdown.
          armControlLockLease();
        } else if (requested === null || requested === '' || requested === 'clear') {
          clearViewOverrideInternal();
          disarmControlLockLease();
        } else {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'override must be "deck" or null' }));
        }
        // Keep the unified globals view of the lock in sync — this is
        // what makes the override a "global parameter" across the rest
        // of the system. CaptainPad reads `controlLock` off /globals
        // (and off the broadcast below) to decide whether to lock its
        // UI; PortWatch's bridge already pulls it down via
        // engine_client.compact_status `vov/<0|1>`.
        syncControlLockToGlobals();
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'ok',
          override: viewOverrideMode,
          controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
          controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
          controlLockLeaseDurationMs: viewOverrideMode === 'deck'
            ? CONTROL_LOCK_LEASE_MS
            : null,
          currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        }));
        broadcastViewOverride();
      });
    } else if (req.method === 'GET' && req.url === '/mixer/view-override') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        override: viewOverrideMode,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
        controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
        controlLockLeaseRemainingMs: controlLockLeaseRemainingMs(),
        controlLockLeaseDurationMs: viewOverrideMode === 'deck'
          ? CONTROL_LOCK_LEASE_MS
          : null,
        currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        savedView: savedTargetViewFader === null
          ? null
          : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
      }));
    } else if (req.method === 'GET' && req.url === '/color-palettes') {
      // Curated CPC colour-pair presets from config.yaml. Hue-only
      // (S/V are pinned to 1.0 by the picker — see
      // CaptainPad/components/CPCControls.tsx). Empty list is a valid
      // response — the picker just hides the Presets tab.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(engineCore.colorPalettes) ? engineCore.colorPalettes : []));
    } else if (req.method === 'GET' && req.url === '/param-center/schema') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getSchema() : []));
    } else if (req.method === 'GET' && req.url === '/param-center') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getCanonicalState() : {}));
    } else if (req.method === 'POST' && req.url === '/param-center') {
      readBody(data => {
        if (!paramCenter) return res.end('{}');
        // CPC fan-out via paramCenter.onChange handles WASM dirty
        // marking, persistence, and throttled WS broadcast. No
        // need to call applySnapshot/save/broadcastWs here — doing
        // so would double-broadcast every write (docs/24 §7.2).
        let rev = 0;
        for (const k in data) {
          const r = paramCenter.set(k, data[k], 'api');
          if (r.status === 'ok') rev = r.revision;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', revision: rev }));
      });
    } else if (req.method === 'POST' && req.url === '/param-center/source-lock') {
      readBody(data => {
        if (paramCenter) paramCenter.setSourceLock(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sourceLock: paramCenter ? paramCenter.getSourceLock() : null }));
        broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
      });
    }
    // ── AUDIO ANALYSIS ───────────────────────────────────────────────────
    // See docs/25_marsin_audio_analysis.md §9. `audioState` is wired
    // by engine.js and may be absent if engine wasn't booted with
    // audio support — those routes degrade to a clear 503.
    else if (req.method === 'GET' && req.url === '/osc/config') {
      // Sanitised OSC config snapshot for the iPad config tab.
      // Bindings are intentionally returned as a count, not the full
      // map — the operator edits them in config.yaml, not the iPad.
      const oscState = engineCore && engineCore.oscState;
      if (!oscState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'osc_not_initialized' })); }
      const cfg = oscState.config || {};
      const status = oscState.listener ? oscState.listener.getStatus() : { enabled: false };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled:        !!cfg.enabled,
        port:           cfg.port ?? null,
        host:           cfg.host ?? null,
        gainMax:        cfg.gainMax ?? null,
        allowedSenders: Array.isArray(cfg.allowedSenders) ? cfg.allowedSenders : [],
        bindingsCount:  Object.keys(cfg.bindings || {}).length,
        running:        !!oscState.listener,
        status,
      }));
    } else if (req.method === 'PATCH' && req.url === '/osc/config') {
      // Operator-editable subset: enabled + allowedSenders. port/host
      // changes also stop+restart the listener but we keep them on the
      // engine machine's config.yaml — exposed here as a convenience
      // toggle, not persisted across restarts.
      const oscState = engineCore && engineCore.oscState;
      if (!oscState || typeof oscState.restart !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'osc_not_initialized' }));
      }
      readBody(data => {
        if (!data || typeof data !== 'object') {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'patch body must be an object' }));
        }
        const patch = {};
        if (data.enabled !== undefined) {
          if (typeof data.enabled !== 'boolean') {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"enabled" must be a boolean' }));
          }
          patch.enabled = data.enabled;
        }
        if (data.allowedSenders !== undefined) {
          if (!Array.isArray(data.allowedSenders)) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"allowedSenders" must be an array' }));
          }
          // Defensive shape check — each entry needs {name, ip}.
          // The full canonical validation runs again inside the
          // OscListener constructor, which throws on malformed input.
          for (const s of data.allowedSenders) {
            if (!s || typeof s !== 'object' || typeof s.name !== 'string' || typeof s.ip !== 'string') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'allowedSenders entry must be { name: string, ip: string }' }));
            }
          }
          patch.allowedSenders = data.allowedSenders;
        }
        if (data.port !== undefined) {
          const p = Number(data.port);
          if (!Number.isInteger(p) || p < 1 || p > 65535) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"port" must be an integer in [1, 65535]' }));
          }
          patch.port = p;
        }
        if (data.host !== undefined) {
          if (typeof data.host !== 'string' || !data.host) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"host" must be a non-empty string' }));
          }
          patch.host = data.host;
        }
        try {
          const next = oscState.restart(patch);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            enabled: !!next.enabled,
            port: next.port ?? null,
            host: next.host ?? null,
            allowedSenders: next.allowedSenders || [],
            bindingsCount: Object.keys(next.bindings || {}).length,
            running: !!oscState.listener,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
    else if (req.method === 'GET' && req.url === '/audio/config') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(audioState.config || {}));
    } else if (req.method === 'GET' && req.url === '/audio/status') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(audioState.lastStatus || { enabled: false }));
    } else if (req.method === 'GET' && req.url === '/audio/devices') {
      // Mic picker source for CaptainPad. Shells out to ffmpeg on the
      // ENGINE machine — this is intentional: the iPad needs to choose
      // from the rig's mics, not from its own. Listing is cached for
      // 2 s so rapid re-renders don't fork ffmpeg repeatedly.
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      const now = Date.now();
      const cached = engineCore._audioDevicesCache;
      if (cached && now - cached.at < 2000) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(cached.payload));
      }
      Promise.all([
        import('./audio_devices.js'),
        import('./ffmpeg_resolver.js'),
      ]).then(async ([{ listAudioDevices }, { resolveFfmpegPath }]) => {
        try {
          const cfg = audioState.config || {};
          const ffmpegPath = await resolveFfmpegPath(cfg.capture?.ffmpegPath || 'ffmpeg');
          const { devices, platform, inputFormat } = await listAudioDevices({ ffmpegPath });
          const payload = {
            platform,
            inputFormat,
            devices,
            current: {
              device:      cfg.capture?.device ?? null,
              deviceLabel: cfg.capture?.deviceLabel ?? null,
              deviceId:    cfg.capture?.deviceId ?? null,
              inputFormat: cfg.capture?.inputFormat ?? null,
            },
          };
          engineCore._audioDevicesCache = { at: Date.now(), payload };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        } catch (err) {
          // Surface stable error codes (`ffmpeg_missing`, `unsupported_platform`)
          // so the iPad can show a useful message instead of a stack trace.
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message, code: err.code || 'list_failed' }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/audio/config/reset') {
      // CaptainPad → "Reset to defaults" on the Audio Analysis tab.
      // Wipes the scene's analyzer tuning back to config.yaml defaults
      // while preserving the chosen mic. See engine.js
      // audioState.resetToDefaults for the persistence contract.
      const audioState = engineCore && engineCore.audioState;
      if (!audioState || typeof audioState.resetToDefaults !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' }));
      }
      try {
        const next = audioState.resetToDefaults();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'GET' && req.url === '/audio/chains') {
      // docs/29 §REST endpoints: full per-signal chain map.
      const spp = engineCore && engineCore.signalPostProcessor;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(spp.getAllChains()));
    } else if (req.method === 'GET' && req.url === '/audio/chains/catalog') {
      // docs/29 §REST endpoints — op catalog for the iPad's "+ ADD OP"
      // picker (Phase 5). Cached client-side per engine version.
      import('./signal_post_processor.js').then(({ opCatalog }) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(opCatalog()));
      });
    } else if (req.method === 'POST' && req.url === '/audio/chains/reset') {
      // docs/29 §REST endpoints — restore ALL signals to defaults.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const r = spp.resetAll();
      if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.chains));
    } else if (req.method === 'GET' && req.url.match(/^\/audio\/chains\/[^\/]+$/)) {
      const spp = engineCore && engineCore.signalPostProcessor;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const signalKey = decodeURIComponent(req.url.split('/')[3]);
      const chain = spp.getChain(signalKey);
      if (chain === null) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `unknown signalKey "${signalKey}"` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chain));
    } else if (req.method === 'PUT' && req.url.match(/^\/audio\/chains\/[^\/]+$/)) {
      // docs/29: atomic replace of a signal's chain. 400 on validation
      // failure (existing chain unchanged — see SignalPostProcessor).
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const signalKey = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        const r = spp.putChain(signalKey, data);
        if (!r.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: r.error }));
        }
        if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.chain));
      });
    } else if (req.method === 'POST' && req.url.match(/^\/audio\/chains\/[^\/]+\/reset$/)) {
      // Place BEFORE the generic /:signalKey/:opId PATCH so /reset
      // doesn't get parsed as an opId.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const parts = req.url.split('/');
      const signalKey = decodeURIComponent(parts[3]);
      const r = spp.resetSignal(signalKey);
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: r.error }));
      }
      if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.chain));
    } else if (req.method === 'PATCH' && req.url.match(/^\/audio\/chains\/[^\/]+\/[^\/]+$/)) {
      // docs/29: partial update of one op (enabled toggle + subset of
      // params). 400 on validation failure.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const parts = req.url.split('/');
      const signalKey = decodeURIComponent(parts[3]);
      const opId      = decodeURIComponent(parts[4]);
      readBody(data => {
        const r = spp.patchOp(signalKey, opId, data);
        if (!r.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: r.error }));
        }
        if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.op));
      });
    } else if (req.method === 'PATCH' && req.url === '/audio/config') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState || typeof audioState.applyLiveUpdate !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' }));
      }
      readBody(data => {
        // Lazy-import to avoid pulling audio_config into the api_server
        // module graph when audio support is disabled. Lazy import
        // inside an async closure isn't worth the complexity in this
        // sync handler — require it at the top of the file would be
        // cleaner, but this keeps the cross-file deps obvious.
        import('./audio_config.js').then(async ({ validateLivePatch }) => {
          const v = validateLivePatch(data);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          try {
            // applyLiveUpdate is async — it may need to stop/respawn
            // ffmpeg when `enabled` or `capture.*` change. Await so
            // the response reflects the post-restart state.
            const next = await audioState.applyLiveUpdate(v.live, {
              requiresCaptureRestart: v.requiresCaptureRestart,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(next));
          } catch (err) {
            // Analyzer.reconfigure throws RangeError on bad combos.
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    }
    // ── PLAYLIST LIBRARY ─────────────────────────────────────────────────
    else if (req.method === 'GET' && req.url === '/playlists') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(playlistManager.list()));
    } else if (req.method === 'GET' && req.url.match(/^\/playlists\/[^\/]+$/)) {
      try {
        // decodeURIComponent throws on malformed escapes (e.g. "%G0"); guard so
        // we always return a clean 400 instead of crashing the request handler.
        const name = decodeURIComponent(req.url.split('/')[2]);
        const pl = playlistManager.load(name);
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not_found' })); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pl));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url === '/playlists') {
      readBody(data => {
        try {
          if (!data || !data.name) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' }));
          }
          // Auto-assign entry ids for any entry missing one
          const entries = (data.entries || []).map(e => ({
            ...e,
            id: e.id || playlistManager.generateEntryId(),
            label: e.label ?? null,
            defaults: e.defaults || {},
            notes: e.notes ?? null,
          }));
          const saved = playlistManager.save({ name: data.name, entries });
          // Re-sync per-channel cursor for any channel whose playlist
          // points at the saved name (operator reorder, slot 5 May
          // 2026). `cursor` is a display index used in WS broadcasts;
          // autopilot itself uses id-based lookup so it doesn't need
          // this, but if we leave cursor stale a UI consumer reading
          // it from the mixer broadcast (or a future code path that
          // honours it) would point at the wrong row. activeEntryId
          // is intentionally NOT touched — the operator's currently
          // playing pattern keeps playing; only the surrounding order
          // shifts.
          for (const ch of mixer.channels) {
            if (!ch.playlist || ch.playlist.name !== saved.name) continue;
            const activeId = ch.playlist.activeEntryId;
            if (!activeId) continue;
            const newIdx = saved.entries.findIndex(e => e.id === activeId);
            // newIdx === -1 means the active entry was removed from
            // the playlist by this save (delete path, not a reorder).
            // Leave cursor as-is; that path is exercised by the
            // existing handleRemoveEntry flow, which separately
            // advances the active entry when needed.
            if (newIdx >= 0) ch.playlist.cursor = newIdx;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', playlist: saved }));
          // Two broadcasts so clients can react narrowly:
          //   - playlistLibrary: list of names changed (new playlist appears).
          //   - playlistSaved:   THIS playlist's content changed (entries
          //                      were added / removed / labeled). Anyone
          //                      currently showing it must refresh.
          broadcastWs({ type: 'playlistLibrary', names: playlistManager.list() });
          broadcastWs({ type: 'playlistSaved', name: saved.name, playlist: saved });
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/playlists\/[^\/]+$/)) {
      try {
        let name;
        try {
          name = decodeURIComponent(req.url.split('/')[2]);
        } catch (e) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid URI encoding' }));
        }
        playlistManager.delete(name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        broadcastWs({ type: 'playlistLibrary', names: playlistManager.list() });
        broadcastWs({ type: 'playlistDeleted', name });
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    }
    // ── PLAYLIST MODULATIONS (Phase 1A) ──────────────────────────────────
    //
    // Per docs/26 §5.1. CRUD by mapping id, scoped to a playlist item.
    // v1 policy: at most one continuous mapping per target parameter —
    // the validator + save path enforce this.
    //
    // Routes:
    //   PUT    /api/playlists/:name/items/:itemId/modulations/:mappingId
    //   PATCH  /api/playlists/:name/items/:itemId/modulations/:mappingId
    //   DELETE /api/playlists/:name/items/:itemId/modulations/:mappingId
    //
    // All mutations re-save the playlist via playlistManager.save (which
    // re-validates everything strict), then re-push the entry's
    // mappings to the ModulationController IF the entry is currently
    // active on the deck.
    else if (req.url.match(/^\/api\/playlists\/[^\/]+\/items\/[^\/]+\/modulations\/[^\/]+$/)) {
      const parts = req.url.split('/');
      let playlistName, itemId, mappingId;
      try {
        playlistName = decodeURIComponent(parts[3]);
        itemId = decodeURIComponent(parts[5]);
        mappingId = decodeURIComponent(parts[7]);
      } catch (e) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid URI encoding' }));
      }

      const finishOk = (savedEntry) => {
        broadcastWs({ type: 'playlistSaved', name: playlistName });
        const deckCh = mixer.getDeckChannel();
        if (deckCh && deckCh.playlist
            && deckCh.playlist.name === playlistName
            && deckCh.playlist.activeEntryId === itemId) {
          pushActiveEntryToModulation();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', entry: savedEntry }));
      };

      if (req.method === 'PUT') {
        readBody(data => {
          try {
            if (!data || typeof data !== 'object') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'request body required' }));
            }
            const playlist = playlistManager.load(playlistName);
            if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
            const entry = playlist.entries.find(e => e.id === itemId);
            if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
            const incoming = { ...data, id: mappingId };
            // Validate before mutating in-memory so we don't leave a
            // half-edited playlist behind on bad input.
            try { validateModulationMapping(incoming); }
            catch (ve) { res.writeHead(400); return res.end(JSON.stringify({ error: ve.message })); }
            entry.modulations = (entry.modulations || []).filter(m => m.id !== mappingId);
            entry.modulations.push(incoming);
            const saved = playlistManager.save(playlist);
            const savedEntry = saved.entries.find(e => e.id === itemId);
            finishOk(savedEntry);
          } catch (e) {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'PATCH') {
        readBody(data => {
          try {
            if (!data || typeof data !== 'object') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'request body required' }));
            }
            const playlist = playlistManager.load(playlistName);
            if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
            const entry = playlist.entries.find(e => e.id === itemId);
            if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
            const existing = (entry.modulations || []).find(m => m.id === mappingId);
            if (!existing) { res.writeHead(404); return res.end(JSON.stringify({ error: 'mapping not found' })); }
            const merged = { ...existing, ...data, id: mappingId };
            try { validateModulationMapping(merged); }
            catch (ve) { res.writeHead(400); return res.end(JSON.stringify({ error: ve.message })); }
            entry.modulations = (entry.modulations || []).map(m => m.id === mappingId ? merged : m);
            const saved = playlistManager.save(playlist);
            const savedEntry = saved.entries.find(e => e.id === itemId);
            finishOk(savedEntry);
          } catch (e) {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const playlist = playlistManager.load(playlistName);
          if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          const entry = playlist.entries.find(e => e.id === itemId);
          if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
          const before = (entry.modulations || []).length;
          entry.modulations = (entry.modulations || []).filter(m => m.id !== mappingId);
          if (entry.modulations.length === before) {
            res.writeHead(404); return res.end(JSON.stringify({ error: 'mapping not found' }));
          }
          const saved = playlistManager.save(playlist);
          const savedEntry = saved.entries.find(e => e.id === itemId);
          finishOk(savedEntry);
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }
      res.writeHead(405); res.end(JSON.stringify({ error: 'method not allowed' }));
    }
    // ── DECK CHANNEL (post-split) ────────────────────────────────────────
    // Replaces the deck-via-/mixer/channels/<baseId>/... access pattern.
    // The deck is a singleton (no id needed in the URL) and these routes
    // refuse to surface mixer overlay channels.
    else if (req.method === 'GET' && req.url === '/deck/channel') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        master: mixer.master,
        blackout: globalsState.blackout,
        channel: serializeDeckChannel(),
      }));
    } else if (req.method === 'PATCH' && req.url === '/deck/channel') {
      // PATCH the deck channel — same fields as the mixer's PATCH but
      // routed through the deck slot. The legacy `/mixer/channels/<deckId>`
      // PATCH no longer accepts the deck id (returns WRONG_ROLE).
      readBody(data => {
        const channel = mixer.getDeckChannel();
        if (!channel) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (data.name !== undefined) channel.name = data.name;
        if (data.mode !== undefined) {
          if (channel._savedMode) delete channel._savedMode;
          mixer.cancelChannelTransition(channel.id);
          channel.mode = data.mode;
          mixer.getBlendHandle(data.mode);
        }
        if (data.fader !== undefined) {
          // Fader-lock: same silent-skip semantics as the mixer PATCH.
          if (!channel.faderLocked) {
            mixer.cancelChannelTransition(channel.id);
            channel.fader = data.fader;
          }
        }
        if (data.enabled !== undefined) channel.enabled = data.enabled;
        if (data.faderLocked !== undefined) channel.faderLocked = !!data.faderLocked;
        if (data.locked !== undefined) {
          const becameLocked = !channel.locked && !!data.locked;
          channel.locked = !!data.locked;
          if (becameLocked) {
            const pending = captureTimers.get(channel.id);
            if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }
          }
          clearChannelDirty(channel);
        }
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          mixer.setChannelViewSelection(channel.id, v.value);
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/deck/channel/control') {
      // Per-control write targeting the deck channel. Mirrors
      // `POST /mixer/channels/:id/control` for the deck role.
      readBody(data => {
        const channel = mixer.getDeckChannel();
        if (!channel) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (data.id === undefined) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setChannelControl(channel.id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        scheduleEntryCapture(channel.id);
        markChannelDirtyIfLocked(channel.id);
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    }
    // ── DECK PLAYLIST ASSIGNMENT ─────────────────────────────────────────
    else if (req.method === 'GET' && req.url === '/deck/playlist') {
      const baseCh = mixer.getDeckChannel();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(baseCh && baseCh.playlist ? baseCh.playlist : null));
    } else if (req.method === 'POST' && req.url === '/deck/playlist') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        try {
          if (data.name === null) {
            baseCh.playlist = null;
            // Modulation context must be cleared here too — otherwise
            // the last entry's mappings keep firing until a new
            // pattern lands. setActiveEntry handles the
            // null-playlist case (empty mappings → _lastWrittenTargets
            // clears + base restore fires on the next frame).
            pushActiveEntryToModulation();
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null }));
            broadcastMixerState();
            return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          // Pick first non-missing entry, else first entry
          let firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            baseCh.playlist = {
              name: pl.name, activeEntryId: null, cursor: 0,
              autopilot: (baseCh.playlist && baseCh.playlist.autopilot) || { active: false, delay_s: 30, shuffle: false }
            };
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: baseCh.playlist }));
            broadcastMixerState();
            return;
          }
          loadPlaylistEntry(baseCh, pl.name, firstEntry.id);
          saveAllState();
          opts.pattern = baseCh.pattern;
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: baseCh.playlist }));
          broadcastWs({ type: 'pattern', name: baseCh.pattern });
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/entry') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (!baseCh.playlist || !baseCh.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          // Route through the deck-transition helper. With transitions
          // disabled, it falls back to the instant load + does the same
          // broadcasts; with transitions enabled, it kicks off a soft
          // swap and broadcasts a `deckSwapStarted` event so the UI can
          // show pending state, then `deckSwapComplete` on landing.
          const r = loadPlaylistEntryWithTransition(
            baseCh, baseCh.playlist.name, data.entryId, deckTransitionConfig,
          );
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            playlist: baseCh.playlist,
            pattern: baseCh.pattern,
            transitionId: r && r.transitionId ? r.transitionId : null,
          }));
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            // Operator tapped during an in-flight transition. Per the
            // user's spec these taps are silently ignored — return 409
            // (Conflict) so the client knows nothing changed but it's
            // not an error. The iPad already greys the list during a
            // swap, so this is belt-and-suspenders.
            res.writeHead(409); res.end(JSON.stringify({
              error: 'transition in progress', code: 'EBUSY',
            }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/capture') {
      const baseCh = mixer.getDeckChannel();
      if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
      try {
        const captured = captureActiveEntryDefaults(baseCh);
        clearChannelDirty(baseCh);
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: captured }));
        broadcastWs({ type: 'playlistEntryCaptured', channelId: baseCh.id, playlist: baseCh.playlist.name, entryId: baseCh.playlist.activeEntryId, defaults: captured });
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url === '/deck/playlist/autopilot') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        baseCh.playlist = baseCh.playlist || { name: null, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
        const ap = baseCh.playlist.autopilot = baseCh.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
        if (data.active !== undefined) ap.active = !!data.active;
        if (data.delay_s !== undefined) ap.delay_s = parseInt(data.delay_s, 10) || 30;
        if (data.shuffle !== undefined) ap.shuffle = !!data.shuffle;
        saveAllState();
        autopilot.updateState({ active: ap.active, delay_s: String(ap.delay_s), shuffle: ap.shuffle });
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', autopilot: ap }));
        broadcastMixerState();
        broadcastAutopilot();
      });
    } else if (req.method === 'GET' && req.url === '/deck/transition-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(deckTransitionConfig));
    } else if (req.method === 'POST' && req.url === '/deck/transition-config') {
      readBody(data => {
        // Validate + clamp each field individually so a partial POST
        // can update one knob without resetting the rest.
        if (typeof data.enabled === 'boolean') deckTransitionConfig.enabled = data.enabled;
        if (typeof data.shuffle === 'boolean') deckTransitionConfig.shuffle = data.shuffle;
        if (typeof data.mode === 'string' && data.mode.startsWith('trans_')) {
          deckTransitionConfig.mode = data.mode;
        }
        if (data.durationMs !== undefined) {
          const ms = Math.max(50, Math.min(30000, Number(data.durationMs) || 1000));
          deckTransitionConfig.durationMs = ms;
        }
        saveAllState();
        // Broadcast so other clients see the change immediately.
        broadcastWs({ type: 'deckTransitionConfig', ...deckTransitionConfig });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deckTransitionConfig));
      });
    }
    // ── MIXER CHANNEL PLAYLIST ASSIGNMENT ────────────────────────────────
    else if (req.method === 'GET' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ch.playlist || null));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        const ch = mixer.getMixerChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        try {
          if (data.name === null) {
            ch.playlist = null;
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null, playlistData: null }));
            broadcastMixerState(); return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          let firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            ch.playlist = { name: pl.name, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            saveAllState();
            // Empty-but-named playlist: send the (empty) data inline
            // so the panel can still render "Empty playlist" without
            // hitting the network.
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, playlistData: pl }));
            broadcastChannelPlaylistData(ch);
            broadcastMixerState(); return;
          }
          loadPlaylistEntry(ch, pl.name, firstEntry.id);
          saveAllState();
          // playlistData mirrors POST /mixer/channels — entries are
          // included inline so the panel never needs to GET
          // /playlists/<name> for this swap. See engine_inline_playlist
          // todo in the assistant transcript for context.
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, playlistData: pl }));
          // Prime every connected client's cache for the NEW playlist
          // before the mixer broadcast tells them the channel changed.
          broadcastChannelPlaylistData(ch);
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/entry$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        const ch = mixer.getMixerChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        if (!ch.playlist || !ch.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          // Mixer overlay entry swap = instant load (no deck transition
          // machinery on this path). The deck-side soft-swap branch
          // that used to live here moved to /deck/playlist/entry now
          // that mixer/deck routes are isolated.
          loadPlaylistEntry(ch, ch.playlist.name, data.entryId);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, pattern: ch.pattern }));
          broadcastMixerState();
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            res.writeHead(409); res.end(JSON.stringify({
              error: 'transition in progress', code: 'EBUSY',
            }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/capture$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      try {
        const captured = captureActiveEntryDefaults(ch);
        clearChannelDirty(ch);
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: captured }));
        broadcastWs({
          type: 'playlistEntryCaptured',
          channelId: ch.id,
          playlist: ch.playlist.name,
          entryId: ch.playlist.activeEntryId,
          defaults: captured,
        });
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/discard$/)) {
      // Discard in-memory edits and snap the channel back to the saved
      // playlist entry defaults. Used by the "Load from playlist" branch of
      // the unlock-dirty prompt.
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      if (!ch.playlist || !ch.playlist.name || !ch.playlist.activeEntryId) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'no active playlist entry' }));
      }
      try {
        const pl = playlistManager.load(ch.playlist.name);
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
        const entry = pl.entries.find(e => e.id === ch.playlist.activeEntryId);
        if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'entry not found' })); }

        // Re-apply the on-disk defaults exactly as `loadPlaylistEntry` would
        // on a fresh swap. Clear localControls first so any keys NOT present
        // in the saved defaults snap back to the WASM export's initial value.
        ch.localControls = {};
        playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
        finalizeCpcValues(ch);

        // Cancel any pending capture for this channel — discard is an
        // explicit "throw away in-memory edits" action; we shouldn't let a
        // stale timer fire after we revert.
        const pending = captureTimers.get(id);
        if (pending) { clearTimeout(pending); captureTimers.delete(id); }

        clearChannelDirty(ch);
        saveAllState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: entry.defaults || {} }));
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  });

  // ── Topic-split WS topology ───────────────────────────────────────────
  //
  // Pre-split, the engine ran a single WebSocketServer at `/` and every
  // broadcast went to every client. With the audio analyser running and
  // 3 mixer channels, that meant the iPad's onmessage handler was
  // parsing ~50 messages/sec just to figure out which 1-2 of them it
  // actually cared about — enough to starve the JS thread and leave the
  // audio config tab spinning for 30+ s after mount.
  //
  // Each WSS uses `noServer: true` and we route the HTTP upgrade
  // request by path. The legacy root path `/` is intentionally NOT
  // exposed — clients MUST pick a topic. See lib/ws_topic_routing.js
  // for the routing table.
  const wssControl = new WebSocketServer({ noServer: true });
  const wssParams  = new WebSocketServer({ noServer: true });
  const wssSignals = new WebSocketServer({ noServer: true });
  const wssViz     = new WebSocketServer({ noServer: true });

  const wssByTopic = {
    [TOPICS.CONTROL]: wssControl,
    [TOPICS.PARAMS]:  wssParams,
    [TOPICS.SIGNALS]: wssSignals,
    [TOPICS.VIZ]:     wssViz,
  };

  // Expose the map BEFORE we wire any handlers — broadcastWs() reads
  // global.wssByTopic on every call and will no-op until this assignment
  // runs. Done early so any synchronous broadcasts during the WS
  // connect handlers (e.g. autopilot.start emitting a state event) find
  // the right socket already registered.
  global.wssByTopic = wssByTopic;
  // Back-compat shim — exported tests + a couple of legacy call sites
  // still reach for `global.wss`. Point it at the control socket so any
  // straggler that broadcasts via the old shape lands on something
  // sensible. New code should never use this.
  global.wss = wssControl;

  for (const [topicName, wssInst] of Object.entries(wssByTopic)) {
    wssInst.on('error', (e) => {
      console.warn(`WebSocketServer[${topicName}] error:`, e.message);
    });
  }

  // Manual upgrade routing.
  //
  // Path → topic mapping. The four `/ws/<topic>` paths are the
  // canonical, post-split topology. The root path `/` is a TRANSITIONAL
  // alias for `/ws/control` so unmigrated clients (in-flight branches
  // that subscribe to the old root socket) still see the UI/state
  // events they need to function. It deliberately does NOT route vis
  // frames or live audio signals — the whole point of the split is
  // that those high-volume streams must not land on `/` anymore. Once
  // every CaptainPad call site is on engineBus topics this alias
  // should be removed.
  const WS_PATH_TO_TOPIC = {
    '/':           TOPICS.CONTROL,
    '/ws/control': TOPICS.CONTROL,
    '/ws/params':  TOPICS.PARAMS,
    '/ws/signals': TOPICS.SIGNALS,
    '/ws/viz':     TOPICS.VIZ,
  };

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      pathname = '/';
    }
    const topic = WS_PATH_TO_TOPIC[pathname];
    if (!topic) {
      // Unknown path. Refuse the upgrade with an explicit 400 so the
      // client sees a real failure instead of a silently-empty socket.
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const wssForTopic = wssByTopic[topic];
    wssForTopic.handleUpgrade(req, socket, head, (ws) => {
      wssForTopic.emit('connection', ws, req);
    });
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  ❌ Port ${opts.port} is already in use by another process.`);
      process.exit(1);
    } else {
      console.error('Server error:', e);
    }
  });
  autopilot.start();

  // ── Per-topic replay-on-connect ──────────────────────────────────────
  // Each socket only replays the cached payloads it owns. A fresh
  // /ws/control connection gets mixer + deck + autopilot + viewOverride
  // + oscStats + audioStatus — not sharedParams, not vis, not
  // liveParams. The audio tab opens /ws/control AND /ws/signals so it
  // still gets a warm liveParams replay below.

  wssControl.on('connection', ws => {
    // Send full state on connect — uses shared serializers. Both deck
    // and mixer go out so a fresh CaptainPad sees both surfaces
    // without having to GET them separately.
    try { ws.send(JSON.stringify(serializeMixerState())); } catch (e) {}
    try { ws.send(JSON.stringify(serializeDeckState())); } catch (e) {}

    // Push the current autopilot + view-override state on connect so
    // late joiners (e.g. CaptainPad after a foreground/background cycle)
    // see the same values that the existing one-shot REST loads would
    // have given them — without having to wait for the next change.
    try {
      const st = autopilot.state || {};
      ws.send(JSON.stringify({
        type: 'autopilot',
        active: !!st.active,
        delay_s: st.delay_s !== undefined ? String(st.delay_s) : '30',
        shuffle: !!st.shuffle,
      }));
    } catch (e) {
      // never let a snapshot send break a fresh WS handshake
    }
    try {
      ws.send(JSON.stringify({
        type: 'viewOverride',
        override: viewOverrideMode,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
        controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
        controlLockLeaseDurationMs: viewOverrideMode === 'deck'
          ? CONTROL_LOCK_LEASE_MS
          : null,
        currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        savedView: savedTargetViewFader === null
          ? null
          : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
      }));
    } catch (e) {
      // ignore
    }

    // Replay cached telemetry so the pills paint immediately on
    // connect rather than waiting up to one second for the next stats
    // tick (docs/24 §10.1, docs/25 §6.3).
    try {
      if (lastOscStats)    ws.send(JSON.stringify(lastOscStats));
      if (lastAudioStatus) ws.send(JSON.stringify(lastAudioStatus));
    } catch (e) {
      // ignore
    }

    // Initial audio-chains snapshot — docs/29 §Interactions step 8:
    // "engine emits one of these immediately after any client reconnects
    // to /ws/control so the iPad picks up changes that happened during
    // disconnect". Reuses the same accessor as GET /audio/chains. If
    // signalPostProcessor isn't initialized (engine booted without
    // audio), skip silently — an empty map would be misleading.
    try {
      const spp = engineCore && engineCore.signalPostProcessor;
      if (spp) {
        ws.send(JSON.stringify({
          type: 'audioChainsChanged',
          chains: spp.getAllChains(),
        }));
      }
    } catch (e) {
      // never let a snapshot send break a fresh WS handshake
    }

    ws.on('message', msg => {
      try {
        const d = JSON.parse(msg);
        if (d.type === 'setControl' && d.id !== undefined) {
          paramRouter.setControl(d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          scheduleEntryCapture(mixer.baseChannelId);
          markChannelDirtyIfLocked(mixer.baseChannelId);
          saveAllState();
          broadcastMixerState();
        } else if (d.type === 'setChannelControl' && d.channelId && d.id !== undefined) {
          paramRouter.setChannelControl(d.channelId, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          scheduleEntryCapture(d.channelId);
          markChannelDirtyIfLocked(d.channelId);
          saveAllState();
          broadcastMixerState();
        } else if (d.type === 'setChannelFader' && d.channelId && d.fader !== undefined) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            // Fader-lock: refuse manual fader writes on a locked
            // channel. We do NOT broadcast or push back here — the
            // iPad's optimistic local update will be corrected on the
            // next `mixer` broadcast (slider snaps back to the engine
            // truth). This is the cheapest UX path: the operator sees
            // the slider try to move, then it visibly re-pegs to the
            // locked value within ~100ms.
            if (channel.faderLocked) {
              // Force a broadcast so the iPad's slider re-syncs
              // immediately rather than waiting for the next periodic
              // mixer event. Without this the slider can "stick"
              // visually wherever the finger left it.
              broadcastMixerState();
              return;
            }
            // Manual fader writes ALWAYS cancel any in-flight transition
            // for that channel — otherwise the server-side animation
            // would keep overwriting the operator's slider drag, causing
            // a "rubber band" snap-back effect. Agent review (May 2026) §5.
            mixer.cancelChannelTransition(d.channelId);
            channel.fader = d.fader;
            // No broadcast — fader-only updates outside transitions are
            // already at human-touch rate; full state syncs on
            // saveMixerState (e.g. on slider release).
          }
        } else if (d.type === 'setChannelMode' && d.channelId && d.mode) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            // A manual mode change wins over any in-flight scripted
            // transition for this channel: cancel the transition (which
            // would otherwise restore the old saved mode at completion)
            // and drop the now-stale `_savedMode` so the operator's
            // pick sticks. cancelChannelTransition will also re-apply
            // _savedMode if present — we clear it FIRST so it doesn't
            // overwrite the user's intent.
            if (channel._savedMode) delete channel._savedMode;
            mixer.cancelChannelTransition(d.channelId);
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
          saveAllState();
          broadcastMixerState();
        } else if ((d.type === 'triggerMixerTransition' || d.type === 'triggerTransition') && d.targetChannelId) {
          // Server-driven transition: client sends ONE message, engine
          // animates every overlay channel's fader at 40 Hz on its own
          // render thread. See pattern_mixer.triggerMixerTransition() for
          // the rationale (no WS jitter, no rAF stepping, butter-smooth
          // fades on the actual LED output). The old `triggerTransition`
          // name is accepted for backwards-compat with any deployed iPad
          // that hasn't picked up the rename yet.
          const durationMs = Math.max(1, Math.min(30000, Number.isFinite(d.durationMs) ? d.durationMs : 1000));
          const curve = (d.curve === 'linear') ? 'linear' : 'smoothstep';
          const mode = d.mode || 'exclusiveOverlays';
          // The visual transition style — one of the scripts under
          // patterns/transitions/ (trans_crossfade, trans_flash,
          // trans_dissolve, trans_iris, trans_wipe_*). Defaults to
          // trans_crossfade for back-compat with old clients that don't
          // send this field. Validated again in the mixer.
          const transitionMode = (typeof d.transitionMode === 'string' && d.transitionMode.startsWith('trans_'))
            ? d.transitionMode
            : 'trans_crossfade';

          if (d.targetChannelId === mixer.baseChannelId) {
            ws.send(JSON.stringify({
              type: 'mixerTransitionRejected',
              targetChannelId: d.targetChannelId,
              reason: 'cannot-transition-to-base',
            }));
          } else {
            const transitionId = mixer.triggerMixerTransition({
              targetChannelId: d.targetChannelId,
              durationMs,
              curve,
              mode,
              transitionMode,
              transitionId: d.transitionId || null,
            });
            if (!transitionId) {
              ws.send(JSON.stringify({
                type: 'mixerTransitionRejected',
                targetChannelId: d.targetChannelId,
                reason: 'no-overlays-or-missing-target',
              }));
            } else {
              // Immediate broadcast so the iPad sees the force-enabled
              // state (mute cleared, target enabled) within one frame,
              // well before the throttled progress broadcasts start
              // landing. Carries the transitionId + transitionMode so
              // the client can correlate.
              broadcastWs({
                type: 'mixerTransitionStarted',
                transitionId,
                targetChannelId: d.targetChannelId,
                durationMs,
                curve,
                transitionMode,
              });
              broadcastMixerState();
            }
          }
        } else if (d.type === 'setSharedParam') {
          if (!paramCenter) return;
          const res = paramCenter.set(d.key, d.value, 'ws', d.origin);
          if (res.status === 'ignored') {
            ws.send(JSON.stringify({ type: 'paramRejected', key: d.key, reason: res.reason, lockedTo: res.lockedTo }));
          }
          // Success path: paramCenter.onChange (wired at boot)
          // handles persistence + throttled WS broadcast + WASM
          // dirty marking. See docs/24 §7.2.
        } else if (d.type === 'subscribeChains' || d.type === 'unsubscribeChains') {
          // docs/29 §WS contract: gate the 5 Hz signalChain preview
          // emission. Engine pays zero cost when no client is subscribed.
          // V1 is "is anyone subscribed at all?" — the engine doesn't
          // need a per-client subscriber map because the 5 Hz frame is
          // broadcast to ALL /ws/signals clients anyway.
          const spp = engineCore && engineCore.signalPostProcessor;
          if (spp && typeof spp.setEditorSubscribed === 'function') {
            spp.setEditorSubscribed(d.type === 'subscribeChains');
          }
        }
      } catch(e) {}
    });
  });

  // /ws/params — sharedParams replay. CPC writes are quiet by default
  // (only operator knob turns emit), so without the replay a fresh
  // CaptainPad would have stale colour/speed values until the next
  // operator touch. The REST seed in useEngineState catches this for
  // the steady CPC doc, but the WS replay keeps the contracts symmetric
  // with the other sockets — one cached payload, replayed on connect.
  wssParams.on('connection', ws => {
    try {
      if (paramCenter) {
        ws.send(JSON.stringify({
          type: 'sharedParams',
          ...paramCenter.getCanonicalState(),
        }));
      }
    } catch (e) {
      // ignore
    }
  });

  // /ws/signals — liveParams replay so audio meters / BPM badge paint
  // warm values on cold reconnect without waiting one whole audio-hop
  // interval. Only the latest payload is replayed; the bus keeps
  // ticking from there.
  wssSignals.on('connection', ws => {
    try {
      if (lastLiveParams) ws.send(JSON.stringify(lastLiveParams));
    } catch (e) {
      // ignore
    }
  });

  // /ws/viz — no replay. Vis frames are stateless 6ch base64 buffers
  // and the next broadcast (≤100 ms away at the default 10 Hz) will
  // paint a fresh frame anyway. Keeping the cold-connect cost at zero
  // is more important than the one-frame visual delay.
  wssViz.on('connection', () => {
    // no-op — frames arrive on the next render-loop tick
  });

  server.listen(opts.port, () => {
    console.log(`\n  🌐 Output Server listening on HTTP/WS port ${opts.port}`);
    console.log(`     Reachable on:`);
    for (const url of reachableUrls(opts.port)) {
      console.log(`       ${url}`);
    }
  });

  publishStatsRef.publish = (data) => {
    // Four message shapes flow through this hook. Each is classified
    // to one topic via broadcastWs (lib/ws_topic_routing.js):
    //   - { type: 'vis', ...}     → /ws/viz       (high-volume frames)
    //   - { type: 'oscStats', ...}→ /ws/control   (1 Hz pill telemetry)
    //   - { type: 'audioStatus' } → /ws/control   (1 Hz pill telemetry)
    //   - everything else         → /ws/control   ({ type: 'stats',...})
    //
    // oscStats + audioStatus are cached for late-joining WS clients so
    // a freshly-opened CaptainPad sees the right pill state inside a
    // single render frame instead of waiting up to one second for the
    // next stats tick.
    let payload;
    if (data && data.type === 'vis') {
      payload = data;
    } else if (data && data.type === 'oscStats') {
      payload = data;
      lastOscStats = data;
    } else if (data && data.type === 'audioStatus') {
      payload = data;
      lastAudioStatus = data;
    } else {
      payload = { type: 'stats', ...data };
    }
    broadcastWs(payload);
  };

  // Boot-time: if the persisted deck state has a playlist+activeEntryId,
  // hand its modulations to the controller now so the very first render
  // tick already has them. Subsequent swaps refresh via the existing
  // pushActiveEntryToModulation() calls in loadPlaylistEntry +
  // deckSwapComplete.
  pushActiveEntryToModulation();

  // Exposed for the engine's model hot-reload path: after the model and
  // mixer view-mask state are refreshed, push the new mixer/deck state
  // to connected clients so an already-open CaptainPad re-syncs its
  // channel strips without a manual reload. (The views PICKER list is
  // fetched from /model/view-selection-options at mount, which reads
  // the live model object and is therefore fresh on the next reload.)
  server.broadcastMixerState = broadcastMixerState;

  return server;
}

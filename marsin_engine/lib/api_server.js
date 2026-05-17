import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Autopilot } from './autopilot.js';
import { StateManager } from './state_manager.js';
import { PlaylistManager } from './playlist_manager.js';

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
  const { mixer, wasmHost, paramRouter, paramCenter, model } = engineCore;
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
   * onChannelCompiled + (optional) playlist entry defaults + localControls
   * restore. Ensures the latest system color palette, speed, etc. always
   * wins over any per-pattern state.
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

  // Playlist library lives in simulation/scenes/<scene>/playlists/
  const playlistsDir = path.join(
    patternsDir, '..', '..', 'simulation', 'scenes',
    opts.modelName || 'default', 'playlists'
  );
  const playlistManager = new PlaylistManager(playlistsDir, patternsDir);
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

    return { entry, index: idx, total: playlist.entries.length };
  }

  function restoreChannel(saved) {
    try {
      const src = loadPattern(patternsDir, saved.pattern);
      const comp = wasmHost.compile(src);
      if (!comp.ok) {
        console.warn(`Failed to compile saved channel ${saved.pattern}:`, comp.error);
        return;
      }
      const ch = mixer.addChannel({
        id: saved.id,
        name: saved.name,
        pattern: saved.pattern,
        handle: comp.handle,
        mode: saved.mode,
        fader: saved.fader,
        enabled: saved.enabled
      });
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
    mixer.channels.forEach(ch => { finalizeCpcValues(ch); });
  }

  // Single source of truth for serializing mixer state — used by
  // GET /mixer, broadcastMixerState(), and WS connect.
  function serializeMixerState() {
    return {
      type: 'mixer',
      blackout: globalsState.blackout,
      master: mixer.master,
      maxChannels: mixer.maxChannels,
      baseChannelId: mixer.baseChannelId,
      channels: mixer.channels.map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
        fader: c.fader,
        enabled: c.enabled,
        locked: !!c.locked,
        // `dirty` is true iff the operator changed a param *while this
        // channel was locked*. Drives the unlock-time save-or-discard
        // prompt on the client. Cleared on lock toggle / capture / discard
        // / entry swap (see markChannelDirtyIfLocked + clearChannelDirty).
        dirty: !!c._dirty,
        transitionMode: c.transitionMode || 'trans_crossfade',
        transitionTime: c.transitionTime || 1.0,
        // Playlist assignment is the "where am I right now in this slot"
        // pointer. Broadcasting it lets the deck and mixer panels detect
        // cross-tab swaps without polling.
        playlist: c.playlist || null,
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
      const baseCh = mixer.getChannel(mixer.baseChannelId);
      return baseCh && baseCh.playlist ? baseCh.playlist.activeEntryId : null;
    },
    async () => {
      const baseCh = mixer.getChannel(mixer.baseChannelId);
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
        loadPlaylistEntry(baseCh, baseCh.playlist.name, nextEntry.id);
        opts.pattern = baseCh.pattern;
        saveAllState();
        broadcastWs({ type: 'pattern', name: baseCh.pattern });
        broadcastMixerState();
      } catch (e) {
        console.warn('Autopilot playlist swap failed:', e.message);
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

          // Legacy set-pattern replaces the base channel. Preserve the
          // playlist assignment so we stay in playlist mode.
          //
          // Order matters: we add the new channel BEFORE destroying
          // the old one so the renderer never sees a frame with no
          // deck channel (which would render as a black deck buffer
          // and was the most-likely cause of the brief blackouts that
          // PortWatch operators were seeing on every pattern switch).
          const oldBase = mixer.getChannel(mixer.baseChannelId);
          const oldPlaylist = oldBase ? oldBase.playlist : null;
          const oldBaseId = mixer.baseChannelId;

          // Cap-aware add: if we're already at maxChannels we have no
          // room to add-then-remove, so we have to do the legacy
          // destroy-first dance. In practice the deck always leaves
          // at least one slot free.
          //
          // KEY INVARIANT: the deck channel's `id` must stay STABLE
          // across pattern switches. CaptainPad's TARGET CHANNEL pills
          // remember the id the operator tapped (`selectedDeckChannel`
          // in app/(tabs)/index.tsx) and the PlaylistPanel keys its
          // entire data fetch off `/mixer/channels/<id>/playlist`. If
          // we issue a fresh `ch_base_<Date.now()>` here, the panel
          // then 404s and the operator sees "No playlist loaded"
          // until they tap the pill again. So:
          //   - At-cap path: remove first, then add with the same id.
          //   - Below-cap path: add under a guaranteed-unique temp id
          //     (so the renderer never sees a frame without an active
          //     deck channel), destroy + remove old, THEN rename the
          //     new channel back to the old base id.
          const atCap = mixer.channels.length >= mixer.maxChannels;
          let newChannel;
          if (atCap) {
            if (oldBase) oldBase.destroy(wasmHost);
            mixer.removeChannel(oldBaseId);
            newChannel = mixer.addChannel({
              id: oldBaseId || ('ch_base_' + Date.now()),
              name: 'Base',
              pattern: patternName,
              handle: comp.handle,
              mode: 'blend_screen',
              fader: 1.0,
              enabled: true,
            });
          } else {
            // Add first; promote to base; THEN tear down the old one.
            // The temp id is purely internal — it never escapes this
            // function because we rename below before broadcasting.
            const tempId = 'ch_base_pending_' + Date.now() + '_' +
              Math.random().toString(36).slice(2, 8);
            newChannel = mixer.addChannel({
              id: tempId,
              name: 'Base',
              pattern: patternName,
              handle: comp.handle,
              mode: 'blend_screen',
              fader: 1.0,
              enabled: true,
            });
            mixer.baseChannelId = newChannel.id;
            if (oldBase) {
              oldBase.destroy(wasmHost);
              mixer.removeChannel(oldBaseId);
            }
            // Old channel is gone — safe to rename without collision.
            if (oldBaseId) {
              newChannel.id = oldBaseId;
            }
          }

          // Keep deck channel at the front of the stack so any
          // bottom-up code paths still find it deterministically.
          const newIdx = mixer.channels.indexOf(newChannel);
          if (newIdx > 0) {
            mixer.channels.splice(newIdx, 1);
            mixer.channels.unshift(newChannel);
          }
          mixer.baseChannelId = newChannel.id;
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

          const broadcast = JSON.stringify({ type: 'pattern', name: patternName });
          if (global.wss) {
            global.wss.clients.forEach(c => {
              if (c.readyState === 1) c.send(broadcast);
            });
          }
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(autopilot.state));
        // External writers (PortWatch over LoRa, scripts, etc.) need the
        // CaptainPad UI to reflect their flips immediately. Broadcast on
        // every transition so the existing `engineEvents` bus on the iPad
        // can mirror state without polling.
        broadcastAutopilot();
      });
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
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', channelId: channel.id, pattern: channel.pattern, playlist: channel.playlist }));
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
      if (paramCenter) paramCenter.unregisterChannel(id);
      mixer.removeChannel(id);
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/control$/)) {
      const id = req.url.split('/')[3];
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
    // ── DECK PLAYLIST ASSIGNMENT ─────────────────────────────────────────
    else if (req.method === 'GET' && req.url === '/deck/playlist') {
      const baseCh = mixer.getChannel(mixer.baseChannelId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(baseCh && baseCh.playlist ? baseCh.playlist : null));
    } else if (req.method === 'POST' && req.url === '/deck/playlist') {
      readBody(data => {
        const baseCh = mixer.getChannel(mixer.baseChannelId);
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        try {
          if (data.name === null) {
            baseCh.playlist = null;
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
        const baseCh = mixer.getChannel(mixer.baseChannelId);
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (!baseCh.playlist || !baseCh.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          loadPlaylistEntry(baseCh, baseCh.playlist.name, data.entryId);
          saveAllState();
          opts.pattern = baseCh.pattern;
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: baseCh.playlist, pattern: baseCh.pattern }));
          broadcastWs({ type: 'pattern', name: baseCh.pattern });
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/capture') {
      const baseCh = mixer.getChannel(mixer.baseChannelId);
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
        const baseCh = mixer.getChannel(mixer.baseChannelId);
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
    }
    // ── MIXER CHANNEL PLAYLIST ASSIGNMENT ────────────────────────────────
    else if (req.method === 'GET' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      const ch = mixer.getChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ch.playlist || null));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        const ch = mixer.getChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        try {
          if (data.name === null) {
            ch.playlist = null;
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null }));
            broadcastMixerState(); return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          let firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            ch.playlist = { name: pl.name, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist }));
            broadcastMixerState(); return;
          }
          loadPlaylistEntry(ch, pl.name, firstEntry.id);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist }));
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/entry$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        const ch = mixer.getChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        if (!ch.playlist || !ch.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          loadPlaylistEntry(ch, ch.playlist.name, data.entryId);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, pattern: ch.pattern }));
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/capture$/)) {
      const id = req.url.split('/')[3];
      const ch = mixer.getChannel(id);
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
      const ch = mixer.getChannel(id);
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
          saveAllState();
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

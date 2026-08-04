// ── WS topic routing ─────────────────────────────────────────────────
//
// Single source of truth for which engine WS message `type` lives on
// which client-facing socket. Pre-split, every broadcast went through
// one socket and the iPad's mixer/deck onmessage handler had to parse
// every audio analyser tick (15-30 Hz) and every vis frame (10 Hz)
// just to decide it didn't care. With three channels on the mixer
// that added up to enough JSON.parse+setState churn that the audio
// tab couldn't load its config for ~30 s.
//
// The split routes traffic onto four dedicated sockets so consumers
// can subscribe ONLY to the topics they actually need. The audio tab,
// for example, opens `/ws/control` (for audio config rebroadcasts
// + audioStatus) and `/ws/signals` (for the live bands/kick meters)
// — it never sees vis frames or any per-channel mixer chatter.
//
// Topology:
//
//   /ws/control  — low-volume, high-priority UI/state. Mixer, deck,
//                  pattern, playlist, autopilot, GEM, blackout,
//                  audioStatus, oscStats, mixer-transition lifecycle,
//                  view override, deck transition config. The single
//                  topic every tab needs at least one subscriber on.
//
//   /ws/params   — sharedParams. Operator-touched CPC writes
//                  (colors, speed, knobs). Quiet by default — only
//                  emits when a STEADY key actually changes.
//
//   /ws/signals  — liveParams. Audio analyser output (mic*, stems*,
//                  tempoBpm). 15-30 Hz when the mic is hot, ~0 Hz
//                  when the analyser is idle. The Audio Analysis tab
//                  is the primary consumer; the deck's BPM badge is
//                  the only other one.
//
//   /ws/viz      — vis frames + vis-broadcast-stats. The HIGHEST
//                  volume by far (10 Hz × N channels × pixel buffer).
//                  Only deck/mixer's preview strips subscribe.
//
// Adding a new message type: extend TOPIC_BY_TYPE below. The HIL
// test `hil_ws_topic_split_test.mjs` and the unit test
// `ws_topic_routing.test.js` will refuse to pass if a known type
// isn't classified. There is no "default" topic on purpose —
// silently leaking a new type onto every socket is exactly the
// failure mode this routing exists to prevent.

export const TOPICS = Object.freeze({
  CONTROL: 'control',
  PARAMS:  'params',
  SIGNALS: 'signals',
  VIZ:     'viz',
});

// Every known broadcast `type`. The right-hand side MUST be one of
// the TOPICS values. Order is grouped by topic for review readability.
//
// CONTROL covers everything operator-facing: mixer state, deck state,
// pattern changes, playlist library/saved/deleted, channel-playlist
// data prime, autopilot, view override, deck transition config,
// transition lifecycle (started/complete/rejected), global effect
// macros + slot updates, audioStatus + oscStats telemetry,
// mixerTransitionStarted/Complete, playlistEntryCaptured, deckSwap
// start/complete, paramRejected (write rejections from CPC + macros).
const TOPIC_BY_TYPE = Object.freeze({
  // ── /ws/control ────────────────────────────────────────────────
  mixer:                       TOPICS.CONTROL,
  deck:                        TOPICS.CONTROL,
  pattern:                     TOPICS.CONTROL,
  autopilot:                   TOPICS.CONTROL,
  // docs/19 §13 (Phase 2.3): per-mixer-channel autopilot toggle.
  // Operator-driven, low volume — rides /ws/control next to the deck's
  // `autopilot` event.
  mixerAutopilot:              TOPICS.CONTROL,
  // docs/39: COLOR autopilot (palette cycling). Broadcast on every
  // POST /deck/color-autopilot + each timer-driven palette apply + timeline
  // cue, so CaptainPad's deck tab mirrors the palette-cycle config live.
  // Operator-driven, low volume → /ws/control next to the deck `autopilot`
  // event it parallels. Replayed on /ws/control connect.
  colorAutopilot:              TOPICS.CONTROL,
  viewOverride:                TOPICS.CONTROL,
  deckTransitionConfig:        TOPICS.CONTROL,
  // Engine-wide settings (auto-save toggle). Broadcast on every POST /settings
  // + replayed on /ws/control connect so every CaptainPad config screen
  // mirrors the persistence gate. Operator-driven, low volume.
  engineSettings:              TOPICS.CONTROL,
  // Performance mode (live-show structural lock). Broadcast on enter/exit +
  // replayed on /ws/control connect so every CaptainPad mirrors the lock badge.
  // Operator-driven, low volume → /ws/control next to engineSettings.
  performanceMode:             TOPICS.CONTROL,
  deckSwapStarted:             TOPICS.CONTROL,
  deckSwapComplete:            TOPICS.CONTROL,
  mixerTransitionStarted:      TOPICS.CONTROL,
  mixerTransitionComplete:     TOPICS.CONTROL,
  mixerTransitionRejected:     TOPICS.CONTROL,
  globalEffectSlots:           TOPICS.CONTROL,
  globalEffectMacroStatus:     TOPICS.CONTROL,
  // effects_v2 (project effects_v2_midi_layout): the engine-owned page VIEW
  // (0..3) over the 32 GEM slots. Broadcast on every PATCH /global-effects/page
  // so CaptainPad's page switcher + the VSN1 side buttons mirror the SAME page
  // (single source of truth). Operator-driven, low volume → /ws/control next
  // to the GEM slot/macro messages it relates to.
  effectsPage:                 TOPICS.CONTROL,
  // effects_v2 v3: engine-owned named effect BANKS (ordered list + active id).
  // Broadcast on every bank switch/next/create/delete/rename + replayed on
  // /ws/control connect so CaptainPad's bank switcher + the VSN1 sb_2 mirror the
  // SAME list (single source of truth). Operator-driven, low volume →
  // /ws/control next to effectsPage, the sibling page-view state it parallels.
  effectBanks:                 TOPICS.CONTROL,
  // effects_v2: VSN1 MIDI-layout deploy result. Broadcast when a layout change
  // is written/flashed to the controller so a client can surface deploy health
  // (ok / disabled / error). Low volume — fires only on layout changes.
  vsn1LayoutDeploy:            TOPICS.CONTROL,
  // NOTE: `globalHueShift` was REMOVED (2026-07) — the global hue shifter
  // is gone; hue is per-channel only and rides the mixer/deck state
  // broadcasts like every other channel field.
  // docs/39 §F-invert: GLOBAL color-invert toggle. Broadcast on every POST
  // /global-effect-invert so CaptainPad mirrors the global invert state.
  // Operator-driven, low volume → /ws/control next to the GEM macro/
  // blackout messages it semantically relates to.
  globalInvert:                TOPICS.CONTROL,
  // docs/32: per-group fixed-color override table. Broadcast on every
  // PUT/DELETE so all connected CaptainPads mirror the Dimmer Rack's
  // FIXED COLORS chips. Low volume, operator-driven.
  groupFixedColors:            TOPICS.CONTROL,
  // docs/31: engine-owned scheduler. Broadcasts on every create / patch
  // / delete / fire / stop / error. Small payload, low frequency
  // (operator-driven CRUD + at most one tick at SCHEDULER_TICK_MS=250 ms
  // when a row state-machines), so /ws/control is the right home next
  // to the GEM messages it semantically relates to.
  scheduledTasks:              TOPICS.CONTROL,
  // docs/38 §15: the Timeline runs IN the engine now (no separate :6965
  // companion). Its runtime snapshot is broadcast on every tick + state
  // change (mode/autopilot/program/cue fire). Low volume, operator-facing
  // — rides /ws/control next to scheduledTasks, replayed on connect.
  timelineState:               TOPICS.CONTROL,
  // PARTY OVERRIDE (report 20260725_19): the operator's engine-owned party
  // policy — { enabled, playlist }. Broadcast on every PUT /party-config +
  // replayed on /ws/control connect so CaptainPad and the Audio Companion's
  // PARTY tab mirror the SAME armed/disabled state live. Operator-driven, low
  // volume → /ws/control next to timelineState, the state it gates.
  partyConfig:                 TOPICS.CONTROL,
  playlistLibrary:             TOPICS.CONTROL,
  playlistSaved:               TOPICS.CONTROL,
  playlistDeleted:             TOPICS.CONTROL,
  channelPlaylistData:         TOPICS.CONTROL,
  playlistEntryCaptured:       TOPICS.CONTROL,
  // Deck LOCAL-PARAM save confirmation: emitted after a deck control write is
  // PERSISTED to deck_state.yaml (auto-save ON), so the deck's "✓ SAVED" flash
  // can fire honestly. Operator-driven, low volume → /ws/control next to the
  // deck/mixer state it confirms. Never emitted while auto-save is OFF (nothing
  // hits disk, so there is nothing to confirm).
  deckParamsSaved:             TOPICS.CONTROL,
  // F-A: named mixer snapshots / look recall. Broadcast on save / delete /
  // recall so every CaptainPad mirrors the snapshot library + a recalled
  // look. Operator-driven, low volume → /ws/control next to mixer/deck.
  snapshots:                   TOPICS.CONTROL,
  // round-2 #9: named per-channel parameter presets. Broadcast on capture /
  // delete / recall so every CaptainPad mirrors the preset library + a
  // recalled channel's params. Operator-driven, low volume → /ws/control next
  // to the snapshot library it semantically relates to.
  paramPresets:                TOPICS.CONTROL,
  // round-2 #10: mixer UNDO ring depth/top. Broadcast on every push (a
  // destructive action snapshotted) + every undo so CaptainPad's global UNDO
  // button mirrors enable/label live. Operator-driven, low volume → /ws/control
  // next to the snapshot/preset libraries it semantically relates to. Replayed
  // on /ws/control connect.
  undoState:                   TOPICS.CONTROL,
  paramRejected:               TOPICS.CONTROL,
  // round-2 #5 FLASH/BUMP (docs/39 §10.7): the engine pushes back a typed
  // rejection on a bad bump/unbump id (bad/non-mixer/deck channel), mirroring
  // soloRejected. Today it's sent point-to-point via ws.send (no fan-out
  // needed for a per-client reject), but it's registered here so the type is
  // documented on the wire and routes to /ws/control if ever broadcast. Bump
  // STATE itself rides the existing `mixer` broadcast's bumpedChannelIds[] —
  // no separate broadcast type (same as solo's soloedChannelIds[]).
  bumpRejected:                TOPICS.CONTROL,
  audioStatus:                 TOPICS.CONTROL,
  oscStats:                    TOPICS.CONTROL,
  // BM26-Stoker fire → lights sync (lib/fire_sync_listener.js). Low volume by
  // construction: emitted only when the effect state actually changes, which the
  // listener's min-ON coalescing caps at a few per second even under a strobing
  // poofer effect. Operator-facing health ("is fire sync alive?"), so
  // /ws/control next to oscStats.
  fireSyncStats:               TOPICS.CONTROL,
  stats:                       TOPICS.CONTROL,
  // docs/30: sparse drop-detected event from the audio structure
  // detector. ~once per 60 s of music, UI-relevant (scene-swap / macro
  // / log candidate), so /ws/control next to audioStatus — NOT the
  // high-rate /ws/signals meter stream.
  dropFired:                   TOPICS.CONTROL,

  // ── /ws/params ─────────────────────────────────────────────────
  sharedParams:                TOPICS.PARAMS,
  // Full CPC schema snapshot. Broadcast when the registry changes at
  // runtime — i.e. the Audio Companion's signal manifest added/removed a
  // dynamic live key (POST /audio/signals/manifest). Lets CaptainPad
  // re-derive its live-key set without polling GET /param-center/schema.
  // Rides /ws/params alongside sharedParams (both are "CPC shape/state").
  paramSchema:                 TOPICS.PARAMS,
  // modulationState: per-frame snapshot of the active modulation
  // mappings + their resolved values (see modulation_controller).
  // Frozen-decision (Phase 0): rides alongside sharedParams on
  // /ws/params so the deck's slider-ghost overlay only re-renders
  // when something actually moves, without spamming /ws/control.
  modulationState:             TOPICS.PARAMS,

  // ── /ws/signals ────────────────────────────────────────────────
  liveParams:                  TOPICS.SIGNALS,
  // 5 Hz pre/post per-op preview for the chain editor. Emitted only
  // when at least one client has sent `subscribeChains` upstream;
  // gated by SignalPostProcessor.setEditorSubscribed (docs/29 §WS
  // contract — "cheap when off").
  signalChain:                 TOPICS.SIGNALS,

  // ── /ws/control ────────────────────────────────────────────────
  // docs/29: replayed after every successful PUT/PATCH/reset so iPad
  // reconciles its local cache without re-fetching.
  audioChainsChanged:          TOPICS.CONTROL,
  // Audio TUNING config (bands.inputGain / bands.sourceSmoothHz /
  // capture.device / enabled — the operator-tunable analyzer subset).
  // Broadcast after every PATCH /audio/config + reset so EVERY
  // subscriber (CaptainPad AND the Audio Companion) mirrors the engine's
  // single source of truth without re-fetching. Replayed on /ws/control
  // connect. Low volume, operator-driven — lives next to audioChains-
  // Changed / audioStatus.
  audioConfig:                 TOPICS.CONTROL,

  // ── /ws/viz ────────────────────────────────────────────────────
  vis:                         TOPICS.VIZ,
});

/**
 * Returns the topic a given message `type` belongs to. Throws if
 * the type is not in the routing table — a missing classification
 * is a developer error, never a runtime fallback. Tests pin this.
 *
 * @param {string} type
 * @returns {'control'|'params'|'signals'|'viz'}
 */
export function topicForType(type) {
  if (typeof type !== 'string' || !type) {
    throw new Error(`ws_topic_routing: message has no .type field`);
  }
  const t = TOPIC_BY_TYPE[type];
  if (!t) {
    throw new Error(`ws_topic_routing: unknown message type "${type}" — add it to TOPIC_BY_TYPE`);
  }
  return t;
}

/** Read-only copy of the routing table for tests + diagnostics. */
export function getRoutingTable() {
  return { ...TOPIC_BY_TYPE };
}

/** List of every known message type. Useful for tests / introspection. */
export function knownTypes() {
  return Object.keys(TOPIC_BY_TYPE);
}

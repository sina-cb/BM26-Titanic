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
  viewOverride:                TOPICS.CONTROL,
  deckTransitionConfig:        TOPICS.CONTROL,
  deckSwapStarted:             TOPICS.CONTROL,
  deckSwapComplete:            TOPICS.CONTROL,
  mixerTransitionStarted:      TOPICS.CONTROL,
  mixerTransitionComplete:     TOPICS.CONTROL,
  mixerTransitionRejected:     TOPICS.CONTROL,
  globalEffectSlots:           TOPICS.CONTROL,
  globalEffectMacroStatus:     TOPICS.CONTROL,
  playlistLibrary:             TOPICS.CONTROL,
  playlistSaved:               TOPICS.CONTROL,
  playlistDeleted:             TOPICS.CONTROL,
  channelPlaylistData:         TOPICS.CONTROL,
  playlistEntryCaptured:       TOPICS.CONTROL,
  paramRejected:               TOPICS.CONTROL,
  audioStatus:                 TOPICS.CONTROL,
  oscStats:                    TOPICS.CONTROL,
  stats:                       TOPICS.CONTROL,

  // ── /ws/params ─────────────────────────────────────────────────
  sharedParams:                TOPICS.PARAMS,
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

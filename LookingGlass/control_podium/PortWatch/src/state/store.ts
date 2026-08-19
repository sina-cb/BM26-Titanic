// Lightweight global store via Zustand.
//
// One store for the whole app — connection state, the live wire log,
// link stats, engine-status snapshots, command-intent (optimistic
// toggle state), and the most-recent ack/nak summary.
//
// The expensive objects (BleClient, Codec, TitanicLink) live OUTSIDE
// the store (created in App.tsx, threaded down through React context)
// because they're mutable and not React-friendly.

import { create } from "zustand";
import type { WireEvent } from "../link/titanicLink";
import { reconcileIntent } from "./intent";
import type {
  EngineStatus,
  PatternList,
  GlobalParamsSnapshot,
  LocalExport,
  DeckPlaylistInfo,
  HsvTriple,
} from "../status/parse";
import {
  persistGlobalParamsDebounced,
  persistLocalExportsByPattern,
  persistPatternsByPlaylist,
  persistPlaylistLibrary,
  persistSnapshotTimestamp,
} from "./persistedCache";
import type { WorldSnapshot } from "./persistedCache";

export type ConnState =
  | { kind: "idle" }
  | { kind: "permissionDenied" }
  | { kind: "scanning" }
  | { kind: "connecting"; deviceId: string; deviceName: string }
  | { kind: "connected"; deviceId: string; deviceName: string }
  | { kind: "disconnected"; reason?: string }
  | { kind: "error"; message: string };

export interface DiscoveredEntry {
  id: string;
  name: string;
  /** EMA-smoothed RSSI from BleClient — already low-pass-filtered, ok to display verbatim. */
  rssi: number;
  /**
   * Wall-clock millis of the first time we saw this device this scan
   * session. Stable across upserts (preserved by upsertDiscovered).
   * Used as a tiebreaker in the list sort so devices within a few
   * dBm of each other don't keep swapping rows on every advertisement.
   */
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface LinkStats {
  /** Live RSSI from a periodic readRSSI() — captain Heltec BLE link. */
  bleRssi: number | null;
  /** Most recent LoRa-side TX/RX/RSSI/SNR snapshot from firmware. */
  loraTxCount: number | null;
  loraRxCount: number | null;
  loraLastRssi: number | null;
  loraLastSnr: number | null;
}

/**
 * Optimistic intent state for stateful controls.
 *
 * Why we keep this separate from `EngineStatus`:
 *
 * The engine status comes from the server's periodic publish (5–30 s
 * cadence) and from explicit `qry engine/status` replies. Between an
 * action firing and the next status pub landing, the UI would feel
 * dead if it only reflected the server's last-known state. So when
 * the user taps a toggle, we:
 *
 *   1. Set `intent.<key> = newValue` and mark it `pending: true`.
 *   2. Render the new value with a pending shimmer.
 *   3. When the bridge ACKs, clear `pending`.
 *   4. When the next status pub arrives, reconcile: if `intent` matches
 *      the pub, drop the intent (use the pub directly); if they
 *      diverge for more than ~5 s, drop the intent and trust the pub
 *      (assume our command was lost or the engine overrode us).
 */
export interface CommandIntent {
  blackout?: { value: boolean; pending: boolean; setAtMs: number };
  autopilot?: { value: boolean; pending: boolean; setAtMs: number };
  /**
   * Pending autopilot transition interval in seconds. Held here while
   * the engine hasn't yet echoed `apd/<sec>` back over a status pub.
   * Once a pub arrives whose `apd` matches our intent, the intent
   * gets dropped and the UI reads off `engineStatus` directly — same
   * pattern as `blackout` / `brightness`.
   */
  autopilotInterval?: { value: number; pending: boolean; setAtMs: number };
  brightness?: { value: number; pending: boolean; setAtMs: number };
  /**
   * Pending active-pattern selection. When the operator taps a row in
   * the pattern picker, we set this immediately so the picker
   * highlight jumps right away — instead of waiting for the round
   * trip BLE→LoRa→bridge→engine→bridge→LoRa→BLE→PUB to land (~1–3 s
   * even on a clean link). The intent is reconciled the moment the
   * next compact PUB carries `pat/<name>` matching this value.
   */
  activePattern?: { value: string; pending: boolean; setAtMs: number };
  /**
   * Pending deck-view override toggle. Same optimistic pattern as
   * `blackout` — flip the local UI state instantly on tap, drop the
   * intent when the next PUB confirms `vov/<0|1>` matches.
   */
  viewOverride?: { value: boolean; pending: boolean; setAtMs: number };
  fxStates: Record<string, { value: boolean; pending: boolean; setAtMs: number }>;
  /**
   * Optimistic global-param writes (CPC scalars + palettes). Keyed by
   * the same param name the engine uses (`speed`, `direction`,
   * `count`, `size`, `rotate`, `colorPalette1`, `colorPalette2`). The
   * value type is intentionally flexible: scalars are numbers, palette
   * slots are HSV triples. Reconciliation drops the intent when the
   * next `qry params` snapshot agrees within ~1e-3.
   *
   * Why we don't reconcile on every status PUB: the periodic compact
   * status doesn't carry global params (would blow the per-frame
   * budget), so reconciliation hooks off the explicit `params`
   * snapshot fetch — see DeckScreen.refreshGlobalParams().
   */
  globalParams: Record<string, {
    value: number | HsvTriple;
    pending: boolean;
    setAtMs: number;
  }>;
  /**
   * Optimistic local-export writes (per-pattern WASM sliders). Keyed
   * by the engine's CRC32 control id, matching the `LocalExport.id`
   * field. Same reconciliation pattern as `globalParams` — dropped
   * on the next `qry exports` page that includes a matching v0.
   */
  localExports: Record<string, { value: number; pending: boolean; setAtMs: number }>;
  /**
   * Pending deck playlist switch. Resolves via two parallel paths:
   *   1. The compact PUB's `pl/<name>` field — set by
   *      `engine_client.compact_status` from the mixer base channel's
   *      playlist name. This is the fast path (next PUB after the
   *      engine commits) and covers CaptainPad-initiated changes.
   *   2. An explicit `qry deck/playlist` reply (rarely needed today;
   *      kept as a fallback for the no-WS scenario).
   * Both paths feed `setEngineStatus` / `setDeckPlaylist` which clear
   * the intent below.
   */
  deckPlaylist?: { value: string; pending: boolean; setAtMs: number };
}

interface AppState {
  conn: ConnState;
  discovered: Record<string, DiscoveredEntry>;
  /**
   * Device ids we've successfully paired with during this app session.
   * iOS owns the actual BLE bond (apps cannot enumerate or remove it
   * programmatically — that's strictly a user-level operation in
   * Settings → Bluetooth), so this dict is best understood as our
   * local "we believe iOS has a bond for this device" cache. It's
   * populated when `ble.connect()` succeeds (the connect path forces
   * the pairing handshake on the very first read of CHAR_LAST_RX),
   * and cleared per-id when the user taps Unpair on a scan row.
   *
   * Resets on app restart by design — we don't ship AsyncStorage
   * for this yet because its native module would force an EAS
   * rebuild. The functional impact is cosmetic only: the user loses
   * the PAIRED badge until they reconnect once (which is silent
   * because iOS still has the bond).
   */
  pairedDeviceIds: Record<string, true>;
  log: WireEvent[];
  stats: LinkStats;
  /** Pretty-printed last reply / nak / pong, for the header strip. */
  lastReplySummary: string | null;

  /** Most recent engine-status snapshot from the server. Null until first pub/rep arrives. */
  engineStatus: EngineStatus | null;
  /** Most recent pattern list from `qry engine/patterns`. */
  patternList: PatternList | null;
  /** True while a `qry engine/patterns` is in flight. */
  patternsLoading: boolean;
  /**
   * Per-playlist pattern cache. Keyed by playlist NAME. Plain name-
   * keyed cache — no hash validation, no auto-rehydrate. The cache
   * is the source of truth until the operator taps REFRESH on the
   * pattern picker:
   *
   *   * First time we see a playlist name (no entry) → paginated
   *     fetch, write the entry, persist.
   *   * Subsequent visits to the same name (entry exists) → serve
   *     the cached list, zero LoRa frames.
   *   * Manual REFRESH → bypass the cache, paginated fetch, overwrite
   *     the entry, persist.
   *
   * Hydrated from AsyncStorage on app start (see
   * `state/persistedCache.ts`) and persisted on every write. Survives
   * app kill, not just BLE disconnect — operators who close the app
   * and re-open it next show still see the same picker contents
   * without a multi-page LoRa fetch.
   */
  patternsByPlaylist: Record<string, PatternList>;
  /**
   * Most recent global-params snapshot from `qry params`. Null until
   * the operator taps Refresh on the ParamsCard (we don't auto-fetch
   * — every fetch costs LoRa air time).
   */
  globalParams: GlobalParamsSnapshot | null;
  /** True while a `qry params` is in flight. */
  globalParamsLoading: boolean;
  /**
   * Most recent local exports list (per-pattern WASM sliders) for the
   * deck base channel. This is what the ParamsCard currently renders;
   * it is automatically swapped to the cached entry for the new
   * `activePattern` whenever `setEngineStatus` sees a pattern change
   * (so the operator never sees the OLD pattern's sliders while a
   * fresh fetch is in flight — see `setEngineStatus`).
   */
  localExports: LocalExport[] | null;
  /** True while paginated `qry exports` fetch is in flight. */
  localExportsLoading: boolean;
  /**
   * Per-pattern local-export cache. Keyed by pattern NAME (the same
   * string the engine surfaces as `pat/<name>` in compact status).
   * Each entry stores the FULL `LocalExport[]` (structure + last-seen
   * `v0` values), so on pattern change we can render the slider list
   * INSTANTLY with stale-but-meaningful values — the ParamsCard's
   * pattern-change effect kicks off a fresh poll that overwrites
   * shortly after. Persisted to AsyncStorage on every write so the
   * stale values survive an app kill, which is the headline UX of
   * "after I reopen the app, the sliders show last-known positions
   * immediately instead of blank for 1-3 s".
   */
  localExportsByPattern: Record<string, LocalExport[]>;
  /**
   * Wall-clock millis at which the operator last completed a full
   * REFRESH (library + every playlist's patterns). Hydrated from
   * AsyncStorage on app boot. Drives the "Last refreshed N minutes
   * ago" hint on the deck card; null = no snapshot rebuilt yet on
   * this device.
   */
  snapshotBuiltAtMs: number | null;
  /**
   * True while the unified REFRESH action is in flight. Disables the
   * deck card's REFRESH button (prevents stacked refreshes) and is
   * the one signal pollers / auto-hydrate effects watch to back off
   * while the rebuild is running.
   */
  worldRebuildInProgress: boolean;
  /**
   * Most recent playlist library list. Hydrated from AsyncStorage on
   * app start; refreshed only on first connect (when null) or via the
   * REFRESH button. The plain name list is the only persisted shape;
   * no hash is stored anymore.
   */
  playlistLibrary: string[] | null;
  /** True while paginated `qry playlists` fetch is in flight. */
  playlistLibraryLoading: boolean;
  /**
   * Last error message from a playlist library fetch attempt, or null
   * when the most recent attempt succeeded. Drives the FAILED + RETRY
   * pill in PlaylistSwitcher so the operator can recover from a slow
   * LoRa first-connect without the UI silently sitting on stale
   * "still loading…" forever.
   */
  playlistLibraryError: string | null;
  /**
   * Same as playlistLibraryError but for the pattern picker fetch
   * (`qry engine/playlist-patterns`). Surfaced in the picker header
   * with a RETRY button.
   */
  patternListError: string | null;
  /**
   * Monotonic counter that bumps on every successful BLE pair. Card
   * `useEffect`s subscribe to it as a stable trigger for their
   * connect-time auto-hydration — every bump means "fresh
   * connection, refetch everything you own". This is more reliable
   * than `useEffect(() => …, [])` on mount, because the tab tree
   * sometimes re-mounts in dev (Fast Refresh) without the
   * connection actually changing, and `[]`-deps wouldn't re-trigger
   * after a real disconnect/reconnect inside the same JS context.
   */
  connectGeneration: number;
  /**
   * Sentinel that records the `connectGeneration` for which the
   * playlist library has finished hydrating (regardless of success
   * or failure). Used as a SERIAL GATE for the pattern-picker
   * auto-hydration: the deck card only fires `refreshPatterns()`
   * once `playlistsHydratedForConn === connectGeneration`, so the
   * playlist library fetch and the pattern-list fetch run
   * back-to-back over LoRa instead of stepping on each other.
   *
   * Why this matters on LoRa:
   *   * The radio is half-duplex and the bridge replies one frame
   *     at a time. Two qry pages racing each other means two
   *     pending acks, two pending rep streams, and the per-page
   *     timeout (`patterns.page_timeout_ms`) starts firing on
   *     whichever stream gets queued behind the other.
   *   * Serialising eliminates the contention entirely and turns
   *     the previously-flaky "playlist failed · timeout / patterns
   *     failed · timeout" double-error into a clean two-stage load.
   *
   * Set to the SAME `connectGeneration` value on every PlaylistSwitcher
   * refresh completion (success OR fail — see the catch block). 0
   * means "no hydration has happened yet for any connection".
   */
  playlistsHydratedForConn: number;
  /** Most recent deck-playlist info from `qry deck/playlist`. */
  deckPlaylist: DeckPlaylistInfo | null;
  /**
   * True from the moment the operator taps a different deck playlist
   * until the engine confirms the swap (we receive the new playlist's
   * pattern list, or the switch errors out). While set, both the
   * pattern REFRESH button and the playlist chips are disabled so the
   * operator can't queue overlapping switches or refresh into a
   * mid-flight catalog.
   */
  deckPlaylistSwitching: boolean;
  intent: CommandIntent;

  setConn: (c: ConnState) => void;
  upsertDiscovered: (e: DiscoveredEntry) => void;
  clearDiscovered: () => void;
  markPaired: (id: string) => void;
  unmarkPaired: (id: string) => void;
  appendLog: (e: WireEvent) => void;
  clearLog: () => void;
  /**
   * Merge a partial LinkStats into the live snapshot. Two writers
   * publish to this slice on independent timers (BLE RSSI from
   * BleClient via App.tsx, LoRa stats from LinkBar's poll), and both
   * used to overwrite each other's values via stale closures — that
   * showed up as the SNR/RX/TX cells flickering between values.
   * Accepting partials and short-circuiting on identical values is
   * what gives the top bar its "stable until something actually
   * changed" behaviour.
   */
  setStats: (partial: Partial<LinkStats>) => void;
  setLastReply: (summary: string | null) => void;
  setEngineStatus: (s: EngineStatus | null) => void;
  setPatternList: (p: PatternList | null) => void;
  /**
   * Atomic write: store the patterns into both `patternList`
   * (the live "what's the picker showing right now") AND
   * `patternsByPlaylist[playlistName]` (the per-playlist cache).
   * Pass `playlistName=null` to write only to `patternList` — used
   * when the engine reports no active playlist (no key to file
   * under). Persists the new cache entry to AsyncStorage so it
   * survives app kill.
   */
  cachePatternsForPlaylist: (
    playlistName: string | null,
    list: PatternList,
  ) => void;
  /**
   * Invalidate a single playlist's cached patterns. Used by the
   * REFRESH button (force) so the next refreshPatterns() does a
   * real LoRa fetch instead of serving the cache. Pass null to
   * clear ALL entries (used on a manual "wipe cache" path; resetIntent
   * does NOT call this — cache survives disconnect deliberately).
   */
  invalidatePatternsCache: (playlistName: string | null) => void;
  /**
   * Bulk hydrate the patterns cache from persisted storage. Called
   * once on app start before the first BLE connect. Replaces the
   * entire `patternsByPlaylist` map; intentional that the persisted
   * snapshot wins over any in-memory state at hydrate time (there
   * shouldn't be any yet).
   */
  hydratePatternsByPlaylist: (map: Record<string, PatternList>) => void;
  /**
   * Bulk-hydrate every persisted slice at once. Called from App.tsx on
   * app boot, BEFORE the first BLE connect, so the deck card and
   * ParamsCard render their cached structure on first paint instead
   * of blank. `globalParams` are loaded by a separate action to keep
   * the partial-merge semantics centralized in `setGlobalParams`.
   */
  hydrateWorldSnapshot: (snapshot: WorldSnapshot) => void;
  /**
   * Update the snapshot freshness timestamp. Called from
   * `rebuildWorld()` after a successful REFRESH completes. Persisted.
   */
  setSnapshotBuiltAt: (ts: number) => void;
  /** Flip the rebuild-in-flight banner. Only `rebuildWorld()` calls this. */
  setWorldRebuildInProgress: (b: boolean) => void;
  setPatternsLoading: (b: boolean) => void;
  setGlobalParams: (s: GlobalParamsSnapshot | null) => void;
  setGlobalParamsLoading: (b: boolean) => void;
  setLocalExports: (e: LocalExport[] | null) => void;
  setLocalExportsLoading: (b: boolean) => void;
  /**
   * Replace the playlist library list. Plain name array; persisted
   * to AsyncStorage so it survives app kill. Pass `null` only on an
   * explicit reset path — `resetIntent` does NOT clear this so the
   * library survives disconnect.
   */
  setPlaylistLibrary: (l: string[] | null) => void;
  setPlaylistLibraryLoading: (b: boolean) => void;
  setPlaylistLibraryError: (e: string | null) => void;
  setPatternListError: (e: string | null) => void;
  setDeckPlaylist: (d: DeckPlaylistInfo | null) => void;
  setDeckPlaylistSwitching: (b: boolean) => void;
  /**
   * Mark the playlist library as hydrated for a given connect
   * generation. Unblocks the pattern-picker auto-hydration (see
   * the docstring on `playlistsHydratedForConn`). Called once from
   * PlaylistSwitcher.refresh()'s `finally` block so it fires
   * regardless of success or failure — a failed playlist load
   * should NOT permanently block the pattern picker; the operator
   * can still tap REFRESH on the picker to try again.
   */
  markPlaylistsHydrated: (connectGen: number) => void;
  /** Bump connectGeneration. Called after every successful BLE pair. */
  bumpConnectGeneration: () => void;

  // Command-intent helpers. Each one updates the optimistic value and
  // marks pending. Caller is expected to call markIntentResolved once
  // the bridge replies (or on a timeout).
  intendBlackout: (value: boolean) => void;
  intendAutopilot: (value: boolean) => void;
  intendAutopilotInterval: (value: number) => void;
  intendBrightness: (value: number) => void;
  intendActivePattern: (value: string) => void;
  intendViewOverride: (value: boolean) => void;
  intendFx: (name: string, value: boolean) => void;
  /**
   * Optimistic global-param write. `value` may be a number (scalars)
   * or an HSV triple (`colorPalette1` / `colorPalette2`). Reconciled
   * by setGlobalParams() once a fresh snapshot agrees within
   * GLOBAL_PARAM_RECONCILE_EPS.
   */
  intendGlobalParam: (key: string, value: number | HsvTriple) => void;
  /**
   * Optimistic per-export write keyed by CRC32 control id. Reconciled
   * by setLocalExports() once a fresh exports page reports a matching
   * v0 (within ~1e-3 to absorb float-format rounding on the wire).
   */
  intendLocalExport: (controlId: number, v0: number) => void;
  /**
   * Optimistic deck-playlist switch. The engine emits both `mixer`
   * and `pattern` WS events on success but the playlist NAME isn't
   * in the compact PUB, so reconciliation hooks off setDeckPlaylist().
   */
  intendDeckPlaylist: (name: string) => void;
  markIntentResolved: (
    field:
      | "blackout"
      | "autopilot"
      | "autopilotInterval"
      | "brightness"
      | "activePattern"
      | "viewOverride"
      | "deckPlaylist"
      | `fx:${string}`
      | `globalParam:${string}`
      | `localExport:${string}`,
  ) => void;
  /** Reset all command intent (called on disconnect). */
  resetIntent: () => void;
}

// Ring-buffer cap on the in-memory log buffer. Sourced from
// .config.portwatch.yaml::logs.max_entries (~5 min of activity at
// typical show-time frame rates of 100+/min). The LogsScreen still
// time-windows the visible slice to "last 5 minutes" so even if
// we hit this cap during a long quiet spell the UI stays snappy.
import { logs as _logsCfg } from "../config";
const MAX_LOG_ENTRIES = _logsCfg.max_entries;

const EMPTY_INTENT: CommandIntent = {
  fxStates: {},
  globalParams: {},
  localExports: {},
};

// Float reconciliation tolerance for global params + local exports.
// The bridge sends compact-formatted floats over the wire (3 decimal
// digits, trailing zeros stripped) so a strict `===` check would
// keep an intent pending forever after a value of, say, 0.555 → "0.555".
// 1.5e-3 absorbs the worst-case rounding without ever resolving an
// intent that's actually stale.
const GLOBAL_PARAM_RECONCILE_EPS = 1.5e-3;

function _scalarsAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= GLOBAL_PARAM_RECONCILE_EPS;
}

function _hsvAgree(a: HsvTriple, b: HsvTriple): boolean {
  return (
    _scalarsAgree(a.h, b.h) &&
    _scalarsAgree(a.s, b.s) &&
    _scalarsAgree(a.v, b.v)
  );
}

export const useAppStore = create<AppState>((set) => ({
  conn: { kind: "idle" },
  discovered: {},
  pairedDeviceIds: {},
  log: [],
  stats: {
    bleRssi: null,
    loraTxCount: null,
    loraRxCount: null,
    loraLastRssi: null,
    loraLastSnr: null,
  },
  lastReplySummary: null,
  engineStatus: null,
  patternList: null,
  patternsLoading: false,
  patternsByPlaylist: {},
  globalParams: null,
  globalParamsLoading: false,
  localExports: null,
  localExportsLoading: false,
  localExportsByPattern: {},
  snapshotBuiltAtMs: null,
  worldRebuildInProgress: false,
  playlistLibrary: null,
  playlistLibraryLoading: false,
  playlistLibraryError: null,
  patternListError: null,
  connectGeneration: 0,
  playlistsHydratedForConn: 0,
  deckPlaylist: null,
  deckPlaylistSwitching: false,
  intent: EMPTY_INTENT,

  setConn: (conn) => set({ conn }),

  upsertDiscovered: (entry) =>
    set((s) => {
      // No-op short-circuit: if nothing the UI actually renders has
      // changed since the last upsert, return the exact same store
      // reference so React skips re-rendering subscribers.
      // (RSSI is already EMA-smoothed in BleClient, so a "no real
      // change" tick is common when sitting still.)
      const prev = s.discovered[entry.id];
      if (
        prev &&
        prev.rssi === entry.rssi &&
        prev.name === entry.name
      ) {
        return s;
      }
      return {
        discovered: { ...s.discovered, [entry.id]: entry },
      };
    }),

  clearDiscovered: () => set({ discovered: {} }),

  markPaired: (id) =>
    set((s) => {
      if (s.pairedDeviceIds[id]) return s;
      return {
        pairedDeviceIds: { ...s.pairedDeviceIds, [id]: true },
      };
    }),

  unmarkPaired: (id) =>
    set((s) => {
      if (!s.pairedDeviceIds[id]) return s;
      const next = { ...s.pairedDeviceIds };
      delete next[id];
      return { pairedDeviceIds: next };
    }),

  appendLog: (event) =>
    set((s) => {
      const next = [event, ...s.log];
      if (next.length > MAX_LOG_ENTRIES) next.length = MAX_LOG_ENTRIES;
      return { log: next };
    }),

  clearLog: () => set({ log: [] }),

  setStats: (partial) =>
    set((s) => {
      const next: LinkStats = { ...s.stats, ...partial };
      // Bail out if nothing actually changed — keeps subscribers from
      // re-rendering on every poll cycle when the radio is idle.
      if (
        next.bleRssi === s.stats.bleRssi &&
        next.loraTxCount === s.stats.loraTxCount &&
        next.loraRxCount === s.stats.loraRxCount &&
        next.loraLastRssi === s.stats.loraLastRssi &&
        next.loraLastSnr === s.stats.loraLastSnr
      ) {
        return s;
      }
      return { stats: next };
    }),

  setLastReply: (summary) => set({ lastReplySummary: summary }),

  setEngineStatus: (engineStatus) =>
    set((s) => {
      // When the server sends us a status pub/rep, reconcile every
      // pending command intent against it. The rule applied to each
      // single-value intent is:
      //
      //   pending=true, value === engine  → drop  (round-trip success)
      //   pending=true, value !== engine  → keep  (optimistic phase;
      //                                            we're still in the
      //                                            1-2 s window where
      //                                            our tap may not have
      //                                            reached the engine
      //                                            yet, so show what
      //                                            the operator picked)
      //   pending=false, value === engine → drop  (already cleared via
      //                                            the match branch)
      //   pending=false, value !== engine → drop  (CRITICAL: engine
      //                                            wins. Two scenarios:
      //                                            (a) our cmd ACK'd
      //                                            but CaptainPad raced
      //                                            and clobbered the
      //                                            value; (b) some
      //                                            other engine-side
      //                                            mutation changed it
      //                                            after our write.)
      //   engine === null                 → keep  (no signal yet, leave
      //                                            intent visible)
      //
      // Without the pending=false + mismatch branch, a stale PortWatch
      // tap would pin the LIVE chip / picker highlight to the operator's
      // last choice forever — exactly the "CaptainPad changes pattern,
      // PortWatch UI doesn't follow" bug the user reported. Bridge ACKs
      // are sent only AFTER `_exec_cmd` awaits the engine HTTP call (see
      // bridge.py::_handle_cmd) so `pending=false` is a strong "engine
      // has heard us" signal — once that's true, every subsequent PUB is
      // the canonical truth and the optimistic intent loses its purpose.
      if (!engineStatus) return { engineStatus };
      const next = { ...s.intent };
      next.blackout = reconcileIntent(next.blackout, engineStatus.blackout);
      next.autopilot = reconcileIntent(
        next.autopilot,
        engineStatus.autopilot,
      );
      next.autopilotInterval = reconcileIntent(
        next.autopilotInterval,
        engineStatus.autopilotIntervalSec,
      );
      next.brightness = reconcileIntent(
        next.brightness,
        engineStatus.brightness,
      );
      next.activePattern = reconcileIntent(
        next.activePattern,
        engineStatus.activePattern,
      );
      next.deckPlaylist = reconcileIntent(
        next.deckPlaylist,
        engineStatus.deckPlaylistName,
      );
      next.viewOverride = reconcileIntent(
        next.viewOverride,
        engineStatus.viewOverrideActive,
      );

      // ── Active-playlist instant swap ─────────────────────────────
      //
      // This is the core fix for the "CaptainPad switches playlist but
      // PortWatch shows the old one" bug. Every PUB carries `pl/<name>`;
      // when that name changes (vs the previous status snapshot) we
      // immediately swap the displayed pattern list to whatever is
      // cached for the new name. If we have no cache for the new name
      // we deliberately set `patternList=null` — that signals the deck
      // card to show a loading placeholder instead of the previous
      // playlist's patterns (which would be actively misleading: the
      // operator might tap a row from PlaylistA while the LIVE chip
      // already says PlaylistB).
      //
      // The deck card's auto-hydrate effect watches `deckPlaylistName`
      // and kicks off a paginated fetch on the null-cache path; this
      // setter does NOT trigger that fetch directly because Zustand
      // reducers must be pure (no link.sendOp side-effects from a
      // setter).
      //
      // Same reasoning, smaller blast radius, for `activePattern` →
      // `localExports`: a pattern change should not leave the previous
      // pattern's slider list visible while a fresh fetch races. If we
      // have last-seen exports for the new pattern in
      // `localExportsByPattern[newPat]` we surface them immediately
      // (stale-but-meaningful UX); otherwise we clear to null so the
      // ParamsCard renders an empty list + spinner instead of the old
      // sliders. The ParamsCard's own `activePattern` effect fires
      // `refresh()` to pull fresh values.
      const prevName = s.engineStatus?.deckPlaylistName ?? null;
      const newName = engineStatus.deckPlaylistName ?? null;
      const prevPat = s.engineStatus?.activePattern ?? null;
      const newPat = engineStatus.activePattern ?? null;

      const updates: Partial<AppState> = { engineStatus, intent: next };
      if (newName !== prevName) {
        updates.patternList = newName
          ? s.patternsByPlaylist[newName] ?? null
          : null;
      }
      if (newPat !== prevPat) {
        updates.localExports = newPat
          ? s.localExportsByPattern[newPat] ?? null
          : null;
      }
      return updates;
    }),

  setPatternList: (patternList) => set({ patternList }),
  setPatternsLoading: (patternsLoading) => set({ patternsLoading }),

  cachePatternsForPlaylist: (playlistName, list) =>
    set((s) => {
      if (!playlistName) return { patternList: list };
      const nextMap: Record<string, PatternList> = {
        ...s.patternsByPlaylist,
        [playlistName]: list,
      };
      // Fire-and-forget persist. AsyncStorage is async but we don't
      // gate UI updates on it — the in-memory write is the operator-
      // visible event. Persistence is "the cache that was just
      // written will survive an app kill", not "the next render
      // will block until disk acked".
      void persistPatternsByPlaylist(nextMap);
      // Only flip the LIVE `patternList` view when we're caching the
      // playlist the deck is CURRENTLY loaded with. The REFRESH-WORLD
      // action calls this once per playlist in the library; without
      // the guard, the picker would flash through every other
      // playlist's patterns in sequence before settling on the deck's
      // own list. The guard reads the engine's view of "active" (the
      // most recent PUB's `pl/`), falling back to the deck-playlist
      // info if no PUB has landed yet on this connection.
      const activeName =
        s.engineStatus?.deckPlaylistName ?? s.deckPlaylist?.name ?? null;
      return {
        patternList: activeName === playlistName ? list : s.patternList,
        patternsByPlaylist: nextMap,
      };
    }),

  invalidatePatternsCache: (playlistName) =>
    set((s) => {
      if (playlistName === null) {
        void persistPatternsByPlaylist({});
        return { patternsByPlaylist: {} };
      }
      if (!(playlistName in s.patternsByPlaylist)) return s;
      const next = { ...s.patternsByPlaylist };
      delete next[playlistName];
      void persistPatternsByPlaylist(next);
      return { patternsByPlaylist: next };
    }),

  hydratePatternsByPlaylist: (map) =>
    // Hydration write: bulk-replace the map, no persist (we just
    // loaded it FROM disk; persisting again would be a redundant
    // round-trip and could race with an in-flight save).
    set({ patternsByPlaylist: map }),

  hydrateWorldSnapshot: (snapshot) =>
    // Bulk-replace every persisted slice from one disk read. No
    // persist on this path (same reason as hydratePatternsByPlaylist
    // above). Each slice is independently nullable so a partial cache
    // (e.g. library cached but patterns not) is preserved verbatim.
    set({
      playlistLibrary: snapshot.playlistLibrary,
      patternsByPlaylist: snapshot.patternsByPlaylist,
      localExportsByPattern: snapshot.localExportsByPattern,
      snapshotBuiltAtMs: snapshot.snapshotBuiltAtMs,
    }),

  setSnapshotBuiltAt: (ts) => {
    void persistSnapshotTimestamp(ts);
    set({ snapshotBuiltAtMs: ts });
  },

  setWorldRebuildInProgress: (b) => set({ worldRebuildInProgress: b }),

  setGlobalParams: (globalParams) =>
    set((s) => {
      // Reconcile every pending global-param intent against the new
      // snapshot.
      //
      // Decision table (mirrors `reconcileIntent` in intent.ts):
      //   * engine value missing → keep intent  (no signal to reconcile against)
      //   * intent agrees with engine → DROP intent (canonical now matches)
      //   * intent disagrees AND intent.pending → KEEP (optimistic UI)
      //   * intent disagrees AND !intent.pending → DROP (engine wins)
      //
      // The last case is the headline fix for the
      // "CaptainPad change vanishes" bug on params: previously a
      // stale (resolved-but-disagreeing) intent would shadow the
      // engine value forever, so a CaptainPad-side speed change
      // would never appear in PortWatch even with polling running.
      //
      // Partial-merge contract: this setter is called from BOTH the
      // periodic `qry params` poll (full snapshot, every field
      // present) AND the compact PUB lift path (sparse snapshot —
      // only the keys the engine actually reported in the PUB).
      // Null-on-input means "no signal for this field this tick",
      // NOT "the engine erased this param" — so we MERGE rather
      // than overwrite. Without this, a PUB-driven partial snapshot
      // would wipe every other field to null and visibly blank the
      // ParamsCard until the next 5 s polling tick.
      if (!globalParams) return { globalParams };
      const prev = s.globalParams;
      const merged: GlobalParamsSnapshot = {
        speed: globalParams.speed ?? (prev?.speed ?? null),
        direction: globalParams.direction ?? (prev?.direction ?? null),
        count: globalParams.count ?? (prev?.count ?? null),
        size: globalParams.size ?? (prev?.size ?? null),
        rotate: globalParams.rotate ?? (prev?.rotate ?? null),
        palette1: globalParams.palette1 ?? (prev?.palette1 ?? null),
        palette2: globalParams.palette2 ?? (prev?.palette2 ?? null),
        receivedAtMs: globalParams.receivedAtMs,
        rawArg: globalParams.rawArg,
      };
      const next = { ...s.intent, globalParams: { ...s.intent.globalParams } };
      const lookup: Record<string, number | HsvTriple | null> = {
        speed: merged.speed,
        direction: merged.direction,
        count: merged.count,
        size: merged.size,
        rotate: merged.rotate,
        colorPalette1: merged.palette1,
        colorPalette2: merged.palette2,
      };
      // Only reconcile against fields the engine actually delivered
      // this tick — a merged-in-from-prev field shouldn't cause us
      // to drop an intent the operator just dispatched on a
      // different param.
      const reportedThisTick: Record<string, boolean> = {
        speed: globalParams.speed !== null,
        direction: globalParams.direction !== null,
        count: globalParams.count !== null,
        size: globalParams.size !== null,
        rotate: globalParams.rotate !== null,
        colorPalette1: globalParams.palette1 !== null,
        colorPalette2: globalParams.palette2 !== null,
      };
      for (const k of Object.keys(next.globalParams)) {
        const intent = next.globalParams[k];
        const live = lookup[k];
        if (live === undefined || live === null) continue; // no signal
        if (!reportedThisTick[k]) continue; // value came from prev
        let agree = false;
        if (typeof intent.value === "number" && typeof live === "number") {
          agree = _scalarsAgree(intent.value, live);
        } else if (
          typeof intent.value === "object" &&
          typeof live === "object"
        ) {
          agree = _hsvAgree(intent.value, live);
        }
        if (agree || !intent.pending) {
          // Either canonical now matches OR our write has resolved
          // and the engine moved on without us — drop the stale
          // intent so the UI reads off `globalParams` directly.
          delete next.globalParams[k];
        }
        // else: pending & disagree → keep the optimistic value
      }
      // Persist the merged snapshot so a cold-start app open paints
      // the last-known slider positions instead of "Waiting…". The
      // helper debounces writes by ~2 s so a burst of PUBs (plus the
      // 5 s poll) doesn't thrash AsyncStorage.
      persistGlobalParamsDebounced(merged);
      return { globalParams: merged, intent: next };
    }),
  setGlobalParamsLoading: (globalParamsLoading) => set({ globalParamsLoading }),

  setLocalExports: (localExports) =>
    set((s) => {
      // Same reconciliation pattern as global params, but indexed by
      // export id and only over v0 (the only field PortWatch writes).
      if (!localExports) return { localExports };
      const next = { ...s.intent, localExports: { ...s.intent.localExports } };
      const v0ById: Record<string, number> = {};
      for (const e of localExports) v0ById[String(e.id)] = e.v0;
      for (const k of Object.keys(next.localExports)) {
        const intent = next.localExports[k];
        const live = v0ById[k];
        if (live === undefined) continue;
        // Same decision table as setGlobalParams — drop if agree OR
        // not pending. The "not pending" path catches the
        // CaptainPad-changes-but-stale-intent-shadows-it bug
        // (mirror of the global-params fix).
        if (_scalarsAgree(intent.value, live) || !intent.pending) {
          delete next.localExports[k];
        }
      }
      // Also bin the list under the active pattern name so a future
      // pattern-switch back to this name surfaces the slider list
      // INSTANTLY (no LoRa round-trip) from `localExportsByPattern`.
      // The active pattern comes from the most recent engineStatus —
      // if we haven't received any status yet we skip the per-pattern
      // bin (the unbound list still ships out via `localExports`).
      const activePat = s.engineStatus?.activePattern ?? null;
      let lebp = s.localExportsByPattern;
      if (activePat) {
        lebp = { ...s.localExportsByPattern, [activePat]: localExports };
        void persistLocalExportsByPattern(lebp);
      }
      return { localExports, intent: next, localExportsByPattern: lebp };
    }),
  setLocalExportsLoading: (localExportsLoading) => set({ localExportsLoading }),

  setPlaylistLibrary: (playlistLibrary) => {
    // Fire-and-forget persist mirrors `cachePatternsForPlaylist`.
    void persistPlaylistLibrary(playlistLibrary);
    set({ playlistLibrary });
  },
  setPlaylistLibraryLoading: (playlistLibraryLoading) =>
    set({ playlistLibraryLoading }),
  setPlaylistLibraryError: (playlistLibraryError) =>
    set({ playlistLibraryError }),
  setPatternListError: (patternListError) =>
    set({ patternListError }),
  markPlaylistsHydrated: (connectGen) =>
    // Idempotent: setting it to the same value twice is fine, the
    // gating effect just sees the equality and proceeds. We do NOT
    // bump beyond `connectGeneration` — anyone calling this with a
    // stale generation (e.g. a slow async finishing after a fresh
    // BLE reconnect) will write a smaller value and the gate will
    // still wait for the new generation to complete.
    set({ playlistsHydratedForConn: connectGen }),
  bumpConnectGeneration: () =>
    set((s) => ({
      connectGeneration: s.connectGeneration + 1,
      // Reset every per-card error on a fresh connect so the UI
      // doesn't show "FAILED — RETRY" left over from the last
      // session before the new hydration has even tried.
      playlistLibraryError: null,
      patternListError: null,
      // Reset the serial-load gate so the new connection starts
      // its hydration from scratch (playlists first, patterns
      // second). Without this reset, a brief disconnect/reconnect
      // would skip the playlist library because the previous
      // session's hydration sentinel would still equal the (now
      // bumped) connectGeneration only after the new generation
      // catches up — confusing race.
      playlistsHydratedForConn: 0,
    })),

  setDeckPlaylist: (deckPlaylist) =>
    set((s) => {
      // Resolve the deck-playlist intent the moment the engine
      // confirms the new name. Mismatches stay pending so the operator
      // can see "still switching…" instead of an instantly-stale row.
      if (!deckPlaylist) return { deckPlaylist };
      const next = { ...s.intent };
      if (
        next.deckPlaylist &&
        deckPlaylist.name !== null &&
        next.deckPlaylist.value === deckPlaylist.name
      ) {
        next.deckPlaylist = undefined;
      }
      return { deckPlaylist, intent: next };
    }),
  setDeckPlaylistSwitching: (deckPlaylistSwitching) =>
    set({ deckPlaylistSwitching }),

  intendBlackout: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        blackout: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendAutopilot: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        autopilot: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendAutopilotInterval: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        autopilotInterval: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendBrightness: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        brightness: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendActivePattern: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        activePattern: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendViewOverride: (value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        viewOverride: { value, pending: true, setAtMs: Date.now() },
      },
    })),

  intendFx: (name, value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        fxStates: {
          ...s.intent.fxStates,
          [name]: { value, pending: true, setAtMs: Date.now() },
        },
      },
    })),

  intendGlobalParam: (key, value) =>
    set((s) => ({
      intent: {
        ...s.intent,
        globalParams: {
          ...s.intent.globalParams,
          [key]: { value, pending: true, setAtMs: Date.now() },
        },
      },
    })),

  intendLocalExport: (controlId, v0) =>
    set((s) => ({
      intent: {
        ...s.intent,
        localExports: {
          ...s.intent.localExports,
          [String(controlId)]: { value: v0, pending: true, setAtMs: Date.now() },
        },
      },
    })),

  intendDeckPlaylist: (name) =>
    set((s) => ({
      intent: {
        ...s.intent,
        deckPlaylist: { value: name, pending: true, setAtMs: Date.now() },
      },
    })),

  markIntentResolved: (field) =>
    set((s) => {
      const next: CommandIntent = {
        ...s.intent,
        fxStates: { ...s.intent.fxStates },
        globalParams: { ...s.intent.globalParams },
        localExports: { ...s.intent.localExports },
      };
      if (field === "blackout" && next.blackout) {
        next.blackout = { ...next.blackout, pending: false };
      } else if (field === "autopilot" && next.autopilot) {
        next.autopilot = { ...next.autopilot, pending: false };
      } else if (field === "autopilotInterval" && next.autopilotInterval) {
        next.autopilotInterval = { ...next.autopilotInterval, pending: false };
      } else if (field === "brightness" && next.brightness) {
        next.brightness = { ...next.brightness, pending: false };
      } else if (field === "activePattern" && next.activePattern) {
        next.activePattern = { ...next.activePattern, pending: false };
      } else if (field === "viewOverride" && next.viewOverride) {
        next.viewOverride = { ...next.viewOverride, pending: false };
      } else if (field === "deckPlaylist" && next.deckPlaylist) {
        next.deckPlaylist = { ...next.deckPlaylist, pending: false };
      } else if (field.startsWith("fx:")) {
        const fxName = field.slice(3);
        const cur = next.fxStates[fxName];
        if (cur) {
          next.fxStates[fxName] = { ...cur, pending: false };
        }
      } else if (field.startsWith("globalParam:")) {
        const key = field.slice("globalParam:".length);
        const cur = next.globalParams[key];
        if (cur) {
          next.globalParams[key] = { ...cur, pending: false };
        }
      } else if (field.startsWith("localExport:")) {
        const key = field.slice("localExport:".length);
        const cur = next.localExports[key];
        if (cur) {
          next.localExports[key] = { ...cur, pending: false };
        }
      }
      return { intent: next };
    }),

  resetIntent: () =>
    set((s) => ({
      intent: EMPTY_INTENT,
      engineStatus: null,
      patternList: null,
      patternsLoading: false,
      // patternsByPlaylist + playlistLibrary + localExportsByPattern +
      // snapshotBuiltAtMs are intentionally PRESERVED across the
      // disconnect: the persisted cache is the operator's source of
      // truth until they hit REFRESH on the deck card. Wiping on
      // disconnect would force a multi-page LoRa fetch on every BLE
      // blip, which is the slow-load symptom the field operator
      // reported. `globalParams` is also preserved so the
      // ParamsCard's slider positions don't blank on a transient
      // disconnect — the next PUB / poll will overwrite with fresh
      // values within the polling cadence.
      patternsByPlaylist: s.patternsByPlaylist,
      playlistLibrary: s.playlistLibrary,
      localExportsByPattern: s.localExportsByPattern,
      snapshotBuiltAtMs: s.snapshotBuiltAtMs,
      globalParams: s.globalParams,
      patternListError: null,
      globalParamsLoading: false,
      localExports: null,
      localExportsLoading: false,
      playlistLibraryLoading: false,
      playlistLibraryError: null,
      deckPlaylist: null,
      deckPlaylistSwitching: false,
      worldRebuildInProgress: false,
    })),
}));

// parse.ts — turn the bridge's compact KV strings into typed objects.
//
// The bridge speaks four flavours of status messages:
//
//   1. Periodic broadcast — `pub` frame from src=0x01 to dst=0xff with
//      `arg = "fps/40,pat/sunset,br/100,blk/0,ap/1,sp/0.5,upt/123"` (or
//      `arg = "dn/1"` if the engine is unreachable). Cadence: 5 s while
//      a captain has been active in the last 30 s, 30 s otherwise.
//   2. Reply to `qry engine/status` — `rep` frame from src=0x01 with
//      the same KV format.
//   3. Reply to `qry engine/patterns` — `rep` frame from src=0x01 with
//      `arg = "00_pat_a,01_pat_b,…"` (comma-separated). Bridge clamps
//      the list at ~115 chars and appends `+N` when truncated, e.g.
//      `"00_a,01_b,02_c,+12"` means 12 more patterns are available
//      that didn't fit. (Legacy single-frame shape.)
//   4. Reply to `qry engine/patterns/p/<n>` — `rep` frame from src=0x01
//      with `arg = "p/<idx>,t/<total>,n/<count>,c/<csv>"`, the paged
//      shape PortWatch uses to fetch the FULL catalog over multiple
//      LoRa frames. The CSV after `c/` may contain commas — DO NOT
//      naive-split the whole arg.
//
// Every parser here is defensive: malformed fields are coerced to
// `null` rather than throwing, so a stale schema or a future key the
// engine adds doesn't take the UI down.

export interface EngineStatus {
  /** Active pattern name on the engine, or null if unknown. */
  activePattern: string | null;
  /** Master brightness, 0..100. */
  brightness: number | null;
  /** Global blackout state. */
  blackout: boolean | null;
  /** Autopilot active state. */
  autopilot: boolean | null;
  /**
   * Autopilot transition interval in seconds (the engine's
   * `autopilot.delay_s`). Null when the engine hasn't reported one
   * yet (e.g. during the first compact-status PUB after a fresh
   * reconnect).
   */
  autopilotIntervalSec: number | null;
  /**
   * Autopilot shuffle flag. Mirrors the engine's
   * `autopilot.shuffle` so the UI can light up the SHUFFLE pill in
   * sync with CaptainPad / scripts that flip it.
   */
  autopilotShuffle: boolean | null;
  /** Shared CPC speed param (0..1). */
  speed: number | null;
  /** Engine framerate (rounded). */
  fps: number | null;
  /** Engine uptime in seconds. */
  uptimeSec: number | null;
  /** True if the bridge reported the engine is down. */
  engineDown: boolean;
  /**
   * Which view the engine is currently rendering — "deck" or "mixer".
   * Sourced from the bridge's `vw/<…>` field (engine
   * `/mixer/view-override` `currentView`). Null until the first PUB
   * lands. Drives the deck-controls gating: PortWatch only allows
   * pattern selection / autopilot writes when the engine is on
   * `deck` or when the operator has explicitly engaged the deck
   * override (see `viewOverrideActive`).
   */
  engineView: "deck" | "mixer" | null;
  /**
   * True when the deck-view override is pinned (PortWatch took
   * control of the deck regardless of what the live-mixer panel is
   * trying to set). Sourced from the bridge's `vov/<0|1>` field.
   */
  viewOverrideActive: boolean | null;
  /**
   * Current controlLock owner reported by the engine, or null when
   * the lock is free. Sourced from the bridge's `lk/<owner>` field
   * (with the string `-` mapping back to `null` here). The owner
   * namespace is intentionally open-ended ("portwatch" today,
   * possibly "captain" / "debug" later) so PortWatch should compare
   * against its OWN identity string to decide whether the lease it
   * thinks it holds is still actually engine-side.
   */
  controlLockOwner: string | null;
  /**
   * Seconds remaining on the controlLock lease as the bridge last
   * heard from the engine. `0` when no lock is held. Drives the
   * defensive renew path in DeckScreen — if remaining drops below
   * our renew interval we send an extra renew immediately rather
   * than waiting for the next scheduled tick.
   */
  controlLockLeaseRemainSec: number;
  /**
   * Active deck playlist name reported by the engine, or null when
   * no playlist is loaded. Sourced from the bridge's `pl/<name>`
   * field (with `-` mapping back to `null`). Critical on first
   * connect — lets PortWatch tell the operator which show is live
   * before they touch anything.
   */
  deckPlaylistName: string | null;
  /**
   * Wall-clock millis when this status was received on the phone.
   * Used by Status screen to display "last update X s ago".
   */
  receivedAtMs: number;
  /** Original KV string, kept for debugging in the wire log. */
  rawArg: string;
}

/**
 * Identify whether a REP frame's KV body is a compact-status reply
 * (vs. a different REP shape — patterns list, playlist patterns,
 * param snapshot, deck/playlist snapshot). Lives next to
 * {@link parseEngineStatus} so the routing-side check and the
 * parse-side schema stay in lockstep.
 *
 * Why we parse instead of substring-search
 * ----------------------------------------
 * The earlier implementation used `arg.includes("pl/")` for defense
 * in depth. That bit us hard: `qry engine/deck/playlist` returns a
 * REP whose body is `pl/<name>,en/<entryId>` — which contains the
 * substring `pl/`, so the gate mistook it for a compact-status REP
 * and called `setEngineStatus(parseEngineStatus(...))` on it. The
 * parser dutifully returned an EngineStatus with `engineView = null`
 * (no `vw/` key), `activePattern = null` (no `pat/`), `blackout =
 * null`, etc. — clobbering the GOOD status snapshot the deck card
 * had a moment ago and surfacing as "UNKNOWN ENGINE VIEW" in the
 * override-gate tile, even though the engine was on deck the whole
 * time.
 *
 * Fix: parse the body as KV first, then check for keys that ONLY
 * compact_status emits. None of the OTHER bridge REP shapes
 * (engine/deck/playlist, engine/patterns/p/<n>, engine/playlists/
 * p/<n>, engine/get-playlist-patterns/<name>/p/<n>, exports/p/<n>,
 * params/snapshot, deck) carry these keys, so the predicate is now
 * strictly selective.
 *
 * Marker set
 * ----------
 *   * `pat`  — active pattern (the bridge GUARANTEES this is emitted
 *              on every compact_status — `-` when the base channel
 *              has no pattern loaded, `?` when there's no base
 *              channel at all, the real name otherwise).
 *   * `dn`   — engine-unreachable short-circuit (body is `dn/1` and
 *              nothing else; `pat/` is suppressed in this case so
 *              we need this as the fallback).
 *   * `vov`, `lk`, `lku` — controlLock/override fields. The bridge
 *              emits all three whenever the parallel `/mixer/view-
 *              override` call returns a dict (even an empty one,
 *              because the inner `if isinstance(vo, dict)` branches
 *              always assign defaults `vov/0`, `lk/-`, `lku/0`).
 *              They are NEVER emitted by any non-status REP, so
 *              they're our defense-in-depth markers in case some
 *              future bridge edit accidentally drops `pat/` again.
 *
 * Deliberately NOT in the marker set
 * ----------------------------------
 *   * `pl`   — `engine/deck/playlist` REPs use this key with a
 *              different body shape. The substring-based predicate
 *              that included `pl/` caused the May 2026 "UNKNOWN
 *              ENGINE VIEW" regression described above.
 *   * `vw`   — only emitted by compact_status, but it's conditional
 *              on `vo.currentView` being valid; `vov`/`lk`/`lku`
 *              cover the same case and are unconditional, so `vw`
 *              would be redundant here.
 */
export function isCompactStatusArg(arg: string): boolean {
  if (!arg) return false;
  const kv = parseKv(arg);
  // Require a NON-EMPTY value for the marker key. Paged-list REPs
  // (`c/<csv>` shape) parse trailing CSV items as bare keys with
  // empty values — i.e. a pattern literally named `pat` would land
  // as `kv["pat"] = ""` in a paged patterns reply. compact_status
  // by contrast always emits a real value for each marker
  // (`pat/<name|-|?>`, `dn/1`, `vov/<0|1>`, `lk/<-|owner>`,
  // `lku/<int>`), so the empty-value check cleanly distinguishes
  // them.
  return (
    !!kv["pat"] ||
    !!kv["dn"] ||
    !!kv["vov"] ||
    !!kv["lk"] ||
    !!kv["lku"]
  );
}

/** Parse a `pub`/`rep` engine-status arg. Always returns a well-formed object. */
export function parseEngineStatus(arg: string, receivedAtMs: number): EngineStatus {
  const kv = parseKv(arg);
  const status: EngineStatus = {
    activePattern: patternNameOrNull(kv["pat"]),
    brightness: numberOrNull(kv["br"]),
    blackout: boolOrNull(kv["blk"]),
    autopilot: boolOrNull(kv["ap"]),
    autopilotIntervalSec: positiveIntOrNull(kv["apd"]),
    autopilotShuffle: boolOrNull(kv["aps"]),
    speed: numberOrNull(kv["sp"]),
    fps: numberOrNull(kv["fps"]),
    uptimeSec: numberOrNull(kv["upt"]),
    engineDown: kv["dn"] === "1",
    engineView: viewOrNull(kv["vw"]),
    viewOverrideActive: boolOrNull(kv["vov"]),
    controlLockOwner: ownerOrNull(kv["lk"]),
    controlLockLeaseRemainSec: nonNegIntOrZero(kv["lku"]),
    deckPlaylistName: dashOrNull(kv["pl"]),
    receivedAtMs,
    rawArg: arg,
  };
  return status;
}

/**
 * Lift the global-params subset off the same compact-status KV
 * payload. Returns null when none of the global-params keys are
 * present (typical for an older bridge that still only sends `sp`).
 * Callers feed the result into `useAppStore.setGlobalParams` so the
 * PUB-driven path stays in sync with the polled snapshot fetched
 * by `useGlobalParamsPoller`.
 *
 * Skipping null per-field is the merge contract: a PUB only carries
 * keys the engine currently has. Anything absent leaves the store's
 * field untouched (see `setGlobalParams`).
 */
export function liftGlobalParamsFromCompactStatus(
  arg: string,
  receivedAtMs: number,
): GlobalParamsSnapshot | null {
  const kv = parseKv(arg);
  const hasAny =
    "sp" in kv ||
    "dr" in kv ||
    "ct" in kv ||
    "sz" in kv ||
    "rt" in kv ||
    "p1" in kv ||
    "p2" in kv;
  if (!hasAny) return null;
  return {
    speed: numberOrNull(kv["sp"]),
    direction: numberOrNull(kv["dr"]),
    count: numberOrNull(kv["ct"]),
    size: numberOrNull(kv["sz"]),
    rotate: numberOrNull(kv["rt"]),
    palette1: parseHsvTriple(kv["p1"]),
    palette2: parseHsvTriple(kv["p2"]),
    receivedAtMs,
    rawArg: arg,
  };
}

function viewOrNull(s: string | undefined): "deck" | "mixer" | null {
  if (s === "deck" || s === "mixer") return s;
  return null;
}

function ownerOrNull(s: string | undefined): string | null {
  // The bridge omits `lk` entirely (and used to send `-`) when the
  // lock is free; treat missing / empty / `-` identically as "no
  // owner". The bridge also shortens well-known owners to wire
  // codes ("pw" for "portwatch") so a lock-active compact_status
  // fits in the 250-char Heltec firmware buffer — we expand the
  // short codes back to canonical names here so existing UI
  // comparisons like `controlLockOwner === "portwatch"` keep
  // working unchanged. New owners can be added to the WIRE_OWNER
  // table below as the namespace grows.
  if (!s || s === "-") return null;
  switch (s) {
    case "pw":
      return "portwatch";
    default:
      return s;
  }
}

function nonNegIntOrZero(s: string | undefined): number {
  // Lease remaining seconds. We never let a bad value flow as NaN
  // into UI timers; default to 0 which means "no lease info" and
  // makes the renew logic conservative.
  if (s === undefined || s === null || s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function dashOrNull(s: string | undefined): string | null {
  if (!s || s === "-") return null;
  return s;
}

/**
 * Like {@link dashOrNull} but also rejects `?`, the sentinel
 * compact_status emits when the bridge couldn't find a base channel
 * on /mixer at all (engine in a transitional state). Used for the
 * active-pattern field where BOTH `-` (base channel exists, no
 * pattern loaded) and `?` (no base channel) mean "show the placeholder
 * dash" in the UI — letting either leak through would surface as a
 * literal "-" or "?" in the ACTIVE PATTERN row, which is worse than
 * the existing em-dash fallback that fires when this returns null.
 */
function patternNameOrNull(s: string | undefined): string | null {
  if (!s || s === "-" || s === "?") return null;
  return s;
}

/**
 * Parse a `rep` reply to `qry engine/patterns`.
 *
 * The bridge clamps the list at 115 chars and appends `+<n>` when
 * truncated — see comms/bridge.py::_exec_qry. We strip that token, set
 * `truncatedExtra` to <n> so the UI can show "showing 12 of 24", and
 * return the parsed array.
 */
export interface PatternList {
  patterns: string[];
  truncatedExtra: number;
  receivedAtMs: number;
  rawArg: string;
}

export function parsePatternList(arg: string, receivedAtMs: number): PatternList {
  const tokens = arg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let truncatedExtra = 0;
  const patterns: string[] = [];
  for (const t of tokens) {
    if (t.startsWith("+")) {
      const n = Number(t.slice(1));
      if (Number.isFinite(n)) truncatedExtra = n;
      continue;
    }
    patterns.push(t);
  }
  return { patterns, truncatedExtra, receivedAtMs, rawArg: arg };
}

/** A single page from the bridge's paginated patterns query. */
export interface PatternPage {
  /** Zero-based page index this reply is for. */
  pageIndex: number;
  /** Total number of pages the operator must fetch to get everything. */
  totalPages: number;
  /** Total number of patterns the engine has (across all pages). */
  totalCount: number;
  /** Pattern names contained in THIS page (already split off the `c/` blob). */
  patterns: string[];
  /** The original arg, kept for the wire log. */
  rawArg: string;
}

/**
 * Parse a `rep` reply to `qry engine/patterns/p/<n>`.
 *
 * Wire shape (single LoRa frame): `p/<idx>,t/<total>,n/<count>,c/<csv>`.
 * The CSV after `c/` is allowed to contain commas (it's the only field
 * that does), so we MUST consume the metadata fields one-by-one and
 * treat the rest as a single blob — `arg.split(",")` would shred it.
 *
 * Returns null on malformed input (rather than throwing) so the UI
 * can surface "got a non-paged reply, falling back to truncated CSV"
 * without crashing.
 */
export function parsePatternPage(arg: string): PatternPage | null {
  let cur = arg;
  const meta: { p?: number; t?: number; n?: number } = {};
  for (const key of ["p", "t", "n"] as const) {
    const commaIdx = cur.indexOf(",");
    if (commaIdx < 0) return null;
    const token = cur.slice(0, commaIdx);
    cur = cur.slice(commaIdx + 1);
    const slash = token.indexOf("/");
    if (slash < 0) return null;
    const k = token.slice(0, slash);
    const v = token.slice(slash + 1);
    if (k !== key) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    meta[key] = n;
  }
  if (!cur.startsWith("c/")) return null;
  const csv = cur.slice(2);
  const patterns = csv.length === 0
    ? []
    : csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    pageIndex: meta.p!,
    totalPages: meta.t!,
    totalCount: meta.n!,
    patterns,
    rawArg: arg,
  };
}

/**
 * A single page from the bridge's `engine/playlist-patterns/p/<n>`
 * query. Same shape as PatternPage but ALSO carries the playlist
 * name so the picker can label itself and detect mid-fetch swaps.
 */
export interface PlaylistPatternsPage extends PatternPage {
  /** Active playlist name; null when the engine has no playlist loaded. */
  playlistName: string | null;
}

/**
 * Parse a `rep` reply to `qry engine/playlist-patterns/p/<n>`.
 *
 * Wire shape (single LoRa frame):
 *   `p/<idx>,t/<total>,n/<count>,pl/<name>,c/<csv>`
 *
 * - `pl/-` is the wire encoding for "no playlist loaded" (using a
 *   single `-` keeps the field non-empty so the parser doesn't have
 *   to special-case zero-length tokens). We normalize it back to
 *   null so callers can treat it the same way as a missing field.
 *
 * Like parsePatternPage, the CSV after `c/` is allowed to contain
 * commas — we consume the metadata fields one-by-one and treat
 * everything after `c/` as a single blob.
 *
 * Returns null on malformed input.
 */
export function parsePlaylistPatternsPage(
  arg: string,
): PlaylistPatternsPage | null {
  let cur = arg;
  const meta: { p?: number; t?: number; n?: number } = {};
  for (const key of ["p", "t", "n"] as const) {
    const commaIdx = cur.indexOf(",");
    if (commaIdx < 0) return null;
    const token = cur.slice(0, commaIdx);
    cur = cur.slice(commaIdx + 1);
    const slash = token.indexOf("/");
    if (slash < 0) return null;
    const k = token.slice(0, slash);
    const v = token.slice(slash + 1);
    if (k !== key) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    meta[key] = n;
  }
  // Playlist name comes BEFORE the CSV. The bridge guarantees no
  // commas in the playlist name (it ASCII-folds them) so a single
  // `.indexOf(",")` is safe.
  if (!cur.startsWith("pl/")) return null;
  const plCommaIdx = cur.indexOf(",");
  if (plCommaIdx < 0) return null;
  const plName = cur.slice(3, plCommaIdx);
  cur = cur.slice(plCommaIdx + 1);
  if (!cur.startsWith("c/")) return null;
  const csv = cur.slice(2);
  const patterns = csv.length === 0
    ? []
    : csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    pageIndex: meta.p!,
    totalPages: meta.t!,
    totalCount: meta.n!,
    patterns,
    playlistName: plName === "-" ? null : plName,
    rawArg: arg,
  };
}

// ── Global params snapshot ──────────────────────────────────────────

export interface GlobalParamsSnapshot {
  /** All five scalar globals; null when the engine didn't include the field. */
  speed: number | null;
  direction: number | null;
  count: number | null;
  size: number | null;
  rotate: number | null;
  /** HSV palette slot 1 (`{h, s, v}` ∈ [0, 1]³); null until first sync. */
  palette1: HsvTriple | null;
  palette2: HsvTriple | null;
  receivedAtMs: number;
  rawArg: string;
}

export interface HsvTriple {
  h: number;
  s: number;
  v: number;
}

/**
 * Parse the bridge reply to `qry params`. Wire shape:
 *
 *   `sp/<f>,dr/<f>,ct/<f>,sz/<f>,rt/<f>,p1/<h>-<s>-<v>,p2/<h>-<s>-<v>`
 *
 * Order is fixed by the bridge but the parser doesn't depend on it
 * — every key is looked up by name. Missing scalars stay null so the
 * caller can render "—" instead of "0".
 */
export function parseGlobalParamsSnapshot(
  arg: string,
  receivedAtMs: number,
): GlobalParamsSnapshot {
  const kv = parseKv(arg);
  return {
    speed: numberOrNull(kv["sp"]),
    direction: numberOrNull(kv["dr"]),
    count: numberOrNull(kv["ct"]),
    size: numberOrNull(kv["sz"]),
    rotate: numberOrNull(kv["rt"]),
    palette1: parseHsvTriple(kv["p1"]),
    palette2: parseHsvTriple(kv["p2"]),
    receivedAtMs,
    rawArg: arg,
  };
}

function parseHsvTriple(s: string | undefined): HsvTriple | null {
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const h = Number(parts[0]);
  const sat = Number(parts[1]);
  const v = Number(parts[2]);
  if (!Number.isFinite(h) || !Number.isFinite(sat) || !Number.isFinite(v)) {
    return null;
  }
  return { h, s: sat, v };
}

// ── Per-pattern exports paged reply ─────────────────────────────────

export interface LocalExport {
  /** CRC32 control id assigned by the engine. Stable per pattern + name. */
  id: number;
  /** Export kind. 1=slider, 2=toggle, 3=trigger, 4=plain (read-only), 6=hsv. */
  kind: number;
  /** Live v0 value at the time the bridge built the page. */
  v0: number;
  /** Truncated, ASCII-folded export name (≤ 24 chars on the wire). */
  name: string;
}

export interface ExportsPage {
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  exports: LocalExport[];
  rawArg: string;
}

/**
 * Parse a `rep` reply to `qry exports/p/<n>`.
 *
 * Wire shape: `p/<idx>,t/<total>,n/<count>,c/<rec>,<rec>,...`
 * Each `<rec>` is `<id>~<kind>~<v0>~<name>` (`~` is the within-record
 * separator since `:` is forbidden in frame args).
 *
 * Returns null on malformed input so the UI can fall back to
 * "no exports found" without crashing.
 */
export function parseExportsPage(arg: string): ExportsPage | null {
  const cur = parsePageHeader(arg);
  if (!cur) return null;
  const { meta, csv } = cur;
  const exports: LocalExport[] = [];
  if (csv.length > 0) {
    for (const rec of csv.split(",")) {
      const parts = rec.split("~");
      if (parts.length < 4) continue;
      const id = Number(parts[0]);
      const kind = Number(parts[1]);
      const v0 = Number(parts[2]);
      const name = parts.slice(3).join("~");
      if (!Number.isFinite(id) || !Number.isFinite(kind) || !Number.isFinite(v0)) {
        continue;
      }
      exports.push({ id, kind, v0, name });
    }
  }
  return {
    pageIndex: meta.p,
    totalPages: meta.t,
    totalCount: meta.n,
    exports,
    rawArg: arg,
  };
}

// ── Playlist library + active deck playlist ─────────────────────────

export interface PlaylistsPage {
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  /** Playlist names contained in this page. */
  playlists: string[];
  rawArg: string;
}

export function parsePlaylistsPage(arg: string): PlaylistsPage | null {
  const cur = parsePageHeader(arg);
  if (!cur) return null;
  const { meta, csv } = cur;
  const playlists =
    csv.length === 0
      ? []
      : csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    pageIndex: meta.p,
    totalPages: meta.t,
    totalCount: meta.n,
    playlists,
    rawArg: arg,
  };
}

export interface DeckPlaylistInfo {
  /** Playlist name currently loaded on the deck base channel, or null. */
  name: string | null;
  /** Active entry id within that playlist, when known. */
  entryId: string | null;
  rawArg: string;
}

export function parseDeckPlaylist(arg: string): DeckPlaylistInfo {
  const kv = parseKv(arg);
  const raw = kv["pl"];
  // Bridge sends `pl/-` to mean "no playlist loaded" — single-char
  // placeholder rather than an empty value (parseKv would coerce
  // empty to "" and confuse the "not yet synced" state).
  const name = !raw || raw === "-" ? null : raw;
  const entryId = kv["en"] ? kv["en"] : null;
  return { name, entryId, rawArg: arg };
}

// ── Helpers ─────────────────────────────────────────────────────────

interface ParsedPageHeader {
  meta: { p: number; t: number; n: number };
  csv: string;
}

/**
 * Shared header parser for the paged `p/<idx>,t/<total>,n/<count>,c/<csv>`
 * shape. Used by exports + playlists pages (same wire framing as
 * patterns, just different record layouts inside the CSV).
 *
 * The CSV after `c/` may contain commas — that's the only field that
 * does — so we MUST consume the metadata fields one-by-one and treat
 * the rest as a single blob.
 */
function parsePageHeader(arg: string): ParsedPageHeader | null {
  let cur = arg;
  const meta = { p: 0, t: 0, n: 0 };
  for (const key of ["p", "t", "n"] as const) {
    const commaIdx = cur.indexOf(",");
    if (commaIdx < 0) return null;
    const token = cur.slice(0, commaIdx);
    cur = cur.slice(commaIdx + 1);
    const slash = token.indexOf("/");
    if (slash < 0) return null;
    const k = token.slice(0, slash);
    const v = token.slice(slash + 1);
    if (k !== key) return null;
    const num = Number(v);
    if (!Number.isFinite(num)) return null;
    meta[key] = num;
  }
  if (!cur.startsWith("c/")) return null;
  return { meta, csv: cur.slice(2) };
}


function parseKv(arg: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!arg) return out;
  for (const tok of arg.split(",")) {
    const [k, v] = tok.split("/");
    if (!k) continue;
    out[k.trim()] = v ?? "";
  }
  return out;
}

function numberOrNull(s: string | undefined): number | null {
  if (s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function positiveIntOrNull(s: string | undefined): number | null {
  if (s === undefined || s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

function boolOrNull(s: string | undefined): boolean | null {
  if (s === undefined || s === "") return null;
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false") return false;
  return null;
}


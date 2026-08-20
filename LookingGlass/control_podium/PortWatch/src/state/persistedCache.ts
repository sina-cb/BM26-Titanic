// persistedCache.ts — durable storage for PortWatch's local world model.
// =========================================================================
//
// PortWatch keeps a persistent local snapshot of the engine's world so a
// cold app open doesn't have to re-paginate every playlist over LoRa. The
// snapshot ("world model") is operator-controlled: it is rebuilt only
// when the operator presses REFRESH on the deck card. Between refreshes
// PortWatch displays whatever is cached, and `engineStatus.deckPlaylistName`
// (which IS updated continuously by every compact PUB) just SELECTS which
// cached playlist's patterns to show.
//
// The snapshot consists of two persisted slices:
//
//   1. **WorldSnapshot**   — long-lived structural data (the playlist
//      library, each playlist's pattern list, each pattern's last-seen
//      local-export descriptors). Written rarely (on REFRESH + on first
//      local-export fetch per pattern). Hosts the data the operator
//      asked us to "cache everything locally".
//
//   2. **ValueCache**      — short-lived live values (the global-param
//      scalars/palettes and the last-seen `v0` for every local export
//      keyed by pattern). Written frequently (every PUB / poll). The
//      writer debounces so a noisy PUB stream doesn't thrash AsyncStorage.
//      Used at cold-start so the ParamsCard renders meaningful values
//      INSTANTLY instead of a blank "Waiting for engine state…" while
//      the first poll lands.
//
// Schema bump rationale:
//
//   * `pw.cache.v2.*` was an earlier name-keyed cache without snapshot
//     timestamps, value cache, or per-pattern export descriptors.
//   * `pw.world.v3.*` is the consolidated schema; everything for the
//     operator's local snapshot lives here.
//   * On first run of the new code, v2 entries are ignored (we don't
//     bother with a migration — one operator REFRESH brings v3 back
//     to a clean state, and we keep the load path simpler).
//
// Failure handling: every read returns sane defaults; every write
// swallows errors and console-warns. Persistence MUST NOT block the
// operator from using the app — a dead AsyncStorage just turns the
// world model into "in-memory only this session".

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  GlobalParamsSnapshot,
  LocalExport,
  PatternList,
} from "../status/parse";

const PREFIX = "pw.world.v3";
const KEY_LIBRARY = `${PREFIX}.library`;
const KEY_PATTERNS = `${PREFIX}.patterns`;
const KEY_TIMESTAMPS = `${PREFIX}.timestamps`;
const KEY_LOCAL_EXPORTS = `${PREFIX}.localExports`;
const KEY_GLOBAL_PARAMS = `${PREFIX}.globalParams`;

const ALL_KEYS = [
  KEY_LIBRARY,
  KEY_PATTERNS,
  KEY_TIMESTAMPS,
  KEY_LOCAL_EXPORTS,
  KEY_GLOBAL_PARAMS,
];

export interface WorldSnapshot {
  playlistLibrary: string[] | null;
  patternsByPlaylist: Record<string, PatternList>;
  localExportsByPattern: Record<string, LocalExport[]>;
  snapshotBuiltAtMs: number | null;
}

export interface PersistedWorld {
  world: WorldSnapshot;
  globalParams: GlobalParamsSnapshot | null;
}

const EMPTY_WORLD: WorldSnapshot = {
  playlistLibrary: null,
  patternsByPlaylist: {},
  localExportsByPattern: {},
  snapshotBuiltAtMs: null,
};

// ── Loading ────────────────────────────────────────────────────────────────

/**
 * Read the full persisted world off disk. Returns sane defaults on any
 * failure — the caller proceeds with a cold (empty) snapshot and the
 * operator can rebuild via REFRESH.
 *
 * Each slice is parsed defensively: a corrupt JSON value for one slice
 * does NOT taint the others. We rebuild typed objects from raw JSON
 * (rather than trusting the shape) so an old-schema entry left over
 * from a downgrade can't smuggle unexpected fields into the running
 * store.
 */
export async function loadPersistedWorld(): Promise<PersistedWorld> {
  const out: PersistedWorld = {
    world: { ...EMPTY_WORLD },
    globalParams: null,
  };
  let raw: readonly [string, string | null][] = [];
  try {
    raw = await AsyncStorage.multiGet(ALL_KEYS);
  } catch (err) {
    // AsyncStorage refused outright (disk full, app sandbox lockdown).
    // Skip persistence for this session — UI keeps working.
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] load failed wholesale:", err);
    return out;
  }
  const slice = (key: string): string | null => {
    for (const [k, v] of raw) if (k === key) return v;
    return null;
  };

  // Library
  const libRaw = slice(KEY_LIBRARY);
  if (libRaw) {
    try {
      const parsed = JSON.parse(libRaw);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "string")) {
        out.world.playlistLibrary = parsed;
      }
    } catch {
      // bad JSON — treat slice as cold
    }
  }

  // Patterns
  const patsRaw = slice(KEY_PATTERNS);
  if (patsRaw) {
    try {
      const parsed = JSON.parse(patsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const map: Record<string, PatternList> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const entry = sanitizePatternList(v);
          if (entry) map[k] = entry;
        }
        out.world.patternsByPlaylist = map;
      }
    } catch {
      // ignore — empty map
    }
  }

  // Timestamps
  const tsRaw = slice(KEY_TIMESTAMPS);
  if (tsRaw) {
    try {
      const parsed = JSON.parse(tsRaw);
      if (parsed && typeof parsed === "object") {
        const t = (parsed as { snapshotBuiltAtMs?: unknown }).snapshotBuiltAtMs;
        if (typeof t === "number" && Number.isFinite(t) && t > 0) {
          out.world.snapshotBuiltAtMs = t;
        }
      }
    } catch {
      // ignore — null timestamp
    }
  }

  // Local exports
  const leRaw = slice(KEY_LOCAL_EXPORTS);
  if (leRaw) {
    try {
      const parsed = JSON.parse(leRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const map: Record<string, LocalExport[]> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const cleaned = sanitizeLocalExportsList(v);
          if (cleaned) map[k] = cleaned;
        }
        out.world.localExportsByPattern = map;
      }
    } catch {
      // ignore
    }
  }

  // Global params
  const gpRaw = slice(KEY_GLOBAL_PARAMS);
  if (gpRaw) {
    try {
      const parsed = JSON.parse(gpRaw);
      const cleaned = sanitizeGlobalParams(parsed);
      if (cleaned) out.globalParams = cleaned;
    } catch {
      // ignore — null globals
    }
  }

  return out;
}

// ── Persistence ────────────────────────────────────────────────────────────

export async function persistPlaylistLibrary(
  library: string[] | null,
): Promise<void> {
  try {
    if (library === null) {
      await AsyncStorage.removeItem(KEY_LIBRARY);
      return;
    }
    await AsyncStorage.setItem(KEY_LIBRARY, JSON.stringify(library));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] save library failed:", err);
  }
}

export async function persistPatternsByPlaylist(
  map: Record<string, PatternList>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PATTERNS, JSON.stringify(map));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] save patterns failed:", err);
  }
}

export async function persistLocalExportsByPattern(
  map: Record<string, LocalExport[]>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_LOCAL_EXPORTS, JSON.stringify(map));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] save local exports failed:", err);
  }
}

export async function persistSnapshotTimestamp(
  builtAtMs: number | null,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY_TIMESTAMPS,
      JSON.stringify({ snapshotBuiltAtMs: builtAtMs }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] save timestamps failed:", err);
  }
}

// ── Debounced global-params writer ─────────────────────────────────────────
//
// `globalParams` gets written on every compact PUB + every snapshot poll
// reply. On a 5 s polling cadence + ~5 s active publisher cadence that's
// ~12 writes/min — small, but each one is one AsyncStorage round-trip and
// they're entirely redundant when the live values are identical to the
// last persisted snapshot. The debouncer collapses bursts (e.g. a quick
// poll + PUB that lands within ~ms) into a single write 2 s after the
// last queued update, which is plenty fast for a restore-on-cold-start
// path while making the write rate visually invisible.

let pendingGlobals: GlobalParamsSnapshot | null | undefined = undefined;
let pendingGlobalsTimer: ReturnType<typeof setTimeout> | null = null;
const GLOBALS_DEBOUNCE_MS = 2000;

export function persistGlobalParamsDebounced(
  gp: GlobalParamsSnapshot | null,
): void {
  pendingGlobals = gp;
  if (pendingGlobalsTimer !== null) return;
  pendingGlobalsTimer = setTimeout(() => {
    const toWrite = pendingGlobals;
    pendingGlobals = undefined;
    pendingGlobalsTimer = null;
    void persistGlobalParamsNow(toWrite);
  }, GLOBALS_DEBOUNCE_MS);
}

/**
 * Bypass the debouncer (used at shutdown / app-background hooks if we
 * ever wire them up). Also exposed for tests so they can assert the
 * final on-disk shape deterministically.
 */
export async function persistGlobalParamsNow(
  gp: GlobalParamsSnapshot | null | undefined,
): Promise<void> {
  if (gp === undefined) return;
  try {
    if (gp === null) {
      await AsyncStorage.removeItem(KEY_GLOBAL_PARAMS);
      return;
    }
    await AsyncStorage.setItem(KEY_GLOBAL_PARAMS, JSON.stringify(gp));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] save globals failed:", err);
  }
}

/**
 * Drop every persisted slice. Wired to a future "wipe local cache"
 * debug button + the test setup helper so each test can start with a
 * known-clean store.
 */
export async function clearPersistedCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(ALL_KEYS);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistedCache] clear failed:", err);
  }
}

// ── Sanitizers ─────────────────────────────────────────────────────────────
//
// Rebuild typed objects from raw parsed JSON to defend against schema
// drift (a downgrade leaving newer fields on disk) and tampered data. A
// single bad entry is dropped silently so it can't corrupt the whole map.

function sanitizePatternList(v: unknown): PatternList | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const patterns = obj.patterns;
  if (!Array.isArray(patterns) || !patterns.every((n) => typeof n === "string"))
    return null;
  return {
    patterns: patterns as string[],
    truncatedExtra: typeof obj.truncatedExtra === "number" ? obj.truncatedExtra : 0,
    receivedAtMs: typeof obj.receivedAtMs === "number" ? obj.receivedAtMs : Date.now(),
    rawArg: typeof obj.rawArg === "string" ? obj.rawArg : "",
  };
}

function sanitizeLocalExportsList(v: unknown): LocalExport[] | null {
  if (!Array.isArray(v)) return null;
  const out: LocalExport[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (
      typeof obj.id !== "number" ||
      typeof obj.kind !== "number" ||
      typeof obj.v0 !== "number" ||
      typeof obj.name !== "string"
    ) {
      continue;
    }
    out.push({
      id: obj.id,
      kind: obj.kind,
      v0: obj.v0,
      name: obj.name,
    });
  }
  return out;
}

function sanitizeGlobalParams(v: unknown): GlobalParamsSnapshot | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const numOrNull = (k: string): number | null => {
    const x = obj[k];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const hsvOrNull = (k: string): GlobalParamsSnapshot["palette1"] => {
    const x = obj[k];
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const t = x as Record<string, unknown>;
    if (
      typeof t.h === "number" &&
      typeof t.s === "number" &&
      typeof t.v === "number"
    ) {
      return { h: t.h, s: t.s, v: t.v };
    }
    return null;
  };
  return {
    speed: numOrNull("speed"),
    direction: numOrNull("direction"),
    count: numOrNull("count"),
    size: numOrNull("size"),
    rotate: numOrNull("rotate"),
    palette1: hsvOrNull("palette1"),
    palette2: hsvOrNull("palette2"),
    receivedAtMs: typeof obj.receivedAtMs === "number" ? obj.receivedAtMs : 0,
    rawArg: typeof obj.rawArg === "string" ? obj.rawArg : "",
  };
}

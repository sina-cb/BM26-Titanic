// rebuildWorld.ts — the operator's REFRESH-WORLD action.
// =========================================================================
//
// One operator press, one async task: rebuild the entire persistent local
// snapshot of the engine's world. Concretely:
//
//   1. Page through `qry playlists`               → playlist library.
//   2. For each name in the library, page through
//      `qry engine/get-playlist-patterns/<name>`  → per-playlist patterns.
//   3. Persist each slice as it lands (so a partial completion is durable).
//   4. Stamp `snapshotBuiltAtMs = Date.now()` on success.
//
// The action is the only path that pre-populates the cache; everything
// else displays from the cache and never refreshes it on a transient
// signal. Pattern caches for newly-discovered playlists (CaptainPad
// creates a new playlist between REFRESHes) are still filled on-demand
// by the deck card's auto-hydrate path — the REFRESH-WORLD action is
// about the operator-controlled FULL snapshot, not "all playlists ever".
//
// Failure modes (all best-effort):
//
//   * Library fetch fails → action aborts; existing cache untouched;
//     `worldRebuildInProgress` is still cleared so the UI doesn't hang.
//   * A single playlist's pattern fetch fails → that playlist's cache
//     entry stays at whatever it was (cached from a previous REFRESH,
//     or absent if first run). Action continues to the next playlist.
//   * Mid-rebuild BLE disconnect → caught by the `link.sendOp` error
//     path. Each playlist's persist runs immediately on landing, so
//     whatever we already finished is durable.
//
// We deliberately do NOT serialize behind a Zustand action — the
// reducer would have to handle a long-running promise, which is exactly
// what the Zustand "don't do effects inside reducers" guidance is for.
// Instead this is a free function that talks to the link, dispatches
// store actions, and reports its own progress via the lastReply
// summary.

import type { TitanicLink } from "../link/titanicLink";
import {
  buildPlaylistPatternsByNameQuery,
  buildPlaylistsPageQuery,
} from "../frame/ops";
import {
  parsePlaylistPatternsPage,
  parsePlaylistsPage,
  type PatternList,
} from "../status/parse";
import { useAppStore } from "./store";
import { patterns as _patternsCfg } from "../config";

// We deliberately reuse the `patterns` config for BOTH the library
// page fetch and the per-playlist patterns fetch. There's no separate
// `playlists` block in `.config.portwatch.yaml` because the original
// playlist-library fetch was inline in PlaylistSwitcher with the
// same numbers; centralising on `patterns.*` here keeps tuning to a
// single place ("how patient is the picker over LoRa").
const MAX_PAGES = _patternsCfg.max_pages;
const MAX_PAGE_RETRIES = _patternsCfg.max_page_retries;
const RETRY_BACKOFF_MS = _patternsCfg.retry_backoff_ms;
const PAGE_TIMEOUT_MS = _patternsCfg.page_timeout_ms;

export interface RebuildWorldResult {
  /** True when the action finished without aborting. */
  ok: boolean;
  /** Number of playlists for which we successfully refreshed patterns. */
  refreshedPlaylists: number;
  /** Names of playlists whose patterns we couldn't fetch. */
  failedPlaylists: string[];
  /** Human-readable summary suitable for the LIVE-reply ribbon. */
  summary: string;
}

/**
 * Run the operator-initiated REFRESH-WORLD action against the given
 * `link`. Returns a result struct rather than throwing — callers
 * (the REFRESH button onPress) typically don't have a useful place
 * to surface an exception, so we collapse all error paths into the
 * `ok` boolean + `summary` string.
 */
export async function rebuildWorld(
  link: TitanicLink,
): Promise<RebuildWorldResult> {
  const store = useAppStore.getState();
  // Single-flight guard: a second press while the first is still
  // running is a UX bug (operator double-tapped the button); we
  // silently no-op so the in-flight rebuild can finish.
  if (store.worldRebuildInProgress) {
    return {
      ok: false,
      refreshedPlaylists: 0,
      failedPlaylists: [],
      summary: "REFRESH already in progress",
    };
  }
  store.setWorldRebuildInProgress(true);

  try {
    // ── Phase 1: library ─────────────────────────────────────────
    const library = await _fetchPlaylistLibrary(link);
    if (library === null) {
      // Library fetch failed — surface a clear error and don't touch
      // any existing cached pattern lists. The operator can retry.
      return {
        ok: false,
        refreshedPlaylists: 0,
        failedPlaylists: [],
        summary: "REFRESH failed: couldn't fetch playlist library",
      };
    }
    // Persist library immediately via the store setter (which also
    // updates the persisted shape).
    useAppStore.getState().setPlaylistLibrary(library);

    // ── Phase 2: each playlist's patterns ────────────────────────
    let refreshed = 0;
    const failed: string[] = [];
    for (const name of library) {
      // The action is best-effort — a per-playlist failure shouldn't
      // abort the whole REFRESH; we record the name and continue so
      // the rest of the library still gets cached.
      const list = await _fetchPlaylistPatternsByName(link, name);
      if (list === null) {
        failed.push(name);
        continue;
      }
      // cachePatternsForPlaylist also writes to `patternList` when
      // the operator's deck is on this name; that's the desired
      // side-effect so the active picker updates inline with the
      // rebuild.
      useAppStore.getState().cachePatternsForPlaylist(name, list);
      refreshed++;
    }

    // ── Phase 3: stamp the snapshot ──────────────────────────────
    useAppStore.getState().setSnapshotBuiltAt(Date.now());

    const summary =
      failed.length === 0
        ? `REFRESH ok · ${refreshed}/${library.length} playlists cached`
        : `REFRESH partial · ${refreshed}/${library.length} cached, ${failed.length} failed (${failed.slice(0, 2).join(", ")}${failed.length > 2 ? ", …" : ""})`;
    return {
      ok: failed.length === 0,
      refreshedPlaylists: refreshed,
      failedPlaylists: failed,
      summary,
    };
  } finally {
    useAppStore.getState().setWorldRebuildInProgress(false);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

async function _fetchPlaylistLibrary(
  link: TitanicLink,
): Promise<string[] | null> {
  const collected: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let pageOk = false;
    for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
      const res = await link.sendOp(buildPlaylistsPageQuery(page), {
        timeoutMs: PAGE_TIMEOUT_MS,
      });
      if (res.timedOut || !res.reply || res.reply.typ === "nak") {
        if (attempt < MAX_PAGE_RETRIES) {
          await _delay(RETRY_BACKOFF_MS);
          continue;
        }
        return null;
      }
      const parsed = parsePlaylistsPage(res.reply.arg);
      if (!parsed) {
        if (attempt < MAX_PAGE_RETRIES) {
          await _delay(RETRY_BACKOFF_MS);
          continue;
        }
        return null;
      }
      for (const n of parsed.playlists) collected.push(n);
      pageOk = true;
      if (parsed.pageIndex >= parsed.totalPages - 1) {
        return collected;
      }
      break;
    }
    if (!pageOk) return null;
  }
  // Hit the safety cap without the bridge signaling done — treat as
  // partial library, abort to avoid persisting a clipped list as
  // authoritative.
  return null;
}

async function _fetchPlaylistPatternsByName(
  link: TitanicLink,
  name: string,
): Promise<PatternList | null> {
  const collected: string[] = [];
  let lastRawArg = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    let pageOk = false;
    for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
      const res = await link.sendOp(
        buildPlaylistPatternsByNameQuery(name, page),
        { timeoutMs: PAGE_TIMEOUT_MS },
      );
      if (res.timedOut || !res.reply || res.reply.typ === "nak") {
        if (attempt < MAX_PAGE_RETRIES) {
          await _delay(RETRY_BACKOFF_MS);
          continue;
        }
        return null;
      }
      const parsed = parsePlaylistPatternsPage(res.reply.arg);
      if (!parsed) {
        if (attempt < MAX_PAGE_RETRIES) {
          await _delay(RETRY_BACKOFF_MS);
          continue;
        }
        return null;
      }
      for (const n of parsed.patterns) collected.push(n);
      lastRawArg = res.reply.arg;
      pageOk = true;
      if (parsed.pageIndex >= parsed.totalPages - 1) {
        return {
          patterns: collected,
          truncatedExtra: 0,
          receivedAtMs: Date.now(),
          rawArg: lastRawArg,
        };
      }
      break;
    }
    if (!pageOk) return null;
  }
  return null;
}

function _delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

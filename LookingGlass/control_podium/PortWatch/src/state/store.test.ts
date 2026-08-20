import { describe, expect, it, beforeEach } from "vitest";
import { parseEngineStatus } from "../status/parse";
import { useAppStore } from "./store";

// Pure-function tests for store reducers. We exercise via the
// public Zustand API (`useAppStore.getState()` + actions) rather
// than mocking — that way the tests catch regressions in the
// reducer wiring too, not just the inner logic.

function reset() {
  const s = useAppStore.getState();
  s.resetIntent();
  s.setGlobalParams(null);
  s.setLocalExports(null);
  s.invalidatePatternsCache(null);
  // Wipe the world-model slices that resetIntent now intentionally
  // preserves. Tests need a deterministic empty starting state since
  // the store is a module-level singleton across test cases.
  useAppStore.setState({
    localExportsByPattern: {},
    snapshotBuiltAtMs: null,
    globalParams: null,
    playlistLibrary: null,
  });
}

describe("setGlobalParams intent reconciliation", () => {
  beforeEach(reset);

  it("drops a resolved intent when the engine reports a DIFFERENT value (CaptainPad change wins)", () => {
    // Operator changed speed to 0.5; cmd resolved, intent flipped to !pending.
    const store = useAppStore.getState();
    store.intendGlobalParam("speed", 0.5);
    store.markIntentResolved("globalParam:speed");

    // CaptainPad concurrently set speed to 0.9. Polling-driven setGlobalParams.
    store.setGlobalParams({
      speed: 0.9,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "sp/0.9",
    });

    const after = useAppStore.getState();
    expect(after.intent.globalParams.speed).toBeUndefined();
    expect(after.globalParams?.speed).toBe(0.9);
  });

  it("keeps a PENDING intent even when engine disagrees (optimistic UI)", () => {
    const store = useAppStore.getState();
    store.intendGlobalParam("speed", 0.5);
    // NOT resolved — still pending (the write is in flight).

    store.setGlobalParams({
      speed: 0.9,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "sp/0.9",
    });

    const after = useAppStore.getState();
    expect(after.intent.globalParams.speed?.value).toBe(0.5);
    expect(after.intent.globalParams.speed?.pending).toBe(true);
    expect(after.globalParams?.speed).toBe(0.9);
  });

  it("drops a pending intent when engine AGREES (write acked the loop closes)", () => {
    const store = useAppStore.getState();
    store.intendGlobalParam("speed", 0.5);
    store.setGlobalParams({
      speed: 0.5,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "sp/0.5",
    });
    const after = useAppStore.getState();
    expect(after.intent.globalParams.speed).toBeUndefined();
    expect(after.globalParams?.speed).toBe(0.5);
  });

  it("keeps intent when engine value is missing (no signal)", () => {
    const store = useAppStore.getState();
    store.intendGlobalParam("speed", 0.5);
    store.markIntentResolved("globalParam:speed");
    store.setGlobalParams({
      speed: null, // engine doesn't know this value yet
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "",
    });
    const after = useAppStore.getState();
    expect(after.intent.globalParams.speed?.value).toBe(0.5);
  });

  it("HSV palette: resolved-but-different is dropped (engine wins)", () => {
    const store = useAppStore.getState();
    store.intendGlobalParam("colorPalette1", { h: 0.1, s: 0.2, v: 0.3 });
    store.markIntentResolved("globalParam:colorPalette1");
    store.setGlobalParams({
      speed: null,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: { h: 0.9, s: 0.9, v: 0.9 },
      palette2: null,
      receivedAtMs: 1,
      rawArg: "p1/0.9-0.9-0.9",
    });
    const after = useAppStore.getState();
    expect(after.intent.globalParams.colorPalette1).toBeUndefined();
    expect(after.globalParams?.palette1).toEqual({ h: 0.9, s: 0.9, v: 0.9 });
  });

  it("HSV palette: pending-and-different keeps the optimistic value", () => {
    const store = useAppStore.getState();
    store.intendGlobalParam("colorPalette1", { h: 0.1, s: 0.2, v: 0.3 });
    // Pending — write still in flight.
    store.setGlobalParams({
      speed: null,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: { h: 0.9, s: 0.9, v: 0.9 },
      palette2: null,
      receivedAtMs: 1,
      rawArg: "p1/0.9-0.9-0.9",
    });
    const after = useAppStore.getState();
    expect(after.intent.globalParams.colorPalette1?.value).toEqual({
      h: 0.1,
      s: 0.2,
      v: 0.3,
    });
  });
});

describe("setGlobalParams partial-merge (PUB-driven path)", () => {
  beforeEach(reset);

  it("merges partial snapshots: null fields preserve previously-known values", () => {
    // First poll arrives carrying full snapshot.
    const store = useAppStore.getState();
    store.setGlobalParams({
      speed: 0.5,
      direction: 1,
      count: 8,
      size: 0.3,
      rotate: 0.7,
      palette1: { h: 0.1, s: 0.2, v: 0.3 },
      palette2: null,
      receivedAtMs: 1,
      rawArg: "full",
    });
    // Subsequent PUB-driven partial only carries `sp` (other keys
    // omitted because the engine only got a speed write recently).
    store.setGlobalParams({
      speed: 0.9,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 2,
      rawArg: "sp/0.9",
    });
    const after = useAppStore.getState();
    expect(after.globalParams?.speed).toBe(0.9);
    expect(after.globalParams?.direction).toBe(1);
    expect(after.globalParams?.count).toBe(8);
    expect(after.globalParams?.size).toBe(0.3);
    expect(after.globalParams?.rotate).toBe(0.7);
    expect(after.globalParams?.palette1).toEqual({ h: 0.1, s: 0.2, v: 0.3 });
  });

  it("partial snapshot doesn't drop an intent on a field that wasn't reported", () => {
    // Operator changed `count` to 9, write resolved. CaptainPad
    // doesn't touch `count` — only speed. A partial PUB with just
    // `sp/0.9` should NOT make the count intent disappear (the
    // count value was merged from prev, not freshly reported).
    const store = useAppStore.getState();
    store.setGlobalParams({
      speed: 0.5,
      direction: null,
      count: 8,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "init",
    });
    store.intendGlobalParam("count", 9);
    store.markIntentResolved("globalParam:count");
    // Partial PUB: only speed changed.
    store.setGlobalParams({
      speed: 0.9,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 2,
      rawArg: "sp/0.9",
    });
    const after = useAppStore.getState();
    // Count intent was on 9, but the engine never reported a
    // fresh count this tick — keep the intent so the operator's
    // optimistic value isn't silently wiped.
    expect(after.intent.globalParams.count?.value).toBe(9);
    // Speed reconciled and stored.
    expect(after.globalParams?.speed).toBe(0.9);
  });
});

describe("setLocalExports intent reconciliation", () => {
  beforeEach(reset);

  it("drops a resolved-but-different intent (CaptainPad slider change wins)", () => {
    const store = useAppStore.getState();
    store.intendLocalExport(123, 0.42);
    store.markIntentResolved("localExport:123");
    store.setLocalExports([
      { id: 123, kind: 1, v0: 0.99, name: "sliderFoo" },
    ]);
    const after = useAppStore.getState();
    expect(after.intent.localExports["123"]).toBeUndefined();
    expect(after.localExports?.[0]?.v0).toBe(0.99);
  });

  it("keeps a pending intent (write in flight)", () => {
    const store = useAppStore.getState();
    store.intendLocalExport(123, 0.42);
    store.setLocalExports([
      { id: 123, kind: 1, v0: 0.99, name: "sliderFoo" },
    ]);
    const after = useAppStore.getState();
    expect(after.intent.localExports["123"]?.value).toBe(0.42);
    expect(after.intent.localExports["123"]?.pending).toBe(true);
  });
});

describe("patternsByPlaylist cache (persistent, name-keyed)", () => {
  beforeEach(reset);

  it("cachePatternsForPlaylist writes both live AND cache when name matches the active deck playlist", () => {
    // Updated semantics (May 2026): cachePatternsForPlaylist only flips
    // the live `patternList` when the playlistName matches the engine's
    // currently-loaded deck playlist. The previous behavior — always
    // write — caused the picker to flash through every playlist's
    // contents during a REFRESH-WORLD action because the rebuild
    // iterates the full library and cached each one in turn.
    const store = useAppStore.getState();
    // Establish the active deck playlist via engine status.
    store.setEngineStatus(
      parseEngineStatus("pat/-,pl/warmup", Date.now()),
    );
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b", "c"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    const after = useAppStore.getState();
    expect(after.patternList?.patterns).toEqual(["a", "b", "c"]);
    expect(after.patternsByPlaylist["warmup"]?.patterns).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("cachePatternsForPlaylist does NOT touch live `patternList` when caching a NON-active playlist", () => {
    // The REFRESH-WORLD action calls cachePatternsForPlaylist once per
    // name in the library; the picker must stay on the active
    // playlist's patterns throughout, not flicker through every
    // playlist as their fetches land.
    const store = useAppStore.getState();
    store.setEngineStatus(
      parseEngineStatus("pat/-,pl/warmup", Date.now()),
    );
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "warmup-list",
    });
    // Now cache `encore` (NOT the active deck). The live list must
    // stay pointing at warmup; only the encore entry in the map
    // changes.
    store.cachePatternsForPlaylist("encore", {
      patterns: ["x", "y", "z"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "encore-list",
    });
    const after = useAppStore.getState();
    expect(after.patternList?.patterns).toEqual(["a", "b"]);
    expect(after.patternsByPlaylist["encore"]?.patterns).toEqual(["x", "y", "z"]);
  });

  it("cachePatternsForPlaylist writes ONLY live when name is null (no playlist loaded)", () => {
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist(null, {
      patterns: [],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "empty",
    });
    const after = useAppStore.getState();
    expect(after.patternList?.patterns).toEqual([]);
    expect(after.patternsByPlaylist).toEqual({});
  });

  it("invalidatePatternsCache(name) drops just that entry", () => {
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.cachePatternsForPlaylist("encore", {
      patterns: ["b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.invalidatePatternsCache("warmup");
    const after = useAppStore.getState();
    expect(after.patternsByPlaylist["warmup"]).toBeUndefined();
    expect(after.patternsByPlaylist["encore"]?.patterns).toEqual(["b"]);
  });

  it("invalidatePatternsCache(null) clears EVERYTHING", () => {
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.cachePatternsForPlaylist("encore", {
      patterns: ["b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.invalidatePatternsCache(null);
    const after = useAppStore.getState();
    expect(after.patternsByPlaylist).toEqual({});
  });

  it("hydratePatternsByPlaylist replaces the whole map (used at app start)", () => {
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.hydratePatternsByPlaylist({
      "show-A": {
        patterns: ["x", "y"],
        truncatedExtra: 0,
        receivedAtMs: 2,
        rawArg: "y",
      },
    });
    const after = useAppStore.getState();
    expect(after.patternsByPlaylist["warmup"]).toBeUndefined();
    expect(after.patternsByPlaylist["show-A"]?.patterns).toEqual(["x", "y"]);
  });

  it("cache survives resetIntent (disconnect doesn't lose the cache)", () => {
    // Reproduces the slow-reload bug: previously resetIntent
    // wiped patternsByPlaylist + playlistLibrary, so every
    // reconnect was a guaranteed cache miss. We extended the
    // preservation list to cover localExportsByPattern,
    // snapshotBuiltAtMs, AND globalParams — anything that drove a
    // "blank ParamsCard for 1-3 s after every BLE blip" complaint.
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "x",
    });
    store.setPlaylistLibrary(["warmup", "encore"]);
    store.setGlobalParams({
      speed: 0.7,
      direction: null,
      count: null,
      size: null,
      rotate: null,
      palette1: null,
      palette2: null,
      receivedAtMs: 1,
      rawArg: "sp/0.7",
    });
    store.resetIntent();
    const after = useAppStore.getState();
    expect(after.patternsByPlaylist["warmup"]?.patterns).toEqual(["a", "b"]);
    expect(after.playlistLibrary).toEqual(["warmup", "encore"]);
    // Per-session state IS cleared.
    expect(after.engineStatus).toBeNull();
    expect(after.deckPlaylist).toBeNull();
    // ... but the last-known global params survive (so the
    // ParamsCard re-renders with values immediately on reconnect
    // rather than blank for the next 5 s polling cycle).
    expect(after.globalParams?.speed).toBe(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// World-model integration: the headline fixes for "CaptainPad switches
// playlist but PortWatch shows the old one" and "pattern change shows
// old sliders briefly". These cover the auto-swap branches inside
// `setEngineStatus` plus the per-pattern local-export caching path in
// `setLocalExports`.
// ─────────────────────────────────────────────────────────────────────────

function emptyEngineStatus(overrides: Partial<{
  activePattern: string | null;
  deckPlaylistName: string | null;
}> = {}) {
  // Build a synthetic compact PUB arg with just the two fields we
  // care about. parseEngineStatus tolerates missing keys (they map to
  // dashOrNull → null) so this gives us a realistic EngineStatus
  // shape rather than a hand-rolled mock with potentially-stale
  // fields.
  const parts: string[] = [];
  if (overrides.activePattern !== undefined) {
    parts.push(`pat/${overrides.activePattern ?? "-"}`);
  } else {
    parts.push("pat/-");
  }
  if (overrides.deckPlaylistName !== undefined) {
    parts.push(`pl/${overrides.deckPlaylistName ?? "-"}`);
  } else {
    parts.push("pl/-");
  }
  return parseEngineStatus(parts.join(","), Date.now());
}

describe("setEngineStatus auto-swap on playlist change", () => {
  beforeEach(reset);

  it("swaps patternList to cache when deckPlaylistName changes to a CACHED name", () => {
    // This is the headline fix for the CaptainPad-playlist-switch bug:
    // operator switches playlist on CaptainPad, the next compact PUB
    // carries `pl/<new-name>`, and PortWatch's deck card must show
    // the cached patterns INSTANTLY without an explicit refresh.
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "warmup-list",
    });
    store.cachePatternsForPlaylist("encore", {
      patterns: ["x", "y", "z"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "encore-list",
    });

    // Engine reports we're on warmup.
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "warmup" }));
    expect(useAppStore.getState().patternList?.patterns).toEqual(["a", "b"]);

    // CaptainPad swaps to encore — next PUB delivers pl/encore.
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "encore" }));
    expect(useAppStore.getState().patternList?.patterns).toEqual(["x", "y", "z"]);
  });

  it("clears patternList when deckPlaylistName changes to an UNCACHED name", () => {
    // First-time switch to a playlist we haven't fetched yet: the
    // displayed list must NOT keep showing the previous playlist's
    // patterns (operator could tap a name not in the new playlist
    // and silently send a pattern the engine isn't currently
    // sequenced for). Auto-hydrate then refills via paginated fetch.
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "warmup-list",
    });
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "warmup" }));
    expect(useAppStore.getState().patternList?.patterns).toEqual(["a", "b"]);

    // Engine switches to a brand-new playlist.
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "after-hours" }));
    expect(useAppStore.getState().patternList).toBeNull();
  });

  it("does NOT touch patternList when deckPlaylistName is unchanged across PUBs", () => {
    // A no-op PUB (same playlist) must not flicker the list. The
    // setter compares prev vs new name and only writes when they
    // differ, so the same `PatternList` reference is preserved.
    const store = useAppStore.getState();
    store.cachePatternsForPlaylist("warmup", {
      patterns: ["a", "b"],
      truncatedExtra: 0,
      receivedAtMs: 1,
      rawArg: "warmup-list",
    });
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "warmup" }));
    const firstRef = useAppStore.getState().patternList;
    store.setEngineStatus(emptyEngineStatus({ deckPlaylistName: "warmup" }));
    expect(useAppStore.getState().patternList).toBe(firstRef);
  });
});

describe("setEngineStatus auto-swap on pattern change", () => {
  beforeEach(reset);

  it("swaps localExports to cache when activePattern changes to a CACHED pattern", () => {
    // The headline fix for "pattern change is slow to refresh params":
    // when the active pattern flips, we surface the last-known slider
    // list for the new pattern instantly. The ParamsCard's
    // own activePattern effect kicks off a fresh poll to overwrite
    // shortly after, but the operator sees something meaningful on
    // the very first frame.
    const store = useAppStore.getState();
    // Seed last-known exports for two patterns by feeding setLocalExports
    // with each pattern as "active" in turn.
    store.setEngineStatus(emptyEngineStatus({ activePattern: "dragon" }));
    store.setLocalExports([
      { id: 1, kind: 1, v0: 0.3, name: "fade" },
      { id: 2, kind: 1, v0: 0.7, name: "warp" },
    ]);
    store.setEngineStatus(emptyEngineStatus({ activePattern: "sunset" }));
    store.setLocalExports([
      { id: 9, kind: 1, v0: 0.1, name: "tint" },
    ]);

    // Now the engine flips back to "dragon" — we expect the dragon
    // exports to surface IMMEDIATELY from cache.
    store.setEngineStatus(emptyEngineStatus({ activePattern: "dragon" }));
    const after = useAppStore.getState();
    expect(after.localExports?.map((e) => e.name)).toEqual(["fade", "warp"]);
  });

  it("clears localExports when activePattern changes to an UNCACHED pattern", () => {
    // Pattern switch where we have NEVER seen the new pattern before:
    // the previous pattern's sliders must vanish immediately so the
    // operator never sees "controls labelled for the old pattern" on
    // the new pattern's row.
    const store = useAppStore.getState();
    store.setEngineStatus(emptyEngineStatus({ activePattern: "dragon" }));
    store.setLocalExports([
      { id: 1, kind: 1, v0: 0.3, name: "fade" },
    ]);

    store.setEngineStatus(emptyEngineStatus({ activePattern: "fresh-cue" }));
    expect(useAppStore.getState().localExports).toBeNull();
  });
});

describe("setLocalExports per-pattern cache", () => {
  beforeEach(reset);

  it("bins setLocalExports under the active pattern name when one is set", () => {
    const store = useAppStore.getState();
    store.setEngineStatus(emptyEngineStatus({ activePattern: "sunset" }));
    store.setLocalExports([
      { id: 1, kind: 1, v0: 0.5, name: "tint" },
    ]);
    const after = useAppStore.getState();
    expect(after.localExportsByPattern["sunset"]?.[0]?.v0).toBe(0.5);
  });

  it("does NOT bin setLocalExports when no active pattern is known", () => {
    const store = useAppStore.getState();
    // No engineStatus set → no activePattern → nowhere to bin.
    store.setLocalExports([
      { id: 1, kind: 1, v0: 0.5, name: "tint" },
    ]);
    const after = useAppStore.getState();
    expect(after.localExportsByPattern).toEqual({});
    // The live `localExports` is still set, so the ParamsCard
    // renders something — but it won't survive a pattern switch
    // (correct behavior: we don't know what pattern these values
    // belong to).
    expect(after.localExports?.length).toBe(1);
  });
});

describe("hydrateWorldSnapshot", () => {
  beforeEach(reset);

  it("bulk-replaces all four persisted slices in one set call", () => {
    const store = useAppStore.getState();
    store.hydrateWorldSnapshot({
      playlistLibrary: ["warmup", "encore"],
      patternsByPlaylist: {
        warmup: {
          patterns: ["a", "b"],
          truncatedExtra: 0,
          receivedAtMs: 1,
          rawArg: "x",
        },
      },
      localExportsByPattern: {
        sunset: [{ id: 1, kind: 1, v0: 0.5, name: "tint" }],
      },
      snapshotBuiltAtMs: 42,
    });
    const after = useAppStore.getState();
    expect(after.playlistLibrary).toEqual(["warmup", "encore"]);
    expect(after.patternsByPlaylist["warmup"]?.patterns).toEqual(["a", "b"]);
    expect(after.localExportsByPattern["sunset"]?.[0]?.v0).toBe(0.5);
    expect(after.snapshotBuiltAtMs).toBe(42);
  });
});

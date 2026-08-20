import { beforeEach, describe, expect, it } from "vitest";
import type { OpDescriptor } from "../frame/ops";
import type { SendResult } from "../link/titanicLink";
import type { TitanicLink } from "../link/titanicLink";
import { rebuildWorld } from "./rebuildWorld";
import { useAppStore } from "./store";

// Mock TitanicLink stub.
//
// Instead of building a fake transport stack (codec + BLE + awaiter
// table), we just intercept `sendOp` and return canned replies based
// on the arg string. The shape matches what the real bridge emits so
// `parsePlaylistsPage` / `parsePlaylistPatternsPage` can chew through
// the responses unchanged.
type ReplyHandler = (arg: string) =>
  | { typ: "rep"; arg: string }
  | { typ: "nak"; arg: string }
  | "timeout";

function makeFakeLink(handler: ReplyHandler): TitanicLink {
  const sendOp = async (op: OpDescriptor): Promise<SendResult> => {
    const r = handler(op.arg);
    const baseRequest = {
      typ: "qry",
      arg: op.arg,
      src: 1,
      dst: 0,
      seq: 0,
      ttl: 0,
    } as unknown as SendResult["request"];
    if (r === "timeout") {
      return {
        request: baseRequest,
        reply: null,
        rttMs: 0,
        timedOut: true,
        requestLine: "",
        replyLine: null,
      };
    }
    return {
      request: baseRequest,
      reply: {
        typ: r.typ,
        arg: r.arg,
        src: 0,
        dst: 1,
        seq: 0,
        ttl: 0,
      } as unknown as SendResult["reply"],
      rttMs: 1,
      timedOut: false,
      requestLine: "",
      replyLine: "",
    };
  };
  // Cast through unknown — the production TitanicLink has many fields,
  // but rebuildWorld only uses sendOp.
  return { sendOp } as unknown as TitanicLink;
}

function reset() {
  const s = useAppStore.getState();
  s.resetIntent();
  s.invalidatePatternsCache(null);
  useAppStore.setState({
    playlistLibrary: null,
    patternsByPlaylist: {},
    localExportsByPattern: {},
    snapshotBuiltAtMs: null,
    worldRebuildInProgress: false,
  });
}

describe("rebuildWorld — operator-driven full snapshot rebuild", () => {
  beforeEach(reset);

  it("fetches library + per-playlist patterns and persists them under the right keys", async () => {
    // Wire transcript the fake engine should serve:
    //
    //   qry playlists/p/0                                     → "warmup,encore"
    //   qry engine/get-playlist-patterns/warmup/p/0           → "a,b"
    //   qry engine/get-playlist-patterns/encore/p/0           → "x,y,z"
    //
    // Single-page replies — totalPages=1 so the rebuilder stops after
    // the first page on each fetch. The reply shape mirrors the
    // bridge's `parsePlaylistsPage` / `parsePlaylistPatternsPage`
    // expectations so the same parsers used in production drive the
    // mock through.
    const link = makeFakeLink((arg) => {
      if (arg === "playlists/p/0") {
        return { typ: "rep", arg: "p/0,t/1,n/2,c/warmup,encore" };
      }
      if (arg === "engine/get-playlist-patterns/warmup/p/0") {
        return {
          typ: "rep",
          arg: "p/0,t/1,n/2,pl/warmup,c/a,b",
        };
      }
      if (arg === "engine/get-playlist-patterns/encore/p/0") {
        return {
          typ: "rep",
          arg: "p/0,t/1,n/3,pl/encore,c/x,y,z",
        };
      }
      return { typ: "nak", arg: "unknown_qry" };
    });

    const result = await rebuildWorld(link);
    expect(result.ok).toBe(true);
    expect(result.refreshedPlaylists).toBe(2);
    expect(result.failedPlaylists).toEqual([]);

    const after = useAppStore.getState();
    expect(after.playlistLibrary).toEqual(["warmup", "encore"]);
    expect(after.patternsByPlaylist["warmup"]?.patterns).toEqual(["a", "b"]);
    expect(after.patternsByPlaylist["encore"]?.patterns).toEqual(["x", "y", "z"]);
    expect(after.snapshotBuiltAtMs).not.toBeNull();
    expect(after.worldRebuildInProgress).toBe(false);
  });

  it("returns partial-failure summary when ONE playlist's pattern fetch fails", async () => {
    // Library OK, warmup OK, encore times out: rebuilder must persist
    // the warmup patterns + the library, leave encore's prior cache
    // unchanged, and surface a "partial" summary so the operator can
    // see what wasn't refreshed.
    const link = makeFakeLink((arg) => {
      if (arg === "playlists/p/0") {
        return { typ: "rep", arg: "p/0,t/1,n/2,c/warmup,encore" };
      }
      if (arg === "engine/get-playlist-patterns/warmup/p/0") {
        return {
          typ: "rep",
          arg: "p/0,t/1,n/2,pl/warmup,c/a,b",
        };
      }
      if (arg === "engine/get-playlist-patterns/encore/p/0") {
        return "timeout";
      }
      return { typ: "nak", arg: "unknown_qry" };
    });

    const result = await rebuildWorld(link);
    expect(result.ok).toBe(false);
    expect(result.refreshedPlaylists).toBe(1);
    expect(result.failedPlaylists).toEqual(["encore"]);

    const after = useAppStore.getState();
    expect(after.patternsByPlaylist["warmup"]?.patterns).toEqual(["a", "b"]);
    expect(after.patternsByPlaylist["encore"]).toBeUndefined();
  });

  it("aborts cleanly when the library fetch itself fails (existing cache untouched)", async () => {
    // Seed an existing cache. After the library fails, both the
    // library and the cached patterns must remain — partial fetches
    // never destroy the operator's last-good snapshot.
    useAppStore.getState().setPlaylistLibrary(["legacy"]);
    useAppStore.getState().cachePatternsForPlaylist("legacy", {
      patterns: ["old"],
      truncatedExtra: 0,
      receivedAtMs: 0,
      rawArg: "legacy-list",
    });

    const link = makeFakeLink(() => "timeout");

    const result = await rebuildWorld(link);
    expect(result.ok).toBe(false);
    expect(result.refreshedPlaylists).toBe(0);
    expect(result.summary).toMatch(/library/);
    const after = useAppStore.getState();
    expect(after.playlistLibrary).toEqual(["legacy"]);
    expect(after.patternsByPlaylist["legacy"]?.patterns).toEqual(["old"]);
  });

  it("is single-flight (a second press while the first is in flight no-ops)", async () => {
    // Build a link that defers replies behind a single Promise we
    // resolve manually so the test can observe an in-flight rebuild.
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    const link: TitanicLink = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendOp: (async (op: OpDescriptor): Promise<SendResult> => {
        calls++;
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return {
          request: { typ: "qry", arg: op.arg } as unknown as SendResult["request"],
          reply: {
            typ: "rep",
            arg: "p/0,t/1,n/0,c/",
          } as unknown as SendResult["reply"],
          rttMs: 1,
          timedOut: false,
          requestLine: "",
          replyLine: "",
        };
      }) as unknown as TitanicLink["sendOp"],
    } as unknown as TitanicLink;

    const first = rebuildWorld(link);
    // The first call has set worldRebuildInProgress=true synchronously
    // before awaiting the first sendOp. The next call should bail out.
    const second = await rebuildWorld(link);
    expect(second.ok).toBe(false);
    expect(second.summary).toMatch(/already in progress/);

    // Let the first call finish.
    // TS narrows `releaseFirst` to `never` after the let-declaration
    // because the assignment happens inside a Promise callback the
    // checker can't reason through; the runtime value is the resolve
    // function from the in-flight Promise.
    (releaseFirst as unknown as (() => void) | null)?.();
    await first;
    expect(calls).toBe(1);
  });
});

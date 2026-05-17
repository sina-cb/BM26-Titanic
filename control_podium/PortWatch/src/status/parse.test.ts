import { describe, expect, it } from "vitest";
import {
  isCompactStatusArg,
  liftGlobalParamsFromCompactStatus,
  parseEngineStatus,
} from "./parse";

// Pure-function tests for the bridge → PortWatch wire-format parsers.
// Catches regressions in the field shape (a missed `kv[…]` rename,
// a default-value swap) that would otherwise only show up at runtime
// on an iPad in the field.

describe("parseEngineStatus", () => {
  it("extracts the deck playlist name from `pl/<name>`", () => {
    const arg = "pat/sunset,br/80,blk/0,ap/0,sp/0.5,pl/warmup";
    const s = parseEngineStatus(arg, 1234);
    expect(s.activePattern).toBe("sunset");
    expect(s.deckPlaylistName).toBe("warmup");
  });

  it("treats `pl/-` (engine sentinel for 'no active playlist') as null", () => {
    const arg = "pat/sunset,pl/-";
    const s = parseEngineStatus(arg, 1);
    expect(s.deckPlaylistName).toBeNull();
  });

  it("does NOT expose legacy hash fields on EngineStatus", () => {
    // Regression guard: when the compact_status payload was slimmed
    // (no more `plh` / `pph` over the wire), the EngineStatus
    // interface lost these fields too. A future change that re-
    // introduces them needs to revisit the persistent name-keyed
    // cache that replaced the hash-validated one.
    const arg = "pat/sunset,pl/warmup,plh/aaaa1111,pph/bbbb2222";
    const s = parseEngineStatus(arg, 1);
    expect("playlistLibraryHash" in s).toBe(false);
    expect("playlistPatternsHash" in s).toBe(false);
  });

  // ── Sentinel mapping for the active-pattern field ────────────
  // The bridge emits `pat/<value>` on every compact_status, with two
  // sentinel strings when no pattern is loaded:
  //
  //   * `pat/-`  — base channel exists on /mixer, but its `pattern`
  //                field is empty/null (engine cold-boot, "unload
  //                all" right before the poll).
  //   * `pat/?`  — no base channel at all (the engine's /mixer
  //                response is malformed or pre-bootstrap).
  //
  // Both MUST collapse to activePattern=null on PortWatch so the
  // DeckScreen renders its existing em-dash placeholder. The May
  // 2026 regression (#stuck-on-waiting) hit because the bridge
  // SOMETIMES omitted `pat/` entirely — which broke a different
  // invariant (the REP gate); this test covers the once-`pat/` is
  // emitted, the value is interpreted correctly.
  it("treats `pat/-` (engine sentinel for 'base channel exists, no pattern') as null", () => {
    const arg = "pat/-,pl/warmup,blk/0";
    const s = parseEngineStatus(arg, 1);
    expect(s.activePattern).toBeNull();
  });

  it("treats `pat/?` (engine sentinel for 'no base channel') as null", () => {
    const arg = "pat/?,pl/-,blk/0";
    const s = parseEngineStatus(arg, 1);
    expect(s.activePattern).toBeNull();
  });

  it("returns the real pattern name when present (sentinel mapping is sentinel-only)", () => {
    // Sanity guard: a pattern actually named `pat_` something must
    // NOT collide with the sentinel mapping. parseKv splits on
    // `,`+`/`, so the whole value after `pat/` is the name.
    const s = parseEngineStatus("pat/rainbow,pl/warmup", 1);
    expect(s.activePattern).toBe("rainbow");
  });

  // ── Lock-owner wire-code mapping ──────────────────────────────
  // The bridge shortens well-known owner names to wire codes so a
  // locked-state compact_status REP fits inside the 250-char Heltec
  // firmware buffer (the May 2026 "Waiting for engine state…" bug
  // was caused by the unencoded `lk/portwatch,lku/30,vov/1` blob
  // pushing the encoded frame to 254 chars and being silently
  // dropped on BLE). Existing UI code compares against the
  // canonical long names (e.g. `controlLockOwner === "portwatch"`),
  // so the parser expands the wire code back here.

  it("expands the wire owner code `pw` back to `portwatch` (UI compat)", () => {
    const s = parseEngineStatus(
      "pat/sunset,pl/warmup,vw/deck,vov/1,lk/pw,lku/30", 1,
    );
    expect(s.controlLockOwner).toBe("portwatch");
    expect(s.controlLockLeaseRemainSec).toBe(30);
    expect(s.viewOverrideActive).toBe(true);
  });

  it("passes through legacy long-form `lk/portwatch` unchanged (backwards compat)", () => {
    // A bridge running pre-fix code (or a future change) might still
    // emit the long owner name. PortWatch must accept either.
    const s = parseEngineStatus(
      "pat/sunset,vw/deck,vov/1,lk/portwatch,lku/30", 1,
    );
    expect(s.controlLockOwner).toBe("portwatch");
  });

  it("treats missing `lk`/`lku`/`vov` keys as `unlocked / no override`", () => {
    // The bridge now omits these defaults from the wire when nothing
    // is locked — saves 16 chars and gets the encoded REP back under
    // the firmware buffer. The parser must render that as the same
    // "free" state the explicit `lk/-,lku/0,vov/0` payload used to.
    const s = parseEngineStatus("pat/sunset,pl/warmup,vw/deck", 1);
    expect(s.controlLockOwner).toBeNull();
    expect(s.controlLockLeaseRemainSec).toBe(0);
    expect(s.viewOverrideActive).toBeNull();
  });
});

describe("isCompactStatusArg (REP routing gate)", () => {
  // Direct unit-test of the predicate that App.tsx::onWireEvent uses
  // to decide whether a REP frame is a compact-status reply that
  // should be routed into setEngineStatus.
  //
  // Two regressions inform these cases:
  //
  //   1. May 2026 — "Waiting for engine state…" — the predicate
  //      required `pat/` or `dn/` (substring) and the bridge had a
  //      code path that emitted neither. The bridge invariant now
  //      guarantees `pat/` on every successful compact_status, AND
  //      this predicate has additional markers (`vov`/`lk`/`lku`)
  //      as defense-in-depth.
  //   2. May 2026 — "UNKNOWN ENGINE VIEW" — when we widened the
  //      predicate to also accept the substring `pl/`, it false-
  //      matched the `engine/deck/playlist` REP body
  //      (`pl/<name>,en/<id>`). The parser then returned a status
  //      with `engineView=null` (no `vw/`), clobbering the good
  //      snapshot. Fixed by parsing the body as KV and checking key
  //      membership against compact-status-only keys — so `pl/...`
  //      values inside a deck-playlist REP no longer trip the gate.

  it("accepts a typical compact_status body (`pat/` present)", () => {
    expect(
      isCompactStatusArg("pat/sunset,pl/warmup,blk/0,sp/0.5"),
    ).toBe(true);
  });

  it("accepts the engine-down short-circuit (`dn/1` only)", () => {
    expect(isCompactStatusArg("dn/1")).toBe(true);
  });

  it("accepts a body with `vov`/`lk`/`lku` but no `pat`/`dn` (belt-and-braces)", () => {
    // Defense-in-depth: if a future bridge change drops `pat/`
    // again, the REP still routes via `vov`/`lk`/`lku`. The bridge
    // emits all three unconditionally whenever the view-override
    // call returned a dict (even an empty one — the inner `if`
    // branches always assign defaults), so a compact_status REP
    // basically can't avoid carrying them in the engine-up case.
    expect(
      isCompactStatusArg("vw/deck,vov/0,lk/-,lku/0,br/100,blk/0"),
    ).toBe(true);
  });

  it("REJECTS engine/deck/playlist REP body (`pl/<name>,en/<id>`)", () => {
    // The regression case: the bridge's `qry engine/deck/playlist`
    // handler returns this exact shape. The previous wider
    // predicate (substring `pl/`) routed this into setEngineStatus,
    // clobbering the good engine snapshot with a near-null one and
    // surfacing as "UNKNOWN ENGINE VIEW" even when the engine was
    // actually on deck. The current predicate keys on `pat`/`dn`/
    // `vov`/`lk`/`lku` (none of which appear in deck/playlist REP
    // bodies), so this body is correctly rejected.
    expect(isCompactStatusArg("pl/default,en/e_default_0_rainbow")).toBe(false);
    expect(isCompactStatusArg("pl/-")).toBe(false);
    expect(isCompactStatusArg("pl/warmup")).toBe(false);
  });

  it("rejects paged-list REP bodies", () => {
    // The patterns / playlists / get-playlist-patterns ops all use
    // `p/<n>,t/<n>,n/<n>,c/<csv>` for their paged shape. They must
    // NOT trip the gate — otherwise PortWatch would mistake a
    // patterns-list REP for a status REP and crash setEngineStatus
    // with garbage. Pattern names containing the substring `pat_`
    // (e.g. `01_pat_b`) are also safe because parseKv only matches
    // the literal key, not arbitrary substrings.
    expect(
      isCompactStatusArg("p/0,t/24,n/12,c/00_pat_a,01_pat_b,02_pat_c"),
    ).toBe(false);
  });

  it("rejects a params snapshot REP (`sp/X,dr/Y,...`)", () => {
    // `qry params/snapshot` REPs share `sp`/`dr`/`ct`/`sz`/`rt`/`p1`
    // /`p2` with compact_status, but compact_status ALSO carries
    // `pat`/`dn`/`vov`/etc. The bare params-snapshot body has none
    // of those, so the gate correctly rejects it.
    expect(
      isCompactStatusArg("sp/0.5,dr/1,ct/8,sz/0.5,rt/0,p1/0.5-0.5-1,p2/0-0.5-1"),
    ).toBe(false);
  });

  it("rejects an unrelated short REP body", () => {
    expect(isCompactStatusArg("ok")).toBe(false);
    expect(isCompactStatusArg("")).toBe(false);
    expect(isCompactStatusArg("err/timeout")).toBe(false);
  });

  it("rejects a legacy single-frame patterns list", () => {
    // Legacy shape from `qry engine/patterns` (now superseded by
    // the paged variant but still possible from older bridges).
    expect(
      isCompactStatusArg("00_pat_a,01_pat_b,02_pat_c,+12"),
    ).toBe(false);
  });

  it("rejects a paged-list REP whose CSV happens to contain a pattern literally named `pat`", () => {
    // Belt-and-braces edge case: parseKv splits the body on `,` and
    // then `/`, so a CSV pattern name with no slash lands as a bare
    // key with an empty value: e.g. body `c/foo,pat,bar` parses to
    // `{ c: "foo", pat: "", bar: "" }`. The predicate requires the
    // marker key to have a NON-EMPTY value, so the bare `pat` (value
    // = "") is correctly rejected. compact_status by contrast
    // always emits `pat/<name|-|?>` with a real value.
    expect(isCompactStatusArg("p/0,t/3,n/3,c/foo,pat,bar")).toBe(false);
    expect(isCompactStatusArg("p/0,t/3,n/3,c/foo,lku,bar")).toBe(false);
    expect(isCompactStatusArg("p/0,t/3,n/3,c/foo,vov,bar")).toBe(false);
  });

  it("accepts a paged-playlist-patterns REP only when the wider gate keys are present (regression guard)", () => {
    // The bridge's `engine/playlist-patterns/p/<n>` REP body is
    // `p/<idx>,t/<total>,n/<count>,pl/<safe_pl>,c/<csv>`. None of
    // the predicate marker keys are present, so it's correctly
    // rejected — even though `pl/` IS present (substring), which
    // would have tripped the previous wider predicate.
    expect(
      isCompactStatusArg("p/0,t/1,n/3,pl/warmup,c/00_a,01_b,02_c"),
    ).toBe(false);
  });
});

describe("liftGlobalParamsFromCompactStatus", () => {
  it("returns null when no global-params keys are present", () => {
    expect(
      liftGlobalParamsFromCompactStatus("pat/sunset,br/80", 1),
    ).toBeNull();
  });

  it("extracts the full CPC global-params set from a compact PUB", () => {
    const arg =
      "pat/sunset,sp/0.5,dr/1,ct/8,sz/0.3,rt/0.7,p1/0.1-0.2-0.3,p2/0.4-0.5-0.6";
    const got = liftGlobalParamsFromCompactStatus(arg, 99);
    expect(got).not.toBeNull();
    expect(got!.speed).toBe(0.5);
    expect(got!.direction).toBe(1);
    expect(got!.count).toBe(8);
    expect(got!.size).toBe(0.3);
    expect(got!.rotate).toBe(0.7);
    expect(got!.palette1).toEqual({ h: 0.1, s: 0.2, v: 0.3 });
    expect(got!.palette2).toEqual({ h: 0.4, s: 0.5, v: 0.6 });
    expect(got!.receivedAtMs).toBe(99);
  });

  it("returns a partial when only some global-params keys are present", () => {
    // CaptainPad-side speed nudge — bridge's PUB only carries `sp`.
    const got = liftGlobalParamsFromCompactStatus(
      "pat/sunset,sp/0.42",
      1,
    );
    expect(got).not.toBeNull();
    expect(got!.speed).toBe(0.42);
    expect(got!.direction).toBeNull();
    expect(got!.count).toBeNull();
    expect(got!.size).toBeNull();
    expect(got!.rotate).toBeNull();
    expect(got!.palette1).toBeNull();
    expect(got!.palette2).toBeNull();
  });

  it("doesn't false-trigger on patterns that contain `sp` or `dr` substrings", () => {
    // PUB carries `pat/dragon` but no `dr/` key. The lift must
    // distinguish key from substring (parseKv splits on `,`+`/`).
    expect(
      liftGlobalParamsFromCompactStatus("pat/dragon,br/80", 1),
    ).toBeNull();
  });
});

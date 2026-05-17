// Command builders for the new card-based UI.
//
// Each helper returns an `OpDescriptor` that the link layer turns
// into a Titanic Frame v2 line (`cmd`, `qry`, `pin`, or `hlo`).
//
// To add a new capability:
//   1. Add a builder below.
//   2. Make sure the corresponding entry exists in
//      `control_podium/.config.commands.yaml` so the bridge accepts
//      it. Otherwise the bridge replies `nak unknown_cmd`.
//   3. Wire the builder into the relevant screen (DeckScreen for ops,
//      TestsScreen for queries/pings, etc.).
//
// `fire*` names are deliberately absent — the bridge HARD-rejects them
// regardless of role. Pyro lives on a separate transport.

import {
  Frame,
  FLAG_ACK_REQUESTED,
  FLAG_PRIVILEGED,
  SERVER_ID,
  TYPE_CMD,
  TYPE_PIN,
  TYPE_QRY,
  TYPE_HLO,
} from "./types";

export type OpKind = "cmd" | "qry" | "pin" | "hlo";

export interface OpDescriptor {
  /** Stable id for the UI (also used as the React key). */
  id: string;
  /** Short human label for logs / toasts. */
  label: string;
  /** Frame type. */
  kind: OpKind;
  /**
   * Plaintext arg for `cmd` / `qry`. Empty for `pin` / `hlo`.
   * Examples: "pattern/sunset", "brightness/42", "engine/status".
   */
  arg: string;
}

// ── Stateful command builders ───────────────────────────────────────

export const buildBlackoutOp = (on: boolean): OpDescriptor => ({
  id: `blackout/${on ? 1 : 0}`,
  label: `BLACKOUT ${on ? "ON" : "OFF"}`,
  kind: "cmd",
  arg: `blackout/${on ? 1 : 0}`,
});

export const buildAutopilotOp = (on: boolean): OpDescriptor => ({
  id: `autopilot/${on ? 1 : 0}`,
  label: `AUTOPILOT ${on ? "ON" : "OFF"}`,
  kind: "cmd",
  arg: `autopilot/${on ? 1 : 0}`,
});

/**
 * Set the autopilot transition interval in seconds. The bridge maps
 * this to the engine's `POST /autopilot {delay_s: <sec>}`, which is
 * the SAME endpoint that backs the on/off toggle — they're just two
 * fields on the same JSON body. We deliberately use a dedicated
 * `autopilot/interval/<sec>` wire path (rather than e.g.
 * `param/autopilotInterval/<sec>`) because the latter goes to
 * `/param-center` on the engine, which silently no-ops for unknown
 * keys — which is exactly what was happening before this change and
 * was the cause of "PortWatch sends a new interval, CaptainPad never
 * updates" reports.
 */
export const buildAutopilotIntervalOp = (sec: number): OpDescriptor => {
  const v = Math.max(1, Math.min(3600, Math.round(sec)));
  return {
    id: `autopilot/interval/${v}`,
    label: `AUTOPILOT TIMER ${v}s`,
    kind: "cmd",
    arg: `autopilot/interval/${v}`,
  };
};

export const buildAutopilotShuffleOp = (on: boolean): OpDescriptor => ({
  id: `autopilot/shuffle/${on ? 1 : 0}`,
  label: `AUTOPILOT SHUFFLE ${on ? "ON" : "OFF"}`,
  kind: "cmd",
  arg: `autopilot/shuffle/${on ? 1 : 0}`,
});

export const buildBrightnessOp = (level: number): OpDescriptor => {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  return {
    id: `brightness/${v}`,
    label: `BRIGHTNESS ${v}%`,
    kind: "cmd",
    arg: `brightness/${v}`,
  };
};

export const buildPatternOp = (name: string): OpDescriptor => ({
  id: `pattern/${name}`,
  label: `PATTERN ${name}`,
  kind: "cmd",
  arg: `pattern/${name}`,
});

export const buildFxOp = (name: string, on: boolean): OpDescriptor => ({
  id: `fx/${name}/${on ? 1 : 0}`,
  label: `FX ${name.toUpperCase()} ${on ? "ON" : "OFF"}`,
  kind: "cmd",
  arg: `fx/${name}/${on ? 1 : 0}`,
});

/**
 * Horn is a global FX entry that the captain wants as press-and-hold.
 * The protocol is the same: `fx/horn/1` on press, `fx/horn/0` on
 * release. The HornButton component takes care of the state machine.
 */
export const buildHornOp = (on: boolean): OpDescriptor =>
  buildFxOp("horn", on);

/**
 * Free-form CPC param write. The engine ignores keys it doesn't know,
 * which the bridge surfaces as `nak unknown_param`. The UI handles
 * that as a soft warning rather than an error.
 */
export const buildParamOp = (key: string, value: string | number): OpDescriptor => ({
  id: `param/${key}/${value}`,
  label: `PARAM ${key}=${value}`,
  kind: "cmd",
  arg: `param/${key}/${value}`,
});

/**
 * GLOBAL PARAMS (Central Param Center).
 *
 * Scalar global params (speed/size/count/direction/rotate). Compact
 * float formatting keeps each frame ≤ ~20 chars overhead so a rapid
 * series of taps doesn't risk LoRa air-time blowups. Engine clamps
 * to [0, 1] (and snaps `direction` to {0, 0.5, 1}) — we don't pre-clamp
 * here because the slider widget owns its own valid range and a
 * clamping mismatch would just confuse the operator.
 */
export const buildGlobalParamOp = (
  key: "speed" | "size" | "count" | "direction" | "rotate",
  value: number,
): OpDescriptor => {
  const v = formatFloatForWire(value);
  return {
    id: `param/${key}/${v}`,
    label: `${key.toUpperCase()} ${v}`,
    kind: "cmd",
    arg: `param/${key}/${v}`,
  };
};

/**
 * Color palette write (one of two CPC slots). Wire form is the
 * dedicated alias `palette/<n>/<h>-<s>-<v>` rather than a hyphen-
 * encoded `param/colorPaletteN/...` — same wire cost, one extra
 * code path on the bridge, but easier to grep for in field logs and
 * cleaner labels in the wire log.
 */
export const buildPaletteOp = (
  slot: 1 | 2,
  h: number,
  s: number,
  v: number,
): OpDescriptor => {
  const triple = [h, s, v].map(formatFloatForWire).join("-");
  return {
    id: `palette/${slot}/${triple}`,
    label: `PALETTE ${slot} ${triple}`,
    kind: "cmd",
    arg: `palette/${slot}/${triple}`,
  };
};

/**
 * LOCAL (per-pattern) export write.
 *
 * Sends a single-axis (v0) write to the engine's WASM export with the
 * given CRC32 control id. v1/v2 are reserved for a future expansion
 * (`exp/<id>/<v0>/<v1>/<v2>`) — most pattern-author exports are
 * 1-D sliders so we keep the wire format minimal.
 */
export const buildExportOp = (controlId: number, v0: number): OpDescriptor => {
  const v = formatFloatForWire(v0);
  return {
    id: `exp/${controlId}/${v}`,
    label: `EXP ${controlId} ${v}`,
    kind: "cmd",
    arg: `exp/${controlId}/${v}`,
  };
};

/**
 * Switch the deck's active playlist. The engine reloads the first
 * non-missing entry, broadcasts `mixer` + `pattern` WS events, and
 * the bridge's WS subscriber wakes the LoRa publisher so PortWatch
 * sees the new pattern within ~1 LoRa cycle.
 */
export const buildPlaylistOp = (name: string): OpDescriptor => ({
  id: `playlist/${name}`,
  label: `PLAYLIST ${name}`,
  kind: "cmd",
  arg: `playlist/${name}`,
});

/**
 * Compact wire formatter for floats. Strips trailing zeros, drops
 * the trailing dot, snaps to "0" for very small / negative-zero values.
 * Keeps each scalar under 6 chars so a `qry params` reply stays well
 * inside the per-frame plaintext budget.
 */
function formatFloatForWire(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  let s = n.toFixed(3);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (s === "" || s === "-0") return "0";
  return s;
}

// ── Query builders ──────────────────────────────────────────────────

export const buildStatusQuery = (): OpDescriptor => ({
  id: "qry-engine-status",
  label: "QRY engine/status",
  kind: "qry",
  arg: "engine/status",
});

export const buildPatternsQuery = (): OpDescriptor => ({
  id: "qry-engine-patterns",
  label: "QRY engine/patterns",
  kind: "qry",
  arg: "engine/patterns",
});

/**
 * Paged variant — fetches a single page (one LoRa frame). PortWatch
 * loops over this builder until the bridge reports the last page,
 * which is how we get the FULL pattern catalog past the per-frame
 * plaintext budget. See parsePatternPage() for the reply shape.
 */
export const buildPatternsPageQuery = (page: number): OpDescriptor => {
  const safe = Math.max(0, Math.floor(page));
  return {
    id: `qry-engine-patterns-p-${safe}`,
    label: `QRY engine/patterns/p/${safe}`,
    kind: "qry",
    arg: `engine/patterns/p/${safe}`,
  };
};

/**
 * Active-deck-playlist scoped pattern picker. Same paging shape as
 * `engine/patterns` but ALSO carries the playlist name (`pl/<name>`)
 * so the picker can label itself and detect mid-fetch playlist
 * swaps (engine reload → name changes between page 0 and page N).
 *
 * Prefer this over `buildPatternsPageQuery` for the deck pattern
 * picker — letting the operator tap a name that isn't actually in
 * the active playlist sends `cmd pattern/<name>`, which the engine
 * happily applies but defeats the picker's "this is what's on deck
 * right now" mental model.
 */
export const buildPlaylistPatternsPageQuery = (page: number): OpDescriptor => {
  const safe = Math.max(0, Math.floor(page));
  return {
    id: `qry-engine-playlist-patterns-p-${safe}`,
    label: `QRY engine/playlist-patterns/p/${safe}`,
    kind: "qry",
    arg: `engine/playlist-patterns/p/${safe}`,
  };
};

/**
 * Pattern names for an arbitrary playlist (by NAME), paginated.
 * Doesn't change the deck — used by the REFRESH-WORLD action to
 * fan a single press out into pre-population of the cache for every
 * playlist in the library so subsequent CaptainPad-driven playlist
 * switches render instantly off `patternsByPlaylist[<name>]`.
 *
 * Same reply shape as `engine/playlist-patterns` so callers share
 * `parsePlaylistPatternsPage()`. The wire format restricts <name> to
 * `[A-Za-z0-9_.-]{1,32}` — the bridge re-sanitizes on emission and
 * any name surfaced by the PUB's `pl/` field is already in this
 * subset.
 */
export const buildPlaylistPatternsByNameQuery = (
  name: string,
  page: number,
): OpDescriptor => {
  const safePage = Math.max(0, Math.floor(page));
  // Defensive: mirror the bridge sanitizer so a caller can't drift
  // off into asking for `engine/get-playlist-patterns/My Cool/p/0`,
  // which would parse as path components `My`, `Cool`, `p`, `0` and
  // either NAK or fetch the wrong playlist.
  const safeName = (name || "")
    .split("")
    .map((c) => (/[A-Za-z0-9_.\-]/.test(c) ? c : "_"))
    .join("")
    .slice(0, 32);
  const finalName = safeName || "_";
  return {
    id: `qry-engine-get-playlist-patterns-${finalName}-p-${safePage}`,
    label: `QRY engine/get-playlist-patterns/${finalName}/p/${safePage}`,
    kind: "qry",
    arg: `engine/get-playlist-patterns/${finalName}/p/${safePage}`,
  };
};

/**
 * Engine view override (DECK pin / clear). Forces the engine to render
 * the deck channel until cleared, at which point it restores the
 * pre-override target view. Engine-side state is persisted in
 * /mixer/view-override; the bridge mirrors `cmd view/<deck|clear>`.
 */
export const buildViewOverrideOp = (mode: "deck" | "clear"): OpDescriptor => ({
  id: `view/${mode}`,
  label: `VIEW ${mode.toUpperCase()}`,
  kind: "cmd",
  arg: `view/${mode}`,
});

/**
 * Silent lease-renew of the deck-view override. Same wire effect as
 * `cmd view/deck` (the engine arms a fresh 30 s lease on every
 * deck-pin POST) but labelled separately so the wire log doesn't
 * look like the operator is hammering TAKE LOCK every 20 s. The
 * registry treats `view/renew` and `view/deck` as the same handler
 * — see control_podium/comms/bridge.py::_exec_cmd("view", …).
 */
export const buildViewRenewOp = (): OpDescriptor => ({
  id: "view/renew",
  label: "VIEW RENEW",
  kind: "cmd",
  arg: "view/renew",
});

export const buildParamQuery = (key: string): OpDescriptor => ({
  id: `qry-param-${key}`,
  label: `QRY param/${key}`,
  kind: "qry",
  arg: `param/${key}`,
});

export const buildMixerStateQuery = (): OpDescriptor => ({
  id: "qry-mixer-state",
  label: "QRY mixer/state",
  kind: "qry",
  arg: "mixer/state",
});

/**
 * Full global-params snapshot. Reply shape:
 *   `sp/<f>,dr/<f>,ct/<f>,sz/<f>,rt/<f>,p1/<h>-<s>-<v>,p2/<h>-<s>-<v>`
 * Always one frame; the bridge guarantees this fits the plaintext
 * budget. Anything the engine doesn't have yet gets omitted (not
 * nulled), so the parser distinguishes "no signal" from "is zero".
 */
export const buildParamsSnapshotQuery = (): OpDescriptor => ({
  id: "qry-params",
  label: "QRY params",
  kind: "qry",
  arg: "params",
});

/**
 * Paginated per-pattern WASM exports for the deck base channel.
 * Page reply shape:
 *   `p/<idx>,t/<total>,n/<count>,c/<id>~<kind>~<v0>~<name>,...`
 * `~` is the within-record separator (`:` and `|` are forbidden in
 * frame args).
 */
export const buildExportsPageQuery = (page: number): OpDescriptor => {
  const safe = Math.max(0, Math.floor(page));
  return {
    id: `qry-exports-p-${safe}`,
    label: `QRY exports/p/${safe}`,
    kind: "qry",
    arg: `exports/p/${safe}`,
  };
};

/**
 * Paginated playlist directory listing. Same paging shape as exports
 * and patterns; PortWatch loops until `pageIndex === totalPages - 1`.
 */
export const buildPlaylistsPageQuery = (page: number): OpDescriptor => {
  const safe = Math.max(0, Math.floor(page));
  return {
    id: `qry-playlists-p-${safe}`,
    label: `QRY playlists/p/${safe}`,
    kind: "qry",
    arg: `playlists/p/${safe}`,
  };
};

/**
 * Snapshot of the deck base channel's currently-loaded playlist.
 * Reply shape: `pl/<name>,en/<entryId>` when assigned; `pl/-` when
 * no playlist is loaded.
 */
export const buildDeckPlaylistQuery = (): OpDescriptor => ({
  id: "qry-deck-playlist",
  label: "QRY deck/playlist",
  kind: "qry",
  arg: "deck/playlist",
});

// ── Link-layer builders ─────────────────────────────────────────────

export const buildPing = (): OpDescriptor => ({
  id: `ping/${Date.now()}`,
  label: "PING",
  kind: "pin",
  arg: "",
});

export const buildHello = (): OpDescriptor => ({
  id: `hello/${Date.now()}`,
  label: "HELLO",
  kind: "hlo",
  arg: "name/portwatch,role/captain",
});

// ── Frame builder ───────────────────────────────────────────────────

/**
 * Build a fully-populated Frame for an op. The codec computes the
 * counter, encrypts, and writes the resulting `T2|…` line to BLE.
 */
export function frameForOp(
  op: OpDescriptor,
  seq: number,
  src: number,
  dst: number = SERVER_ID,
): Frame {
  let typ: string;
  switch (op.kind) {
    case "cmd": typ = TYPE_CMD; break;
    case "qry": typ = TYPE_QRY; break;
    case "pin": typ = TYPE_PIN; break;
    case "hlo": typ = TYPE_HLO; break;
  }

  // We always set ACK_REQUESTED so the bridge replies — that's what
  // gives the UI an indication that the command landed. PRIVILEGED
  // is also set on cmd as a hint (the bridge re-checks anyway).
  const flags =
    FLAG_ACK_REQUESTED |
    (op.kind === "cmd" ? FLAG_PRIVILEGED : 0);

  return {
    src,
    dst,
    seq,
    typ,
    flags,
    arg: op.arg,
  };
}

// ── Catalog of stateful FX macros ───────────────────────────────────

/**
 * The set of stateful FX macros the Deck card surfaces. Each one is a
 * toggle in the UI; press fires `fx/<name>/<0|1>` to the bridge.
 *
 * Names match `GlobalEffectsController` on the engine side. Adding a
 * new entry here is enough — no other code changes needed in the app.
 */
export const STATEFUL_FX_MACROS = [
  { name: "vintageWhite", label: "VINTAGE WHITE" },
  { name: "fogger", label: "FOGGER" },
  { name: "uvBlast", label: "UV BLAST" },
  { name: "blastWhite", label: "BLAST ALL WHITE" },
] as const;

/**
 * Brightness preset chips (the Deck card uses these). 0 ALWAYS the
 * leftmost so the user has a quick "kill all light gracefully" without
 * having to engage Blackout.
 */
export const BRIGHTNESS_PRESETS = [0, 10, 25, 50, 75, 100] as const;

/**
 * Autopilot transition interval presets in seconds. Maps to
 * `cmd autopilot/interval/<n>` over LoRa, which the bridge translates
 * to `POST /autopilot {delay_s: <n>}` on the engine. The presets are
 * a superset of the engine's default (30 s) and CaptainPad's most-used
 * picker entries so a tap-to-set always lands on a value that matches
 * what the operator can also pick on the iPad.
 */
export const AUTOPILOT_INTERVAL_PRESETS = [
  5, 10, 30, 60, 120, 300,
] as const;

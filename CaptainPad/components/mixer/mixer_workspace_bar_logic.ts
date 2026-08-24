/**
 * mixer_workspace_bar_logic — the PURE brain of the mixer workspace bar's
 * chip row (contract: docs/64_mixer_relayout.md §2.4, §2.5).
 *
 * Zero React / React Native imports on purpose: the vitest config only
 * admits pure `.ts` under `components/**` (RN components are `.tsx` and stay
 * excluded), so every decision the bar makes — chip ORDER, which chips are
 * shown vs railed, label composition, the muted-style flag, the floor-
 * disabled flag, whether the perf caption shows — lives here and is checked
 * by the suite. `mixer_workspace_bar.tsx` is a thin render of the plan this
 * module produces; it never re-derives a layout fact of its own (same
 * discipline `mixer_workspace_layout.ts` documents for itself).
 *
 * This module asks `mixer_workspace_layout.ts` for the facts it needs
 * (`visibleChannels`, `effectiveCitizenShown`, `parseMixerSurfaceId`) rather
 * than re-deriving them — the one exception is the RAIL's close-order,
 * interleaved across channels AND citizens, which that module deliberately
 * does not expose as a single selector (`hiddenChannelChips` is channel-only,
 * `isCitizenShown`/`effectiveCitizenShown` are citizen-only): the interleave
 * is read directly off `layout.closed` (append-order = close order, the same
 * property the deck's `railSurfaces` relies on), filtered through the same
 * total parser every other caller uses.
 */
import {
  channelSurfaceId,
  citizenSurfaceId,
  effectiveCitizenShown,
  parseMixerSurfaceId,
  visibleChannels,
  type MixerChannelId,
  type MixerSurfaceId,
  type MixerWorkspaceLayout,
} from './mixer_workspace_layout';

// ── Input shape ──────────────────────────────────────────────────────────

/** What the caller knows about one channel, in CANONICAL engine order — the
 *  bar never reorders this list, it only filters it (docs/64 §2.4: "channels
 *  in engine order"). */
export interface MixerBarChannelInput {
  id: MixerChannelId;
  /** 1-based position, for the chip's index dot label. */
  index: number;
  /** Already-derived channel title (the caller's `deriveChannelTitle`). */
  title: string;
  /** Group tint, or null when ungrouped. */
  groupColor: string | null;
  /** `channel.enabled === false`. */
  muted: boolean;
}

// ── Master bar SEAT styles (docs/69 §1, §2 — the portrait 0pt-rail fix) ────
//
// `as const` + inference, not `import type { ViewStyle } from 'react-native'`:
// importing react-native here would break this module's one hard property
// (zero RN imports, so the vitest `components/**/*.ts` glob can load it
// outside a React Native runtime — see the file header). Deliberately NOT
// given an explicit annotation (e.g. `: ViewStyle` or a hand-written local
// interface) — an annotation would WIDEN the inferred literal type back to
// `{flex?: number; minWidth?: number}`, which defeats the point: it would
// let a future edit add a stray `flexBasis` to the portrait object without
// the type checker ever seeing it as a new key. Left to plain `as const`
// inference, `MASTER_BAR_SEAT_PORTRAIT`'s TYPE is the literal
// `{readonly minWidth: 0}` — it has no `flex`/`flexGrow`/`flexShrink`/
// `flexBasis` property AT THE TYPE LEVEL, not just at the value level, so
// the absence is provable by the compiler as well as by the runtime test
// below. Both objects remain structurally assignable to RN's `ViewStyle`
// at the call site (`style={isPortrait ? MASTER_BAR_SEAT_PORTRAIT :
// MASTER_BAR_SEAT_LANDSCAPE}`) purely by shape — TypeScript's structural
// typing accepts a `readonly`-literal subset of `ViewStyle`'s keys, no cast
// required — and `MasterBarSeatStyle` is exported below as the union of
// their inferred types, for any caller that wants to name it.
//
// THE BUG (docs/69 §1.1, executed proof against this app's own vendored
// Yoga, `node_modules/react-native/ReactCommon/yoga/yoga/node/Node.cpp:329-339`):
// `mixer.tsx` composed the portrait seat as
// `[styles.masterBarFill, isPortrait && styles.masterBarFillPortrait]` —
// `masterBarFill = {flex:1, minWidth:0}` overridden by
// `masterBarFillPortrait = {flexGrow:0, flexShrink:0, flexBasis:'auto'}`.
// Flattening never removes `flex:1` (it's a different key from the three
// longhands it was "overridden" with), so the flattened style Yoga actually
// sees is `{flex:1, flexGrow:0, flexShrink:0, flexBasis:'auto', minWidth:0}`.
// Yoga's `processFlexBasis()` returns an explicit basis only when the style's
// `flexBasis` is neither `auto` nor `undefined` — an explicit `'auto'` FALLS
// THROUGH that check, and the code then sees `flex:1` still set and forces
// `flexBasis: 0` on native (web-defaults are off in this RN build; only
// react-native-web's real CSS longhands honor `flex-basis:auto` over the
// `flex` shorthand — which is why two rounds of web screenshots passed while
// two rounds of on-device testing failed). `resolveFlexGrow()` honors the
// explicit `flexGrow:0` regardless. Net native resolution: grow 0 / shrink 0
// / basis 0 = a deterministic 0pt bar.
//
// THE RULE: never override a `flex: N` base with longhands on native —
// SELECT a style, don't fight one. `MASTER_BAR_SEAT_PORTRAIT` below carries
// NO flex-family key at all, which makes the `processFlexBasis` trap
// structurally unreachable (there is no `flex:1` for it to fall back past),
// so Yoga's own defaults apply — flexGrow 0, flexShrink 0, flexBasis auto —
// and the seat sizes to its content, exactly the outcome the inert `_275`
// longhand override was trying and failing to produce.

/** Landscape seat: byte-equal to today's `masterBarFill` — the master row is
 *  a ROW with a definite width there, so `flex:1` correctly means "claim the
 *  row's remaining width" and Yoga's basis-0-on-`flex` behavior is exactly
 *  what's wanted (a grower, not a content-sized box). Unchanged by this fix
 *  (docs/69 §2 item 1 / accept criteria: "landscape screenshots byte-identical"). */
export const MASTER_BAR_SEAT_LANDSCAPE = {
  flex: 1,
  minWidth: 0,
} as const;

/** Portrait seat: deliberately has NO `flex`/`flexGrow`/`flexShrink`/
 *  `flexBasis` key. The master row flips to a COLUMN in portrait
 *  (`masterRowPortrait`) with an AUTO (content-sized) height, so a grower
 *  has nothing definite to grow against — the whole point is that this seat
 *  must NOT try to grow: it must size to its one child (the chip row) and
 *  let the column's `alignItems:'stretch'` give it full width. */
export const MASTER_BAR_SEAT_PORTRAIT = {
  minWidth: 0,
} as const;

/** Union of the two seats' inferred literal types — a named type for any
 *  caller that wants one, without forcing either constant through a widening
 *  annotation (see the block comment above). */
export type MasterBarSeatStyle = typeof MASTER_BAR_SEAT_LANDSCAPE | typeof MASTER_BAR_SEAT_PORTRAIT;

// ── Citizen titles (docs/64 §2.4) ───────────────────────────────────────────

export const COLORS_TITLE = 'COLORS';
export const AUDIO_TITLE = 'AUDIO';

/** `1 · SPARKLE` — the index dot's label plus the derived title. Visual
 *  upper-casing is a TEXT STYLE concern (`textTransform: 'uppercase'`, same
 *  as the deck's `chipLabel`/`railChipLabel`), so the string itself keeps
 *  whatever case the caller's title arrived in. */
export function channelChipLabel(index: number, title: string): string {
  return `${index} · ${title}`;
}

// ── The chip plan ────────────────────────────────────────────────────────

export type MixerBarChipEntry =
  | {
      kind: 'channel';
      surfaceId: MixerSurfaceId;
      channelId: MixerChannelId;
      index: number;
      title: string;
      label: string;
      groupColor: string | null;
      muted: boolean;
      open: boolean;
      /** True only for the ONE chip that is the floor (the last visible
       *  channel) — it renders with no press handler (docs/53 §3.1: an
       *  affordance that always refuses should not exist). */
      floorDisabled: boolean;
      /** A hidden-AND-muted channel renders its label in the muted style —
       *  a hidden-and-silenced layer must be discoverable at a glance
       *  (docs/64 §2.4). Never true for a shown chip: the channel strip
       *  already carries mute state there. */
      showMutedStyle: boolean;
    }
  | {
      kind: 'citizen';
      surfaceId: MixerSurfaceId;
      citizen: 'colors';
      title: string;
      label: string;
      open: boolean;
    }
  | {
      kind: 'audio';
      surfaceId: 'audioBar';
      title: string;
      label: string;
      open: boolean;
    };

export interface MixerBarPlan {
  /** Canonical order: visible channels (engine order), then COLORS. */
  shown: MixerBarChipEntry[];
  /** The restore rail, in CLOSE order (channels and citizens interleaved
   *  exactly as `layout.closed` recorded them). */
  rail: MixerBarChipEntry[];
  /** Whether the HIDDEN divider + caption should render at all. */
  showHiddenDivider: boolean;
}

function channelEntry(
  ch: MixerBarChannelInput,
  open: boolean,
  floorDisabled: boolean,
): MixerBarChipEntry {
  return {
    kind: 'channel',
    surfaceId: channelSurfaceId(ch.id),
    channelId: ch.id,
    index: ch.index,
    title: ch.title,
    label: channelChipLabel(ch.index, ch.title),
    groupColor: ch.groupColor,
    muted: ch.muted,
    open,
    floorDisabled,
    showMutedStyle: !open && ch.muted,
  };
}

function citizenEntry(open: boolean): MixerBarChipEntry {
  const title = COLORS_TITLE;
  return {
    kind: 'citizen',
    surfaceId: citizenSurfaceId('colors'),
    citizen: 'colors',
    title,
    label: title,
    open,
  };
}

function audioEntry(open: boolean): MixerBarChipEntry {
  return {
    kind: 'audio',
    surfaceId: 'audioBar',
    title: AUDIO_TITLE,
    label: AUDIO_TITLE,
    open,
  };
}

/**
 * Builds the bar's complete render plan. Pure over its four inputs — same
 * inputs, same plan, every time.
 *
 *   channels        ALL channels (shown and hidden), CANONICAL engine order.
 *   layout          the persisted workspace layout.
 *   perfActive      the raw performance-overlay flag (docs/64 §2.6) — used
 *                   ONLY to compose citizen visibility;
 *                   it never touches channel visibility (perf mode never
 *                   hides a whole channel, only its PARAMS section — a
 *                   section this bar has no chip for).
 *   floorChannelId  the channel the floor protects (the reducer's D1 refusal,
 *                   computed by the caller against the live roster at
 *                   dispatch time) — null/undefined when more than one
 *                   channel is visible, so nothing is floor-disabled.
 */
export function buildMixerBarPlan(
  channels: readonly MixerBarChannelInput[],
  layout: MixerWorkspaceLayout,
  perfActive: boolean,
  floorChannelId: MixerChannelId | null | undefined,
  audioBarOpen?: boolean,
): MixerBarPlan {
  const roster = channels.map((ch) => ch.id);
  const rosterSet = new Set(roster);
  const byId = new Map(channels.map((ch) => [ch.id, ch] as const));

  const visibleIds = visibleChannels(roster, layout);
  const shown: MixerBarChipEntry[] = visibleIds.map((id) => {
    const ch = byId.get(id);
    if (!ch) {
      throw new Error(`[mixer_workspace_bar_logic] visible channel '${id}' missing from the channels input`);
    }
    return channelEntry(ch, true, floorChannelId != null && id === floorChannelId);
  });

  if (effectiveCitizenShown(layout, 'colors', perfActive)) shown.push(citizenEntry(true));
  if (audioBarOpen === true) shown.push(audioEntry(true));

  const rail: MixerBarChipEntry[] = [];
  for (const rawId of layout.closed) {
    const parsed = parseMixerSurfaceId(rawId);
    if (parsed.kind === 'channel') {
      if (!rosterSet.has(parsed.channelId)) continue;
      const ch = byId.get(parsed.channelId);
      if (!ch) continue;
      rail.push(channelEntry(ch, false, false));
    } else if (parsed.kind === 'citizen' && parsed.citizen === 'colors') {
      rail.push(citizenEntry(false));
    }
    // 'section' and 'invalid' ids get no chip in this row (docs/64 §2.1:
    // sections have their own affordance on the strip, not here).
  }
  if (audioBarOpen === false) rail.push(audioEntry(false));

  return { shown, rail, showHiddenDivider: rail.length > 0 };
}

// ── The overflow affordance's one decision (docs/67 §4.2) ─────────────────

/** What the bar's horizontal scroller measured: its content width, its
 *  viewport width, and how far it is scrolled. Plain numbers in points — this
 *  module never sees a React Native event. */
export interface MixerBarScrollExtent {
  content: number;
  viewport: number;
  offset: number;
}

/** 1 pt of slack. Absorbs sub-pixel rounding (904.0001 pt of content in a
 *  904 pt viewport is NOT overflow) and iOS rubber-band overscroll at the far
 *  end, so the hint never flickers on at rest. */
export const MIXER_BAR_OVERFLOW_EPSILON = 1;

/**
 * Should the bar draw its `›` overflow hint? True only while the row ACTUALLY
 * overflows AND is not already scrolled to the end — an honest affordance at
 * every scroll position, rather than a decoration that lies once the operator
 * reaches the last chip (docs/67 §4.2, decision D4).
 *
 * Lives here, not in the `.tsx`, for the same reason every other bar decision
 * does: the vitest config only admits pure `.ts` under `components/**`, and a
 * decision the suite cannot exercise is a decision that can rot. The render
 * layer measures and asks; it never re-derives this.
 *
 * A zero/unmeasured viewport answers FALSE — before the first layout pass
 * there is no fold to advertise, and guessing would flash the glyph on every
 * mount.
 */
export function shouldShowBarOverflowHint(extent: MixerBarScrollExtent): boolean {
  if (extent.viewport <= 0) return false;
  if (extent.content <= extent.viewport + MIXER_BAR_OVERFLOW_EPSILON) return false;
  return extent.offset < extent.content - extent.viewport - MIXER_BAR_OVERFLOW_EPSILON;
}

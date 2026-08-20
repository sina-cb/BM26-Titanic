// Adaptive layout helpers for PortWatch.
//
// PortWatch ships on both iPhone (compact, vertical, walk-test focused)
// and iPad (roomy, multi-column, in-camp focused). Rather than maintain
// separate component trees per form factor, every screen reads its
// "form factor" from this hook and adjusts its layout (column count,
// card width, font scaling) accordingly.
//
// We deliberately use width-based detection rather than `Platform.isPad`
// because:
//   * iPad apps in Slide Over / Split View have iPhone-class width even
//     on the iPad — those panes deserve the compact layout.
//   * Future iOS form factors (iPad mini, foldables, Mac Catalyst) all
//     fall into the right bucket automatically.
//   * Orientation-based layout is just "current width", no separate code
//     path needed.
//
// Breakpoints follow Apple's HIG default of 600 pt as the boundary
// between phone-class and tablet-class layouts.

import { useWindowDimensions } from "react-native";

export type FormFactor = "compact" | "regular" | "wide";

/**
 * Derive the current form factor from the active window dimensions.
 *
 *   * `compact`  — phone-class layout. Single column, full-width cards,
 *                  tabs at the bottom.
 *   * `regular`  — small-tablet / split-view layout. Two cards per row
 *                  where it makes sense.
 *   * `wide`     — full iPad in landscape. Three columns where it makes
 *                  sense, keeps long lists readable without horizontal
 *                  hunting.
 */
export function useFormFactor(): FormFactor {
  const { width } = useWindowDimensions();
  if (width >= 1024) return "wide";
  if (width >= 600) return "regular";
  return "compact";
}

/**
 * Convenience: how many columns of cards fit comfortably on this device.
 * Use as the `numColumns` for FlatList / a flex layout's basis math.
 */
export function useColumnCount(): number {
  const ff = useFormFactor();
  if (ff === "wide") return 3;
  if (ff === "regular") return 2;
  return 1;
}

/**
 * Convenience: max content width to keep cards readable on very wide
 * screens. Apply as `maxWidth` on a centered container. Sourced from
 * .config.portwatch.yaml::layout.max_content_width (see
 * scripts/sync-config.mjs).
 */
import { layout as _layoutCfg } from "../config";
export const MAX_CONTENT_WIDTH = _layoutCfg.max_content_width;

/**
 * Returns true if we should render the bottom tab bar (compact) vs a
 * sidebar (regular/wide). Currently a single tab strip works for both;
 * this is here so the answer is one place when we ever switch.
 */
export function useShouldUseSidebar(): boolean {
  return useFormFactor() === "wide";
}

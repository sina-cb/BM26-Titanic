/**
 * autopilot_pick.js — the pure auto-cycle NEXT-ENTRY picker + its clamps.
 *
 * Extracted VERBATIM from api_server.js (2026-07-06, autopilot profile seam) so
 * the autopilot profiles (`lib/autopilot_profiles/*`) can import the picker
 * WITHOUT a circular dependency on the big api_server module. api_server.js now
 * re-exports these names from here, so every external consumer (unit tests,
 * mixer/overlay ticks, the deck daemon) sees the identical function and
 * constants at the identical import path it always used.
 *
 * The math below is byte-for-byte the pre-extraction `pickNextAutoCycleEntry`
 * (group-locality → shuffle → sequential) — no behaviour change. Group-dwell
 * state lives in the caller-owned mutable `groupRuntime`, exactly as before.
 */

// ── Auto-cycle group-locality clamps (single source of truth) ─────────
// PATTERN-GROUP LOCALITY (feat/optimize_channels): the autopilot grabs a
// small WINDOW of adjacent playlist entries, dwells within it for a number of
// swaps, then releases and grabs a fresh window. The window size and dwell
// count are clamped here so a stale/garbage on-disk value can't form a
// degenerate (1-wide) or runaway window. Defaults match the field docs.
export const AUTO_GROUP_SIZE_MIN = 2;
export const AUTO_GROUP_SIZE_MAX = 8;
export const AUTO_GROUP_SIZE_DEFAULT = 3;
export const AUTO_GROUP_DWELL_MIN = 1;
export const AUTO_GROUP_DWELL_MAX = 50;
export const AUTO_GROUP_DWELL_DEFAULT = 6;

export const clampInt = (raw, lo, hi, dflt) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

// ── Auto-cycle next-entry pick (pure, unit-tested) ────────────────────
// MIRRORS the deck Autopilot advance pick (api_server deck daemon): when
// group-locality is armed, dwell within a window of adjacent entries, else
// shuffle picks a random OTHER usable entry, else sequential walks forward
// skipping `_missing`. `usable` excludes `_missing` entries.
// Returns the chosen entry, or null when there is nothing to advance to (no
// usable entries).
//
// PATTERN-GROUP LOCALITY: when `autopilot.groupMode` is true AND there are
// strictly more usable entries than the window size, dwell state lives in the
// caller-owned mutable `groupRuntime` ({ windowIds, swapsLeft }) so the window
// + remaining-swap count persist ACROSS advances. The function reads and
// MUTATES `groupRuntime` in place (the contract); randomness via Math.random
// matches shuffle. With group-locality off (default), or too few usable
// entries, group mode is a no-op and the existing shuffle/sequential logic
// runs unchanged — `groupRuntime` may be omitted by those callers.
export function pickNextAutoCycleEntry(pl, autopilot, curEntryId, groupRuntime) {
  if (!pl || !Array.isArray(pl.entries) || pl.entries.length === 0) return null;
  const usable = pl.entries.filter(e => !e._missing);
  if (usable.length === 0) return null;
  // PATTERN-GROUP LOCALITY: dwell inside a rolling window of adjacent usable
  // entries. No-op (fall through) unless armed AND the playlist is bigger than
  // one window — otherwise the "window" would be the whole list, defeating the
  // point. Needs a mutable runtime to carry dwell state across advances.
  const groupSize = clampInt(
    autopilot && autopilot.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX,
    AUTO_GROUP_SIZE_DEFAULT,
  );
  if (autopilot && autopilot.groupMode && groupRuntime && usable.length > groupSize) {
    const groupDwell = clampInt(
      autopilot.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX,
      AUTO_GROUP_DWELL_DEFAULT,
    );
    const win = groupRuntime.windowIds;
    const haveWindow = Array.isArray(win) && win.length > 0;
    const curInWindow = haveWindow && win.includes(curEntryId);
    // Form a FRESH window when there is none, the dwell expired, or we've
    // wandered out of the current window (manual tap / loop release landed
    // elsewhere). A fresh random start is fine even when re-forming.
    if (!haveWindow || groupRuntime.swapsLeft <= 0 || !curInWindow) {
      const start = Math.floor(Math.random() * usable.length);
      const windowIds = [];
      for (let i = 0; i < groupSize; i++) {
        windowIds.push(usable[(start + i) % usable.length].id);
      }
      groupRuntime.windowIds = windowIds;
      groupRuntime.swapsLeft = groupDwell;
    }
    // Pick a random entry from the window that is NOT the current one (no
    // immediate repeat); if the window collapsed to only the current entry,
    // replay it. Decrement the dwell counter (mutate in place — the contract).
    const choices = groupRuntime.windowIds.filter(id => id !== curEntryId);
    const pickId = choices.length
      ? choices[Math.floor(Math.random() * choices.length)]
      : curEntryId;
    groupRuntime.swapsLeft -= 1;
    const picked = usable.find(e => e.id === pickId);
    if (picked) return picked;
    // The chosen id is no longer usable (entry removed mid-dwell) — force a
    // fresh window next call and fall through to sequential this beat.
    groupRuntime.windowIds = null;
    groupRuntime.swapsLeft = 0;
  }
  if (autopilot && autopilot.shuffle) {
    const others = usable.filter(e => e.id !== curEntryId);
    return others.length ? others[Math.floor(Math.random() * others.length)] : usable[0];
  }
  // Sequential: walk forward from the current index, skipping _missing.
  const idx = pl.entries.findIndex(e => e.id === curEntryId);
  let nextIdx = (idx + 1) % pl.entries.length;
  for (let i = 0; i < pl.entries.length; i++) {
    if (!pl.entries[nextIdx]._missing) return pl.entries[nextIdx];
    nextIdx = (nextIdx + 1) % pl.entries.length;
  }
  return null;
}

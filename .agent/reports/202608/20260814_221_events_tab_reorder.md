# _221 — EVENTS tab moved under TIMELINE — 2026-08-14

**Operator order, verbatim:** "move the events tab under the timeline tab
icon". One change, ordering only.

## What moved

`CaptainPad/app/(tabs)/_layout.tsx` — the `<Tabs.Screen name="special_events">`
registration moved from **directly after `touch_control`** (i.e. immediately
below the Layers group) to **directly after `timeline`**. Expo Router renders
the sidebar in `Tabs.Screen` declaration order, and `CustomSideBar` maps
`state.routes` in that same order, so the declaration move IS the visual move —
no index, no sort key, no separate ordering table exists.

Sidebar order before → after:

```
Deck · Mixer · Live Touch · [Events] · Studio · Audio · 2D Simulator · OSC · Timeline · Scheduler · …
Deck · Mixer · Live Touch · Studio · Audio · 2D Simulator · OSC · Timeline · [Events] · Scheduler · …
```

Nothing else changed. `captainpad_tab_policy.ts` is untouched: title stays
`Events`, icon stays `sparkles`, group stays `Show`, `showInPerformance` stays
`true`. No route file renamed, no navigation target rewritten.

## The group header follows the route, and that is correct

`CustomSideBar` prints a group caption whenever a route's `tabBarGroup` differs
from the previous VISIBLE route's group (`showGroupTitle`, `_layout.tsx`). The
`SHOW` caption therefore travelled with the tab: it used to sit between LIVE
TOUCH and EVENTS, it now sits between TIMELINE and EVENTS. Verified in the
capture. This also holds in performance mode, where the visible set collapses
to Deck / Mixer / Live Touch / Events — EVENTS still follows a `Layers` route
there, so `SHOW` still prints and the tab is still reachable to arm a show.
The stale positional sentence in the registration's comment ("Sits right after
the Layers group") was rewritten to match the new position; its substance —
why the tab is performance-visible — is unchanged.

## Verify

`tsc --noEmit` clean for CaptainPad. Fresh `npm run expo export --platform web
-c` dist served on **:7167** (never the operator's :6967), puppeteer with
`console.log/debug/info/warn` stubbed in `evaluateOnNewDocument` before boot,
one tab. Three screenshots in `~/tmp/fix_221/`, all inspected:
`tabbar_wide.png` (1440×1024), `tabbar_narrow.png` (900×1200),
`tabbar_tall.png` (900×1700, sidebar crop — the only viewport tall enough to
show the whole strip without scrolling). The tall crop reads, top to bottom:
LAYERS · DECK · MIXER · LIVE TOUCH · STUDIO · AUDIO · TOOLS · 2D SIMULATOR ·
OSC · TIMELINE · SHOW · EVENTS · SCHEDULER · DIMMER RACK · MIDI · CONFIG.
The sidebar is a `ScrollView`, so at 1024 px the strip ends at OSC and the new
pair is below the fold — that is pre-existing behaviour, not a regression.

No git operations. No operator port bound (6966-6972 untouched, bench mirror
untouched). Scratch capture scripts live in `~/tmp/fix_221/`, not the tree.

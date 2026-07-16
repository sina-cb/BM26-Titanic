---
name: deck_split_playlists
status: active        # active | paused | done
owner: coordinator (Opus multi-agent run)
created: 2026-07-06
updated: 2026-07-06
---

# Deck Split Playlists — Two Stacked, Resizable Panes — DESIGN REFERENCE

> **Deep-design reference, not the execution plan.** The execution plan lives in
> the master dossier [`autopilot_deck_improvement.md`](autopilot_deck_improvement.md).
> Lands on **`feat/autopilot_deck_improvement`** (origin + local); worktree
> branches local-only `dev/*`. **Supersedes the earlier "A·B pills, one active"
> idea** — that dossier was deleted.

Grounded in a read-only Fable design pass (2026-07-06) with `file_path:line`
citations. Agents MUST open the cited code before editing.

## The operator's vision

On the CaptainPad DECK screen the playlist area becomes **two stacked playlist
list-views in a vertically resizable split card**:
- Pane 1 = primary playlist (as today). Pane 2 = an **optional** second playlist.
- Add pane 2 by picking a playlist from the existing library; it opens a new
  list-view in pane 2 — **the same list component used for patterns**, a second
  instance bound to a different playlist. Purpose: keep e.g. a "slow" list and a
  "fast" list both visible, drive from either.
- The right-hand PARAMETER column stays **single and unchanged**, driven by the
  live deck channel — "we go to the pattern to change its parameters." The two
  panes are just list views; do NOT duplicate the parameter panel.
- **Resizable**: drag a divider to split the card between the panes.

## One-paragraph design

The deck gains two *playlist slots* — `primary` and `secondary` — that are
stable **bindings by name**, while the deck's existing live pointer
(`channel.playlist`) stays the single source of truth for *what is playing*. The
PATTERNS column becomes a split card holding two `PlaylistPanel` instances (a
new `deckSlot` role, `channelId` = slot key), separated by a PanResponder drag
divider. Tapping an entry in either pane routes through the existing
`loadPlaylistEntryWithTransition` — the deck still plays exactly one pattern —
and autopilot cycles whichever slot's playlist is live (the last-driven pane).
The PARAMETER column is untouched (renders off the live `deckChannel`). Slot
names + split ratio persist in `states/<model>/deck_state.yaml` extras and ride
the existing `deck` WS message — no new WS type.

## Existing deck list-view & layout (as-built)

`CaptainPad/components/PlaylistPanel.tsx` is **already multi-instance,
role-parameterized** (deck, mixer strips, deck overlays all mount it):
- Props `channelId`, `role: ChannelRole`, `channelLabel`, `compact`, `locked`,
  `disabled`, `initialAssignment`, `playlistLibrary`, … (`PlaylistPanel.tsx:36-111,151`).
  Per-instance state `assignment`/`playlist` (`:163-168`).
- WS reconcile is role-branched: `role==='deck'` reads `msg.channel.playlist`
  (`:560-573`); `role==='deckOverlay'` reads `msg.overlays[]` folded into the
  same `deck` message (`:574-588`) — **the exact precedent the new `deckSlot`
  role copies**. `channelPlaylistData` primes cache + adopts inline when
  `msg.channelId === channelId` (`:589-617`).
- Actions: `handleLoadPlaylist` optimistic + rollback+Alert (`:671-715`);
  `handleEntryTap` optimistic active flip + pending-gate/watchdog, 409/EBUSY
  swallowed (`:717-759`, gate `:239-276`). Active row = `assignment?.activeEntryId
  === e.id` (`:1267`).

**Conclusion: a second instance is directly mountable** — nothing is singleton;
endpoint selection is entirely `(role, channelId)`-driven. The only real work is
a `deckSlot` role whose GET/POST/WS bindings point at a *slot* not a channel.

Deck screen (`CaptainPad/app/(tabs)/index.tsx`): 3-col layout (`:711-722`;
`isWide` = landscape ∧ width ≥ 900, `:153-155`). COLUMN 1 PATTERNS (`:723-783`,
narrow floor `minHeight:320` `:739`) mounts the single deck panel at `:758-776`
(`role="deck"`, `disabled={deckSwapInFlight || planGate}` `:773`). COLUMN 2/3
render off `deckChannel` only. Convention: warm REST seed in `seed()`
(`:425-474`), WS reconcile in `onControl` `deck` branch (`:319-349`), optimistic
→ POST → rollback + Alert (`handleDeckTxChange` `:482-514`). The column sits
under the plan-lock wrapper (`:633-642`), so the `PlanLockScrim` blankets the
divider — resizing frozen under a live plan, acceptable.

**Where the split goes:** replace the single-panel wrapper (`:747-777`) with the
new split component. Columns 2/3 unchanged.

**`ui_design.md` tension:** "Compact wins — one list not two parallel UIs"
(`.agent/os/ui_design.md:122-125`). Satisfied in spirit by making pane 2
**opt-in and collapsed by default** — operators who don't add a second playlist
see today's single list, pixel-identical.

## Resizable split (CaptainPad)

**No new deps.** `CaptainPad/package.json:18-52` — RN 0.81.5 + react-native-web
0.21; `PanResponder` is core RN and the established convention (canonical
`CaptainPad/components/ui/HorizontalFader.tsx:65-109`). Do NOT add
gesture-handler. Offline-ready.

New file (snake_case): **`CaptainPad/components/deck/split_playlist_panes.tsx`**.
- Pane 1: `flexGrow: ratio, flexBasis: 0, minHeight: 0` wrapping `PlaylistPanel
  role="deckSlot" channelId="primary" channelLabel="DECK A"`.
- Divider: ~14pt grip row with `hitSlop` to reach 44pt (`ICON_BTN_HIT_SLOP`
  `index.tsx:42-44`), token colors only.
- Pane 2: `flexGrow: 1-ratio` wrapping `PlaylistPanel role="deckSlot"
  channelId="secondary" channelLabel="DECK B"` + header ✕ (new optional
  `onClosePane` prop, beside refresh at `PlaylistPanel.tsx:1087-1137`).

Drag = copy `HorizontalFader` idioms verbatim (`HorizontalFader.tsx:65-109`):
PanResponder built once via `useRef`, callbacks via refs (stale-closure fix
`:15-27`); `*ShouldSetPanResponderCapture: ()=>true` + `onPanResponderTermination
Request: ()=>false` so an ancestor ScrollView can't steal it (`:69-77`); grant
snapshots `startRatio`; move `next = clamp(startRatio + gs.dy/containerH)`
(height from `onLayout`); mirror `onPanResponderTerminate` → release (`:98-107`,
guards browser `pointercancel`); live-drag updates local state only, **POST ratio
on release/terminate** (one write per gesture). Suppress WS reconcile while
dragging (`draggingRef`, `:35-38`).

Clamp (bounded input validation, not a fallback): `MIN_PANE_PT = 140`; effective
ratio ∈ `[MIN/h, 1−MIN/h]`. If `h < 2·MIN` (tiny / `!isWide` stack) force render
0.5, leave stored ratio untouched; recommend raising column `minHeight` 320→480
when a secondary is assigned and `!isWide`.

Empty-secondary: pane 2 collapsed; slim `+ SECOND PLAYLIST` bar under pane 1;
tap expands an **unassigned** `PlaylistPanel` (already renders "No playlist
loaded…" `:1458-1462`); its LOAD… dropdown assigns; ✕ clears
(`setChannelPlaylist('deckSlot','secondary', null)`) — no ConfirmSheet (clearing
a slot destroys nothing).

## Engine model for two deck playlists

**Core principle: the deck still plays exactly one pattern, through existing
machinery.** `channel.playlist` (`lib/pattern_channel.js:204-207`) stays the ONE
live pointer that `loadPlaylistEntry` (`api_server.js:1439-1499`), auto-capture
(`:1296-1341`), modulation push (`:1494-1496`), and the autopilot daemon
(`:3291-3330`) all read. Unchanged.

New engine state, module-scoped next to `deckTransitionConfig` (`:992-998`),
restored from `deck_state.yaml` extras:
```js
const deckPlaylistSlots = {
  primary: null,        // string|null — pane 1 binding (by name)
  secondary: null,      // string|null — pane 2 binding (by name)
  splitRatio: 0.5,      // 0.15..0.85
  ...(deckState && deckState.playlistSlots ? deckState.playlistSlots : {}),
};
```

**Four invariants = the whole design:**
1. **Slots are stable name bindings; the live pointer moves between them.** A
   pane never rebinds because the other pane was driven.
2. **Tap = drive.** Tapping an entry in either pane calls
   `loadPlaylistEntryWithTransition(baseCh, slotName, entryId, deckTransitionConfig)`
   (`:1722`) — transition path, EBUSY/409 mid-swap (`:1739-1744`, HTTP map
   `:7502-7510`), `targetEntryId` contract (`:7487-7500`), instant fallback when
   transitions off (`:1724-1735`) all free. `loadPlaylistEntry` flips
   `channel.playlist.name/activeEntryId/cursor` (`:1468-1471`) while **preserving
   the `autopilot` block** (`:1472`, so autopilot settings incl. `profile` are
   deck-level and survive pane switches) and resetting the group window (`:1485`).
3. **Autopilot cycles the live slot.** The daemon reads `baseCh.playlist`
   (`:3294-3315`) — no code change: the autopilot target is whichever pane the
   operator last drove. Tap a slow entry → autopilot wanders the slow list; tap
   a fast entry → the fast list. Simplest concept that satisfies the vision; no
   explicit per-pane autopilot toggle (open question if operator disagrees).
4. **Primary follows any live change that isn't the secondary.** One helper at
   the two choke points where the live playlist *name* changes (instant path in
   `loadPlaylistEntry`'s deck branch near `:1494`, and the transition-completion
   bookkeeping in `loadPlaylistEntryWithTransition`'s onComplete — it duplicates
   loadPlaylistEntry's bookkeeping per the comment at `:1667-1670`):
   ```js
   function noteDeckLivePlaylist(name) {
     if (name !== deckPlaylistSlots.secondary) deckPlaylistSlots.primary = name;
   }
   ```
   Keeps timeline cues / legacy `POST /deck/playlist` meaning "set the deck's
   main playlist", makes pane 1 follow plan-driven changes, structurally
   prevents both panes binding the same name.

**Edge behaviors (no silent fallbacks):**
- Assign `secondary === primary` → **400**.
- Clear secondary while it is live → **promote**: `primary = live name`,
  `secondary = null`.
- Playlist deleted from library: mirror existing — `DELETE /playlists/:name`
  doesn't touch channel assignments (`:6800-6816`); panels react to
  `playlistDeleted` (`PlaylistPanel.tsx:634-639`), pane shows failed-load until
  re-pick/clear. No new cleanup path.
- Empty playlist assigned to secondary: allowed (mirrors `POST /deck/playlist`
  empty-entry handling `:7447-7456`); pane renders its empty state.

## Persistence (per-scene `deck_state.yaml`)

Deck-overlays precedent verbatim:
- **Write:** add to the extras passed to `saveDeckState` in `saveAllState()`
  (`:1256-1275`; `Object.assign`s extras as top-level YAML keys,
  `state_manager.js:410-426`):
  ```js
  playlistSlots: { primary, secondary, splitRatio }   // from deckPlaylistSlots
  ```
  Every `saveAllState()` call site persists slots for free.
- **Read:** `deckState = stateManager.loadDeckState()` (`:974`); seed
  `deckPlaylistSlots` beside `deckTransitionConfig` (spread-over-defaults `:992-998`).
- **Boot validation/migration** (restore block after deck rebuild, `:2148-2212`):
  `primary==null` → `primary = baseCh.playlist?.name ?? null`; `secondary` set
  but `playlistManager.load(secondary)` null → warn + clear (`:2102-2109`
  precedent); `splitRatio` non-finite / outside `[0.15,0.85]` → warn + reset 0.5
  (`:2203-2205` precedent).

## API / WS / UI contract

### Engine REST (new handlers beside the deck playlist block `:7420-7560`)

| Route | Body | Behavior |
|---|---|---|
| `GET /deck/playlist/slots` | — | `{ primary, secondary, splitRatio }` (virtual assignments, `null` when unbound) |
| `POST /deck/playlist/secondary` | `{ name\|null }` | Assign/clear pane 2. 404 unknown (`:7443-7444`); 400 if `name===primary`; **loads no pattern** (browse-only until tapped — documented asymmetry with `POST /deck/playlist`); clear-while-live promotes. Response inline `playlistData` (mirror overlay `:7169`) + a `channelPlaylistData` broadcast (channelId `'secondary'`) so the pane adopts instantly (`PlaylistPanel.tsx:589-617`); then `saveAllState()` + `broadcastDeckState()` |
| `POST /deck/playlist/entry` | `{ entryId, slot?:'primary'\|'secondary' }` | **Back-compat extended.** `slot` omitted → today's behavior (`:7467-7515`); given → 400 if slot null, else resolve slot name, route through `loadPlaylistEntryWithTransition` unchanged (same 200/409) |
| `POST /deck/playlist/split` | `{ ratio }` | 400 unless finite ∧ ∈ `[0.15,0.85]` (fail loud, no clamp-on-write); store, `saveAllState()`, `broadcastDeckState()` |
| `POST /deck/playlist` (existing) | unchanged | Add internal `noteDeckLivePlaylist(name)`; still loads first entry (pane 1 assign = activate) |

### WS — fold into `deck` message, NO new type

`serializeDeckState()` (`:2664-2691`) gains one field (like `overlays` at
`:2673-2678`):
```js
playlistSlots: {
  primary:   serializeDeckPlaylistSlot(deckPlaylistSlots.primary),
  secondary: serializeDeckPlaylistSlot(deckPlaylistSlots.secondary),
  splitRatio: deckPlaylistSlots.splitRatio,
}
```
where the **virtual assignment** reflects live-ness:
```js
function serializeDeckPlaylistSlot(slotName) {
  if (!slotName) return null;
  const live = mixer.getDeckChannel()?.playlist || null;
  const isLive = !!(live && live.name === slotName);
  return {
    name: slotName,
    activeEntryId: isLive ? live.activeEntryId : null,   // non-live pane: no highlight
    cursor: isLive ? (live.cursor || 0) : 0,
    autopilot: (live && live.autopilot) || { active:false, delay_s:30, shuffle:false },
    live: isLive,
  };
}
```
Rides `deck` → `ws_topic_routing.js` unchanged (`deck` already CONTROL `:66`;
table throws on unregistered types `:198-207` — the reason we don't add one),
connect-replay free (`:7900-7901`). Mid-transition composes with the panel's
pending-gate: during a soft swap the live pointer holds the OLD name/entry (FIX B
`:7492-7499`) so the tapped pane's virtual `activeEntryId` stays null/old and the
panel's `shouldSuppressReconcile` holds the optimistic highlight until completion
— no bounce, no new client logic.

### CaptainPad wiring

- `utils/api.ts`: extend `ChannelRole` with `'deckSlot'` (`:1526`; `channelId`
  IS the slot key `'primary'|'secondary'`). Add `deckSlot` branches to
  `fetchChannelPlaylist` (`:1530` → `GET /deck/playlist/slots`, pick `[channelId]`),
  `setChannelPlaylist` (`:1566` → primary: existing `POST /deck/playlist`;
  secondary: `POST /deck/playlist/secondary`), `setChannelPlaylistEntry` (`:1603`
  → `POST /deck/playlist/entry {entryId, slot: channelId}`, keep EBUSY/`code`).
  New `setDeckPlaylistSplit(ratio)`.
- `PlaylistPanel.tsx`: one new WS branch `role==='deckSlot'` reading
  `msg.playlistSlots?.[channelId]` — line-for-line mirror of the `deckOverlay`
  branch (`:574-588`, suppress-gate included). `channelPlaylistData` adopt path
  already matches `msg.channelId===channelId` (`:603`). Optional `onClosePane`
  prop. `handleEntryTap`'s guard `assignment.activeEntryId===entryId` (`:719`) is
  correct: non-live pane has `activeEntryId:null` so every tap fires; live pane
  no-ops the already-active row.
- `index.tsx`: new `deckSlots` state; seed via `GET /deck/playlist/slots` in
  `seed()` (`:425-474`); reconcile from `msg.playlistSlots` in `onControl` `deck`
  branch (`:319-349`); replace the single-panel block (`:747-777`) with
  `<SplitPlaylistPanes …>`; both panes `disabled={deckSwapInFlight || planGate}`,
  `locked={!!deckChannel?.locked}` as today (`:762-773`). The `role="deck"` mount
  leaves this screen but the role + routes stay (used by
  `fetchChannelPlaylist('deck','')` for group knobs `:443`, `EntryLabelEditor`,
  older clients).

## Open questions (feed the master's gate list)

1. **Pane-2 assign = browse-only** (recommended): picking a playlist for pane 2
   does NOT change what's playing; tap an entry to drive. Confirm the asymmetry,
   or make pane-1 assign also silent (behavior change to `POST /deck/playlist`)?
2. **Autopilot target = last-driven pane** (recommended, zero new controls) vs
   an explicit "AUTOPILOT: A/B" selector?
3. **Split ratio scope:** per-scene in `deck_state.yaml` = **shared across all
   connected iPads** for the scene (one drag moves everyone's divider). Want
   per-device instead? (AsyncStorage precedent `PlaylistPanel.tsx:205-219`.)
4. **Live-pane affordance:** add an explicit `· LIVE` tag in the pane header?
   (the `live` flag is serialized either way.)

## Decisions log

- **2026-07-06** — Supersedes "A·B pills, one active." The panes are two
  browsable list-views; the deck still plays one pattern via the existing swap
  path; slots are stable name bindings, the live pointer moves between them.
- **2026-07-06** — New `deckSlot` `PlaylistPanel` role (mirrors `deckOverlay`);
  no new component for the list itself. Divider via core-RN PanResponder (no new
  deps). Fold `playlistSlots` into the `deck` WS message (no new type).
- **2026-07-06** — Autopilot follows the last-driven pane (no new control).
- **2026-07-06** — Slot names + split ratio persist per-scene in
  `deck_state.yaml` extras; parameter panel untouched.

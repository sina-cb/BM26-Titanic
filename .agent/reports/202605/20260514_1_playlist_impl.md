# Playlist System Implementation — Progress Report

**Date**: 2026-05-14
**Spec**: `docs/19_playlists.md`
**Scope**: Engine + CaptainPad + Tests + Live validation against `summer_camp_dome`.

---

## Status Snapshot — complete

| Phase | Status |
|-------|--------|
| 1. `PlaylistManager` class (engine) | ✅ done |
| 2. Engine REST + WS endpoints | ✅ done |
| 3. State persistence (deck + mixer) | ✅ done |
| 4. Autopilot integration | ✅ done (playlist-only) |
| 5. CaptainPad API + UI (Deck) | ✅ done — target-channel-aware |
| 6. CaptainPad UI (Mixer per-channel) | ✅ done — per-strip playlist swap, fast-add picker |
| 7. Unit + integration tests | ✅ 8/8 unit + 11/11 e2e pass (19 total) |
| 8. Live engine + sim validation | ✅ verified end-to-end in browser |
| 9. Code simplification — "always playlist mode" | ✅ done |
| 10. "1 list to rule them all" UI refactor | ✅ done — playlist replaces all-patterns list on deck + mixer |
| 11. `design.md` reference notes | ✅ written to `.agent/00_gol/11_UI_design.md` |
| 12. Production-readiness code review | ✅ done — `saveAllState()` everywhere, `decodeURIComponent` hardened |
| 13. P0 UX feedback round (auto-save, lock, modal, cross-tab, layout) | ✅ done — see "Fourth pass" below |
| 14. Rename pattern instance from the deck's parameters card | ✅ done — debounced auto-save + native blur listener (no Enter needed) |
| 15. Lock-aware param save (skip on locked, prompt save/discard on unlock) | ✅ done — engine gates auto-capture, mixer shows three-way modal |

---

## What shipped

### `marsin_engine/lib/playlist_manager.js`
- `list`, `load`, `save`, `delete`, `generateDefault`, `generateEntryId`, `captureDefaults`, `applyEntryDefaults`, `validateName`, `patternExists`.
- Playlist files at `simulation/scenes/<scene>/playlists/*.yaml`.
- Auto-generates `default.yaml` on first boot, one entry per `patterns/*.js`.
- CPC-aware: skips shared and blocked exports on capture + apply. Triggers (kind 3) excluded.

### `marsin_engine/lib/state_manager.js`
- `mixer_state.yaml.channels[].playlist` field per channel.
- `deck_state.yaml.channel.playlist` field for the base channel.
- The legacy `patternCache` field is no longer written. Reading is tolerated for back-compat, but the value is ignored — the playlist entry's `defaults` field is the canonical per-slot store.

### `marsin_engine/lib/api_server.js`
- `loadPlaylistEntry(channel, playlistName, entryId)` compiles the pattern, swaps the handle, applies entry defaults, and lets CPC finalize. Used by all playlist-driven swaps.
- `captureActiveEntryDefaults(channel)` snapshots the live channel into the active entry's `defaults` and persists.
- `restoreChannel(saved)` reads the saved `playlist` assignment and re-applies the entry's defaults on boot.
- Endpoints (all return JSON, persist + broadcast WS state):
  - `GET /playlists`, `GET /playlists/:name`, `POST /playlists`, `DELETE /playlists/:name`
  - `GET/POST /deck/playlist`, `POST /deck/playlist/entry`, `POST /deck/playlist/capture`, `POST /deck/playlist/autopilot`
  - `GET/POST /mixer/channels/:id/playlist`, `POST /mixer/channels/:id/playlist/entry`, `POST /mixer/channels/:id/playlist/capture`
  - `POST /mixer/channels` accepts `{playlist, playlistEntryId?, ...}` so adding a new layer is one round-trip — the engine resolves the pattern from the playlist's first usable entry.
- Autopilot is playlist-driven: it cycles entries on `ch_base.playlist`, honors shuffle, and skips `_missing` entries. The previous "swap by pattern name" branch was removed per the user's "always in playlist mode" clarification.
- All state-mutating endpoints now call `saveAllState()` (mixer + deck) so the base channel's playlist round-trips reliably across restarts.

### `marsin_engine/lib/pattern_channel.js`
- `this.patternCache` field removed.
- New `this.playlist` field, nullable. The default playlist always exists in the library, so any channel that hasn't been assigned a playlist can still pick it up at runtime.

### `marsin_engine/tests/`
- `playlist_manager.test.js` — 8 unit tests (validate/save/load/generateDefault/captureDefaults/applyEntryDefaults).
- `playlist_api.test.js` — 11 e2e tests that spawn a real engine against `summer_camp_dome` and exercise the HTTP API, including the regression test "Two entries of same pattern keep independent defaults across restart".

### `CaptainPad/`
- `config.yaml` is the single source of truth for the default engine address. `api_base: "http://127.0.0.1:6968"`.
- `metro.config.js` forces `.yaml/.yml` to flow through `yaml-transformer.js` (was previously mis-classified as an asset, which is why the bundled app fell back to a stale hard-coded IP).
- `utils/api.ts` fails fast if `api_base` is missing from `config.yaml`. Removed the hard-coded fallback. Added `addMixerChannel({playlist, playlistEntryId?, ...})`, `captureMixerChannelDefaults`. Removed the now-redundant `setDeckPlaylist*`/`fetchDeckPlaylist`/`captureDeckDefaults` helpers — the panel uses `/mixer/channels/:id/playlist*` for both deck and mixer channels.
- `components/PlaylistPanel.tsx` is now a single, channel-id-driven component used by both the deck and the mixer. The deck forwards the selected TARGET CHANNEL's id; the mixer strip forwards its own id. `await getApiBaseAsync()` runs before every refresh to avoid the cold-boot AsyncStorage race.
- `app/(tabs)/index.tsx` (Deck): the playlist panel follows whichever TARGET CHANNEL is selected (deck main or any mixer layer). Header reflects "DECK MAIN · PLAYLIST" or "MIXER CH N · PLAYLIST" with the active playlist's name.
- `app/(tabs)/mixer.tsx`:
  - "+ DEFAULT" button: one-tap layer-add with the `default` playlist pre-loaded.
  - "+ FROM PLAYLIST…" button: opens a fast picker over all playlists in the library; one tap creates the layer with that playlist loaded and pattern set to the first usable entry.
  - Each channel strip now embeds the playlist panel in compact mode so the user can swap playlists and step entries directly on the strip.

---

## Live validation evidence

All the following were exercised against `summer_camp_dome` with the simulation rendering on port 6969 and the engine on port 6968:

1. Engine boot — auto-generated `default.yaml` with one entry per `patterns/*.js`. `GET /playlists` → `["default"]`.
2. CaptainPad web bundle now boots straight against the YAML-configured `http://127.0.0.1:6968` — no `localStorage` workarounds. Verified the bundled `entry-*.js` no longer contains the old remote IP.
3. **Deck flow** (browser): Deck panel header "DECK MAIN · PLAYLIST" → tapped LOAD → "default" → entries listed → tapped a non-active entry → active row updates, Pattern Queue highlights the new pattern, Target Channel pill shows the new pattern, previous entry's row gains a "• N defaults" badge (auto-capture on entry switch).
4. **Mixer flow** (browser): "+ DEFAULT" added a new layer with `default` playlist and `00_golden_hour_wash` active. "+ FROM PLAYLIST…" picker listed `default` + a `sunset_show` playlist created via API; tapping `sunset_show` created a new layer named `sunset_show` rendering `08_ocean_liner` (visible as green pixels in the master strip).
5. **Per-strip playlist swap**: tapped the compact strip's "sunset_show ▾" → library opened → tapped `default` → strip switched playlist + pattern in place. The TARGET CHANNEL pill on the Deck tab also reflected the swap.
6. **Persistence across restart**: assigned `default` to `ch_base` via API, killed the engine, restarted with `--pattern 13_sparkle`. After boot, `ch_base.playlist` and `ch_base.pattern` both reflect the playlist's active entry (`00_golden_hour_wash`) — the playlist defaults win over the CLI pattern argument. Same for arbitrary mixer channels.
7. **Regression test**: two playlist entries that share a pattern keep independent captured defaults across an engine restart (`playlist_api.test.js` covers this end-to-end).

---

## Simplifications applied (per user feedback)

> "we are always in playlist mode, there's no no-playlist mode. to clarify so you can simplify the code when possible — simplicity of the code is the most importance!!!"

- Dropped the entire `patternCache` system: `applyPatternCache`, `updatePatternCache`, the per-channel `patternCache` field, the per-channel `patternCache` save key, the legacy `applyPatternCache` callers in `/upload-pattern`, `/pattern`, `/mixer/channels`, and the WS handlers.
- Dropped the autopilot's legacy "cycle by pattern name" branch — the daemon now cycles `ch_base.playlist` entries only. If the deck has no playlist loaded, autopilot is a no-op until one is loaded.
- Consolidated `/deck/playlist*` and `/mixer/channels/:id/playlist*` on the CaptainPad side — `PlaylistPanel` always uses the mixer-channel endpoints (deck base channel is just another mixer channel).
- The user-visible result: the playlist system is the only knob; everything else is just a thin layer on top.

### Second pass — "1 list to rule them all" UI refactor

> "in the mixer/deck please only add a very compact UI element to choose a playlist and use the existing list of patterns in the channel (and add compact UI elements +/-) to add or remove or save the playlists to the active playlists. 1 list to rule them all kinda idea."

- Deck: removed the standalone "Pattern Queue" all-patterns column. The left pane is now `[TARGET CHANNEL pills] → [PlaylistPanel] → [RIG GLOBALS]`. The PlaylistPanel IS the pattern list — its rows are the active playlist's entries for whichever target channel the user picked.
- Mixer strip: removed the parallel "PATTERN" all-patterns column inside each strip. The left half of each strip is now a compact `PlaylistPanel`. The right half is exports + mute/solo + transition. Adding a pattern uses the `+` button, which opens a quick picker of every pattern in `patterns/`.
- `PlaylistPanel` flex-fills in deck mode (so the list scrolls inside its allotted space) and self-sizes to 200px in compact mode (so it slots neatly into a strip).
- Stale styles (`patternListHeader`, `patternRow`, `patternRowActive`, `patternNumber`, `patternName`) removed from `mixer.tsx`. `handlePatternSelect` and the parent's `patterns` state were dropped because the PlaylistPanel fetches its own pattern library for the "+" modal.
- Header is one compact row: `[label?] [playlist ▾] [+] [SAVE]`. Each entry row is `[##] [label / pattern + def count] [−]`. Active row is highlighted with the primary color.

### Third pass — production-readiness code review

- All state-mutating handlers in `api_server.js` now call the shared `saveAllState()` helper instead of `stateManager.saveMixerState(mixer)`. The base channel is filtered out of `saveMixerState`, so the old pattern silently dropped saves whenever the deck changed. After the change, both `mixer_state.yaml` and `deck_state.yaml` are kept in sync on every mutation, regardless of which channel was touched.
- Hardened both `GET /playlists/:name` and `DELETE /playlists/:name`: `decodeURIComponent` is now inside the `try/catch` so a malformed URI escape returns a clean 400 instead of crashing the request callback.
- `PlaylistPanel` no longer needs an `allowEdit` knob — every consumer wanted full edit. Dropped the prop and simplified the call sites.
- Verified 8/8 unit tests + 11/11 integration tests still pass on the simplified code path.

### Fourth pass — P0 UX feedback (this turn)

User reported eight P0 bugs/asks during live testing on iPad-sized UI. All addressed:

1. **Layer UI density / list dominance** — `PlaylistPanel`'s list now `flex: 1, minHeight: 0`, so it fills the strip vertically even with only a handful of entries. Compact-mode `indexWidth` is `16px` so the leading `01`/`02` indices stop competing with the entry label for room. Mixer strip body splits `60/40` (playlist/params); mute/solo and transition controls were pulled out of the params column into full-width rows at the bottom of the strip so they're easy to thumb-tap on iPad.

2. **Playlist name truncation** — the header is now two rows:
   - Row 1: section label (e.g. `CH 1 · PLAYLIST`) and the saved-toast slot.
   - Row 2: `[playlist ▾ — full row width]` `[+]`.
   The `SAVE` button is gone because every mutation auto-persists (see #5). The dropdown shrinks the `+` button to a single 22-px square so the playlist name has the whole row to breathe.

3. **Lock safety** — when `locked` is true, the panel:
   - Hides every `+` and `−` button.
   - Replaces the playlist-picker dropdown with a static amber-tinted `name (locked)` label.
   - Still lets the operator tap entry rows so the show can be performed.
   The lock state comes from the channel itself; the deck forwards the target channel's lock flag.

4. **New pattern not running until save** — solved by removing the manual save step entirely. `handleAddPattern` and `handleRemoveEntry` now call `savePlaylist({...})` immediately and `flashSaved()` shows a 1.4 s `✓ SAVED` toast in the header. The user no longer has to think about save state.

5. **Parameter auto-save** — added a debounced per-channel `scheduleEntryCapture(channelId)` in the engine. Every `/control`, `/mixer/channels/:id/control`, and the WS `setControl`/`setChannelControl` paths schedule a 500 ms timer; if no further changes come in, the timer fires and writes the current channel exports into the active playlist entry's `defaults` block. The engine broadcasts `playlistEntryCaptured` over WS; the panel flashes the same `✓ SAVED` toast. Two rapid slider drags collapse to a single disk write. Switching to a different entry mid-debounce cancels the timer to prevent stale captures clobbering the new entry.

6. **New-playlist modal dismiss bug on iPad** — the old `Pressable` backdrop dismissed on every tap, including inside the textbox. Refactored both modals (`LibraryModal`, `AddPatternModal`) into a `TouchableOpacity` backdrop wrapping a `TouchableOpacity` content card with a no-op `onPress`. The card swallows taps; the backdrop dismisses everything else. Verified in the browser: typing `tour_v2` into the textbox keeps the modal open and the NEW button works.

7. **Param count label** — `N def` → `N param` (singular) / `N params` (plural). Visible in the entry's secondary line, e.g. `13_sparkle · 6 params`.

8. **Cross-tab consistency** — new `utils/engineEvents.ts` global pub/sub bus. Both the deck and mixer WS `onmessage` handlers do `engineEvents.emit(parsed)` for every message. The `PlaylistPanel` subscribes once on mount and reacts to:
   - `mixer` — detects when our channel's playlist assignment changed (other tab swapped or autopilot stepped) and refreshes.
   - `playlistLibrary` — playlist list of names changed (create/delete).
   - `playlistSaved` — full playlist content changed; if it's the one we're showing, swap in the new data and flash the toast.
   - `playlistDeleted` — if the loaded playlist is gone, refresh to reset to "no playlist".
   - `playlistEntryCaptured` — engine-driven auto-capture; flash toast + refresh defaults.
   Plus `useFocusEffect(refresh)` so switching tabs always pulls the latest state on entry. The mixer state broadcast now includes `playlist: c.playlist || null` per channel so subscribers can actually detect cross-tab swaps — this was the missing piece that initially made the mixer ignore deck-driven entry changes.

#### Vertical-stacking ideas for params (per user request — no code change)

User asked for ideas on putting params *under* the playlist list so the list can use the full column width, while still fitting 3 strips side-by-side on iPad. The constraints are real: a sparkle pattern has 6 controls and an HSV picker is ~120 px tall, so a naive stack triples the strip height. Recommended approaches, in order of how production-friendly they are:

1. **Two flex regions, independent scroll (recommended).** Strip body becomes one column. Top half (60 %) is the playlist `ScrollView`. Bottom half (40 %) is the params `ScrollView`. Both scroll independently inside their own region. Strip height is fixed by the row container (e.g. 70 vh on iPad). No layout jump when entry count or param count changes — only the inner scroll content shifts. This is what most production DAWs (Live, Bitwig, Resolume) do.

2. **Collapsible params drawer.** Default state shows just the playlist filling the strip. A small `PARAMS ▾` pill near the bottom expands a fixed-height (e.g. 220 px) bottom drawer with the active entry's params. The strip never grows; the drawer slides up over the bottom of the list. Trade-off: the user has to tap to see params, which is an extra action during a show.

3. **Param row dropdowns inline with the entry.** Each playlist row gets a chevron; tapping it expands the row to show that entry's params inline. Pro: zero-step access. Con: shifts the rest of the list when expanded, which is exactly what the user wants to avoid.

The first option is the right default for the iPad target. It only requires turning the current side-by-side `View` into a column and giving each child `flex: 1` with its own `ScrollView`. I have not made this change yet because it interacts with the rest of the strip layout (mute/solo/transition row, level meter) and I want a tighter sketch from the user before I rearrange it.

---

## P0 fix — Mixer master output visualization

Reported: the mixer's `MASTER OUTPUT` strip rendered nearly black/dim brown while the deck looked fine.

Root cause was in `engine.js`: every frame, after the mixer produced `outputBuffer`, the engine wrote those pixels into `model.pixels[]` and then applied `globalEffectsController.applyPixels()` and `intensityController.apply()`. The intensity controller multiplies each pixel by the section dimmer for that pixel's `sId`. The test_bench `globals_state.yaml` has those dimmers set to `0.098 / 0.219 / 0.214`, so the post-processed pixels are ~10–22 % of the source. The engine then captured the broadcast `master` vis *from those dimmed pixels* (`trueMasterBuffer`), overwriting the bright pre-dimmer master that `pattern_mixer.js` had just produced. The deck shows `ch_base`'s per-channel vis, which is captured inside the mixer *before* engine post-processing, which is why it stayed bright.

Fix: stop overwriting `master`. The pre-dimmer master from `pattern_mixer._visData['master']` is now broadcast as-is, and the post-processed (post-dimmer/blackout/global FX) buffer is broadcast under a new key, `rig`, for anyone who wants the hardware-truth preview. The sACN output path is unchanged.

Verified live:

```
ch_base                      avg=  49   0   0 WAU= 118  99   0
ch_1778781299151             avg=  49   0   0 WAU= 118  99   0
master                       avg=  49   0   0 WAU= 118  99   0   ← matches the active overlay
rig                          avg=   6   0   0 WAU=  15  13   0   ← what sACN actually carries
```

The mixer's `MASTER OUTPUT` strip now renders a vibrant amber/tan band that matches the deck's preview, instead of the dim brown/black gradient from before.

Single file touched: `marsin_engine/engine.js` (vis broadcast block). No client-side change needed — the mixer already reads `visDataRef.current['master']` and the deck reads the channel's own vis.

---

## Rename pattern instance — Deck parameters card

User asked: "how can I rename the patterns? in the deck tab, when I click a pattern, in the parameters card, can you allow me to rename the pattern instance?" followed by: "make the rename op save automatically without me pressing enter, instead it should save on leaving the textbox (again keep ipad as first class user in mind)".

### What ships

`CaptainPad/components/EntryLabelEditor.tsx` (new component) replaces the static channel-title text at the top of the Deck's parameters card with an inline editor for the *currently active playlist entry's* `label` field. Locked channels still render as static text (no input, no edit), matching the same lock semantics as the rest of the playlist UI.

The persistence model leverages the existing `POST /playlists` endpoint — renaming is just updating `entries[i].label` and saving the whole entries array. The engine validates the payload, writes the YAML, and broadcasts `playlistSaved` over WebSocket. Because `PlaylistPanel` already subscribes to `playlistSaved` via the `engineEvents` bus, the rename shows up across the Deck and Mixer tabs immediately and triggers the existing `✓ SAVED` toast in the panel header for free — no separate UI plumbing was needed.

### Auto-save without pressing Enter (the iPad story)

`onEndEditing` and `onBlur` props on react-native-web's `TextInput` are unreliable in Expo Web — they do not fire on tap-away or Tab. Verified empirically: only `onSubmitEditing` (Enter) fired the prop-level handler in our test environment. To deliver the "save when you leave the textbox, no Enter required" behavior the user asked for, the editor uses three layered save paths, in firing order:

1. **Debounced commit (~500 ms after the last keystroke).** Primary path. Every `onChangeText` resets a 500 ms timer; when it expires, the editor commits silently. This means the rename is durable while the user is still typing — they never have to think about saving, and "leaving the textbox" becomes a non-event because the save already happened.
2. **Native DOM `blur` listener (web) / `onBlur` prop (native).** Safety net. On web we attach the listener directly to the underlying `<input>` element via the TextInput ref, since the react-native-web prop is flaky. The listener flushes any pending debounce immediately on focus loss, so even if the user types one character and taps away within 500 ms, the rename still saves.
3. **`onSubmitEditing` (Enter key + `blurOnSubmit`).** For hardware-keyboard users. Also dismisses the iPad on-screen keyboard cleanly.

Plus an unmount-time flush in a `useEffect` cleanup so a half-typed name is never lost when the user switches tabs mid-edit.

The component pins the `editingEntryIdRef` to whichever entry was active when the user *started* typing, not whatever happens to be active when the timer fires. That defends against the racy case where autopilot or a sibling tab swaps the active entry while the user is typing.

### Wiring

`app/(tabs)/index.tsx` replaces this:

```tsx
<Text style={...}>{channelTitle}: {channel.name || channel.pattern}</Text>
```

with:

```tsx
<EntryLabelEditor channelId={channel.id} channelLabel={channelTitle} locked={!!channel.locked} />
```

No changes were needed to the engine — every renaming round-trip goes through the existing `POST /playlists` validator, the existing `playlistSaved` broadcast, and the existing `engineEvents` subscription on the panel side.

### Live validation

- Type "Debounced Save" into the textbox without pressing Enter or clicking away. After ~500 ms, `curl http://127.0.0.1:6968/playlists/default | jq '.entries[2].label'` returned `"Debounced Save"` — the debounce timer wrote the rename while the textbox was still focused.
- Type more text ("Plus More") and immediately click on a different control. `curl` returned `"Debounced Save Plus More"` — the native blur listener flushed the in-flight debounce on focus loss.
- The `PlaylistPanel` on the same page flashed its `✓ SAVED` toast both times, confirming the cross-tab broadcast pipeline is live.
- Locked channel: navigating to a `locked: true` mixer channel renders the label as a non-editable `Text` block with a "· (locked)" suffix, matching the surrounding lock semantics.

### Error handling

If the engine rejects the save (HTTP error or validation failure), the editor:

1. Shows a generic `Alert.alert('Rename failed', 'Could not save the new name. Try again.')`. The detailed server error is intentionally not echoed to the client to avoid leaking server internals (per the workspace's error-handling rules).
2. Calls `refresh()` to roll the optimistic state back to the engine's canonical playlist.

### Files touched in this pass

- `CaptainPad/components/EntryLabelEditor.tsx` (new — debounced editor with native blur fallback)
- `CaptainPad/app/(tabs)/index.tsx` (parameters card title replaced with `<EntryLabelEditor>`)

---

## Lock-aware param save — engine + mixer modal

A locked channel must not let the playlist on disk drift behind the operator's
back. The auto-save was already debounced; what was missing was the lock check
and a way to surface unsaved in-memory edits when the user later unlocks.

**Engine side** (`marsin_engine/lib/api_server.js`)
- `scheduleEntryCapture(channelId)` short-circuits when the channel is
  locked, both at schedule time and (defensively) inside the timer callback.
  In-memory params still flow through the WASM handle so live tweaks during
  a show keep working; only the on-disk capture is skipped.
- The `PATCH /mixer/channels/:id` lock handler cancels any pending timer the
  instant lock engages, so a debounce that armed pre-lock can't fire
  post-lock and silently overwrite the saved defaults.
- Dirty tracking is an **explicit, intent-driven flag** (`channel._dirty`)
  rather than a value diff. Rationale: a diff against `entry.defaults`
  either ignores edits on freshly-added entries (defaults `{}` = "no
  opinion") or chases phantom diffs when pattern exports shift. The flag
  has a clean lifecycle:
  - Set to `true` by `markChannelDirtyIfLocked(channelId)`, called from
    every control-change path (`POST /control`, `POST /mixer/channels/:id/control`,
    WS `setControl`, WS `setChannelControl`) — only flips when the channel
    is currently locked.
  - Cleared by `clearChannelDirty(channel)` on lock toggle (either direction),
    on `playlist/capture`, on `playlist/discard`, and on `loadPlaylistEntry`
    (entry swap). The new entry's defaults become the canonical reference.
- `serializeMixerState()` exposes `dirty: !!c._dirty` per channel, so
  every `mixer` broadcast carries the flag.
- New endpoint `POST /mixer/channels/:id/playlist/discard` reverts in-memory
  edits to the saved entry's defaults: clears `localControls`, re-runs
  `applyEntryDefaults`, then `finalizeCpcValues`. Also cancels any pending
  auto-capture and clears the dirty flag — discard is an explicit "throw
  away my edits" action.
- `/playlist/capture` (existing) is the save path; now also clears the
  dirty flag and broadcasts mixer state so all clients see `dirty=false`.

**Client side** (`CaptainPad/app/(tabs)/mixer.tsx`, `CaptainPad/utils/api.ts`)
- New `discardMixerChannelDefaults(channelId)` helper paired with the
  existing `captureMixerChannelDefaults`.
- `handleLockToggle` splits into two paths: locking is immediate; unlocking
  inspects the channel's `dirty` flag from the latest broadcast. If clean,
  the lock releases normally. If dirty, a modal opens before the lock toggle
  reaches the engine.
- The modal offers three choices:
  - **SAVE TO PLAYLIST** → `captureMixerChannelDefaults` → unlock.
  - **DISCARD CHANGES** → `discardMixerChannelDefaults` → unlock.
  - **KEEP LOCKED** → close modal, channel stays locked.
  Tapping the modal backdrop is also "keep locked". The buttons disable
  while the network call is in flight; a failure keeps the lock on so the
  operator can retry without losing live state.

**Live validation** (engine on `127.0.0.1:6968`, browser on `:6967`, mixer
channel `ch_1778782271833` aka "Test Layer", playlist `test`):
- Locked + control change → `disk sliderNoiseScale=0.78` stayed; `live=0.13`,
  engine reports `locked=true dirty=true`.
- Modal pops on lock-icon tap, shows "Test Layer was edited while locked".
- DISCARD path → live snaps back to 0.78, lock releases, `dirty=false`.
- SAVE path (re-locked then changed live to 0.55) → disk captured to 0.55,
  lock releases, `dirty=false`. Non-active entry left untouched at 0.77.
- KEEP LOCKED path (re-locked then changed live to 0.31) → modal dismisses,
  channel remains `locked=true dirty=true`, live still 0.31, disk still 0.55.
- Edge case (entry with empty `defaults`) → locked edit still flips
  `dirty=true` correctly. The explicit flag captures intent regardless of
  whether the saved entry has accumulated any state yet.

---

## Live validation evidence — Fourth pass

- All 19 engine tests pass (`node --test tests/playlist_manager.test.js tests/playlist_api.test.js` → 8 unit + 11 e2e). Includes the regression "Two entries of same pattern keep independent defaults across restart" which directly covers user feedback #4.
- Browser walkthrough on `http://localhost:6967/`:
  - Deck panel header shows the target channel's playlist with a 2-row layout and full-row dropdown.
  - Tapping `MIXER CH 1` swaps the deck panel to show that channel's `my_show` playlist.
  - Tapping `02 Golden` in the deck switches the mixer channel's pattern (verified via the global gradient strip going from sparkle red → golden tones), and navigating to the Mixer tab immediately shows `02 Golden` as the active row — no manual refresh.
  - Locking the mixer channel hides every `+`/`−` and freezes the dropdown into a `my_show (locked)` label.
  - Opening the library modal and typing `tour_v2` in the textbox keeps the modal open; NEW creates the playlist and loads it into the strip.
  - Posting two rapid `POST /mixer/channels/:id/control` to the same export then waiting 700 ms shows the playlist YAML on disk now carries the latest value for the active entry only (`sliderBackgroundFade: 0.77`), with the duplicate `Sparkle Y` keeping its own `0.11`. Switching back restores the original v0 in the engine snapshot.
- No new linter errors across the touched files.

---

## Files touched

- `marsin_engine/engine.js` (master vis now broadcasts the pre-dimmer composition; post-processed sACN-equivalent stream broadcast separately as `rig`)
- `marsin_engine/lib/playlist_manager.js` (new)
- `marsin_engine/lib/api_server.js` (heavy edits: playlist endpoints, simplification, `saveAllState` plumbing, hardened URI decoding, debounced auto-capture, `playlistSaved`/`playlistDeleted` broadcasts, `playlist` field in serialized mixer state, `dirty` flag broadcast, lock-aware capture gating, `POST /mixer/channels/:id/playlist/discard` endpoint)
- `marsin_engine/lib/state_manager.js` (drop `patternCache`)
- `marsin_engine/lib/pattern_channel.js` (drop `patternCache`, add `playlist`)
- `marsin_engine/tests/playlist_manager.test.js` (new)
- `marsin_engine/tests/playlist_api.test.js` (new — 11 tests including the cross-entry regression)
- `CaptainPad/components/PlaylistPanel.tsx` (rewritten — channel-id driven, "1 list to rule them all", 2-row header, auto-save toast, lock-aware controls, modal backdrop fix, `engineEvents` subscriber, `useFocusEffect` refresh, "N params" labels)
- `CaptainPad/components/EntryLabelEditor.tsx` (new — inline rename for the active playlist entry's `label`; debounced auto-save + native DOM blur listener, no Enter required)
- `CaptainPad/utils/engineEvents.ts` (new — tiny pub/sub bus for engine WS messages)
- `CaptainPad/app/(tabs)/index.tsx` (deck panel follows target channel; old "Pattern Queue" all-patterns list removed; WS handler emits to `engineEvents` bus; forwards target lock state; parameters card title now uses `<EntryLabelEditor>` so the user can rename the active playlist entry inline)
- `CaptainPad/app/(tabs)/mixer.tsx` ("+ DEFAULT", "+ FROM PLAYLIST…", per-strip panel; 60/40 body split; mute/solo + transition pulled into full-width rows below the body; WS handler emits to `engineEvents` bus; forwards channel lock state; unlock-dirty three-way prompt (SAVE / DISCARD / KEEP LOCKED) intercepts dirty unlocks)
- `CaptainPad/utils/api.ts` (channel-driven helpers, dropped deck-specific ones, fail-fast YAML; `discardMixerChannelDefaults` helper for the dirty-unlock revert path)
- `CaptainPad/app/(tabs)/config.tsx` (uses `getDefaultApiBase()`)
- `CaptainPad/config.yaml` (`api_base: http://127.0.0.1:6968`)
- `CaptainPad/metro.config.js` (yaml/yml routed through transformer, not assets)
- `.agent/00_gol/11_UI_design.md` (new — Google Stitch `design.md` reference notes; read-only, no fork/clone)

No git operations were performed against the repo by the agent. The user stages
and commits at their discretion.

---

## Final status & deep code review

All 15 phases of the plan are complete and verified live. Engine, web UI,
state persistence, autopilot, and the lock-aware param save flow all behave
as specified.

**Reviewed surfaces (pass)**

- `marsin_engine/lib/playlist_manager.js` — single-purpose YAML store with
  defensive validation (`validateName`, `patternExists`, name collision
  rejection, missing-pattern flag-not-fail). CPC-aware capture and apply
  skip shared/blocked exports and triggers. No file I/O outside
  `playlistsDir`; no user-controlled paths leak through.
- `marsin_engine/lib/api_server.js` — every state-mutating endpoint calls
  `saveAllState()` + `broadcastMixerState()`, so deck + mixer YAML stay
  in sync regardless of which channel was touched. `decodeURIComponent` is
  inside the route's `try/catch` so a malformed URI returns 400, not a
  crash. Pending capture timers are cancelled on lock, entry swap, and
  discard so a stale debounce can never clobber the saved defaults.
  `markChannelDirtyIfLocked` / `clearChannelDirty` give the `_dirty` flag
  a tight, intent-driven lifecycle. No PII / secret logging — `console.warn`
  surfaces only `e.message` from controlled engine paths.
- `CaptainPad/components/PlaylistPanel.tsx` — single channel-id-driven
  component; lock state hides every destructive control and freezes the
  dropdown into a non-interactive label. `engineEvents` subscription
  reacts to all five playlist-related WS messages so cross-tab state stays
  consistent without polling. `useFocusEffect` covers the focus-back case.
- `CaptainPad/components/EntryLabelEditor.tsx` — three-layered save path
  (500 ms debounce + native DOM blur listener + Enter) plus unmount-flush.
  `editingEntryIdRef` pinning prevents autopilot from racing the in-flight
  rename. Locked channels render as static text. Server errors surface a
  generic `Alert` (no internal details leaked, per the workspace error
  rule); the panel rolls back optimistically via `refresh()`.
- `CaptainPad/app/(tabs)/mixer.tsx` — `handleLockToggle` splits cleanly
  into immediate-lock and dirty-aware-unlock paths. The unlock modal's
  three buttons (SAVE / DISCARD / KEEP LOCKED) disable in-flight and
  surface failures by keeping the lock engaged so the operator can retry
  without losing live state. Backdrop tap is mapped to KEEP LOCKED.
  Backdrop dismiss uses the `TouchableOpacity` (backdrop) wrapping
  `TouchableOpacity` (card) pattern that we verified end-to-end on Expo
  Web after the prior `Pressable` regression.
- `CaptainPad/utils/api.ts` — fails fast if `api_base` is missing from
  `config.yaml` (no silent fallback to a stale hard-coded IP). Each API
  helper returns the same `{ ok, data, error }` envelope so call sites
  can branch uniformly.
- Tests — 19/19 pass including the cross-restart regression that two
  entries sharing a pattern keep independent defaults.
- Lint — no new warnings or errors across all touched files.

**Workspace security rules audit**

- *Logging*: no PII, credentials, tokens, or full request bodies are
  logged. Engine warnings echo only sanitized engine-side error
  messages (e.g. "channel not found"). Client `console.warn` for failed
  unlock-dirty resolves echoes the engine's controlled error string only.
- *SSRF / LFI*: no outbound HTTP from user-controlled URLs. Playlist file
  paths are constrained to `simulation/scenes/<scene>/playlists/` and the
  name is validated by `validateName` (alphanumeric, dashes, underscores
  only — no `..`, no slashes).
- *Path traversal*: `playlistManager.load` joins the validated name onto
  the playlists dir; the validator rejects any name that doesn't match
  `/^[a-zA-Z0-9_-]+$/`. Pattern names go through `path.basename` before
  filesystem lookups.
- *XSS / CSRF*: the engine runs only on `127.0.0.1` per the YAML config
  and is meant for local-operator use; the web UI uses React Native /
  React Native Web which auto-escapes all text rendering and never uses
  `dangerouslySetInnerHTML`. No new HTML emission in this change.
- *Auth*: consistent with the rest of the codebase — single-operator
  local control surface, no auth layer needed for the local API.
  No new endpoints expose privileged operations beyond what the existing
  surface already does.
- *SQL*: no SQL anywhere; storage is YAML on disk.

**Behavioural verification (one final pass — `127.0.0.1:6968`)**

- `GET /playlists` → `["default", "my_show", "sunset_show", "test", "tour_v2"]` (from prior tests).
- Lock + change live slider on `ch_1778782271833` → broadcast carries
  `locked=true dirty=true`. Disk untouched.
- DISCARD → `live` snaps to saved `defaults`, `dirty=false`, `locked=false`.
- SAVE → disk now matches live, `dirty=false`, `locked=false`.
- KEEP LOCKED → modal closes, channel stays `locked=true dirty=true`,
  live edits preserved in memory.
- Restart → playlist assignment + defaults survive, `_dirty` resets
  (correctly — it's an in-memory operator-intent flag, not durable state).

The system is ready for production use.

---

## How to launch the stack

Three terminals, each in the workspace root:

```bash
# 1) Pixel simulator (renders sACN output → web preview on :6969)
cd simulation
PYTHONPATH=. ../.venv-dev/bin/python -m companions.bridge_companion --bus serial -v

# 2) MarsinEngine (HTTP/WS API on 127.0.0.1:6968, sACN out on :5568)
cd marsin_engine
node engine.js --pattern 00_golden_hour_wash --model summer_camp_dome

# 3) CaptainPad webUI (Expo dev server on :6967)
cd CaptainPad
npm start
```

Then open `http://localhost:6967/` for the deck and `http://localhost:6967/mixer` for the mixer. Both tabs talk to the engine over WebSocket and stay in lockstep automatically.

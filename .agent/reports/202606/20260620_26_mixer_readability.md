# Slot 26 — mixer_readability

- **Branch:** dev/mixer_readability
- **Parent branch:** deliverable tip (multi-agent worktree base)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/mixer_readability
- **Slot ports:** static dist serve 6967 (build proof only); no engine/sim brought up

## Scope

Operator complaint: "the mixer UI is so cramped and the pattern names can't be
read." In a compact mixer channel-strip the playlist entry row laid every
control out on one horizontal line (index badge · reorder chevrons · name
`flex:1` · H · L · remove), so the name column collapsed to ~60pt and long
pattern/entry names like `trans_crossfade` / `02_phase_cathedral` truncated to
`tran…` / `0…`. This slice fixes the truncation, layout-only, fully contained in
`CaptainPad/components/PlaylistPanel.tsx` (the file this agent owns). No change to
`mixer.tsx` (strip width / 60-40 split is owned by another agent).

## The fix

1. **2-line entry row.** The row `<View>` is now `flexDirection: 'column'`.
   - **Line 1** = index badge + the name `<TouchableOpacity flex:1>`. The name now
     gets the full strip width (~60pt → ~150pt+) with NO strip-width change.
     `numberOfLines` raised 1 → 2; `ellipsizeMode="middle"` added to both the
     primary name and the secondary (pattern · params) line so the distinctive
     prefix+suffix survive any residual truncation.
   - **Line 2** = a compact control sub-row (reorder chevrons pushed left via
     `marginRight:'auto'`; H / L toggles + remove `−` right-aligned via the row's
     `justifyContent:'flex-end'`). Only rendered when `editable && !(role==='deck'
     && playlistEditsLocked)` — i.e. read-only / show-mode rows stay single line.
2. **Compact font bump** `fontPrimary` 12 → 13 (the regular path was already 13;
   now both are 13).
3. Preserved: active-row white-on-primary styling, editable/lock guards,
   `handleEntryTap` / `handleMoveEntry` / `handleToggleEntryFlag` /
   `requestRemoveEntry` handlers and their `accessibilityLabel`s, ≥44pt touch
   targets (chevron hitSlop widened to 8/8/6/6 now that they no longer share a
   12pt-tall split cell; H/L/remove hitSlop unchanged), and the
   reconcile/pending-gate React structure. Deck-vs-mixer role rendering and the
   swap/tags/hold-loop affordances elsewhere in the file are untouched.

## Files changed

```
M  CaptainPad/components/PlaylistPanel.tsx   (+73 / -54)
```

## Tests run

- `git diff --check -- CaptainPad`: clean (exit 0, no whitespace errors).
- `npx tsc --noEmit`: **exit 0**.
- `npm run lint`: **exit 0** — 0 errors, 11 warnings, all pre-existing
  (`react-hooks/exhaustive-deps` across config/mixer/studio/faders, the
  monitor unused-import, and the pre-existing PlaylistPanel:530 `clearPending`
  dep warning). NO new warnings introduced by this slice.
- `npm run web:build`: **exit 0**, `Exported: dist`, **21 static routes**
  (incl. `/mixer`). The build-time `ECONNREFUSED :6968` line is the offline
  engine probe, not a build failure.
- **CaptainPad render proof:** served `dist` on :6967 and drove puppeteer
  (xvfb, from `simulation/`'s install) to `/mixer`. Screenshot saved to
  `.agent_renders/20260620_mixer_readability.png`. The route renders cleanly
  (header, global params, master output). It shows "NO CHANNELS" because the
  page is OFFLINE (no engine running), so the channel-strip `PlaylistPanel`
  rows are not instantiated and cannot be photographed without the full
  engine stack. The image therefore proves the build + route load; the
  entry-row 2-line layout is verified by structural assertion below.

### Structural assertion (the changed rows)

- Row `<View>`: `flexDirection:'column'`, `gap:2` (was `'row'`).
- Line 1 `<View row>`: index `<Text width:sz.indexWidth>` + name
  `<TouchableOpacity flex:1 onPress=handleEntryTap>`; name `<Text>`
  `fontSize:sz.fontPrimary` (compact now 13), `numberOfLines={2}`,
  `ellipsizeMode="middle"`. Secondary `<Text numberOfLines={1}
  ellipsizeMode="middle">`.
- Line 2 `<View row justifyContent:'flex-end'>` guarded by `editable && !(role
  === 'deck' && playlistEditsLocked)`: chevron sub-`<View marginRight:'auto'>`
  then H, L, remove `−`, all with original handlers + hitSlop.

## Known gaps / follow-ups

- **For the `mixer.tsx` owner (NOT touched here):** the strip width / 60-40
  split lives in `mixer.tsx`. The 2-line row already fixes legibility with no
  width change, but if the operator still wants wider strips, a small bump to
  the channel-strip width there would give line-1 names even more room. Filed
  as a suggestion only; do not block this slice on it.
- No engine/sim stack was stood up, so the entry rows were not exercised with
  live playlists; verification is build + structural. Bringing up the full
  smoke chain (sim → engine → CaptainPad) per
  `.agent/01_skills/05_full_stack_smoke.md` would allow a photographed
  before/after of legible names.

## Operator action requested

Ready for review and merge.

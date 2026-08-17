# 54. Deck UI restyle — migrating the Deck tab to the new visual style

**Status:** DESIGN — ready for implementation slices ·
**Author:** agent _209 (Fable, design) · **Operator:** Sina Solaimanpour ·
**Basis:** operator brief ("design the deck UI migration to the new style as
it's not changed when I look at it").

This is a **reskin, not a rework**. Every behavior, gesture, engine route,
reconcile path, plan-lock rule, and layout decision recorded in the Deck's
comment blocks is preserved verbatim. What changes is paint: surfaces,
borders, radii, typography discipline, chip/button language, and the
retirement of scattered hex literals in favor of tokens.

Related: `docs/53_deck_workspace_windows.md` (the workspace this restyle
lands ON TOP of — agent _208 is implementing it now),
`docs/52_special_events_tab.md` (the Events tab that must share this
vocabulary), `docs/ui/touch_control.html` + `docs/ui/touch_control_theme.js`
(Live Touch), `docs/ui/color_palette_prototype.html` (the approved COLORS
prototype), `.agent/os/ui_design.md` (the design-token file format we adopt),
`.agent/reports/202608/20260806_190_captainpad_param_row.md` (the _190 param
rows — already the new style; the reference point).

---

## 1. What "the new style" canonically IS

Four modern surfaces were studied. They agree on a grammar, and one of them
already rules on the color question.

**The ruling exists in code.** `docs/ui/touch_control_theme.js` is the theme
bridge: when Live Touch runs embedded in CaptainPad, **CaptainPad's palette
tokens overwrite Live Touch's CSS variables** (`CSS_TOKEN_MAP`:
`background→--bg`, `surfaceContainerHigh→--panel`, `ghostBorder→--border`,
`secondary→--text-soft`, …). The direction of authority is already decided:
**CaptainPad's `constants/theme.ts` palettes are the single color source**
(all five themes — light/dark/midnight/sunset/gruvbox). Live Touch's static
navy `:root` is only its standalone fallback. We do not import the navy; we
do not fork a second palette (P0 in the brief, and the bridge already
enforces it).

So "the new style" = **CaptainPad's tokens wearing Live Touch's grammar**:

| Element | The new-style grammar (source) |
|---|---|
| **Panel chrome** | A panel is one object: surface fill + 1px hairline border + inset top highlight + soft ambient shadow + rounded corners (Live Touch `.panel`, prototype `.panel`). Not a bare scroll column with floating cards. |
| **Panel header** | One compact row: small **identity dot** + uppercase title + right-aligned controls; the header is chrome-thin ("every pixel spent on the header is a pixel off the pad"). (Live Touch `.panel-header`/`.panel-title .dot`, prototype `#colorsWindow`.) |
| **Radius scale** | A tokenized scale, not per-callsite integers. (Live Touch `--radius-*`; today's Deck uses 2,3,4,6,7,8,9,10,12,13,16,24 ad hoc.) |
| **Chip language** | The _190 tone system, frozen: **loud** = filled identity color + derived ink; **live** = filled green "engine is driving"; **quiet** = outlined, ~8% wash, ~40% border, accent text; **ghost** = palette neutrals. Color never the only carrier; ≥44pt interactive area via hitSlop. (`param_chips.tsx` / `param_row_layout.ts`.) |
| **State-tinted fills** | An "on" control is a translucent accent wash + accent border + accent text — never a flat opaque repaint. (Live Touch `.toggle.is-on`, CaptainPad's existing `errorContainer`/`errorContainerBorder` precedent.) |
| **Typography** | SpaceGrotesk_700Bold for caps labels/headlines, Inter for body — unchanged fonts, but codified **recipes** (label sizes + tracking) instead of 15 hand-tuned fontSize literals. |
| **Glow** | Restrained: a soft accent glow marks ARMED / LIVE / selected states only, never resting chrome. (Live Touch `--glow-*` discipline; the ARM control "never shares its colour with anything else".) |
| **Identity colors** | A small set of theme-INDEPENDENT identity hexes (audio bands, MIDI violet `#7c5cff`, plan cyan, panic amber) that read the same on every theme and on the desktop tools, contrast-guarded per surface with `readableInk()`. (_190's ruling on the ♪ band chips.) |

### 1.1 The canonical token set (the reconciliation)

**Colors — extend `constants/theme.ts`, never fork.** All five palettes gain
the same new keys (a missing key crashes loudly — existing contract):

| New token | Role | Today's literal it retires |
|---|---|---|
| `borderStrong` | Hairline for selected/hover/focused chrome (stronger than `ghostBorder`) | ad-hoc rgba borders |
| `warning` / `warningContainer` / `warningContainerBorder` | The amber family — plan takeover chips, PLAN banner, PANIC | `#F5A623`, `#f5a623`, `rgba(245,166,35,0.18)`, `#9a6a12`, `#8a6a1f` |

Existing tokens absorb the rest of the drift:

- `#00a86b` (the "live/connected/ALL" green, 6+ sites) → **`tertiary`** — the
  palette already defines tertiary as the "auto-driven / synced" green.
- `#1a1a1a` ×10 in `PlanLockBanner` (dark ink on amber) → derived via the
  existing `readableInk()` against the warning fill, not a literal.
- `'rgba(186,26,26,0.12)'` in `OfflineBanner` → `errorContainer` +
  `errorContainerBorder` (the tokens already exist for exactly this).

**New `constants/identity.ts`** — one module declaring the deliberate
theme-independent identity constants and WHY they are not tokens: audio band
hexes (mirror the Audio Companion), `MIDI_ACCENT = '#7c5cff'`
(param_chips re-exports it), `PLAN_ACCENT` (today's `PLAN_INDICATOR_CYAN`).
Everything else must come from the palette.

**Shape + rhythm — new exports beside `Fonts` in `constants/theme.ts`:**

```ts
export const Radius = { chip: 4, control: 8, card: 12, panel: 16, shell: 24 };
export const Space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
```

Mapping: chips stay 4 (frozen by _190); buttons/pills/swatches → 8; cards
(DECK MAIN card, autopilot cards, overlay cards) → 12; windows/panels → 16;
the page shell (today's `leftPane` 24) → 24. Live Touch's 10/14/18/22 scale
is NOT imported — the app's 4-based scale wins because the chip radius is
already shipped and pinned by tests.

**Recipes — extend `styles/globalStyles.ts` (theme-aware factory):**

- `panel` — window surface: `surfaceContainerLow` fill, `Radius.panel`, 1px
  `ghostBorder`, inset top highlight (dark bases: `inset 0 1px 0
  rgba(255,255,255,.06)` via the existing `shadow()` boxShadow-string
  helper; light base: none — an inset white line is invisible on light),
  ambient shadow.
- `cardOnPanel` — `surfaceContainerLowest`, `Radius.card`, `ghostBorder`
  (today's `card`, re-pointed at the scale).
- `panelHeaderRow`, `identityDot(color)` — the dot+title header recipe.
- `labelCaps` (SG 700 / 10pt / 1.2 tracking / `secondary` / uppercase — the
  already-dominant recipe, now importable), `microCaps` (9pt / 1.5), and
  `valueText` (Inter 600) — replacing per-file re-declarations.
- `accentWash(accent)` — the state-tint helper: `{ backgroundColor:
  accent@14%, borderColor: accent@45%, textColor: accent }` with the
  `readableInk()` guard for filled variants. This is the ONE way an
  on-state paints, on every surface.
- `glowFor(accent)` — a `shadow(0,0,18,accent,0.30)` boxShadow string, used
  ONLY by armed/live/selected states.

**`CaptainPad/DESIGN.md`** — authored in the `design.md` format
(`.agent/os/ui_design.md`): YAML front matter carrying exactly the tokens
above + the component recipes, prose carrying the rules in §1. One file, one
source of truth; lint runs ad hoc only, never in CI.

---

## 2. Per-component migration table

Scope: `CaptainPad/app/(tabs)/index.tsx` and everything it hosts, as
reorganized by the _208 workspace (docs/53 §2). **PRESERVED on every row, so
it is stated once:** all behavior, gestures (fader drags, split-divider
drag, long-press, PanResponders), engine routes, optimistic+rollback
handlers, WS reconciles, plan-lock gating (`planGate`, scrim hermeticity),
`deckSwapInFlight` dimming, accessibility labels/roles, 44pt touch floors,
layout structure and the operator-ruled column weights / patterns-pin /
2026-07-27 rulings — untouched.

Risk classes: **S** = pure style (colors/radius/typography/borders swapped
in place, zero markup change) · **S+** = style plus trivial markup (a dot
`View` added to an existing header row) · **M** = style on a *shared or
gesture-adjacent* surface (mixer renders it too, or a PanResponder lives
nearby) — style-only edits, but validation must cover the second surface /
the gesture.

| # | Component | What changes visually | Risk |
|---|---|---|---|
| 1 | **DeckTopBar** (title, model chip, MASTER fader + FADE group) | `labelCaps`/`microCaps` recipes; connected-green `#00a86b`→`tertiary`; pills → `Radius.control`; fader **track/fill/thumb re-tinted from tokens only** (geometry, hit areas, drag math untouched) | M (fader) |
| 2 | **CPCControls** (SPEED · COLORS · QUEUE · TAP · BPM · OSC row) | The densest drift (fontSize 7–18, radius 3–8 ad hoc): normalize to recipes + `Radius.control`; sync/auto states → `accentWash(tertiary)`; no size increases (density is a feature here) | M (drag faders in-row) |
| 3 | **DECK MAIN · LIVE OUTPUT header** + PixelStrip + plan chips | Label → `labelCaps`; plan-live chip → `PLAN_ACCENT` wash; took-over chip → `warning` wash; PixelStrip keeps radius 6→`Radius.control` (8) | S |
| 4 | **PlanLockBanner / PlanLockScrim** | Banner → `warning` family tokens + `readableInk`; the ten `#1a1a1a` literals retired; scrim untouched (hermetic layer, no visual identity) | S |
| 5 | **DeckHueRow** | Recipes + `Radius.control`; hue gradient strip is data, stays | S |
| 6 | **SplitPlaylistPanes** (divider, "+ SECOND PLAYLIST" bar, ✕ unbind) | Pane chrome → `cardOnPanel`; divider handle re-tinted `borderStrong` (grab zone size untouched); "+ SECOND PLAYLIST" → quiet-chip language | M (divider drag) |
| 7 | **PlaylistPanel rows** (pattern names, aliases, locked badges, ♪ marks, + add, ↻) | Row text → recipes; active-entry highlight → `accentWash(primary)` + `borderStrong`; locked badge → quiet chip; alias/name hierarchy kept; **row heights pinned by `playlist_row_sizing.ts` are NOT changed** | **M — shared with the Mixer tab** |
| 8 | **EntryLabelEditor** | Input chrome → `cardOnPanel` tones, focus ring → `borderStrong`; draft/focus behavior untouched | S |
| 9 | **DECK MAIN card** (host of 10–13) | `cardOnPanel` recipe; channel-color accent border rule kept verbatim (lock border still wins); planGate dim kept | S |
| 10 | **GlobalParams + param rows/chips** | **The reference point — already the new style.** No changes to chips, tones, metrics, or `param_row_layout` numbers. Only its card surface aligns via #9 | none |
| 11 | **◎ ALL pill, color swatch button** | `#00a86b`→`tertiary`; quiet-chip paint; swatch button → `Radius.control` | S |
| 12 | **Toggle/Momentary grid** (`macroButton`) | Height 80 kept; radius 16→`Radius.card`; ON state: flat `primary` repaint → `accentWash(primary)` + `borderStrong`; momentary pressed → `accentWash(error)` | S |
| 13 | **PatternAutopilotPanel** (incl. nested DECK TX) | Card → `cardOnPanel` + identity-dot header (§3 colors); PLAY/SHUFFLE/GROUP pills → accent washes; cadence `TimerPillBar` selected state → `accentWash(primary)`; SwapCountdown → `microCaps` | S+ |
| 14 | **ColorAutopilotPanel** | Same treatment as 13; palette chips keep their DualSwatch data-colors, selected ring → `borderStrong` | S+ |
| 15 | **DeckOverlayStack** | Overlay cards → `cardOnPanel`; the per-overlay color tag stays data-driven; collapsed one-line headers get the dot+caps recipe | S+ |
| 16 | **GlobalEffectMacros footer / RigGlobals (GEM strip incl. BLACKOUT)** | Chips → recipes + `Radius.control`; armed/active effects → accent washes + `glowFor`; BLACKOUT keeps its unmistakable red (error tokens); btnHeight 48/60 untouched | **M — shared with the Mixer tab** |
| 17 | **PANIC bar** | Amber literals → `warning` family; radius → `Radius.control`; the deliberate loud-amber identity is PRESERVED — this button must read identically forever | S |
| 18 | **OfflineBanner** | → `errorContainer`/`errorContainerBorder` tokens | S |
| 19 | **Color-picker Modal, ConfirmSheet, AllModulationsPanel** | Modal surface → `panel` recipe; swatch grid → `Radius.control`; ConfirmSheet inherits recipes app-wide | S |
| 20 | **Workspace window chrome + restore rail** (_208's new `deck_window.tsx` / `deck_workspace.tsx`) | NEW surfaces — wear the new style from day one, spec in §3 | S+ (owned by the restyle, applied to _208's markup) |

Tally: 10 pure-style (S), 4 style-plus-a-dot (S+), 5 shared/gesture-adjacent
(M), 1 no-op (GlobalParams — already migrated by _190).

**The single biggest visible change** is not in the table rows — it is the
window surfaces themselves: today PATTERNS is a `leftPane` pane while
PARAMETERS and AUTOPILOT are *bare transparent scroll columns* with floating
cards. Under the restyle all open workspace windows sit on the same `panel`
recipe, so the Deck reads as a set of instruments (the Live Touch look)
instead of one pane and two loose stacks.

---

## 3. Workspace window chrome + restore rail spec (composes with _208)

_208 is implementing docs/53 right now. Contract for composing:

- **Sequencing: the restyle lands AFTER _208's Slice A.** The restyle
  implementer paints _208's `DeckWindow`/`DeckWorkspace` markup; it never
  edits pre-workspace `index.tsx` column markup that _208 is about to move.
- **The pixel-parity mandate is superseded — deliberately and on the
  operator's order.** Docs/53's "default layout must render visually
  equivalent to today" was a guard for the LAYOUT migration (so layout bugs
  couldn't hide behind look changes). It stays in force for _208's own
  validation. The moment this restyle applies, the look changes on purpose:
  the restyle's "before" baseline is the **post-_208** Deck, and _208's
  parity screenshots become that baseline.
- Everything else in docs/53 §3.4 binds the restyle too: no remounts, no
  engine traffic from chrome, rail is a sibling row never an overlay, no
  gesture theft, scrim blankets the chrome.

**Window chrome (`DeckWindow`):**

- Body surface: the `panel` recipe (`surfaceContainerLow`, `Radius.panel`,
  `ghostBorder`, inset highlight on dark bases, ambient shadow).
- Header row: height exactly what _208 ships (its no-net-height rule holds —
  the restyle repaints, it does not thicken): **identity dot (8px round)** +
  window title in `labelCaps` + the minimize chevron (28×28 + hitSlop,
  `icon` color, `secondary` on press). Header background transparent — the
  panel surface is the surface.
- Proposed window identity colors (operator confirm, §7): PATTERNS =
  `primary` · PARAMETERS = MIDI violet (`identity.ts`) — the params ARE the
  physical-knob surface and violet is already the app-wide family for that ·
  AUTOPILOT = `tertiary` (the auto-driven green, already that semantic) ·
  COLORS = **a live C1/C2 DualSwatch as its dot** — the truthful option: the
  window's identity IS the current palette.
- Minimized state: nothing — a closed window leaves entirely (docs/53 rule
  1); the chrome never renders a husk.

**Restore rail:**

- One chip per closed window: identity dot + name in `microCaps`, quiet-chip
  paint (`surfaceContainerLowest`, `ghostBorder`, `Radius.control`), ≥44pt
  target, pressed feedback `surfaceContainerHigh`. The rail row itself is
  transparent (it costs its 44pt only when something is closed — _208's
  rule; the restyle adds no surface behind it).
- The chip's dot uses the same identity color as the window header, so
  closed→open reads as the same object moving.

**COLORS window interior** (when its implementation follows docs/53 §4–5):
the approved prototype IS its spec. Mapping to tokens: the prototype's
panel = the `panel` recipe; its purple `#colorsWindow` hairline = the
window's selected/`borderStrong` treatment, not a new color; the presets
pane's deliberately-different "recall, not edit" surface =
`surfaceContainerLowest` ground with `warning`-amber accents (the
prototype's orange, mapped to the amber family); big-thumb wheel handles
and ≥44pt chips carry over as specified in docs/53.

---

## 4. Shared vocabulary with the Events tab (_206) and beyond

Docs/52 §5 already commits the Events tab to `usePalette()` tokens and
contrast-guarded data-accents. The restyle gives it the concrete pieces —
_206 (and the COLORS window implementer) must import these rather than
hand-roll:

| Shared piece | Where it lives | Events-tab use |
|---|---|---|
| `panel` / `cardOnPanel` recipes | `globalStyles` | show cards, stage column |
| `accentWash(accent)` + `readableInk()` | `globalStyles` / `param_row_layout` | stage buttons tinted by show-data accents (`#FF9EC4`/`#4FA8FF` are DATA; chrome stays tokens) |
| `glowFor(accent)` | `globalStyles` | the CURRENT stage's glowing border — the one sanctioned always-on glow, matching Live Touch's ARM precedent |
| `labelCaps` / `microCaps` / `Radius` / `Space` | `constants/theme.ts` + `globalStyles` | stage labels, NEXT chips, countdown text |
| Quiet/loud/live/ghost chip tones | `param_chips.tsx` | `NEXT` chip (quiet), countdown chip (live), locked stages (ghost) |
| Big-button scale | new in `DESIGN.md`: SG 700 at 16pt (stage ≥88pt tall) and 20pt (ceremonial ≥160pt) | the reveal buttons |

One vocabulary, three new surfaces (restyled Deck, Events, COLORS window) —
that is the payoff of doing tokens first.

---

## 5. Implementation slice plan (for Opus implementers)

Shared-tree protocol from docs/53 §6 is MANDATORY verbatim: re-read before
every edit, surgical spans only, stop-and-report on anchor failure, no git
ops, never touch the coordinator's live stack (ports 6966–6972); validators
screenshot a fresh dist on :7167 only.

- **Slice R0 — tokens + recipes (can land in parallel with _208; zero
  visual change).** `constants/theme.ts` (+`borderStrong`, `warning`×3, all
  five themes, WCAG-checked), `constants/identity.ts`, `Radius`/`Space`
  exports, `globalStyles` recipes (`panel`, `cardOnPanel`, `panelHeaderRow`,
  `labelCaps`, `microCaps`, `accentWash`, `glowFor`), `CaptainPad/DESIGN.md`.
  Nothing consumes them yet. Tests: token-completeness (every palette has
  every key — extend the existing dynamic-read posture), `accentWash`
  contrast table over all five themes (pure function, vitest).
- **Slice R1 — Deck-only pure reskins (after _208 Slice A).** Table rows
  1, 3–5, 8–9, 11–15, 17–19: swap literals/radii/fonts for tokens/recipes in
  place. No markup beyond the S+ dots. One PR-sized change per 2–3
  components, screenshots each.
- **Slice R2 — workspace chrome + rail (after _208 Slice A, with _208's
  consent if still active on those files).** Paint `deck_window.tsx` /
  `deck_workspace.tsx` per §3.
- **Slice R3 — shared/gesture surfaces, one at a time.** Rows 1 (fader
  paint), 2, 6, 7, 16. Each lands alone with BOTH deck and mixer
  screenshots (7 and 16 render on the Mixer tab; drift between tabs is the
  bug this slice must not create) and a manual gesture pass (master fader
  drag, split-divider drag, GEM taps).

**Test expectations (a reskin that breaks a test is a defect):**

- Full vitest suite stays green — notably `param_row_layout.test.ts` (chip
  metrics/tones are canon and must not change), `playlist_row_sizing`
  (row heights preserved), `deck_workspace_layout.test.ts` (_208's, once
  landed). `npx tsc --noEmit` clean; eslint no new warnings.
- New tests only in R0 (token completeness + contrast). R1–R3 add none:
  style values are pinned by screenshots, not unit tests.

**Validator screenshot matrix (every slice; before = post-_208 baseline):**

| # | State | Widths | Themes |
|---|---|---|---|
| 1 | Deck default (all windows open) before/after | 1194×834 landscape + narrow <900 portrait | light + dark |
| 2 | Deck with PARAMETERS minimized (rail visible) | wide | dark |
| 3 | Plan lock engaged (banner + scrim + warning chips) | wide | light + dark |
| 4 | PANIC bar + ConfirmSheet | wide | dark |
| 5 | Mixer tab before/after (R3 slices only — shared surfaces) | wide | light + dark |
| 6 | Spot-check: gruvbox + sunset full Deck (token regressions show here first) | wide | gruvbox, sunset |
| 7 | Deck-swap in-flight dim + offline banner | wide | dark |

Capture per repo memory: fresh dist on :7167, console muted pre-boot, one
tab; the operator's :6967 Expo untouched.

---

## 6. Open decisions for the operator

1. **Window identity colors** — accept §3's proposal (PATTERNS primary /
   PARAMETERS violet / AUTOPILOT green / COLORS live-DualSwatch), or name
   your own set?
2. **Glow budget** — restrained (armed/live/current-stage only, §1) is the
   design; say the word if you want the fuller Live Touch glow on selected
   playlist entries too.
3. **The NauticalFader** (Dimmer Rack modal) is OUTSIDE this scope — the
   Deck's master is a plain HorizontalFader and only gets re-tinted. Should
   a follow-up modernize the Dimmer Rack's nautical look too, or is that
   look intentional TE DNA to keep?
4. **Live Touch navy as a sixth theme?** The restyle deliberately does NOT
   import Live Touch's standalone `#1c3054` navy (the bridge already makes
   Live Touch wear YOUR theme when embedded). If you actually like that navy
   as an app-wide look, the right move is a sixth palette entry in
   `theme.ts` — one line of intent from you and it rides the same tokens.
5. **Density** — the restyle preserves current compactness everywhere
   (row heights, 244px param column, GEM strip heights). Confirm that is
   the intent; "roomier" would be a different, structural project.

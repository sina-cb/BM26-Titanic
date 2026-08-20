// restyle_contrast — the contrast contract for the pairings slices R1 + R2
// INTRODUCED (docs/54 §2 rows 1–19 and §3, agent _213).
//
// `design_tokens.test.ts` (slice R0) pins the TOKENS: does `warning` read on
// every surface, does `borderStrong` clear 3:1, does `accentFill` derive a
// safe ink. This file pins the CALL SITES the reskin created — the specific
// colour-on-colour pairs that did not exist before R1 and therefore were
// never measured:
//
//   1. `tertiary` as TEXT. The restyle retires the scattered '#00a86b'
//      literal in favour of the palette's `tertiary`, so a token that used
//      to appear mostly as a fill is now the CONNECTED label, the ◎ ALL
//      pill and the MIDI chip label.
//   2. `accentWash(tertiary)` / `accentWash(primary)` ink over the surfaces
//      the deck actually composites them on. A wash barely moves the ground,
//      but "barely" is a measurement, not an assumption.
//   3. The four WINDOW IDENTITY dots against the workspace-bar chip grounds
//      (R2). These are UI components, so the bar is WCAG 1.4.11's 3:1, and
//      one of them (MIDI violet) is a FIXED identity hex that cannot be
//      re-tuned per theme — exactly the case a test has to hold down.
//   4. The plan-lock banner's amber FIELD against every surface it floats
//      over, which is what actually defines that banner's edge.
//
// Same node-env constraint as its sibling: this lives in `components/`
// because vitest's include globs never reach `constants/` or `styles/`.

import { describe, expect, it } from 'vitest';

import { Colors, THEME_ORDER, type Palette } from '@/constants/theme';
import { MIDI_ACCENT, AUDIO_BAND_FALLBACK as ACCENT_AUTO } from '@/constants/identity';
import { accentWash, contrastRatio, flattenOver } from '@/styles/design_recipes';

/** Every opaque ground a deck label or dot can land on. */
const SURFACE_KEYS = [
  'background', 'surface', 'surfaceContainerLow', 'surfaceContainerLowest',
  'surfaceContainerHigh', 'surfaceDim',
] as const;

const surfacesOf = (p: Palette) => SURFACE_KEYS.map((k) => ({ key: k, hex: p[k] }));

/**
 * The grounds an ON-STATE WASH is actually composited over on the Deck, and
 * the reason this is a shorter list than `SURFACE_KEYS`:
 *
 *   background            the screen root — the LIVE OUTPUT header row, where
 *                         the plan / took-over chips live.
 *   surfaceContainerLow   a window `panel` — the workspace tracks (R2).
 *   surfaceContainerLowest a `cardOnPanel` — DECK MAIN, the autopilot cards,
 *                         the overlay cards. Most washes are here.
 *
 * `surfaceContainerHigh` and `surfaceDim` are NOT wash grounds on this
 * screen: High is header-chip/badge paint (which the restyle leaves as flat
 * chips, not washes) and Dim is the dimmed page token. Sweeping them would
 * be asserting a pairing the code cannot produce — and two of them land
 * within rounding of the bar (light warning wash on Dim is 4.4987), so the
 * sweep would fail on a pairing that never renders. If a future slice DOES
 * put a wash on one of those, add the key here and make it clear the bar.
 */
const WASH_GROUND_KEYS = ['background', 'surfaceContainerLow', 'surfaceContainerLowest'] as const;
const washGroundsOf = (p: Palette) => WASH_GROUND_KEYS.map((k) => ({ key: k, hex: p[k] }));

/** WCAG AA for the 9–12 pt bold caps the deck labels in. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11 — a UI component boundary / state indicator. */
const AA_NON_TEXT = 3;

/** Themes whose base is dark. `light` is called out separately wherever it
 *  behaves differently, so that a difference is always deliberate. */
const DARK_THEMES = THEME_ORDER.filter((t) => t !== 'light');

// ── 1. `tertiary` as text (the '#00a86b' migration) ─────────────────

describe('tertiary as text — the retired #00a86b sites', () => {
  it('clears AA on every surface of every DARK-base theme', () => {
    for (const t of DARK_THEMES) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        expect(contrastRatio(p.tertiary, s.hex), `${t}.tertiary on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  // KNOWN GAP, MEASURED AND OWNED. `light.tertiary` is '#1b9e77', which tops
  // out at 3.39:1 (on surfaceContainerLowest) and bottoms out at 2.42:1 (on
  // surfaceDim) — it cannot clear AA as text on the daylight palette.
  //
  // R1 did NOT introduce this: the literal it replaced ('#00a86b') measured
  // 2.20–3.08 on the same surfaces, so every migrated site got BETTER and
  // none got worse. But "better and still failing" is still failing, and the
  // fix is a `constants/theme.ts` VALUE change, which slice R1 is explicitly
  // not allowed to make (it consumes tokens, it does not re-tune them).
  //
  // So the gap is pinned here rather than left to be rediscovered. A darker
  // green such as '#0d5c44' clears both bars on the light palette (5.70:1
  // direct, 4.64:1 as wash ink on the worst surface) if someone wants a
  // one-line fix. When that lands, THIS TEST FAILS — delete it and let the
  // AA sweep above cover all five themes.
  it('is a KNOWN, pinned failure on the light palette (see the comment)', () => {
    const p = Colors.light;
    const best = Math.max(...surfacesOf(p).map((s) => contrastRatio(p.tertiary, s.hex)));
    expect(best, 'light.tertiary now clears AA — retire this exception').toBeLessThan(AA_TEXT);
    // …and it must never regress BELOW what the literal it replaced managed.
    const worst = Math.min(...surfacesOf(p).map((s) => contrastRatio(p.tertiary, s.hex)));
    expect(worst, 'light.tertiary is worse than the #00a86b it replaced')
      .toBeGreaterThan(Math.min(...surfacesOf(p).map((s) => contrastRatio('#00a86b', s.hex))));
  });
});

// ── 2. the on-state washes the reskin paints with ───────────────────

describe('accentWash ink over the deck surfaces it composites on', () => {
  it('accentWash(primary) ink clears AA on every surface of every theme', () => {
    // The toggle/momentary grid, the cadence pills, the profile + style
    // dropdowns, SHUFFLE/GROUP — all of them are this one pairing.
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      const wash = accentWash(p.primary);
      for (const s of washGroundsOf(p)) {
        const ground = flattenOver(wash.backgroundColor, s.hex);
        expect(contrastRatio(wash.color, ground), `${t} primary wash on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('accentWash(tertiary) — the LIVE state — clears AA on every dark-base theme', () => {
    // The autopilot PLAY/PAUSE "engine is driving" pill and the ◎ ALL pill.
    // `light` is the same known gap as §1 and is covered by that exception.
    for (const t of DARK_THEMES) {
      const p = Colors[t];
      const wash = accentWash(p.tertiary);
      for (const s of washGroundsOf(p)) {
        const ground = flattenOver(wash.backgroundColor, s.hex);
        expect(contrastRatio(wash.color, ground), `${t} tertiary wash on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('accentWash(warning) — the took-over chip — clears AA on every theme', () => {
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      const wash = accentWash(p.warning);
      for (const s of washGroundsOf(p)) {
        const ground = flattenOver(wash.backgroundColor, s.hex);
        expect(contrastRatio(wash.color, ground), `${t} warning wash on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

// ── 3. R2: the window identity dots on the workspace-bar chips ──────

describe('workspace window identity dots (docs/54 §3)', () => {
  /** The four colour dots. COLORS draws a live DualSwatch instead, whose
   *  hues are DATA (the engine's two palette slots) and therefore cannot be
   *  contrast-guarded — it carries a `ghostBorder` ring for that reason.
   *  PIXELS wears the palette's NEUTRAL ink on purpose (report _225): its
   *  content IS colour, so an accent of its own would compete with it. */
  const dotsFor = (p: Palette) => ({
    patterns: p.primary,
    parameters: MIDI_ACCENT,
    autopilot: p.tertiary,
    pixels: p.secondary,
  });

  it('every dot clears the 3:1 UI-component bar on BOTH chip grounds', () => {
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      // OPEN chips sit on surfaceContainerLow (the window `panel` surface),
      // HIDDEN chips on surfaceContainerLowest (the quiet rail paint).
      const grounds = { open: p.surfaceContainerLow, hidden: p.surfaceContainerLowest };
      for (const [id, hex] of Object.entries(dotsFor(p))) {
        for (const [state, ground] of Object.entries(grounds)) {
          expect(contrastRatio(hex, ground), `${t} ${id} dot on the ${state} chip`)
            .toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
      }
    }
  });

  it('rejects surfaceContainerHigh as an open-chip ground — violet fails there', () => {
    // The reason the open chip is NOT a step "up" in surface. If a future
    // palette makes this pass, the ground choice can be revisited; until
    // then this documents WHY the code looks the way it does.
    expect(contrastRatio(MIDI_ACCENT, Colors.gruvbox.surfaceContainerHigh))
      .toBeLessThan(AA_NON_TEXT);
  });

  it('gives each window a DISTINCT dot on every theme', () => {
    for (const t of THEME_ORDER) {
      const dots = Object.values(dotsFor(Colors[t])).map((h) => h.toLowerCase());
      expect(new Set(dots).size, `${t} window dots must not collide`).toBe(dots.length);
    }
  });
});

// ── 3b. W2: the bar identity dots on the workspace-bar chips (docs/63 §3.3) ─

describe('workspace bar identity dots (docs/63 §3.3)', () => {
  /** The two bar dots. `outputBar` deliberately does NOT use docs/63 §3.3's
   *  literal suggestion (`C.icon`) — MEASURED, that token fails badly on the
   *  light theme (1.549:1 open / 1.705:1 hidden, both far under the 3:1 UI-
   *  component bar), because light's `icon` (`#bac9cc`) is a pale outline-
   *  variant tuned for darker chrome, not a dot on the light theme's
   *  near-white chip grounds. `C.text` is the substitute — the app's own ink
   *  colour, which clears 3:1 (and AA text) on every chip ground of every
   *  theme by a wide margin (see below), same escape valve §3.3 grants
   *  `audioBar` (measure; on failure pick a working neutral and record it). */
  const barDotsFor = (p: Palette) => ({
    audioBar: ACCENT_AUTO,
    outputBar: p.text,
  });

  it('audioBar and outputBar dots clear the 3:1 UI-component bar on BOTH chip grounds', () => {
    // WORST CASE measured (both far enough above 3 to not be a rounding
    // question):
    //   audioBar  (`ACCENT_AUTO` '#1b9e77'): light OPEN ground 3.074:1 —
    //             the tightest margin of the whole sweep, still a clear pass.
    //   outputBar (`C.text`):               gruvbox OPEN ground 9.571:1.
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      const grounds = { open: p.surfaceContainerLow, hidden: p.surfaceContainerLowest };
      for (const [id, hex] of Object.entries(barDotsFor(p))) {
        for (const [state, ground] of Object.entries(grounds)) {
          expect(contrastRatio(hex, ground), `${t} ${id} dot on the ${state} chip`)
            .toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
      }
    }
  });

  it('outputBar\'s neutral does not collide with the PIXELS window\'s secondary dot', () => {
    // THE RULE: no two identity dots may render the literal same hex on the
    // same theme — that is the actual bug this guards against (two chips the
    // operator cannot tell apart by their dot alone), not merely "different
    // enough" contrast between the two dots themselves. `outputBar` (`C.text`)
    // and PIXELS (`C.secondary`) are different tokens by construction; this
    // pins that no theme's palette values happen to make them equal.
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      expect(p.text.toLowerCase(), `${t} outputBar dot vs PIXELS' secondary dot`)
        .not.toBe(p.secondary.toLowerCase());
    }
  });

  // NOTE, not asserted: `audioBar` (`ACCENT_AUTO` '#1b9e77') and AUTOPILOT's
  // `tertiary` are the literal SAME hex on the `light` theme only (both
  // '#1b9e77' — light.tertiary was itself picked to be this green). A
  // whole-tier uniqueness sweep (windows + bars together) fails on that one
  // pairing; it is a pre-existing token value, not a W2 regression, and W2's
  // brief pins ONLY the outputBar/PIXELS pairing above, so it is reported
  // here rather than "fixed" by picking a different hex outside this wave's
  // scope (docs/63 W2 does not authorize re-tuning `tertiary` or `ACCENT_AUTO`).
});

// ── 4. the plan-lock banner's amber field ───────────────────────────

describe('plan-lock banner (docs/54 row 4)', () => {
  it('the warning field defines the banner edge on every surface', () => {
    // The banner floats over the deck with no scrim behind it, so its FILL
    // is the boundary — the inner rule is decoration on top of that.
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        expect(contrastRatio(p.warning, s.hex), `${t} banner field on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });
});

// ── 5. the mixer workspace bar's chip dots (docs/64 §2.4, W3) ───────────
//
// `mixer_workspace_bar.tsx` copies the deck's `WindowChip` grounds verbatim
// (`OPEN_CHIP_GROUND` = `surfaceContainerLow`, hidden = `surfaceContainerLowest`
// — the exact same two tokens §3 above already covers for the deck's own
// dots), so this section pins the MIXER-SPECIFIC dot semantics rather than
// re-measuring tokens whose contrast on these grounds is already proven:
//
//   - a channel's DEFAULT (ungrouped) dot and the MASTER VIEW citizen's dot
//     both wear `secondary` — the same "this chip is about the rig's own
//     content, not its own accent" reasoning the deck's PIXELS dot uses
//     (report _225), now applied to the master 2D band for the same reason.
//   - the COLORS citizen draws a live `DualSwatch` (its hues are engine
//     DATA), same as the deck's own COLORS chip — NOT contrast-guarded here,
//     for the identical reason §3 above states, and it carries the same
//     `DualSwatch` `ghostBorder` ring in place of a guaranteed-contrast dot.
//   - a GROUPED channel's dot is the operator's chosen group colour, which
//     is arbitrary runtime data, not a token — also not guardable here.

describe('mixer workspace bar chip dots (docs/64 §2.4)', () => {
  it('the ungrouped-channel dot and the MASTER VIEW dot (both `secondary`) clear 3:1 on both chip grounds', () => {
    for (const t of THEME_ORDER) {
      const p = Colors[t];
      const grounds = { open: p.surfaceContainerLow, hidden: p.surfaceContainerLowest };
      for (const [state, ground] of Object.entries(grounds)) {
        expect(contrastRatio(p.secondary, ground), `${t} mixer channel/MASTER VIEW dot on the ${state} chip`)
          .toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });
});

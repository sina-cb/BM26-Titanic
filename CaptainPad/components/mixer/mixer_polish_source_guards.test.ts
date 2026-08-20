// mixer_polish_source_guards.test.ts — source-text guards for the RENDER half
// of the docs/67 mixer polish wave (W2's portrait rail fix, W3's chip diet).
//
// WHY SOURCE TEXT. The decisions these guards protect are STYLE and JSX facts
// living in `.tsx` files that the vitest config deliberately keeps out of its
// glob (`app/(tabs)/mixer.tsx`, `components/mixer/mixer_workspace_bar.tsx`,
// `components/ui/workspace_chip.tsx` are all react-native components). The
// pure decisions extracted from this wave ARE unit-tested for real —
// `shouldShowBarOverflowHint` in `mixer_workspace_bar_logic.test.ts`, the
// masterBand default in `mixer_workspace_layout.test.ts`. What is left here
// is what only the source can state: which style flags are applied, on which
// orientation, and where the perf caption is mounted. Same idiom as
// `native_gesture_armor.test.ts`, `colors_window_wiring.test.ts` and
// `no_raw_alerts.test.ts`.
//
// Every guard below is MUTATION-HONEST — delete the line it describes and the
// test goes red — and each block carries a positive sanity assertion so an
// over-eager regex cannot pass by matching nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MASTER_BAR_SEAT_LANDSCAPE, MASTER_BAR_SEAT_PORTRAIT } from './mixer_workspace_bar_logic';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Strip line and block comments so the prose in these files' (extensive)
 *  docblocks cannot satisfy a guard that the CODE must satisfy. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(...parts: string[]): string {
  return stripComments(readFileSync(join(HERE, ...parts), 'utf8'));
}

const MIXER = read('..', '..', 'app', '(tabs)', 'mixer.tsx');
const BAR = read('mixer_workspace_bar.tsx');
const CHIP = read('..', 'ui', 'workspace_chip.tsx');

// ── W2 — the portrait rail's zero-height collapse (docs/67 §3.1) ───────────

describe('docs/69 §2.2 — the portrait master-bar seat is SELECTED, not composed', () => {
  // `_275` "fixed" the portrait collapse by layering flex longhands
  // (`flexGrow:0, flexShrink:0, flexBasis:'auto'`) over
  // `styles.masterBarFill`'s `flex:1` via `isPortrait &&` — but an override
  // can only ADD keys, and `flex:1` is a different key from those three
  // longhands, so flattening never dropped it. Yoga's `processFlexBasis()`
  // returns an explicit basis only when `flexBasis` is neither `auto` nor
  // `undefined`; an explicit `'auto'` falls straight through that check, so
  // the still-present `flex:1` forced `flexBasis:0` on native anyway — grow
  // 0 / shrink 0 / basis 0 = a deterministic 0 pt bar. The old guards below
  // pinned that inert `flexBasis:'auto'` longhand by name, i.e. they
  // enforced the bug. docs/69's fix replaces the base+override pair with
  // two SELECTED, standalone objects — `MASTER_BAR_SEAT_LANDSCAPE` and
  // `MASTER_BAR_SEAT_PORTRAIT` in `mixer_workspace_bar_logic.ts` — so there
  // is no `flex:1` left for `processFlexBasis` to fall back past.
  // `master_bar_seat_yoga.test.ts` is the executable proof: it runs the
  // real vendored Yoga algorithm over both historical compositions (still
  // collapsing to 0 pt) and the shipped seats (sizing correctly), so THIS
  // block only needs to pin the STATIC facts the Yoga suite can't check for
  // itself — which object has which keys, and that mixer.tsx actually wires
  // them in instead of quietly reverting to a fought-over override.

  it('the PORTRAIT seat carries NO flex-family key — the trap is structurally unreachable', () => {
    // Absence is the whole fix, so assert it structurally over the REAL
    // imported object (this module is pure TS — no source-text regex
    // needed, or wanted, for a fact the type system and the runtime both
    // already know). A regex could be fooled by reformatting; `Object.keys`
    // cannot.
    const keys = Object.keys(MASTER_BAR_SEAT_PORTRAIT);
    expect(keys).not.toContain('flex');
    expect(keys).not.toContain('flexGrow');
    expect(keys).not.toContain('flexShrink');
    expect(keys).not.toContain('flexBasis');
    // Positive sanity: the object is real and non-empty, so the assertions
    // above are not vacuously passing against an empty/undefined import.
    expect(keys).toEqual(['minWidth']);
  });

  it('the LANDSCAPE seat is unchanged — still {flex:1, minWidth:0}', () => {
    // The must-not-change pin: web/landscape were never broken by `_273` or
    // `_275`, and this wave must not disturb them (docs/69 §2 item 1 /
    // accept criteria: "landscape screenshots byte-identical"). Deep-equal,
    // not a subset check, so a stray future key on this object goes red
    // here too.
    expect(MASTER_BAR_SEAT_LANDSCAPE).toEqual({ flex: 1, minWidth: 0 });
  });

  it('mixer.tsx imports both seats and SELECTS between them at the render site', () => {
    expect(MIXER).toMatch(
      /import\s*\{[\s\S]{0,120}MASTER_BAR_SEAT_LANDSCAPE[\s\S]{0,120}MASTER_BAR_SEAT_PORTRAIT[\s\S]{0,40}\}\s*from\s*'@\/components\/mixer\/mixer_workspace_bar_logic'/,
    );
    expect(MIXER).toMatch(
      /<View style=\{isPortrait \? MASTER_BAR_SEAT_PORTRAIT : MASTER_BAR_SEAT_LANDSCAPE\}>/,
    );
  });

  it('the old fighting shape cannot come back: no masterBarFill(Portrait) StyleSheet entries', () => {
    // Pinned as the StyleSheet-KEY form (`name:\s*\{`), not a bare-word
    // search — `mixer.tsx` deliberately carries a comment mentioning
    // `masterBarFill` by name to narrate the history above the current
    // styles, and `stripComments` (this file's own helper, applied to MIXER
    // before any guard runs) strips exactly that prose. If `stripComments`
    // ever regressed, a bare-word search here would still pass by matching
    // the comment text instead of code, silently defeating the guard — the
    // key-declaration form cannot be fooled that way, and it also cannot
    // match the still-legitimate prose mentions of the old names.
    expect(MIXER).not.toMatch(/masterBarFill:\s*\{/);
    expect(MIXER).not.toMatch(/masterBarFillPortrait:\s*\{/);
    // And the fought-over composition itself must be gone, in case a future
    // edit reintroduces the override under some other style name pair.
    expect(MIXER).not.toMatch(/styles\.masterBarFill,\s*isPortrait\s*&&\s*styles\.masterBarFillPortrait/);
  });

  it('the bar is still rendered unconditionally', () => {
    expect(MIXER).toMatch(/<MixerWorkspaceBar/);
  });

  it('the retired master 2D view and its restore wiring stay absent', () => {
    expect(MIXER).not.toMatch(/placement=["']master["']/);
    expect(MIXER).not.toMatch(/masterBandShown|handleToggleMasterBand|MASTER_BAND_ID/);
  });
});

// ── W3 — the chip diet (docs/67 §4) ───────────────────────────────────────

describe('docs/67 §4.1 — the shared chip label is capped and single-line', () => {
  it('exports the cap as a named constant (the deck and the mixer share ONE number)', () => {
    expect(CHIP).toMatch(/export const WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168;/);
  });

  it('the label Text is single-line — tail ellipsis is RN\'s default', () => {
    expect(CHIP).toMatch(/<Text\s+numberOfLines=\{1\}/);
  });

  it('the cap is a STYLE, applied to both the open and the rail label recipes', () => {
    expect(CHIP).toMatch(/chipLabelCap:\s*\{\s*maxWidth:\s*WORKSPACE_CHIP_LABEL_MAX_WIDTH,\s*\}/);
    expect(CHIP).toMatch(
      /open\s*\?\s*styles\.chipLabel\s*:\s*styles\.railChipLabel,\s*styles\.chipLabelCap,/,
    );
  });

  it('the label never shrinks below its truncated width (the 44 pt target holds)', () => {
    // A `flexShrink` on the label would let a crowded bar squeeze chips under
    // the docs/66 floor — the cap bounds width, it must not enable shrinking.
    expect(CHIP).not.toMatch(/chipLabelCap:\s*\{[^}]*flexShrink/);
    // Positive sanity: both halves of the 44 pt effective target survive the
    // diet — the 28 pt chip height and the 8 pt hitSlop on every edge.
    expect(CHIP).toMatch(/minHeight:\s*28/);
    expect(CHIP).toMatch(
      /WORKSPACE_CHIP_HIT_SLOP = \{ top: 8, bottom: 8, left: 8, right: 8 \}/,
    );
  });

  it('the full title still reaches assistive tech (the caller composes it)', () => {
    expect(CHIP).toMatch(/accessibilityLabel=\{accessibilityLabel\}/);
  });
});

describe('docs/67 §4.2 — the overflow hint is pinned OUTSIDE the scroller', () => {
  it('the bar asks the pure module, it does not re-derive the decision', () => {
    expect(BAR).toMatch(/shouldShowBarOverflowHint\(extent\)/);
  });

  it('the hint renders after the ScrollView closes, not inside its content', () => {
    const scrollerEnd = BAR.indexOf('</ScrollView>');
    const hintAt = BAR.indexOf('showOverflowHint ?');
    expect(scrollerEnd).toBeGreaterThan(-1);
    expect(hintAt).toBeGreaterThan(scrollerEnd);
  });

  it('the bar measures content, viewport AND scroll offset (all three inputs)', () => {
    expect(BAR).toMatch(/onContentSizeChange=\{handleContentSizeChange\}/);
    expect(BAR).toMatch(/onLayout=\{handleLayout\}/);
    expect(BAR).toMatch(/onScroll=\{handleScroll\}/);
  });

  it('the hint is decoration — hidden from the accessibility tree', () => {
    expect(BAR).toMatch(/accessibilityElementsHidden[\s\S]{0,60}importantForAccessibility="no"/);
  });

  it('no new dependency was added for the affordance (offline readiness)', () => {
    expect(BAR).not.toMatch(/expo-linear-gradient|LinearGradient/);
  });
});

describe('performance workspace bar — actionable controls only', () => {
  it('renders no performance caption, slot, or placeholder', () => {
    expect(BAR).not.toMatch(/PERF_PARAMS_CAPTION|showPerfCaption|perfCaptionSlot|perfCaptionText/);
  });
});

describe('docs/67 §6 — the C4/C5 riders', () => {
  it('C4: the chip gap is 12, so adjacent 8 pt hit regions stop overlapping', () => {
    expect(BAR).toMatch(/barContent:\s*\{[\s\S]{0,120}gap:\s*Space\.md,/);
    expect(BAR).not.toMatch(/barContent:\s*\{[\s\S]{0,120}gap:\s*Space\.sm,/);
  });

  it('C5: the bar\'s vertical padding is symmetric', () => {
    expect(BAR).toMatch(/paddingTop:\s*4,\s*paddingBottom:\s*4,/);
  });
});

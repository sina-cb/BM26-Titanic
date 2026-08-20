// Shared geometry for the top TITLE row (brand header bar) on the Deck and
// Mixer tabs. Both tabs render the same visual header — brand logo + status
// chrome on the left, master fader / controls on the right — so their row
// geometry lives HERE, in one place, to keep them unified and prevent the
// slow drift the two hand-copied style blocks used to suffer.
//
// party 2026-07-11: the deck used a fixed height:64 and the mixer a
// minHeight:64 + paddingVertical:8; both ate vertical space above the pattern
// list. Tightened to a compact single-line bar (48pt) so the deck/mixer read
// as one dense header. The brand ("Marsin Deck"/"Marsin Mixer") logo font is
// intentionally left at its own call sites (the operator likes the logo) — this
// module only owns the ROW envelope so tuning one number thins both tabs.
export const HEADER_MIN_HEIGHT = 48;
export const HEADER_PADDING_VERTICAL = 6;

// The side rail consumes 112 pt before a Deck/Mixer screen is laid out. At
// 1366 pt iPad landscape the remaining header is therefore 1254 pt wide. The
// five-button fade selector is the one expendable width cost: every duration
// remains available through MasterFadeGroup's existing cycler, while MODEL,
// APC, TO BLACK, UP and MASTER all keep their real labels and controls.
export const HEADER_COMPACT_MAX_WIDTH = 1500;

// MODEL is status, not an accordion. Its old flex-shrink path could squeeze
// this chip below the word "MODEL", which native Yoga then wrapped one letter
// per line and made the whole header tower vertically. This floor holds the
// caption plus a useful model-name seat on one horizontal baseline.
export const HEADER_MODEL_MIN_WIDTH = 136;
export const HEADER_MODEL_MAX_WIDTH = 208;

export const HEADER_MASTER_FADER_COMPACT_WIDTH = 144;
export const HEADER_MASTER_FADER_WIDE_WIDTH = 180;

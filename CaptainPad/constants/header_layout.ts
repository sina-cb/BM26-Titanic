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

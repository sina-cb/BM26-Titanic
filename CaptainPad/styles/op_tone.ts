// op_tone — the palette mapping for the op_dialog notice/dialog system.
//
// Split out of the components so it is PURE TypeScript (no react-native
// import) and can be swept across all five themes by
// `components/op_tone.test.ts` in vitest's node environment — the same trick
// `styles/design_recipes.ts` + `components/design_tokens.test.ts` already use.
//
// docs/54 §1.1 / DESIGN.md "Semantic roles":
//   error   = FAILURE (and blackout). Never merely "careful."
//   warning = something ELSE is driving, or this control is dangerous.
//   info    = neutral status; carries no alarm, so it borrows `primary`
//             rather than inventing a palette key.
//
// WHY THE CARD IS AN UNTINTED PANEL. The obvious design — fill the card with
// `errorContainer` — was built first and REJECTED by `components/op_tone.test.ts`:
// gruvbox's `error` (#fb4934) on its own flattened error wash measures
// **3.23:1**, well under the 4.5 an 11pt bold cap needs. That is the trap the
// container tokens are documented to avoid: they are 0.08/0.16 washes meant to
// sit INSIDE a panel as a quiet inline box, not to become the ground that the
// same hue's text then has to fight.
//
// So the card is the plain panel surface in every tone, and the tone is carried
// by four things that are all measured against it: the accent title, a 3px
// leading bar, the icon, and the spoken label. `error`/`warning` as text on the
// palette's surfaces is contrast the token layer ALREADY guarantees on all five
// themes (`components/design_tokens.test.ts`), so this reuses a proven pairing
// instead of inventing a new ground. It also matches ConfirmSheet, which is
// likewise an untinted panel with a coloured icon and title.

import { type Palette } from '@/constants/theme';
import { type OpTone } from '@/utils/op_dialog';

export interface OpToneColors {
  /** OPAQUE card fill — the panel surface, untinted (see the header). */
  background: string;
  /** Card hairline. */
  border: string;
  /**
   * NON-TEXT tone carrier only: the icon glyph and the 3px leading bar.
   *
   * Deliberately NOT the title ink. `components/op_tone.test.ts` measured
   * gruvbox's `error` (#fb4934) at **3.82:1** on the panel surface — fine for
   * a WCAG 1.4.11 boundary (3:1), short of the 4.5 an 11pt bold cap needs. And
   * that is not a gruvbox quirk: the token layer's contract
   * (`components/design_tokens.test.ts`) pins `warning` as AA text on every
   * surface but has NEVER pinned `error`, so no theme owes us a text-grade
   * error red. Painting the title with it would have shipped a headline that
   * is hardest to read exactly when it matters most.
   */
  accent: string;
  /** Title ink — `text`, which every theme does guarantee at AA. */
  title: string;
  /** Body-copy ink (the engine's verbatim reason). */
  body: string;
  /** IconSymbol name. Only names present in `components/ui/icon-symbol.tsx`'s
   *  mapping are used — an unmapped SF name renders a blank 0x0 glyph on web,
   *  which would make the tone's non-colour carrier disappear. */
  icon: 'exclamationmark.triangle.fill' | 'checkmark.circle.fill';
  /** Spoken tone name, so colour is never the only carrier (DESIGN.md). */
  label: string;
}

export function opToneColors(C: Palette, tone: OpTone): OpToneColors {
  switch (tone) {
    case 'error':
      return {
        background: C.surfaceContainerLow,
        border: C.errorContainerBorder,
        accent: C.error,
        title: C.text,
        body: C.text,
        icon: 'exclamationmark.triangle.fill',
        label: 'Error',
      };
    case 'warning':
      return {
        background: C.surfaceContainerLow,
        border: C.warningContainerBorder,
        accent: C.warning,
        title: C.text,
        body: C.text,
        icon: 'exclamationmark.triangle.fill',
        label: 'Warning',
      };
    case 'info':
      return {
        background: C.surfaceContainerLow,
        border: C.borderStrong,
        accent: C.primary,
        title: C.text,
        body: C.text,
        icon: 'checkmark.circle.fill',
        label: 'Notice',
      };
  }
}

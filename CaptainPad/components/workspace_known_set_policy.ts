/**
 * workspace_known_set_policy — the ONE canonical statement of the rule every
 * workspace store's known-set upgrade discipline follows (docs/63
 * `deck_workspace_layout.ts` §2.3, docs/64 `mixer_workspace_layout.ts` §2.3,
 * docs/64 §10 convergence duty: "the known-set new-id policy table ... must
 * read as one rule").
 *
 * The deck's window/bar workspace and the mixer's channel/section/citizen
 * workspace independently arrived at the same shape of answer to "what does
 * an id do when the persisted store never had an opinion about it": look at
 * what the id's SHIPPED DEFAULT membership is, and honor it. Only the
 * defaults differ per namespace — a deck window defaults closed, a deck bar
 * defaults open, a mixer channel defaults visible, a mixer section defaults
 * visible, `citizen/colors` defaults closed, `citizen/masterBand` defaults
 * closed (docs/67 §2.3 — flipped from VISIBLE on an operator ruling: the
 * master band is a large show surface the operator opens on demand. The
 * PRINCIPLE below is untouched by that flip, because no existing store is
 * silent about `citizen/masterBand`: every mixer store ever written records
 * it in `known`, so the new default reaches fresh stores only) — the
 * PRINCIPLE that decides "how do we even choose a default" is one sentence,
 * and it lives here so neither module has to restate it in its own words and
 * risk the two paraphrases quietly drifting apart under a future edit.
 *
 * This is a pure documentation constant. It decides nothing, throws nothing,
 * and is not itself a `known`-set predicate — each module keeps its own
 * `shippedDefaultClosed` (mixer) / unknown-id branch (deck) exactly where it
 * is, because the two id spaces (a closed compile-time enum vs namespaced
 * runtime strings) are different enough that a single shared FUNCTION would
 * either leak one namespace's shape into the other or have to be so generic
 * it said nothing (see the file-level doc comments on both modules for why
 * a shared function was rejected). Both `components/deck/deck_workspace_layout.ts`
 * and `components/mixer/mixer_workspace_layout.ts` re-export this constant,
 * so a reader landing in either file's normalizer sees the SAME imported
 * symbol at the point the rule is invoked, not two hand-typed sentences that
 * could diverge on the next edit to either file.
 */
export const WORKSPACE_KNOWN_SET_RULE =
  "a store may only be silent about an element that did not exist when it "
  + "was written, and silence must reproduce the screen that store's author "
  + 'was looking at';

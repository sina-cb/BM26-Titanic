import { describe, expect, it } from 'vitest';

import {
  COLORS_ID,
  MASTER_BAND_ID,
  MIXER_WORKSPACE_LAYOUT_KEY,
  PERF_SUPPRESSED_SECTION,
  SHIPPED_DEFAULT_CLOSED_CITIZENS,
  channelSurfaceId,
  citizenSurfaceId,
  commitRoster,
  effectiveCitizenShown,
  effectiveSectionShown,
  hiddenChannelChips,
  initialLayout,
  isCitizenShown,
  isMixerSurfaceId,
  isSectionShown,
  layoutReducer,
  normalizeLayout,
  parseMixerSurfaceId,
  sectionSurfaceId,
  serializeLayout,
  visibleChannels,
  type MixerChannelId,
  type MixerLayoutAction,
  type MixerWorkspaceLayout,
} from './mixer_workspace_layout';

const ROSTER: readonly MixerChannelId[] = ['a', 'b', 'c'];

const close = (s: MixerWorkspaceLayout, id: string, roster: readonly MixerChannelId[] = ROSTER) =>
  layoutReducer(s, { type: 'close', id, roster });
const open = (s: MixerWorkspaceLayout, id: string) => layoutReducer(s, { type: 'open', id });

// ── Ids: constructors, parser, guard ────────────────────────────────────────

describe('Mixer workspace — surface ids', () => {
  it('constructs the five namespace shapes exactly as docs/64 §2.1 specifies', () => {
    expect(channelSurfaceId('a')).toBe('ch/a');
    expect(sectionSurfaceId('a', 'params')).toBe('sec/a/params');
    expect(sectionSurfaceId('a', 'pixels')).toBe('sec/a/pixels');
    expect(citizenSurfaceId('masterBand')).toBe('citizen/masterBand');
    expect(citizenSurfaceId('colors')).toBe('citizen/colors');
    expect(MASTER_BAND_ID).toBe('citizen/masterBand');
    expect(COLORS_ID).toBe('citizen/colors');
  });

  it('constructors THROW on a malformed channel id — fail loud, not silent', () => {
    expect(() => channelSurfaceId('')).toThrow();
    expect(() => channelSurfaceId('has/slash')).toThrow();
    expect(() => sectionSurfaceId('', 'params')).toThrow();
    expect(() => sectionSurfaceId('a', 'bogus' as never)).toThrow();
  });

  it('parseMixerSurfaceId is TOTAL — never throws, classifies every shape', () => {
    expect(parseMixerSurfaceId('ch/a')).toEqual({ kind: 'channel', channelId: 'a' });
    expect(parseMixerSurfaceId('sec/a/params')).toEqual({ kind: 'section', channelId: 'a', section: 'params' });
    expect(parseMixerSurfaceId('sec/a/pixels')).toEqual({ kind: 'section', channelId: 'a', section: 'pixels' });
    expect(parseMixerSurfaceId('citizen/masterBand')).toEqual({ kind: 'citizen', citizen: 'masterBand' });
    expect(parseMixerSurfaceId('citizen/colors')).toEqual({ kind: 'citizen', citizen: 'colors' });
    const junk: unknown[] = [
      undefined, null, 0, 1, '', 'bogus', 'ch/', 'sec/a', 'sec/a/bogus', 'sec//params',
      'citizen/bogus', {}, [], Symbol('x'), () => {},
    ];
    for (const value of junk) {
      expect(() => parseMixerSurfaceId(value)).not.toThrow();
      expect(parseMixerSurfaceId(value).kind).toBe('invalid');
    }
  });

  it('isMixerSurfaceId mirrors the parser', () => {
    expect(isMixerSurfaceId('ch/a')).toBe(true);
    expect(isMixerSurfaceId('sec/a/pixels')).toBe(true);
    expect(isMixerSurfaceId('citizen/colors')).toBe(true);
    expect(isMixerSurfaceId('bogus')).toBe(false);
    expect(isMixerSurfaceId(7)).toBe(false);
  });

  it('round-trips constructor -> parser for every namespace', () => {
    expect(parseMixerSurfaceId(channelSurfaceId('xyz'))).toEqual({ kind: 'channel', channelId: 'xyz' });
    expect(parseMixerSurfaceId(sectionSurfaceId('xyz', 'params')))
      .toEqual({ kind: 'section', channelId: 'xyz', section: 'params' });
    expect(parseMixerSurfaceId(citizenSurfaceId('masterBand'))).toEqual({ kind: 'citizen', citizen: 'masterBand' });
  });

  it('pins the persistence key', () => {
    expect(MIXER_WORKSPACE_LAYOUT_KEY).toBe('mixer_workspace_layout_v1');
  });
});

// ── §2.3 invariant: a store from TODAY's build hydrates to TODAY's screen ──

describe('Mixer workspace — the §2.3 invariant (today\'s build hydrates to today\'s screen)', () => {
  it('no workspace key at all (undefined) -> every channel + section visible, BOTH citizens closed', () => {
    const layout = normalizeLayout(undefined, ROSTER);
    expect(visibleChannels(ROSTER, layout)).toEqual(['a', 'b', 'c']);
    expect(isSectionShown(layout, 'a', 'params')).toBe(true);
    expect(isSectionShown(layout, 'a', 'pixels')).toBe(true);
    // docs/67 §2.4 consequence 2: masterBand joined COLORS in the shipped
    // default-closed set on the operator's ruling.
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    expect(isCitizenShown(layout, 'colors')).toBe(false);
  });

  it('null / non-object input hydrates the same as undefined', () => {
    for (const junk of [null, 'nope', 42, [], true]) {
      const layout = normalizeLayout(junk, ROSTER);
      expect(visibleChannels(ROSTER, layout)).toEqual(['a', 'b', 'c']);
      expect(isCitizenShown(layout, 'colors')).toBe(false);
      expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    }
  });

  it('a store with `closed` but NO `known` field hydrates to exactly what it names, plus shipped defaults for the rest', () => {
    const layout = normalizeLayout({ closed: ['ch/a'] }, ROSTER);
    // 'a' was explicitly closed by whoever wrote this store — honored verbatim.
    expect(visibleChannels(ROSTER, layout)).toEqual(['b', 'c']);
    // COLORS was never named, and this store has no opinion about anything
    // (no `known` at all) -> COLORS falls back to its shipped default: closed.
    expect(isCitizenShown(layout, 'colors')).toBe(false);
    // masterBand was never named either -> its shipped default, now closed
    // (docs/67 §2). Sections still default visible.
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    expect(isSectionShown(layout, 'b', 'params')).toBe(true);
  });

  it('initialLayout() is exactly normalizeLayout(undefined, roster)', () => {
    expect(initialLayout(ROSTER)).toEqual(normalizeLayout(undefined, ROSTER));
  });
});

// ── The new-id policy table (docs/64 §2.3) — one test per row ──────────────

describe('Mixer workspace — new-id policy table (§2.3), one row per case', () => {
  it('a channel id absent from `known` -> VISIBLE (content, not chrome: an operator-created channel is already painting the rig)', () => {
    // Store from before channel 'd' existed: `known` names only a, b, c.
    const known = ['ch/a', 'sec/a/params', 'sec/a/pixels', 'ch/b', 'sec/b/params', 'sec/b/pixels',
      'ch/c', 'sec/c/params', 'sec/c/pixels', 'citizen/masterBand', 'citizen/colors'];
    const stored = { closed: [], known };
    const rosterWithD = ['a', 'b', 'c', 'd'];
    const layout = normalizeLayout(stored, rosterWithD);
    expect(visibleChannels(rosterWithD, layout)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a sec/... id absent from `known` -> VISIBLE (shipped default = today\'s screen, both params and pixels)', () => {
    // `known` only ever named the channel window itself, never its sections
    // (simulating a pre-sections store) -> both sections still default open.
    const stored = { closed: [], known: ['ch/a', 'citizen/masterBand', 'citizen/colors'] };
    const layout = normalizeLayout(stored, ['a']);
    expect(isSectionShown(layout, 'a', 'params')).toBe(true);
    expect(isSectionShown(layout, 'a', 'pixels')).toBe(true);
  });

  it('citizen/masterBand absent from `known` -> CLOSED (docs/67 §2, operator ruling)', () => {
    // docs/67 §2.4 consequence 3: a SYNTHETIC `known` without the band (no
    // real store can be in this state — every one records it) still lands on
    // the new shipped default, proving the flip goes through the same one
    // `shippedDefaultClosed` gate as COLORS and not through a special case.
    const stored = { closed: [], known: ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/colors'] };
    const layout = normalizeLayout(stored, ['a']);
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
  });

  it('citizen/colors absent from `known` -> CLOSED (new chrome defaults closed, the `_225` rule)', () => {
    const stored = { closed: [], known: ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/masterBand'] };
    const layout = normalizeLayout(stored, ['a']);
    expect(isCitizenShown(layout, 'colors')).toBe(false);
  });

  it('the inverse also holds: any id the store DID know about and left open stays open, regardless of namespace', () => {
    const known = ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/masterBand', 'citizen/colors'];
    const layout = normalizeLayout({ closed: [], known }, ['a']);
    // COLORS' shipped default is closed, but this store KNEW about it and
    // deliberately left it open -> the operator's choice wins.
    expect(isCitizenShown(layout, 'colors')).toBe(true);
  });

  it('SHIPPED_DEFAULT_CLOSED_CITIZENS names BOTH citizens (docs/67 §2.1) and never a channel', () => {
    expect(SHIPPED_DEFAULT_CLOSED_CITIZENS).toEqual(['colors', 'masterBand']);
  });
});

// ── docs/67 §2 — the masterBand default flip, consequences 1–5 verbatim ─────
//
// The flip is FRESH-STORES-ONLY by construction: `normalizeLayout`'s
// `wasKnown` gate exempts every store that recorded `citizen/masterBand` in
// `known`, and every mixer store ever written did (docs/64 §2.3 pinned that
// there is no legacy pre-`known` mixer store). These five tests are the
// contract's own list, in its order.

describe('Mixer workspace — docs/67 §2: masterBand defaults CLOSED, fresh stores only', () => {
  it('1. UPGRADE SAFETY: {closed:[], known:[…incl citizen/masterBand]} keeps the band OPEN', () => {
    // The pre-flip store's screen is reproduced exactly — this is the whole
    // reason docs/67 §2.2 rejected a migration. Mutation-honest: revert the
    // `wasKnown` gate and this goes red.
    const known = [
      'ch/a', 'sec/a/params', 'sec/a/pixels',
      'ch/b', 'sec/b/params', 'sec/b/pixels',
      'ch/c', 'sec/c/params', 'sec/c/pixels',
      'citizen/masterBand', 'citizen/colors',
    ];
    const layout = normalizeLayout({ closed: [], known }, ROSTER);
    expect(isCitizenShown(layout, 'masterBand')).toBe(true);
    expect(isCitizenShown(layout, 'colors')).toBe(true);
    expect(layout.closed).toEqual([]);
  });

  it('1b. an existing store that had already HIDDEN the band by hand keeps it hidden', () => {
    const known = ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/masterBand', 'citizen/colors'];
    const layout = normalizeLayout({ closed: ['citizen/masterBand'], known }, ['a']);
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    // …and the flip did not double-append it.
    expect(layout.closed.filter((id) => id === MASTER_BAND_ID)).toHaveLength(1);
  });

  it('2. NO KEY AT ALL: band CLOSED, and the fresh rail order is MASTER VIEW then COLORS', () => {
    const layout = normalizeLayout(undefined, ROSTER);
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    expect(isCitizenShown(layout, 'colors')).toBe(false);
    // Close-order IS append order, and the normalizer appends while walking
    // `knownSetFor(roster)` — which emits MASTER_BAND_ID before COLORS_ID. So
    // the fresh restore rail reads MASTER VIEW, COLORS (docs/67 §2.4 #2).
    expect(layout.closed).toEqual([MASTER_BAND_ID, COLORS_ID]);
  });

  it('3. SYNTHETIC `known` without citizen/masterBand -> CLOSED', () => {
    const stored = { closed: [], known: ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/colors'] };
    expect(isCitizenShown(normalizeLayout(stored, ['a']), 'masterBand')).toBe(false);
  });

  it('4. RESET now closes the band — and still never closes a channel', () => {
    let layout = initialLayout(ROSTER);
    layout = open(layout, MASTER_BAND_ID);
    layout = open(layout, COLORS_ID);
    layout = close(layout, channelSurfaceId('a'));
    expect(isCitizenShown(layout, 'masterBand')).toBe(true);

    const reset = layoutReducer(layout, { type: 'reset' });
    expect(isCitizenShown(reset, 'masterBand')).toBe(false);
    expect(isCitizenShown(reset, 'colors')).toBe(false);
    // The floor is untouchable by construction: `shippedDefaultClosed` is
    // citizen-only, so no `ch/` id can ever enter the reset-closed set.
    expect(visibleChannels(ROSTER, reset)).toEqual(['a', 'b', 'c']);
    expect(reset.closed.every((id) => parseMixerSurfaceId(id).kind === 'citizen')).toBe(true);
    expect(reset.closed).toEqual([MASTER_BAND_ID, COLORS_ID]);
  });

  it('5. PERF on a FRESH store shows NO master band (perf never resurrects a closed citizen)', () => {
    // docs/67 §2.4 #5 / D2, accepted: the thin strip residue carries the
    // master's honesty, and MASTER VIEW is one chip-tap away.
    const layout = normalizeLayout(undefined, ROSTER);
    expect(effectiveCitizenShown(layout, 'masterBand', true)).toBe(false);
    expect(effectiveCitizenShown(layout, 'masterBand', false)).toBe(false);
    // A store that KNEW the band and left it open still gets it in perf.
    const known = ['ch/a', 'sec/a/params', 'sec/a/pixels', 'citizen/masterBand', 'citizen/colors'];
    const upgraded = normalizeLayout({ closed: [], known }, ['a']);
    expect(effectiveCitizenShown(upgraded, 'masterBand', true)).toBe(true);
  });

  it('the flip survives a serialize → normalize round trip unchanged (mid-show store stability)', () => {
    const fresh = initialLayout(ROSTER);
    const wire = JSON.parse(JSON.stringify(serializeLayout(fresh, ROSTER)));
    // The round trip now records masterBand in `known`, so re-hydrating is a
    // fixpoint rather than a second application of the default.
    expect(normalizeLayout(wire, ROSTER)).toEqual(fresh);
  });
});

// ── Floor (D1) ───────────────────────────────────────────────────────────

describe('Mixer workspace — floor: never close the last visible channel', () => {
  it('the reducer refuses to close the last visible channel', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = close(layout, 'ch/b');
    expect(visibleChannels(ROSTER, layout)).toEqual(['c']);
    const refused = close(layout, 'ch/c');
    expect(refused).toBe(layout); // same-reference no-op
    expect(visibleChannels(ROSTER, refused)).toEqual(['c']);
  });

  it('closing sections or citizens is never floor-limited, even with one channel left', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = close(layout, 'ch/b');
    layout = close(layout, 'sec/c/params');
    layout = close(layout, 'citizen/masterBand');
    layout = close(layout, 'citizen/colors');
    expect(visibleChannels(ROSTER, layout)).toEqual(['c']);
    expect(isSectionShown(layout, 'c', 'params')).toBe(false);
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
  });

  it('the floor is evaluated against the ROSTER the close action carries, not some other roster', () => {
    // Only 'a' is visible against a NARROWER roster of just [a] -> refuse.
    const layout: MixerWorkspaceLayout = { closed: ['ch/b', 'ch/c'], known: initialLayout(ROSTER).known };
    expect(close(layout, 'ch/a', ['a'])).toBe(layout);
    // Against a roster where a second channel is genuinely still open, the
    // same close succeeds — the roster argument is what the floor check
    // reads, not some other ambient state.
    const twoOpen: MixerWorkspaceLayout = { closed: ['ch/c'], known: initialLayout(ROSTER).known };
    expect(visibleChannels(ROSTER, twoOpen)).toEqual(['a', 'b']);
    const afterClose = close(twoOpen, 'ch/a', ROSTER);
    expect(visibleChannels(ROSTER, afterClose)).toEqual(['b']);
  });

  it('the normalizer purges a hand-edited ALL-HIDDEN store back to the floor', () => {
    const stored = { closed: ['ch/a', 'ch/b', 'ch/c'], known: initialLayout(ROSTER).known };
    const layout = normalizeLayout(stored, ROSTER);
    // The FIRST channel in canonical order is force-reopened.
    expect(visibleChannels(ROSTER, layout)).toEqual(['a']);
  });

  it('the normalizer floor backstop is a no-op when the store is already floor-safe', () => {
    const stored = { closed: ['ch/a', 'ch/b'], known: initialLayout(ROSTER).known };
    const layout = normalizeLayout(stored, ROSTER);
    expect(visibleChannels(ROSTER, layout)).toEqual(['c']);
  });

  it('an empty roster never trips the floor backstop (nothing to protect)', () => {
    expect(() => normalizeLayout({ closed: [] }, [])).not.toThrow();
  });
});

// ── Reducer basics: no-ops, unknown ids, unknown action type ───────────────

describe('Mixer workspace — reducer basics', () => {
  it('close then close again is a same-reference no-op', () => {
    const once = close(initialLayout(ROSTER), 'ch/a');
    expect(close(once, 'ch/a')).toBe(once);
  });

  it('open on an already-open id is a same-reference no-op', () => {
    const layout = initialLayout(ROSTER);
    expect(open(layout, 'ch/a')).toBe(layout);
  });

  it('reset on an already-default layout is a same-reference no-op', () => {
    const layout = initialLayout(ROSTER);
    expect(layoutReducer(layout, { type: 'reset' })).toBe(layout);
  });

  it('reset restores shipped-default membership from `known`, dropping any operator overrides', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = open(layout, 'citizen/colors');
    const reset = layoutReducer(layout, { type: 'reset' });
    expect(visibleChannels(ROSTER, reset)).toEqual(['a', 'b', 'c']);
    expect(isCitizenShown(reset, 'colors')).toBe(false);
  });

  it('an unknown/malformed id is a no-op for close and open, never throws', () => {
    const layout = initialLayout(ROSTER);
    expect(close(layout, 'bogus')).toBe(layout);
    expect(open(layout, 'bogus')).toBe(layout);
  });

  it('THROWS on an unknown action type — coding bug, fail loud', () => {
    const layout = initialLayout(ROSTER);
    expect(() => layoutReducer(layout, { type: 'wat' } as unknown as MixerLayoutAction))
      .toThrow(/unknown layout action/);
  });
});

// ── Round-trip stability ────────────────────────────────────────────────

describe('Mixer workspace — round-trip stability', () => {
  it('normalize(serialize(x)) is a fixpoint for every reachable layout', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = close(layout, 'sec/b/pixels');
    layout = open(layout, 'citizen/colors');
    const wire = JSON.parse(JSON.stringify(serializeLayout(layout, ROSTER)));
    expect(normalizeLayout(wire, ROSTER)).toEqual(layout);
  });

  it('fixpoint holds for the untouched initial layout too', () => {
    const layout = initialLayout(ROSTER);
    const wire = JSON.parse(JSON.stringify(serializeLayout(layout, ROSTER)));
    expect(normalizeLayout(wire, ROSTER)).toEqual(layout);
  });

  it('serializeLayout defensively copies — mutating the result cannot poison state', () => {
    const layout = initialLayout(ROSTER);
    const wire = serializeLayout(layout, ROSTER);
    expect(wire.closed).not.toBe(layout.closed);
    wire.closed.push('ch/z');
    expect(layout.closed).not.toContain('ch/z');
  });

  it('serializeLayout stamps `known` = roster ∪ citizens ∪ sections-for-roster, fresh, every time', () => {
    const layout = initialLayout(ROSTER);
    const wire = serializeLayout(layout, ROSTER);
    expect(wire.known).toEqual([
      'ch/a', 'sec/a/params', 'sec/a/pixels',
      'ch/b', 'sec/b/params', 'sec/b/pixels',
      'ch/c', 'sec/c/params', 'sec/c/pixels',
      'citizen/masterBand', 'citizen/colors',
    ]);
  });
});

// ── Roster pruning (§2.3) ───────────────────────────────────────────────

describe('Mixer workspace — roster pruning only commits against a CONFIRMED roster', () => {
  it('an UNCONFIRMED roster retains everything — same-reference no-op', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    const shrunkRoster = ['a', 'b']; // 'c' looks gone, but this snapshot is unconfirmed
    const after = commitRoster(layout, shrunkRoster, false);
    expect(after).toBe(layout);
    expect(layout.closed).toContain('ch/c');
  });

  it('a CONFIRMED roster commit prunes ch/ and sec/ entries for channels no longer present', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    layout = close(layout, 'sec/c/pixels');
    layout = close(layout, 'ch/a'); // stays — 'a' is still in the roster
    const after = commitRoster(layout, ['a', 'b'], true);
    // BOTH citizens are closed by shipped default from `initialLayout` too,
    // and citizens are NEVER pruned (they are static, not roster-derived).
    expect(after.closed).toEqual(['citizen/masterBand', 'citizen/colors', 'ch/a']);
    expect(after.known).toEqual([
      'ch/a', 'sec/a/params', 'sec/a/pixels',
      'ch/b', 'sec/b/params', 'sec/b/pixels',
      'citizen/masterBand', 'citizen/colors',
    ]);
  });

  it('citizens are never pruned by a roster commit, whatever the roster', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'citizen/colors'); // already closed by default, but be explicit
    layout = close(layout, 'citizen/masterBand');
    const after = commitRoster(layout, [], true);
    expect(after.closed).toContain('citizen/masterBand');
    expect(after.closed).toContain('citizen/colors');
  });

  it('a confirmed commit that changes nothing is a same-reference no-op', () => {
    const layout = initialLayout(ROSTER);
    expect(commitRoster(layout, ROSTER, true)).toBe(layout);
  });

  it('a pruned-then-returning channel id behaves as NEW -> visible', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = close(layout, 'sec/a/params');
    // 'a' leaves the roster and the commit prunes it out of storage entirely.
    layout = commitRoster(layout, ['b', 'c'], true);
    expect(layout.closed).not.toContain('ch/a');
    expect(layout.closed).not.toContain('sec/a/params');
    // 'a' comes back (new engine session, same id reused) -> commit again,
    // then hydrate against the fresh roster: it renders VISIBLE, exactly
    // like a channel this build never heard of before.
    layout = commitRoster(layout, ['a', 'b', 'c'], true);
    expect(visibleChannels(['a', 'b', 'c'], layout)).toEqual(['a', 'b', 'c']);
    expect(isSectionShown(layout, 'a', 'params')).toBe(true);
  });

  it('an unconfirmed roster never prunes even across repeated commits', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    layout = commitRoster(layout, ['a'], false);
    layout = commitRoster(layout, [], false);
    expect(layout.closed).toContain('ch/c');
  });
});

// ── Selectors: canonical vs close order ─────────────────────────────────

describe('Mixer workspace — selector order guarantees', () => {
  it('visibleChannels is CANONICAL (roster) order, independent of open/close order', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    layout = close(layout, 'ch/a');
    layout = open(layout, 'ch/c');
    // Restored 'c' before 'a', but the visible list still reads roster order.
    expect(visibleChannels(ROSTER, layout)).toEqual(['b', 'c']);
  });

  it('hiddenChannelChips is CLOSE order', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    layout = close(layout, 'ch/a');
    expect(hiddenChannelChips(ROSTER, layout)).toEqual(['c', 'a']);
  });

  it('hiddenChannelChips excludes channels outside the roster (pruning is a render-time filter too)', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    expect(hiddenChannelChips(['a', 'b'], layout)).toEqual([]);
  });
});

// ── Reopen must be proportional (operator addendum) ─────────────────────
// "reopening a surface from an all-hidden state must return it at its
// SHIPPED DEFAULT weight, never swallow the screen." This module has no
// per-item weight concept at all (that lives in the render layer, if
// anywhere) — the addendum's guarantee here is structural: canonical order,
// shipped-default section membership, and full content equality after a
// close/open round trip. Nothing in this store can ever encode "this one is
// now special."

describe('Mixer workspace — reopen proportionality', () => {
  it('closing every channel down to the floor, then reopening all, restores CANONICAL order', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    layout = close(layout, 'ch/b'); // 'a' is now the floor — 'a' cannot close
    expect(visibleChannels(ROSTER, layout)).toEqual(['a']);
    // Reopen in a DELIBERATELY non-canonical order.
    layout = open(layout, 'ch/c');
    layout = open(layout, 'ch/b');
    // Canonical order wins regardless of restore order — 'c' was restored
    // first but still lands after 'b'.
    expect(visibleChannels(ROSTER, layout)).toEqual(['a', 'b', 'c']);
  });

  it('a close -> open round trip on a channel is content-equal to the pre-close state', () => {
    const before = initialLayout(ROSTER);
    const after = open(close(before, 'ch/b'), 'ch/b');
    expect(after).toEqual(before);
  });

  it('a close -> open round trip on a section returns it at its shipped-default (visible) membership', () => {
    const before = initialLayout(ROSTER);
    const after = open(close(before, 'sec/a/pixels'), 'sec/a/pixels');
    expect(isSectionShown(after, 'a', 'pixels')).toBe(true);
    expect(after).toEqual(before);
  });

  it('everything hidden down to the floor (channels + every section + every citizen), then fully reopened, is content-equal to the initial layout', () => {
    let layout = initialLayout(ROSTER);
    for (const chId of ROSTER) layout = close(layout, `sec/${chId}/params`);
    for (const chId of ROSTER) layout = close(layout, `sec/${chId}/pixels`);
    // BOTH citizens are already closed by shipped default (docs/67 §2), so
    // these two closes are same-reference no-ops — asserted, so a future
    // default flip cannot silently turn this into a real state change.
    expect(close(layout, 'citizen/masterBand')).toBe(layout);
    expect(close(layout, 'citizen/colors')).toBe(layout);
    layout = close(layout, 'ch/b');
    layout = close(layout, 'ch/c'); // 'a' is the floor, refuses to close
    expect(visibleChannels(ROSTER, layout)).toEqual(['a']);

    // Reopen everything, in a shuffled order.
    layout = open(layout, 'ch/c');
    layout = open(layout, 'sec/b/params');
    layout = open(layout, 'ch/b');
    layout = open(layout, 'sec/a/pixels');
    layout = open(layout, 'sec/c/pixels');
    layout = open(layout, 'sec/a/params');
    layout = open(layout, 'sec/c/params');
    layout = open(layout, 'sec/b/pixels');

    expect(layout).toEqual(initialLayout(ROSTER));
    expect(visibleChannels(ROSTER, layout)).toEqual(['a', 'b', 'c']);
  });

  it('a reopened channel never gets appended past siblings that were never touched', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/a');
    layout = open(layout, 'ch/a');
    // 'a' is back in its engine-order slot, first — not last.
    expect(visibleChannels(ROSTER, layout)).toEqual(['a', 'b', 'c']);
  });
});

// ── Performance overlay: pure derivation, never persisted ──────────────────

describe('Mixer workspace — performance overlay (§2.6), derived, never persisted', () => {
  it('suppresses PARAMS on visible channels only', () => {
    expect(PERF_SUPPRESSED_SECTION).toBe('params');
    const layout = initialLayout(ROSTER);
    expect(effectiveSectionShown(layout, 'a', 'params', true)).toBe(false);
    expect(effectiveSectionShown(layout, 'a', 'params', false)).toBe(true);
  });

  it('leaves PIXELS alone — perf only touches params', () => {
    const layout = initialLayout(ROSTER);
    expect(effectiveSectionShown(layout, 'a', 'pixels', true)).toBe(true);
  });

  it('never resurrects a section the operator explicitly hid, in or out of perf mode', () => {
    const layout = close(initialLayout(ROSTER), 'sec/a/pixels');
    expect(effectiveSectionShown(layout, 'a', 'pixels', true)).toBe(false);
    expect(effectiveSectionShown(layout, 'a', 'pixels', false)).toBe(false);
  });

  it('never reopens a citizen the operator closed — effectiveCitizenShown === isCitizenShown always', () => {
    const layout = initialLayout(ROSTER); // colors starts closed
    expect(effectiveCitizenShown(layout, 'colors', true)).toBe(isCitizenShown(layout, 'colors'));
    expect(effectiveCitizenShown(layout, 'colors', false)).toBe(isCitizenShown(layout, 'colors'));
    expect(effectiveCitizenShown(layout, 'colors', true)).toBe(false);

    const withMasterHidden = close(layout, 'citizen/masterBand');
    // The master band's forced-open-in-perf rule is the RENDER layer's
    // business; this module only guarantees it can never widen visibility —
    // so a closed masterBand stays exactly as closed under perf here.
    expect(effectiveCitizenShown(withMasterHidden, 'masterBand', true)).toBe(false);
  });

  it('the round trip is byte-identical: entering and leaving perf writes nothing to the layout', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/b');
    layout = close(layout, 'sec/a/pixels');
    const before = JSON.stringify(layout);
    effectiveSectionShown(layout, 'a', 'params', true);
    effectiveSectionShown(layout, 'c', 'pixels', true);
    effectiveCitizenShown(layout, 'colors', true);
    effectiveCitizenShown(layout, 'masterBand', true);
    effectiveSectionShown(layout, 'a', 'params', false);
    effectiveCitizenShown(layout, 'colors', false);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('a byte-identical snapshot across a full enter/exit walk over every namespace', () => {
    let layout = initialLayout(ROSTER);
    layout = close(layout, 'ch/c');
    const snapshotBefore = JSON.parse(JSON.stringify(layout));

    // "Enter" perf: read every derived view.
    for (const chId of ROSTER) {
      effectiveSectionShown(layout, chId, 'params', true);
      effectiveSectionShown(layout, chId, 'pixels', true);
    }
    effectiveCitizenShown(layout, 'masterBand', true);
    effectiveCitizenShown(layout, 'colors', true);

    // "Exit" perf: read every derived view again, perf off.
    for (const chId of ROSTER) {
      effectiveSectionShown(layout, chId, 'params', false);
      effectiveSectionShown(layout, chId, 'pixels', false);
    }
    effectiveCitizenShown(layout, 'masterBand', false);
    effectiveCitizenShown(layout, 'colors', false);

    expect(layout).toEqual(snapshotBefore);
    // And what perf-off shows is exactly the persisted truth.
    expect(effectiveSectionShown(layout, 'a', 'params', false)).toBe(isSectionShown(layout, 'a', 'params'));
  });
});

/**
 * Bug #1 — "Can't remove or change an effect in CaptainPad."
 *
 * Root cause (verified against marsin_engine/lib/global_effect_slot_manager.js):
 * the REMOVE action PATCHes `{ enabled:false }`, and the engine's clear KEEPS
 * the slot's `effectId` (it only flips `enabled`). The strip decided
 * bound-vs-empty on `effectId` ALONE, so a cleared slot kept rendering its old
 * effect forever — the operator "couldn't remove" it. These tests pin the
 * enabled+effectId predicate so a disabled slot renders EMPTY and the UI
 * reflects the removal / swap immediately.
 */
import { describe, it, expect } from 'vitest';
import {
  slotIsBound,
  computeVisibleSlots,
  computePageActivity,
  slotIdForPage,
  resolveEffectsPage,
  SHOW_EFFECT_PAGES,
  VISIBLE_SLOT_COUNT,
  SlotBindingLike,
  resolveEffectsPresentation,
  DEFAULT_EFFECT_BANKS_STATE,
  SYNTHETIC_DEFAULT_BANK_ID,
  reconcileEffectBanks,
  ensureAtLeastOneBank,
  isEffectBanksMessage,
  deployBannerMessage,
  modeBadge,
  bankBadgeLabel,
  BANKS_UI_ENABLED,
  type EffectBanksState,
} from './global_effect_macros_logic';

const empty = (slotId: number): SlotBindingLike & { slotId: number } => ({
  slotId, effectId: '', enabled: false, active: false,
});

// ── Multi-bank effects UX — SHELVED (BANKS_UI_ENABLED) ───────────────────────
// Operator decision 2026-07-14: revert to a SINGLE fixed set of 8 effects. The
// multi-bank UX (BANK badge + ＋/delete BankControls + VSN1 sb_2 cycle) is gated
// OFF behind BANKS_UI_ENABLED. These tests pin the flag's shipped value AND that
// the bank MACHINERY (pure helpers below) is KEPT dormant so a flag flip restores
// the feature with no other change. The "no badge / no controls / no sb_2
// dispatch" behaviors are asserted at their call sites: BankControls returns null
// + bankBadgeEl is null in GlobalEffectMacros.tsx (proven by the render
// screenshot), and sb_2's inert dispatch in
// utils/midi/scenarios/vsn1_feedback_pipeline.test.ts.
describe('BANKS_UI_ENABLED — multi-bank UX shelved (single fixed bank)', () => {
  it('ships OFF — the rig runs a single fixed set of 8 effects, no bank chrome', () => {
    expect(BANKS_UI_ENABLED).toBe(false);
  });

  it('KEEPS the bank machinery dormant (helpers intact behind the flag)', () => {
    // The engine still serves a single migrated bank via the bank-agnostic
    // status path; these pure helpers stay wired so flipping the flag restores
    // the badge/controls verbatim. Guard that they still resolve a coherent >=1
    // bank state (a synthetic Default is surfaced, never hidden).
    const ensured = ensureAtLeastOneBank({ banks: [], activeBankId: null });
    expect(ensured.banks.length).toBeGreaterThanOrEqual(1);
    expect(bankBadgeLabel(DEFAULT_EFFECT_BANKS_STATE)).toMatch(/BANK:/);
  });
});

describe('slotIsBound (the can-not-remove fix)', () => {
  it('a bound slot (enabled + effectId) is bound', () => {
    expect(slotIsBound({ slotId: 1, effectId: 'strobe', enabled: true })).toBe(true);
  });

  it('a CLEARED slot (enabled:false but stale effectId kept by the engine) is EMPTY', () => {
    // This is the exact engine post-clear shape: patchSlot({enabled:false})
    // leaves effectId set. Pre-fix this rendered as bound → "can't remove".
    expect(slotIsBound({ slotId: 1, effectId: 'strobe', enabled: false })).toBe(false);
  });

  it('a truly empty slot (no effectId) is empty', () => {
    expect(slotIsBound({ slotId: 1, effectId: '', enabled: true })).toBe(false);
    expect(slotIsBound({ slotId: 1, enabled: true })).toBe(false);
  });

  it('a slot with effectId but no enabled field (legacy) is bound (enabled defaults truthy)', () => {
    // enabled === undefined must NOT read as disabled — only an explicit false clears.
    expect(slotIsBound({ slotId: 1, effectId: 'strobe' })).toBe(true);
  });

  it('null/undefined is empty', () => {
    expect(slotIsBound(null)).toBe(false);
    expect(slotIsBound(undefined)).toBe(false);
  });
});

describe('computeVisibleSlots — REMOVE reflects to the UI', () => {
  it('a removed effect (enabled:false) shows the empty stencil, not the stale effect', () => {
    // Slot 1 was bound to strobe; the operator hit REMOVE → engine returns it
    // enabled:false with effectId STILL 'strobe'. The cell must render empty.
    const slots: SlotBindingLike[] = [{ slotId: 1, effectId: 'strobe', enabled: false, active: false }];
    const cells = computeVisibleSlots(slots, 0, empty);
    expect(cells).toHaveLength(VISIBLE_SLOT_COUNT);
    expect(slotIsBound(cells[0])).toBe(false);     // slot 1 now EMPTY (removed)
    expect(cells[0].slotId).toBe(1);
  });

  it('a swapped effect (enabled:true, new effectId) reflects the new binding', () => {
    const slots: SlotBindingLike[] = [{ slotId: 1, effectId: 'colorWash', enabled: true, active: false }];
    const cells = computeVisibleSlots(slots, 0, empty);
    expect(slotIsBound(cells[0])).toBe(true);
    expect(cells[0].effectId).toBe('colorWash');
  });

  it('always yields exactly VISIBLE_SLOT_COUNT cells, padding missing slots empty', () => {
    const cells = computeVisibleSlots([], 0, empty);
    expect(cells).toHaveLength(VISIBLE_SLOT_COUNT);
    expect(cells.every((c) => !slotIsBound(c))).toBe(true);
  });
});

describe('computeVisibleSlots — page window', () => {
  it('page p shows flat slot ids 8p+1..8p+8', () => {
    // Bind slot 17 (page 2, key 0). Only page 2 shows it.
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: true, active: true }];
    const p2 = computeVisibleSlots(slots, 2, empty);
    expect(p2[0].slotId).toBe(slotIdForPage(2, 0)); // 17
    expect(slotIsBound(p2[0])).toBe(true);
    // Page 0 does NOT show slot 17.
    const p0 = computeVisibleSlots(slots, 0, empty);
    expect(p0.every((c) => !slotIsBound(c))).toBe(true);
  });
});

describe('resolveEffectsPage — party single-page layout (SHOW_EFFECT_PAGES)', () => {
  it('the party ships with the pager HIDDEN (single-page layout)', () => {
    // Guards the intended shipping state: the 4-page switcher is off because
    // the VSN1 side buttons no longer page. Flipping the flag on is a deliberate
    // choice, and flipping it should light up the switcher tests below.
    expect(SHOW_EFFECT_PAGES).toBe(false);
  });

  it('pins the render page to 0 when the pager is hidden, whatever the engine page', () => {
    // Even a stale/persisted non-zero engine page renders page 0 (the grid shows
    // the party-8 layout). This is the "render page 1 anyway" contract.
    expect(resolveEffectsPage(0, false)).toBe(0);
    expect(resolveEffectsPage(2, false)).toBe(0);
    expect(resolveEffectsPage(3, false)).toBe(0);
  });

  it('honours the engine page verbatim when the pager is shown', () => {
    expect(resolveEffectsPage(0, true)).toBe(0);
    expect(resolveEffectsPage(2, true)).toBe(2);
  });

  it('defaults to the shipping SHOW_EFFECT_PAGES flag when no override is passed', () => {
    // With the flag false, the one-arg form pins page 0 — the grid can never
    // render a non-party page while the switcher is hidden.
    expect(resolveEffectsPage(3)).toBe(SHOW_EFFECT_PAGES ? 3 : 0);
  });
});

describe('computePageActivity — cleared slots drop their dot', () => {
  it('an active bound slot lights its page dot', () => {
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: true, active: true }];
    expect(computePageActivity(slots)).toEqual([false, false, true, false]);
  });

  it('a cleared-but-still-active-flag slot does NOT light its page dot', () => {
    // After a clear the engine may still report active:true briefly with the
    // stale effectId; since it is disabled it must count as empty (no dot).
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: false, active: true }];
    expect(computePageActivity(slots)).toEqual([false, false, false, false]);
  });
});

// ── Effects grid presentation is INVARIANT across the controller profile ─────
// Operator requirement (2026-07): the CaptainPad effects UI must ALWAYS look and
// behave the same regardless of the VSN1 controller profile. The profile is a
// device-surface concept only — it must have ZERO effect on this grid. These
// tests pin the full authoring presentation as the ONE thing the grid renders.

describe('resolveEffectsPresentation — the invariant full-authoring presentation', () => {
  it('renders the full authoring UI: every editing affordance on, base cell size', () => {
    const p = resolveEffectsPresentation();
    expect(p.showEditAffordances).toBe(true);    // ⋯ swap + value/mode detail badge
    expect(p.showEmptySockets).toBe(true);        // tappable "+" bind sockets
    expect(p.showBlackout).toBe(true);            // e-stop always present
    expect(p.cellHeightScale).toBe(1);            // no growth — original sizing
  });

  it('exposes no profile / isPlay coupling (the grid never branches on profile)', () => {
    const p = resolveEffectsPresentation() as unknown as Record<string, unknown>;
    // The presentation must NOT carry a profile or an isPlay flag any more — the
    // grid has nothing to branch on.
    expect('profile' in p).toBe(false);
    expect('isPlay' in p).toBe(false);
  });
});

// ── THE decoupling proof: identical UI for BOTH profile values ───────────────
// resolveEffectsPresentation takes no profile now, so the grid presentation is
// literally the same object shape for every profile. This pins the operator
// contract: ⋯ swap, value/mode param badges, "+" bind sockets, and cell sizing
// are IDENTICAL whether the VSN1 profile is 'edit' or 'play'.

describe('effects grid presentation is IDENTICAL for profile edit AND play', () => {
  it('the resolved presentation does not vary with the (former) profile input', () => {
    // Whatever the controller profile, the grid resolves the SAME presentation.
    const a = resolveEffectsPresentation();
    const b = resolveEffectsPresentation();
    expect(a).toEqual(b);
  });

  it('⋯ swap + value/mode/param badges are shown for BOTH profiles', () => {
    // showEditAffordances gates BOTH the ⋯ swap affordance and the intensity/mode
    // detail badge — it is unconditionally true, so both render for edit AND play.
    expect(resolveEffectsPresentation().showEditAffordances).toBe(true);
  });

  it('the tappable "+" empty sockets are shown for BOTH profiles', () => {
    expect(resolveEffectsPresentation().showEmptySockets).toBe(true);
  });

  it('the cell sizing is the base size (no growth) for BOTH profiles', () => {
    // btnHeight = round(baseHeight * cellHeightScale); scale 1 = tuned base
    // heights, identical regardless of profile (no PLAY 1.5× enlargement).
    expect(resolveEffectsPresentation().cellHeightScale).toBe(1);
  });

  it('the bank state default still surfaces >= 1 (banks drive the CONTENT + badge)', () => {
    // The bank concept drives the VSN1 device cycle (hook + reconcile + sb_2), it
    // just no longer touches this grid's chrome. The shipping default surfaces a
    // single synthetic Default so the badge is never blank.
    expect(DEFAULT_EFFECT_BANKS_STATE.banks.length).toBe(1);
    expect(DEFAULT_EFFECT_BANKS_STATE.activeBankId).toBe(SYNTHETIC_DEFAULT_BANK_ID);
  });
});

describe('reconcileEffectBanks + effectBanks WS message guard', () => {
  const prev: EffectBanksState = { banks: [{ id: 'a', name: 'A' }], activeBankId: 'a' };

  it('a well-formed effectBanks frame wins (adopts banks + activeBankId verbatim)', () => {
    const next = reconcileEffectBanks(prev, {
      type: 'effectBanks', banks: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], activeBankId: 'y',
    });
    expect(next.activeBankId).toBe('y');
    expect(next.banks).toEqual([{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]);
  });

  it('garbage / partial payloads keep last-known-good (never blank the list)', () => {
    expect(reconcileEffectBanks(prev, undefined)).toBe(prev);
    expect(reconcileEffectBanks(prev, { type: 'effectsPage', effectsPage: 1 })).toBe(prev);
    expect(reconcileEffectBanks(prev, { type: 'effectBanks', banks: 'nope', activeBankId: 'a' })).toBe(prev);
    expect(reconcileEffectBanks(prev, { type: 'effectBanks', banks: [{ id: 1 }], activeBankId: 'a' })).toBe(prev);
  });

  it('isEffectBanksMessage accepts the exact broadcast shape (incl. an engine-zero report)', () => {
    expect(isEffectBanksMessage({ type: 'effectBanks', banks: [{ id: 'a', name: 'A' }], activeBankId: 'a' })).toBe(true);
    // A genuine engine-zero report (empty banks, null active) is ACCEPTED so
    // ensureAtLeastOneBank can surface the synthetic Default (D7 — don't hide it).
    expect(isEffectBanksMessage({ type: 'effectBanks', banks: [], activeBankId: null })).toBe(true);
    expect(isEffectBanksMessage({ type: 'effectBanks', banks: [{ id: 'a', name: 5 }], activeBankId: 'a' })).toBe(false);
    expect(isEffectBanksMessage({ type: 'effectBanks', activeBankId: 'a' })).toBe(false);
    expect(isEffectBanksMessage({ type: 'controllerProfile', profile: 'play' })).toBe(false);
    expect(isEffectBanksMessage(null)).toBe(false);
    expect(isEffectBanksMessage('effectBanks')).toBe(false);
  });
});

describe('ensureAtLeastOneBank — the client >= 1 mirror (D7)', () => {
  it('surfaces a synthetic Default when the engine reports ZERO banks (not hidden)', () => {
    const out = ensureAtLeastOneBank({ banks: [], activeBankId: null });
    expect(out.banks.length).toBe(1);
    expect(out.banks[0].id).toBe(SYNTHETIC_DEFAULT_BANK_ID);
    expect(out.activeBankId).toBe(SYNTHETIC_DEFAULT_BANK_ID);
  });

  it('re-points a stale activeBankId at the first present bank', () => {
    const out = ensureAtLeastOneBank({ banks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeBankId: 'gone' });
    expect(out.activeBankId).toBe('a');
  });

  it('passes a coherent state through unchanged (reference-stable)', () => {
    const state: EffectBanksState = { banks: [{ id: 'a', name: 'A' }], activeBankId: 'a' };
    expect(ensureAtLeastOneBank(state)).toBe(state);
  });
});

// ── Mode badge — the performance-mode LOCKED indicator ONLY ──────────────────
// The grid no longer changes with the controller profile, so the old PLAY badge
// variant (escape hatch) is gone. The only remaining badge is LOCKED, and it is
// driven SOLELY by performance mode — never by the profile.

describe('modeBadge — performance-mode LOCKED indicator (no profile coupling)', () => {
  it('perfLocked → a passive LOCKED badge (explains the inert ⋯/＋)', () => {
    const b = modeBadge(true);
    expect(b).not.toBeNull();
    expect(b!.kind).toBe('locked');
    expect(b!.label).toBe('LOCKED — performance mode');
  });

  it('unlocked → NO badge (the grid looks exactly as it always has)', () => {
    expect(modeBadge(false)).toBeNull();
  });

  it('there is NO play badge variant any more (removed with the UI degradation)', () => {
    // modeBadge only ever returns a LOCKED badge or null — the profile can never
    // produce a badge (the grid is invariant across profiles).
    expect(modeBadge(false)).toBeNull();
    expect(modeBadge(true)!.kind).toBe('locked');
  });
});

// ── Bank badge — the neutral, informational active-bank label + position ─────
// The active bank selects WHICH effects populate the slots (content). A small
// neutral badge names the active bank (and, when n>1, its position i/n) so the
// operator can see which set they're looking at. It is CONTENT-only — it never
// changes chrome/sizing/affordances (that's the invariant presentation) and is
// styled neutrally (NOT the amber/red LOCKED alarm). This pins the pure copy.

describe('bankBadgeLabel — active-bank name + position', () => {
  it('a single bank shows the NAME only (no position — nothing to disambiguate)', () => {
    expect(bankBadgeLabel({ banks: [{ id: 'a', name: 'Default' }], activeBankId: 'a' }))
      .toBe('BANK: Default');
  });

  it('multiple banks show the active NAME + its 1-based position (i/n)', () => {
    const state: EffectBanksState = {
      banks: [{ id: 'a', name: 'Chill' }, { id: 'b', name: 'Party' }, { id: 'c', name: 'Peak' }],
      activeBankId: 'b',
    };
    expect(bankBadgeLabel(state)).toBe('BANK: Party (2/3)');
  });

  it('a zero-bank state surfaces the synthetic Default (>= 1 mirror, no position)', () => {
    expect(bankBadgeLabel({ banks: [], activeBankId: null })).toBe('BANK: Default');
  });

  it('a stale activeBankId falls back to the first bank + position 1', () => {
    const state: EffectBanksState = {
      banks: [{ id: 'a', name: 'Chill' }, { id: 'b', name: 'Party' }],
      activeBankId: 'gone',
    };
    expect(bankBadgeLabel(state)).toBe('BANK: Chill (1/2)');
  });

  it('is a plain informational string — carries no alarm/LOCKED wording', () => {
    // Distinct from the performance-mode LOCKED badge: the bank badge must never
    // read as an alarm. It only ever names the bank.
    const label = bankBadgeLabel({ banks: [{ id: 'a', name: 'Default' }], activeBankId: 'a' });
    expect(label.startsWith('BANK: ')).toBe(true);
    expect(label).not.toContain('LOCKED');
  });
});

// ── VSN1 layout auto-deploy error banner reducer ─────────────────────────────

describe('deployBannerMessage — surface deploy errors, clear on ok, ignore noise', () => {
  it('a settled ERROR result surfaces the reason string', () => {
    const out = deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'error', lastError: 'LCD budget overflow (page 0)' });
    expect(out).toBe('VSN1 layout NOT deployed: LCD budget overflow (page 0)');
  });

  it('an error with no detail still surfaces (never a silent failure)', () => {
    const out = deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'error' });
    expect(out).toBe('VSN1 layout NOT deployed: unknown error');
    const blank = deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'error', lastError: '   ' });
    expect(blank).toBe('VSN1 layout NOT deployed: unknown error');
  });

  it('a successful OK result CLEARS the banner (returns null)', () => {
    expect(deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'ok' })).toBeNull();
  });

  it('an in-flight (deploying:true) frame is NO CHANGE — the previous banner holds', () => {
    // In-flight frames carry a STALE lastResult from the prior flash; ignore them.
    expect(deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: true, lastResult: 'error', lastError: 'stale' })).toBeUndefined();
    expect(deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: true, lastResult: 'ok' })).toBeUndefined();
  });

  it('unrelated messages + non-terminal results are NO CHANGE', () => {
    expect(deployBannerMessage({ type: 'effectsPage', effectsPage: 1 } as any)).toBeUndefined();
    expect(deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'disabled' })).toBeUndefined();
    expect(deployBannerMessage({ type: 'vsn1LayoutDeploy', deploying: false })).toBeUndefined();
    expect(deployBannerMessage({} as any)).toBeUndefined();
  });

  it('an error then a later ok models the full surface→clear lifecycle', () => {
    // The component stores the last non-undefined value; simulate that fold.
    let banner: string | null = null;
    const apply = (m: Parameters<typeof deployBannerMessage>[0]) => {
      const n = deployBannerMessage(m);
      if (n !== undefined) banner = n;
    };
    apply({ type: 'vsn1LayoutDeploy', deploying: true, lastResult: 'ok' });        // in-flight: no change
    expect(banner).toBeNull();
    apply({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'error', lastError: 'boom' }); // surface
    expect(banner).toBe('VSN1 layout NOT deployed: boom');
    apply({ type: 'vsn1LayoutDeploy', deploying: true, lastResult: 'error' });     // in-flight retry: holds
    expect(banner).toBe('VSN1 layout NOT deployed: boom');
    apply({ type: 'vsn1LayoutDeploy', deploying: false, lastResult: 'ok' });        // success clears
    expect(banner).toBeNull();
  });
});

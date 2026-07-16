// Named effect BANKS (feat/party_integration, effects_v2 v3) — pure library +
// manager + state-manager unit tests. A bank is an INDEPENDENT set of global-
// effect slots with a stable string id + display name; banks form an ORDERED
// list (>= 1) cycled by the VSN1 sb_2. These tests pin the v1→v3 and v2→v3
// migrations (no field loss), the malformed fail-loud contract, the zero-banks
// Default recovery, the live bank SWAP + cycle-wrap, create/delete/rename with
// the last-bank invariant, per-bank slot isolation, `this.slots` alias
// integrity after every op, and the save/load round-trip.
//
// Pure — never spawns the engine, a server, or the VSN1 deploy child (the
// deploy hook is never wired here). API-level sync + persistence lives in
// effects_v2_api.test.js.
//
// Run: node --test tests/global_effect_banks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
  DEFAULT_BANK_ID,
  DEFAULT_BANK_NAME,
  FALLBACK_BANK_ID,
  migrateSlotFile,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import { StateManager } from '../../lib/state_manager.js';

function mkMgr(slots = DEFAULT_SLOT_CONFIG, opts) {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  return new GlobalEffectSlotManager(ctrl, slots, opts);
}

// A studiodj-shaped v1 fixture: top-level slots[], no version, plus the
// effectsPage + controllerProfile the operator-facing file carries. Slots
// exercise paramsOverride / intensity / mode so a field-loss regression trips.
function v1Fixture() {
  return {
    slots: [
      { slotId: 1, enabled: true, label: 'Blast White', effectId: 'blastWhite',
        presetId: 'default', behavior: 'toggle', paramsOverride: {}, intensity: null, mode: null },
      { slotId: 2, enabled: true, label: '2 Hz Pulse', effectId: 'strobe',
        presetId: 'pulse_2hz', behavior: 'toggle',
        paramsOverride: { hz: 10, intensity: 0.4881889763779528 },
        intensity: 0.4881889763779528, mode: 10 },
      { slotId: 3, enabled: true, label: 'Ocean Wash', effectId: 'colorWash',
        presetId: 'ocean_blue', behavior: 'toggle',
        paramsOverride: { amount: 0.6 }, intensity: 0.6, mode: 'tint' },
    ],
    effectsPage: 2,
    controllerProfile: 'play',
  };
}

// A v2 (per-profile PLAY/EDIT) fixture with DISTINCT edit + play slot sets so a
// cross-bank leak regression trips.
function v2Fixture() {
  return {
    version: 2,
    activeProfile: 'play',
    effectsPage: 1,
    profiles: {
      edit: { slots: [
        { slotId: 1, enabled: true, label: 'EDIT one', effectId: 'blastWhite',
          presetId: 'default', behavior: 'toggle', paramsOverride: {} },
      ] },
      play: { slots: [
        { slotId: 1, enabled: true, label: 'PLAY one', effectId: 'vintageWhite',
          presetId: 'default', behavior: 'toggle', paramsOverride: {} },
      ] },
    },
  };
}

// ── (1) v1 → v3 migration: ONE bank, no phantom second bank (D6) ────────

test('migrate v1→v3: ONE edit bank holds the slots, no phantom bank, no field loss', () => {
  const raw = v1Fixture();
  const migrated = migrateSlotFile(raw);

  assert.equal(migrated.version, 3);
  assert.equal(migrated.activeBankId, DEFAULT_BANK_ID, 'active bank is edit');
  assert.equal(migrated.effectsPage, 2, 'effectsPage carried through top-level');
  assert.equal(migrated.banks.length, 1, 'exactly ONE bank (no phantom second)');
  assert.equal(migrated.banks[0].id, DEFAULT_BANK_ID);
  assert.equal(migrated.banks[0].name, DEFAULT_BANK_NAME);
  // The single bank holds the original slots, field-for-field.
  assert.deepEqual(migrated.banks[0].slots, raw.slots,
    'the bank is deep-equal to the v1 slots (paramsOverride/intensity/mode intact)');
});

test('migrate v1 ignores a legacy controllerProfile — always a single edit bank', () => {
  const raw = v1Fixture();
  raw.controllerProfile = 'performance'; // stranger; irrelevant now
  const migrated = migrateSlotFile(raw);
  assert.equal(migrated.activeBankId, DEFAULT_BANK_ID);
  assert.equal(migrated.banks.length, 1);
});

test('migrate v1 with NO controllerProfile still yields one edit bank', () => {
  const raw = v1Fixture();
  delete raw.controllerProfile;
  const migrated = migrateSlotFile(raw);
  assert.equal(migrated.activeBankId, DEFAULT_BANK_ID);
  assert.equal(migrated.banks.length, 1);
});

// ── (2) v2 → v3 migration: edit/play profiles become named banks ────────

test('migrate v2→v3: profiles become [edit,play] banks, activeBankId from activeProfile, no loss', () => {
  const raw = v2Fixture();
  const migrated = migrateSlotFile(raw);

  assert.equal(migrated.version, 3);
  assert.equal(migrated.activeBankId, 'play', 'activeProfile → activeBankId');
  assert.equal(migrated.effectsPage, 1);
  assert.deepEqual(migrated.banks.map(b => b.id), ['edit', 'play'], 'ordered edit, play');
  assert.deepEqual(migrated.banks.map(b => b.name), ['Edit', 'Play']);
  // Slots preserved field-for-field, each bank distinct.
  assert.deepEqual(migrated.banks[0].slots, raw.profiles.edit.slots);
  assert.deepEqual(migrated.banks[1].slots, raw.profiles.play.slots);
  // Deep copies — mutating a migrated bank does not touch the source.
  migrated.banks[0].slots[0].label = 'MUTATED';
  assert.equal(raw.profiles.edit.slots[0].label, 'EDIT one', 'migration deep-copied');
});

// ── (3) v3 pass-through + malformed fail-loud + zero-banks recovery ─────

test('migrate v3 validates + passes an ordered banks file through unchanged', () => {
  const raw = {
    version: 3, activeBankId: 'play', effectsPage: 2,
    banks: [
      { id: 'edit', name: 'Edit', slots: [] },
      { id: 'play', name: 'Play', slots: [] },
      { id: 'bank_1', name: 'Bank 1', slots: [] },
    ],
  };
  const migrated = migrateSlotFile(raw);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.activeBankId, 'play');
  assert.deepEqual(migrated.banks.map(b => b.id), ['edit', 'play', 'bank_1']);
});

test('zero-banks v3 recovers to a single Default bank (D7), never throws', () => {
  const raw = { version: 3, activeBankId: 'whatever', effectsPage: 0, banks: [] };
  const migrated = migrateSlotFile(raw);
  assert.equal(migrated.banks.length, 1);
  assert.equal(migrated.banks[0].id, FALLBACK_BANK_ID);
  assert.equal(migrated.activeBankId, FALLBACK_BANK_ID);
});

test('malformed throws: v3 banks not an array', () => {
  assert.throws(() => migrateSlotFile({ version: 3, activeBankId: 'x', banks: {} }),
    /`banks` must be an array/);
});

test('malformed throws: v3 duplicate bank ids', () => {
  const raw = { version: 3, activeBankId: 'edit', banks: [
    { id: 'edit', name: 'Edit', slots: [] },
    { id: 'edit', name: 'Dup', slots: [] },
  ] };
  assert.throws(() => migrateSlotFile(raw), /duplicate bank id 'edit'/);
});

test('malformed throws: v3 bank with non-array slots', () => {
  const raw = { version: 3, activeBankId: 'edit', banks: [
    { id: 'edit', name: 'Edit', slots: 'nope' },
  ] };
  assert.throws(() => migrateSlotFile(raw), /must carry a slots array/);
});

test('malformed throws: v3 activeBankId names no bank', () => {
  const raw = { version: 3, activeBankId: 'ghost', banks: [
    { id: 'edit', name: 'Edit', slots: [] },
  ] };
  assert.throws(() => migrateSlotFile(raw), /names no bank/);
});

test('malformed throws: v2 missing play bank', () => {
  const raw = { version: 2, activeProfile: 'edit', effectsPage: 0,
    profiles: { edit: { slots: DEFAULT_SLOT_CONFIG } } };
  assert.throws(() => migrateSlotFile(raw), /profile 'play' must carry a slots array/);
});

test('malformed throws: v2 bogus activeProfile', () => {
  const raw = { version: 2, activeProfile: 'performance', effectsPage: 0,
    profiles: { edit: { slots: DEFAULT_SLOT_CONFIG }, play: { slots: DEFAULT_SLOT_CONFIG } } };
  assert.throws(() => migrateSlotFile(raw), /activeProfile must be one of/);
});

test('unknown version throws', () => {
  assert.throws(() => migrateSlotFile({ version: 7, banks: [] }), /unrecognized global_effect_slots shape/);
});

// ── (4) construction seeds one edit bank; alias integrity ───────────────

test('a fresh manager seeds exactly one edit bank; this.slots aliases it', () => {
  const mgr = mkMgr();
  const meta = mgr.getBanksMeta();
  assert.equal(meta.banks.length, 1);
  assert.equal(meta.banks[0].id, DEFAULT_BANK_ID);
  assert.equal(meta.activeBankId, DEFAULT_BANK_ID);
  // this.slots is the SAME array reference as the active bank's slots.
  assert.equal(mgr.slots, mgr.banks[0].slots, 'this.slots aliases the active bank array');
  assert.equal(mgr.slots.length, DEFAULT_SLOT_CONFIG.length);
});

// ── (5) setActiveBank swaps the live set; slot isolation ────────────────

test('setActiveBank swaps the live bank; an edit lands ONLY in the active bank', () => {
  const mgr = mkMgr();
  mgr.createBank('Party'); // adds bank_1, empty; active stays edit
  assert.equal(mgr.getActiveBankId(), DEFAULT_BANK_ID);

  // Rename slot 1 in the edit bank.
  mgr.patchSlot(1, { label: 'EDIT-ONLY LABEL' });
  assert.equal(mgr.getSlot(1).label, 'EDIT-ONLY LABEL');

  // Switch to bank_1 (empty) — the live set swaps; slot 1 no longer present.
  const resolved = mgr.setActiveBank('bank_1');
  assert.equal(resolved, 'bank_1');
  assert.equal(mgr.getActiveBankId(), 'bank_1');
  assert.equal(mgr.slots.length, 0, 'the new bank is empty');
  assert.equal(mgr.getSlot(1), undefined, 'edit-bank slot not visible in bank_1');

  // Populate bank_1 differently.
  mgr.patchSlot(1, { enabled: true, label: 'PARTY L1', effectId: 'blastWhite', presetId: 'default', behavior: 'toggle' });
  assert.equal(mgr.getSlot(1).label, 'PARTY L1');

  // Switch back to edit — the earlier rename is intact, isolated.
  mgr.setActiveBank(DEFAULT_BANK_ID);
  assert.equal(mgr.getSlot(1).label, 'EDIT-ONLY LABEL',
    'the edit-bank rename persisted only in the edit bank');
  // getBanks reflects the two DIFFERENT banks.
  const banks = mgr.getBanks();
  assert.equal(banks.find(b => b.id === 'edit').slots.find(s => s.slotId === 1).label, 'EDIT-ONLY LABEL');
  assert.equal(banks.find(b => b.id === 'bank_1').slots.find(s => s.slotId === 1).label, 'PARTY L1');
});

test('setActiveBank fails loud on an unknown id (no swap)', () => {
  const mgr = mkMgr();
  assert.throws(() => mgr.setActiveBank('ghost'), /unknown bank id/);
  assert.throws(() => mgr.setActiveBank(2), /unknown bank id/);
  assert.equal(mgr.getActiveBankId(), DEFAULT_BANK_ID, 'a rejected swap leaves the active bank unchanged');
});

// ── (6) nextBank cycles + wraps; 1-bank no-op ───────────────────────────

test('nextBank cycles through the ordered list and wraps', () => {
  const mgr = mkMgr();
  mgr.createBank('B');   // bank_1
  mgr.createBank('C');   // bank_2 → order: edit, bank_1, bank_2
  assert.equal(mgr.getActiveBankId(), 'edit');

  let r = mgr.nextBank();
  assert.equal(r.activeBankId, 'bank_1');
  assert.equal(r.bankName, 'B', 'nextBank returns the target bank display name');
  assert.equal(r.index, 1);
  assert.equal(r.count, 3);
  assert.equal(mgr.slots, mgr.banks.find(b => b.id === 'bank_1').slots, 'alias follows the cycle');

  r = mgr.nextBank();
  assert.equal(r.activeBankId, 'bank_2');
  r = mgr.nextBank();
  assert.equal(r.activeBankId, 'edit', 'wraps back to the first bank');
  assert.equal(r.bankName, DEFAULT_BANK_NAME, 'bankName follows the wrap back to edit');
});

test('nextBank on a single-bank list is a clean no-op', () => {
  const mgr = mkMgr();
  const r = mgr.nextBank();
  assert.equal(r.activeBankId, DEFAULT_BANK_ID);
  assert.equal(r.bankName, DEFAULT_BANK_NAME, 'no-op still reports the active bank name');
  assert.equal(r.index, 0);
  assert.equal(r.count, 1);
});

// ── (7) createBank / renameBank / deleteBank ────────────────────────────

test('createBank makes an EMPTY bank_<n> (first free integer) auto-named Bank N', () => {
  const mgr = mkMgr();
  const a = mgr.createBank();
  assert.equal(a.id, 'bank_1');
  assert.equal(a.name, 'Bank 1');
  assert.equal(a.slotCount, 0);
  const b = mgr.createBank('Custom');
  assert.equal(b.id, 'bank_2');
  assert.equal(b.name, 'Custom');
  // Creating never changes the active bank.
  assert.equal(mgr.getActiveBankId(), DEFAULT_BANK_ID);
  // The empty bank really is empty when activated.
  mgr.setActiveBank('bank_1');
  assert.equal(mgr.slots.length, 0);
});

test('createBank fills the FIRST free bank_<n> gap', () => {
  const mgr = mkMgr();
  mgr.createBank();          // bank_1
  mgr.createBank();          // bank_2
  mgr.deleteBank('bank_1');  // free bank_1 again
  const c = mgr.createBank();
  assert.equal(c.id, 'bank_1', 'reuses the first free integer');
});

test('renameBank renames by id; fails loud on unknown id or empty name', () => {
  const mgr = mkMgr();
  const r = mgr.renameBank(DEFAULT_BANK_ID, 'Main');
  assert.equal(r.name, 'Main');
  assert.equal(mgr.getBanksMeta().banks[0].name, 'Main');
  assert.throws(() => mgr.renameBank('ghost', 'X'), /unknown bank id/);
  assert.throws(() => mgr.renameBank(DEFAULT_BANK_ID, ''), /non-empty string/);
  assert.throws(() => mgr.renameBank(DEFAULT_BANK_ID, '   '), /non-empty string/);
});

test('deleteBank removes a non-active bank; active + alias unchanged', () => {
  const mgr = mkMgr();
  mgr.createBank(); // bank_1
  const before = mgr.slots;
  const r = mgr.deleteBank('bank_1');
  assert.equal(r.deletedId, 'bank_1');
  assert.equal(r.activeBankId, DEFAULT_BANK_ID);
  assert.equal(mgr.getBanksMeta().banks.length, 1);
  assert.equal(mgr.slots, before, 'alias unchanged when a non-active bank is deleted');
});

test('deleting the ACTIVE bank activates the next in order + re-aliases this.slots', () => {
  const mgr = mkMgr();
  mgr.createBank(); // bank_1
  mgr.createBank(); // bank_2 → order edit, bank_1, bank_2
  mgr.setActiveBank('bank_1');
  mgr.patchSlot(1, { enabled: true, label: 'B1', effectId: 'blastWhite', presetId: 'default', behavior: 'toggle' });
  // Delete the active bank_1 → successor (bank_2) becomes active.
  const r = mgr.deleteBank('bank_1');
  assert.equal(r.activeBankId, 'bank_2');
  assert.equal(mgr.getActiveBankId(), 'bank_2');
  assert.equal(mgr.slots, mgr.banks.find(b => b.id === 'bank_2').slots, 'alias re-points to successor');
  assert.equal(mgr.slots.length, 0, 'now aliasing the empty bank_2');
});

test('deleting the LAST bank is refused (>= 1 invariant)', () => {
  const mgr = mkMgr();
  assert.throws(() => mgr.deleteBank(DEFAULT_BANK_ID), /cannot delete the last bank/);
  assert.equal(mgr.getBanksMeta().banks.length, 1, 'the bank survives the refused delete');
});

test('deleteBank fails loud on an unknown id', () => {
  const mgr = mkMgr();
  mgr.createBank();
  assert.throws(() => mgr.deleteBank('ghost'), /unknown bank id/);
});

// ── (8) setBanks restore + validation; getBanks round-trip ──────────────

test('setBanks restores an ordered list, validates per-bank, deep-clones, re-aliases', () => {
  const mgr = mkMgr();
  // Clone the shared DEFAULT_SLOT_CONFIG so the mutation below can't poison it.
  const editSlots = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  const banks = [
    { id: 'edit', name: 'Edit', slots: editSlots },
    { id: 'play', name: 'Play', slots: [] },
  ];
  mgr.setBanks(banks, 'play');
  assert.equal(mgr.getActiveBankId(), 'play');
  assert.equal(mgr.slots.length, 0, 'active play bank is empty');
  // Independent deep clone — mutating the input slot's label does not bleed in.
  editSlots[0].label = 'MUTATED-INPUT';
  assert.notEqual(
    mgr.getBanks().find(b => b.id === 'edit').slots[0].label, 'MUTATED-INPUT',
    'setBanks deep-cloned the input',
  );
});

test('setBanks fails loud: empty list, dup ids, bad activeBankId', () => {
  const mgr = mkMgr();
  assert.throws(() => mgr.setBanks([], 'x'), /non-empty array/);
  assert.throws(() => mgr.setBanks([
    { id: 'a', name: 'A', slots: [] }, { id: 'a', name: 'A2', slots: [] },
  ], 'a'), /duplicate bank id 'a'/);
  assert.throws(() => mgr.setBanks([{ id: 'a', name: 'A', slots: [] }], 'ghost'), /names no bank/);
});

// ── (9) save → load → migrate → restore round-trip ──────────────────────

test('per-bank edits round-trip through StateManager save → load → migrate → restore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-banks-'));
  const sm = new StateManager(dir);
  const mgr = mkMgr();

  // Divergent edits across two banks.
  mgr.renameBank(DEFAULT_BANK_ID, 'Main');
  mgr.patchSlot(2, { label: 'EDIT two' });
  mgr.createBank('Party');            // bank_1
  mgr.setActiveBank('bank_1');
  mgr.patchSlot(2, { enabled: true, label: 'PARTY two', effectId: 'blastWhite', presetId: 'default', behavior: 'toggle' });
  mgr.setEffectsPage(3);

  sm.saveGlobalEffectSlots({
    banks: mgr.getBanks(),
    activeBankId: mgr.getActiveBankId(),
    effectsPage: mgr.getEffectsPage(),
  });

  // Fresh manager + load → migrate → restore.
  const raw = sm.loadGlobalEffectSlots();
  assert.equal(raw.version, 3, 'saved file is v3');
  assert.equal(raw.activeBankId, 'bank_1');
  assert.equal(raw.effectsPage, 3);
  const migrated = migrateSlotFile(raw);
  const mgr2 = mkMgr();
  mgr2.setBanks(migrated.banks, migrated.activeBankId);
  mgr2.setEffectsPage(migrated.effectsPage);

  assert.equal(mgr2.getActiveBankId(), 'bank_1');
  assert.equal(mgr2.getSlot(2).label, 'PARTY two', 'active (bank_1) restored');
  mgr2.setActiveBank(DEFAULT_BANK_ID);
  assert.equal(mgr2.getBanksMeta().banks[0].name, 'Main', 'rename restored');
  assert.equal(mgr2.getSlot(2).label, 'EDIT two', 'edit bank restored independently');
  assert.equal(mgr2.getEffectsPage(), 3);
});

// ── (10) getLayout reflects the active bank (no pageCount, D8) ───────────

test('getLayout reflects the ACTIVE bank and no longer carries pageCount', () => {
  const mgr = mkMgr();
  mgr.patchSlot(1, { label: 'EDIT L1' });
  const editLayout = mgr.getLayout();
  assert.equal(editLayout.slots.find(s => s.slotId === 1).name, 'EDIT L1');
  assert.equal(editLayout.pageCount, undefined, 'pageCount removed (D8)');
  assert.equal(editLayout.slotsPerPage, 8, 'per-slot page geometry retained');

  mgr.createBank();
  mgr.setActiveBank('bank_1'); // empty
  assert.equal(mgr.getLayout().slots.length, 0, 'empty active bank → empty layout');
});

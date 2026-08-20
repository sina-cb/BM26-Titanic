import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_SOURCE = fs.readFileSync(path.resolve(HERE, '..', '..', 'lib', 'api_server.js'), 'utf8');

test('manual overlap is a typed EBUSY refusal with no instant-load substitution', () => {
  const helper = API_SOURCE.slice(
    API_SOURCE.indexOf('function loadPlaylistEntryWithTransition'),
    API_SOURCE.indexOf('// ── Precompile-next-entry'),
  );
  assert.match(helper, /const reason = deckSwapInFlightReason\(\);[\s\S]*err\.code = 'EBUSY';[\s\S]*throw err;/);
  assert.doesNotMatch(helper, /if \(reason\)[\s\S]{0,500}loadPlaylistEntry\(/);
  assert.match(helper, /rejected without an error/);
});

test('autopilot awaits its transition and deterministically skips an overlapping beat', () => {
  const daemon = API_SOURCE.slice(
    API_SOURCE.indexOf('// Route through the deck-transition path:'),
    API_SOURCE.indexOf('// ── Autopilot PROFILE management'),
  );
  assert.match(daemon, /loadPlaylistEntryWithTransition\([\s\S]*await r\.done;/);
  assert.match(daemon, /e\.code === 'EBUSY'[\s\S]*tick skipped: swap already in flight/);
  assert.doesNotMatch(daemon, /e\.code === 'EBUSY'[\s\S]{0,500}loadPlaylistEntry\(/);
});

test('Timeline serializes behind the active Deck swap and awaits its own cue landing', () => {
  const timelineLoader = API_SOURCE.slice(
    API_SOURCE.indexOf('async function timelineLoadPlaylistOnDeck'),
    API_SOURCE.indexOf('function timelineLoadPlaylistOnMixer'),
  );
  assert.match(timelineLoader, /deckSwapInFlightReason\(\)[\s\S]*await settleDeckTransition\(activeDeckSwapDone\);/);
  assert.match(timelineLoader, /loadPlaylistEntryWithTransition\([\s\S]*await settleDeckTransition\(result\.done\);/);
});

// A deck transition that is CANCELLED (PANIC, a look/snapshot morph, a
// special-event FINISH/ABORT restore, a newer swap) rejects `done` with
// ECANCELED by design. `timelineLoadPlaylistOnDeck` is async and is called
// FIRE-AND-FORGET by the special-events runner and the deadman revert, so a
// rejection there has no caller — it reaches engine.js's unhandledRejection
// handler, which exits(1). That killed the engine mid-show (report `_248`
// found 18 special-events tests dying on exactly this). Cancellation settles;
// every OTHER rejection still propagates, so a genuine load failure is never
// masked.
test('a CANCELLED deck transition settles the awaiting loader; everything else rethrows', () => {
  const helper = API_SOURCE.slice(
    API_SOURCE.indexOf('async function settleDeckTransition'),
    API_SOURCE.indexOf('function loadPlaylistEntryWithTransition'),
  );
  assert.match(helper, /catch \(error\) \{\s*if \(!error \|\| error\.code !== 'ECANCELED'\) throw error;/);
});

test('the deck-swap baseline handler distinguishes a cancellation from a failure', () => {
  const helper = API_SOURCE.slice(
    API_SOURCE.indexOf('function loadPlaylistEntryWithTransition'),
    API_SOURCE.indexOf('// ── Precompile-next-entry'),
  );
  // The unawaited `done` still gets a handler (never an unhandled rejection),
  // but a superseded swap must not print a red "failed" line at every show
  // handover — only a real break does.
  assert.match(helper, /done\.catch\(\(error\) => \{[\s\S]*error\.code === 'ECANCELED'[\s\S]*console\.error\(`\[Deck\] transition \$\{txid\} failed/);
});

test('incoming pattern phase is explicitly zero-seeded before a Deck swap', () => {
  const helper = API_SOURCE.slice(
    API_SOURCE.indexOf('function loadPlaylistEntryWithTransition'),
    API_SOURCE.indexOf('// ── Precompile-next-entry'),
  );
  assert.match(helper, /wasmHost\.beginFrame\(handleForSwap, 0\);/);
});

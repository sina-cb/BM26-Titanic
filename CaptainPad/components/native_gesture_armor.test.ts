// native_gesture_armor.test.ts — source-text guards for the NATIVE half of the
// deck's gesture armor (the operator's iPad bug: dragging the COLORS hue dial
// also scrolled the surrounding pane).
//
// WHY SOURCE TEXT. The behavioural core — the lock's balance, its notification
// rules — is proven for real in `components/ui/scroll_lock.test.ts`. What this
// file proves is that the three RN components actually WIRE to it, and that is
// unreachable to vitest: `hue_wheel.tsx`, `HorizontalFader.tsx` and
// `app/(tabs)/index.tsx` are `.tsx` full of react-native imports, which the
// vitest config deliberately keeps out of the glob. Same idiom as
// `components/deck/colors_window_wiring.test.ts` and `no_raw_alerts.test.ts`:
// read the real source and assert the contract holds.
//
// Every guard below is MUTATION-HONEST — delete the line it describes and the
// test goes red — and each block carries a positive sanity assertion so an
// over-eager regex cannot pass by matching nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Strip line and block comments so the prose in these files' (extensive)
 *  docblocks cannot satisfy a guard that the CODE must satisfy. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(...parts: string[]): string {
  return readFileSync(join(HERE, ...parts), 'utf8');
}

const DIAL = stripComments(read('deck', 'hue_wheel.tsx'));
const FADER = stripComments(read('ui', 'HorizontalFader.tsx'));
const HOST = stripComments(read('ui', 'lockable_scroll_view.tsx'));
const DECK = stripComments(read('..', 'app', '(tabs)', 'index.tsx'));
const MIXER = stripComments(read('..', 'app', '(tabs)', 'mixer.tsx'));

// ── The shared shape every armored control must have ──────────────────────
const CONTROLS: [string, string][] = [
  ['hue_wheel.tsx (the COLORS dial)', DIAL],
  ['HorizontalFader.tsx (the BLEND scrubber + every deck fader)', FADER],
];

describe('responder armor — the _211 web-era claims are still all present', () => {
  it.each(CONTROLS)('%s claims the responder on start AND on move', (_name, src) => {
    expect(src).toMatch(/onStartShouldSetPanResponder:\s*\(\)\s*=>\s*true/);
    expect(src).toMatch(/onMoveShouldSetPanResponder:\s*\(\)\s*=>\s*true/);
  });

  it.each(CONTROLS)('%s CAPTURES ahead of every ancestor', (_name, src) => {
    expect(src).toMatch(/onStartShouldSetPanResponderCapture:\s*\(\)\s*=>\s*true/);
    expect(src).toMatch(/onMoveShouldSetPanResponderCapture:\s*\(\)\s*=>\s*true/);
  });

  it.each(CONTROLS)('%s refuses to hand an in-flight gesture back', (_name, src) => {
    expect(src).toMatch(/onPanResponderTerminationRequest:\s*\(\)\s*=>\s*false/);
  });
});

describe('native scroll-owner seam — acquire on grant, release on every exit', () => {
  it.each(CONTROLS)('%s imports the lock', (_name, src) => {
    expect(src).toMatch(/import\s*\{[^}]*acquireScrollLock[^}]*\}\s*from\s*'@\/components\/ui\/scroll_lock'/);
  });

  it.each(CONTROLS)('%s gates the acquire on NATIVE — web keeps its own armor', (_name, src) => {
    // The lock function must bail on web BEFORE acquiring. Both files write it
    // as an early return inside `lockScroll`.
    expect(src).toMatch(/const\s+lockScroll[\s\S]{0,200}?Platform\.OS\s*===\s*'web'[\s\S]{0,120}?acquireScrollLock\(\)/);
  });

  it.each(CONTROLS)('%s takes the lock in the GRANT handler, not on first move', (_name, src) => {
    // Grant is touch-down. Waiting for onPanResponderMove would let the scroll
    // view make its cancel decision first, which is the whole bug.
    // `\b` keeps `unlockScroll()` out of these matches (no word boundary
    // between the `k` of "unlock" and the `l` of "lockScroll").
    expect(src).toMatch(/onPanResponderGrant:\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,400}?\blockScroll\(\)/);
    // There is exactly ONE call site, and the assertion above proved it is in
    // Grant — so it is provably not in Move, Release or a render path.
    expect(src.match(/\blockScroll\(\)/g)).toHaveLength(1);
  });

  it.each(CONTROLS)('%s releases on RELEASE', (_name, src) => {
    expect(src).toMatch(/onPanResponderRelease:\s*\([^)]*\)\s*=>\s*\{\s*unlockScroll\(\)/);
  });

  it.each(CONTROLS)('%s releases on TERMINATE (the cancelled-gesture path)', (_name, src) => {
    expect(src).toMatch(/onPanResponderTerminate:\s*\([^)]*\)\s*=>\s*\{\s*unlockScroll\(\)/);
  });

  it.each(CONTROLS)('%s releases on UNMOUNT (neither handler fires then)', (_name, src) => {
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*unlockScroll,\s*\[unlockScroll\]\)/);
  });

  it.each(CONTROLS)('%s stores its handle in a REF, never state — a re-render cannot swap the ref object out from under an in-flight gesture', (_name, src) => {
    expect(src).toMatch(/const\s+scrollLockRef\s*=\s*useRef<ScrollLockHandle\s*\|\s*null>\(null\)/);
    // Positive sanity: this is the ref's type, not an unrelated useRef<...>
    // matching by coincidence elsewhere in the file.
    expect(src.match(/useRef<ScrollLockHandle\s*\|\s*null>\(null\)/g)).toHaveLength(1);
  });

  it.each(CONTROLS)("%s's lockScroll is idempotent — a second call while a lock is already held returns BEFORE it can overwrite the ref and orphan the first token", (_name, src) => {
    expect(src).toMatch(
      /const\s+lockScroll\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]{0,200}?if\s*\(scrollLockRef\.current\)\s*return;[\s\S]{0,150}?scrollLockRef\.current\s*=\s*acquireScrollLock\(\)/,
    );
    // Positive sanity: exactly one such guard, i.e. it is really this line and
    // not an unrelated "if held return" elsewhere in the file.
    expect(src.match(/if\s*\(scrollLockRef\.current\)\s*return;/g)).toHaveLength(1);
  });

  it.each(CONTROLS)("%s's unlockScroll nulls the ref BEFORE releasing, and is a no-op when nothing is held", (_name, src) => {
    expect(src).toMatch(
      /const\s+unlockScroll\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*const\s+held\s*=\s*scrollLockRef\.current;\s*if\s*\(!held\)\s*return;\s*scrollLockRef\.current\s*=\s*null;\s*held\.release\(\);/,
    );
    // Positive sanity: exactly one place nulls the ref — unlockScroll itself.
    expect(src.match(/scrollLockRef\.current\s*=\s*null;/g)).toHaveLength(1);
  });

  it.each(CONTROLS)("%s's lockScroll and unlockScroll have STABLE identity (empty deps) — so the unmount effect below only fires its cleanup on a real unmount, not on every re-render", (_name, src) => {
    // The unmount effect's "setup" IS the release (its cleanup function is
    // unlockScroll itself, per the guard below). If either callback's
    // identity changed across renders, `useEffect(() => unlockScroll,
    // [unlockScroll])` would tear down and rebuild on every render, releasing
    // a lock out from under a finger still on the glass.
    expect(src).toMatch(/const\s+lockScroll\s*=\s*useCallback\([\s\S]{0,250}?\},\s*\[\]\)/);
    expect(src).toMatch(/const\s+unlockScroll\s*=\s*useCallback\([\s\S]{0,250}?\},\s*\[\]\)/);
  });

  it('the DIAL refuses a read-only touch BEFORE it would take a lock', () => {
    // A read-only dial steers nothing, so the column must stay scrollable
    // under the finger. The refusal's early return has to come first.
    const grant = DIAL.match(/onPanResponderGrant:[\s\S]*?onPanResponderMove:/);
    expect(grant).not.toBeNull();
    const body = grant![0];
    const refuseAt = body.indexOf('onRefused');
    const lockAt = body.indexOf('lockScroll()');
    expect(refuseAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeLessThan(lockAt);
  });
});

describe('the scroll host honours the lock', () => {
  it('LockableScrollView subscribes to the store', () => {
    expect(HOST).toMatch(/useSyncExternalStore\(\s*subscribeScrollLock,\s*scrollLockActive/);
  });

  it('a held lock hard-disables scrolling', () => {
    expect(HOST).toMatch(/scrollEnabled=\{locked\s*\?\s*false\s*:\s*scrollEnabled\}/);
  });

  it('an idle lock passes the caller\'s own scrollEnabled through untouched', () => {
    // The ternary above is the whole guarantee: `undefined` stays `undefined`,
    // so a host that never set the prop is byte-identical (this is what keeps
    // the web build unchanged, since nothing acquires there).
    expect(HOST).toMatch(/\{\s*scrollEnabled,\s*\.\.\.rest\s*\}/);
    expect(HOST).not.toMatch(/scrollEnabled=\{\s*!locked\s*\}/);
  });

  // ── docs/69 §3.2 — the fast path that closes the propagation-latency gap ──
  //
  // The render path above is authoritative but slow: acquire → notify →
  // useSyncExternalStore → React re-render → Fabric commit is enough frames
  // for UIScrollView's own pan recognizer (which starts after ~10pt of
  // travel) to beat it on a fast drag. The fast path bypasses all of that
  // with a synchronous setNativeProps call fired straight off the lock
  // store's own subscription.

  it('the fast path reaches the underlying native scroll view via getNativeScrollRef', () => {
    expect(HOST).toMatch(/subscribeScrollLock\(\(\)\s*=>\s*\{[\s\S]{0,300}?getNativeScrollRef\(\)/);
    // Positive sanity: exactly one call site, so this cannot be satisfied by
    // an unrelated occurrence elsewhere in the file.
    expect(HOST.match(/getNativeScrollRef\(\)/g)).toHaveLength(1);
  });

  it('the fast path calls setNativeProps with scrollEnabled', () => {
    expect(HOST).toMatch(/setNativeProps\(\{\s*scrollEnabled:/);
  });

  it('the fast path is gated on NATIVE — web keeps the render path only', () => {
    expect(HOST).toMatch(/if\s*\(Platform\.OS\s*!==\s*'web'\)/);
    // Positive sanity: Platform is actually imported, so the gate can exist.
    expect(HOST).toMatch(/import\s*\{[^}]*\bPlatform\b[^}]*\}\s*from\s*'react-native'/);
  });

  it('the fast path resolves scrollEnabled through resolveFastPathScrollEnabled, not an inline ternary', () => {
    expect(HOST).toMatch(
      /scrollEnabled:\s*resolveFastPathScrollEnabled\(\s*scrollLockActive\(\),\s*scrollEnabledRef\.current\s*\)/,
    );
    // If a future edit reverts to a hand-rolled ternary in the fast path
    // (mirroring the render path instead of reusing the pure resolver), this
    // must go red.
    expect(HOST).not.toMatch(/setNativeProps\(\{\s*scrollEnabled:\s*locked\s*\?/);
  });

  it('the effect returns the unsubscribe from subscribeScrollLock so it cleans up on unmount', () => {
    expect(HOST).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*return\s*subscribeScrollLock\(/);
  });
});

describe('the deck wires BOTH of its vertical scroll hosts to the seam', () => {
  it('imports LockableScrollView', () => {
    expect(DECK).toMatch(/import\s*\{\s*LockableScrollView\s*\}\s*from\s*'@\/components\/ui\/lockable_scroll_view'/);
  });

  it('the WIDE per-column SectionHost is lockable', () => {
    expect(DECK).toMatch(/const\s+SectionHost[^=]*=\s*isWide\s*\?\s*LockableScrollView\s*:\s*View/);
  });

  it('the NARROW ColumnsScrollRest scroller is lockable', () => {
    expect(DECK).toMatch(/<LockableScrollView[\s\S]*?<\/LockableScrollView>/);
  });

  it('neither host was left as a bare ScrollView', () => {
    // Sanity: `ScrollView` is still imported (LockableScrollView wraps it and
    // other call sites may use it), but the two hosts above must not read
    // `isWide ? ScrollView : View` any more.
    expect(DECK).not.toMatch(/SectionHost[^=]*=\s*isWide\s*\?\s*ScrollView\s*:\s*View/);
  });
});

// ── docs/67 §5 — the mixer enlists its three scroll hosts ──────────────────
//
// The operator's order 2: "when working with sliders on the mixer layers,
// disable the master scroll — they conflict and are annoying." The gesture
// audit found every drag-steered mixer control is ALREADY a lock-acquiring
// `HorizontalFader` (four render sites in mixer.tsx) or, inside COLORS, the
// hue wheel — so the wave added ZERO acquire sites and the guards below are
// about HOSTS only. Same source-text idiom as the deck block above: mixer.tsx
// is a `.tsx` the vitest glob deliberately excludes, so we read the real file.

describe('the mixer wires its three scroll hosts to the _263 seam (docs/67 §5.2)', () => {
  it('imports LockableScrollView', () => {
    expect(MIXER).toMatch(/import\s*\{\s*LockableScrollView\s*\}\s*from\s*'@\/components\/ui\/lockable_scroll_view'/);
  });

  it('enlists EXACTLY three hosts — no more (blast radius), no fewer (the order)', () => {
    // Open tags only; the closing tags are counted separately below so an
    // unbalanced edit cannot pass by matching the same string twice.
    expect(MIXER.match(/<LockableScrollView[\s>]/g)).toHaveLength(3);
    expect(MIXER.match(/<\/LockableScrollView>/g)).toHaveLength(3);
  });

  it('host 1 — the channel-strip row — delegates its overflow boundary to the pure layout rule', () => {
    // LockableScrollView composes `locked ? false : scrollEnabled`, so this
    // caller expression is what governs whenever no drag holds the lock. If a
    // future edit re-derives it, the row can again paint unreachable overflow.
    expect(MIXER).toMatch(
      /scrollEnabled=\{channelRowSizing\.overflow\}/,
    );
  });

  it('host 2 — LOCAL PARAMS — is lockable and keeps nestedScrollEnabled', () => {
    expect(MIXER).toMatch(/<LockableScrollView\s+nestedScrollEnabled\s/);
  });

  it('host 3 — the COLORS citizen card — is lockable', () => {
    expect(MIXER).toMatch(/<LockableScrollView\s+contentContainerStyle=\{\{\s*flexGrow:\s*1\s*\}\}/);
  });

  it('none of the three was left as a bare ScrollView', () => {
    // Sanity: `ScrollView` is still imported and still used by the modal-body
    // scroller, so a blanket "no ScrollView" assertion would be dishonest.
    // These three shapes, specifically, must be gone.
    expect(MIXER).toMatch(/import\s*\{[^}]*\bScrollView\b/); // positive sanity
    expect(MIXER).not.toMatch(/<ScrollView\s+horizontal\s+scrollEnabled=\{!isPortrait/);
    expect(MIXER).not.toMatch(/<ScrollView\s+nestedScrollEnabled\s/);
    expect(MIXER).not.toMatch(/<ScrollView\s+contentContainerStyle=\{\{\s*flexGrow:\s*1\s*\}\}/);
  });

  it('adds NO new acquire site — the mixer screen never touches the lock itself', () => {
    // The whole order is host enlistment. Every acquirer already ships inside
    // HorizontalFader / hue_wheel (proven above); mixer.tsx must not grow its
    // own, or the release-on-terminate/unmount contract would be duplicated in
    // a file with no lifecycle discipline for it.
    expect(MIXER).not.toMatch(/acquireScrollLock/);
    expect(MIXER).not.toMatch(/releaseScrollLock/);
    // Positive sanity: the faders that DO acquire are still rendered here.
    expect(MIXER.match(/<HorizontalFader/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe('_242 dial semantics are untouched by the seam', () => {
  it('touch-down still ANCHORS (beginDial), it does not paint', () => {
    expect(DIAL).toMatch(/gripRef\.current\s*=\s*beginDial\(anchor,/);
    expect(DIAL).toMatch(/const\s+anchor\s*=\s*typeof\s+s\.dialValue\s*===\s*'number'\s*\?\s*s\.dialValue\s*:/);
  });

  it('the hue still follows the accumulated delta through dialSample at DIAL_GAIN', () => {
    expect(DIAL).toMatch(/dialSample\(grip,\s*dx,\s*dy,\s*DIAL_GAIN\)/);
  });

  it('a TAP still writes nothing — no move, no onPick, no drag lifecycle', () => {
    // `next.moved` is the gate: it returns BEFORE onPick and before
    // onDragStart, so a zero-delta touch puts nothing on the wire.
    expect(DIAL).toMatch(/if\s*\(!next\.moved\)\s*return;/);
    expect(DIAL).toMatch(/if\s*\(movedRef\.current\s*&&\s*stateRef\.current\.onDragEnd\)/);
  });

  it('the web armor (touchAction) is still platform-gated exactly as _211 left it', () => {
    expect(DIAL).toMatch(/Platform\.OS\s*===\s*'web'\s*\?\s*\(\{\s*touchAction:\s*'none'\s*\}/);
  });
});

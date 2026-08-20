// colors_yield_bridge.test — table-driven proof of the L2/L3 plumbing around
// `yieldDecision` (docs/61 §2.1/§3). Named after the §3 table rows this wires
// up: L2 (hide COLORS) and L3 (tab leave) behave identically because both run
// through this one bridge, and that identity is itself asserted below rather
// than assumed.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runYieldGesture, type YieldGestureRun } from './colors_yield_bridge';
import { YIELD_SAY, YIELD_FAIL_SAY, type ColorsCard, type RotationKind } from './colors_window_logic';

type Post = { patch: { active: false }; failNote: string };

function harness(overrides: Partial<YieldGestureRun>) {
  const posts: Post[] = [];
  const says: string[] = [];
  const args: YieldGestureRun = {
    gesture: 'hide',
    card: 'follow',
    colorsWindowOpen: true,
    kind: 'follow-note',
    disabled: false,
    post: (patch, failNote) => posts.push({ patch, failNote }),
    say: (message) => says.push(message),
    ...overrides,
  };
  const result = runYieldGesture(args);
  return { result, posts, says };
}

describe('runYieldGesture — hide (L2) and tab (L3), table-driven off docs/61 §3', () => {
  const GESTURES: ('hide' | 'tab')[] = ['hide', 'tab'];

  it("hide while card:'follow' + kind:'follow-note' + !disabled → exactly ONE post, body {active:false}, say(YIELD_SAY), returns true", () => {
    const { result, posts, says } = harness({ gesture: 'hide', card: 'follow', kind: 'follow-note', disabled: false });
    expect(result).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].patch).toEqual({ active: false });
    expect(posts[0].failNote).toBe(YIELD_FAIL_SAY);
    expect(says).toEqual([YIELD_SAY]);
  });

  it("hide while card:'two' → ZERO posts", () => {
    const { result, posts, says } = harness({ gesture: 'hide', card: 'two', kind: 'follow-note' });
    expect(result).toBe(false);
    expect(posts).toHaveLength(0);
    expect(says).toHaveLength(0);
  });

  it.each(['turns', 'crossfade', 'palette-set', 'none'] as RotationKind[])(
    "hide while kind:'%s' → ZERO posts (D2: TURNS and the crossfade persist)",
    (kind) => {
      const { result, posts } = harness({ gesture: 'hide', card: 'follow', kind });
      expect(result).toBe(false);
      expect(posts).toHaveLength(0);
    },
  );

  it("gesture:'tab' behaves IDENTICALLY to 'hide' across the same table", () => {
    const cases: { card: ColorsCard; kind: RotationKind }[] = [
      { card: 'follow', kind: 'follow-note' },
      { card: 'two', kind: 'follow-note' },
      { card: 'follow', kind: 'turns' },
      { card: 'follow', kind: 'crossfade' },
      { card: 'follow', kind: 'palette-set' },
      { card: 'follow', kind: 'none' },
    ];
    for (const { card, kind } of cases) {
      const hide = harness({ gesture: 'hide', card, kind });
      const tab = harness({ gesture: 'tab', card, kind });
      expect(tab.result).toBe(hide.result);
      expect(tab.posts).toEqual(hide.posts);
      expect(tab.says).toEqual(hide.says);
    }
  });

  it.each(GESTURES)("disabled:true → ZERO posts for gesture '%s' (plan-lock / offline suppress yield)", (gesture) => {
    const { result, posts } = harness({ gesture, card: 'follow', kind: 'follow-note', disabled: true });
    expect(result).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("colorsWindowOpen:false → ZERO posts for the tab gesture", () => {
    const { result, posts, says } = harness({
      gesture: 'tab', card: 'follow', kind: 'follow-note', disabled: false, colorsWindowOpen: false,
    });
    expect(result).toBe(false);
    expect(posts).toHaveLength(0);
    expect(says).toHaveLength(0);
  });

  it("colorsWindowOpen:false → ZERO posts for the hide gesture too", () => {
    const { result, posts } = harness({
      gesture: 'hide', card: 'follow', kind: 'follow-note', disabled: false, colorsWindowOpen: false,
    });
    expect(result).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it('the post body carries NO `mode` and NO `followNote` key — a bare stop', () => {
    const { posts } = harness({ gesture: 'hide', card: 'follow', kind: 'follow-note' });
    expect(Object.keys(posts[0].patch)).toEqual(['active']);
  });

  it('a non-yielding gesture never calls `say`', () => {
    const { says } = harness({ gesture: 'hide', card: 'two', kind: 'follow-note' });
    expect(says).toHaveLength(0);
  });
});

// ── §2.2 source-text guard ───────────────────────────────────────────────
//
// "Broadcast arrivals — a mode becoming active while the operator is
// elsewhere never triggers anything but visibility." A reconnect or an
// engine-driven `colorAutopilot` broadcast must never be read as a
// navigation gesture, so `runYieldGesture` may ONLY be called from the two
// real navigation triggers (the workspace-close handler = L2, the focus
// effect's cleanup = L3) — never from `onControl`, the WS message handler a
// reconnect or a broadcast both flow through. A source scan, in the idiom of
// `components/no_raw_alerts.test.ts`: it walks the real file `app/(tabs)/
// index.tsx` compiles from, so a THIRD call site (or one that creeps inside
// `onControl`) fails this test the day it is written, not on the playa.

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// components/deck -> components -> CaptainPad (the app root).
const APP_ROOT = dirname(dirname(THIS_DIR));
const INDEX_TSX_PATH = join(APP_ROOT, 'app', '(tabs)', 'index.tsx');

/** Strip line and block comments so prose mentioning `runYieldGesture`
 *  (like this very test's own doc comments) cannot inflate the count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('index.tsx — runYieldGesture is wired at exactly L2 and L3, never inside onControl (docs/61 §2.2)', () => {
  const source = stripComments(readFileSync(INDEX_TSX_PATH, 'utf8'));

  it('calls `runYieldGesture(` exactly TWICE — the workspace-close handler (L2) and the focus-effect cleanup (L3)', () => {
    const hits = source.match(/runYieldGesture\(/g) ?? [];
    expect(hits).toHaveLength(2);
  });

  it('never appears inside the `onControl` WS message handler — a reconnect or a broadcast must never post a stop', () => {
    const onControlMatch = source.match(/const onControl = useCallback\(\(msg: EngineMessage\) => \{[\s\S]*?\n {2}\}, \[\]\);/);
    expect(onControlMatch, 'could not locate the onControl handler body to scan — has its shape changed?').not.toBeNull();
    const body = onControlMatch![0];
    // Prove the slice actually reached deep into the handler (the guard
    // would be vacuous if the non-greedy match stopped at the first nested
    // `}, []);` instead of the handler's own close).
    expect(body).toContain("msg.type === 'colorAutopilot'");
    expect(body.includes('runYieldGesture(')).toBe(false);
  });

  it('the scanner itself works — a real, non-trivial file, and the pattern actually matches a call', () => {
    expect(source.length).toBeGreaterThan(10000);
    expect(/runYieldGesture\(/.test('runYieldGesture({\n')).toBe(true);
    expect(/runYieldGesture\(/.test('// runYieldGesture` bridge')).toBe(false);
  });
});

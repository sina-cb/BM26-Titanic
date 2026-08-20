/**
 * THE WEB PARITY GATE (report _252, docs/60 §7 W1).
 *
 * The native port was only allowed to happen if the browser kept drawing
 * EXACTLY what it drew before. Every expectation below is the literal 2D-context
 * call the old inline painter made — the DPR backing-store block, the `lighter`
 * composite, the `rgba(r,g,b,a)` / `rgb(r,g,b)` strings, the ghost ink, the
 * begin-path-arc-fill sequence. If a change to the seam moves a single web
 * pixel, one of these strings stops matching.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  CANVAS_MAX_DPR,
  createCanvasPaintTarget,
  type Canvas2DContextLike,
  type Canvas2DElementLike,
} from './pixel_paint_target_canvas';
import { PIXEL_GHOST_INK, PIXEL_STAGE_BG } from './pixel_view_logic';

type Op = [string, ...unknown[]];

function fakeCanvas(cssW: number, cssH: number, hasContext = true) {
  const ops: Op[] = [];
  const ctx: Canvas2DContextLike = {
    set fillStyle(value: string | object) { ops.push(['fillStyle', value]); },
    get fillStyle() { return ''; },
    set globalCompositeOperation(value: string) { ops.push(['gco', value]); },
    get globalCompositeOperation() { return ''; },
    setTransform(...args) { ops.push(['setTransform', ...args]); },
    fillRect(...args) { ops.push(['fillRect', ...args]); },
    beginPath() { ops.push(['beginPath']); },
    arc(...args) { ops.push(['arc', ...args]); },
    ellipse(...args) { ops.push(['ellipse', ...args]); },
    fill() { ops.push(['fill']); },
  };
  const canvas: Canvas2DElementLike = {
    width: 0,
    height: 0,
    clientWidth: cssW,
    clientHeight: cssH,
    getContext: () => (hasContext ? ctx : null),
  };
  return { canvas, ops };
}

function setDevicePixelRatio(value: number | undefined) {
  const g = globalThis as { devicePixelRatio?: number };
  if (value === undefined) delete g.devicePixelRatio;
  else g.devicePixelRatio = value;
}

afterEach(() => setDevicePixelRatio(undefined));

describe('canvas paint target — backing store', () => {
  it('sizes the backing store by DPR and installs the matching transform', () => {
    setDevicePixelRatio(2);
    const { canvas, ops } = fakeCanvas(300, 120);
    const target = createCanvasPaintTarget(canvas);

    expect(target.begin()).toEqual({ w: 300, h: 120 });
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(240);
    // AFTER the resize — writing width/height resets the context state.
    expect(ops).toEqual([['setTransform', 2, 0, 0, 2, 0, 0]]);
  });

  it('caps the backing store at CANVAS_MAX_DPR', () => {
    setDevicePixelRatio(3);
    const { canvas } = fakeCanvas(100, 100);
    createCanvasPaintTarget(canvas).begin();
    expect(canvas.width).toBe(100 * CANVAS_MAX_DPR);
  });

  it('treats a missing devicePixelRatio as 1', () => {
    setDevicePixelRatio(undefined);
    const { canvas } = fakeCanvas(100, 50);
    createCanvasPaintTarget(canvas).begin();
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });

  it('leaves the backing store alone when it is already the right size', () => {
    setDevicePixelRatio(1);
    const { canvas, ops } = fakeCanvas(80, 40);
    const target = createCanvasPaintTarget(canvas);
    target.begin();
    ops.length = 0;
    target.begin();
    // No resize op is observable, but the transform is reinstalled every frame
    // exactly as the old painter did.
    expect(ops).toEqual([['setTransform', 1, 0, 0, 1, 0, 0]]);
  });

  it('refuses a canvas with no 2D context', () => {
    const { canvas } = fakeCanvas(100, 100, false);
    expect(createCanvasPaintTarget(canvas).begin()).toBeNull();
  });

  it('refuses a zero-sized canvas — collapsed or off-screen draws nothing', () => {
    expect(createCanvasPaintTarget(fakeCanvas(0, 100).canvas).begin()).toBeNull();
    expect(createCanvasPaintTarget(fakeCanvas(100, 0).canvas).begin()).toBeNull();
  });
});

describe('canvas paint target — the exact draw calls', () => {
  function armed(cssW = 100, cssH = 100) {
    setDevicePixelRatio(1);
    const { canvas, ops } = fakeCanvas(cssW, cssH);
    const target = createCanvasPaintTarget(canvas);
    target.begin();
    ops.length = 0;
    return { target, ops };
  }

  it('paints the stage ground edge to edge in CSS px', () => {
    const { target, ops } = armed(300, 120);
    target.clear(PIXEL_STAGE_BG);
    expect(ops).toEqual([
      ['fillStyle', PIXEL_STAGE_BG],
      ['fillRect', 0, 0, 300, 120],
    ]);
  });

  it('opens and closes the additive window with lighter / source-over', () => {
    const { target, ops } = armed();
    target.setAdditive(true);
    target.setAdditive(false);
    expect(ops).toEqual([['gco', 'lighter'], ['gco', 'source-over']]);
  });

  it('draws a halo as an rgba arc — the literal old string', () => {
    const { target, ops } = armed();
    target.fillCircle(10, 20, 3.5, 12, 34, 56, 0.16);
    expect(ops).toEqual([
      ['fillStyle', 'rgba(12,34,56,0.16)'],
      ['beginPath'],
      ['arc', 10, 20, 3.5, 0, Math.PI * 2],
      ['fill'],
    ]);
  });

  it('draws a lit round core as an rgb ellipse', () => {
    const { target, ops } = armed();
    target.fillEllipse(10, 20, 2, 3, 200, 100, 50);
    expect(ops).toEqual([
      ['fillStyle', 'rgb(200,100,50)'],
      ['beginPath'],
      ['ellipse', 10, 20, 2, 3, 0, 0, Math.PI * 2],
      ['fill'],
    ]);
  });

  it('draws an unlit round core in the ghost ink', () => {
    const { target, ops } = armed();
    target.fillGhostEllipse(10, 20, 2, 3);
    expect(ops[0]).toEqual(['fillStyle', PIXEL_GHOST_INK]);
    expect(ops[2]).toEqual(['ellipse', 10, 20, 2, 3, 0, 0, Math.PI * 2]);
  });

  it('draws square cores with fillRect, taking the painter snap verbatim', () => {
    const { target, ops } = armed();
    target.fillRect(7, 9, 2, 2, 1, 2, 3);
    target.fillGhostRect(7, 9, 2, 2);
    expect(ops).toEqual([
      ['fillStyle', 'rgb(1,2,3)'],
      ['fillRect', 7, 9, 2, 2],
      ['fillStyle', PIXEL_GHOST_INK],
      ['fillRect', 7, 9, 2, 2],
    ]);
  });

  it('commits nothing on end — a 2D context draws as it is told', () => {
    const { target, ops } = armed();
    target.end();
    expect(ops).toEqual([]);
  });
});

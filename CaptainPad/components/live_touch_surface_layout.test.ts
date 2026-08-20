import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

const HERE = dirname(fileURLToPath(import.meta.url));
const NATIVE_SURFACE = readFileSync(join(HERE, 'live_touch_surface.tsx'), 'utf8');
const WEB_SURFACE = readFileSync(join(HERE, 'live_touch_surface.web.tsx'), 'utf8');
const TOUCH_ROUTE = readFileSync(join(HERE, '..', 'app', '(tabs)', 'touch_control.tsx'), 'utf8');

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

function fillParent(node: YogaNode): void {
  node.setFlexGrow(1);
  node.setFlexShrink(1);
  node.setFlexBasis(0);
  node.setMinWidth(0);
  node.setMinHeight(0);
}

describe('Live Touch native and web host layout', () => {
  it('keeps the native WebView bounded by Yoga at supported constrained landscape sizes', () => {
    for (const [width, height] of [[1024, 682], [1194, 834], [900, 560]]) {
      const root = Yoga.Node.create();
      root.setWidth(width);
      root.setHeight(height);

      const route = Yoga.Node.create();
      const host = Yoga.Node.create();
      const webView = Yoga.Node.create();
      for (const node of [route, host, webView]) fillParent(node);
      root.insertChild(route, 0);
      route.insertChild(host, 0);
      host.insertChild(webView, 0);

      root.calculateLayout(width, height, Yoga.DIRECTION_LTR);

      for (const node of [route, host, webView]) {
        expect(node.getComputedWidth()).toBe(width);
        expect(node.getComputedHeight()).toBe(height);
        expect(node.getComputedLeft()).toBe(0);
        expect(node.getComputedTop()).toBe(0);
      }
      root.freeRecursive();
    }
  });

  it('leaves vertical gesture ownership inside the HTML instrument on native', () => {
    expect(TOUCH_ROUTE).toMatch(/<View style=\{\{ flex: 1, backgroundColor: palette\.background \}\}>/);
    expect(NATIVE_SURFACE).toMatch(/host:\s*\{\s*flex: 1,?\s*\}/);
    expect(NATIVE_SURFACE).toMatch(/surface:\s*\{\s*flex: 1,/);
    expect(NATIVE_SURFACE).toContain('scrollEnabled={false}');
    expect(NATIVE_SURFACE).toContain('bounces={false}');
    expect(NATIVE_SURFACE).toContain('overScrollMode="never"');
  });

  it('fills the web route without introducing a second scrolling wrapper', () => {
    expect(WEB_SURFACE).toContain("border: 'none', width: '100%', height: '100%', display: 'block'");
    expect(WEB_SURFACE).not.toMatch(/overflow(?:Y)?:\s*['"](?:auto|scroll)['"]/);
  });
});

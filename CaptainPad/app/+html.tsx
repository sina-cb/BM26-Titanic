// app/+html.tsx — the root HTML shell for CaptainPad web (expo-router's
// `web.output: "static"` seam, `expo-router/build/static/getRootComponent.js`)
// and the app-wide text-selection kill (docs/68).
//
// THE MECHANISM. react-native-web gives RN `<Text>` no `userSelect` on web
// by default (RNW 0.21.2, `Text/index.js:140-190`) — the rendered
// `div[dir="auto"]` inherits the browser's `user-select: auto`. That makes
// every caption, chip label, knob readout, and deck header in CaptainPad web
// selectable DOM text, which is why dragging the COLORS hue dial also
// highlighted the captions around it (docs/68 §1) — the wheel's gesture
// armor (`components/deck/hue_wheel.tsx`) is untouched and correct; it just
// can't stop a browser text-selection that its `touchAction` lock was never
// meant to govern.
//
// WHY `html, body`, NOT `*` (docs/68 D2). `user-select: auto` resolves from
// the parent, so ONE `none` stated on `html, body` already reaches every
// element that states no opinion of its own — the entire silent tree. A `*`
// selector would instead plant an element-level declaration on every node,
// and element-level `user-select` wins over inherited `user-select` by
// construction: any real opt-in (RNW's own `selectable` class, the input
// rule below) would then have to out-specificity a universal rule instead
// of simply out-ranking an inherited one. `html, body` gets the same kill
// with zero specificity fights anywhere in the tree.
//
// WHY THE INPUT RULE IS DOUBLE COVERAGE, ON PURPOSE. RNW already stamps an
// element-level `user-select: text` atomic class onto every `TextInput` on
// web, so by the cascade rule above it already survives the `html, body`
// kill unassisted. This rule restates it anyway, because WebKit's inherited
// `-webkit-user-select: none` reaching a field through some future DOM path
// (a wrapper, a portal, a style ordering change) is a known way to kill an
// iOS caret silently — the operator's iPad is Safari/WKWebView, the one
// platform where that regression is invisible until someone tries to type.
// This rule fails safe against that regression class; it costs nothing today.
//
// WEB-ONLY, NATIVE UNTOUCHED. `app/+html.tsx` is an expo-router web
// convention — it has no native counterpart and is never bundled into the
// Expo Go / native build. Nothing here changes native selection semantics,
// native `selectable` Texts, or `components/native_gesture_armor.test.ts`'s
// pins, all of which live entirely in RN component code this file never
// touches.
//
// The shell markup below (html/head/meta/ScrollViewStyleReset/body) is a
// faithful replica of expo-router 6.0.23's stock
// `expo-router/build/static/html.js`, required because defining this file at
// all opts the app out of the stock shell — see docs/68 §2.1. Nothing about
// the stock shell is "improved": the viewport meta is copied verbatim.
import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style
          id="captainpad-no-select"
          dangerouslySetInnerHTML={{
            __html: `
html, body {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
input, textarea, [contenteditable="true"] {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
}
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

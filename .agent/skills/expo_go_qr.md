# Skill: Generate an Expo Go QR code for CaptainPad

When the operator needs to connect an iPad's Expo Go to a Metro dev server,
hand them a scannable QR instead of asking them to type `exp://…` by hand.
This recipe is **offline-safe**: it uses only the `qrcode-terminal` package
already vendored in `CaptainPad/node_modules` (a dependency of `@expo/cli`).
No npm installs, no network, no new dependencies.

## The one trap (why this recipe exists)

Do NOT try to parse `qrcode-terminal`'s printed output into an image. Its
default terminal rendering is **ANSI color escapes** (inverse-video spaces),
and its `small` mode uses half-block glyphs with **inverted semantics**
(designed for dark terminals — "white" glyphs are the QR's light modules).
Both parse paths produce a blank or inverted code. Go one layer down instead:
the vendored `QRCode` class exposes the raw module matrix.

## Recipe

Run from `CaptainPad/` (so `require` resolves the vendored package). Replace
the URL with the live Metro target — `exp://<LAN-IP>:<metro-port>` (find the
LAN host in the Metro manifest: `curl -s -H "expo-platform: ios"
http://127.0.0.1:<port>/` → `launchAsset.url`).

On a show profile the Metro is the launcher-owned `captainpad-native` child
(`node launcher.js prod --with-native-pad`, port `captainpad_native_port` =
**6981**); the launcher prints the exact `exp://<lanHost>:<port>` line in its
startup summary, so copy it from there rather than re-deriving it. On a dev
profile Metro serves the web pad on `:6967` and Expo Go targets that instead.

```bash
cd CaptainPad && OUT=~/tmp/expo_go_qr.svg node -e "
const QRCode = require('qrcode-terminal/vendor/QRCode');
const ECL = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const URL = 'exp://10.x.x.NNN:6981';   // <-- the live Metro target
const qr = new QRCode(-1, ECL.M);      // -1 = auto version, M error level
qr.addData(URL);
qr.make();
const n = qr.getModuleCount();
const cell = 16, pad = 4 * cell;       // pad >= 4 modules = QR quiet zone
let rects = '';
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
  if (qr.isDark(r, c)) rects += '<rect x=\"' + (c*cell) + '\" y=\"' + (r*cell) + '\" width=\"' + cell + '\" height=\"' + cell + '\"/>';
const W = n * cell;
const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"' + (-pad) + ' ' + (-pad) + ' ' + (W+2*pad) + ' ' + (W+2*pad+3*cell) + '\">'
  + '<rect x=\"' + (-pad) + '\" y=\"' + (-pad) + '\" width=\"' + (W+2*pad) + '\" height=\"' + (W+2*pad+3*cell) + '\" fill=\"white\"/>'
  + '<g fill=\"black\">' + rects + '</g>'
  + '<text x=\"' + (W/2) + '\" y=\"' + (W+2.2*cell) + '\" font-family=\"monospace\" font-size=\"' + (1.6*cell) + '\" text-anchor=\"middle\" fill=\"black\">' + URL + '</text></svg>';
require('fs').writeFileSync(process.env.OUT, svg);
console.log('modules=' + n + ' darkRects=' + (rects.match(/<rect/g)||[]).length);
"
```

Sanity check before handing it over: the script prints `modules=<N>
darkRects=<count>` — `darkRects` should be roughly half of N², and never 0.
A zero means the data loop drew nothing (wrong layer again).

Then deliver `~/tmp/expo_go_qr.svg` to the operator (rendered, not as a bare
attachment). They scan it with the iPad **camera app** and tap the "Open in
Expo Go" banner — more reliable than Expo Go's in-app scanner.

## Notes

- The URL is printed under the code on purpose — the fallback is always
  Expo Go → "Enter URL manually".
- Expo Go's recents list keeps STALE entries; after a Metro port/host change
  the operator must scan/enter the new URL, not tap the old recent.
- White background + ≥4-module quiet zone are load-bearing: camera scanners
  reject QR codes without margin, and theme-dependent backgrounds can render
  the code black-on-black. The SVG bakes its own white ground for that
  reason — don't strip it.
- Works for any `exp://`, `http://`, or arbitrary text payload; version
  auto-scales with URL length.

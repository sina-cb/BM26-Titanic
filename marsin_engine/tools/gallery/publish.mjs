/*
  publish.mjs — add/update a pattern in the offline phone gallery.

  DEV/REVIEW TOOL ONLY. Wraps a make_vis_clip fragment into a fully
  self-contained HTML page at tools/gallery/widgets/<name>.html so it renders
  when opened directly in a phone browser (Tailscale) via server.mjs.

  Node built-ins only. Run from marsin_engine/ (make_vis_clip needs that cwd).

  Two forms:
    PREFERRED — capture JSON, runs make_vis_clip for you:
      node tools/gallery/publish.mjs --name <pattern> --capture <captureJson> [--fps 14]

    Wrap an existing make_vis_clip fragment:
      node tools/gallery/publish.mjs --name <pattern> --in <fragmentHtml>

  Prints the served path /w/<name> on success.
*/
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';
import { execFileSync } from 'child_process';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

const home = process.env.USERPROFILE || process.env.HOME;
const expand = (p) => (p ? p.replace(/^~/, home) : p);

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WIDGETS_DIR = path.join(HERE, 'widgets');
const ENGINE_DIR = path.resolve(HERE, '..', '..'); // marsin_engine/
const MAKE_VIS = path.join(ENGINE_DIR, 'tools', 'make_vis_clip.mjs');

const name = arg('name');
const capture = expand(arg('capture'));
const inFrag = expand(arg('in'));
const fps = arg('fps', '14');

if (!name) {
  console.error('error: --name <pattern> is required');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]+$/.test(name)) {
  console.error('error: --name must be a bare pattern name (letters, digits, . _ -), got: ' + name);
  process.exit(1);
}
if (!capture && !inFrag) {
  console.error('error: provide either --capture <captureJson> or --in <fragmentHtml>');
  process.exit(1);
}

let fragment;
if (capture) {
  if (!fs.existsSync(capture)) {
    console.error('error: capture not found: ' + capture);
    process.exit(1);
  }
  const tmpDir = path.join(home, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFrag = path.join(tmpDir, 'gallery_' + name + '.html');
  // make_vis_clip must run from marsin_engine/.
  execFileSync('node', [MAKE_VIS, '--in', capture, '--out', tmpFrag, '--fps', String(fps)],
    { cwd: ENGINE_DIR, stdio: 'inherit' });
  fragment = fs.readFileSync(tmpFrag, 'utf8');
} else {
  if (!fs.existsSync(inFrag)) {
    console.error('error: fragment not found: ' + inFrag);
    process.exit(1);
  }
  fragment = fs.readFileSync(inFrag, 'utf8');
}

// Self-contained page. Defines the CSS variables the fragment relies on, a dark
// background so the LEDs read, and a mobile viewport. The fragment carries its
// own trailing <script> that animates it.
const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${name.replace(/[<>&"]/g, '')}</title>
<style>
  :root {
    color-scheme: dark;
    --border-radius-lg: 16px;
    --border-radius-md: 10px;
    --color-border-tertiary: #2a2a33;
    --color-text-secondary: #b8c0c8;
    --color-text-tertiary: #7a8290;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: #060608;
    color: #e6e9ee;
    font: 15px/1.4 -apple-system, system-ui, "Segoe UI", sans-serif;
    padding: 14px 14px max(env(safe-area-inset-bottom), 24px);
    -webkit-text-size-adjust: 100%;
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
  button {
    background: #1a1a24; color: #e6e9ee; border: 1px solid #2a2a33;
    border-radius: 8px; padding: 8px 14px;
  }
  input[type="range"] { accent-color: #4a9; }
  h2 { font-size: 16px; margin: 4px 2px 8px; color: var(--color-text-secondary); }
</style>
</head>
<body>
${fragment}
</body>
</html>
`;

fs.mkdirSync(WIDGETS_DIR, { recursive: true });
const out = path.join(WIDGETS_DIR, name + '.html');
fs.writeFileSync(out, page);
console.log('published -> ' + out);
console.log('served at  -> /w/' + name);

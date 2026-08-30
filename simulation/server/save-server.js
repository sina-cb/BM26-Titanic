const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const {
  isValidSceneName,
  updateManifest,
  duplicateSceneDir,
} = require('./scene_duplicate.cjs');

const { listPatterns: listManifestPatterns } = require('./pattern_manifest.cjs');

const ledGamma = require('./led_gamma_service.cjs');
const controllerProbe = require('./controller_probe_service.cjs');

const {
  writeFileAtomic,
  filesForSave,
  filesForCameras,
  filesForModel,
  filesForPixelMapViews,
  snapshotBeforeWrite,
  listBackups,
  restoreBackup,
  deriveRoots,
} = require('./scene_backup.cjs');

// Resolve paths relative to the simulation root (parent of server/).
//
// SIM_SAVE_SERVER_ROOT is a TEST-ONLY override so the crash-proofing and
// save-honesty regressions can point every write at a throwaway ~/tmp tree
// instead of the real scenes/ (report 20260725_119, Wave 1). Unset in
// production → identical to the original behavior; this is an explicit config
// hook, not a silent fallback (codex P0): if it is set it is honoured exactly,
// if it is absent the real root is used, and neither path guesses.
const SIM_ROOT = process.env.SIM_SAVE_SERVER_ROOT || path.join(__dirname, '..');
const ENGINE_ROOT = path.join(SIM_ROOT, '..', 'marsin_engine');
const SCENES_ROOT = path.join(SIM_ROOT, 'scenes');

// Backup roots derived from the (possibly overridden) SIM_ROOT so the pre-save
// snapshots land beside the scene writes, in the temp tree during tests and in
// the real .scene_backups/ in production. Passed explicitly to every
// scene_backup call so nothing quietly writes to the default (real) tree.
const BACKUP_ROOTS = deriveRoots(SIM_ROOT);

// Upper bound on a /controllers/probe request body. A legitimate sweep of the
// whole fleet is a few kilobytes of `{id, ip, type}` triples; anything past
// this is either broken or hostile and is rejected with a 413 rather than
// buffered unbounded (report 20260725_109 — the endpoint accepted an unbounded
// targets[]).
const PROBE_MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Resolve scene-specific config path. If sceneName is omitted, defaults to 'titanic'.
 */
function resolveSceneConfigPath(sceneName) {
  const safeName = (sceneName || 'titanic').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(SCENES_ROOT, safeName, 'scene_config.yaml');
}

function resolveSceneCamerasPath(sceneName) {
  const safeName = (sceneName || 'titanic').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(SCENES_ROOT, safeName, 'cameras.yaml');
}

function resolveScenePixelMapViewsPath(sceneName) {
  const safeName = (sceneName || 'titanic').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(SCENES_ROOT, safeName, 'pixel_map_views.yaml');
}

// Read port from config.yaml (fail-loud: no silent port guessing).
// SIM_SAVE_SERVER_PORT is a TEST-ONLY override so the regressions can bind a
// random high port and NEVER the operator's :6970 (report 20260725_119). It
// must parse to a valid finite port or we fail loudly rather than fall through
// to a guessed default.
const { loadSimPorts } = require('../lib/load_ports.cjs');
let SAVE_PORT;
if (process.env.SIM_SAVE_SERVER_PORT !== undefined) {
  SAVE_PORT = Number(process.env.SIM_SAVE_SERVER_PORT);
  if (!Number.isInteger(SAVE_PORT) || SAVE_PORT < 0 || SAVE_PORT > 65535) {
    throw new Error(`SIM_SAVE_SERVER_PORT is not a valid port: ` +
      `${JSON.stringify(process.env.SIM_SAVE_SERVER_PORT)}`);
  }
} else {
  SAVE_PORT = loadSimPorts(path.join(__dirname, '..', 'config.yaml')).save_port;
}

// ─── Process-level crash backstop (report 20260725_119, Family A) ────────────
// A bug that escapes a request handler (an unhandled socket 'error', a stray
// async throw) would otherwise take the save server down with Node's default
// bare stack trace — scene saves, backups, gamma and the controller probe all
// die at once, and the pane's only symptom is a generic "restart the stack"
// toast that points at the wrong cause. These backstops make any such crash
// LOUD and NAMED. They deliberately do NOT swallow-and-continue: after an
// uncaughtException the process state may be half-corrupt, so the codex "no
// fallback, fail loud" rule says exit rather than run half-alive. Supervision /
// auto-restart is the launcher's job (Wave 1 W1-2); the honest, non-silent
// death here is the precondition for it. The primary probe-crash vector is
// fixed at the source (validated inputs + a socket error handler registered
// before anything that can throw); this net is for whatever we did not foresee.
process.on('uncaughtException', (err) => {
  console.error('[SAVE SERVER] ✋ FATAL uncaughtException — a bug reached the ' +
    'process top level; exiting loudly rather than running half-alive:',
  (err && err.stack) || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[SAVE SERVER] ✋ FATAL unhandledRejection — a promise rejected ' +
    'with no handler; exiting loudly rather than running half-alive:',
  (reason && reason.stack) || reason);
  process.exit(1);
});

// writeFileAtomic (atomic + durable tmp+fsync+rename write) now lives in
// ./scene_backup.cjs as the single source of truth — the backup module and
// this server share ONE definition. Imported at the top of this file.

// ─── Static manifests (single source of truth for the client) ───────────
// The simulation client (main.js, pattern_editor.js) discovers the scene
// and pattern lists by fetching these JSON files — same path in dev and
// production (GitHub Pages). No localhost fetch, no hardcoded fallback
// (see .agent/codex.md P0). We regenerate them here after every
// mutation so the dev experience stays "live" without two client code paths.
const SCENE_MANIFEST_PATH = path.join(SCENES_ROOT, 'manifest.json');
const PATTERN_MANIFEST_PATH = path.join(ENGINE_ROOT, 'patterns', 'manifest.json');

function listScenes() {
  if (!fs.existsSync(SCENES_ROOT)) return [];
  const scenes = [];
  for (const entry of fs.readdirSync(SCENES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(SCENES_ROOT, entry.name, 'scene_config.yaml');
    if (fs.existsSync(cfgPath)) scenes.push(entry.name);
  }
  return scenes.sort();
}

// The manifest generator lives in ./pattern_manifest.cjs — see that file for
// why the subdirectory policy is an explicit registry rather than a blind
// recursive walk. It THROWS on an unclassified pattern subdirectory;
// writePatternManifest below catches it, logs loudly and leaves the tracked
// manifest alone, so a new pattern family is reported instead of silently
// dropped from the operator's pattern picker.
function listPatterns() {
  return listManifestPatterns(path.join(ENGINE_ROOT, 'patterns'));
}

// A scene name must be a single safe path segment: it starts with an
// alphanumeric and then allows alphanumerics, underscore and hyphen. We
// REJECT anything else rather than rewriting it. The old "sanitize" step
// (replace bad chars with '_' then strip leading/trailing '_') was not
// injective — "../titanic" collapsed to "titanic", so a crafted delete
// could destroy the wrong scene. Rejecting keeps the codex "fail loud,
// no silent fallback" contract.
//
// The grammar + validator now live in ./scene_duplicate.cjs (imported at
// the top of this file) so the create/delete/duplicate endpoints and the
// client all share ONE source of truth. Re-exported name kept for the
// existing call sites below.

// Minimal config a freshly-created scene starts from: the standard Model
// Transform, an empty DMX fixture array, and an empty LED strand array.
// Missing cameras/patches/views/controllers are the legitimate "new scene"
// case the client already handles (main.js bootstrap), so we only seed
// scene_config.yaml — the operator builds the rest in-app and saves.
const NEW_SCENE_TEMPLATE = {
  modelTransform: {
    _section: { label: '📦 Model Transform', collapsed: true },
    modelX: { value: 0, label: 'Pos X', min: -500, max: 500, step: 1, listen: true },
    modelY: { value: 0, label: 'Pos Y', min: -500, max: 500, step: 1, listen: true },
    modelZ: { value: 0, label: 'Pos Z', min: -500, max: 500, step: 1, listen: true },
    rotX: { value: 0, label: 'Rot X °', min: -180, max: 180, step: 1, listen: true },
    rotY: { value: 0, label: 'Rot Y °', min: -180, max: 180, step: 1, listen: true },
    rotZ: { value: 0, label: 'Rot Z °', min: -180, max: 180, step: 1, listen: true },
  },
  parLights: {
    _section: { label: '🔌 DMX Fixtures', type: 'fixtureArray', collapsed: false },
    parsEnabled: { value: true, label: 'Master Enabled' },
    masterExposure: { value: 0.2, label: 'Sim Exposure (Preview Only)', min: 0, max: 2, step: 0.05 },
    simBrightness: { value: 1, label: 'Sim Brightness (Preview Only)', min: 0, max: 2, step: 0.05 },
    maxSpotlights: { value: 60, label: 'Max Spotlights', min: 1, max: 200, step: 1 },
    fixtures: [],
  },
  ledStrands: {
    _section: { label: '🔌 LED Fixtures', type: 'ledStrandArray', collapsed: true },
    strandsEnabled: { value: true, label: 'Master Enabled' },
    strands: [],
  },
};

function writeSceneManifest() {
  try {
    fs.mkdirSync(SCENES_ROOT, { recursive: true });
    fs.writeFileSync(SCENE_MANIFEST_PATH, JSON.stringify(listScenes(), null, 2) + '\n');
    console.log(`[SAVE SERVER] Regenerated ${SCENE_MANIFEST_PATH}`);
  } catch (err) {
    console.error(`[SAVE SERVER] Failed to regenerate scene manifest: ${err.message}`);
  }
}

function writePatternManifest() {
  try {
    fs.mkdirSync(path.join(ENGINE_ROOT, 'patterns'), { recursive: true });
    fs.writeFileSync(PATTERN_MANIFEST_PATH, JSON.stringify(listPatterns(), null, 2) + '\n');
    console.log(`[SAVE SERVER] Regenerated ${PATTERN_MANIFEST_PATH}`);
  } catch (err) {
    console.error(`[SAVE SERVER] Failed to regenerate pattern manifest: ${err.message}`);
  }
}

// ─── Live Touch pixel-view artifact ownership ────────────────────────────
// CaptainPad/live_touch/touch_control_pixel_views.json is DERIVED state: the sim resolver's
// output plus byte fingerprints of every authoritative input (the Titanic
// model, pixel_map_views.yaml, cameras.yaml, views.yaml via the view
// registry, and the resolver sources). Live Touch fails CLOSED — "PIXEL VIEW
// UNAVAILABLE" — the moment any live input's bytes disagree with the
// artifact's recorded fingerprint. This server is the ONLY writer of those
// scene inputs at runtime, so it owns keeping the derived artifact in
// lockstep (report 20260815_223 fixed exactly one trigger, the pixel-map
// auto-save; the operator kept red-screening Live Touch through the OTHER
// everyday trigger, saving a camera preset → cameras.yaml → stale artifact).
//
// Refresh points, all funneled through this one helper:
//   - startup: heals edits that landed while the stack was down (git pull,
//     hand-edited YAML, resolver/model changes) on the operator's next boot;
//   - /save-cameras, /save-pixel-map-views, /save (views.yaml split-out),
//     /save-model (base model only): heal live operator edits immediately.
//
// This is NOT a fallback and does NOT weaken verification: the exporter is
// the same single resolver implementation, its write is idempotent by
// content, a genuine resolver failure leaves the old artifact in place so
// Live Touch still refuses loudly, and the failure is named in both the log
// and the save response.
//
// The exporter path is anchored on __dirname (the real server directory),
// NOT on SIM_ROOT: under the SIM_SAVE_SERVER_ROOT test override the scene
// root is a throwaway tree that contains no tools/, and the old SIM_ROOT-
// anchored spawn simply failed there. With the override active the artifact
// is redirected INTO the throwaway tree (--out), so tests exercise this
// exact wiring without ever writing the real tracked artifact.
const TOUCH_VIEWS_EXPORTER = path.join(__dirname, '..', 'tools',
  'export_touch_control_pixel_views.mjs');
const TOUCH_VIEWS_TEST_OUT = process.env.SIM_SAVE_SERVER_ROOT
  ? path.join(SIM_ROOT, 'touch_control_pixel_views.json')
  : null;

function refreshTouchPixelViews(trigger) {
  const args = [TOUCH_VIEWS_EXPORTER];
  if (TOUCH_VIEWS_TEST_OUT) args.push('--out', TOUCH_VIEWS_TEST_OUT);
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: path.join(__dirname, '..'), stdio: 'pipe', timeout: 60000,
    }).toString().trim();
    const summary = stdout.split('\n').filter((line) => line.includes('[touch-pixel-views]'))
      .join(' ') || stdout;
    console.log(`[SAVE SERVER] ✅ Live Touch pixel-view artifact fresh (${trigger}): ${summary}`);
    return { ok: true };
  } catch (exportError) {
    const detail = (exportError.stderr && exportError.stderr.toString().trim())
      || exportError.message;
    console.error(`[SAVE SERVER] ✋ Live Touch pixel-view artifact export FAILED (${trigger}) — ` +
      'Live Touch will refuse to arm until the artifact is regenerated ' +
      '(cd simulation && npm run pixel-views:export):', detail);
    return { ok: false, detail };
  }
}

/**
 * The WARNING trailer appended to a 200 save response when the scene write
 * landed but the artifact refresh failed. The save itself must never fail
 * (the operator's edit is safely on disk); the refusal surface is Live Touch,
 * and this names both the consequence and the remedy.
 */
function touchExportWarning(savedWhat, detail) {
  return `\nWARNING: ${savedWhat} saved, but the Live Touch pixel-view artifact ` +
    'could NOT be re-exported, so Live Touch will refuse to arm until it is ' +
    `regenerated (cd simulation && npm run pixel-views:export):\n${detail}`;
}

// Refresh both manifests at startup so a fresh clone has accurate lists
// even before any save endpoint is hit.
writeSceneManifest();
writePatternManifest();
// Boot-time self-heal: anything that changed the artifact's inputs while the
// stack was down (git pull, a hand edit, a merged resolver change) would
// otherwise red-screen Live Touch until someone remembers the manual export.
// The operator's next sim restart now regenerates it. A failure here is loud
// but non-fatal: saves must stay available, and Live Touch keeps refusing
// with the named remedy until the underlying breakage is fixed.
refreshTouchPixelViews('startup');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }

  // Parse URL + query params once
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const sceneName = parsedUrl.searchParams.get('scene') || null;
  
  if (req.method === 'POST' && pathname === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const outPath = resolveSceneConfigPath(sceneName);
      const patchesPath = path.join(path.dirname(outPath), 'patches.yaml');
      console.log(`[SAVE SERVER] POST /save (scene=${sceneName || 'default'}). Body: ${body.length} bytes`);
      try {
        // Snapshot the files this save will overwrite BEFORE touching them.
        // Throws on failure → caught below → 500 (codex P0: never write live
        // state without a backup).
        const backupScene = sceneName || 'titanic';
        snapshotBeforeWrite(backupScene, filesForSave(backupScene), 'save', BACKUP_ROOTS);

        fs.mkdirSync(path.dirname(outPath), { recursive: true });

        // Parse and decouple patching logic
        const configTree = yaml.load(body);

        // Collect ALL fixture arrays from any known config location
        const allFixtureArrays = [];
        if (configTree && configTree.parLights && Array.isArray(configTree.parLights.fixtures)) {
          allFixtureArrays.push(configTree.parLights.fixtures);
        }
        if (configTree && Array.isArray(configTree.dmxLights)) {
          allFixtureArrays.push(configTree.dmxLights);
        }
        if (configTree && configTree.dmxLights && Array.isArray(configTree.dmxLights.fixtures)) {
          allFixtureArrays.push(configTree.dmxLights.fixtures);
        }

        // LED strands (configTree.ledStrands.strands) carry their own patch
        // record (plan 20260709_0 P4): a device-linear layout, computed sim-
        // side by led_patch_projection.computeLedStrandPatches. A strand is
        // "patched" exactly when it has a universe/address; unassigned strands
        // get NO record (their fields are just stripped). The strand patch
        // shape differs from a fixture's — it adds pixelCount + outputIndex.
        const ledStrandArray = (configTree && configTree.ledStrands &&
          Array.isArray(configTree.ledStrands.strands)) ? configTree.ledStrands.strands : null;

        if (allFixtureArrays.length > 0 || ledStrandArray) {
          const patches = { patches: {} };
          let ledFixtureRecords = 0;
          for (const fixtureArray of allFixtureArrays) {
            fixtureArray.forEach(fixture => {
              const name = fixture.name;
              if (name) {
                // An LED PIXEL FIXTURE (definition `bus: led`, marked by the
                // client's LED projection — the TE Sign V3 halves) hangs off a
                // MarsinLED output and is addressed per pixel, so it takes the
                // STRAND record shape, not the whole-fixture DMX one. Like a
                // strand, it gets a record only when it is actually patched;
                // unpatched means no record at all, never a zeroed DMX row that
                // would read as "a DMX fixture nobody addressed".
                if (fixture.bus === 'led') {
                  if ((fixture.dmxUniverse || 0) > 0) {
                    patches.patches[name] = {
                      controllerIp: fixture.controllerIp || '',
                      controllerId: fixture.controllerId || 0,
                      dmxUniverse: fixture.dmxUniverse || 0,
                      dmxAddress: fixture.dmxAddress || 0,
                      pixelCount: fixture.pixelCount || 0,
                      outputIndex: (fixture.outputIndex === undefined ||
                        fixture.outputIndex === null) ? -1 : fixture.outputIndex,
                      endUniverse: fixture.endUniverse || 0,
                      endChannel: fixture.endChannel || 0,
                      segments: Array.isArray(fixture.segments)
                        ? fixture.segments.map((s) => ({
                          universe: s.universe, startChannel: s.startChannel,
                          endChannel: s.endChannel, pixelCount: s.pixelCount,
                        }))
                        : [],
                    };
                    ledFixtureRecords += 1;
                  }
                  delete fixture.pixelCount;
                  delete fixture.outputIndex;
                  delete fixture.segments;
                  delete fixture.endUniverse;
                  delete fixture.endChannel;
                  delete fixture.controllerIp;
                  delete fixture.controllerId;
                  delete fixture.dmxUniverse;
                  delete fixture.dmxAddress;
                  // `bus` is DERIVED from the fixture definition — it is the
                  // signal for this branch, never authored scene state.
                  delete fixture.bus;
                  // sectionId / fixtureId / viewMask STAY on the structural
                  // tree, exactly as an LED strand carries them: an LED thing
                  // gets a patch record only once it is patched, so parking its
                  // identity there would lose it the moment it is unmapped and
                  // re-mint different ids on the next boot.
                  return;
                } else {
                  patches.patches[name] = {
                    controllerIp: fixture.controllerIp || '',
                    dmxUniverse: fixture.dmxUniverse || 0,
                    dmxAddress: fixture.dmxAddress || 0,
                    controllerId: fixture.controllerId || 0,
                    sectionId: fixture.sectionId || 0,
                    fixtureId: fixture.fixtureId || 0,
                    viewMask: fixture.viewMask || 0,
                    // `viewMaskHi` — the Tier-C HIGH view word (word 1), which
                    // is where the view allocator puts new custom views, so a
                    // fixture-clicked view's membership lives HERE, not in
                    // `viewMask`. Written only when non-zero: the reader's
                    // declared default is 0 (view_registry `fixtureInView`), so
                    // an absent key is the value it already assumed, and a
                    // scene with no word-1 per-fixture view re-saves a
                    // byte-identical patches.yaml.
                    ...((fixture.viewMaskHi || 0) !== 0
                      ? { viewMaskHi: fixture.viewMaskHi } : {}),
                  };
                }
                // Clean structural tree
                delete fixture.controllerIp;
                delete fixture.dmxUniverse;
                delete fixture.dmxAddress;
                delete fixture.controllerId;
                delete fixture.sectionId;
                delete fixture.fixtureId;
                delete fixture.viewMask;
                // Unconditional, exactly like `viewMask` above: the field
                // belongs to the patch record, and a zero left behind on the
                // structural tree would be a second, silently diverging copy.
                delete fixture.viewMaskHi;
              }
            });
          }

          let strandRecords = 0;
          if (ledStrandArray) {
            ledStrandArray.forEach(strand => {
              const name = strand && strand.name;
              // The six LED-patch fields always leave the structural tree
              // (scene_config.yaml stays clean); a record is emitted only when
              // the strand is actually patched (dmxUniverse > 0).
              const patched = name && (strand.dmxUniverse || 0) > 0;
              if (patched) {
                patches.patches[name] = {
                  controllerIp: strand.controllerIp || '',
                  controllerId: strand.controllerId || 0,
                  dmxUniverse: strand.dmxUniverse || 0,
                  dmxAddress: strand.dmxAddress || 0,
                  pixelCount: strand.pixelCount || 0,
                  outputIndex: (strand.outputIndex === undefined || strand.outputIndex === null)
                    ? -1 : strand.outputIndex,
                  // Per-segment DMX-parity view (G1): universe + start/end channel
                  // per run the strand occupies as it spills across universes.
                  // dmxUniverse/dmxAddress stay the START (bytes unchanged); these
                  // are additive — old files without them still load.
                  endUniverse: strand.endUniverse || 0,
                  endChannel: strand.endChannel || 0,
                  segments: Array.isArray(strand.segments)
                    ? strand.segments.map((s) => ({
                      universe: s.universe, startChannel: s.startChannel,
                      endChannel: s.endChannel, pixelCount: s.pixelCount,
                    }))
                    : [],
                };
                strandRecords += 1;
              }
              if (name) {
                delete strand.controllerIp;
                delete strand.controllerId;
                delete strand.dmxUniverse;
                delete strand.dmxAddress;
                delete strand.pixelCount;
                delete strand.outputIndex;
                delete strand.segments;
                delete strand.endUniverse;
                delete strand.endChannel;
              }
            });
          }

          // Write extracted patches.yaml
          writeFileAtomic(patchesPath, yaml.dump(patches, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${patchesPath} ` +
            `(${Object.keys(patches.patches).length} record(s); ${strandRecords} LED strand(s))`);

          // Re-serialize the cleaned structural tree
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Decouple the view registry into its own views.yaml (same
        // pattern as patches.yaml): the client attaches it to the
        // config tree as `views`, we split it back out so the
        // structural scene_config.yaml stays free of it.
        if (configTree && configTree.views && typeof configTree.views === 'object') {
          const viewsPath = path.join(path.dirname(outPath), 'views.yaml');
          writeFileAtomic(viewsPath, yaml.dump({ views: configTree.views }, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${viewsPath} ` +
            `(${Object.keys(configTree.views.groupBits || {}).length} group(s), ` +
            `${(configTree.views.custom || []).length} custom view(s))`);
          delete configTree.views;
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Decouple the controller mapping into its own controllers.yaml
        // (docs/33) — same pattern as views.yaml. The client attaches
        // the live registry to the config tree as `controllers`.
        if (configTree && configTree.controllers && typeof configTree.controllers === 'object') {
          const controllersPath = path.join(path.dirname(outPath), 'controllers.yaml');
          writeFileAtomic(controllersPath, yaml.dump({
            nextControllerId: configTree.controllers.nextControllerId || 1,
            nextUniverse: configTree.controllers.nextUniverse || 2,
            controllers: configTree.controllers.controllers || [],
          }, { lineWidth: -1 }));
          console.log(`[SAVE SERVER] ✅ Wrote ${controllersPath} ` +
            `(${(configTree.controllers.controllers || []).length} controller(s))`);
          delete configTree.controllers;
          body = yaml.dump(configTree, { lineWidth: -1 });
        }

        // Split configTree into common and scene configurations
        const commonKeys = ['atmosphere', 'options', 'colorWave', 'config', '_camera', '_patternEditor'];
        const commonConfig = {};
        const sceneConfig = {};
        for (let k in configTree) {
          if (commonKeys.includes(k)) {
            commonConfig[k] = configTree[k];
          } else {
            sceneConfig[k] = configTree[k];
          }
        }

        // Write common.yaml
        const commonPath = path.join(SCENES_ROOT, 'common.yaml');
        writeFileAtomic(commonPath, yaml.dump(commonConfig, { lineWidth: -1 }));

        // Write cleaned scene_config.yaml
        writeFileAtomic(outPath, yaml.dump(sceneConfig, { lineWidth: -1 }));

        console.log(`[SAVE SERVER] ✅ Wrote ${commonPath} and ${outPath}`);
        // Saving may create a new scene directory; keep the manifest live.
        writeSceneManifest();

        // A full scene save rewrites views.yaml (split out above), and the
        // view registry is a resolver input of the Live Touch artifact — a
        // changed views.yaml with an un-regenerated artifact is SILENTLY
        // stale geometry (the panel only fingerprints the other inputs).
        // Re-export; idempotent no-op when nothing resolver-visible changed.
        let exportNote = '';
        if ((sceneName || 'titanic') === 'titanic_normalized') {
          const refreshed = refreshTouchPixelViews('save');
          if (!refreshed.ok) exportNote = touchExportWarning('scene', refreshed.detail);
        }
        res.end(`Saved${exportNote}`);
      } catch (e) {
        // Save-honesty (report 20260725_119, Family F / L5): a write that fails
        // (disk-full/EBUSY/EISDIR) MUST surface as a non-200 with the named
        // error, never a 200 the UI reads as SAVED. writeFileAtomic and
        // snapshotBeforeWrite both throw on failure, so any real write error
        // lands here.
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end(`Error: ${e.message}`);
      }
    });
  } else if (req.method === 'POST' && pathname === '/save-cameras') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const outPath = resolveSceneCamerasPath(sceneName);
      console.log(`[SAVE SERVER] POST /save-cameras (scene=${sceneName || 'default'}). Body: ${body.length} bytes`);
      try {
        // Snapshot before overwrite (see /save). Throws → 500.
        const backupScene = sceneName || 'titanic';
        snapshotBeforeWrite(backupScene, filesForCameras(backupScene), 'save-cameras', BACKUP_ROOTS);

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, body);
        console.log(`[SAVE SERVER] ✅ Wrote ${outPath}`);

        // cameras.yaml is a fingerprinted input of the Live Touch pixel-view
        // artifact, so every camera-preset save silently red-screened Live
        // Touch ("stale against cameras.yaml") until the manual export was
        // remembered. Re-export here, exactly like /save-pixel-map-views.
        let exportNote = '';
        if ((sceneName || 'titanic') === 'titanic_normalized') {
          const refreshed = refreshTouchPixelViews('save-cameras');
          if (!refreshed.ok) exportNote = touchExportWarning('cameras', refreshed.detail);
        }
        res.end(`Saved${exportNote}`);
      } catch (e) {
        // Save-honesty: a failed write is a named 500, never a 200 (see /save).
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end(`Error: ${e.message}`);
      }
    });
  } else if (req.method === 'POST' && pathname === '/save-pixel-map-views') {
    // The 2D Pixel Map's own layout sidecar (report 20260725_66): the views
    // container — panels, hand-placed anchors, per-view framing and EDIT-mode
    // offsets — as its own file, so the map can auto-save the operator's
    // arrangement WITHOUT dragging a full scene save (fixtures, patches, model
    // exports) along with it. Body is the JSON `{version, views[]}` tree; we
    // dump it as YAML so it stays hand-readable and hand-editable like every
    // other scene sidecar.
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const outPath = resolveScenePixelMapViewsPath(sceneName);
      console.log(`[SAVE SERVER] POST /save-pixel-map-views ` +
        `(scene=${sceneName || 'default'}). Body: ${body.length} bytes`);
      // Parse + validate FIRST, and reject (400) rather than writing anything:
      // a truncated or malformed payload must never overwrite a good layout.
      let tree;
      try {
        tree = JSON.parse(body);
        if (!tree || typeof tree !== 'object' || Array.isArray(tree) || !Array.isArray(tree.views)) {
          throw new Error('body must be a JSON object with a `views` array');
        }
      } catch (e) {
        console.error(`[SAVE SERVER] ✋ Rejected pixel map views payload: ${e.message}`);
        res.statusCode = 400;
        res.end(`Error: ${e.message}`);
        return;
      }
      try {
        // Snapshot before overwrite (see /save). Throws → 500.
        const backupScene = sceneName || 'titanic';
        snapshotBeforeWrite(backupScene, filesForPixelMapViews(backupScene), 'save-pixel-map-views', BACKUP_ROOTS);

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        writeFileAtomic(outPath, yaml.dump(tree, { lineWidth: -1 }));
        console.log(`[SAVE SERVER] ✅ Wrote ${outPath} (${tree.views.length} view(s))`);

        // Live Touch reads a PRE-RESOLVED artifact (CaptainPad/live_touch/touch_control_pixel_views.json)
        // that carries a byte fingerprint of this exact YAML, and it fails
        // CLOSED — "PIXEL VIEW UNAVAILABLE" — the moment the two disagree. The
        // 2D Pixel Map auto-saves on every pan/zoom, so without this the
        // operator silently bricks Live Touch just by framing the map (report
        // 20260815_223). Re-resolving here keeps the two in lockstep.
        //
        // The layout is already safely on disk, so an export failure must NOT
        // fail the save and lose the operator's arrangement. It is reported in
        // the response body and logged loudly instead of passing silently.
        let exportNote = '';
        if ((sceneName || 'titanic') === 'titanic_normalized') {
          const refreshed = refreshTouchPixelViews('save-pixel-map-views');
          if (!refreshed.ok) exportNote = touchExportWarning('layout', refreshed.detail);
        }
        res.end(`Saved${exportNote}`);
      } catch (e) {
        // Save-honesty: a failed write is a named 500, never a 200 (see /save).
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end(`Error: ${e.message}`);
      }
    });
  } else if (req.method === 'POST' && req.url === '/save-stl') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[SAVE SERVER] Received POST /save-stl. Body length: ${body.length}`);
      try {
        const payload = JSON.parse(body);
        const { filename, stlData } = payload;
        if (!filename || !stlData) throw new Error('Missing filename or stlData');
        const safeName = filename.replace(/[^a-z0-9_.-]/gi, '_');
        const outPath = path.join(SIM_ROOT, 'assets', safeName);
        fs.writeFileSync(outPath, stlData);
        console.log(`[SAVE SERVER] Successfully wrote to ${outPath}`);
        res.end('Saved');
      } catch (e) {
        // Save-honesty: a failed write is a named 500, never a 200 (see /save).
        console.error(`[SAVE SERVER] Write error:`, e);
        res.statusCode = 500;
        res.end(`Error: ${e.message}`);
      }
    });
  } else if (req.method === 'POST' && req.url === '/save-pattern') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, code } = JSON.parse(body);
        if (!name || typeof code !== 'string') throw new Error('Missing name or code');
        const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
        const outPath = path.join(ENGINE_ROOT, 'patterns', safeName + '.js');
        fs.mkdirSync(path.join(ENGINE_ROOT, 'patterns'), { recursive: true });
        fs.writeFileSync(outPath, code);
        console.log(`[SAVE SERVER] Saved pattern: ${outPath}`);
        writePatternManifest();
        res.end('Saved');
      } catch (e) {
        console.error(`[SAVE SERVER] Pattern save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'POST' && req.url === '/delete-pattern') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) throw new Error('Missing name');
        const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
        const filePath = path.join(ENGINE_ROOT, 'patterns', safeName + '.js');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[SAVE SERVER] Deleted pattern: ${filePath}`);
          writePatternManifest();
          res.end('Deleted');
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      } catch (e) {
        console.error(`[SAVE SERVER] Pattern delete error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'GET' && req.url === '/list-patterns') {
    // The simulation client now reads the static manifest directly, but we
    // keep this endpoint for ad-hoc tooling. Source of truth is listPatterns().
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listPatterns()));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else if (req.method === 'POST' && pathname === '/save-model') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        if (!sceneName) {
          res.writeHead(400);
          res.end('Missing scene parameter');
          return;
        }
        // Determine model filename based on active scene. `type` picks
        // the companion file: effects (foggers/horns) or viewmasks (the
        // group→bit + named-views sidecar the engine validates against).
        // Scene name is sanitized exactly like the /save endpoint — a
        // raw query param must never become a path segment.
        const safeScene = sceneName.replace(/[^a-z0-9_-]/gi, '_');
        const type = parsedUrl.searchParams.get('type');
        const suffix = type === 'effects' ? '.effects.js'
          : type === 'viewmasks' ? '.viewmasks.js'
          : '.js';
        const modelFilename = `${safeScene}${suffix}`;
        const outDir = path.join(ENGINE_ROOT, 'models');

        // Snapshot the model file this write will overwrite BEFORE touching
        // it. The client fires model+effects+viewmasks in a burst, so these
        // three coalesce into one snapshot dir. Throws → 500.
        snapshotBeforeWrite(safeScene, filesForModel(safeScene, type), 'save-model', BACKUP_ROOTS);

        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, modelFilename);
        writeFileAtomic(outPath, body);

        console.log(`[Save] Wrote model data to ${outPath}`);

        // The BASE model file (titanic.js) is both a fingerprinted source and
        // the topology the Live Touch artifact is resolved from; effects/
        // viewmasks companions are NOT exporter inputs, so the model-export
        // burst (model + effects + viewmasks) refreshes exactly once.
        let exportNote = '';
        if (safeScene === 'titanic_normalized' && suffix === '.js') {
          const refreshed = refreshTouchPixelViews('save-model');
          if (!refreshed.ok) exportNote = touchExportWarning('model', refreshed.detail);
        }
        res.writeHead(200);
        res.end(`Saved${exportNote}`);
      } catch (e) {
        console.error(`[SAVE SERVER] Model save error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'POST' && pathname === '/create-scene') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!isValidSceneName(name)) {
          res.statusCode = 400;
          res.end('Invalid scene name');
          return;
        }
        const sceneDir = path.join(SCENES_ROOT, name);
        // Refuse if anything already lives at this path — never adopt or
        // merge into a pre-existing directory (codex P0: fail loud).
        if (fs.existsSync(sceneDir)) {
          res.statusCode = 409;
          res.end('Scene already exists');
          return;
        }
        fs.mkdirSync(sceneDir, { recursive: true });
        writeFileAtomic(path.join(sceneDir, 'scene_config.yaml'), yaml.dump(NEW_SCENE_TEMPLATE, { lineWidth: -1 }));
        console.log(`[SAVE SERVER] ✅ Created scene: ${sceneDir}`);
        writeSceneManifest();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ scene: name }));
      } catch (e) {
        console.error(`[SAVE SERVER] Scene create error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'POST' && pathname === '/scene/duplicate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { source, newName } = JSON.parse(body);
        // Validate BOTH names against the shared grammar (fail loud, no
        // sanitizing) before either touches the filesystem.
        if (!isValidSceneName(source)) {
          res.statusCode = 400;
          res.end('Invalid source scene name');
          return;
        }
        if (!isValidSceneName(newName)) {
          res.statusCode = 400;
          res.end('Invalid new scene name (use letters, numbers, _ or -)');
          return;
        }
        const srcDir = path.join(SCENES_ROOT, source);
        const destDir = path.join(SCENES_ROOT, newName);
        // Source must be a real scene (has scene_config.yaml).
        if (!fs.existsSync(path.join(srcDir, 'scene_config.yaml'))) {
          res.statusCode = 404;
          res.end('Source scene not found');
          return;
        }
        // Refuse if the target already exists on disk OR in the manifest —
        // never merge into or clobber an existing scene (codex P0).
        if (fs.existsSync(destDir) || listScenes().includes(newName)) {
          res.statusCode = 409;
          res.end('Scene already exists');
          return;
        }
        // Recursive copy + self-reference rewrite. duplicateSceneDir cleans
        // up the partial destination itself if any step throws, so a failed
        // duplicate never leaves a half-scene behind.
        duplicateSceneDir(srcDir, destDir, source, newName);
        console.log(`[SAVE SERVER] ✅ Duplicated scene: ${source} → ${newName}`);
        writeSceneManifest();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ scene: newName, scenes: listScenes() }));
      } catch (e) {
        console.error(`[SAVE SERVER] Scene duplicate error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'POST' && pathname === '/delete-scene') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!isValidSceneName(name)) {
          res.statusCode = 400;
          res.end('Invalid scene name');
          return;
        }
        const sceneDir = path.join(SCENES_ROOT, name);
        // Defense in depth: a validated name is already a single safe
        // segment, but re-confirm the resolved dir sits directly under
        // scenes/ and is a real scene (has scene_config.yaml) before any
        // recursive removal.
        if (path.dirname(sceneDir) !== SCENES_ROOT || !fs.existsSync(path.join(sceneDir, 'scene_config.yaml'))) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        fs.rmSync(sceneDir, { recursive: true, force: true });
        console.log(`[SAVE SERVER] 🗑️  Deleted scene: ${sceneDir}`);
        writeSceneManifest();
        res.end('Deleted');
      } catch (e) {
        console.error(`[SAVE SERVER] Scene delete error:`, e);
        res.statusCode = 500;
        res.end('Error: ' + e.message);
      }
    });
  } else if (req.method === 'GET' && pathname === '/backups') {
    // List a scene's pre-save snapshots, newest-first, for the in-sim
    // "Recover scene" UI. Reject a bad/missing scene name (never sanitize).
    try {
      if (!isValidSceneName(sceneName)) {
        res.statusCode = 400;
        res.end('Invalid or missing scene name');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listBackups(sceneName, BACKUP_ROOTS)));
    } catch (e) {
      console.error(`[SAVE SERVER] Backups list error:`, e);
      res.statusCode = 500;
      res.end('Error');
    }
  } else if (req.method === 'POST' && pathname === '/restore-backup') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        if (!isValidSceneName(sceneName)) {
          res.statusCode = 400;
          res.end('Invalid or missing scene name');
          return;
        }
        const { id } = JSON.parse(body);
        // restoreBackup snapshots the current live files first (pre-restore),
        // then atomically writes the backed-up bytes over them. It sets
        // err.statusCode (400 bad id / 404 unknown snapshot) for us to map.
        const result = restoreBackup(sceneName, id, BACKUP_ROOTS);
        // A restore can add/remove scene files — keep the manifest live.
        writeSceneManifest();
        console.log(`[SAVE SERVER] ♻️  Restored ${sceneName} to ${id} ` +
          `(${result.restored.length} file(s); pre-restore ${result.preRestoreId})`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error(`[SAVE SERVER] Restore error:`, e);
        res.statusCode = e.statusCode || 500;
        res.end(`Error: ${e.message}`);
      }
    });
  } else if (req.method === 'POST' && pathname === '/led/gamma-push') {
    // Push a gamma curve to ONE LED controller: full-config backup →
    // partial `{gamma}` write → reboot-aware read-back verify. One controller
    // per request; a caller pushing several does so sequentially so every
    // controller gets its own ok/failed/unreachable result (no silent partial
    // success). Shared with agent_tools/led_gamma_push.cjs — one implementation.
    //
    // DORMANT by operator ruling: the Controllers pane renders its gamma
    // section disabled and never calls this route. It is kept working (and
    // tested) so gamma push can be re-enabled in one small slice once the
    // narrowed config push is confirmed. The matching READ route
    // (`GET /led/gamma`) is GONE for good — "only push, not pull": the sim
    // never reads a controller's gamma again.
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      let ip = null;
      try {
        const parsed = JSON.parse(body);
        ip = parsed.ip;
        const gamma = parsed.gamma;
        // controllerName rides along for ONE purpose: repairing an invalid
        // STORED deviceName (docs/41 §4.1.1) — a board in that state rejects
        // every write, gamma included. Verbatim repair or loud refusal,
        // decided in led_gamma_service.gammaPushBody.
        ledGamma.pushGamma(ip, gamma, {
          controllerName: parsed.controllerName,
          onLog: (m) => console.log(`[SAVE SERVER][gamma] ${m}`),
        })
          .then((result) => {
            console.log(`[SAVE SERVER] ✅ gamma pushed to ${ip}: ` +
              `${JSON.stringify(result.verified)} (${result.outcome})`);
            res.end(JSON.stringify({ ok: true, ...result }));
          })
          .catch((e) => {
            console.error(`[SAVE SERVER] ✋ gamma push ${ip} failed (${e.kind}): ${e.message}`);
            res.statusCode = e.kind === 'invalid' ? 400 : 502;
            res.end(JSON.stringify({ ok: false, ip, kind: e.kind || 'error', error: e.message }));
          });
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, ip, kind: 'invalid', error: e.message }));
      }
    });
  } else if (req.method === 'POST' && pathname === '/controllers/probe') {
    // ONLINE / OFFLINE / UNKNOWN for every controller card in the pane.
    // Server-side because the browser can neither open a TCP socket (DMX
    // gateways) nor survive cross-origin on a device HTTP call. Fast + parallel
    // + last-verdict cached, so the pane never blocks on the network.
    // Body: { targets: [{id, name?, ip, type}], force?: bool, timeoutMs?: number }
    //
    // This endpoint is bound on 0.0.0.0 with CORS `*` and no auth, so anything
    // on the show LAN — or any page open in the operator's browser — can hit
    // it. It must therefore reject every hostile shape LOUDLY and NEVER crash
    // (report 20260725_109 P1-1 killed the whole process from here). Three
    // guards below, mirroring how the engine's REST surface held under attack:
    // an oversized body is capped, a non-object body is a 400, and a bad
    // `timeoutMs` is a 400 rather than a value that throws inside the socket.
    let body = '';
    let bodyTooBig = false;
    req.on('data', (chunk) => {
      if (bodyTooBig) return;
      body += chunk;
      if (body.length > PROBE_MAX_BODY_BYTES) {
        // Stop accumulating and answer once. Destroying the request avoids
        // buffering an unbounded payload from a hostile client.
        bodyTooBig = true;
        res.statusCode = 413;
        res.end(JSON.stringify({ ok: false,
          error: `request body exceeds ${PROBE_MAX_BODY_BYTES} bytes` }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (bodyTooBig) return;
      res.setHeader('Content-Type', 'application/json');
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `invalid JSON body: ${e.message}` }));
        return;
      }
      // A non-object body (`null`, a number, a string, an array) would make the
      // `parsed.targets` read below throw — and `JSON.parse("null")` returns
      // `null`, which is the exact TypeError that would escape this async
      // handler and reach the process backstop. Reject it as a 400 first.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'body must be a JSON object' }));
        return;
      }
      if (!Array.isArray(parsed.targets)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: '`targets` must be a list of {id, ip, type}' }));
        return;
      }
      // Validate the timeout BEFORE it can reach `socket.setTimeout` — a
      // negative value there throws ERR_OUT_OF_RANGE on a still-connecting
      // socket and killed the process (report 20260725_109 P1-1). Reject loud.
      let timeoutMs;
      try {
        timeoutMs = controllerProbe.validateTimeoutMs(parsed.timeoutMs);
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
        return;
      }
      controllerProbe.probeControllers(parsed.targets, {
        force: parsed.force === true,
        timeoutMs,
      }).then((out) => {
        res.end(JSON.stringify({ ok: true, ...out }));
      }).catch((e) => {
        // probeControllers is documented never to reject; if it ever does, that
        // is a bug in the prober and must be visible, not a silent empty sweep.
        console.error(`[SAVE SERVER] ✋ controller probe sweep failed: ${e.stack || e.message}`);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      });
    });
  } else if (req.method === 'GET' && pathname === '/list-scenes') {
    // The simulation client now reads the static manifest directly, but we
    // keep this endpoint for ad-hoc tooling. Source of truth is listScenes().
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listScenes()));
    } catch (e) {
      res.statusCode = 500;
      res.end('Error');
    }
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(SAVE_PORT, () => console.log(`Save server listening on ${SAVE_PORT}`));

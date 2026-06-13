const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const os = require('os');

const config = getDefaultConfig(__dirname);

// Cap Metro's transform workers. Metro defaults to ~one worker per
// core; each is a full Node process, and on the op machine (also
// running the sim, the engine, and a browser) the combined commit
// pushed Node into hard `Fatal process out of memory: Zone` crashes
// on Windows (observed 2026-06-12, two workers dying in parallel).
// Four workers keep cold bundles fast enough while cutting peak
// memory roughly in half on an 8+ core box.
config.maxWorkers = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)));

config.transformer.babelTransformerPath = require.resolve('./yaml-transformer.js');
// IMPORTANT: yaml/yml are in Metro's default `assetExts`, which means
// `require('./config.yaml')` resolves to an asset URI string instead of the
// transformed JS module. Move them to `sourceExts` so the YAML transformer
// (yaml-transformer.js) actually runs and emits `export default { … }`.
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== 'yaml' && ext !== 'yml',
);
config.resolver.sourceExts.push('yaml', 'yml');

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function projectPathPattern(...segments) {
  const absolutePath = path.resolve(__dirname, ...segments);
  const pattern = absolutePath.split(path.sep).map(escapeRegExp).join('[\\\\/]');
  return new RegExp(`^${pattern}(?:[\\\\/].*)?$`);
}

// Prevent Metro file watcher crashes on Windows without hiding package dist files.
config.resolver.blockList = [
  projectPathPattern('dist'),
  projectPathPattern('.expo'),
  projectPathPattern('node_modules', '.cache'),
];

module.exports = config;

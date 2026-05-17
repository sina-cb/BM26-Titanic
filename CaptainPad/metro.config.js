const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

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

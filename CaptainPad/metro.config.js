const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve('./yaml-transformer.js');
config.resolver.sourceExts.push('yaml', 'yml');

// Prevent Metro file watcher crashes on Windows by excluding volatile directories
config.resolver.blockList = [
  /dist\/.*/,
  /\.expo\/.*/,
  /node_modules\/\.cache\/.*/,
];

module.exports = config;

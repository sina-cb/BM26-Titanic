const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve('./yaml-transformer.js');
config.resolver.sourceExts.push('yaml', 'yml');

// Redirect whatwg-fetch to our local shim.
// The npm package (both 3.6.19 and 3.6.20) has a broken dist/ layout
// that fails to extract on EAS CI macOS builders. React Native already
// provides a global fetch, so we just re-export it.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'whatwg-fetch': path.resolve(__dirname, 'whatwg-fetch-shim.js'),
};

// Prevent Metro file watcher crashes on Windows by excluding volatile directories
config.resolver.blockList = [
  /dist\/.*/,
  /\.expo\/.*/,
  /node_modules\/\.cache\/.*/,
];

module.exports = config;

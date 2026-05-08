const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve('./yaml-transformer.js');
config.resolver.sourceExts.push('yaml', 'yml');

// Redirect whatwg-fetch before Metro reads the package main field. The
// package's dist/fetch.umd.js can be absent on EAS macOS builders, but
// fetch.js is included and provides the side effects Expo needs.
const whatwgFetchSource = path.resolve(__dirname, 'node_modules/whatwg-fetch/fetch.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'whatwg-fetch') {
    return {
      type: 'sourceFile',
      filePath: whatwgFetchSource,
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

// Prevent Metro file watcher crashes on Windows by excluding volatile directories
config.resolver.blockList = [
  /dist\/.*/,
  /\.expo\/.*/,
  /node_modules\/\.cache\/.*/,
];

module.exports = config;

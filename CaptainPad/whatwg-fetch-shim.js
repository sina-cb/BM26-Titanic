// whatwg-fetch shim for React Native
// React Native already provides a global fetch implementation.
// This shim exists because @expo/metro-runtime and react-native
// declare whatwg-fetch as a dependency, but the npm package has
// a broken dist/ layout that fails on EAS CI builders.
// We simply re-export the global fetch that RN provides.
module.exports = globalThis.fetch;
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;

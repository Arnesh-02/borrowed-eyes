const { withAndroidManifest } = require('expo/config-plugins');

// Opt-in for a PRIVATE development binary only. No server is started or bound.
// Normal builds keep cleartext disabled. Expo Go has its own host configuration.
module.exports = function withDevInference(config) {
  const allowDevHttp = process.env.BORROWED_EYES_DEV_HTTP === '1';
  if (allowDevHttp && process.env.EAS_BUILD_PROFILE === 'production') {
    throw new Error('Do not enable development HTTP in a production build.');
  }
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = allowDevHttp ? 'true' : 'false';
    return mod;
  });
};

/**
 * Signs release builds with the Genius Pro key, so it survives `expo prebuild`
 * (which regenerates android/ and would otherwise sign with the debug key —
 * and an APK signed with another key cannot update the installed app).
 *
 * The key and its passwords stay out of git, in credentials/:
 *   credentials/genius-pro-release.jks
 *   credentials/keystore.properties  (storeFile, storePassword, keyAlias, keyPassword)
 * Without them the build falls back to the debug key, as before.
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARK = '// genius-release-signing';

module.exports = function withReleaseSigning(config) {
  config = withDangerousMod(config, ['android', (cfg) => {
    const src = path.join(cfg.modRequest.projectRoot, 'credentials');
    const props = path.join(src, 'keystore.properties');
    if (fs.existsSync(props)) {
      const store = /^storeFile=(.*)$/m.exec(fs.readFileSync(props, 'utf8'))?.[1]?.trim();
      fs.copyFileSync(props, path.join(cfg.modRequest.platformProjectRoot, 'keystore.properties'));
      if (store) fs.copyFileSync(path.join(src, store), path.join(cfg.modRequest.platformProjectRoot, 'app', store));
    }
    return cfg;
  }]);
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    g = g.replace(/signingConfigs \{\n/, `signingConfigs {
        ${MARK}
        if (rootProject.file('keystore.properties').exists()) {
            def ks = new Properties()
            rootProject.file('keystore.properties').withInputStream { ks.load(it) }
            release {
                storeFile file(ks['storeFile'])
                storePassword ks['storePassword']
                keyAlias ks['keyAlias']
                keyPassword ks['keyPassword']
            }
        }
`);
    g = g.replace(
      /(release \{\n(?:.*\n){0,3}?\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig rootProject.file('keystore.properties').exists() ? signingConfigs.release : signingConfigs.debug",
    );
    cfg.modResults.contents = g;
    return cfg;
  });
};

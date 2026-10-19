/**
 * Lets the APK from saljoetech.tech install its own updates (src/data/appUpdate.ts).
 * Left out of the Play build ("extra": { "playStore": true }): Play rejects apps
 * that ask for REQUEST_INSTALL_PACKAGES to update themselves.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';

module.exports = function withApkUpdates(config) {
  if (config.extra?.playStore === true) return config;
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, [PERMISSION]);
    return cfg;
  });
};

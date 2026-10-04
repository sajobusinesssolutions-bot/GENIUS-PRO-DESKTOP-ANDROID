/**
 * Which store this build is for.
 *
 * Google Play does not allow an app to show prices for, or point people to
 * paying outside Play for, its own digital features. Plans for Genius Pro are
 * sold outside the app, which Play allows only if the app itself shows no
 * prices and no "buy" prompts — so a build made for Play sets
 * "extra": { "playStore": true } in app.json, and the licence screen then shows
 * the plan you have and what it includes, without prices or buy buttons.
 * Builds handed out directly (the APK) leave it off and keep them.
 */
import Constants from 'expo-constants';

export const PLAY_BUILD: boolean = (Constants.expoConfig?.extra as any)?.playStore === true;

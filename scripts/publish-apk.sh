#!/usr/bin/env sh
# Puts a new APK on the server for the app to update itself (src/data/appUpdate.ts,
# server/src/updates.js). It goes into RELEASES_DIR, which is not on the website:
# only a signed-in Genius Pro app can fetch it, through the API.
#
#   sh scripts/publish-apk.sh path/to/app-release.apk "What changed"
#
# The version comes from app.json (expo.version, expo.android.versionCode), so
# raise versionCode there before building, or phones will not see an update.
set -e
APK="$1"
NOTES="${2:-}"
HOST="${GENIUS_VPS:-root@api.saljoetech.tech}"
KEY="${GENIUS_VPS_KEY:-$HOME/.ssh/genius_vps}"
DIR=/opt/genius/releases

[ -f "$APK" ] || { echo "usage: $0 app-release.apk [notes]"; exit 1; }
CODE=$(node -p "require('./app.json').expo.android.versionCode")
NAME=$(node -p "require('./app.json').expo.version")
PLAY=$(node -p "require('./app.json').expo.extra?.playStore === true")
[ "$PLAY" = "false" ] || { echo "app.json has extra.playStore = true; that build cannot install its own updates. Build with it off."; exit 1; }
SIZE=$(wc -c < "$APK" | tr -d ' ')
FILE="genius-pro-$NAME-$CODE.apk"

node -e '
const [code, name, file, size, notes] = process.argv.slice(1);
process.stdout.write(JSON.stringify({ versionCode: +code, versionName: name, file, size: +size, notes }, null, 2));
' "$CODE" "$NAME" "$FILE" "$SIZE" "$NOTES" > latest.json.tmp

ssh -i "$KEY" "$HOST" "mkdir -p $DIR && chmod 755 $DIR"
scp -i "$KEY" "$APK" "$HOST:$DIR/$FILE"
ssh -i "$KEY" "$HOST" "chmod 644 $DIR/$FILE"
# latest.json goes last, so no phone is pointed at an APK still uploading.
scp -i "$KEY" latest.json.tmp "$HOST:$DIR/latest.json"
rm latest.json.tmp
ssh -i "$KEY" "$HOST" "chmod 644 $DIR/latest.json; ls -1t $DIR/*.apk | tail -n +3 | xargs -r rm -f"   # keep the newest two
echo "Published $NAME ($CODE) for in-app updates: $DIR/$FILE"

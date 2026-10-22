#!/usr/bin/env sh
# Puts a new APK on the server for the app to update itself (src/data/appUpdate.ts,
# server/src/updates.js). It goes into RELEASES_DIR, which is not on the website:
# only a signed-in Genius Pro app can fetch it, through the API.
#
#   sh scripts/publish-apk.sh path/to/app-release.apk "What changed"
#
# The version comes from app.json (expo.version, expo.android.versionCode), so
# raise versionCode there before building, or phones will not see an update.
#
# The APK goes up in 20 MB pieces, each retried on its own and skipped when an
# earlier try already left it on the server, so a dropped connection resumes
# instead of starting again. The pieces are joined and the size checked before
# latest.json is written: no phone is pointed at an APK that is not all there.
set -e
APK="$1"
NOTES="${2:-}"
HOST="${GENIUS_VPS:-root@api.saljoetech.tech}"
KEY="${GENIUS_VPS_KEY:-$HOME/.ssh/genius_vps}"
DIR=/opt/genius/releases
SSH_OPTS="-o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectTimeout=20"

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

retry() { n=0; until "$@"; do n=$((n+1)); [ $n -ge 5 ] && return 1; echo "  retrying ($n)…"; sleep 3; done; }

TMP=$(mktemp -d)
split -b 20m -d -a 3 "$APK" "$TMP/part."
ssh $SSH_OPTS -i "$KEY" "$HOST" "mkdir -p $DIR/.up-$CODE && chmod 755 $DIR"
HAVE=$(ssh $SSH_OPTS -i "$KEY" "$HOST" "cd $DIR/.up-$CODE 2>/dev/null && stat -c '%n %s' part.* 2>/dev/null || true")
for p in "$TMP"/part.*; do
  b=$(basename "$p"); sz=$(wc -c < "$p" | tr -d ' ')
  if echo "$HAVE" | grep -qx "$b $sz"; then echo "already there: $b"; continue; fi
  echo "uploading $b ($sz bytes)"
  retry scp $SSH_OPTS -i "$KEY" "$p" "$HOST:$DIR/.up-$CODE/$b"
done
rm -rf "$TMP"
retry scp $SSH_OPTS -i "$KEY" latest.json.tmp "$HOST:$DIR/latest.json.tmp"
rm latest.json.tmp

# join, check the size, then announce — keeping the newest two APKs
ssh $SSH_OPTS -i "$KEY" "$HOST" "set -e; cd $DIR; cat .up-$CODE/part.* > $FILE.tmp; \
  got=\$(stat -c %s $FILE.tmp); [ \"\$got\" = \"$SIZE\" ] || { echo \"size mismatch: \$got, wanted $SIZE\"; exit 1; }; \
  mv $FILE.tmp $FILE; rm -rf .up-$CODE; chmod 644 $FILE; mv latest.json.tmp latest.json; chmod 644 latest.json; \
  ls -1t $DIR/*.apk | tail -n +3 | xargs -r rm -f"
echo "Published $NAME ($CODE) for in-app updates: $DIR/$FILE"

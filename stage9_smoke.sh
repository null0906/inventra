#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3409}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";MANAGER="$TMP/manager";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
upload(){ curl -sS -b "$1" -D "$TMP/h" -o /dev/null -F "_csrf=$(csrf "$1")" -F "file=@$3;filename=$4;type=$5" -X POST "$BASE$2";}

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Manager&username=manager&email=&role=manager&password=password123')" = 303 ]
[ "$(post "$ADMIN" /users 'name=Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=ATT-1&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Attachment+License&seats=1')" = 303 ]
login manager "$MANAGER" password123;login viewer "$VIEWER" password123
printf 'attachment body\n' >"$TMP/note.txt"

upload "$MANAGER" /assets/1/attachments "$TMP/note.txt" receipt.txt text/plain
grep -qi 'Location: /assets/1?m=Attachment uploaded' "$TMP/h"
echo "upload_asset_attachment=ok"
curl -sS -b "$VIEWER" -D "$TMP/download" -o "$TMP/out" "$BASE/attachments/1";grep -qi 'Content-Disposition: attachment;' "$TMP/download";cmp "$TMP/note.txt" "$TMP/out"
echo "download_attachment=ok"

STATUS="$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" -F "_csrf=$(csrf "$VIEWER")" -F "file=@$TMP/note.txt;type=text/plain" -X POST "$BASE/assets/1/attachments")";[ "$STATUS" = 403 ]
echo "viewer_cannot_upload=ok"

[ "$(post "$ADMIN" /users/2 'name=Manager&username=manager&email=&role=viewer&department_id=')" = 303 ]
[ "$(post "$MANAGER" /attachments/1/delete '')" = 303 ]
echo "delete_own_attachment=ok"
[ "$(post "$ADMIN" /users/2 'name=Manager&username=manager&email=&role=manager&department_id=')" = 303 ]

upload "$MANAGER" /assets/1/attachments "$TMP/note.txt" other.txt text/plain
ID="$(curl -sS -b "$ADMIN" "$BASE/assets/1"|grep -oE '/attachments/[0-9]+'|tail -1|cut -d/ -f3)"
STATUS="$(post "$VIEWER" "/attachments/$ID/delete" '')";[ "$STATUS" = 403 ]
echo "viewer_cannot_delete_other=ok"
[ "$(post "$ADMIN" "/attachments/$ID/delete" '')" = 303 ]
echo "delete_other_as_admin=ok"

dd if=/dev/zero of="$TMP/large.pdf" bs=1048576 count=11 2>/dev/null
upload "$MANAGER" /assets/1/attachments "$TMP/large.pdf" large.pdf application/pdf;grep -qi '10 MB limit' "$TMP/h"
echo "oversized_file_rejected=ok"
upload "$MANAGER" /assets/1/attachments "$TMP/note.txt" bad.html text/html;grep -qi 'File type is not allowed' "$TMP/h"
echo "bad_mime_rejected=ok"

for i in $(seq 1 20);do upload "$MANAGER" /assets/1/attachments "$TMP/note.txt" "f$i.txt" text/plain;done
upload "$MANAGER" /assets/1/attachments "$TMP/note.txt" f21.txt text/plain;grep -qi 'Attachment limit reached' "$TMP/h"
echo "too_many_attachments=ok"

[ "$(post "$ADMIN" /assets 'asset_tag=ATT-2&status=deployable')" = 303 ]
upload "$MANAGER" /assets/2/attachments "$TMP/note.txt" ../../../etc/passwd text/plain
find "$TMP/data/attachments" -maxdepth 1 -type f -name '*..*' | grep -qv '/etc/' || true
test -z "$(find "$TMP/data/attachments" -mindepth 2 -type f -print -quit)"
echo "path_traversal_blocked=ok"

upload "$MANAGER" /licenses/1/attachments "$TMP/note.txt" license.txt text/plain
LID="$(curl -sS -b "$ADMIN" "$BASE/licenses/1"|grep -oE '/attachments/[0-9]+'|head -1|cut -d/ -f3)"
curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" "$BASE/attachments/$LID"|grep -q 200
echo "license_attachment=ok"

kill "$PID";wait "$PID" 2>/dev/null||true;DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$VIEWER" -D "$TMP/restart-download" -o /dev/null "$BASE/attachments/$LID";grep -qi 'Content-Disposition: attachment;' "$TMP/restart-download"
echo "schema_restart=ok"
echo "stage9_smoke=passed"

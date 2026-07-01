#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3412}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";MANAGER="$TMP/manager";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Manager&username=manager&email=&role=manager&password=password123')" = 303 ]
[ "$(post "$ADMIN" /users 'name=Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
for n in 1 2 3 4;do [ "$(post "$ADMIN" /assets "asset_tag=REQ-00$n&name=Request+Asset+$n&status=deployable")" = 303 ];done
[ "$(post "$ADMIN" /accessories 'name=Request+Keyboard&qty=1&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Empty+Dock&qty=0&min_qty=0')" = 303 ]
login manager "$MANAGER" password123
login viewer "$VIEWER" password123

[ "$(post "$VIEWER" /assets/1/request 'note=Need+for+work')" = 303 ]
echo "request_asset_submit=ok"
[ "$(post "$VIEWER" /accessories/1/request 'note=Need+keyboard')" = 303 ]
echo "request_accessory_submit=ok"
curl -sS -b "$VIEWER" -D "$TMP/duplicate" -o /dev/null -X POST "$BASE/assets/1/request" -d "_csrf=$(csrf "$VIEWER")&note=Again"
grep -Eqi 'already(%20| )have(%20| )a(%20| )pending(%20| )request' "$TMP/duplicate"
echo "duplicate_request_blocked=ok"
curl -sS -b "$VIEWER" "$BASE/my"|grep -q 'My Requests'
curl -sS -b "$VIEWER" "$BASE/my"|grep -q 'Need for work'
echo "my_requests_visible=ok"
[ "$(curl -sS -b "$MANAGER" "$BASE/requests"|grep -c '>Approve<')" = 2 ]
echo "request_queue_visible=ok"

[ "$(post "$MANAGER" /requests/1/approve '')" = 303 ]
curl -sS -b "$VIEWER" "$BASE/my"|grep -q 'REQ-001'
echo "approve_asset=ok"
[ "$(post "$MANAGER" /requests/2/approve '')" = 303 ]
curl -sS -b "$VIEWER" "$BASE/my"|grep -q 'Request Keyboard'
echo "approve_accessory=ok"
[ "$(curl -sS -b "$MANAGER" "$BASE/requests"|grep -c '>Approve<' || true)" = 0 ]
echo "approved_gone_from_queue=ok"

[ "$(post "$VIEWER" /assets/2/request 'note=Temporary')" = 303 ]
[ "$(post "$MANAGER" /requests/3/deny 'reason=Reserved+for+finance')" = 303 ]
curl -sS -b "$VIEWER" "$BASE/my"|grep -q 'Reserved for finance'
echo "deny_request=ok"
echo "deny_reason_stored=ok"

[ "$(post "$VIEWER" /assets/3/request 'note=Race+asset')" = 303 ]
[ "$(post "$MANAGER" /assets/3/checkout 'checkout_to=user&user_id=3')" = 303 ]
curl -sS -b "$MANAGER" -D "$TMP/unavailable-asset" -o /dev/null -X POST "$BASE/requests/4/approve" -d "_csrf=$(csrf "$MANAGER")"
grep -qi 'Asset%20is%20no%20longer%20available' "$TMP/unavailable-asset"
echo "approve_unavailable_asset=ok"

[ "$(post "$VIEWER" /accessories/2/request 'note=Race+accessory')" = 303 ]
curl -sS -b "$MANAGER" -D "$TMP/unavailable-accessory" -o /dev/null -X POST "$BASE/requests/5/approve" -d "_csrf=$(csrf "$MANAGER")"
grep -qi 'Accessory%20is%20no%20longer%20available' "$TMP/unavailable-accessory"
echo "approve_unavailable_accessory=ok"

[ "$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" "$BASE/requests")" = 403 ]
echo "viewer_cannot_access_queue=ok"
[ "$(post "$VIEWER" /assets/4/request 'note=Persist+me')" = 303 ]
echo "viewer_can_submit_request=ok"

kill "$PID";wait "$PID" 2>/dev/null||true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$MANAGER" "$BASE/requests"|grep -q 'Persist me'
echo "schema_restart=ok"
echo "stage12_smoke=passed"

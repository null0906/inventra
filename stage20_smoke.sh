#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3420}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
token(){ curl -sS -b "$1" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf "$1")&name=$2"|grep -oE 'inv_[0-9a-f]{64}'|head -1;}

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=API+Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=MAINT-001&name=Maint+Asset&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Delete+Me&qty=1&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Blocked+Accessory&qty=1&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories/2/checkout 'user_id=2')" = 303 ]
ADMIN_TOKEN="$(token "$ADMIN" stage20-admin)"
login viewer "$VIEWER" password123
VIEWER_TOKEN="$(token "$VIEWER" stage20-viewer)"

[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/v1/accessories/1")" = 200 ]
echo "api_accessories_delete=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/v1/accessories/2")" = 409 ]
echo "api_accessories_delete_active_blocked=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/v1/accessories/999")" = 404 ]
echo "api_accessories_delete_404=ok"

STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/con-create" -w "%{http_code}" -X POST "$BASE/api/v1/consumables" -d '{"name":"API Paper","qty":5,"min_qty":1,"cost":2.5}')";[ "$STATUS" = 201 ];grep -q '"name":"API Paper"' "$TMP/con-create"
echo "api_consumables_create=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/con-patch" -w "%{http_code}" -X PATCH "$BASE/api/v1/consumables/1" -d '{"qty":7}')";[ "$STATUS" = 200 ];grep -q '"qty":7' "$TMP/con-patch"
echo "api_consumables_patch=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/v1/consumables/1")" = 200 ]
echo "api_consumables_delete=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/consumables" -d '{"name":"Bad Qty","qty":-1}')" = 400 ]
echo "api_consumables_bad_qty=ok"

STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/m-create" -w "%{http_code}" -X POST "$BASE/api/v1/maintenance" -d '{"asset_id":1,"type":"repair","title":"Fix screen","start_date":"2026-01-01"}')";[ "$STATUS" = 201 ];grep -q '"title":"Fix screen"' "$TMP/m-create"
echo "api_maintenance_create=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/maintenance" -d '{"asset_id":1,"type":"invalid","title":"Bad","start_date":"2026-01-01"}')" = 400 ]
echo "api_maintenance_bad_type=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/m-patch" -w "%{http_code}" -X PATCH "$BASE/api/v1/maintenance/1" -d '{"notes":"patched"}')";[ "$STATUS" = 200 ];grep -q '"notes":"patched"' "$TMP/m-patch"
echo "api_maintenance_patch=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o "$TMP/m-complete" -w "%{http_code}" -X POST "$BASE/api/v1/maintenance/1/complete")";[ "$STATUS" = 200 ];grep -q '"completed":1' "$TMP/m-complete"
echo "api_maintenance_complete=ok"
[ "$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/maintenance/1/complete")" = 404 ]
echo "api_maintenance_complete_idempotent=ok"

S1="$(curl -sS -H "Authorization: Bearer $VIEWER_TOKEN" -H "Content-Type: application/json" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/consumables" -d '{"name":"Nope"}')"
S2="$(curl -sS -H "Authorization: Bearer $VIEWER_TOKEN" -H "Content-Type: application/json" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/v1/consumables/1" -d '{"qty":1}')"
S3="$(curl -sS -H "Authorization: Bearer $VIEWER_TOKEN" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/v1/accessories/2")"
[ "$S1$S2$S3" = 403403403 ]
echo "api_viewer_blocked_mutations=ok"
echo "stage20_smoke=passed"

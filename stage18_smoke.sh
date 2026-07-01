#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3418}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
token(){ curl -sS -b "$1" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf "$1")&name=$2"|grep -oE 'inv_[0-9a-f]{64}'|head -1;}
api(){ curl -sS -H "Authorization: Bearer $1" "$BASE$2"; }
sql(){ DB_PATH="$TMP/data/app.db" SQL="$1" bun -e 'import {Database} from "bun:sqlite";const d=new Database(process.env.DB_PATH!);const r=d.query(process.env.SQL!).get() as any;console.log(r?Object.values(r)[0]:"")'; }

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=API+Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=API+HQ&address=')" = 303 ]
[ "$(post "$ADMIN" /departments 'name=API+Team')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=API+Keyboard&qty=3&min_qty=1&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /accessories/1/checkout 'user_id=2')" = 303 ]
[ "$(post "$ADMIN" /components 'name=API+SSD&qty=4&min_qty=1&serial=SSD-API&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-IN&name=Audit+Inside&status=deployable&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /audits 'name=Closed+API+Audit&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /audits/1/close '')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-OUT&name=Audit+Outside&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /audits/1/items 'asset_tag=AUD-OUT')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=1')" = 1 ]
echo "stage17_fix_addAsset_closed=ok"

ADMIN_TOKEN="$(token "$ADMIN" stage18-admin)"
login viewer "$VIEWER" password123
VIEWER_TOKEN="$(token "$VIEWER" stage18-viewer)"

api "$ADMIN_TOKEN" /api/v1/accessories|grep -q '"available":2'
echo "api_accessories_list=ok"
api "$ADMIN_TOKEN" /api/v1/accessories/1|grep -q '"name":"API Keyboard"'
echo "api_accessories_get=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/create" -w "%{http_code}" -X POST "$BASE/api/v1/accessories" -d '{"name":"API Mouse","qty":2,"min_qty":0}')";[ "$STATUS" = 201 ];grep -q '"name":"API Mouse"' "$TMP/create"
echo "api_accessories_create=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/patch" -w "%{http_code}" -X PATCH "$BASE/api/v1/accessories/1" -d '{"notes":"patched"}')";[ "$STATUS" = 200 ];grep -q '"notes":"patched"' "$TMP/patch"
echo "api_accessories_patch=ok"
api "$ADMIN_TOKEN" /api/v1/components|grep -q '"available":4'
echo "api_components_list=ok"
api "$ADMIN_TOKEN" /api/v1/components/1|grep -q '"name":"API SSD"'
echo "api_components_get=ok"
api "$ADMIN_TOKEN" /api/v1/locations|grep -q '"name":"API HQ"'
echo "api_locations_list=ok"
api "$ADMIN_TOKEN" /api/v1/departments|grep -q '"name":"API Team"'
echo "api_departments_list=ok"
USERS="$(api "$ADMIN_TOKEN" /api/v1/users)";grep -q '"username":"viewer"' <<<"$USERS";! grep -q 'password_hash' <<<"$USERS"
echo "api_users_list=ok"
api "$ADMIN_TOKEN" /api/v1/audit-sessions|grep -q '"expected":1'
api "$ADMIN_TOKEN" /api/v1/audit-sessions|grep -q '"verified":0'
echo "api_audit_sessions_list=ok"
[ "$(curl -sS -H "Authorization: Bearer $VIEWER_TOKEN" -o /dev/null -w "%{http_code}" "$BASE/api/v1/users")" = 403 ]
echo "api_viewer_blocked_on_users=ok"
STATUS="$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -o "$TMP/unknown" -w "%{http_code}" -X POST "$BASE/api/v1/accessories" -d '{"name":"Extra Fields","qty":1,"unknown":"ignored"}')";[ "$STATUS" = 201 ];grep -q '"name":"Extra Fields"' "$TMP/unknown"
echo "api_unknown_fields_ignored=ok"

RATE_TOKEN="$(token "$ADMIN" stage18-rate)"
RATE=0
for _ in $(seq 1 61);do RATE="$(curl -sS -H "Authorization: Bearer $RATE_TOKEN" -o /dev/null -w "%{http_code}" "$BASE/api/v1/locations")";done
[ "$RATE" = 429 ]
echo "api_rate_limit_enforced=ok"
echo "stage18_smoke=passed"

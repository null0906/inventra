#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3417}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
sql(){ DB_PATH="$TMP/data/app.db" SQL="$1" bun -e 'import {Database} from "bun:sqlite";const d=new Database(process.env.DB_PATH!);const r=d.query(process.env.SQL!).get() as any;console.log(r?Object.values(r)[0]:"")'; }

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Audit+Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=HQ&address=')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=Branch&address=')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-HQ-1&name=HQ+One&status=deployable&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-HQ-2&name=HQ+Two&status=deployable&location_id=1')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-BR-1&name=Branch+One&status=deployable&location_id=2')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=AUD-ARC&name=Archived&status=archived&location_id=1')" = 303 ]

[ "$(post "$ADMIN" /audits 'name=HQ+Audit&location_id=1')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=1')" = 2 ]
echo "audit_create_location_scoped=ok"
[ "$(post "$ADMIN" /audits 'name=All+Audit&location_id=')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=2')" = 3 ]
echo "audit_create_all_assets=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/audits/1")";grep -q 'AUD-HQ-1' <<<"$PAGE";grep -q 'AUD-HQ-2' <<<"$PAGE";grep -q '<h2>Pending</h2>' <<<"$PAGE"
echo "audit_detail_shows_pending=ok"

[ "$(post "$ADMIN" /audits/1/items/1/verify 'note=Seen+at+desk')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE id=1 AND verified_at IS NOT NULL')" = 1 ]
echo "audit_verify_item=ok"
[ "$(post "$ADMIN" /audits/1/items/1/verify 'note=Again')" = 303 ]
[ "$(sql 'SELECT notes FROM audit_items WHERE id=1')" = 'Seen at desk' ]
echo "audit_double_verify_blocked=ok"

[ "$(post "$ADMIN" /audits/1/items 'asset_tag=AUD-BR-1&note=Found+at+HQ')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=1 AND asset_id=3 AND verified_at IS NOT NULL')" = 1 ]
echo "audit_add_asset_by_tag=ok"
[ "$(post "$ADMIN" /audits/1/items 'asset_tag=AUD-BR-1&note=Duplicate')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=1 AND asset_id=3')" = 1 ]
echo "audit_add_duplicate_ignored=ok"

[ "$(post "$ADMIN" /audits/1/close '')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_sessions WHERE id=1 AND closed_at IS NOT NULL')" = 1 ]
echo "audit_close=ok"
[ "$(post "$ADMIN" /audits/1/close '')" = 303 ]
echo "audit_close_idempotent=ok"
[ "$(post "$ADMIN" /audits/1/items/2/verify 'note=Too+late')" = 303 ]
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE id=2 AND verified_at IS NULL')" = 1 ]
echo "audit_closed_verify_blocked=ok"

login viewer "$VIEWER" password123
PAGE="$(curl -sS -b "$VIEWER" "$BASE/audits/1")";grep -q 'HQ Audit' <<<"$PAGE";! grep -q 'Mark verified' <<<"$PAGE";! grep -q 'Close audit' <<<"$PAGE"
echo "audit_viewer_read_only=ok"
[ "$(post "$VIEWER" /audits 'name=Forbidden')" = 403 ]
echo "audit_manager_required=ok"

kill "$PID";wait "$PID" 2>/dev/null||true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$VIEWER" "$BASE/audits/1"|grep -q 'HQ Audit'
[ "$(sql 'SELECT COUNT(*) n FROM audit_items WHERE session_id=1')" = 3 ]
echo "schema_restart=ok"
echo "stage17_smoke=passed"

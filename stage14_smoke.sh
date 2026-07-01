#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3414}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";TARGET="$TMP/target"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
future(){ bun -e "console.log(new Date(Date.now()+$1*86400000).toISOString().slice(0,10))"; }

login admin "$ADMIN" admin123
! curl -sS -b "$ADMIN" "$BASE/"|grep -q 'dashboard-alerts'
echo "dashboard_no_alerts_clean=ok"

[ "$(post "$ADMIN" /users 'name=Request+Target&username=target&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=REQ-OFF&name=Request+Asset&status=deployable')" = 303 ]
login target "$TARGET" password123
[ "$(post "$TARGET" /assets/1/request 'note=Cancel+on+offboard')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/"|grep -q 'pending checkout requests'
echo "dashboard_pending_requests_card=ok"
[ "$(post "$ADMIN" /users/2/offboard '')" = 303 ]
STATUS="$(DB_PATH="$TMP/data/app.db" bun -e 'import {Database} from "bun:sqlite";const d=new Database(process.env.DB_PATH!);console.log((d.query("SELECT status FROM checkout_requests WHERE id=1").get() as any).status)')"
[ "$STATUS" = denied ]
echo "stage13_fix_pending_requests=ok"

[ "$(post "$ADMIN" /assets/1/maintenance "type=preventive&title=Due+service&start_date=$(future 10)")" = 303 ]
curl -sS -b "$ADMIN" "$BASE/"|grep -q 'maintenance items due within 30 days'
echo "dashboard_maintenance_due_card=ok"
[ "$(post "$ADMIN" /licenses "name=Expiring+Suite&seats=1&expires=$(future 30)")" = 303 ]
curl -sS -b "$ADMIN" "$BASE/"|grep -q 'licenses expiring within 60 days'
echo "dashboard_license_expiry_card=ok"
[ "$(post "$ADMIN" /consumables 'name=Low+Toner&qty=1&min_qty=2')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/"|grep -q 'low-stock consumables'
echo "dashboard_low_stock_card=ok"

[ "$(post "$ADMIN" /users 'name=Assigned+User&username=assigned&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=HQ&address=')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=Branch&address=')" = 303 ]
[ "$(post "$ADMIN" /models 'name=Model+A')" = 303 ]
[ "$(post "$ADMIN" /models 'name=Model+B')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=FILTER-DEPLOYED&name=Deployed+Asset&status=deployable&location_id=1&model_id=1')" = 303 ]
[ "$(post "$ADMIN" /assets/2/checkout 'checkout_to=user&user_id=3')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=FILTER-LOC1&name=Location+One&status=deployable&location_id=1&model_id=2')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=FILTER-LOC2&name=Location+Two&status=archived&location_id=2&model_id=1')" = 303 ]

PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?status=deployed")";grep -q 'FILTER-DEPLOYED' <<<"$PAGE";! grep -q 'FILTER-LOC1' <<<"$PAGE"
echo "asset_filter_status=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?location_id=1")";grep -q 'FILTER-DEPLOYED' <<<"$PAGE";grep -q 'FILTER-LOC1' <<<"$PAGE";! grep -q 'FILTER-LOC2' <<<"$PAGE"
echo "asset_filter_location=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?assigned=yes")";grep -q 'FILTER-DEPLOYED' <<<"$PAGE";! grep -q 'FILTER-LOC1' <<<"$PAGE"
echo "asset_filter_assigned_yes=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?assigned=no")";grep -q 'FILTER-LOC1' <<<"$PAGE";grep -q 'FILTER-LOC2' <<<"$PAGE";! grep -q 'FILTER-DEPLOYED' <<<"$PAGE"
echo "asset_filter_unassigned=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?status=deployable&location_id=1")";grep -q 'FILTER-LOC1' <<<"$PAGE";! grep -q 'FILTER-DEPLOYED' <<<"$PAGE";! grep -q 'FILTER-LOC2' <<<"$PAGE"
echo "asset_filter_combined=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets?status=injection")";for tag in REQ-OFF FILTER-DEPLOYED FILTER-LOC1 FILTER-LOC2;do grep -q "$tag" <<<"$PAGE";done
echo "asset_filter_bad_param_ignored=ok"

echo "stage14_smoke=passed"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3419}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
months_ago(){ MONTHS="$1" bun -e "const d=new Date();d.setUTCMonth(d.getUTCMonth()-Number(process.env.MONTHS));console.log(d.toISOString().slice(0,10));"; }

OLD_DATE="$(months_ago 48)"
RECENT_DATE="$(months_ago 3)"
EXPIRING_DATE="$(months_ago 10)"

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Life+Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /depreciation 'name=Three+Year&months=36&floor_value=100')" = 303 ]
[ "$(post "$ADMIN" /models 'name=Lifecycle+Model&depreciation_id=1')" = 303 ]
[ "$(post "$ADMIN" /locations 'name=Lifecycle+HQ&address=')" = 303 ]
[ "$(post "$ADMIN" /assets "asset_tag=LIFE-OLD&name=Old+Laptop&status=deployable&location_id=1&model_id=1&purchase_date=$OLD_DATE&purchase_cost=1200&warranty_months=12")" = 303 ]
[ "$(post "$ADMIN" /assets "asset_tag=LIFE-RECENT&name=Recent+Laptop&status=deployable&location_id=1&purchase_date=$RECENT_DATE&purchase_cost=900&warranty_months=24")" = 303 ]
[ "$(post "$ADMIN" /assets "asset_tag=LIFE-EXPIRING&name=Expiring+Laptop&status=deployed&location_id=1&purchase_date=$EXPIRING_DATE&purchase_cost=800&warranty_months=12")" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=LIFE-NODATE&name=No+Date&status=deployable&location_id=1')" = 303 ]

[ "$(curl -sS -b "$ADMIN" -o /dev/null -w "%{http_code}" "$BASE/reports/lifecycle")" = 200 ]
echo "lifecycle_page_loads=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/reports/lifecycle")"
grep -q 'LIFE-OLD' <<<"$PAGE";grep -q 'Age (days)' <<<"$PAGE"
echo "lifecycle_shows_age=ok"
grep -q 'LIFE-NODATE' <<<"$PAGE"
echo "lifecycle_null_date_ok=ok"
grep -q 'badge b-red">expired' <<<"$PAGE"
echo "lifecycle_warranty_expired_badge=ok"
grep -q 'badge b-amber">expiring' <<<"$PAGE"
echo "lifecycle_warranty_expiring_badge=ok"
grep -q '100.00' <<<"$PAGE"
echo "lifecycle_current_value_shown=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/reports/lifecycle?status=deployed")";grep -q 'LIFE-EXPIRING' <<<"$PAGE";! grep -q 'LIFE-OLD' <<<"$PAGE"
echo "lifecycle_filter_status=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/reports/lifecycle?min_age_days=365")";grep -q 'LIFE-OLD' <<<"$PAGE";! grep -q 'LIFE-RECENT' <<<"$PAGE"
echo "lifecycle_filter_age_min=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/reports/lifecycle?max_age_days=365")";grep -q 'LIFE-RECENT' <<<"$PAGE";! grep -q 'LIFE-OLD' <<<"$PAGE"
echo "lifecycle_filter_age_max=ok"
HDR="$TMP/headers";curl -sS -b "$ADMIN" -D "$HDR" -o "$TMP/lifecycle.csv" "$BASE/reports/lifecycle.csv";grep -qi 'Content-Type: text/csv' "$HDR";grep -q 'asset_tag' "$TMP/lifecycle.csv"
echo "lifecycle_csv_export=ok"
curl -sS -b "$ADMIN" "$BASE/reports"|grep -q 'Lifecycle'
echo "lifecycle_on_reports_page=ok"
login viewer "$VIEWER" password123
[ "$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" "$BASE/reports/lifecycle")" = 200 ]
echo "viewer_can_access=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/reports/lifecycle")";grep -q '<h1>Asset Lifecycle' <<<"$PAGE";! grep -q 'Page not found' <<<"$PAGE"
echo "route_before_csv_wildcard=ok"
echo "stage19_smoke=passed"

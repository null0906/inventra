#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3413}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";MANAGER="$TMP/manager"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Offboard+Target&username=target&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /users 'name=Manager&username=manager&email=&role=manager&password=password123')" = 303 ]
[ "$(post "$ADMIN" /users 'name=Empty+User&username=empty&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=OFF-001&name=Target+Laptop&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /assets/1/checkout 'checkout_to=user&user_id=2')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Target+Mouse&qty=2&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories/1/checkout 'user_id=2&note=Assigned')" = 303 ]
[ "$(post "$ADMIN" /consumables 'name=Target+Cable&qty=10&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /consumables/1/checkout 'user_id=2&qty=3&note=Assigned')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Target+License&seats=2')" = 303 ]
[ "$(post "$ADMIN" /licenses/1/assign 'user_id=2')" = 303 ]

curl -sS -b "$ADMIN" "$BASE/users/2/edit"|grep -q 'Return all items & deactivate'
[ "$(post "$ADMIN" /users/2/offboard '')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/assets/1"|grep -q 'deployable'
! curl -sS -b "$ADMIN" "$BASE/assets/1"|grep -q 'Offboard Target'
echo "offboard_assets_returned=ok"
curl -sS -b "$ADMIN" "$BASE/accessories/1"|grep -q '2 / 2'
! curl -sS -b "$ADMIN" "$BASE/accessories/1"|grep -q 'Offboard Target'
echo "offboard_accessories_returned=ok"
curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>10</td>'
! curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q 'Offboard Target'
echo "offboard_consumables_checkedin=ok"
! curl -sS -b "$ADMIN" "$BASE/licenses/1"|grep -q 'Offboard Target'
echo "offboard_license_seats_released=ok"
curl -sS -b "$ADMIN" "$BASE/users"|grep -A3 'target'|grep -q 'disabled'
echo "offboard_user_deactivated=ok"

curl -sS -b "$ADMIN" "$BASE/users/4/edit"|grep -q '>Deactivate user<'
[ "$(post "$ADMIN" /users/4/offboard '')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/users"|grep -A3 'empty'|grep -q 'disabled'
echo "offboard_zero_items_ok=ok"

ACTIVITY="$(curl -sS -b "$ADMIN" "$BASE/activity")"
for action in offboard-checkin offboard-return offboard-license offboard-asset deactivate;do grep -q "$action" <<<"$ACTIVITY";done
echo "offboard_activity_logged=ok"

[ "$(post "$ADMIN" /users/1/offboard '')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/users"|grep -A3 'admin'|grep -q 'active'
echo "offboard_self_blocked=ok"
login manager "$MANAGER" password123
[ "$(post "$MANAGER" /users/4/offboard '')" = 403 ]
echo "offboard_viewer_blocked=ok"

kill "$PID";wait "$PID" 2>/dev/null||true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$ADMIN" "$BASE/users"|grep -A3 'target'|grep -q 'disabled'
echo "schema_restart=ok"
echo "stage13_smoke=passed"

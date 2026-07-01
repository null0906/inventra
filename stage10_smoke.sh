#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3410}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)";ADMIN="$TMP/admin";TARGET="$TMP/target"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
login admin "$ADMIN" admin123

printf x >"$TMP/x.txt"
[ "$(post "$ADMIN" /users 'name=Target&username=target&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /consumables 'name=Toner&category_id=&location_id=&qty=5&min_qty=1&cost=10')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=NET-1&status=deployable&ip_address=10.0.0.5&mac_address=AA%3ABB%3ACC%3ADD%3AEE%3AFF')" = 303 ]
for i in $(seq 1 20);do curl -sS -b "$ADMIN" -o /dev/null -F "_csrf=$(csrf "$ADMIN")" -F "file=@$TMP/x.txt;filename=f$i.txt;type=text/plain" -X POST "$BASE/assets/1/attachments";done
HDR="$TMP/h";curl -sS -b "$ADMIN" -D "$HDR" -o /dev/null -F "_csrf=$(csrf "$ADMIN")" -F "file=@$TMP/x.txt;filename=f21.txt;type=text/plain" -X POST "$BASE/assets/1/attachments";grep -qi 'Attachment limit reached' "$HDR"
echo "carry_forward_atomic_limit=ok"

[ "$(post "$ADMIN" /consumables/1/checkout 'user_id=2&qty=2&note=Project')" = 303 ]
curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>3</td>'
echo "consumable_checkout=ok"
[ "$(post "$ADMIN" /consumables/1/checkout 'user_id=2&qty=99')" = 303 ];curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>3</td>'
echo "insufficient_stock_rejected=ok"
[ "$(post "$ADMIN" /consumables/1/checkout 'user_id=999&qty=1')" = 303 ];curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>3</td>'
echo "invalid_user_rejected=ok"

login target "$TARGET" password123
curl -sS -b "$TARGET" "$BASE/my"|grep -q Toner
echo "my_items_shows_checkout=ok"
curl -sS -b "$ADMIN" "$BASE/reports/consumable_checkouts.csv"|grep -q 'checked_out_to'
echo "consumable_checkouts_csv=ok"

[ "$(post "$ADMIN" /consumable-checkouts/1/checkin '')" = 303 ];curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>5</td>'
echo "consumable_checkin=ok"
[ "$(post "$ADMIN" /consumable-checkouts/1/checkin '')" = 303 ];curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>5</td>'
echo "double_checkin_blocked=ok"

DETAIL="$(curl -sS -b "$ADMIN" "$BASE/assets/1")";grep -q '10.0.0.5' <<<"$DETAIL";grep -q 'AA:BB:CC:DD:EE:FF' <<<"$DETAIL"
echo "ip_mac_asset_create=ok"
TOKEN="$(curl -sS -b "$ADMIN" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf "$ADMIN")&name=t10"|grep -oE 'inv_[0-9a-f]{64}'|head -1)"
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "$BASE/api/v1/assets/1" -d '{"ip_address":"10.0.0.9"}'|grep -q '"ip_address":"10.0.0.9"'
echo "ip_mac_asset_api=ok"
curl -sS -b "$ADMIN" "$BASE/reports/assets.csv"|head -1|grep -q 'ip_address'
echo "ip_mac_in_assets_csv=ok"

kill "$PID";wait "$PID" 2>/dev/null||true;DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$ADMIN" "$BASE/reports/consumable_checkouts.csv"|grep -q Toner
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/assets/1"|grep -q '"ip_address":"10.0.0.9"'
echo "schema_restart=ok"
echo "stage10_smoke=passed"

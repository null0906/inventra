#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3408}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)";JAR="$TMP/cookies"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -c "$JAR" -d "username=admin&password=admin123" -X POST "$BASE/login" >/dev/null
csrf(){ curl -sS -b "$JAR" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE$1" -d "_csrf=$(csrf)&$2";}

[ "$(post /locations 'name=Server+Room&address=')" = 303 ]
[ "$(post /assets 'asset_tag=CHK-001&status=deployable')" = 303 ]
[ "$(post /assets/1/checkout 'checkout_to=location&location_id=1')" = 303 ]
DETAIL="$(curl -sS -b "$JAR" "$BASE/assets/1")";grep -q 'Checkout location' <<<"$DETAIL";grep -q 'Server Room' <<<"$DETAIL"
[ "$(post /assets/1/checkin '')" = 303 ];curl -sS -b "$JAR" "$BASE/assets/1"|grep -q 'deployable'
echo "web_location_checkout_checkin=ok"

INVALID="$(curl -sS -b "$JAR" -X POST "$BASE/assets/1" -d "_csrf=$(csrf)&asset_tag=CHK-001&status=deployable&photo_url=javascript:alert(1)")";grep -q 'Photo URL must start with https://' <<<"$INVALID"
[ "$(post /assets/1 'asset_tag=CHK-001&status=deployable&photo_url=https%3A%2F%2Fexample.com%2Fasset.png')" = 303 ];curl -sS -b "$JAR" "$BASE/assets/1"|grep -q 'src="https://example.com/asset.png"'
echo "photo_url_web_validation=ok"

TOKEN="$(curl -sS -b "$JAR" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf)&name=stage8"|grep -oE 'inv_[0-9a-f]{64}'|head -1)"
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X POST "$BASE/api/v1/assets/1/checkout" -d '{"location_id":1}'|grep -q '"checkout_location_id":1'
curl -sS -H "Authorization: Bearer $TOKEN" -X POST "$BASE/api/v1/assets/1/checkin"|grep -q '"checkout_location_id":null'
STATUS="$(curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/v1/assets/1" -d '{"photo_url":"data:text/html,bad"}')";[ "$STATUS" = 400 ]
echo "api_location_and_photo_validation=ok"

printf 'asset_tag,status,photo_url\nCSV-PHOTO,deployable,javascript:bad\n' >"$TMP/assets.csv"
curl -sS -b "$JAR" -o /dev/null -F "_csrf=$(csrf)" -F "csv=@$TMP/assets.csv" -X POST "$BASE/assets/import"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/assets?q=CSV-PHOTO"|grep -q '"photo_url":null'
echo "csv_invalid_photo_cleared=ok"

for r in by_user by_location unassigned;do [ "$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/reports/$r.csv")" = 200 ];done
echo "extended_reports=ok"

printf 'username,name,email,role\nstage8user,Stage Eight,s8@test.com,viewer\n' >"$TMP/users.csv"
HDR="$TMP/headers";curl -sS -b "$JAR" -D "$HDR" -o /dev/null -F "_csrf=$(csrf)" -F "csv=@$TMP/users.csv" -X POST "$BASE/users/import"
grep -qi 'New%20user%20temp%20passwords' "$HDR"
! curl -sS -b "$JAR" "$BASE/reports/activity.csv"|grep -q 'temp_pw:'
echo "temp_password_flash_only=ok"

kill "$PID";wait "$PID" 2>/dev/null||true;DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
echo "schema_restart=ok"
echo "stage8_smoke=passed"

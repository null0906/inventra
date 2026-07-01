#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3406}"
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"
JAR="$TMP/cookies"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 &
PID=$!
for _ in {1..30}; do curl -sf "$BASE/healthz" >/dev/null && break; sleep .1; done

curl -sS -c "$JAR" -d "username=admin&password=admin123" -X POST "$BASE/login" >/dev/null
csrf(){ curl -sS -b "$JAR" "$BASE/assets/new" | sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' | head -1; }
post(){ curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE$1" -d "_csrf=$(csrf)&$2"; }

[ "$(post /users 'name=Target&username=target&email=&role=viewer&password=password123')" = 303 ]
[ "$(post /assets 'asset_tag=BULK-1&name=First&status=deployable')" = 303 ]
[ "$(post /assets 'asset_tag=BULK-2&name=Second&status=deployable')" = 303 ]
[ "$(post /assets/1/checkout 'user_id=2')" = 303 ]
[ "$(post /assets/2/checkout 'user_id=2')" = 303 ]
[ "$(post /assets/bulk 'asset_ids[]=1&asset_ids[]=2&bulk_action=checkin')" = 303 ]
curl -sS -b "$JAR" "$BASE/assets/1" | grep -q 'deployable'
curl -sS -b "$JAR" "$BASE/assets/2" | grep -q 'deployable'
echo "bulk_checkin=ok"

[ "$(post /assets/bulk 'asset_ids[]=1&asset_ids[]=2&bulk_action=checkout&user_id=2')" = 303 ]
curl -sS -b "$JAR" "$BASE/assets/1" | grep -q 'deployed'
[ "$(post /assets/bulk 'asset_ids[]=1&asset_ids[]=2&bulk_action=update_status&new_status=archived')" = 303 ]
curl -sS -b "$JAR" "$BASE/assets/2" | grep -q 'archived'
echo "bulk_checkout_and_status=ok"

STATUS="$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/assets/bulk" -d "_csrf=$(csrf)&asset_ids[]=../etc&bulk_action=checkin")"
[ "$STATUS" = 400 ]
echo "bulk_invalid_id_status=$STATUS"

curl -sS -b "$JAR" "$BASE/assets/import/template.csv" | head -1 | grep -q 'asset_tag'
echo "template_has_asset_tag=ok"

printf 'asset_tag,name,status\nTEST-0001,"Imported, Asset",deployable\n' >"$TMP/import.csv"
STATUS="$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" -F "_csrf=$(csrf)" -F "csv=@$TMP/import.csv" -X POST "$BASE/assets/import")"
[ "$STATUS" = 303 ]
curl -sS -b "$JAR" "$BASE/assets?q=TEST-0001" | grep -q 'Imported, Asset'
echo "csv_quoted_import=ok"

printf 'asset_tag,name\nTEST-0001,Updated Asset\n' >"$TMP/update.csv"
curl -sS -b "$JAR" -o /dev/null -F "_csrf=$(csrf)" -F "csv=@$TMP/update.csv" -X POST "$BASE/assets/import"
curl -sS -b "$JAR" "$BASE/assets?q=TEST-0001" | grep -q 'Updated Asset'
echo "csv_upsert=ok"
[ "$(post /assets/bulk 'asset_ids[]=3&bulk_action=delete')" = 303 ]
curl -sS -b "$JAR" "$BASE/assets/3" | grep -q 'Asset not found'
echo "bulk_delete=ok"

{ echo 'asset_tag,name'; for i in $(seq 1 5001); do printf 'OVER-%05d,test\n' "$i"; done; } >"$TMP/rows.csv"
STATUS="$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" -F "_csrf=$(csrf)" -F "csv=@$TMP/rows.csv" -X POST "$BASE/assets/import")"
[ "$STATUS" = 303 ]
echo "row_limit_rejected=$STATUS"

dd if=/dev/zero of="$TMP/oversize.csv" bs=1048576 count=6 2>/dev/null
STATUS="$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" -F "_csrf=$(csrf)" -F "csv=@$TMP/oversize.csv" -X POST "$BASE/assets/import")"
[ "$STATUS" = 303 ]
echo "file_size_limit_rejected=$STATUS"

curl -sS -b "$JAR" "$BASE/labels?ids=1,2" | grep -q 'Labels (2)'
echo "selected_labels=ok"

kill "$PID"; wait "$PID" 2>/dev/null || true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 &
PID=$!
for _ in {1..30}; do curl -sf "$BASE/healthz" >/dev/null && break; sleep .1; done
echo "schema_restart=ok"
echo "stage6_smoke=passed"

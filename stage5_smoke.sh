#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3399}"
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
csrf(){ curl -sS -b "$JAR" "$BASE/profile" | sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' | head -1; }
post(){ curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE$1" -d "_csrf=$(csrf)&$2"; }

[ "$(post /custom-fields 'label=Condition&field_type=select&select_options=New%0AUsed%0A%3Dcmd&required=1')" = 303 ]
[ "$(post /models 'name=Smoke+Model&model_no=S5')" = 303 ]
[ "$(post /models/1/fields 'field_id=1')" = 303 ]
curl -sS -b "$JAR" "$BASE/models/1/edit" | grep -q 'Condition'
echo "field_and_model_attachment=ok"

PREVIEW="$(curl -sS -b "$JAR" -X POST "$BASE/assets" -d "_csrf=$(csrf)&_model_preview=1&asset_tag=S5-1&model_id=1&status=deployable")"
grep -q 'name="cf_condition"' <<<"$PREVIEW"
echo "model_preview=ok"

MISSING="$(curl -sS -b "$JAR" -X POST "$BASE/assets" -d "_csrf=$(csrf)&asset_tag=S5-MISSING&model_id=1&status=deployable")"
grep -q 'Required custom fields: Condition' <<<"$MISSING"
echo "required_validation=ok"

[ "$(post /assets 'asset_tag=S5-1&name=Stage+Five&model_id=1&status=deployable&cf_condition=%3Dcmd')" = 303 ]
curl -sS -b "$JAR" "$BASE/assets/1" | grep -q '=cmd'
echo "asset_custom_value=ok"

TOKEN="$(curl -sS -b "$JAR" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf)&name=stage5" | sed -n 's/.*<code>\(inv_[0-9a-f]*\)<\/code>.*/\1/p')"
[ "${#TOKEN}" = 68 ]
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/assets/1" | grep -q '"custom_fields":{"condition":"=cmd"}'
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "$BASE/api/v1/assets/1" -d '{"custom_fields":{"condition":"Used"}}' | grep -q '"condition":"Used"'
echo "api_custom_fields=ok"

curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "$BASE/api/v1/assets/1" -d '{"custom_fields":{"condition":"=cmd"}}' >/dev/null
CSV="$(curl -sS -b "$JAR" "$BASE/reports/assets.csv")"
grep -q 'Condition' <<<"$CSV"
grep -q "'=cmd" <<<"$CSV"
echo "csv_dynamic_header_and_injection_guard=ok"

[ "$(post /users 'name=Manager&username=manager&email=&role=manager&password=password123')" = 303 ]
curl -sS -c "$TMP/manager" -d "username=manager&password=password123" -X POST "$BASE/login" >/dev/null
STATUS="$(curl -sS -b "$TMP/manager" -o /dev/null -w "%{http_code}" "$BASE/custom-fields")"
[ "$STATUS" = 403 ]
echo "admin_role_guard=ok"

kill "$PID"; wait "$PID" 2>/dev/null || true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 &
PID=$!
for _ in {1..30}; do curl -sf "$BASE/healthz" >/dev/null && break; sleep .1; done
echo "schema_restart=ok"
echo "stage5_smoke=passed"

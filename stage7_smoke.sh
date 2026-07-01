#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3407}"; BASE="http://127.0.0.1:$PORT"; TMP="$(mktemp -d)"; JAR="$TMP/cookies"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }; trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -c "$JAR" -d "username=admin&password=admin123" -X POST "$BASE/login" >/dev/null
csrf(){ curl -sS -b "$JAR" "$BASE/profile" | sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1; }
post(){ curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE$1" -d "_csrf=$(csrf)&$2"; }

[ "$(post /departments 'name=Engineering&manager_id=1')" = 303 ]
curl -sS -b "$JAR" "$BASE/departments" | grep -q Engineering
echo "department_crud=ok"
[ "$(post /users 'name=Engineer&username=engineer&email=&role=viewer&password=password123&department_id=1')" = 303 ]
curl -sS -b "$JAR" "$BASE/users" | grep -q Engineering
curl -sS -b "$JAR" "$BASE/assets?dept_id=1" | grep -q 'All departments'
echo "user_department_and_asset_filter=ok"

RESULT="$(curl -sS -b "$JAR" -X POST "$BASE/assets" -d "_csrf=$(csrf)&asset_tag=BAD-1&status=injected")"
grep -q 'Invalid status' <<<"$RESULT"
echo "asset_status_whitelist=ok"

curl -sS -b "$JAR" "$BASE/users/import/template.csv" | grep -q '^username,name,email,role,department'
printf 'username,name,email,role,department\nimported.user,Imported User,imported@example.com,manager,Engineering\nbad user,Bad User,,viewer,Engineering\n' >"$TMP/users.csv"
[ "$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" -F "_csrf=$(csrf)" -F "csv=@$TMP/users.csv" -X POST "$BASE/users/import")" = 303 ]
curl -sS -b "$JAR" "$BASE/users" | grep -q imported.user
! curl -sS -b "$JAR" "$BASE/users" | grep -q 'bad user'
echo "user_import_and_username_validation=ok"

[ "$(post /settings 'app_name=Inventra&base_url=&asset_tag_prefix=AST-&items_per_page=50&smtp_enabled=0&smtp_host=&smtp_port=587&smtp_tls=0&smtp_user=&smtp_from=&notify_warranty_days=45&notify_license_days=14')" = 303 ]
SETTINGS="$(curl -sS -b "$JAR" "$BASE/settings")";grep -q 'name="notify_warranty_days"' <<<"$SETTINGS";grep -q 'value="45"' <<<"$SETTINGS";grep -q 'name="notify_license_days"' <<<"$SETTINGS";grep -q 'value="14"' <<<"$SETTINGS"
echo "notification_thresholds=ok"
curl -sS -b "$JAR" "$BASE/reports/departments.csv" | grep -q Engineering
curl -sS -b "$JAR" "$BASE/" | grep -q 'By department'
echo "department_dashboard_and_report=ok"

kill "$PID";wait "$PID" 2>/dev/null||true;DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
echo "schema_restart=ok"
echo "stage7_smoke=passed"

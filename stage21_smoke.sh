#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3421}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
token(){ curl -sS -b "$1" -X POST "$BASE/profile/tokens" -d "_csrf=$(csrf "$1")&name=$2"|grep -oE 'inv_[0-9a-f]{64}'|head -1;}
sql(){ DB_PATH="$TMP/data/app.db" SQL="$1" bun -e 'import {Database} from "bun:sqlite";const d=new Database(process.env.DB_PATH!);const r=d.query(process.env.SQL!).get() as any;console.log(r?Object.values(r)[0]:"")'; }
execsql(){ DB_PATH="$TMP/data/app.db" SQL="$1" bun -e 'import {Database} from "bun:sqlite";new Database(process.env.DB_PATH!).exec(process.env.SQL!);'; }
months_ago(){ MONTHS="$1" bun -e "const d=new Date();d.setUTCMonth(d.getUTCMonth()-Number(process.env.MONTHS));console.log(d.toISOString().slice(0,10));"; }

login admin "$ADMIN" admin123
TOKEN="$(token "$ADMIN" stage21)"
[ "$(post "$ADMIN" /assets 'asset_tag=PATCH-001&name=Patch+Asset&status=deployable')" = 303 ]
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X POST "$BASE/api/v1/maintenance" -d '{"asset_id":1,"type":"repair","title":"Patch maint","start_date":"2026-01-01","completion_date":"2026-01-02"}' >/dev/null
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "$BASE/api/v1/maintenance/1" -d '{"completion_date":null}'|grep -q '"completed":0'
echo "stage20_fix_maintenance_patch=ok"
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "$BASE/api/v1/maintenance/1" -d '{"completion_date":"2025-01-01"}'|grep -q '"completed":1'
echo "stage20_fix_maintenance_patch_set=ok"

curl -sS -b "$ADMIN" "$BASE/profile"|grep -q 'notify_low_stock'
echo "profile_prefs_form_renders=ok"
[ "$(post "$ADMIN" /profile 'notify_action=prefs&notify_low_stock=1&notify_license_expiry=1&notify_warranty_expiry=1&notify_digest=1')" = 303 ]
[ "$(sql 'SELECT notify_digest FROM users WHERE id=1')" = 1 ]
echo "profile_prefs_save=ok"
[ "$(post "$ADMIN" /profile 'notify_action=prefs&notify_license_expiry=1&notify_warranty_expiry=1&notify_digest=1')" = 303 ]
[ "$(sql 'SELECT notify_low_stock FROM users WHERE id=1')" = 0 ]
echo "profile_prefs_uncheck=ok"

[ "$(post "$ADMIN" /users 'name=Digest+Skip&username=viewer&email=viewer@example.com&role=viewer&password=password123')" = 303 ]
login viewer "$VIEWER" password123
execsql "INSERT INTO settings(key,value) VALUES('smtp_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1';"
execsql "DELETE FROM email_queue;"
[ "$(post "$ADMIN" /consumables 'name=Pref+Low&qty=0&min_qty=1')" = 303 ]
[ "$(post "$ADMIN" /notifications/check '')" = 303 ]
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE to_address='admin@example.com' AND subject LIKE 'Low stock%'")" = 0 ]
echo "notification_low_stock_respects_pref=ok"

execsql "DELETE FROM email_queue;"
[ "$(post "$ADMIN" /licenses 'name=Pref+License&seats=1&expires=2026-07-15')" = 303 ]
[ "$(post "$ADMIN" /profile 'notify_action=prefs&notify_warranty_expiry=1&notify_digest=1')" = 303 ]
[ "$(post "$ADMIN" /notifications/check '')" = 303 ]
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE to_address='admin@example.com' AND subject LIKE 'License expiry%'")" = 0 ]
echo "notification_license_respects_pref=ok"

execsql "DELETE FROM email_queue;"
EXPIRING_DATE="$(months_ago 10)"
[ "$(post "$ADMIN" /assets "asset_tag=PREF-WARR&name=Warranty+Asset&status=deployable&purchase_date=$EXPIRING_DATE&warranty_months=12")" = 303 ]
[ "$(post "$ADMIN" /profile 'notify_action=prefs&notify_digest=1')" = 303 ]
[ "$(post "$ADMIN" /notifications/check '')" = 303 ]
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE to_address='admin@example.com' AND subject LIKE 'Warranty expiry%'")" = 0 ]
echo "notification_warranty_respects_pref=ok"

execsql "DELETE FROM email_queue; DELETE FROM settings WHERE key='last_digest_sent';"
[ "$(post "$ADMIN" /profile 'notify_action=prefs&notify_digest=1')" = 303 ]
[ "$(post "$ADMIN" /notifications/digest '')" = 303 ]
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE to_address='admin@example.com' AND subject LIKE '[Inventra] Weekly digest%'")" = 1 ]
echo "digest_sends=ok"
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE to_address='viewer@example.com' AND subject LIKE '[Inventra] Weekly digest%'")" = 0 ]
echo "digest_skips_opted_out=ok"
[ "$(post "$ADMIN" /notifications/digest '')" = 303 ]
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE subject LIKE '[Inventra] Weekly digest%'")" = 1 ]
echo "digest_rate_limit=ok"
curl -sS -b "$ADMIN" -c "$ADMIN" -o /dev/null -X POST "$BASE/notifications/digest?force=1" -d "_csrf=$(csrf "$ADMIN")"
[ "$(sql "SELECT COUNT(*) FROM email_queue WHERE subject LIKE '[Inventra] Weekly digest%'")" = 2 ]
echo "digest_force_override=ok"

kill "$PID";wait "$PID" 2>/dev/null||true
DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
[ "$(sql 'SELECT notify_digest FROM users WHERE id=1')" = 1 ]
echo "schema_restart=ok"
echo "stage21_smoke=passed"

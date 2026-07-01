#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3415}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Viewer&username=viewer&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=TIME-001&name=Timeline+Asset&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /assets/1/checkout 'checkout_to=user&user_id=2&note=%3Cscript%3Ealert(1)%3C%2Fscript%3E')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Over+License&seats=2')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Capacity+License&seats=1')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Available+License&seats=2')" = 303 ]
[ "$(post "$ADMIN" /licenses/1/assign 'user_id=2')" = 303 ]
[ "$(post "$ADMIN" /licenses/1/assign 'user_id=2')" = 303 ]
[ "$(post "$ADMIN" /licenses/2/assign 'user_id=2')" = 303 ]
[ "$(post "$ADMIN" /licenses/3/assign 'user_id=2')" = 303 ]
DB_PATH="$TMP/data/app.db" bun -e 'import {Database} from "bun:sqlite";const d=new Database(process.env.DB_PATH!);d.run("UPDATE licenses SET seats=1 WHERE id=1");'

curl -sS -b "$ADMIN" "$BASE/assets/1"|grep -q '<h2>History</h2>'
echo "asset_timeline_renders=ok"
curl -sS -b "$ADMIN" "$BASE/licenses/1"|grep -q '<h2>History</h2>'
echo "license_timeline_renders=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/assets/1")";grep -q '&lt;script&gt;alert(1)&lt;/script&gt;' <<<"$PAGE";! grep -q '<script>alert(1)</script>' <<<"$PAGE"
echo "timeline_escapes_html=ok"

[ "$(curl -sS -b "$ADMIN" -o /dev/null -w "%{http_code}" "$BASE/licenses/compliance")" = 200 ]
echo "compliance_page_loads=ok"
PAGE="$(curl -sS -b "$ADMIN" "$BASE/licenses/compliance")"
grep -q 'badge b-red">over-seated' <<<"$PAGE"
echo "compliance_over_seated=ok"
grep -q 'badge b-amber">at capacity' <<<"$PAGE"
echo "compliance_at_capacity=ok"
grep -q 'badge b-green">available' <<<"$PAGE"
echo "compliance_available=ok"
grep -q '<h1>License Compliance</h1>' <<<"$PAGE"
! grep -q 'License not found' <<<"$PAGE"
echo "compliance_before_id_route=ok"
login viewer "$VIEWER" password123
[ "$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" "$BASE/licenses/compliance")" = 200 ]
echo "viewer_can_access_compliance=ok"
echo "stage15_smoke=passed"

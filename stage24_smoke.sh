#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
ok(){ echo "$1=ok"; }
fail(){ echo "$1=fail"; exit 1; }
free_port(){ python3 - <<'PY'
import socket
s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()
PY
}
wait_http(){ for _ in {1..80}; do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && return 0; sleep .2; done; return 1; }
csrf(){ curl -fsS -b "$1" "$BASE$2" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | cut -d'"' -f4; }
sql_get(){ SQL="$1" ARGS="${2:-[]}" DATA_DIR="$DATA_DIR" bun -e 'import {db} from "./src/db.ts"; const args=JSON.parse(process.env.ARGS||"[]"); console.log(JSON.stringify(db.query(process.env.SQL!).get(...args)??null));' 2>/dev/null; }
sql_run(){ SQL="$1" ARGS="${2:-[]}" DATA_DIR="$DATA_DIR" bun -e 'import {db} from "./src/db.ts"; const args=JSON.parse(process.env.ARGS||"[]"); db.run(process.env.SQL!,args);' 2>/dev/null; }
json_field(){ python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])"; }

bun run build >/tmp/inventra_stage24_build.log
export DATA_DIR="$(mktemp -d)"
PORT="$(free_port)"
BASE="http://127.0.0.1:$PORT"
ADMIN_COOKIES="$(mktemp)"
CUSTOM_COOKIES="$(mktemp)"
VIEWER_COOKIES="$(mktemp)"
MANAGER_COOKIES="$(mktemp)"
PORT="$PORT" HOST=127.0.0.1 DATA_DIR="$DATA_DIR" NOTIFY_CHECK_HOURS=168 ./dist/inventra >/tmp/inventra_stage24.log 2>&1 &
PID=$!
trap 'kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true' EXIT
wait_http || { cat /tmp/inventra_stage24.log; fail server_start; }

curl -fsS -c "$ADMIN_COOKIES" -b "$ADMIN_COOKIES" -d "username=admin&password=admin123" "$BASE/login" >/dev/null

sql_run "INSERT INTO manufacturers(name) VALUES('Acme')"
sql_run "INSERT INTO locations(name,address) VALUES('HQ','1 Main St')"
sql_run "INSERT INTO suppliers(name,contact) VALUES('SupplyCo','supply@example.com')"
sql_run "INSERT INTO models(name,model_no,manufacturer_id,category_id,min_qty) VALUES('Stage24 Model','S24',1,1,0)"
sql_run "INSERT INTO assets(asset_tag,name,model_id,status,location_id) VALUES('S24-001','Stage24 Assigned',1,'deployed',1)"
sql_run "INSERT INTO assets(asset_tag,name,model_id,status,location_id) VALUES('S24-002','Stage24 Stock',1,'deployable',1)"
sql_run "INSERT INTO accessories(name,supplier_id,qty,min_qty) VALUES('Stage24 Dock',1,3,0)"

curl -fsS -b "$ADMIN_COOKIES" "$BASE/categories" | grep -q "<th>Total</th><th>In use</th><th>In stock</th>" || fail catalog_categories_stats
curl -fsS -b "$ADMIN_COOKIES" "$BASE/categories" | grep -q '<span class="badge b-blue">1</span>' || fail catalog_categories_stats
curl -fsS -b "$ADMIN_COOKIES" "$BASE/categories" | grep -q '<span class="badge b-green">1</span>' || fail catalog_categories_stats
ok catalog_categories_stats

curl -fsS -b "$ADMIN_COOKIES" "$BASE/models" | grep -q "<th>Total</th><th>In use</th><th>In stock</th>" || fail catalog_models_stats
curl -fsS -b "$ADMIN_COOKIES" "$BASE/models" | grep -q 'Stage24 Model' || fail catalog_models_stats
ok catalog_models_stats

curl -fsS -b "$ADMIN_COOKIES" "$BASE/categories/1/edit" | grep -q '<div class="stats" style="margin-bottom:20px">' || fail catalog_detail_stat_cards
ok catalog_detail_stat_cards

REQ_CODE="$(curl -s -o /tmp/stage24_requests.html -w "%{http_code}" -b "$ADMIN_COOKIES" "$BASE/requests")"
[[ "$REQ_CODE" == "404" ]] || fail requests_routes_removed
ok requests_routes_removed

curl -fsS -b "$ADMIN_COOKIES" "$BASE/" | grep -q 'href="/requests"' && fail requests_nav_gone
ok requests_nav_gone

sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('Plain Viewer','plainviewer','plainviewer@example.com',?,'viewer')" "[\"$(bun -e 'console.log(Bun.password.hashSync("ViewPass123","bcrypt"))')\"]"
curl -fsS -c "$VIEWER_COOKIES" -b "$VIEWER_COOKIES" -d "username=plainviewer&password=ViewPass123" "$BASE/login" >/dev/null
curl -fsS -b "$VIEWER_COOKIES" "$BASE/assets/2" | grep -qi 'request' && fail requests_button_asset_gone
ok requests_button_asset_gone

curl -fsS -b "$VIEWER_COOKIES" "$BASE/my" | grep -q "My Requests" && fail requests_my_page_gone
ok requests_my_page_gone

CSRF="$(csrf "$ADMIN_COOKIES" /admin/roles/new)"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/admin/roles" \
  -d "_csrf=$CSRF" -d "name=Assets Only" -d "permission=assets.view" -d "permission=licenses.view" >/dev/null
ROLE_ID="$(sql_get "SELECT id FROM roles WHERE name='Assets Only'" | json_field id)"
sql_get "SELECT COUNT(*) n FROM role_permissions WHERE role_id=?" "[$ROLE_ID]" | grep -q '"n":2' || fail role_create
ok role_create

CSRF="$(csrf "$ADMIN_COOKIES" "/admin/roles/$ROLE_ID/edit")"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/admin/roles/$ROLE_ID/edit" \
  -d "_csrf=$CSRF" -d "name=Assets Only" -d "permission=assets.view" >/dev/null
sql_get "SELECT COUNT(*) n FROM role_permissions WHERE role_id=? AND permission='licenses.view'" "[$ROLE_ID]" | grep -q '"n":0' || fail role_edit_perms
ok role_edit_perms

sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('Custom Role User','customrole','customrole@example.com',?,'viewer')" "[\"$(bun -e 'console.log(Bun.password.hashSync("CustomPass123","bcrypt"))')\"]"
CUSTOM_ID="$(sql_get "SELECT id FROM users WHERE username='customrole'" | json_field id)"
CSRF="$(csrf "$ADMIN_COOKIES" "/users/$CUSTOM_ID/edit")"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/users/$CUSTOM_ID" \
  -d "_csrf=$CSRF&name=Custom+Role+User&username=customrole&email=customrole@example.com&role=viewer&custom_role_id=$ROLE_ID&department_id=" >/dev/null
sql_get "SELECT custom_role_id FROM users WHERE id=?" "[$CUSTOM_ID]" | grep -q "\"custom_role_id\":$ROLE_ID" || fail user_assigned_custom_role
ok user_assigned_custom_role

CSRF="$(csrf "$ADMIN_COOKIES" "/admin/roles/$ROLE_ID/edit")"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/admin/roles/$ROLE_ID/delete" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT COUNT(*) n FROM roles WHERE id=?" "[$ROLE_ID]" | grep -q '"n":1' || fail role_delete_blocked
ok role_delete_blocked

CSRF="$(csrf "$ADMIN_COOKIES" /admin/roles/new)"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/admin/roles" \
  -d "_csrf=$CSRF" -d "name=Unused Role" -d "permission=assets.view" >/dev/null
UNUSED_ID="$(sql_get "SELECT id FROM roles WHERE name='Unused Role'" | json_field id)"
CSRF="$(csrf "$ADMIN_COOKIES" "/admin/roles/$UNUSED_ID/edit")"
curl -fsS -b "$ADMIN_COOKIES" -c "$ADMIN_COOKIES" -X POST "$BASE/admin/roles/$UNUSED_ID/delete" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT COUNT(*) n FROM roles WHERE id=?" "[$UNUSED_ID]" | grep -q '"n":0' || fail role_delete_ok
ok role_delete_ok

curl -fsS -c "$CUSTOM_COOKIES" -b "$CUSTOM_COOKIES" -d "username=customrole&password=CustomPass123" "$BASE/login" >/dev/null
ASSET_CODE="$(curl -s -o /tmp/stage24_custom_assets.html -w "%{http_code}" -b "$CUSTOM_COOKIES" "$BASE/assets")"
LICENSE_CODE="$(curl -s -o /tmp/stage24_custom_licenses.html -w "%{http_code}" -b "$CUSTOM_COOKIES" "$BASE/licenses")"
[[ "$ASSET_CODE" == "200" && "$LICENSE_CODE" == "403" ]] || fail custom_role_assets_only
ok custom_role_assets_only

curl -fsS -b "$CUSTOM_COOKIES" "$BASE/assets" > /tmp/stage24_custom_nav.html
grep -q 'href="/assets"' /tmp/stage24_custom_nav.html || fail custom_role_nav_filtered
grep -q 'href="/licenses"' /tmp/stage24_custom_nav.html && fail custom_role_nav_filtered
ok custom_role_nav_filtered

sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('Plain Manager','plainmanager','plainmanager@example.com',?,'manager')" "[\"$(bun -e 'console.log(Bun.password.hashSync("ManagerPass123","bcrypt"))')\"]"
curl -fsS -c "$MANAGER_COOKIES" -b "$MANAGER_COOKIES" -d "username=plainmanager&password=ManagerPass123" "$BASE/login" >/dev/null
MANAGER_LICENSE_CODE="$(curl -s -o /tmp/stage24_manager_licenses.html -w "%{http_code}" -b "$MANAGER_COOKIES" "$BASE/licenses")"
ADMIN_ROLES_CODE="$(curl -s -o /tmp/stage24_admin_roles.html -w "%{http_code}" -b "$ADMIN_COOKIES" "$BASE/admin/roles")"
[[ "$MANAGER_LICENSE_CODE" == "200" && "$ADMIN_ROLES_CODE" == "200" ]] || fail system_role_unaffected
ok system_role_unaffected

curl -fsS -b "$ADMIN_COOKIES" "$BASE/assets" | grep -q "__nav_scroll" || fail nav_scroll_persists
curl -fsS -b "$ADMIN_COOKIES" "$BASE/assets" | grep -q "sessionStorage" || fail nav_scroll_persists
ok nav_scroll_persists

echo "stage24_smoke=passed"

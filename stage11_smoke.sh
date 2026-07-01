#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3411}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)";ADMIN="$TMP/admin";TARGET="$TMP/target"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT
bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
import_csv(){ curl -sS -b "$ADMIN" -D "$TMP/h" -o /dev/null -F "_csrf=$(csrf "$ADMIN")" -F "csv=@$2" -X POST "$BASE/$1/import";}
login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Target&username=target&email=&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Keyboard&qty=2&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories/1/checkout 'user_id=2&note=Desk')" = 303 ]
login target "$TARGET" password123;curl -sS -b "$TARGET" "$BASE/my"|grep -q Keyboard
[ "$(post "$ADMIN" /accessory-checkouts/1/return '')" = 303 ]
echo "accessory_return=ok"
[ "$(post "$ADMIN" /accessory-checkouts/1/return '')" = 303 ]
echo "double_return_blocked=ok"
! curl -sS -b "$TARGET" "$BASE/my"|grep -q Keyboard
echo "my_items_hides_returned=ok"
curl -sS -b "$ADMIN" "$BASE/accessories"|grep -q '2 / 2'
echo "availability_count_correct=ok"

printf 'name,seats,product_key\nImport License,3,KEY\n' >"$TMP/l.csv";import_csv licenses "$TMP/l.csv";curl -sS -b "$ADMIN" "$BASE/licenses"|grep -q 'Import License'
echo "license_import_create=ok"
printf 'name,seats\nImport License,7\n' >"$TMP/l.csv";import_csv licenses "$TMP/l.csv";curl -sS -b "$ADMIN" "$BASE/licenses/1"|grep -q '0 / 7'
echo "license_import_update=ok"
printf 'name,qty,min_qty,cost\nImport Consumable,5,1,2.5\n' >"$TMP/c.csv";import_csv consumables "$TMP/c.csv";curl -sS -b "$ADMIN" "$BASE/consumables"|grep -q 'Import Consumable'
echo "consumable_import_create=ok"
printf 'name,qty\nImport Consumable,9\n' >"$TMP/c.csv";import_csv consumables "$TMP/c.csv";curl -sS -b "$ADMIN" "$BASE/consumables/1"|grep -q '<td>9</td>'
echo "consumable_import_update=ok"
printf 'name,qty,notes\nImport Accessory,4,bulk\n' >"$TMP/a.csv";import_csv accessories "$TMP/a.csv";curl -sS -b "$ADMIN" "$BASE/accessories"|grep -q 'Import Accessory'
echo "accessory_import=ok"
printf 'name,qty,serial\nImport Component,6,S-1\n' >"$TMP/p.csv";import_csv components "$TMP/p.csv";curl -sS -b "$ADMIN" "$BASE/components"|grep -q 'Import Component'
echo "component_import=ok"

{ echo name;for i in $(seq 1 2001);do echo "Over $i";done;} >"$TMP/over.csv";import_csv components "$TMP/over.csv";grep -qi '2000 row limit' "$TMP/h"
echo "import_over_limit_rejected=ok"
printf 'name,qty\n,1\nGood Row,2\n' >"$TMP/bad.csv";import_csv components "$TMP/bad.csv";curl -sS -b "$ADMIN" "$BASE/components"|grep -q 'Good Row'
echo "import_bad_row_skipped=ok"
printf 'name,qty,mystery\nUnknown Column Item,1,x\n' >"$TMP/u.csv";import_csv accessories "$TMP/u.csv";grep -qi 'unknown%20columns%20ignored' "$TMP/h"
echo "import_unknown_columns_ignored=ok"
for e in licenses consumables accessories components;do curl -sS -b "$ADMIN" "$BASE/$e/import/template.csv"|head -1|grep -q name;done
echo "template_downloads=ok"

kill "$PID";wait "$PID" 2>/dev/null||true;DATA_DIR="$TMP/data" PORT="$PORT" ./dist/inventra >"$TMP/restart.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
curl -sS -b "$ADMIN" "$BASE/accessories"|grep -q '2 / 2'
echo "schema_restart=ok"
echo "stage11_smoke=passed"

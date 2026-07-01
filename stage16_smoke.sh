#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3416}";BASE="http://127.0.0.1:$PORT";TMP="$(mktemp -d)"
ADMIN="$TMP/admin";VIEWER="$TMP/viewer"
cleanup(){ kill "${PID:-}" 2>/dev/null||true;wait "${PID:-}" 2>/dev/null||true;rm -rf "$TMP";};trap cleanup EXIT

bun run build
DATA_DIR="$TMP/data" PORT="$PORT" ADMIN_PASSWORD=admin123 ./dist/inventra >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..30};do curl -sf "$BASE/healthz" >/dev/null&&break;sleep .1;done
login(){ curl -sS -c "$2" -d "username=$1&password=$3" -X POST "$BASE/login" >/dev/null;}
csrf(){ curl -sS -b "$1" "$BASE/profile"|sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p'|head -1;}
post(){ curl -sS -b "$1" -c "$1" -o /dev/null -w "%{http_code}" -X POST "$BASE$2" -d "_csrf=$(csrf "$1")&$3";}
search(){ curl -sS -b "$1" --get --data-urlencode "q=$2" "$BASE/search"; }

login admin "$ADMIN" admin123
[ "$(post "$ADMIN" /users 'name=Search+Viewer&username=findmeuser&email=findme%40example.com&role=viewer&password=password123')" = 303 ]
[ "$(post "$ADMIN" /assets 'asset_tag=GLOB-001&name=Common+Notebook&serial=SER-SEARCH&status=deployable')" = 303 ]
[ "$(post "$ADMIN" /licenses 'name=Searchable+License&product_key=KEY-SEARCH&seats=1')" = 303 ]
[ "$(post "$ADMIN" /consumables 'name=Searchable+Toner&qty=2&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /accessories 'name=Common+Keyboard&qty=2&min_qty=0')" = 303 ]
[ "$(post "$ADMIN" /components 'name=Searchable+SSD&qty=2&min_qty=0&serial=COMP-SEARCH')" = 303 ]

search "$ADMIN" GLOB-001|grep -q 'GLOB-001'
echo "search_assets=ok"
search "$ADMIN" 'Searchable License'|grep -q 'Searchable License'
echo "search_licenses=ok"
search "$ADMIN" findmeuser|grep -q 'Search Viewer (findmeuser)'
echo "search_users=ok"
search "$ADMIN" 'Common Keyboard'|grep -q 'Common Keyboard'
echo "search_accessories=ok"
PAGE="$(search "$ADMIN" Common)";grep -q '<h2>Assets</h2>' <<<"$PAGE";grep -q '<h2>Accessories</h2>' <<<"$PAGE"
echo "search_multi_entity=ok"
curl -sS -b "$ADMIN" "$BASE/search"|grep -q 'Enter a search term'
echo "search_empty_q=ok"
search "$ADMIN" zzznomatch|grep -q 'No results found'
echo "search_no_results=ok"
PAGE="$(search "$ADMIN" '<script>alert(1)</script>')";grep -q '&lt;script&gt;alert(1)&lt;/script&gt;' <<<"$PAGE";! grep -q '<script>alert(1)</script>' <<<"$PAGE"
echo "search_html_escaped=ok"
login findmeuser "$VIEWER" password123
[ "$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" "$BASE/search?q=Common")" = 200 ]
echo "search_viewer_allowed=ok"
[ "$(curl -sS -b "$VIEWER" -o /dev/null -w "%{http_code}" --get --data-urlencode "q=O'Reilly" "$BASE/search")" = 200 ]
echo "search_sql_safe=ok"
echo "stage16_smoke=passed"

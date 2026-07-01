#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE_DIR"

ok(){ echo "$1=ok"; }
fail(){ echo "$1=fail"; exit 1; }
free_port(){ python3 - <<'PY'
import socket
s=socket.socket()
s.bind(("127.0.0.1",0))
print(s.getsockname()[1])
s.close()
PY
}
wait_http(){
  local url="$1"
  for _ in {1..80}; do
    if curl -fsS "$url" >/tmp/inventra_health.$$ 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}

bun run build >/tmp/inventra_stage22_build.log
test -x dist/inventra || fail build_script_works
ok build_script_works

PORT="$(free_port)"
DATA_DIR="$(mktemp -d)" PORT="$PORT" HOST=127.0.0.1 APP_VERSION=v1.0.0 ./dist/inventra >/tmp/inventra_stage22_server.log 2>&1 &
PID=$!
trap 'kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true; rm -f /tmp/inventra_health.$$' EXIT
wait_http "http://127.0.0.1:$PORT/healthz" || { cat /tmp/inventra_stage22_server.log; fail healthz_ok; }
grep -qx "ok" /tmp/inventra_health.$$ || fail healthz_ok
ok healthz_ok
rg -q 'db\.query\("SELECT 1"\)\.get\(\)' src/server.ts || fail healthz_db_check
ok healthz_db_check

PORT2="$(free_port)"
DATA_DIR="$(mktemp -d)" PORT="$PORT2" HOST=127.0.0.1 ./dist/inventra >/tmp/inventra_stage22_port.log 2>&1 &
PID2=$!
wait_http "http://127.0.0.1:$PORT2/healthz" || { cat /tmp/inventra_stage22_port.log; fail env_port_respected; }
kill "$PID2" >/dev/null 2>&1 || true
wait "$PID2" 2>/dev/null || true
ok env_port_respected

PORT3="$(free_port)"
DATA_DIR="$(mktemp -d)" PORT="$PORT3" HOST=127.0.0.1 SESSION_DAYS=1 ./dist/inventra >/tmp/inventra_stage22_session.log 2>&1 &
PID3=$!
wait_http "http://127.0.0.1:$PORT3/healthz" || { cat /tmp/inventra_stage22_session.log; fail env_session_days; }
curl -fsS -D /tmp/inventra_stage22_headers.txt -c /tmp/inventra_stage22_cookies.txt -d "username=admin&password=admin123" "http://127.0.0.1:$PORT3/login" >/dev/null || fail env_session_days
grep -q "Max-Age=86400" /tmp/inventra_stage22_headers.txt || fail env_session_days
kill "$PID3" >/dev/null 2>&1 || true
wait "$PID3" 2>/dev/null || true
ok env_session_days

curl -fsS -c /tmp/inventra_stage22_cookies_v.txt -d "username=admin&password=admin123" "http://127.0.0.1:$PORT/login" >/dev/null || fail app_version_in_footer
curl -fsS -b /tmp/inventra_stage22_cookies_v.txt "http://127.0.0.1:$PORT/" | grep -q "v1.0.0" || fail app_version_in_footer
ok app_version_in_footer

test -s THIRD_PARTY_LICENSES.txt && grep -q "qrcode" THIRD_PARTY_LICENSES.txt && grep -q "This binary embeds the Bun runtime" THIRD_PARTY_LICENSES.txt || fail third_party_licenses_exists
ok third_party_licenses_exists
grep -q '^dist/$' .gitignore || fail gitignore_has_dist
ok gitignore_has_dist

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker build . >/tmp/inventra_stage22_docker_build.log
  ok dockerfile_builds
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d >/tmp/inventra_stage22_compose.log
    for _ in {1..80}; do
      status="$(docker compose ps --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)"
      [[ "$status" == *healthy* ]] && break
      sleep 1
    done
    docker compose ps | grep -qi healthy || { docker compose logs --no-color; docker compose down -v; fail docker_compose_up; }
    docker compose down -v >/tmp/inventra_stage22_compose_down.log
    ok docker_compose_up
  else
    echo "docker_compose_up=skipped"
  fi
else
  echo "dockerfile_builds=skipped"
  echo "docker_compose_up=skipped"
fi

echo "stage22_smoke=passed"

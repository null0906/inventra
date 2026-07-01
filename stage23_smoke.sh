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
sql_get(){
  SQL="$1" ARGS="${2:-[]}" DATA_DIR="$DATA_DIR" bun -e 'import {db} from "./src/db.ts"; const args=JSON.parse(process.env.ARGS||"[]"); const r=db.query(process.env.SQL!).get(...args); console.log(JSON.stringify(r??null));' 2>/dev/null
}
sql_all(){
  SQL="$1" ARGS="${2:-[]}" DATA_DIR="$DATA_DIR" bun -e 'import {db} from "./src/db.ts"; const args=JSON.parse(process.env.ARGS||"[]"); const r=db.query(process.env.SQL!).all(...args); console.log(JSON.stringify(r));' 2>/dev/null
}
sql_run(){
  SQL="$1" ARGS="${2:-[]}" DATA_DIR="$DATA_DIR" bun -e 'import {db} from "./src/db.ts"; const args=JSON.parse(process.env.ARGS||"[]"); db.run(process.env.SQL!,args);' 2>/dev/null
}
csrf(){
  curl -fsS -b "$COOKIES" "$BASE$1" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | cut -d'"' -f4
}
wait_http(){
  for _ in {1..80}; do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && return 0; sleep .2; done
  return 1
}

export DATA_DIR="$(mktemp -d)"
PORT="$(free_port)"
BASE="http://127.0.0.1:$PORT"
COOKIES="$(mktemp)"
PORT="$PORT" HOST=127.0.0.1 DATA_DIR="$DATA_DIR" BASE_URL="$BASE" ./dist/inventra >/tmp/inventra_stage23.log 2>&1 &
PID=$!
trap 'kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true' EXIT
wait_http || { cat /tmp/inventra_stage23.log; fail server_start; }

sql_get "SELECT name FROM sqlite_master WHERE type='table' AND name='ack_tokens'" | grep -q ack_tokens || fail schema_ack_tokens
ok schema_ack_tokens

sql_run "INSERT INTO settings(key,value) VALUES('smtp_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'"
sql_run "INSERT INTO settings(key,value) VALUES('base_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value" "[\"$BASE\"]"
sql_run "INSERT INTO settings(key,value) VALUES('ack_reminder_days','7') ON CONFLICT(key) DO UPDATE SET value='7'"
sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('Ack User','ackuser','ack@example.com','x','viewer')"
sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('No Email','noemail',NULL,'x','viewer')"
sql_run "INSERT INTO assets(asset_tag,name,status) VALUES('ACK-001','Ack Laptop','deployable')"

curl -fsS -c "$COOKIES" -b "$COOKIES" -d "username=admin&password=admin123" "$BASE/login" >/dev/null

CSRF="$(csrf /admin/acknowledgements/new)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/admin/acknowledgements" \
  -d "_csrf=$CSRF&target_user_id=2&action_type=manual&subject=Manual+Ack&message=Please+confirm" >/dev/null
TOKEN="$(sql_get "SELECT token FROM ack_tokens WHERE subject='Manual Ack'" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
[[ "$TOKEN" =~ ^[0-9a-f]{64}$ ]] || fail token_gen_64_chars
ok token_gen_64_chars
curl -fsS "$BASE/ack/$TOKEN" | grep -q "Manual Ack" || fail ack_page_renders
ok ack_page_renders
curl -fsS -X POST "$BASE/ack/$TOKEN" | grep -q "acknowledgement recorded" || fail ack_submit_records
sql_get "SELECT status,acknowledged_at FROM ack_tokens WHERE token=?" "[\"$TOKEN\"]" | grep -q acknowledged || fail ack_submit_records
sql_get "SELECT action FROM activity WHERE action='acknowledge' ORDER BY id DESC LIMIT 1" | grep -q acknowledge || fail ack_submit_records
ok ack_submit_records
curl -fsS -X POST "$BASE/ack/$TOKEN" | grep -q "already been used or has expired" || fail ack_double_submit_rejected
ok ack_double_submit_rejected

sql_run "INSERT INTO ack_tokens(token,user_id,action_type,subject,message,created_by,expires_at) VALUES('expiredtoken',2,'manual','Expired','Expired msg',1,datetime('now','-1 day'))"
curl -fsS "$BASE/ack/expiredtoken" | grep -q "expired" || fail ack_expired_token_rejected
ok ack_expired_token_rejected

BEFORE="$(sql_get "SELECT COUNT(*) n FROM ack_tokens" | python3 -c 'import sys,json; print(json.load(sys.stdin)["n"])')"
CSRF="$(csrf /assets/1)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/assets/1/checkout" \
  -d "_csrf=$CSRF&checkout_to=user&user_id=2&send_ack=1&note=ack" >/dev/null
AFTER="$(sql_get "SELECT COUNT(*) n FROM ack_tokens" | python3 -c 'import sys,json; print(json.load(sys.stdin)["n"])')"
[[ "$AFTER" -gt "$BEFORE" ]] || fail asset_checkout_send_ack
sql_get "SELECT COUNT(*) n FROM email_queue WHERE subject='Asset receipt acknowledgement'" | grep -q '"n":[1-9]' || fail asset_checkout_send_ack
ok asset_checkout_send_ack

sql_run "INSERT INTO assets(asset_tag,name,status) VALUES('ACK-002','No Ack Laptop','deployable')"
BEFORE="$(sql_get "SELECT COUNT(*) n FROM ack_tokens" | python3 -c 'import sys,json; print(json.load(sys.stdin)["n"])')"
CSRF="$(csrf /assets/2)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/assets/2/checkout" \
  -d "_csrf=$CSRF&checkout_to=user&user_id=2&note=noack" >/dev/null
AFTER="$(sql_get "SELECT COUNT(*) n FROM ack_tokens" | python3 -c 'import sys,json; print(json.load(sys.stdin)["n"])')"
[[ "$AFTER" == "$BEFORE" ]] || fail asset_checkout_no_ack
ok asset_checkout_no_ack

CSRF="$(csrf /users/2/edit)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/users/2/offboard" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT COUNT(*) n FROM ack_tokens WHERE action_type='offboard' AND user_id=2" | grep -q '"n":[1-9]' || fail offboard_auto_ack
ok offboard_auto_ack

CSRF="$(csrf /users/3/edit)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/users/3/offboard" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT COUNT(*) n FROM ack_tokens WHERE action_type='offboard' AND user_id=3" | grep -q '"n":0' || fail offboard_no_email_no_crash
ok offboard_no_email_no_crash

curl -fsS -b "$COOKIES" "$BASE/admin/acknowledgements" | grep -q "Asset receipt acknowledgement" || fail admin_ack_page_shows_tokens
ok admin_ack_page_shows_tokens
sql_get "SELECT COUNT(*) n FROM ack_tokens WHERE action_type='manual'" | grep -q '"n":[1-9]' || fail admin_create_manual_ack
ok admin_create_manual_ack

sql_run "INSERT INTO users(name,username,email,password_hash,role) VALUES('Reminder User','reminder','reminder@example.com','x','viewer')"
sql_run "INSERT INTO ack_tokens(token,user_id,action_type,subject,message,created_by,created_at,expires_at) VALUES('remindertoken',4,'policy','Reminder Ack','Reminder msg',1,datetime('now','-8 days'),datetime('now','+8 days'))"
CSRF="$(csrf /admin/email)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/notifications/check" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT reminder_sent_at FROM ack_tokens WHERE token='remindertoken'" | grep -q "20" || fail escalation_reminder_queued
sql_get "SELECT COUNT(*) n FROM email_queue WHERE subject='Reminder: Reminder Ack'" | grep -q '"n":[1-9]' || fail escalation_reminder_queued
ok escalation_reminder_queued

sql_run "INSERT INTO ack_tokens(token,user_id,action_type,subject,message,created_by,expires_at) VALUES('sweeptoken',4,'policy','Sweep Ack','Sweep msg',1,datetime('now','-1 day'))"
CSRF="$(csrf /admin/email)"
curl -fsS -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/notifications/check" -d "_csrf=$CSRF" >/dev/null
sql_get "SELECT status FROM ack_tokens WHERE token='sweeptoken'" | grep -q expired || fail expiry_sweep_marks_expired
ok expiry_sweep_marks_expired

code=200
for _ in {1..11}; do code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ack/ratelimit-token")"; done
[[ "$code" == "429" ]] || fail rate_limit_ack_endpoint
ok rate_limit_ack_endpoint

echo "stage23_smoke=passed"

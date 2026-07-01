#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR" "$DATA_DIR/attachments"
chown -R inventra:root "$DATA_DIR"

exec gosu inventra "$@"


# Inventra

Self-hosted IT asset management. Original code (no third-party app code reused) — you own it fully and can deploy it closed-source, rebrand it, and sell it.

## Features

Assets with models, categories, manufacturers, suppliers and locations; checkout/checkin to users with full history; software licenses with seat assignment (to users or assets) and expiry warnings; consumables with stock levels and low-stock alerts; role-based users (admin / manager / viewer); full activity audit log; CSV report exports; printable QR labels; dashboard.

## Run in development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev          # http://localhost:9000
```

Default login: `admin` / `admin123` (or set `ADMIN_PASSWORD` before first run). **Change it immediately** via Users → Edit.

## Build for deployment (no source shipped)

```sh
bun run build        # produces dist/inventra, a single self-contained binary
```

Cross-compile for the client's platform:

```sh
bun build src/server.ts --compile --minify --bytecode --target=bun-linux-x64   --outfile dist/inventra-linux-x64
bun build src/server.ts --compile --minify --bytecode --target=bun-linux-arm64 --outfile dist/inventra-linux-arm64
bun build src/server.ts --compile --minify --bytecode --target=bun-windows-x64 --outfile dist/inventra.exe
bun build src/server.ts --compile --minify --bytecode --target=bun-darwin-arm64 --outfile dist/inventra-macos
```

The binary embeds the Bun runtime and minified bytecode — clients receive an executable, not source. Ship `THIRD_PARTY_LICENSES.txt` alongside it (MIT attribution requirement for the QR library).

Run on the client's server:

```sh
DATA_DIR=/var/lib/inventra PORT=9000 ./inventra
```

Or with Docker: `docker build -t inventra . && docker run -p 9000:9000 -v inventra-data:/data inventra`

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where the SQLite database lives (back this up) |
| `APP_NAME` | `Inventra` | Branding shown in the UI — rebrand per client |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password (first run only) |
| `BASE_URL` | — | If set, QR codes encode `BASE_URL/assets/<id>` instead of the asset tag |

## Production notes

Put it behind a reverse proxy (Caddy/nginx) for HTTPS. Data is a single SQLite file in `DATA_DIR` — back it up with any file backup. Roles: **viewer** (read-only), **manager** (manage inventory, checkout/checkin), **admin** (everything incl. users).

## Roadmap ideas

Accessories/components, asset maintenance schedules, depreciation reports, email notifications, LDAP/SSO login, file attachments, custom fields, API tokens.

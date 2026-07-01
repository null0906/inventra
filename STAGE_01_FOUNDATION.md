# STAGE 1 — Complete the Foundation (prompt for Codex, copy of brief attached)

You have PROJECT_BRIEF.md and PROMPT_CODEX_CODER.md. The v1 codebase already runs (assets, catalog, licenses, consumables, users/RBAC, audit log, CSV, QR labels, dashboard). Stage 1 turns that v1 into a complete *foundation* on which every later Snipe-IT-class feature (maintenance, depreciation, API, notifications, custom fields) will sit. Do not build those later features yet — build the base they all assume.

## Part A — Security hardening (do this first)

1. **CSRF protection.** Add a per-session CSRF token: embed as a hidden `_csrf` input in every form (add a helper in `web.ts` so forms can't forget it), verify on every POST in the router before dispatch, reject with 403 on mismatch. The `/login` POST is exempt (no session yet) but must be rate-limited instead.
2. **Login rate limiting.** In-memory throttle: after 5 failed attempts per username or IP within 15 minutes, reject login attempts for that key with a generic message. Reset on success. No dependency — a Map with timestamps is fine.
3. **Self-service account page.** `GET/POST /profile`: any logged-in user can change their own password (must enter current password) and see their own details. Never allow role or username changes here.
4. **Session hardening.** Add a `Secure` cookie attribute when the request came over HTTPS (check `x-forwarded-proto`), and regenerate the session token on login.

## Part B — Complete the core inventory model

Snipe-IT's foundation has six trackable thing-types. We have four (assets, licenses, consumables, plus catalog). Add the missing two:

5. **Accessories** (keyboards, mice, docks — stocked items checked out to people and returned):
   - Table: `accessories(id, name, category_id, manufacturer_id, supplier_id, location_id, qty, min_qty, cost, notes)`.
   - Checkout to a user decrements available count (`accessory_checkouts(id, accessory_id, user_id, at, note)`); checkin deletes the row. Available = qty − active checkouts; block checkout at 0.
   - List page with available/total + low badge, detail page showing who has one, checkout/checkin (manager+), CRUD, CSV report, audit-logged.
6. **Components** (RAM, SSDs — parts installed *into assets*):
   - Tables: `components(id, name, category_id, qty, min_qty, location_id, cost, serial, notes)` and `component_assets(id, component_id, asset_id, qty, at)`.
   - Install N units into an asset / remove them back to stock; available = qty − installed. Show installed components on the asset detail page. CRUD, CSV, audit-logged.
7. **Category types**: extend the category `ctype` options to include `accessory` and `component` and use them in the relevant dropdowns.

## Part C — Foundation plumbing later stages depend on

8. **Settings table + admin settings page.** `settings(key TEXT PRIMARY KEY, value TEXT)` with a `getSetting(key, fallback)` helper. Admin page `GET/POST /settings` managing at minimum: `app_name` (falls back to env `APP_NAME`), `base_url`, `asset_tag_prefix`, `items_per_page`. `layout()` and QR generation must read from settings first. This kills per-client env juggling and is where every future option will live.
9. **Auto asset tags.** On the new-asset form, prefill `asset_tag` with the next free `<asset_tag_prefix><zero-padded number>`; user may override.
10. **"My items" page.** `GET /my` for every role: assets, accessories, and license seats assigned to the logged-in user. Link it in the nav.
11. **Pagination.** The assets list currently caps at 500 with no paging. Add simple `?page=` pagination (page size from settings) to assets and activity lists, preserving search/filter params.

## Rules reminders (will be audited)

- Schema: additive + idempotent only — old client DBs must upgrade in place silently.
- Every new mutation: POST + role check + `logActivity()` + `esc()` + parameterized SQL + CSRF token.
- No new dependencies. Nothing may break `bun build src/server.ts --compile --minify --bytecode`.
- Follow existing patterns: route table in `server.ts`, one module per domain (`src/accessories.ts`, `src/components.ts`, `src/settings.ts`), flash messages via redirect `?m=`.

## Definition of done / handoff report

Deliver a handoff containing: files changed; full list of new tables/columns; new routes with required role; CSRF approach summary; smoke-test transcript (curl: login → CSRF-protected create → accessory checkout to user at qty limit → component install/remove on an asset → settings change reflected in layout → /my page → pagination page 2 → viewer blocked from a manager POST → 6th failed login rejected); and successful `bun run build` output. The auditor (Claude) will reject the stage if any item is missing.

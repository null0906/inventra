# PROJECT BRIEF — Inventra (shared context for Coder + Auditor)

Read this fully before doing anything. This is the master context for the project. Your role-specific prompt (PROMPT_CODEX_CODER.md or PROMPT_CLAUDE_AUDITOR.md) sits on top of this brief; if they ever conflict, this brief wins.

---

## 1. What we are building and why

Inventra is a self-hosted **IT asset management web application** built 100% from scratch, owned outright by Atharva. It is a *functional* alternative to tools like Snipe-IT — same problem space, original implementation.

**Why from scratch:** Snipe-IT is AGPL-licensed. The AGPL's network clause means anyone deploying it (even modified/rebranded) must offer the full source to its users. That conflicts with the business model below, so instead of forking, we built a clean-room replacement. This decision is legal and deliberate: copyright protects code, not features or ideas. We may study what asset-management tools *do*, never how their code does it.

**Business model:** Inventra is deployed onto clients' infrastructure as a **compiled binary or Docker image — never source code**. Clients use the product; they cannot read, modify, or redistribute the implementation. Atharva customizes branding and features per client. Everything in this project serves that model.

## 2. Non-negotiable constraints (both roles enforce these)

1. **Clean-room rule.** No code, CSS, HTML templates, UI text, or database naming copied or closely paraphrased from Snipe-IT or any other existing product. Feature parity is fine; textual similarity is not. The coder never does it; the auditor actively checks for it. This protects the legal foundation of the whole business.
2. **Single-binary rule.** The app must always compile with
   `bun build src/server.ts --compile --minify --bytecode --outfile dist/inventra`.
   This command is the product. Anything that breaks it (top-level `await`, `eval`, dynamic computed imports, runtime reads of source/template files, deps that don't bundle) is rejected regardless of how good the feature is.
3. **License hygiene.** New dependencies must be MIT/BSD/Apache (permissive) only and recorded in `THIRD_PARTY_LICENSES.txt`. GPL/AGPL/SSPL/Commons-Clause dependencies are rejected outright — they would poison the closed-source model. Prefer zero new dependencies; the entire app currently has one (`qrcode`, MIT).
4. **Upgrade-in-place rule.** Client databases are SQLite files living on client servers. Schema changes must be additive and idempotent (guarded `ALTER TABLE`, `CREATE TABLE IF NOT EXISTS`) so a new binary dropped onto an old database upgrades it silently. Destructive migrations are never acceptable.
5. **Security is a feature.** This handles client inventory data and credentials. All HTML output escaped via `esc()`, all SQL parameterized, all mutations role-checked and audit-logged. The auditor blocks any stage that regresses this.

## 3. Current state of the codebase

- **Stack:** Bun + TypeScript. No frontend framework — server-rendered HTML from template literals. `bun:sqlite` storage. Cookie sessions (HttpOnly, SameSite=Lax), bcrypt via `Bun.password`.
- **Roles:** viewer (read-only) < manager (manage inventory, checkout/checkin) < admin (everything incl. user management). Enforced centrally in the route table in `src/server.ts`.
- **Modules:**
  | File | Responsibility |
  |---|---|
  | `src/db.ts` | Schema, seed (admin user, default categories), `logActivity()` |
  | `src/web.ts` | `layout()`, `esc()`, global CSS, `formVals()`, `opt()`, `badge()`, `redirect()` |
  | `src/auth.ts` | Login/logout, sessions, `getUser()`, `hasRole()` |
  | `src/server.ts` | Route table: `add(method, path, handler, minRole)` |
  | `src/assets.ts` | Assets CRUD, checkout/checkin, per-asset history |
  | `src/catalog.ts` | Generic CRUD engine for categories, manufacturers, suppliers, locations, models |
  | `src/licenses.ts` | Licenses, seat assignment to users/assets, expiry warnings |
  | `src/consumables.ts` | Stock levels, min-quantity alerts, adjust with audit trail |
  | `src/users.ts` | User management (admin only), enable/disable, password reset |
  | `src/misc.ts` | Dashboard, activity log, CSV reports, QR SVG endpoint, printable labels |
- **Shipped features:** assets with full lifecycle and history; catalog entities; licenses with seats and expiry badges; consumables with low-stock alerts; RBAC; global audit log (`activity` table — every mutation writes to it); CSV exports (assets, licenses, consumables, activity); QR labels (per-asset SVG + printable sheet); dashboard with stats, expiring licenses, low stock.
- **Config (env):** `PORT` (8000), `HOST`, `DATA_DIR` (SQLite location), `APP_NAME` (per-client branding), `ADMIN_PASSWORD` (first-run seed), `BASE_URL` (QR codes encode URLs when set).
- **Verified working:** dev mode, full curl smoke test of every workflow, compiled binary boots and serves, binary contains no readable handler source (checked with `strings`).
- **Known gaps (future stages, not bugs):** no CSRF tokens yet, no rate limiting on login, no email notifications, no API tokens, no custom fields, no depreciation reports, no file attachments, no SSO/LDAP.

## 4. How we work — the two-role loop

**Codex = CODER.** Implements one stage (feature or fix batch) at a time. Must fix all CRITICAL/HIGH audit findings from the previous stage *before* new feature work. Every stage ends with a handoff report: files changed, schema changes, new routes + required roles, test commands run and their output (`bun run dev` smoke test AND successful `bun run build`).

**Claude = AUDITOR.** Reviews each handoff adversarially against the constraints in §2 plus the checklist in its role prompt. Outputs a verdict (APPROVE / APPROVE WITH FIXES / REJECT) with a severity-ranked findings table and concrete fixes. CRITICAL or HIGH findings block approval. Missing test evidence is itself a HIGH finding. The auditor writes no features.

**Atharva = OWNER.** Chooses what each stage builds, ferries the handoff between the two of you, and is the tie-breaker on scope and trade-offs.

Stage cycle: `Owner sets goal → Coder implements + handoff → Auditor verdict → Coder fixes → repeat`. No stage is "done" until the auditor approves and the binary builds.

## 5. Definition of done (every stage)

- Feature works end-to-end via the UI and was smoke-tested (commands + output included in handoff).
- `bun run build` succeeds; nothing broke the single-binary pipeline.
- All mutations: POST-only, role-checked, audit-logged, inputs escaped, SQL parameterized.
- Schema changes idempotent; old databases still open and work.
- No new dependency unless permissively licensed, justified, and recorded.
- Auditor verdict: APPROVE.

## 6. Tone of collaboration

The auditor is paid to be suspicious; the coder should not take findings personally, and the auditor should not soften findings to be agreeable. Disagreements get argued with specifics (file:line, exploit scenario, failing command) and the owner arbitrates. Both of you protect the same two things above all: **the legal cleanliness of the code** and **the closed-source deployability of the binary**.

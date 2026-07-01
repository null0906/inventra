import { checkApiRate, createProfileToken, doLogin, doLogout, forbidden, getUser, getUserFromBearer, hasRole, loginPage, profilePage, profileUpdate, revokeProfileToken, verifyCsrf, type User } from "./auth";
import { hasPermission } from "./roles";
import { esc, layout, redirect } from "./web";
import * as A from "./assets";
import * as C from "./catalog";
import * as L from "./licenses";
import * as K from "./consumables";
import * as U from "./users";
import * as M from "./misc";
import * as X from "./accessories";
import * as P from "./components";
import * as S from "./settings";
import * as D from "./depreciation";
import * as N from "./maintenance";
import * as E from "./email";
import * as API from "./api";
import * as CF from "./custom_fields";
import * as DEPT from "./departments";
import * as AT from "./attachments";
import * as AU from "./audit";
import { db } from "./db";
import * as ACK from "./ack";
import * as SL from "./status_labels";
import * as RL from "./roles";

type Ctx = { req: Request; url: URL; params: Record<string, string>; user: User };
type Handler = (c: Ctx) => Response | Promise<Response>;
type Route = { m: string; re: RegExp; keys: string[]; h: Handler; role: string };

const routes: Route[] = [];
const trustProxy = process.env.TRUST_PROXY === "1";
const ackLimits = new Map<string, { n: number; reset: number }>();
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="url(#g)"/>
<path d="M17 19.5 32 11l15 8.5v17L32 45l-15-8.5z" fill="#eef2ff" opacity=".22"/>
<path d="M17 19.5 32 28l15-8.5M32 28v17" fill="none" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M25 20h14M32 20v24M25 44h14" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
<circle cx="48" cy="47" r="8" fill="#22c55e" stroke="#fff" stroke-width="4"/>
</svg>`;

function add(m: string, path: string, h: Handler, role = "viewer") {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      path
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\$\\\{[^}]*\\\}/g, "") // safety, unused
        .replace(/:([a-zA-Z]+)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        }) +
      "$"
  );
  routes.push({ m, re, keys, h, role });
}

// Dashboard / misc
add("GET", "/", (c) => M.dashboard(c.user, c.url));
add("GET", "/search", (c) => M.globalSearch(c.user, c.url));
add("GET", "/activity", (c) => M.activityPage(c.user, c.url), "manager");
add("GET", "/reports", (c) => M.reportsPage(c.user), "reports.view");
add("GET", "/reports/lifecycle", (c) => M.lifecycleReport(c.user, c.url), "reports.view");
add("GET", "/reports/:name.csv", (c) => M.reportCsv(c.params.name) || notFound(c.user), "reports.view");
add("GET", "/reports/depreciation", () => D.csvReport(), "reports.view");
add("GET", "/qr/:id.svg", (c) => M.qrSvg(c.params.id));
add("GET", "/labels", (c) => M.labelsPage(c.user, c.url));
add("GET", "/my", (c) => M.myItems(c.user));
add("GET", "/profile", (c) => profilePage(c.user, c.url));
add("POST", "/profile", (c) => profileUpdate(c.user, c.req));
add("POST", "/profile/tokens", (c) => createProfileToken(c.user, c.req));
add("POST", "/profile/tokens/:id/revoke", (c) => revokeProfileToken(c.user, c.params.id));
add("GET", "/settings", (c) => S.settingsPage(c.user, c.url), "admin");
add("POST", "/settings", (c) => S.settingsUpdate(c.user, c.req), "admin");
add("GET", "/admin/email", (c) => E.adminPage(c.user, c.url), "admin");
add("POST", "/admin/email/flush", (c) => E.adminFlush(c.user), "admin");
add("POST", "/admin/email/test", (c) => E.adminTest(c.user), "admin");
add("POST", "/admin/email/clear", (c) => E.adminClear(c.user), "admin");
add("POST", "/notifications/check", (c) => E.notificationCheck(c.user), "admin");
add("POST", "/notifications/digest", (c) => E.digestSend(c.user, c.url), "admin");
add("GET", "/admin/acknowledgements", (c) => ACK.acksAdminPage(c.user, c.url), "admin");
add("GET", "/admin/acknowledgements/new", (c) => ACK.ackNewPage(c.user), "admin");
add("POST", "/admin/acknowledgements", (c) => ACK.ackCreate(c.user, c.req), "admin");
add("GET", "/admin/roles", (c) => RL.roleList(c.user, c.url), "admin");
add("GET", "/admin/roles/new", (c) => RL.roleNewPage(c.user), "admin");
add("POST", "/admin/roles", (c) => RL.roleCreate(c.user, c.req), "admin");
add("GET", "/admin/roles/:id/edit", (c) => RL.roleEditPage(c.user, c.params.id), "admin");
add("POST", "/admin/roles/:id/edit", (c) => RL.roleUpdate(c.user, c.params.id, c.req), "admin");
add("POST", "/admin/roles/:id/delete", (c) => RL.roleDelete(c.user, c.params.id), "admin");
add("GET","/departments",(c)=>DEPT.list(c.user,c.url),"admin");
add("GET","/departments/new",(c)=>DEPT.newPage(c.user),"admin");
add("POST","/departments",(c)=>DEPT.create(c.user,c.req),"admin");
add("GET","/departments/:id/edit",(c)=>DEPT.editPage(c.user,c.params.id),"admin");
add("POST","/departments/:id/edit",(c)=>DEPT.update(c.user,c.params.id,c.req),"admin");
add("POST","/departments/:id/delete",(c)=>DEPT.remove(c.user,c.params.id),"admin");
add("GET", "/custom-fields", (c) => CF.list(c.user, c.url), "admin");
add("GET", "/custom-fields/new", (c) => CF.newPage(c.user), "admin");
add("POST", "/custom-fields", (c) => CF.create(c.user, c.req), "admin");
add("GET", "/custom-fields/:id/edit", (c) => CF.editPage(c.user, c.params.id), "admin");
add("POST", "/custom-fields/:id/edit", (c) => CF.update(c.user, c.params.id, c.req), "admin");
add("POST", "/custom-fields/:id/delete", (c) => CF.remove(c.user, c.params.id), "admin");
add("GET", "/status-labels", (c) => SL.list(c.user, c.url), "admin");
add("GET", "/status-labels/new", (c) => SL.newPage(c.user), "admin");
add("POST", "/status-labels", (c) => SL.create(c.user, c.req), "admin");
add("GET", "/status-labels/:id/edit", (c) => SL.editPage(c.user, c.params.id), "admin");
add("POST", "/status-labels/:id/edit", (c) => SL.update(c.user, c.params.id, c.req), "admin");
add("POST", "/status-labels/:id/delete", (c) => SL.remove(c.user, c.params.id), "admin");
add("POST", "/models/:id/fields", (c) => CF.saveModelFields(c.user, c.params.id, c.req), "catalog.manage");
add("GET", "/audits", (c) => AU.auditList(c.user, c.url, hasPermission(c.user, "audits.manage")), "audits.view");
add("GET", "/audits/new", (c) => AU.auditNewPage(c.user), "audits.manage");
add("POST", "/audits", (c) => AU.auditCreate(c.user, c.req), "audits.manage");
add("GET", "/audits/:id", (c) => AU.auditDetail(c.user, c.params.id, c.url, hasPermission(c.user, "audits.manage")), "audits.view");
add("POST", "/audits/:id/items", (c) => AU.auditAddAsset(c.user, c.params.id, c.req), "audits.manage");
add("POST", "/audits/:id/items/:itemId/verify", (c) => AU.auditVerify(c.user, c.params.id, c.params.itemId, c.req), "audits.manage");
add("POST", "/audits/:id/close", (c) => AU.auditClose(c.user, c.params.id), "audits.manage");

// API v1
add("GET","/api/v1/me",(c)=>API.me(c.user));
add("GET","/api/v1/assets",(c)=>API.assets(c.url),"assets.view");
add("GET","/api/v1/assets/:id",(c)=>API.asset(c.params.id),"assets.view");
add("POST","/api/v1/assets",(c)=>API.assetCreate(c.user,c.req),"assets.manage");
add("PATCH","/api/v1/assets/:id",(c)=>API.assetPatch(c.user,c.params.id,c.req),"assets.manage");
add("DELETE","/api/v1/assets/:id",(c)=>API.assetDelete(c.user,c.params.id),"assets.delete");
add("POST","/api/v1/assets/:id/checkout",(c)=>API.checkout(c.user,c.params.id,c.req),"assets.checkout");
add("POST","/api/v1/assets/:id/checkin",(c)=>API.checkin(c.user,c.params.id),"assets.checkout");
add("GET","/api/v1/licenses",(c)=>API.licenses(c.url),"licenses.view");
add("GET","/api/v1/licenses/:id",(c)=>API.license(c.params.id),"licenses.view");
add("GET","/api/v1/consumables",(c)=>API.consumables(c.url),"consumables.view");
add("POST","/api/v1/consumables",(c)=>API.consumableCreate(c.user,c.req),"consumables.manage");
add("PATCH","/api/v1/consumables/:id",(c)=>API.consumablePatch(c.user,c.params.id,c.req),"consumables.manage");
add("DELETE","/api/v1/consumables/:id",(c)=>API.consumableDelete(c.user,c.params.id),"consumables.manage");
add("GET","/api/v1/maintenance",(c)=>API.maintenance(c.url),"maintenance.view");
add("POST","/api/v1/maintenance",(c)=>API.maintenanceCreate(c.user,c.req),"maintenance.manage");
add("POST","/api/v1/maintenance/:id/complete",(c)=>API.maintenanceComplete(c.user,c.params.id),"maintenance.manage");
add("PATCH","/api/v1/maintenance/:id",(c)=>API.maintenancePatch(c.user,c.params.id,c.req),"maintenance.manage");
add("GET","/api/v1/depreciation",()=>API.depreciation());
add("GET","/api/v1/accessories",(c)=>API.accessories(c.url),"accessories.view");
add("GET","/api/v1/accessories/:id",(c)=>API.accessory(c.params.id),"accessories.view");
add("POST","/api/v1/accessories",(c)=>API.accessoryCreate(c.user,c.req),"accessories.manage");
add("PATCH","/api/v1/accessories/:id",(c)=>API.accessoryPatch(c.user,c.params.id,c.req),"accessories.manage");
add("DELETE","/api/v1/accessories/:id",(c)=>API.accessoryDelete(c.user,c.params.id),"accessories.manage");
add("GET","/api/v1/components",(c)=>API.components(c.url),"components.view");
add("GET","/api/v1/components/:id",(c)=>API.component(c.params.id),"components.view");
add("GET","/api/v1/locations",()=>API.locations(),"catalog.view");
add("GET","/api/v1/departments",()=>API.departments(),"catalog.view");
add("GET","/api/v1/users",()=>API.users(),"users.view");
add("GET","/api/v1/audit-sessions",()=>API.auditSessions(),"audits.view");
add("GET", "/depreciation", (c) => D.list(c.user, c.url), "admin");
add("GET", "/depreciation/new", (c) => D.newPage(c.user), "admin");
add("POST", "/depreciation", (c) => D.create(c.user, c.req), "admin");
add("GET", "/depreciation/:id/edit", (c) => D.editPage(c.user, c.params.id), "admin");
add("POST", "/depreciation/:id/edit", (c) => D.update(c.user, c.params.id, c.req), "admin");
add("POST", "/depreciation/:id/delete", (c) => D.remove(c.user, c.params.id), "admin");

// Maintenance
add("GET", "/maintenance", (c) => N.list(c.user, c.url), "maintenance.view");
add("GET", "/assets/:id/maintenance", (c) => N.assetList(c.user, c.params.id, c.url, hasPermission(c.user, "maintenance.manage")), "maintenance.view");
add("GET", "/assets/:id/maintenance/new", (c) => N.newPage(c.user, c.params.id), "maintenance.manage");
add("POST", "/assets/:id/maintenance", (c) => N.create(c.user, c.params.id, c.req), "maintenance.manage");
add("GET", "/maintenance/:id/edit", (c) => N.editPage(c.user, c.params.id), "maintenance.manage");
add("POST", "/maintenance/:id/edit", (c) => N.update(c.user, c.params.id, c.req), "maintenance.manage");
add("POST", "/maintenance/:id/complete", (c) => N.complete(c.user, c.params.id), "maintenance.manage");
add("POST", "/maintenance/:id/delete", (c) => N.remove(c.user, c.params.id), "maintenance.manage");

// Assets
add("GET", "/assets", (c) => A.assetsPage(c.user, c.url, hasPermission(c.user, "assets.manage")), "assets.view");
add("GET", "/assets/new", (c) => A.assetNewPage(c.user), "assets.manage");
add("POST", "/assets", (c) => A.assetCreate(c.user, c.req), "assets.manage");
add("POST", "/assets/bulk", (c) => A.bulkAction(c.user, c.req), "assets.manage");
add("GET", "/assets/import", (c) => A.importPage(c.user, c.url), "assets.manage");
add("POST", "/assets/import", (c) => A.importProcess(c.user, c.req), "assets.manage");
add("GET", "/assets/import/template.csv", () => A.importTemplate(), "assets.manage");
add("GET", "/assets/:id", (c) => A.assetDetail(c.user, c.params.id, c.url, hasPermission(c.user, "assets.manage")), "assets.view");
add("GET", "/assets/:id/edit", (c) => A.assetEditPage(c.user, c.params.id), "assets.manage");
add("POST", "/assets/:id", (c) => A.assetUpdate(c.user, c.params.id, c.req), "assets.manage");
add("POST", "/assets/:id/edit", (c) => A.assetUpdate(c.user, c.params.id, c.req), "assets.manage");
add("POST", "/assets/:id/delete", (c) => A.assetDelete(c.user, c.params.id), "assets.delete");
add("POST", "/assets/:id/checkout", (c) => A.assetCheckout(c.user, c.params.id, c.req), "assets.checkout");
add("POST", "/assets/:id/checkin", (c) => A.assetCheckin(c.user, c.params.id), "assets.checkout");
add("POST","/assets/:id/attachments",(c)=>AT.uploadAttachment(c.user,"asset",c.params.id,c.req),"assets.manage");

// Licenses
add("GET", "/licenses", (c) => L.licensesPage(c.user, c.url, hasPermission(c.user, "licenses.manage")), "licenses.view");
add("GET", "/licenses/new", (c) => L.licenseNewPage(c.user), "licenses.manage");
add("POST", "/licenses", (c) => L.licenseCreate(c.user, c.req), "licenses.manage");
add("GET","/licenses/import",(c)=>L.licenseImportPage(c.user,c.url),"licenses.manage");
add("GET","/licenses/import/template.csv",()=>L.licenseImportTemplate(),"licenses.manage");
add("POST","/licenses/import",(c)=>L.licenseImport(c.user,c.req),"licenses.manage");
add("GET", "/licenses/compliance", (c) => L.licenseCompliance(c.user, c.url), "licenses.view");
add("GET", "/licenses/:id", (c) => L.licenseDetail(c.user, c.params.id, c.url, hasPermission(c.user, "licenses.manage")), "licenses.view");
add("GET", "/licenses/:id/edit", (c) => L.licenseEditPage(c.user, c.params.id), "licenses.manage");
add("POST", "/licenses/:id", (c) => L.licenseUpdate(c.user, c.params.id, c.req), "licenses.manage");
add("POST", "/licenses/:id/delete", (c) => L.licenseDelete(c.user, c.params.id), "licenses.manage");
add("POST", "/licenses/:id/assign", (c) => L.licenseAssign(c.user, c.params.id, c.req), "licenses.assign");
add("POST", "/licenses/:id/release/:seatId", (c) => L.licenseRelease(c.user, c.params.id, c.params.seatId), "licenses.assign");
add("POST","/licenses/:id/attachments",(c)=>AT.uploadAttachment(c.user,"license",c.params.id,c.req),"licenses.manage");
add("GET","/attachments/:id",(c)=>AT.serveAttachment(c.user,c.params.id));
add("POST","/attachments/:id/delete",(c)=>AT.deleteAttachment(c.user,c.params.id));

// Consumables
add("GET", "/consumables", (c) => K.consumablesPage(c.user, c.url, hasPermission(c.user, "consumables.manage")), "consumables.view");
add("GET", "/consumables/new", (c) => K.consumableNewPage(c.user), "consumables.manage");
add("POST", "/consumables", (c) => K.consumableCreate(c.user, c.req), "consumables.manage");
add("GET","/consumables/import",(c)=>K.consumableImportPage(c.user,c.url),"consumables.manage");
add("GET","/consumables/import/template.csv",()=>K.consumableImportTemplate(),"consumables.manage");
add("POST","/consumables/import",(c)=>K.consumableImport(c.user,c.req),"consumables.manage");
add("POST","/consumables/:id/checkout",(c)=>K.consumableCheckout(c.user,c.params.id,c.req),"consumables.checkout");
add("POST","/consumable-checkouts/:id/checkin",(c)=>K.consumableCheckin(c.user,c.params.id),"consumables.checkout");
add("GET", "/consumables/:id/edit", (c) => K.consumableEditPage(c.user, c.params.id), "consumables.manage");
add("GET","/consumables/:id",(c)=>K.consumableDetail(c.user,c.params.id,c.url,hasPermission(c.user,"consumables.manage")),"consumables.view");
add("POST", "/consumables/:id", (c) => K.consumableUpdate(c.user, c.params.id, c.req), "consumables.manage");
add("POST", "/consumables/:id/delete", (c) => K.consumableDelete(c.user, c.params.id), "consumables.manage");
add("POST", "/consumables/:id/adjust", (c) => K.consumableAdjust(c.user, c.params.id, c.req), "consumables.manage");

// Accessories
add("GET", "/accessories", (c) => X.list(c.user, c.url, hasPermission(c.user, "accessories.manage")), "accessories.view");
add("GET", "/accessories/new", (c) => X.newPage(c.user), "accessories.manage");
add("POST", "/accessories", (c) => X.create(c.user, c.req), "accessories.manage");
add("GET","/accessories/import",(c)=>X.accessoryImportPage(c.user,c.url),"accessories.manage");
add("GET","/accessories/import/template.csv",()=>X.accessoryImportTemplate(),"accessories.manage");
add("POST","/accessories/import",(c)=>X.accessoryImport(c.user,c.req),"accessories.manage");
add("POST","/accessory-checkouts/:id/return",(c)=>X.accessoryReturn(c.user,c.params.id),"accessories.checkout");
add("GET", "/accessories/:id", (c) => X.detail(c.user, c.params.id, c.url, hasPermission(c.user, "accessories.manage")), "accessories.view");
add("GET", "/accessories/:id/edit", (c) => X.editPage(c.user, c.params.id), "accessories.manage");
add("POST", "/accessories/:id", (c) => X.update(c.user, c.params.id, c.req), "accessories.manage");
add("POST", "/accessories/:id/delete", (c) => X.remove(c.user, c.params.id), "accessories.manage");
add("POST", "/accessories/:id/checkout", (c) => X.checkout(c.user, c.params.id, c.req), "accessories.checkout");
add("POST", "/accessories/:id/checkin/:checkoutId", (c) => X.checkin(c.user, c.params.id, c.params.checkoutId), "accessories.checkout");

// Components
add("GET", "/components", (c) => P.list(c.user, c.url, hasPermission(c.user, "components.manage")), "components.view");
add("GET", "/components/new", (c) => P.newPage(c.user), "components.manage");
add("POST", "/components", (c) => P.create(c.user, c.req), "components.manage");
add("GET","/components/import",(c)=>P.componentImportPage(c.user,c.url),"components.manage");
add("GET","/components/import/template.csv",()=>P.componentImportTemplate(),"components.manage");
add("POST","/components/import",(c)=>P.componentImport(c.user,c.req),"components.manage");
add("GET", "/components/:id", (c) => P.detail(c.user, c.params.id, c.url, hasPermission(c.user, "components.manage")), "components.view");
add("GET", "/components/:id/edit", (c) => P.editPage(c.user, c.params.id), "components.manage");
add("POST", "/components/:id", (c) => P.update(c.user, c.params.id, c.req), "components.manage");
add("POST", "/components/:id/delete", (c) => P.removeEntity(c.user, c.params.id), "components.manage");
add("POST", "/components/:id/install", (c) => P.install(c.user, c.params.id, c.req), "components.manage");
add("POST", "/components/:id/remove/:rowId", (c) => P.removeInstall(c.user, c.params.id, c.params.rowId, c.req), "components.manage");

// Catalog entities (categories, manufacturers, suppliers, locations, models)
for (const key of Object.keys(C.entities)) {
  add("GET", `/${key}`, (c) => C.catalogList(c.user, key, c.url, hasPermission(c.user, "catalog.manage")), "catalog.view");
  add("POST", `/${key}`, (c) => C.catalogCreate(c.user, key, c.req), "catalog.manage");
  add("GET", `/${key}/:id/edit`, (c) => C.catalogEditPage(c.user, key, c.params.id), "catalog.manage");
  add("POST", `/${key}/:id`, (c) => C.catalogUpdate(c.user, key, c.params.id, c.req), "catalog.manage");
  add("POST", `/${key}/:id/edit`, (c) => C.catalogUpdate(c.user, key, c.params.id, c.req), "catalog.manage");
  add("POST", `/${key}/:id/delete`, (c) => C.catalogDelete(c.user, key, c.params.id), "catalog.manage");
}

// Users (admin only)
add("GET", "/users", (c) => U.usersPage(c.user, c.url), "admin");
add("GET", "/users/new", (c) => U.userNewPage(c.user), "admin");
add("POST", "/users", (c) => U.userCreate(c.user, c.req), "admin");
add("GET","/users/import",(c)=>U.importPage(c.user,c.url),"admin");
add("POST","/users/import",(c)=>U.importUsers(c.user,c.req),"admin");
add("GET","/users/import/template.csv",()=>U.importTemplate(),"admin");
add("GET", "/users/:id/edit", (c) => U.userEditPage(c.user, c.params.id), "admin");
add("POST", "/users/:id/offboard", (c) => U.userOffboard(c.user, c.params.id), "admin");
add("POST", "/users/:id", (c) => U.userUpdate(c.user, c.params.id, c.req), "admin");
add("POST", "/users/:id/toggle", (c) => U.userToggle(c.user, c.params.id), "admin");
add("POST", "/users/:id/tokens/:tokenId/revoke", (c) => U.adminTokenRevoke(c.user,c.params.id,c.params.tokenId), "admin");

function notFound(user: User): Response {
  const response = layout(user, "Not found", "<h1>Page not found</h1><p><a href='/'>Back to dashboard</a></p>");
  return new Response(response.body, { status: 404, headers: response.headers });
}

function ackAllowed(key: string): boolean {
  const now = Date.now();
  const b = ackLimits.get(key) ?? { n: 0, reset: now + 60_000 };
  if (now > b.reset) { b.n = 0; b.reset = now + 60_000; }
  b.n++;
  ackLimits.set(key, b);
  return b.n <= 10;
}

function canAccess(user: User, minRole: string): boolean {
  return minRole.includes(".") ? hasPermission(user, minRole) : hasRole(user, minRole);
}

const CHECK_INTERVAL_HOURS = Math.max(1, Math.min(168, Number(process.env.NOTIFY_CHECK_HOURS) || Number(S.getSetting("notify_check_hours", "24")) || 24));
setInterval(() => { E.notificationCheck(null); }, CHECK_INTERVAL_HOURS * 3_600_000);
setTimeout(() => { E.notificationCheck(null); }, 60_000);

const server = Bun.serve({
  port: Number(process.env.PORT || 9000),
  hostname: process.env.HOST || "0.0.0.0",
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const isApi=path.startsWith("/api/");

    if (path === "/login") {
      if (req.method === "POST") {
        const forwarded = trustProxy ? (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() : "";
        const clientIp = forwarded || server.requestIP(req)?.address || null;
        return doLogin(req, clientIp);
      }
      return getUser(req) ? redirect("/") : loginPage();
    }
    if ((path === "/favicon.svg" || path === "/favicon.ico") && req.method === "GET")
      return new Response(faviconSvg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
    if (path === "/healthz" && req.method === "GET") {
      try {
        db.query("SELECT 1").get();
        return new Response("ok", { status: 200 });
      } catch {
        return new Response("db error", { status: 503 });
      }
    }
    if (path.startsWith("/ack/") && (req.method === "GET" || req.method === "POST")) {
      const forwarded = trustProxy ? (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() : "";
      const clientIp = forwarded || server.requestIP(req)?.address || "unknown";
      if (!ackAllowed(clientIp)) return new Response("Too many acknowledgement requests", { status: 429, headers: { "Retry-After": "60" } });
      const token = decodeURIComponent(path.slice("/ack/".length));
      return req.method === "GET" ? ACK.ackPage(token) : ACK.ackSubmit(token, req);
    }

    const bearer=getUserFromBearer(req);
    const user = bearer?.user ?? getUser(req);
    if (!user) return isApi?API.apiErr("Unauthorized",401):redirect("/login");
    if(bearer&&isApi&&!checkApiRate(bearer.tokenHash))return new Response(JSON.stringify({error:"Rate limit exceeded"}),{status:429,headers:{"Content-Type":"application/json","Retry-After":"60"}});
    if (req.method === "POST" && !bearer && !(await verifyCsrf(req, user)))
      return isApi?API.apiErr("CSRF validation failed",403):new Response("CSRF validation failed", { status: 403 });
    if (path === "/logout" && req.method === "POST") return doLogout(req);

    for (const r of routes) {
      if (r.m !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      if (!canAccess(user, r.role)) return isApi?API.apiErr("Forbidden",403):forbidden(user, path);
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return await r.h({ req, url, params, user });
      } catch (e: any) {
        console.error(e);
        return isApi?API.apiErr("Internal server error",500):layout(user, "Error", `<h1>Something went wrong</h1><p class="muted">${esc(String(e?.message || e))}</p>`);
      }
    }
    return isApi?API.apiErr("Not found",404):notFound(user);
  },
});

console.log(`${S.appName()} running at http://localhost:${server.port}`);

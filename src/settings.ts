import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, redirect } from "./web";

export function getSetting(key: string, fallback = ""): string {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as any;
  return row?.value ?? fallback;
}

export function upsertSetting(key: string, value: string): void {
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

export function appName(): string {
  return getSetting("app_name", process.env.APP_NAME || "Inventra");
}

export function baseUrl(): string {
  return getSetting("base_url", process.env.BASE_URL || "");
}

export function itemsPerPage(): number {
  const n = Number(getSetting("items_per_page", "50"));
  return Number.isInteger(n) && n >= 5 && n <= 500 ? n : 50;
}

export function settingsPage(user: User, url: URL): Response {
  const values: Record<string, string> = {
    app_name: appName(),
    base_url: baseUrl(),
    asset_tag_prefix: getSetting("asset_tag_prefix", "AST-"),
    items_per_page: String(itemsPerPage()),
    smtp_enabled: getSetting("smtp_enabled", "0"),
    smtp_host: getSetting("smtp_host", ""),
    smtp_port: getSetting("smtp_port", "587"),
    smtp_tls: getSetting("smtp_tls", "0"),
    smtp_user: getSetting("smtp_user", ""),
    smtp_from: getSetting("smtp_from", ""),
    notify_warranty_days:getSetting("notify_warranty_days","60"),
    notify_license_days:getSetting("notify_license_days","30"),
    ack_reminder_days:getSetting("ack_reminder_days","7"),
    notify_check_hours:getSetting("notify_check_hours","24"),
    notify_model_stock:getSetting("notify_model_stock","1"),
  };
  const field = (key: string, label: string, type = "text", required = true) =>
    `<div><label>${label}</label><input name="${key}" type="${type}" value="${esc(values[key])}"${required ? " required" : ""}></div>`;
  const check = (key:string,label:string) => `<div><label><input name="${key}" type="checkbox" value="1" style="width:auto"${values[key]==="1"?" checked":""}> ${label}</label></div>`;
  return layout(user, "Settings", `<h1>Settings</h1><div class="card"><form method="post" action="/settings">
<h2 style="margin-top:0">Application</h2>
<div class="frm">${field("app_name", "Application name")}${field("base_url", "Base URL")}${field("asset_tag_prefix", "Asset tag prefix")}${field("items_per_page", "Items per page", "number")}</div>
<h2>Email</h2><div class="frm">${check("smtp_enabled","Enable SMTP")}${field("smtp_host","SMTP host","text",false)}${field("smtp_port","SMTP port","number")}${check("smtp_tls","Use implicit TLS")}
${field("smtp_user","SMTP username","text",false)}<div><label>SMTP password</label><input name="smtp_pass" type="password" autocomplete="new-password" placeholder="Leave blank to keep existing"></div>${field("smtp_from","Sender address","text",false)}
<div><label><input name="notify_model_stock" type="checkbox" value="1" style="width:auto"${values.notify_model_stock==="1"?" checked":""}> Low model stock alerts</label></div>
<div><label>Warranty notice (days before)</label><input name="notify_warranty_days" type="number" min="1" max="365" value="${esc(values.notify_warranty_days)}" required></div>
<div><label>License expiry notice (days before)</label><input name="notify_license_days" type="number" min="1" max="365" value="${esc(values.notify_license_days)}" required></div>
<div><label>Acknowledgement reminder (days after)</label><input name="ack_reminder_days" type="number" min="1" max="365" value="${esc(values.ack_reminder_days)}" required></div>
<div><label>Notification check interval (hours)</label><input name="notify_check_hours" type="number" min="1" max="168" value="${esc(values.notify_check_hours)}"></div></div>
<button class="btn">Save settings</button></form></div>`, "/settings", url.searchParams.get("m") || "");
}

export async function settingsUpdate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  const pageSize = Math.min(500, Math.max(5, Number(v("items_per_page")) || 50));
  const values: Record<string, string> = {
    app_name: v("app_name") || process.env.APP_NAME || "Inventra",
    base_url: v("base_url"),
    asset_tag_prefix: v("asset_tag_prefix") || "AST-",
    items_per_page: String(pageSize),
    smtp_enabled: v("smtp_enabled") === "1" ? "1" : "0",
    smtp_host: v("smtp_host"),
    smtp_port: String(Math.max(1, Math.min(65535, Number(v("smtp_port")) || 587))),
    smtp_tls: v("smtp_tls") === "1" ? "1" : "0",
    smtp_user: v("smtp_user"),
    smtp_from: v("smtp_from"),
    notify_warranty_days:String(Math.min(365,Math.max(1,Number(v("notify_warranty_days"))||60))),
    notify_license_days:String(Math.min(365,Math.max(1,Number(v("notify_license_days"))||30))),
    ack_reminder_days:String(Math.min(365,Math.max(1,Number(v("ack_reminder_days"))||7))),
    notify_check_hours:String(Math.min(168,Math.max(1,Number(v("notify_check_hours"))||24))),
    notify_model_stock:v("notify_model_stock")==="1"?"1":"0",
  };
  if (v("smtp_pass")) values.smtp_pass = v("smtp_pass");
  const upsert = db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.transaction(() => Object.entries(values).forEach(([k, val]) => upsert.run(k, val)))();
  logActivity(user.id, "update", "settings", null, "application settings");
  return redirect("/settings?m=Settings saved");
}

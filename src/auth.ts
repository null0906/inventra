import { randomBytes } from "node:crypto";
import { db, logActivity } from "./db";
import { esc, formVals, html, layout, redirect, roleRank } from "./web";
import { appName } from "./settings";
import { loadPermissions } from "./roles";

const SESSION_DAYS = Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS) || 7));

export type User = {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string;
  active: number;
  csrfToken: string;
  custom_role_id?: number | null;
  permissions?: Set<string>;
};

export function getUser(req: Request): User | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  const row = db.query(
    `SELECT u.id, u.name, u.username, u.email, u.role, u.active, u.custom_role_id, s.csrf_token AS csrfToken
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
  ).get(m[1]) as User | null;
  return row ? loadPermissions(row) : null;
}

export function getUserFromBearer(req: Request): {user:User;tokenHash:string}|null {
  const auth=req.headers.get("authorization")??"";
  if(!auth.startsWith("Bearer "))return null;
  const raw=auth.slice(7).trim();
  if(!/^inv_[0-9a-f]{64}$/.test(raw))return null;
  const hash=new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  const row=db.query(`SELECT u.id,u.name,u.username,u.email,u.role,u.active,u.custom_role_id,'' csrfToken FROM api_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.active=1 AND u.active=1`).get(hash) as User;
  if(!row)return null;
  loadPermissions(row);
  db.run("UPDATE api_tokens SET last_used_at=datetime('now') WHERE token_hash=?",[hash]);
  return {user:row,tokenHash:hash};
}

const apiLimits=new Map<string,{n:number;reset:number}>();
export function checkApiRate(key:string):boolean{
  const now=Date.now(),b=apiLimits.get(key)??{n:0,reset:now+60_000};
  if(now>b.reset){b.n=0;b.reset=now+60_000;}b.n++;apiLimits.set(key,b);return b.n<=60;
}
function rawApiToken():string{
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return `inv_${Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}`;
}
function tokenTable(userId:number,adminUserId?:string):string{
  const rows=db.query("SELECT id,name,created_at,last_used_at,active FROM api_tokens WHERE user_id=? ORDER BY id DESC").all(userId) as any[];
  return `<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr>${rows.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.created_at)}</td><td>${esc(t.last_used_at||"")}</td><td>${t.active?"active":"revoked"}</td><td>${t.active?`<form class="inline" method="post" action="${adminUserId?`/users/${esc(adminUserId)}/tokens/${t.id}/revoke`:`/profile/tokens/${t.id}/revoke`}"><button class="btn danger sm">Revoke</button></form>`:""}</td></tr>`).join("")}</table></div>`;
}

export function loginPage(err = ""): Response {
  const name = appName();
  return html(`<!doctype html><html><head><meta charset="utf-8"><title>Sign in · ${esc(name)}</title>
<style>body{font:14px -apple-system,"Segoe UI",sans-serif;background:#181d27;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border-radius:10px;padding:32px;width:340px}
h1{font-size:19px;margin:0 0 18px}
label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:#4b5563}
input{width:100%;padding:9px;border:1px solid #cdd3de;border-radius:6px;box-sizing:border-box}
button{width:100%;margin-top:18px;padding:10px;background:#2456d6;color:#fff;border:0;border-radius:6px;font-size:14px;cursor:pointer}
.err{background:#fbe3e0;color:#b02a1c;padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px}</style></head>
<body><form class="box" method="post" action="/login">
<h1>${esc(name)}</h1>
${err ? `<div class="err">${esc(err)}</div>` : ""}
<label>Username</label><input name="username" autofocus required>
<label>Password</label><input name="password" type="password" required>
<button>Sign in</button>
</form></body></html>`);
}

const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
function failureKeys(username: string, clientIp: string | null): string[] {
  const keys = [`u:${username.toLowerCase()}`];
  if (clientIp) keys.push(`ip:${clientIp}`);
  return keys;
}
function recent(key: string): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  const list = (failures.get(key) || []).filter((t) => t > cutoff);
  failures.set(key, list);
  return list;
}
function pruneFailures(): void {
  for (const [key, list] of failures) {
    const active = list.filter((t) => t > Date.now() - WINDOW_MS);
    if (active.length) failures.set(key, active);
    else failures.delete(key);
  }
}

export async function doLogin(req: Request, clientIp: string | null): Promise<Response> {
  pruneFailures();
  const v = await formVals(req);
  const keys = failureKeys(v("username"), clientIp);
  if (keys.some((k) => recent(k).length >= 5)) {
    const response = loginPage("Invalid username or password.");
    return new Response(response.body, { status: 429, headers: { ...Object.fromEntries(response.headers), "Retry-After": "900" } });
  }
  const row = db
    .query("SELECT * FROM users WHERE username = ? AND active = 1")
    .get(v("username")) as any;
  if (!row || !(await Bun.password.verify(v("password"), row.password_hash))) {
    keys.forEach((k) => failures.set(k, [...recent(k), Date.now()]));
    return loginPage("Invalid username or password.");
  }
  keys.forEach((k) => failures.delete(k));
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  db.run("DELETE FROM sessions WHERE user_id = ?", [row.id]);
  db.run("INSERT INTO sessions (token, user_id, expires_at, csrf_token) VALUES (?,?,datetime('now','+' || ? || ' days'),?)", [
    token,
    row.id,
    SESSION_DAYS,
    csrf,
  ]);
  logActivity(row.id, "login", "user", row.id, row.username);
  const isHttps = process.env.TRUST_PROXY === "1" && (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `sid=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${isHttps ? "; Secure" : ""}`,
    },
  });
}

export function verifyCsrf(req: Request, user: User): Promise<boolean> {
  return req.clone().formData().then((f) => f.get("_csrf")?.toString() === user.csrfToken).catch(() => false);
}

export function profilePage(user: User, url: URL): Response {
  const profile=db.query("SELECT u.*,d.name department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?").get(user.id) as any;
  const checked=(k:string)=>profile?.[k]?" checked":"";
  return layout(user, "Profile", `<h1>Profile</h1><div class="card"><table>
<tr><th>Name</th><td>${esc(user.name)}</td></tr><tr><th>Username</th><td>${esc(user.username)}</td></tr>
<tr><th>Email</th><td>${esc(user.email || "")}</td></tr><tr><th>Role</th><td>${esc(user.role)}</td></tr><tr><th>Department</th><td>${esc(profile?.department||"")}</td></tr></table></div>
<div class="card"><h2 style="margin-top:0">Change password</h2><p class="muted" style="margin-bottom:12px">If you received a temporary password, please update it here.</p><form method="post" action="/profile"><div class="frm">
<div><label>Current password</label><input type="password" name="current_password" required></div>
<div><label>New password</label><input type="password" name="new_password" minlength="8" required></div></div><button class="btn">Change password</button></form></div>
<div class="card"><h2 style="margin-top:0">Notification preferences</h2><form method="post" action="/profile"><input type="hidden" name="notify_action" value="prefs">
<div class="frm">
<div><label><input type="checkbox" name="notify_low_stock" value="1" style="width:auto"${checked("notify_low_stock")}> Low-stock alerts</label></div>
<div><label><input type="checkbox" name="notify_license_expiry" value="1" style="width:auto"${checked("notify_license_expiry")}> License expiry alerts</label></div>
<div><label><input type="checkbox" name="notify_warranty_expiry" value="1" style="width:auto"${checked("notify_warranty_expiry")}> Warranty expiry alerts</label></div>
<div><label><input type="checkbox" name="notify_digest" value="1" style="width:auto"${checked("notify_digest")}> Weekly digest email</label></div>
</div><button class="btn">Save preferences</button></form></div>
<h2>API tokens</h2><div class="card"><form method="post" action="/profile/tokens"><div class="frm"><div><label>Token name</label><input name="name" required></div></div><button class="btn">Create token</button></form></div>
${tokenTable(user.id)}`,
  "/profile", url.searchParams.get("m") || "");
}

export async function createProfileToken(user:User,req:Request):Promise<Response>{
  const v=await formVals(req);if(!v("name"))return redirect("/profile?m=Token name is required");
  const raw=rawApiToken(),hash=new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  const r=db.run("INSERT INTO api_tokens(user_id,name,token_hash) VALUES(?,?,?)",[user.id,v("name"),hash]);
  logActivity(user.id,"create","api_token",Number(r.lastInsertRowid),`Created API token: ${v("name")}`);
  return layout(user,"API token created",`<h1>API token created</h1><div class="card"><p><strong>Copy this now — it will not be shown again.</strong></p><p style="margin-top:12px"><code>${esc(raw)}</code></p><p style="margin-top:12px"><a href="/profile">Back to profile</a></p></div>`,"/profile");
}
export function revokeProfileToken(user:User,id:string):Response{
  const t=db.query("SELECT id,name FROM api_tokens WHERE id=? AND user_id=?").get(id,user.id) as any;if(!t)return redirect("/profile?m=Token not found");
  db.run("UPDATE api_tokens SET active=0 WHERE id=? AND user_id=?",[id,user.id]);logActivity(user.id,"revoke","api_token",Number(id),`Revoked API token: ${t.name}`);
  return redirect("/profile?m=Token revoked");
}
export function adminTokenTable(userId:number,id:string):string{return tokenTable(userId,id);}

export async function profileUpdate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  if(v("notify_action")==="prefs"){
    db.run("UPDATE users SET notify_low_stock=?,notify_license_expiry=?,notify_warranty_expiry=?,notify_digest=? WHERE id=?",
      [v("notify_low_stock")?1:0,v("notify_license_expiry")?1:0,v("notify_warranty_expiry")?1:0,v("notify_digest")?1:0,user.id]);
    logActivity(user.id,"update","user",user.id,"notification preferences");
    return redirect("/profile?m=Preferences saved");
  }
  const row = db.query("SELECT password_hash FROM users WHERE id = ?").get(user.id) as any;
  if (!row || !(await Bun.password.verify(v("current_password"), row.password_hash)))
    return redirect("/profile?m=Current password is incorrect");
  if (v("new_password").length < 8) return redirect("/profile?m=New password must be at least 8 characters");
  const hash = await Bun.password.hash(v("new_password"), "bcrypt");
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id]);
  logActivity(user.id, "password_change", "user", user.id, user.username);
  return redirect("/profile?m=Password changed");
}

export function doLogout(req: Request): Response {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/);
  if (m) {
    const session = db.query("SELECT user_id FROM sessions WHERE token = ?").get(m[1]) as any;
    db.run("DELETE FROM sessions WHERE token = ?", [m[1]]);
    if (session) logActivity(session.user_id, "logout", "user", session.user_id);
  }
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": "sid=; Path=/; Max-Age=0" },
  });
}

export function forbidden(user: User, path: string): Response {
  const response = layout(user, "Forbidden", `<h1>Not allowed</h1><p>Your role (${esc(user.role)}) cannot access this page.</p>`, path);
  return new Response(response.body, { status: 403, headers: response.headers });
}

export function hasRole(user: User, minRole: string): boolean {
  return roleRank[user.role] >= roleRank[minRole];
}

import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, redirect } from "./web";

export const PERMISSIONS = [
  ["Assets", "assets.view", "View assets"],
  ["Assets", "assets.manage", "Create & edit assets"],
  ["Assets", "assets.delete", "Delete assets"],
  ["Assets", "assets.checkout", "Checkout & check-in"],
  ["Licenses", "licenses.view", "View licenses"],
  ["Licenses", "licenses.manage", "Create & edit licenses"],
  ["Licenses", "licenses.assign", "Assign / revoke seats"],
  ["Accessories", "accessories.view", "View accessories"],
  ["Accessories", "accessories.manage", "Create & edit"],
  ["Accessories", "accessories.checkout", "Checkout & return"],
  ["Consumables", "consumables.view", "View consumables"],
  ["Consumables", "consumables.manage", "Create & edit"],
  ["Consumables", "consumables.checkout", "Check out"],
  ["Components", "components.view", "View components"],
  ["Components", "components.manage", "Create, edit & install"],
  ["Catalog", "catalog.view", "View catalog (models, categories...)"],
  ["Catalog", "catalog.manage", "Manage catalog"],
  ["Maintenance", "maintenance.view", "View maintenance"],
  ["Maintenance", "maintenance.manage", "Create & edit maintenance"],
  ["Audits", "audits.view", "View audit sessions"],
  ["Audits", "audits.manage", "Create & manage audits"],
  ["Reports", "reports.view", "View & export reports"],
  ["Users", "users.view", "View user list"],
] as const satisfies [string, string, string][];

export type Permission = typeof PERMISSIONS[number][1];
const VIEWER_KEYS: Permission[] = ["assets.view","licenses.view","accessories.view","consumables.view","components.view","catalog.view","maintenance.view","audits.view","reports.view","users.view"];
const MANAGER_KEYS: Permission[] = [...VIEWER_KEYS,"assets.manage","assets.delete","assets.checkout","licenses.manage","licenses.assign","accessories.manage","accessories.checkout","consumables.manage","consumables.checkout","components.manage","catalog.manage","maintenance.manage","audits.manage"];
export const SYSTEM_PERMS: Record<string, Set<string>> = { viewer: new Set(VIEWER_KEYS), manager: new Set(MANAGER_KEYS) };
const SYSTEM_ROLES: Record<string, { name: string; perms: Permission[] }> = {
  viewer: { name: "Viewer", perms: VIEWER_KEYS },
  manager: { name: "Manager", perms: MANAGER_KEYS },
  admin: { name: "Admin", perms: PERMISSIONS.map(p => p[1]) },
};

export function loadPermissions(user: User): User {
  if ((user as any).custom_role_id) {
    const rows = db.query("SELECT permission FROM role_permissions WHERE role_id=?").all((user as any).custom_role_id) as any[];
    user.permissions = new Set(rows.map(r => r.permission));
  } else if (user.role !== "admin") {
    const role = db.query("SELECT id FROM roles WHERE role_key=?").get(user.role) as any;
    if (role) {
      const rows = db.query("SELECT permission FROM role_permissions WHERE role_id=?").all(role.id) as any[];
      user.permissions = new Set(rows.map(r => r.permission));
    }
  }
  return user;
}
export function hasPermission(user: User, perm: string): boolean {
  if (user.role === "admin") return true;
  if (user.permissions) return user.permissions.has(perm);
  return SYSTEM_PERMS[user.role]?.has(perm) ?? false;
}

function grouped(selected = new Set<string>()): string {
  const groups = new Map<string, typeof PERMISSIONS[number][]>();
  for (const p of PERMISSIONS) groups.set(p[0], [...(groups.get(p[0]) || []), p]);
  return [...groups.entries()].map(([g, rows]) => `<fieldset class="card" style="margin-bottom:12px"><legend style="font-weight:700">${esc(g)} <label class="muted" style="font-weight:400;margin-left:8px"><input class="group-all" type="checkbox" style="width:auto"> all</label></legend>
${rows.map(([, key, label]) => `<label style="display:inline-block;margin:6px 18px 6px 0"><input type="checkbox" name="permission" value="${esc(key)}" style="width:auto"${selected.has(key) ? " checked" : ""}> ${esc(label)}</label>`).join("")}</fieldset>`).join("");
}
const js = `<script>document.querySelectorAll('.group-all').forEach(function(x){x.addEventListener('change',function(){x.closest('fieldset').querySelectorAll('input[name=permission]').forEach(function(c){c.checked=x.checked})})})</script>`;

export function roleList(user: User, url: URL): Response {
  const rows = db.query(`SELECT r.*,
    CASE WHEN r.system=1 THEN (SELECT COUNT(*) FROM users u WHERE u.role=r.role_key AND u.custom_role_id IS NULL)
      ELSE (SELECT COUNT(*) FROM users u WHERE u.custom_role_id=r.id) END users,
    (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id=r.id) perms
    FROM roles r ORDER BY r.system DESC, CASE r.role_key WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END, r.name`).all() as any[];
  return layout(user, "Roles", `<h1>Roles</h1><div class="toolbar"><a class="btn" href="/admin/roles/new">+ New role</a></div><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Type</th><th>Permissions</th><th>Users</th><th></th></tr>${rows.map(r=>{const locked=r.role_key==="admin";return `<tr><td>${esc(r.name)}</td><td>${r.system?'<span class="badge b-blue">system</span>':'<span class="badge b-gray">custom</span>'}</td><td>${locked?"All":r.perms}</td><td>${r.users}</td><td>${locked?'<span class="muted">Locked</span>':`<a class="btn sec sm" href="/admin/roles/${r.id}/edit">Edit</a> ${r.system?"":`<form class="inline" method="post" action="/admin/roles/${r.id}/delete"><button class="btn danger sm">Delete</button></form>`}`}</td></tr>`}).join("")}</table></div>`, "/admin/roles", url.searchParams.get("m") || "");
}
export function roleNewPage(user: User): Response {
  return layout(user, "New role", `<h1>New role</h1><form method="post" action="/admin/roles"><div class="card"><label>Name</label><input name="name" required></div>${grouped()}<button class="btn">Create</button> <a class="btn sec" href="/admin/roles">Cancel</a></form>${js}`, "/admin/roles");
}
function validPerms(f: FormData): string[] {
  const allowed = new Set(PERMISSIONS.map(p => p[1]));
  return f.getAll("permission").map(String).filter(p => allowed.has(p as Permission));
}
function replacePerms(roleId: number | string, perms: string[]): void {
  db.transaction(()=>{db.run("DELETE FROM role_permissions WHERE role_id=?",[roleId]);const ins=db.query("INSERT INTO role_permissions(role_id,permission) VALUES(?,?)");perms.forEach(p=>ins.run(roleId,p));})();
}

function ensureSystemRoles(): void {
  for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
    let row = db.query("SELECT id FROM roles WHERE role_key=?").get(key) as any;
    if (!row) {
      const existing = db.query("SELECT id FROM roles WHERE name=? AND role_key IS NULL").get(role.name) as any;
      if (existing) {
        db.run("UPDATE roles SET role_key=?,system=1 WHERE id=?", [key, existing.id]);
        row = existing;
      } else {
        db.run("INSERT OR IGNORE INTO roles(name,role_key,system) VALUES(?,?,1)", [role.name, key]);
        row = db.query("SELECT id FROM roles WHERE role_key=?").get(key) as any;
      }
    }
    if (!row) continue;
    const count = Number((db.query("SELECT COUNT(*) n FROM role_permissions WHERE role_id=?").get(row.id) as any).n);
    if (count === 0) replacePerms(row.id, role.perms);
  }
}
ensureSystemRoles();

export async function roleCreate(user: User, req: Request): Promise<Response> {
  const f = await req.formData(), name = String(f.get("name") || "").trim(), perms = validPerms(f);
  if (!name) return redirect("/admin/roles/new?m=Name is required");
  try { const r = db.run("INSERT INTO roles(name) VALUES(?)", [name]); replacePerms(Number(r.lastInsertRowid), perms); logActivity(user.id, "create", "role", Number(r.lastInsertRowid), name); return redirect("/admin/roles?m=Role created"); }
  catch(e:any){ return redirect(`/admin/roles?m=${encodeURIComponent(`Error: ${e.message}`)}`); }
}
export function roleEditPage(user: User, id: string): Response {
  const r = db.query("SELECT * FROM roles WHERE id=?").get(id) as any;
  if (!r) return layout(user, "Not found", "<h1>Role not found</h1>", "/admin/roles");
  if (r.role_key === "admin") {
    const all = new Set(PERMISSIONS.map(p => p[1]));
    return layout(user, "Admin role", `<h1>Admin role</h1><div class="card"><p><strong>Admin</strong> is the built-in superuser role and always has every permission.</p><p class="muted">It is visible here for clarity, but cannot be edited.</p><a class="btn sec" href="/admin/roles">Back</a></div>${grouped(all).replaceAll("type=\"checkbox\"", "type=\"checkbox\" disabled")}`, "/admin/roles");
  }
  const selected = new Set((db.query("SELECT permission FROM role_permissions WHERE role_id=?").all(id) as any[]).map(x => x.permission));
  const nameField = r.system ? `<input type="hidden" name="name" value="${esc(r.name)}"><p><strong>${esc(r.name)}</strong> <span class="badge b-blue">system</span></p><p class="muted">System role names are fixed, but their permissions can be changed.</p>` : `<label>Name</label><input name="name" value="${esc(r.name)}" required>`;
  return layout(user, "Edit role", `<h1>Edit role</h1><form method="post" action="/admin/roles/${esc(id)}/edit"><div class="card">${nameField}</div>${grouped(selected)}<button class="btn">Save</button> <a class="btn sec" href="/admin/roles">Cancel</a></form>${js}`, "/admin/roles");
}
export async function roleUpdate(user: User, id: string, req: Request): Promise<Response> {
  const f = await req.formData(), name = String(f.get("name") || "").trim();
  const r = db.query("SELECT * FROM roles WHERE id=?").get(id) as any;
  if (!r) return redirect("/admin/roles?m=Role not found");
  if (r.role_key === "admin") return redirect("/admin/roles?m=Admin role cannot be edited");
  if (!name) return redirect(`/admin/roles/${encodeURIComponent(id)}/edit?m=Name is required`);
  try { if (!r.system) db.run("UPDATE roles SET name=? WHERE id=?", [name, id]); replacePerms(id, validPerms(f)); logActivity(user.id, "update", "role", Number(id), r.system ? r.name : name); return redirect("/admin/roles?m=Saved"); }
  catch(e:any){ return redirect(`/admin/roles?m=${encodeURIComponent(`Error: ${e.message}`)}`); }
}
export function roleDelete(user: User, id: string): Response {
  const r = db.query("SELECT name,system FROM roles WHERE id=?").get(id) as any;
  if (!r) return redirect("/admin/roles?m=Role not found");
  if (r.system) return redirect("/admin/roles?m=System roles cannot be deleted");
  const used = Number((db.query("SELECT COUNT(*) n FROM users WHERE custom_role_id=?").get(id) as any).n);
  if (used) return redirect("/admin/roles?m=Cannot delete a role assigned to users");
  db.run("DELETE FROM roles WHERE id=?", [id]);
  logActivity(user.id, "delete", "role", Number(id), r.name);
  return redirect("/admin/roles?m=Deleted");
}

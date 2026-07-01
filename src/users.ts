import { db, logActivity } from "./db";
import type { User } from "./auth";
import { emptyState, esc, formVals, inlineConfirm, layout, redirect } from "./web";
import { adminTokenTable } from "./auth";
import { opt } from "./web";
import { parseCsv } from "./csv";
import { createAck } from "./ack";

const ROLES = ["viewer", "manager", "admin"];

function userForm(u: any = {}, isNew = false): string {
  const departments=db.query("SELECT id,name FROM departments ORDER BY name").all() as any[];
  const roles=db.query("SELECT id,name FROM roles ORDER BY name").all() as any[];
  return `<div class="frm">
<div><label>Full name *</label><input name="name" value="${esc(u.name ?? "")}" required></div>
<div><label>Username *</label><input name="username" value="${esc(u.username ?? "")}" required></div>
<div><label>Email</label><input name="email" type="email" value="${esc(u.email ?? "")}"></div>
<div><label>Role</label><select name="role">${ROLES.map((r) => `<option${u.role === r ? " selected" : ""}>${r}</option>`).join("")}</select></div>
<div><label>Custom role (overrides system role)</label><select name="custom_role_id"><option value="">— use system role —</option>${roles.map((r)=>`<option value="${r.id}"${String(u.custom_role_id||"")===String(r.id)?" selected":""}>${esc(r.name)}</option>`).join("")}</select></div>
<div><label>Department</label><select name="department_id"><option value="">—</option>${opt(departments,u.department_id)}</select></div>
<div><label>Password ${isNew ? "*" : "(leave blank to keep)"}</label><input name="password" type="password"${isNew ? " required" : ""}></div>
</div>`;
}

export function usersPage(user: User, url: URL): Response {
  const rows = db
    .query(
      `SELECT u.*,d.name department,(SELECT COUNT(*) FROM assets a WHERE a.assigned_to = u.id) AS assets
       FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.name`
    )
    .all() as any[];
  const body = `<h1>Users <span class="muted">(${rows.length})</span></h1>
<div class="toolbar"><a class="btn" href="/users/new">+ New user</a><a class="btn sec" href="/users/import">Import CSV</a></div>
${rows.length===0?emptyState("No users found","Create a user to start assigning inventory.",'<a class="btn" href="/users/new">+ New user</a>'):`<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Department</th><th>Assets</th><th>Status</th><th></th></tr>
${rows
  .map(
    (u) => `<tr data-href="/users/${u.id}/edit"><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.email ?? "")}</td>
<td>${esc(u.role)}</td><td>${esc(u.department||"")}</td><td>${u.assets}</td>
<td>${u.active ? '<span class="badge b-green">active</span>' : '<span class="badge b-gray">disabled</span>'}</td>
<td style="white-space:nowrap"><a class="btn sec sm" href="/users/${u.id}/edit">Edit</a>
${u.id !== user.id ? `<form class="inline" method="post" action="/users/${u.id}/toggle"><button class="btn ${u.active ? "danger" : "sec"} sm">${u.active ? "Disable" : "Enable"}</button></form>` : ""}</td></tr>`
  )
  .join("")}
</table></div>`}`;
  return layout(user, "Users", body, "/users", url.searchParams.get("m") || "");
}

export function userNewPage(user: User): Response {
  return layout(
    user,
    "New user",
    `<h1>New user</h1><div class="card"><form method="post" action="/users">${userForm({}, true)}
<button class="btn">Create</button> <a class="btn sec" href="/users">Cancel</a></form></div>`,
    "/users"
  );
}

export async function userCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  if(!/^[A-Za-z0-9._@-]+$/.test(v("username")))return redirect("/users?m=Invalid username");
  try {
    const hash = await Bun.password.hash(v("password"), "bcrypt");
    const r = db.run("INSERT INTO users (name, username, email, role, password_hash, department_id, custom_role_id) VALUES (?,?,?,?,?,?,?)", [
      v("name"),
      v("username"),
      v("email") || null,
      ROLES.includes(v("role")) ? v("role") : "viewer",
      hash,
      v("department_id")||null,
      v("custom_role_id")||null,
    ]);
    logActivity(user.id, "create", "user", Number(r.lastInsertRowid), v("username"));
    return redirect("/users?m=User created");
  } catch (e: any) {
    return redirect(`/users?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function userEditPage(user: User, id: string): Response {
  const u = db.query("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!u) return layout(user, "Not found", "<h1>User not found</h1>", "/users");
  const counts = db.query(`SELECT
    (SELECT COUNT(*) FROM assets WHERE assigned_to=?) assets,
    (SELECT COUNT(*) FROM accessory_checkouts WHERE user_id=? AND checked_in_at IS NULL) accessories,
    (SELECT COUNT(*) FROM consumable_checkouts WHERE user_id=? AND checked_in_at IS NULL) consumables,
    (SELECT COUNT(*) FROM license_seats WHERE user_id=?) licenses`).get(id,id,id,id) as any;
  const total = Number(counts.assets)+Number(counts.accessories)+Number(counts.consumables)+Number(counts.licenses);
  const offboard = u.active && u.id !== user.id ? `<h2>Off-board user</h2><div class="card">
<p style="margin-bottom:12px">Items currently assigned: <strong>${counts.assets}</strong> assets · <strong>${counts.accessories}</strong> accessories · <strong>${counts.consumables}</strong> consumable checkouts · <strong>${counts.licenses}</strong> license seats</p>
${inlineConfirm(`offboard-${id}`,`/users/${id}/offboard`,total ? "Return all items & deactivate" : "Deactivate user","Return all assigned items and deactivate this user?",user.csrfToken)}
</div>` : "";
  return layout(
    user,
    `Edit ${u.username}`,
    `<h1>Edit user</h1><div class="card"><form method="post" action="/users/${esc(id)}">${userForm(u)}
<button class="btn">Save</button> <a class="btn sec" href="/users">Cancel</a></form></div>${offboard}<h2>API tokens</h2>${adminTokenTable(u.id,id)}`,
    "/users"
  );
}

export function adminTokenRevoke(user:User,userId:string,tokenId:string):Response{
  const target=db.query("SELECT username FROM users WHERE id=?").get(userId) as any;
  const token=db.query("SELECT id,name FROM api_tokens WHERE id=? AND user_id=?").get(tokenId,userId) as any;
  if(!target||!token)return redirect(`/users/${encodeURIComponent(userId)}/edit?m=Token not found`);
  db.run("UPDATE api_tokens SET active=0 WHERE id=? AND user_id=?",[tokenId,userId]);
  logActivity(user.id,"revoke","api_token",Number(tokenId),`Admin revoked API token ${token.name} for ${target.username}`);
  return redirect(`/users/${encodeURIComponent(userId)}/edit?m=Token revoked`);
}

export async function userUpdate(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  if(!/^[A-Za-z0-9._@-]+$/.test(v("username")))return redirect("/users?m=Invalid username");
  try {
    db.run("UPDATE users SET name=?, username=?, email=?, role=?,department_id=?,custom_role_id=? WHERE id=?", [
      v("name"),
      v("username"),
      v("email") || null,
      ROLES.includes(v("role")) ? v("role") : "viewer",
      v("department_id")||null,
      v("custom_role_id")||null,
      id,
    ]);
    if (v("password")) {
      const hash = await Bun.password.hash(v("password"), "bcrypt");
      db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id]);
      db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
    }
    logActivity(user.id, "update", "user", Number(id), v("username"));
    return redirect("/users?m=Saved");
  } catch (e: any) {
    return redirect(`/users?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function importPage(user:User,url:URL):Response{return layout(user,"Import users",`<h1>Import users</h1><div class="card"><form method="post" action="/users/import" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv,text/csv" required style="margin-bottom:14px"><button class="btn">Import</button> <a class="btn sec" href="/users/import/template.csv">Download template</a></form></div>`,"/users",url.searchParams.get("m")||"");}
export function importTemplate():Response{return new Response("username,name,email,role,department\n",{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="users-import-template.csv"'}});}
export async function importUsers(user:User,req:Request):Promise<Response>{
  const form=await req.formData(),file=form.get("csv");if(!(file instanceof File))return redirect("/users/import?m=Choose a CSV file");if(file.size>5_242_880)return redirect("/users/import?m=CSV exceeds the 5 MB limit");
  const rows=parseCsv(await file.text());if(!rows.length)return redirect("/users/import?m=CSV is empty");const headers=rows.shift()!.map(x=>x.toLowerCase());if(rows.length>2000)return redirect("/users/import?m=CSV exceeds the 2000 row limit");
  let created=0,updated=0,errors=0;const newPws:string[]=[];
  for(const cells of rows){if(cells.every(x=>!x))continue;const x=Object.fromEntries(headers.map((h,i)=>[h,cells[i]||""])) as Record<string,string>,username=x.username?.trim(),role=x.role?.trim()||"viewer";
    if(!username||!/^[A-Za-z0-9._@-]+$/.test(username)||!ROLES.includes(role)){errors++;continue;}const department=x.department?.trim()?db.query("SELECT id FROM departments WHERE name=? COLLATE NOCASE").get(x.department.trim()) as any:null;
    try{const old=db.query("SELECT id FROM users WHERE username=?").get(username) as any;if(old){db.run("UPDATE users SET name=?,email=?,role=?,department_id=? WHERE id=?",[x.name||username,x.email||null,role,department?.id||null,old.id]);logActivity(user.id,"import","user",old.id,username);updated++;}
      else{const raw=crypto.randomUUID().replaceAll("-","").slice(0,16),hash=await Bun.password.hash(raw,"bcrypt"),r=db.run("INSERT INTO users(name,username,email,role,password_hash,department_id) VALUES(?,?,?,?,?,?)",[x.name||username,username,x.email||null,role,hash,department?.id||null]);logActivity(user.id,"import","user",Number(r.lastInsertRowid),username);newPws.push(`${username}: ${raw}`);created++;}}catch{errors++;}
  }const pwSuffix=newPws.length?`\n\nNew user temp passwords (save now):\n${newPws.join("\n")}`:"";return redirect(`/users?m=${encodeURIComponent(`Import complete: ${created} created, ${updated} updated, ${errors} errors${pwSuffix}`)}`);
}

export function userToggle(user: User, id: string): Response {
  if (Number(id) === user.id) return redirect("/users?m=Cannot disable yourself");
  const u = db.query("SELECT username, active FROM users WHERE id = ?").get(id) as any;
  if (!u) return redirect("/users");
  db.run("UPDATE users SET active = ? WHERE id = ?", [u.active ? 0 : 1, id]);
  if (u.active) db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
  logActivity(user.id, u.active ? "disable" : "enable", "user", Number(id), u.username);
  return redirect(`/users?m=${encodeURIComponent(`${u.username} ${u.active ? "disabled" : "enabled"}`)}`);
}

export function userOffboard(user: User, id: string): Response {
  if (!/^\d+$/.test(id)) return redirect("/users?m=User not found");
  if (Number(id) === user.id) return redirect("/users?m=Cannot off-board yourself");
  const target = db.query("SELECT id,name,username,email,active FROM users WHERE id=?").get(id) as any;
  if (!target) return redirect("/users?m=User not found");
  if (!target.active) return redirect("/users?m=User is already inactive");
  const detail = (text: string) => `${target.name} (${target.username}): ${text}`;

  db.transaction(() => {
    const rows = db.query("SELECT id,consumable_id,qty FROM consumable_checkouts WHERE user_id=? AND checked_in_at IS NULL").all(id) as any[];
    for (const row of rows) {
      const r = db.run("UPDATE consumable_checkouts SET checked_in_at=datetime('now'),checked_in_by=? WHERE id=? AND checked_in_at IS NULL", [user.id,row.id]);
      if (!r.changes) continue;
      db.run("UPDATE consumables SET qty=qty+? WHERE id=?", [row.qty,row.consumable_id]);
      logActivity(user.id,"offboard-checkin","consumable",row.consumable_id,detail(`${row.qty} returned`));
    }
  })();

  db.transaction(() => {
    const r = db.run("UPDATE accessory_checkouts SET checked_in_at=datetime('now'),checked_in_by=? WHERE user_id=? AND checked_in_at IS NULL", [user.id,id]);
    logActivity(user.id,"offboard-return","user",Number(id),detail(`${r.changes} accessories returned`));
  })();

  db.transaction(() => {
    const r = db.run("DELETE FROM license_seats WHERE user_id=?", [id]);
    logActivity(user.id,"offboard-license","user",Number(id),detail(`${r.changes} license seats released`));
  })();

  db.transaction(() => {
    const r = db.run("UPDATE assets SET status='deployable',assigned_to=NULL,checkout_location_id=NULL WHERE assigned_to=? AND status='deployed'", [id]);
    logActivity(user.id,"offboard-asset","user",Number(id),detail(`${r.changes} assets returned`));
  })();

  db.transaction(() => {
    const r = db.run("UPDATE checkout_requests SET status='denied',handled_by=?,handler_note='User off-boarded',handled_at=datetime('now') WHERE user_id=? AND status='pending'", [user.id,id]);
    logActivity(user.id,"offboard-requests","user",Number(id),detail(`${r.changes} pending requests cancelled`));
  })();

  db.transaction(() => {
    db.run("UPDATE users SET active=0 WHERE id=?", [id]);
    db.run("DELETE FROM sessions WHERE user_id=?", [id]);
    logActivity(user.id,"deactivate","user",Number(id),detail("off-boarded"));
  })();
  if(target.email)createAck(user.id,target.id,"offboard","user",target.id,"Off-boarding acknowledgement","Your account has been deactivated and all assigned items have been returned. Please acknowledge this off-boarding notice.");
  return redirect("/users?m=User offboarded and deactivated");
}

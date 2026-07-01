import { db, logActivity } from "./db";
import type { User } from "./auth";
import { emptyState, esc, formVals, inlineConfirm, layout, opt, redirect } from "./web";
import { attachmentList } from "./attachments";
import { inventoryImport,inventoryImportPage,inventoryImportTemplate,namedId,numberValue,positiveInt,textValue,type ImportConfig } from "./csv";
import { entityTimeline } from "./misc";
const importConfig:ImportConfig={entity:"license",path:"licenses",columns:[{header:"name",db:"name",value:textValue,default:""},{header:"product_key",db:"product_key",value:textValue,default:null},{header:"seats",db:"seats",value:positiveInt,default:1},{header:"manufacturer",db:"manufacturer_id",value:x=>namedId("manufacturers",x),default:null},{header:"category",db:"category_id",value:x=>namedId("categories",x),default:null},{header:"purchase_date",db:"purchase_date",value:textValue,default:null},{header:"purchase_cost",db:"purchase_cost",value:numberValue,default:null},{header:"expires",db:"expires",value:textValue,default:null},{header:"notes",db:"notes",value:textValue,default:null}]};
function seatStats(total:any,used:any):string{const t=Number(total||0),u=Number(used||0);return `<div class="stats"><div class="stat"><div class="n">${t}</div><div class="l">Total</div></div><div class="stat"><div class="n">${u}</div><div class="l">Used</div></div><div class="stat"><div class="n">${Math.max(0,t-u)}</div><div class="l">Left</div></div></div>`;}

function licenseForm(l: any = {}): string {
  const mans = db.query("SELECT id, name FROM manufacturers ORDER BY name").all() as any[];
  const cats = db.query("SELECT id, name FROM categories WHERE ctype = 'license' ORDER BY name").all() as any[];
  return `<div class="frm">
<div><label>Name *</label><input name="name" value="${esc(l.name ?? "")}" required></div>
<div><label>Product key</label><input name="product_key" value="${esc(l.product_key ?? "")}"></div>
<div><label>Seats *</label><input name="seats" type="number" min="1" value="${esc(l.seats ?? 1)}" required></div>
<div><label>Manufacturer</label><select name="manufacturer_id"><option value="">—</option>${opt(mans, l.manufacturer_id)}</select></div>
<div><label>Category</label><select name="category_id"><option value="">—</option>${opt(cats, l.category_id)}</select></div>
<div><label>Purchase date</label><input name="purchase_date" type="date" value="${esc(l.purchase_date ?? "")}"></div>
<div><label>Cost</label><input name="purchase_cost" type="number" step="0.01" value="${esc(l.purchase_cost ?? "")}"></div>
<div><label>Expires</label><input name="expires" type="date" value="${esc(l.expires ?? "")}"></div>
</div>
<div style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:#4b5563">Notes</label><textarea name="notes" rows="2">${esc(l.notes ?? "")}</textarea></div>`;
}

function licenseVals(v: (k: string) => string): any[] {
  const n = (k: string) => (v(k) === "" ? null : v(k));
  return [v("name"), n("product_key"), Number(v("seats") || 1), n("manufacturer_id"), n("category_id"), n("purchase_date"), n("purchase_cost"), n("expires"), n("notes")];
}

export function licensesPage(user: User, url: URL, canEdit: boolean): Response {
  const rows = db
    .query(
      `SELECT l.*, mf.name AS manufacturer,
        (SELECT COUNT(*) FROM license_seats s WHERE s.license_id = l.id) AS used
       FROM licenses l LEFT JOIN manufacturers mf ON mf.id = l.manufacturer_id ORDER BY l.name`
    )
    .all() as any[];
  const soon = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  const body = `<h1>Licenses <span class="muted">(${rows.length})</span></h1>
<div class="toolbar"><a class="btn sec" href="/licenses/compliance">Compliance</a>${canEdit ? `<a class="btn" href="/licenses/new">+ New license</a> <a class="btn sec" href="/licenses/import">Import CSV</a>` : ""}</div>
${rows.length===0?emptyState("No licenses found","Create your first license to start tracking seats.",canEdit?'<a class="btn" href="/licenses/new">+ New license</a>':""):`<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr><th>Name</th><th>Manufacturer</th><th>Total</th><th>Used</th><th>Left</th><th>Expires</th></tr>
${rows
  .map(
    (l) => `<tr data-href="/licenses/${l.id}"><td><a href="/licenses/${l.id}">${esc(l.name)}</a></td><td>${esc(l.manufacturer ?? "")}</td>
<td>${l.seats}</td><td>${l.used}</td><td>${Math.max(0,Number(l.seats)-Number(l.used))}${l.used >= l.seats ? ' <span class="badge b-red">full</span>' : ""}</td>
<td>${esc(l.expires ?? "")}${l.expires && l.expires <= soon ? ' <span class="badge b-amber">expiring</span>' : ""}</td></tr>`
  )
  .join("")}
</table></div>`}`;
  return layout(user, "Licenses", body, "/licenses", url.searchParams.get("m") || "");
}

export function licenseCompliance(user: User, url: URL): Response {
  const rows = db.query(`SELECT l.id,l.name,l.seats,COUNT(s.id) used,l.seats-COUNT(s.id) available,l.expires
    FROM licenses l LEFT JOIN license_seats s ON s.license_id=l.id
    GROUP BY l.id ORDER BY l.name`).all() as any[];
  const status = (r: any) => r.used > r.seats ? '<span class="badge b-red">over-seated</span>'
    : r.used === r.seats ? '<span class="badge b-amber">at capacity</span>'
    : '<span class="badge b-green">available</span>';
  const body = `<h1>License Compliance</h1><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Seats</th><th>Used</th><th>Available</th><th>Expires</th><th>Status</th></tr>
${rows.map(r=>`<tr><td><a href="/licenses/${r.id}">${esc(r.name)}</a></td><td>${r.seats}</td><td>${r.used}</td><td>${r.available}</td><td>${esc(r.expires || "")}</td><td>${status(r)}</td></tr>`).join("")}
</table></div>`;
  return layout(user,"License Compliance",body,"/licenses",url.searchParams.get("m")||"");
}

export function licenseNewPage(user: User): Response {
  return layout(
    user,
    "New license",
    `<h1>New license</h1><div class="card"><form method="post" action="/licenses">${licenseForm()}
<button class="btn">Create</button> <a class="btn sec" href="/licenses">Cancel</a></form></div>`,
    "/licenses"
  );
}

export async function licenseCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  const r = db.run(
    "INSERT INTO licenses (name, product_key, seats, manufacturer_id, category_id, purchase_date, purchase_cost, expires, notes) VALUES (?,?,?,?,?,?,?,?,?)",
    licenseVals(v)
  );
  logActivity(user.id, "create", "license", Number(r.lastInsertRowid), v("name"));
  return redirect(`/licenses/${r.lastInsertRowid}?m=License created`);
}

export function licenseDetail(user: User, id: string, url: URL, canEdit: boolean): Response {
  const l = db
    .query("SELECT l.*, mf.name AS manufacturer FROM licenses l LEFT JOIN manufacturers mf ON mf.id = l.manufacturer_id WHERE l.id = ?")
    .get(id) as any;
  if (!l) return layout(user, "Not found", "<h1>License not found</h1>", "/licenses");
  const seats = db
    .query(
      `SELECT s.id, s.assigned_at, u.name AS uname, a.asset_tag
       FROM license_seats s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN assets a ON a.id = s.asset_id
       WHERE s.license_id = ? ORDER BY s.id`
    )
    .all(id) as any[];
  const users = db.query("SELECT id, name FROM users WHERE active = 1 ORDER BY name").all() as any[];
  const assets = db.query("SELECT id, asset_tag AS name FROM assets WHERE status != 'archived' ORDER BY asset_tag").all() as any[];
  const masked = l.product_key ? l.product_key.replace(/.(?=.{4})/g, "•") : "";
  const info = `<table>
<tr><th style="width:160px">Name</th><td>${esc(l.name)}</td></tr>
<tr><th>Manufacturer</th><td>${esc(l.manufacturer ?? "")}</td></tr>
<tr><th>Product key</th><td><span style="display:none">${esc(l.product_key ?? "")}</span><button type="button" class="btn sec sm" onclick="this.previousElementSibling.style.display='inline';this.remove()">${esc(masked || "Reveal")}</button></td></tr>
<tr><th>Purchased</th><td>${esc(l.purchase_date ?? "")}${l.purchase_cost ? ` · ${l.purchase_cost}` : ""}</td></tr>
<tr><th>Expires</th><td>${esc(l.expires ?? "")}</td></tr>
<tr><th>Notes</th><td>${esc(l.notes ?? "")}</td></tr>
</table>`;
  const assign =
    canEdit && seats.length < l.seats
      ? `<form method="post" action="/licenses/${id}/assign" style="display:flex;gap:8px;align-items:end" class="no-print">
<div style="flex:1"><label style="font-size:12px;font-weight:600">User</label><select name="user_id"><option value="">—</option>${opt(users, "")}</select></div>
<div style="flex:1"><label style="font-size:12px;font-weight:600">or Asset</label><select name="asset_id"><option value="">—</option>${opt(assets, "")}</select></div>
<button class="btn">Assign seat</button></form>`
      : "";
  const seatRows = seats
    .map(
      (s) => `<tr><td>${esc(s.uname ?? "")}</td><td>${esc(s.asset_tag ?? "")}</td><td>${esc(s.assigned_at)}</td>
<td>${canEdit ? `<form class="inline" method="post" action="/licenses/${id}/release/${s.id}"><button class="btn sec sm">Release</button></form>` : ""}</td></tr>`
    )
    .join("");
  const body = `<h1>${esc(l.name)}</h1>
${seatStats(l.seats,seats.length)}<div class="card">${info}</div>
${canEdit ? `<div class="toolbar no-print"><a class="btn sec sm" href="/licenses/${id}/edit">Edit</a>
${inlineConfirm(`license-${id}`,`/licenses/${id}/delete`,"Delete license","Delete this license?",user.csrfToken)}</div>` : ""}
<h2>Seats</h2>
<div class="card">${assign}
<table style="margin-top:10px"><tr><th>User</th><th>Asset</th><th>Assigned</th><th></th></tr>${seatRows}</table></div>${attachmentList("license",id,canEdit)}${entityTimeline("license",id)}`;
  return layout(user, l.name, body, "/licenses", url.searchParams.get("m") || "");
}

export function licenseEditPage(user: User, id: string): Response {
  const l = db.query("SELECT * FROM licenses WHERE id = ?").get(id) as any;
  if (!l) return layout(user, "Not found", "<h1>License not found</h1>", "/licenses");
  return layout(
    user,
    `Edit ${l.name}`,
    `<h1>Edit license</h1><div class="card"><form method="post" action="/licenses/${id}">${licenseForm(l)}
<button class="btn">Save</button> <a class="btn sec" href="/licenses/${id}">Cancel</a></form></div>`,
    "/licenses"
  );
}

export async function licenseUpdate(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  db.run(
    "UPDATE licenses SET name=?, product_key=?, seats=?, manufacturer_id=?, category_id=?, purchase_date=?, purchase_cost=?, expires=?, notes=? WHERE id=?",
    [...licenseVals(v), id]
  );
  logActivity(user.id, "update", "license", Number(id), v("name"));
  return redirect(`/licenses/${id}?m=Saved`);
}

export function licenseDelete(user: User, id: string): Response {
  const l = db.query("SELECT name FROM licenses WHERE id = ?").get(id) as any;
  db.run("DELETE FROM licenses WHERE id = ?", [id]);
  logActivity(user.id, "delete", "license", Number(id), l?.name || "");
  return redirect("/licenses?m=License deleted");
}

export async function licenseAssign(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  const l = db
    .query("SELECT l.seats, (SELECT COUNT(*) FROM license_seats s WHERE s.license_id = l.id) AS used FROM licenses l WHERE l.id = ?")
    .get(id) as any;
  if (!l || l.used >= l.seats) return redirect(`/licenses/${id}?m=${encodeURIComponent("No seats available.")}`);
  if (!v("user_id") && !v("asset_id")) return redirect(`/licenses/${id}?m=${encodeURIComponent("Pick a user or an asset.")}`);
  db.run("INSERT INTO license_seats (license_id, user_id, asset_id) VALUES (?,?,?)", [
    id,
    v("user_id") || null,
    v("asset_id") || null,
  ]);
  logActivity(user.id, "checkout", "license", Number(id), "seat assigned");
  return redirect(`/licenses/${id}?m=Seat assigned`);
}

export function licenseRelease(user: User, id: string, seatId: string): Response {
  db.run("DELETE FROM license_seats WHERE id = ? AND license_id = ?", [seatId, id]);
  logActivity(user.id, "checkin", "license", Number(id), "seat released");
  return redirect(`/licenses/${id}?m=Seat released`);
}
export const licenseImportPage=(user:User,url:URL)=>inventoryImportPage(user,url,importConfig);
export const licenseImportTemplate=()=>inventoryImportTemplate(importConfig);
export const licenseImport=(user:User,req:Request)=>inventoryImport(user,req,importConfig);

import { db, logActivity } from "./db";
import type { User } from "./auth";
import { emptyState, esc, formVals, inlineConfirm, layout, opt, redirect } from "./web";
import { inventoryImport,inventoryImportPage,inventoryImportTemplate,namedId,nonnegativeInt,numberValue,textValue,type ImportConfig } from "./csv";

const importConfig:ImportConfig={entity:"accessory",path:"accessories",columns:[
  {header:"name",db:"name",value:textValue,default:""},{header:"category",db:"category_id",value:x=>namedId("categories",x),default:null},{header:"manufacturer",db:"manufacturer_id",value:x=>namedId("manufacturers",x),default:null},{header:"supplier",db:"supplier_id",value:x=>namedId("suppliers",x),default:null},{header:"location",db:"location_id",value:x=>namedId("locations",x),default:null},{header:"qty",db:"qty",value:nonnegativeInt,default:0},{header:"min_qty",db:"min_qty",value:nonnegativeInt,default:0},{header:"cost",db:"cost",value:numberValue,default:null},{header:"notes",db:"notes",value:textValue,default:null},
]};

function options(table: string, selected: any, type = ""): string {
  const where = type ? " WHERE ctype = ?" : "";
  return opt(db.query(`SELECT id, name FROM ${table}${where} ORDER BY name`).all(...(type ? [type] : [])) as any[], selected);
}

function form(a: any = {}): string {
  return `<div class="frm">
<div><label>Name *</label><input name="name" value="${esc(a.name || "")}" required></div>
<div><label>Category</label><select name="category_id"><option value="">—</option>${options("categories", a.category_id, "accessory")}</select></div>
<div><label>Manufacturer</label><select name="manufacturer_id"><option value="">—</option>${options("manufacturers", a.manufacturer_id)}</select></div>
<div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${options("suppliers", a.supplier_id)}</select></div>
<div><label>Location</label><select name="location_id"><option value="">—</option>${options("locations", a.location_id)}</select></div>
<div><label>Total quantity</label><input type="number" min="0" name="qty" value="${esc(a.qty ?? 0)}"></div>
<div><label>Min. available</label><input type="number" min="0" name="min_qty" value="${esc(a.min_qty ?? 0)}"></div>
<div><label>Unit cost</label><input type="number" step="0.01" name="cost" value="${esc(a.cost || "")}"></div></div>
<div style="margin-bottom:14px"><label>Notes</label><textarea name="notes">${esc(a.notes || "")}</textarea></div>`;
}
function vals(v: (k: string) => string): any[] {
  const n = (k: string) => v(k) || null;
  return [v("name"), n("category_id"), n("manufacturer_id"), n("supplier_id"), n("location_id"), Math.max(0, Number(v("qty")) || 0), Math.max(0, Number(v("min_qty")) || 0), n("cost"), n("notes")];
}
function stockStats(total:any, left:any):string{const t=Number(total||0),l=Number(left||0),u=Math.max(0,t-l);return `<div class="stats"><div class="stat"><div class="n">${t}</div><div class="l">Total</div></div><div class="stat"><div class="n">${u}</div><div class="l">Used</div></div><div class="stat"><div class="n">${l}</div><div class="l">Left</div></div></div>`;}

export function list(user: User, url: URL, canEdit: boolean): Response {
  const rows = db.query(`SELECT a.*, c.name category, l.name location,
    a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id AND x.checked_in_at IS NULL) available
    FROM accessories a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN locations l ON l.id=a.location_id ORDER BY a.name`).all() as any[];
  const body = `<h1>Accessories <span class="muted">(${rows.length})</span></h1><div class="toolbar">${canEdit ? '<a class="btn" href="/accessories/new">+ New accessory</a> <a class="btn sec" href="/accessories/import">Import CSV</a>' : ""}</div>
${rows.length===0?emptyState("No accessories found","Create your first accessory to start tracking checked-out stock.",canEdit?'<a class="btn" href="/accessories/new">+ New accessory</a>':""):`<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Category</th><th>Location</th><th>Total</th><th>Used</th><th>Left</th></tr>
${rows.map((a) => `<tr data-href="/accessories/${a.id}"><td><a href="/accessories/${a.id}">${esc(a.name)}</a></td><td>${esc(a.category || "")}</td><td>${esc(a.location || "")}</td><td>${a.qty}</td><td>${Math.max(0,Number(a.qty)-Number(a.available))}</td><td>${a.available}${a.available <= a.min_qty ? ' <span class="badge b-red">low</span>' : ""}</td></tr>`).join("")}</table></div>`}`;
  return layout(user, "Accessories", body, "/accessories", url.searchParams.get("m") || "");
}
export function newPage(user: User): Response {
  return layout(user, "New accessory", `<h1>New accessory</h1><div class="card"><form method="post" action="/accessories">${form()}<button class="btn">Create</button></form></div>`, "/accessories");
}
export async function create(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  const r = db.run("INSERT INTO accessories(name,category_id,manufacturer_id,supplier_id,location_id,qty,min_qty,cost,notes) VALUES(?,?,?,?,?,?,?,?,?)", vals(v));
  logActivity(user.id, "create", "accessory", Number(r.lastInsertRowid), v("name"));
  return redirect(`/accessories/${r.lastInsertRowid}?m=Accessory created`);
}
export function detail(user: User, id: string, url: URL, canEdit: boolean): Response {
  const a = db.query(`SELECT a.*, c.name category, m.name manufacturer, s.name supplier, l.name location,
    a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id AND x.checked_in_at IS NULL) available
    FROM accessories a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN manufacturers m ON m.id=a.manufacturer_id
    LEFT JOIN suppliers s ON s.id=a.supplier_id LEFT JOIN locations l ON l.id=a.location_id WHERE a.id=?`).get(id) as any;
  if (!a) return layout(user, "Not found", "<h1>Accessory not found</h1>", "/accessories");
  const checkouts = db.query("SELECT x.id,x.at,x.note,u.name FROM accessory_checkouts x JOIN users u ON u.id=x.user_id WHERE x.accessory_id=? AND x.checked_in_at IS NULL ORDER BY x.id").all(id) as any[];
  const users = db.query("SELECT id,name FROM users WHERE active=1 ORDER BY name").all() as any[];
  const body = `<h1>${esc(a.name)}</h1>${stockStats(a.qty,a.available)}<div class="card"><table><tr><th>Category</th><td>${esc(a.category || "")}</td></tr><tr><th>Manufacturer</th><td>${esc(a.manufacturer || "")}</td></tr><tr><th>Supplier</th><td>${esc(a.supplier || "")}</td></tr><tr><th>Location</th><td>${esc(a.location || "")}</td></tr><tr><th>Notes</th><td>${esc(a.notes || "")}</td></tr></table></div>
${canEdit ? `<div class="card">${a.available > 0 ? `<form method="post" action="/accessories/${esc(id)}/checkout" style="display:flex;gap:8px;align-items:end"><div style="flex:1"><label>User</label><select name="user_id" required><option value="">Select user…</option>${opt(users, "")}</select></div><div style="flex:1"><label>Note</label><input name="note"></div><button class="btn">Check out</button></form>` : '<span class="badge b-red">No units available</span>'}<div style="margin-top:12px"><a class="btn sec sm" href="/accessories/${esc(id)}/edit">Edit</a> ${inlineConfirm(`accessory-${id}`,`/accessories/${id}/delete`,"Delete accessory","Delete this accessory?",user.csrfToken)}</div></div>` : ""}
<h2>Checked out</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>User</th><th>When</th><th>Note</th><th></th></tr>${checkouts.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.at)}</td><td>${esc(x.note || "")}</td><td>${canEdit ? `<form method="post" class="inline" action="/accessory-checkouts/${x.id}/return"><button class="btn sec sm">Return</button></form>` : ""}</td></tr>`).join("")}</table></div>`;
  return layout(user, a.name, body, "/accessories", url.searchParams.get("m") || "");
}
export function editPage(user: User, id: string): Response {
  const a = db.query("SELECT * FROM accessories WHERE id=?").get(id) as any;
  return a ? layout(user, "Edit accessory", `<h1>Edit accessory</h1><div class="card"><form method="post" action="/accessories/${id}">${form(a)}<button class="btn">Save</button></form></div>`, "/accessories") : layout(user, "Not found", "<h1>Not found</h1>");
}
export async function update(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  const used = (db.query("SELECT COUNT(*) n FROM accessory_checkouts WHERE accessory_id=? AND checked_in_at IS NULL").get(id) as any)?.n || 0;
  const x = vals(v); x[5] = Math.max(used, x[5]);
  db.run("UPDATE accessories SET name=?,category_id=?,manufacturer_id=?,supplier_id=?,location_id=?,qty=?,min_qty=?,cost=?,notes=? WHERE id=?", [...x,id]);
  logActivity(user.id, "update", "accessory", Number(id), v("name"));
  return redirect(`/accessories/${id}?m=Saved`);
}
export function remove(user: User, id: string): Response {
  const a = db.query("SELECT name FROM accessories WHERE id=?").get(id) as any;
  db.run("DELETE FROM accessories WHERE id=?", [id]); logActivity(user.id, "delete", "accessory", Number(id), a?.name || "");
  return redirect("/accessories?m=Deleted");
}
export async function checkout(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  let ok = false;
  db.transaction(() => {
    const a = db.query("SELECT qty-(SELECT COUNT(*) FROM accessory_checkouts WHERE accessory_id=? AND checked_in_at IS NULL) available FROM accessories WHERE id=?").get(id,id) as any;
    const target = db.query("SELECT name FROM users WHERE id=? AND active=1").get(v("user_id")) as any;
    if (!a || a.available <= 0 || !target) return;
    db.run("INSERT INTO accessory_checkouts(accessory_id,user_id,note) VALUES(?,?,?)",[id,v("user_id"),v("note") || null]);
    logActivity(user.id,"checkout","accessory",Number(id),`to ${target.name}${v("note") ? ` - ${v("note")}` : ""}`); ok=true;
  })();
  return redirect(`/accessories/${id}?m=${encodeURIComponent(ok ? "Checked out" : "No units available")}`);
}
export function checkin(user: User, id: string, checkoutId: string): Response {
  return accessoryReturn(user,checkoutId);
}
export function accessoryReturn(user:User,id:string):Response{const x=db.query("SELECT * FROM accessory_checkouts WHERE id=? AND checked_in_at IS NULL").get(id) as any;if(!x)return redirect("/accessories?m=Checkout not found or already returned");try{db.transaction(()=>{const r=db.run("UPDATE accessory_checkouts SET checked_in_at=datetime('now'),checked_in_by=? WHERE id=? AND checked_in_at IS NULL",[user.id,id]);if(!r.changes)throw new Error("already returned");})();}catch{return redirect(`/accessories/${x.accessory_id}?m=Already returned`);}logActivity(user.id,"return","accessory",x.accessory_id,`returned by ${user.name}`);return redirect(`/accessories/${x.accessory_id}?m=Accessory returned`);}
export const accessoryImportPage=(user:User,url:URL)=>inventoryImportPage(user,url,importConfig);
export const accessoryImportTemplate=()=>inventoryImportTemplate(importConfig);
export const accessoryImport=(user:User,req:Request)=>inventoryImport(user,req,importConfig);

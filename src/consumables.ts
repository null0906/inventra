import { db, logActivity } from "./db";
import type { User } from "./auth";
import { emptyState, esc, formVals, inlineConfirm, layout, opt, redirect } from "./web";
import { flushAsync, queueAdmins } from "./email";
import { inventoryImport,inventoryImportPage,inventoryImportTemplate,namedId,nonnegativeInt,numberValue,textValue,type ImportConfig } from "./csv";
const importConfig:ImportConfig={entity:"consumable",path:"consumables",columns:[{header:"name",db:"name",value:textValue,default:""},{header:"category",db:"category_id",value:x=>namedId("categories",x),default:null},{header:"location",db:"location_id",value:x=>namedId("locations",x),default:null},{header:"qty",db:"qty",value:nonnegativeInt,default:0},{header:"min_qty",db:"min_qty",value:nonnegativeInt,default:0},{header:"cost",db:"cost",value:numberValue,default:null}]};
function stockStats(total:any,used:any,left:any):string{return `<div class="stats"><div class="stat"><div class="n">${Number(total||0)}</div><div class="l">Total</div></div><div class="stat"><div class="n">${Number(used||0)}</div><div class="l">Used</div></div><div class="stat"><div class="n">${Number(left||0)}</div><div class="l">Left</div></div></div>`;}

function consumableForm(c: any = {}): string {
  const cats = db.query("SELECT id, name FROM categories WHERE ctype = 'consumable' ORDER BY name").all() as any[];
  const locs = db.query("SELECT id, name FROM locations ORDER BY name").all() as any[];
  return `<div class="frm">
<div><label>Name *</label><input name="name" value="${esc(c.name ?? "")}" required></div>
<div><label>Category</label><select name="category_id"><option value="">—</option>${opt(cats, c.category_id)}</select></div>
<div><label>Location</label><select name="location_id"><option value="">—</option>${opt(locs, c.location_id)}</select></div>
<div><label>Quantity</label><input name="qty" type="number" value="${esc(c.qty ?? 0)}"></div>
<div><label>Min. quantity</label><input name="min_qty" type="number" value="${esc(c.min_qty ?? 0)}"></div>
<div><label>Unit cost</label><input name="cost" type="number" step="0.01" value="${esc(c.cost ?? "")}"></div>
</div>`;
}

export function consumablesPage(user: User, url: URL, canEdit: boolean): Response {
  const rows = db
    .query(
      `SELECT c.*, cat.name AS category, l.name AS location
        ,COALESCE((SELECT SUM(co.qty) FROM consumable_checkouts co WHERE co.consumable_id=c.id AND co.checked_in_at IS NULL),0) checked_out
       FROM consumables c LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN locations l ON l.id = c.location_id ORDER BY c.name`
    )
    .all() as any[];
  const body = `<h1>Consumables <span class="muted">(${rows.length})</span></h1>
<div class="toolbar">${canEdit ? `<a class="btn" href="/consumables/new">+ New consumable</a> <a class="btn sec" href="/consumables/import">Import CSV</a>` : ""}</div>
${rows.length===0?emptyState("No consumables found","Create your first consumable to start tracking stock movement.",canEdit?'<a class="btn" href="/consumables/new">+ New consumable</a>':""):`<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr><th>Name</th><th>Category</th><th>Location</th><th>Total</th><th>Used</th><th>Left</th>${canEdit ? "<th>Adjust</th><th></th>" : ""}</tr>
${rows
  .map(
    (c) => `<tr data-href="/consumables/${c.id}"><td><a href="/consumables/${c.id}">${esc(c.name)}</a></td><td>${esc(c.category ?? "")}</td><td>${esc(c.location ?? "")}</td>
<td>${Number(c.qty)+Number(c.checked_out||0)}</td><td>${Number(c.checked_out||0)}</td><td>${c.qty}${c.qty <= c.min_qty ? ' <span class="badge b-red">low</span>' : ""} <span class="muted">(min ${c.min_qty})</span></td>
${
  canEdit
    ? `<td><form class="inline" method="post" action="/consumables/${c.id}/adjust" style="display:flex;gap:6px">
<input name="delta" type="number" value="-1" style="width:70px"><input name="note" placeholder="note" style="width:110px"><button class="btn sec sm">Apply</button></form></td>
<td style="white-space:nowrap"><a class="btn sec sm" href="/consumables/${c.id}/edit">Edit</a>
${inlineConfirm(`consumable-${c.id}`,`/consumables/${c.id}/delete`,"Delete consumable","Delete this consumable?",user.csrfToken)}</td>`
    : ""
}</tr>`
  )
  .join("")}
</table></div>`}`;
  return layout(user, "Consumables", body, "/consumables", url.searchParams.get("m") || "");
}

export function consumableNewPage(user: User): Response {
  return layout(
    user,
    "New consumable",
    `<h1>New consumable</h1><div class="card"><form method="post" action="/consumables">${consumableForm()}
<button class="btn">Create</button> <a class="btn sec" href="/consumables">Cancel</a></form></div>`,
    "/consumables"
  );
}

export function consumableDetail(user:User,id:string,url:URL,canEdit:boolean):Response{
  const c=db.query(`SELECT c.*,cat.name category,l.name location,COALESCE((SELECT SUM(co.qty) FROM consumable_checkouts co WHERE co.consumable_id=c.id AND co.checked_in_at IS NULL),0) checked_out FROM consumables c LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN locations l ON l.id=c.location_id WHERE c.id=?`).get(id) as any;
  if(!c)return layout(user,"Not found","<h1>Consumable not found</h1>","/consumables");
  const active=db.query(`SELECT co.*,u.name user_name FROM consumable_checkouts co JOIN users u ON u.id=co.user_id WHERE co.consumable_id=? AND co.checked_in_at IS NULL ORDER BY co.id DESC`).all(id) as any[];
  const users=canEdit?db.query("SELECT id,name FROM users WHERE active=1 ORDER BY name").all() as any[]:[];
  const checkout=canEdit?`<div class="card"><form method="post" action="/consumables/${esc(id)}/checkout"><div class="frm"><div><label>User</label><select name="user_id" required><option value="">—</option>${opt(users,"")}</select></div><div><label>Quantity</label><input name="qty" type="number" min="1" value="1" required></div><div><label>Note</label><input name="note"></div></div><button class="btn">Check out</button></form></div>`:"";
  const rows=active.map(co=>`<tr><td>${esc(co.user_name)}</td><td>${co.qty}</td><td>${esc(co.note||"")}</td><td>${esc(co.checked_out_at)}</td><td>${canEdit?`<form method="post" action="/consumable-checkouts/${co.id}/checkin"><button class="btn sec sm">Check in</button></form>`:""}</td></tr>`).join("");
  return layout(user,c.name,`<h1>${esc(c.name)}</h1>${stockStats(Number(c.qty)+Number(c.checked_out||0),c.checked_out,c.qty)}<div class="card"><table><tr><th>Category</th><td>${esc(c.category||"")}</td></tr><tr><th>Location</th><td>${esc(c.location||"")}</td></tr><tr><th>Minimum</th><td>${c.min_qty}</td></tr><tr><th>Unit cost</th><td>${esc(c.cost||"")}</td></tr></table></div>${checkout}<h2>Active checkouts</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>User</th><th>Qty</th><th>Note</th><th>Checked out</th><th></th></tr>${rows}</table></div>`,"/consumables",url.searchParams.get("m")||"");
}

function consumableVals(v: (k: string) => string): any[] {
  const n = (k: string) => (v(k) === "" ? null : v(k));
  return [v("name"), n("category_id"), n("location_id"), Number(v("qty") || 0), Number(v("min_qty") || 0), n("cost")];
}

export async function consumableCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  const r = db.run(
    "INSERT INTO consumables (name, category_id, location_id, qty, min_qty, cost) VALUES (?,?,?,?,?,?)",
    consumableVals(v)
  );
  logActivity(user.id, "create", "consumable", Number(r.lastInsertRowid), v("name"));
  return redirect("/consumables?m=Consumable created");
}

export function consumableEditPage(user: User, id: string): Response {
  const c = db.query("SELECT * FROM consumables WHERE id = ?").get(id) as any;
  if (!c) return layout(user, "Not found", "<h1>Not found</h1>", "/consumables");
  return layout(
    user,
    `Edit ${c.name}`,
    `<h1>Edit consumable</h1><div class="card"><form method="post" action="/consumables/${esc(id)}">${consumableForm(c)}
<button class="btn">Save</button> <a class="btn sec" href="/consumables">Cancel</a></form></div>`,
    "/consumables"
  );
}

export async function consumableUpdate(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  db.run("UPDATE consumables SET name=?, category_id=?, location_id=?, qty=?, min_qty=?, cost=? WHERE id=?", [
    ...consumableVals(v),
    id,
  ]);
  logActivity(user.id, "update", "consumable", Number(id), v("name"));
  return redirect("/consumables?m=Saved");
}

export function consumableDelete(user: User, id: string): Response {
  const c = db.query("SELECT name FROM consumables WHERE id = ?").get(id) as any;
  db.run("DELETE FROM consumables WHERE id = ?", [id]);
  logActivity(user.id, "delete", "consumable", Number(id), c?.name || "");
  return redirect("/consumables?m=Deleted");
}

export async function consumableAdjust(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  const delta = Number(v("delta") || 0);
  const c = db.query("SELECT name, qty, min_qty FROM consumables WHERE id = ?").get(id) as any;
  if (!c || !delta) return redirect("/consumables");
  const newQty = Math.max(0, c.qty + delta);
  db.run("UPDATE consumables SET qty = ? WHERE id = ?", [newQty, id]);
  logActivity(user.id, delta < 0 ? "consume" : "restock", "consumable", Number(id), `${c.name}: ${delta > 0 ? "+" : ""}${delta} → ${newQty}${v("note") ? ` — ${v("note")}` : ""}`);
  if(c.min_qty>0&&newQty<=c.min_qty){queueAdmins(`Low stock alert — ${c.name}`,`Consumable "${c.name}" is low.\nCurrent quantity: ${newQty}\nMinimum quantity: ${c.min_qty}\n\nInventra`);flushAsync();}
  return redirect(`/consumables?m=${encodeURIComponent(`${c.name} updated to ${newQty}`)}`);
}

export async function consumableCheckout(user:User,id:string,req:Request):Promise<Response>{
  const v=await formVals(req),qty=Number(v("qty")),target=db.query("SELECT id,name FROM users WHERE id=? AND active=1").get(v("user_id")) as any;
  if(!Number.isInteger(qty)||qty<1)return redirect(`/consumables/${id}?m=Invalid quantity`);
  if(!target)return redirect(`/consumables/${id}?m=Select an active user`);
  try{db.transaction(()=>{const r=db.run("UPDATE consumables SET qty=qty-? WHERE id=? AND qty>=?",[qty,id,qty]);if(!r.changes)throw new Error("insufficient");db.run("INSERT INTO consumable_checkouts(consumable_id,user_id,qty,note) VALUES(?,?,?,?)",[id,target.id,qty,v("note")||null]);})();}catch{return redirect(`/consumables/${id}?m=Insufficient stock`);}
  logActivity(user.id,"checkout","consumable",Number(id),`${qty} to ${target.name}`);return redirect(`/consumables/${id}?m=Consumable checked out`);
}

export function consumableCheckin(user:User,checkoutId:string):Response{
  const co=db.query("SELECT * FROM consumable_checkouts WHERE id=? AND checked_in_at IS NULL").get(checkoutId) as any;if(!co)return redirect("/consumables?m=Checkout not found or already checked in");
  try{db.transaction(()=>{const r=db.run("UPDATE consumable_checkouts SET checked_in_at=datetime('now'),checked_in_by=? WHERE id=? AND checked_in_at IS NULL",[user.id,checkoutId]);if(!r.changes)throw new Error("checked in");db.run("UPDATE consumables SET qty=qty+? WHERE id=?",[co.qty,co.consumable_id]);})();}catch{return redirect(`/consumables/${co.consumable_id}?m=Already checked in`);}
  logActivity(user.id,"checkin","consumable",co.consumable_id,`${co.qty} returned`);return redirect(`/consumables/${co.consumable_id}?m=Consumable checked in`);
}
export const consumableImportPage=(user:User,url:URL)=>inventoryImportPage(user,url,importConfig);
export const consumableImportTemplate=()=>inventoryImportTemplate(importConfig);
export const consumableImport=(user:User,req:Request)=>inventoryImport(user,req,importConfig);

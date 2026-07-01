import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, redirect } from "./web";

export function currentValue(a: any): number | null {
  if (a.purchase_cost == null || a.depreciation_id == null || !a.dep_months) return null;
  let age = 0;
  if (a.purchase_date) {
    const bought = new Date(`${a.purchase_date}T00:00:00Z`);
    const now = new Date();
    age = (now.getUTCFullYear() - bought.getUTCFullYear()) * 12 + now.getUTCMonth() - bought.getUTCMonth();
    if (now.getUTCDate() < bought.getUTCDate()) age--;
    age = Math.max(0, age);
  }
  const floor = Number(a.floor_value || 0);
  return Math.max(floor, Number(a.purchase_cost) - (Number(a.purchase_cost) - floor) * (age / Number(a.dep_months)));
}

function form(d: any = {}): string {
  return `<div class="frm"><div><label>Name *</label><input name="name" value="${esc(d.name || "")}" required></div>
<div><label>Duration in months *</label><input name="months" type="number" min="1" value="${esc(d.months || "")}" required></div>
<div><label>Minimum retained value</label><input name="floor_value" type="number" min="0" step="0.01" value="${esc(d.floor_value ?? 0)}"></div></div>`;
}

export function list(user: User, url: URL): Response {
  const rows = db.query(`SELECT d.*, (SELECT COUNT(*) FROM models m WHERE m.depreciation_id=d.id) model_count
    FROM depreciation d ORDER BY d.name`).all() as any[];
  return layout(user, "Depreciation", `<h1>Depreciation schedules</h1><div class="toolbar"><a class="btn" href="/depreciation/new">+ New schedule</a></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Months</th><th>Minimum value</th><th>Models</th><th></th></tr>
${rows.map(d=>`<tr><td>${esc(d.name)}</td><td>${d.months}</td><td>${Number(d.floor_value).toFixed(2)}</td><td>${d.model_count}</td><td><a class="btn sec sm" href="/depreciation/${d.id}/edit">Edit</a> <form class="inline" method="post" action="/depreciation/${d.id}/delete"><button class="btn danger sm">Delete</button></form></td></tr>`).join("")}</table></div>`,
  "/depreciation", url.searchParams.get("m") || "");
}
export function newPage(user: User): Response {
  return layout(user, "New depreciation schedule", `<h1>New depreciation schedule</h1><div class="card"><form method="post" action="/depreciation">${form()}<button class="btn">Create</button></form></div>`, "/depreciation");
}
export async function create(user: User, req: Request): Promise<Response> {
  const v=await formVals(req), months=Number(v("months")), floor=Math.max(0,Number(v("floor_value"))||0);
  if (!v("name") || !Number.isInteger(months) || months <= 0) return redirect("/depreciation/new?m=Enter a valid name and duration");
  const r=db.run("INSERT INTO depreciation(name,months,floor_value) VALUES(?,?,?)",[v("name"),months,floor]);
  logActivity(user.id,"create","depreciation",Number(r.lastInsertRowid),`Created depreciation schedule: ${v("name")}`);
  return redirect("/depreciation?m=Schedule created");
}
export function editPage(user: User, id: string): Response {
  const d=db.query("SELECT * FROM depreciation WHERE id=?").get(id) as any;
  return d ? layout(user,"Edit depreciation schedule",`<h1>Edit depreciation schedule</h1><div class="card"><form method="post" action="/depreciation/${id}/edit">${form(d)}<button class="btn">Save</button></form></div>`,"/depreciation") : layout(user,"Not found","<h1>Schedule not found</h1>","/depreciation");
}
export async function update(user: User,id:string,req:Request):Promise<Response>{
  const v=await formVals(req),months=Number(v("months")),floor=Math.max(0,Number(v("floor_value"))||0);
  if(!v("name")||!Number.isInteger(months)||months<=0)return redirect(`/depreciation/${id}/edit?m=Enter a valid name and duration`);
  const d=db.query("SELECT id FROM depreciation WHERE id=?").get(id); if(!d)return redirect("/depreciation?m=Schedule not found");
  db.run("UPDATE depreciation SET name=?,months=?,floor_value=? WHERE id=?",[v("name"),months,floor,id]);
  logActivity(user.id,"update","depreciation",Number(id),`Updated depreciation schedule: ${v("name")}`);
  return redirect("/depreciation?m=Schedule updated");
}
export function remove(user:User,id:string):Response{
  const d=db.query("SELECT name FROM depreciation WHERE id=?").get(id) as any;if(!d)return redirect("/depreciation?m=Schedule not found");
  const used=(db.query("SELECT COUNT(*) n FROM models WHERE depreciation_id=?").get(id) as any).n;
  if(used)return redirect("/depreciation?m=Cannot delete a schedule assigned to models");
  db.run("DELETE FROM depreciation WHERE id=?",[id]);logActivity(user.id,"delete","depreciation",Number(id),`Deleted depreciation schedule: ${d.name}`);
  return redirect("/depreciation?m=Schedule deleted");
}

function cell(value: unknown, guard=false): string {
  let s=String(value ?? "");
  if(guard && /^[=+\-@]/.test(s))s=`'${s}`;
  return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
}
export function csvReport():Response{
  const rows=db.query(`SELECT a.asset_tag,a.name asset_name,m.name model,c.name category,a.purchase_date,a.purchase_cost,
    d.id depreciation_id,d.name schedule,d.months dep_months,d.floor_value
    FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN categories c ON c.id=m.category_id
    LEFT JOIN depreciation d ON d.id=m.depreciation_id WHERE a.purchase_cost IS NOT NULL ORDER BY a.asset_tag`).all() as any[];
  const header=["Asset Tag","Asset Name","Model","Category","Purchase Date","Purchase Cost","Depreciation Schedule","Months","Floor Value","Current Value","Fully Depreciated"];
  const lines=rows.map(r=>{const value=currentValue(r);return [
    cell(r.asset_tag,true),cell(r.asset_name,true),cell(r.model,true),cell(r.category,true),cell(r.purchase_date),cell(r.purchase_cost),
    cell(r.schedule,true),cell(r.dep_months),cell(r.floor_value),cell(value==null?"—":value.toFixed(2)),cell(value==null?"—":value<=Number(r.floor_value)?"Yes":"No")
  ].join(",")});
  return new Response([header.join(","),...lines].join("\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="depreciation.csv"'}});
}

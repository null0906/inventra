import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, opt, pager, redirect } from "./web";
import { itemsPerPage } from "./settings";

const TYPES=["repair","upgrade","preventive","test","pat_test","software_support","hardware_support","other"];
function record(id:string):any{return db.query(`SELECT x.*,a.asset_tag,a.status asset_status FROM maintenance x JOIN assets a ON a.id=x.asset_id WHERE x.id=?`).get(id) as any;}
function form(a:any,m:any={}):string{
  const suppliers=db.query("SELECT id,name FROM suppliers ORDER BY name").all() as any[];
  return `<div class="card"><p style="margin-bottom:14px"><strong>Asset:</strong> ${esc(a.asset_tag)} &nbsp; <strong>Current status:</strong> ${esc(a.asset_status||a.status)}</p>
<div class="frm"><div><label>Maintenance type *</label><select name="type">${TYPES.map(t=>`<option value="${esc(t)}"${m.type===t?" selected":""}>${esc(t.replaceAll("_"," "))}</option>`).join("")}</select></div>
<div><label>Title *</label><input name="title" value="${esc(m.title||"")}" required></div>
<div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${opt(suppliers,m.supplier_id)}</select></div>
<div><label>Cost</label><input type="number" step="0.01" name="cost" value="${esc(m.cost??"")}"></div>
<div><label>Start date *</label><input type="date" name="start_date" value="${esc(m.start_date||"")}" required></div>
<div><label>Completion date</label><input type="date" name="completion_date" value="${esc(m.completion_date||"")}"></div></div>
<div style="margin-bottom:14px"><label>Notes</label><textarea name="notes" rows="3">${esc(m.notes||"")}</textarea></div>`;
}
function vals(v:(k:string)=>string):any[]{const type=TYPES.includes(v("type"))?v("type"):"other";return [type,v("title"),v("supplier_id")||null,v("cost")||null,v("notes")||null,v("start_date"),v("completion_date")||null];}
function rowsHtml(rows:any[],canEdit:boolean):string{return `<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Asset</th><th>Type</th><th>Title</th><th>Started</th><th>Completed</th><th>Cost</th><th></th></tr>${rows.map(m=>`<tr><td><a href="/assets/${m.asset_id}">${esc(m.asset_tag)}</a></td><td>${esc(m.type.replaceAll("_"," "))}</td><td>${esc(m.title)}</td><td>${esc(m.start_date)}</td><td>${m.completed?esc(m.completion_date||"yes"):'<span class="badge b-amber">open</span>'}</td><td>${m.cost==null?"":Number(m.cost).toFixed(2)}</td><td>${canEdit?`<a class="btn sec sm" href="/maintenance/${m.id}/edit">Edit</a> ${m.completed?"":`<form class="inline" method="post" action="/maintenance/${m.id}/complete"><button class="btn sm">Complete</button></form>`} <form class="inline" method="post" action="/maintenance/${m.id}/delete"><button class="btn danger sm">Delete</button></form>`:""}</td></tr>`).join("")}</table></div>`;}

export function list(user:User,url:URL):Response{
  const size=itemsPerPage(),page=Math.max(1,Number(url.searchParams.get("page"))||1);
  const total=(db.query("SELECT COUNT(*) n FROM maintenance").get() as any).n;
  const rows=db.query(`SELECT x.*,a.asset_tag FROM maintenance x JOIN assets a ON a.id=x.asset_id ORDER BY x.id DESC LIMIT ? OFFSET ?`).all(size,(page-1)*size) as any[];
  return layout(user,"Maintenance",`<h1>Maintenance records <span class="muted">(${total})</span></h1>${rowsHtml(rows,true)}${pager(url,page,total,size)}`,"/maintenance",url.searchParams.get("m")||"");
}
export function assetList(user:User,id:string,url:URL,canEdit:boolean):Response{
  const a=db.query("SELECT id,asset_tag FROM assets WHERE id=?").get(id) as any;if(!a)return layout(user,"Not found","<h1>Asset not found</h1>","/assets");
  const rows=db.query(`SELECT x.*,a.asset_tag FROM maintenance x JOIN assets a ON a.id=x.asset_id WHERE x.asset_id=? ORDER BY x.id DESC`).all(id) as any[];
  return layout(user,"Asset maintenance",`<h1>Maintenance for ${esc(a.asset_tag)}</h1><div class="toolbar">${canEdit?`<a class="btn" href="/assets/${esc(id)}/maintenance/new">+ Log maintenance</a>`:""}<a class="btn sec" href="/assets/${esc(id)}">Back to asset</a></div>${rowsHtml(rows,canEdit)}`,"/assets",url.searchParams.get("m")||"");
}
export function newPage(user:User,id:string):Response{
  const a=db.query("SELECT id,asset_tag,status FROM assets WHERE id=?").get(id) as any;
  return a?layout(user,"Log maintenance",`<h1>Log maintenance</h1><form method="post" action="/assets/${esc(id)}/maintenance">${form(a)}<button class="btn">Create record</button></form>`,"/maintenance"):layout(user,"Not found","<h1>Asset not found</h1>","/assets");
}
export async function create(user:User,id:string,req:Request):Promise<Response>{
  const a=db.query("SELECT id,asset_tag FROM assets WHERE id=?").get(id) as any;if(!a)return redirect("/maintenance?m=Asset not found");
  const v=await formVals(req);if(!v("title")||!v("start_date"))return redirect(`/assets/${id}/maintenance/new?m=Title and start date are required`);
  const r=db.run("INSERT INTO maintenance(asset_id,type,title,supplier_id,cost,notes,start_date,completion_date,completed,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",[id,...vals(v),v("completion_date")?1:0,user.id]);
  logActivity(user.id,"create","maintenance",Number(r.lastInsertRowid),`Maintenance ${TYPES.includes(v("type"))?v("type"):"other"}: ${v("title")} logged on ${a.asset_tag}`);
  return redirect(`/assets/${id}/maintenance?m=Maintenance logged`);
}
export function editPage(user:User,id:string):Response{
  const m=record(id);return m?layout(user,"Edit maintenance",`<h1>Edit maintenance</h1><form method="post" action="/maintenance/${esc(id)}/edit">${form(m,m)}<button class="btn">Save</button></form>`,"/maintenance"):layout(user,"Not found","<h1>Maintenance record not found</h1>","/maintenance");
}
export async function update(user:User,id:string,req:Request):Promise<Response>{
  const m=record(id);if(!m)return redirect("/maintenance?m=Maintenance record not found");
  const v=await formVals(req);if(!v("title")||!v("start_date"))return redirect(`/maintenance/${id}/edit?m=Title and start date are required`);
  const x=vals(v);db.run("UPDATE maintenance SET type=?,title=?,supplier_id=?,cost=?,notes=?,start_date=?,completion_date=?,completed=? WHERE id=?",[...x,v("completion_date")?1:0,id]);
  logActivity(user.id,"update","maintenance",Number(id),`Updated maintenance ${v("title")} on ${m.asset_tag}`);
  return redirect(`/assets/${m.asset_id}/maintenance?m=Maintenance updated`);
}
export function complete(user:User,id:string):Response{
  const m=record(id);if(!m)return redirect("/maintenance?m=Maintenance record not found");
  if(m.completed)return redirect(`/assets/${m.asset_id}/maintenance?m=Maintenance already completed`);
  db.run("UPDATE maintenance SET completed=1,completion_date=COALESCE(completion_date,date('now')) WHERE id=?",[id]);
  logActivity(user.id,"complete","maintenance",Number(id),`Completed maintenance ${m.title} on ${m.asset_tag}`);
  return redirect(`/assets/${m.asset_id}/maintenance?m=Maintenance completed`);
}
export function remove(user:User,id:string):Response{
  const m=record(id);if(!m)return redirect("/maintenance?m=Maintenance record not found");
  db.run("DELETE FROM maintenance WHERE id=?",[id]);logActivity(user.id,"delete","maintenance",Number(id),`Deleted maintenance ${m.title} on ${m.asset_tag}`);
  return redirect(`/assets/${m.asset_id}/maintenance?m=Maintenance deleted`);
}

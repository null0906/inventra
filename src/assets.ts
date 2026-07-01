import { db, logActivity } from "./db";
import type { User } from "./auth";
import { activeChips, badge, emptyState, esc, filterDropdown, formVals, inlineConfirm, layout, opt, pager, redirect, statusBadge } from "./web";
import { getSetting, itemsPerPage } from "./settings";
import { assetInstalled } from "./components";
import { currentValue } from "./depreciation";
import { flushAsync, queue } from "./email";
import { assetCustomMap, customFieldSection, modelFields, saveCustomValues, validateCustomValues } from "./custom_fields";
import { parseCsv } from "./csv";
import { attachmentList } from "./attachments";
import { entityTimeline } from "./misc";
import { createAck } from "./ack";

const STATUSES = ["deployable", "deployed", "maintenance", "archived"];
const FILTER_STATUSES = ["deployable", "deployed", "maintenance", "archived"];
function labelType(status:string):string|null{return status==="deployable"?"deployable":status==="maintenance"?"undeployable":status==="archived"?"archived":null;}
function statusLabelOptions(status:string,selected:any):string{
  const type=labelType(status);if(!type)return "";
  return opt(db.query("SELECT id,name FROM status_labels WHERE type=? ORDER BY name").all(type) as any[],selected);
}
function statusLabelId(status:string,id:string):string|null{
  const type=labelType(status);if(!type||!id)return null;
  const row=db.query("SELECT id FROM status_labels WHERE id=? AND type=?").get(id,type) as any;
  return row?String(row.id):null;
}

function modelOptions(selected: any): string {
  const rows = db
    .query(
      `SELECT m.id, m.name || COALESCE(' (' || mf.name || ')', '') AS name
       FROM models m LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id ORDER BY m.name`
    )
    .all() as any[];
  return opt(rows, selected);
}

function lookupOptions(table: string, selected: any): string {
  if(!new Set(["locations","suppliers","categories","manufacturers","models","depreciation"]).has(table))throw new Error(`Unknown table: ${table}`);
  return opt(db.query(`SELECT id, name FROM ${table} ORDER BY name`).all() as any[], selected);
}

function assetForm(a: any = {}, custom:Record<string,string> = {}): string {
  return `<div class="frm">
<div><label>Asset tag *</label><input name="asset_tag" value="${esc(a.asset_tag ?? "")}" required></div>
<div><label>Serial</label><input name="serial" value="${esc(a.serial ?? "")}"></div>
<div><label>Name</label><input name="name" value="${esc(a.name ?? "")}"></div>
<div><label>Model</label><select name="model_id"><option value="">—</option>${modelOptions(a.model_id)}</select><button class="btn sec sm" style="margin-top:5px" name="_model_preview" value="1">Apply model</button></div>
<div><label>Status</label><select name="status">${STATUSES.map((s) => `<option value="${s}"${a.status === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
<div><label>Status label</label><select name="status_label_id"><option value="">—</option>${statusLabelOptions(a.status || "deployable", a.status_label_id)}</select></div>
<div><label>Location</label><select name="location_id"><option value="">—</option>${lookupOptions("locations", a.location_id)}</select></div>
<div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${lookupOptions("suppliers", a.supplier_id)}</select></div>
<div><label>Purchase date</label><input name="purchase_date" type="date" value="${esc(a.purchase_date ?? "")}"></div>
<div><label>Purchase cost</label><input name="purchase_cost" type="number" step="0.01" value="${esc(a.purchase_cost ?? "")}"></div>
<div><label>Warranty (months)</label><input name="warranty_months" type="number" value="${esc(a.warranty_months ?? "")}"></div>
<div><label>Order number</label><input name="order_number" value="${esc(a.order_number ?? "")}"></div>
<div><label>Photo URL</label><input name="photo_url" type="url" value="${esc(a.photo_url ?? "")}" placeholder="https://..."></div>
<div><label>IP address</label><input name="ip_address" value="${esc(a.ip_address ?? "")}"></div>
<div><label>MAC address</label><input name="mac_address" value="${esc(a.mac_address ?? "")}"></div>
</div>
<div style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:#4b5563">Notes</label><textarea name="notes" rows="3">${esc(a.notes ?? "")}</textarea></div>${customFieldSection(a.model_id,custom)}`;
}

const formAsset=(v:(k:string)=>string)=>Object.fromEntries([...ASSET_COLS.split(", ").map(k=>[k,v(k)]),["status",v("status")||"deployable"]]);
const formCustom=(modelId:any,v:(k:string)=>string)=>Object.fromEntries(modelFields(modelId).map(f=>[f.field_key,v(`cf_${f.field_key}`)]));
function nextTag():string{const prefix=getSetting("asset_tag_prefix","AST-");let n=1;while(db.query("SELECT 1 FROM assets WHERE asset_tag=?").get(`${prefix}${String(n).padStart(5,"0")}`))n++;return `${prefix}${String(n).padStart(5,"0")}`;}
function assetEditor(user:User,a:any,custom:Record<string,string>,id?:string,message=""):Response{return layout(user,id?`Edit ${a.asset_tag}`:"New asset",`<h1>${id?`Edit ${esc(a.asset_tag)}`:"New asset"}</h1><div class="card"><form method="post" action="${id?`/assets/${esc(id)}`:"/assets"}">${assetForm(a,custom)}<button class="btn">${id?"Save":"Create"}</button> <a class="btn sec" href="${id?`/assets/${esc(id)}`:"/assets"}">Cancel</a></form></div>`,"/assets",message);}

function assetVals(v: (k: string) => string): any[] {
  const n = (k: string) => (v(k) === "" ? null : v(k));
  return [
    v("asset_tag"),
    n("serial"),
    n("name"),
    n("model_id"),
    v("status") || "deployable",
    statusLabelId(v("status") || "deployable", v("status_label_id")),
    n("location_id"),
    n("supplier_id"),
    n("purchase_date"),
    n("purchase_cost"),
    n("warranty_months"),
    n("order_number"),
    n("notes"),
    n("photo_url"),
    n("ip_address"),
    n("mac_address"),
  ];
}

const ASSET_COLS =
  "asset_tag, serial, name, model_id, status, status_label_id, location_id, supplier_id, purchase_date, purchase_cost, warranty_months, order_number, notes, photo_url, ip_address, mac_address";

export function assetsPage(user: User, url: URL, canEdit: boolean): Response {
  const q = (url.searchParams.get("q") || "").trim();
  const many = (k:string) => url.searchParams.getAll(k).filter(Boolean);
  const statuses = many("status").filter(s => FILTER_STATUSES.includes(s));
  const deptIds = many("dept_id").filter(s => /^\d+$/.test(s));
  const locationIds = many("location_id").filter(s => /^\d+$/.test(s));
  const modelIds = many("model_id").filter(s => /^\d+$/.test(s));
  const assignedVals = many("assigned").filter(s => s === "yes" || s === "no");
  const filters = ["1=1"];
  const args: any[] = [];
  const ins = (col:string,vals:string[]) => { filters.push(`${col} IN (${vals.map(()=>"?").join(",")})`); args.push(...vals); };
  if (q) {
    filters.push("(a.asset_tag LIKE ? OR a.serial LIKE ? OR a.name LIKE ? OR m.name LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (statuses.length) ins("a.status", statuses);
  if(deptIds.length){filters.push(`a.assigned_to IN (SELECT id FROM users WHERE department_id IN (${deptIds.map(()=>"?").join(",")}))`);args.push(...deptIds);}
  if(locationIds.length)ins("a.location_id",locationIds);
  if(modelIds.length)ins("a.model_id",modelIds);
  if(assignedVals.length===1&&assignedVals[0]==="yes")filters.push("a.assigned_to IS NOT NULL");
  if(assignedVals.length===1&&assignedVals[0]==="no")filters.push("a.assigned_to IS NULL");
  const where=filters.join(" AND ");
  const pageSize = itemsPerPage();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const total = (db.query(`SELECT COUNT(*) n FROM assets a LEFT JOIN models m ON m.id=a.model_id WHERE ${where}`).get(...args) as any).n;
  const rows = db
    .query(
      `SELECT a.id, a.asset_tag, a.serial, a.name, a.status, sl.name status_label, sl.color status_color, m.name AS model, u.name AS assignee, l.name AS location
       FROM assets a
       LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN status_labels sl ON sl.id=a.status_label_id
       LEFT JOIN users u ON u.id = a.assigned_to
       LEFT JOIN locations l ON l.id = a.location_id
       WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize) as any[];
  const users=canEdit?db.query("SELECT id,name FROM users WHERE active=1 ORDER BY name").all() as any[]:[];
  const departments=db.query("SELECT id,name FROM departments ORDER BY name").all() as any[];
  const locations=db.query("SELECT id,name FROM locations ORDER BY name").all() as any[];
  const models=db.query("SELECT id,name FROM models ORDER BY name").all() as any[];
  const active = (on:boolean) => on ? " filter-active" : "";
  const labelMap:Record<string,string>={};
  FILTER_STATUSES.forEach(s=>labelMap[`status:${s}`]=`Status: ${s}`);
  locations.forEach((r:any)=>labelMap[`location_id:${r.id}`]=`Location: ${r.name}`);
  models.forEach((r:any)=>labelMap[`model_id:${r.id}`]=`Model: ${r.name}`);
  departments.forEach((r:any)=>labelMap[`dept_id:${r.id}`]=`Department: ${r.name}`);
  labelMap["assigned:yes"]="Assigned"; labelMap["assigned:no"]="Unassigned";
  const bulk=canEdit?`<div class="toolbar no-print" style="padding:12px 16px;margin:0">
<select name="bulk_action" required><option value="">Bulk action…</option><option value="checkout">Check out</option><option value="checkin">Check in</option><option value="update_status">Set status</option><option value="delete">Delete</option></select>
<select name="user_id"><option value="">Checkout user…</option>${opt(users,"")}</select>
<select name="new_status"><option value="">New status…</option>${STATUSES.map(s=>`<option value="${s}">${s}</option>`).join("")}</select>
<button class="btn">Apply</button>
<button class="btn sec" type="button" onclick="const ids=[...document.querySelectorAll('.bulk-cb:checked')].map(x=>x.value);location.href='/labels?ids='+encodeURIComponent(ids.join(','))">Print selected labels</button>
</div>`:"";
  const body = `<h1>Assets <span class="muted">(${total})</span></h1>
<div class="toolbar no-print">
<form class="filter-form" method="get" action="/assets">
<input type="search" class="${active(!!q).trim()}" name="q" placeholder="Search tag, serial, name, model…" value="${esc(q)}">
${filterDropdown("status","Status",FILTER_STATUSES.map(s=>({value:s,label:s})),statuses)}
${filterDropdown("location_id","Location",locations.map(r=>({value:String(r.id),label:r.name})),locationIds)}
${filterDropdown("model_id","Model",models.map(r=>({value:String(r.id),label:r.name})),modelIds)}
${filterDropdown("assigned","Assignment",[{value:"yes",label:"Assigned"},{value:"no",label:"Unassigned"}],assignedVals)}
${filterDropdown("dept_id","Department",departments.map(r=>({value:String(r.id),label:r.name})),deptIds)}
<button class="btn sec">Filter</button></form>
${canEdit ? `<a class="btn" href="/assets/new">+ New asset</a>` : ""}
${canEdit?`<a class="btn sec" href="/assets/import">Import CSV</a>`:""}
<a class="btn sec" href="/labels${statuses.length===1 ? `?status=${encodeURIComponent(statuses[0])}` : ""}">Print labels</a>
</div>
${activeChips(url,["status","location_id","model_id","dept_id","assigned"],labelMap)}
${rows.length===0?emptyState("No assets found","Try adjusting your filters or create your first asset.",canEdit?'<a class="btn" href="/assets/new">+ New asset</a>':""):`${canEdit?'<form method="post" action="/assets/bulk">':""}<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr>${canEdit?`<th><input type="checkbox" style="width:auto" aria-label="Select all" onclick="document.querySelectorAll('.bulk-cb').forEach(x=>x.checked=this.checked)"></th>`:""}<th>Tag</th><th>Name</th><th>Model</th><th>Serial</th><th>Status</th><th>Assigned to</th><th>Location</th></tr>
${rows
  .map(
    (r) => `<tr class="row-${esc(r.status)}" data-href="/assets/${r.id}">${canEdit?`<td><input class="bulk-cb" style="width:auto" type="checkbox" name="asset_ids[]" value="${r.id}"></td>`:""}<td><a href="/assets/${r.id}">${esc(r.asset_tag)}</a></td><td>${esc(r.name ?? "")}</td>
<td>${esc(r.model ?? "")}</td><td>${esc(r.serial ?? "")}</td><td>${statusBadge(r.status,r.status_label,r.status_color)}</td>
<td>${esc(r.assignee ?? "")}</td><td>${esc(r.location ?? "")}</td></tr>`
  )
  .join("")}
</table>${bulk}</div>${canEdit?"</form>":""}${pager(url,page,total,pageSize)}`}`;
  return layout(user, "Assets", body, "/assets", url.searchParams.get("m") || "");
}

export async function bulkAction(user:User,req:Request):Promise<Response>{
  const form=await req.formData(),ids=form.getAll("asset_ids[]").map(String),action=String(form.get("bulk_action")||"");
  if(!ids.length)return redirect("/assets?m=No assets selected");
  if(ids.some(id=>!/^\d+$/.test(id)))return new Response("Invalid asset ID",{status:400});
  if(!["checkout","checkin","update_status","delete"].includes(action))return new Response("Invalid bulk action",{status:400});
  const userId=String(form.get("user_id")||""),newStatus=String(form.get("new_status")||"");
  const target=action==="checkout"?db.query("SELECT id,name FROM users WHERE id=? AND active=1").get(userId) as any:null;
  if(action==="checkout"&&!target)return redirect("/assets?m=Select an active checkout user");
  if(action==="update_status"&&!STATUSES.includes(newStatus))return new Response("Invalid status",{status:400});
  let changed=0;
  db.transaction(()=>{
    for(const id of ids){
      const a=db.query("SELECT id,asset_tag,status FROM assets WHERE id=?").get(id) as any;if(!a)continue;
      let r:any,detail="";
      if(action==="checkout"){r=db.run("UPDATE assets SET assigned_to=?,checkout_location_id=NULL,status='deployed',status_label_id=NULL WHERE id=? AND status='deployable'",[target.id,id]);detail=`to ${target.name}`;}
      else if(action==="checkin"){r=db.run("UPDATE assets SET assigned_to=NULL,checkout_location_id=NULL,status='deployable',status_label_id=NULL WHERE id=? AND status='deployed'",[id]);detail="bulk checkin";}
      else if(action==="update_status"){r=db.run("UPDATE assets SET status=?,status_label_id=NULL WHERE id=? AND status!=?",[newStatus,id,newStatus]);detail=`status: ${newStatus}`;}
      else{r=db.run("DELETE FROM assets WHERE id=?",[id]);detail=a.asset_tag;}
      if(r.changes){changed++;logActivity(user.id,action==="update_status"?"update":action,"asset",Number(id),detail);}
    }
  })();
  return redirect(`/assets?m=${encodeURIComponent(`${changed} assets updated`)}`);
}

function importFk(table:string,value:string):string|null{
  if(!new Set(["models","locations","suppliers"]).has(table))throw new Error(`Unknown table: ${table}`);
  if(!value)return null;if(/^\d+$/.test(value))return value;
  return String((db.query(`SELECT id FROM ${table} WHERE name=? COLLATE NOCASE`).get(value) as any)?.id??"")||null;
}
function importNumber(value:string):number|null{if(!value)return null;const n=Number(value);return Number.isFinite(n)?n:null;}

export function importPage(user:User,url:URL):Response{return layout(user,"Import assets",`<h1>Import assets</h1><div class="card"><p class="muted" style="margin-bottom:14px">Upload up to 5 MB and 5,000 data rows. Existing asset tags are updated.</p><form method="post" action="/assets/import" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv,text/csv" required style="margin-bottom:14px"><button class="btn">Import</button> <a class="btn sec" href="/assets/import/template.csv">Download template</a></form></div>`,"/assets",url.searchParams.get("m")||"");}
export function importTemplate():Response{
  const fields=db.query("SELECT field_key FROM custom_fields ORDER BY id").all() as any[];
  return new Response([...ASSET_COLS.split(", "),...fields.map(f=>`cf_${f.field_key}`)].join(",")+"\n",{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="assets-import-template.csv"'}});
}
export async function importProcess(user:User,req:Request):Promise<Response>{
  const form=await req.formData(),file=form.get("csv");if(!(file instanceof File))return redirect("/assets/import?m=Choose a CSV file");
  if(file.size>5_242_880)return redirect("/assets/import?m=CSV exceeds the 5 MB limit");
  const rows=parseCsv(await file.text());if(!rows.length)return redirect("/assets/import?m=CSV is empty");
  const headers=rows.shift()!.map(h=>h.trim().toLowerCase());if(rows.length>5000)return redirect("/assets/import?m=CSV exceeds the 5000 row limit");
  const allowed=ASSET_COLS.split(", "),knownFields=new Set((db.query("SELECT field_key FROM custom_fields").all() as any[]).map(f=>f.field_key));
  const recognized=headers.map(h=>allowed.includes(h)||h.startsWith("cf_")&&knownFields.has(h.slice(3)));
  const unknown=headers.filter((_,i)=>!recognized[i]).length;let created=0,updated=0,errors=0;
  for(const cells of rows){
      if(cells.every(x=>!x.trim()))continue;
      const raw:Record<string,string>={};headers.forEach((h,i)=>{if(recognized[i])raw[h]=cells[i]??"";});
      const tag=raw.asset_tag?.trim();if(!tag){errors++;continue;}
      const old=db.query("SELECT * FROM assets WHERE asset_tag=?").get(tag) as any;
      const provided=new Set(Object.keys(raw).filter(k=>allowed.includes(k)));
      const val=(k:string):any=>{const x=(raw[k]??"").trim();if(k==="model_id")return importFk("models",x);if(k==="location_id")return importFk("locations",x);if(k==="supplier_id")return importFk("suppliers",x);if(k==="purchase_cost"||k==="warranty_months")return importNumber(x);if(k==="status")return x||"deployable";if(k==="status_label_id")return statusLabelId(raw.status||old?.status||"deployable",x);if(k==="photo_url")return /^https:\/\//.test(x)?x:null;return x||null;};
      if(raw.status!==undefined&&!STATUSES.includes(raw.status||"deployable")){errors++;continue;}
      const modelId=provided.has("model_id")?val("model_id"):old?.model_id??null,custom={...(old?assetCustomMap(old.id):{})};for(const [k,x] of Object.entries(raw))if(k.startsWith("cf_"))custom[k.slice(3)]=x;
      if(validateCustomValues(modelId,k=>custom[k]??"").length){errors++;continue;}
      try{
        db.transaction(()=>{let id:number;
          if(old){const cols=allowed.filter(k=>provided.has(k)&&k!=="asset_tag");if(cols.length){const clear=provided.has("status")&&!provided.has("status_label_id");db.run(`UPDATE assets SET ${cols.map(k=>`${k}=?`).join(",")}${clear?",status_label_id=NULL":""} WHERE id=?`,[...cols.map(val),old.id]);}id=old.id;}
          else{const values=allowed.map(k=>k==="asset_tag"?tag:k==="status"?(raw.status||"deployable"):provided.has(k)?val(k):null);const r=db.run(`INSERT INTO assets(${allowed.join(",")}) VALUES(${allowed.map(()=>"?").join(",")})`,values);id=Number(r.lastInsertRowid);}
          saveCustomValues(id,modelId,k=>custom[k]??"");logActivity(user.id,"import","asset",id,tag);
        })();if(old)updated++;else created++;
      }catch{errors++;}
    }
  const extra=unknown?`, ${unknown} unknown columns ignored`:"";
  return redirect(`/assets?m=${encodeURIComponent(`Import complete: ${created} created, ${updated} updated, ${errors} errors${extra}`)}`);
}

export function assetNewPage(user: User): Response {
  return assetEditor(user,{asset_tag:nextTag(),status:"deployable"},{});
}

export async function assetCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  const a=formAsset(v),custom=formCustom(a.model_id,v);
  if(v("_model_preview")==="1")return assetEditor(user,a,custom);
  if(!STATUSES.includes(v("status")||"deployable"))return assetEditor(user,a,custom,undefined,"Invalid status");
  if(v("photo_url")&&!/^https:\/\//.test(v("photo_url")))return assetEditor(user,a,custom,undefined,"Photo URL must start with https://");
  const missing=validateCustomValues(a.model_id,k=>v(`cf_${k}`));
  if(missing.length)return assetEditor(user,a,custom,undefined,`Required custom fields: ${missing.join(", ")}`);
  try {
    const r = db.run(
      `INSERT INTO assets (${ASSET_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      assetVals(v)
    );
    saveCustomValues(Number(r.lastInsertRowid),a.model_id,k=>v(`cf_${k}`));
    logActivity(user.id, "create", "asset", Number(r.lastInsertRowid), v("asset_tag"));
    return redirect(`/assets/${r.lastInsertRowid}?m=Asset created`);
  } catch (e: any) {
    return redirect(`/assets?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function assetDetail(user: User, id: string, url: URL, canEdit: boolean): Response {
  const a = db
    .query(
      `SELECT a.*, sl.name status_label, sl.color status_color, m.name AS model, m.depreciation_id, d.name AS depreciation_name, d.months AS dep_months, d.floor_value,
       mf.name AS manufacturer, u.name AS assignee, l.name AS location, l2.name AS checkout_location, s.name AS supplier
       FROM assets a
       LEFT JOIN status_labels sl ON sl.id=a.status_label_id
       LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN depreciation d ON d.id = m.depreciation_id
       LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
       LEFT JOIN users u ON u.id = a.assigned_to
       LEFT JOIN locations l ON l.id = a.location_id
       LEFT JOIN locations l2 ON l2.id = a.checkout_location_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.id = ?`
    )
    .get(id) as any;
  if (!a) return layout(user, "Not found", "<h1>Asset not found</h1>", "/assets");
  const users = db.query("SELECT id, name FROM users WHERE active = 1 ORDER BY name").all() as any[];
  const locations=db.query("SELECT id,name FROM locations ORDER BY name").all() as any[];
  const components = assetInstalled(id);
  const customFields=modelFields(a.model_id),customValues=assetCustomMap(id);
  const value = currentValue(a);
  let warranty = a.warranty_months ? `${a.warranty_months} months` : "";
  if (a.purchase_date && a.warranty_months) {
    const expiry = new Date(`${a.purchase_date}T00:00:00Z`);
    expiry.setUTCMonth(expiry.getUTCMonth() + Number(a.warranty_months));
    warranty += ` (ends ${expiry.toISOString().slice(0,10)})`;
  }
  const row = (l: string, val: string) => `<tr><th style="width:160px">${l}</th><td>${val}</td></tr>`;
  const info = `<table>
${row("Tag", esc(a.asset_tag))}
${row("Name", esc(a.name ?? ""))}
${row("Model", esc(a.model ? `${a.model}${a.manufacturer ? ` (${a.manufacturer})` : ""}` : ""))}
${row("Serial", esc(a.serial ?? ""))}
${row("IP address",esc(a.ip_address??""))}
${row("MAC address",esc(a.mac_address??""))}
${row("Status", statusBadge(a.status,a.status_label,a.status_color))}
${row("Assigned to", esc(a.assignee ?? "—"))}
${row("Checkout location",esc(a.checkout_location??"—"))}
${row("Location", esc(a.location ?? ""))}
${row("Supplier", esc(a.supplier ?? ""))}
${row("Purchased", esc(a.purchase_date ?? "") + (a.purchase_cost != null ? ` · $${Number(a.purchase_cost).toFixed(2)}` : ""))}
${row("Order number", esc(a.order_number ?? ""))}
${row("Warranty", esc(warranty))}
${row("Depreciation schedule", esc(a.depreciation_name ?? "—"))}
${row("Current value", value == null ? "—" : `$${value.toFixed(2)}`)}
${row("Notes", esc(a.notes ?? ""))}
${customFields.map(f=>row(esc(f.label),esc(customValues[f.field_key]||"—"))).join("")}
</table>`;
  const actions = !canEdit
    ? ""
    : `<div class="card no-print">
${
  a.status === "deployed"
    ? `<form method="post" action="/assets/${a.id}/checkin" class="inline"><button class="btn">Check in</button></form>`
    : a.status === "deployable"
      ? `<form method="post" action="/assets/${a.id}/checkout"><div class="frm">
<div><label><input type="radio" name="checkout_to" value="user" style="width:auto" checked> Check out to user</label><select name="user_id"><option value="">Select user…</option>${opt(users, "")}</select></div>
<div><label><input type="radio" name="checkout_to" value="location" style="width:auto"> Check out to location</label><select name="location_id"><option value="">Select location…</option>${opt(locations,"")}</select></div>
<div style="flex:1"><label style="font-size:12px;font-weight:600">Note</label><input name="note"></div>
<div><label><input type="checkbox" name="send_ack" value="1" style="width:auto"> Send acknowledgement email</label></div>
</div><button class="btn">Check out</button></form>`
      : `<span class="muted">Asset is in ${esc(a.status)} — set status to deployable to check out.</span>`
}
<div style="margin-top:12px">
<a class="btn sec sm" href="/assets/${a.id}/edit">Edit</a>
${inlineConfirm(`asset-${a.id}`,`/assets/${a.id}/delete`,"Delete asset","Delete this asset?",user.csrfToken)}
</div></div>`;
  const body = `<h1>${esc(a.asset_tag)} <span class="muted">${esc(a.name ?? "")}</span></h1>
<div class="toolbar"><a class="btn sec sm" href="/assets/${a.id}/maintenance">Maintenance history</a></div>
<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
<div class="card" style="flex:1;min-width:340px">${a.photo_url?`<div style="margin-bottom:12px"><img src="${esc(a.photo_url)}" alt="Asset photo" style="max-width:100%;max-height:200px;border-radius:6px;object-fit:contain"></div>`:""}${info}</div>
<div class="card" style="text-align:center"><img src="/qr/${a.id}.svg" width="140" height="140" alt="QR"><div class="muted">${esc(a.asset_tag)}</div></div>
</div>
${actions}<h2>Installed components</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Component</th><th>Quantity</th><th>Installed</th></tr>${components.map(c=>`<tr><td><a href="/components/${c.id}">${esc(c.name)}</a></td><td>${c.qty}</td><td>${esc(c.at)}</td></tr>`).join("")}</table></div>${attachmentList("asset",id,canEdit)}${entityTimeline("asset",id)}`;
  return layout(user, a.asset_tag, body, "/assets", url.searchParams.get("m") || "");
}

export function assetEditPage(user: User, id: string): Response {
  const a = db.query("SELECT * FROM assets WHERE id = ?").get(id) as any;
  if (!a) return layout(user, "Not found", "<h1>Asset not found</h1>", "/assets");
  return assetEditor(user,a,assetCustomMap(id),id);
}

export async function assetUpdate(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  const current=db.query("SELECT id FROM assets WHERE id=?").get(id);if(!current)return redirect("/assets?m=Asset not found");
  const a=formAsset(v),custom=formCustom(a.model_id,v);
  if(v("_model_preview")==="1")return assetEditor(user,a,custom,id);
  if(!STATUSES.includes(v("status")||"deployable"))return assetEditor(user,a,custom,id,"Invalid status");
  if(v("photo_url")&&!/^https:\/\//.test(v("photo_url")))return assetEditor(user,a,custom,id,"Photo URL must start with https://");
  const missing=validateCustomValues(a.model_id,k=>v(`cf_${k}`));
  if(missing.length)return assetEditor(user,a,custom,id,`Required custom fields: ${missing.join(", ")}`);
  try {
    db.run(
      `UPDATE assets SET asset_tag=?, serial=?, name=?, model_id=?, status=?, status_label_id=?, location_id=?, supplier_id=?, purchase_date=?, purchase_cost=?, warranty_months=?, order_number=?, notes=?,photo_url=?,ip_address=?,mac_address=? WHERE id=?`,
      [...assetVals(v), id]
    );
    saveCustomValues(Number(id),a.model_id,k=>v(`cf_${k}`));
    logActivity(user.id, "update", "asset", Number(id), v("asset_tag"));
    return redirect(`/assets/${id}?m=Saved`);
  } catch (e: any) {
    return redirect(`/assets/${id}?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function assetDelete(user: User, id: string): Response {
  const a = db.query("SELECT asset_tag FROM assets WHERE id = ?").get(id) as any;
  db.run("DELETE FROM assets WHERE id = ?", [id]);
  logActivity(user.id, "delete", "asset", Number(id), a?.asset_tag || "");
  return redirect("/assets?m=Asset deleted");
}

export async function assetCheckout(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  const a = db.query("SELECT * FROM assets WHERE id = ? AND status = 'deployable'").get(id) as any;
  if(!a)return redirect(`/assets/${id}?m=Cannot check out`);
  if(!["user","location"].includes(v("checkout_to")))return redirect(`/assets/${id}?m=Select a checkout destination`);
  if(v("checkout_to")==="location"){const loc=db.query("SELECT id,name FROM locations WHERE id=?").get(v("location_id")) as any;if(!loc)return redirect(`/assets/${id}?m=Select a valid location`);const r=db.run("UPDATE assets SET assigned_to=NULL,checkout_location_id=?,status='deployed',status_label_id=NULL WHERE id=? AND status='deployable'",[loc.id,id]);if(!r.changes)return redirect(`/assets/${id}?m=Asset is no longer deployable`);logActivity(user.id,"checkout","asset",Number(id),`to location: ${loc.name}`);return redirect(`/assets/${id}?m=${encodeURIComponent(`Checked out to ${loc.name}`)}`);}
  const target = db.query("SELECT id, name, email FROM users WHERE id = ? AND active = 1").get(v("user_id")) as any;if(!target)return redirect(`/assets/${id}?m=Select a valid user`);
  const r=db.run("UPDATE assets SET assigned_to = ?,checkout_location_id=NULL, status = 'deployed',status_label_id=NULL WHERE id = ? AND status='deployable'", [target.id, id]);
  if(!r.changes)return redirect(`/assets/${id}?m=Asset is no longer deployable`);
  logActivity(user.id, "checkout", "asset", Number(id), `to ${target.name}${v("note") ? ` — ${v("note")}` : ""}`);
  if(v("send_ack")==="1"&&target.email)createAck(user.id,target.id,"asset_checkout","asset",Number(id),"Asset receipt acknowledgement",`You have been checked out: ${a.asset_tag} — ${a.name||""}.\n\nPlease acknowledge receipt of this item.`);
  if(target.email){queue(target.email,`Asset checked out to you — ${a.asset_tag}`,`Hi ${target.name},\n\n${a.asset_tag} (${a.name||""}) has been checked out to you.\nDate: ${new Date().toISOString().slice(0,10)}\n\nInventra`);flushAsync();}
  return redirect(`/assets/${id}?m=${encodeURIComponent(`Checked out to ${target.name}`)}`);
}

export function assetCheckin(user: User, id: string): Response {
  const a = db
    .query("SELECT a.*, u.name AS assignee, u.email AS assignee_email,l.name checkout_location FROM assets a LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN locations l ON l.id=a.checkout_location_id WHERE a.id = ?")
    .get(id) as any;
  if (!a || a.status !== "deployed") return redirect(`/assets/${id}?m=${encodeURIComponent("Not checked out.")}`);
  const r=db.run("UPDATE assets SET assigned_to = NULL,checkout_location_id=NULL, status = 'deployable',status_label_id=NULL WHERE id = ? AND status='deployed'", [id]);
  if(!r.changes)return redirect(`/assets/${id}?m=${encodeURIComponent("Not checked out.")}`);
  logActivity(user.id, "checkin", "asset", Number(id), `from ${a.assignee || a.checkout_location || "?"}`);
  if(a.assignee_email){queue(a.assignee_email,`Asset checked in — ${a.asset_tag}`,`Hi ${a.assignee},\n\n${a.asset_tag} (${a.name||""}) has been checked in.\nDate: ${new Date().toISOString().slice(0,10)}\n\nInventra`);flushAsync();}
  return redirect(`/assets/${id}?m=Checked in`);
}

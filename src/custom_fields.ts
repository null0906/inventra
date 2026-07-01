import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, redirect } from "./web";

const TYPES=["text","number","date","select"];
export function modelFields(modelId:string|number|null):any[]{if(!modelId)return [];return db.query(`SELECT cf.* FROM custom_fields cf JOIN model_fields mf ON mf.field_id=cf.id WHERE mf.model_id=? ORDER BY mf.sort_order,cf.id`).all(modelId) as any[];}
export function assetCustomMap(assetId:string|number):Record<string,string>{const rows=db.query(`SELECT cf.field_key,acv.value FROM asset_custom_values acv JOIN custom_fields cf ON cf.id=acv.field_id WHERE acv.asset_id=?`).all(assetId) as any[];return Object.fromEntries(rows.map(r=>[r.field_key,r.value??""]));}
function options(f:any):string[]{try{const x=JSON.parse(f.select_options||"[]");return Array.isArray(x)?x.map(String):[];}catch{return [];}}
export function customFieldInput(f:any,value=""):string{
  const base=`name="cf_${esc(f.field_key)}"`;
  if(f.field_type==="select")return `<div><label>${esc(f.label)}${f.required?" *":""}</label><select ${base}${f.required?" required":""}><option value="">—</option>${options(f).map(o=>`<option value="${esc(o)}"${value===o?" selected":""}>${esc(o)}</option>`).join("")}</select></div>`;
  const type=f.field_type==="number"?"number":f.field_type==="date"?"date":"text";return `<div><label>${esc(f.label)}${f.required?" *":""}</label><input type="${type}" ${base} value="${esc(value)}"${f.required?" required":""}></div>`;
}
export function customFieldSection(modelId:string|number|null,values:Record<string,string>={}):string{
  if(!modelId)return `<div id="cf-section"><p class="muted">Select a model to see its custom fields.</p></div>`;
  const fields=modelFields(modelId);return `<div id="cf-section">${fields.length?`<h2>Custom fields</h2><div class="frm">${fields.map(f=>customFieldInput(f,values[f.field_key]||"")).join("")}</div>`:'<p class="muted">This model has no custom fields.</p>'}</div>`;
}
export function validateCustomValues(modelId:string|number|null,get:(key:string)=>string):string[]{return modelFields(modelId).filter(f=>f.required&&!get(f.field_key).trim()).map(f=>f.label);}
export function saveCustomValues(assetId:number,modelId:string|number|null,get:(key:string)=>string):void{
  if(!modelId){db.run("DELETE FROM asset_custom_values WHERE asset_id=?",[assetId]);return;}const up=db.query(`INSERT INTO asset_custom_values(asset_id,field_id,value) VALUES(?,?,?) ON CONFLICT(asset_id,field_id) DO UPDATE SET value=excluded.value`);
  for(const f of modelFields(modelId)){let val=get(f.field_key).trim()||null;if(val&&f.field_type==="select"&&!options(f).includes(val))val=null;up.run(assetId,f.id,val);}
  db.run("DELETE FROM asset_custom_values WHERE asset_id=? AND field_id NOT IN (SELECT field_id FROM model_fields WHERE model_id=?)",[assetId,modelId]);
}
export function saveCustomValuesApi(assetId:number,modelId:string|number|null,map:any):string[]{
  const data=map&&typeof map==="object"&&!Array.isArray(map)?map:{};const fields=modelFields(modelId),missing=fields.filter(f=>f.required&&!String(data[f.field_key]??"").trim()).map(f=>f.label);
  if(missing.length)return missing;saveCustomValues(assetId,modelId,k=>String(data[k]??""));return [];
}
function parsed(v:(k:string)=>string,key?:string):{error?:string;data?:any}{
  const label=v("label").trim(),type=v("field_type"),required=v("required")==="1"?1:0;
  if(!label)return {error:"Label is required"};if(!TYPES.includes(type))return {error:"Invalid field type"};
  const opts=v("select_options").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(opts.length>50||opts.some(x=>x.length>200))return {error:"Select options are limited to 50 entries and 200 characters each"};
  if(type==="select"&&!opts.length)return {error:"Select fields need at least one option"};
  const fieldKey=key??label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40);
  if(!fieldKey)return {error:"Label must contain letters or numbers"};
  return {data:{label,fieldKey,type,selectOptions:type==="select"?JSON.stringify(opts):null,required}};
}
function fieldForm(f:any={}):string{
  return `<div class="frm"><div><label>Label *</label><input name="label" value="${esc(f.label||"")}" required></div><div><label>Type</label><select name="field_type">${TYPES.map(t=>`<option${f.field_type===t?" selected":""}>${t}</option>`).join("")}</select></div><div><label><input type="checkbox" name="required" value="1" style="width:auto"${f.required?" checked":""}> Required</label></div></div><div style="margin-bottom:14px"><label>Select options, one per line</label><textarea name="select_options" rows="5">${esc(options(f).join("\n"))}</textarea></div>`;
}
export function list(user:User,url:URL):Response{const rows=db.query("SELECT * FROM custom_fields ORDER BY id").all() as any[];return layout(user,"Custom fields",`<h1>Custom fields</h1><div class="toolbar"><a class="btn" href="/custom-fields/new">+ New custom field</a></div><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Label</th><th>Key</th><th>Type</th><th>Required</th><th></th></tr>${rows.map(f=>`<tr><td>${esc(f.label)}</td><td>${esc(f.field_key)}</td><td>${esc(f.field_type)}</td><td>${f.required?"yes":"no"}</td><td><a class="btn sec sm" href="/custom-fields/${f.id}/edit">Edit</a> <form class="inline" method="post" action="/custom-fields/${f.id}/delete"><button class="btn danger sm">Delete</button></form></td></tr>`).join("")}</table></div>`,"/custom-fields",url.searchParams.get("m")||"");}
export function newPage(user:User):Response{return layout(user,"New custom field",`<h1>New custom field</h1><div class="card"><form method="post" action="/custom-fields">${fieldForm()}<button class="btn">Create</button></form></div>`,"/custom-fields");}
export async function create(user:User,req:Request):Promise<Response>{const v=await formVals(req),p=parsed(v);if(p.error)return redirect(`/custom-fields/new?m=${encodeURIComponent(p.error)}`);try{const d=p.data,r=db.run("INSERT INTO custom_fields(label,field_key,field_type,select_options,required) VALUES(?,?,?,?,?)",[d.label,d.fieldKey,d.type,d.selectOptions,d.required]);logActivity(user.id,"create","custom_field",Number(r.lastInsertRowid),d.label);return redirect("/custom-fields?m=Custom field created");}catch{return redirect("/custom-fields/new?m=Field key already exists");}}
export function editPage(user:User,id:string):Response{const f=db.query("SELECT * FROM custom_fields WHERE id=?").get(id) as any;return f?layout(user,"Edit custom field",`<h1>Edit custom field</h1><div class="card"><form method="post" action="/custom-fields/${esc(id)}/edit">${fieldForm(f)}<button class="btn">Save</button></form></div>`,"/custom-fields"):layout(user,"Not found","<h1>Custom field not found</h1>","/custom-fields");}
export async function update(user:User,id:string,req:Request):Promise<Response>{const f=db.query("SELECT * FROM custom_fields WHERE id=?").get(id) as any;if(!f)return redirect("/custom-fields?m=Custom field not found");const v=await formVals(req),p=parsed(v,f.field_key);if(p.error)return redirect(`/custom-fields/${encodeURIComponent(id)}/edit?m=${encodeURIComponent(p.error)}`);const d=p.data;db.run("UPDATE custom_fields SET label=?,field_type=?,select_options=?,required=? WHERE id=?",[d.label,d.type,d.selectOptions,d.required,id]);logActivity(user.id,"update","custom_field",Number(id),d.label);return redirect("/custom-fields?m=Custom field updated");}
export function remove(user:User,id:string):Response{const f=db.query("SELECT label FROM custom_fields WHERE id=?").get(id) as any;if(!f)return redirect("/custom-fields");db.run("DELETE FROM custom_fields WHERE id=?",[id]);logActivity(user.id,"delete","custom_field",Number(id),f.label);return redirect("/custom-fields?m=Custom field deleted");}
export function modelFieldsPanel(id:string):string{const model=db.query("SELECT id FROM models WHERE id=?").get(id);if(!model)return "";const all=db.query(`SELECT cf.*,(SELECT COUNT(*) FROM model_fields mf WHERE mf.model_id=? AND mf.field_id=cf.id) attached FROM custom_fields cf ORDER BY cf.id`).all(id) as any[];return `<h2>Custom fields</h2><div class="card"><form method="post" action="/models/${esc(id)}/fields">${all.map(f=>`<label style="display:block;margin-bottom:8px"><input style="width:auto" type="checkbox" name="field_id" value="${f.id}"${f.attached?" checked":""}> ${esc(f.label)} <span class="muted">${esc(f.field_type)}</span></label>`).join("")||'<p class="muted">No custom fields have been defined.</p>'}<button class="btn">Save custom fields</button></form></div>`;}
export async function saveModelFields(user:User,id:string,req:Request):Promise<Response>{if(!db.query("SELECT id FROM models WHERE id=?").get(id))return redirect("/models?m=Model not found");const form=await req.formData(),ids=form.getAll("field_id").map(String).filter(x=>/^\d+$/.test(x));db.transaction(()=>{db.run("DELETE FROM model_fields WHERE model_id=?",[id]);const insert=db.query("INSERT INTO model_fields(model_id,field_id,sort_order) SELECT ?,id,? FROM custom_fields WHERE id=?");ids.forEach((fieldId,i)=>insert.run(id,i,fieldId));})();logActivity(user.id,"update","model",Number(id),`Custom fields updated: ${ids.length}`);return redirect(`/models/${encodeURIComponent(id)}/edit?m=Custom fields saved`);}

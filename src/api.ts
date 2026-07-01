import { db, logActivity } from "./db";
import type { User } from "./auth";
import { itemsPerPage } from "./settings";
import { currentValue } from "./depreciation";
import { assetCustomMap, saveCustomValues, validateCustomValues } from "./custom_fields";

export const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
export const apiErr=(msg:string,status:number)=>json({error:msg},status);
const pageInfo=(url:URL)=>{const size=itemsPerPage(),page=Math.max(1,Number(url.searchParams.get("page"))||1);return {page,size,offset:(page-1)*size};};
async function body(req:Request):Promise<any>{try{return await req.json();}catch{return null;}}
const ASSET_FIELDS=["asset_tag","serial","name","model_id","status","location_id","supplier_id","purchase_date","purchase_cost","warranty_months","order_number","notes","photo_url","ip_address","mac_address"] as const;
const ASSET_STATUSES=["deployable","deployed","maintenance","archived"];
const ACCESSORY_FIELDS=["name","category_id","manufacturer_id","supplier_id","location_id","qty","min_qty","cost","notes"] as const;
const CONSUMABLE_FIELDS=["name","category_id","location_id","qty","min_qty","cost"] as const;
const MAINTENANCE_TYPES=["repair","upgrade","preventive","test","pat_test","software_support","hardware_support","other"];
const MAINT_WRITE_FIELDS=["type","title","supplier_id","cost","notes","start_date","completion_date"] as const;
const FK_FIELDS=new Set(["category_id","manufacturer_id","supplier_id","location_id"]);
function accessoryRow(id:string|number):any{return db.query(`SELECT a.*,a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id AND x.checked_in_at IS NULL) available FROM accessories a WHERE a.id=?`).get(id) as any;}
function accessoryValidation(x:any,patch=false):string{
  if(!x||typeof x!=="object"||Array.isArray(x))return "JSON object required";
  if((!patch||x.name!==undefined)&&(typeof x.name!=="string"||!x.name.trim()))return "name is required";
  for(const k of FK_FIELDS)if(x[k]!==undefined&&x[k]!==null&&(!/^\d+$/.test(String(x[k]))))return `Invalid ${k}`;
  for(const k of ["qty","min_qty"])if(x[k]!==undefined&&(!Number.isInteger(x[k])||x[k]<0))return `${k} must be an integer >= 0`;
  return "";
}
function consumableValidation(x:any,patch=false):string{
  if(!x||typeof x!=="object"||Array.isArray(x))return "JSON object required";
  if((!patch||x.name!==undefined)&&(typeof x.name!=="string"||!x.name.trim()))return "name is required";
  for(const k of ["category_id","location_id"])if(x[k]!==undefined&&x[k]!==null&&(!/^\d+$/.test(String(x[k]))))return `Invalid ${k}`;
  for(const k of ["qty","min_qty"])if(x[k]!==undefined&&(!Number.isInteger(x[k])||x[k]<0))return `${k} must be an integer >= 0`;
  return "";
}
function maintValidation(x:any,patch=false):string{
  if(!x||typeof x!=="object"||Array.isArray(x))return "JSON object required";
  if(!patch&&(!x.asset_id||!/^\d+$/.test(String(x.asset_id))))return "asset_id is required";
  if((!patch||x.type!==undefined)&&!MAINTENANCE_TYPES.includes(x.type))return "Invalid maintenance type";
  if((!patch||x.title!==undefined)&&(typeof x.title!=="string"||!x.title.trim()))return "title is required";
  if((!patch||x.start_date!==undefined)&&(typeof x.start_date!=="string"||!x.start_date.trim()))return "start_date is required";
  if(x.supplier_id!==undefined&&x.supplier_id!==null&&!/^\d+$/.test(String(x.supplier_id)))return "Invalid supplier_id";
  return "";
}
const maintRow=(id:string|number)=>db.query("SELECT m.*,a.asset_tag FROM maintenance m JOIN assets a ON a.id=m.asset_id WHERE m.id=?").get(id) as any;
function assetRow(id:string|number):any{
  const a=db.query(`SELECT a.*,m.name model,m.depreciation_id,d.months dep_months,d.floor_value,u.name assigned_name,l.name location,l2.name checkout_location
    FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN depreciation d ON d.id=m.depreciation_id
    LEFT JOIN users u ON u.id=a.assigned_to LEFT JOIN locations l ON l.id=a.location_id LEFT JOIN locations l2 ON l2.id=a.checkout_location_id WHERE a.id=?`).get(id) as any;
  if(a){a.current_value=currentValue(a);a.custom_fields=assetCustomMap(a.id);}return a;
}
function safeAsset(a:any):any{if(!a)return a;const {depreciation_id,dep_months,floor_value,...rest}=a;return rest;}
export function me(user:User):Response{return json({id:user.id,name:user.name,username:user.username,email:user.email,role:user.role});}
export function assets(url:URL):Response{
  const q=(url.searchParams.get("q")||"").trim(),status=url.searchParams.get("status")||"",args:any[]=[];let where="1=1";
  if(q){where+=" AND (a.asset_tag LIKE ? OR a.serial LIKE ? OR a.name LIKE ? OR m.name LIKE ?)";const x=`%${q}%`;args.push(x,x,x,x);}
  if(status){where+=" AND a.status=?";args.push(status);}
  const {page,size,offset}=pageInfo(url),total=(db.query(`SELECT COUNT(*) n FROM assets a LEFT JOIN models m ON m.id=a.model_id WHERE ${where}`).get(...args) as any).n;
  const rows=db.query(`SELECT a.*,m.name model,m.depreciation_id,d.months dep_months,d.floor_value FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN depreciation d ON d.id=m.depreciation_id WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args,size,offset) as any[];
  return json({data:rows.map(a=>safeAsset({...a,current_value:currentValue(a),custom_fields:assetCustomMap(a.id)})),total,page,per_page:size});
}
export function asset(id:string):Response{const a=safeAsset(assetRow(id));return a?json(a):apiErr("Asset not found",404);}
export async function assetCreate(user:User,req:Request):Promise<Response>{
  const x=await body(req);if(!x||typeof x.asset_tag!=="string"||!x.asset_tag.trim())return apiErr("asset_tag is required",400);
  if(x.status!==undefined&&!ASSET_STATUSES.includes(x.status))return apiErr("Invalid status",400);
  if(x.photo_url&&!/^https:\/\//.test(String(x.photo_url).trim()))return apiErr("photo_url must start with https://",400);
  const custom=x.custom_fields&&typeof x.custom_fields==="object"&&!Array.isArray(x.custom_fields)?x.custom_fields:{},missing=validateCustomValues(x.model_id??null,k=>String(custom[k]??""));if(missing.length)return apiErr(`Required custom fields: ${missing.join(", ")}`,400);
  const vals=ASSET_FIELDS.map(k=>k==="asset_tag"?x[k].trim():k==="status"?(x[k]??"deployable"):k==="photo_url"?(x[k]?String(x[k]).trim():null):(x[k]===undefined?null:x[k]));
  try{const r=db.run(`INSERT INTO assets(${ASSET_FIELDS.join(",")}) VALUES(${ASSET_FIELDS.map(()=>"?").join(",")})`,vals);saveCustomValues(Number(r.lastInsertRowid),x.model_id??null,k=>String(custom[k]??""));logActivity(user.id,"create","asset",Number(r.lastInsertRowid),x.asset_tag);return json(safeAsset(assetRow(Number(r.lastInsertRowid))),201);}
  catch(e:any){if(String(e?.message||"").includes("UNIQUE"))return apiErr("Asset tag already exists",409);console.error(e);return apiErr("Internal server error",500);}
}
export async function assetPatch(user:User,id:string,req:Request):Promise<Response>{
  const old=assetRow(id);if(!old)return apiErr("Asset not found",404);const x=await body(req);if(!x||typeof x!=="object"||Array.isArray(x))return apiErr("JSON object required",400);
  const keys=ASSET_FIELDS.filter(k=>x[k]!==undefined),hasCustom=x.custom_fields&&typeof x.custom_fields==="object"&&!Array.isArray(x.custom_fields);if(!keys.length&&!hasCustom)return apiErr("No patchable fields provided",400);
  if(keys.includes("asset_tag")&&(!String(x.asset_tag).trim()))return apiErr("asset_tag cannot be empty",400);
  if(keys.includes("status")&&!ASSET_STATUSES.includes(x.status))return apiErr("Invalid status",400);
  if(keys.includes("photo_url")&&x.photo_url&&!/^https:\/\//.test(String(x.photo_url).trim()))return apiErr("photo_url must start with https://",400);
  const modelId=x.model_id!==undefined?x.model_id:old.model_id,custom={...assetCustomMap(id),...(hasCustom?x.custom_fields:{})},missing=validateCustomValues(modelId,k=>String(custom[k]??""));if(missing.length)return apiErr(`Required custom fields: ${missing.join(", ")}`,400);
  try{if(keys.length){const clear=keys.includes("status");db.run(`UPDATE assets SET ${keys.map(k=>`${k}=?`).join(",")}${clear?",status_label_id=NULL":""} WHERE id=?`,[...keys.map(k=>k==="photo_url"&&x[k]?String(x[k]).trim():x[k]===null?null:x[k]),id]);}saveCustomValues(Number(id),modelId,k=>String(custom[k]??""));const updated=assetRow(id);logActivity(user.id,"update","asset",Number(id),updated.asset_tag);return json(safeAsset(updated));}
  catch(e:any){if(String(e?.message||"").includes("UNIQUE"))return apiErr("Asset tag already exists",409);console.error(e);return apiErr("Internal server error",500);}
}
export function assetDelete(user:User,id:string):Response{const a=assetRow(id);if(!a)return apiErr("Asset not found",404);db.run("DELETE FROM assets WHERE id=?",[id]);logActivity(user.id,"delete","asset",Number(id),a.asset_tag);return new Response(null,{status:204});}
export async function checkout(user:User,id:string,req:Request):Promise<Response>{
  const x=await body(req);if(!x?.user_id&&!x?.location_id)return apiErr("user_id or location_id is required",400);
  const a=assetRow(id);if(!a)return apiErr("Asset not found",404);if(a.status!=="deployable")return apiErr("Asset is not deployable",409);
  if(x.location_id&&!x.user_id){const loc=db.query("SELECT id,name FROM locations WHERE id=?").get(x.location_id) as any;if(!loc)return apiErr("Location not found",404);const r=db.run("UPDATE assets SET assigned_to=NULL,checkout_location_id=?,status='deployed',status_label_id=NULL WHERE id=? AND status='deployable'",[loc.id,id]);if(!r.changes)return apiErr("Asset is no longer deployable",409);logActivity(user.id,"checkout","asset",Number(id),`to location: ${loc.name}`);return json(safeAsset(assetRow(id)));}
  const target=db.query("SELECT id,name FROM users WHERE id=? AND active=1").get(x.user_id) as any;if(!target)return apiErr("User not found",404);
  const r=db.run("UPDATE assets SET assigned_to=?,checkout_location_id=NULL,status='deployed',status_label_id=NULL WHERE id=? AND status='deployable'",[target.id,id]);if(!r.changes)return apiErr("Asset is no longer deployable",409);logActivity(user.id,"checkout","asset",Number(id),`to ${target.name}${x.note?` — ${x.note}`:""}`);return json(safeAsset(assetRow(id)));
}
export function checkin(user:User,id:string):Response{
  const a=assetRow(id);if(!a)return apiErr("Asset not found",404);if(a.status!=="deployed")return apiErr("Asset is not deployed",409);
  const r=db.run("UPDATE assets SET assigned_to=NULL,checkout_location_id=NULL,status='deployable',status_label_id=NULL WHERE id=? AND status='deployed'",[id]);if(!r.changes)return apiErr("Asset is not deployed",409);logActivity(user.id,"checkin","asset",Number(id),`from ${a.assigned_name||a.checkout_location||"?"}`);return json(safeAsset(assetRow(id)));
}
export function licenses(url:URL):Response{const {page,size,offset}=pageInfo(url),total=(db.query("SELECT COUNT(*) n FROM licenses").get() as any).n;const rows=db.query("SELECT l.*,(SELECT COUNT(*) FROM license_seats s WHERE s.license_id=l.id) seat_usage FROM licenses l ORDER BY l.id DESC LIMIT ? OFFSET ?").all(size,offset);return json({data:rows,total,page,per_page:size});}
export function license(id:string):Response{const l=db.query("SELECT l.*,(SELECT COUNT(*) FROM license_seats s WHERE s.license_id=l.id) seat_usage FROM licenses l WHERE l.id=?").get(id);return l?json(l):apiErr("License not found",404);}
export function consumables(url:URL):Response{const {page,size,offset}=pageInfo(url),total=(db.query("SELECT COUNT(*) n FROM consumables").get() as any).n;const rows=db.query("SELECT * FROM consumables ORDER BY id DESC LIMIT ? OFFSET ?").all(size,offset);return json({data:rows,total,page,per_page:size});}
export function maintenance(url:URL):Response{const {page,size,offset}=pageInfo(url),assetId=url.searchParams.get("asset_id"),where=assetId?"WHERE m.asset_id=?":"",args=assetId?[assetId]:[],total=(db.query(`SELECT COUNT(*) n FROM maintenance m ${where}`).get(...args) as any).n;const rows=db.query(`SELECT m.*,a.asset_tag FROM maintenance m JOIN assets a ON a.id=m.asset_id ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...args,size,offset);return json({data:rows,total,page,per_page:size});}
export function depreciation():Response{const rows=db.query(`SELECT a.id,a.asset_tag,a.name,m.name model,c.name category,a.purchase_date,a.purchase_cost,d.name schedule,d.months dep_months,d.floor_value,d.id depreciation_id FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN depreciation d ON d.id=m.depreciation_id WHERE a.purchase_cost IS NOT NULL ORDER BY a.asset_tag`).all() as any[];return json({data:rows.map(r=>{const cv=currentValue(r);return {...r,current_value:cv,fully_depreciated:r.depreciation_id&&cv!=null?cv<=Number(r.floor_value):null};}),total:rows.length,page:1,per_page:rows.length});}
export function accessories(url:URL):Response{
  const q=(url.searchParams.get("q")||"").trim(),locationId=url.searchParams.get("location_id")||"",where=["1=1"],args:any[]=[];
  if(q){where.push("a.name LIKE ?");args.push(`%${q}%`);}if(locationId&&/^\d+$/.test(locationId)){where.push("a.location_id=?");args.push(locationId);}
  const rows=db.query(`SELECT a.*,a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id AND x.checked_in_at IS NULL) available FROM accessories a WHERE ${where.join(" AND ")} ORDER BY a.name LIMIT 200`).all(...args);
  return json(rows);
}
export function accessory(id:string):Response{const a=accessoryRow(id);return a?json(a):apiErr("Accessory not found",404);}
export async function accessoryCreate(user:User,req:Request):Promise<Response>{
  const x=await body(req),error=accessoryValidation(x);if(error)return apiErr(error,400);
  const vals=ACCESSORY_FIELDS.map(k=>k==="name"?x.name.trim():k==="qty"||k==="min_qty"?(x[k]??0):(x[k]??null));
  try{const r=db.run(`INSERT INTO accessories(${ACCESSORY_FIELDS.join(",")}) VALUES(${ACCESSORY_FIELDS.map(()=>"?").join(",")})`,vals);logActivity(user.id,"create","accessory",Number(r.lastInsertRowid),x.name.trim());return json(accessoryRow(Number(r.lastInsertRowid)),201);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export async function accessoryPatch(user:User,id:string,req:Request):Promise<Response>{
  const old=accessoryRow(id);if(!old)return apiErr("Accessory not found",404);const x=await body(req),error=accessoryValidation(x,true);if(error)return apiErr(error,400);
  const keys=ACCESSORY_FIELDS.filter(k=>x[k]!==undefined);if(!keys.length)return apiErr("No patchable fields provided",400);
  try{db.run(`UPDATE accessories SET ${keys.map(k=>`${k}=?`).join(",")} WHERE id=?`,[...keys.map(k=>k==="name"?x[k].trim():x[k]),id]);const updated=accessoryRow(id);logActivity(user.id,"update","accessory",Number(id),updated.name);return json(updated);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export function accessoryDelete(user:User,id:string):Response{
  const a=accessoryRow(id);if(!a)return apiErr("Accessory not found",404);
  const active=(db.query("SELECT COUNT(*) n FROM accessory_checkouts WHERE accessory_id=? AND checked_in_at IS NULL").get(id) as any).n;
  if(active>0)return apiErr("Cannot delete accessory with active checkouts",409);
  db.run("DELETE FROM accessories WHERE id=?",[id]);logActivity(user.id,"delete","accessory",Number(id),a.name);return json({deleted:true});
}
export async function consumableCreate(user:User,req:Request):Promise<Response>{
  const x=await body(req),error=consumableValidation(x);if(error)return apiErr(error,400);
  const vals=CONSUMABLE_FIELDS.map(k=>k==="name"?x.name.trim():k==="qty"||k==="min_qty"?(x[k]??0):(x[k]??null));
  try{const r=db.run(`INSERT INTO consumables(${CONSUMABLE_FIELDS.join(",")}) VALUES(${CONSUMABLE_FIELDS.map(()=>"?").join(",")})`,vals);const row=db.query("SELECT * FROM consumables WHERE id=?").get(Number(r.lastInsertRowid));logActivity(user.id,"create","consumable",Number(r.lastInsertRowid),x.name.trim());return json(row,201);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export async function consumablePatch(user:User,id:string,req:Request):Promise<Response>{
  const old=db.query("SELECT * FROM consumables WHERE id=?").get(id) as any;if(!old)return apiErr("Consumable not found",404);
  const x=await body(req),error=consumableValidation(x,true);if(error)return apiErr(error,400);
  const keys=CONSUMABLE_FIELDS.filter(k=>x[k]!==undefined);if(!keys.length)return apiErr("No patchable fields provided",400);
  try{db.run(`UPDATE consumables SET ${keys.map(k=>`${k}=?`).join(",")} WHERE id=?`,[...keys.map(k=>k==="name"?x[k].trim():x[k]),id]);const row=db.query("SELECT * FROM consumables WHERE id=?").get(id);logActivity(user.id,"update","consumable",Number(id),(row as any).name);return json(row);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export function consumableDelete(user:User,id:string):Response{
  const c=db.query("SELECT * FROM consumables WHERE id=?").get(id) as any;if(!c)return apiErr("Consumable not found",404);
  db.run("DELETE FROM consumables WHERE id=?",[id]);logActivity(user.id,"delete","consumable",Number(id),c.name);return json({deleted:true});
}
export async function maintenanceCreate(user:User,req:Request):Promise<Response>{
  const x=await body(req),error=maintValidation(x);if(error)return apiErr(error,400);
  const asset=db.query("SELECT id,asset_tag FROM assets WHERE id=?").get(x.asset_id) as any;if(!asset)return apiErr("Asset not found",404);
  try{const r=db.run("INSERT INTO maintenance(asset_id,type,title,supplier_id,cost,notes,start_date,completion_date,completed,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",[x.asset_id,x.type,x.title.trim(),x.supplier_id??null,x.cost??null,x.notes??null,x.start_date,x.completion_date??null,x.completion_date?1:0,user.id]);const row=maintRow(Number(r.lastInsertRowid));logActivity(user.id,"create","maintenance",Number(r.lastInsertRowid),`Maintenance ${x.type}: ${x.title} logged on ${asset.asset_tag}`);return json(row,201);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export async function maintenancePatch(user:User,id:string,req:Request):Promise<Response>{
  const old=maintRow(id);if(!old)return apiErr("Maintenance not found",404);
  const x=await body(req),error=maintValidation(x,true);if(error)return apiErr(error,400);
  const keys=MAINT_WRITE_FIELDS.filter(k=>x[k]!==undefined);if(!keys.length)return apiErr("No patchable fields provided",400);
  try{const vals=keys.map(k=>k==="title"?x[k].trim():x[k]===null?null:x[k]),hasDone=keys.includes("completion_date"),done=hasDone?[x.completion_date!==null&&x.completion_date!==undefined?1:0]:[];db.run(`UPDATE maintenance SET ${keys.map(k=>`${k}=?`).join(",")}${hasDone?",completed=?":""} WHERE id=?`,[...vals,...done,id]);const row=maintRow(id);logActivity(user.id,"update","maintenance",Number(id),`Updated maintenance ${row.title} on ${row.asset_tag}`);return json(row);}
  catch(e:any){return apiErr(String(e?.message||"").includes("FOREIGN KEY")?"Invalid foreign key":"Internal server error",String(e?.message||"").includes("FOREIGN KEY")?400:500);}
}
export function maintenanceComplete(user:User,id:string):Response{
  const before=maintRow(id);const r=db.run("UPDATE maintenance SET completed=1,completion_date=COALESCE(completion_date,date('now')) WHERE id=? AND completed=0",[id]);
  if(!r.changes)return apiErr("Not found or already completed",404);
  logActivity(user.id,"complete","maintenance",Number(id),`Completed maintenance ${before?.title||id} on ${before?.asset_tag||""}`);return json(maintRow(id));
}
export function components(url:URL):Response{const q=(url.searchParams.get("q")||"").trim(),args:any[]=[],where=q?"WHERE c.name LIKE ? OR c.serial LIKE ?":"";if(q)args.push(`%${q}%`,`%${q}%`);return json(db.query(`SELECT c.*,c.qty-COALESCE((SELECT SUM(x.qty) FROM component_assets x WHERE x.component_id=c.id),0) available FROM components c ${where} ORDER BY c.name LIMIT 200`).all(...args));}
export function component(id:string):Response{const c=db.query(`SELECT c.*,c.qty-COALESCE((SELECT SUM(x.qty) FROM component_assets x WHERE x.component_id=c.id),0) available FROM components c WHERE c.id=?`).get(id);return c?json(c):apiErr("Component not found",404);}
export function locations():Response{return json(db.query("SELECT * FROM locations ORDER BY name").all());}
export function departments():Response{return json(db.query("SELECT * FROM departments ORDER BY name").all());}
export function users():Response{return json(db.query("SELECT id,name,username,email,role,department_id,created_at FROM users WHERE active=1 ORDER BY name").all());}
export function auditSessions():Response{return json(db.query(`SELECT s.id,s.name,s.location_id,l.name location_name,s.started_at,s.closed_at,
  (SELECT COUNT(*) FROM audit_items i WHERE i.session_id=s.id) expected,
  (SELECT COUNT(*) FROM audit_items i WHERE i.session_id=s.id AND i.verified_at IS NOT NULL) verified
  FROM audit_sessions s LEFT JOIN locations l ON l.id=s.location_id ORDER BY s.id DESC`).all());}

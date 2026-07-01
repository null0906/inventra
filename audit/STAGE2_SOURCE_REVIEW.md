# Stage 2 Source Review

This workspace has no Git metadata, so requested diffs cannot be generated against a repository baseline. Full current source snapshots are provided for every requested file.

## `src/depreciation.ts`

```typescript
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
<div class="card" style="padding:0"><table><tr><th>Name</th><th>Months</th><th>Minimum value</th><th>Models</th><th></th></tr>
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

```

## `src/maintenance.ts`

```typescript
import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, opt, pager, redirect } from "./web";
import { itemsPerPage } from "./settings";

const TYPES=["repair","upgrade","preventive","test","pat_test","software_support","hardware_support","other"];
function record(id:string):any{return db.query(`SELECT x.*,a.asset_tag,a.status asset_status FROM maintenance x JOIN assets a ON a.id=x.asset_id WHERE x.id=?`).get(id) as any;}
function form(a:any,m:any={}):string{
  const suppliers=db.query("SELECT id,name FROM suppliers ORDER BY name").all() as any[];
  return `<div class="card"><p style="margin-bottom:14px"><strong>Asset:</strong> ${esc(a.asset_tag)} &nbsp; <strong>Current status:</strong> ${esc(a.asset_status||a.status)}</p>
<div class="frm"><div><label>Maintenance type *</label><select name="type">${TYPES.map(t=>`<option${m.type===t?" selected":""}>${esc(t.replaceAll("_"," "))}</option>`).join("")}</select></div>
<div><label>Title *</label><input name="title" value="${esc(m.title||"")}" required></div>
<div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${opt(suppliers,m.supplier_id)}</select></div>
<div><label>Cost</label><input type="number" step="0.01" name="cost" value="${esc(m.cost??"")}"></div>
<div><label>Start date *</label><input type="date" name="start_date" value="${esc(m.start_date||"")}" required></div>
<div><label>Completion date</label><input type="date" name="completion_date" value="${esc(m.completion_date||"")}"></div></div>
<div style="margin-bottom:14px"><label>Notes</label><textarea name="notes" rows="3">${esc(m.notes||"")}</textarea></div>`;
}
function vals(v:(k:string)=>string):any[]{const type=TYPES.includes(v("type"))?v("type"):"other";return [type,v("title"),v("supplier_id")||null,v("cost")||null,v("notes")||null,v("start_date"),v("completion_date")||null];}
function rowsHtml(rows:any[],canEdit:boolean):string{return `<div class="card" style="padding:0"><table><tr><th>Asset</th><th>Type</th><th>Title</th><th>Started</th><th>Completed</th><th>Cost</th><th></th></tr>${rows.map(m=>`<tr><td><a href="/assets/${m.asset_id}">${esc(m.asset_tag)}</a></td><td>${esc(m.type.replaceAll("_"," "))}</td><td>${esc(m.title)}</td><td>${esc(m.start_date)}</td><td>${m.completed?esc(m.completion_date||"yes"):'<span class="badge b-amber">open</span>'}</td><td>${m.cost==null?"":Number(m.cost).toFixed(2)}</td><td>${canEdit?`<a class="btn sec sm" href="/maintenance/${m.id}/edit">Edit</a> ${m.completed?"":`<form class="inline" method="post" action="/maintenance/${m.id}/complete"><button class="btn sm">Complete</button></form>`} <form class="inline" method="post" action="/maintenance/${m.id}/delete"><button class="btn danger sm">Delete</button></form>`:""}</td></tr>`).join("")}</table></div>`;}

export function list(user:User,url:URL):Response{
  const size=itemsPerPage(),page=Math.max(1,Number(url.searchParams.get("page"))||1);
  const total=(db.query("SELECT COUNT(*) n FROM maintenance").get() as any).n;
  const rows=db.query(`SELECT x.*,a.asset_tag FROM maintenance x JOIN assets a ON a.id=x.asset_id ORDER BY x.id DESC LIMIT ? OFFSET ?`).all(size,(page-1)*size) as any[];
  return layout(user,"Maintenance",`<h1>Maintenance records <span class="muted">(${total})</span></h1>${rowsHtml(rows,true)}${pager(url,page,total,size)}`,"/maintenance",url.searchParams.get("m")||"");
}
export function assetList(user:User,id:string,url:URL,canEdit:boolean):Response{
  const a=db.query("SELECT id,asset_tag FROM assets WHERE id=?").get(id) as any;if(!a)return layout(user,"Not found","<h1>Asset not found</h1>","/assets");
  const rows=db.query(`SELECT x.*,a.asset_tag FROM maintenance x JOIN assets a ON a.id=x.asset_id WHERE x.asset_id=? ORDER BY x.id DESC`).all(id) as any[];
  return layout(user,"Asset maintenance",`<h1>Maintenance for ${esc(a.asset_tag)}</h1><div class="toolbar">${canEdit?`<a class="btn" href="/assets/${id}/maintenance/new">+ Log maintenance</a>`:""}<a class="btn sec" href="/assets/${id}">Back to asset</a></div>${rowsHtml(rows,canEdit)}`,"/assets",url.searchParams.get("m")||"");
}
export function newPage(user:User,id:string):Response{
  const a=db.query("SELECT id,asset_tag,status FROM assets WHERE id=?").get(id) as any;
  return a?layout(user,"Log maintenance",`<h1>Log maintenance</h1><form method="post" action="/assets/${id}/maintenance">${form(a)}<button class="btn">Create record</button></form>`,"/maintenance"):layout(user,"Not found","<h1>Asset not found</h1>","/assets");
}
export async function create(user:User,id:string,req:Request):Promise<Response>{
  const a=db.query("SELECT id,asset_tag FROM assets WHERE id=?").get(id) as any;if(!a)return redirect("/maintenance?m=Asset not found");
  const v=await formVals(req);if(!v("title")||!v("start_date"))return redirect(`/assets/${id}/maintenance/new?m=Title and start date are required`);
  const r=db.run("INSERT INTO maintenance(asset_id,type,title,supplier_id,cost,notes,start_date,completion_date,completed,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",[id,...vals(v),v("completion_date")?1:0,user.id]);
  logActivity(user.id,"create","maintenance",Number(r.lastInsertRowid),`Maintenance ${TYPES.includes(v("type"))?v("type"):"other"}: ${v("title")} logged on ${a.asset_tag}`);
  return redirect(`/assets/${id}/maintenance?m=Maintenance logged`);
}
export function editPage(user:User,id:string):Response{
  const m=record(id);return m?layout(user,"Edit maintenance",`<h1>Edit maintenance</h1><form method="post" action="/maintenance/${id}/edit">${form(m,m)}<button class="btn">Save</button></form>`,"/maintenance"):layout(user,"Not found","<h1>Maintenance record not found</h1>","/maintenance");
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

```

## `src/db.ts`

```typescript
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const dataDir = process.env.DATA_DIR || "./data";
mkdirSync(dataDir, { recursive: true });

export const db = new Database(`${dataDir}/app.db`, { create: true });
try {
  db.exec("PRAGMA journal_mode = WAL;");
} catch {
  db.exec("PRAGMA journal_mode = DELETE;"); // filesystems without WAL support
}
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  csrf_token TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  ctype TEXT NOT NULL DEFAULT 'asset'
);
CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact TEXT
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  model_no TEXT,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  eol_months INTEGER
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  serial TEXT,
  name TEXT,
  model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'deployable',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date TEXT,
  purchase_cost REAL,
  warranty_months INTEGER,
  order_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  product_key TEXT,
  seats INTEGER NOT NULL DEFAULT 1,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  purchase_date TEXT,
  purchase_cost REAL,
  expires TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS license_seats (
  id INTEGER PRIMARY KEY,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consumables (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  cost REAL
);
CREATE TABLE IF NOT EXISTS accessories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS accessory_checkouts (
  id INTEGER PRIMARY KEY,
  accessory_id INTEGER NOT NULL REFERENCES accessories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  cost REAL,
  serial TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS component_assets (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(component_id, asset_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  months INTEGER NOT NULL CHECK(months > 0),
  floor_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'repair','upgrade','preventive','test',
    'pat_test','software_support','hardware_support','other'
  )),
  title TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  cost REAL,
  notes TEXT,
  start_date TEXT NOT NULL,
  completion_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_accessory_checkouts_accessory ON accessory_checkouts(accessory_id);
CREATE INDEX IF NOT EXISTS idx_component_assets_component ON component_assets(component_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance(asset_id);
`);

function addColumn(sql: string): void {
  try { db.exec(sql); } catch {}
}
addColumn("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
addColumn("ALTER TABLE assets ADD COLUMN purchase_date TEXT");
addColumn("ALTER TABLE assets ADD COLUMN purchase_cost REAL");
addColumn("ALTER TABLE assets ADD COLUMN warranty_months INTEGER");
addColumn("ALTER TABLE assets ADD COLUMN order_number TEXT");
addColumn("ALTER TABLE assets ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)");
addColumn("ALTER TABLE models ADD COLUMN depreciation_id INTEGER REFERENCES depreciation(id)");

const userCount = (db.query("SELECT COUNT(*) AS n FROM users").get() as any).n;
if (userCount === 0) {
  const hash = Bun.password.hashSync(process.env.ADMIN_PASSWORD || "admin123", "bcrypt");
  db.run(
    "INSERT INTO users (name, username, email, password_hash, role) VALUES (?,?,?,?,?)",
    ["Administrator", "admin", "admin@example.com", hash, "admin"]
  );
  for (const c of ["Laptop", "Desktop", "Monitor", "Phone", "Printer", "Networking"])
    db.run("INSERT INTO categories (name, ctype) VALUES (?, 'asset')", [c]);
  db.run("INSERT INTO categories (name, ctype) VALUES ('Software', 'license')");
  db.run("INSERT INTO categories (name, ctype) VALUES ('Office Supplies', 'consumable')");
  console.log("Seeded default admin user (admin). Change the password immediately.");
}

export function logActivity(
  actorId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  detail = ""
) {
  db.run(
    "INSERT INTO activity (actor_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)",
    [actorId, action, entityType, entityId, detail]
  );
}

```

## `src/assets.ts`

```typescript
import { db, logActivity } from "./db";
import type { User } from "./auth";
import { badge, esc, formVals, layout, opt, pager, redirect } from "./web";
import { getSetting, itemsPerPage } from "./settings";
import { assetInstalled } from "./components";
import { currentValue } from "./depreciation";

const STATUSES = ["deployable", "deployed", "maintenance", "archived"];

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
  return opt(db.query(`SELECT id, name FROM ${table} ORDER BY name`).all() as any[], selected);
}

function assetForm(a: any = {}): string {
  return `<div class="frm">
<div><label>Asset tag *</label><input name="asset_tag" value="${esc(a.asset_tag ?? "")}" required></div>
<div><label>Serial</label><input name="serial" value="${esc(a.serial ?? "")}"></div>
<div><label>Name</label><input name="name" value="${esc(a.name ?? "")}"></div>
<div><label>Model</label><select name="model_id"><option value="">—</option>${modelOptions(a.model_id)}</select></div>
<div><label>Status</label><select name="status">${STATUSES.map((s) => `<option${a.status === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
<div><label>Location</label><select name="location_id"><option value="">—</option>${lookupOptions("locations", a.location_id)}</select></div>
<div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${lookupOptions("suppliers", a.supplier_id)}</select></div>
<div><label>Purchase date</label><input name="purchase_date" type="date" value="${esc(a.purchase_date ?? "")}"></div>
<div><label>Purchase cost</label><input name="purchase_cost" type="number" step="0.01" value="${esc(a.purchase_cost ?? "")}"></div>
<div><label>Warranty (months)</label><input name="warranty_months" type="number" value="${esc(a.warranty_months ?? "")}"></div>
<div><label>Order number</label><input name="order_number" value="${esc(a.order_number ?? "")}"></div>
</div>
<div style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:#4b5563">Notes</label><textarea name="notes" rows="3">${esc(a.notes ?? "")}</textarea></div>`;
}

function assetVals(v: (k: string) => string): any[] {
  const n = (k: string) => (v(k) === "" ? null : v(k));
  return [
    v("asset_tag"),
    n("serial"),
    n("name"),
    n("model_id"),
    v("status") || "deployable",
    n("location_id"),
    n("supplier_id"),
    n("purchase_date"),
    n("purchase_cost"),
    n("warranty_months"),
    n("order_number"),
    n("notes"),
  ];
}

const ASSET_COLS =
  "asset_tag, serial, name, model_id, status, location_id, supplier_id, purchase_date, purchase_cost, warranty_months, order_number, notes";

export function assetsPage(user: User, url: URL, canEdit: boolean): Response {
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  let where = "1=1";
  const args: any[] = [];
  if (q) {
    where += " AND (a.asset_tag LIKE ? OR a.serial LIKE ? OR a.name LIKE ? OR m.name LIKE ?)";
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (status) {
    where += " AND a.status = ?";
    args.push(status);
  }
  const pageSize = itemsPerPage();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const total = (db.query(`SELECT COUNT(*) n FROM assets a LEFT JOIN models m ON m.id=a.model_id WHERE ${where}`).get(...args) as any).n;
  const rows = db
    .query(
      `SELECT a.id, a.asset_tag, a.serial, a.name, a.status, m.name AS model, u.name AS assignee, l.name AS location
       FROM assets a
       LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN users u ON u.id = a.assigned_to
       LEFT JOIN locations l ON l.id = a.location_id
       WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize) as any[];
  const body = `<h1>Assets <span class="muted">(${total})</span></h1>
<div class="toolbar no-print">
<form method="get" action="/assets" style="display:flex;gap:8px">
<input name="q" placeholder="Search tag, serial, name, model…" value="${esc(q)}">
<select name="status" onchange="this.form.submit()"><option value="">All statuses</option>${STATUSES.map((s) => `<option${status === s ? " selected" : ""}>${s}</option>`).join("")}</select>
<button class="btn sec">Search</button></form>
${canEdit ? `<a class="btn" href="/assets/new">+ New asset</a>` : ""}
<a class="btn sec" href="/labels${status ? `?status=${status}` : ""}">Print labels</a>
</div>
<div class="card" style="padding:0"><table>
<tr><th>Tag</th><th>Name</th><th>Model</th><th>Serial</th><th>Status</th><th>Assigned to</th><th>Location</th></tr>
${rows
  .map(
    (r) => `<tr><td><a href="/assets/${r.id}">${esc(r.asset_tag)}</a></td><td>${esc(r.name ?? "")}</td>
<td>${esc(r.model ?? "")}</td><td>${esc(r.serial ?? "")}</td><td>${badge(r.status)}</td>
<td>${esc(r.assignee ?? "")}</td><td>${esc(r.location ?? "")}</td></tr>`
  )
  .join("")}
</table></div>${pager(url,page,total,pageSize)}`;
  return layout(user, "Assets", body, "/assets", url.searchParams.get("m") || "");
}

export function assetNewPage(user: User): Response {
  const prefix = getSetting("asset_tag_prefix", "AST-");
  let n = 1;
  while (db.query("SELECT 1 FROM assets WHERE asset_tag=?").get(`${prefix}${String(n).padStart(5,"0")}`)) n++;
  return layout(
    user,
    "New asset",
    `<h1>New asset</h1><div class="card"><form method="post" action="/assets">${assetForm({asset_tag:`${prefix}${String(n).padStart(5,"0")}`})}
<button class="btn">Create</button> <a class="btn sec" href="/assets">Cancel</a></form></div>`,
    "/assets"
  );
}

export async function assetCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  try {
    const r = db.run(
      `INSERT INTO assets (${ASSET_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      assetVals(v)
    );
    logActivity(user.id, "create", "asset", Number(r.lastInsertRowid), v("asset_tag"));
    return redirect(`/assets/${r.lastInsertRowid}?m=Asset created`);
  } catch (e: any) {
    return redirect(`/assets?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function assetDetail(user: User, id: string, url: URL, canEdit: boolean): Response {
  const a = db
    .query(
      `SELECT a.*, m.name AS model, m.depreciation_id, d.name AS depreciation_name, d.months AS dep_months, d.floor_value,
       mf.name AS manufacturer, u.name AS assignee, l.name AS location, s.name AS supplier
       FROM assets a
       LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN depreciation d ON d.id = m.depreciation_id
       LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
       LEFT JOIN users u ON u.id = a.assigned_to
       LEFT JOIN locations l ON l.id = a.location_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.id = ?`
    )
    .get(id) as any;
  if (!a) return layout(user, "Not found", "<h1>Asset not found</h1>", "/assets");
  const history = db
    .query(
      `SELECT act.*, u.name AS actor FROM activity act LEFT JOIN users u ON u.id = act.actor_id
       WHERE act.entity_type = 'asset' AND act.entity_id = ? ORDER BY act.id DESC LIMIT 100`
    )
    .all(id) as any[];
  const users = db.query("SELECT id, name FROM users WHERE active = 1 ORDER BY name").all() as any[];
  const components = assetInstalled(id);
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
${row("Status", badge(a.status))}
${row("Assigned to", esc(a.assignee ?? "—"))}
${row("Location", esc(a.location ?? ""))}
${row("Supplier", esc(a.supplier ?? ""))}
${row("Purchased", esc(a.purchase_date ?? "") + (a.purchase_cost != null ? ` · $${Number(a.purchase_cost).toFixed(2)}` : ""))}
${row("Order number", esc(a.order_number ?? ""))}
${row("Warranty", esc(warranty))}
${row("Depreciation schedule", esc(a.depreciation_name ?? "—"))}
${row("Current value", value == null ? "—" : `$${value.toFixed(2)}`)}
${row("Notes", esc(a.notes ?? ""))}
</table>`;
  const actions = !canEdit
    ? ""
    : `<div class="card no-print">
${
  a.status === "deployed"
    ? `<form method="post" action="/assets/${a.id}/checkin" class="inline"><button class="btn">Check in</button></form>`
    : a.status === "deployable"
      ? `<form method="post" action="/assets/${a.id}/checkout" style="display:flex;gap:8px;align-items:end">
<div style="flex:1"><label style="font-size:12px;font-weight:600">Check out to</label><select name="user_id" required><option value="">Select user…</option>${opt(users, "")}</select></div>
<div style="flex:1"><label style="font-size:12px;font-weight:600">Note</label><input name="note"></div>
<button class="btn">Check out</button></form>`
      : `<span class="muted">Asset is in ${esc(a.status)} — set status to deployable to check out.</span>`
}
<div style="margin-top:12px">
<a class="btn sec sm" href="/assets/${a.id}/edit">Edit</a>
<form class="inline" method="post" action="/assets/${a.id}/delete" onsubmit="return confirm('Delete this asset?')"><button class="btn danger sm">Delete</button></form>
</div></div>`;
  const hist = `<h2>History</h2><div class="card" style="padding:0"><table>
<tr><th>When</th><th>Action</th><th>By</th><th>Detail</th></tr>
${history.map((h) => `<tr><td>${esc(h.at)}</td><td>${esc(h.action)}</td><td>${esc(h.actor ?? "")}</td><td>${esc(h.detail ?? "")}</td></tr>`).join("")}
</table></div>`;
  const body = `<h1>${esc(a.asset_tag)} <span class="muted">${esc(a.name ?? "")}</span></h1>
<div class="toolbar"><a class="btn sec sm" href="/assets/${a.id}/maintenance">Maintenance history</a></div>
<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
<div class="card" style="flex:1;min-width:340px">${info}</div>
<div class="card" style="text-align:center"><img src="/qr/${a.id}.svg" width="140" height="140" alt="QR"><div class="muted">${esc(a.asset_tag)}</div></div>
</div>
${actions}<h2>Installed components</h2><div class="card" style="padding:0"><table><tr><th>Component</th><th>Quantity</th><th>Installed</th></tr>${components.map(c=>`<tr><td><a href="/components/${c.id}">${esc(c.name)}</a></td><td>${c.qty}</td><td>${esc(c.at)}</td></tr>`).join("")}</table></div>${hist}`;
  return layout(user, a.asset_tag, body, "/assets", url.searchParams.get("m") || "");
}

export function assetEditPage(user: User, id: string): Response {
  const a = db.query("SELECT * FROM assets WHERE id = ?").get(id) as any;
  if (!a) return layout(user, "Not found", "<h1>Asset not found</h1>", "/assets");
  return layout(
    user,
    `Edit ${a.asset_tag}`,
    `<h1>Edit ${esc(a.asset_tag)}</h1><div class="card"><form method="post" action="/assets/${id}">${assetForm(a)}
<button class="btn">Save</button> <a class="btn sec" href="/assets/${id}">Cancel</a></form></div>`,
    "/assets"
  );
}

export async function assetUpdate(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req);
  try {
    db.run(
      `UPDATE assets SET asset_tag=?, serial=?, name=?, model_id=?, status=?, location_id=?, supplier_id=?, purchase_date=?, purchase_cost=?, warranty_months=?, order_number=?, notes=? WHERE id=?`,
      [...assetVals(v), id]
    );
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
  const target = db.query("SELECT id, name FROM users WHERE id = ? AND active = 1").get(v("user_id")) as any;
  const a = db.query("SELECT * FROM assets WHERE id = ? AND status = 'deployable'").get(id) as any;
  if (!a || !target) return redirect(`/assets/${id}?m=${encodeURIComponent("Cannot check out.")}`);
  db.run("UPDATE assets SET assigned_to = ?, status = 'deployed' WHERE id = ?", [target.id, id]);
  logActivity(user.id, "checkout", "asset", Number(id), `to ${target.name}${v("note") ? ` — ${v("note")}` : ""}`);
  return redirect(`/assets/${id}?m=${encodeURIComponent(`Checked out to ${target.name}`)}`);
}

export function assetCheckin(user: User, id: string): Response {
  const a = db
    .query("SELECT a.*, u.name AS assignee FROM assets a LEFT JOIN users u ON u.id = a.assigned_to WHERE a.id = ?")
    .get(id) as any;
  if (!a || a.status !== "deployed") return redirect(`/assets/${id}?m=${encodeURIComponent("Not checked out.")}`);
  db.run("UPDATE assets SET assigned_to = NULL, status = 'deployable' WHERE id = ?", [id]);
  logActivity(user.id, "checkin", "asset", Number(id), `from ${a.assignee || "?"}`);
  return redirect(`/assets/${id}?m=Checked in`);
}

```

## `src/misc.ts`

```typescript
// Dashboard, activity log, reports (CSV), QR labels
import QRCode from "qrcode";
import { db } from "./db";
import type { User } from "./auth";
import { badge, esc, layout, pager } from "./web";
import { baseUrl, itemsPerPage } from "./settings";

export function dashboard(user: User, url: URL): Response {
  const n = (sql: string) => (db.query(sql).get() as any).n;
  const stats: [string, number][] = [
    ["Total assets", n("SELECT COUNT(*) AS n FROM assets")],
    ["Deployed", n("SELECT COUNT(*) AS n FROM assets WHERE status = 'deployed'")],
    ["Deployable", n("SELECT COUNT(*) AS n FROM assets WHERE status = 'deployable'")],
    ["In maintenance", n("SELECT COUNT(*) AS n FROM assets WHERE status = 'maintenance'")],
    ["Open maintenance", n("SELECT COUNT(*) AS n FROM maintenance WHERE completed = 0")],
    ["Licenses", n("SELECT COUNT(*) AS n FROM licenses")],
    ["Seats in use", n("SELECT COUNT(*) AS n FROM license_seats")],
    ["Low-stock items", n("SELECT COUNT(*) AS n FROM consumables WHERE qty <= min_qty")],
    ["Active users", n("SELECT COUNT(*) AS n FROM users WHERE active = 1")],
  ];
  const recent = db
    .query(
      `SELECT act.*, u.name AS actor FROM activity act LEFT JOIN users u ON u.id = act.actor_id
       ORDER BY act.id DESC LIMIT 12`
    )
    .all() as any[];
  const expiring = db
    .query(
      `SELECT id, name, expires FROM licenses
       WHERE expires IS NOT NULL AND expires <= date('now', '+90 days') ORDER BY expires LIMIT 10`
    )
    .all() as any[];
  const low = db
    .query("SELECT id, name, qty, min_qty FROM consumables WHERE qty <= min_qty ORDER BY name LIMIT 10")
    .all() as any[];
  const body = `<h1>Dashboard</h1>
<div class="stats">${stats.map(([l, v]) => `<div class="stat"><div class="n">${v}</div><div class="l">${l}</div></div>`).join("")}</div>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
<div class="card" style="flex:2;min-width:380px;padding:0"><table>
<tr><th colspan="4" style="padding:12px 10px 6px">Recent activity</th></tr>
${recent.map((r) => `<tr><td class="muted" style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.actor ?? "")}</td><td>${esc(r.action)} ${esc(r.entity_type)}</td><td>${esc(r.detail ?? "")}</td></tr>`).join("")}
</table></div>
<div style="flex:1;min-width:260px">
${
  expiring.length
    ? `<div class="card" style="padding:0"><table><tr><th colspan="2" style="padding:12px 10px 6px">Licenses expiring ≤ 90 days</th></tr>
${expiring.map((l) => `<tr><td><a href="/licenses/${l.id}">${esc(l.name)}</a></td><td>${esc(l.expires)}</td></tr>`).join("")}</table></div>`
    : ""
}
${
  low.length
    ? `<div class="card" style="padding:0"><table><tr><th colspan="2" style="padding:12px 10px 6px">Low stock</th></tr>
${low.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.qty} / min ${c.min_qty}</td></tr>`).join("")}</table></div>`
    : ""
}
</div></div>`;
  return layout(user, "Dashboard", body, "/", url.searchParams.get("m") || "");
}

export function activityPage(user: User, url: URL): Response {
  const type = url.searchParams.get("type") || "";
  const types = ["asset", "license", "consumable", "accessory", "component", "maintenance", "depreciation", "user", "settings", "category", "manufacturer", "supplier", "location", "model"];
  let where = "1=1";
  const args: any[] = [];
  if (type) {
    where = "act.entity_type = ?";
    args.push(type);
  }
  const pageSize=itemsPerPage(), page=Math.max(1,Number(url.searchParams.get("page"))||1);
  const total=(db.query(`SELECT COUNT(*) n FROM activity act WHERE ${where}`).get(...args) as any).n;
  const rows = db
    .query(
      `SELECT act.*, u.name AS actor FROM activity act LEFT JOIN users u ON u.id = act.actor_id
       WHERE ${where} ORDER BY act.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args,pageSize,(page-1)*pageSize) as any[];
  const body = `<h1>Activity log</h1>
<div class="toolbar"><form method="get" action="/activity">
<select name="type" onchange="this.form.submit()"><option value="">All types</option>
${types.map((t) => `<option${type === t ? " selected" : ""}>${t}</option>`).join("")}</select></form>
<a class="btn sec" href="/reports/activity.csv">Export CSV</a></div>
<div class="card" style="padding:0"><table>
<tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Detail</th></tr>
${rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.actor ?? "")}</td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}</td><td>${esc(r.detail ?? "")}</td></tr>`).join("")}
</table></div>${pager(url,page,total,pageSize)}`;
  return layout(user, "Activity", body, "/activity");
}

function csv(rows: any[], filename: string): Response {
  if (!rows.length) return new Response("", { headers: { "Content-Type": "text/csv" } });
  const cols = Object.keys(rows[0]);
  const q = (x: any) => {
    const s = String(x ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function reportsPage(user: User): Response {
  const reports = [
    ["assets", "All assets with model, status, assignee, location, cost"],
    ["licenses", "Licenses with seat usage and expiry"],
    ["consumables", "Consumable stock levels"],
    ["accessories", "Accessory stock and active checkouts"],
    ["components", "Component stock and installed quantities"],
    ["depreciation", "Asset purchase costs and current depreciated values"],
    ["activity", "Full activity / audit log"],
  ];
  const body = `<h1>Reports</h1><div class="card"><table>
<tr><th>Report</th><th>Description</th><th></th></tr>
${reports.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td><td><a class="btn sec sm" href="/reports/${k === "depreciation" ? "depreciation" : `${k}.csv`}">Download CSV</a></td></tr>`).join("")}
</table></div>`;
  return layout(user, "Reports", body, "/reports");
}

export function reportCsv(name: string): Response | null {
  const queries: Record<string, string> = {
    assets: `SELECT a.asset_tag, a.name, a.serial, m.name AS model, mf.name AS manufacturer, a.status,
        u.name AS assigned_to, l.name AS location, s.name AS supplier, a.purchase_date, a.purchase_cost,
        a.order_number, a.warranty_months, a.notes, a.created_at
      FROM assets a
      LEFT JOIN models m ON m.id = a.model_id
      LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
      LEFT JOIN users u ON u.id = a.assigned_to
      LEFT JOIN locations l ON l.id = a.location_id
      LEFT JOIN suppliers s ON s.id = a.supplier_id ORDER BY a.asset_tag`,
    licenses: `SELECT l.name, mf.name AS manufacturer, l.seats,
        (SELECT COUNT(*) FROM license_seats s WHERE s.license_id = l.id) AS seats_used,
        l.purchase_date, l.purchase_cost, l.expires, l.notes
      FROM licenses l LEFT JOIN manufacturers mf ON mf.id = l.manufacturer_id ORDER BY l.name`,
    consumables: `SELECT c.name, cat.name AS category, loc.name AS location, c.qty, c.min_qty, c.cost
      FROM consumables c LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN locations loc ON loc.id = c.location_id ORDER BY c.name`,
    accessories: `SELECT a.name,cat.name category,m.name manufacturer,s.name supplier,l.name location,a.qty,
      a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id) available,a.min_qty,a.cost,a.notes
      FROM accessories a LEFT JOIN categories cat ON cat.id=a.category_id LEFT JOIN manufacturers m ON m.id=a.manufacturer_id
      LEFT JOIN suppliers s ON s.id=a.supplier_id LEFT JOIN locations l ON l.id=a.location_id ORDER BY a.name`,
    components: `SELECT c.name,cat.name category,l.name location,c.qty,
      c.qty-COALESCE((SELECT SUM(qty) FROM component_assets x WHERE x.component_id=c.id),0) available,c.min_qty,c.cost,c.serial,c.notes
      FROM components c LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN locations l ON l.id=c.location_id ORDER BY c.name`,
    activity: `SELECT act.at, u.name AS actor, act.action, act.entity_type, act.entity_id, act.detail
      FROM activity act LEFT JOIN users u ON u.id = act.actor_id ORDER BY act.id DESC`,
  };
  const sql = queries[name];
  if (!sql) return null;
  return csv(db.query(sql).all() as any[], `${name}.csv`);
}

function qrContent(asset: { id: number; asset_tag: string }): string {
  const base = baseUrl();
  return base ? `${base.replace(/\/$/, "")}/assets/${asset.id}` : asset.asset_tag;
}

export function myItems(user: User): Response {
  const assets=db.query("SELECT id,asset_tag,name,status FROM assets WHERE assigned_to=? ORDER BY asset_tag").all(user.id) as any[];
  const accessories=db.query("SELECT a.id,a.name,x.at,x.note FROM accessory_checkouts x JOIN accessories a ON a.id=x.accessory_id WHERE x.user_id=? ORDER BY a.name").all(user.id) as any[];
  const licenses=db.query("SELECT l.id,l.name,s.assigned_at FROM license_seats s JOIN licenses l ON l.id=s.license_id WHERE s.user_id=? ORDER BY l.name").all(user.id) as any[];
  const table=(headers:string[],rows:string)=>`<div class="card" style="padding:0"><table><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr>${rows}</table></div>`;
  return layout(user,"My Items",`<h1>My Items</h1><h2>Assets</h2>${table(["Tag","Name","Status"],assets.map(a=>`<tr><td><a href="/assets/${a.id}">${esc(a.asset_tag)}</a></td><td>${esc(a.name||"")}</td><td>${badge(a.status)}</td></tr>`).join(""))}<h2>Accessories</h2>${table(["Name","Checked out","Note"],accessories.map(a=>`<tr><td><a href="/accessories/${a.id}">${esc(a.name)}</a></td><td>${esc(a.at)}</td><td>${esc(a.note||"")}</td></tr>`).join(""))}<h2>License seats</h2>${table(["License","Assigned"],licenses.map(l=>`<tr><td><a href="/licenses/${l.id}">${esc(l.name)}</a></td><td>${esc(l.assigned_at)}</td></tr>`).join(""))}`,"/my");
}

export async function qrSvg(id: string): Promise<Response> {
  const a = db.query("SELECT id, asset_tag FROM assets WHERE id = ?").get(id) as any;
  if (!a) return new Response("Not found", { status: 404 });
  const svg = await QRCode.toString(qrContent(a), { type: "svg", margin: 1 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
}

export async function labelsPage(user: User, url: URL): Promise<Response> {
  const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
  const status = url.searchParams.get("status") || "";
  let rows: any[];
  if (ids.length) {
    rows = db
      .query(`SELECT id, asset_tag, name FROM assets WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as any[];
  } else {
    rows = db
      .query(
        `SELECT id, asset_tag, name FROM assets WHERE ${status ? "status = ?" : "status != 'archived'"} ORDER BY asset_tag LIMIT 200`
      )
      .all(...(status ? [status] : [])) as any[];
  }
  const cards = await Promise.all(
    rows.map(async (a) => {
      const svg = await QRCode.toString(qrContent(a), { type: "svg", margin: 1 });
      return `<div class="label-card">${svg}<div><strong>${esc(a.asset_tag)}</strong></div><div class="muted">${esc(a.name ?? "")}</div></div>`;
    })
  );
  const body = `<div class="toolbar no-print"><h1 style="margin:0;flex:1">Labels (${rows.length})</h1>
<button class="btn" onclick="window.print()">Print</button> <a class="btn sec" href="/assets">Back</a></div>
<div class="labels">${cards.join("")}</div>`;
  return layout(user, "Labels", body, "/assets");
}

```

## `src/server.ts`

```typescript
import { doLogin, doLogout, forbidden, getUser, hasRole, loginPage, profilePage, profileUpdate, verifyCsrf, type User } from "./auth";
import { esc, layout, redirect } from "./web";
import * as A from "./assets";
import * as C from "./catalog";
import * as L from "./licenses";
import * as K from "./consumables";
import * as U from "./users";
import * as M from "./misc";
import * as X from "./accessories";
import * as P from "./components";
import * as S from "./settings";
import * as D from "./depreciation";
import * as N from "./maintenance";

type Ctx = { req: Request; url: URL; params: Record<string, string>; user: User };
type Handler = (c: Ctx) => Response | Promise<Response>;
type Route = { m: string; re: RegExp; keys: string[]; h: Handler; role: string };

const routes: Route[] = [];
const trustProxy = process.env.TRUST_PROXY === "1";

function add(m: string, path: string, h: Handler, role = "viewer") {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      path
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\$\\\{[^}]*\\\}/g, "") // safety, unused
        .replace(/:([a-zA-Z]+)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        }) +
      "$"
  );
  routes.push({ m, re, keys, h, role });
}

// Dashboard / misc
add("GET", "/", (c) => M.dashboard(c.user, c.url));
add("GET", "/activity", (c) => M.activityPage(c.user, c.url), "manager");
add("GET", "/reports", (c) => M.reportsPage(c.user));
add("GET", "/reports/:name.csv", (c) => M.reportCsv(c.params.name) || notFound(c.user));
add("GET", "/reports/depreciation", () => D.csvReport());
add("GET", "/qr/:id.svg", (c) => M.qrSvg(c.params.id));
add("GET", "/labels", (c) => M.labelsPage(c.user, c.url));
add("GET", "/my", (c) => M.myItems(c.user));
add("GET", "/profile", (c) => profilePage(c.user, c.url));
add("POST", "/profile", (c) => profileUpdate(c.user, c.req));
add("GET", "/settings", (c) => S.settingsPage(c.user, c.url), "admin");
add("POST", "/settings", (c) => S.settingsUpdate(c.user, c.req), "admin");
add("GET", "/depreciation", (c) => D.list(c.user, c.url), "admin");
add("GET", "/depreciation/new", (c) => D.newPage(c.user), "admin");
add("POST", "/depreciation", (c) => D.create(c.user, c.req), "admin");
add("GET", "/depreciation/:id/edit", (c) => D.editPage(c.user, c.params.id), "admin");
add("POST", "/depreciation/:id/edit", (c) => D.update(c.user, c.params.id, c.req), "admin");
add("POST", "/depreciation/:id/delete", (c) => D.remove(c.user, c.params.id), "admin");

// Maintenance
add("GET", "/maintenance", (c) => N.list(c.user, c.url), "manager");
add("GET", "/assets/:id/maintenance", (c) => N.assetList(c.user, c.params.id, c.url, hasRole(c.user, "manager")));
add("GET", "/assets/:id/maintenance/new", (c) => N.newPage(c.user, c.params.id), "manager");
add("POST", "/assets/:id/maintenance", (c) => N.create(c.user, c.params.id, c.req), "manager");
add("GET", "/maintenance/:id/edit", (c) => N.editPage(c.user, c.params.id), "manager");
add("POST", "/maintenance/:id/edit", (c) => N.update(c.user, c.params.id, c.req), "manager");
add("POST", "/maintenance/:id/complete", (c) => N.complete(c.user, c.params.id), "manager");
add("POST", "/maintenance/:id/delete", (c) => N.remove(c.user, c.params.id), "manager");

// Assets
add("GET", "/assets", (c) => A.assetsPage(c.user, c.url, hasRole(c.user, "manager")));
add("GET", "/assets/new", (c) => A.assetNewPage(c.user), "manager");
add("POST", "/assets", (c) => A.assetCreate(c.user, c.req), "manager");
add("GET", "/assets/:id", (c) => A.assetDetail(c.user, c.params.id, c.url, hasRole(c.user, "manager")));
add("GET", "/assets/:id/edit", (c) => A.assetEditPage(c.user, c.params.id), "manager");
add("POST", "/assets/:id", (c) => A.assetUpdate(c.user, c.params.id, c.req), "manager");
add("POST", "/assets/:id/edit", (c) => A.assetUpdate(c.user, c.params.id, c.req), "manager");
add("POST", "/assets/:id/delete", (c) => A.assetDelete(c.user, c.params.id), "manager");
add("POST", "/assets/:id/checkout", (c) => A.assetCheckout(c.user, c.params.id, c.req), "manager");
add("POST", "/assets/:id/checkin", (c) => A.assetCheckin(c.user, c.params.id), "manager");

// Licenses
add("GET", "/licenses", (c) => L.licensesPage(c.user, c.url, hasRole(c.user, "manager")));
add("GET", "/licenses/new", (c) => L.licenseNewPage(c.user), "manager");
add("POST", "/licenses", (c) => L.licenseCreate(c.user, c.req), "manager");
add("GET", "/licenses/:id", (c) => L.licenseDetail(c.user, c.params.id, c.url, hasRole(c.user, "manager")));
add("GET", "/licenses/:id/edit", (c) => L.licenseEditPage(c.user, c.params.id), "manager");
add("POST", "/licenses/:id", (c) => L.licenseUpdate(c.user, c.params.id, c.req), "manager");
add("POST", "/licenses/:id/delete", (c) => L.licenseDelete(c.user, c.params.id), "manager");
add("POST", "/licenses/:id/assign", (c) => L.licenseAssign(c.user, c.params.id, c.req), "manager");
add("POST", "/licenses/:id/release/:seatId", (c) => L.licenseRelease(c.user, c.params.id, c.params.seatId), "manager");

// Consumables
add("GET", "/consumables", (c) => K.consumablesPage(c.user, c.url, hasRole(c.user, "manager")));
add("GET", "/consumables/new", (c) => K.consumableNewPage(c.user), "manager");
add("POST", "/consumables", (c) => K.consumableCreate(c.user, c.req), "manager");
add("GET", "/consumables/:id/edit", (c) => K.consumableEditPage(c.user, c.params.id), "manager");
add("POST", "/consumables/:id", (c) => K.consumableUpdate(c.user, c.params.id, c.req), "manager");
add("POST", "/consumables/:id/delete", (c) => K.consumableDelete(c.user, c.params.id), "manager");
add("POST", "/consumables/:id/adjust", (c) => K.consumableAdjust(c.user, c.params.id, c.req), "manager");

// Accessories
add("GET", "/accessories", (c) => X.list(c.user, c.url, hasRole(c.user, "manager")));
add("GET", "/accessories/new", (c) => X.newPage(c.user), "manager");
add("POST", "/accessories", (c) => X.create(c.user, c.req), "manager");
add("GET", "/accessories/:id", (c) => X.detail(c.user, c.params.id, c.url, hasRole(c.user, "manager")));
add("GET", "/accessories/:id/edit", (c) => X.editPage(c.user, c.params.id), "manager");
add("POST", "/accessories/:id", (c) => X.update(c.user, c.params.id, c.req), "manager");
add("POST", "/accessories/:id/delete", (c) => X.remove(c.user, c.params.id), "manager");
add("POST", "/accessories/:id/checkout", (c) => X.checkout(c.user, c.params.id, c.req), "manager");
add("POST", "/accessories/:id/checkin/:checkoutId", (c) => X.checkin(c.user, c.params.id, c.params.checkoutId), "manager");

// Components
add("GET", "/components", (c) => P.list(c.user, c.url, hasRole(c.user, "manager")));
add("GET", "/components/new", (c) => P.newPage(c.user), "manager");
add("POST", "/components", (c) => P.create(c.user, c.req), "manager");
add("GET", "/components/:id", (c) => P.detail(c.user, c.params.id, c.url, hasRole(c.user, "manager")));
add("GET", "/components/:id/edit", (c) => P.editPage(c.user, c.params.id), "manager");
add("POST", "/components/:id", (c) => P.update(c.user, c.params.id, c.req), "manager");
add("POST", "/components/:id/delete", (c) => P.removeEntity(c.user, c.params.id), "manager");
add("POST", "/components/:id/install", (c) => P.install(c.user, c.params.id, c.req), "manager");
add("POST", "/components/:id/remove/:rowId", (c) => P.removeInstall(c.user, c.params.id, c.params.rowId, c.req), "manager");

// Catalog entities (categories, manufacturers, suppliers, locations, models)
for (const key of Object.keys(C.entities)) {
  add("GET", `/${key}`, (c) => C.catalogList(c.user, key, c.url, hasRole(c.user, "manager")));
  add("POST", `/${key}`, (c) => C.catalogCreate(c.user, key, c.req), "manager");
  add("GET", `/${key}/:id/edit`, (c) => C.catalogEditPage(c.user, key, c.params.id), "manager");
  add("POST", `/${key}/:id`, (c) => C.catalogUpdate(c.user, key, c.params.id, c.req), "manager");
  add("POST", `/${key}/:id/edit`, (c) => C.catalogUpdate(c.user, key, c.params.id, c.req), "manager");
  add("POST", `/${key}/:id/delete`, (c) => C.catalogDelete(c.user, key, c.params.id), "manager");
}

// Users (admin only)
add("GET", "/users", (c) => U.usersPage(c.user, c.url), "admin");
add("GET", "/users/new", (c) => U.userNewPage(c.user), "admin");
add("POST", "/users", (c) => U.userCreate(c.user, c.req), "admin");
add("GET", "/users/:id/edit", (c) => U.userEditPage(c.user, c.params.id), "admin");
add("POST", "/users/:id", (c) => U.userUpdate(c.user, c.params.id, c.req), "admin");
add("POST", "/users/:id/toggle", (c) => U.userToggle(c.user, c.params.id), "admin");

function notFound(user: User): Response {
  return layout(user, "Not found", "<h1>Page not found</h1><p><a href='/'>Back to dashboard</a></p>");
}

const server = Bun.serve({
  port: Number(process.env.PORT || 8080),
  hostname: process.env.HOST || "0.0.0.0",
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/login") {
      if (req.method === "POST") {
        const forwarded = trustProxy ? (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() : "";
        const clientIp = forwarded || server.requestIP(req)?.address || null;
        return doLogin(req, clientIp);
      }
      return getUser(req) ? redirect("/") : loginPage();
    }
    if (path === "/healthz" && req.method === "GET") return new Response("ok");

    const user = getUser(req);
    if (!user) return redirect("/login");
    if (req.method === "POST" && !(await verifyCsrf(req, user)))
      return new Response("CSRF validation failed", { status: 403 });
    if (path === "/logout" && req.method === "POST") return doLogout(req);

    for (const r of routes) {
      if (r.m !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      if (!hasRole(user, r.role)) return forbidden(user, path);
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return await r.h({ req, url, params, user });
      } catch (e: any) {
        console.error(e);
        return layout(user, "Error", `<h1>Something went wrong</h1><p class="muted">${esc(String(e?.message || e))}</p>`);
      }
    }
    return notFound(user);
  },
});

console.log(`${S.appName()} running at http://localhost:${server.port}`);

```

## `src/web.ts`

```typescript
import type { User } from "./auth";
import { appName } from "./settings";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function formVals(req: Request): Promise<(k: string) => string> {
  const f = await req.formData();
  return (k: string) => (f.get(k) ?? "").toString().trim();
}

export function opt(rows: any[], selected: any, valueKey = "id", labelKey = "name"): string {
  return rows
    .map(
      (r) =>
        `<option value="${esc(r[valueKey])}"${String(r[valueKey]) === String(selected) ? " selected" : ""}>${esc(r[labelKey])}</option>`
    )
    .join("");
}

export function badge(status: string): string {
  const cls: Record<string, string> = {
    deployable: "b-green",
    deployed: "b-blue",
    maintenance: "b-amber",
    archived: "b-gray",
  };
  return `<span class="badge ${cls[status] || "b-gray"}">${esc(status)}</span>`;
}

export function csrfInput(user: User): string {
  return `<input type="hidden" name="_csrf" value="${esc(user.csrfToken)}">`;
}

export function pager(url: URL, page: number, total: number, pageSize: number): string {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return "";
  const link = (p: number, label: string) => {
    const q = new URLSearchParams(url.searchParams);
    q.set("page", String(p));
    return `<a class="btn sec sm" href="${esc(url.pathname)}?${esc(q.toString())}">${label}</a>`;
  };
  return `<div class="toolbar">${page > 1 ? link(page - 1, "Previous") : ""}<span class="muted">Page ${page} of ${pages}</span>${page < pages ? link(page + 1, "Next") : ""}</div>`;
}

const CSS = `
*{box-sizing:border-box;margin:0}
body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#1f2430;display:flex;min-height:100vh}
aside{width:210px;background:#181d27;color:#cfd4e0;flex-shrink:0;display:flex;flex-direction:column}
aside .brand{padding:18px 16px;font-size:17px;font-weight:700;color:#fff;border-bottom:1px solid #2a3040}
aside nav{flex:1;padding:10px 0}
aside a{display:block;padding:9px 18px;color:#cfd4e0;text-decoration:none}
aside a:hover,aside a.on{background:#242b3a;color:#fff}
aside .who{padding:14px 16px;border-top:1px solid #2a3040;font-size:12px}
main{flex:1;padding:24px 32px;max-width:1200px}
h1{font-size:21px;margin-bottom:16px}
h2{font-size:16px;margin:18px 0 8px}
.card{background:#fff;border:1px solid #e3e6ec;border-radius:8px;padding:16px 18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eceef2;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
tr:hover td{background:#f8f9fb}
a{color:#2456d6}
.btn{display:inline-block;background:#2456d6;color:#fff;border:0;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;text-decoration:none}
.btn.sec{background:#e8ebf2;color:#1f2430}
.btn.danger{background:#c0392b}
.btn.sm{padding:4px 9px;font-size:12px}
input,select,textarea{width:100%;padding:7px 9px;border:1px solid #cdd3de;border-radius:6px;font:inherit;background:#fff}
form.inline{display:inline}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.frm{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:14px}
.frm label{display:block;font-size:12px;font-weight:600;color:#4b5563;margin-bottom:3px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
.b-green{background:#e2f6e9;color:#157347}.b-blue{background:#e2ecfd;color:#1d4fc4}
.b-amber{background:#fdf3da;color:#92660a}.b-gray{background:#eceef2;color:#5b6472}
.b-red{background:#fbe3e0;color:#b02a1c}
.flash{background:#e2f6e9;border:1px solid #b5e5c6;color:#157347;padding:9px 14px;border-radius:6px;margin-bottom:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:18px}
.stat{background:#fff;border:1px solid #e3e6ec;border-radius:8px;padding:14px 16px}
.stat .n{font-size:26px;font-weight:700}
.stat .l{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.toolbar input,.toolbar select{width:auto}
.muted{color:#6b7280;font-size:12px}
.labels{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.label-card{border:1px dashed #aaa;border-radius:6px;padding:10px;text-align:center;background:#fff}
.label-card svg{width:110px;height:110px}
@media print{aside,.no-print{display:none!important}main{padding:0;max-width:none}body{background:#fff}}
`;

const NAV: Array<[string, string, string]> = [
  ["/", "Dashboard", "viewer"],
  ["/assets", "Assets", "viewer"],
  ["/maintenance", "Maintenance", "manager"],
  ["/my", "My Items", "viewer"],
  ["/accessories", "Accessories", "viewer"],
  ["/components", "Components", "viewer"],
  ["/licenses", "Licenses", "viewer"],
  ["/consumables", "Consumables", "viewer"],
  ["/models", "Models", "viewer"],
  ["/categories", "Categories", "viewer"],
  ["/manufacturers", "Manufacturers", "viewer"],
  ["/suppliers", "Suppliers", "viewer"],
  ["/locations", "Locations", "viewer"],
  ["/reports", "Reports", "viewer"],
  ["/activity", "Activity Log", "manager"],
  ["/users", "Users", "admin"],
  ["/settings", "Settings", "admin"],
  ["/depreciation", "Depreciation", "admin"],
  ["/profile", "Profile", "viewer"],
];

export const roleRank: Record<string, number> = { viewer: 1, manager: 2, admin: 3 };

export function layout(user: User | null, title: string, body: string, path = "", flash = ""): Response {
  const name = appName();
  const nav = user
    ? NAV.filter(([, , r]) => roleRank[user.role] >= roleRank[r])
        .map(
          ([href, label]) =>
            `<a href="${href}" class="${path === href || (href !== "/" && path.startsWith(href)) ? "on" : ""}">${label}</a>`
        )
        .join("")
    : "";
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(name)}</title><style>${CSS}</style></head>
<body>
<aside>
  <div class="brand">${esc(name)}</div>
  <nav>${nav}</nav>
  ${user ? `<div class="who">${esc(user.name)} · ${esc(user.role)}<br><form method="post" action="/logout" class="inline"><button class="btn sec sm" style="margin-top:6px">Sign out</button></form></div>` : ""}
</aside>
<main>
${flash ? `<div class="flash">${esc(flash)}</div>` : ""}
${body}
</main>
</body></html>`;
  return html(user ? page.replace(/(<form\b[^>]*\bmethod=["']post["'][^>]*>)/gi, `$1${csrfInput(user)}`) : page);
}

```

// Generic CRUD for simple catalog entities: categories, manufacturers, suppliers, locations, models
import { db, logActivity } from "./db";
import type { User } from "./auth";
import { emptyState, esc, formVals, inlineConfirm, layout, opt, redirect } from "./web";
import { modelFieldsPanel } from "./custom_fields";

type Field = {
  k: string;
  label: string;
  type?: "text" | "number" | "select" | "fk";
  options?: string[];
  srcTable?: string;
  req?: boolean;
};

type Entity = {
  title: string;
  singular: string;
  table: string;
  fields: Field[];
  listSql: string;
  cols: [string, string][];
  statLabel?: string;
  detailStatSql?: string;
};

export const entities: Record<string, Entity> = {
  categories: {
    title: "Categories",
    singular: "category",
    table: "categories",
    fields: [
      { k: "name", label: "Name", req: true },
      { k: "ctype", label: "Type", type: "select", options: ["asset", "license", "consumable", "accessory", "component"] },
    ],
    listSql: `SELECT c.*,
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COALESCE(SUM(l.seats),0) FROM licenses l WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(k.qty),0) FROM consumables k WHERE k.category_id=c.id) + (SELECT COALESCE(SUM(co.qty),0) FROM consumable_checkouts co JOIN consumables k ON k.id=co.consumable_id WHERE k.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'accessory' THEN (SELECT COALESCE(SUM(x.qty),0) FROM accessories x WHERE x.category_id=c.id)
        WHEN 'component' THEN (SELECT COALESCE(SUM(p.qty),0) FROM components p WHERE p.category_id=c.id)
        ELSE 0 END total,
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status='deployed' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COUNT(s.id) FROM licenses l JOIN license_seats s ON s.license_id=l.id WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(co.qty),0) FROM consumable_checkouts co JOIN consumables k ON k.id=co.consumable_id WHERE k.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'accessory' THEN (SELECT COUNT(co.id) FROM accessory_checkouts co JOIN accessories x ON x.id=co.accessory_id WHERE x.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'component' THEN (SELECT COALESCE(SUM(pa.qty),0) FROM component_assets pa JOIN components p ON p.id=pa.component_id WHERE p.category_id=c.id)
        ELSE 0 END in_use,
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status='deployable' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COALESCE(SUM(l.seats),0) FROM licenses l WHERE l.category_id=c.id) - (SELECT COUNT(s.id) FROM licenses l JOIN license_seats s ON s.license_id=l.id WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(k.qty),0) FROM consumables k WHERE k.category_id=c.id)
        WHEN 'accessory' THEN (SELECT COALESCE(SUM(x.qty),0) FROM accessories x WHERE x.category_id=c.id) - (SELECT COUNT(co.id) FROM accessory_checkouts co JOIN accessories x ON x.id=co.accessory_id WHERE x.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'component' THEN (SELECT COALESCE(SUM(p.qty),0) FROM components p WHERE p.category_id=c.id) - (SELECT COALESCE(SUM(pa.qty),0) FROM component_assets pa JOIN components p ON p.id=pa.component_id WHERE p.category_id=c.id)
        ELSE 0 END in_stock
      FROM categories c ORDER BY c.name`,
    statLabel: "assets",
    detailStatSql: `SELECT
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COALESCE(SUM(l.seats),0) FROM licenses l WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(k.qty),0) FROM consumables k WHERE k.category_id=c.id) + (SELECT COALESCE(SUM(co.qty),0) FROM consumable_checkouts co JOIN consumables k ON k.id=co.consumable_id WHERE k.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'accessory' THEN (SELECT COALESCE(SUM(x.qty),0) FROM accessories x WHERE x.category_id=c.id)
        WHEN 'component' THEN (SELECT COALESCE(SUM(p.qty),0) FROM components p WHERE p.category_id=c.id)
        ELSE 0 END total,
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status='deployed' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COUNT(s.id) FROM licenses l JOIN license_seats s ON s.license_id=l.id WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(co.qty),0) FROM consumable_checkouts co JOIN consumables k ON k.id=co.consumable_id WHERE k.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'accessory' THEN (SELECT COUNT(co.id) FROM accessory_checkouts co JOIN accessories x ON x.id=co.accessory_id WHERE x.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'component' THEN (SELECT COALESCE(SUM(pa.qty),0) FROM component_assets pa JOIN components p ON p.id=pa.component_id WHERE p.category_id=c.id)
        ELSE 0 END in_use,
      CASE c.ctype
        WHEN 'asset' THEN (SELECT COUNT(a.id) FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status='deployable' WHERE m.category_id=c.id)
        WHEN 'license' THEN (SELECT COALESCE(SUM(l.seats),0) FROM licenses l WHERE l.category_id=c.id) - (SELECT COUNT(s.id) FROM licenses l JOIN license_seats s ON s.license_id=l.id WHERE l.category_id=c.id)
        WHEN 'consumable' THEN (SELECT COALESCE(SUM(k.qty),0) FROM consumables k WHERE k.category_id=c.id)
        WHEN 'accessory' THEN (SELECT COALESCE(SUM(x.qty),0) FROM accessories x WHERE x.category_id=c.id) - (SELECT COUNT(co.id) FROM accessory_checkouts co JOIN accessories x ON x.id=co.accessory_id WHERE x.category_id=c.id AND co.checked_in_at IS NULL)
        WHEN 'component' THEN (SELECT COALESCE(SUM(p.qty),0) FROM components p WHERE p.category_id=c.id) - (SELECT COALESCE(SUM(pa.qty),0) FROM component_assets pa JOIN components p ON p.id=pa.component_id WHERE p.category_id=c.id)
        ELSE 0 END in_stock
      FROM categories c WHERE c.id=?`,
    cols: [
      ["name", "Name"],
      ["ctype", "Type"],
    ],
  },
  manufacturers: {
    title: "Manufacturers",
    singular: "manufacturer",
    table: "manufacturers",
    fields: [{ k: "name", label: "Name", req: true }],
    listSql: `SELECT mf.*,COUNT(a.id) total,SUM(CASE WHEN a.status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN a.status='deployable' THEN 1 ELSE 0 END) in_stock
      FROM manufacturers mf LEFT JOIN models m ON m.manufacturer_id=mf.id LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived' GROUP BY mf.id ORDER BY mf.name`,
    statLabel: "assets",
    detailStatSql: `SELECT COUNT(a.id) total,SUM(CASE WHEN a.status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN a.status='deployable' THEN 1 ELSE 0 END) in_stock FROM models m LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived' WHERE m.manufacturer_id=?`,
    cols: [["name", "Name"]],
  },
  suppliers: {
    title: "Suppliers",
    singular: "supplier",
    table: "suppliers",
    fields: [
      { k: "name", label: "Name", req: true },
      { k: "contact", label: "Contact" },
    ],
    listSql: `SELECT s.*,COALESCE(SUM(ac.qty),0) total,COALESCE((SELECT COUNT(*) FROM accessory_checkouts x JOIN accessories ax ON ax.id=x.accessory_id WHERE ax.supplier_id=s.id AND x.checked_in_at IS NULL),0) in_use,
      COALESCE(SUM(ac.qty),0)-COALESCE((SELECT COUNT(*) FROM accessory_checkouts x JOIN accessories ax ON ax.id=x.accessory_id WHERE ax.supplier_id=s.id AND x.checked_in_at IS NULL),0) in_stock
      FROM suppliers s LEFT JOIN accessories ac ON ac.supplier_id=s.id GROUP BY s.id ORDER BY s.name`,
    statLabel: "accessories",
    detailStatSql: `SELECT COALESCE(SUM(ac.qty),0) total,COALESCE((SELECT COUNT(*) FROM accessory_checkouts x JOIN accessories ax ON ax.id=x.accessory_id WHERE ax.supplier_id=? AND x.checked_in_at IS NULL),0) in_use,
      COALESCE(SUM(ac.qty),0)-COALESCE((SELECT COUNT(*) FROM accessory_checkouts x JOIN accessories ax ON ax.id=x.accessory_id WHERE ax.supplier_id=? AND x.checked_in_at IS NULL),0) in_stock FROM accessories ac WHERE ac.supplier_id=?`,
    cols: [
      ["name", "Name"],
      ["contact", "Contact"],
    ],
  },
  locations: {
    title: "Locations",
    singular: "location",
    table: "locations",
    fields: [
      { k: "name", label: "Name", req: true },
      { k: "address", label: "Address" },
    ],
    listSql: `SELECT l.*,COUNT(a.id) total,SUM(CASE WHEN a.status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN a.status='deployable' THEN 1 ELSE 0 END) in_stock
      FROM locations l LEFT JOIN assets a ON a.location_id=l.id AND a.status!='archived' GROUP BY l.id ORDER BY l.name`,
    statLabel: "assets",
    detailStatSql: `SELECT COUNT(*) total,SUM(CASE WHEN status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN status='deployable' THEN 1 ELSE 0 END) in_stock FROM assets WHERE location_id=? AND status!='archived'`,
    cols: [
      ["name", "Name"],
      ["address", "Address"],
    ],
  },
  models: {
    title: "Models",
    singular: "model",
    table: "models",
    fields: [
      { k: "name", label: "Name", req: true },
      { k: "model_no", label: "Model no." },
      { k: "manufacturer_id", label: "Manufacturer", type: "fk", srcTable: "manufacturers" },
      { k: "category_id", label: "Category", type: "fk", srcTable: "categories" },
      { k: "eol_months", label: "EOL (months)", type: "number" },
      { k: "depreciation_id", label: "Depreciation schedule", type: "fk", srcTable: "depreciation" },
      { k: "image_url", label: "Image URL", type: "text" },
      { k: "min_qty", label: "Min asset qty", type: "number" },
    ],
    listSql: `SELECT m.*, mf.name AS manufacturer, c.name AS category, d.name AS depreciation,
        COUNT(a.id) asset_count,COUNT(a.id) total,SUM(CASE WHEN a.status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN a.status='deployable' THEN 1 ELSE 0 END) in_stock
      FROM models m
      LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN depreciation d ON d.id = m.depreciation_id
      LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived'
      GROUP BY m.id ORDER BY m.name`,
    cols: [
      ["name", "Name"],
      ["model_no", "Model no."],
      ["manufacturer", "Manufacturer"],
      ["category", "Category"],
      ["eol_months", "EOL (mo)"],
      ["depreciation", "Depreciation"],
      ["min_qty", "Min Qty"],
    ],
    statLabel: "assets",
    detailStatSql: `SELECT COUNT(*) total,SUM(CASE WHEN status='deployed' THEN 1 ELSE 0 END) in_use,SUM(CASE WHEN status='deployable' THEN 1 ELSE 0 END) in_stock FROM assets WHERE model_id=? AND status!='archived'`,
  },
};

function fieldInput(f: Field, val: any): string {
  if (f.type === "select")
    return `<select name="${f.k}">${(f.options || [])
      .map((o) => `<option${String(val) === o ? " selected" : ""}>${esc(o)}</option>`)
      .join("")}</select>`;
  if (f.type === "fk") {
    const rows = db.query(`SELECT id, name FROM ${f.srcTable} ORDER BY name`).all() as any[];
    return `<select name="${f.k}"><option value="">—</option>${opt(rows, val)}</select>`;
  }
  return `<input name="${f.k}" type="${f.type === "number" ? "number" : "text"}" value="${esc(val ?? "")}"${f.req ? " required" : ""}>`;
}

function formGrid(ent: Entity, row: any = {}): string {
  return ent.fields
    .map((f) => `<div><label>${esc(f.label)}</label>${fieldInput(f, row[f.k])}</div>`)
    .join("");
}

function vals(ent: Entity, v: (k: string) => string): any[] {
  return ent.fields.map((f) => {
    const raw = v(f.k);
    if ((f.type === "fk" || f.type === "number") && raw === "") return null;
    return raw;
  });
}

function statCards(ent: Entity, id: string): string {
  if (!ent.detailStatSql) return "";
  const args = ent.table === "suppliers" ? [id,id,id] : [id];
  const s = db.query(ent.detailStatSql).get(...args) as any;
  return `<div class="stats" style="margin-bottom:20px"><div class="stat"><div class="n">${Number(s?.total||0)}</div><div class="l">Total</div></div><div class="stat"><div class="n">${Number(s?.in_use||0)}</div><div class="l">In use</div></div><div class="stat"><div class="n">${Number(s?.in_stock||0)}</div><div class="l">In stock</div></div></div>`;
}

export function catalogList(user: User, key: string, url: URL, canEdit: boolean): Response {
  const ent = entities[key];
  const rows = db.query(ent.listSql).all() as any[];
  const cell = (r:any,k:string) => {
    if(key==="models"&&k==="min_qty"){
      const count=Number(r.asset_count||0),min=Number(r.min_qty||0);
      return min>0&&count<min?`<span class="badge b-red">${count}/${min}</span>`:`${count}`;
    }
    return esc(r[k] ?? "");
  };
  const statHeads = ent.statLabel ? "<th>Total</th><th>In use</th><th>In stock</th>" : "";
  const statCells = (r:any) => ent.statLabel ? `<td>${Number(r.total||0)}</td><td><span class="badge b-blue">${Number(r.in_use||0)}</span></td><td><span class="badge b-green">${Number(r.in_stock||0)}</span></td>` : "";
  const table = rows.length===0 ? emptyState(`No ${ent.title.toLowerCase()} found`,`Create your first ${ent.singular}.`,canEdit?`<a class="btn" href="#add">Add ${ent.singular}</a>`:"") : `<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr>${ent.cols.map(([, l]) => `<th>${l}</th>`).join("")}${statHeads}${canEdit ? "<th></th>" : ""}</tr>
${rows
  .map(
    (r) =>
      `<tr data-href="/${key}/${r.id}/edit">${ent.cols.map(([k]) => `<td>${cell(r,k)}</td>`).join("")}${statCells(r)}${
        canEdit
          ? `<td style="white-space:nowrap"><a class="btn sec sm" href="/${key}/${r.id}/edit">Edit</a>
${inlineConfirm(`${key}-${r.id}`,`/${key}/${r.id}/delete`,`Delete ${ent.singular}`,`Delete this ${ent.singular}?`,user.csrfToken)}</td>`
          : ""
      }</tr>`
  )
  .join("")}</table></div>`;
  const addForm = canEdit
    ? `<div class="card"><h2 style="margin-top:0">Add ${ent.singular}</h2>
<form method="post" action="/${key}"><div class="frm">${formGrid(ent)}</div><button class="btn">Add</button></form></div>`
    : "";
  return layout(
    user,
    ent.title,
    `<h1>${ent.title}</h1>${addForm}${table}`,
    `/${key}`,
    url.searchParams.get("m") || ""
  );
}

export async function catalogCreate(user: User, key: string, req: Request): Promise<Response> {
  const ent = entities[key];
  const v = await formVals(req);
  try {
    const r = db.run(
      `INSERT INTO ${ent.table} (${ent.fields.map((f) => f.k).join(",")}) VALUES (${ent.fields.map(() => "?").join(",")})`,
      vals(ent, v)
    );
    logActivity(user.id, "create", ent.singular, Number(r.lastInsertRowid), v("name"));
    return redirect(`/${key}?m=${encodeURIComponent(`${ent.singular} added`)}`);
  } catch (e: any) {
    return redirect(`/${key}?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function catalogEditPage(user: User, key: string, id: string): Response {
  const ent = entities[key];
  const row = db.query(`SELECT * FROM ${ent.table} WHERE id = ?`).get(id) as any;
  if (!row) return layout(user, "Not found", "<h1>Not found</h1>", `/${key}`);
  const image = key==="models"&&row.image_url ? `<div style="margin-bottom:12px"><img src="${esc(row.image_url)}" style="max-width:200px;border-radius:6px;margin-bottom:12px" alt="Model image"></div>` : "";
  return layout(
    user,
    `Edit ${ent.singular}`,
    `<h1>Edit ${ent.singular}</h1>${statCards(ent,id)}<div class="card">${image}<form method="post" action="/${key}/${esc(id)}">
<div class="frm">${formGrid(ent, row)}</div>
<button class="btn">Save</button> <a class="btn sec" href="/${key}">Cancel</a></form></div>${key==="models"?modelFieldsPanel(id):""}`,
    `/${key}`
  );
}

export async function catalogUpdate(user: User, key: string, id: string, req: Request): Promise<Response> {
  const ent = entities[key];
  const v = await formVals(req);
  try {
    db.run(
      `UPDATE ${ent.table} SET ${ent.fields.map((f) => `${f.k} = ?`).join(",")} WHERE id = ?`,
      [...vals(ent, v), id]
    );
    logActivity(user.id, "update", ent.singular, Number(id), v("name"));
    return redirect(`/${key}?m=Saved`);
  } catch (e: any) {
    return redirect(`/${key}?m=${encodeURIComponent(`Error: ${e.message}`)}`);
  }
}

export function catalogDelete(user: User, key: string, id: string): Response {
  const ent = entities[key];
  const row = db.query(`SELECT * FROM ${ent.table} WHERE id = ?`).get(id) as any;
  db.run(`DELETE FROM ${ent.table} WHERE id = ?`, [id]);
  logActivity(user.id, "delete", ent.singular, Number(id), row?.name || "");
  return redirect(`/${key}?m=Deleted`);
}

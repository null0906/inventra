// Dashboard, activity log, reports (CSV), QR labels
import QRCode from "qrcode";
import { db } from "./db";
import type { User } from "./auth";
import { badge, esc, layout, pager } from "./web";
import { baseUrl, itemsPerPage } from "./settings";
import { currentValue } from "./depreciation";

const LIFECYCLE_STATUSES = ["deployable", "deployed", "undeployable", "archived"];

export function entityTimeline(type: string, id: string | number): string {
  const rows = db.query(`SELECT a.action,a.detail,a.at,u.name actor
    FROM activity a LEFT JOIN users u ON u.id=a.actor_id
    WHERE a.entity_type=? AND a.entity_id=?
    ORDER BY a.id DESC LIMIT 100`).all(type,id) as any[];
  return `<h2>History</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Date</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
${rows.map(r=>`<tr><td>${esc(r.at)}</td><td>${esc(r.actor || "")}</td><td>${esc(r.action)}</td><td>${esc(r.detail || "")}</td></tr>`).join("")}
</table></div>`;
}

export function globalSearch(user: User, url: URL): Response {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return layout(user,"Search",`<h1>Global Search</h1><div class="card"><p class="muted">Enter a search term to find inventory and users.</p></div>`,"/search","",q);
  const assets=db.query("WITH term(q) AS (VALUES(?)) SELECT id,asset_tag,name FROM assets,term WHERE asset_tag LIKE '%'||term.q||'%' OR serial LIKE '%'||term.q||'%' OR name LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const licenses=db.query("WITH term(q) AS (VALUES(?)) SELECT id,name FROM licenses,term WHERE name LIKE '%'||term.q||'%' OR product_key LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const consumables=db.query("WITH term(q) AS (VALUES(?)) SELECT id,name FROM consumables,term WHERE name LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const accessories=db.query("WITH term(q) AS (VALUES(?)) SELECT id,name FROM accessories,term WHERE name LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const components=db.query("WITH term(q) AS (VALUES(?)) SELECT id,name FROM components,term WHERE name LIKE '%'||term.q||'%' OR serial LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const users=db.query("WITH term(q) AS (VALUES(?)) SELECT id,name,username FROM users,term WHERE name LIKE '%'||term.q||'%' OR username LIKE '%'||term.q||'%' OR email LIKE '%'||term.q||'%' LIMIT 20").all(q) as any[];
  const groups = [
    ["Assets",assets,(r:any)=>`<a href="/assets/${r.id}">${esc(r.asset_tag)} — ${esc(r.name || "")}</a>`],
    ["Licenses",licenses,(r:any)=>`<a href="/licenses/${r.id}">${esc(r.name)}</a>`],
    ["Consumables",consumables,(r:any)=>`<a href="/consumables/${r.id}">${esc(r.name)}</a>`],
    ["Accessories",accessories,(r:any)=>`<a href="/accessories/${r.id}">${esc(r.name)}</a>`],
    ["Components",components,(r:any)=>`<a href="/components/${r.id}">${esc(r.name)}</a>`],
    ["Users",users,(r:any)=>`<a href="/users/${r.id}/edit">${esc(r.name)} (${esc(r.username)})</a>`],
  ] as Array<[string,any[],(r:any)=>string]>;
  const total=groups.reduce((n,[,rows])=>n+rows.length,0);
  const results=groups.filter(([,rows])=>rows.length).map(([label,rows,render])=>`<h2>${label}</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table">${rows.map(r=>`<tr><td>${render(r)}</td></tr>`).join("")}</table></div>`).join("");
  const body = `<h1>Search Results <span class="muted">(${total})</span></h1>${total?results:`<div class="card"><p class="muted">No results found for “${esc(q)}”.</p></div>`}`;
  return layout(user,"Search",body,"/search","",q);
}

export function dashboard(user: User, url: URL): Response {
  const n = (sql: string) => (db.query(sql).get() as any).n;

  const totalAssets = n("SELECT COUNT(*) AS n FROM assets");
  const liveAssets  = n("SELECT COUNT(*) AS n FROM assets WHERE status!='archived'");
  const deployed    = n("SELECT COUNT(*) AS n FROM assets WHERE status='deployed'");
  const deployable  = n("SELECT COUNT(*) AS n FROM assets WHERE status='deployable'");
  const inMaint     = n("SELECT COUNT(*) AS n FROM assets WHERE status='maintenance'");
  const archived    = n("SELECT COUNT(*) AS n FROM assets WHERE status='archived'");
  const openMaint   = n("SELECT COUNT(*) AS n FROM maintenance WHERE completed=0");
  const licenses    = n("SELECT COUNT(*) AS n FROM licenses");
  const licenseSeats = n("SELECT COALESCE(SUM(seats),0) AS n FROM licenses");
  const seatsInUse  = n("SELECT COUNT(*) AS n FROM license_seats");
  const accessories = n("SELECT COUNT(*) AS n FROM accessories");
  const accessoryUnits = n("SELECT COALESCE(SUM(qty),0) AS n FROM accessories");
  const accessoriesUsed = n("SELECT COUNT(*) AS n FROM accessory_checkouts WHERE checked_in_at IS NULL");
  const consumables = n("SELECT COUNT(*) AS n FROM consumables");
  const consumableLeft = n("SELECT COALESCE(SUM(qty),0) AS n FROM consumables");
  const consumablesUsed = n("SELECT COALESCE(SUM(qty),0) AS n FROM consumable_checkouts WHERE checked_in_at IS NULL");
  const components = n("SELECT COUNT(*) AS n FROM components");
  const componentUnits = n("SELECT COALESCE(SUM(qty),0) AS n FROM components");
  const componentsUsed = n("SELECT COALESCE(SUM(qty),0) AS n FROM component_assets");
  const lowStock    = n("SELECT COUNT(*) AS n FROM consumables WHERE qty<=min_qty");
  const activeUsers = n("SELECT COUNT(*) AS n FROM users WHERE active=1");
  const totalUsers  = n("SELECT COUNT(*) AS n FROM users");
  const maintenanceDue = n("SELECT COUNT(*) AS n FROM maintenance WHERE completed=0 AND start_date<=date('now','+30 days')");
  const licenseExpiry = db.query("SELECT COUNT(*) n,GROUP_CONCAT(name,', ') names FROM licenses WHERE expires BETWEEN date('now') AND date('now','+60 days')").get() as any;
  const alertLowStock = n("SELECT COUNT(*) AS n FROM consumables WHERE qty<=min_qty AND min_qty>0");
  const warrantyExpiry = n(`SELECT COUNT(*) AS n FROM assets
    WHERE purchase_date IS NOT NULL AND warranty_months IS NOT NULL
    AND date(purchase_date,'+' || warranty_months || ' months') BETWEEN date('now') AND date('now','+90 days')`);

  const recent = db.query(
    `SELECT act.*, u.name AS actor FROM activity act LEFT JOIN users u ON u.id=act.actor_id ORDER BY act.id DESC LIMIT 15`
  ).all() as any[];

  const expiring = db.query(
    `SELECT id,name,expires FROM licenses WHERE expires IS NOT NULL AND expires<=date('now','+90 days') ORDER BY expires LIMIT 8`
  ).all() as any[];

  const low = db.query(
    "SELECT id,name,qty,min_qty FROM consumables WHERE qty<=min_qty ORDER BY name LIMIT 8"
  ).all() as any[];

  const departments = db.query(
    `SELECT d.name,COUNT(a.id) n FROM departments d LEFT JOIN users u ON u.department_id=d.id LEFT JOIN assets a ON a.assigned_to=u.id GROUP BY d.id ORDER BY n DESC LIMIT 6`
  ).all() as any[];

  const invCard = (href: string, label: string, count: number, total: number, used: number, left: number, labels = ["Total","Used","Left"], links = [href,href,href]) =>
    `<div class="summary-card"><div class="summary-top"><div><div class="summary-n">${count}</div><div class="summary-l">${esc(label)}</div></div><a class="summary-link" href="${href}">view all</a></div><div class="summary-stats">
<a class="summary-mini" href="${esc(links[0])}"><strong>${total}</strong><span>${esc(labels[0])}</span></a>
<a class="summary-mini" href="${esc(links[1])}"><strong>${used}</strong><span>${esc(labels[1])}</span></a>
<a class="summary-mini" href="${esc(links[2])}"><strong>${left}</strong><span>${esc(labels[2])}</span></a>
</div></div>`;
  const inventorySummary = `<div class="summary-grid">
${invCard("/assets","Assets",totalAssets,totalAssets,deployed,deployable,["Total","Used","Left"],["/assets","/assets?status=deployed","/assets?status=deployable"])}
${invCard("/licenses","Licenses",licenses,licenseSeats,seatsInUse,Math.max(0,licenseSeats-seatsInUse))}
${invCard("/accessories","Accessories",accessories,accessoryUnits,accessoriesUsed,Math.max(0,accessoryUnits-accessoriesUsed))}
${invCard("/consumables","Consumables",consumables,consumableLeft+consumablesUsed,consumablesUsed,consumableLeft)}
${invCard("/components","Components",components,componentUnits,componentsUsed,Math.max(0,componentUnits-componentsUsed))}
${invCard(user.role==="admin"?"/users":"/my","Users",totalUsers,totalUsers,activeUsers,Math.max(0,totalUsers-activeUsers),["Total","Active","Inactive"])}
</div>`;

  const alert = (href: string, label: string, count: number, detail = "") =>
    count > 0 ? `<a class="alert-card" href="${href}" style="display:block;padding:14px 16px;color:inherit"><strong>${count} ${label}</strong>${detail ? `<div class="muted" style="font-size:12px;margin-top:2px">${esc(detail)}</div>` : ""}</a>` : "";
  const alerts = [
    alert("/maintenance","maintenance items due within 30 days",maintenanceDue),
    alert("/licenses","licenses expiring within 60 days",Number(licenseExpiry.n),licenseExpiry.names || ""),
    alert("/consumables","low-stock consumables",alertLowStock),
    alert("/assets","asset warranties expiring within 90 days",warrantyExpiry),
  ].join("");
  const alertsSection = alerts ? `<section class="dashboard-alerts"><h2>Attention needed</h2><div class="alert-stack">${alerts}</div></section>` : "";

  // Donut chart for asset status
  const donutSegs = [
    { label: "Deployable",  val: deployable, color: "#22c55e" },
    { label: "Deployed",    val: deployed,   color: "#3b82f6" },
    { label: "Maintenance", val: inMaint,    color: "#f59e0b" },
    { label: "Archived",    val: archived,   color: "#94a3b8" },
  ];
  const donutActual = donutSegs.reduce((s, x) => s + x.val, 0);
  const circ = 2 * Math.PI * 50;
  let angle = -90;
  const arcs = donutSegs.map((seg) => {
    const pct = donutActual ? seg.val / donutActual : 0;
    const dash = pct * circ;
    const arc = `<circle cx="60" cy="60" r="50" fill="none" stroke="${seg.color}" stroke-width="20" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" transform="rotate(${angle.toFixed(2)} 60 60)"/>`;
    angle += pct * 360;
    return arc;
  });
  const donutSvg = `<svg viewBox="0 0 120 120" width="130" height="130" style="flex-shrink:0">${arcs.join("")}<circle cx="60" cy="60" r="39" fill="white"/><text x="60" y="57" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="20" font-weight="800" fill="#0f172a">${donutActual}</text><text x="60" y="72" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="9" fill="#64748b" letter-spacing="1">TOTAL</text></svg>`;
  const donutLegend = donutSegs.map((s) =>
    `<div class="dl-item"><div class="dl-dot" style="background:${s.color}"></div><span>${s.label}</span><span class="dl-val">${s.val}</span></div>`
  ).join("");

  const chartCard = `<div class="chart-card"><h3>Asset Status</h3><div class="donut-wrap">${donutSvg}<div class="donut-legend">${donutLegend}</div></div></div>`;

  // Department bar chart
  const maxDept = departments.length ? Math.max(...(departments as any[]).map((d: any) => d.n as number), 1) : 1;
  const deptBars = departments.length
    ? `<div class="chart-card"><h3>Assets by Department</h3><p class="muted" style="font-size:11px;margin:-10px 0 14px;font-weight:600;letter-spacing:.04em">ASSIGNED ASSETS ONLY</p><div class="bar-items">${(departments as any[]).map((d: any) => `<div><div class="bar-hd"><span>${esc(d.name)}</span><strong>${d.n}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((d.n / maxDept) * 100)}%"></div></div></div>`).join("")}</div></div>`
    : `<div class="chart-card"><h3>Assets by Department</h3><p class="muted" style="font-size:13px;padding-top:4px">No departments configured yet.</p></div>`;

  // Recent activity table
  const actTable = `<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Detail</th></tr>
${recent.map((r) => `<tr><td class="muted" style="white-space:nowrap;font-size:12px">${esc(r.at)}</td><td>${esc(r.actor ?? "")}</td><td>${esc(r.action)}</td><td><span class="badge b-gray" style="font-size:10px">${esc(r.entity_type)}</span></td><td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.detail ?? "")}</td></tr>`).join("")}
</table></div>`;

  const expiringCard = expiring.length
    ? `<div class="alert-card"><table><tr><th colspan="2" style="padding:12px 14px 8px">Licenses expiring &le; 90 days</th></tr>${expiring.map((l) => `<tr><td><a href="/licenses/${l.id}">${esc(l.name)}</a></td><td style="white-space:nowrap;color:#d97706;font-weight:600;font-size:12px">${esc(l.expires)}</td></tr>`).join("")}</table></div>`
    : "";

  const lowCard = low.length
    ? `<div class="alert-card"><table><tr><th colspan="2" style="padding:12px 14px 8px">Low stock</th></tr>${low.map((c) => `<tr><td>${esc(c.name)}</td><td style="color:#dc2626;font-weight:700;font-size:12px">${c.qty}<span style="color:var(--mut);font-weight:400"> / min ${c.min_qty}</span></td></tr>`).join("")}</table></div>`
    : "";

  const body = `<h1>Dashboard</h1>
${inventorySummary}
${alertsSection}
<div class="dash-charts">${chartCard}${deptBars}</div>
<div class="dash-lower">
  <div><h2 style="margin-top:0">Recent Activity</h2>${actTable}</div>
  <div class="alert-stack">${expiringCard}${lowCard}${!expiringCard && !lowCard ? `<div class="chart-card" style="padding:16px 18px"><p class="muted" style="font-size:13px">No alerts at this time.</p></div>` : ""}</div>
</div>`;

  return layout(user, "Dashboard", body, "/", url.searchParams.get("m") || "");
}

export function activityPage(user: User, url: URL): Response {
  const type = url.searchParams.get("type") || "";
  const types = ["asset", "license", "consumable", "accessory", "component", "maintenance", "depreciation", "user", "department", "settings", "category", "manufacturer", "supplier", "location", "model"];
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
<div class="card table-wrap" style="padding:0"><table class="sticky-table">
<tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Detail</th></tr>
${rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.actor ?? "")}</td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}</td><td>${esc(r.detail ?? "")}</td></tr>`).join("")}
</table></div>${pager(url,page,total,pageSize)}`;
  return layout(user, "Activity", body, "/activity");
}

function csv(rows: any[], filename: string): Response {
  if (!rows.length) return new Response("", { headers: { "Content-Type": "text/csv" } });
  const cols = Object.keys(rows[0]);
  const q = (x: any) => {
    let s = String(x ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
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

function lifecycleRows(url?: URL): any[] {
  const status = url?.searchParams.get("status") || "";
  const minAge = url?.searchParams.get("min_age_days") || "";
  const maxAge = url?.searchParams.get("max_age_days") || "";
  const min = /^\d+$/.test(minAge) ? Number(minAge) : null;
  const max = /^\d+$/.test(maxAge) ? Number(maxAge) : null;
  const rows = db.query(`SELECT a.id,a.asset_tag,a.name,a.status,a.purchase_date,a.purchase_cost,a.warranty_months,
    m.name model,d.id depreciation_id,d.months dep_months,d.floor_value,u.name assigned_to,l.name location
    FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN depreciation d ON d.id=m.depreciation_id
    LEFT JOIN users u ON u.id=a.assigned_to LEFT JOIN locations l ON l.id=a.location_id
    WHERE a.status!='archived' ORDER BY a.purchase_date IS NULL,a.purchase_date ASC`).all() as any[];
  const addMonths = (date: string, months: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0,10);
  };
  const days = (date: string) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000);
  return rows.map(r => {
    const age_days = r.purchase_date ? Math.floor((Date.now() - Date.parse(`${r.purchase_date}T00:00:00Z`)) / 86_400_000) : null;
    const warranty_expires = r.purchase_date && r.warranty_months ? addMonths(r.purchase_date, Number(r.warranty_months)) : null;
    return { ...r, age_days, warranty_expires, days_to_warranty: warranty_expires ? days(warranty_expires) : null, current_value: currentValue(r) };
  }).filter(r =>
    (!status || !LIFECYCLE_STATUSES.includes(status) || r.status === status) &&
    (min == null || (r.age_days != null && r.age_days >= min)) &&
    (max == null || (r.age_days != null && r.age_days <= max))
  );
}

export function lifecycleReport(user: User, url: URL): Response {
  const status = url.searchParams.get("status") || "";
  const minAge = url.searchParams.get("min_age_days") || "";
  const maxAge = url.searchParams.get("max_age_days") || "";
  const rows = lifecycleRows(url);
  const warranty = (d: any) => d == null ? "" : d < 0 ? `<span class="badge b-red">expired</span> ${d}` : d <= 90 ? `<span class="badge b-amber">expiring</span> ${d}` : esc(d);
  const body = `<h1>Asset Lifecycle <span class="muted">(${rows.length})</span></h1>
<div class="toolbar no-print"><form method="get" action="/reports/lifecycle" style="display:flex;gap:8px;align-items:center">
<select name="status"><option value="">All statuses</option>${LIFECYCLE_STATUSES.map(s=>`<option value="${s}"${status===s?" selected":""}>${s}</option>`).join("")}</select>
<input name="min_age_days" type="number" min="0" placeholder="Min age days" value="${esc(minAge)}">
<input name="max_age_days" type="number" min="0" placeholder="Max age days" value="${esc(maxAge)}">
<button class="btn sec">Filter</button><a class="btn sec" href="/reports/lifecycle.csv">Export CSV</a></form></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Asset tag</th><th>Name</th><th>Model</th><th>Status</th><th>Location</th><th>Age (days)</th><th>Purchase cost</th><th>Current value</th><th>Warranty expires</th><th>Days to warranty</th></tr>
${rows.map(r=>`<tr><td><a href="/assets/${r.id}">${esc(r.asset_tag)}</a></td><td>${esc(r.name||"")}</td><td>${esc(r.model||"")}</td><td>${badge(r.status)}</td><td>${esc(r.location||"")}</td><td>${r.age_days ?? ""}</td><td>${r.purchase_cost==null?"":Number(r.purchase_cost).toFixed(2)}</td><td>${r.current_value==null?"":Number(r.current_value).toFixed(2)}</td><td>${esc(r.warranty_expires||"")}</td><td>${warranty(r.days_to_warranty)}</td></tr>`).join("")}
</table></div>`;
  return layout(user, "Asset Lifecycle", body, "/reports", url.searchParams.get("m") || "");
}

export function reportsPage(user: User): Response {
  const reports = [
    ["assets", "All assets with model, status, assignee, location, cost"],
    ["licenses", "Licenses with seat usage and expiry"],
    ["consumables", "Consumable stock levels"],
    ["accessories", "Accessory stock and active checkouts"],
    ["components", "Component stock and installed quantities"],
    ["depreciation", "Asset purchase costs and current depreciated values"],
    ["lifecycle", "Asset age, warranty, and lifecycle value"],
    ["activity", "Full activity / audit log"],
    ["departments","Department users and assigned assets"],
    ["by_user","Assets assigned by user"],
    ["by_location","Assets grouped by location"],
    ["unassigned","Assets without a user or checkout location"],
    ["consumable_checkouts","Per-person consumable checkout history"],
  ];
  const body = `<h1>Reports</h1><div class="card"><table>
<tr><th>Report</th><th>Description</th><th></th></tr>
${reports.map(([k, d]) => `<tr><td>${k === "lifecycle" ? "Lifecycle" : k}</td><td>${d}</td><td>${k === "lifecycle" ? `<a class="btn sec sm" href="/reports/lifecycle">View</a> <a class="btn sec sm" href="/reports/lifecycle.csv">CSV</a>` : `<a class="btn sec sm" href="/reports/${k === "depreciation" ? "depreciation" : `${k}.csv`}">Download CSV</a>`}</td></tr>`).join("")}
</table></div>`;
  return layout(user, "Reports", body, "/reports");
}

export function reportCsv(name: string): Response | null {
  if (name === "lifecycle") {
    const rows = lifecycleRows().map(r => ({
      asset_tag: r.asset_tag,
      name: r.name,
      model: r.model,
      status: r.status,
      location: r.location,
      age_days: r.age_days,
      purchase_cost: r.purchase_cost,
      current_value: r.current_value == null ? "" : Number(r.current_value).toFixed(2),
      warranty_expires: r.warranty_expires,
      days_to_warranty: r.days_to_warranty,
    }));
    return csv(rows, "lifecycle.csv");
  }
  const queries: Record<string, string> = {
    assets: `SELECT a.asset_tag, a.name, a.serial, m.name AS model, mf.name AS manufacturer, a.status,
        u.name AS assigned_to, l.name AS location,l2.name AS checkout_location, s.name AS supplier, a.purchase_date, a.purchase_cost,
        a.ip_address,a.mac_address,a.order_number, a.warranty_months, a.notes, a.created_at
      FROM assets a
      LEFT JOIN models m ON m.id = a.model_id
      LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
      LEFT JOIN users u ON u.id = a.assigned_to
      LEFT JOIN locations l ON l.id = a.location_id
      LEFT JOIN locations l2 ON l2.id=a.checkout_location_id
      LEFT JOIN suppliers s ON s.id = a.supplier_id ORDER BY a.asset_tag`,
    licenses: `SELECT l.name, mf.name AS manufacturer, l.seats,
        (SELECT COUNT(*) FROM license_seats s WHERE s.license_id = l.id) AS seats_used,
        l.purchase_date, l.purchase_cost, l.expires, l.notes
      FROM licenses l LEFT JOIN manufacturers mf ON mf.id = l.manufacturer_id ORDER BY l.name`,
    consumables: `SELECT c.name, cat.name AS category, loc.name AS location, c.qty, c.min_qty, c.cost
      FROM consumables c LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN locations loc ON loc.id = c.location_id ORDER BY c.name`,
    accessories: `SELECT a.name,cat.name category,m.name manufacturer,s.name supplier,l.name location,a.qty,
      a.qty-(SELECT COUNT(*) FROM accessory_checkouts x WHERE x.accessory_id=a.id AND x.checked_in_at IS NULL) available,a.min_qty,a.cost,a.notes
      FROM accessories a LEFT JOIN categories cat ON cat.id=a.category_id LEFT JOIN manufacturers m ON m.id=a.manufacturer_id
      LEFT JOIN suppliers s ON s.id=a.supplier_id LEFT JOIN locations l ON l.id=a.location_id ORDER BY a.name`,
    components: `SELECT c.name,cat.name category,l.name location,c.qty,
      c.qty-COALESCE((SELECT SUM(qty) FROM component_assets x WHERE x.component_id=c.id),0) available,c.min_qty,c.cost,c.serial,c.notes
      FROM components c LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN locations l ON l.id=c.location_id ORDER BY c.name`,
    activity: `SELECT act.at, u.name AS actor, act.action, act.entity_type, act.entity_id, act.detail
      FROM activity act LEFT JOIN users u ON u.id = act.actor_id ORDER BY act.id DESC`,
    departments:`SELECT d.name,u.name manager,(SELECT COUNT(*) FROM users x WHERE x.department_id=d.id AND x.active=1) users,(SELECT COUNT(*) FROM assets a JOIN users x ON x.id=a.assigned_to WHERE x.department_id=d.id) assets FROM departments d LEFT JOIN users u ON u.id=d.manager_id ORDER BY d.name`,
    by_user:`SELECT u.name user,u.email,d.name department,a.asset_tag,a.name asset_name,a.status,m.name model,a.purchase_date,a.purchase_cost FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN assets a ON a.assigned_to=u.id LEFT JOIN models m ON m.id=a.model_id WHERE u.active=1 ORDER BY u.name,a.asset_tag`,
    by_location:`SELECT l.name location,a.asset_tag,a.name asset_name,a.status,m.name model,u.name assigned_to,a.purchase_cost FROM locations l LEFT JOIN assets a ON a.location_id=l.id OR a.checkout_location_id=l.id LEFT JOIN models m ON m.id=a.model_id LEFT JOIN users u ON u.id=a.assigned_to ORDER BY l.name,a.asset_tag`,
    unassigned:`SELECT a.asset_tag,a.name,a.serial,m.name model,a.status,l.name location,a.purchase_date,a.purchase_cost FROM assets a LEFT JOIN models m ON m.id=a.model_id LEFT JOIN locations l ON l.id=a.location_id WHERE a.assigned_to IS NULL AND a.checkout_location_id IS NULL AND a.status NOT IN ('archived') ORDER BY a.asset_tag`,
    consumable_checkouts:`SELECT c.name consumable,cat.name category,u.name checked_out_to,co.qty,co.note,co.checked_out_at,co.checked_in_at,ci.name checked_in_by FROM consumable_checkouts co JOIN consumables c ON c.id=co.consumable_id LEFT JOIN categories cat ON cat.id=c.category_id JOIN users u ON u.id=co.user_id LEFT JOIN users ci ON ci.id=co.checked_in_by ORDER BY co.id DESC`,
  };
  const sql = queries[name];
  if (!sql) return null;
  const rows=db.query(sql).all() as any[];
  if(name==="assets"){
    const fields=db.query("SELECT DISTINCT cf.id,cf.label FROM custom_fields cf JOIN asset_custom_values acv ON acv.field_id=cf.id ORDER BY cf.id").all() as any[];
    const values=db.query("SELECT asset_id,field_id,value FROM asset_custom_values").all() as any[];
    const byAsset=new Map<number,Map<number,string>>();for(const v of values){if(!byAsset.has(v.asset_id))byAsset.set(v.asset_id,new Map());byAsset.get(v.asset_id)!.set(v.field_id,v.value??"");}
    const ids=db.query("SELECT id FROM assets ORDER BY asset_tag").all() as any[];
    rows.forEach((r,i)=>fields.forEach(f=>r[f.label]=byAsset.get(ids[i]?.id)?.get(f.id)??""));
  }
  return csv(rows, `${name}.csv`);
}

function qrContent(asset: { id: number; asset_tag: string }): string {
  const base = baseUrl();
  return base ? `${base.replace(/\/$/, "")}/assets/${asset.id}` : asset.asset_tag;
}

export function myItems(user: User): Response {
  const assets=db.query("SELECT id,asset_tag,name,status FROM assets WHERE assigned_to=? ORDER BY asset_tag").all(user.id) as any[];
  const accessories=db.query("SELECT a.id,a.name,x.at,x.note FROM accessory_checkouts x JOIN accessories a ON a.id=x.accessory_id WHERE x.user_id=? AND x.checked_in_at IS NULL ORDER BY a.name").all(user.id) as any[];
  const consumables=db.query("SELECT c.id,c.name,co.qty,co.checked_out_at,co.note FROM consumable_checkouts co JOIN consumables c ON c.id=co.consumable_id WHERE co.user_id=? AND co.checked_in_at IS NULL ORDER BY c.name").all(user.id) as any[];
  const licenses=db.query("SELECT l.id,l.name,s.assigned_at FROM license_seats s JOIN licenses l ON l.id=s.license_id WHERE s.user_id=? ORDER BY l.name").all(user.id) as any[];
  const table=(headers:string[],rows:string)=>`<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr>${rows}</table></div>`;
  return layout(user,"My Items",`<h1>My Items</h1><h2>Assets</h2>${table(["Tag","Name","Status"],assets.map(a=>`<tr><td><a href="/assets/${a.id}">${esc(a.asset_tag)}</a></td><td>${esc(a.name||"")}</td><td>${badge(a.status)}</td></tr>`).join(""))}<h2>Accessories</h2>${table(["Name","Checked out","Note"],accessories.map(a=>`<tr><td><a href="/accessories/${a.id}">${esc(a.name)}</a></td><td>${esc(a.at)}</td><td>${esc(a.note||"")}</td></tr>`).join(""))}<h2>Consumables</h2>${table(["Consumable","Qty","Checked out","Note"],consumables.map(c=>`<tr><td><a href="/consumables/${c.id}">${esc(c.name)}</a></td><td>${c.qty}</td><td>${esc(c.checked_out_at)}</td><td>${esc(c.note||"")}</td></tr>`).join(""))}<h2>License seats</h2>${table(["License","Assigned"],licenses.map(l=>`<tr><td><a href="/licenses/${l.id}">${esc(l.name)}</a></td><td>${esc(l.assigned_at)}</td></tr>`).join(""))}`,"/my");
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

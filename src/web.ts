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

export function statusBadge(status: string, label?: string | null, color?: string | null): string {
  if (!label) return badge(status);
  const c = /^#[0-9a-fA-F]{6}$/.test(String(color || "")) ? String(color) : "#6c757d";
  return `<span class="badge" style="background:${esc(c)};color:#fff">${esc(label)}</span>`;
}

export function csrfInput(user: User): string {
  return `<input type="hidden" name="_csrf" value="${esc(user.csrfToken)}">`;
}

export function pager(url: URL, page: number, total: number, pageSize: number): string {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return "";
  const link = (p: number, label: string, disabled = false) => {
    if (disabled) return `<span class="btn sec sm" style="opacity:.4;cursor:default">${label}</span>`;
    const q = new URLSearchParams(url.searchParams);
    q.set("page", String(p));
    return `<a class="btn sec sm" href="${esc(url.pathname)}?${esc(q.toString())}">${label}</a>`;
  };
  return `<div class="pager">${link(1,"«",page===1)}${link(page-1,"‹",page===1)}<span class="pager-info">Page ${page} of ${pages}</span>${link(page+1,"›",page===pages)}${link(pages,"»",page===pages)}</div>`;
}

export function filterDropdown(name: string, label: string, options: Array<{ value: string; label: string }>, selected: string[]): string {
  const picked = new Set(selected.map(String));
  const active = picked.size > 0;
  const caption = active ? `${label}: ${picked.size}` : label;
  return `<details class="filter-dd${active ? " filter-active" : ""}"><summary><span>${esc(caption)}</span></summary><div class="filter-menu">
${options.map(o=>`<label><input type="checkbox" name="${esc(name)}" value="${esc(o.value)}"${picked.has(String(o.value))?" checked":""}> <span>${esc(o.label)}</span></label>`).join("")}
</div></details>`;
}

export function flashHtml(msg: string, type: "ok"|"err"|"warn" = "ok"): string {
  if (!msg) return "";
  const icon = type === "ok" ? "✓" : type === "err" ? "✕" : "⚠";
  return `<div class="flash ${type}">${icon} ${esc(msg)}</div>`;
}

export function activeChips(url: URL, paramNames: string[], labels: Record<string,string>): string {
  const chips: string[] = [];
  for (const name of paramNames) {
    for (const val of url.searchParams.getAll(name)) {
      if (!val) continue;
      const q = new URLSearchParams(url.searchParams);
      const remaining = q.getAll(name).filter(v => v !== val);
      q.delete(name);
      remaining.forEach(v => q.append(name, v));
      const qs = q.toString();
      const href = `${url.pathname}${qs ? `?${qs}` : ""}`;
      const displayLabel = labels[`${name}:${val}`] || val;
      chips.push(`<span class="chip">${esc(displayLabel)}<a href="${esc(href)}" class="chip-clear" title="Remove">×</a></span>`);
    }
  }
  if (!chips.length) return "";
  return `<div class="chip-bar">${chips.join("")}<a class="btn sec sm" href="${esc(url.pathname)}">Clear all</a></div>`;
}

export function emptyState(title: string, desc: string, cta = ""): string {
  return `<div class="empty-state">
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="10" width="36" height="30" rx="3"/><path d="M6 18h36M16 10V6M32 10V6"/></svg>
<h3>${esc(title)}</h3><p>${esc(desc)}</p>${cta}</div>`;
}

export function inlineConfirm(id: string, action: string, label: string, msg: string, csrfToken: string): string {
  return `<button type="button" class="btn danger sm del-toggle" data-target="del-${esc(id)}">Delete</button>
<div id="del-${esc(id)}" class="del-confirm" hidden>
<p>${esc(msg)}</p><div class="btn-row">
<form method="post" action="${esc(action)}" class="inline"><input type="hidden" name="_csrf" value="${esc(csrfToken)}"><button class="btn danger sm">${esc(label)}</button></form>
<button type="button" class="btn sec sm del-toggle" data-target="del-${esc(id)}">Cancel</button>
</div></div>`;
}

// 20×20 stroke icon builder
const ic = (d: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0">${d}</svg>`;

const ICONS: Record<string, string> = {
  dashboard:    ic(`<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/>`),
  myitems:      ic(`<circle cx="10" cy="6" r="3.5"/><path d="M3.5 18c0-3.31 2.91-6 6.5-6s6.5 2.69 6.5 6"/>`),
  assets:       ic(`<rect x="2" y="6" width="16" height="10" rx="1.5"/><path d="M6 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"/>`),
  accessories:  ic(`<path d="M4 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z"/><path d="M8 11h4M10 9v4"/>`),
  components:   ic(`<rect x="6" y="6" width="8" height="8" rx="1"/><path d="M8 6V4M12 6V4M8 14v2M12 14v2M6 8H4M6 12H4M14 8h2M14 12h2"/>`),
  consumables:  ic(`<path d="M3 8h14l-1.4 8.4A2 2 0 0 1 13.6 18H6.4a2 2 0 0 1-2-1.6L3 8zM1 5h18M8 5V3h4v2"/>`),
  licenses:     ic(`<rect x="3" y="2" width="14" height="17" rx="2"/><path d="M7 7h6M7 11h6M7 15h3"/>`),
  maintenance:  ic(`<path d="M14.5 3.5a3 3 0 0 0-4.24 4.24L3.5 14.5a1.5 1.5 0 0 0 2.12 2.12L12.5 9.74a3 3 0 0 0 2.24-6.24"/><circle cx="13.5" cy="5.5" r=".75" fill="currentColor" stroke="none"/>`),
  requests:     ic(`<path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h4"/><path d="M14 14l1.5 1.5L18 13"/>`),
  audits:       ic(`<path d="M4 3h12v14H4zM7 7l1.5 1.5L11 6M7 12l1.5 1.5L11 11M13 7h1M13 12h1"/>`),
  models:       ic(`<path d="M10 2l7 4v8l-7 4-7-4V6l7-4zM10 2v14M3 6l7 4 7-4"/>`),
  categories:   ic(`<path d="M4 6h12M4 10h8M4 14h5"/>`),
  manufacturers:ic(`<path d="M3 18V9l3-5h8l3 5v9H3zM3 9h14M7 9V4M10 9V3M13 9V4"/>`),
  suppliers:    ic(`<path d="M2 7h11l-2-4H4L2 7zM13 7h5l-2 8H2L2 7"/><circle cx="6" cy="17.5" r="1.25"/><circle cx="13" cy="17.5" r="1.25"/>`),
  locations:    ic(`<path d="M10 2a5.5 5.5 0 0 1 5.5 5.5c0 4.5-5.5 10.5-5.5 10.5S4.5 12 4.5 7.5A5.5 5.5 0 0 1 10 2z"/><circle cx="10" cy="7.5" r="2"/>`),
  reports:      ic(`<rect x="2" y="2" width="16" height="16" rx="2"/><path d="M5 14l3-4 3 2.5 2.5-4 3 3"/>`),
  activity:     ic(`<circle cx="10" cy="10" r="7.5"/><path d="M10 6v4l2.5 2"/>`),
  users:        ic(`<circle cx="7" cy="6" r="2.5"/><path d="M1.5 18c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5M13.5 4.5a2.5 2.5 0 0 1 0 5M18.5 18c0-2-1.5-3.5-3-4"/>`),
  departments:  ic(`<path d="M10 2v4M7 6h6M7 6v3M13 6v3M5 9h4v3H5zM11 9h4v3h-4zM8 14h4v4H8zM10 12v2"/>`),
  fields:       ic(`<path d="M5 5h10M5 9h6M5 13h4"/><path d="M14 11l2 2 3-3"/>`),
  statuslabels: ic(`<path d="M3 5h9l5 5-5 5H3z"/><circle cx="7" cy="10" r="1"/>`),
  depreciation: ic(`<path d="M2 6l4 5 3-2 4 6 3-3"/><path d="M2 4h16M2 18h16"/>`),
  settings:     ic(`<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.55 4.55l1.06 1.06M14.39 14.39l1.06 1.06M4.55 15.45l1.06-1.06M14.39 5.61l1.06-1.06"/>`),
  email:        ic(`<rect x="2" y="4" width="16" height="13" rx="2"/><path d="M2 7l8 5 8-5"/>`),
  acknowledgements: ic(`<path d="M4 3h12v14H4zM7 8h6M7 12h3"/><path d="M12 15l2 2 4-5"/>`),
  profile:      ic(`<circle cx="10" cy="7" r="3.5"/><path d="M3 18c0-3.31 3.13-5.5 7-5.5s7 2.19 7 5.5"/>`),
};

type NavItem = [string, string, string, string, string?]; // href, label, minRole, iconKey, permission

const NAV_SECTIONS: Array<{ section: string; items: NavItem[] }> = [
  { section: "Overview", items: [
    ["/",          "Dashboard",  "viewer",  "dashboard"],
    ["/my",        "My Items",   "viewer",  "myitems"],
  ]},
  { section: "Inventory", items: [
    ["/assets",      "Assets",      "viewer",  "assets",      "assets.view"],
    ["/accessories", "Accessories", "viewer",  "accessories", "accessories.view"],
    ["/components",  "Components",  "viewer",  "components",  "components.view"],
    ["/consumables", "Consumables", "viewer",  "consumables", "consumables.view"],
  ]},
  { section: "IT Management", items: [
    ["/licenses",    "Licenses",    "viewer",  "licenses",    "licenses.view"],
    ["/maintenance", "Maintenance", "manager", "maintenance", "maintenance.view"],
  ]},
  { section: "Operations", items: [
    ["/audits", "Physical Audits", "viewer", "audits", "audits.view"],
  ]},
  { section: "Catalog", items: [
    ["/models",        "Models",        "viewer", "models",        "catalog.view"],
    ["/categories",    "Categories",    "viewer", "categories",    "catalog.view"],
    ["/manufacturers", "Manufacturers", "viewer", "manufacturers", "catalog.view"],
    ["/suppliers",     "Suppliers",     "viewer", "suppliers",     "catalog.view"],
    ["/locations",     "Locations",     "viewer", "locations",     "catalog.view"],
  ]},
  { section: "Insights", items: [
    ["/reports",  "Reports",      "viewer",  "reports",  "reports.view"],
    ["/activity", "Activity Log", "manager", "activity"],
  ]},
  { section: "Administration", items: [
    ["/users",         "Users",         "admin",  "users"],
    ["/admin/roles",   "Roles",         "admin",  "users"],
    ["/departments",   "Departments",   "admin",  "departments"],
    ["/custom-fields", "Custom Fields", "admin",  "fields"],
    ["/status-labels",  "Status Labels", "admin",  "statuslabels"],
    ["/depreciation",  "Depreciation",  "admin",  "depreciation"],
    ["/settings",      "Settings",      "admin",  "settings"],
    ["/admin/email",   "Email",         "admin",  "email"],
    ["/admin/acknowledgements", "Acknowledgements", "admin", "acknowledgements"],
    ["/profile",       "Profile",       "viewer", "profile"],
  ]},
];

export const roleRank: Record<string, number> = { viewer: 1, manager: 2, admin: 3 };

const BRAND_ICON = `<svg viewBox="0 0 28 28" fill="none" style="width:28px;height:28px;flex-shrink:0"><rect width="28" height="28" rx="7" fill="#6366f1"/><path d="M7 9h14M7 14h14M7 19h9" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --pri:#6366f1;--pri-dk:#4f46e5;
  --side:#0f172a;--side-bdr:#1e293b;--side-txt:#94a3b8;
  --bg:#f1f5f9;--card:#fff;--bdr:#e2e8f0;--txt:#0f172a;--mut:#64748b;
  --rad:10px;--shd:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)
}
body{font:14px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--txt);display:flex;min-height:100vh}
aside{width:236px;background:var(--side);flex-shrink:0;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#1e293b transparent}
.brand{padding:18px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--side-bdr)}
.brand-name{font-size:15px;font-weight:700;color:#f1f5f9;letter-spacing:-.3px}
nav{flex:1;padding:4px 0 12px}
.nav-section{padding:18px 0 2px}
.nav-label{padding:0 14px 6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569}
.nav-a{display:flex;align-items:center;gap:9px;padding:7px 10px;margin:1px 8px;color:var(--side-txt);text-decoration:none;font-size:13px;border-radius:7px;transition:background .1s,color .1s}
.nav-a svg{flex-shrink:0;opacity:.6;transition:opacity .1s}
.nav-a:hover{background:#1e293b;color:#e2e8f0;text-decoration:none}
.nav-a:hover svg{opacity:.9}
.nav-a.on{background:rgba(99,102,241,.18);color:#a5b4fc}
.nav-a.on svg{opacity:1;color:#818cf8}
.nav-count{margin-left:auto;background:#f59e0b;color:#451a03;border-radius:20px;min-width:20px;padding:1px 6px;text-align:center;font-size:10px;font-weight:800}
.nav-footer{padding:14px;border-top:1px solid var(--side-bdr);margin-top:auto}
.nav-footer-name{font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:2px}
.nav-footer-role{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:10px}
.nav-footer .btn{background:rgba(255,255,255,.07);color:#94a3b8;border:1px solid rgba(255,255,255,.1);width:100%;justify-content:center}
.nav-footer .btn:hover{background:rgba(255,255,255,.13);color:#e2e8f0;text-decoration:none}
main{flex:1;padding:28px 36px;overflow-x:auto}
.topbar{display:flex;justify-content:flex-end;margin-bottom:24px;gap:12px;align-items:center}
.global-search{display:flex;gap:0;width:min(420px,100%)}
.global-search input{border-radius:9px 0 0 9px;border-right:0;min-width:0;flex:1}
.global-search .btn{border-radius:0 9px 9px 0;padding:8px 16px}
h1{font-size:22px;font-weight:700;margin-bottom:20px;letter-spacing:-.4px;color:var(--txt)}
h2{font-size:15px;font-weight:600;margin:20px 0 10px;color:var(--txt)}
h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin-bottom:14px}
.card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--rad);padding:18px 20px;margin-bottom:18px;box-shadow:var(--shd)}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
th{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);background:#f8fafc;border-bottom:1px solid var(--bdr)}
tr:last-child td{border-bottom:0}
tr:hover td{background:#fafbfd}
.table-wrap{overflow-x:auto;border-radius:var(--rad)}
.sticky-table{width:100%;border-collapse:collapse}
.sticky-table th{position:sticky;top:0;z-index:2;background:#f8fafc}
tr.row-deployable td:first-child{border-left:3px solid #22c55e}
tr.row-deployed td:first-child{border-left:3px solid #6366f1}
tr.row-maintenance td:first-child{border-left:3px solid #f59e0b}
tr.row-archived td:first-child{border-left:3px solid #94a3b8}
tr[data-href]:hover td{background:#fafbff;cursor:pointer}
a{color:var(--pri);text-decoration:none}
a:hover{text-decoration:underline}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--pri);color:#fff;border:0;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;transition:background .12s;white-space:nowrap}
.btn:hover{background:var(--pri-dk);text-decoration:none;color:#fff}
.btn.sec{background:#f1f5f9;color:var(--txt);border:1px solid var(--bdr)}
.btn.sec:hover{background:#e2e8f0}
.btn.danger{background:#ef4444;color:#fff}
.btn.danger:hover{background:#dc2626}
.btn.sm{padding:5px 11px;font-size:12px;border-radius:6px}
input,select,textarea{width:100%;padding:8px 11px;border:1px solid var(--bdr);border-radius:7px;font:inherit;background:#fff;color:var(--txt);transition:border-color .12s,box-shadow .12s}
select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
input:focus,select:focus,textarea:focus{outline:0;border-color:var(--pri);box-shadow:0 0 0 3px rgba(99,102,241,.12)}
input.filter-active,select.filter-active{border-color:var(--pri);background:#eef2ff;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
select[multiple]{min-height:42px}
.filter-form{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}
.filter-form input[type="search"],.filter-form input[type="text"]{width:260px;min-height:42px}
.filter-dd{position:relative;min-width:180px}
.filter-dd summary{list-style:none;cursor:pointer;min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid var(--bdr);border-radius:9px;padding:8px 12px;font-weight:600;color:var(--txt);box-shadow:var(--shd)}
.filter-dd summary::-webkit-details-marker{display:none}
.filter-dd summary:after{content:"▾";border:none;transform:none;margin-top:0;font-size:13px;color:#94a3b8;transition:transform .15s}
.filter-dd[open] summary:after{transform:rotate(180deg)}
.filter-dd[open] summary{border-color:var(--pri);box-shadow:0 0 0 3px rgba(99,102,241,.12)}
.filter-dd.filter-active summary{border-color:var(--pri);background:#eef2ff;color:#4338ca}
.filter-menu{position:absolute;z-index:20;top:48px;left:0;min-width:100%;max-height:280px;overflow:auto;background:#fff;border:1px solid var(--bdr);border-radius:10px;padding:8px;box-shadow:0 18px 40px rgba(15,23,42,.16)}
.filter-menu{animation:dd-in .1s ease}
@keyframes dd-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.filter-menu label{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:7px;font-weight:500;white-space:nowrap;cursor:pointer}
.filter-menu label:hover{background:#f8fafc}
.filter-menu input{width:auto}
form.inline{display:inline}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.frm{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:16px}
.frm label{display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px}
.badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.02em}
.b-green{background:#dcfce7;color:#15803d}
.b-blue{background:#dbeafe;color:#1d4ed8}
.b-amber{background:#fef3c7;color:#92400e}
.b-gray{background:#f1f5f9;color:#475569}
.b-red{background:#fee2e2;color:#b91c1c}
.chip-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:5px;background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600}
.chip a{color:#6366f1;display:flex;align-items:center;text-decoration:none;opacity:.7}
.chip a:hover{opacity:1;text-decoration:none}
.chip-clear{margin-left:4px;font-size:14px;line-height:1;color:#6366f1;text-decoration:none}
.flash{display:flex;align-items:center;gap:8px;padding:11px 16px;border-radius:9px;margin-bottom:18px;font-size:13px;font-weight:500;animation:fl-in .2s ease}
@keyframes fl-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.flash.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d}
.flash.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
.flash.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.empty-state{text-align:center;padding:64px 24px;color:var(--mut)}
.empty-state svg{width:48px;height:48px;opacity:.25;margin-bottom:14px}
.empty-state h3{font-size:16px;font-weight:600;color:var(--txt);margin-bottom:6px;text-transform:none;letter-spacing:0}
.empty-state p{font-size:13px;margin-bottom:20px}
.del-confirm{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-top:8px;font-size:13px}
.del-confirm p{margin-bottom:10px;font-weight:500;color:#b91c1c}
.del-confirm .btn-row{display:flex;gap:8px}
.pager{display:flex;align-items:center;gap:6px;margin-top:18px;justify-content:center}
.pager .btn{min-width:36px;justify-content:center}
.pager-info{color:var(--mut);font-size:13px;padding:0 8px}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap}
.toolbar input,.toolbar select{width:auto;min-width:160px}
.muted{color:var(--mut)}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:24px}
.summary-card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--rad);padding:16px 18px;box-shadow:var(--shd);position:relative;overflow:hidden;color:inherit}
.summary-card:hover{text-decoration:none;border-color:#c7d2fe}
.summary-card:after{content:"";position:absolute;right:-20px;top:-20px;width:90px;height:90px;border-radius:28px;background:rgba(99,102,241,.08);pointer-events:none;z-index:0}
.summary-top{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:12px;position:relative;z-index:1}
.summary-n{font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1}
.summary-l{font-size:13px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin-top:5px}
.summary-link{font-size:12px;font-weight:700}
.summary-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;position:relative;z-index:1}
.summary-mini{display:block;background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:8px;text-align:center;color:inherit;text-decoration:none}
.summary-mini:hover{background:#eef2ff;border-color:#c7d2fe;text-decoration:none}
.summary-mini strong{display:block;font-size:16px;line-height:1.1}
.summary-mini span{font-size:10px;color:var(--mut);text-transform:uppercase;font-weight:700;letter-spacing:.05em}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--bdr);border-radius:var(--rad);padding:14px 16px;box-shadow:var(--shd)}
.stat .n{font-size:26px;font-weight:800;line-height:1.1}
.stat .l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-weight:700;margin-top:4px}
.dash-charts{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}
.chart-card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--rad);padding:20px 22px;box-shadow:var(--shd)}
.donut-wrap{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.donut-legend{flex:1;display:flex;flex-direction:column;gap:10px}
.dl-item{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--txt)}
.dl-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.dl-val{margin-left:auto;font-weight:700;font-size:14px;color:var(--txt)}
.bar-items{display:flex;flex-direction:column;gap:12px}
.bar-hd{display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;color:var(--txt)}
.bar-hd strong{font-weight:700}
.bar-track{background:#f1f5f9;border-radius:4px;height:7px;overflow:hidden}
.bar-fill{height:7px;border-radius:4px;background:var(--pri)}
.dash-lower{display:grid;grid-template-columns:2fr 1fr;gap:18px;align-items:start;margin-bottom:18px}
.alert-stack{display:flex;flex-direction:column;gap:14px}
.alert-card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--rad);padding:0;box-shadow:var(--shd);overflow:hidden}
.labels{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.label-card{border:1px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;background:#fff}
.label-card svg{width:110px;height:110px}
@media(max-width:960px){.dash-charts,.dash-lower{grid-template-columns:1fr}}
@media print{aside,.no-print{display:none!important}main{padding:0;max-width:none}body{background:#fff}}
`;

export function layout(user: User | null, title: string, body: string, path = "", flash = "", searchQ = ""): Response {
  const name = appName();
  const ver = process.env.APP_VERSION || "";
  let flashType: "ok"|"err"|"warn" = "ok";
  if (flash.startsWith("ERR:")) { flashType = "err"; flash = flash.slice(4); }
  else if (flash.startsWith("WARN:")) { flashType = "warn"; flash = flash.slice(5); }
  let nav = "";
  if (user) {
    nav = NAV_SECTIONS.map(({ section, items }) => {
      const links = items
        .filter(([, , r, , perm]) => user.permissions ? (perm ? user.permissions.has(perm) : false) : roleRank[user.role] >= roleRank[r])
        .map(([href, label, , iconKey]) => {
          const on = path === href || (href !== "/" && path.startsWith(href));
          return `<a href="${href}" class="nav-a${on ? " on" : ""}">${ICONS[iconKey] ?? ""}${label}</a>`;
        })
        .join("");
      return links
        ? `<div class="nav-section"><div class="nav-label">${section}</div>${links}</div>`
        : "";
    }).join("");
  }

  const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(name)}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3"><link rel="shortcut icon" href="/favicon.svg?v=3"><style>${CSS}</style></head>
<body>
<aside id="sidebar">
  <div class="brand">${BRAND_ICON}<span class="brand-name">${esc(name)}</span></div>
  <nav>${nav}</nav>
  ${user ? `<div class="nav-footer"><div class="nav-footer-name">${esc(user.name)}</div><div class="nav-footer-role">${esc(user.role)}</div>${ver ? `<span class="muted" style="font-size:11px">${esc(ver)}</span>` : ""}<form method="post" action="/logout"><button class="btn sm">Sign out</button></form></div>` : ""}
</aside>
<main>${user ? `<div class="topbar no-print"><form class="global-search" method="get" action="/search"><input name="q" value="${esc(searchQ)}" placeholder="Search assets, licenses, users…"><button class="btn sec">Search</button></form></div>` : ""}${flashHtml(flash, flashType)}${body}</main>
<script>
(function(){
  var s=document.getElementById('sidebar');var k='__nav_scroll';var v=sessionStorage.getItem(k);if(v&&s)s.scrollTop=parseInt(v,10);if(s)s.addEventListener('scroll',function(){sessionStorage.setItem(k,String(s.scrollTop));},{passive:true});
  document.addEventListener('click',function(e){
    document.querySelectorAll('details.filter-dd[open]').forEach(function(d){ if(!d.contains(e.target))d.removeAttribute('open'); });
  });
  document.querySelectorAll('.filter-dd input[type="checkbox"]').forEach(function(cb){
    cb.addEventListener('change',function(){
      var form=cb.closest('form');
      if(form)form.submit();
    });
  });
  var fl=document.querySelector('.flash');
  if(fl)setTimeout(function(){fl.style.transition='opacity .4s';fl.style.opacity='0';setTimeout(function(){fl.remove();},400);},4000);
  document.querySelectorAll('.del-toggle').forEach(function(btn){
    btn.addEventListener('click',function(){
      var target=document.getElementById(btn.dataset.target);
      if(target)target.hidden=!target.hidden;
    });
  });
  document.querySelectorAll('tr[data-href]').forEach(function(r){
    r.style.cursor='pointer';
    r.addEventListener('click',function(e){
      if(e.target.closest('a,button,input,form,details,label'))return;
      window.location=r.dataset.href;
    });
  });
})();
</script>
</body></html>`;
  return html(user ? page.replace(/(<form\b[^>]*\bmethod=["']post["'][^>]*>)/gi, `$1${csrfInput(user)}`) : page);
}

import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, layout, redirect } from "./web";

const TYPES = ["asset", "accessory"];
const statusBadge = (status: string) => {
  const cls: Record<string, string> = { pending: "b-amber", approved: "b-green", denied: "b-red" };
  return `<span class="badge ${cls[status] || "b-gray"}">${esc(status)}</span>`;
};

export function requestsPage(user: User, url: URL, canEdit: boolean): Response {
  const rows = db.query(`SELECT r.*, u.name requester,
    CASE r.entity_type
      WHEN 'asset' THEN a.name || ' (' || a.asset_tag || ')' || ' — ' || a.status
      WHEN 'accessory' THEN ac.name
    END entity_name,
    h.name handler_name
    FROM checkout_requests r
    JOIN users u ON u.id=r.user_id
    LEFT JOIN assets a ON r.entity_type='asset' AND a.id=r.entity_id
    LEFT JOIN accessories ac ON r.entity_type='accessory' AND ac.id=r.entity_id
    LEFT JOIN users h ON h.id=r.handled_by
    WHERE r.status='pending'
    ORDER BY r.id ASC`).all() as any[];
  const actions = (r: any) => canEdit ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
<form class="inline" method="post" action="/requests/${esc(r.id)}/approve"><button class="btn sm">Approve</button></form>
<form method="post" action="/requests/${esc(r.id)}/deny" style="display:flex;gap:6px;align-items:center"><input name="reason" placeholder="Denial reason" style="width:150px"><button class="btn danger sm">Deny</button></form>
</div>` : "";
  const body = `<h1>Checkout Requests <span class="muted">(${rows.length} pending)</span></h1>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Requester</th><th>Item</th><th>Type</th><th>Note</th><th>Requested at</th><th></th></tr>
${rows.map(r=>`<tr><td>${esc(r.requester)}</td><td>${esc(r.entity_name || "Deleted item")}</td><td>${esc(r.entity_type)}</td><td>${esc(r.note || "")}</td><td>${esc(r.created_at)}</td><td>${actions(r)}</td></tr>`).join("")}
</table></div>`;
  return layout(user, "Checkout Requests", body, "/requests", url.searchParams.get("m") || "");
}

export function myRequests(user: User): string {
  const rows = db.query(`SELECT r.*,
    CASE r.entity_type
      WHEN 'asset' THEN a.name || ' (' || a.asset_tag || ')'
      WHEN 'accessory' THEN ac.name
    END entity_name
    FROM checkout_requests r
    LEFT JOIN assets a ON r.entity_type='asset' AND a.id=r.entity_id
    LEFT JOIN accessories ac ON r.entity_type='accessory' AND ac.id=r.entity_id
    WHERE r.user_id=?
    ORDER BY r.id DESC LIMIT 50`).all(user.id) as any[];
  return `<h2>My Requests</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Item</th><th>Type</th><th>Status</th><th>Note</th><th>Requested at</th><th>Handler note</th></tr>
${rows.map(r=>`<tr><td>${esc(r.entity_name || "Deleted item")}</td><td>${esc(r.entity_type)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.note || "")}</td><td>${esc(r.created_at)}</td><td>${esc(r.handler_note || "")}</td></tr>`).join("")}
</table></div>`;
}

export async function submitRequest(user: User, entityType: string, entityId: string, req: Request): Promise<Response> {
  if (!TYPES.includes(entityType) || !/^\d+$/.test(entityId)) return redirect("/my?m=Item not found");
  const item = entityType === "asset"
    ? db.query("SELECT id FROM assets WHERE id=?").get(entityId)
    : db.query("SELECT id FROM accessories WHERE id=?").get(entityId);
  if (!item) return redirect("/my?m=Item not found");
  const duplicate = db.query("SELECT id FROM checkout_requests WHERE entity_type=? AND entity_id=? AND user_id=? AND status='pending'").get(entityType, entityId, user.id);
  if (duplicate) return redirect("/my?m=You already have a pending request for this item");
  const v = await formVals(req);
  db.run("INSERT INTO checkout_requests(entity_type,entity_id,user_id,note) VALUES(?,?,?,?)", [entityType, entityId, user.id, v("note") || null]);
  logActivity(user.id, "request", entityType, Number(entityId), v("note") || "");
  return redirect("/my?m=Request submitted");
}

export function approveRequest(user: User, id: string): Response {
  if (!/^\d+$/.test(id)) return redirect("/requests?m=Request not found");
  let approved: any;
  try {
    db.transaction(() => {
      const request = db.query("SELECT * FROM checkout_requests WHERE id=? AND status='pending'").get(id) as any;
      if (!request || !TYPES.includes(request.entity_type)) throw new Error("not_found");
      if (request.entity_type === "asset") {
        const r = db.run("UPDATE assets SET status='deployed',assigned_to=?,checkout_location_id=NULL WHERE id=? AND status='deployable'", [request.user_id, request.entity_id]);
        if (!r.changes) throw new Error("asset_unavailable");
      } else {
        const avail = (db.query(`SELECT qty-(SELECT COUNT(*) FROM accessory_checkouts WHERE accessory_id=? AND checked_in_at IS NULL) available FROM accessories WHERE id=?`).get(request.entity_id, request.entity_id) as any)?.available ?? 0;
        if (avail <= 0) throw new Error("accessory_unavailable");
        db.run("INSERT INTO accessory_checkouts(accessory_id,user_id,note) VALUES(?,?,?)", [request.entity_id, request.user_id, request.note || null]);
      }
      const r = db.run("UPDATE checkout_requests SET status='approved',handled_by=?,handled_at=datetime('now') WHERE id=? AND status='pending'", [user.id, id]);
      if (!r.changes) throw new Error("not_found");
      approved = request;
    })();
  } catch (e: any) {
    const message = e.message === "asset_unavailable" ? "Asset is no longer available"
      : e.message === "accessory_unavailable" ? "Accessory is no longer available"
      : "Request not found";
    return redirect(`/requests?m=${encodeURIComponent(message)}`);
  }
  logActivity(user.id, "approve", approved.entity_type, Number(approved.entity_id), `checkout request ${id}`);
  return redirect("/requests?m=Approved");
}

export async function denyRequest(user: User, id: string, req: Request): Promise<Response> {
  if (!/^\d+$/.test(id)) return redirect("/requests?m=Request not found or already handled");
  const v = await formVals(req);
  const r = db.run(`UPDATE checkout_requests SET status='denied',handled_by=?,handler_note=?,handled_at=datetime('now')
    WHERE id=? AND status='pending'`, [user.id, v("reason") || null, id]);
  if (!r.changes) return redirect("/requests?m=Request not found or already handled");
  logActivity(user.id, "deny", "checkout_request", Number(id), v("reason") || "");
  return redirect("/requests?m=Request denied");
}

import { db, logActivity } from "./db";
import type { User } from "./auth";
import { queue } from "./email";
import { appName, baseUrl } from "./settings";
import { esc, formVals, layout, opt, redirect } from "./web";

const ACTIONS = ["manual", "policy"] as const;
type AckAction = "asset_checkout" | "manual" | "policy" | "offboard";

function genToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

function ackUrl(token: string): string {
  const base = baseUrl().replace(/\/+$/, "");
  return `${base || "http://localhost:9000"}/ack/${token}`;
}

function plain(title: string, body: string): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(appName())}</title>
<style>body{font:15px/1.6 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:40px}.box{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:22px;margin:0 0 16px}.muted{color:#64748b}.btn{display:inline-flex;background:#6366f1;color:#fff;border:0;border-radius:7px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}pre{white-space:pre-wrap;font:inherit}</style></head><body><div class="box"><div class="muted" style="margin-bottom:8px">${esc(appName())}</div>${body}</div></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function usedPage(): Response {
  return plain("Acknowledgement", `<h1>Acknowledgement</h1><p>This acknowledgement link has already been used or has expired.</p>`);
}

export function createAck(createdBy: number, userId: number, actionType: AckAction, entityType: string | null, entityId: number | null, subject: string, message: string): number {
  const token = genToken();
  const r = db.run(
    "INSERT INTO ack_tokens(token,user_id,action_type,entity_type,entity_id,subject,message,created_by) VALUES(?,?,?,?,?,?,?,?)",
    [token, userId, actionType, entityType, entityId, subject, message, createdBy]
  );
  const u = db.query("SELECT email FROM users WHERE id=?").get(userId) as any;
  if (u?.email) queue(u.email, subject, `${message}\n\nAcknowledge here: ${ackUrl(token)}`);
  const id = Number(r.lastInsertRowid);
  logActivity(createdBy, "create", "ack", id, subject);
  return id;
}

export function ackPage(token: string): Response {
  const row = db.query("SELECT subject,message FROM ack_tokens WHERE token=? AND status='pending' AND expires_at > datetime('now')").get(token) as any;
  if (!row) return usedPage();
  return plain("Acknowledgement", `<h1>${esc(row.subject)}</h1><pre>${esc(row.message)}</pre><form method="post" action="/ack/${esc(token)}"><button class="btn">I acknowledge</button></form>`);
}

export function ackSubmit(token: string, _req: Request): Response {
  const row = db.query("SELECT id,user_id,entity_type,entity_id,subject FROM ack_tokens WHERE token=?").get(token) as any;
  const r = db.run("UPDATE ack_tokens SET status='acknowledged',acknowledged_at=datetime('now') WHERE token=? AND status='pending' AND expires_at > datetime('now')", [token]);
  if (!r.changes || !row) return usedPage();
  logActivity(row.user_id, "acknowledge", row.entity_type || "ack", row.entity_id || row.id, row.subject);
  return plain("Acknowledgement recorded", `<h1>Thank you</h1><p>Thank you — acknowledgement recorded.</p>`);
}

function statusBadge(status: string): string {
  const cls: Record<string, string> = { pending: "b-amber", acknowledged: "b-green", expired: "b-gray" };
  return `<span class="badge ${cls[status] || "b-gray"}">${esc(status)}</span>`;
}

export function acksAdminPage(user: User, url: URL): Response {
  const rows = db.query(`SELECT a.*,u.name user_name,u.email user_email,c.name created_by_name
    FROM ack_tokens a JOIN users u ON u.id=a.user_id JOIN users c ON c.id=a.created_by
    ORDER BY a.id DESC LIMIT 200`).all() as any[];
  const body = `<h1>Acknowledgements</h1><div class="toolbar"><a class="btn" href="/admin/acknowledgements/new">+ New acknowledgement</a></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Subject</th><th>User</th><th>Action</th><th>Status</th><th>Created</th><th>Acknowledged</th><th>Created by</th></tr>
${rows.map(r => `<tr><td>${esc(r.subject)}</td><td>${esc(r.user_name)}<div class="muted">${esc(r.user_email || "")}</div></td><td>${esc(r.action_type)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.created_at)}</td><td>${esc(r.acknowledged_at || "—")}</td><td>${esc(r.created_by_name)}</td></tr>`).join("")}</table></div>`;
  return layout(user, "Acknowledgements", body, "/admin/acknowledgements", url.searchParams.get("m") || "");
}

export function ackNewPage(user: User): Response {
  const users = db.query("SELECT id,name FROM users WHERE active=1 AND email IS NOT NULL AND email!='' ORDER BY name").all() as any[];
  return layout(user, "New acknowledgement", `<h1>New acknowledgement</h1><div class="card"><form method="post" action="/admin/acknowledgements"><div class="frm">
<div><label>User</label><select name="target_user_id" required><option value="">Select user…</option>${opt(users, "")}</select></div>
<div><label>Action type</label><select name="action_type">${ACTIONS.map(a => `<option value="${a}">${a}</option>`).join("")}</select></div>
<div><label>Subject</label><input name="subject" required></div>
</div><label>Message</label><textarea name="message" rows="8" required></textarea><div style="margin-top:14px"><button class="btn">Send acknowledgement</button> <a class="btn sec" href="/admin/acknowledgements">Cancel</a></div></form></div>`, "/admin/acknowledgements");
}

export async function ackCreate(user: User, req: Request): Promise<Response> {
  const v = await formVals(req);
  if (!/^\d+$/.test(v("target_user_id"))) return redirect("/admin/acknowledgements/new?m=Select a valid user");
  const action = ACTIONS.includes(v("action_type") as any) ? v("action_type") as "manual" | "policy" : null;
  if (!action) return redirect("/admin/acknowledgements/new?m=Invalid action type");
  if (!v("subject") || !v("message")) return redirect("/admin/acknowledgements/new?m=Subject and message are required");
  const target = db.query("SELECT id,email FROM users WHERE id=? AND active=1").get(v("target_user_id")) as any;
  if (!target?.email) return redirect("/admin/acknowledgements/new?m=User must be active and have an email address");
  createAck(user.id, Number(target.id), action, null, null, v("subject"), v("message"));
  return redirect("/admin/acknowledgements?m=Acknowledgement sent");
}

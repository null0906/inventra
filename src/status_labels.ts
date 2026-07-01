import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, inlineConfirm, layout, redirect } from "./web";

const TYPES = ["deployable", "undeployable", "archived"];
function cleanColor(s: string): string { return /^#[0-9a-fA-F]{6}$/.test(s) ? s : "#6c757d"; }

function form(row: any = {}): string {
  return `<div class="frm">
<div><label>Name</label><input name="name" value="${esc(row.name || "")}" required></div>
<div><label>Type</label><select name="type">${TYPES.map(t=>`<option value="${t}"${row.type===t?" selected":""}>${t}</option>`).join("")}</select></div>
<div><label>Color</label><input name="color" type="color" value="${esc(cleanColor(row.color || "#6c757d"))}"></div>
</div><label>Notes</label><textarea name="notes" rows="3">${esc(row.notes || "")}</textarea>`;
}

export function list(user: User, url: URL): Response {
  const rows = db.query("SELECT * FROM status_labels ORDER BY type,name").all() as any[];
  const body = `<h1>Status Labels</h1><div class="toolbar"><a class="btn" href="/status-labels/new">+ New label</a></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Type</th><th>Color</th><th>Notes</th><th></th></tr>
${rows.map(r=>`<tr data-href="/status-labels/${r.id}/edit"><td><span class="badge" style="background:${esc(cleanColor(r.color))};color:#fff">${esc(r.name)}</span></td><td>${esc(r.type)}</td><td>${esc(r.color)}</td><td>${esc(r.notes||"")}</td><td style="white-space:nowrap"><a class="btn sec sm" href="/status-labels/${r.id}/edit">Edit</a> ${inlineConfirm(`status-label-${r.id}`,`/status-labels/${r.id}/delete`,"Delete status label","Delete this status label?",user.csrfToken)}</td></tr>`).join("")}</table></div>`;
  return layout(user, "Status Labels", body, "/status-labels", url.searchParams.get("m") || "");
}

export function newPage(user: User): Response {
  return layout(user, "New status label", `<h1>New status label</h1><div class="card"><form method="post" action="/status-labels">${form()}<div style="margin-top:14px"><button class="btn">Create</button> <a class="btn sec" href="/status-labels">Cancel</a></div></form></div>`, "/status-labels");
}

export async function create(user: User, req: Request): Promise<Response> {
  const v = await formVals(req), type = TYPES.includes(v("type")) ? v("type") : "deployable";
  if (!v("name")) return redirect("/status-labels/new?m=Name is required");
  try {
    const r = db.run("INSERT INTO status_labels(name,type,color,notes) VALUES(?,?,?,?)", [v("name"), type, cleanColor(v("color")), v("notes") || null]);
    logActivity(user.id, "create", "status_label", Number(r.lastInsertRowid), v("name"));
    return redirect("/status-labels?m=Status label created");
  } catch (e: any) { return redirect(`/status-labels?m=${encodeURIComponent(`Error: ${e.message}`)}`); }
}

export function editPage(user: User, id: string): Response {
  const row = db.query("SELECT * FROM status_labels WHERE id=?").get(id) as any;
  if (!row) return layout(user, "Not found", "<h1>Status label not found</h1>", "/status-labels");
  return layout(user, "Edit status label", `<h1>Edit status label</h1><div class="card"><form method="post" action="/status-labels/${esc(id)}/edit">${form(row)}<div style="margin-top:14px"><button class="btn">Save</button> <a class="btn sec" href="/status-labels">Cancel</a></div></form></div>`, "/status-labels");
}

export async function update(user: User, id: string, req: Request): Promise<Response> {
  const v = await formVals(req), type = TYPES.includes(v("type")) ? v("type") : "deployable";
  if (!v("name")) return redirect(`/status-labels/${encodeURIComponent(id)}/edit?m=Name is required`);
  try {
    db.run("UPDATE status_labels SET name=?,type=?,color=?,notes=? WHERE id=?", [v("name"), type, cleanColor(v("color")), v("notes") || null, id]);
    db.run(`UPDATE assets SET status_label_id=NULL WHERE status_label_id=? AND (
      (status='deployable' AND ?!='deployable') OR (status='maintenance' AND ?!='undeployable') OR (status='archived' AND ?!='archived') OR status='deployed'
    )`, [id, type, type, type]);
    logActivity(user.id, "update", "status_label", Number(id), v("name"));
    return redirect("/status-labels?m=Saved");
  } catch (e: any) { return redirect(`/status-labels?m=${encodeURIComponent(`Error: ${e.message}`)}`); }
}

export function remove(user: User, id: string): Response {
  const row = db.query("SELECT name FROM status_labels WHERE id=?").get(id) as any;
  if (!row) return redirect("/status-labels?m=Status label not found");
  const used = Number((db.query("SELECT COUNT(*) n FROM assets WHERE status_label_id=?").get(id) as any).n);
  if (used) return redirect("/status-labels?m=Cannot delete a status label assigned to assets");
  db.run("DELETE FROM status_labels WHERE id=?", [id]);
  logActivity(user.id, "delete", "status_label", Number(id), row.name);
  return redirect("/status-labels?m=Deleted");
}

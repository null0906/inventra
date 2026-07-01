import { db, logActivity } from "./db";
import type { User } from "./auth";
import { esc, formVals, inlineConfirm, layout, opt, redirect } from "./web";

export function auditList(user: User, url: URL, canEdit: boolean): Response {
  const rows = db.query(`SELECT s.*,l.name location,
    (SELECT COUNT(*) FROM audit_items i WHERE i.session_id=s.id) expected,
    (SELECT COUNT(*) FROM audit_items i WHERE i.session_id=s.id AND i.verified_at IS NOT NULL) verified
    FROM audit_sessions s LEFT JOIN locations l ON l.id=s.location_id ORDER BY s.id DESC`).all() as any[];
  const body = `<h1>Physical Audits <span class="muted">(${rows.length})</span></h1>
<div class="toolbar">${canEdit?'<a class="btn" href="/audits/new">+ New audit</a>':""}</div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Location</th><th>Started</th><th>Closed</th><th>Assets expected</th><th>Verified</th></tr>
${rows.map(r=>`<tr data-href="/audits/${r.id}"><td><a href="/audits/${r.id}">${esc(r.name)}</a></td><td>${esc(r.location || "All locations")}</td><td>${esc(r.started_at)}</td><td>${esc(r.closed_at || "")}</td><td>${r.expected}</td><td>${r.verified}</td></tr>`).join("")}
</table></div>`;
  return layout(user,"Physical Audits",body,"/audits",url.searchParams.get("m")||"");
}

export function auditNewPage(user: User): Response {
  const locations=db.query("SELECT id,name FROM locations ORDER BY name").all() as any[];
  const body=`<h1>New Physical Audit</h1><div class="card"><form method="post" action="/audits"><div class="frm">
<div><label>Name *</label><input name="name" required></div>
<div><label>Location</label><select name="location_id"><option value="">All locations</option>${opt(locations,"")}</select></div>
</div><button class="btn">Start audit</button> <a class="btn sec" href="/audits">Cancel</a></form></div>`;
  return layout(user,"New Physical Audit",body,"/audits");
}

export async function auditCreate(user: User, req: Request): Promise<Response> {
  const v=await formVals(req),locationId=v("location_id");
  if(!v("name"))return redirect("/audits/new?m=Name is required");
  if(locationId&&!/^\d+$/.test(locationId))return redirect("/audits/new?m=Invalid location");
  if(locationId&&!db.query("SELECT id FROM locations WHERE id=?").get(locationId))return redirect("/audits/new?m=Invalid location");
  let id=0;
  db.transaction(()=>{
    const r=db.run("INSERT INTO audit_sessions(name,location_id,created_by) VALUES(?,?,?)",[v("name"),locationId||null,user.id]);
    id=Number(r.lastInsertRowid);
    if(locationId)db.run("INSERT INTO audit_items(session_id,asset_id) SELECT ?,id FROM assets WHERE location_id=? AND status!='archived'",[id,locationId]);
    else db.run("INSERT INTO audit_items(session_id,asset_id) SELECT ?,id FROM assets WHERE status!='archived'",[id]);
  })();
  logActivity(user.id,"audit-create","audit_session",id,v("name"));
  return redirect(`/audits/${id}?m=Audit started`);
}

export function auditDetail(user: User, id: string, url: URL, canEdit: boolean): Response {
  if(!/^\d+$/.test(id))return layout(user,"Not found","<h1>Audit not found</h1>","/audits");
  const session=db.query("SELECT s.*,l.name location FROM audit_sessions s LEFT JOIN locations l ON l.id=s.location_id WHERE s.id=?").get(id) as any;
  if(!session)return layout(user,"Not found","<h1>Audit not found</h1>","/audits");
  const rows=db.query(`SELECT i.*,a.asset_tag,a.name,a.status,l.name location,u.name verifier
    FROM audit_items i JOIN assets a ON a.id=i.asset_id
    LEFT JOIN locations l ON l.id=a.location_id LEFT JOIN users u ON u.id=i.verified_by
    WHERE i.session_id=? ORDER BY a.asset_tag`).all(id) as any[];
  const verified=rows.filter(r=>r.verified_at),pending=rows.filter(r=>!r.verified_at),editable=canEdit&&!session.closed_at;
  const percent=rows.length?Math.round(verified.length/rows.length*100):100;
  const verifyAction=(r:any)=>editable?`<form method="post" action="/audits/${esc(id)}/items/${r.id}/verify" style="display:flex;gap:6px"><input name="note" placeholder="Notes" style="min-width:130px"><button class="btn sm">Mark verified</button></form>`:"";
  const controls=editable?`<div class="card no-print"><form method="post" action="/audits/${esc(id)}/items" style="display:flex;gap:8px;align-items:end"><div style="flex:1"><label>Scan or enter asset tag</label><input name="asset_tag" required></div><div style="flex:1"><label>Notes</label><input name="note"></div><button class="btn">Add & verify</button></form></div>
${inlineConfirm(`audit-${id}`,`/audits/${id}/close`,"Close audit","Close this audit?",user.csrfToken)}`:"";
  const body=`<h1>${esc(session.name)}</h1><p class="muted" style="margin-bottom:14px">${esc(session.location || "All locations")} · Started ${esc(session.started_at)}${session.closed_at?` · Closed ${esc(session.closed_at)}`:""}</p>
<div class="card"><strong>${verified.length} verified / ${rows.length} total</strong><div class="bar-track" style="margin-top:8px"><div class="bar-fill" style="width:${percent}%"></div></div></div>${controls}
<h2>Verified</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Asset tag</th><th>Name</th><th>Verified by</th><th>Verified at</th><th>Notes</th></tr>
${verified.map(r=>`<tr><td><a href="/assets/${r.asset_id}">${esc(r.asset_tag)}</a></td><td>${esc(r.name||"")}</td><td>${esc(r.verifier||"")}</td><td>${esc(r.verified_at)}</td><td>${esc(r.notes||"")}</td></tr>`).join("")}</table></div>
<h2>Pending</h2><div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Asset tag</th><th>Name</th><th>Status</th><th>Location</th><th></th></tr>
${pending.map(r=>`<tr><td><a href="/assets/${r.asset_id}">${esc(r.asset_tag)}</a></td><td>${esc(r.name||"")}</td><td>${esc(r.status)}</td><td>${esc(r.location||"")}</td><td>${verifyAction(r)}</td></tr>`).join("")}</table></div>`;
  return layout(user,session.name,body,"/audits",url.searchParams.get("m")||"");
}

export async function auditVerify(user: User, sessionId: string, itemId: string, req: Request): Promise<Response> {
  if(!/^\d+$/.test(sessionId)||!/^\d+$/.test(itemId))return redirect("/audits?m=Invalid audit item");
  const v=await formVals(req);
  const r=db.run(`UPDATE audit_items SET verified_by=?,verified_at=datetime('now'),notes=?
    WHERE id=? AND session_id=? AND verified_at IS NULL
    AND EXISTS(SELECT 1 FROM audit_sessions s WHERE s.id=? AND s.closed_at IS NULL)`,
    [user.id,v("note")||null,itemId,sessionId,sessionId]);
  if(!r.changes)return redirect(`/audits/${encodeURIComponent(sessionId)}?m=Already verified, audit closed, or item not found`);
  logActivity(user.id,"audit-verify","audit_session",Number(sessionId),`item ${itemId}`);
  return redirect(`/audits/${sessionId}?m=Asset verified`);
}

export async function auditAddAsset(user: User, sessionId: string, req: Request): Promise<Response> {
  if(!/^\d+$/.test(sessionId))return redirect("/audits?m=Invalid audit");
  const v=await formVals(req);
  const asset=db.query("SELECT id,asset_tag FROM assets WHERE asset_tag=?").get(v("asset_tag")) as any;
  const session=db.query("SELECT id FROM audit_sessions WHERE id=? AND closed_at IS NULL").get(sessionId);
  if(!session)return redirect(`/audits/${encodeURIComponent(sessionId)}?m=Audit not found or closed`);
  if(!asset)return redirect(`/audits/${sessionId}?m=Asset tag not found`);
  let added=false,verified=false;
  try{db.transaction(()=>{
    if(!db.query("SELECT id FROM audit_sessions WHERE id=? AND closed_at IS NULL").get(sessionId))throw new Error("closed");
    const r=db.run("INSERT OR IGNORE INTO audit_items(session_id,asset_id) VALUES(?,?)",[sessionId,asset.id]);
    added=Boolean(r.changes);
    const x=db.run(`UPDATE audit_items SET verified_by=?,verified_at=datetime('now'),notes=?
      WHERE session_id=? AND asset_id=? AND verified_at IS NULL
      AND EXISTS(SELECT 1 FROM audit_sessions WHERE id=? AND closed_at IS NULL)`,
      [user.id,v("note")||null,sessionId,asset.id,sessionId]);
    if(!x.changes&&!db.query("SELECT id FROM audit_items WHERE session_id=? AND asset_id=? AND verified_at IS NOT NULL").get(sessionId,asset.id))throw new Error("closed");
    verified=Boolean(x.changes);
  })();}catch{return redirect(`/audits/${encodeURIComponent(sessionId)}?m=Audit not found or closed`);}
  logActivity(user.id,"audit-add","audit_session",Number(sessionId),`${asset.asset_tag}${added?" added and verified":verified?" verified":" already verified"}`);
  return redirect(`/audits/${sessionId}?m=${encodeURIComponent(added?"Asset added and verified":verified?"Asset verified":"Asset already in audit")}`);
}

export function auditClose(user: User, id: string): Response {
  if(!/^\d+$/.test(id))return redirect("/audits?m=Invalid audit");
  const r=db.run("UPDATE audit_sessions SET closed_at=datetime('now') WHERE id=? AND closed_at IS NULL",[id]);
  if(!r.changes)return redirect(`/audits/${encodeURIComponent(id)}?m=Already closed`);
  logActivity(user.id,"audit-close","audit_session",Number(id),"Audit closed");
  return redirect(`/audits/${id}?m=Audit closed`);
}

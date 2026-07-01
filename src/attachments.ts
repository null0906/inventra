import { existsSync,unlinkSync } from "node:fs";
import { attachmentDir,db,logActivity } from "./db";
import type { User } from "./auth";
import { esc,redirect,roleRank } from "./web";

const TYPES=new Set(["image/jpeg","image/png","image/gif","image/webp","application/pdf","text/plain"]);
const entityPath=(type:string,id:string|number)=>`/${type==="asset"?"assets":"licenses"}/${encodeURIComponent(String(id))}`;
const diskPath=(filename:string)=>`${attachmentDir}/${filename}`;
const safeOriginal=(name:string)=>name.replace(/[^\x20-\x7e]|[\r\n"]/g,"_");
function validEntity(type:string,id:string):boolean{return (type==="asset"||type==="license")&&/^\d+$/.test(id)&&!!db.query(`SELECT id FROM ${type==="asset"?"assets":"licenses"} WHERE id=?`).get(id);}

export function attachmentList(entityType:string,entityId:string|number,canUpload:boolean):string{
  const rows=db.query(`SELECT a.*,u.name uploader FROM attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.entity_type=? AND a.entity_id=? ORDER BY a.id DESC`).all(entityType,entityId) as any[];
  const table=`<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Name</th><th>Size</th><th>Uploaded</th><th>By</th><th></th></tr>${rows.map(a=>`<tr><td>${esc(a.orig_name)}</td><td>${(Number(a.size_bytes)/1024).toFixed(1)} KB</td><td>${esc(a.created_at)}</td><td>${esc(a.uploader)}</td><td><a class="btn sec sm" href="/attachments/${a.id}">Download</a> <form class="inline" method="post" action="/attachments/${a.id}/delete"><button class="btn danger sm">Delete</button></form></td></tr>`).join("")}</table></div>`;
  const upload=canUpload?`<div class="card no-print"><form method="post" action="${entityPath(entityType,entityId)}/attachments" enctype="multipart/form-data"><div class="frm"><div><label>Attach file</label><input type="file" name="file" required></div></div><button class="btn">Upload</button><p class="muted" style="margin-top:8px">PDF, text, JPEG, PNG, GIF, or WebP. Maximum 10 MB.</p></form></div>`:"";
  return `<h2>Attachments</h2>${table}${upload}`;
}

export async function uploadAttachment(user:User,entityType:string,entityId:string,req:Request):Promise<Response>{
  const back=entityPath(entityType,entityId);if(!validEntity(entityType,entityId))return redirect(`${back}?m=Entity not found`);
  const form=await req.formData(),file=form.get("file");if(!(file instanceof File)||!file.name)return redirect(`${back}?m=Choose a file`);
  if(file.size>10_485_760)return redirect(`${back}?m=File exceeds the 10 MB limit`);
  const mime=file.type.toLowerCase().split(";")[0].trim();if(!TYPES.has(mime))return redirect(`${back}?m=File type is not allowed`);
  const orig=file.name.slice(0,255),placeholder=`pending-${crypto.randomUUID()}`;
  const r=db.run(`INSERT INTO attachments(entity_type,entity_id,filename,orig_name,mime_type,size_bytes,uploaded_by)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM attachments WHERE entity_type=? AND entity_id=?)<20`,
    [entityType,entityId,placeholder,orig,mime,file.size,user.id,entityType,entityId]);
  if(!r.changes)return redirect(`${back}?m=Attachment limit reached`);
  const id=Number(r.lastInsertRowid),sanitized=orig.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,80)||"file",filename=`${id}-${sanitized}`;
  try{await Bun.write(diskPath(filename),file);db.run("UPDATE attachments SET filename=? WHERE id=?",[filename,id]);logActivity(user.id,"upload",entityType,Number(entityId),orig);return redirect(`${back}?m=Attachment uploaded`);}
  catch{try{if(existsSync(diskPath(filename)))unlinkSync(diskPath(filename));}catch{}db.run("DELETE FROM attachments WHERE id=?",[id]);return redirect(`${back}?m=Attachment write failed`);}
}

export function deleteAttachment(user:User,id:string):Response{
  const a=db.query("SELECT * FROM attachments WHERE id=?").get(id) as any;if(!a)return redirect("/?m=Attachment not found");
  if(a.uploaded_by!==user.id&&roleRank[user.role]<roleRank.manager)return new Response("Forbidden",{status:403});
  try{if(existsSync(diskPath(a.filename)))unlinkSync(diskPath(a.filename));}catch{}
  db.run("DELETE FROM attachments WHERE id=?",[id]);logActivity(user.id,"delete",a.entity_type,a.entity_id,a.orig_name);return redirect(`${entityPath(a.entity_type,a.entity_id)}?m=Attachment deleted`);
}

export async function serveAttachment(_user:User,id:string):Promise<Response>{
  const a=db.query("SELECT * FROM attachments WHERE id=?").get(id) as any;if(!a)return new Response("Not found",{status:404});
  const path=diskPath(a.filename);if(!existsSync(path))return new Response("Not found",{status:404});
  return new Response(Bun.file(path),{headers:{"Content-Type":a.mime_type,"Content-Disposition":`attachment; filename="${safeOriginal(a.orig_name)}"`,"Cache-Control":"private, no-store"}});
}

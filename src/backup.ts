import { db, attachmentDir } from "./db";
import type { User } from "./auth";
import { esc, layout, redirect } from "./web";
import { getSetting, upsertSetting } from "./settings";
import { logActivity } from "./db";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";

type ZipEntry = { name: string; data: Uint8Array };
type S3Cfg = { endpoint:string; bucket:string; region:string; keyId:string; secret:string; prefix:string };
const enc = new TextEncoder();
const dec = new TextDecoder();

class ZipWriter {
  private files: Array<{name:string; data:Uint8Array; offset:number; crc:number}> = [];
  private buf: Uint8Array[] = [];
  private offset = 0;

  add(name: string, data: Uint8Array): void {
    const n = enc.encode(name), crc = this.crc32(data), start = this.offset;
    this.push(this.u32le(0x04034b50), this.u16le(20), this.u16le(0), this.u16le(0), this.u16le(0), this.u16le(0),
      this.u32le(crc), this.u32le(data.byteLength), this.u32le(data.byteLength), this.u16le(n.byteLength), this.u16le(0), n, data);
    this.files.push({ name, data, offset: start, crc });
  }

  finish(): Uint8Array {
    const cdStart = this.offset;
    for (const f of this.files) {
      const n = enc.encode(f.name);
      this.push(this.u32le(0x02014b50), this.u16le(20), this.u16le(20), this.u16le(0), this.u16le(0), this.u16le(0), this.u16le(0),
        this.u32le(f.crc), this.u32le(f.data.byteLength), this.u32le(f.data.byteLength), this.u16le(n.byteLength), this.u16le(0),
        this.u16le(0), this.u16le(0), this.u16le(0), this.u32le(0), this.u32le(f.offset), n);
    }
    const cdSize = this.offset - cdStart;
    this.push(this.u32le(0x06054b50), this.u16le(0), this.u16le(0), this.u16le(this.files.length), this.u16le(this.files.length),
      this.u32le(cdSize), this.u32le(cdStart), this.u16le(0));
    return concat(this.buf);
  }

  private push(...xs: Uint8Array[]): void { for (const x of xs) { this.buf.push(x); this.offset += x.byteLength; } }
  private u16le(n: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
  private u32le(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
  private crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of data) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0; for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}
function* walkDir(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walkDir(full); else if (e.isFile()) yield full;
  }
}
function localDir(): string { return getSetting("backup_local_dir", `${process.env.DATA_DIR || "./data"}/backups`); }
function validBackupName(name: string): boolean { return /^inventra-backup-[\w\-]+\.zip$/.test(name); }
function cleanRel(name: string): boolean { return !!name && !name.startsWith("/") && !name.includes("..") && !name.includes("\\"); }
function size(n: number): string { return n > 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.ceil(n/1024)} KB`; }

export async function createBackup(): Promise<{filename:string; data:Uint8Array}> {
  const zip = new ZipWriter(), ts = new Date().toISOString().replace(/[:.]/g, "-");
  const raw = db.serialize() as ArrayBuffer | Uint8Array;
  const dbBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  zip.add("app.db", dbBytes);
  let fileCount = 0;
  if (existsSync(attachmentDir)) {
    for (const entry of walkDir(attachmentDir)) {
      const rel = entry.slice(attachmentDir.length + 1);
      if (!cleanRel(rel)) continue;
      zip.add(`attachments/${rel}`, new Uint8Array(await Bun.file(entry).arrayBuffer()));
      fileCount++;
    }
  }
  zip.add("manifest.json", enc.encode(JSON.stringify({
    version: 1,
    created_at: new Date().toISOString(),
    app_version: process.env.APP_VERSION || "unknown",
    db_size_bytes: dbBytes.byteLength,
    attachment_count: fileCount,
  }, null, 2)));
  return { filename: `inventra-backup-${ts}.zip`, data: zip.finish() };
}

export async function saveLocal(data: Uint8Array, filename: string): Promise<string> {
  const dir = localDir();
  mkdirSync(dir, { recursive: true });
  const dest = `${dir}/${filename}`;
  await Bun.write(dest, data);
  pruneLocal(dir);
  return dest;
}
function pruneLocal(dir: string): void {
  const keep = Math.max(1, Number(getSetting("backup_retention", "10")) || 10);
  const files = readdirSync(dir).filter(f => f.endsWith(".zip")).map(f => ({ f, t: statSync(`${dir}/${f}`).mtimeMs })).sort((a,b) => b.t - a.t);
  for (const { f } of files.slice(keep)) unlinkSync(`${dir}/${f}`);
}

async function shaHex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
function hex(data: Uint8Array): string { return [...data].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function signV4(method:string, url:URL, body:Uint8Array, cfg:S3Cfg): Promise<Record<string,string>> {
  const now = new Date(), amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), date = amz.slice(0,8);
  const payload = await shaHex(body);
  const path = url.pathname.split("/").map(x => encodeURIComponent(decodeURIComponent(x))).join("/");
  const host = url.host;
  const canonical = `${method}\n${path}\n${url.searchParams.toString()}\nhost:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${amz}\n\nhost;x-amz-content-sha256;x-amz-date\n${payload}`;
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${await shaHex(canonical)}`;
  const kDate = await hmac(enc.encode(`AWS4${cfg.secret}`), date);
  const kRegion = await hmac(kDate, cfg.region);
  const kSvc = await hmac(kRegion, "s3");
  const kSign = await hmac(kSvc, "aws4_request");
  const sig = hex(await hmac(kSign, toSign));
  return {
    Host: host,
    "x-amz-date": amz,
    "x-amz-content-sha256": payload,
    Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.keyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}`,
  };
}
export async function saveS3(data: Uint8Array, filename: string): Promise<void> {
  const cfg: S3Cfg = {
    endpoint: getSetting("backup_s3_endpoint", ""),
    bucket: getSetting("backup_s3_bucket", ""),
    region: getSetting("backup_s3_region", "us-east-1"),
    keyId: getSetting("backup_s3_key_id", ""),
    secret: getSetting("backup_s3_secret", ""),
    prefix: getSetting("backup_s3_prefix", "inventra-backups"),
  };
  if (!cfg.endpoint || !cfg.bucket || !cfg.keyId || !cfg.secret) throw new Error("S3 not configured");
  const key = `${cfg.prefix || "inventra-backups"}/${filename}`.replace(/^\/+/, "");
  const url = new URL(`/${cfg.bucket}/${key}`, cfg.endpoint);
  const headers = await signV4("PUT", url, data, cfg);
  const res = await fetch(url, { method:"PUT", headers:{ ...headers, "Content-Type":"application/zip", "Content-Length":String(data.byteLength) }, body:data });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`);
}

export async function runScheduledBackup(): Promise<void> {
  try {
    const { filename, data } = await createBackup();
    if (getSetting("backup_local_enabled", "0") === "1") await saveLocal(data, filename);
    if (getSetting("backup_s3_enabled", "0") === "1") await saveS3(data, filename);
    upsertSetting("last_backup_at", new Date().toISOString());
    upsertSetting("last_backup_file", filename);
    upsertSetting("last_backup_status", "ok");
  } catch (e:any) {
    upsertSetting("last_backup_status", `error: ${String(e?.message || e).slice(0,200)}`);
  }
}

function parseZip(data: Uint8Array): ZipEntry[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), sig = 0x06054b50;
  let eocd = -1;
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 66000); i--) if (v.getUint32(i, true) === sig) { eocd = i; break; }
  if (eocd < 0) throw new Error("Invalid ZIP: end record not found");
  const count = v.getUint16(eocd + 10, true), cd = v.getUint32(eocd + 16, true), out: ZipEntry[] = [];
  let p = cd;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Invalid ZIP: central directory corrupt");
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 24, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    if (method !== 0) throw new Error("Unsupported ZIP compression");
    const name = dec.decode(data.slice(p + 46, p + 46 + nlen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error("Invalid ZIP: local header corrupt");
    const ln = v.getUint16(local + 26, true), lx = v.getUint16(local + 28, true), start = local + 30 + ln + lx;
    out.push({ name, data: data.slice(start, start + size) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export async function restoreBackup(zipData: Uint8Array): Promise<void> {
  const entries = parseZip(zipData);
  const manifest = entries.find(e => e.name === "manifest.json");
  if (!manifest) throw new Error("Not a valid Inventra backup (manifest.json missing)");
  const meta = JSON.parse(dec.decode(manifest.data));
  if (meta.version !== 1) throw new Error(`Unsupported backup version: ${meta.version}`);
  const dbEntry = entries.find(e => e.name === "app.db");
  if (!dbEntry) throw new Error("Backup missing app.db");
  const dataDir = process.env.DATA_DIR || "./data";
  await Bun.write(`${dataDir}/app.db.pending`, dbEntry.data);
  const attPending = `${dataDir}/attachments.pending`;
  if (existsSync(attPending)) rmSync(attPending, { recursive:true, force:true });
  mkdirSync(attPending, { recursive:true });
  for (const e of entries.filter(x => x.name.startsWith("attachments/"))) {
    const rel = e.name.slice("attachments/".length);
    if (!cleanRel(rel)) continue;
    const dest = `${attPending}/${rel}`, slash = dest.lastIndexOf("/");
    if (slash > -1) mkdirSync(dest.slice(0, slash), { recursive:true });
    await Bun.write(dest, e.data);
  }
  upsertSetting("restore_pending", "1");
}

export function backupPage(user: User, url: URL): Response {
  const dir = localDir();
  const files = existsSync(dir) ? readdirSync(dir).filter(validBackupName).map(f => ({ f, s: statSync(`${dir}/${f}`).size, t: statSync(`${dir}/${f}`).mtimeMs })).sort((a,b)=>b.t-a.t) : [];
  const g = (k:string, fb="") => getSetting(k, fb);
  const check = (k:string, label:string) => `<label><input type="checkbox" name="${k}" value="1" style="width:auto"${g(k)==="1"?" checked":""}> ${label}</label>`;
  const field = (k:string, label:string, value=g(k), type="text") => `<div><label>${label}</label><input name="${k}" type="${type}" value="${esc(value)}"></div>`;
  const body = `<h1>Backup & Restore</h1>
<div class="card"><h2 style="margin-top:0">Backup status</h2><p>Last backup: ${esc(g("last_backup_at","Never"))} ${g("last_backup_file")?`· ${esc(g("last_backup_file"))}`:""}</p><p>Status: ${esc(g("last_backup_status",""))}</p><form method="post" action="/admin/backup/create" class="inline"><button class="btn">Create backup now</button></form> <a class="btn sec" href="/admin/backup/download">Download latest</a></div>
<div class="card"><h2 style="margin-top:0">Backup destinations</h2><form method="post" action="/admin/backup/settings"><div class="frm"><div>${check("backup_local_enabled","Local filesystem")}</div>${field("backup_local_dir","Directory",dir)}${field("backup_retention","Keep last",g("backup_retention","10"),"number")}<div>${check("backup_s3_enabled","S3-compatible storage")}</div>${field("backup_s3_endpoint","S3 endpoint")}${field("backup_s3_bucket","Bucket")}${field("backup_s3_region","Region",g("backup_s3_region","us-east-1"))}${field("backup_s3_key_id","Access key ID")}<div><label>Secret</label><input name="backup_s3_secret" type="password" placeholder="Leave blank to keep existing"></div>${field("backup_s3_prefix","Prefix",g("backup_s3_prefix","inventra-backups"))}${field("backup_interval_hours","Auto-backup every hours",g("backup_interval_hours","0"),"number")}</div><button class="btn">Save settings</button></form></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>Local backups</th><th>Size</th><th></th></tr>${files.map(x=>`<tr><td>${esc(x.f)}</td><td>${size(x.s)}</td><td><a class="btn sec sm" href="/admin/backup/file/${encodeURIComponent(x.f)}">Download</a> <form class="inline" method="post" action="/admin/backup/file/${encodeURIComponent(x.f)}/delete"><button class="btn danger sm">Delete</button></form></td></tr>`).join("")}</table></div>
<div class="card"><h2 style="margin-top:0">Restore</h2><p class="muted">Restoring will replace all data and restart the server.</p><form method="post" action="/admin/backup/restore" enctype="multipart/form-data"><input type="file" name="backup" accept=".zip,application/zip" required style="margin-bottom:14px"><button class="btn danger">Restore backup</button></form></div>`;
  return layout(user, "Backup", body, "/admin/backup", url.searchParams.get("m") || "");
}

export async function saveSettings(user: User, req: Request): Promise<Response> {
  const f = await req.formData(), val = (k:string) => String(f.get(k) || "");
  const values: Record<string,string> = {
    backup_local_enabled: f.get("backup_local_enabled") === "1" ? "1" : "0",
    backup_local_dir: val("backup_local_dir") || `${process.env.DATA_DIR || "./data"}/backups`,
    backup_retention: String(Math.max(1, Math.min(100, Number(val("backup_retention")) || 10))),
    backup_s3_enabled: f.get("backup_s3_enabled") === "1" ? "1" : "0",
    backup_s3_endpoint: val("backup_s3_endpoint"),
    backup_s3_bucket: val("backup_s3_bucket"),
    backup_s3_region: val("backup_s3_region") || "us-east-1",
    backup_s3_key_id: val("backup_s3_key_id"),
    backup_s3_prefix: val("backup_s3_prefix") || "inventra-backups",
    backup_interval_hours: String(Math.max(0, Math.min(168, Number(val("backup_interval_hours")) || 0))),
  };
  if (val("backup_s3_secret")) values.backup_s3_secret = val("backup_s3_secret");
  for (const [k,v] of Object.entries(values)) upsertSetting(k, v);
  logActivity(user.id, "update", "backup", null, "backup settings");
  return redirect("/admin/backup?m=Settings saved");
}
export async function createNow(user: User): Promise<Response> {
  const { filename, data } = await createBackup();
  await saveLocal(data, filename);
  if (getSetting("backup_s3_enabled", "0") === "1") await saveS3(data, filename);
  upsertSetting("last_backup_at", new Date().toISOString()); upsertSetting("last_backup_file", filename); upsertSetting("last_backup_status", "ok");
  logActivity(user.id, "backup", "system", null, filename);
  return redirect("/admin/backup?m=Backup created");
}
function zipResponse(name: string, data: Uint8Array): Response {
  return new Response(data, { headers:{ "Content-Type":"application/zip", "Content-Disposition":`attachment; filename="${name}"` } });
}
export function downloadLatest(): Response {
  const name = getSetting("last_backup_file", "");
  if (!name) return redirect("/admin/backup?m=No backup available");
  return downloadFile(null as any, name);
}
export function downloadFile(_user: User, name: string): Response {
  if (!validBackupName(name)) return new Response("Invalid backup filename", { status:400 });
  const path = `${localDir()}/${name}`;
  if (!existsSync(path)) return new Response("Backup not found", { status:404 });
  return zipResponse(name, Bun.file(path) as any);
}
export function deleteFile(user: User, name: string): Response {
  if (!validBackupName(name)) return new Response("Invalid backup filename", { status:400 });
  const path = `${localDir()}/${name}`;
  if (existsSync(path)) unlinkSync(path);
  logActivity(user.id, "delete", "backup", null, name);
  return redirect("/admin/backup?m=Backup deleted");
}
export async function restore(user: User, req: Request): Promise<Response> {
  const f = await req.formData(), file = f.get("backup");
  if (!(file instanceof File)) return redirect("/admin/backup?m=Choose a backup file");
  await restoreBackup(new Uint8Array(await file.arrayBuffer()));
  logActivity(user.id, "restore", "backup", null, file.name);
  setTimeout(() => {
    const d = process.env.DATA_DIR || "./data";
    try {
      db.close();
      if (existsSync(`${d}/app.db.pending`)) {
        rmSync(`${d}/app.db-wal`, { force:true });
        rmSync(`${d}/app.db-shm`, { force:true });
        renameSync(`${d}/app.db.pending`, `${d}/app.db`);
      }
      if (existsSync(`${d}/attachments.pending`)) {
        if (existsSync(`${d}/attachments.old`)) rmSync(`${d}/attachments.old`, { recursive:true, force:true });
        if (existsSync(`${d}/attachments`)) renameSync(`${d}/attachments`, `${d}/attachments.old`);
        renameSync(`${d}/attachments.pending`, `${d}/attachments`);
        rmSync(`${d}/attachments.old`, { recursive:true, force:true });
      }
    } finally { process.exit(0); }
  }, 800);
  return layout(user, "Restore queued", "<h1>Restore queued</h1><p>The server will restart in a moment.</p>", "/admin/backup");
}

import { db, logActivity } from "./db";
import type { User } from "./auth";
import { getSetting } from "./settings";
import { esc, layout, redirect } from "./web";

type SmtpConfig = { host:string; port:number; tls:boolean; user:string; pass:string; from:string };
type FlushResult = { sent:number; failed:number };

function enabled():boolean{return getSetting("smtp_enabled","0")==="1";}
function config():SmtpConfig{return {
  host:getSetting("smtp_host",""),port:Number(getSetting("smtp_port","587"))||587,
  tls:getSetting("smtp_tls","0")==="1",user:getSetting("smtp_user",""),pass:getSetting("smtp_pass",""),
  from:getSetting("smtp_from","")
};}
function header(s:string):string{return s.replace(/[\r\n]+/g," ").trim();}
function address(s:string):string{
  const clean=header(s), match=clean.match(/<([^<>]+)>/);
  return (match?.[1]||clean).replace(/[<>]/g,"").trim();
}
function subject(s:string):string{
  const clean=header(s);
  return /[^\x20-\x7e]/.test(clean)?`=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`:clean;
}
function message(c:SmtpConfig,to:string,sub:string,body:string):string{
  const safeBody=body.replace(/\r?\n/g,"\r\n").replace(/(^|\r\n)\./g,"$1..");
  return `Date: ${new Date().toUTCString()}\r\nFrom: ${header(c.from)}\r\nTo: ${header(to)}\r\nSubject: ${subject(sub)}\r\nContent-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${safeBody}\r\n.\r\n`;
}

async function sendMail(c:SmtpConfig,to:string,sub:string,body:string):Promise<void>{
  if(!c.host||!c.from||!to)throw new Error("SMTP host, sender, and recipient are required");
  await new Promise<void>((resolve,reject)=>{
    let settled=false,buffer="",step=0;
    const timer=setTimeout(()=>finish(new Error("SMTP timeout")),15000);
    const finish=(err?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);try{socket?.end();}catch{}err?reject(err):resolve();};
    const write=(s:string)=>socket.write(s);
    const commands=()=>{
      if(step===0){write("EHLO inventra\r\n");step=1;}
      else if(step===1){if(c.user){write("AUTH LOGIN\r\n");step=2;}else{write(`MAIL FROM:<${address(c.from)}>\r\n`);step=5;}}
      else if(step===2){write(`${Buffer.from(c.user).toString("base64")}\r\n`);step=3;}
      else if(step===3){write(`${Buffer.from(c.pass).toString("base64")}\r\n`);step=4;}
      else if(step===4){write(`MAIL FROM:<${address(c.from)}>\r\n`);step=5;}
      else if(step===5){write(`RCPT TO:<${address(to)}>\r\n`);step=6;}
      else if(step===6){write("DATA\r\n");step=7;}
      else if(step===7){write(message(c,to,sub,body));step=8;}
      else if(step===8){write("QUIT\r\n");step=9;}
      else if(step===9)finish();
    };
    let socket:any;
    Bun.connect({
      hostname:c.host,port:c.port,tls:c.tls,
      socket:{
        data(_socket:any,data:Uint8Array){
          buffer+=new TextDecoder().decode(data);
          const lines=buffer.split(/\r?\n/);buffer=lines.pop()||"";
          for(const line of lines){
            const m=line.match(/^(\d{3})([ -])/);if(!m||m[2]==="-")continue;
            const code=Number(m[1]);if(code>=500)return finish(new Error(`SMTP rejected command (${code})`));
            if(code>=400)return finish(new Error(`SMTP temporary failure (${code})`));
            const expected=[220,250,334,334,235,250,250,354,250,221][step];
            if(code===expected)commands();
          }
        },
        error(_socket:any){finish(new Error("SMTP socket error"));},
        close(){if(!settled)finish(new Error("SMTP connection closed"));},
      }
    }).then((s:any)=>{socket=s;}).catch(()=>finish(new Error("SMTP connection failed")));
  });
}

export function queue(to:string,subjectLine:string,body:string):boolean{
  try{
    if(!enabled()||!to)return false;
    db.run("INSERT INTO email_queue(to_address,subject,body) VALUES(?,?,?)",[to,subjectLine,body]);
    return true;
  }catch{return false;}
}
export async function flush(limit=20):Promise<FlushResult>{
  const result={sent:0,failed:0};if(!enabled())return result;
  const c=config(),rows=db.query("SELECT * FROM email_queue WHERE status='pending' ORDER BY id LIMIT ?").all(limit) as any[];
  for(const row of rows){
    try{
      await sendMail(c,row.to_address,row.subject,row.body);
      db.run("UPDATE email_queue SET status='sent',attempts=attempts+1,last_error=NULL,sent_at=datetime('now') WHERE id=?",[row.id]);result.sent++;
    }catch(e:any){
      const attempts=Number(row.attempts)+1;
      db.run("UPDATE email_queue SET attempts=?,last_error=?,status=? WHERE id=?",[attempts,String(e?.message||"SMTP delivery failed").slice(0,500),attempts>=3?"failed":"pending",row.id]);result.failed++;
    }
  }
  return result;
}
export function flushAsync():void{void flush().catch(()=>{});}
function admins():string[]{return (db.query("SELECT email FROM users WHERE role='admin' AND active=1 AND email IS NOT NULL AND email!=''").all() as any[]).map(r=>r.email);}
export function queueAdmins(subjectLine:string,body:string):number{let n=0;for(const email of admins())if(queue(email,subjectLine,body))n++;return n;}
type NotifyPref = "notify_low_stock"|"notify_license_expiry"|"notify_warranty_expiry";
function queueByPref(subjectLine:string,body:string,pref:NotifyPref):number{
  const rows=db.query(`SELECT email FROM users WHERE active=1 AND email IS NOT NULL AND email!='' AND ${pref}=1`).all() as any[];
  let n=0;for(const r of rows)if(queue(r.email,subjectLine,body))n++;return n;
}
function upsertSetting(key:string,value:string):void{
  db.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,value]);
}

export function adminPage(user:User,url:URL):Response{
  const counts=Object.fromEntries((db.query("SELECT status,COUNT(*) n FROM email_queue GROUP BY status").all() as any[]).map(r=>[r.status,r.n]));
  const rows=db.query("SELECT id,to_address,subject,status,attempts,last_error,created_at,sent_at FROM email_queue ORDER BY id DESC LIMIT 50").all() as any[];
  const stats=["pending","sent","failed"].map(k=>`<div class="stat"><div class="n">${counts[k]||0}</div><div class="l">${k}</div></div>`).join("");
  return layout(user,"Email queue",`<h1>Email queue</h1><div class="stats">${stats}</div><div class="toolbar">
<form method="post" action="/admin/email/test"><button class="btn">Send test</button></form>
<form method="post" action="/admin/email/flush"><button class="btn sec">Flush queue</button></form>
<form method="post" action="/notifications/digest"><button class="btn sec">Send digest</button></form>
<form method="post" action="/admin/email/clear"><button class="btn danger">Clear old results</button></form></div>
<div class="card table-wrap" style="padding:0"><table class="sticky-table"><tr><th>To</th><th>Subject</th><th>Status</th><th>Attempts</th><th>Error</th><th>Created</th><th>Sent</th></tr>
${rows.map(r=>`<tr><td>${esc(r.to_address)}</td><td>${esc(r.subject)}</td><td>${esc(r.status)}</td><td>${r.attempts}</td><td>${esc(r.last_error||"")}</td><td>${esc(r.created_at)}</td><td>${esc(r.sent_at||"")}</td></tr>`).join("")}</table></div>`,
  "/admin/email",url.searchParams.get("m")||"");
}
export async function adminFlush(user:User):Promise<Response>{const r=await flush(50);logActivity(user.id,"flush","email_queue",null,`Email queue flushed: ${r.sent} sent, ${r.failed} failed`);return redirect(`/admin/email?m=${encodeURIComponent(`${r.sent} sent, ${r.failed} failed`)}`);}
export async function adminTest(user:User):Promise<Response>{if(!user.email)return redirect("/admin/email?m=Your account has no email address");if(!queue(user.email,"Inventra test email","This is a test email from Inventra."))return redirect("/admin/email?m=SMTP is disabled or the test could not be queued");const r=await flush(1);return redirect(`/admin/email?m=${encodeURIComponent(r.sent?"Test email sent":"Test email failed")}`);}
export function adminClear(user:User):Response{const r=db.run("DELETE FROM email_queue WHERE status IN ('sent','failed') AND created_at < datetime('now','-30 days')");logActivity(user.id,"clear","email_queue",null,`Cleared ${r.changes} old email queue rows`);return redirect(`/admin/email?m=${encodeURIComponent(`${r.changes} old rows cleared`)}`);}

export function notificationCheck(user:User|null=null):Response{
  let lowStockAlerts=0,licenseAlerts=0,warrantyAlerts=0,ackReminders=0;const licenseDays=String(Math.min(365,Math.max(1,Number(getSetting("notify_license_days","30"))||30))),warrantyDays=String(Math.min(365,Math.max(1,Number(getSetting("notify_warranty_days","60"))||60)));
  const low=db.query("SELECT id,name,qty,min_qty FROM consumables WHERE qty<=min_qty AND min_qty>0").all() as any[];
  for(const c of low){const n=queueByPref(`Low stock alert — ${c.name}`,`Consumable "${c.name}" is low.\nCurrent quantity: ${c.qty}\nMinimum quantity: ${c.min_qty}\n\nInventra`,"notify_low_stock");if(n)lowStockAlerts++;}
  if(Number(getSetting("notify_model_stock","1"))){
    const models=db.query(`SELECT m.id,m.name,m.min_qty,COUNT(a.id) cnt FROM models m
      LEFT JOIN assets a ON a.model_id=m.id AND a.status!='archived'
      WHERE m.min_qty>0 GROUP BY m.id HAVING cnt<m.min_qty`).all() as any[];
    for(const m of models){const n=queueByPref(`Low model stock — ${m.name}`,`Model "${m.name}" has ${m.cnt} assets (minimum: ${m.min_qty}).\n\nInventra`,"notify_low_stock");if(n)lowStockAlerts++;}
  }
  const licenses=db.query(`SELECT id,name,expires FROM licenses WHERE expires <= date('now','+'||?||' days') AND expires >= date('now')
    AND (license_notified_at IS NULL OR license_notified_at < date('now','-7 days'))`).all(licenseDays) as any[];
  for(const l of licenses){const n=queueByPref(`License expiry warning — ${l.name}`,`License "${l.name}" expires on ${l.expires}.\n\nInventra`,"notify_license_expiry");if(n){db.run("UPDATE licenses SET license_notified_at=date('now') WHERE id=?",[l.id]);licenseAlerts++;}}
  const assets=db.query(`SELECT id,asset_tag,name,date(purchase_date,'+'||warranty_months||' months') warranty_end FROM assets
    WHERE purchase_date IS NOT NULL AND warranty_months IS NOT NULL AND warranty_months>0
    AND date(purchase_date,'+'||warranty_months||' months') BETWEEN date('now') AND date('now','+'||?||' days')
    AND (warranty_notified_at IS NULL OR warranty_notified_at < date('now','-7 days'))`).all(warrantyDays) as any[];
  for(const a of assets){const n=queueByPref(`Warranty expiry warning — ${a.asset_tag}`,`${a.asset_tag} (${a.name||""}) warranty expires on ${a.warranty_end}.\n\nInventra`,"notify_warranty_expiry");if(n){db.run("UPDATE assets SET warranty_notified_at=date('now') WHERE id=?",[a.id]);warrantyAlerts++;}}
  db.run("UPDATE ack_tokens SET status='expired' WHERE status='pending' AND expires_at < datetime('now')");
  const reminderDays=String(Math.min(365,Math.max(1,Number(getSetting("ack_reminder_days","7"))||7))),base=getSetting("base_url",process.env.BASE_URL||"").replace(/\/+$/,"")||"http://localhost:9000";
  const overdue=db.query(`SELECT a.*,u.email,u.name FROM ack_tokens a JOIN users u ON u.id=a.user_id
    WHERE a.status='pending' AND a.reminder_sent_at IS NULL AND a.expires_at > datetime('now')
    AND a.created_at < datetime('now','-'||?||' days')`).all(reminderDays) as any[];
  for(const row of overdue){if(!row.email)continue;if(queue(row.email,`Reminder: ${row.subject}`,`This acknowledgement is still pending.\n\n${row.message}\n\nAcknowledge: ${base}/ack/${row.token}`)){db.run("UPDATE ack_tokens SET reminder_sent_at=datetime('now') WHERE id=?",[row.id]);ackReminders++;}}
  flushAsync();logActivity(user?.id??null,"check","notification",null,`Notification check run: ${lowStockAlerts} low stock alerts, ${licenseAlerts} license alerts, ${warrantyAlerts} warranty alerts, ${ackReminders} acknowledgement reminders queued`);
  return redirect(`/admin/email?m=${encodeURIComponent(`${lowStockAlerts} low stock alerts, ${licenseAlerts} license alerts, ${warrantyAlerts} warranty alerts, ${ackReminders} acknowledgement reminders queued`)}`);
}

export function digestSend(user:User,url:URL):Response{
  const last=getSetting("last_digest_sent","");
  if(url.searchParams.get("force")!=="1"&&last&&Date.parse(`${last}T00:00:00Z`)>Date.now()-7*86400_000)return redirect("/admin/email?m=Digest already sent this week");
  const pending=(db.query("SELECT COUNT(*) n FROM checkout_requests WHERE status='pending'").get() as any).n;
  const maint=(db.query("SELECT COUNT(*) n FROM maintenance WHERE completed=0 AND start_date<=date('now','+30 days')").get() as any).n;
  const lic=db.query("SELECT COUNT(*) n,GROUP_CONCAT(name,', ') names FROM licenses WHERE expires BETWEEN date('now') AND date('now','+60 days')").get() as any;
  const low=(db.query("SELECT COUNT(*) n FROM consumables WHERE qty<=min_qty AND min_qty>0").get() as any).n;
  const warranty=(db.query(`SELECT COUNT(*) n FROM assets WHERE purchase_date IS NOT NULL AND warranty_months IS NOT NULL
    AND date(purchase_date,'+'||warranty_months||' months') BETWEEN date('now') AND date('now','+90 days')`).get() as any).n;
  const today=new Date().toISOString().slice(0,10);
  const body=`Inventra weekly digest — ${today}

Pending checkout requests: ${pending}
Maintenance due within 30 days: ${maint}
Licenses expiring within 60 days: ${lic.n}${lic.names?` (${lic.names})`:""}
Low-stock consumables: ${low}
Asset warranties expiring within 90 days: ${warranty}

Inventra`;
  const rows=db.query("SELECT email FROM users WHERE active=1 AND email IS NOT NULL AND email!='' AND notify_digest=1").all() as any[];
  let queued=0;for(const r of rows)if(queue(r.email,`[Inventra] Weekly digest — ${today}`,body))queued++;
  upsertSetting("last_digest_sent",today);
  flushAsync();logActivity(user.id,"digest","notification",null,`Weekly digest queued for ${queued} users`);
  return redirect(`/admin/email?m=${encodeURIComponent(`Digest queued for ${queued} users`)}`);
}

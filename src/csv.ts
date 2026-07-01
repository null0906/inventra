import { db,logActivity } from "./db";
import type { User } from "./auth";
import { layout,redirect } from "./web";

export function parseCsv(text:string):string[][]{
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;else if(c===","){row.push(cell.trim());cell="";}else if(c==="\n"){row.push(cell.trim());rows.push(row);row=[];cell="";}else if(c!=="\r")cell+=c;
  }
  if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;
}

export type ImportColumn={header:string;db:string;value:(raw:string)=>any;default:any};
export type ImportConfig={entity:string;path:string;columns:ImportColumn[]};
export const textValue=(x:string)=>x||null;
export const nonnegativeInt=(x:string)=>{const n=Number(x);return Number.isInteger(n)&&n>=0?n:0;};
export const positiveInt=(x:string)=>{const n=Number(x);return Number.isInteger(n)&&n>0?n:1;};
export const numberValue=(x:string)=>{const n=Number(x);return x!==""&&Number.isFinite(n)?n:null;};
const FK_TABLES=new Set(["manufacturers","categories","locations","suppliers"]);
export function namedId(table:string,name:string):number|null{if(!FK_TABLES.has(table))throw new Error(`Unknown table: ${table}`);return name?(db.query(`SELECT id FROM ${table} WHERE name=? COLLATE NOCASE`).get(name) as any)?.id??null:null;}
export function inventoryImportPage(user:User,url:URL,config:ImportConfig):Response{return layout(user,`Import ${config.entity}`,`<h1>Import ${config.entity}</h1><div class="card"><form method="post" action="/${config.path}/import" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv,text/csv" required style="margin-bottom:14px"><button class="btn">Import</button> <a class="btn sec" href="/${config.path}/import/template.csv">Download template</a></form></div>`,`/${config.path}`,url.searchParams.get("m")||"");}
export function inventoryImportTemplate(config:ImportConfig):Response{return new Response(config.columns.map(c=>c.header).join(",")+"\n",{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${config.path}-import-template.csv"`}});}
export async function inventoryImport(user:User,req:Request,config:ImportConfig):Promise<Response>{
  const form=await req.formData(),file=form.get("csv");if(!(file instanceof File))return redirect(`/${config.path}/import?m=Choose a CSV file`);if(file.size>5_242_880)return redirect(`/${config.path}/import?m=CSV exceeds the 5 MB limit`);
  const rows=parseCsv(await file.text());if(!rows.length)return redirect(`/${config.path}/import?m=CSV is empty`);const headers=rows.shift()!.map(h=>h.toLowerCase());if(rows.length>2000)return redirect(`/${config.path}/import?m=CSV exceeds the 2000 row limit`);
  const byHeader=new Map(config.columns.map(c=>[c.header,c])),provided=config.columns.filter(c=>headers.includes(c.header)),unknown=headers.filter(h=>!byHeader.has(h)).length;let created=0,updated=0,errors=0;
  for(const cells of rows){if(cells.every(x=>!x))continue;const raw=Object.fromEntries(headers.map((h,i)=>[h,cells[i]??""])) as Record<string,string>,name=raw.name?.trim();if(!name){errors++;continue;}
    try{db.transaction(()=>{const old=db.query(`SELECT id FROM ${config.path} WHERE name=? COLLATE NOCASE`).get(name) as any;if(old){const cols=provided.filter(c=>c.db!=="name");if(cols.length)db.run(`UPDATE ${config.path} SET ${cols.map(c=>`${c.db}=?`).join(",")} WHERE id=?`,[...cols.map(c=>c.value(raw[c.header]||"")),old.id]);logActivity(user.id,"import",config.entity,old.id,name);updated++;}
      else{const cols=config.columns,vals=cols.map(c=>c.db==="name"?name:headers.includes(c.header)?c.value(raw[c.header]||""):c.default);const r=db.run(`INSERT INTO ${config.path}(${cols.map(c=>c.db).join(",")}) VALUES(${cols.map(()=>"?").join(",")})`,vals);logActivity(user.id,"import",config.entity,Number(r.lastInsertRowid),name);created++;}})();}catch{errors++;}
  }return redirect(`/${config.path}?m=${encodeURIComponent(`Import complete: ${created} created, ${updated} updated, ${errors} errors${unknown?`, ${unknown} unknown columns ignored`:""}`)}`);
}

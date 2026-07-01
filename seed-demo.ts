// Demo data seeder. Run once: DATA_DIR=./data bun run seed-demo.ts
// Idempotent: refuses to run twice against the same database.
import { db, logActivity } from "./src/db";

const already = db.query("SELECT value FROM settings WHERE key='demo_seeded'").get();
if (already) {
  console.log("Demo data already seeded — nothing to do. (Delete the DB to reseed.)");
  process.exit(0);
}

const run = (sql: string, args: any[] = []) => Number(db.run(sql, args).lastInsertRowid);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
const daysAhead = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const hash = Bun.password.hashSync("demo1234", "bcrypt");

db.transaction(() => {
  // ----- settings -----
  for (const [k, v] of [["app_name", "Inventra"], ["asset_tag_prefix", "INV-"], ["items_per_page", "50"]])
    db.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [k, v]);

  // ----- departments -----
  const dept: Record<string, number> = {};
  for (const d of ["Engineering", "Sales", "Finance", "Operations", "IT"])
    dept[d] = run("INSERT INTO departments(name) VALUES(?)", [d]);

  // ----- users (password for all: demo1234) -----
  const U = (name: string, username: string, role: string, d: string) =>
    run("INSERT INTO users(name,username,email,password_hash,role,department_id) VALUES(?,?,?,?,?,?)",
      [name, username, `${username}@demo.local`, hash, role, dept[d]]);
  const uMaya = U("Maya Iyer", "maya", "manager", "IT");
  const uRaj = U("Raj Patel", "raj", "manager", "Operations");
  const uSara = U("Sara Kim", "sara", "viewer", "Engineering");
  const uLeo = U("Leo Fernandes", "leo", "viewer", "Engineering");
  const uNina = U("Nina Rossi", "nina", "viewer", "Sales");
  const uOmar = U("Omar Haddad", "omar", "viewer", "Sales");
  const uPriya = U("Priya Nair", "priya", "viewer", "Finance");
  const uTom = U("Tom Becker", "tom", "viewer", "Operations");
  const uZoe = U("Zoe Chen", "zoe", "viewer", "Engineering");
  const uDan = U("Dan Wright", "dan", "viewer", "IT");
  const staff = [uSara, uLeo, uNina, uOmar, uPriya, uTom, uZoe, uDan];

  // ----- catalog -----
  const cat = (name: string, ctype: string) =>
    run("INSERT INTO categories(name,ctype) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET ctype=excluded.ctype", [name, ctype]);
  const cLaptop = (db.query("SELECT id FROM categories WHERE name='Laptop'").get() as any)?.id ?? cat("Laptop", "asset");
  const cMonitor = (db.query("SELECT id FROM categories WHERE name='Monitor'").get() as any)?.id ?? cat("Monitor", "asset");
  const cPhone = (db.query("SELECT id FROM categories WHERE name='Phone'").get() as any)?.id ?? cat("Phone", "asset");
  const cNet = (db.query("SELECT id FROM categories WHERE name='Networking'").get() as any)?.id ?? cat("Networking", "asset");
  const cPrinter = (db.query("SELECT id FROM categories WHERE name='Printer'").get() as any)?.id ?? cat("Printer", "asset");
  const cSw = (db.query("SELECT id FROM categories WHERE name='Software'").get() as any)?.id ?? cat("Software", "license");
  const cSup = (db.query("SELECT id FROM categories WHERE name='Office Supplies'").get() as any)?.id ?? cat("Office Supplies", "consumable");
  const cPeriph = cat("Peripherals", "accessory");
  const cParts = cat("Spare Parts", "component");

  const man: Record<string, number> = {};
  for (const m of ["Apple", "Dell", "Lenovo", "HP", "Samsung", "Cisco", "Logitech", "Microsoft", "Adobe", "Kingston"])
    man[m] = run("INSERT INTO manufacturers(name) VALUES(?)", [m]);

  const sup: Record<string, number> = {};
  for (const [s, c] of [["TechSource Distribution", "orders@techsource.example"], ["CDW Direct", "sales@cdw.example"], ["Amazon Business", "b2b@amazon.example"], ["LocalFix IT Services", "support@localfix.example"]])
    sup[s] = run("INSERT INTO suppliers(name,contact) VALUES(?,?)", [s, c]);

  const loc: Record<string, number> = {};
  for (const [l, a] of [["HQ — Floor 1", "100 Market Street"], ["HQ — Floor 2", "100 Market Street"], ["Warehouse", "8 Dockside Road"], ["Remote / Home office", ""]])
    loc[l] = run("INSERT INTO locations(name,address) VALUES(?,?)", [l, a]);

  // ----- depreciation profiles -----
  const dLaptop = run("INSERT INTO depreciation(name,months,floor_value) VALUES(?,?,?)", ["Laptops — 36 months", 36, 100]);
  const dPhone = run("INSERT INTO depreciation(name,months,floor_value) VALUES(?,?,?)", ["Phones — 24 months", 24, 50]);
  const dInfra = run("INSERT INTO depreciation(name,months,floor_value) VALUES(?,?,?)", ["Infrastructure — 60 months", 60, 0]);

  // ----- models -----
  const M = (name: string, no: string, m: number, c: number, eol: number, dep: number | null) =>
    run("INSERT INTO models(name,model_no,manufacturer_id,category_id,eol_months,depreciation_id) VALUES(?,?,?,?,?,?)", [name, no, m, c, eol, dep]);
  const mMbp = M('MacBook Pro 14"', "A2918", man.Apple, cLaptop, 48, dLaptop);
  const mLat = M("Latitude 5440", "L5440", man.Dell, cLaptop, 36, dLaptop);
  const mX1 = M("ThinkPad X1 Carbon G11", "21HM", man.Lenovo, cLaptop, 36, dLaptop);
  const mElite = M("EliteBook 840 G10", "840G10", man.HP, cLaptop, 36, dLaptop);
  const mIph = M("iPhone 15", "A3090", man.Apple, cPhone, 24, dPhone);
  const mS24 = M("Galaxy S24", "SM-S921", man.Samsung, cPhone, 24, dPhone);
  const mU27 = M("UltraSharp U2723QE", "U2723QE", man.Dell, cMonitor, 60, dInfra);
  const mSw = M("Catalyst 9300 Switch", "C9300-24T", man.Cisco, cNet, 84, dInfra);
  const mLj = M("LaserJet Pro 4002dn", "4002dn", man.HP, cPrinter, 60, dInfra);

  // ----- assets -----
  let tag = 0;
  const A = (name: string, model: number, status: string, assigned: number | null, l: number, cost: number, boughtDaysAgo: number, warranty = 36) => {
    tag++;
    const id = run(
      `INSERT INTO assets(asset_tag,serial,name,model_id,status,assigned_to,location_id,supplier_id,purchase_date,purchase_cost,warranty_months,order_number,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-${boughtDaysAgo} days'))`,
      [`INV-${String(tag).padStart(4, "0")}`, `SN${String(100000 + tag * 7919).slice(0, 6)}`, name, model, status, assigned, l,
       sup["TechSource Distribution"], daysAgo(boughtDaysAgo), cost, warranty, `PO-2024-${1000 + tag}`]
    );
    return id;
  };
  const laptops = [
    A("Maya's MacBook", mMbp, "deployed", uMaya, loc["HQ — Floor 2"], 2399, 400),
    A("Raj's MacBook", mMbp, "deployed", uRaj, loc["HQ — Floor 1"], 2399, 380),
    A("Sara's ThinkPad", mX1, "deployed", uSara, loc["Remote / Home office"], 1849, 300),
    A("Leo's Latitude", mLat, "deployed", uLeo, loc["HQ — Floor 2"], 1299, 520),
    A("Nina's EliteBook", mElite, "deployed", uNina, loc["HQ — Floor 1"], 1399, 250),
    A("Omar's Latitude", mLat, "deployed", uOmar, loc["HQ — Floor 1"], 1299, 600),
    A("Priya's ThinkPad", mX1, "deployed", uPriya, loc["HQ — Floor 1"], 1849, 200),
    A("Zoe's MacBook", mMbp, "deployed", uZoe, loc["Remote / Home office"], 2599, 150),
    A("Spare laptop 1", mLat, "deployable", null, loc.Warehouse, 1299, 700),
    A("Spare laptop 2", mElite, "deployable", null, loc.Warehouse, 1399, 90),
    A("Loaner MacBook", mMbp, "deployable", null, loc["HQ — Floor 1"], 2399, 800),
    A("Tom's old Latitude", mLat, "maintenance", null, loc.Warehouse, 1199, 1100, 36),
    A("Retired ThinkPad", mX1, "archived", null, loc.Warehouse, 1649, 1500, 36),
  ];
  const phones = [
    A("Maya's iPhone", mIph, "deployed", uMaya, loc["HQ — Floor 2"], 999, 350, 24),
    A("Nina's Galaxy", mS24, "deployed", uNina, loc["HQ — Floor 1"], 899, 280, 24),
    A("Omar's iPhone", mIph, "deployed", uOmar, loc["HQ — Floor 1"], 999, 410, 24),
    A("Spare iPhone", mIph, "deployable", null, loc.Warehouse, 999, 60, 24),
  ];
  const office = [
    A("Monitor — desk 21", mU27, "deployed", uSara, loc["HQ — Floor 2"], 649, 500, 36),
    A("Monitor — desk 22", mU27, "deployed", uLeo, loc["HQ — Floor 2"], 649, 500, 36),
    A("Monitor — spare", mU27, "deployable", null, loc.Warehouse, 649, 500, 36),
    A("Core switch — Floor 1", mSw, "deployed", uDan, loc["HQ — Floor 1"], 4850, 900, 60),
    A("Printer — Floor 1", mLj, "deployed", uDan, loc["HQ — Floor 1"], 429, 650, 36),
    A("Printer — Floor 2", mLj, "maintenance", null, loc["HQ — Floor 2"], 429, 640, 36),
  ];
  const aTomOld = laptops[11], aPrinter2 = office[5], aSpare1 = laptops[8];

  // ----- maintenance -----
  const MT = (asset: number, type: string, title: string, supplier: number, cost: number | null, start: number, doneDaysAgo: number | null, by: number) =>
    run(`INSERT INTO maintenance(asset_id,type,title,supplier_id,cost,notes,start_date,completion_date,completed,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [asset, type, title, supplier, cost, "", daysAgo(start), doneDaysAgo === null ? null : daysAgo(doneDaysAgo), doneDaysAgo === null ? 0 : 1, by]);
  MT(aTomOld, "repair", "Cracked screen replacement", sup["LocalFix IT Services"], 240, 6, null, uMaya);
  MT(aPrinter2, "hardware_support", "Paper feed jam — awaiting part", sup["LocalFix IT Services"], 85, 3, null, uRaj);
  MT(laptops[3], "upgrade", "RAM upgrade 16→32 GB", sup["TechSource Distribution"], 145, 40, 38, uMaya);
  MT(office[3], "preventive", "Firmware update + config backup", sup["LocalFix IT Services"], null, 20, 20, uDan);
  MT(phones[0], "test", "Battery health check", sup["LocalFix IT Services"], null, 90, 89, uMaya);

  // ----- licenses + seats -----
  const L = (name: string, key: string, seats: number, m: number, cost: number, bought: number, expiresIn: number | null) =>
    run("INSERT INTO licenses(name,product_key,seats,manufacturer_id,category_id,purchase_date,purchase_cost,expires) VALUES(?,?,?,?,?,?,?,?)",
      [name, key, seats, m, cSw, daysAgo(bought), cost, expiresIn === null ? null : daysAhead(expiresIn)]);
  const lM365 = L("Microsoft 365 Business", "M365-DEMO-4F2K-91XQ", 15, man.Microsoft, 1870, 320, 45);
  const lAdobe = L("Adobe Creative Cloud", "ACC-DEMO-77TR-PL09", 5, man.Adobe, 2995, 200, 165);
  const lJet = L("JetBrains All Products", "JB-DEMO-MN54-22AA", 4, man.Microsoft, 1156, 150, 215);
  const lAv = L("Endpoint Antivirus", "AV-DEMO-PQ88-ZZ31", 20, man.Microsoft, 980, 340, 25);
  const seat = (lic: number, user: number | null, asset: number | null) =>
    run("INSERT INTO license_seats(license_id,user_id,asset_id) VALUES(?,?,?)", [lic, user, asset]);
  for (const u of [uMaya, uRaj, uSara, uLeo, uNina, uOmar, uPriya, uTom, uZoe, uDan]) seat(lM365, u, null);
  for (const u of [uSara, uZoe, uLeo]) seat(lAdobe, u, null);
  for (const u of [uSara, uLeo, uZoe, uDan]) seat(lJet, u, null); // full
  for (const a of laptops.slice(0, 8)) seat(lAv, null, a);

  // ----- accessories + checkouts -----
  const X = (name: string, qty: number, min: number, cost: number) =>
    run("INSERT INTO accessories(name,category_id,manufacturer_id,supplier_id,location_id,qty,min_qty,cost) VALUES(?,?,?,?,?,?,?,?)",
      [name, cPeriph, man.Logitech, sup["Amazon Business"], loc.Warehouse, qty, min, cost]);
  const xKb = X("MX Keys keyboard", 12, 3, 99);
  const xMouse = X("MX Master 3S mouse", 12, 3, 89);
  const xDock = X("Thunderbolt dock", 6, 2, 249);
  const xHead = X("Zone Vibe headset", 4, 2, 79);
  const co = (acc: number, user: number) => run("INSERT INTO accessory_checkouts(accessory_id,user_id,note) VALUES(?,?,?)", [acc, user, "onboarding kit"]);
  for (const u of [uSara, uLeo, uNina, uOmar, uPriya]) { co(xKb, u); co(xMouse, u); }
  for (const u of [uSara, uZoe]) co(xDock, u);
  for (const u of [uMaya, uRaj, uNina, uOmar]) co(xHead, u); // fully checked out

  // ----- components + installs -----
  const P = (name: string, qty: number, min: number, cost: number, serial: string) =>
    run("INSERT INTO components(name,category_id,qty,min_qty,location_id,cost,serial) VALUES(?,?,?,?,?,?,?)",
      [name, cParts, qty, min, loc.Warehouse, cost, serial]);
  const pRam = P("Kingston 16GB DDR5 SODIMM", 20, 5, 62, "KF548S38");
  const pSsd = P("Samsung 990 Pro 1TB NVMe", 10, 3, 119, "MZ-V9P1T0");
  const inst = (comp: number, asset: number, qty: number) =>
    run("INSERT INTO component_assets(component_id,asset_id,qty) VALUES(?,?,?)", [comp, asset, qty]);
  inst(pRam, laptops[3], 2); inst(pRam, laptops[5], 2); inst(pSsd, laptops[3], 1); inst(pSsd, aSpare1, 1);

  // ----- consumables -----
  const K = (name: string, qty: number, min: number, cost: number) =>
    run("INSERT INTO consumables(name,category_id,location_id,qty,min_qty,cost) VALUES(?,?,?,?,?,?)", [name, cSup, loc.Warehouse, qty, min, cost]);
  K("HP 58A toner cartridge", 2, 3, 86);      // low
  K("A4 paper (500-sheet ream)", 48, 10, 6);
  K("USB-C cable 2m", 4, 5, 12);              // low
  K("AA batteries (pack of 10)", 22, 8, 9);
  K("HDMI cable", 9, 4, 11);

  // ----- custom fields -----
  const fMac = run("INSERT INTO custom_fields(label,field_key,field_type,required) VALUES(?,?,?,?)", ["MAC address", "mac_address", "text", 0]);
  const fEnc = run("INSERT INTO custom_fields(label,field_key,field_type,select_options,required) VALUES(?,?,?,?,?)", ["Disk encryption", "disk_encryption", "select", "FileVault,BitLocker,None", 1]);
  const fOs = run("INSERT INTO custom_fields(label,field_key,field_type,required) VALUES(?,?,?,?)", ["OS version", "os_version", "text", 0]);
  for (const m of [mMbp, mLat, mX1, mElite]) {
    let i = 0;
    for (const f of [fMac, fEnc, fOs]) run("INSERT INTO model_fields(model_id,field_id,sort_order) VALUES(?,?,?)", [m, f, i++]);
  }
  const cv = (asset: number, field: number, val: string) =>
    run("INSERT INTO asset_custom_values(asset_id,field_id,value) VALUES(?,?,?)", [asset, field, val]);
  cv(laptops[0], fMac, "3C:A6:F6:1B:22:01"); cv(laptops[0], fEnc, "FileVault"); cv(laptops[0], fOs, "macOS 15.2");
  cv(laptops[3], fMac, "8C:EC:4B:99:10:7D"); cv(laptops[3], fEnc, "BitLocker"); cv(laptops[3], fOs, "Windows 11 23H2");
  cv(laptops[2], fEnc, "BitLocker"); cv(laptops[2], fOs, "Windows 11 24H2");

  // ----- backdated activity history (makes dashboard + audit log look alive) -----
  const act = (d: number, actor: number, action: string, etype: string, eid: number, detail: string) =>
    run(`INSERT INTO activity(actor_id,action,entity_type,entity_id,detail,at) VALUES(?,?,?,?,?,datetime('now','-${d} days','+${(d * 37) % 9} hours'))`,
      [actor, action, etype, eid, detail]);
  act(29, 1, "create", "asset", laptops[8], "INV-0009");
  act(27, uMaya, "checkout", "asset", laptops[3], "to Leo Fernandes — new starter");
  act(25, uMaya, "checkout", "accessory", xKb, "to Leo Fernandes");
  act(21, uRaj, "checkin", "asset", aTomOld, "from Tom Becker");
  act(20, uMaya, "update", "asset", aTomOld, "status → maintenance");
  act(18, uMaya, "create", "maintenance", 1, "Cracked screen replacement");
  act(15, uDan, "install", "component", pRam, "2 into INV-0004");
  act(12, uMaya, "checkout", "license", lAdobe, "seat assigned to Zoe Chen");
  act(9, uRaj, "restock", "consumable", 2, "A4 paper: +20 → 48");
  act(7, uMaya, "checkout", "asset", phones[3], "loaner for conference, returned");
  act(7, uMaya, "checkin", "asset", phones[3], "from Nina Rossi");
  act(4, uRaj, "consume", "consumable", 1, "HP 58A toner: -1 → 2");
  act(2, uMaya, "create", "maintenance", 2, "Paper feed jam — awaiting part");
  act(1, uDan, "update", "settings", 0, "application settings");
  logActivity(1, "create", "settings", null, "demo dataset loaded");

  // ----- email queue samples -----
  run("INSERT INTO email_queue(to_address,subject,body,status,attempts,sent_at) VALUES(?,?,?,?,?,datetime('now','-2 days'))",
    ["maya@demo.local", "License expiring: Endpoint Antivirus", "Endpoint Antivirus expires in 27 days (20 seats).", "sent", 1]);
  run("INSERT INTO email_queue(to_address,subject,body,status,attempts) VALUES(?,?,?,?,?)",
    ["maya@demo.local", "Low stock: HP 58A toner cartridge", "Stock is 2 (minimum 3).", "pending", 0]);

  db.run("INSERT INTO settings(key,value) VALUES('demo_seeded','1')");
})();

const c = (t: string) => (db.query(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
console.log(`Demo data loaded:
  users: ${c("users")} (passwords: demo1234, admin unchanged)
  departments: ${c("departments")}  models: ${c("models")}  assets: ${c("assets")}
  licenses: ${c("licenses")} (${c("license_seats")} seats)  accessories: ${c("accessories")} (${c("accessory_checkouts")} checked out)
  components: ${c("components")}  consumables: ${c("consumables")}  maintenance: ${c("maintenance")}
  custom fields: ${c("custom_fields")}  activity rows: ${c("activity")}  emails: ${c("email_queue")}`);

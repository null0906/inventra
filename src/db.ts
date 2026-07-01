import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";

const dataDir = process.env.DATA_DIR || "./data";
mkdirSync(dataDir, { recursive: true });
export const attachmentDir = `${dataDir}/attachments`;
const pendingDb = `${dataDir}/app.db.pending`;
const pendingAtt = `${dataDir}/attachments.pending`;
if (existsSync(pendingDb)) {
  rmSync(`${dataDir}/app.db-wal`, { force: true });
  rmSync(`${dataDir}/app.db-shm`, { force: true });
  renameSync(pendingDb, `${dataDir}/app.db`);
}
if (existsSync(pendingAtt)) {
  if (existsSync(`${dataDir}/attachments.old`)) rmSync(`${dataDir}/attachments.old`, { recursive: true, force: true });
  if (existsSync(attachmentDir)) renameSync(attachmentDir, `${dataDir}/attachments.old`);
  renameSync(pendingAtt, attachmentDir);
  rmSync(`${dataDir}/attachments.old`, { recursive: true, force: true });
}
mkdirSync(attachmentDir, { recursive: true });

export const db = new Database(`${dataDir}/app.db`, { create: true });
try {
  db.exec("PRAGMA journal_mode = WAL;");
} catch {
  db.exec("PRAGMA journal_mode = DELETE;"); // filesystems without WAL support
}
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  csrf_token TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  ctype TEXT NOT NULL DEFAULT 'asset'
);
CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact TEXT
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  model_no TEXT,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  eol_months INTEGER
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  serial TEXT,
  name TEXT,
  model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'deployable',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date TEXT,
  purchase_cost REAL,
  warranty_months INTEGER,
  order_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  product_key TEXT,
  seats INTEGER NOT NULL DEFAULT 1,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  purchase_date TEXT,
  purchase_cost REAL,
  expires TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS license_seats (
  id INTEGER PRIMARY KEY,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consumables (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  cost REAL
);
CREATE TABLE IF NOT EXISTS consumable_checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1 CHECK(qty > 0),
  note TEXT,
  checked_out_at TEXT NOT NULL DEFAULT (datetime('now')),
  checked_in_at TEXT,
  checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS accessories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS accessory_checkouts (
  id INTEGER PRIMARY KEY,
  accessory_id INTEGER NOT NULL REFERENCES accessories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  cost REAL,
  serial TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS component_assets (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(component_id, asset_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(role_id, permission)
);
CREATE TABLE IF NOT EXISTS status_labels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('deployable','undeployable','archived')),
  color TEXT NOT NULL DEFAULT '#6c757d',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  months INTEGER NOT NULL CHECK(months > 0),
  floor_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'repair','upgrade','preventive','test',
    'pat_test','software_support','hardware_support','other'
  )),
  title TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  cost REAL,
  notes TEXT,
  start_date TEXT NOT NULL,
  completion_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  field_key TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL DEFAULT 'text',
  select_options TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS model_fields (
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (model_id, field_id)
);
CREATE TABLE IF NOT EXISTS asset_custom_values (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (asset_id, field_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('asset','license')),
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  orig_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checkout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('asset','accessory')),
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','denied')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handler_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  notes TEXT,
  UNIQUE(session_id, asset_id)
);
CREATE TABLE IF NOT EXISTS ack_tokens (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK(action_type IN ('asset_checkout','manual','policy','offboard')),
  entity_type TEXT,
  entity_id INTEGER,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','expired')),
  reminder_sent_at TEXT,
  acknowledged_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+30 days'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_accessory_checkouts_accessory ON accessory_checkouts(accessory_id);
CREATE INDEX IF NOT EXISTS idx_component_assets_component ON component_assets(component_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance(asset_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id, id);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_con_checkouts_consumable ON consumable_checkouts(consumable_id);
CREATE INDEX IF NOT EXISTS idx_con_checkouts_user ON consumable_checkouts(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_status ON checkout_requests(status, entity_type);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_user ON checkout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_location ON audit_sessions(location_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_session ON audit_items(session_id);
CREATE INDEX IF NOT EXISTS idx_ack_tokens_user ON ack_tokens(user_id, status);
`);

function addColumn(sql: string): void {
  try { db.exec(sql); } catch {}
}
addColumn("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
addColumn("ALTER TABLE assets ADD COLUMN purchase_date TEXT");
addColumn("ALTER TABLE assets ADD COLUMN purchase_cost REAL");
addColumn("ALTER TABLE assets ADD COLUMN warranty_months INTEGER");
addColumn("ALTER TABLE assets ADD COLUMN order_number TEXT");
addColumn("ALTER TABLE assets ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)");
addColumn("ALTER TABLE models ADD COLUMN depreciation_id INTEGER REFERENCES depreciation(id)");
addColumn("ALTER TABLE models ADD COLUMN image_url TEXT");
addColumn("ALTER TABLE models ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE assets ADD COLUMN status_label_id INTEGER REFERENCES status_labels(id) ON DELETE SET NULL");
addColumn("ALTER TABLE licenses ADD COLUMN last_notified_at TEXT");
addColumn("ALTER TABLE assets ADD COLUMN warranty_notified_at TEXT");
addColumn("ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL");
addColumn("ALTER TABLE licenses ADD COLUMN license_notified_at TEXT");
addColumn("ALTER TABLE assets ADD COLUMN checkout_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL");
addColumn("ALTER TABLE assets ADD COLUMN photo_url TEXT");
addColumn("ALTER TABLE assets ADD COLUMN ip_address TEXT");
addColumn("ALTER TABLE assets ADD COLUMN mac_address TEXT");
addColumn("ALTER TABLE accessory_checkouts ADD COLUMN checked_in_at TEXT");
addColumn("ALTER TABLE accessory_checkouts ADD COLUMN checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
addColumn("ALTER TABLE users ADD COLUMN notify_low_stock INTEGER NOT NULL DEFAULT 1");
addColumn("ALTER TABLE users ADD COLUMN notify_license_expiry INTEGER NOT NULL DEFAULT 1");
addColumn("ALTER TABLE users ADD COLUMN notify_warranty_expiry INTEGER NOT NULL DEFAULT 1");
addColumn("ALTER TABLE users ADD COLUMN notify_digest INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL");
addColumn("ALTER TABLE roles ADD COLUMN role_key TEXT");
addColumn("ALTER TABLE roles ADD COLUMN system INTEGER NOT NULL DEFAULT 0");

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_role_key ON roles(role_key) WHERE role_key IS NOT NULL");

db.run("INSERT OR IGNORE INTO status_labels(name,type,color) VALUES('Ready to Deploy','deployable','#198754')");
db.run("INSERT OR IGNORE INTO status_labels(name,type,color) VALUES('Broken / Undeployable','undeployable','#dc3545')");
db.run("INSERT OR IGNORE INTO status_labels(name,type,color) VALUES('Archived','archived','#6c757d')");

const userCount = (db.query("SELECT COUNT(*) AS n FROM users").get() as any).n;
if (userCount === 0) {
  const hash = Bun.password.hashSync(process.env.ADMIN_PASSWORD || "admin123", "bcrypt");
  db.run(
    "INSERT INTO users (name, username, email, password_hash, role) VALUES (?,?,?,?,?)",
    ["Administrator", "admin", "admin@example.com", hash, "admin"]
  );
  for (const c of ["Laptop", "Desktop", "Monitor", "Phone", "Printer", "Networking"])
    db.run("INSERT INTO categories (name, ctype) VALUES (?, 'asset')", [c]);
  db.run("INSERT INTO categories (name, ctype) VALUES ('Software', 'license')");
  db.run("INSERT INTO categories (name, ctype) VALUES ('Office Supplies', 'consumable')");
  console.log("Seeded default admin user (admin). Change the password immediately.");
}

export function logActivity(
  actorId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  detail = ""
) {
  db.run(
    "INSERT INTO activity (actor_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)",
    [actorId, action, entityType, entityId, detail]
  );
}

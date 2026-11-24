-- Plan de inversión: bloques con peso objetivo y a qué bloque pertenece cada activo.
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_pct REAL NOT NULL,
  color INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
ALTER TABLE assets ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN plan_excluded INTEGER NOT NULL DEFAULT 0;

-- Inmuebles. El cuadro de amortización no se guarda: se deriva de la hipoteca y sus eventos.
CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_costs REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE mortgages (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lender TEXT NOT NULL DEFAULT '',
  principal REAL NOT NULL,
  rate_type TEXT NOT NULL,
  rate_pct REAL NOT NULL,
  term_months INTEGER NOT NULL,
  first_payment_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mortgages_property ON mortgages(property_id);
CREATE TABLE mortgage_events (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL,
  mode TEXT,
  rate_pct REAL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE property_valuations (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

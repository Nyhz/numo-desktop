CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  currency TEXT NOT NULL,
  color INTEGER NOT NULL,
  track_cash INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT,
  isin TEXT,
  currency TEXT NOT NULL,
  price_source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE txs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  asset_id TEXT REFERENCES assets(id),
  quantity REAL,
  price REAL,
  amount REAL,
  currency TEXT NOT NULL,
  fx_rate REAL NOT NULL DEFAULT 1,
  fee REAL NOT NULL DEFAULT 0,
  fee_currency TEXT NOT NULL,
  tax_source REAL NOT NULL DEFAULT 0,
  tax_home REAL NOT NULL DEFAULT 0,
  to_account_id TEXT REFERENCES accounts(id),
  to_asset_id TEXT REFERENCES assets(id),
  to_quantity REAL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX txs_date ON txs(date);
CREATE TABLE prices (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  PRIMARY KEY (asset_id, date)
) WITHOUT ROWID;
CREATE TABLE fx (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
CREATE TABLE splits (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ratio REAL NOT NULL,
  PRIMARY KEY (asset_id, date)
) WITHOUT ROWID;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

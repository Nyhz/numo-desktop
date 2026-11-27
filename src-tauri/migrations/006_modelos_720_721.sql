-- Modelos 720 y 721: el país de la entidad de cada cuenta decide si lo que hay
-- en ella se declara. Las cuentas que ya existen se dan por españolas; el usuario
-- cambia las que no lo son. Vacío = sin entidad (un monedero propio).
ALTER TABLE accounts ADD COLUMN country TEXT NOT NULL DEFAULT 'ES';

-- Declaraciones que el usuario confirma haber presentado. `blocks` e `items`
-- son JSON: el valor de cada bloque presentado y lo que se declaró.
CREATE TABLE foreign_filings (
  id         TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  year       INTEGER NOT NULL,
  blocks     TEXT NOT NULL DEFAULT '{}',
  items      TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

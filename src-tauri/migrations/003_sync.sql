-- Sincronización entre equipos: cuándo cambió por última vez cada registro del
-- usuario y cuáles se han borrado. Con esto, al comparar con otro equipo, gana
-- el cambio más reciente de cada registro.
CREATE TABLE sync_stamps (
  entity  TEXT NOT NULL,
  id      TEXT NOT NULL,
  at      TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, id)
) WITHOUT ROWID;

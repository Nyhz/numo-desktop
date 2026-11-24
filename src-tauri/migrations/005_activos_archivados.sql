-- Activos archivados: los que ya no se tienen ni se quieren seguir. Conservan sus
-- operaciones y sus precios, pero salen de la lista y dejan de actualizarse.
ALTER TABLE assets ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

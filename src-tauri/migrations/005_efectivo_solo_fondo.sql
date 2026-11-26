-- Solo el fondo de emergencia lleva efectivo. Bróker, cripto, plan de pensiones y
-- «otra» siguen inversiones: sus compras y ventas no mueven saldo.
UPDATE accounts SET track_cash = CASE WHEN kind = 'emergency' THEN 1 ELSE 0 END;

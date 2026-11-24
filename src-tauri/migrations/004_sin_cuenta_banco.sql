-- El tipo de cuenta «banco» desaparece: el dinero del banco que se registra aquí
-- es el fondo de emergencia. Una cuenta de banco sin inversiones pasa a serlo
-- (y lleva siempre su saldo); si tenía inversiones, pasa a ser un bróker, que
-- es como se comporta.
UPDATE accounts
   SET kind = 'emergency', track_cash = 1
 WHERE kind = 'bank'
   AND NOT EXISTS (
     SELECT 1 FROM txs t
      WHERE (t.account_id = accounts.id OR t.to_account_id = accounts.id)
        AND (t.asset_id IS NOT NULL OR t.to_asset_id IS NOT NULL)
   );
UPDATE accounts SET kind = 'broker' WHERE kind = 'bank';

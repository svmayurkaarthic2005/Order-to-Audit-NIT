-- The stock ledger and the activity log are append-only: rows are added,
-- never changed. Corrections are new rows (reversals, credit notes), so the
-- history an auditor reads is always what actually happened.
--
-- UPDATE and DELETE are both refused, unless the database has been
-- explicitly opted in to test cleanup with
--   ALTER DATABASE <name> SET app.allow_ledger_cleanup = 'on';
-- which only throwaway development and CI databases do: the test suite
-- removes the rows it created, and deleting a batch makes Postgres blank the
-- batch link on its movements (an UPDATE). Production databases never set it.
CREATE OR REPLACE FUNCTION refuse_ledger_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_ledger_cleanup', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_append_only
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

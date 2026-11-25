-- Pin the trigger function's search_path so it can't be redirected by
-- objects someone creates in another schema (Supabase security advisor:
-- function_search_path_mutable). It only uses built-ins from pg_catalog.
ALTER FUNCTION refuse_ledger_change() SET search_path = '';

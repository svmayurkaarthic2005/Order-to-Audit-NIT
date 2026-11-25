-- Supabase publishes every table in "public" through its REST API, reachable
-- with the public (publishable) key. The app never uses that API: it
-- connects directly as the table owner, which RLS does not restrict. Turning
-- RLS on with no policies therefore closes the REST API to every table
-- without changing anything for the app. On plain Postgres this is harmless.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Enable Row Level Security (RLS) on public tables exposed to PostgREST
-- These tables already have RLS policies; RLS was not enabled, causing Supabase advisor alerts.
-- Kruno uses Clerk for auth; policies are permissive and authorization is enforced in the application layer.

-- Enable RLS on each table (idempotent: safe to run if already enabled)
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_itineraries ENABLE ROW LEVEL SECURITY;

-- Document smart_itineraries RLS policies if they exist (same strategy as other tables)
DO $$
BEGIN
  EXECUTE 'COMMENT ON POLICY "smart_itineraries_insert" ON public.smart_itineraries IS ''Intentionally permissive. Kruno uses Clerk; authorization enforced in app layer via requireTripAccess()/requireTripOwner().''';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'COMMENT ON POLICY "smart_itineraries_select" ON public.smart_itineraries IS ''Intentionally permissive. Kruno uses Clerk; authorization enforced in app layer via requireTripAccess().''';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'COMMENT ON POLICY "smart_itineraries_update" ON public.smart_itineraries IS ''Intentionally permissive. Kruno uses Clerk; authorization enforced in app layer via requireTripAccess()/requireTripOwner().''';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

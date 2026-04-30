REVOKE ALL ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_raw_reservations_batch(jsonb) TO service_role;
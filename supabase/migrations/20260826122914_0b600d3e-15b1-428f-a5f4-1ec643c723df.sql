REVOKE EXECUTE ON FUNCTION public.process_reservations(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservations(uuid, uuid, text) TO service_role;
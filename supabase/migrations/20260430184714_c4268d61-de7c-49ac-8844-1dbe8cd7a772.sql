REVOKE EXECUTE ON FUNCTION public.get_current_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role_in_tenant(uuid, public.app_role, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_reservations(uuid, uuid) FROM anon;
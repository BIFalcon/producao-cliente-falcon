REVOKE ALL ON FUNCTION public.get_current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role_in_tenant(uuid, public.app_role, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_raw_reservations_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_reservations(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_current_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role_in_tenant(uuid, public.app_role, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_raw_reservations_batch(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_reservations(uuid, uuid) TO authenticated, service_role;
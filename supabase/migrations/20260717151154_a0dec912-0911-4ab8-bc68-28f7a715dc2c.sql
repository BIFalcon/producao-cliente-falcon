
-- 1. Restrict raw_reservations SELECT to editor/master_admin roles
DROP POLICY IF EXISTS "Read raw_reservations within tenant" ON public.raw_reservations;
CREATE POLICY "Read raw_reservations within tenant"
ON public.raw_reservations FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_current_tenant_id()
  AND (
    public.has_role_in_tenant(auth.uid(), 'master_admin'::app_role, tenant_id)
    OR public.has_role_in_tenant(auth.uid(), 'editor'::app_role, tenant_id)
  )
);

-- 2. Prevent master_admins from creating/updating super_admin role rows
DROP POLICY IF EXISTS "Master admins manage roles in tenant" ON public.user_roles;
CREATE POLICY "Master admins manage roles in tenant"
ON public.user_roles FOR ALL
TO authenticated
USING (
  tenant_id = public.get_current_tenant_id()
  AND public.has_role_in_tenant(auth.uid(), 'master_admin'::app_role, tenant_id)
  AND role <> 'super_admin'::app_role
)
WITH CHECK (
  tenant_id = public.get_current_tenant_id()
  AND public.has_role_in_tenant(auth.uid(), 'master_admin'::app_role, tenant_id)
  AND role <> 'super_admin'::app_role
);

-- 3. Fix mutable search_path on get_allowed_properties
ALTER FUNCTION public.get_allowed_properties(uuid, uuid) SET search_path = public;

-- 4. Revoke default PUBLIC execute on SECURITY DEFINER functions;
--    grant execute only to authenticated (frontend RPC callers).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END$$;

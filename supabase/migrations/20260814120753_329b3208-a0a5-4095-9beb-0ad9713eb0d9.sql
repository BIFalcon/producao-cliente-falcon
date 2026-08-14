-- Restrict CRM account visibility by hotel permissions for non-admin users
DROP POLICY IF EXISTS "crm_accounts read same tenant or super_admin" ON public.crm_accounts;
CREATE POLICY "crm_accounts read same tenant or hotel scoped"
ON public.crm_accounts
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.get_allowed_properties(auth.uid(), tenant_id) IS NULL
      OR properties && public.get_allowed_properties(auth.uid(), tenant_id)
    )
  )
);

DROP POLICY IF EXISTS "crm_visits read same tenant or super_admin" ON public.crm_visits;
CREATE POLICY "crm_visits read same tenant or hotel scoped"
ON public.crm_visits
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.crm_accounts a
      WHERE a.id = crm_visits.account_id
        AND (
          public.get_allowed_properties(auth.uid(), a.tenant_id) IS NULL
          OR a.properties && public.get_allowed_properties(auth.uid(), a.tenant_id)
        )
    )
  )
);

-- Users of a tenant with their hotel permissions (for the commercial executive filter)
CREATE OR REPLACE FUNCTION public.get_tenant_users_with_hotels(p_tenant_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, hotels text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.user_id,
    p.full_name,
    (SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = p.user_id AND (ur.tenant_id = p_tenant_id OR ur.tenant_id IS NULL)
      ORDER BY ur.role LIMIT 1) AS role,
    COALESCE((SELECT array_agg(uhp.property_name ORDER BY uhp.property_name)
      FROM public.user_hotel_permissions uhp
      WHERE uhp.user_id = p.user_id AND uhp.tenant_id = p_tenant_id), ARRAY[]::text[]) AS hotels
  FROM public.profiles p
  WHERE p.tenant_id = p_tenant_id
    AND (public.is_super_admin(auth.uid()) OR p_tenant_id = public.get_current_tenant_id())
  ORDER BY p.full_name
$$;

REVOKE ALL ON FUNCTION public.get_tenant_users_with_hotels(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_users_with_hotels(uuid) TO authenticated;

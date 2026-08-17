REVOKE EXECUTE ON FUNCTION public.get_tenant_users_with_hotels(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reclassify_tenant_channels(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_users_with_hotels(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_tenant_channels(uuid) TO authenticated;

DROP POLICY IF EXISTS "crm_accounts insert same tenant or super_admin" ON public.crm_accounts;
CREATE POLICY "crm_accounts insert editors or admins"
ON public.crm_accounts FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin'::public.app_role, tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor'::public.app_role, tenant_id)
    )
  )
);

DROP POLICY IF EXISTS "crm_accounts update same tenant or super_admin" ON public.crm_accounts;
CREATE POLICY "crm_accounts update editors or admins"
ON public.crm_accounts FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin'::public.app_role, tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor'::public.app_role, tenant_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin'::public.app_role, tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor'::public.app_role, tenant_id)
    )
  )
);

DROP POLICY IF EXISTS "crm_visits update same tenant or super_admin" ON public.crm_visits;
CREATE POLICY "crm_visits update editors admins or creator"
ON public.crm_visits FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      created_by = auth.uid()
      OR public.has_role_in_tenant(auth.uid(), 'master_admin'::public.app_role, tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor'::public.app_role, tenant_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND (
      created_by = auth.uid()
      OR public.has_role_in_tenant(auth.uid(), 'master_admin'::public.app_role, tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor'::public.app_role, tenant_id)
    )
  )
);